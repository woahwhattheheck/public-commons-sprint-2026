#!/usr/bin/env python3
"""Purchased API allowances over the original SF101 merchant order database.

The enrolled private file is the immutable API-pass contract. The original
receiver owns its payment terms, entitlement, claim token, suspension and expiry.
This module only accounts for API work admitted under that existing entitlement.

One SQLite write transaction admits one execution owner and reserves its units.
Completed response bytes and their accounting outcome commit together. A lost
worker keeps its reservation until its actual outcome is reconciled; a deadline
never creates a second execution or silently restores an allowance.
"""
from __future__ import annotations

from contextlib import contextmanager
from datetime import datetime, timezone
import hashlib
import hmac
import json
import math
from pathlib import Path
import re
import secrets
import sqlite3
import sys
import time

_RECEIVER_ROOT = Path(__file__).resolve().parent.parent
if str(_RECEIVER_ROOT) not in sys.path:
    sys.path.insert(0, str(_RECEIVER_ROOT))
import receiver  # noqa: E402 -- original merchant authority
import access  # noqa: E402 -- original access-policy projection

PLAN_SCHEMA = "stellar-forge.sf101.api-pass.v1"
MAX_RESPONSE_BYTES = 4 * 1024 * 1024
MAX_PLAN_BYTES = 64 * 1024
MAX_UNITS = 9_007_199_254_740_991
MAX_ROUTES = 128
_REQUEST_ID = re.compile(r"[A-Za-z0-9][A-Za-z0-9._:-]{0,127}\Z")
_HEX = re.compile(r"[0-9a-f]{64}\Z")
_PATH = re.compile(r"/[A-Za-z0-9._~/-]*\Z")
_CODE = re.compile(r"[A-Z][A-Z0-9_]{0,79}\Z")
_HTTP_TOKEN = r"[!#$%&'*+\-.^_\x60|~0-9A-Za-z]+"
_QUOTED_HTTP_VALUE = r'"(?:[\x20-\x21\x23-\x5b\x5d-\x7e]|\\[\x20-\x7e])*"'
_CONTENT_TYPE = re.compile(
    _HTTP_TOKEN + "/" + _HTTP_TOKEN +
    r"(?: *; *" + _HTTP_TOKEN + r" *= *(?:" + _HTTP_TOKEN + "|" + _QUOTED_HTTP_VALUE + r"))*\Z"
)
_RESERVED = {"IN_FLIGHT", "RECOVERY_REQUIRED"}
_CONSUMED = {"COMPLETED", "CONSUMED"}
_LOCAL_OPERATOR = object()


class PassError(Exception):
    """A stable, safe-to-display code; provider exceptions are never persisted."""

    def __init__(self, code: str, status: int = 400):
        super().__init__(code)
        self.code = code
        self.status = status


def _need(condition, code, status=400):
    if not condition:
        raise PassError(code, status)


def _sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _compact(value) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def _stamp(epoch=None) -> str:
    return datetime.fromtimestamp(time.time() if epoch is None else epoch, timezone.utc).isoformat(
        timespec="milliseconds"
    ).replace("+00:00", "Z")


def _text(value, limit, code):
    _need(isinstance(value, str) and 0 < len(value) <= limit and
          not any(ord(char) < 32 or ord(char) == 127 or 0xD800 <= ord(char) <= 0xDFFF for char in value), code)
    return value


def _units(value, code="INVALID_ALLOWANCE_UNITS"):
    _need(type(value) is int and 1 <= value <= MAX_UNITS, code)
    return value


def _reference(ref):
    _need(receiver.is_match(receiver.REF_RE, ref), "INVALID_ORDER_REFERENCE")
    return ref


def _request_id(value):
    _need(isinstance(value, str) and _REQUEST_ID.fullmatch(value), "INVALID_REQUEST_ID")
    return value


def _path(value):
    _need(isinstance(value, str) and len(value) <= 512 and _PATH.fullmatch(value) and
          "//" not in value and all(part not in {".", ".."} for part in value.split("/")),
          "INVALID_API_PATH")
    return value


def validate_path(value):
    """One fixed public API path shared by the plan and gateway configuration."""
    return _path(value)


def validate_content_type(value):
    """Validate a safe HTTP media type, including token and quoted parameters."""
    _need(isinstance(value, str) and 0 < len(value) <= 255 and
          all(32 <= ord(char) <= 126 for char in value), "INVALID_RESPONSE_CONTENT_TYPE")
    value = value.strip(" ")
    _need(_CONTENT_TYPE.fullmatch(value), "INVALID_RESPONSE_CONTENT_TYPE")
    return value


