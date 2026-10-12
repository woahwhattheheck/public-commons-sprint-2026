#!/usr/bin/env python3
"""Local industrial operator UI for the original Aviary migration workspace."""
from __future__ import annotations

import functools
import hashlib
import http.server
import json
import mimetypes
import os
from pathlib import Path
import secrets
import sqlite3
import threading
from urllib.parse import parse_qs, quote, urlsplit
import uuid

import aviary as a
import aviary_client as client

BODY_LIMIT = 16 * 1024 * 1024


class Workbench:
    def __init__(self, workspace, port):
        self.root = Path(workspace).resolve()
        with a.connect(self.root) as db:
            identity = a.meta(db, "identity")
        self.port = port
        self.csrf = secrets.token_urlsafe(32)
        self.artifacts = self.root.parent / (self.root.name + "-deliveries")
        self.artifacts.mkdir(mode=0o700, exist_ok=True)
        self.jobs_path = self.root / "operator-jobs.json"
        self.guard = threading.Lock()
        self.active = None
        self.jobs = a.read_json(self.jobs_path) if self.jobs_path.exists() else []
        for item in self.jobs:
            if item["state"] in ("QUEUED", "RUNNING"):
                item.update({"state": "INTERRUPTED",
                             "message": "Operator server restarted. Reopen the original saved operation."})
        self.persist()

    def persist(self):
        a.write_json(self.jobs_path, self.jobs)

    def queue(self, kind, arguments, action):
        with self.guard:
            if self.active:
                raise a.Problem("BUSY", "The original workspace operation is still running.",
                                {"jobId": self.active})
            job = {"id": uuid.uuid4().hex, "kind": kind, "arguments": arguments,
                   "state": "QUEUED", "created": a.now()}
            self.jobs.append(job)
            self.active = job["id"]
            self.persist()

        def work():
            with self.guard:
                job.update({"state": "RUNNING", "started": a.now()})
                self.persist()
            try:
                result = action()
                with self.guard:
                    job.update({"state": "COMPLETED", "completed": a.now(), "result": result})
            except a.Problem as error:
                with self.guard:
                    job.update({"state": "FAILED", "completed": a.now(), "error": error.as_dict()})
            except BaseException as error:
                with self.guard:
                    job.update({"state": "FAILED", "completed": a.now(),
                                "error": {"error": type(error).__name__, "message": str(error)}})
            finally:
                with self.guard:
                    self.active = None
                    self.persist()
        threading.Thread(target=work, name="aviary-" + kind, daemon=False).start()
        return {"job": job, "queued": True}

    def output(self, suffix):
        return self.artifacts / ("Aviary_" + suffix + "_" + a.now().replace(":", "").replace(".", "") + ".zip")

    def summaries(self):
        with self.guard:
            jobs = json.loads(json.dumps(self.jobs))
            active = self.active
        with a.connect(self.root) as db:
            runs = []
            for row in db.execute("SELECT id,revision,created FROM runs ORDER BY created"):
                states = dict(db.execute("SELECT state,count(*) FROM actions WHERE run_id=? GROUP BY state",
                                         (row["id"],)).fetchall())
                runs.append(dict(row) | {"states": states})
        return {"active": active, "jobs": jobs, "runs": runs}


