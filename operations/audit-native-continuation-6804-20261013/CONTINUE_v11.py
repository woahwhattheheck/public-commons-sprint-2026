#!/usr/bin/env python3
import os,sys,json,pathlib,hashlib,subprocess,fcntl,datetime,traceback,tempfile,argparse,stat
ROOT=pathlib.Path("/dev/shm/audit-exchange-hydration-6804-20261013")
APP=pathlib.Path("/dev/shm/audit-exchange-app-6804-20261012")
CASE=pathlib.Path("/dev/shm/audit-exchange-native-6804-20261012")
RROOT=pathlib.Path("/dev/shm/6804-audit-r-runtime-20261012")
EXPECTED="25148042f9b1721fb0da48fe661f5957272830fe"
OPERATION="AUDIT-EXCHANGE-NATIVE-6804-20261012"
def digest(raw): return hashlib.sha256(raw).hexdigest()
def git(raw): return hashlib.sha1(b"blob "+str(len(raw)).encode()+b"\0"+raw).hexdigest()
def write(path,raw):
    path.parent.mkdir(parents=True,exist_ok=True)
    assert not path.is_symlink(),str(path)
    if path.exists():
        assert path.read_bytes()==raw,str(path)+" original content differs"
        return
    descriptor,candidate_name=tempfile.mkstemp(prefix="."+path.name+".",suffix=".pending",dir=path.parent)
    candidate=pathlib.Path(candidate_name)
    try:
        with os.fdopen(descriptor,"wb") as stream:
            stream.write(raw);stream.flush();os.fsync(stream.fileno())
        try:
            os.link(candidate,path)
        except FileExistsError:
            assert not path.is_symlink(),str(path)
            assert path.read_bytes()==raw,str(path)+" original content differs"
        else:
            parent=os.open(path.parent,os.O_RDONLY|os.O_DIRECTORY)
            try: os.fsync(parent)
            finally: os.close(parent)
    finally:
        candidate.unlink(missing_ok=True)
def raw_json(value): return (json.dumps(value,sort_keys=True,indent=2)+"\n").encode()
def event(**value): print(json.dumps(value),flush=True)
def read_json(path): return json.loads(path.read_bytes())
def native_runtime():
    result={"root":str(RROOT),"launcherExists":(RROOT/"Rscript").is_file()}
    lock=RROOT/"runtime-operation.lock"
    if lock.is_file():
        fd=os.open(lock,os.O_RDONLY|os.O_NOFOLLOW)
        try:
            try: fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB);result["lease"]="unheld"
            except BlockingIOError: result["lease"]="held"
        finally: os.close(fd)
    for name in ("runtime-result.json","runtime-extraction.json","nmecr-original/installed.json"):
        path=RROOT/name
        if path.is_file(): result[name]=read_json(path)
    for logname in ("runtime-install.log","nmecr-install.log","installed-runtime.log"):
        log=RROOT/logname
        if log.is_file(): result[logname]=log.read_text(errors="replace")[-3500:]
    event(event="ORIGINAL_R_RUNTIME",root=str(RROOT),launcherExists=result["launcherExists"],lease=result.get("lease"),installed=result.get("nmecr-original/installed.json",{}).get("status"),packageCommit=result.get("nmecr-original/installed.json",{}).get("commit"))
    return result
def hydrate():
    body=(ROOT/("source-cohort-"+EXPECTED[:8]+".json")).read_bytes()
    assert git(body)==EXPECTED,(git(body),len(body))
    packet=json.loads(body)
    rows=[]
    for entry in packet["files"]:
        relative=pathlib.PurePosixPath(entry["path"])
        assert not relative.is_absolute() and ".." not in relative.parts
        content=entry["content"].encode("utf-8")
        assert git(content)==entry["gitBlobSha1"],entry["path"]
        target=APP/relative
        target.parent.mkdir(parents=True,exist_ok=True)
        assert not target.is_symlink(),str(target)
        if not target.exists() or target.read_bytes()!=content:
            target.write_bytes(content)
        assert target.read_bytes()==content
        rows.append({"path":str(relative),"bytes":len(content),"sha256":digest(content),"gitBlobSha1":git(content)})
    assert set(read_json(APP/"SOURCE_FILES.json")["files"])=={r["path"] for r in rows}
    python_files=[]
    for row in rows:
        if row["path"].endswith(".py"):
            compile((APP/row["path"]).read_bytes(),str(APP/row["path"]),"exec")
            python_files.append(row["path"])
    node=os.environ["CODEX_PRIMARY_RUNTIME_NODE"]
    node_files=[]
    for row in rows:
        if row["path"].endswith((".mjs",".js")):
            check=subprocess.run([node,"--check",str(APP/row["path"])],capture_output=True,timeout=30)
            assert check.returncode==0,(row["path"],check.stderr.decode())
            node_files.append(row["path"])
    result={"sourceBlob":EXPECTED,"application":str(APP),"files":rows,"python":python_files,"javascript":node_files}
    write(ROOT/("hydration-"+EXPECTED+".json"),raw_json(result))
    event(event="COMPLETE_APPLICATION_HYDRATED",sourceBlob=EXPECTED,files=len(rows),python=len(python_files),javascript=len(node_files))
    return node
def browser(node):
    module=str(pathlib.Path(os.environ["CODEX_PRIMARY_RUNTIME_NODE_MODULES"])/"playwright"/"index.js")
    candidates=[pathlib.Path("/workspace/scratch/5403360e55a4/counterpress-capture-runtime/bin/chromium"),pathlib.Path("/workspace/scratch/9f774193b7b4/kisters-native-receiving/runtime/chromium-153/chromium")]
    command="const p=require("+json.dumps(module)+");process.stdout.write(p.chromium.executablePath());"
    installed=subprocess.run([node,"-e",command],capture_output=True,timeout=30)
    if installed.returncode==0 and installed.stdout.strip():
        candidates.append(pathlib.Path(installed.stdout.decode().strip()))
    found=next((p for p in candidates if p.is_file() and os.access(p,os.X_OK)),None)
    if found is None:
        discovery=subprocess.run(["rg","--files","--hidden","/workspace/scratch","-g","chrome-headless-shell"],capture_output=True,timeout=45)
        found=next((pathlib.Path(p) for p in discovery.stdout.decode().splitlines()
                    if pathlib.Path(p).is_file() and os.access(p,os.X_OK)),None)
    assert found is not None,"Use the already-installed shared Chromium headless-shell distribution."
    version=subprocess.run([str(found),"--version"],capture_output=True,timeout=30)
    assert version.returncode==0,version.stderr.decode()
    selection={"module":module,"executablePath":str(found),"args":["--disable-dev-shm-usage"]}
    runtime_record={"selection":selection,"version":version.stdout.decode().strip()}
    write(ROOT/"browser-runtimes"/(digest(raw_json(runtime_record))+".json"),raw_json(runtime_record))
    event(event="ORIGINAL_BROWSER_RUNTIME",**selection,version=version.stdout.decode().strip())
    return selection
