"""
Sandboxed Python runtime for server-side app functions.

Why hand-rolled, not RestrictedPython:
  - RestrictedPython refuses `async def` (Line: "AsyncFunctionDef not allowed").
    Our function contract is async, by design — server-side functions await
    `nexus.*` calls. So RestrictedPython doesn't fit.
  - Defense model: code is supplied at publish time by an audited admin. The
    runtime is one layer of defense; the manifest publish flow + bundle
    immutability + per-tenant scopes are the other layers.

What this runtime does:
  - AST walk forbids: import, ImportFrom, __import__, dynamic attr access on
    dunders, exec/eval/compile, open, breakpoint, input, file I/O builtins,
    `__class__`/`__bases__`/`__subclasses__` reads.
  - Provides a curated `__builtins__` dict — only safe primitives.
  - Exec into an isolated namespace whose globals contain only `nexus`,
    `inputs`, `event`, `datetime`, `json`, and the curated builtins.
  - Walltime enforced with asyncio.wait_for.
  - stdout captured via a substituted `print()`.

What it intentionally does NOT do:
  - CPU/memory limits per-invocation (handled by container cgroup + scheduler concurrency cap).
  - Process isolation (single-tenant trust boundary; cross-tenant isolation lives at the install level).
"""
from __future__ import annotations
import asyncio
import ast
import json
import textwrap
import time
import traceback
from typing import Any, Callable


BANNED_NAMES = {
    "__import__", "eval", "exec", "compile", "open", "breakpoint", "input",
    "globals", "locals", "vars", "help", "exit", "quit",
    "__class__", "__bases__", "__subclasses__", "__mro__", "__dict__",
    "__getattribute__", "__setattr__", "__delattr__", "__init_subclass__",
    "__new__", "__init__",   # disallow direct calls in user code
    "object", "type", "super",
}

ALLOWED_DUNDERS = {"__name__", "__doc__", "__qualname__", "__module__"}


class SandboxError(Exception):
    pass


def _check_ast(code: str) -> ast.AST:
    tree = ast.parse(code, mode="exec")
    for node in ast.walk(tree):
        if isinstance(node, (ast.Import, ast.ImportFrom)):
            raise SandboxError(f"import forbidden (line {node.lineno})")
        if isinstance(node, ast.Name) and node.id in BANNED_NAMES:
            raise SandboxError(f"name '{node.id}' is forbidden (line {node.lineno})")
        if isinstance(node, ast.Attribute):
            name = node.attr
            if name.startswith("__") and name.endswith("__") and name not in ALLOWED_DUNDERS:
                raise SandboxError(f"dunder attribute '{name}' is forbidden (line {node.lineno})")
        if isinstance(node, ast.Call):
            fn = node.func
            # ban getattr(x, "__class__") etc.
            if isinstance(fn, ast.Name) and fn.id in ("getattr", "setattr", "delattr"):
                if len(node.args) >= 2 and isinstance(node.args[1], ast.Constant):
                    val = node.args[1].value
                    if isinstance(val, str) and val.startswith("__") and val not in ALLOWED_DUNDERS:
                        raise SandboxError(f"getattr/setattr on dunder '{val}' forbidden (line {node.lineno})")
    return tree


def _safe_builtins() -> dict:
    return {
        "True": True, "False": False, "None": None,
        "len": len, "range": range, "min": min, "max": max, "sum": sum,
        "abs": abs, "round": round, "any": any, "all": all,
        "enumerate": enumerate, "zip": zip, "sorted": sorted, "reversed": reversed,
        "list": list, "dict": dict, "set": set, "tuple": tuple, "frozenset": frozenset,
        "str": str, "int": int, "float": float, "bool": bool, "bytes": bytes,
        "isinstance": isinstance, "issubclass": issubclass,
        "map": map, "filter": filter,
        "ValueError": ValueError, "TypeError": TypeError, "KeyError": KeyError,
        "IndexError": IndexError, "Exception": Exception, "RuntimeError": RuntimeError,
        "AttributeError": AttributeError, "StopIteration": StopIteration,
        "ZeroDivisionError": ZeroDivisionError, "ArithmeticError": ArithmeticError,
        # print substituted at call time
    }


