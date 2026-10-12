#!/usr/bin/env python3
"""Receive the retained public SDK/S3 archives for one original runtime install."""
from __future__ import annotations
import copy, fcntl, hashlib, io, json, os, pathlib, stat, subprocess, sys, tarfile, uuid
from types import SimpleNamespace
import node_lockfile_cache as lock_cache
import node_package_cache as package_cache

PARTS = [
 ("public-runtime-locks.part001",8388608,"f5d56bfb9b8ae17d1e45f4a1c0591b34a59fb54866ead8ac3d491ac0b1d52de9",0),
 ("public-runtime-locks.part002",8388608,"1516a1a4459be2c7e5c502625e81e2eac47ddfa1cdc869afe57c28e90380541b",8388608),
 ("public-runtime-locks.part003",8388608,"515bca32016a5a28bb2c840ba0bdc306c449304214b64cb4ba919f6edb1430a7",16777216),
 ("public-runtime-locks.part004",946176,"7aad301ae1366836d9b8678fdc763528fca48219cb52761863fcb7e937c41c3a",25165824)]
ARCHIVE_SHA="690f23028fd03833444435295e0944c043475a9471f3902d3e169a0560d5394f"
MANIFEST_SHA="7ba629c65276c16d7781e0374cbebb7fc553cf511f35486f16c995d1f8487897"
SDK_LOCK_SHA="b05e75e53d9695154d57ca50e1e943cd6a41db824f12bd97ad30b54e51f6ff98"
AWS_LOCK_SHA="d84b531c51d1e8e85aeb93abfeeb45626a00aa2f1d26c3c8392ceaa4a9907ff3"

def need(value,message):
 if not value: raise ValueError(message)
def sha(value): return hashlib.sha256(value).hexdigest()
def encoded(value): return (json.dumps(value,indent=2,ensure_ascii=False)+"\n").encode()
def read(path,maximum=16*1024*1024):
 fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW)
 try:
  before=os.fstat(fd);need(stat.S_ISREG(before.st_mode) and before.st_size<=maximum,"Use a complete ordinary input file.")
  with os.fdopen(fd,"rb",closefd=False) as h: body=h.read(maximum+1)
  after=os.fstat(fd)
  need(len(body)==before.st_size and (before.st_ino,before.st_size,before.st_mtime_ns)==(after.st_ino,after.st_size,after.st_mtime_ns),"Input changed during read.")
  return body
 finally: os.close(fd)
def checked(path,expected,maximum=16*1024*1024):
 body=read(path,maximum);need(sha(body)==expected,"The retained input hash changed: "+path.name);return body
