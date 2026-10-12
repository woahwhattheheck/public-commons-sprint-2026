"""Loopback operator API for the source-bound standards drafting workspace."""
from __future__ import annotations
import argparse
import base64
import json
import sys
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs,unquote,urlsplit
if __package__:
    from . import engine,exports
    from .workspace import Workspace,Conflict,json_read,SCHEMA
else:
    import engine,exports
    from workspace import Workspace,Conflict,json_read,SCHEMA
ROOT=Path(__file__).resolve().parent
MAX_JSON_BYTES=48*1024*1024
MAX_RESTORE_BYTES=512*1024*1024+4096
OPERATIONS=["record.save","record.remove","project.rename","source.add","records.import","edition.freeze","language.record",
            "comment.carry","decision.record","ballot.open","ballot.close","procedure.review","phase.freeze","phase.response","invoice.prepare",
            "invoice.response","payment.record","delivery.register"]

def seed(workspace,kind):
    if __package__:from . import demo
    else:import demo
    return demo.seed_demo(workspace,kind)

def catalog():
    return {**engine.schema(),"workspace_schema":SCHEMA,"operations":OPERATIONS,"audiences":["private_restore","edition","management"],
            "limits":{"source_bytes":32*1024*1024,"original_bytes_per_project":192*1024*1024,
                      "state_bytes":64*1024*1024,"records_per_collection":20000,"preview_records":200,"page_records":500},
            "operation_payload":{"operation":"record.save","payload":{"collection":"clauses","record":{}},"expected_revision":1,"request_id":"request-unique","actor":"Operator"},
            "import_specification":{"source_id":"","parse_options":{},"collection":"","table_id":"","field_map":{},"constants":{},"row_indices":None},
            "parsing_options":{"csv":["format","encoding","delimiter","header_row"],
                               "json":["format","encoding","records_path"],"xlsx":["format","sheet","header_row","header_rows","data_start_row","data_end_row"],
                               "text":["encoding"],"docx":[]},
            "workflow_templates":{
             "edition.freeze":{"label":"","contributor_ids":[],"notes":""},
             "ballot.open":{"title":"","edition_id":"","procedure_id":"","opens":"","closes":"","method":"letter_ballot","membership_ids":None,"consultation_ids":[],"sponsor_endorsement_source_ids":[],"notes":""},
             "ballot.close":{"ballot_id":"","authority":"","recorded_decision":"recorded_only","rationale":"","source_ids":[]},
             "decision.record":{"edition_id":"","procedure_id":"","method":"peer_review","consultation_ids":[],"decision":"recorded_only","authority":"","rationale":"","source_ids":[]},
             "procedure.review":{"closure_id":"","reviewer_id":"","independence_declared":False,"appointment_source_ids":[],"decision":"changes_required","rationale":"","source_ids":[]},
             "delivery.register":{"title":"","scope_deliverable_ids":[],"scope_confirmed":False,"final_invoice_register_confirmed":False,"authority":"","rationale":"","source_ids":[]},
             "phase.freeze":{"phase":"1","title":"","through":"","summary":"","submitted_at":"","source_ids":[]},
             "phase.response":{"report_id":"","decision":"accepted","date":"","authority":"","rationale":"","evidence_ids":[]},
             "invoice.prepare":{"number":"","report_id":"","issued":"","allocations":[],"hst_cad":"0.00","terms":""},
             "invoice.response":{"invoice_id":"","status":"submitted","date":"","authority":"","rationale":"","evidence_ids":[]},
             "payment.record":{"invoice_id":"","kind":"receipt","amount_cad":"0.00","date":"","external_reference":"","evidence_ids":[],"notes":""},
             "language.record":{"clause_id":"","reviewer_id":"","decision":"reviewed","rationale":"","source_ids":[]},
             "comment.carry":{"comment_id":"","edition_id":"","clause_id":"","consultation_id":""}}}

