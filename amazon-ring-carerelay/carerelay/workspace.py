"""Bounded, replay-validated workspaces; file operations never call a provider."""
from __future__ import annotations

import json
import os
import tempfile
from pathlib import Path
from typing import Any, Iterator

from .core import CareRelay, CareRelayError, EVENT_SCHEMA, MAX_EVENT_BYTES, RingEvent, canonical_json
from .receipt import compile_receipt

WORKSPACE_SCHEMA = "carerelay-workspace/v1"
MAX_WORKSPACE_BYTES = 16 * 1024 * 1024
MAX_ROWS = 10_000
SOURCES = ("offline-simulator", "provider-candidate")


def _pairs(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise CareRelayError("duplicate JSON field")
        result[key] = value
    return result


def _constant(_: str) -> None:
    raise CareRelayError("non-finite JSON value")


def _decode(raw: bytes, limit: int) -> Any:
    if len(raw) > limit:
        raise CareRelayError("input size limit exceeded")
    try:
        value = json.loads(raw.decode("utf-8"), object_pairs_hook=_pairs, parse_constant=_constant)
        canonical_json(value)  # Reject invalid Unicode and overflowed numeric literals too.
        return value
    except (UnicodeError, ValueError, TypeError, RecursionError) as exc:
        raise CareRelayError("invalid bounded UTF-8 JSON") from exc


def _keys(value: Any, expected: set[str], label: str) -> None:
    if not isinstance(value, dict) or set(value) != expected:
        raise CareRelayError(f"invalid {label} fields")


def _rows(path: Path) -> Iterator[tuple[int, Any]]:
    """Streaming JSONL, with bounded lines and total input even for blank lines."""
    total = 0
    count = 0
    with path.open("rb") as stream:
        while raw := stream.readline(MAX_EVENT_BYTES + 1):
            total += len(raw)
            count += 1
            if total > MAX_WORKSPACE_BYTES or count > MAX_ROWS:
                raise CareRelayError("JSONL file exceeds batch limit")
            if len(raw) > MAX_EVENT_BYTES:
                raise CareRelayError(f"JSONL line {count} exceeds size limit")
            if not raw.strip():
                continue
            try:
                yield count, _decode(raw, MAX_EVENT_BYTES)
            except CareRelayError as exc:
                raise CareRelayError(f"invalid JSONL line {count}") from exc


def _pack(relay: CareRelay, source: str) -> dict[str, Any]:
    state = relay.snapshot()
    if len(state["events"]) > MAX_ROWS:
        raise CareRelayError("workspace event limit exceeded")
    result = {"schema": WORKSPACE_SCHEMA, "state": state,
              "receipt": compile_receipt(state, source=source)}
    if len(canonical_json(result)) + 1 > MAX_WORKSPACE_BYTES:
        raise CareRelayError("workspace exceeds size limit")
    return result


def restore(workspace: Any) -> tuple[CareRelay, str]:
    """Re-derive proposals, then replay decisions; a matching hash alone is insufficient."""
    _keys(workspace, {"schema", "state", "receipt"}, "workspace")
    if workspace["schema"] != WORKSPACE_SCHEMA:
        raise CareRelayError("unsupported workspace schema")
    state, receipt = workspace["state"], workspace["receipt"]
    _keys(state, {"schema", "events", "proposals", "approvals", "authority"}, "state")
    if not isinstance(receipt, dict) or receipt.get("source") not in SOURCES:
        raise CareRelayError("invalid workspace receipt source")
    for name in ("events", "proposals", "approvals"):
        if not isinstance(state[name], list) or len(state[name]) > MAX_ROWS:
            raise CareRelayError(f"invalid workspace {name}")
    relay = CareRelay()
    try:
        for row in state["events"]:
            _keys(row, {"event_id", "device_id", "occurred_at", "event_type",
                        "classification", "zone", "device_health"}, "saved event")
            relay.ingest(RingEvent.from_mapping({**row, "schema": EVENT_SCHEMA}))
        for row in state["approvals"]:
            _keys(row, {"proposal_id", "approver", "decision", "external_action_executed"},
                  "saved review")
            if row["external_action_executed"] is not False:
                raise CareRelayError("saved review claims an external action")
            relay.approve(row["proposal_id"], row["approver"], row["decision"])
        expected = _pack(relay, receipt["source"])
        if canonical_json(workspace) != canonical_json(expected):
            raise CareRelayError("workspace does not match deterministic replay and receipt")
    except (TypeError, UnicodeError, RecursionError) as exc:
        raise CareRelayError("invalid workspace content") from exc
    return relay, receipt["source"]


def load_workspace(path: Path) -> dict[str, Any]:
    with path.open("rb") as stream:
        workspace = _decode(stream.read(MAX_WORKSPACE_BYTES + 1), MAX_WORKSPACE_BYTES)
    restore(workspace)
    return workspace


def import_events(path: Path, *, previous: dict[str, Any] | None = None,
                  source: str | None = None) -> dict[str, Any]:
    """A failed import returns no result and never mutates a previous workspace."""
    if previous is None:
        relay, inherited = CareRelay(), source or "provider-candidate"
    else:
        relay, inherited = restore(previous)
        if source is not None and source != inherited:
            raise CareRelayError("cannot mix workspace source labels")
    if inherited not in SOURCES:
        raise CareRelayError("unsupported workspace source")
    for line, row in _rows(path):
        try:
            relay.ingest(RingEvent.from_mapping(row))
        except (CareRelayError, TypeError, UnicodeError) as exc:
            # Do not echo event values, unexpected privacy keys, or caller payloads.
            raise CareRelayError(f"event rejected at line {line}") from exc
        if relay.event_count > MAX_ROWS:
            raise CareRelayError("workspace event limit exceeded")
    return _pack(relay, inherited)


def apply_reviews(previous: dict[str, Any], path: Path) -> dict[str, Any]:
    """Apply explicit operator-provided decisions, not automatic approvals."""
    relay, source = restore(previous)
    for line, row in _rows(path):
        try:
            _keys(row, {"proposal_id", "approver", "decision"}, "review")
            relay.approve(row["proposal_id"], row["approver"], row["decision"])
        except (CareRelayError, TypeError, UnicodeError) as exc:
            raise CareRelayError(f"review rejected at line {line}") from exc
    return _pack(relay, source)


def publish_new(path: Path, payload: bytes) -> None:
    """Publish a complete private file without replacing any existing path.

    A hard link atomically publishes the completed temporary file. Unsupported
    filesystems fail rather than falling back to a partially written destination.
    Versions are immutable; callers choose a new destination for every change.
    """
    if len(payload) > MAX_WORKSPACE_BYTES:
        raise CareRelayError("output exceeds size limit")
    fd, name = tempfile.mkstemp(prefix=".carerelay-", dir=path.parent)
    temporary = Path(name)
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(payload)
            stream.flush()
            os.fsync(stream.fileno())
        try:
            os.link(temporary, path)
        except FileExistsError as exc:
            raise CareRelayError("output already exists; choose a new version path") from exc
    finally:
        temporary.unlink(missing_ok=True)


def save_workspace(path: Path, workspace: dict[str, Any]) -> None:
    restore(workspace)
    publish_new(path, canonical_json(workspace) + b"\n")
