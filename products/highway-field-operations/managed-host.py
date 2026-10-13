"""Managed lifetime for the unchanged original highway-field-operations workspace."""
import fcntl,hashlib,json,os,signal,stat,sys,threading,uuid
from pathlib import Path

def canonical(v):return json.dumps(v,sort_keys=True,ensure_ascii=False,separators=(",",":"),allow_nan=False).encode("utf-8")
def check(ok,message):
    if not ok:raise RuntimeError(message)
def digest(raw):return hashlib.sha256(raw).hexdigest()
def raw_file(path,maximum=64*1024*1024):
    path=Path(path)
    check(path.is_absolute() and path.resolve()==path and not path.is_symlink(),"Use the original canonical regular file")
    fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
    try:
        st=os.fstat(fd);check(stat.S_ISREG(st.st_mode) and st.st_size<=maximum,"Original file is not bounded/regular")
        parts=[];total=0
        while True:
            data=os.read(fd,min(1024*1024,maximum+1-total))
            if not data:break
            parts.append(data);total+=len(data);check(total<=maximum,"Original file is too large")
        after=os.fstat(fd);check((st.st_dev,st.st_ino,st.st_size,st.st_mtime_ns,st.st_ctime_ns)==(after.st_dev,after.st_ino,after.st_size,after.st_mtime_ns,after.st_ctime_ns),"Original file changed while reading")
        return b"".join(parts)
    finally:os.close(fd)
def process_identity(visible_pid=None):
    base=Path("/proc/self") if visible_pid is None else Path("/proc")/str(visible_pid)
    data=(base/"stat").read_text();actual_visible=int(data.split(" ",1)[0])
    check(visible_pid is None or actual_visible==visible_pid,"Original visible process identity changed")
    return {"visiblePid":actual_visible,"namespacePid":os.getpid() if visible_pid is None else None,
        "startTicks":data[data.rfind(")")+2:].split()[19],
        "bootId":Path("/proc/sys/kernel/random/boot_id").read_text().strip(),
        "pidNamespace":os.readlink(base/"ns/pid")}
def private_directory(path,create=False):
    path=Path(path);check(path.is_absolute() and path.parent.resolve()==path.parent and not path.is_symlink(),"Canonical directory required")
    if create:path.mkdir(mode=0o700,exist_ok=True)
    st=path.stat();check(stat.S_ISDIR(st.st_mode) and st.st_uid==os.getuid() and st.st_mode&0o077==0,"Owned private directory required")
    return path
