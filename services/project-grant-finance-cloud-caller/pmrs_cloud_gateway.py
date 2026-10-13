"""Private HTTPS caller for the existing PMRS operator; finance stays in its original service."""
from __future__ import annotations
import argparse
import base64
import binascii
import contextlib
import hashlib
import datetime as dt
import email.utils
import hmac
import http.client
import http.server
import ipaddress
import json
import os
import re
import signal
import ssl
import threading
import urllib.error
import urllib.parse
import urllib.request
import uuid
from decimal import Decimal
from pathlib import Path

VERSION = "1.0.0"
MAX_BODY = 2 * 1024 * 1024
MAX_NATIVE = 64 * 1024 * 1024
KINDS = {"capture", "mapping", "reconcile", "target-review", "deliver",
         "recover", "continue-delivery", "export"}
STOP_STATES = {"COMPLETE", "FAILED", "CANCELLED", "INTERRUPTED"}
UUID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")
SHA = re.compile(r"^[0-9a-f]{64}$")

class CallerError(Exception):
    def __init__(self, code, message, status=400, **details):
        super().__init__(message)
        self.code, self.status, self.details = code, status, details
    def value(self):
        return {"ok": False, "error": {"code": self.code, "message": str(self), "details": self.details}}

def need(condition, code, message, status=400, **details):
    if not condition: raise CallerError(code, message, status, **details)

def _pairs(pairs):
    value = {}
    for key, item in pairs:
        need(key not in value, "DUPLICATE_JSON_KEY", "The original JSON repeats a key.")
        value[key] = item
    return value

def decode(body):
    try:
        return json.loads(body.decode("utf-8") if isinstance(body, bytes) else body,
            parse_float=Decimal, parse_constant=lambda _: (_ for _ in ()).throw(ValueError("constant")),
            object_pairs_hook=_pairs)
    except CallerError: raise
    except (ValueError, UnicodeError, RecursionError):
        raise CallerError("JSON", "Use complete UTF-8 JSON with unique object keys and finite numbers.")

def original_digest(value):
    """Stream the pinned canonical.wire bytes under one aggregate UTF-8 budget."""
    remaining = MAX_BODY
    digest = hashlib.sha256()
    def emit(text):
        nonlocal remaining
        body = text.encode("utf-8")
        need(len(body) <= remaining, "COMMAND_LIMIT", "The original canonical command exceeds 2 MiB.")
        remaining -= len(body)
        digest.update(body)
    def write(item):
        if item is None: emit("null")
        elif item is True: emit("true")
        elif item is False: emit("false")
        elif isinstance(item, str): emit(json.dumps(item, ensure_ascii=False))
        elif isinstance(item, int): emit(str(item))
        elif isinstance(item, Decimal):
            sign, digits, exponent = item.as_tuple()
            need(item.is_finite(), "DECIMAL_LIMIT", "Use a finite original decimal.")
            # format(..., "f") may expand a short exponent into gigabytes.
            # Calculate its exact output length before any decimal expansion.
            size = sign + (len(digits) + exponent if exponent >= 0 else
                           len(digits) + 1 if len(digits) + exponent > 0 else 2 - exponent)
            need(size <= remaining, "COMMAND_LIMIT", "The original canonical command exceeds 2 MiB.")
            emit(format(item, "f"))
        elif isinstance(item, list):
            emit("[")
            for index, child in enumerate(item):
                if index: emit(",")
                write(child)
            emit("]")
        elif isinstance(item, dict):
            emit("{")
            for index, key in enumerate(sorted(item)):
                if index: emit(",")
                write(key); emit(":"); write(item[key])
            emit("}")
        else: raise CallerError("JSON_TYPE", "Invalid original JSON type.")
    write(value)
    return digest.hexdigest()