def inputs(selection):
    original=CASE/"inputs"/"original-input.json"
    if original.is_file():
        retained=read_json(original)
        assert retained["operation"]==OPERATION
        weather=pathlib.Path(retained["weather"]["path"]).read_bytes()
        assert len(weather)==retained["weather"]["bytes"] and digest(weather)==retained["weather"]["sha256"]
        return original
    source=RROOT/"inputs"
    weather=(source/"weather.csv").read_bytes()
    metadata=read_json(source/"weather-metadata.json")
    options=read_json(source/"model-options.json")
    assert digest(weather)==metadata["sha256"]=="1f8ca093c522520e1205c1ccf09ed48c9261d489bac3d7a04ab55216518421be"
    assert len(weather)==metadata["bytes"]==82799
    assert options=={"sourceTimezone":"UTC","weatherTimezone":"UTC","weatherColumns":{"time":"DATE","temp":"TEMP","station":"STATION"},"weatherUnits":"F","weatherInterval":"Daily","interval":"Monthly","models":["Mean","SLR","3PC","3PH","4P","5P","HDD","CDD","HDD-CDD","TOW","TOWT"]}
    value={"format":"commons.audit-exchange.commissioning-input.v1","operation":OPERATION,
           "operator":"Commons 6804 — complete original Audit Exchange operating programme",
           "weather":{**metadata,"path":str(source/"weather.csv")},"modelOptions":options,"browser":selection}
    target=ROOT/"original-commissioning-input.json"
    write(target,raw_json(value))
    return target
def preserve():
    pointer=CASE.parent/(CASE.name+"-latest-archive.json")
    if not pointer.is_file(): return
    capture=read_json(pointer)
    complete=pathlib.Path(capture["path"])
    content=complete.read_bytes()
    assert len(content)==capture["bytes"] and digest(content)==capture["sha256"]
    uploads=[{"local_path":str(complete),"purpose":"create_library_file","library_artifact_type":"other"}]
    if capture["status"]=="passed":
        for name in ("Complete_Audit_Exchange_Application.zip","Twice_Received_Complete_Audit.zip","Complete_Audit_LDA_Initial_Workspace.zip","Complete_Corrected_Audit_Application.zip","Received_Corrected_Complete_Audit.zip"):
            path=CASE/"deliveries"/name
            if path.is_file():
                uploads.append({"local_path":str(path),"purpose":"create_library_file","library_artifact_type":"other"})
    uploads.extend(recipient_uploads())
    uploads.extend(queue_uploads())
    uploads.extend(revision_uploads())
    uploads=list({row['local_path']:row for row in uploads}.values())
    identity=hashlib.sha256(raw_json(uploads)).hexdigest()
    delivery=ROOT/"delivery"/identity
    started=delivery/"started.json"
    outcome=delivery/"result.json"
    if outcome.is_file():
        event(event="ORIGINAL_COMPLETE_DELIVERY",result=read_json(outcome))
        return
    if started.is_file():
        event(event="RECONCILE_ORIGINAL_DELIVERY",record=str(started),archive=str(complete),sha256=capture["sha256"])
        return
    request={"uploads":uploads}
    write(started,raw_json(request))
    helper=ROOT/"library-helper"/"library_upload.py"
    result=subprocess.run([sys.executable,str(helper)],input=raw_json(request),capture_output=True,timeout=600,
                          env=dict(os.environ,PYTHONDONTWRITEBYTECODE="1"))
    write(delivery/"stdout.json",result.stdout)
    write(delivery/"stderr.log",result.stderr)
    record={"exit":result.returncode,"archive":capture,"stdoutPath":str(delivery/"stdout.json"),"stderrPath":str(delivery/"stderr.log")}
    try: record["response"]=json.loads(result.stdout)
    except ValueError: record["output"]=result.stdout.decode(errors="replace")[-2000:]
    write(outcome,raw_json(record))
    event(event="ORIGINAL_COMPLETE_DELIVERY",result=record)
RECIPIENT_OPERATION="AUDIT-RECIPIENT-REVIEW-24EA-20261013"
INSTALLED_OPERATION="AUDIT-RECIPIENT-INSTALLED-OPERATOR-24EA-20261013"
FOLLOWING=ROOT/"recipient-continuation"
FOLLOWING_SCHEMA="commons.audit-exchange.original-recipient-continuation.v1"
def ordinary(path):
    path=pathlib.Path(path)
    assert path.is_file() and not path.is_symlink(),str(path)
    with path.open("rb") as stream:
        before=os.fstat(stream.fileno())
        assert stat.S_ISREG(before.st_mode),str(path)
        body=stream.read()
        after=os.fstat(stream.fileno())
    assert (before.st_dev,before.st_ino,before.st_size,before.st_mtime_ns)==(after.st_dev,after.st_ino,after.st_size,after.st_mtime_ns)
    assert len(body)==before.st_size,str(path)
    return body
def file_identity(path):
    body=ordinary(path)
    return {"path":str(pathlib.Path(path).absolute()),"bytes":len(body),"sha256":digest(body)}
def verify_file(row):
    assert set(row)>={"path","bytes","sha256"}
    assert file_identity(row["path"])=={k:row[k] for k in ("path","bytes","sha256")},row["path"]
def safe_relative(value):
    assert isinstance(value,str) and value and "\\" not in value
    relative=pathlib.PurePosixPath(value)
    assert not relative.is_absolute() and all(part not in ("",".","..") for part in value.split("/")),value
    return relative
def application_rows(directory):
    directory=pathlib.Path(directory)
    names=read_json(directory/"SOURCE_FILES.json")["files"]
    assert isinstance(names,list) and len(names)==len(set(names)) and "SOURCE_FILES.json" in names
    return [{"path":name,**{k:v for k,v in file_identity(directory/safe_relative(name)).items() if k!="path"}} for name in names]
def exact_application(directory,rows):
    directory=pathlib.Path(directory)
    try:
        return application_rows(directory)==rows
    except (OSError,AssertionError,KeyError,ValueError):
        return False
def source_for_course(directory):
    """Use a retained course inventory before selecting any newer application."""
    original=pathlib.Path(directory)/"INPUT.json"
    if original.exists():
        rows=read_json(original)["applicationSource"]
        candidates=[pathlib.Path(directory)/"application",APP]
        if (FOLLOWING/"sources").is_dir():
            candidates.extend(sorted(p for p in (FOLLOWING/"sources").iterdir() if p.is_dir()))
        if (CASE/"source").is_dir():
            candidates.extend(sorted(p for p in (CASE/"source").iterdir() if p.is_dir()))
        source=next((p for p in candidates if exact_application(p,rows)),None)
        assert source is not None,"Restore the complete original recipient application inventory before its continuation."
        return source,rows
    rows=application_rows(APP)
    target=FOLLOWING/"sources"/digest(raw_json(rows))
    for row in rows:
        write(target/safe_relative(row["path"]),ordinary(APP/row["path"]))
    assert exact_application(target,rows)
    return target,rows
def recipient_options():
    parser=argparse.ArgumentParser(add_help=False)
    parser.add_argument("--recipient-plan",type=pathlib.Path)
    parser.add_argument("--recipient-directory",type=pathlib.Path)
    parser.add_argument("--installed-recipient-directory",type=pathlib.Path)
    options,author_args=parser.parse_known_args()
    retained=FOLLOWING/"INPUT.json"
    previous=read_json(retained) if retained.exists() else None
    first=(options.recipient_directory or (pathlib.Path(previous["recipientDirectory"]) if previous else CASE/"recipient-review-24ea")).absolute()
    second=(options.installed_recipient_directory or (pathlib.Path(previous["installedDirectory"]) if previous else CASE/"recipient-installed-24ea")).absolute()
    for path in (first,second):
        assert path.resolve()==path and path!=APP and APP not in path.parents
        assert path!=CASE/"workspaces"/"author" and CASE/"workspaces"/"author" not in path.parents
    assert first!=second and first not in second.parents and second not in first.parents
    if previous:
        assert previous["schema"]==FOLLOWING_SCHEMA and previous["operation"]==OPERATION
        assert previous["recipientDirectory"]==str(first) and previous["installedDirectory"]==str(second),"Retain the original recipient directories."
    return options,author_args,first,second,previous
def passed_author():
    result=read_json(CASE/"result.json")
    assert result["operation"]==OPERATION and result["status"]=="passed"
    assert len(result["stages"])==9 and all(row["operation"]==OPERATION for row in result["stages"])
    return result
