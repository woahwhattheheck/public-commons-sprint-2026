#!/usr/bin/env python3
"""Receive the reviewed source bundle and retain its complete original case output."""
from __future__ import annotations
import datetime, fcntl, hashlib, json, os, shutil, stat, subprocess, sys, tarfile, time, uuid, zipfile
import urllib.parse, urllib.request
from pathlib import Path, PurePosixPath

os.umask(0o077)
def now(): return datetime.datetime.now(datetime.timezone.utc).isoformat()
def emit(value): print(json.dumps(value,ensure_ascii=False,separators=(",",":")),flush=True)
def need(value,message):
    if not value: raise RuntimeError(message)
def digest(value): return hashlib.sha256(value).hexdigest()
def raw(path):
    fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW)
    with os.fdopen(fd,"rb") as stream:
        need(stat.S_ISREG(os.fstat(stream.fileno()).st_mode),"Select an ordinary original file")
        return stream.read()
def identity(path):
    fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW); result=hashlib.sha256()
    with os.fdopen(fd,"rb") as stream:
        before=os.fstat(stream.fileno())
        need(stat.S_ISREG(before.st_mode),"Select an ordinary original file")
        for block in iter(lambda:stream.read(1024*1024),b""): result.update(block)
        after=os.fstat(stream.fileno())
    need(all(getattr(before,k)==getattr(after,k) for k in ("st_dev","st_ino","st_size","st_mtime_ns","st_ctime_ns")),
         "The selected file changed during its retained read")
    return {"bytes":after.st_size,"sha256":result.hexdigest()}
def write_new(path,value):
    path=Path(path); path.parent.mkdir(mode=0o700,parents=True,exist_ok=True)
    temporary=path.with_name(path.name+"."+uuid.uuid4().hex+".tmp")
    fd=os.open(temporary,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
    with os.fdopen(fd,"wb") as stream: stream.write(value);stream.flush();os.fsync(stream.fileno())
    try: os.link(temporary,path)
    except FileExistsError: need(identity(path)=={"bytes":len(value),"sha256":digest(value)},"Preserve the existing selected source or input")
    finally: temporary.unlink()
def replace_json(path,value):
    path=Path(path); temporary=path.with_name(path.name+"."+uuid.uuid4().hex+".tmp")
    value=(json.dumps(value,ensure_ascii=False,sort_keys=True,indent=2)+"\n").encode()
    write_new(temporary,value);os.replace(temporary,path)
def safe_name(name):
    p=PurePosixPath(name)
    need(isinstance(name,str) and name and str(p)==name and not p.is_absolute()
         and "\\" not in name and all(part not in ("",".","..") for part in p.parts),
         "Use original ordinary member names")
    return p

payload=globals().get("INPUT_PAYLOAD")
input_directory=None
if payload is None:
    if len(sys.argv)==3 and sys.argv[1]=="--input-file":
        input_file=Path(sys.argv[2]).resolve(strict=True);input_directory=input_file.parent
        payload=json.loads(raw(input_file))
    else:
        need(len(sys.argv)==1,"Use --input-file with the complete following-stage selection")
        payload=json.loads(sys.stdin.readline())
if input_directory is not None:
    for field,file_field in (("inputText","inputFile"),("originalInputText","originalInputFile"),
            ("program","programFile"),("sourceEnvelope","sourceEnvelopeFile"),
            ("keeper","keeperFile"),("guide","guideFile")):
        if file_field in payload:
            need(field not in payload,"Select one complete "+field+" carrier")
            payload[field]=raw(input_directory/str(safe_name(payload[file_field]))).decode("utf-8")
need(payload["schema"]=="sf88.research-client.ottawa-following-owner.v1","Use the complete following-stage input")
selected=json.loads(payload["inputText"]);business=selected["operationId"]
original_input=payload.get("originalInputText")
if original_input is not None:
    original_selected=json.loads(original_input)
    allowed_fields=("directory","sourceDirectory","outputDirectory","originalNativeReport","sourceEnvelopeFile")
    expected_selected=dict(original_selected)
    selected_root=Path(selected["directory"]).parent
    original_root=Path(original_selected["directory"]).parent
    need(selected_root.is_absolute() and original_root==Path("/dev/research-original-d9b53-20261012"),
         "Keep the original input root as provenance")
    for name in allowed_fields:
        original_path=Path(original_selected[name])
        need(original_path.is_relative_to(original_root),"Unexpected original runtime selector")
        expected_selected[name]=str(selected_root/original_path.relative_to(original_root))
    expected_selected["bundle"]={**original_selected["bundle"],
        "file":str(selected_root/Path(original_selected["bundle"]["file"]).relative_to(original_root))}
    need(expected_selected==selected,"Only original runtime paths may differ on the receiving host")
need(selected["schema"]=="sf88.research-client.source-bundle-receiving-input.v1","Use the original receiving input")
output=Path(selected["outputDirectory"]); stage=output.parent
need(output.is_absolute() and stage.name=="ottawa-source-bundle","Use the original private stage directory")
stage.mkdir(mode=0o700,parents=True,exist_ok=True)
fd=os.open(stage/"owner.lock",os.O_RDWR|os.O_CREAT|os.O_NOFOLLOW,0o600)
fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB)
emit({"state":"original-ottawa-owner","operationId":business,"stageId":selected["stageId"],
      "directory":str(stage),"pid":os.getpid()})
