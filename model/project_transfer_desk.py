"""Loopback transfer desk for source holders and independent receivers.

The scientific operator adapter uses the original queue. This optional standalone
entry serves only project file transfers on a machine without GIS dependencies.
"""
from __future__ import annotations
import concurrent.futures
import contextlib
import hashlib
import hmac
import http.cookies
import json
import mimetypes
import os
from pathlib import Path
import re
import secrets
import tempfile
import threading
import time
import urllib.parse
import uuid
import zipfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from .project_transfer import (TransferStore, TransferError, Cancelled, _atomic, canonical,
                              load_json, parse_json, file_hash, integer, digest_id,
                              receive_directory, regular_reader)
from .project_transfer_cli import export_report


class Desk:
    def __init__(self, store_root, workspace=None, receive_directory=None):
        self.store = TransferStore(store_root)
        self.root = self.store.root / "desk"
        self.received_root = Path(receive_directory).absolute() if receive_directory else self.store.root.parent / (self.store.root.name + "-received")
        self.received_root.mkdir(parents=True, exist_ok=True)
        for name in ("uploads", "tasks", "outbox", "files"):
            (self.root / name).mkdir(parents=True, exist_ok=True)
        self.workspace = str(workspace) if workspace else None
        self.capability = secrets.token_urlsafe(36)
        self.origin = ""
        self.lock = threading.RLock()
        self.pool = concurrent.futures.ThreadPoolExecutor(max_workers=1, thread_name_prefix="project-transfer")
        self.cancels = {}
        self.owner = self.store._block_lock(hashlib.sha256(b"standalone-transfer-desk").hexdigest())
        self.owner.__enter__()
        for path in (self.root / "tasks").glob("*.json"):
            task = load_json(path)
            if task["state"] in ("queued", "running"):
                task.update(state="interrupted", message="The desk reopened. Resume this same operation.", ended_at=time.time())
                _atomic(path, canonical(task) + b"\n", replace=True)

    def close(self):
        for event in self.cancels.values(): event.set()
        self.pool.shutdown(wait=True, cancel_futures=True)
        self.owner.__exit__(None, None, None)

    def task(self, key):
        return load_json(self.root / "tasks" / (digest_id(key) + ".json"))

    def tasks(self):
        return sorted((load_json(p) for p in (self.root / "tasks").glob("*.json")),
                      key=lambda v: v["created_at"], reverse=True)

    def save_task(self, value):
        _atomic(self.root / "tasks" / (value["id"] + ".json"), canonical(value) + b"\n", replace=True)

    def submit(self, action, payload, operation_id=None):
        if action not in {"capture", "receive", "parts", "assemble", "open_copy", "report", "native_capture", "native_restore"}:
            raise TransferError("Select a supported transfer operation")
        if not isinstance(payload, dict): raise TransferError("Task payload must be an object")
        operation_id = operation_id or str(uuid.uuid4())
        if not isinstance(operation_id, str) or not re.fullmatch(r"[A-Za-z0-9_-]{16,100}", operation_id):
            raise TransferError("Invalid operation ID")
        key = hashlib.sha256(operation_id.encode()).hexdigest()
        with self.lock:
            path = self.root / "tasks" / (key + ".json")
            if path.exists():
                value = load_json(path)
                if value["action"] != action or value["payload"] != payload:
                    raise TransferError("Operation identity already belongs to a different request")
                return value
            task = {"id": key, "operation_id": operation_id, "action": action, "payload": payload,
                    "state": "queued", "created_at": time.time(), "attempts": 0}
            self.save_task(task)
            self.pool.submit(self.perform, key)
            return task

    def resume(self, key):
        with self.lock:
            task = self.task(key)
            if task["state"] in {"complete", "running", "queued"}: return task
            task.update(state="queued")
            task.pop("error", None)
            self.save_task(task)
            self.pool.submit(self.perform, key)
            return task

    def cancel(self, key):
        with self.lock:
            task = self.task(key)
            if task["state"] == "queued":
                task.update(state="cancelled", ended_at=time.time())
                self.save_task(task)
            elif task["state"] == "running":
                self.cancels.setdefault(key, threading.Event()).set()
            return task

    def perform(self, key):
        with self.lock:
            task = self.task(key)
            if task["state"] != "queued": return
            event = self.cancels[key] = threading.Event()
            task.update(state="running", started_at=time.time(), attempts=task["attempts"]+1)
            self.save_task(task)
        last_save = [0.0]
        def progress(value):
            if event.is_set():
                raise Cancelled("Operation paused at a retained file/block boundary")
            task["progress"] = value
            if time.monotonic()-last_save[0] > .2:
                self.save_task(task); last_save[0] = time.monotonic()
        try:
            result = self.invoke(task, progress, event.is_set)
            task.update(state="complete", result=result)
        except Cancelled as exc:
            task.update(state="cancelled", error=str(exc))
        except Exception as exc:
            task.update(state="failed", error=f"{type(exc).__name__}: {exc}")
        task.update(ended_at=time.time(), elapsed_seconds=time.time()-task["started_at"])
        self.save_task(task)

    def register_file(self, path, *, label=None):
        p = Path(path).resolve(strict=True)
        if not p.is_relative_to(self.root.resolve()): raise TransferError("Download must be a retained desk output")
        row = {"path": str(p), "name": p.name, "label": label or p.name,
               "bytes": p.stat().st_size, "sha256": file_hash(p)}
        key = hashlib.sha256(canonical(row)).hexdigest()
        _atomic(self.root / "files" / (key+".json"), canonical(row)+b"\n")
        return {k: v for k, v in {**row, "url": "/files/"+key}.items() if k != "path"}

    def upload(self, key):
        row = load_json(self.root / "uploads" / (digest_id(key)+".json"))
        path = self.root / "uploads" / (key+".body")
        if not path.exists() or path.stat().st_size != row["bytes"]:
            raise TransferError("Finish uploading the complete selected file")
        return path

    def begin_upload(self, value):
        name = value.get("name")
        if not isinstance(name, str) or not name or len(name)>256: raise TransferError("Select a file name")
        size = integer(value.get("bytes"), minimum=1, maximum=64*1024**3)
        fingerprint = digest_id(value.get("fingerprint"))
        key = hashlib.sha256(canonical({"name":name,"bytes":size,"fingerprint":fingerprint})).hexdigest()
        meta = {"id":key,"name":name,"bytes":size,"fingerprint":fingerprint}
        _atomic(self.root / "uploads" / (key+".json"), canonical(meta)+b"\n")
        body = self.root / "uploads" / (key+".body")
        return {**meta, "offset": body.stat().st_size if body.exists() else 0}

    def append_upload(self, key, offset, source, length):
        row = load_json(self.root / "uploads" / (digest_id(key)+".json"))
        offset = integer(offset, maximum=row["bytes"])
        length = integer(length, maximum=min(8*1024**2,row["bytes"]-offset))
        path = self.root / "uploads" / (key+".body")
        with self.store._block_lock(key):
            current = path.stat().st_size if path.exists() else 0
            if current != offset: raise TransferError("Upload offset changed; reselect the same file to resume")
            if path.is_symlink(): raise TransferError("Upload path is a symlink")
            with path.open("ab") as out:
                left = length
                while left:
                    data = source.read(min(1024**2,left))
                    if not data: break
                    out.write(data); left -= len(data)
                out.flush(); os.fsync(out.fileno())
            return {"id": key,"offset":path.stat().st_size,"bytes":row["bytes"],"complete":path.stat().st_size==row["bytes"]}

    def invoke(self, task, progress, cancel):
        value, action = task["payload"], task["action"]
        out = self.root / "outbox" / task["id"]
        out.mkdir(parents=True, exist_ok=True)
        snapshot_id = value.get("snapshot_id")
        if action == "capture":
            snapshot = self.store.capture_archive(self.upload(value["upload_id"]), chunk_bytes=value.get("chunk_bytes",4*1024**2), progress=progress, cancel=cancel)
            return {"snapshot_id":snapshot["id"], "project":snapshot["archive"]["project"], "files":len(snapshot["members"])-1}
        if action == "receive":
            return self.store.receive_pack(self.upload(value["upload_id"]), progress=progress,cancel=cancel)
        if action == "parts":
            parts = self.store.write_parts(snapshot_id,out, request=value.get("request"),payload_bytes=value.get("payload_bytes",64*1024**2),progress=progress)
            manifest_path = out / (snapshot_id+".transfer.json")
            return {"snapshot_id":snapshot_id,"parts":parts,"downloads":[self.register_file(manifest_path,label="Transfer manifest")]+[self.register_file(p["path"],label=f"Transfer part {i+1}") for i,p in enumerate(parts)]}
        if action == "assemble":
            result = self.store.materialize_archive(snapshot_id,out/"scientific-workspace.zip",progress=progress,cancel=cancel)
            return {**result,"downloads":[self.register_file(result["path"],label="Complete native workspace ZIP")]}
        if action == "open_copy":
            name = value.get("name",snapshot_id[:16])
            if not isinstance(name,str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,79}",name) or name in {".",".."}:
                raise TransferError("Use a simple new receiving folder name")
            return receive_directory(self.store,snapshot_id,self.received_root/name,progress=progress,cancel=cancel)
        if action == "report":
            result = export_report(self.store,snapshot_id,out/"report")
            archive=out/"transfer-inventory.zip"
            if not archive.exists():
                tmp=out/".report.pending.zip"
                with zipfile.ZipFile(tmp,"w",compression=zipfile.ZIP_DEFLATED) as z:
                    for p in sorted((out/"report").iterdir()): z.write(p,p.name)
                os.link(tmp,archive); tmp.unlink()
            return {**result,"downloads":[self.register_file(archive,label="HTML, CSV and JSON inventory")]}
        if action.startswith("native_"):
            if not self.workspace: raise TransferError("Start this desk with --workspace to use native operations")
            from .workspace import Workspace
            from .project_transfer_workspace import NativeProjectTransfer
            adapter=NativeProjectTransfer(Workspace(self.workspace),self.store.root)
            if action == "native_capture":
                result=adapter.capture(task["id"],progress=progress,cancel=cancel)
                return {k:v for k,v in result.items() if k!="snapshot"}
            return adapter.restore(snapshot_id,self.received_root/task["id"],progress=progress)
        raise TransferError("Unsupported action")


