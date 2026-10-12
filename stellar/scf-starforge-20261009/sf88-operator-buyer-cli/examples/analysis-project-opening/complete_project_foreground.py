#!/usr/bin/env python3
"""Complete the original Analysis receiving, portable project and one file save."""
from __future__ import annotations
import argparse, ast, base64, contextlib, fcntl, hashlib, importlib.util, json, os
from pathlib import Path, PurePosixPath
import select, signal, stat, sys, time, traceback, zipfile

BASE=Path("/workspace/scratch/7de2cd02ad5f/analysis-project-opening-20261012")
ROOT=Path("/dev/7de2-analysis-project-opening-20261012")
ORIGINAL=Path("/workspace/scratch/7de2cd02ad5f/analysis-workspace-archive/SCF_Analysis_Workspace_Backup_20261012.zip")
OPERATION="SCF-ANALYSIS-PROJECT-OPENING-7DE2-20261012"
OLD_PINS="6ab048a25b028fb924d113ecff6af01c95a31f3f8fd7b98d3cc8bbf1a521153e"
OLD_RECEIVER="d4c18d4c8109010a78f23dc76126b82a8a24c05c193313931088d9dcd64a996d"
OLD_DRIVER="c19152f093a06d32a551372becaa49cf8edd31f5592c8109e2f48505dbeb4c31"
VIEWER="3686705c3ad4519eb900fc757dc3f88c0d4c7b0be26cb8752f1a211ed55971b0"
NATIVE_SELECTION="ea63afe5eef4ecdd3dc7a878fefc15db81447763d4ee277acbfc0ec9e3ebbae8"
HELPERS=Path("/workspace/scratch/7de2cd02ad5f/newton-corpus-continuation/library-native-20261012")
HELPER_PINS={"library_upload.py":"5bc473dadefe1f68ee8797baaed19d6662642d0ea4bcba128fa12938faa0d767",
 "library_hosted_apps.py":"97d029b097ace62b744c82dfde20ef6921ed543a33a771ecf6452bd655d11b59",
 "library_file_transfer.py":"5e1557817be17db06e2375f8c34ed83e948d520242e5ee4cb50a30c7a4c83378"}
os.umask(0o077)

def encoded(value):
    return (json.dumps(value,ensure_ascii=False,allow_nan=False,sort_keys=True,separators=(",",":"))+"\n").encode()

def ident(raw):
    return {"bytes":len(raw),"sha256":hashlib.sha256(raw).hexdigest()}

def sync(path):
    descriptor=os.open(path,os.O_RDONLY|os.O_DIRECTORY)
    try: os.fsync(descriptor)
    finally: os.close(descriptor)

def private(path):
    path=Path(path).absolute()
    missing=[]; current=path
    while not os.path.lexists(current):
        missing.append(current); current=current.parent
    for selected in reversed(missing):
        selected.mkdir(mode=0o700)
        sync(selected); sync(selected.parent)
    info=path.lstat()
    if (not stat.S_ISDIR(info.st_mode) or info.st_mode&0o077
            or info.st_uid!=os.geteuid() or path.resolve()!=path):
        raise ValueError("Keep the original private directory: "+str(path))
    sync(path);sync(path.parent)
    return path

def raw_file(path,maximum=256*1024*1024):
    path=Path(path).absolute()
    if path.resolve()!=path: raise ValueError("Select the original regular file: "+str(path))
    descriptor=os.open(path,os.O_RDONLY|os.O_NOFOLLOW)
    with os.fdopen(descriptor,"rb") as stream:
        before=os.fstat(stream.fileno())
        if not stat.S_ISREG(before.st_mode) or before.st_size>maximum:
            raise ValueError("Select a complete regular source file: "+str(path))
        raw=stream.read(maximum+1); after=os.fstat(stream.fileno())
        stamp=lambda s:(s.st_dev,s.st_ino,s.st_size,s.st_mtime_ns,s.st_ctime_ns)
        if len(raw)!=before.st_size or stamp(before)!=stamp(after):
            raise ValueError("Original file changed while reading: "+str(path))
        return raw

