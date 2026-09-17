from __future__ import annotations

import json
import secrets
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any
from urllib.parse import urlsplit

from core import HomeOpsError, HomeOpsStore, canonical_json

PROTOCOL_VERSION = "2025-11-25"
SERVER_NAME = "homeops-relay"
SERVER_VERSION = "1.0.0"
MAX_BODY = 64 * 1024


def _pairs(items):
    out = {}
    for key, value in items:
        if key in out:
            raise HomeOpsError(f"duplicate JSON key: {key}")
        out[key] = value
    return out


def _bad_number(value):
    raise HomeOpsError(f"non-integer/non-finite JSON number forbidden: {value}")


def strict_json(raw: bytes) -> dict[str, Any]:
    if raw.startswith(b"\xef\xbb\xbf"):
        raise HomeOpsError("JSON BOM forbidden")
    value = json.loads(
        raw.decode("utf-8"),
        object_pairs_hook=_pairs,
        parse_float=_bad_number,
        parse_constant=_bad_number,
    )
    if not isinstance(value, dict):
        raise HomeOpsError("JSON-RPC request object required")
    return value

TOOL_SCHEMAS: dict[str, dict[str, Any]] = {
    "homeops.create_issue": {
        "description": "Create a household maintenance issue in the local evidence ledger.",
        "inputSchema": {"type": "object", "additionalProperties": False, "required": ["issue_id", "title", "description", "priority"], "properties": {"issue_id": {"type": "string"}, "title": {"type": "string"}, "description": {"type": "string"}, "priority": {"type": "string", "enum": ["LOW", "MEDIUM", "HIGH", "URGENT"]}}},
    },
    "homeops.add_evidence": {
        "description": "Attach bounded evidence to an issue; no external fetch is performed.",
        "inputSchema": {"type": "object", "additionalProperties": False, "required": ["issue_id", "evidence_id", "kind", "summary", "source"], "properties": {k: {"type": "string"} for k in ["issue_id", "evidence_id", "kind", "summary", "source"]}},
    },
    "homeops.add_quote": {
        "description": "Record a vendor quote as evidence without purchasing or contacting the vendor.",
        "inputSchema": {"type": "object", "additionalProperties": False, "required": ["issue_id", "quote_id", "vendor", "amount_cents", "currency", "scope"], "properties": {"issue_id": {"type": "string"}, "quote_id": {"type": "string"}, "vendor": {"type": "string"}, "amount_cents": {"type": "integer", "minimum": 0}, "currency": {"type": "string"}, "scope": {"type": "string"}}},
    },
    "homeops.propose_plan": {
        "description": "Create an evidence-bound proposal. The result is proposal-only and carries no execution authority.",
        "inputSchema": {"type": "object", "additionalProperties": False, "required": ["issue_id", "plan_id", "summary", "steps"], "properties": {"issue_id": {"type": "string"}, "plan_id": {"type": "string"}, "summary": {"type": "string"}, "steps": {"type": "array", "minItems": 1, "maxItems": 16, "items": {"type": "string"}}}},
    },
    "homeops.review_plan": {
        "description": "Record an explicit human plan approval or rejection.",
        "inputSchema": {"type": "object", "additionalProperties": False, "required": ["plan_id", "decision", "reviewer", "note"], "properties": {"plan_id": {"type": "string"}, "decision": {"type": "string", "enum": ["APPROVE", "REJECT"]}, "reviewer": {"type": "string"}, "note": {"type": "string"}}},
    },
    "homeops.request_side_effect": {
        "description": "Compile an approved side-effect request for a separate executor. This server never executes the action.",
        "inputSchema": {"type": "object", "additionalProperties": False, "required": ["plan_id", "action_id", "kind", "summary"], "properties": {"plan_id": {"type": "string"}, "action_id": {"type": "string"}, "kind": {"type": "string", "enum": ["SEND_MESSAGE", "PLACE_ORDER", "SCHEDULE_VISIT", "CHANGE_DEVICE_STATE"]}, "summary": {"type": "string"}}},
    },
    "homeops.get_issue": {
        "description": "Read one issue and its evidence, quotes, and plans.",
        "inputSchema": {"type": "object", "additionalProperties": False, "required": ["issue_id"], "properties": {"issue_id": {"type": "string"}}},
    },
    "homeops.verify_event_chain": {
        "description": "Verify the local content-addressed event chain.",
        "inputSchema": {"type": "object", "additionalProperties": False, "properties": {}},
    },
}


