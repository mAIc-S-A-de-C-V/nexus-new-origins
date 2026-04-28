"""
Per-tenant LLM provider resolution.

Resolves which LLM provider + key + model a service should use for a given
tenant, based on the `model_providers` table managed by agent_service.
Falls back to env-based defaults when no row is configured.
"""
import os
import logging
from dataclasses import dataclass
from typing import Optional

logger = logging.getLogger("llm_router")

DATABASE_URL = os.environ.get(
    "DATABASE_URL",
    "postgresql+asyncpg://nexus:nexus_pass@postgres:5432/nexus",
)

DEFAULT_ANTHROPIC_MODEL = "claude-haiku-4-5-20251001"
DEFAULT_OPENAI_MODEL = "gpt-4o-mini"


@dataclass
class ProviderConfig:
    provider_type: str
    api_key: str
    base_url: Optional[str]
    model: str
    provider_id: Optional[str] = None
    provider_name: Optional[str] = None


_engine = None
_sync_engine = None


def _get_engine():
    global _engine
    if _engine is None:
        from sqlalchemy.ext.asyncio import create_async_engine
        _engine = create_async_engine(DATABASE_URL, echo=False, pool_pre_ping=True)
    return _engine


def _get_sync_engine():
    global _sync_engine
    if _sync_engine is None:
        from sqlalchemy import create_engine
        sync_url = DATABASE_URL.replace("+asyncpg", "")
        _sync_engine = create_engine(sync_url, echo=False, pool_pre_ping=True)
    return _sync_engine


def _env_fallback(model: Optional[str]) -> ProviderConfig:
    return ProviderConfig(
        provider_type="anthropic",
        api_key=os.environ.get("ANTHROPIC_API_KEY", ""),
        base_url=None,
        model=model or DEFAULT_ANTHROPIC_MODEL,
    )


def _default_model_for(provider_type: str, models_list: list) -> str:
    if models_list:
        first = models_list[0]
        if isinstance(first, dict) and first.get("id"):
            return first["id"]
        if isinstance(first, str):
            return first
    if provider_type == "openai" or provider_type == "azure_openai":
        return DEFAULT_OPENAI_MODEL
    if provider_type == "local":
        return "llama3.1:8b"
    return DEFAULT_ANTHROPIC_MODEL


async def resolve_provider_for_model(
    tenant_id: str,
    model_id: str,
) -> ProviderConfig:
    """Resolve which provider owns a given model ID.

    Scans the tenant's enabled providers looking for one whose ``models``
    JSON array contains an entry with ``{"id": model_id}``.  Falls back to
    ``resolve_provider`` (default provider) if no match is found.  Built-in
    Claude model IDs (starting with ``claude-``) short-circuit to the env
    fallback so they always use the Anthropic API key.
    """
    if not model_id or model_id.startswith("claude-"):
        return _env_fallback(model_id)

    try:
        from sqlalchemy import text
        engine = _get_engine()
        async with engine.connect() as conn:
            result = await conn.execute(
                text(
                    "SELECT id, name, provider_type, api_key_encrypted, base_url, models, enabled "
                    "FROM model_providers "
                    "WHERE tenant_id = :t AND enabled = true"
                ),
                {"t": tenant_id},
            )
            for row in result:
                pid, pname, ptype, key, base_url, models_list, enabled = row
                for m in (models_list or []):
                    mid = m.get("id") if isinstance(m, dict) else m
                    if mid == model_id:
                        api_key = (key or "").strip()
                        if not api_key and ptype != "local":
                            api_key = os.environ.get("ANTHROPIC_API_KEY", "") if ptype == "anthropic" else ""
                        return ProviderConfig(
                            provider_type=ptype,
                            api_key=api_key,
                            base_url=base_url,
                            model=model_id,
                            provider_id=pid,
                            provider_name=pname,
                        )
    except Exception as exc:
        logger.warning("resolve_provider_for_model failed for tenant=%s model=%s: %s", tenant_id, model_id, exc)

    return _env_fallback(model_id)


