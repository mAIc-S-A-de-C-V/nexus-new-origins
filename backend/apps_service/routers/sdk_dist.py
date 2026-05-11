"""
Private SDK + CLI distribution.

The platform's SDK never appears on any registry (public or private). It
ships inside this service. Developers authenticate against the platform
to download it; the SDK then vendors into their project so subsequent
`npm install` never reaches out for it.

Endpoints (all auth-required):
  GET /sdk/manifest              — list available versions
  GET /sdk/tarball/{version}     — npm-packed tarball bytes (.tgz)
  GET /sdk/tarball/latest        — alias to whatever version `latest` points at
  GET /cli/nexus-app             — the CLI Node script as text/javascript
  GET /cli/install.sh            — shell bootstrapper that prompts for creds and pulls the CLI
"""
from __future__ import annotations
import json
import os
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse, PlainTextResponse, Response

from shared.auth_middleware import require_auth, AuthUser


SDK_DIST_ROOT = Path(os.environ.get("SDK_DIST_PATH", "/opt/sdk-dist"))
CLI_PATH = Path(os.environ.get("CLI_PATH", "/opt/cli/nexus-app"))


router = APIRouter()


def _list_versions() -> list[dict]:
    if not SDK_DIST_ROOT.exists():
        return []
    out: list[dict] = []
    for child in sorted(SDK_DIST_ROOT.iterdir()):
        if child.is_symlink():
            continue
        if not child.is_dir():
            continue
        if not child.name.startswith("v"):
            continue
        manifest = child / "manifest.json"
        if manifest.exists():
            try:
                data = json.loads(manifest.read_text())
                out.append(data)
            except Exception:
                continue
    return out


@router.get("/sdk/manifest")
async def sdk_manifest(user: AuthUser = Depends(require_auth)):
    versions = _list_versions()
    latest_symlink = SDK_DIST_ROOT / "latest"
    latest_version: str | None = None
    if latest_symlink.exists():
        target = latest_symlink.resolve().name
        if target.startswith("v"):
            latest_version = target[1:]
    if not latest_version and versions:
        latest_version = versions[-1]["version"]
    return {
        "service": "apps-service",
        "latest": latest_version,
        "versions": versions,
    }


@router.get("/sdk/tarball/{version}")
async def sdk_tarball(version: str, user: AuthUser = Depends(require_auth)):
    """
    Returns the npm-compatible .tgz for the requested SDK version.
    `version` is either a semver string or the literal "latest".
    """
    if version == "latest":
        sub = SDK_DIST_ROOT / "latest"
    else:
        sub = SDK_DIST_ROOT / f"v{version.lstrip('v')}"
    if not sub.exists():
        raise HTTPException(404, f"SDK version {version} not found")
    tarball = sub / "nexus-app-sdk.tgz"
    if not tarball.exists():
        raise HTTPException(404, "tarball missing")
    return FileResponse(
        tarball,
        media_type="application/gzip",
        filename="nexus-app-sdk.tgz",
    )


@router.get("/cli/nexus-app", response_class=PlainTextResponse)
async def cli_script(user: AuthUser = Depends(require_auth)):
    """The CLI Node script. Auth-only — never publicly readable."""
    if not CLI_PATH.exists():
        raise HTTPException(500, "CLI binary not installed in image")
    content = CLI_PATH.read_text(encoding="utf-8")
    return Response(content, media_type="text/javascript")


_INSTALL_SH = """#!/bin/sh
# Nexus CLI bootstrap installer.
# Authenticates against your tenant's apps-service and downloads the CLI.
# The CLI itself (and the SDK it pulls) never leaves the platform's auth
# boundary.
set -eu

if [ -z "${NEXUS_APPS_URL:-}" ]; then
  printf "Nexus apps URL (e.g. https://apps.your-nexus.example): "
  read NEXUS_APPS_URL
fi
if [ -z "${NEXUS_TENANT_ID:-}" ]; then
  printf "Tenant id (e.g. tenant-001): "
  read NEXUS_TENANT_ID
fi
if [ -z "${NEXUS_AUTH_URL:-}" ]; then
  NEXUS_AUTH_URL="${NEXUS_APPS_URL%%/apps*}"
  # Heuristic: strip trailing /apps to find auth host. Fall back to ask.
  case "$NEXUS_AUTH_URL" in *apps*)
    printf "Nexus auth URL (e.g. https://auth.your-nexus.example): "
    read NEXUS_AUTH_URL
  ;; esac
fi

printf "Email: "
read EMAIL
stty -echo
printf "Password: "
read PASSWORD
stty echo
printf "\\n"

LOGIN_BODY=$(printf '{"email":"%s","password":"%s","tenant_id":"%s"}' \
              "$EMAIL" "$PASSWORD" "$NEXUS_TENANT_ID")
TOKEN=$(curl -fsS -X POST "$NEXUS_AUTH_URL/auth/login" \
         -H "Content-Type: application/json" -d "$LOGIN_BODY" \
         | sed -n 's/.*"access_token":"\\([^"]*\\)".*/\\1/p')
if [ -z "$TOKEN" ]; then
  echo "login failed" >&2; exit 1
fi

INSTALL_DIR="${HOME}/.nexus/bin"
mkdir -p "$INSTALL_DIR" "${HOME}/.nexus"

# Persist credentials so the CLI can reuse them without prompting.
cat > "${HOME}/.nexus/credentials.json" <<EOF
{
  "apps_url":  "$NEXUS_APPS_URL",
  "auth_url":  "$NEXUS_AUTH_URL",
  "tenant_id": "$NEXUS_TENANT_ID",
  "email":     "$EMAIL",
  "token":     "$TOKEN"
}
EOF
chmod 600 "${HOME}/.nexus/credentials.json"

curl -fsS -H "Authorization: Bearer $TOKEN" \
     "$NEXUS_APPS_URL/cli/nexus-app" -o "$INSTALL_DIR/nexus-app"
chmod +x "$INSTALL_DIR/nexus-app"

echo "Installed nexus-app to $INSTALL_DIR/nexus-app"
echo "Add to PATH:  export PATH=\\"$INSTALL_DIR:\\$PATH\\""
"""


@router.get("/cli/install.sh", response_class=PlainTextResponse)
async def install_sh():
    """
    Public bootstrap — does nothing useful without valid Nexus credentials.
    Asks the developer for their tenant URL + email + password, calls
    auth-service, persists the resulting token, then pulls the CLI binary.

    This script contains no platform IP; the CLI and SDK live behind auth.
    """
    return Response(_INSTALL_SH, media_type="text/x-shellscript")
