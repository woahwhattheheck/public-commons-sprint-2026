import ast,base64,concurrent.futures,datetime,hashlib,io,json,os,pathlib,shutil,subprocess,sys,tempfile,termios,traceback,urllib.request,zipfile
if os.isatty(0):
    mode=termios.tcgetattr(0);mode[3]&=~(termios.ECHO|termios.ICANON);mode[6][termios.VMIN]=1;mode[6][termios.VTIME]=0
    termios.tcsetattr(0,termios.TCSANOW,mode)
if len(sys.argv)!=2:raise SystemExit("Usage: python3 -B continuous_producer.py complete-native-work-order.json")
ORDER=json.loads(pathlib.Path(sys.argv[1]).read_text(encoding="utf-8"))
ROOT=pathlib.Path(tempfile.mkdtemp(prefix="fea-capital-complete-018a-",dir="/dev"));os.chmod(ROOT,0o700)
TMP=ROOT/"temporary";TMP.mkdir(mode=0o700);os.environ["TMPDIR"]=str(TMP);tempfile.tempdir=str(TMP);os.environ["PYTHONDONTWRITEBYTECODE"]="1"
APP=ROOT/"application";APP.mkdir(mode=0o700)
def now():return datetime.datetime.now(datetime.timezone.utc).isoformat()
def emit(v):print(json.dumps(v,ensure_ascii=False),flush=True)
def write(path,data):
    path.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
    if path.exists() and path.read_bytes()!=data:raise ValueError("An immutable original file differs: "+str(path))
    if not path.exists():
        with path.open("xb") as file:file.write(data);file.flush();os.fsync(file.fileno())
        os.chmod(path,0o600)
if globals().get("SELECTED_PRODUCER_RAW") is not None:
    write(ROOT/"native-producer.py",SELECTED_PRODUCER_RAW)
def digest(path):
    h=hashlib.sha256();count=0
    with path.open("rb") as file:
        while chunk:=file.read(1024*1024):h.update(chunk);count+=len(chunk)
    return {"bytes":count,"sha256":h.hexdigest()}
def jsonwrite(path,value):write(path,(json.dumps(value,ensure_ascii=False,indent=2)+"\n").encode())
def fetch(item):
    relative=item["path"];url="https://raw.githubusercontent.com/woahwhattheheck/public-commons-sprint-2026/"+ORDER["source_commit"]+"/opportunities/lake_county_fea_capital_2026/"+relative
    with urllib.request.urlopen(urllib.request.Request(url,headers={"Accept-Encoding":"identity","User-Agent":"TJLabs-Original-FEA-Receiving/1.0"}),timeout=45) as response:data=response.read(item["bytes"]+1)
    if len(data)!=item["bytes"] or hashlib.sha256(data).hexdigest()!=item["sha256"]:raise ValueError("The complete published source differs: "+relative)
    target=ROOT/relative if relative.startswith("source/") else APP/relative
    return target,data
