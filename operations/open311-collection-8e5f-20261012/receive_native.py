#!/usr/bin/env python3
"""Run the original Open311 job, preserve each completed phase, and resume an existing archive delivery."""
import argparse,base64,errno,hashlib,json,os,pathlib,re,signal,stat,subprocess,sys,time,tty,termios

def git_blob(data):
    return hashlib.sha1(b"blob "+str(len(data)).encode("ascii")+b"\0"+data).hexdigest()

def retained_file(path,expected=None):
    selected=pathlib.Path(path).resolve(strict=True)
    if not selected.is_file():
        raise ValueError("Select a complete source file: "+str(selected))
    data=selected.read_bytes()
    if expected and git_blob(data)!=expected:
        raise ValueError("Original Git blob differs: "+str(selected))
    return selected,data

def timestamp():
    return time.strftime("%Y-%m-%dT%H:%M:%SZ",time.gmtime())

def emit(name,value):
    print(name+" "+json.dumps(value,ensure_ascii=False,separators=(",",":")),flush=True)

def fsync_directory(path):
    descriptor=os.open(path,os.O_RDONLY)
    try: os.fsync(descriptor)
    finally: os.close(descriptor)

def write_record(path,value):
    temporary=path.with_name(path.name+".pending-"+str(os.getpid()))
    data=(json.dumps(value,ensure_ascii=False,indent=2)+"\n").encode("utf-8")
    descriptor=os.open(temporary,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
    try:
        with os.fdopen(descriptor,"wb") as stream:
            stream.write(data);stream.flush();os.fsync(stream.fileno())
        os.replace(temporary,path);fsync_directory(path.parent)
    finally:
        if temporary.exists(): temporary.unlink()

def file_identity(value):
    return value.st_dev,value.st_ino,value.st_size,value.st_mtime_ns,value.st_ctime_ns

def whole_hash(path):
    digest=hashlib.sha256();size=0
    with path.open("rb") as stream:
        before=os.fstat(stream.fileno())
        if not stat.S_ISREG(before.st_mode):
            raise ValueError("Select a complete regular archive file.")
        for block in iter(lambda:stream.read(1024*1024),b""):
            size+=len(block);digest.update(block)
        if file_identity(before)!=file_identity(os.fstat(stream.fileno())):
            raise ValueError("The archive changed while its complete bytes were read.")
    return size,digest.hexdigest()

def read_descriptor(path):
    selected=pathlib.Path(path).resolve(strict=True)
    data=selected.read_bytes()
    if len(data)>65536:
        raise ValueError("The archive descriptor exceeds 65536 bytes.")
    value=json.loads(data.decode("utf-8"))
    if not isinstance(value,dict) or value.get("schema")!="commons.native.archive.v1":
        raise ValueError("Use the existing complete native archive descriptor.")
    source=pathlib.Path(value.get("path",""))
    if not source.is_absolute() or source.is_symlink() or not source.is_file():
        raise ValueError("The descriptor must select a complete regular archive by absolute path.")
    if isinstance(value.get("bytes"),bool) or not isinstance(value.get("bytes"),int) or value["bytes"]<=0:
        raise ValueError("The descriptor must retain the complete archive byte count.")
    if not isinstance(value.get("sha256"),str) or not re.fullmatch(r"[0-9a-f]{64}",value["sha256"]):
        raise ValueError("The descriptor must retain the complete archive SHA256.")
    if whole_hash(source)!=(value["bytes"],value["sha256"]):
        raise ValueError("The retained archive differs from its complete original descriptor.")
    return selected,value

def stop_child(child):
    if child is None or child.poll() is not None:
        return
    try: os.killpg(child.pid,signal.SIGTERM)
    except ProcessLookupError: return
    try: child.wait(timeout=5)
    except subprocess.TimeoutExpired:
        os.killpg(child.pid,signal.SIGKILL);child.wait(timeout=5)

def deliver_saved(descriptor_path,sink_path,python,sink_git_blob):
    selected,descriptor=read_descriptor(descriptor_path)
    sink,sink_bytes=retained_file(sink_path,sink_git_blob)
    compile(sink_bytes.decode("utf-8"),str(sink),"exec")
    child=None
    try:
        child=subprocess.Popen([str(python),"-u",str(sink),"--descriptor",str(selected)],
            stdin=sys.stdin,stdout=sys.stdout,stderr=sys.stderr,start_new_session=True)
        exit_code=child.wait()
        if exit_code:
            raise RuntimeError("Archive delivery remains open; continue this exact descriptor and prepared file.")
    finally:
        stop_child(child)
    receipt_path=selected.with_name(selected.stem+".delivery.json")
    delivery=json.loads(receipt_path.read_text("utf-8"))
    if delivery.get("state")!="finalized" or delivery.get("archiveSha256")!=descriptor["sha256"] or delivery.get("bytes")!=descriptor["bytes"]:
        raise RuntimeError("The archive sink did not retain finalization for this complete archive.")
    return delivery

def terminal_raw(enabled):
    if enabled and sys.stdin.isatty():
        original=termios.tcgetattr(sys.stdin.fileno());tty.setraw(sys.stdin.fileno());return original
    return None

def terminal_restore(original):
    if original is not None:
        termios.tcsetattr(sys.stdin.fileno(),termios.TCSADRAIN,original)

parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument("--bootstrap")
parser.add_argument("--source-packet")
parser.add_argument("--reporting-packet",help="Optional retained second operation for the selected collection source.")
parser.add_argument("--wait-for-upload",action="store_true",help="Use the original final-archive upload/finish protocol when no phase delivery sink is selected.")
parser.add_argument("--archive-sink",help="Complete trusted deliver-archive.py source; finalize each phase before the next operation.")
parser.add_argument("--archive-sink-git-blob",default="0c7e2db26eabca28cec217c8bced5c0e037c0cbf")
parser.add_argument("--deliver-existing",metavar="DESCRIPTOR",help="Deliver this original saved archive without starting a bootstrap, Node, browser, or source run.")
parser.add_argument("--output-directory")
parser.add_argument("--node")
parser.add_argument("--node-modules")
parser.add_argument("--chromium")
parser.add_argument("--python",default=sys.executable)
parser.add_argument("--bootstrap-git-blob",default="906d1c2240517e4bac9fd5a95bf720e7ccd0f9d5")
parser.add_argument("--source-git-blob",default="8e731340359628b63e870b7164f5be65109ef4c2")
parser.add_argument("--reporting-git-blob",default="500e844a86063c5a0bacc5a1238a4f29aa113465")
args=parser.parse_args()
os.umask(0o077)
python=pathlib.Path(args.python).resolve(strict=True)
if not python.is_file():
    parser.error("Select the existing Python runtime.")
if args.deliver_existing:
    if not args.archive_sink:
        parser.error("--deliver-existing requires the trusted --archive-sink source.")
    if any((args.bootstrap,args.source_packet,args.reporting_packet,args.output_directory,args.node,args.node_modules,args.chromium)):
        parser.error("Delivery-only continuation uses its existing descriptor and sink; omit source and runtime job arguments.")
    original_terminal=None
    try:
        selected,descriptor=read_descriptor(args.deliver_existing)
        original_terminal=terminal_raw(True)
        emit("OPEN311_LOCAL_DELIVERY_REOPENED",{"descriptor":str(selected),"archive":descriptor})
        delivery=deliver_saved(selected,args.archive_sink,python,args.archive_sink_git_blob)
        emit("OPEN311_LOCAL_RESULT",{"state":"delivered","mode":"delivery-only","archive":descriptor,"delivery":delivery})
        sys.exit(0)
    except Exception as error:
        emit("OPEN311_LOCAL_RESULT",{"state":"delivery-pending","mode":"delivery-only","descriptor":args.deliver_existing,
            "error":{"name":type(error).__name__,"message":str(error)}})
        sys.exit(1)
    finally:
        terminal_restore(original_terminal)
for name in ("bootstrap","source_packet","output_directory","node","node_modules","chromium"):
    if not getattr(args,name):
        parser.error("A new source run requires --"+name.replace("_","-")+".")
bootstrap,bootstrap_bytes=retained_file(args.bootstrap,args.bootstrap_git_blob)
source_path,source_bytes=retained_file(args.source_packet,args.source_git_blob)
report_path,report_bytes=retained_file(args.reporting_packet,args.reporting_git_blob) if args.reporting_packet else (None,None)
packet=json.loads(source_bytes.decode("utf-8"))
reporting=json.loads(report_bytes.decode("utf-8")) if report_bytes is not None else None
if packet.get("schema") not in {"commons.open311.native-collection-job.v1","commons.open311.boston-native-input.v1"}:
    parser.error("Use the complete original collection source packet.")
if reporting is not None and (reporting.get("op")!="reporting" or not isinstance(reporting.get("requestId"),str) or
        not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_-]{0,127}",reporting["requestId"]) or
        not isinstance(reporting.get("files"),list) or not isinstance(reporting.get("runner"),str)):
    parser.error("Use the complete retained reporting operation: op,requestId,files,runner.")
