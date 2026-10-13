#!/usr/bin/env python3
"""Continue the original complete Chinook source inside the Definian programme."""
import argparse, base64, datetime, fcntl, gzip, hashlib, json, os, pathlib, runpy, shutil, stat, sys, traceback, uuid

COMMIT = "7f67772503d71ba90f19283c38e93923addb43fa"
PACKET_BYTES = 3490342
PACKET_SHA = "239983242c3578f959c559b1bc68c6a69ff0e4d7f55aa2e13df5cf0bbfbf1799"
SOURCE_PINS = {
 "reference/receive_reference.py": (17775, "07ce2b2936209a12273ba923c8819de81ef2e3624d1cdea36d1e6b8bc407a0f3"),
 "reference/SOURCE_SELECTION.json": (2935, "fb753e746297be210e0e711ed9cd13cfeae1de91514173333f51d47d94fcf537"),
 "reference/SOURCE_CONTROL_BASELINE.json": (175158, "36bb637d03eb3100750047e9b76691eb255c89ecd42b756f7e0e8a6fa16b512b"),
 "reference/MIGRATION_SOURCE_AND_ACCEPTANCE.md": (14819, "fd0124616d0d0a7e22014880f759f418b1ed0f66de75cd81932b68c16e28151c"),
 "reference/UPSTREAM_LICENSE.md": (1117, "5064d720db431474b0a0b0cef9d2b5e362b6c6f80602b35c6443b07cbc979f77"),
}

def now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()
def sha(body):
    return hashlib.sha256(body).hexdigest()
def encoded(value):
    return (json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False)+"\n").encode()
def safe(name):
    if not isinstance(name,str) or not name or "\\" in name or name.startswith("/") or any(x in ("",".","..") for x in name.split("/")):
        raise ValueError("Unsafe original relative source path")
    return name
def ordinary(path):
    path=pathlib.Path(path)
    if path.is_symlink() or not path.is_file() or path.resolve()!=path.absolute():
        raise ValueError("Select an ordinary original file: "+str(path))
    before=path.stat(); body=path.read_bytes(); after=path.stat()
    if (before.st_dev,before.st_ino,before.st_size,before.st_mtime_ns,before.st_ctime_ns)!=(after.st_dev,after.st_ino,after.st_size,after.st_mtime_ns,after.st_ctime_ns):
        raise ValueError("Original source changed during complete read")
    return body
def check(path,length,digest):
    body=ordinary(path)
    if len(body)!=length or sha(body)!=digest:
        raise ValueError("Complete original source identity differs: "+str(path))
    return body
def sync_dir(path):
    fd=os.open(path,os.O_RDONLY)
    try: os.fsync(fd)
    finally: os.close(fd)