def _method(value):
    _need(isinstance(value, str) and value in receiver.METHODS, "INVALID_API_METHOD")
    return value


def _unique_pairs(pairs):
    result = {}
    for key, value in pairs:
        _need(key not in result, "DUPLICATE_PLAN_FIELD")
        result[key] = value
    return result


def validate_plan(value) -> dict:
    """Validate the exact customer-facing contract before enrolling its file."""
    _need(isinstance(value, dict) and set(value) == {"schema", "title", "allowanceUnits", "routes"},
          "INVALID_PASS_PLAN_FIELDS")
    _need(value["schema"] == PLAN_SCHEMA, "INVALID_PASS_PLAN_SCHEMA")
    title = _text(value["title"], 160, "INVALID_PASS_TITLE")
    allowance = _units(value["allowanceUnits"])
    _need(isinstance(value["routes"], list) and 1 <= len(value["routes"]) <= MAX_ROUTES,
          "PASS_REQUIRES_1_TO_128_ROUTES")
    routes, ids, operations = [], set(), set()
    for route in value["routes"]:
        _need(isinstance(route, dict) and set(route) == {"id", "method", "path", "units"},
              "INVALID_PASS_ROUTE_FIELDS")
        _need(receiver.is_match(receiver.ROUTE_RE, route["id"]), "INVALID_PASS_ROUTE_ID")
        method, path = _method(route["method"]), _path(route["path"])
        units = _units(route["units"], "INVALID_ROUTE_UNITS")
        _need(units <= allowance, "ROUTE_COST_EXCEEDS_PASS_ALLOWANCE")
        _need(route["id"] not in ids and (method, path) not in operations, "DUPLICATE_PASS_ROUTE")
        ids.add(route["id"])
        operations.add((method, path))
        routes.append({"id": route["id"], "method": method, "path": path, "units": units})
    return {"schema": PLAN_SCHEMA, "title": title, "allowanceUnits": allowance, "routes": routes}


def fingerprint_request(method, path, query_string="", body=b"", content_type="") -> str:
    """Bind replay to request bytes without retaining query/body/authorization."""
    _method(method)
    _path(path)
    _need(isinstance(query_string, str) and len(query_string) <= 65536 and
          not any(ord(char) < 32 or ord(char) == 127 or 0xD800 <= ord(char) <= 0xDFFF for char in query_string),
          "INVALID_QUERY_STRING")
    _need(isinstance(body, bytes), "REQUEST_BODY_MUST_BE_BYTES")
    _need(isinstance(content_type, str) and len(content_type) <= 255 and
          all(32 <= ord(char) <= 126 for char in content_type), "INVALID_CONTENT_TYPE")
    return _sha(_compact({"method": method, "path": path,
                          "querySha256": _sha(query_string.encode("utf-8")),
                          "bodySha256": _sha(body), "contentType": content_type}).encode("utf-8"))


def _has_schema(db):
    return db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='sf101_api_passes'").fetchone() is not None


def _ensure_schema(db):
    # Called only under BEGIN IMMEDIATE. All original tables remain authoritative.
    db.execute("""CREATE TABLE IF NOT EXISTS sf101_api_passes (
        order_ref TEXT PRIMARY KEY REFERENCES orders(order_ref),
        manifest_sha256 TEXT NOT NULL, plan_sha256 TEXT NOT NULL,
        plan_json TEXT NOT NULL, allowance_units INTEGER NOT NULL CHECK(allowance_units>0),
        created_at TEXT NOT NULL
    )""")
    db.execute("""CREATE TABLE IF NOT EXISTS sf101_api_calls (
        order_ref TEXT NOT NULL REFERENCES sf101_api_passes(order_ref),
        request_id TEXT NOT NULL, route_id TEXT NOT NULL, method TEXT NOT NULL, path TEXT NOT NULL,
        request_sha256 TEXT NOT NULL, units INTEGER NOT NULL CHECK(units>0),
        status TEXT NOT NULL CHECK(status IN ('IN_FLIGHT','RECOVERY_REQUIRED','COMPLETED','CONSUMED','RELEASED')),
        execution_sha256 TEXT NOT NULL, lease_until REAL NOT NULL,
        revision INTEGER NOT NULL CHECK(revision>=1), created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        error_code TEXT, response_status INTEGER, response_sha256 TEXT,
        response_bytes INTEGER, content_type TEXT,
        PRIMARY KEY(order_ref,request_id)
    )""")
    db.execute("CREATE INDEX IF NOT EXISTS sf101_api_call_usage ON sf101_api_calls(order_ref,status)")
    db.execute("CREATE INDEX IF NOT EXISTS sf101_api_call_history ON sf101_api_calls(order_ref,created_at,request_id)")
    db.execute("""CREATE TABLE IF NOT EXISTS sf101_api_results (
        order_ref TEXT NOT NULL, request_id TEXT NOT NULL, body BLOB NOT NULL,
        PRIMARY KEY(order_ref,request_id),
        FOREIGN KEY(order_ref,request_id) REFERENCES sf101_api_calls(order_ref,request_id)
    )""")
    db.execute("""CREATE TABLE IF NOT EXISTS sf101_api_actions (
        operation_id TEXT PRIMARY KEY, order_ref TEXT NOT NULL, request_id TEXT NOT NULL,
        action TEXT NOT NULL, request_sha256 TEXT NOT NULL, actor TEXT NOT NULL, reason TEXT NOT NULL,
        occurred_at TEXT NOT NULL, result_json TEXT NOT NULL,
        FOREIGN KEY(order_ref,request_id) REFERENCES sf101_api_calls(order_ref,request_id)
    )""")