def json_bytes(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode("utf-8")

def private_file(path, limit=MAX_BODY):
    path = Path(path)
    need(path.is_absolute() and path.is_file() and not path.is_symlink(),
         "PRIVATE_FILE", "Select an existing absolute regular private file.", 503)
    stat = path.stat()
    if os.name == "posix":
        need(stat.st_mode & 0o077 == 0, "PRIVATE_FILE_MODE", "Private connection files must be owner-only.", 503)
    need(stat.st_size <= limit, "PRIVATE_FILE_LIMIT", "The selected private file exceeds its declared limit.", 503)
    with path.open("rb") as stream: body = stream.read(limit + 1)
    need(len(body) <= limit, "PRIVATE_FILE_LIMIT", "The selected private file grew beyond its limit.", 503)
    return body

def config_read(path):
    body = decode(private_file(path))
    expected = {"schema", "workspace_id", "operator_entry_file", "host", "port",
                "certificate_file", "private_key_file", "public_host", "principals"}
    need(isinstance(body, dict) and set(body) == expected and
         body["schema"] == "commons.pmrs-cloud-caller.v1", "CONFIGURATION", "Use the complete caller configuration.", 503)
    try: uuid.UUID(body["workspace_id"])
    except (ValueError, TypeError): raise CallerError("WORKSPACE_ID", "Retain the actual original workspace identity.", 503)
    need(isinstance(body["host"], str) and body["host"] not in {"", "0.0.0.0", "::"},
         "PRIVATE_LISTENER", "Select the private network interface explicitly.", 503)
    try: ip = ipaddress.ip_address(body["host"])
    except ValueError: raise CallerError("PRIVATE_LISTENER", "Use a literal private IPv4 listener address.", 503)
    need(ip.version == 4 and (ip.is_private or ip.is_loopback) and not ip.is_unspecified,
         "PRIVATE_LISTENER", "Use the actual private IPv4 listener address.", 503)
    need(type(body["port"]) is int and 1 <= body["port"] <= 65535, "PORT", "Invalid private HTTPS port.", 503)
    parsed = urllib.parse.urlsplit("https://" + body["public_host"])
    need(parsed.netloc == body["public_host"] and parsed.hostname and not parsed.username and
         not parsed.password and not parsed.path and not parsed.query and not parsed.fragment,
         "PUBLIC_HOST", "Use the gateway-reachable certificate hostname and optional port.", 503)
    need(isinstance(body["principals"], dict) and bool(body["principals"]), "PRINCIPALS", "Retain at least one caller principal.", 503)
    for name, principal in body["principals"].items():
        need(re.fullmatch(r"[A-Za-z0-9_.-]{1,64}", name) and isinstance(principal, dict) and
             set(principal) == {"salt", "password_hash", "iterations", "kinds", "enabled"},
             "PRINCIPAL", "Invalid caller principal.", 503)
        need(type(principal["enabled"]) is bool and type(principal["iterations"]) is int and
             200000 <= principal["iterations"] <= 2000000, "PRINCIPAL", "Invalid credential settings.", 503)
        try:
            salt = bytes.fromhex(principal["salt"]); password_hash = bytes.fromhex(principal["password_hash"])
        except (ValueError, TypeError): raise CallerError("PRINCIPAL", "Invalid credential digest.", 503)
        need(len(salt) == 32 and len(password_hash) == 32, "PRINCIPAL", "Invalid credential digest length.", 503)
        need(isinstance(principal["kinds"], list) and len(set(principal["kinds"])) == len(principal["kinds"])
             and set(principal["kinds"]) <= KINDS, "PRINCIPAL_KINDS", "Use explicit original command permissions.", 503)
    return body

def authenticate(header, config):
    need(isinstance(header, str) and header.startswith("Basic ") and len(header) <= 2048,
         "CALLER_AUTHENTICATION", "Use the selected private connector connection.", 401)
    try:
        value = base64.b64decode(header[6:], validate=True).decode("utf-8")
        name, password = value.split(":", 1)
    except (ValueError, UnicodeError, binascii.Error):
        raise CallerError("CALLER_AUTHENTICATION", "Invalid connector credentials.", 401)
    principal = config["principals"].get(name)
    need(principal and principal["enabled"] and 32 <= len(password) <= 512,
         "CALLER_AUTHENTICATION", "Use the selected private connector connection.", 401)
    actual = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"),
        bytes.fromhex(principal["salt"]), principal["iterations"])
    need(hmac.compare_digest(actual, bytes.fromhex(principal["password_hash"])),
         "CALLER_AUTHENTICATION", "Use the selected private connector connection.", 401)
    return name, principal

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise CallerError("OPERATOR_REDIRECT", "The retained local operator redirected; reopen its original entry.", 502)

