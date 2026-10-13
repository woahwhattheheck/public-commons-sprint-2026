"""Complete local staff, source and portable-workspace commands."""
import argparse, contextlib, os, signal, sys, threading
from pathlib import Path
from .common import *
from .workspace import Workspace
from .exchange import export_workspace, receive_archive, validate_archive, source_inventory
from .server import Application
from . import domain, dispatch, field_exchange
from .field_delivery import issue_field, retain_return, field_file, compare_field

def selected_source(root):
    root=Path(root).resolve(strict=True)
    selection=loads(read_regular(root/"source-selection.json",2*1024*1024))
    source_inventory(root,selection)
    return root,selection

def import_capture(workspace,directory,command,expected_revision):
    directory=Path(directory).resolve(strict=True)
    manifest=loads(read_regular(directory/"manifest.json",16*1024*1024))
    require(command.get("kind")=="capture.import" and command["body"]=={"manifest":manifest},"CAPTURE_COMMAND","Retain the complete original capture-import command.")
    require(manifest.get("schema")=="geocove.arcgis-capture.v1","CAPTURE_SCHEMA","Use an original ArcGIS capture.")
    require(manifest.get("sha256")==digest({k:v for k,v in manifest.items() if k!="sha256"}),"CAPTURE_CHANGED","Original capture identity differs.")
    total=0;seen=set()
    for item in manifest["files"]:
        relative=safe_path(item["path"]);require(relative not in seen,"CAPTURE_CHANGED","Repeated source path.");seen.add(relative)
        path=directory/relative
        require(path.resolve(strict=True).is_relative_to(directory) and not path.is_symlink(),"CAPTURE_PATH","Capture source escapes its original directory.")
        require(type(item["bytes"]) is int and 0<=item["bytes"]<=MAX_BLOB,"CAPTURE_CAPACITY","Captured source object exceeds its allowance.")
        total+=item["bytes"];require(total<=MAX_BLOBS,"CAPTURE_CAPACITY","Complete captured sources exceed workspace capacity.")
        require(path.stat().st_size==item["bytes"],"CAPTURE_CHANGED","Captured file size differs.")
    require(total==manifest["bytes"],"CAPTURE_CHANGED","Captured total differs.")
    for item in manifest["files"]:
        raw=read_regular(directory/item["path"])
        require(len(raw)==item["bytes"] and sha(raw)==item["sha256"],"CAPTURE_CHANGED","Captured original bytes differ.")
        workspace.put_blob(raw,item["sha256"])
    return workspace.execute(command,expected_revision)

