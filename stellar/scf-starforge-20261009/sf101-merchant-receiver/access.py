#!/usr/bin/env python3
"""Private merchant access operations over the ORIGINAL SF101 receiver database.

No listener, payment call, new order store, token issuance, or outbound request.
Use the existing receiver.py to enroll, receive SF98 notifications and serve files.
"""
from __future__ import annotations

import argparse
from contextlib import contextmanager
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import sqlite3
import sys
import time

import receiver


class AccessError(Exception):
    pass


def need(condition, code):
    if not condition:
        raise AccessError(code)


def now_text(epoch=None):
    return datetime.fromtimestamp(time.time() if epoch is None else epoch, timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def compact(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def text(value, limit, code):
    need(isinstance(value, str) and 0 < len(value) <= limit and
         not any(ord(c) < 32 or ord(c) == 127 for c in value), code)
    return value


def reference(value):
    need(receiver.is_match(receiver.REF_RE, value), "INVALID_ORDER_REFERENCE")
    return value


def has_policy(db):
    return db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='sf101_access_policy'").fetchone() is not None


def ensure_schema(db):
    # Additive tables in merchant.sqlite3. Original orders/events schemas stay intact.
    db.execute("""CREATE TABLE IF NOT EXISTS sf101_access_policy (
        order_ref TEXT PRIMARY KEY REFERENCES orders(order_ref),
        enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),
        expires_at INTEGER,
        revision INTEGER NOT NULL CHECK(revision >= 1),
        updated_at TEXT NOT NULL
    )""")
    db.execute("""CREATE TABLE IF NOT EXISTS sf101_access_actions (
        operation_id TEXT PRIMARY KEY,
        order_ref TEXT NOT NULL REFERENCES orders(order_ref),
        revision INTEGER NOT NULL,
        action TEXT NOT NULL,
        actor TEXT NOT NULL,
        reason TEXT NOT NULL,
        request_sha256 TEXT NOT NULL,
        occurred_at TEXT NOT NULL,
        result_json TEXT NOT NULL,
        UNIQUE(order_ref,revision)
    )""")
    db.execute("CREATE INDEX IF NOT EXISTS sf101_access_history ON sf101_access_actions(order_ref,revision)")


@contextmanager
def connection(state, readonly=False):
    db = receiver.connect(state)
    try:
        db.execute("PRAGMA foreign_keys=ON")
        if readonly:
            db.execute("PRAGMA query_only=ON")
            db.execute("BEGIN")
        yield db
    finally:
        if db.in_transaction:
            db.rollback()
        db.close()


def selection(db):
    columns = {row["name"] for row in db.execute("PRAGMA table_info(orders)")}
    recipient = "o.recipient_digest" if "recipient_digest" in columns else "NULL"
    fields = """o.order_ref,o.route_id,o.method,o.network,o.amount_atomic,o.asset_digest,
        o.file_sha256,o.file_bytes,o.state,o.event_id,o.created_at,o.entitled_at,""" + recipient + " AS recipient_digest,"
    if has_policy(db):
        return "SELECT " + fields + """COALESCE(p.enabled,1) AS access_enabled,
            p.expires_at,COALESCE(p.revision,0) AS access_revision,p.updated_at AS access_updated_at
            FROM orders o LEFT JOIN sf101_access_policy p ON p.order_ref=o.order_ref"""
    return "SELECT " + fields + "1 AS access_enabled,NULL AS expires_at,0 AS access_revision,NULL AS access_updated_at FROM orders o"


def order_view(row, at):
    if row["access_enabled"] != 1:
        access_state = "SUSPENDED"
    elif row["expires_at"] is not None and at >= row["expires_at"]:
        access_state = "EXPIRED"
    elif row["state"] == "ENTITLED":
        access_state = "AVAILABLE"
    else:
        access_state = "AWAITING_ENTITLEMENT"
    result = {
        "orderRef": row["order_ref"], "routeId": row["route_id"], "method": row["method"],
        "network": row["network"], "amountAtomic": row["amount_atomic"],
        "assetDigest": row["asset_digest"], "nativeState": row["state"],
        "eventId": row["event_id"], "createdAt": row["created_at"], "entitledAt": row["entitled_at"],
        "fileSha256": row["file_sha256"], "fileBytes": row["file_bytes"],
        "access": {"state": access_state, "enabled": row["access_enabled"] == 1,
                   "expiresAt": None if row["expires_at"] is None else now_text(row["expires_at"]),
                   "revision": row["access_revision"], "updatedAt": row["access_updated_at"]},
    }
    if row["recipient_digest"] is not None:
        result["recipientDigest"] = row["recipient_digest"]
    return result


def get_order(db, ref, at):
    row = db.execute(selection(db) + " WHERE o.order_ref=?", (reference(ref),)).fetchone()
    need(row is not None, "ORDER_NOT_FOUND")
    return order_view(row, at)


def list_orders(state, *, after=None, limit=100, status="all"):
    need(isinstance(limit, int) and 1 <= limit <= 500, "LIMIT_MUST_BE_1_TO_500")
    if after is not None:
        reference(after)
    need(status in {"all", "pending", "available", "suspended", "expired"}, "INVALID_ACCESS_FILTER")
    at = time.time()
    with connection(state, readonly=True) as db:
        present = has_policy(db)
        enabled = "COALESCE(p.enabled,1)" if present else "1"
        expiry = "p.expires_at" if present else "NULL"
        filters = {
            "all": ("1", []),
            "pending": ("o.state='PENDING'", []),
            "available": (f"o.state='ENTITLED' AND {enabled}=1 AND ({expiry} IS NULL OR {expiry}>?)", [at]),
            "suspended": (f"{enabled}=0", []),
            "expired": (f"{enabled}=1 AND {expiry} IS NOT NULL AND {expiry}<=?", [at]),
        }
        predicate, arguments = filters[status]
        if after is not None:
            predicate += " AND o.order_ref>?"
            arguments.append(after)
        rows = db.execute(selection(db) + " WHERE " + predicate + " ORDER BY o.order_ref LIMIT ?",
                          (*arguments, limit + 1)).fetchall()
        more = len(rows) > limit
        orders = [order_view(row, at) for row in rows[:limit]]
        counts = {row["state"]: row["n"] for row in db.execute("SELECT state,COUNT(*) AS n FROM orders GROUP BY state")}
    return {"schema": "stellar-forge.sf101.access-list.v1", "capturedAt": now_text(at),
            "filter": status, "orders": orders, "nextAfter": orders[-1]["orderRef"] if more else None,
            "nativeCounts": counts}


def show_order(state, ref):
    at = time.time()
    with connection(state, readonly=True) as db:
        result = get_order(db, ref, at)
        history = []
        if has_policy(db):
            history = [dict(row) for row in db.execute("""SELECT operation_id,revision,action,actor,reason,occurred_at
                FROM sf101_access_actions WHERE order_ref=? ORDER BY revision DESC LIMIT 50""", (ref,))]
    return {"schema": "stellar-forge.sf101.access-detail.v1", "capturedAt": now_text(at),
            "order": result, "latestActions": history}


def expiry_time(raw):
    need(isinstance(raw, str) and re.fullmatch(r"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:Z|[+-]\d\d:\d\d)", raw),
         "EXPIRY_REQUIRES_RFC3339_SECONDS_AND_TIMEZONE")
    try:
        value = int(datetime.fromisoformat(raw.replace("Z", "+00:00")).timestamp())
    except (ValueError, OverflowError):
        raise AccessError("INVALID_EXPIRY") from None
    need(0 < value <= 253402300799, "INVALID_EXPIRY")
    return value


def change_access(state, *, ref, expected_revision, operation_id, actor, reason,
                  action, expires_at=None, token_env=None):
    reference(ref)
    need(isinstance(expected_revision, int) and 0 <= expected_revision < 2147483647, "INVALID_EXPECTED_REVISION")
    need(isinstance(operation_id, str) and re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._:-]{0,127}", operation_id),
         "INVALID_OPERATION_ID")
    text(actor, 120, "INVALID_ACTOR")
    text(reason, 500, "INVALID_REASON")
    need(action in {"suspend", "resume", "expire", "clear-expiry", "rotate-token"}, "INVALID_ACTION")
    expiration = expiry_time(expires_at) if action == "expire" else None
    next_token_hash = None
    if action == "rotate-token":
        # Use the SAME native secret contract; raw tokens never enter argv, stdout or history.
        need(isinstance(token_env, str) and re.fullmatch(r"[A-Z][A-Z0-9_]{1,64}", token_env), "INVALID_TOKEN_ENV_NAME")
        next_token_hash = receiver.sha(receiver.get_private_env(token_env).encode())
    request = {"ref": ref, "expectedRevision": expected_revision, "actor": actor, "reason": reason,
               "action": action, "expiresAt": expiration, "tokenSha256": next_token_hash}
    request_hash = receiver.sha(compact(request).encode())
    with connection(state) as db:
        db.execute("BEGIN IMMEDIATE")
        ensure_schema(db)
        repeated = db.execute("SELECT request_sha256,result_json FROM sf101_access_actions WHERE operation_id=?",
                              (operation_id,)).fetchone()
        if repeated:
            need(repeated["request_sha256"] == request_hash, "OPERATION_ID_REUSED_WITH_DIFFERENT_REQUEST")
            result = json.loads(repeated["result_json"])
            result["replayed"] = True
            db.commit()
            return result
        at = time.time()
        before = get_order(db, ref, at)
        need(before["access"]["revision"] == expected_revision, "ACCESS_REVISION_CONFLICT")
        policy = db.execute("SELECT * FROM sf101_access_policy WHERE order_ref=?", (ref,)).fetchone()
        enabled = policy["enabled"] if policy else 1
        expiry = policy["expires_at"] if policy else None
        if action == "suspend":
            need(enabled == 1, "ACCESS_ALREADY_SUSPENDED")
            enabled = 0
        elif action == "resume":
            need(enabled == 0, "ACCESS_ALREADY_ENABLED")
            enabled = 1
        elif action == "expire":
            need(expiration > at, "EXPIRY_MUST_BE_IN_FUTURE_USE_SUSPEND_FOR_IMMEDIATE_STOP")
            need(expiry != expiration, "EXPIRY_UNCHANGED")
            expiry = expiration
        elif action == "clear-expiry":
            need(expiry is not None, "NO_EXPIRY_CONFIGURED")
            expiry = None
        elif action == "rotate-token":
            old_hash = db.execute("SELECT token_sha256 FROM orders WHERE order_ref=?", (ref,)).fetchone()[0]
            need(old_hash != next_token_hash, "TOKEN_UNCHANGED")
            changed = db.execute("UPDATE orders SET token_sha256=? WHERE order_ref=? AND token_sha256=?",
                                 (next_token_hash, ref, old_hash)).rowcount
            need(changed == 1, "TOKEN_REVISION_CONFLICT")
        revision = expected_revision + 1
        stamp = now_text(at)
        db.execute("""INSERT INTO sf101_access_policy(order_ref,enabled,expires_at,revision,updated_at)
            VALUES(?,?,?,?,?) ON CONFLICT(order_ref) DO UPDATE SET enabled=excluded.enabled,
            expires_at=excluded.expires_at,revision=excluded.revision,updated_at=excluded.updated_at""",
                   (ref, enabled, expiry, revision, stamp))
        result = {"schema": "stellar-forge.sf101.access-change.v1", "operationId": operation_id,
                  "action": action, "replayed": False, "order": get_order(db, ref, at)}
        db.execute("""INSERT INTO sf101_access_actions(operation_id,order_ref,revision,action,actor,reason,
            request_sha256,occurred_at,result_json) VALUES(?,?,?,?,?,?,?,?,?)""",
                   (operation_id, ref, revision, action, actor, reason, request_hash, stamp, compact(result)))
        db.commit()
        return result


def verify_file(state, ref):
    with connection(state, readonly=True) as db:
        order = db.execute("SELECT file_path,file_sha256,file_bytes FROM orders WHERE order_ref=?", (reference(ref),)).fetchone()
        need(order is not None, "ORDER_NOT_FOUND")
    try:
        with receiver.snapshot_private_file(order["file_path"], directory=state) as content:
            size, fingerprint = content.size, content.sha256
    except (OSError, ValueError):
        return {"schema": "stellar-forge.sf101.file-health.v1", "orderRef": ref,
                "status": "SOURCE_UNAVAILABLE", "expectedSha256": order["file_sha256"],
                "expectedBytes": order["file_bytes"]}
    return {"schema": "stellar-forge.sf101.file-health.v1", "orderRef": ref,
            "status": "MATCH" if fingerprint == order["file_sha256"] and size == order["file_bytes"] else "SOURCE_CHANGED",
            "expectedSha256": order["file_sha256"], "expectedBytes": order["file_bytes"],
            "actualSha256": fingerprint, "actualBytes": size}


def export_support(state, output):
    path = Path(output)
    need(path.is_absolute() and str(path) == os.path.normpath(output) and path.resolve() == path,
         "NORMALIZED_NON_SYMLINK_OUTPUT_REQUIRED")
    at, count, size = time.time(), 0, 0
    sha = hashlib.sha256()
    fd = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY | getattr(os, "O_NOFOLLOW", 0), 0o600)
    try:
        with os.fdopen(fd, "wb") as stream:
            def write(value):
                nonlocal size
                raw = value.encode()
                size += len(raw)
                need(size <= 256 * 1024 * 1024, "SUPPORT_EXPORT_LIMIT_256_MIB")
                stream.write(raw)
                sha.update(raw)
            with connection(state, readonly=True) as db:
                write('{"schema":"stellar-forge.sf101.access-support.v1","capturedAt":' + compact(now_text(at)) + ',"orders":[')
                for row in db.execute(selection(db) + " ORDER BY o.order_ref"):
                    if count:
                        write(",")
                    write(compact(order_view(row, at)))
                    count += 1
                write('],"accessActions":[')
                if has_policy(db):
                    first = True
                    for row in db.execute("""SELECT operation_id,order_ref,revision,action,actor,reason,occurred_at
                        FROM sf101_access_actions ORDER BY order_ref,revision"""):
                        if not first:
                            write(",")
                        write(compact(dict(row)))
                        first = False
                write("]}\n")
            stream.flush()
            os.fsync(stream.fileno())
    except BaseException:
        path.unlink(missing_ok=True)
        raise
    return {"status": "WRITTEN", "path": str(path), "orders": count, "bytes": size, "sha256": sha.hexdigest()}


