#!/usr/bin/env python3
"""Receive pinned Open311 source and execute the complete native operation on an existing cloud Linux host."""
import argparse,base64,concurrent.futures,hashlib,json,os,pathlib,re,sys,tempfile,urllib.error,urllib.parse,urllib.request,zlib

SCHEMAS={"commons.open311.native-collection-job.v1","commons.open311.boston-native-input.v1"}
MAX_BYTES=16*1024*1024
def git_blob(data):
    return hashlib.sha1(b"blob "+str(len(data)).encode("ascii")+b"\0"+data).hexdigest()
def timestamp():
    import datetime
    return datetime.datetime.now(datetime.timezone.utc).isoformat()
def verified(data,expected,label):
    actual=git_blob(data)
    if not isinstance(expected,str) or not re.fullmatch(r"[0-9a-f]{40}",expected) or actual!=expected:
        raise ValueError("Original Git blob differs for "+label+": expected "+str(expected)+", actual "+actual)
    return data
def source_path(value):
    if not isinstance(value,str) or not value or "\\" in value or "\0" in value:
        raise ValueError("Use a complete repository-relative source path.")
    path=pathlib.PurePosixPath(value)
    if path.is_absolute() or ".." in path.parts or str(path)!=value:
        raise ValueError("Invalid source path: "+value)
    return value
def source_location(repository,ref,path):
    if not isinstance(repository,str) or not re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+",repository):
        raise ValueError("Use the selected owner/repository.")
    if not isinstance(ref,str) or not re.fullmatch(r"[0-9a-f]{40}",ref):
        raise ValueError("Use an immutable full Git commit.")
    return "https://raw.githubusercontent.com/"+repository+"/"+ref+"/"+urllib.parse.quote(source_path(path),safe="/")
def write_private(path,data):
    path.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
    with path.open("xb") as stream:
        stream.write(data)
    os.chmod(path,0o600)
def canonical(value):
    return json.dumps(value,ensure_ascii=False,separators=(",",":")).encode("utf-8")

parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument("--repository",default="woahwhattheheck/public-commons-sprint-2026")
parser.add_argument("--ref",required=True)
parser.add_argument("--bootstrap-path",default="operations/open311-collection-8e5f-20261012/run_native.py")
parser.add_argument("--bootstrap-git-blob",default="23cd38c71b5c8e845c3b31fd1c4b1661661ef2c4")
parser.add_argument("--receiver-path",default="operations/open311-collection-8e5f-20261012/receive_native.py")
parser.add_argument("--receiver-git-blob",default="430c1691eb3c08b9c7114321f1c951af82857092")
source_group=parser.add_mutually_exclusive_group()
source_group.add_argument("--source-path")
source_group.add_argument("--source-file")
source_group.add_argument("--source-deflate-base64")
parser.add_argument("--source-git-blob",default="8e731340359628b63e870b7164f5be65109ef4c2")
parser.add_argument("--reporting-path")
parser.add_argument("--reporting-file")
parser.add_argument("--reporting-git-blob",default="500e844a86063c5a0bacc5a1238a4f29aa113465")
parser.add_argument("--output-directory",required=True)
parser.add_argument("--node",required=True)
parser.add_argument("--node-modules",required=True)
parser.add_argument("--chromium",required=True)
parser.add_argument("--wait-for-upload",action="store_true")
args=parser.parse_args()
if args.reporting_path and args.reporting_file:
    parser.error("Select one complete reporting source.")
root=pathlib.Path(args.output_directory).absolute()
root.mkdir(mode=0o700)
intake=root/"intake";intake.mkdir(mode=0o700)
manifest={"schema":"commons.open311.native-source-receiving.v1","state":"receiving","startedAt":timestamp(),
          "repository":args.repository,"ref":args.ref,"files":[]}
