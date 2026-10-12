#!/usr/bin/env python3
"""Own the whole receiving lifetime on the already selected native estate."""
import argparse,fcntl,hashlib,json,os,pathlib,signal,stat,subprocess,sys,tempfile,time
def read(p):
    with open(p,"rb") as h:return h.read()
def save(p,value):
    data=(json.dumps(value,indent=2)+"\n").encode()
    fd,tmp=tempfile.mkstemp(prefix=p.name+".",suffix=".partial",dir=p.parent)
    try:
        os.fchmod(fd,0o600)
        with os.fdopen(fd,"wb") as h:h.write(data);h.flush();os.fsync(h.fileno())
        os.replace(tmp,p)
        parent=os.open(p.parent,os.O_RDONLY)
        try:os.fsync(parent)
        finally:os.close(parent)
    finally:
        try:os.unlink(tmp)
        except FileNotFoundError:pass
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
    parser=argparse.ArgumentParser()
    parser.add_argument("--input",required=True);parser.add_argument("--input-sha256",required=True)
    args=parser.parse_args();input_file=pathlib.Path(args.input)
    if not input_file.is_absolute() or input_file.is_symlink():raise ValueError("Select the original regular receiving input")
    data=read(input_file);sha=hashlib.sha256(data).hexdigest()
    if sha!=args.input_sha256:raise ValueError("Original receiving selection changed")
    selection=json.loads(data)
    if selection["schema"]!="lightdash-commissioning.receiving.v1":raise ValueError("Unknown receiving schema")
    output=pathlib.Path(selection["outputDirectory"]);root=pathlib.Path(selection["appRoot"])
    if not output.is_absolute() or output.resolve()!=output or not output.is_dir():raise ValueError("Use the prepared canonical persistent output directory")
    control=output/"control";control.mkdir(mode=0o700,exist_ok=True)
    if control.is_symlink() or control.resolve()!=control:raise ValueError("Receiving control directory changed")
    fd=os.open(control/"receiving.lock",os.O_RDWR|os.O_CREAT|os.O_NOFOLLOW,0o600)
    selected=os.fstat(fd)
    if not stat.S_ISREG(selected.st_mode):raise ValueError("Receiving lease is not a regular file")
    try:
        try:fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB)
        except BlockingIOError:
            print(json.dumps({"state":"RUNNING","operationId":selection["operationId"],"message":"The same receiving owner or original native descendant still holds its kernel lease."}));return 2
        request={"schema":"lightdash-commissioning.receiving-host.v1","operationId":selection["operationId"],"inputFile":str(input_file.resolve()),"inputSha256":sha,"outputDirectory":str(output),"appRoot":str(root)}
        binding=control/"request.json"
        if binding.exists():
            if json.loads(read(binding))!=request:raise ValueError("Existing receiving output names another original selection")
        else:save(binding,request)
        env=dict(os.environ);env["PYTHONDONTWRITEBYTECODE"]="1"
        env["LDW_RECEIVING_LEASE_FD"]=str(fd)
        env["LDW_RECEIVING_LEASE_IDENTITY"]=json.dumps({"device":selected.st_dev,"inode":selected.st_ino,"operationId":selection["operationId"],"inputSha256":sha},separators=(",",":"))
        node=selection["connection"]["runtime"]["node"]
        command=[node,str(root/"receiving"/"receive.mjs"),"--input",str(input_file.resolve()),"--input-sha256",sha]
        with open(control/"receiving.stdout.log","ab",buffering=0) as stdout,open(control/"receiving.stderr.log","ab",buffering=0) as stderr:
            child=None
            try:
                child=subprocess.Popen(command,stdin=subprocess.DEVNULL,stdout=stdout,stderr=stderr,env=env,pass_fds=(fd,),start_new_session=True)
                stopping=[False]
                def stop(sig,frame):
                    if stopping[0]:return
                    stopping[0]=True
                    try:os.killpg(child.pid,signal.SIGTERM)
                    except ProcessLookupError:pass
                signal.signal(signal.SIGTERM,stop);signal.signal(signal.SIGINT,stop)
                save(control/"process.json",{**request,"pid":child.pid,"hostPid":os.getpid(),"startedAt":time.time(),"command":command,"leaseDevice":selected.st_dev,"leaseInode":selected.st_ino})
                while True:
                    try:code=child.wait(timeout=2);break
                    except subprocess.TimeoutExpired:
                        if stopping[0]:
                            code=drain_owned_child(child,120);break
            finally:
                # Persisting process.json may fail after a real child starts.
                # Drain it while the same whole-receiving lease is still owned.
                drain_owned_child(child,120)
                for h in (stdout,stderr):h.flush();os.fsync(h.fileno())
        result_file=output/"receiving-result.json"
        result=json.loads(read(result_file)) if result_file.exists() else {"state":"INTERRUPTED","operationId":selection["operationId"],"inputSha256":sha}
        print(json.dumps({"operationId":selection["operationId"],"state":result["state"],"processExit":code,"resultFile":str(result_file) if result_file.exists() else None,"outputDirectory":str(output),"handover":result.get("handover")}))
        return 0 if code==0 and result.get("state")=="SUCCEEDED" else 3
    finally:os.close(fd)
if __name__=="__main__":
    try:sys.exit(main())
    except Exception as error:
        print(json.dumps({"state":"RECEIVING_NOT_STARTED_OR_INTERRUPTED","error":{"code":type(error).__name__,"message":str(error)}}),file=sys.stderr)
        sys.exit(3)
