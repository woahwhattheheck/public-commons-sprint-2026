#!/usr/bin/env python3
"""MIT. Complete utility receiving, review, native dataset and customer operator."""
from __future__ import annotations
import argparse
from contextlib import contextmanager
import json
import os
from pathlib import Path
import signal
import stat
import sys
import tempfile
import threading
import time

from utility_workspace import Workspace
from utility_server import OperatorServer
from utility_shared import InputError,load_json,private_write,json_bytes
from utility_delivery import copy_private

@contextmanager
def connection_file(filename,url):
    if not filename:
        yield;return
    target=Path(filename).expanduser().absolute()
    descriptor,name=tempfile.mkstemp(prefix="."+target.name+"-",dir=target.parent)
    staging=Path(name);data=(url+"\n").encode()
    try:
        with os.fdopen(descriptor,"wb") as out:
            os.chmod(staging,0o600);out.write(data);out.flush();os.fsync(out.fileno())
        os.link(staging,target,follow_symlinks=False)
    except FileExistsError as error:
        raise InputError("The selected connection file already belongs to an operator") from error
    finally:staging.unlink(missing_ok=True)
    try:yield
    finally:
        try:
            if stat.S_ISREG(target.lstat().st_mode) and target.read_bytes()==data:target.unlink()
        except FileNotFoundError:pass

def read_object(filename):
    value=load_json(Path(filename).read_bytes())
    if not isinstance(value,dict):raise InputError("Use a complete JSON operation object")
    return value

