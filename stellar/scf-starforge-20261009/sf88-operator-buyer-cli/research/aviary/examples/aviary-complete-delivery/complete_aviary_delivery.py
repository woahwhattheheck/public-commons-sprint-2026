#!/usr/bin/env python3
"""Complete the original Aviary delivery from retained accepted results."""
from __future__ import annotations
import argparse,ast,base64,contextlib,datetime as dt,fcntl,hashlib,html,importlib.util,json,os,re,select,shutil,signal,stat,subprocess,sys,tempfile,time,traceback,uuid,zipfile
from pathlib import Path,PurePosixPath
OP="AVIARY-COMPLETE-DELIVERY-6BA15-20261012"
ROOT=Path("/dev/aviary-complete-final-6ba15")
SHARED=Path("/workspace/scratch/6ba15c52ace4/aviary-final-delivery-20261012")
ORIGINAL=Path("/workspace/scratch/6ba15c52ace4/aviary-native-restored")
CAPTURES=Path("/dev/shm/avp-aviary-workshare-6ba15/example/captures")
SOURCE_SHA="cb5f1cd8d5fabee6b6e43eb1571f13fe660b1c195462118ec929328607855fc3"
WORKSPACE_ID="e2c87db6-5832-4c62-8e22-90a407770ec2"
PROVIDER_OPERATION="aviary-http-receiving-6ba15-20261012"
ARCHIVES=[
 {"name":"Aviary_Complete_HTTP_Receiving.zip","bytes":512241,"sha256":"3922aa6e4a01209304cf3a6c3e557125234a62ad41b1c92a7397e72e38cf2460","library_file_id":"libfile_502e5e882df88191a7833f66d53c1a19","target":"/dev/aviary-native-delivery-6ba15/native-receiving"},
 {"name":"Aviary_Delivery_Continuation_20261012.zip","bytes":701339,"sha256":"5f5dec1cdd2075e9e88e78cab72c677de634bb117f214483c307da844658e294","library_file_id":"libfile_781c180ef83081919b1c256652ae3472","target":"/dev/aviary-complete-delivery-6ba15"}
]
def now():return dt.datetime.now(dt.timezone.utc).isoformat()
def encoded(v):return (json.dumps(v,ensure_ascii=False,sort_keys=True,indent=2,allow_nan=False)+"\n").encode()
def require(v,m):
 if not v:raise RuntimeError(m)
def emit(event,**data):print(json.dumps({"event":event,"operation":OP,**data},ensure_ascii=False),flush=True)
def sha(raw):return hashlib.sha256(raw).hexdigest()
def record(path):
 p=Path(path)
 with open(p,"rb") as f:
  before=os.fstat(f.fileno());require(stat.S_ISREG(before.st_mode),"Expected regular file: "+str(p))
  h=hashlib.sha256();n=0
  while True:
   b=f.read(262144)
   if not b:break
   h.update(b);n+=len(b)
  after=os.fstat(f.fileno())
  require((before.st_dev,before.st_ino,before.st_size,before.st_mtime_ns,before.st_ctime_ns)==(after.st_dev,after.st_ino,after.st_size,after.st_mtime_ns,after.st_ctime_ns),"File changed while reading: "+str(p))
  return {"path":str(p),"bytes":n,"sha256":h.hexdigest()}
def syncdir(p):
 fd=os.open(p,os.O_RDONLY|getattr(os,"O_DIRECTORY",0))
 try:os.fsync(fd)
 finally:os.close(fd)
def publish(path,raw):
 path=Path(path);path.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
 if path.exists():
  require(path.is_file() and not path.is_symlink() and path.read_bytes()==raw,"Retained immutable file differs: "+str(path));return
 fd,tmp=tempfile.mkstemp(prefix=".aviary-owned-",dir=path.parent)
 try:
  with os.fdopen(fd,"wb") as f:f.write(raw);f.flush();os.fsync(f.fileno())
  try:os.link(tmp,path)
  except FileExistsError:require(path.read_bytes()==raw,"Concurrent publication differs: "+str(path))
  syncdir(path.parent)
 finally:
  with contextlib.suppress(FileNotFoundError):os.unlink(tmp)
def pubjson(path,v):publish(path,encoded(v))
def readjson(path):return json.loads(Path(path).read_bytes())
def validrel(value):
 require(isinstance(value,str) and value and "\\" not in value,"Invalid member name")
 p=PurePosixPath(value);require(not p.is_absolute() and all(x not in (".","..","") for x in p.parts),"Unsafe member path")
 require(str(p)==value,"Noncanonical member path");return p
def beneath(root,relative):
 rel=validrel(relative);p=Path(root).joinpath(*rel.parts)
 for q in [p,*p.parents]:
  if q==Path(root).parent:break
  require(not q.is_symlink(),"Symlink in receiving path")
 return p
def same(rec,path):
 r=record(path);require(r["bytes"]==rec["bytes"] and r["sha256"]==rec["sha256"],"Exact bytes differ: "+str(path));return r
def copy_exact(src,dst,expected=None):
 src,dst=Path(src),Path(dst);r=expected or record(src)
 if dst.exists():same(r,dst);return
 dst.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
 fd,tmp=tempfile.mkstemp(prefix=".aviary-copy-",dir=dst.parent)
 try:
  with open(src,"rb") as inp,os.fdopen(fd,"wb") as out:
   h=hashlib.sha256();n=0
   while True:
    b=inp.read(262144)
    if not b:break
    out.write(b);h.update(b);n+=len(b)
   out.flush();os.fsync(out.fileno())
  require(n==r["bytes"] and h.hexdigest()==r["sha256"],"Copy source differs: "+str(src))
  try:os.link(tmp,dst)
  except FileExistsError:same(r,dst)
  syncdir(dst.parent)
 finally:
  with contextlib.suppress(FileNotFoundError):os.unlink(tmp)
def restore_archive(entry):
 path=ORIGINAL/entry["name"];actual=same(entry,path);target=Path(entry["target"])
 with open(path,"rb") as held:
  original=os.fstat(held.fileno());h=hashlib.sha256()
  for b in iter(lambda:held.read(262144),b""):h.update(b)
  require(h.hexdigest()==entry["sha256"],"Held archive hash differs")
  held.seek(0)
  with zipfile.ZipFile(held) as z:
   infos=z.infolist();names=[i.filename for i in infos]
   require(len(names)==len(set(names)),"Duplicate archive member")
   file_names=[]
   for i in infos:
    validrel(i.filename.rstrip("/"))
    mode=(i.external_attr>>16)&0xffff
    require(not stat.S_ISLNK(mode),"Archive symlink refused")
    require(i.is_dir() or stat.S_IFMT(mode) in (0,stat.S_IFREG),"Special archive member")
    if not i.is_dir():file_names.append(i.filename)
   require("RECEIVING_MEMBERS.json" in file_names,"Original receiving manifest is absent")
   manifest_raw=z.read("RECEIVING_MEMBERS.json");manifest=json.loads(manifest_raw)
   rows=manifest["files"];require(isinstance(rows,list) and rows,"Original manifest file list absent")
   declared={}
   for r in rows:
    validrel(r["path"]);require(r["path"] not in declared,"Duplicate manifest path")
    require(isinstance(r["bytes"],int) and r["bytes"]>=0 and isinstance(r["sha256"],str) and len(r["sha256"])==64,"Bad member descriptor")
    declared[r["path"]]=r
   require(set(file_names)==set(declared)|{"RECEIVING_MEMBERS.json"},"Original ZIP and manifest inventory differ")
   for name,r in declared.items():
    hh=hashlib.sha256();n=0
    with z.open(name) as inp:
     for b in iter(lambda:inp.read(262144),b""):hh.update(b);n+=len(b)
    require(n==r["bytes"] and hh.hexdigest()==r["sha256"],"Original archive member differs: "+name)
   emit("ARCHIVE_VERIFIED",name=entry["name"],target=str(target),manifestKeys=list(manifest),members=len(rows),firstPaths=list(declared)[:8])
   target.mkdir(parents=True,exist_ok=True,mode=0o700)
   for name,r in declared.items():
    dest=beneath(target,name)
    if dest.exists():same(r,dest);continue
    dest.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
    fd,tmp=tempfile.mkstemp(prefix=".aviary-restore-",dir=dest.parent)
    try:
     with z.open(name) as inp,os.fdopen(fd,"wb") as out:shutil.copyfileobj(inp,out,262144);out.flush();os.fsync(out.fileno())
     same(r,tmp)
     try:os.link(tmp,dest)
     except FileExistsError:same(r,dest)
     syncdir(dest.parent)
    finally:
     with contextlib.suppress(FileNotFoundError):os.unlink(tmp)
   publish(ROOT/"original-manifests"/entry["name"].replace(".zip",".json"),manifest_raw)
  after=os.fstat(held.fileno())
  require((original.st_dev,original.st_ino,original.st_size,original.st_mtime_ns)==(after.st_dev,after.st_ino,after.st_size,after.st_mtime_ns),"Held archive changed")
 return {"file":actual,"library_file_id":entry["library_file_id"],"target":str(target),"members":len(rows),"manifest":record(ROOT/"original-manifests"/entry["name"].replace(".zip",".json"))}
def retain_command_producer(program):
 raw=program.encode("utf-8");current_sha=sha(raw)
 retained=ROOT/"producer-source"/(current_sha+".py");publish(retained,raw)
 original=ROOT/"complete_aviary_delivery.py"
 if not original.exists():publish(original,raw);return
 require(not original.is_symlink() and original.is_file(),"Original producer source is not a regular file")
 previous=original.read_bytes();previous_sha=sha(previous)
 if previous==raw:return
 allowed={"ff6762270c9eb821ff649b253ff3d1a9ab378dd9c4353999af226b18d126cbf3":36626,
          "c74bfc791f70039662d4e6e0ab9875e679d2fc04edc0549db16acbf5c72bff33":53244,
          "073938b61dbe10e7d771741ffe5f76a0f455c3f5515ddebf86245c68e6f71d18":70704,
           "6347c3a562dfcff119b4ea83f3ddc84f7091a03adbc70ea6ec5923f898078b98":74496}
 require(allowed.get(previous_sha)==len(previous),
  "Original producer source needs exact source reconciliation")
 publish(ROOT/"producer-source"/(previous_sha+".py"),previous)
 pubjson(ROOT/"producer-source"/("adoption-"+previous_sha+"-"+current_sha+".json"),
  {"schema":"commons.aviary-producer-source-adoption.v1","operation":OP,"previous":record(original),"selected":record(retained),
   "sourcePacketSha256":SOURCE_SHA,"callerSha256":"d1047f61b8c6b6b3a7f24a2d1fffe4b68e6407aa146f034b18beab3824bfb39e",
   "reason":"Preserve original producer and command history while selecting the explicit supplemental source-mapping correction.",
   "originalSourceChanged":False,"nativeApplicationSourceChanged":False,"exampleMappingChanged":True})
