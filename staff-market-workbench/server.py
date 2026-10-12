"""Same-origin loopback browser service over the original native workspace."""
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import mimetypes
import os
from pathlib import Path
import re
import sqlite3
from urllib.parse import parse_qs, quote, unquote, urlsplit
from core import Workspace, Problem, strict_json, restore, EXTENSIONS

STATIC = Path(__file__).resolve().parent / "web"
MAX_BODY = 48 * 1024 * 1024


def serve(directory, host, port):
    if host not in {"127.0.0.1", "localhost"}:
        raise Problem("This receiving application binds to loopback; choose 127.0.0.1 or localhost")
    workspace = Workspace(directory)

    class Handler(BaseHTTPRequestHandler):
        server_version = "MarketWorkbench/1"

        def log_message(self, fmt, *args):
            pass

        def boundary(self, write=False):
            supplied = self.headers.get("Host", "")
            if supplied not in {"127.0.0.1:" + str(self.server.server_port), "localhost:" + str(self.server.server_port)}:
                raise Problem("Use the exact local service address", 403, "HOST_MISMATCH")
            origin = self.headers.get("Origin")
            if origin and origin != "http://" + supplied:
                raise Problem("Origin differs from this local service", 403, "ORIGIN_MISMATCH")
            if write and self.headers.get("Content-Type", "").split(";")[0].lower() != "application/json":
                raise Problem("Writes require application/json", 415, "CONTENT_TYPE")

        def send_bytes(self, body, mime, status=200, filename=None):
            self.send_response(status)
            self.send_header("Content-Type", mime)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Referrer-Policy", "same-origin")
            self.send_header("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'")
            if filename:
                clean = str(filename).replace("\r", "").replace("\n", "").rsplit("/", 1)[-1].rsplit("\\", 1)[-1]
                fallback = re.sub(r'[^A-Za-z0-9._ -]', '_', clean) or "download"
                self.send_header("Content-Disposition", 'attachment; filename="' + fallback + '"; filename*=UTF-8\'\'' + quote(clean))
            self.end_headers()
            self.wfile.write(body)

        def json(self, value, status=200):
            self.send_bytes((json.dumps(value, ensure_ascii=False, allow_nan=False) + "\n").encode(), "application/json; charset=utf-8", status)

        def problem(self, exc):
            if isinstance(exc, (BrokenPipeError, ConnectionResetError)):
                return
            status = exc.status if isinstance(exc, Problem) else 507 if isinstance(exc, OSError) and exc.errno == 28 else 500
            self.json({"error": str(exc), "code": getattr(exc, "code", "NATIVE_ERROR"), "details": getattr(exc, "details", None)}, status)

        def do_GET(self):
            try:
                self.boundary()
                url = urlsplit(self.path)
                path = unquote(url.path)
                query = {k: v[-1] for k, v in parse_qs(url.query).items()}
                if path == "/api/state": return self.json(workspace.state())
                if path == "/health": return self.json({"workspace_id": workspace.state()["workspace"]["id"], "pid": os.getpid(), "port": self.server.server_port})
                if path.startswith("/api/extensions/"):
                    parts = path.strip("/").split("/")
                    if len(parts) == 4 and parts[3] == "state":
                        return self.json(workspace.extension_read(parts[2]))
                    if len(parts) == 6 and parts[3] in {"document", "download"}:
                        result = workspace.extension_read(parts[2], parts[3], parts[4], parts[5])
                        if parts[3] == "document":
                            return self.json(result)
                        if not isinstance(result, dict) or not isinstance(result.get("data"), bytes):
                            raise Problem("Extension download did not return its native bytes", 500)
                        return self.send_bytes(result["data"], result.get("content_type", "application/octet-stream"), filename=result.get("filename", "download"))
                    raise Problem("Extension route is absent", 404, "NOT_FOUND")
                if path.startswith("/api/records/"):
                    try:
                        offset, limit = int(query.get("offset", 0)), int(query.get("limit", 100))
                    except ValueError as exc:
                        raise Problem("Record page offset and limit must be integers") from exc
                    publisher_scope = {"kind": query.get("publisher_kind"), "id": query.get("publisher_id")} if "publisher_kind" in query or "publisher_id" in query else None
                    return self.json(workspace.records(path.rsplit("/", 1)[1], query.get("q", ""), offset, limit, query.get("current", "true") != "false", query.get("source_id"), publisher_scope))
                if path.startswith("/api/source-rows/"):
                    try:
                        offset, limit = int(query.get("offset", 0)), int(query.get("limit", 30))
                    except ValueError as exc:
                        raise Problem("Source page offset and limit must be integers") from exc
                    return self.json(workspace.source_rows(path.rsplit("/", 1)[1], offset, limit))
                if path.startswith("/api/document/"):
                    _, _, _, kind, identity = path.split("/", 4)
                    return self.json(workspace.document(kind, identity))
                if path.startswith("/api/report/"):
                    identity = path.rsplit("/", 1)[1]
                    fmt = query.get("format", "json")
                    return self.send_bytes(workspace.report(identity, fmt), "text/csv; charset=utf-8" if fmt == "csv" else "application/json", filename=identity + "." + fmt)
                if path.startswith("/api/backup/"):
                    target = workspace.backup(path.rsplit("/", 1)[1])
                    self.send_response(200)
                    self.send_header("Content-Type", "application/zip")
                    self.send_header("Content-Length", str(target.stat().st_size))
                    self.send_header("Content-Disposition", 'attachment; filename="' + target.name + '"')
                    self.send_header("Cache-Control", "no-store")
                    self.end_headers()
                    with target.open("rb") as f:
                        for part in iter(lambda: f.read(1024 * 1024), b""):
                            self.wfile.write(part)
                    return
                if path.startswith("/api/original/"):
                    identity = path.rsplit("/", 1)[1]
                    source = workspace.document("source", identity)
                    db = workspace.connect()
                    try: row = db.execute("SELECT data FROM blobs WHERE sha=?", (source["raw_sha256"],)).fetchone()
                    finally: db.close()
                    return self.send_bytes(bytes(row[0]), "application/octet-stream", filename=identity + (".json" if source["filename"].lower().endswith(".json") else ".csv"))
                if path.startswith("/extensions/"):
                    parts = path.split("/", 3)
                    if len(parts) != 4 or parts[2] not in EXTENSIONS:
                        raise Problem("Extension asset is absent", 404)
                    root = STATIC.parent / EXTENSIONS[parts[2]].split(".")[0]
                    asset = (root / parts[3]).resolve()
                    if not asset.is_relative_to(root.resolve()) or asset.suffix not in {".mjs", ".js", ".css"} or not asset.is_file():
                        raise Problem("Extension asset is absent", 404)
                    mime = "text/css" if asset.suffix == ".css" else "application/javascript"
                    return self.send_bytes(asset.read_bytes(), mime + "; charset=utf-8")
                asset = "index.html" if path == "/" else path.lstrip("/")
                if asset not in {"index.html", "app.js", "app.css", "receiving-bridge.mjs"}:
                    raise Problem("Route is absent", 404, "NOT_FOUND")
                mime = "application/javascript" if asset.endswith(".mjs") else mimetypes.guess_type(asset)[0]
                return self.send_bytes((STATIC / asset).read_bytes(), mime + "; charset=utf-8")
            except Exception as exc:
                self.problem(exc)

        def do_POST(self):
            try:
                self.boundary(True)
                length = self.headers.get("Content-Length")
                if not length or not length.isdigit() or int(length) > MAX_BODY:
                    raise Problem("Explicit JSON body no larger than 48 MiB required", 413)
                self.connection.settimeout(30)
                raw = self.rfile.read(int(length))
                if len(raw) != int(length):
                    raise Problem("Request ended before its declared body")
                body = strict_json(raw.decode("utf-8"))
                path = urlsplit(self.path).path
                if path == "/api/restore":
                    if not isinstance(body, dict): raise Problem("Restore requires an object")
                    return self.json(restore(body.get("package", ""), body.get("directory", "")))
                if path.startswith("/api/extensions/"):
                    parts = path.strip("/").split("/")
                    if len(parts) != 4 or parts[2] not in EXTENSIONS:
                        raise Problem("Extension route is absent", 404)
                    return self.json(workspace.mutate(parts[2] + "." + parts[3], body))
                routes = {"/api/import/preview": "preview", "/api/import/commit": "import", "/api/selection": "selection", "/api/analysis": "analysis", "/api/review": "review", "/api/cycle": "cycle", "/api/title": "title", "/api/backup": "prepare_backup"}
                routes["/api/job-review"] = "job_review"
                if path not in routes: raise Problem("Route is absent", 404, "NOT_FOUND")
                return self.json(workspace.mutate(routes[path], body))
            except Exception as exc:
                self.problem(exc)

    server = ThreadingHTTPServer((host, port), Handler)
    server.daemon_threads = True
    print(json.dumps({"url": "http://" + host + ":" + str(server.server_port), "pid": os.getpid(), "workspace_id": workspace.state()["workspace"]["id"], "directory": str(workspace.root)}), flush=True)
    try: server.serve_forever(poll_interval=0.3)
    except KeyboardInterrupt: pass
    finally: server.server_close()
    return 0
