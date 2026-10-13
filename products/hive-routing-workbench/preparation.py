#!/usr/bin/env python3
"""Prepare and receive the exact Hive application, router and offline PyYAML wheel."""
from __future__ import annotations
import argparse, base64, contextlib, csv, email.parser, fcntl, gzip, hashlib, io
import json, os, platform, shutil, signal, stat, subprocess, sys, tarfile, tempfile, time
import urllib.request, uuid, zipfile
from pathlib import Path, PurePosixPath

PRODUCT = Path(__file__).resolve().parent
MANIFEST_SHA256 = "b73dcb02995c22d150159709f95bab37e1b2ddec604672aed0a9fc18cd9b5574"
RUNTIME_SCHEMA = "stellar-forge.hive-routing-runtime.v1"
PREPARED_SCHEMA = "stellar-forge.hive-routing-preparation.v1"
PORTABLE_SCHEMA = "stellar-forge.hive-routing-portable.v1"
RECEIVED_SCHEMA = "stellar-forge.hive-routing-received.v1"
ROUTERS = {
 "x64": {"name":"hive_router_linux_amd64","bytes":70274296,"sha256":"d59fc37101f1ae9c78dffc7a62dafd1ab7e4905aaa300e692661067b32670af6"},
 "arm64": {"name":"hive_router_linux_arm64","bytes":63567664,"sha256":"b4e5e0c36a08f1e3bf25946228de2f00c99c672945358facdf1f6c2dc28b3bb3"},
}
MAX_ARCHIVE = 256 * 1024 * 1024
LOCKS = []
CANCELLED = None

def require(value, message):
 if not value: raise ValueError(message)

def encoded(value):
 return (json.dumps(value,sort_keys=True,indent=2,ensure_ascii=False,allow_nan=False)+"\n").encode("utf-8")

def digest(raw): return hashlib.sha256(raw).hexdigest()

def ordinary(path, *, directory=False):
 p=Path(path).absolute()
 require(p.resolve()==p,"Select an ordinary canonical path: "+str(p))
 if p.exists():
  st=p.lstat()
  require(stat.S_ISDIR(st.st_mode) if directory else stat.S_ISREG(st.st_mode),"Select an ordinary "+("directory: " if directory else "file: ")+str(p))
 return p

def identity(path):
 p=ordinary(path); h=hashlib.sha256(); length=0
 with p.open("rb") as f:
  before=os.fstat(f.fileno())
  for block in iter(lambda:f.read(1024*1024),b""): h.update(block);length+=len(block)
  after=os.fstat(f.fileno())
 require((before.st_dev,before.st_ino,before.st_size,before.st_mtime_ns,before.st_ctime_ns)==(after.st_dev,after.st_ino,after.st_size,after.st_mtime_ns,after.st_ctime_ns),"Selected file changed during read: "+str(p))
 return {"path":str(p),"bytes":length,"sha256":h.hexdigest()}

def compare(path,row):
 found=identity(path)
 require(all(found[k]==row[k] for k in ("bytes","sha256")),"Selected bytes differ: "+str(path))
 return found

def read(path,limit=2*1024*1024):
 p=ordinary(path);require(p.stat().st_size<=limit,"Selected metadata exceeds its bound")
 body=p.read_bytes();compare(p,{"bytes":len(body),"sha256":digest(body)});return body

def value(path):return json.loads(read(path))

def sync(directory):
 fd=os.open(directory,os.O_RDONLY|os.O_DIRECTORY)
 try:os.fsync(fd)
 finally:os.close(fd)

def mkdir(path):
 p=ordinary(path,directory=True);p.mkdir(parents=True,exist_ok=True,mode=0o700)
 require(p.resolve()==p,"Directory changed during creation");sync(p.parent);return p

def publish(path,body,mode=0o600):
 p=ordinary(path);mkdir(p.parent)
 if p.exists():
  require(read(p,max(len(body),1))==body,"Retain the original immutable value: "+str(p));return p
 fd,temp=tempfile.mkstemp(prefix=p.name+".writing-",dir=p.parent)
 try:
  with os.fdopen(fd,"wb") as out:out.write(body);out.flush();os.fchmod(out.fileno(),mode);os.fsync(out.fileno())
  try:os.link(temp,p)
  except FileExistsError:require(read(p,max(len(body),1))==body,"Concurrent immutable publication differs")
  sync(p.parent)
 finally:
  if os.path.exists(temp):os.unlink(temp);sync(p.parent)
 return p

def publish_json(path,body):return publish(path,encoded(body))

