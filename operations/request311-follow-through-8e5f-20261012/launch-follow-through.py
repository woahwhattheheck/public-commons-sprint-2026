#!/usr/bin/env python3
"""Operate complete original municipal sources and return their editable native workspace."""
import argparse,base64,datetime,hashlib,json,os,pathlib,re,shutil,subprocess,sys,tempfile,termios,traceback,zipfile

def stamp():return datetime.datetime.now(datetime.timezone.utc).isoformat()
def emit(name,value):print(name+" "+json.dumps(value,ensure_ascii=False,separators=(",",":")),flush=True)
def private_write(path,data):
    path.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
    descriptor=os.open(path,os.O_CREAT|os.O_EXCL|os.O_WRONLY,0o600)
    with os.fdopen(descriptor,"wb") as stream:stream.write(data);stream.flush();os.fsync(stream.fileno())
def safe_path(root,name):
    if not isinstance(name,str) or not name or "\\" in name or "\0" in name:raise ValueError("Invalid original relative file path.")
    relative=pathlib.PurePosixPath(name)
    if relative.is_absolute() or ".." in relative.parts or str(relative)!=name:raise ValueError("Use the exact original relative file path.")
    return root.joinpath(*relative.parts)
def text_bytes(record):
    if not isinstance(record.get("content"),str):raise ValueError("The complete original UTF-8 file body is required.")
    data=record["content"].encode("utf-8")
    if len(data)!=record.get("bytes") or hashlib.sha256(data).hexdigest()!=record.get("sha256"):raise ValueError("Original file bytes differ: "+record.get("path",""))
    if record.get("gitBlob") and hashlib.sha1(b"blob "+str(len(data)).encode("ascii")+b"\0"+data).hexdigest()!=record["gitBlob"]:raise ValueError("Original Git source differs: "+record["path"])
    return data
def fsync_file(path):
    with path.open("rb") as stream:os.fsync(stream.fileno())
