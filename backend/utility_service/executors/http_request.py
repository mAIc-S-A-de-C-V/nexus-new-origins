import httpx
import json as json_lib


async def run(inputs: dict) -> dict:
    method = inputs.get("method", "GET").upper()
    url = inputs.get("url", "")
    headers = inputs.get("headers") or {}
    body = inputs.get("body")
    timeout = float(inputs.get("timeout", 30))

    if not url:
        return {"error": "url is required"}

    if isinstance(headers, str):
        try:
            headers = json_lib.loads(headers)
        except Exception:
            headers = {}

    async with httpx.AsyncClient(timeout=timeout, follow_redirects=True) as client:
        try:
            request_kwargs = {"headers": headers}
            if body:
                if isinstance(body, str):
                    try:
                        request_kwargs["json"] = json_lib.loads(body)
                    except Exception:
                        request_kwargs["content"] = body.encode()
                elif isinstance(body, dict):
                    request_kwargs["json"] = body

            resp = await client.request(method, url, **request_kwargs)
            result = {
                "status_code": resp.status_code,
                "body": resp.text,
                "headers": dict(resp.headers),
            }
            try:
                result["json"] = resp.json()
            except Exception:
                pass
            return result
        except Exception as e:
            return {"error": str(e)}