@contextmanager
def _connection(state, *, write=False):
    root = receiver.require_private_dir(str(state))
    db = receiver.connect(root)
    try:
        db.execute("PRAGMA foreign_keys=ON")
        if write:
            db.execute("BEGIN IMMEDIATE")
            _ensure_schema(db)
        else:
            db.execute("PRAGMA query_only=ON")
            db.execute("BEGIN")
        yield db, root
        if db.in_transaction:
            db.commit()
    except Exception:
        if db.in_transaction:
            db.rollback()
        raise
    finally:
        db.close()


def _order(db, ref):
    row = db.execute("SELECT * FROM orders WHERE order_ref=?", (_reference(ref),)).fetchone()
    _need(row is not None, "ORDER_NOT_FOUND", 404)
    return row


def _authenticate(db, ref, token):
    # The same snapshot binds the original entitlement, current token and access policy.
    valid = receiver.is_match(receiver.REF_RE, ref) and isinstance(token, str)
    try:
        encoded = token.encode("utf-8") if valid else b""
    except UnicodeError:
        encoded = b""
    valid = valid and 32 <= len(encoded) <= 1024
    row = db.execute("SELECT * FROM orders WHERE order_ref=?", (ref,)).fetchone() if valid else None
    if row is None or row["state"] != "ENTITLED" or not receiver.access_allowed(db, ref):
        raise PassError("ACCESS_DENIED", 404)
    try:
        accepted = hmac.compare_digest(hashlib.sha256(encoded).digest(), bytes.fromhex(row["token_sha256"]))
    except (ValueError, TypeError):
        accepted = False
    _need(accepted, "ACCESS_DENIED", 404)
    return row


def _manifest(root, order):
    _need(0 < order["file_bytes"] <= MAX_PLAN_BYTES, "PASS_MANIFEST_TOO_LARGE", 409)
    try:
        with receiver.snapshot_private_file(order["file_path"], directory=root) as source:
            _need(source.size == order["file_bytes"] and source.sha256 == order["file_sha256"],
                  "PASS_MANIFEST_CHANGED", 409)
            raw = source.stream.read(MAX_PLAN_BYTES + 1)
    except (OSError, ValueError):
        raise PassError("PASS_MANIFEST_UNAVAILABLE", 409) from None
    _need(len(raw) <= MAX_PLAN_BYTES, "PASS_MANIFEST_TOO_LARGE", 409)
    try:
        parsed = json.loads(raw.decode("utf-8"), object_pairs_hook=_unique_pairs)
    except (UnicodeError, json.JSONDecodeError):
        raise PassError("INVALID_PASS_MANIFEST") from None
    plan = validate_plan(parsed)
    return plan, _sha(_compact(plan).encode("utf-8"))


def _pass(db, ref):
    _need(_has_schema(db), "PASS_NOT_ATTACHED", 404)
    row = db.execute("SELECT * FROM sf101_api_passes WHERE order_ref=?", (ref,)).fetchone()
    _need(row is not None, "PASS_NOT_ATTACHED", 404)
    return row


def _bound_plan(db, root, order):
    record = _pass(db, order["order_ref"])
    _need(record["manifest_sha256"] == order["file_sha256"], "PASS_MANIFEST_CHANGED", 409)
    plan, digest = _manifest(root, order)
    _need(record["plan_sha256"] == digest and record["plan_json"] == _compact(plan),
          "PASS_MANIFEST_CHANGED", 409)
    return record, plan


