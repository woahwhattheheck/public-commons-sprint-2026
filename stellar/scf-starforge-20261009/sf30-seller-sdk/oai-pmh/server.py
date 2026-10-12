"""MIT. Loopback operator console for the original OAI/XML workspace."""
from __future__ import annotations
import base64
import json
import os
import signal
from pathlib import Path
import tempfile
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit, parse_qs
import uuid
import zipfile
from workspace import Workspace
from harvest import InputError, jbytes, decode
from islandora import IslandoraDesk, path_under
from islandora_io import payload_bytes, manifest_document, log_page, selected_log, desk_state

HERE=Path(__file__).resolve().parent
MAX_BODY=48*1024*1024

class Console:
    def __init__(self,workspace):
        self.ws=workspace;self.worker=None;self.error=None;self.lock=threading.Lock()
        self.token=uuid.uuid4().hex
        self.islandora=IslandoraDesk(workspace)

    def run(self,identity):
        with self.lock:
            if self.worker and self.worker.is_alive(): raise InputError("A harvest is already running in this console")
            self.error=None
            def work():
                try: self.ws.resume(identity)
                except Exception as e: self.error=str(e)
            self.worker=threading.Thread(target=work,name="oai-harvest",daemon=False)
            self.worker.start()
        return {"operationId":identity,"running":True}

    def islandora_action(self,name,p):
        desk=self.islandora
        if name=="create":return desk.create(p["buildId"],p["label"],p["host"],p.get("config"),p.get("plan"),p.get("baseline") or None)
        if name=="configure":return desk.configure(p["id"],p.get("host"),p.get("config"))
        if name=="rebuild":return desk.rebuild(p["id"],p["plan"])
        if name=="edit":return desk.edit(p["id"],p["identifier"],p.get("overrides"),p.get("choices"))
        if name=="attach":return desk.attach(p["id"],manifest_document(payload_bytes(p),"assets"),p["assetRoot"])
        if name=="relationships":return desk.relationships(p["id"],manifest_document(payload_bytes(p),"relationships"))
        if name=="associations":return desk.associations(p["id"],p["identifier"],assets=p.get("assets"),parents=p.get("parents"))
        if name=="receive":
            kind=p.get("kind","target")
            if kind not in {"target","map"}:raise InputError("Choose target records or a source-to-node map")
            return desk.receive(p["id"],payload_bytes(p),kind,p.get("host"))
        if name=="inspect-target":return desk.start_inspection(p["id"])
        if name=="import-native-map":return desk.import_native_map(p["id"])
        if name=="review":return desk.review(p["id"],p["operator"],p["note"])
        if name=="prepare":return desk.prepare(p["id"])
        if name=="start":return desk.start(p["id"],p["batch"],p["workbench"],python=p.get("python") or None,check=p.get("check",False))
        if name=="stop":return desk.stop()
        if name=="finish":return desk.finish(p["id"],p["operator"],p["note"])
        raise InputError("Choose an Islandora desk action")

    def backup(self,destination):
        desk=self.islandora
        if desk.worker and desk.worker.is_alive():
            raise InputError("Complete or stop native work before saving the full workspace")
        if not desk.operation_lock.acquire(blocking=False):
            raise InputError("The current migration operation is still using this workspace")
        try:
            return self.ws.backup(destination)
        finally:
            desk.operation_lock.release()

    def action(self,name,p):
        ws=self.ws
        if name.startswith("islandora."):return self.islandora_action(name.split(".",1)[1],p)
        if name=="repository": return ws.add_repository(p["url"],p.get("label"),p.get("interval",2.1))
        if name=="start":
            op=ws.start(p["repositoryId"],p["verb"],p.get("arguments",{}),p["operationId"],p.get("baseline"))
            return {"operation":op,"execution":self.run(op["id"])} if p.get("run",True) else op
        if name=="run": return self.run(p["id"])
        if name=="cancel": ws.cancel.set();return {"operationId":ws.active,"cancelling":True}
        if name=="restart": return ws.restart(p["id"],p["expectedRevision"])
        if name=="preview": return ws.preview(p["operationId"],p.get("choices"))
        if name=="review": return ws.review(p["id"],p["expectedDigest"],p["reviewer"],p["note"])
        if name=="mapping": return ws.save_mapping(p["plan"])
        if name=="build": return ws.build(p["editionId"],p["planId"])
        if name=="query": return ws.query(p["buildId"],p.get("query",{}))
        if name=="import":
            if self.worker and self.worker.is_alive(): raise InputError("The active harvest owns its response input; finish or cancel it before importing another host response")
            body=base64.b64decode(p["bodyBase64"],validate=True)
            if len(body)>32*1024*1024: raise InputError("Use the native import command for response pages larger than 32 MiB")
            metadata=p["metadata"]
            with tempfile.NamedTemporaryFile(dir=ws.area/"tmp") as file:
                file.write(body);file.flush()
                return ws.ingest(p["operationId"],file.name,metadata["url"],metadata["status"],
                                 metadata.get("headers",[]),metadata.get("finalURL"),metadata.get("observedAt"))
        raise InputError("Unknown operator action")

