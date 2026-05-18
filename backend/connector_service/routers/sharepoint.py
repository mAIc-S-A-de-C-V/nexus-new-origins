"""
SharePoint-specific routes for the connector service.

Two routers:
  - `router`         — tenant-scoped, auth-gated. Mounted at /connectors/{id}/sharepoint/*.
                       Used by the SharePoint setup modal to list sites/drives/items
                       and to initiate the OAuth flow.
  - `public_router`  — public (no auth). Mounted at /sharepoint/oauth/callback.
                       Azure AD redirects the user-agent here with `?code=...&state=...`.
                       The state is an HMAC-signed token that maps back to the
                       connector + tenant.

State token format (URL-safe base64):
    base64( json({"cid": connector_id, "tid": tenant_id, "exp": unix_seconds}) )
    + "."
    + hex(hmac_sha256(key, payload))

The HMAC key is derived from CREDENTIAL_ENCRYPTION_KEY so secret material is
not duplicated. State tokens are short-lived (10 minutes).
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import time
from typing import Any, Optional
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Header, Query, Depends
from fastapi.responses import HTMLResponse, JSONResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from database import ConnectorRow, get_session
from credential_crypto import encrypt_credentials, decrypt_credentials
from sharepoint_connector import (
    apply_token_response,
    build_authorize_url,
    download_item,
    exchange_code_for_tokens,
    GraphError,
    list_drives,
    list_items,
    list_sites,
)


router = APIRouter()
public_router = APIRouter()


STATE_TTL_SEC = 600  # 10 minutes
_STATE_KEY = hashlib.sha256(
    ("sharepoint-state::" + os.environ.get("CREDENTIAL_ENCRYPTION_KEY", "0" * 64)).encode()
).digest()


# ── State helpers ────────────────────────────────────────────────────────────

def _sign_state(connector_id: str, tenant_id: str) -> str:
    payload = {"cid": connector_id, "tid": tenant_id, "exp": int(time.time()) + STATE_TTL_SEC}
    body = base64.urlsafe_b64encode(json.dumps(payload).encode()).rstrip(b"=").decode()
    sig = hmac.new(_STATE_KEY, body.encode(), hashlib.sha256).hexdigest()
    return f"{body}.{sig}"


def _verify_state(state: str) -> dict:
    try:
        body, sig = state.split(".", 1)
    except ValueError:
        raise HTTPException(400, "Malformed state token")
    expected = hmac.new(_STATE_KEY, body.encode(), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, sig):
        raise HTTPException(400, "Invalid state signature")
    try:
        padded = body + "=" * (4 - len(body) % 4)
        payload = json.loads(base64.urlsafe_b64decode(padded))
    except Exception:
        raise HTTPException(400, "Malformed state payload")
    if int(payload.get("exp", 0)) < int(time.time()):
        raise HTTPException(400, "State token expired — restart the OAuth flow")
    return payload


# ── Loader ───────────────────────────────────────────────────────────────────

async def _load_connector(db: AsyncSession, connector_id: str, tenant_id: str) -> ConnectorRow:
    result = await db.execute(
        select(ConnectorRow).where(
            ConnectorRow.id == connector_id,
            ConnectorRow.tenant_id == tenant_id,
        )
    )
    row = result.scalar_one_or_none()
    if not row:
        raise HTTPException(404, "Connector not found")
    if row.type != "SHAREPOINT":
        raise HTTPException(400, f"Connector is not SHAREPOINT (got {row.type})")
    return row


async def _save_credentials(db: AsyncSession, row: ConnectorRow, creds: dict) -> None:
    row.credentials = encrypt_credentials(creds)
    row.updated_at = datetime.now(timezone.utc)
    await db.commit()


# ── Auth-gated routes ────────────────────────────────────────────────────────

@router.post("/{connector_id}/sharepoint/oauth/start")
async def oauth_start(
    connector_id: str,
    x_tenant_id: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_session),
):
    """Return the Azure AD authorize URL the user should be redirected to."""
    tenant_id = x_tenant_id or "tenant-001"
    row = await _load_connector(db, connector_id, tenant_id)
    creds = decrypt_credentials(row.credentials) or {}
    if not creds.get("client_id") or not creds.get("client_secret"):
        raise HTTPException(400, "Connector is missing client_id / client_secret — save them first.")
    if not creds.get("redirect_uri"):
        raise HTTPException(400, "Connector is missing redirect_uri.")

    state = _sign_state(connector_id, tenant_id)
    try:
        auth_url = build_authorize_url(creds, state=state)
    except ValueError as e:
        raise HTTPException(400, str(e))
    return {"authorize_url": auth_url, "state": state, "expires_in": STATE_TTL_SEC}


@router.get("/{connector_id}/sharepoint/sites")
async def sp_list_sites(
    connector_id: str,
    search: str = Query("", description="Optional site name filter"),
    x_tenant_id: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_session),
):
    tenant_id = x_tenant_id or "tenant-001"
    row = await _load_connector(db, connector_id, tenant_id)
    creds = decrypt_credentials(row.credentials) or {}
    cfg = row.config or {}
    try:
        sites = await list_sites(creds, cfg, search=search)
    except GraphError as e:
        raise HTTPException(502, f"Graph API {e.status}: {e.body[:200]}")
    except RuntimeError as e:
        raise HTTPException(400, str(e))
    return {"sites": sites}


@router.get("/{connector_id}/sharepoint/drives")
async def sp_list_drives(
    connector_id: str,
    site_id: str = Query(..., description="SharePoint site ID"),
    x_tenant_id: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_session),
):
    tenant_id = x_tenant_id or "tenant-001"
    row = await _load_connector(db, connector_id, tenant_id)
    creds = decrypt_credentials(row.credentials) or {}
    cfg = row.config or {}
    try:
        drives = await list_drives(creds, cfg, site_id)
    except GraphError as e:
        raise HTTPException(502, f"Graph API {e.status}: {e.body[:200]}")
    except RuntimeError as e:
        raise HTTPException(400, str(e))
    return {"drives": drives}


@router.get("/{connector_id}/sharepoint/items")
async def sp_list_items(
    connector_id: str,
    drive_id: str = Query(..., description="Drive ID"),
    folder_id: Optional[str] = Query(None, description="Folder ID; omit or 'root' for drive root"),
    x_tenant_id: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_session),
):
    tenant_id = x_tenant_id or "tenant-001"
    row = await _load_connector(db, connector_id, tenant_id)
    creds = decrypt_credentials(row.credentials) or {}
    cfg = row.config or {}
    try:
        items = await list_items(creds, cfg, drive_id, folder_id)
    except GraphError as e:
        raise HTTPException(502, f"Graph API {e.status}: {e.body[:200]}")
    except RuntimeError as e:
        raise HTTPException(400, str(e))
    return items  # {folders: [...], files: [...]}


@router.get("/{connector_id}/sharepoint/items/{item_id}/download")
async def sp_download(
    connector_id: str,
    item_id: str,
    drive_id: str = Query(..., description="Drive ID containing the item"),
    x_tenant_id: Optional[str] = Header(None),
    db: AsyncSession = Depends(get_session),
):
    tenant_id = x_tenant_id or "tenant-001"
    row = await _load_connector(db, connector_id, tenant_id)
    creds = decrypt_credentials(row.credentials) or {}
    cfg = row.config or {}
    try:
        content, mime, name = await download_item(creds, cfg, drive_id, item_id)
    except GraphError as e:
        raise HTTPException(502, f"Graph API {e.status}: {e.body[:200]}")
    except RuntimeError as e:
        raise HTTPException(400, str(e))
    from fastapi.responses import Response
    return Response(
        content=content,
        media_type=mime,
        headers={"Content-Disposition": f'inline; filename="{name}"'},
    )


# ── Public OAuth callback ────────────────────────────────────────────────────

_CALLBACK_HTML_OK = """<!doctype html><html><head><meta charset="utf-8">
<title>SharePoint connected</title></head><body style="font:14px system-ui;padding:32px">
<h2>SharePoint connector is connected.</h2>
<p>You can close this window.</p>
<script>
  if (window.opener) {{
    try {{ window.opener.postMessage({{type:"sharepoint:connected",connector_id:"{cid}"}}, "*"); }} catch (e) {{}}
    setTimeout(function(){{window.close();}}, 800);
  }}
