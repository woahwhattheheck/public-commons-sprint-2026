"""Loopback UI for actual curated execution; live paid inference is CLI-only."""
from __future__ import annotations
import argparse,json,secrets,threading
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse,parse_qs
from .focused_execution import run_task
from .workloads import TASKS,task_manifest
from .loopback_guard import allowed_request
from .retained_runs import list_operations,read_operation
TOKEN=secrets.token_urlsafe(32)
LOCK=threading.Lock()
ROOT=Path(__file__).resolve().parents[1]/".focused-runs"
PAGE_PATH=Path(__file__).with_name("runtime_page.html")
ASSETS={"/runtime.js":("runtime.js","application/javascript"),
        "/runtime.css":("runtime.css","text/css")}

class Handler(BaseHTTPRequestHandler):
    def log_message(self,*args):pass
    def send(self,status,data,kind="application/json"):
        body=data.encode()
        self.send_response(status);self.send_header("Content-Type",kind+"; charset=utf-8")
        self.send_header("Content-Length",str(len(body)));self.send_header("Cache-Control","no-store")
        self.send_header("X-Content-Type-Options","nosniff")
        self.send_header("Content-Security-Policy","default-src 'self'; script-src 'self'; style-src 'self'; frame-ancestors 'none'")
        self.end_headers();self.wfile.write(body)
    def do_GET(self):
        if not allowed_request(self.headers, self.server.server_port):
            self.send(403, json.dumps({'error':'local browser origin required'}));return
        parsed=urlparse(self.path)
        if parsed.path=="/":
            config=json.dumps({"token":TOKEN,"tasks":task_manifest()}).replace("<","\\u003c")
            page=PAGE_PATH.read_text(encoding="utf-8").replace("__CONFIG__",config)
            self.send(200,page,"text/html");return
        if parsed.path in ASSETS:
            filename,kind=ASSETS[parsed.path]
            self.send(200,Path(__file__).with_name(filename).read_text(encoding="utf-8"),kind);return
        if parsed.path=="/api/operations" and self.headers.get("X-Action-Token")==TOKEN:
            try:self.send(200,json.dumps(list_operations(ROOT)))
            except OSError:self.send(503,json.dumps({"error":"retained operation index unavailable"}))
            return
        if parsed.path in {"/api/operation","/api/result"} and self.headers.get("X-Action-Token")==TOKEN:
            identity=parse_qs(parsed.query).get("id",[""])[0]
            try:operation=read_operation(ROOT,identity)
            except ValueError:
                self.send(400,json.dumps({"error":"invalid operation ID"}));return
            except FileNotFoundError:
                self.send(404,json.dumps({"error":"retained operation not found; request delivery is not established"}));return
            if parsed.path=="/api/operation":self.send(200,json.dumps(operation));return
            if operation["result_verified"]:self.send(200,json.dumps(operation["run"]));return
        self.send(404,json.dumps({"error":"retained verified run not found"}))
    def do_POST(self):
        if not allowed_request(self.headers, self.server.server_port, mutation=True):
            self.send(403, json.dumps({'error':'local browser origin required'}));return
        if self.path!="/api/run" or self.headers.get("X-Action-Token")!=TOKEN:
            self.send(403,json.dumps({"error":"invalid action token"}));return
        try:
            length=int(self.headers.get("Content-Length","0"))
            if not 0<length<=8192:raise ValueError()
            body=json.loads(self.rfile.read(length))
            if set(body)!={"task","control","operation_id"}:raise ValueError()
            if body["control"] not in {"baseline","corrected"}:raise ValueError()
        except Exception:
            self.send(400,json.dumps({"error":"invalid task-control request"}));return
        if not LOCK.acquire(False):
            self.send(409,json.dumps({"error":"a focused run is already active"}));return
        try:
            run=run_task(body["task"],output_root=ROOT,operation_id=body["operation_id"],
                         control=body["control"],seconds=120)
            self.send(200,json.dumps(run))
        except Exception:
            self.send(400,json.dumps({"error":"run did not finish; inspect its retained journal"}))
        finally:LOCK.release()

def main(argv=None):
    global ROOT
    parser=argparse.ArgumentParser();parser.add_argument("--port",type=int,default=8081)
    parser.add_argument("--runs")
    args=parser.parse_args(argv)
    if args.runs:ROOT=Path(args.runs).resolve()
    print(f"EvidenceForge focused execution: http://127.0.0.1:{args.port}",flush=True)
    ThreadingHTTPServer(("127.0.0.1",args.port),Handler).serve_forever()

if __name__=="__main__":main()