def _usage(db, ref):
    record = _pass(db, ref)
    totals = {row["status"]: (row["n"], row["units"]) for row in db.execute(
        """SELECT status,COUNT(*) AS n,
            COALESCE(SUM(CASE WHEN status='RELEASED' THEN 0 ELSE units END),0) AS units
            FROM sf101_api_calls WHERE order_ref=? GROUP BY status""",
        (ref,)
    )}
    consumed = sum(totals.get(status, (0, 0))[1] for status in _CONSUMED)
    held = sum(totals.get(status, (0, 0))[1] for status in _RESERVED)
    available = record["allowance_units"] - consumed - held
    _need(available >= 0, "PASS_ACCOUNTING_INVARIANT", 500)
    return {"allowanceUnits": record["allowance_units"], "consumedUnits": consumed,
            "reservedUnits": held, "availableUnits": available,
            "completedCalls": totals.get("COMPLETED", (0, 0))[0],
            "consumedCallsWithoutResult": totals.get("CONSUMED", (0, 0))[0],
            "reservedCalls": sum(totals.get(status, (0, 0))[0] for status in _RESERVED),
            "releasedCalls": totals.get("RELEASED", (0, 0))[0]}


def _call(db, ref, request_id):
    _need(_has_schema(db), "CALL_NOT_FOUND", 404)
    row = db.execute("SELECT * FROM sf101_api_calls WHERE order_ref=? AND request_id=?",
                     (_reference(ref), _request_id(request_id))).fetchone()
    _need(row is not None, "CALL_NOT_FOUND", 404)
    return row


def _call_view(row, at=None):
    now = time.time() if at is None else at
    status = row["status"]
    if status == "IN_FLIGHT" and now >= row["lease_until"]:
        status = "RECOVERY_REQUIRED"
    result = None
    if row["response_sha256"] is not None:
        result = {"status": row["response_status"], "contentType": row["content_type"],
                  "sha256": row["response_sha256"], "bytes": row["response_bytes"]}
    return {"orderRef": row["order_ref"], "requestId": row["request_id"],
            "routeId": row["route_id"], "method": row["method"], "path": row["path"],
            "requestSha256": row["request_sha256"], "units": row["units"], "status": status,
            "storedStatus": row["status"], "revision": row["revision"],
            "startedAt": row["created_at"], "deadlineAt": _stamp(row["lease_until"]),
            "updatedAt": row["updated_at"], "errorCode": row["error_code"], "result": result}


def _pass_view(db, record, *, at=None):
    ref = record["order_ref"]
    return {"schema": "stellar-forge.sf101.api-pass-detail.v1", "orderRef": ref,
            "plan": json.loads(record["plan_json"]), "planSha256": record["plan_sha256"],
            "manifestSha256": record["manifest_sha256"], "createdAt": record["created_at"],
            "native": access.get_order(db, ref, time.time() if at is None else at), "usage": _usage(db, ref)}


def _outcome(db, ref, request_id, *, replayed=False):
    return {"schema": "stellar-forge.sf101.api-call.v1", "replayed": replayed,
            "call": _call_view(_call(db, ref, request_id)), "usage": _usage(db, ref)}


def attach_pass(state, ref):
    """Attach the exact original enrolled manifest, before or after entitlement."""
    _reference(ref)
    with _connection(state, write=True) as (db, root):
        order = _order(db, ref)
        plan, digest = _manifest(root, order)
        existing = db.execute("SELECT * FROM sf101_api_passes WHERE order_ref=?", (ref,)).fetchone()
        if existing is not None:
            _need(existing["manifest_sha256"] == order["file_sha256"] and
                  existing["plan_sha256"] == digest and existing["plan_json"] == _compact(plan),
                  "PASS_ALREADY_ATTACHED_WITH_DIFFERENT_TERMS", 409)
            result = _pass_view(db, existing)
            result["replayed"] = True
            return result
        db.execute("""INSERT INTO sf101_api_passes(order_ref,manifest_sha256,plan_sha256,
                   plan_json,allowance_units,created_at) VALUES(?,?,?,?,?,?)""",
                   (ref, order["file_sha256"], digest, _compact(plan), plan["allowanceUnits"], _stamp()))
        result = _pass_view(db, _pass(db, ref))
        result["replayed"] = False
        return result


