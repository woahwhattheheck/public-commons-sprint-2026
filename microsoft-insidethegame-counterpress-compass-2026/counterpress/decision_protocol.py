"""Strict text decision protocol for the Counterpress Agent Framework worker.

Stdlib-only, importable without the SDK. The guarded Opus runner returns
final TEXT only (no native provider tool blocks), so the model answers with
one of two strict JSON decisions per turn:

  {"action": "tool",  "name": <whitelisted>, "arguments": {}}
  {"action": "final", "caption": <str>,      "insight": <str>}

Anything else is invalid. This adapter protocol is honest text-level
translation — it is NOT native Anthropic tool calling and must never be
described as such.
"""
from __future__ import annotations

import hashlib
import json
import re

PROMPT_VERSION = "cp-agent-insight-v1"
MODEL = "claude-opus-5-5"
EFFORT = "low"
MAX_OUTPUT_TOKENS = 4096
MAX_PAID_TURNS = 3
MAX_TOOL_CALLS = 2

ALLOWED_TOOLS = ("get_match_state", "get_latest_moment")
"""Read-only, zero-argument tools over the supplied synthetic public facts."""

CAPTION_MAX = 135
INSIGHT_MAX = 700
INSIGHT_MAX_SENTENCES = 4

_JOB_RE = re.compile(r"^[a-z0-9-]+$")
_FENCE_RE = re.compile(r"^```(?:json)?\s*|\s*```$", re.IGNORECASE)


class DecisionError(ValueError):
    """Strict protocol violation: never translated into a tool call."""


def strip_fence(text: str) -> str:
    s = text.strip()
    if s.startswith("```"):
        s = _FENCE_RE.sub("", s).strip()
    return s


def parse_decision(text: str):
    """Parse one model turn into ('tool', name, arguments) or
    ('final', caption, insight). Returns None for anything invalid —
    callers treat None as an ordinary (non-tool) assistant turn."""
    try:
        obj = json.loads(strip_fence(text))
    except (ValueError, TypeError):
        return None
    if not isinstance(obj, dict):
        return None
    action = obj.get("action")
    if action == "tool":
        name = obj.get("name")
        args = obj.get("arguments", {})
        if name not in ALLOWED_TOOLS:
            return None
        if not isinstance(args, dict) or args != {}:
            return None  # both approved tools are strictly zero-argument
        return ("tool", name, {})
    if action == "final":
        caption = obj.get("caption")
        insight = obj.get("insight")
        if not isinstance(caption, str) or not isinstance(insight, str):
            return None
        caption, insight = caption.strip(), insight.strip()
        if not validate_final(caption, insight):
            return None
        return ("final", caption, insight)
    return None


def validate_final(caption: str, insight: str) -> bool:
    """Same quantitative bar as the existing Node parseFinal/guard."""
    if not caption or len(caption) > CAPTION_MAX:
        return False
    if not insight or len(insight) > INSIGHT_MAX:
        return False
    if "<" in caption + insight or ">" in caption + insight:
        return False
    sentences = [s for s in re.split(r"[.!?](?:\s|$)", insight) if s.strip()]
    if not (1 <= len(sentences) <= INSIGHT_MAX_SENTENCES):
        return False
    return True


def workflow_id_for(context: dict) -> str:
    """Deterministic workflow id from the public request context only."""
    canon = json.dumps(context, sort_keys=True, separators=(",", ":"), ensure_ascii=True)
    wid = "cpaf-" + hashlib.sha256(canon.encode("utf8")).hexdigest()[:40]
    if not _JOB_RE.fullmatch(wid):
        raise DecisionError("invalid workflow id")
    return wid


def turn_job_id(workflow_id: str, turn_index: int, prompt_sha256: str) -> str:
    """Stable per-turn job name for the existing guarded runner."""
    h = hashlib.sha256(f"{workflow_id}:{turn_index}:{prompt_sha256}".encode("utf8")).hexdigest()
    jid = f"cpaf-{h[:40]}"
    if not _JOB_RE.fullmatch(jid):
        raise DecisionError("invalid job id")
    return jid


def call_id_for(workflow_id: str, turn_index: int, name: str) -> str:
    """Stable function_call id; the SDK layer matches results to this id."""
    h = hashlib.sha256(f"{workflow_id}:call:{turn_index}:{name}".encode("utf8")).hexdigest()
    return "call_" + h[:32]


def validate_context(ctx):
    """Bounded schema for the public request context. No paths, env,
    credentials, or arbitrary keys are honored — unknown keys are dropped."""
    if not isinstance(ctx, dict):
        raise DecisionError("context must be a JSON object")
    out = {}
    sid = ctx.get("sessionId")
    if sid is not None and not isinstance(sid, str):
        raise DecisionError("sessionId must be a string")
    out["sessionId"] = (sid or "")[:80]
    count = ctx.get("count")
    if not isinstance(count, int) or not (0 <= count <= 100000):
        raise DecisionError("count must be int in [0,100000]")
    out["count"] = count
    for key, allowed in (("team", None), ("audience", {"casual", "analyst"}),
                         ("locale", {"en", "es"})):
        v = ctx.get(key)
        if v is not None and not isinstance(v, str):
            raise DecisionError(key + " must be a string")
        if allowed is not None and v not in allowed:
            raise DecisionError("unsupported " + key)
        out[key] = (v or "")[:40]
    fs = ctx.get("frameSecond")
    out["frameSecond"] = fs if isinstance(fs, (int, float)) else 0
    mid = ctx.get("momentId")
    out["momentId"] = mid if isinstance(mid, str) else ""
    return out


def validate_facts(facts):
    """Public synthetic facts payload forwarded verbatim to the tools.

    Bounds size and requires a JSON-safe object; content stays the app's
    responsibility (the same facts the existing deterministic UI shows)."""
    if not isinstance(facts, dict):
        raise DecisionError("facts must be a JSON object")
    blob = json.dumps(facts, sort_keys=True, ensure_ascii=True, default=str)
    if len(blob.encode("utf8")) > 131072:
        raise DecisionError("facts payload exceeds 128KB")
    return facts
