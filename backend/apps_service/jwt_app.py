"""
App-context JWTs.

Distinct from the platform's user-session JWTs:
  - signed with the same RS256 key (fetched via JWKS from auth-service)
  - issuer = "https://nexus.internal/apps"
  - audience = install_id (so a token leaked from one install can't drive another)
  - claims: install_id, app_id, tenant_id, user_id, scopes, origin
  - TTL: 5 minutes (force frequent refresh; host re-checks enabled flag)

The host frontend never embeds these in a URL — they're posted into the iframe
via the INIT message after the iframe loads.
"""
import os
from datetime import datetime, timedelta, timezone
from typing import Optional

import httpx
from jose import jwt, JWTError
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa

ALGORITHM = "RS256"
ISSUER = os.environ.get("APP_JWT_ISSUER", "https://nexus.internal/apps")
APP_TOKEN_TTL_SECONDS = int(os.environ.get("APP_TOKEN_TTL_SECONDS", "300"))   # 5 min
AUTH_SERVICE_URL = os.environ.get("AUTH_SERVICE_URL", "http://auth-service:8011")


def _load_or_generate_key():
    pem_env = os.environ.get("JWT_PRIVATE_KEY_PEM", "").strip()
    if pem_env:
        return serialization.load_pem_private_key(pem_env.encode(), password=None)
    key_file = os.environ.get("JWT_PRIVATE_KEY_FILE", "")
    if key_file and os.path.exists(key_file):
        with open(key_file, "rb") as f:
            return serialization.load_pem_private_key(f.read(), password=None)
    # Ephemeral key — same caveat as auth-service: tokens invalid on restart.
    return rsa.generate_private_key(public_exponent=65537, key_size=2048)


_private_key = _load_or_generate_key()
_public_key = _private_key.public_key()

PRIVATE_KEY_PEM = _private_key.private_bytes(
    encoding=serialization.Encoding.PEM,
    format=serialization.PrivateFormat.TraditionalOpenSSL,
    encryption_algorithm=serialization.NoEncryption(),
).decode()

PUBLIC_KEY_PEM = _public_key.public_bytes(
    encoding=serialization.Encoding.PEM,
    format=serialization.PublicFormat.SubjectPublicKeyInfo,
).decode()

KID = os.environ.get("APP_JWT_KID", "nexus-apps-key-1")


def mint_app_token(
    install_id: str,
    app_id: str,
    tenant_id: str,
    user_id: str,
    user_email: str,
    user_role: str,
    scopes: list[str],
    origin: str,
) -> tuple[str, datetime]:
    """Returns (jwt, expires_at)."""
    now = datetime.now(timezone.utc)
    exp = now + timedelta(seconds=APP_TOKEN_TTL_SECONDS)
    payload = {
        "iss": ISSUER,
        "aud": install_id,
        "sub": user_id,
        "email": user_email,
        "role": user_role,
        "tenant_id": tenant_id,
        "install_id": install_id,
        "app_id": app_id,
        "scopes": scopes,
        "origin": origin,
        "iat": now,
        "exp": exp,
    }
    token = jwt.encode(payload, PRIVATE_KEY_PEM, algorithm=ALGORITHM, headers={"kid": KID})
    return token, exp


def decode_app_token(token: str, expected_install_id: str | None = None) -> dict:
    """Verify + decode. Caller must additionally check origin matches sender."""
    options = {"verify_aud": expected_install_id is not None}
    payload = jwt.decode(
        token, PUBLIC_KEY_PEM, algorithms=[ALGORITHM],
        issuer=ISSUER,
        audience=expected_install_id,
        options=options,
    )
    return payload