def main(argv=None):
    p=argparse.ArgumentParser(prog="highway",description="Highway field operations and complete customer receiving")
    p.add_argument("--source-root",default=str(Path(__file__).resolve().parents[1]))
    sub=p.add_subparsers(dest="action",required=True)
    init=sub.add_parser("init");init.add_argument("--workspace",required=True);init.add_argument("--id",required=True);init.add_argument("--title",required=True);init.add_argument("--at",required=True)
    for name in ("state","history","command","import-capture","export","serve"):
        s=sub.add_parser(name);s.add_argument("--workspace",required=True)
        if name=="history":s.add_argument("--offset",type=int,default=0);s.add_argument("--limit",type=int,default=50)
        if name=="command":s.add_argument("--request",required=True)
        if name=="import-capture":s.add_argument("--directory",required=True);s.add_argument("--request",required=True)
        if name=="export":s.add_argument("--publication-id",required=True)
        if name=="serve":s.add_argument("--port",type=int,default=0);s.add_argument("--launch",required=True);s.add_argument("--paired-workspace")
    for name in ("issue-field","retain-field","receive-field","compare-field","download-field"):
        s=sub.add_parser(name);s.add_argument("--workspace",required=True)
        if name in ("issue-field","receive-field"):s.add_argument("--request",required=True)
        if name=="issue-field":
            s.add_argument("--json-output");s.add_argument("--html-output")
        if name in ("retain-field","receive-field"):
            s.add_argument("--file",required=True);s.add_argument("--sha256",required=True);s.add_argument("--bytes",type=int,required=True)
        if name=="compare-field":
            s.add_argument("--return-id",required=True);s.add_argument("--edition-id");s.add_argument("--adoption-id")
        if name=="download-field":
            s.add_argument("--kind",choices=("issues","returns"),required=True)
            s.add_argument("--id",required=True);s.add_argument("--format",choices=("original","json","html"),default="original")
            s.add_argument("--output",required=True)
    inspect=sub.add_parser("inspect");inspect.add_argument("--archive",required=True);inspect.add_argument("--sha256");inspect.add_argument("--bytes",type=int)
    receive=sub.add_parser("receive");receive.add_argument("--archive",required=True);receive.add_argument("--directory",required=True);receive.add_argument("--operation-id",required=True);receive.add_argument("--sha256",required=True);receive.add_argument("--bytes",type=int,required=True)
    args=p.parse_args(argv);root,selection=selected_source(args.source_root)
    python_root=root/"vendor"/"original-paired"/"stellar"/"scf-starforge-20261009"/"sf88-operator-buyer-cli"/"python"
    if python_root.is_dir():sys.path.insert(0,str(python_root))
    if args.action=="inspect":
        result,z,_=validate_archive(args.archive,args.sha256,args.bytes);z.close();return result
    if args.action=="receive":
        return receive_archive(args.archive,args.directory,args.operation_id,args.sha256,args.bytes)
    options={}
    if args.action=="init":options={"create":True,"workspace_id":args.id,"title":args.title,"created_at":args.at}
    with Workspace(args.workspace,**options) as w:
        if args.action=="init":return w.current()
        if args.action=="state":
            current=w.current();return {**current,"view":domain.describe(current["state"],w.read_blob),"dispatch":dispatch.dispatch_view(current["state"],w.read_blob)}
        if args.action=="history":return w.history(args.offset,args.limit)
        if args.action in ("issue-field","receive-field"):
            request=loads(read_regular(args.request,16*1024*1024))
            keys={"workspaceId","workspaceDirectory","expectedRevision","request" if args.action=="issue-field" else "command"}
            require(isinstance(request,dict) and set(request)==keys,"FIELD_REQUEST","Use the complete original branch-bound request.")
            require(request["workspaceId"]==w.current()["state"]["id"] and
                    request["workspaceDirectory"]==str(w.directory),
                    "WORKSPACE_BRANCH_CHANGED","This field request belongs to another physical workspace.")
            if args.action=="issue-field":
                result=issue_field(w,request["request"],request["expectedRevision"],root,selection)
                for output,format in ((args.json_output,"json"),(args.html_output,"html")):
                    if output:
                        raw,_,_=field_file(w,"issues",request["request"]["id"],format)
                        atomic_file(output,raw,immutable=True)
                return result
            raw=read_regular(args.file,MAX_BLOB)
            require(len(raw)==args.bytes and sha(raw)==sha_id(args.sha256),"FIELD_FILE_CHANGED","Original returned-file identity differs.")
            command=request["command"]
            require(command.get("kind")=="field.receive" and
                    command.get("body",{}).get("document")=={"sha256":args.sha256,"bytes":args.bytes},
                    "FIELD_REQUEST","The receiving command must bind the complete selected original file.")
            retained=retain_return(w,raw,args.sha256)
            require(command["body"]["issueId"]==retained["issueId"],"FIELD_REQUEST","Returned issue differs from this request.")
            return w.execute(command,request["expectedRevision"])
        if args.action=="retain-field":
            raw=read_regular(args.file,MAX_BLOB)
            require(len(raw)==args.bytes and sha(raw)==sha_id(args.sha256),"FIELD_FILE_CHANGED","Original returned-file identity differs.")
            return retain_return(w,raw,args.sha256)
        if args.action=="compare-field":
            return compare_field(w,args.return_id,args.edition_id,args.adoption_id)
        if args.action=="download-field":
            raw,media,name=field_file(w,args.kind,args.id,args.format)
            atomic_file(args.output,raw,immutable=True)
            return {"path":str(Path(args.output).absolute()),"filename":name,"mediaType":media,"bytes":len(raw),"sha256":sha(raw)}

        if args.action in ("command","import-capture"):
            request=loads(read_regular(args.request,16*1024*1024))
            require(set(request)=={"expectedRevision","command"},"REQUEST","Use the complete retained request.")
            if args.action=="command":return w.execute(request["command"],request["expectedRevision"])
            return import_capture(w,args.directory,request["command"],request["expectedRevision"])
        if args.action=="export":return export_workspace(w,args.publication_id,root,selection)
        if args.action=="serve":
            app=None;native=None;event=threading.Event();old={}
            try:
                if args.paired_workspace:
                    python_root=root/"vendor"/"original-paired"/"stellar"/"scf-starforge-20261009"/"sf88-operator-buyer-cli"/"python"
                    sys.path.insert(0,str(python_root))
                    from stellar_forge_buyer.duckdb_dataset import DuckDBWorkspace
                    native=DuckDBWorkspace(args.paired_workspace,memory_limit="128MB",threads=1)
                app=Application(w,root,selection,args.port,native_workspace=native);result=app.start()
                atomic_file(args.launch,canonical(result))
                print(canonical({"listening":True,"launch":str(Path(args.launch).absolute()),"workspaceId":result["workspaceId"],"origin":result["origin"]}).decode(),flush=True)
                for sig in (signal.SIGTERM,signal.SIGINT):
                    old[sig]=signal.signal(sig,lambda *_:event.set())
                event.wait()
                return {"closed":True,"workspaceId":result["workspaceId"]}
            finally:
                failures=[]
                if app:
                    try:app.close()
                    except BaseException as error:failures.append(error)
                if native:
                    try:native.close()
                    except BaseException as error:failures.append(error)
                for sig,handler in old.items():
                    try:signal.signal(sig,handler)
                    except BaseException as error:failures.append(error)
                if failures:raise HighwayError("CLOSE_FAILED","Original owner resources did not all close.")
    fail("COMMAND","Unknown command.")
if __name__=="__main__":
    try:print(canonical(main()).decode(),flush=True)
    except Exception as ex:
        print(canonical({"error":{"code":getattr(ex,"code","APPLICATION_ERROR"),"message":str(ex)}}).decode(),flush=True)
        raise SystemExit(1)
