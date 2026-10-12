#!/usr/bin/env python3
"""MIT. Private byte-preserving transport to the official OpenSearch Playground."""
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from http.cookiejar import CookieJar
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import urlencode, urlsplit, urljoin, unquote
from urllib.request import Request, HTTPCookieProcessor, build_opener, HTTPRedirectHandler, getproxies, proxy_bypass
from concurrent.futures import ThreadPoolExecutor
from http.client import HTTPSConnection
from queue import LifoQueue, Empty
import base64, hashlib, json, threading, os, sys, ssl, time

if len(sys.argv) not in (2, 3) or (len(sys.argv) == 3 and sys.argv[2] != "--public-flight-profile"):
    raise SystemExit("Usage: playground-bridge.py OUTPUT [--public-flight-profile]")
PUBLIC_FLIGHTS = len(sys.argv) == 3
if PUBLIC_FLIGHTS:
    from public_flight_profile import (
        PublicFlightProfile, PublicFlightPolicyError, PROFILE_ID, CAT_PATH,
    )
    public_profile = PublicFlightProfile()
else:
    public_profile = None
    class PublicFlightPolicyError(ValueError):
        pass

ROOT = Path(sys.argv[1]).resolve()
ROOT.mkdir(parents=True, exist_ok=True, mode=0o700)
ORIGIN = "https://playground.opensearch.org"
if public_profile:
    profile_path = ROOT / "public-egress-profile.json"
    profile_path.write_text(json.dumps(public_profile.describe(), indent=2) + "\n")
    os.chmod(profile_path, 0o600)
jar = CookieJar()
class GuestRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None

guest_opener = build_opener(HTTPCookieProcessor(jar), GuestRedirect())
guest_url = ORIGIN + "/app/home"
for guest_step in range(5):
    try:
        guest_response = guest_opener.open(Request(guest_url, headers={"accept": "text/html"}), timeout=30)
    except HTTPError as error:
        guest_response = error
    with guest_response:
        guest_status = guest_response.code
        guest_location = guest_response.headers.get("location")
        guest_response.read(100000)
    if guest_status == 200:
        break
    if guest_status not in (301, 302, 303, 307, 308) or not guest_location:
        raise RuntimeError("Anonymous session bootstrap status " + str(guest_status))
    guest_url = urljoin(guest_url, guest_location)
    guest_target = urlsplit(guest_url)
    if (guest_target.scheme != "https" or guest_target.hostname != "playground.opensearch.org"
            or (PUBLIC_FLIGHTS and (guest_target.port not in (None, 443)
                or guest_target.username is not None or guest_target.password is not None))):
        raise RuntimeError("Unexpected anonymous session destination")
else:
    raise RuntimeError("Anonymous session redirect limit")
cookie_lock = threading.Lock()
journal_lock = threading.Lock()
origin = urlsplit(ORIGIN)
configured_proxy = None if proxy_bypass(origin.hostname) else getproxies().get("https")
proxy = urlsplit(configured_proxy if configured_proxy and "://" in configured_proxy
                 else "http://" + configured_proxy) if configured_proxy else None
# HTTPSConnection performs CONNECT through a conventional HTTP proxy before
# TLS to the original host. Other configured proxy schemes retain urllib's
# normal behavior; neither path changes the session or network route.
pooled = proxy is None or proxy.scheme == "http"
tls_context = ssl.create_default_context()
tls_context.set_alpn_protocols(["http/1.1"])
slots = LifoQueue(maxsize=2)
for slot_id in range(2):
    slots.put({"connection": None, "lastUsed": 0.0, "id": slot_id})

def make_connection():
    if proxy is None:
        return HTTPSConnection(origin.hostname, origin.port or 443,
                               timeout=35, context=tls_context)
    connection = HTTPSConnection(proxy.hostname, proxy.port or 80,
                                 timeout=35, context=tls_context)
    headers = {}
    if proxy.username is not None:
        credentials = unquote(proxy.username) + ":" + unquote(proxy.password or "")
        headers["Proxy-Authorization"] = "Basic " + base64.b64encode(
            credentials.encode("utf-8")).decode("ascii")
    connection.set_tunnel(origin.hostname, origin.port or 443, headers=headers)
    return connection

def record_request(item):
    with journal_lock:
        with (ROOT / "native-requests.jsonl").open("a", encoding="utf-8") as journal:
            journal.write(json.dumps(item) + "\n")
        os.chmod(ROOT / "native-requests.jsonl", 0o600)

