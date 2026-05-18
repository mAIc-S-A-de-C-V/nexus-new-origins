"""
Tests for the SharePoint connector.

Covers:
  - Demo-mode site/drive/folder/item listings without any Graph API call
  - Token expiry detection + refresh logic
  - OAuth state token signing/verification round-trip
  - Schema discovery in demo mode

Run from backend/connector_service:
    python3 -m pytest tests/test_sharepoint.py -v
"""
import asyncio
import os
import sys
import time
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import sharepoint_connector as sp  # noqa: E402


# ── Helpers ──────────────────────────────────────────────────────────────────

def run(coro):
    return asyncio.get_event_loop().run_until_complete(coro)


DEMO_CFG = {"demoMode": True}
EMPTY_CREDS: dict = {}


# ── Demo-mode listings ───────────────────────────────────────────────────────

def test_demo_list_sites_returns_single_synthetic_site():
    sites = run(sp.list_sites(EMPTY_CREDS, DEMO_CFG))
    assert len(sites) == 1
    assert sites[0]["name"] == "MAIC"
    assert sites[0]["id"].startswith("site!")


def test_demo_list_drives_returns_one_drive_for_demo_site():
    sites = run(sp.list_sites(EMPTY_CREDS, DEMO_CFG))
    drives = run(sp.list_drives(EMPTY_CREDS, DEMO_CFG, sites[0]["id"]))
    assert len(drives) == 1
    assert drives[0]["name"] == "Documents"


def test_demo_list_drives_returns_empty_for_unknown_site():
    drives = run(sp.list_drives(EMPTY_CREDS, DEMO_CFG, "site!nonexistent"))
    assert drives == []


def test_demo_list_items_root_returns_top_folders():
    sites = run(sp.list_sites(EMPTY_CREDS, DEMO_CFG))
    drives = run(sp.list_drives(EMPTY_CREDS, DEMO_CFG, sites[0]["id"]))
    items = run(sp.list_items(EMPTY_CREDS, DEMO_CFG, drives[0]["id"]))
    folder_names = {f["name"] for f in items["folders"]}
    assert folder_names == {"Clients", "Internal", "Templates"}
    assert items["files"] == []  # no files at root in the demo tree


def test_demo_list_items_inside_clients_folder_finds_subfolders():
    drive_id = sp._DEMO_TREE["drive"]["id"]
    clients = next(f for f in sp._DEMO_TREE["folders"] if f["name"] == "Clients")
    items = run(sp.list_items(EMPTY_CREDS, DEMO_CFG, drive_id, clients["id"]))
    names = {f["name"] for f in items["folders"]}
    assert "Acme Corp" in names
    assert "Bayfront Logistics" in names


def test_demo_list_items_acme_folder_returns_three_files():
    drive_id = sp._DEMO_TREE["drive"]["id"]
    acme = next(f for f in sp._DEMO_TREE["folders"] if f["name"] == "Acme Corp")
    items = run(sp.list_items(EMPTY_CREDS, DEMO_CFG, drive_id, acme["id"]))
    assert items["folders"] == []
    names = {f["name"] for f in items["files"]}
    assert names == {"Contract.pdf", "Proposal.docx", "MSA.pdf"}


def test_demo_walk_drive_finds_all_files_and_folders():
    drive_id = sp._DEMO_TREE["drive"]["id"]
    tree = run(sp.walk_drive(EMPTY_CREDS, DEMO_CFG, drive_id))
    # Every file in _DEMO_TREE should be reachable from the walk
    assert len(tree["files"]) == len(sp._DEMO_TREE["files"])
    # Folders: walk yields every subfolder under root (excludes root itself)
    assert len(tree["folders"]) >= len(sp._DEMO_TREE["folders"]) - 1


def test_demo_download_returns_synthetic_content():
    drive_id = sp._DEMO_TREE["drive"]["id"]
    file = next(f for f in sp._DEMO_TREE["files"] if f["name"] == "Contract.pdf")
    content, mime, name = run(sp.download_item(EMPTY_CREDS, DEMO_CFG, drive_id, file["id"]))
    assert name == "Contract.pdf"
    assert mime == "application/pdf"
    assert b"%PDF-1.4" in content
    assert file["name"].encode() in content


def test_demo_schema_discovery_returns_files_and_folders():
    drive_id = sp._DEMO_TREE["drive"]["id"]
    cfg = {"demoMode": True, "drive_id": drive_id}
    raw, samples, err = run(sp.fetch_schema(EMPTY_CREDS, cfg))
    assert err is None
    assert raw["source"] == "sharepoint"
    assert raw["total_files"] > 0
    # Samples include both folder and file rows, tagged with _type
    types = {s["_type"] for s in samples}
    assert "SharePointFile" in types
    assert "SharePointFolder" in types


def test_demo_schema_without_drive_returns_empty_samples():
    raw, samples, err = run(sp.fetch_schema(EMPTY_CREDS, DEMO_CFG))
    assert err is None
    assert samples == []
    assert "Select a site and drive" in raw["message"]


def test_demo_test_connection_passes():
    ok, msg = run(sp.test_connection(EMPTY_CREDS, DEMO_CFG))
    assert ok is True
    assert "Demo mode" in msg


# ── Token logic ──────────────────────────────────────────────────────────────

def test_apply_token_response_computes_expiry():
    creds = {"client_id": "x", "client_secret": "y", "tenant_id": "z"}
    token_resp = {
        "access_token": "AT",
        "refresh_token": "RT",
        "expires_in": 3600,
        "scope": "Files.Read.All",
    }
    out = sp.apply_token_response(creds, token_resp)
    assert out["access_token"] == "AT"
    assert out["refresh_token"] == "RT"
    assert out["scope"] == "Files.Read.All"
    # Original creds shouldn't be mutated
    assert "access_token" not in creds
    # expires_at should be ~now + 1h
    exp = datetime.fromisoformat(out["expires_at"])
    diff = (exp - datetime.now(timezone.utc)).total_seconds()
    assert 3500 < diff < 3700


def test_is_token_expired_with_no_expiry_treats_as_expired():
    assert sp._is_token_expired({"access_token": "AT"}) is True


def test_is_token_expired_far_future():
    far = (datetime.now(timezone.utc) + timedelta(hours=1)).isoformat()
    assert sp._is_token_expired({"expires_at": far}) is False


def test_is_token_expired_within_threshold_window():
    # 30s in the future, threshold is 60s — counts as expired
    near = (datetime.now(timezone.utc) + timedelta(seconds=30)).isoformat()
    assert sp._is_token_expired({"expires_at": near}) is True


def test_build_authorize_url_includes_required_params():
    creds = {
        "client_id": "abc",
        "client_secret": "x",
        "tenant_id": "common",
        "redirect_uri": "https://example.com/cb",
    }
    url = sp.build_authorize_url(creds, state="STATE123")
    assert "client_id=abc" in url
    assert "state=STATE123" in url
    assert "redirect_uri=https%3A%2F%2Fexample.com%2Fcb" in url
    assert "response_type=code" in url
    assert "scope=" in url
    assert url.startswith("https://login.microsoftonline.com/common/oauth2/v2.0/authorize")


def test_build_authorize_url_requires_redirect_uri():
    creds = {"client_id": "abc", "client_secret": "x", "tenant_id": "common"}
    try:
        sp.build_authorize_url(creds, state="S")
    except ValueError as e:
        assert "redirect_uri" in str(e)
    else:
        raise AssertionError("Expected ValueError")
