#!/usr/bin/env python3
"""SF101: authenticated SF98 merchant events -> durable paid file entitlements.

Python 3.11+ standard library. Bind loopback behind the merchant's HTTPS proxy.
The SF30 native seller and SF98 sender remain responsible for settlement/signing.
"""
from __future__ import annotations

import argparse
import hashlib
import hmac
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import re
import secrets
import sqlite3
import stat
import sys
import tempfile
import time
from datetime import datetime, timezone
from urllib.parse import unquote

SCHEMA = "stellar-forge.sf98.webhook.v1"
MAX_BODY = 8192
MAX_FILE = 32 * 1024 * 1024
FILE_CHUNK = 64 * 1024
SPOOL_MEMORY = 1024 * 1024
TRANSFER_SCHEMA = "stellar-forge.sf101.byte-ranges.v1"
CLOCK_WINDOW = 300
ID_RE = re.compile(r"[a-f0-9]{64}\Z")
REF_RE = re.compile(r"[A-Za-z0-9._:-]{1,80}\Z")
ROUTE_RE = re.compile(r"[A-Za-z0-9_-]{1,80}\Z")
ATOMIC_RE = re.compile(r"[1-9][0-9]{0,49}\Z")
NETWORK_RE = re.compile(r"[A-Za-z0-9._:-]{3,100}\Z")
METHODS = {"GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"}


def fail(reason: str) -> None:
    raise ValueError(reason)


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def is_match(pattern: re.Pattern[str], value: object) -> bool:
    return isinstance(value, str) and pattern.fullmatch(value) is not None


def require_private_dir(raw: str, create: bool = False) -> Path:
    target = Path(raw)
    if not target.is_absolute() or str(target) == "/" or str(target) != os.path.normpath(raw):
        fail("Normalized absolute non-root --state required")
    if create:
        target.mkdir(mode=0o700, parents=False, exist_ok=True)
    info = target.lstat()
    if not stat.S_ISDIR(info.st_mode) or info.st_mode & 0o077:
        fail("State directory must be a real private 0700 directory")
    return target


def connect(state: Path) -> sqlite3.Connection:
    dbpath = state / "merchant.sqlite3"
    if dbpath.is_symlink() or not dbpath.is_file():
        fail("Run init first; existing real merchant.sqlite3 required")
    if dbpath.stat().st_mode & 0o077:
        fail("Database permissions must be 0600")
    db = sqlite3.connect(str(dbpath), timeout=5, isolation_level=None)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA busy_timeout=5000")
    db.execute("PRAGMA synchronous=FULL")
    try:
        migrate_recipient_binding(db)
    except Exception:
        db.close()
        raise
    return db


def migrate_recipient_binding(db: sqlite3.Connection) -> None:
    """Keep historical rows intact; their missing recipient stays explicitly unknown."""
    columns = {row[1] for row in db.execute("PRAGMA table_info(orders)")}
    if "recipient_digest" in columns:
        return
    if not columns:
        fail("Existing merchant database has no orders table; run init first")
    db.execute("BEGIN IMMEDIATE")
    try:
        # Recheck under the write lock when multiple workers start together.
        if "recipient_digest" not in {row[1] for row in db.execute("PRAGMA table_info(orders)")}:
            db.execute("ALTER TABLE orders ADD COLUMN recipient_digest TEXT")
        db.execute("COMMIT")
    except Exception:
        db.execute("ROLLBACK")
        raise


def init_state(state: Path) -> None:
    dbpath = state / "merchant.sqlite3"
    if dbpath.is_symlink():
        fail("Database must not be symlink")
    db = sqlite3.connect(dbpath)
    try:
        os.chmod(dbpath, 0o600)
        db.execute("PRAGMA journal_mode=WAL")
        db.execute("PRAGMA synchronous=FULL")
        db.executescript("""
        CREATE TABLE IF NOT EXISTS orders (
            order_ref TEXT PRIMARY KEY,
            route_id TEXT NOT NULL, method TEXT NOT NULL,
            network TEXT NOT NULL, amount_atomic TEXT NOT NULL,
            asset_digest TEXT NOT NULL, recipient_digest TEXT,
            file_path TEXT NOT NULL, file_sha256 TEXT NOT NULL,
            file_bytes INTEGER NOT NULL, token_sha256 TEXT NOT NULL,
            state TEXT NOT NULL DEFAULT 'PENDING' CHECK(state IN ('PENDING','ENTITLED')),
            event_id TEXT UNIQUE,
            created_at TEXT NOT NULL, entitled_at TEXT
        );
        CREATE TABLE IF NOT EXISTS events (
            event_id TEXT PRIMARY KEY,
            payload_sha256 TEXT NOT NULL, order_ref TEXT NOT NULL UNIQUE,
            recorded_at TEXT NOT NULL,
            FOREIGN KEY(order_ref) REFERENCES orders(order_ref)
        );
        CREATE INDEX IF NOT EXISTS orders_state ON orders(state);
        """)
        db.commit()
        migrate_recipient_binding(db)
    finally:
        db.close()


