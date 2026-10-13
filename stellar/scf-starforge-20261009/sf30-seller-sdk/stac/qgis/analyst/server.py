#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""Private managed analyst console over the original QgisWorkspace."""
from __future__ import annotations
import argparse
from contextlib import contextmanager
import hashlib
import hmac
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import mimetypes
import os
from pathlib import Path
import re
import secrets
import signal
import subprocess
import sys
import tempfile
import threading
import time
import uuid
from urllib.parse import urlsplit, parse_qs, unquote

SOURCE_ROOT = Path(__file__).resolve().parent.parent
CORE_ROOT = SOURCE_ROOT / "starforge_stac" if (SOURCE_ROOT / "starforge_stac").is_dir() else SOURCE_ROOT
# The complete desktop plugin is flat; received and installed source use the canonical package layout.
sys.path[:0] = [str(SOURCE_ROOT), str(CORE_ROOT.parent)]
from starforge_stac.model import (QgisWorkspace, QgisReceivingError, require, read_json,
    json_bytes, value_sha, file_digest, member, REQUEST)
from starforge_stac.analyst_state import AnalystJournal, MAX_REQUEST_BYTES
from analyst.actions import normalize_payload, NATIVE_ACTIONS
from analyst.uploads import Uploads, MAX_CHUNK
from analyst.worker import active, error_value
from analyst.binding import inspect_binding, STARTUP_SCHEMA

STATIC = {"/": ("index.html", "text/html; charset=utf-8"),
          "/app.js": ("app.js", "text/javascript; charset=utf-8"),
          "/parcels.js": ("parcels.js", "text/javascript; charset=utf-8"),
          "/style.css": ("style.css", "text/css; charset=utf-8")}
SECURITY = {"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff",
            "Referrer-Policy": "no-referrer",
            "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self'; "
                "connect-src 'self'; img-src 'self' blob:; object-src 'none'; frame-ancestors 'none'; "
                "base-uri 'none'; form-action 'self'"}
EXTERNAL_ACTIONS = frozenset(("source.inspect", "source.import", "project.export", "project.receive", "field.command", "parcel.capture"))


def external_input(original):
    return original["action"] in EXTERNAL_ACTIONS or (original["action"] == "parcel.command" and
        original["payload"].get("action") in ("source.preview", "source.import"))


def page(query, allowed=()):
    require(set(query) <= {"offset", "limit", *allowed} and all(len(v) == 1 for v in query.values()),
            "ANALYST_QUERY", "Use the documented original page fields.")
    def integer(name, default):
        text = query.get(name, [str(default)])[0]
        require(re.fullmatch(r"0|[1-9][0-9]*", text) is not None,
                "ANALYST_PAGE", "Use non-negative integer page values.")
        return int(text)
    offset, limit = integer("offset", 0), integer("limit", 50)
    require(offset <= 10000000 and 1 <= limit <= 100, "ANALYST_PAGE",
            "Read a page of 1 to 100 original rows.")
    return offset, limit


def paged(rows, offset, limit):
    result = rows[offset:offset + limit]
    return {"items": result, "offset": offset, "limit": limit,
            "total": len(rows), "complete": offset + len(result) >= len(rows)}


def atomic_private(path, value):
    path = Path(path)
    require(not path.is_symlink(), "ANALYST_PRIVATE_FILE", "Use an ordinary private connection file.")
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix=".analyst-", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as target:
            target.write(json_bytes(value))
            target.flush()
            os.fsync(target.fileno())
        os.replace(temporary, path)
    finally:
        Path(temporary).unlink(missing_ok=True)


