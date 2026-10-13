"""Private Datasette operator on the original AnalysisWorkspace HTTP server.

The original server, SQLite writer, source importer, reports, workbooks and
workspace archives remain the operating engines. This extension adds source
selection and a resumable HTTP interface to the Datasette Analysis composer.
"""
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import tempfile
import threading
from urllib.parse import parse_qs, quote, unquote, urlsplit

from stellar_forge_buyer.analysis_workspace import serve as serve_analysis
from stellar_forge_buyer.storage import dump, private_directory
from model import DatasetteAnalysis

SCHEMA = "stellar-forge.datasette-operator.v1"
_REQUEST = re.compile(r"[a-f0-9]{32}")
_HASH = re.compile(r"[a-f0-9]{64}")
_MAX_JSON = 1024 * 1024
_MAX_HANDOVER = 32 * 1024 * 1024
_ACTIONS = {"prepare", "compare", "export", "nld.prepare", "nld.execute",
            "nld.report", "nld.pack", "nld.restore", "bdnb.import", "bdnb.select",
            "bdnb.compare", "bdnb.review", "bdnb.publish", "bdnb.pack"}
_TABLE = "sf_datasette_operator_requests"


def encoded(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True,
                      separators=(",", ":"), allow_nan=False).encode()


def now():
    return datetime.now(timezone.utc).isoformat()


class OperatorError(ValueError):
    def __init__(self, code, message, status=400):
        self.code, self.message, self.status = code, message, status
        super().__init__(message)


def need(condition, code, message, status=400):
    if not condition:
        raise OperatorError(code, message, status)


def identifier(value):
    need(isinstance(value, str) and _REQUEST.fullmatch(value),
         "DATASETTE_REQUEST_ID_REQUIRED",
         "Use the original 32-character lowercase hexadecimal request ID.")
    return value


def error_record(error):
    return {"code": str(getattr(error, "code", None) or type(error).__name__),
            "message": str(error)}


def public_request(row):
    if row is None:
        return None
    value = dict(row)
    for source, target in (("request_json", "body"), ("result_json", "result"),
                           ("error_json", "error"), ("progress_json", "progress")):
        value[target] = json.loads(value.pop(source)) if value.get(source) else None
    return value


