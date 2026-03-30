"""
RS256 JWT utils.
On first startup, generates a 2048-bit RSA key pair and stores it in-memory.
The public key is exposed at /auth/jwks for other services to verify tokens.
Access tokens: 15-minute TTL, stored in memory by client.
Refresh tokens: 7-day TTL, stored as hashed value in DB.
"""
import hashlib
import os
import secrets
from datetime import datetime, timedelta, timezone

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from jose import jwt, JWTError

ACCESS_TOKEN_EXPIRE_MINUTES = int(os.environ.get("ACCESS_TOKEN_EXPIRE_MINUTES", "15"))
REFRESH_TOKEN_EXPIRE_DAYS = int(os.environ.get("REFRESH_TOKEN_EXPIRE_DAYS", "7"))
ALGORITHM = "RS256"
ISSUER = os.environ.get("JWT_ISSUER", "https://nexus.internal/auth")

# Generate key pair at startup
_private_key = rsa.generate_private_key(
    public_exponent=65537,
    key_size=2048,
)
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

# Pre-build JWKS for the /.well-known/jwks.json endpoint
from cryptography.hazmat.primitives.asymmetric.rsa import RSAPublicKey
from base64 import urlsafe_b64encode
import struct


def _int_to_base64url(n: int) -> str:
    length = (n.bit_length() + 7) // 8
    return urlsafe_b64encode(n.to_bytes(length, "big")).rstrip(b"=").decode()


pub_numbers = _public_key.public_numbers()
KID = "nexus-key-1"

JWKS = {
    "keys": [
        {
            "kty": "RSA",
            "use": "sig",
            "alg": "RS256",
            "kid": KID,
            "n": _int_to_base64url(pub_numbers.n),
            "e": _int_to_base64url(pub_numbers.e),
        }
    ]
}


def create_access_token(user_id: str, email: str, role: str, tenant_id: str) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "sub": user_id,
        "email": email,
        "role": role,
        "tenant_id": tenant_id,
        "iss": ISSUER,
        "iat": now,
        "exp": now + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES),
    }
    return jwt.encode(payload, PRIVATE_KEY_PEM, algorithm=ALGORITHM, headers={"kid": KID})


def create_refresh_token() -> tuple[str, str]:
    """Returns (raw_token, hashed_token). Store hash, send raw to client."""
    raw = secrets.token_urlsafe(48)
    hashed = hashlib.sha256(raw.encode()).hexdigest()
    return raw, hashed


def hash_refresh_token(raw: str) -> str:
    return hashlib.sha256(raw.encode()).hexdigest()


def decode_access_token(token: str) -> dict:
    return jwt.decode(token, PUBLIC_KEY_PEM, algorithms=[ALGORITHM], issuer=ISSUER)
