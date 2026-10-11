"""LangChain tools for the original Buyer customer workflow.

No model provider is required. Pass these tools to a LangChain agent or ToolNode,
or invoke them with a normal ToolCall envelope. Full response pages remain in
ToolMessage.artifact; model-visible content has an explicit cap.
"""
from __future__ import annotations

import asyncio
import json
from typing import Literal

from .agent_workflow import CustomerWorkflow, _error, _url
from .errors import BuyerError, StateError

try:
    from langchain_core.tools import StructuredTool
    from pydantic import BaseModel, ConfigDict, Field
except ImportError:
    raise StateError("INSTALL_STELLAR_FORGE_BUYER_AGENTS_EXTRA") from None


class _Arguments(BaseModel):
    model_config = ConfigDict(extra="forbid")


class PageArguments(_Arguments):
    offset: int = Field(default=0, ge=0)
    limit: int = Field(default=20, ge=1, le=100)


class IntentArguments(_Arguments):
    intent_id: str = Field(min_length=1, max_length=160,
                           description="The existing original Buyer intent identifier.")


class RunArguments(_Arguments):
    run_id: str = Field(min_length=1, max_length=160,
                       description="The stable customer run identifier; reuse it after restart.")


class RegisterArguments(RunArguments, IntentArguments):
    format: Literal["auto", "json", "csv", "binary", "sse", "ndjson", "paid-file"] = "auto"
    allow_partial: bool = Field(default=False,
        description="Allow the native reader's retained complete-record prefix of an interrupted stream.")


class ResumeArguments(RunArguments):
    action: Literal["execute", "recover", "review", "cancel"] = "recover"
    review_key: str | None = Field(default=None, pattern=r"^[0-9a-f]{64}$",
        description="Exact key from the current original-review interruption; required for execute.")


class ReadArguments(RunArguments, PageArguments):
    pointer: str = Field(default="", max_length=2048,
        description="JSON Pointer into each NDJSON/CSV value or JSON document; default returns whole values.")
    event_json: bool = Field(default=False,
        description="For SSE only: explicitly parse each event's data as JSON before applying pointer.")


def _operation_summary(record):
    request = record.get("request") or {}
    result = {"intent_id": record["intentId"], "state": record["state"],
              "method": request.get("method"), **_url(request.get("url")),
              "native_status": record.get("nativeStatus"),
              "delivery_status": record.get("deliveryStatus"),
              "result_recoverable": record.get("resultRecoverable", False),
              "file_promise": record.get("filePromise")}
    if record.get("fileDelivery"):
        original = record["fileDelivery"]
        native = original.get("native") or {}
        result["file_delivery"] = {"state": original.get("state"), "status": native.get("status"),
                                   "returncode": original.get("returncode"),
                                   "runtime_error": original.get("runtimeError"),
                                   "http_requests": native.get("httpRequests")}
    return result


def create_tools(workflow: CustomerWorkflow, *, prefix="stellar_forge", max_content_chars=6000,
                 file_options_by_intent=None):
    """Return typed tools bound to one private customer workspace.

    The host prepares requests with Buyer.prepare/from_workspace/from_paid_file,
    including its private native operator profile. Tools select those original
    intents and exact saved reviews. Bind file destinations and claim environment
    variable names through file_options_by_intent; secret values are never tool
    arguments. Async tools use a worker thread, preserving original SQLite and
    operation locks. A busy operation is returned as an ordinary error.
    """
    if (not isinstance(prefix, str) or not prefix or len(prefix) > 80
            or any(character not in "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-" for character in prefix)):
        raise StateError("AGENT_TOOL_PREFIX_INVALID")
    if type(max_content_chars) is not int or not 1000 <= max_content_chars <= 50000:
        raise StateError("AGENT_TOOL_CONTENT_LIMIT_INVALID")
    file_options = {key: dict(value) for key, value in dict(file_options_by_intent or {}).items()}

    def reply(artifact):
        raw = json.dumps(artifact, ensure_ascii=True, allow_nan=False, separators=(",", ":"))
        if len(raw) <= max_content_chars:
            return raw, artifact
        summary = {"content_truncated": True, "artifact_available": True,
                   "characters": len(raw), "preview": raw[:max_content_chars - 400]}
        content = json.dumps(summary, ensure_ascii=True, separators=(",", ":"))
        while len(content) > max_content_chars:
            excess = len(content) - max_content_chars
            summary["preview"] = summary["preview"][:max(0, len(summary["preview"]) - excess)]
            content = json.dumps(summary, ensure_ascii=True, separators=(",", ":"))
        return content, artifact

    def expose(function):
        def call(**arguments):
            try:
                return reply(function(**arguments))
            except (BuyerError, OSError) as error:
                return reply({"status": "ERROR", "error": _error(error)})
        return call

    def tool(name, description, schema, function):
        call = expose(function)

        async def async_call(**arguments):
            return await asyncio.to_thread(call, **arguments)

        return StructuredTool.from_function(func=call, coroutine=async_call,
            name=prefix + "_" + name, description=description, args_schema=schema,
            infer_schema=False, response_format="content_and_artifact")

    def operations(offset=0, limit=20):
        items = [_operation_summary(operation.inspect()) for operation in workflow.buyer.list_operations()]
        if offset > len(items):
            raise StateError("AGENT_RECORD_PAGE_INVALID")
        page = items[offset:offset + limit]
        return {"operations": page, "total": len(items), "offset": offset,
                "next_offset": offset + len(page) if offset + len(page) < len(items) else None}

    def operation(intent_id):
        return _operation_summary(workflow.buyer.operation(intent_id).inspect())

    def runs(offset=0, limit=20):
        items = list(workflow.list_runs())
        if offset > len(items):
            raise StateError("AGENT_RECORD_PAGE_INVALID")
        page = items[offset:offset + limit]
        return {"runs": page, "total": len(items), "offset": offset,
                "next_offset": offset + len(page) if offset + len(page) < len(items) else None}

    def register(run_id, intent_id, format="auto", allow_partial=False):
        return workflow.register(run_id, intent_id=intent_id, format=format,
                                 allow_partial=allow_partial,
                                 file_options=file_options.get(intent_id))

    return [
        tool("operations", "List retained original Buyer intents and delivery state; no network call.",
             PageArguments, operations),
        tool("operation", "Inspect one retained original intent, request route and native delivery state.",
             IntentArguments, operation),
        tool("runs", "List persistent customer graph runs and their pending decisions.", PageArguments, runs),
        tool("register", "Bind a stable customer run to an existing original intent and a response format. "
             "The same identifier reopens the same binding. Use paid-file for its native product delivery.",
             RegisterArguments, register),
        tool("start", "Start or reopen the customer workflow. Recover completed original data first; "
             "a prepared intent returns its exact native review for selection before execution.",
             RunArguments, workflow.start),
        tool("inspect", "Read saved graph status, native outcome and the current review or recovery interruption.",
             RunArguments, workflow.inspect),
        tool("resume", "Continue a pending customer decision. Execute uses the exact selected review key "
             "and original configured payment/operator authority. Recover reopens the same original "
             "attempt or retained transfer. Cancel ends this customer graph.", ResumeArguments, workflow.resume),
        tool("read", "Read a page of verified retained JSON, CSV, NDJSON, SSE events or file metadata. "
             "Reading never repeats the request. Complete=false preserves a selected interrupted prefix.",
             ReadArguments, workflow.read),
        tool("export", "Copy the retained response, original native receipt and typed records into the private "
             "customer handoff directory. Return file and manifest digests; repeated calls reopen it.",
             RunArguments, workflow.export),
    ]