def fetch_original(path,expected,repository=None,ref=None):
    repository=repository or args.repository;ref=ref or args.ref
    url=source_location(repository,ref,path);started=timestamp()
    request=urllib.request.Request(url,method="GET",headers={"Accept":"application/octet-stream","User-Agent":"Open311-native-commissioning"})
    with urllib.request.urlopen(request,timeout=45) as response:
        data=response.read(MAX_BYTES+1)
        if len(data)>MAX_BYTES:
            raise ValueError("The selected source file exceeds the original receiving limit: "+path)
        receipt={"method":"GET","url":url,"finalUrl":response.geturl(),"status":response.status,
                 "startedAt":started,"observedAt":timestamp(),"contentType":response.headers.get("Content-Type")}
    verified(data,expected,path)
    receipt.update({"path":path,"gitBlob":expected,"bytes":len(data),"sha256":hashlib.sha256(data).hexdigest()})
    return data,receipt
def retained_local(path,expected,label):
    selected=pathlib.Path(path).resolve(strict=True)
    if not selected.is_file():
        raise ValueError("Use the original complete source file: "+str(selected))
    data=selected.read_bytes()
    if len(data)>MAX_BYTES:
        raise ValueError("The selected source file exceeds the receiving limit.")
    verified(data,expected,label)
    return data,{"path":str(selected),"kind":"retained-file","gitBlob":expected,"bytes":len(data),"sha256":hashlib.sha256(data).hexdigest()}
