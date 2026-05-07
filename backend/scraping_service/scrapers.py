"""
Scraping primitives backed by Scrapling.

Two surfaces:
  - search_duckduckgo(query, max_results)  — DDG HTML endpoint, parsed into
    [{title, url, snippet}]. Free, no API key, modest rate limits.
  - scrape_url(url, ...)                   — fetch a URL and extract text /
    selector matches / outbound links. Optional `use_stealth` flag flips
    over to Scrapling's StealthyFetcher (Camoufox) — only enable on demand
    because it ships its own browser binary.

Both are async-first (Scrapling's AsyncFetcher under the hood). Errors are
surfaced as HTTP 500 with the exception message; the caller decides how to
handle it (the agent_service wrapper turns them into model-readable
"error": "..." fields so Claude can decide to try another source).
"""
from __future__ import annotations

import logging
import urllib.parse
from typing import Any, Optional

logger = logging.getLogger("scraping")


def _css_first(node: Any, selector: str):
    """Compat shim. Scrapling 0.4 dropped .css_first(); use .css() and index."""
    try:
        matches = node.css(selector)
    except Exception:
        return None
    if not matches:
        return None
    try:
        return matches[0]
    except Exception:
        return None


def _node_text(node: Any) -> str:
    """Pull text from a Scrapling Selector. In 0.4+ ``.text`` is direct-only —
    we want all descendants, so prefer ``get_all_text()`` and fall back."""
    if node is None:
        return ""
    try:
        gat = getattr(node, "get_all_text", None)
        if callable(gat):
            return str(gat() or "")
    except Exception:
        pass
    try:
        return str(node.text or "")
    except Exception:
        return ""


def _resolve_ddg_redirect(href: str) -> str:
    """DuckDuckGo's HTML page wraps result links in /l/?uddg=<urlencoded>.
    Unwrap them so callers get the actual destination."""
    if href.startswith("//"):
        href = "https:" + href
    if "/l/?" in href or href.startswith("/l/?") or href.startswith("https://duckduckgo.com/l/?"):
        try:
            qs = urllib.parse.urlparse(href).query
            uddg = urllib.parse.parse_qs(qs).get("uddg", [""])[0]
            if uddg:
                return urllib.parse.unquote(uddg)
        except Exception:
            return href
    return href


async def search_duckduckgo(query: str, max_results: int = 10) -> dict:
    """Run a DuckDuckGo HTML search; return parsed top-N organic results."""
    from scrapling.fetchers import AsyncFetcher

    encoded = urllib.parse.quote_plus(query)
    url = f"https://html.duckduckgo.com/html/?q={encoded}"
    headers = {
        # Plain-vanilla UA. DDG's HTML endpoint allows it; rotating UAs
        # buys you nothing here and makes responses harder to debug.
        "User-Agent": "Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    }
    try:
        page = await AsyncFetcher.get(url, headers=headers, stealthy_headers=True, timeout=20)
    except Exception as exc:
        logger.warning("DDG fetch failed: %s", exc)
        return {"query": query, "results": [], "error": str(exc)}

    status = getattr(page, "status", 200)
    if status != 200:
        return {"query": query, "results": [], "error": f"HTTP {status}"}

    results: list[dict] = []
    # DDG's HTML uses .result blocks; .result__a is the title link, .result__snippet is body
    for el in page.css(".result")[: max_results * 2]:  # over-pull, then cap
        title_el = _css_first(el, ".result__a") or _css_first(el, ".result__title a")
        snippet_el = _css_first(el, ".result__snippet")
        if not title_el:
            continue
        href = ""
        try:
            # Scrapling Adaptor element: attrib via .attrib mapping
            href = title_el.attrib.get("href", "")  # type: ignore[union-attr]
        except Exception:
            href = ""
        href = _resolve_ddg_redirect(href)
        if not href.startswith(("http://", "https://")):
            continue
        results.append({
            "title": _node_text(title_el).strip()[:300],
            "url": href,
            "snippet": _node_text(snippet_el).strip()[:600] if snippet_el else "",
        })
        if len(results) >= max_results:
            break

    return {"query": query, "results": results, "count": len(results)}


async def scrape_url(
    url: str,
    *,
    selector: Optional[str] = None,
    extract_text: bool = True,
    extract_links: bool = False,
    use_stealth: bool = False,
    timeout: int = 20,
    text_max_chars: int = 8000,
) -> dict:
    """Fetch a single URL and return structured content.

    Returns:
      { url, status, title, text?, selected?, links? }

    - selector: CSS selector to extract specific elements (returned as text list)
    - extract_text: dump the body as cleaned plain text (capped at text_max_chars)
    - extract_links: list of outbound http(s) <a> tags (capped at 100)
    - use_stealth: route through StealthyFetcher (Camoufox). Only set True for
      sites that require it — adds latency and depends on Camoufox being
      installed in the image.
    """
    if not url.startswith(("http://", "https://")):
        return {"url": url, "status": 0, "error": "url must start with http:// or https://"}

    try:
        if use_stealth:
            from scrapling.fetchers import StealthyFetcher  # type: ignore
            page = await StealthyFetcher.async_fetch(
                url, headless=True, timeout=timeout * 1000
            )
        else:
            from scrapling.fetchers import AsyncFetcher
            page = await AsyncFetcher.get(
                url,
                headers={
                    "User-Agent": "Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0",
                },
                stealthy_headers=True,
                timeout=timeout,
            )
    except Exception as exc:
        logger.warning("scrape %s failed: %s", url, exc)
        return {"url": url, "status": 0, "error": str(exc)}

    status = getattr(page, "status", 200)
    out: dict[str, Any] = {"url": url, "status": status, "title": ""}
    if status >= 400:
        out["error"] = f"HTTP {status}"
        return out

    title_el = _css_first(page, "title")
    if title_el:
        out["title"] = _node_text(title_el).strip()[:300]

    if selector:
        try:
            els = page.css(selector)
            out["selected"] = [_node_text(e).strip()[:500] for e in els[:50]]
        except Exception as exc:
            out["selector_error"] = str(exc)

    if extract_text:
        # Prefer <main>/<article>/.content if present; fall back to <body>.
        main = (
            _css_first(page, "main")
            or _css_first(page, "article")
            or _css_first(page, ".content")
            or _css_first(page, "body")
        )
        if main:
            text = _node_text(main).strip()
            # Collapse runs of whitespace so the LLM doesn't waste context on \n\n\n.
            import re as _re
            text = _re.sub(r"\s+\n", "\n", text)
            text = _re.sub(r"\n{3,}", "\n\n", text)
            out["text"] = text[:text_max_chars]

    if extract_links:
        links: list[dict] = []
        for a in page.css("a")[:200]:
            try:
                href = a.attrib.get("href", "")  # type: ignore[union-attr]
            except Exception:
                continue
            if href.startswith(("http://", "https://")):
                links.append({
                    "href": href,
                    "text": _node_text(a).strip()[:200],
                })
                if len(links) >= 100:
                    break
        out["links"] = links

    return out