def bind_following(options,first,second,previous):
    result=passed_author()
    author=CASE/"workspaces"/"author"
    assert (author/"audit-exchange.sqlite").is_file(),"Retain the original completed author workspace."
    sys.path.insert(0,str(APP))
    import AUDIT_RECIPIENT_RECEIVING as course
    import audit_recipient_review as recipient
    operator=read_json(CASE/"inputs"/"original-input.json")["operator"]
    initial=first/"INPUT.json"
    if previous:
        for field in ("authorResult","archive","reviewPlan"):
            verify_file(previous[field])
        assert previous["authorResult"]==file_identity(CASE/"result.json")
        assert previous["workspace"]==str(author) and previous["workspaceId"]==result["workspaceId"]
        if options.recipient_plan:
            assert ordinary(options.recipient_plan)==ordinary(previous["reviewPlan"]["path"]),"Keep the retained complete proposal plan."
        return previous
    if initial.exists():
        selected=read_json(initial)
        assert selected["operation"]==RECIPIENT_OPERATION and selected["workspace"]==str(author)
        assert selected["workspaceId"]==result["workspaceId"],"Keep the original recipient author identity."
        archive=first/"original-review.zip"
        plan=first/"REVIEW_PLAN.json"
        for path,key in ((archive,"originalArchive"),(plan,"reviewPlan")):
            actual=file_identity(path)
            assert {k:actual[k] for k in ("bytes","sha256")}==selected[key]
        operator=selected["operator"]
        if options.recipient_plan:
            assert ordinary(options.recipient_plan)==ordinary(plan),"Retain the exact original 24EA plan."
        provenance={"kind":"retained-original-recipient","input":file_identity(initial)}
    else:
        corrected=read_json(CASE/"colleague-return"/"result.json")
        assert corrected["operation"]==OPERATION and corrected["status"]=="passed"
        assert corrected["workspaceId"]==result["workspaceId"]
        archive=pathlib.Path(corrected["applicationPath"]).absolute()
        raw=ordinary(archive)
        assert digest(raw)==corrected["applicationSha256"]
        _,snapshot,kinds,_=recipient.package(raw)
        assert snapshot["workspace"]["workspaceId"]==result["workspaceId"]
        plan=FOLLOWING/"REVIEW_PLAN.json"
        provenance_path=FOLLOWING/"PLAN_SOURCE.json"
        if plan.exists():
            provenance=read_json(provenance_path)
            assert provenance["archive"]==file_identity(archive)
            if options.recipient_plan:
                assert ordinary(options.recipient_plan)==ordinary(plan),"Preserve the first complete selected plan."
        elif options.recipient_plan:
            plan_raw=ordinary(options.recipient_plan)
            course.validate_plan(recipient.checked_json(plan_raw),raw)
            provenance={"kind":"explicit-retained-operator-plan","archive":file_identity(archive),
                        "selectedPlan":file_identity(options.recipient_plan)}
            write(provenance_path,raw_json(provenance))
            write(plan,plan_raw)
        else:
            # Intentional editorial proposals bind actual completed source records;
            # no source IDs, site observations or analytical results are invented.
            source_id=corrected["selection"]["original"]["sourceId"]
            source=kinds["source"][source_id]
            revision=kinds["revision"][source["currentRevisionId"]]
            assert revision["sourceId"]==source_id
            buildings=[row for row in revision["model"]["entities"] if row.get("semanticKind")=="building"]
            systems=[row for row in revision["model"]["entities"]
                     if row.get("semanticKind")=="system" and row.get("kind")=="HVACSystem"
                     and len(row.get("buildingKeys",[]))==2]
            assert len(buildings)==2 and len(systems)==1,"Select the actual corrected two-building shared cooling source."
            system=systems[0]
            assert set(system["buildingKeys"])=={row["key"] for row in buildings}
            common={"id":"","sourceId":source_id,"revisionId":revision["id"],"status":"investigating",
                    "actor":operator,"assignee":operator,"dueDate":"","evidence":[]}
            proposals={"schema":"commons.audit-recipient-receiving-plan.v1","reviews":[
                {**common,"entityKey":"","title":"Confirm the corrected building names before client handover",
                 "note":"Review the exact corrected source revision and reconcile both building names with the retained author and colleague corrections. Keep each earlier XML revision and its original review history available to the recipient."},
                {**common,"entityKey":system["key"],"title":"Coordinate shared cooling responsibilities for both buildings",
                 "note":"The selected native cooling system explicitly links both retained building entities. Review its handover responsibility and keep both original source associations in the delivered register; this is a recipient coordination proposal."}
            ]}
            course.validate_plan(proposals,raw)
            provenance={"kind":"intentional-source-bound-proposals","archive":file_identity(archive),
                        "colleagueResult":file_identity(CASE/"colleague-return"/"result.json"),
                        "sourceId":source_id,"revisionId":revision["id"],"sourceSha256":revision["sha256"],
                        "buildingKeys":[row["key"] for row in buildings],"sharedSystemKey":system["key"],
                        "operator":operator,"purpose":"Recipient editorial coordination of the actual completed corrected author source."}
            write(provenance_path,raw_json(provenance))
            write(plan,raw_json(proposals))
    raw=ordinary(archive)
    _,snapshot,_,_=recipient.package(raw)
    assert snapshot["workspace"]["workspaceId"]==result["workspaceId"]
    course.validate_plan(recipient.checked_json(ordinary(plan)),raw)
    selected={"schema":FOLLOWING_SCHEMA,"operation":OPERATION,
              "recipientOperation":RECIPIENT_OPERATION,"installedOperation":INSTALLED_OPERATION,
              "workspace":str(author),"workspaceId":result["workspaceId"],"operator":operator,
              "recipientDirectory":str(first),"installedDirectory":str(second),
              "archive":file_identity(archive),"reviewPlan":file_identity(plan),
              "authorResult":file_identity(CASE/"result.json"),"sourceBlobAtSelection":EXPECTED,
              "planProvenance":provenance}
    write(FOLLOWING/"INPUT.json",raw_json(selected))
    return selected