def handler_for(workspace):
    class Handler(BaseHTTPRequestHandler):
        server_version="StandardsWorkbench/0.1";protocol_version="HTTP/1.1"
        def setup(self):
            super().setup();self.connection.settimeout(30)
        def log_message(self,fmt,*args):
            sys.stderr.write(self.log_date_time_string()+" "+fmt%args+"\n")
        def send(self,body,status=200,content_type="application/json; charset=utf-8",filename=None):
            if isinstance(body,(dict,list)):body=json.dumps(body,ensure_ascii=False,allow_nan=False).encode()
            elif isinstance(body,str):body=body.encode()
            self.send_response(status)
            for name,val in [("Content-Type",content_type),("Content-Length",str(len(body))),("Cache-Control","no-store"),
                             ("X-Content-Type-Options","nosniff"),("Referrer-Policy","no-referrer"),
                             ("Content-Security-Policy","default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; form-action 'self'; base-uri 'none'")]:
                self.send_header(name,val)
            if filename:self.send_header("Content-Disposition",'attachment; filename="'+exports.safe_name(filename)+'"')
            self.end_headers();self.wfile.write(body)
        def local_origin(self):
            allowed={f"127.0.0.1:{self.server.server_port}",f"localhost:{self.server.server_port}"}
            if self.headers.get("Host") not in allowed:raise ValueError("Open the printed loopback address.")
            origin=self.headers.get("Origin")
            if origin and (urlsplit(origin).scheme!="http" or urlsplit(origin).netloc not in allowed):
                raise ValueError("The local workspace does not accept cross-origin requests.")
        def body(self,limit=MAX_JSON_BYTES):
            if self.headers.get("Transfer-Encoding"):raise ValueError("Send a bounded Content-Length request.")
            if self.headers.get("Content-Type","").split(";")[0]!="application/json":raise ValueError("This endpoint accepts application/json.")
            try:size=int(self.headers.get("Content-Length","0"))
            except ValueError:raise ValueError("Invalid Content-Length.")
            if not 0<size<=limit:raise ValueError("Request is empty or exceeds this endpoint's limit.")
            raw=self.rfile.read(size)
            if len(raw)!=size:raise ValueError("Request ended before its declared length.")
            data=json_read(raw)
            if not isinstance(data,dict):raise ValueError("Request body must be an object.")
            return data
        def do_GET(self):
            try:
                self.local_origin();url=urlsplit(self.path);bits=[unquote(x) for x in url.path.split("/") if x]
                q={k:v[0] for k,v in parse_qs(url.query).items()}
                if not bits or bits==["index.html"]:return self.send((ROOT/"web/index.html").read_bytes(),content_type="text/html; charset=utf-8")
                if len(bits)==1 and bits[0] in ("app.js","style.css"):
                    return self.send((ROOT/"web"/bits[0]).read_bytes(),content_type="application/javascript; charset=utf-8" if bits[0].endswith(".js") else "text/css; charset=utf-8")
                if bits==["api","status"]:return self.send({"workspace_schema":SCHEMA,"engine_schema":engine.SCHEMA,"mode":"local_operator","network_clients":0,"publisher_dependencies":["python-docx>=1.2,<2","reportlab>=4.4,<5"]})
                if bits==["api","catalog"]:return self.send(catalog())
                if bits==["api","projects"]:return self.send(workspace.list_projects())
                if len(bits)>=3 and bits[:2]==["api","projects"]:
                    pid=bits[2]
                    if len(bits)==3:return self.send(workspace.get(pid))
                    if bits[3:]==["analysis"]:return self.send(engine.analyze(workspace.full_state(pid)))
                    if bits[3:]==["history"]:return self.send(workspace.history(pid,q.get("offset",0),q.get("limit",100)))
                    if len(bits) in (5,6) and bits[3]=="records":
                        return self.send(workspace.record(pid,bits[4],bits[5]) if len(bits)==6 else workspace.records(pid,bits[4],q.get("offset",0),q.get("limit",100)))
                    if len(bits)==5 and bits[3]=="files":
                        raw,meta=workspace.original(pid,bits[4])
                        return self.send(raw,content_type="application/octet-stream",filename=meta["filename"])
                    if len(bits)==6 and bits[3]=="editions" and bits[5]=="compare":
                        state=workspace.full_state(pid);edition=engine.record(state,"editions",bits[4])
                        other=engine.record(state,"editions",q["other"])["snapshot"] if q.get("other") else engine.edition_snapshot(state)
                        return self.send(engine.compare_editions(edition["snapshot"],other))
                    if bits[3:]==["export"]:
                        audience=q.get("audience","private_restore")
                        raw,manifest=exports.export_project(workspace,pid,audience,q.get("edition_id"),q.get("publication_id"),q.get("comparison_edition_id"),
                                                          [x for x in q.get("include_source_ids","").split(",") if x])
                        return self.send(raw,content_type="application/zip",filename=f"standards-{audience}-{pid}-r{manifest['revision']}.zip")
                return self.send({"error":"Resource not found."},404)
            except Exception as exc:self.error(exc)
        def do_POST(self):
            try:
                self.local_origin();bits=[unquote(x) for x in urlsplit(self.path).path.split("/") if x]
                data=self.body(MAX_RESTORE_BYTES if bits==["api","restore"] else MAX_JSON_BYTES)
                if bits==["api","projects"]:return self.send(workspace.create(data.get("title"),data.get("actor","Operator"),data.get("id"),data.get("mode","working")),201)
                if bits==["api","demo"]:return self.send(seed(workspace,data.get("kind","public")),201)
                if bits==["api","restore"]:
                    raw=base64.b64decode(data.get("content_base64",""),validate=True)
                    return self.send(exports.import_project(workspace,raw))
                if len(bits)==4 and bits[:2]==["api","projects"] and bits[3]=="operations":
                    return self.send(workspace.apply(bits[2],data.get("operation"),data.get("payload",{}),data.get("expected_revision"),data.get("request_id"),data.get("actor","Operator")))
                if len(bits)==5 and bits[:2]==["api","projects"] and bits[3:]==["intake","preview"]:
                    return self.send(workspace.intake_preview(bits[2],data.get("specification"),data.get("offset",0),data.get("limit",100)))
                return self.send({"error":"Endpoint not found."},404)
            except Exception as exc:self.error(exc)
        def error(self,exc):
            if isinstance(exc,(BrokenPipeError,ConnectionResetError)):return
            self.close_connection=True
            if isinstance(exc,Conflict):return self.send({"error":str(exc),"current_revision":exc.current_revision,"input_preserved":True},409)
            if isinstance(exc,(KeyError,FileNotFoundError)):return self.send({"error":str(exc).strip("'")},404)
            if isinstance(exc,(ValueError,TypeError,UnicodeError)):return self.send({"error":str(exc)},400)
            sys.stderr.write("Standards operation failed: "+type(exc).__name__+"\n")
            return self.send({"error":"The operation did not complete; its transaction was not partially saved."},500)
    return Handler

