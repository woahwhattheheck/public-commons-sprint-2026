#!/usr/bin/env python3
"""Run the complete original Open311 collection and reporting job on an existing Linux host."""
import argparse,base64,hashlib,json,os,pathlib,signal,subprocess,sys,time

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
parser.add_argument("--reporting-packet",required=True)
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
report_path,report_bytes=retained_file(args.reporting_packet,args.reporting_git_blob)
packet=json.loads(source_bytes.decode("utf-8"))
reporting=json.loads(report_bytes.decode("utf-8"))
if packet.get("schema")!="commons.open311.native-collection-job.v1":
    parser.error("Use the complete original collection source packet.")
if reporting.get("op")!="reporting" or not reporting.get("requestId") or not isinstance(reporting.get("files"),list) or not isinstance(reporting.get("runner"),str):
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
partial=output/"helsinki-collection-reporting.zip.partial"
archive_path=output/"helsinki-collection-reporting.zip"
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
    "bootstrapGitBlob":git_blob(bootstrap_bytes),"reportingPacketGitBlob":git_blob(report_bytes),
    "reportingRequestId":reporting["requestId"],"runtime":{"node":str(node),"python":str(python),
    "chromium":str(browser),"nodeModules":str(modules)}}
log=log_path.open("x",encoding="utf-8")
part=None
def event(name,value):
    log.write(json.dumps({"at":timestamp(),"event":name,"value":value},ensure_ascii=False)+"\n")
    log.flush()
def send(value):
    process.stdin.write((json.dumps(value,ensure_ascii=False,separators=(",",":"))+"\n").encode("utf-8"))
    process.stdin.flush()
def chunk_request():
    send({"op":"artifact","offset":downloaded,"limit":49152,"archiveSha256":archive["sha256"]})
try:
    process=subprocess.Popen([str(python),"-u",str(bootstrap)],stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,stderr=subprocess.STDOUT,env=environment,start_new_session=True)
    receipt["pid"]=process.pid
    event("started",{"pid":process.pid,"sourcePacketGitBlob":receipt["sourcePacketGitBlob"]})
    sent_source=False;sent_reporting=False;finishing=False
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
            sent_reporting=True;send(reporting)
            print("OPEN311_LOCAL_COLLECTION_RESULT "+json.dumps({"state":collection_result.get("state"),
                "exitCode":collection_result.get("exitCode")}),flush=True)
        elif line.startswith("OPEN311_REPORTING_RESULT "):
            value=json.loads(line.split(" ",1)[1])
            if value.get("requestId")!=reporting["requestId"]:
                raise RuntimeError("The reporting result belongs to another retained request.")
            reporting_result=value["operation"];archive=value["archive"]
            event("reporting-result",value)
            part=partial.open("xb")
            chunk_request()
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
                receipt["archive"]={"path":str(archive_path),"bytes":downloaded,"sha256":digest.hexdigest()}
                finishing=True;send({"op":"finish"})
                print("OPEN311_LOCAL_ARCHIVE_SAVED "+json.dumps(receipt["archive"]),flush=True)
            else:
                if value["nextOffset"]!=downloaded or downloaded>=archive["bytes"]:
                    raise RuntimeError("The retained archive continuation did not advance.")
                chunk_request()
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
    complete=exit_code==0 and bool(receipt.get("archive")) and collection_result and collection_result.get("state")=="passed" and collection_result.get("exitCode")==0 and reporting_result and reporting_result.get("state")=="COMPLETE" and reporting_result.get("result",{}).get("exitCode")==0
    receipt["state"]="passed" if complete else "failed"
    if not complete:
        receipt["error"]={"message":"Inspect the retained collection/reporting results and complete archive."}
except BaseException as error:
    receipt["state"]="failed"
    receipt["error"]={"name":type(error).__name__,"message":str(error)}
    event("receiver-error",receipt["error"])
finally:
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
