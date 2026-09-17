"""Deterministic evidence-first incident-state reducer for Voice Incident Commander.

The core is intentionally network-free and dependency-free. It consumes a narrow
projection of *final* AssemblyAI Streaming v3 Turn messages and produces a
content-addressed incident packet. Spoken ACTION/DECISION language is evidence,
not authority to mutate production systems.
"""
from __future__ import annotations

from dataclasses import dataclass, field
import hashlib
import json
import math
import re
from typing import Any, Iterable

SCHEMA = "voice-incident-commander/v1"
TURN_SCHEMA = "assemblyai-streaming-v3-final-turn/v1"
MAX_TRANSCRIPT_CHARS = 8_000
MAX_SPEAKER_CHARS = 64
MAX_EVENTS = 10_000
_EVENT_PREFIXES = (
    ("OBSERVATION:", "observation"),
    ("OBS:", "observation"),
    ("HYPOTHESIS:", "hypothesis"),
    ("HYP:", "hypothesis"),
    ("DIAGNOSTIC:", "diagnostic_proposal"),
    ("CHECK:", "diagnostic_proposal"),
    ("DECISION:", "decision_record"),
    ("DECIDE:", "decision_record"),
    ("ACTION:", "action_proposal"),
)
_SAFE_SPEAKER = re.compile(r"^[^\x00-\x1f\x7f]{1,64}$")


class IncidentError(ValueError):
    """Controlled validation failure."""


