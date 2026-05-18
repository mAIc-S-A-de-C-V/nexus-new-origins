"""
Microsoft SharePoint connector via Graph API.

Per-tenant Azure AD apps: each Nexus tenant registers their own multi-tenant
Azure AD app and supplies its client_id, client_secret, and Azure tenant ID
when creating the connector. The OAuth2 authorization-code flow then issues
an access token + refresh token that this connector stores (encrypted) on
the connector row.

Credentials shape (on connector.credentials, after encryption):
    {
      "client_id":      "<azure app client id>",
      "client_secret":  "<azure app client secret>",
      "tenant_id":      "<azure AD tenant id — guid or 'common'>",
      "redirect_uri":   "https://nexus.example.com/api/connectors/sharepoint/oauth/callback",
      "access_token":   "<set after OAuth callback>",
      "refresh_token":  "<set after OAuth callback>",
      "expires_at":     "<ISO8601 timestamp>",
      "scope":          "Files.Read.All Sites.Read.All offline_access"
    }

Connector.config shape:
    {
      "site_id":   "<chosen site id>",      # optional until user picks
      "drive_id":  "<chosen drive id>",     # optional until user picks
      "root_folder_id": "<optional folder>",
      "demoMode":  false,                   # if true, all calls return synthetic data
      "max_items": 5000
    }

Demo mode: When config.demoMode is true, no Graph API calls are made — the
module returns deterministic synthetic data. This lets the connector work
end-to-end in tests and demos without a real Azure tenant.

Required Graph API permissions (delegated):
    - Files.Read.All
    - Sites.Read.All
    - offline_access  (for refresh tokens)
"""
from __future__ import annotations

import asyncio
import hashlib
import logging
import urllib.parse
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

import httpx

logger = logging.getLogger(__name__)

GRAPH_BASE = "https://graph.microsoft.com/v1.0"
AUTH_BASE = "https://login.microsoftonline.com"
DEFAULT_SCOPE = "Files.Read.All Sites.Read.All offline_access"
TOKEN_REFRESH_THRESHOLD_SEC = 60  # refresh if expiring within this window


# ── Demo (mock) data ─────────────────────────────────────────────────────────

def _mk_id(prefix: str, *parts: str) -> str:
    h = hashlib.sha1("|".join(parts).encode()).hexdigest()[:16]
    return f"{prefix}!{h}"


