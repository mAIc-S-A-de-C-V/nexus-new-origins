import os
import sys

SERVICE_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), os.pardir))
BACKEND_ROOT = os.path.abspath(os.path.join(SERVICE_ROOT, os.pardir))

for p in (SERVICE_ROOT, BACKEND_ROOT):
    if p not in sys.path:
        sys.path.insert(0, p)
