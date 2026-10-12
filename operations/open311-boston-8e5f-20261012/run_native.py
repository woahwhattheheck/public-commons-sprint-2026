import sys,tty,json,tempfile,pathlib,hashlib,subprocess,os,base64,zipfile,io,gzip,traceback,re,urllib.request,urllib.parse,urllib.error,datetime
if sys.stdin.isatty():
    tty.setraw(sys.stdin.fileno())
print("OPEN311_NATIVE_READY",flush=True)
packet=json.loads(sys.stdin.buffer.readline().decode("utf-8"))
native_parent=os.environ.get("OPEN311_NATIVE_PARENT") or "/dev"
root=pathlib.Path(tempfile.mkdtemp(prefix="open311-collection-8e5f-",dir=native_parent))
os.chmod(root,0o700)
repo=root/"source"
repo.mkdir(mode=0o700)
reporting_operations={}
archive_uploads={}
archive_filename=packet.get("archiveFilename","helsinki-collection-reporting-workspace-8e5f-20261012.zip")
if not isinstance(archive_filename,str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,180}\.zip",archive_filename):
    raise RuntimeError("Use a plain ZIP archive filename.")
manifest=[]
zipbytes=b""
node=os.environ.get("CODEX_PRIMARY_RUNTIME_NODE") or "/opt/codex/runtimes/codex-primary-runtime/dependencies/node/bin/node"
modules=os.environ.get("CODEX_PRIMARY_RUNTIME_NODE_MODULES") or "/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules"
runtimeenv=os.environ.copy()
runtimeenv["TMPDIR"]=str(root);runtimeenv["TMP"]=str(root);runtimeenv["TEMP"]=str(root)
def canonical(value):
    return json.dumps(value,ensure_ascii=False,sort_keys=True,separators=(",",":"))
def write_private(path,data):
    path.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
    with path.open("xb") as stream:
        stream.write(data if isinstance(data,bytes) else data.encode("utf-8"))
    os.chmod(path,0o600)
def materialize(entries,destination):
    result=[];seen=set()
    for entry in entries:
        name=entry["path"]
        if not isinstance(name,str) or not name or "\\" in name or "\0" in name:
            raise RuntimeError("Invalid source path")
        relative=pathlib.PurePosixPath(name)
        if relative.is_absolute() or ".." in relative.parts or str(relative)!=name or name in seen:
            raise RuntimeError("Invalid or repeated source path: "+name)
        seen.add(name)
        data=entry["content"].encode("utf-8")
        gitsha=hashlib.sha1(b"blob "+str(len(data)).encode()+b"\0"+data).hexdigest()
        sha=hashlib.sha256(data).hexdigest()
        if entry.get("gitBlob") and entry["gitBlob"]!=gitsha:
            raise RuntimeError("Git blob mismatch "+name+" expected "+entry["gitBlob"]+" actual "+gitsha)
        if entry.get("sha256") and entry["sha256"]!=sha:
            raise RuntimeError("SHA256 mismatch "+name)
        if entry.get("bytes") is not None and entry["bytes"]!=len(data):
            raise RuntimeError("Byte count mismatch "+name)
        path=destination/pathlib.Path(*relative.parts)
        if path.exists():
            if path.is_symlink() or not path.is_file() or path.read_bytes()!=data:
                raise RuntimeError("Source preimage differs: "+name)
        else:
            write_private(path,data)
        result.append({"path":name,"bytes":len(data),"sha256":sha,"gitBlob":gitsha})
    return result
def checked_modules(source_root,entries,runner):
    paths=[source_root/entry["path"] for entry in entries if entry["path"].endswith(".mjs")]+[runner]
    for path in paths:
        checked=subprocess.run([node,"--check",str(path)],capture_output=True,text=True,env=runtimeenv,timeout=15)
        if checked.returncode:
            raise RuntimeError("Native syntax failed "+str(path)+"\n"+checked.stderr)
    return len(paths)
def run_node(runner,configuration,timeout):
    try:
        result=subprocess.run([node,"--max-old-space-size=192",str(runner),str(configuration)],
            capture_output=True,text=True,env=runtimeenv,timeout=timeout)
        return {"exitCode":result.returncode,"stdout":result.stdout,"stderr":result.stderr,"timedOut":False}
    except subprocess.TimeoutExpired as error:
        def decoded(value):
            return value.decode("utf-8",errors="replace") if isinstance(value,bytes) else (value or "")
        return {"exitCode":None,"stdout":decoded(error.stdout),"stderr":decoded(error.stderr),
            "timedOut":True,"error":{"name":"TimeoutExpired","message":str(error)}}
    except OSError as error:
        return {"exitCode":None,"stdout":"","stderr":"","timedOut":False,
            "error":{"name":type(error).__name__,"message":str(error)}}