class FunctionResult:
    def __init__(self):
        self.return_value: Any = None
        self.logs: list[str] = []
        self.error: str | None = None


class NexusServerClient:
    """Mirror of the browser SDK; calls the in-process RPC dispatcher."""

    def __init__(self, dispatch_fn: Callable, payload: dict, db):
        self._dispatch = dispatch_fn
        self._payload = payload
        self._db = db
        self.tenant_id = payload["tenant_id"]
        self.user_id = payload["sub"]
        self.app_id = payload["app_id"]

    async def _call(self, method: str, args: dict | None = None) -> Any:
        result = await self._dispatch(self._payload, method, args or {}, self._db)
        if isinstance(result, dict) and result.get("ok") is False:
            raise RuntimeError(f"rpc_failed: {result.get('error')} {result.get('detail', '')}")
        return result.get("result") if isinstance(result, dict) else result

    async def query(self, object_type: str, **kw):
        return await self._call("ontology.query", {"object_type": object_type, **kw})

    async def get(self, object_type: str, record_id: str):
        return await self._call("ontology.get", {"object_type": object_type, "record_id": record_id})

    async def aggregate(self, object_type: str, **kw):
        return await self._call("ontology.aggregate", {"object_type": object_type, **kw})

    async def list_types(self):
        return await self._call("ontology.listTypes")

    async def propose_action(self, action_name: str, inputs: dict, reasoning: str = ""):
        return await self._call("actions.propose", {"action_name": action_name, "inputs": inputs, "reasoning": reasoning})

    async def run_agent(self, agent_name: str, inputs: dict):
        return await self._call("agents.run", {"agent_name": agent_name, "inputs": inputs})

    async def kv_get(self, key: str, scope: str = "install"):
        r = await self._call("storage.kv.get", {"key": key, "scope": scope})
        return r.get("value") if isinstance(r, dict) else r

    async def kv_set(self, key: str, value: Any, scope: str = "install"):
        return await self._call("storage.kv.set", {"key": key, "value": value, "scope": scope})

    async def kv_delete(self, key: str, scope: str = "install"):
        return await self._call("storage.kv.delete", {"key": key, "scope": scope})

    async def kv_list(self, prefix: str = "", scope: str = "install"):
        return await self._call("storage.kv.list", {"prefix": prefix, "scope": scope})


async def execute_function_code(
    code: str,
    *,
    nexus: NexusServerClient,
    inputs: dict[str, Any] | None = None,
    event: dict[str, Any] | None = None,
    timeout_ms: int = 30000,
) -> FunctionResult:
    result = FunctionResult()
    logs_buf: list[str] = []

    def captured_print(*args, **kw):
        logs_buf.append(" ".join(str(a) for a in args))

    try:
        tree = _check_ast(code)
    except SandboxError as e:
        result.error = f"sandbox_violation: {e}"
        return result
    except SyntaxError as e:
        result.error = f"syntax_error: {e}"
        return result

    builtins = _safe_builtins()
    builtins["print"] = captured_print

    import datetime as _dt
    globals_ns: dict[str, Any] = {
        "__builtins__": builtins,
        "json": json,
        "datetime": _dt,
        "nexus": nexus,
        "inputs": inputs or {},
        "event": event or {},
    }

    try:
        compiled = compile(tree, "<app-fn>", "exec")
        exec(compiled, globals_ns)
        handler = globals_ns.get("handler")
        if handler is None:
            result.error = "function must define `async def handler(nexus, inputs, event)`"
            return result
        if not asyncio.iscoroutinefunction(handler):
            result.error = "handler must be `async def`"
            return result

        try:
            result.return_value = await asyncio.wait_for(
                handler(nexus, inputs or {}, event or {}),
                timeout=timeout_ms / 1000,
            )
        except asyncio.TimeoutError:
            result.error = f"timeout after {timeout_ms}ms"
        except Exception as e:
            result.error = f"{type(e).__name__}: {e}"
            logs_buf.append(traceback.format_exc())

    except Exception as e:
        result.error = f"setup_error: {e}"
        logs_buf.append(traceback.format_exc())

    result.logs = logs_buf
    return result
