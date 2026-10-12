#!/usr/bin/env python3
"""Local customer desk for the original NetBox inventory migration operator."""
from __future__ import annotations

import argparse
import csv
from dataclasses import dataclass
from email import policy
from email.parser import BytesHeaderParser
from email.message import Message
import hmac
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import re
import secrets
import signal
import sys
import tempfile
import threading
import zipfile
from urllib.parse import parse_qsl, quote, unquote, urlsplit

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from actions import NativeActions
from model import Desk, DeskError, MAX_HANDOVER_UPLOAD, MAX_SOURCE_BYTES, need, request_id
from inventory_migration import InventoryError, MAX_BYTES, load_json
from prepare_inventory import json_bytes, workspace_lock

MULTIPART_OVERHEAD = 64 * 1024
MAX_FIELD_BYTES = 8192


class MultipartBody:
    """A length-delimited multipart reader with bounded in-memory fragments."""
    def __init__(self, stream, length):
        self.stream, self.remaining = stream, length
        self.buffer = bytearray()

    def fill(self):
        if self.remaining <= 0:
            return False
        chunk = self.stream.read(min(64 * 1024, self.remaining))
        need(bool(chunk), "incomplete_upload", "The original upload ended before its declared byte length.")
        self.remaining -= len(chunk)
        self.buffer.extend(chunk)
        return True

    def line(self, maximum=16384):
        while True:
            at = self.buffer.find(b"\r\n")
            if at >= 0:
                need(at + 2 <= maximum, "multipart_header", "A multipart header exceeds its supported length.")
                result = bytes(self.buffer[:at + 2])
                del self.buffer[:at + 2]
                return result
            need(len(self.buffer) <= maximum and self.fill(), "incomplete_upload",
                 "The multipart upload has an incomplete or oversized header.")

    def part(self, marker, consume):
        keep = len(marker) + 2
        while True:
            at = self.buffer.find(marker)
            if at >= 0:
                end = at + len(marker)
                while len(self.buffer) < end + 2 and self.fill():
                    pass
                suffix = bytes(self.buffer[end:end + 2])
                if suffix in (b"\r\n", b"--"):
                    if at:
                        consume(bytes(self.buffer[:at]))
                    del self.buffer[:end + 2]
                    return suffix == b"--"
                # A similar byte sequence inside the original file is content.
                consume(bytes(self.buffer[:at + 1]))
                del self.buffer[:at + 1]
                continue
            if len(self.buffer) > keep:
                size = len(self.buffer) - keep
                consume(bytes(self.buffer[:size]))
                del self.buffer[:size]
            need(self.fill(), "incomplete_upload", "The original multipart upload has no complete closing boundary.")

    def finish(self):
        while self.fill():
            need(len(self.buffer) <= 2, "multipart_end", "The multipart upload has unexpected trailing bytes.")
        need(bytes(self.buffer) in (b"", b"\r\n"), "multipart_end",
             "The multipart upload has unexpected trailing bytes.")