def show_pass(state, ref, token=_LOCAL_OPERATOR):
    with _connection(state) as (db, root):
        if token is not _LOCAL_OPERATOR:
            order = _authenticate(db, ref, token)
            record, _ = _bound_plan(db, root, order)
            result = _pass_view(db, record)
            result["manifest"] = {"status": "CURRENT"}
            return result
        # Preserve an operator's ability to inspect/reconcile original work when
        # the enrolled source file needs repair. Public reads always verify it.
        order = _order(db, ref)
        record = _pass(db, ref)
        result = _pass_view(db, record)
        try:
            _bound_plan(db, root, order)
            result["manifest"] = {"status": "CURRENT"}
        except PassError as exc:
            result["manifest"] = {"status": "REPAIR_REQUIRED", "code": exc.code}
        return result


def list_passes(state, after=None, limit=100):
    _need(type(limit) is int and 1 <= limit <= 500, "LIMIT_MUST_BE_1_TO_500")
    if after is not None:
        _reference(after)
    with _connection(state) as (db, _):
        if not _has_schema(db):
            return {"schema": "stellar-forge.sf101.api-pass-list.v1", "passes": [], "nextAfter": None}
        records = db.execute("SELECT * FROM sf101_api_passes WHERE order_ref>? ORDER BY order_ref LIMIT ?",
                             (after or "", limit + 1)).fetchall()
        items = [_pass_view(db, row) for row in records[:limit]]
        return {"schema": "stellar-forge.sf101.api-pass-list.v1", "passes": items,
                "nextAfter": items[-1]["orderRef"] if len(records) > limit else None}


def list_calls(state, ref, after=None, limit=100, token=_LOCAL_OPERATOR):
    _need(type(limit) is int and 1 <= limit <= 500, "LIMIT_MUST_BE_1_TO_500")
    if after is not None:
        _request_id(after)
    with _connection(state) as (db, root):
        order = _order(db, ref) if token is _LOCAL_OPERATOR else _authenticate(db, ref, token)
        if token is not _LOCAL_OPERATOR:
            _bound_plan(db, root, order)
        _pass(db, ref)
        records = db.execute("""SELECT * FROM sf101_api_calls WHERE order_ref=? AND request_id>?
                                ORDER BY request_id LIMIT ?""", (ref, after or "", limit + 1)).fetchall()
        calls = [_call_view(row) for row in records[:limit]]
        return {"schema": "stellar-forge.sf101.api-call-list.v1", "orderRef": ref, "calls": calls,
                "nextAfter": calls[-1]["requestId"] if len(records) > limit else None,
                "usage": _usage(db, ref)}


def export_pass(state, ref, *, max_bytes=None):
    """Export complete private usage metadata from one original DB snapshot.

    Existing pass/call projections retain their public shapes. Recovery actions
    use the same safe fields as call_history plus their request_id. Response
    bytes, original file paths, claim tokens and execution owners are omitted.

    snapshot.stateSha256 identifies the durable exported metadata. It excludes
    capture time, manifest availability and clock-derived display states, so a
    cold restore with the same original rows has the same identity. It changes
    when native entitlement/access, a call or a recovery action changes.
    """
    if max_bytes is not None:
        _need(type(max_bytes) is int and max_bytes > 0, "INVALID_EXPORT_BYTE_LIMIT")
    with _connection(state) as (db, root):
        order = _order(db, ref)  # Establish the SQLite read snapshot first.
        record = _pass(db, ref)
        at = time.time()
        detail = _pass_view(db, record, at=at)
        try:
            _bound_plan(db, root, order)
            detail["manifest"] = {"status": "CURRENT"}
        except PassError as exc:
            detail["manifest"] = {"status": "REPAIR_REQUIRED", "code": exc.code}

        # Select only metadata: saved result BLOBs and owner digests never enter
        # this export. Iterate under this same transaction, including histories.
        calls, actions = [], []
        budget = len(_compact(detail).encode("utf-8")) + 1024

        def append_record(target, value):
            nonlocal budget
            budget += len(_compact(value).encode("utf-8")) + 1
            if max_bytes is not None:
                _need(budget <= max_bytes, "PASS_EXPORT_TOO_LARGE", 413)
            target.append(value)

        for row in db.execute("""SELECT order_ref,request_id,route_id,method,path,
                request_sha256,units,status,lease_until,revision,created_at,updated_at,
                error_code,response_status,response_sha256,response_bytes,content_type
                FROM sf101_api_calls WHERE order_ref=? ORDER BY request_id""", (ref,)):
            append_record(calls, _call_view(row, at=at))
        for row in db.execute("""SELECT request_id,operation_id,action,actor,reason,occurred_at
                FROM sf101_api_actions WHERE order_ref=?
                ORDER BY request_id,occurred_at,operation_id""", (ref,)):
            append_record(actions, dict(row))

        # JSON-only copies keep the returned operator view intact. Access.state
        # and call.status may change merely because time passed; their persisted
        # enabled/expiry/revision and storedStatus remain in the identity.
        stable_detail = {key: value for key, value in detail.items() if key != "manifest"}
        stable_native = dict(stable_detail["native"])
        stable_native["access"] = {
            key: value for key, value in stable_native["access"].items() if key != "state"
        }
        stable_detail["native"] = stable_native
        identity = hashlib.sha256()
        identity.update(b"stellar-forge.sf101.api-usage-state.v1\n")
        identity.update(_compact(stable_detail).encode("utf-8"))
        identity.update(b"\ncalls\n")
        for call in calls:
            stable_call = dict(call)
            stable_call["status"] = stable_call["storedStatus"]
            identity.update(_compact(stable_call).encode("utf-8"))
            identity.update(b"\n")
        identity.update(b"actions\n")
        for action in actions:
            identity.update(_compact(action).encode("utf-8"))
            identity.update(b"\n")

        result = {"schema": "stellar-forge.sf101.api-pass-export.v1",
                  "pass": detail, "calls": calls, "actions": actions,
                  "snapshot": {"capturedAt": _stamp(at), "stateSha256": identity.hexdigest(),
                               "callCount": len(calls), "actionCount": len(actions)}}
        if max_bytes is not None:
            _need(len(_compact(result).encode("utf-8")) + 1 <= max_bytes,
                  "PASS_EXPORT_TOO_LARGE", 413)
        return result


