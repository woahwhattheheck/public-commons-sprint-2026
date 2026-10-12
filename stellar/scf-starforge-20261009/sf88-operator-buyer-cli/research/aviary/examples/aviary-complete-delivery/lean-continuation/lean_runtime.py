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
 expected_runtime={
  "node":"/opt/codex/runtimes/codex-primary-runtime/dependencies/node/bin/node",
  "playwrightModule":"/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs",
  "browserExecutable":"/workspace/scratch/705ebf077387/browser-runtime/chrome-headless-shell-linux64/chrome-headless-shell"}
 need(all(runtime.get(key)==path for key,path in expected_runtime.items()),"The original logical runtime binding differs")
 for key,path in expected_runtime.items():
  selected=Path(path)
  need(selected.is_file(),
       "The receiving worker lacks the original runtime path; retain the checkpoint and report the actual executable mapping: "+key)
  if key!="playwrightModule":need(os.access(selected,os.X_OK),"The selected original runtime is not executable: "+key)
 need(sys.executable=="/opt/codex/runtimes/codex-primary-runtime/dependencies/python/bin/python3",
      "The actual Python entry differs from the saved browser request; an explicit runtime adoption is required")
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
      and prior.get("logicalExecutable")==runtime["browserExecutable"]
      and "155.0.8059.39" in prior.get("selectedVersion","")
      and prior.get("download",{}).get("archive")=={"bytes":124203329,"sha256":"39dcb8c46550632a3d911850ab3b8af840b4e3f6d8622faa2018eb8756278786"},
      "The retained official runtime release binding differs")
 files=prior.get("selectedFiles")
 need(isinstance(files,list) and len(files)==287,"The original browser resource inventory is incomplete")
 browser_root=Path(runtime["browserExecutable"]).parent
 names=set();selected_executable=None
 for item in files:
  name=item.get("path");relative=PurePosixPath(name) if isinstance(name,str) else None
  need(relative is not None and relative.parts and not relative.is_absolute()
       and relative.as_posix()==name and all(part not in (".","..","") for part in relative.parts)
       and name not in names and isinstance(item.get("bytes"),int) and item["bytes"]>=0
       and isinstance(item.get("sha256"),str) and len(item["sha256"])==64,
       "An original browser member descriptor differs")
  names.add(name);path=browser_root.joinpath(*relative.parts)
  info=path.lstat()
  need(stat.S_ISREG(info.st_mode) and path.resolve()==path and info.st_size==item["bytes"],
       "A selected browser member is absent or has a different length: "+name)
  if name=="chrome-headless-shell":selected_executable=item
 need(selected_executable is not None,"The original official executable descriptor is absent")
 version=subprocess.run([runtime["browserExecutable"],"--version"],capture_output=True,text=True,timeout=15,check=True).stdout.strip()
 need("155.0.8059.39" in version,"The selected original headless-shell version differs")
 node_version=subprocess.run([runtime["node"],"--version"],capture_output=True,text=True,timeout=15,check=True).stdout.strip()
 receipt={"schema":"commons.aviary.lean-runtime-continuation.v1","operation":"AVIARY-COMPLETE-DELIVERY-6BA15-20261012",
          "bootId":Path("/proc/sys/kernel/random/boot_id").read_text().strip(),
          "python":sys.version,"pythonExecutable":sys.executable,"runtime":runtime,"nodeVersion":node_version,
          "browserVersion":version,"selectedExecutable":selected_executable,
          "originalFullResourceReceipt":{"checkpoint":selected_checkpoint,"member":receipt_member,"bytes":len(receipt_raw),"sha256":receipt_sha},
          "currentResourceObservation":{"requiredFiles":287,"allPresentRegularAndOriginalSize":True,
            "sourceOfContentHashes":"Retained full release-byte verification in the original saved receipt; 70551 independently reverified all 287 members.",
            "wholeResourceHashesRepeated":False,"extraFilesInspected":False,"runtimeCopiesMade":0,"runtimeDownloadsBeforeBrowser":0},
          "saveTransport":"official library_create_library_file","archives":restored,"providerInvocations":0,
          "sourceInputSha256":sha(source)}
 raw=(json.dumps(receipt,ensure_ascii=False,sort_keys=True,indent=2)+"\n").encode()
 history=Path("/dev/aviary-complete-final-6ba15/producer-source/history-86320")
 put(history/("lean-runtime-"+sha(raw)+".json"),raw)
 emit("ORIGINAL_RUNTIME_READY",pythonExecutable=sys.executable,node=runtime["node"],playwrightModule=runtime["playwrightModule"],
      browserExecutable=runtime["browserExecutable"],browserVersion=version,selectedExecutable=selected_executable,
      runtimeDownloadsBeforeBrowser=0,runtimeCopiesMade=0,requiredResourceCount=287,extraFilesInspected=False,
      saveTransport="official library_create_library_file",archiveCount=len(restored),receiptSha256=sha(raw))
 return receipt
