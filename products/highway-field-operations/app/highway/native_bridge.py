"""Durable original native requests outside the staff database transaction."""
import fcntl, os, uuid
from pathlib import Path
from .common import *
from .reconciliation import ReconciliationAdapter

class NativeBridge:
    def __init__(self,workspace,native_workspace):
        self.workspace=workspace;self.native=native_workspace
        self.root=workspace.directory/"reconciliation-operations"
        self.root.mkdir(exist_ok=True,mode=0o700)
        exports=workspace.directory/"reconciliation-exports";exports.mkdir(exist_ok=True,mode=0o700)
        self.adapter=ReconciliationAdapter(native_workspace,lambda:workspace.current()["state"],workspace.read_blob,exports)
    def perform(self,operation_id,operation,body):
        identifier(operation_id);text(operation,"Native operation",80)
        directory=self.root/operation_id;directory.mkdir(exist_ok=True,mode=0o700)
        guard=os.open(directory/"operation.lock",os.O_RDWR|os.O_CREAT|getattr(os,"O_NOFOLLOW",0),0o600)
        try:
            fcntl.flock(guard,fcntl.LOCK_EX)
            request=self.adapter.input(operation,body)
            raw_input=canonical(request);require(len(raw_input)<=8*1024*1024,"NATIVE_REQUEST_CAPACITY","Native request exceeds its full retention allowance.")
            intent={"schema":"geocove.native-operation-intent.v1","operationId":operation_id,"input":request,"inputSha256":sha(raw_input)}
            atomic_file(directory/"intent.json",canonical(intent),immutable=True)
            atomic_file(directory/"input.json",raw_input,immutable=True)
            returned=directory/"native-result.json"
            files_record=directory/"native-files.json"
            if returned.exists():
                result=loads(read_regular(returned,MAX_BLOB))
                file_rows=loads(read_regular(files_record,MAX_HISTORY))
            else:
                # The adapter continues the original native request IDs; it never substitutes a comparison engine.
                result=self.adapter.dispatch(operation,body)
                raw_result=canonical(result)
                require(len(raw_result)<=MAX_BLOB,"NATIVE_RESULT_CAPACITY","Native result exceeds complete retention capacity.")
                file_rows=[]
                for path,value in sorted(self.adapter.retained_files.items()):
                    descriptor=value["descriptor"];require(descriptor["path"]==path,"NATIVE_FILE","Original native file path differs.")
                    safe_path(path);sha_id(descriptor["sha256"])
                    require(type(descriptor["bytes"]) is int and 0<=descriptor["bytes"]<=MAX_BLOB,"NATIVE_FILE_CAPACITY","Original native member exceeds the staff handover allowance.")
                    file_rows.append({"descriptor":descriptor,"localPath":str(Path(value["localPath"]).absolute())})
                # Files and the exact complete result are durable before the native return is exposed.
                atomic_file(files_record,canonical(file_rows),immutable=True)
                atomic_file(returned,raw_result,immutable=True)
            require(result["inputSha256"]==intent["inputSha256"] and result["nativeWorkspaceId"]==request["nativeWorkspaceId"],"NATIVE_RESULT_BINDING","Original native result belongs to another request.")
            descriptors=[{"path":"input.json","sha256":sha(raw_input),"bytes":len(raw_input),"mediaType":"application/json"}]
            raw_result=canonical(result)
            descriptors.append({"path":"result.json","sha256":sha(raw_result),"bytes":len(raw_result),"mediaType":"application/json"})
            require(sum(x["descriptor"]["bytes"] for x in file_rows)+len(raw_input)+len(raw_result)<=MAX_BLOBS,"NATIVE_PACKAGE_CAPACITY","Complete native package exceeds the staff handover source allowance.")
            self.workspace.put_blob(raw_input,intent["inputSha256"])
            self.workspace.put_blob(raw_result,sha(raw_result))
            for entry in file_rows:
                d=entry["descriptor"]
                try:
                    existing=self.workspace.read_blob(d["sha256"])
                    require(len(existing)==d["bytes"],"NATIVE_FILE_CHANGED","Retained native file size differs.")
                except HighwayError as error:
                    if error.code!="SOURCE_MISSING":raise
                    source=read_regular(entry["localPath"])
                    require(len(source)==d["bytes"] and sha(source)==d["sha256"],"NATIVE_FILE_CHANGED","Original native result file changed.")
                    self.workspace.put_blob(source,d["sha256"])
                descriptors.append(d)
            captures=sorted({value["captureId"] for value in result.get("bindings",[]) if isinstance(value,dict) and value.get("captureId")})
            record={"id":operation_id,"kind":operation,"inputSha256":intent["inputSha256"],"resultSha256":sha(raw_result),"files":descriptors,"captureIds":captures,"nativeWorkspaceId":request["nativeWorkspaceId"]}
            response={"operationId":operation_id,"result":result,"recordBody":record,"recordRequestId":str(uuid.uuid5(uuid.UUID(operation_id),"highway-reconciliation-record"))}
            atomic_file(directory/"ready.json",canonical(response),immutable=True)
            return response
        finally:os.close(guard)
    def read(self,operation_id):
        identifier(operation_id);directory=self.root/operation_id
        if (directory/"ready.json").exists():return {"state":"READY","original":loads(read_regular(directory/"ready.json",MAX_BLOB))}
        if (directory/"native-result.json").exists():return {"state":"NATIVE_RETURNED","operationId":operation_id}
        if (directory/"intent.json").exists():return {"state":"ORIGINAL_INTENT","operationId":operation_id,"input":loads(read_regular(directory/"intent.json",8*1024*1024))["input"]}
        return {"state":"NOT_FOUND","operationId":operation_id}


