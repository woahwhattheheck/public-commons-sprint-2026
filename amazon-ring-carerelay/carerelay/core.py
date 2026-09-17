from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, asdict
from datetime import datetime
from typing import Any, Iterable

EVENT_SCHEMA = "ring-simulator-event/v1"
MAX_EVENT_BYTES = 16_384
MAX_TEXT = 128
ALLOWED_EVENT_TYPES = {"motion", "doorbell", "device_status"}
ALLOWED_CLASSIFICATIONS = {"human", "animal", "vehicle", "unknown", "none"}
DENIED_PRIVACY_KEYS = {
    "person_name",
    "face_id",
    "face_embedding",
    "audio_transcript",
    "license_plate",
    "raw_video",
    "video_url",
    "image_url",
}


class CareRelayError(ValueError):
    pass


def _reject_constant(value: str) -> None:
    raise CareRelayError(f"non-finite JSON number rejected: {value}")


def _pairs_no_dupes(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for key, value in pairs:
        if key in out:
            raise CareRelayError(f"duplicate JSON key rejected: {key}")
        out[key] = value
    return out


def strict_json_loads(raw: str | bytes) -> Any:
    if isinstance(raw, bytes):
        if len(raw) > MAX_EVENT_BYTES:
            raise CareRelayError("input exceeds event size limit")
        try:
            raw = raw.decode("utf-8")
        except UnicodeDecodeError as exc:
            raise CareRelayError("input must be UTF-8") from exc
    elif len(raw.encode("utf-8")) > MAX_EVENT_BYTES:
        raise CareRelayError("input exceeds event size limit")
    try:
        return json.loads(raw, object_pairs_hook=_pairs_no_dupes, parse_constant=_reject_constant)
    except CareRelayError:
        raise
    except (json.JSONDecodeError, TypeError) as exc:
        raise CareRelayError("invalid JSON") from exc


def canonical_json(value: Any) -> bytes:
    try:
        text = json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False)
        return text.encode("utf-8")
    except (TypeError, ValueError, UnicodeEncodeError) as exc:
        raise CareRelayError("value is not canonical JSON") from exc


def sha256_json(value: Any) -> str:
    return hashlib.sha256(canonical_json(value)).hexdigest()


def _text(value: Any, field: str, *, max_len: int = MAX_TEXT) -> str:
    if not isinstance(value, str) or not value or len(value) > max_len:
        raise CareRelayError(f"{field} must be non-empty text <= {max_len} chars")
    if any(ord(ch) < 32 for ch in value):
        raise CareRelayError(f"{field} contains control characters")
    return value


def _identifier(value: Any, field: str) -> str:
    text = _text(value, field, max_len=96)
    if not all(ch.isalnum() or ch in "-_.:" for ch in text):
        raise CareRelayError(f"{field} contains unsafe characters")
    return text


def _timestamp(value: Any) -> str:
    text = _text(value, "occurred_at", max_len=64)
    normalized = text[:-1] + "+00:00" if text.endswith("Z") else text
    try:
        dt = datetime.fromisoformat(normalized)
    except ValueError as exc:
        raise CareRelayError("occurred_at must be ISO-8601") from exc
    if dt.tzinfo is None or dt.utcoffset() is None:
        raise CareRelayError("occurred_at must include timezone")
    return dt.isoformat()


@dataclass(frozen=True)
class RingEvent:
    event_id: str
    device_id: str
    occurred_at: str
    event_type: str
    classification: str
    zone: str | None = None
    device_health: str | None = None

    @property
    def digest(self) -> str:
        return sha256_json(asdict(self))

    @classmethod
    def from_mapping(cls, obj: dict[str, Any]) -> "RingEvent":
        if not isinstance(obj, dict):
            raise CareRelayError("event must be an object")
        forbidden = sorted(set(obj).intersection(DENIED_PRIVACY_KEYS))
        if forbidden:
            raise CareRelayError(f"privacy-sensitive field(s) rejected: {', '.join(forbidden)}")
        allowed = {
            "schema", "event_id", "device_id", "occurred_at", "event_type",
            "classification", "zone", "device_health",
        }
        extras = sorted(set(obj) - allowed)
        if extras:
            raise CareRelayError(f"unknown event field(s): {', '.join(extras)}")
        if obj.get("schema") != EVENT_SCHEMA:
            raise CareRelayError(f"schema must equal {EVENT_SCHEMA}")
        event_type = _text(obj.get("event_type"), "event_type", max_len=32)
        if event_type not in ALLOWED_EVENT_TYPES:
            raise CareRelayError("unsupported event_type")
        classification = obj.get("classification", "none")
        classification = _text(classification, "classification", max_len=32)
        if classification not in ALLOWED_CLASSIFICATIONS:
            raise CareRelayError("unsupported classification")
        zone = obj.get("zone")
        if zone is not None:
            zone = _text(zone, "zone", max_len=64)
        health = obj.get("device_health")
        if health is not None:
            health = _text(health, "device_health", max_len=64)
        return cls(
            event_id=_identifier(obj.get("event_id"), "event_id"),
            device_id=_identifier(obj.get("device_id"), "device_id"),
            occurred_at=_timestamp(obj.get("occurred_at")),
            event_type=event_type,
            classification=classification,
            zone=zone,
            device_health=health,
        )

    @classmethod
    def from_json(cls, raw: str | bytes) -> "RingEvent":
        return cls.from_mapping(strict_json_loads(raw))