def copy_file(source,target,row=None,mode=0o600):
 source=ordinary(source); selected=row or identity(source);target=ordinary(target);mkdir(target.parent)
 if target.exists():return compare(target,selected)
 fd,temp=tempfile.mkstemp(prefix=target.name+".writing-",dir=target.parent)
 try:
  with source.open("rb") as original,os.fdopen(fd,"wb") as output:
   shutil.copyfileobj(original,output,1024*1024);output.flush();os.fchmod(output.fileno(),mode);os.fsync(output.fileno())
  compare(temp,selected);compare(source,selected)
  try:os.link(temp,target)
  except FileExistsError:compare(target,selected)
  sync(target.parent)
 finally:
  if os.path.exists(temp):os.unlink(temp);sync(target.parent)
 return compare(target,selected)

@contextlib.contextmanager
def lease(directory):
 root=mkdir(directory);attributes=root.stat()
 require(attributes.st_uid==os.getuid() and not attributes.st_mode&0o077,"Use an owned private preparation directory")
 path=ordinary(root/"lifetime.lock")
 fd=os.open(path,os.O_CREAT|os.O_RDWR|os.O_NOFOLLOW,0o600)
 try:
  held=os.fstat(fd)
  require(stat.S_ISREG(held.st_mode) and held.st_uid==os.getuid() and not held.st_mode&0o077 and held.st_nlink==1,"Select the original ordinary private lease")
  fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB);os.set_inheritable(fd,True);LOCKS.append(fd)
  yield root
 finally:
  if fd in LOCKS:LOCKS.remove(fd)
  os.close(fd)

def source_manifest():
 raw=read(PRODUCT/"original-source.json")
 require(digest(raw)==MANIFEST_SHA256,"Installed original-source.json differs from this preparation selection")
 manifest=json.loads(raw)
 require(manifest.get("schema")=="stellar-forge.hive-routing-original-source.v1" and len(manifest.get("files",[]))==64,"Select the complete original 64-file Hive application")
 seen=set()
 for row in manifest["files"]:
  name=row["path"];safe_name(name)
  require(name not in seen and isinstance(row["bytes"],int) and row["bytes"]>=0 and len(row["sha256"])==64,"Invalid complete source member")
  seen.add(name)
 return raw,manifest

def safe_name(name):
 require(isinstance(name,str) and name and "\\" not in name and "\0" not in name and not PurePosixPath(name).is_absolute() and all(x not in ("",".","..") for x in name.split("/")),"Unsafe source/archive name")
 return name

def source_check(directory,manifest):
 root=ordinary(directory,directory=True);actual=set()
 for p in root.rglob("*"):
  require(not p.is_symlink(),"Source symlink is not an original member")
  if "__pycache__" in p.relative_to(root).parts:continue
  if p.is_file():actual.add(p.relative_to(root).as_posix())
  else:require(p.is_dir(),"Nonordinary source entry")
 require(actual=={x["path"] for x in manifest["files"]},"Retain every original source file and no undeclared application files")
 for row in manifest["files"]:compare(root/row["path"],row)
 return {"manifestSha256":MANIFEST_SHA256,"files":64,"bytes":sum(x["bytes"] for x in manifest["files"])}

def copy_source(source,destination,manifest):
 source_check(source,manifest);mkdir(destination)
 for row in manifest["files"]:copy_file(Path(source)/row["path"],Path(destination)/row["path"],row,0o644)
 return source_check(destination,manifest)

def host():
 require(sys.platform=="linux","This original runtime selection requires Linux")
 machine=platform.machine().lower()
 architecture={"x86_64":"x64","amd64":"x64","aarch64":"arm64","arm64":"arm64"}.get(machine)
 require(architecture in ROUTERS,"Select the published Linux x64 or arm64 router")
 return {"platform":"linux","architecture":architecture}

def canonical_python(path):
 p=Path(path).expanduser().resolve(strict=True)
 require(p.is_file() and os.access(p,os.X_OK),"Select the existing executable Python")
 return identity(p)

def group_alive(pgid):
 # Only the session created by command() is owned here; zombies cannot execute.
 for entry in Path("/proc").iterdir():
  if not entry.name.isdigit():continue
  try:
   raw=(entry/"stat").read_text();fields=raw[raw.rfind(")")+2:].split()
   if int(fields[2])==pgid and fields[0] not in ("Z","X"):return True
  except (OSError,ValueError,IndexError):continue
 return False

def settle(child,cancel=False):
 start=time.monotonic();sent=False;killed=False
 while True:
  if cancel or CANCELLED:
   if not sent:
    try:os.killpg(child.pid,signal.SIGTERM)
    except ProcessLookupError:pass
    sent=True;start=time.monotonic()
   elif time.monotonic()-start>=15 and not killed:
    try:os.killpg(child.pid,signal.SIGKILL)
    except ProcessLookupError:pass
    killed=True
  code=child.poll()
  if code is not None and not group_alive(child.pid):return code
  time.sleep(.1)