def multipart_file(stream, length, content_type, temporary_root, maximum):
    message = Message()
    message["Content-Type"] = content_type
    need(message.get_content_type() == "multipart/form-data", "content_type",
         "Send the original file with multipart/form-data.", 415)
    boundary = message.get_param("boundary")
    need(isinstance(boundary, str) and re.fullmatch(r"[0-9A-Za-z'()+_,./:=? -]{1,70}", boundary)
         and not boundary.endswith(" "), "multipart_boundary", "Use the original multipart boundary.")
    encoded = boundary.encode("ascii")
    reader = MultipartBody(stream, length)
    need(reader.line() == b"--" + encoded + b"\r\n", "multipart_boundary",
         "The uploaded form does not start with its declared boundary.")
    fields, file_path, file_name, count = {}, None, None, 0
    try:
        while True:
            count += 1
            need(count <= 3, "multipart_parts", "Send one original file, request_id and expected_revision.")
            header_lines, header_bytes = [], 0
            while True:
                line = reader.line()
                header_bytes += len(line)
                need(header_bytes <= 16384, "multipart_header", "Multipart headers exceed 16 KiB.")
                if line == b"\r\n":
                    break
                header_lines.append(line)
            headers = BytesHeaderParser(policy=policy.default).parsebytes(b"".join(header_lines) + b"\r\n")
            need(not headers.defects and len(headers.get_all("Content-Disposition", [])) == 1,
                 "multipart_header", "Use one valid form-data disposition per part.")
            need(headers.get_content_disposition() == "form-data", "multipart_header",
                 "Each upload part must be form-data.")
            name = headers.get_param("name", header="Content-Disposition")
            need(name in ("request_id", "expected_revision", "file") and name not in fields,
                 "multipart_field", "Use one value for each original upload field.")
            if name == "file":
                need(file_path is None, "multipart_file", "Select one original file.")
                file_name = headers.get_filename()
                from model import filename
                filename(file_name)
                descriptor, temporary = tempfile.mkstemp(prefix="inventory-upload-", dir=temporary_root)
                file_path = Path(temporary)
                size = 0
                with os.fdopen(descriptor, "wb") as output:
                    os.fchmod(output.fileno(), 0o600)
                    def consume(chunk):
                        nonlocal size
                        size += len(chunk)
                        need(size <= maximum, "upload_size", "The original file exceeds its supported byte limit.", 413)
                        output.write(chunk)
                    final = reader.part(b"\r\n--" + encoded, consume)
                    output.flush()
                    os.fsync(output.fileno())
                fields[name] = True
            else:
                need(headers.get_filename() is None, "multipart_field", "Keep original request fields as plain form values.")
                chunks, size = [], 0
                def consume(chunk):
                    nonlocal size
                    size += len(chunk)
                    need(size <= MAX_FIELD_BYTES, "multipart_field", "A request field exceeds its supported length.")
                    chunks.append(chunk)
                final = reader.part(b"\r\n--" + encoded, consume)
                try:
                    fields[name] = b"".join(chunks).decode("utf-8")
                except UnicodeDecodeError as exc:
                    raise DeskError("multipart_field", "Request fields must be UTF-8 text.") from exc
            if final:
                break
        reader.finish()
        need(set(fields) == {"request_id", "expected_revision", "file"} and file_path is not None,
             "multipart_fields", "Keep the original request_id, expected_revision and file together.")
        request_id(fields["request_id"])
        number = fields["expected_revision"]
        need(isinstance(number, str) and number.isdecimal() and int(number) > 0,
             "revision", "Use the displayed positive project revision.")
        return {"request_id": fields["request_id"], "expected_revision": int(number),
                "name": file_name, "path": file_path}
    except BaseException:
        if file_path is not None:
            file_path.unlink(missing_ok=True)
        raise


def integer(value, default, minimum=0, maximum=None):
    if value is None:
        return default
    need(isinstance(value, str) and value.isdecimal(), "page", "Use an integer page field.")
    result = int(value)
    need(result >= minimum and (maximum is None or result <= maximum), "page", "The page field is outside its supported range.")
    return result