def archive_descriptor():
    return {"filename":archive_filename,
        "bytes":len(zipbytes),"sha256":hashlib.sha256(zipbytes).hexdigest()}
def refresh_archive():
    global zipbytes
    artifact=io.BytesIO()
    with zipfile.ZipFile(artifact,"w",compression=zipfile.ZIP_DEFLATED,compresslevel=9) as archive:
        delivery=root/"delivery"
        if delivery.exists():
            for path in sorted(delivery.rglob("*")):
                if path.is_file():
                    archive.write(path,str(path.relative_to(delivery)))
        archive.writestr("source-manifest.json",json.dumps({"sourceHead":packet["edition"],
            "coreEdition":packet["coreEdition"],"files":manifest},indent=2))
        archive.writestr("commission-collection.mjs",packet["runner"])
        archive.writestr("input/retained-originals.json",canonical(packet["retained"]))
        archive.writestr("input/connection.json",canonical(packet["connection"]))
        for entry in manifest:
            archive.write(repo/entry["path"],"source/"+entry["path"])
        for name in ["collection-stdout.log","collection-stderr.log"]:
            if (root/name).exists():
                archive.write(root/name,name)
        index=[]
        for request_id,operation in reporting_operations.items():
            directory=pathlib.Path(operation["directory"])
            index.append({key:value for key,value in operation.items() if key!="directory"})
            if directory.exists():
                for path in sorted(directory.rglob("*")):
                    if path.is_file():
                        archive.write(path,"reporting/"+request_id+"/"+str(path.relative_to(directory)))
        archive.writestr("reporting-index.json",json.dumps(index,indent=2))
    zipbytes=artifact.getvalue()
    return archive_descriptor()
def reporting(command):
    request_id=command.get("requestId")
    if not isinstance(request_id,str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_-]{0,127}",request_id):
        raise RuntimeError("Use a stable UUID or an alphanumeric reporting requestId.")
    payload={"files":command.get("files"),"runner":command.get("runner"),"options":command.get("options",{})}
    if not isinstance(payload["files"],list) or not isinstance(payload["runner"],str):
        raise RuntimeError("Supply complete reporting files and the reporting runner.")
    payload_hash=hashlib.sha256(canonical(payload).encode("utf-8")).hexdigest()
    if request_id in reporting_operations:
        operation=reporting_operations[request_id]
        if operation["payloadHash"]!=payload_hash:
            raise RuntimeError("REPORTING_REQUEST_ID_REUSED: the retained requestId has different content.")
        print("OPEN311_REPORTING_RESULT "+json.dumps({"requestId":request_id,"replayed":True,
            "operation":operation,"archive":archive_descriptor()},separators=(",",":")),flush=True)
        return
    directory=root/("reporting-"+request_id)
    directory.mkdir(mode=0o700)
    operation={"requestId":request_id,"payloadHash":payload_hash,"state":"RUNNING",
        "directory":str(directory),"result":None}
    reporting_operations[request_id]=operation
    write_private(directory/"intent.json",canonical({"requestId":request_id,"payloadHash":payload_hash,"payload":payload}))
    try:
        stage_repo=directory/"source";stage_repo.mkdir(mode=0o700)
        stage_base=materialize(packet["files"],stage_repo)
        additions=materialize(payload["files"],stage_repo)
        stage_manifest={entry["path"]:entry for entry in stage_base+additions}
        write_private(directory/"source-manifest.json",canonical({"originalSourceHead":packet["edition"],
            "requestId":request_id,"payloadHash":payload_hash,"files":list(stage_manifest.values())}))
        report_runner=directory/"reporting-journey.mjs"
        write_private(report_runner,payload["runner"])
        report_output=directory/"delivery"
        report_config=dict(config)
        report_config.update({"product":config["product"],"collectionOutput":config["output"],
            "reportingProduct":str(stage_repo/"stellar/scf-starforge-20261009/sf30-seller-sdk/open311/reporting"),
            "output":str(report_output),"originalConfig":str(configpath),"requestId":request_id,
            "reportingSourceFiles":additions,"options":payload["options"]})
        report_config_path=directory/"reporting-job.json"
        write_private(report_config_path,canonical(report_config))
        syntax_count=checked_modules(stage_repo,additions,report_runner)
        print("OPEN311_REPORTING_RUNNING "+json.dumps({"requestId":request_id,
            "directory":str(directory),"syntaxModules":syntax_count}),flush=True)
        run=run_node(report_runner,report_config_path,300)
        write_private(directory/"stdout.log",run["stdout"])
        write_private(directory/"stderr.log",run["stderr"])
        report_journey_path=report_output/"journey.json"
        report_journey=json.loads(report_journey_path.read_text()) if report_journey_path.exists() else None
        state=report_journey.get("state") if report_journey else ("completed" if run["exitCode"]==0 else "failed")
        operation["result"]={"state":state,"exitCode":run["exitCode"],"timedOut":run["timedOut"],
            "output":str(report_output),"journey":report_journey,"stdout":run["stdout"][-12000:],
            "stderr":run["stderr"][-12000:],"error":run.get("error")}
        operation["state"]="COMPLETE" if run["exitCode"]==0 and state not in ["failed","running"] else "FAILED"
    except Exception as error:
        operation["state"]="FAILED"
        operation["result"]={"state":"failed","error":{"name":type(error).__name__,
            "message":str(error),"traceback":traceback.format_exc()}}
    write_private(directory/"operation-result.json",canonical(operation))
    refreshed=refresh_archive()
    print("OPEN311_REPORTING_RESULT "+json.dumps({"requestId":request_id,"replayed":False,
        "operation":operation,"archive":refreshed},separators=(",",":")),flush=True)
