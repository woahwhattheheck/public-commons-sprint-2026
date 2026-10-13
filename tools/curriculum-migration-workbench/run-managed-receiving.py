#!/usr/bin/env python3
"""Continue the original Curriculum operation through Runtime, SDK, agent and actual browser receiving."""
import argparse,datetime,fcntl,hashlib,json,os,pathlib,signal,stat,subprocess,sys,uuid,zipfile
ROOT=pathlib.Path(__file__).resolve().parent
SCHEMA="stellar-forge.curriculum-migration-managed-receiving.v1"
SOURCE="0d327292684c56e52b45913e9acb5bb2efc6d7feb2a19f4ece489706fb432579"
MAXIMUM=1024*1024*1024
def require(value,message):
    if not value:raise RuntimeError(message)
def canonical(value):return json.dumps(value,ensure_ascii=False,sort_keys=True,separators=(",",":"),allow_nan=False).encode("utf-8")
def digest(raw):return hashlib.sha256(raw).hexdigest()
def read(path,limit=32*1024*1024):
    fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW)
    try:
        before=os.fstat(fd);require(stat.S_ISREG(before.st_mode) and before.st_size<=limit,"Expected a bounded original file: "+str(path))
        with os.fdopen(os.dup(fd),"rb") as stream:raw=stream.read(limit+1)
        after=os.fstat(fd)
        require(len(raw)==before.st_size and (before.st_dev,before.st_ino,before.st_size,before.st_mtime_ns,before.st_ctime_ns)==(after.st_dev,after.st_ino,after.st_size,after.st_mtime_ns,after.st_ctime_ns),"Original file changed.")
        return raw
    finally:os.close(fd)
def load(path):return json.loads(read(path,MAXIMUM))
def sync(path):
    fd=os.open(path,os.O_RDONLY|os.O_DIRECTORY)
    try:os.fsync(fd)
    finally:os.close(fd)
def directory(path):
    if not path.exists():
        require(path.parent.is_dir() and path.parent.resolve()==path.parent,"Select an existing canonical parent: "+str(path.parent))
        path.mkdir(mode=0o700);sync(path.parent)
    require(path.is_dir() and path.resolve()==path and path.stat().st_mode&0o077==0,"Use a private canonical directory: "+str(path))
def retain(path,raw):
    directory(path.parent)
    if path.exists():require(read(path,MAXIMUM)==raw,"Retained bytes differ: "+str(path));return
    temporary=path.with_name(path.name+".partial")
    fd=os.open(temporary,os.O_WRONLY|os.O_CREAT|os.O_TRUNC|os.O_NOFOLLOW,0o600)
    try:
        with os.fdopen(os.dup(fd),"wb") as stream:stream.write(raw);stream.flush()
        os.fsync(fd)
    finally:os.close(fd)
    os.replace(temporary,path);sync(path.parent)
def measure(path):
    raw=read(path,MAXIMUM);return {"path":str(path),"bytes":len(raw),"sha256":digest(raw)}

PRODUCT=ROOT.parents[1]/"products"/"curriculum-migration-workbench"
ORIGINAL_OPERATION="curriculum-migration-complete-receiving-20261013"
OPERATION_ID=str(uuid.uuid5(uuid.NAMESPACE_URL,"commons:"+ORIGINAL_OPERATION+":managed-integration"))

def inside(root,path):
    require(path.is_absolute() and path.resolve()==path and path.is_relative_to(root),"Selected file crosses its original root: "+str(path))
    return path
def prepare_basis(out,workspace,bulk,operation):
    raw=read(workspace,160*1024*1024);value=json.loads(raw)
    require(isinstance(value,dict),"Select a complete original workspace or portable packet.")
    target=out/"input"/"selected-workspace.json";retain(target,raw)
    selected={"path":str(target),"originalPath":str(workspace),"bytes":len(raw),"sha256":digest(raw)}
    bulk_value=None;bulk_receipt=None
    if bulk:
        body=read(bulk,16*1024*1024);bulk_value=json.loads(body)
        require(isinstance(bulk_value,dict),"Retain a complete reviewed BULK options object.")
        kept=out/"input"/"bulk-options.json";retain(kept,body)
        bulk_receipt={"path":str(kept),"originalPath":str(bulk),"bytes":len(body),"sha256":digest(body)}
    retained=out/"input"/"selected-input-receipt.json"
    if retained.exists():
        old=load(retained)
        require(old["selectedWorkspace"]==selected and old["bulk"]==bulk_receipt,"Original managed input selection changed.")
        for item in old["originalRecords"]:
            actual=measure(pathlib.Path(item["path"]))
            require(actual["bytes"]==item["bytes"] and actual["sha256"]==item["sha256"],"Original copied records changed.")
        return old,bulk_value
    prior=[]
    for name in ("intent.json","result.json","delivery-result.json","owner.json"):
        original=operation/name;saved=out/"input"/("original-"+name)
        if saved.exists() or original.exists():
            body=read(saved if saved.exists() else original,MAXIMUM);retain(saved,body)
            prior.append({"name":name,"path":str(saved),"originalPath":str(original),"bytes":len(body),"sha256":digest(body)})
    receipt={"schema":"curriculum.managed-input.v1","originalOperation":ORIGINAL_OPERATION,"operationId":OPERATION_ID,
        "selectedWorkspace":selected,"bulk":bulk_receipt,"originalRecords":prior}
    retain(retained,canonical(receipt))
    return receipt,bulk_value

