import os,sys,json,subprocess,tempfile,hashlib,tarfile,gzip,datetime,time,urllib.request,shutil
from pathlib import Path

REPOSITORY="https://github.com/woahwhattheheck/tjlabs-stellar-merchant-workspace.git"
SOURCE="f4a19e42f3313fefbd63e7a5bf5067d97c091c36"
TREE="c2f415d19b7be349ddeff05822c2f5d82a50981a"
TRANSFER="open311-installed-follow-through-f4a19e42-20261012-01"
ROOT=Path(tempfile.mkdtemp(prefix="open311-installed-git-8e5f-",dir=os.environ.get("OPEN311_SOURCE_PARENT","/dev")))
REPO=ROOT/"repository.git"
LOG=ROOT/"fetch.log"
ARCHIVE=ROOT/"open311-installed-follow-through-f4a19e42.tar.gz"
ENV={**os.environ,"GIT_TERMINAL_PROMPT":"0","GIT_CONFIG_NOSYSTEM":"1"}
def emit(value):
 print(json.dumps(value,separators=(",",":")),flush=True)
def git(*args,timeout=180):
 p=subprocess.run(["git","-c","pack.threads=1","-c","pack.windowMemory=8m","-c","core.compression=1","-c","gc.auto=0",*args],capture_output=True,env=ENV,timeout=timeout)
 if p.returncode:raise RuntimeError("git failed: "+p.stderr.decode("utf-8","replace")[-3000:])
 return p.stdout
def sha(path):
 h=hashlib.sha256()
 with open(path,"rb") as f:
  for chunk in iter(lambda:f.read(1024*1024),b""):h.update(chunk)
 return h.hexdigest()
