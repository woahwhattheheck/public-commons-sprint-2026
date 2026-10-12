"""MIT. Continue one retained CSAPI acquisition, native edition and customer receive.

The operation uses the maintained Workspace and original SF30 engine. It neither
creates replacement observations nor starts a browser, merchant, signer or payment.
Run the browser owner afterwards against this same closed producer workspace.
"""
from __future__ import annotations
import argparse, contextlib, hashlib, json, os, shutil, stat, sys, tempfile, time
from pathlib import Path

def read_json(path, maximum=1024*1024):
    path=Path(path)
    if path.is_symlink() or not path.is_file() or path.stat().st_size>maximum:
        raise ValueError("Select one complete regular JSON file within its declared capacity")
    raw=path.read_bytes()
    def pairs(items):
        result={}
        for key,value in items:
            if key in result:raise ValueError("Repeated JSON member")
            result[key]=value
        return result
    return json.loads(raw.decode("utf-8"),object_pairs_hook=pairs,
                      parse_constant=lambda value:(_ for _ in ()).throw(ValueError("Non-finite JSON")))

def identity(path, maximum=512*1024*1024):
    path=Path(path)
    with path.open("rb") as stream:
        before=os.fstat(stream.fileno())
        if path.is_symlink() or not stat.S_ISREG(before.st_mode) or before.st_size>maximum:
            raise ValueError("Select one complete regular original file")
        h=hashlib.sha256();count=0
        for block in iter(lambda:stream.read(65536),b""):
            h.update(block);count+=len(block)
            if count>maximum:raise ValueError("Original file exceeds the complete receiving capacity")
        after=os.fstat(stream.fileno())
        if count!=before.st_size or any(getattr(before,k)!=getattr(after,k) for k in ("st_dev","st_ino","st_size","st_mtime_ns","st_ctime_ns")):
            raise ValueError("The original file changed during its complete read")
        return {"bytes":count,"sha256":h.hexdigest()}

def copy_original(source,target,expected):
    source,target=Path(source),Path(target)
    if target.exists():
        if identity(target)!=expected:raise ValueError("Retained output belongs to different original bytes")
        return
    fd,name=tempfile.mkstemp(prefix="."+target.name+".",dir=target.parent)
    try:
        os.chmod(name,0o600)
        with source.open("rb") as inp,os.fdopen(fd,"wb") as out:
            h=hashlib.sha256();count=0
            for block in iter(lambda:inp.read(65536),b""):
                h.update(block);count+=len(block)
                if count>expected["bytes"]:raise ValueError("Original file grew while being retained")
                out.write(block)
            out.flush();os.fsync(out.fileno())
        if {"bytes":count,"sha256":h.hexdigest()}!=expected:raise ValueError("Original file changed while being retained")
        try:os.link(name,target)
        except FileExistsError:
            if identity(target)!=expected:raise ValueError("Concurrent output contains different original bytes")
        if os.name=="posix":
            directory=os.open(target.parent,os.O_RDONLY|os.O_DIRECTORY)
            try:os.fsync(directory)
            finally:os.close(directory)
    finally:
        try:os.unlink(name)
        except FileNotFoundError:pass

@contextlib.contextmanager
def owner_lock(path):
    fd=os.open(path,os.O_RDWR|os.O_CREAT|getattr(os,"O_NOFOLLOW",0),0o600)
    handle=os.fdopen(fd,"r+b",buffering=0)
    try:
        if os.name=="posix":
            import fcntl
            fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB)
        else:
            import msvcrt
            if os.fstat(fd).st_size==0:handle.write(b"\0")
            handle.seek(0);msvcrt.locking(fd,msvcrt.LK_NBLCK,1)
        yield
    finally:handle.close()

def page_native(workspace,build,limit,json_bytes):
    params={"limit":str(limit)}
    rows=0;pages=0;seen=set();cells=hashlib.sha256();first=None;fields=None
    while True:
        response=workspace.query(build["id"],params)
        if response["response"]["status"]!=200 or response["dataset"]["snapshot"]!=build["native"]["snapshot"]:
            raise ValueError("Original native query did not return the selected immutable snapshot")
        body=response["response"]["body"]
        if not isinstance(body.get("rows"),list) or not isinstance(body.get("fields"),list):
            raise ValueError("Original native query omitted fields or rows")
        if fields is None:fields=body["fields"]
        elif fields!=body["fields"]:raise ValueError("Original native fields changed between cursor pages")
        if first is None:first={"fields":body["fields"],"rows":body["rows"][:1]}
        for row in body["rows"]:cells.update(json_bytes(row))
        rows+=len(body["rows"]);pages+=1
        if rows>build["rowCount"] or pages>build["rowCount"]+1:
            raise ValueError("Original native cursor exceeded its retained row count")
        cursor=(body.get("page") or {}).get("nextCursor")
        if not cursor:break
        if cursor in seen:raise ValueError("Original native cursor repeated")
        seen.add(cursor);params={"limit":str(limit),"cursor":cursor}
    if rows!=build["rowCount"]:raise ValueError("The native query did not traverse every original row")
    return {"rows":rows,"pages":pages,"orderedRowsSha256":cells.hexdigest(),
            "fields":fields,"first":first,"snapshot":build["native"]["snapshot"]}

