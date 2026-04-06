import httpx
import feedparser
from datetime import datetime


async def run(inputs: dict) -> dict:
    feed_url = inputs.get("feed_url", "")
    limit = int(inputs.get("limit", 20))

    if not feed_url:
        return {"error": "feed_url is required"}

    async with httpx.AsyncClient(timeout=20, follow_redirects=True) as client:
        try:
            resp = await client.get(feed_url, headers={"User-Agent": "NexusBot/1.0"})
            if not resp.is_success:
                return {"error": f"HTTP {resp.status_code}"}
            content = resp.text
        except Exception as e:
            return {"error": f"Fetch failed: {str(e)}"}

    try:
        parsed = feedparser.parse(content)
        feed_title = parsed.feed.get("title", "")

        items = []
        for entry in parsed.entries[:limit]:
            published = ""
            if hasattr(entry, "published_parsed") and entry.published_parsed:
                try:
                    published = datetime(*entry.published_parsed[:6]).isoformat()
                except Exception:
                    published = entry.get("published", "")

            summary = entry.get("summary", "")
            # Strip HTML from summary
            if "<" in summary:
                from bs4 import BeautifulSoup
                summary = BeautifulSoup(summary, "html.parser").get_text(strip=True)

            items.append({
                "title": entry.get("title", ""),
                "link": entry.get("link", ""),
                "published": published,
                "summary": summary[:500],
                "author": entry.get("author", ""),
            })

        return {"feed_title": feed_title, "items": items, "count": len(items)}
    except Exception as e:
        return {"error": f"Parse failed: {str(e)}"}
