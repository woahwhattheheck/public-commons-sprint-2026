#!/usr/bin/env python3
"""Preserve the ended native02 source-receiving failure without running a business operation."""
from __future__ import annotations
import argparse, hashlib, importlib.util, json, os, shutil, stat, sys, uuid, zipfile
from pathlib import Path

OP = "BC08-SF74-NATIVE06-COMMERCIAL-RECEIVING-20261012"
NATIVE_OP = OP + "-02"
HOST_SOURCE_SHA = "4048e1f0b6e9fd84c98f5e96e15b8de03e1177155544d6e5d05500263fdd4cca"
PREVIOUS_SHA = "fb7cce862528029e3574d935b14c2d9ee6fdbaf02adf67fb2947c2d841a90bd7"
EXPECTED_FAILURE = "A source part belongs to another original manifest"

def sha(data): return hashlib.sha256(data).hexdigest()
def encoded(value): return (json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2)+"\n").encode()
def read(path, maximum=64*1024*1024):
    fd=os.open(path, os.O_RDONLY|getattr(os,"O_NOFOLLOW",0))
    with os.fdopen(fd,"rb") as stream:
        before=os.fstat(stream.fileno())
        if not stat.S_ISREG(before.st_mode) or before.st_size>maximum: raise ValueError("Expected a bounded regular retained file")
        data=stream.read(maximum+1);after=os.fstat(stream.fileno())
        if len(data)>maximum or (before.st_dev,before.st_ino,before.st_size,before.st_mtime_ns)!=(after.st_dev,after.st_ino,after.st_size,after.st_mtime_ns):
            raise ValueError("A retained file changed during capture")
        return data
def identity(data): return {"bytes":len(data),"sha256":sha(data)}
def check(data,row):
    if identity(data)!={k:row[k] for k in ("bytes","sha256")}: raise ValueError("Retained source identity differs")
    if row.get("blob") and hashlib.sha1(b"blob "+str(len(data)).encode()+b"\0"+data).hexdigest()!=row["blob"]: raise ValueError("Retained Git identity differs")
def relative(value):
    if not isinstance(value,str) or not value or "\\" in value or "\0" in value or value.startswith("/") or any(x in ("",".","..") for x in value.split("/")):
        raise ValueError("Invalid retained member")
    return value
def private(path):
    if not path.is_absolute() or str(path)!=os.path.normpath(str(path)):raise ValueError("Use an absolute normalized directory")
    path.mkdir(mode=0o700,parents=True,exist_ok=True)
    row=path.lstat()
    if not stat.S_ISDIR(row.st_mode) or row.st_uid!=os.getuid() or row.st_mode&0o077: raise ValueError("Use an owned private directory")
def retain(path,data):
    if path.exists() or path.is_symlink():
        if read(path,max(len(data),1))!=data:raise ValueError("Preserve divergent retained bytes")
        return
    private(path.parent);temporary=path.with_name(path.name+".writing-"+uuid.uuid4().hex)
    try:
        fd=os.open(temporary,os.O_CREAT|os.O_EXCL|os.O_WRONLY,0o600)
        with os.fdopen(fd,"wb") as stream:stream.write(data);stream.flush();os.fsync(stream.fileno())
        try:os.link(temporary,path)
        except FileExistsError:
            if read(path,max(len(data),1))!=data:raise ValueError("Concurrent retained bytes differ")
        fd=os.open(path.parent,os.O_RDONLY|os.O_DIRECTORY)
        try:os.fsync(fd)
        finally:os.close(fd)
    finally:
        try:temporary.unlink()
        except FileNotFoundError:pass