def publish(path,raw,*,replace=False):
    private(path.parent)
    if os.path.lexists(path):
        existing=raw_file(path)
        if existing==raw:
            with path.open("rb") as f: os.fsync(f.fileno())
            sync(path.parent);return
        if not replace: raise ValueError("Original immutable file differs: "+str(path))
    temporary=path.with_name("."+path.name+".partial")
    descriptor=os.open(temporary,os.O_WRONLY|os.O_CREAT|os.O_NOFOLLOW,0o600)
    with os.fdopen(descriptor,"wb") as stream:
        info=os.fstat(stream.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_nlink!=1 or info.st_uid!=os.geteuid():
            raise ValueError("Keep the original source publication temporary")
        os.ftruncate(stream.fileno(),0);stream.write(raw);stream.flush();os.fsync(stream.fileno())
    os.replace(temporary,path);sync(path.parent)

def save(path,value,*,replace=False): publish(path,encoded(value),replace=replace)

@contextlib.contextmanager
def lock(path):
    descriptor=os.open(path,os.O_RDWR|os.O_CREAT|os.O_NOFOLLOW,0o600)
    try:
        info=os.fstat(descriptor)
        if not stat.S_ISREG(info.st_mode) or info.st_nlink!=1 or info.st_uid!=os.geteuid():
            raise ValueError("Keep the original operation lock")
        fcntl.flock(descriptor,fcntl.LOCK_EX|fcntl.LOCK_NB)
        yield
    finally: os.close(descriptor)

def emit(value):
    try: print(json.dumps(value,ensure_ascii=False,separators=(",",":")),flush=True)
    except OSError: pass

def load_module(path,name):
    spec=importlib.util.spec_from_file_location(name,path)
    module=importlib.util.module_from_spec(spec)
    sys.modules[name]=module
    spec.loader.exec_module(module)
    return module

def source_selection(frame):
    """Copy the complete selected source while leaving its retained donor intact."""
    donor=BASE/"native-source"
    old_pins=raw_file(donor/"module-pins.json")
    if ident(old_pins)["sha256"]!=OLD_PINS: raise ValueError("The original complete Python donor changed")
    rows=json.loads(old_pins)
    names={row["path"] for row in rows}
    actual={p.relative_to(donor).as_posix() for p in donor.rglob("*.py")}
    if len(rows)!=42 or names!=actual or len(names)!=len(rows):
        raise ValueError("Select the original complete 42-module Python closure")
    target=private(ROOT/"selected-python")
    history=private(ROOT/"source-history")
    publish(history/"original-module-pins.json",old_pins)
    receiver_raw=frame["receiver"].encode()
    driver_raw=frame["driver"].encode()
    retention_raw=frame["response_sources"].encode()
    ast.parse(receiver_raw.decode());ast.parse(driver_raw.decode());ast.parse(retention_raw.decode())
    selected=[]
    for row in rows:
        name=row["path"]
        rel=PurePosixPath(name)
        if rel.is_absolute() or ".." in rel.parts or rel.as_posix()!=name:
            raise ValueError("Keep the canonical original module selection")
        raw=raw_file(donor/name)
        if ident(raw)!={key:row[key] for key in ("bytes","sha256")}:
            raise ValueError("The original Python source differs: "+name)
        if name=="stellar_forge_buyer/workspace_archive_receive.py":
            if ident(raw)["sha256"]!=OLD_RECEIVER: raise ValueError("The original receiver differs")
            publish(history/"workspace_archive_receive.before.py",raw)
            raw=receiver_raw
        elif name=="stellar_forge_buyer/response_sources.py":
            if ident(raw)["sha256"]!="dd2c6492ffb5a3f48d3da96204ba30407423e2524d8053b9c8bf955597a5dc80":
                raise ValueError("The original response retention source differs")
            publish(history/"response_sources.before.py",raw)
            raw=retention_raw
        ast.parse(raw.decode())
        publish(target/name,raw)
        selected.append({**row,**ident(raw),
                         "gitBlob":hashlib.sha1(b"blob "+str(len(raw)).encode()+b"\0"+raw).hexdigest()})
    pins=encoded(selected)
    publish(target/"module-pins.json",pins)
    old_driver=raw_file(BASE/"source"/"open_original_project.py")
    if ident(old_driver)["sha256"]!=OLD_DRIVER: raise ValueError("The original journey source differs")
    publish(history/"open_original_project.before.py",old_driver)
    publish(ROOT/"control-source"/"open_original_project.py",driver_raw)
    publish(ROOT/"control-source"/"publish_complete_project.py",frame["publisher"].encode())
    publish(ROOT/"publish-support"/"library_upload.py",frame["uploader"].encode())
    for name in ("build_project.py","open_project.py","portable.html","RECEIVING.md","RETAINED_RESPONSES.md"):
        raw=raw_file(BASE/"source"/name)
        if name=="portable.html" and ident(raw)["sha256"]!=VIEWER:
            raise ValueError("Select the complete reviewed offline viewer")
        publish(ROOT/"control-source"/name,raw)
    native=BASE/"native-source"/"native"
    native_raw=raw_file(native/"source-selection.json")
    if ident(native_raw)["sha256"]!=NATIVE_SELECTION: raise ValueError("The original complete Node reader selection differs")
    native_rows=json.loads(native_raw)
    if len(native_rows)!=8: raise ValueError("Keep the complete original eight-module reader")
    for row in native_rows:
        if ident(raw_file(native/row["path"]))!={key:row[key] for key in ("bytes","sha256")}:
            raise ValueError("The original Node reader source differs")
    publish(history/"native-source-selection.json",native_raw)
    amendment={"schema":"stellar-forge.analysis-source-continuation.v1","operation":OPERATION,
               "original_inventory":ident(old_pins),"selected_inventory":ident(pins),
               "receiver":{"before":OLD_RECEIVER,"after":ident(receiver_raw)},
               "journey":{"before":OLD_DRIVER,"after":ident(driver_raw)},
               "response_retention":{"before":"dd2c6492ffb5a3f48d3da96204ba30407423e2524d8053b9c8bf955597a5dc80",
                                     "after":ident(retention_raw),"native_file_contract":"FileDelivery.expected_destination"},
               "previous_attempt":frame["previous_attempt"],
               "reason":"Explicit private intermediate directories, immutable original database, and native verified FileDelivery destination",
               "donor_unchanged":True}
    save(history/"source-amendment.json",amendment)
    return target,target/"module-pins.json",native,selected,native_rows,amendment

def reconcile_original_extraction(amendment):
    """Continue only the actual original pre-application receiving boundary."""
    intent=ROOT/"operation.json"
    if not intent.exists(): return
    with lock(ROOT/"operation.lock"):
        old=json.loads(raw_file(intent))
        desired=amendment["selected_inventory"]
        if old.get("module_inventory")==desired: return
        if (old.get("operation")!=OPERATION or old.get("module_inventory")!=amendment["original_inventory"]
                or old.get("original_archive",{}).get("sha256")!="41030ce3c6538c21cb9088e839839b889ffd0fb99fff57f417f62cbbd390c53c"
                or old.get("workspace_id")!="5e7e814ca0a4464680168c079b0430bb"
                or old.get("receiving_id")!="82e78351199f4a8b8c4d6f9c95fd2881"):
            raise ValueError("Keep the original pre-application source binding")
        if any((ROOT/name).exists() for name in ("result.json","archive-job.json","archive-review.json")):
            raise ValueError("The original application has progressed; retain its current source binding")
        parent=ROOT/"source"
        control=parent/(".analysis-receive-"+hashlib.sha256(os.fsencode("analysis")).hexdigest()[:24])
        target=parent/"analysis"
        with lock(control/"operation.lock"):
            state=json.loads(raw_file(control/"operation.json"))
            if (target.exists() or state.get("phase")!="extracting"
                    or state.get("operation_id")!=old["receiving_id"]
                    or state.get("archive_sha256")!=old["original_archive"]["sha256"]):
                raise ValueError("The original receiving boundary has advanced")
            with zipfile.ZipFile(ORIGINAL) as package:
                manifest=json.loads(package.read("archive-manifest.json"))
            expected={x["path"]:x for x in manifest["files"]}
            directories={str(p) for name in expected for p in PurePosixPath(name).parents if str(p)!="."}
            stage=control/"content"; found=set(); tighten=[]
            for folder,children,files in os.walk(stage,followlinks=False):
                path=Path(folder); info=path.lstat()
                relative=path.relative_to(stage).as_posix()
                if (not stat.S_ISDIR(info.st_mode) or info.st_uid!=os.geteuid()
                        or path.resolve()!=path or stat.S_IMODE(info.st_mode) not in (0o700,0o755)
                        or relative!="." and relative not in directories):
                    raise ValueError("The owned original staging directory differs")
                if stat.S_IMODE(info.st_mode)==0o755: tighten.append(path)
                for name in files:
                    p=path/name; rel=p.relative_to(stage).as_posix()
                    if rel not in expected or ident(raw_file(p))!={k:expected[rel][k] for k in ("bytes","sha256")}:
                        raise ValueError("The original staged payload differs")
                    info=p.lstat()
                    if info.st_nlink!=1 or info.st_uid!=os.geteuid() or info.st_mode&0o077:
                        raise ValueError("The original staged file ownership differs")
                    found.add(rel)
            if found!=set(expected): raise ValueError("The original extraction is incomplete")
            save(ROOT/"source-history"/"previous-operation.json",old)
            save(ROOT/"source-history"/"directory-recovery.json",
                 {"operation":OPERATION,"receiving":state,"verified_files":len(found),
                  "directories":[str(p.relative_to(stage)) for p in tighten]})
            for p in tighten: os.chmod(p,0o700);sync(p);sync(p.parent)
            save(intent,{**old,"module_inventory":desired},replace=True)

def select_extra(python_source,pins,native,native_rows):
    rows=[]
    def add(path,source):
        raw=raw_file(source)
        rows.append({"path":path,"source":str(source),**ident(raw)})
    for row in json.loads(raw_file(pins)):
        add("runtime/python/"+row["path"],python_source/row["path"])
    add("runtime/python/module-pins.json",pins)
    for row in native_rows:
        add("runtime/native/"+row["path"],native/row["path"])
    add("runtime/native/source-selection.json",native/"source-selection.json")
    for name in ("open_original_project.py","build_project.py","open_project.py","portable.html","publish_complete_project.py"):
        add("source/"+name,ROOT/"control-source"/name)
    add("source/complete_project_foreground.py",ROOT/"control-source"/"complete_project_foreground.py")
    add("source/library_upload_adapter.py",ROOT/"publish-support"/"library_upload.py")
    add("open_project.py",ROOT/"control-source"/"open_project.py")
    for name in ("RECEIVING.md","RETAINED_RESPONSES.md"):
        add(name,ROOT/"control-source"/name)
    for path in sorted((ROOT/"source-history").rglob("*")):
        if path.is_file(): add("receiving/source-history/"+path.relative_to(ROOT/"source-history").as_posix(),path)
    for name in ("operation.json","result.json","archive-review.json","archive-job.json"):
        if (ROOT/name).is_file(): add("receiving/"+name,ROOT/name)
    add("original/SCF_Analysis_Workspace_Backup_20261012.zip",ORIGINAL)
    add("source/original-package-input.json",ROOT/"control-source"/"source-frame.json")
    return rows

def save_complete(archive,built):
    # Reuse the reviewed original per-artifact intent, stdout/ACK recovery and
    # protected custody loop. Only this project's roots, schema and input differ.
    publisher=load_module(ROOT/"control-source"/"publish_complete_project.py","analysis_project_publisher")
    private(ROOT/"file-save")
    state={"schema":"stellar-forge.analysis-private-project-save.v1","operation":OPERATION,
           "input_sha256":publisher.INPUT_SHA,"state":"ARTIFACT_READY","started_at":publisher.now()}
    return publisher.publish_completed(state,built,archive)

class RequestedStop(SystemExit):
    pass

def stop(number,_frame):
    for chosen in (signal.SIGTERM,signal.SIGINT):
        signal.signal(chosen,signal.SIG_IGN)
    raise RequestedStop(128+number)

def await_continuation(state):
    """Keep the same private source alive until its owner continues this operation."""
    for number in (signal.SIGTERM,signal.SIGINT):
        signal.signal(number,signal.SIG_IGN)
    try:save(ROOT/"foreground-error.json",state,replace=True)
    except OSError:pass
    emit(state)
    readable=True
    while True:
        if not readable:
            time.sleep(5);continue
        try:ready,_,_=select.select([sys.stdin],[],[],5)
        except (OSError,ValueError):
            readable=False;continue
        if not ready:continue
        line=sys.stdin.buffer.readline(8193)
        if not line:
            readable=False;continue
        try:command=json.loads(line)
        except (ValueError,UnicodeError):
            emit({"state":"ORIGINAL_CONTINUATION_COMMAND_REQUIRED","operation":OPERATION});continue
        if command=={"operation":OPERATION,"action":"continue"}:
            return
        emit({"state":"ORIGINAL_CONTINUATION_COMMAND_REQUIRED","operation":OPERATION})

def archive_identity(path):
    path=Path(path)
    if path.resolve()!=path:
        raise ValueError("Select the original completed archive")
    descriptor=os.open(path,os.O_RDONLY|os.O_NOFOLLOW)
    with os.fdopen(descriptor,"rb") as stream:
        before=os.fstat(stream.fileno())
        if not stat.S_ISREG(before.st_mode):
            raise ValueError("Select the complete regular project archive")
        digest=hashlib.file_digest(stream,"sha256").hexdigest()
        after=os.fstat(stream.fileno())
        stamp=lambda item:(item.st_dev,item.st_ino,item.st_size,item.st_mtime_ns,item.st_ctime_ns)
        if stamp(before)!=stamp(after):
            raise ValueError("The original completed archive changed")
        os.fsync(stream.fileno())
    sync(path.parent)
    return {"bytes":before.st_size,"sha256":digest}

def retain_archive_name(original,expected):
    """Give the same complete inode its delivery name without another ZIP copy."""
    named=ROOT/"delivery"/"SCF_Analysis_Complete_Project_20261012.zip"
    private(named.parent)
    if not os.path.lexists(named):
        os.link(original,named,follow_symlinks=False)
    if archive_identity(named)!=expected:
        raise ValueError("The original named project archive differs")
    sync(named.parent)
    return {"path":str(named),**expected}

def finish_project(builder,build_arguments,result,interruption):
    """Retain the original completed ZIP through every post-build local failure."""
    for number in (signal.SIGTERM,signal.SIGINT):
        signal.signal(number,signal.SIG_IGN)
    archive_path=ROOT/"project"/"Analysis_Project.zip"
    if isinstance(interruption,(RequestedStop,KeyboardInterrupt,SystemExit)):
        await_continuation({"state":"AWAITING_ORIGINAL_CONTINUATION","operation":OPERATION,
                            "boundary":"project-build","archive_path":str(archive_path),
                            "kind":type(interruption).__name__,"message":str(interruption)})
    elif result is None and not archive_path.exists():
        await_continuation({"state":"AWAITING_ORIGINAL_CONTINUATION","operation":OPERATION,
                            "boundary":"project-build","archive_path":str(archive_path),
                            "kind":type(interruption).__name__ if interruption else None,
                            "message":str(interruption) if interruption else None})
    last_notice=None
    while True:
        try:
            if result is None:
                # This original builder verifies/reuses the exact published ZIP,
                # then repairs only missing local result/HTML/manifest journals.
                result=builder.build(**build_arguments)
            if result.get("state")!="COMPLETE" or result.get("workspace_id")!="5e7e814ca0a4464680168c079b0430bb":
                raise ValueError("Keep the original completed project result")
            selected=Path(result["archive"]["path"])
            if selected!=archive_path:
                raise ValueError("Keep the original selected completed project ZIP")
            expected={key:result["archive"][key] for key in ("bytes","sha256")}
            if archive_identity(selected)!=expected:
                raise ValueError("The original completed project ZIP differs")
            archive=retain_archive_name(selected,expected)
            emit({"state":"COMPLETE_PROJECT_BUILT","operation":OPERATION,"result":result})
            # Import, control-directory publication and the one provider intent
            # are all inside this same protected completed-artifact retry.
            return save_complete(archive,result)
        except BaseException as error:
            state={"state":"AWAITING_ARTIFACT_CUSTODY","operation":OPERATION,
                   "archive_path":str(archive_path),"kind":type(error).__name__,"message":str(error)}
            try:save(ROOT/"foreground-error.json",state,replace=True)
            except OSError:pass
            notice=(type(error).__name__,str(error))
            if notice!=last_notice:
                emit(state);last_notice=notice
        time.sleep(5)

def perform(frame):
    private(ROOT)
    with lock(ROOT/"complete-project.lock"):
        os.environ["TMPDIR"]=str(private(ROOT/"temporary"))
        python_source,pins,native,rows,native_rows,amendment=source_selection(frame)
        reconcile_original_extraction(amendment)
        sys.path.insert(0,str(python_source))
        driver=load_module(ROOT/"control-source"/"open_original_project.py","original_analysis_journey")
        node=Path(os.environ.get("CODEX_PRIMARY_RUNTIME_NODE","/opt/codex/runtimes/codex-primary-runtime/dependencies/node/bin/node")).absolute()
        args=argparse.Namespace(python_source=str(python_source),module_pins=str(pins),archive=str(ORIGINAL),
                               checkout=str(native),node=str(node),directory=str(ROOT))
        emit({"state":"ORIGINAL_SOURCE_SELECTED","operation":OPERATION,"python_modules":len(rows),
              "native_modules":len(native_rows),"source_amendment":amendment})
        driver.run(args)
        opened=json.loads(raw_file(ROOT/"result.json"))
        if opened.get("state")!="COMPLETE" or opened.get("operation")!=OPERATION:
            raise ValueError("Keep the original completed project opening")
        builder=load_module(ROOT/"control-source"/"build_project.py","original_analysis_project_builder")
        extras=select_extra(python_source,pins,native,native_rows)
        save(ROOT/"selected-project-files.json",extras)
        build_arguments={"archive":opened["complete_archive"]["path"],"output":ROOT/"project",
             "viewer":ROOT/"control-source"/"portable.html","archive_sha256":opened["complete_archive"]["sha256"],
             "extra_files":extras,"title":"Source, queries, reports and workbooks"}
        result=None;interruption=None
        try:
            result=builder.build(**build_arguments)
        except BaseException as error:
            interruption=error
        finally:
            for number in (signal.SIGTERM,signal.SIGINT):
                signal.signal(number,signal.SIG_IGN)
        return finish_project(builder,build_arguments,result,interruption)

def main():
    frame=json.loads(raw_file(ROOT/"control-source"/"source-frame.json"))
    previous={number:signal.getsignal(number) for number in (signal.SIGTERM,signal.SIGINT)}
    try:
        while True:
            for number in previous:signal.signal(number,stop)
            try:
                return perform(frame)
            except BaseException as error:
                # The original driver has positively closed its owned work.
                # A closed stdin cannot release this private source/continuation.
                state={"state":"AWAITING_ORIGINAL_CONTINUATION","operation":OPERATION,
                       "kind":type(error).__name__,"message":str(error)}
                traceback.print_exc()
                await_continuation(state)
    finally:
        for number,handler in previous.items():signal.signal(number,handler)

if __name__=="__main__":raise SystemExit(main())
