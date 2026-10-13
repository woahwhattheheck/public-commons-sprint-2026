#!/usr/bin/env python3
"""Local, offline scenario design server with durable optimistic-revision storage."""
from __future__ import annotations
import argparse
import base64
import hashlib
import json
import os
import sqlite3
import sys
import threading
import uuid
from contextlib import contextmanager
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit, parse_qs

if __package__:
    from .eco_bridge import compile_plan
    from .conservation import import_binding, export_landcover, source_summary
    from .engine import (DesignError, SCHEMA, encode, digest, now, new_project, validate_project,
                         export_bundle, receive_bundle, geometry_info, geometry_cache_stats, realize)
else:
    from eco_bridge import compile_plan
    from conservation import import_binding, export_landcover, source_summary
    from engine import (DesignError, SCHEMA, encode, digest, now, new_project, validate_project,
                        export_bundle, receive_bundle, geometry_info, geometry_cache_stats, realize)

LIMIT = 100 * 1024 * 1024
WEB = Path(__file__).resolve().parent / "web"

class Conflict(DesignError):
    pass

class Store:
    """Each request uses its own SQLite connection; revision update is transactional."""
    def __init__(self, path: Path):
        self.path = str(path)
        path.parent.mkdir(parents=True, exist_ok=True)
        with self.connect() as db:
            db.execute("PRAGMA journal_mode=WAL")
            db.executescript("""CREATE TABLE IF NOT EXISTS projects(id TEXT PRIMARY KEY, title TEXT NOT NULL, revision INTEGER NOT NULL, updated TEXT NOT NULL, body BLOB NOT NULL);
            CREATE TABLE IF NOT EXISTS revisions(project_id TEXT NOT NULL, revision INTEGER NOT NULL, saved TEXT NOT NULL, body BLOB NOT NULL, PRIMARY KEY(project_id,revision));""")
    @contextmanager
    def connect(self):
        db = sqlite3.connect(self.path, timeout=30)
        try:
            db.execute("PRAGMA foreign_keys=ON")
            with db:
                yield db
        finally:
            db.close()
    def list(self):
        with self.connect() as db:
            rows = db.execute("SELECT id,title,revision,updated FROM projects ORDER BY updated DESC").fetchall()
        return [dict(zip(("id", "title", "revision", "updated"), x)) for x in rows]
    def get(self, pid):
        with self.connect() as db:
            result = db.execute("SELECT revision,body FROM projects WHERE id=?", (pid,)).fetchone()
        if result is None:
            raise KeyError(pid)
        return {"revision": result[0], "project": json.loads(result[1])}
    def save(self, project, expected, *, create=False):
        validate_project(project)
        if not isinstance(expected, int) or isinstance(expected, bool) or expected < 0:
            raise DesignError("Expected revision must be a non-negative integer")
        body = encode(project)
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            current = db.execute("SELECT revision,body FROM projects WHERE id=?", (project["id"],)).fetchone()
            if create and current is not None:
                raise Conflict("Project already exists; receive as an independent copy or reopen it")
            rev = current[0] if current else 0
            if expected != rev:
                raise Conflict(f"Saved revision is {rev}; your page has {expected}. Save a local recovery file, then reload to reconcile.")
            if current is not None:
                original = json.loads(current[1])
                if original["baseline"] != project["baseline"]:
                    raise Conflict("Saved original baseline is immutable; import a new project for new source data")
                if current[1] == body:
                    return {"revision": rev, "project": project}
            rev += 1
            stamp = now()
            db.execute("INSERT INTO projects VALUES (?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title,revision=excluded.revision,updated=excluded.updated,body=excluded.body", (project["id"], project["title"], rev, stamp, body))
            db.execute("INSERT INTO revisions VALUES (?,?,?,?)", (project["id"], rev, stamp, body))
        return {"revision": rev, "project": project}
    def history(self, pid):
        with self.connect() as db:
            rows = db.execute("SELECT revision,saved,LENGTH(body) FROM revisions WHERE project_id=? ORDER BY revision DESC", (pid,)).fetchall()
        return [dict(zip(("revision", "saved_at", "bytes"), x)) for x in rows]
    def revision(self, pid, rev):
        with self.connect() as db:
            row = db.execute("SELECT body FROM revisions WHERE project_id=? AND revision=?", (pid, rev)).fetchone()
        if row is None:
            raise KeyError(f"{pid}@{rev}")
        return json.loads(row[0])