class Native:
    """Reload the owner's private entry and pin its original workspace on every request."""
    def __init__(self, config):
        self.config = config
    def entry(self):
        entry = decode(private_file(self.config["operator_entry_file"], 32768))
        need(isinstance(entry, dict) and entry.get("schema") == "commons.pmrs-local-entry.v1" and
             entry.get("workspace_id") == self.config["workspace_id"], "OPERATOR_IDENTITY",
             "The current operator entry belongs to another workspace.", 503)
        url = urllib.parse.urlsplit(entry.get("url", ""))
        need(url.scheme == "http" and url.hostname in {"127.0.0.1", "localhost"} and
             url.port and not url.username and not url.password and url.path in {"", "/"}
             and not url.query and not url.fragment, "OPERATOR_URL", "Use the original loopback operator entry.", 503)
        token = entry.get("token")
        need(isinstance(token, str) and len(token) >= 32 and not any(c.isspace() for c in token),
             "OPERATOR_TOKEN", "The original operator entry has no valid private token.", 503)
        return entry, entry["url"].rstrip("/")
    def request(self, method, path, data=None, limit=MAX_NATIVE):
        entry, origin = self.entry()
        need(path.startswith("/api/") and not any(c in path for c in ("\r", "\n", "#", "\\")),
             "OPERATOR_PATH", "Invalid original operator route.")
        headers = {"Authorization": "Bearer " + entry["token"], "Accept": "application/json"}
        if data is not None: headers.update({"Origin": origin, "Content-Type": "application/json"})
        req = urllib.request.Request(origin + path, data=data, headers=headers, method=method)
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
        try:
            try: response = opener.open(req, timeout=45)
            except urllib.error.HTTPError as error: response = error
            with response:
                body = response.read(limit + 1)
                need(len(body) <= limit, "NATIVE_RESPONSE_LIMIT",
                     "Use the original paged record or local complete-file download.", 413)
                expected = response.headers.get("Content-Length")
                need(expected is None or (expected.isdigit() and int(expected) == len(body)),
                     "NATIVE_RESPONSE_INCOMPLETE", "The original response ended before its declared length.", 502)
                return int(response.status), dict(response.headers.items()), body
        except CallerError: raise
        except (OSError, urllib.error.URLError, http.client.HTTPException):
            raise CallerError("NATIVE_OUTCOME_UNRESOLVED",
                "Read the same original command before continuation; no replacement request was created.",
                502, original_method=method, recovery="read_same_original_command")
    def json(self, method, path, data=None):
        status, headers, raw = self.request(method, path, data)
        value = decode(raw)
        need(isinstance(value, dict) and type(value.get("ok")) is bool,
             "OPERATOR_RESPONSE", "The original operator returned an unexpected envelope.", 502)
        if status >= 400 or value["ok"] is not True:
            error = value.get("error") or {}
            raise CallerError("NATIVE_" + str(error.get("code", "REFUSAL")),
                str(error.get("message", "The original operator refused this request.")),
                status if 400 <= status <= 599 else 502,
                native_status=status, native_sha256=hashlib.sha256(raw).hexdigest(),
                native_json=raw.decode("utf-8") if len(raw) <= 65536 else "",
                retry_after=headers.get("Retry-After") or headers.get("retry-after"))
        return value["value"], raw
    def state(self):
        value, raw = self.json("GET", "/api/state")
        need(value.get("workspace", {}).get("workspace_id") == self.config["workspace_id"],
             "OPERATOR_IDENTITY", "The running operator differs from the selected workspace.", 502)
        return value, raw

def command(text, principal, allowed):
    need(isinstance(text, str) and len(text.encode("utf-8")) <= MAX_BODY,
         "COMMAND_LIMIT", "Provide one complete original command within 2 MiB.")
    value = decode(text)
    need(isinstance(value, dict) and set(value) == {"id", "kind", "arguments"} and
         isinstance(value["arguments"], dict) and isinstance(value["id"], str) and UUID.fullmatch(value["id"]),
         "COMMAND", "Supply the original UUIDv4, kind and complete arguments.")
    need(value["kind"] in allowed and value["kind"] in principal["kinds"],
         "COMMAND_PERMISSION", "This caller/flow does not permit that original command kind.", 403)
    return value, text.encode("utf-8")