def main():
    parser=argparse.ArgumentParser(description=__doc__)
    group=parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--input")
    group.add_argument("--stdin-bytes",type=int)
    parser.add_argument("--stdin-sha256")
    parser.add_argument("--parent",default="/dev")
    parser.add_argument("--node")
    parser.add_argument("--playwright-module")
    parser.add_argument("--chromium")
    parser.add_argument("--wait-for-delivery",action="store_true")
    parser.add_argument("--retain-library",action="store_true")
    args=parser.parse_args()
    if os.isatty(0):
        settings=termios.tcgetattr(0);settings[3]&=~(termios.ECHO|termios.ICANON);settings[6][termios.VMIN]=1;settings[6][termios.VTIME]=0;termios.tcsetattr(0,termios.TCSANOW,settings)
    parent=pathlib.Path(args.parent).resolve(strict=True)
    root=pathlib.Path(tempfile.mkdtemp(prefix="request311-follow-through-8e5f-",dir=parent));os.chmod(root,0o700)
    if args.input:
        incoming=pathlib.Path(args.input).resolve(strict=True).read_bytes()
        if len(incoming)>32*1024*1024:raise ValueError("The complete operating source input exceeds 32 MiB.")
        private_write(root/"original-operating-input.json",incoming)
    else:
        if args.stdin_bytes is None or args.stdin_bytes<1 or args.stdin_bytes>32*1024*1024 or not re.fullmatch(r"[0-9a-f]{64}",args.stdin_sha256 or ""):raise ValueError("Use the exact complete input byte count and SHA-256.")
        emit("FOLLOW_THROUGH_SOURCE_READY",{"directory":str(root),"bytes":args.stdin_bytes,"sha256":args.stdin_sha256})
        digest=hashlib.sha256();received=0;destination=root/"original-operating-input.json"
        with destination.open("xb") as stream:
            os.chmod(destination,0o600)
            while received<args.stdin_bytes:
                line=sys.stdin.readline(65537)
                if not line or len(line)>65536 or not line.endswith("\n"):raise ValueError("The complete original source frame was interrupted.")
                block=base64.b64decode(line.strip(),validate=True);received+=len(block)
                if received>args.stdin_bytes:raise ValueError("The source input has bytes beyond its declared complete length.")
                stream.write(block);digest.update(block)
            stream.flush();os.fsync(stream.fileno())
        if digest.hexdigest()!=args.stdin_sha256:raise ValueError("The complete source input changed during receiving.")
    with (root/"original-operating-input.json").open(encoding="utf-8") as stream:bundle=json.load(stream)
    if bundle.get("schema")!="commons.follow-through.native-operating-source.v1":raise ValueError("Use the complete original municipal operating source.")
    source_root=root/"source";original_root=root/"original";support=root/"support";temporary=root/"tmp"
    for path in (source_root,original_root,support,temporary):path.mkdir(mode=0o700)
    names=set();manifest=[]
    for section,destination in (("sourceFiles",source_root),("originalFiles",original_root),("supportFiles",support)):
        for record in bundle.get(section,[]):
            name=section+":"+record["path"]
            if name in names:raise ValueError("A complete source path is repeated.")
            names.add(name);data=text_bytes(record);path=safe_path(destination,record["path"]);private_write(path,data)
            manifest.append({k:record[k] for k in ("path","bytes","sha256","gitBlob") if k in record}|{"section":section})
    node=args.node or os.environ.get("CODEX_PRIMARY_RUNTIME_NODE") or shutil.which("node")
    if not node or not pathlib.Path(node).is_file():raise ValueError("Select an installed native Node runtime.")
    modules=os.environ.get("CODEX_PRIMARY_RUNTIME_NODE_MODULES")
    requested_module=args.playwright_module or bundle.get("runtime",{}).get("playwrightModule")
    selector="const target=process.argv[1]||((process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES||'')+'/playwright');const p=require(target);console.log(JSON.stringify({node:process.execPath,playwrightModule:require.resolve(target),chromiumExecutablePath:p.chromium.executablePath(),version:process.version}));"
    selected=subprocess.run([node,"-e",selector,requested_module or ""],capture_output=True,text=True,check=True)
    runtime=json.loads(selected.stdout);runtime["chromiumExecutablePath"]=args.chromium or runtime["chromiumExecutablePath"]
    if not pathlib.Path(runtime["chromiumExecutablePath"]).is_file():raise ValueError("Select the installed Chromium executable.")
    private_write(root/"runtime.json",(json.dumps(runtime,indent=2)+"\n").encode())
    config=bundle["configuration"]
    config["product"]=str(safe_path(source_root,bundle["productRoot"]))
    config["output"]=str(root/"municipal-desk")
    config["playwrightModule"]=runtime["playwrightModule"]
    config["chromiumExecutablePath"]=runtime["chromiumExecutablePath"]
    config["productEdition"]=bundle["productEdition"]
    for scenario in config["scenarios"]:
        for item in scenario["sources"]:
            item["path"]=str(safe_path(original_root,item["path"]))
            if item.get("metadataPath"):item["metadataPath"]=str(safe_path(original_root,item["metadataPath"]))
    config_path=root/"run-config.json";private_write(config_path,(json.dumps(config,ensure_ascii=False,indent=2)+"\n").encode())
    operation=safe_path(source_root,bundle["operationPath"]);sink=safe_path(source_root,bundle["sinkPath"])
    compile(sink.read_bytes(),str(sink),"exec")
    checks=[]
    for path in [operation,safe_path(source_root,bundle["productRoot"]+"/app.mjs")]:
        result=subprocess.run([node,"--check",str(path)],capture_output=True,text=True)
        checks.append({"path":str(path.relative_to(source_root)),"exitCode":result.returncode,"stdout":result.stdout,"stderr":result.stderr})
        if result.returncode:raise RuntimeError("The selected native JavaScript source did not parse: "+json.dumps(checks[-1]))
    private_write(root/"bundle-manifest.json",(json.dumps({"schema":bundle["schema"],"createdAt":stamp(),"productEdition":bundle["productEdition"],"files":manifest,"nativeChecks":checks},ensure_ascii=False,indent=2)+"\n").encode())
    emit("FOLLOW_THROUGH_NATIVE_START",{"directory":str(root),"runtime":runtime,"sourceFiles":len(bundle["sourceFiles"]),"originalFiles":len(bundle["originalFiles"]),"scenarios":[{"key":s["key"],"rows":s["rows"]} for s in config["scenarios"]]})
    environment=dict(os.environ);environment["TMPDIR"]=str(temporary);environment["NODE_OPTIONS"]="--max-old-space-size=192"
    with (root/"native-output.log").open("x",encoding="utf-8") as log:
        os.chmod(root/"native-output.log",0o600)
        process=subprocess.Popen([node,str(operation),str(config_path)],cwd=root,env=environment,stdin=sys.stdin,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True,bufsize=1)
        for line in process.stdout:
            log.write(line);log.flush();print(line,end="",flush=True)
            if line.startswith("FOLLOW_THROUGH_PHASE "):os.fsync(log.fileno())
        code=process.wait();log.flush();os.fsync(log.fileno())
    operation_result=root/"municipal-desk"/"operation.json"
    result=json.loads(operation_result.read_text("utf-8")) if operation_result.exists() else {"state":"failed","error":{"message":"The native operation ended before returning its saved operating result."}}
    emit("FOLLOW_THROUGH_NATIVE_RESULT",{"directory":str(root),"exitCode":code,"state":result.get("state"),"scenarios":result.get("scenarios",[]),"error":result.get("error"),"files":len(result.get("files",[]))})
    archive=root/"request311-municipal-follow-through-20261012.zip"
    file_roots=[source_root,original_root,root/"municipal-desk"]
    entries=[]
    for base in file_roots:
        if base.exists():
            for path in sorted(base.rglob("*")):
                if path.is_file() and "screenshots" not in path.relative_to(base).parts:entries.append(path)
    entries += [root/name for name in ("runtime.json","run-config.json","bundle-manifest.json","native-output.log") if (root/name).is_file()]
    with zipfile.ZipFile(archive,"x",compression=zipfile.ZIP_DEFLATED,compresslevel=6) as zipped:
        for path in entries:zipped.write(path,str(path.relative_to(root)))
    os.chmod(archive,0o600);fsync_file(archive)
    with archive.open("rb") as stream:archive_hash=hashlib.file_digest(stream,"sha256").hexdigest()
    descriptor={"schema":"commons.native.archive.v1","path":str(archive),"filename":archive.name,"bytes":archive.stat().st_size,"sha256":archive_hash,"jobId":result.get("runId"),"phase":"complete" if result.get("state")=="passed" else "operating-continuation"}
    descriptor_path=root/"archive-descriptor.json";private_write(descriptor_path,(json.dumps(descriptor,indent=2)+"\n").encode())
    emit("FOLLOW_THROUGH_ARCHIVE_SAVED",{**descriptor,"members":len(entries),"state":result.get("state"),"descriptorPath":str(descriptor_path)})
    if args.wait_for_delivery:
        delivered=subprocess.run([sys.executable,"-u",str(sink),"--descriptor",str(descriptor_path)],stdin=sys.stdin)
        if delivered.returncode:raise RuntimeError("The complete archive remains at its original prepared-file continuation.")
    if args.retain_library:
        emit("FOLLOW_THROUGH_LIBRARY_READY",{"path":str(archive),"bytes":descriptor["bytes"],"sha256":archive_hash})
        command=json.loads(sys.stdin.readline(65537))
        if command.get("op")!="library" or not isinstance(command.get("libraryFileId"),str):raise ValueError("Use the returned retained file identity for this original archive.")
        helper=support/"library_file_transfer.py"
        writeback=subprocess.run([sys.executable,str(helper),"apply-xattrs",str(archive),command["libraryFileId"]],input=json.dumps(command.get("xattrs",[])),capture_output=True,text=True)
        emit("FOLLOW_THROUGH_LIBRARY_METADATA",{"exitCode":writeback.returncode,"stdout":writeback.stdout,"stderr":writeback.stderr})
        if writeback.returncode:raise RuntimeError("The retained archive exists, but its local identity metadata could not be saved.")
    emit("FOLLOW_THROUGH_NATIVE_FINISHED",{"directory":str(root),"state":result.get("state"),"exitCode":code,"archive":descriptor})
    return code
if __name__=="__main__":
    try:sys.exit(main())
    except Exception as error:
        emit("FOLLOW_THROUGH_NATIVE_ERROR",{"errorType":type(error).__name__,"message":str(error),"stack":traceback.format_exc()})
        sys.exit(1)
