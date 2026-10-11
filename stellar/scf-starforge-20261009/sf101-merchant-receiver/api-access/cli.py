#!/usr/bin/env python3
"""Merchant commands for purchased API passes; original checkout enrolls payment."""
from __future__ import annotations
import argparse
import json
import os
from pathlib import Path
import re
import signal
import stat
import sys
import tempfile
import threading
import gateway
import pass_store

def private_write(path, data):
    target = Path(path)
    gateway.need(target.is_absolute() and str(target) == os.path.normpath(str(target)),
                 "ABSOLUTE_OUTPUT_PATH_REQUIRED")
    parent = target.parent
    gateway.need(parent.is_dir() and not parent.is_symlink(), "REAL_OUTPUT_DIRECTORY_REQUIRED")
    fd, temporary = tempfile.mkstemp(prefix=".api-pass-", dir=parent)
    try:
        with os.fdopen(fd, "wb") as output:
            os.fchmod(output.fileno(), 0o600)
            output.write(data)
            output.flush()
            os.fsync(output.fileno())
        os.link(temporary, target)
        directory = os.open(parent, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
    except FileExistsError:
        raise gateway.GatewayError("OUTPUT_ALREADY_EXISTS", 409) from None
    finally:
        os.unlink(temporary)
    return str(target)

def private_result(path):
    target = Path(path)
    gateway.need(target.is_absolute(), "PRIVATE_RESULT_PATH_REQUIRED")
    fd = os.open(target, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
    try:
        info = os.fstat(fd)
        gateway.need(stat.S_ISREG(info.st_mode) and not info.st_mode & 0o077
                     and info.st_size <= gateway.MAX_RESPONSE, "PRIVATE_RESULT_FILE_REQUIRED")
        with os.fdopen(fd, "rb", closefd=False) as source:
            body = source.read(gateway.MAX_RESPONSE + 1)
        gateway.need(len(body) == info.st_size and len(body) <= gateway.MAX_RESPONSE,
                     "RECOVERED_RESULT_CHANGED")
        after = os.fstat(fd)
        gateway.need((info.st_ino,info.st_size,info.st_mtime_ns,info.st_ctime_ns) ==
                     (after.st_ino,after.st_size,after.st_mtime_ns,after.st_ctime_ns),
                     "RECOVERED_RESULT_CHANGED")
        return body
    finally:
        os.close(fd)

def output_json(value):
    print(json.dumps(value, indent=2, ensure_ascii=False, allow_nan=False))

def parser():
    p = argparse.ArgumentParser(description="Merchant purchased API passes on original SF101 orders.")
    sub = p.add_subparsers(dest="command", required=True)
    plan = sub.add_parser("plan", help="Write an API allowance contract for original checkout enrollment")
    plan.add_argument("--out", required=True)
    plan.add_argument("--title", required=True)
    plan.add_argument("--allowance", type=int, required=True)
    plan.add_argument("--route", nargs=4, action="append", metavar=("ID","METHOD","PATH","UNITS"), required=True)
    config = sub.add_parser("configure", help="Prepare private gateway configuration")
    for name in ("state","plan","upstream","out"):
        config.add_argument("--"+name, required=True)
    config.add_argument("--query", action="append", default=[])
    config.add_argument("--header-env", nargs=2, action="append", metavar=("HEADER","ENV"), default=[])
    config.add_argument("--actor", default="merchant-operator")
    config.add_argument("--timeout", type=int, default=30)
    serve = sub.add_parser("serve", help="Run API listener and separate private merchant console")
    serve.add_argument("--config", required=True)
    serve.add_argument("--api-port", type=int, default=0)
    serve.add_argument("--console-port", type=int, default=0)
    for name in ("attach","inspect","calls","history","resolve","attach-result","access"):
        command = sub.add_parser(name)
        command.add_argument("--state", required=True)
        command.add_argument("--order", required=True)
        if name == "calls":
            command.add_argument("--after")
            command.add_argument("--limit", type=int, default=100)
        if name in {"history","resolve","attach-result"}:
            command.add_argument("--request-id", required=True)
        if name in {"resolve","attach-result","access"}:
            command.add_argument("--revision", type=int, required=True)
            command.add_argument("--operation-id", required=True)
            command.add_argument("--actor", required=True)
            command.add_argument("--reason", required=True)
        if name in {"resolve","attach-result"}:
            command.add_argument("--status", type=int)
            command.add_argument("--body")
            command.add_argument("--content-type", default="application/octet-stream")
        if name == "resolve":
            command.add_argument("--decision", required=True, choices=("consume","release"))
        if name == "access":
            command.add_argument("--action", required=True,
                choices=("suspend","resume","expire","clear-expiry","rotate-token"))
            command.add_argument("--expires-at")
            command.add_argument("--claim-env")
    listing = sub.add_parser("list")
    listing.add_argument("--state", required=True)
    listing.add_argument("--after")
    listing.add_argument("--limit", type=int, default=100)
    export = sub.add_parser("export", help="Export private pass metadata and usage history")
    for name in ("state","order","out"):
        export.add_argument("--"+name, required=True)
    return p

def main(argv=None):
    args = parser().parse_args(argv)
    if args.command == "plan":
        try:
            routes = [{"id":rid,"method":method,"path":path,"units":int(units)}
                      for rid,method,path,units in args.route]
        except ValueError:
            raise gateway.GatewayError("INVALID_ROUTE_UNITS") from None
        value = pass_store.validate_plan({"schema":pass_store.PLAN_SCHEMA,"title":args.title,
                                         "allowanceUnits":args.allowance,"routes":routes})
        path = private_write(args.out, gateway.encoded(value)+b"\n")
        output_json({"planFile":path,"plan":value})
        return
    if args.command == "configure":
        state = pass_store.receiver.require_private_dir(args.state)
        plan = pass_store.validate_plan(gateway.private_json(args.plan,pass_store.MAX_PLAN_BYTES))
        gateway.upstream_origin(args.upstream)
        gateway.integer(args.timeout,1,120,"INVALID_ROUTE_TIMEOUT")
        gateway.need(isinstance(args.actor,str) and 0 < len(args.actor) <= 120
                     and not any(ord(c)<32 or ord(c)==127 for c in args.actor),"INVALID_ACTOR")
        headers = {}
        for header, variable in args.header_env:
            gateway.need(gateway.HEADER_RE.fullmatch(header) and header.lower() not in gateway.BLOCKED_HEADERS
                         and header.lower() not in {key.lower() for key in headers}
                         and gateway.ENV_RE.fullmatch(variable),"INVALID_HEADER_ENV")
            headers[header] = variable
        gateway.need(len(headers)<=16 and len(args.query)<=64 and len(args.query)==len(set(args.query))
                     and all(re.fullmatch(r"[A-Za-z0-9_.-]{1,80}",q) for q in args.query),
                     "INVALID_QUERY_ALLOWLIST")
        value = {"schema":gateway.CONFIG_SCHEMA,"state":str(state),"actor":args.actor,
            "routes":[{"id":r["id"],"method":r["method"],"path":r["path"],
                       "upstream":args.upstream.rstrip("/"),"query":args.query,
                       "headerEnv":headers,"timeoutSeconds":args.timeout} for r in plan["routes"]]}
        path = private_write(args.out,gateway.encoded(value)+b"\n")
        output_json({"configFile":path,"routes":len(plan["routes"])})
        return
    if args.command == "serve":
        config = gateway.load_config(args.config)
        session = gateway.start(config,api_port=args.api_port,console_port=args.console_port)
        stopping = threading.Event()
        for sig in (signal.SIGINT,signal.SIGTERM):
            signal.signal(sig,lambda *_:stopping.set())
        output_json({"status":"API_PASS_GATEWAY_RUNNING","apiUrl":session["apiUrl"],
                     "privateConsoleUrl":session["consoleUrl"]})
        sys.stdout.flush()
        try:
            stopping.wait()
        finally:
            gateway.stop(session)
        return
    state = pass_store.receiver.require_private_dir(args.state)
    if args.command == "attach":
        result = pass_store.attach_pass(state,args.order)
    elif args.command == "inspect":
        result = pass_store.show_pass(state,args.order)
    elif args.command == "list":
        result = pass_store.list_passes(state,after=args.after,limit=args.limit)
    elif args.command == "calls":
        result = pass_store.list_calls(state,args.order,after=args.after,limit=args.limit)
    elif args.command == "history":
        result = pass_store.call_history(state,args.order,args.request_id)
    elif args.command in {"resolve","attach-result"}:
        body = private_result(args.body) if args.body else None
        common = {"ref":args.order,"request_id":args.request_id,"expected_revision":args.revision,
                  "operation_id":args.operation_id,"actor":args.actor,"reason":args.reason,
                  "status":args.status,"body":body,"content_type":args.content_type}
        if args.command == "resolve":
            result = pass_store.resolve_call(state,decision=args.decision,**common)
        else:
            gateway.need(body is not None and args.status is not None,"RECOVERED_STATUS_AND_BODY_REQUIRED")
            result = pass_store.attach_result(state,**common)
    elif args.command == "access":
        result = pass_store.access.change_access(state,ref=args.order,expected_revision=args.revision,
            operation_id=args.operation_id,actor=args.actor,reason=args.reason,action=args.action,
            expires_at=args.expires_at,token_env=args.claim_env)
    elif args.command == "export":
        result = pass_store.export_pass(state,args.order)
        path = private_write(args.out,gateway.encoded(result)+b"\n")
        result = {"file":path,"orderRef":args.order,"calls":len(result["calls"])}
    else:
        raise gateway.GatewayError("UNKNOWN_COMMAND")
    output_json(result)

if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        code, _ = gateway.error_fields(error)
        print(json.dumps({"ok":False,"error":code}),file=sys.stderr)
        sys.exit(1)
