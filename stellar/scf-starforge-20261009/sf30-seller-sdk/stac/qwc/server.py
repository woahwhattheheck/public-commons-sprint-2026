# SPDX-License-Identifier: MIT
"""Private operator console for the original QWC publication and portable receiver."""
from __future__ import annotations

from contextlib import contextmanager
import hashlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import mimetypes
import os
from pathlib import Path
import secrets
import signal
import socket
import stat
import tempfile
import threading
import time
from urllib.parse import parse_qs, urlsplit
import uuid
import zipfile

from contract import (HERE, SHA, CHUNK, MAX_JSON, QwcError, need, identifier,
                      directory, member, relative, read_json, json_bytes, value_hash,
                      digest, atomic, keep_json, measure, sync_directory, now, original_gis)
from host import NativeContext
from workspace import QwcWorkspace
from portable import (DEFAULT_MAX_BYTES, export_publication, receive_publication,
                      inspect_received, reopen_received)

STATE_SCHEMA = "starforge.stac-qwc-console.v1"
JOB_SCHEMA = "starforge.stac-qwc-console-job.v1"
def browser_assets():
    manifest, _ = read_json(HERE / "browser-assets.json")
    need(manifest.get("schema") == "stellar-forge.browser-assets.v1" and manifest.get("root") == "./",
         "BROWSER_SOURCE_MAP", "Use the original complete operator browser manifest.")
    result = {}
    for route, entry in manifest["routes"]:
        name, media = entry
        need(route in ("/", "/app.js", "/style.css") and route not in result and
             isinstance(media, str) and name.startswith("public/"), "BROWSER_SOURCE_MAP",
             "Use the original selected browser routes and local source files.")
        result[route] = (member(HERE, name), media)
    need(set(result) == {"/", "/app.js", "/style.css"}, "BROWSER_SOURCE_MAP",
         "The complete operator browser source is required.")
    return result


def error_value(error):
    return {"code": getattr(error, "code", type(error).__name__),
            "message": str(error), "details": getattr(error, "details", {})}