COMMAND_BOOTSTRAP = r'''
import hashlib,json,os,pathlib,sys
def need(ok,message):
 if not ok:raise RuntimeError(message)
def encoded(value):return (json.dumps(value,ensure_ascii=False,sort_keys=True,indent=2,allow_nan=False)+"\n").encode()
def digest(raw):return hashlib.sha256(raw).hexdigest()
fd=int(sys.argv[1]);data=json.loads(sys.argv[2])
raw=pathlib.Path("/proc/self/stat").read_text();end=raw.rfind(")");fields=raw[end+2:].split()
identity={"schema":"commons.aviary-command-process.v1","attemptId":data["attemptId"],"requestSha256":data["requestSha256"],
 "namespacePid":os.getpid(),"namespaceParentPid":os.getppid(),"hostPid":int(raw[:raw.index("(")].strip()),
 "hostParentPid":int(fields[1]),"hostProcessGroup":int(fields[2]),"startTicks":int(fields[19]),
 "bootId":pathlib.Path("/proc/sys/kernel/random/boot_id").read_text().strip(),
 "bootstrapCommandSha256":digest(pathlib.Path("/proc/self/cmdline").read_bytes()),"targetCommandSha256":data["targetCommandSha256"]}
wire=encoded(identity)
need(len(wire)<=16384,"Original command identity exceeds bound")
while wire:
 count=os.write(fd,wire);need(count>0,"Original identity pipe stopped");wire=wire[count:]
os.close(fd)
need(sys.stdin.buffer.readline(64)==b"START\n","Original command START was not received")
request=pathlib.Path(data["requestPath"]).read_bytes()
need(digest(request)==data["requestSha256"],"Original command request changed before START")
dispatch=json.loads(pathlib.Path(data["dispatchPath"]).read_bytes())
need(dispatch["attemptId"]==data["attemptId"] and dispatch["requestSha256"]==data["requestSha256"] and dispatch["process"]==identity,
 "Original command dispatch binding changed")
need(os.path.realpath(os.getcwd())==os.path.realpath(data["cwd"]),"Original command cwd changed")
null=os.open(os.devnull,os.O_RDONLY);os.dup2(null,0)
if null!=0:os.close(null)
os.execvpe(data["argv"][0],data["argv"],os.environ)
'''
def command_self():
 raw=Path("/proc/self/stat").read_text();end=raw.rfind(")");fields=raw[end+2:].split()
 return {"namespacePid":os.getpid(),"hostPid":int(raw[:raw.index("(")].strip()),"startTicks":int(fields[19]),
  "bootId":Path("/proc/sys/kernel/random/boot_id").read_text().strip(),"commandSha256":sha(Path("/proc/self/cmdline").read_bytes())}
def command_file(path):
 path=Path(path);require(not path.is_symlink() and path.is_file(),"Original command file is not regular: "+str(path))
 return readjson(path)
def command_identity_pipe(fd,child,timeout):
 deadline=time.monotonic()+min(float(timeout),30.0);raw=bytearray()
 while True:
  remaining=deadline-time.monotonic()
  require(remaining>0,"Original command identity was not returned before its bound")
  ready,_,_=select.select([fd],[],[],min(remaining,0.25))
  if not ready:
   require(child.poll() is None,"Original gated command exited before process identity")
   continue
  part=os.read(fd,4096)
  if not part:break
  raw.extend(part);require(len(raw)<=16384,"Original command identity exceeded its bound")
 # The bootstrap closes this descriptor before waiting for START.
 require(raw and raw[-1:]==b"\n","Original command identity was incomplete")
 value=json.loads(bytes(raw));require(isinstance(value,dict),"Original command identity is not an object")
 return value
def command_process_observation(process):
 if not isinstance(process,dict):return {"status":"NO_RETAINED_HOST_PROCESS_IDENTITY"}
 try:
  boot=Path("/proc/sys/kernel/random/boot_id").read_text().strip()
  if boot!=process["bootId"]:return {"status":"ORIGINAL_BOOT_ENDED","bootId":boot}
  path=Path("/proc")/str(process["hostPid"])
  raw=(path/"stat").read_text();end=raw.rfind(")");fields=raw[end+2:].split()
  if int(fields[19])!=process["startTicks"]:return {"status":"ORIGINAL_PROCESS_ENDED_PID_REUSED"}
  command=sha((path/"cmdline").read_bytes())
  return {"status":"MATCHING_ORIGINAL_PROCESS" if command in (process["bootstrapCommandSha256"],process["targetCommandSha256"]) else "HOST_PROCESS_COMMAND_CHANGED",
   "hostPid":process["hostPid"],"startTicks":process["startTicks"],"commandSha256":command,"state":fields[0]}
 except FileNotFoundError:return {"status":"ORIGINAL_HOST_PROCESS_ABSENT"}
 except (OSError,ValueError,KeyError,TypeError) as error:return {"status":"PROCESS_OBSERVATION_UNRESOLVED","errorType":type(error).__name__}
def command_promote(folder,value):
 require(value["returncode"]==0,"Cannot promote a failed original command")
 for channel in ("stdout","stderr"):
  source=Path(value[channel]["path"]);same(value[channel],source)
  copy_exact(source,folder/channel,value[channel])
 final={**value,"stdout":record(folder/"stdout"),"stderr":record(folder/"stderr")}
 pubjson(folder/"result.json",final)
 return final
def command_retained_attempts(folder,binding,request_sha):
 groups={}
 for path in folder.iterdir():
  match=re.fullmatch(r"(attempt-result|attempt|process|dispatch|stdout|stderr)-([0-9a-f-]{36})(\.json)?",path.name)
  if not match:continue
  kind,attempt_id,suffix=match.groups()
  require(str(uuid.UUID(attempt_id))==attempt_id,"Original command attempt filename is invalid")
  require((suffix==".json")== (kind not in ("stdout","stderr")),"Original command attempt suffix differs")
  require(not path.is_symlink() and path.is_file(),"Original command attempt is not a regular file")
  groups.setdefault(attempt_id,{})[kind]=path
 successful=[];failed=[];unresolved=[]
 for attempt_id,files in sorted(groups.items()):
  if "attempt" not in files:
   unresolved.append({"attemptId":attempt_id,"reason":"ORIGINAL_LOG_OR_RECEIPT_WITHOUT_ATTEMPT","files":[str(p) for p in files.values()]});continue
  attempt=command_file(files["attempt"])
  require(attempt.get("request")==binding and isinstance(attempt.get("started"),str),"Original command attempt request differs")
  modern=attempt.get("schema")=="commons.aviary-command-attempt.v2"
  if modern:
   require(attempt.get("attemptId")==attempt_id and attempt.get("requestSha256")==request_sha,"Original command attempt identity differs")
   for channel in ("stdout","stderr"):
    path=folder/(channel+"-"+attempt_id)
    require(channel in files and attempt[channel]["path"]==str(path),"Original command log path differs")
    info=path.stat()
    require("attempt-result" in files or (info.st_dev,info.st_ino)==(attempt[channel]["device"],attempt[channel]["inode"]),"Unresolved original command log inode differs")
  else:
   require(type(attempt.get("pid")) is int and attempt["pid"]>0,"Legacy original command PID is invalid")
  process=command_file(files["process"]) if "process" in files else None
  dispatch=command_file(files["dispatch"]) if "dispatch" in files else None
  if process is not None:
   require(modern and process.get("attemptId")==attempt_id and process.get("requestSha256")==request_sha and
    process.get("schema")=="commons.aviary-command-process.v1" and
    process.get("namespaceParentPid")==attempt["parent"]["namespacePid"] and process.get("hostParentPid")==attempt["parent"]["hostPid"] and
    process.get("bootId")==attempt["parent"]["bootId"] and type(process.get("hostPid")) is int and process["hostPid"]>0 and
    type(process.get("startTicks")) is int and process["startTicks"]>0 and
    process.get("targetCommandSha256")==sha(b"\0".join(os.fsencode(arg) for arg in binding["argv"])+b"\0"),"Original process record differs")
  if dispatch is not None:
   require(process is not None and dispatch.get("attemptId")==attempt_id and dispatch.get("requestSha256")==request_sha and
    dispatch.get("process")==process,"Original command dispatch differs")
  if "attempt-result" not in files:
   unresolved.append({"attemptId":attempt_id,"reason":"ORIGINAL_COMMAND_HAS_NO_TERMINAL_RECEIPT","attempt":str(files["attempt"]),
    "dispatchRecorded":dispatch is not None,"process":command_process_observation(process)});continue
  value=command_file(files["attempt-result"])
  require(value.get("request")==binding and value.get("started")==attempt["started"],"Original command terminal request differs")
  for channel in ("stdout","stderr"):
   path=folder/(channel+"-"+attempt_id)
   require(channel in files and value[channel]["path"]==str(path),"Original terminal log path differs")
   same(value[channel],path)
  if modern:
   require(value.get("attemptId")==attempt_id and value.get("requestSha256")==request_sha and
    value.get("state") in ("DRAINED","NOT_DISPATCHED"),"Original terminal identity differs")
   require(value.get("processSha256")== (record(files["process"])["sha256"] if process else None) and
    value.get("dispatchSha256")== (record(files["dispatch"])["sha256"] if dispatch else None),"Original terminal process/dispatch bytes differ")
   if value["state"]=="NOT_DISPATCHED":
    require(value.get("pid") is None and value.get("returncode") is None and process is None and dispatch is None,"Original non-dispatch receipt contradicts process state")
   else:
    require(type(value.get("pid")) is int and value["pid"]>0 and type(value.get("returncode")) is int,"Original drained command lacks a returned exit code")
    require(process is None or value["pid"]==process["namespacePid"],"Original terminal handle PID differs from the retained child")
  else:
   require(value.get("pid")==attempt["pid"] and type(value.get("returncode")) is int,"Legacy original terminal PID/code differs")
  if value.get("returncode")==0:
   require(not modern or (process is not None and dispatch is not None and value.get("startSent") is True),"Original successful command lacks its START binding")
   successful.append(value)
  else:failed.append(value)
 require(not unresolved,"Original command needs reconciliation; no redispatch: "+json.dumps(unresolved,sort_keys=True,separators=(",",":")))
 require(len(successful)<=1,"Multiple completed original commands need reconciliation")
 return successful,failed
def command_drain_owned(child):
 # Popen.pid belongs to this retained handle's namespace. Host procfs IDs are
 # observations only and are never substituted into wait/kill operations.
 if child.poll() is None:
  with contextlib.suppress(ProcessLookupError):os.killpg(child.pid,signal.SIGTERM)
  try:child.wait(timeout=10)
  except subprocess.TimeoutExpired:
   with contextlib.suppress(ProcessLookupError):os.killpg(child.pid,signal.SIGKILL)
   child.wait(timeout=10)
 else:child.wait()
 require(child.returncode is not None,"Original owned command did not drain")
 return child.returncode
