import sys, os, json, hashlib, stat, fcntl, tty, termios, traceback
from pathlib import Path
cfg=json.loads(sys.argv[1])
root=Path(cfg["root"]); old=Path(cfg["old_root"])
expected={p:v[1] for p,v in cfg["files"].items() if v[1]}
old_expected={p:v[0] for p,v in cfg["files"].items() if v[0]}
original_term=termios.tcgetattr(sys.stdin.fileno())
tty.setraw(sys.stdin.fileno())
def report(value):
 sys.stdout.write(json.dumps(value,separators=(",",":"))+"\r\n");sys.stdout.flush()
def digest(data):
 return hashlib.sha1(b"blob "+str(len(data)).encode()+bytes([0])+data).hexdigest()
def checked_file(path):
 s=path.lstat()
 if not stat.S_ISREG(s.st_mode) or s.st_nlink!=1: raise RuntimeError("UNEXPECTED_FILE_KIND "+str(path))
 return s,path.read_bytes()
def ensure_parents(path):
 chain=[]; cursor=path
 while not cursor.exists(): chain.append(cursor);cursor=cursor.parent
 if cursor.is_symlink() or not cursor.is_dir():raise RuntimeError("UNEXPECTED_PARENT "+str(cursor))
 for p in reversed(chain):p.mkdir(mode=0o700)
def inspect(where):
 rows=[]; conflicts=[]
 if not where.exists():return rows,conflicts
 if where.is_symlink() or not where.is_dir():raise RuntimeError("UNEXPECTED_ROOT")
 for directory,dirs,files in os.walk(where,followlinks=False):
  for n in dirs:
   if (Path(directory)/n).is_symlink(): conflicts.append({"path":str(Path(directory)/n),"reason":"symlink_directory"})
  for name in files:
   path=Path(directory)/name; rel=path.relative_to(where).as_posix()
   try:
    s,data=checked_file(path); sha=digest(data)
    if rel=="git-source-inputs.json":
     value=json.loads(data); pins={p:v["gitBlob"] for p,v in value["files"].items()}
     if value["repository"]!=cfg["repository"] or not ((value["commit"]==cfg["commit"] and pins==expected) or (value["commit"]==cfg["old_commit"] and pins==old_expected)):raise RuntimeError("unexpected_manifest")
    elif rel not in expected or sha not in cfg["files"][rel]:raise RuntimeError("unexpected_source")
    rows.append({"path":rel,"gitBlob":sha,"bytes":len(data)})
   except Exception as e: conflicts.append({"path":rel,"reason":str(e)})
 return rows,conflicts
def publish(path,data,allowed):
 ensure_parents(path.parent)
 before=None
 if path.exists() or path.is_symlink():
  s,prior=checked_file(path)
  if prior==data:return False
  if digest(prior) not in allowed:raise RuntimeError("CHANGED_DESTINATION "+str(path))
  before=(s.st_dev,s.st_ino,s.st_size,s.st_mtime_ns)
 temp=path.parent/("."+path.name+".source-receive-"+str(os.getpid()))
 try:
  with open(temp,"xb") as f:
   os.chmod(temp,0o600);f.write(data);f.flush();os.fsync(f.fileno())
  if before:
   current=path.lstat()
   if (current.st_dev,current.st_ino,current.st_size,current.st_mtime_ns)!=before:raise RuntimeError("DESTINATION_CHANGED_DURING_RECEIVE "+str(path))
   os.replace(temp,path)
  else:
   os.link(temp,path);temp.unlink()
 finally:
  if temp.exists():temp.unlink()
 return True
def receive(row):
 name=row["path"]
 if name not in expected:raise RuntimeError("UNSELECTED_SOURCE "+name)
 data=row["content"].encode("utf-8")
 if digest(data)!=expected[name]:raise RuntimeError("SOURCE_BYTE_MISMATCH "+name)
 changed=publish(root/name,data,set(v for v in cfg["files"][name] if v))
 return changed,len(data)
lock=None
try:
 ensure_parents(root.parent)
 lock=open(root.parent/"geocat-d22-source-inputs.receive-lock","a+b");fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
 if old.exists() and root.exists():raise RuntimeError("BOTH_SOURCE_ROOTS_EXIST")
 current=root if root.exists() else old
 rows,conflicts=inspect(current)
 if conflicts:
  report({"status":"RECONCILE_REQUIRED","root":str(current),"existing":len(rows),"conflicts":conflicts});raise SystemExit(3)
 if old.exists():old.rename(root)
 elif not root.exists():root.mkdir(mode=0o700)
 space=os.statvfs(root)
 report({"status":"READY","root":str(root),"reconciled":len(rows),"reconciledBytes":sum(x["bytes"] for x in rows),"physicalFree":space.f_bfree*space.f_frsize,"selected":len(expected)})
 for line in sys.stdin:
  if not line.strip():continue
  request=json.loads(line);operation=request.get("op")
  if operation=="source":
   changed=0;count=0;total=0
   for row in request["files"]:
    c,n=receive(row);changed+=bool(c);count+=1;total+=n
   report({"status":"SOURCE_RECEIVED","count":count,"written":changed,"bytes":total})
  elif operation=="artifact":
   path=request["path"]
   if path not in cfg["artifacts"]:raise RuntimeError("UNSELECTED_ARTIFACT")
   data=request["content"].encode("utf-8")
   changed=publish(Path(path),data,set())
   report({"status":"ARTIFACT_RECEIVED","path":path,"written":changed,"bytes":len(data),"sha256":hashlib.sha256(data).hexdigest()})
  elif operation=="finish":
   total=0;missing=[]
   for p,pin in expected.items():
    try:
     _,data=checked_file(root/p)
     if digest(data)!=pin:raise RuntimeError("pin")
     total+=len(data)
    except Exception as e:missing.append({"path":p,"reason":str(e)})
   if missing:raise RuntimeError("INCOMPLETE_SOURCE "+json.dumps(missing))
   manifest={"repository":cfg["repository"],"commit":cfg["commit"],"merged":cfg["merged"],"files":{p:{"gitBlob":sha} for p,sha in expected.items()}}
   data=(json.dumps(manifest,indent=2)+"\n").encode()
   path=root/"git-source-inputs.json"
   allowed=set()
   if path.exists():
    _,prior=checked_file(path);value=json.loads(prior)
    pins={p:v["gitBlob"] for p,v in value["files"].items()}
    if value["repository"]==cfg["repository"] and ((value["commit"]==cfg["old_commit"] and pins==old_expected) or (value["commit"]==cfg["commit"] and pins==expected)):allowed.add(digest(prior))
   publish(path,data,allowed)
   report({"status":"INPUTS_COMPLETE","root":str(root),"files":len(expected),"bytes":total,"commit":cfg["commit"],"manifestSha256":hashlib.sha256(data).hexdigest()})
   break
  else:raise RuntimeError("UNKNOWN_RECEIVE_OPERATION")
except Exception as e:
 report({"status":"FAILED","error":str(e)});raise
finally:
 if lock:lock.close()
 termios.tcsetattr(sys.stdin.fileno(),termios.TCSANOW,original_term)
