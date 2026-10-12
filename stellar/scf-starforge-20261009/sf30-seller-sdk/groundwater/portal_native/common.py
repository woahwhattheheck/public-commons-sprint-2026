"""Private, same-operation files and owned child lifetime for portal receiving."""
from __future__ import annotations
import contextlib
import fcntl
import hashlib
import json
import os
from pathlib import Path
import signal
import stat
import subprocess
import tempfile
import time

class PortalRunError(RuntimeError):
    pass

def require(condition, message):
    if not condition:
        raise PortalRunError(message)

def json_bytes(value):
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False)+"\n").encode("utf-8")

def digest(value):
    return hashlib.sha256(value if isinstance(value,bytes) else json_bytes(value)).hexdigest()

def git_sha(raw):
    return hashlib.sha1(b"blob "+str(len(raw)).encode()+b"\0"+raw).hexdigest()

def info(path):
    path=Path(path)
    fd=os.open(path, os.O_RDONLY|getattr(os,"O_NOFOLLOW",0))
    try:
        before=os.fstat(fd)
        require(stat.S_ISREG(before.st_mode),"A retained input is not a regular file: "+str(path))
        h=hashlib.sha256()
        while data:=os.read(fd,1024*1024):
            h.update(data)
        after=os.fstat(fd)
        current=path.lstat()
        identity=lambda s:(s.st_dev,s.st_ino,s.st_size,s.st_mtime_ns,s.st_ctime_ns)
        require(identity(before)==identity(after)==identity(current),"A retained file changed while reading: "+str(path))
        return {"bytes":before.st_size,"sha256":h.hexdigest()}
    finally:
        os.close(fd)

def verify(path, expected):
    actual=info(path)
    require(actual=={k:expected[k] for k in ("bytes","sha256")},"Original file bytes differ: "+str(path))
    return actual

def read_bytes(path, maximum=67108864):
    path=Path(path)
    fd=os.open(path,os.O_RDONLY|getattr(os,"O_NOFOLLOW",0)|getattr(os,"O_NONBLOCK",0))
    try:
        before=os.fstat(fd)
        require(stat.S_ISREG(before.st_mode) and before.st_size<=maximum,
                "A retained input is not a bounded regular file: "+str(path))
        chunks=[];total=0
        while chunk:=os.read(fd,min(1024*1024,maximum+1-total)):
            chunks.append(chunk);total+=len(chunk)
            require(total<=maximum,"A retained input exceeds its byte bound.")
        after=os.fstat(fd);current=path.lstat()
        identity=lambda s:(s.st_dev,s.st_ino,s.st_size,s.st_mtime_ns,s.st_ctime_ns)
        require(identity(before)==identity(after)==identity(current) and total==before.st_size,
                "A retained input changed while reading: "+str(path))
        return b"".join(chunks)
    finally:
        os.close(fd)

def read(path, maximum=67108864):
    raw=read_bytes(path,maximum)
    def pairs(items):
        result={}
        for k,v in items:
            require(k not in result,"A retained JSON object has duplicate keys.")
            result[k]=v
        return result
    def invalid(value):
        raise PortalRunError("A retained JSON number is not finite: "+value)
    return json.loads(raw.decode("utf-8"),object_pairs_hook=pairs,parse_constant=invalid)

def sync_dir(path):
    fd=os.open(path,os.O_RDONLY|getattr(os,"O_DIRECTORY",0))
    try: os.fsync(fd)
    finally: os.close(fd)

def publish_bytes(path, raw, *, replace=False):
    path=Path(path);path.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
    require(not path.is_symlink(),"A publication path is linked.")
    fd,temporary=tempfile.mkstemp(prefix="."+path.name+".",suffix=".tmp",dir=path.parent)
    try:
        with os.fdopen(fd,"wb") as stream:
            stream.write(raw);stream.flush();os.fsync(stream.fileno())
        if replace:
            os.replace(temporary,path)
        else:
            try: os.link(temporary,path)
            except FileExistsError:
                require(read_bytes(path,max(len(raw),1))==raw,"The original publication already has different bytes: "+str(path))
        sync_dir(path.parent)
    finally:
        Path(temporary).unlink(missing_ok=True)
    return info(path)

def publish(path, value, *, replace=False):
    return publish_bytes(path,json_bytes(value),replace=replace)