def main(argv=None):
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-root",type=Path,required=True)
    parser.add_argument("--operation-root",type=Path,required=True)
    parser.add_argument("--operation-id",required=True)
    parser.add_argument("--workspace",type=Path,required=True)
    select=parser.add_mutually_exclusive_group(required=True)
    select.add_argument("--source-packet",type=Path,action="append")
    select.add_argument("--source",action="append",help="An original source already in this workspace")
    select.add_argument("--query",help="An exact saved acquisition query in this workspace")
    parser.add_argument("--mapping",type=Path,action="append",default=[],
                        help="Explicit reviewed mappings, in the same order as the selected sources")
    parser.add_argument("--coverage-policy",choices=("require-exhausted","allow-partial"),default="require-exhausted")
    parser.add_argument("--page-size",type=int,default=100)
    parser.add_argument("--node",help="Existing Node binary for the original SF30 engine")
    args=parser.parse_args(argv)
    root=args.source_root.resolve(strict=True)
    if not (root/"csapi_workspace.py").is_file():raise ValueError("Use the complete maintained CSAPI source directory")
    if args.node:os.environ["SF30_XML_NODE"]=str(Path(args.node).resolve(strict=True))
    sys.path.insert(0,str(root))
    import csapi_source
    from csapi_workspace import Workspace,atomic,retained,private_dir,json_bytes,checked_id,operation_id
    operation_id(args.operation_id)
    if not 1<=args.page_size<=10000:raise ValueError("Select a native page size from 1 through 10000")
    operation=private_dir(args.operation_root.expanduser().absolute())
    outputs=private_dir(operation/"native")
    workspace_path=args.workspace.expanduser().absolute()
    if not workspace_path.parent.is_dir():raise ValueError("Select an existing private workspace parent")
    receiver_path=operation/"native-receiving-workspace"
    if workspace_path.resolve()==receiver_path.resolve():raise ValueError("The customer must have its independent retained workspace")
    packets=[]
    for value in args.source_packet or []:
        path=value.resolve(strict=True);packets.append({"path":str(path),**identity(path,csapi_source.MAX_SOURCE)})
    source_ids=args.source or []
    for value in source_ids:checked_id(value)
    if args.query:checked_id(args.query)
    mappings=[]
    for value in args.mapping:
        path=value.resolve(strict=True);raw=read_json(path,65536)
        normalized=csapi_source.validate_plan(raw)
        if normalized["coveragePolicy"]!=args.coverage_policy:
            raise ValueError("An explicit mapping must retain the selected coverage policy")
        mappings.append({"path":str(path),"file":identity(path,65536),"mapping":normalized})
    intent={"schema":"stellar-forge.connected-systems-native-intent.v1","operationId":args.operation_id,
        "workspace":str(workspace_path),"receiverWorkspace":str(receiver_path),
        "sourcePackets":packets,"sourceIds":source_ids,"queryId":args.query,
        "mappings":mappings,"coveragePolicy":args.coverage_policy,"pageSize":args.page_size}
    intent_bytes=json_bytes(intent)
    progress_path=outputs/"native-progress.json"
    with owner_lock(outputs/"native-owner.lock"):
        retained(outputs/"native-intent.json",intent_bytes)
        progress=read_json(progress_path) if progress_path.exists() else {
            "schema":"stellar-forge.connected-systems-native-progress.v1",
            "operationId":args.operation_id,"intentSha256":hashlib.sha256(intent_bytes).hexdigest(),"attempts":[]}
        if progress["operationId"]!=args.operation_id or progress["intentSha256"]!=hashlib.sha256(intent_bytes).hexdigest():
            raise ValueError("The saved native continuation has another original intent")
        complete_status="CONNECTED_SYSTEMS_NATIVE_RECEIVING_COMPLETE"
        if progress.get("status")==complete_status:
            result_path=outputs/"native-result.json"
            if identity(result_path)!=progress.get("result"):
                raise ValueError("The retained complete native result changed")
            result=read_json(result_path,32*1024*1024)
            expected={"schema":"stellar-forge.connected-systems-native-receiving.v1",
                "operationId":args.operation_id,"intentSha256":progress["intentSha256"],
                "producerWorkspace":str(workspace_path),"receiverWorkspace":str(receiver_path),
                "coveragePolicy":args.coverage_policy,"status":complete_status}
            if not isinstance(result,dict) or any(result.get(k)!=v for k,v in expected.items()):
                raise ValueError("The complete native result belongs to another original operation")
            print(json.dumps({"status":complete_status,"result":str(result_path),"replayed":True,
                              "sources":len(result["sources"]),
                              "rows":sum(r["build"]["rowCount"] for r in result["sources"])},
                             ensure_ascii=False),flush=True)
            return result
        attempt={"startedAt":time.time(),"pid":os.getpid(),"state":"starting"}
        progress["attempts"].append(attempt)
        progress["status"]="RUNNING";atomic(progress_path,progress)
        def phase(name,**facts):
            attempt["phase"]=name;attempt["updatedAt"]=time.time()
            progress.update(facts);atomic(progress_path,progress)
            print(json.dumps({"operationId":args.operation_id,"phase":name,**facts},ensure_ascii=False),flush=True)
        try:
            records=[]
            with Workspace(workspace_path,create=not workspace_path.exists()) as workspace:
                selected=[]
                if args.query:
                    phase("original-acquisition",queryId=args.query)
                    query=workspace.query_definition(args.query)
                    acquired=workspace.acquire(args.query,args.operation_id,label=query["name"])
                    retained(outputs/"acquisition.json",json_bytes(acquired))
                    selected=[acquired["source"]["id"]]
                elif packets:
                    for item in packets:
                        if identity(item["path"],csapi_source.MAX_SOURCE)!={k:item[k] for k in ("bytes","sha256")}:
                            raise ValueError("Selected original capture changed before import")
                        with Path(item["path"]).open("rb") as stream:
                            added=workspace.add_source(stream,Path(item["path"]).name,"connected-systems-source.zip")
                        if added["id"]!=item["sha256"]:raise ValueError("Source import changed original capture identity")
                        selected.append(added["id"])
                else:selected=list(source_ids)
                if not selected or len(selected)!=len(set(selected)):
                    raise ValueError("Select unique original source captures")
                if mappings and len(mappings)!=len(selected):
                    raise ValueError("Supply one explicit mapping for each original selected source")
                phase("retained-sources",sourceIds=selected)
                for index,sid in enumerate(selected):
                    original=workspace.source(sid);inventory=original["inventory"]
                    raw_path=workspace.root/"sources"/(sid+".connected-systems")
                    raw_id=identity(raw_path,csapi_source.MAX_SOURCE)
                    if raw_id!={"bytes":original["bytes"],"sha256":sid}:raise ValueError("Original source bytes changed")
                    prefix="source-"+str(index)
                    copy_original(raw_path,outputs/(prefix+".connected-systems.zip"),raw_id)
                    mapping=mappings[index]["mapping"] if mappings else workspace.default_mapping(sid)
                    mapping={**mapping,"coveragePolicy":args.coverage_policy}
                    mapped=workspace.save_plan(mapping)
                    retained(outputs/(prefix+".mapping.json"),json_bytes(mapped["plan"]))
                    phase("native-build",sourceId=sid,planId=mapped["id"])
                    build=workspace.build(sid,mapped["id"])
                    retained(outputs/(prefix+".build.json"),json_bytes(build))
                    if build["rowCount"]!=inventory["rowCount"]:
                        raise ValueError("Native edition did not retain every selected source observation")
                    limit=min(args.page_size,mapped["plan"]["maxLimit"])
                    traversal=page_native(workspace,build,limit,json_bytes)
                    packet=workspace.export_packet(build["id"],outputs/(prefix+".project.zip"))
                    dataset=workspace.export_dataset(build["id"],outputs/(prefix+".dataset"))
                    lineage=dataset["lineage"]
                    if (lineage["build"]!=build["id"] or lineage["snapshot"]!=build["native"]["snapshot"] or
                        lineage["files"]!={name:build["files"][name] for name in ("data.csv","dataset.json")}):
                        raise ValueError("The exported merchant lineage differs from its native build")
                    comparison=workspace.compare(build["id"],build["id"]) if build["keys"] else None
                    if comparison and any(comparison["counts"].get(name,0) for name in ("added","removed","changed")):
                        raise ValueError("Same-edition comparison changed original cells")
                    item={"source":sid,"sourceBytes":original["bytes"],"datastreamId":inventory["datastream"]["id"],
                        "schemaSha256":inventory["schemaSha256"],"coverage":inventory["coverage"],
                        "rights":inventory["rights"],"duplicatePolicy":inventory["duplicates"],
                        "plan":mapped["id"],"coveragePolicy":mapped["plan"]["coveragePolicy"],"build":build,
                        "traversal":traversal,"packet":packet,"dataset":{"directory":dataset["directory"],
                        "lineageSha256":identity(Path(dataset["directory"])/"connected-systems-lineage.json")["sha256"]},
                        "comparison":comparison}
                    records.append(item)
                    retained(outputs/(prefix+".producer.json"),json_bytes(item))
            phase("producer-closed",buildIds=[r["build"]["id"] for r in records])
            received=[]
            with Workspace(receiver_path,create=not receiver_path.exists()) as receiver:
                for index,item in enumerate(records):
                    result=receiver.import_packet(Path(item["packet"]["file"]))
                    if result["source"]!=item["source"] or result["plan"]!=item["plan"] or not result["reconstructed"]:
                        raise ValueError("Independent receiving changed the original source or mapping")
                    build=result["build"]
                    traversal=page_native(receiver,build,min(args.page_size,receiver.plan(item["plan"])["maxLimit"]),json_bytes)
                    if traversal!=item["traversal"]:
                        raise ValueError("Independent receiving changed original native values, order, fields or cursor coverage")
                    exported=receiver.export_packet(build["id"],outputs/("source-"+str(index)+".received-project.zip"))
                    if {k:exported[k] for k in ("bytes","sha256")}!={k:item["packet"][k] for k in ("bytes","sha256")}:
                        raise ValueError("The independent receiver did not re-export the exact original project")
                    receipt={"source":result["source"],"plan":result["plan"],"build":build["id"],
                        "snapshot":build["native"]["snapshot"],"rowCount":build["rowCount"],"traversal":traversal,
                        "packet":exported,"reconstructed":True}
                    received.append(receipt);retained(outputs/("source-"+str(index)+".received.json"),json_bytes(receipt))
            phase("customer-closed",receivedBuilds=[r["build"] for r in received])
            reopened=[]
            with Workspace(receiver_path) as receiver:
                for item in received:
                    build=receiver.build_view(item["build"])
                    page=receiver.query(item["build"],{"limit":"1"})
                    if build["native"]["snapshot"]!=item["snapshot"] or page["response"]["status"]!=200:
                        raise ValueError("Cold customer reopen lost its original native snapshot")
                    body=page["response"]["body"]
                    if {"fields":body["fields"],"rows":body["rows"]}!=item["traversal"]["first"]:
                        raise ValueError("Cold customer reopen changed its original first native row")
                    reopened.append({"build":item["build"],"snapshot":item["snapshot"],"firstRowVerified":True})
            result={"schema":"stellar-forge.connected-systems-native-receiving.v1",
                "operationId":args.operation_id,"intentSha256":progress["intentSha256"],
                "producerWorkspace":str(workspace_path),"receiverWorkspace":str(receiver_path),
                "coveragePolicy":args.coverage_policy,"sources":records,"receiving":received,"coldReopen":reopened,
                "status":"CONNECTED_SYSTEMS_NATIVE_RECEIVING_COMPLETE"}
            retained(outputs/"native-result.json",json_bytes(result))
            attempt.update(state="complete",completedAt=time.time())
            progress["status"]=result["status"];progress["result"]=identity(outputs/"native-result.json")
            atomic(progress_path,progress)
            print(json.dumps({"status":result["status"],"result":str(outputs/"native-result.json"),
                              "sources":len(records),"rows":sum(r["build"]["rowCount"] for r in records)},ensure_ascii=False),flush=True)
            return result
        except BaseException as error:
            attempt.update(state="failed",endedAt=time.time(),error={"type":type(error).__name__,"message":str(error)})
            progress["status"]="RETAINED_FOR_CONTINUATION"
            print(json.dumps({"operationId":args.operation_id,"status":progress["status"],"phase":attempt.get("phase"),
                "error":attempt["error"],"progress":str(progress_path)},ensure_ascii=False),file=sys.stderr,flush=True)
            try:atomic(progress_path,progress)
            except BaseException as persistence_error:
                print(json.dumps({"operationId":args.operation_id,"event":"progress_persistence_failed",
                    "primaryError":attempt["error"],"persistenceError":{"type":type(persistence_error).__name__,
                    "message":str(persistence_error)},"progress":str(progress_path)},
                    ensure_ascii=False),file=sys.stderr,flush=True)
            raise

if __name__=="__main__":
    main()
