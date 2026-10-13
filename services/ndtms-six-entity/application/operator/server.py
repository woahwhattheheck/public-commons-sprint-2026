#!/usr/bin/env python3
from __future__ import annotations
import argparse,hashlib,json,os,queue,secrets,signal,sqlite3,sys,threading,traceback
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs,urlsplit,quote
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from nelc.common import *
from nelc.workspace import Workspace
from nelc.portable import backup,receive
from nelc.ndtms import profile_document

ROOT=Path(__file__).resolve().parents[1]
WEB=Path(__file__).resolve().parent/"web"

class TaskQueue:
    def __init__(self,workspace):
        self.workspace=workspace;self.stop=threading.Event();self.queue=queue.Queue();self.lock=threading.RLock();self.enqueued=set()
        self.directory=workspace.root/"tasks";self.directory.mkdir(exist_ok=True)
        for path in self.directory.glob("*.json"):
            require(not path.is_symlink(),"TASK_PATH","A retained task cannot be a symlink.")
            value=json.loads(path.read_text("utf-8"))
            if value["state"] in ("QUEUED","RUNNING"):
                committed=workspace.operation(value["id"]) if value["input"]["kind"]=="operation" else None
                value.update(state="COMPLETED" if committed else "INTERRUPTED",result=committed,
                             updatedAt=now(),error=None if committed else {"code":"INTERRUPTED","message":"The previous owner ended. Resume this same original task."})
                atomic_bytes(path,(canonical(value)+"\n").encode())
        self.thread=threading.Thread(target=self._work,name="nelc-original-task-owner",daemon=False);self.thread.start()
    def path(self,id):
        text(id,"task ID",maximum=160);return self.directory/(hashlib.sha256(id.encode()).hexdigest()+".json")
    def read(self,id):
        path=self.path(id);require(path.is_file() and not path.is_symlink(),"TASK_MISSING","The original task is not retained.")
        return json.loads(path.read_text("utf-8"))
    def _save(self,value):atomic_bytes(self.path(value["id"]),(canonical(value)+"\n").encode())
    def submit(self,body):
        require(isinstance(body,dict) and body.get("kind") in ("operation","backup","receive"),"TASK_KIND","Select a supported task.")
        id=text(body.get("id"),"task ID",maximum=160);resume=body.get("resume") is True
        original={k:v for k,v in body.items() if k!="resume"};fingerprint=digest(original)
        if body["kind"]=="operation":
            require(body.get("request",{}).get("requestId")==id,"TASK_REQUEST_ID","Task and original operation IDs must match.")
        with self.lock:
            require(not self.stop.is_set(),"OPERATOR_STOPPING","The operator is closing its owned task.")
            path=self.path(id)
            if path.exists():
                value=self.read(id);require(value["inputSha256"]==fingerprint,"TASK_ID_CONFLICT","This task ID belongs to different original input.")
                if value["state"]=="COMPLETED" or id in self.enqueued:return value
                require(resume,"TASK_RESUME","Resume the retained original task explicitly.")
            else:
                value={"schema":"nelc.task/v1","id":id,"input":original,"inputSha256":fingerprint,
                       "state":"QUEUED","createdAt":now(),"updatedAt":now(),"result":None,"error":None}
            value.update(state="QUEUED",updatedAt=now(),error=None);self._save(value)
            self.enqueued.add(id);self.queue.put(id);return value
    def _work(self):
        while not self.stop.is_set():
            try:id=self.queue.get(timeout=.2)
            except queue.Empty:continue
            try:
                with self.lock:
                    value=self.read(id);value.update(state="RUNNING",updatedAt=now());self._save(value)
                body=value["input"];check_stop(self.stop)
                if body["kind"]=="operation":result=self.workspace.mutate(body["request"],self.stop)
                elif body["kind"]=="backup":result=backup(self.workspace,ROOT,body.get("revision"),self.stop)
                else:result=receive(self.workspace,body.get("object"),body.get("name"),self.stop)
                with self.lock:
                    value.update(state="COMPLETED",result=result,error=None,updatedAt=now());self._save(value)
            except BaseException as error:
                try:
                    with self.lock:
                        committed=self.workspace.operation(id) if value["input"]["kind"]=="operation" else None
                        if committed:value.update(state="COMPLETED",result=committed,error=None,updatedAt=now())
                        else:value.update(state="INTERRUPTED" if isinstance(error,(Cancelled,KeyboardInterrupt,InterruptedError)) else "FAILED",
                            error=error.as_dict() if isinstance(error,Problem) else {"code":"INTERRUPTED" if isinstance(error,(Cancelled,KeyboardInterrupt,InterruptedError)) else "TASK_FAILED",
                            "message":str(error)[:4000]},updatedAt=now())
                        self._save(value)
                except BaseException:traceback.print_exc(file=sys.stderr)
            finally:
                with self.lock:self.enqueued.discard(id)
                self.queue.task_done()
    def list(self):
        with self.lock:
            values=[json.loads(p.read_text("utf-8")) for p in self.directory.glob("*.json") if p.is_file() and not p.is_symlink()]
            return sorted(values,key=lambda x:x["createdAt"],reverse=True)[:100]
    def close(self):
        self.stop.set();self.thread.join()