def command(root,name,argv):
 require(not CANCELLED,"Preparation interrupted before child entry")
 commands=mkdir(Path(root)/"commands");step=mkdir(commands/name)
 request={"argv":[str(a) for a in argv],"cwd":str(PRODUCT),"pythonBytecode":False}
 publish_json(step/"request.json",request)
 completed=step/"COMPLETE.json"
 if completed.exists():
  old=value(completed);require(old["request"]==request and old["exitCode"]==0,"Original command result differs")
  compare(step/old["stdout"],old["stdoutIdentity"]);compare(step/old["stderr"],old["stderrIdentity"])
  return read(step/old["stdout"],8*1024*1024)
 attempts=sorted(step.glob("attempt-*"))
 number=len(attempts)+1;attempt=mkdir(step/("attempt-"+str(number).zfill(4)))
 publish_json(attempt/"intent.json",{"request":request,"number":number})
 env={k:v for k,v in os.environ.items() if not k.startswith(("PYTHON","PIP_"))}
 env.update({"PYTHONDONTWRITEBYTECODE":"1","PYTHONNOUSERSITE":"1","PIP_DISABLE_PIP_VERSION_CHECK":"1"})
 child=None;failure=None
 with (attempt/"stdout.log").open("xb") as out,(attempt/"stderr.log").open("xb") as err:
  try:
   child=subprocess.Popen(request["argv"],cwd=PRODUCT,env=env,stdin=subprocess.DEVNULL,stdout=out,stderr=err,start_new_session=True,pass_fds=tuple(LOCKS))
   publish_json(attempt/"started.json",{"pid":child.pid,"request":request,"at":time.time()})
   code=settle(child)
  except BaseException as exc:
   failure=exc
   if child is not None:code=settle(child,cancel=True)
   else:code=None
  out.flush();err.flush();os.fsync(out.fileno());os.fsync(err.fileno())
 if child is not None:
  result={"request":request,"exitCode":code,"stdout":str((attempt/"stdout.log").relative_to(step)),"stderr":str((attempt/"stderr.log").relative_to(step)),"closedAt":time.time(),"stdoutIdentity":identity(attempt/"stdout.log"),"stderrIdentity":identity(attempt/"stderr.log")}
  publish_json(attempt/"closed.json",result)
  if code==0 and not failure and not CANCELLED:publish_json(completed,result)
 if failure:raise failure
 require(not CANCELLED,"Preparation interrupted after its original child closed")
 require(child is not None and code==0,"Original preparation child failed; retain "+str(attempt))
 return read(attempt/"stdout.log",8*1024*1024)

def wheel_info(path):
 p=ordinary(path);require(p.name.endswith(".whl"),"Supply the complete compatible wheel")
 with zipfile.ZipFile(p) as z:
  infos=z.infolist();names=[x.filename for x in infos]
  require(len(names)==len(set(names)) and sum(x.file_size for x in infos)<=64*1024*1024,"Wheel population differs")
  for i in infos:
   if i.is_dir():continue
   safe_name(i.filename);require(not stat.S_ISLNK(i.external_attr>>16),"Wheel symlink is not selected")
  metas=[x for x in names if x.endswith(".dist-info/METADATA")]
  require(len(metas)==1,"Select one complete PyYAML wheel")
  meta=email.parser.BytesParser().parsebytes(z.read(metas[0]))
  require(meta["Name"].lower()=="pyyaml" and meta["Version"]=="6.0.3" and not meta.get_all("Requires-Dist"),"Select PyYAML==6.0.3 without unselected dependencies")
  record=metas[0].rsplit("/",1)[0]+"/RECORD";listed=set()
  for name,hashvalue,length in csv.reader(io.StringIO(z.read(record).decode())):
   safe_name(name);require(name not in listed and name in names,"Wheel RECORD population differs");listed.add(name)
   if name==record:continue
   body=z.read(name);require(hashvalue.startswith("sha256=") and len(body)==int(length),"Wheel RECORD identity differs")
   require(base64.urlsafe_b64encode(hashlib.sha256(body).digest()).decode().rstrip("=")==hashvalue[7:],"Wheel RECORD digest differs")
  require(listed=={i.filename for i in infos if not i.is_dir()},"Retain the complete original wheel")
 return {**identity(p),"filename":p.name,"version":"6.0.3"}

