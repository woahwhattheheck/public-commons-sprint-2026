"""Loopback UI for actual curated execution; live paid inference is CLI-only."""
from __future__ import annotations
import argparse,json,re,secrets,threading
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse,parse_qs
from .focused_execution import run_task,verify_run
from .workloads import TASKS,task_manifest
TOKEN=secrets.token_urlsafe(32)
LOCK=threading.Lock()
ROOT=Path(__file__).resolve().parents[1]/".focused-runs"
PAGE="""<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>EvidenceForge · Checked changes</title><style>
:root{font-family:system-ui;background:#101720;color:#eef3fc}body{max-width:1050px;margin:32px auto;padding:0 20px}h1{font-size:34px;margin-bottom:6px}.muted{color:#aabcce}section{padding:22px;border:1px solid #34475d;border-radius:14px;background:#172332;margin:18px 0}label{display:block;margin:12px 0 6px}select,input,button{font:inherit;padding:11px;border-radius:8px;border:1px solid #56718d}select,input{color:white;background:#111b27}button{background:#8dbfff;color:#0f233d;font-weight:700;cursor:pointer}button:disabled{opacity:.4}.row{display:flex;flex-wrap:wrap;gap:12px;align-items:end}pre{background:#0c131c;padding:16px;white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.6;border-radius:10px;font-size:13px}table{width:100%;border-collapse:collapse}td,th{text-align:left;padding:10px;border-bottom:1px solid #34475d;font-size:13px}.green{color:#7de4b2}.red{color:#ffaaaa}.pill{display:inline-block;padding:5px 10px;border-radius:20px;background:#293e59;font-size:12px}@media(max-width:650px){h1{font-size:28px}body{padding:0 14px}}
</style><span class="pill">Released coding workload · entry unsubmitted</span><h1>EvidenceForge</h1><p class="muted">Inspect a source change, the exact checks it ran and its evidence.</p>
<section><h2>Choose a substantive bug</h2><div class="row"><div><label for="task">Fixed repository task</label><select id="task"></select></div><div><label for="control">Control source</label><select id="control"><option value="corrected">Corrected control</option><option value="baseline">Defective baseline</option></select></div><button id="run">Execute named checks</button></div><p id="goal"></p><p id="state" class="muted" role="status">Controls execute actual pure Python computation in a fresh task copy. No model call is made.</p>
<details><summary>Inspect an existing provider run</summary><label for="operation">Retained operation ID</label><input id="operation" placeholder="your-live-operation-id"><button id="load">Open receipt</button><p class="muted">A live run is created by the CLI using the existing Nebius account. Saved claims alone do not establish a provider call.</p></details></section>
<section id="result" hidden><h2 id="heading"></h2><p id="facts" class="muted"></p><table><thead><tr><th>Focused case</th><th>Baseline</th><th>After</th></tr></thead><tbody id="checks"></tbody></table><h3>Source diff</h3><pre id="patch"></pre><details><summary>Complete run envelope</summary><pre id="envelope"></pre></details></section>
<script>
const token="__TOKEN__";const tasks=__TASKS__;const el=id=>document.getElementById(id);
for(const task of tasks){const option=document.createElement("option");option.value=task.task_id;option.textContent=task.task_id;el("task").append(option);}
function goal(){el("goal").textContent=tasks.find(t=>t.task_id===el("task").value).goal;}el("task").onchange=goal;goal();
function display(r){el("result").hidden=false;const passed=r.receipt.required_tests_green;el("heading").textContent=passed?"Named checks passed":"Change did not earn passing checks";el("heading").className=passed?"green":"red";
el("facts").textContent=r.provider.provider+" · "+r.wall_seconds.toFixed(3)+" seconds · run "+r.operation_id+" · "+(r.qualifying_nebius_runtime_observed?"live Nebius runtime observed by this run":"no qualifying Nebius runtime observed");
el("checks").replaceChildren();const after=r.checks[0]?.cases||[];for(const before of r.baseline.cases||[]){const row=document.createElement("tr");const matched=after.find(x=>x.name===before.name);for(const text of [before.name,before.passed?"PASS":"FAIL",matched?(matched.passed?"PASS":"FAIL"):"not executed"]){const cell=document.createElement("td");cell.textContent=text;row.append(cell);}el("checks").append(row);}
el("patch").textContent=r.patch||"No source delta.";el("envelope").textContent=JSON.stringify(r,null,2);}
el("run").onclick=async()=>{const b=el("run");if(b.disabled)return;b.disabled=true;el("state").textContent="Executing the selected task's actual baseline and final checks…";try{const response=await fetch("/api/run",{method:"POST",headers:{"Content-Type":"application/json","X-Action-Token":token},body:JSON.stringify({task:el("task").value,control:el("control").value,operation_id:crypto.randomUUID()})});const r=await response.json();if(!response.ok)throw Error(r.error);display(r);el("state").textContent="Verified run envelope retained. Whole competition entry remains unsubmitted.";}catch(e){el("state").textContent=e.message+" · inspect the operation before retry";}finally{b.disabled=false;}};
el("load").onclick=async()=>{try{const response=await fetch("/api/result?id="+encodeURIComponent(el("operation").value),{headers:{"X-Action-Token":token}});const r=await response.json();if(!response.ok)throw Error(r.error);display(r);}catch(e){el("state").textContent=e.message;}};
</script></html>"""

class Handler(BaseHTTPRequestHandler):
    def log_message(self,*args):pass
    def send(self,status,data,kind="application/json"):
        body=data.encode()
        self.send_response(status);self.send_header("Content-Type",kind+"; charset=utf-8")
        self.send_header("Content-Length",str(len(body)));self.send_header("Cache-Control","no-store")
        self.send_header("X-Content-Type-Options","nosniff")
        self.send_header("Content-Security-Policy","default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; frame-ancestors 'none'")
        self.end_headers();self.wfile.write(body)
    def do_GET(self):
        parsed=urlparse(self.path)
        if parsed.path=="/":
            page=PAGE.replace("__TOKEN__",TOKEN).replace("__TASKS__",json.dumps(task_manifest()))
            self.send(200,page,"text/html");return
        if parsed.path=="/api/result" and self.headers.get("X-Action-Token")==TOKEN:
            identity=parse_qs(parsed.query).get("id",[""])[0]
            if not re.fullmatch(r"[A-Za-z0-9_-]{1,80}",identity):
                self.send(400,json.dumps({"error":"invalid operation ID"}));return
            path=ROOT/identity/"run.json"
            if path.is_file() and not path.is_symlink():
                run=json.loads(path.read_text(encoding="utf-8"))
                if verify_run(run):self.send(200,json.dumps(run));return
        self.send(404,json.dumps({"error":"retained verified run not found"}))
    def do_POST(self):
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