def upload_archive(command):
    upload_id=command.get("uploadId")
    target=command.get("uploadUrl")
    if not isinstance(upload_id,str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_-]{0,127}",upload_id):
        raise RuntimeError("Use the exact prepared provider upload ID.")
    if not isinstance(target,str):
        raise RuntimeError("Supply the complete original prepared upload URL.")
    parsed=urllib.parse.urlsplit(target)
    if parsed.scheme!="https" or not parsed.hostname or parsed.username or parsed.password or parsed.fragment:
        raise RuntimeError("Use the exact prepared HTTPS upload URL.")
    descriptor=archive_descriptor()
    if command.get("archiveSha256")!=descriptor["sha256"] or command.get("bytes")!=descriptor["bytes"]:
        raise RuntimeError("Select the exact current complete archive bytes and SHA256.")
    if command.get("method","POST")!="POST":
        raise RuntimeError("This receiver posts raw bytes to the original prepared Slack upload URL.")
    payload_hash=hashlib.sha256(canonical({"uploadId":upload_id,"uploadUrl":target,
        "method":"POST","archive":descriptor}).encode("utf-8")).hexdigest()
    if upload_id in archive_uploads:
        previous=archive_uploads[upload_id]
        if previous["payloadHash"]!=payload_hash:
            raise RuntimeError("UPLOAD_ID_REUSED: retain the original prepared upload and archive selection.")
        print("OPEN311_NATIVE_UPLOADED "+json.dumps({"replayed":True,**previous},separators=(",",":")),flush=True)
        return
    def utcnow():
        return datetime.datetime.now(datetime.timezone.utc).isoformat()
    record={"uploadId":upload_id,"payloadHash":payload_hash,"state":"UPLOADING",
        "archive":descriptor,"startedAt":utcnow(),"status":None,"uncertain":True}
    archive_uploads[upload_id]=record
    operation_dir=root/"archive-uploads"/upload_id
    write_private(operation_dir/"intent.json",canonical({"uploadId":upload_id,"payloadHash":payload_hash,
        "uploadUrl":target,"method":"POST","archive":descriptor}))
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self,request,fp,code,msg,headers,newurl):
            return None
    request=urllib.request.Request(target,data=zipbytes,method="POST",headers={
        "Content-Type":"application/zip","Content-Length":str(len(zipbytes))})
    try:
        with urllib.request.build_opener(NoRedirect()).open(request,timeout=60) as response:
            record["status"]=response.status
            record["providerResponse"]=response.read(4096).decode("utf-8",errors="replace")
            record["state"]="UPLOADED" if 200<=response.status<300 else "REJECTED"
            record["uncertain"]=False
    except urllib.error.HTTPError as error:
        record["status"]=error.code
        record["providerResponse"]=error.read(4096).decode("utf-8",errors="replace")
        record["state"]="REJECTED";record["uncertain"]=False
    except Exception as error:
        record["state"]="UNCERTAIN"
        record["error"]={"name":type(error).__name__,"message":str(error)}
    record["completedAt"]=utcnow()
    write_private(operation_dir/"result.json",canonical(record))
    print("OPEN311_NATIVE_UPLOADED "+json.dumps({"replayed":False,**record},separators=(",",":")),flush=True)