class VerifiedPrivateFile:
    """One verified byte snapshot; the caller closes its private temporary spool."""

    def __init__(self, stream, digest: str, size: int):
        self.stream = stream
        self.sha256 = digest
        self.size = size

    @property
    def etag(self) -> str:
        return '"sha256-' + self.sha256 + '"'

    def close(self) -> None:
        self.stream.close()

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.close()


def file_identity(info) -> tuple:
    return (info.st_dev, info.st_ino, info.st_mode, info.st_size,
            info.st_mtime_ns, info.st_ctime_ns)


def snapshot_private_file(path: str, *, directory: Path | None = None) -> VerifiedPrivateFile:
    """Hash into a private spool before release, independent of later source edits.

    The original 32 MiB product cap remains. Only the first MiB is held in RAM;
    larger snapshots spill to an anonymous private temporary file. Reading the
    original descriptor again after hashing would allow a source edit to change
    already-authorized response bytes, so transfer reads only this snapshot.
    """
    target = Path(path)
    if not target.is_absolute() or os.path.normpath(path) != path:
        fail("Absolute normalized content file required")
    named = target.lstat()
    if not stat.S_ISREG(named.st_mode) or named.st_mode & 0o077 or not 0 < named.st_size <= MAX_FILE:
        fail("Content must be a private regular file, 1 byte to 32 MiB")
    flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_NONBLOCK", 0)
    fd = os.open(path, flags)
    snapshot = None
    try:
        info = os.fstat(fd)
        if file_identity(info) != file_identity(named):
            fail("Content changed while opening")
        snapshot = tempfile.SpooledTemporaryFile(max_size=SPOOL_MEMORY, mode="w+b", dir=directory)
        digest = hashlib.sha256()
        size = 0
        with os.fdopen(fd, "rb", closefd=False) as source:
            while chunk := source.read(FILE_CHUNK):
                size += len(chunk)
                if size > info.st_size or size > MAX_FILE:
                    fail("Content changed during read or exceeded 32 MiB")
                digest.update(chunk)
                snapshot.write(chunk)
        if size != info.st_size or file_identity(os.fstat(fd)) != file_identity(info):
            fail("Content changed during read")
        snapshot.seek(0)
        return VerifiedPrivateFile(snapshot, digest.hexdigest(), size)
    except BaseException:
        if snapshot is not None:
            snapshot.close()
        raise
    finally:
        os.close(fd)


def read_private_file(path: str) -> tuple[bytes, str]:
    """Compatibility interface for original callers that need the whole payload."""
    with snapshot_private_file(path) as content:
        return content.stream.read(), content.sha256


def get_private_env(name: str, *, minimum: int = 32) -> str:
    if not re.fullmatch(r"[A-Z][A-Z0-9_]{1,64}", name):
        fail("Invalid environment variable name")
    secret = os.environ.get(name, "")
    if not minimum <= len(secret.encode("utf-8")) <= 1024:
        fail("Required private secret missing or outside 32-1024 bytes")
    return secret


