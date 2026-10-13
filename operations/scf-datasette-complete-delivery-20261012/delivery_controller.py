import base64,fcntl,hashlib,json,os,pathlib,selectors,shutil,stat,subprocess,sys,tempfile,threading,time,traceback,zipfile
from datetime import datetime,timezone
P=pathlib.Path
OP="SCF-DATASETTE-SOURCE-EDITIONS-07476-20261012"
def stamp():return datetime.now(timezone.utc).isoformat()
def emit(stage,**items):print(json.dumps({"stage":stage,"at":stamp(),**items},separators=(",",":")),flush=True)
def digest(path):
    h=hashlib.sha256()
    with P(path).open("rb") as f:
        for block in iter(lambda:f.read(1024*1024),b""):h.update(block)
    return h.hexdigest()
def save_json(path,value):
    path=P(path);path.parent.mkdir(mode=0o700,parents=True,exist_ok=True)
    temp=path.with_name(path.name+".pending-"+str(os.getpid()))
    with temp.open("w",encoding="utf-8") as f:
        json.dump(value,f,indent=2,sort_keys=True);f.write("\n");f.flush();os.fsync(f.fileno())
    os.replace(temp,path)
    directory=os.open(path.parent,os.O_RDONLY)
    try:os.fsync(directory)
    finally:os.close(directory)
def read_json(path):
    try:return json.loads(P(path).read_bytes())
    except (FileNotFoundError,json.JSONDecodeError):return None
def public_save(row):
    keys=("local_path","status","library_file_id","file_id","file_name","current_version_number","error_code","bytes")
    return {k:row[k] for k in keys if k in row}
def succeeded(row):return row.get("status")=="succeeded" and bool(row.get("library_file_id")) and bool(row.get("file_id"))
os.umask(0o077);sys.dont_write_bytecode=True
original_root=os.environ.get("DATASETTE_DELIVERY_ROOT")
root=P(original_root).resolve(strict=True) if original_root else P(tempfile.mkdtemp(prefix="datasette-publisher-a49aa-",dir="/dev"))
if original_root and not (root/"delivery-input.json").is_file():raise RuntimeError("Resume requires the complete retained original delivery directory.")
transfer_root=P(os.environ.get("DATASETTE_TRANSFER_DIRECTORY",str(root)))
transfer_root.mkdir(mode=0o700,parents=True,exist_ok=True)
tmp=transfer_root/"private-temp";tmp.mkdir(mode=0o700,exist_ok=True)
os.environ["TMPDIR"]=str(tmp);tempfile.tempdir=str(tmp)
os.environ.setdefault("AZCOPY_CONCURRENCY_VALUE","4")
os.environ["GIT_TERMINAL_PROMPT"]="0"
node=P(os.environ.get("CODEX_PRIMARY_RUNTIME_NODE") or "/opt/codex/runtimes/codex-primary-runtime/dependencies/node/bin/node")
os.environ["PATH"]=str(node.parent)+os.pathsep+os.environ.get("PATH","")
os.environ["npm_config_cache"]=str(tmp/"npm-cache")
os.environ["npm_config_update_notifier"]="false"
helpers=root/"helpers";helpers.mkdir(mode=0o700,exist_ok=True)
for name,content in payload["helpers"].items():
    if P(name).name!=name:raise RuntimeError("Unexpected helper path.")
    (helpers/name).write_text(content,encoding="utf-8")
sys.path.insert(0,str(helpers))
lease=(root/"delivery-controller.lock").open("a+b")
fcntl.flock(lease.fileno(),fcntl.LOCK_EX|fcntl.LOCK_NB)
source_identity={"operation":OP,"capsule_sha256":payload["capsule_sha256"],"installed_source_ref":payload["installed_source_ref"],"installed_runner_sha256":payload["installed_runner_sha256"],"original_request":payload["original_request"]}
retained=read_json(root/"delivery-input.json")
if retained and retained!=source_identity:
    successor=payload.get("installed_source_successor",{})
    expected=dict(retained);expected["installed_source_ref"]=successor.get("to")
    if (retained.get("installed_source_ref")!=successor.get("from") or source_identity!=expected
        or successor.get("from")!="3038f81d9a99f785be987281824df0ee537c187a"
        or successor.get("to")!="a78709d02d323924446702a851e85bcf256f2437"
        or successor.get("source_owner_reply")!="1791837691.027549"
        or (root/"installed/installed-browser-journey.json").exists()):
        raise RuntimeError("The retained original delivery source and request differ.")
    selection={"selected_at":stamp(),"previous":retained,"selected":source_identity,"source_owner":successor}
    selection_path=root/"run-history"/"installed-source-selection-a78709d.json"
    prior_selection=read_json(selection_path)
    if prior_selection:
        if any(prior_selection.get(k)!=selection[k] for k in ("previous","selected","source_owner")):raise RuntimeError("The original installed selection history differs.")
    else:save_json(selection_path,selection)
    emit("datasette_installed_source_selected",previous=successor["from"],selected=successor["to"],source_owner_reply=successor["source_owner_reply"])
save_json(root/"delivery-input.json",source_identity)
(root/"delivery-payload.json").write_text(json.dumps(payload,separators=(",",":")),encoding="utf-8")
(root/"run-delivery.py").write_text('import json\nfrom pathlib import Path\npayload=json.loads((Path(__file__).parent/"delivery-payload.json").read_bytes())\nexec(compile(payload["driver"],"<Datasette complete original delivery>","exec"))\n',encoding="utf-8")
(root/"delivery-controller.py").write_text(payload["driver"],encoding="utf-8")
emit("datasette_receiver_accepted",operation=OP,pid=os.getpid(),procfs_pid=os.readlink("/proc/self"),root=str(root),original_request=payload["original_request"])
outcome={"schema":"commons.datasette-complete-installed-delivery.v1",**source_identity,"root":str(root),"started_at":stamp(),"state":"RUNNING"}
done=threading.Event()
def progress():
    previous={}
    while not done.wait(15):
        for label,name in (("publisher",root/"journey/publisher-programme-state.json"),("installed",root/"installed/installed-browser-journey.json")):
            value=read_json(name)
            if value:
                state={k:value[k] for k in ("id","phase","runId","updatedAt","completedAt") if k in value}
                if state!=previous.get(label):emit("datasette_progress",programme=label,**state);previous[label]=state
