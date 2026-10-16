#!/usr/bin/env python3
"""Run one HDF5 receiving journey and reap its exact owned browser on failure."""
from __future__ import annotations
import argparse, fcntl, hashlib, json, os, signal, stat, subprocess, sys, time, uuid, select
from pathlib import Path

def identity(pid, procfs_pid=None):
    # Numeric /proc paths belong to the mounted procfs namespace. Never use a
    # namespace-local PID as that path when the views differ.
    if procfs_pid is None:
        if int(os.readlink("/proc/self")) != os.getpid():
            raise RuntimeError("Legacy browser identity needs its original matching procfs namespace")
        procfs_pid=pid
    root=Path(f"/proc/{procfs_pid}")
    try:
        text=(root/"stat").read_text();fields=text[text.rfind(")")+2:].split()
        status={line.split(":",1)[0]:line.split(":",1)[1].split() for line in (root/"status").read_text().splitlines() if ":" in line}
        if int(text.split(" ",1)[0])!=procfs_pid or int(status["NSpid"][-1])!=pid:
            return None
        return {"pid":int(pid),"procfsPid":int(procfs_pid),"startTicks":fields[19],
                "pgid":int(status["NSpgid"][-1]),"procfsPgid":int(fields[2]),
                "boot":Path("/proc/sys/kernel/random/boot_id").read_text().strip(),
                "namespace":os.readlink(root/"ns/pid"),"executable":os.path.realpath(root/"exe"),"state":fields[0]}
    except (FileNotFoundError,ProcessLookupError):return None

def same(a,b):
    keys=("pid","startTicks","pgid","boot","namespace")
    if a and a.get("format")=="stellar-forge.hdf5-namespace-process.v2":
        keys+=("procfsPid","procfsPgid","executable")
    return bool(a and b and all(a.get(key)==b.get(key) for key in keys))
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
        original=value["identity"];current=identity(original["pid"],original.get("procfsPid"))
        alive=same(original,current) and current["state"] not in ("Z","X")
        closure_path=root/"browser-closures"/(value["attempt"]+".json")
        closure=None
        if closure_path.exists():
            closure=json.loads(closure_path.read_text())
            if closure.get("schema")!="stellar-forge.hdf5-browser-closure.v1" or closure.get("intentSha256")!=intent_sha or closure.get("directory")!=str(root) or closure.get("attempt")!=value["attempt"] or closure.get("ownerSha256")!=hashlib.sha256(record.read_bytes()).hexdigest() or closure.get("pidfdTerminated") is not True or closure.get("helperExitCode")!=0:
                raise RuntimeError("Retained browser closure is not bound to its exact original owner")
            if alive:raise RuntimeError("Positive Chrome closure conflicts with a live original identity")
        if alive:
            if os.readlink("/proc/self/ns/pid")!=original["namespace"]:
                raise RuntimeError("The original browser remains alive in another PID namespace; retain its owner without signaling")
            if original["pgid"]!=original["pid"]:raise RuntimeError("Owned browser is not its own recorded process-group leader")
            for sig,grace in ((signal.SIGTERM,8),(signal.SIGKILL,3)):
                current=identity(original["pid"],original.get("procfsPid"))
                if not same(original,current) or current["state"] in ("Z","X"):break
                os.killpg(original["pgid"],sig)
                end=time.monotonic()+grace
                while time.monotonic()<end:
                    current=identity(original["pid"],original.get("procfsPid"))
                    if not same(original,current) or current["state"] in ("Z","X"):break
                    time.sleep(.1)
        current=identity(original["pid"],original.get("procfsPid"))
        remaining=same(original,current) and current["state"] not in ("Z","X")
        observed.append({"attempt":value["attempt"],"original_process_alive":remaining,"held_pidfd_closure":bool(closure)})
        if remaining:raise RuntimeError("The exact owned browser process has not ended")
    return observed