def native(method, path, body=None):
    permit = None
    if public_profile:
        try:
            permit = public_profile.begin(method, path, body)
        except ValueError as error:
            record_request({
                "profile": PROFILE_ID, "rejectedBeforeSend": True,
                "code": str(error), "method": method,
                "pathSha256": hashlib.sha256(path.encode()).hexdigest(),
                "bodySha256": hashlib.sha256(body or b"").hexdigest(),
            })
            raise
    profile_response_observed = False
    began = time.monotonic()
    url = ORIGIN + "/api/console/proxy?" + urlencode({"path": path, "method": method})
    request = Request(url, data=body or b"", method="POST", headers={
        "osd-xsrf": "true", "content-type": "application/json",
        "accept": "application/json", "accept-encoding": "identity"
    })
    item = {"method": method, "path": path,
            "startedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "transport": "http-keepalive-pool" if pooled else "urllib",
            "reusedConnection": False}
    if permit is not None:
        item.update({"profile": PROFILE_ID, "requestKind": permit.kind,
                     "requestBodySha256": permit.request_sha256})
    slot = None
    try:
        if pooled:
            # Lease one independently reusable connection. Only CookieJar and
            # journal access are locked; metadata GETs can execute concurrently.
            slot = slots.get(timeout=35)
            item["queueMs"] = round((time.monotonic() - began) * 1000, 3)
            connection = slot["connection"]
            if connection is not None and time.monotonic() - slot["lastUsed"] > 25:
                connection.close()
                connection = slot["connection"] = None
            if connection is None:
                connection = make_connection()
                slot["connection"] = connection
                connect_start = time.monotonic()
                connection.connect()
                item["connectMs"] = round((time.monotonic() - connect_start) * 1000, 3)
            else:
                item["reusedConnection"] = True
            item["connectionSlot"] = slot["id"]
            with cookie_lock:
                jar.add_cookie_header(request)
            headers = dict(request.header_items())
            headers["Connection"] = "keep-alive"
            headers["Content-Length"] = str(len(body or b""))
            target = urlsplit(url)
            connection.request("POST", target.path + "?" + target.query,
                               body=body or b"", headers=headers)
            response = connection.getresponse()
            with response:
                with cookie_lock:
                    jar.extract_cookies(response, request)
                raw = response.read(2 * 1024 * 1024 + 1)
                if len(raw) > 2 * 1024 * 1024:
                    raise ValueError("native response exceeds transport limit")
                status, response_headers = response.status, response.headers
                if response.will_close:
                    connection.close()
                    slot["connection"] = None
            slot["lastUsed"] = time.monotonic()
        else:
            with cookie_lock:
                jar.add_cookie_header(request)
            # A fresh opener keeps unsupported-proxy compatibility independent
            # across threads, with the same in-memory anonymous CookieJar.
            try:
                response = build_opener(GuestRedirect()).open(request, timeout=35)
            except HTTPError as error:
                response = error
            with response:
                with cookie_lock:
                    jar.extract_cookies(response, request)
                raw = response.read(2 * 1024 * 1024 + 1)
                if len(raw) > 2 * 1024 * 1024:
                    raise ValueError("native response exceeds transport limit")
                status, response_headers = response.code, response.headers
        item.update({"status": status, "responseBytes": len(raw)})
        if status >= 400:
            item["nativeError"] = raw[:16000].decode("utf-8", "replace")
        if public_profile:
            public_profile.observe(permit, status, raw)
        profile_response_observed = True
        return status, response_headers, raw
    except Exception as error:
        item["transportError"] = type(error).__name__
        if slot is not None and slot["connection"] is not None:
            slot["connection"].close()
            slot["connection"] = None
        # An uncertain request is never automatically replayed, especially PIT
        # creation. The caller retains the actual failed attempt.
        raise
    finally:
        if public_profile and permit is not None:
            public_profile.finish(permit, failed=not profile_response_observed)
        if slot is not None:
            slots.put(slot)
        item["durationMs"] = round((time.monotonic() - began) * 1000, 3)
        record_request(item)

def close_connections():
    while True:
        try:
            slot = slots.get_nowait()
        except Empty:
            return
        if slot["connection"] is not None:
            slot["connection"].close()

with ThreadPoolExecutor(max_workers=2) as metadata_reads:
    root_read = metadata_reads.submit(native, "GET", "/")
    index_read = metadata_reads.submit(native, "GET", CAT_PATH if PUBLIC_FLIGHTS else "/_cat/indices?format=json&h=index,docs.count&bytes=b")
    status, _, raw = root_read.result()
    index_status, _, index_raw = index_read.result()
if status != 200:
    raise RuntimeError("native root status " + str(status))
