import httpx
import json as json_lib


async def run(inputs: dict) -> dict:
    url = inputs.get("url", "")
    payload = inputs.get("payload", {})
    auth_header = inputs.get("auth_header")

    if not url:
        return {"error": "url is required"}

    if isinstance(payload, str):
        try:
            payload = json_lib.loads(payload)
        except Exception:
            payload = {"text": payload}

    headers = {"Content-Type": "application/json"}
    if auth_header:
        headers["Authorization"] = auth_header

    async with httpx.AsyncClient(timeout=30) as client:
        try:
            resp = await client.post(url, json=payload, headers=headers)
            return {"status_code": resp.status_code, "response": resp.text}
        except Exception as e:
            return {"error": str(e)}
