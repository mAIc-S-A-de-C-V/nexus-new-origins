"""
OIDC provider config + token exchange helpers.
Supports Google, Okta, and Azure AD.
Provider configs are read from environment variables at runtime.
"""
import os
import httpx
from typing import Optional

PROVIDERS = {
    "google": {
        "client_id": os.environ.get("GOOGLE_CLIENT_ID", ""),
        "client_secret": os.environ.get("GOOGLE_CLIENT_SECRET", ""),
        "authorization_endpoint": "https://accounts.google.com/o/oauth2/v2/auth",
        "token_endpoint": "https://oauth2.googleapis.com/token",
        "userinfo_endpoint": "https://openidconnect.googleapis.com/v1/userinfo",
        "scopes": "openid email profile",
    },
    "okta": {
        "client_id": os.environ.get("OKTA_CLIENT_ID", ""),
        "client_secret": os.environ.get("OKTA_CLIENT_SECRET", ""),
        "base_url": os.environ.get("OKTA_BASE_URL", ""),  # e.g. https://dev-xxx.okta.com
        "scopes": "openid email profile",
    },
    "azure": {
        "client_id": os.environ.get("AZURE_CLIENT_ID", ""),
        "client_secret": os.environ.get("AZURE_CLIENT_SECRET", ""),
        "tenant": os.environ.get("AZURE_TENANT_ID", "common"),
        "scopes": "openid email profile",
    },
}

APP_BASE_URL = os.environ.get("APP_BASE_URL", "http://localhost:3000")


def get_authorization_url(
    provider: str,
    state: str,
    code_challenge: str = "",
    code_challenge_method: str = "S256",
) -> str:
    redirect_uri = f"{APP_BASE_URL}/auth/callback/{provider}"
    cfg = PROVIDERS.get(provider)
    if not cfg:
        raise ValueError(f"Unknown provider: {provider}")

    pkce_suffix = ""
    if code_challenge:
        pkce_suffix = f"&code_challenge={code_challenge}&code_challenge_method={code_challenge_method}"

    if provider == "google":
        params = (
            f"?client_id={cfg['client_id']}"
            f"&redirect_uri={redirect_uri}"
            f"&response_type=code"
            f"&scope={cfg['scopes'].replace(' ', '%20')}"
            f"&state={state}"
            "&access_type=offline"
        )
        return cfg["authorization_endpoint"] + params + pkce_suffix

    if provider == "okta":
        base = cfg["base_url"].rstrip("/")
        params = (
            f"?client_id={cfg['client_id']}"
            f"&redirect_uri={redirect_uri}"
            f"&response_type=code"
            f"&scope={cfg['scopes'].replace(' ', '%20')}"
            f"&state={state}"
        )
        return f"{base}/oauth2/v1/authorize{params}{pkce_suffix}"

    if provider == "azure":
        tenant = cfg["tenant"]
        params = (
            f"?client_id={cfg['client_id']}"
            f"&redirect_uri={redirect_uri}"
            f"&response_type=code"
            f"&scope={cfg['scopes'].replace(' ', '%20')}"
            f"&state={state}"
        )
        return f"https://login.microsoftonline.com/{tenant}/oauth2/v2.0/authorize{params}{pkce_suffix}"

    raise ValueError(f"Unsupported provider: {provider}")


async def exchange_code(provider: str, code: str, code_verifier: str = "") -> dict:
    """Exchange authorization code for user info. Returns {'email', 'name', 'sub'}."""
    redirect_uri = f"{APP_BASE_URL}/auth/callback/{provider}"
    cfg = PROVIDERS[provider]

    if provider == "google":
        async with httpx.AsyncClient() as client:
            token_data = {
                "code": code,
                "client_id": cfg["client_id"],
                "client_secret": cfg["client_secret"],
                "redirect_uri": redirect_uri,
                "grant_type": "authorization_code",
            }
            if code_verifier:
                token_data["code_verifier"] = code_verifier
            token_resp = await client.post(cfg["token_endpoint"], data=token_data)
            token_resp.raise_for_status()
            tokens = token_resp.json()

            user_resp = await client.get(
                cfg["userinfo_endpoint"],
                headers={"Authorization": f"Bearer {tokens['access_token']}"},
            )
            user_resp.raise_for_status()
            info = user_resp.json()
            return {"email": info["email"], "name": info.get("name", info["email"]), "sub": info["sub"]}

    if provider == "okta":
        base = cfg["base_url"].rstrip("/")
        async with httpx.AsyncClient() as client:
            token_data = {
                "code": code,
                "client_id": cfg["client_id"],
                "client_secret": cfg["client_secret"],
                "redirect_uri": redirect_uri,
                "grant_type": "authorization_code",
            }
            if code_verifier:
                token_data["code_verifier"] = code_verifier
            token_resp = await client.post(f"{base}/oauth2/v1/token", data=token_data)
            token_resp.raise_for_status()
            tokens = token_resp.json()

            user_resp = await client.get(
                f"{base}/oauth2/v1/userinfo",
                headers={"Authorization": f"Bearer {tokens['access_token']}"},
            )
            user_resp.raise_for_status()
            info = user_resp.json()
            return {"email": info["email"], "name": info.get("name", info["email"]), "sub": info["sub"]}

    if provider == "azure":
        tenant = cfg["tenant"]
        async with httpx.AsyncClient() as client:
            token_data = {
                "code": code,
                "client_id": cfg["client_id"],
                "client_secret": cfg["client_secret"],
                "redirect_uri": redirect_uri,
                "grant_type": "authorization_code",
                "scope": cfg["scopes"],
            }
            if code_verifier:
                token_data["code_verifier"] = code_verifier
            token_resp = await client.post(
                f"https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token",
                data=token_data,
            )
            token_resp.raise_for_status()
            tokens = token_resp.json()

            user_resp = await client.get(
                "https://graph.microsoft.com/oidc/userinfo",
                headers={"Authorization": f"Bearer {tokens['access_token']}"},
            )
            user_resp.raise_for_status()
            info = user_resp.json()
            return {
                "email": info.get("email", info.get("preferred_username", "")),
                "name": info.get("name", ""),
                "sub": info.get("sub", ""),
            }

    raise ValueError(f"Unsupported provider: {provider}")
