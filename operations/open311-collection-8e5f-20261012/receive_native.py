#!/usr/bin/env python3
"""Run the complete original Open311 collection and reporting job on an existing Linux host."""
import argparse,base64,hashlib,json,os,pathlib,re,signal,subprocess,sys,time,tty,termios

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

parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument("--bootstrap",required=True)
parser.add_argument("--source-packet",required=True)
parser.add_argument("--reporting-packet",help="Optional second reporting operation for the selected collection source.")
parser.add_argument("--wait-for-upload",action="store_true",help="Save the full archive, then retain the bootstrap for a prepared Slack upload and finish command.")
parser.add_argument("--output-directory",required=True)
parser.add_argument("--node",required=True)
parser.add_argument("--node-modules",required=True)
parser.add_argument("--chromium",required=True)
parser.add_argument("--python",default=sys.executable)
parser.add_argument("--bootstrap-git-blob",default="23cd38c71b5c8e845c3b31fd1c4b1661661ef2c4")
parser.add_argument("--source-git-blob",default="8e731340359628b63e870b7164f5be65109ef4c2")
parser.add_argument("--reporting-git-blob",default="500e844a86063c5a0bacc5a1238a4f29aa113465")
args=parser.parse_args()
bootstrap,bootstrap_bytes=retained_file(args.bootstrap,args.bootstrap_git_blob)
source_path,source_bytes=retained_file(args.source_packet,args.source_git_blob)
report_path,report_bytes=retained_file(args.reporting_packet,args.reporting_git_blob) if args.reporting_packet else (None,None)
packet=json.loads(source_bytes.decode("utf-8"))
reporting=json.loads(report_bytes.decode("utf-8")) if report_bytes is not None else None
if packet.get("schema") not in {"commons.open311.native-collection-job.v1","commons.open311.boston-native-input.v1"}:
    parser.error("Use the complete original collection source packet.")
if reporting is not None and (reporting.get("op")!="reporting" or not reporting.get("requestId") or not isinstance(reporting.get("files"),list) or not isinstance(reporting.get("runner"),str)):
    parser.error("Use the complete retained reporting operation: op,requestId,files,runner.")
node=pathlib.Path(args.node).resolve(strict=True)
browser=pathlib.Path(args.chromium).resolve(strict=True)
modules=pathlib.Path(args.node_modules).resolve(strict=True)
python=pathlib.Path(args.python).resolve(strict=True)
if not node.is_file() or not browser.is_file() or not python.is_file() or not (modules/"playwright/index.js").is_file():
    parser.error("Select existing Node, Python, Chromium and the matching Playwright module directory.")
output=pathlib.Path(args.output_directory).absolute()
output.mkdir(mode=0o700)
log_path=output/"receiver-events.jsonl"
archive_name=packet.get("archiveFilename","helsinki-collection-reporting.zip")
if not isinstance(archive_name,str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,180}\.zip",archive_name):
    parser.error("Select a plain ZIP archive filename.")
partial=output/(archive_name+".partial")
archive_path=output/archive_name
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
    "reportingRequestId":reporting["requestId"] if reporting is not None else None,"waitForUpload":args.wait_for_upload,"runtime":{"node":str(node),"python":str(python),
    "chromium":str(browser),"nodeModules":str(modules)}}
log=log_path.open("x",encoding="utf-8")
part=None
original_terminal=None
def event(name,value):
    log.write(json.dumps({"at":timestamp(),"event":name,"value":value},ensure_ascii=False)+"\n")
    log.flush()
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
def begin_archive(descriptor):
    global archive,part
    if archive is not None or part is not None:
        raise RuntimeError("The original archive was already selected.")
    if not isinstance(descriptor,dict) or not isinstance(descriptor.get("bytes"),int) or descriptor["bytes"]<=0 or not re.fullmatch(r"[0-9a-f]{64}",descriptor.get("sha256","")):
        raise RuntimeError("The complete source archive descriptor is missing.")
    archive=descriptor;part=partial.open("xb");chunk_request()
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
        event("upload-request",{"uploadId":command.get("uploadId"),"archiveSha256":archive["sha256"],"bytes":archive["bytes"]})
    send(command)
    return command["op"]=="finish"