def logged(name,argv,env=None):
    logs=ROOT/"native-logs";logs.mkdir(mode=0o700,exist_ok=True)
    jsonwrite(logs/(name+"-request.json"),{"argv":argv,"started_at_utc":now()})
    last=None;count=0;checkpoint_error=None
    with (logs/(name+".log")).open("x",encoding="utf-8") as file:
        child=subprocess.Popen(argv,cwd=ROOT,env=env or os.environ.copy(),stdin=subprocess.PIPE,
                               stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True)
        for line in child.stdout:
            file.write(line);file.flush()
            try:
                value=json.loads(line);last=value
                if value.get("phase")=="SOURCE_CHECKPOINT_READY":
                    try:
                        request=value["request"]
                        raw=(json.dumps(request,sort_keys=True,separators=(",",":"))+"\n").encode()
                        if (request.get("operation_id")!=ORDER["source_operation"]
                                or hashlib.sha256(raw).hexdigest()!=value["request_sha256"]
                                or digest(ROOT/"public-source"/"capture-manifest.json")!=request["source_manifest"]):
                            raise ValueError("The selected source checkpoint request or manifest differs")
                        receipt=save_delivery("source-"+request["stage"],checkpoint=value)
                        answer={"schema":"lake-county.source-checkpoint-ack/v1",
                                "operation_id":ORDER["source_operation"],"request_sha256":value["request_sha256"],
                                "saved":True,"library_file_id":receipt["library_file_id"],
                                "current_version_number":receipt["current_version_number"],
                                "artifact":receipt["artifact"]}
                    except Exception as error:
                        checkpoint_error=str(error)
                        answer={"schema":"lake-county.source-checkpoint-ack/v1",
                                "operation_id":ORDER["source_operation"],"request_sha256":value.get("request_sha256"),
                                "saved":False,"error":checkpoint_error}
                    child.stdin.write(json.dumps(answer)+"\n");child.stdin.flush()
                elif value.get("phase","").startswith("SOURCE_") or value.get("phase") in {
                        "COMPLETE","OPERATING_ERROR","PRESERVATION_ERROR","PUBLIC_GIS_ACQUIRED","ARCHIVE_READY"}:
                    emit({"child":name,"result":value})
                else:
                    count+=1
                    if count%25==0:emit({"child":name,"progress_records":count})
            except (json.JSONDecodeError,AttributeError):
                if name=="browser" and any(term in line for term in ["Downloading","downloaded","Error"]):
                    emit({"child":name,"progress":line.strip()[:500]})
        child.stdin.close()
        code=child.wait()
    result={"name":name,"exit_code":code,"last":last,"log":str(logs/(name+".log"))}
    if checkpoint_error:result["checkpoint_error"]=checkpoint_error
    jsonwrite(logs/(name+"-result.json"),result)
    if code:raise RuntimeError(name+" exited "+str(code)+"; complete output remains in "+str(logs/(name+".log")))
    return result
def capture():
    env=os.environ.copy();env["FEA_PUBLIC_SOURCE_SAVE_MODE"]="embedded"
    env["FEA_PUBLIC_SOURCE_DIR"]=str(ROOT/"public-source")
    env["FEA_PUBLIC_SOURCE_CHECKPOINT_MODE"]="parent_stdio"
    return logged("public-source",[sys.executable,"-B",str(ROOT/"source"/"collector.py")],env)
def browser():
    node=os.environ.get("CODEX_PRIMARY_RUNTIME_NODE") or shutil.which("node")
    if not node:raise RuntimeError("Select the actual installed Node runtime")
    probe="""const p=require('node:path');let r={};for(const root of [process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES,...require('node:module').globalPaths].filter(Boolean)){for(const name of ['playwright','playwright-core']){try{const file=require.resolve(p.join(root,name));const lib=require(file);r={playwright_module:file};break}catch(e){}}if(r.playwright_module)break}process.stdout.write(JSON.stringify(r));"""
    selected=json.loads(subprocess.run([node,"-e",probe],capture_output=True,text=True,check=True).stdout);selected["node"]=node
    if not selected.get("playwright_module"):raise RuntimeError("No original installed Playwright module was found")
    support=ROOT/"browser-support"
    for item in ORDER["browser_support"]["files"]:
        data=base64.b64decode(item["base64"],validate=True)
        if len(data)!=item["bytes"] or hashlib.sha256(data).hexdigest()!=item["sha256"]:raise ValueError("The selected maintained browser source differs: "+item["path"])
        write(support/item["path"],data)
    jsonwrite(support/"source-selection.json",{key:value for key,value in ORDER["browser_support"].items() if key!="files"}|{"files":[{key:value for key,value in item.items() if key!="base64"} for item in ORDER["browser_support"]["files"]]})
    module=support/"chromium_runtime.cjs"
    subprocess.run([node,"--check",str(module)],check=True)
    options={"root":str(ROOT/"browser-runtime"),"reuseRoots":["/workspace/scratch/5403360e55a4/fleet-lightweight/shared/swarm/toolchains/browser"],"install":True}
    wrapper="const m=require(process.argv[1]);m.provisionChromium(JSON.parse(process.argv[2])).then(r=>{process.stdout.write(JSON.stringify(r)+'\\n');if(!r.ok)process.exitCode=1}).catch(e=>{process.stderr.write(JSON.stringify({error:e.message,detail:e.detail||null})+'\\n');process.exitCode=1})"
    receipt=logged("browser",[node,"-e",wrapper,str(module),json.dumps(options)])
    report=receipt["last"]
    if not isinstance(report,dict) or report.get("ok") is not True or not report.get("selected",{}).get("available"):raise RuntimeError("The maintained provisioner returned no verified selected Chromium")
    actual=report["selected"]
    executable=pathlib.Path(actual["executablePath"])
    if not executable.is_file() or not os.access(executable,os.X_OK) or digest(executable)!={"bytes":actual["bytes"],"sha256":actual["sha256"]}:raise RuntimeError("The actual selected Chromium changed")
    environment=report.get("environment") or {}
    if not isinstance(environment,dict) or any(not isinstance(key,str) or not isinstance(value,str) for key,value in environment.items()):raise RuntimeError("The maintained Chromium environment is malformed")
    for key,value in environment.items():os.environ[key]=value
    selected.update(browser_executable=str(executable),browser_exists=True,maintained_provision=report)
    jsonwrite(ROOT/"runtime-selection.json",selected);return selected
