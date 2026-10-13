import ast,contextlib,hashlib,importlib.util,json,os,shutil,stat,subprocess,sys,tempfile,urllib.request,zipfile
from pathlib import Path,PurePosixPath

def restore_current_aviary_runtime(value):
 def need(ok,message):
  if not ok:raise RuntimeError(message)
 def sha(raw):return hashlib.sha256(raw).hexdigest()
 def emit(event,**data):print(json.dumps({"event":event,"operation":"AVIARY-COMPLETE-DELIVERY-6BA15-20261012",**data},separators=(",",":")),flush=True)
 def ident(path):
  with open(path,"rb") as stream:
   start=os.fstat(stream.fileno());need(stat.S_ISREG(start.st_mode),"Runtime source is not a regular file")
   digest=hashlib.sha256();count=0
   for block in iter(lambda:stream.read(262144),b""):digest.update(block);count+=len(block)
   end=os.fstat(stream.fileno())
  need((start.st_dev,start.st_ino,start.st_size,start.st_mtime_ns)==(end.st_dev,end.st_ino,end.st_size,end.st_mtime_ns),"Runtime source changed while reading")
  return {"bytes":count,"sha256":digest.hexdigest()}
 def put(path,raw,mode=0o600):
  path=Path(path);path.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
  need(path.parent.resolve()==path.parent,"Runtime destination is not canonical")
  if path.exists():need(not path.is_symlink() and ident(path)=={"bytes":len(raw),"sha256":sha(raw)},"Existing runtime source differs");return
  fd,tmp=tempfile.mkstemp(prefix=".aviary-runtime-",dir=path.parent)
  try:
   with os.fdopen(fd,"wb") as stream:stream.write(raw);stream.flush();os.fsync(stream.fileno())
   os.chmod(tmp,mode);os.link(tmp,path)
  finally:
   with contextlib.suppress(FileNotFoundError):os.unlink(tmp)
 def download(item):
  transfer=item.get("transfer");expected=item["identity"];path=Path(item["path"])
  if transfer is not None:
   need(isinstance(transfer,dict) and transfer.get("method")=="GET" and transfer.get("current_version_number")==0
        and transfer.get("file_id")==item["file_id"] and transfer.get("library_file_id")==item["library_file_id"]
        and transfer.get("size_bytes")==expected["bytes"],"The original Library download binding differs")
  path.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
  need(path.parent.resolve()==path.parent,"Original download destination is not canonical")
  if path.exists():need(not path.is_symlink() and ident(path)==expected,"The saved original archive differs")
  else:
   need(transfer is not None,"An original saved archive is not materialized and has no authorized Library GET: "+item["library_file_id"])
   fd,tmp=tempfile.mkstemp(prefix=".aviary-original-download-",dir=path.parent)
   try:
    with os.fdopen(fd,"wb") as output:
     if hasattr(os,"posix_fallocate"):os.posix_fallocate(output.fileno(),0,expected["bytes"])
     request=urllib.request.Request(transfer["download_url"],headers=transfer["headers"],method="GET")
     digest=hashlib.sha256();count=0
     with urllib.request.urlopen(request,timeout=90) as response:
      need(response.status==200,"Original Library download did not return its bytes")
      length=response.headers.get("Content-Length")
      need(length is None or int(length)==expected["bytes"],"Original Library declared size differs")
      for block in iter(lambda:response.read(262144),b""):
       count+=len(block);need(count<=expected["bytes"],"Original Library response exceeded its saved size")
       digest.update(block);output.write(block)
     need(count==expected["bytes"] and digest.hexdigest()==expected["sha256"],"Original Library bytes do not match the retained receipt")
     output.flush();os.fsync(output.fileno())
    os.link(tmp,path)
   finally:
    with contextlib.suppress(FileNotFoundError):os.unlink(tmp)
  xattrs=[]
  for attribute in (transfer or {}).get("xattrs",[]):
   try:os.setxattr(path,attribute["name"],attribute["value"].encode());xattrs.append({"name":attribute["name"],"applied":True})
   except OSError as error:xattrs.append({"name":attribute["name"],"applied":False,"errno":error.errno})
  result={"path":str(path),**expected,"file_id":item["file_id"],"library_file_id":item["library_file_id"],"version":0,"xattrs":xattrs,"acquisition":"authorized Library GET or existing exact saved local bytes"}
  emit("ORIGINAL_LIBRARY_BYTES_RESTORED",**result);return result
 root=Path("/dev/aviary-newhost-runtime-6ba15");root.mkdir(parents=True,exist_ok=True,mode=0o700)
 source=value["inputText"].encode()
 need(len(source)==1258636 and sha(source)=="0ae1bdb8ce54c94ea3d6bd2a203730acdcbb56d18fa6b473c5a4b33b5a771e5e","The complete merged Aviary input differs")
 put(root/"aviary-delivery-input.json",source)
 put(root/"86320-receiving-history.json",value["historyText"].encode())
 put(root/("continue-original-"+sha(value["entryText"].encode())+".py"),value["entryText"].encode())
 put(root/("lean-runtime-source-"+sha(value["runtimeSource"].encode())+".py"),value["runtimeSource"].encode())
 packet=json.loads(json.loads(source)["sourcePacket"]);runtime=packet["runtime"]
 logical={
  "python":"/opt/codex/runtimes/codex-primary-runtime/dependencies/python/bin/python3",
  "node":"/opt/codex/runtimes/codex-primary-runtime/dependencies/node/bin/node",
  "playwrightModule":"/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs",
  "browserExecutable":"/workspace/scratch/705ebf077387/browser-runtime/chrome-headless-shell-linux64/chrome-headless-shell"}
 need(all(runtime.get(key)==logical[key] for key in ("node","playwrightModule","browserExecutable")),
      "The original logical runtime binding differs")
 supplied=value.get("runtimeSelection",{})
 need(isinstance(supplied,dict) and set(supplied)<=set(logical),"Unknown actual runtime selection field")
 actual={};observed={}
 for key,original in logical.items():
  requested=supplied.get(key)
  if requested is None:requested=sys.executable if key=="python" else original
  need(isinstance(requested,str) and requested and "\0" not in requested and Path(requested).is_absolute(),
       "Select an absolute actual installed runtime path: "+key)
  selected=Path(requested).resolve(strict=True);info=selected.stat()
  need(stat.S_ISREG(info.st_mode),"Selected runtime is not a regular file: "+key)
  if key!="playwrightModule":need(os.access(selected,os.X_OK),"Selected runtime is not executable: "+key)
  actual[key]=str(selected)
  observed[key]={"requestedPath":requested,"resolvedPath":str(selected),"bytes":info.st_size,
                 "device":info.st_dev,"inode":info.st_ino,"mtimeNs":info.st_mtime_ns,"mode":stat.S_IMODE(info.st_mode)}
 need(Path(actual["python"]).samefile(sys.executable),
      "Run this complete entry with the explicitly selected actual Python interpreter")
 node_result=subprocess.run([actual["node"],"--version"],capture_output=True,text=True,timeout=15,check=True)
 node_version=node_result.stdout.strip()
 import re
 node_match=re.fullmatch(r"v([0-9]+)\.([0-9]+)\.([0-9]+)",node_version)
 need(node_match is not None and int(node_match[1])>=20,"The selected Node does not support this original receiving entry")
 browser_result=subprocess.run([actual["browserExecutable"],"--version"],capture_output=True,text=True,timeout=15,check=True)
 browser_version=(browser_result.stdout.strip() or browser_result.stderr.strip())
 need(browser_version and len(browser_version)<1024,"The selected installed browser did not identify its version")
 package=None;module_path=Path(actual["playwrightModule"])
 for parent in [module_path.parent,*list(module_path.parents)[1:5]]:
  candidate=parent/"package.json"
  if not candidate.is_file():continue
  raw=candidate.read_bytes();need(len(raw)<=1048576,"The selected Playwright package descriptor exceeds its bound")
  model=json.loads(raw)
  if model.get("name") in ("playwright","playwright-core"):
   package={"path":str(candidate),"bytes":len(raw),"sha256":sha(raw),"name":model["name"],"version":model.get("version")}
   break
 need(package is not None and isinstance(package["version"],str),"The actual Playwright module lacks its installed package descriptor")
 restored=[download(item) for item in value["runtimeArchives"]]
 selected_checkpoint=next((item for item in restored if item["library_file_id"]=="libfile_efcd41110f008191a3190f5589800c36"),None)
 need(selected_checkpoint is not None and selected_checkpoint["bytes"]==9965306
      and selected_checkpoint["sha256"]=="c9980b4c9a7297512f221db8e23419eae983e53ba934e8e87bd82074271f1d1f",
      "The complete original C998 checkpoint was not selected")
 receipt_sha="8b4a896701caa8eb32888c7bdc4dc587c74599c2a8160da85b78ff60788d0d84"
 receipt_member="root/producer-source/history-86320/official-headless-shell-"+receipt_sha+".json"
 with zipfile.ZipFile(selected_checkpoint["path"]) as archive:
  matches=[item for item in archive.infolist() if item.filename==receipt_member]
  need(len(matches)==1 and matches[0].file_size<=524288,"The original official-shell receipt is missing or duplicated")
  receipt_raw=archive.read(matches[0])
 need(sha(receipt_raw)==receipt_sha,"The original full-resource browser receipt changed")
 prior=json.loads(receipt_raw)
 need(prior.get("schema")=="commons.aviary.browser-runtime-selection.v1"
      and prior.get("operation")=="AVIARY-COMPLETE-DELIVERY-6BA15-20261012"
      and prior.get("logicalExecutable")==logical["browserExecutable"]
      and "155.0.8059.39" in prior.get("selectedVersion","")
      and prior.get("download",{}).get("archive")=={"bytes":124203329,"sha256":"39dcb8c46550632a3d911850ab3b8af840b4e3f6d8622faa2018eb8756278786"},
      "The retained original runtime release binding differs")
 need(isinstance(prior.get("selectedFiles"),list) and len(prior["selectedFiles"])==287,
      "The retained original browser resource inventory is incomplete")
 # The original 287-file proof describes the original runtime. A worker may
 # explicitly select another installed release; its observed version and native
 # launch are separate evidence and do not rewrite that prior proof.
 selection={"schema":"commons.aviary.actual-runtime-selection.v1",
            "operation":"AVIARY-COMPLETE-DELIVERY-6BA15-20261012",
            "browserOperation":"AVIARY-BROWSER-RECEIVING-6BA15-20261012",
            "logical":logical,"actual":actual,
            "originalCheckpoint":{"bytes":9965306,"sha256":selected_checkpoint["sha256"],
                                  "file_id":selected_checkpoint["file_id"],"library_file_id":selected_checkpoint["library_file_id"],"version":0},
            "originalInputSha256":sha(source),
            "originalBrowserSource":{"bytes":77494,"sha256":"6f6fa4e54bef86b1df205219f6ece517d578ea4b5ddb0a69d0705941226c9b6a"},
            "runtimeAdapterSourceSha256":sha(value["runtimeSource"].encode()),
            "observedRuntime":{"python":sys.version,"nodeVersion":node_version,"browserVersion":browser_version,
                               "playwrightPackage":package,"files":observed,
                               "bootId":Path("/proc/sys/kernel/random/boot_id").read_text().strip()},
            "historicalRequestsChanged":0,"applicationFilesChanged":0,"providerRequestsReplayed":0}
 selection_raw=(json.dumps(selection,ensure_ascii=False,sort_keys=True,indent=2)+"\n").encode()
 selection_sha=sha(selection_raw)
 history=Path("/dev/aviary-complete-final-6ba15/producer-source/runtime-selections")
 selection_path=history/(selection_sha+".json");put(selection_path,selection_raw)
 descriptor={"path":str(selection_path),"bytes":len(selection_raw),"sha256":selection_sha}
 receipt={"schema":"commons.aviary.lean-runtime-continuation.v2","operation":selection["operation"],
          "bootId":Path("/proc/sys/kernel/random/boot_id").read_text().strip(),
          "python":sys.version,"pythonExecutable":sys.executable,"nodeVersion":node_version,
          "browserVersion":browser_version,"playwrightPackage":package,"selectedFilesObserved":observed,
          "selection":descriptor,
          "originalFullResourceReceipt":{"checkpoint":selected_checkpoint,"member":receipt_member,"bytes":len(receipt_raw),"sha256":receipt_sha},
          "currentResourceObservation":{"selectedInstalledRuntimeOnly":True,"wholeResourceHashesRepeated":False,
             "originalResourceProofReusedForDifferentRuntime":False,"extraFilesInspected":False,
             "runtimeCopiesMade":0,"runtimeDownloadsBeforeBrowser":0},
          "saveTransport":"maintained LibraryUploadWorkflow / canonical prepare_uploads + finalize_uploads","archives":restored,"providerInvocations":0,
          "sourceInputSha256":sha(source)}
 raw=(json.dumps(receipt,ensure_ascii=False,sort_keys=True,indent=2)+"\n").encode()
 put(history/("observation-"+sha(raw)+".json"),raw)
 emit("ORIGINAL_RUNTIME_READY",selection=descriptor,logical=logical,actual=actual,
      pythonVersion=sys.version,nodeVersion=node_version,playwrightVersion=package["version"],
      browserVersion=browser_version,runtimeDownloadsBeforeBrowser=0,runtimeCopiesMade=0,
      saveTransport="maintained LibraryUploadWorkflow / canonical prepare_uploads + finalize_uploads",archiveCount=len(restored),receiptSha256=sha(raw))
 return {"selection":selection,"descriptor":descriptor,"observation":receipt}