@dataclass(frozen=True)
class Proposal:
    proposal_id: str
    event_id: str
    action: str
    rationale: str
    requires_human_approval: bool = True
    external_action_executed: bool = False


@dataclass(frozen=True)
class ApprovalRecord:
    proposal_id: str
    approver: str
    decision: str
    external_action_executed: bool = False


class CareRelay:
    """Deterministic, proposal-only reducer over privacy-minimized Ring events.

    The reducer intentionally has no unlock, alarm, emergency-call, camera-control,
    or outbound messaging capability. A human approval record is evidence of a
    decision only; it is not authority to claim an external side effect occurred.
    """

    def __init__(self) -> None:
        self._events: dict[str, RingEvent] = {}
        self._proposals: dict[str, Proposal] = {}
        self._approvals: dict[str, ApprovalRecord] = {}

    @property
    def event_count(self) -> int:
        return len(self._events)

    def ingest(self, event: RingEvent) -> tuple[Proposal, ...]:
        prior = self._events.get(event.event_id)
        if prior is not None:
            if prior.digest != event.digest:
                raise CareRelayError("event_id collision with different content")
            return tuple(p for p in self._proposals.values() if p.event_id == event.event_id)
        self._events[event.event_id] = event
        proposals = self._derive(event)
        for proposal in proposals:
            self._proposals[proposal.proposal_id] = proposal
        return proposals

    def ingest_json(self, raw: str | bytes) -> tuple[Proposal, ...]:
        return self.ingest(RingEvent.from_json(raw))

    def _derive(self, event: RingEvent) -> tuple[Proposal, ...]:
        candidates: list[tuple[str, str]] = []
        if event.event_type == "doorbell" and event.classification == "human":
            candidates.append((
                "accessibility_notice",
                "A person-classified doorbell event can justify a human-reviewed accessibility notice.",
            ))
        if event.event_type == "motion" and event.classification == "human":
            candidates.append((
                "caretaking_check_in",
                "Human-classified motion may update a care routine; the system only proposes a check-in.",
            ))
        if event.event_type == "device_status" and event.device_health not in {None, "ok"}:
            candidates.append((
                "device_health_review",
                "Device health is non-ok; a human should review reliability before relying on automation.",
            ))
        out: list[Proposal] = []
        for action, rationale in candidates:
            pid = sha256_json({
                "policy": "carerelay-proposal/v1",
                "event_digest": event.digest,
                "action": action,
                "rationale": rationale,
            })[:24]
            out.append(Proposal(pid, event.event_id, action, rationale))
        return tuple(out)

    def approve(self, proposal_id: str, approver: str, decision: str = "approved") -> ApprovalRecord:
        proposal_id = _identifier(proposal_id, "proposal_id")
        approver = _identifier(approver, "approver")
        if decision not in {"approved", "rejected"}:
            raise CareRelayError("decision must be approved or rejected")
        if proposal_id not in self._proposals:
            raise CareRelayError("unknown proposal")
        record = ApprovalRecord(proposal_id, approver, decision, external_action_executed=False)
        prior = self._approvals.get(proposal_id)
        if prior is not None and prior != record:
            raise CareRelayError("proposal already has a different recorded decision")
        self._approvals[proposal_id] = record
        return record

    def snapshot(self) -> dict[str, Any]:
        events = [asdict(self._events[k]) for k in sorted(self._events)]
        proposals = [asdict(self._proposals[k]) for k in sorted(self._proposals)]
        approvals = [asdict(self._approvals[k]) for k in sorted(self._approvals)]
        return {
            "schema": "carerelay-state/v1",
            "events": events,
            "proposals": proposals,
            "approvals": approvals,
            "authority": {
                "ring_provider_execution_verified": False,
                "external_action_executed": False,
                "devpost_submitted": False,
                "award_verified": False,
                "payment_verified": False,
            },
        }

    def replay(self, events: Iterable[RingEvent]) -> dict[str, Any]:
        for event in events:
            self.ingest(event)
        return self.snapshot()