try:
    if args.wait_for_upload and sys.stdin.isatty():
        original_terminal=termios.tcgetattr(sys.stdin.fileno())
        tty.setraw(sys.stdin.fileno())
    process=subprocess.Popen([str(python),"-u",str(bootstrap)],stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,stderr=subprocess.STDOUT,env=environment,start_new_session=True)
    receipt["pid"]=process.pid
    event("started",{"pid":process.pid,"sourcePacketGitBlob":receipt["sourcePacketGitBlob"]})
    sent_source=False;sent_reporting=False;finishing=False
    print("OPEN311_LOCAL_INPUTS_VERIFIED "+json.dumps({"sourcePacketGitBlob":receipt["sourcePacketGitBlob"],"bootstrapGitBlob":receipt["bootstrapGitBlob"],"reportingPacketGitBlob":receipt["reportingPacketGitBlob"],"output":str(output)}),flush=True)
    while True:
        raw=process.stdout.readline()
        if not raw:
            break
        line=raw.decode("utf-8",errors="replace").rstrip("\r\n")
        if line=="OPEN311_NATIVE_READY":
            if sent_source:
                raise RuntimeError("The existing receiver repeated its initial ready state.")
            sent_source=True;send(packet);event("source-fed",{"sourcePacketGitBlob":git_blob(source_bytes)})
            print("OPEN311_LOCAL_SOURCE_STARTED",flush=True)
        elif line.startswith("OPEN311_NATIVE_RESULT "):
            if collection_result is not None:
                raise RuntimeError("The collection receiver returned a second original result.")
            collection_result=json.loads(line.split(" ",1)[1])
            event("collection-result",collection_result)
            print("OPEN311_LOCAL_COLLECTION_RESULT "+json.dumps(result_summary(collection_result),separators=(",",":")),flush=True)
            if reporting is None:
                begin_archive(collection_result.get("archive"))
            else:
                sent_reporting=True;send(reporting)
        elif line.startswith("OPEN311_REPORTING_RESULT "):
            value=json.loads(line.split(" ",1)[1])
            if reporting is None or value.get("requestId")!=reporting["requestId"]:
                raise RuntimeError("The reporting result belongs to another retained request.")
            reporting_result=value["operation"]
            event("reporting-result",value)
            summary={"requestId":value["requestId"],"replayed":value.get("replayed"),"archive":value["archive"],
                     "operation":{"state":reporting_result.get("state"),"payloadHash":reporting_result.get("payloadHash"),
                                  "result":result_summary(reporting_result.get("result") or {})}}
            print("OPEN311_LOCAL_REPORTING_RESULT "+json.dumps(summary,separators=(",",":")),flush=True)
            begin_archive(value["archive"])
        elif line.startswith("OPEN311_NATIVE_CHUNK "):
            if not archive or part is None or finishing:
                raise RuntimeError("Unexpected retained archive chunk.")
            value=json.loads(line.split(" ",1)[1])
            data=base64.b64decode(value["body"],validate=True)
            if value.get("archiveSha256")!=archive["sha256"] or value["offset"]!=downloaded or value["bytes"]!=len(data):
                raise RuntimeError("The retained archive chunk identity or range differs.")
            part.write(data);digest.update(data);downloaded+=len(data)
            event("archive-chunk",{"offset":value["offset"],"bytes":len(data),"nextOffset":value["nextOffset"]})
            if value["nextOffset"] is None:
                if downloaded!=archive["bytes"] or digest.hexdigest()!=archive["sha256"]:
                    raise RuntimeError("The complete retained archive differs from its original manifest.")
                part.flush();os.fsync(part.fileno());part.close();part=None
                os.link(partial,archive_path);partial.unlink()
                receipt["archive"]={"path":str(archive_path),"filename":archive["filename"],"bytes":downloaded,"sha256":digest.hexdigest()}
                print("OPEN311_LOCAL_ARCHIVE_SAVED "+json.dumps(receipt["archive"]),flush=True)
                if args.wait_for_upload:
                    print("OPEN311_LOCAL_UPLOAD_READY "+json.dumps(receipt["archive"]),flush=True)
                    finishing=after_archive_command()
                else:
                    finishing=True;send({"op":"finish"})
            else:
                if value["nextOffset"]!=downloaded or downloaded>=archive["bytes"]:
                    raise RuntimeError("The retained archive continuation did not advance.")
                chunk_request()
        elif line.startswith("OPEN311_NATIVE_UPLOADED "):
            value=json.loads(line.split(" ",1)[1])
            event("archive-upload-result",value)
            receipt.setdefault("uploads",[]).append(value)
            print("OPEN311_LOCAL_UPLOAD_RESULT "+json.dumps(value,separators=(",",":")),flush=True)
            finishing=after_archive_command()
        elif line=="OPEN311_NATIVE_FINISHED":
            event("native-finished",{})
            break
        elif line.startswith("OPEN311_NATIVE_ERROR ") or line.startswith("OPEN311_NATIVE_COMMAND_ERROR "):
            event("native-error",line)
            raise RuntimeError(line)
        else:
            event("native-progress",line)
            if line.startswith("OPEN311_NATIVE_RUNNING ") or line.startswith("OPEN311_REPORTING_RUNNING "):
                print(line,flush=True)
    process.stdin.close()
    exit_code=process.wait(timeout=15)
    receipt["bootstrapExitCode"]=exit_code
    receipt["collection"]=collection_result
    receipt["reporting"]=reporting_result
    complete=exit_code==0 and bool(receipt.get("archive")) and collection_result and collection_result.get("state")=="passed" and collection_result.get("exitCode")==0 and (reporting is None or (reporting_result and reporting_result.get("state")=="COMPLETE" and reporting_result.get("result",{}).get("exitCode")==0))
    receipt["state"]="passed" if complete else "failed"
    if not complete:
        receipt["error"]={"message":"Inspect the retained collection/reporting results and complete archive."}
except BaseException as error:
    receipt["state"]="failed"
    receipt["error"]={"name":type(error).__name__,"message":str(error)}
    event("receiver-error",receipt["error"])
finally:
    receipt["collection"]=collection_result
    receipt["reporting"]=reporting_result
    if original_terminal is not None:
        try:
            termios.tcsetattr(sys.stdin.fileno(),termios.TCSADRAIN,original_terminal)
        except OSError as error:
            event("terminal-restore",{"name":type(error).__name__,"message":str(error)})
    if part is not None:
        part.flush();part.close()
    if process is not None and process.poll() is None:
        os.killpg(process.pid,signal.SIGTERM)
        try:
            process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            os.killpg(process.pid,signal.SIGKILL);process.wait(timeout=10)
    receipt["completedAt"]=timestamp()
    with result_path.open("x",encoding="utf-8") as stream:
        json.dump(receipt,stream,ensure_ascii=False,indent=2);stream.write("\n")
    os.chmod(result_path,0o600);os.chmod(log_path,0o600)
    event("complete",{"state":receipt["state"],"archive":receipt.get("archive"),"result":str(result_path)})
    log.close()
print("OPEN311_LOCAL_RESULT "+json.dumps({"state":receipt["state"],"result":str(result_path),
    "archive":receipt.get("archive"),"error":receipt.get("error")},ensure_ascii=False),flush=True)
sys.exit(0 if receipt["state"]=="passed" else 1)