async def resolve_provider(
    tenant_id: str,
    provider_id: Optional[str] = None,
    model: Optional[str] = None,
) -> ProviderConfig:
    """
    Look up the active model provider for the tenant.

    Priority:
      1. provider_id if given and the row exists for this tenant
      2. tenant's is_default=True provider
      3. tenant's first enabled provider
      4. env-based default (ANTHROPIC_API_KEY)
    """
    if not tenant_id:
        return _env_fallback(model)

    try:
        from sqlalchemy import text
        engine = _get_engine()
        async with engine.connect() as conn:
            row = None
            if provider_id:
                result = await conn.execute(
                    text(
                        "SELECT id, name, provider_type, api_key_encrypted, base_url, models, enabled "
                        "FROM model_providers WHERE id = :id AND tenant_id = :t"
                    ),
                    {"id": provider_id, "t": tenant_id},
                )
                row = result.first()

            if row is None:
                result = await conn.execute(
                    text(
                        "SELECT id, name, provider_type, api_key_encrypted, base_url, models, enabled "
                        "FROM model_providers WHERE tenant_id = :t AND enabled = true "
                        "ORDER BY is_default DESC, created_at ASC LIMIT 1"
                    ),
                    {"t": tenant_id},
                )
                row = result.first()

            if row is None:
                return _env_fallback(model)

            pid, pname, ptype, key, base_url, models_list, enabled = row
            if not enabled:
                return _env_fallback(model)

            chosen_model = model or _default_model_for(ptype, list(models_list or []))
            api_key = (key or "").strip()
            if not api_key and ptype != "local":
                api_key = os.environ.get("ANTHROPIC_API_KEY", "") if ptype == "anthropic" else ""
                if not api_key:
                    logger.warning("Provider %s for tenant %s has no API key, falling back to env", pid, tenant_id)
                    return _env_fallback(chosen_model)

            return ProviderConfig(
                provider_type=ptype,
                api_key=api_key,
                base_url=base_url,
                model=chosen_model,
                provider_id=pid,
                provider_name=pname,
            )
    except Exception as exc:
        logger.warning("resolve_provider failed for tenant=%s: %s — using env fallback", tenant_id, exc)
        return _env_fallback(model)


def resolve_provider_sync(
    tenant_id: str,
    provider_id: Optional[str] = None,
    model: Optional[str] = None,
) -> ProviderConfig:
    """Synchronous variant of resolve_provider for use from sync code paths."""
    if not tenant_id:
        return _env_fallback(model)

    try:
        from sqlalchemy import text
        engine = _get_sync_engine()
        with engine.connect() as conn:
            row = None
            if provider_id:
                row = conn.execute(
                    text(
                        "SELECT id, name, provider_type, api_key_encrypted, base_url, models, enabled "
                        "FROM model_providers WHERE id = :id AND tenant_id = :t"
                    ),
                    {"id": provider_id, "t": tenant_id},
                ).first()

            if row is None:
                row = conn.execute(
                    text(
                        "SELECT id, name, provider_type, api_key_encrypted, base_url, models, enabled "
                        "FROM model_providers WHERE tenant_id = :t AND enabled = true "
                        "ORDER BY is_default DESC, created_at ASC LIMIT 1"
                    ),
                    {"t": tenant_id},
                ).first()

            if row is None:
                return _env_fallback(model)

            pid, pname, ptype, key, base_url, models_list, enabled = row
            if not enabled:
                return _env_fallback(model)

            chosen_model = model or _default_model_for(ptype, list(models_list or []))
            api_key = (key or "").strip()
            if not api_key and ptype != "local":
                api_key = os.environ.get("ANTHROPIC_API_KEY", "") if ptype == "anthropic" else ""
                if not api_key:
                    return _env_fallback(chosen_model)

            return ProviderConfig(
                provider_type=ptype,
                api_key=api_key,
                base_url=base_url,
                model=chosen_model,
                provider_id=pid,
                provider_name=pname,
            )
    except Exception as exc:
        logger.warning("resolve_provider_sync failed for tenant=%s: %s — using env fallback", tenant_id, exc)
        return _env_fallback(model)


def make_anthropic_client(cfg: ProviderConfig):
    import anthropic
    kwargs = {"api_key": cfg.api_key}
    if cfg.base_url:
        kwargs["base_url"] = cfg.base_url
    return anthropic.Anthropic(**kwargs)


def make_async_anthropic_client(cfg: ProviderConfig):
    import anthropic
    kwargs = {"api_key": cfg.api_key}
    if cfg.base_url:
        kwargs["base_url"] = cfg.base_url
    return anthropic.AsyncAnthropic(**kwargs)


def make_openai_compat_client(cfg: ProviderConfig, async_client: bool = True):
    """
    Returns an OpenAI-compatible client. Works for OpenAI, Azure OpenAI,
    and local OpenAI-compatible servers (Ollama via /v1, vLLM, LM Studio).
    """
    import openai
    base_url = cfg.base_url
    if cfg.provider_type == "local" and base_url and not base_url.rstrip("/").endswith("/v1"):
        base_url = base_url.rstrip("/") + "/v1"
    api_key = cfg.api_key or "no-key"
    if async_client:
        return openai.AsyncOpenAI(api_key=api_key, base_url=base_url)
    return openai.OpenAI(api_key=api_key, base_url=base_url)