RECIPIENT_LAUNCHER = r"""import os,sys,pathlib,fcntl,stat,signal
source=pathlib.Path(sys.argv[1]); name=sys.argv[2]; descriptors=[int(x) for x in sys.argv[3].split(",")]
paths=[pathlib.Path(p) for p in sys.argv[4].split("\n")]
assert len(descriptors)==len(paths)==2
for descriptor,path in zip(descriptors,paths):
    held=os.fstat(descriptor); current=os.stat(path,follow_symlinks=False)
    assert stat.S_ISREG(held.st_mode) and (held.st_dev,held.st_ino)==(current.st_dev,current.st_ino)
    fcntl.flock(descriptor,fcntl.LOCK_EX|fcntl.LOCK_NB)
sys.path.insert(0,str(source))
import AUDIT_RECIPIENT_RECEIVING as original
owned=original.owned_child
def joined(command,cwd,log,lock_fd):
    local=tuple(lock_fd) if isinstance(lock_fd,(list,tuple)) else (lock_fd,)
    return owned(command,cwd,log,tuple(dict.fromkeys(local+tuple(descriptors))))
original.owned_child=joined
signal.signal(signal.SIGTERM,original.interrupted)
signal.signal(signal.SIGINT,original.interrupted)
if name=="AUDIT_RECIPIENT_RECEIVING":
    selected=original
elif name=="AUDIT_RECIPIENT_INSTALLED_RECEIVING":
    import AUDIT_RECIPIENT_INSTALLED_RECEIVING as selected
elif name=="AUDIT_RECIPIENT_QUEUE_RECEIVING":
    import AUDIT_RECIPIENT_QUEUE_RECEIVING as selected
else:
    assert name=="AUDIT_REVISION_REVIEW_RECEIVING"
    import AUDIT_REVISION_REVIEW_RECEIVING as selected
raise SystemExit(selected.main(sys.argv[5:]))
"""
def run_course(label,command,environment,descriptors):
    attempts=FOLLOWING/"attempts"/label
    attempts.mkdir(parents=True,exist_ok=True)
    number=max((int(p.name) for p in attempts.iterdir() if p.is_dir() and p.name.isdigit()),default=0)+1
    attempt=attempts/("%04d"%number);attempt.mkdir()
    write(attempt/"invocation.json",raw_json({"operation":OPERATION,"course":label,"command":command,
          "at":datetime.datetime.now(datetime.timezone.utc).isoformat(),"controllerSource":file_identity(__file__)}))
    with (attempt/"output.log").open("xb",buffering=0) as output:
        child=subprocess.Popen(command,stdin=subprocess.DEVNULL,stdout=output,stderr=subprocess.STDOUT,
                               env=environment,cwd=APP,pass_fds=tuple(descriptors))
        write(attempt/"process.json",raw_json({"pid":child.pid,"command":command}))
        event(event="ORIGINAL_RECIPIENT_COURSE_STARTED",course=label,pid=child.pid,attempt=str(attempt))
        child.wait()
    write(attempt/"exit.json",raw_json({"exit":child.returncode}))
    event(event="ORIGINAL_RECIPIENT_COURSE_EXIT",course=label,exit=child.returncode,attempt=str(attempt))
    if child.returncode:
        event(event="ORIGINAL_RECIPIENT_DIAGNOSTIC",course=label,tail=(attempt/"output.log").read_text(errors="replace")[-12000:])
    return child.returncode
def closed_course(directory,operation):
    directory=pathlib.Path(directory)
    receipt=read_json(directory/"COMPLETE.json")
    run=read_json(directory/"RUN_RESULT.json")
    assert receipt["operation"]==run["operation"]==operation
    assert receipt["input"]==run["input"] and run["native"]=="complete"
    verify_file(receipt["archive"])
    return {"operation":operation,"directory":str(directory),"complete":file_identity(directory/"COMPLETE.json"),
            "result":file_identity(directory/"RUN_RESULT.json"),"archive":receipt["archive"],
            "renderedRecipientReady":receipt["renderedRecipientReady"]}
def following(options,first,second,previous,node,selected,environment,guard):
    case_guard=os.open(CASE/"operation.lock",os.O_RDWR|os.O_NOFOLLOW)
    fcntl.flock(case_guard,fcntl.LOCK_EX|fcntl.LOCK_NB)
    try:
        bound=bind_following(options,first,second,previous)
        launcher=FOLLOWING/"launchers"/(digest(RECIPIENT_LAUNCHER.encode())+".py")
        write(launcher,RECIPIENT_LAUNCHER.encode())
        locks=str(ROOT/"native-controller.lock")+"\n"+str(CASE/"operation.lock")
        descriptors=(guard,case_guard)
        prefix=[sys.executable,str(launcher)]
        first_source,first_rows=source_for_course(first)
        command=prefix+[str(first_source),"AUDIT_RECIPIENT_RECEIVING",",".join(map(str,descriptors)),locks,
            "--workspace",bound["workspace"],"--archive",bound["archive"]["path"],
            "--archive-sha256",bound["archive"]["sha256"],"--review-plan",bound["reviewPlan"]["path"],
            "--directory",str(first),"--operator",bound["operator"],"--node",node,
            "--chromium",selected["executablePath"],"--playwright-module",selected["module"]]
        code=run_course("original-recipient",command,environment,descriptors)
        if code:return code
        first_result=closed_course(first,RECIPIENT_OPERATION)
        write(FOLLOWING/"original-recipient-complete.json",raw_json(first_result))
        second_source,second_rows=source_for_course(second)
        command=prefix+[str(second_source),"AUDIT_RECIPIENT_INSTALLED_RECEIVING",",".join(map(str,descriptors)),locks,
            "--completed-recipient",str(first),"--directory",str(second),"--node",node,
            "--chromium",selected["executablePath"],"--playwright-module",selected["module"]]
        code=run_course("installed-recipient",command,environment,descriptors)
        if code:return code
        second_result=closed_course(second,INSTALLED_OPERATION)
        write(FOLLOWING/"installed-recipient-complete.json",raw_json(second_result))
        complete={"schema":FOLLOWING_SCHEMA,"operation":OPERATION,"input":bound,
                  "originalRecipient":first_result,"installedRecipient":second_result,
                  "renderedRecipientReady":False,
                  "viewing":"Open and inspect both real browser outputs and every complete outgoing attachment before recipient readiness."}
        write(FOLLOWING/"COMPLETE.json",raw_json(complete))
        event(event="ORIGINAL_RECIPIENT_CHAIN_COMPLETE",result=complete)
        return 0
    finally: os.close(case_guard)
def recipient_uploads():
    selected=FOLLOWING/"INPUT.json"
    if not selected.exists():return []
    bound=read_json(selected);result=[]
    for directory,operation,names in (
        (bound["recipientDirectory"],RECIPIENT_OPERATION,("Audit_Exchange_Application.zip","Audit_Exchange_Received_Application.zip")),
        (bound["installedDirectory"],INSTALLED_OPERATION,("Audit_Installed_Application.zip","Audit_Installed_Received_Application.zip"))):
        directory=pathlib.Path(directory)
        if not (directory/"COMPLETE.json").exists():continue
        complete=closed_course(directory,operation)
        result.append({"local_path":complete["archive"]["path"],"purpose":"create_library_file","library_artifact_type":"other"})
        for name in names:
            path=directory/name
            if path.is_file():result.append({"local_path":str(path),"purpose":"create_library_file","library_artifact_type":"other"})
    return result


QUEUE_OPERATION="AUDIT-RECIPIENT-REVIEW-QUEUE-24EA-20261013"
QUEUE_SOURCE="9cac81e6f6d343bd561523f2e8ff8755751f390d"
QUEUE_JOIN=FOLLOWING/"queue-continuation"
QUEUE_SCHEMA="commons.audit-exchange.original-queue-continuation.v1"
def queue_options():
    parser=argparse.ArgumentParser(add_help=False)
    parser.add_argument("--queue-selection",type=pathlib.Path)
    parser.add_argument("--queue-directory",type=pathlib.Path)
    options,remainder=parser.parse_known_args()
    sys.argv=[sys.argv[0]]+remainder
    retained=QUEUE_JOIN/"INPUT.json"
    previous=read_json(retained) if retained.exists() else None
    directory=(options.queue_directory or (pathlib.Path(previous["queueDirectory"]) if previous
                 else CASE/"recipient-queue-24ea")).absolute()
    assert directory.resolve()==directory and directory!=APP and APP not in directory.parents
    assert directory!=CASE and directory not in CASE.parents
    for reserved in (ROOT,APP,RROOT,CASE/"workspaces"):
        assert directory!=reserved and directory not in reserved.parents and reserved not in directory.parents, "Keep the queue journal separate from controller, source, runtime and native workspace custody."
    if previous:
        assert previous["schema"]==QUEUE_SCHEMA and previous["operation"]==OPERATION
        assert previous["queueOperation"]==QUEUE_OPERATION and previous["queueDirectory"]==str(directory)
    return options,directory,previous
