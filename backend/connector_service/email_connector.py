"""
IMAP-based email connector — works for any provider that exposes IMAP+SSL
(Gmail, Outlook/Microsoft 365, Yahoo, iCloud, Zoho, FastMail, custom hosts).

One connector instance = one linked mailbox. Multiple instances = multiple
mailboxes. Mirrors the WhatsApp pattern of per-connector linked-account
state, except auth is via app-password instead of QR scan.

Credentials shape (after decrypt):
    {
        "imap_host": "imap.gmail.com",
        "imap_port": 993,
        "username": "you@gmail.com",   # email address
        "password": "<app password>",  # provider-issued app password
        "use_ssl": true,               # default true
    }

Config shape:
    {
        "provider": "gmail" | "outlook" | "yahoo" | "icloud" | "zoho" | "custom",
        "default_folder": "INBOX",
        "fetch_limit": 100,
    }

Schema returned to the platform — one ObjectType row per email message:
    message_id (str)        IMAP UID (stable per folder)
    folder (str)            mailbox folder
    from (str)              "Display Name <addr@host>"
    from_email (str)        bare address
    to (str)                comma-separated
    cc (str)                comma-separated
    subject (str)
    body_text (str)         plain-text body (preferred)
    body_html (str)         HTML body when no plain part
    received_at (datetime)
    has_attachments (bool)
    attachment_names (str)  comma-separated filenames
    headers (str)           raw key headers as JSON for debugging
"""
from __future__ import annotations

import asyncio
import email
import email.policy
import imaplib
import json
import logging
import re
import time
from datetime import datetime, timezone
from email.header import decode_header, make_header
from email.utils import getaddresses, parsedate_to_datetime
from typing import Optional

log = logging.getLogger("connector.email")


# ── Provider presets — host/port autofill ────────────────────────────────

PROVIDER_PRESETS: dict[str, dict] = {
    "gmail":   {"imap_host": "imap.gmail.com",          "imap_port": 993},
    "outlook": {"imap_host": "outlook.office365.com",   "imap_port": 993},
    "yahoo":   {"imap_host": "imap.mail.yahoo.com",     "imap_port": 993},
    "icloud":  {"imap_host": "imap.mail.me.com",        "imap_port": 993},
    "zoho":    {"imap_host": "imap.zoho.com",           "imap_port": 993},
    "fastmail":{"imap_host": "imap.fastmail.com",       "imap_port": 993},
    "custom":  {},  # user fills host/port manually
}


# ── Connection helpers ───────────────────────────────────────────────────

class EmailConnectError(Exception):
    """Raised for any IMAP failure — caught and surfaced to the UI."""


def _connect_sync(host: str, port: int, username: str, password: str) -> imaplib.IMAP4_SSL:
    """Blocking IMAP connection. Caller wraps in run_in_executor."""
    if not host or not username or not password:
        raise EmailConnectError("imap_host, username, and password are required")
    try:
        client = imaplib.IMAP4_SSL(host, port, timeout=15)
    except Exception as e:
        raise EmailConnectError(f"Could not reach {host}:{port} — {e}") from e
    try:
        client.login(username, password)
    except imaplib.IMAP4.error as e:
        raise EmailConnectError(
            f"Login rejected by {host}. Most providers require an app-password (not your real password) when 2-step is on. Detail: {e}"
        ) from e
    return client


async def _connect(creds: dict) -> imaplib.IMAP4_SSL:
    host = creds.get("imap_host")
    port = int(creds.get("imap_port") or 993)
    user = creds.get("username")
    pwd = creds.get("password")
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, _connect_sync, host, port, user, pwd)


# ── Public surface (called from schema_fetcher) ───────────────────────────

async def imap_test(creds: dict, cfg: dict | None = None) -> tuple[bool, str, int]:
    """Connect, login, count INBOX. Returns (ok, message, latency_ms)."""
    start = time.time()
    cfg = cfg or {}
    folder = cfg.get("default_folder", "INBOX")
    try:
        client = await _connect(creds)
    except EmailConnectError as e:
        return False, str(e), int((time.time() - start) * 1000)
    try:
        loop = asyncio.get_event_loop()
        def _probe():
            status, data = client.select(folder, readonly=True)
            if status != "OK":
                return False, f"Folder '{folder}' not accessible: {data!r}"
            count = int(data[0]) if data and data[0] else 0
            return True, f"Linked — {count:,} messages in {folder}"
        ok, msg = await loop.run_in_executor(None, _probe)
        return ok, msg, int((time.time() - start) * 1000)
    finally:
        await _safe_logout(client)


