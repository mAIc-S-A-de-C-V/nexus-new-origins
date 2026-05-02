"""
Agent Runtime — agentic loop with Claude tool_use.
Supports both synchronous (full response) and streaming (SSE) modes.
"""
import os
import json
from typing import Any, AsyncGenerator, Optional
from tools import get_tool_definitions, execute_tool
from shared.token_tracker import track_token_usage
from shared.llm_router import (
    resolve_provider,
    resolve_provider_for_model,
    make_anthropic_client,
    agent_turn_async,
    OPENAI_COMPAT_TYPES,
)


async def _resolve_for_agent(tenant_id: str, provider_id: Optional[str], model: str):
    """Pick the provider that actually serves `model` for this tenant.

    If `provider_id` is set explicitly, honor it (legacy/explicit path).
    Otherwise route by model id so that picking "GPT-OSS 120B" in Agent Studio
    hits the GPT-OSS provider, not the tenant's default.
    """
    if provider_id:
        return await resolve_provider(tenant_id, provider_id=provider_id, model=model)
    if model:
        return await resolve_provider_for_model(tenant_id, model)
    return await resolve_provider(tenant_id, provider_id=None, model=model)

ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY", "")


async def run_agent(
    agent_id: str,
    system_prompt: str,
    model: str,
    enabled_tools: list[str],
    max_iterations: int,
    conversation_history: list[dict],
    new_user_message: str,
    tenant_id: str,
    knowledge_scope: list[dict] | None = None,
    dry_run: bool = False,
    provider_id: Optional[str] = None,
) -> dict:
    """
    Run a full agentic loop (non-streaming).
    Returns: { messages: [...new messages including tool calls], final_text: str, iterations: int }
    """
    cfg = await _resolve_for_agent(tenant_id, provider_id, model)
    if cfg.provider_type not in ("anthropic",) and cfg.provider_type not in OPENAI_COMPAT_TYPES:
        cfg.provider_type = "anthropic"
        cfg.api_key = ANTHROPIC_API_KEY
        cfg.model = model
    tool_defs = get_tool_definitions(enabled_tools)

    messages = list(conversation_history)
    messages.append({"role": "user", "content": new_user_message})

    new_messages = [{"role": "user", "content": new_user_message}]
    iterations = 0
    final_text = ""

    while iterations < max_iterations:
        iterations += 1

        turn = await agent_turn_async(
            cfg=cfg,
            system=system_prompt,
            messages=messages,
            tool_defs=tool_defs,
            max_tokens=4096,
        )
        track_token_usage(tenant_id, "agent_service", cfg.model,
                          turn["input_tokens"], turn["output_tokens"])

        assistant_content: list[dict] = []
        final_text = turn["text"] or final_text
        if turn["text"]:
            assistant_content.append({"type": "text", "text": turn["text"]})
        for tc in turn["tool_calls"]:
            assistant_content.append({
                "type": "tool_use",
                "id": tc["id"],
                "name": tc["name"],
                "input": tc["input"],
            })

        messages.append({"role": "assistant", "content": assistant_content})
        new_messages.append({"role": "assistant", "content": assistant_content})

        if turn["stop_reason"] == "end_turn" or not turn["tool_calls"]:
            return {
                "new_messages": new_messages,
                "final_text": final_text,
                "iterations": iterations,
            }

        tool_results = []
        for tc in turn["tool_calls"]:
            result = await execute_tool(tc["name"], tc["input"], tenant_id, agent_id, knowledge_scope=knowledge_scope, dry_run=dry_run)
            tool_results.append({
                "type": "tool_result",
                "tool_use_id": tc["id"],
                "content": json.dumps(result),
            })

        tool_result_msg = {"role": "user", "content": tool_results}
        messages.append(tool_result_msg)
        new_messages.append(tool_result_msg)

    return {
        "new_messages": new_messages,
        "final_text": final_text,
        "iterations": iterations,
        "error": f"Reached max iterations ({max_iterations})",
    }


