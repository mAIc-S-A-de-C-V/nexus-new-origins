"""
TOTP-based MFA utilities for admin accounts.
ISO 27001 Annex A.8.5 — Secure authentication

Uses pyotp for TOTP generation/verification.
"""
import os
import pyotp
import base64
from typing import Optional


def generate_totp_secret() -> str:
    """Generate a new random TOTP secret (base32-encoded)."""
    return pyotp.random_base32()


def get_totp_uri(secret: str, email: str, issuer: str = "Nexus") -> str:
    """Return an otpauth:// URI for QR code generation."""
    totp = pyotp.TOTP(secret)
    return totp.provisioning_uri(name=email, issuer_name=issuer)


def verify_totp(secret: str, code: str) -> bool:
    """Verify a TOTP code. Allows ±1 window for clock skew."""
    if not secret or not code:
        return False
    totp = pyotp.TOTP(secret)
    return totp.verify(code, valid_window=1)
