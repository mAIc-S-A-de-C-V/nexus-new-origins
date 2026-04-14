"""
AES-256-GCM encryption for connector credentials at rest.
ISO 27001 Annex A.8.24 — Cryptography

The encryption key is read from CREDENTIAL_ENCRYPTION_KEY env var (32-byte hex string).
If not set, falls back to a deterministic dev key — NEVER use this in production.

Generate a production key:
    python3 -c "import secrets; print(secrets.token_hex(32))"
"""
import os
import json
import base64
from typing import Optional

# Prefer cryptography library (installed with fastapi ecosystem)
try:
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    _HAS_CRYPTO = True
except ImportError:
    _HAS_CRYPTO = False


_DEV_KEY_HEX = "0" * 64  # 32 zero bytes — dev only, never production
_KEY_HEX = os.environ.get("CREDENTIAL_ENCRYPTION_KEY", _DEV_KEY_HEX)

try:
    _KEY = bytes.fromhex(_KEY_HEX)
    if len(_KEY) != 32:
        raise ValueError("CREDENTIAL_ENCRYPTION_KEY must be 32 bytes (64 hex chars)")
except ValueError as e:
    raise RuntimeError(f"Invalid CREDENTIAL_ENCRYPTION_KEY: {e}")


def encrypt_credentials(credentials: Optional[dict]) -> Optional[str]:
    """
    Encrypt a credentials dict to a base64-encoded ciphertext string.
    Returns None if credentials is None.
    Format: base64(nonce[12] || ciphertext)
    """
    if credentials is None:
        return None
    if not _HAS_CRYPTO:
        # Fallback: store as-is (log warning but don't crash)
        import logging
        logging.getLogger(__name__).warning(
            "cryptography package not available — credentials stored unencrypted"
        )
        return json.dumps(credentials)

    plaintext = json.dumps(credentials).encode()
    aesgcm = AESGCM(_KEY)
    nonce = os.urandom(12)
    ciphertext = aesgcm.encrypt(nonce, plaintext, None)
    return base64.b64encode(nonce + ciphertext).decode()


def decrypt_credentials(encrypted: Optional[str]) -> Optional[dict]:
    """
    Decrypt a base64-encoded ciphertext string back to a credentials dict.
    Returns None if encrypted is None.
    Handles legacy plaintext JSON (for migration from unencrypted storage).
    """
    if encrypted is None:
        return None
    if not _HAS_CRYPTO:
        try:
            return json.loads(encrypted)
        except Exception:
            return None

    # Try to decrypt
    try:
        raw = base64.b64decode(encrypted)
        nonce, ciphertext = raw[:12], raw[12:]
        aesgcm = AESGCM(_KEY)
        plaintext = aesgcm.decrypt(nonce, ciphertext, None)
        return json.loads(plaintext)
    except Exception:
        # Fallback: treat as legacy plaintext JSON (migration path)
        try:
            return json.loads(encrypted)
        except Exception:
            return None
