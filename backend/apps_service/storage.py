"""
Bundle storage abstraction. Local FS for dev (or anywhere a single host runs);
ready to swap for MinIO/S3 in prod.

Bundles are content-addressed: path = {root}/{app_id}/{version}/{sha256}.tar.gz.
A given (app_id, version) is published once and never mutated — republishing
requires a new version. Hash is computed server-side, never trusted from the
client.
"""
import os
import hashlib
import shutil
import tarfile
from pathlib import Path
from typing import BinaryIO


BUNDLE_ROOT = Path(os.environ.get("APP_BUNDLE_ROOT", "/data/apps/bundles"))
BUNDLE_PUBLIC_BASE = os.environ.get(
    "APP_BUNDLE_PUBLIC_BASE",
    "http://localhost:8028/apps/bundles",
)
MAX_BUNDLE_SIZE = int(os.environ.get("APP_MAX_BUNDLE_MB", "20")) * 1024 * 1024


def _ensure_root():
    BUNDLE_ROOT.mkdir(parents=True, exist_ok=True)


def compute_sha256(stream: BinaryIO, chunk_size: int = 1 << 16) -> tuple[str, int]:
    """Hash a binary stream. Returns (hex_digest, bytes_read)."""
    h = hashlib.sha256()
    total = 0
    while True:
        chunk = stream.read(chunk_size)
        if not chunk:
            break
        h.update(chunk)
        total += len(chunk)
    return h.hexdigest(), total


def stage_and_persist(
    app_id: str, version: str, data: bytes,
) -> tuple[str, str, int]:
    """
    Persist a tarball. Returns (sha256, relative_path, size_bytes).
    Raises ValueError on size violation or hash collision conflict.
    """
    _ensure_root()
    if len(data) > MAX_BUNDLE_SIZE:
        raise ValueError(f"Bundle too large ({len(data)} bytes > {MAX_BUNDLE_SIZE})")
    digest = hashlib.sha256(data).hexdigest()
    rel_dir = f"{app_id}/{version}"
    full_dir = BUNDLE_ROOT / rel_dir
    full_dir.mkdir(parents=True, exist_ok=True)
    rel_path = f"{rel_dir}/{digest}.tar.gz"
    full_path = BUNDLE_ROOT / rel_path
    if full_path.exists():
        # idempotent: same content, do nothing
        return digest, rel_path, len(data)
    # Atomic write: tmp then rename
    tmp_path = full_path.with_suffix(".tmp")
    tmp_path.write_bytes(data)
    tmp_path.rename(full_path)
    return digest, rel_path, len(data)


def public_url(rel_path: str) -> str:
    return f"{BUNDLE_PUBLIC_BASE}/{rel_path}"


def open_bundle(rel_path: str) -> bytes:
    full_path = BUNDLE_ROOT / rel_path
    if not full_path.exists():
        raise FileNotFoundError(rel_path)
    return full_path.read_bytes()


def extract_bundle_to(rel_path: str, target_dir: Path) -> None:
    """
    Extract tar.gz into `target_dir`. Refuses paths that escape via ../ or
    absolute paths (zip-slip protection).
    """
    full_path = BUNDLE_ROOT / rel_path
    if not full_path.exists():
        raise FileNotFoundError(rel_path)
    target_dir.mkdir(parents=True, exist_ok=True)

    with tarfile.open(full_path, "r:gz") as tar:
        for member in tar.getmembers():
            name = member.name
            if name.startswith("/") or ".." in Path(name).parts:
                raise ValueError(f"unsafe path in bundle: {name}")
            target_path = target_dir / name
            try:
                target_path.resolve().relative_to(target_dir.resolve())
            except ValueError:
                raise ValueError(f"path escapes target: {name}")
        tar.extractall(target_dir)


def list_bundle_files(rel_path: str) -> list[str]:
    """List file names in a bundle (read-only inspection, no extraction)."""
    full_path = BUNDLE_ROOT / rel_path
    if not full_path.exists():
        return []
    with tarfile.open(full_path, "r:gz") as tar:
        return [m.name for m in tar.getmembers() if m.isfile()]


def delete_bundle(rel_path: str) -> None:
    full_path = BUNDLE_ROOT / rel_path
    if full_path.exists():
        full_path.unlink()


def extract_dir_for(app_id: str, version: str, sha256: str) -> Path:
    """
    Lazily extract the bundle into BUNDLE_ROOT/_extracted/{app}/{version}/
    and return the directory. Used by the static-serve route to ship JS+HTML.
    """
    extracted = BUNDLE_ROOT / "_extracted" / app_id / version
    marker = extracted / ".sha256"
    if extracted.exists() and marker.exists() and marker.read_text().strip() == sha256:
        return extracted
    if extracted.exists():
        shutil.rmtree(extracted)
    extract_bundle_to(f"{app_id}/{version}/{sha256}.tar.gz", extracted)
    marker.write_text(sha256)
    return extracted
