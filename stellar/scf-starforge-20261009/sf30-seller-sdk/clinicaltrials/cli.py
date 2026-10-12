#!/usr/bin/env python3
"""MIT. Whole public-registry capture, review, source receiving and original publishing."""
from __future__ import annotations
import argparse
from contextlib import contextmanager
import os
from pathlib import Path
import shutil
import signal
import sys
import threading
import uuid

from clinical_shared import InputError, json_bytes, load_json, file_digest
from clinical_workspace import Workspace
from clinical_server import OperatorServer, CONTRACTS
from clinical_shared import HERE

@contextmanager
def published_connection(filename,url):
    if filename is None:
        yield
        return
    path=Path(filename).expanduser().absolute()
    data=(url+"\n").encode()
    try:
        fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
    except FileExistsError as error:
        raise InputError("Connection file already exists; use its running console or remove it after that process closes") from error
    try:
        with os.fdopen(fd,"wb") as out:
            out.write(data);out.flush();os.fsync(out.fileno())
        yield
    finally:
        try:
            if path.is_file() and not path.is_symlink() and path.read_bytes()==data:path.unlink()
        except FileNotFoundError:pass

def encoded_input(args):
    if getattr(args,"file",None):return load_json(Path(args.file).read_bytes())
    return load_json(getattr(args,"json","{}") or "{}")

