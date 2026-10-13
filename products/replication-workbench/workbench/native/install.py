"""Receive the exact published original Sling engine without rebuilding it."""
import argparse, fcntl, hashlib, json, os, pathlib, platform, subprocess, sys, tarfile, urllib.request, uuid
from datetime import datetime,timezone
EXPECTED={"version":"1.6.5","sourceCommit":"7641892e24a7023c8012069596698970c7b3e041","url":"https://github.com/slingdata-io/sling-cli/releases/download/v1.6.5/sling_linux_amd64.tar.gz","bytes":121317497,"sha256":"e4e386c7d4429b33a213c146594be0bf6efa38f4732035dd67e307616fcb9c66"}
def now(): return datetime.now(timezone.utc).isoformat().replace("+00:00","Z")
def digest(path):
    h=hashlib.sha256();n=0
    with open(path,"rb") as f:
        for block in iter(lambda:f.read(1024*1024),b""): h.update(block);n+=len(block)
    return {"bytes":n,"sha256":h.hexdigest()}
def write(path,value):
    path=pathlib.Path(path);path.parent.mkdir(parents=True,exist_ok=True,mode=0o700);b=(json.dumps(value,sort_keys=True,indent=2)+"\n").encode()
    if path.exists():
        if path.read_bytes()!=b: raise ValueError("Existing retained installer identity differs")
        return
    temp=path.with_name(path.name+".pending-"+uuid.uuid4().hex)
    with temp.open("xb") as f: f.write(b);f.flush();os.fsync(f.fileno())
    os.replace(temp,path)
    d=os.open(path.parent,os.O_RDONLY)
    try: os.fsync(d)
    finally: os.close(d)
def same_archive(path):
    v=digest(path)
    if v!={"bytes":EXPECTED["bytes"],"sha256":EXPECTED["sha256"]}: raise ValueError("Original Sling archive does not match the selected release")
    return v
def verify_ready(path):
    ready=json.loads(path.read_text())
    if ready.get("schema")!="tjlabs.sling-runtime-ready.v1" or ready.get("state")!="ready": raise ValueError("Unexpected runtime-ready receipt")
    if ready["sourceCommit"]!=EXPECTED["sourceCommit"] or ready["version"]!=EXPECTED["version"]: raise ValueError("A different original Sling source is installed")
    same_archive(ready["archive"]["path"])
    if digest(ready["executable"]["path"])!={k:ready["executable"][k] for k in ("bytes","sha256")}: raise ValueError("Installed original executable differs")
    return ready