def begin_call(state, *, ref, token, request_id, route_id, method, path,
               request_sha256, timeout_seconds=60):
    """Reserve once and return executionToken only to the fresh execution owner."""
    _reference(ref)
    _request_id(request_id)
    _need(receiver.is_match(receiver.ROUTE_RE, route_id), "INVALID_PASS_ROUTE_ID")
    _method(method)
    _path(path)
    _need(isinstance(request_sha256, str) and _HEX.fullmatch(request_sha256), "INVALID_REQUEST_SHA256")
    _need(type(timeout_seconds) in {int, float} and math.isfinite(timeout_seconds) and
          1 <= timeout_seconds <= 3600, "TIMEOUT_MUST_BE_1_TO_3600_SECONDS")
    with _connection(state, write=True) as (db, root):
        order = _authenticate(db, ref, token)
        _, plan = _bound_plan(db, root, order)
        selected = next((route for route in plan["routes"] if route["id"] == route_id), None)
        _need(selected is not None and selected["method"] == method and selected["path"] == path,
              "ROUTE_NOT_IN_PURCHASED_PASS", 403)
        existing = db.execute("SELECT * FROM sf101_api_calls WHERE order_ref=? AND request_id=?",
                              (ref, request_id)).fetchone()
        if existing is not None:
            _need(existing["request_sha256"] == request_sha256 and existing["route_id"] == route_id and
                  existing["method"] == method and existing["path"] == path,
                  "REQUEST_ID_REUSED_WITH_DIFFERENT_REQUEST", 409)
            result = _outcome(db, ref, request_id, replayed=True)
            result["execute"] = False
            return result
        usage = _usage(db, ref)
        _need(selected["units"] <= usage["availableUnits"], "PASS_ALLOWANCE_EXHAUSTED", 429)
        now = time.time()
        stamp = _stamp(now)
        execution = secrets.token_urlsafe(32)
        db.execute("""INSERT INTO sf101_api_calls(order_ref,request_id,route_id,method,path,
                    request_sha256,units,status,execution_sha256,lease_until,revision,created_at,updated_at)
                    VALUES(?,?,?,?,?,?,?,'IN_FLIGHT',?,?,1,?,?)""",
                   (ref, request_id, route_id, method, path, request_sha256, selected["units"],
                    _sha(execution.encode("ascii")), now + timeout_seconds, stamp, stamp))
        result = _outcome(db, ref, request_id)
        result.update({"execute": True, "executionToken": execution})
        return result


def _execution(row, token):
    _need(isinstance(token, str) and 32 <= len(token) <= 128, "INVALID_EXECUTION_OWNER", 409)
    try:
        observed = _sha(token.encode("ascii"))
    except UnicodeError:
        raise PassError("INVALID_EXECUTION_OWNER", 409) from None
    _need(hmac.compare_digest(observed, row["execution_sha256"]), "INVALID_EXECUTION_OWNER", 409)