def download_router(root,architecture,selected):
 path=Path(root)/"router"/"hive_router";mkdir(path.parent)
 row=ROUTERS[architecture]
 if path.exists():compare(path,row);require(os.access(path,os.X_OK),"Retained router lost executable mode");return identity(path)
 if selected:return copy_file(selected,path,row,0o755)
 url="https://github.com/graphql-hive/router/releases/download/hive-router/v0.3.4/"+row["name"]
 publish_json(Path(root)/"router"/"DOWNLOAD.json",{"url":url,**row})
 fd,temp=tempfile.mkstemp(prefix="hive_router.downloading-",dir=path.parent)
 try:
  with os.fdopen(fd,"wb") as output,urllib.request.urlopen(urllib.request.Request(url,headers={"User-Agent":"Hive-original-runtime/1","Accept-Encoding":"identity"}),timeout=45) as response:
   require(response.status==200,"Original router download did not return 200");n=0
   while True:
    require(not CANCELLED,"Original router download interrupted")
    block=response.read(1024*1024)
    if not block:break
    n+=len(block);require(n<=row["bytes"],"Original router download exceeded its selection");output.write(block)
   output.flush();os.fchmod(output.fileno(),0o755);os.fsync(output.fileno())
  compare(temp,row);os.link(temp,path);sync(path.parent)
 finally:
  if os.path.exists(temp):os.unlink(temp);sync(path.parent)
 return compare(path,row)

YAML_INSPECT = r'''import importlib.metadata,json,pathlib,sys,hashlib,os
import yaml
d=importlib.metadata.distribution("PyYAML")
assert d.version=="6.0.3" and yaml.__version__=="6.0.3"
root=pathlib.Path(sys.prefix).resolve()
rows=[];seen=set();roots=set();site=pathlib.Path(d.locate_file("")).resolve(strict=True)
for item in d.files or []:
 original=pathlib.Path(d.locate_file(item)).absolute()
 assert not original.is_symlink()
 p=original.resolve(strict=True)
 if "__pycache__" in p.parts or p.suffix in (".pyc",".pyo"):continue
 assert p.resolve()==p and p.is_file() and p.is_relative_to(root)
 relative=p.relative_to(site)
 assert relative.parts and relative.parts[0] not in (".","..")
 roots.add(site/relative.parts[0])
 assert str(p) not in seen
 seen.add(str(p));body=p.read_bytes();rows.append({"path":str(p),"bytes":len(body),"sha256":hashlib.sha256(body).hexdigest()})
actual=set()
for top in roots:
 for p in ([top] if top.is_file() else top.rglob("*")):
  if "__pycache__" in p.parts or p.suffix in (".pyc",".pyo"):continue
  assert not p.is_symlink()
  if p.is_file():actual.add(str(p))
assert actual==seen and rows
print(json.dumps({"version":yaml.__version__,"files":sorted(rows,key=lambda x:x["path"]),"python":str(pathlib.Path(sys.executable).absolute()),"prefix":str(root)},sort_keys=True))
'''

def install_runtime(root,source,manifest,raw_manifest,python,router_source=None,wheel_source=None,architecture=None):
 root=Path(root);architecture=architecture or host()["architecture"]
 with lease(root):
  selection={"schema":"stellar-forge.hive-runtime-selection.v1","root":str(root),"source":MANIFEST_SHA256,"python":python,"architecture":architecture,
   "router":identity(router_source) if router_source else {"download":ROUTERS[architecture]},
   "wheel":wheel_info(wheel_source) if wheel_source else {"download":"PyYAML==6.0.3"}}
  publish_json(root/"selection.json",selection)
  ready_path=root/"runtime-ready.json"
  if ready_path.exists():return inspect_runtime(ready_path,manifest)
  copy_source(source,root/"application",manifest);publish(root/"original-source.json",raw_manifest)
  router=download_router(root,architecture,router_source)
  venv=root/"venv"
  command(root,"create-venv",[python["path"],"-I","-B","-m","venv","--copies",str(venv)])
  executable=ordinary(venv/"bin"/"python");require(executable.exists(),"Original venv interpreter is absent")
  require(executable.read_bytes()==Path(python["path"]).read_bytes(),"Copied interpreter differs from selected Python")
  wheels=mkdir(root/"wheels")
  if wheel_source:
   selected=wheel_info(wheel_source);wheel=copy_file(wheel_source,wheels/selected["filename"],selected)
  else:
   command(root,"download-wheel",[str(executable),"-I","-B","-m","pip","--isolated","download","--index-url","https://pypi.org/simple","--only-binary=:all:","--no-deps","--dest",str(wheels),"PyYAML==6.0.3"])
  found=list(wheels.glob("*.whl"));require(len(found)==1,"Retain exactly one selected compatible PyYAML wheel")
  selected=wheel_info(found[0]);publish_json(root/"wheel-selection.json",selected)
  command(root,"install-wheel",[str(executable),"-I","-B","-m","pip","--isolated","install","--no-index","--no-deps","--no-compile","--force-reinstall",str(found[0])])
  observed=json.loads(command(root,"inspect-yaml",[str(executable),"-I","-B","-c",YAML_INSPECT]))
  require(observed["python"]==str(executable) and observed["prefix"]==str(venv),"Dependency inspection escaped selected venv")
  ready={"schema":RUNTIME_SCHEMA,"state":"READY",**host(),"applicationDirectory":str(root/"application"),"sourceManifest":str(root/"original-source.json"),"sourceManifestSha256":MANIFEST_SHA256,
   "python":identity(executable),"basePython":python,"router":router,"wheel":identity(found[0]),"yaml":{"version":"6.0.3","files":observed["files"]},
   "selectionSha256":digest(encoded(selection))}
  publish_json(root/"runtime-ready.candidate.json",ready)
  inspect_runtime_value(ready,manifest)
  publish_json(ready_path,ready)
  return runtime_return(ready_path,ready)