async def stream_agent(
    agent_id: str,
    system_prompt: str,
    model: str,
    enabled_tools: list[str],
    max_iterations: int,
    conversation_history: list[dict],
    new_user_message: str,
    tenant_id: str,
    knowledge_scope: list[dict] | None = None,
    dry_run: bool = False,
    provider_id: Optional[str] = None,
) -> AsyncGenerator[str, None]:
    """
    SSE streaming agentic loop.
    Yields: data: <json>\n\n for each event.
    Event types: text_delta | tool_start | tool_result | done | error
    """
    cfg = await _resolve_for_agent(tenant_id, provider_id, model)
    if cfg.provider_type not in ("anthropic",) and cfg.provider_type not in OPENAI_COMPAT_TYPES:
        cfg.provider_type = "anthropic"
        cfg.api_key = ANTHROPIC_API_KEY
        cfg.model = model
    tool_defs = get_tool_definitions(enabled_tools)

    messages = list(conversation_history)
    messages.append({"role": "user", "content": new_user_message})

    iterations = 0

    def _sse(event: dict) -> str:
        return f"data: {json.dumps(event)}\n\n"

    if cfg.provider_type in OPENAI_COMPAT_TYPES:
        while iterations < max_iterations:
            iterations += 1
            try:
                turn = await agent_turn_async(
                    cfg=cfg,
                    system=system_prompt,
                    messages=messages,
                    tool_defs=tool_defs,
                    max_tokens=4096,
                )
            except Exception as exc:
                yield _sse({"type": "error", "error": str(exc), "iterations": iterations})
                return

            track_token_usage(tenant_id, "agent_service", cfg.model,
                              turn["input_tokens"], turn["output_tokens"])

            if turn["text"]:
                yield _sse({"type": "text_delta", "text": turn["text"]})

            assistant_content: list[dict] = []
            if turn["text"]:
                assistant_content.append({"type": "text", "text": turn["text"]})
            for tc in turn["tool_calls"]:
                assistant_content.append({"type": "tool_use", "id": tc["id"], "name": tc["name"], "input": tc["input"]})
                yield _sse({"type": "tool_start", "tool": tc["name"], "tool_use_id": tc["id"]})

            messages.append({"role": "assistant", "content": assistant_content})

            if turn["stop_reason"] == "end_turn" or not turn["tool_calls"]:
                yield _sse({"type": "done", "iterations": iterations})
                return

            tool_results = []
            for tc in turn["tool_calls"]:
                yield _sse({"type": "tool_calling", "tool": tc["name"], "input": tc["input"]})
                try:
                    result = await execute_tool(tc["name"], tc["input"], tenant_id, agent_id, knowledge_scope=knowledge_scope, dry_run=dry_run)
                except Exception as exc:
                    result = {"error": str(exc)}
                yield _sse({"type": "tool_result", "tool": tc["name"], "result": result})
                tool_results.append({"type": "tool_result", "tool_use_id": tc["id"], "content": json.dumps(result)})
            messages.append({"role": "user", "content": tool_results})

        yield _sse({"type": "done", "iterations": iterations, "error": f"Reached max iterations ({max_iterations})"})
        return

    client = make_anthropic_client(cfg)
    model = cfg.model

    while iterations < max_iterations:
        iterations += 1

        kwargs: dict[str, Any] = {
            "model": model,
            "max_tokens": 4096,
            "system": system_prompt,
            "messages": messages,
        }
        if tool_defs:
            kwargs["tools"] = tool_defs

        assistant_content = []
        current_text = ""
        final_text = ""
        stop_reason = "end_turn"

        try:
            with client.messages.stream(**kwargs) as stream:
                current_tool_use = None
                current_tool_json = ""

                for event in stream:
                    if event.type == "content_block_start":
                        if hasattr(event.content_block, "type"):
                            if event.content_block.type == "tool_use":
                                # Flush any accumulated text block first
                                if current_text:
                                    assistant_content.append({"type": "text", "text": current_text})
                                    final_text = current_text
                                    current_text = ""
                                current_tool_use = {
                                    "id": event.content_block.id,
                                    "name": event.content_block.name,
                                    "input": {},
                                }
                                current_tool_json = ""
                                yield _sse({"type": "tool_start", "tool": event.content_block.name, "tool_use_id": event.content_block.id})
                            elif event.content_block.type == "text":
                                current_text = ""

                    elif event.type == "content_block_delta":
                        if hasattr(event.delta, "type"):
                            if event.delta.type == "text_delta":
                                current_text += event.delta.text
                                yield _sse({"type": "text_delta", "text": event.delta.text})
                            elif event.delta.type == "input_json_delta":
                                current_tool_json += event.delta.partial_json

                    elif event.type == "content_block_stop":
                        if current_tool_use is not None:
                            try:
                                current_tool_use["input"] = json.loads(current_tool_json) if current_tool_json else {}
                            except Exception:
                                current_tool_use["input"] = {}
                            assistant_content.append({"type": "tool_use", **current_tool_use})
                            current_tool_use = None
                            current_tool_json = ""
                        elif current_text:
                            assistant_content.append({"type": "text", "text": current_text})
                            final_text = current_text
                            current_text = ""

                final_msg = stream.get_final_message()
                stop_reason = final_msg.stop_reason
                track_token_usage(tenant_id, "agent_service", model,
                                  final_msg.usage.input_tokens, final_msg.usage.output_tokens)

        except Exception as exc:
            yield _sse({"type": "error", "error": str(exc), "iterations": iterations})
            return

        messages.append({"role": "assistant", "content": assistant_content})

        if stop_reason == "end_turn":
            yield _sse({"type": "done", "iterations": iterations})
            return

        if stop_reason == "tool_use":
            tool_results = []
            for block in assistant_content:
                if block.get("type") == "tool_use":
                    yield _sse({"type": "tool_calling", "tool": block["name"], "input": block["input"]})
                    try:
                        result = await execute_tool(block["name"], block["input"], tenant_id, agent_id, knowledge_scope=knowledge_scope, dry_run=dry_run)
                    except Exception as exc:
                        result = {"error": str(exc)}
                    yield _sse({"type": "tool_result", "tool": block["name"], "result": result})
                    tool_results.append({
                        "type": "tool_result",
                        "tool_use_id": block["id"],
                        "content": json.dumps(result),
                    })
            messages.append({"role": "user", "content": tool_results})
        else:
            break

    yield _sse({"type": "done", "iterations": iterations, "error": f"Reached max iterations ({max_iterations})"})