try:
    print("OPEN311_PUBLIC_SOURCE_RECEIVING "+json.dumps({"directory":str(root),"ref":args.ref}),flush=True)
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        bootstrap_future=pool.submit(fetch_original,args.bootstrap_path,args.bootstrap_git_blob)
        receiver_future=pool.submit(fetch_original,args.receiver_path,args.receiver_git_blob)
        if args.source_file:
            source_data,source_receipt=retained_local(args.source_file,args.source_git_blob,"source packet")
        elif args.source_deflate_base64:
            compressed=base64.b64decode(args.source_deflate_base64,validate=True)
            decoder=zlib.decompressobj(-15)
            source_data=decoder.decompress(compressed,MAX_BYTES+1)
            if len(source_data)>MAX_BYTES or not decoder.eof or decoder.unused_data or decoder.unconsumed_tail:
                raise ValueError("Use one complete original raw-DEFLATE source packet.")
            verified(source_data,args.source_git_blob,"decoded source packet")
            source_receipt={"kind":"original-deflate-input","gitBlob":args.source_git_blob,"bytes":len(source_data),
                            "sha256":hashlib.sha256(source_data).hexdigest(),"compressedBytes":len(compressed)}
        else:
            source_data,source_receipt=fetch_original(args.source_path or "operations/open311-collection-8e5f-20261012/source-packet.json",args.source_git_blob)
        bootstrap_data,bootstrap_receipt=bootstrap_future.result()
        receiver_data,receiver_receipt=receiver_future.result()
    manifest["files"].extend([source_receipt,bootstrap_receipt,receiver_receipt])
    packet=json.loads(source_data.decode("utf-8"))
    if not isinstance(packet,dict) or packet.get("schema") not in SCHEMAS or not isinstance(packet.get("files"),list):
        raise ValueError("Select the complete original native operation schema.")
    write_private(intake/"original-source-packet.json",source_data)
    repository=packet.get("sourceRepository",args.repository);ref=packet.get("sourceRef",args.ref)
    pending=[];seen=set()
    for entry in packet["files"]:
        if not isinstance(entry,dict):
            raise ValueError("Use original source entries.")
        path=source_path(entry.get("path"))
        if path in seen:
            raise ValueError("Repeated source path: "+path)
        seen.add(path)
        if "content" not in entry:
            pending.append(entry)
        else:
            if not isinstance(entry["content"],str):
                raise ValueError("Preserve complete UTF-8 source content: "+path)
            verified(entry["content"].encode("utf-8"),entry.get("gitBlob"),path)
    def hydrate(entry):
        data,receipt=fetch_original(entry["path"],entry.get("gitBlob"),
                                    entry.get("repository",repository),entry.get("ref",ref))
        if entry.get("bytes") is not None and entry["bytes"]!=len(data):
            raise ValueError("Original source byte count differs: "+entry["path"])
        if entry.get("sha256") and entry["sha256"]!=hashlib.sha256(data).hexdigest():
            raise ValueError("Original source SHA256 differs: "+entry["path"])
        return entry,data.decode("utf-8"),receipt
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        for entry,content,receipt in pool.map(hydrate,pending):
            entry["content"]=content;manifest["files"].append(receipt)
    runner_hydrated=False
    if isinstance(packet.get("runner"),dict):
        selected=packet["runner"]
        data,receipt=fetch_original(source_path(selected.get("path")),selected.get("gitBlob"),
                                    selected.get("repository",repository),selected.get("ref",ref))
        if selected.get("bytes") is not None and selected["bytes"]!=len(data):
            raise ValueError("Original runner byte count differs.")
        if selected.get("sha256") and selected["sha256"]!=hashlib.sha256(data).hexdigest():
            raise ValueError("Original runner SHA256 differs.")
        packet["runner"]=data.decode("utf-8");manifest["files"].append(receipt);runner_hydrated=True
    if not isinstance(packet.get("runner"),str):
        raise ValueError("Supply the complete original runner or its pinned public source.")
    effective=canonical(packet) if pending or runner_hydrated else source_data
    effective_blob=git_blob(effective)
    write_private(intake/"source-packet.json",effective)
    write_private(intake/"run_native.py",bootstrap_data)
    write_private(intake/"receive_native.py",receiver_data)
    compile(bootstrap_data.decode("utf-8"),str(intake/"run_native.py"),"exec")
    compile(receiver_data.decode("utf-8"),str(intake/"receive_native.py"),"exec")
    reporting_data=None
    if args.reporting_file:
        reporting_data,receipt=retained_local(args.reporting_file,args.reporting_git_blob,"reporting packet")
    elif args.reporting_path:
        reporting_data,receipt=fetch_original(args.reporting_path,args.reporting_git_blob)
    if reporting_data is not None:
        manifest["files"].append(receipt)
        write_private(intake/"reporting-operation.json",reporting_data)
    manifest.update({"state":"verified","completedAt":timestamp(),"hydratedFiles":len(pending),
                     "sourcePacketGitBlob":effective_blob,"sourcePacketBytes":len(effective),
                     "sourcePacketSha256":hashlib.sha256(effective).hexdigest()})
    write_private(intake/"source-receiving.json",json.dumps(manifest,ensure_ascii=False,indent=2).encode("utf-8"))
    print("OPEN311_PUBLIC_SOURCE_VERIFIED "+json.dumps({"files":len(manifest["files"]),"hydratedFiles":len(pending),
        "sourcePacketGitBlob":effective_blob,"sourcePacketBytes":len(effective),"sourceSchema":packet["schema"],
        "intake":str(intake)}),flush=True)
    command=[sys.executable,"-u",str(intake/"receive_native.py"),"--bootstrap",str(intake/"run_native.py"),
             "--bootstrap-git-blob",args.bootstrap_git_blob,"--source-packet",str(intake/"source-packet.json"),
             "--source-git-blob",effective_blob,"--output-directory",str(root/"result"),"--node",args.node,
             "--node-modules",args.node_modules,"--chromium",args.chromium]
    if reporting_data is not None:
        command.extend(["--reporting-packet",str(intake/"reporting-operation.json"),"--reporting-git-blob",args.reporting_git_blob])
    if args.wait_for_upload:
        command.append("--wait-for-upload")
    os.execv(sys.executable,command)
except BaseException as error:
    manifest.update({"state":"failed","completedAt":timestamp(),"error":{"name":type(error).__name__,"message":str(error)}})
    if isinstance(error,urllib.error.HTTPError):
        manifest["error"]["status"]=error.code
    failure=intake/"source-receiving-failed.json"
    if not failure.exists():
        write_private(failure,json.dumps(manifest,ensure_ascii=False,indent=2).encode("utf-8"))
    print("OPEN311_PUBLIC_SOURCE_ERROR "+json.dumps({"error":manifest["error"],"result":str(failure)},ensure_ascii=False),flush=True)
    sys.exit(1)
