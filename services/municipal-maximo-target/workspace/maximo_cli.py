"""Original Workspace Maximo target/read/load receiving commands."""
from __future__ import annotations
import argparse
import json
import os
from pathlib import Path
import stat
import tempfile
from .engine import Workspace
from . import maximo_target as target
from . import maximo_load as loads

def read(path, maximum=16*1024*1024):
    path = Path(path)
    target.need(not path.is_symlink(), "Select an original regular input file")
    with path.open("rb") as stream:
        info = os.fstat(stream.fileno())
        target.need(stat.S_ISREG(info.st_mode) and 0 < info.st_size <= maximum, "Input is not a bounded complete regular file")
        body = stream.read(maximum+1)
    target.need(len(body) == info.st_size and len(body) <= maximum, "Original input changed during its read")
    return body

def save(path, body):
    path = Path(path).absolute()
    path.parent.mkdir(parents=True, exist_ok=True)
    target.need(not path.is_symlink(), "Use a regular output file")
    if path.exists():
        target.need(read(path, maximum=max(len(body),1)) == body, "Preserve the existing differing output; choose a new path")
        return
    fd, tmp = tempfile.mkstemp(prefix=".maximo-output-", dir=path.parent)
    try:
        with os.fdopen(fd,"wb") as stream:
            os.chmod(tmp,0o600);stream.write(body);stream.flush();os.fsync(stream.fileno())
        try: os.link(tmp,path)
        except FileExistsError: target.need(path.read_bytes()==body,"Concurrent output differs")
    finally: Path(tmp).unlink(missing_ok=True)

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace",type=Path,required=True)
    commands=parser.add_subparsers(dest="command",required=True)
    profile=commands.add_parser("profile")
    profile.add_argument("--file",type=Path,required=True)
    show=commands.add_parser("status")
    show.add_argument("--project",required=True)
    capture=commands.add_parser("capture")
    for name in ("project","actor","operation","profile"):capture.add_argument("--"+name,required=True)
    capture.add_argument("--revision",type=int,required=True)
    resume=commands.add_parser("resume")
    resume.add_argument("--operation",required=True)
    receive=commands.add_parser("receive")
    for name in ("project","actor","operation","capture"):receive.add_argument("--"+name,required=True)
    receive.add_argument("--revision",type=int,required=True)
    download=commands.add_parser("export-capture")
    download.add_argument("--operation",required=True);download.add_argument("--output",type=Path,required=True)
    prepare=commands.add_parser("prepare-load")
    for name in ("project","actor","operation","capture"):prepare.add_argument("--"+name,required=True)
    prepare.add_argument("--revision",type=int,required=True);prepare.add_argument("--mapping",type=Path,required=True)
    prepare.add_argument("--output",type=Path,required=True)
    returned=commands.add_parser("receive-load")
    for name in ("project","actor","operation","load"):returned.add_argument("--"+name,required=True)
    returned.add_argument("--result",type=Path,required=True);returned.add_argument("--output",type=Path,required=True)
    args=parser.parse_args()
    workspace=Workspace(args.workspace)
    if args.command=="profile":
        result=target.save_profile(workspace,json.loads(read(args.file,1024*1024)))
    elif args.command=="status":
        result={"profiles":target.profiles(workspace),"captures":target.jobs(workspace,args.project),"loads":loads.list_loads(workspace,args.project)}
    elif args.command=="capture":
        target.prepare(workspace,args.project,args.actor,args.operation,args.revision,args.profile)
        result=target.run(workspace,args.operation)
    elif args.command=="resume":
        result=target.run(workspace,args.operation)
    elif args.command=="receive":
        result=target.receive(workspace,args.project,args.capture,args.revision,args.actor,args.operation)
    elif args.command=="export-capture":
        job=target.load_job(workspace,args.operation)
        target.need(job["state"] in ("READY","RECEIVED"),"Finish the complete original capture before exporting")
        body=target.carrier(workspace,job);save(args.output,body)
        result={"file":str(args.output),"bytes":len(body),"sha256":target.SHA(body)}
    elif args.command=="prepare-load":
        result=loads.prepare(workspace,args.project,args.revision,args.actor,args.operation,args.capture,json.loads(read(args.mapping)))
        body=target.wire(result,maximum=16*1024*1024);save(args.output,body)
        result={"id":result["id"],"rows":len(result["rows"]),"body_sha256":result["body_sha256"],"file":str(args.output)}
    else:
        result=loads.receive(workspace,args.project,args.load,args.operation,args.actor,json.loads(read(args.result)))
        save(args.output,target.wire(result,maximum=16*1024*1024))
    print(target.wire(result,maximum=32*1024*1024).decode())
    if isinstance(result,dict) and result.get("state") in ("REVIEW","DEFERRED"):raise SystemExit(2)

if __name__=="__main__":
    main()