def runtime_return(path,ready):
 return {"applicationDirectory":ready["applicationDirectory"],"runtimeReadyFile":str(Path(path).absolute()),"python":ready["python"]["path"],"router":ready["router"]["path"]}

def inspect_runtime_value(ready,manifest):
 require(ready.get("schema")==RUNTIME_SCHEMA and ready.get("state")=="READY","Select a completed original runtime")
 require(all(ready.get(k)==v for k,v in host().items()),"Runtime platform or architecture differs")
 require(ready.get("sourceManifestSha256")==MANIFEST_SHA256,"Runtime source selection differs")
 require(read(ready["sourceManifest"])==read(PRODUCT/"original-source.json"),"Runtime source manifest differs")
 source_check(ready["applicationDirectory"],manifest)
 for key in ("python","router","wheel","basePython"):compare(ready[key]["path"],ready[key])
 compare(ready["router"]["path"],ROUTERS[ready["architecture"]]);require(os.access(ready["router"]["path"],os.X_OK),"Router is not executable")
 require(ready["yaml"]["version"]=="6.0.3" and ready["yaml"]["files"],"Retain the installed PyYAML population")
 root=Path(ready["python"]["path"]).parent.parent;seen=set()
 for row in ready["yaml"]["files"]:
  p=ordinary(row["path"]);require(p.is_relative_to(root) and "__pycache__" not in p.parts and str(p) not in seen,"Dependency inventory escaped selected runtime");seen.add(str(p));compare(p,row)
 # Reopen the whole selected dependency tree, including metadata and extensions.
 roots=set()
 for row in ready["yaml"]["files"]:
  p=Path(row["path"]);parts=p.relative_to(root).parts
  require("site-packages" in parts,"Installed dependency is outside the venv site-packages")
  index=parts.index("site-packages");require(len(parts)>index+1,"Installed dependency path is incomplete")
  roots.add(root.joinpath(*parts[:index+2]))
 actual=set()
 for top in roots:
  for p in ([top] if top.is_file() else top.rglob("*")):
   if "__pycache__" in p.parts or p.suffix in (".pyc",".pyo"):continue
   require(not p.is_symlink(),"Installed dependency includes an unselected symlink")
   if p.is_file():actual.add(str(p))
 require(actual==seen,"Installed dependency population changed")
 require(wheel_info(ready["wheel"]["path"])["version"]=="6.0.3","Runtime wheel differs")
 return ready

def inspect_runtime(path,manifest):
 path=ordinary(path);ready=inspect_runtime_value(value(path),manifest);root=path.parent
 require(ready["applicationDirectory"]==str(root/"application") and ready["python"]["path"]==str(root/"venv"/"bin"/"python") and ready["router"]["path"]==str(root/"router"/"hive_router") and Path(ready["wheel"]["path"]).parent==root/"wheels","Runtime ready paths differ from their selected installation")
 require(value(root/"selection.json")["python"]==ready["basePython"] and digest(encoded(value(root/"selection.json")))==ready["selectionSha256"],"Runtime request binding differs")
 return runtime_return(path,ready)

def portable_members(runtime,manifest):
 ready=value(runtime["runtimeReadyFile"]);inspect_runtime_value(ready,manifest)
 members=[{"path":"application/"+r["path"],"bytes":r["bytes"],"sha256":r["sha256"],"mode":0o644,"source":str(Path(runtime["applicationDirectory"])/r["path"])} for r in manifest["files"]]
 members += [{"path":"router/hive_router","bytes":ready["router"]["bytes"],"sha256":ready["router"]["sha256"],"mode":0o755,"source":ready["router"]["path"]},
 {"path":"wheels/"+Path(ready["wheel"]["path"]).name,"bytes":ready["wheel"]["bytes"],"sha256":ready["wheel"]["sha256"],"mode":0o644,"source":ready["wheel"]["path"]},
 {"path":"original-source.json",**{k:identity(PRODUCT/"original-source.json")[k] for k in ("bytes","sha256")},"mode":0o644,"source":str(PRODUCT/"original-source.json")}]
 metadata={"schema":PORTABLE_SCHEMA,**host(),"sourceManifestSha256":MANIFEST_SHA256,"files":[{k:v for k,v in row.items() if k!="source"} for row in sorted(members,key=lambda r:r["path"])]}
 return metadata,sorted(members,key=lambda r:r["path"])

