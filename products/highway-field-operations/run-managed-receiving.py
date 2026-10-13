#!/usr/bin/env python3
"""Continue an existing completed Highway operation through its installed Applications integration."""
import argparse,fcntl,hashlib,json,os,pathlib,stat,subprocess,sys,zipfile
ROOT=pathlib.Path(__file__).resolve().parent
SCHEMA="stellar-forge.highway-field-operations-managed-receiving.v1"
SOURCE="576bc1319d01caf6848f10b218f037419e905ed2fdbf7160664c02ed5f17a957"
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
def load(path):return json.loads(read(path))
def sync(path):
    fd=os.open(path,os.O_RDONLY|os.O_DIRECTORY)
    try:os.fsync(fd)
    finally:os.close(fd)
def directory(path):
    if not path.exists():
        directory(path.parent);path.mkdir(mode=0o700);sync(path.parent)
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

ORIGINAL_SOURCE="16b651c694f00b28a1c18d27b88b196a02d6f5e1c5933a94085ead4ecf1cca6a"
def prepare_basis(operation,out,plan,native,journal):
    target=out/"original-basis.json"
    if target.exists():
        value=load(target)
        require(value["plan"]==plan and value["native"]==native and value["journal"]==journal,"Original completed basis changed.")
        for item in value["originalArtifacts"]:
            raw=read(item["path"],MAXIMUM);require(len(raw)==item["bytes"] and digest(raw)==item["sha256"],"Retained original artifact changed.")
        raw=read(value["attachment"]["path"])
        require(len(raw)==value["attachment"]["bytes"] and digest(raw)==value["attachment"]["sha256"],"Original source attachment changed.")
        return value
    app=ROOT/"app";selection=load(app/"source-selection.json")
    require(selection["sha256"]==SOURCE and digest(canonical({k:v for k,v in selection.items() if k!="sha256"}))==SOURCE,"Adopted source selection changed.")
    names=set()
    for item in selection["files"]:
        path=pathlib.PurePosixPath(item["path"])
        require(not path.is_absolute() and all(x not in (".","..") for x in path.parts) and item["path"] not in names,"Invalid source selection.")
        names.add(item["path"]);raw=read(app/item["path"],MAXIMUM)
        require(len(raw)==item["bytes"] and digest(raw)==item["sha256"],"Selected source changed.")
    sys.path.insert(0,str(app))
    from highway.workspace import Workspace
    from highway.exchange import validate_archive
    original=operation/"workspace"
    with Workspace(original) as w:
        current=w.current()
        descriptor,z,history=validate_archive(native["originalArchive"]["path"],native["originalArchive"]["sha256"],native["originalArchive"]["bytes"])
        try:
            frozen=history["states"][-1]
            require(current["revision"]==frozen["revision"] and current["sha256"]==frozen["sha256"] and current["state"]["id"]==native["workspaceId"],"Original staff workspace has later changes; select them explicitly before managed continuation.")
            first=w.history(0,1)["items"][0]["envelope"]
            attachment=native["sourceAttachment"]
            raw=w.read_blob(attachment["sha256"])
            require(len(raw)==attachment["bytes"] and digest(raw)==attachment["sha256"],"Actual captured source attachment changed.")
            attachment_path=out/"original"/"Captured_Source_Attachment.bin";retain(attachment_path,raw)
        finally:z.close()
    original_artifacts=[]
    for index,item in enumerate(native["artifacts"]):
        raw=read(item["path"],MAXIMUM);require(len(raw)==item["bytes"] and digest(raw)==item["sha256"],"Original native artifact changed.")
        destination=out/"original"/"artifacts"/str(index).zfill(4)/pathlib.Path(item["path"]).name
        retain(destination,raw);original_artifacts.append({"index":index,**measure(destination),"originalPath":item["path"]})
    following=load(operation/"steps"/"received-followup"/"input.json")
    require(following["command"]["kind"]=="dispatch.followup.save" and following["command"]["actor"]==plan["actor"],"Use the original explicit local receiving follow-up.")
    value={"schema":"geocove.managed-original-basis.v1","plan":plan,"native":native,"journal":journal,"originalCurrent":current,
        "firstCommand":first,"receivedFollowup":following,"attachment":measure(attachment_path),"originalArtifacts":original_artifacts}
    retain(target,canonical(value));return value
