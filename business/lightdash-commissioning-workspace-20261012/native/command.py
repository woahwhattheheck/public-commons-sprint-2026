#!/usr/bin/env python3
"""Retain the actual exit of an original dbt executable while its lease survives."""
import hashlib,json,os,pathlib,signal,stat,subprocess,sys,tempfile

def save(p,v):
    data=(json.dumps(v,indent=2)+"\n").encode();fd,tmp=tempfile.mkstemp(prefix=p.name+".",suffix=".partial",dir=p.parent)
    try:
        os.fchmod(fd,0o600)
        with os.fdopen(fd,"wb") as h:h.write(data);h.flush();os.fsync(h.fileno())
        os.replace(tmp,p);d=os.open(p.parent,os.O_RDONLY)
        try:os.fsync(d)
        finally:os.close(d)
    finally:
        try:os.unlink(tmp)
        except FileNotFoundError:pass

def main():
    spec=json.loads(pathlib.Path(sys.argv[1]).read_bytes())
    plan=json.loads(pathlib.Path(spec["planFile"]).read_bytes())
    if plan["digest"]!=spec["operationDigest"]:raise ValueError("Native command binding changed")
    dbt=plan["connection"]["runtime"]["dbt"]
    with open(dbt["path"],"rb") as h:body=h.read()
    if len(body)!=dbt["bytes"] or hashlib.sha256(body).hexdigest()!=dbt["sha256"]:raise ValueError("Original dbt executable changed")
    descriptors=tuple(int(x) for x in os.environ["LDW_LEASE_FDS"].split(","))
    if len(descriptors)!=2:raise ValueError("Both native leases are required")
    for fd in descriptors:os.fstat(fd)
    if "LDW_RECEIVING_LEASE_FD" in os.environ or "LDW_RECEIVING_LEASE_IDENTITY" in os.environ:
        receiving_fd=int(os.environ["LDW_RECEIVING_LEASE_FD"]); identity=json.loads(os.environ["LDW_RECEIVING_LEASE_IDENTITY"]); selected=os.fstat(receiving_fd)
        if receiving_fd<3 or not stat.S_ISREG(selected.st_mode) or selected.st_dev!=identity["device"] or selected.st_ino!=identity["inode"]:raise ValueError("Original receiving lease changed")
        descriptors=descriptors+(receiving_fd,)
    args=[dbt["path"],*spec["argv"]]
    child=subprocess.Popen(args,cwd=spec["cwd"],env=dict(os.environ),stdin=subprocess.DEVNULL,stdout=sys.stdout,stderr=sys.stderr,pass_fds=descriptors)
    def stop(sig,frame):
        try:child.send_signal(sig)
        except ProcessLookupError:pass
    signal.signal(signal.SIGTERM,stop);signal.signal(signal.SIGINT,stop)
    code=child.wait()
    save(pathlib.Path(spec["attemptDirectory"])/(spec["phase"]+".native-exit.json"),{"schema":"lightdash-commissioning.native-exit.v1","operationId":plan["operationId"],"digest":plan["digest"],"phase":spec["phase"],"mode":"dbt","exitCode":code,"signal":-code if code<0 else None})
    return code if code>=0 else 128-code
if __name__=="__main__":
    try:sys.exit(main())
    except Exception as e:
        print(json.dumps({"error":{"code":type(e).__name__,"message":"Original dbt command did not retain a completed exit."}}),file=sys.stderr)
        sys.exit(1)
