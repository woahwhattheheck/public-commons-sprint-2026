"""Counterpress optional paid insight — Microsoft Agent Framework worker.

Runs the football-insight workflow through the REAL SDK layering from
agent-framework-core==1.21.0:

    OpusRunnerChatClientWithLayers(
        FunctionInvocationLayer,      # real tool loop: invokes the two
        ChatMiddlewareLayer,          # registered read-only callables and
        ChatTelemetryLayer,           # appends matched function_results
        OpusRunnerChatClient,         # custom BaseChatClient
    )

The custom client speaks to NO provider SDK or HTTP API. Every model turn
is a subprocess call to the operator's existing guarded budget runner
(run_paid_api.py, original $200 pool) via a CP_OPUS_*-supplied argv; the
runner returns final TEXT only, so the strict text decision protocol in
decision_protocol.py is translated into official
Content.from_function_call objects. That translation is NOT native
Anthropic tool calling and is never described as such. The
FunctionInvocationLayer then executes the genuinely registered Python
functions and feeds real results back on the next turn.

Budgets: at most 3 paid model turns and 2 local tool calls per workflow
(max_iterations=2 phase-2 turns + one tool_choice='none' final turn,
max_function_calls=2, plus a hard client-side turn counter). A held /
unknown / refusal / max_tokens receipt is never replayed or re-sent.

Input: one JSON object on stdin (or --context-file) —
  {"context": {sessionId,count,team,audience,locale,frameSecond,momentId},
   "facts":   {match: {...public synthetic facts...},
               latestMoment: {...public synthetic moment...}}}
Output: one JSON object on stdout — status ready|held|unavailable with
caption/insight only on a real completed run; tool-call and per-turn
receipt provenance are included. No secrets, paths, env or raw model
content beyond the bounded final fields are emitted.

This implementation follows the pinned official custom-client composition
(fd52de71579162a888fb2dd7510c57c6014dcdfc, core 1.21.0). The original
native run and its per-turn provider records accompany the receiving guide.
See AGENT_FRAMEWORK.md for installation, source and operation continuity.
"""
from __future__ import annotations

import asyncio
import hashlib
import importlib.metadata
import json
import os
import subprocess
import sys
import tempfile
import time
from collections.abc import Awaitable, Mapping, Sequence
from pathlib import Path
from typing import Any, ClassVar, TypedDict

_HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(_HERE))
from decision_protocol import (  # noqa: E402  (local sibling import)
    ALLOWED_TOOLS,
    EFFORT,
    MAX_OUTPUT_TOKENS,
    MAX_PAID_TURNS,
    MODEL,
    PROMPT_VERSION,
    DecisionError,
    call_id_for,
    parse_decision,
    turn_job_id,
    validate_context,
    validate_facts,
    workflow_id_for,
)

SDK_REQUIREMENT = "agent-framework-core==1.21.0"
TURN_HARD_TIMEOUT_S = None  # a running paid child is never killed (matches Node side)
JOB_DIR_STATE_HELD = "held"

try:
    from agent_framework import (
        Agent,
        BaseChatClient,
        ChatMiddlewareLayer,
        ChatResponse,
        ChatResponseUpdate,
        Content,
        FunctionInvocationLayer,
        Message,
        ResponseStream,
    )
    from agent_framework.observability import ChatTelemetryLayer

    try:
        SDK_VERSION = importlib.metadata.version("agent-framework-core")
    except importlib.metadata.PackageNotFoundError:
        SDK_VERSION = None
    _IMPORT_ERROR = None
except ImportError as exc:  # pragma: no cover - exercised only without the SDK
    Agent = BaseChatClient = ChatMiddlewareLayer = None  # type: ignore[assignment]
    ChatResponse = ChatResponseUpdate = Content = Message = ResponseStream = None  # type: ignore[assignment]
    FunctionInvocationLayer = ChatTelemetryLayer = None  # type: ignore[assignment]
    Agent = None  # type: ignore[assignment]
    SDK_VERSION = None
    _IMPORT_ERROR = repr(exc)


class WorkerHeld(Exception):
    """A held/unavailable provider or protocol state. Never retried in-process."""

    def __init__(self, reason: str, detail: str | None = None):
        super().__init__(reason)
        self.reason = reason
        self.detail = detail


