#!/usr/bin/env python3
"""Operate the NDTMS adapter through the original Workspace request journal."""
from __future__ import annotations
import argparse, json, os, signal, sys, tempfile, threading
from pathlib import Path
from nelc.common import Problem, Cancelled, canonical, require, check_stop
from nelc.workspace import Workspace
from nelc.ndtms import profile_document, PROFILE_ID

def retained_request(path,request):
    raw=(canonical(request)+"\n").encode("utf-8");path=Path(path).absolute()
    path.parent.mkdir(parents=True,exist_ok=True)
    require(not path.is_symlink(),"REQUEST_FILE","Use an ordinary retained request file.")
    if path.exists():
        require(path.is_file() and path.read_bytes()==raw,"REQUEST_FILE_CONFLICT","Continue the exact original request.")
        return
    fd,temp=tempfile.mkstemp(prefix=".ndtms-request-",dir=path.parent)
    try:
        with os.fdopen(fd,"wb") as stream:stream.write(raw);stream.flush();os.fsync(stream.fileno())
        try:os.link(temp,path)
        except FileExistsError:
            require(not path.is_symlink() and path.is_file() and path.read_bytes()==raw,
                    "REQUEST_FILE_CONFLICT","A concurrent original request differs.")
        directory=os.open(path.parent,os.O_RDONLY)
        try:os.fsync(directory)
        finally:os.close(directory)
    finally:
        try:os.unlink(temp)
        except FileNotFoundError:pass

def main(argv=None,stop=None):
    stop=stop or threading.Event()
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace",help="The original existing NELC workspace; never replaced.")
    sub=parser.add_subparsers(dest="command",required=True)
    sub.add_parser("profile")
    sub.add_parser("blank")
    for action in ("analyse","publish"):
        item=sub.add_parser(action)
        item.add_argument("--data",required=True,help="Complete JSON data using the documented original action shape.")
        item.add_argument("--request-id",required=True)
        item.add_argument("--expected-revision",type=int,required=True)
        item.add_argument("--actor-id",required=True);item.add_argument("--actor-name",required=True)
        item.add_argument("--save-request",required=True)
    status=sub.add_parser("status");status.add_argument("request_id")
    args=parser.parse_args(argv)
    if args.command=="profile":
        document,raw=profile_document();sys.stdout.buffer.write(raw);return 0
    if args.command=="blank":
        document,raw=profile_document()
        import csv,io
        output=io.StringIO(newline="");writer=csv.writer(output,lineterminator="\r\n")
        writer.writerow([f["header"] for f in document["fields"]]);sys.stdout.write(output.getvalue());return 0
    require(args.workspace,"WORKSPACE_REQUIRED","Select the same original existing workspace.")
    workspace=Workspace(args.workspace)
    if args.command=="status":result=workspace.operation(args.request_id)
    else:
        path=Path(args.data);saved=Path(args.save_request)
        identity={"requestId":args.request_id,"expectedRevision":args.expected_revision,
                  "actor":{"id":args.actor_id,"name":args.actor_name},
                  "action":"analyse-ndtms" if args.command=="analyse" else "publish-ndtms"}
        if saved.exists() or saved.is_symlink():
            require(saved.is_file() and not saved.is_symlink(),"REQUEST_FILE","Read the complete regular original saved request.")
            request=json.loads(saved.read_text("utf-8"))
            require(isinstance(request,dict) and set(request)==set(identity)|{"data"}
                    and all(request[k]==v for k,v in identity.items()) and isinstance(request["data"],dict),
                    "REQUEST_FILE_CONFLICT","Continue this same original command, actor, revision and request identity.")
            if path.exists() or path.is_symlink():
                require(path.is_file() and not path.is_symlink(),"DATA_FILE","Read the original ordinary source JSON.")
                require(json.loads(path.read_text("utf-8-sig"))==request["data"],"REQUEST_FILE_CONFLICT","The current source differs from the full retained request.")
        else:
            require(path.is_file() and not path.is_symlink(),"DATA_FILE","Read the complete regular original data JSON on first capture.")
            request={**identity,"data":json.loads(path.read_text("utf-8-sig"))}
        retained_request(args.save_request,request);check_stop(stop);result=workspace.mutate(request,stop)
    print(json.dumps(result,ensure_ascii=False,indent=2));return 0

if __name__=="__main__":
    stop=threading.Event()
    for sig in (signal.SIGINT,signal.SIGTERM):signal.signal(sig,lambda *args:stop.set())
    try:raise SystemExit(main(stop=stop))
    except Problem as error:
        print(json.dumps({"error":error.as_dict()},ensure_ascii=False),file=sys.stderr);raise SystemExit(2)
    except (KeyboardInterrupt,Cancelled):
        print(json.dumps({"error":{"code":"CANCELLED","message":"The original request can be reconciled and resumed."}}),file=sys.stderr);raise SystemExit(130)
