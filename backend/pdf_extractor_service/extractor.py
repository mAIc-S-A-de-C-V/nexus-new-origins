"""
PDF -> structured rows extractor.

Lifted from the reference catalog_extractor.py (in Downloads/) and adapted to:
  - take PDF bytes (not a path) so it can run from a MinIO-backed upload
  - emit images into MinIO via storage.put_bytes()
  - report per-page progress through a callback
  - keep the schema prompt configurable per job (default = product-catalog prompt)

Everything else — page rendering, image xref extraction, bbox matching — is
preserved unchanged from the reference.
"""
from __future__ import annotations

import base64
import io
import json
import logging
import os
import re
import uuid
from dataclasses import dataclass, field
from typing import Callable, Optional

import fitz  # PyMuPDF

from storage import image_storage_key, public_url, put_bytes

log = logging.getLogger("pdf_extractor.extractor")

DEFAULT_MODEL = os.environ.get("PDF_EXTRACTOR_MODEL", "claude-opus-4-7")

# ---------------------------------------------------------------------------
# Default page prompt (product-catalog flavor) — same wording as the reference
# script's PAGE_PROMPT. Overridable per job via schema_prompt.
# ---------------------------------------------------------------------------

DEFAULT_PAGE_PROMPT = """You are extracting structured data from one page of a product catalog.

Return a SINGLE JSON object — no prose, no markdown fences — matching this schema:

{
  "page_type": "divider" | "product_grid" | "toc" | "cover" | "other",
  "category": "<string or empty>",
  "products": [
    {
      "name": "<product name as printed, uppercase preserved>",
      "sku_internal": "<e.g. FDP35002-110V or empty>",
      "sku_ref": "<e.g. Ref.45454 or empty>",
      "specifications": { "<spec key>": "<spec value>", ... },
      "accessories": [ "<line 1>", "<line 2>", ... ],
      "variants": [
        { "codigo": "...", "ref": "...", "<other column>": "..." }
      ],
      "bbox_norm": [x0, y0, x1, y1]
    }
  ]
}

Rules:
- page_type="divider" when the page is a full-page section title with little or no product data.
  In that case, set "category" to the divider title and leave "products" as [].
- page_type="product_grid" for normal product pages. Set "category" to the text in the footer
  banner at the bottom of the page (the bold horizontal band naming the section).
- page_type="toc" for any table-of-contents / index page (lists of names and page numbers, no specs).
- page_type="cover"/"other" for cover, intro, blank, brand intro pages.
- bbox_norm is the bounding box of the WHOLE product card (image + text), in normalized page
  coordinates where (0,0) is top-left and (1,1) is bottom-right. Be precise — these are used
  to match the product to its image.
- Preserve original text verbatim including accents.
- Specifications: each labeled row of the specs table becomes one key:value pair.
- Accessories: every bullet/line under "ACCESSORIES" / "ACCESORIOS:" — keep them as-is.
- Variants: if the product has a table with multiple CÓDIGO/REF rows (different sizes or models),
  put each row as one object under "variants". Otherwise [].
- If a field is not present, use "" or [] or {}. Do not invent data.
"""


# ---------------------------------------------------------------------------
# Data model
# ---------------------------------------------------------------------------

@dataclass
class ExtractedProduct:
    id: str
    page: int
    category: str = ""
    name: str = ""
    sku_internal: str = ""
    sku_ref: str = ""
    specifications: dict = field(default_factory=dict)
    accessories: list = field(default_factory=list)
    variants: list = field(default_factory=list)
    bbox_norm: tuple = (0.0, 0.0, 0.0, 0.0)
    image_storage_key: Optional[str] = None
    image_url: Optional[str] = None


# ---------------------------------------------------------------------------
# Vision LLM call (Anthropic Claude). Independent from shared/llm_router by
# design — the user asked for this module to stand on its own.
# ---------------------------------------------------------------------------

