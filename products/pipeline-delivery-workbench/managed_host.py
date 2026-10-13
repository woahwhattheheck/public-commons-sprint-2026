"""Manage the original Staff writer and HTTP server for an installed Merchant application."""
from __future__ import annotations
import argparse, hashlib, json, os, signal, sys, threading, time
from pathlib import Path
from urllib.parse import urlsplit

SCHEMA="stellar-forge.pipeline-delivery-workbench-connection.v1"
INFO="stellar-forge.pipeline-delivery-managed-info.v1"

def require(value,message):
    if not value: raise ValueError(message)

def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()

def canonical_directory(path):
    value=Path(path)
    require(value.is_absolute() and str(value.resolve(strict=True))==str(value) and value.is_dir(),"Select the original canonical directory.")
    st=value.stat()
    require(st.st_uid==os.getuid() and not st.st_mode&0o077,"Select the owned private workspace directory.")
    return {"dev":str(st.st_dev),"ino":str(st.st_ino)}

def run(request_path):
    request_path=Path(request_path)
    request=json.loads(request_path.read_bytes());v=request["configuration"]
    require(digest(request["configurationFile"])==request["configurationSha256"],"The reviewed configuration changed.")
    require(digest(v["runtimeReadyFile"])==request["runtimeSelectionSha256"],"The selected runtime receipt changed.")
    ready=json.loads(Path(v["runtimeReadyFile"]).read_bytes())
    require(ready["schema"]=="stellar-forge.pipeline-delivery-runtime.v1" and ready["state"]=="READY" and
        ready["applicationDirectory"]==v["applicationDirectory"] and ready["programmeDirectory"]==v["programmeDirectory"] and
        ready["python"]==v["python"] and ready["runtimeId"]==request["runtimeId"],"Use the original complete prepared runtime.")
    require(str(Path(sys.executable).absolute())==v["python"],"Preserve the selected original virtual-environment invocation path.")
    authority_path=Path(request["sourceAuthority"])
    require(digest(authority_path)==request["sourceManifestSha256"],"The original source authority changed.")
    authority=json.loads(authority_path.read_bytes())
    roots={"workbench":Path(v["applicationDirectory"]),"original-programme":Path(v["programmeDirectory"])}
    selected={key:set() for key in roots}
    for row in authority["files"]:
        prefix,relative=row["path"].split("/",1);root=roots[prefix];file=root/relative
        require(relative and not file.is_symlink() and file.is_file() and str(file.resolve(strict=True))==str(file) and
            file.stat().st_size==row["bytes"] and digest(file)==row["sha256"],"Original source changed: "+row["path"])
        selected[prefix].add(relative)
    for key,root in roots.items():
        actual=set()
        for file in root.rglob("*"):
            require(not file.is_symlink(),"The original source contains a linked member.")
            if "__pycache__" in file.relative_to(root).parts: continue
            if file.is_file(): actual.add(file.relative_to(root).as_posix())
            else: require(file.is_dir(),"An original source member is not a regular file.")
        require(actual==selected[key],"Use every exact original source member.")
    sys.path.insert(0,v["applicationDirectory"])
    from common import FileLease,durable_write,packed,SCHEMA as WORKSPACE_SCHEMA
    from server import Staff,Server,Handler,MAX_JSON,MAX_ARCHIVE
    stopped=threading.Event()
    signal.signal(signal.SIGTERM,lambda *_:stopped.set())
    signal.signal(signal.SIGINT,lambda *_:stopped.set())
    lease=None;app=None;http=None;thread=None;connection=None;connection_sha=None
    flags={"shutdown":False,"listener":False,"writer":False,"connection":False}
    def stop_owners():
        if http is not None and not flags["shutdown"]:
            if thread is not None and thread.is_alive(): http.shutdown()
            if thread is not None: thread.join()
            flags["shutdown"]=True
        if http is not None and not flags["listener"]:
            http.server_close();flags["listener"]=True
        if app is not None and not flags["writer"]:
            if hasattr(app,"lock"): app.close()
            elif getattr(app,"lease",None): app.lease.close()
            flags["writer"]=True
        if connection is not None and not flags["connection"]:
            target=Path(v["connectionFile"])
            if target.exists() and digest(target)==connection_sha:
                target.unlink()
                fd=os.open(target.parent,os.O_RDONLY)
                try: os.fsync(fd)
                finally: os.close(fd)
            flags["connection"]=True
        if lease is not None: lease.close()
    try:
        lease=FileLease(v["connectionFile"]+".lock")
        app=Staff.__new__(Staff)
        app.ws=None  # Retain a closeable partial Staff owner if its constructor fails before Workspace admission.
        Staff.__init__(app,v["directory"],control=v["controlDirectory"],source_root=v["applicationDirectory"])
        class ManagedHandler(Handler):
            def _headers(self,status,kind,size,*,extra=None):
                self.close_connection=True
                return super()._headers(status,kind,size,extra={"Connection":"close",**(extra or {})})
            def _dispatch(self):
                if self.command=="GET" and urlsplit(self.path).path=="/api/merchant/info":
                    self._host();self._authenticated()
                    with self.server.app.lock:
                        meta=self.server.app.ws.meta()
                        identity={key:value for key,value in connection.items() if key not in
                            {"schema","capabilityFile","directoryIdentity","controlIdentity","runtimeReadyFile","startedAt"}}
                        return self._json(200,{"schema":INFO,**identity,"workspaceSchema":WORKSPACE_SCHEMA,
                            "selection":dict(self.server.app.selection),"workspace":meta,
                            "limits":{"json":MAX_JSON,"archive":MAX_ARCHIVE}})
                return super()._dispatch()
        class ManagedServer(Server):
            daemon_threads=False
            block_on_close=True
            def finish_request(self,request,client_address):
                ManagedHandler(request,client_address,self)
            def get_request(self):
                sock,address=super().get_request();sock.settimeout(15);return sock,address
        http=ManagedServer(("127.0.0.1",request["port"]),app)
        connection={"schema":SCHEMA,"launchId":request["launchId"],"instanceId":request["launchId"],
            "directory":v["directory"],"controlDirectory":v["controlDirectory"],
            "applicationDirectory":v["applicationDirectory"],"programmeDirectory":v["programmeDirectory"],
            "directoryIdentity":canonical_directory(v["directory"]),"controlIdentity":canonical_directory(v["controlDirectory"]),
            "runtimeReadyFile":v["runtimeReadyFile"],"runtimeId":ready["runtimeId"],
            "runtimeSelectionSha256":request["runtimeSelectionSha256"],"python":v["python"],"dbt":ready["dbt"],
            "sourceManifestSha256":request["sourceManifestSha256"],"capabilityFile":str(app.capability_path),
            "origin":http.origin,"pid":os.getpid(),"startedAt":request["startedAt"]}
        thread=threading.Thread(target=http.serve_forever,kwargs={"poll_interval":0.2},name="original-pipeline-staff",daemon=False)
        thread.start()
        durable_write(v["connectionFile"],packed(connection),replace=True);connection_sha=digest(v["connectionFile"])
        while not stopped.wait(0.2):
            require(thread.is_alive(),"The original listener stopped unexpectedly.")
    finally:
        while True:
            try: stop_owners();break
            except BaseException as error:
                print(json.dumps({"status":"CLOSING","message":"Original Staff ownership is retained; repeat Stop to continue cleanup.",
                    "type":type(error).__name__}),file=sys.stderr,flush=True)
                stopped.clear();stopped.wait()

def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument("--request",required=True)
    args=parser.parse_args();run(args.request)
if __name__=="__main__":
    try: main()
    except Exception as error:
        print(json.dumps({"error":{"code":"PIPELINE_MANAGED_CHILD","message":str(error)}}),file=sys.stderr,flush=True)
        raise SystemExit(1)
