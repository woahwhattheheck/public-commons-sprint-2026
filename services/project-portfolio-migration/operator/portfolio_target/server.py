"""Authenticated local browser over the original portfolio target workspace."""
from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor
import hashlib
import hmac
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import mimetypes
import os
from pathlib import Path
import secrets
import socket
import threading
from urllib.parse import parse_qs, quote, unquote, urlsplit

from .storage import checked_id, file_lock, write_bytes
from .target import TargetError, canonical, digest, public_profile, utcnow
from .workspace import TargetWorkspace

ASSETS = Path(__file__).resolve().parent / "web"
ARCHIVE_ASSETS = Path(__file__).resolve().parents[2] / "archive" / "web"
MAX_JSON = 8 * 1024 * 1024
MAX_SOURCE = 256 * 1024 * 1024
MAX_ARCHIVE = 8 * 1024 ** 3


class Desk:
    def __init__(self, workspace, *, host="127.0.0.1", port=0, token=None):
        if host not in ("127.0.0.1", "::1", "localhost"):
            raise TargetError("LOCAL_HOST", "Bind the operator desk to a local loopback address.")
        self.workspace = workspace
        self.token = token or secrets.token_urlsafe(32)
        self.executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="portfolio-target")
        self.futures = {}
        self.guard = threading.RLock()
        self.closed = False
        class LocalServer(ThreadingHTTPServer):
            address_family = socket.AF_INET6 if host == "::1" else socket.AF_INET
        self.server = LocalServer((host, int(port)), self._handler())
        self.server.daemon_threads = True
        actual_host, actual_port = self.server.server_address[:2]
        printable = "[" + actual_host + "]" if ":" in actual_host else actual_host
        self.origin = "http://" + printable + ":" + str(actual_port)
        self.allowed_host = printable + ":" + str(actual_port)
        self.workspace_id = self._workspace_identity()

    def _workspace_identity(self):
        path = self.workspace.store.root / "workspace.json"
        with self.workspace.store.locked():
            if path.exists():
                value = json.loads(path.read_text(encoding="utf-8"))
                checked_id(value["id"])
                return value["id"]
            identity = hashlib.sha256(secrets.token_bytes(32)).hexdigest()
            write_bytes(path, canonical({"schema": "portfolio.operator-workspace-id.v1",
                                         "id": identity, "created_at": utcnow()}), immutable=True)
            return identity

    def submit(self, request_id, kind, arguments, *, retry_failed=False):
        with self.guard:
            if self.closed:
                raise TargetError("OPERATOR_CLOSING", "The operator is closing; reopen the original saved request on the next host.")
        request = self.workspace.request(request_id, kind, arguments, retry_failed=retry_failed)
        with self.guard:
            if self.closed:
                return request
            future = self.futures.get(request_id)
            if request["state"] not in ("COMPLETE", "FAILED"):
                if future is None or future.done():
                    self.futures[request_id] = self.executor.submit(self.workspace.run, request_id)
                else:
                    def resume_queued(previous):
                        with self.guard:
                            if self.closed or self.futures.get(request_id) is not previous:
                                return
                            current = self.workspace.store.index("requests", request_id)
                            if current["state"] == "QUEUED":
                                self.futures[request_id] = self.executor.submit(self.workspace.run, request_id)
                    future.add_done_callback(resume_queued)
        return request

    def stop_requests(self):
        with self.guard:
            self.closed = True
            self.workspace.closing.set()

    def close(self):
        self.stop_requests()
        self.server.shutdown()
        self.server.server_close()
        # The current native response is retained. Later native dispatch checks
        # the closed flag even when a durable pause write cannot be made.
        self.executor.shutdown(wait=True, cancel_futures=False)

    def _handler(self):
        desk = self

        class Handler(BaseHTTPRequestHandler):
            protocol_version = "HTTP/1.1"

            def log_message(self, format, *args):
                return

            def _headers(self, status, size, media_type, *, extra=None):
                self.send_response(status)
                self.send_header("Content-Type", media_type)
                self.send_header("Content-Length", str(size))
                self.send_header("Cache-Control", "no-store")
                self.send_header("X-Content-Type-Options", "nosniff")
                self.send_header("Referrer-Policy", "no-referrer")
                self.send_header("Content-Security-Policy",
                    "default-src 'self'; script-src 'self'; style-src 'self'; "
                    "connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; "
                    "base-uri 'none'; form-action 'self'")
                for key, value in (extra or {}).items():
                    self.send_header(key, value)
                self.end_headers()

            def _json(self, status, value):
                raw = canonical(value)
                self._headers(status, len(raw), "application/json; charset=utf-8")
                self.wfile.write(raw)

            def _auth(self, *, mutate=False):
                if self.headers.get("Host") != desk.allowed_host:
                    raise TargetError("HTTP_HOST", "Open the exact local operator address.")
                value = self.headers.get("Authorization", "")
                if not hmac.compare_digest(value, "Bearer " + desk.token):
                    raise TargetError("HTTP_AUTH", "Open the current local operator link to sign in.")
                if mutate and self.headers.get("Origin") != desk.origin:
                    raise TargetError("HTTP_ORIGIN", "The request must come from the selected local operator.")
                if self.headers.get("Transfer-Encoding"):
                    raise TargetError("HTTP_LENGTH", "Send a complete selected request with Content-Length.")

            def _length(self, maximum):
                try:
                    length = int(self.headers.get("Content-Length", "-1"))
                except ValueError as exc:
                    raise TargetError("HTTP_LENGTH", "Expected an exact Content-Length.") from exc
                if not 0 <= length <= maximum:
                    raise TargetError("HTTP_LENGTH", "The selected request exceeds this operation's size limit.")
                return length

            def _body(self):
                length = self._length(MAX_JSON)
                if self.headers.get("Content-Type", "").split(";", 1)[0].strip() != "application/json":
                    raise TargetError("HTTP_CONTENT_TYPE", "Expected a JSON action.")
                raw = self.rfile.read(length)
                if len(raw) != length:
                    raise TargetError("HTTP_INCOMPLETE", "The original request body ended early.")
                try:
                    body = json.loads(raw.decode("utf-8"))
                except (UnicodeError, json.JSONDecodeError) as exc:
                    raise TargetError("HTTP_JSON", "The action body is not complete JSON.") from exc
                if not isinstance(body, dict):
                    raise TargetError("HTTP_JSON", "The action body must be an object.")
                return body

            def _failure(self, exc):
                code = getattr(exc, "code", type(exc).__name__)
                status = 401 if code == "HTTP_AUTH" else 403 if code in (
                    "HTTP_HOST", "HTTP_ORIGIN") else 404 if code in (
                    "OPERATOR_NOT_FOUND", "HTTP_NOT_FOUND") else 409 if code in (
                    "STALE_REVISION", "REQUEST_REUSED", "TARGET_REVIEW_CHANGED",
                    "ACCEPTANCE_REVISION") else 422 if isinstance(exc, (TargetError, ValueError, KeyError)) else 500
                try:
                    self._json(status, {"error": {"code": code, "message": str(exc)}})
                except (BrokenPipeError, ConnectionResetError):
                    pass

            def do_GET(self):
                try:
                    selected = urlsplit(self.path)
                    if selected.fragment:
                        raise TargetError("HTTP_PATH", "Invalid local path.")
                    path = selected.path
                    if path in ("/", "/assets/app.js", "/assets/style.css", "/assets/archive.js", "/assets/companions.js", "/assets/timephased.js"):
                        if self.headers.get("Host") != desk.allowed_host:
                            raise TargetError("HTTP_HOST", "Open the exact local operator address.")
                        filename = {"/": "index.html", "/assets/app.js": "app.js",
                                    "/assets/style.css": "style.css", "/assets/archive.js": "archive.js",
                                    "/assets/companions.js": "companions.js", "/assets/timephased.js": "timephased.js"}[path]
                        raw = ((ARCHIVE_ASSETS if filename in ("archive.js", "companions.js", "timephased.js") else ASSETS) / filename).read_bytes()
                        media = {"index.html": "text/html", "app.js": "text/javascript",
                                 "style.css": "text/css", "archive.js": "text/javascript", "companions.js": "text/javascript", "timephased.js": "text/javascript"}[filename] + "; charset=utf-8"
                        self._headers(200, len(raw), media)
                        self.wfile.write(raw)
                        return
                    self._auth()
                    query = parse_qs(selected.query, keep_blank_values=True)
                    one = lambda key, default="": query.get(key, [default])[0]
                    if path == "/api/hello":
                        self._json(200, {"schema": "portfolio.operator-hello.v1",
                            "workspace_id": desk.workspace_id,
                            "profiles": [public_profile(p) for p in desk.workspace.profiles.values()]})
                    elif path == "/api/state":
                        self._json(200, desk.workspace.state(cursor=one("cursor"), limit=int(one("limit", "25"))))
                    elif path.startswith("/api/source-reviews/"):
                        identity = checked_id(path.removeprefix("/api/source-reviews/"))
                        self._json(200, desk.workspace.portfolio.read_review(identity))
                    elif path == "/api/cohorts":
                        self._json(200, desk.workspace.archives.list(cursor=one("cursor"), limit=int(one("limit", "25"))))
                    elif path.startswith("/api/cohorts/"):
                        self._json(200, desk.workspace.archives.read(checked_id(path.removeprefix("/api/cohorts/"))))
                    elif path == "/api/archive-fields":
                        self._json(200, desk.workspace.archives.fields(one("editions").split(",")))
                    elif path == "/api/archive-table":
                        self._json(200, desk.workspace.archives.table(
                            checked_id(one("cohort_id")), checked_id(one("publication_id")), one("table"),
                            offset=int(one("offset", "0")), limit=int(one("limit", "50")),
                            filter_column=one("filter_column") or None, filter_text=one("filter_text")))
                    elif path == "/api/companion-sources":
                        edition = desk.workspace.portfolio.read_edition(checked_id(one("edition_id")))
                        captures = edition["model"].get("companions", [])
                        self._json(200, {"edition_id": edition["id"], "items": edition.get("companion_captures", [
                            {"ordinal": ordinal, **{key: capture.get(key) for key in
                                ("source_id", "label", "role", "format", "profile", "columns", "row_count", "findings")}}
                            for ordinal, capture in enumerate(captures)])})
                    elif path == "/api/companion-capture":
                        edition = desk.workspace.portfolio.read_edition(checked_id(one("edition_id")))
                        captures = edition["model"].get("companions", [])
                        ordinal, offset, limit = int(one("ordinal", "0")), int(one("offset", "0")), int(one("limit", "25"))
                        if not 0 <= ordinal < len(captures) or offset < 0 or not 1 <= limit <= 250:
                            raise TargetError("COMPANION_PAGE", "Choose one captured companion and its actual row page.")
                        capture = captures[ordinal]
                        selector = next((item for item in edition.get("companion_captures", []) if item["ordinal"] == ordinal), {})
                        self._json(200, {"edition_id": edition["id"], "ordinal": ordinal,
                            **{key: selector[key] for key in ("capture_id", "profile_sha256") if key in selector},
                            **{key: value for key, value in capture.items() if key != "rows"},
                            "rows": capture["rows"][offset:offset + limit], "offset": offset,
                            "next_offset": offset + limit if offset + limit < len(capture["rows"]) else None})
                    elif path == "/api/source-field-catalogue":
                        edition = desk.workspace.portfolio.read_edition(checked_id(one("edition_id")))
                        family = one("family", "tasks")
                        if family not in ("project", "tasks", "resources", "assignments"):
                            raise TargetError("SOURCE_FAMILY", "Select the original native field family.")
                        self._json(200, {"edition_id": edition["id"], "family": family,
                            "fields": edition["model"].get("field_catalogue", {}).get(family, {})})
                    elif path == "/api/editions":
                        self._json(200, desk.workspace.portfolio.list_editions(
                            cursor=one("cursor"), limit=int(one("limit", "25"))))
                    elif path.startswith("/api/editions/"):
                        edition_id = checked_id(path.removeprefix("/api/editions/"))
                        edition = desk.workspace.portfolio.read_edition(edition_id)
                        family = one("family")
                        if family:
                            if family not in ("tasks", "resources", "assignments", "dependencies", "calendars"):
                                raise TargetError("SOURCE_FAMILY", "Select an original row family.")
                            offset, limit = int(one("offset", "0")), int(one("limit", "50"))
                            if offset < 0 or not 1 <= limit <= 250:
                                raise TargetError("SOURCE_PAGE", "Invalid original source page.")
                            rows = edition["model"][family]
                            self._json(200, {"edition_id": edition_id, "family": family,
                                "total": len(rows), "offset": offset, "items": rows[offset:offset + limit],
                                "next_offset": offset + limit if offset + limit < len(rows) else None})
                        else:
                            model = edition["model"]
                            self._json(200, {k: v for k, v in edition.items() if k != "model"} | {
                                "model": {"schema": model["schema"], "project": model["project"],
                                          "counts": {name: len(model.get(name, [])) for name in (
                                              "tasks", "resources", "assignments", "dependencies", "calendars")}}})
                    elif path.startswith("/api/deployments/"):
                        self._json(200, desk.workspace.deployment(checked_id(path.removeprefix("/api/deployments/"))))
                    elif path == "/api/requests":
                        self._json(200, desk.workspace.store.list("requests", cursor=one("cursor"), limit=int(one("limit", "25"))))
                    elif path.startswith("/api/requests/"):
                        self._json(200, desk.workspace.request_result(checked_id(path.removeprefix("/api/requests/"))))
                    elif path.startswith("/api/objects/"):
                        identity = checked_id(path.removeprefix("/api/objects/"))
                        self._json(200, desk.workspace.store.read(identity))
                    elif path.startswith("/api/archives/"):
                        identity = checked_id(path.removeprefix("/api/archives/"))
                        request = desk.workspace.request_result(identity)
                        archive = (request.get("result") or {}).get("archive", {})
                        if archive.get("kind") != "workspace_archive" or archive.get("request_id") != identity:
                            raise TargetError("HTTP_NOT_FOUND", "The original complete workspace archive is unavailable.")
                        selected = Path(archive["path"]).resolve(strict=True)
                        expected = desk.workspace.root.parent / (desk.workspace.root.name + "-operator-deliveries") / (identity + ".portfolio.zip")
                        if selected != expected.resolve(strict=True):
                            raise TargetError("ARCHIVE_LOCATION", "Receive the original archive from its saved output location.")
                        hasher, count = hashlib.sha256(), 0
                        with open(selected, "rb") as original:
                            for chunk in iter(lambda: original.read(1024 * 1024), b""):
                                hasher.update(chunk)
                                count += len(chunk)
                            if hasher.hexdigest() != archive["sha256"] or count != archive["bytes"]:
                                raise TargetError("ARCHIVE_CHANGED", "The original archive differs from its saved result.")
                            original.seek(0)
                            self._headers(200, count, "application/zip", extra={
                                "Content-Disposition": "attachment; filename*=UTF-8''" + quote(selected.name, safe="")})
                            for chunk in iter(lambda: original.read(1024 * 1024), b""):
                                self.wfile.write(chunk)
                    elif path.startswith("/api/download/"):
                        identity = checked_id(path.removeprefix("/api/download/"))
                        filename = one("filename", "portfolio-artifact.bin")
                        if not filename or len(filename) > 240 or any(c in filename for c in ("/", "\\", "\0", "\r", "\n")):
                            raise TargetError("DOWNLOAD_FILENAME", "Choose the saved artifact's base filename.")
                        from portfolio.storage import open_regular
                        selected = desk.workspace.store.root / "objects" / identity
                        with open_regular(selected) as original:
                            hasher, count = hashlib.sha256(), 0
                            for chunk in iter(lambda: original.read(1024 * 1024), b""):
                                hasher.update(chunk)
                                count += len(chunk)
                            if hasher.hexdigest() != identity:
                                raise TargetError("OBJECT_HASH", "The original complete artifact changed.")
                            original.seek(0)
                            self._headers(200, count, "application/octet-stream",
                                extra={"Content-Disposition": "attachment; filename*=UTF-8''" + quote(filename, safe="")})
                            for chunk in iter(lambda: original.read(1024 * 1024), b""):
                                self.wfile.write(chunk)
                    else:
                        raise TargetError("HTTP_NOT_FOUND", "The selected local item does not exist.")
                except Exception as exc:
                    self._failure(exc)

            def do_POST(self):
                try:
                    self.connection.settimeout(120)
                    self._auth(mutate=True)
                    path = urlsplit(self.path).path
                    if path in ("/api/upload", "/api/archive-upload"):
                        filename = unquote(self.headers.get("X-Source-Name", ""))
                        result = desk.workspace.store.upload_stream(self.rfile, self._length(MAX_ARCHIVE if path == "/api/archive-upload" else MAX_SOURCE), filename)
                        self._json(201, result)
                        return
                    body = self._body()
                    if path == "/api/archive-query":
                        if set(body) - {"cohort_id", "publication_id", "sql", "parameters", "limit"}:
                            raise TargetError("ARCHIVE_QUERY", "Use the selected publication and original read-only SQL.")
                        self._json(200, desk.workspace.archives.query(body["cohort_id"], body["publication_id"],
                            body["sql"], body.get("parameters"), limit=body.get("limit", 100)))
                    elif path == "/api/actions":
                        if set(body) != {"request_id", "kind", "arguments"}:
                            raise TargetError("HTTP_ACTION", "Send the exact saved action ID, kind and arguments.")
                        self._json(202, desk.submit(body["request_id"], body["kind"], body["arguments"]))
                    elif path.startswith("/api/requests/") and path.endswith("/resume"):
                        identity = checked_id(path[len("/api/requests/"):-len("/resume")])
                        saved = desk.workspace.store.index("requests", identity)
                        self._json(202, desk.submit(identity, saved["kind"], saved["arguments"], retry_failed=body.get("retry_failed") is True))
                    elif path.startswith("/api/deployments/") and path.endswith("/pause"):
                        identity = checked_id(path[len("/api/deployments/"):-len("/pause")])
                        desk.workspace.store.index("deployments", identity)
                        request_id = checked_id(body["request_id"])
                        self._json(200, desk.workspace.store.control(identity, request_id, pause=True))
                    else:
                        raise TargetError("HTTP_NOT_FOUND", "The selected local action does not exist.")
                except Exception as exc:
                    self._failure(exc)

        return Handler