HELPERS=ROOT/"library-helpers";HELPERS.mkdir(mode=0o700)
def archive_source_checkpoint(selected):
    """Restore verified public-source bytes from the same saved operating item."""
    if not selected:return
    if (selected.get("library_file_id")!=ORDER["previous_attempt"]["library_file_id"]
            or type(selected.get("current_version_number")) is not int):
        raise ValueError("Select the same original operating artifact and its actual current version")
    preservation_state["blocked"]=True
    preservation_state["blocked_reason"]="The original saved source checkpoint has not been fully restored; preserve that artifact."
    original_result=selected["search_result"]
    request={"result":original_result,"selection":selected["selection"],"destination":"retained-checkpoint"}
    helper=source_helpers/"library_download.py"
    process=subprocess.run([sys.executable,"-B",str(helper)],input=json.dumps(request).encode(),
                           stdout=subprocess.PIPE,stderr=subprocess.PIPE,cwd=ROOT,timeout=180)
    write(ROOT/"checkpoint-download.stdout",process.stdout)
    write(ROOT/"checkpoint-download.stderr",process.stderr)
    if process.returncode:raise RuntimeError("The unchanged original artifact download helper did not complete")
    outputs=[]
    for line in process.stdout.decode("utf-8",errors="replace").splitlines():
        try:
            value=json.loads(line)
            if isinstance(value,dict) and isinstance(value.get("files"),list):outputs.append(value)
        except json.JSONDecodeError:pass
    if len(outputs)!=1 or len(outputs[0]["files"])!=1:
        raise ValueError("Read the one actual selected checkpoint download result")
    item=outputs[0]["files"][0]
    archive=pathlib.Path(item["path"] if isinstance(item,dict) else item).resolve()
    if not archive.is_relative_to(ROOT) or digest(archive)!={"bytes":selected["bytes"],"sha256":selected["sha256"]}:
        raise ValueError("The complete selected saved checkpoint bytes differ")
    prefix="Lake_County_FEA_Capital_Programme_20261012/"
    with zipfile.ZipFile(archive) as package:
        infos=package.infolist()
        if len(infos)>100000 or len({i.filename for i in infos})!=len(infos):
            raise ValueError("The saved checkpoint has duplicate or excessive members")
        manifest=json.loads(package.read(prefix+"DELIVERY.json"))
        if (manifest.get("schema")!="lake-county.complete-delivery/v1"
                or manifest.get("operation_id")!=ORDER["operation_id"]
                or manifest.get("source_commit")!=ORDER["source_commit"]
                or manifest.get("complete") is not False or manifest.get("safe_source_reuse") is not True):
            raise ValueError("This archive is not the exact source-only checkpoint for this original operation")
        members=manifest["files"]
        if {i.filename for i in infos}!={prefix+"DELIVERY.json",*(prefix+m["path"] for m in members)}:
            raise ValueError("The complete checkpoint member inventory differs")
        for member in members:
            name=member["path"];relative=pathlib.PurePosixPath(name)
            if relative.is_absolute() or any(p in {"",".",".."} for p in name.split("/")) or "\\" in name:
                raise ValueError("Invalid checkpoint member path")
            info=package.getinfo(prefix+name)
            if (info.external_attr>>16)&0o170000==0o120000:
                raise ValueError("The checkpoint contains a symbolic link")
            h=hashlib.sha256();count=0
            with package.open(info) as stream:
                while block:=stream.read(1024*1024):h.update(block);count+=len(block)
            if {"bytes":count,"sha256":h.hexdigest()}!={"bytes":member["bytes"],"sha256":member["sha256"]}:
                raise ValueError("A full original checkpoint member differs: "+name)
            if name.startswith("public-source/") and not name.endswith("/.capture.lock"):
                write(ROOT/name,package.read(info))
        boundary=manifest.get("checkpoint")
        if boundary:
            request=boundary["request"];number=str(request["number"]).zfill(4)
            raw=(ROOT/"public-source"/"checkpoint-control"/(number+"-request.json")).read_bytes()
            if hashlib.sha256(raw).hexdigest()!=boundary["request_sha256"]:
                raise ValueError("The checkpoint's source save request differs")
            answer={"schema":"lake-county.source-checkpoint-ack/v1",
                    "operation_id":ORDER["source_operation"],"request_sha256":boundary["request_sha256"],
                    "saved":True,"library_file_id":selected["library_file_id"],
                    "current_version_number":selected["current_version_number"],
                    "artifact":{"bytes":selected["bytes"],"sha256":selected["sha256"]},
                    "recovered_from_verified_current_artifact":True}
            destination=ROOT/"public-source"/"checkpoint-control"/(number+"-result.json")
            if not destination.exists():write(destination,(json.dumps(answer,sort_keys=True)+"\n").encode())
    jsonwrite(ROOT/"restored-source-checkpoint.json",
              {k:v for k,v in selected.items() if k!="search_result"})
    preservation_state.update(current_version_number=selected["current_version_number"],blocked=False,blocked_reason=None)
    emit({"phase":"SOURCE_CHECKPOINT_RESTORED","library_file_id":selected["library_file_id"],
          "current_version_number":selected["current_version_number"],"archive":digest(archive)})

