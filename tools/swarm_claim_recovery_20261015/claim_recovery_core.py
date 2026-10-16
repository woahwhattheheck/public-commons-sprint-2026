"""Event normalization and safety rules for the swarm claim recovery ledger."""

from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Mapping
from urllib.parse import parse_qsl, urlsplit

SCHEMA_VERSION = 1
EVENT_KINDS = {
    "claim",
    "takeover",
    "heartbeat",
    "checkpoint",
    "block",
    "release",
    "complete",
}
TERMINAL_STATUSES = {"complete", "released"}
OPERATION_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:/-]{1,254}$")
ACTOR_RE = re.compile(r"^[^\x00-\x1f\x7f]{1,160}$")
HEX_64_RE = re.compile(r"^[0-9a-fA-F]{64}$")
BLOCKED_CHECKPOINT_KEYS = {
    "body",
    "content",
    "credential",
    "credentials",
    "password",
    "payload",
    "raw",
    "secret",
    "token",
    "tokens",
}
SENSITIVE_QUERY_NAMES = {
    "access_token",
    "auth",
    "authorization",
    "credential",
    "expires",
    "key",
    "password",
    "secret",
    "sig",
    "signature",
    "token",
    "x-amz-credential",
    "x-amz-expires",
    "x-amz-security-token",
    "x-amz-signature",
}


class LedgerError(RuntimeError):
    """Expected operator-facing error."""


@dataclass(frozen=True)
class Thresholds:
    watch_minutes: int = 30
    recovery_minutes: int = 90
    abandoned_minutes: int = 240

    def validate(self) -> None:
        if not (0 < self.watch_minutes < self.recovery_minutes < self.abandoned_minutes):
            raise LedgerError(
                "thresholds must satisfy 0 < watch < recovery < abandoned"
            )


@dataclass(frozen=True)
class Classification:
    name: str
    age_minutes: int
    recovery_ready: bool
    next_action: str


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def parse_time(value: str | datetime) -> datetime:
    if isinstance(value, datetime):
        parsed = value
    else:
        raw = value.strip()
        if not raw:
            raise LedgerError("timestamp cannot be empty")
        if raw.endswith("Z"):
            raw = raw[:-1] + "+00:00"
        try:
            parsed = datetime.fromisoformat(raw)
        except ValueError as exc:
            raise LedgerError(f"invalid ISO-8601 timestamp: {value!r}") from exc
    if parsed.tzinfo is None:
        raise LedgerError("timestamp must include a UTC offset or Z")
    return parsed.astimezone(timezone.utc)


def canonical_time(value: str | datetime) -> str:
    return parse_time(value).isoformat(timespec="seconds").replace("+00:00", "Z")