try:
    manifest=materialize(packet["files"],repo)
    runner=root/"commission-collection.mjs"
    write_private(runner,packet["runner"])
    config={"product":str(repo/"stellar/scf-starforge-20261009/sf30-seller-sdk/open311"),
        "output":str(root/"delivery"),"edition":packet["edition"],"coreEdition":packet["coreEdition"],
        "sourceFiles":manifest,"retained":packet["retained"],"connection":packet["connection"],
        "fallbackQuery":packet["fallbackQuery"],"playwrightModule":str(pathlib.Path(modules)/"playwright/index.js")}
    for candidate in [os.environ.get("OPEN311_CHROMIUM_EXECUTABLE"),os.environ.get("CHROMIUM_EXECUTABLE_PATH"),"/usr/bin/chromium","/usr/bin/chromium-browser","/opt/google/chrome/chrome"]:
        if candidate and pathlib.Path(candidate).is_file():
            config["chromiumExecutablePath"]=candidate;break
    configpath=root/"original-job.json"
    write_private(configpath,canonical(config))
    syntax_count=checked_modules(repo,manifest,runner)
    print("OPEN311_NATIVE_RUNNING "+json.dumps({"root":str(root),"files":len(manifest),
        "syntaxModules":syntax_count}),flush=True)
    run=run_node(runner,configpath,240)
    write_private(root/"collection-stdout.log",run["stdout"])
    write_private(root/"collection-stderr.log",run["stderr"])
    journeyfile=root/"delivery/journey.json"
    journey=json.loads(journeyfile.read_text()) if journeyfile.exists() else None
    refreshed=refresh_archive()
    result={"state":journey.get("state") if journey else "failed","exitCode":run["exitCode"],
        "timedOut":run["timedOut"],"root":str(root),"journey":journey,"stdout":run["stdout"][-12000:],
        "stderr":run["stderr"][-12000:],"error":run.get("error"),"archive":refreshed}
    print("OPEN311_NATIVE_RESULT "+json.dumps(result,separators=(",",":")),flush=True)
    while True:
        line=sys.stdin.buffer.readline()
        if not line:
            break
        if not line.strip():
            continue
        try:
            command=json.loads(line.decode("utf-8"))
            if command.get("op")=="finish":
                print("OPEN311_NATIVE_FINISHED",flush=True);break
            if command.get("op")=="reporting":
                reporting(command)
            elif command.get("op")=="upload":
                upload_archive(command)
            elif command.get("op")=="artifact":
                if command.get("archiveSha256") and command["archiveSha256"]!=archive_descriptor()["sha256"]:
                    raise RuntimeError("ARCHIVE_CHANGED: select the latest complete archive SHA256.")
                offset=int(command.get("offset",0));limit=int(command.get("limit",49152))
                if offset<0 or limit<1 or limit>49152 or offset>len(zipbytes):
                    raise RuntimeError("Invalid artifact range")
                chunk=zipbytes[offset:offset+limit]
                print("OPEN311_NATIVE_CHUNK "+json.dumps({"offset":offset,"bytes":len(chunk),
                    "nextOffset":offset+len(chunk) if offset+len(chunk)<len(zipbytes) else None,
                    "archiveSha256":archive_descriptor()["sha256"],
                    "body":base64.b64encode(chunk).decode("ascii")},separators=(",",":")),flush=True)
            elif command.get("op")=="original":
                name=command.get("name")
                allowed={item["name"]:item for item in (journey or {}).get("files",[]) if item["name"].startswith("originals/")}
                if name not in allowed:
                    raise RuntimeError("Unknown original source")
                data=(root/"delivery"/name).read_bytes();compressed=gzip.compress(data,mtime=0)
                print("OPEN311_NATIVE_ORIGINAL "+json.dumps({"name":name,
                    "raw":{"bytes":len(data),"sha256":hashlib.sha256(data).hexdigest()},
                    "gzip":{"bytes":len(compressed),"sha256":hashlib.sha256(compressed).hexdigest(),
                        "body":base64.b64encode(compressed).decode("ascii")}},separators=(",",":")),flush=True)
            else:
                raise RuntimeError("Unknown result operation")
        except Exception as error:
            print("OPEN311_NATIVE_COMMAND_ERROR "+json.dumps({"name":type(error).__name__,
                "message":str(error),"traceback":traceback.format_exc()}),flush=True)
except Exception as error:
    print("OPEN311_NATIVE_ERROR "+json.dumps({"name":type(error).__name__,"message":str(error),
        "root":str(root),"traceback":traceback.format_exc()}),flush=True)
    sys.exit(1)
