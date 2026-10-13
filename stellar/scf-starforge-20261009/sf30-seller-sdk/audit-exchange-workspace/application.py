"""Audit Exchange local application server and complete native command interface."""
from __future__ import annotations
import argparse
import ipaddress
import json
import mimetypes
import signal
import sys
import threading
import traceback
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import quote, urlsplit

from common import AuditError, canonical, require
from exchange import APPLICATION_ROOT
from workspace import Workspace

STARTUP_SCHEMA = "commons.audit-exchange.startup.v1"
MAX_REQUEST_BYTES = 1431658000
_asset_manifest = json.loads((APPLICATION_ROOT / "browser-assets.json").read_text("utf-8"))
require(_asset_manifest.get("schema") == "stellar-forge.browser-assets.v1" and _asset_manifest.get("root") == "./",
        "application_assets", "The original application route manifest differs")
STATIC = {}
for _route, (_file, _mime) in _asset_manifest["routes"]:
    require(_route.startswith("/") and _route not in STATIC and not Path(_file).is_absolute()
            and ".." not in Path(_file).parts, "application_assets", "The original browser route is invalid")
    STATIC[_route] = (_file, _mime)

def error_response(error, workspace=None):
    known = isinstance(error, AuditError)
    result = {"ok": False, "error": {
        "code": error.code if known else "application_error",
        "message": str(error) if known else "The native application could not complete this request; inspect its server log."}}
    if known and error.details is not None:
        result["error"]["details"] = error.details
    if workspace:
        try:
            result["stateVersion"] = workspace.state()["version"]
        except Exception:
            pass
    return result, error.status if known else 500

def parse_json(raw):
    try:
        result = json.loads(raw)
    except (ValueError, UnicodeError) as error:
        raise AuditError("invalid_json", "The complete request must contain valid JSON") from error
    require(isinstance(result, dict), "invalid_request", "The complete native request must be a JSON object")
    return result

def check_identity(workspace, expected):
    identity = workspace.state()["workspaceId"]
    if expected is not None:
        require(expected == identity, "workspace_identity", "The selected original workspace identity differs",
                {"workspaceId": identity}, 409)
    return identity

class AuditServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = False

    def __init__(self, address, workspace):
        self.workspace = workspace
        self.identity = workspace.state()
        self.instance_id = str(uuid.uuid4())
        super().__init__(address, AuditHandler)
        self.url = "http://127.0.0.1:" + str(self.server_port) + "/"
        self.startup = {
            "schema": STARTUP_SCHEMA, "url": self.url, "workspaceId": self.identity["workspaceId"],
            "workspaceCreatedAt": self.identity["createdAt"], "instanceId": self.instance_id,
            "directory": str(workspace.directory)}