def _call_vision_llm(page_jpeg_bytes: bytes, api_key: str, model: str,
                     prompt: str) -> dict:
    import anthropic
    client = anthropic.Anthropic(api_key=api_key)

    b64 = base64.standard_b64encode(page_jpeg_bytes).decode("ascii")
    msg = client.messages.create(
        model=model,
        max_tokens=4096,
        messages=[{
            "role": "user",
            "content": [
                {"type": "image", "source": {
                    "type": "base64", "media_type": "image/jpeg", "data": b64,
                }},
                {"type": "text", "text": prompt},
            ],
        }],
    )
    text = "".join(b.text for b in msg.content if b.type == "text").strip()
    text = re.sub(r"^```(?:json)?\s*|\s*```$", "", text, flags=re.MULTILINE).strip()
    return json.loads(text)


# ---------------------------------------------------------------------------
# Extractor
# ---------------------------------------------------------------------------

ProgressCallback = Callable[[dict], None]
# Each progress event is one of:
#   {"event": "started", "total_pages": int}
#   {"event": "page", "page": int, "page_type": str, "category": str,
#    "products": int, "error": str | None}
#   {"event": "done", "products": int}
#   {"event": "failed", "error": str}


class PdfExtractor:
    def __init__(self, *,
                 tenant_id: str,
                 job_id: str,
                 pdf_bytes: bytes,
                 api_key: str,
                 model: str = DEFAULT_MODEL,
                 dpi: int = 150,
                 page_range: Optional[tuple] = None,
                 schema_prompt: Optional[str] = None,
                 progress_cb: Optional[ProgressCallback] = None):
        self.tenant_id = tenant_id
        self.job_id = job_id
        self.api_key = api_key
        self.model = model
        self.dpi = dpi
        self.page_range = page_range  # (start, end) 1-indexed inclusive
        self.prompt = schema_prompt or DEFAULT_PAGE_PROMPT
        self.progress_cb = progress_cb or (lambda _e: None)

        self.doc = fitz.open(stream=pdf_bytes, filetype="pdf")
        self.products: list[ExtractedProduct] = []
        self.current_category: str = ""

    # --- Page rendering --------------------------------------------------

    def _render_page_jpeg(self, page_num: int) -> bytes:
        page = self.doc[page_num]
        zoom = self.dpi / 72
        pix = page.get_pixmap(matrix=fitz.Matrix(zoom, zoom), alpha=False)
        try:
            return pix.tobytes("jpeg")
        finally:
            # fitz Pixmaps hold large raw buffers; CPython refcounting
            # usually frees them, but on tight memory budgets the GC lags.
            # Drop the reference explicitly so the next page starts clean.
            pix = None
            page = None

    # --- Image extraction (PDF-native, with bboxes) ----------------------

    def _extract_page_images(self, page_num: int) -> list[dict]:
        page = self.doc[page_num]
        page_rect = page.rect
        page_w, page_h = page_rect.width, page_rect.height

        out = []
        for info in page.get_image_info(xrefs=True):
            xref = info.get("xref", 0)
            if not xref:
                continue
            bbox = info["bbox"]
            try:
                base = self.doc.extract_image(xref)
            except Exception:
                continue
            img_bytes = base["image"]
            ext = base["ext"]
            if info["width"] < 80 or info["height"] < 80:
                continue
            norm_bbox = (
                bbox[0] / page_w, bbox[1] / page_h,
                bbox[2] / page_w, bbox[3] / page_h,
            )
            out.append({
                "xref": xref, "bbox": norm_bbox, "ext": ext,
                "bytes": img_bytes, "w": info["width"], "h": info["height"],
            })
        return out

    # --- Image ↔ product matching ----------------------------------------

    @staticmethod
    def _bbox_center(b):
        return ((b[0] + b[2]) / 2, (b[1] + b[3]) / 2)

    @staticmethod
    def _bbox_contains_point(b, pt):
        return b[0] <= pt[0] <= b[2] and b[1] <= pt[1] <= b[3]

    @staticmethod
    def _bbox_distance(b1, b2):
        c1 = ((b1[0] + b1[2]) / 2, (b1[1] + b1[3]) / 2)
        c2 = ((b2[0] + b2[2]) / 2, (b2[1] + b2[3]) / 2)
        return ((c1[0] - c2[0]) ** 2 + (c1[1] - c2[1]) ** 2) ** 0.5

    def _match_images_to_products(self, products: list[ExtractedProduct],
                                  images: list[dict]) -> None:
        if not products or not images:
            return
        used = set()
        for prod in products:
            best, best_score = None, float("inf")
            for i, img in enumerate(images):
                if i in used:
                    continue
                center = self._bbox_center(img["bbox"])
                contained = self._bbox_contains_point(prod.bbox_norm, center)
                dist = self._bbox_distance(prod.bbox_norm, img["bbox"])
                score = dist - (10 if contained else 0)
                if score < best_score:
                    best_score, best = score, i
            if best is not None:
                used.add(best)
                # attach the chosen image temporarily so process_page can persist it
                setattr(prod, "_matched_image", images[best])

    # --- Per-page loop ---------------------------------------------------

    def _process_page(self, page_num: int) -> None:
        jpeg = self._render_page_jpeg(page_num)
        try:
            data = _call_vision_llm(jpeg, self.api_key, self.model, self.prompt)
        except Exception as e:
            log.warning("page_llm_error job=%s page=%d err=%s",
                        self.job_id, page_num + 1, e)
            self.progress_cb({
                "event": "page", "page": page_num + 1, "page_type": "error",
                "category": "", "products": 0, "error": str(e),
            })
            return

        page_type = data.get("page_type", "other")
        if page_type == "divider":
            self.current_category = data.get("category", "") or self.current_category
            self.progress_cb({
                "event": "page", "page": page_num + 1, "page_type": "divider",
                "category": self.current_category, "products": 0, "error": None,
            })
            return
        if page_type != "product_grid":
            self.progress_cb({
                "event": "page", "page": page_num + 1, "page_type": page_type,
                "category": "", "products": 0, "error": None,
            })
            return

        cat = data.get("category", "") or self.current_category
        self.current_category = cat or self.current_category

        page_products: list[ExtractedProduct] = []
        for p in data.get("products", []):
            prod = ExtractedProduct(
                id=str(uuid.uuid4()),
                page=page_num + 1,
                category=cat,
                name=p.get("name", "") or "",
                sku_internal=p.get("sku_internal", "") or "",
                sku_ref=p.get("sku_ref", "") or "",
                specifications=p.get("specifications", {}) or {},
                accessories=p.get("accessories", []) or [],
                variants=p.get("variants", []) or [],
                bbox_norm=tuple(p.get("bbox_norm", [0, 0, 0, 0])),
            )
            page_products.append(prod)

        images = self._extract_page_images(page_num)
        self._match_images_to_products(page_products, images)

        for prod in page_products:
            img = getattr(prod, "_matched_image", None)
            if img is None:
                continue
            key = image_storage_key(self.tenant_id, self.job_id, prod.id, img["ext"])
            content_type = f"image/{img['ext'].lower()}"
            try:
                put_bytes(key, img["bytes"], content_type)
                prod.image_storage_key = key
                prod.image_url = public_url(key)
            except Exception as e:
                log.warning("image_upload_failed job=%s page=%d err=%s",
                            self.job_id, page_num + 1, e)

        self.products.extend(page_products)
        self.progress_cb({
            "event": "page", "page": page_num + 1, "page_type": "product_grid",
            "category": cat, "products": len(page_products), "error": None,
        })

    # --- Top-level driver ------------------------------------------------

    def extract(self) -> list[ExtractedProduct]:
        import gc
        n_pages = len(self.doc)
        start, end = (1, n_pages) if not self.page_range else self.page_range
        start = max(1, min(start, n_pages))
        end = max(start, min(end, n_pages))

        self.progress_cb({"event": "started", "total_pages": end - start + 1})

        for idx, i in enumerate(range(start - 1, end)):
            try:
                self._process_page(i)
            except Exception as e:
                log.exception("page_processing_failed job=%s page=%d", self.job_id, i + 1)
                self.progress_cb({
                    "event": "page", "page": i + 1, "page_type": "error",
                    "category": "", "products": 0, "error": str(e),
                })
            # Force a GC sweep every 5 pages to keep PyMuPDF's internal
            # caches + raw image buffers from accumulating across the run.
            if (idx + 1) % 5 == 0:
                gc.collect()

        self.progress_cb({"event": "done", "products": len(self.products)})
        return self.products

    def close(self):
        try:
            self.doc.close()
        except Exception:
            pass