class Jobs:
    """One original native owner; HTTP reads continue while its actual child runs."""

    def __init__(self, console):
        self.console = console
        self.root = directory(console.root / "console-jobs", True)
        self.guard = threading.RLock()
        self.current = None
        self.thread = None
        self.context = None
        self.closing = False

    def _path(self, job_id):
        return member(self.root, identifier(job_id, "jobId") + "/input.json")

    def inspect(self, job_id):
        path = self._path(job_id)
        selected, _ = read_json(path)
        root = path.parent
        state_path = root / "state.json"
        state = read_json(state_path)[0] if state_path.exists() else {
            "schema": JOB_SCHEMA, "id": job_id, "action": selected["action"], "phase": "RETAINED"}
        with self.guard:
            live = self.current is not None and self.current["id"] == job_id and self.thread is not None and self.thread.is_alive()
            if live:
                return dict(self.current)
        if (root / "result.json").exists():
            state.update({"phase": "COMPLETED", "result": read_json(root / "result.json")[0]})
        elif state.get("phase") in ("RUNNING", "STARTING"):
            state.update({"phase": "INTERRUPTED",
                          "message": "Reopen the same action to continue its retained operation."})
        return state

    def status(self):
        with self.guard:
            if self.current is not None:
                return {k: v for k, v in self.current.items() if k not in ("result", "input")}
        paths = sorted(self.root.glob("*/state.json"), key=lambda x: x.stat().st_mtime_ns, reverse=True)
        result = self.inspect(paths[0].parent.name) if paths else None
        return {k: v for k, v in result.items() if k not in ("result", "input")} if result else None

    def start(self, action, body):
        need(isinstance(body, dict), "ACTION_INPUT_REQUIRED", "Use the selected complete operation input.")
        body = dict(body)
        if action in ("verify", "verify-received", "reopen"):
            body["invocationId"] = identifier(body.get("invocationId") or action + "-" + uuid.uuid4().hex, "invocationId")
        selected = {"schema": JOB_SCHEMA, "action": action, "input": body}
        job_id = "job-" + value_hash(selected)
        root = directory(self.root / job_id, True)
        with self.guard:
            need(not self.closing and not self.console.stop_event.is_set(),
                 "CONSOLE_STOPPING", "The original console is finishing its current operation.")
            if self.thread is not None and self.thread.is_alive():
                need(self.current["id"] == job_id, "OPERATION_ACTIVE",
                     "The original native operation is still running. Open its progress or cancel it.",
                     jobId=self.current["id"])
                return dict(self.current)
            keep_json(root / "input.json", selected)
            if (root / "result.json").exists():
                return self.inspect(job_id)
            state = {"schema": JOB_SCHEMA, "id": job_id, "action": action,
                     "input": body, "phase": "STARTING", "startedAt": now()}
            atomic(root / "state.json", json_bytes(state))
            self.current = state
            ctx = NativeContext(lambda info: self.progress(job_id, info))
            ctx.fds.update(self.console.lease_fds)
            self.context = ctx
            worker = threading.Thread(target=self._work, args=(root, selected, state, ctx),
                                      name="qwc-" + action, daemon=False)
            self.thread = worker
            try:
                worker.start()
            except BaseException as error:
                state.update({"phase": "ERROR", "error": error_value(error), "closedAt": now()})
                atomic(root / "state.json", json_bytes(state))
                self.context = None
                raise
            return dict(state)

    def progress(self, job_id, info):
        # Original operation files retain the journal. Byte progress stays compact in
        # memory instead of writing another disk receipt for each streamed block.
        with self.guard:
            if self.current is not None and self.current["id"] == job_id:
                self.current["progress"] = dict(info)
                self.current["updatedAt"] = now()

    def _work(self, root, selected, state, ctx):
        try:
            with self.guard:
                state["phase"] = "RUNNING"
                atomic(root / "state.json", json_bytes(state))
            result = self.console.perform(selected["action"], selected["input"], ctx)
            # The original callable has returned only after its native owner closes.
            keep_json(root / "result.json", result)
            with self.guard:
                state.update({"phase": "COMPLETED", "completedAt": now(), "result": result})
                atomic(root / "state.json", json_bytes(state))
        except BaseException as error:
            with self.guard:
                state.update({"phase": "CANCELLED" if ctx.first_signal is not None else "ERROR",
                              "error": error_value(error), "closedAt": now()})
                try:
                    atomic(root / "state.json", json_bytes(state))
                except BaseException as write_error:
                    state["stateWriteError"] = error_value(write_error)
        finally:
            with self.guard:
                if self.context is ctx:
                    self.context = None

    def cancel(self, signum=signal.SIGTERM):
        with self.guard:
            if self.context is not None:
                self.context.stop(signum)
                self.current["cancellationRequested"] = True
            return dict(self.current) if self.current else None

    def close(self, signum=signal.SIGTERM):
        with self.guard:
            self.closing = True
            self.cancel(signum)
            worker = self.thread
        if worker is not None and worker is not threading.current_thread():
            worker.join()


