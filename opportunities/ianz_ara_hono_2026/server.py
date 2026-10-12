"""Local browser application, backed by the same durable Workspace API."""
from __future__ import annotations
import argparse
import contextlib
import http.cookies
import http.server
import json
import mimetypes
import pathlib
import re
import secrets
import sqlite3
import urllib.parse
from schema import ROOT, MAX_FILE_BYTES, WorkspaceError, dumps, loads
from workspace import Workspace
import mapping

MAX_REQUEST = (MAX_FILE_BYTES + 2) // 3 * 4 + 2 * 1024 * 1024

def make_server(workspace, *, host="127.0.0.1", port=8765):
    if host not in {"127.0.0.1", "::1", "localhost"}:
        raise WorkspaceError("This operator application binds to the local machine.")
    session = secrets.token_urlsafe(32)

    class Handler(http.server.BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"
        server_version = "AraHono/1"
        def log_message(self, format, *args):
            # The operating process retains its own request output; uploaded file
            # names, keys and query strings do not enter a shared access log.
            return
        @property
        def origin(self):
            return "http://" + self.headers.get("Host", "")
        def checked_origin(self):
            expected = {"127.0.0.1:" + str(self.server.server_address[1]), "localhost:" + str(self.server.server_address[1])}
            if self.headers.get("Host") not in expected:
                raise WorkspaceError("Use this application's original local address.", status=403)
            supplied = self.headers.get("Origin")
            if supplied and supplied != self.origin:
                raise WorkspaceError("This request came from a different browser origin.", status=403)
            if self.headers.get("Sec-Fetch-Site") == "cross-site":
                raise WorkspaceError("Open the local application to use this action.", status=403)
        def authorised(self):
            self.checked_origin()
            cookies = http.cookies.SimpleCookie()
            with contextlib.suppress(http.cookies.CookieError):
                cookies.load(self.headers.get("Cookie", ""))
            supplied = cookies.get("arahono_session")
            if not supplied or not secrets.compare_digest(supplied.value, session):
                raise WorkspaceError("Reopen the local application to establish this browser session.", status=401)
        def reply(self, status, body=b"", media_type="application/json", *, headers=None):
            if not isinstance(body, bytes):
                body = (dumps(body) + "\n").encode()
            self.send_response(status)
            self.send_header("Content-Type", media_type)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Referrer-Policy", "no-referrer")
            self.send_header("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'")
            for name, value in (headers or {}).items():
                self.send_header(name, value)
            self.end_headers()
            if self.command != "HEAD":
                self.wfile.write(body)
        def error(self, error):
            if isinstance(error, WorkspaceError):
                self.reply(error.status, error.as_dict())
            elif isinstance(error, (ValueError, KeyError, TypeError)):
                self.reply(422, {"error": "invalid_input", "message": str(error)})
            elif isinstance(error, sqlite3.Error):
                self.reply(503, {"error": "save_unavailable",
                                 "message": "The native save did not finish. Keep the pending request and reopen its recorded result before replay.",
                                 "details": str(error)})
            else:
                self.reply(500, {"error": "application_error", "message": type(error).__name__ + ": " + str(error)})
        def parts(self):
            url = urllib.parse.urlsplit(self.path)
            return url.path, {key: values[0] for key, values in urllib.parse.parse_qs(url.query, keep_blank_values=True).items()}
        def do_GET(self):
            try:
                self.checked_origin()
                path, query = self.parts()
                static = {"/": "web/index.html", "/app.js": "web/app.js", "/style.css": "web/style.css"}
                if path in static:
                    body = (ROOT / static[path]).read_bytes()
                    media = "text/html; charset=utf-8" if path == "/" else "text/javascript; charset=utf-8" if path.endswith(".js") else "text/css; charset=utf-8"
                    self.reply(200, body, media, headers={"Set-Cookie": "arahono_session=" + session + "; Path=/; HttpOnly; SameSite=Strict"})
                    return
                if path == "/health":
                    self.reply(200, {"ready": True, "application": "IANZ Ara Hono"})
                    return
                self.authorised()
                if path == "/api/state":
                    self.reply(200, workspace.summary())
                elif path == "/api/records":
                    limit = min(max(int(query.get("limit", "100")), 1), 500)
                    rows = workspace.records(query["entity"], limit=limit + 1, after=query.get("after", ""),
                                              search=query.get("search", ""))
                    self.reply(200, {"records": rows[:limit], "revision": workspace.metadata()["revision"],
                                     "next_cursor": rows[limit - 1]["key"] if len(rows) > limit else None})
                elif path == "/api/record":
                    self.reply(200, workspace.record(query["entity"], query["key"], query.get("edition_id")))
                elif path == "/api/history":
                    self.reply(200, {"records": workspace.history(query["entity"], query["key"])})
                elif path == "/api/files":
                    self.reply(200, {"files": workspace.files(limit=query.get("limit", 100), after=query.get("after", ""))})
                elif re.fullmatch(r"/api/files/[a-f0-9]{64}", path):
                    file = workspace.file(path.rsplit("/", 1)[-1])
                    filename = urllib.parse.quote(file.get("filename", file["sha256"]), safe="")
                    self.reply(200, file["body"], file.get("media_type", "application/octet-stream"),
                               headers={"Content-Disposition": "attachment; filename=\"original-file\"; filename*=UTF-8''" + filename,
                                        "ETag": '"' + file["sha256"] + '"'})
                elif path == "/api/request":
                    self.reply(200, workspace.command(query["request_id"], hydrate=query.get("hydrate") == "true"))
                elif path == "/api/events":
                    self.reply(200, {"events": workspace.events(subject=query.get("subject"), kind=query.get("kind"),
                                                                 limit=query.get("limit", 200),
                                                                 after_revision=int(query.get("after_revision", "0")))})
                elif path == "/api/receiving":
                    self.reply(200, workspace.receiving(query["run_id"]))
                elif path == "/api/mapping-preview":
                    selected = workspace.record("mapping_profile", query["mapping_key"]) if query.get("mapping_key") else workspace.active_mapping()
                    if not selected:
                        raise WorkspaceError("Select a saved mapping.")
                    projected = mapping.export_dataset(workspace.all_records(), selected["values"])
                    self.reply(200, {"record_count": len(projected["records"]), "issues": projected["issues"],
                                     "omissions": projected["omissions"], "relationships": len(projected["relationships"])})
                elif path == "/api/public-profile":
                    allowed = {"changes": "data/source-change-review.json", "transition": "data/transition-profile.json",
                               "tariff-controls": "data/fee-controls.json"}
                    if query.get("name") not in allowed:
                        raise WorkspaceError("Choose a retained public profile.")
                    self.reply(200, loads((ROOT / allowed[query["name"]]).read_bytes()))
                elif path == "/api/handover":
                    package, manifest = workspace.handover()
                    filename = "IANZ_Ara_Hono_Project_r" + str(manifest["revision"]) + ".zip"
                    self.reply(200, package, "application/zip",
                               headers={"Content-Disposition": 'attachment; filename="' + filename + '"'})
                else:
                    self.reply(404, {"error": "not_found", "message": "This local application route does not exist."})
            except (BrokenPipeError, ConnectionResetError):
                return
            except Exception as error:
                self.error(error)
        def do_POST(self):
            try:
                self.authorised()
                path, query = self.parts()
                if path != "/api/command":
                    raise WorkspaceError("Choose an actual command route.", status=404)
                if self.headers.get_content_type() != "application/json":
                    raise WorkspaceError("Commands use application/json.", status=415)
                if self.headers.get("Transfer-Encoding"):
                    raise WorkspaceError("Send one complete command with its byte length.")
                try:
                    size = int(self.headers.get("Content-Length", "-1"))
                except ValueError:
                    size = -1
                if not 0 < size <= MAX_REQUEST:
                    raise WorkspaceError("The complete command exceeds the receiving request capacity.", status=413)
                body = self.rfile.read(size)
                if len(body) != size:
                    raise WorkspaceError("The complete original request body was not received.")
                result = workspace.execute(loads(body))
                self.reply(200, result)
            except (BrokenPipeError, ConnectionResetError):
                return
            except Exception as error:
                self.error(error)
        def do_OPTIONS(self):
            self.reply(405, {"error": "cross_origin_not_supported", "message": "Use the local application."})

    server = http.server.ThreadingHTTPServer((host, port), Handler)
    server.daemon_threads = True
    return server

def main():
    parser = argparse.ArgumentParser(description="Open the saved IANZ accreditation workbench on this machine.")
    parser.add_argument("--workspace", required=True)
    parser.add_argument("--port", type=int, default=8765)
    args = parser.parse_args()
    workspace = Workspace(args.workspace)
    server = make_server(workspace, port=args.port)
    print(dumps({"application": "IANZ Ara Hono", "url": "http://127.0.0.1:" + str(server.server_address[1]),
                 "workspace": str(workspace.directory), "project_id": workspace.metadata()["project_id"]}), flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
        workspace.close()

if __name__ == "__main__":
    main()