threading.Thread(target=progress,daemon=True).start()
def run(arguments,label,cwd=None,timeout=None,checkpoint_callback=None):
    out=root/(label+".stdout");err=root/(label+".stderr")
    started=time.monotonic()
    with out.open("wb") as stdout,err.open("wb") as stderr:
        process=subprocess.Popen([str(a) for a in arguments],cwd=str(cwd or root),
            stdin=subprocess.PIPE if checkpoint_callback else subprocess.DEVNULL,
            stdout=subprocess.PIPE,stderr=subprocess.PIPE,start_new_session=True)
        emit("datasette_process_started",phase=label,pid=process.pid)
        select=selectors.DefaultSelector()
        select.register(process.stdout,selectors.EVENT_READ,(stdout,"stdout"));select.register(process.stderr,selectors.EVENT_READ,(stderr,"stderr"))
        pending={"stdout":b"","stderr":b""}
        try:
            while select.get_map():
                if timeout and time.monotonic()-started>timeout:
                    raise TimeoutError(label+" did not finish within its selected runtime, including checkpoint saves.")
                for key,_ in select.select(timeout=1):
                    stream,kind=key.data;raw=os.read(key.fileobj.fileno(),65536)
                    if not raw:
                        select.unregister(key.fileobj);key.fileobj.close();continue
                    stream.write(raw);stream.flush();pending[kind]+=raw
                    while b"\n" in pending[kind]:
                        line,pending[kind]=pending[kind].split(b"\n",1)
                        if not line.startswith(b"{") or len(line)>=6000:continue
                        try:value=json.loads(line)
                        except json.JSONDecodeError:continue
                        if not isinstance(value,dict):continue
                        if "phase" in value or "stage" in value or "state" in value:
                            emit("datasette_native_progress",programme=label,channel=kind,event=value)
                        if value.get("stage")!="datasette_installed_checkpoint_requested":continue
                        if kind!="stderr" or checkpoint_callback is None:
                            raise RuntimeError("Checkpoint control is only available to the original installed invocation.")
                        stdout.flush();stderr.flush();os.fsync(stdout.fileno());os.fsync(stderr.fileno())
                        try:
                            response=checkpoint_callback(value)
                            if timeout and time.monotonic()-started>timeout:
                                raise TimeoutError("The complete installed checkpoint was saved after the selected invocation timeout.")
                        except Exception as error:
                            response={"protocol":value.get("protocol"),"operation":OP,"requestId":value.get("requestId"),
                                "status":"FAILED","error":{"type":type(error).__name__,"message":str(error)}}
                        process.stdin.write((json.dumps(response,separators=(",",":"))+"\n").encode());process.stdin.flush()
            code=process.wait()
        finally:
            select.close()
            if process.stdin is not None:
                try:process.stdin.close()
                except BrokenPipeError:pass
            if process.poll() is None:
                # Give the waiting runner time to retain its EOF failure before
                # stopping only this controller-owned process group.
                try:process.wait(5)
                except subprocess.TimeoutExpired:
                    import signal
                    os.killpg(process.pid,signal.SIGTERM)
                    try:process.wait(10)
                    except subprocess.TimeoutExpired:os.killpg(process.pid,signal.SIGKILL);process.wait()
    emit("datasette_process_exited",phase=label,returncode=code,seconds=round(time.monotonic()-started,2))
    if code:
        raise RuntimeError(label+" returned "+str(code)+": "+err.read_text(errors="replace")[-6000:])
    return {"returncode":code,"stdout":str(out),"stderr":str(err)}
def save_files(paths,label):
    request={"uploads":[{"local_path":str(path),"purpose":"create_library_file","library_artifact_type":"report" if path.suffix==".json" else "other"} for path in paths]}
    completed=subprocess.run([sys.executable,helpers/"library_private_upload.py",tmp],input=json.dumps(request).encode(),stdout=subprocess.PIPE,stderr=subprocess.PIPE)
    (tmp/(label+".stdout")).write_bytes(completed.stdout);(tmp/(label+".stderr")).write_bytes(completed.stderr)
    for line in completed.stderr.decode(errors="replace").splitlines():
        if line.startswith("__OPENAI_LIBRARY_FILE_WRITE_RECEIPT_V1__"):print(line,flush=True)
    if completed.returncode:raise RuntimeError("Canonical save helper failed: "+str(completed.returncode))
    response=json.loads(completed.stdout);rows=response.get("results")
    if not isinstance(rows,list) or len(rows)!=len(paths):raise RuntimeError("The canonical save returned another artifact selection.")
    for path,row in zip(paths,rows):
        if row.get("local_path")!=str(path):raise RuntimeError("The save returned another original local file.")
        if row.get("status")=="succeeded" and not succeeded(row):raise RuntimeError("The saved file identity is incomplete.")
    return rows

