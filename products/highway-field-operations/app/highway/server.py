"""Loopback staff application over the original saved workspace."""
import argparse, fcntl, hmac, mimetypes, os, secrets, stat, threading, urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from .common import *
from .workspace import Workspace
from .exchange import export_workspace, receive_archive, source_inventory, validate_archive
from . import domain, dispatch, field_exchange
from .field_delivery import issue_field, retain_return, field_file, compare_field

class Application:
    def __init__(self,workspace,source_root,selection,port=0,native_workspace=None,receiving_root=None):
        self.workspace=workspace;self.root,self.source_files=source_inventory(source_root,selection)
        self.selection=selection;self.token=secrets.token_urlsafe(32);self.closed=False;self.bridge=None
        self.receiving_root=canonical_directory(receiving_root) if receiving_root is not None else None
        if native_workspace is not None:
            from .native_bridge import NativeBridge
            self.bridge=NativeBridge(workspace,native_workspace)
        self.server=ThreadingHTTPServer(("127.0.0.1",port),self._handler())
        self.server.daemon_threads=False;self.server.block_on_close=True
        self.origin="http://127.0.0.1:"+str(self.server.server_address[1]);self.thread=None
    def _handler(self):
        app=self
        class Handler(BaseHTTPRequestHandler):
            protocol_version="HTTP/1.1"
            def setup(self):
                super().setup();self.connection.settimeout(90)
            def log_message(self,*args):pass
            def send(self,status,data,media="application/json",filename=None):
                if not isinstance(data,bytes):data=canonical(data)
                self.send_response(status);self.send_header("Content-Type",media)
                self.send_header("Content-Length",str(len(data)));self.send_header("Cache-Control","no-store")
                self.send_header("X-Content-Type-Options","nosniff");self.send_header("Referrer-Policy","no-referrer")
                self.send_header("Content-Security-Policy","default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob: data:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'")
                if filename:self.send_header("Content-Disposition",'attachment; filename="'+filename+'"')
                self.send_header("Connection","close");self.end_headers();self.close_connection=True
                try:self.wfile.write(data)
                except (BrokenPipeError,ConnectionResetError):pass
            def boundary(self,api):
                require(self.headers.get("Host")==urllib.parse.urlsplit(app.origin).netloc,"HOST","Use the original local application address.")
                origin=self.headers.get("Origin")
                require(origin in (None,app.origin),"ORIGIN","Request belongs to another origin.")
                require(self.headers.get("Sec-Fetch-Site") not in ("cross-site",),"ORIGIN","Cross-site requests are unavailable.")
                if api:
                    require(hmac.compare_digest(self.headers.get("Authorization",""),"Bearer "+app.token),"CONNECTION","Open the private application launch link.")
            def selected(self,query,body=None):
                current=app.workspace.current()
                expected_id=current["state"]["id"];expected_directory=str(app.workspace.directory)
                selected_id=self.headers.get("X-Workspace-Id") or query.get("workspaceId",[""])[0]
                selected_directory=self.headers.get("X-Workspace-Directory") or query.get("workspaceDirectory",[""])[0]
                require(selected_id==expected_id and selected_directory==expected_directory,"WORKSPACE_BRANCH_CHANGED","Open this exact original or received workspace directory.")
                if body is not None:
                    require(isinstance(body,dict) and body.get("workspaceId")==expected_id and body.get("workspaceDirectory")==expected_directory,"WORKSPACE_BRANCH_CHANGED","The original request belongs to a different physical workspace.")
            def body(self,limit=8*1024*1024,json_body=True):
                require(not self.headers.get("Transfer-Encoding"),"BODY","Use an explicit complete request length.")
                raw=self.headers.get("Content-Length")
                require(raw is not None and raw.isdigit(),"BODY","Request byte length is required.")
                length=int(raw);require(length<=limit,"BODY_LIMIT","Request exceeds its allowance.")
                data=self.rfile.read(length);require(len(data)==length,"BODY_INCOMPLETE","The complete request did not arrive.")
                return loads(data) if json_body else data
            def run(self,method):
                try:
                    parsed=urllib.parse.urlsplit(self.path);path=parsed.path;q=urllib.parse.parse_qs(parsed.query)
                    api=path.startswith("/api/");self.boundary(api)
                    if not api:
                        require(method=="GET","METHOD","Use the original API for changes.")
                        paths={"/":"public/index.html","/app.js":"public/app.js","/style.css":"public/style.css","/guide":"public/guide.html","/field-host.js":"public/field-host.js"}
                        require(path in paths,"NOT_FOUND","This application page does not exist.")
                        target=app.root/paths[path];data=read_regular(target)
                        selected=next((x for x in app.source_files if x["path"]==paths[path]),None)
                        require(selected is not None and len(data)==selected["bytes"] and sha(data)==selected["sha256"],"SOURCE_CHANGED","This application asset differs from its selected source.")
                        return self.send(200,data,mimetypes.guess_type(target)[0] or "application/octet-stream")
                    with app.workspace.lock:
                        app.workspace._active()
                        if path!="/api/state":self.selected(q)
                        if method=="GET":
                            current=app.workspace.current();state=current["state"]
                            if path=="/api/state":
                                return self.send(200,{**current,"directory":str(app.workspace.directory),"view":domain.describe(state,app.workspace.read_blob),"dispatch":dispatch.dispatch_view(state,app.workspace.read_blob),"sourceSha256":app.selection["sha256"],"pairedAvailable":app.bridge is not None})
                            if path=="/api/field-compare":
                                return self.send(200,compare_field(app.workspace,identifier(q.get("id",[""])[0]),
                                    q.get("edition", [None])[0],q.get("adoption", [None])[0]))
                            if path=="/api/field-document":
                                return self.send(200,field_exchange.read_document(state,q.get("kind",[""])[0],
                                    identifier(q.get("id",[""])[0]),app.workspace.read_blob))
                            if path=="/api/field-file":
                                raw,media,filename=field_file(app.workspace,q.get("kind",[""])[0],
                                    identifier(q.get("id",[""])[0]),q.get("format",["original"])[0])
                                return self.send(200,raw,media,filename)
                            if path=="/api/records":
                                capture=q.get("capture",[""])[0];identifier(capture)
                                layer=int(q.get("layer",["-1"])[0]);offset=int(q.get("offset",["0"])[0]);limit=int(q.get("limit",["100"])[0])
                                require(offset>=0 and 1<=limit<=250,"PAGE","Use a bounded record page.")
                                value=domain.dataset_records(state,capture,layer,app.workspace.read_blob)
                                rows=value.pop("records");end=min(len(rows),offset+limit)
                                return self.send(200,{**value,"records":rows[offset:end],"offset":offset,"total":len(rows),"nextOffset":end if end<len(rows) else None})
                            if path=="/api/dispatch-report":
                                return self.send(200,dispatch.dispatch_report_html(state,identifier(q.get("id",[""])[0])).encode("utf-8"),"text/html","Highway_Operating_Report.html")
                            if path=="/api/inspection":
                                return self.send(200,domain.inspection_view(state,identifier(q.get("id",[""])[0]),app.workspace.read_blob))
                            if path=="/api/native-request":
                                require(app.bridge is not None,"NATIVE_NOT_CONFIGURED","Start the application with its original paired workspace.")
                                return self.send(200,app.bridge.read(identifier(q.get("id",[""])[0])))
                            if path=="/api/history":
                                return self.send(200,app.workspace.history(int(q.get("offset",["0"])[0]),int(q.get("limit",["50"])[0])))
                            if path=="/api/request":
                                return self.send(200,{"request":app.workspace.request(identifier(q.get("id",[""])[0]))})
                            if path=="/api/blob":
                                key=sha_id(q.get("sha256",[""])[0]);return self.send(200,app.workspace.read_blob(key),"application/octet-stream",key)
                            if path=="/api/export":
                                pub=identifier(q.get("id",[""])[0]);p=app.workspace.directory/"exports"/pub/"Highway_Field_Workspace.zip"
                                return self.send(200,read_regular(p,MAX_ARCHIVE),"application/zip","Highway_Field_Workspace.zip")
                            fail("NOT_FOUND","This saved record is unavailable.")
                        if method=="POST" and path=="/api/field-file":
                            raw=self.body(MAX_BLOB,False)
                            return self.send(200,retain_return(app.workspace,raw,self.headers.get("X-Content-SHA256")))
                        if method=="POST" and path=="/api/blob":
                            raw=self.body(MAX_BLOB,False);expected=self.headers.get("X-Content-SHA256")
                            return self.send(200,app.workspace.put_blob(raw,expected))
                        if method=="POST" and path=="/api/archive":
                            raw=self.body(MAX_ARCHIVE,False);key=sha(raw)
                            require(self.headers.get("X-Content-SHA256")==key,"ARCHIVE_CHANGED","Upload hash differs.")
                            directory=app.workspace.directory/"uploads";directory.mkdir(exist_ok=True,mode=0o700)
                            target=directory/(key+".zip");atomic_file(target,raw,immutable=True)
                            desc,z,h=validate_archive(target,key,len(raw));z.close()
                            return self.send(200,desc)
                        if method=="POST":
                            body=self.body();self.selected(q,body)
                            if path=="/api/field-issue":
                                return self.send(200,issue_field(app.workspace,body["request"],body["expectedRevision"],app.root,app.selection))
                            if path=="/api/dataset":
                                require(app.bridge is not None,"NATIVE_NOT_CONFIGURED","Start the application with its original paired workspace.")
                                from .dataset import prepare_dataset
                                return self.send(200,prepare_dataset(app.workspace,app.root,identifier(body["operationId"]),body["selection"]))
                            if path=="/api/native":
                                require(app.bridge is not None,"NATIVE_NOT_CONFIGURED","Start the application with its original paired workspace.")
                                return self.send(200,app.bridge.perform(identifier(body["operationId"]),body["operation"],body["body"]))
                            if path=="/api/native-restore":
                                from .native_bridge import restore_operation
                                return self.send(200,restore_operation(app.workspace,identifier(body["recordId"]),identifier(body["operationId"])))
                            if path=="/api/command":return self.send(200,app.workspace.execute(body["command"],body["expectedRevision"]))
                            if path=="/api/export":
                                result=export_workspace(app.workspace,identifier(body["publicationId"]),app.root,app.selection,body["revision"])
                                return self.send(200,{k:v for k,v in result.items() if k!="path"})
                            if path=="/api/receive":
                                op=identifier(body["operationId"]);key=sha_id(body["sha256"])
                                directory=app.receiving_root or app.workspace.directory/"received";directory.mkdir(exist_ok=True,mode=0o700)
                                archive=app.workspace.directory/"uploads"/(key+".zip")
                                result=receive_archive(archive,directory/op,operation_id=op,expected_sha256=key,expected_bytes=body["bytes"])
                                return self.send(200,result)
                            fail("NOT_FOUND","This operation is unavailable.")
                        fail("METHOD","Unsupported request method.")
                except BaseException as ex:
                    code=getattr(ex,"code","APPLICATION_ERROR")
                    status=409 if code in ("REVISION_CONFLICT","REQUEST_CONFLICT","PUBLICATION_CONFLICT","IMMUTABLE_CONFLICT") else 400
                    message=str(ex) if isinstance(ex,ValueError) else "The original operation did not complete. Retain its request and inspect the local log."
                    try:self.send(status,{"error":{"code":code,"message":message,"details":getattr(ex,"details",None)}})
                    except (BrokenPipeError,ConnectionResetError):pass
            def do_GET(self):self.run("GET")
            def do_POST(self):self.run("POST")
        return Handler
    def start(self):
        require(self.thread is None,"ALREADY_STARTED","Application is already listening.")
        self.thread=threading.Thread(target=self.server.serve_forever,name="highway-http",daemon=False);self.thread.start()
        return {"origin":self.origin,"url":self.origin+"/#"+self.token,"workspaceId":self.workspace.current()["state"]["id"],"workspaceDirectory":str(self.workspace.directory),"sourceSha256":self.selection["sha256"]}
    def close(self):
        if self.closed:return
        failures=[]
        if self.thread and self.thread.ident is not None:
            try:self.server.shutdown()
            except BaseException as error:failures.append(error)
            try:self.thread.join()
            except BaseException as error:failures.append(error)
        try:self.server.server_close()
        except BaseException as error:failures.append(error)
        self.closed=not failures
        if failures:raise HighwayError("CLOSE_FAILED","Original application resource closure did not complete: "+",".join(type(x).__name__ for x in failures))