class DeskHTTPServer(ThreadingHTTPServer):
    daemon_threads = False
    block_on_close = True
    allow_reuse_address = True


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "NetBoxCustomerDesk/1"
    sys_version = ""

    def setup(self):
        super().setup()
        self.connection.settimeout(120)

    def handle_expect_100(self):
        try:
            self.check_origin(mutating=True)
            self.authenticate()
        except DeskError as exc:
            self.error(exc)
            return False
        self.send_response_only(100)
        self.end_headers()
        return True

    def check_origin(self, mutating=False):
        hosts = self.headers.get_all("Host", [])
        need(len(hosts) == 1 and hosts[0] == self.server.authority, "host",
             "Use the original local operator URL.", 403)
        origins = self.headers.get_all("Origin", [])
        need(len(origins) <= 1 and (not origins or origins[0] == self.server.origin),
             "origin", "Use the original local operator origin.", 403)
        if mutating:
            need(origins == [self.server.origin], "origin", "Mutations require this local operator's exact Origin.", 403)

    def authenticate(self):
        authorization = self.headers.get_all("Authorization", [])
        workspace = self.headers.get_all("X-Workspace-Token", [])
        need(len(authorization) == 1 and len(workspace) == 1
             and hmac.compare_digest(authorization[0], "Bearer " + self.server.token)
             and hmac.compare_digest(workspace[0], self.server.token),
             "authentication", "Open the operator with its current local session token.", 401)

    def common_headers(self, *, api=False):
        self.close_connection = True
        self.send_header("Connection", "close")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Content-Security-Policy",
                         "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; "
                         "connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'")
        if api:
            self.send_header("Vary", "Authorization, X-Workspace-Token")

    def json(self, value, status=200):
        raw = json_bytes({"ok": True, **value})
        self.send_response(status)
        self.common_headers(api=True)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(raw)

    def error(self, exc):
        status = getattr(exc, "status", 400)
        detail = {"code": getattr(exc, "code", "original_inventory_error"), "message": str(exc)}
        if getattr(exc, "details", None) is not None:
            detail["details"] = exc.details
        raw = json_bytes({"ok": False, "error": detail})
        self.close_connection = True
        self.send_response(status)
        self.common_headers(api=True)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def body_length(self, maximum):
        values = self.headers.get_all("Content-Length", [])
        need(not self.headers.get_all("Transfer-Encoding", []), "body_length",
             "Use one declared byte length for this local request.")
        need(len(values) == 1 and values[0].isdecimal(), "body_length",
             "Keep the original request's Content-Length.")
        length = int(values[0])
        need(0 < length <= maximum, "body_size", "The request exceeds its supported byte limit.", 413)
        return length

    def body_json(self):
        message = Message()
        message["Content-Type"] = self.headers.get("Content-Type", "")
        need(message.get_content_type() == "application/json", "content_type",
             "Send this operation as application/json.", 415)
        length = self.body_length(MAX_BYTES)
        raw = self.rfile.read(length)
        need(len(raw) == length, "incomplete_request", "The request ended before its original byte length.")
        value = load_json(raw, limit=MAX_BYTES)
        need(isinstance(value, dict), "request_body", "Send the original action as a JSON object.")
        return value

    def file(self, path, mime, name=None, *, api=False):
        path = Path(path)
        need(path.is_file() and not path.is_symlink(), "file_missing", "The selected original file is unavailable.", 404)
        with path.open("rb") as handle:
            size = os.fstat(handle.fileno()).st_size
            self.send_response(200)
            self.common_headers(api=api)
            self.send_header("Content-Type", mime)
            self.send_header("Content-Length", str(size))
            if name is not None:
                self.send_header("Content-Disposition",
                                 "attachment; filename=\"inventory-download\"; filename*=UTF-8''" + quote(name, safe=""))
            self.end_headers()
            if self.command == "HEAD":
                return
            remaining = size
            while remaining:
                chunk = handle.read(min(1024 * 1024, remaining))
                if not chunk:
                    self.close_connection = True
                    return
                self.wfile.write(chunk)
                remaining -= len(chunk)

    def route(self):
        self.check_origin(mutating=self.command == "POST")
        parsed = urlsplit(self.path)
        need(not parsed.scheme and not parsed.netloc and not parsed.fragment, "request_path",
             "Use a path in this original local workspace.")
        path = unquote(parsed.path, errors="strict")
        parts = path.strip("/").split("/") if path != "/" else []
        query = {}
        for name, value in parse_qsl(parsed.query, keep_blank_values=True, strict_parsing=True):
            need(name not in query, "query", "Use one value per query field.")
            query[name] = value
        if self.command == "GET" and path in ("/", "/index.html", "/assets/app.js", "/assets/style.css"):
            need(not query, "query", "The local application does not use query credentials.")
            asset, mime = {"/": ("index.html", "text/html; charset=utf-8"),
                           "/index.html": ("index.html", "text/html; charset=utf-8"),
                           "/assets/app.js": ("app.js", "text/javascript; charset=utf-8"),
                           "/assets/style.css": ("style.css", "text/css; charset=utf-8")}[path]
            return self.file(self.server.web_root / asset, mime)
        need(parts and parts[0] == "api", "route", "This local route does not exist.", 404)
        self.authenticate()
        desk, actions = self.server.desk, self.server.actions
        if self.command == "GET":
            if parts == ["api", "state"]:
                need(not query, "query", "The workspace state takes no query fields.")
                return self.json(desk.state())
            if parts == ["api", "catalogue"]:
                kind = query.pop("kind", None)
                return self.json(desk.catalogue(kind, query))
            if len(parts) == 3 and parts[:2] == ["api", "actions"]:
                need(not query, "query", "The saved action takes no query fields.")
                return self.json(actions.response(parts[2]))
            if len(parts) >= 3 and parts[:2] == ["api", "projects"]:
                project = parts[2]
                if len(parts) == 3:
                    need(not query, "query", "The project takes no query fields.")
                    return self.json({"project": desk.project(project)})
                if len(parts) in (5, 6) and parts[3] == "uploads":
                    if len(parts) == 6:
                        need(parts[5] == "download" and not query, "route", "Select the original upload download.", 404)
                        item, _ = desk.upload_bytes(project, parts[4])
                        return self.file(desk.project_root(project) / item["file"], "text/csv; charset=utf-8",
                                         item["name"], api=True)
                    need(set(query) <= {"offset", "limit"}, "query", "Use only the original CSV page fields.")
                    return self.json(desk.file_rows(project, parts[4],
                                                   integer(query.get("offset"), 0),
                                                   integer(query.get("limit"), 50, 1, 200)))
                if len(parts) == 5 and parts[3] == "editions":
                    need(not query, "query", "The original edition takes no query fields.")
                    value = desk.edition_detail(project, parts[4])
                    return self.json({"project": desk.project(project), **value,
                                      "actions": actions.list(project, parts[4])})
                if len(parts) == 7 and parts[3] == "editions" and parts[5] == "download":
                    need(not query, "query", "The original output takes no query fields.")
                    original, mime, name = desk.download(project, parts[4], parts[6])
                    return self.file(original, mime, name, api=True)
        if self.command == "POST":
            need(not query, "query", "Keep action decisions in their original request bodies.")
            if parts == ["api", "projects"]:
                return self.json(desk.hydrate(desk.create_project(self.body_json())))
            if len(parts) == 4 and parts[:2] == ["api", "actions"] and parts[3] == "resume":
                return self.json(actions.resume(parts[2], self.body_json()), 202)
            if len(parts) >= 4 and parts[:2] == ["api", "projects"]:
                project = parts[2]
                if len(parts) == 4 and parts[3] in ("uploads", "restore"):
                    maximum = MAX_SOURCE_BYTES if parts[3] == "uploads" else MAX_HANDOVER_UPLOAD
                    length = self.body_length(maximum + MULTIPART_OVERHEAD)
                    incoming = multipart_file(self.rfile, length, self.headers.get("Content-Type", ""),
                                              self.server.temporary_root, maximum)
                    try:
                        if parts[3] == "uploads":
                            result = desk.upload(project, incoming["request_id"], incoming["expected_revision"],
                                                 incoming["name"], incoming["path"].read_bytes())
                        else:
                            result = desk.receive(project, incoming["request_id"], incoming["expected_revision"],
                                                  incoming["name"], incoming["path"])
                        return self.json(desk.hydrate(result))
                    finally:
                        incoming["path"].unlink(missing_ok=True)
                if len(parts) == 4 and parts[3] in ("mapping", "preview", "prepare"):
                    function = {"mapping": desk.save_mapping, "preview": desk.preview,
                                "prepare": desk.prepare_edition}[parts[3]]
                    return self.json(desk.hydrate(function(project, self.body_json())))
                if len(parts) == 6 and parts[3] == "editions" and parts[5] == "actions":
                    return self.json(actions.start(project, parts[4], self.body_json()), 202)
                if len(parts) == 6 and parts[3] == "editions" and parts[5] == "draft":
                    return self.json(desk.hydrate(desk.draft_from_edition(project, parts[4], self.body_json())))
        raise DeskError("route", "This original workspace route does not exist.", 404)

    def handle_route(self):
        try:
            self.route()
        except (BrokenPipeError, ConnectionResetError):
            self.close_connection = True
        except (InventoryError, OSError, ValueError, KeyError, TypeError, csv.Error, zipfile.BadZipFile,
                zipfile.LargeZipFile, NotImplementedError) as exc:
            try:
                self.error(exc)
            except (BrokenPipeError, ConnectionResetError):
                self.close_connection = True

    do_GET = handle_route
    do_POST = handle_route

    def do_OPTIONS(self):
        self.error(DeskError("origin", "This operator serves its same local origin.", 403))

    def do_PUT(self):
        self.error(DeskError("method", "Use the original named workspace action.", 405))

    do_DELETE = do_PUT
    do_PATCH = do_PUT