def source_selection():
    manifest_path=ROOT/"managed-source-selection.json";raw=read(manifest_path,8*1024*1024);manifest=json.loads(raw)
    require(manifest.get("schema")=="curriculum-managed-complete-source.v1" and isinstance(manifest.get("files"),list),"Select the complete published managed source manifest.")
    body={k:v for k,v in manifest.items() if k!="sha256"}
    require(digest(canonical(body))==manifest.get("sha256"),"Complete managed source manifest hash differs.")
    repository=ROOT.parents[1];selected=[];seen=set();total=0
    for item in manifest["files"]:
        name=item["path"];parts=pathlib.PurePosixPath(name).parts
        require(isinstance(name,str) and not name.startswith("/") and chr(92) not in name and all(x not in ("",".","..") for x in parts) and
            (name.startswith("products/curriculum-migration-workbench/") or name.startswith("tools/curriculum-migration-workbench/")) and name not in seen,"Unsafe or repeated original source path.")
        seen.add(name);path=inside(repository,repository/name);actual=measure(path);total+=actual["bytes"]
        require(actual["bytes"]==item["bytes"] and actual["sha256"]==item["sha256"],"Original selected source changed: "+name)
        selected.append({"name":name,**actual})
    require(total<=64*1024*1024 and len(selected)>=30,"Incomplete or excessive managed source selection.")
    self_name="tools/curriculum-migration-workbench/managed-source-selection.json"
    require(self_name not in seen,"The source manifest cannot contain its own digest.")
    selected.append({"name":self_name,**measure(manifest_path)})
    selected.sort(key=lambda x:x["name"])
    return {"schema":"curriculum.managed-receiving-source.v1","manifestSha256":manifest["sha256"],"files":selected}

def archive_delivery(out,result,selected_source):
    files=[]
    def add(name,path):
        require(not name.startswith("/") and all(x not in ("",".","..") for x in name.split("/")) and "\\" not in name,"Unsafe delivery member.")
        descriptor=measure(path);files.append({"name":name,**descriptor})
    for name in ("input.json","result.json","source-selection.json","input/selected-workspace.json",
                 "input/selected-input-receipt.json","browser/result.json","browser/source-selection.json","browser/input-binding.json"):
        add(name,inside(out,out/name))
    source_input=load(out/"input"/"selected-input-receipt.json")
    if source_input["bulk"]:add("input/bulk-options.json",inside(out,pathlib.Path(source_input["bulk"]["path"])))
    for item in source_input["originalRecords"]:add("input/original-"+item["name"],inside(out,pathlib.Path(item["path"])))
    runtime=pathlib.Path(result["runtimeDirectory"])
    require(runtime.is_absolute() and runtime.resolve()==runtime,"Installed Runtime directory changed.")
    for name in ("source.tgz","runtime-install.json","runtime-profile.json","package.json","install-state.json"):
        add("installed-runtime/"+name,inside(runtime,runtime/name))
    seen=set()
    for item in result["files"]:
        path=inside(out,pathlib.Path(item["path"]));name=path.relative_to(out).as_posix()
        require(name.split("/",1)[0] in ("artifacts","sources","browser") and name not in seen,"Unexpected or repeated managed artifact.")
        seen.add(name);actual=measure(path)
        require(actual["bytes"]==item["bytes"] and actual["sha256"]==item["sha256"],"Completed workspace/source/browser artifact changed.")
        add(name,path)
    for item in selected_source["files"]:
        path=pathlib.Path(item["path"]);actual=measure(path)
        require(actual["bytes"]==item["bytes"] and actual["sha256"]==item["sha256"],"Original selected receiving source changed.")
        add("source/"+item["name"],path)
    files.sort(key=lambda x:x["name"])
    require(len({x["name"] for x in files})==len(files) and sum(x["bytes"] for x in files)<=MAXIMUM,"Complete delivery capacity exceeded or duplicate path.")
    recipe={"schema":"stellar-forge.curriculum-migration-managed-delivery.v1","operationId":result["operationId"],
        "inputSha256":result["inputSha256"],"sourceSha256":SOURCE,"allOwnedResourcesClosed":True,
        "files":[{k:v for k,v in x.items() if k!="path"} for x in files]}
    retain(out/"delivery-intent.json",canonical(recipe))
    target=out/"Curriculum_Migration_Managed_Receiving.zip";receipt_path=out/"delivery-result.json"
    previous=load(receipt_path) if receipt_path.exists() else None
    if not target.exists():
        temporary=out/"delivery.partial.zip"
        with zipfile.ZipFile(temporary,"w",compression=zipfile.ZIP_DEFLATED,compresslevel=6) as archive:
            for item in files:
                raw=read(item["path"],MAXIMUM)
                require(len(raw)==item["bytes"] and digest(raw)==item["sha256"],"Delivery member changed during assembly.")
                info=zipfile.ZipInfo(item["name"],(2026,10,13,0,0,0));info.compress_type=zipfile.ZIP_DEFLATED;info.create_system=3;info.external_attr=0o100600<<16
                archive.writestr(info,raw)
            info=zipfile.ZipInfo("Delivery_Manifest.json",(2026,10,13,0,0,0));info.compress_type=zipfile.ZIP_DEFLATED;info.create_system=3;info.external_attr=0o100600<<16
            archive.writestr(info,canonical(recipe))
        with temporary.open("rb") as stream:os.fsync(stream.fileno())
        if previous:require(measure(temporary)["sha256"]==previous["archive"]["sha256"],"Reconstructed archive differs from its original completed receipt.")
        os.replace(temporary,target);sync(out)
    with zipfile.ZipFile(target) as archive:
        require(len(archive.namelist())==len(files)+1 and set(archive.namelist())=={x["name"] for x in files}|{"Delivery_Manifest.json"},"Completed delivery members changed.")
        require(archive.read("Delivery_Manifest.json")==canonical(recipe),"Completed delivery recipe changed.")
        for item in files:
            raw=archive.read(item["name"]);require(len(raw)==item["bytes"] and digest(raw)==item["sha256"],"Completed member differs.")
    receipt={"schema":recipe["schema"],"operationId":result["operationId"],"state":"COMPLETE","archive":measure(target),
        "resultSha256":digest(read(out/"result.json",MAXIMUM)),"allOwnedResourcesClosed":True}
    retain(receipt_path,canonical(receipt));return receipt