def enroll(args: argparse.Namespace, state: Path) -> dict:
    if not is_match(REF_RE, args.ref) or not is_match(ROUTE_RE, args.route):
        fail("Invalid order reference or route identifier")
    if args.method not in METHODS or not is_match(NETWORK_RE, args.network):
        fail("Invalid method or network")
    if not is_match(ATOMIC_RE, args.amount) or not is_match(ID_RE, args.asset_digest):
        fail("Positive atomic amount and 64-character SHA-256 asset digest required")
    if not is_match(ID_RE, args.recipient_digest):
        fail("64-character SHA-256 of the selected payTo recipient required")
    token = get_private_env(args.claim_env)
    with snapshot_private_file(args.file, directory=state) as content:
        digest, size = content.sha256, content.size
    created = datetime.now(timezone.utc).isoformat()
    with connect(state) as db:
        db.execute("""INSERT INTO orders (order_ref,route_id,method,network,amount_atomic,
                  asset_digest,recipient_digest,file_path,file_sha256,file_bytes,token_sha256,created_at)
                  VALUES (?,?,?,?,?,?,?,?,?,?,?,?)""", (
            args.ref, args.route, args.method, args.network, args.amount,
            args.asset_digest, args.recipient_digest, args.file, digest, size, sha(token.encode()), created,
        ))
    return {"orderRef": args.ref, "state": "PENDING", "sourceSha256": digest,
            "sourceBytes": size, "deliveryPath": "/deliver/" + args.ref}


def bind_recipient(args: argparse.Namespace, state: Path) -> dict:
    """Upgrade an unfulfilled historical order using its merchant-approved recipient."""
    if not is_match(REF_RE, args.ref) or not is_match(ID_RE, args.recipient_digest):
        fail("Existing order reference and selected recipient SHA-256 required")
    db = connect(state)
    try:
        db.execute("BEGIN IMMEDIATE")
        order = db.execute("SELECT * FROM orders WHERE order_ref=?", (args.ref,)).fetchone()
        if order is None:
            fail("Unknown order")
        if order["recipient_digest"] == args.recipient_digest:
            db.execute("COMMIT")
            return {"orderRef": args.ref, "status": "ALREADY_BOUND"}
        if order["recipient_digest"] is not None or order["state"] != "PENDING":
            fail("Only an unbound pending order can acquire a recipient")
        db.execute("UPDATE orders SET recipient_digest=? WHERE order_ref=?",
                   (args.recipient_digest, args.ref))
        db.execute("COMMIT")
        return {"orderRef": args.ref, "status": "RECIPIENT_BOUND"}
    except Exception:
        if db.in_transaction:
            db.execute("ROLLBACK")
        raise
    finally:
        db.close()


def validate_event(payload: object) -> dict:
    if not isinstance(payload, dict) or payload.get("schema") != SCHEMA:
        fail("Unknown event schema")
    required = {"schema", "eventId", "occurredAt", "routeId", "method", "network",
                "amountAtomic", "assetDigest", "orderReference", "settlement"}
    if set(payload) not in (required, required | {"recipientDigest"}):
        fail("Unexpected or missing event field")
    if "recipientDigest" in payload and not is_match(ID_RE, payload["recipientDigest"]):
        fail("Invalid selected recipient identity")
    if not is_match(ID_RE, payload["eventId"]) or not is_match(ROUTE_RE, payload["routeId"]):
        fail("Invalid event/route ID")
    if payload["method"] not in METHODS or not is_match(NETWORK_RE, payload["network"]):
        fail("Invalid method or network")
    if not is_match(ATOMIC_RE, payload["amountAtomic"]) or not is_match(ID_RE, payload["assetDigest"]):
        fail("Invalid payment identity")
    if not is_match(REF_RE, payload["orderReference"]):
        fail("Unbound merchant order reference")
    if payload["settlement"] != "ORIGINAL_NATIVE_SUCCESS":
        fail("Event is not original SF98 native-success notification")
    if not isinstance(payload["occurredAt"], str) or len(payload["occurredAt"]) > 40:
        fail("Invalid event time")
    try:
        dt = datetime.fromisoformat(payload["occurredAt"].replace("Z", "+00:00"))
        if dt.tzinfo is None:
            fail("Event time must have timezone")
    except (TypeError, ValueError):
        fail("Invalid event time")
    return payload