def inspect_portable(path,manifest,expected=None):
 path=ordinary(path);found=identity(path)
 require(found["bytes"]<=MAX_ARCHIVE,"Portable archive exceeds bound")
 if expected:compare(path,expected)
 with tarfile.open(path,"r:gz") as archive:
  entries=archive.getmembers();names=[e.name for e in entries]
  require(len(names)==len(set(names)) and all(e.isfile() and not e.pax_headers for e in entries),"Portable archive contains nonordinary or duplicate members")
  require(names and names[0]=="portable.json","Portable header must precede its exact payload")
  header=entries[0];require(header.size<=128*1024,"Portable header exceeds bound")
  meta=json.loads(archive.extractfile(header).read())
  require(meta.get("schema")==PORTABLE_SCHEMA and all(meta.get(k)==v for k,v in host().items()) and meta.get("sourceManifestSha256")==MANIFEST_SHA256,"Portable runtime/source selection differs")
  rows=meta["files"];selected={r["path"]:r for r in rows}
  require(len(selected)==len(rows) and set(names)==set(selected)|{"portable.json"} and sum(e.size for e in entries)<=MAX_ARCHIVE,"Portable payload population differs")
  expected_sources={"application/"+r["path"]:(r["bytes"],r["sha256"],0o644) for r in manifest["files"]}
  wheels=[n for n in selected if n.startswith("wheels/")]
  require(len(wheels)==1 and "/" not in wheels[0][7:] and wheels[0].endswith(".whl"),"Portable wheel population differs")
  require(set(selected)==set(expected_sources)|{"router/hive_router","original-source.json",wheels[0]},"Portable contains an undeclared payload")
  require(selected["original-source.json"]["sha256"]==MANIFEST_SHA256,"Portable original manifest differs")
  router=ROUTERS[meta["architecture"]]
  require(all(selected["router/hive_router"][k]==router[k] for k in ("bytes","sha256")) and selected["router/hive_router"]["mode"]==0o755,"Portable router differs")
  for name,values in expected_sources.items():require(tuple(selected[name][k] for k in ("bytes","sha256","mode"))==values,"Portable original source row differs")
  for member in entries[1:]:
   safe_name(member.name);row=selected[member.name]
   require(member.size==row["bytes"] and member.mode==row["mode"] and member.mode in (0o644,0o755),"Portable member mode/size differs")
   stream=archive.extractfile(member);h=hashlib.sha256()
   for block in iter(lambda:stream.read(1024*1024),b""):h.update(block)
   require(h.hexdigest()==row["sha256"],"Portable member hash differs")
 return {**found,"manifest":meta}

def export_runtime(runtime,out,manifest):
 out=ordinary(out);runtime_root=Path(runtime["runtimeReadyFile"]).parent
 require(not out.is_relative_to(runtime_root),"Keep portable exports outside the prepared application/runtime directory")
 mkdir(out.parent);meta,members=portable_members(runtime,manifest)
 selection={"schema":"stellar-forge.hive-portable-export.v1","out":str(out),"manifest":meta}
 publish_json(out.with_name(out.name+".selection.json"),selection)
 candidate=out.with_name(out.name+".candidate")
 if not candidate.exists():
  fd,temp=tempfile.mkstemp(prefix=out.name+".writing-",dir=out.parent)
  try:
   with os.fdopen(fd,"wb") as output:
    with gzip.GzipFile(filename="",fileobj=output,mode="wb",mtime=0) as gz,tarfile.open(fileobj=gz,mode="w|",format=tarfile.USTAR_FORMAT) as archive:
     body=encoded(meta);info=tarfile.TarInfo("portable.json");info.size=len(body);info.mode=0o644;archive.addfile(info,io.BytesIO(body))
     for row in members:
      compare(row["source"],row);info=tarfile.TarInfo(row["path"]);info.size=row["bytes"];info.mode=row["mode"]
      with Path(row["source"]).open("rb") as stream:archive.addfile(info,stream)
      compare(row["source"],row)
    output.flush();os.fsync(output.fileno())
   inspect_portable(temp,manifest)
   try:os.link(temp,candidate)
   except FileExistsError:require(identity(temp)["sha256"]==identity(candidate)["sha256"],"Closed portable candidate differs")
   sync(out.parent)
  finally:
   if os.path.exists(temp):os.unlink(temp);sync(out.parent)
 selected=inspect_portable(candidate,manifest)
 require(selected["manifest"]==meta,"Retained portable candidate selection differs")
 publish_json(out.with_name(out.name+".candidate.json"),{k:selected[k] for k in ("bytes","sha256")})
 if out.exists():compare(out,selected)
 else:os.link(candidate,out);sync(out.parent)
 inspect_portable(out,manifest,selected)
 return identity(out)