def save_new(path,body):
 if path.exists():
  need(read(path,max(len(body),1))==body,"The original receiving file changed: "+path.name);return
 temporary=path.with_name("."+path.name+"."+uuid.uuid4().hex)
 fd=os.open(temporary,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
 try:
  with os.fdopen(fd,"wb",closefd=False) as h:h.write(body);h.flush();os.fsync(fd)
  try:os.link(temporary,path,follow_symlinks=False)
  except FileExistsError:need(read(path,max(len(body),1))==body,"Concurrent receiving file differs.")
  d=os.open(path.parent,os.O_RDONLY)
  try:os.fsync(d)
  finally:os.close(d)
 finally:os.close(fd);temporary.unlink(missing_ok=True)
def integrity_tokens(value):
 original,algorithm,digest=package_cache.integrity(value)
 return [(algorithm,digest)]
def verify_integrity(body,value):
 tokens=integrity_tokens(value)
 strongest=max(tokens,key=lambda row:hashlib.new(row[0]).digest_size)[0]
 need(any(algorithm==strongest and hashlib.new(algorithm,body).digest()==expected for algorithm,expected in tokens),
      "The original package archive does not match its lock integrity.")
def directory(value,create=False):
 p=pathlib.Path(value)
 need(p.is_absolute(),"Use an absolute original input path.")
 if create:p.mkdir(mode=0o700,parents=True,exist_ok=True)
 need(p.resolve(strict=True)==p and p.is_dir(),"Use a canonical ordinary directory.")
 return p

class Parts(io.RawIOBase):
 def __init__(self,paths):self.paths=iter(paths);self.current=None
 def readable(self):return True
 def readinto(self,target):
  view=memoryview(target);total=0
  while total<len(view):
   if self.current is None:
    try:self.current=open(next(self.paths),"rb")
    except StopIteration:break
   count=self.current.readinto(view[total:])
   if count:total+=count
   else:self.current.close();self.current=None
  return total
 def close(self):
  if self.current:self.current.close()
  super().close()

def receive(config):
 need(config["schema"]=="stellar-forge.s3-original-offline-input.v1","Original offline input schema is required.")
 base=directory(config["publicTransferDirectory"])
 parts=directory(str(base/"runtime-parts"))
 destination=directory(config["directory"],True)
 cache=directory(str(destination/"npm-cache"),True)
 lockfd=os.open(destination/"receiving.lock",os.O_CREAT|os.O_RDWR|os.O_NOFOLLOW,0o600)
 fcntl.flock(lockfd,fcntl.LOCK_EX|fcntl.LOCK_NB)
 try:
  save_new(destination/"original-input.json",encoded(config))
  manifest_raw=checked(base/"DEPENDENCIES-MANIFEST.json",MANIFEST_SHA)
  manifest=json.loads(manifest_raw)
  transfer=json.loads(read(parts/"TRANSFER-MANIFEST.json"))
  need(manifest["schema"]=="commons.public-npm-transfer.v1" and not manifest.get("errors"),"Use the complete original public archive manifest.")
  need(transfer["schema"]=="commons.public-runtime-parts.v1" and transfer["archive"]["sha256"]==ARCHIVE_SHA and
       transfer["archive"]["bytes"]==26112000 and transfer["archive"]["format"]=="tar","Original public carrier differs.")
  need([(x["file"],x["bytes"],x["sha256"],x["offset"]) for x in transfer["parts"]]==PARTS,"Original public carrier parts differ.")
  total_hash=hashlib.sha256()
  for name,size,expected,offset in PARTS:
   local=hashlib.sha256();count=0
   with open(parts/name,"rb") as h:
    for block in iter(lambda:h.read(131072),b""):local.update(block);total_hash.update(block);count+=len(block)
   need(count==size and local.hexdigest()==expected,"Original public carrier part changed: "+name)
  need(total_hash.hexdigest()==ARCHIVE_SHA,"Original combined public carrier changed.")
  sdk_raw=checked(base/"dependency-locks/sdk-package-lock.json",SDK_LOCK_SHA)
  aws_path=pathlib.Path(config["awsLock"])
  aws_raw=checked(aws_path,AWS_LOCK_SHA)
  sdk,aws=json.loads(sdk_raw),json.loads(aws_raw)
  package_raw=read(pathlib.Path(config["packageJson"]))
  package=json.loads(package_raw)
  need(package["name"]=="@tokenjunkielabs/starforge-runtime" and package["version"]=="0.0.0","Use the original prepared runtime package.")
  expected_dependencies={**sdk["packages"][""].get("dependencies",{}),**aws["packages"][""].get("dependencies",{})}
  need(set(expected_dependencies)==set(package["dependencies"]),"The selected runtime roots differ from the original SDK and S3 profiles.")
  records={}
  for label,original in [("sdk",sdk),("s3",aws)]:
   need(original["lockfileVersion"] in (2,3),"Use original npm v2/v3 lock records.")
   for key,row in original["packages"].items():
    if not key:continue
    need(key.startswith("node_modules/") and ".." not in key.split("/") and not row.get("link"),"Original package location is not portable.")
    if key in records:need(records[key]==row,"Original profiles contain different package records at "+key)
    else:records[key]=copy.deepcopy(row)
  for name,version in package["dependencies"].items():
   need(records.get("node_modules/"+name,{}).get("version")==version,"The selected exact runtime version differs from its original locked package: "+name)
  root={key:copy.deepcopy(package[key]) for key in ("name","version","dependencies","engines") if key in package}
  locked={"name":package["name"],"version":package["version"],"lockfileVersion":3,"requires":True,
          "packages":{"":root,**records}}
  lock_path=destination/"package-lock.json"
  if (destination/"result.json").exists():
   previous=json.loads(read(destination/"result.json"))
   need(previous["operationId"]==config["operationId"] and previous["packageJsonSha256"]==sha(package_raw)
        and previous["lockSha256"]==sha(encoded(locked)),"The retained receiving operation or selected profile changed.")
   need(read(lock_path)==encoded(locked),"The retained complete original lock changed.")
   plan=lock_cache.build_plan(SimpleNamespace(lockfile=str(lock_path),cache_root=[str(cache/"_cacache"),str(pathlib.Path(config["awsCache"])/"_cacache")],
        omit=["dev"],target_os="linux",target_cpu="x64",target_libc="glibc"))
   need(plan["outcome"]=="planned","A retained archive needed by this original install is unavailable.")
   print(json.dumps(previous,separators=(",",":")));return previous
  profile=next(row for row in manifest["profiles"] if row["name"]=="sdk")
  needed_artifacts={row["artifactId"] for row in profile["packages"]}
  artifacts={row["id"]:row for row in manifest["artifacts"]}
  need(needed_artifacts<=set(artifacts),"Original SDK profile omits an archive descriptor.")
  expected_members={"DEPENDENCIES-MANIFEST.json":{"sha256":MANIFEST_SHA,"bytes":len(manifest_raw)}}
  for item in manifest["profiles"]:
   for file in item["files"]:
    if file["file"] in expected_members:need(expected_members[file["file"]]==file,"Conflicting original member descriptor.")
    expected_members[file["file"]]=file
  for item in artifacts.values():expected_members[item["file"]]=item
  need(set(transfer["members"])==set(expected_members),"Original carrier member list differs.")
  sources=[];seen=set();temporary_directory=directory(str(destination/"original-tarballs"),True)
  with Parts([parts/name for name,_,_,_ in PARTS]) as stream:
   with tarfile.open(fileobj=stream,mode="r|") as archive:
    for member in archive:
     need(member.isfile() and member.name in expected_members and member.name not in seen,"Unexpected public carrier member.")
     expected=expected_members[member.name];need(member.size==expected["bytes"],"Original carrier member length changed.")
     body=archive.extractfile(member).read()
     need(sha(body)==expected["sha256"],"Original carrier member hash changed.")
     seen.add(member.name)
     if expected.get("id") in needed_artifacts:
      verify_integrity(body,expected["integrity"])
      target=temporary_directory/(expected["id"]+".tgz");save_new(target,body)
      sources.append({"path":str(target),"owned":True,"sha256":sha(body),"bytes":len(body),"integrity":expected["integrity"]})
  need(seen==set(expected_members),"Original carrier was incomplete.")
  aws_cache=directory(config["awsCache"])
  aws_archives=set()
  for key,row in aws["packages"].items():
   if not key:continue
   need(not row.get("inBundle") and row.get("integrity"),"Use the original complete S3 public lock.")
   tokens=integrity_tokens(row["integrity"]);algorithm,digest=max(tokens,key=lambda x:hashlib.new(x[0]).digest_size)
   hexadecimal=digest.hex();source=aws_cache/"_cacache/content-v2"/algorithm/hexadecimal[:2]/hexadecimal[2:4]/hexadecimal[4:]
   if source in aws_archives:continue
   body=read(source,32*1024*1024);verify_integrity(body,row["integrity"]);aws_archives.add(source)
   sources.append({"path":str(source),"owned":False,"sha256":sha(body),"bytes":len(body),"integrity":row["integrity"]})
  cache_inputs=destination/"verified-original-archives.json";save_new(cache_inputs,encoded(sources))
  command=[config.get("npm","npm"),"cache","add",*[row["path"] for row in sources],
           "--cache",str(cache),"--offline","--ignore-scripts","--no-audit","--no-fund"]
  with open(destination/"npm-cache.log","ab",buffering=0) as log:
   done=subprocess.run(command,stdin=subprocess.DEVNULL,stdout=log,stderr=subprocess.STDOUT,
        env={**os.environ,"npm_config_update_notifier":"false","npm_config_fund":"false"},check=False)
  need(done.returncode==0,"Original npm cache ingestion failed; read the retained npm-cache.log.")
  save_new(lock_path,encoded(locked))
  plan=lock_cache.build_plan(SimpleNamespace(lockfile=str(lock_path),cache_root=[str(cache/"_cacache"),str(aws_cache/"_cacache")],
       omit=["dev"],target_os="linux",target_cpu="x64",target_libc="glibc"))
  need(plan["outcome"]=="planned","The maintained original lock-cache planner did not resolve the complete selected graph.")
  result={"schema":"stellar-forge.s3-original-offline-result.v1","operationId":config["operationId"],
          "publicArchiveSha256":ARCHIVE_SHA,"publicManifestSha256":MANIFEST_SHA,
          "sdkLockSha256":SDK_LOCK_SHA,"s3LockSha256":AWS_LOCK_SHA,
          "packageJsonSha256":sha(package_raw),"lockPath":str(destination/"package-lock.json"),
          "lockSha256":sha(encoded(locked)),"cache":str(cache),"packageLocations":len(records),
          "archives":len(sources),"archiveBytes":sum(row["bytes"] for row in sources),"npmCacheExitCode":0,
          "originalCachePlan":{"schema":plan["schema"],"lockSha256":plan["lockfile"]["sha256"],"counts":plan["counts"],"target":plan["target"],"installScripts":plan["install_scripts"],
          "sourceBlobs":{"node_lockfile_cache.py":"661566492bb0ae8e44b40b349187c3036b23451e","node_package_cache.py":"20b224d96f453de5b7de71c2cb386a3871005a9e"}}}
  save_new(destination/"result.json",encoded(result))
  for row in sources:
   if row["owned"]:
    target=pathlib.Path(row["path"])
    need(sha(read(target,32*1024*1024))==row["sha256"],"Owned temporary archive changed before retirement.")
    target.unlink()
  print(json.dumps(result,separators=(",",":")));return result
 finally:os.close(lockfd)

if __name__=="__main__":
 try:receive(json.loads(read(pathlib.Path(sys.argv[1]))))
 except Exception as error:
  print(json.dumps({"state":"FAILED","type":type(error).__name__,"message":str(error)}),file=sys.stderr)
  raise