def save_delivery(stage,final=False,checkpoint=None):
    if preservation_state["blocked"]:
        raise RuntimeError(preservation_state.get("blocked_reason") or "An original artifact save has an unknown or failed outcome. Reconcile its exact intent and helper result before another write.")
    preservation_state["number"]+=1
    number=str(preservation_state["number"]).zfill(4)
    directory=ROOT/"preservation";directory.mkdir(mode=0o700,exist_ok=True)
    snapshot={**outcome,"complete":bool(final and outcome["complete"]),"preservation_stage":stage,
              "snapshot_at_utc":now(),"previous_library_version":preservation_state["current_version_number"]}
    jsonwrite(directory/(number+"-selection.json"),snapshot)
    packages=ROOT/"delivery-packages"/number;packages.mkdir(parents=True,mode=0o700)
    archive=packages/"Lake_County_FEA_Capital_Programme_20261012.zip"
    excluded={"browser-runtime","library-helpers","library-state","temporary","__pycache__","delivery-packages"}
    members=[]
    for path in sorted(ROOT.rglob("*")):
        relative=path.relative_to(ROOT)
        if any(part in excluded for part in relative.parts):continue
        if path.name in {"server-startup.json","private-server.log","private-browser-selection.json",".capture.lock"}:continue
        if path.is_symlink():raise ValueError("Retain complete source files rather than a changed symbolic link: "+str(relative))
        if path.is_file():members.append({"path":relative.as_posix(),**digest(path)})
    manifest={"schema":"lake-county.complete-delivery/v1","operation_id":ORDER["operation_id"],
              "complete":snapshot["complete"],"source_commit":ORDER["source_commit"],
              "safe_source_reuse":not (ROOT/"workspace").exists(),"preservation_stage":stage,
              "checkpoint":checkpoint,"files":members,
              "runtime_dependencies":"Python standard library; original optional Node/Playwright/Chromium selection. Complete original application and selected source bytes are retained.",
              "private_runtime_omissions":["inactive loopback startup token and private server stdout","installed browser binaries","helper staging"]}
    with zipfile.ZipFile(archive,"x",zipfile.ZIP_DEFLATED,compresslevel=6) as package:
        package.writestr("Lake_County_FEA_Capital_Programme_20261012/DELIVERY.json",json.dumps(manifest,indent=2).encode())
        for member in members:package.write(ROOT/member["path"],"Lake_County_FEA_Capital_Programme_20261012/"+member["path"])
    with zipfile.ZipFile(archive) as package:
        for member in members:
            h=hashlib.sha256();count=0
            with package.open("Lake_County_FEA_Capital_Programme_20261012/"+member["path"]) as stream:
                while block:=stream.read(1024*1024):h.update(block);count+=len(block)
            if count!=member["bytes"] or h.hexdigest()!=member["sha256"]:
                raise RuntimeError("The frozen complete artifact member differs")
    info={"path":str(archive),**digest(archive),"members":len(members)+1,
          "complete":snapshot["complete"],"stage":stage}
    expected=preservation_state["current_version_number"]
    request={"local_path":str(archive),"purpose":"replace_library_file",
             "library_file_id":ORDER["previous_attempt"]["library_file_id"],
             "expected_current_version":expected,
             "version_reason":("Complete the original FEA operating delivery" if final else "Preserve original FEA source checkpoint: "+stage)}
    jsonwrite(directory/(number+"-save-intent.json"),
              {"schema":"lake-county.delivery-save-intent/v1","operation_id":ORDER["operation_id"],"artifact":info,"request":request})
    preservation_state["blocked"]=True
    preservation_state["blocked_reason"]="The original guarded artifact save must return its exact completed version before another write."
    preservation_state["last_intent"]={"artifact":info,"request":request,"number":number}
    emit({"phase":"SAVING_DELIVERY" if final else "SAVING_SOURCE_CHECKPOINT","artifact":info,"expected_current_version":expected})
    state=ROOT/"library-state"/number;state.mkdir(parents=True,mode=0o700)
    reply=LibraryUploadWorkflow(apps_client=HostedAppsClient(),materializer=LibraryFileMaterializer(),
                               uploader=SignedUrlUploader(),state_parent=state).run({"uploads":[request]})
    jsonwrite(directory/(number+"-save-result.json"),reply)
    rows=reply.get("results",[])
    if (len(rows)!=1 or rows[0].get("status")!="succeeded"
            or rows[0].get("library_file_id")!=request["library_file_id"]
            or type(rows[0].get("current_version_number")) is not int
            or rows[0]["current_version_number"]!=expected+1):
        emit({"phase":"DELIVERY_SAVE_FAILED","artifact":info,"result":reply,"outcome":outcome})
        raise RuntimeError("The original guarded artifact save did not return its exact completed version; preserve its native outcome.")
    receipt={"library_file_id":request["library_file_id"],"current_version_number":rows[0]["current_version_number"],
             "file_id":rows[0].get("file_id"),"artifact":info,"result":reply}
    preservation_state.update(blocked=False,blocked_reason=None,current_version_number=receipt["current_version_number"],last=receipt)
    preservation_state["records"].append(receipt)
    emit({"phase":"SAVED_DELIVERY" if final else "SOURCE_CHECKPOINT_SAVED","artifact":info,"result":reply,
          "library_file_id":receipt["library_file_id"],"current_version_number":receipt["current_version_number"],
          "outcome":outcome})
    return receipt

