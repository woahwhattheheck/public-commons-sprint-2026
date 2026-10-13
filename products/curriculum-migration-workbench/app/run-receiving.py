#!/usr/bin/env python3
"""Run and resume the original complete Curriculum Migration Workbench receiving course."""
import argparse,datetime,fcntl,hashlib,json,os,pathlib,shutil,signal,stat,subprocess,sys,tempfile,zipfile
OP="curriculum-migration-complete-receiving-20261013"
SCHEMA="curriculum-receiving-owner.v2"
def need(ok,message):
 if not ok:raise RuntimeError(message)
def stamp():return datetime.datetime.now(datetime.timezone.utc).isoformat()
def emit(value):print(json.dumps(value,ensure_ascii=False),flush=True)
def digest(path):
 h=hashlib.sha256()
 with path.open("rb") as f:
  for chunk in iter(lambda:f.read(1048576),b""):h.update(chunk)
 return h.hexdigest()
def regular(path):
 s=path.lstat();need(stat.S_ISREG(s.st_mode),"Preserve a non-regular file: "+str(path));return s
def identity(path):return {"bytes":regular(path).st_size,"sha256":digest(path)}
def encoded(value):return (json.dumps(value,ensure_ascii=False,sort_keys=True,indent=2)+"\n").encode()
def read(path):regular(path);return json.loads(path.read_bytes())
def atomic(path,value):
 temporary=path.with_name("."+path.name+"."+str(os.getpid())+".partial")
 with temporary.open("xb") as out:out.write(encoded(value));out.flush();os.fsync(out.fileno())
 os.chmod(temporary,0o600);os.replace(temporary,path)
 fd=os.open(path.parent,os.O_RDONLY|os.O_DIRECTORY)
 try:os.fsync(fd)
 finally:os.close(fd)
def retain(path,value):
 if path.exists():need(read(path)==value,"The original receiving input changed: "+str(path));return
 atomic(path,value)
def private(path):
 path.mkdir(mode=0o700,parents=True,exist_ok=True)
 s=path.lstat();need(stat.S_ISDIR(s.st_mode) and path.resolve()==path and s.st_uid==os.getuid(),"Use an owned real work directory: "+str(path))
 if s.st_mode&0o077:path.chmod(0o700)
def process_identity(pid):
 try:
  text=pathlib.Path("/proc",str(pid),"stat").read_text();fields=text[text.rfind(")")+2:].split()
  return {"pid":pid,"startTicks":fields[19],"processGroup":int(fields[2]),"bootId":pathlib.Path("/proc/sys/kernel/random/boot_id").read_text().strip()}
 except (OSError,ValueError,IndexError):return None
def same_process(value):return bool(value) and process_identity(value["pid"])==value
def holds_descriptor(value,fd,lock):
 if not same_process(value):return False
 try:
  a=os.stat("/proc/"+str(value["pid"])+"/fd/"+str(fd));b=os.fstat(lock)
  return (a.st_dev,a.st_ino)==(b.st_dev,b.st_ino)
 except OSError:return False
def signal_bound(value,descriptor,lock,signum):
 need(hasattr(os,"pidfd_open") and hasattr(signal,"pidfd_send_signal"),"This Linux runtime must support pidfd signalling for the original owner")
 try:handle=os.pidfd_open(value["pid"],0)
 except ProcessLookupError:return False
 try:
  need(holds_descriptor(value,descriptor,lock),"The recorded original process or inherited lease changed before signalling")
  try:signal.pidfd_send_signal(handle,signum)
  except ProcessLookupError:return False
  return True
 finally:os.close(handle)
def source_inventory(root,work):
 result=[]
 for directory,dirs,names in os.walk(root,followlinks=False):
  base=pathlib.Path(directory)
  dirs[:]=sorted(x for x in dirs if x not in (".git","node_modules","__pycache__") and not (base/x).is_symlink() and base/x!=work and base/x!=root/"receiving")
  for name in sorted(names):
   p=base/name
   if p==work or work in p.parents or name in ("delivery-result.json","Curriculum_Migration_Complete_Receiving_20261013.zip") or name.endswith((".lock",".log")):continue
   need(not p.is_symlink(),"A source file is linked; receive its actual complete source first: "+str(p))
   result.append({"path":p.relative_to(root).as_posix(),**identity(p)})
 return result