def frozen_queue_source(directory):
    # The author and both preceding courses keep the reviewed 72-file edition.
    # The following queue receives its complete 77-file application separately.
    body=ordinary(ROOT/("source-cohort-"+QUEUE_SOURCE[:8]+".json"))
    assert git(body)==QUEUE_SOURCE
    packet=json.loads(body); entries=packet["files"]
    assert len(entries)==77 and len({entry["path"] for entry in entries})==77
    names=json.loads(next(row["content"] for row in entries if row["path"]=="SOURCE_FILES.json"))["files"]
    assert len(names)==77 and set(names)=={row["path"] for row in entries}
    by={row["path"]:row for row in entries}
    expected=[]
    for name in names:
        row=by[name]; raw=row["content"].encode("utf-8")
        safe_relative(name)
        assert git(raw)==row["gitBlobSha1"],name
        expected.append({"path":name,"bytes":len(raw),"sha256":digest(raw)})
    initial=pathlib.Path(directory)/"INPUT.json"
    if initial.exists():
        retained=read_json(initial)
        assert retained["operation"]==QUEUE_OPERATION
        assert retained["applicationSource"]==expected,"Keep the exact original queue source selection."
    target=QUEUE_JOIN/"sources"/digest(raw_json(expected))
    for row in expected:
        write(target/safe_relative(row["path"]),by[row["path"]]["content"].encode("utf-8"))
    assert exact_application(target,expected)
    return target,expected

def valid_queue_specification(specification,workspace_id):
    assert isinstance(specification,dict) and set(specification)=={"workspaceId","returnIds","title","note","operator"}
    assert specification["workspaceId"]==workspace_id
    ids=specification["returnIds"]
    assert isinstance(ids,list) and 1<=len(ids)<=128
    assert all(isinstance(identity,str) and identity for identity in ids) and len(set(ids))==len(ids)
    for key,limit in (("title",500),("note",5000),("operator",240)):
        assert isinstance(specification[key],str) and len(specification[key])<=limit
        assert specification[key].strip() or key=="note"

def queue_selection(options,directory,second,previous,source,rows):
    installed=closed_course(second,INSTALLED_OPERATION)
    run=read_json(pathlib.Path(second)/"RUN_RESULT.json")
    chain=read_json(FOLLOWING/"COMPLETE.json")
    assert chain["operation"]==OPERATION and chain["installedRecipient"]==installed
    assert run["input"]["workspace"]==str(CASE/"workspaces"/"author")
    assert run["input"]["workspaceId"]==chain["input"]["workspaceId"]
    actual_input=pathlib.Path(directory)/"INPUT.json"
    selected_path=QUEUE_JOIN/"SELECTION.json"
    origin_path=QUEUE_JOIN/"SELECTION_SOURCE.json"
    if previous:
        assert previous["installedDirectory"]==str(second)
        assert previous["workspace"]==run["input"]["workspace"] and previous["workspaceId"]==run["input"]["workspaceId"]
        assert previous["sourceBlob"]==QUEUE_SOURCE and previous["applicationSource"]==rows
        for key in ("selection","selectionSource","installedComplete","installedResult","installedArchive"):
            verify_file(previous[key])
        assert previous["installedComplete"]==file_identity(pathlib.Path(second)/"COMPLETE.json")
        assert previous["installedResult"]==file_identity(pathlib.Path(second)/"RUN_RESULT.json")
        selected_path=pathlib.Path(previous["selection"]["path"])
        if options.queue_selection:
            assert ordinary(options.queue_selection)==ordinary(selected_path),"Retain the first complete queue selection."
        specification=read_json(selected_path)
        valid_queue_specification(specification,run["input"]["workspaceId"])
        if actual_input.exists():
            assert read_json(actual_input)["specification"]==specification
        return previous
    if selected_path.exists():
        specification=read_json(selected_path)
        provenance=read_json(origin_path)
        assert provenance["installedResult"]==file_identity(pathlib.Path(second)/"RUN_RESULT.json")
        if options.queue_selection:
            assert ordinary(options.queue_selection)==ordinary(selected_path),"Preserve the original complete queue selection."
    elif actual_input.exists():
        retained=read_json(actual_input)
        assert retained["operation"]==QUEUE_OPERATION and retained["predecessor"]==str(second)
        assert retained["workspace"]==run["input"]["workspace"] and retained["workspaceId"]==run["input"]["workspaceId"]
        assert retained["applicationSource"]==rows
        specification=retained["specification"]
        if options.queue_selection:
            assert read_json(options.queue_selection)==specification,"Keep the original 24EA queue specification."
        provenance={"kind":"retained-original-queue","originalInput":file_identity(actual_input),
                    "installedResult":file_identity(pathlib.Path(second)/"RUN_RESULT.json")}
        valid_queue_specification(specification,run["input"]["workspaceId"])
        write(origin_path,raw_json(provenance));write(selected_path,raw_json(specification))
    elif options.queue_selection:
        raw=ordinary(options.queue_selection)
        specification=json.loads(raw)
        provenance={"kind":"explicit-original-return-selection","selectedFile":file_identity(options.queue_selection),
                    "installedResult":file_identity(pathlib.Path(second)/"RUN_RESULT.json")}
        valid_queue_specification(specification,run["input"]["workspaceId"])
        write(origin_path,raw_json(provenance));write(selected_path,raw)
    else:
        # Select the complete return actually staged by the completed installed
        # course; no guessed IDs or duplicate manuscripts enter the queue.
        staged=run["browser"]["staged"]
        assert staged["request"]["action"]=="recipient.stage"
        returned=staged["result"]["archive"]
        assert returned["kind"]=="recipient-return"
        assert {k:returned[k] for k in ("bytes","sha256")}==run["input"]["return"]
        original_return=pathlib.Path(second)/"Audit_Recipient_Return.zip"
        assert {k:file_identity(original_return)[k] for k in ("bytes","sha256")}==run["input"]["return"]
        specification={"workspaceId":run["input"]["workspaceId"],"returnIds":[returned["id"]],
                       "title":"Original corrected Audit — retained recipient review queue",
                       "note":"Continue the completed recipient review in the original author. Keep its complete manuscript, exact native acceptance custody and all earlier source editions; defer subsequent staff follow-up explicitly without changing accepted review decisions.",
                       "operator":run["input"]["operator"]}
        provenance={"kind":"completed-installed-original-return","installedResult":file_identity(pathlib.Path(second)/"RUN_RESULT.json"),
                    "stagedRequestId":staged["request"]["requestId"],"returnId":returned["id"],
                    "originalReturn":file_identity(original_return),"purpose":"Explicit staff queue of the actual completed installed recipient return."}
        write(origin_path,raw_json(provenance));write(selected_path,raw_json(specification))
    valid_queue_specification(specification,run["input"]["workspaceId"])
    selected={"schema":QUEUE_SCHEMA,"operation":OPERATION,"queueOperation":QUEUE_OPERATION,
              "queueDirectory":str(directory),"installedDirectory":str(second),
              "workspace":run["input"]["workspace"],"workspaceId":run["input"]["workspaceId"],
              "selection":file_identity(selected_path),"selectionSource":file_identity(origin_path),
              "installedComplete":file_identity(pathlib.Path(second)/"COMPLETE.json"),
              "installedResult":file_identity(pathlib.Path(second)/"RUN_RESULT.json"),
              "installedArchive":installed["archive"],"sourceBlob":QUEUE_SOURCE,
              "application":str(source),"applicationSource":rows}
    write(QUEUE_JOIN/"INPUT.json",raw_json(selected))
    return selected