source_helpers=pathlib.Path("/root/.codex/plugins/cache/openai-curated-remote/openai-library/0.1.62/skills/library/scripts")
for name in ["library_upload.py","library_hosted_apps.py","library_file_transfer.py"]:
    data=(source_helpers/name).read_bytes()
    if name=="library_upload.py" and hashlib.sha256(data).hexdigest()!="5bc473dadefe1f68ee8797baaed19d6662642d0ea4bcba128fa12938faa0d767":raise RuntimeError("The current official upload helper differs")
    write(HELPERS/name,data)
sys.path.insert(0,str(HELPERS))
from library_upload import LibraryUploadWorkflow,HostedAppsClient,LibraryFileMaterializer,SignedUrlUploader
instructions={str(p):p.read_text() for p in [pathlib.Path("/AGENTS.md"),pathlib.Path("/dev/AGENTS.md")] if p.is_file()}
if instructions:
    emit({"phase":"LOCAL_INSTRUCTIONS","instructions":instructions});raise RuntimeError("Read the original directory instructions before starting this work order")
safe_order={key:value for key,value in ORDER.items() if key not in {"workshare","browser_support"}}
safe_order["browser_support"]={key:value for key,value in ORDER["browser_support"].items() if key!="files"}
safe_order["browser_support"]["files"]=[{key:value for key,value in item.items() if key!="base64"} for item in ORDER["browser_support"]["files"]]
safe_order["workshare"]={key:value for key,value in ORDER["workshare"].items() if key!="base64"}
jsonwrite(ROOT/"work-order.json",safe_order)
jsonwrite(ROOT/"previous-attempt.json",ORDER["previous_attempt"])
emit({"phase":"NATIVE_START","operation_id":ORDER["operation_id"],"root":str(ROOT),"free_bytes":os.statvfs(ROOT).f_bavail*os.statvfs(ROOT).f_frsize,"source_commit":ORDER["source_commit"]})
outcome={"schema":"lake-county.full-native-outcome/v1","operation_id":ORDER["operation_id"],"source_operation":ORDER["source_operation"],"started_at_utc":now(),"complete":False}
result=None;saved=False
preservation_state={"current_version_number":ORDER["previous_attempt"]["current_version_number"],
                    "number":0,"blocked":False,"last":None,"records":[]}
