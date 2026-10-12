#!/usr/bin/env python3
"""MIT. Operate complete ERDDAP source editions and their independent receiver.

Inputs are original complete .erddap.zip captures. This owner retains its exact
selected inputs, original Workspaces, native queries, seller exports and customer
packets through interruption. It performs no provider HTTP acquisition and uses
the unchanged SF30 dataset engine in each Workspace.
"""
from __future__ import annotations
import argparse
import csv
import datetime
import fcntl
import hashlib
import json
import os
from pathlib import Path
import shutil
import signal
import stat
import sys
import tempfile
import zipfile

SCHEMA="stellar-forge.erddap-native-receiving.v1"

def encode(value):
    return (json.dumps(value,ensure_ascii=False,sort_keys=True,separators=(",",":"),allow_nan=False)+"\n").encode()

def digest(path):
    value=hashlib.sha256()
    with Path(path).open("rb") as stream:
        for block in iter(lambda:stream.read(1048576),b""):value.update(block)
    return value.hexdigest()

def identity(path):
    path=Path(path)
    info=path.lstat()
    if not stat.S_ISREG(info.st_mode):raise ValueError("Select an original regular input/output file: "+str(path))
    return {"bytes":info.st_size,"sha256":digest(path)}

def load(path,default=None):
    return json.loads(Path(path).read_text("utf-8")) if Path(path).exists() else default

def atomic(path,value):
    path=Path(path);fd,name=tempfile.mkstemp(prefix="."+path.name+"-",dir=path.parent)
    try:
        with os.fdopen(fd,"wb") as stream:
            os.fchmod(stream.fileno(),0o600);stream.write(encode(value));stream.flush();os.fsync(stream.fileno())
        os.replace(name,path)
        directory=os.open(path.parent,os.O_RDONLY)
        try:os.fsync(directory)
        finally:os.close(directory)
    finally:
        if os.path.exists(name):os.unlink(name)

def private(path):
    path=Path(path).absolute()
    path.mkdir(parents=True,exist_ok=True,mode=0o700)
    info=path.lstat()
    if not stat.S_ISDIR(info.st_mode) or stat.S_ISLNK(info.st_mode):
        raise ValueError("Use an original private regular directory")
    if os.name=="posix" and (info.st_uid!=os.getuid() or info.st_mode&0o077):
        raise ValueError("The operation directory must be private to its owner")
    return path

def retain(path,value):
    path=Path(path)
    if path.exists():
        if load(path)!=value:raise ValueError("The original retained input differs: "+str(path))
    else:atomic(path,value)
    return value

def same_output(source,target):
    source,target=Path(source),Path(target)
    expected=identity(source)
    if target.exists():
        if identity(target)!=expected:raise ValueError("Existing original export differs: "+str(target))
        return {"file":str(target),**expected}
    fd=os.open(target,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600);owned=os.fstat(fd)
    try:
        with os.fdopen(fd,"wb") as out,source.open("rb") as inp:
            shutil.copyfileobj(inp,out,1048576);out.flush();os.fsync(out.fileno())
    except BaseException:
        try:
            now=target.lstat()
            if (now.st_dev,now.st_ino)==(owned.st_dev,owned.st_ino):target.unlink()
        except FileNotFoundError:pass
        raise
    if identity(target)!=expected:raise ValueError("Original export copy differs")
    return {"file":str(target),**expected}