def make_handler(desk):
    assets=Path(__file__).resolve().parent.parent/"operator"/"web"
    class Handler(BaseHTTPRequestHandler):
        server_version="ProjectTransfer/1.0"
        def log_message(self,*args): pass
        def host_ok(self):
            if self.headers.get("Host") != urllib.parse.urlsplit(desk.origin).netloc:
                raise TransferError("Host does not match this loopback desk")
        def authorised(self):
            self.host_ok()
            token=self.headers.get("X-Transfer-Key","")
            cookie=http.cookies.SimpleCookie()
            with contextlib.suppress(http.cookies.CookieError): cookie.load(self.headers.get("Cookie",""))
            cookie_token=cookie[desk.cookie_name].value if desk.cookie_name in cookie else ""
            if not (hmac.compare_digest(token,desk.capability) or hmac.compare_digest(cookie_token,desk.capability)):
                raise TransferError("Open the local transfer desk to establish this session")
        def mutation(self):
            self.authorised()
            if not hmac.compare_digest(self.headers.get("X-Transfer-Key",""),desk.capability):
                raise TransferError("Missing transfer request key")
            origin=self.headers.get("Origin")
            if origin and origin!=desk.origin: raise TransferError("Cross-origin transfer request rejected")
        def send_bytes(self,body,status=200,ctype="application/json; charset=utf-8",cookie=False):
            self.send_response(status); self.send_header("Content-Type",ctype);self.send_header("Content-Length",str(len(body)))
            self.send_header("Cache-Control","no-store");self.send_header("X-Content-Type-Options","nosniff")
            self.send_header("Content-Security-Policy","default-src 'self'; script-src 'self'; style-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'self'")
            if cookie: self.send_header("Set-Cookie",f"{desk.cookie_name}={desk.capability}; HttpOnly; SameSite=Strict; Path=/")
            self.end_headers(); self.wfile.write(body)
        def json(self,value,status=200): self.send_bytes(canonical(value),status)
        def read_json(self):
            size=int(self.headers.get("Content-Length","0")); integer(size,minimum=1,maximum=64*1024**2)
            return parse_json(self.rfile.read(size))
        def do_GET(self):
            try:
                self.host_ok(); parsed=urllib.parse.urlsplit(self.path); path=parsed.path; query=urllib.parse.parse_qs(parsed.query)
                if path in {"/","/transfer_desk.mjs","/transfer_desk.css"}:
                    name="transfer_desk.html" if path=="/" else path[1:]
                    data=(assets/name).read_bytes()
                    if path=="/": data=data.replace(b"__TRANSFER_KEY__",desk.capability.encode())
                    self.send_bytes(data,ctype={".html":"text/html; charset=utf-8",".mjs":"text/javascript; charset=utf-8",".css":"text/css; charset=utf-8"}[Path(name).suffix],cookie=path=="/"); return
                self.authorised()
                if path=="/api/state":
                    tasks=desk.tasks()
                    self.json({"snapshots":desk.store.list_snapshots(),"tasks":tasks[:50],"task_count":len(tasks),"native_workspace":bool(desk.workspace)});return
                if path=="/api/report": self.json(desk.store.report(query["snapshot_id"][0]));return
                if path=="/api/manifest": self.json(desk.store.snapshot(query["snapshot_id"][0]));return
                if path=="/api/needs": self.json(desk.store.needs(query["snapshot_id"][0]));return
                if path=="/api/diff": self.json(desk.store.difference(query["before"][0],query["after"][0]));return
                if path=="/api/task": self.json(desk.task(query["id"][0]));return
                if path.startswith("/files/"):
                    row=load_json(desk.root/"files"/(digest_id(path[7:])+".json"));p=Path(row["path"])
                    if not p.resolve().is_relative_to(desk.root.resolve()) or p.stat().st_size!=row["bytes"] or file_hash(p)!=row["sha256"]:
                        raise TransferError("The selected retained download changed")
                    self.send_response(200); self.send_header("Content-Type",mimetypes.guess_type(p.name)[0] or "application/octet-stream")
                    self.send_header("Content-Disposition","attachment; filename*=UTF-8''"+urllib.parse.quote(p.name));self.send_header("Content-Length",str(row["bytes"]));self.send_header("X-Content-Type-Options","nosniff");self.end_headers()
                    with regular_reader(p) as f:
                        for block in iter(lambda:f.read(1024**2),b""): self.wfile.write(block)
                    return
                self.json({"error":"Not found"},404)
            except (BrokenPipeError,ConnectionResetError): pass
            except Exception as exc: self.json({"error":str(exc)},422)
        def do_POST(self):
            try:
                self.mutation();path=urllib.parse.urlsplit(self.path).path
                if path.startswith("/api/upload/"):
                    key=path.rsplit("/",1)[1]; q=urllib.parse.parse_qs(urllib.parse.urlsplit(self.path).query)
                    value=desk.append_upload(key,int(q.get("offset",[0])[0]),self.rfile,int(self.headers.get("Content-Length","0")));self.json(value);return
                value=self.read_json()
                if path=="/api/upload": self.json(desk.begin_upload(value));return
                if path=="/api/task": self.json(desk.submit(value["action"],value.get("payload",{}),value.get("operation_id")),202);return
                if path=="/api/resume": self.json(desk.resume(value["id"]),202);return
                if path=="/api/cancel": self.json(desk.cancel(value["id"]));return
                if path=="/api/accept": self.json({"snapshot_id":desk.store.accept_snapshot(value)});return
                self.json({"error":"Not found"},404)
            except (BrokenPipeError,ConnectionResetError): pass
            except Exception as exc: self.json({"error":str(exc)},422)
    return Handler


def make_server(store_root,port=8876,workspace=None,receive_directory=None):
    desk=Desk(store_root,workspace,receive_directory)
    server=ThreadingHTTPServer(("127.0.0.1",port),make_handler(desk))
    server.daemon_threads=True
    desk.origin=f"http://127.0.0.1:{server.server_address[1]}"
    desk.cookie_name=f"transfer_key_{server.server_address[1]}"
    return server,desk


def serve(store_root,*,port=8876,workspace=None,receive_directory=None):
    server,desk=make_server(store_root,port,workspace,receive_directory)
    print(json.dumps({"opening_route":desk.origin,"transport":"loopback","native_workspace":bool(workspace)}),flush=True)
    try: server.serve_forever()
    except KeyboardInterrupt: pass
    finally: server.server_close();desk.close()