class Analyst:
    def __init__(self, binding):
        self.binding = binding
        self.workspace = QgisWorkspace(binding["workspaceDirectory"])
        self.journal = AnalystJournal(self.workspace)
        self.uploads = Uploads(self.workspace)
        self.instance_id = str(uuid.uuid4())
        self.token = secrets.token_hex(32)
        self.runtime = binding["nativeRuntime"]
        self.mutex = threading.Lock()
        self.children = {}
        self.closing = False
        self.startup = None

    def operation(self, identity):
        row = self.journal.get(identity)
        busy = active(self.workspace)
        selected_runtime = self.runtime if row["input"]["action"] in NATIVE_ACTIONS or row["input"]["action"] == "field.command" else {}
        native_changed = row["input"]["nativeRuntime"] != selected_runtime
        relocated = row["input"]["workspaceDirectory"] != str(self.workspace.root)
        needs_location = relocated and external_input(row["input"])
        row.update({"workerActive": busy, "displayStatus":
                    "INTERRUPTED" if row["status"] == "RUNNING" and not busy else row["status"],
                    "currentRevision": self.workspace.read()["revision"],
                    "canResume": row["status"] != "COMPLETED" and not native_changed and not needs_location,
                    "runtimeSelectionChanged": native_changed,
                    "originalHostInput": needs_location})
        return row

    def start(self, identity, expected_sha):
        record = self.journal.get(identity)
        require(record["inputSha256"] == expected_sha, "ANALYST_REQUEST_INPUT_CHANGED",
                "Continue the exact saved input that was reviewed.")
        if record["status"] == "COMPLETED":
            return self.operation(identity)
        selected_runtime = self.runtime if record["input"]["action"] in NATIVE_ACTIONS or record["input"]["action"] == "field.command" else {}
        require(record["input"]["nativeRuntime"] == selected_runtime,
                "ANALYST_RUNTIME_CHANGED", "Reopen this action with its originally selected native runtime, or review a new action.")
        require(record["input"]["workspaceDirectory"] == str(self.workspace.root) or
                not external_input(record["input"]),
                "ANALYST_ORIGINAL_HOST_INPUT",
                "This unfinished action retains a path on its original host. Review a new action with the current original input location.")
        with self.mutex:
            require(not self.closing, "ANALYST_CLOSING", "The original listener is stopping.")
            if any(child.poll() is None for child in self.children.values()) or active(self.workspace):
                return self.operation(identity)
            action = record["input"]["action"]
            if action in NATIVE_ACTIONS:
                require(self.runtime, "ANALYST_NATIVE_RUNTIME_REQUIRED",
                        "Select the existing QGIS runtime in the managed application settings.")
                command = list(self.runtime["native_command"])
            else:
                command = [sys.executable]
            command += ["-B", str(SOURCE_ROOT / "analyst" / "worker.py"),
                        "--workspace", str(self.workspace.root), "--request-id", identity,
                        "--instance-id", self.instance_id]
            env = dict(os.environ)
            env["PYTHONDONTWRITEBYTECODE"] = "1"
            env["PYTHONPATH"] = str(SOURCE_ROOT) + os.pathsep + str(CORE_ROOT.parent) + (os.pathsep + env["PYTHONPATH"] if env.get("PYTHONPATH") else "")
            log_path = member(self.workspace.root, "analyst/logs/" + identity + "-" + uuid.uuid4().hex + ".log", existing=False)
            log_path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
            with log_path.open("xb") as log:
                child = subprocess.Popen(command, stdin=subprocess.DEVNULL, stdout=log,
                                         stderr=subprocess.STDOUT, env=env, cwd=str(self.workspace.root))
            self.children[identity] = child
            threading.Thread(target=self._reap, args=(identity, child, log_path),
                             name="qgis-analyst-" + identity, daemon=True).start()
        return self.operation(identity)

    def _reap(self, identity, child, log_path):
        code = child.wait()
        try:
            current = self.journal.get(identity)
            if code != 75 and current["status"] not in ("COMPLETED", "FAILED", "INTERRUPTED"):
                tail = b""
                with log_path.open("rb") as log:
                    log.seek(max(0, log_path.stat().st_size - 8192))
                    tail = log.read()
                self.journal.fail(identity, {"code": "ANALYST_WORKER_ENDED",
                    "message": "The original worker ended before retaining its result. Continue this same request.",
                    "details": {"exitCode": code, "log": str(log_path), "tail": tail.decode("utf-8", "replace")}},
                    interrupted=True)
        finally:
            with self.mutex:
                if self.children.get(identity) is child:
                    del self.children[identity]

    def submit(self, value):
        require(isinstance(value, dict) and set(value) ==
                {"requestId", "action", "payload", "revision", "actor"},
                "ANALYST_REQUEST", "Use the complete original action, request ID, revision and analyst.")
        payload = normalize_payload(value["action"], value["payload"], self.workspace)
        if value["action"] in NATIVE_ACTIONS:
            require(self.runtime, "ANALYST_NATIVE_RUNTIME_REQUIRED",
                    "Select the existing QGIS runtime in the managed application settings.")
        native = self.runtime if value["action"] in NATIVE_ACTIONS or value["action"] == "field.command" else {}
        record = self.journal.create(request_id=value["requestId"], action=value["action"],
            payload=payload, revision=value["revision"], actor=value["actor"], native_runtime=native)
        return self.start(record["requestId"], record["inputSha256"])

    def close(self):
        with self.mutex:
            self.closing = True
            children = list(self.children.values())
        for child in children:
            if child.poll() is None:
                child.terminate()
        deadline = time.monotonic() + 12
        for child in children:
            try:
                child.wait(timeout=max(.1, deadline - time.monotonic()))
            except subprocess.TimeoutExpired:
                child.kill()
                child.wait(timeout=5)


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "Starforge-QGIS"
    def log_message(self, format, *args):
        return

    @property
    def app(self):
        return self.server.app

    def headers_for(self, status, content_type, length, extra=None):
        self.send_response(status)
        for key, value in SECURITY.items():
            self.send_header(key, value)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(length))
        for key, value in (extra or {}).items():
            self.send_header(key, value)
        self.end_headers()

    def json(self, status, value, *, cookie=False):
        body = json_bytes(value)
        extra = {}
        if cookie:
            extra["Set-Cookie"] = self.server.cookie_name + "=" + self.app.token + "; Path=/; HttpOnly; SameSite=Strict"
        self.headers_for(status, "application/json; charset=utf-8", len(body), extra)
        if self.command != "HEAD":
            self.wfile.write(body)

    def body(self, maximum=MAX_REQUEST_BYTES, *, binary=False):
        require(self.headers.get("Transfer-Encoding") is None,
                "ANALYST_CONTENT_LENGTH", "Use the exact request byte length.")
        length = self.headers.get("Content-Length", "")
        require(re.fullmatch(r"0|[1-9][0-9]*", length) is not None and int(length) <= maximum,
                "ANALYST_BODY_LIMIT", "The request exceeds its supported exact byte length.")
        content_type = self.headers.get("Content-Type", "").split(";")[0].strip().lower()
        require(content_type == ("application/octet-stream" if binary else "application/json"),
                "ANALYST_CONTENT_TYPE", "Use the documented original request content type.")
        self.connection.settimeout(60)
        body = self.rfile.read(int(length))
        require(len(body) == int(length), "ANALYST_BODY_INCOMPLETE", "The complete request body was not received.")
        if binary:
            return body
        value = json.loads(body.decode("utf-8"))
        require(isinstance(value, dict), "ANALYST_BODY", "Use a JSON object.")
        return value

    def authorized(self):
        header = self.headers.get("X-Starforge-Qgis-Workspace", "")
        if isinstance(header, str) and hmac.compare_digest(header, self.app.token):
            return True
        if self.command not in ("GET", "HEAD"):
            return False
        try:
            cookies = SimpleCookie(self.headers.get("Cookie", ""))
            value = cookies.get(self.server.cookie_name)
            return value is not None and hmac.compare_digest(value.value, self.app.token)
        except Exception:
            return False

    def download(self, path, record, name, content_type, *, inline=False):
        require(path.is_file() and not path.is_symlink(), "ANALYST_DOWNLOAD_MISSING",
                "The original selected file is not available on this host.")
        file_digest(path, expected=record)
        size = record["bytes"]
        start, end, status = 0, size - 1, 200
        range_header = self.headers.get("Range")
        if range_header is not None:
            match = re.fullmatch(r"bytes=([0-9]+)-([0-9]*)", range_header)
            require(match is not None and size > 0, "ANALYST_DOWNLOAD_RANGE",
                    "Use one original byte range.")
            start = int(match[1])
            end = min(size - 1, int(match[2]) if match[2] else size - 1)
            require(0 <= start <= end < size, "ANALYST_DOWNLOAD_RANGE",
                    "The byte range is outside the original file.")
            status = 206
        safe_name = re.sub(r"[^A-Za-z0-9._-]", "_", name)[:180] or "original-file"
        extra = {"ETag": '"' + record["sha256"] + '"', "Accept-Ranges": "bytes",
                 "X-Content-SHA256": record["sha256"],
                 "Content-Disposition": ("inline" if inline else "attachment") + '; filename="' + safe_name + '"'}
        if status == 206:
            extra["Content-Range"] = "bytes " + str(start) + "-" + str(end) + "/" + str(size)
        length = max(0, end - start + 1)
        self.headers_for(status, content_type, length, extra)
        if self.command == "HEAD":
            return
        with path.open("rb") as source:
            source.seek(start)
            left = length
            while left:
                block = source.read(min(left, 1024 * 1024))
                if not block:
                    self.close_connection = True
                    break
                self.wfile.write(block)
                left -= len(block)

    def field_package(self, round_id):
        import zipfile
        from starforge_stac.field import round_for
        _, row = round_for(self.app.workspace.read(), round_id)
        root = member(self.app.workspace.root, row["packageRoot"], existing=False)
        target_root = member(self.app.workspace.root, "analyst/downloads/.location", existing=False).parent
        target_root.mkdir(mode=0o700, parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(prefix="qfield-", dir=target_root) as temporary:
            target = Path(temporary) / (round_id + ".zip")
            with zipfile.ZipFile(target, "w", compression=zipfile.ZIP_STORED, allowZip64=True) as archive:
                for record in sorted(row["packageFiles"], key=lambda item: item["path"]):
                    path = member(root, record["path"])
                    file_digest(path, expected=record)
                    item = zipfile.ZipInfo(record["path"], (1980, 1, 1, 0, 0, 0))
                    item.external_attr = 0o100600 << 16
                    item.file_size = record["bytes"]
                    digest, size = hashlib.sha256(), 0
                    with path.open("rb") as source, archive.open(item, "w", force_zip64=True) as output:
                        while True:
                            chunk = source.read(1024 * 1024)
                            if not chunk:
                                break
                            output.write(chunk)
                            digest.update(chunk)
                            size += len(chunk)
                    require(size == record["bytes"] and digest.hexdigest() == record["sha256"],
                            "FIELD_PACKAGE_CHANGED", "A device export file changed during transfer.")
            return self.download(target, {"path": target.name, **file_digest(target)},
                                 target.name, "application/zip")

    def route(self):
        require(self.headers.get("Host") == self.server.host_header and
                self.headers.get("Origin", self.server.origin) == self.server.origin and
                self.headers.get("Sec-Fetch-Site") != "cross-site",
                "ANALYST_LOCAL_ORIGIN", "Use this original local analyst listener.")
        require(self.path.startswith("/") and not self.path.startswith("//"),
                "ANALYST_REQUEST_TARGET", "Use an original local route.")
        url = urlsplit(self.path)
        path, query = url.path, parse_qs(url.query, keep_blank_values=True)
        if self.command in ("GET", "HEAD") and path in STATIC and not query:
            name, mime = STATIC[path]
            body = (SOURCE_ROOT / "analyst" / "public" / name).read_bytes()
            self.headers_for(200, mime, len(body))
            if self.command != "HEAD":
                self.wfile.write(body)
            return
        require(self.authorized(), "ANALYST_KEY_REQUIRED", "Open the original private analyst connection.")
        require(not self.app.closing, "ANALYST_CLOSING", "The original analyst listener is stopping.")
        workspace = self.app.workspace
        if self.command in ("GET", "HEAD"):
            if path == "/api/launch" and not query:
                return self.json(200, self.app.startup, cookie=True)
            if path == "/api/state" and not query:
                return self.json(200, {"state": workspace.read(), "instanceId": self.app.instance_id,
                    "directory": str(workspace.root), "workerActive": active(workspace),
                    "capabilities": {"nativeRuntimeSelected": bool(self.app.runtime),
                                     "field": (CORE_ROOT / "field.py").is_file(),
                                     "parcels": (CORE_ROOT / "parcels" / "operator.py").is_file()}})
            if path == "/api/parcels" or path.startswith("/api/parcels/"):
                from starforge_stac.parcels.operator import read_route
                value = read_route(workspace, path, query)
                require(value is not None, "ANALYST_ROUTE_NOT_FOUND", "Choose an original parcel route.")
                return self.json(200, value)
            if path.startswith("/download/parcels/"):
                from starforge_stac.parcels.operator import download_route
                value = download_route(workspace, path, query)
                require(value is not None, "ANALYST_ROUTE_NOT_FOUND", "Choose an original parcel file.")
                return self.download(member(workspace.root, value["record"]["path"]),
                                     value["record"], value["name"], value["type"])
            if path == "/api/operations":
                offset, limit = page(query)
                return self.json(200, self.app.journal.list(offset=offset, limit=limit))
            match = re.fullmatch(r"/api/operations/([A-Za-z0-9][A-Za-z0-9._:-]{0,159})", path)
            if match and not query:
                return self.json(200, self.app.operation(match[1]))
            if path == "/api/history":
                offset, limit = page(query)
                return self.json(200, paged(list(reversed(workspace.history())), offset, limit))
            if path in ("/api/scenes", "/api/assets"):
                offset, limit = page(query, ("sourceId", "sceneKey"))
                source_id = query.get("sourceId", [None])[0]
                source = workspace.source(source_id)
                rows = source.scene_rows() if path.endswith("/scenes") else source.asset_rows(query.get("sceneKey", [None])[0])
                return self.json(200, {"sourceId": source.id, "sourceKind": source.sourceKind,
                                       **paged(rows, offset, limit)})
            if path == "/api/database-layers":
                offset, limit = page(query, ("sourceId",))
                source = workspace.source(query.get("sourceId", [None])[0])
                require(source.sourceKind == "postgis", "POSTGIS_SOURCE",
                        "Select the original accepted PostGIS receiving source.")
                return self.json(200, {"sourceId": source.id, "sourceKind": source.sourceKind,
                    "database": source.manifest["database"], "summary": source.summary,
                    **paged(list(source.layers.values()), offset, limit)})
            if path == "/api/compare":
                require(set(query) == {"left", "right"} and all(len(v) == 1 for v in query.values()),
                        "ANALYST_COMPARE", "Choose the exact two imported source editions.")
                return self.json(200, workspace.compare(query["left"][0], query["right"][0]))
            match = re.fullmatch(r"/api/uploads/([A-Za-z0-9][A-Za-z0-9._:-]{0,159})", path)
            if match and not query:
                return self.json(200, self.app.uploads.status(match[1]))
            match = re.fullmatch(r"/download/operations/([A-Za-z0-9][A-Za-z0-9._:-]{0,159})/files/([0-9]+)", path)
            if match and not query:
                record = self.app.journal.get(match[1])
                index = int(match[2])
                require(index < len(record["files"]), "ANALYST_DOWNLOAD", "Choose a retained result file.")
                item = record["files"][index]
                name = Path(item["path"]).name
                mime = mimetypes.guess_type(name)[0] or "application/octet-stream"
                return self.download(member(workspace.root, item["path"]), item, name, mime,
                                     inline=mime.startswith("image/"))
            match = re.fullmatch(r"/download/operations/([A-Za-z0-9][A-Za-z0-9._:-]{0,159})/project", path)
            if match and not query:
                row = self.app.journal.get(match[1])
                require(row["status"] == "COMPLETED" and row["input"]["action"] == "project.export" and
                        row["input"]["workspaceDirectory"] == str(workspace.root),
                        "ANALYST_DOWNLOAD", "Create an original complete project export on this host.")
                item = row["result"]
                selected = Path(row["input"]["payload"]["directory"]) / (row["requestId"] + ".zip")
                require(str(selected) == item["path"], "ANALYST_DOWNLOAD", "The original transport file identity changed.")
                return self.download(selected, item, selected.name, "application/zip")
            match = re.fullmatch(r"/download/projects/([A-Za-z0-9][A-Za-z0-9._:-]{0,159})", path)
            if match and not query:
                row = next((p for p in workspace.read()["projects"] if p["id"] == match[1]), None)
                require(row is not None, "PROJECT_NOT_FOUND", "Select a retained native project.")
                return self.download(member(workspace.root, row["file"]["path"]), row["file"],
                                     row["id"] + ".qgz", "application/octet-stream")
            match = re.fullmatch(r"/download/field/([A-Za-z0-9][A-Za-z0-9._:-]{0,159})", path)
            if match and not query:
                return self.field_package(match[1])
            if path == "/download/history" and not query:
                body = json_bytes(workspace.snapshot())
                self.headers_for(200, "application/json", len(body),
                    {"Content-Disposition": 'attachment; filename="qgis-project-history.json"'})
                if self.command != "HEAD":
                    self.wfile.write(body)
                return
        if self.command == "POST":
            if path == "/api/operations" and not query:
                return self.json(202, self.app.submit(self.body()))
            match = re.fullmatch(r"/api/operations/([A-Za-z0-9][A-Za-z0-9._:-]{0,159})/continue", path)
            if match and not query:
                body = self.body()
                require(set(body) == {"inputSha256"}, "ANALYST_CONTINUE",
                        "Continue the original reviewed input digest.")
                return self.json(202, self.app.start(match[1], body["inputSha256"]))
            if path == "/api/uploads" and not query:
                return self.json(201, self.app.uploads.create(self.body()))
            match = re.fullmatch(r"/api/uploads/([A-Za-z0-9][A-Za-z0-9._:-]{0,159})/complete", path)
            if match and not query:
                require(not self.body(), "ANALYST_UPLOAD_COMPLETE", "Complete the original retained upload.")
                return self.json(200, self.app.uploads.finish(match[1]))
        if self.command == "PUT":
            match = re.fullmatch(r"/api/uploads/([A-Za-z0-9][A-Za-z0-9._:-]{0,159})/file", path)
            if match:
                require(set(query) == {"path", "offset"} and all(len(v) == 1 for v in query.values()) and
                        re.fullmatch(r"0|[1-9][0-9]*", query["offset"][0]) is not None,
                        "ANALYST_UPLOAD_CHUNK", "Use the original file path and exact byte offset.")
                return self.json(200, self.app.uploads.chunk(match[1], query["path"][0],
                    int(query["offset"][0]), self.body(MAX_CHUNK, binary=True),
                    self.headers.get("X-Content-SHA256", "")))
        raise QgisReceivingError("ANALYST_ROUTE_NOT_FOUND", "Choose an original analyst route.")

    def handle_request(self):
        try:
            self.route()
        except (BrokenPipeError, ConnectionResetError):
            self.close_connection = True
        except Exception as exc:
            code = getattr(exc, "code", type(exc).__name__)
            status = 403 if code in ("ANALYST_KEY_REQUIRED", "ANALYST_LOCAL_ORIGIN") else (
                404 if code.endswith("NOT_FOUND") or code == "ANALYST_ROUTE_NOT_FOUND" else
                413 if code.endswith("_LIMIT") or code == "ANALYST_BODY_LIMIT" else
                409 if code in ("REVISION_CHANGED", "REQUEST_REUSED", "ANALYST_RUNTIME_CHANGED",
                                "ANALYST_ORIGINAL_HOST_INPUT") else 400)
            # Rejecting a body before reading it closes the connection, preserving framing.
            self.close_connection = True
            try:
                self.json(status, {"error": code, "message": str(exc),
                                   "details": getattr(exc, "details", {})})
            except (BrokenPipeError, ConnectionResetError):
                pass

    do_GET = handle_request
    do_HEAD = handle_request
    do_POST = handle_request
    do_PUT = handle_request


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", required=True)
    parser.add_argument("--native-runtime-file")
    parser.add_argument("--expected-binding")
    parser.add_argument("--connection-file")
    parser.add_argument("--port", type=int, default=0)
    args = parser.parse_args(argv)
    require(0 <= args.port <= 65535, "ANALYST_PORT", "Choose an available local port.")
    binding = inspect_binding(args.workspace, native_runtime_file=args.native_runtime_file)
    require(args.expected_binding is None or args.expected_binding == binding["sha256"],
            "ANALYST_MANAGED_BINDING_CHANGED", "Review the current original source and workspace before managed launch.")
    workspace = QgisWorkspace(binding["workspaceDirectory"])
    lock_path = member(workspace.root, "analyst/listener.lock", existing=False)
    lock_path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    import fcntl
    fd = os.open(lock_path, os.O_CREAT | os.O_RDWR | getattr(os, "O_NOFOLLOW", 0), 0o600)
    app, server, connection = None, None, None
    try:
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise QgisReceivingError("ANALYST_LISTENER_ACTIVE", "Reopen the current original analyst listener.")
        app = Analyst(binding)
        server = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
        server.daemon_threads = True
        server.app = app
        server.host_header = "127.0.0.1:" + str(server.server_address[1])
        server.origin = "http://" + server.host_header
        server.cookie_name = "starforge_qgis_" + str(server.server_address[1])
        app.startup = {"schema": STARTUP_SCHEMA, "status": "QGIS_ANALYST_READY",
            "workspaceId": binding["workspaceId"], "workspaceDirectory": binding["workspaceDirectory"],
            "bindingSha256": binding["sha256"], "sourceRoot": str(SOURCE_ROOT),
            "sourceSha256": binding["sourceSha256"], "instanceId": app.instance_id,
            "pid": os.getpid(), "operatorUrl": server.origin + "/#" + app.token,
            "nativeRuntimeSelected": bool(app.runtime)}
        connection = Path(args.connection_file).expanduser().absolute() if args.connection_file else workspace.root / "analyst" / "connection.json"
        if connection.exists():
            old, _ = read_json(connection, limit=65536)
            require(old.get("workspaceId") == binding["workspaceId"],
                    "ANALYST_CONNECTION_FILE", "The selected connection file belongs to another workspace.")
        atomic_private(connection, app.startup)
        print(json.dumps(app.startup, ensure_ascii=False, separators=(",", ":")), flush=True)
        def stop(signum, frame):
            app.closing = True
            threading.Thread(target=server.shutdown, name="qgis-analyst-stop", daemon=True).start()
        signal.signal(signal.SIGTERM, stop)
        signal.signal(signal.SIGINT, stop)
        server.serve_forever(poll_interval=.2)
        return 0
    finally:
        if app is not None:
            app.close()
        if server is not None:
            server.server_close()
        if connection is not None and connection.exists() and not connection.is_symlink():
            try:
                old, _ = read_json(connection, limit=65536)
                if app is not None and old.get("instanceId") == app.instance_id:
                    connection.unlink()
            except (OSError, ValueError):
                pass
        fcntl.flock(fd, fcntl.LOCK_UN)
        os.close(fd)


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(json.dumps({"error": getattr(exc, "code", type(exc).__name__),
                          "message": str(exc), "details": getattr(exc, "details", {})},
                         ensure_ascii=False), file=sys.stderr, flush=True)
        raise SystemExit(2)
