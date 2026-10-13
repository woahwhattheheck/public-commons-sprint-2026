#!/usr/bin/env python3
"""Continue the original HCPS receiving case through complete prime-review returns."""
from __future__ import annotations
import argparse, contextlib, fcntl, hashlib, json, os, pathlib, signal, subprocess, sys, tarfile, time, uuid
from ASSEMBLE import retain, identity, parent_sync

def read(path): return json.loads(path.read_text(encoding="utf-8"))
def write(path,value): retain(path,(json.dumps(value,ensure_ascii=False,indent=2)+"\n").encode())
def verify_stage(path):
    result=read(path)
    for item in result.get("artifacts",[]):
        file=pathlib.Path(item["path"])
        if file.is_symlink() or not file.is_file() or identity(file.read_bytes())!={"bytes":item["bytes"],"sha256":item["sha256"]}:
            raise ValueError("A retained complete stage output differs: "+str(file))
    return result
def verify_result(root):
    result=read(root/"COMPLETE.json")
    if result.get("status")!="complete": raise ValueError("Continue the same original complete course.")
    for name in result["stages"]: verify_stage(root/"stages"/(name+".json"))
    return result
def alive(group):
    try: os.killpg(group,0);return True
    except ProcessLookupError:return False
def drain(process):
    process.poll()
    if alive(process.pid):
        with contextlib.suppress(ProcessLookupError):os.killpg(process.pid,signal.SIGTERM)
        end=time.monotonic()+15
        while alive(process.pid) and time.monotonic()<end:process.poll();time.sleep(.2)
        if alive(process.pid):
            with contextlib.suppress(ProcessLookupError):os.killpg(process.pid,signal.SIGKILL)
    with contextlib.suppress(subprocess.TimeoutExpired):process.wait(timeout=15)
    end=time.monotonic()+15
    while alive(process.pid) and time.monotonic()<end:process.poll();time.sleep(.2)
    if alive(process.pid):raise RuntimeError("Keep the original controller alive until its browser process group is completely drained.")
