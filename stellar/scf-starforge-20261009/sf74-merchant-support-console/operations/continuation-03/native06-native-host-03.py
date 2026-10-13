#!/usr/bin/env python3
"""Continue the same SF74 case with complete source, failed-run lineage and stopped-state retention."""
from __future__ import annotations
import argparse, fcntl, hashlib, importlib.util, io, json, os, stat, subprocess, sys, time, uuid, zipfile
from pathlib import Path

OP = "BC08-SF74-NATIVE06-COMMERCIAL-RECEIVING-20261012"
SOURCE_COMMIT = "a4bd39ec1b077cf71bd9bd8a36e9feb11adbc919"  # published base; source manifest identifies four literal amendments
NATIVE_OP = "BC08-SF74-NATIVE06-COMMERCIAL-RECEIVING-20261012-03"
PREDECESSOR_SHA = "fb7cce862528029e3574d935b14c2d9ee6fdbaf02adf67fb2947c2d841a90bd7"
PREDECESSOR_SOURCE_SHA = "683577afcc7b13e3bce3e3f18dbc08794693a50fa98bfa98cc860fe2ee3da68f"
PREDECESSOR_WORK = "/dev/bc08-sf74-native06-20261012"
PREDECESSOR_RECORD = "/workspace/scratch/bc0850d7ba23/scf-route-cost-operation/admission/cebb0d2be906fa91714db6c84fff947cb71c4d022af72fed850ee5e6a6a0d4f9"
INDEX_SHA = "466128e42ee2da4ed0181c0e1fe271dd579e14b639e6577b5dd78ed32e5dd005"
SOURCE_SHA = "7d3a3a2159024fbb8d4c0d728f0df9f21e8845c9bec6845d72ab6a79e1704752"
PREFIX = "stellar/scf-starforge-20261009/sf74-merchant-support-console/operations/"
CARRIER = [{"name":"native06-commercial-receiving.mjs","bytes":42011,"sha256":"350ee6756f8e8c741d9d89466daa7554c266a73520074dc752fb98c1e663e6b0"},{"name":"native06-source-receive.py","bytes":10352,"sha256":"cdb04cc52936a70a39360339e86c2d602702f4777eec1d6fb8bd0be3a5e9c235"},{"name":"NATIVE06_RECEIVING.md","bytes":13061,"sha256":"76ed9dd9c4dda8c1278e4c9dd4c99bd425f9140552ef36d13929921fe0618285"},{"name":"native06-source-01.json","bytes":549099,"sha256":"2ea5f0b8e240554018facf52d6978087695e269247962aecaae25d847efe3469"},{"name":"native06-source-02.json","bytes":514782,"sha256":"97e7d2e0b3c399503bf9a2d6c256f9545c7457526bf3b58d2e44698744870f20"},{"name":"native06-source-03.json","bytes":533574,"sha256":"3fd9330a233ae0d33d14becfb8a9e04a4bda381909a844a5465f44e4f045f983"},{"name":"native06-source-04.json","bytes":544881,"sha256":"7403cc656e35019c036a17a6ad541d3670f62935aed5166a0f0ac00bd46bc37d"},{"name":"native06-source-05.json","bytes":346898,"sha256":"18667c7b0a137c3d9ee2508a6aec2d53c8f312bd83c5333360ba850cbb4bbab9"},{"name":"native06-source.json","bytes":57139,"sha256":"466128e42ee2da4ed0181c0e1fe271dd579e14b639e6577b5dd78ed32e5dd005"}]
INPUTS = {
 "backup": {"path":"pricing-workspace/economics/exports/2778d971-f352-4f10-a958-af6e299fa10a.tar","file":"native06-pricing-workspace.tar","bytes":422912,"sha256":"df938ab5a61d87a9871934b487dcda5e5b12b79b3f4a02ffd46ca2e409c2a81d"},
 "report": {"path":"economics-journey.json","file":"economics-journey.json","bytes":21783,"sha256":"541fe36fbd691c3c5ced478cda2dd995ea10218b488fa821e33d7d41518a02cd"},
 "nativeReport": {"path":"native/linkup-native-journey.json","file":"linkup-native-journey.json","bytes":5034,"sha256":"22ec17eab5f5dc34d70e57a114be36df55eaa4d164e4b01bda03038fce20d9cb"}
}
HELPERS = ("library_upload.py","library_hosted_apps.py","library_file_transfer.py")
RECEIVING_FAILURE = {"bytes":2603917,"sha256":"dfb703435933f43639f52abcb2b9052b28f67390adc8b13ae19d1b67684bceed","libraryFileId":"libfile_12c905d0f40881918b84242a8110088b"}
RECEIVING_FAILURE_OP = OP + "-02"
def sha(b): return hashlib.sha256(b).hexdigest()
def encoded(v): return (json.dumps(v,ensure_ascii=False,sort_keys=True,indent=2)+"\n").encode()
def identity(b): return {"bytes":len(b),"sha256":sha(b)}
def regular(path, maximum=256*1024*1024):
 fd=os.open(path,os.O_RDONLY|getattr(os,"O_NOFOLLOW",0))
 with os.fdopen(fd,"rb") as f:
  before=os.fstat(f.fileno())
  if not stat.S_ISREG(before.st_mode) or before.st_size>maximum: raise ValueError("Expected a bounded regular file: "+str(path))
  data=f.read(maximum+1);after=os.fstat(f.fileno())
  if len(data)>maximum or (before.st_dev,before.st_ino,before.st_size,before.st_mtime_ns)!=(after.st_dev,after.st_ino,after.st_size,after.st_mtime_ns):
   raise ValueError("Original file changed while reading: "+str(path))
  return data
