import httpx


async def run(inputs: dict) -> dict:
    address = inputs.get("address", "").strip()
    if not address:
        return {"error": "address is required"}

    params = {
        "q": address,
        "format": "json",
        "limit": 1,
        "addressdetails": 1,
    }
    headers = {"User-Agent": "NexusGeocoder/1.0 (contact@nexus.internal)"}

    async with httpx.AsyncClient(timeout=10) as client:
        try:
            resp = await client.get("https://nominatim.openstreetmap.org/search", params=params, headers=headers)
            data = resp.json()
            if not data:
                return {"error": f"No results found for: {address}", "lat": None, "lng": None}

            result = data[0]
            return {
                "lat": float(result["lat"]),
                "lng": float(result["lon"]),
                "formatted_address": result.get("display_name", ""),
                "place_id": str(result.get("place_id", "")),
            }
        except Exception as e:
            return {"error": str(e)}