def accept_event(state: Path, payload: dict, raw_body: bytes) -> tuple[int, dict]:
    event_id, order_ref = payload["eventId"], payload["orderReference"]
    fingerprint = sha(raw_body)
    db = connect(state)
    try:
        db.execute("BEGIN IMMEDIATE")
        recorded = db.execute("SELECT * FROM events WHERE event_id=?", (event_id,)).fetchone()
        if recorded is not None:
            if recorded["payload_sha256"] != fingerprint or recorded["order_ref"] != order_ref:
                db.execute("ROLLBACK")
                return 409, {"code": "EVENT_REPLAY_CONFLICT"}
            db.execute("COMMIT")
            return 200, {"status": "ALREADY_ENTITLED", "eventId": event_id, "orderRef": order_ref}
        order = db.execute("SELECT * FROM orders WHERE order_ref=?", (order_ref,)).fetchone()
        if order is None:
            db.execute("ROLLBACK")
            return 404, {"code": "UNREGISTERED_ORDER"}
        if order["state"] != "PENDING":
            db.execute("ROLLBACK")
            return 409, {"code": "ORDER_ALREADY_USED"}
        pairs = (("route_id", "routeId"), ("method", "method"), ("network", "network"),
                 ("amount_atomic", "amountAtomic"), ("asset_digest", "assetDigest"))
        if any(order[left] != payload[right] for left, right in pairs):
            db.execute("ROLLBACK")
            return 409, {"code": "ORDER_PAYMENT_MISMATCH"}
        recipient = payload.get("recipientDigest")
        if order["recipient_digest"] != recipient:
            db.execute("ROLLBACK")
            return 409, {"code": "ORDER_RECIPIENT_NOT_BOUND" if order["recipient_digest"] is None
                         else "ORDER_RECIPIENT_MISMATCH"}
        recorded_at = datetime.now(timezone.utc).isoformat()
        db.execute("INSERT INTO events (event_id,payload_sha256,order_ref,recorded_at) VALUES (?,?,?,?)",
                   (event_id, fingerprint, order_ref, recorded_at))
        db.execute("UPDATE orders SET state='ENTITLED',event_id=?,entitled_at=? WHERE order_ref=? AND state='PENDING'",
                   (event_id, recorded_at, order_ref))
        db.execute("COMMIT")
        return 200, {"status": "ENTITLED", "eventId": event_id, "orderRef": order_ref}
    except Exception:
        if db.in_transaction:
            db.execute("ROLLBACK")
        raise
    finally:
        db.close()


def access_allowed(db: sqlite3.Connection, ref: str, now: float | None = None) -> bool:
    """Read only: merchant policy for an existing order, including pending checkout.

    Callers retain original enrollment/payment/entitlement checks. Absence of a
    configured policy preserves legacy access; it does not establish an order.
    Read the order and this policy inside the same explicit SQLite transaction.
    """
    if not is_match(REF_RE, ref):
        return False
    at = time.time() if now is None else now
    if isinstance(at, bool) or not isinstance(at, (int, float)) or not 0 <= at <= 253402300799:
        fail("Invalid access evaluation time")
    if not db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='sf101_access_policy'").fetchone():
        return True
    policy = db.execute("SELECT enabled,expires_at FROM sf101_access_policy WHERE order_ref=?", (ref,)).fetchone()
    return policy is None or (policy["enabled"] == 1 and
                              (policy["expires_at"] is None or at < policy["expires_at"]))


def get_entitled_snapshot(state: Path, ref: str, token: str) -> VerifiedPrivateFile | None:
    if not is_match(REF_RE, ref) or not 32 <= len(token.encode()) <= 1024:
        return None
    db = connect(state)
    try:
        # One snapshot binds original token/entitlement and access policy together.
        db.execute("BEGIN")
        order = db.execute("SELECT * FROM orders WHERE order_ref=?", (ref,)).fetchone()
        permitted = order is not None and access_allowed(db, ref)
        db.commit()
    finally:
        if db.in_transaction:
            db.rollback()
        db.close()
    if not permitted or order["state"] != "ENTITLED":
        return None
    actual = hashlib.sha256(token.encode()).digest()
    expected = bytes.fromhex(order["token_sha256"])
    if not hmac.compare_digest(actual, expected):
        return None
    content = snapshot_private_file(order["file_path"], directory=state)
    if content.size != order["file_bytes"] or content.sha256 != order["file_sha256"]:
        content.close()
        fail("Merchant source file no longer matches authorized order digest")
    return content


def get_entitled_file(state: Path, ref: str, token: str) -> bytes | None:
    """Preserve original embedding callers while HTTP uses a bounded-memory spool."""
    content = get_entitled_snapshot(state, ref, token)
    if content is None:
        return None
    with content:
        return content.stream.read()


class UnsatisfiableRange(ValueError):
    pass