class MCPApplication:
    def __init__(self) -> None:
        self.store = HomeOpsStore()
        self.sessions: dict[str, bool] = {}

    def initialize(self, params: Any) -> tuple[dict[str, Any], str]:
        if not isinstance(params, dict):
            raise HomeOpsError("initialize params must be object")
        if params.get("protocolVersion") != PROTOCOL_VERSION:
            raise HomeOpsError("protocolVersion 2025-11-25 required")
        if not isinstance(params.get("capabilities", {}), dict) or not isinstance(params.get("clientInfo", {}), dict):
            raise HomeOpsError("invalid initialize capabilities/clientInfo")
        session_id = secrets.token_urlsafe(24)
        self.sessions[session_id] = False
        return {
            "protocolVersion": PROTOCOL_VERSION,
            "capabilities": {"tools": {"listChanged": False}},
            "serverInfo": {"name": SERVER_NAME, "version": SERVER_VERSION},
            "instructions": "HomeOps Relay is local-first and proposal-only. Side-effect tools return requests for a separate human-controlled executor; they never send, purchase, schedule, or actuate.",
        }, session_id

    def dispatch(self, method: str, params: Any) -> Any:
        if method == "ping":
            return {}
        if method == "tools/list":
            return {"tools": [{"name": name, **schema} for name, schema in sorted(TOOL_SCHEMAS.items())]}
        if method == "tools/call":
            if not isinstance(params, dict) or set(params) - {"name", "arguments", "_meta"}:
                raise HomeOpsError("tools/call: invalid params")
            name = params.get("name")
            args = params.get("arguments", {})
            if name not in TOOL_SCHEMAS or not isinstance(args, dict):
                raise HomeOpsError("tools/call: unknown tool or invalid arguments")
            fn_name = name.split(".", 1)[1]
            fn = getattr(self.store, fn_name)
            result = fn(args) if fn_name != "verify_event_chain" else fn()
            return {
                "content": [{"type": "text", "text": json.dumps(result, sort_keys=True, separators=(",", ":"))}],
                "structuredContent": result,
                "isError": False,
            }
        raise KeyError(method)