def archive_delivery(out,result):
    files=[]
    def add(name,path):
        require(not name.startswith("/") and all(x not in ("",".","..") for x in name.split("/")),"Unsafe delivery member.")
        descriptor=measure(path);files.append({"name":name,**descriptor})
    for name in ("input.json","original-basis.json","result.json"):add(name,out/name)
    operation=out.parent
    for name in ("input.json","result.json","journal.json"):add("original-operation/"+name,operation/name)
    for item in load(out/"original-basis.json")["originalArtifacts"]:
        path=pathlib.Path(item["path"]);raw=read(path,MAXIMUM)
        require(len(raw)==item["bytes"] and digest(raw)==item["sha256"],"Original accepted native artifact changed.")
        add("original-operation/artifacts/"+str(item["index"]).zfill(4)+"/"+path.name,path)
    # The complete original installed source archive carries all selected framework and product sources.
    runtime=pathlib.Path(result["runtimeDirectory"])
    add("installed-runtime/source.tgz",runtime/"source.tgz")
    for name in ("runtime-install.json","runtime-profile.json","package.json","install-state.json"):
        add("installed-runtime/"+name,runtime/name)
    for item in result["artifacts"]:
        path=pathlib.Path(item["path"]);require(path.parent==out/"artifacts","Unexpected managed artifact path.")
        actual=measure(path);require(actual["bytes"]==item["bytes"] and actual["sha256"]==item["sha256"],"Completed managed artifact changed.")
        add("workspaces/"+path.name,path)
    for item in result["reportFiles"]:
        path=pathlib.Path(item["path"]);require(path.is_relative_to(out/"reports"),"Managed report is outside selected output.")
        actual=measure(path);require(actual["bytes"]==item["bytes"] and actual["sha256"]==item["sha256"],"Complete report changed.")
        add("reports/"+path.relative_to(out/"reports").as_posix(),path)
    browser=result["browser"]
    for item in browser["screenshots"]:
        path=pathlib.Path(item["path"]);require(path.is_relative_to(out/"browser"),"Original browser image path changed.")
        actual=measure(path);require(actual["bytes"]==item["bytes"] and actual["sha256"]==item["sha256"],"Original browser image changed.")
        add("browser/"+path.relative_to(out/"browser").as_posix(),path)
    add("browser/result.json",out/"browser"/"result.json")
    browser_archive=browser["downloadedArchive"]
    actual=measure(browser_archive["path"])
    require(actual["bytes"]==browser_archive["bytes"] and actual["sha256"]==browser_archive["sha256"],"Browser full download changed.")
    add("browser/Highway_Field_Workspace.zip",browser_archive["path"])
    for path in sorted(ROOT.rglob("*")):
        if path.is_file() and path.suffix not in (".pyc",".lock",".log") and "__pycache__" not in path.parts:
            require(not path.is_symlink(),"Source selection cannot contain a linked product leaf.")
            add("product-source/"+path.relative_to(ROOT).as_posix(),path)
    require(len({x["name"] for x in files})==len(files) and sum(x["bytes"] for x in files)<=MAXIMUM,"Complete delivery exceeds capacity or duplicates paths.")
    recipe={"schema":"stellar-forge.highway-field-operations-managed-delivery.v1","operationId":result["operationId"],"inputSha256":result["inputSha256"],
        "files":[{k:v for k,v in x.items() if k!="path"} for x in files]}
    retain(out/"delivery-intent.json",canonical(recipe))
    target=out/"Highway_Field_Operations_Managed_Receiving.zip";receipt_path=out/"delivery-result.json"
    previous=load(receipt_path) if receipt_path.exists() else None
    if not target.exists():
        temporary=out/"delivery.partial.zip"
        with zipfile.ZipFile(temporary,"w",compression=zipfile.ZIP_DEFLATED,compresslevel=6) as archive:
            for item in files:
                raw=read(item["path"],MAXIMUM);require(len(raw)==item["bytes"] and digest(raw)==item["sha256"],"Original delivery member changed.")
                info=zipfile.ZipInfo(item["name"],(2026,10,13,0,0,0));info.compress_type=zipfile.ZIP_DEFLATED;info.create_system=3;info.external_attr=0o100600<<16;archive.writestr(info,raw)
            info=zipfile.ZipInfo("Delivery_Manifest.json",(2026,10,13,0,0,0));info.compress_type=zipfile.ZIP_DEFLATED;info.create_system=3;info.external_attr=0o100600<<16;archive.writestr(info,canonical(recipe))
        with temporary.open("rb") as stream:os.fsync(stream.fileno())
        if previous:require(measure(temporary)["sha256"]==previous["archive"]["sha256"],"Reconstructed archive differs from its original completed receipt.")
        os.replace(temporary,target);sync(out)
    with zipfile.ZipFile(target) as archive:
        require(len(archive.namelist())==len(files)+1 and set(archive.namelist())=={x["name"] for x in files}|{"Delivery_Manifest.json"},"Original delivery members changed.")
        require(archive.read("Delivery_Manifest.json")==canonical(recipe),"Original delivery manifest changed.")
        for item in files:
            raw=archive.read(item["name"]);require(len(raw)==item["bytes"] and digest(raw)==item["sha256"],"Completed delivery member differs.")
    receipt={"schema":recipe["schema"],"operationId":result["operationId"],"state":"COMPLETE","archive":measure(target),"resultSha256":digest(read(out/"result.json")),"allOwnedResourcesClosed":True}
    retain(receipt_path,canonical(receipt));return receipt