def select_byte_range(value: str | None, size: int) -> tuple[int, int] | None:
    """Return one inclusive byte range; ignore unknown units and multipart sets."""
    if value is None:
        return None
    if len(value) > 512:
        fail("INVALID_BYTE_RANGE")
    unit, separator, specification = value.partition("=")
    if not separator:
        fail("INVALID_BYTE_RANGE")
    if unit.casefold() != "bytes":
        return None
    # RFC 9110 permits ignoring Range. This endpoint supports one part only.
    if "," in specification:
        return None
    match = re.fullmatch(r"([0-9]*)-([0-9]*)", specification.strip())
    if match is None or not any(match.groups()):
        fail("INVALID_BYTE_RANGE")
    first, last = match.groups()
    if not first:
        suffix = int(last)
        if suffix == 0 or size == 0:
            raise UnsatisfiableRange()
        return max(0, size - suffix), size - 1
    start = int(first)
    end = int(last) if last else size - 1
    if last and end < start:
        fail("INVALID_BYTE_RANGE")
    if start >= size:
        raise UnsatisfiableRange()
    return start, min(end, size - 1)


def etag_matches(values: list[str], etag: str, *, weak: bool = False) -> bool:
    """Evaluate an HTTP entity-tag list, preserving commas inside quoted tags."""
    value = ",".join(values).strip()
    if value == "*":
        return True
    tag = r'(?:W/)?"[\x21\x23-\x7e\x80-\xff]*"'
    if re.fullmatch(rf"[ \t]*{tag}[ \t]*(?:,[ \t]*{tag}[ \t]*)*", value) is None:
        return False
    return any((item.removeprefix("W/") if weak else item) == etag
               for item in re.findall(tag, value))