def persist_complete_phase(original_outcome,phase):
    outcome=json.loads(json.dumps(original_outcome))
    outcome["checkpoint_phase"]=phase
    if phase=="publisher":outcome["state"]="PUBLISHER_COMPLETE"
    delivery_result={}
    def delivered(**values):
        delivery_result.update({"state":outcome["state"],"checkpoint_phase":phase,**values})
        emit("datasette_delivery_saved",**delivery_result)
    outcome["finished_at"]=stamp()
    capacity={"observed_at":stamp(),"cgroup":{},"filesystems":{}}
    for name in ("memory.stat","memory.current","memory.max","memory.events"):
        path=P("/sys/fs/cgroup")/name
        try:capacity["cgroup"][name]=path.read_text(encoding="utf-8").strip()
        except OSError as error:capacity["cgroup"][name]={"error":type(error).__name__,"errno":error.errno}
    for selected_path in ("/workspace/scratch/49aa6abb32bb","/dev/shm","/dev","/mnt/data"):
        try:
            value=os.statvfs(selected_path)
            capacity["filesystems"][selected_path]={"total_bytes":value.f_blocks*value.f_frsize,"free_bytes":value.f_bfree*value.f_frsize,"available_bytes":value.f_bavail*value.f_frsize,"free_inodes":value.f_favail}
        except OSError as error:capacity["filesystems"][selected_path]={"error":type(error).__name__,"errno":error.errno}
    outcome["host_capacity_at_save"]=capacity
    save_json(root/"host-capacity-at-save.json",capacity)
    emit("datasette_host_capacity_at_save",**capacity)
    names={
        "publisher":("Datasette_Publisher_Complete_Result.json","Datasette_Publisher_Complete_Checkpoint.zip","Datasette_Operating_Checkpoint_Parts.json"),
        "installed":("Datasette_Publisher_Installed_Operating_Result.json","Datasette_Publisher_Installed_Operating_Checkpoint.zip","Datasette_Operating_Checkpoint_Parts.json"),
        "installed-ready":("Datasette_Installed_Ready_Result.json","Datasette_Installed_Ready_Checkpoint.zip","Datasette_Installed_Ready_Checkpoint_Parts.json"),
    }
    if phase not in names:raise RuntimeError("Unknown original checkpoint phase.")
    if phase=="installed-ready" and outcome["state"]!="INSTALLED_SOURCE_VERIFIED":raise RuntimeError("The installed checkpoint must retain its actual source-verified state.")
    report_name,archive_name,parts_name=names[phase]
    report=root/report_name
    save_json(report,outcome)
    # Preserve the complete original outcome before creating its large archive.
    # The same successful report receipt is reused by the final delivery.
    report_saved=None
    try:
        report_saved=save_files([report],"complete-report-first")[0]
        if succeeded(report_saved):
            emit("datasette_operating_report_saved",checkpoint_phase=phase,state=outcome["state"],saved=public_save(report_saved),bytes=report.stat().st_size,sha256=digest(report))
        else:
            emit("datasette_operating_report_retry",checkpoint_phase=phase,error_code=report_saved.get("error_code"),status=report_saved.get("status"))
    except Exception as error:
        emit("datasette_operating_report_retry",checkpoint_phase=phase,error_type=type(error).__name__,message=str(error))
    prior_manifest=root/"complete-checkpoint-manifest.json"
    if prior_manifest.is_file():
        previous_digest=digest(prior_manifest)
        retained_manifest=root/"run-history"/"checkpoint-manifests"/(previous_digest+".json")
        retained_manifest.parent.mkdir(mode=0o700,parents=True,exist_ok=True)
        if retained_manifest.exists():
            if digest(retained_manifest)!=previous_digest:raise RuntimeError("The preceding checkpoint manifest changed.")
        else:shutil.copy2(prior_manifest,retained_manifest)
    export=transfer_root/"export";export.mkdir(mode=0o700,exist_ok=True)
    archive_path=export/archive_name
    members=[];directories=[];excluded=[]
    with zipfile.ZipFile(archive_path,"w",compression=zipfile.ZIP_DEFLATED,compresslevel=6,allowZip64=True) as z:
        for folder,dirs,files in os.walk(root,followlinks=False):
            if P(folder)!=root:
                info=P(folder).stat()
                directories.append({"path":P(folder).relative_to(root).as_posix(),"mode":stat.S_IMODE(info.st_mode),"mtime_ns":info.st_mtime_ns})
            dirs.sort();files.sort()
            for name in list(dirs):
                path=P(folder)/name
                if path in (tmp,export):
                    excluded.append({"path":path.relative_to(root).as_posix(),"kind":"reproducible-temporary-cache" if path==tmp else "generated-export"});dirs.remove(name)
                elif path.is_symlink():
                    info=path.lstat();rel=path.relative_to(root).as_posix()
                    data=os.readlink(path).encode()
                    zi=zipfile.ZipInfo(rel);zi.create_system=3;zi.external_attr=(stat.S_IFLNK|0o777)<<16;z.writestr(zi,data)
                    members.append({"path":rel,"kind":"symlink","target":os.readlink(path)});dirs.remove(name)
            for name in files:
                path=P(folder)/name;rel=path.relative_to(root).as_posix();info=path.lstat()
                if rel=="complete-checkpoint-manifest.json":excluded.append({"path":rel,"kind":"preceding-manifest-preserved-in-run-history"});continue
                if stat.S_ISSOCK(info.st_mode):excluded.append({"path":rel,"kind":"runtime-socket"});continue
                if stat.S_ISLNK(info.st_mode):
                    data=os.readlink(path).encode();zi=zipfile.ZipInfo(rel);zi.create_system=3;zi.external_attr=(stat.S_IFLNK|0o777)<<16;z.writestr(zi,data)
                    members.append({"path":rel,"kind":"symlink","target":os.readlink(path)});continue
                if not stat.S_ISREG(info.st_mode):excluded.append({"path":rel,"kind":"non-regular-runtime-member"});continue
                z.write(path,rel);members.append({"path":rel,"bytes":info.st_size,"sha256":digest(path),"mtime_ns":info.st_mtime_ns})
        z.writestr("complete-checkpoint-manifest.json",json.dumps({"schema":"commons.datasette-complete-checkpoint.v1","operation":OP,"original_root":str(root),"state":outcome["state"],"source":source_identity,"files":members,"directories":directories,"excluded":excluded},indent=2)+"\n")
    archive_identity={"file_name":archive_path.name,"bytes":archive_path.stat().st_size,"sha256":digest(archive_path),"members":len(members)+1}
    emit("datasette_complete_checkpoint",state=outcome["state"],**archive_identity)
    if report_saved is not None and succeeded(report_saved):
        saved=[save_files([archive_path],"complete-archive-save-01")[0],report_saved]
    else:
        saved=save_files([archive_path,report],"complete-save-01")
    for i,row in enumerate(saved):
        if not succeeded(row) and row.get("error_code")=="transfer_failed":
            emit("datasette_save_transfer_retry",artifact=[archive_path,report][i].name)
            saved[i]=save_files([[archive_path,report][i]],"complete-save-retry-"+str(i))[0]
    if all(succeeded(row) for row in saved):
        delivered(mode="complete_archive",archive=archive_identity,saved=[public_save(row) for row in saved])
    else:
        parts=[];partsdir=export/"parts";partsdir.mkdir(mode=0o700,exist_ok=True)
        with archive_path.open("rb") as source:
            while True:
                data=source.read(10*1024*1024)
                if not data:break
                path=partsdir/(archive_path.name+".part-"+str(len(parts)+1).zfill(3));path.write_bytes(data);parts.append(path)
        rows=save_files(parts,"complete-parts-save-01")
        for i,row in enumerate(rows):
            if not succeeded(row) and row.get("error_code")=="transfer_failed":rows[i]=save_files([parts[i]],"complete-part-retry-"+str(i))[0]
        if not succeeded(saved[1]):saved[1]=save_files([report],"complete-report-retry")[0]
        manifest=export/parts_name
        value={"schema":"commons.complete-checkpoint-parts.v1","operation":OP,"state":outcome["state"],"archive":archive_identity,"parts":[{"order":i+1,"file_name":path.name,"bytes":path.stat().st_size,"sha256":digest(path),"saved":public_save(rows[i])} for i,path in enumerate(parts)],"report":public_save(saved[1]),"assembly":"Concatenate the complete raw part files in ascending order, verify the complete archive byte count and SHA256, then restore its original retained root before resuming the same journals."}
        save_json(manifest,value);manifest_row=save_files([manifest],"complete-parts-manifest")[0]
        if all(succeeded(row) for row in [*rows,saved[1],manifest_row]):delivered(mode="complete_archive_parts",archive=archive_identity,parts=value["parts"],saved=[public_save(saved[1]),public_save(manifest_row)])
        else:
            emit("datasette_save_retry_required",root=str(root),archive=archive_identity,saved=[public_save(row) for row in [*saved,*rows,manifest_row]])
            while True:
                line=sys.stdin.readline()
                if not line:raise RuntimeError("The full original Datasette checkpoint awaits canonical save at "+str(archive_path))
                if json.loads(line).get("action")!="retry-save":continue
                needed=[i for i,row in enumerate(saved) if not succeeded(row)]
                updates=save_files([[archive_path,report][i] for i in needed],"complete-held-save")
                for i,row in zip(needed,updates):saved[i]=row
                if all(succeeded(row) for row in saved):
                    delivered(mode="complete_archive",archive=archive_identity,saved=[public_save(row) for row in saved]);break
                emit("datasette_save_retry_required",root=str(root),archive=archive_identity,saved=[public_save(row) for row in saved])
    return delivery_result


def valid_installed_checkpoint_delivery(delivery):
    if not isinstance(delivery,dict):return False
    archive=delivery.get("archive",{});saved=delivery.get("saved",[])
    if (delivery.get("state")!="INSTALLED_SOURCE_VERIFIED" or delivery.get("checkpoint_phase")!="installed-ready"
        or type(archive.get("bytes")) is not int or archive["bytes"]<=0
        or not isinstance(archive.get("sha256"),str) or len(archive["sha256"])!=64
        or any(character not in "0123456789abcdef" for character in archive["sha256"])
        or not isinstance(saved,list) or len(saved)!=2 or not all(isinstance(row,dict) and succeeded(row) for row in saved)):return False
    if delivery.get("mode")=="complete_archive":return True
    parts=delivery.get("parts")
    return (delivery.get("mode")=="complete_archive_parts" and isinstance(parts,list) and bool(parts)
        and all(isinstance(part,dict) and part.get("order")==index+1 and type(part.get("bytes")) is int and part["bytes"]>0
            and isinstance(part.get("sha256"),str) and len(part["sha256"])==64
            and all(character in "0123456789abcdef" for character in part["sha256"])
            and isinstance(part.get("saved"),dict) and succeeded(part["saved"]) for index,part in enumerate(parts))
        and sum(part["bytes"] for part in parts)==archive["bytes"])

