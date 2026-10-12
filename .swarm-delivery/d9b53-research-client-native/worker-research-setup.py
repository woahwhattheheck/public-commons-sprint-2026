"""Prepare one original Research operation on the existing native worker."""
import base64,hashlib,io,json,os,shutil,stat,subprocess,sys,urllib.parse,urllib.request,uuid,zipfile
from pathlib import Path,PurePosixPath
def need(ok,message):
    if not ok: raise RuntimeError(message)
def digest(data): return hashlib.sha256(data).hexdigest()
def ordinary(path):
    st=path.lstat()
    need(stat.S_ISREG(st.st_mode), "Selected input is not an ordinary file: "+str(path))
    return path.read_bytes()
def directory(path):
    path=Path(path)
    need(path.is_absolute(), "Use an absolute private directory.")
    current=Path(path.anchor)
    for part in path.parts[1:]:
        current=current/part
        try: current.mkdir(mode=0o700)
        except FileExistsError: pass
        need(stat.S_ISDIR(current.lstat().st_mode), "Private directory component is not an ordinary directory.")
    return path
def retain(path,data):
    directory(path.parent)
    try:
        need(ordinary(path)==data,"An existing selected file has different bytes: "+str(path))
        return
    except FileNotFoundError: pass
    temporary=path.parent/(".receiving-"+uuid.uuid4().hex)
    fd=os.open(temporary,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
    try:
        with os.fdopen(fd,"wb") as stream:
            stream.write(data);stream.flush();os.fsync(stream.fileno())
        try: os.link(temporary,path,follow_symlinks=False)
        except FileExistsError: need(ordinary(path)==data,"A concurrent selected file differs.")
    finally: temporary.unlink(missing_ok=True)
def json_bytes(value):return (json.dumps(value,sort_keys=True,ensure_ascii=False,indent=2)+"\n").encode("utf-8")
def relative(value):
    path=PurePosixPath(value)
    need(isinstance(value,str) and value and not path.is_absolute() and all(p not in (".","..","") for p in path.parts),"Unsafe source member.")
    need(str(path)==value and "\\" not in value,"Non-canonical source member.")
    return path
def archive(identity,url,destination):
    try: data=ordinary(destination)
    except FileNotFoundError:
        parsed=urllib.parse.urlsplit(url)
        need(parsed.scheme=="https" and parsed.netloc and not parsed.username and not parsed.password and not parsed.fragment,"Use the current original HTTPS download URL.")
        request=urllib.request.Request(url,headers={"User-Agent":"Commons-Research-Original-Receiver/1"})
        with urllib.request.urlopen(request,timeout=25) as response:
            need(urllib.parse.urlsplit(response.geturl()).scheme=="https","Source download redirected outside HTTPS.")
            data=response.read(identity["bytes"]+1)
        need(len(data)==identity["bytes"] and digest(data)==identity["sha256"],"Original private carrier identity differs.")
        retain(destination,data)
    need(len(data)==identity["bytes"] and digest(data)==identity["sha256"],"Retained private carrier identity differs.")
    return data
need(len(sys.argv)==4,"Use setup.py PRIVATE_ROOT CONFIG_BASE64 DOWNLOAD_URLS_BASE64.")
root=directory(Path(sys.argv[1]))
need(str(root)==os.path.realpath(root),"Use the selected private root without aliases.")
config=json.loads(base64.b64decode(sys.argv[2],validate=True))
urls=json.loads(base64.b64decode(sys.argv[3],validate=True))
need(config["schema"]=="sf88.research-client.native-worker-input.v1","Use the original Research worker input.")
need(config["directory"]==str(root) and config["sourceMerge"]==config["source"]["sourceMerge"],"Native directory/source binding differs.")
operation=config["operationId"]
need(isinstance(operation,str) and 0<len(operation)<=160 and all(c.isascii() and (c.isalnum() or c in "._-") for c in operation),"Keep one original operation identifier.")
inbox=directory(root/"inbox");source_root=directory(root/"project")
source_bytes=ordinary(inbox/"source-envelope.json")
need(len(source_bytes)==config["source"]["bytes"] and digest(source_bytes)==config["source"]["sha256"],"Whole original source carrier differs.")
envelope=json.loads(source_bytes)
need(envelope["schema"]=="sf88.research-client.native-source.v1" and envelope["sourceMerge"]==config["sourceMerge"],"Source manifest identity differs.")
need(envelope["repository"]==config["source"]["repository"],"Source repository differs.")
seen=set();source_total=0
for row in envelope["files"]:
    name=str(relative(row["path"]))
    need(name not in seen,"Duplicate source file.");seen.add(name)
    data=row["content"].encode("utf-8")
    need(len(data)==row["bytes"],"Original source byte count differs.")
    blob=hashlib.sha1(b"blob "+str(len(data)).encode()+b"\0"+data).hexdigest()
    need(blob==row["gitBlobSha"],"Original Git source blob differs: "+name)
    retain(source_root/name,data);source_total+=len(data)
need(len(seen)==config["source"]["files"],"Complete source closure is required.")
helper=ordinary(inbox/"receive-original-crossref-operation.mjs")
need(len(helper)==config["receivingHelper"]["bytes"] and digest(helper)==config["receivingHelper"]["sha256"],"Original receiving helper differs.")
shared=Path(config["sharedControl"])
need(shared.is_absolute() and shared.is_dir() and str(shared)==os.path.realpath(shared),"Use the existing shared control directory.")
controller_source=Path(config["controllerSource"])
need(controller_source.is_absolute() and controller_source.is_dir() and str(controller_source)==os.path.realpath(controller_source),"Use the existing controller source.")
host=directory(root/"controller/host");controller_files=[]
for parent,dirs,files in os.walk(controller_source,followlinks=False):
    parent=Path(parent)
    dirs[:]=sorted(d for d in dirs if d!="__pycache__")
    for child in dirs:need(stat.S_ISDIR((parent/child).lstat().st_mode),"Controller source has a directory alias.")
    for name in sorted(files):
        if name.endswith((".pyc",".pyo")):continue
        original=parent/name;data=ordinary(original)
        need(len(data)<=2*1024*1024,"Unexpected controller source size.")
        member=str(original.relative_to(controller_source))
        retain(host/member,data);controller_files.append({"path":member,"bytes":len(data),"sha256":digest(data)})
need((host/"native_foreground.py").is_file(),"Existing native ForegroundLaunch is absent.")
for name in ("capacity/memory","capacity/disk"):
    need(stat.S_ISDIR((shared/name).lstat().st_mode),"The original shared capacity registry is absent.")
for name in ("records","worker","tmp","workspace","source-state","project/results","private-inputs"):
    directory(root/name)
node=shutil.which("node")
need(node is not None,"Use the worker's existing Node runtime.")
version=subprocess.check_output([node,"--version"],text=True,timeout=10).strip()
need(version.startswith("v") and version[1:].split(".")[0].isdigit() and int(version[1:].split(".")[0])>=22,
     "The received source requires Node 22 or newer; use the worker's existing compatible runtime.")
master=archive(config["masterArchive"],urls.get("master",""),root/"private-inputs/master.zip")
companion=archive(config["companionArchive"],urls.get("companion",""),root/"private-inputs/original-crossref.zip")
def members(raw):
    z=zipfile.ZipFile(io.BytesIO(raw));names=set()
    for entry in z.infolist():
        name=str(relative(entry.filename.rstrip("/")))
        need(name not in names,"Duplicate private carrier member.");names.add(name)
        mode=entry.external_attr>>16
        need(not stat.S_ISLNK(mode) and not entry.flag_bits&1,"Unexpected private carrier entry.")
        need(entry.file_size<=128*1024*1024,"Unexpected private carrier member size.")
    return z
with members(master) as z:
    portable=z.read(config["portable"]["member"])
need(len(portable)==config["portable"]["bytes"],"Original portable byte count differs.")
portable_path=root/"private-inputs/current-master.research.json.gz"
retain(portable_path,portable)
with members(companion) as z:
    for entry in z.infolist():
        name=entry.filename
        if entry.is_dir():continue
        if name=="reviewed-edition.json" or name.startswith(("operations/","source-captures/")):
            retain(root/"private-inputs/original-crossref"/str(relative(name)),z.read(entry))
selected=dict(config)
selected["portable"]={**config["portable"],"sha256":digest(portable),"path":str(portable_path)}
selected["node"]=node
retain(root/"case-input.json",json_bytes(selected))
receipt={"schema":"sf88.research-client.native-worker-setup.v1","operationId":operation,
 "sourceMerge":config["sourceMerge"],"directory":str(root),"sourceFiles":len(seen),"sourceBytes":source_total,
 "sourceSha256":digest(source_bytes),"controllerSource":str(controller_source),"controllerFiles":controller_files,
 "sharedControl":str(shared),"node":node,"nodeVersion":version,
 "masterArchive":{"bytes":len(master),"sha256":digest(master)},
 "companionArchive":{"bytes":len(companion),"sha256":digest(companion)},
 "portable":{"bytes":len(portable),"sha256":digest(portable)}}
retain(root/"setup-result.json",json_bytes(receipt))
print(json.dumps({"ok":True,"operationId":operation,"directory":str(root),"sourceFiles":len(seen),
 "sourceMerge":config["sourceMerge"],"nodeVersion":version,"portable":receipt["portable"]}),flush=True)
