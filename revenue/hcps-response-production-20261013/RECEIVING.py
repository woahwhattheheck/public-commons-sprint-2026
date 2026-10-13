#!/usr/bin/env python3
"""Run and preserve the complete original HCPS receiving/rendered course."""
from __future__ import annotations
import argparse, contextlib, fcntl, hashlib, json, os, pathlib, signal, subprocess, sys, tarfile, time, uuid
from ASSEMBLE import retain, identity, parent_sync
def read(path): return json.loads(path.read_text())
def write(path,value): retain(path,(json.dumps(value,indent=2,ensure_ascii=False)+"\n").encode())
def event(root,name,**extra):
    data={"at":time.strftime("%Y-%m-%dT%H:%M:%SZ",time.gmtime()),"event":name,**extra}
    with (root/"controller-events.jsonl").open("ab") as stream:
        stream.write((json.dumps(data)+"\n").encode()); stream.flush(); os.fsync(stream.fileno())
    print(json.dumps(data),flush=True)
def verify_stages(root):
    result=read(root/"COMPLETE.json")
    if result.get("status")!="complete": raise ValueError("Original receiving result is incomplete.")
    for stage in result["stages"]:
        data=read(root/"stages"/(stage+".json"))
        for member in data["artifacts"]:
            path=pathlib.Path(member["path"])
            if path.is_symlink() or not path.is_file() or identity(path.read_bytes())!={"bytes":member["bytes"],"sha256":member["sha256"]}:
                raise ValueError("Actual complete stage output differs: "+str(path))
    return result
def group_alive(group):
    try: os.killpg(group,0); return True
    except ProcessLookupError: return False
def drain(process,root,reason):
    if group_alive(process.pid):
        with contextlib.suppress(ProcessLookupError): os.killpg(process.pid,signal.SIGTERM)
        deadline=time.monotonic()+15
        while group_alive(process.pid) and time.monotonic()<deadline:
            process.poll(); time.sleep(.2)
        if group_alive(process.pid):
            with contextlib.suppress(ProcessLookupError): os.killpg(process.pid,signal.SIGKILL)
    with contextlib.suppress(subprocess.TimeoutExpired): process.wait(timeout=15)
    event(root,"child-drained",pid=process.pid,reason=reason,returncode=process.returncode)
