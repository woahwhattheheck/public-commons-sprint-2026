"""Private localhost HTTP operator for an original DuckDBWorkspace."""
from __future__ import annotations

from contextlib import contextmanager
from datetime import datetime, timezone
import fcntl
import hashlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import mimetypes
import os
from pathlib import Path, PurePosixPath
import re
import secrets
import stat
import threading
from urllib.parse import parse_qs, unquote, urlsplit

from . import _duckdb_ui
from ._analysis_export_http import send_export
from .errors import BuyerError, StateError
from .storage import dump, parse, private_directory, read

_MAX_BODY = 1024 * 1024
_MAX_RECORD = 16 * 1024 * 1024
_ID = re.compile(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,159}")
_MIMES = {
    ".parquet": "application/vnd.apache.parquet",
    ".csv": "text/csv;charset=utf-8",
    ".json": "application/json",
    ".duckdb": "application/octet-stream",
    ".zip": "application/zip",
}


def _json(value):
    return json.dumps(value, ensure_ascii=False, allow_nan=False, separators=(",", ":"))


def _rows(value, key):
    if isinstance(value, dict):
        return value.get(key, [])
    return value if isinstance(value, list) else []


def _identifier(value):
    if not isinstance(value, str) or not _ID.fullmatch(value):
        raise StateError("DUCKDB_OPERATOR_ID_INVALID")
    return value


def _fields(value, required=(), optional=()):
    if not isinstance(value, dict) or set(value) - set(required) - set(optional):
        raise StateError("DUCKDB_OPERATOR_FIELDS_INVALID")
    if any(name not in value for name in required):
        raise StateError("DUCKDB_OPERATOR_FIELDS_REQUIRED")
    return value


def _integer(value, name, minimum=0, maximum=1_000_000_000):
    if type(value) is not int or not minimum <= value <= maximum:
        raise StateError("DUCKDB_OPERATOR_" + name.upper() + "_INVALID")
    return value


def _file_entries(record):
    files = record.get("files", [])
    if isinstance(files, dict):
        files = [dict(value, name=key) if isinstance(value, dict) else {"name": key, "path": value}
                 for key, value in files.items()]
    directory = Path(record["directory"]).expanduser().resolve()
    selected, names = [], set()
    for source in files:
        if not isinstance(source, dict):
            raise StateError("DUCKDB_OPERATOR_DOWNLOAD_MANIFEST_INVALID")
        item = dict(source)
        path = Path(str(item.get("path") or item.get("name") or ""))
        if path.is_absolute():
            try:
                relative = path.relative_to(directory).as_posix()
            except ValueError:
                raise StateError("DUCKDB_OPERATOR_DOWNLOAD_OUTSIDE_EXPORT") from None
        else:
            relative = path.as_posix()
        name = item.get("name") or relative
        if (not isinstance(name, str) or not name or name.startswith("/")
                or "\\" in name or any(part in {"", ".", ".."} for part in name.split("/"))
                or name in names):
            raise StateError("DUCKDB_OPERATOR_DOWNLOAD_NAME_INVALID")
        item["name"] = name
        item["path"] = str(path)
        names.add(name)
        selected.append(item)
    return selected