def installed_checkpoint(request):
    import uuid
    if (request.get("stage")!="datasette_installed_checkpoint_requested"
        or request.get("protocol")!="controller-stdio-v1" or request.get("operation")!=OP):
        raise RuntimeError("The installed checkpoint control operation differs.")
    request_id=request.get("requestId")
    if not isinstance(request_id,str) or str(uuid.UUID(request_id))!=request_id:
        raise RuntimeError("The original installed checkpoint request identity differs.")
    journal_path=root/"installed/installed-browser-journey.json"
    if request.get("journalFile")!=str(journal_path):raise RuntimeError("Checkpoint must read the original installed journal.")
    journal=read_json(journal_path)
    if (not journal or journal.get("schema")!="stellar-forge.datasette-installed-browser-journey.v1"
        or journal.get("phase")!="INSTALLED_SOURCE_VERIFIED"):
        raise RuntimeError("The installed runner has not paused at its source-verified journal.")
    original_input=journal["input"];build=journal["build"];runtime=journal["runtime"]
    installation=journal["installation"];source=journal["installedSource"]
    if (original_input["sourceRef"]!=source_identity["installed_source_ref"]
        or original_input["repository"]!=str(root/"canonical-repository")
        or original_input["publisherProgrammeDirectory"]!=str(root/"journey")
        or original_input["outputDirectory"]!=str(root/"installed")
        or build.get("sourceCommit")!=source_identity["installed_source_ref"]
        or runtime.get("status")!="READY" or not runtime.get("ready")
        or runtime.get("sourceCommit")!=source_identity["installed_source_ref"]
        or source.get("sourceCommit")!=source_identity["installed_source_ref"]
        or source.get("sourceRoot")!=runtime.get("sourceRoot")
        or not all(journal.get("checks",{}).get(key) is True for key in (
            "selectedSourceBuilt","installedRuntimeReady","originalGzipRetained","pythonTypesRetained","typedClientExports"))):
        raise RuntimeError("The original installed source or complete runtime selection differs.")
    expected={"journalId":journal["id"],"workspaceId":original_input["workspaceId"],
        "sourceCommit":original_input["sourceRef"],"buildArchive":build["archive"],
        "buildSha256":build["sha256"],"buildBytes":build["archiveBytes"],
        "runtimeDirectory":installation["directory"],"sourceRoot":runtime["sourceRoot"]}
    if request.get("binding")!=expected:raise RuntimeError("The checkpoint request differs from its original journal/build/runtime.")
    selected=[item for item in journal.get("installedCheckpoints",[]) if item.get("id")==request_id]
    if len(selected)!=1 or selected[0].get("binding")!=expected or selected[0].get("status")!="REQUESTED":
        raise RuntimeError("The installed checkpoint request was not durably retained by its original runner.")
    archive=P(expected["buildArchive"]);archive.resolve(strict=True).relative_to(root)
    runtime_directory=P(expected["runtimeDirectory"]).resolve(strict=True);runtime_directory.relative_to(root)
    P(expected["sourceRoot"]).resolve(strict=True).relative_to(runtime_directory)
    if archive.stat().st_size!=expected["buildBytes"] or digest(archive)!=expected["buildSha256"]:
        raise RuntimeError("The complete installed build changed before its checkpoint.")
    receipt_path=root/"run-history/installed-ready-checkpoints"/(request_id+".json")
    upload_path=receipt_path.with_name(request_id+".upload.json")
    receipt=read_json(receipt_path)
    if receipt:
        if (receipt.get("schema")!="commons.datasette-installed-ready-checkpoint.v1"
            or receipt.get("operation")!=OP or receipt.get("root")!=str(root)
            or receipt.get("source")!=source_identity or receipt.get("request")!=request
            or not valid_installed_checkpoint_delivery(receipt.get("delivery"))):
            raise RuntimeError("The retained installed checkpoint receipt differs.")
        emit("datasette_installed_ready_checkpoint_reused",request_id=request_id,archive=receipt["delivery"]["archive"])
    else:
        checkpoint_outcome={**outcome,"state":"INSTALLED_SOURCE_VERIFIED","installed_state":journal,
            "installed_checkpoint_request":request}
        delivery=persist_complete_phase(checkpoint_outcome,"installed-ready")
        if not valid_installed_checkpoint_delivery(delivery):raise RuntimeError("The complete installed checkpoint did not finish its original save.")
        receipt={"schema":"commons.datasette-installed-ready-checkpoint.v1","operation":OP,"root":str(root),
            "source":source_identity,"request":request,"delivery":delivery,"saved_at":stamp()}
        save_json(receipt_path,receipt)
    receipt_sha=digest(receipt_path)
    uploaded=read_json(upload_path)
    if uploaded:
        if (uploaded.get("request_id")!=request_id or uploaded.get("receipt_sha256")!=receipt_sha
            or not isinstance(uploaded.get("saved"),dict) or not succeeded(uploaded["saved"])):
            raise RuntimeError("The retained installed checkpoint receipt upload differs.")
        saved=uploaded["saved"]
    else:
        saved=save_files([receipt_path],"installed-ready-receipt-"+request_id)[0]
        if not succeeded(saved):raise RuntimeError("The complete checkpoint receipt still needs its original save.")
        save_json(upload_path,{"request_id":request_id,"receipt_sha256":receipt_sha,"saved":public_save(saved)})
    outcome["installed_ready_checkpoint"]=receipt["delivery"]
    outcome["installed_ready_receipt"]={"path":str(receipt_path),"sha256":receipt_sha,"saved":public_save(saved)}
    emit("datasette_installed_ready_checkpoint_saved",request_id=request_id,archive=receipt["delivery"]["archive"],receipt=outcome["installed_ready_receipt"])
    return {"protocol":"controller-stdio-v1","operation":OP,"requestId":request_id,"status":"SAVED",
        "binding":request["binding"],"savedAt":receipt["saved_at"],"delivery":receipt["delivery"],"receipt":public_save(saved)}