# Public, newly-written application instruction — fixed product text only.
# It is NOT boot/system prompt content and contains no private context.
PUBLIC_INSTRUCTIONS = (
    "You write a short optional viewing insight for Counterpress Compass, a "
    "football viewing product playing an invented synthetic match feed. "
    "You must invoke at least one provided football tool before finishing. "
    "On every turn reply with strict JSON only, no markdown, exactly one of:\n"
    '  {"action":"tool","name":"get_match_state","arguments":{}}\n'
    '  {"action":"tool","name":"get_latest_moment","arguments":{}}\n'
    '  {"action":"final","caption":"...","insight":"..."}\n'
    "Caption: at most 135 characters. Insight: 1-4 sentences for the "
    "requested audience in the requested language. Ground every claim ONLY "
    "in facts returned by the tools. Never invent events, scores, outcomes, "
    "future events, exact positions, distances, speeds or real people. The "
    "display guard rejects every reply that mentions scores, goals, shots, "
    "penalties, cards, offsides, expected goals or percentages - even to "
    "deny them - and every number that does not appear in the match facts. "
    "When told tools are finished, reply only with the final decision."
)


def _resolve_runner(env):
    """Resolve the operator-supplied runner argv.

    CP_OPUS_BUDGET_RUNNER may be either a JSON argv array or a plain absolute
    path to run_paid_api.py (with optional CP_OPUS_PYTHON). Any shape error
    is a config-unavailable state, never a fallback to another transport.
    """
    raw = env.get("CP_OPUS_BUDGET_RUNNER") or ""
    if not raw:
        return None
    argv = None
    runner_path = None
    try:
        parsed = json.loads(raw)
        if isinstance(parsed, list) and parsed and all(isinstance(x, str) for x in parsed):
            argv = list(parsed)
    except (ValueError, TypeError):
        pass
    if argv is None:
        p = Path(raw)
        if p.is_absolute() and p.name == "run_paid_api.py" and p.is_file():
            runner_path = p
            py = env.get("CP_OPUS_PYTHON") or "python"
            argv = [py, str(p)]
    else:
        for a in argv:
            if Path(a).name == "run_paid_api.py":
                runner_path = Path(a)
                break
    if argv is None or runner_path is None:
        return None
    if not runner_path.is_absolute() or runner_path.name != "run_paid_api.py" or not runner_path.is_file():
        return None
    # Same derivation as the Node adapter: ROOT = runner.parents[2];
    # jobs live under ROOT/work/api-jobs/<job_id>/.
    jobs_root = runner_path.resolve().parents[2] / "work" / "api-jobs"
    return {"argv": argv, "jobs_root": jobs_root}


def _render_transcript(messages) -> str:
    """Render the SDK message list (incl. tool results) as plain text for the
    text-only guarded runner. Unsupported content types are marked, never
    silently dropped."""
    lines = []
    for m in messages:
        role = getattr(m, "role", "unknown")
        for c in getattr(m, "contents", []) or []:
            ctype = getattr(c, "type", None)
            if ctype == "text":
                lines.append(f"[{role}] {getattr(c, 'text', '')}")
            elif ctype == "function_call":
                lines.append(json.dumps({
                    "role": "assistant", "action": "tool",
                    "name": getattr(c, "name", None),
                    "arguments": getattr(c, "arguments", {}) or {},
                    "call_id": getattr(c, "call_id", None)}))
            elif ctype == "function_result":
                lines.append(json.dumps({
                    "role": "tool", "call_id": getattr(c, "call_id", None),
                    "result": getattr(c, "result", None)}))
            else:
                lines.append(f"[{role}] <{ctype or 'unknown'} content omitted>")
    return "\n".join(lines)


def _tool_specs(options):
    """Describe the run-local tools the SDK layer shares via options['tools'].

    Names are filtered to the two-callable read-only whitelist; descriptions
    come from the normalized tool entries when available."""
    specs = []
    for t in (options.get("tools") or []):
        name = getattr(t, "name", None) or getattr(t, "__name__", None)
        if name is None and isinstance(t, dict):
            name = t.get("name")
        if name not in ALLOWED_TOOLS:
            continue
        desc = getattr(t, "description", None)
        if desc is None and isinstance(t, dict):
            desc = t.get("description")
        specs.append({"name": name, "description": desc or "read-only synthetic match facts, no arguments",
                      "arguments": {}})
    if not specs:  # honest fallback identical to the whitelist
        specs = [{"name": n, "description": "read-only synthetic match facts, no arguments",
                  "arguments": {}} for n in ALLOWED_TOOLS]
    return specs