</script></body></html>"""


_CALLBACK_HTML_ERR = """<!doctype html><html><head><meta charset="utf-8">
<title>SharePoint connection failed</title></head><body style="font:14px system-ui;padding:32px">
<h2>SharePoint connection failed</h2>
<p>{msg}</p>
<p>Close this window and try again from Nexus.</p>
<script>
  if (window.opener) {{
    try {{ window.opener.postMessage({{type:"sharepoint:error",message:{msg_js}}}, "*"); }} catch (e) {{}}
  }}
</script></body></html>"""


@public_router.get("/oauth/callback")
async def oauth_callback(
    code: Optional[str] = Query(None),
    state: Optional[str] = Query(None),
    error: Optional[str] = Query(None),
    error_description: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_session),
):
    """
    Azure AD redirects the user-agent here after consent. We validate `state`,
    look up the connector by ID + tenant, exchange `code` for tokens, save them
    encrypted on the connector, and return an HTML page that closes the popup
    and notifies the opener.
    """
    if error:
        msg = error_description or error
        return HTMLResponse(
            _CALLBACK_HTML_ERR.format(msg=msg, msg_js=json.dumps(msg)),
            status_code=400,
        )
    if not code or not state:
        return HTMLResponse(
            _CALLBACK_HTML_ERR.format(
                msg="Missing code or state", msg_js=json.dumps("Missing code or state"),
            ),
            status_code=400,
        )

    payload = _verify_state(state)
    connector_id, tenant_id = payload["cid"], payload["tid"]

    result = await db.execute(
        select(ConnectorRow).where(
            ConnectorRow.id == connector_id,
            ConnectorRow.tenant_id == tenant_id,
        )
    )
    row = result.scalar_one_or_none()
    if not row:
        return HTMLResponse(
            _CALLBACK_HTML_ERR.format(
                msg="Connector not found", msg_js=json.dumps("Connector not found"),
            ),
            status_code=404,
        )

    creds = decrypt_credentials(row.credentials) or {}
    try:
        token_resp = await exchange_code_for_tokens(creds, code)
    except RuntimeError as e:
        return HTMLResponse(
            _CALLBACK_HTML_ERR.format(msg=str(e), msg_js=json.dumps(str(e))),
            status_code=400,
        )

    creds = apply_token_response(creds, token_resp)
    row.credentials = encrypt_credentials(creds)
    row.status = "active"
    row.updated_at = datetime.now(timezone.utc)
    await db.commit()

    return HTMLResponse(_CALLBACK_HTML_OK.format(cid=connector_id))
