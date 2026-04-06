import httpx
import io
import os


async def run(inputs: dict) -> dict:
    image_url = inputs.get("image_url", "")
    language = inputs.get("language", "eng")

    if not image_url:
        return {"error": "image_url is required"}

    try:
        import pytesseract
        from PIL import Image
    except ImportError:
        return {"error": "pytesseract or Pillow not installed"}

    # Download the image
    async with httpx.AsyncClient(timeout=30, follow_redirects=True) as client:
        try:
            resp = await client.get(image_url)
            if not resp.is_success:
                return {"error": f"Failed to download image: HTTP {resp.status_code}"}
            image_bytes = resp.content
        except Exception as e:
            return {"error": f"Download failed: {str(e)}"}

    try:
        img = Image.open(io.BytesIO(image_bytes))
        # Get data with confidence
        data = pytesseract.image_to_data(img, lang=language, output_type=pytesseract.Output.DICT)

        # Build full text
        words = []
        confidences = []
        for i, word in enumerate(data["text"]):
            if word.strip():
                words.append(word)
                conf = data["conf"][i]
                if conf > 0:
                    confidences.append(conf)

        full_text = pytesseract.image_to_string(img, lang=language).strip()
        avg_confidence = sum(confidences) / len(confidences) if confidences else 0

        return {
            "text": full_text,
            "confidence": round(avg_confidence, 1),
            "word_count": len(words),
        }
    except Exception as e:
        return {"error": f"OCR failed: {str(e)}"}