class AuditHandler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "AuditExchange/1.0"
    sys_version = ""

    def setup(self):
        super().setup()
        self.connection.settimeout(60)

    @property
    def workspace(self):
        return self.server.workspace

    def log_message(self, format, *args):
        sys.stderr.write("%s %s\n" % (self.log_date_time_string(), format % args))

    def _same_origin(self):
        expected = "127.0.0.1:" + str(self.server.server_port)
        require(self.headers.get("Host") == expected, "local_host",
                "Use the exact local application address announced by the server", status=403)
        origin = self.headers.get("Origin")
        require(origin is None or origin == "http://" + expected, "local_origin",
                "An application request must originate from its own local workspace", status=403)
        require(self.headers.get("Sec-Fetch-Site") not in {"cross-site"},
                "local_origin", "Open the original local application address", status=403)

    def _identity(self):
        value = self.headers.get("X-Audit-Workspace-Id")
        require(value == self.server.identity["workspaceId"], "workspace_identity",
                "The request must name this original workspace identity",
                {"workspaceId": self.server.identity["workspaceId"]}, 409)
        instance = self.headers.get("X-Audit-Instance-Id")
        require(instance is None or instance == self.server.instance_id, "instance_changed",
                "The original application instance changed; inspect and deliberately reconnect", status=409)

    def _respond(self, status, raw, mime, additional=None, head=False):
        self.send_response(status)
        self.send_header("Content-Type", mime)
        self.send_header("Content-Length", str(len(raw)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Cross-Origin-Resource-Policy", "same-origin")
        self.send_header("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'")
        for name, value in (additional or {}).items():
            self.send_header(name, value)
        self.end_headers()
        if not head:
            self.wfile.write(raw)

    def _json(self, status, value, head=False):
        self._respond(status, (canonical(value) + "\n").encode("utf-8"), "application/json; charset=utf-8", head=head)

    def _failure(self, error):
        self.close_connection = True
        if not isinstance(error, AuditError):
            traceback.print_exc(file=sys.stderr)
        value, status = error_response(error, self.workspace)
        try:
            self._json(status, value)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def do_HEAD(self):
        self.do_GET(head=True)

    def do_GET(self, head=False):
        try:
            self._same_origin()
            parsed = urlsplit(self.path)
            require(not parsed.scheme and not parsed.netloc and not parsed.query and not parsed.fragment,
                    "request_path", "Use the original application route", status=404)
            path = parsed.path
            if path == "/api/state":
                self._json(200, {"ok": True, "result": self.workspace.state()}, head)
            elif path == "/api/identity":
                self._identity()
                self._json(200, self.server.startup, head)
            elif path.startswith("/api/download/"):
                self._identity()
                identity = path[len("/api/download/"):]
                require(identity and "/" not in identity and "%" not in identity, "download_id", "Select one complete export", status=404)
                record, raw = self.workspace.download(identity)
                mime = record.get("mime") or mimetypes.guess_type(record["name"])[0] or "application/octet-stream"
                require("\r" not in mime and "\n" not in mime, "download_mime", "The retained download media type is invalid")
                self._respond(200, raw, mime, {
                    "Content-Disposition": "attachment; filename*=UTF-8''" + quote(record["name"], safe=""),
                    "ETag": '"' + record["sha256"] + '"',
                    "X-Audit-SHA256": record["sha256"],
                    "X-Audit-Workspace-Id": self.server.identity["workspaceId"]}, head)
            elif path in STATIC:
                relative, mime = STATIC[path]
                target = APPLICATION_ROOT / relative
                require(target.is_file() and not target.is_symlink(), "application_file", "This original application file is absent", status=404)
                self._respond(200, target.read_bytes(), mime, head=head)
            else:
                raise AuditError("not_found", "This application route does not exist", status=404)
        except Exception as error:
            self._failure(error)

    def do_POST(self):
        try:
            self._same_origin()
            self._identity()
            require(self.path == "/api/action", "not_found", "This native action route does not exist", status=404)
            require(self.headers.get("Content-Type", "").split(";", 1)[0].strip().lower() == "application/json",
                    "request_media_type", "A native action uses application/json", status=415)
            require(self.headers.get("Transfer-Encoding") is None, "request_length", "Supply the complete request length")
            lengths = self.headers.get_all("Content-Length") or []
            require(len(lengths) == 1 and lengths[0].isdigit(), "request_length", "Supply one complete request length")
            count = int(lengths[0])
            require(0 < count <= MAX_REQUEST_BYTES, "input_too_large", "The complete request exceeds the local application's configured capacity", status=413)
            raw = self.rfile.read(count)
            require(len(raw) == count, "incomplete_request", "The original action body did not arrive completely")
            self._json(200, self.workspace.perform(parse_json(raw)))
        except Exception as error:
            self._failure(error)

    def do_OPTIONS(self):
        self._failure(AuditError("local_origin", "Use this application from its original local address", status=403))

def serve(workspace, port=8769, expected_id=None):
    check_identity(workspace, expected_id)
    server = AuditServer(("127.0.0.1", port), workspace)
    workspace.start_worker()
    def stop(*unused):
        threading.Thread(target=server.shutdown, daemon=True).start()
    for number in (signal.SIGINT, signal.SIGTERM):
        signal.signal(number, stop)
    print(canonical(server.startup), flush=True)
    try:
        server.serve_forever(poll_interval=0.3)
    finally:
        server.server_close()
        workspace.close()

def main(argv=None):
    parser = argparse.ArgumentParser(description="Retain, review, analyse and exchange complete native building audits.")
    commands = parser.add_subparsers(dest="command", required=True)
    for name in ("init", "state", "action", "serve", "analysis-work"):
        sub = commands.add_parser(name)
        sub.add_argument("--directory", required=True, help="Original local working project directory")
        sub.add_argument("--workspace-id", help="Pin the original saved workspace identity")
        if name == "init":
            sub.add_argument("--name", default="Audit Exchange workspace")
        if name == "action":
            sub.add_argument("--request-json", default="-", help="Complete action envelope filename, or - for stdin")
        if name == "serve":
            sub.add_argument("--host", choices=["127.0.0.1"], default="127.0.0.1")
            sub.add_argument("--port", type=int, default=8769)
        if name == "analysis-work":
            sub.add_argument("--analysis-id", help="Run this original queued operation; otherwise process the current queue")
    args = parser.parse_args(argv)
    workspace = None
    try:
        workspace = Workspace(args.directory, getattr(args, "name", "Audit Exchange workspace"))
        check_identity(workspace, args.workspace_id)
        if args.command == "serve":
            require(0 <= args.port <= 65535, "port", "Select a valid local listener port")
            serve(workspace, args.port, args.workspace_id)
            return 0
        if args.command in {"init", "state"}:
            result = {"ok": True, "result": workspace.state()}
        elif args.command == "action":
            if args.request_json == "-":
                raw = sys.stdin.buffer.read(MAX_REQUEST_BYTES + 1)
            else:
                source = Path(args.request_json)
                require(source.is_file() and source.stat().st_size <= MAX_REQUEST_BYTES, "request_file", "Select the complete original request file")
                raw = source.read_bytes()
            require(len(raw) <= MAX_REQUEST_BYTES, "input_too_large", "The complete action exceeds the configured input capacity")
            result = workspace.perform(parse_json(raw))
        else:
            identities = [args.analysis_id] if args.analysis_id else [
                row["id"] for row in workspace.state()["analysisRuns"] if row["status"] in {"queued", "running"}]
            processed = [{"analysisId": identity, "processed": workspace.run_analysis_job(identity)} for identity in identities]
            result = {"ok": True, "result": processed, "state": workspace.state()}
        print(canonical(result), flush=True)
        return 0
    except Exception as error:
        value, status = error_response(error, workspace)
        print(canonical(value), flush=True)
        if not isinstance(error, AuditError):
            traceback.print_exc(file=sys.stderr)
        return 1
    finally:
        if workspace:
            workspace.close()

if __name__ == "__main__":
    raise SystemExit(main())