def run_command(name,argv,timeout=900):
 require(isinstance(name,str) and re.fullmatch(r"[a-z0-9-]+",name),"Invalid original command name")
 folder=ROOT/"commands"/name;folder.mkdir(parents=True,exist_ok=True,mode=0o700)
 binding={"argv":[str(x) for x in argv],"cwd":str(APP),"timeout":timeout}
 request_path=folder/"request.json";pubjson(request_path,binding);request_sha=record(request_path)["sha256"]
 receipt=folder/"result.json"
 if receipt.exists():
  value=command_file(receipt)
  require(value["request"]==binding and value["returncode"]==0,"Original command result needs reconciliation: "+name)
  for channel in ("stdout","stderr"):
   require(value[channel]["path"]==str(folder/channel),"Original completed command log path differs")
   same(value[channel],folder/channel)
  emit("COMMAND_REUSED",name=name);return value
 completed,failed=command_retained_attempts(folder,binding,request_sha)
 if completed:
  value=command_promote(folder,completed[0]);emit("COMMAND_RECONCILED",name=name,attemptId=value.get("attemptId"),reusedOriginalLogs=True);return value
 require(not (folder/"stdout").exists() and not (folder/"stderr").exists(),"Unbound promoted command logs require original reconciliation")
 if failed:emit("COMMAND_RESUMING_AFTER_KNOWN_EXIT",name=name,previousAttempts=len(failed),lastReturncode=max(failed,key=lambda value:value["started"]).get("returncode"))
 run=str(uuid.uuid4());outpath=folder/("stdout-"+run);errpath=folder/("stderr-"+run)
 attempt_path=folder/("attempt-"+run+".json");process_path=folder/("process-"+run+".json");dispatch_path=folder/("dispatch-"+run+".json")
 started=now();t=time.monotonic();parent=command_self()
 child=None;read_fd=None;write_fd=None;out=None;err=None;failure=None;code=None;process=None;dispatch=None;start_sent=False;intent_published=False;logs={};intent=None
 try:
  out=open(outpath,"xb");info=os.fstat(out.fileno());logs["stdout"]={"path":str(outpath),"device":info.st_dev,"inode":info.st_ino}
  err=open(errpath,"xb");info=os.fstat(err.fileno());logs["stderr"]={"path":str(errpath),"device":info.st_dev,"inode":info.st_ino}
  intent={"schema":"commons.aviary-command-attempt.v2","attemptId":run,"request":binding,"requestSha256":request_sha,
   "started":started,"parent":parent,**logs}
  pubjson(attempt_path,intent);intent_published=True
  read_fd,write_fd=os.pipe()
  target_sha=sha(b"\0".join(os.fsencode(arg) for arg in binding["argv"])+b"\0")
  bootstrap_input={"attemptId":run,"requestSha256":request_sha,"requestPath":str(request_path),"dispatchPath":str(dispatch_path),
   "argv":binding["argv"],"cwd":binding["cwd"],"targetCommandSha256":target_sha}
  bootstrap_argv=[sys.executable,"-c",COMMAND_BOOTSTRAP,str(write_fd),json.dumps(bootstrap_input,ensure_ascii=False,separators=(",",":"))]
  expected_bootstrap_sha=sha(b"\0".join(os.fsencode(arg) for arg in bootstrap_argv)+b"\0")
  child=subprocess.Popen(bootstrap_argv,cwd=APP,env=ENV,stdin=subprocess.PIPE,stdout=out,stderr=err,
   pass_fds=(write_fd,),start_new_session=True)
  os.close(write_fd);write_fd=None
  process=command_identity_pipe(read_fd,child,timeout);os.close(read_fd);read_fd=None
  require(process.get("schema")=="commons.aviary-command-process.v1" and process.get("attemptId")==run and
   process.get("requestSha256")==request_sha and process.get("namespacePid")==child.pid and
   process.get("namespaceParentPid")==parent["namespacePid"] and process.get("hostParentPid")==parent["hostPid"] and
   process.get("bootId")==parent["bootId"] and process.get("bootstrapCommandSha256")==expected_bootstrap_sha and
   process.get("targetCommandSha256")==target_sha and type(process.get("hostPid")) is int and process["hostPid"]>0 and
   type(process.get("startTicks")) is int and process["startTicks"]>0,"Original owned command process identity differs")
  require(command_process_observation(process)["status"]=="MATCHING_ORIGINAL_PROCESS","Original gated host process is not observable")
  pubjson(process_path,process)
  dispatch={"schema":"commons.aviary-command-dispatch.v1","attemptId":run,"requestSha256":request_sha,"process":process,"recordedAt":now()}
  pubjson(dispatch_path,dispatch)
  child.stdin.write(b"START\n");child.stdin.flush();start_sent=True;child.stdin.close()
  emit("COMMAND_STARTED",name=name,pid=child.pid,hostPid=process["hostPid"],attemptId=run,requestSha256=request_sha)
  code=child.wait(timeout=timeout)
 except BaseException as error:
  failure=error
  if child is not None:
   try:code=command_drain_owned(child)
   except BaseException as cleanup_error:
    emit("COMMAND_DRAIN_UNRESOLVED",name=name,attemptId=run,errorType=type(cleanup_error).__name__,originalErrorType=type(error).__name__)
 finally:
  if child is not None and child.stdin is not None:
   with contextlib.suppress(OSError):child.stdin.close()
  for fd in (read_fd,write_fd):
   if fd is not None:
    with contextlib.suppress(OSError):os.close(fd)
  for handle in (out,err):
   if handle is not None:
    try:handle.flush();os.fsync(handle.fileno())
    except BaseException as sync_error:
     if failure is None:failure=sync_error
    finally:handle.close()
 if not intent_published and attempt_path.exists():
  require(intent is not None and command_file(attempt_path)==intent,"Original attempt publication needs reconciliation")
  intent_published=True
 if not intent_published:
  # These exclusive files never had a child. Remove only this invocation's
  # unpublished empty log inodes; every recorded attempt remains immutable.
  require(child is None,"Unrecorded command unexpectedly acquired a child")
  for owned in logs.values():
   path=Path(owned["path"])
   with contextlib.suppress(FileNotFoundError):
    info=path.lstat();require(stat.S_ISREG(info.st_mode) and info.st_size==0 and (info.st_dev,info.st_ino)==(owned["device"],owned["inode"]),"Unpublished command log changed");path.unlink()
  raise failure or RuntimeError("Original command intent was not published")
 if child is not None and child.returncode is None:
  raise failure or RuntimeError("Original command remains unresolved; retain its attempt without redispatch")
 value={"schema":"commons.aviary-command-terminal.v2","state":"DRAINED" if child is not None else "NOT_DISPATCHED","attemptId":run,
  "request":binding,"requestSha256":request_sha,"started":started,"completed":now(),"seconds":time.monotonic()-t,
  "pid":child.pid if child is not None else None,"returncode":code,"startSent":start_sent,
  "processSha256":record(process_path)["sha256"] if process_path.exists() else None,
  "dispatchSha256":record(dispatch_path)["sha256"] if dispatch_path.exists() else None,
  "stdout":record(outpath),"stderr":record(errpath),"errorType":type(failure).__name__ if failure is not None else None}
 try:pubjson(folder/("attempt-result-"+run+".json"),value)
 except BaseException:
  if failure is not None:raise failure
  raise
 emit("COMMAND_DRAINED",name=name,attemptId=run,returncode=code,seconds=value["seconds"],
  stdoutTail=outpath.read_text("utf-8",errors="replace")[-3000:],stderrTail=errpath.read_text("utf-8",errors="replace")[-3000:])
 if failure is not None:raise failure
 require(code==0,"Original command did not complete: "+name)
 return command_promote(folder,value)
def inventory(root,exclude_pixels=True,ignored_roots=()):
 entries=[]
 for p in sorted(Path(root).rglob("*")):
  rel=p.relative_to(root).as_posix()
  if rel.split("/")[0] in ignored_roots:continue
  if p.is_dir():continue
  require(p.is_file() and not p.is_symlink(),"Nonregular deliverable member")
  rel=p.relative_to(root).as_posix()
  if exclude_pixels and p.suffix.lower() in (".png",".jpg",".jpeg",".webp"):
   continue
  if p.name.endswith(".lock") or p.name in (".aviary.lock",".receiving.lock"):continue
  if "__pycache__" in p.parts:continue
  entries.append({"path":rel,**{k:v for k,v in record(p).items() if k!="path"}})
 return entries
def zip_selected(output,items,manifest_meta):
 output=Path(output);declared=[]
 for name,p in items:
  validrel(name);require(name!="DELIVERY_MEMBERS.json","Reserved manifest name")
  declared.append({"path":name,**{k:v for k,v in record(p).items() if k!="path"}})
 require(len({x["path"] for x in declared})==len(declared),"Duplicate delivery item")
 manifest={"schema":"commons.aviary.complete-delivery-members.v1","operation":OP,**manifest_meta,"files":declared}
 raw=encoded(manifest)
 if output.exists():
  with zipfile.ZipFile(output) as z:
   require(z.read("DELIVERY_MEMBERS.json")==raw,"Existing original delivery manifest differs")
 else:
  output.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
  fd,tmp=tempfile.mkstemp(prefix=".aviary-archive-",dir=output.parent);os.close(fd)
  try:
   with zipfile.ZipFile(tmp,"w",compression=zipfile.ZIP_DEFLATED,compresslevel=6) as z:
    for name,p in items:z.write(p,name)
    z.writestr("DELIVERY_MEMBERS.json",raw)
   with open(tmp,"rb") as f:os.fsync(f.fileno())
   try:os.link(tmp,output)
   except FileExistsError:raise RuntimeError("Concurrent archive publication requires original reconciliation")
   syncdir(output.parent)
  finally:
   with contextlib.suppress(FileNotFoundError):os.unlink(tmp)
 with zipfile.ZipFile(output) as z:
  require(set(z.namelist())=={x["path"] for x in declared}|{"DELIVERY_MEMBERS.json"},"Delivery member inventory differs")
  for r in declared:
   h=hashlib.sha256();n=0
   with z.open(r["path"]) as inp:
    for b in iter(lambda:inp.read(262144),b""):h.update(b);n+=len(b)
   require(n==r["bytes"] and h.hexdigest()==r["sha256"],"Delivery ZIP member differs")
 return record(output)
def safe_save_diagnostic(value):
 if isinstance(value,dict):
  return {key:("[redacted]" if key.lower() in ("authorization","cookie","set-cookie","token","api_key","apikey") else safe_save_diagnostic(item)) for key,item in value.items()}
 if isinstance(value,list):return [safe_save_diagnostic(item) for item in value]
 if isinstance(value,str):
  return re.sub(r'https?://[^\s"<>]+',lambda match:match.group(0).split("?",1)[0].split("#",1)[0]+("?[redacted]" if "?" in match.group(0) else ""),value)
 return value