def queue_following(options,directory,second,previous,node,selected,environment,guard):
    assert directory!=second and directory not in second.parents and second not in directory.parents
    case_guard=os.open(CASE/"operation.lock",os.O_RDWR|os.O_NOFOLLOW)
    fcntl.flock(case_guard,fcntl.LOCK_EX|fcntl.LOCK_NB)
    try:
        source,rows=frozen_queue_source(directory)
        bound=queue_selection(options,directory,second,previous,source,rows)
        launcher=FOLLOWING/"launchers"/(digest(RECIPIENT_LAUNCHER.encode())+".py")
        write(launcher,RECIPIENT_LAUNCHER.encode())
        locks=str(ROOT/"native-controller.lock")+"\n"+str(CASE/"operation.lock")
        descriptors=(guard,case_guard)
        command=[sys.executable,str(launcher),str(source),"AUDIT_RECIPIENT_QUEUE_RECEIVING",
                 ",".join(map(str,descriptors)),locks,
                 "--completed-installed",str(second),"--directory",str(directory),
                 "--selection",bound["selection"]["path"],"--node",node,
                 "--chromium",selected["executablePath"],"--playwright-module",selected["module"]]
        code=run_course("recipient-review-queue",command,environment,descriptors)
        if code:return code
        outcome=closed_course(directory,QUEUE_OPERATION)
        complete={"schema":QUEUE_SCHEMA,"operation":OPERATION,"input":bound,"queue":outcome,
                  "renderedRecipientReady":False,
                  "viewing":"Open the real desktop/narrow queue screens, unfinished working files, full queue OPEN.html, complete native applications and original returns before customer presentation."}
        write(QUEUE_JOIN/"COMPLETE.json",raw_json(complete))
        event(event="ORIGINAL_RECIPIENT_QUEUE_COMPLETE",result=complete)
        return 0
    finally:os.close(case_guard)
def queue_uploads():
    selected=QUEUE_JOIN/"INPUT.json"
    if not selected.exists():return []
    bound=read_json(selected);directory=pathlib.Path(bound["queueDirectory"])
    if not (directory/"COMPLETE.json").exists():return []
    complete=closed_course(directory,QUEUE_OPERATION)
    paths=[pathlib.Path(complete["archive"]["path"])]
    for name in ("Audit_Queue_Application.zip","Audit_Queue_Received_Application.zip","browser/Audit_Recipient_Queue_Complete.zip"):
        path=directory/name
        assert path.is_file() and not path.is_symlink(),str(path)
        paths.append(path)
    return [{"local_path":str(p),"purpose":"create_library_file","library_artifact_type":"other"} for p in paths]

REVISION_SELECTION_SHA="baa790bdd5baa905c46175d869e25887af8d7aac814fc023aac7a0740196a81a"

REVISION_OPERATION="AUDIT-REVISION-IMPACT-REVIEW-24EA-20261013"
REVISION_SOURCE="37de4056cc6cf92e0a5bbd7e8ee7dd8389400253"
REVISION_JOIN=FOLLOWING/"revision-review-continuation"
REVISION_SCHEMA="commons.audit-exchange.original-revision-review-continuation.v1"
def revision_options():
    parser=argparse.ArgumentParser(add_help=False)
    parser.add_argument("--revision-review-selection",type=pathlib.Path)
    parser.add_argument("--revision-review-directory",type=pathlib.Path)
    options,remainder=parser.parse_known_args()
    sys.argv=[sys.argv[0]]+remainder
    retained=REVISION_JOIN/"INPUT.json"
    previous=read_json(retained) if retained.exists() else None
    directory=(options.revision_review_directory or (pathlib.Path(previous["revisionDirectory"]) if previous
                 else CASE/"revision-review-24ea")).absolute()
    assert directory.resolve()==directory
    for reserved in (ROOT,APP,RROOT,CASE/"workspaces"):
        assert directory!=reserved and directory not in reserved.parents and reserved not in directory.parents, "Keep following review separate from original controller, source, runtime and native workspaces."
    assert directory!=CASE and directory not in CASE.parents
    if previous:
        assert previous["schema"]==REVISION_SCHEMA and previous["operation"]==OPERATION
        assert previous["revisionOperation"]==REVISION_OPERATION and previous["revisionDirectory"]==str(directory)
    return options,directory,previous

def frozen_revision_source(directory):
    body=ordinary(ROOT/("source-cohort-"+REVISION_SOURCE[:8]+".json"))
    assert git(body)==REVISION_SOURCE
    packet=json.loads(body);entries=packet["files"]
    assert len(entries)==82 and len({entry["path"] for entry in entries})==82
    names=json.loads(next(row["content"] for row in entries if row["path"]=="SOURCE_FILES.json"))["files"]
    assert len(names)==82 and set(names)=={r["path"] for r in entries}
    by={r["path"]:r for r in entries};rows=[]
    for name in names:
        safe_relative(name);raw=by[name]["content"].encode("utf-8")
        assert git(raw)==by[name]["gitBlobSha1"],name
        rows.append({"path":name,"bytes":len(raw),"sha256":digest(raw)})
    original=pathlib.Path(directory)/"INPUT.json"
    if original.exists():
        retained=read_json(original)
        assert retained["operation"]==REVISION_OPERATION and retained["applicationSource"]==rows,"Keep the complete original following-review source."
    target=REVISION_JOIN/"sources"/digest(raw_json(rows))
    for row in rows:write(target/safe_relative(row["path"]),by[row["path"]]["content"].encode("utf-8"))
    assert exact_application(target,rows)
    return target,rows

def valid_revision_specification(value,workspace_id):
    assert isinstance(value,dict) and set(value)=={"workspaceId","sourceId","toRevisionId","reviewIds","decisions","title","note","actor"}
    assert value["workspaceId"]==workspace_id
    for key,maximum in (("title",500),("note",5000),("actor",240)):
        assert isinstance(value[key],str) and len(value[key])<=maximum and (value[key].strip() or key=="note")
    for key in ("sourceId","toRevisionId"):assert isinstance(value[key],str) and value[key]
    ids=value["reviewIds"]
    assert isinstance(ids,list) and 1<=len(ids)<=250 and all(isinstance(v,str) and v for v in ids) and len(ids)==len(set(ids))
    assert isinstance(value["decisions"],list) and [r.get("reviewId") for r in value["decisions"]]==ids
    fields={"entityKey","status","title","note","assignee","dueDate","evidence"}
    for row in value["decisions"]:
        assert row["mode"] in ("retain","update") and isinstance(row["reason"],str) and row["reason"].strip()
        assert set(row)=={"reviewId","mode","reason"}|({"review"} if row["mode"]=="update" else set())
        if row["mode"]=="update":
            assert isinstance(row["review"],dict) and set(row["review"])==fields
            assert all(isinstance(row["review"][k],str) for k in fields-{"evidence"})
            assert row["review"]["status"] in ("open","investigating","resolved","accepted")
            assert isinstance(row["review"]["evidence"],list)

def retain_revision_selection(provenance,raw,origin_path,selected_path):
    # Bank the exact input first, so an interrupted origin->selection write
    # continues the same complete decision without another runtime observation.
    content=REVISION_JOIN/"selected-inputs"/(digest(raw)+".json")
    write(content,raw)
    bound={**provenance,"selectionContent":file_identity(content)}
    write(origin_path,raw_json(bound))
    write(selected_path,raw)
    return bound