class BoundedReader:
    def __init__(self,stream,remaining):self.stream=stream;self.remaining=remaining
    def read(self,n=-1):
        if self.remaining<=0:return b""
        size=min(self.remaining,n if n>=0 else self.remaining)
        value=self.stream.read(size);self.remaining-=len(value);return value

def handler(workspace,tasks,token):
    class Handler(BaseHTTPRequestHandler):
        protocol_version="HTTP/1.0"
        def setup(self):
            super().setup();self.connection.settimeout(30)
        def log_message(self,*args):pass
        def _send(self,body,status=200,content_type="application/json; charset=utf-8",headers=None):
            if not isinstance(body,bytes):body=json.dumps(body,ensure_ascii=False,allow_nan=False).encode("utf-8")
            self.send_response(status);self.send_header("Content-Type",content_type);self.send_header("Content-Length",str(len(body)))
            self.send_header("Cache-Control","no-store");self.send_header("X-Content-Type-Options","nosniff")
            self.send_header("Referrer-Policy","no-referrer")
            self.send_header("Content-Security-Policy","default-src 'self'; connect-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; object-src 'none'; frame-ancestors 'none'; base-uri 'none'")
            for k,v in (headers or {}).items():self.send_header(k,v)
            self.end_headers();self.wfile.write(body)
        def _authorize(self):
            require(secrets.compare_digest(self.headers.get("Authorization",""),"Bearer "+token),"AUTH_REQUIRED","Open this operator using its current local session URL.")
            origin=self.headers.get("Origin")
            allowed={"http://127.0.0.1:"+str(self.server.server_port),"http://localhost:"+str(self.server.server_port)}
            require(origin is None or origin in allowed,"ORIGIN","The request must come from this local operator.")
        def _query(self):
            split=urlsplit(self.path);return split.path,parse_qs(split.query,keep_blank_values=True)
        def _json(self):
            length=int(self.headers.get("Content-Length","-1"));require(0<=length<=32*1024*1024,"REQUEST_SIZE","Supply a JSON body no larger than 32 MiB.")
            body=self.rfile.read(length);require(len(body)==length,"REQUEST_LENGTH","The request body ended before its declared length.")
            return json.loads(body.decode("utf-8"))
        def _file(self,path,name,content_type="application/octet-stream"):
            require(path.is_file() and not path.is_symlink(),"DOWNLOAD_MISSING","The selected retained file is unavailable.")
            self.send_response(200);self.send_header("Content-Type",content_type);self.send_header("Content-Length",str(path.stat().st_size))
            self.send_header("Content-Disposition","attachment; filename*=UTF-8''"+quote(safe_name(name),safe=""))
            self.send_header("Cache-Control","no-store");self.send_header("X-Content-Type-Options","nosniff");self.end_headers()
            with path.open("rb") as stream:
                while True:
                    chunk=stream.read(1024*1024)
                    if not chunk:break
                    self.wfile.write(chunk)
        def do_GET(self):
            try:
                path,q=self._query()
                if path=="/health":return self._send({"schema":"nelc.operator-health/v1","ready":not tasks.stop.is_set()})
                static={"/":("index.html","text/html; charset=utf-8"),"/app.mjs":("app.mjs","text/javascript; charset=utf-8"),"/style.css":("style.css","text/css; charset=utf-8"),"/ndtms.mjs":("ndtms.mjs","text/javascript; charset=utf-8")}
                if path in static:
                    name,mime=static[path];return self._send((WEB/name).read_bytes(),content_type=mime)
                self._authorize()
                one=lambda name,default=None:q.get(name,[default])[0]
                if path=="/api/overview":return self._send(workspace.overview())
                if path=="/api/ndtms-profile":
                    return self._send(profile_document()[0])
                if path=="/api/record":return self._send(workspace.record(one("kind"),one("id")))
                if path=="/api/page":
                    return self._send(workspace.page(one("kind"),json.loads(one("selection","{}")),
                        int(one("revision")) if one("revision") is not None else None,int(one("offset","0")),int(one("limit","50"))))
                if path=="/api/tasks":return self._send({"items":tasks.list()})
                if path.startswith("/api/tasks/"):return self._send(tasks.read(path.removeprefix("/api/tasks/")))
                if path.startswith("/api/objects/"):
                    sha=path.removeprefix("/api/objects/")
                    with workspace.connect() as db:
                        row=db.execute("SELECT * FROM objects WHERE sha256=?",(sha,)).fetchone()
                        require(row is not None,"OBJECT_MISSING","The selected retained object is missing.")
                        file=workspace.object(db,dict(row));return self._file(file,one("name",row["name"]))
                if path=="/api/backups":
                    receipts=[json.loads(p.read_text("utf-8")) for p in (workspace.root/"exports").glob("backup-*.json")]
                    return self._send({"items":sorted(receipts,key=lambda x:x["createdAt"],reverse=True)})
                if path.startswith("/api/backups/"):
                    id=path.removeprefix("/api/backups/");require(bool(__import__("re").fullmatch(r"backup-[a-f0-9]{28}",id)),"BACKUP_ID","Select a retained backup.")
                    receipt=json.loads((workspace.root/"exports"/(id+".json")).read_text("utf-8"))
                    file=workspace.root/"exports"/(id+".zip")
                    require(file_hash(file)==(receipt["sha256"],receipt["bytes"]),"BACKUP_CHANGED","The complete backup differs from its receipt.")
                    return self._file(file,id+".zip","application/zip")
                raise Problem("NOT_FOUND","This operator route does not exist.")
            except (BrokenPipeError,ConnectionResetError):return
            except Problem as error:self._send({"error":error.as_dict()},401 if error.code=="AUTH_REQUIRED" else 404 if error.code=="NOT_FOUND" else 409)
            except (ValueError,KeyError,FileNotFoundError) as error:self._send({"error":{"code":"INPUT","message":str(error)}},400)
            except Exception as error:self._send({"error":{"code":"OPERATOR_ERROR","message":str(error)}},500)
        def do_POST(self):
            try:
                path,q=self._query();self._authorize()
                if path=="/api/upload":
                    length=int(self.headers.get("Content-Length","-1"))
                    require(0<=length<=MAX_INPUT_BYTES,"UPLOAD_SIZE","Declare a file no larger than 512 MiB.")
                    name=q.get("name",["upload.bin"])[0];reader=BoundedReader(self.rfile,length)
                    result=workspace.put_stream(reader,name,MAX_INPUT_BYTES,tasks.stop)
                    require(reader.remaining==0 and result["bytes"]==length,"UPLOAD_LENGTH","The uploaded original file ended early.")
                    return self._send(result,201)
                if path=="/api/tasks":return self._send(tasks.submit(self._json()),202)
                raise Problem("NOT_FOUND","This operator route does not exist.")
            except (BrokenPipeError,ConnectionResetError):return
            except Problem as error:self._send({"error":error.as_dict()},401 if error.code=="AUTH_REQUIRED" else 409)
            except (ValueError,KeyError) as error:self._send({"error":{"code":"INPUT","message":str(error)}},400)
            except Exception as error:self._send({"error":{"code":"OPERATOR_ERROR","message":str(error)}},500)
    return Handler

