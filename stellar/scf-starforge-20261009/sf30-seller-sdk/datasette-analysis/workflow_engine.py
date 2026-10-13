"""Durable business requests for the original Datasette and Analysis products.

The native adapter owns source acquisition, analysis, reports and workspace
archives. This module joins those results to the original API/JMS request and
keeps transport attempts recoverable across worker and broker interruptions.
"""
from __future__ import annotations

from contextlib import contextmanager
from datetime import datetime, timezone
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import sqlite3
import tempfile
from urllib.error import HTTPError
from urllib.parse import quote, urlsplit
from urllib.request import HTTPRedirectHandler, ProxyHandler, Request, build_opener
import uuid
import zipfile

SCHEMA = "stellar-forge.source-workflow.v1"
REQUEST_SCHEMA = "stellar-forge.source-workflow-request.v1"
RESULT_SCHEMA = "stellar-forge.source-workflow-result.v1"
CONFIG_SCHEMA = "stellar-forge.source-workflow-configuration.v1"
PACKAGE_SCHEMA = "stellar-forge.source-workflow-package.v1"
RECEIPT_SCHEMA = "stellar-forge.source-workflow-receipt.v1"
_HASH = re.compile(r"[a-f0-9]{64}")
_PROFILE = re.compile(r"[A-Za-z][A-Za-z0-9_.-]{0,99}")
_MAX_JSON = 32 * 1024 * 1024


class WorkflowError(RuntimeError):
    def __init__(self, code, message, *, request_id=None):
        self.code, self.request_id = code, request_id
        super().__init__(message)


def now():
    return datetime.now(timezone.utc).isoformat()


def canonical(value):
    return json.dumps(value, ensure_ascii=False, allow_nan=False,
                      sort_keys=True, separators=(",", ":"))


def digest(value):
    raw = value if isinstance(value, bytes) else canonical(value).encode("utf-8")
    return hashlib.sha256(raw).hexdigest()


def identity(value, label="request ID"):
    if (not isinstance(value, str) or not value or len(value) > 200
            or any(ord(c) < 32 or ord(c) == 127 for c in value)):
        raise WorkflowError("WORKFLOW_ID", "Use the original " + label + " (1–200 printable characters).")
    return value


def read_json(path):
    path = Path(path).expanduser().resolve(strict=True)
    with path.open("rb") as stream:
        raw = stream.read(_MAX_JSON + 1)
    if len(raw) > _MAX_JSON:
        raise WorkflowError("WORKFLOW_JSON_SIZE", "Use the original source archive for large data.")
    return json.loads(raw)


def atomic_json(path, value):
    path = Path(path)
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix=".workflow-", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(canonical(value).encode("utf-8") + b"\n")
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
        parent_fd = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(parent_fd)
        finally:
            os.close(parent_fd)
    finally:
        Path(temporary).unlink(missing_ok=True)


def file_descriptor(path, *, name=None, expected_sha256=None, expected_bytes=None):
    original = Path(path).expanduser().absolute()
    if original.is_symlink() or not original.is_file():
        raise WorkflowError("WORKFLOW_FILE", "Select the complete original regular file.")
    path = original.resolve(strict=True)
    with path.open("rb") as stream:
        size = os.fstat(stream.fileno()).st_size
        sha = hashlib.file_digest(stream, "sha256").hexdigest()
    if (expected_sha256 is not None and sha != expected_sha256
            or expected_bytes is not None and size != expected_bytes):
        raise WorkflowError("WORKFLOW_FILE_CHANGED", "The complete file differs from its selected original.")
    return {"name": name or path.name, "path": str(path), "bytes": size, "sha256": sha}


def delivery_members(result):
    """Keep a supplier's original filenames together inside the full delivery."""
    descriptors = [*result["files"], result["archive"]]
    members = {}
    for item in descriptors:
        name = item["name"]
        if (not isinstance(name, str) or not name or name in {".", ".."}
                or "/" in name or "\\" in name
                or any(ord(c) < 32 or ord(c) == 127 for c in name)
                or name in members):
            raise WorkflowError("WORKFLOW_DELIVERY_NAME", "Use each original plain delivery filename once.")
        members[name] = "delivery/" + name
    supplier = result.get("supplier")
    if supplier is None:
        return members
    if not isinstance(supplier, dict) or not isinstance(supplier.get("files"), list):
        raise WorkflowError("WORKFLOW_SUPPLIER_FILES", "Retain the supplier package's complete original filename map.")
    selected, filenames = {}, set()
    for item in supplier["files"]:
        if not isinstance(item, dict):
            raise WorkflowError("WORKFLOW_SUPPLIER_FILES", "Select each original supplier filename and delivery name.")
        name, filename = item.get("name"), item.get("filename")
        if (not isinstance(name, str) or name not in members or name in selected
                or not isinstance(filename, str) or not filename or filename in {".", ".."}
                or "/" in filename or "\\" in filename
                or any(ord(c) < 32 or ord(c) == 127 for c in filename)
                or filename in filenames):
            raise WorkflowError("WORKFLOW_SUPPLIER_FILES", "The complete supplier filename map has changed.")
        selected[name] = "delivery/supplier/" + filename
        filenames.add(filename)
    if selected.get(supplier.get("manifestName")) != "delivery/supplier/manifest.json":
        raise WorkflowError("WORKFLOW_SUPPLIER_MANIFEST", "Retain the original supplier manifest with its files.")
    if any(name.startswith("Supplier_Report_") and name not in selected for name in members):
        raise WorkflowError("WORKFLOW_SUPPLIER_FILES", "Retain every supplier attachment's original filename.")
    members.update(selected)
    if len(set(members.values())) != len(members) or "delivery/supplier" in members.values():
        raise WorkflowError("WORKFLOW_DELIVERY_NAME", "The supplier directory conflicts with another delivery file.")
    return members


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        raise WorkflowError("WORKFLOW_CALLBACK_REDIRECT", "Use the configured callback's original address.")