def command_result(value, raw, workspace_id):
    state = value.get("state")
    native = value.get("operation")
    delivery_state = native.get("state") if isinstance(native, dict) else None
    result = value.get("result") or {}
    error = value.get("error") or {}
    return {"workspace_id": workspace_id, "command_id": value["id"],
            "kind": value["kind"], "state": state, "stop_polling": state in STOP_STATES,
            "record_id": result.get("record_id") or "",
            "delivery_id": result.get("delivery_id") or "",
            "delivery_state": delivery_state or "", "reconciliation_ready": result.get("ready") is True,
            "error_code": error.get("code") or "", "native_sha256": hashlib.sha256(raw).hexdigest(),
            "native_json": raw.decode("utf-8"), "recovery": (
                "review_original_delivery" if delivery_state == "AWAITING_OPERATOR" else
                "resume_same_original_command" if state == "INTERRUPTED" else
                "inspect_original_result" if state in STOP_STATES else "poll_same_original_command")}

def respect_provider_retry(retry, observed_at, **context):
    if retry is None: return
    try:
        if str(retry).isdigit():
            base = dt.datetime.fromisoformat(observed_at.replace("Z", "+00:00"))
            eligible = base + dt.timedelta(seconds=int(retry))
        else: eligible = email.utils.parsedate_to_datetime(str(retry))
        need(eligible.tzinfo is not None and dt.datetime.now(dt.timezone.utc) >= eligible,
             "PROVIDER_RETRY_AFTER", "The original provider continuation time has not arrived.", 429,
             retry_after=str(retry), observed_at=observed_at, eligible_at=eligible.isoformat(), **context)
    except CallerError: raise
    except (ValueError, TypeError, OverflowError, AttributeError):
        raise CallerError("PROVIDER_RETRY_AFTER",
            "Review the original provider retry instruction before continuing.", 409, **context)