class DatasetteOperator:
    """One domain action at a time, using the already-owned Analysis workspace."""

    def __init__(self, analysis, *, operation_id, model_factory=DatasetteAnalysis):
        self.analysis = analysis
        self.operation_id = identifier(operation_id)
        self._lock = threading.RLock()
        self._active = None
        self._closed = False
        self._executor = ThreadPoolExecutor(max_workers=1,
                                             thread_name_prefix="datasette-operator")
        self.model = model_factory(analysis, operation_id=operation_id,
                                   progress=self._progress)
        with analysis.database._connection() as db:
            db.execute("""CREATE TABLE IF NOT EXISTS sf_datasette_operator_requests(
                id TEXT PRIMARY KEY, operation_id TEXT NOT NULL,
                action TEXT NOT NULL, request_sha256 TEXT NOT NULL,
                request_json TEXT NOT NULL, status TEXT NOT NULL,
                created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
                attempt INTEGER NOT NULL, result_json TEXT, error_json TEXT,
                progress_json TEXT NOT NULL)""")
            db.execute("""UPDATE sf_datasette_operator_requests
                          SET status='INTERRUPTED', updated_at=?,
                              error_json=?
                          WHERE operation_id=? AND status='RUNNING'""",
                       (now(), encoded({"code": "OPERATOR_PROCESS_INTERRUPTED",
                                        "message": "Reopen and continue the original request."}).decode(),
                        self.operation_id))
            db.commit()

    def request(self, request_id):
        identifier(request_id)
        with self.analysis.database._connection() as db:
            row = db.execute("""SELECT * FROM sf_datasette_operator_requests
                                WHERE id=? AND operation_id=?""",
                             (request_id, self.operation_id)).fetchone()
        need(row is not None, "DATASETTE_REQUEST_NOT_FOUND",
             "This operator has no request with that ID.", 404)
        return public_request(row)

    def requests(self, limit=50):
        need(type(limit) is int and 1 <= limit <= 100,
             "DATASETTE_REQUEST_LIMIT_INVALID", "Choose between 1 and 100 requests.")
        with self.analysis.database._connection() as db:
            rows = db.execute("""SELECT * FROM sf_datasette_operator_requests
                                 WHERE operation_id=? ORDER BY updated_at DESC LIMIT ?""",
                              (self.operation_id, limit)).fetchall()
        return [public_request(row) for row in rows]

    def status(self):
        state = self.model.dispatch("status", {})
        return {"schema": SCHEMA, "operation_id": self.operation_id,
                "workspace_id": self.analysis.identity,
                "workspace": str(self.analysis.database.directory),
                "analysis_path": "/", "operator_path": "/datasette",
                "state": state, "requests": self.requests()}

    def _progress(self, event):
        if not isinstance(event, dict):
            event = {"message": str(event)}
        with self._lock:
            selected = self._active
            if selected is None:
                return
            current = self.request(selected)
            progress = [*(current.get("progress") or []),
                        {"time": now(), **event}][-100:]
            with self.analysis.database._connection() as db:
                db.execute("""UPDATE sf_datasette_operator_requests
                              SET progress_json=?, updated_at=?
                              WHERE id=? AND operation_id=?""",
                           (encoded(progress).decode(), now(), selected, self.operation_id))
                db.commit()

    def submit(self, action, body, *, request_id):
        identifier(request_id)
        need(action in _ACTIONS, "DATASETTE_ACTION_INVALID",
             "Choose a supported original Datasette or NLD action.")
        need(isinstance(body, dict), "DATASETTE_REQUEST_BODY_REQUIRED",
             "Supply the original JSON action body.")
        raw = encoded({"action": action, "body": body})
        need(len(raw) <= _MAX_JSON, "DATASETTE_REQUEST_TOO_LARGE",
             "Use a retained handover file for a large source selection.", 413)
        fingerprint = hashlib.sha256(raw).hexdigest()
        with self._lock:
            need(not self._closed, "DATASETTE_OPERATOR_CLOSING",
                 "The operator is closing; reopen the same workspace.", 409)
            with self.analysis.database._connection() as db:
                row = db.execute("SELECT * FROM sf_datasette_operator_requests WHERE id=?",
                                 (request_id,)).fetchone()
            if row:
                need(row["operation_id"] == self.operation_id
                     and row["request_sha256"] == fingerprint,
                     "DATASETTE_REQUEST_CHANGED",
                     "This request ID belongs to a different action or source selection.", 409)
                return public_request(row), True
            need(self._active is None, "DATASETTE_OPERATOR_BUSY",
                 "Wait for the current Datasette action to finish.", 409)
            stamp = now()
            with self.analysis.database._connection() as db:
                db.execute("""INSERT INTO sf_datasette_operator_requests
                    (id, operation_id, action, request_sha256, request_json, status,
                     created_at, updated_at, attempt, progress_json)
                    VALUES(?,?,?,?,?,'RUNNING',?,?,1,'[]')""",
                           (request_id, self.operation_id, action, fingerprint,
                            encoded(body).decode(), stamp, stamp))
                db.commit()
            self._active = request_id
            self._executor.submit(self._execute, request_id, action, dict(body))
            return self.request(request_id), False

    def resume(self, request_id):
        with self._lock:
            current = self.request(request_id)
            if current["status"] in {"RUNNING", "COMPLETE"}:
                return current, True
            need(not self._closed and self._active is None,
                 "DATASETTE_OPERATOR_BUSY", "Wait for the current action to finish.", 409)
            need(current["status"] in {"FAILED", "INTERRUPTED"},
                 "DATASETTE_REQUEST_NOT_RESUMABLE",
                 "Continue an interrupted original request.", 409)
            body = dict(current["body"])
            body["resume"] = True
            with self.analysis.database._connection() as db:
                db.execute("""UPDATE sf_datasette_operator_requests
                              SET status='RUNNING', updated_at=?, attempt=attempt+1,
                                  error_json=NULL
                              WHERE id=? AND operation_id=?""",
                           (now(), request_id, self.operation_id))
                db.commit()
            self._active = request_id
            self._executor.submit(self._execute, request_id, current["action"], body)
            return self.request(request_id), False

    def _execute(self, request_id, action, body):
        try:
            if action in {"export", "nld.pack"}:
                need(body.get("export_id", request_id) == request_id,
                     "DATASETTE_EXPORT_REQUEST_CHANGED", "The export ID must match its original request.")
                body = {**body, "export_id": request_id}
            if action == "bdnb.pack":
                need(body.get("pack_id", request_id) == request_id,
                     "BDNB_PACK_REQUEST_CHANGED", "The pack ID must match its original request.")
                body = {**body, "pack_id": request_id}
            result = self.model.dispatch(action, body)
            raw = encoded(result).decode()
            with self.analysis.database._connection() as db:
                db.execute("""UPDATE sf_datasette_operator_requests
                              SET status='COMPLETE', updated_at=?, result_json=?,
                                  error_json=NULL
                              WHERE id=? AND operation_id=?""",
                           (now(), raw, request_id, self.operation_id))
                db.commit()
        except BaseException as error:
            status = "INTERRUPTED" if isinstance(error, (KeyboardInterrupt, SystemExit)) else "FAILED"
            with self.analysis.database._connection() as db:
                db.execute("""UPDATE sf_datasette_operator_requests
                              SET status=?, updated_at=?, error_json=?
                              WHERE id=? AND operation_id=?""",
                           (status, now(), encoded(error_record(error)).decode(),
                            request_id, self.operation_id))
                db.commit()
        finally:
            with self._lock:
                self._active = None

    def close(self):
        with self._lock:
            self._closed = True
        self._executor.shutdown(wait=True)