node=pathlib.Path(args.node).resolve(strict=True)
browser=pathlib.Path(args.chromium).resolve(strict=True)
modules=pathlib.Path(args.node_modules).resolve(strict=True)
if not node.is_file() or not browser.is_file() or not (modules/"playwright/index.js").is_file():
    parser.error("Select existing Node, Chromium and the matching Playwright module directory.")
sink=None
if args.archive_sink:
    sink,sink_bytes=retained_file(args.archive_sink,args.archive_sink_git_blob)
    compile(sink_bytes.decode("utf-8"),str(sink),"exec")
output=pathlib.Path(args.output_directory).resolve()
output.mkdir(mode=0o700)
log_path=output/"receiver-events.jsonl"
archive_name=packet.get("archiveFilename","helsinki-collection-reporting.zip")
if not isinstance(archive_name,str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,180}\.zip",archive_name):
    parser.error("Select a plain ZIP archive filename.")
partial=output/(archive_name+".partial")
archive_path=output/archive_name
descriptor_path=output/"archive-descriptor.json"
result_path=output/"receiver-result.json"
environment=os.environ.copy()
environment.update({"OPEN311_NATIVE_PARENT":str(output),"CODEX_PRIMARY_RUNTIME_NODE":str(node),
    "CODEX_PRIMARY_RUNTIME_NODE_MODULES":str(modules),"OPEN311_CHROMIUM_EXECUTABLE":str(browser)})
