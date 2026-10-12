import base64,datetime,gc,hashlib,json,math,os,stat,subprocess,sys,tarfile,tempfile,termios,time,urllib.request,uuid
from pathlib import Path
if sys.stdin.isatty():
    mode=termios.tcgetattr(sys.stdin.fileno());mode[3]&=~(termios.ECHO|termios.ICANON);termios.tcsetattr(sys.stdin.fileno(),termios.TCSANOW,mode)
os.umask(0o077)
root=Path("/dev/research-original-d9b53-20261012")
root.mkdir(mode=0o700,exist_ok=False)
def emit(value):print(json.dumps(value,ensure_ascii=False),flush=True)
def sha(data):return hashlib.sha256(data).hexdigest()
def write(path,data):
    path=Path(path);path.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
    try:
        fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
    except FileExistsError:
        if not stat.S_ISREG(path.lstat().st_mode) or path.read_bytes()!=data:raise RuntimeError("Selected retained file differs: "+str(path))
        return
    with os.fdopen(fd,"wb") as out:out.write(data);out.flush();os.fsync(out.fileno())
def saved_json(path,value):write(path,(json.dumps(value,sort_keys=True,ensure_ascii=False,indent=2)+"\n").encode())
def file_sha(path):
    h=hashlib.sha256()
    with Path(path).open("rb") as stream:
        for part in iter(lambda:stream.read(1024*1024),b""):h.update(part)
    return h.hexdigest()
emit({"state":"awaiting-original-input","directory":str(root),"pid":os.getpid()})
payload=json.loads(sys.stdin.readline())
reserved_upload=payload.get("preparedUpload")
original_text=payload["lineage"];config=json.loads(original_text)
if config["operationId"]!="SCF-RESEARCH-CLIENT-NCC-D9B53-20261012":raise RuntimeError("Wrong original operation")
source=payload["sourceEnvelope"].encode()
selected_source=payload.get("sourceIdentity",config["source"])
if selected_source["repository"]!=config["source"]["repository"] or selected_source["sourceMerge"]!=config["sourceMerge"]:raise RuntimeError("Selected original source differs")
config["source"]=selected_source
if len(source)!=config["source"]["bytes"] or sha(source)!=config["source"]["sha256"]:raise RuntimeError("Source carrier changed")
write(root/"inbox/source-envelope.json",source)
write(root/"original-prepared-input.json",original_text.encode())
for file in payload["helpers"]:
    name=file["path"]
    if Path(name).name!=name:raise RuntimeError("Unsafe helper name")
    raw=file["source"].encode()
    if len(raw)!=file["bytes"] or sha(raw)!=file["sha256"]:raise RuntimeError("Original helper changed")
    write(root/"inbox"/name,raw)
keeper_source=root/"inbox/hosted-artifact-retention.py"
if (not keeper_source.is_file()
        or file_sha(keeper_source)!="ea73242334dd408f1399a5090f32b3a761ff66196d62f8c9d4b711511fc869d1"):
    raise RuntimeError("Select the complete pinned hosted artifact keeper before native work")
keeper_namespace={"__name__":"hosted_artifact_retention","__file__":str(keeper_source)}
exec(compile(keeper_source.read_bytes(),str(keeper_source),"exec"),keeper_namespace)
retain_artifact=keeper_namespace["retain_artifact"]
config.update(directory=str(root),sharedControl="/workspace/shared/swarm",controllerSource="/workspace/scratch/d9b53a575d9a/af-estate-recovery/host")
companion=Path("/dev/shm/crossref-workspace-d9b5/native/artifacts/ncc-crossref-workspace-operating-companion.zip").read_bytes()
if len(companion)!=config["companionArchive"]["bytes"] or sha(companion)!=config["companionArchive"]["sha256"]:raise RuntimeError("Original companion changed")
write(root/"private-inputs/original-crossref.zip",companion)
del companion
download_url=payload["masterUrl"]
request=urllib.request.Request(download_url,headers={"User-Agent":"Commons-Research-Original-Receiver/1"})
with urllib.request.urlopen(request,timeout=30) as response:master=response.read(config["masterArchive"]["bytes"]+1)
if len(master)!=config["masterArchive"]["bytes"] or sha(master)!=config["masterArchive"]["sha256"]:raise RuntimeError("Original master changed")
write(root/"private-inputs/master.zip",master)
del master,payload,source
gc.collect()
selection=base64.b64encode(json.dumps(config,ensure_ascii=False,separators=(",",":")).encode()).decode()
prepared=subprocess.run([sys.executable,"-B",str(root/"inbox/worker-research-setup.py"),str(root),selection,"e30="],capture_output=True,text=True)
write(root/"setup.stdout",prepared.stdout.encode());write(root/"setup.stderr",prepared.stderr.encode())
if prepared.returncode:
    emit({"state":"setup-attention","exitCode":prepared.returncode,"directory":str(root),"stderr":prepared.stderr[-4000:]})
