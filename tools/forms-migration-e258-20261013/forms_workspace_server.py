"""Private loopback HTTP interface for the retained Forms mapping workspace."""
from __future__ import annotations
import sys
sys.dont_write_bytecode = True
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import socket
import signal
import subprocess
import threading
import time
import uuid
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlsplit
from discovery_engine import DiscoveryError, require, parse_json_bytes, json_bytes, read_json
from forms_workspace import Workspace, identifier, measured, immutable, relative, regular_under, RAW_LIMIT, selected_program
from forms_workspace_report import render_html

HERE = Path(__file__).resolve().parent
MAX_UPLOAD = 20*1024**3
MAX_RPC = RAW_LIMIT*6 + 1024*1024
SERVER_SCHEMA = "tjlabs.forms-workspace.server.v1"

def new_json(path,value):
    immutable(Path(path),json_bytes(value))

class UploadIncomplete(DiscoveryError):
    """One retained upload member needs its original same-byte PUT."""

def upload_receipt(value,workspace_id,upload_id,name,identity=None):
    require(isinstance(value,dict) and value.get("schema")=="tjlabs.forms-workspace.upload.v1" and
            value.get("workspace_id")==workspace_id and value.get("upload_id")==upload_id and
            value.get("archive_name")==name,"Original upload receipt identity differs")
    file=value.get("file")
    require(isinstance(file,dict) and set(file)=={"bytes","sha256"} and type(file.get("bytes")) is int and
            0<file["bytes"]<=MAX_UPLOAD and isinstance(file.get("sha256"),str) and
            re.fullmatch(r"[0-9a-f]{64}",file["sha256"]),"Original upload receipt file identity differs")
    if identity is not None:
        require(file==identity,"Upload identity is bound to different original bytes")
    return value

