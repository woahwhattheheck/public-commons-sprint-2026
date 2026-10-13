#!/usr/bin/env python3
"""Local industrial interface for the original migration operating workspace."""
from __future__ import annotations

import argparse
import csv
import io
import json
import mimetypes
from pathlib import Path
import re
import socket
import tempfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, quote, urlsplit
import uuid

from migration_workspace import MigrationWorkspace, MigrationError
import financial_workspace
import property_workspace
from migration_portable import PortableService

READS = {
    "schema", "state", "source.get", "source.rows", "row.get", "round.get",
    "mapping.get", "mapping.rows", "reconciliation.get", "reconciliation.items",
    "reconciliation.compare", "correction.get", "operation.get", "events",
    "evidence_link.get", "evidence_link.list", "entity.list", "source.list", "round.list",
    "mapping.list", "reconciliation.list", "correction.list", "correction.history",
    "delivery.get", "delivery.list",
    "case.schema", "case.dataset.preview", "case.dataset.get", "case.dataset.rows",
    "case.plan.get", "case.plan.items", "case.rehearsal.get", "case.rehearsal.items",
    "case.rehearsal.compare", "case.review.get", "case.cutover.get", "case.list",
}
READS.update(financial_workspace.READS)
READS.update(property_workspace.READS)
STATIC = {
    "/property": ("public/property.html", "text/html; charset=utf-8"),
    "/property.js": ("public/property.js", "text/javascript; charset=utf-8"),
    "/property.css": ("public/property.css", "text/css; charset=utf-8"),
    "/financial": ("public/financial.html", "text/html; charset=utf-8"),
    "/financial.js": ("public/financial.js", "text/javascript; charset=utf-8"),
    "/financial.css": ("public/financial.css", "text/css; charset=utf-8"),
    "/": ("public/migration-index.html", "text/html; charset=utf-8"),
    "/migration-style.css": ("public/migration-style.css", "text/css; charset=utf-8"),
    "/migration-app.js": ("public/migration-app.js", "text/javascript; charset=utf-8"),
    "/migration-cases.js": ("public/migration-cases.js", "text/javascript; charset=utf-8"),
}
HASH = re.compile(r"^[0-9a-f]{64}$")
MAX_COMMAND = 2 * 1024 * 1024
BLOCK = 1024 * 1024


class DeclaredBody:
    def __init__(self, source, size):
        self.source, self.remaining = source, size

    def read(self, size=-1):
        if self.remaining == 0:
            return b""
        size = self.remaining if size is None or size < 0 else min(size, self.remaining)
        value = self.source.read(size)
        if not value:
            raise ValueError("The upload ended before its declared complete length")
        self.remaining -= len(value)
        return value


class WorkbenchHTTPServer(ThreadingHTTPServer):
    daemon_threads = False
    block_on_close = True

    def __init__(self, address, workspace, source_root):
        self.workspace = workspace
        self.source_root = Path(source_root)
        self.portable = PortableService(workspace, workspace.root, self.source_root)
        super().__init__(address, WorkbenchHandler)


