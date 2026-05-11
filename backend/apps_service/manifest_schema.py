"""
JSON Schema for app manifests. Validated on publish; the host trusts the
stored row, not whatever a publisher claims at runtime.
"""
import re
from jsonschema import Draft202012Validator

MANIFEST_SCHEMA = {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "object",
    "additionalProperties": False,
    "required": ["id", "version", "publisher_id", "entry", "display_name"],
    "properties": {
        "id":           {"type": "string", "pattern": "^[a-z][a-z0-9-]{1,63}$"},
        "version":      {"type": "string", "pattern": "^\\d+\\.\\d+\\.\\d+(-[a-zA-Z0-9.]+)?$"},
        "publisher_id": {"type": "string", "minLength": 1},
        "display_name": {"type": "string", "minLength": 1, "maxLength": 100},
        "description":  {"type": "string", "maxLength": 4000},
        "icon":         {"type": "string"},
        "homepage":     {"type": "string"},
        "entry":        {"type": "string", "format": "uri"},
        "scopes": {
            "type": "array",
            "items": {"type": "string", "pattern": "^[a-z_]+:[a-z_]+(:[a-zA-Z0-9_*]+)?$"},
            "uniqueItems": True,
            "default": [],
        },
        "surfaces": {
            "type": "array",
            "default": [],
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["type"],
                "properties": {
                    "type":  {"enum": ["page", "widget", "object_action", "slash_command"]},
                    "id":    {"type": "string"},
                    "path":  {"type": "string"},
                    "title": {"type": "string"},
                    "icon":  {"type": "string"},
                    "size":  {"enum": ["sm", "md", "lg", "xl", "full"]},
                    "object_type": {"type": "string"},
                    "label": {"type": "string"},
                    "name":  {"type": "string"},
                    "min_role": {"enum": ["viewer", "analyst", "admin", "superadmin"]},
                },
            },
        },
        "config_schema": {"type": "object"},
        "functions": {
            "type": "array",
            "default": [],
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["name", "trigger", "code"],
                "properties": {
                    "name":        {"type": "string", "pattern": "^[a-z][a-z0-9_]{0,63}$"},
                    "description": {"type": "string"},
                    "trigger": {
                        "type": "object",
                        "additionalProperties": False,
                        "required": ["type"],
                        "properties": {
                            "type":     {"enum": ["schedule", "webhook", "http"]},
                            "cron":     {"type": "string"},
                            "event":    {"type": "string"},
                            "object_type": {"type": "string"},
                        },
                    },
                    "code":        {"type": "string", "minLength": 1, "maxLength": 100000},
                    "timeout_ms":  {"type": "integer", "minimum": 1000, "maximum": 300000, "default": 30000},
                    "scopes":      {"type": "array", "items": {"type": "string"}, "default": []},
                },
            },
        },
        "event_subscriptions": {
            "type": "array",
            "default": [],
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["event"],
                "properties": {
                    "event":       {"type": "string"},
                    "object_type": {"type": "string"},
                    "function":    {"type": "string"},   # name of a function defined above
                },
            },
        },
        "permissions": {
            "type": "object",
            "additionalProperties": False,
            "properties": {
                "min_role": {"enum": ["viewer", "analyst", "admin", "superadmin"], "default": "viewer"},
            },
        },
    },
}


_validator = Draft202012Validator(MANIFEST_SCHEMA)


def validate_manifest(manifest: dict) -> list[str]:
    """Returns list of error strings; empty = valid."""
    errors: list[str] = []
    for e in sorted(_validator.iter_errors(manifest), key=lambda x: x.path):
        path = "/".join(str(p) for p in e.path) or "<root>"
        errors.append(f"{path}: {e.message}")

    # Cross-field checks: function names referenced by subscriptions must exist
    fn_names = {f.get("name") for f in manifest.get("functions") or []}
    for sub in manifest.get("event_subscriptions") or []:
        fn = sub.get("function")
        if fn and fn not in fn_names:
            errors.append(f"event_subscriptions: function '{fn}' not declared in functions[]")

    # entry must be HTTPS in non-dev; we accept http://localhost / .localhost
    entry = manifest.get("entry") or ""
    if not (entry.startswith("https://") or "localhost" in entry or ".local" in entry):
        errors.append("entry: must be https:// (or http://localhost for dev)")

    return errors