class Service:
    def __init__(self,workspace):
        self.workspace=workspace
        self.root=workspace.root
        self.lock=threading.RLock()
        self.children={}
        self.http_root=self.root.parent/("."+self.root.name+"-forms-controls-"+workspace.meta["workspace_id"])
        require(not self.http_root.is_symlink(),"Private server controls cannot be a symbolic link")
        self.http_root.mkdir(exist_ok=True,mode=0o700)
        (self.http_root/"temp").mkdir(exist_ok=True,mode=0o700)
        self.identity_path=self.http_root/"origin.json"
        self.identity=read_json(self.identity_path) if self.identity_path.exists() else None
        if self.identity:
            require(self.identity.get("workspace_id")==workspace.meta["workspace_id"] and
                    self.identity.get("workspace")==str(self.root) and
                    self.identity.get("source_files")==workspace.meta["source_files"] and
                    self.identity.get("hostname")==socket.gethostname(),
                    "Retained HTTP origin belongs to another workspace or selected source")
            require(re.fullmatch(r"[0-9a-f]{64}",self.identity.get("token","")) is not None,
                    "Retained HTTP access token is invalid")
        else:self.identity={"workspace_id":workspace.meta["workspace_id"],"workspace":str(self.root),
                           "source_files":workspace.meta["source_files"],"hostname":socket.gethostname(),"token":secrets.token_hex(32)}
        self.prefix="/"+self.identity["token"]+"/"
        self.origin=None

    def bind(self,server):
        port=server.server_port
        require("port" not in self.identity or self.identity["port"]==port,
                "The original loopback port must remain unchanged")
        self.identity["port"]=port
        new_json(self.identity_path,self.identity)
        self.origin="http://127.0.0.1:"+str(port)
        return {"schema":SERVER_SCHEMA,"workspace_id":self.workspace.meta["workspace_id"],
                "workspace":str(self.root),"origin":self.origin+self.prefix,
                "pid":os.getpid(),"source_files":self.workspace.meta["source_files"],
                "runtime_source_files":self.workspace.runtime_source_files,
                "upload_limit_bytes":MAX_UPLOAD,"request_limit_bytes":MAX_RPC}

    def upload_descriptor(self,upload_id):
        name=identifier(upload_id,"capture upload identity")+".zip"
        # PUT links the original and its receipt under these same locks. A reader
        # must not mistake that short publication interval for a missing upload.
        with self.lock, self.workspace.mutex:
            incoming=self.root/"incoming"
            require(incoming.is_dir() and not incoming.is_symlink(),"Original incoming directory differs")
            body=incoming/name;receipt=incoming/(name+".json")
            require(not body.is_symlink() and not receipt.is_symlink(),"Upload members cannot be symbolic links")
            if not body.exists() and not receipt.exists():
                raise FileNotFoundError(name)
            require(not body.exists() or body.is_file(),"Original upload body is not a regular file")
            require(not receipt.exists() or receipt.is_file(),"Original upload receipt is not a regular file")
            value=None
            if receipt.exists():
                value=upload_receipt(read_json(regular_under(incoming,name+".json")),
                                     self.workspace.meta["workspace_id"],upload_id,name)
            if not body.exists() or value is None:
                raise UploadIncomplete("Reselect the same complete original ZIP to restore this retained upload")
            return upload_receipt(value,self.workspace.meta["workspace_id"],upload_id,name,
                                  measured(regular_under(incoming,name)))


    def process_identity(self,pid):
        try:
            text=Path("/proc/"+str(pid)+"/stat").read_text()
            fields=text.rsplit(")",1)[1].split()
            if fields[0]=="Z":return None
            start=fields[19]
            boot=Path("/proc/sys/kernel/random/boot_id").read_text().strip()
            argv=Path("/proc/"+str(pid)+"/cmdline").read_bytes().split(b"\0")
            return {"boot_id":boot,"start":start,"argv":[x.decode("utf-8") for x in argv if x]}
        except FileNotFoundError:return None

    def exact_processes(self,argv):
        require(Path("/proc").is_dir(),"Exact original process receiving requires this host's process namespace")
        matches=[]
        for entry in Path("/proc").iterdir():
            if not entry.name.isdecimal():continue
            try:
                # Only inspect process identities; never signal or change another process.
                actual=(entry/"cmdline").read_bytes().split(b"\0")
                if [x.decode("utf-8") for x in actual if x]!=argv:continue
                identity=self.process_identity(int(entry.name))
                if identity and identity["argv"]==argv:matches.append((int(entry.name),identity))
            except (FileNotFoundError,ProcessLookupError,PermissionError,UnicodeDecodeError):continue
        return matches

    def retained_inspector(self,key,run,project):
        for opened in sorted(self.http_root.glob("inspector-"+key+"-*.opening.json")):
            original=read_json(opened)
            stem=opened.name[:-len(".opening.json")]
            lease_path=self.http_root/(stem+".lease.json")
            if lease_path.exists() or (self.http_root/(stem+".failed.json")).exists() or (self.http_root/(stem+".retired.json")).exists():continue
            require(original.get("hostname")==socket.gethostname() and
                    original["workspace_id"]==self.workspace.meta["workspace_id"] and
                    original["source_files"]==self.workspace.meta["source_files"] and
                    original["project_identity"]==run["project_identity"],
                    "Original interrupted inspector belongs to another host or source")
            receipt_path=self.http_root/(stem+".json")
            if not receipt_path.exists():
                matches=self.exact_processes(original["argv"])
                require(len(matches)<=1,"Multiple original processes share this exact unique inspector receipt; preserve them for reconciliation")
                if not matches:
                    # The old HTTP owner is excluded by Workspace's live process lock.
                    # Recheck the exact unique argv before retiring its observed no-live attempt.
                    require(not self.exact_processes(original["argv"]),"Original inspector started during reconciliation; retry its same opening")
                    new_json(self.http_root/(stem+".retired.json"),
                             {"status":"NO_LIVE_ORIGINAL_PROCESS","hostname":socket.gethostname(),
                              "opening":measured(opened),"argv":original["argv"],"observed_at":time.time()})
                    continue
                pid,identity=matches[0];end=time.monotonic()+120
                while not receipt_path.exists() and self.process_identity(pid)==identity and time.monotonic()<end:
                    time.sleep(0.05)
                if not receipt_path.exists() and self.process_identity(pid)!=identity:
                    require(not self.exact_processes(original["argv"]),"Original process identity changed during inspector reconciliation")
                    new_json(self.http_root/(stem+".retired.json"),
                             {"status":"ORIGINAL_PROCESS_EXITED_BEFORE_RECEIPT","hostname":socket.gethostname(),
                              "opening":measured(opened),"pid":pid,"process_identity":identity,"observed_at":time.time()})
                    continue
                require(receipt_path.exists(),"Original identified inspector is still returning its exact receipt; retry this same opening without starting another process")
            value=read_json(receipt_path);current=self.process_identity(value["pid"])
            if current is None:continue
            require(current["argv"]==original["argv"] and original["workspace_id"]==self.workspace.meta["workspace_id"] and
                    original["project_identity"]==run["project_identity"] and
                    original["source_files"]==self.workspace.meta["source_files"],
                    "Interrupted original inspector process/source identity differs")
            new_json(lease_path,{"workspace_id":original["workspace_id"],"source_files":original["source_files"],
                     "pid":value["pid"],"process_identity":current,"project_identity":original["project_identity"],
                     "receipt_name":receipt_path.name,"receipt_identity":measured(receipt_path)})
        for path in sorted(self.http_root.glob("inspector-"+key+"-*.lease.json")):
            lease=read_json(path)
            require(lease["workspace_id"]==self.workspace.meta["workspace_id"] and
                    lease["source_files"]==self.workspace.meta["source_files"] and
                    lease["project_identity"]==run["project_identity"],
                    "Original inspector lease source differs")
            current=self.process_identity(lease["pid"])
            if current is None or current!=lease["process_identity"]:continue
            receipt_path=regular_under(self.http_root,lease["receipt_name"])
            require(measured(receipt_path)==lease["receipt_identity"],"Original child receipt changed")
            value=read_json(receipt_path)
            require(value["pid"]==lease["pid"] and Path(value["project"])==project and
                    value["project_identity"]==run["project_identity"],
                    "Original child receipt identity differs")
            try:
                with urllib.request.urlopen(value["origin"]+"api/forms/summary",timeout=20) as response:
                    observed=json.loads(response.read())
                require(observed["project_identity"]==run["project_identity"],
                        "Live original inspector returned another project")
            except Exception as exc:
                raise DiscoveryError("The original inspector process is still owned but its exact HTTP receipt is unavailable; reconcile that retained child before opening another.") from exc
            self.children[key]={"process":None,"stream":None,"receipt":value,
                                "receipt_path":receipt_path,"lease":lease}
            return value
        return None

    def inspector(self,params):
        run=self.workspace.dispatch("run.show",{"run_id":params.get("run_id")})["value"]
        edition=params.get("edition","project")
        require(edition in ("project","received"),"Select original project or independent received edition")
        key=run["id"]+"-"+edition
        with self.lock:
            old=self.children.get(key)
            if old and old["process"] is not None and old["process"].poll() is None:
                return old["receipt"]
            project=regular_under(self.root,run["archive"]["path"]).parent/edition
            require(project==self.root/relative(run[edition]),"Original run path binding differs")
            archive=regular_under(self.root,run["archive"]["path"])
            retained=self.retained_inspector(key,run,project)
            if retained:return retained
            receipt=self.http_root/("inspector-"+key+"-"+uuid.uuid4().hex+".json")
            log=self.http_root/(receipt.stem+".log")
            stream=log.open("xb")
            project_source=selected_program(self.workspace.sources,read_json(project/"result.json")["source_files"])
            argv=[sys.executable,str(HERE/"forms_server.py"),"--project",str(project),
                  "--archive",str(archive),"--receipt",str(receipt),"--port","0",
                  "--selected-software",str(project_source)]
            new_json(receipt.with_suffix(".opening.json"),{"workspace_id":self.workspace.meta["workspace_id"],"hostname":socket.gethostname(),
                     "source_files":self.workspace.meta["source_files"],"project_identity":run["project_identity"],
                     "argv":argv,"receipt_name":receipt.name})
            try:
                process=subprocess.Popen(argv,
                    cwd=str(HERE),stdout=stream,stderr=subprocess.STDOUT,
                    env=dict(os.environ,PYTHONDONTWRITEBYTECODE="1"),start_new_session=False)
                end=time.monotonic()+120
                while not receipt.exists() and process.poll() is None and time.monotonic()<end:
                    time.sleep(0.05)
                require(receipt.exists() and process.poll() is None,
                        "Original inspector did not return its private receipt; its complete log is retained")
                value=read_json(receipt)
                require(value.get("project_identity")==run["project_identity"] and
                        value.get("source_run_identity")==run["source_run_identity"] and
                        Path(value["project"])==project and value["pid"]==process.pid,
                        "Original inspector receipt belongs to another selected run")
                require(re.fullmatch(r"http://127\.0\.0\.1:[0-9]+/[A-Za-z0-9_-]+/",value["origin"]),
                        "Original inspector must remain on the private loopback")
                lease={"workspace_id":self.workspace.meta["workspace_id"],"source_files":self.workspace.meta["source_files"],
                       "pid":process.pid,"process_identity":self.process_identity(process.pid),
                       "project_identity":run["project_identity"],"receipt_name":receipt.name,
                       "receipt_identity":measured(receipt)}
                require(lease["process_identity"] is not None,"Original inspector process identity is unavailable")
                new_json(receipt.with_suffix(".lease.json"),lease)
                self.children[key]={"process":process,"stream":stream,"receipt":value,"receipt_path":receipt,"lease":lease}
                return value
            except BaseException:
                if "process" in locals() and process.poll() is None:
                    process.terminate()
                    try:process.wait(timeout=10)
                    except subprocess.TimeoutExpired:process.kill();process.wait()
                stream.close()
                new_json(receipt.with_suffix(".failed.json"),{"status":"LAUNCH_FAILED","receipt_name":receipt.name})
                raise

    def export(self,export_id):
        identifier(export_id,"workspace export identity")
        with self.lock:

            # Workspace.export requires the destination outside the selected workspace.
            # An owned sibling staging directory contains the complete original export;
            # no user-provided host path is accepted.
            sibling=self.http_root/"exports"
            sibling.mkdir(exist_ok=True,mode=0o700)
            exported=sibling/(self.workspace.meta["workspace_id"]+"-"+export_id+".zip")
            saved=sibling/(self.workspace.meta["workspace_id"]+"-"+export_id+".json")
            if saved.exists():
                value=read_json(saved)
                require(value["workspace_id"]==self.workspace.meta["workspace_id"] and
                        measured(exported)=={k:value["archive"][k] for k in ("bytes","sha256")},
                        "Original workspace export receipt differs")
            else:
                require(not exported.exists(),"Prior full export exists without receipt; preserve it and choose a new export identity")
                value=self.workspace.export(exported)
                new_json(saved,value)
            return value

    def close(self):
        with self.lock:
            for child in self.children.values():
                p=child["process"]
                if p is not None:
                    if p.poll() is None:
                        p.terminate()
                        try:p.wait(timeout=10)
                        except subprocess.TimeoutExpired:p.kill();p.wait()
                else:
                    lease=child["lease"]
                    if self.process_identity(lease["pid"])==lease["process_identity"]:
                        os.kill(lease["pid"],signal.SIGTERM)
                if child["stream"] is not None:child["stream"].close()
            self.children.clear()