def extract_payload(archive_path,directory,manifest):
 inspected=inspect_portable(archive_path,manifest);rows={r["path"]:r for r in inspected["manifest"]["files"]}
 with tarfile.open(archive_path,"r:gz") as archive:
  for member in archive.getmembers()[1:]:
   row=rows[member.name];target=ordinary(Path(directory)/member.name);mkdir(target.parent)
   if target.exists():compare(target,row);continue
   fd,temp=tempfile.mkstemp(prefix=target.name+".receiving-",dir=target.parent)
   try:
    with os.fdopen(fd,"wb") as output,archive.extractfile(member) as source:
     shutil.copyfileobj(source,output,1024*1024);output.flush();os.fchmod(output.fileno(),row["mode"]);os.fsync(output.fileno())
    compare(temp,row)
    try:os.link(temp,target)
    except FileExistsError:compare(target,row)
    sync(target.parent)
   finally:
    if os.path.exists(temp):os.unlink(temp);sync(target.parent)
 return inspected

def receive(archive_path,expected_sha,directory,python,manifest,raw_manifest):
 directory=ordinary(directory,directory=True);archive_path=ordinary(archive_path);archive_identity=identity(archive_path)
 require(archive_identity["sha256"]==expected_sha,"Select the exact original portable archive SHA")
 with lease(directory):
  request={"schema":"stellar-forge.hive-receive-request.v1","directory":str(directory),"archive":archive_identity,"python":python,"sourceManifestSha256":MANIFEST_SHA256}
  publish_json(directory/"REQUEST.json",request)
  result_path=directory/"RECEIVED.json";candidate=directory/"RECEIVED.candidate.json"
  if candidate.exists() or result_path.exists():
   result=value(candidate if candidate.exists() else result_path);require(result["request"]==request,"Retained receiving request differs")
   inspect_received(result_path,manifest,result)
   publish_json(result_path,result);return result
  payload=directory/"payload";extract_payload(archive_path,payload,manifest)
  wheels=list((payload/"wheels").glob("*.whl"));require(len(wheels)==1,"Received wheel absent")
  runtime=install_runtime(directory/"runtime",payload/"application",manifest,raw_manifest,python,payload/"router/hive_router",wheels[0])
  result={"schema":RECEIVED_SCHEMA,"state":"READY","request":request,**runtime,"portable":archive_identity,"source":source_check(runtime["applicationDirectory"],manifest),"resultPath":str(result_path)}
  publish_json(candidate,result);inspect_received(result_path,manifest,result);publish_json(result_path,result);return result

def inspect_received(path,manifest,result=None):
 result=result if result is not None else value(path)
 require(result.get("schema")==RECEIVED_SCHEMA and result.get("state")=="READY" and result["resultPath"]==str(Path(path).absolute()),"Select the exact RECEIVED.json")
 require(value(Path(path).parent/"REQUEST.json")==result["request"],"Original receiving request differs")
 require(result["portable"]==result["request"]["archive"] and result["request"]["sourceManifestSha256"]==MANIFEST_SHA256,"Receiving archive/source binding differs")
 require(value(result["runtimeReadyFile"])["basePython"]==result["request"]["python"],"Receiving interpreter selection differs")
 observed=inspect_runtime(result["runtimeReadyFile"],manifest)
 require(observed=={k:result[k] for k in ("applicationDirectory","runtimeReadyFile","python","router")},"Receiving runtime binding differs")
 require(source_check(result["applicationDirectory"],manifest)==result["source"],"Receiving source summary differs")
 inspect_portable(result["portable"]["path"],manifest,result["portable"])
 return result

def inspect_preparation(path,manifest,result=None):
 result=result if result is not None else value(path)
 require(result.get("schema")==PREPARED_SCHEMA and result.get("state")=="READY" and result["resultPath"]==str(Path(path).absolute()),"Select the exact PREPARED.json")
 require(result["source"]=={"manifestSha256":MANIFEST_SHA256,"files":64,"bytes":sum(r["bytes"] for r in manifest["files"])},"Preparation source differs")
 require(result["primary"]["applicationDirectory"]!=result["receiving"]["applicationDirectory"] and result["primary"]["python"]!=result["receiving"]["python"],"Receiving installation must be independent")
 for label in ("primary","receiving"):
  observed=inspect_runtime(result[label]["runtimeReadyFile"],manifest)
  require(observed==result[label],"Preparation runtime binding differs")
  require(value(result[label]["runtimeReadyFile"])["basePython"]==result["request"]["inputs"]["python"],"Preparation interpreter selection differs")
 inspect_portable(result["portable"]["path"],manifest,result["portable"])
 require(value(Path(path).parent/"REQUEST.json")==result["request"],"Preparation original request differs")
 return result