class MCPHandler(BaseHTTPRequestHandler):
    app = MCPApplication()
    server_version = "HomeOpsRelay/1.0"

    def log_message(self, fmt: str, *args: Any) -> None:
        return

    def _headers_ok(self) -> bool:
        host = self.headers.get("Host", "")
        if not host:
            return False
        origin = self.headers.get("Origin")
        if origin:
            parsed = urlsplit(origin)
            origin_host = parsed.netloc.lower()
            if parsed.scheme not in {"http", "https"} or origin_host != host.lower():
                return False
        return True

    def _json(self, status: int, body: dict[str, Any] | None, *, session_id: str | None = None) -> None:
        raw = b"" if body is None else canonical_json(body)
        self.send_response(status)
        if body is not None:
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(raw)))
        if session_id:
            self.send_header("Mcp-Session-Id", session_id)
        self.end_headers()
        if raw:
            self.wfile.write(raw)

    def do_DELETE(self) -> None:
        if self.path != "/mcp" or not self._headers_ok():
            self._json(HTTPStatus.FORBIDDEN, {"error": "forbidden"})
            return
        session = self.headers.get("Mcp-Session-Id")
        if not session or session not in self.app.sessions:
            self._json(HTTPStatus.NOT_FOUND, {"error": "unknown session"})
            return
        del self.app.sessions[session]
        self._json(HTTPStatus.NO_CONTENT, None)

    def do_GET(self) -> None:
        if self.path == "/healthz":
            self._json(HTTPStatus.OK, {"ok": True, "protocol": PROTOCOL_VERSION, "execution_authority": False})
            return
        if self.path == "/mcp":
            self.send_response(HTTPStatus.METHOD_NOT_ALLOWED)
            self.send_header("Allow", "POST, DELETE")
            self.end_headers()
            return
        self._json(HTTPStatus.NOT_FOUND, {"error": "not found"})

    def do_POST(self) -> None:
        if self.path != "/mcp":
            self._json(HTTPStatus.NOT_FOUND, {"error": "not found"})
            return
        if not self._headers_ok():
            self._json(HTTPStatus.FORBIDDEN, {"error": "host/origin rejected"})
            return
        ctype = self.headers.get("Content-Type", "").split(";", 1)[0].strip().lower()
        accept = self.headers.get("Accept", "")
        if ctype != "application/json" or ("application/json" not in accept and "text/event-stream" not in accept):
            self._json(HTTPStatus.UNSUPPORTED_MEDIA_TYPE, {"error": "application/json request and JSON/SSE accept required"})
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            self._json(HTTPStatus.BAD_REQUEST, {"error": "invalid content length"})
            return
        if length <= 0 or length > MAX_BODY:
            self._json(HTTPStatus.REQUEST_ENTITY_TOO_LARGE, {"error": "invalid body size"})
            return
        try:
            raw = self.rfile.read(length)
            obj = strict_json(raw)
            if obj.get("jsonrpc") != "2.0" or not isinstance(obj.get("method"), str) or set(obj) - {"jsonrpc", "id", "method", "params"}:
                raise HomeOpsError("invalid JSON-RPC request")
            method = obj["method"]
            is_notification = "id" not in obj
            if method == "initialize":
                if is_notification:
                    raise HomeOpsError("initialize requires id")
                result, session = self.app.initialize(obj.get("params", {}))
                self._json(HTTPStatus.OK, {"jsonrpc": "2.0", "id": obj["id"], "result": result}, session_id=session)
                return
            session = self.headers.get("Mcp-Session-Id")
            if not session or session not in self.app.sessions:
                self._json(HTTPStatus.NOT_FOUND, {"error": "unknown session"})
                return
            if self.headers.get("MCP-Protocol-Version") not in {None, "", PROTOCOL_VERSION}:
                self._json(HTTPStatus.BAD_REQUEST, {"error": "protocol version mismatch"})
                return
            if method == "notifications/initialized":
                if not is_notification:
                    self._json(HTTPStatus.OK, {"jsonrpc": "2.0", "id": obj["id"], "error": {"code": -32600, "message": "initialized must be a notification"}})
                    return
                self.app.sessions[session] = True
                self._json(HTTPStatus.ACCEPTED, None)
                return
            if not self.app.sessions[session]:
                if is_notification:
                    self._json(HTTPStatus.ACCEPTED, None)
                else:
                    self._json(HTTPStatus.OK, {"jsonrpc": "2.0", "id": obj["id"], "error": {"code": -32002, "message": "Server not initialized"}})
                return
            if is_notification:
                self._json(HTTPStatus.ACCEPTED, None)
                return
            try:
                result = self.app.dispatch(method, obj.get("params", {}))
                body = {"jsonrpc": "2.0", "id": obj["id"], "result": result}
            except KeyError:
                body = {"jsonrpc": "2.0", "id": obj["id"], "error": {"code": -32601, "message": "Method not found"}}
            except HomeOpsError as exc:
                if method == "tools/call":
                    body = {"jsonrpc": "2.0", "id": obj["id"], "result": {"content": [{"type": "text", "text": f"Error: {exc}"}], "isError": True}}
                else:
                    body = {"jsonrpc": "2.0", "id": obj["id"], "error": {"code": -32602, "message": str(exc)}}
            self._json(HTTPStatus.OK, body)
        except (UnicodeDecodeError, json.JSONDecodeError, HomeOpsError) as exc:
            self._json(HTTPStatus.BAD_REQUEST, {"jsonrpc": "2.0", "id": None, "error": {"code": -32700, "message": str(exc)}})


def serve(host: str = "127.0.0.1", port: int = 8787) -> None:
    httpd = ThreadingHTTPServer((host, port), MCPHandler)
    print(f"HomeOps Relay MCP {PROTOCOL_VERSION} on http://{host}:{port}/mcp")
    httpd.serve_forever()


if __name__ == "__main__":
    serve()
