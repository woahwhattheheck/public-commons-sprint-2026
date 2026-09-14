from __future__ import annotations

import json
import os
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

from .core import TraceForgeError, analyze, strict_json_loads, verify_receipt
from .model import DemoModel, OpenAICompatibleModel

MAX_REQUEST_BYTES = 320_000
ROOT = Path(__file__).resolve().parent.parent
WEB = ROOT / "web"
EXAMPLE = ROOT / "examples" / "incident.txt"

_ASSETS = {
    "/": ("index.html", "text/html; charset=utf-8"),
    "/app.js": ("app.js", "text/javascript; charset=utf-8"),
    "/styles.css": ("styles.css", "text/css; charset=utf-8"),
}


def _json_bytes(value: Any) -> bytes:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode("utf-8")


class Handler(BaseHTTPRequestHandler):
    server_version = "TraceForge/1"

    def log_message(self, fmt: str, *args: Any) -> None:
        # Do not log request bodies or authorization material.
        print(f"traceforge-http {self.address_string()} {fmt % args}")

    def _headers(self, status: int, content_type: str, length: int) -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(length))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'")
        self.end_headers()

    def _send_json(self, status: int, value: Any) -> None:
        payload = _json_bytes(value)
        self._headers(status, "application/json; charset=utf-8", len(payload))
        self.wfile.write(payload)

    def do_GET(self) -> None:  # noqa: N802
        if self.path in _ASSETS:
            name, content_type = _ASSETS[self.path]
            payload = (WEB / name).read_bytes()
            self._headers(HTTPStatus.OK, content_type, len(payload))
            self.wfile.write(payload)
            return
        if self.path == "/api/health":
            self._send_json(HTTPStatus.OK, {"ok": True, "schema": "traceforge-health/v1"})
            return
        if self.path == "/api/demo":
            self._send_json(HTTPStatus.OK, {"text": EXAMPLE.read_text(encoding="utf-8")})
            return
        if self.path == "/api/config":
            self._send_json(
                HTTPStatus.OK,
                {
                    "liveConfigured": bool(os.environ.get("TRACEFORGE_BASE_URL") and os.environ.get("TRACEFORGE_MODEL")),
                    "liveModel": os.environ.get("TRACEFORGE_MODEL", "")[:100],
                },
            )
            return
        self._send_json(HTTPStatus.NOT_FOUND, {"error": "not_found"})

    def do_POST(self) -> None:  # noqa: N802
        if self.path == "/api/verify":
            return self._handle_verify()
        if self.path != "/api/analyze":
            self._send_json(HTTPStatus.NOT_FOUND, {"error": "not_found"})
            return
        content_type = self.headers.get("Content-Type", "").split(";", 1)[0].strip().lower()
        if content_type != "application/json":
            self._send_json(HTTPStatus.UNSUPPORTED_MEDIA_TYPE, {"error": "content_type_must_be_json"})
            return
        length_text = self.headers.get("Content-Length")
        try:
            length = int(length_text or "")
        except ValueError:
            length = -1
        if length < 0 or length > MAX_REQUEST_BYTES:
            self._send_json(HTTPStatus.REQUEST_ENTITY_TOO_LARGE, {"error": "invalid_request_size"})
            return
        raw = self.rfile.read(length)
        try:
            payload = strict_json_loads(raw.decode("utf-8"), max_bytes=MAX_REQUEST_BYTES, label="request")
            if not isinstance(payload, dict) or set(payload) != {"text", "mode"}:
                raise TraceForgeError("request must contain exactly text and mode")
            text = payload["text"]
            mode = payload["mode"]
            if mode == "demo":
                model = DemoModel()
            elif mode == "live":
                model = OpenAICompatibleModel.from_env()
            else:
                raise TraceForgeError("mode must be demo or live")
            result = analyze(text, model)
            self._send_json(HTTPStatus.OK, result)
        except (UnicodeDecodeError, TraceForgeError) as exc:
            self._send_json(HTTPStatus.UNPROCESSABLE_ENTITY, {"error": "analysis_rejected", "detail": str(exc)[:400]})

    def _handle_verify(self) -> None:
        content_type = self.headers.get("Content-Type", "").split(";", 1)[0].strip().lower()
        if content_type != "application/json":
            self._send_json(HTTPStatus.UNSUPPORTED_MEDIA_TYPE, {"error": "content_type_must_be_json"})
            return
        try:
            length = int(self.headers.get("Content-Length", "-1"))
        except ValueError:
            length = -1
        if length < 0 or length > MAX_REQUEST_BYTES:
            self._send_json(HTTPStatus.REQUEST_ENTITY_TOO_LARGE, {"error": "invalid_request_size"})
            return
        raw = self.rfile.read(length)
        try:
            payload = strict_json_loads(raw.decode("utf-8"), max_bytes=MAX_REQUEST_BYTES, label="receipt")
        except (UnicodeDecodeError, TraceForgeError) as exc:
            self._send_json(HTTPStatus.UNPROCESSABLE_ENTITY, {"error": "invalid_receipt", "detail": str(exc)[:300]})
            return
        self._send_json(HTTPStatus.OK, {"valid": verify_receipt(payload)})


def serve(host: str = "127.0.0.1", port: int = 8080) -> None:
    if port < 1 or port > 65535:
        raise TraceForgeError("port must be 1..65535")
    httpd = ThreadingHTTPServer((host, port), Handler)
    print(f"TraceForge AI listening on http://{host}:{port}")
    httpd.serve_forever()