process=None
collection_result=None
reporting_result=None
archive=None
downloaded=0
digest=hashlib.sha256()
receipt={"schema":"commons.open311.native-receiver.v1","state":"running","startedAt":timestamp(),
    "sourceEdition":packet["edition"],"sourcePacketGitBlob":git_blob(source_bytes),
    "bootstrapGitBlob":git_blob(bootstrap_bytes),"reportingPacketGitBlob":git_blob(report_bytes) if report_bytes is not None else None,
    "reportingRequestId":reporting["requestId"] if reporting is not None else None,
    "waitForUpload":args.wait_for_upload,"phaseDelivery":bool(sink),
    "archiveSinkGitBlob":git_blob(sink_bytes) if sink is not None else None,"checkpoints":[],
    "runtime":{"node":str(node),"python":str(python),"chromium":str(browser),"nodeModules":str(modules)}}
log=log_path.open("x",encoding="utf-8")
part=None
original_terminal=None
sent_source=False
sent_reporting=False
finishing=False
archive_phase=None
continue_reporting=False
def event(name,value,durable=False):
    log.write(json.dumps({"at":timestamp(),"event":name,"value":value},ensure_ascii=False)+"\n")
    log.flush()
    if durable: os.fsync(log.fileno())
def persist():
    receipt["updatedAt"]=timestamp();write_record(result_path,receipt)
def send(value):
    process.stdin.write((json.dumps(value,ensure_ascii=False,separators=(",",":"))+"\n").encode("utf-8"))
    process.stdin.flush()
def chunk_request():
    send({"op":"artifact","offset":downloaded,"limit":49152,"archiveSha256":archive["sha256"]})
def result_summary(value):
    journey=value.get("journey") or {}
    return {"state":value.get("state"),"exitCode":value.get("exitCode"),"timedOut":value.get("timedOut"),
            "root":value.get("root"),"archive":value.get("archive"),
            "journey":{"runId":journey.get("runId"),"state":journey.get("state"),"sourceMode":journey.get("sourceMode"),
                       "checks":len(journey["checks"]) if isinstance(journey.get("checks"),list) else journey.get("checks")},
            "error":journey.get("error") or value.get("error"),"stderr":(value.get("stderr") or "")[-8000:]}