def compact_original_checkout(repository,source_commit):
    # The restored checkout is a reproducible copy of this receiver's retained
    # Git objects. Keep the entire immutable object database and original commit.
    expected=root/"canonical-repository"
    if repository!=expected or repository.resolve()!=repository or not (repository/".git").is_dir() or (repository/".git").is_symlink():
        raise RuntimeError("The original private Git checkout identity differs.")
    git=["git","-C",str(repository)]
    def query(args):
        return subprocess.check_output(git+args,text=True).strip()
    if query(["rev-parse","--show-toplevel"])!=str(repository) or query(["rev-parse","HEAD"])!=source_commit:
        raise RuntimeError("The selected original Git checkout differs.")
    # Git can remove ignored files when applying a cone. Preserve the complete
    # checkout if any original tracked, untracked or ignored work is present.
    status=subprocess.run(git+["status","--porcelain=v1","--untracked-files=all","--ignored=matching"],capture_output=True,text=True)
    if status.returncode or status.stdout:
        emit("datasette_original_checkout_retained",reason="working-copy-state-present",status_returncode=status.returncode)
        return {"state":"FULL_CHECKOUT_RETAINED","reason":"working-copy-state-present"}
    previous_sparse=subprocess.run(git+["config","--bool","core.sparseCheckout"],capture_output=True,text=True)
    if previous_sparse.returncode not in (0,1) or previous_sparse.stdout.strip()=="true":
        emit("datasette_original_checkout_retained",reason="existing-sparse-configuration",configuration_returncode=previous_sparse.returncode)
        return {"state":"EXISTING_CHECKOUT_SCOPE_RETAINED","reason":"existing-sparse-configuration","configuration_returncode":previous_sparse.returncode}
    parser=r'''
const fs=require("node:fs"),path=require("node:path"),vm=require("node:vm");
const {createHash}=require("node:crypto"),{builtinModules}=require("node:module");
const root=fs.realpathSync(process.argv[1]),base="stellar/scf-starforge-20261009/distribution/";
const builtins=new Set([...builtinModules,...builtinModules.map(name=>"node:"+name)]);
const queued=[base+"build.mjs",base+"runtime-install.mjs"],seen=new Set(),directories=new Set([base.slice(0,-1)]),modules=[];
const context=vm.createContext();
while(queued.length){
 const relative=queued.shift();if(seen.has(relative))continue;seen.add(relative);
 const file=path.resolve(root,relative),inside=path.relative(root,file);
 if(!inside||inside.startsWith(".."+path.sep)||inside===".."||path.isAbsolute(inside)||fs.realpathSync(file)!==file)
  throw new Error("Build-tool source must remain a regular original repository member");
 const info=fs.lstatSync(file);if(!info.isFile()||info.size>2*1024*1024)throw new Error("Build-tool source size/type differs");
 const bytes=fs.readFileSync(file);
 directories.add(path.dirname(relative).split(path.sep).join("/"));
 modules.push({path:relative,bytes:bytes.length,sha256:createHash("sha256").update(bytes).digest("hex")});
 if(relative.endsWith(".json"))continue;
 if(!/\.(mjs|js)$/.test(relative))throw new Error("Keep full checkout for this original module format");
 const parsed=new vm.SourceTextModule(bytes.toString("utf8"),{identifier:file,context});
 for(const request of parsed.dependencySpecifiers){
  if(builtins.has(request))continue;
  if(!request.startsWith(".")||request.includes("?")||request.includes("#"))
   throw new Error("Keep full checkout for this original module dependency");
  queued.push(path.relative(root,path.resolve(path.dirname(file),request)).split(path.sep).join("/"));
 }
}
process.stdout.write(JSON.stringify({directories:[...directories].sort(),modules}));
'''
    try:
        parsed=subprocess.run([node,"--max-old-space-size=64","--no-warnings","--experimental-vm-modules","--input-type=commonjs","--eval",parser,str(repository)],capture_output=True,text=True,timeout=60)
    except (OSError,subprocess.TimeoutExpired) as error:
        emit("datasette_original_checkout_retained",reason="native-build-tool-closure-unavailable",error_type=type(error).__name__)
        return {"state":"FULL_CHECKOUT_RETAINED","reason":"native-build-tool-closure-unavailable","error_type":type(error).__name__}
    if parsed.returncode:
        emit("datasette_original_checkout_retained",reason="native-build-tool-closure-returned",returncode=parsed.returncode)
        return {"state":"FULL_CHECKOUT_RETAINED","reason":"native-build-tool-closure-returned","returncode":parsed.returncode}
    closure=json.loads(parsed.stdout)
    directories=closure["directories"]
    if not directories or any(not value or value=="." or P(value).is_absolute() or ".." in P(value).parts for value in directories):
        emit("datasette_original_checkout_retained",reason="whole-root-build-tool-dependency")
        return {"state":"FULL_CHECKOUT_RETAINED","reason":"whole-root-build-tool-dependency"}
    def allocation():
        total=0;members=0
        for folder,dirs,files in os.walk(repository,followlinks=False):
            if P(folder)==repository:dirs[:]=[name for name in dirs if name!=".git"]
            for name in files:
                info=(P(folder)/name).lstat();total+=getattr(info,"st_blocks",0)*512;members+=1
        return {"allocated_bytes":total,"files":members}
    before=allocation()
    try:
        run(git+["sparse-checkout","set","--cone","--no-sparse-index","--",*directories],"canonical-git-working-copy-scope")
        if query(["rev-parse","HEAD"])!=source_commit:
            raise RuntimeError("The original immutable Git source changed.")
        for member in closure["modules"]:
            source=repository/member["path"]
            if source.resolve()!=source or not source.is_file() or source.stat().st_size!=member["bytes"] or digest(source)!=member["sha256"]:
                raise RuntimeError("An original build-tool member changed during sparse checkout.")
    except Exception:
        # Use Git's own reversible recovery; never remove or reconstruct source.
        run(git+["sparse-checkout","disable"],"canonical-git-working-copy-full-recovery")
        raise
    after=allocation()
    value={"state":"ORIGINAL_GIT_CHECKOUT_SCOPED","source_commit":source_commit,"directories":directories,"build_tool_modules":closure["modules"],
        "before":before,"after":after,"released_allocated_bytes":max(0,before["allocated_bytes"]-after["allocated_bytes"]),
        "restore_command":["git","-C",str(repository),"sparse-checkout","disable"],
        "original_objects_retained":True}
    save_json(root/"canonical-working-copy.json",value)
    emit("datasette_original_checkout_scoped",source_commit=source_commit,directories=directories,before=before,after=after,released_allocated_bytes=value["released_allocated_bytes"])
    return value


