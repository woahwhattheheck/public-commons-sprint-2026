#!/usr/bin/env python3
"""MIT. Complete ERDDAP operator CLI using the original SF30 workspace and dataset engine."""
from __future__ import annotations
import argparse, json, os, stat, sys, tempfile, zipfile
from pathlib import Path
from erddap_workspace import Workspace, InputError, MAX_SOURCE, MAX_PACKET, json_bytes, load_json, atomic
from erddap_source import sha

def object_file(path):
    data=sys.stdin.buffer.read(262145)if path=="-"else Path(path).read_bytes()
    if len(data)>262144:raise InputError("Reviewed JSON input exceeds256KiB")
    value=load_json(data)
    if not isinstance(value,dict):raise InputError("Expected a complete reviewed JSON object")
    return value

def emit(value,out=None):
    data=json_bytes(value)
    if out:
        target=Path(out).absolute()
        if target.exists():
            if target.is_symlink()or target.read_bytes()!=data:raise InputError("Output already contains a different result; preserve it and choose a new file")
        else:
            with os.fdopen(os.open(target,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600),"wb")as f:f.write(data);f.flush();os.fsync(f.fileno())
    else:sys.stdout.buffer.write(data);sys.stdout.buffer.flush()

def save_connection(path,value):
    target=Path(path).absolute();parent=target.parent.resolve(strict=True);info=parent.stat()
    if os.name=="posix"and(info.st_uid!=os.getuid()or info.st_mode&0o077):
        raise InputError("Keep the original capability record in a private operator-owned directory")
    if target.exists()or target.is_symlink():
        info=target.lstat()
        if not stat.S_ISREG(info.st_mode)or info.st_nlink!=1 or os.name=="posix"and(info.st_uid!=os.getuid()or info.st_mode&0o077):
            raise InputError("Existing startup record must be one original private regular file")
        previous=load_json(target.read_bytes())
        if previous.get("schema")!=value["schema"]or previous.get("workspace")!=value["workspace"]:
            raise InputError("Existing connection record belongs to another operator workspace")
    atomic(target,json_bytes(value))

def parser():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument("--workspace",required=True,help="Original private saved workspace")
    sub=p.add_subparsers(dest="action",required=True)
    sub.add_parser("init");sub.add_parser("state")
    a=sub.add_parser("provider-handoff",help="Complete source/provider review, handoff and independent receiving; accepts its own --workspace and --help")
    a.add_argument("arguments",nargs=argparse.REMAINDER)
    a=sub.add_parser("search");a.add_argument("--server",required=True);a.add_argument("--text",default="");a.add_argument("--page",type=int,default=1);a.add_argument("--limit",type=int,default=50)
    a=sub.add_parser("metadata");a.add_argument("--server",required=True);a.add_argument("--dataset",required=True);a.add_argument("--protocol",choices=["griddap","tabledap"],required=True)
    a=sub.add_parser("metadata-read");a.add_argument("--id",required=True)
    a=sub.add_parser("save-query");a.add_argument("--input",required=True);a.add_argument("--out")
    a=sub.add_parser("query-read");a.add_argument("--id",required=True)
    a=sub.add_parser("acquire");a.add_argument("--query",required=True);a.add_argument("--operation",required=True);a.add_argument("--label");a.add_argument("--out")
    a=sub.add_parser("operation");a.add_argument("--id",required=True)
    a=sub.add_parser("source-add");a.add_argument("--file",required=True);a.add_argument("--label")
    a=sub.add_parser("source");a.add_argument("--id",required=True)
    a=sub.add_parser("source-rows");a.add_argument("--id",required=True);a.add_argument("--offset",type=int,default=0);a.add_argument("--limit",type=int,default=100)
    a=sub.add_parser("source-file");a.add_argument("--id",required=True);a.add_argument("--name",required=True);a.add_argument("--out",required=True)
    a=sub.add_parser("mapping");a.add_argument("--source",required=True);a.add_argument("--name");a.add_argument("--out")
    a=sub.add_parser("save-mapping");a.add_argument("--input",required=True);a.add_argument("--out")
    a=sub.add_parser("mapping-read");a.add_argument("--id",required=True)
    a=sub.add_parser("build");a.add_argument("--source",required=True);a.add_argument("--mapping",required=True);a.add_argument("--out")
    a=sub.add_parser("build-read");a.add_argument("--id",required=True)
    a=sub.add_parser("native-query");a.add_argument("--build",required=True);a.add_argument("--params",default="{}")
    a=sub.add_parser("compare");a.add_argument("--before",required=True);a.add_argument("--after",required=True)
    a=sub.add_parser("changes");a.add_argument("--id",required=True);a.add_argument("--offset",type=int,default=0);a.add_argument("--limit",type=int,default=100)
    a=sub.add_parser("export");a.add_argument("--build",required=True);a.add_argument("--out",required=True)
    a=sub.add_parser("export-dataset");a.add_argument("--build",required=True);a.add_argument("--out",required=True)
    a=sub.add_parser("receive");a.add_argument("--file",required=True)
    a=sub.add_parser("serve");a.add_argument("--port",type=int,default=0);a.add_argument("--connection-file")
    return p