else:
    setup=json.loads((root/"setup-result.json").read_text())
    emit({"state":"prepared","directory":str(root),"operationId":config["operationId"],"sourceFiles":setup["sourceFiles"],"sourceMerge":setup["sourceMerge"],"node":setup["node"],"nodeVersion":setup["nodeVersion"],"portable":setup["portable"],"lineageBytes":len(original_text.encode()),"lineageSha256":sha(original_text.encode())})
profile_source=r"""import {readFile} from 'node:fs/promises';
import {gunzipSync} from 'node:zlib';
import {pathToFileURL} from 'node:url';
import {join} from 'node:path';
const root=process.argv[2],config=JSON.parse(await readFile(join(root,'case-input.json'),'utf8'));
const base=join(root,'project/stellar/scf-starforge-20261009/sf88-operator-buyer-cli/research-dossiers');
const samples=[];
const sample=phase=>samples.push({phase,...process.memoryUsage(),maxRssKiB:process.resourceUsage().maxRSS});
sample('node-start');
await import(pathToFileURL(join(base,'workspace-client.mjs')));
await import(pathToFileURL(join(base,'server.mjs')));
await import(pathToFileURL(join(root,'project/stellar-forge/mcp-merchant-operator/research-workspace.mjs')));
await import(pathToFileURL(join(root,'project/stellar-forge/mcp-merchant-operator/catalog.mjs')));
sample('complete-original-runtime-imported');
const compressed=await readFile(config.portable.path),raw=gunzipSync(compressed);
sample('original-portable-decoded');
const value=JSON.parse(raw.toString('utf8'));
sample('original-portable-parsed');
const collections=Object.fromEntries(Object.entries(value).filter(([k,v])=>Array.isArray(v)).map(([k,v])=>[k,v.length]));
console.log(JSON.stringify({schema:'sf88.research-client.source-memory-observation.v1',operationId:config.operationId,node:process.version,sourceMerge:config.sourceMerge,compressedBytes:compressed.length,decodedBytes:raw.length,portableSchema:value.schema,collections,samples,maxRssKiB:process.resourceUsage().maxRSS}));
"""
write(root/"source-memory-observation.mjs",profile_source.encode())

def snapshot(path):
    path=Path(path)
    if not path.is_file():return None
    return {"bytes":path.stat().st_size,"sha256":sha(path.read_bytes()),"value":json.loads(path.read_text())}
status=125
native_receipt=None
profile=None
failure=None
try:
    if prepared.returncode:raise RuntimeError("Original source setup did not complete")
    p=subprocess.run([setup["node"],"--max-old-space-size=256",str(root/"source-memory-observation.mjs"),str(root)],capture_output=True,text=True)
    report={"exitCode":p.returncode,"stdout":p.stdout,"stderr":p.stderr[-4000:]}
    saved_json(root/"source-memory-observation.json",report)
    if p.returncode:raise RuntimeError("Original runtime memory observation needs its retained source continuation")
    profile=json.loads(p.stdout)
    imported=next(row for row in profile["samples"] if row["phase"]=="complete-original-runtime-imported")
    peak_mib=math.ceil(profile["maxRssKiB"]/1024)
    import_mib=math.ceil(imported["rss"]/(1024*1024))
    # One full original portable-processing Node, two runtime-sized companions,
    # and 64 MiB for Python/controller/retained buffers in this serial journey.
    estimated_mib=peak_mib+2*import_mib+64
    budget=max(384,math.ceil(estimated_mib/64)*64)
    if budget>768:raise RuntimeError("Measured original process set exceeds its previous selected allocation")
    placement={"schema":"sf88.research-client.measured-native-placement.v1","operationId":config["operationId"],
      "memoryMiB":budget,"reserveMiB":128,"profilePeakMiB":peak_mib,"runtimeImportMiB":import_mib,
      "processEstimateMiB":estimated_mib,"sourceFiles":setup["sourceFiles"],"sourceSha256":setup["sourceSha256"],
      "reason":"One full-portable process plus two imported-runtime companions and 64 MiB controller/buffer allowance; existing shared controller enforces actual availability."}
    saved_json(root/"native-placement.json",placement)
    emit({"state":"original-resource-selection","placement":placement,"profile":profile})
    original=(root/"inbox/worker-research-launch.py").read_text()
    before='memory_mib=768,memory_reserve_mib=256,memory_reclaim="clean-cache"'
    if original.count(before)!=1:raise RuntimeError("Original memory selection seam differs")
    selected=original.replace(before,f'memory_mib={budget},memory_reserve_mib=128,memory_reclaim="clean-cache"')
    launcher=root/"inbox/worker-research-launch-local.py";write(launcher,selected.encode())
    saved_json(root/"native-launch-intent.json",{"operationId":config["operationId"],"launcherSha256":sha(selected.encode()),"at":time.time()})
    p=subprocess.run([sys.executable,"-B",str(launcher),str(root)])
    status=p.returncode
    native_receipt={"state":"native-launch-returned","exitCode":status,"directory":str(root)}
    saved_json(root/"native-launch-result.json",native_receipt)
    emit(native_receipt)