def run_child(node,python,chromium,owner,out,value):
    attempts=out/"control"/"node-attempts";directory(attempts)
    attempt=attempts/str(uuid.uuid4());directory(attempt)
    command=[str(node),str(ROOT/"managed-receiving.mjs"),str(out/"input.json")]
    retain(attempt/"input.json",canonical({"command":command,"operationId":OPERATION_ID,"directory":str(out)}))
    child=None;received=[];old_handlers={}
    def forward(signum,frame):
        received.append(signum)
        if child is not None and child.poll() is None:child.send_signal(signum)
    try:
        for sig in (signal.SIGTERM,signal.SIGINT):old_handlers[sig]=signal.signal(sig,forward)
        env=dict(os.environ,CURRICULUM_MANAGED_GUARD_FD=str(owner),CURRICULUM_RECEIVING_PYTHON=str(python),
            CURRICULUM_CHROMIUM_EXECUTABLE=str(chromium),NODE_OPTIONS="--max-old-space-size=512",OMP_NUM_THREADS="1",OPENBLAS_NUM_THREADS="1")
        with (out/"control"/"stdout.log").open("ab") as stdout,(out/"control"/"stderr.log").open("ab") as stderr:
            if received:raise InterruptedError("Receiving interrupted before process creation.")
            child=subprocess.Popen(command,cwd=ROOT,env=env,stdout=stdout,stderr=stderr,pass_fds=(owner,))
            for sig in received:child.send_signal(sig)
            retain(attempt/"accepted.json",canonical({"pid":child.pid,"command":command}))
            print(json.dumps({"operationId":OPERATION_ID,"stage":"managed-integration","pid":child.pid,"directory":str(out)}),flush=True)
            code=child.wait()
        require(code==0 and not received,"Managed receiving interrupted; resume the same command with its retained Applications requests.")
    finally:
        if child is not None:
            if child.poll() is None:
                child.send_signal(signal.SIGTERM)
                # Keep custody of the inherited operation lock while Node closes its
                # Applications and the browser finishes its owned group cleanup.
                child.wait()
            retain(attempt/"return.json",canonical({"pid":child.pid,"exitCode":child.returncode,
                "nodeClosed":child.poll() is not None,"signals":received}))
        for sig,handler in old_handlers.items():signal.signal(sig,handler)