async def imap_list_folders(creds: dict) -> list[str]:
    """Return the list of folder names. Used by the setup modal so users
    can pick which folder to ingest from (Inbox, [Gmail]/All Mail, etc.)."""
    client = await _connect(creds)
    loop = asyncio.get_event_loop()
    try:
        def _list():
            status, data = client.list()
            if status != "OK":
                return []
            out = []
            for item in data or []:
                # IMAP returns bytes lines like b'(\\HasNoChildren) "/" "INBOX"'
                line = item.decode(errors="replace") if isinstance(item, bytes) else str(item)
                m = re.match(r'^\([^)]*\)\s+"[^"]*"\s+"?([^"]+)"?\s*$', line)
                if m:
                    out.append(m.group(1))
            return out
        return await loop.run_in_executor(None, _list)
    finally:
        await _safe_logout(client)


async def imap_fetch(
    creds: dict,
    folder: str = "INBOX",
    limit: int = 100,
    since: Optional[datetime] = None,
) -> list[dict]:
    """Return the most recent `limit` messages from `folder`. If `since` is
    given, only messages on/after that date are returned (IMAP day-precision).
    Newest first.
    """
    client = await _connect(creds)
    loop = asyncio.get_event_loop()
    try:
        def _fetch_sync():
            status, _data = client.select(folder, readonly=True)
            if status != "OK":
                raise EmailConnectError(f"Could not select folder '{folder}'")

            # Build SEARCH criteria. SINCE is day-granular (IMAP4rev1).
            criteria: list[str] = ["ALL"]
            if since is not None:
                # IMAP wants e.g. "01-Jan-2026"
                criteria = ["SINCE", since.strftime("%d-%b-%Y")]
            status, search_data = client.search(None, *criteria)
            if status != "OK":
                raise EmailConnectError("IMAP search failed")
            ids = (search_data[0] or b"").split()
            if not ids:
                return []
            # Take the newest `limit` ids (IDs are returned ascending).
            ids = ids[-int(limit):]
            ids.reverse()  # newest first

            results: list[dict] = []
            for msg_id in ids:
                # RFC822.PEEK leaves the \Seen flag untouched.
                status, msg_data = client.fetch(msg_id, "(RFC822 UID)")
                if status != "OK" or not msg_data:
                    continue
                # msg_data is a list; the first tuple has bytes envelope + body.
                body_bytes: bytes | None = None
                envelope_str = ""
                for part in msg_data:
                    if isinstance(part, tuple) and len(part) >= 2:
                        envelope_str = part[0].decode(errors="replace") if isinstance(part[0], bytes) else str(part[0])
                        body_bytes = part[1] if isinstance(part[1], (bytes, bytearray)) else None
                        break
                if not body_bytes:
                    continue
                try:
                    msg = email.message_from_bytes(body_bytes, policy=email.policy.default)
                except Exception:
                    continue

                uid = _parse_uid(envelope_str) or msg_id.decode()
                row = _email_to_row(msg, uid=uid, folder=folder)
                results.append(row)
            return results

        return await loop.run_in_executor(None, _fetch_sync)
    finally:
        await _safe_logout(client)


# ── Parsing ──────────────────────────────────────────────────────────────

def _parse_uid(envelope: str) -> Optional[str]:
    m = re.search(r"UID\s+(\d+)", envelope)
    return m.group(1) if m else None


def _decode_header_str(raw: str | None) -> str:
    if not raw:
        return ""
    try:
        return str(make_header(decode_header(raw)))
    except Exception:
        return raw


def _addresses(msg: email.message.Message, header: str) -> str:
    raw = msg.get_all(header) or []
    pairs = getaddresses([_decode_header_str(h) for h in raw])
    out = []
    for name, addr in pairs:
        if not addr:
            continue
        out.append(f"{name} <{addr}>" if name else addr)
    return ", ".join(out)


