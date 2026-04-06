import httpx
import io


async def run(inputs: dict) -> dict:
    pdf_url = inputs.get("pdf_url", "")
    pages_param = inputs.get("pages")

    if not pdf_url:
        return {"error": "pdf_url is required"}

    try:
        import pdfplumber
    except ImportError:
        return {"error": "pdfplumber not installed"}

    async with httpx.AsyncClient(timeout=60, follow_redirects=True) as client:
        try:
            resp = await client.get(pdf_url)
            if not resp.is_success:
                return {"error": f"Failed to download PDF: HTTP {resp.status_code}"}
            pdf_bytes = resp.content
        except Exception as e:
            return {"error": f"Download failed: {str(e)}"}

    try:
        with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
            all_pages = pdf.pages
            page_count = len(all_pages)

            # Determine page range
            if pages_param:
                parts = str(pages_param).split("-")
                if len(parts) == 2:
                    start = max(0, int(parts[0]) - 1)
                    end = min(page_count, int(parts[1]))
                    page_indices = range(start, end)
                else:
                    idx = int(parts[0]) - 1
                    page_indices = [idx] if 0 <= idx < page_count else range(page_count)
            else:
                page_indices = range(page_count)

            extracted_pages = []
            for i in page_indices:
                text = all_pages[i].extract_text() or ""
                extracted_pages.append({"page_number": i + 1, "text": text.strip()})

            full_text = "\n\n".join(p["text"] for p in extracted_pages if p["text"])

            return {
                "full_text": full_text,
                "pages": extracted_pages,
                "page_count": page_count,
            }
    except Exception as e:
        return {"error": f"PDF extraction failed: {str(e)}"}