class DuckDBOperator:
    """Serialize native operations and retain portable handoff records locally."""

    def __init__(self, workspace, *, export_root=None, handoff_root=None):
        self.workspace = workspace
        self.directory = private_directory(Path(workspace.directory))
        self.mutex = threading.RLock()
        self.export_root = Path(export_root or (str(self.directory) + ".exports"))
        self.handoff_root = Path(handoff_root or (str(self.directory) + ".handoffs"))
        self.handoffs = private_directory(self.directory / "operator-handoffs")
        self.requests = private_directory(self.directory / "operator-requests")
        self._owner = os.open(self.directory / "duckdb-http.lock",
                              os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
        try:
            info = os.fstat(self._owner)
            if (not stat.S_ISREG(info.st_mode) or info.st_nlink != 1
                    or info.st_mode & 0o077):
                raise StateError("DUCKDB_OPERATOR_PRIVATE_LOCK_REQUIRED")
            fcntl.flock(self._owner, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BaseException:
            os.close(self._owner)
            self._owner = None
            raise StateError("DUCKDB_OPERATOR_ALREADY_OPEN") from None

    def close(self):
        if self._owner is not None:
            os.close(self._owner)
            self._owner = None

    def _handoff_rows(self):
        rows = []
        for path in sorted(self.handoffs.glob("handoff-*.json")):
            record = parse(read(path, _MAX_RECORD))
            if not isinstance(record, dict) or not _ID.fullmatch(str(record.get("export_id", ""))):
                raise StateError("DUCKDB_OPERATOR_HANDOFF_RECORD_INVALID")
            rows.append(record)
        return sorted(rows, key=lambda row: row.get("created_at", ""), reverse=True)

    def state(self):
        with self.mutex:
            editions = self.workspace.editions(limit=100)
            return {
                "directory": str(self.directory),
                "engine": "DuckDB",
                "editions": _rows(editions, "editions"),
                "next_before": editions.get("next_before") if isinstance(editions, dict) else None,
                "views": _rows(self.workspace.views(), "views"),
                "queries": _rows(self.workspace.queries(), "queries"),
                "reviews": _rows(self.workspace.reviews(), "reviews"),
                "exports": _rows(self.workspace.exports(), "exports"),
                "handoffs": self._handoff_rows(),
                "operations": self.operation_records(),
            }

    def export_record(self, export_id):
        _identifier(export_id)
        with self.mutex:
            records = self._handoff_rows() if export_id.startswith("handoff-") else _rows(self.workspace.exports(), "exports")
            for record in records:
                if record.get("export_id") == export_id:
                    return dict(record, files=_file_entries(record))
        raise StateError("DUCKDB_OPERATOR_EXPORT_NOT_FOUND")

    def review_record(self, review_id):
        _identifier(review_id)
        with self.mutex:
            for record in _rows(self.workspace.reviews(), "reviews"):
                if record.get("review_id") == review_id:
                    return record
        raise StateError("DUCKDB_OPERATOR_REVIEW_NOT_FOUND")

    def query_record(self, query_id):
        _identifier(query_id)
        with self.mutex:
            for record in _rows(self.workspace.queries(), "queries"):
                if record.get("query_id") == query_id:
                    return record
        raise StateError("DUCKDB_OPERATOR_QUERY_NOT_FOUND")

    def _destination(self, root, request_id):
        parent = private_directory(root)
        return str(parent / request_id)

    @staticmethod
    def _request_id(value):
        if not isinstance(value, str) or not re.fullmatch(r"[0-9a-f]{32}", value):
            raise StateError("DUCKDB_OPERATOR_REQUEST_ID_REQUIRED")
        return value

    def operation_records(self):
        records = []
        for path in self.requests.glob("*.request.json"):
            original = parse(read(path, _MAX_BODY))
            request_id = self._request_id(original.get("request_id"))
            status_path = self.requests / (request_id + ".status.json")
            status = parse(read(status_path, _MAX_RECORD)) if status_path.exists() else {"state": "PREPARED"}
            records.append({**original, **status})
        return sorted(records, key=lambda row: row["created_at"], reverse=True)

    def resume(self, request_id):
        request_id = self._request_id(request_id)
        with self.mutex:
            original = parse(read(self.requests / (request_id + ".request.json"), _MAX_BODY))
            return self.perform(original["route"], original["body"])

    def _retained_action(self, route, body):
        if route == "/api/exports":
            _fields(body, ("query_id", "expected_revision", "request_id"), ("expected_views",))
            _identifier(body["query_id"])
            _integer(body["expected_revision"], "revision", 1)
        elif route == "/api/source-handoffs":
            _fields(body, ("edition_id", "request_id"))
            _identifier(body["edition_id"])
        else:
            _fields(body, ("request_id",))
        request_id = self._request_id(body["request_id"])
        path = self.requests / (request_id + ".request.json")
        status_path = self.requests / (request_id + ".status.json")
        if path.exists():
            original = parse(read(path, _MAX_BODY))
            if original.get("route") != route or original.get("body") != body:
                raise StateError("DUCKDB_OPERATOR_ORIGINAL_REQUEST_CHANGED")
        else:
            original = {"request_id": request_id, "route": route, "body": body,
                        "directory": self._destination(self.export_root if route == "/api/exports" else self.handoff_root, request_id),
                        "created_at": datetime.now(timezone.utc).isoformat()}
            dump(path, original, exclusive=True)
        dump(status_path, {"state": "RUNNING", "updated_at": datetime.now(timezone.utc).isoformat()})
        try:
            if route == "/api/exports":
                result = self.workspace.export_query(body["query_id"], original["directory"],
                    expected_revision=body["expected_revision"], expected_views=body.get("expected_views"))
            else:
                native = (self.workspace.export_source(body["edition_id"], original["directory"])
                          if route == "/api/source-handoffs" else self.workspace.backup(original["directory"]))
                # Keep a small receiving index. Native source and warehouse
                # metadata remain in their original exported files.
                result = {key: native[key] for key in ("schema", "directory", "files", "edition_id",
                          "embedded_original_files", "reopen") if key in native}
                result.update(export_id="handoff-" + request_id,
                    kind="edition-source" if route == "/api/source-handoffs" else "source-handoff",
                    created_at=original["created_at"])
                if "editions" in native:
                    result["edition_count"] = len(native["editions"])
                record_path = self.handoffs / (result["export_id"] + ".json")
                dump(record_path, result)
            dump(status_path, {"state": "COMPLETE", "export_id": result["export_id"],
                               "updated_at": datetime.now(timezone.utc).isoformat()})
            return result
        except Exception as exc:
            try:
                dump(status_path, {"state": "INTERRUPTED", "error": getattr(exc, "code", type(exc).__name__),
                                   "updated_at": datetime.now(timezone.utc).isoformat()})
            except OSError:
                pass
            raise

    def perform(self, route, body):
        with self.mutex:
            if route == "/api/inspect-delivery":
                _fields(body, ("report_path",))
                return self.workspace.inspect_delivery(body["report_path"])
            if route == "/api/reviews":
                _fields(body, ("report_path",), ("columns", "keys"))
                return self.workspace.review_import(body["report_path"],
                    columns=body.get("columns"), keys=body.get("keys", []))
            if route == "/api/import":
                _fields(body, ("review_id",))
                return self.workspace.import_review(_identifier(body["review_id"]))
            if route == "/api/activate":
                _fields(body, ("name", "edition_id", "expected_revision"))
                return self.workspace.activate(body["name"], _identifier(body["edition_id"]),
                    expected_revision=_integer(body["expected_revision"], "revision"))
            if route == "/api/query":
                _fields(body, ("sql",), ("parameters", "max_rows", "expected_views"))
                return self.workspace.query(body["sql"], parameters=body.get("parameters", []),
                    max_rows=_integer(body.get("max_rows", 200), "max_rows", 1, 10000),
                    expected_views=body.get("expected_views"))
            if route == "/api/queries":
                _fields(body, ("name", "sql"), ("parameters", "expected_revision"))
                return self.workspace.save_query(body["name"], body["sql"],
                    parameters=body.get("parameters", []),
                    expected_revision=_integer(body.get("expected_revision", 0), "revision"))
            if route in {"/api/exports", "/api/source-handoffs", "/api/handoffs"}:
                return self._retained_action(route, body)
            if route == "/api/compare":
                _fields(body, ("before_id", "after_id"), ("keys", "max_rows"))
                return self.workspace.compare(_identifier(body["before_id"]), _identifier(body["after_id"]),
                    keys=body.get("keys"),
                    max_rows=_integer(body.get("max_rows", 200), "max_rows", 1, 10000))
        raise StateError("DUCKDB_OPERATOR_ROUTE_NOT_FOUND")

    @contextmanager
    def download(self, export_id, filename):
        """Validate the saved manifest and stream its exact retained descriptor."""
        record = self.export_record(export_id)
        if (not isinstance(filename, str) or not filename or PurePosixPath(filename).is_absolute()
                or "\\" in filename or any(part in {"", ".", ".."} for part in filename.split("/"))):
            raise StateError("DUCKDB_OPERATOR_DOWNLOAD_NAME_INVALID")
        selected = next((item for item in record["files"] if item["name"] == filename), None)
        if selected is None:
            raise StateError("DUCKDB_OPERATOR_DOWNLOAD_NOT_FOUND")
        expected_hash = selected.get("sha256")
        expected_size = selected.get("bytes", selected.get("size"))
        if (not isinstance(expected_hash, str) or not re.fullmatch(r"[0-9a-f]{64}", expected_hash)
                or type(expected_size) is not int or expected_size < 0):
            raise StateError("DUCKDB_OPERATOR_DOWNLOAD_MANIFEST_INVALID")
        directory = Path(record["directory"]).expanduser().resolve(strict=True)
        relative = Path(selected.get("path") or filename)
        target = relative if relative.is_absolute() else directory / relative
        # Only exact manifest names resolve; every component stays within this export.
        if not target.parent.resolve(strict=True).is_relative_to(directory):
            raise StateError("DUCKDB_OPERATOR_DOWNLOAD_OUTSIDE_EXPORT")
        fd = os.open(target, os.O_RDONLY | os.O_NOFOLLOW)
        with os.fdopen(fd, "rb") as stream:
            before = os.fstat(stream.fileno())
            if (not stat.S_ISREG(before.st_mode) or before.st_nlink != 1
                    or before.st_mode & 0o077 or before.st_size != expected_size):
                raise StateError("DUCKDB_OPERATOR_DOWNLOAD_CHANGED")
            actual_hash = hashlib.file_digest(stream, "sha256").hexdigest()
            after = os.fstat(stream.fileno())
            if (actual_hash != expected_hash or
                    (before.st_size, before.st_mtime_ns, before.st_ctime_ns) !=
                    (after.st_size, after.st_mtime_ns, after.st_ctime_ns)):
                raise StateError("DUCKDB_OPERATOR_DOWNLOAD_CHANGED")
            stream.seek(0)
            mime = selected.get("mime") or _MIMES.get(target.suffix.lower()) or mimetypes.guess_type(filename)[0] or "application/octet-stream"
            yield stream, {"name": filename, "bytes": expected_size, "sha256": expected_hash, "mime": mime}


def serve(workspace, *, port=0, export_root=None, handoff_root=None):
    """Return server, private launch record and browser URL on IPv4 loopback."""
    _integer(port, "port", 0, 65535)
    operator = DuckDBOperator(workspace, export_root=export_root, handoff_root=handoff_root)
    token = secrets.token_urlsafe(32)

    class Handler(BaseHTTPRequestHandler):
        server_version = "StellarForgeDuckDB"
        sys_version = ""

        def setup(self):
            super().setup()
            self.connection.settimeout(30)

        def log_message(self, *args):
            pass

        def _headers(self, name=None):
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Referrer-Policy", "no-referrer")
            self.send_header("Content-Security-Policy",
                "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; "
                "base-uri 'none'; frame-ancestors 'none'; form-action 'none'")
            if name:
                safe = re.sub(r'[^A-Za-z0-9_.-]', "_", name)
                self.send_header("Content-Disposition", 'attachment; filename="' + safe + '"')

        def _reply(self, status, body, mime="application/json;charset=utf-8"):
            payload = body if isinstance(body, bytes) else _json(body).encode()
            self.send_response(status)
            self.send_header("Content-Type", mime)
            self.send_header("Content-Length", str(len(payload)))
            self._headers()
            self.end_headers()
            if self.command != "HEAD":
                self.wfile.write(payload)

        def _dispatch(self):
            origin = "http://127.0.0.1:" + str(self.server.server_port)
            if (self.headers.get_all("Host") != [origin[7:]]
                    or self.headers.get("Origin", origin) != origin
                    or self.headers.get("Sec-Fetch-Site", "none") not in {"none", "same-origin"}):
                return self._reply(403, {"error": "DUCKDB_OPERATOR_LOCAL_ORIGIN_REQUIRED"})
            url = urlsplit(self.path)
            if url.scheme or url.netloc or url.fragment:
                return self._reply(400, {"error": "DUCKDB_OPERATOR_ROUTE_INVALID"})
            assets = {
                "/": (_duckdb_ui.HTML, "text/html;charset=utf-8"),
                "/app.js": (_duckdb_ui.JS, "text/javascript;charset=utf-8"),
                "/style.css": (_duckdb_ui.CSS, "text/css;charset=utf-8"),
            }
            if self.command in {"GET", "HEAD"} and url.path in assets and not url.query:
                value, mime = assets[url.path]
                return self._reply(200, value.encode(), mime)
            capabilities = self.headers.get_all("X-DuckDB-Capability", [])
            if len(capabilities) != 1 or not secrets.compare_digest(capabilities[0], token):
                return self._reply(403, {"error": "DUCKDB_OPERATOR_CAPABILITY_REQUIRED"})
            parameters = parse_qs(url.query, strict_parsing=True)
            if any(len(values) != 1 for values in parameters.values()):
                raise StateError("DUCKDB_OPERATOR_PARAMETERS_INVALID")
            parts = [unquote(part) for part in url.path.strip("/").split("/")]
            if self.command in {"GET", "HEAD"}:
                if len(parts) == 4 and parts[:2] == ["api", "exports"] and parts[3] == "file":
                    if set(parameters) != {"name"}:
                        raise StateError("DUCKDB_OPERATOR_DOWNLOAD_NAME_REQUIRED")
                    with operator.download(parts[2], parameters["name"][0]) as (stream, record):
                        send_export(self, stream, record)
                    return
                if url.path == "/api/editions":
                    if set(parameters) - {"before", "limit"}:
                        raise StateError("DUCKDB_OPERATOR_PARAMETERS_INVALID")
                    before = int(parameters["before"][0]) if "before" in parameters else None
                    limit = _integer(int(parameters.get("limit", ["100"])[0]), "limit", 1, 100)
                    with operator.mutex:
                        return self._reply(200, workspace.editions(limit=limit, before=before))
                if parameters:
                    raise StateError("DUCKDB_OPERATOR_PARAMETERS_INVALID")
                if url.path == "/api/state":
                    return self._reply(200, operator.state())
                if len(parts) == 3 and parts[:2] == ["api", "editions"]:
                    with operator.mutex:
                        return self._reply(200, workspace.edition(_identifier(parts[2])))
                if len(parts) == 3 and parts[:2] == ["api", "reviews"]:
                    return self._reply(200, operator.review_record(parts[2]))
                if len(parts) == 3 and parts[:2] == ["api", "queries"]:
                    return self._reply(200, operator.query_record(parts[2]))
                if len(parts) == 3 and parts[:2] == ["api", "exports"]:
                    return self._reply(200, operator.export_record(parts[2]))
            elif self.command == "POST" and not url.query:
                if self.headers.get("Transfer-Encoding") or self.headers.get_content_type() != "application/json":
                    return self._reply(415, {"error": "DUCKDB_OPERATOR_JSON_REQUIRED"})
                sizes = self.headers.get_all("Content-Length", [])
                if len(sizes) != 1 or not sizes[0].isascii() or not sizes[0].isdigit():
                    return self._reply(411, {"error": "DUCKDB_OPERATOR_LENGTH_REQUIRED"})
                length = int(sizes[0])
                if not 0 < length <= _MAX_BODY:
                    return self._reply(413, {"error": "DUCKDB_OPERATOR_REQUEST_SIZE_INVALID"})
                raw = self.rfile.read(length)
                if len(raw) != length:
                    raise StateError("DUCKDB_OPERATOR_REQUEST_INCOMPLETE")
                body = parse(raw)
                if len(parts) == 4 and parts[:2] == ["api", "requests"] and parts[3] == "resume":
                    _fields(body)
                    return self._reply(200, operator.resume(parts[2]))
                return self._reply(200, operator.perform(url.path, body))
            return self._reply(404, {"error": "DUCKDB_OPERATOR_NOT_FOUND"})

        def _handle(self):
            try:
                self._dispatch()
            except (BrokenPipeError, ConnectionResetError, TimeoutError):
                self.close_connection = True
            except workspace.duckdb.Error as exc:
                self._reply(400, {"error": "DUCKDB_QUERY_ERROR", "detail": str(exc)[:4096]})
            except BuyerError as exc:
                code = exc.code
                status = 409 if any(word in code for word in ("REVISION", "CHANGED", "BUSY", "EXISTS", "OPEN")) else 400
                self._reply(status, {"error": code})
            except (ValueError, TypeError, KeyError, OverflowError):
                self._reply(400, {"error": "DUCKDB_OPERATOR_REQUEST_INVALID"})
            except OSError:
                self._reply(409, {"error": "DUCKDB_OPERATOR_LOCAL_FILE_UNAVAILABLE"})
            except Exception:
                self._reply(500, {"error": "DUCKDB_OPERATOR_OPERATION_FAILED"})

        do_GET = do_POST = do_HEAD = _handle

    class Server(ThreadingHTTPServer):
        daemon_threads = False

        def server_close(self):
            try:
                super().server_close()
            finally:
                operator.close()

    try:
        server = Server(("127.0.0.1", port), Handler)
        url = "http://127.0.0.1:" + str(server.server_port) + "/#" + token
        control = operator.directory / "duckdb-launch.json"
        dump(control, {"schema": "stellar-forge.duckdb-operator-launch.v1",
                       "directory": str(operator.directory), "pid": os.getpid(), "url": url})
        return server, control, url
    except BaseException:
        if "server" in locals():
            server.server_close()
        else:
            operator.close()
        raise