native_error=None
try:
    raw=payload["capsule_raw"].encode("utf-8")
    if hashlib.sha256(raw).hexdigest()!=payload["capsule_sha256"]:raise RuntimeError("The original complete publisher capsule differs.")
    capsule=json.loads(raw)
    if capsule["operationId"]!=OP or len(capsule["files"])!=119:raise RuntimeError("Use the whole original 119-file publisher programme.")
    (root/"publisher-capsule.json").write_bytes(raw)
    (root/"publisher-native.py").write_text(capsule["runnerSource"],encoding="utf-8")
    version=subprocess.check_output([node,"--version"],text=True).strip()
    if int(version.lstrip("v").split(".")[0])<24:raise RuntimeError("The maintained programme requires the existing Node24.")
    asset_pins=[]
    for item in payload.get("publisher_source_assets",[]):
        relative=pathlib.PurePosixPath(item["path"])
        if relative.is_absolute() or ".." in relative.parts:raise RuntimeError("Original supplemental asset path differs.")
        data=item["content"].encode("utf-8")
        if len(data)!=item["bytes"] or hashlib.sha256(data).hexdigest()!=item["sha256"]:raise RuntimeError("The retained original publisher asset differs.")
        destination=root/"source"/relative
        destination.parent.mkdir(mode=0o700,parents=True,exist_ok=True)
        if destination.exists() and digest(destination)!=item["sha256"]:raise RuntimeError("A publisher supplemental asset changed.")
        destination.write_bytes(data)
        asset_pins.append({key:item[key] for key in ("path","bytes","sha256","git_blob_sha","source_ref")})
    save_json(root/"publisher-original-assets.json",asset_pins)
    outcome["publisher_original_assets"]=asset_pins
    emit("datasette_publisher_started",operation=OP,source_files=len(capsule["files"]),supplemental_source_files=len(asset_pins),input_files=len(capsule["inputs"]),node=version,journal=str(root/"journey/publisher-programme-state.json"))
    effective=json.loads(json.dumps(capsule))
    effective_files={item["path"]:item for item in effective["files"]}
    for item in payload.get("publisher_source_assets",[]):
        if item["path"] in effective_files:raise RuntimeError("Supplemental original file is already selected.")
        supplied={key:item[key] for key in ("path","content","bytes","sha256")}
        effective["files"].append(supplied);effective_files[item["path"]]=supplied
    applied=[]
    for item in payload.get("publisher_source_overlays",[]):
        prior=effective_files.get(item["path"])
        if prior is None or prior["sha256"]!=item["preimage_sha256"]:raise RuntimeError("Source correction preimage differs.")
        data=item["content"].encode("utf-8")
        if len(data)!=item["bytes"] or hashlib.sha256(data).hexdigest()!=item["sha256"]:raise RuntimeError("Complete source correction differs.")
        prior.update({key:item[key] for key in ("content","bytes","sha256")})
        applied.append({key:item[key] for key in ("path","bytes","sha256","preimage_sha256")})
    effective["sourceRecovery"]={"originalCapsuleSha256":payload["capsule_sha256"],"originalAssets":asset_pins,"postimages":applied}
    effective_raw=json.dumps(effective,separators=(",",":")).encode("utf-8")
    (root/"publisher-effective-capsule.json").write_bytes(effective_raw)
    outcome["publisher_source_selection"]={"files":len(effective["files"]),"bytes":len(effective_raw),"sha256":hashlib.sha256(effective_raw).hexdigest(),"postimages":applied}
    namespace={"q":{"capsule":effective},"root":str(root),"__name__":"__datasette_original_publisher__"}
    try:exec(compile(capsule["runnerSource"],"<original 119-file publisher runner>","exec"),namespace)
    except SystemExit as error:
        if error.code not in (None,0):raise RuntimeError("Original publisher runner returned "+str(error.code)+": "+(root/"native.stderr").read_text(errors="replace")[-9000:])
    native=read_json(root/"native-result.json")
    programme=read_json(root/"journey/publisher-programme-result.json")
    journal=read_json(root/"journey/publisher-programme-state.json")
    if not native or native.get("returncode")!=0 or not journal or journal.get("phase")!="COMPLETE":raise RuntimeError("The original publisher has not reached its completed journal.")
    if programme.get("sourceRefresh",{}).get("state")!="COMPLETE" or not programme.get("mcpReceiving",{}).get("passed") or programme.get("managedUpload",{}).get("resumed",{}).get("state")!="COMPLETE":raise RuntimeError("The whole original refresh, upload and MCP receiving programme must complete.")
    outcome["publisher_native"]=native;outcome["publisher"]=programme
    emit("datasette_publisher_complete",journal=str(root/"journey/publisher-programme-state.json"),received_workspace=programme.get("receiving",{}).get("directory"),refresh=programme["sourceRefresh"]["state"],mcp_passed=programme["mcpReceiving"]["passed"])
    prior_delivery=read_json(root/"Datasette_Publisher_Installed_Operating_Result.json") or {}
    prior_publisher_save=prior_delivery.get("publisher_checkpoint",{})
    if (all(prior_delivery.get(key)==value for key,value in source_identity.items())
        and prior_delivery.get("publisher")==programme
        and prior_publisher_save.get("state")=="PUBLISHER_COMPLETE"
        and prior_publisher_save.get("mode")=="complete_archive"
        and len(prior_publisher_save.get("saved",[]))==2
        and all(succeeded(row) for row in prior_publisher_save["saved"])):
        outcome["publisher_checkpoint"]=prior_publisher_save
        emit("datasette_publisher_checkpoint_reused",archive=prior_publisher_save["archive"],saved=prior_publisher_save["saved"])
    else:outcome["publisher_checkpoint"]=persist_complete_phase(outcome,"publisher")
    repository=root/"canonical-repository";repository.mkdir(mode=0o700,exist_ok=True)
    if not (repository/".git").is_dir():
        run(["git","init",repository],"canonical-git-init")
        run(["git","-C",repository,"remote","add","origin",payload["repository_url"]],"canonical-git-origin")
    git_directory=repository/".git"
    shape={name:{"directory":(git_directory/name).is_dir(),"file":(git_directory/name).is_file()} for name in ("HEAD","config","objects","refs")}
    emit("datasette_restored_git_layout",**shape)
    if not (git_directory/"refs").exists():
        if (not (git_directory/"objects").is_dir() or not (git_directory/"config").is_file()
            or not (git_directory/"HEAD").is_file()
            or (git_directory/"HEAD").read_text().strip()!=payload["installed_source_ref"]):
            raise RuntimeError("The retained Git metadata differs from its original detached source.")
        original_head=(git_directory/"HEAD").read_bytes()
        run(["git","-C",repository,"init"],"canonical-git-restore-directories")
        if (git_directory/"HEAD").read_bytes()!=original_head:raise RuntimeError("The original Git HEAD changed while restoring its directories.")
    resolved=subprocess.run(["git","-C",repository,"rev-parse","--verify",payload["installed_source_ref"]+"^{commit}"],capture_output=True,text=True)
    if resolved.returncode:
        run(["git","-C",repository,"-c","http.version=HTTP/1.1","-c","pack.threads=1","-c","pack.windowMemory=32m","fetch","--depth","1","--no-tags","origin",payload["installed_source_ref"]],"canonical-git-fetch",timeout=600)
    run(["git","-C",repository,"checkout","--detach",payload["installed_source_ref"]],"canonical-git-checkout")
    got=subprocess.check_output(["git","-C",repository,"rev-parse","HEAD"],text=True).strip()
    if got!=payload["installed_source_ref"]:raise RuntimeError("The canonical installed Git source differs.")
    outcome["installed_git"]={"commit":got,"repository":payload["repository_url"],"directory":str(repository)}
    outcome["installed_git"]["working_copy"]=compact_original_checkout(repository,got)
    continuation=root/"installed-continuation";continuation.mkdir(mode=0o700,exist_ok=True)
    for file in payload["installed_files"]:
        data=file["content"].encode()
        if len(data)!=file["bytes"] or hashlib.sha256(data).hexdigest()!=file["sha256"]:raise RuntimeError("The complete installed source postimage differs.")
        (continuation/P(file["path"]).name).write_bytes(data)
    for repair in payload.get("installed_runner_repairs",[]):
        relative=P(repair["path"])
        if relative.name!=str(relative):raise RuntimeError("Installed continuation repair must name its original runner.")
        target=continuation/relative
        before=target.read_bytes()
        after=repair["content"].encode("utf-8")
        if hashlib.sha256(before).hexdigest()!=repair["before_sha256"] or hashlib.sha256(after).hexdigest()!=repair["sha256"]:
            raise RuntimeError("The exact installed continuation repair source differs.")
        original=continuation/("original-"+repair["before_sha256"]+"-"+relative.name)
        if original.exists():
            if original.read_bytes()!=before:raise RuntimeError("The retained original runner differs.")
        else:original.write_bytes(before)
        target.write_bytes(after)
        outcome.setdefault("installed_runner_repairs",[]).append({key:repair[key] for key in ("path","before_sha256","sha256","reason","source_reply")})
        emit("datasette_installed_runner_repaired",**outcome["installed_runner_repairs"][-1])
    browser_home=root/"native-browser";browser_home.mkdir(mode=0o700,exist_ok=True)
    modules=P(os.environ.get("CODEX_PRIMARY_RUNTIME_NODE_MODULES","/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules"))
    module_candidates=[]
    if os.environ.get("DATASETTE_PLAYWRIGHT"):module_candidates.append(P(os.environ["DATASETTE_PLAYWRIGHT"]))
    for base in (modules,root/"native-browser/node/node_modules"):
        for name in ("playwright/index.mjs","playwright/index.js","playwright-core/index.mjs","playwright-core/index.js"):module_candidates.append(base/name)
    playwright=next((path for path in module_candidates if path.is_file()),None)
    if playwright is None:
        # Select the actual published version once and retain its npm package lock.
        run([node.parent/"npm","view","playwright","version","--json","--registry=https://registry.npmjs.org"],"browser-package-version",timeout=120)
        selected_version=json.loads((root/"browser-package-version.stdout").read_text())
        import re
        if not isinstance(selected_version,str) or not re.fullmatch(r"[0-9]+[.][0-9]+[.][0-9]+(?:-[A-Za-z0-9.-]+)?",selected_version):raise RuntimeError("The published browser runtime version is invalid.")
        run([node.parent/"npm","install","--prefix",browser_home/"node","--ignore-scripts","--no-audit","--no-fund","--save-exact","playwright@"+selected_version,"--registry=https://registry.npmjs.org"],"browser-runtime-install",timeout=600)
        playwright=browser_home/"node/node_modules/playwright/index.mjs"
        if not playwright.is_file():playwright=playwright.with_name("index.js")
        if not playwright.is_file():raise RuntimeError("The installed browser module is missing.")
    probe=browser_home/"describe.mjs"
    probe.write_text('import {pathToFileURL} from "node:url";\nconst loaded=await import(pathToFileURL(process.argv[2]).href);\nconst chromium=loaded.chromium ?? loaded.default?.chromium;\nif(!chromium)throw new Error("The selected runtime has no Chromium launcher.");\nconsole.log(JSON.stringify({module:process.argv[2],executable:chromium.executablePath()}));\n',encoding="utf-8")
    run([node,probe,playwright],"browser-runtime-location",timeout=60)
    browser_description=json.loads((root/"browser-runtime-location.stdout").read_text())
    candidates=[P(value) for value in (os.environ.get("DATASETTE_CHROMIUM"),browser_description.get("executable"),shutil.which("chromium"),shutil.which("chromium-browser"),shutil.which("google-chrome"),"/workspace/scratch/64b7f381b23e/browser-runtime/chrome-151.0.7922.34/chrome-linux64/chrome","/tmp/chromium","/workspace/scratch/97c4b0da767a/hif-browser-runtime/extracted/chromium","/workspace/scratch/5403360e55a4/counterpress-capture-runtime/bin/chromium","/workspace/scratch/b57f9a30380a/browser-runtime/chromium-153/chromium","/workspace/scratch/bc0850d7ba23/browser-runtime/chrome-headless-shell") if value]
    chromium=next((path for path in candidates if path.is_file() and os.access(path,os.X_OK)),None)
    if chromium is None:
        os.environ["PLAYWRIGHT_BROWSERS_PATH"]=str(browser_home/"browsers")
        cli=playwright.parent/"cli.js"
        if not cli.is_file():raise RuntimeError("The selected browser runtime has no original installer.")
        run([node,cli,"install","chromium"],"browser-chromium-install",timeout=600)
        run([node,probe,playwright],"browser-installed-location",timeout=60)
        browser_description=json.loads((root/"browser-installed-location.stdout").read_text())
        chromium=P(browser_description["executable"])
        if not chromium.is_file() or not os.access(chromium,os.X_OK):raise RuntimeError("The original Chromium installer did not return its executable.")
    run([chromium,"--version"],"browser-executable-version",timeout=60)
    outcome["browser_runtime"]={"playwright_module":str(playwright),"chromium":str(chromium),"version":(root/"browser-executable-version.stdout").read_text().strip(),"retained_directory":str(browser_home)}
    emit("datasette_browser_runtime_ready",**outcome["browser_runtime"])
    installed_input={"repository":str(repository),"sourceRef":got,"publisherProgrammeDirectory":str(root/"journey"),"outputDirectory":str(root/"installed"),"playwrightModule":str(playwright),"browserExecutable":str(chromium),"port":53173,"receivedPort":53174,"offline":False,"npmCache":str(tmp/"npm-cache"),"python":sys.executable,"npm":str(node.parent/"npm")}
    installed_input["installedCheckpoint"]={"protocol":"controller-stdio-v1","operation":OP}
    save_json(root/"installed-input.json",installed_input)
    emit("datasette_installed_started",source_ref=got,port=53173,received_port=53174,publisher_directory=str(root/"journey"))
    run([node,continuation/"run-installed.mjs","--input",root/"installed-input.json"],"installed-programme",timeout=1800,checkpoint_callback=installed_checkpoint)
    installed_journal=read_json(root/"installed/installed-browser-journey.json")
    if not installed_journal or installed_journal.get("phase")!="COMPLETE":raise RuntimeError("The actual installed browser programme did not reach COMPLETE.")
    outcome.update({"state":"COMPLETE","installed":installed_journal,"completed_at":stamp()})
    emit("datasette_installed_complete",checks=installed_journal.get("checks"),workspace_id=installed_journal.get("input",{}).get("workspaceId"),browser_errors=len(installed_journal.get("browserErrors",[])),artifacts=len(installed_journal.get("artifacts",[])))
