"""Continue the original maintained Starforge builder and native DSpace agent receiving."""
import argparse, hashlib, json, os, pathlib, shutil, subprocess, tarfile, zipfile
from datetime import datetime, timezone
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument("--ref",required=True,help="Exact maintained source commit")
parser.add_argument("--directory",required=True,help="Private persistent directory for this original operation")
inputs=parser.add_mutually_exclusive_group(required=True)
inputs.add_argument("--project-delivery",help="Original complete DSpace delivery ZIP")
inputs.add_argument("--project-file",help="Original complete SQLite project")
parser.add_argument("--project-sha256",help="Required with --project-file")
cache=parser.add_mutually_exclusive_group()
cache.add_argument("--cache-repository",help="Existing local Git repository; its objects are borrowed read-only")
cache.add_argument("--cache-archive",help="Existing original source.git tar.gz cache")
parser.add_argument("--delta",help="Existing exact verified source delta")
parser.add_argument("--sf47-receivers",required=True,help="Private original preparation and two receiver modules")
parser.add_argument("--sf47-original-delivery",required=True,help="Original private SF47 delivery ZIP")
parser.add_argument("--node",default="node")
parser.add_argument("--python",default="python3")
parser.add_argument("--npm",default="npm")
parser.add_argument("--npm-cache")
parser.add_argument("--browser-executable",required=True)
parser.add_argument("--playwright-module",required=True)
args=parser.parse_args()
HEAD=args.ref
if len(HEAD)!=40 or any(c not in "0123456789abcdef" for c in HEAD):raise ValueError("An exact immutable source commit is required")
OPERATION="f47a-dspace-agent-20261012"
PREFIX="stellar/scf-starforge-20261009"
MODULE=PREFIX+"/sf30-seller-sdk/dspace"
REPO="https://github.com/woahwhattheheck/public-commons-sprint-2026.git"
def executable(value):
    result=shutil.which(value)
    if not result:raise RuntimeError("Required existing executable is absent: "+value)
    return str(pathlib.Path(result).resolve())
NODE=executable(args.node);PYTHON=executable(args.python);NPM=executable(args.npm)
stage=pathlib.Path(args.directory).expanduser().absolute()
if stage.is_symlink():raise RuntimeError("The original receiving directory must not be a symlink")
stage.mkdir(parents=True,mode=0o700,exist_ok=True)
if stage.resolve()!=stage:raise RuntimeError("Use the real absolute receiving directory")
stage.chmod(0o700)
# This lock only owns this invocation; product stores retain their original leases.
import fcntl
lock=open(stage/"receiving.lock","a+b")
try:fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
except BlockingIOError:raise RuntimeError("The original receiving invocation is already active")
for name in ["tmp","logs","inputs","delivery"]:(stage/name).mkdir(mode=0o700,exist_ok=True)
DELIVERY=stage/"delivery"
SF47_RECEIVERS=pathlib.Path(args.sf47_receivers).resolve()
SF47_ORIGINAL=pathlib.Path(args.sf47_original_delivery).resolve()
ORIGINAL=stage/"inputs/Repository_Workspace.sqlite3"
ORIGINAL_SHA=None
phases=[]
env=dict(os.environ,TMPDIR=str(stage/"tmp"),TMP=str(stage/"tmp"),TEMP=str(stage/"tmp"),NODE_NO_WARNINGS="1",
    npm_config_cache=str(pathlib.Path(args.npm_cache).resolve()) if args.npm_cache else str(stage/"npm-cache"))
env["PATH"]=str(pathlib.Path(NODE).parent)+os.pathsep+env.get("PATH","")
def digest(p):
    h=hashlib.sha256()
    with pathlib.Path(p).open("rb") as f:
        for block in iter(lambda:f.read(1048576),b""):h.update(block)
    return h.hexdigest()
def metadata(p):
    p=pathlib.Path(p)
    return {"path":str(p),"bytes":p.stat().st_size,"sha256":digest(p)}
def note(phase,**data):
    value={"phase":phase,"at":datetime.now(timezone.utc).isoformat(),**data}
    phases.append(value)
    print(json.dumps(value),flush=True)
    (stage/"progress.json").write_text(json.dumps(phases,indent=2)+"\n")
