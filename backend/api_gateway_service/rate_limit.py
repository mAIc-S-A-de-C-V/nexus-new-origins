import os
import time
import redis.asyncio as redis

REDIS_URL = os.environ.get("REDIS_URL", "redis://redis:6379/3")

_client: redis.Redis | None = None


async def get_client() -> redis.Redis:
    global _client
    if _client is None:
        _client = redis.from_url(REDIS_URL, decode_responses=True)
    return _client


async def close_client():
    global _client
    if _client:
        await _client.close()
        _client = None


async def check_and_consume(key_id: str, limit_per_min: int) -> tuple[bool, int, int]:
    """Fixed-window counter. Returns (allowed, remaining, reset_in_seconds)."""
    if limit_per_min <= 0:
        return True, 0, 0
    client = await get_client()
    now = int(time.time())
    window = now // 60
    redis_key = f"ratelimit:{key_id}:{window}"
    count = await client.incr(redis_key)
    if count == 1:
        await client.expire(redis_key, 65)
    remaining = max(0, limit_per_min - count)
    reset_in = 60 - (now % 60)
    return count <= limit_per_min, remaining, reset_in
