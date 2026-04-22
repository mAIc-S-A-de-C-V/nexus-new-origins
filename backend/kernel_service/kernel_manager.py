"""Manages IPython kernel subprocesses for notebook sessions.

Each session = one kernel process, kept warm for ~30min idle, then reaped.
Execution drains IOPub until the kernel idles, collecting stdout/display/error
messages and translating them into a list of MIME-tagged outputs.
"""
from __future__ import annotations

import asyncio
import logging
import os
import time
from dataclasses import dataclass, field
from typing import Any
from uuid import uuid4

from jupyter_client.manager import KernelManager

logger = logging.getLogger(__name__)

IDLE_TTL_SEC = int(os.environ.get("KERNEL_IDLE_TTL_SEC", "1800"))  # 30 min
GC_INTERVAL_SEC = 60
STARTUP_CODE = """
import sys
sys.path.insert(0, '/app')
import nexus_sdk as nexus
import pandas as pd
import numpy as np
import plotly.express as px
import plotly.graph_objects as go
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
"""


@dataclass
class KernelSession:
    session_id: str
    tenant_id: str
    manager: KernelManager
    client: Any
    created_at: float
    last_used_at: float = field(default_factory=time.time)


class KernelRegistry:
    def __init__(self) -> None:
        self._sessions: dict[str, KernelSession] = {}
        self._lock = asyncio.Lock()
        self._gc_task: asyncio.Task | None = None

    async def start_gc(self) -> None:
        if self._gc_task is None:
            self._gc_task = asyncio.create_task(self._gc_loop())

    async def _gc_loop(self) -> None:
        while True:
            try:
                await asyncio.sleep(GC_INTERVAL_SEC)
                now = time.time()
                stale = [sid for sid, s in self._sessions.items() if now - s.last_used_at > IDLE_TTL_SEC]
                for sid in stale:
                    logger.info("reaping idle kernel", extra={"session_id": sid})
                    await self.delete(sid)
            except Exception:
                logger.exception("kernel GC error")

    async def create(self, tenant_id: str, auth_token: str) -> KernelSession:
        async with self._lock:
            session_id = str(uuid4())
            km = KernelManager(kernel_name="python3")
            # The kernel inherits env, so the SDK picks up TENANT_ID/AUTH_TOKEN on first call.
            env = dict(os.environ)
            env["TENANT_ID"] = tenant_id
            env["AUTH_TOKEN"] = auth_token or ""
            await asyncio.to_thread(km.start_kernel, env=env)
            client = km.client()
            client.start_channels()
            await asyncio.to_thread(client.wait_for_ready, 30)
            session = KernelSession(
                session_id=session_id,
                tenant_id=tenant_id,
                manager=km,
                client=client,
                created_at=time.time(),
            )
            self._sessions[session_id] = session

            # Run the startup cell and drain IOPub — ignore outputs
            await _execute_and_drain(session, STARTUP_CODE, timeout_sec=30)
            return session

    def get(self, session_id: str) -> KernelSession | None:
        return self._sessions.get(session_id)

    async def delete(self, session_id: str) -> bool:
        async with self._lock:
            session = self._sessions.pop(session_id, None)
            if not session:
                return False
            try:
                session.client.stop_channels()
            except Exception:
                pass
            try:
                await asyncio.to_thread(session.manager.shutdown_kernel, now=True)
            except Exception:
                pass
            return True

    async def interrupt(self, session_id: str) -> bool:
        session = self._sessions.get(session_id)
        if not session:
            return False
        await asyncio.to_thread(session.manager.interrupt_kernel)
        return True


async def execute(
    registry: KernelRegistry,
    session_id: str,
    code: str,
    timeout_sec: int = 30,
) -> dict:
    session = registry.get(session_id)
    if not session:
        return {"status": "error", "outputs": [], "error": {"ename": "SessionNotFound", "evalue": session_id, "traceback": []}}
    return await _execute_and_drain(session, code, timeout_sec=timeout_sec)


async def _execute_and_drain(session: KernelSession, code: str, timeout_sec: int = 30) -> dict:
    session.last_used_at = time.time()
    client = session.client
    msg_id = await asyncio.to_thread(client.execute, code, silent=False, store_history=True)

    outputs: list[dict] = []
    status = "ok"
    err: dict | None = None

    async def _drain() -> None:
        nonlocal status, err
        while True:
            try:
                msg = await asyncio.to_thread(client.get_iopub_msg, 5)
            except Exception:
                # queue.Empty → keep waiting; we rely on outer timeout
                continue
            if msg.get("parent_header", {}).get("msg_id") != msg_id:
                continue

            mtype = msg.get("msg_type")
            content = msg.get("content", {})

            if mtype == "stream":
                outputs.append({"mime_type": "text/plain", "data": content.get("text", ""), "stream": content.get("name", "stdout")})
            elif mtype in ("execute_result", "display_data"):
                data = content.get("data", {})
                for mt, payload in data.items():
                    outputs.append({"mime_type": mt, "data": payload})
            elif mtype == "error":
                status = "error"
                err = {
                    "ename": content.get("ename", "Error"),
                    "evalue": content.get("evalue", ""),
                    "traceback": content.get("traceback", []),
                }
            elif mtype == "status" and content.get("execution_state") == "idle":
                return

    try:
        await asyncio.wait_for(_drain(), timeout=timeout_sec)
    except asyncio.TimeoutError:
        await asyncio.to_thread(session.manager.interrupt_kernel)
        status = "error"
        err = {"ename": "TimeoutError", "evalue": f"Execution exceeded {timeout_sec}s", "traceback": []}

    session.last_used_at = time.time()
    return {"status": status, "outputs": outputs, "error": err}