def create_operator(analysis, *, operation_id, port=0, model_factory=DatasetteAnalysis):
    """Extend the original server and capability without another database owner.

    Return (server, control_file, operator_url, controller). Call controller.close()
    before closing the externally owned AnalysisWorkspace.
    """
    controller = DatasetteOperator(analysis, operation_id=operation_id,
                                   model_factory=model_factory)
    try:
        server, analysis_control, analysis_url = serve_analysis(analysis, port=port)
        token = urlsplit(analysis_url).fragment
        original_handler = server.RequestHandlerClass
        here = Path(__file__).resolve().parent
        assets = {
            "/datasette": ((here / "operator.html").read_bytes(), "text/html;charset=utf-8"),
            "/datasette/": ((here / "operator.html").read_bytes(), "text/html;charset=utf-8"),
            "/datasette/operator.mjs": ((here / "operator.mjs").read_bytes(), "text/javascript;charset=utf-8"),
            "/datasette/operator.css": ((here / "operator.css").read_bytes(), "text/css;charset=utf-8"),
            "/datasette/nld_operator.mjs": ((here / "nld_operator.mjs").read_bytes(), "text/javascript;charset=utf-8"),
            "/datasette/bdnb_operator.mjs": ((here / "bdnb_operator.mjs").read_bytes(), "text/javascript;charset=utf-8"),
        }
        intake = private_directory(
            analysis.database.directory / "datasette-operator-intake" / operation_id,
            create=True)

        class Handler(original_handler):
            def _length(self, maximum):
                values = self.headers.get_all("Content-Length") or []
                need(len(values) == 1 and re.fullmatch(r"[0-9]+", values[0]) is not None
                     and not self.headers.get("Transfer-Encoding"),
                     "DATASETTE_CONTENT_LENGTH_REQUIRED",
                     "Send one complete request with its byte length.", 411)
                length = int(values[0])
                need(0 <= length <= maximum, "DATASETTE_REQUEST_TOO_LARGE",
                     "The selected request exceeds the supported byte size.", 413)
                return length

            def _body(self):
                length = self._length(_MAX_JSON)
                need(self.headers.get("Content-Type", "").split(";", 1)[0] == "application/json",
                     "DATASETTE_JSON_REQUIRED", "Send a JSON action body.", 415)
                raw = self.rfile.read(length)
                need(len(raw) == length, "DATASETTE_REQUEST_INCOMPLETE",
                     "The request ended before all selected bytes arrived.")
                value = json.loads(raw, parse_constant=lambda value:
                                   (_ for _ in ()).throw(ValueError("Non-finite JSON number")))
                need(isinstance(value, dict), "DATASETTE_JSON_OBJECT_REQUIRED",
                     "Send a JSON object.")
                return value

            def _intake(self):
                length = self._length(_MAX_HANDOVER)
                filename = unquote(self.headers.get("X-Datasette-Filename", "handover.json"))
                need(filename.endswith(".json") and len(filename) <= 255
                     and "/" not in filename and "\\" not in filename
                     and not any(ord(c) < 32 for c in filename),
                     "DATASETTE_HANDOVER_FILENAME_INVALID",
                     "Select a JSON handover filename.")
                fd, temporary = tempfile.mkstemp(prefix=".intake-", dir=intake)
                try:
                    hasher, remaining = hashlib.sha256(), length
                    with os.fdopen(fd, "wb") as output:
                        while remaining:
                            chunk = self.rfile.read(min(1024 * 1024, remaining))
                            need(bool(chunk), "DATASETTE_HANDOVER_INCOMPLETE",
                                 "The source handover upload ended early.")
                            output.write(chunk)
                            hasher.update(chunk)
                            remaining -= len(chunk)
                        output.flush()
                        os.fsync(output.fileno())
                    body = Path(temporary).read_bytes()
                    descriptor = json.loads(body, parse_constant=lambda value:
                                            (_ for _ in ()).throw(ValueError("Non-finite JSON number")))
                    need(isinstance(descriptor, dict)
                         and descriptor.get("schema") == "stellar-forge.datasette-analysis-handover.v1",
                         "DATASETTE_HANDOVER_SCHEMA_REQUIRED",
                         "Choose the original Datasette Analysis handover.")
                    delivery = descriptor.get("delivery")
                    need(isinstance(delivery, dict), "DATASETTE_HANDOVER_DELIVERY_REQUIRED",
                         "Choose the original source handover with its delivery selection.")
                    for key in ("manifest", "room", "session", "edition"):
                        if delivery.get(key) is not None:
                            need(isinstance(delivery[key], str) and Path(delivery[key]).is_absolute(),
                                 "DATASETTE_HANDOVER_ORIGINAL_PATH_REQUIRED",
                                 "Enter the existing handover path to preserve its adjacent source files, "
                                 "or upload a handover with absolute host paths.")
                    digest = hasher.hexdigest()
                    destination = intake / (digest + ".json")
                    try:
                        os.link(temporary, destination, follow_symlinks=False)
                    except FileExistsError:
                        saved = destination.read_bytes()
                        need(saved == body, "DATASETTE_HANDOVER_CHANGED",
                             "The retained handover no longer matches this upload.", 409)
                    directory_fd = os.open(intake, os.O_RDONLY | os.O_DIRECTORY)
                    try:
                        os.fsync(directory_fd)
                    finally:
                        os.close(directory_fd)
                    return self._reply(201, {"schema": SCHEMA, "handover": str(destination),
                                             "filename": filename, "bytes": length, "sha256": digest})
                finally:
                    Path(temporary).unlink(missing_ok=True)

            def _download(self, name, edition_id, export_id):
                with controller.model.open_download(name, edition_id=edition_id, export_id=export_id) as (stream, record):
                    count, digest = record.get("bytes"), record.get("sha256")
                    need(type(count) is int and count >= 0 and isinstance(digest, str)
                         and _HASH.fullmatch(digest),
                         "DATASETTE_DOWNLOAD_RECORD_INVALID",
                         "The original delivery has no complete file identity.", 409)
                    filename = str(record.get("filename") or name)
                    need(filename and "/" not in filename and "\\" not in filename
                         and not any(ord(c) < 32 for c in filename),
                         "DATASETTE_DOWNLOAD_FILENAME_INVALID",
                         "The original delivery filename is invalid.", 409)
                    content_type = record.get("content_type") or record.get("mime") or "application/octet-stream"
                    need(isinstance(content_type, str) and "\r" not in content_type and "\n" not in content_type,
                         "DATASETTE_DOWNLOAD_TYPE_INVALID", "The original delivery content type is invalid.", 409)
                    self.send_response(200)
                    self.send_header("Content-Type", content_type)
                    self.send_header("Content-Length", str(count))
                    self.send_header("X-Content-SHA256", digest)
                    self.send_header("Content-Disposition", "attachment; filename*=UTF-8''" + quote(filename))
                    self._headers()
                    self.end_headers()
                    if self.command != "HEAD":
                        remaining = count
                        while remaining:
                            chunk = stream.read(min(1024 * 1024, remaining))
                            if not chunk:
                                self.close_connection = True
                                raise OSError("The original retained file ended before its declared byte length.")
                            self.wfile.write(chunk)
                            remaining -= len(chunk)

            def _dispatch(self):
                url = urlsplit(self.path)
                owned = url.path in assets or url.path.startswith("/api/datasette/")
                if not owned:
                    return super()._dispatch()
                try:
                    origin = f"http://127.0.0.1:{self.server.server_port}"
                    need(self.headers.get("Host") == origin[7:]
                         and self.headers.get("Origin", origin) == origin
                         and self.headers.get("Sec-Fetch-Site", "none") in {"none", "same-origin"},
                         "ANALYSIS_LOCAL_ORIGIN_REQUIRED", "Open the original local operator URL.", 403)
                    need(not url.scheme and not url.netloc and not url.fragment,
                         "ANALYSIS_ROUTE_INVALID", "Use an original operator route.")
                    if self.command in {"GET", "HEAD"} and url.path in assets and not url.query:
                        body, mime = assets[url.path]
                        return self._reply(200, body, mime)
                    need(secrets.compare_digest(self.headers.get("X-Analysis-Capability", ""), token),
                         "ANALYSIS_CAPABILITY_REQUIRED", "Open the complete private operator URL.", 403)
                    query = parse_qs(url.query, strict_parsing=True)
                    need(all(len(v) == 1 for v in query.values()),
                         "DATASETTE_QUERY_INVALID", "Select each query parameter once.")
                    values = {key: value[0] for key, value in query.items()}
                    parts = url.path.strip("/").split("/")
                    if self.command in {"GET", "HEAD"} and url.path == "/api/datasette/status" and not query:
                        return self._reply(200, controller.status())
                    if self.command in {"GET", "HEAD"} and url.path == "/api/datasette/nld/status":
                        need(not (set(values) - {"project_id"}), "NLD_STATUS_SELECTION", "Select one retained project.")
                        # Read-only: never replace the active native writer's record.
                        from nld_adapter import DatasetteNld
                        return self._reply(200, DatasetteNld(controller.model).status(**values))
                    if self.command in {"GET", "HEAD"} and url.path == "/api/datasette/nld/rows":
                        need("project_id" in values and not (set(values) -
                             {"project_id", "definition_id", "run_id", "kind", "offset", "limit"}),
                             "NLD_ROW_SELECTION", "Select one original project and row page.")
                        from nld_adapter import DatasetteNld
                        body = {**values, "offset": int(values.get("offset", "0")),
                                "limit": int(values.get("limit", "100"))}
                        return self._reply(200, DatasetteNld(controller.model).rows(**body))
                    if self.command in {"GET", "HEAD"} and url.path == "/api/datasette/rows":
                        need(not (set(values) - {"edition_id", "offset", "limit"}),
                             "DATASETTE_ROW_SELECTION_INVALID", "Select an edition, offset and page size.")
                        body = {"offset": int(values.get("offset", "0")),
                                "limit": int(values.get("limit", "100"))}
                        if values.get("edition_id"):
                            body["edition_id"] = values["edition_id"]
                        return self._reply(200, controller.model.dispatch("rows", body))
                    if self.command in {"GET", "HEAD"} and len(parts) == 4 and parts[:3] == ["api", "datasette", "requests"] and not query:
                        return self._reply(200, controller.request(parts[3]))
                    if self.command in {"GET", "HEAD"} and url.path == "/api/datasette/download":
                        need("name" in values and not (set(values) - {"name", "edition_id", "export_id"}),
                             "DATASETTE_DOWNLOAD_SELECTION_REQUIRED",
                             "Select one retained delivery filename and its edition.")
                        return self._download(values["name"], values.get("edition_id"), values.get("export_id"))
                    if self.command == "POST" and url.path == "/api/datasette/bdnb/read" and not query:
                        body = self._body()
                        need(set(body) == {"action", "body"} and isinstance(body["body"], dict)
                             and body["action"] in {"bdnb.schema", "bdnb.status", "bdnb.get", "bdnb.rows"},
                             "BDNB_READ_SELECTION", "Select a supported BDNB reader and its original input.")
                        return self._reply(200, controller.model.dispatch(body["action"], body["body"]))
                    if self.command == "POST" and url.path == "/api/datasette/intake" and not query:
                        return self._intake()
                    if self.command == "POST" and url.path == "/api/datasette/requests" and not query:
                        body = self._body()
                        need(set(body) == {"request_id", "action", "body"},
                             "DATASETTE_REQUEST_FIELDS_INVALID",
                             "Supply request_id, action and the original action body.")
                        request, reused = controller.submit(body["action"], body["body"], request_id=body["request_id"])
                        return self._reply(200 if reused else 202, {"request": request, "reused": reused})
                    if self.command == "POST" and len(parts) == 5 and parts[:3] == ["api", "datasette", "requests"] and parts[4] == "resume" and not query:
                        need(self._body() == {}, "DATASETTE_RESUME_BODY_INVALID",
                             "Resume the retained request without replacing its inputs.")
                        request, reused = controller.resume(parts[3])
                        return self._reply(200 if reused else 202, {"request": request, "reused": reused})
                    return self._reply(404, {"error": "DATASETTE_ROUTE_NOT_FOUND"})
                except OperatorError as error:
                    return self._reply(error.status, {"error": error.code, "message": error.message})
                except (ValueError, KeyError, TypeError, OSError) as error:
                    return self._reply(400, {"error": str(getattr(error, "code", None)
                                                       or "DATASETTE_REQUEST_FAILED"),
                                             "message": str(error)})

        server.RequestHandlerClass = Handler
        url = analysis_url.replace("/#", "/datasette#")
        control = analysis.database.directory / "datasette-operator-launch.json"
        dump(control, {"schema": SCHEMA, "operation_id": operation_id,
                       "workspace_id": analysis.identity, "pid": os.getpid(),
                       "url": url, "analysis_url": analysis_url})
        server.datasette_analysis_control = analysis_control
        return server, control, url, controller
    except BaseException:
        controller.close()
        if "server" in locals():
            server.server_close()
        raise