def directory(path):
 if not path.is_absolute() or str(path)!=os.path.normpath(str(path)):raise ValueError("Use normalized absolute directories")
 if path.exists() or path.is_symlink():
  s=path.lstat()
  if not stat.S_ISDIR(s.st_mode):raise ValueError("Preserve the non-directory at "+str(path))
  return
 directory(path.parent)
 try:path.mkdir(mode=0o700)
 except FileExistsError:
  if not stat.S_ISDIR(path.lstat().st_mode):raise ValueError("Concurrent directory changed")
def sync(parent):
 fd=os.open(parent,os.O_RDONLY|os.O_DIRECTORY)
 try:os.fsync(fd)
 finally:os.close(fd)
def retain(path,data):
 if path.exists() or path.is_symlink():
  if regular(path,len(data))!=data:raise ValueError("Preserve divergent retained bytes: "+str(path))
  return
 directory(path.parent);temporary=path.with_name(path.name+".writing-"+uuid.uuid4().hex)
 try:
  fd=os.open(temporary,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
  with os.fdopen(fd,"wb") as f:f.write(data);f.flush();os.fsync(f.fileno())
  try:os.link(temporary,path)
  except FileExistsError:
   if regular(path,len(data))!=data:raise ValueError("Concurrent retained bytes differ")
  sync(path.parent)
 finally:
  try:temporary.unlink()
  except FileNotFoundError:pass
def check(data,row):
 if len(data)!=row["bytes"] or sha(data)!=row["sha256"]:raise ValueError("Original source/input identity differs")
def relative(name):
 if not isinstance(name,str) or not name or "\\" in name or "\0" in name or name.startswith("/") or any(x in ("",".","..") for x in name.split("/")):
  raise ValueError("Invalid checkpoint member")
 return name
def capture(root):
 result={}
 for folder,dirs,names in os.walk(root,followlinks=False):
  dirs[:]=sorted(d for d in dirs if d not in ("node_modules",".git","__pycache__"))
  for name in dirs:
   if (Path(folder)/name).is_symlink():raise ValueError("Retain only original regular source directories")
  for name in sorted(names):
   if name.endswith(".pyc"):continue
   path=Path(folder)/name
   result[path.relative_to(root).as_posix()]=regular(path)
 return result
def restore_checkpoint(path, expected_sha, work):
 raw=regular(path)
 if not expected_sha or sha(raw)!=expected_sha:raise ValueError("Select the exact original private checkpoint")
 with zipfile.ZipFile(io.BytesIO(raw)) as z:
  entries=z.infolist();names=[x.filename for x in entries]
  if len(names)!=len(set(names)) or len(names)>20000:raise ValueError("Invalid checkpoint member set")
  meta=json.loads(z.read("WRAPPER-CHECKPOINT.json"))
  if meta.get("operation")!=OP or meta.get("workRoot")!=str(work) or meta.get("sourceManifestSha256")!=SOURCE_SHA or meta.get("nativeOperation")!=NATIVE_OP:
   raise ValueError("Checkpoint belongs to another original operation or private path")
  inventory=json.loads(z.read("CONTENTS.json"))
  if set(names)!=set(inventory)|{"CONTENTS.json"}:raise ValueError("Incomplete checkpoint inventory")
  payload={};total=0
  for row in entries:
   name=relative(row.filename)
   if name=="CONTENTS.json":continue
   mode=row.external_attr>>16
   if row.is_dir() or stat.S_ISLNK(mode) or row.file_size>256*1024*1024:raise ValueError("Unsupported checkpoint member")
   total+=row.file_size
   if total>512*1024*1024:raise ValueError("Original checkpoint exceeds the selected operation bound")
   data=z.read(row);check(data,inventory[name]);payload[name]=data
  for name,data in payload.items():
   if name=="WRAPPER-CHECKPOINT.json":continue
   target=work/name
   if target.exists() or target.is_symlink():
    if regular(target,len(data))!=data:raise ValueError("Preserve divergent private continuation state: "+name)
  for name,data in payload.items():
   if name!="WRAPPER-CHECKPOINT.json":retain(work/name,data)
 return meta
def retain_predecessor(path, work):
 raw=regular(path)
 if len(raw)!=823003 or sha(raw)!=PREDECESSOR_SHA:raise ValueError("Use the exact saved pre-business dependency checkpoint")
 with zipfile.ZipFile(io.BytesIO(raw)) as z:
  rows=z.infolist();names=[r.filename for r in rows]
  if len(names)!=170 or len(names)!=len(set(names)):raise ValueError("Original checkpoint inventory differs")
  inventory=json.loads(z.read("CONTENTS.json"))
  if set(names)!=set(inventory)|{"CONTENTS.json"}:raise ValueError("Original checkpoint is incomplete")
  payload={};total=0
  for row in rows:
   name=relative(row.filename)
   if name=="CONTENTS.json":continue
   total+=row.file_size
   if row.is_dir() or stat.S_ISLNK(row.external_attr>>16) or row.file_size>256*1024*1024 or total>512*1024*1024:
    raise ValueError("Unsupported predecessor member")
   data=z.read(row);check(data,inventory[name]);payload[name]=data
  meta=json.loads(payload["WRAPPER-CHECKPOINT.json"])
  if (meta.get("operation")!=OP or meta.get("workRoot")!=PREDECESSOR_WORK or
      meta.get("sourceManifestSha256")!=PREDECESSOR_SOURCE_SHA or meta.get("state")!="INCOMPLETE" or
      meta.get("originalExitCode")!=1 or meta.get("attempt")!="d26ad04d07ef48f793eeba9c63011901"):
   raise ValueError("Predecessor is not the original source-stage failure")
  if sorted(n for n in names if n.startswith("operation/"))!=["operation/operation.json"]:
   raise ValueError("A business stage already exists; preserve it and use an explicitly reviewed state continuation")
  request=json.loads(payload["operation/operation.json"])
  if request.get("operation")!=OP or request.get("sourceManifest",{}).get("sha256")!=PREDECESSOR_SOURCE_SHA:
   raise ValueError("Original saved business request differs")
  log=json.loads(payload["logs/d26ad04d07ef48f793eeba9c63011901.log"])
  if log.get("code")!="ENOENT" or not log.get("message","").endswith("/source/stellar/scf-starforge-20261009/distribution/distribution.json'"):
   raise ValueError("The predecessor failed for a different reason")
  old_manifest=json.loads(payload["source/SOURCE-MANIFEST.json"])
  if sha(payload["source/SOURCE-MANIFEST.json"])!=PREDECESSOR_SOURCE_SHA:
   raise ValueError("Original source receipt differs")
  # The original receiver retained two source receipts alongside its 156 selected files.
  receipt_files={
   "source/SOURCE-DEPENDENCIES.json":{"bytes":243,"sha256":"6f9a1c0387f6c75411651a074e9fcb87ea77d2869e4bb0f2aff06699b03919c6"},
   "source/SOURCE-RECEIVED.json":{"bytes":433,"sha256":"878ba1a436be8fb6131e585387601b6d25dee1b778f7682983f5b6cad7417765"}}
  expected={"source/"+row["path"] for row in old_manifest["files"]}|{"source/SOURCE-MANIFEST.json"}|set(receipt_files)
  if {n for n in names if n.startswith("source/")}!=expected:
   raise ValueError("Original selected source set differs")
  for name,row in receipt_files.items():check(payload[name],row)
  for row in old_manifest["files"]:
   body=payload["source/"+row["path"]];check(body,row)
   if hashlib.sha1(b"blob "+str(len(body)).encode()+b"\0"+body).hexdigest()!=row["blob"]:
    raise ValueError("Original Git source differs")
  for key,row in INPUTS.items():
   body=payload["inputs/"+row["file"]];check(body,row);retain(work/"inputs"/row["file"],body)
 retain(work/"predecessor"/"ORIGINAL_SOURCE_FAILURE.zip",raw)
 lineage={"schema":"stellar-forge.native06-source-correction-lineage.v1","nativeOperation":NATIVE_OP,
          "businessOperation":OP,"originalRecord":PREDECESSOR_RECORD,
          "predecessor":{"bytes":823003,"sha256":PREDECESSOR_SHA,"libraryFileId":"libfile_b636e41ea6988191a5368316ec9a4b41"},
          "originalSourceManifestSha256":PREDECESSOR_SOURCE_SHA,"correctedSourceManifestSha256":SOURCE_SHA,
          "stageBoundary":"operation request retained; no business stages or mutations in the original checkpoint",
          "businessIdentity":"same original IDs and native06 input hashes; no repeated purchase or provider call"}
 retain(work/"predecessor"/"LINEAGE.json",encoded(lineage))
 return lineage


def retain_receiving_failure(path,work):
 raw=regular(path);check(raw,RECEIVING_FAILURE)
 with zipfile.ZipFile(io.BytesIO(raw)) as z:
  entries=z.infolist();names=[row.filename for row in entries]
  if len(names)!=103 or len(names)!=len(set(names)):raise ValueError("The complete native02 failure is required")
  inventory=json.loads(z.read("CONTENTS.json"))
  if set(names)!=set(inventory)|{"CONTENTS.json"}:raise ValueError("The native02 failure inventory differs")
  payload={};total=0
  for row in entries:
   name=relative(row.filename)
   if name=="CONTENTS.json":continue
   total+=row.file_size
   if row.is_dir() or stat.S_ISLNK(row.external_attr>>16) or row.file_size>64*1024*1024 or total>64*1024*1024:
    raise ValueError("Unsupported native02 failure member")
   data=z.read(row);check(data,inventory[name]);payload[name]=data
  meta=json.loads(payload["CAPTURE.json"])
  request=json.loads(payload["native-record/request.json"]);result=json.loads(payload["native-record/result.json"])
  memory=json.loads(payload["native-record/memory.json"])
  if (meta.get("businessOperation")!=OP or meta.get("nativeOperation")!=RECEIVING_FAILURE_OP
      or meta.get("state")!="FAILED_BEFORE_BUSINESS" or meta.get("newBusinessStages")!=0
      or request.get("intent",{}).get("operation_id")!=RECEIVING_FAILURE_OP
      or result.get("state")!="failed" or result.get("exit_code")!=1
      or result.get("stop_requested") is not False or memory.get("state")!="released"):
   raise ValueError("Native02 has a different execution or ownership boundary")
  events=[json.loads(line) for line in payload["native-record/output.log"].decode().splitlines() if line.strip()]
  if ([v.get("event") for v in events]!=["SF74_CORRECTED_SOURCE_READY","SF74_HOST_RECEIVED","SF74_ORIGINAL_CORRECTED_HOST_EXECUTE","SF74_HOST_RECEIVING_INCOMPLETE"]
      or events[-1].get("message")!="A source part belongs to another original manifest"):
   raise ValueError("Native02 has a different source or business boundary")
  original=payload["inputs/ORIGINAL_SOURCE_FAILURE.zip"]
  if len(original)!=823003 or sha(original)!=PREDECESSOR_SHA:raise ValueError("Native02 did not retain the original private checkpoint")
 retain(work/"predecessor"/"NATIVE02_SOURCE_RECEIVING_FAILURE.zip",raw)
 retain(work/"predecessor"/"ORIGINAL_SOURCE_FAILURE.zip",original)
 receipt={"schema":"stellar-forge.native06-linked-receiving-lineage.v1",
          "businessOperation":OP,"nativeOperation":NATIVE_OP,"predecessorNativeOperation":RECEIVING_FAILURE_OP,
          "predecessor":RECEIVING_FAILURE,"sourceManifestSha256":SOURCE_SHA,"sourceIndexSha256":INDEX_SHA,
          "businessBoundary":"The original 156 files and native06 inputs are retained. Native02 failed before business dispatch; native03 continues the same UUIDs.",
          "controllerBoundary":"The archived native02 record is historical source. No prior request, timestamp, lock, result or PID is copied into the native03 record.",
          "newPurchases":0,"newProviderCalls":0}
 retain(work/"predecessor"/"NATIVE02_LINEAGE.json",encoded(receipt))
 return receipt

def make_checkpoint(work,attempt,status,original_code,phase,business_started):
 payload={}
 for name in ("source","inputs","operation","predecessor","carrier","library-helpers","receiving"):
  if (work/name).is_dir():
   for rel,data in capture(work/name).items():payload[name+"/"+rel]=data
 for name in ("WRAPPER-REQUEST.json","operation-config.json","run-native06.py","source-receiver.py"):
  if (work/name).is_file():payload[name]=regular(work/name)
 if (work/"logs").is_dir():
  for rel,data in capture(work/"logs").items():payload["logs/"+rel]=data
 # The original complete operating archive remains a usable recipient artifact.
 for name in ("NATIVE06_COMPLETE_CASE.zip","NATIVE06_COMPLETE_CASE.zip.json"):
  if (work/"delivery"/name).is_file():payload["delivery/"+name]=regular(work/"delivery"/name)
 meta={"schema":"stellar-forge.native06-private-checkpoint.v1","operation":OP,"workRoot":str(work),
       "sourceBaseCommit":SOURCE_COMMIT,"sourceManifestSha256":SOURCE_SHA,"nativeOperation":NATIVE_OP,
       "predecessorSha256":PREDECESSOR_SHA,"attempt":attempt,"state":status,
       "originalExitCode":original_code,"phase":phase,"businessStarted":business_started,
        "receivingFailureSha256":RECEIVING_FAILURE["sha256"],"newPurchases":0,"newProviderCalls":0,
       "recovery":"Use this exact workRoot in one private invocation. Restore all source, inputs, operation and request files together; retain every original UUID. Pass --resume-checkpoint and its SHA-256 to this wrapper. The original programme reopens retained phases and does not repeat purchases."}
 payload["WRAPPER-CHECKPOINT.json"]=encoded(meta)
 payload["CONTENTS.json"]=encoded({name:identity(data) for name,data in sorted(payload.items())})
 checkpoint=work/"delivery"/("SF74_NATIVE06_"+status+"_"+attempt+".zip")
 with zipfile.ZipFile(checkpoint,"x",zipfile.ZIP_DEFLATED,compresslevel=6) as z:
  for name,data in sorted(payload.items()):
   item=zipfile.ZipInfo(name,date_time=(1980,1,1,0,0,0));item.compress_type=zipfile.ZIP_DEFLATED;item.external_attr=(stat.S_IFREG|0o600)<<16
   z.writestr(item,data)
 checkpoint.chmod(0o600)
 with zipfile.ZipFile(checkpoint) as z:
  if set(z.namelist())!=set(payload):raise ValueError("Checkpoint member set differs")
  for name,data in payload.items():
   if z.read(name)!=data:raise ValueError("Checkpoint original bytes differ: "+name)
 return checkpoint,{"files":len(payload),**identity(regular(checkpoint)),"state":status}
def save_checkpoint(path,details,work,output,attempt):
 shared=None;shared_error=None
 try:
  directory(output);destination=output/path.name
  retain(destination,regular(path));shared=str(destination)
 except OSError as error:shared_error={"code":error.errno,"operation":"retain stopped checkpoint"}
 # The existing prepared helper owns upload, finalization, and local metadata.
 helper=work/"library-helpers";sys.path.insert(0,str(helper))
 from library_upload import LibraryUploadWorkflow,HostedAppsClient,LibraryFileMaterializer,SignedUrlUploader
 state=work/"library-state"/attempt;directory(state)
 previous={k:os.environ.get(k) for k in ("TMPDIR","TMP","TEMP","AZCOPY_CONCURRENCY_VALUE","AZCOPY_BUFFER_GB")}
 print(json.dumps({"event":"NATIVE06_PREPARED_UPLOAD_BEGIN","path":str(path),"stateDirectory":str(state),**details}),flush=True)
 try:
  os.environ.update(TMPDIR=str(state),TMP=str(state),TEMP=str(state),AZCOPY_CONCURRENCY_VALUE="1",AZCOPY_BUFFER_GB="0.125")
  response=LibraryUploadWorkflow(apps_client=HostedAppsClient(),materializer=LibraryFileMaterializer(),uploader=SignedUrlUploader(),state_parent=state).run({
   "uploads":[{"local_path":str(path),"purpose":"create_library_file","library_artifact_type":"other"}]})
 finally:
  for k,v in previous.items():
   if v is None:os.environ.pop(k,None)
   else:os.environ[k]=v
 rows=response.get("results",[]) if isinstance(response,dict) else []
 selected=[r for r in rows if r.get("local_path")==str(path) and r.get("status")=="succeeded" and r.get("library_file_id")]
 projection=[{k:r.get(k) for k in ("local_path","status","library_file_id","file_id","current_version_number","local_metadata_applied") if k in r} for r in rows]
 receipt={"schema":"stellar-forge.native06-private-delivery.v1","operation":OP,"attempt":attempt,**details,
          "local_path":str(path),"shared_path":shared,"shared_write":shared_error,"uploads":projection}
 retain(work/"save-receipts"/(attempt+".json"),encoded(receipt))
 try:retain(output/(attempt+".delivery.json"),encoded(receipt))
 except OSError:pass
 print(json.dumps({"event":"NATIVE06_WORKSPACE_SAVE",**receipt}),flush=True)
 if len(selected)!=1:
  raise RuntimeError("Reconcile this original prepared upload; do not repeat it. Retained upload state: "+str(state))
 return receipt
def run(args,prepare=None):
 work=Path(args.work);directory(work)
 if work.lstat().st_uid!=os.getuid() or work.lstat().st_mode&0o077:raise ValueError("Use an owned private operating directory")
 with (work/".wrapper.lock").open("a+b") as lease:
  fcntl.flock(lease,fcntl.LOCK_EX|fcntl.LOCK_NB)
  attempt=uuid.uuid4().hex;code=None;failure=None;status="INCOMPLETE";phase="RETENTION_SETUP";business_started=False
  started=time.time()
  for name in ("logs","delivery","temp","browser"):directory(work/name)
  try:
   if args.resume_checkpoint:restore_checkpoint(Path(args.resume_checkpoint),args.checkpoint_sha256,work)
   retain(work/"run-native06.py",regular(Path(__file__),2*1024*1024))
   # Bank the selected helper and receiving source before source extraction or business launch.
   for name in HELPERS:retain(work/"library-helpers"/name,regular(Path(args.library_helpers)/name,2*1024*1024))
   phase="PREDECESSOR_RECEIVING"
   retain_receiving_failure(Path(args.receiving_failure_checkpoint),work)
   predecessor=work/"predecessor"/"ORIGINAL_SOURCE_FAILURE.zip"
   retain_predecessor(predecessor,work)
   phase="SOURCE_AND_RUNTIME_PREPARATION"
   if prepare is not None:prepare()
   carrier=Path(args.carrier);carrier_values={}
   phase="SOURCE_RECEIVING"
   for row in CARRIER:
    data=regular(carrier/row["name"],2*1024*1024);check(data,row);carrier_values[row["name"]]=data
    retain(work/"carrier"/row["name"],data)
   source=work/"source";inputs=work/"inputs"
   for key,row in INPUTS.items():
    target=inputs/row["file"];data=regular(target)
    check(data,row)
   receiver_path=work/"source-receiver.py";retain(receiver_path,carrier_values["native06-source-receive.py"])
   spec=importlib.util.spec_from_file_location("sf74_native06_source_receiver",receiver_path)
   receiver=importlib.util.module_from_spec(spec);spec.loader.exec_module(receiver)
   received=receiver.receive(work/"carrier"/"native06-source.json",INDEX_SHA,source,args.dependencies)
   print(json.dumps({"event":"ORIGINAL_SOURCE_READY","files":received["files"],"bytes":received["bytes"],"sourceManifestSha256":SOURCE_SHA}),flush=True)
   request={"operation":OP,"nativeOperation":NATIVE_OP,"sourceBaseCommit":SOURCE_COMMIT,"predecessorSha256":PREDECESSOR_SHA,
            "receivingFailureSha256":RECEIVING_FAILURE["sha256"],"sourceIndexSha256":INDEX_SHA,"sourceManifestSha256":SOURCE_SHA,
            "workRoot":str(work),"node":args.node,"dependencies":str(Path(args.dependencies).resolve()),
            "playwright":args.playwright,"chromium":args.chromium,"python":sys.executable,
            "originalInputs":{k:{"bytes":r["bytes"],"sha256":r["sha256"]} for k,r in INPUTS.items()}}
   retain(work/"WRAPPER-REQUEST.json",encoded(request));directory(work/"operation")
   config={"source":str(source),"sourceManifestSha256":SOURCE_SHA,"directory":str(work/"operation"),
           **{k:str(inputs/r["file"]) for k,r in INPUTS.items()},"playwright":args.playwright,"chromium":args.chromium,
           "browserTmp":str(work/"browser"),"python":sys.executable,"archive":str(work/"delivery"/"NATIVE06_COMPLETE_CASE.zip")}
   retain(work/"operation-config.json",encoded(config))
   for path in (args.node,args.playwright,args.chromium):
    if not Path(path).is_file():raise ValueError("The selected existing runtime is unavailable: "+path)
   phase="BUSINESS_PROGRAMME"
   environment=dict(os.environ,TMPDIR=str(work/"temp"),TMP=str(work/"temp"),TEMP=str(work/"temp"),PYTHONPYCACHEPREFIX=str(work/"pycache"))
   print(json.dumps({"event":"NATIVE06_ORIGINAL_PROGRAM_START","operation":OP,"nativeOperation":NATIVE_OP,"attempt":attempt,"work":str(work)}),flush=True)
   with (work/"logs"/(attempt+".log")).open("xb") as log:
    with subprocess.Popen([args.node,str(source/PREFIX/"native06-commercial-receiving.mjs"),str(work/"operation-config.json")],
                          cwd=source,env=environment,stdin=subprocess.DEVNULL,stdout=log,stderr=subprocess.STDOUT) as child:
     business_started=True;code=child.wait()
   phase="BUSINESS_STOPPED"
   result_path=work/"operation"/"RESULT.json"
   result=json.loads(regular(result_path)) if result_path.is_file() else None
   if code==0 and result and result.get("state")=="COMPLETE" and result.get("operation")==OP:status="COMPLETE"
   else:failure={"code":"ORIGINAL_PROGRAM_INCOMPLETE","exitCode":code}
  except Exception as error:
   failure={"code":type(error).__name__,"message":str(error)}
  stopped={"operation":OP,"nativeOperation":NATIVE_OP,"attempt":attempt,"state":status,"phase":phase,
           "businessStarted":business_started,"originalExitCode":code,"durationSeconds":round(time.time()-started,3),"failure":failure}
  retain(work/"logs"/(attempt+".result.json"),encoded(stopped))
  print(json.dumps({"event":"NATIVE06_ORIGINAL_PROGRAM_STOPPED",**stopped}),flush=True)
  # Source receiving failures use the same complete stopped-state custody as business outcomes.
  checkpoint,details=make_checkpoint(work,attempt,status,code,phase,business_started)
  print(json.dumps({"event":"NATIVE06_CHECKPOINT_PREPARED","path":str(checkpoint),**details}),flush=True)
  receipt=save_checkpoint(checkpoint,details,work,Path(args.output),attempt)
  if status!="COMPLETE":
   log=work/"logs"/(attempt+".log")
   tail=regular(log,8*1024*1024).decode("utf-8","replace")[-12000:] if log.is_file() else ""
   print(json.dumps({"event":"NATIVE06_INCOMPLETE_DETAIL","failure":failure,"phase":phase,"businessStarted":business_started,"logTail":tail,"checkpoint":receipt}),flush=True)
   return 1
  print(json.dumps({"event":"NATIVE06_COMPLETE","operation":OP,"nativeOperation":NATIVE_OP,"delivery":receipt,"newPurchases":0,"newProviderCalls":0,"newChainTransactions":0}),flush=True)
  return 0
def main():
 parser=argparse.ArgumentParser(description=__doc__)
 parser.add_argument("--carrier",required=True)
 parser.add_argument("--original",default="/workspace/scratch/bc0850d7ba23/scf-route-cost-operation/output")
 parser.add_argument("--output",default="/workspace/scratch/bc0850d7ba23/sf74-native06-operation")
 parser.add_argument("--work",default="/dev/bc08-sf74-native06-20261012-03")
 parser.add_argument("--predecessor-checkpoint",default="/workspace/scratch/bc0850d7ba23/sf74-native06-operation/SF74_NATIVE06_INCOMPLETE_d26ad04d07ef48f793eeba9c63011901.zip")
 parser.add_argument("--receiving-failure-checkpoint",required=True)
 parser.add_argument("--node",default="/opt/codex/runtimes/codex-primary-runtime/dependencies/node/bin/node")
 parser.add_argument("--dependencies",default="/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules")
 parser.add_argument("--playwright",default="/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs")
 parser.add_argument("--chromium",default="/workspace/scratch/5403360e55a4/counterpress-capture-runtime/bin/chromium")
 parser.add_argument("--library-helpers",default="/workspace/scratch/bc0850d7ba23/sf74-native06-current-library-helpers")
 parser.add_argument("--resume-checkpoint")
 parser.add_argument("--checkpoint-sha256")
 args=parser.parse_args()
 if bool(args.resume_checkpoint)!=bool(args.checkpoint_sha256):raise ValueError("Select the original checkpoint and its exact SHA-256 together")
 return run(args)
if __name__=="__main__":
 try:raise SystemExit(main())
 except Exception as error:
  print(json.dumps({"event":"NATIVE06_WRAPPER_INCOMPLETE","code":type(error).__name__,"message":str(error)}),file=sys.stderr,flush=True)
  raise SystemExit(1)