def main(argv=None):
    parser=argparse.ArgumentParser(description="Open the complete local NELC reporting and migration operator.")
    parser.add_argument("--workspace",required=True);parser.add_argument("--create",action="store_true")
    parser.add_argument("--name",default="NELC service workbench");parser.add_argument("--port",type=int,default=0)
    args=parser.parse_args(argv)
    workspace=Workspace(args.workspace,create=args.create,name=args.name)
    server=None;tasks=None;owner=None;prior={};token=secrets.token_hex(32)
    def stop(signum,frame):
        if tasks is not None:tasks.stop.set()
        if server is not None:
            threading.Thread(target=server.shutdown,name="nelc-listener-close",daemon=True).start()
    try:
        owner=sqlite3.connect(workspace.root/"operator-owner.sqlite",timeout=0,isolation_level=None)
        try:
            owner.execute("CREATE TABLE IF NOT EXISTS owner_lock(id INTEGER PRIMARY KEY)")
            owner.execute("BEGIN IMMEDIATE")
        except sqlite3.OperationalError as error:
            raise Problem("OPERATOR_IN_USE","This workspace already has an active local operator.") from error
        tasks=TaskQueue(workspace)
        server=ThreadingHTTPServer(("127.0.0.1",args.port),handler(workspace,tasks,token));server.daemon_threads=False
        prior={sig:signal.signal(sig,stop) for sig in (signal.SIGINT,signal.SIGTERM)}
        base="http://127.0.0.1:"+str(server.server_port)
        print(json.dumps({"schema":"nelc.operator-ready/v1","baseUrl":base,"url":base+"/#token="+token,
                          "workspaceId":workspace.metadata()["id"],"pid":os.getpid()}),flush=True)
        server.serve_forever(poll_interval=.2)
    finally:
        if tasks is not None:tasks.stop.set()
        if server is not None:server.server_close()
        if tasks is not None:tasks.close()
        if owner is not None:owner.close()
        for sig,value in prior.items():signal.signal(sig,value)
if __name__=="__main__":main()
