#!/usr/bin/env python3
"""Kernel lease for one original Lightdash/dbt invocation. No admission controller."""
import argparse, fcntl, hashlib, json, os, pathlib, signal, stat, subprocess, sys, tempfile, time

def canonical(v):
    return json.dumps(v,sort_keys=True,separators=(",",":"),ensure_ascii=False).encode()
def load(p,missing=False):
    try:
        with open(p,"rb") as f:return json.load(f)
    except FileNotFoundError:
        if missing:return None
        raise
def save(p,v):
    p.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
    data=(json.dumps(v,indent=2,ensure_ascii=False)+"\n").encode()
    fd,tmp=tempfile.mkstemp(prefix=p.name+".",suffix=".partial",dir=p.parent)
    try:
        os.fchmod(fd,0o600)
        with os.fdopen(fd,"wb") as f:f.write(data);f.flush();os.fsync(f.fileno())
        os.replace(tmp,p)
        d=os.open(p.parent,os.O_RDONLY)
        try:os.fsync(d)
        finally:os.close(d)
    finally:
        try:os.unlink(tmp)
        except FileNotFoundError:pass
def opened_lock(p,create):
    if create:p.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
    flags=os.O_RDWR|os.O_NOFOLLOW
    if create:flags|=os.O_CREAT
    fd=os.open(p,flags,0o600)
    if not stat.S_ISREG(os.fstat(fd).st_mode):os.close(fd);raise ValueError("Native lease is not a regular file")
    return fd
def locked(fd):
    try:fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB);return False
    except BlockingIOError:return True
def drain_owned_child(child,timeout):
    """Keep inherited leases until this acquired process group has drained."""
    if child is None:return None
    if child.poll() is not None:return child.returncode
    try:os.killpg(child.pid,signal.SIGTERM)
    except ProcessLookupError:pass
    try:return child.wait(timeout=timeout)
    except subprocess.TimeoutExpired:
        try:os.killpg(child.pid,signal.SIGKILL)
        except ProcessLookupError:pass
        return child.wait()
def main():
    p=argparse.ArgumentParser()
    p.add_argument("mode",choices=["execute","inspect","status"])
    p.add_argument("--workspace",required=True);p.add_argument("--native",required=True)
    a=p.parse_args();workspace=pathlib.Path(a.workspace).resolve();root=pathlib.Path(a.native).resolve()
    if workspace not in root.parents:raise ValueError("Native state is outside the workspace")
    op=load(root/"plan.json");base={"schema":"lightdash-commissioning.result.v1","operationId":op["operationId"],"digest":op["digest"]}
    lease=root/"operation.lock"
    try:fd=opened_lock(lease,a.mode!="status")
    except FileNotFoundError:
        print(json.dumps({**base,"state":"PLANNED","dispatched":False,"artifacts":[],"nativeReferences":[]}));return
    global_fd=None
    try:
        if locked(fd):
            prior=load(root/"result.json",True) or {}
            print(json.dumps({**prior,**base,"state":"RUNNING","kernelLeaseHeld":True}));return
        prior=load(root/"result.json",True)
        if a.mode=="status":
            if prior and prior.get("state")!="RUNNING":print(json.dumps(prior));return
            attempt=load(root/"active.json",True)
            print(json.dumps({**(prior or {}),**base,"state":"INTERRUPTED" if attempt else "PLANNED","kernelLeaseHeld":False,"dispatched":bool(attempt),"recovery":{"sameOperation":True,"automaticWriteReplay":False}}));return
        if prior and (prior.get("state")=="SUCCEEDED" or (a.mode=="execute" and prior.get("state")=="FAILED")):print(json.dumps({**prior,"replayed":True}));return
        config=pathlib.Path(os.path.expanduser("~"))/".config"/"lightdash"
        global_fd=opened_lock(config/"commissioning-native.lock",True)
        if locked(global_fd):
            print(json.dumps({**base,"state":"BUSY","dispatched":bool(load(root/"active.json",True)),"reason":"Another commissioning invocation owns the original CLI configuration."}));return
        env=dict(os.environ)
        receiving_fd=None
        if "LDW_RECEIVING_LEASE_FD" in env or "LDW_RECEIVING_LEASE_IDENTITY" in env:
            receiving_fd=int(env["LDW_RECEIVING_LEASE_FD"]); receiving_identity=json.loads(env["LDW_RECEIVING_LEASE_IDENTITY"]); receiving_stat=os.fstat(receiving_fd)
            if receiving_fd<3 or not stat.S_ISREG(receiving_stat.st_mode) or receiving_stat.st_dev!=receiving_identity["device"] or receiving_stat.st_ino!=receiving_identity["inode"]:raise ValueError("Original receiving lease changed")
        inherited=(fd,global_fd)+((receiving_fd,) if receiving_fd is not None else ())
        env["LDW_LEASE_FDS"]=str(fd)+","+str(global_fd)
        env["LDW_WORKSPACE"]=str(workspace);env["LDW_NATIVE_DIRECTORY"]=str(root)
        env["PYTHONDONTWRITEBYTECODE"]="1"
        node=op["connection"]["runtime"]["node"]["path"]
        runner=pathlib.Path(__file__).with_name("runner.mjs")
        log=root/"host.log"
        with open(log,"ab",buffering=0) as output:
            child=None
            try:
                child=subprocess.Popen([node,str(runner),"--mode",a.mode,"--workspace",str(workspace),"--native",str(root)],stdin=subprocess.DEVNULL,stdout=output,stderr=output,env=env,pass_fds=inherited,start_new_session=True)
                stopping=[False]
                def stop(sig,_frame):
                    if stopping[0]:return
                    stopping[0]=True
                    try:os.killpg(child.pid,signal.SIGTERM)
                    except ProcessLookupError:pass
                signal.signal(signal.SIGTERM,stop);signal.signal(signal.SIGINT,stop)
                save(root/"host-process.json",{"schema":"lightdash-commissioning.process.v1","pid":child.pid,"hostPid":os.getpid(),"startedAt":time.time(),"operationId":op["operationId"],"digest":op["digest"],"leaseDevice":os.fstat(fd).st_dev,"leaseInode":os.fstat(fd).st_ino})
                while True:
                    try:code=child.wait(timeout=1);break
                    except subprocess.TimeoutExpired:
                        if stopping[0]:
                            code=drain_owned_child(child,45);break
            finally:
                # This includes a failed process receipt/fsync after Popen.
                # The operation/config/receiving descriptors remain open here.
                drain_owned_child(child,45)
                output.flush();os.fsync(output.fileno())
        result=load(root/"result.json",True)
        if not result or result.get("state")=="RUNNING":
            result={**(result or {}),**base,"state":"INTERRUPTED","processExit":code,"kernelLeaseHeld":False,"recovery":{"sameOperation":True,"automaticWriteReplay":False,"message":"Inspect the retained native operation; no new command has been inferred."}}
            save(root/"result.json",result)
        print(json.dumps(result))
    finally:
        if global_fd is not None:os.close(global_fd)
        os.close(fd)
if __name__=="__main__":
    try:main()
    except Exception as e:
        print(json.dumps({"error":{"code":type(e).__name__,"message":"The native host could not finish; retain and inspect this operation."}}))
        sys.exit(1)
