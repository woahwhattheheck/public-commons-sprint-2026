#!/usr/bin/env python3
"""Loopback operator interface for retained SF36 statement captures."""
from __future__ import annotations

import argparse
import hmac
import json
import secrets
import signal
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

from domain import Problem, canonical
from exports import accountant_packet, render_issued
from portable import complete_project
from store import Store

PUBLIC = Path(__file__).resolve().parent / "public"
ASSETS = {"/": ("index.html", "text/html; charset=utf-8"),
          "/app.mjs": ("app.mjs", "text/javascript; charset=utf-8"),
          "/style.css": ("style.css", "text/css; charset=utf-8")}
CSP = "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' blob:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"


class Server(ThreadingHTTPServer):
    daemon_threads = False
    block_on_close = True
    allow_reuse_address = False

    def __init__(self, directory, port=0, node_executable=None):
        self.store = Store(directory, node_executable=node_executable)
        self.token = secrets.token_urlsafe(32)
        try:
            super().__init__(("127.0.0.1", port), Handler)
            self.origin = "http://127.0.0.1:" + str(self.server_address[1])
            self.url = self.origin + "/#" + self.token
        except BaseException:
            self.store.close()
            raise

    def server_close(self):
        try:
            super().server_close()
        finally:
            self.store.close()


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def setup(self):
        super().setup()
        self.connection.settimeout(30)

    def log_message(self, format, *args):
        pass

    def send(self, data, status=200, content_type="application/json; charset=utf-8", filename=None, csp=CSP):
        if isinstance(data, str):
            data = data.encode("utf-8")
        if not isinstance(data, bytes):
            data = canonical(data).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Content-Security-Policy", csp)
        self.send_header("Connection", "close")
        if filename:
            self.send_header("Content-Disposition", 'attachment; filename="' + filename + '"')
        self.end_headers()
        self.close_connection = True
        try:
            self.wfile.write(data)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def verified(self):
        if self.headers.get("Host") != self.server.origin.removeprefix("http://"):
            raise Problem("HOST_REJECTED", "Use the private loopback workspace address", 403)
        if self.headers.get("Origin") not in (None, self.server.origin):
            raise Problem("ORIGIN_REJECTED", "Open the original private workspace page", 403)
        received = self.headers.get("Authorization", "")
        if not hmac.compare_digest(received, "Bearer " + self.server.token):
            raise Problem("PRIVATE_LINK_REQUIRED", "Open the complete private URL printed by this workspace server", 401)
        if self.command == "POST" and self.headers.get("Origin") != self.server.origin:
            raise Problem("ORIGIN_REQUIRED", "Submit changes from the original private workspace page", 403)

    @staticmethod
    def paging(query):
        try:
            return {"offset": int(query.get("offset", ["0"])[0]), "limit": int(query.get("limit", ["50"])[0])}
        except ValueError as exc:
            raise Problem("INVALID_PAGE", "Use numeric page offsets and limits") from exc

    def do_GET(self):
        self.dispatch("GET")

    def do_POST(self):
        self.dispatch("POST")

    def dispatch(self, method):
        try:
            parsed = urlsplit(self.path)
            if parsed.scheme or parsed.netloc:
                raise Problem("INVALID_PATH", "Use an original workspace route")
            path, query = parsed.path, parse_qs(parsed.query)
            if path in ASSETS and method == "GET":
                if self.headers.get("Host") != self.server.origin.removeprefix("http://"):
                    raise Problem("HOST_REJECTED", "Use the private loopback workspace address", 403)
                name, kind = ASSETS[path]
                return self.send((PUBLIC / name).read_bytes(), content_type=kind)
            self.verified()
            parts = [part for part in path.split("/") if part]
            if method == "GET":
                return self.read(path, parts, query)
            if self.headers.get("Content-Type", "").split(";", 1)[0].strip() != "application/json":
                raise Problem("JSON_REQUIRED", "Submit an application/json object", 415)
            if self.headers.get("Transfer-Encoding"):
                raise Problem("BODY_LENGTH_REQUIRED", "Use a complete JSON body with Content-Length")
            try:
                length = int(self.headers.get("Content-Length", "-1"))
            except ValueError as exc:
                raise Problem("INVALID_BODY_LENGTH", "Invalid JSON body length") from exc
            if not 0 <= length <= 2_000_000:
                raise Problem("BODY_TOO_LARGE", "Use a JSON body no larger than 2 MB", 413)
            raw = self.rfile.read(length)
            if len(raw) != length:
                raise Problem("INCOMPLETE_BODY", "The JSON body did not arrive completely")
            try:
                body = json.loads(raw)
            except (ValueError, UnicodeError) as exc:
                raise Problem("INVALID_JSON", "Submit a complete UTF-8 JSON object") from exc
            if not isinstance(body, dict) or not isinstance(body.get("payload", {}), dict):
                raise Problem("JSON_OBJECT_REQUIRED", "Use an object with expected_revision and payload")
            payload, expected = body.get("payload", {}), body.get("expected_revision")
            operation = lambda: self.change(path, parts, payload, expected)
            value = self.server.store.perform_request(body["request_id"], path, payload, expected, operation) if "request_id" in body else operation()
            return self.send(value)
        except Problem as exc:
            self.send({"error": {"code": exc.code, "message": str(exc)}}, exc.status)
        except (ValueError, TypeError, OSError) as exc:
            self.send({"error": {"code": "INPUT_OR_SOURCE_ERROR", "message": str(exc)}}, 400)
        except Exception:
            self.send({"error": {"code": "WORKSPACE_OPERATION_FAILED", "message": "The operation failed without issuing a new period. Retained state remains available."}}, 500)

    def read(self, path, parts, query):
        store = self.server.store
        if path == "/api/state":
            return self.send(store.state())
        if path == "/api/expenses":
            return self.send(store.expenses(query=query.get("q", [""])[0], source=query.get("source", [""])[0],
                                            status=query.get("status", [""])[0], **self.paging(query)))
        if path == "/api/requests":
            return self.send(store.requests(**self.paging(query)))
        if len(parts) == 3 and parts[:2] == ["api", "requests"]:
            return self.send(store.inspect_request(parts[2]))
        if path == "/api/activity":
            return self.send(store.events(**self.paging(query)))
        if path == "/api/complete-project":
            requested = query.get("expected_revision", [None])[0]
            try:
                expected = int(requested) if requested is not None else None
            except ValueError as exc:
                raise Problem("INVALID_REVISION", "Use the reviewed whole workspace revision") from exc
            return self.send(complete_project(store, expected), content_type="application/zip", filename="buyer-expense-complete-project.zip")
        if len(parts) == 3 and parts[:2] == ["api", "items"]:
            return self.send(store.item(parts[2]))
        if len(parts) == 4 and parts[:2] == ["api", "sources"] and parts[3] == "captures":
            return self.send(store.captures(parts[2], **self.paging(query)))
        if len(parts) == 3 and parts[:2] == ["api", "captures"]:
            return self.send(store.inspect_capture(parts[2], **self.paging(query)))
        if len(parts) == 4 and parts[:2] == ["api", "captures"] and parts[3] == "original":
            return self.send(store.capture_original(parts[2]), filename="native-statement-capture.json")
        if len(parts) == 4 and parts[:2] == ["api", "periods"]:
            if parts[3] == "report":
                return self.send(store.report(parts[2]))
            if parts[3] == "history":
                return self.send(store.history(parts[2], **self.paging(query)))
        if len(parts) == 3 and parts[:2] == ["api", "reviews"]:
            return self.send(store.saved_review(parts[2]))
        if len(parts) in (3, 4) and parts[:2] == ["api", "closes"]:
            saved = store.issued(parts[2])
            if len(parts) == 3:
                return self.send(saved)
            if parts[3] == "html":
                return self.send(render_issued(saved), content_type="text/html; charset=utf-8",
                                 csp="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'")
            if parts[3] == "packet":
                return self.send(accountant_packet(saved), content_type="application/zip", filename="buyer-expense-accountant-edition.zip")
        raise Problem("NOT_FOUND", "This workspace route does not exist", 404)

    def change(self, path, parts, payload, expected):
        store = self.server.store
        fixed = {"/api/sources": store.register_source, "/api/centers": store.save_center,
                 "/api/labels": store.save_labels, "/api/periods": store.save_period}
        if path in fixed:
            return (fixed[path](payload, expected))
        if len(parts) == 4 and parts[0] == "api":
            group, ident, action = parts[1:]
            if group == "sources":
                if action == "capture":
                    return (store.capture(ident, expected))
                if action == "rebind":
                    return (store.rebind(ident, payload, expected))
            if group == "captures" and action == "decision":
                return (store.decide_capture(ident, payload, expected))
            if group == "items" and action == "coding":
                return (store.save_coding(ident, payload, expected))
            if group == "periods":
                actions = {"disposition": store.dispose, "review": store.review, "close": store.close_period, "reopen": store.reopen}
                if action in actions:
                    return (actions[action](ident, payload, expected))
        raise Problem("NOT_FOUND", "This workspace mutation does not exist", 404)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--state", required=True, help="Private expense workspace directory, separate from the original buyer ledger")
    parser.add_argument("--port", type=int, default=0)
    parser.add_argument("--node", help="Host Node 22.13+ or 24 executable for original MCP quote captures")
    args = parser.parse_args()
    if not 0 <= args.port <= 65535:
        parser.error("--port must be from 0 to 65535")
    server = Server(args.state, args.port, node_executable=args.node)
    stopping = threading.Event()
    def stop(*_):
        if not stopping.is_set():
            stopping.set()
            threading.Thread(target=server.shutdown, daemon=True).start()
    signal.signal(signal.SIGINT, stop)
    signal.signal(signal.SIGTERM, stop)
    print(json.dumps({"url": server.url, "state": str(server.store.root)}), flush=True)
    try:
        server.serve_forever(poll_interval=0.2)
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
