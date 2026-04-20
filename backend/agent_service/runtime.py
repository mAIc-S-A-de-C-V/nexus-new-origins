"""
Agent Runtime — agentic loop with Claude tool_use.
Supports both synchronous (full response) and streaming (SSE) modes.
"""
import os
import json
from typing import Any, AsyncGenerator
import anthropic
from tools import get_tool_definitions, execute_tool
from shared.token_tracker import track_token_usage

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
) -> dict:
    """
    Run a full agentic loop (non-streaming).
    Returns: { messages: [...new messages including tool calls], final_text: str, iterations: int }
    """
    client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)
    tool_defs = get_tool_definitions(enabled_tools)

    messages = list(conversation_history)
    messages.append({"role": "user", "content": new_user_message})

    new_messages = [{"role": "user", "content": new_user_message}]
    iterations = 0

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

        response = client.messages.create(**kwargs)
        track_token_usage(tenant_id, "agent_service", model,
                          response.usage.input_tokens, response.usage.output_tokens)

        # Collect all content blocks from the response
        assistant_content = []
        final_text = ""

        for block in response.content:
            if block.type == "text":
                final_text += block.text
                assistant_content.append({"type": "text", "text": block.text})
            elif block.type == "tool_use":
                assistant_content.append({
                    "type": "tool_use",
                    "id": block.id,
                    "name": block.name,
                    "input": block.input,
                })

        # Add full assistant message
        messages.append({"role": "assistant", "content": assistant_content})
        new_messages.append({"role": "assistant", "content": assistant_content})

        # If no tool calls, we're done
        if response.stop_reason == "end_turn":
            return {
                "new_messages": new_messages,
                "final_text": final_text,
                "iterations": iterations,
            }

        # Process tool calls
        if response.stop_reason == "tool_use":
            tool_results = []
            for block in response.content:
                if block.type == "tool_use":
                    result = await execute_tool(block.name, block.input, tenant_id, agent_id, knowledge_scope=knowledge_scope, dry_run=dry_run)
                    tool_results.append({
                        "type": "tool_result",
                        "tool_use_id": block.id,
                        "content": json.dumps(result),
                    })

            tool_result_msg = {"role": "user", "content": tool_results}
            messages.append(tool_result_msg)
            new_messages.append(tool_result_msg)
            # Continue loop
        else:
            # Unexpected stop reason — break out
            break

    return {
        "new_messages": new_messages,
        "final_text": final_text if "final_text" in dir() else "",
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
) -> AsyncGenerator[str, None]:
    """
    SSE streaming agentic loop.
    Yields: data: <json>\n\n for each event.
    Event types: text_delta | tool_start | tool_result | done | error
    """
    client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)
    tool_defs = get_tool_definitions(enabled_tools)

    messages = list(conversation_history)
    messages.append({"role": "user", "content": new_user_message})

    iterations = 0

    def _sse(event: dict) -> str:
        return f"data: {json.dumps(event)}\n\n"

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
