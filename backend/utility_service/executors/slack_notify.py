import httpx
import json as json_lib


async def run(inputs: dict) -> dict:
    webhook_url = inputs.get("webhook_url", "")
    text = inputs.get("text", "")
    username = inputs.get("username")
    icon_emoji = inputs.get("icon_emoji")

    if not webhook_url:
        return {"ok": False, "error": "webhook_url is required"}
    if not text:
        return {"ok": False, "error": "text is required"}

    payload: dict = {"text": text}
    if username:
        payload["username"] = username
    if icon_emoji:
        payload["icon_emoji"] = icon_emoji

    async with httpx.AsyncClient(timeout=10) as client:
        try:
            resp = await client.post(webhook_url, json=payload)
            if resp.status_code == 200 and resp.text == "ok":
                return {"ok": True}
            return {"ok": False, "error": resp.text, "status_code": resp.status_code}
        except Exception as e:
            return {"ok": False, "error": str(e)}