def serve(root,port=0,*,expected_binding=None,startup_format=None):
    if startup_format not in (None,"json"): raise InputError("Choose JSON managed startup")
    binding=None;launch=None
    if expected_binding is not None or startup_format=="json":
        from managed import require_binding
        binding=require_binding(root,expected_binding)
    ws=Workspace(root);console=Console(ws)
    class Handler(BaseHTTPRequestHandler):
        server_version="StarforgeOAI/1.0"
        def log_message(self,*args): pass
        def valid(self,write=False):
            host=self.headers.get("Host")
            expected="127.0.0.1:"+str(self.server.server_port)
            if host!=expected: raise InputError("Use this console's loopback address")
            origin=self.headers.get("Origin")
            if origin and origin!="http://"+expected: raise InputError("Use this console's own origin")
            if self.headers.get("Sec-Fetch-Site") not in (None,"same-origin","none"):
                raise InputError("This operation belongs to the local console")
            if write and self.headers.get("X-OAI-Session")!=console.token:
                raise InputError("Reload the local console session before changing its workspace")
        def send(self,status,body,kind="application/json; charset=utf-8",extra=None):
            if not isinstance(body,bytes): body=jbytes(body)
            self.send_response(status);self.send_header("Content-Type",kind)
            self.send_header("Content-Length",str(len(body)))
            self.send_header("Cache-Control","no-store")
            self.send_header("X-Content-Type-Options","nosniff")
            self.send_header("Referrer-Policy","no-referrer")
            self.send_header("Content-Security-Policy","default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'")
            for k,v in (extra or {}).items():self.send_header(k,v)
            self.end_headers();self.wfile.write(body)
        def file(self,path,filename,kind="application/octet-stream"):
            self.send_response(200);self.send_header("Content-Type",kind)
            self.send_header("Content-Disposition",'attachment; filename="'+filename+'"')
            self.send_header("Content-Length",str(path.stat().st_size));self.send_header("Cache-Control","no-store")
            self.send_header("X-Content-Type-Options","nosniff");self.end_headers()
            with path.open("rb") as source:
                while chunk:=source.read(65536):self.wfile.write(chunk)
        def do_GET(self):
            try:
                self.valid()
                url=urlsplit(self.path);q={k:v[-1] for k,v in parse_qs(url.query).items()}
                offset=int(q.get("offset",0));limit=int(q.get("limit",100))
                if url.path=="/":
                    page=(HERE/"index.html").read_text().replace("SESSION_TOKEN",console.token)
                    return self.send(200,page.encode(),"text/html; charset=utf-8")
                if url.path in {"/browser.mjs","/style.css","/islandora.mjs","/islandora.css"}:
                    return self.send(200,(HERE/url.path[1:]).read_bytes(),
                        "text/javascript; charset=utf-8" if url.path.endswith("mjs") else "text/css; charset=utf-8")
                if url.path=="/api/launch":
                    self.valid(True)
                    if launch is None:return self.send(404,{"error":"This console has no managed launch"})
                    return self.send(200,launch)
                if url.path=="/api/state":
                    return self.send(200,{**ws.state(),"workerError":console.error,
                        "running":bool(console.worker and console.worker.is_alive()),
                        "islandoraRunning":bool(console.islandora.worker and console.islandora.worker.is_alive()),
                        "islandoraError":getattr(console.islandora,"last_error",None)})
                if url.path=="/api/islandora/state":return self.send(200,desk_state(console.islandora))
                if url.path=="/api/islandora/inventory":return self.send(200,console.islandora.inventory(q["build"]))
                if url.path=="/api/islandora/default-plan":return self.send(200,console.islandora.default_plan(q["build"]))
                if url.path=="/api/islandora/job":return self.send(200,console.islandora.job(q["id"]))
                if url.path=="/api/islandora/records":return self.send(200,console.islandora.records(q["job"],offset,limit,q.get("kind",""),q.get("query","")))
                if url.path=="/api/islandora/record":return self.send(200,console.islandora.record(q["job"],q["identifier"]))
                if url.path=="/api/islandora/log":return self.send(200,log_page(console.islandora,q["job"],q["run"],offset,int(q.get("bytes",65536))))
                if url.path=="/api/catalog":return self.send(200,ws.catalog(q["repository"],q["kind"],offset,limit))
                if url.path=="/api/requests":return self.send(200,ws.requests(q["operation"],offset,limit))
                if url.path=="/api/changes":return self.send(200,ws.changes(q["preview"],q.get("kind"),offset,limit))
                if url.path=="/api/records":return self.send(200,ws.records(q["edition"],offset,limit,q.get("query","")))
                if url.path=="/api/history":return self.send(200,ws.history(q["kind"],offset,limit))
                if url.path=="/api/default-mapping":return self.send(200,ws.default_mapping())
                if url.path=="/api/metadata-mapping":return self.send(200,ws.metadata_mapping(q["edition"]))
                if url.path=="/api/object":
                    kind=q["kind"];ident=q["id"]
                    if kind=="observation": value=ws.observation(ident)
                    elif kind=="mapping": value=ws.xml.plan(ident)
                    elif kind=="source": value=ws.xml.source(ident)
                    elif kind in {"operation","repository","preview","edition","build"}:
                        table={"operation":"oai_operations","repository":"oai_repositories","preview":"oai_previews",
                               "edition":"oai_editions","build":"oai_builds"}[kind]
                        with ws.mutex:value=ws._get(table,ident)
                    else: raise InputError("Unknown retained object")
                    return self.send(200,value)
                if url.path=="/download/response":
                    with ws.mutex:
                        req=ws._get("oai_requests",q["id"]);body=req.get("response")
                        if not body:raise InputError("This request has no complete response body")
                        path=ws.root/body["path"]
                        from bridge import storage
                        if storage.file_digest(path)!=body["sha256"]:raise InputError("Retained response bytes changed")
                    return self.file(path,body["sha256"]+(".xml" if body["xmlSourceId"] else ".bin"))
                if url.path=="/download/islandora-guide":
                    return self.file(HERE/"ISLANDORA_OPERATOR_GUIDE.md","ISLANDORA_OPERATOR_GUIDE.md","text/markdown; charset=utf-8")
                if url.path=="/download/islandora":
                    with tempfile.TemporaryDirectory(dir=ws.area/"tmp") as directory:
                        output=Path(directory)/"migration.zip"
                        console.islandora.export(q["job"],output)
                        return self.file(output,"islandora-migration-"+q["job"][:12]+".zip","application/zip")
                if url.path=="/download/islandora-log":
                    run,path=selected_log(console.islandora,q["job"],q["run"])
                    if not path.is_file():raise InputError("This native run has not written its log yet")
                    return self.file(path,"islandora-native-"+run["id"][:12]+".log","text/plain; charset=utf-8")
                if url.path=="/download/islandora-run-input":
                    job=console.islandora.job(q["job"])
                    run=next((r for r in job.get("runs",[]) if r["id"]==q["run"]),None)
                    if run is None:raise InputError("Select a saved native run")
                    kind=q.get("kind","csv")
                    if kind not in {"csv","config","preparedConfig"}:
                        raise InputError("Select this run's CSV or configuration")
                    item=run.get("inputs",{}).get(kind)
                    if item is None:raise InputError("This earlier run has no saved input copy")
                    path=path_under(console.islandora.directory(job["id"]),item["path"])
                    from bridge import storage
                    if storage.file_digest(path)!=item["sha256"]:
                        raise InputError("The retained native input changed")
                    return self.file(path,"islandora-"+run["id"][:12]+"-"+path.name,
                        "text/csv; charset=utf-8" if kind=="csv" else "application/yaml")
                if url.path=="/download/islandora-input":
                    job=console.islandora.job(q["job"])
                    batch=next((b for b in job.get("batches",[]) if b["name"]==q["batch"]),None)
                    if batch is None:raise InputError("Select a prepared native batch")
                    kind=q.get("kind","csv")
                    if kind not in {"csv","config"}:raise InputError("Select the original CSV or configuration")
                    path=path_under(console.islandora.directory(job["id"]),"batches/"+batch[kind])
                    from bridge import storage
                    if storage.file_digest(path)!=batch["csvSha256" if kind=="csv" else "configSha256"]:
                        raise InputError("Prepared native inputs changed; prepare the current migration again")
                    return self.file(path,path.name,"text/csv; charset=utf-8" if kind=="csv" else "application/yaml")
                if url.path in {"/download/source","/download/backup"}:
                    with tempfile.TemporaryDirectory(dir=ws.area/"tmp") as directory:
                        temp=Path(directory);out=temp/"download.zip"
                        if url.path.endswith("source"):
                            result=ws.export_source(q["build"],temp/"source")
                            with zipfile.ZipFile(out,"w",zipfile.ZIP_DEFLATED,compresslevel=6) as archive:
                                for file in (temp/"source").rglob("*"):
                                    if file.is_file():archive.write(file,file.relative_to(temp/"source").as_posix())
                            os.chmod(out,0o600)
                            return self.file(out,"oai-source-"+q["build"][:12]+".zip","application/zip")
                        console.backup(out)
                        return self.file(out,"oai-workspace.zip","application/zip")
                return self.send(404,{"error":"Page was not found"})
            except (InputError,ValueError,KeyError,OSError) as e:return self.send(400,{"error":str(e)})
        def do_POST(self):
            try:
                self.valid(True)
                if self.path!="/api/action":return self.send(404,{"error":"Action endpoint was not found"})
                if self.headers.get("Content-Type","").split(";")[0]!="application/json":raise InputError("Send a JSON action")
                length=int(self.headers.get("Content-Length","0"))
                if not 0<length<=MAX_BODY:raise InputError("Action body exceeds the 48 MiB console limit")
                body=decode(self.rfile.read(length))
                if not isinstance(body,dict) or not isinstance(body.get("payload",{}),dict):raise InputError("Invalid action body")
                return self.send(200,console.action(body["action"],body.get("payload",{})))
            except (InputError,ValueError,KeyError,OSError) as e:return self.send(400,{"error":str(e)})
    server=ThreadingHTTPServer(("127.0.0.1",port),Handler)
    if binding is not None:
        from managed import startup
        launch=startup(server,binding,console.token)
    print(json.dumps(launch if startup_format=="json" else
        {"url":"http://127.0.0.1:"+str(server.server_port),"workspace":str(ws.root),"pid":os.getpid()}),flush=True)
    previous_term=None
    if binding is not None and threading.current_thread() is threading.main_thread():
        previous_term=signal.getsignal(signal.SIGTERM)
        def terminate(signum,frame):raise KeyboardInterrupt
        signal.signal(signal.SIGTERM,terminate)
    try:server.serve_forever(poll_interval=0.2)
    except KeyboardInterrupt:pass
    finally:
        if previous_term is not None:signal.signal(signal.SIGTERM,previous_term)
        ws.cancel.set()
        if console.worker:console.worker.join()
        console.islandora.stop()
        if console.islandora.worker:console.islandora.worker.join()
        server.server_close();ws.close()