def main(argv=None):
    parser=argparse.ArgumentParser(description="Retain complete ClinicalTrials.gov cohorts, review whole studies and deliver original datasets")
    parser.add_argument("--workspace",required=True,help="Private original workspace directory")
    parser.add_argument("--expected-revision",type=int)
    parser.add_argument("--request-id",help="Original action UUID, preserved when reconciling an uncertain response")
    sub=parser.add_subparsers(dest="command",required=True)
    for command in ["init","status"]:sub.add_parser(command)
    serve=sub.add_parser("serve",help="Open one borrowed browser/MCP console over this workspace")
    serve.add_argument("--port",type=int,default=0);serve.add_argument("--console-url-file")
    configure=sub.add_parser("configure");configure.add_argument("--file",required=True)
    action=sub.add_parser("act",help="Call any original registry, PRS or publisher action")
    action.add_argument("action")
    inputs=action.add_mutually_exclusive_group();inputs.add_argument("--file");inputs.add_argument("--json",default="{}")
    capture=sub.add_parser("capture");capture.add_argument("mode",choices=["start","page","complete","pause","resume","select","status"])
    capture.add_argument("--capture")
    studies=sub.add_parser("studies")
    studies.add_argument("--capture");studies.add_argument("--offset",type=int,default=0)
    studies.add_argument("--limit",type=int,default=50);studies.add_argument("--search",default="")
    study=sub.add_parser("study");study.add_argument("--capture",required=True);study.add_argument("--id",required=True)
    mapping=sub.add_parser("mapping");mapping.add_argument("mode",choices=["default","save"])
    mapping.add_argument("--file");mapping.add_argument("--name",default="Registry review")
    build=sub.add_parser("build");build.add_argument("--capture");build.add_argument("--plan")
    query=sub.add_parser("query");query.add_argument("--build");query.add_argument("--params",default='{"limit":"50"}')
    compare=sub.add_parser("compare");compare.add_argument("--before",required=True);compare.add_argument("--after",required=True)
    export=sub.add_parser("export");export.add_argument("--build");export.add_argument("--out")
    restore=sub.add_parser("restore");restore.add_argument("--file",required=True)
    prs=sub.add_parser("prs");prs.add_argument("mode",choices=["import","inspect","plan","apply","reconcile"])
    prs.add_argument("--file");prs.add_argument("--document");prs.add_argument("--schema",choices=["protocol","results"],default="protocol")
    operation=sub.add_parser("operation");operation.add_argument("id")
    contract=sub.add_parser("contract");contract.add_argument("name",choices=sorted(CONTRACTS));contract.add_argument("--out",required=True)
    args=parser.parse_args(argv)
    ws=Workspace(args.workspace,create=args.command=="init")
    def act(name,payload=None,request_id=None):
        return ws.act(name,payload or {},
            expected_revision=args.expected_revision if args.expected_revision is not None else ws._meta("revision",0),
            request_id=request_id or args.request_id or str(uuid.uuid4()))
    try:
        command=args.command
        if command in {"init","status"}:result=ws.state()
        elif command=="serve":
            server=OperatorServer(ws,args.port)
            stopped=threading.Event()
            previous={}
            def stop(*_):stopped.set()
            for sig in [signal.SIGINT,signal.SIGTERM]:previous[sig]=signal.signal(sig,stop)
            try:
                with published_connection(args.console_url_file,server.url):
                    worker=threading.Thread(target=server.serve_forever,daemon=True);worker.start()
                    print(json_bytes({"url":server.url,"workspace":str(ws.root),"consoleUrlFile":args.console_url_file}).decode(),flush=True)
                    stopped.wait()
                    server.shutdown();worker.join()
            finally:
                server.server_close()
                for sig,handler in previous.items():signal.signal(sig,handler)
            return 0
        elif command=="configure":result=act("cohort.configure",load_json(Path(args.file).read_bytes()))
        elif command=="act":
            result=act(args.action,encoded_input(args))
            if args.action=="publisher.release.start":
                print(json_bytes(result).decode(),flush=True)
                stopped=threading.Event()
                previous={sig:signal.signal(sig,lambda *_:stopped.set()) for sig in [signal.SIGINT,signal.SIGTERM]}
                try:stopped.wait()
                finally:
                    for sig,handler in previous.items():signal.signal(sig,handler)
                return 0
        elif command=="capture":
            payload={"captureId":args.capture} if args.capture else {}
            if args.mode=="status":result=ws.capture_manifest(args.capture)
            elif args.mode=="complete":
                current=ws._capture(args.capture)
                if current["status"] in {"paused","error","starting"}:act("capture.resume",payload)
                try:
                    while ws._capture(args.capture)["status"]=="running":result=act("capture.advance",payload,str(uuid.uuid4()))
                except KeyboardInterrupt:
                    act("capture.pause",payload,str(uuid.uuid4()));raise
                result={"state":ws.state(),"result":ws.capture_manifest(args.capture)}
            else:result=act("capture."+{"page":"advance"}.get(args.mode,args.mode),payload)
        elif command=="studies":result=ws.studies(args.capture,args.offset,args.limit,args.search)
        elif command=="study":result=ws.study(args.capture,args.id)
        elif command=="mapping":
            if args.mode=="default":result=act("mapping.default",{"name":args.name})
            else:
                if not args.file:parser.error("mapping save requires --file")
                result=act("mapping.save",{"plan":load_json(Path(args.file).read_bytes())})
        elif command=="build":result=act("edition.build",{k:v for k,v in {"captureId":args.capture,"planId":args.plan}.items() if v})
        elif command=="query":result=act("dataset.query",{"buildId":args.build or ws._meta("activeBuild"),"query":load_json(args.params)})
        elif command=="compare":result=act("edition.compare",{"beforeId":args.before,"afterId":args.after})
        elif command=="export":
            result=act("package.export",{"buildId":args.build or ws._meta("activeBuild")})
            if args.out:
                destination=Path(args.out).expanduser().absolute()
                shutil.copytree(result["result"]["directory"],destination)
                result["copiedTo"]=str(destination)
        elif command=="restore":
            path=Path(args.file).expanduser().absolute()
            result=act("package.import",{"packagePath":str(path),"sha256":file_digest(path,2*1024*1024*1024)})
        elif command=="prs":
            if args.mode=="inspect":result=ws.prs_document(args.document)
            elif args.mode=="import":
                if not args.file:parser.error("prs import requires --file")
                path=Path(args.file).expanduser().absolute()
                result=act("prs.import",{"path":str(path),"name":path.name,"schema":args.schema,"sha256":file_digest(path,64*1024*1024)})
            else:
                if not args.file:parser.error("PRS reviewed actions require the complete --file request")
                result=act("prs."+args.mode,load_json(Path(args.file).read_bytes()))
        elif command=="operation":result=ws.operation(args.id)
        elif command=="contract":
            target=Path(args.out).expanduser().absolute()
            with (HERE/"contracts"/args.name).open("rb") as inp,os.fdopen(os.open(target,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600),"wb") as out:
                shutil.copyfileobj(inp,out)
            result={"file":str(target),"sha256":file_digest(target,2*1024*1024),"bytes":target.stat().st_size}
        else:raise InputError("Unknown registry command")
        sys.stdout.write(json_bytes(result).decode());return 0
    finally:ws.close()

if __name__=="__main__":
    try:raise SystemExit(main())
    except (InputError,ValueError,OSError) as error:
        sys.stderr.write(str(error)+"\n");raise SystemExit(1)
    except KeyboardInterrupt:raise SystemExit(130)