def install_aviary_runtime_selection(n,value,selected):
 """Adopt actual launch paths without changing any original request or source file."""
 import copy,re
 def need(ok,message):
  if not ok:raise RuntimeError(message)
 def replace_once(source,before,after):
  need(source.count(before)==1,"The reviewed runtime launch seam differs: "+before[:100])
  return source.replace(before,after,1)
 def canonical(model):return (json.dumps(model,ensure_ascii=False,sort_keys=True,indent=2,allow_nan=False)+"\n").encode()
 def file_info(path):
  result=n["record"](path)
  return {key:result[key] for key in ("path","bytes","sha256")}
 def save(path,raw):n["publish"](Path(path),raw);return file_info(path)
 logical=selected["selection"]["logical"];actual=selected["selection"]["actual"];selection_descriptor=selected["descriptor"]
 need(n["OP"]=="AVIARY-COMPLETE-DELIVERY-6BA15-20261012","The runtime selection belongs to another delivery")
 n["same"](selection_descriptor,selection_descriptor["path"])
 need(n["readjson"](selection_descriptor["path"])==selected["selection"],"The saved actual runtime selection differs")
 source=n["PAYLOAD"]["program"]
 need(len(source.encode())==98770 and n["sha"](source.encode())=="ad828d5fd25c6db0488935580f8c41f52ee7b26cb16cb172ef870f1422152439",
      "The original complete producer changed before runtime adoption")
 folder=n["ROOT"]/"producer-source"/"runtime-executions"/selection_descriptor["sha256"]
 folder.mkdir(parents=True,exist_ok=True,mode=0o700)
 adapter_source=save(folder/"lean_runtime.py",value["runtimeSource"].encode())
 main_node=next(item for item in ast.parse(source).body if isinstance(item,(ast.FunctionDef,ast.AsyncFunctionDef)) and item.name=="main")
 original_main=ast.get_source_segment(source,main_node)
 main_source=replace_once(original_main,
  'run_command("public-source",[sys.executable,',
  'run_command("public-source",[AVIARY_RUNTIME_LOGICAL["python"],')
 main_source=replace_once(main_source,
  'for key in ("node","playwrightModule","browserExecutable"):require(Path(runtime[key]).is_file(),"Original browser dependency absent: "+key)',
  'for key in ("node","playwrightModule","browserExecutable"):require(runtime[key]==AVIARY_RUNTIME_LOGICAL[key] and Path(AVIARY_RUNTIME_ACTUAL[key]).is_file(),"Selected browser runtime differs: "+key)')
 main_source=replace_once(main_source,
  '"--python",sys.executable,"--playwright-module",',
  '"--python",AVIARY_RUNTIME_LOGICAL["python"],"--playwright-module",')
 main_source=replace_once(main_source,
  'publish(SHARED/"complete-delivery-receipt.json",encoded(final))',
  'try:publish(SHARED/"complete-delivery-receipt.json",encoded(final))\n'
  ' except OSError as error:emit("SHARED_FINAL_RECEIPT_PENDING",errorType=type(error).__name__,originalReceipt=str(final_path))')
 # The original frame filename is retained for its exact owned-lock cleanup;
 # the complete selected source and this compiler boundary are recorded below.
 main_source=main_source+"\n"
 main_descriptor=save(folder/"selected-producer-main.py",main_source.encode())
 original_main_descriptor=save(folder/"original-producer-main.py",(original_main+"\n").encode())
 n["AVIARY_RUNTIME_LOGICAL"]=dict(logical);n["AVIARY_RUNTIME_ACTUAL"]=dict(actual)
 exec(compile(main_source,"complete_aviary_delivery.py","exec"),n)
 original_bootstrap=n["COMMAND_BOOTSTRAP"]
 bootstrap=replace_once(original_bootstrap,
  'fd=int(sys.argv[1]);data=json.loads(sys.argv[2])\n',
  'fd=int(sys.argv[1]);data=json.loads(sys.argv[2])\n'
  'plan_path=pathlib.Path(os.environ["AVIARY_ACTUAL_COMMAND_PLAN"])\n'
  'plan_raw=plan_path.read_bytes();plan_sha=digest(plan_raw)\n'
  'need(plan_sha==os.environ["AVIARY_ACTUAL_COMMAND_PLAN_SHA256"],"Actual command plan bytes differ")\n'
  'plan=json.loads(plan_raw)\n'
  'need(plan.get("schema")=="commons.aviary.actual-command-plan.v1" and plan.get("operation")=="AVIARY-COMPLETE-DELIVERY-6BA15-20261012" and plan.get("logicalRequestSha256")==data["requestSha256"] and plan.get("logical",{}).get("argv")==data["argv"] and plan["logical"].get("cwd")==data["cwd"],"Actual command plan changed its original logical request")\n'
  'actual_argv=plan["actualArgv"]\n'
  'need(isinstance(actual_argv,list) and actual_argv and all(isinstance(arg,str) and "\\0" not in arg for arg in actual_argv),"Actual command argument is invalid")\n'
  'actual_sha=digest(b"\\0".join(os.fsencode(arg) for arg in actual_argv)+b"\\0")\n'
  'need(actual_sha==plan["actualCommandSha256"],"Actual command digest differs")\n')
 bootstrap=replace_once(bootstrap,
  'wire=encoded(identity)\n',
  'identity["actualTargetCommandSha256"]=actual_sha\n'
  'identity["runtimePlan"]={"path":str(plan_path),"bytes":len(plan_raw),"sha256":plan_sha}\n'
  'wire=encoded(identity)\n')
 bootstrap=replace_once(bootstrap,
  'os.execvpe(data["argv"][0],data["argv"],os.environ)',
  'need(plan_path.read_bytes()==plan_raw,"Actual command plan changed before execution")\n'
  'os.execvpe(actual_argv[0],actual_argv,os.environ)')
 bootstrap_descriptor=save(folder/"selected-command-bootstrap.py",bootstrap.encode())
 original_bootstrap_descriptor=save(folder/"original-command-bootstrap.py",original_bootstrap.encode())
 n["COMMAND_BOOTSTRAP"]=bootstrap
 original_observation=n["command_process_observation"]
 def observe_command(process):
  result=original_observation(process)
  if not isinstance(process,dict) or "runtimePlan" not in process:return result
  descriptor=process["runtimePlan"];path=Path(descriptor["path"])
  need(path.is_relative_to(n["ROOT"]/"commands") and path.resolve()==path and path.parent.name=="runtime-plans",
       "An actual command plan left its original command history")
  n["same"](descriptor,path);plan=n["readjson"](path)
  need(plan.get("schema")=="commons.aviary.actual-command-plan.v1" and plan.get("operation")==n["OP"]
       and plan.get("logicalRequestSha256")==process["requestSha256"]
       and n["sha"](b"\0".join(os.fsencode(arg) for arg in plan["logical"]["argv"])+b"\0")==process["targetCommandSha256"]
       and n["sha"](b"\0".join(os.fsencode(arg) for arg in plan["actualArgv"])+b"\0")==plan["actualCommandSha256"]==process.get("actualTargetCommandSha256"),
       "A retained actual command plan changed its original or actual process binding")
  if result.get("status")=="HOST_PROCESS_COMMAND_CHANGED" and result.get("commandSha256")==process["actualTargetCommandSha256"]:
   result={**result,"status":"MATCHING_ORIGINAL_PROCESS","runtimePlan":descriptor,"identityMethod":"RECORDED_ACTUAL_COMMAND"}
  return result
 n["command_process_observation"]=observe_command
 original_run=n["run_command"]
 def select_browser_execution(original_path):
  original_path=Path(original_path);body=original_path.read_text("utf-8")
  expected=selected["selection"]["originalBrowserSource"]
  need(len(body.encode())==expected["bytes"] and n["sha"](body.encode())==expected["sha256"],
       "The original selected browser source differs before runtime adoption")
  original_descriptor=file_info(original_path)
  browser_root=n["ROOT"]/"browser-receiving";identity_path=browser_root/"identity.json"
  identity=n["readjson"](identity_path)
  need(identity.get("operationId")=="AVIARY-BROWSER-RECEIVING-6BA15-20261012"
       and identity.get("inputSha256")=="d01dde40f1968591918cda48509bb17c33cc9c5b6a46c9aa3fa45c2e964c8f02",
       "The actual runtime changed the original saved browser identity")
  retained=identity["input"]
  need(retained.get("python")==logical["python"] and retained.get("playwrightModule")==logical["playwrightModule"]
       and retained.get("browserExecutable")==logical["browserExecutable"] and retained.get("runner",{}).get("path")==str(original_path),
       "The actual runtime mapping differs from the original browser request")
  header=r'''
const runtimeSelectionPath=process.env.AVIARY_ACTUAL_RUNTIME_SELECTION;
const runtimeSelectionSha256=process.env.AVIARY_ACTUAL_RUNTIME_SELECTION_SHA256;
if(!runtimeSelectionPath||!/^[a-f0-9]{64}$/.test(runtimeSelectionSha256||''))throw new Error('Actual runtime selection is absent');
const runtimeSelectionRaw=await readFile(runtimeSelectionPath);
if(createHash('sha256').update(runtimeSelectionRaw).digest('hex')!==runtimeSelectionSha256)throw new Error('Actual runtime selection bytes differ');
const runtimeSelection=JSON.parse(runtimeSelectionRaw.toString('utf8'));
if(runtimeSelection.schema!=='commons.aviary.actual-runtime-selection.v1'||runtimeSelection.operation!=='AVIARY-COMPLETE-DELIVERY-6BA15-20261012'||runtimeSelection.historicalRequestsChanged!==0||runtimeSelection.providerRequestsReplayed!==0)throw new Error('Actual runtime selection changed its original operation');
const ACTUAL_RUNTIME=runtimeSelection.actual;
const runtimeExecutionSelf=fileURLToPath(import.meta.url);
'''
  code=replace_once(body,"const require=createRequire(import.meta.url);",header+"\nconst require=createRequire(import.meta.url);")
  code=replace_once(code,"const SELF=fileURLToPath(import.meta.url);","const SELF="+json.dumps(str(original_path))+";")
  code=replace_once(code,"const PW=arg['playwright-module']?await realpath(path.resolve(arg['playwright-module'])):null;",
                    "const PW=arg['playwright-module']?path.resolve(arg['playwright-module']):null;")
  code=replace_once(code,"const CHROME=arg['browser-executable']?await realpath(path.resolve(arg['browser-executable'])):null;",
                    "const CHROME=arg['browser-executable']?path.resolve(arg['browser-executable']):null;")
  code=replace_once(code,
   "    stdout:prefix+'.stdout.log',stderr:prefix+'.stderr.log',timeoutMs};",
   "    stdout:prefix+'.stdout.log',stderr:prefix+'.stderr.log',timeoutMs,actualCommand:ACTUAL_RUNTIME.python,runtimeSelection:runtimeSelectionDescriptor};\n"
   "  expect(command===PYTHON&&PYTHON===runtimeSelection.logical.python,'An original Python launch changed its logical runtime');")
  code=replace_once(code,
   "child=spawn(command,argv,{cwd,env:environment,detached:true,stdio:[stdin?'pipe':'ignore',stdout.fd,stderr.fd]});",
   "child=spawn(ACTUAL_RUNTIME.python,argv,{cwd,env:environment,detached:true,stdio:[stdin?'pipe':'ignore',stdout.fd,stderr.fd]});")
  code=replace_once(code,
   "const imported=PW?await import(pathToFileURL(PW).href):require('playwright');",
   "const imported=await import(pathToFileURL(ACTUAL_RUNTIME.playwrightModule).href);")
  code=replace_once(code,"if(CHROME)launch.executablePath=CHROME;","launch.executablePath=ACTUAL_RUNTIME.browserExecutable;")
  runtime_validation=r'''
expect(PYTHON===runtimeSelection.logical.python&&PW===runtimeSelection.logical.playwrightModule&&CHROME===runtimeSelection.logical.browserExecutable,'Runtime mapping changed an original input value');
expect(runtimeSelection.originalInputSha256==='0ae1bdb8ce54c94ea3d6bd2a203730acdcbb56d18fa6b473c5a4b33b5a771e5e','Runtime mapping changed the complete original input');
const runtimeSelectionDescriptor=await fileRecord(runtimeSelectionPath);
expect(runtimeSelectionDescriptor.sha256===runtimeSelectionSha256,'Runtime selection changed after its read');
const runtimeAdoptionPath=process.env.AVIARY_ACTUAL_RUNTIME_ADOPTION;
const runtimeAdoptionSha=process.env.AVIARY_ACTUAL_RUNTIME_ADOPTION_SHA256;
expect(runtimeAdoptionPath&&/^[a-f0-9]{64}$/.test(runtimeAdoptionSha||''),'Explicit runtime source adoption is absent');
const runtimeAdoption=await readJson(runtimeAdoptionPath);
const runtimeAdoptionDescriptor=await fileRecord(runtimeAdoptionPath);
expect(runtimeAdoptionDescriptor.sha256===runtimeAdoptionSha&&runtimeAdoption.schema==='commons.aviary.runtime-source-adoption.v1'&&runtimeAdoption.operationId===OPERATION&&runtimeAdoption.deliveryOperation==='AVIARY-COMPLETE-DELIVERY-6BA15-20261012'&&runtimeAdoption.originalInputSha256===identity.inputSha256&&runtimeAdoption.historicalRequestsChanged===0&&runtimeAdoption.providerRequestsReplayed===0,'Runtime source adoption changed its original operation');
expect(isDeepStrictEqual(runtimeAdoption.originalIdentity,await fileRecord(identityPath))&&isDeepStrictEqual(runtimeAdoption.originalRunner,inputValue.runner)&&isDeepStrictEqual(runtimeAdoption.selectedRuntime,runtimeSelectionDescriptor),'Runtime source adoption differs from its retained request/source');
const actualExecutionSource=await fileRecord(runtimeExecutionSelf);
expect(isDeepStrictEqual(runtimeAdoption.actualExecutionSource,actualExecutionSource),'Actual executed browser source differs');
expect((await realpath(process.execPath))===runtimeSelection.actual.node,'The actual Node executable differs from the explicit selection');
for(const key of ['python','playwrightModule','browserExecutable'])expect((await realpath(runtimeSelection.actual[key]))===runtimeSelection.actual[key],'An actual selected runtime path changed');
for(const item of runtimeAdoption.originalSteps){within(path.join(ROOT,'steps'),item.path);await verifyFile(item);}
const actualRuntimeExecution={selection:runtimeSelectionDescriptor,adoption:runtimeAdoptionDescriptor,executedSource:actualExecutionSource,originalRunner:inputValue.runner,nodeExecutable:process.execPath,nodeVersion:process.version,logicalInputSha256:identity.inputSha256};
await publish(path.join(RUN,'runtime-execution.json'),actualRuntimeExecution);
'''
  marker="expect(identity.inputSha256===hash(encoded(identity.input)),'Receiving input hash differs');"
  code=replace_once(code,marker,marker+"\n"+runtime_validation)
  code=replace_once(code,"  applicationSource:sourcePin,receivingSourceAdoption});",
                    "  applicationSource:sourcePin,receivingSourceAdoption,actualRuntimeExecution});")
  code=replace_once(code,"executionSource:{runner:inputValue.runner,support:inputValue.support},",
                    "executionSource:{runner:inputValue.runner,support:inputValue.support,actualRuntimeExecution},")
  need(code==value["runtimeBrowserSource"],"The complete selected runtime browser postimage differs")
  execution_path=folder/"browser"/("run-"+n["sha"](code.encode())+".mjs")
  execution_descriptor=save(execution_path,code.encode())
  adoption_path=browser_root/"runtime-source-adoptions"/(selection_descriptor["sha256"]+".json")
  binding={"schema":"commons.aviary.runtime-source-adoption.v1",
           "operationId":"AVIARY-BROWSER-RECEIVING-6BA15-20261012","deliveryOperation":n["OP"],
           "reason":"explicit-worker-runtime-launch-selection",
           "originalInputSha256":identity["inputSha256"],"originalIdentity":file_info(identity_path),
           "originalRunner":original_descriptor,"actualExecutionSource":execution_descriptor,
           "selectedRuntime":selection_descriptor,"runtimeAdapter":adapter_source,
           "historicalRequestsChanged":0,"applicationFilesChanged":0,"providerRequestsReplayed":0}
  if adoption_path.exists():
   adoption=n["readjson"](adoption_path)
   need({key:item for key,item in adoption.items() if key!="originalSteps"}==binding,
        "The original runtime source adoption changed")
   need(isinstance(adoption.get("originalSteps"),list),"The original runtime adoption lacks its saved step inventory")
   for item in adoption["originalSteps"]:
    path=Path(item["path"])
    need(path.is_relative_to(browser_root/"steps") and path.resolve()==path,"A retained runtime step left the original history")
    n["same"](item,path)
  else:
   steps=[]
   for item in n["inventory"](browser_root/"steps",exclude_pixels=False):
    steps.append(file_info(browser_root/"steps"/item["path"]))
   adoption={**binding,"originalSteps":steps};n["pubjson"](adoption_path,adoption)
  return execution_descriptor,file_info(adoption_path)
 def run_selected(name,argv,timeout=900):
  logical_argv=[str(item) for item in argv];app=n["APP"]
  for key,observed_file in selected["selection"]["observedRuntime"]["files"].items():
   path=Path(actual[key]);info=path.stat()
   need(path.resolve()==path and stat.S_ISREG(info.st_mode)
        and (info.st_dev,info.st_ino,info.st_size,info.st_mtime_ns)==(observed_file["device"],observed_file["inode"],observed_file["bytes"],observed_file["mtimeNs"]),
        "The explicitly selected actual runtime changed before launch: "+key)
  expected_public=[logical["python"],"-B",str(app/"examples/receive_usgs_example.py"),"--packet",
                   str(app/"examples/usgs-example-input.json"),"--directory",str(n["ROOT"]/"public-example"),
                   "--publisher-text-manifest",str(app/"examples/usgs-publisher-text-20261012.json")]
  expected_browser=[logical["node"],str(app/"examples/run-aviary-browser-receiving.mjs"),"--application",str(app),
                    "--workspace",str(n["ROOT"]/"public-workspace"),"--provider-workspace",
                    "/dev/aviary-native-delivery-6ba15/native-receiving/received/workspace",
                    "--operation-id","aviary-http-receiving-6ba15-20261012","--out",str(n["ROOT"]/"browser-receiving"),
                    "--python",logical["python"],"--playwright-module",logical["playwrightModule"],
                    "--browser-executable",logical["browserExecutable"]]
  expected=expected_public if name=="public-source" else expected_browser if name=="browser" else None
  need(expected is not None and logical_argv==expected and timeout==(180 if name=="public-source" else 900),
       "An actual runtime launch changed the original logical command")
  binding={"argv":logical_argv,"cwd":str(app),"timeout":timeout}
  request_path=n["ROOT"]/"commands"/name/"request.json"
  request_raw=n["encoded"](binding);request_sha=n["sha"](request_raw)
  if request_path.exists():need(request_path.read_bytes()==request_raw,"The saved original command request differs")
  actual_argv=list(logical_argv);actual_argv[0]=actual["python"] if name=="public-source" else actual["node"]
  execution=None;adoption=None
  if name=="browser":
   execution,adoption=select_browser_execution(logical_argv[1])
   actual_argv[1]=execution["path"]
  plan={"schema":"commons.aviary.actual-command-plan.v1","operation":n["OP"],"commandName":name,
        "logical":binding,"logicalRequestSha256":request_sha,"actualArgv":actual_argv,
        "actualCommandSha256":n["sha"](b"\0".join(os.fsencode(arg) for arg in actual_argv)+b"\0"),
        "selectedRuntime":selection_descriptor,"actualExecutionSource":execution,"runtimeSourceAdoption":adoption,
        "originalRequestUnchanged":True,"originalProducerMain":original_main_descriptor,"selectedProducerMain":main_descriptor,
        "originalBootstrap":original_bootstrap_descriptor,"selectedBootstrap":bootstrap_descriptor,"runtimeAdapter":adapter_source}
  plan_raw=n["encoded"](plan);plan_path=n["ROOT"]/"commands"/name/"runtime-plans"/(n["sha"](plan_raw)+".json")
  plan_descriptor=save(plan_path,plan_raw)
  previous=n["ENV"]
  n["ENV"]={**previous,"AVIARY_ACTUAL_COMMAND_PLAN":str(plan_path),"AVIARY_ACTUAL_COMMAND_PLAN_SHA256":plan_descriptor["sha256"],
            "AVIARY_ACTUAL_RUNTIME_SELECTION":selection_descriptor["path"],
            "AVIARY_ACTUAL_RUNTIME_SELECTION_SHA256":selection_descriptor["sha256"]}
  if adoption:
   n["ENV"].update(AVIARY_ACTUAL_RUNTIME_ADOPTION=adoption["path"],AVIARY_ACTUAL_RUNTIME_ADOPTION_SHA256=adoption["sha256"])
  try:return original_run(name,logical_argv,timeout)
  finally:n["ENV"]=previous
 n["run_command"]=run_selected
 n["emit"]("ORIGINAL_RUNTIME_LAUNCH_ADAPTER_INSTALLED",selection=selection_descriptor,adapter=adapter_source,
           originalProducerMain=original_main_descriptor,selectedProducerMain=main_descriptor,
           originalBootstrap=original_bootstrap_descriptor,selectedBootstrap=bootstrap_descriptor,
           historicalRequestsChanged=0,applicationFilesChanged=0,providerRequestsReplayed=0)