def revision_selection(options,directory,queue_directory,previous,source,rows,environment,descriptors):
    queue_result=closed_course(queue_directory,QUEUE_OPERATION)
    run=read_json(pathlib.Path(queue_directory)/"RUN_RESULT.json")
    chain=read_json(QUEUE_JOIN/"COMPLETE.json")
    assert chain["operation"]==OPERATION and chain["queue"]==queue_result
    assert run["input"]["workspace"]==str(CASE/"workspaces"/"author")
    assert run["input"]["workspaceId"]==chain["input"]["workspaceId"]
    selected_path=REVISION_JOIN/"SELECTION.json";origin_path=REVISION_JOIN/"SELECTION_SOURCE.json"
    initial=pathlib.Path(directory)/"INPUT.json"
    if previous:
        assert previous["queueDirectory"]==str(queue_directory)
        assert previous["workspace"]==run["input"]["workspace"] and previous["workspaceId"]==run["input"]["workspaceId"]
        assert previous["sourceBlob"]==REVISION_SOURCE and previous["applicationSource"]==rows
        for key in ("selection","selectionSource","queueComplete","queueResult","queueArchive"):verify_file(previous[key])
        assert previous["queueComplete"]==file_identity(pathlib.Path(queue_directory)/"COMPLETE.json")
        assert previous["queueResult"]==file_identity(pathlib.Path(queue_directory)/"RUN_RESULT.json")
        selected_path=pathlib.Path(previous["selection"]["path"])
        if options.revision_review_selection:assert ordinary(options.revision_review_selection)==ordinary(selected_path),"Preserve the original full following-review selection."
        value=read_json(selected_path);valid_revision_specification(value,run["input"]["workspaceId"])
        if initial.exists():assert read_json(initial)["specification"]==value
        return previous
    if selected_path.exists():
        value=read_json(selected_path);provenance=read_json(origin_path)
        assert provenance["queueResult"]==file_identity(pathlib.Path(queue_directory)/"RUN_RESULT.json")
        if options.revision_review_selection:assert ordinary(options.revision_review_selection)==ordinary(selected_path),"Preserve the selected decisions."
    elif origin_path.exists():
        provenance=read_json(origin_path)
        assert provenance["queueResult"]==file_identity(pathlib.Path(queue_directory)/"RUN_RESULT.json")
        if "selectionContent" in provenance:
            verify_file(provenance["selectionContent"]);raw=ordinary(provenance["selectionContent"]["path"])
        elif "selection" in provenance:
            verify_file(provenance["selection"]);raw=ordinary(provenance["selection"]["path"])
        elif "selectedFile" in provenance:
            verify_file(provenance["selectedFile"]);raw=ordinary(provenance["selectedFile"]["path"])
        else:
            verify_file(provenance["originalInput"])
            original=read_json(provenance["originalInput"]["path"])
            assert original["operation"]==REVISION_OPERATION and original["predecessor"]==str(queue_directory)
            raw=raw_json(original["specification"])
        value=json.loads(raw);valid_revision_specification(value,run["input"]["workspaceId"])
        if options.revision_review_selection:assert ordinary(options.revision_review_selection)==raw,"Resume the original selected input."
        write(selected_path,raw)
    elif initial.exists():
        retained=read_json(initial)
        assert retained["operation"]==REVISION_OPERATION and retained["predecessor"]==str(queue_directory)
        assert retained["workspace"]==run["input"]["workspace"] and retained["workspaceId"]==run["input"]["workspaceId"]
        assert retained["applicationSource"]==rows
        value=retained["specification"]
        if options.revision_review_selection:assert read_json(options.revision_review_selection)==value,"Keep the actual already-selected24EA decisions."
        provenance={"kind":"retained-original-revision-review","originalInput":file_identity(initial),
                    "queueResult":file_identity(pathlib.Path(queue_directory)/"RUN_RESULT.json")}
        valid_revision_specification(value,run["input"]["workspaceId"])
        provenance=retain_revision_selection(provenance,raw_json(value),origin_path,selected_path)
    elif options.revision_review_selection:
        raw=ordinary(options.revision_review_selection);value=json.loads(raw)
        valid_revision_specification(value,run["input"]["workspaceId"])
        provenance={"kind":"explicit-original-review-selection","selectedFile":file_identity(options.revision_review_selection),
                    "queueResult":file_identity(pathlib.Path(queue_directory)/"RUN_RESULT.json")}
        provenance=retain_revision_selection(provenance,raw,origin_path,selected_path)
    else:
        helper=ROOT/"PREPARE_REVISION_SELECTION.py"
        assert file_identity(helper)["sha256"]==REVISION_SELECTION_SHA,"Use the complete selected original selection programme."
        result_dir=REVISION_JOIN/"selection-attempts";result_dir.mkdir(parents=True,exist_ok=True)
        number=max((int(p.name) for p in result_dir.iterdir() if p.is_dir() and p.name.isdigit()),default=0)+1
        attempt=result_dir/("%04d"%number);attempt.mkdir()
        target=attempt/"result.json"
        command=[sys.executable,str(helper),"--application",str(source),"--queue",str(queue_directory),
                 "--case",str(CASE),"--output",str(REVISION_JOIN/"selection-desk"),"--result",str(target),
                 "--descriptors",",".join(map(str,descriptors)),"--lock-paths",str(ROOT/"native-controller.lock")+"\n"+str(CASE/"operation.lock")]
        code=run_course("following-review-selection",command,environment,descriptors)
        assert code==0,"Read the complete original selection attempt before continuing."
        result=read_json(target)
        assert result["workspaceId"]==run["input"]["workspaceId"]
        for key in ("source","manifest","open"):verify_file(result[key])
        for row in read_json(result["manifest"]["path"])["files"]:verify_file(row)
        if not result["selection"]:
            event(event="ORIGINAL_FOLLOWING_REVIEW_SOURCE",result=result,
                  continuation="The complete preceding author/recipient/queue remains finished. Use the actual retained source desk and installed Review following revisions for an explicit eligible selection; no source revision or native decision was invented.")
            return None
        verify_file(result["selection"]);raw=ordinary(result["selection"]["path"]);value=json.loads(raw)
        valid_revision_specification(value,run["input"]["workspaceId"])
        provenance={"kind":"intentional-original-corrected-source-reassessment",
                    "queueResult":file_identity(pathlib.Path(queue_directory)/"RUN_RESULT.json"),
                    "selectionResult":file_identity(target),"completeOriginalSource":result["source"],
                    "completeSelectionManifest":result["manifest"],"selection":result["selection"]}
        provenance=retain_revision_selection(provenance,raw,origin_path,selected_path)
    valid_revision_specification(value,run["input"]["workspaceId"])
    bound={"schema":REVISION_SCHEMA,"operation":OPERATION,"revisionOperation":REVISION_OPERATION,
        "revisionDirectory":str(directory),"queueDirectory":str(queue_directory),
        "workspace":run["input"]["workspace"],"workspaceId":run["input"]["workspaceId"],
        "selection":file_identity(selected_path),"selectionSource":file_identity(origin_path),
        "queueComplete":file_identity(pathlib.Path(queue_directory)/"COMPLETE.json"),
        "queueResult":file_identity(pathlib.Path(queue_directory)/"RUN_RESULT.json"),
        "queueArchive":queue_result["archive"],"sourceBlob":REVISION_SOURCE,"application":str(source),"applicationSource":rows}
    write(REVISION_JOIN/"INPUT.json",raw_json(bound))
    return bound

def retain_original_revision_preview(bound,directory):
    provenance=read_json(bound["selectionSource"]["path"])
    value=read_json(bound["selection"]["path"])
    target=pathlib.Path(directory)/"BROWSER_SELECTION.json"
    if provenance["kind"]=="intentional-original-corrected-source-reassessment":
        verify_file(provenance["completeOriginalSource"])
        observed=read_json(provenance["completeOriginalSource"]["path"])
        assert observed["selection"]==value and observed["preview"],"Preserve the complete authored selection and original native preview."
        preview=observed["preview"]
        assert preview["workspaceId"]==bound["workspaceId"] and preview["selection"]=={k:value[k] for k in ("sourceId","toRevisionId","reviewIds")}
        selected={"workspaceId":bound["workspaceId"],"specification":value,"preview":preview}
        # This is original.data's exact encoding, consumed unchanged by82.
        raw=(json.dumps(selected,ensure_ascii=False,sort_keys=True,separators=(",",":"),allow_nan=False)+"\n").encode("utf-8")
        write(target,raw)
    elif target.exists():
        selected=read_json(target)
        assert selected["workspaceId"]==bound["workspaceId"] and selected["specification"]==value,"Keep the already-retained original native preview."