def make_handler(state: Path, secret: str):
    class MerchantHandler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"
        server_version = "SCF-SF101"
        sys_version = ""

        def log_message(self, format, *args):
            # Do not place order references, bearer tokens, payment details or paths in stdout.
            return

        def reply(self, status: int, body: dict | bytes, content_type="application/json", *, extra_headers=None) -> None:
            raw = body if isinstance(body, bytes) else json.dumps(body, separators=(",", ":")).encode()
            self.send_response(status)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(raw)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Connection", "close")
            for name, value in (extra_headers or {}).items():
                self.send_header(name, value)
            self.end_headers()
            self.close_connection = True
            if self.command != "HEAD":
                self.wfile.write(raw)

        def one_header(self, name: str) -> str | None:
            values = self.headers.get_all(name, [])
            return values[0] if len(values) == 1 else None

        def do_POST(self) -> None:
            if self.path != "/sf98/events":
                return self.reply(404, {"code": "NOT_FOUND"})
            self.connection.settimeout(5)
            length = self.one_header("Content-Length")
            if self.headers.get("Transfer-Encoding") or length is None or not re.fullmatch(r"[1-9][0-9]{0,3}", length):
                return self.reply(400, {"code": "INVALID_BODY_FRAMING"})
            count = int(length)
            if count > MAX_BODY or self.one_header("Content-Type") != "application/json":
                return self.reply(413, {"code": "INVALID_CONTENT"})
            ts = self.one_header("X-SF98-Timestamp")
            signed = self.one_header("X-SF98-Signature")
            identity = self.one_header("Idempotency-Key")
            if (ts is None or not re.fullmatch(r"[1-9][0-9]{9,10}", ts) or
                abs(time.time() - int(ts)) > CLOCK_WINDOW or signed is None or
                re.fullmatch(r"sha256=[a-f0-9]{64}", signed) is None or
                not is_match(ID_RE, identity)):
                return self.reply(401, {"code": "INVALID_SIGNATURE_OR_TIMESTAMP"})
            try:
                body = self.rfile.read(count)
            except (TimeoutError, OSError):
                return self.reply(408, {"code": "READ_TIMEOUT"})
            if len(body) != count:
                return self.reply(400, {"code": "TRUNCATED_BODY"})
            expected = hmac.new(secret.encode(), ts.encode() + b"." + body, hashlib.sha256).hexdigest()
            if not hmac.compare_digest(expected, signed[7:]):
                return self.reply(401, {"code": "INVALID_SIGNATURE_OR_TIMESTAMP"})
            try:
                event = validate_event(json.loads(body))
            except (ValueError, TypeError, UnicodeDecodeError, json.JSONDecodeError):
                return self.reply(422, {"code": "INVALID_EVENT"})
            if event["eventId"] != identity:
                return self.reply(409, {"code": "EVENT_IDEMPOTENCY_CONFLICT"})
            try:
                status, result = accept_event(state, event, body)
                return self.reply(status, result)
            except Exception:
                return self.reply(503, {"code": "LOCAL_MERCHANT_STORE_UNAVAILABLE"})

        def do_GET(self) -> None:
            if self.path == "/health":
                return self.reply(200, {"service": "sf101-merchant-receiver", "status": "READY",
                                        "accessControls": "stellar-forge.sf101.access-policy.v1",
                                        "fileTransfer": TRANSFER_SCHEMA})
            if not self.path.startswith("/deliver/") or self.path.count("/") != 2:
                return self.reply(404, {"code": "NOT_FOUND"})
            reference = unquote(self.path[len("/deliver/"):])
            auth = self.one_header("Authorization")
            if auth is None or not auth.startswith("Bearer "):
                return self.reply(404, {"code": "NOT_FOUND"})
            try:
                content = get_entitled_snapshot(state, reference, auth[7:])
                if content is None:
                    return self.reply(404, {"code": "NOT_FOUND"})
            except Exception:
                return self.reply(503, {"code": "MERCHANT_SOURCE_UNAVAILABLE"})
            # All metadata and conditionals follow the original authorization and
            # exact-source checks. A resumed request re-evaluates current policy.
            with content:
                try:
                    return self.transfer(content)
                except (ConnectionError, TimeoutError, OSError):
                    # A disconnected buyer retains its own verified checkpoint.
                    # Never write an error body into an already-started file.
                    self.close_connection = True

        def do_HEAD(self) -> None:
            return self.do_GET()

        def transfer(self, content: VerifiedPrivateFile) -> None:
            self.connection.settimeout(30)
            etag = content.etag
            metadata = {"ETag": etag, "Accept-Ranges": "bytes"}
            if_match = self.headers.get_all("If-Match", [])
            if if_match and not etag_matches(if_match, etag):
                return self.reply(412, {"code": "FILE_PRECONDITION_FAILED"}, extra_headers=metadata)
            if_none = self.headers.get_all("If-None-Match", [])
            if if_none and etag_matches(if_none, etag, weak=True):
                self.send_response(304)
                self.send_header("ETag", etag)
                self.send_header("Cache-Control", "private, no-store, no-transform")
                self.send_header("Connection", "close")
                self.end_headers()
                self.close_connection = True
                return

            selected = None
            if self.command == "GET":
                ranges = self.headers.get_all("Range", [])
                if len(ranges) > 1:
                    return self.reply(400, {"code": "INVALID_BYTE_RANGE"})
                requested = ranges[0] if ranges else None
                if_range = self.headers.get_all("If-Range", [])
                if requested is not None and if_range and (len(if_range) != 1 or if_range[0].strip() != etag):
                    # There is no Last-Modified validator for an enrolled digest.
                    # A weak/date/mismatched validator selects the complete file.
                    requested = None
                try:
                    selected = select_byte_range(requested, content.size)
                except UnsatisfiableRange:
                    return self.reply(416, {"code": "BYTE_RANGE_NOT_SATISFIABLE"},
                                      extra_headers={**metadata, "Content-Range": f"bytes */{content.size}"})
                except ValueError:
                    return self.reply(400, {"code": "INVALID_BYTE_RANGE"})

            start, end = selected if selected is not None else (0, content.size - 1)
            remaining = end - start + 1
            self.send_response(206 if selected is not None else 200)
            self.send_header("Content-Type", "application/octet-stream")
            self.send_header("Content-Disposition", "attachment")
            self.send_header("Content-Length", str(remaining))
            self.send_header("ETag", etag)
            self.send_header("Accept-Ranges", "bytes")
            if selected is not None:
                self.send_header("Content-Range", f"bytes {start}-{end}/{content.size}")
            self.send_header("Cache-Control", "private, no-store, no-transform")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Connection", "close")
            self.end_headers()
            self.close_connection = True
            if self.command == "HEAD":
                return
            content.stream.seek(start)
            while remaining:
                chunk = content.stream.read(min(FILE_CHUNK, remaining))
                if not chunk:
                    raise OSError("Verified snapshot ended during transfer")
                self.wfile.write(chunk)
                remaining -= len(chunk)

    return MerchantHandler