def after_archive_command():
    raw=sys.stdin.buffer.readline(16385)
    if not raw:
        raise RuntimeError("The upload driver ended after the complete archive was saved.")
    if len(raw)>16384 or not raw.endswith(b"\n"):
        raise ValueError("Use one complete upload or finish JSON command.")
    command=json.loads(raw.decode("utf-8"))
    if not isinstance(command,dict) or command.get("op") not in {"upload","finish"}:
        raise ValueError("The completed receiver accepts a prepared upload or finish command.")
    if command["op"]=="upload":
        if command.get("bytes")!=archive["bytes"] or command.get("archiveSha256")!=archive["sha256"]:
            raise ValueError("Select the exact saved complete archive bytes and SHA256.")
        event("upload-request",{"uploadId":command.get("uploadId"),"archiveSha256":archive["sha256"],"bytes":archive["bytes"]},True)
    send(command)
    return command["op"]=="finish"
def checkpoint_saved():
    global sent_reporting,finishing
    saved={"schema":"commons.native.archive.v1","path":str(archive_path),"filename":archive["filename"],
        "bytes":archive["bytes"],"sha256":archive["sha256"],"phase":archive_phase,
        "jobId":archive.get("jobId",packet.get("jobId","native-"+receipt["sourcePacketGitBlob"][:16]))}
    if archive.get("descriptorPath"):
        saved["nativeDescriptorPath"]=archive["descriptorPath"]
    write_record(descriptor_path,saved)
    checkpoint={"phase":archive_phase,"archive":saved,"descriptor":str(descriptor_path),"savedAt":timestamp(),"state":"saved"}
    receipt["checkpoints"].append(checkpoint);receipt["archive"]=saved
    receipt["archiveDescriptor"]=str(descriptor_path)
    receipt["state"]="awaiting-delivery" if sink else "archive-saved"
    persist();event("archive-saved",checkpoint,True)
    emit("OPEN311_LOCAL_ARCHIVE_SAVED",saved)
    if sink:
        try:
            delivery=deliver_saved(descriptor_path,sink,python,args.archive_sink_git_blob)
        except BaseException:
            checkpoint["state"]="delivery-pending";persist();raise
        checkpoint.update({"state":"finalized","delivery":delivery,"finalizedAt":timestamp()})
        persist();event("phase-delivered",checkpoint,True)
        emit("OPEN311_LOCAL_PHASE_DELIVERED",{"phase":archive_phase,"archive":saved,"delivery":delivery})
        if continue_reporting:
            sent_reporting=True;receipt["state"]="reporting";persist();send(reporting)
        else:
            finishing=True;send({"op":"finish"})
    elif args.wait_for_upload:
        emit("OPEN311_LOCAL_UPLOAD_READY",saved);finishing=after_archive_command()
    else:
        finishing=True;send({"op":"finish"})
def local_checkpoint(descriptor):
    candidate=pathlib.Path(descriptor["path"])
    if not candidate.is_absolute() or candidate.is_symlink():
        raise RuntimeError("The native checkpoint must be an absolute regular file in this job.")
    selected=candidate.resolve(strict=True)
    if output not in selected.parents or not selected.is_file():
        raise RuntimeError("The native checkpoint is outside this original receiver output.")
    if whole_hash(selected)!=(descriptor["bytes"],descriptor["sha256"]):
        raise RuntimeError("The complete native checkpoint differs from its descriptor.")
    before=selected.stat()
    try:
        os.link(selected,archive_path)
    except OSError as error:
        if error.errno not in (errno.EXDEV,errno.EPERM,errno.EOPNOTSUPP):
            raise
        copied=hashlib.sha256();size=0
        with selected.open("rb") as source,partial.open("xb") as target:
            for block in iter(lambda:source.read(1024*1024),b""):
                target.write(block);copied.update(block);size+=len(block)
            target.flush();os.fsync(target.fileno())
        if (size,copied.hexdigest())!=(descriptor["bytes"],descriptor["sha256"]):
            raise RuntimeError("The copied complete archive differs.")
        os.link(partial,archive_path);partial.unlink()
    after=selected.stat()
    if file_identity(before)[:4]!=file_identity(after)[:4]:
        raise RuntimeError("The native archive changed while saving its checkpoint.")
    os.chmod(archive_path,0o400);fsync_directory(archive_path.parent)
    checkpoint_saved()