def save_result(value,path):
 rows=value.get("results") if isinstance(value,dict) else None
 require(isinstance(rows,list) and len(rows)==1,"Original ordered Library result count differs")
 item=rows[0]
 require(isinstance(item,dict) and item.get("local_path")==str(path)
         and item.get("purpose")=="create_library_file" and item.get("status")=="succeeded"
         and isinstance(item.get("file_id"),str) and item["file_id"]
         and isinstance(item.get("library_file_id"),str) and item["library_file_id"],
         "Original Library save is incomplete or mismatched")
 return item
def finish_saved_artifact(path,kept,reused):
 rec=record(path)
 require(kept["source"]==rec and kept["staged"]==rec
         and kept["transferSourceKind"]=="private-original","Original saved artifact identity differs")
 item=save_result(kept["providerReceipt"],path)
 require(kept["result"]=={k:item.get(k) for k in kept["result"]},"Original save result changed")
 emit("ARTIFACT_SAVED",**kept["result"],bytes=rec["bytes"],sha256=rec["sha256"],reused=reused)
 try:pubjson(SHARED/"receipts"/(Path(path).name+".json"),kept)
 except OSError as error:emit("SHARED_SAVE_RECEIPT_PENDING",name=Path(path).name,errorType=type(error).__name__,library_file_id=item["library_file_id"])
 return kept
def save_artifact(path):
 path=Path(path);rec=record(path);name=path.name
 folder=ROOT/"library-receipts";folder.mkdir(parents=True,exist_ok=True,mode=0o700)
 journal=folder/(name+".json")
 if journal.exists():return finish_saved_artifact(path,readjson(journal),True)
 request={"uploads":[{"local_path":str(path),"purpose":"create_library_file","library_artifact_type":"other"}]}
 attempt=folder/(name+".attempt.json");terminal=folder/(name+".process-result.json")
 stdout=folder/(name+".stdout");stderr=folder/(name+".stderr")
 recovered=attempt.exists();code=None;exit_observed=False
 if recovered:
  prior=readjson(attempt)
  require(prior["source"]==rec and prior["request"]==request,"Original Library write input changed")
  require(stdout.is_file(),"Original Library write is unresolved; no upload was repeated")
  try:value=readjson(stdout);save_result(value,path)
  except (OSError,ValueError,TypeError,KeyError,RuntimeError) as error:
   raise RuntimeError("Original Library write has no complete successful response; no upload was repeated: "+name) from error
  if terminal.exists():
   observed=readjson(terminal);require(observed["request"]==request,"Original uploader terminal request changed")
   same(observed["stdout"],stdout);same(observed["stderr"],stderr)
   code=observed["returncode"];exit_observed=observed["processExitObserved"]
 else:
  state=ROOT/"library-state"/name;state.mkdir(parents=True,exist_ok=True,mode=0o700)
  env={**ENV,"COMMONS_LIBRARY_UPLOAD_STATE_PARENT":str(state)}
  pubjson(attempt,{"source":rec,"request":request,"started":now()})
  with open(stdout,"xb") as output,open(stderr,"xb") as errors:
   child=subprocess.Popen([sys.executable,"-B",str(ROOT/"library_upload_private_state.py")],
                          stdin=subprocess.PIPE,stdout=output,stderr=errors,env=env,cwd=ROOT,start_new_session=True)
   try:
    observation={"namespacePid":child.pid,"parentNamespacePid":os.getpid(),
                 "parentProcSelfStat":Path("/proc/self/stat").read_text(),
                 "bootId":Path("/proc/sys/kernel/random/boot_id").read_text().strip()}
    pubjson(folder/(name+".process.json"),{"request":request,"observed":observation,"started":now()})
    child.communicate(json.dumps(request).encode(),timeout=600)
   except BaseException:
    if child.poll() is None:
     with contextlib.suppress(ProcessLookupError):child.terminate()
     try:child.wait(timeout=10)
     except subprocess.TimeoutExpired:
      with contextlib.suppress(ProcessLookupError):child.kill()
      child.wait()
    raise
   finally:
    output.flush();errors.flush();os.fsync(output.fileno());os.fsync(errors.fileno())
   code=child.returncode;exit_observed=True
  pubjson(terminal,{"request":request,"returncode":code,"processExitObserved":True,
                    "completed":now(),"stdout":record(stdout),"stderr":record(stderr)})
  try:value=readjson(stdout)
  except (OSError,ValueError,TypeError) as error:
   emit("CANONICAL_SAVE_ERROR",name=name,returncode=code,
        stdout=record(stdout),stderr=record(stderr),
        stdoutTail=safe_save_diagnostic(stdout.read_text("utf-8",errors="replace")[-6000:]),
        stderrTail=safe_save_diagnostic(stderr.read_text("utf-8",errors="replace")[-6000:]))
   raise RuntimeError("Original canonical save response is incomplete: "+name) from error
 emit("CANONICAL_SAVE_RESPONSE",name=name,recovered=recovered,returncode=code,response=safe_save_diagnostic(value))
 item=save_result(value,path);same(rec,path)
 kept={"source":rec,"staged":rec,"transferSourceKind":"private-original","providerReceipt":value,
       "result":{k:item.get(k) for k in ("local_path","purpose","status","file_id","library_file_id","file_name","current_version_number","local_metadata_applied")},
       "saved":now(),"responseReconciled":recovered,"observedExitCode":code,"processExitObserved":exit_observed,
       "verification":"ordered complete canonical workflow response and exact original private bytes"}
 pubjson(journal,kept)
 return finish_saved_artifact(path,kept,recovered)


def validate_visual_record(value,screens):
 require(isinstance(value,dict) and value.get("schema")=="commons.aviary.visual-inspection.v1"
         and value.get("operation")==OP and value.get("sourceScreenshots")==screens,
         "Original visual inspection binding differs")
 expected={Path(item["path"]).name:item for item in screens}
 rows=value.get("images")
 require(len(expected)==4 and isinstance(rows,list) and len(rows)==4
         and {item.get("name") for item in rows}==set(expected),
         "Original visual inspection has an incomplete image set")
 for item in rows:
  require(item.get("sha256")==expected[item["name"]]["sha256"]
          and item.get("decision")=="ACCEPTED" and isinstance(item.get("findings"),list),
          "Original visual inspection is not an accepted exact image observation")
 require(isinstance(value.get("summary"),str) and value["summary"],
         "Original visual inspection findings are absent")
 return value

def retain_local_visual_sources(screens):
 approved=ROOT/"visual-inspection.json"
 reviewed=validate_visual_record(readjson(approved),screens) if approved.exists() else None
 rows=[]
 for item in screens:
  local=Path(item["path"]);shared=SHARED/"qa"/local.name
  require(local.is_relative_to(ROOT/"browser-receiving"),"Original QA source left the browser output")
  if not local.exists() and shared.exists():
   same(item,shared);copy_exact(shared,local,item)
  if local.exists():
   same(item,local)
   try:copy_exact(local,shared,item);visible=str(shared)
   except OSError as error:
    emit("QA_SHARED_COPY_UNAVAILABLE",name=local.name,errorType=type(error).__name__);visible=str(local)
  else:
   require(reviewed is not None,
           "Original unreviewed QA pixels are unavailable; retain the completed workspace and recover those local images")
   visible=None
  rows.append({**item,"inspectionPath":visible,"pixelsPreviouslyInspected":reviewed is not None})
 # This record contains only descriptors. Pixel bytes remain in the native workspace.
 custody={"schema":"commons.aviary.local-visual-custody.v1","operation":OP,
          "sourceScreenshots":screens,"images":rows,"customerPixelFilesSaved":False}
 path=ROOT/"local-visual-custody.json"
 if path.exists():
  original=readjson(path)
  require(original.get("schema")==custody["schema"] and original.get("operation")==OP
          and original.get("sourceScreenshots")==screens,"Original local QA custody changed")
  return original
 pubjson(path,custody);return custody

def private_checkpoint_screens():
 path=ROOT/"browser-receiving"/"browser-receiving-result.json"
 if not path.exists():return []
 rows=readjson(path).get("screenshots",[])
 if not rows:return []
 require(isinstance(rows,list) and len(rows)==4,"The original browser checkpoint has an invalid screenshot set")
 for item in rows:
  selected=Path(item["path"])
  require(selected.is_relative_to(ROOT/"browser-receiving")
          and type(item.get("bytes")) is int and item["bytes"]>0
          and isinstance(item.get("sha256"),str) and re.fullmatch(r"[0-9a-f]{64}",item["sha256"]),
          "A private checkpoint screenshot is not bound to the original browser")
 if not all(Path(item["path"]).is_file() for item in rows):return []
 for item in rows:same(item,item["path"])
 return rows

def checkpoint_items(private_screens=()):
 items=[]
 ignored={"tmp","library-state","library-receipts","checkpoints","deliverables","restore"}
 pixels=set()
 retained_pixels={str(Path(item["path"]).relative_to(ROOT)) for item in private_screens}
 browser_result=ROOT/"browser-receiving"/"browser-receiving-result.json"
 if browser_result.exists():
  for item in readjson(browser_result).get("screenshots",[]):
   selected=Path(item["path"])
   require(selected.is_relative_to(ROOT/"browser-receiving"),"Checkpoint QA path left its browser root")
   pixels.add(selected.relative_to(ROOT).as_posix())
 allowed={"application","public-example","public-workspace","public-workspace-deliveries",
          "browser-receiving","commands","producer-source","original-manifests","failures"}
 singles={"source-input.json","complete_aviary_delivery.py","library_upload_private_state.py",
          "source-verification.json","archive-restoration.json","accepted-native-before.json",
          "original-provider-before.json","public-initialization.json",
          "local-visual-custody.json","visual-inspection.json"}
 for item in inventory(ROOT,exclude_pixels=False,ignored_roots=tuple(ignored)):
  name=item["path"];parts=PurePosixPath(name).parts
  if parts[0] not in allowed and name not in singles:continue
  if name not in retained_pixels and (name in pixels or (parts[0]=="browser-receiving" and
                       (".png" in PurePosixPath(name).name.lower() or "tmp" in parts or name.endswith(".pending")))):
   continue
  items.append(("root/"+name,ROOT/name))
 return items

def original_commands_quiet():
 folder=ROOT/"commands"
 if not folder.exists():return
 for selected in sorted(folder.iterdir()):
  require(selected.is_dir() and not selected.is_symlink(),"Unexpected command journal member")
  request=selected/"request.json"
  if request.exists():command_retained_attempts(selected,readjson(request),record(request)["sha256"])