class Caller:
    def __init__(self, config):
        self.config, self.native = config, Native(config)
    def submit(self, body, principal, group):
        need(isinstance(body, dict) and set(body) <= {"workspace_id", "command_json", "resume_interrupted"} and
             {"workspace_id", "command_json"} <= set(body) and type(body.get("resume_interrupted", False)) is bool,
             "BODY", "Supply the expected workspace_id, command_json and an explicit boolean resume_interrupted.")
        need(body["workspace_id"] == self.config["workspace_id"], "WORKSPACE_CHANGED",
             "The selected caller belongs to another original workspace.", 409)
        groups = {"capture": {"capture"}, "prepare": {"mapping", "reconcile", "target-review", "export"},
                  "delivery": {"deliver", "recover", "continue-delivery"}}
        original, raw = command(body["command_json"], principal, groups[group])
        native_state, _ = self.native.state()
        expected = original_digest(original)
        try:
            existing, response = self.native.json("GET", "/api/actions/" + original["id"])
        except CallerError as error:
            if error.code != "NATIVE_ACTION_NOT_FOUND" or error.status != 404: raise
        else:
            need(existing.get("id") == original["id"] and existing.get("request_sha256") == expected,
                 "COMMAND_IDENTITY", "This original command ID already belongs to different content.", 409)
            if existing.get("state") != "INTERRUPTED" or not body.get("resume_interrupted", False):
                return command_result(existing, response, self.config["workspace_id"])
            provider_retry = (existing.get("error") or {}).get("details", {}).get("retry_after")
            respect_provider_retry(provider_retry, existing.get("updated_at"), command_id=original["id"])
        if original["kind"] in {"recover", "continue-delivery"}:
            delivery_id = original["arguments"].get("delivery_id")
            need(isinstance(delivery_id, str) and UUID.fullmatch(delivery_id),
                 "DELIVERY_ID", "Select the original delivery UUIDv4.")
            delivery, _ = self.native.json("GET", "/api/operations/" + delivery_id)
            need(delivery.get("id") == delivery_id and delivery.get("kind") == "target-delivery",
                 "DELIVERY_IDENTITY", "Select the original target delivery operation.", 409)
            connection = (delivery.get("request") or {}).get("connection")
            need(isinstance(connection, dict) and connection in native_state.get("connections", []),
                 "DELIVERY_CONNECTION", "The current connection differs from the original delivery.", 409)
            for event in delivery.get("history", []):
                if event.get("retry_after") is not None:
                    respect_provider_retry(event["retry_after"], event.get("at"),
                                           delivery_id=delivery_id, command_id=original["id"])
        value, response = self.native.json("POST", "/api/actions", raw)
        need(value.get("request_sha256") == expected, "COMMAND_IDENTITY",
             "The original response carries a different request digest.", 502)
        need(value.get("id") == original["id"] and value.get("kind") == original["kind"],
             "COMMAND_IDENTITY", "The original response identifies a different command.", 502)
        return command_result(value, response, self.config["workspace_id"])
    def read(self, path, query):
        workspace_id = self.config["workspace_id"]
        if path == "/v1/health":
            need(not query, "QUERY", "Health takes no query.")
            value, raw = self.native.state()
            # Native state includes 100 full historical commands; only identity belongs
            # in a preflight. Full finance responses retain their original text below.
            return {"workspace_id": workspace_id, "version": VERSION, "state": "CONNECTED",
                    "native_workspace": value["workspace"],
                    "native_state_sha256": hashlib.sha256(raw).hexdigest(),
                    "native_state_bytes": len(raw)}
        parts = path.strip("/").split("/")
        need(parts[0] == "v1", "ROUTE", "Unknown caller route.", 404)
        if len(parts) == 3 and parts[1] in {"commands", "deliveries"}:
            need(not query and UUID.fullmatch(parts[2]), "IDENTIFIER", "Use the exact original UUIDv4.")
            target = "actions" if parts[1] == "commands" else "operations"
            value, raw = self.native.json("GET", "/api/" + target + "/" + parts[2])
            need(value.get("id") == parts[2], "COMMAND_IDENTITY", "The native record identity differs.", 502)
            if target == "actions": return command_result(value, raw, workspace_id)
            return {"workspace_id": workspace_id, "delivery_id": parts[2], "state": value["state"],
                    "native_sha256": hashlib.sha256(raw).hexdigest(), "native_json": raw.decode("utf-8")}
        if len(parts) in {3, 4} and parts[1] == "records":
            need(SHA.fullmatch(parts[2]), "IDENTIFIER", "Use the original complete record SHA-256.")
            if len(parts) == 4:
                need(parts[3] in {"delivery", "totals", "findings"}, "ROUTE", "Unknown record view.", 404)
                if parts[3] != "delivery":
                    need(set(query) <= {"offset", "limit"} and all(len(v) == 1 and v[0].isdigit() for v in query.values()),
                         "PAGINATION", "Use one non-negative offset and a limit from 1 to 100.")
                    limit = int(query.get("limit", ["25"])[0])
                    need(1 <= limit <= 100, "PAGINATION", "Use a page limit from 1 to 100.")
                else: need(not query, "QUERY", "Ownership takes no query.")
            else: need(not query, "QUERY", "Record takes no query.")
            suffix = urllib.parse.urlencode({k: v[0] for k, v in query.items()})
            value, raw = self.native.json("GET", "/api/" + "/".join(parts[1:]) + ("?" + suffix if suffix else ""))
            return {"workspace_id": workspace_id, "record_id": parts[2],
                    "native_sha256": hashlib.sha256(raw).hexdigest(), "native_json": raw.decode("utf-8")}
        raise CallerError("ROUTE", "Unknown caller route.", 404)

class Server(http.server.ThreadingHTTPServer):
    daemon_threads = False
    block_on_close = True
    allow_reuse_address = True
    slots = threading.BoundedSemaphore(32)
    def get_request(self):
        raw, address = super().get_request()
        raw.settimeout(60)
        try:
            return self.tls_context.wrap_socket(raw, server_side=True, do_handshake_on_connect=False), address
        except BaseException:
            raw.close(); raise
    def process_request(self, request, client_address):
        if not self.slots.acquire(blocking=False):
            self.shutdown_request(request); return
        try: super().process_request(request, client_address)
        except BaseException:
            self.slots.release(); raise
    def process_request_thread(self, request, client_address):
        try: super().process_request_thread(request, client_address)
        finally: self.slots.release()