try:
 emit({"state":"FETCHING","transferId":TRANSFER,"sourceCommit":SOURCE,"directory":str(ROOT)})
 git("init","--bare",str(REPO),timeout=20)
 git("--git-dir",str(REPO),"fetch","--depth=1","--no-tags",REPOSITORY,SOURCE,timeout=240)
 got=git("--git-dir",str(REPO),"rev-parse","FETCH_HEAD").decode().strip()
 tree=git("--git-dir",str(REPO),"rev-parse",SOURCE+"^{tree}").decode().strip()
 if got!=SOURCE or tree!=TREE:raise RuntimeError("Pinned source identity mismatch")
 git("--git-dir",str(REPO),"update-ref","refs/heads/open311-installed-follow-through",SOURCE,timeout=20)
 git("--git-dir",str(REPO),"symbolic-ref","HEAD","refs/heads/open311-installed-follow-through",timeout=20)
 git("--git-dir",str(REPO),"fsck","--connectivity-only","--no-reflogs",timeout=90)
 entries=[]
 for record in git("--git-dir",str(REPO),"ls-tree","-r","-l","-z",SOURCE,timeout=30).split(b"\0"):
  if not record:continue
  head,path=record.split(b"\t",1);mode,typ,oid,size=head.decode("ascii").split()
  entries.append({"path":path.decode("utf-8"),"mode":mode,"type":typ,"gitBlob":oid,"bytes":int(size) if size!="-" else None})
 blobrows=[x for x in entries if x["type"]=="blob"]
 commit_raw=git("--git-dir",str(REPO),"cat-file","commit",SOURCE,timeout=20)
 if hashlib.sha1(b"commit "+str(len(commit_raw)).encode()+b"\0"+commit_raw).hexdigest()!=SOURCE:raise RuntimeError("Commit object mismatch")
 (ROOT/"commit-object.txt").write_bytes(commit_raw)
 metadata={"schema":"commons.open311.installed-source.v1","transferId":TRANSFER,"repository":REPOSITORY,"sourceCommit":SOURCE,"sourceTree":TREE,"selection":"open311-follow-through","sourceRoot":"repository.git","objectFormat":"sha1","shallow":True,"completeTree":True,"fileCount":len(blobrows),"sourceBytes":sum(x["bytes"] for x in blobrows),"entries":entries,"createdAt":datetime.datetime.now(datetime.timezone.utc).isoformat(),"gitVersion":git("--version",timeout=10).decode().strip()}
 (ROOT/"source.json").write_text(json.dumps(metadata,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
 readme="""# Complete installed municipal source\n\nThis archive carries the original complete Git commit and all files reachable from its tree.\n\nRepository: %s\nCommit: %s\nTree: %s\nSelection: open311-follow-through (municipal collections, service reporting, GIS analyst return and request/work-order follow-through).\n\nReceive into a new private directory. Check archive member paths before extraction. The repository.git directory is a complete shallow bare repository: its original commit parents remain in the original commit object, and its shallow boundary is explicit. No application file has been rewritten.\n\nFrom the extracted directory, on Linux with Git, Python and Node >=22.16:\n\n    git --git-dir repository.git rev-parse HEAD\n    git --git-dir repository.git fsck --connectivity-only --no-reflogs\n    git clone --no-hardlinks repository.git checkout\n    node checkout/stellar/scf-starforge-20261009/distribution/build.mjs --repo checkout --ref %s --selection open311-follow-through --out /NEW/PRIVATE/OUTPUT --offline\n\nUse a new private output path. The maintained builder selects and copies its complete source closure from this original Git commit. Continue the existing installed package/private-runtime/Applications operation with the resulting package and its maintained runtime-install and receiving guides. source.json lists the complete original tree, modes, byte lengths and Git object identities. commit-object.txt is the original commit object body.\n"""%(REPOSITORY,SOURCE,TREE,SOURCE)
 (ROOT/"README.md").write_text(readme,encoding="utf-8")
 with open(ARCHIVE,"xb") as raw:
  with gzip.GzipFile(filename="",mode="wb",fileobj=raw,compresslevel=1,mtime=0) as gz:
   with tarfile.open(fileobj=gz,mode="w|",format=tarfile.PAX_FORMAT) as tar:
    for name in ("repository.git","source.json","commit-object.txt","README.md"):tar.add(ROOT/name,arcname=name,recursive=True)
 digest=sha(ARCHIVE)
 ready={"state":"SOURCE_READY","transferId":TRANSFER,"filename":ARCHIVE.name,"archive":str(ARCHIVE),"bytes":ARCHIVE.stat().st_size,"sha256":digest,"sourceCommit":SOURCE,"sourceTree":TREE,"fileCount":len(blobrows),"sourceBytes":metadata["sourceBytes"],"directory":str(ROOT),"selection":"open311-follow-through"}
 (ROOT/"archive.json").write_text(json.dumps(ready,indent=2)+"\n")
 emit(ready)
 for line in sys.stdin:
  req=json.loads(line)
  if req.get("op")=="finish":
   emit({"state":"FINISHED","transferId":TRANSFER});break
  if req.get("op")!="upload":raise ValueError("Unsupported source transfer operation")
  if req.get("expectedSha256")!=digest:raise ValueError("Wrong expected archive digest")
  if sha(ARCHIVE)!=digest:raise ValueError("Source archive changed")
  size=ARCHIVE.stat().st_size
  with open(ARCHIVE,"rb") as data:
   request=urllib.request.Request(req["uploadUrl"],data=data,method="POST",headers={"Content-Type":"application/gzip","Content-Length":str(size)})
   with urllib.request.urlopen(request,timeout=180) as response:
    status=response.status;body=response.read(4096).decode("utf-8","replace")
  if not 200<=status<300:raise RuntimeError("Source upload returned "+str(status))
  emit({"state":"UPLOADED","transferId":TRANSFER,"fileId":req["fileId"],"bytes":size,"sha256":digest,"httpStatus":status,"providerBody":body})
except Exception as e:
 emit({"state":"ERROR","transferId":TRANSFER,"directory":str(ROOT),"error":str(e)})
 raise
