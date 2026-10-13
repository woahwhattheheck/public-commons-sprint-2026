#!/usr/bin/env python3
"""Run one HDF5 receiving journey and reap its exact owned browser on failure."""
from __future__ import annotations
import argparse, fcntl, hashlib, json, os, signal, stat, subprocess, sys, time, uuid
from pathlib import Path

def identity(pid):
    try:
        text=Path(f"/proc/{pid}/stat").read_text()
        fields=text[text.rfind(")")+2:].split()
        return {"pid":int(pid),"startTicks":fields[19],"pgid":int(fields[2]),
                "boot":Path("/proc/sys/kernel/random/boot_id").read_text().strip(),
                "namespace":os.readlink(f"/proc/{pid}/ns/pid"),"state":fields[0]}
    except (OSError,ValueError,IndexError):return None

def same(a,b):
    return bool(a and b and all(a.get(key)==b.get(key) for key in ("pid","startTicks","pgid","boot","namespace")))
def sync_parent(path):
    fd=os.open(path.parent,os.O_RDONLY|os.O_DIRECTORY)
    try:os.fsync(fd)
    finally:os.close(fd)
def write(path,value):
    pending=path.with_name(path.name+".pending-"+str(uuid.uuid4()))
    with pending.open("x",encoding="utf8") as stream:
        os.chmod(pending,0o600);json.dump(value,stream,indent=2);stream.write("\n");stream.flush();os.fsync(stream.fileno())
    os.replace(pending,path);sync_parent(path)
def browser_cleanup(root,intent_sha):
    observed=[]
    for record in sorted((root/"browser-owners").glob("*.json")):
        value=json.loads(record.read_text())
        if value.get("schema")!="stellar-forge.hdf5-browser-owner.v1" or value.get("intentSha256")!=intent_sha or value.get("directory")!=str(root):
            raise RuntimeError("Retained browser owner is not bound to this exact original receiving intent")
        original=value["identity"];current=identity(original["pid"])
        alive=same(original,current) and current["state"] not in ("Z","X")
        if alive:
            if original["pgid"]!=original["pid"]:raise RuntimeError("Owned browser is not its own recorded process-group leader")
            for sig,grace in ((signal.SIGTERM,8),(signal.SIGKILL,3)):
                current=identity(original["pid"])
                if not same(original,current) or current["state"] in ("Z","X"):break
                os.killpg(original["pgid"],sig)
                end=time.monotonic()+grace
                while time.monotonic()<end:
                    current=identity(original["pid"])
                    if not same(original,current) or current["state"] in ("Z","X"):break
                    time.sleep(.1)
        current=identity(original["pid"])
        remaining=same(original,current) and current["state"] not in ("Z","X")
        observed.append({"attempt":value["attempt"],"original_process_alive":remaining})
        if remaining:raise RuntimeError("The exact owned browser process has not ended")
    return observed

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--directory",required=True)
    parser.add_argument("--node",default="node")
    args,forward=parser.parse_known_args()
    root=Path(args.directory).expanduser().absolute()
    root.mkdir(mode=0o700,parents=True,exist_ok=True)
    info=root.lstat()
    if root.resolve()!=root or not stat.S_ISDIR(info.st_mode) or info.st_uid!=os.getuid() or info.st_mode&0o077:
        raise RuntimeError("Use a canonical operator-owned private receiving directory")
    lock=os.open(root/"native-receiving.lock",os.O_CREAT|os.O_RDWR|os.O_NOFOLLOW,0o600)
    try:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        intent=root/"native-intent.json"
        if intent.exists():browser_cleanup(root,hashlib.sha256(intent.read_bytes()).hexdigest())
        env={**os.environ,"HDF5_RECEIVING_PARENT":str(os.getpid()),"HDF5_RECEIVING_LOCK_FD":str(lock),
             "HDF5_RECEIVING_PYTHON":sys.executable,"PYTHONDONTWRITEBYTECODE":"1"}
        command=[args.node,str(Path(__file__).with_suffix(".mjs")),"--directory",str(root),*forward]
        child=subprocess.Popen(command,env=env,pass_fds=(lock,),start_new_session=True)
        interrupted=[];stop_at=None
        def stop(signum,frame):
            nonlocal stop_at
            if stop_at is None:stop_at=time.monotonic()
            interrupted.append(signum)
            if child.poll() is None:os.killpg(child.pid,signal.SIGTERM)
        previous={sig:signal.signal(sig,stop) for sig in (signal.SIGINT,signal.SIGTERM)}
        started=time.monotonic()
        try:
            while child.poll() is None:
                if stop_at is not None and time.monotonic()-stop_at>240:
                    os.killpg(child.pid,signal.SIGKILL)
                time.sleep(.2)
            code=child.wait()
        finally:
            for sig,handler in previous.items():signal.signal(sig,handler)
            if child.poll() is None:
                os.killpg(child.pid,signal.SIGTERM)
                try:child.wait(timeout=145)
                except subprocess.TimeoutExpired:os.killpg(child.pid,signal.SIGKILL);child.wait()
            cleanup=browser_cleanup(root,hashlib.sha256(intent.read_bytes()).hexdigest()) if intent.exists() else []
            write(root/"native-cleanup.json",{"nodeExitCode":child.returncode,"browsers":cleanup,"completedAt":time.time()})
        return code if code>=0 else 128-code
    finally:os.close(lock)

if __name__=="__main__":
    try:raise SystemExit(main())
    except Exception as exc:
        sys.stderr.write(json.dumps({"error":type(exc).__name__,"message":str(exc)})+"\n")
        raise SystemExit(1)