def _require_dict(value: Any, where: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise IncidentError(f"{where} must be an object")
    return value


def _require_text(value: Any, field_name: str, limit: int) -> str:
    if not isinstance(value, str):
        raise IncidentError(f"{field_name} must be a string")
    if not value or len(value) > limit:
        raise IncidentError(f"{field_name} length must be 1..{limit}")
    try:
        value.encode("utf-8")
    except UnicodeEncodeError as exc:
        raise IncidentError(f"{field_name} must be valid Unicode scalar text") from exc
    return value


def _canonical(value: Any) -> bytes:
    return json.dumps(
        value,
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False,
        allow_nan=False,
    ).encode("utf-8")


def sha256_json(value: Any) -> str:
    return hashlib.sha256(_canonical(value)).hexdigest()


def strict_json_loads(text: str) -> Any:
    """Parse JSON while rejecting duplicate keys and NaN/Infinity."""

    def pairs(pairs_: list[tuple[str, Any]]) -> dict[str, Any]:
        out: dict[str, Any] = {}
        for key, value in pairs_:
            if key in out:
                raise IncidentError(f"duplicate JSON key: {key}")
            out[key] = value
        return out

    def bad_constant(value: str) -> None:
        raise IncidentError(f"non-finite JSON number: {value}")

    try:
        return json.loads(text, object_pairs_hook=pairs, parse_constant=bad_constant)
    except IncidentError:
        raise
    except (json.JSONDecodeError, TypeError) as exc:
        raise IncidentError("invalid JSON") from exc


def project_final_turn(message: Any) -> dict[str, Any] | None:
    """Validate/project one AssemblyAI v3 message.

    Returns None for non-Turn or partial Turn messages. Final Turn messages are
    projected to a stable, secret-free schema used by the reducer.
    """
    msg = _require_dict(message, "message")
    msg_type = msg.get("type")
    if msg_type != "Turn":
        return None
    if msg.get("end_of_turn") is not True:
        return None

    order = msg.get("turn_order")
    if isinstance(order, bool) or not isinstance(order, int) or order < 0:
        raise IncidentError("turn_order must be a non-negative integer")

    transcript = _require_text(msg.get("transcript"), "transcript", MAX_TRANSCRIPT_CHARS)

    confidence = msg.get("end_of_turn_confidence", 1.0)
    if isinstance(confidence, bool) or not isinstance(confidence, (int, float)):
        raise IncidentError("end_of_turn_confidence must be numeric")
    confidence = float(confidence)
    if not math.isfinite(confidence) or confidence < 0.0 or confidence > 1.0:
        raise IncidentError("end_of_turn_confidence must be finite in [0,1]")

    speaker = msg.get("speaker_label")
    if speaker is not None:
        if not isinstance(speaker, str) or not _SAFE_SPEAKER.fullmatch(speaker):
            raise IncidentError("speaker_label must be printable text up to 64 characters")

    projection = {
        "schema": TURN_SCHEMA,
        "turn_order": order,
        "speaker_label": speaker,
        "transcript": transcript,
        "end_of_turn_confidence": confidence,
    }
    projection["transcript_sha256"] = hashlib.sha256(transcript.encode("utf-8")).hexdigest()
    return projection


def _classify(text: str) -> tuple[str, str]:
    stripped = text.strip()
    upper = stripped.upper()
    for prefix, kind in _EVENT_PREFIXES:
        if upper.startswith(prefix):
            payload = stripped[len(prefix):].strip()
            if not payload:
                raise IncidentError(f"{prefix[:-1]} payload must not be empty")
            return kind, payload
    return "note", stripped


@dataclass
class IncidentState:
    turns: dict[int, dict[str, Any]] = field(default_factory=dict)
    events: list[dict[str, Any]] = field(default_factory=list)

    def ingest(self, projected_turn: dict[str, Any]) -> None:
        projected_turn = _require_dict(projected_turn, "projected_turn")
        if projected_turn.get("schema") != TURN_SCHEMA:
            raise IncidentError("unsupported turn schema")
        order = projected_turn.get("turn_order")
        if isinstance(order, bool) or not isinstance(order, int) or order < 0:
            raise IncidentError("invalid turn_order")

        prior = self.turns.get(order)
        if prior is not None:
            if prior != projected_turn:
                raise IncidentError(f"conflicting replay for turn_order {order}")
            return

        if len(self.turns) >= MAX_EVENTS:
            raise IncidentError("event limit exceeded")
        expected = len(self.turns)
        if order != expected:
            raise IncidentError(f"turn_order gap: expected {expected}, got {order}")

        kind, payload = _classify(projected_turn["transcript"])
        event = {
            "turn_order": order,
            "speaker_label": projected_turn.get("speaker_label"),
            "kind": kind,
            "text": payload,
            "end_of_turn_confidence": projected_turn["end_of_turn_confidence"],
            "transcript_sha256": projected_turn["transcript_sha256"],
        }
        event["event_sha256"] = sha256_json(event)
        self.turns[order] = dict(projected_turn)
        self.events.append(event)

    def projection(self) -> dict[str, Any]:
        kinds = {
            "observations": [],
            "hypotheses": [],
            "diagnostic_proposals": [],
            "decision_records": [],
            "action_proposals": [],
            "notes": [],
        }
        mapping = {
            "observation": "observations",
            "hypothesis": "hypotheses",
            "diagnostic_proposal": "diagnostic_proposals",
            "decision_record": "decision_records",
            "action_proposal": "action_proposals",
            "note": "notes",
        }
        for event in self.events:
            kinds[mapping[event["kind"]]].append(event)
        return {
            "event_count": len(self.events),
            **kinds,
        }


def compile_packet(turns: Iterable[dict[str, Any]]) -> dict[str, Any]:
    state = IncidentState()
    admitted: list[dict[str, Any]] = []
    for raw in turns:
        projected = project_final_turn(raw)
        if projected is None:
            continue
        was_present = projected["turn_order"] in state.turns
        state.ingest(projected)
        if not was_present:
            admitted.append(projected)

    body = {
        "schema": SCHEMA,
        "source_contract": {
            "provider": "AssemblyAI",
            "provider_message_schema": TURN_SCHEMA,
            "live_provider_execution_verified": False,
        },
        "authority": {
            "production_mutation": False,
            "incident_command_sent": False,
            "deployment_change": False,
            "page_sent": False,
            "competition_submission": False,
            "award_received": False,
            "payment_received": False,
            "revenue_booked": False,
        },
        "turns": admitted,
        "incident": state.projection(),
    }
    return {**body, "receipt_sha256": sha256_json(body)}


def verify_packet(packet: Any) -> bool:
    candidate = _require_dict(packet, "packet")
    if set(candidate) != {"schema", "source_contract", "authority", "turns", "incident", "receipt_sha256"}:
        return False
    if candidate.get("schema") != SCHEMA:
        return False
    turns = candidate.get("turns")
    if not isinstance(turns, list):
        return False

    raw: list[dict[str, Any]] = []
    for turn in turns:
        if not isinstance(turn, dict):
            return False
        raw.append({
            "type": "Turn",
            "turn_order": turn.get("turn_order"),
            "transcript": turn.get("transcript"),
            "end_of_turn": True,
            "end_of_turn_confidence": turn.get("end_of_turn_confidence"),
            "speaker_label": turn.get("speaker_label"),
        })
    try:
        rebuilt = compile_packet(raw)
    except IncidentError:
        return False
    return rebuilt == candidate