def begin_archive(descriptor,phase,then_reporting=False):
    global archive,part,downloaded,digest,partial,archive_path,descriptor_path,archive_phase,continue_reporting
    if part is not None:
        raise RuntimeError("An original archive transfer is still active.")
    if any(item["phase"]==phase for item in receipt["checkpoints"]):
        raise RuntimeError("This completed phase already has a saved checkpoint.")
    if not isinstance(descriptor,dict) or isinstance(descriptor.get("bytes"),bool) or not isinstance(descriptor.get("bytes"),int) or descriptor["bytes"]<=0 or not isinstance(descriptor.get("sha256"),str) or not re.fullmatch(r"[0-9a-f]{64}",descriptor["sha256"]):
        raise RuntimeError("The complete source archive descriptor is missing.")
    if not isinstance(descriptor.get("filename"),str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,180}\.zip",descriptor["filename"]):
        raise RuntimeError("The complete archive needs its original plain filename.")
    archive=descriptor;archive_phase=phase;continue_reporting=then_reporting
    downloaded=0;digest=hashlib.sha256()
    if sink:
        checkpoints=output/"checkpoints";checkpoints.mkdir(mode=0o700,exist_ok=True)
        directory=checkpoints/phase;directory.mkdir(mode=0o700);fsync_directory(checkpoints)
        archive_path=directory/descriptor["filename"]
        partial=directory/(descriptor["filename"]+".partial")
        descriptor_path=directory/"archive-descriptor.json"
        if descriptor.get("path"):
            local_checkpoint(descriptor);return
    part=partial.open("xb");chunk_request()