# ── Unified chat adapter ─────────────────────────────────────────────────────
# Returns: {"text": str, "input_tokens": int, "output_tokens": int, "model": str}

OPENAI_COMPAT_TYPES = {"openai", "azure_openai", "local"}


def _provider_supported(cfg: ProviderConfig) -> bool:
    return cfg.provider_type == "anthropic" or cfg.provider_type in OPENAI_COMPAT_TYPES


def _to_openai_messages(system: str, messages: list[dict]) -> list[dict]:
    out: list[dict] = []
    if system:
        out.append({"role": "system", "content": system})
    for m in messages:
        content = m.get("content", "")
        if isinstance(content, list):
            text_parts = []
            for block in content:
                if isinstance(block, dict) and block.get("type") == "text":
                    text_parts.append(block.get("text", ""))
            content = "\n".join(text_parts)
        out.append({"role": m["role"], "content": content})
    return out


async def chat_text_async(
    cfg: ProviderConfig,
    system: str,
    user_content: str,
    max_tokens: int = 4096,
) -> dict:
    """Single-turn text completion across providers."""
    if cfg.provider_type == "anthropic":
        client = make_async_anthropic_client(cfg)
        msg = await client.messages.create(
            model=cfg.model,
            max_tokens=max_tokens,
            system=system,
            messages=[{"role": "user", "content": user_content}],
        )
        text = msg.content[0].text if msg.content else ""
        return {
            "text": text,
            "input_tokens": getattr(msg.usage, "input_tokens", 0),
            "output_tokens": getattr(msg.usage, "output_tokens", 0),
            "model": cfg.model,
        }

    if cfg.provider_type in OPENAI_COMPAT_TYPES:
        client = make_openai_compat_client(cfg, async_client=True)
        resp = await client.chat.completions.create(
            model=cfg.model,
            max_tokens=max_tokens,
            messages=_to_openai_messages(system, [{"role": "user", "content": user_content}]),
        )
        text = resp.choices[0].message.content or ""
        usage = getattr(resp, "usage", None)
        return {
            "text": text,
            "input_tokens": getattr(usage, "prompt_tokens", 0) if usage else 0,
            "output_tokens": getattr(usage, "completion_tokens", 0) if usage else 0,
            "model": cfg.model,
        }

    raise NotImplementedError(f"Provider type '{cfg.provider_type}' not yet supported. Configure an Anthropic, OpenAI, Azure OpenAI, or Local provider.")


def chat_text_sync(
    cfg: ProviderConfig,
    system: str,
    user_content: str,
    max_tokens: int = 4096,
) -> dict:
    """Synchronous variant of chat_text_async."""
    if cfg.provider_type == "anthropic":
        client = make_anthropic_client(cfg)
        msg = client.messages.create(
            model=cfg.model,
            max_tokens=max_tokens,
            system=system,
            messages=[{"role": "user", "content": user_content}],
        )
        text = msg.content[0].text if msg.content else ""
        return {
            "text": text,
            "input_tokens": getattr(msg.usage, "input_tokens", 0),
            "output_tokens": getattr(msg.usage, "output_tokens", 0),
            "model": cfg.model,
        }

    if cfg.provider_type in OPENAI_COMPAT_TYPES:
        client = make_openai_compat_client(cfg, async_client=False)
        resp = client.chat.completions.create(
            model=cfg.model,
            max_tokens=max_tokens,
            messages=_to_openai_messages(system, [{"role": "user", "content": user_content}]),
        )
        text = resp.choices[0].message.content or ""
        usage = getattr(resp, "usage", None)
        return {
            "text": text,
            "input_tokens": getattr(usage, "prompt_tokens", 0) if usage else 0,
            "output_tokens": getattr(usage, "completion_tokens", 0) if usage else 0,
            "model": cfg.model,
        }

    raise NotImplementedError(f"Provider type '{cfg.provider_type}' not yet supported. Configure an Anthropic, OpenAI, Azure OpenAI, or Local provider.")


# ── Tool-using agentic loop adapter (Anthropic + OpenAI-compatible) ─────────
# Returns one round of: assistant text, tool calls, and usage.
# {
#   "text": str,
#   "tool_calls": [{"id": str, "name": str, "input": dict}],
#   "stop_reason": "end_turn" | "tool_use",
#   "input_tokens": int, "output_tokens": int,
# }