class Console(ThreadingHTTPServer):
    daemon_threads = False
    block_on_close = True
    request_queue_size = 16

    def __init__(self, root, *, received=False, qgis_python=None, port=0,
                 max_archive_bytes=DEFAULT_MAX_BYTES, lease_fds=()):
        self.root = directory(root)
        self.received_only = bool(received)
        self.qgis_python = qgis_python
        self.workspace = None if received else QwcWorkspace(root)
        if received:
            inspect_received(root, verify=False)
        self.max_archive_bytes = max_archive_bytes
        need(type(max_archive_bytes) is int and max_archive_bytes > 0,
             "ARCHIVE_LIMIT_REQUIRED", "Declare the complete receiving archive capacity.")
        self.token = secrets.token_urlsafe(32)
        self.slots = threading.BoundedSemaphore(8)
        self.stop_event = threading.Event()
        self.serving_event = threading.Event()
        self.stop_guard = threading.RLock()
        self.stop_thread = None
        self.first_signal = None
        self.launch = None
        self.assets = browser_assets()
        self.lease_fds = set(lease_fds)
        self.tickets = {}
        self.ticket_guard = threading.RLock()
        self.jobs = Jobs(self)
        super().__init__(("127.0.0.1", port), Handler)
        self.origin = "http://127.0.0.1:" + str(self.server_port)
        self.url = self.origin + "/#" + self.token

    def process_request(self, request, address):
        if self.stop_event.is_set() or not self.slots.acquire(blocking=False):
            self.shutdown_request(request)
            return
        try:
            super().process_request(request, address)
        except BaseException:
            self.slots.release()
            raise

    def process_request_thread(self, request, address):
        try:
            super().process_request_thread(request, address)
        finally:
            self.slots.release()

    def request_stop(self, signum=signal.SIGTERM):
        with self.stop_guard:
            if self.first_signal is None:
                self.first_signal = signum
            self.stop_event.set()
            self.jobs.cancel(self.first_signal)
            if self.serving_event.is_set() and self.stop_thread is None:
                self.stop_thread = threading.Thread(target=self.shutdown, name="qwc-console-stop", daemon=False)
                self.stop_thread.start()

    def run(self):
        # A signal recorded before HTTP starts remains effective through startup.
        with self.stop_guard:
            if self.stop_event.is_set():
                return
            self.serving_event.set()
        try:
            self.serve_forever(poll_interval=0.2)
        finally:
            self.serving_event.clear()

    def close(self):
        self.request_stop(self.first_signal or signal.SIGTERM)
        self.jobs.close(self.first_signal or signal.SIGTERM)
        # Native workers drain before HTTP requests and the original console lease.
        self.server_close()
        if self.stop_thread is not None and self.stop_thread is not threading.current_thread():
            self.stop_thread.join()

    def receiver(self, receiver_id=None):
        if self.received_only:
            need(receiver_id in (None, "", "original"), "RECEIVER_ID_CHANGED", "Open this original received publication.")
            return self.root
        return directory(self.root / "receivings" / identifier(receiver_id, "receiverId"))

    def state(self, offset=0):
        base = {"schema": STATE_SCHEMA, "mode": "received" if self.received_only else "publisher",
                "directory": str(self.root), "job": self.jobs.status(),
                "stopping": self.stop_event.is_set(),
                "limits": {"archiveBytes": self.max_archive_bytes},
                "python": self.qgis_python or (self.workspace.profile["qgisPython"] if self.workspace else None)}
        if self.received_only:
            base["received"] = inspect_received(self.root, verify=False)
        else:
            base["workspace"] = self.workspace.inspect(offset=offset)
            base["profile"] = self.workspace.profile
            receivers = self.root / "receivings"
            base["receivings"] = [{"id": path.name,
                                  "complete": (path / "received-package.json").is_file()}
                                 for path in sorted(receivers.iterdir()) if path.is_dir() and not path.is_symlink()] if receivers.exists() else []
        return base

    def perform(self, action, body, ctx):
        if action == "reopen":
            root = self.receiver(body.get("receiverId"))
            return reopen_received(root, body.get("qgisPython") or self.qgis_python or (self.workspace.profile["qgisPython"] if self.workspace else None),
                                   invocation_id=body["invocationId"], context=ctx)
        if action == "verify-received":
            return inspect_received(self.receiver(body.get("receiverId")), verify=True, progress=ctx.checkpoint)
        need(not self.received_only, "PUBLISHER_WORKSPACE_REQUIRED",
             "Open the original publishing workspace to change its host.")
        ws = self.workspace
        if action == "prepare":
            return ws.prepare(body["request"], context=ctx)
        if action == "publish":
            return ws.publish(body["requestId"], body["reviewSha256"], context=ctx)
        if action == "rollback":
            return ws.rollback(body["requestId"], body["publicationSha256"], context=ctx)
        if action == "verify":
            return ws.inspect(body["requestId"], verify=True)
        if action == "export":
            export_id = identifier(body["exportId"], "exportId")
            destination = self.root / "exports" / export_id / "publication.zip"
            return export_publication(ws, body["requestId"], destination, export_id, context=ctx)
        if action == "receive":
            sha = body.get("archiveSha256")
            need(isinstance(sha, str) and SHA.fullmatch(sha), "ARCHIVE_SHA_REQUIRED",
                 "Use the original complete archive SHA-256.")
            upload = member(self.root, "uploads/" + sha + ".zip")
            root = self.root / "receivings" / identifier(body["receiverId"], "receiverId")
            return receive_publication(upload, root, sha, max_bytes=self.max_archive_bytes, context=ctx)
        raise QwcError("ACTION_UNKNOWN", "Choose an existing publication or receiving action.")

    def gis(self, root):
        need(not self.received_only, "PUBLISHER_WORKSPACE_REQUIRED", "Open the original publisher.")
        original = original_gis().QgisWorkspace(directory(root))
        state = original.read()
        return {"directory": str(original.root), "workspaceId": state["id"], "revision": state["revision"],
                "title": state["title"],
                "projects": [{"id": x["id"], "at": x.get("at"), "inputRevision": x.get("inputRevision"),
                              "sourceIds": x["sourceIds"], "layers": x["layers"], "file": x["file"]}
                             for x in state["projects"]]}

    def selected_file(self, body):
        if body.get("kind") == "export":
            need(not self.received_only, "PUBLISHER_WORKSPACE_REQUIRED", "Open the original exporter.")
            export_id = identifier(body["exportId"], "exportId")
            receipt, _ = read_json(member(self.root, "exports/" + export_id + "/result.json"))
            path = member(self.root, "exports/" + export_id + "/publication.zip")
            need(receipt["path"] == str(path), "EXPORT_DESTINATION_CHANGED", "The original export destination changed.")
            return path, receipt, "qwc-" + export_id + ".zip", "application/zip"
        if self.received_only or body.get("kind") == "received-file":
            root = self.receiver(body.get("receiverId"))
            selected = inspect_received(root, verify=False)
            op = root / "operation"
            name = relative(body["path"])
            publication = selected["publication"]
        else:
            request_id = identifier(body["requestId"], "requestId")
            op = self.workspace._operation(request_id)
            publication_path = op / "publication.json"
            publication = read_json(publication_path)[0] if publication_path.exists() else {"files": []}
            name = relative(body["path"])
        allowed_metadata = {"publication.json", "review.json", "deployment.json", "rollback.json",
                            "published-deployment.json", "intent.json", "projection-request.json"}
        row = next((x for x in publication["files"] if x["path"] == name), None)
        need(row is not None or name in allowed_metadata, "PUBLICATION_FILE_REQUIRED",
             "Select a retained publication or deployment file.")
        path = member(op, name)
        info = measure(path, row)
        media = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
        return path, info, path.name, media

    def ticket(self, body):
        path, info, filename, media = self.selected_file(body)
        seen = path.stat()
        need(seen.st_size == info["bytes"], "DOWNLOAD_FILE_CHANGED", "The retained download changed.")
        token = secrets.token_urlsafe(32)
        with self.ticket_guard:
            self.tickets = {k: v for k, v in self.tickets.items() if v["expires"] > time.monotonic()}
            need(len(self.tickets) < 128, "DOWNLOADS_ACTIVE", "Finish an existing download before opening another.")
            self.tickets[token] = {"path": path, "bytes": info["bytes"], "sha256": info["sha256"],
                                  "filename": filename, "media": media, "expires": time.monotonic() + 600,
                                  "identity": (seen.st_dev, seen.st_ino, seen.st_size, seen.st_mtime_ns, seen.st_ctime_ns)}
        return {"url": self.origin + "/download/" + token, "filename": filename,
                "bytes": info["bytes"], "sha256": info["sha256"], "expiresSeconds": 600}

    def consume_ticket(self, token):
        with self.ticket_guard:
            selected = self.tickets.pop(token, None)
        need(selected is not None and selected["expires"] > time.monotonic(),
             "DOWNLOAD_LINK_EXPIRED", "Open the original download again.")
        return selected


