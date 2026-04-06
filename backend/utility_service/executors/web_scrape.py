import httpx
from bs4 import BeautifulSoup


async def run(inputs: dict) -> dict:
    url = inputs.get("url", "")
    selector = inputs.get("selector")

    if not url:
        return {"error": "url is required"}

    headers = {
        "User-Agent": "Mozilla/5.0 (compatible; NexusBot/1.0)",
        "Accept": "text/html,application/xhtml+xml",
    }

    async with httpx.AsyncClient(timeout=30, follow_redirects=True) as client:
        try:
            resp = await client.get(url, headers=headers)
            if not resp.is_success:
                return {"error": f"HTTP {resp.status_code}"}
            html = resp.text
        except Exception as e:
            return {"error": f"Request failed: {str(e)}"}

    try:
        soup = BeautifulSoup(html, "html.parser")

        # Remove script/style
        for tag in soup(["script", "style", "nav", "footer", "header"]):
            tag.decompose()

        title = soup.title.get_text(strip=True) if soup.title else ""

        if selector:
            target = soup.select(selector)
            text = "\n".join(el.get_text(separator=" ", strip=True) for el in target)
        else:
            main = soup.find("main") or soup.find("article") or soup.body or soup
            text = main.get_text(separator="\n", strip=True) if main else soup.get_text(separator="\n", strip=True)
            # Collapse multiple blank lines
            import re
            text = re.sub(r'\n{3,}', '\n\n', text).strip()

        links = [a["href"] for a in soup.find_all("a", href=True) if a["href"].startswith("http")][:50]

        return {"text": text, "title": title, "links": links}
    except Exception as e:
        return {"error": f"Parse failed: {str(e)}"}
