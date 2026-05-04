"""
Helpers for the external app-share feature: token gen, password hashing,
short-lived share-session JWTs, scope merging, and per-share rate limiting.

Kept in one module so the router stays focused on HTTP shape.
"""
import os
import secrets
import time
from collections import defaultdict
from datetime import datetime, timezone, timedelta
from typing import Any, Optional

from jose import jwt, JWTError
from passlib.context import CryptContext


# ── Token + password ────────────────────────────────────────────────────────

def new_share_token() -> str:
    """URL-safe random token (~22 chars, ~128 bits of entropy).
    Stored separately from the row id so it can be rotated without losing
    audit history."""
    return secrets.token_urlsafe(16)


_pwd_ctx = CryptContext(schemes=["bcrypt"], deprecated="auto")


def hash_password(plain: str) -> str:
    return _pwd_ctx.hash(plain)


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return _pwd_ctx.verify(plain, hashed)
    except Exception:
        return False


# ── Share-session JWT (short-lived; held by the public viewer) ─────────────

SHARE_JWT_SECRET = os.environ.get(
    "SHARE_JWT_SECRET",
    # Dev fallback — production sets this via env. Logged once at boot so
    # an unset secret in a real deploy is loud.
    "dev-only-share-secret-change-me",
)
SHARE_JWT_ALG = "HS256"
SHARE_SESSION_TTL_MIN = int(os.environ.get("SHARE_SESSION_TTL_MIN", "30"))


def issue_share_session(share_id: str, tenant_id: str, mode: str, app_id: str) -> str:
    payload = {
        "share_id": share_id,
        "tenant_id": tenant_id,
        "mode": mode,
        "app_id": app_id,
        "iat": int(time.time()),
        "exp": int(time.time()) + SHARE_SESSION_TTL_MIN * 60,
    }
    return jwt.encode(payload, SHARE_JWT_SECRET, algorithm=SHARE_JWT_ALG)


def decode_share_session(token: str) -> Optional[dict]:
    try:
        return jwt.decode(token, SHARE_JWT_SECRET, algorithms=[SHARE_JWT_ALG])
    except JWTError:
        return None


# ── Scope merging ──────────────────────────────────────────────────────────

def merge_filter_json(user_filter: Optional[str], scope_filters: Optional[dict]) -> Optional[str]:
    """Merge the share's data_scope.filters into a client-supplied filter JSON.
    Scope keys override user-supplied keys for the same field — a viewer can
    narrow but not broaden their own scope."""
    if not scope_filters:
        return user_filter
    import json
    base: dict = {}
    if user_filter:
        try:
            parsed = json.loads(user_filter)
            if isinstance(parsed, dict):
                base = parsed
        except json.JSONDecodeError:
            base = {}
    base.update(scope_filters)
    return json.dumps(base)


def scope_allows_object_type(version_object_type_ids: list, ot_id: str) -> bool:
    """The share is locked to its pinned snapshot's object types. Any kernel
    request for an ot_id outside that list is rejected — prevents a viewer
    from probing other tenant data via the share session."""
    if not ot_id:
        return False
    return ot_id in (version_object_type_ids or [])


# ── In-process rate limiting ───────────────────────────────────────────────
#
# Lightweight by design: a token-bucket per (share_id, kind) tuple lives in
# memory. Survives restarts? No — but the share row also tracks auth_failures
# / auth_locked_until in the DB, so brute-force lockouts persist. The bucket
# only protects burst floods on /data and /submit.
#
# For multi-replica deploys, swap this with Redis later. v1 is single-replica.

class _Bucket:
    __slots__ = ("tokens", "last")

    def __init__(self, tokens: float, last: float):
        self.tokens = tokens
        self.last = last


_buckets: dict[tuple[str, str], _Bucket] = {}


def take_qps_token(share_id: str, kind: str, qps: int) -> bool:
    """Returns False if the request should be 429'd. qps is the bucket size
    AND the refill rate — i.e. burst capacity == sustained rate. Plenty for
    v1 where typical use is one viewer per share."""
    qps = max(1, int(qps))
    key = (share_id, kind)
    now = time.monotonic()
    b = _buckets.get(key)
    if b is None:
        b = _Bucket(tokens=float(qps), last=now)
        _buckets[key] = b
    # Refill.
    elapsed = now - b.last
    b.tokens = min(float(qps), b.tokens + elapsed * qps)
    b.last = now
    if b.tokens < 1.0:
        return False
    b.tokens -= 1.0
    return True


# ── Auth-failure lockout ──────────────────────────────────────────────────

AUTH_LOCKOUT_THRESHOLD = int(os.environ.get("SHARE_AUTH_LOCKOUT_THRESHOLD", "5"))
AUTH_LOCKOUT_MINUTES = int(os.environ.get("SHARE_AUTH_LOCKOUT_MINUTES", "10"))


def is_auth_locked(locked_until: Optional[datetime]) -> bool:
    if locked_until is None:
        return False
    return datetime.now(timezone.utc) < locked_until


def next_lockout_until() -> datetime:
    return datetime.now(timezone.utc) + timedelta(minutes=AUTH_LOCKOUT_MINUTES)


# ── Share lifecycle helpers ────────────────────────────────────────────────

def is_share_usable(
    revoked_at: Optional[datetime],
    expires_at: Optional[datetime],
    use_count: int,
    max_uses: Optional[int],
) -> tuple[bool, str]:
    """Returns (usable, reason). Reason is the short string the public viewer
    surfaces when the share is dead."""
    if revoked_at is not None:
        return False, "revoked"
    now = datetime.now(timezone.utc)
    if expires_at is not None and expires_at < now:
        return False, "expired"
    if max_uses is not None and use_count >= max_uses:
        return False, "exhausted"
    return True, ""