try:
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as executor:
        futures=[executor.submit(fetch,item) for item in ORDER["files"]+[ORDER["packet"]]+ORDER.get("support_sources",[])]
        for n,future in enumerate(concurrent.futures.as_completed(futures),1):
            path,data=future.result();write(path,data)
            if n%4==0:emit({"phase":"SOURCE_FILES_RETAINED","files":n,"total":len(futures)})
    packet_path=ROOT/ORDER["packet"]["path"];packet=json.loads(packet_path.read_text())
    collector=packet["collector"]["content"].encode()
    if len(collector)!=ORDER["collector"]["bytes"] or hashlib.sha256(collector).hexdigest()!=ORDER["collector"]["sha256"]:raise ValueError("The original embedded collector differs")
    write(ROOT/"source"/"collector.py",collector)
    source=ORDER["workshare"];body=base64.b64decode(source["base64"],validate=True)
    if len(body)!=source["bytes"] or hashlib.sha256(body).hexdigest()!=source["sha256"]:raise ValueError("The original private workshare source differs")
    workshare=ROOT/source["path"];write(workshare,body)
    jsonwrite(ROOT/"verification"/"native-semantic-evidence.json",ORDER["semantic"])
    for path in sorted(APP.rglob("*.py")):ast.parse(path.read_text(encoding="utf-8"),filename=str(path))
    ast.parse(collector,filename="source/collector.py")
    node=os.environ.get("CODEX_PRIMARY_RUNTIME_NODE") or shutil.which("node")
    for relative in ["web/app.js","operate_browser.mjs"]:subprocess.run([node,"--check",str(APP/relative)],check=True)
    emit({"phase":"COMPLETE_SOURCE_VERIFIED","files":len(ORDER["files"]),"python_syntax":True,"node_syntax":True,"retained_native_semantic_assertions":len(ORDER["semantic"]["result"]["assertions"])})
    archive_source_checkpoint(ORDER.get("resume_checkpoint"))
    source_result=capture()
    outcome["source_capture"]=source_result["last"]
    save_delivery("completed_public_source_before_browser")
    runtime=browser()
    emit({"phase":"BROWSER_READY","runtime":runtime})
    emit({"phase":"SOURCE_AND_BROWSER_READY","runtime":runtime,"capture":source_result["last"]})
    command=[sys.executable,"-B",str(APP/"commission_public.py"),
        "--source-root",str(ROOT/"public-source"),"--source-packet",str(packet_path),
        "--source-packet-sha256",ORDER["packet"]["sha256"],"--source-packet-bytes",str(ORDER["packet"]["bytes"]),
        "--workshare-source",str(workshare),"--workshare-sha256",source["sha256"],"--workshare-bytes",str(source["bytes"]),
        "--workspace",str(ROOT/"workspace"),"--output",str(ROOT/"operating"),"--receiving",str(ROOT/"received"),
        "--actor",ORDER["actor"],"--operation",ORDER["operation_id"],
        "--node",runtime["node"],"--playwright-module",runtime["playwright_module"],"--browser-executable",runtime["browser_executable"]]
    logged("application",command)
    result=json.loads((ROOT/"operating"/"result.json").read_text())
    replay=logged("original-replay",command)
    if json.loads((ROOT/"operating"/"result.json").read_text())!=result:raise RuntimeError("The complete original operating result changed on replay")
    outcome.update(complete=True,workspace_id=result["workspace_id"],publication=result["publication"],receiving=result["receiving"],editions=result["editions"],browser_screens=len(result["browser_review"]["screens"]),browser_page_errors=result["browser_review"]["page_errors"],browser_overflow=result["browser_review"]["overflow"],original_replay=True)
    emit({"phase":"COMPLETE_NATIVE_OPERATION","result":outcome})