def _build_turn_prompt(messages, options) -> str:
    final_only = options.get("tool_choice") == "none"
    tools = _tool_specs(options)
    parts = [
        "You are in a tool-use workflow. Reply with strict JSON only.",
        "Allowed tools (read-only, zero arguments): " + json.dumps(tools),
        "Hard reply limits, enforced by rejection: caption at most 135 "
        "characters; insight 1-4 sentences only. Any final that exceeds "
        "them is discarded entirely. The display guard also discards any "
        "final mentioning scores, goals, shots, penalties, cards, "
        "offsides, expected goals or percentages - even to deny them - "
        "and any number absent from the match facts in the transcript.",
    ]
    if final_only:
        parts.append('Tools are finished for this request. Reply ONLY with '
                     '{"action":"final","caption":"...","insight":"..."} '
                     'where caption is at most 135 characters and insight '
                     'is 1-4 sentences.')
    else:
        parts.append('Reply {"action":"tool","name":<allowed>,"arguments":{}} '
                     'to call a tool, or {"action":"final","caption":"...","insight":"..."} '
                     "to finish after at least one tool call.")
    parts.append("TRANSCRIPT:")
    parts.append(_render_transcript(messages))
    return "\n".join(parts)


if _IMPORT_ERROR is None:

    class OpusRunnerOptions(TypedDict, total=False):
        """Custom options for OpusRunnerChatClient (none currently used)."""

    class OpusRunnerChatClient(BaseChatClient[OpusRunnerOptions]):
        """Custom chat client whose only transport is the operator's existing
        guarded budget-runner subprocess. Produces real SDK Content objects:
        a validated tool decision becomes Content.from_function_call which the
        FunctionInvocationLayer executes; a validated final decision becomes
        assistant text. Text-only adapter — not native provider tool calling."""

        OTEL_PROVIDER_NAME: ClassVar[str] = "CounterpressOpusRunnerChatClient"

        def __init__(self, *, runner_argv, jobs_root, work_dir, workflow_id, **kwargs):
            super().__init__(**kwargs)
            self._runner_argv = list(runner_argv)
            self._jobs_root = Path(jobs_root)
            self._work_dir = Path(work_dir)
            self._work_dir.mkdir(parents=True, exist_ok=True)
            self._workflow_id = workflow_id
            self._turn = 0
            self.turn_records = []
            self.tool_calls = []
            self.last_final = None

        def _journal(self, event):
            entry = {"ts": time.time(), "workflow_id": self._workflow_id, **event}
            with open(self._work_dir / "journal.jsonl", "a", encoding="utf8") as f:
                f.write(json.dumps(entry) + "\n")

        def _read_receipt(self, job_id):
            try:
                return json.loads((self._jobs_root / job_id / "receipt.json").read_text(encoding="utf8"))
            except FileNotFoundError:
                return None
            except (OSError, ValueError):
                raise WorkerHeld("receipt_unreadable", job_id)

        def _existing_response(self, job_id, receipt):
            if not (receipt and receipt.get("state") == "RESPONDED"
                    and receipt.get("stop_reason") == "end_turn"
                    and receipt.get("artifact_saved") is True):
                return None
            try:
                return (self._jobs_root / job_id / "response.txt").read_text(encoding="utf8")
            except OSError:
                raise WorkerHeld("artifact_unreadable", job_id)

        def _turn_sync(self, prompt, final_only):
            # _respond increments before this call: preserve original one-based job IDs.
            turn = self._turn
            if turn > MAX_PAID_TURNS:
                raise WorkerHeld("paid_turn_budget_exhausted")
            prompt_sha = hashlib.sha256(prompt.encode("utf8")).hexdigest()
            job_id = turn_job_id(self._workflow_id, turn, prompt_sha)

            receipt = self._read_receipt(job_id)
            if receipt is not None:
                # Pending journal written before any new effect; a known receipt
                # is terminal evidence and is NEVER re-dispatched.
                self._journal({"event": "receipt_reconciled", "job_id": job_id,
                               "turn": turn, "prompt_sha256": prompt_sha,
                               "receipt_state": receipt.get("state")})
                text = self._existing_response(job_id, receipt)
                if text is None:
                    raise WorkerHeld("receipt_held", f"{job_id}:{receipt.get('state')}/"
                                     f"{receipt.get('stop_reason')}")
            else:
                self._journal({"event": "turn_pending", "job_id": job_id, "turn": turn,
                               "prompt_sha256": prompt_sha})
                fd, prompt_path = tempfile.mkstemp(prefix="cpaf-prompt-", dir=self._work_dir)
                try:
                    with os.fdopen(fd, "w", encoding="utf8") as f:
                        f.write(prompt)
                    argv = [*self._runner_argv, job_id, "--prompt", prompt_path,
                            "--model", MODEL, "--max-tokens", str(MAX_OUTPUT_TOKENS),
                            "--effort", EFFORT]
                    proc = subprocess.run(argv, capture_output=True, text=True,
                                          timeout=TURN_HARD_TIMEOUT_S, shell=False)
                    self._journal({"event": "turn_returned", "job_id": job_id, "turn": turn,
                                   "returncode": proc.returncode,
                                   "stderr_tail": (proc.stderr or "").strip()[-400:]})
                finally:
                    try:
                        os.unlink(prompt_path)
                    except OSError:
                        pass
                receipt = self._read_receipt(job_id)
                text = self._existing_response(job_id, receipt)
                if text is None:
                    raise WorkerHeld("provider_held", f"{job_id}:"
                                     f"{(receipt or {}).get('state')}/"
                                     f"{(receipt or {}).get('stop_reason')}")

            rec = {"turn": turn, "job_id": job_id, "prompt_sha256": prompt_sha,
                   "request_id": receipt.get("request_id") if receipt else None,
                   "receipt_state": receipt.get("state") if receipt else None}
            decision = parse_decision(text)
            rec["model_text_bytes"] = len(text.encode("utf8"))

            if decision is None:
                rec["decision"] = "invalid_final_text"
            elif decision[0] == "tool":
                _, name, args = decision
                if final_only or len(self.tool_calls) >= 2:
                    rec["decision"] = "tool_rejected_limit"
                else:
                    cid = call_id_for(self._workflow_id, turn, name)
                    rec["decision"] = f"tool:{name}"
                    rec["call_id"] = cid
                    self.tool_calls.append({"call_id": cid, "name": name,
                                            "job_id": job_id})
            else:
                _, caption, insight = decision
                rec["decision"] = "final"
                self.last_final = {"caption": caption, "insight": insight}

            self.turn_records.append(rec)
            return decision, rec

        def _inner_get_response(
            self,
            *,
            messages: Sequence[Message],
            stream: bool = False,
            options: Mapping[str, Any],
            **kwargs: Any,
        ):
            """One paid model turn through the guarded runner."""
            if stream:
                raise WorkerHeld("stream_unsupported",
                                 "the guarded text runner is non-streaming")

            async def _respond():
                await self._validate_options(options)
                turn = self._turn
                self._turn += 1
                prompt = _build_turn_prompt(messages, options)
                final_only = options.get("tool_choice") == "none"
                decision, rec = await asyncio.to_thread(
                    self._turn_sync, prompt, final_only)

                if rec["decision"].startswith("tool:"):
                    content = Content.from_function_call(
                        rec["call_id"], decision[1], arguments=decision[2])
                    message = Message(role="assistant", contents=[content])
                else:
                    # Invalid/final/rejected-tool decisions all surface as
                    # ordinary assistant text (no fabricated function call).
                    text_out = json.dumps(self.last_final) if rec["decision"] == "final" \
                        else "unavailable"
                    message = Message(role="assistant", contents=[text_out])
                return ChatResponse(messages=[message], model=MODEL,
                                    response_id=rec["job_id"])

            return _respond()

    class OpusRunnerChatClientWithLayers(  # type: ignore[misc]
        FunctionInvocationLayer[OpusRunnerOptions],
        ChatMiddlewareLayer[OpusRunnerOptions],
        ChatTelemetryLayer[OpusRunnerOptions],
        OpusRunnerChatClient,
    ):
        """Official composition order from the core 1.21.0 custom-client sample:
        FunctionInvocationLayer -> ChatMiddlewareLayer -> ChatTelemetryLayer,
        so middleware runs inside each tool-loop iteration and telemetry wraps
        each service call. No exporter is configured; nothing leaves the host."""

        OTEL_PROVIDER_NAME: ClassVar[str] = "CounterpressOpusRunnerChatClientWithLayers"