class Handler(BaseHTTPRequestHandler):
    server_version = "StarForge-QWC"
    protocol_version = "HTTP/1.0"

    def setup(self):
        super().setup()
        self.connection.settimeout(10)

    def log_message(self, *_):
        pass  # Private capability, host paths and original customer data stay out of access logs.

    def gate(self, authenticated=True):
        target = urlsplit(self.path)
        need(len(self.headers.get_all("Host", [])) == 1 and len(self.headers.get_all("Origin", [])) <= 1 and
             len(self.headers.get_all("Authorization", [])) <= 1 and not target.scheme and not target.netloc and
             self.headers.get("Host") == urlsplit(self.server.origin).netloc and
             self.headers.get("Origin") in (None, self.server.origin),
             "LOCAL_ORIGIN_REQUIRED", "Open this original local operator console.")
        if authenticated:
            supplied = self.headers.get("Authorization", "")
            if not secrets.compare_digest(supplied.encode(), ("Bearer " + self.server.token).encode()):
                raise PermissionError("Open this process's private console link.")
        return target

    def send_headers(self, code, media, length, filename=None):
        self.send_response(code)
        self.send_header("Content-Type", media)
        self.send_header("Content-Length", str(length))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Cross-Origin-Resource-Policy", "same-origin")
        self.send_header("Content-Security-Policy",
                         "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; "
                         "img-src 'self' blob:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'")
        if filename:
            safe = "".join(c for c in filename if c.isascii() and (c.isalnum() or c in "._-"))[:180] or "qwc-download"
            self.send_header("Content-Disposition", 'attachment; filename="' + safe + '"')
        self.end_headers()

    def response(self, value, code=200):
        body = json_bytes(value)
        self.send_headers(code, "application/json; charset=utf-8", len(body))
        self.wfile.write(body)

    def query(self, target):
        parsed = parse_qs(target.query, keep_blank_values=True)
        need(all(len(v) == 1 for v in parsed.values()), "QUERY_REPEATED", "Use each selected parameter once.")
        return {k: v[0] for k, v in parsed.items()}

    def length(self, maximum):
        raw = self.headers.get("Content-Length", "")
        need(not self.headers.get("Transfer-Encoding") and len(self.headers.get_all("Content-Length", [])) == 1 and
             raw.isdecimal(), "CONTENT_LENGTH_REQUIRED", "Use one exact request byte length.")
        count = int(raw)
        need(0 <= count <= maximum, "REQUEST_SIZE_LIMIT", "The complete request exceeds the selected capacity.",
             maximumBytes=maximum)
        return count

    def body(self):
        length = self.length(MAX_JSON)
        raw = self.rfile.read(length)
        need(len(raw) == length, "REQUEST_INCOMPLETE", "The request ended before its original byte length.")
        try:
            result = json.loads(raw.decode("utf-8"), parse_constant=lambda x: (_ for _ in ()).throw(ValueError(x)))
        except (ValueError, UnicodeError) as error:
            raise QwcError("JSON_INVALID", "Use the complete selected JSON request.") from error
        need(isinstance(result, dict), "JSON_OBJECT_REQUIRED", "Use one complete operation input.")
        return result

    def upload(self):
        need(not self.server.received_only, "PUBLISHER_WORKSPACE_REQUIRED", "Open the original receiver desk.")
        sha = self.headers.get("X-QWC-SHA256")
        need(len(self.headers.get_all("X-QWC-SHA256", [])) == 1 and isinstance(sha, str) and SHA.fullmatch(sha),
             "ARCHIVE_SHA_REQUIRED", "Use the original archive SHA-256 from its export receipt.")
        length = self.length(self.server.max_archive_bytes)
        root = directory(self.server.root / "uploads", True)
        destination = root / (sha + ".zip")
        fd, temporary = tempfile.mkstemp(prefix=".qwc-upload-", dir=root)
        checksum, count = hashlib.sha256(), 0
        try:
            with os.fdopen(fd, "wb") as output:
                os.fchmod(output.fileno(), 0o600)
                while count < length:
                    need(not self.server.stop_event.is_set(), "CONSOLE_STOPPING", "The original console is stopping.")
                    block = self.rfile.read(min(CHUNK, length - count))
                    need(block, "UPLOAD_INCOMPLETE", "Continue with the same complete original archive.")
                    output.write(block)
                    checksum.update(block)
                    count += len(block)
                output.flush()
                os.fsync(output.fileno())
            need(count == length and checksum.hexdigest() == sha, "UPLOAD_HASH_CHANGED",
                 "The archive bytes differ from the original export receipt.")
            try:
                os.link(temporary, destination)
            except FileExistsError:
                measure(destination, {"bytes": count, "sha256": sha})
            sync_directory(root)
            receipt = {"schema": "starforge.stac-qwc-upload.v1", "archiveSha256": sha,
                       "bytes": count, "path": str(destination)}
            keep_json(root / (sha + ".json"), receipt)
            self.response(receipt, 201)
        finally:
            Path(temporary).unlink(missing_ok=True)

    def download(self, selected):
        with selected["path"].open("rb") as stream:
            info = os.fstat(stream.fileno())
            need(stat.S_ISREG(info.st_mode) and
                 (info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns, info.st_ctime_ns) == selected["identity"],
                 "DOWNLOAD_FILE_CHANGED", "Open a new download for the retained current file.")
            self.send_headers(200, selected["media"], selected["bytes"], selected["filename"])
            remaining = selected["bytes"]
            while remaining:
                if self.server.stop_event.is_set():
                    return
                block = stream.read(min(CHUNK, remaining))
                if not block:
                    return
                self.wfile.write(block)
                remaining -= len(block)

    def handle_action(self, callback):
        try:
            callback()
        except PermissionError as error:
            self.response({"error": error_value(error)}, 403)
        except FileNotFoundError:
            self.response({"error": {"code": "RETAINED_FILE_MISSING", "message": "The selected original file or operation is missing."}}, 404)
        except (QwcError, ValueError, KeyError, zipfile.BadZipFile) as error:
            self.response({"error": error_value(error)}, 409 if getattr(error, "code", "") in
                          ("OPERATION_ACTIVE", "CONSOLE_STOPPING") else 400)
        except (BrokenPipeError, ConnectionResetError, TimeoutError, socket.timeout):
            pass
        except Exception as error:
            self.response({"error": error_value(error)}, 500)

    def do_GET(self):
        self.handle_action(self.get)

    def get(self):
        target = self.gate(False)
        if target.path in self.server.assets:
            path, media = self.server.assets[target.path]
            body = path.read_bytes()
            self.send_headers(200, media, len(body))
            self.wfile.write(body)
            return
        if target.path.startswith("/download/") and target.path.count("/") == 2:
            self.download(self.server.consume_ticket(target.path.split("/")[2]))
            return
        self.gate()
        q = self.query(target)
        if target.path == "/api/launch":
            self.response(self.server.launch)
        elif target.path == "/api/state":
            self.response(self.server.state(int(q.get("offset", "0"))))
        elif target.path == "/api/job":
            self.response(self.server.jobs.inspect(q["id"]))
        elif target.path == "/api/gis":
            self.response(self.server.gis(q["directory"]))
        elif target.path == "/api/operation":
            need(not self.server.received_only, "PUBLISHER_WORKSPACE_REQUIRED", "Open the original publisher.")
            self.response(self.server.workspace.inspect(q["requestId"]))
        elif target.path == "/api/received":
            self.response(inspect_received(self.server.receiver(q.get("receiverId")), verify=False))
        else:
            self.response({"error": {"code": "ROUTE_UNKNOWN", "message": "Choose an existing operator action."}}, 404)

    def do_POST(self):
        self.handle_action(self.post)

    def post(self):
        target = self.gate()
        if target.path == "/api/upload":
            self.upload()
            return
        body = self.body()
        if target.path == "/api/cancel":
            self.response({"job": self.server.jobs.cancel()})
        elif target.path == "/api/stop":
            self.response({"status": "STOPPING"})
            self.server.request_stop()
        elif target.path == "/api/download":
            self.response(self.server.ticket(body))
        elif target.path.startswith("/api/actions/") and target.path.count("/") == 3:
            action = target.path.rsplit("/", 1)[1]
            need(action in ("prepare", "publish", "rollback", "verify", "export",
                            "receive", "reopen", "verify-received"), "ACTION_UNKNOWN",
                 "Choose an existing publication or receiving action.")
            self.response(self.server.jobs.start(action, body), 202)
        else:
            self.response({"error": {"code": "ROUTE_UNKNOWN", "message": "Choose an existing operator action."}}, 404)