def _bare_emails(msg: email.message.Message, header: str) -> str:
    raw = msg.get_all(header) or []
    pairs = getaddresses([_decode_header_str(h) for h in raw])
    return ", ".join(addr for _, addr in pairs if addr)


def _walk_for_body(msg: email.message.Message) -> tuple[str, str, list[str]]:
    """Return (text_body, html_body, attachment_names)."""
    text_body = ""
    html_body = ""
    attachments: list[str] = []
    if msg.is_multipart():
        for part in msg.walk():
            disp = (part.get("Content-Disposition") or "").lower()
            ctype = (part.get_content_type() or "").lower()
            filename = part.get_filename()
            if filename:
                attachments.append(_decode_header_str(filename))
                continue
            if "attachment" in disp:
                if filename:
                    attachments.append(_decode_header_str(filename))
                continue
            if ctype == "text/plain" and not text_body:
                text_body = _safe_get_content(part)
            elif ctype == "text/html" and not html_body:
                html_body = _safe_get_content(part)
    else:
        ctype = (msg.get_content_type() or "").lower()
        if ctype == "text/html":
            html_body = _safe_get_content(msg)
        else:
            text_body = _safe_get_content(msg)
    return text_body, html_body, attachments


def _safe_get_content(part: email.message.Message) -> str:
    try:
        # email.policy.default returns str directly via get_content().
        content = part.get_content()
        if isinstance(content, bytes):
            return content.decode(errors="replace")
        return str(content) if content is not None else ""
    except Exception:
        try:
            payload = part.get_payload(decode=True)
            if payload:
                return payload.decode(errors="replace")
        except Exception:
            pass
        return ""


def _email_to_row(msg: email.message.Message, *, uid: str, folder: str) -> dict:
    subject = _decode_header_str(msg.get("Subject"))
    from_full = _addresses(msg, "From")
    from_bare = _bare_emails(msg, "From")
    to_full = _addresses(msg, "To")
    cc_full = _addresses(msg, "Cc")
    text_body, html_body, attachments = _walk_for_body(msg)

    received_at = msg.get("Date")
    received_iso = ""
    if received_at:
        try:
            dt = parsedate_to_datetime(received_at)
            if dt is not None:
                if dt.tzinfo is None:
                    dt = dt.replace(tzinfo=timezone.utc)
                received_iso = dt.astimezone(timezone.utc).isoformat()
        except Exception:
            pass

    headers_subset = {
        k: _decode_header_str(msg.get(k))
        for k in ("Message-ID", "Date", "From", "To", "Cc", "Subject", "Reply-To", "In-Reply-To", "References")
        if msg.get(k)
    }

    return {
        "id": f"{folder}:{uid}",
        "message_id": _decode_header_str(msg.get("Message-ID")) or uid,
        "uid": uid,
        "folder": folder,
        "from": from_full,
        "from_email": from_bare,
        "to": to_full,
        "cc": cc_full,
        "subject": subject,
        "body_text": text_body[:50_000],   # cap at 50k chars
        "body_html": html_body[:50_000],
        "received_at": received_iso,
        "has_attachments": bool(attachments),
        "attachment_names": ", ".join(attachments),
        "headers": json.dumps(headers_subset, ensure_ascii=False),
    }


# ── Schema description (for the platform's schema fetcher) ───────────────

def schema_definition() -> dict:
    """The schema dict returned to the connector pipeline. Mirrors the shape
    other connectors return (HubSpot, REST_API)."""
    fields = [
        ("id", "string"),
        ("message_id", "string"),
        ("uid", "string"),
        ("folder", "string"),
        ("from", "string"),
        ("from_email", "string"),
        ("to", "string"),
        ("cc", "string"),
        ("subject", "string"),
        ("body_text", "string"),
        ("body_html", "string"),
        ("received_at", "datetime"),
        ("has_attachments", "boolean"),
        ("attachment_names", "string"),
        ("headers", "string"),
    ]
    return {
        "primary_key": "id",
        "properties": [{"name": n, "data_type": t} for n, t in fields],
    }


# ── Internals ────────────────────────────────────────────────────────────

async def _safe_logout(client: imaplib.IMAP4_SSL) -> None:
    try:
        loop = asyncio.get_event_loop()
        await loop.run_in_executor(None, client.logout)
    except Exception:
        pass