def browser_identity():
    """Pin this spawning Node's exact Chrome child through a held kernel pidfd."""
    payload=json.loads(sys.argv[2])
    required={"pid","spawnerPid","spawnerProcfsPid","spawnerStartTicks","namespace","namespaceIndex","executable"}
    if set(payload)!=required or any(type(payload[k]) is not int or payload[k]<1 for k in ("pid","spawnerPid","spawnerProcfsPid")):
        raise RuntimeError("Select one exact original spawning Node and Chrome PID")
    namespace=os.readlink("/proc/self/ns/pid")
    self_status={line.split(":",1)[0]:line.split(":",1)[1].split() for line in Path("/proc/self/status").read_text().splitlines() if ":" in line}
    depth=len(self_status["NSpid"])-1
    if namespace!=payload["namespace"] or os.getppid()!=payload["spawnerPid"] or int(self_status["PPid"][0])!=payload["spawnerProcfsPid"] or depth!=payload["namespaceIndex"]:
        raise RuntimeError("The identity helper is not in the exact spawning Node lineage and namespace")
    fd=os.pidfd_open(payload["pid"],0)
    try:
        poll=select.poll();poll.register(fd,select.POLLIN)
        info={line.split(":",1)[0]:line.split(":",1)[1].split() for line in Path(f"/proc/self/fdinfo/{fd}").read_text().splitlines() if ":" in line}
        procfs_pid=int(info["Pid"][0]);nspid=[int(x) for x in info["NSpid"]]
        if procfs_pid<1 or len(nspid)<=depth or nspid[depth]!=payload["pid"] or poll.poll(0):
            raise RuntimeError("Held pidfd does not identify the live original Chrome child")
        root=Path(f"/proc/{procfs_pid}");raw=(root/"stat").read_text();fields=raw[raw.rfind(")")+2:].split()
        status={line.split(":",1)[0]:line.split(":",1)[1].split() for line in (root/"status").read_text().splitlines() if ":" in line}
        executable=os.path.realpath(root/"exe",strict=True)
        parent_raw=Path(f"/proc/{payload['spawnerProcfsPid']}/stat").read_text();parent_fields=parent_raw[parent_raw.rfind(")")+2:].split()
        if int(raw.split(" ",1)[0])!=procfs_pid or [int(x) for x in status["NSpid"]]!=nspid or int(status["PPid"][0])!=payload["spawnerProcfsPid"] or parent_fields[19]!=payload["spawnerStartTicks"]:
            raise RuntimeError("Mapped Chrome is not the exact spawning Node's child")
        if os.readlink(root/"ns/pid")!=namespace or executable!=os.path.realpath(payload["executable"],strict=True):
            raise RuntimeError("Original Chrome namespace or executable differs")
        pgid=int(status["NSpgid"][depth])
        if pgid!=payload["pid"] or os.getpgid(payload["pid"])!=pgid or int(fields[2])!=procfs_pid:
            raise RuntimeError("Original Chrome is not its exact namespace/procfs process-group leader")
        again=(root/"stat").read_text();again_fields=again[again.rfind(")")+2:].split()
        if again_fields[19]!=fields[19] or poll.poll(0):raise RuntimeError("Original Chrome changed during held-pidfd inspection")
        value={"format":"stellar-forge.hdf5-namespace-process.v2","pid":payload["pid"],"procfsPid":procfs_pid,"startTicks":fields[19],"pgid":pgid,
               "procfsPgid":int(fields[2]),"boot":Path("/proc/sys/kernel/random/boot_id").read_text().strip(),"namespace":namespace,"executable":executable,
               "ownershipProof":"held-pidfd-and-exact-spawner","spawner":{"pid":payload["spawnerPid"],"procfsPid":payload["spawnerProcfsPid"],"startTicks":payload["spawnerStartTicks"],"namespace":namespace}}
        print(json.dumps(value),flush=True)
        command=sys.stdin.readline().strip()
        terminated=bool(poll.poll(0))
        if command!="closed" or not terminated:raise RuntimeError("The exact held-pidfd Chrome has no positive closure")
        print(json.dumps({"pidfdTerminated":True,"pid":payload["pid"],"procfsPid":procfs_pid,"startTicks":fields[19]}),flush=True)
    finally:os.close(fd)

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
    try:
        if len(sys.argv)==3 and sys.argv[1]=="--browser-identity":browser_identity();raise SystemExit(0)
        raise SystemExit(main())
    except Exception as exc:
        sys.stderr.write(json.dumps({"error":type(exc).__name__,"message":str(exc)})+"\n")
        raise SystemExit(1)
