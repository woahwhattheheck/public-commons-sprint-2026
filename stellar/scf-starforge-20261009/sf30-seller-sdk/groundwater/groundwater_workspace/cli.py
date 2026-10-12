"""Groundwater project/source/scenario/native/receiving CLI."""
from __future__ import annotations
import argparse
import json
from pathlib import Path
import sys

sys.dont_write_bytecode=True
from . import Workbench
from .common import Problem, json_text, read_json
from .delivery import inspect_package, receive_package, restore_workspace

def main(argv=None):
    parser=argparse.ArgumentParser(description=__doc__)
    commands=parser.add_subparsers(dest="command",required=True)
    for name in ("init","state","action","serve","execute-run","operation","run","report"):
        item=commands.add_parser(name)
        item.add_argument("--workspace",required=True)
        if name in ("operation","run","report","execute-run"):
            item.add_argument("--id",required=True)
        if name=="init":
            item.add_argument("--workspace-id")
        if name=="state":
            item.add_argument("--project")
        if name=="action":
            item.add_argument("--request",required=True,help="Original JSON request file, or - for stdin")
        if name=="serve":
            item.add_argument("--host",default="127.0.0.1")
            item.add_argument("--port",type=int,default=8892)
        if name=="execute-run":
            item.add_argument("--retry-incomplete",action="store_true")
    for name in ("inspect-package","receive-package","restore"):
        item=commands.add_parser(name)
        item.add_argument("--archive",required=True)
        if name!="inspect-package":
            item.add_argument("--destination",required=True)
    args=parser.parse_args(argv)
    if args.command=="inspect-package":
        result=inspect_package(args.archive)
    elif args.command=="receive-package":
        result=receive_package(args.archive,args.destination)
    elif args.command=="restore":
        result=restore_workspace(args.archive,args.destination)
    else:
        with Workbench(args.workspace,existing_only=args.command!="init",initial_workspace_id=args.workspace_id if args.command=="init" else None) as work:
            if args.command=="init":
                result=work.state()
            elif args.command=="state":
                result=work.state(args.project)
            elif args.command=="action":
                request=json.load(sys.stdin) if args.request=="-" else read_json(args.request)
                result=work.dispatch(request)
            elif args.command=="serve":
                from .server import serve
                return serve(work,args.host,args.port)
            elif args.command=="operation":
                result=work.operation(args.id)
            elif args.command=="run":
                result=work.run_detail(args.id)
            elif args.command=="report":
                result=work.report_detail(args.id)
            elif args.command=="execute-run":
                from .native import launch
                result=launch(work,args.id,retry_incomplete=args.retry_incomplete)
    print(json_text(result),flush=True)
    return 0

def entrypoint():
    try:
        return main()
    except Problem as exc:
        print(json_text({"error":exc.as_dict()}),file=sys.stderr,flush=True)
        return 2
    except (OSError,ValueError,KeyError) as exc:
        print(json_text({"error":{"code":type(exc).__name__,"message":str(exc)}}),file=sys.stderr,flush=True)
        return 1

if __name__ == "__main__":
    sys.exit(entrypoint())