def preserve_receiving_checkpoint(phase,failure=None):
 require(phase in ("BROWSER_COMPLETE_VISUAL_PENDING","INTERRUPTED_RECEIVING"),
         "Unknown original receiving checkpoint phase")
 original_commands_quiet()
 anchor=ROOT/"checkpoints"/"browser-complete-checkpoint.json"
 browser_result=ROOT/"browser-receiving"/"browser-receiving-result.json"
 if phase=="BROWSER_COMPLETE_VISUAL_PENDING" and anchor.exists():
  retained=readjson(anchor)
  require(retained.get("schema")=="commons.aviary.receiving-checkpoint.v1"
          and retained.get("operation")==OP and retained.get("phase")==phase
          and retained.get("browserResult")==record(browser_result),
          "The saved browser checkpoint belongs to another original result")
  same(retained["source"],retained["source"]["path"])
  saved=save_artifact(retained["source"]["path"])
  require(saved==retained["providerReceipt"],"The original browser checkpoint save receipt differs")
  emit("RECEIVING_CHECKPOINT_REUSED",phase=phase,source=retained["source"],
       library_file_id=saved["result"]["library_file_id"],
       privateRecoveryPixelsIncluded=retained.get("pixelFilesSaved",False),customerPixelFilesSaved=False)
  return retained
 screens=private_checkpoint_screens()
 items=checkpoint_items(screens)
 require(items and any(name=="root/source-input.json" for name,_ in items),
         "Original receiving checkpoint lacks its full source")
 descriptor=[{"path":name,**{key:value for key,value in record(path).items() if key!="path"}}
             for name,path in items]
 meta={"kind":"original-aviary-receiving-checkpoint","phase":phase,"root":str(ROOT),
       "sourcePacketSha256":SOURCE_SHA,"nativeWorkspaceId":WORKSPACE_ID,
       "originalProviderOperation":PROVIDER_OPERATION,"originalArchives":ARCHIVES,
       "checkpointRevision":2,"pixelsIncluded":bool(screens),
       "localQAScreenshotDescriptors":screens,"pixelPurpose":"private-recovery-only",
       "customerPixelFilesSaved":False,"failure":failure}
 snapshot_sha=sha(encoded({"metadata":meta,"files":descriptor}))
 path=ROOT/"checkpoints"/("Aviary_Receiving_Checkpoint_"+snapshot_sha[:16]+".zip")
 zip_selected(path,items,meta)
 saved=save_artifact(path)
 checkpoint={"schema":"commons.aviary.receiving-checkpoint.v1","operation":OP,
             "phase":phase,"snapshotSha256":snapshot_sha,"source":record(path),
             "providerReceipt":saved,"pixelFilesSaved":bool(screens),
             "pixelPurpose":"private-recovery-only","customerPixelFilesSaved":False,
             "browserResult":record(browser_result) if browser_result.exists() else None}
 pubjson(ROOT/"checkpoints"/(path.name+".receipt.json"),checkpoint)
 if phase=="BROWSER_COMPLETE_VISUAL_PENDING":pubjson(anchor,checkpoint)
 emit("RECEIVING_CHECKPOINT_SAVED",phase=phase,source=checkpoint["source"],
      file_id=saved["result"]["file_id"],library_file_id=saved["result"]["library_file_id"],
      privateRecoveryPixelsIncluded=bool(screens),customerPixelFilesSaved=False,saveReceipt=saved)
 return checkpoint

def restore_receiving_checkpoint(selected):
 if selected is None:return
 require(isinstance(selected,dict) and set(selected)=={"path","bytes","sha256","file_id","library_file_id","saveReceipt"},
         "The original checkpoint selection needs its exact saved source and receipt")
 path=Path(selected["path"]);require(path.is_absolute() and not path.is_symlink(),
         "The original checkpoint must be an already-authorized local regular file")
 saved=selected["saveReceipt"]
 require(isinstance(saved,dict) and saved.get("transferSourceKind")=="private-original",
         "The original checkpoint has no original canonical save receipt")
 destination=Path(saved["source"]["path"])
 require(destination.parent==ROOT/"checkpoints" and
         re.fullmatch(r"Aviary_Receiving_Checkpoint_[0-9a-f]{16}\.zip",destination.name),
         "The original saved checkpoint path differs")
 same(selected,path)
 require(saved["source"].get("bytes")==selected["bytes"] and saved["source"].get("sha256")==selected["sha256"]
         and saved["staged"]==saved["source"],"The original saved checkpoint identity differs")
 returned=save_result(saved["providerReceipt"],destination)
 require(returned["file_id"]==selected["file_id"] and returned["library_file_id"]==selected["library_file_id"],
         "The original checkpoint's saved file IDs differ")
 with open(path,"rb") as held:
  before=os.fstat(held.fileno());require(stat.S_ISREG(before.st_mode),"Checkpoint source is not regular")
  digest=hashlib.sha256()
  for block in iter(lambda:held.read(262144),b""):digest.update(block)
  require(before.st_size==selected["bytes"] and digest.hexdigest()==selected["sha256"],
          "The held checkpoint differs from the original selected bytes")
  held.seek(0)
  with zipfile.ZipFile(held) as archive:
   infos=archive.infolist();names=[info.filename for info in infos]
   require(len(names)==len(set(names)) and all(not info.is_dir() for info in infos),
           "The checkpoint contains duplicate or unexpected directory entries")
   for info in infos:
    validrel(info.filename);mode=(info.external_attr>>16)&0xffff
    require(stat.S_IFMT(mode) in (0,stat.S_IFREG),"The checkpoint contains a nonregular member")
   raw=archive.read("DELIVERY_MEMBERS.json");manifest=json.loads(raw)
   require(manifest.get("schema")=="commons.aviary.complete-delivery-members.v1"
           and manifest.get("operation")==OP
           and manifest.get("kind")=="original-aviary-receiving-checkpoint"
           and manifest.get("phase") in ("BROWSER_COMPLETE_VISUAL_PENDING","INTERRUPTED_RECEIVING")
           and manifest.get("root")==str(ROOT)
           and manifest.get("sourcePacketSha256")==SOURCE_SHA
           and manifest.get("nativeWorkspaceId")==WORKSPACE_ID
           and manifest.get("originalProviderOperation")==PROVIDER_OPERATION
           and manifest.get("originalArchives")==ARCHIVES
           and type(manifest.get("pixelsIncluded")) is bool
           and manifest.get("checkpointRevision",1) in (1,2),
           "The checkpoint belongs to another original source or operation")
   if manifest.get("checkpointRevision",1)==1:
    require(manifest["pixelsIncluded"] is False,"The original v1 checkpoint unexpectedly includes QA pixels")
   else:
    require(manifest.get("pixelPurpose")=="private-recovery-only"
            and manifest.get("customerPixelFilesSaved") is False,
            "The checkpoint changed the retained image purpose")
   declared={}
   for item in manifest["files"]:
    name=item["path"];parts=validrel(name).parts
    require(parts[0]=="root" and len(parts)>1 and name not in declared,
            "The checkpoint member left its original root or is duplicated")
    require(type(item["bytes"]) is int and item["bytes"]>=0
            and isinstance(item["sha256"],str) and re.fullmatch(r"[0-9a-f]{64}",item["sha256"]),
            "Invalid checkpoint member identity")
    declared[name]=item
   require(set(names)==set(declared)|{"DELIVERY_MEMBERS.json"},
           "The checkpoint inventory differs from its complete manifest")
   for name,item in declared.items():
    check=hashlib.sha256();count=0
    with archive.open(name) as stream:
     for block in iter(lambda:stream.read(262144),b""):check.update(block);count+=len(block)
    require(count==item["bytes"] and check.hexdigest()==item["sha256"],
            "An original checkpoint member changed: "+name)
   if manifest["pixelsIncluded"]:
    result_name="root/browser-receiving/browser-receiving-result.json"
    require(result_name in declared,"The private image checkpoint lacks its original browser result")
    model=json.loads(archive.read(result_name));screens=manifest.get("localQAScreenshotDescriptors")
    require(isinstance(screens,list) and len(screens)==4 and model.get("screenshots")==screens,
            "The private recovery images differ from the original browser result")
    for item in screens:
     original=Path(item["path"])
     require(original.is_relative_to(ROOT/"browser-receiving"),
             "A private recovery image left the original browser output")
     member="root/"+original.relative_to(ROOT).as_posix()
     require(member in declared and declared[member]["bytes"]==item["bytes"]
             and declared[member]["sha256"]==item["sha256"],
             "An original private recovery PNG is missing or changed")
   # Verify every archive member before publishing any restored member.
   for name,item in declared.items():
    dest=beneath(ROOT,str(PurePosixPath(name).relative_to("root")))
    if dest.exists():same(item,dest);continue
    dest.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
    fd,temporary=tempfile.mkstemp(prefix=".aviary-checkpoint-",dir=dest.parent)
    try:
     with archive.open(name) as source,os.fdopen(fd,"wb") as output:
      shutil.copyfileobj(source,output,262144);output.flush();os.fsync(output.fileno())
     same(item,temporary)
     try:os.link(temporary,dest)
     except FileExistsError:same(item,dest)
     syncdir(dest.parent)
    finally:
     with contextlib.suppress(FileNotFoundError):os.unlink(temporary)
  after=os.fstat(held.fileno())
  require((before.st_dev,before.st_ino,before.st_size,before.st_mtime_ns,before.st_ctime_ns)==
          (after.st_dev,after.st_ino,after.st_size,after.st_mtime_ns,after.st_ctime_ns),
          "The held checkpoint source changed during restoration")
 copy_exact(path,destination,selected)
 pubjson(ROOT/"library-receipts"/(destination.name+".json"),saved)
 if manifest["phase"]=="BROWSER_COMPLETE_VISUAL_PENDING":
  metadata={key:value for key,value in manifest.items() if key not in {"schema","operation","files"}}
  checkpoint={"schema":"commons.aviary.receiving-checkpoint.v1","operation":OP,
              "phase":manifest["phase"],"snapshotSha256":sha(encoded({"metadata":metadata,"files":manifest["files"]})),
              "source":record(destination),"providerReceipt":saved,"pixelFilesSaved":manifest["pixelsIncluded"],
              "browserResult":record(ROOT/"browser-receiving"/"browser-receiving-result.json")}
  if manifest.get("checkpointRevision",1)==2:
   checkpoint.update(pixelPurpose="private-recovery-only",customerPixelFilesSaved=False)
  pubjson(ROOT/"checkpoints"/(destination.name+".receipt.json"),checkpoint)
  pubjson(ROOT/"checkpoints"/"browser-complete-checkpoint.json",checkpoint)
 pubjson(ROOT/"restore"/("checkpoint-"+selected["sha256"]+".json"),
         {"schema":"commons.aviary.checkpoint-restoration.v1","operation":OP,
          "source":record(path),"restoredMembers":len(declared),
          "originalSavedFileId":selected["file_id"],"originalLibraryFileId":selected["library_file_id"],
          "saveReceipt":saved,"newProviderInvocations":0,"newCheckpointUploads":0})
 emit("ORIGINAL_CHECKPOINT_RESTORED",members=len(declared),sha256=selected["sha256"],
      library_file_id=selected["library_file_id"],newCheckpointUploads=0)

