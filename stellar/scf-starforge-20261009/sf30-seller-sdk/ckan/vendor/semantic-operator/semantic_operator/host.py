"""Origin-bound loopback HTTP interface for the private semantic workspace."""
from __future__ import annotations
import contextlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import signal
import threading
from urllib.parse import quote, urlsplit
from .application import SemanticApplication, KINDS
from .security import atomic_write, canonical, read_json, private_directory

MAX_REQUEST=90*1024*1024
CSP="default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"

class OperatorServer(ThreadingHTTPServer):
    daemon_threads=True
    allow_reuse_address=True
    def __init__(self,address,application):
        self.application=application
        self.assets=Path(__file__).resolve().parent.parent/"ui"
        super().__init__(address,OperatorHandler)
        self.origins={"http://localhost:"+str(self.server_port),"http://127.0.0.1:"+str(self.server_port)}
        self.origin="http://localhost:"+str(self.server_port)

class OperatorHandler(BaseHTTPRequestHandler):
    protocol_version="HTTP/1.1"
    server_version="SemanticOperator/1.0"
    def log_message(self,format,*args):
        return
    def _host(self):
        origin="http://"+self.headers.get("Host","")
        if origin not in self.server.origins:
            raise PermissionError("Open the workspace through its original local address.")
        return origin
    def _api(self):
        origin=self._host()
        if self.headers.get("Origin") not in (None,origin) or self.headers.get("Sec-Fetch-Site") not in (None,"same-origin","none"):
            raise PermissionError("The workspace request came from another origin.")
        if self.headers.get("X-Semantic-Operator")!="1":
            raise PermissionError("Use the local operator or its documented local API.")
    def _body(self):
        if self.headers.get("Transfer-Encoding"):
            raise ValueError("Send the exact operation length.")
        try: length=int(self.headers.get("Content-Length","0"))
        except ValueError as exc: raise ValueError("Send a valid operation length.") from exc
        if not 0<length<=MAX_REQUEST:
            raise ValueError("The operation payload is missing or exceeds 90 MiB.")
        self.connection.settimeout(60)
        body=self.rfile.read(length)
        if len(body)!=length:
            raise ValueError("The original operation body is incomplete.")
        return body
    def _send(self,status,body,media_type="application/json; charset=utf-8",*,headers=None):
        if isinstance(body,str): body=body.encode()
        self.send_response(status)
        for key,value in {"Content-Type":media_type,"Content-Length":str(len(body)),"Cache-Control":"no-store",
            "X-Content-Type-Options":"nosniff","X-Frame-Options":"DENY","Referrer-Policy":"no-referrer",
            "Cross-Origin-Resource-Policy":"same-origin","Content-Security-Policy":CSP,**(headers or {})}.items():
            self.send_header(key,value)
        self.end_headers()
        self.wfile.write(body)
    def _error(self,exc):
        status=403 if isinstance(exc,PermissionError) else 404 if isinstance(exc,KeyError) else 422 if isinstance(exc,(ValueError,TypeError)) else 500
        code={403:"local_origin_required",404:"record_missing",422:"operation_inputs",500:"operation_interrupted"}[status]
        with contextlib.suppress(BrokenPipeError,ConnectionResetError):
            self._send(status,canonical({"error":{"code":code,"message":str(exc).strip("'")[:2000]}}))
    def do_GET(self):
        try:
            self._host()
            path=urlsplit(self.path).path
            app=self.server.application
            if path.startswith("/api/"):
                self._api()
                if path=="/api/state": return self._send(200,canonical(app.state()))
                if path=="/api/references": return self._send(200,canonical(app.references()))
                if path.startswith("/api/history/"):
                    parts=path.removeprefix("/api/history/").split("/")
                    if len(parts)!=2 or parts[0] not in KINDS: raise ValueError("Choose a supported record history.")
                    app.store.document(*parts)
                    return self._send(200,canonical(app.store.history(*parts)))
                if path.startswith("/api/operations/"):
                    return self._send(200,canonical(app.store.operation(path.removeprefix("/api/operations/"))))
                if path.startswith("/api/files/"):
                    meta,body=app.store.artifact(path.removeprefix("/api/files/"),with_bytes=True)
                    return self._send(200,body,meta["media_type"],headers={
                        "Content-Disposition":"attachment; filename*=UTF-8''"+quote(meta["name"],safe="")})
                raise KeyError("No local endpoint has this path.")
            mapping={"/":"index.html","/index.html":"index.html","/app.js":"app.js","/datasets.js":"datasets.js","/style.css":"style.css"}
            if path not in mapping: raise KeyError("No operator view has this path.")
            name=mapping[path]
            media={"index.html":"text/html; charset=utf-8","app.js":"text/javascript; charset=utf-8","datasets.js":"text/javascript; charset=utf-8","style.css":"text/css; charset=utf-8"}[name]
            return self._send(200,(self.server.assets/name).read_bytes(),media)
        except Exception as exc:
            self._error(exc)
    def do_POST(self):
        try:
            self._api()
            if urlsplit(self.path).path!="/api/operate":
                raise KeyError("No local endpoint has this path.")
            if not self.headers.get("Content-Type","").startswith("application/json"):
                raise ValueError("Send the original JSON operation inputs.")
            request=read_json(self._body())
            if not isinstance(request,dict) or set(request)-{"action","payload","operation_id","actor"}:
                raise ValueError("Choose the documented local operation envelope.")
            result=self.server.application.perform(request["action"],request.get("payload",{}),
                operation_id=request["operation_id"],actor=request["actor"])
            self._send(200,canonical({"result":result,"operation_id":request["operation_id"]}))
        except Exception as exc:
            self._error(exc)

def serve(workspace,*,port=0,ready_file=None):
    os.umask(0o077)
    app=SemanticApplication(workspace)
    server=OperatorServer(("127.0.0.1",port),app)
    ready={"url":server.origin+"/","origin":server.origin,"workspace_id":app.store.workspace_id,"pid":os.getpid()}
    if ready_file:
        target=Path(ready_file).expanduser().absolute()
        private_directory(target.parent)
        atomic_write(target,canonical(ready))
    print(json.dumps(ready),flush=True)
    original={}
    def shutdown(signum,frame):
        threading.Thread(target=server.shutdown,daemon=True).start()
    if threading.current_thread() is threading.main_thread():
        for sig in (signal.SIGTERM,signal.SIGINT):
            original[sig]=signal.signal(sig,shutdown)
    try:
        server.serve_forever(poll_interval=0.25)
    finally:
        server.server_close()
        app.close()
        for sig,handler in original.items(): signal.signal(sig,handler)