def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument("--directory",required=True);p.add_argument("--archive");p.add_argument("--reopen",action="store_true");a=p.parse_args()
    root=pathlib.Path(a.directory).resolve()
    if sys.platform!="linux" or platform.machine() not in ("x86_64","amd64"): p.error("The selected original asset is Linux amd64")
    root.mkdir(parents=True,exist_ok=True,mode=0o700)
    if root.is_symlink() or (root.stat().st_mode&0o077) or root.stat().st_uid!=os.getuid(): raise ValueError("Select an owned canonical private runtime directory")
    lock=os.open(root/"install.lock",os.O_RDWR|os.O_CREAT,0o600)
    try:
        try: fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        except BlockingIOError: raise ValueError("The same original runtime installation is already owned")
        ready_file=root/"runtime-ready.json"
        if ready_file.exists(): print(json.dumps({"state":"ready","reopened":True,"receipt":str(ready_file),"runtime":verify_ready(ready_file)}));return
        if a.reopen: raise ValueError("The original runtime has no completed ready receipt")
        archive=pathlib.Path(a.archive).resolve() if a.archive else root/"sling_linux_amd64.tar.gz"
        if not archive.exists():
            if a.archive: raise ValueError("The supplied retained original archive does not exist")
            partial=root/"sling_linux_amd64.tar.gz.partial";original_receipt=root/"original-download.json"
            if partial.exists() and original_receipt.exists():
                retained=json.loads(original_receipt.read_text());same_archive(partial)
                if retained.get("sha256")!=EXPECTED["sha256"] or retained.get("bytes")!=EXPECTED["bytes"] or retained.get("httpStatus")!=200: raise ValueError("Original completed download receipt differs")
                os.replace(partial,archive)
            if partial.exists() and not archive.exists():
                failed=root/("incomplete-download-"+uuid.uuid4().hex+".part")
                os.replace(partial,failed)
                write(failed.with_suffix(".json"),{"path":failed.name,**digest(failed),"retainedAt":now()})
            started=now()
            try:
                if archive.exists(): raise StopIteration()
                request=urllib.request.Request(EXPECTED["url"],headers={"User-Agent":"TokenJunkieLabs-original-Sling-receiver/1"})
                with urllib.request.urlopen(request,timeout=90) as response,partial.open("wb") as out:
                    status=response.status
                    if status!=200: raise ValueError("Original provider did not return HTTP200")
                    while True:
                        data=response.read(1024*1024)
                        if not data: break
                        out.write(data)
                        if out.tell()>EXPECTED["bytes"]: raise ValueError("Original archive exceeded the selected byte count")
                    out.flush();os.fsync(out.fileno())
                    headers={k:response.headers[k] for k in ("Content-Type","Content-Length","ETag","Last-Modified") if response.headers.get(k)}
                receipt={"sourceUrl":EXPECTED["url"],"startedAt":started,"completedAt":now(),"httpStatus":status,"headers":headers,**same_archive(partial)}
                write(root/"original-download.json",receipt);os.replace(partial,archive)
            except StopIteration: pass
            except BaseException as e:
                error={"sourceUrl":EXPECTED["url"],"startedAt":started,"completedAt":now(),"errorType":type(e).__name__,"message":str(e)}
                with (root/"download-attempts.ndjson").open("ab") as f: f.write((json.dumps(error)+"\n").encode());f.flush();os.fsync(f.fileno())
                raise
        archive_info=same_archive(archive);destination=root/"original";destination.mkdir(exist_ok=True,mode=0o700)
        members=[];seen=set();total=0
        with tarfile.open(archive,"r:gz") as tar:
            for member in tar:
                raw=member.name
                while raw.startswith("./"): raw=raw[2:]
                if not raw: continue
                name=pathlib.PurePosixPath(raw)
                if name.is_absolute() or ".." in name.parts or "\\" in raw or raw in seen: raise ValueError("Unsafe or duplicate original archive member")
                seen.add(raw);target=destination/pathlib.Path(*name.parts)
                if member.isdir(): target.mkdir(parents=True,exist_ok=True,mode=0o700);continue
                if not member.isfile(): raise ValueError("Unexpected non-regular member in selected original release")
                total+=member.size
                if total>1024*1024*1024: raise ValueError("Original archive exceeds the selected receiving capacity")
                source=tar.extractfile(member);target.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
                temp=target.with_name(target.name+".receiving")
                with temp.open("wb") as out:
                    while True:
                        data=source.read(1024*1024)
                        if not data: break
                        out.write(data)
                    out.flush();os.fsync(out.fileno())
                got=digest(temp)
                if got["bytes"]!=member.size: raise ValueError("Original member truncated")
                if target.exists():
                    if digest(target)!=got: raise ValueError("Existing original member differs")
                    temp.unlink()
                else: os.replace(temp,target)
                os.chmod(target,0o500 if member.mode&0o111 else 0o400)
                members.append({"path":raw,"originalMode":member.mode,**got})
        candidates=[destination/x["path"] for x in members if pathlib.PurePosixPath(x["path"]).name=="sling"]
        if len(candidates)!=1: raise ValueError("Original release must contain one sling executable")
        executable=candidates[0];version_file=root/"version-observation.json"
        executable_info=digest(executable);version_root=root/"version-observations";version_root.mkdir(exist_ok=True,mode=0o700)
        retained=[]
        if version_file.exists(): retained.append(json.loads(version_file.read_text()))
        for path in sorted(version_root.glob("*/response.json")): retained.append(json.loads(path.read_text()))
        for previous in retained:
            if previous.get("argv")!=[str(executable),"--version"]: raise ValueError("Retained native version selection differs")
            if previous.get("executable") not in (None,executable_info): raise ValueError("Retained version observation names another native executable")
        def accepted(row): return row.get("exitCode")==0 and EXPECTED["version"] in row.get("stdout","")+row.get("stderr","")
        observed=next((row for row in retained if accepted(row)),None)
        if observed is None:
            # A failed or interrupted read-only version command is retained. The same
            # binary may have a later observed continuation under this original lock.
            for pending in sorted(version_root.glob("*/request.json")):
                response=pending.parent/"response.json"
                if not response.exists():
                    request=json.loads(pending.read_text())
                    write(response,{**request,"completedAt":now(),"exitCode":None,"stdout":"","stderr":"","state":"unobserved","error":"Previous version observation ended without its terminal response"})
            attempt_id="version_"+uuid.uuid4().hex;attempt=version_root/attempt_id
            request={"attemptId":attempt_id,"argv":[str(executable),"--version"],"executable":executable_info,"startedAt":now(),"priorObservations":len(retained)}
            write(attempt/"request.json",request)
            try:
                result=subprocess.run(request["argv"],text=True,capture_output=True,timeout=60,env={**os.environ,"SLING_DISABLE_TELEMETRY":"true"},pass_fds=(lock,))
                observed={**request,"completedAt":now(),"exitCode":result.returncode,"stdout":result.stdout,"stderr":result.stderr,"state":"observed"}
            except BaseException as error:
                def output_text(value): return value.decode("utf-8",errors="replace") if isinstance(value,bytes) else value or ""
                observed={**request,"completedAt":now(),"exitCode":None,"stdout":output_text(getattr(error,"stdout",None)),"stderr":output_text(getattr(error,"stderr",None)),"state":"failed","errorType":type(error).__name__,"error":str(error)}
                write(attempt/"response.json",observed)
                if not version_file.exists(): write(version_file,observed)
                raise
            write(attempt/"response.json",observed)
            if not version_file.exists(): write(version_file,observed)
        if not accepted(observed): raise ValueError("Original installed version did not match; this observation is retained for the same-binary continuation")
        ready={"schema":"tjlabs.sling-runtime-ready.v1","state":"ready","version":EXPECTED["version"],"sourceCommit":EXPECTED["sourceCommit"],"platform":sys.platform,"machine":platform.machine(),"archive":{"path":str(archive),**archive_info},"executable":{"path":str(executable),**digest(executable)},"originalMembers":members,"versionObservation":observed,"readyAt":observed["completedAt"]}
        write(ready_file,ready);print(json.dumps({"state":"ready","reopened":False,"receipt":str(ready_file),"runtime":ready}))
    finally: os.close(lock)
if __name__=="__main__": main()
