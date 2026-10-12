"""Loopback operator HTTP over the original Workbench."""
from __future__ import annotations
import argparse
import html
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import re
import signal
import threading
from urllib.parse import parse_qs, quote, unquote, urlsplit

from .common import Problem, json_bytes, json_text
from .store import Workbench

def serve(workspace,host="127.0.0.1",port=8892):
    if host not in ("127.0.0.1","localhost","::1"):
        raise Problem("loopback_host","Use the loopback operator or the original Tethys portal deployment.")
    class Handler(BaseHTTPRequestHandler):
        server_version="GroundwaterWorkspace/1"
        def log_message(self,format,*args):
            pass
        def _json(self,status,value):
            raw=json_bytes(value)
            self.send_response(status)
            self.send_header("Content-Type","application/json; charset=utf-8")
            self.send_header("Content-Length",str(len(raw)))
            self.send_header("Cache-Control","no-store")
            self.end_headers()
            self.wfile.write(raw)
        def _file(self,item,download=True):
            path=item["path"]
            self.send_response(200)
            self.send_header("Content-Type",item["mime"])
            self.send_header("Content-Length",str(item["bytes"]))
            self.send_header("ETag",'"'+item["sha256"]+'"')
            self.send_header("X-Content-Type-Options","nosniff")
            if download:
                self.send_header("Content-Disposition","attachment; filename*=UTF-8''"+quote(item["filename"],safe=""))
            self.end_headers()
            with Path(path).open("rb") as stream:
                while chunk:=stream.read(1024*1024):
                    self.wfile.write(chunk)
        def _route(self):
            parsed=urlsplit(self.path)
            return unquote(parsed.path),{k:v[-1] for k,v in parse_qs(parsed.query,keep_blank_values=True).items()}
        def do_GET(self):
            try:
                path,q=self._route()
                if path in ("/","/index.html","/app.js","/style.css"):
                    item=workspace.static_file("index.html" if path=="/" else path[1:])
                    return self._file(item,False)
                if path=="/bootstrap.js":
                    raw=("window.GROUNDWATER_CONFIG="+json_text({"apiBase":"/api","assetBase":"/","guideUrl":"/guide"})+";\n").encode()
                    self.send_response(200);self.send_header("Content-Type","text/javascript; charset=utf-8");self.send_header("Content-Length",str(len(raw)));self.send_header("Cache-Control","no-store");self.end_headers();self.wfile.write(raw);return
                if path=="/guide":
                    return self._file(workspace.guide_file(),False)
                if path=="/api/state":
                    return self._json(200,workspace.state(q.get("project_id") or None))
                if path=="/api/runtime":
                    return self._json(200,workspace.runtime())
                match=re.fullmatch(r"/api/operations/([A-Za-z0-9._-]+)",path)
                if match:
                    return self._json(200,workspace.operation(match[1]))
                match=re.fullmatch(r"/api/(sources|editions|runs|reports|backups)/([A-Za-z0-9._-]+)(?:/(original|file|compare|export|download))?",path)
                if match:
                    kind,record_id,operation=match.groups()
                    if kind=="sources" and operation=="original":
                        return self._file(workspace.source_file(record_id,q.get("path","")))
                    if kind=="runs" and operation=="file":
                        return self._file(workspace.run_file(record_id,q.get("path","")),q.get("inline")!="1")
                    if kind=="runs" and operation=="compare":
                        return self._json(200,workspace.compare(record_id,q.get("baseline_run_id","")))
                    if kind=="reports" and operation=="export":
                        return self._file(workspace.report_export(record_id,q.get("format","zip")))
                    if kind=="backups" and operation=="download":
                        return self._file(workspace.backup_file(record_id))
                    if operation is None:
                        methods={"sources":workspace.source_detail,"editions":workspace.edition_detail,"runs":workspace.run_detail,"reports":workspace.report_detail}
                        if kind in methods:
                            return self._json(200,methods[kind](record_id))
                raise Problem("not_found","This operator resource does not exist.",404)
            except Problem as exc:
                self._json(exc.status,{"error":exc.as_dict()})
            except (BrokenPipeError,ConnectionResetError):
                return
            except (FileNotFoundError,KeyError,ValueError) as exc:
                self._json(409,{"error":{"code":"retained_resource_unavailable","message":str(exc)}})
        def do_POST(self):
            try:
                path,q=self._route()
                if path!="/api/action":
                    raise Problem("not_found","This operator action does not exist.",404)
                expected={"127.0.0.1:"+str(self.server.server_port),"localhost:"+str(self.server.server_port),"[::1]:"+str(self.server.server_port)}
                if self.headers.get("Host","") not in expected:
                    raise Problem("host","Use this operator's actual loopback address.",400)
                origin=self.headers.get("Origin")
                if origin and urlsplit(origin).netloc not in expected:
                    raise Problem("origin","Use the operator page on this same origin.",403)
                if self.headers.get("Content-Type","").split(";")[0].strip().lower()!="application/json":
                    raise Problem("content_type","Actions require application/json.",415)
                length=int(self.headers.get("Content-Length","0"))
                if not 0<length<=90*1024**2:
                    raise Problem("request_size","Action envelope must be at most 90 MiB.",413)
                request=json.loads(self.rfile.read(length))
                return self._json(200,workspace.dispatch(request))
            except Problem as exc:
                self._json(exc.status,{"error":exc.as_dict()})
            except (BrokenPipeError,ConnectionResetError):
                return
            except (KeyError,ValueError,TypeError) as exc:
                self._json(400,{"error":{"code":"invalid_request","message":str(exc)}})
            except OSError as exc:
                self._json(503,{"error":{"code":"storage_unavailable","message":str(exc),"original_request_may_be_committed":True}})
    server=ThreadingHTTPServer((host,port),Handler)
    server.daemon_threads=False
    print(json_text({"state":"listening","url":"http://"+host+":"+str(server.server_port),"workspace_id":workspace.state()["workspace"]["id"]}),flush=True)
    stopping=False
    def stop(*_):
        nonlocal stopping
        if not stopping:
            stopping=True
            threading.Thread(target=server.shutdown,daemon=True).start()
    previous={}
    if threading.current_thread() is threading.main_thread():
        for signum in (signal.SIGTERM,signal.SIGINT):
            previous[signum]=signal.signal(signum,stop)
    try:
        server.serve_forever(poll_interval=0.2)
    finally:
        server.server_close()
        for signum,handler in previous.items():
            signal.signal(signum,handler)
    return 0