def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--receiving-root",required=True)
    parser.add_argument("--record",required=True)
    parser.add_argument("--output",required=True)
    parser.add_argument("--private-work",required=True)
    parser.add_argument("--source-body-file")
    args=parser.parse_args()
    os.umask(0o077)
    root=Path(args.receiving_root);record=Path(args.record);output=Path(args.output);work=Path(args.private_work)
    private(output);private(work)
    source_raw=read(root/"SOURCE.json")
    if sha(source_raw)!=HOST_SOURCE_SHA:raise ValueError("Select the ended native02 host source")
    source=json.loads(source_raw);payload={"source/receiving-02/SOURCE.json":source_raw};observed={}
    for row in source["files"]:
        name=relative(row["path"]);data=read(root/name);check(data,row);payload["source/receiving-02/"+name]=data
    selection=json.loads(payload["source/receiving-02/HOST-SELECTION.json"])
    if selection["nativeOperation"]!=NATIVE_OP or selection["businessOperation"]!=OP:raise ValueError("The original selection differs")
    request_raw=read(record/"request.json");result_raw=read(record/"result.json");memory_raw=read(record/"memory.json")
    request=json.loads(request_raw);result=json.loads(result_raw);memory=json.loads(memory_raw)
    if request.get("intent",{}).get("operation_id")!=NATIVE_OP or result.get("state")!="failed" or result.get("exit_code")!=1 or result.get("stop_requested") is not False:
        raise ValueError("Preserve the original ended native02 result")
    if memory.get("state")!="released":raise ValueError("The native owner has not released capacity")
    log=read(record/"output.log")
    events=[json.loads(line) for line in log.decode().splitlines() if line.strip()]
    if [v.get("event") for v in events]!=["SF74_CORRECTED_SOURCE_READY","SF74_HOST_RECEIVED","SF74_ORIGINAL_CORRECTED_HOST_EXECUTE","SF74_HOST_RECEIVING_INCOMPLETE"]:
        raise ValueError("A different operation boundary needs review")
    if events[-1].get("message")!=EXPECTED_FAILURE:raise ValueError("A different failure needs review")
    for folder,dirs,names in os.walk(record,followlinks=False):
        for name in dirs:
            if (Path(folder)/name).is_symlink():raise ValueError("Linked native record directory")
        for name in names:
            path=Path(folder)/name
            if path==record/".lock":continue
            rel=path.relative_to(record).as_posix();data=read(path)
            payload["native-record/"+relative(rel)]=data;observed[path]=data
    if payload.get("native-record/request.json")!=request_raw or payload.get("native-record/result.json")!=result_raw or payload.get("native-record/output.log")!=log:
        raise ValueError("The original result changed while capturing")
    paths={k:Path(v) for k,v in selection["paths"].items()}
    for row in selection["companion"]["files"]:
        name=relative(row["name"]);data=read(paths["companion"]/name);check(data,row);payload["source/correction-02/"+name]=data
    correction=json.loads(payload["source/correction-02/source-correction.json"])
    for section,directory,rows in [
        ("source/original-carrier",paths["originalCarrier"],correction["original"]["files"]),
        ("source/rejected-carrier",paths["correctedCarrier"],correction["corrected"]["files"]),
        ("source/native-host",paths["nativeRoot"],selection["native"]["files"])]:
        for row in rows:
            name=relative(row.get("name",row.get("path")));data=read(directory/name);check(data,row);payload[section+"/"+name]=data
    payload["source/receiving-02/received/RUNTIME.json"]=read(root/"received"/"RUNTIME.json")
    previous=read(paths["predecessor"])
    if len(previous)!=823003 or sha(previous)!=PREVIOUS_SHA:raise ValueError("Preserve the original exact private checkpoint")
    payload["inputs/ORIGINAL_SOURCE_FAILURE.zip"]=previous
    source_body=read(Path(args.source_body_file)) if args.source_body_file else read(Path(__file__))
    payload["source/bank-native02.py"]=source_body
    index=json.loads(payload["source/rejected-carrier/native06-source.json"])
    meta={"schema":"stellar-forge.native06-receiving-failure.v1","businessOperation":OP,"nativeOperation":NATIVE_OP,
          "nativeRecord":str(record),"state":"FAILED_BEFORE_BUSINESS","exitCode":1,
          "sourceManifestSha256":index["manifest"]["sha256"],"sourceIndex":identity(payload["source/rejected-carrier/native06-source.json"]),
          "failure":events[-1],"stageBoundary":"original source receiver rejected part wrappers before source publication or Node business dispatch",
          "partBindings":[{"path":p["path"],"sourceManifestSha256":json.loads(payload["source/rejected-carrier/"+p["path"]])["sourceManifestSha256"]} for p in index["parts"]],
          "originalCheckpoint":{"bytes":823003,"sha256":PREVIOUS_SHA,"libraryFileId":"libfile_b636e41ea6988191a5368316ec9a4b41"},
          "newPurchases":0,"newProviderCalls":0,"newBusinessStages":0,
          "recovery":"Retain native-record as historical evidence only. Continue the original business UUIDs through a separately linked native operation; never replay dispatched native02."}
    payload["CAPTURE.json"]=encoded(meta);payload["CONTENTS.json"]=encoded({name:identity(data) for name,data in sorted(payload.items())})
    for path,data in observed.items():
        if read(path)!=data:raise ValueError("The native record changed before final capture")
    target=work/"SF74_NATIVE02_SOURCE_RECEIVING_FAILED_49269744.zip"
    with zipfile.ZipFile(target,"x",zipfile.ZIP_DEFLATED,compresslevel=6) as archive:
        for name,data in sorted(payload.items()):
            entry=zipfile.ZipInfo(name,date_time=(1980,1,1,0,0,0));entry.compress_type=zipfile.ZIP_DEFLATED;entry.external_attr=(stat.S_IFREG|0o600)<<16
            archive.writestr(entry,data)
    target.chmod(0o600)
    with zipfile.ZipFile(target) as archive:
        if len(archive.namelist())!=len(payload) or set(archive.namelist())!=set(payload):raise ValueError("Captured member set differs")
        for name,data in payload.items():
            if archive.read(name)!=data:raise ValueError("Captured bytes differ")
    details={"files":len(payload),**identity(read(target)),"state":"FAILED_BEFORE_BUSINESS","nativeOperation":NATIVE_OP}
    retain(output/target.name,read(target))
    helpers=work/"library-helpers";private(helpers)
    for row in selection["libraryHelpers"]:
        data=read(paths["libraryHelpers"]/row["name"]);check(data,row);retain(helpers/row["name"],data)
    sys.path.insert(0,str(helpers))
    from library_upload import LibraryUploadWorkflow,HostedAppsClient,LibraryFileMaterializer,SignedUrlUploader
    state=work/"library-state";private(state)
    os.environ.update(TMPDIR=str(state),TMP=str(state),TEMP=str(state),AZCOPY_CONCURRENCY_VALUE="1",AZCOPY_BUFFER_GB="0.125")
    print(json.dumps({"event":"SF74_NATIVE02_CAPTURED",**details,"sharedPath":str(output/target.name)}),flush=True)
    response=LibraryUploadWorkflow(apps_client=HostedAppsClient(),materializer=LibraryFileMaterializer(),uploader=SignedUrlUploader(),state_parent=state).run(
        {"uploads":[{"local_path":str(target),"purpose":"create_library_file","library_artifact_type":"other"}]})
    rows=response.get("results",[])
    projection=[{k:r.get(k) for k in ("local_path","status","library_file_id","file_id","current_version_number","local_metadata_applied")} for r in rows]
    receipt={"schema":"stellar-forge.native06-receiving-failure-delivery.v1",**details,"sharedPath":str(output/target.name),"uploads":projection}
    retain(output/"NATIVE02_FAILURE_DELIVERY.json",encoded(receipt))
    print(json.dumps({"event":"SF74_NATIVE02_FAILURE_SAVED",**receipt}),flush=True)
    if len([r for r in rows if r.get("local_path")==str(target) and r.get("status")=="succeeded" and r.get("library_file_id")])!=1:
        raise RuntimeError("Reconcile the original upload state before another attempt: "+str(state))
    return 0
if __name__=="__main__":
    try:raise SystemExit(main())
    except Exception as error:
        print(json.dumps({"event":"SF74_NATIVE02_CAPTURE_INCOMPLETE","code":type(error).__name__,"message":str(error)}),file=sys.stderr,flush=True)
        raise SystemExit(1)