def main():
    require(sys.version_info>=(3,11),"Python 3.11 or later is required.")
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument("--operation-directory",required=True);p.add_argument("--runtime-workspace",required=True);p.add_argument("--runtime-id",required=True)
    p.add_argument("--node",required=True);p.add_argument("--python",default=sys.executable)
    p.add_argument("--label",default="Highway field operations commissioning");p.add_argument("--timeout-ms",type=int,default=300000)
    a=p.parse_args();operation=pathlib.Path(a.operation_directory)
    require(operation.is_absolute() and operation.resolve()==operation,"Select the original canonical Highway operation directory.")
    directory(operation);out=operation/"managed-highway-integration";directory(out);directory(out/"control")
    owner=os.open(operation/"programme.lock",os.O_RDWR|os.O_NOFOLLOW)
    try:
        fcntl.flock(owner,fcntl.LOCK_EX|fcntl.LOCK_NB)
        plan=load(operation/"input.json");native=load(operation/"result.json");journal=load(operation/"journal.json")
        require(plan["directory"]==str(operation) and native["operationId"]==plan["operationId"] and native["inputSha256"]==digest(canonical(plan)) and
            native["sourceSha256"]==ORIGINAL_SOURCE and plan["sourceSha256"]==ORIGINAL_SOURCE and native["state"]=="COMPLETE" and
            native["allOwnedResourcesClosed"] is True and journal["state"]=="COMPLETE" and journal["resultSha256"]==digest(canonical(native)),
            "Complete the same original Highway native programme before its following managed stage. No capture/business phase is replayed here.")
        basis=prepare_basis(operation,out,plan,native,journal)
        runtime_workspace=pathlib.Path(a.runtime_workspace);node=pathlib.Path(a.node);python=pathlib.Path(a.python)
        require(runtime_workspace.is_absolute() and runtime_workspace.resolve()==runtime_workspace and runtime_workspace.is_dir(),"Use the existing Runtime workspace.")
        require(node.is_absolute() and node.is_file() and os.access(node,os.X_OK) and python.is_absolute() and python.is_file() and os.access(python,os.X_OK),"Select existing executable Node and Python.")
        require(1000<=a.timeout_ms<=3600000,"Use a bounded managed observation timeout.")
        source_workspace=operation/"workspace"
        value={"schema":SCHEMA,"operationId":plan["operationId"],"operationDirectory":str(operation),"originalSourceSha256":ORIGINAL_SOURCE,
            "sourceSha256":SOURCE,"basisSha256":digest(read(out/"original-basis.json",64*1024*1024)),"workspaceId":native["workspaceId"],
            "runtimeWorkspace":str(runtime_workspace),"runtimeId":a.runtime_id,"label":a.label,"timeoutMs":a.timeout_ms,
            "settings":{"workspaceDirectory":str(source_workspace),"pythonExecutable":str(python),"nodeExecutable":str(node),
                "pairedWorkspaceDirectory":str(operation/"paired-workspace"),"pairedWorkspaceId":native["nativeWorkspaceId"],
                "connectionFile":str(source_workspace/"highway-field-operations-connection.json"),
                "receivingDirectory":str(out/"workspaces"),"port":0}}
        for name in ("workspaces","following-workspaces","final-workspaces","artifacts","reports"):directory(out/name)
        retain(out/"input.json",canonical(value))
        retain(out/"control"/"caller.json",canonical({"node":str(node),"nodeResolved":str(node.resolve()),"nodeSha256":digest(read(node.resolve(),MAXIMUM)),
            "python":str(python),"pythonResolved":str(python.resolve()),"pythonSha256":digest(read(python.resolve(),MAXIMUM)),
            "source":str(ROOT),"sourceEntrySha256":digest(read(ROOT/"managed-receiving.mjs"))}))
        env=dict(os.environ,HIGHWAY_FIELD_RECEIVING_GUARD_FD=str(owner),NODE_OPTIONS="--max-old-space-size=192",OMP_NUM_THREADS="1",OPENBLAS_NUM_THREADS="1")
        with (out/"control"/"stdout.log").open("ab") as stdout,(out/"control"/"stderr.log").open("ab") as stderr:
            child=subprocess.Popen([str(node),str(ROOT/"managed-receiving.mjs"),str(out/"input.json")],cwd=ROOT,env=env,stdout=stdout,stderr=stderr,pass_fds=(owner,))
            print(json.dumps({"operationId":plan["operationId"],"stage":"managed-highway-integration","pid":child.pid}),flush=True)
            code=child.wait()
        require(code==0,"Managed course interrupted. Retain its original Applications requests and browser ownership before continuing.")
        result=load(out/"result.json")
        require(result["state"]=="COMPLETE" and result["operationId"]==plan["operationId"] and result["inputSha256"]==digest(canonical(value)) and result["allOwnedResourcesClosed"] is True,"Managed result is incomplete.")
        receipt=archive_delivery(out,result);print(json.dumps(receipt),flush=True);return receipt
    finally:os.close(owner)
if __name__=="__main__":main()