try:
    original_terminal=terminal_raw(bool(args.wait_for_upload or sink))
    process=subprocess.Popen([str(python),"-u",str(bootstrap)],stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,stderr=subprocess.STDOUT,env=environment,start_new_session=True)
    receipt["pid"]=process.pid;persist()
    event("started",{"pid":process.pid,"sourcePacketGitBlob":receipt["sourcePacketGitBlob"]},True)
    emit("OPEN311_LOCAL_INPUTS_VERIFIED",{"sourcePacketGitBlob":receipt["sourcePacketGitBlob"],"bootstrapGitBlob":receipt["bootstrapGitBlob"],
        "reportingPacketGitBlob":receipt["reportingPacketGitBlob"],"phaseDelivery":bool(sink),"output":str(output)})
    while True:
        raw=process.stdout.readline()
        if not raw:
            break
        line=raw.decode("utf-8",errors="replace").rstrip("\r\n")
        if line=="OPEN311_NATIVE_READY":
            if sent_source:
                raise RuntimeError("The existing receiver repeated its initial ready state.")
            sent_source=True;send(packet);event("source-fed",{"sourcePacketGitBlob":git_blob(source_bytes)},True)
            print("OPEN311_LOCAL_SOURCE_STARTED",flush=True)
        elif line.startswith("OPEN311_NATIVE_RESULT "):
            if collection_result is not None:
                raise RuntimeError("The collection receiver returned a second original result.")
            collection_result=json.loads(line.split(" ",1)[1]);receipt["collection"]=collection_result
            persist();event("collection-result",collection_result,True)
            emit("OPEN311_LOCAL_COLLECTION_RESULT",result_summary(collection_result))
            if reporting is None or sink:
                begin_archive(collection_result.get("archive"),"collection",reporting is not None)
            else:
                sent_reporting=True;send(reporting)
        elif line.startswith("OPEN311_REPORTING_RESULT "):
            value=json.loads(line.split(" ",1)[1])
            if reporting is None or not sent_reporting or value.get("requestId")!=reporting["requestId"] or reporting_result is not None:
                raise RuntimeError("The reporting result belongs to another retained request or repeated result.")
            reporting_result=value["operation"];receipt["reporting"]=reporting_result
            persist();event("reporting-result",value,True)
            summary={"requestId":value["requestId"],"replayed":value.get("replayed"),"archive":value["archive"],
                     "operation":{"state":reporting_result.get("state"),"payloadHash":reporting_result.get("payloadHash"),
                                  "result":result_summary(reporting_result.get("result") or {})}}
            emit("OPEN311_LOCAL_REPORTING_RESULT",summary)
            begin_archive(value["archive"],"reporting-"+value["requestId"])
        elif line.startswith("OPEN311_NATIVE_CHUNK "):
            if not archive or part is None or finishing:
                raise RuntimeError("Unexpected retained archive chunk.")
            value=json.loads(line.split(" ",1)[1])
            data=base64.b64decode(value["body"],validate=True)
            if value.get("archiveSha256")!=archive["sha256"] or value["offset"]!=downloaded or value["bytes"]!=len(data) or not data:
                raise RuntimeError("The retained archive chunk identity or range differs.")
            part.write(data);digest.update(data);downloaded+=len(data)
            event("archive-chunk",{"offset":value["offset"],"bytes":len(data),"nextOffset":value["nextOffset"]})
            if value["nextOffset"] is None:
                if downloaded!=archive["bytes"] or digest.hexdigest()!=archive["sha256"]:
                    raise RuntimeError("The complete retained archive differs from its original manifest.")
                part.flush();os.fsync(part.fileno());part.close();part=None
                os.chmod(partial,0o400);os.link(partial,archive_path);partial.unlink();fsync_directory(archive_path.parent)
                checkpoint_saved()
            else:
                if value["nextOffset"]!=downloaded or downloaded>=archive["bytes"]:
                    raise RuntimeError("The retained archive continuation did not advance.")
                chunk_request()
        elif line.startswith("OPEN311_NATIVE_UPLOADED "):
            value=json.loads(line.split(" ",1)[1])
            event("archive-upload-result",value,True)
            receipt.setdefault("uploads",[]).append(value);persist()
            emit("OPEN311_LOCAL_UPLOAD_RESULT",value);finishing=after_archive_command()
        elif line=="OPEN311_NATIVE_FINISHED":
            event("native-finished",{},True);break
        elif line.startswith("OPEN311_NATIVE_ERROR ") or line.startswith("OPEN311_NATIVE_COMMAND_ERROR "):
            event("native-error",line,True);raise RuntimeError(line)
        else:
            event("native-progress",line)
            if line.startswith("OPEN311_NATIVE_RUNNING ") or line.startswith("OPEN311_REPORTING_RUNNING "):
                print(line,flush=True)
    process.stdin.close()
    exit_code=process.wait(timeout=15);receipt["bootstrapExitCode"]=exit_code
    receipt["collection"]=collection_result;receipt["reporting"]=reporting_result
    deliveries_complete=not sink or all(item["state"]=="finalized" for item in receipt["checkpoints"])
    complete=exit_code==0 and bool(receipt.get("archive")) and deliveries_complete and collection_result and collection_result.get("state")=="passed" and collection_result.get("exitCode")==0 and (reporting is None or (reporting_result and reporting_result.get("state")=="COMPLETE" and reporting_result.get("result",{}).get("exitCode")==0))
    receipt["state"]="passed" if complete else "failed"
    if not complete:
        receipt["error"]={"message":"Inspect the retained phase results and complete saved archives."}
except BaseException as error:
    receipt["state"]="failed";receipt["error"]={"name":type(error).__name__,"message":str(error)}
    event("receiver-error",receipt["error"],True)
finally:
    receipt["collection"]=collection_result;receipt["reporting"]=reporting_result
    try: terminal_restore(original_terminal)
    except OSError as error: event("terminal-restore",{"name":type(error).__name__,"message":str(error)})
    if part is not None:
        part.flush();part.close()
    stop_child(process)
    receipt["completedAt"]=timestamp();persist()
    event("complete",{"state":receipt["state"],"archive":receipt.get("archive"),"result":str(result_path)},True)
    log.close()
emit("OPEN311_LOCAL_RESULT",{"state":receipt["state"],"result":str(result_path),"archive":receipt.get("archive"),
    "checkpoints":[{"phase":item["phase"],"descriptor":item["descriptor"],"state":item["state"],"delivery":item.get("delivery")} for item in receipt["checkpoints"]],
    "error":receipt.get("error")})
sys.exit(0 if receipt["state"]=="passed" else 1)