def main(argv=None):
    parser = argparse.ArgumentParser(description="SF101 actual merchant order -> native SF98 event -> paid file delivery")
    sub = parser.add_subparsers(dest="command", required=True)
    for name in ("init", "enroll", "bind-recipient", "serve", "status", "receipt"):
        p = sub.add_parser(name)
        p.add_argument("--state", required=True)
        if name == "enroll":
            for key in ("ref", "route", "method", "network", "amount", "asset-digest", "recipient-digest", "file"):
                p.add_argument("--" + key, required=True)
            p.add_argument("--claim-env", default="SF101_CLAIM_TOKEN")
        elif name == "bind-recipient":
            p.add_argument("--ref", required=True)
            p.add_argument("--recipient-digest", required=True)
        elif name == "serve":
            p.add_argument("--host", default="127.0.0.1", choices=["127.0.0.1", "::1"])
            p.add_argument("--port", type=int, default=8472)
            p.add_argument("--secret-env", default="SF98_WEBHOOK_SECRET")
        elif name == "receipt":
            p.add_argument("--ref", required=True)
            p.add_argument("--out", required=True)
    args = parser.parse_args(argv)
    os.umask(0o077)
    state = require_private_dir(args.state, create=args.command == "init")
    if args.command == "init":
        init_state(state)
        result = {"schema": "stellar-forge.sf101.store.v1", "status": "READY"}
    elif args.command == "enroll":
        result = enroll(args, state)
    elif args.command == "bind-recipient":
        result = bind_recipient(args, state)
    elif args.command == "serve":
        if not 1 <= args.port <= 65535:
            fail("Port must be 1-65535")
        secret = get_private_env(args.secret_env)
        db = connect(state)
        db.close()
        with ThreadingHTTPServer((args.host, args.port), make_handler(state, secret)) as server:
            print(json.dumps({"status": "LISTENING", "host": args.host, "port": args.port}), flush=True)
            server.serve_forever(poll_interval=0.25)
        return
    elif args.command == "status":
        with connect(state) as db:
            counts = {row["state"]: row["n"] for row in db.execute("SELECT state,COUNT(*) n FROM orders GROUP BY state")}
            events = db.execute("SELECT COUNT(*) FROM events").fetchone()[0]
            legacy_pending = db.execute("SELECT COUNT(*) FROM orders WHERE state='PENDING' AND recipient_digest IS NULL").fetchone()[0]
        result = {"schema": "stellar-forge.sf101.status.v1", "pending": counts.get("PENDING", 0),
                  "entitled": counts.get("ENTITLED", 0), "uniqueEvents": events,
                  "legacyPendingWithoutRecipient": legacy_pending}
    elif args.command == "receipt":
        if not is_match(REF_RE, args.ref):
            fail("Invalid reference")
        with connect(state) as db:
            row = db.execute("SELECT * FROM orders WHERE order_ref=?", (args.ref,)).fetchone()
        if not row or row["state"] != "ENTITLED":
            fail("Order not entitled")
        output = Path(args.out)
        if not output.is_absolute() or str(output) != os.path.normpath(args.out):
            fail("Absolute output path required")
        receipt = {"schema": "stellar-forge.sf101.merchant-entitlement.v1", "orderRef": args.ref,
                   "eventId": row["event_id"], "routeId": row["route_id"], "network": row["network"],
                   "amountAtomic": row["amount_atomic"], "assetDigest": row["asset_digest"],
                   "recipientDigest": row["recipient_digest"],
                   "recipientBinding": "SELECTED_RECIPIENT" if row["recipient_digest"] else "LEGACY_UNSPECIFIED",
                   "fileSha256": row["file_sha256"], "fileBytes": row["file_bytes"],
                   "entitledAt": row["entitled_at"], "authority": "SF98_SIGNED_NATIVE_SUCCESS_NOTICE"}
        with output.open("x", encoding="utf-8") as f:
            os.chmod(output, 0o600)
            f.write(json.dumps(receipt, indent=2) + "\n")
            f.flush()
            os.fsync(f.fileno())
        result = {"status": "WRITTEN", "path": str(output)}
    print(json.dumps(result))


if __name__ == "__main__":
    try:
        main()
    except (ValueError, FileNotFoundError, sqlite3.Error, OSError) as exc:
        print("SF101_ERROR " + str(exc), file=sys.stderr)
        sys.exit(2)