except Exception as error:
    outcome.update(error_type=type(error).__name__,error=str(error),traceback=traceback.format_exc())
    emit({"phase":"OPERATING_FINDING","outcome":outcome})
finally:
    outcome["finished_at_utc"]=now();jsonwrite(ROOT/"native-outcome.json",outcome)
    try:
        final_save=save_delivery("complete_operating_result" if outcome["complete"] else "retained_operating_finding",final=True)
        saved=True
    except Exception as error:
        emit({"phase":"DELIVERY_SAVE_BLOCKED","error":str(error),"outcome":outcome,
              "last_saved":preservation_state["last"],"original_intent":preservation_state.get("last_intent")})
emit({"phase":"PREVIEW_READY","root":str(ROOT),"complete":outcome["complete"],"saved":saved})
for line in sys.stdin:
    try:
        request=json.loads(line)
        if request.get("action")=="finish":break
        if request.get("action")=="preview":
            if not result or not result.get("browser_review"):raise RuntimeError("No completed browser review exists")
            index=request["index"]
            if not isinstance(index,int) or isinstance(index,bool) or not 0<=index<len(result["browser_review"]["screens"]):raise ValueError("Select an original screenshot index")
            from PIL import Image
            path=pathlib.Path(result["browser_review"]["screens"][index]["path"])
            picture=Image.open(path).convert("RGB")
            original_size=list(picture.size)
            if picture.width>1280:picture=picture.resize((1280,max(1,round(picture.height*1280/picture.width))))
            segment=request.get("segment",0);height=1100;segments=(picture.height+height-1)//height
            if type(segment) is not int or not 0<=segment<segments:raise ValueError("Select an original screenshot preview segment")
            preview_region=[0,segment*height,picture.width,min(picture.height,(segment+1)*height)]
            picture=picture.crop(preview_region)
            output=io.BytesIO();picture.save(output,format="JPEG",quality=82)
            encoded_image=base64.b64encode(output.getvalue()).decode()
            frame=request.get("frame",0);size=24000;count=(len(encoded_image)+size-1)//size
            if type(frame) is not int or not 0<=frame<count:raise ValueError("Select an original image frame")
            emit({"phase":"PREVIEW_FRAME","index":index,"frame":frame,"frames":count,"segment":segment,"segments":segments,"preview_region":preview_region,"original_size":original_size,"source":result["browser_review"]["screens"][index],"mime":"image/jpeg","base64":encoded_image[frame*size:(frame+1)*size]})
        elif request.get("action")=="native_continuation":
            if request.get("operation_id")!=ORDER["operation_id"]:raise ValueError("Retain the original operating identity")
            raw=base64.b64decode(request["code_base64"],validate=True)
            if len(raw)!=request["bytes"] or hashlib.sha256(raw).hexdigest()!=request["sha256"] or len(raw)>131072:raise ValueError("The complete selected continuation bytes differ")
            continuations=ROOT/"native-continuations";continuations.mkdir(mode=0o700,exist_ok=True)
            selected=continuations/("continuation-"+request["sha256"]+".py")
            write(selected,raw)
            ast.parse(raw,filename=str(selected))
            emit({"phase":"CONTINUATION_RETAINED","path":str(selected),"bytes":len(raw),"sha256":request["sha256"]})
            exec(compile(raw,str(selected),"exec"),globals(),globals())
        elif request.get("action")=="diagnostics":
            log_root=ROOT/"native-logs"
            logs={p.name:p.read_text(errors="replace")[-16000:] for p in sorted(log_root.glob("*.log"))}
            emit({"phase":"DIAGNOSTICS","outcome":outcome,"logs":logs,"source_seal_exists":(ROOT/"public-source"/"capture-complete.json").exists(),"result":result})
        elif request.get("action")=="details":
            emit({"phase":"DETAILS","outcome":outcome,"result":result,"source_manifest":json.loads((ROOT/"public-source"/"capture-manifest.json").read_text()) if (ROOT/"public-source"/"capture-manifest.json").exists() else None})
        else:raise ValueError("Unknown original receiving inspection")
    except Exception as error:emit({"phase":"INSPECTION_ERROR","error":str(error)})