metadata = json.loads(raw)
if metadata.get("version", {}).get("distribution") != "opensearch":
    raise RuntimeError("unexpected native distribution")
(ROOT / "native-engine.json").write_bytes(raw)
if index_status != 200:
    raise RuntimeError("native index metadata status " + str(index_status))
indices = json.loads(index_raw)
samples = sorted(
    [row for row in indices if "sample_data" in row.get("index", "") and not row["index"].startswith(".")],
    key=lambda row: int(row.get("docs.count", "0") or "0")
)
if not samples:
    raise RuntimeError("no public sample index in returned metadata")
selected = next((row for row in samples if "flights" in row["index"]), samples[0])
index = selected["index"]
status, _, raw = native("GET", "/" + index + "/_mapping")
if status != 200:
    raise RuntimeError("native sample mapping status " + str(status))
(ROOT / "native-index-mapping.json").write_bytes(raw)
(ROOT / "native-index-selection.json").write_text(json.dumps({
    "index": index, "nativeDocumentCount": selected.get("docs.count"),
    "publicSource": ORIGIN, "transport": "native-console-proxy",
    "engine": metadata["version"]["number"], "clusterUuid": metadata["cluster_uuid"]
}, indent=2) + "\n")

class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    def log_message(self, *_):
        pass
    def do_GET(self):
        self.handle_native()
    def do_POST(self):
        self.handle_native()
    def do_DELETE(self):
        self.handle_native()
    def handle_native(self):
        try:
            if PUBLIC_FLIGHTS:
                credentials = ("authorization", "proxy-authorization", "cookie",
                               "x-api-key", "api-key", "x-auth-token")
                lengths = self.headers.get_all("content-length", [])
                if (any(self.headers.get(name) is not None for name in credentials)
                        or self.headers.get("transfer-encoding") is not None
                        or len(lengths) > 1):
                    raise PublicFlightPolicyError("PUBLIC_FLIGHT_HEADERS_REJECTED")
            parsed = urlsplit(self.path)
            if parsed.scheme or parsed.netloc or not self.path.startswith("/"):
                self.send_error(400)
                return
            base = parsed.path
            allowed = (
                self.command == "GET" and (base == "/" or base.endswith("/_field_caps") or base.endswith("/_mapping")) or
                self.command == "POST" and (base == "/_rank_eval" or base.endswith("/_search") or base.endswith("/_search/point_in_time")) or
                self.command == "DELETE" and base == "/_search/point_in_time"
            )
            if not allowed:
                self.send_error(405)
                return
            length = int(self.headers.get("content-length", "0"))
            if length < 0 or length > 262144:
                self.send_error(413)
                return
            body = self.rfile.read(length) if length else None
            if body is not None and len(body) != length:
                self.send_error(400)
                return
            status, headers, raw = native(self.command, self.path, body)
            self.send_response(status)
            self.send_header("Content-Type", headers.get("content-type", "application/json"))
            self.send_header("Content-Length", str(len(raw)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(raw)
        except PublicFlightPolicyError as error:
            raw = json.dumps({"error": "PUBLIC_FLIGHT_REQUEST_REJECTED",
                              "code": str(error)}).encode()
            try:
                self.send_response(403)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(raw)))
                self.send_header("Cache-Control", "no-store")
                self.end_headers()
                self.wfile.write(raw)
            except (BrokenPipeError, ConnectionResetError):
                pass
        except (BrokenPipeError, ConnectionResetError):
            pass
        except Exception:
            raw = b'{"error":"PLAYGROUND_TRANSPORT_FAILED"}'
            try:
                self.send_response(502)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(raw)))
                self.end_headers()
                self.wfile.write(raw)
            except (BrokenPipeError, ConnectionResetError):
                pass

server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
server.daemon_threads = True
endpoint = "http://127.0.0.1:" + str(server.server_port) + "/"
(ROOT / "bridge-ready.json").write_text(json.dumps({
    "endpoint": endpoint, "pid": os.getpid(), "index": index,
    "engineMetadata": str(ROOT / "native-engine.json"),
    "mapping": str(ROOT / "native-index-mapping.json"),
    "source": ORIGIN, "publicProfile": PROFILE_ID if PUBLIC_FLIGHTS else None
}, indent=2) + "\n")
print(json.dumps({"endpoint": endpoint, "index": index,
                  "version": metadata["version"]["number"],
                  "publicProfile": PROFILE_ID if PUBLIC_FLIGHTS else None,
                  "ready": str(ROOT / "bridge-ready.json")}), flush=True)
try:
    server.serve_forever()
finally:
    server.server_close()
    close_connections()

