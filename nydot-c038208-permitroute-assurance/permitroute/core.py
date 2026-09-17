from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, asdict
from datetime import datetime
from typing import Any, Iterable

MAX_JSON_BYTES = 1_000_000
SCHEMA = "permitroute-record/v1"
EVENT_SCHEMA = "permitroute-event/v1"
DISTRICTS = {str(i) for i in range(1, 12)}
PERMIT_TYPES = {"utility", "driveway", "special_use", "construction", "other"}
STATUS_ORDER = (
    "draft",
    "submitted",
    "triage",
    "agency_review",
    "district_review",
    "changes_requested",
    "approved",
    "issued",
    "closed",
    "withdrawn",
    "denied",
)
ALLOWED_TRANSITIONS = {
    "draft": {"submitted", "withdrawn"},
    "submitted": {"triage", "withdrawn"},
    "triage": {"agency_review", "district_review", "changes_requested", "denied", "withdrawn"},
    "agency_review": {"district_review", "changes_requested", "denied", "withdrawn"},
    "district_review": {"changes_requested", "approved", "denied", "withdrawn"},
    "changes_requested": {"submitted", "withdrawn"},
    "approved": {"issued", "withdrawn"},
    "issued": {"closed"},
    "closed": set(),
    "withdrawn": set(),
    "denied": set(),
}
REVIEW_DECISIONS = {"pending", "approved", "rejected", "changes_requested"}
DENIED_FIELDS = {
    "ssn", "social_security_number", "driver_license", "password", "access_token",
    "secret", "private_key", "raw_attachment", "attachment_bytes"
}

class PermitRouteError(ValueError):
    pass

def reject_constant(value: str) -> None:
    raise PermitRouteError(f"non-finite JSON number rejected: {value}")