def wait_visual(screens):
 saved=ROOT/"visual-inspection.json"
 if saved.exists():
  return validate_visual_record(readjson(saved),screens)
 qa=[]
 for r in screens:
  same(r,r["path"]);dest=SHARED/"qa"/Path(r["path"]).name
  try:copy_exact(r["path"],dest,r);visible=str(dest)
  except OSError as e:
   emit("QA_SHARED_COPY_UNAVAILABLE",name=Path(r["path"]).name,error=str(e));visible=r["path"]
  qa.append({**r,"inspectionPath":visible})
 emit("READY_FOR_VISUAL_REVIEW",screenshots=qa,requestedInput={"action":"complete-visual-review","summary":"actual visual findings","images":[{"name":Path(r["path"]).name,"sha256":r["sha256"],"decision":"ACCEPTED","findings":[]} for r in screens]},timeoutSeconds=1800)
 deadline=time.monotonic()+1800
 while time.monotonic()<deadline:
  ready,_,_=select.select([sys.stdin.fileno()],[],[],1)
  if not ready:continue
  line=bytearray()
  while not line.endswith(b"\n"):
   b=os.read(sys.stdin.fileno(),1)
   require(b,"Producing input closed before visual inspection");line.extend(b);require(len(line)<131072,"Review input too large")
  command=json.loads(line)
  if command.get("action")=="read-qa-image":
   wanted=next((r for r in screens if Path(r["path"]).name==command.get("name")),None)
   require(wanted is not None,"Unbound QA image request")
   same(wanted,wanted["path"]);raw=Path(wanted["path"]).read_bytes()
   if "offset" in command or "length" in command:
    offset=command.get("offset",0);length=command.get("length",6144)
    require(type(offset) is int and 0<=offset<len(raw) and type(length) is int and 1<=length<=12288,
            "Invalid original image chunk range")
    block=raw[offset:offset+length]
    emit("QA_IMAGE_CHUNK",name=command["name"],sha256=wanted["sha256"],bytes=len(raw),
         offset=offset,chunkBytes=len(block),complete=offset+len(block)==len(raw),
         base64=base64.b64encode(block).decode())
   else:
    emit("QA_IMAGE",name=command["name"],sha256=wanted["sha256"],base64=base64.b64encode(raw).decode())
   continue
  require(command.get("action")=="complete-visual-review","Unknown visual receiving command")
  rows=command.get("images")
  require(isinstance(rows,list) and len(rows)==4,"All four original PNGs require actual inspection")
  expected={Path(r["path"]).name:r for r in screens}
  require({r.get("name") for r in rows}==set(expected),"Visual review image set differs")
  for r in rows:require(r.get("sha256")==expected[r["name"]]["sha256"] and r.get("decision")=="ACCEPTED" and isinstance(r.get("findings"),list),"Original visual decision is incomplete")
  require(isinstance(command.get("summary"),str) and command["summary"],"Visual findings absent")
  v={"schema":"commons.aviary.visual-inspection.v1","operation":OP,"inspectedAt":now(),"sourceScreenshots":screens,"summary":command["summary"],"images":rows,"pixelFiles":"LOCAL_QA_NOT_DELIVERABLES"}
  pubjson(saved,v);return v
 raise RuntimeError("Visual review deadline reached; original PNGs and browser result retained")
def retain_source_correction(packet):
 correction=PAYLOAD.get("sourceCorrection")
 require(isinstance(correction,dict) and correction.get("schema")=="commons.aviary.supplemental-source-correction.v1"
         and correction.get("operation")==OP,"The exact original mapping correction is absent")
 selected={item["path"]:item for item in packet["files"]}
 require(len(selected)==20,"Selected complete source contains duplicate members")
 original=json.loads(json.dumps(correction["originalPacketTemplate"],ensure_ascii=False))
 order=original["files"]
 require(isinstance(order,list) and len(order)==20 and set(order)==set(selected),
         "Original complete source member order differs")
 previous_members=correction["originalMembers"]
 require(isinstance(previous_members,list) and len(previous_members)==1
         and previous_members[0]["path"]=="examples/usgs-example-input.json",
         "The source correction must retain exactly its original example member")
 previous=previous_members[0];changed_path=previous["path"]
 original["files"]=[previous if path==changed_path else selected[path] for path in order]
 original_raw=(json.dumps(original,ensure_ascii=False,indent=2,allow_nan=False)+"\n").encode()
 require(len(original_raw)==601618 and sha(original_raw)=="12da23f08cda04634318e6944c071286348effc0ec88ed63fa79cceaa61e34bf",
         "The exact preceding complete source cannot be reconstructed")
 require(correction["originalSourcePacket"]=={"bytes":len(original_raw),"sha256":sha(original_raw)}
         and correction["selectedSourcePacket"]=={"bytes":len(PAYLOAD["sourcePacket"].encode()),"sha256":SOURCE_SHA},
         "Original and selected source identities changed")
 old_doc=json.loads(previous["content"]);new_doc=json.loads(selected[changed_path]["content"])
 expected=json.loads(previous["content"])
 require(expected["mapping"]["tables"]["supplemental"]["columns"].pop("Sequence #")=="sequence"
         and expected["mapping"]["tables"]["supplemental"]["ignoredColumns"]==["attachment_key"],
         "The original failed supplemental mapping differs")
 expected["mapping"]["tables"]["supplemental"]["ignoredColumns"].append("sequence")
 expected["mapping"]["note"]+=(" Supplemental source sequence values remain in the exact original CSV and are explicitly unmapped: "
   "this application's supplemental import sends no sequence or sort parameter and retains original CSV row order. "
   "No provider-side supplemental ordering is claimed. The original rejected Sequence # mapping and its receiving failure are retained in the delivery history.")
 require(new_doc==expected and new_doc["files"]==old_doc["files"],
         "The supplemental correction changed an unrelated mapping or source file")
 require(len(selected[changed_path]["content"].encode())==18329
         and sha(selected[changed_path]["content"].encode())=="080565897337c1c0d352c3ac238368271f93b25f18e00c8a06528b82677b6e03",
         "The corrected example bytes differ")
 ancestors={item["sha256"]:item for item in PAYLOAD["producerAncestors"]}
 previous_program=ancestors["6347c3a562dfcff119b4ea83f3ddc84f7091a03adbc70ea6ec5923f898078b98"]["content"]
 previous_guide=correction["originalProducerGuide"]
 require(len(previous_guide.encode())==15321
         and sha(previous_guide.encode())=="57b84e93a575e7fd5f1b22559effd9afe6795e93ef11ea00dd56c9992536c818",
         "The original complete producer guide changed")
 prior_input={"schema":correction["originalInputSchema"],"sourcePacket":original_raw.decode(),
              "caller":PAYLOAD["caller"],"program":previous_program,
              "producerAncestors":[ancestors[key] for key in (
               "ff6762270c9eb821ff649b253ff3d1a9ab378dd9c4353999af226b18d126cbf3",
               "c74bfc791f70039662d4e6e0ab9875e679d2fc04edc0549db16acbf5c72bff33")],
              "producerGuide":previous_guide}
 prior_raw=(json.dumps(prior_input,ensure_ascii=False,indent=2,allow_nan=False)+"\n").encode()
 require(len(prior_raw)==832813 and sha(prior_raw)=="99fdb99fe21012f6bfe76947d72bb0fe2a402f02e90eb81eb5f762d9633569da"
         and correction["originalInput"]=={"bytes":len(prior_raw),"sha256":sha(prior_raw)},
         "The complete original receiving input changed")
 history=correction["receivingHistory"].encode()
 require(len(history)==24887 and sha(history)=="2ac7d003fb075ec99dabb4ad4205cfc641b6d762dfb0e0ffd357972d84f1e54f"
         and correction["receivingHistoryIdentity"]=={"bytes":len(history),"sha256":sha(history)},
         "The original 50662 failure and reconciliation history changed")
 folder=ROOT/"producer-source"/"history-50662"
 for name,raw in (("original-source-packet.json",original_raw),("original-input.json",prior_raw),
                  ("original-usgs-example-input.json",previous["content"].encode()),
                  ("original-delivery-guide.md",previous_guide.encode()),("receiving-history.json",history)):
  publish(folder/name,raw)
 receipt={"schema":"commons.aviary.supplemental-source-correction.v1","operation":OP,
          "reason":correction["reason"],"previousSourcePacket":record(folder/"original-source-packet.json"),
          "selectedSourcePacket":{"bytes":len(PAYLOAD["sourcePacket"].encode()),"sha256":SOURCE_SHA},
          "previousInput":record(folder/"original-input.json"),"receivingHistory":record(folder/"receiving-history.json"),
          "previousExample":record(folder/"original-usgs-example-input.json"),
          "selectedExample":{key:selected[changed_path][key] for key in ("path","bytes","sha256")},
          "nativeApplicationFilesChanged":0,"sourceDataFilesChanged":0,
          "sequenceOutcome":"Retained verbatim in source CSV; explicitly ignored by the supplemental mapping; no provider ordering claimed."}
 pubjson(folder/"source-correction.json",receipt)
 emit("ORIGINAL_FAILURE_HISTORY_RETAINED",nativeSession=50662,
      history=receipt["receivingHistory"],previousInput=receipt["previousInput"],
      nativeApplicationFilesChanged=0,sourceDataFilesChanged=0)
 return {"correction":record(folder/"source-correction.json"),"history":receipt["receivingHistory"],
         "previousInput":receipt["previousInput"],"previousSourcePacket":receipt["previousSourcePacket"]}

