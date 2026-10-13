#!/usr/bin/env python3
# MIT. Dedicated exact Stellar attempt. No implicit resend or replacement request.
import base64, contextlib, hashlib, json, os, pathlib, shutil, stat, sys, time

def need(ok, message):
    if not ok: raise RuntimeError(message)

def raw(value):
    return (json.dumps(value, ensure_ascii=False, indent=2, separators=(",", ": ")) + "\n").encode("utf-8")

def digest(data): return hashlib.sha256(data).hexdigest()

def read_file(file):
    fd = os.open(str(file), os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
    with os.fdopen(fd, "rb") as f:
        before = os.fstat(f.fileno())
        need(stat.S_ISREG(before.st_mode), "Regular complete file required")
        data = f.read()
        after = os.fstat(f.fileno())
        need((before.st_dev,before.st_ino,before.st_size,before.st_mtime_ns,before.st_ctime_ns) ==
             (after.st_dev,after.st_ino,after.st_size,after.st_mtime_ns,after.st_ctime_ns), "Original file changed")
        return data

def sync_parent(file):
    if os.name != "nt":
        fd=os.open(str(pathlib.Path(file).parent), os.O_RDONLY)
        try: os.fsync(fd)
        finally: os.close(fd)

def exact(file, data, mode=0o600):
    file=pathlib.Path(file)
    if file.exists():
        need(read_file(file)==data, "Original file conflict")
        sync_parent(file)
        return
    temporary=file.with_name(file.name+".pending-"+str(os.getpid()))
    fd=os.open(str(temporary),os.O_WRONLY|os.O_CREAT|os.O_EXCL|getattr(os,"O_NOFOLLOW",0),mode)
    with os.fdopen(fd,"wb") as f:
        f.write(data); f.flush(); os.fsync(f.fileno())
    try: os.link(temporary,file)
    except FileExistsError: need(read_file(file)==data,"Original file conflict")
    finally: temporary.unlink()
    sync_parent(file)

@contextlib.contextmanager
def locked(file):
    with open(file,"a+b",buffering=0) as f:
        if os.name=="nt":
            import msvcrt
            if os.fstat(f.fileno()).st_size==0: f.write(b"0")
            f.seek(0); msvcrt.locking(f.fileno(),msvcrt.LK_NBLCK,1)
        else:
            import fcntl
            fcntl.flock(f.fileno(),fcntl.LOCK_EX|fcntl.LOCK_NB)
        try: yield f.fileno()
        finally:
            if os.name=="nt":
                f.seek(0); msvcrt.locking(f.fileno(),msvcrt.LK_UNLCK,1)
            else: fcntl.flock(f.fileno(),fcntl.LOCK_UN)

def main():
    input_path=pathlib.Path(sys.argv[1]).resolve(strict=True)
    root=input_path.parent; input_bytes=read_file(input_path); spec=json.loads(input_bytes)
    need(spec["schema"]=="principal.native-attempt.v1","Original attempt required")
    helper=read_file(spec["owner"]["path"])
    need(len(helper)==spec["owner"]["bytes"] and digest(helper)==spec["owner"]["sha256"],"Native owner source changed")
    current=read_file(__file__)
    need(len(current)==spec["script"]["bytes"] and digest(current)==spec["script"]["sha256"],"Native entry source changed")
    namespace={"__name__":"principal_owned_process","__file__":spec["owner"]["path"]}
    exec(compile(helper,spec["owner"]["path"],"exec"),namespace)
    run_owned=namespace["run_owned"]
    result_path=root/"result.json"
    with locked(root/"attempt.lock") as lease_fd:
        if result_path.exists():
            result=json.loads(read_file(result_path))
            need(result["inputSha256"]==digest(input_bytes),"Original attempt changed")
            return
        need(not (root/"reserved.json").exists(),"Original dispatch outcome remains unresolved; no resend")
        exact(root/"reserved.json",raw({"inputSha256":digest(input_bytes),"pid":os.getpid(),"at":time.time()}))
        files=[]; observations=[]; invocation={"argv":spec["argv"],"started":False,"returncode":None,"stdout":None,"stderr":None}
        failure=None
        def retain(file):
            data=read_file(file)
            row={"path":file.name,"bytes":len(data),"sha256":digest(data),"mode":stat.S_IMODE(file.stat().st_mode)}
            files.append(row); return data
        def command(label,args):
            out=root/(label+".stdout"); err=root/(label+".stderr"); process_file=root/(label+".process.json")
            with open(out,"xb",buffering=0) as stdout,open(err,"xb",buffering=0) as stderr:
                outcome=run_owned([str(executable)]+args,stdout,stderr_stream=stderr,
                    cwd=str(root),env={k:v for k,v in os.environ.items() if not k.startswith(("STELLAR_","SOROBAN_"))},
                    lease_fd=lease_fd,on_started=lambda value:exact(process_file,raw(value)))
            stdout_bytes=retain(out);retain(err)
            if process_file.exists(): retain(process_file)
            row={"label":label,"argv":args,"stdout":out.name,"stderr":err.name,**outcome}
            observations.append(row)
            need(outcome["returncode"]==0,"Stellar "+label+" returned a nonzero status")
            return stdout_bytes.decode("utf-8","strict").strip(),row
        try:
            binary=read_file(spec["executable"])
            need(len(binary)<=128*1024*1024,"Selected executable exceeds the complete-object limit")
            need(digest(binary)==spec["executableSha256"],"Selected Stellar executable changed")
            executable=root/("stellar-selected.exe" if os.name=="nt" else "stellar-selected")
            exact(executable,binary,0o500);retain(executable);retain(input_path)
            version,_=command("version",["--version"]);need(version==spec["expectedVersion"],"Selected Stellar version differs")
            public,_=command("signer",["--config-dir",spec["configDirectory"],"keys","public-key",spec["sourceAccount"]["alias"]])
            need(public==spec["sourceAccount"]["address"],"Original signer alias changed public account")
            network,_=command("network",["--config-dir",spec["configDirectory"],"network","info","--output","json","--rpc-url",spec["network"]["rpcUrl"],"--network-passphrase",spec["network"]["passphrase"]])
            need(json.loads(network)["passphrase"]==spec["network"]["passphrase"],"RPC serves a different selected network")
            wasm,_=command("contract",["--config-dir",spec["configDirectory"],"contract","info","hash","--id",spec["contract"]["id"],"--rpc-url",spec["network"]["rpcUrl"],"--network-passphrase",spec["network"]["passphrase"]])
            if wasm.startswith('"'): wasm=json.loads(wasm)
            need(wasm==spec["contract"]["wasmSha256"],"Deployed contract code differs from selected source binding")
            try:
                value,row=command("invocation",spec["argv"]);invocation={**row,"started":True}
            finally:
                if (root/"invocation.process.json").exists(): invocation["started"]=True
                if (root/"invocation.stdout").exists():
                    invocation["stdout"]="invocation.stdout";invocation["stderr"]="invocation.stderr"
                    if not any(f["path"]=="invocation.stdout" for f in files):retain(root/"invocation.stdout")
                    if not any(f["path"]=="invocation.stderr" for f in files):retain(root/"invocation.stderr")
                    if observations and observations[-1]["label"]=="invocation":
                        invocation.update(observations[-1])
        except BaseException as error:
            failure={"type":type(error).__name__,"message":str(error)}
        # run_owned returns/raises only after tree closure. Preserve every original
        # stream, including a preflight error, before making a terminal receipt.
        for file in sorted(root.iterdir()):
            if file.suffix in (".stdout",".stderr") or file.name.endswith(".process.json"):
                if not any(f["path"]==file.name for f in files): retain(file)
        result={"schema":"principal.native-result.v1","requestId":spec["requestId"],"planId":spec["planId"],
                "inputSha256":digest(input_bytes),"mode":spec["mode"],"invocation":invocation,
                "observations":observations,"failure":failure,"files":files,"lifetimes":"CLOSED","completedAt":time.time()}
        exact(result_path,raw(result))

if __name__=="__main__": main()