def whole_query(ws,build):
    """Read every original cursor page and retain lexical row content identity."""
    expected=build["rowCount"];params={"limit":"1000"};seen=set();pages=0;rows=0
    value_hash=hashlib.sha256();first=None;fields=None
    while True:
        result=ws.query(build["id"],params)
        if result["response"]["status"]!=200:
            raise ValueError("Original native query failed: "+str(result["response"]["status"]))
        if result["dataset"]["snapshot"]!=build["native"]["snapshot"]:
            raise ValueError("Original native query changed its selected snapshot")
        body=result["response"]["body"]
        if not isinstance(body.get("rows"),list):raise ValueError("Native engine returned no complete row page")
        if fields is None:fields=body.get("fields")
        elif fields!=body.get("fields"):raise ValueError("Native fields changed between original cursor pages")
        if first is None:first={"fields":fields,"rows":body["rows"][:3]}
        pages+=1;rows+=len(body["rows"])
        if rows>expected:raise ValueError("Native cursor repeated rows beyond the selected original edition")
        for row in body["rows"]:value_hash.update(encode(row))
        cursor=(body.get("page") or {}).get("nextCursor")
        if not cursor:break
        if not isinstance(cursor,str) or cursor in seen or not body["rows"]:
            raise ValueError("Original native cursor did not advance")
        seen.add(cursor);params={"limit":"1000","cursor":cursor}
    if rows!=expected:raise ValueError("Native pages do not contain the complete original edition")
    return {"snapshot":build["native"]["snapshot"],"rowCount":rows,"pages":pages,
            "fields":fields,"rowsSha256":value_hash.hexdigest(),"sample":first}

def dataset_export(ws,build,target):
    """Resume the original three-file native export without changing source bytes."""
    target=Path(target)
    if not target.exists():ws.export_dataset(build["id"],target)
    elif not (target/"erddap-lineage.json").exists() or load(target/"erddap-lineage.json").get("schema")!="stellar-forge.erddap-lineage.v1":
        # The original export can finish its native files before lineage writing.
        # Complete only an exact matching partial selection from a fresh export.
        with ws.scratch() as scratch:
            fresh=scratch/"dataset"
            ws.export_dataset(build["id"],fresh)
            expected={"data.csv","dataset.json","erddap-lineage.json"}
            if not set(p.name for p in target.iterdir()).issubset(expected|{"lineage.json"}):
                raise ValueError("Existing native export contains unrelated material")
            for name in ["data.csv","dataset.json"]:
                if not (target/name).exists() or identity(target/name)!=identity(fresh/name):
                    raise ValueError("Incomplete native export differs from the selected original build")
            current=target/"erddap-lineage.json"
            if current.exists():
                if load(current)!=build:raise ValueError("Existing original lineage differs from its native build")
                atomic(current,load(fresh/"erddap-lineage.json"))
            else:same_output(fresh/"erddap-lineage.json",current)
    expected_names={"data.csv","dataset.json","erddap-lineage.json","lineage.json"}
    if not set(p.name for p in target.iterdir()).issubset(expected_names):
        raise ValueError("Native dataset destination contains unrelated material")
    for name in ["data.csv","dataset.json"]:
        if identity(target/name)!=build["files"][name]:
            raise ValueError("Retained native dataset output differs from the completed build")
    lineage=load(target/"erddap-lineage.json")
    if lineage.get("build")!=build["id"] or lineage.get("snapshot")!=build["native"]["snapshot"]:
        raise ValueError("Retained ERDDAP lineage belongs to another source edition")
    return {"directory":str(target),"files":{name:identity(target/name) for name in
            ["data.csv","dataset.json","erddap-lineage.json"]},"project":lineage["project"]}

