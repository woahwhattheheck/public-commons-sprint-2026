import os,sys,json,hashlib,base64,subprocess,pathlib,shutil,zipfile,datetime,termios,tty
os.umask(0o077)
OP="SCF-FRED-RECURRING-BRIEFINGS-E2747-20261012"
EXPECTED_BYTES=1355707
EXPECTED_SHA="e921e2113d7ad10bf923e38bd24371e8cf962e5fe9097a9b741368c304fd88c3"
EXPECTED_GIT="36b7e9279002dfd41a7ade2f249f2b27ed4a4d9e"
fd=sys.stdin.fileno()
terminal=termios.tcgetattr(fd)
tty.setraw(fd)
def emit(value):
    sys.stdout.write(json.dumps(value,separators=(",",":"))+"\n")
    sys.stdout.flush()
def now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()
def digest(data):
    return hashlib.sha256(data).hexdigest()
def gitblob(data):
    return hashlib.sha1(("blob "+str(len(data))+"\0").encode()+data).hexdigest()
try:
    node=os.environ.get("CODEX_PRIMARY_RUNTIME_NODE") or "/opt/codex/runtimes/codex-primary-runtime/dependencies/node/bin/node"
    version=subprocess.check_output([node,"--version"],text=True).strip()
    parts=tuple(int(v) for v in version.lstrip("v").split(".")[:3])
    if parts<(22,16,0): raise RuntimeError("Original operation requires Node 22.16 or newer; installed "+version)
    flock=shutil.which("flock")
    if not flock: raise RuntimeError("Original operation requires the existing util-linux flock")
    base=next((pathlib.Path(p) for p in ["/dev/shm","/dev"] if pathlib.Path(p).is_dir() and shutil.disk_usage(p).free>=12*1024*1024),None)
    if base is None: raise RuntimeError("No owned native carrier has 12 MiB available for the complete receiving")
    root=base/"fred-e2747-9b2c-20261012"
    if root.exists(): raise RuntimeError("The original task directory already exists; reconcile it before continuing: "+str(root))
    emit({"phase":"ready-for-complete-source","operationId":OP,"expectedBytes":EXPECTED_BYTES,"node":version,"flock":flock,"root":str(root),"freeBytes":shutil.disk_usage(base).free})
    remaining=EXPECTED_BYTES
    chunks=[]
    while remaining:
        chunk=os.read(fd,min(65536,remaining))
        if not chunk: raise RuntimeError("The original source stream ended early")
        chunks.append(chunk)
        remaining-=len(chunk)
    payload=b"".join(chunks)
    if digest(payload)!=EXPECTED_SHA or gitblob(payload)!=EXPECTED_GIT:
        raise RuntimeError("The complete source carrier differs from its retained Git identity")
    packet=json.loads(payload)
    if packet["operationId"]!=OP or len(packet["files"])!=68:
        raise RuntimeError("Wrong original source operation")
    root.mkdir(mode=0o700)
    source=root/"source"
    source.mkdir(mode=0o700)
    seen=set()
    source_bytes=0
    for item in packet["files"]:
        rel=pathlib.PurePosixPath(item["path"])
        if rel.is_absolute() or ".." in rel.parts or "\\" in item["path"] or str(rel) in seen:
            raise RuntimeError("Unsafe or duplicate source path")
        seen.add(str(rel))
        data=base64.b64decode(item["content_base64"],validate=True)
        if len(data)!=item["bytes"] or digest(data)!=item["sha256"] or gitblob(data)!=item["git_blob_sha"]:
            raise RuntimeError("Original source identity mismatch: "+str(rel))
        target=source.joinpath(*rel.parts)
        target.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
        with target.open("xb") as handle: handle.write(data)
        source_bytes+=len(data)
    if source_bytes!=988542: raise RuntimeError("The complete original source byte count differs")
    (root/"original-source-manifest.json").write_text(json.dumps(packet["manifest"],ensure_ascii=False,indent=2)+"\n")
    work=root/"work"
    prefix=source/"stellar/scf-starforge-20261009/sf30-seller-sdk/fred"
    command=[node,str(source/"operations/fred-recurring-briefings-e2747-20261012/native-journey.mjs"),
      "--project-module",str(prefix/"project.mjs"),"--expected-project-blob","8ee1b1c6d54ff711a42328869c1bb71764017057",
      "--capture",str(prefix/"examples/briefing-20261012/macro-source.capture.json"),
      "--briefing",str(prefix/"examples/macro-briefing.json"),
      "--review",str(prefix/"examples/briefing-20261012/review.json"),
      "--work",str(work)]
    started=now()
    emit({"phase":"native-journey-started","operationId":OP,"startedAt":started,"sourceFiles":len(seen),"sourceBytes":source_bytes,"work":str(work)})
    completed=subprocess.run(command,cwd=source,capture_output=True)
    (root/"native-stdout.jsonl").write_bytes(completed.stdout)
    (root/"native-stderr.txt").write_bytes(completed.stderr)
    result_path=work/"outputs/native-result.json"
    native_result=json.loads(result_path.read_text()) if result_path.exists() else None
    record={"operationId":OP,"startedAt":started,"completedAt":now(),"exitCode":completed.returncode,"runtime":{"node":version,"executable":node,"flock":flock},"command":command,"sourcePacket":{"gitBlob":EXPECTED_GIT,"sha256":EXPECTED_SHA,"bytes":len(payload),"files":len(seen),"sourceBytes":source_bytes},"root":str(root)}
    (root/"native-execution.json").write_text(json.dumps(record,indent=2)+"\n")
    archive=base/"fred-recurring-briefings-20261012.zip"
    with zipfile.ZipFile(archive,"x",compression=zipfile.ZIP_DEFLATED,compresslevel=6) as output:
        for path in sorted(root.rglob("*")):
            if path.is_file():
                output.write(path,str(path.relative_to(root)))
    archive_bytes=archive.read_bytes()
    summary={"phase":"native-journey-complete","operationId":OP,"exitCode":completed.returncode,"startedAt":started,"completedAt":record["completedAt"],"root":str(root),"archive":{"path":str(archive),"bytes":len(archive_bytes),"sha256":digest(archive_bytes),"gitBlob":gitblob(archive_bytes)},"stdout":completed.stdout.decode(errors="replace"),"stderr":completed.stderr.decode(errors="replace")}
    if native_result:
        summary["result"]={key:native_result.get(key) for key in ["schema","completedAt","runtime","source","projectId","initialReview","template","saved","files","bundle","received","receivedRevision","receivedFiles"]}
    emit(summary)
    while True:
        request=sys.stdin.buffer.readline()
        if not request: break
        words=request.decode().strip().split()
        if not words: continue
        if words[0]=="GET" and len(words)==3:
            offset=int(words[1]); length=int(words[2])
            if offset<0 or length<1 or length>49152: raise RuntimeError("Invalid archive range")
            block=archive_bytes[offset:offset+length]
            emit({"phase":"archive-chunk","offset":offset,"bytes":len(block),"sha256":digest(block),"content_base64":base64.b64encode(block).decode()})
        elif words[0]=="RESULT":
            emit({"phase":"complete-native-result","result":native_result})
        elif words[0]=="QUIT":
            break
        else: emit({"error":"Use GET OFFSET LENGTH, RESULT or QUIT"})
except Exception as error:
    emit({"phase":"native-carrier-error","operationId":OP,"error":str(error),"type":type(error).__name__})
    sys.exitCode=1
finally:
    termios.tcsetattr(fd,termios.TCSANOW,terminal)
