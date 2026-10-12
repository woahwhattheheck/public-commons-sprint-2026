#!/usr/bin/env python3
"""Receive the complete pinned Analysis source into its one original foreground."""
from pathlib import Path
import ast,fcntl,hashlib,json,os,signal,stat,sys,termios,traceback
ROOT=Path("/dev/7de2-analysis-project-opening-20261012")
OPERATION="SCF-ANALYSIS-PROJECT-OPENING-7DE2-20261012"
os.umask(0o077)
def sync(path):
    fd=os.open(path,os.O_RDONLY|os.O_DIRECTORY)
    try:os.fsync(fd)
    finally:os.close(fd)
def private(path):
    missing=[];current=path
    while not os.path.lexists(current):
        missing.append(current);current=current.parent
    for entry in reversed(missing):
        entry.mkdir(mode=0o700);sync(entry);sync(entry.parent)
    info=path.lstat()
    if path.resolve()!=path or not stat.S_ISDIR(info.st_mode) or info.st_uid!=os.geteuid() or info.st_mode&0o077:
        raise ValueError("Use the original private source directory")
    sync(path);sync(path.parent)
def write(path,body):
    if os.path.lexists(path):
        fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW)
        with os.fdopen(fd,"rb") as stream:
            info=os.fstat(stream.fileno())
            if not stat.S_ISREG(info.st_mode) or info.st_nlink!=1 or info.st_uid!=os.geteuid() or stream.read()!=body:
                raise ValueError("Retain the original exact source: "+str(path))
            os.fsync(stream.fileno())
        sync(path.parent);return
    temp=path.with_name("."+path.name+".partial")
    fd=os.open(temp,os.O_WRONLY|os.O_CREAT|os.O_NOFOLLOW,0o600)
    with os.fdopen(fd,"wb") as stream:
        info=os.fstat(stream.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_nlink!=1 or info.st_uid!=os.geteuid():
            raise ValueError("Keep the original source staging file")
        os.ftruncate(stream.fileno(),0);stream.write(body);stream.flush();os.fsync(stream.fileno())
    os.replace(temp,path);sync(path.parent)
def git_blob(raw):
    return hashlib.sha1(b"blob "+str(len(raw)).encode()+b"\0"+raw).hexdigest()
def main():
    size=int(sys.argv[1]);expected=sys.argv[2]
    if not 1<=size<=1024*1024:raise ValueError("Select the complete original source frame")
    terminal=termios.tcgetattr(0) if os.isatty(0) else None
    if terminal:
        raw_settings=termios.tcgetattr(0)
        raw_settings[3]&=~(termios.ICANON|termios.ECHO)
        raw_settings[6][termios.VMIN]=1;raw_settings[6][termios.VTIME]=0
        termios.tcsetattr(0,termios.TCSANOW,raw_settings)
    try:
        print(json.dumps({"state":"SOURCE_FRAME_READY","bytes":size,"git_blob":expected}),flush=True)
        chunks=[];remaining=size
        while remaining:
            part=os.read(0,min(remaining,65536))
            if not part:raise EOFError("Keep the original incomplete source frame")
            chunks.append(part);remaining-=len(part)
        payload=b"".join(chunks)
    finally:
        if terminal:termios.tcsetattr(0,termios.TCSANOW,terminal)
    if git_blob(payload)!=expected:raise ValueError("The complete source frame differs")
    frame=json.loads(payload)
    if frame.get("schema")!="stellar-forge.analysis-original-source-frame.v1" or frame.get("operation")!=OPERATION:
        raise ValueError("Continue the same original Analysis operation")
    sources={}
    for name in ("receiver","driver","publisher","uploader","coordinator","response_sources"):
        body=frame[name].encode()
        if git_blob(body)!=frame["source_blobs"][name]:
            raise ValueError("The selected complete source differs: "+name)
        ast.parse(body.decode());sources[name]=body
    private(ROOT);private(ROOT/"control-source")
    fd=os.open(ROOT/"complete-project.lock",os.O_RDWR|os.O_CREAT|os.O_NOFOLLOW,0o600)
    try:
        info=os.fstat(fd)
        if not stat.S_ISREG(info.st_mode) or info.st_nlink!=1 or info.st_uid!=os.geteuid():
            raise ValueError("Keep the original complete-project lock")
        fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB)
        write(ROOT/"control-source"/"source-frame.json",payload)
        write(ROOT/"control-source"/"complete_project_foreground.py",sources["coordinator"])
        print(json.dumps({"state":"COMPLETE_SOURCE_FRAME_RETAINED","operation":OPERATION,
              "bytes":len(payload),"sha256":hashlib.sha256(payload).hexdigest(),"git_blob":expected,
              "sources":{k:{"bytes":len(v),"sha256":hashlib.sha256(v).hexdigest(),"git_blob":git_blob(v)} for k,v in sources.items()}}),flush=True)
    finally:os.close(fd)
    print("ORIGINAL_FOREGROUND_READY",flush=True)
    if "--run" in sys.argv[3:]:
        os.execv(sys.executable,[sys.executable,"-B",str(ROOT/"control-source"/"complete_project_foreground.py")])
    os.execv("/bin/bash",["bash","--noprofile","--norc"])
if __name__=="__main__":
    try:main()
    except BaseException:
        traceback.print_exc()
        os.execv("/bin/bash",["bash","--noprofile","--norc"])