class Workflow:
    def __init__(self, workspace):
        selected = Path(workspace).expanduser().absolute()
        selected.mkdir(mode=0o700, parents=True, exist_ok=True)
        if selected.resolve() != selected:
            raise WorkflowError("WORKFLOW_DIRECTORY", "Use the canonical private workflow directory.")
        self.path = selected
        self.db = sqlite3.connect(selected / "source-workflow.sqlite3", timeout=30)
        self.db.row_factory = sqlite3.Row
        self.db.execute("PRAGMA foreign_keys = ON")
        self.db.execute("PRAGMA journal_mode = WAL")
        self.db.execute("PRAGMA synchronous = FULL")
        self.db.executescript("""
            CREATE TABLE IF NOT EXISTS workflow_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS workflow_received_results (
                delivery_id TEXT PRIMARY KEY, result_sha TEXT NOT NULL,
                envelope_json TEXT NOT NULL, receipt_json TEXT NOT NULL,
                transport_json TEXT NOT NULL, received_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS workflow_requests (
                request_id TEXT PRIMARY KEY, request_sha TEXT NOT NULL,
                request_json TEXT NOT NULL, profile TEXT NOT NULL,
                run_id TEXT NOT NULL UNIQUE, status TEXT NOT NULL,
                configuration_json TEXT, configuration_sha TEXT,
                result_json TEXT, public_result_json TEXT, result_sha TEXT,
                delivery_id TEXT, created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL, last_error TEXT
            );
            CREATE TABLE IF NOT EXISTS workflow_events (
                seq INTEGER PRIMARY KEY AUTOINCREMENT,
                request_id TEXT NOT NULL REFERENCES workflow_requests(request_id),
                kind TEXT NOT NULL, payload_json TEXT NOT NULL, created_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS workflow_publications (
                attempt_id TEXT PRIMARY KEY,
                request_id TEXT NOT NULL REFERENCES workflow_requests(request_id),
                kind TEXT NOT NULL, delivery_id TEXT NOT NULL, result_sha TEXT NOT NULL,
                destination_json TEXT NOT NULL, status TEXT NOT NULL,
                started_at TEXT NOT NULL, finished_at TEXT, response_json TEXT
            );
        """)
        with self.db:
            self.db.execute("INSERT OR IGNORE INTO workflow_meta(key,value) VALUES('workspaceId',?)", (uuid.uuid4().hex,))
        os.chmod(selected / "source-workflow.sqlite3", 0o600)

    def close(self):
        self.db.close()

    def __enter__(self):
        return self

    def __exit__(self, *args):
        self.close()

    @contextmanager
    def lock(self, request_id):
        directory = self.path / "locks"
        directory.mkdir(mode=0o700, exist_ok=True)
        with (directory / (digest(request_id) + ".lock")).open("a+b") as stream:
            try:
                fcntl.flock(stream, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                raise WorkflowError("WORKFLOW_RUNNING", "The original request is running; read its current state.",
                                    request_id=request_id) from None
            try:
                yield None
            finally:
                fcntl.flock(stream, fcntl.LOCK_UN)

    def is_running(self, request_id):
        path = self.path / "locks" / (digest(request_id) + ".lock")
        if not path.exists():
            return False
        with path.open("r+b") as stream:
            try:
                fcntl.flock(stream, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                return True
            fcntl.flock(stream, fcntl.LOCK_UN)
        return False

    def _row(self, request_id):
        row = self.db.execute("SELECT * FROM workflow_requests WHERE request_id = ?",
                              (identity(request_id),)).fetchone()
        if row is None:
            raise WorkflowError("WORKFLOW_NOT_FOUND", "Receive the original business request first.",
                                request_id=request_id)
        return row

    def _event(self, request_id, kind, value):
        self.db.execute(
            "INSERT INTO workflow_events(request_id,kind,payload_json,created_at) VALUES(?,?,?,?)",
            (request_id, kind, canonical(value), now()))

    def _directory(self, row):
        return self.path / "requests" / row["run_id"]

    def _state(self, row):
        request = json.loads(row["request_json"])
        value = {"schema": SCHEMA, "requestId": row["request_id"],
                 "correlationId": request["correlationId"], "profile": row["profile"],
                 "runId": row["run_id"], "status": row["status"], "active": self.is_running(row["request_id"]),
                 "createdAt": row["created_at"], "updatedAt": row["updated_at"],
                 "deliveryId": row["delivery_id"], "resultSha256": row["result_sha"]}
        if row["last_error"]:
            value["error"] = json.loads(row["last_error"])
        return value

    def status(self, request_id=None, *, history=False):
        if request_id is None:
            return {"schema": SCHEMA, "requests": [
                self._state(row) for row in self.db.execute(
                    "SELECT * FROM workflow_requests ORDER BY updated_at DESC")]}
        row = self._row(request_id)
        value = self._state(row)
        value["request"] = json.loads(row["request_json"])
        if row["public_result_json"]:
            value["result"] = json.loads(row["public_result_json"])
        value["publications"] = [{
            "attemptId": r["attempt_id"], "kind": r["kind"], "status": r["status"],
            "deliveryId": r["delivery_id"], "startedAt": r["started_at"],
            "finishedAt": r["finished_at"],
            "response": json.loads(r["response_json"]) if r["response_json"] else None,
        } for r in self.db.execute(
            "SELECT * FROM workflow_publications WHERE request_id=? ORDER BY started_at",
            (request_id,))]
        value["exports"] = [json.loads(r["payload_json"]) for r in self.db.execute(
            "SELECT payload_json FROM workflow_events WHERE request_id=? AND kind='WORKSPACE_EXPORTED' ORDER BY seq DESC",
            (request_id,))]
        value["exports"] = [item for item in value["exports"] if Path(item["path"]).is_file()]
        if history:
            value["history"] = [{
                "sequence": r["seq"], "kind": r["kind"], "at": r["created_at"],
                "value": json.loads(r["payload_json"]),
            } for r in self.db.execute(
                "SELECT * FROM workflow_events WHERE request_id=? ORDER BY seq", (request_id,))]
        return value

    def accept(self, incoming, *, execution_id=None, transport=None):
        if not isinstance(incoming, dict):
            raise WorkflowError("WORKFLOW_REQUEST", "Supply the original business request object.")
        explicit_transport = transport is not None
        transport = transport if explicit_transport else (incoming if "data" in incoming and "requestId" not in incoming else {})
        if not isinstance(transport, dict):
            raise WorkflowError("WORKFLOW_TRANSPORT", "Use the original JMS transport object.")
        body = incoming if explicit_transport else transport.get("data", incoming)
        if isinstance(body, str):
            body = json.loads(body)
        if not isinstance(body, dict):
            raise WorkflowError("WORKFLOW_REQUEST", "The JMS data must contain the original request object.")
        request_id = identity(body.get("requestId"))
        if (body.get("correlationId") and transport.get("correlationId")
                and body["correlationId"] != transport["correlationId"]):
            raise WorkflowError("WORKFLOW_CORRELATION_CHANGED", "The business request and native JMS correlation differ.")
        correlation = identity(body.get("correlationId") or transport.get("correlationId")
                               or request_id, "correlation ID")
        profile = body.get("profile")
        if not isinstance(profile, str) or not _PROFILE.fullmatch(profile):
            raise WorkflowError("WORKFLOW_PROFILE", "Select the installed workflow profile.")
        if body.get("schema", REQUEST_SCHEMA) != REQUEST_SCHEMA:
            raise WorkflowError("WORKFLOW_REQUEST_SCHEMA", "Use the source workflow request schema.")
        parameters = body.get("parameters", {})
        if not isinstance(parameters, dict):
            raise WorkflowError("WORKFLOW_PARAMETERS", "Business parameters must be an object.")
        request = {**body, "schema": REQUEST_SCHEMA, "requestId": request_id,
                   "correlationId": correlation, "profile": profile, "parameters": parameters}
        if "parentRequestId" in request:
            identity(request["parentRequestId"], "parent request ID")
        request_sha = digest(request)
        run_id = digest({"requestId": request_id, "profile": profile, "request": request_sha})[:32]
        with self.lock(request_id), self.db:
            existing = self.db.execute("SELECT * FROM workflow_requests WHERE request_id=?",
                                       (request_id,)).fetchone()
            if existing is not None and existing["request_sha"] != request_sha:
                raise WorkflowError("WORKFLOW_REQUEST_CHANGED",
                                    "This request ID already has different original inputs. Use a successor request ID.",
                                    request_id=request_id)
            if existing is None:
                timestamp = now()
                self.db.execute(
                    "INSERT INTO workflow_requests(request_id,request_sha,request_json,profile,run_id,"
                    "status,created_at,updated_at) VALUES(?,?,?,?,?,'RECEIVED',?,?)",
                    (request_id, request_sha, canonical(request), profile, run_id, timestamp, timestamp))
                self._event(request_id, "REQUEST_RECEIVED", {"requestSha256": request_sha})
            original = {"businessRequest": incoming, "transport": transport} if explicit_transport else incoming
            intake_sha = digest(original)
            atomic_json(self.path / "requests" / run_id / "intake" / (intake_sha + ".json"), original)
            meta = {"executionId": execution_id, "messageId": transport.get("messageId"),
                    "correlationId": correlation, "originalSha256": intake_sha}
            self._event(request_id, "TRANSPORT_RECEIVED" if existing is None else "REQUEST_REDELIVERED", meta)
        value = self.status(request_id)
        value["replayed"] = existing is not None
        return value

    def _bind(self, row, configuration):
        if (not isinstance(configuration, dict)
                or configuration.get("schema", CONFIG_SCHEMA) != CONFIG_SCHEMA
                or configuration.get("profile") != row["profile"]):
            raise WorkflowError("WORKFLOW_CONFIGURATION", "Use the installed configuration for this request's profile.")
        cfg = json.loads(canonical(configuration))
        cfg["schema"] = CONFIG_SCHEMA
        sha = digest(cfg)
        if row["configuration_sha"] and row["configuration_sha"] != sha:
            raise WorkflowError("WORKFLOW_CONFIGURATION_CHANGED",
                                "Continue with this request's retained configuration. Use a successor request for a changed plan.")
        if not row["configuration_sha"]:
            with self.db:
                self.db.execute(
                    "UPDATE workflow_requests SET configuration_json=?,configuration_sha=?,updated_at=? WHERE request_id=?",
                    (canonical(cfg), sha, now(), row["request_id"]))
                self._event(row["request_id"], "CONFIGURATION_SELECTED", {"sha256": sha})
            atomic_json(self._directory(row) / "configuration.json", cfg)
        return cfg

    def _artifact(self, descriptor, *, default_type="application/octet-stream"):
        if not isinstance(descriptor, dict) or not descriptor.get("path"):
            raise WorkflowError("WORKFLOW_RESULT_FILE", "The native result must identify each complete file.")
        path = Path(descriptor["path"]).resolve(strict=True)
        if not path.is_relative_to(self.path):
            raise WorkflowError("WORKFLOW_RESULT_LOCATION",
                                "Receive the complete native output into this request's delivery directory.")
        result = file_descriptor(path, name=descriptor.get("name"),
                                 expected_sha256=descriptor.get("sha256"),
                                 expected_bytes=descriptor.get("bytes"))
        name = result["name"]
        if not isinstance(name, str) or Path(name).name != name or name in {"", ".", ".."}:
            raise WorkflowError("WORKFLOW_RESULT_NAME", "Use the original plain filename for each delivery.")
        kind = descriptor.get("contentType")
        result["contentType"] = kind if isinstance(kind, str) and kind else default_type
        return result

    def run(self, request_id, configuration, *, adapter_factory=None):
        with self.lock(request_id):
            row = self._row(request_id)
            cfg = self._bind(row, configuration)
            if row["result_json"]:
                return self.status(request_id)
            if adapter_factory is None:
                if cfg.get("adapter") == "bdnb":
                    from bdnb_workflow import BdnbWorkflowAdapter
                    adapter_factory = BdnbWorkflowAdapter
                else:
                    from workflow_analysis import NativeWorkflowAdapter
                    adapter_factory = NativeWorkflowAdapter
            directory = self._directory(row) / "native"
            directory.mkdir(mode=0o700, parents=True, exist_ok=True)
            with self.db:
                self.db.execute("UPDATE workflow_requests SET status='RUNNING',last_error=NULL,updated_at=? WHERE request_id=?",
                                (now(), request_id))
                self._event(request_id, "NATIVE_RUN_STARTED", {"runId": row["run_id"]})

            def progress(value):
                with self.db:
                    self._event(request_id, "NATIVE_PROGRESS", value)
                    self.db.execute("UPDATE workflow_requests SET updated_at=? WHERE request_id=?", (now(), request_id))

            try:
                adapter = adapter_factory(cfg, workspace=directory, progress=progress)
                result = adapter.run(json.loads(row["request_json"]), row["run_id"])
                if not isinstance(result, dict) or not isinstance(result.get("files"), list):
                    raise WorkflowError("WORKFLOW_NATIVE_RESULT", "The native operation must return its full delivery.")
                result = json.loads(canonical(result))
                result["files"] = [self._artifact(v) for v in result["files"]]
                result["archive"] = self._artifact(result["archive"], default_type="application/zip")
                names = [f["name"] for f in result["files"] + [result["archive"]]]
                if len(names) != len(set(names)):
                    if any(f == result["archive"] for f in result["files"]):
                        result["files"] = [f for f in result["files"] if f != result["archive"]]
                    if len({f["name"] for f in result["files"] + [result["archive"]]}) != len(result["files"]) + 1:
                        raise WorkflowError("WORKFLOW_DUPLICATE_FILE", "The native delivery has conflicting filenames.")
                base = cfg.get("delivery", {}).get("artifactBaseUrl", "").rstrip("/")
                route = base + "/api/requests/" + quote(request_id, safe="") + "/files/"

                def published_file(f):
                    return {k: f[k] for k in ("name", "bytes", "sha256", "contentType")} | {
                        "href": route + quote(f["name"], safe="")}

                delivery_members(result)
                public = {k: result[k] for k in ("edition", "analysis", "nativeIds", "complete", "supplier") if k in result}
                public["files"] = [published_file(f) for f in result["files"]]
                public["archive"] = published_file(result["archive"])
                result_sha = digest(public)
                delivery_id = digest({"runId": row["run_id"], "resultSha256": result_sha})[:40]
                atomic_json(self._directory(row) / "native-result.json", result)
                atomic_json(self._directory(row) / "result.json", public)
                with self.db:
                    self.db.execute(
                        "UPDATE workflow_requests SET status='RESULT_READY',result_json=?,public_result_json=?,"
                        "result_sha=?,delivery_id=?,updated_at=?,last_error=NULL WHERE request_id=?",
                        (canonical(result), canonical(public), result_sha, delivery_id, now(), request_id))
                    self._event(request_id, "RESULT_READY",
                                {"deliveryId": delivery_id, "resultSha256": result_sha,
                                 "files": len(result["files"]) + 1, "nativeIds": result.get("nativeIds", {})})
            except Exception as error:
                detail = {"code": getattr(error, "code", type(error).__name__), "message": str(error)}
                with self.db:
                    self.db.execute("UPDATE workflow_requests SET status='FAILED',last_error=?,updated_at=? WHERE request_id=?",
                                    (canonical(detail), now(), request_id))
                    self._event(request_id, "NATIVE_RUN_INTERRUPTED", detail)
                raise
        return self.status(request_id)

    def envelope(self, request_id):
        row = self._row(request_id)
        if not row["public_result_json"]:
            raise WorkflowError("WORKFLOW_RESULT_PENDING", "Continue the original source and analysis operation.",
                                request_id=request_id)
        request = json.loads(row["request_json"])
        return {"schema": RESULT_SCHEMA, "requestId": request_id,
                "correlationId": request["correlationId"], "runId": row["run_id"],
                "deliveryId": row["delivery_id"], "resultSha256": row["result_sha"],
                "result": json.loads(row["public_result_json"])}

    def _attempt(self, request_id, attempt_id, kind, destination):
        identity(attempt_id, "publication attempt ID")
        envelope = self.envelope(request_id)
        destination_json = canonical(destination)
        existing = self.db.execute("SELECT * FROM workflow_publications WHERE attempt_id=?", (attempt_id,)).fetchone()
        if existing and (existing["request_id"] != request_id or existing["kind"] != kind
                         or existing["destination_json"] != destination_json):
            raise WorkflowError("WORKFLOW_ATTEMPT_CHANGED", "Continue the original attempt and destination.")
        if existing is None:
            with self.db:
                self.db.execute(
                    "INSERT INTO workflow_publications(attempt_id,request_id,kind,delivery_id,result_sha,"
                    "destination_json,status,started_at) VALUES(?,?,?,?,?,?,'PREPARED',?)",
                    (attempt_id, request_id, kind, envelope["deliveryId"], envelope["resultSha256"],
                     destination_json, now()))
                self._event(request_id, "PUBLICATION_PREPARED",
                            {"attemptId": attempt_id, "kind": kind, "deliveryId": envelope["deliveryId"]})
        return envelope, existing

    def publish(self, request_id, attempt_id):
        with self.lock(request_id):
            row = self._row(request_id)
            cfg = json.loads(row["configuration_json"] or "{}")
            delivery = cfg.get("delivery", {})
            destination = delivery.get("jms", delivery.get("destination", {}))
            if (not isinstance(destination, dict) or not destination.get("destinationName")
                    or destination.get("destinationType", "QUEUE") not in {"QUEUE", "TOPIC"}):
                raise WorkflowError("WORKFLOW_JMS_DESTINATION", "Select the installed result queue or topic.")
            target = {"destinationName": destination["destinationName"],
                      "destinationType": destination.get("destinationType", "QUEUE"),
                      "correlationMode": destination.get("correlationMode", "business-properties")}
            envelope, previous = self._attempt(request_id, attempt_id, "JMS", target)
            item = {"data": envelope, "correlationId": envelope["correlationId"],
                    "headers": {"businessRequestId": request_id,
                                "businessCorrelationId": envelope["correlationId"],
                                "deliveryId": envelope["deliveryId"],
                                "resultSha256": envelope["resultSha256"]}}
            if destination.get("replyTo"):
                item["replyTo"] = destination["replyTo"]
                item["replyToType"] = destination.get("replyToType", "QUEUE")
            return {"schema": SCHEMA, "requestId": request_id, "deliveryId": envelope["deliveryId"],
                    "attemptId": attempt_id, "resultSha256": envelope["resultSha256"],
                    "status": previous["status"] if previous else "PREPARED",
                    "jms": item, "destination": target}

    def published(self, request_id, attempt_id, *, count, response=None):
        if type(count) is not int or count != 1:
            raise WorkflowError("WORKFLOW_PUBLICATION_COUNT", "Record the original producer's one-message result.")
        with self.lock(request_id), self.db:
            attempt = self.db.execute("SELECT * FROM workflow_publications WHERE attempt_id=?", (attempt_id,)).fetchone()
            if attempt is None or attempt["request_id"] != request_id or attempt["kind"] != "JMS":
                raise WorkflowError("WORKFLOW_ATTEMPT_UNKNOWN", "Prepare the original JMS publication first.")
            if attempt["status"] != "PUBLISHED":
                value = {"messagesCount": count, "provider": response}
                self.db.execute("UPDATE workflow_publications SET status='PUBLISHED',finished_at=?,response_json=? WHERE attempt_id=?",
                                (now(), canonical(value), attempt_id))
                self.db.execute(
                    "UPDATE workflow_requests SET status=CASE WHEN status='DELIVERED' THEN status ELSE 'PUBLISHED' END,"
                    "updated_at=? WHERE request_id=?", (now(), request_id))
                self._event(request_id, "JMS_PUBLISHED", {"attemptId": attempt_id, "messagesCount": count})
        return self.status(request_id)

    def acknowledge(self, request_id, receipt):
        expected = self.envelope(request_id)
        if not isinstance(receipt, dict) or receipt.get("schema") != RECEIPT_SCHEMA:
            raise WorkflowError("WORKFLOW_RECEIVER_RESULT", "Supply the receiver's original result acknowledgment.")
        for key in ("requestId", "correlationId", "deliveryId", "resultSha256"):
            if receipt.get(key) != expected[key]:
                raise WorkflowError("WORKFLOW_RECEIVER_IDENTITY", "The receiver's result belongs to a different delivery.")
        with self.lock(request_id), self.db:
            if self._row(request_id)["status"] != "DELIVERED":
                self.db.execute("UPDATE workflow_requests SET status='DELIVERED',updated_at=? WHERE request_id=?",
                                (now(), request_id))
                self._event(request_id, "CUSTOMER_RECEIVED", receipt)
                atomic_json(self._directory(self._row(request_id)) / "customer-received.json", receipt)
        return self.status(request_id)

    def callback(self, request_id, attempt_id):
        with self.lock(request_id):
            row = self._row(request_id)
            configuration = json.loads(row["configuration_json"] or "{}")
            selection = configuration.get("delivery", {}).get("callback", {})
            url = selection.get("url")
            parsed = urlsplit(url or "")
            if (parsed.scheme not in {"https", "http"} or not parsed.hostname
                    or parsed.username or parsed.password or parsed.fragment
                    or parsed.scheme == "http" and parsed.hostname not in {"127.0.0.1", "::1", "localhost"}):
                raise WorkflowError("WORKFLOW_CALLBACK_URL", "Use the selected HTTPS callback or local receiving address.")
            target = {"url": url, "method": "POST", "headerEnvironment": selection.get("headersEnv", {})}
            envelope, previous = self._attempt(request_id, attempt_id, "CALLBACK", target)
            if previous is not None and previous["status"] in {"ACCEPTED", "DELIVERED"}:
                return self.status(request_id)
            headers = {"Content-Type": "application/json", "Idempotency-Key": envelope["deliveryId"],
                       "X-Workflow-Request-Id": request_id, "X-Workflow-Result-SHA256": envelope["resultSha256"]}
            for name, variable in selection.get("headersEnv", {}).items():
                if (not isinstance(name, str) or not re.fullmatch(r"[A-Za-z0-9-]+", name)
                        or not isinstance(variable, str) or not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", variable)
                        or variable not in os.environ or any(c in os.environ[variable] for c in "\r\n")):
                    raise WorkflowError("WORKFLOW_CALLBACK_CREDENTIAL", "Connect the configured callback environment reference.")
                headers[name] = os.environ[variable]
            with self.db:
                self.db.execute("UPDATE workflow_publications SET status='DISPATCHING' WHERE attempt_id=?", (attempt_id,))
                self._event(request_id, "CALLBACK_DISPATCHED", {"attemptId": attempt_id, "deliveryId": envelope["deliveryId"]})
            response_body = b""
            try:
                opener = build_opener(ProxyHandler({}), NoRedirect())
                req = Request(url, data=canonical(envelope).encode(), headers=headers, method="POST")
                with opener.open(req, timeout=float(selection.get("timeoutSeconds", 60))) as response:
                    status = response.status
                    response_body = response.read(_MAX_JSON + 1)
                if len(response_body) > _MAX_JSON:
                    raise WorkflowError("WORKFLOW_CALLBACK_RESPONSE_SIZE", "The callback response exceeds the configured result format.")
                detail = {"statusCode": status, "bytes": len(response_body),
                          "sha256": hashlib.sha256(response_body).hexdigest()}
                try:
                    received = json.loads(response_body) if response_body else None
                except (ValueError, UnicodeError):
                    received = None
                exact = isinstance(received, dict) and received.get("schema") == RECEIPT_SCHEMA and all(
                    received.get(k) == envelope[k] for k in ("requestId", "correlationId", "deliveryId", "resultSha256"))
                with self.db:
                    self.db.execute(
                        "UPDATE workflow_publications SET status=?,finished_at=?,response_json=? WHERE attempt_id=?",
                        ("DELIVERED" if exact else "ACCEPTED", now(), canonical(detail), attempt_id))
                    self.db.execute(
                        "UPDATE workflow_requests SET status=CASE WHEN status='DELIVERED' THEN status ELSE ? END,"
                        "updated_at=? WHERE request_id=?", ("DELIVERED" if exact else "PUBLISHED", now(), request_id))
                    self._event(request_id, "CALLBACK_RECEIVED" if exact else "CALLBACK_ACCEPTED",
                                {"attemptId": attempt_id, **detail})
                    if exact:
                        self._event(request_id, "CUSTOMER_RECEIVED", received)
                        atomic_json(self._directory(row) / "customer-received.json", received)
            except Exception as error:
                detail = {"code": getattr(error, "code", type(error).__name__),
                          "message": str(error), "responseBytes": len(response_body)}
                with self.db:
                    self.db.execute("UPDATE workflow_publications SET status='RETRYABLE',response_json=? WHERE attempt_id=?",
                                    (canonical(detail), attempt_id))
                    self._event(request_id, "CALLBACK_INTERRUPTED", {"attemptId": attempt_id, **detail})
                raise
        return self.status(request_id)

    def original_file(self, request_id, name):
        row = self._row(request_id)
        if not row["result_json"]:
            raise WorkflowError("WORKFLOW_RESULT_PENDING", "Continue the original operation.")
        result = json.loads(row["result_json"])
        files = result["files"] + [result["archive"]]
        selected = next((f for f in files if f["name"] == name), None)
        if selected is None:
            for event in self.db.execute(
                    "SELECT payload_json FROM workflow_events WHERE request_id=? AND kind='WORKSPACE_EXPORTED' ORDER BY seq DESC",
                    (request_id,)):
                candidate = json.loads(event["payload_json"])
                if candidate.get("name") == name:
                    selected = {**candidate, "contentType": "application/zip"}
                    break
        if selected is None:
            raise WorkflowError("WORKFLOW_FILE_NOT_FOUND", "Select a file from this result.")
        return selected

    def receive_result(self, incoming, *, request_id=None, correlation_id=None,
                       delivery_id=None, expected_result_sha256=None, correlation_mode=None):
        if not isinstance(incoming, dict):
            raise WorkflowError("WORKFLOW_RESULT_MESSAGE", "Supply the complete original result message.")
        is_jms = "data" in incoming and "result" not in incoming
        envelope = incoming.get("data") if is_jms else incoming
        if isinstance(envelope, str):
            envelope = json.loads(envelope)
        if (not isinstance(envelope, dict) or envelope.get("schema") != RESULT_SCHEMA
                or not isinstance(envelope.get("result"), dict)):
            raise WorkflowError("WORKFLOW_RESULT_SCHEMA", "Use the complete original source workflow result.")
        identity(envelope.get("requestId"))
        identity(envelope.get("correlationId"), "correlation ID")
        for field, expected in (("requestId", request_id), ("correlationId", correlation_id),
                                ("deliveryId", delivery_id), ("resultSha256", expected_result_sha256)):
            if expected is not None and envelope.get(field) != expected:
                raise WorkflowError("WORKFLOW_RESULT_SELECTION", "The result differs from the selected " + field + ".")
        result_sha = digest(envelope["result"])
        if envelope.get("resultSha256") != result_sha:
            raise WorkflowError("WORKFLOW_RESULT_HASH", "The complete result differs from its original SHA-256.")
        if (not re.fullmatch(r"[a-f0-9]{32}", envelope.get("runId", ""))
                or digest({"runId": envelope["runId"], "resultSha256": result_sha})[:40] != envelope.get("deliveryId")):
            raise WorkflowError("WORKFLOW_DELIVERY_ID", "The result does not identify its original delivery.")
        if is_jms:
            headers = incoming.get("headers")
            required = {"businessRequestId": envelope["requestId"],
                        "businessCorrelationId": envelope["correlationId"],
                        "deliveryId": envelope["deliveryId"], "resultSha256": result_sha}
            if not isinstance(headers, dict) or any(headers.get(k) != v for k, v in required.items()):
                raise WorkflowError("WORKFLOW_RESULT_PROPERTIES", "The JMS properties differ from the original result.")
            if correlation_mode not in {None, "business-properties", "native-header"}:
                raise WorkflowError("WORKFLOW_CORRELATION_MODE", "Select business-properties or native-header.")
            if correlation_mode == "native-header" and incoming.get("correlationId") != envelope["correlationId"]:
                raise WorkflowError("WORKFLOW_NATIVE_CORRELATION", "The original JMSCorrelationID differs from the result.")
        elif correlation_mode is not None:
            raise WorkflowError("WORKFLOW_JMS_MESSAGE_REQUIRED", "Supply the complete native JMS message for this mode.")
        with self.lock("result:" + envelope["deliveryId"]), self.db:
            existing = self.db.execute("SELECT * FROM workflow_received_results WHERE delivery_id=?",
                                       (envelope["deliveryId"],)).fetchone()
            if existing:
                if existing["result_sha"] != result_sha or existing["envelope_json"] != canonical(envelope):
                    raise WorkflowError("WORKFLOW_RESULT_REDELIVERY_CHANGED", "The existing delivery has different contents.")
                receipt = json.loads(existing["receipt_json"])
            else:
                receipt = {"schema": RECEIPT_SCHEMA,
                           **{k: envelope[k] for k in ("requestId", "correlationId", "deliveryId", "resultSha256")},
                           "receiverId": self.db.execute("SELECT value FROM workflow_meta WHERE key='workspaceId'").fetchone()[0],
                           "receivedAt": now()}
                self.db.execute(
                    "INSERT INTO workflow_received_results(delivery_id,result_sha,envelope_json,receipt_json,"
                    "transport_json,received_at) VALUES(?,?,?,?,?,?)",
                    (envelope["deliveryId"], result_sha, canonical(envelope), canonical(receipt),
                     canonical(incoming), receipt["receivedAt"]))
                directory = self.path / "received-results" / envelope["deliveryId"]
                atomic_json(directory / "result.json", envelope)
                atomic_json(directory / "message.json", incoming)
                atomic_json(directory / "received.json", receipt)
        return {**receipt, "replayed": existing is not None}

    def _received_bindings(self, request_id):
        saved = self.path / "received-bindings.json"
        if not saved.is_file():
            return []
        bindings = read_json(saved)
        if bindings.get("requestId") != request_id:
            return []
        return bindings.get("files", [])

    def _record_export(self, request_id, exported):
        previous = self.db.execute(
            "SELECT payload_json FROM workflow_events WHERE request_id=? AND kind='WORKSPACE_EXPORTED'",
            (request_id,)).fetchall()
        if not any(json.loads(event["payload_json"]).get("path") == exported["path"]
                   and json.loads(event["payload_json"]).get("sha256") == exported["sha256"]
                   for event in previous):
            with self.db:
                self._event(request_id, "WORKSPACE_EXPORTED", exported)

    def export(self, request_id, destination, *, source_archive=None):
        with self.lock(request_id):
            row = self._row(request_id)
            if not row["result_json"]:
                raise WorkflowError("WORKFLOW_RESULT_PENDING", "Finish the native delivery before exporting.")
            config = json.loads(row["configuration_json"])
            bindings = self._received_bindings(request_id)
            installed = [f for f in bindings if f.get("kind") == "installed-source"]
            selected_source = source_archive or (installed[0] if len(installed) == 1 else config.get("sourceArchive"))
            if isinstance(selected_source, str):
                selected_source = {"path": selected_source}
            if not isinstance(selected_source, dict) or not selected_source.get("path"):
                raise WorkflowError("WORKFLOW_SOURCE_ARCHIVE",
                                    "Select the complete original installed product source archive for handover.")
            source = file_descriptor(selected_source["path"],
                                     expected_sha256=selected_source.get("sha256"))
            deployments = [f for f in bindings if f.get("kind") == "kestra-deployment"]
            flow_selection = deployments[0] if len(deployments) == 1 else config.get("flowDelivery")
            if isinstance(flow_selection, str):
                flow_selection = {"path": flow_selection}
            flow_delivery = (file_descriptor(flow_selection["path"],
                                             expected_sha256=flow_selection.get("sha256"))
                             if isinstance(flow_selection, dict) else None)
            result = json.loads(row["result_json"])
            member_names = delivery_members(result)
            package = {"schema": PACKAGE_SCHEMA, "createdAt": now(),
                       "request": json.loads(row["request_json"]), "configuration": config,
                       "requestState": dict(row), "result": result,
                       "publicResult": json.loads(row["public_result_json"]),
                       "events": [dict(e) for e in self.db.execute(
                           "SELECT * FROM workflow_events WHERE request_id=? ORDER BY seq", (request_id,))],
                       "publications": [dict(p) for p in self.db.execute(
                           "SELECT * FROM workflow_publications WHERE request_id=? ORDER BY started_at", (request_id,))],
                       "files": []}
            target = Path(destination).expanduser().absolute()
            target.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
            if target.exists():
                with zipfile.ZipFile(target) as saved:
                    info = saved.getinfo("workflow-package.json")
                    if info.file_size > _MAX_JSON:
                        raise WorkflowError("WORKFLOW_EXPORT_EXISTS", "Choose a new export filename.")
                    prior = json.loads(saved.read(info))
                source_selected = [f for f in prior.get("files", []) if f.get("kind") == "installed-source"]
                selected_flows = [f for f in prior.get("files", []) if f.get("kind") == "kestra-deployment"]
                flows_match = (not selected_flows and flow_delivery is None) or (
                    flow_delivery is not None and len(selected_flows) == 1
                    and selected_flows[0]["sha256"] == flow_delivery["sha256"])
                if (prior.get("schema") == PACKAGE_SCHEMA
                        and prior.get("requestState", {}).get("request_sha") == row["request_sha"]
                        and prior.get("requestState", {}).get("result_sha") == row["result_sha"]
                        and prior.get("requestState", {}).get("configuration_sha") == row["configuration_sha"]
                        and flows_match
                        and len(source_selected) == 1 and source_selected[0]["sha256"] == source["sha256"]):
                    exported = file_descriptor(target)
                    self._record_export(request_id, exported)
                    return {"schema": SCHEMA, "requestId": request_id, "archive": exported,
                            "members": len(prior["files"]) + 1, "deliveryId": row["delivery_id"], "replayed": True}
                raise WorkflowError("WORKFLOW_EXPORT_EXISTS", "Choose a new filename for the changed handover.")
            fd, temporary = tempfile.mkstemp(prefix=".workflow-export-", dir=target.parent)
            os.close(fd)
            try:
                with zipfile.ZipFile(temporary, "w", compression=zipfile.ZIP_DEFLATED, allowZip64=True) as archive:
                    for descriptor in result["files"] + [result["archive"]]:
                        verified = file_descriptor(descriptor["path"], name=descriptor["name"],
                                                   expected_sha256=descriptor["sha256"],
                                                   expected_bytes=descriptor["bytes"])
                        member = member_names[verified["name"]]
                        archive.write(verified["path"], member)
                        package["files"].append({**verified, "member": member, "kind": "native-delivery"})
                    member = "application/" + source["name"]
                    archive.write(source["path"], member)
                    package["files"].append({**source, "member": member, "kind": "installed-source"})
                    if flow_delivery is not None:
                        member = "deployment/flow-delivery.json"
                        archive.write(flow_delivery["path"], member)
                        package["files"].append({**flow_delivery, "member": member, "kind": "kestra-deployment"})
                    here = Path(__file__).resolve().parent
                    for file in sorted(f for f in here.glob("workflow_*") if f.is_file() and f.suffix in {".py", ".html", ".mjs", ".css"}):
                        member = "workflow/" + file.name
                        archive.write(file, member)
                        package["files"].append({**file_descriptor(file), "member": member, "kind": "workflow-source"})
                    for file in sorted([*here.glob("WORKFLOW*.md"), *here.glob("WORKFLOW*.json")]):
                        member = "workflow/" + file.name
                        archive.write(file, member)
                        package["files"].append({**file_descriptor(file), "member": member, "kind": "workflow-guide"})
                    for file in (sorted((here / "kestra").rglob("*")) if (here / "kestra").is_dir() else []):
                        if (file.is_file() and not file.is_symlink()
                                and not any(part in {"target", "build", "__pycache__", "node_modules", ".git"} for part in file.parts)):
                            member = "workflow/kestra/" + file.relative_to(here / "kestra").as_posix()
                            archive.write(file, member)
                            package["files"].append({**file_descriptor(file), "member": member, "kind": "kestra-source"})
                    intake = self._directory(row) / "intake"
                    original_inputs = {f["name"]: file_descriptor(
                        f["path"], name=f["name"], expected_sha256=f["sha256"], expected_bytes=f["bytes"])
                        for f in bindings if f.get("kind") == "original-request"}
                    for file in sorted(intake.glob("*.json")):
                        descriptor = file_descriptor(file)
                        prior_input = original_inputs.get(descriptor["name"])
                        if prior_input and prior_input["sha256"] != descriptor["sha256"]:
                            raise WorkflowError("WORKFLOW_INTAKE_CHANGED", "The original intake file has changed.")
                        original_inputs[descriptor["name"]] = descriptor
                    for descriptor in original_inputs.values():
                        member = "intake/" + descriptor["name"]
                        archive.write(descriptor["path"], member)
                        package["files"].append({**descriptor, "member": member, "kind": "original-request"})
                    archive.writestr("workflow-package.json", canonical(package).encode() + b"\n")
                with open(temporary, "rb") as stream:
                    os.fsync(stream.fileno())
                os.link(temporary, target)
            finally:
                Path(temporary).unlink(missing_ok=True)
            exported = file_descriptor(target)
            self._record_export(request_id, exported)
            return {"schema": SCHEMA, "requestId": request_id, "archive": exported,
                    "members": len(package["files"]) + 1, "deliveryId": row["delivery_id"]}

    @classmethod
    def receive(cls, archive_path, destination, *, expected_sha256, analysis_destination=None):
        original = file_descriptor(archive_path, expected_sha256=expected_sha256)
        target = Path(destination).expanduser().absolute()
        if target.resolve() != target:
            raise WorkflowError("WORKFLOW_RECEIVE_DIRECTORY", "Use a canonical receiving directory.")
        marker = target / "received-workflow.json"
        if marker.is_file() and read_json(marker).get("archiveSha256") == original["sha256"]:
            return cls._continue_received(target, analysis_destination)
        if target.exists() and (not target.is_dir() or any(target.iterdir())):
            raise WorkflowError("WORKFLOW_RECEIVE_EXISTS", "Choose an empty receiving directory for this delivery.")
        target.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        staging = target.parent / (".workflow-receive-" + original["sha256"][:20] + "-" + digest(str(target))[:12])
        staging.mkdir(mode=0o700, exist_ok=True)
        if staging.resolve() != staging:
            raise WorkflowError("WORKFLOW_RECEIVE_STAGING", "The original receiving directory has changed.")
        control = {"archiveSha256": original["sha256"], "destination": str(target)}
        if (staging / "receiving.json").exists() and read_json(staging / "receiving.json") != control:
            raise WorkflowError("WORKFLOW_RECEIVE_STAGING", "Resume the existing receiving operation at its original target.")
        atomic_json(staging / "receiving.json", control)
        with (staging / ".receive.lock").open("a+b") as lock:
            try:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                raise WorkflowError("WORKFLOW_RECEIVE_RUNNING", "The complete original handover is already being received.") from None
            with zipfile.ZipFile(original["path"]) as archive:
                names = archive.namelist()
                if len(names) != len(set(names)):
                    raise WorkflowError("WORKFLOW_ARCHIVE_DUPLICATE", "The delivery archive repeats member names.")
                manifest_info = archive.getinfo("workflow-package.json")
                if manifest_info.file_size > _MAX_JSON:
                    raise WorkflowError("WORKFLOW_ARCHIVE_MANIFEST", "The original package manifest is too large.")
                package = json.loads(archive.read(manifest_info))
                if package.get("schema") != PACKAGE_SCHEMA or not isinstance(package.get("files"), list):
                    raise WorkflowError("WORKFLOW_ARCHIVE_SCHEMA", "Select a complete source workflow handover.")
                members = [f["member"] for f in package["files"]]
                if len(members) != len(set(members)) or set(names) != {"workflow-package.json", *members}:
                    raise WorkflowError("WORKFLOW_ARCHIVE_MEMBERS", "The archive differs from its complete file selection.")
                mapped = {}
                for item in package["files"]:
                    member = item["member"]
                    relative = Path(member)
                    if (relative.is_absolute() or ".." in relative.parts or "\\" in member
                            or not relative.parts or relative.parts[0] not in {"delivery", "application", "workflow", "intake", "deployment"}):
                        raise WorkflowError("WORKFLOW_ARCHIVE_PATH", "The selected archive has an invalid member path.")
                    info = archive.getinfo(member)
                    if (type(item["bytes"]) is not int or item["bytes"] < 0
                            or info.file_size != item["bytes"] or not _HASH.fullmatch(item["sha256"])):
                        raise WorkflowError("WORKFLOW_ARCHIVE_FILE", "The selected archive member differs from its original.")
                    output = staging / "received" / relative
                    output.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
                    if output.exists():
                        file_descriptor(output, expected_sha256=item["sha256"], expected_bytes=item["bytes"])
                    else:
                        fd, temporary = tempfile.mkstemp(prefix=".receive-file-", dir=output.parent)
                        try:
                            hasher, total = hashlib.sha256(), 0
                            with archive.open(info) as source, os.fdopen(fd, "wb") as sink:
                                while block := source.read(1024 * 1024):
                                    total += len(block)
                                    if total > item["bytes"]:
                                        raise WorkflowError("WORKFLOW_ARCHIVE_LENGTH", "The file exceeds its declared size.")
                                    sink.write(block)
                                    hasher.update(block)
                                sink.flush()
                                os.fsync(sink.fileno())
                            if total != item["bytes"] or hasher.hexdigest() != item["sha256"]:
                                raise WorkflowError("WORKFLOW_ARCHIVE_HASH", "Receive the complete unchanged original file.")
                            os.replace(temporary, output)
                        finally:
                            Path(temporary).unlink(missing_ok=True)
                    mapped[item["path"]] = str(target / "received" / relative)
            row = package["requestState"]
            if (row["request_id"] != package["request"]["requestId"]
                    or digest(package["request"]) != row["request_sha"]
                    or canonical(package["request"]) != row["request_json"]
                    or digest(package["configuration"]) != row["configuration_sha"]
                    or canonical(package["configuration"]) != row["configuration_json"]
                    or digest(package["publicResult"]) != row["result_sha"]
                    or canonical(package["publicResult"]) != row["public_result_json"]):
                raise WorkflowError("WORKFLOW_ARCHIVE_IDENTITY", "The request, plan and result differ from their originals.")
            result = json.loads(canonical(package["result"]))
            selected_members = delivery_members(result)
            declared_delivery = {item["name"]: item["member"] for item in package["files"]
                                 if item.get("kind") == "native-delivery"}
            if declared_delivery != selected_members:
                raise WorkflowError("WORKFLOW_ARCHIVE_DELIVERY", "The complete native and supplier delivery layout has changed.")
            for file in result["files"] + [result["archive"]]:
                file["path"] = mapped[file["path"]]
            row["result_json"] = canonical(result)
            with cls(staging) as restored:
                columns = [r["name"] for r in restored.db.execute("PRAGMA table_info(workflow_requests)")]
                existing = restored.db.execute("SELECT * FROM workflow_requests WHERE request_id=?",
                                               (row["request_id"],)).fetchone()
                if existing and (existing["request_sha"] != row["request_sha"] or existing["result_sha"] != row["result_sha"]):
                    raise WorkflowError("WORKFLOW_RECEIVE_STATE", "The partial receiving belongs to a different original.")
                if existing is None:
                    with restored.db:
                        restored.db.execute(
                            "INSERT INTO workflow_requests(" + ",".join(columns) + ") VALUES(" + ",".join("?" for _ in columns) + ")",
                            [row[c] for c in columns])
                        for event in package["events"]:
                            if event["request_id"] != row["request_id"]:
                                raise WorkflowError("WORKFLOW_ARCHIVE_HISTORY", "The saved history belongs to another request.")
                            restored.db.execute(
                                "INSERT INTO workflow_events(request_id,kind,payload_json,created_at) VALUES(?,?,?,?)",
                                [event[c] for c in ("request_id", "kind", "payload_json", "created_at")])
                        for publication in package["publications"]:
                            if publication["request_id"] != row["request_id"]:
                                raise WorkflowError("WORKFLOW_ARCHIVE_HISTORY", "The saved publication belongs to another request.")
                            fields = [r["name"] for r in restored.db.execute("PRAGMA table_info(workflow_publications)")]
                            restored.db.execute(
                                "INSERT INTO workflow_publications(" + ",".join(fields) + ") VALUES(" + ",".join("?" for _ in fields) + ")",
                                [publication[c] for c in fields])
                        restored._event(row["request_id"], "WORKSPACE_RECEIVED", {"archiveSha256": original["sha256"]})
                restored.db.execute("PRAGMA wal_checkpoint(TRUNCATE)")
            atomic_json(staging / "received-bindings.json", {
                "requestId": row["request_id"], "archiveSha256": original["sha256"],
                "files": [{**item, "path": str(target / "received" / item["member"])}
                          for item in package["files"]]})
            atomic_json(staging / "received-workflow.json",
                        {"archiveSha256": original["sha256"], "requestId": row["request_id"],
                         "deliveryId": row["delivery_id"], "receivedAt": now()})
            os.rename(staging, target)
            parent_fd = os.open(target.parent, os.O_RDONLY | os.O_DIRECTORY)
            try:
                os.fsync(parent_fd)
            finally:
                os.close(parent_fd)
        return cls._continue_received(target, analysis_destination)

    @classmethod
    def _continue_received(cls, target, analysis_destination):
        marker = read_json(Path(target) / "received-workflow.json")
        with cls(target) as restored:
            request_id = marker["requestId"]
            if analysis_destination:
                from workflow_analysis import NativeWorkflowAdapter
                row = restored._row(request_id)
                result = json.loads(row["result_json"])
                receiving_id = digest({"archive": result["archive"]["sha256"],
                                       "destination": str(Path(analysis_destination).absolute())})[:32]
                directory = Path(target) / "native-receiving"
                directory.mkdir(mode=0o700, parents=True, exist_ok=True)
                adapter = NativeWorkflowAdapter(json.loads(row["configuration_json"]),
                                                workspace=directory, progress=lambda value: None)
                returned = adapter.receive(result["archive"]["path"], result["archive"]["sha256"],
                                           analysis_destination, receiving_id)
                with restored.db:
                    prior = restored.db.execute(
                        "SELECT payload_json FROM workflow_events WHERE request_id=? AND kind='ANALYSIS_RECEIVED'",
                        (request_id,)).fetchall()
                    if not any(json.loads(p["payload_json"]).get("receivingId") == receiving_id for p in prior):
                        restored._event(request_id, "ANALYSIS_RECEIVED",
                                        {"receivingId": receiving_id, "result": returned})
            return restored.status(request_id, history=True)