def start_desk(directory, *, profile_config=None, native=None, host="127.0.0.1", port=0, token=None):
    workspace = TargetWorkspace(directory, profile_config=profile_config, native=native)
    return Desk(workspace, host=host, port=port, token=token)


def main(argv=None):
    parser = argparse.ArgumentParser(description="Open the original portfolio migration target workspace.")
    parser.add_argument("--workspace", required=True)
    parser.add_argument("--profiles", help="Private target configuration outside the workspace.")
    parser.add_argument("--port", type=int, default=8857)
    parser.add_argument("--entry-file", help="Write the private local browser URL here.")
    args = parser.parse_args(argv)
    desk = start_desk(args.workspace, profile_config=args.profiles, port=args.port)
    entry = {"schema": "portfolio.operator-entry.v1", "url": desk.origin + "/#token=" + desk.token,
             "origin": desk.origin, "workspace_id": desk.workspace_id}
    if args.entry_file:
        write_bytes(Path(args.entry_file), canonical(entry))
        print(json.dumps({"state": "READY", "entry_file": str(Path(args.entry_file).resolve()),
                          "workspace_id": desk.workspace_id}), flush=True)
    else:
        print(entry["url"], flush=True)
    try:
        desk.server.serve_forever(poll_interval=0.25)
    except KeyboardInterrupt:
        pass
    finally:
        desk.stop_requests()
        desk.server.server_close()
        desk.executor.shutdown(wait=True, cancel_futures=False)


if __name__ == "__main__":
    main()