class Handler(BaseHTTPRequestHandler):
    server_version="FormsWorkspace/1"
    protocol_version="HTTP/1.1"
    def log_message(self,*args):pass
    @property
    def state(self):return self.server.state
    def send_headers(self,status,length,mime="application/json; charset=utf-8",download=None):
        self.close_connection=True
        self.send_response(status)
        self.send_header("Connection","close")
        self.send_header("Content-Type",mime)
        self.send_header("Content-Length",str(length))
        self.send_header("Cache-Control","no-store")
        self.send_header("X-Content-Type-Options","nosniff")
        self.send_header("Referrer-Policy","no-referrer")
        self.send_header("Cross-Origin-Resource-Policy","same-origin")
        if download:self.send_header("Content-Disposition",'attachment; filename="'+re.sub(r"[^A-Za-z0-9_.-]","_",download)+'"')
        self.end_headers()
    def answer(self,value,status=200):
        raw=json_bytes(value);self.send_headers(status,len(raw));self.wfile.write(raw)
    def error(self,code,message,status=400,**extra):
        self.answer({"error":{"code":code,"message":message},**extra},status)
    def route(self,write=False):
        require(self.headers_in("Host")==urlsplit(self.state.origin).netloc,"Unrecognized loopback Host")
        if self.headers_in("Origin"):
            require(self.headers_in("Origin")==self.state.origin,"Only the original same-origin browser is allowed")
        require(self.headers_in("Sec-Fetch-Site") in ("","same-origin","none"),"Cross-site requests are not allowed")
        parts=urlsplit(self.path)
        require(parts.path.startswith(self.state.prefix),"Unknown private route")
        if write:
            require(self.headers_in("Transfer-Encoding")=="","Chunked requests are not accepted; retain a complete known-size original")
        return parts.path[len(self.state.prefix):],parse_qs(parts.query,keep_blank_values=True,strict_parsing=True)
    def headers_in(self,key):return self.headers.get(key,"")
    def one(self,q,name):
        require(set(q)=={name} and len(q[name])==1,"Select one exact "+name)
        return q[name][0]
    def length(self,maximum):
        text=self.headers_in("Content-Length")
        require(re.fullmatch(r"[0-9]+",text) is not None,"A complete Content-Length is required")
        size=int(text);require(size<=maximum,"Selected request exceeds its explicit byte limit")
        return size
    def body(self):
        length=self.length(MAX_RPC)
        raw=self.rfile.read(length)
        require(len(raw)==length,"The complete original request body was not received")
        return parse_json_bytes(raw)
    def file(self,path,name,mime="application/octet-stream"):
        path=Path(path);require(path.is_file() and not path.is_symlink(),"Original complete file is absent")
        with path.open("rb") as stream:
            before=os.fstat(stream.fileno());self.send_headers(200,before.st_size,mime,name)
            for block in iter(lambda:stream.read(1024*1024),b""):self.wfile.write(block)
    def do_GET(self):
        try:
            route,q=self.route()
            if route=="":
                require(not q,"Workspace opening takes no query")
                raw=render_html(self.state.workspace.meta).encode("utf-8")
                self.send_headers(200,len(raw),"text/html; charset=utf-8");self.wfile.write(raw)
            elif route.startswith("api/captures/upload/"):
                require(not q,"Upload receipt takes no query")
                self.answer(self.state.upload_descriptor(route.rsplit("/",1)[1]))
            elif route=="api/capture-file":
                require(set(q)=={"capture_id","asset_id"} and all(len(v)==1 for v in q.values()),"Select one original asset")
                with self.state.workspace.mutex:
                    capture=self.state.workspace._item("captures",q["capture_id"][0])
                    root=self.state.workspace._capture_root(capture)
                    from forms_workspace import stream_rows
                    asset=next((a for a in stream_rows(root/"assets.jsonl") if a["id"]==q["asset_id"][0]),None)
                    require(asset is not None and asset["availability"]=="PRESENT","Original asset body is unavailable")
                    path=regular_under(root,asset["path"])
                    require(measured(path)=={k:asset[k] for k in ("bytes","sha256")},"Original captured asset changed")
                    self.file(path,asset.get("filename",asset["id"]))
            elif route=="api/run-archive":
                rid=self.one(q,"run_id")
                value=self.state.workspace.dispatch("run.show",{"run_id":rid})["value"]
                self.file(regular_under(self.state.root,value["archive"]["path"]),"Forms_Project_"+rid+".zip","application/zip")
            elif route=="api/workspace-export":
                value=self.state.export(self.one(q,"export_id"))
                self.file(Path(value["archive"]["path"]),"Forms_Workspace.zip","application/zip")
            else:self.error("NOT_FOUND","Unknown workspace route",404)
        except UploadIncomplete as exc:self.error("UPLOAD_INCOMPLETE",str(exc),409)
        except (DiscoveryError,ValueError,KeyError,TypeError) as exc:self.error("INVALID_REQUEST",str(exc))
        except FileNotFoundError:self.error("NOT_FOUND","Original retained file or receipt is absent",404)
        except (BrokenPipeError,ConnectionResetError):pass
    def do_PUT(self):
        temp=None
        try:
            route,q=self.route(True)
            require(route.startswith("api/captures/upload/") and not q,"Unknown complete capture upload route")
            uid=identifier(route.rsplit("/",1)[1],"capture upload identity")
            length=self.length(MAX_UPLOAD)
            require(length>0,"Complete capture archive cannot be empty")
            name=uid+".zip";directory=self.state.root/"incoming";target=directory/name
            temp=self.state.http_root/"temp"/("."+name+"-"+uuid.uuid4().hex)
            digest=hashlib.sha256();count=0
            with temp.open("xb") as out:
                os.chmod(temp,0o600)
                while count<length:
                    block=self.rfile.read(min(1024*1024,length-count))
                    require(bool(block),"Complete original capture upload was interrupted")
                    out.write(block);digest.update(block);count+=len(block)
                out.flush();os.fsync(out.fileno())
            identity={"bytes":count,"sha256":digest.hexdigest()}
            with self.state.lock, self.state.workspace.mutex:
                require(directory.is_dir() and not directory.is_symlink(),"Original incoming directory differs")
                receipt=directory/(name+".json")
                require(not target.is_symlink() and not receipt.is_symlink(),"Upload members cannot be symbolic links")
                # Validate an existing receipt BEFORE linking a missing body.
                # A receipt-only interrupted upload cannot acquire other bytes.
                retained=None
                if receipt.exists():
                    retained=upload_receipt(read_json(regular_under(directory,name+".json")),
                                            self.state.workspace.meta["workspace_id"],uid,name,identity)
                if target.exists():require(measured(target)==identity,"Upload identity is bound to different original bytes")
                else:os.link(temp,target)
                result=retained or {"schema":"tjlabs.forms-workspace.upload.v1","workspace_id":self.state.workspace.meta["workspace_id"],
                                   "upload_id":uid,"archive_name":name,"file":identity}
                if retained is None:new_json(receipt,result)
            self.answer(result)
        except (DiscoveryError,ValueError,KeyError,TypeError) as exc:self.error("UPLOAD_REJECTED",str(exc))
        except (BrokenPipeError,ConnectionResetError):pass
        finally:
            if temp and temp.exists():temp.unlink()
    def do_POST(self):
        request=None
        try:
            route,q=self.route(True);require(not q,"Workspace operation takes no query")
            require(self.headers_in("Content-Type").split(";",1)[0]=="application/json","Send complete JSON parameters")
            request=self.body()
            require(isinstance(request,dict),"Complete operation object required")
            if route=="api/rpc":
                require(set(request)<= {"method","params","request_id"},"Unknown request fields")
                self.answer(self.state.workspace.dispatch(request.get("method"),request.get("params"),request.get("request_id")))
            elif route=="api/inspector":
                require(set(request)<={"run_id","edition"},"Unknown inspector parameters")
                self.answer(self.state.inspector(request))
            else:self.error("NOT_FOUND","Unknown workspace route",404)
        except (DiscoveryError,ValueError,KeyError,TypeError) as exc:
            retained=None
            if isinstance(request,dict) and request.get("request_id"):
                try:retained=self.state.workspace.dispatch("request.show",{"request_id":request["request_id"]})["value"]
                except (DiscoveryError,ValueError,KeyError,TypeError):pass
            self.error("OPERATION_REJECTED",str(exc),409,request=retained,no_effect=retained is None)
        except (BrokenPipeError,ConnectionResetError):pass
        except Exception as exc:
            retained=None
            if isinstance(request,dict) and request.get("request_id"):
                try:retained=self.state.workspace.dispatch("request.status",{"request_id":request["request_id"]})["value"]
                except Exception:pass
            self.error("OPERATION_UNCERTAIN","Original operation encountered "+type(exc).__name__+
                       "; retain and recover its exact request.",500,request=retained,no_effect=False)

