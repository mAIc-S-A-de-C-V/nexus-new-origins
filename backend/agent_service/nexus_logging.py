"""
Structured JSON logging for Nexus services.
ISO 27001 Annex A.8.15 — Logging

Provides a pre-configured logger that emits JSON to stdout.
Downstream log aggregators (CloudWatch, Elastic, Splunk) can parse JSON natively.

Usage:
    from shared.nexus_logging import get_logger
    logger = get_logger(__name__)
    logger.info("pipeline_run_complete", pipeline_id="abc", rows=42)
"""
import logging
import json
import sys
import os
from datetime import datetime, timezone
from typing import Any


SERVICE_NAME = os.environ.get("SERVICE_NAME", "nexus-service")


class _JsonFormatter(logging.Formatter):
    """Formats log records as single-line JSON objects."""

    LEVEL_MAP = {
        logging.DEBUG: "debug",
        logging.INFO: "info",
        logging.WARNING: "warning",
        logging.ERROR: "error",
        logging.CRITICAL: "critical",
    }

    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, Any] = {
            "ts": datetime.now(timezone.utc).isoformat(),
            "level": self.LEVEL_MAP.get(record.levelno, "unknown"),
            "service": SERVICE_NAME,
            "logger": record.name,
            "msg": record.getMessage(),
        }

        # Merge any extra fields passed via logger.info("msg", extra={"key": val})
        for key, val in record.__dict__.items():
            if key not in (
                "args", "asctime", "created", "exc_info", "exc_text",
                "filename", "funcName", "id", "levelname", "levelno",
                "lineno", "module", "msecs", "message", "msg", "name",
                "pathname", "process", "processName", "relativeCreated",
                "stack_info", "thread", "threadName", "taskName",
            ):
                payload[key] = val

        if record.exc_info:
            payload["exception"] = self.formatException(record.exc_info)

        try:
            return json.dumps(payload, default=str)
        except Exception:
            return json.dumps({"level": "error", "msg": "log serialization failed"})


def configure_logging(level: str = "INFO") -> None:
    """Call once at service startup to configure root logging."""
    root = logging.getLogger()
    root.setLevel(getattr(logging, level.upper(), logging.INFO))

    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(_JsonFormatter())

    # Replace any existing handlers
    root.handlers.clear()
    root.addHandler(handler)

    # Suppress noisy uvicorn access logs in structured mode
    logging.getLogger("uvicorn.access").setLevel(logging.WARNING)


def get_logger(name: str) -> logging.Logger:
    """Get a named logger. Call configure_logging() first at startup."""
    return logging.getLogger(name)