def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--case",type=pathlib.Path,required=True)
    parser.add_argument("--node",default=os.environ.get("HCPS_NODE","node"))
    parser.add_argument("--timeout",type=int,default=1200)
    args=parser.parse_args();case=args.case.resolve();source=pathlib.Path(__file__).resolve().parent
    if source==case or source.is_relative_to(case):raise ValueError("Keep complete application source outside the original case.")
    if not (case/"operation.json").is_file():raise ValueError("Use the original HCPS receiving case and its existing operation identity.")
    descriptor=os.open(case/"operation.lock",os.O_RDWR|getattr(os,"O_NOFOLLOW",0))
    with os.fdopen(descriptor,"r+b") as lock:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        original=read(case/"operation.json")
        if original["case"]!=str(case):raise ValueError("The original case path differs.")
        preceding=verify_result(case)
        root=case/"prime-review";root.mkdir(exist_ok=True)
        archive=root/"HCPS_Complete_Original_And_Prime_Review.tar.gz"
        receipt=root/"archive.json"
        if archive.exists():
            following=verify_result(root)
            with tarfile.open(archive,"r:gz") as package:
                inventory=json.load(package.extractfile("complete-prime-review-inventory.json"))
                for item in inventory["files"]:
                    if identity(package.extractfile(item["path"]).read())!={"bytes":item["bytes"],"sha256":item["sha256"]}:raise ValueError("The complete original archive differs.")
            outcome={"format":"commons.hcps.prime-review-case-delivery.v1","operationId":original["operationId"],"workspaceId":following["workspaceId"],"archive":{"path":str(archive),**identity(archive.read_bytes())},"members":len(inventory["files"])+1}
            write(receipt,outcome);print(json.dumps({"state":"COMPLETE","adopted":True,**outcome}),flush=True);return
        if not (root/"COMPLETE.json").exists():
            with (root/"native.log").open("ab") as stdout,(root/"native.stderr").open("ab") as stderr:
                env=dict(os.environ,HCPS_LEASE_FD=str(lock.fileno()),HCPS_NODE=args.node,HCPS_PYTHON=sys.executable,HCPS_CASE_ROOT=str(case))
                process=subprocess.Popen([args.node,str(source/"PRIME_RETURN_RECEIVING.cjs"),"--case",str(case)],cwd=str(source),env=env,stdout=stdout,stderr=stderr,start_new_session=True,pass_fds=(lock.fileno(),))
                print(json.dumps({"state":"ACTUAL_PRIME_REVIEW_ADMISSION","operationId":original["operationId"],"pid":process.pid,"case":str(case)}),flush=True)
                try:
                    code=process.wait(timeout=args.timeout)
                    if code:raise RuntimeError("The complete following course exited "+str(code)+"; retain the original logs and complete stage results.")
                except BaseException:
                    drain(process);raise
                finally:
                    stdout.flush();os.fsync(stdout.fileno());stderr.flush();os.fsync(stderr.fileno())
                if alive(process.pid):drain(process)
        following=verify_result(root)
        if following["operationId"]!=original["operationId"] or following["workspaceId"]!=preceding["workspaceId"]:raise ValueError("The following customer operation changed its original identity.")
        names=["hcps-core.cjs","hcps-return.cjs","hcps-app.js","hcps-return-ui.js","hcps.css","index.template.html","production-seed.json","BUILD.cjs","VERIFY.cjs","ASSEMBLE.py","RECEIVING.cjs","RECEIVING.py","PRIME_RETURN_RECEIVING.cjs","PRIME_RETURN_RECEIVING.py","OPERATING.md","application/HCPS_Response_Desk.html","application/application.json"]
        for name in names:retain(root/"complete-application-source"/name,(source/name).read_bytes())
        # Every earlier original file and actual following output is included.
        # Already-complete tar archives are verified above where applicable; their expanded originals are retained once here.
        excluded={str(archive),str(receipt),str(root/"complete-prime-review-inventory.json")}
        files=sorted(p for p in case.rglob("*") if p.is_file() and not p.is_symlink() and str(p) not in excluded and p.name!="operation.lock" and not p.name.endswith((".receiving",".tar.gz")))
        inventory={"format":"commons.hcps.complete-prime-review-case.v1","operationId":original["operationId"],"files":[{"path":str(p.relative_to(case)),**identity(p.read_bytes())} for p in files]}
        inventory_file=root/"complete-prime-review-inventory.json";write(inventory_file,inventory)
        candidate=root/("."+archive.name+"."+str(uuid.uuid4())+".receiving")
        try:
            with tarfile.open(candidate,"w:gz") as package:
                for p in files:package.add(p,arcname=str(p.relative_to(case)),recursive=False)
                package.add(inventory_file,arcname="complete-prime-review-inventory.json",recursive=False)
            with candidate.open("rb") as stream:os.fsync(stream.fileno())
            with tarfile.open(candidate,"r:gz") as package:
                for item in inventory["files"]:
                    if identity(package.extractfile(item["path"]).read())!={"bytes":item["bytes"],"sha256":item["sha256"]}:raise ValueError("Complete case archive member differs.")
            os.link(candidate,archive,follow_symlinks=False);parent_sync(root)
        finally:
            with contextlib.suppress(FileNotFoundError):candidate.unlink()
        outcome={"format":"commons.hcps.prime-review-case-delivery.v1","operationId":original["operationId"],"workspaceId":following["workspaceId"],"archive":{"path":str(archive),**identity(archive.read_bytes())},"members":len(files)+1}
        write(receipt,outcome);print(json.dumps({"state":"COMPLETE",**outcome}),flush=True)
if __name__=="__main__":
    try:main()
    except Exception as error:
        print(json.dumps({"state":"RETAINED_FOR_CONTINUATION","error":type(error).__name__+": "+str(error)}),file=sys.stderr,flush=True);sys.exit(1)
