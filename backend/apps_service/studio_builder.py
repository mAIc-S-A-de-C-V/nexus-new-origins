"""
Server-side bundler for the in-product Studio.

Wraps esbuild via subprocess. Resolves user-side imports (react, react-dom,
@nexus/app-sdk) against /studio-deps/node_modules, which is pre-installed
at image build time.

Why server-side rather than browser-side: esbuild-wasm in the browser is a
~1MB lazy download per Studio session and the resolved bundle still needs
the SDK and React available somewhere reachable. Doing it on the server
keeps the publish flow identical to the CLI path — same tarball shape,
same /app-registry/publish entry point.
"""
from __future__ import annotations
import json
import os
import shutil
import subprocess
import tempfile
from dataclasses import dataclass
from pathlib import Path


STUDIO_DEPS = Path(os.environ.get("STUDIO_DEPS_PATH", "/studio-deps"))
ESBUILD_BIN = os.environ.get("ESBUILD_BIN", "esbuild")
ESBUILD_TIMEOUT_SECONDS = int(os.environ.get("STUDIO_BUILD_TIMEOUT", "30"))


@dataclass
class BuildError(Exception):
    message: str

    def __str__(self) -> str:
        return self.message


@dataclass
class BundleResult:
    files: dict[str, bytes]      # path → bytes
    bundle_size: int             # total of all files
    bundle_js_size: int          # main.js only
    warnings: list[str]


_INDEX_HTML = """<!DOCTYPE html>
<html lang="en" data-theme="light">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>{title}</title>
    <style>
      html, body, #root {{ margin: 0; height: auto; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, sans-serif; }}
      html[data-theme="dark"] body {{ background: #0D1117; color: #E2E8F0; }}
      {extra_css}
    </style>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="./assets/main.js"></script>
  </body>
</html>
"""


def build_bundle(
    *,
    main_tsx: str,
    title: str = "Nexus App",
    extra_css: str = "",
    minify: bool = True,
) -> BundleResult:
    """
    Compile user TSX into a single JS bundle + an index.html.

    Raises BuildError on compile failure (stderr from esbuild).
    """
    if not STUDIO_DEPS.exists():
        raise BuildError(f"studio deps not installed at {STUDIO_DEPS}; image misbuilt")

    with tempfile.TemporaryDirectory(prefix="nexus-studio-") as tmp:
        tmp_path = Path(tmp)
        src_dir = tmp_path / "src"
        src_dir.mkdir()
        src_main = src_dir / "main.tsx"
        src_main.write_text(main_tsx, encoding="utf-8")

        # Symlink the prebuilt node_modules so esbuild can resolve imports.
        try:
            (tmp_path / "node_modules").symlink_to(STUDIO_DEPS / "node_modules")
        except FileExistsError:
            pass

        out_js = tmp_path / "dist" / "assets" / "main.js"
        out_js.parent.mkdir(parents=True, exist_ok=True)

        cmd = [
            ESBUILD_BIN,
            str(src_main),
            "--bundle",
            "--format=esm",
            "--target=es2022",
            "--platform=browser",
            "--jsx=automatic",
            "--loader:.tsx=tsx",
            "--loader:.ts=ts",
            "--loader:.css=css",
            f"--outfile={out_js}",
            "--log-level=warning",
            "--legal-comments=none",
            # `@nexus/app-sdk` is installed via `npm install file:/opt/...`
            # which creates a symlink. Without preserve-symlinks, esbuild
            # resolves out of the symlink and then can't find `react` in
            # the project's node_modules. Keeping the symlink in place
            # makes esbuild resolve dependencies relative to the user's
            # project, where react + react-dom + sdk all live together.
            "--preserve-symlinks",
        ]
        if minify:
            cmd.append("--minify")

        try:
            result = subprocess.run(
                cmd, capture_output=True, text=True,
                timeout=ESBUILD_TIMEOUT_SECONDS, cwd=tmp_path,
            )
        except subprocess.TimeoutExpired:
            raise BuildError(f"esbuild timed out after {ESBUILD_TIMEOUT_SECONDS}s")
        except FileNotFoundError:
            raise BuildError(f"esbuild not on PATH (env ESBUILD_BIN={ESBUILD_BIN})")

        warnings: list[str] = []
        if result.stderr:
            warnings = [line for line in result.stderr.splitlines() if line.strip()]
        if result.returncode != 0:
            stderr = (result.stderr or "").strip() or "(no stderr)"
            raise BuildError(f"esbuild failed:\n{stderr}")

        if not out_js.exists():
            raise BuildError("esbuild reported success but produced no output file")

        js_bytes = out_js.read_bytes()
        html = _INDEX_HTML.format(title=_escape_html(title), extra_css=extra_css or "")

        files = {
            "index.html": html.encode("utf-8"),
            "assets/main.js": js_bytes,
        }
        total = sum(len(b) for b in files.values())
        return BundleResult(files=files, bundle_size=total, bundle_js_size=len(js_bytes), warnings=warnings)


def _escape_html(s: str) -> str:
    return (s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
              .replace('"', "&quot;").replace("'", "&#39;"))


def pack_tarball(files: dict[str, bytes]) -> bytes:
    """Tar+gzip a {path: bytes} dict into the format apps-service expects."""
    import io
    import tarfile
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz") as tar:
        for path, data in files.items():
            info = tarfile.TarInfo(path)
            info.size = len(data)
            tar.addfile(info, io.BytesIO(data))
    return buf.getvalue()