class Handler(http.server.BaseHTTPRequestHandler):
    server_version = "AviaryWorkbench/1.0"

    @property
    def app(self):
        return self.server.workbench

    def log_message(self, format, *args):
        # URL query values and entered metadata stay out of access logs.
        return

    def base_checks(self, mutation=False):
        host = self.headers.get("Host", "")
        expected = {f"127.0.0.1:{self.app.port}", f"localhost:{self.app.port}"}
        if host not in expected:
            raise a.Problem("HOST", "Use the local workbench address printed by the server.")
        origin = self.headers.get("Origin")
        if origin and origin not in {"http://" + value for value in expected}:
            raise a.Problem("ORIGIN", "This request came from a different website.")
        if mutation and not secrets.compare_digest(self.headers.get("X-Workspace-Token", ""), self.app.csrf):
            raise a.Problem("REQUEST_TOKEN", "Refresh this workbench tab before sending a change.")

    def send_content(self, status, content, content_type="application/json; charset=utf-8", filename=None):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(content)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "same-origin")
        self.send_header("Content-Security-Policy",
            "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; "
            "img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'")
        if filename:
            self.send_header("Content-Disposition", "attachment; filename*=UTF-8''" + quote(filename))
        self.end_headers()
        try:
            self.wfile.write(content)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def send_json(self, status, value):
        self.send_content(status, a.encoded(value))

    def body(self):
        if self.headers.get("Content-Type", "").split(";")[0].strip() != "application/json":
            raise a.Problem("CONTENT_TYPE", "Send a JSON request.")
        if self.headers.get("Transfer-Encoding"):
            raise a.Problem("CONTENT_LENGTH", "Chunked operator requests are unsupported.")
        try:
            size = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            raise a.Problem("CONTENT_LENGTH", "Content-Length must be an integer.")
        if not 0 < size <= BODY_LIMIT:
            raise a.Problem("CONTENT_LENGTH", "Operator JSON request must be 1 byte to 16 MiB.")
        try:
            result = json.loads(self.rfile.read(size))
        except (UnicodeError, ValueError):
            raise a.Problem("JSON", "Request body is not valid JSON.")
        if not isinstance(result, dict):
            raise a.Problem("JSON", "Request body must be an object.")
        return result

    def do_GET(self):
        try:
            self.base_checks()
            parsed = urlsplit(self.path)
            query = parse_qs(parsed.query)
            path = parsed.path
            if path in ("/", "/index.html", "/app.js"):
                name = "app.js" if path == "/app.js" else "index.html"
                content = (Path(__file__).resolve().parent / name).read_bytes()
                self.send_content(200, content, "text/javascript; charset=utf-8" if name.endswith(".js")
                                  else "text/html; charset=utf-8")
            elif path == "/api/state":
                self.send_json(200, {"csrf": self.app.csrf, "status": a.show(self.app.root),
                                    "jobs": self.app.summaries(), "fields": a.FIELDS})
            elif path == "/api/jobs":
                self.send_json(200, self.app.summaries())
            elif path == "/api/preview":
                kind = query.get("table", ["resources"])[0]
                if kind not in a.KINDS:
                    raise a.Problem("TABLE", "Unknown preview table.")
                offset = max(0, int(query.get("offset", ["0"])[0]))
                limit = min(200, max(1, int(query.get("limit", ["50"])[0])))
                result = a.preview(self.app.root)
                rows = result["tables"][kind]
                result["tables"] = {kind: rows[offset:offset + limit]}
                result["page"] = {"table": kind, "offset": offset, "limit": limit,
                                  "total": len(rows), "nextOffset": offset + limit if offset + limit < len(rows) else None}
                self.send_json(200, result)
            elif path == "/api/source-table":
                name = query.get("path", [""])[0]
                source = a.meta_from_workspace(self.app.root, "source")
                if name not in {item["path"] for item in source["files"]} or not name.lower().endswith(".csv"):
                    raise a.Problem("SOURCE", "Select a retained CSV member.")
                table = a.read_csv(a.within(self.app.root / "source", name))
                self.send_json(200, {"headers": table["headers"], "rows": table["rows"][:5],
                                    "totalRows": len(table["rows"])})
            elif path == "/api/operation":
                with a.connect(self.app.root) as db:
                    result = client.operation(db, query.get("id", [""])[0])
                self.send_json(200, {key: result[key] for key in ("id", "revision", "config", "mappingSha256")})
            elif path == "/api/events":
                after = max(0, int(query.get("after", ["0"])[0]))
                limit = min(200, max(1, int(query.get("limit", ["100"])[0])))
                with a.connect(self.app.root) as db:
                    rows = [dict(row) for row in db.execute(
                        "SELECT sequence,run_id,action_key,kind,created FROM events WHERE sequence>? ORDER BY sequence LIMIT ?",
                        (after, limit))]
                    latest = db.execute("SELECT coalesce(max(sequence),0) FROM events").fetchone()[0]
                next_after = rows[-1]["sequence"] if rows else after
                self.send_json(200, {"events": rows, "nextAfter": next_after,
                                    "complete": next_after >= latest, "latestSequence": latest})
            elif path == "/api/artifacts":
                files = []
                for entry in sorted(self.app.artifacts.iterdir()):
                    if entry.is_file() and not entry.is_symlink() and not entry.name.startswith("."):
                        info = entry.stat()
                        files.append({"name": entry.name, "bytes": info.st_size,
                                      "downloadUrl": "/download/" + quote(entry.name)})
                self.send_json(200, {"files": files})
            elif path.startswith("/download/"):
                from urllib.parse import unquote
                name = unquote(path[len("/download/"):])
                if a.relative(name) != Path(name).name:
                    raise a.Problem("PATH", "Artifact name must be a basename.")
                file = a.within(self.app.artifacts, name)
                if not file.is_file():
                    raise a.Problem("ARTIFACT", "Artifact is not available.")
                size = file.stat().st_size
                self.send_response(200)
                self.send_header("Content-Type", mimetypes.guess_type(name)[0] or "application/octet-stream")
                self.send_header("Content-Disposition", "attachment; filename*=UTF-8''" + quote(name))
                self.send_header("Content-Length", str(size))
                self.send_header("Cache-Control", "no-store")
                self.send_header("X-Content-Type-Options", "nosniff")
                self.end_headers()
                with open(file, "rb") as source:
                    while block := source.read(a.CHUNK):
                        self.wfile.write(block)
            elif path == "/review":
                content = a.report_html(a.preview(self.app.root), a.show(self.app.root))
                self.send_content(200, content.encode(), "text/html; charset=utf-8")
            else:
                self.send_json(404, {"error": "NOT_FOUND", "message": "Page does not exist."})
        except a.Problem as error:
            self.send_json(409 if error.code in ("BUSY", "REVISION_CONFLICT") else 400, error.as_dict())
        except (ValueError, KeyError) as error:
            self.send_json(400, {"error": "INPUT", "message": str(error)})
        except (BrokenPipeError, ConnectionResetError):
            pass
        except BaseException as error:
            self.send_json(500, {"error": type(error).__name__, "message": str(error)})

    def do_POST(self):
        try:
            self.base_checks(mutation=True)
            data = self.body()
            path = urlsplit(self.path).path
            if path == "/api/mapping":
                result = a.save_mapping(self.app.root, data["document"], int(data["expectedRevision"]))
            elif path == "/api/assign-keys":
                result = a.allocate_keys(self.app.root, int(data["expectedRevision"]))
            elif path == "/api/plan":
                result = client.plan(self.app.root, data["config"], data["operationId"], data.get("revision"))
            elif path == "/api/run":
                operation = data["operationId"]
                result = self.app.queue("migration", {"operationId": operation},
                                        lambda: client.run(self.app.root, operation))
            elif path == "/api/transcripts":
                operation = data["operationId"]
                result = self.app.queue("transcripts", {"operationId": operation},
                                        lambda: client.export_transcripts(self.app.root, operation))
            elif path == "/api/reconcile":
                result = client.reconcile(self.app.root, data["operationId"], data["action"],
                                          data["providerId"], data["note"])
            elif path == "/api/refresh-upload":
                result = client.refresh_upload(self.app.root, data["operationId"], data["mediaKey"], data["manifest"])
            elif path == "/api/package":
                output = self.app.output("Native_Package")
                result = self.app.queue("native-package", {"output": str(output)},
                                        lambda: a.build_package(self.app.root, output))
            elif path == "/api/export":
                output = self.app.output("Complete_Workspace")
                result = self.app.queue("workspace-export", {"output": str(output)},
                                        lambda: a.export_workspace(self.app.root, output))
            else:
                self.send_json(404, {"error": "NOT_FOUND", "message": "Operation does not exist."})
                return
            self.send_json(202 if result.get("queued") else 200, result)
        except a.Problem as error:
            self.send_json(409 if error.code in ("BUSY", "REVISION_CONFLICT", "ORIGINAL_OPERATION") else 400,
                           error.as_dict())
        except (KeyError, TypeError, ValueError) as error:
            self.send_json(400, {"error": "INPUT", "message": str(error)})
        except BaseException as error:
            self.send_json(500, {"error": type(error).__name__, "message": str(error)})


def serve(workspace, port=8769):
    if not 1 <= port <= 65535:
        raise a.Problem("PORT", "Port must be from 1 to 65535.")
    app = Workbench(workspace, port)
    server = http.server.ThreadingHTTPServer(("127.0.0.1", port), Handler)
    server.workbench = app
    print(json.dumps({"url": f"http://127.0.0.1:{port}", "workspace": str(app.root),
                      "label": a.meta_from_workspace(app.root, "identity")["label"]}), flush=True)
    try:
        server.serve_forever(poll_interval=0.25)
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
    return 0