# A successfully saved preceding return can restore the same case after its
# private producing namespace closes. This never dispatches that journey again.
completed=payload.get("completedReturn")
def restore_completed_return(completed):
    need(completed.get("schema")=="sf88.research-client.completed-native-input.v1",
         "Select the actual completed preceding native return")
    expected_return={key:completed[key] for key in ("bytes","sha256")}
    need(isinstance(expected_return["bytes"],int) and 0<expected_return["bytes"]<=256*1024*1024
         and isinstance(expected_return["sha256"],str) and len(expected_return["sha256"])==64,
         "Use the observed complete native file identity")
    original_root=Path(selected["directory"]).parent
    need(original_root.is_absolute() and Path(selected["originalNativeReport"]).is_relative_to(original_root),
         "Keep the original completed case directory")
    original_root.mkdir(mode=0o700,parents=True,exist_ok=True)
    need(original_root.is_dir() and not original_root.is_symlink(),"Use the original ordinary case directory")
    previous_path=stage/"preceding-native-return.json"
    if previous_path.is_file():
        previous=json.loads(raw(previous_path))
        need(previous.get("schema")=="sf88.research-client.completed-native-receiving.v1" and
             previous.get("operationId")==business and previous.get("artifact")==expected_return and
             previous.get("ownerMember")==completed["ownerMember"],"Preserve the selected preceding return")
        need(identity(selected["originalNativeReport"])==previous["nativeReport"],
             "The retained original native report changed")
        emit({"state":"original-completed-native-case-retained","operationId":business,
              "directory":str(original_root),"artifact":expected_return})
        return
    archive=original_root/(".following-native-input-"+uuid.uuid4().hex+".tar.gz")
    url=urllib.parse.urlsplit(completed["url"])
    need(url.scheme=="https" and url.netloc and not url.username and not url.password and not url.fragment,
         "Use the original saved return's current HTTPS materialization")
    request=urllib.request.Request(completed["url"],headers={"User-Agent":"Commons-Original-Research-Following/1"})
    with urllib.request.urlopen(request,timeout=60) as response:
        need(urllib.parse.urlsplit(response.geturl()).scheme=="https","The saved native return left HTTPS")
        fd=os.open(archive,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
        with os.fdopen(fd,"wb") as stream:
            count=0
            for block in iter(lambda:response.read(1024*1024),b""):
                count+=len(block);need(count<=expected_return["bytes"],"The saved native return exceeds its selected size")
                stream.write(block)
            stream.flush();os.fsync(stream.fileno())
    need(identity(archive)==expected_return,"The original complete native return changed")
    with tarfile.open(archive,"r:gz") as carrier:
        members=carrier.getmembers();names={}
        for member in members:
            name=str(safe_name(member.name))
            need(member.isfile() and not member.issym() and not member.islnk() and
                 name not in names and 0<=member.size<=256*1024*1024,"Preserve ordinary original native members")
            names[name]=member
        owner_name=str(safe_name(completed["ownerMember"]))
        need(owner_name in names,"The selected complete native owner result is absent")
        prior_body=carrier.extractfile(names[owner_name]).read()
        prior=json.loads(prior_body)
        need(prior.get("schema")=="sf88.research-client.linked-operation-owner-return.v1" and
             prior.get("operationId")==business and prior.get("nativeOperationId")==business+"-CONTINUATION-01" and
             prior.get("directory")==str(original_root) and prior.get("state")=="complete" and
             prior.get("nativeExitCode")==0 and prior.get("dossierId")==selected["dossierId"] and
             prior.get("questionId")==selected["questionId"],"Require the completed original case return")
        for key in ("nativeResult","nativeArtifacts","nativeReport"):
            need(prior.get(key,{}).get("value",{}).get("state")=="complete",
                 "The original complete native result is missing "+key)
        inventory={}
        for row in prior["files"]:
            name=str(safe_name(row["path"]))
            need(name not in inventory,"The original complete return repeats a member")
            inventory[name]={key:row[key] for key in ("bytes","sha256")}
        need(set(names)==set(inventory)|{owner_name} and owner_name not in inventory,
             "The original complete native member inventory changed")
        for name,member in names.items():
            value=carrier.extractfile(member).read()
            wanted={"bytes":len(prior_body),"sha256":digest(prior_body)} if name==owner_name else inventory[name]
            need({"bytes":len(value),"sha256":digest(value)}==wanted,"An original native member changed")
            destination=original_root/str(safe_name(name))
            parent=destination.parent
            while parent!=original_root:
                if parent.exists():need(parent.is_dir() and not parent.is_symlink(),"Preserve original native parent directories")
                parent=parent.parent
            write_new(destination,value)
    # The exact operated case is now retained; remove only its verified transfer copy.
    need(identity(archive)==expected_return,"The native input copy changed before release")
    archive.unlink()
    stage.mkdir(mode=0o700,parents=True,exist_ok=True)
    write_new(stage/"preceding-native-return.json",(json.dumps({
        "schema":"sf88.research-client.completed-native-receiving.v1","operationId":business,
        "artifact":expected_return,"ownerMember":owner_name,
        "ownerResult":{"bytes":len(prior_body),"sha256":digest(prior_body)},
        "nativeOperationId":prior["nativeOperationId"],"nativeReport":{key:prior["nativeReport"][key]
        for key in ("bytes","sha256")},"restoredMembers":len(names)},ensure_ascii=False,sort_keys=True,indent=2)+"\n").encode())
    emit({"state":"original-completed-native-case-restored","operationId":business,
          "directory":str(original_root),"artifact":expected_return,"members":len(names)})
if completed is not None: restore_completed_return(completed)

native_raw=raw(selected["originalNativeReport"]);native=json.loads(native_raw)
need(native.get("state")=="complete" and native.get("operationId")==business and
     native.get("dossierId")==selected["dossierId"] and native.get("questionId")==selected["questionId"],
     "Finish the original native case before its following study receiving")
for field,identity_field in (("program","programIdentity"),("sourceEnvelope","sourceEnvelopeIdentity"),
                             ("keeper","keeperIdentity"),("guide","guideIdentity")):
    data=payload[field].encode()
    need({"bytes":len(data),"sha256":digest(data)}==payload[identity_field],"The selected "+field+" changed")
need(payload["keeperIdentity"]=={"bytes":38913,"sha256":"f8f57631eb579b4f887b2762203ca7c63c3ddd44bc3fb83e7b62aadf3d20e758"},
     "Use the complete merged original artifact keeper")
need(payload["sourceEnvelopeIdentity"]=={"bytes":selected["sourceEnvelope"]["bytes"],
     "sha256":selected["sourceEnvelope"]["sha256"]},"The current core input changed")
source=json.loads(payload["sourceEnvelope"])
need(source["ref"]==selected["sourceCommit"] and source["schema"]=="commons.research-ottawa-import-runtime-source.v1",
     "Preserve the following current source selection")
source_root=Path(selected["sourceDirectory"])
need(source_root.parent==stage,"Keep the following engine source beside its original stage")
for entry in source["files"]:
    member=safe_name(entry["path"]); content=entry["content"].encode()
    need({"bytes":len(content),"sha256":digest(content)}=={"bytes":entry["bytes"],"sha256":entry["sha256"]},
         "The original current module changed")
    write_new(source_root/str(member),content)
program=stage/"receive-reviewed-source-bundle.mjs"
keeper_path=stage/"hosted-artifact-retention.py"
guide_path=stage/"RECEIVING.md"
input_path=stage/"receiving-input.json"
write_new(program,payload["program"].encode())
write_new(keeper_path,payload["keeper"].encode())
write_new(guide_path,payload["guide"].encode())
write_new(input_path,payload["inputText"].encode())
if original_input is not None:
    write_new(stage/"original-receiving-input.json",original_input.encode())
    write_new(stage/"receiving-host-binding.json",(json.dumps({
        "schema":"sf88.research-client.following-host-binding.v1","operationId":business,
        "originalRoot":str(original_root),"selectedRoot":str(selected_root),
        "originalInput":{"bytes":len(original_input.encode()),"sha256":digest(original_input.encode())},
        "selectedInput":{"bytes":len(payload["inputText"].encode()),"sha256":digest(payload["inputText"].encode())},
        "runtimeFields":[*allowed_fields,"bundle.file"]},sort_keys=True,indent=2)+"\n").encode())
write_new(selected["sourceEnvelopeFile"],payload["sourceEnvelope"].encode())
if "__file__" in globals() and Path(__file__).is_file():
    write_new(stage/"original-owner.py",raw(__file__))

bundle=Path(selected["bundle"]["file"]); expected={key:selected["bundle"][key] for key in ("bytes","sha256")}
if bundle.exists(): need(identity(bundle)==expected,"The retained original Ottawa bundle changed")
elif payload.get("bundleFile") is not None:
    local_bundle=Path(payload["bundleFile"]).resolve(strict=True)
    need(local_bundle.is_absolute() and identity(local_bundle)==expected,
         "The receiving host's complete original Ottawa file differs")
    bundle.parent.mkdir(mode=0o700,parents=True,exist_ok=True)
    temporary=bundle.with_name(bundle.name+"."+uuid.uuid4().hex+".copy")
    source_fd=os.open(local_bundle,os.O_RDONLY|os.O_NOFOLLOW)
    target_fd=os.open(temporary,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
    with os.fdopen(source_fd,"rb") as source_stream,os.fdopen(target_fd,"wb") as target_stream:
        shutil.copyfileobj(source_stream,target_stream,1024*1024)
        target_stream.flush();os.fsync(target_stream.fileno())
    need(identity(temporary)==expected,"The original local Ottawa file changed while copying")
    try:os.link(temporary,bundle)
    except FileExistsError:need(identity(bundle)==expected,"A different selected bundle appeared")
    finally:temporary.unlink()
else:
    url=urllib.parse.urlsplit(payload["bundleUrl"])
    need(url.scheme=="https" and url.netloc and not url.username and not url.password and not url.fragment,
         "Use the selected original bundle's current materialization URL")
    bundle.parent.mkdir(mode=0o700,parents=True,exist_ok=True)
    temporary=bundle.with_name(bundle.name+"."+uuid.uuid4().hex+".download")
    request=urllib.request.Request(payload["bundleUrl"],headers={"User-Agent":"Commons-Original-Ottawa-Receiving/1"})
    with urllib.request.urlopen(request,timeout=60) as response:
        need(urllib.parse.urlsplit(response.geturl()).scheme=="https","The original file left HTTPS")
        fd=os.open(temporary,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
        with os.fdopen(fd,"wb") as destination:
            count=0
            for block in iter(lambda:response.read(1024*1024),b""):
                count+=len(block);need(count<=expected["bytes"],"The original bundle exceeds its selected size")
                destination.write(block)
            destination.flush();os.fsync(destination.fileno())
    need(identity(temporary)==expected,"The original bundle transfer changed")
    try: os.link(temporary,bundle)
    except FileExistsError: need(identity(bundle)==expected,"A different selected bundle appeared")
    finally: temporary.unlink()
emit({"state":"original-ottawa-inputs-ready","operationId":business,"sourceFiles":len(source["files"]),
      "sourceCommit":selected["sourceCommit"],"bundle":expected})

case_root=Path(selected["directory"]).parent
case_input=case_root/"case-input.json"
host_binding_path=case_root/"native-host-binding.json"
if host_binding_path.exists():
    host_binding=json.loads(raw(host_binding_path))
    case_input=case_root/"case-input-host.json"
    need(host_binding["operationId"]==business and host_binding["nativeOperationId"]==business+"-CONTINUATION-01"
         and host_binding["selectedCaseInput"]["path"]==str(case_input)
         and identity(case_input)=={key:host_binding["selectedCaseInput"][key] for key in ("bytes","sha256")},
         "The preceding original native case binding changed")
case_config=json.loads(raw(case_input))
need(case_config["operationId"]==business and case_config["directory"]==str(case_root),
     "Use the same actual case directory as the preceding native launcher")
node=case_config["node"]; version=subprocess.check_output([node,"--version"],text=True,timeout=10).strip()
need(version.startswith("v") and int(version[1:].split(".")[0])>=22,"Use the existing supported Node runtime")
command=[node,str(program),str(input_path)]
journal_path=stage/"application-command.json"
journal=json.loads(raw(journal_path)) if journal_path.exists() else {
    "schema":"sf88.research-client.following-application-command.v1","operationId":business,
    "stageId":selected["stageId"],"program":payload["programIdentity"],"inputSha256":digest(payload["inputText"].encode()),
    "command":command,"attempts":[]}
need(journal["operationId"]==business and journal["stageId"]==selected["stageId"] and
     journal["program"]==payload["programIdentity"] and journal["inputSha256"]==digest(payload["inputText"].encode()),
     "Preserve the original receiving source and input identity")
need(journal["command"]==command,"Preserve the selected original application command")
def running_selected_children():
    matches=[]
    for proc in Path("/proc").iterdir():
        if not proc.name.isdigit(): continue
        try:
            args=(proc/"cmdline").read_bytes().split(b"\0")
            fields=(proc/"stat").read_text().rsplit(")",1)[1].split()
            if fields[0] not in ("Z","X") and str(program).encode() in args and str(input_path).encode() in args:
                matches.append({"pid":int(proc.name),"startTicks":fields[19]})
        except (OSError,ValueError,IndexError): continue
    return matches
active=running_selected_children()
need(not active,"The original receiving command remains active; use that same owner")
state_path=output/"receiving-state.json"
state=json.loads(raw(state_path)) if state_path.exists() else None
def retain_sealed(sealed):
    need(sealed["schema"]=="sf88.research-client.ottawa-sealed-return.v1" and
         sealed["operationId"]==business and sealed["inputSha256"]==digest(payload["inputText"].encode()) and
         sealed["program"]==payload["programIdentity"],"Preserve the original sealed receiving identity")
    artifact=sealed["artifact"]
    need(identity(artifact["path"])=={key:artifact[key] for key in ("bytes","sha256")},
         "The original sealed receiving file changed")
    namespace={"__name__":"hosted_artifact_retention","__file__":str(keeper_path)}
    exec(compile(payload["keeper"],str(keeper_path),"exec"),namespace)
    saved=namespace["retain_artifact"](Path(sealed["retentionDirectory"]),artifact,business,
        Path(payload["helperDirectory"]),input_stream=sys.stdin,emit=lambda line:print(line,flush=True),
        artifact_type="report")
    replace_json(stage/"library-upload-result.json",saved)
    returned=sealed["result"];observed=returned["application"]
    emit({"state":"original-ottawa-library-return","operationId":business,"artifact":artifact,
          "application":observed,"result":returned,"receipt":saved})
    raise SystemExit(0 if returned["state"]=="complete" and
                     (not observed["exitObserved"] or observed["applicationExitCode"]==0)
                     else observed["applicationExitCode"] if observed["exitObserved"] and observed["applicationExitCode"] else 1)

sealed_path=stage/"sealed-artifact.json"
if state and state.get("state")=="complete" and sealed_path.exists():
    sealed=json.loads(raw(sealed_path))
    need(sealed["receivingState"]==identity(state_path),"The completed receiving report changed after sealing")
    emit({"state":"original-ottawa-sealed-return-recovery","operationId":business,
          "artifact":sealed["artifact"],"revision":sealed["result"]["revision"]})
    retain_sealed(sealed)
observed=journal.get("observedExit")
if not state or state.get("state")!="complete":
    attempt={"number":len(journal["attempts"])+1,"launchIntentAt":now(),
             "stdout":str(stage/("native-"+str(len(journal["attempts"])+1)+".stdout")),
             "stderr":str(stage/("native-"+str(len(journal["attempts"])+1)+".stderr"))}
    journal["attempts"].append(attempt); journal.pop("observedExit",None);replace_json(journal_path,journal)
    with open(attempt["stdout"],"xb") as stdout,open(attempt["stderr"],"xb") as stderr:
        child=subprocess.Popen(command,cwd=stage,stdin=subprocess.DEVNULL,stdout=stdout,stderr=stderr)
        attempt["pid"]=child.pid
        try: attempt["startTicks"]=(Path("/proc")/str(child.pid)/"stat").read_text().rsplit(")",1)[1].split()[19]
        except OSError: pass
        attempt["launchedAt"]=now();replace_json(journal_path,journal)
        emit({"state":"original-ottawa-application-started","operationId":business,
              "stageId":selected["stageId"],"pid":child.pid,"command":command})
        status=child.wait()
        # Preserve the actual observed wait before reading or packaging reports.
        observed={"applicationExitCode":status,"exitObserved":True,"observedAt":now(),"attempt":attempt["number"]}
        journal["observedExit"]=observed;attempt["observedExit"]=observed;replace_json(journal_path,journal)
        stdout.flush();stderr.flush();os.fsync(stdout.fileno());os.fsync(stderr.fileno())
    state=json.loads(raw(state_path)) if state_path.exists() else None
else:
    # A completed report after an interrupted owner can be preserved directly.
    # Its original unobserved process exit remains distinct from this save.
    observed=observed or {"applicationExitCode":None,"exitObserved":False,"observedAt":now(),
                         "reason":"The complete original report survived without an observed child wait"}
    journal["observedExit"]=observed;replace_json(journal_path,journal)

need(not running_selected_children(),"Preserve the live original receiver before collecting its files")
returned={"schema":"sf88.research-client.ottawa-following-owner-return.v1","operationId":business,
    "stageId":selected["stageId"],"observedAt":now(),"sourceCommit":selected["sourceCommit"],
    "originalNativeReport":{"bytes":len(native_raw),"sha256":digest(native_raw),"finalRevision":native["finalRevision"]},
    "application":observed,"state":state.get("state") if state else "result-unavailable",
    "revision":state.get("selectedRevision") if state else None,
    "editionId":state.get("editionId") if state else None,
    "resultPath":str(state_path),"node":version}
return_path=stage/"owner-return.json";replace_json(return_path,returned)
emit({"state":"original-ottawa-application-return","operationId":business,"result":returned})

# The complete portable file contains every original revision and retained source.
# The independent reconstructed store is retained privately but is not duplicated
# inside the delivery. Runtime source is delivered through its immutable Git pins.
selected_files={}
for directory,folder in ((output,"receiving"),):
    if not directory.exists(): continue
    for current,dirs,files in os.walk(directory,followlinks=False):
        dirs[:]=[name for name in dirs if name!="portable-receiver"]
        for name in sorted(files):
            path=Path(current)/name; info=path.lstat()
            need(stat.S_ISREG(info.st_mode),"Preserve only original ordinary receiving files")
            selected_files[folder+"/"+path.relative_to(directory).as_posix()]=path
for name in ("application-command.json","owner-return.json","RECEIVING.md","preceding-native-return.json",
             "original-receiving-input.json","receiving-input.json","receiving-host-binding.json"):
    if (stage/name).is_file(): selected_files["operation/"+name]=stage/name
for attempt in journal["attempts"]:
    for key in ("stdout","stderr"):
        path=Path(attempt[key])
        if path.exists(): selected_files["operation/"+path.name]=path
inventory=[{"name":name,**identity(path)} for name,path in sorted(selected_files.items())]
package_manifest={"schema":"sf88.research-client.ottawa-complete-delivery.v1","operationId":business,
    "stageId":selected["stageId"],"state":returned["state"],"revision":returned["revision"],
    "sourceCommit":selected["sourceCommit"],"sourceEnvelope":selected["sourceEnvelope"],
    "program":payload["programIdentity"],"files":inventory}
archive=stage/("NCC_Greenhouse_Research_Ottawa_Receiving_"+uuid.uuid4().hex+".zip")
with zipfile.ZipFile(archive,"x",compression=zipfile.ZIP_DEFLATED,compresslevel=6) as carrier:
    for row in inventory:
        path=selected_files[row["name"]]
        need(identity(path)=={"bytes":row["bytes"],"sha256":row["sha256"]},"A selected result changed before packaging")
        carrier.write(path,row["name"])
    carrier.writestr("manifest.json",(json.dumps(package_manifest,ensure_ascii=False,sort_keys=True,indent=2)+"\n").encode())
with archive.open("rb") as stream: os.fsync(stream.fileno())
artifact={"path":str(archive),**identity(archive)}
sealed={"schema":"sf88.research-client.ottawa-sealed-return.v1","operationId":business,
    "inputSha256":digest(payload["inputText"].encode()),"program":payload["programIdentity"],
    "artifact":artifact,"result":returned,"receivingState":identity(state_path) if state_path.exists() else None,
    "retentionDirectory":str(stage/("retention-"+archive.stem))}
write_new(stage/"seals"/(archive.stem+".json"),(json.dumps(sealed,ensure_ascii=False,sort_keys=True,indent=2)+"\n").encode())
replace_json(sealed_path,sealed)
emit({"state":"original-ottawa-complete-file-ready","operationId":business,"artifact":artifact,
      "stateRecorded":returned["state"],"application":observed})
retain_sealed(sealed)