def main(argv=None):
    parser = argparse.ArgumentParser(description="Merchant order inventory and file-access control in the original SF101 store")
    commands = parser.add_subparsers(dest="command", required=True)
    for name in ("list", "show", "verify-file", "export", "suspend", "resume", "expire", "clear-expiry", "rotate-token"):
        sub = commands.add_parser(name)
        sub.add_argument("--state", required=True)
        if name == "list":
            sub.add_argument("--after")
            sub.add_argument("--limit", type=int, default=100)
            sub.add_argument("--status", choices=("all", "pending", "available", "suspended", "expired"), default="all")
        elif name == "export":
            sub.add_argument("--out", required=True)
        else:
            sub.add_argument("--ref", required=True)
        if name in ("suspend", "resume", "expire", "clear-expiry", "rotate-token"):
            sub.add_argument("--expected-revision", required=True, type=int)
            sub.add_argument("--operation-id", required=True)
            sub.add_argument("--actor", required=True)
            sub.add_argument("--reason", required=True)
        if name == "expire":
            sub.add_argument("--expires-at", required=True)
        if name == "rotate-token":
            sub.add_argument("--token-env", default="SF101_REPLACEMENT_CLAIM_TOKEN")
    args = parser.parse_args(argv)
    os.umask(0o077)
    state = receiver.require_private_dir(args.state)
    if args.command == "list":
        result = list_orders(state, after=args.after, limit=args.limit, status=args.status)
    elif args.command == "show":
        result = show_order(state, args.ref)
    elif args.command == "verify-file":
        result = verify_file(state, args.ref)
    elif args.command == "export":
        result = export_support(state, args.out)
    else:
        result = change_access(state, ref=args.ref, expected_revision=args.expected_revision,
                               operation_id=args.operation_id, actor=args.actor, reason=args.reason,
                               action=args.command, expires_at=getattr(args, "expires_at", None),
                               token_env=getattr(args, "token_env", None))
    print(compact(result))


if __name__ == "__main__":
    try:
        main()
    except AccessError as error:
        print("SF101_ACCESS_ERROR " + str(error), file=sys.stderr)
        sys.exit(2)
    except (OSError, ValueError, sqlite3.Error):
        # Native exception text may contain a private source path; show a stable code.
        print("SF101_ACCESS_ERROR NATIVE_STORE_OR_INPUT_UNAVAILABLE", file=sys.stderr)
        sys.exit(2)