class WorkbenchHandler(BaseHTTPRequestHandler):
    server_version = "MigrationWorkbench/1"
    sys_version = ""
    protocol_version = "HTTP/1.0"

    def log_message(self, pattern, *values):
        # Keep source names, item paths and request payloads out of access logs.
        return

    def _headers(self, status, content_type, length, *, filename=None):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(length))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Content-Security-Policy",
                         "default-src 'self'; script-src 'self'; style-src 'self'; "
                         "img-src 'self' data:; connect-src 'self'; "
                         "object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'")
        if filename:
            self.send_header("Content-Disposition", "attachment; filename*=UTF-8''" + quote(filename, safe=""))
        self.end_headers()

    def _json(self, status, value):
        data = json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        self._headers(status, "application/json; charset=utf-8", len(data))
        self.wfile.write(data)

    def _body_length(self, maximum=None):
        values = self.headers.get_all("Content-Length", [])
        if len(values) != 1 or not values[0].isdigit() or self.headers.get("Transfer-Encoding"):
            raise ValueError("Use one declared complete Content-Length")
        size = int(values[0])
        if maximum is not None and size > maximum:
            raise ValueError("Use streamed file intake for bulk records")
        return size

    def _same_origin(self):
        origin = self.headers.get("Origin")
        if origin:
            parsed = urlsplit(origin)
            if parsed.scheme not in ("http", "https") or parsed.netloc != self.headers.get("Host"):
                raise PermissionError("Open this workbench directly before making a change")
        fetch_site = self.headers.get("Sec-Fetch-Site")
        if fetch_site == "cross-site":
            raise PermissionError("Cross-site workspace changes are not accepted")

    def _command(self):
        if self.headers.get_content_type() != "application/json":
            raise ValueError("A workspace command must be JSON")
        length = self._body_length(MAX_COMMAND)
        raw = DeclaredBody(self.rfile, length).read()
        value = json.loads(raw)
        if not isinstance(value, dict) or not isinstance(value.get("operation"), str):
            raise ValueError("Choose an original workspace operation")
        payload = value.get("payload", {})
        if not isinstance(payload, dict):
            raise ValueError("Operation fields must be an object")
        return value["operation"], payload

    def _error(self, error):
        if isinstance(error, (BrokenPipeError, ConnectionResetError)):
            return
        if isinstance(error, MigrationError):
            body = error.as_dict()
            code = body.get("code", "")
            status = (409 if code in {"REVISION_CONFLICT", "OPERATION_ID_REUSED", "OPERATION_REQUIRES_RESUME",
                                     "WORKSPACE_BUSY", "IMMUTABLE_ENTITY"} else
                      404 if code.endswith("NOT_FOUND") else 422)
        elif isinstance(error, PermissionError):
            status, body = 403, {"code": "ORIGIN", "message": str(error)}
        elif isinstance(error, (ValueError, KeyError, json.JSONDecodeError, UnicodeError, csv.Error)):
            status, body = 422, {"code": type(error).__name__, "message": str(error)}
        elif isinstance(error, OSError):
            status, body = 507, {"code": type(error).__name__, "message": str(error)}
        else:
            status, body = 500, {"code": type(error).__name__, "message": str(error)}
        try:
            self._json(status, {"error": body})
        except (BrokenPipeError, ConnectionResetError):
            pass

    def do_GET(self):
        try:
            parsed = urlsplit(self.path)
            path = parsed.path
            query = parse_qs(parsed.query)
            if path in STATIC:
                relative, content_type = STATIC[path]
                target = self.server.source_root / relative
                if target.is_symlink() or not target.is_file():
                    raise FileNotFoundError("Complete application asset is missing")
                with target.open("rb") as stream:
                    data = stream.read()
                self._headers(200, content_type, len(data))
                self.wfile.write(data)
                return
            if path == "/api/state":
                self._json(200, self.server.workspace.dispatch("state", {}))
                return
            if path == "/api/schema":
                self._json(200, self.server.workspace.dispatch("schema", {}))
                return
            if path == "/api/file-preview":
                sha = query.get("sha256", [""])[0]
                if not HASH.fullmatch(sha):
                    raise ValueError("Choose a retained source file")
                with self.server.workspace.open_file(sha) as stream:
                    raw = stream.read(256 * 1024 + 1)
                truncated = len(raw) > 256 * 1024
                raw = raw[:256 * 1024]
                encoding = query.get("encoding", ["utf-8-sig"])[0]
                if encoding not in ("utf-8", "utf-8-sig", "utf-16", "utf-16-le", "utf-16-be"):
                    raise ValueError("Choose a supported source text encoding")
                decoded = raw.decode(encoding, errors="replace")
                rows = []
                delimiter = query.get("delimiter", [","])[0]
                if delimiter not in (",", ";", "\t", "|"):
                    raise ValueError("Choose comma, semicolon, tab or pipe CSV delimiter")
                reader = csv.reader(io.StringIO(decoded, newline=""), delimiter=delimiter)
                for i, row in enumerate(reader):
                    if i >= 6:
                        break
                    rows.append(row)
                self._json(200, {"sha256": sha, "headers": rows[0] if rows else [],
                                 "sample_rows": rows[1:], "truncated": truncated,
                                 "purpose": "Header selection preview; original import parses the full retained bytes"})
                return
            if path == "/api/exports":
                kind = query.get("kind", [""])[0]
                identifier = query.get("id", [""])[0]
                format_name = query.get("format", ["ndjson"])[0]
                if kind not in {"case.dataset", "case.plan", "case.rehearsal", "case.review", "case.cutover"} | set(financial_workspace.KINDS) | set(property_workspace.KINDS):
                    raise ValueError("Choose a complete case migration export")
                if format_name not in {"ndjson", "csv"}:
                    raise ValueError("Choose NDJSON or CSV")
                # Finish the retained generator before sending headers. Its mutex
                # binds the complete export to the original immutable selection.
                with tempfile.TemporaryFile(mode="w+b") as output:
                    for chunk in self.server.workspace.iter_export(kind, identifier, format=format_name):
                        output.write(chunk)
                    length = output.tell()
                    output.seek(0)
                    self._headers(200, "text/csv; charset=utf-8" if format_name == "csv" else "application/x-ndjson; charset=utf-8",
                                  length, filename=kind + "-" + identifier + "." + format_name)
                    while part := output.read(BLOCK):
                        self.wfile.write(part)
                return
            if path.startswith("/api/files/"):
                sha = path[len("/api/files/"):]
                if not HASH.fullmatch(sha):
                    raise ValueError("Choose a retained source file")
                info = self.server.workspace.file_info(sha)
                filename = query.get("filename", [sha])[0]
                with self.server.workspace.open_file(sha) as stream:
                    self._headers(200, "application/octet-stream", info["bytes"], filename=filename)
                    while part := stream.read(BLOCK):
                        self.wfile.write(part)
                return
            if path.startswith("/api/deliveries/"):
                identifier = path[len("/api/deliveries/"):]
                record, stream = self.server.portable.open_delivery(identifier)
                with stream:
                    self._headers(200, "application/zip", record["archive_bytes"], filename=record["filename"])
                    while part := stream.read(BLOCK):
                        self.wfile.write(part)
                return
            self._json(404, {"error": {"code": "NOT_FOUND", "message": "Workbench route not found"}})
        except Exception as error:
            self._error(error)

    def do_POST(self):
        try:
            self._same_origin()
            parsed = urlsplit(self.path)
            if parsed.path == "/api/files":
                size = self._body_length()
                filename = parse_qs(parsed.query).get("filename", [""])[0]
                original = self.server.workspace.stage_file(DeclaredBody(self.rfile, size), filename,
                                                            expected_bytes=size)
                self._json(201, original)
                return
            if parsed.path not in ("/api/read", "/api/operations"):
                self._json(404, {"error": {"code": "NOT_FOUND", "message": "Workbench route not found"}})
                return
            operation, payload = self._command()
            if parsed.path == "/api/read":
                if operation not in READS:
                    raise ValueError("Choose a supported read operation")
                result = self.server.workspace.dispatch(operation, payload)
            else:
                result = self.server.workspace.dispatch(operation, payload)
            self._json(200, result)
        except Exception as error:
            self._error(error)


def serve(workspace, *, host="127.0.0.1", port=8083, source_root=None):
    source_root = Path(source_root) if source_root is not None else Path(__file__).parent
    server = WorkbenchHTTPServer((host, port), workspace, source_root)
    actual_host, actual_port = server.server_address[:2]
    print(json.dumps({"event": "migration_workbench_ready", "workspace_id": workspace.project["id"],
                      "revision": workspace.project["revision"],
                      "url": "http://" + actual_host + ":" + str(actual_port)}, ensure_ascii=False), flush=True)
    try:
        server.serve_forever(poll_interval=0.25)
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", required=True, help="Original editable workspace directory")
    parser.add_argument("--create", action="store_true", help="Create a genuinely new workspace")
    parser.add_argument("--title", default="Migration workbench")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8083)
    args = parser.parse_args()
    with MigrationWorkspace(args.workspace, create=args.create, title=args.title) as workspace:
        serve(workspace, host=args.host, port=args.port)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