def run(label,argv,*,environment=None,cwd=None,input=None,timeout=1200,parse=False):
    import signal
    command=[str(x) for x in argv]
    child=subprocess.Popen(command,env=environment or env,cwd=cwd,stdin=subprocess.PIPE if input is not None else subprocess.DEVNULL,
        stdout=subprocess.PIPE,stderr=subprocess.PIPE,start_new_session=True)
    owned={"label":label,"pid":child.pid,"argv":command,"startedAt":datetime.now(timezone.utc).isoformat()}
    (stage/"CURRENT_PROCESS.json").write_text(json.dumps(owned,indent=2)+"\n")
    interrupted=None
    try:stdout,stderr=child.communicate(input=input,timeout=timeout)
    except BaseException as error:
        interrupted=error
        try:os.killpg(child.pid,signal.SIGTERM)
        except ProcessLookupError:pass
        try:stdout,stderr=child.communicate(timeout=20)
        except subprocess.TimeoutExpired:
            try:os.killpg(child.pid,signal.SIGKILL)
            except ProcessLookupError:pass
            stdout,stderr=child.communicate()
    (stage/"logs"/(label+".stdout")).write_bytes(stdout)
    (stage/"logs"/(label+".stderr")).write_bytes(stderr)
    owned.update({"completedAt":datetime.now(timezone.utc).isoformat(),"returncode":child.returncode})
    (stage/"CURRENT_PROCESS.json").write_text(json.dumps(owned,indent=2)+"\n")
    if interrupted:raise interrupted
    if child.returncode:raise RuntimeError(label+" exited "+str(child.returncode)+": "+stderr[-4000:].decode("utf8","replace"))
    return json.loads(stdout) if parse else stdout
def preserve(file,name=None):
    file=pathlib.Path(file);target=DELIVERY/(name or file.name)
    if file.resolve()==target.resolve():return str(target)
    if target.exists():
        if digest(target)==digest(file):return str(target)
        raise RuntimeError("Existing final artifact differs: "+target.name)
    temporary=target.with_name(target.name+".part")
    with temporary.open("xb") as out,file.open("rb") as source:
        shutil.copyfileobj(source,out,1048576);out.flush();os.fsync(out.fileno())
    if digest(temporary)!=digest(file):raise RuntimeError("Final artifact copy changed")
    os.replace(temporary,target)
    return str(target)
def original_git_blob(file):
    data=pathlib.Path(file).read_bytes()
    return hashlib.sha1(("blob "+str(len(data))+"\0").encode()+data).hexdigest()