def no_duplicate_pairs(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for key, value in pairs:
        if key in out:
            raise PermitRouteError(f"duplicate JSON key rejected: {key}")
        out[key] = value
    return out

def strict_json_loads(raw: str | bytes) -> Any:
    if isinstance(raw, bytes):
        if len(raw) > MAX_JSON_BYTES:
            raise PermitRouteError("input exceeds size limit")
        try:
            raw = raw.decode("utf-8")
        except UnicodeDecodeError as exc:
            raise PermitRouteError("input must be UTF-8") from exc
    elif not isinstance(raw, str):
        raise PermitRouteError("input must be text or bytes")
    elif len(raw.encode("utf-8")) > MAX_JSON_BYTES:
        raise PermitRouteError("input exceeds size limit")
    try:
        return json.loads(raw, object_pairs_hook=no_duplicate_pairs, parse_constant=reject_constant)
    except PermitRouteError:
        raise
    except (json.JSONDecodeError, TypeError) as exc:
        raise PermitRouteError("invalid JSON") from exc

def canonical_json(value: Any) -> bytes:
    try:
        return json.dumps(
            value, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False
        ).encode("utf-8")
    except (TypeError, ValueError, UnicodeEncodeError) as exc:
        raise PermitRouteError("value is not canonical JSON") from exc

def digest_json(value: Any) -> str:
    return hashlib.sha256(canonical_json(value)).hexdigest()

def text(value: Any, field: str, max_len: int = 160) -> str:
    if not isinstance(value, str) or not value or len(value) > max_len:
        raise PermitRouteError(f"{field} must be non-empty text <= {max_len}")
    if any(ord(ch) < 32 for ch in value):
        raise PermitRouteError(f"{field} contains control characters")
    return value

def identifier(value: Any, field: str, max_len: int = 96) -> str:
    value = text(value, field, max_len)
    if not all(ch.isalnum() or ch in "-_.:" for ch in value):
        raise PermitRouteError(f"{field} contains unsafe characters")
    return value

def timestamp(value: Any, field: str) -> str:
    value = text(value, field, 64)
    normalized = value[:-1] + "+00:00" if value.endswith("Z") else value
    try:
        dt = datetime.fromisoformat(normalized)
    except ValueError as exc:
        raise PermitRouteError(f"{field} must be ISO-8601") from exc
    if dt.tzinfo is None or dt.utcoffset() is None:
        raise PermitRouteError(f"{field} must include timezone")
    return dt.isoformat()

def string_list(value: Any, field: str, *, max_items: int = 32, max_len: int = 96) -> tuple[str, ...]:
    if not isinstance(value, list) or len(value) > max_items:
        raise PermitRouteError(f"{field} must be a list of <= {max_items} strings")
    out = tuple(identifier(item, field, max_len) for item in value)
    if len(set(out)) != len(out):
        raise PermitRouteError(f"{field} contains duplicates")
    return tuple(sorted(out))

@dataclass(frozen=True)
class Review:
    agency: str
    decision: str
    decided_at: str | None = None

    @classmethod
    def from_mapping(cls, obj: Any) -> "Review":
        if not isinstance(obj, dict):
            raise PermitRouteError("review must be an object")
        allowed = {"agency", "decision", "decided_at"}
        extra = set(obj) - allowed
        if extra:
            raise PermitRouteError(f"unknown review fields: {', '.join(sorted(extra))}")
        agency = identifier(obj.get("agency"), "review.agency")
        decision = text(obj.get("decision"), "review.decision", 32)
        if decision not in REVIEW_DECISIONS:
            raise PermitRouteError("unsupported review decision")
        decided_at = obj.get("decided_at")
        if decision == "pending":
            if decided_at is not None:
                raise PermitRouteError("pending review cannot have decided_at")
        else:
            if decided_at is None:
                raise PermitRouteError("completed review requires decided_at")
            decided_at = timestamp(decided_at, "review.decided_at")
        return cls(agency=agency, decision=decision, decided_at=decided_at)

@dataclass(frozen=True)
class PermitRecord:
    permit_id: str
    applicant_ref: str
    district: str
    permit_type: str
    status: str
    submitted_at: str | None
    updated_at: str
    route_agencies: tuple[str, ...]
    reviews: tuple[Review, ...]
    attachment_digests: tuple[str, ...]
    source_system: str

    @property
    def digest(self) -> str:
        return digest_json(self.to_mapping())

    def to_mapping(self) -> dict[str, Any]:
        return {
            "permit_id": self.permit_id,
            "applicant_ref": self.applicant_ref,
            "district": self.district,
            "permit_type": self.permit_type,
            "status": self.status,
            "submitted_at": self.submitted_at,
            "updated_at": self.updated_at,
            "route_agencies": list(self.route_agencies),
            "reviews": [asdict(review) for review in self.reviews],
            "attachment_digests": list(self.attachment_digests),
            "source_system": self.source_system,
        }

    @classmethod
    def from_mapping(cls, obj: Any) -> "PermitRecord":
        if not isinstance(obj, dict):
            raise PermitRouteError("permit must be an object")
        forbidden = set(obj).intersection(DENIED_FIELDS)
        if forbidden:
            raise PermitRouteError(f"sensitive field(s) rejected: {', '.join(sorted(forbidden))}")
        allowed = {
            "schema", "permit_id", "applicant_ref", "district", "permit_type", "status",
            "submitted_at", "updated_at", "route_agencies", "reviews",
            "attachment_digests", "source_system",
        }
        extra = set(obj) - allowed
        if extra:
            raise PermitRouteError(f"unknown permit fields: {', '.join(sorted(extra))}")
        if obj.get("schema") != SCHEMA:
            raise PermitRouteError(f"schema must equal {SCHEMA}")
        district = text(obj.get("district"), "district", 8)
        if district not in DISTRICTS:
            raise PermitRouteError("district must be 1..11")
        permit_type = text(obj.get("permit_type"), "permit_type", 32)
        if permit_type not in PERMIT_TYPES:
            raise PermitRouteError("unsupported permit_type")
        status = text(obj.get("status"), "status", 32)
        if status not in ALLOWED_TRANSITIONS:
            raise PermitRouteError("unsupported status")
        submitted = obj.get("submitted_at")
        if status != "draft" and submitted is None:
            raise PermitRouteError("non-draft permit requires submitted_at")
        submitted_at = timestamp(submitted, "submitted_at") if submitted is not None else None
        updated_at = timestamp(obj.get("updated_at"), "updated_at")
        if submitted_at is not None:
            if datetime.fromisoformat(updated_at) < datetime.fromisoformat(submitted_at):
                raise PermitRouteError("updated_at precedes submitted_at")
        route_agencies = string_list(obj.get("route_agencies", []), "route_agencies")
        reviews_raw = obj.get("reviews", [])
        if not isinstance(reviews_raw, list) or len(reviews_raw) > 32:
            raise PermitRouteError("reviews must be a list of <= 32")
        reviews = tuple(Review.from_mapping(item) for item in reviews_raw)
        review_agencies = [r.agency for r in reviews]
        if len(review_agencies) != len(set(review_agencies)):
            raise PermitRouteError("duplicate agency review")
        if not set(review_agencies).issubset(set(route_agencies)):
            raise PermitRouteError("review agency must appear in route_agencies")
        attachment_digests = string_list(
            obj.get("attachment_digests", []), "attachment_digests", max_items=64, max_len=64
        )
        for item in attachment_digests:
            if len(item) != 64 or any(ch not in "0123456789abcdef" for ch in item):
                raise PermitRouteError("attachment_digests must be lowercase sha256")
        source_system = identifier(obj.get("source_system"), "source_system", 64)
        return cls(
            permit_id=identifier(obj.get("permit_id"), "permit_id"),
            applicant_ref=identifier(obj.get("applicant_ref"), "applicant_ref"),
            district=district,
            permit_type=permit_type,
            status=status,
            submitted_at=submitted_at,
            updated_at=updated_at,
            route_agencies=route_agencies,
            reviews=tuple(sorted(reviews, key=lambda r: r.agency)),
            attachment_digests=attachment_digests,
            source_system=source_system,
        )

    @classmethod
    def from_json(cls, raw: str | bytes) -> "PermitRecord":
        return cls.from_mapping(strict_json_loads(raw))

@dataclass(frozen=True)
class PermitEvent:
    event_id: str
    permit_id: str
    occurred_at: str
    from_status: str
    to_status: str
    actor_role: str

    @classmethod
    def from_mapping(cls, obj: Any) -> "PermitEvent":
        if not isinstance(obj, dict):
            raise PermitRouteError("event must be an object")
        allowed = {"schema", "event_id", "permit_id", "occurred_at", "from_status", "to_status", "actor_role"}
        extra = set(obj) - allowed
        if extra:
            raise PermitRouteError(f"unknown event fields: {', '.join(sorted(extra))}")
        if obj.get("schema") != EVENT_SCHEMA:
            raise PermitRouteError(f"schema must equal {EVENT_SCHEMA}")
        from_status = text(obj.get("from_status"), "from_status", 32)
        to_status = text(obj.get("to_status"), "to_status", 32)
        if from_status not in ALLOWED_TRANSITIONS or to_status not in ALLOWED_TRANSITIONS[from_status]:
            raise PermitRouteError(f"illegal transition: {from_status}->{to_status}")
        return cls(
            event_id=identifier(obj.get("event_id"), "event_id"),
            permit_id=identifier(obj.get("permit_id"), "permit_id"),
            occurred_at=timestamp(obj.get("occurred_at"), "occurred_at"),
            from_status=from_status,
            to_status=to_status,
            actor_role=identifier(obj.get("actor_role"), "actor_role"),
        )

class ReplayLedger:
    def __init__(self) -> None:
        self._events: dict[str, PermitEvent] = {}
        self._permit_status: dict[str, str] = {}
        self._last_time: dict[str, datetime] = {}

    def seed(self, permit_id: str, status: str = "draft") -> None:
        pid = identifier(permit_id, "permit_id")
        if status not in ALLOWED_TRANSITIONS:
            raise PermitRouteError("unsupported seed status")
        if pid in self._permit_status:
            raise PermitRouteError("permit already seeded")
        self._permit_status[pid] = status

    def apply(self, event: PermitEvent) -> bool:
        prior_event = self._events.get(event.event_id)
        if prior_event is not None:
            if prior_event != event:
                raise PermitRouteError("event_id collision with different content")
            return False
        if event.permit_id not in self._permit_status:
            raise PermitRouteError("event references unseeded permit")
        current = self._permit_status[event.permit_id]
        if current != event.from_status:
            raise PermitRouteError(
                f"replay status mismatch for {event.permit_id}: expected {current}, event says {event.from_status}"
            )
        when = datetime.fromisoformat(event.occurred_at)
        prior_time = self._last_time.get(event.permit_id)
        if prior_time is not None and when < prior_time:
            raise PermitRouteError("event time regressed")
        self._events[event.event_id] = event
        self._permit_status[event.permit_id] = event.to_status
        self._last_time[event.permit_id] = when
        return True

    def replay(self, events: Iterable[PermitEvent]) -> dict[str, str]:
        for event in events:
            self.apply(event)
        return dict(sorted(self._permit_status.items()))

    def snapshot(self) -> dict[str, Any]:
        return {
            "schema": "permitroute-replay/v1",
            "statuses": dict(sorted(self._permit_status.items())),
            "events": [asdict(self._events[k]) for k in sorted(self._events)],
        }

def compare_record(legacy: PermitRecord, target: PermitRecord) -> dict[str, Any]:
    if legacy.permit_id != target.permit_id:
        raise PermitRouteError("cannot compare different permit_ids")
    left = legacy.to_mapping()
    right = target.to_mapping()
    fields = sorted(set(left) | set(right))
    differences = [
        {"field": field, "legacy": left.get(field), "target": right.get(field)}
        for field in fields if left.get(field) != right.get(field)
    ]
    critical = {"applicant_ref", "district", "permit_type", "status", "submitted_at", "route_agencies", "reviews", "attachment_digests"}
    return {
        "schema": "permitroute-record-diff/v1",
        "permit_id": legacy.permit_id,
        "equivalent": not differences,
        "critical_difference_count": sum(1 for item in differences if item["field"] in critical),
        "differences": differences,
    }

def compare_batches(legacy: Iterable[PermitRecord], target: Iterable[PermitRecord]) -> dict[str, Any]:
    legacy_rows = list(legacy)
    target_rows = list(target)
    lmap = {r.permit_id: r for r in legacy_rows}
    tmap = {r.permit_id: r for r in target_rows}
    if len(lmap) != len(legacy_rows):
        raise PermitRouteError("duplicate permit_id in legacy batch")
    if len(tmap) != len(target_rows):
        raise PermitRouteError("duplicate permit_id in target batch")
    ids = sorted(set(lmap) | set(tmap))
    rows = []
    for pid in ids:
        if pid not in lmap:
            rows.append({"permit_id": pid, "status": "target_only"})
        elif pid not in tmap:
            rows.append({"permit_id": pid, "status": "legacy_only"})
        else:
            diff = compare_record(lmap[pid], tmap[pid])
            rows.append({
                "permit_id": pid,
                "status": "equivalent" if diff["equivalent"] else "different",
                "critical_difference_count": diff["critical_difference_count"],
                "differences": diff["differences"],
            })
    return {
        "schema": "permitroute-batch-diff/v1",
        "legacy_count": len(lmap),
        "target_count": len(tmap),
        "equivalent_count": sum(1 for r in rows if r["status"] == "equivalent"),
        "different_count": sum(1 for r in rows if r["status"] == "different"),
        "legacy_only_count": sum(1 for r in rows if r["status"] == "legacy_only"),
        "target_only_count": sum(1 for r in rows if r["status"] == "target_only"),
        "rows": rows,
    }