def serve(config_path):
    selected = config_read(config_path)
    caller = Caller(selected)
    caller.native.state()
    class Handler(http.server.BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"
        def setup(self):
            super().setup(); self.connection.settimeout(60)
        def log_message(self, *_): pass
        def _reply(self, value, status=200):
            body = json_bytes(value)
            need(len(body) <= MAX_BODY, "CONNECTOR_RESPONSE_LIMIT",
                 "This complete response exceeds the gateway envelope. Use the original operator's paged view or full download.", 413)
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Connection", "close")
            if status == 401: self.send_header("WWW-Authenticate", 'Basic realm="PMRS private caller", charset="UTF-8"')
            self.end_headers(); self.wfile.write(body); self.close_connection = True
        def _request(self):
            # Refresh credential revocation without retargeting a running listener.
            fresh = config_read(config_path)
            need({k: v for k, v in fresh.items() if k != "principals"} ==
                 {k: v for k, v in selected.items() if k != "principals"}, "CONFIGURATION_CHANGED",
                 "Restart this caller after changing its selected workspace or listener.", 503)
            name, principal = authenticate(self.headers.get("Authorization"), fresh)
            need(self.headers.get("Host", "").lower() == selected["public_host"].lower(),
                 "CALLER_HOST", "Use the selected connector hostname.")
            url = urllib.parse.urlsplit(self.path)
            need(not url.scheme and not url.netloc and not url.fragment and
                 "\\" not in url.path and "%" not in url.path, "PATH", "Invalid caller route.")
            return name, principal, url.path, urllib.parse.parse_qs(url.query, keep_blank_values=True)
        def _error(self, error):
            self.close_connection = True
            if not isinstance(error, CallerError):
                error = CallerError("CALLER_FAILURE", "The caller stopped before receiving a complete result; read the same original command.", 502)
            try: self._reply(error.value(), error.status)
            except (BrokenPipeError, ConnectionResetError, ssl.SSLError): pass
        def do_GET(self):
            try:
                _, _, path, query = self._request()
                self._reply(caller.read(path, query))
            except (BrokenPipeError, ConnectionResetError): pass
            except Exception as error: self._error(error)
        def do_POST(self):
            try:
                _, principal, path, query = self._request()
                groups = {"/v1/capture": "capture", "/v1/prepare": "prepare", "/v1/delivery": "delivery"}
                need(path in groups and not query, "ROUTE", "Unknown caller action.", 404)
                need(not self.headers.get("Transfer-Encoding") and self.headers.get_content_type() == "application/json",
                     "CONTENT_TYPE", "Send one complete Content-Length JSON body.")
                lengths = self.headers.get_all("Content-Length", [])
                need(len(lengths) == 1 and lengths[0].isdigit() and 0 < int(lengths[0]) <= MAX_BODY,
                     "BODY_LIMIT", "Send one complete body within the 2 MiB connector budget.", 413)
                raw = self.rfile.read(int(lengths[0]))
                need(len(raw) == int(lengths[0]), "BODY_INCOMPLETE", "The original request body ended early.")
                self._reply(caller.submit(decode(raw), principal, groups[path]))
            except (BrokenPipeError, ConnectionResetError): pass
            except Exception as error: self._error(error)
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    context.minimum_version = ssl.TLSVersion.TLSv1_2
    # Private key is checked without echoing its contents; use the institution's certificate.
    private_file(selected["private_key_file"], 1024 * 1024)
    context.load_cert_chain(selected["certificate_file"], selected["private_key_file"])
    server = Server((selected["host"], selected["port"]), Handler)
    server.tls_context = context
    stop = threading.Event()
    thread = threading.Thread(target=server.serve_forever, kwargs={"poll_interval": 0.2}, name="pmrs-cloud-caller")
    thread.start()
    previous = {}
    def halt(*_): stop.set()
    for sig in (signal.SIGINT, signal.SIGTERM): previous[sig] = signal.signal(sig, halt)
    try:
        print(json.dumps({"state": "READY", "workspace_id": selected["workspace_id"], "host": selected["public_host"], "version": VERSION}), flush=True)
        stop.wait()
    finally:
        server.shutdown(); thread.join(); server.server_close()
        for sig, handler in previous.items(): signal.signal(sig, handler)

def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--config", required=True, help="Absolute owner-only caller configuration outside the original workspace.")
    args = p.parse_args()
    try: serve(Path(args.config).absolute())
    except CallerError as error:
        print(json.dumps(error.value()), flush=True); return 2
    return 0

if __name__ == "__main__": raise SystemExit(main())