def restore_operation(workspace,record_id,operation_id):
    """Receive a saved complete native package without opening its old owner."""
    from .reconciliation import restore_input, restore_native_package
    identifier(record_id);identifier(operation_id)
    root=workspace.directory/"native-receiving";root.mkdir(exist_ok=True,mode=0o700)
    directory=root/operation_id;directory.mkdir(exist_ok=True,mode=0o700)
    guard=os.open(directory/"operation.lock",os.O_RDWR|os.O_CREAT|getattr(os,"O_NOFOLLOW",0),0o600)
    try:
        fcntl.flock(guard,fcntl.LOCK_EX)
        state=workspace.current()["state"]
        request=restore_input(state,record_id,directory/"package",directory/"workspace",operation_id)
        raw_input=canonical(request)
        atomic_file(directory/"input.json",raw_input,immutable=True)
        returned=directory/"native-result.json"
        if returned.exists():result=loads(read_regular(returned,MAX_BLOB))
        else:
            result=restore_native_package(state,record_id,workspace.read_blob,directory/"package",directory/"workspace",request_id=operation_id)
            atomic_file(returned,canonical(result),immutable=True)
        require(result["inputSha256"]==sha(raw_input) and result["nativeWorkspaceId"]==request["nativeWorkspaceId"],"NATIVE_RESULT_BINDING","Original receiving result differs.")
        raw_result=canonical(result);descriptors=[]
        for name,raw in (("input.json",raw_input),("result.json",raw_result)):
            key=sha(raw);workspace.put_blob(raw,key)
            descriptors.append({"path":name,"sha256":key,"bytes":len(raw),"mediaType":"application/json"})
        for item in result["files"]:
            raw=workspace.read_blob(item["sha256"])
            require(len(raw)==item["bytes"],"NATIVE_FILE_CHANGED","Original saved package member differs.")
            descriptors.append(item)
        record={"id":operation_id,"kind":"restore","inputSha256":sha(raw_input),"resultSha256":sha(raw_result),"files":descriptors,"captureIds":sorted({b["captureId"] for b in result["bindings"]}),"nativeWorkspaceId":result["nativeWorkspaceId"]}
        response={"operationId":operation_id,"result":result,"recordBody":record,"recordRequestId":str(uuid.uuid5(uuid.UUID(operation_id),"highway-reconciliation-record"))}
        atomic_file(directory/"ready.json",canonical(response),immutable=True)
        return response
    finally:os.close(guard)