def put(path,body,immutable=False):
    path=pathlib.Path(path); path.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
    if path.exists() or path.is_symlink():
        if immutable:
            if ordinary(path)!=body: raise ValueError("Retained original bytes differ: "+str(path))
            return
        ordinary(path)
    temp=path.with_name(path.name+".pending-"+uuid.uuid4().hex)
    fd=os.open(temp,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
    try:
        with os.fdopen(fd,"wb") as f: f.write(body); f.flush(); os.fsync(f.fileno())
        os.replace(temp,path); sync_dir(path.parent)
    finally:
        if temp.exists(): temp.unlink()
def validate_received(directory):
    raw=ordinary(directory/"DELIVERY_MANIFEST.json"); manifest=json.loads(raw)
    if manifest.get("schema")!="commons.complete-original-source-delivery.v1" or manifest.get("sourceCommit")!=COMMIT:
        raise ValueError("Original complete source manifest differs")
    paths=set()
    for f in manifest["files"]:
        name=safe(f["path"])
        if name in paths: raise ValueError("Repeated original source member")
        paths.add(name); check(directory/name,f["bytes"],f["sha256"])
    result=json.loads(ordinary(directory/"SOURCE_RECEIVING_RESULT.json"))
    if result.get("operationId")!=manifest["operationId"] or result.get("status")!="SOURCE_RECEIVED" or result.get("totalRows")!=15607:
        raise ValueError("The complete original SQLite source is not ready")
    if result.get("unexpectedDifferenceCount") or result.get("foreignKeyViolationCount") or result.get("unbalancedInvoiceCount") or result.get("integrityCheck")!=["ok"]:
        raise ValueError("The original source has unresolved measured findings")
    return {"directory":str(directory),"operationId":manifest["operationId"],"rows":result["totalRows"],
            "manifest":{"bytes":len(raw),"sha256":sha(raw)},"result":result}
def completed_source(state,result,adopted=False):
    """Publish the same verified original completion, including its prior attempt."""
    attempts=state.get("attempts")
    if not isinstance(attempts,list) or not attempts:
        raise ValueError("Completed source lacks its original saved receiving attempt")
    attempt=attempts[-1]
    if attempt.get("sourceOperationId") not in (None,result["operationId"]):
        raise ValueError("Completed source belongs to another original receiving attempt")
    if attempt.get("state")!="complete":
        recovered={"observedAt":now(),"previousState":attempt.get("state"),
          "sourceOperationId":result["operationId"],"manifest":result["manifest"]}
        if "error" in attempt:
            recovered["previousError"]=attempt.pop("error")
        if adopted:
            attempt.setdefault("completionRecovery",recovered)
        attempt.update(state="complete",completedAt=result["result"]["completedAt"],
                       sourceOperationId=result["operationId"])
    else:
        if attempt.get("sourceOperationId")!=result["operationId"]:
            raise ValueError("Saved completed attempt does not bind the original source")
    state.update(status="complete",result=result)
    state.setdefault("completedAt",result["result"]["completedAt"])
    return result

def finish_preservation(root,state,state_path):
    """Finish only the saved rename of one closed incomplete source directory."""
    intent=state.get("pendingPreservation")
    if intent is None:
        return
    attempts=state.get("attempts",[])
    attempt=next((value for value in attempts if value.get("id")==intent.get("attemptId")),None)
    if attempt is None or intent.get("source")!="received":
        raise ValueError("Original source preservation intent changed")
    index=attempts.index(attempt)+1
    expected="prior-attempts/source-"+str(index).zfill(4)
    if intent.get("directory")!=expected or set(intent.get("directoryIdentity",{}))!={"device","inode"}:
        raise ValueError("Original source preservation destination changed")
    origin=root/"received"; target=root/expected
    def present(path):
        return path.exists() or path.is_symlink()
    def verify_directory(path):
        if path.is_symlink() or not path.is_dir() or path.resolve()!=path.absolute():
            raise ValueError("The original incomplete source directory changed")
        selected=path.stat()
        if {"device":selected.st_dev,"inode":selected.st_ino}!=intent["directoryIdentity"]:
            raise ValueError("The original incomplete source directory identity changed")
    if present(origin) and present(target):
        raise ValueError("Both source preservation paths exist; retain them for reconciliation")
    if present(origin):
        verify_directory(origin)
        target.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
        if target.parent.resolve()!=target.parent.absolute() or target.parent.is_symlink():
            raise ValueError("Original preserved source parent changed")
        os.rename(origin,target); sync_dir(target.parent); sync_dir(root)
    elif not present(target):
        raise ValueError("Both original source preservation paths are absent")
    verify_directory(target)
    receipt={"attemptId":attempt["id"],"directory":expected,
      "preservedAt":intent["selectedAt"],"directoryIdentity":intent["directoryIdentity"]}
    rows=state.setdefault("retainedPriorAttempts",[])
    existing=[row for row in rows if row.get("directory")==expected]
    if existing and (len(existing)!=1 or existing[0]!=receipt):
        raise ValueError("Original source preservation receipt changed")
    if not existing:
        rows.append(receipt)
    if attempt.get("state")=="running":
        attempt.update(state="interrupted",completedAt=intent["selectedAt"],
          interruption="Original source owner ended before complete source publication")
    attempt["preservedDirectory"]=expected
    state.pop("pendingPreservation")
    put(state_path,encoded(state))

def inherited_runtime_lease(root):
    """Validate and retain the original runtime's inherited open-file lease."""
    value=os.environ.get("DLT_WORKSHARE_OPERATION_LOCK_FD")
    if value is None or not value.isdigit() or int(value)<3:
        raise ValueError("Use the original verified runtime wrapper for this source operation")
    fd=int(value); path=root/"lifetime.lock"
    if os.environ.get("DLT_WORKSHARE_OPERATION_LOCK_PATH")!=str(path):
        raise ValueError("The inherited original operation lease belongs to another path")
    actual=os.fstat(fd); selected=os.stat(path,follow_symlinks=False)
    if (not stat.S_ISREG(actual.st_mode) or not stat.S_ISREG(selected.st_mode)
            or (actual.st_dev,actual.st_ino)!=(selected.st_dev,selected.st_ino)):
        raise ValueError("The inherited lease does not select this exact original lock")
    # This is the inherited open file description, never a second opened lease.
    # It stays open until this original child exits, including after parent loss.
    fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB)
    return fd