def main():
    require(sys.version_info>=(3,11),"Python 3.11 or later is required.")
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument("--operation-directory",required=True);p.add_argument("--workspace");p.add_argument("--bulk-options")
    p.add_argument("--runtime-workspace",required=True);p.add_argument("--runtime-id",required=True)
    p.add_argument("--node",required=True);p.add_argument("--python",default=sys.executable)
    p.add_argument("--chromium",required=True);p.add_argument("--offline-port",type=int,default=43871)
    p.add_argument("--label",default="Curriculum migration managed receiving")
    p.add_argument("--actor",default="TJLabs receiving engineer");p.add_argument("--timeout-ms",type=int,default=300000)
    a=p.parse_args();operation=pathlib.Path(a.operation_directory)
    require(operation.is_absolute() and operation.resolve()==operation and operation.is_dir(),"Select the original Curriculum receiving operation directory.")
    out=operation/"managed-integration";directory(out);directory(out/"control")
    lock=operation/"complete-receiving.lock"
    owner=os.open(lock,os.O_RDWR|os.O_CREAT|os.O_NOFOLLOW,0o600)
    try:
        ls=os.fstat(owner)
        require(stat.S_ISREG(ls.st_mode) and ls.st_nlink==1 and ls.st_mode&0o077==0 and ls.st_uid==os.getuid(),"Original receiving lock is not a private owned regular file.")
        fcntl.flock(owner,fcntl.LOCK_EX|fcntl.LOCK_NB)
        prior_intent=load(operation/"intent.json") if (operation/"intent.json").exists() else None
        if prior_intent:require(prior_intent.get("operation")==ORIGINAL_OPERATION and prior_intent.get("workDir")==str(operation),"The original work directory belongs to a different receiving operation.")
        workspace=pathlib.Path(a.workspace or (prior_intent or {}).get("workspace",{}).get("path") or PRODUCT/"app"/"initial-workspace.json")
        bulk_choice=a.bulk_options or ((prior_intent or {}).get("bulkOptions") or {}).get("path")
        bulk=pathlib.Path(bulk_choice) if bulk_choice else None
        require(workspace.is_absolute() and workspace.resolve()==workspace,"Select the exact original complete workspace path.")
        if bulk:require(bulk.is_absolute() and bulk.resolve()==bulk,"Select the exact reviewed BULK options path.")
        accepted,bulk_options=prepare_basis(out,workspace,bulk,operation)
        runtime_workspace=pathlib.Path(a.runtime_workspace);node=pathlib.Path(a.node);python=pathlib.Path(a.python);chromium=pathlib.Path(a.chromium)
        require(runtime_workspace.is_absolute() and runtime_workspace.resolve()==runtime_workspace and runtime_workspace.is_dir(),"Select the existing Runtime workspace.")
        for path in (node,python,chromium):require(path.is_absolute() and path.is_file() and os.access(path,os.X_OK),"Select an existing executable: "+str(path))
        require(1024<=a.offline_port<=65535 and 1000<=a.timeout_ms<=3600000,"Select a valid fixed loopback port and managed observation timeout.")
        require(a.actor.strip() and a.label.strip(),"Actor and installation label are required.")
        selected_source=source_selection();retain(out/"source-selection.json",canonical(selected_source))
        prior=load(out/"input.json") if (out/"input.json").exists() else None
        value={"schema":SCHEMA,"operationId":OPERATION_ID,"operationDirectory":str(operation),"directory":str(out),
            "sourceSha256":SOURCE,"originalOperation":ORIGINAL_OPERATION,"selectedWorkspace":accepted["selectedWorkspace"],"bulkOptions":bulk_options,
            "runtimeWorkspace":str(runtime_workspace),"runtimeId":a.runtime_id,"label":a.label,"actor":a.actor,"timeoutMs":a.timeout_ms,
            "nodeExecutable":str(node),"pythonExecutable":str(python),"chromiumExecutable":str(chromium),"offlinePort":a.offline_port,
            "startedAt":prior["startedAt"] if prior else datetime.datetime.now(datetime.timezone.utc).replace(microsecond=0).isoformat(timespec="milliseconds").replace("+00:00","Z")}
        retain(out/"input.json",canonical(value))
        retain(out/"control"/"caller.json",canonical({"node":measure(node.resolve()),"python":measure(python.resolve()),
            "chromium":measure(chromium.resolve()),"source":str(ROOT),"sourceSelectionSha256":digest(canonical(selected_source))}))
        run_child(node,python,chromium,owner,out,value)
        result=load(out/"result.json")
        require(result["state"]=="COMPLETE" and result["operationId"]==OPERATION_ID and
            result["inputSha256"]==digest(canonical(value)) and result["allOwnedResourcesClosed"] is True,"Managed result is incomplete.")
        receipt=archive_delivery(out,result,selected_source);print(json.dumps(receipt),flush=True);return receipt
    finally:os.close(owner)
if __name__=="__main__":main()
