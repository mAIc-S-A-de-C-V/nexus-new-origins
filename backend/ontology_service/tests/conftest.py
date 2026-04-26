"""
Shared test fixtures + path setup so individual test files can import from
ontology_service without needing the package installed.
"""
import os
import sys

# Make `routers`, `database`, etc. importable when running pytest from anywhere.
SERVICE_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), os.pardir))
BACKEND_ROOT = os.path.abspath(os.path.join(SERVICE_ROOT, os.pardir))

for p in (SERVICE_ROOT, BACKEND_ROOT):
    if p not in sys.path:
        sys.path.insert(0, p)

# pytest-asyncio: auto-mode means we don't need to mark every async test.
import pytest  # noqa: E402

def pytest_collection_modifyitems(config, items):
    for item in items:
        # pytest-asyncio respects this marker
        if "asyncio" in item.keywords:
            continue


# Auto-apply asyncio mode for any test marked with @pytest.mark.asyncio
pytest_plugins = ("pytest_asyncio",)
