import httpx
import io


async def run(inputs: dict) -> dict:
    image_url = inputs.get("image_url", "")
    if not image_url:
        return {"error": "image_url is required"}

    try:
        from pyzbar.pyzbar import decode as pyzbar_decode
        from PIL import Image
    except ImportError:
        return {"error": "pyzbar or Pillow not installed"}

    async with httpx.AsyncClient(timeout=20, follow_redirects=True) as client:
        try:
            resp = await client.get(image_url)
            if not resp.is_success:
                return {"error": f"HTTP {resp.status_code}"}
            image_bytes = resp.content
        except Exception as e:
            return {"error": f"Download failed: {str(e)}"}

    try:
        img = Image.open(io.BytesIO(image_bytes))
        codes = pyzbar_decode(img)
        if not codes:
            return {"decoded": None, "type": None, "all_codes": [], "error": "No QR/barcode found in image"}

        all_codes = [{"decoded": c.data.decode("utf-8", errors="replace"), "type": c.type} for c in codes]
        return {
            "decoded": all_codes[0]["decoded"],
            "type": all_codes[0]["type"],
            "all_codes": all_codes,
        }
    except Exception as e:
        return {"error": f"Decode failed: {str(e)}"}