def _emit(obj):
    sys.stdout.write(json.dumps(obj, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def _result_base(workflow_id, context):
    return {
        "status": "unavailable",
        "workflow_id": workflow_id,
        "prompt_version": PROMPT_VERSION,
        "model": MODEL,
        "sdk": {"package": "agent-framework-core",
                "required_version": "1.21.0",
                "imported_version": SDK_VERSION},
        "adapter": "guarded text-runner -> strict JSON decision -> "
                   "Content.from_function_call (not native provider tool calling)",
        "context": context,
        "turns": [],
        "tool_calls": [],
        "tool_invocations": {},
        "held_reason": None,
    }


async def _run(payload, env):
    context = validate_context(payload.get("context"))
    facts = validate_facts(payload.get("facts"))
    workflow_id = workflow_id_for(context)
    out = _result_base(workflow_id, context)

    if _IMPORT_ERROR is not None:
        out["held_reason"] = "sdk_not_installed"
        return out
    runner = _resolve_runner(env)
    if runner is None:
        out["held_reason"] = "runner_not_configured"
        return out

    match_blob = json.dumps(facts.get("match", {}), ensure_ascii=False, sort_keys=True)
    moment_blob = json.dumps(facts.get("latestMoment", {}), ensure_ascii=False, sort_keys=True)
    invocations = {"get_match_state": 0, "get_latest_moment": 0}

    def get_match_state():
        """Return the supplied public synthetic match-state facts."""
        invocations["get_match_state"] += 1
        return json.loads(match_blob)

    def get_latest_moment():
        """Return the supplied public synthetic latest-moment facts."""
        invocations["get_latest_moment"] += 1
        return json.loads(moment_blob)

    work_dir = env.get("CP_OPUS_WORK_DIR")
    if work_dir:
        wd = Path(work_dir)
    else:
        wd = Path(tempfile.mkdtemp(prefix="cpaf-"))

    client = OpusRunnerChatClientWithLayers(
        runner_argv=runner["argv"],
        jobs_root=runner["jobs_root"],
        work_dir=wd,
        workflow_id=workflow_id,
        function_invocation_configuration={
            "enabled": True,
            # Two phase-2 turns + one tool_choice='none' phase-3 final = at
            # most MAX_PAID_TURNS paid runner calls; at most MAX_TOOL_CALLS
            # real local tool invocations.
            "max_iterations": 2,
            "max_function_calls": MAX_PAID_TURNS - 1,
            "max_duration_seconds": 900,
        },
    )
    agent = Agent(
        client=client,
        name="counterpress-insight",
        instructions=PUBLIC_INSTRUCTIONS,
        tools=[get_match_state, get_latest_moment],
    )
    user_text = (
        "Write the optional insight for this synthetic match request "
        f"(session {context['sessionId']}, {context['count']} recorded events, "
        f"audience {context['audience'] or 'casual'}, language "
        f"{context['locale'] or 'en'}). Call a football tool first."
    )
    try:
        result = await agent.run(user_text)
    except WorkerHeld as held:
        out["held_reason"] = held.reason
        out["status"] = "held"
        out["turns"] = client.turn_records
        out["tool_calls"] = client.tool_calls
        out["tool_invocations"] = invocations
        return out
    except Exception as exc:  # honest failure surface; never a fake success
        out["held_reason"] = "workflow_error"
        out["status"] = "held"
        out["turns"] = client.turn_records
        out["tool_calls"] = client.tool_calls
        out["tool_invocations"] = invocations
        return out

    out["turns"] = client.turn_records
    out["tool_calls"] = client.tool_calls
    out["tool_invocations"] = invocations

    final = client.last_final
    if final is None:
        # Last assistant text, if any, is kept only as an opaque flag.
        out["held_reason"] = "no_valid_final"
        out["status"] = "held"
    elif not client.tool_calls or not any(
            invocations.get(tc["name"], 0) for tc in client.tool_calls):
        out["held_reason"] = "final_without_tool_call"
        out["status"] = "held"
    else:
        out["status"] = "ready"
        out["caption"] = final["caption"]
        out["insight"] = final["insight"]
        out["finished_text_bytes"] = len((result.messages[-1].text or "").encode("utf8")) \
            if getattr(result, "messages", None) else None
    return out


def _read_payload():
    if len(sys.argv) > 2 and sys.argv[1] == "--context-file":
        raw = Path(sys.argv[2]).read_text(encoding="utf8")
    else:
        raw = sys.stdin.read()
    if len(raw.encode("utf8")) > 262144:
        raise DecisionError("payload exceeds 256KB")
    obj = json.loads(raw)
    if not isinstance(obj, dict):
        raise DecisionError("payload must be a JSON object")
    return obj


def main():
    env = dict(os.environ)
    try:
        payload = _read_payload()
    except Exception:
        _emit({"status": "unavailable", "held_reason": "bad_payload"})
        return 0
    try:
        out = asyncio.run(_run(payload, env))
    except Exception:
        out = {"status": "unavailable", "held_reason": "worker_error"}
    _emit(out)
    return 0


if __name__ == "__main__":
    sys.exit(main())