def prepare(args,manifest,raw_manifest):
 directory=ordinary(args.directory,directory=True);python=canonical_python(args.python)
 source=ordinary(args.source or PRODUCT/"workbench",directory=True)
 require(not directory.is_relative_to(source) and not source.is_relative_to(directory),"Keep the original source separate from its owned preparation directory")
 require(sys.version_info>=(3,11),"Use Python 3.11 or later for this maintained preparation helper")
 require(Path(sys.executable).resolve()==Path(python["path"]),"Invoke preparation.py with its explicitly selected --python")
 router=ordinary(args.router) if args.router else None;wheel=ordinary(args.wheel) if args.wheel else None
 inputs={"directory":str(directory),"sourceDirectory":str(source),"sourceManifestSha256":MANIFEST_SHA256,"python":python,**host(),
  "routerPath":str(router) if router else None,"wheelPath":str(wheel) if wheel else None}
 with lease(directory):
  result_path=directory/"PREPARED.json";candidate=directory/"PREPARED.candidate.json"
  if candidate.exists() or result_path.exists():
   result=value(candidate if candidate.exists() else result_path)
   require(result["request"]["inputs"]==inputs,"Original preparation request differs")
   inspect_preparation(result_path,manifest,result)
   if not result_path.exists():publish_json(result_path,result)
   return result
  source_check(source,manifest)
  request={"schema":"stellar-forge.hive-prepare-request.v1","inputs":inputs,
   "router":identity(router) if router else {"download":ROUTERS[host()["architecture"]]},
   "wheel":wheel_info(wheel) if wheel else {"download":"PyYAML==6.0.3"}}
  publish_json(directory/"REQUEST.json",request)
  primary=install_runtime(directory/"primary",source,manifest,raw_manifest,python,router,wheel)
  portable=export_runtime(primary,directory/"Hive_Runtime_Complete.tar.gz",manifest)
  received=receive(portable["path"],portable["sha256"],directory/"receiving",python,manifest,raw_manifest)
  receiving={k:received[k] for k in ("applicationDirectory","runtimeReadyFile","python","router")}
  result={"schema":PREPARED_SCHEMA,"state":"READY","request":request,"primary":primary,"receiving":receiving,"portable":portable,"source":source_check(primary["applicationDirectory"],manifest),"resultPath":str(result_path)}
  publish_json(candidate,result);inspect_preparation(result_path,manifest,result);publish_json(result_path,result);return result

def main():
 parser=argparse.ArgumentParser(description=__doc__);sub=parser.add_subparsers(dest="action",required=True)
 p=sub.add_parser("prepare");p.add_argument("--directory",required=True);p.add_argument("--python",required=True);p.add_argument("--source");p.add_argument("--router");p.add_argument("--wheel")
 p=sub.add_parser("inspect");p.add_argument("--result",required=True)
 p=sub.add_parser("export");p.add_argument("--directory",required=True);p.add_argument("--out",required=True)
 p=sub.add_parser("receive");p.add_argument("--archive",required=True);p.add_argument("--archive-sha256",required=True);p.add_argument("--directory",required=True);p.add_argument("--python",required=True)
 args=parser.parse_args();raw_manifest,manifest=source_manifest();host()
 if args.action=="prepare":result=prepare(args,manifest,raw_manifest)
 elif args.action=="inspect":
  with lease(Path(args.result).absolute().parent):
   result=value(Path(args.result).absolute())
   result=inspect_received(Path(args.result).absolute(),manifest,result) if result.get("schema")==RECEIVED_SCHEMA else inspect_preparation(Path(args.result).absolute(),manifest,result)
 elif args.action=="export":
  with lease(Path(args.directory).absolute()):
   prepared=inspect_preparation(Path(args.directory).absolute()/"PREPARED.json",manifest)
   result={"schema":PORTABLE_SCHEMA,"state":"READY","portable":export_runtime(prepared["primary"],Path(args.out).absolute(),manifest),"source":prepared["source"]}
 else:
  python=canonical_python(args.python)
  require(Path(sys.executable).resolve()==Path(python["path"]),"Invoke receiving with the selected --python")
  result=receive(args.archive,args.archive_sha256,Path(args.directory).absolute(),python,manifest,raw_manifest)
 print(json.dumps(result,sort_keys=True),flush=True)

def interrupted(signum,_frame):
 global CANCELLED
 CANCELLED=signum

if __name__=="__main__":
 signal.signal(signal.SIGTERM,interrupted);signal.signal(signal.SIGINT,interrupted)
 try:main()
 except BaseException as error:
  print(json.dumps({"schema":"stellar-forge.hive-preparation-error.v1","error":type(error).__name__,"message":str(error)}),file=sys.stderr,flush=True)
  raise SystemExit(1)