def _tools_to_openai(tool_defs: list[dict]) -> list[dict]:
    out = []
    for t in tool_defs or []:
        out.append({
            "type": "function",
            "function": {
                "name": t.get("name"),
                "description": t.get("description", ""),
                "parameters": t.get("input_schema", {"type": "object", "properties": {}}),
            },
        })
    return out


def _anthropic_messages_to_openai(messages: list[dict]) -> list[dict]:
    """Convert Anthropic-format messages (with content blocks) to OpenAI chat format."""
    out: list[dict] = []
    for m in messages:
        role = m.get("role")
        content = m.get("content")

        if isinstance(content, str):
            out.append({"role": role, "content": content})
            continue

        if not isinstance(content, list):
            out.append({"role": role, "content": str(content)})
            continue

        if role == "assistant":
            text_parts = []
            tool_calls = []
            for block in content:
                if not isinstance(block, dict):
                    continue
                btype = block.get("type")
                if btype == "text":
                    text_parts.append(block.get("text", ""))
                elif btype == "tool_use":
                    import json as _json
                    tool_calls.append({
                        "id": block.get("id"),
                        "type": "function",
                        "function": {
                            "name": block.get("name"),
                            "arguments": _json.dumps(block.get("input", {})),
                        },
                    })
            entry = {"role": "assistant", "content": "\n".join(text_parts) if text_parts else None}
            if tool_calls:
                entry["tool_calls"] = tool_calls
            out.append(entry)
        elif role == "user":
            text_parts = []
            tool_results = []
            for block in content:
                if not isinstance(block, dict):
                    continue
                btype = block.get("type")
                if btype == "text":
                    text_parts.append(block.get("text", ""))
                elif btype == "tool_result":
                    tool_results.append({
                        "role": "tool",
                        "tool_call_id": block.get("tool_use_id"),
                        "content": block.get("content", ""),
                    })
            if text_parts:
                out.append({"role": "user", "content": "\n".join(text_parts)})
            out.extend(tool_results)
        else:
            out.append({"role": role, "content": str(content)})
    return out


async def agent_turn_async(
    cfg: ProviderConfig,
    system: str,
    messages: list[dict],
    tool_defs: list[dict],
    max_tokens: int = 4096,
) -> dict:
    """One non-streaming agent round. Works for Anthropic and OpenAI-compatible."""
    if cfg.provider_type == "anthropic":
        client = make_async_anthropic_client(cfg)
        kwargs = {
            "model": cfg.model,
            "max_tokens": max_tokens,
            "system": system,
            "messages": messages,
        }
        if tool_defs:
            kwargs["tools"] = tool_defs
        resp = await client.messages.create(**kwargs)
        text_out = ""
        tool_calls = []
        for block in resp.content:
            if block.type == "text":
                text_out += block.text
            elif block.type == "tool_use":
                tool_calls.append({"id": block.id, "name": block.name, "input": block.input})
        return {
            "text": text_out,
            "tool_calls": tool_calls,
            "stop_reason": "tool_use" if resp.stop_reason == "tool_use" else "end_turn",
            "input_tokens": getattr(resp.usage, "input_tokens", 0),
            "output_tokens": getattr(resp.usage, "output_tokens", 0),
        }

    if cfg.provider_type in OPENAI_COMPAT_TYPES:
        import json as _json
        client = make_openai_compat_client(cfg, async_client=True)
        oai_messages = [{"role": "system", "content": system}] if system else []
        oai_messages.extend(_anthropic_messages_to_openai(messages))
        kwargs = {
            "model": cfg.model,
            "max_tokens": max_tokens,
            "messages": oai_messages,
        }
        if tool_defs:
            kwargs["tools"] = _tools_to_openai(tool_defs)
        resp = await client.chat.completions.create(**kwargs)
        choice = resp.choices[0]
        msg = choice.message
        text_out = msg.content or ""
        tool_calls = []
        for tc in (getattr(msg, "tool_calls", None) or []):
            try:
                input_obj = _json.loads(tc.function.arguments or "{}")
            except Exception:
                input_obj = {}
            tool_calls.append({"id": tc.id, "name": tc.function.name, "input": input_obj})
        usage = getattr(resp, "usage", None)
        stop_reason = "tool_use" if (choice.finish_reason == "tool_calls" or tool_calls) else "end_turn"
        return {
            "text": text_out,
            "tool_calls": tool_calls,
            "stop_reason": stop_reason,
            "input_tokens": getattr(usage, "prompt_tokens", 0) if usage else 0,
            "output_tokens": getattr(usage, "completion_tokens", 0) if usage else 0,
        }

    raise NotImplementedError(f"Provider type '{cfg.provider_type}' not yet supported.")