def canonical_json(value: Any) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def sha256_text(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def validate_short_text(name: str, value: Any, maximum: int, *, required: bool = False) -> str:
    if value is None:
        if required:
            raise LedgerError(f"{name} is required")
        return ""
    if not isinstance(value, str):
        raise LedgerError(f"{name} must be a string")
    cleaned = value.strip()
    if required and not cleaned:
        raise LedgerError(f"{name} is required")
    if len(cleaned) > maximum:
        raise LedgerError(f"{name} exceeds {maximum} characters")
    if "\x00" in cleaned:
        raise LedgerError(f"{name} contains a NUL byte")
    return cleaned


def validate_source_ref(value: Any) -> str:
    ref = validate_short_text("source_ref", value, 2048)
    if not ref:
        return ""
    if ref.startswith(("http://", "https://")):
        parts = urlsplit(ref)
        sensitive = {
            key.lower()
            for key, _ in parse_qsl(parts.query, keep_blank_values=True)
            if key.lower() in SENSITIVE_QUERY_NAMES or key.lower().startswith("x-amz-")
        }
        if sensitive:
            names = ", ".join(sorted(sensitive))
            raise LedgerError(
                f"source_ref contains short-lived or credential query fields: {names}"
            )
    return ref


def _validate_checkpoint_node(value: Any, path: str, depth: int = 0) -> Any:
    if depth > 6:
        raise LedgerError(f"checkpoint nesting exceeds six levels at {path}")
    if value is None or isinstance(value, (bool, int, float)):
        return value
    if isinstance(value, str):
        if len(value) > 4096:
            raise LedgerError(f"checkpoint string exceeds 4096 characters at {path}")
        if "\x00" in value:
            raise LedgerError(f"checkpoint contains a NUL byte at {path}")
        if value.startswith(("http://", "https://")):
            validate_source_ref(value)
        return value
    if isinstance(value, list):
        if len(value) > 100:
            raise LedgerError(f"checkpoint list exceeds 100 entries at {path}")
        return [
            _validate_checkpoint_node(item, f"{path}[{index}]", depth + 1)
            for index, item in enumerate(value)
        ]
    if isinstance(value, dict):
        if len(value) > 100:
            raise LedgerError(f"checkpoint object exceeds 100 keys at {path}")
        normalized: dict[str, Any] = {}
        for raw_key, item in value.items():
            if not isinstance(raw_key, str) or not raw_key:
                raise LedgerError(f"checkpoint keys must be non-empty strings at {path}")
            key = raw_key.strip()
            lowered = key.lower().replace("-", "_")
            if lowered in BLOCKED_CHECKPOINT_KEYS:
                raise LedgerError(
                    f"checkpoint key {key!r} is payload-like; store a durable reference instead"
                )
            normalized[key] = _validate_checkpoint_node(
                item, f"{path}.{key}", depth + 1
            )
        return normalized
    raise LedgerError(f"unsupported checkpoint value at {path}: {type(value).__name__}")


def validate_checkpoint(value: Any) -> dict[str, Any] | None:
    if value in (None, ""):
        return None
    if not isinstance(value, dict):
        raise LedgerError("checkpoint must be a JSON object")
    normalized = _validate_checkpoint_node(value, "checkpoint")
    encoded = canonical_json(normalized)
    if len(encoded.encode("utf-8")) > 32768:
        raise LedgerError("checkpoint metadata exceeds 32 KiB")
    return normalized


def normalize_event(raw: Mapping[str, Any], *, default_now: datetime | None = None) -> dict[str, Any]:
    if not isinstance(raw, Mapping):
        raise LedgerError("each event must be a JSON object")
    operation_id = validate_short_text(
        "operation_id", raw.get("operation_id"), 255, required=True
    )
    if not OPERATION_RE.fullmatch(operation_id):
        raise LedgerError(
            "operation_id may contain letters, numbers, dot, underscore, colon, slash, and hyphen"
        )
    kind = validate_short_text("kind", raw.get("kind"), 32, required=True).lower()
    if kind not in EVENT_KINDS:
        raise LedgerError(f"unsupported event kind {kind!r}")
    actor = validate_short_text("actor", raw.get("actor"), 160, required=True)
    if not ACTOR_RE.fullmatch(actor):
        raise LedgerError("actor contains unsupported control characters")
    occurred_at = canonical_time(raw.get("occurred_at") or default_now or utc_now())
    source_ref = validate_source_ref(raw.get("source_ref"))
    summary = validate_short_text("summary", raw.get("summary"), 4000)
    reason = validate_short_text("reason", raw.get("reason"), 2000)
    checkpoint = validate_checkpoint(raw.get("checkpoint"))

    generation_raw = raw.get("generation")
    generation: int | None
    if generation_raw is None:
        generation = None
    elif isinstance(generation_raw, bool) or not isinstance(generation_raw, int):
        raise LedgerError("generation must be an integer")
    elif generation_raw < 1:
        raise LedgerError("generation must be at least 1")
    else:
        generation = generation_raw

    expected_raw = raw.get("expected_generation")
    expected_generation: int | None
    if expected_raw is None:
        expected_generation = None
    elif isinstance(expected_raw, bool) or not isinstance(expected_raw, int):
        raise LedgerError("expected_generation must be an integer")
    elif expected_raw < 0:
        raise LedgerError("expected_generation cannot be negative")
    else:
        expected_generation = expected_raw

    lease_raw = raw.get("lease_minutes", 90)
    if isinstance(lease_raw, bool) or not isinstance(lease_raw, int):
        raise LedgerError("lease_minutes must be an integer")
    if not 5 <= lease_raw <= 10080:
        raise LedgerError("lease_minutes must be between 5 and 10080")

    normalized: dict[str, Any] = {
        "operation_id": operation_id,
        "kind": kind,
        "actor": actor,
        "occurred_at": occurred_at,
        "source_ref": source_ref,
        "summary": summary,
        "reason": reason,
        "checkpoint": checkpoint,
        "generation": generation,
        "expected_generation": expected_generation,
        "lease_minutes": lease_raw,
    }
    derived_id = sha256_text(canonical_json(normalized))
    event_id = validate_short_text("event_id", raw.get("event_id"), 255) or derived_id
    normalized["event_id"] = event_id
    normalized["event_sha256"] = sha256_text(canonical_json(normalized))
    return normalized

