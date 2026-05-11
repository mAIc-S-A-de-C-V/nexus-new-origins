"""
Per-install token bucket rate limiter. In-memory — fine for v1 single replica,
backed by Redis later when we scale.

Default: 100 RPS sustained, burst 200. Configurable via env.
"""
import asyncio
import os
import time
from collections import defaultdict
from dataclasses import dataclass

RPS = float(os.environ.get("APPS_RPC_RPS", "100"))
BURST = float(os.environ.get("APPS_RPC_BURST", "200"))


@dataclass
class Bucket:
    tokens: float
    last_refill: float


class TokenBucket:
    def __init__(self, rps: float = RPS, burst: float = BURST):
        self.rps = rps
        self.burst = burst
        self._buckets: dict[str, Bucket] = defaultdict(lambda: Bucket(tokens=burst, last_refill=time.monotonic()))
        self._lock = asyncio.Lock()

    async def acquire(self, key: str, cost: float = 1.0) -> bool:
        """Returns True if allowed, False if rate-limited."""
        async with self._lock:
            now = time.monotonic()
            b = self._buckets[key]
            elapsed = now - b.last_refill
            b.tokens = min(self.burst, b.tokens + elapsed * self.rps)
            b.last_refill = now
            if b.tokens >= cost:
                b.tokens -= cost
                return True
            return False


_limiter = TokenBucket()


async def check_rate(install_id: str) -> bool:
    return await _limiter.acquire(install_id)
