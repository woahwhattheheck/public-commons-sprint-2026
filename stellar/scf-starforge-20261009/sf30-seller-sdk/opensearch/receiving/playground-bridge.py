#!/usr/bin/env python3
"""MIT. Private byte-preserving transport to the official OpenSearch Playground."""
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from http.cookiejar import CookieJar
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import urlencode, urlsplit, urljoin
from urllib.request import Request, HTTPCookieProcessor, build_opener, HTTPRedirectHandler
import json, threading, os, sys

ROOT = Path(sys.argv[1]).resolve()
ROOT.mkdir(parents=True, exist_ok=True, mode=0o700)
ORIGIN = "https://playground.opensearch.org"
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
    if urlsplit(guest_url).scheme != "https" or urlsplit(guest_url).hostname != "playground.opensearch.org":
        raise RuntimeError("Unexpected anonymous session destination")
else:
    raise RuntimeError("Anonymous session redirect limit")
opener = build_opener(HTTPCookieProcessor(jar))
transport_lock = threading.RLock()

def native(method, path, body=None):
    url = ORIGIN + "/api/console/proxy?" + urlencode({"path": path, "method": method})
    request = Request(url, data=body or b"", method="POST", headers={
        "osd-xsrf": "true", "content-type": "application/json",
        "accept": "application/json", "accept-encoding": "identity"
    })
    with transport_lock:
        try:
            response = opener.open(request, timeout=35)
        except HTTPError as error:
            response = error
        with response:
            raw = response.read(2 * 1024 * 1024 + 1)
            if len(raw) > 2 * 1024 * 1024:
                raise ValueError("native response exceeds transport limit")
            item = {"method": method, "path": path, "status": response.code, "responseBytes": len(raw)}
            if response.code >= 400:
                item["nativeError"] = raw[:16000].decode("utf-8", "replace")
            with (ROOT / "native-requests.jsonl").open("a", encoding="utf-8") as journal:
                journal.write(json.dumps(item) + "\n")
            os.chmod(ROOT / "native-requests.jsonl", 0o600)
            return response.code, response.headers, raw

status, _, raw = native("GET", "/")
if status != 200:
    raise RuntimeError("native root status " + str(status))
metadata = json.loads(raw)
if metadata.get("version", {}).get("distribution") != "opensearch":
    raise RuntimeError("unexpected native distribution")
(ROOT / "native-engine.json").write_bytes(raw)
status, _, raw = native("GET", "/_cat/indices?format=json&h=index,docs.count&bytes=b")
if status != 200:
    raise RuntimeError("native index metadata status " + str(status))
indices = json.loads(raw)
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
            parsed = urlsplit(self.path)
            if parsed.scheme or parsed.netloc or not self.path.startswith("/"):
                self.send_error(400)
                return
            base = parsed.path
            allowed = (
                self.command == "GET" and (base == "/" or base.endswith("/_field_caps") or base.endswith("/_mapping")) or
                self.command == "POST" and (base.endswith("/_search") or base.endswith("/_search/point_in_time")) or
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
    "source": ORIGIN
}, indent=2) + "\n")
print(json.dumps({"endpoint": endpoint, "index": index,
                  "version": metadata["version"]["number"],
                  "ready": str(ROOT / "bridge-ready.json")}), flush=True)
try:
    server.serve_forever()
finally:
    server.server_close()