def inventory(root, excluded=()):
    root=Path(root);rows=[]
    for p in sorted(root.rglob("*")):
        name=p.relative_to(root).as_posix()
        if name in excluded or name.endswith(".lock") or any(x in ("__pycache__",) or x.endswith(".tmp") for x in p.parts):
            continue
        require(not p.is_symlink(),"A private handover member is linked: "+str(p))
        if p.is_file(): rows.append({"path":name,**info(p)})
    return rows

@contextlib.contextmanager
def owned_lock(path):
    path=Path(path);path.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
    fd=os.open(path,os.O_RDWR|os.O_CREAT|getattr(os,"O_NOFOLLOW",0),0o600)
    try:
        try: fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB)
        except BlockingIOError as exc: raise PortalRunError("The original portal worker or its child is still active.") from exc
        yield fd
    finally:
        # Close without LOCK_UN: an inherited child keeps the same ownership.
        os.close(fd)

class Children:
    def __init__(self, directory, lock_fd, environment):
        self.directory=Path(directory);self.lock_fd=lock_fd;self.environment=environment
        self.children={};self.stopping=False;self.previous={}
    def __enter__(self):
        for sig in (signal.SIGINT,signal.SIGTERM):
            self.previous[sig]=signal.signal(sig,self.request_stop)
        return self
    def request_stop(self,*_):
        self.stopping=True
        for child in list(self.children):
            if child.poll() is None:
                try: os.killpg(child.pid,signal.SIGTERM)
                except ProcessLookupError: pass
    def start(self,name,command,*,cwd=None):
        require(not self.stopping,"The original portal continuation is stopping.")
        self.directory.mkdir(parents=True,exist_ok=True,mode=0o700)
        log=(self.directory/(name+".log")).open("ab",buffering=0)
        try:
            child=subprocess.Popen([str(x) for x in command],cwd=cwd,env=self.environment,
                stdin=subprocess.DEVNULL,stdout=log,stderr=subprocess.STDOUT,
                pass_fds=(self.lock_fd,),start_new_session=True)
        except BaseException:
            log.close()
            raise
        self.children[child]=log
        print(json.dumps({"phase":name,"pid":child.pid,"state":"running"}),flush=True)
        return child
    def wait(self,child,name,*,timeout=1800):
        deadline=time.monotonic()+timeout
        while child.poll() is None and time.monotonic()<deadline and not self.stopping:
            time.sleep(.2)
        if child.poll() is None:
            self.close(child)
            raise PortalRunError("The original "+name+" stopped or exceeded its bounded time; inspect its retained log.")
        result=child.returncode
        self._finished(child)
        require(result==0,"The original "+name+" exited "+str(result)+"; inspect its retained log.")
        print(json.dumps({"phase":name,"state":"complete","exit_code":result}),flush=True)
    def run(self,name,command,*,cwd=None,timeout=1800):
        self.wait(self.start(name,command,cwd=cwd),name,timeout=timeout)
    def _finished(self,child):
        log=self.children.pop(child,None)
        if log: log.close()
    def close(self,child):
        if child not in self.children: return
        if child.poll() is None:
            try: os.killpg(child.pid,signal.SIGTERM)
            except ProcessLookupError: pass
            try: child.wait(timeout=30)
            except subprocess.TimeoutExpired:
                try: os.killpg(child.pid,signal.SIGKILL)
                except ProcessLookupError: pass
                child.wait(timeout=30)
        self._finished(child)
    def __exit__(self,*_):
        for child in list(self.children): self.close(child)
        for sig,old in self.previous.items(): signal.signal(sig,old)

def verify_archive(path, expected):
    import zipfile
    verify(path,expected)
    with zipfile.ZipFile(path) as archive:
        names=[r.filename for r in archive.infolist()]
        require(len(names)==len(set(names)),"A private archive member is ambiguous.")
        manifest=json.loads(archive.read("manifest.json"))
        require(set(names)=={"manifest.json",*(r["path"] for r in manifest["files"])},
                "The original private archive member set changed.")
        for row in manifest["files"]:
            entry=archive.getinfo(row["path"])
            require(entry.file_size==row["bytes"],"A private archive member size changed.")
            h=hashlib.sha256()
            with archive.open(entry) as stream:
                while raw:=stream.read(1024*1024): h.update(raw)
            require(h.hexdigest()==row["sha256"],"A private archive member changed: "+row["path"])
    verify(path,expected)
    return manifest
