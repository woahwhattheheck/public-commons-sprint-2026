#!/usr/bin/env python3
"""Continue the original completed Analysis project through full source receiving."""
from __future__ import annotations
import argparse, hashlib, json, os
from contextlib import contextmanager
from pathlib import Path, PurePosixPath
import signal, sqlite3, stat, sys, threading, time, urllib.request, urllib.parse, zipfile

OPERATION = "SCF-ANALYSIS-PROJECT-OPENING-7DE2-20261012"
ORIGINAL_SHA = "41030ce3c6538c21cb9088e839839b889ffd0fb99fff57f417f62cbbd390c53c"
ORIGINAL_BYTES = 201906
WORKSPACE_ID = "5e7e814ca0a4464680168c079b0430bb"
RECEIVE_ORIGINAL = "82e78351199f4a8b8c4d6f9c95fd2881"
EXPORT = "18c5be43c7ed4e2a9871ba8acf210612"
RECEIVE_COMPLETE = "a01cedccfe9c4075a690651b4edf0631"


def encoded(value):
    return (json.dumps(value, ensure_ascii=False, allow_nan=False, sort_keys=True,
                       separators=(",", ":")) + "\n").encode()


def identity(path):
    path = Path(path)
    if path.resolve() != path or not stat.S_ISREG(path.lstat().st_mode):
        raise ValueError("Select the original regular file")
    with path.open("rb") as f:
        before = os.fstat(f.fileno())
        sha = hashlib.file_digest(f, "sha256").hexdigest()
        after = os.fstat(f.fileno())
    if (before.st_dev,before.st_ino,before.st_size,before.st_mtime_ns,before.st_ctime_ns) != (after.st_dev,after.st_ino,after.st_size,after.st_mtime_ns,after.st_ctime_ns):
        raise ValueError("The original selected file changed")
    return {"bytes":before.st_size,"sha256":sha}


def original_sources(archive, expected, directory):
    # Keep the exact archived database separate from the received workspace:
    # later native jobs may legitimately advance that workspace on a retry.
    path=Path(directory)/"original-source-database.sqlite3"
    selected={key:expected[key] for key in ("bytes","sha256")}
    if not os.path.lexists(path):
        with zipfile.ZipFile(archive) as package:
            raw=package.read("workspace/datasets.sqlite3")
        if {"bytes":len(raw),"sha256":hashlib.sha256(raw).hexdigest()}!=selected:
            raise ValueError("The original archived source database differs")
        partial=path.with_name("."+path.name+".partial")
        descriptor=os.open(partial,os.O_WRONLY|os.O_CREAT|os.O_NOFOLLOW,0o600)
        with os.fdopen(descriptor,"wb") as stream:
            info=os.fstat(stream.fileno())
            if not stat.S_ISREG(info.st_mode) or info.st_nlink!=1 or info.st_uid!=os.geteuid():
                raise ValueError("Keep the original source database staging file")
            os.ftruncate(stream.fileno(),0)
            stream.write(raw);stream.flush();os.fsync(stream.fileno())
        os.replace(partial,path)
    if identity(path)!=selected:
        raise ValueError("The original source database changed before source selection")
    descriptor=os.open(path.parent,os.O_RDONLY|os.O_DIRECTORY)
    try:os.fsync(descriptor)
    finally:os.close(descriptor)
    with sqlite3.connect(path.as_uri()+"?mode=ro&immutable=1",uri=True) as db:
        db.execute("PRAGMA trusted_schema=OFF")
        db.execute("PRAGMA query_only=ON")
        return [json.loads(x[0]) for x in db.execute(
            "SELECT record FROM sf_analysis_response_sources ORDER BY name,revision")]


@contextmanager
def defer_stops():
    pending=[]
    previous={n:signal.getsignal(n) for n in (signal.SIGTERM,signal.SIGINT)}
    def defer(number,frame):
        pending.append((number,frame))
    try:
        for number in previous:
            signal.signal(number,defer)
        yield
    finally:
        for number,handler in previous.items():
            signal.signal(number,handler)
        if pending:
            number,frame=pending[0]
            handler=previous[number]
            if callable(handler):
                handler(number,frame)
            elif handler!=signal.SIG_IGN:
                raise SystemExit(128+number)