def main():
 global APP,ENV
 ROOT.mkdir(parents=True,exist_ok=True,mode=0o700)
 try:SHARED.mkdir(parents=True,exist_ok=True,mode=0o700)
 except OSError as error:emit("SHARED_DIRECTORY_UNAVAILABLE",errorType=type(error).__name__)
 lock=open(ROOT/".delivery.lock","a+b");fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
 packet_raw=PAYLOAD["sourcePacket"].encode();require(len(packet_raw)==603245 and sha(packet_raw)==SOURCE_SHA,"Final20 source carrier differs")
 packet=json.loads(packet_raw)
 require(packet["operation"]==OP and len(packet["files"])==20,"Wrong delivery source")
 restore_receiving_checkpoint(PAYLOAD.get("restoreCheckpoint"))
 publish(ROOT/"source-input.json",packet_raw);retain_command_producer(PAYLOAD["program"])
 ancestors=PAYLOAD.get("producerAncestors",[])
 expected_ancestors={"ff6762270c9eb821ff649b253ff3d1a9ab378dd9c4353999af226b18d126cbf3":36626,
                     "c74bfc791f70039662d4e6e0ab9875e679d2fc04edc0549db16acbf5c72bff33":53244,
                      "6347c3a562dfcff119b4ea83f3ddc84f7091a03adbc70ea6ec5923f898078b98":74496}
 require(isinstance(ancestors,list) and len(ancestors)==3,"The retained complete producer lineage is absent")
 require({item.get("sha256") for item in ancestors}==set(expected_ancestors),"The retained producer lineage changed")
 for item in ancestors:
  raw=item["content"].encode()
  require(sha(raw)==item["sha256"] and len(raw)==item["bytes"]==expected_ancestors[item["sha256"]],
          "A retained ancestor producer changed")
  publish(ROOT/"producer-source"/(item["sha256"]+".py"),raw)
 source_history=retain_source_correction(packet)
 guide=PAYLOAD.get("producerGuide")
 require(isinstance(guide,str) and guide.startswith("# Aviary"),"The complete delivery/restore guide is absent")
 publish(ROOT/"producer-source"/("guide-"+sha(guide.encode())+".md"),guide.encode())
 input_raw=encoded({key:value for key,value in PAYLOAD.items() if key!="restoreCheckpoint"})
 input_path=ROOT/"producer-source"/("input-"+sha(input_raw)+".json")
 publish(input_path,input_raw)
 pubjson(ROOT/"producer-source"/("selected-"+sha(PAYLOAD["program"].encode())+".json"),
         {"schema":"commons.aviary.delivery-source-selection.v1","operation":OP,
          "program":record(ROOT/"producer-source"/(sha(PAYLOAD["program"].encode())+".py")),
          "input":record(input_path),"guide":record(ROOT/"producer-source"/("guide-"+sha(guide.encode())+".md")),
          "ancestorSha256":sorted(expected_ancestors)})
 caller=PAYLOAD["caller"].encode();require(len(caller)==4034 and sha(caller)=="d1047f61b8c6b6b3a7f24a2d1fffe4b68e6407aa146f034b18beab3824bfb39e","Canonical caller differs")
 publish(ROOT/"library_upload_private_state.py",caller)
 APP=ROOT/"application";APP.mkdir(exist_ok=True,mode=0o700)
 for r in packet["files"]:
  raw=r["content"].encode();require(len(raw)==r["bytes"] and sha(raw)==r["sha256"],"Source member differs: "+r["path"])
  publish(beneath(APP,r["path"]),raw)
  if r["path"].endswith(".py"):ast.parse(raw,filename=r["path"])
 tmp=ROOT/"tmp";tmp.mkdir(exist_ok=True,mode=0o700)
 ENV={**os.environ,"PYTHONDONTWRITEBYTECODE":"1","TMPDIR":str(tmp)}
 os.environ["TMPDIR"]=str(tmp);tempfile.tempdir=str(tmp)
 pubjson(ROOT/"source-verification.json",{"packet":{"bytes":len(packet_raw),"sha256":SOURCE_SHA},"applicationBaseMerge":"79586025b5b8916b8ea254ce43093623931b8544","sourceCorrection":source_history,"files":[{k:r[k] for k in ("path","bytes","sha256")} for r in packet["files"]],"python":sys.version,"pythonAst":"PASS"})
 emit("SOURCE_READY",files=20,root=str(ROOT),python=sys.version.split()[0])
 restored=[restore_archive(r) for r in ARCHIVES];pubjson(ROOT/"archive-restoration.json",restored)
 native=Path(ARCHIVES[0]["target"]);provider=native/"received"/"workspace"
 require((native/"receiving-result.json").is_file(),"Original complete19 receipt not at retained native root")
 accepted=readjson(native/"receiving-result.json")
 require(accepted.get("state")=="PASS" and accepted.get("operationId")==PROVIDER_OPERATION and accepted.get("workspaceId")==WORKSPACE_ID,"Original19 receiving identity differs")
 require(len(accepted.get("checks",{}))==19 and all(x is True for x in accepted["checks"].values()),"Original19 checks not complete")
 for r in accepted.get("artifacts",[]):same(r,beneath(native,r["path"]))
 require((provider/"aviary.sqlite3").is_file(),"Original received provider workspace absent")
 sys.path.insert(0,str(APP))
 import aviary as a
 a.verify_source(provider);provider_before=a.show(provider)
 require(provider_before["workspace"]["id"]==WORKSPACE_ID,"Original provider workspace ID differs")
 selected=[r for r in provider_before["runs"] if r["id"]==PROVIDER_OPERATION]
 require(len(selected)==1 and selected[0]["actions"] and all(x["state"] in ("CONFIRMED","ADOPTED") for x in selected[0]["actions"]),"Original provider action state differs")
 pubjson(ROOT/"accepted-native-before.json",accepted);pubjson(ROOT/"original-provider-before.json",provider_before)
 example=ROOT/"public-example";example.mkdir(exist_ok=True,mode=0o700)
 for r in packet["retainedPublicCaptures"]:
  retained=example/"captures"/r["id"]
  src=retained if (retained/"body.bin").exists() and (retained/"response.json").exists() else CAPTURES/r["id"]
  same(r,src/"body.bin")
  response=readjson(src/"response.json");require(response["bytes"]==r["bytes"] and response["sha256"]==r["sha256"],"Original capture descriptor differs")
  for name in ("body.bin","response.json"):copy_exact(src/name,retained/name)
 emit("ORIGINAL_NATIVE_ACCEPTED",checks=19,workspaceId=WORKSPACE_ID,operationId=PROVIDER_OPERATION,replayedProviderRequests=0,retainedBinaryCaptures=5)
 run_command("public-source",[sys.executable,"-B",APP/"examples/receive_usgs_example.py","--packet",APP/"examples/usgs-example-input.json","--directory",example,"--publisher-text-manifest",APP/"examples/usgs-publisher-text-20261012.json"],180)
 source=readjson(example/"receiving-result.json");require(source["state"]=="COMPLETE" and source["counts"]=={"resources":2,"media":3,"transcripts":1,"indexes":2,"supplemental":2},"Original public source incomplete")
 public=ROOT/"public-workspace"
 initial_path=ROOT/"public-initialization.json"
 if initial_path.exists():
  initial=readjson(initial_path);a.verify_source(public)
  current=a.show(public)
  require(current["workspace"]==initial["workspace"] and current["source"]==initial["source"],"Original initialized public workspace changed")
 else:
  initial=a.initialize(example/"source",public,a.read_json(example/"mapping.json"),"USGS public audio — original receiving")
  pubjson(initial_path,initial)
 runtime=packet["runtime"]
 for key in ("node","playwrightModule","browserExecutable"):require(Path(runtime[key]).is_file(),"Original browser dependency absent: "+key)
 browser=ROOT/"browser-receiving"
 run_command("browser",[runtime["node"],APP/"examples/run-aviary-browser-receiving.mjs","--application",APP,"--workspace",public,"--provider-workspace",provider,"--operation-id",PROVIDER_OPERATION,"--out",browser,"--python",sys.executable,"--playwright-module",runtime["playwrightModule"],"--browser-executable",runtime["browserExecutable"]],900)
 result=readjson(browser/"browser-receiving-result.json")
 require(result["state"]=="PASS" and result["originalProviderOperationId"]==PROVIDER_OPERATION and result["providerWorkspaceId"]==WORKSPACE_ID and result["providerMutationCount"]==0,"Original browser result differs")
 require(result["cleanup"]["applicationProcessesDrained"] and result["cleanup"]["browserClosed"] and result["cleanup"]["contextClosed"] and result["cleanup"]["controlLockReleased"],"Browser did not fully drain")
 require(len(result["screenshots"])==4 and not result["pageErrors"] and not result["consoleErrors"],"Browser evidence incomplete")
 for r in [result["nativePackage"],result["publicWorkspaceExport"],*result["phaseReceipts"]]:same(r,r["path"])
 require(a.show(provider)["runs"]==provider_before["runs"],"Original provider actions changed")
 retain_local_visual_sources(result["screenshots"])
 checkpoint=preserve_receiving_checkpoint("BROWSER_COMPLETE_VISUAL_PENDING")
 visual=wait_visual(result["screenshots"])
 artifacts=ROOT/"deliverables";artifacts.mkdir(exist_ok=True,mode=0o700)
 public_zip=artifacts/"Aviary_USGS_Complete_Workspace_20261012.zip";copy_exact(result["publicWorkspaceExport"]["path"],public_zip,result["publicWorkspaceExport"])
 native_zip=artifacts/"Aviary_USGS_Native_Package_20261012.zip";copy_exact(result["nativePackage"]["path"],native_zip,result["nativePackage"])
 summary={
 "schema":"commons.aviary.complete-delivery-result.v1","operation":OP,"state":"COMPLETE","completedAt":now(),
 "source":{"applicationBaseMerge":"79586025b5b8916b8ea254ce43093623931b8544","pullRequest":2164,"packetSha256":SOURCE_SHA,"files":20,"correction":source_history},
 "nativeAccepted":{"workspaceId":WORKSPACE_ID,"operationId":PROVIDER_OPERATION,"checks":accepted["checks"],"scope":accepted["scope"],"archives":restored,"replayedProviderRequests":0},
 "publicExample":source,"browser":result,"visualInspection":visual,
 "savedBrowserCheckpoint":{"source":checkpoint["source"],"result":checkpoint["providerReceipt"]["result"],"privateRecoveryPixelsIncluded":checkpoint.get("pixelFilesSaved",False),"customerPixelFilesSaved":False},
 "requestedScope":"Complete public-source application/workspace and original accepted provider-contract receiving. Deployed customer Aviary acceptance remains a separate authorized tenant activity.",
 "artifacts":[record(public_zip),record(native_zip)],
 "pixels":{"savedAsDeliverables":False,"retainedForLocalQA":True,"descriptors":result["screenshots"]}
 }
 evidence=artifacts/"Aviary_Complete_Receiving_20261012.json"
 if evidence.exists():
  original_summary=readjson(evidence)
  require({k:v for k,v in original_summary.items() if k!="completedAt"}=={k:v for k,v in summary.items() if k!="completedAt"},"Completed original report evidence changed")
  summary=original_summary
 else:pubjson(evidence,summary)
 checks="\n".join("- "+k for k,v in accepted["checks"].items() if v)
 md=f"""# Aviary complete application and receiving

The complete source mapping, five-table native package, saved migration workflow and portable application have completed the original native receiving and browser journey.

## Actual receiving result

- Original native provider-contract receiving: all 19 checks passed in the retained original operation. Its saved workspace remains {WORKSPACE_ID}; its operation is {PROVIDER_OPERATION}.
- Public example: 2 resources, 3 media records, 1 original transcript, 2 authored navigation indexes and 2 supplemental records.
- Original public binaries: all five retained exact captures were reused. Their original SHA-256 receipts and all five publisher representations are included.
- Supplemental source sequence values are retained byte for byte in the original CSV and explicitly unmapped. The maintained supplemental import sends no ordering parameter. The rejected mapping and exact 50662 failure/reconciliation remain in delivery history.
- Browser: complete mapping/key allocation, delayed-save/later typing, exclusion and restoration, all five previews, original queued native/export downloads, cold application receiving and saved-operation/new-draft continuity passed.
- Original provider mutations during this browser journey: zero. Every original provider action and ID remains retained.
- Browser pages, servers, context, browser and control children drained before the original PASS publication.
- Four desktop/narrow PNGs were actually inspected. They remain local quality evidence; image bytes are not included in the deliverables.

## Visual findings

{visual['summary']}

## Open the product

Aviary_USGS_Complete_Workspace_20261012.zip is the exact complete application/workspace downloaded in the browser. Receive it using Python 3.11 or newer:

    python3 -B application/aviary.py receive --source Aviary_USGS_Complete_Workspace_20261012.zip --output received
    python3 -B received/application/aviary.py serve --workspace received/workspace --port 8769

If starting from the full delivery archive, its application/ directory carries all 20 maintained runtime, example and guide members. The source includes the Node CLI and installed Applications entry. Read application/README.md and application/APPLICATIONS.md for those routes. The retained public sample requires no Aviary credentials for review, packaging or export.

Aviary_USGS_Native_Package_20261012.zip contains the five native Aviary CSV tables with their exact local assets and relationships. The full delivery archive also retains the previously completed API workspace and original19 evidence, the complete public example, browser phase/queue/commit receipts, complete command attempts and terminal logs, retained producer source and adoption records, exact source pins and both original accepted archives. A complete private recovery checkpoint was saved before visual inspection, including the four original bound PNGs for that unfinished review; its original returned file identity is recorded in the receiving evidence. Screenshot pixels are excluded from the customer deliverables.

## Source, rights and interpretation

The supplied USGS recordings and photographs retain their original publisher public-domain statements. The CoreFacts text is extracted from its retained original publisher transcript; it is not invented transcription. The two VTT navigation files are authored index intervals using publisher durations, not source speech transcripts. Original URLs, received bytes, dates, representation types and extraction method are in public-example/source/provenance.

The native service exercise uses the actual application and a pinned-contract loopback receiver. It establishes application/API/storage recovery, not acceptance by a deployed customer Aviary organization or a real media-transcoding service. A customer's original organization, collection, source rights and credentials remain explicit decisions in a real receiving plan.

## Original native acceptance

{checks}

## Exact provenance

Native application base: https://github.com/woahwhattheheck/public-commons-sprint-2026/pull/2164
Application base merge: 79586025b5b8916b8ea254ce43093623931b8544
Selected20 carrier SHA256: {SOURCE_SHA}
The only selected application-packet correction is the explicit supplemental example mapping. All nineteen other source members and every original source data file remain byte-identical. Original complete input and failed-run evidence are in delivery-history/producer-source/history-50662/.
Official Aviary OpenAPI source: https://www.aviaryplatform.com/aviary-api.json
Original schema capture: 200,348 bytes; SHA2561bf29e93ede6bc7aa755be25603e1fed4ddb899dac1964f4f63eaaca930c1291; retrieved2026-10-12T09:20:11.412169+00:00.
Original provider/importer source: https://github.com/WeAreAVP/aviary-api-scripts/tree/9f189144f6434e6561696983edce17494aa66dd0

The complete machine-readable result records every source, package, screenshot descriptor, original job ID and checked phase. Its actual evidence must remain alongside this report.
"""
 reportmd=artifacts/"Aviary_Operator_Receiving_20261012.md";publish(reportmd,md.encode())
 reporthtml=artifacts/"Aviary_Operator_Receiving_20261012.html"
 blocks=[]
 for block in md.strip().split("\n\n"):
  lines=block.splitlines()
  if block.startswith("    "):blocks.append("<pre><code>"+html.escape("\n".join(x[4:] if x.startswith("    ") else x for x in lines))+"</code></pre>")
  elif block.startswith("#"):
   level=min(3,len(block)-len(block.lstrip("#")));blocks.append("<h"+str(level)+">"+html.escape(block[level:].strip())+"</h"+str(level)+">")
  elif block.startswith("- "):blocks.append("<ul>"+"".join("<li>"+html.escape(x[2:] if x.startswith("- ") else x)+"</li>" for x in lines)+"</ul>")
  else:blocks.append("<p>"+html.escape(" ".join(lines))+"</p>")
 escaped="".join(blocks)
 htmlbody='<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Aviary complete receiving</title><style>body{font:16px/1.6 system-ui,sans-serif;max-width:1050px;margin:32px auto;padding:0 24px;color:#202020;background:#f4f4f4}main{background:white;border:1px solid #bdbdbd;padding:28px;overflow-wrap:anywhere}h1{font-size:30px;color:#171717}h2{font-size:23px;margin-top:30px;color:#222}pre{padding:16px;background:#f0f0f0;overflow:auto;font-size:13px;border:1px solid #ccc}li{margin:7px 0}a{color:#333}</style><p>Original native 19 checks · Public-source and browser receiving · October 12, 2026</p><main>'+escaped+'</main></html>'
 publish(reporthtml,htmlbody.encode())
 items=[]
 for r in packet["files"]:items.append(("application/"+r["path"],beneath(APP,r["path"])))
 for name in ("archive-restoration.json","source-verification.json","accepted-native-before.json","original-provider-before.json","public-initialization.json","visual-inspection.json"):
  items.append(("evidence/"+name,ROOT/name))
 for name in ("source-input.json","complete_aviary_delivery.py","library_upload_private_state.py"):
  items.append(("delivery-source/"+name,ROOT/name))
 for folder in ("commands","producer-source","original-manifests","failures","restore"):
  if not (ROOT/folder).exists():continue
  for member in inventory(ROOT/folder,exclude_pixels=False):
   items.append(("delivery-history/"+folder+"/"+member["path"],ROOT/folder/member["path"]))
 items.append(("evidence/local-visual-custody.json",ROOT/"local-visual-custody.json"))
 items.append(("evidence/saved-browser-checkpoint.json",ROOT/"checkpoints"/(Path(checkpoint["source"]["path"]).name+".receipt.json")))
 for r in ARCHIVES:items.append(("original-accepted/"+r["name"],ORIGINAL/r["name"]))
 for name,p in [("public-workspace.zip",public_zip),("public-native-package.zip",native_zip),("RECEIVING.md",reportmd),("RECEIVING.html",reporthtml),("receiving-result.json",evidence)]:items.append((name,p))
 for r in inventory(example,exclude_pixels=False):
  items.append(("public-example/"+r["path"],example/r["path"]))
 for r in inventory(browser,ignored_roots=("received-public","tmp")):
  rel=r["path"]
  if rel.split("/")[0] in ("received-public","tmp"):continue
  if rel in (Path(result["nativePackage"]["path"]).name,Path(result["publicWorkspaceExport"]["path"]).name):continue
  items.append(("browser-evidence/"+rel,browser/rel))
 complete=artifacts/"Aviary_Complete_Application_and_Receiving_20261012.zip"
 zip_selected(complete,items,{"applicationBaseMerge":"79586025b5b8916b8ea254ce43093623931b8544","sourcePacketSha256":SOURCE_SHA,"sourceCorrection":source_history,"nativeWorkspaceId":WORKSPACE_ID,"publicWorkspaceId":result["publicWorkspaceId"],"originalProviderOperation":PROVIDER_OPERATION,"localQAScreenshotDescriptors":result["screenshots"],"pixelFilesIncluded":False})
 saved=[]
 for path in (complete,public_zip,native_zip,reporthtml,reportmd,evidence):
  saved.append(save_artifact(path))
 final={"schema":"commons.aviary.library-delivery.v1","operation":OP,"state":"SAVED","completedAt":now(),"files":[x["result"]|{"bytes":x["source"]["bytes"],"sha256":x["source"]["sha256"]} for x in saved],"nativeChecks":19,"browserState":"PASS","visualInspection":"ACCEPTED","providerWorkspaceId":WORKSPACE_ID,"publicWorkspaceId":result["publicWorkspaceId"]}
 final_path=ROOT/"complete-delivery-receipt.json"
 if final_path.exists():
  original_final=readjson(final_path)
  require({k:v for k,v in original_final.items() if k!="completedAt"}=={k:v for k,v in final.items() if k!="completedAt"},"Original final delivery identity changed")
  final=original_final
 else:pubjson(final_path,final)
 publish(SHARED/"complete-delivery-receipt.json",encoded(final))
 emit("COMPLETE",**{k:v for k,v in final.items() if k not in ("schema","operation")})
 fcntl.flock(lock,fcntl.LOCK_UN);lock.close()
