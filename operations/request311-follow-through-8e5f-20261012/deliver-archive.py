#!/usr/bin/env python3
"""Deliver one complete native archive during the owning process lifetime."""
import argparse,datetime,hashlib,json,os,pathlib,re,sys,urllib.error,urllib.parse,urllib.request

def stamp():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()
def emit(name,value):
    print(name+" "+json.dumps(value,ensure_ascii=False,separators=(",",":")),flush=True)
def write_record(path,value):
    temporary=path.with_name(path.name+".pending-"+str(os.getpid()))
    data=(json.dumps(value,ensure_ascii=False,indent=2)+"\n").encode("utf-8")
    descriptor=os.open(temporary,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
    try:
        with os.fdopen(descriptor,"wb") as stream:
            stream.write(data);stream.flush();os.fsync(stream.fileno())
        os.replace(temporary,path)
        directory=os.open(path.parent,os.O_RDONLY)
        try: os.fsync(directory)
        finally: os.close(directory)
    finally:
        if temporary.exists(): temporary.unlink()
def whole_hash(path):
    digest=hashlib.sha256();size=0
    with path.open("rb") as stream:
        for block in iter(lambda:stream.read(1024*1024),b""):
            size+=len(block);digest.update(block)
    return size,digest.hexdigest()
class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,request,fp,code,msg,headers,newurl):
        raise urllib.error.HTTPError(request.full_url,code,"The archive upload was redirected; retain the original prepared file.",headers,fp)