def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument("--case",type=pathlib.Path,required=True)
    parser.add_argument("--node",default=os.environ.get("HCPS_NODE","node"));parser.add_argument("--timeout",type=int,default=1200)
    args=parser.parse_args();root=args.case.resolve();source=pathlib.Path(__file__).resolve().parent
    if root==source or source.is_relative_to(root): raise ValueError("Keep original source outside the receiving case.")
    root.mkdir(parents=True,exist_ok=True)
    lock_path=root/"operation.lock"
    descriptor=os.open(lock_path,os.O_RDWR|os.O_CREAT|getattr(os,"O_NOFOLLOW",0),0o600)
    with os.fdopen(descriptor,"r+b") as lock:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        envelope=root/"operation.json"
        if envelope.exists():
            original=read(envelope)
            if original["case"]!=str(root): raise ValueError("Original receiving directory differs.")
        else:
            original={"format":"commons.hcps.original-receiving-operation.v1","operationId":str(uuid.uuid4()),"case":str(root),"source":str(source)}
            write(envelope,original)
        archive=root/"HCPS_Complete_Original_Receiving.tar.gz"
        if archive.exists():
            verify_stages(root)
            with tarfile.open(archive,"r:gz") as package:
                inventory=json.load(package.extractfile("complete-inventory.json"))
                for member in inventory["files"]:
                    if identity(package.extractfile(member["path"]).read())!={"bytes":member["bytes"],"sha256":member["sha256"]}: raise ValueError("Original complete archive member differs.")
            result=read(root/"COMPLETE.json")
            outcome={"operationId":original["operationId"],"archive":{"path":str(archive),**identity(archive.read_bytes())},"members":len(inventory["files"])+1,"workspaceId":result["workspaceId"]}
            write(root/"archive.json",outcome);print(json.dumps({"state":"COMPLETE","adopted":True,**outcome}),flush=True);return
        event(root,"original-operation-adopted",operationId=original["operationId"])
        if not (root/"COMPLETE.json").exists():
            log=root/"native.log";error=root/"native.stderr"
            with log.open("ab") as stdout,error.open("ab") as stderr:
                env=dict(os.environ,HCPS_PYTHON=sys.executable,HCPS_NODE=args.node,HCPS_LEASE_FD=str(lock.fileno()),HCPS_CASE_ROOT=str(root))
                process=subprocess.Popen([args.node,str(source/"RECEIVING.cjs"),"--case",str(root)],cwd=str(source),env=env,stdout=stdout,stderr=stderr,start_new_session=True,pass_fds=(lock.fileno(),))
                event(root,"actual-native-admission",pid=process.pid,group=process.pid)
                try:
                    code=process.wait(timeout=args.timeout)
                    if code: raise RuntimeError("Original complete course exited "+str(code)+"; retain native.log/native.stderr and prior stages for continuation.")
                except BaseException:
                    drain(process,root,"original operation stopped");raise
                finally:
                    stdout.flush();os.fsync(stdout.fileno());stderr.flush();os.fsync(stderr.fileno())
                if group_alive(process.pid): drain(process,root,"close original descendant group after completed native course")
        result=verify_stages(root)
        source_copy=root/"complete-application-source";source_copy.mkdir(exist_ok=True)
        source_names=["hcps-core.cjs","hcps-return.cjs","hcps-app.js","hcps-return-ui.js","hcps.css","index.template.html","production-seed.json","BUILD.cjs","VERIFY.cjs","ASSEMBLE.py","RECEIVING.cjs","RECEIVING.py","OPERATING.md"]
        for name in source_names: retain(source_copy/name,(source/name).read_bytes())
        # Render every complete assembled page and every page of the retained readable derivative.
        import shutil
        renderer=shutil.which("pdftoppm")
        if not renderer: raise RuntimeError("Install/use an existing Poppler pdftoppm runtime to complete original full-PDF visual receiving.")
        visual=[]
        for name,file in [("source-derivative",root/"original"/"Complete_RFQ_Readable_Derivative.pdf"),("assembled-response",root/"assembly"/"Complete_Response_Original_Pages.pdf")]:
            directory=root/"rendered"/name;directory.mkdir(parents=True,exist_ok=True);prefix=directory/"page"
            completed=directory/"render.json"
            if completed.exists():
                metadata=read(completed)
                for item in metadata["files"]:
                    if identity(pathlib.Path(item["path"]).read_bytes())!={"bytes":item["bytes"],"sha256":item["sha256"]}: raise ValueError("Retained rendered page differs.")
            else:
                subprocess.run([renderer,"-scale-to","1400","-png",str(file),str(prefix)],check=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=180,pass_fds=(lock.fileno(),))
                pages=sorted(directory.glob("page-*.png"))
                from pypdf import PdfReader
                if len(pages)!=len(PdfReader(str(file)).pages): raise ValueError("Every original PDF page must be rendered.")
                metadata={"source":{"path":str(file),**identity(file.read_bytes())},"files":[{"path":str(p),**identity(p.read_bytes())} for p in pages]}
                write(completed,metadata)
            visual.append(metadata)
        receipt={"format":"commons.hcps.receiving-visual-complete.v1","operationId":original["operationId"],"workspaceId":result["workspaceId"],"native":result,"completePdfRenderings":visual}
        write(root/"VISUAL_COMPLETE.json",receipt)
        # Keep original files and complete outputs; exclude only the current lease, temporary candidates, and this final archive itself.
        archive=root/"HCPS_Complete_Original_Receiving.tar.gz";inventory=root/"complete-inventory.json"
        controller_snapshot=root/"archive-controller-events.jsonl"
        if not controller_snapshot.exists(): retain(controller_snapshot,(root/"controller-events.jsonl").read_bytes())
        files=sorted(p for p in root.rglob("*") if p.is_file() and not p.is_symlink() and p.name not in {"operation.lock","controller-events.jsonl",archive.name,inventory.name,"archive.json"} and not p.name.endswith(".receiving"))
        members=[{"path":str(p.relative_to(root)),**identity(p.read_bytes())} for p in files]
        write(inventory,{"format":"commons.hcps.complete-case-inventory.v1","files":members})
        if not archive.exists():
            candidate=root/("."+archive.name+"."+str(uuid.uuid4())+".receiving")
            try:
                with tarfile.open(candidate,"w:gz") as package:
                    for p in files+[inventory]: package.add(p,arcname=str(p.relative_to(root)),recursive=False)
                with candidate.open("rb") as stream: os.fsync(stream.fileno())
                with tarfile.open(candidate,"r:gz") as package:
                    for member in members:
                        raw=package.extractfile(member["path"]).read()
                        if identity(raw)!={"bytes":member["bytes"],"sha256":member["sha256"]}: raise ValueError("Complete archive member differs.")
                os.link(candidate,archive,follow_symlinks=False);parent_sync(root)
            finally:
                with contextlib.suppress(FileNotFoundError): candidate.unlink()
        else:
            with tarfile.open(archive,"r:gz") as package:
                for member in members:
                    raw=package.extractfile(member["path"]).read()
                    if identity(raw)!={"bytes":member["bytes"],"sha256":member["sha256"]}: raise ValueError("Existing full archive differs.")
        outcome={"operationId":original["operationId"],"archive":{"path":str(archive),**identity(archive.read_bytes())},"members":len(members)+1,"workspaceId":result["workspaceId"]}
        write(root/"archive.json",outcome);print(json.dumps({"state":"COMPLETE",**outcome}),flush=True)
if __name__=="__main__":
    try: main()
    except Exception as error:
        print(json.dumps({"state":"RETAINED_FOR_CONTINUATION","error":type(error).__name__+": "+str(error)}),file=sys.stderr,flush=True);sys.exit(1)