def run(args):
    source=pathlib.Path(args.source).absolute(); root=pathlib.Path(args.directory).absolute()
    if source.resolve()!=source: raise ValueError("Use the exact original source root")
    root.mkdir(parents=True,exist_ok=True,mode=0o700)
    if root.resolve()!=root or root.is_symlink(): raise ValueError("Use one owned ordinary operation directory")
    inherited_runtime_lease(root)
    lock=os.open(root/"original-source.lock",os.O_RDWR|os.O_CREAT,0o600)
    try:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        selected=[]
        for name,(length,digest) in SOURCE_PINS.items():
            check(source/name,length,digest); selected.append({"path":name,"bytes":length,"sha256":digest})
        ready_body=ordinary(pathlib.Path(args.runtime_ready).absolute()); ready=json.loads(ready_body)
        if ready["python"]["executable"]!=sys.executable:
            raise ValueError("Use the selected original runtime Python invocation")
        cohort_raw=ordinary(source/"reference/CHINOOK_SOURCE_COHORT.json"); cohort=json.loads(cohort_raw)
        if cohort.get("schema")!="commons.complete-source.gzip-base64.v1" or cohort.get("decodedBytes")!=PACKET_BYTES or cohort.get("sha256")!=PACKET_SHA:
            raise ValueError("Select E496's complete original retained cohort")
        compressed=base64.b64decode(cohort["sourceGzipBase64"],validate=True)
        if len(compressed)!=cohort["gzipBytes"]: raise ValueError("Original compressed source length differs")
        body=gzip.decompress(compressed)
        if len(body)!=PACKET_BYTES or sha(body)!=PACKET_SHA: raise ValueError("Complete original decoded cohort differs")
        packet=json.loads(body)
        selection=json.loads(ordinary(source/"reference/SOURCE_SELECTION.json"))
        if selection["commit"]!=COMMIT: raise ValueError("Original source selection changed")
        original_rows=packet.get("upstreamFiles")
        selection_rows=selection.get("files")
        if not isinstance(original_rows,list) or not isinstance(selection_rows,list) or len(original_rows)!=10 or len(selection_rows)!=10:
            raise ValueError("Keep exactly ten original upstream members and selection rows")
        original_names=[safe(f["path"]) for f in original_rows]
        selected_names=[safe(f["path"]) for f in selection_rows]
        if len(set(original_names))!=10 or len(set(selected_names))!=10 or set(original_names)!=set(selected_names):
            raise ValueError("Keep every original upstream member once; duplicates are not a complete cohort")
        originals=dict(zip(original_names,original_rows))
        inputs=root/"inputs"
        for expected in selection["files"]:
            original=originals[expected["path"]]; raw=original["content"].encode("utf-8")
            if original["bytes"]!=expected["bytes"] or original["sha256"]!=expected["sha256"] or original.get("gitBlob")!=expected["gitBlob"]:
                raise ValueError("Pinned original source metadata differs")
            if len(raw)!=expected["bytes"] or sha(raw)!=expected["sha256"]: raise ValueError("Pinned complete upstream bytes differ")
            put(inputs/safe(expected["path"]),raw,True)
        selected_input={"schema":"definian.original-chinook-source-selection.v1","sourceCommit":COMMIT,
          "runtimeId":ready["runtimeId"],"python":sys.executable,"cohort":{"bytes":len(cohort_raw),"sha256":sha(cohort_raw),"decodedBytes":len(body),"decodedSha256":sha(body)},
          "sourceFiles":selected,"upstreamFiles":selection["files"]}
        put(root/"SOURCE_SELECTION.json",encoded(selected_input),True)
        state_path=root/"source-operation.json"
        state=json.loads(ordinary(state_path)) if state_path.exists() else {"schema":"definian.original-chinook-source-operation.v1","createdAt":now(),"selection":selected_input,"attempts":[]}
        if state.get("schema")!="definian.original-chinook-source-operation.v1" or state["selection"]!=selected_input:
            raise ValueError("Continue the exact same selected source/runtime")
        if state.get("pendingPreservation") is not None:
            if not args.resume:
                raise ValueError("Finish the saved original source preservation with --resume")
            finish_preservation(root,state,state_path)
        output=root/"received"
        if (output/"DELIVERY_MANIFEST.json").exists():
            result=validate_received(output)
            completed_source(state,result,adopted=True)
            put(state_path,encoded(state)); return result
        if output.exists() or output.is_symlink():
            if not args.resume: raise ValueError("Continue this preserved source attempt with --resume")
            if output.is_symlink() or not output.is_dir() or output.resolve()!=output:
                raise ValueError("Original source attempt path changed")
            if not state["attempts"]:
                raise ValueError("Preserve the original receiving attempt journal before continuing")
            prior=root/"prior-attempts"/("source-"+str(len(state["attempts"])).zfill(4))
            if prior.exists() or prior.is_symlink():
                raise ValueError("The complete earlier source attempt already has a retained destination")
            identity=output.stat()
            state["pendingPreservation"]={"attemptId":state["attempts"][-1]["id"],"source":"received",
              "directory":str(prior.relative_to(root)),"selectedAt":now(),
              "directoryIdentity":{"device":identity.st_dev,"inode":identity.st_ino}}
            put(state_path,encoded(state))
            finish_preservation(root,state,state_path)
        attempt={"id":str(uuid.uuid4()),"startedAt":now(),"state":"running","receiver":selected[0]}
        state["attempts"].append(attempt); state["status"]="running"; put(state_path,encoded(state))
        try:
            receiver=runpy.run_path(str(source/"reference/receive_reference.py"),run_name="definian_original_chinook_receiver")
            receiver["receive"](selection,output,inputs)
            result=validate_received(output)
            completed_source(state,result)
            put(state_path,encoded(state)); return result
        except BaseException as exc:
            attempt.update(state="failed",completedAt=now(),error={"type":type(exc).__name__,"message":str(exc)})
            state["status"]="failed"; put(root/("source-failure-"+attempt["id"]+".txt"),traceback.format_exc().encode(),True)
            put(state_path,encoded(state)); raise
    finally:
        os.close(lock)
def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument("--source",required=True);p.add_argument("--directory",required=True)
    p.add_argument("--runtime-ready",required=True);p.add_argument("--resume",action="store_true")
    result=run(p.parse_args()); print(json.dumps({"status":"complete","originalSource":result}),flush=True)
if __name__=="__main__": main()