except BaseException as error:
    failure={"type":type(error).__name__,"message":str(error)}
    emit({"state":"native-attention","operationId":config["operationId"],"error":failure})
finally:
    selected={}
    def add_file(path,name):
        st=path.lstat()
        if not stat.S_ISREG(st.st_mode):raise RuntimeError("Selected return file is not ordinary: "+name)
        selected[name]={"path":path,"bytes":st.st_size,"sha256":file_sha(path)}
    for directory in ["workspace","source-state","private-inputs","project","controller/host","records","inbox"]:
        base=root/directory
        if not base.is_dir():continue
        for path in sorted(base.rglob("*")):
            if path.is_dir():continue
            if "__pycache__" in path.parts or path.suffix in (".pyc",".pyo"):continue
            add_file(path,str(path.relative_to(root)))
    for name in ["original-prepared-input.json","case-input.json","setup-result.json","setup.stdout","setup.stderr",
                 "source-memory-observation.mjs","source-memory-observation.json","native-placement.json",
                 "native-launch-intent.json","native-launch-result.json","original-receiving-input.json","original-operating-input.json"]:
        path=root/name
        if path.is_file():add_file(path,name)
    native_result=snapshot(root/"project/results/run-result.json")
    native_artifacts=snapshot(root/"project/results/run-artifacts.json")
    state="complete" if status==0 and native_artifacts and native_artifacts["value"].get("state")=="complete" else "attention"
    receipt={"schema":"sf88.research-client.original-operation-owner-return.v1","operationId":config["operationId"],
      "directory":str(root),"state":state,"nativeExitCode":status,"failure":failure,
      "nativeResult":native_result,"nativeArtifacts":native_artifacts,"sourceFiles":setup.get("sourceFiles") if prepared.returncode==0 else None,
      "sourceMerge":config["sourceMerge"],"files":[{"path":name,"bytes":row["bytes"],"sha256":row["sha256"]} for name,row in selected.items()]}
    saved_json(root/"owner-return.json",receipt);add_file(root/"owner-return.json","owner-return.json")
    destination=root/"NCC_Research_Original_Operation_20261012.tar.gz"
    with tarfile.open(destination,"x:gz",compresslevel=6) as archive:
        for name,row in selected.items():
            if file_sha(row["path"])!=row["sha256"]:raise RuntimeError("Selected return changed")
            archive.add(row["path"],arcname=name,recursive=False)
    os.chmod(destination,0o600)
    artifact={"path":str(destination),"bytes":destination.stat().st_size,"sha256":file_sha(destination)}
    emit({"state":"original-return-ready","operationId":config["operationId"],"outcome":state,"artifact":artifact,
      "nativeResult":native_result,"nativeArtifacts":native_artifacts})
    helper=Path("/dev/shm/crossref-workspace-d9b5/library-save-jj3jcjwu")
    saved=retain_artifact(
        root,artifact,config["operationId"],helper,
        prepared_upload=reserved_upload,input_stream=sys.stdin,
        emit=lambda line:print(line,flush=True),artifact_type="report",
    )
    saved_json(root/"library-upload-result.json",saved)
    emit({"state":"original-library-return","operationId":config["operationId"],"outcome":state,
          "artifact":artifact,"receipt":saved})

sys.exit(status)