def deliver(descriptor_path):
    descriptor_path=pathlib.Path(descriptor_path).resolve(strict=True)
    selected=json.loads(descriptor_path.read_text("utf-8"))
    if selected.get("schema")!="commons.native.archive.v1":
        raise ValueError("Use a complete native archive descriptor.")
    path=pathlib.Path(selected["path"]).resolve(strict=True)
    if not path.is_file() or not path.is_absolute():
        raise ValueError("The complete original archive must be a regular local file.")
    size,sha=whole_hash(path)
    if isinstance(selected.get("bytes"),bool) or selected.get("bytes")!=size or selected.get("sha256")!=sha:
        raise ValueError("The retained archive differs from its complete descriptor.")
    filename=selected.get("filename",path.name)
    if not filename or pathlib.PurePosixPath(filename).name!=filename or "\\" in filename or "\0" in filename:
        raise ValueError("The archive filename must be a single file name.")
    ready={"schema":selected["schema"],"path":str(path),"filename":filename,"bytes":size,"sha256":sha}
    for name in ("jobId","phase"):
        if name in selected: ready[name]=selected[name]
    receipt_path=descriptor_path.with_name(descriptor_path.stem+".delivery.json")
    if receipt_path.exists():
        delivery=json.loads(receipt_path.read_text("utf-8"))
        if delivery.get("archiveSha256")!=sha or delivery.get("bytes")!=size:
            raise ValueError("The existing delivery belongs to another archive.")
    else:
        delivery={"schema":"commons.native.archive-delivery.v1","archiveSha256":sha,"bytes":size,"filename":filename,"state":"retained","createdAt":stamp()}
        write_record(receipt_path,delivery)
    if delivery.get("state")=="finalized":
        emit("OPEN311_ARCHIVE_DELIVERY_FINALIZED",delivery)
        return delivery
    ready["delivery"]=delivery
    emit("OPEN311_LOCAL_UPLOAD_READY",ready)
    while True:
        line=sys.stdin.readline(65537)
        if not line:
            write_record(receipt_path,{**delivery,"lastObservedAt":stamp(),"continuation":"Run this same descriptor again and reconcile its original prepared file."})
            raise RuntimeError("The delivery input ended before finalization; the complete archive and original prepared identity remain retained.")
        if len(line)>65536 or not line.endswith("\n"):
            raise ValueError("Use one complete delivery command of at most 65536 characters.")
        command=json.loads(line);operation=command.get("op")
        if operation=="status":
            emit("OPEN311_LOCAL_UPLOAD_READY",{**ready,"delivery":delivery});continue
        if operation=="finalized":
            upload_id=command.get("uploadId")
            if not upload_id or upload_id!=delivery.get("uploadId") or command.get("archiveSha256")!=sha:
                raise ValueError("The finalization must refer to this archive's original prepared file.")
            destination=urllib.parse.urlparse(command.get("destinationUrl",""))
            if command.get("provider")!="slack" or destination.scheme!="https" or not destination.hostname or not(destination.hostname=="slack.com" or destination.hostname.endswith(".slack.com")):
                raise ValueError("Use the actual finalized Slack file destination.")
            delivery={**delivery,"state":"finalized","provider":"slack","destinationUrl":command["destinationUrl"],"finalizedAt":stamp()}
            write_record(receipt_path,delivery);emit("OPEN311_ARCHIVE_DELIVERY_FINALIZED",delivery);return delivery
        if operation!="upload":
            raise ValueError("Use upload, finalized or status for this original archive.")
        upload_id=command.get("uploadId")
        if not isinstance(upload_id,str) or not re.fullmatch(r"F[A-Z0-9]+",upload_id):
            raise ValueError("Use the exact prepared Slack file ID.")
        if command.get("bytes")!=size or command.get("archiveSha256")!=sha or command.get("method","POST")!="POST":
            raise ValueError("The upload command differs from this complete archive.")
        prior_id=delivery.get("uploadId")
        if prior_id and upload_id!=prior_id:
            raise ValueError("Reconcile the original prepared Slack file before preparing another destination.")
        if delivery.get("state")=="uploaded":
            emit("OPEN311_LOCAL_UPLOAD_RESULT",{"state":"UPLOADED","uploadId":upload_id,"archiveSha256":sha,"bytes":size,"status":delivery["status"],"recovered":True});continue
        if delivery.get("state") in ("uploading","uncertain"):
            emit("OPEN311_ARCHIVE_DELIVERY_RECONCILE",{"state":delivery["state"],"uploadId":upload_id,"archiveSha256":sha,"bytes":size,"receiptPath":str(receipt_path)})
            continue
        location=urllib.parse.urlparse(command.get("uploadUrl",""))
        if location.scheme!="https" or location.hostname!="files.slack.com" or location.username or location.password:
            raise ValueError("Use the signed files.slack.com URL returned for the original prepared file.")
        delivery={**delivery,"uploadId":upload_id,"state":"uploading","startedAt":stamp(),"provider":"slack"}
        write_record(receipt_path,delivery)
        try:
            before=path.stat()
            if whole_hash(path)!=(size,sha): raise ValueError("The complete archive changed before upload.")
            opener=urllib.request.build_opener(NoRedirect())
            with path.open("rb") as stream:
                request=urllib.request.Request(command["uploadUrl"],data=stream,method="POST",headers={"Content-Type":"application/octet-stream","Content-Length":str(size)})
                with opener.open(request,timeout=90) as response:
                    status=response.status;body=response.read(65537)
                    if status!=200 or len(body)>65536:
                        raise RuntimeError("Slack returned an unexpected archive upload response: "+str(status))
            after=path.stat()
            if (before.st_dev,before.st_ino,before.st_size,before.st_mtime_ns)!=(after.st_dev,after.st_ino,after.st_size,after.st_mtime_ns):
                raise ValueError("The retained archive changed during upload.")
            delivery={**delivery,"state":"uploaded","status":status,"uploadedAt":stamp(),"responseBytes":len(body)}
            write_record(receipt_path,delivery)
            emit("OPEN311_LOCAL_UPLOAD_RESULT",{"state":"UPLOADED","uploadId":upload_id,"archiveSha256":sha,"bytes":size,"status":status})
        except Exception as error:
            delivery={**delivery,"state":"uncertain","lastObservedAt":stamp(),"errorType":type(error).__name__,"continuation":"Reconcile this prepared file through Slack before repeating any upload."}
            write_record(receipt_path,delivery)
            emit("OPEN311_ARCHIVE_DELIVERY_RECONCILE",{"state":"uncertain","uploadId":upload_id,"archiveSha256":sha,"bytes":size,"errorType":type(error).__name__,"receiptPath":str(receipt_path)})

if __name__=="__main__":
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--descriptor",required=True)
    args=parser.parse_args()
    try: deliver(args.descriptor)
    except Exception as error:
        emit("OPEN311_ARCHIVE_DELIVERY_ERROR",{"errorType":type(error).__name__,"message":str(error)})
        sys.exit(1)