def _response(status, body, content_type):
    _need(type(status) is int and 200 <= status <= 599, "INVALID_RESPONSE_STATUS")
    _need(isinstance(body, bytes), "RESPONSE_BODY_MUST_BE_BYTES")
    _need(len(body) <= MAX_RESPONSE_BYTES, "RESPONSE_TOO_LARGE")
    content_type = validate_content_type(content_type)
    return {"status": status, "contentType": content_type, "sha256": _sha(body), "bytes": len(body)}


def _same_response(row, response, state):
    return (row["status"] == state and row["response_status"] == response["status"] and
            row["content_type"] == response["contentType"] and
            row["response_sha256"] == response["sha256"] and row["response_bytes"] == response["bytes"])


def _save_response(db, row, response, body, state):
    db.execute("INSERT INTO sf101_api_results(order_ref,request_id,body) VALUES(?,?,?)",
               (row["order_ref"], row["request_id"], sqlite3.Binary(body)))
    db.execute("""UPDATE sf101_api_calls SET status=?,revision=revision+1,updated_at=?,error_code=NULL,
                  response_status=?,response_sha256=?,response_bytes=?,content_type=?
                  WHERE order_ref=? AND request_id=?""",
               (state, _stamp(), response["status"], response["sha256"], response["bytes"],
                response["contentType"], row["order_ref"], row["request_id"]))


def finish_call(state, *, ref, request_id, execution_token, status, body,
                content_type="application/octet-stream", consumed=True):
    """Commit the received response and one allowance outcome atomically.

    Every completed backend HTTP response is normally consumed, including an
    application error. consumed=False is reserved for a known unperformed local
    request. Transport uncertainty belongs in mark_unknown, not this function.
    Original access changes affect future admission/retrieval; already admitted
    work still records its actual completed outcome under its execution owner.
    """
    _need(type(consumed) is bool, "INVALID_CONSUMPTION_DECISION")
    response = _response(status, body, content_type)
    terminal = "COMPLETED" if consumed else "RELEASED"
    with _connection(state, write=True) as (db, _):
        row = _call(db, ref, request_id)
        _execution(row, execution_token)
        if row["status"] not in _RESERVED:
            _need(_same_response(row, response, terminal), "CALL_ALREADY_RECONCILED", 409)
            return _outcome(db, ref, request_id, replayed=True)
        _save_response(db, row, response, body, terminal)
        return _outcome(db, ref, request_id)


def mark_unknown(state, *, ref, request_id, execution_token, code):
    """Retain admitted units after a timeout or interrupted backend outcome."""
    _need(isinstance(code, str) and _CODE.fullmatch(code), "INVALID_FAILURE_CODE")
    with _connection(state, write=True) as (db, _):
        row = _call(db, ref, request_id)
        _execution(row, execution_token)
        if row["status"] == "RECOVERY_REQUIRED":
            return _outcome(db, ref, request_id, replayed=True)
        _need(row["status"] == "IN_FLIGHT", "CALL_ALREADY_RECONCILED", 409)
        db.execute("""UPDATE sf101_api_calls SET status='RECOVERY_REQUIRED',error_code=?,
                    revision=revision+1,updated_at=? WHERE order_ref=? AND request_id=?""",
                   (code, _stamp(), ref, request_id))
        return _outcome(db, ref, request_id)


def read_result(state, *, ref, token, request_id):
    """Read exact committed result bytes after rechecking current original access."""
    with _connection(state) as (db, root):
        order = _authenticate(db, ref, token)
        _bound_plan(db, root, order)
        row = _call(db, ref, request_id)
        if row["response_sha256"] is None:
            return None
        result = db.execute("SELECT body FROM sf101_api_results WHERE order_ref=? AND request_id=?",
                            (ref, request_id)).fetchone()
        _need(result is not None, "RESULT_STORAGE_INCOMPLETE", 500)
        body = bytes(result["body"])
        _need(len(body) == row["response_bytes"] and _sha(body) == row["response_sha256"],
              "RESULT_STORAGE_MISMATCH", 500)
        return {"call": _call_view(row), "status": row["response_status"],
                "contentType": row["content_type"], "sha256": row["response_sha256"],
                "bytes": row["response_bytes"], "body": body}


def _admin_request(ref, request_id, expected_revision, operation_id, actor, reason, action, response):
    _reference(ref)
    _request_id(request_id)
    _request_id(operation_id)
    _need(type(expected_revision) is int and 1 <= expected_revision <= MAX_UNITS, "INVALID_EXPECTED_REVISION")
    _text(actor, 120, "INVALID_ACTOR")
    _text(reason, 500, "INVALID_REASON")
    return _sha(_compact({"orderRef": ref, "requestId": request_id, "expectedRevision": expected_revision,
                          "actor": actor, "reason": reason, "action": action,
                          "response": response}).encode("utf-8"))