def main(argv=None):
    parser=argparse.ArgumentParser(description="Bilingual standards drafting, review and SCC delivery workspace")
    parser.add_argument("--workspace",type=Path,default=Path("standards-workspace"))
    parser.add_argument("--port",type=int,default=8773)
    parser.add_argument("--demo",action="store_true",help="Adopt the original public municipal-reconciliation source package once")
    parser.add_argument("--authored-demo",action="store_true",help="Adopt the separate explicitly authored committee/finance example once")
    parser.add_argument("--restore",type=Path)
    parser.add_argument("--list",action="store_true")
    parser.add_argument("--export",metavar="PROJECT_ID")
    parser.add_argument("--audience",choices=("private_restore","edition","management"),default="private_restore")
    parser.add_argument("--edition-id");parser.add_argument("--comparison-edition-id");parser.add_argument("--publication-id")
    parser.add_argument("--include-source-id",action="append",default=[])
    parser.add_argument("--output",type=Path)
    parser.add_argument("--no-serve",action="store_true")
    args=parser.parse_args(argv);workspace=Workspace(args.workspace/"projects.sqlite3")
    if args.restore:print(json.dumps(exports.import_project(workspace,args.restore.read_bytes())))
    if args.demo:print(json.dumps(seed(workspace,"public")))
    if args.authored_demo:print(json.dumps(seed(workspace,"authored")))
    if args.list:print(json.dumps(workspace.list_projects(),ensure_ascii=False))
    if args.export:
        if not args.output:parser.error("--export requires --output")
        raw,manifest=exports.export_project(workspace,args.export,args.audience,args.edition_id,args.publication_id,args.comparison_edition_id,args.include_source_id)
        args.output.parent.mkdir(parents=True,exist_ok=True);args.output.write_bytes(raw)
        print(json.dumps({"path":str(args.output),"bytes":len(raw),"project_id":manifest["project_id"],"revision":manifest["revision"],"audience":manifest["audience"]}))
        return
    if args.no_serve or args.list:return
    server=ThreadingHTTPServer(("127.0.0.1",args.port),handler_for(workspace))
    print(f"Standards drafting workspace: http://127.0.0.1:{server.server_port}",flush=True)
    print(f"Workspace: {args.workspace.resolve()}",flush=True)
    try:server.serve_forever(poll_interval=.3)
    except KeyboardInterrupt:pass
    finally:server.server_close()

if __name__=="__main__":main()