except BaseException as error:
    if isinstance(error,KeyboardInterrupt):raise
    native_error={"type":type(error).__name__,"message":str(error),"traceback":traceback.format_exc()}
    outcome.update({"state":"PRESERVED_FOR_CONTINUATION","error":native_error,"publisher_state":read_json(root/"journey/publisher-programme-state.json"),"publisher_native":read_json(root/"native-result.json"),"installed_state":read_json(root/"installed/installed-browser-journey.json")})
    emit("datasette_original_continuation_preserved",error_type=native_error["type"],message=native_error["message"])
finally:
    done.set()
final_delivery=None
try:
    final_delivery=persist_complete_phase(outcome,"installed")
except Exception as error:
    if not payload.get("retain_receiver"):raise
    outcome["complete_save_continuation"]={"type":type(error).__name__,"message":str(error),"traceback":traceback.format_exc()}
    emit("datasette_complete_save_continuation",root=str(root),**outcome["complete_save_continuation"])
fcntl.flock(lease.fileno(),fcntl.LOCK_UN);lease.close()
after_installed_source=payload.get("after_installed_source")
following_completed=after_installed_source is None

def run_original_following(source,source_sha):
    global following_completed
    following_completed=False
    if not isinstance(source,str) or hashlib.sha256(source.encode("utf-8")).hexdigest()!=source_sha:
        raise RuntimeError("The complete following source identity differs.")
    folder=root/"continuation-source";folder.mkdir(mode=0o700,exist_ok=True)
    path=folder/(source_sha+".py")
    if path.exists():
        if path.read_text(encoding="utf-8")!=source:raise RuntimeError("The retained following source differs.")
    else:
        source_fd,temporary_name=tempfile.mkstemp(prefix=path.name+".pending-",dir=folder)
        temporary_source=P(temporary_name)
        with os.fdopen(source_fd,"w",encoding="utf-8") as saved_source:
            saved_source.write(source);saved_source.flush();os.fsync(saved_source.fileno())
        if digest(temporary_source)!=source_sha:raise RuntimeError("The retained following source bytes differ.")
        os.replace(temporary_source,path)
        directory=os.open(folder,os.O_RDONLY)
        try:os.fsync(directory)
        finally:os.close(directory)
    attempts=root/"run-history"/"following-attempts";attempts.mkdir(mode=0o700,parents=True,exist_ok=True)
    receipt=attempts/(str(time.time_ns())+"-"+str(os.getpid())+".json")
    record={"schema":"commons.datasette-complete-following.v1","operation":OP,"root":str(root),
            "source_sha256":source_sha,"source":str(path),"started_at":stamp(),"state":"RUNNING"}
    save_json(receipt,record)
    emitted_error=None
    try:
        emit("datasette_after_installed_source_started",sha256=source_sha,path=str(path),receipt=str(receipt))
        try:exec(compile(source,str(path),"exec"),{"delivery_payload":payload,"delivery_root":root,"__name__":"__main__"})
        except SystemExit as stopped:
            if stopped.code not in (None,0):raise
        report=root/"Conapi_Complete_Operating_Result.json"
        report_value=read_json(report) or {}
        saved_file=root/"Conapi_Complete_Delivery_Saved.json"
        saved=read_json(saved_file) or {}
        workbook=report_value.get("workbook",{})
        if (report_value.get("schema")!="commons.conapi-complete-delivery.v1"
            or report_value.get("originalOperation")!=OP
            or report_value.get("operation")!="CONAPI-WORKFLOW-RECEIVING-DSCEB3-20261012"
            or report_value.get("sourceRef")!="e5520a2a962ccebc461d478edf6aebb4b6c7fb20"
            or report_value.get("state") not in ("COMPLETE","SUPPLIER_RECEIVING_COMPLETE")
            or report_value.get("native",{}).get("returncode")!=0
            or report_value.get("programme",{}).get("phase")!=report_value.get("state")
            or report_value.get("error") or report_value.get("interruption")
            or workbook.get("state")!="COMPLETE"
            or workbook.get("operation")!="CONAPI-SUPPLIER-WORKBOOK-RECEIVING-7A2F-20261012"
            or workbook.get("native",{}).get("returncode")!=0
            or workbook.get("result",{}).get("schema")!="conapi.supplier-workbook-receiving.v1"
            or workbook.get("result",{}).get("status")!="COMPLETE"):
            raise RuntimeError("The original complete Conapi and workbook result requires continuation.")
        if (saved.get("state")!=report_value["state"]
            or saved.get("mode") not in ("complete_archive","complete_archive_parts")
            or len(saved.get("saved",[]))!=2 or not all(succeeded(row) for row in saved["saved"])):
            raise RuntimeError("The original complete Conapi archive and report have not both been saved.")
        archive=saved.get("archive",{})
        if not isinstance(archive.get("bytes"),int) or archive["bytes"]<=0 or not isinstance(archive.get("sha256"),str) or len(archive["sha256"])!=64:
            raise RuntimeError("The original complete Conapi archive identity differs.")
        if saved["mode"]=="complete_archive_parts":
            parts=saved.get("parts",[])
            if (not parts or [part.get("order") for part in parts]!=list(range(1,len(parts)+1))
                or any(not isinstance(part.get("bytes"),int) or part["bytes"]<=0 or not succeeded(part.get("saved",{})) for part in parts)
                or sum(part["bytes"] for part in parts)!=archive["bytes"]):
                raise RuntimeError("The original complete Conapi archive parts require continuation.")
        record.update({"state":"COMPLETE","conapi_state":report_value["state"],
            "report":{"path":str(report),"bytes":report.stat().st_size,"sha256":digest(report)},
            "delivery_receipt":{"path":str(saved_file),"bytes":saved_file.stat().st_size,"sha256":digest(saved_file)},
            "delivery":saved,"workbook_operation":workbook["operation"]})
    except BaseException as error:
        emitted_error=error
        record.update({"state":"PRESERVED_FOR_CONTINUATION","error":{"type":type(error).__name__,
                       "message":str(error),"traceback":traceback.format_exc()}})
    finally:
        record["finished_at"]=stamp()
        save_json(receipt,record)
        report=root/"Datasette_Complete_Following_Result.json";save_json(report,record)
        try:
            saved_receipt=save_files([report],"complete-following-result-"+receipt.stem)[0]
            if not succeeded(saved_receipt):raise RuntimeError("The complete following outcome save requires continuation.")
            delivery={"path":str(report),"bytes":report.stat().st_size,"sha256":digest(report),"saved":public_save(saved_receipt)}
            save_json(receipt.with_name(receipt.stem+".saved.json"),delivery)
            emit("datasette_complete_following_result_saved",state=record["state"],**delivery)
        except Exception as save_error:
            save_json(receipt.with_name(receipt.stem+".save-error.json"),{"type":type(save_error).__name__,"message":str(save_error)})
            emit("datasette_complete_following_result_save_continuation",error_type=type(save_error).__name__,message=str(save_error))
            if emitted_error is None:emitted_error=save_error
    if emitted_error is not None:raise emitted_error
    following_completed=True
    emit("datasette_after_installed_source_returned",sha256=source_sha,receipt=str(receipt),state=record["state"])