def main(argv=None):
    values=list(sys.argv[1:] if argv is None else argv)
    provider=None
    if values and values[0]=="provider-handoff":provider=values[1:]
    elif len(values)>=3 and values[0]=="--workspace" and values[2]=="provider-handoff":provider=values[:2]+values[3:]
    elif len(values)>=2 and values[0].startswith("--workspace=") and values[1]=="provider-handoff":provider=values[:1]+values[2:]
    if provider is not None:
        from provider_handoff_cli import main as provider_main
        return provider_main(provider)
    a=parser().parse_args(values)
    if a.action=="init":
        with Workspace(a.workspace,create=True)as ws:emit({"workspace":str(ws.root),"state":ws.state()})
        return
    with Workspace(a.workspace)as ws:
        action=a.action;out=getattr(a,"out",None)
        if action=="state":result=ws.state()
        elif action=="search":result=ws.search(a.server,a.text,a.page,a.limit)
        elif action=="metadata":result=ws.load_metadata(a.server,a.dataset,a.protocol)
        elif action=="metadata-read":result=ws.metadata_item(a.id)
        elif action=="save-query":result=ws.save_query(object_file(a.input))
        elif action=="query-read":result=ws.query_plan(a.id)
        elif action=="acquire":result=ws.acquire(a.query,a.operation,a.label)
        elif action=="operation":result=ws.operation(a.id)
        elif action=="source-add":
            with Path(a.file).open("rb")as f:result=ws.add_source(f,a.label,Path(a.file).name)
        elif action=="source":result=ws.source(a.id)
        elif action=="source-rows":result=ws.source_rows(a.id,a.offset,a.limit)
        elif action=="source-file":
            raw=ws.source_member(a.id,a.name);target=Path(a.out).absolute()
            if target.exists():
                if target.is_symlink()or target.read_bytes()!=raw:raise InputError("Existing original-source output differs")
            else:
                with os.fdopen(os.open(target,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600),"wb")as f:f.write(raw);f.flush();os.fsync(f.fileno())
            emit({"file":str(target),"bytes":len(raw),"sha256":sha(raw),"source":a.id,"member":a.name});return
        elif action=="mapping":result=ws.default_mapping(a.source,a.name)
        elif action=="save-mapping":result=ws.save_plan(object_file(a.input))
        elif action=="mapping-read":result=ws.plan(a.id)
        elif action=="build":result=ws.build(a.source,a.mapping)
        elif action=="build-read":result=ws.build_view(a.id)
        elif action=="native-query":result=ws.query(a.build,load_json(a.params))
        elif action=="compare":result=ws.compare(a.before,a.after)
        elif action=="changes":result=ws.changes(a.id,a.offset,a.limit)
        elif action=="export":
            target=Path(a.out).absolute()
            if target.exists():
                if target.is_symlink():raise InputError("Select a regular original export")
                with zipfile.ZipFile(target)as z:manifest=load_json(z.read("manifest.json"))
                if manifest.get("build")!=a.build:raise InputError("Existing packet belongs to another selected build")
                recovered=ws.import_packet(target)
                if recovered["build"]["id"]!=a.build:raise InputError("Existing original packet reconstructed a different build")
                result={"file":str(target),"bytes":target.stat().st_size,"sha256":sha(target.read_bytes()),"build":a.build,"replayed":True}
            else:result=ws.export_packet(a.build,target)
            emit(result);return
        elif action=="export-dataset":emit(ws.export_dataset(a.build,Path(a.out)));return
        elif action=="receive":result=ws.import_packet(Path(a.file))
        elif action=="serve":
            from erddap_server import OperatorServer
            server=OperatorServer(ws,a.port)
            try:
                startup=server.startup()
                if a.connection_file:save_connection(a.connection_file,startup)
                emit(startup)
                server.serve_forever(poll_interval=0.25)
            except KeyboardInterrupt:pass
            finally:server.server_close()
            return
        else:raise InputError("Unknown original operator action")
        emit(result,out)

if __name__=="__main__":
    try:main()
    except(InputError,OSError,zipfile.BadZipFile)as e:
        emit({"error":type(e).__name__,"message":str(e),"providerStatus":getattr(e,"provider_status",None),"retryAfter":getattr(e,"retry_after",None)})
        raise SystemExit(1)