def _replayed_action(db, operation_id, fingerprint):
    action = db.execute("SELECT * FROM sf101_api_actions WHERE operation_id=?", (operation_id,)).fetchone()
    if action is None:
        return None
    _need(action["request_sha256"] == fingerprint, "OPERATION_ID_REUSED_WITH_DIFFERENT_REQUEST", 409)
    result = json.loads(action["result_json"])
    result["replayed"] = True
    return result


def _record_action(db, *, ref, request_id, operation_id, action, fingerprint, actor, reason):
    result = _outcome(db, ref, request_id)
    result["operationId"] = operation_id
    result["action"] = action
    db.execute("""INSERT INTO sf101_api_actions(operation_id,order_ref,request_id,action,
                  request_sha256,actor,reason,occurred_at,result_json) VALUES(?,?,?,?,?,?,?,?,?)""",
               (operation_id, ref, request_id, action, fingerprint, actor, reason, _stamp(), _compact(result)))
    return result


def resolve_call(state, *, ref, request_id, expected_revision, operation_id, actor, reason,
                 decision, status=None, body=None, content_type="application/octet-stream"):
    """Reconcile an interrupted original execution from its observed outcome.

    decision='consume' records performed work. Supply the original recovered
    bytes to complete delivery now; otherwise CONSUMED keeps its missing result
    visible. decision='release' records confirmed unperformed work. Neither
    decision authorizes another execution under the original request ID.
    """
    _need(decision in {"consume", "release"}, "INVALID_RECOVERY_DECISION")
    _need((status is None) == (body is None), "RECOVERED_RESPONSE_REQUIRES_STATUS_AND_BODY")
    response = None if body is None else _response(status, body, content_type)
    action = "resolve-" + decision
    fingerprint = _admin_request(ref, request_id, expected_revision, operation_id, actor, reason, action, response)
    with _connection(state, write=True) as (db, _):
        repeated = _replayed_action(db, operation_id, fingerprint)
        if repeated is not None:
            return repeated
        row = _call(db, ref, request_id)
        _need(row["revision"] == expected_revision, "CALL_REVISION_CONFLICT", 409)
        _need(row["status"] in _RESERVED, "CALL_ALREADY_RECONCILED", 409)
        _need(row["status"] == "RECOVERY_REQUIRED" or time.time() >= row["lease_until"],
              "CALL_STILL_IN_FLIGHT", 409)
        terminal = ("COMPLETED" if response is not None else "CONSUMED") if decision == "consume" else "RELEASED"
        if response is not None:
            _save_response(db, row, response, body, terminal)
        else:
            db.execute("""UPDATE sf101_api_calls SET status=?,revision=revision+1,updated_at=?
                          WHERE order_ref=? AND request_id=?""", (terminal, _stamp(), ref, request_id))
        return _record_action(db, ref=ref, request_id=request_id, operation_id=operation_id,
                              action=action, fingerprint=fingerprint, actor=actor, reason=reason)


def attach_result(state, *, ref, request_id, expected_revision, operation_id, actor, reason,
                  status, body, content_type="application/octet-stream"):
    """Attach an original recovered response to already-consumed API work."""
    response = _response(status, body, content_type)
    action = "attach-result"
    fingerprint = _admin_request(ref, request_id, expected_revision, operation_id, actor, reason, action, response)
    with _connection(state, write=True) as (db, _):
        repeated = _replayed_action(db, operation_id, fingerprint)
        if repeated is not None:
            return repeated
        row = _call(db, ref, request_id)
        _need(row["revision"] == expected_revision, "CALL_REVISION_CONFLICT", 409)
        _need(row["status"] == "CONSUMED" and row["response_sha256"] is None,
              "CALL_DOES_NOT_AWAIT_RESULT", 409)
        _save_response(db, row, response, body, "COMPLETED")
        return _record_action(db, ref=ref, request_id=request_id, operation_id=operation_id,
                              action=action, fingerprint=fingerprint, actor=actor, reason=reason)


def call_history(state, ref, request_id):
    """Local operator history, excluding raw results and all secret material."""
    with _connection(state) as (db, _):
        row = _call(db, ref, request_id)
        actions = [dict(item) for item in db.execute("""SELECT operation_id,action,actor,reason,occurred_at
                    FROM sf101_api_actions WHERE order_ref=? AND request_id=? ORDER BY occurred_at,operation_id""",
                                                     (ref, request_id))]
        return {"schema": "stellar-forge.sf101.api-call-history.v1", "call": _call_view(row), "actions": actions}