def main():
 parser=argparse.ArgumentParser(description=__doc__)
 parser.add_argument("--work-dir",help="Original private receiving directory; defaults to SOURCE/receiving")
 parser.add_argument("--chromium",help="Existing Chromium/Headless Shell executable; no installation")
 parser.add_argument("--node",help="Existing Node executable")
 parser.add_argument("--node-modules",help="Existing Playwright and TypeScript dependency directory")
 parser.add_argument("--workspace",help="Existing complete workspace export containing original cases and any real BULK case")
 parser.add_argument("--bulk-options",help="Reviewed BULK case/namespaces/mappings/decision JSON")
 parser.add_argument("--interrupt",action="store_true",help="Signal only the retained live owner of this work directory")
 args=parser.parse_args()
 root=pathlib.Path(__file__).resolve().parent
 work=pathlib.Path(args.work_dir).absolute() if args.work_dir else root/"receiving"
 private(work)
 lock_path=work/"complete-receiving.lock"
 lock=os.open(lock_path,os.O_RDWR|os.O_CREAT|os.O_NOFOLLOW,0o600)
 ls=os.fstat(lock);need(stat.S_ISREG(ls.st_mode) and ls.st_nlink==1 and not ls.st_mode&0o077,"The receiving lease is not a private regular file")
 held=False
 try:
  try:fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB);held=True
  except BlockingIOError:
   if not args.interrupt:raise RuntimeError("The original receiving owner is still active; inspect owner.json or use --interrupt for that owner.")
  owner_path=work/"owner.json"
  if args.interrupt:
   if held:emit({"operation":OP,"state":"NO_LIVE_OWNER","workDir":str(work)});return 0
   owner=read(owner_path);need(owner.get("schema")==SCHEMA and owner.get("operation")==OP and owner.get("workDir")==str(work),"The live owner belongs to another operation")
   parent=owner.get("supervisor");child=owner.get("child");fd=owner.get("lockFd")
   need(isinstance(fd,int),"Original owner descriptor is absent")
   if holds_descriptor(parent,fd,lock):sent=signal_bound(parent,fd,lock,signal.SIGTERM);target=parent
   elif holds_descriptor(child,fd,lock):
    sent=signal_bound(child,fd,lock,signal.SIGTERM);target=child
   else:raise RuntimeError("The lock is held but its recorded process identity is unresolved; preserve the owner before another signal.")
   emit({"operation":OP,"state":"INTERRUPT_SENT" if sent else "ORIGINAL_OWNER_ALREADY_CLOSED","target":target,"workDir":str(work)});return 0
  legacy=root/"complete-receiving.lock"
  need(not legacy.exists(),"Preserve the legacy receiving marker and reconcile its original owner before adopting the new retained lifecycle: "+str(legacy))
  need(hasattr(os,"pidfd_open") and hasattr(signal,"pidfd_send_signal"),"An existing Linux runtime with pidfd support is required")
  capability=os.pidfd_open(os.getpid(),0);os.close(capability)
  # The kernel lease, not an old PID marker, establishes the same-operation boundary.
  prior=read(work/"intent.json") if (work/"intent.json").exists() else None
  node=pathlib.Path(args.node or (prior or {}).get("node",{}).get("path") or os.environ.get("CODEX_PRIMARY_RUNTIME_NODE") or shutil.which("node") or "").resolve()
  need(node.is_file() and os.access(node,os.X_OK),"An existing executable Node runtime is required")
  chromium_choice=args.chromium or ((prior or {}).get("chromium") or {}).get("path") or os.environ.get("CURRICULUM_CHROMIUM")
  chromium=None
  if chromium_choice:
   chromium=pathlib.Path(chromium_choice).resolve();need(chromium.is_file() and os.access(chromium,os.X_OK),"The selected existing Chromium executable is unavailable")
  modules=args.node_modules or (prior or {}).get("nodeModules") or os.environ.get("CODEX_PRIMARY_RUNTIME_NODE_MODULES")
  modules=str(pathlib.Path(modules).resolve()) if modules else None
  selected=args.workspace or (prior or {}).get("workspace",{}).get("path")
  workspace=pathlib.Path(selected).resolve() if selected else root/"initial-workspace.json"
  bulk_selected=args.bulk_options or ((prior or {}).get("bulkOptions") or {}).get("path")
  bulk=pathlib.Path(bulk_selected).resolve() if bulk_selected else None
  need(not bulk or selected,"BULK options require the supplied original complete workspace")
  sources=source_inventory(root,work)
  intent={"schema":"curriculum-receiving-intent.v2","operation":OP,"sourceRoot":str(root),"workDir":str(work),
   "node":{"path":str(node),**identity(node)},"chromium":{"path":str(chromium),**identity(chromium)} if chromium else None,
   "nodeModules":modules,"workspace":{"path":str(workspace),**identity(workspace)},
   "bulkOptions":{"path":str(bulk),**identity(bulk)} if bulk else None,"sources":sources}
  retain(work/"intent.json",intent)
  env={**os.environ,"NODE_OPTIONS":"--max-old-space-size=384","OMP_NUM_THREADS":"1","OPENBLAS_NUM_THREADS":"1",
       "CURRICULUM_RECEIVING_JOB":str(work/"intent.json"),"CURRICULUM_RECEIVING_LOCK_FD":str(lock)}
  temporary=work/"temporary";private(temporary)
  env.update(TMPDIR=str(temporary),TEMP=str(temporary),TMP=str(temporary))
  if modules:env["CODEX_PRIMARY_RUNTIME_NODE_MODULES"]=modules
  owner={"schema":SCHEMA,"operation":OP,"workDir":str(work),"supervisor":process_identity(os.getpid()),
         "child":None,"lockFd":lock,"state":"STARTING","startedAt":stamp()}
  atomic(owner_path,owner)
  child=None;interrupted=[]
  def stop(signum,frame):
   interrupted.append(signum)
   if child and child.poll() is None and holds_descriptor(owner.get("child"),lock,lock):signal_bound(owner["child"],lock,lock,signal.SIGTERM)
  for sig in (signal.SIGINT,signal.SIGTERM):signal.signal(sig,stop)
  with (work/"native.stdout.log").open("ab") as stdout,(work/"native.stderr.log").open("ab") as stderr:
   child=subprocess.Popen([str(node),str(root/"complete-receiving.mjs")],cwd=root,env=env,stdout=stdout,stderr=stderr,pass_fds=(lock,),start_new_session=True)
   owner["child"]=process_identity(child.pid);owner["state"]="RUNNING";atomic(owner_path,owner)
   emit(owner)
   if interrupted:stop(interrupted[-1],None)
   code=child.wait()
  owner.update(state="CLOSED",exitCode=code,completedAt=stamp(),interrupted=bool(interrupted));atomic(owner_path,owner)
  if code:
   emit({"operation":OP,"state":"RECEIVING_INCOMPLETE","exitCode":code,"workDir":str(work),"log":str(work/"native.stderr.log")})
   return code if code>0 else 128-code
  report=read(work/"result.json");need(report.get("status")=="COMPLETE" and report.get("operation")==OP,"The original receiving result is incomplete")
  for file in report["files"]:
   p=work/file["path"];need(p.resolve()==p and work in p.parents and identity(p)=={k:file[k] for k in ("bytes","sha256")},"A completed original result file changed")
  need(source_inventory(root,work)==sources,"The original source changed during receiving")
  # Package complete source and the exact public course inventory. Browser profiles,
  # temporary state and private locks stay with this same original work directory.
  members={ "source/"+f["path"]:root/f["path"] for f in sources }
  members.update({"receiving/"+f["path"]:work/f["path"] for f in report["files"]})
  for name in ("intent.json","result.json"):members["receiving/"+name]=work/name
  inventory=[{"path":name,**identity(path)} for name,path in sorted(members.items())]
  manifest={"schema":"curriculum-receiving-package.v2","operation":OP,"intentSha256":digest(work/"intent.json"),"files":inventory}
  archive=work/"Curriculum_Migration_Complete_Receiving_20261013.zip"
  def verify_archive():
   with zipfile.ZipFile(archive) as z:
    names=z.namelist();need(len(names)==len(set(names)) and set(names)==set(members)|{"delivery-manifest.json"},"Receiving archive has a different complete inventory")
    need(json.loads(z.read("delivery-manifest.json"))==manifest,"Receiving archive belongs to different input or completed outputs")
    for f in inventory:
     with z.open(f["path"]) as stream:
      h=hashlib.sha256();count=0
      for chunk in iter(lambda:stream.read(1048576),b""):h.update(chunk);count+=len(chunk)
     need(count==f["bytes"] and h.hexdigest()==f["sha256"],"Receiving archive member differs: "+f["path"])
  if archive.exists():verify_archive()
  else:
   fd,name=tempfile.mkstemp(prefix=".receiving-package-",suffix=".partial",dir=work);os.close(fd);part=pathlib.Path(name)
   try:
    with zipfile.ZipFile(part,"w",compression=zipfile.ZIP_DEFLATED,compresslevel=6) as z:
     z.writestr("delivery-manifest.json",encoded(manifest))
     for name,path in sorted(members.items()):z.write(path,name)
    with part.open("rb") as handle:os.fsync(handle.fileno())
    os.replace(part,archive);verify_archive()
   finally:
    if part.exists():part.unlink()
  receipt={"operation":OP,"status":"COMPLETE","path":str(archive),**identity(archive),"result":report,"delivery":"Complete local package; continue its existing durable delivery owner."}
  retain(work/"delivery-result.json",receipt);emit(receipt);return 0
 finally:os.close(lock)
if __name__=="__main__":
 try:raise SystemExit(main())
 except Exception as error:emit({"operation":OP,"state":"STOPPED","error":str(error)});raise