# Synthetic site → drive → folder tree, used when config.demoMode is true.
# Built once at import time, deterministic.
def _build_demo_tree() -> dict[str, Any]:
    site_id = _mk_id("site", "maic", "primary")
    drive_id = _mk_id("drive", site_id, "documents")

    files: list[dict] = []
    folders: list[dict] = []

    def add_folder(name: str, parent_id: Optional[str], path: str) -> str:
        fid = _mk_id("folder", drive_id, path)
        folders.append({
            "id": fid,
            "name": name,
            "parent_id": parent_id,
            "drive_id": drive_id,
            "path": path,
            "item_count": 0,  # filled below
            "last_modified": (datetime.now(timezone.utc) - timedelta(days=3)).isoformat(),
            "web_url": f"https://maic.sharepoint.com/sites/maic/Shared%20Documents/{urllib.parse.quote(path.strip('/'))}",
        })
        return fid

    def add_file(name: str, parent_id: str, path: str, size: int, mime: str) -> None:
        files.append({
            "id": _mk_id("file", drive_id, path, name),
            "name": name,
            "parent_id": parent_id,
            "drive_id": drive_id,
            "path": f"{path}/{name}".lstrip("/"),
            "size": size,
            "mime_type": mime,
            "last_modified": (datetime.now(timezone.utc) - timedelta(days=1)).isoformat(),
            "created_at": (datetime.now(timezone.utc) - timedelta(days=30)).isoformat(),
            "web_url": (
                f"https://maic.sharepoint.com/sites/maic/Shared%20Documents/"
                f"{urllib.parse.quote(f'{path}/{name}'.strip('/'))}"
            ),
            "etag": _mk_id("etag", path, name)[:12],
        })

    # Tree
    root_id = add_folder("root", None, "/")
    clients_id = add_folder("Clients", root_id, "/Clients")
    internal_id = add_folder("Internal", root_id, "/Internal")
    templates_id = add_folder("Templates", root_id, "/Templates")

    acme_id = add_folder("Acme Corp", clients_id, "/Clients/Acme Corp")
    bayfront_id = add_folder("Bayfront Logistics", clients_id, "/Clients/Bayfront Logistics")
    cedar_id = add_folder("Cedar Industrial", clients_id, "/Clients/Cedar Industrial")

    hr_id = add_folder("HR", internal_id, "/Internal/HR")
    finance_id = add_folder("Finance", internal_id, "/Internal/Finance")

    add_file("Contract.pdf",  acme_id,     "/Clients/Acme Corp",          412_338, "application/pdf")
    add_file("Proposal.docx", acme_id,     "/Clients/Acme Corp",           87_104, "application/vnd.openxmlformats-officedocument.wordprocessingml.document")
    add_file("MSA.pdf",       acme_id,     "/Clients/Acme Corp",          291_009, "application/pdf")
    add_file("Contract.pdf",  bayfront_id, "/Clients/Bayfront Logistics", 388_211, "application/pdf")
    add_file("SOW.docx",      bayfront_id, "/Clients/Bayfront Logistics",  62_447, "application/vnd.openxmlformats-officedocument.wordprocessingml.document")
    add_file("Contract.pdf",  cedar_id,    "/Clients/Cedar Industrial",   401_822, "application/pdf")

    add_file("Handbook.pdf",   hr_id,      "/Internal/HR",                812_004, "application/pdf")
    add_file("Q1-Report.xlsx", finance_id, "/Internal/Finance",           248_300, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")

    add_file("Contract-Template.docx", templates_id, "/Templates",  72_991, "application/vnd.openxmlformats-officedocument.wordprocessingml.document")
    add_file("Proposal-Template.pptx", templates_id, "/Templates", 384_117, "application/vnd.openxmlformats-officedocument.presentationml.presentation")

    # Fill folder item_count
    for fld in folders:
        children = sum(1 for f in files if f["parent_id"] == fld["id"])
        children += sum(1 for sub in folders if sub["parent_id"] == fld["id"])
        fld["item_count"] = children

    return {
        "site": {
            "id": site_id,
            "name": "MAIC",
            "display_name": "MAIC SharePoint",
            "web_url": "https://maic.sharepoint.com/sites/maic",
            "description": "Primary MAIC SharePoint site (demo data).",
        },
        "drive": {
            "id": drive_id,
            "site_id": site_id,
            "name": "Documents",
            "drive_type": "documentLibrary",
            "web_url": "https://maic.sharepoint.com/sites/maic/Shared%20Documents",
        },
        "folders": folders,
        "files": files,
        "root_folder_id": root_id,
    }


_DEMO_TREE = _build_demo_tree()


# ── Token management ─────────────────────────────────────────────────────────

def build_authorize_url(creds: dict, state: str, redirect_uri: Optional[str] = None) -> str:
    """Construct the Azure AD authorize URL the user is redirected to."""
    client_id = creds["client_id"]
    azure_tenant = creds.get("tenant_id") or "common"
    redirect = redirect_uri or creds.get("redirect_uri")
    if not redirect:
        raise ValueError("redirect_uri is required (on credentials or as argument)")
    params = {
        "client_id": client_id,
        "response_type": "code",
        "redirect_uri": redirect,
        "response_mode": "query",
        "scope": creds.get("scope") or DEFAULT_SCOPE,
        "state": state,
        "prompt": "select_account",
    }
    return f"{AUTH_BASE}/{azure_tenant}/oauth2/v2.0/authorize?{urllib.parse.urlencode(params)}"


async def exchange_code_for_tokens(creds: dict, code: str,
                                   redirect_uri: Optional[str] = None) -> dict:
    """Exchange an auth code for access + refresh tokens. Returns the token doc."""
    azure_tenant = creds.get("tenant_id") or "common"
    redirect = redirect_uri or creds.get("redirect_uri")
    if not redirect:
        raise ValueError("redirect_uri is required")

    data = {
        "client_id": creds["client_id"],
        "client_secret": creds["client_secret"],
        "code": code,
        "redirect_uri": redirect,
        "grant_type": "authorization_code",
        "scope": creds.get("scope") or DEFAULT_SCOPE,
    }
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.post(
            f"{AUTH_BASE}/{azure_tenant}/oauth2/v2.0/token",
            data=data,
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )
        if not r.is_success:
            raise RuntimeError(
                f"Token exchange failed: {r.status_code} {r.text[:400]}"
            )
        return r.json()


async def refresh_access_token(creds: dict) -> dict:
    """Use refresh_token to get a fresh access_token. Returns the token doc."""
    if not creds.get("refresh_token"):
        raise RuntimeError("No refresh_token on this connector — re-authorize")
    azure_tenant = creds.get("tenant_id") or "common"
    data = {
        "client_id": creds["client_id"],
        "client_secret": creds["client_secret"],
        "refresh_token": creds["refresh_token"],
        "grant_type": "refresh_token",
        "scope": creds.get("scope") or DEFAULT_SCOPE,
    }
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.post(
            f"{AUTH_BASE}/{azure_tenant}/oauth2/v2.0/token",
            data=data,
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )
        if not r.is_success:
            raise RuntimeError(
                f"Token refresh failed: {r.status_code} {r.text[:400]}"
            )
        return r.json()


def _is_token_expired(creds: dict) -> bool:
    exp = creds.get("expires_at")
    if not exp:
        return True
    try:
        exp_dt = datetime.fromisoformat(exp.replace("Z", "+00:00"))
    except (ValueError, AttributeError):
        return True
    return datetime.now(timezone.utc) >= (exp_dt - timedelta(seconds=TOKEN_REFRESH_THRESHOLD_SEC))


def apply_token_response(creds: dict, token_resp: dict) -> dict:
    """Merge a token response from Azure into the credentials dict and return it."""
    expires_in = int(token_resp.get("expires_in", 3600))
    new_expiry = datetime.now(timezone.utc) + timedelta(seconds=expires_in)
    creds = dict(creds)  # copy
    creds["access_token"] = token_resp["access_token"]
    if token_resp.get("refresh_token"):
        creds["refresh_token"] = token_resp["refresh_token"]
    creds["expires_at"] = new_expiry.isoformat()
    if token_resp.get("scope"):
        creds["scope"] = token_resp["scope"]
    return creds


async def ensure_valid_token(creds: dict) -> tuple[dict, bool]:
    """
    Return (creds, refreshed). If the access_token is expired or expiring soon,
    refresh it. The caller is responsible for persisting `creds` back to the
    connector row if `refreshed` is True.
    """
    if not _is_token_expired(creds):
        return creds, False
    if not creds.get("refresh_token"):
        raise RuntimeError("Access token expired and no refresh_token available")
    token_resp = await refresh_access_token(creds)
    return apply_token_response(creds, token_resp), True


# ── Graph API client ─────────────────────────────────────────────────────────

class GraphError(Exception):
    def __init__(self, status: int, body: str) -> None:
        self.status = status
        self.body = body
        super().__init__(f"Graph API {status}: {body[:300]}")


async def _graph_get(token: str, path: str, params: Optional[dict] = None,
                     timeout: int = 30, retries: int = 2) -> Any:
    """GET against Graph API. Handles 429 + 503 with exponential backoff."""
    url = path if path.startswith("http") else f"{GRAPH_BASE}{path}"
    delay = 1.0
    last_exc: Optional[Exception] = None
    for attempt in range(retries + 1):
        try:
            async with httpx.AsyncClient(timeout=timeout) as client:
                r = await client.get(
                    url,
                    params=params or None,
                    headers={"Authorization": f"Bearer {token}"},
                )
            if r.status_code in (429, 503) and attempt < retries:
                retry_after = float(r.headers.get("Retry-After", str(delay)))
                await asyncio.sleep(min(retry_after, 30))
                delay *= 2
                continue
            if not r.is_success:
                raise GraphError(r.status_code, r.text)
            return r.json()
        except (httpx.TimeoutException, httpx.ConnectError) as e:
            last_exc = e
            if attempt < retries:
                await asyncio.sleep(delay)
                delay *= 2
                continue
            raise
    if last_exc:
        raise last_exc


# ── Public API: site/drive/item listing ──────────────────────────────────────

async def list_sites(creds: dict, cfg: dict, *, search: str = "") -> list[dict]:
    """List SharePoint sites the user has access to."""
    if cfg.get("demoMode"):
        return [_DEMO_TREE["site"]]
    creds, _ = await ensure_valid_token(creds)
    params = {"search": search} if search else None
    resp = await _graph_get(creds["access_token"], "/sites", params=params or {"search": "*"})
    sites = []
    for s in resp.get("value", []):
        sites.append({
            "id": s["id"],
            "name": s.get("name") or s.get("displayName") or s["id"],
            "display_name": s.get("displayName") or s.get("name") or "",
            "web_url": s.get("webUrl", ""),
            "description": s.get("description", ""),
        })
    return sites


async def list_drives(creds: dict, cfg: dict, site_id: str) -> list[dict]:
    """List drives (document libraries) in a site."""
    if cfg.get("demoMode"):
        if site_id == _DEMO_TREE["site"]["id"]:
            return [_DEMO_TREE["drive"]]
        return []
    creds, _ = await ensure_valid_token(creds)
    resp = await _graph_get(creds["access_token"], f"/sites/{site_id}/drives")
    drives = []
    for d in resp.get("value", []):
        drives.append({
            "id": d["id"],
            "site_id": site_id,
            "name": d.get("name", ""),
            "drive_type": d.get("driveType", ""),
            "web_url": d.get("webUrl", ""),
        })
    return drives


async def list_items(creds: dict, cfg: dict, drive_id: str,
                     folder_id: Optional[str] = None) -> dict:
    """
    List items (files + folders) under a drive folder. If folder_id is None
    or "root", lists the drive root. Returns {files: [...], folders: [...]}.
    """
    if cfg.get("demoMode"):
        if drive_id != _DEMO_TREE["drive"]["id"]:
            return {"files": [], "folders": []}
        target_id = folder_id if folder_id and folder_id != "root" else _DEMO_TREE["root_folder_id"]
        children_folders = [f for f in _DEMO_TREE["folders"] if f["parent_id"] == target_id]
        children_files = [f for f in _DEMO_TREE["files"] if f["parent_id"] == target_id]
        return {"folders": children_folders, "files": children_files}

    creds, _ = await ensure_valid_token(creds)
    if folder_id and folder_id != "root":
        path = f"/drives/{drive_id}/items/{folder_id}/children"
    else:
        path = f"/drives/{drive_id}/root/children"
    folders, files = [], []
    next_link: Optional[str] = path
    params: Optional[dict] = {"$top": 200}
    while next_link:
        resp = await _graph_get(creds["access_token"], next_link, params=params)
        for item in resp.get("value", []):
            if "folder" in item:
                folders.append(_normalize_folder(item, drive_id))
            elif "file" in item:
                files.append(_normalize_file(item, drive_id))
        next_link = resp.get("@odata.nextLink")
        params = None  # nextLink already contains query
    return {"folders": folders, "files": files}


def _normalize_folder(item: dict, drive_id: str) -> dict:
    pr = item.get("parentReference") or {}
    return {
        "id": item["id"],
        "name": item.get("name", ""),
        "parent_id": pr.get("id"),
        "drive_id": drive_id,
        "path": f"{pr.get('path', '')}/{item.get('name', '')}".replace("/drive/root:", ""),
        "item_count": (item.get("folder") or {}).get("childCount", 0),
        "last_modified": item.get("lastModifiedDateTime", ""),
        "web_url": item.get("webUrl", ""),
    }


def _normalize_file(item: dict, drive_id: str) -> dict:
    pr = item.get("parentReference") or {}
    f = item.get("file") or {}
    return {
        "id": item["id"],
        "name": item.get("name", ""),
        "parent_id": pr.get("id"),
        "drive_id": drive_id,
        "path": f"{pr.get('path', '')}/{item.get('name', '')}".replace("/drive/root:", ""),
        "size": item.get("size", 0),
        "mime_type": f.get("mimeType", ""),
        "last_modified": item.get("lastModifiedDateTime", ""),
        "created_at": item.get("createdDateTime", ""),
        "web_url": item.get("webUrl", ""),
        "etag": item.get("eTag", "").strip('"'),
    }


async def walk_drive(creds: dict, cfg: dict, drive_id: str,
                     folder_id: Optional[str] = None,
                     max_items: int = 5000) -> dict[str, list[dict]]:
    """Walk a drive recursively, yielding all folders + files (capped)."""
    all_folders: list[dict] = []
    all_files: list[dict] = []
    queue: list[Optional[str]] = [folder_id]
    visited: set[str] = set()
    while queue and (len(all_files) + len(all_folders)) < max_items:
        fid = queue.pop(0)
        key = fid or "root"
        if key in visited:
            continue
        visited.add(key)
        page = await list_items(creds, cfg, drive_id, fid)
        all_folders.extend(page["folders"])
        all_files.extend(page["files"])
        for sub in page["folders"]:
            queue.append(sub["id"])
    return {"folders": all_folders, "files": all_files}


async def download_item(creds: dict, cfg: dict, drive_id: str,
                        item_id: str) -> tuple[bytes, str, str]:
    """
    Download a file's content. Returns (bytes, mime_type, filename).
    In demo mode, returns a stub PDF.
    """
    if cfg.get("demoMode"):
        f = next((x for x in _DEMO_TREE["files"]
                  if x["id"] == item_id and x["drive_id"] == drive_id), None)
        if not f:
            raise RuntimeError(f"Demo file {item_id} not found")
        # Synthetic content — a tiny PDF-ish header so consumers can validate format
        content = (
            f"%PDF-1.4\n%Demo SharePoint content for {f['name']}\n"
            f"% size declared {f['size']}\n"
        ).encode()
        return content, f["mime_type"], f["name"]

    creds, _ = await ensure_valid_token(creds)
    # Two-step: fetch metadata to get name+mime, then GET content (which returns 302)
    meta = await _graph_get(creds["access_token"], f"/drives/{drive_id}/items/{item_id}")
    mime = (meta.get("file") or {}).get("mimeType", "application/octet-stream")
    name = meta.get("name", "file")
    async with httpx.AsyncClient(timeout=120, follow_redirects=True) as client:
        r = await client.get(
            f"{GRAPH_BASE}/drives/{drive_id}/items/{item_id}/content",
            headers={"Authorization": f"Bearer {creds['access_token']}"},
        )
        if not r.is_success:
            raise GraphError(r.status_code, r.text)
        return r.content, mime, name


# ── Schema discovery (for fetch_schema dispatch) ─────────────────────────────

# Object-type schemas produced by ingestion. Mirrors the shape other connectors
# return from fetch_schema(): a raw_schema dict + sample_rows list.

_FILE_FIELDS = [
    {"name": "id",             "type": "string"},
    {"name": "name",           "type": "string"},
    {"name": "parent_id",      "type": "string"},
    {"name": "drive_id",       "type": "string"},
    {"name": "path",           "type": "string"},
    {"name": "size",           "type": "integer"},
    {"name": "mime_type",      "type": "string"},
    {"name": "last_modified",  "type": "datetime"},
    {"name": "created_at",     "type": "datetime"},
    {"name": "web_url",        "type": "string"},
    {"name": "etag",           "type": "string"},
]

_FOLDER_FIELDS = [
    {"name": "id",             "type": "string"},
    {"name": "name",           "type": "string"},
    {"name": "parent_id",      "type": "string"},
    {"name": "drive_id",       "type": "string"},
    {"name": "path",           "type": "string"},
    {"name": "item_count",     "type": "integer"},
    {"name": "last_modified",  "type": "datetime"},
    {"name": "web_url",        "type": "string"},
]


async def fetch_schema(creds: dict, cfg: dict, *, db: Any = None,
                       last_sync: Any = None) -> tuple[dict, list, Optional[str]]:
    """
    Discover schema + return sample rows. Honors config.demoMode.

    If config has a drive_id, walks that drive (capped at config.max_items or 5000)
    and returns the actual files. Otherwise returns the schema with no samples —
    the user picks a drive in the UI first.
    """
    drive_id = cfg.get("drive_id")
    max_items = int(cfg.get("max_items") or 5000)

    if not drive_id:
        return (
            {
                "source": "sharepoint",
                "fields": {
                    "SharePointFile": {"fields": _FILE_FIELDS},
                    "SharePointFolder": {"fields": _FOLDER_FIELDS},
                },
                "message": "Select a site and drive to discover files.",
            },
            [],
            None,
        )

    try:
        tree = await walk_drive(creds, cfg, drive_id, max_items=max_items)
    except RuntimeError as e:
        return {}, [], str(e)
    except GraphError as e:
        return {}, [], f"Graph API error {e.status}: {e.body[:200]}"

    raw_schema = {
        "source": "sharepoint",
        "drive_id": drive_id,
        "total_files": len(tree["files"]),
        "total_folders": len(tree["folders"]),
        "fields": {
            "SharePointFile":   {"fields": _FILE_FIELDS,   "sample_count": min(len(tree["files"]), 5)},
            "SharePointFolder": {"fields": _FOLDER_FIELDS, "sample_count": min(len(tree["folders"]), 5)},
        },
    }
    # The connector framework expects a flat sample_rows list. Concatenate.
    sample_rows = [{"_type": "SharePointFolder", **f} for f in tree["folders"][:50]]
    sample_rows += [{"_type": "SharePointFile",   **f} for f in tree["files"][:200]]
    return raw_schema, sample_rows, None


async def test_connection(creds: dict, cfg: dict) -> tuple[bool, str]:
    """Quick connectivity test. In demo mode, always passes."""
    if cfg.get("demoMode"):
        return True, "Demo mode active — using synthetic data."
    if not creds.get("client_id") or not creds.get("client_secret"):
        return False, "Missing Azure client_id / client_secret"
    if not creds.get("access_token"):
        return False, "Not authorized yet — complete the OAuth flow first."
    try:
        creds, _ = await ensure_valid_token(creds)
        await _graph_get(creds["access_token"], "/me")
        return True, "Connected to Microsoft Graph."
    except GraphError as e:
        return False, f"Graph returned {e.status}: {e.body[:200]}"
    except Exception as e:
        return False, str(e)