if __name__=="__main__":
 if "PAYLOAD" not in globals():
  parser=argparse.ArgumentParser(description=__doc__)
  parser.add_argument("--input",required=True,help="Exact complete Aviary delivery input JSON")
  parser.add_argument("--restore-checkpoint",help="Original authorized local checkpoint and saved receipt JSON")
  arguments=parser.parse_args()
  PAYLOAD=readjson(arguments.input)
  require(isinstance(PAYLOAD,dict) and PAYLOAD.get("program")==Path(__file__).read_text("utf-8"),
          "The standalone producer differs from its exact complete input")
  if arguments.restore_checkpoint:
   require(PAYLOAD.get("restoreCheckpoint") is None,"Checkpoint was selected twice")
   PAYLOAD={**PAYLOAD,"restoreCheckpoint":readjson(arguments.restore_checkpoint)}
 try:main()
 except BaseException as error:
  failure={"schema":"commons.aviary.delivery-failure.v1","operation":OP,"at":now(),"error":type(error).__name__,"message":str(error),"traceback":traceback.format_exc(),"root":str(ROOT)}
  failure_path=ROOT/"failures"/(str(uuid.uuid4())+".json")
  try:pubjson(failure_path,failure)
  except BaseException as preservation_error:
   emit("FAILURE_RECORD_UNAVAILABLE",errorType=type(preservation_error).__name__)
  emit("FAILED",error=failure["error"],message=failure["message"],traceback=failure["traceback"])
  try:
   preserve_receiving_checkpoint("INTERRUPTED_RECEIVING",record(failure_path) if failure_path.exists() else
                                {"error":failure["error"],"message":failure["message"]})
  except BaseException as preservation_error:
   emit("FAILURE_CHECKPOINT_NOT_SAVED",errorType=type(preservation_error).__name__,
        message=safe_save_diagnostic(str(preservation_error)))
  raise