if after_installed_source is not None and outcome.get("state")=="COMPLETE" and final_delivery:
    try:
        if not isinstance(after_installed_source,dict):raise RuntimeError("Supply the complete pinned following source.")
        run_original_following(after_installed_source.get("content"),after_installed_source.get("sha256"))
    except BaseException as error:
        if isinstance(error,KeyboardInterrupt):raise
        emit("datasette_after_installed_source_error",error_type=type(error).__name__,message=str(error),traceback=traceback.format_exc())
if payload.get("retain_receiver"):
    if sys.stdin.isatty():
        import termios
        terminal=termios.tcgetattr(sys.stdin.fileno())
        terminal[3]&=~(termios.ICANON|termios.ECHO)
        terminal[6][termios.VMIN]=1;terminal[6][termios.VTIME]=0
        termios.tcsetattr(sys.stdin.fileno(),termios.TCSANOW,terminal)
    emit("datasette_saved_receiver_ready",operation=OP,root=str(root),procfs_pid=os.readlink("/proc/self"),state=outcome["state"])
    for line in sys.stdin.buffer:
        try:
            request=json.loads(line)
            if request.get("operation")!=OP or request.get("root")!=str(root):raise RuntimeError("Continuation belongs to another original operation.")
            if request.get("action")=="close":
                emit("datasette_saved_receiver_closed",state=read_json(root/"Datasette_Publisher_Installed_Operating_Result.json").get("state"))
                break
            if request.get("action")!="source":raise RuntimeError("Supply the complete reviewed continuation source.")
            source=request["source"]
            if hashlib.sha256(source.encode("utf-8")).hexdigest()!=request["sha256"]:raise RuntimeError("Continuation source identity differs.")
            folder=root/"continuation-source";folder.mkdir(mode=0o700,exist_ok=True)
            path=folder/(request["sha256"]+".py")
            if path.exists() and path.read_text()!=source:raise RuntimeError("Saved continuation source differs.")
            path.write_text(source,encoding="utf-8")
            emit("datasette_continuation_source_started",sha256=request["sha256"],path=str(path))
            if after_installed_source is not None and request["sha256"]==after_installed_source.get("sha256"):
                run_original_following(source,request["sha256"])
            else:
                exec(compile(source,str(path),"exec"),{"delivery_payload":payload,"delivery_root":root,"__name__":"__main__"})
            emit("datasette_continuation_source_returned",sha256=request["sha256"])
        except BaseException as error:
            if isinstance(error,KeyboardInterrupt):raise
            emit("datasette_continuation_source_error",error_type=type(error).__name__,message=str(error),traceback=traceback.format_exc())
    last_result=read_json(root/"Datasette_Publisher_Installed_Operating_Result.json")
    if not last_result or last_result.get("state")!="COMPLETE" or not following_completed:raise SystemExit(1)
else:
    if native_error or not following_completed:raise SystemExit(1)