git_env=None
gitdir=stage/"source.git"
try:
    if args.project_delivery:
        original_customer=pathlib.Path(args.project_delivery).resolve()
        expected="ef5757e2c09aea4bfaec1993b11e49feb2cb004d603f7f2e4fd40df7cacd74a7"
        if digest(original_customer)!=expected:raise RuntimeError("The original complete DSpace delivery changed")
        customer_index={"archive":metadata(original_customer),"members":[],"records":[]}
        with zipfile.ZipFile(original_customer) as z:
            if z.testzip() is not None:raise RuntimeError("Original DSpace delivery is damaged")
            customer_index["members"]=z.namelist()
            raw=z.read("Repository_Workspace.sqlite3")
            if ORIGINAL.exists() and ORIGINAL.read_bytes()!=raw:raise RuntimeError("Original retained project differs")
            if not ORIGINAL.exists():ORIGINAL.write_bytes(raw);ORIGINAL.chmod(0o600)
            for name in z.namelist():
                if not name.endswith(".json") or not any(v in name.lower() for v in ["delivery.json","result","receipt"]):continue
                value=z.read(name)
                if len(value)>120000:continue
                customer_index["records"].append({"path":name,"bytes":len(value),"sha256":hashlib.sha256(value).hexdigest(),"value":json.loads(value)})
        (DELIVERY/"ORIGINAL_CUSTOMER_INDEX.json").write_text(json.dumps(customer_index,indent=2)+"\n")
        note("original-customer-input",archive=metadata(original_customer),project=metadata(ORIGINAL))
    else:
        source=pathlib.Path(args.project_file).resolve()
        if not args.project_sha256 or digest(source)!=args.project_sha256:raise RuntimeError("Exact original project SHA256 is required")
        if ORIGINAL.exists():
            if digest(ORIGINAL)!=args.project_sha256:raise RuntimeError("Original retained project differs")
        else:shutil.copyfile(source,ORIGINAL);ORIGINAL.chmod(0o600)
    ORIGINAL_SHA=digest(ORIGINAL)
    private_blobs={"prepare-installed-receiving.py":"e2a2f4b78973ede73eeea093a5f8812baaf81009",
        "mcp-journey.mjs":"def0f1f3f204a3a03366015c8126233181fa83b7",
        "drop-original-response.mjs":"41bf30216ac510add47fc27eea196bfc60efc301"}
    for name,oid in private_blobs.items():
        if original_git_blob(SF47_RECEIVERS/name)!=oid:raise RuntimeError("Original private receiver differs: "+name)
    if digest(SF47_ORIGINAL)!="a01512acd0a2d966aa1156fbc953262f9269b59994e6badf47b114f459389961":
        raise RuntimeError("Original private SF47 delivery changed")
    intent={"schema":"stellar-forge.installed-agent-operation.v1","operationId":OPERATION,"sourceCommit":HEAD,
        "originalProjectSha256":ORIGINAL_SHA,"sf47DeliverySha256":digest(SF47_ORIGINAL),"privateReceiverBlobs":private_blobs}
    intent_file=stage/"OPERATION.json"
    if intent_file.exists() and json.loads(intent_file.read_text())!=intent:
        raise RuntimeError("This retained operation has another source/input selection; inspect its original result before changing it")
    if not intent_file.exists():intent_file.write_text(json.dumps(intent,indent=2)+"\n");intent_file.chmod(0o600)
    completed=DELIVERY/"DELIVERY_RESULT.json"
    if completed.exists():
        previous_result=json.loads(completed.read_text())
        if previous_result.get("state")=="PASS" and previous_result.get("sourceCommit")==HEAD:
            for saved in [previous_result["delivery"],previous_result["sf47"]["archive"]]:
                if digest(saved["path"])!=saved["sha256"]:raise RuntimeError("Completed retained artifact changed")
            print(json.dumps(previous_result),flush=True)
            raise SystemExit(0)
    note("original-operation-selected",**intent,node=run("node-version",[NODE,"--version"]).decode().strip(),
        python=run("python-version",[PYTHON,"--version"]).decode().strip())
    git_env=dict(env,GIT_TERMINAL_PROMPT="0",GIT_TRACE="0",GIT_TRACE_CURL="0",GIT_CURL_VERBOSE="0")
    if not gitdir.exists() and args.cache_archive:
        with tarfile.open(pathlib.Path(args.cache_archive).resolve(),"r:gz") as archive:
            if any(not m.name.startswith("source.git/") and m.name!="source.git" for m in archive.getmembers()):
                raise RuntimeError("Expected the original source.git cache archive")
            archive.extractall(stage,filter="data")
    if not gitdir.exists():run("git-init",["git","init","--bare",gitdir])
    def git(label,argv,**kw):return run(label,["git","--git-dir",gitdir,*argv],environment=git_env,**kw)
    if args.cache_repository:
        cache_path=pathlib.Path(args.cache_repository).resolve()
        common=run("borrowed-cache-path",["git","-C",cache_path,"rev-parse","--path-format=absolute","--git-common-dir"]).decode().strip()
        objects=(pathlib.Path(common)/"objects").resolve(strict=True)
        if not objects.is_dir() or objects==gitdir/"objects":raise RuntimeError("The borrowed original object cache differs")
        alternate=gitdir/"objects/info/alternates";alternate.parent.mkdir(parents=True,exist_ok=True)
        alternate.write_text(str(objects)+"\n")
    remotes=git("remotes",["remote"]).decode().split()
    git("remote",["remote","set-url" if "origin" in remotes else "add","origin",REPO])
    git("promisor",["config","remote.origin.promisor","true"])
    git("filter",["config","remote.origin.partialclonefilter","blob:none"])
    git("fetch",["-c","fetch.negotiationAlgorithm=noop","fetch","--depth=1","--filter=blob:none","--no-tags","--no-write-fetch-head","--no-auto-maintenance","--recurse-submodules=no","origin",HEAD])
    if git("commit",["rev-parse",HEAD+"^{commit}"]).decode().strip()!=HEAD:raise RuntimeError("The original source commit differs")
    git("source-ref",["update-ref","refs/heads/source",HEAD])
    entries=[]
    for record in git("tree",["ls-tree","-rz",HEAD]).split(b"\0"):
        if not record:continue
        info,name=record.split(b"\t",1);mode,kind,oid=info.decode().split()
        entries.append({"path":name.decode(),"mode":mode,"kind":kind,"sha":oid})
    by_path={entry["path"]:entry for entry in entries}
    adopted=0
    if args.delta:
        delta=pathlib.Path(args.delta).resolve()
        for file in delta.rglob("*"):
            if not file.is_file() or file.is_symlink():continue
            name=file.relative_to(delta).as_posix();entry=by_path.get(name)
            if not entry or entry["kind"]!="blob":continue
            data=file.read_bytes();oid=hashlib.sha1(("blob "+str(len(data))+"\0").encode()+data).hexdigest()
            if oid!=entry["sha"]:continue
            written=git("delta-"+str(adopted),["hash-object","-w","--stdin"],input=data).decode().strip()
            if written!=oid:raise RuntimeError("The original shared source object changed")
            adopted+=1
    note("original-source-selected",sourceCommit=HEAD,treeEntries=len(entries),sharedOriginalBlobs=adopted,cache=str(gitdir))
    bootstrap=[e for e in entries if e["path"].startswith(PREFIX+"/distribution/") and e["kind"]=="blob" and e["mode"] in ["100644","100755"]]
    ids=list(dict.fromkeys(e["sha"] for e in bootstrap))
    git("bootstrap-fetch",["-c","fetch.negotiationAlgorithm=noop","fetch","--no-tags","--no-write-fetch-head","--no-auto-maintenance","--recurse-submodules=no","--filter=blob:none","--stdin","--","origin"],input=("\n".join(ids)+"\n").encode())
    batch=git("bootstrap-bytes",["cat-file","--batch"],input=("\n".join(ids)+"\n").encode());bodies={};offset=0
    for oid in ids:
        end=batch.index(b"\n",offset);header=batch[offset:end].decode().split()
        if header[:2]!=[oid,"blob"]:raise RuntimeError("Original Git batch header changed")
        size=int(header[2]);data=batch[end+1:end+1+size]
        if batch[end+1+size:end+2+size]!=b"\n" or hashlib.sha1(("blob "+str(size)+"\0").encode()+data).hexdigest()!=oid:raise RuntimeError("Original Git blob changed")
        bodies[oid]=data;offset=end+2+size
    if offset!=len(batch):raise RuntimeError("Unexpected original Git batch suffix")
    builder=stage/"builder"
    for entry in bootstrap:
        target=builder/entry["path"];target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(bodies[entry["sha"]])
        target.chmod(0o755 if entry["mode"]=="100755" else 0o644)
    build_receipt=stage/"BUILD_RECEIPT.json"
    if build_receipt.exists():
        build=json.loads(build_receipt.read_text())
        if build["sourceCommit"]!=HEAD or digest(build["archive"])!=build["sha256"]:raise RuntimeError("Original retained build receipt differs")
    else:
        build=run("original-maintained-build",[NODE,builder/PREFIX/"distribution/build.mjs","--repo",gitdir,"--ref",HEAD,"--out",stage/"built"],environment=git_env,parse=True,timeout=1800)
        build_receipt.write_text(json.dumps(build,indent=2)+"\n")
    if build["sourceCommit"]!=HEAD:raise RuntimeError("The maintained builder packaged another source")
    archive=pathlib.Path(build["archive"])
    if not archive.exists():
        candidates=list((stage/"built").glob("*.tgz"))
        if len(candidates)!=1:raise RuntimeError("The maintained package archive is absent")
        archive=candidates[0]
    if digest(archive)!=build["sha256"]:raise RuntimeError("The maintained archive digest differs")
    note("maintained-package-built",sourceCommit=HEAD,packageVersion=build["packageVersion"],sourceFiles=build["sourceFiles"],archive=metadata(archive))
    git_env.clear();git_env=None
    install=stage/"ready-runtime"
    ready_driver=stage/"prepare-original-runtime.mjs"
    ready_driver.write_text("""
import {writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
const [moduleFile,directory,archive,sha256,cache,sourceCommit,receipt,python,npm]=process.argv.slice(2);
const {prepareRuntimeInstall,installRuntime,inspectRuntimeInstall}=await import(pathToFileURL(moduleFile));
const prepared=await prepareRuntimeInstall({directory,archive,sha256,native:false,features:[],operator:true,python});
if(prepared.sourceCommit!==sourceCommit)throw new Error('Prepared original runtime source differs');
const installed=await installRuntime({directory,offline:true,npm,cache});
const inspected=await inspectRuntimeInstall({directory,load:true,source:true});
if(inspected.status!=='READY'||inspected.ready!==true||inspected.sourceVerified!==true||inspected.lockMatches!==true||inspected.sourceCommit!==sourceCommit)throw new Error('Original runtime receiving is incomplete');
const result={schema:'stellar-forge.dspace-agent-ready-runtime.v1',state:'READY',prepared,installed,inspected};
await writeFile(receipt,JSON.stringify(result,null,2)+'\\n',{mode:0o600});
process.stdout.write(JSON.stringify({state:'READY',directory,sourceCommit,installationId:inspected.installationId,profileId:inspected.profileId,sourceRoot:inspected.sourceRoot})+'\\n');
""")
    ready=run("original-offline-runtime-install",[NODE,ready_driver,builder/PREFIX/"distribution/runtime-install.mjs",install,archive,build["sha256"],env["npm_config_cache"],HEAD,stage/"READY_RUNTIME_RECEIVING.json",PYTHON,NPM],parse=True,timeout=600)
    package=install/"package"
    manifest=json.loads((package/"manifest.json").read_text())
    if manifest["sourceCommit"]!=HEAD:raise RuntimeError("Installed source is not the selected immutable commit")
    for entry in manifest["files"]:
        file=package/"source"/entry["path"]
        if file.stat().st_size!=entry["bytes"] or digest(file)!=entry["sha256"]:raise RuntimeError("Installed original source changed: "+entry["path"])
    module=package/"source"/MODULE
    for name in ["client.mjs","client.d.mts","merchant-provider.mjs","launch.mjs","server.mjs","AGENT.md","native/agent-consumer.mjs","native/managed-receiving.mjs"]:
        if not (module/name).is_file():raise RuntimeError("Installed DSpace integration file is absent: "+name)
    smoke=stage/"inspect-installed-exports.mjs"
    smoke.write_text("""
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
const packageDirectory=process.argv[2],require=createRequire(path.join(packageDirectory,'package.json'));
const contracts=[
  ['@tokenjunkielabs/starforge-merchant/seller/dspace/client','connectDspaceOperator'],
  ['@tokenjunkielabs/starforge-merchant/seller/dspace/launch','readDspaceOperatorLaunch'],
  ['@tokenjunkielabs/starforge-merchant/merchant/dspace-operators','MerchantDspaceOperators'],
  ['@tokenjunkielabs/starforge-merchant/seller/dspace/workspace','openDspaceWorkspace']
];
const exports=[];
for(const [name,entry] of contracts){const filename=require.resolve(name),module=await import(pathToFileURL(filename));if(typeof module[entry]!=='function')throw new Error('Installed export is absent: '+name);exports.push({name,entry,filename});}
process.stdout.write(JSON.stringify({state:'PASS',exports})+'\\n');
""")
    exports_result=run("installed-public-exports",[NODE,smoke,package],cwd=install,parse=True,timeout=120)
    note("original-ready-runtime-and-exports",runtime=ready,exports=exports_result["exports"],manifestSha256=digest(package/"manifest.json"))
    if digest(ORIGINAL)!=ORIGINAL_SHA:raise RuntimeError("Original closed45-record project changed")
    receiving=stage/"receiving"
    note("installed-native-start",sourceCommit=HEAD,files=len(manifest["files"]),originalProjectSha256=ORIGINAL_SHA)
    previous_native=receiving/"RESULT.json"
    if not previous_native.exists() or json.loads(previous_native.read_text()).get("state")!="PASS":
        run("original-native-agent",[NODE,module/"native/agent-consumer.mjs","--directory",receiving,"--project-file",ORIGINAL],cwd=install,timeout=1800)
    native=json.loads((receiving/"RESULT.json").read_text())
    if native["state"]!="PASS" or any(p["state"]!="complete" for p in native["phases"]):raise RuntimeError("The original complete native receiving is unfinished")
    note("installed-native-complete",phases=len(native["phases"]),workspaceId=native["workspaceId"],revision=native["revision"],project=native["project"])
    browser=executable(args.browser_executable)
    selected=pathlib.Path(args.playwright_module).resolve()
    candidates=[selected] if selected.is_file() else [selected/"index.mjs",selected/"index.js"]
    playwright=next((str(p) for p in candidates if p.is_file()),None)
    if playwright is None:raise RuntimeError("The existing Playwright module entrypoint is required")
    managed_directory=stage/"managed-receiving"
    note("installed-managed-browser-start",runtime=ready,project=metadata(receiving/"Repository_Agent_Workspace.sqlite3"),browser=browser,playwright=playwright)
    previous_managed=managed_directory/"RESULT.json"
    if not previous_managed.exists() or json.loads(previous_managed.read_text()).get("state")!="PASS":
        run("original-managed-browser",[NODE,module/"native/managed-receiving.mjs","--runtime-directory",install,
        "--source-commit",HEAD,"--manifest-sha256",digest(package/"manifest.json"),"--directory",managed_directory,
        "--project-file",receiving/"Repository_Agent_Workspace.sqlite3","--browser-executable",browser,"--playwright-module",playwright],cwd=install,timeout=1800)
    managed=json.loads((managed_directory/"RESULT.json").read_text())
    if managed.get("state")!="PASS":raise RuntimeError("The original complete managed browser receiving is unfinished")
    note("installed-managed-browser-complete",result=metadata(managed_directory/"RESULT.json"),phases=managed.get("phases"))
    sf47_root=stage/"sf47-receiving"
    sf47_result=None;sf47_error=None
    try:
        prior_sf47=sf47_root/"output/NATIVE_RESULT.json"
        if sf47_root.exists() and any(sf47_root.iterdir()):
            if not prior_sf47.exists():raise RuntimeError("Original SF47 receiving state needs its owning continuation; no whole-journey replay")
            sf47_result=json.loads(prior_sf47.read_text())
            if sf47_result.get("complete") is not True or not sf47_result.get("completedAt") or sf47_result.get("error") or sf47_result.get("shutdownErrors"):
                raise RuntimeError("Original SF47 receiving is unfinished; preserve saved state for its owning continuation")
        else:
            sf47_prepare=SF47_RECEIVERS/"prepare-installed-receiving.py"
            prepared_sf47=run("prepare-original-sf47",[PYTHON,"-B",sf47_prepare,"--package",package,"--root",sf47_root,
                "--source-commit",HEAD,"--node",NODE,"--python",PYTHON,"--receiver-source",SF47_RECEIVERS,
                "--original-delivery",SF47_ORIGINAL],parse=True,timeout=120)
            note("original-sf47-native-start",operationId=prepared_sf47["operationId"],caseSha256=prepared_sf47["caseSha256"],sourceCommit=HEAD)
            run("original-sf47-native",prepared_sf47["command"],cwd=install,timeout=1800)
            sf47_result=json.loads(prior_sf47.read_text())
            if sf47_result.get("complete") is not True or not sf47_result.get("completedAt") or sf47_result.get("error") or sf47_result.get("shutdownErrors"):
                raise RuntimeError("Original SF47 complete native receiving is unfinished")
        note("original-sf47-native-complete",result=metadata(prior_sf47),complete=True)
    except Exception as error:
        sf47_error={"state":"INTERRUPTED","sourceCommit":HEAD,"error":str(error),"result":sf47_result}
        note("original-sf47-native-retained",error=sf47_error["error"],originalRoot=str(sf47_root))
    sf47_archive=DELIVERY/("SF47_Original_Agent_Receiving_"+HEAD[:12]+"_20261012.zip")
    if sf47_root.exists():
        with zipfile.ZipFile(sf47_archive,"x",compression=zipfile.ZIP_DEFLATED,compresslevel=6) as z:
            if sf47_error:
                for file in sf47_root.rglob("*"):
                    if file.is_file() and not file.is_symlink():z.write(file,file.relative_to(sf47_root).as_posix())
            else:
                for name in ["SETUP.json","output/NATIVE_RESULT.json","output/original-lost-response.json",
                    "output/SF47-agent-source-case.zip","output/SF47-agent-saved-forecast.zip","output/SF47-agent-received-case.zip",
                    "mcp-journey.mjs","drop-original-response.mjs"]:
                    file=sf47_root/name
                    if not file.is_file():raise RuntimeError("Completed original SF47 receiving artifact is absent: "+name)
                    z.write(file,name)
            z.writestr("SOURCE.json",json.dumps({"sourceCommit":HEAD,"packageVersion":build["packageVersion"],"packageSha256":build["sha256"],
                "sourceManifestSha256":digest(package/"manifest.json"),"operationId":"F47A-SF47-ORIGINAL-AGENT-RECEIVING-20261012",
                "state":"INTERRUPTED" if sf47_error else "COMPLETE","error":sf47_error},indent=2)+"\n")
        with zipfile.ZipFile(sf47_archive) as z:
            if z.testzip() is not None:raise RuntimeError("Original SF47 receiving archive failed its CRC")
    record={"schema":"stellar-forge.dspace-agent-installed-receiving.v1","state":"PASS","sourceCommit":HEAD,"packageVersion":build["packageVersion"],
        "package":metadata(archive),"manifestSha256":digest(package/"manifest.json"),"sourceFiles":len(manifest["files"]),"native":native,"managed":managed,"readyRuntime":json.loads((stage/"READY_RUNTIME_RECEIVING.json").read_text()),"phases":phases}
    (stage/"INSTALLED_AGENT_RECEIVING.json").write_text(json.dumps(record,indent=2)+"\n")
    (stage/"BUILD_RECEIPT.json").write_text(json.dumps(build,indent=2)+"\n")
    start=f"""# Repository agent workspace

The included Starforge package and every installed source file were received from commit {HEAD}. Its complete package is `{archive.name}`. The original runtime installer prepared the dependency profile and lockfile, then the typed client, merchant MCP host and managed browser operated the same source and repository records.

## Open the delivered repository

Use Node 24 or later in a private directory, then install the included package:

```sh
npm install --offline --ignore-scripts --no-audit --no-fund --omit=optional --legacy-peer-deps /absolute/path/{archive.name}
npx --no-install starforge dspace receive --file /absolute/path/Repository_Agent_Workspace.sqlite3 --workspace /absolute/path/repository-data
npx --no-install starforge dspace-workspace --directory /absolute/path/repository-operator --workspace /absolute/path/repository-data --port 0
```

The receive command preserves the original workspace identity, source captures, 45-record edition, reviewed 44-publication successor, complete native metadata arrays and retained operations. The browser command prints its local address.

## Continue through the original agent and managed interfaces

AGENT.md contains the typed client, original MCP connection format, named reviews, exact project binding, recovery and complete file receiving. APPLICATION_DSPACE.md describes the original managed Applications controls and their existing runtime adoption. MERCHANT.md covers the source, dataset, publication and customer lifecycle. The same reviewed dataset can be reopened and used in each interface.

INSTALLED_AGENT_RECEIVING.json joins the exact package, runtime profile/lock and both actual receiving outcomes. NATIVE_RESULT.json records the original typed client/MCP workflow. MANAGED_BROWSER_RESULT.json and managed/ retain the actual browser receiving artifacts, including project isolation and Stop/reopen. source-manifest.json identifies every maintained source file; runtime-profile.json and runtime-package-lock.json retain the original dependency selection.

"""
    (stage/"START_HERE.md").write_text(start)
    final=DELIVERY/("SCF_DSpace_Agent_Workspace_"+HEAD[:12]+"_20261012.zip")
    members=[(archive,archive.name),(package/"manifest.json","source-manifest.json"),(stage/"INSTALLED_AGENT_RECEIVING.json","INSTALLED_AGENT_RECEIVING.json"),
        (stage/"READY_RUNTIME_RECEIVING.json","READY_RUNTIME_RECEIVING.json"),(install/"runtime-profile.json","runtime-profile.json"),(install/"package-lock.json","runtime-package-lock.json"),(managed_directory/"RESULT.json","MANAGED_BROWSER_RESULT.json"),
        (stage/"BUILD_RECEIPT.json","BUILD_RECEIPT.json"),(stage/"START_HERE.md","START_HERE.md"),(receiving/"RESULT.json","NATIVE_RESULT.json"),
        (receiving/"journal.json","native/journal.json"),(receiving/"Repository_Agent_Workspace.sqlite3","Repository_Agent_Workspace.sqlite3"),
        (module/"AGENT.md","AGENT.md"),(module/"MERCHANT.md","MERCHANT.md"),(module/"README.md","README.md"),
        (package/"source"/PREFIX/"distribution/runtime-workspace/APPLICATION_DSPACE.md","APPLICATION_DSPACE.md"),
        (module/"native/MANAGED_RECEIVING.md","MANAGED_RECEIVING.md")]
    # The managed receiver names the original portable artifacts explicitly.
    # Preserve its complete result and only regular files beneath its own root.
    for artifact in managed.get("artifacts",[]):
        value=artifact if isinstance(artifact,str) else artifact.get("path")
        if not value:continue
        file=pathlib.Path(value)
        if not file.is_absolute():file=managed_directory/file
        resolved=file.resolve(strict=True)
        if not resolved.is_relative_to(managed_directory.resolve()) or file.is_symlink() or not resolved.is_file():raise RuntimeError("Managed artifact is outside its original receiving directory")
        members.append((resolved,"managed/"+resolved.relative_to(managed_directory.resolve()).as_posix()))
    with zipfile.ZipFile(final,"x",compression=zipfile.ZIP_DEFLATED,compresslevel=7) as z:
        seen=set()
        for file,name in members:
            if name in seen:continue
            seen.add(name);z.write(file,name)
    with zipfile.ZipFile(final) as z:
        if z.testzip() is not None:raise RuntimeError("Complete final ZIP failed its CRC")
        for file,name in members:
            if hashlib.sha256(z.read(name)).hexdigest()!=digest(file):raise RuntimeError("Final archive member changed")
    copies={}
    for file in [stage/"INSTALLED_AGENT_RECEIVING.json",stage/"READY_RUNTIME_RECEIVING.json",stage/"BUILD_RECEIPT.json",stage/"START_HERE.md"]:
        copies[file.name]=preserve(file)
    outcome={"schema":"stellar-forge.installed-agent-delivery.v1","operationId":OPERATION,
        "state":"PASS" if sf47_error is None else "DSPACE_PASS_SF47_RETAINED","sourceCommit":HEAD,
        "delivery":metadata(final),"sf47":sf47_error or {"state":"COMPLETE","archive":metadata(sf47_archive)},
        "sourceManifestSha256":digest(package/"manifest.json"),"localCopies":copies,
        "originalDirectory":str(stage),"originalCache":str(gitdir)}
    (DELIVERY/"DELIVERY_RESULT.json").write_text(json.dumps(outcome,indent=2)+"\n")
    print(json.dumps(outcome),flush=True)
    if sf47_error:raise RuntimeError("Original SF47 receiving is retained for its owning continuation")
except SystemExit:
    raise
except BaseException as error:
    failure={"state":"INTERRUPTED","operationId":OPERATION,"sourceCommit":HEAD,"at":datetime.now(timezone.utc).isoformat(),
        "error":str(error),"phases":phases,"originalDirectory":str(stage),"retainedLogs":str(stage/"logs"),
        "nativeRoots":[str(stage/name) for name in ["receiving","managed-receiving","sf47-receiving"]]}
    (DELIVERY/"INTERRUPTED_RECEIVING.json").write_text(json.dumps(failure,indent=2)+"\n")
    print(json.dumps(failure),flush=True)
    raise
finally:
    if git_env is not None:git_env.clear()
    fcntl.flock(lock,fcntl.LOCK_UN);lock.close()