def close_browser(server,thread,workspace):
    # Preserve the operation's first error while attempting every owned close.
    original_error=sys.exc_info()[1]
    failure=None
    for action in (
        lambda: server.shutdown() if server is not None and thread is not None and thread.is_alive() else None,
        lambda: server.server_close() if server is not None else None,
        lambda: thread.join() if thread is not None and thread.ident is not None else None,
        workspace.close,
    ):
        try:
            action()
        except BaseException as error:
            if failure is None:
                failure=error
    if original_error is None and failure is not None:
        raise failure

def run(args):
    python_source=Path(args.python_source).expanduser().absolute()
    pins_path=Path(args.module_pins).expanduser().absolute()
    pins=json.loads(pins_path.read_bytes())
    if not isinstance(pins,list) or not pins:
        raise ValueError("Select the complete original Python source inventory")
    for row in pins:
        name=row.get("path") if isinstance(row,dict) else None
        if (not isinstance(name,str) or not name or "\\" in name or "\0" in name
                or PurePosixPath(name).is_absolute() or ".." in PurePosixPath(name).parts
                or PurePosixPath(name).as_posix()!=name or not name.endswith(".py")):
            raise ValueError("Use canonical relative Python source paths")
    selected={x["path"] for x in pins}
    if len(selected)!=len(pins):
        raise ValueError("Select each original Python source file once")
    actual={p.relative_to(python_source).as_posix() for p in python_source.rglob("*.py")}
    if actual!=selected:
        raise ValueError("The original complete Python source file set differs")
    for row in pins:
        path=python_source/row["path"]
        if identity(path)!={k:row[k] for k in ("bytes","sha256")}:
            raise ValueError("The selected native module changed: "+row["path"])
    sys.path.insert(0,str(python_source))
    from stellar_forge_buyer.analysis_workspace import AnalysisWorkspace, serve
    from stellar_forge_buyer.response_sources import retain_response, _directory
    from stellar_forge_buyer.workspace_archive import inspect_archive
    from stellar_forge_buyer.workspace_archive_receive import restore_archive
    from stellar_forge_buyer.storage import dump, lock, private_directory, sync_directory
    root=_directory(Path(args.directory).expanduser().absolute())
    archive=Path(args.archive).expanduser().absolute()
    if identity(archive)!={"bytes":ORIGINAL_BYTES,"sha256":ORIGINAL_SHA}:
        raise ValueError("Continue the exact original completed Analysis archive")
    checkout=Path(args.checkout).expanduser().resolve(strict=True)
    node=Path(args.node).expanduser().absolute()
    original=inspect_archive(archive,expected_sha256=ORIGINAL_SHA)
    if original["manifest"]["workspace_id"]!=WORKSPACE_ID:
        raise ValueError("Continue the original Analysis workspace")
    binding={"operation":OPERATION,"original_archive":{"path":str(archive),**identity(archive)},
             "module_inventory":identity(pins_path),"checkout":str(checkout),"node":str(node),
             "node_file":identity(node.resolve()),"workspace_id":WORKSPACE_ID,
             "receiving_id":RECEIVE_ORIGINAL,"archive_id":EXPORT,"customer_receiving_id":RECEIVE_COMPLETE}
    with lock(root):
        intent=root/"operation.json"
        if intent.exists():
            if json.loads(intent.read_bytes())!=binding:
                raise ValueError("Keep the original project-opening source and receiving operation")
            sync_directory(root)
        else:
            dump(intent,binding)
        result_path=root/"result.json"
        if result_path.exists():
            result=json.loads(result_path.read_bytes())
            if result.get("operation")!=OPERATION or result.get("state")!="COMPLETE" or result.get("binding")!=binding:
                raise ValueError("The original complete project result differs")
            output=result["complete_archive"]
            if identity(Path(output["path"]))!={k:output[k] for k in ("bytes","sha256")}:
                raise ValueError("The complete original archive changed")
            # Reopen this same received archive and every original output.
            # This does not reset the customer's later database revisions.
            customer=root/"customer"/"analysis"
            restore_archive(Path(output["path"]),customer,operation=RECEIVE_COMPLETE,
                            expected_sha256=output["sha256"])
            for row in result["original_outputs"]:
                if identity(customer/row["path"])!={k:row[k] for k in ("bytes","sha256")}:
                    raise ValueError("An original received output changed")
            sync_directory(root)
            print(encoded(result).decode(),end="")
            return 0
        source=private_directory(root/"source",create=True)
        working=source/"analysis"
        received=restore_archive(archive,working,operation=RECEIVE_ORIGINAL,expected_sha256=ORIGINAL_SHA)
        original_records=original_sources(archive,original["manifest"]["database"],root)
        workspace=AnalysisWorkspace(working,checkout=checkout,node=str(node))
        retained=[]
        try:
            if workspace.identity!=WORKSPACE_ID:
                raise ValueError("The restored original workspace identity differs")
            for record in original_records:
                retained.append({"name":record["name"],"revision":record["revision"],
                                 **retain_response(working,record,checkout=checkout,node=str(node))})
            review=workspace.archives.review(include_previous_backups=True)
            dump(root/"archive-review.json",review)
            job=workspace.start("workspace-export",{"id":EXPORT,"include_previous_backups":True})
            while job["status"]=="RUNNING":
                time.sleep(0.1)
                job=workspace.job(EXPORT)
            dump(root/"archive-job.json",job)
            if job["status"]!="COMPLETE":
                raise RuntimeError("Continue the original complete archive job: "+str(job.get("error")))
            record=next(x for x in job["result"]["files"] if x["name"]=="workspace.zip")
            complete=Path(job["result"]["directory"])/"workspace.zip"
            if identity(complete)!={k:record[k] for k in ("bytes","sha256")}:
                raise ValueError("The completed native archive differs")
        finally:
            workspace.close()
        inspection=inspect_archive(complete,expected_sha256=record["sha256"])
        receiving_parent=private_directory(root/"customer",create=True)
        customer=receiving_parent/"analysis"
        receiving=restore_archive(complete,customer,operation=RECEIVE_COMPLETE,expected_sha256=record["sha256"])
        same=restore_archive(complete,customer,operation=RECEIVE_COMPLETE,expected_sha256=record["sha256"])
        if not same["reused"]:
            raise ValueError("The same original receiving did not reopen")
        # Verify every original immutable output at the receiving location.
        original_outputs=[]
        for item in original["manifest"]["files"]:
            if item["path"]=="datasets.sqlite3":
                continue
            actual=identity(customer/item["path"])
            if actual!={k:item[k] for k in ("bytes","sha256")}:
                raise ValueError("An original workbook/report/query file changed")
            original_outputs.append({"path":item["path"],**actual})
        opened=[]
        workspace=AnalysisWorkspace(customer,checkout=checkout,node=str(node))
        server=None; thread=None
        try:
            for source_record in original_records:
                selected=workspace.responses._open(source_record)
                with selected.file.open():
                    pass
                selected.check_inputs()
                opened.append({"name":source_record["name"],"revision":source_record["revision"],
                               "source_sha256":selected.sha256,"identity":selected.identity})
            server,control,url=serve(workspace,port=0)
            thread=threading.Thread(target=server.serve_forever,name="original-analysis-browser")
            with defer_stops():
                thread.start()
            address=url.split("#",1)[0]
            with urllib.request.urlopen(address,timeout=10) as response:
                page=response.read(4*1024*1024)
                browser={"status":response.status,"bytes":len(page),
                         "sha256":hashlib.sha256(page).hexdigest(),"path":urllib.parse.urlsplit(address).path,
                         "private_launch":str(control)}
            if browser["status"]!=200:
                raise ValueError("The original received browser did not open")
            state=AnalysisWorkspace.read_state(customer)
        finally:
            close_browser(server,thread,workspace)
        result={"schema":"stellar-forge.analysis-project-opening.v1","operation":OPERATION,
                "state":"COMPLETE","binding":binding,"workspace_id":WORKSPACE_ID,
                "original_receiving":received,"retained_sources":retained,
                "complete_archive":{"path":str(complete),**identity(complete),"id":EXPORT,
                                    "payload_files":len(inspection["manifest"]["files"])},
                "customer_receiving":receiving,"same_receiving":same,"opened_sources":opened,
                "original_outputs":original_outputs,"browser":browser,"customer_state":state}
        dump(result_path,result)
        print(encoded(result).decode(),end="")
        return 0


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--python-source",required=True)
    parser.add_argument("--module-pins",required=True)
    parser.add_argument("--archive",required=True)
    parser.add_argument("--checkout",required=True)
    parser.add_argument("--node",required=True)
    parser.add_argument("--directory",required=True)
    args=parser.parse_args()
    previous={n:signal.getsignal(n) for n in (signal.SIGTERM,signal.SIGINT)}
    def stop(number,frame):
        for selected in previous:
            signal.signal(selected,signal.SIG_IGN)
        raise SystemExit(128+number)
    try:
        for number in previous:
            signal.signal(number,stop)
        raise SystemExit(run(args))
    finally:
        for number,handler in previous.items():
            signal.signal(number,handler)


if __name__=="__main__":
    main()