def main(argv=None):
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace",required=True);parser.add_argument("--receipt",required=True)
    parser.add_argument("--port",type=int,default=0)
    args=parser.parse_args(argv);server=None;state=None
    try:
        require(0<=args.port<=65535,"Port must be0 through65535")
        receipt=Path(args.receipt).resolve()
        require(not receipt.exists(),"Choose a new private server receipt")
        with Workspace(args.workspace) as workspace:
            require(not receipt.is_relative_to(workspace.root),"Server receipt must be outside the full selected workspace")
            state=Service(workspace)
            oldport=state.identity.get("port")
            require(not oldport or args.port in (0,oldport),"Restart on the original retained loopback port")
            server=ThreadingHTTPServer(("127.0.0.1",oldport or args.port),Handler)
            server.daemon_threads=False;server.block_on_close=True;server.state=state
            value=state.bind(server);new_json(receipt,value)
            print(json.dumps({"status":"LISTENING",**value}),flush=True)
            def stop(*_):threading.Thread(target=server.shutdown,daemon=True).start()
            signal.signal(signal.SIGTERM,stop);signal.signal(signal.SIGINT,stop)
            try:
                server.serve_forever()
            finally:
                # Drain every original RPC/upload before releasing the native DB/flock.
                server.server_close()
                state.close()
                server=None;state=None
        return 0
    except (DiscoveryError,ValueError,OSError,KeyError,TypeError) as exc:
        print(json.dumps({"status":"ERROR","type":type(exc).__name__,"message":str(exc)}),flush=True)
        return 2
    finally:
        if state:state.close()
        if server:server.server_close()

if __name__=="__main__":raise SystemExit(main())