def handler_for(store):
    class Handler(BaseHTTPRequestHandler):
        server_version = "EcoScenarioDesign/1.0"
        def log_message(self, fmt, *args):
            # Do not log request bodies, field data, or arbitrary incoming headers.
            sys.stderr.write(f"{self.command} {urlsplit(self.path).path} {args[1] if len(args)>1 else ''}\n")
        def _guard(self, write=False):
            host = self.headers.get("Host", "")
            allowed = {f"127.0.0.1:{self.server.server_port}", f"localhost:{self.server.server_port}", f"[::1]:{self.server.server_port}"}
            if host not in allowed:
                raise PermissionError("Loopback Host required")
            if write:
                origin = self.headers.get("Origin")
                if origin and origin not in {"http://" + h for h in allowed}:
                    raise PermissionError("Same-origin request required")
                if self.headers.get("X-Eco-Design") != "1":
                    raise PermissionError("X-Eco-Design request header required")
        def _body(self):
            try:
                length = int(self.headers.get("Content-Length", "0"))
            except ValueError as e:
                raise DesignError("Invalid content length") from e
            if not 0 < length <= LIMIT:
                raise DesignError("Request body must be between 1 byte and 100 MiB")
            body = self.rfile.read(length)
            if len(body) != length:
                raise DesignError("Truncated request body")
            return body
        def _send(self, status, value, content_type="application/json; charset=utf-8", filename=None):
            data = encode(value) if isinstance(value, (dict, list)) else value
            self.send_response(status)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Referrer-Policy", "no-referrer")
            self.send_header("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'")
            if filename:
                self.send_header("Content-Disposition", f'attachment; filename="{filename}"')
            self.end_headers()
            self.wfile.write(data)
        def _error(self, exc):
            if isinstance(exc, Conflict): status = 409
            elif isinstance(exc, PermissionError): status = 403
            elif isinstance(exc, KeyError): status = 404
            elif isinstance(exc, (DesignError, ValueError, TypeError)): status = 422
            else: status = 500
            self._send(status, {"error": str(exc) if status != 500 else "Internal error; original saved data is unchanged"})
            if status == 500:
                import traceback
                traceback.print_exc()
        def do_GET(self):
            try:
                self._guard()
                path = urlsplit(self.path).path
                args = parse_qs(urlsplit(self.path).query)
                static = {"/": ("index.html", "text/html; charset=utf-8"), "/app.js": ("app.js", "text/javascript; charset=utf-8"), "/style.css": ("style.css", "text/css; charset=utf-8")}
                if path in static:
                    file, kind = static[path]
                    return self._send(200, (WEB / file).read_bytes(), kind)
                if path == "/api/projects": return self._send(200, store.list())
                if path == "/api/health": return self._send(200, {"status": "ready", "schema": SCHEMA, "geometry_cache": geometry_cache_stats()})
                parts = path.strip("/").split("/")
                if len(parts) >= 3 and parts[:2] == ["api", "projects"]:
                    pid = parts[2]
                    if len(parts) == 3: return self._send(200, store.get(pid))
                    if parts[3:] == ["conservation-source"]: return self._send(200, {"source": source_summary(store.get(pid)["project"])})
                    if parts[3:] == ["history"]: return self._send(200, store.history(pid))
                    if len(parts) == 5 and parts[3] == "revisions": return self._send(200, store.revision(pid, int(parts[4])))
                    if parts[3:] == ["export"]:
                        return self._send(200, export_bundle(store.get(pid)["project"]), "application/zip", "eco-scenario-design.zip")
                    if parts[3:] == ["geojson"]:
                        result = realize(store.get(pid)["project"], args.get("alternative", [None])[0])
                        return self._send(200, encode(result), "application/geo+json", "scenario.geojson")
                raise KeyError("Endpoint not found")
            except Exception as e: self._error(e)
        def do_POST(self):
            try:
                self._guard(write=True)
                path = urlsplit(self.path).path
                raw = self._body()
                if path == "/api/receive-bundle":
                    project = receive_bundle(raw)
                    source_id = project["id"]
                    project["id"] = str(uuid.uuid4())
                    project["received_from"] = {"project_id": source_id, "received_at": now(), "bundle_sha256": hashlib.sha256(raw).hexdigest()}
                    return self._send(201, store.save(project, 0, create=True))
                data = json.loads(raw)
                if path == "/api/import-conservation":
                    if isinstance(data.get("source_base64"), str):
                        binding_raw = base64.b64decode(data["source_base64"], validate=True)
                    elif isinstance(data.get("source_text"), str):
                        binding_raw = data["source_text"].encode("utf-8")
                    else:
                        raise DesignError("The complete original binding bytes are required")
                    project = import_binding(binding_raw, title=data.get("title"), geometry_role=data.get("geometry_role", "reporting_units"))
                    return self._send(201, store.save(project, 0, create=True))
                if path == "/api/import":
                    source_text = data.get("source_text")
                    if not isinstance(source_text, str): raise DesignError("source_text must contain the original GeoJSON text")
                    project = new_project(json.loads(source_text), data.get("title", "Field scenario project"), data.get("filename", "fields.geojson"), source_text.encode("utf-8"))
                    return self._send(201, store.save(project, 0, create=True))
                if path == "/api/receive-project":
                    project = data["project"]
                    validate_project(project)
                    source_id = project["id"]
                    source_digest = digest(project)
                    project["id"] = str(uuid.uuid4())
                    project["received_from"] = {"project_id": source_id, "received_at": now(), "project_canonical_sha256": source_digest}
                    return self._send(201, store.save(project, 0, create=True))
                if path == "/api/validate":
                    return self._send(200, validate_project(data["project"]))
                if path == "/api/geometry":
                    return self._send(200, geometry_info(data["geometry"]))
                parts = path.strip("/").split("/")
                if len(parts) == 4 and parts[:2] == ["api", "projects"] and parts[3] == "upstate-plan":
                    project = store.get(parts[2])["project"]
                    bundle = export_landcover(project, data["alternative"], from_codes=data["from_codes"], to_code=data["to_code"], reason=data["reason"], prepare_run=data.get("prepare_run"))
                    return self._send(200, bundle, "application/zip", "eco-conservation-design.zip")
                if len(parts) == 4 and parts[:2] == ["api", "projects"] and parts[3] == "native-plan":
                    project = store.get(parts[2])["project"]
                    return self._send(200, compile_plan(project, data["alternative"], data["factor_map"], selector=data.get("selector", "field_id"), layer=data.get("layer", "fields"), materialized_inputs=bool(data.get("materialized_inputs", False))))
                if len(parts) == 3 and parts[:2] == ["api", "projects"]:
                    if data["project"]["id"] != parts[2]: raise DesignError("Project id differs from path")
                    return self._send(200, store.save(data["project"], data["revision"]))
                raise KeyError("Endpoint not found")
            except Exception as e: self._error(e)
    return Handler

def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--workspace", type=Path, default=Path.home() / ".eco-scenario-design")
    p.add_argument("--port", type=int, default=8848)
    p.add_argument("--export", metavar="PROJECT_ID", help="Export saved project to --output without starting a server")
    p.add_argument("--output", type=Path)
    args = p.parse_args()
    store = Store(args.workspace / "projects.sqlite3")
    if args.export:
        if not args.output: p.error("--output is required with --export")
        args.output.write_bytes(export_bundle(store.get(args.export)["project"]))
        return
    server = ThreadingHTTPServer(("127.0.0.1", args.port), handler_for(store))
    print(f"ECO Scenario Design: http://127.0.0.1:{server.server_port}\nWorkspace: {args.workspace.resolve()}", flush=True)
    try: server.serve_forever()
    except KeyboardInterrupt: pass
    finally: server.server_close()

if __name__ == "__main__": main()