def packet_members(path):
    with zipfile.ZipFile(path) as archive:
        infos=archive.infolist()
        if len(infos)!=6 or len({x.filename for x in infos})!=6:
            raise ValueError("The complete original customer packet must contain six members")
        result={}
        for info in infos:
            if info.filename.startswith("/") or ".." in Path(info.filename).parts or info.is_dir():
                raise ValueError("Unexpected original customer packet path")
            h=hashlib.sha256()
            with archive.open(info) as stream:
                for block in iter(lambda:stream.read(65536),b""):h.update(block)
            result[info.filename]={"bytes":info.file_size,"sha256":h.hexdigest()}
        return result

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument("--source-root",type=Path,required=True)
    p.add_argument("--operation-root",type=Path,required=True)
    p.add_argument("--workspace",type=Path)
    p.add_argument("--source-packet",type=Path,action="append",default=[])
    p.add_argument("--temporary-root",type=Path)
    p.add_argument("--csv-policy",choices=["require-equivalent","canonical-json"],default="require-equivalent",
                   help="Explicit original JSON/CSV edition decision; both original responses remain retained")
    a=p.parse_args()
    def interrupted(signum,frame):raise KeyboardInterrupt("Original receiving owner interrupted")
    signal.signal(signal.SIGTERM,interrupted)
    source=a.source_root.resolve(strict=True)
    if not(source/"erddap_workspace.py").is_file():raise ValueError("Select the complete maintained ERDDAP source directory")
    operation=private(a.operation_root);output=private(operation/"native")
    original=(a.workspace or operation/"workspace").absolute()
    receiver=operation/"native-receiving-workspace"
    if original.resolve()==receiver.resolve():raise ValueError("Use an independent original receiving workspace")
    lock=(output/"owner.lock").open("a+b");os.fchmod(lock.fileno(),0o600)
    try:fcntl.flock(lock.fileno(),fcntl.LOCK_EX|fcntl.LOCK_NB)
    except BlockingIOError:raise RuntimeError("This retained native receiving operation already has an owner")
    os.environ.setdefault("SF30_XML_NODE",os.environ.get("CODEX_PRIMARY_RUNTIME_NODE") or shutil.which("node") or "node")
    sys.path.insert(0,str(source))
    from erddap_workspace import Workspace
    result_path=output/"native-result.json"
    report=load(result_path,{"schema":SCHEMA,"sources":[],"comparisons":[],"generations":[]})
    if report.get("schema")!=SCHEMA:raise ValueError("Existing native result has another schema")
    generation={"startedAt":datetime.datetime.now(datetime.timezone.utc).isoformat(),"pid":os.getpid(),"state":"starting","csvPolicy":a.csv_policy,
                "sourceFiles":{n:identity(source/n) for n in ["erddap_source.py","erddap_workspace.py","delivery/native-receive.py"]}}
    report["generations"].append(generation)
    report["status"]="RUNNING";atomic(result_path,report)
    temporary=a.temporary_root.resolve(strict=True) if a.temporary_root else private(output/"temporary")
    try:
        with tempfile.TemporaryDirectory(prefix="erddap-native-",dir=temporary) as scratch:
            os.environ["TMPDIR"]=scratch;os.environ["SQLITE_TMPDIR"]=scratch;tempfile.tempdir=scratch
            with Workspace(original,create=not(original/"workspace.json").exists()) as ws:
                inputs=[]
                selected=list(a.source_packet)
                if not selected:
                    selected=[ws.root/"sources"/(s["id"]+".erddap") for s in ws.state()["sources"]]
                if not selected:raise ValueError("Supply actual original captures or reopen a workspace retaining them")
                for path in selected:
                    current=Path(path).absolute();entry=identity(current)
                    if entry["sha256"] in [x["sha256"] for x in inputs]:continue
                    inputs.append({"path":str(current),"name":current.name,**entry})
                retain(output/"input-identities.json",{"schema":SCHEMA,"sources":[{k:x[k] for k in ("bytes","sha256")}for x in inputs]})
                atomic(output/"current-input-paths.json",inputs)
                previous_by_plan={}
                for index,item in enumerate(inputs):
                    prefix=str(index+1).zfill(2);path=Path(item["path"])
                    if identity(path)!={k:item[k]for k in ("bytes","sha256")}:raise ValueError("Original selected capture changed")
                    with path.open("rb")as inp:src=ws.add_source(inp,item["name"],item["name"])
                    # Reinspect the same original bytes with the current source parser; older
                    # retained inventories remain the original acquisition-time observation.
                    with path.open("rb") as current_source:shape=ws.format.inventory(current_source)
                    selected_plan=ws.default_mapping(src["id"],shape["datasetId"]+" original observations")
                    selected_plan["csvPolicy"]=a.csv_policy
                    plan=ws.save_plan(selected_plan)
                    if index<len(report["sources"]) and report["sources"][index]["mapping"]!=plan["id"]:
                        raise ValueError("An already completed source belongs to its original retained mapping; preserve that receiving operation")
                    build=ws.build(src["id"],plan["id"])
                    query=whole_query(ws,build)
                    destination=output/("dataset-"+prefix)
                    dataset=dataset_export(ws,build,destination)
                    packet=ws.export_packet(build["id"],output/("edition-"+prefix+".erddap.zip"))
                    if ws.export_packet(build["id"],Path(packet["file"]))["sha256"]!=packet["sha256"]:
                        raise ValueError("Original same-workspace export retry changed its bytes")
                    entry={"source":src["id"],"datasetId":shape["datasetId"],"publisherId":shape["metadata"].get("publisherId"),
                        "protocol":shape["protocol"],"sourceBytes":src["bytes"],"rowCount":shape["rowCount"],
                        "mapping":plan["id"],"csvPolicy":plan["plan"]["csvPolicy"],"build":build,"query":query,"dataset":dataset,"packet":packet,
                        "packetMembers":packet_members(packet["file"]),"csvComparison":shape["csvComparison"],
                        "selection":shape["selection"],"originalResponses":shape["files"]}
                    same=previous_by_plan.get(plan["id"])
                    if same:
                        comparison=ws.compare(same["id"],build["id"])
                        changes=[];offset=0
                        while True:
                            page=ws.changes(comparison["id"],offset,250)
                            changes.append(page)
                            next_offset=page.get("nextOffset")
                            if next_offset is None:break
                            if not isinstance(next_offset,int) or next_offset<=offset:raise ValueError("Original changes page did not advance")
                            offset=next_offset
                        atomic(output/("comparison-"+prefix+".json"),{"summary":comparison,"pages":changes})
                        if not any(x["id"]==comparison["id"]for x in report["comparisons"]):report["comparisons"].append(comparison)
                    previous_by_plan[plan["id"]]=build
                    if len(report["sources"])<=index:report["sources"].append(entry)
                    else:
                        old=report["sources"][index]
                        if old["source"]!=entry["source"] or old["build"]["id"]!=build["id"]:
                            raise ValueError("Existing receiving checkpoint belongs to another selected edition")
                        report["sources"][index]=entry
                    atomic(result_path,report)
            # Customer reconstruction is the original importer, with a distinct
            # saved workspace and original NativeEngine; source history survives.
            with Workspace(receiver,create=not(receiver/"workspace.json").exists()) as receiving:
                for entry in report["sources"]:
                    packet=entry["packet"]
                    if identity(packet["file"])!={k:packet[k]for k in ("bytes","sha256")}:
                        raise ValueError("Original customer packet changed")
                    accepted=receiving.import_packet(Path(packet["file"]))
                    if accepted["build"]["id"]!=entry["build"]["id"]:
                        raise ValueError("Receiving rebuilt another original edition")
                    query=whole_query(receiving,accepted["build"])
                    if query!=entry["query"]:raise ValueError("Customer's complete original rows differ from the seller edition")
                    entry["receiving"]={"source":accepted["source"],"mapping":accepted["plan"],"build":accepted["build"]["id"],"query":query}
                    atomic(result_path,report)
            with Workspace(receiver) as reopened:
                for entry in report["sources"]:
                    view=reopened.build_view(entry["build"]["id"])
                    query=whole_query(reopened,view)
                    if query!=entry["query"]:raise ValueError("Closed original receiving workspace changed its complete native rows")
                    entry["reopened"]={"snapshot":view["native"]["snapshot"],"rowCount":view["rowCount"],"rowsSha256":query["rowsSha256"]}
            generation.update(state="complete",completedAt=datetime.datetime.now(datetime.timezone.utc).isoformat())
            report.update(status="ERDDAP_NATIVE_RECEIVING_COMPLETE",workspace=str(original),receiverWorkspace=str(receiver))
            atomic(result_path,report)
            print(json.dumps({"status":report["status"],"result":str(result_path),"sources":len(report["sources"]),
                  "observations":sum(x["rowCount"]for x in report["sources"]),"comparisons":len(report["comparisons"])}),flush=True)
    except BaseException as error:
        generation.update(state="failed",error={"type":type(error).__name__,"message":str(error)[:2000]})
        report["status"]="RETAINED_FOR_CONTINUATION"
        atomic(result_path,report)
        raise
    finally:lock.close()

if __name__=="__main__":main()
