"""Clean operator UI and the selected native deployment's stable HTTP GraphQL endpoint."""
from __future__ import annotations
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import mimetypes
from pathlib import Path
import shutil
import socket
import urllib.error
import urllib.parse
import urllib.request

from .controller import Controller
from .deployment import active
from .editions import edition_bytes, load_edition
from .native import status
from .programme import OriginalRedirects, response_body
from .util import identity, json_text, require
from .workspace import RevisionConflict, Workspace

HOP_HEADERS = {"connection", "keep-alive", "proxy-authenticate", "proxy-authorization",
               "te", "trailer", "transfer-encoding", "upgrade", "proxy-connection"}

def create_server(workspace_root, source_root, host="127.0.0.1", port=8794):
    """Create the same original server without entering its owned serving loop."""
    workspace_root, source_root = Path(workspace_root).resolve(), Path(source_root).resolve()
    require(host in {"127.0.0.1", "::1", "localhost"}, "Run the private operator on loopback and use the selected existing host access.")
    with Workspace(workspace_root):
        pass

    class Handler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def setup(self):
            super().setup()
            self.connection.settimeout(120)

        def end_headers(self):
            super().end_headers()
            self.headers_sent = True

        def failure(self, code, value):
            if self.headers_sent:
                self.close_connection = True
            else:
                self.response(code, value)

        def response(self, code, value, mime="application/json; charset=utf-8"):
            raw = value if isinstance(value, bytes) else (json_text(value) + "\n").encode("utf-8")
            self.send_response(code)
            self.send_header("Content-Type", mime)
            self.send_header("Content-Length", str(len(raw)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.end_headers()
            self.wfile.write(raw)

        def body(self):
            require("Content-Length" in self.headers, "Send the original request byte length.")
            require("Transfer-Encoding" not in self.headers, "Use Content-Length for operator commands.")
            length = int(self.headers["Content-Length"])
            require(length >= 0, "Invalid request byte length.")
            raw = self.rfile.read(length)
            require(len(raw) == length, "Request ended before its declared byte length.")
            return raw

        def check_origin(self):
            origin = self.headers.get("Origin")
            if origin:
                require(origin in {"http://" + self.headers.get("Host", "")},
                        "Open the operator on its current local origin before changing this workspace.")

        def send_file(self, path, filename, mime=None):
            path = Path(path)
            count = path.stat().st_size
            self.send_response(200)
            self.send_header("Content-Type", mime or mimetypes.guess_type(filename)[0] or "application/octet-stream")
            self.send_header("Content-Length", str(count))
            self.send_header("Content-Disposition", "attachment; filename*=UTF-8''" + urllib.parse.quote(filename, safe=""))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            with path.open("rb") as stream:
                remaining = count
                while remaining:
                    block = stream.read(min(1024 * 1024, remaining))
                    require(block, "The selected original file changed while reading it.")
                    self.wfile.write(block)
                    remaining -= len(block)

        def proxy(self, method, parsed):
            with Workspace(workspace_root) as ws:
                selected = active(ws)
                require(selected, "Select an accepted native deployment for the GraphQL endpoint.")
                observed = status(ws, selected["data"]["deployment"], probes=False)
                require(observed["observation"]["nativeAlive"], "The selected original native router is stopped.")
                require(observed["data"]["currentAttempt"]["id"] == selected["data"]["nativeAttempt"],
                        "Select the reviewed current native attempt for the endpoint.")
                base = selected["data"]["baseUrl"]
                native_path = selected["data"]["graphqlPath"]
            suffix = parsed.path.removeprefix("/graphql")
            path = (native_path.rstrip("/") + suffix) or "/"
            if parsed.query:
                path += "?" + parsed.query
            request_body = self.body() if method == "POST" else None
            connection_tokens = {token.strip().lower() for token in self.headers.get("Connection", "").split(",")}
            headers = {key: value for key, value in self.headers.items()
                       if key.lower() not in HOP_HEADERS | connection_tokens | {"host", "content-length"}}
            request = urllib.request.Request(base + path, data=request_body, headers=headers, method=method)
            opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), OriginalRedirects())
            try:
                response = opener.open(request, timeout=120)
            except urllib.error.HTTPError as error:
                response = error
            with response:
                self.send_response_only(response.status)
                tokens = {token.strip().lower() for token in response.headers.get("Connection", "").split(",")}
                for key, value in response.headers.items():
                    if key.lower() not in HOP_HEADERS | tokens | {"content-length"}:
                        self.send_header(key, value)
                # EOF framing preserves the original response bytes and streaming body.
                self.send_header("Connection", "close")
                self.close_connection = True
                self.end_headers()
                read = getattr(response, "read1", response.read)
                while block := read(64 * 1024):
                    self.wfile.write(block)
                    self.wfile.flush()

        def route(self, method):
            parsed = urllib.parse.urlsplit(self.path)
            query = {key: values[-1] for key, values in urllib.parse.parse_qs(parsed.query, keep_blank_values=True).items()}
            if parsed.path == "/graphql" or parsed.path.startswith("/graphql/"):
                return self.proxy(method, parsed)
            if method == "GET" and parsed.path in {"/", "/app.js", "/app.css"}:
                name = "index.html" if parsed.path == "/" else parsed.path[1:]
                return self.response(200, (source_root / "web" / name).read_bytes(),
                                     (mimetypes.guess_type(name)[0] or "text/plain") + "; charset=utf-8")
            with Workspace(workspace_root) as ws:
                controller = Controller(ws, source_root)
                if method == "GET" and parsed.path == "/api/state":
                    return self.response(200, controller.call("workspace.state"))
                if method == "GET" and parsed.path == "/api/edition-file":
                    edition = load_edition(ws, query["edition"])
                    raw = edition_bytes(ws, edition, query["path"])
                    return self.response(200, raw, "text/plain; charset=utf-8")
                if method == "GET" and parsed.path == "/api/response":
                    raw = response_body(ws, query["programme"], query["operation"])
                    return self.response(200, raw, "application/json; charset=utf-8")
                if method == "GET" and parsed.path.startswith("/api/file/"):
                    digest = parsed.path.removeprefix("/api/file/")
                    return self.send_file(ws.object_path(digest), Path(query.get("name", digest)).name)
                if method == "GET" and parsed.path == "/api/native-log":
                    item = ws.get("deployment", query["deployment"])
                    require(item, "Select the original native deployment.")
                    attempt = item["data"].get("currentAttempt", {})
                    if attempt.get("log"):
                        path = ws.object_path(attempt["log"]["sha256"])
                    else:
                        path = Path(attempt["logPath"])
                        require(path.resolve().is_relative_to(ws.root / "runtime"), "Open this installation's native log.")
                    return self.send_file(path, "hive-" + attempt["id"] + ".log", "text/plain; charset=utf-8")
                if method == "GET" and parsed.path == "/api/archive":
                    path = Path(query["path"]).resolve()
                    require(path.is_relative_to(ws.root / "deliveries"), "Download an edition exported by this workspace.")
                    require(identity(path)["sha256"] == query["sha256"], "The saved receiving archive changed.")
                    return self.send_file(path, path.name, "application/zip")
                if method == "POST" and parsed.path == "/api/action":
                    self.check_origin()
                    command = json.loads(self.body())
                    return self.response(200, controller.call(command["action"], command.get("data", {})))
            return self.response(404, {"error": "Unknown operator route."})

        def perform(self, method):
            self.headers_sent = False
            try:
                self.route(method)
            except RevisionConflict as error:
                self.failure(409, {"error": "Current item changed", "message": str(error)})
            except BlockingIOError:
                self.response(409, {"error": "Original operation is active", "message": "Reopen its saved current progress."})
            except (ValueError, KeyError, TypeError) as error:
                self.failure(400, {"error": type(error).__name__, "message": str(error)})
            except (BrokenPipeError, ConnectionResetError):
                self.close_connection = True
            except Exception as error:
                self.failure(500, {"error": type(error).__name__, "message": str(error)})

        def do_GET(self):
            self.perform("GET")

        def do_POST(self):
            self.perform("POST")

    class LocalHTTPServer(ThreadingHTTPServer):
        address_family = socket.AF_INET6 if ":" in host else socket.AF_INET

    httpd = LocalHTTPServer((host, int(port)), Handler)
    httpd.daemon_threads = False
    return httpd


def serve(workspace_root, source_root, host="127.0.0.1", port=8794):
    workspace_root, source_root = Path(workspace_root).resolve(), Path(source_root).resolve()
    httpd = create_server(workspace_root, source_root, host, port)
    address = "[" + host + "]" if ":" in host else host
    print(json_text({"operator": "http://" + address + ":" + str(httpd.server_port),
                     "graphql": "http://" + address + ":" + str(httpd.server_port) + "/graphql",
                     "workspace": str(workspace_root)}), flush=True)
    try:
        httpd.serve_forever()
    finally:
        httpd.server_close()
