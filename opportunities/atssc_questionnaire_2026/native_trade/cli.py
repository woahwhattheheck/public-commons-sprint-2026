#!/usr/bin/env python3
"""Native command and retained JSON-line process for questionnaire operations."""
import argparse
import json
import sys

from questionnaire_workspace import OperationError,Workspace,receive_project


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--workspace",default="questionnaire-workspace")
    commands = parser.add_subparsers(dest="command",required=True)
    invoke = commands.add_parser("invoke")
    invoke.add_argument("method")
    invoke.add_argument("--json",default="{}")
    invoke.add_argument("--input")
    commands.add_parser("rpc")
    receive = commands.add_parser("receive")
    receive.add_argument("archive")
    receive.add_argument("--destination",required=True)
    receive.add_argument("--expected-sha256")
    args = parser.parse_args()
    if args.command == "receive":
        print(json.dumps(receive_project(args.archive,args.destination,args.expected_sha256),ensure_ascii=False))
        return
    workspace = Workspace(args.workspace)
    if args.command == "invoke":
        data = json.loads(open(args.input,encoding="utf-8").read() if args.input else args.json)
        print(json.dumps(workspace.invoke(args.method,data),ensure_ascii=False))
        return
    for line in sys.stdin:
        request = None
        try:
            request = json.loads(line)
            result = workspace.invoke(request["method"],request.get("params",{}))
            response = {"id":request.get("id"),"result":result}
        except Exception as error:
            response = {"id":None if not isinstance(request,dict) else request.get("id"),"error":{"code":getattr(error,"code","OPERATION_ERROR"),"message":str(error),"detail":getattr(error,"detail",None)}}
        print(json.dumps(response,ensure_ascii=False),flush=True)


if __name__ == "__main__":
    try: main()
    except OperationError as error:
        print(json.dumps({"error":{"code":error.code,"message":str(error),"detail":error.detail}}),file=sys.stderr)
        raise SystemExit(2)