@dataclass
class RunningDesk:
    server: DeskHTTPServer
    thread: threading.Thread
    desk: Desk
    actions: NativeActions
    url: str
    token: str
    lock_context: object
    closed: bool = False

    def close(self):
        if self.closed:
            return
        self.closed = True
        self.server.shutdown()
        self.thread.join()
        self.server.server_close()
        self.actions.close()
        self.lock_context.__exit__(None, None, None)


def start_desk(directory, config=None, *, port=0, web_root=None, temporary_root=None, wait_seconds=30):
    need(type(port) is int and 0 <= port <= 65535, "port", "Use a local TCP port or zero for automatic selection.")
    directory = Path(directory).expanduser().resolve()
    config = Path(config).expanduser().resolve() if config else directory / "connection.json"
    desk = Desk(directory, config)
    web_root = Path(web_root or HERE / "web").resolve()
    for name in ("index.html", "app.js", "style.css"):
        need((web_root / name).is_file() and not (web_root / name).is_symlink(), "application_source",
             "The complete original customer desk assets are required.", 409)
    selected_temp = Path(temporary_root).expanduser().resolve() if temporary_root else desk.root / "tmp"
    need(selected_temp.is_dir(), "temporary_root", "Select an existing private upload temporary directory.")
    lock_context = workspace_lock(desk.root / ".server")
    lock_context.__enter__()
    actions, server = None, None
    try:
        actions = NativeActions(desk, wait_seconds=wait_seconds)
        server = DeskHTTPServer(("127.0.0.1", port), Handler)
        server.desk, server.actions, server.web_root = desk, actions, web_root
        server.temporary_root = selected_temp
        server.token = secrets.token_urlsafe(32)
        server.authority = "127.0.0.1:" + str(server.server_address[1])
        server.origin = "http://" + server.authority
        thread = threading.Thread(target=server.serve_forever, name="inventory-desk-http", daemon=False)
        thread.start()
        return RunningDesk(server, thread, desk, actions, server.origin, server.token, lock_context)
    except BaseException:
        if server is not None:
            server.server_close()
        if actions is not None:
            actions.close()
        lock_context.__exit__(*sys.exc_info())
        raise


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--directory", required=True, help="Original private customer workspace; reopen the same path.")
    parser.add_argument("--config", help="Original NetBox connection JSON; omission reuses the saved connection.")
    parser.add_argument("--port", type=int, default=0, help="Loopback port, or zero to choose an available local port.")
    parser.add_argument("--temporary-root", help="Existing private directory for bounded multipart upload spools.")
    parser.add_argument("--wait", type=int, default=30, help="Seconds the original native action follows its same job (0–600).")
    args = parser.parse_args()
    running, stop = None, threading.Event()
    try:
        running = start_desk(args.directory, args.config, port=args.port,
                             temporary_root=args.temporary_root, wait_seconds=args.wait)
        def stop_requested(signum, frame):
            stop.set()
        for signum in (signal.SIGINT, signal.SIGTERM):
            signal.signal(signum, stop_requested)
        print(json.dumps({"url": running.url + "/#token=" + running.token,
                          "directory": str(running.desk.root), "connection": running.desk.connection()},
                         ensure_ascii=False), flush=True)
        stop.wait()
        return 0
    except (InventoryError, OSError, ValueError, KeyError, TypeError) as exc:
        print(json.dumps({"error": {"code": getattr(exc, "code", "original_inventory_error"),
                                    "message": str(exc)}}, ensure_ascii=False), file=sys.stderr, flush=True)
        return 2
    finally:
        if running is not None:
            running.close()


if __name__ == "__main__":
    raise SystemExit(main())