def main(argv=None):
    parser=argparse.ArgumentParser(description="Receive original UtilityAPI and Green Button sources, review intervals and deliver the native customer workspace")
    parser.add_argument("--workspace",required=True,help="Original private workspace directory")
    sub=parser.add_subparsers(dest="command",required=True)
    for name in ("init","status","operations"):sub.add_parser(name)
    incoming=sub.add_parser("import");incoming.add_argument("--file",required=True)
    incoming.add_argument("--name");incoming.add_argument("--provider",default="auto",choices=("auto","utilityapi","greenbutton"))
    incoming.add_argument("--kind",default="auto");incoming.add_argument("--context",default="{}")
    record=sub.add_parser("records");record.add_argument("--kind",default="interval")
    record.add_argument("--imports");record.add_argument("--meter");record.add_argument("--series")
    record.add_argument("--offset",type=int,default=0);record.add_argument("--limit",type=int,default=100);record.add_argument("--full",action="store_true")
    inspect=sub.add_parser("inspect");inspect.add_argument("--type",required=True,choices=("imports","previews","reviews","reconciliations","captures","record","operation"))
    inspect.add_argument("--id",required=True)
    preview=sub.add_parser("preview");preview.add_argument("--selection",required=True)
    review=sub.add_parser("review");review.add_argument("--file",required=True)
    build=sub.add_parser("build");build.add_argument("--review",required=True)
    query=sub.add_parser("query");query.add_argument("--build");query.add_argument("--params",default='{"limit":"100"}')
    compare=sub.add_parser("compare");compare.add_argument("--before",required=True);compare.add_argument("--after",required=True)
    changes=sub.add_parser("changes");changes.add_argument("--id",required=True);changes.add_argument("--offset",type=int,default=0);changes.add_argument("--limit",type=int,default=100)
    reconcile=sub.add_parser("reconcile");reconcile.add_argument("--review",required=True);reconcile.add_argument("--links",default="{}")
    collect=sub.add_parser("collect");collect.add_argument("--configuration");collect.add_argument("--capture")
    collect.add_argument("--one-page",action="store_true",help="Advance once and return the retained continuation")
    capture=sub.add_parser("capture");capture.add_argument("action",choices=("advance","pause","resume"));capture.add_argument("--id",required=True)
    merchant=sub.add_parser("merchant");merchant.add_argument("--terms",required=True)
    export=sub.add_parser("export");export.add_argument("--review",required=True);export.add_argument("--out",required=True)
    portable=sub.add_parser("portable");portable.add_argument("--out",required=True)
    restore=sub.add_parser("restore");restore.add_argument("--file",required=True);restore.add_argument("--sha256")
    action=sub.add_parser("action");action.add_argument("--file",required=True)
    serve=sub.add_parser("serve");serve.add_argument("--port",type=int,default=0)
    serve.add_argument("--connection-file");serve.add_argument("--startup-format",choices=("legacy","json"),default="legacy")
    args=parser.parse_args(argv)
    with Workspace(args.workspace,create=args.command=="init") as ws:
        def act(name,payload):
            return ws.act(name,payload,ws.meta("revision",0))["result"]
        command=args.command
        if command in {"init","status"}:result=ws.state()
        elif command=="operations":result={"operations":ws.all("actions")}
        elif command=="import":
            path=Path(args.file).expanduser().absolute()
            result=act("source.import",{"path":str(path),"name":args.name or path.name,
                "provider":args.provider,"kind":args.kind,"context":load_json(args.context)})
        elif command=="records":
            result=ws.records(args.kind,import_ids=args.imports.split(",") if args.imports else None,
                meter=args.meter,series=args.series,offset=args.offset,limit=args.limit,full=args.full)
        elif command=="inspect":
            result=ws.record(args.id) if args.type=="record" else ws.operation(args.id) if args.type=="operation" else ws.saved(args.type,args.id)
        elif command=="preview":result=act("analysis.preview",read_object(args.selection))
        elif command=="review":result=act("review.save",read_object(args.file))
        elif command=="build":result=act("edition.build",{"review_id":args.review})
        elif command=="query":result=act("dataset.query",{"build_id":args.build or ws.meta("active_build"),"query":load_json(args.params)})
        elif command=="compare":result=act("edition.compare",{"before_id":args.before,"after_id":args.after})
        elif command=="changes":result=ws.comparison_page(args.id,args.offset,args.limit)
        elif command=="reconcile":result=act("bills.reconcile",{"review_id":args.review,"bill_series":load_json(args.links)})
        elif command=="capture":result=act("capture."+args.action,{"capture_id":args.id})
        elif command=="collect":
            if bool(args.configuration)==bool(args.capture):raise InputError("Choose a new collection configuration or an existing capture")
            current=act("capture.start",read_object(args.configuration)) if args.configuration else ws.saved("captures",args.capture)
            while current["status"] in {"running","waiting"}:
                if current["status"]=="waiting":
                    from datetime import datetime,timezone
                    retry=current.get("retry_at")
                    if retry:
                        seconds=(datetime.fromisoformat(retry.replace("Z","+00:00"))-datetime.now(timezone.utc)).total_seconds()
                        if seconds>0:
                            print(json.dumps({"capture_id":current["id"],"status":"waiting","retry_at":retry}),file=sys.stderr,flush=True)
                            time.sleep(min(seconds,30));continue
                current=act("capture.advance",{"capture_id":current["id"]})
                print(json.dumps({"capture_id":current["id"],"status":current["status"],
                    "received_pages":len(current.get("pages",[]))}),file=sys.stderr,flush=True)
                if args.one_page:break
            result=current
        elif command=="merchant":result=act("merchant.configure",read_object(args.terms))
        elif command=="export":
            exported=act("package.export",{"review_id":args.review})
            result=ws.export_zip(exported["id"],Path(args.out).expanduser().absolute())
            result={**result,"path":str(result["path"]),"export":exported}
        elif command=="portable":
            path=Path(args.out).expanduser().absolute();manifest=ws.portable(path)
            result={"path":str(path),"files":len(manifest["files"])}
        elif command=="restore":
            with ws.scratch() as temp:
                path=temp/"incoming.zip";copy_private(Path(args.file).expanduser().absolute(),path)
                payload={"path":str(path)}
                if args.sha256:payload["sha256"]=args.sha256
                result=act("package.restore",payload)
        elif command=="action":
            value=read_object(args.file)
            result=ws.act(value["action"],value.get("payload"),value.get("expected_revision"),value.get("request_id"))
        elif command=="serve":
            server=OperatorServer(ws,args.port)
            previous={}
            def stop(_signum,_frame):threading.Thread(target=server.shutdown,daemon=True).start()
            for sig in (signal.SIGINT,signal.SIGTERM):
                previous[sig]=signal.signal(sig,stop)
            try:
                with connection_file(args.connection_file,server.url):
                    print(json.dumps({"schema":"stellar-forge.utility-startup.v1","url":server.url,"pid":os.getpid(),
                        "workspace":str(ws.root)}) if args.startup_format=="json" else server.url,flush=True)
                    try:server.serve_forever(poll_interval=0.2)
                    finally:server.server_close()
            finally:
                for sig,handler in previous.items():signal.signal(sig,handler)
            return
        else:raise InputError("Unknown utility command")
        print(json.dumps(result,ensure_ascii=False,allow_nan=False,separators=(",",":")),flush=True)

if __name__=="__main__":
    try:main()
    except (InputError,ValueError,OSError) as error:
        print(str(error),file=sys.stderr);sys.exit(1)