def revision_following(options,directory,queue_directory,previous,node,selected,environment,guard):
    case_guard=os.open(CASE/"operation.lock",os.O_RDWR|os.O_NOFOLLOW)
    fcntl.flock(case_guard,fcntl.LOCK_EX|fcntl.LOCK_NB)
    try:
        source,rows=frozen_revision_source(directory)
        descriptors=(guard,case_guard)
        bound=revision_selection(options,directory,queue_directory,previous,source,rows,environment,descriptors)
        if bound is None:return 0
        retain_original_revision_preview(bound,directory)
        launcher=FOLLOWING/"launchers"/(digest(RECIPIENT_LAUNCHER.encode())+".py")
        write(launcher,RECIPIENT_LAUNCHER.encode())
        locks=str(ROOT/"native-controller.lock")+"\n"+str(CASE/"operation.lock")
        command=[sys.executable,str(launcher),str(source),"AUDIT_REVISION_REVIEW_RECEIVING",
            ",".join(map(str,descriptors)),locks,"--completed-queue",str(queue_directory),
            "--directory",str(directory),"--selection",bound["selection"]["path"],"--node",node,
            "--chromium",selected["executablePath"],"--playwright-module",selected["module"]]
        code=run_course("revision-impact-review",command,environment,descriptors)
        if code:return code
        outcome=closed_course(directory,REVISION_OPERATION)
        complete={"schema":REVISION_SCHEMA,"operation":OPERATION,"input":bound,"revisionReview":outcome,
            "renderedRecipientReady":False,
            "viewing":"Operate and personally view the real desktop/narrow review, original pending recovery, full source/decision ZIP, working files and both whole applications in their normal recipient applications."}
        write(REVISION_JOIN/"COMPLETE.json",raw_json(complete))
        event(event="ORIGINAL_REVISION_REVIEW_COMPLETE",result=complete)
        return 0
    finally:os.close(case_guard)

def revision_uploads():
    result=[]
    selected=REVISION_JOIN/"INPUT.json"
    if not selected.exists():return result
    bound=read_json(selected);directory=pathlib.Path(bound["revisionDirectory"])
    if not (directory/"COMPLETE.json").exists():return result
    complete=closed_course(directory,REVISION_OPERATION)
    paths=[pathlib.Path(complete["archive"]["path"])]
    for name in ("browser/Audit_Revision_Review.zip","Audit_Revision_Review_Application.zip","Audit_Revision_Review_Received_Application.zip"):
        path=directory/name
        assert path.is_file() and not path.is_symlink(),str(path)
        paths.append(path)
    return [{"local_path":str(p),"purpose":"create_library_file","library_artifact_type":"other"} for p in paths]

def main():
    ROOT.mkdir(parents=True,exist_ok=True)
    guard=os.open(ROOT/"native-controller.lock",os.O_RDWR|os.O_CREAT|os.O_NOFOLLOW,0o600)
    fcntl.flock(guard,fcntl.LOCK_EX|fcntl.LOCK_NB)
    try:
        revision_options_value,revision_directory,previous_revision=revision_options()
        queue_options_value,queue_directory,previous_queue=queue_options()
        options,author_args,first,second,previous=recipient_options()
        for predecessor in (first,second):
            assert queue_directory!=predecessor and queue_directory not in predecessor.parents and predecessor not in queue_directory.parents
        for predecessor in (first,second,queue_directory):
            assert revision_directory!=predecessor and revision_directory not in predecessor.parents and predecessor not in revision_directory.parents
        native_runtime()
        node=hydrate()
        selected=browser(node)
        source=inputs(selected)
        temp=ROOT/"tmp"
        temp.mkdir(exist_ok=True)
        environment=dict(os.environ,PYTHONDONTWRITEBYTECODE="1",PYTHONUNBUFFERED="1",AUDIT_RSCRIPT=str(RROOT/"Rscript"),AUDIT_BROWSER_EXECUTABLE=selected["executablePath"],AUDIT_BROWSER_MODULE=selected["module"],TMPDIR=str(temp))
        if previous is not None or (first/"INPUT.json").exists():
            # A following course can already have accepted reviews. Never replay
            # its completed author course as a precondition to original recovery.
            passed_author()
            code=following(options,first,second,previous,node,selected,environment,guard)
            if code==0:
                code=queue_following(queue_options_value,queue_directory,second,previous_queue,node,selected,environment,guard)
            if code==0:
                code=revision_following(revision_options_value,revision_directory,queue_directory,previous_revision,node,selected,environment,guard)
            preserve()
            return code
        attempt_dir=ROOT/"native-attempts"
        attempt_dir.mkdir(exist_ok=True)
        numbers=[int(p.name) for p in attempt_dir.iterdir() if p.name.isdigit()]
        attempt=attempt_dir/("%04d"%(max(numbers,default=0)+1))
        attempt.mkdir()
        command=[sys.executable,str(APP/"COMMISSIONING.py"),"--application",str(APP),"--directory",str(CASE),"--inputs",str(source)]
        command.extend(author_args)
        write(attempt/"invocation.json",raw_json({"operation":OPERATION,"command":command,"sourceBlob":EXPECTED,"at":datetime.datetime.now(datetime.timezone.utc).isoformat()}))
        with (attempt/"native-output.jsonl").open("wb",buffering=0) as log:
            process=subprocess.Popen(command,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,env=environment,cwd=APP,pass_fds=(guard,))
            write(attempt/"process.json",raw_json({"pid":process.pid,"command":command}))
            for line in process.stdout:
                log.write(line)
                try:
                    item=json.loads(line)
                    keep={key:item[key] for key in ("stage","status","path","sha256","bytes","analysisId","error","diagnostics") if key in item}
                    if "result" in item and isinstance(item["result"],dict):
                        keep["resultKeys"]=list(item["result"])
                    event(event="ORIGINAL_AUDIT_OPERATION",**keep)
                except ValueError:
                    event(event="ORIGINAL_AUDIT_OUTPUT",line=line.decode(errors="replace")[-2000:])
            process.wait()
        write(attempt/"exit.json",raw_json({"exit":process.returncode}))
        event(event="ORIGINAL_AUDIT_EXIT",exit=process.returncode,attempt=str(attempt))
        if process.returncode:
            for name in ("browser-native.log","author-server.log"):
                saved=CASE/"logs"/name
                if saved.is_file(): event(event="ORIGINAL_NATIVE_DIAGNOSTIC",file=name,tail=saved.read_text(errors="replace")[-8000:])
        if process.returncode == 0:
            code=following(options,first,second,None,node,selected,environment,guard)
            if code==0:
                code=queue_following(queue_options_value,queue_directory,second,previous_queue,node,selected,environment,guard)
        else:
            code=process.returncode
        if code==0:
            code=revision_following(revision_options_value,revision_directory,queue_directory,previous_revision,node,selected,environment,guard)
        preserve()
        return code
    except BaseException as error:
        event(event="ORIGINAL_CONTROLLER_STATE",error=str(error),traceback=traceback.format_exc())
        try: preserve()
        except BaseException as capture:
            event(event="ORIGINAL_DELIVERY_STATE",error=str(capture),traceback=traceback.format_exc())
        return 1
    finally: os.close(guard)
if __name__=="__main__": raise SystemExit(main())