def main():
    check(sys.version_info>=(3,11),"The original application requires Python 3.11 or later")
    raw=sys.stdin.buffer.read(2*1024*1024+1);check(len(raw)<=2*1024*1024,"Managed input exceeds its bound")
    request=json.loads(raw);binding=request["binding"]
    check(binding["schema"]=="stellar-forge.highway-field-operations-binding.v1" and digest(canonical(binding))==request["bindingSha256"],"Reviewed source binding changed")
    check(str(Path(sys.executable).absolute())==binding["python"]["executable"] and str(Path(sys.executable).resolve())==binding["python"]["resolvedExecutable"],"Selected Python or virtual environment changed")
    py=raw_file(Path(sys.executable).resolve(),512*1024*1024)
    check(len(py)==binding["python"]["bytes"] and digest(py)==binding["python"]["sha256"],"Selected Python bytes changed")
    configuration=binding["python"].get("configuration")
    if configuration:
        config_raw=raw_file(configuration["path"],1024*1024)
        check(len(config_raw)==configuration["bytes"] and digest(config_raw)==configuration["sha256"],"Selected Python environment configuration changed")
    selected_node=binding["node"];node=Path(selected_node["executable"])
    check(str(node.resolve())==selected_node["resolvedExecutable"] and os.access(node,os.X_OK),"Selected Node executable changed")
    node_raw=raw_file(node.resolve(),512*1024*1024)
    check(len(node_raw)==selected_node["bytes"] and digest(node_raw)==selected_node["sha256"],"Selected Node bytes changed")
    os.environ["GEOCOVE_NODE_EXECUTABLE"]=str(node)
    for item in binding["sourceFiles"]:
        original=raw_file(item["path"])
        check(len(original)==item["bytes"] and digest(original)==item["sha256"],"Selected application source changed: "+item["path"])
    source=Path(binding["sourceDirectory"])
    check(source.resolve()==source and source.is_dir(),"Original source directory changed")
    sys.path.insert(0,str(source))
    from highway.common import atomic_file,loads,read_regular,now,sha
    from highway.exchange import source_inventory
    from highway.workspace import Workspace
    from highway.server import Application
    selection=loads(read_regular(source/"source-selection.json"));source_inventory(source,selection)
    check(selection["sha256"]==binding["sourceSha256"],"Original selected source changed")
    workspace_directory=private_directory(binding["workspaceDirectory"])
    receiving_directory=private_directory(binding["receivingDirectory"],create=True)
    creation=raw_file(binding["creation"]["path"],1024*1024)
    check(len(creation)==binding["creation"]["bytes"] and digest(creation)==binding["creation"]["sha256"],"Original workspace creation record changed")
    connection=Path(binding["connectionFile"]);private_directory(connection.parent)
    application_request_id=request["applicationRequestId"]
    check(str(uuid.UUID(application_request_id))==application_request_id,"Retain the original managed request UUID")
    check(type(request["port"])is int and 0<=request["port"]<=65535,"Invalid port")
    owner=os.open(workspace_directory/"highway-field-operations-service.lock",os.O_RDWR|os.O_CREAT|os.O_NOFOLLOW,0o600)
    app=None;workspace=None;native=None;saved=None;stop=threading.Event()
    try:
        try:fcntl.flock(owner,fcntl.LOCK_EX|fcntl.LOCK_NB)
        except BlockingIOError:raise RuntimeError("The original managed highway-field-operations service still owns this workspace")
        if connection.exists():
            prior=loads(raw_file(connection,1024*1024));check(prior.get("schema")=="stellar-forge.highway-field-operations-connection.v1" and prior.get("workspaceId")==binding["workspaceId"] and prior.get("workspaceDirectory")==str(workspace_directory),"Existing connection belongs to another source workspace")
            check(prior.get("state") in ("LISTENING","STOPPED","INTERRUPTED"),"Existing managed service state is unknown")
            if prior.get("state")!="STOPPED":
                identity=prior.get("process",{})
                check(identity.get("bootId")==Path("/proc/sys/kernel/random/boot_id").read_text().strip() and identity.get("pidNamespace")==os.readlink("/proc/self/ns/pid"),"Prior managed service namespace is unresolved")
                try:actual=process_identity(identity["visiblePid"])
                except FileNotFoundError:actual=None
                check(actual is None or actual["startTicks"]!=identity.get("startTicks"),"The original managed process remains active")
        for sig in (signal.SIGINT,signal.SIGTERM):signal.signal(sig,lambda *_:stop.set())
        workspace=Workspace(workspace_directory);state=workspace.current()["state"]
        check(state["id"]==binding["workspaceId"] and state["createdAt"]==binding["createdAt"],"The original native database differs from its creation binding")
        if binding["paired"] is not None:
            paired=binding["paired"];paired_directory=private_directory(paired["directory"])
            check((paired_directory/"warehouse.duckdb").is_file(),"Select the existing original native warehouse")
            sys.path.insert(0,str(source/"vendor"/"original-paired"/"stellar"/"scf-starforge-20261009"/"sf88-operator-buyer-cli"/"python"))
            import duckdb
            check(duckdb.__version__==paired["duckdbVersion"],"The original paired engine requires DuckDB 1.5.6")
            from stellar_forge_buyer.duckdb_dataset import DuckDBWorkspace, SCHEMA as PAIRED_SCHEMA
            from stellar_forge_buyer.duckdb_agent import read_identity
            from stellar_forge_buyer.storage import lock as paired_lock
            # Read-only identity check precedes the original existing-warehouse constructor.
            with paired_lock(paired_directory):
                db=duckdb.connect(str(paired_directory/"warehouse.duckdb"),read_only=True,config={"enable_external_access":"false","autoinstall_known_extensions":"false","autoload_known_extensions":"false","allow_unsigned_extensions":"false","threads":"1","memory_limit":"128MB"})
                try:
                    check(db.execute("SELECT value FROM sf_workspace WHERE key='schema'").fetchone()==(PAIRED_SCHEMA,),"Original paired database schema differs")
                    check(read_identity(db)==paired["workspaceId"],"Original paired warehouse identity differs")
                finally:db.close()
            native=DuckDBWorkspace(paired_directory,memory_limit="128MB",threads=1)
            check(native.identity()["workspace_id"]==paired["workspaceId"],"Original paired warehouse changed")
        app=Application(workspace,source,selection,port=request["port"],native_workspace=native,receiving_root=receiving_directory)
        launch=app.start()
        saved={"schema":"stellar-forge.highway-field-operations-connection.v1","state":"LISTENING","instanceId":str(uuid.uuid4()),
            "applicationRequestId":application_request_id,"bindingSha256":request["bindingSha256"],
            "workspaceId":binding["workspaceId"],"workspaceDirectory":str(workspace_directory),"createdAt":binding["createdAt"],
            "sourceSha256":binding["sourceSha256"],"connectionFile":str(connection),"receivingDirectory":str(receiving_directory),
            "pairedWorkspace":binding["paired"],"pid":os.getpid(),"process":process_identity(),"url":launch["url"],"startedAt":now(),"stoppedAt":None}
        atomic_file(connection,canonical(saved))
        print(canonical({**saved,"schema":"stellar-forge.highway-field-operations-startup.v1"}).decode(),flush=True)
        stop.wait()
    finally:
        errors=[]
        try:
            if app:app.close()
        except BaseException as error:errors.append(error)
        try:
            if native:native.close()
        except BaseException as error:errors.append(error)
        try:
            if workspace:workspace.close()
        except BaseException as error:errors.append(error)
        try:
            if saved and connection.exists():
                current=loads(raw_file(connection,1024*1024))
                check(current.get("instanceId")==saved["instanceId"] and current.get("applicationRequestId")==application_request_id,"The original connection was replaced during closure")
                atomic_file(connection,canonical({**saved,"state":"STOPPED"if not errors else"INTERRUPTED","stoppedAt":now(),"closureErrors":[str(x)for x in errors]}))
        except BaseException as error:errors.append(error)
        os.close(owner)
        if errors:raise errors[0]
if __name__=="__main__":
    try:main()
    except BaseException as error:
        print(json.dumps({"error":{"code":getattr(error,"code","HIGHWAY_FIELD_HOST"),"message":str(error)}}),file=sys.stderr,flush=True)
        raise
