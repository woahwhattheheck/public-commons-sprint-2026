"""One retained native run, inherited child ownership and exact output recovery."""
from __future__ import annotations

import copy
import hashlib
import json
import os
from pathlib import Path
import re
import signal
import subprocess
import sys
import tempfile

from .common import (Problem, Lock, atomic_bytes, contained, digest, file_info, inventory, json_bytes,
                     json_text, lock_active, now, read_json, text, verify_file,
                     verify_inventory, write_json)

RUNTIME_PROBE = r'''
import hashlib, importlib.metadata as md, json, pathlib, platform, sys
from packaging.requirements import Requirement
from packaging.markers import default_environment
from packaging.utils import canonicalize_name
import flopy, git, matplotlib, numpy, pandas, modflow_devtools
required={"flopy":"3.11.0","modflow-devtools":"1.7.0"}
for name,version in required.items():
 if md.version(name)!=version: raise RuntimeError(name+" must be "+version)
from packaging.version import Version
if Version(md.version("matplotlib")) > Version("3.9.4"): raise RuntimeError("Publisher matplotlib must be <=3.9.4")
if sys.version_info < (3,11): raise RuntimeError("Python >=3.11 is required")
queue=["flopy","modflow-devtools","GitPython","matplotlib","numpy","pandas","packaging"]
seen={}; environment=default_environment(); environment["extra"]=""
while queue:
 name=canonicalize_name(queue.pop())
 if name in seen: continue
 dist=md.distribution(name); files=[]
 for relative in sorted(dist.files or [],key=str):
  if str(relative).endswith((".pyc",".pyo")) or "__pycache__" in str(relative): continue
  path=pathlib.Path(dist.locate_file(relative))
  if path.is_file():
   h=hashlib.sha256()
   with path.open("rb") as stream:
    while True:
     chunk=stream.read(1024*1024)
     if not chunk: break
     h.update(chunk)
   files.append({"path":str(relative),"sha256":h.hexdigest(),"bytes":path.stat().st_size})
 if not files: raise RuntimeError("No installed distribution file closure for "+name)
 encoded=json.dumps(files,sort_keys=True,separators=(",",":")).encode()
 seen[name]={"version":dist.version,"files_sha256":hashlib.sha256(encoded).hexdigest(),"files":len(files),"bytes":sum(x["bytes"] for x in files)}
 for raw in dist.requires or []:
  req=Requirement(raw)
  if req.marker is None or req.marker.evaluate(environment):
   installed=md.version(req.name)
   if req.specifier and installed not in req.specifier: raise RuntimeError("Incompatible installed dependency "+str(req))
   queue.append(req.name)
print(json.dumps({"python":platform.python_version(),"implementation":platform.python_implementation(),"platform":platform.system(),"machine":platform.machine(),"dependencies":seen},sort_keys=True))
'''

def inspect_runtime(payload, *, temp_root=None):
    selected = {}
    for key in ("python_executable","mf6_executable","mf2005_executable"):
        path = Path(text(payload.get(key),key,4000,True)).expanduser()
        if not path.is_absolute() or not path.is_file() or not os.access(path,os.X_OK):
            raise Problem("runtime_path","Select an actual existing executable.",path=str(path))
        if "\n" in str(path) or "\r" in str(path):
            raise Problem("runtime_path","Executable path contains a line break.")
        selected[key] = str(path.resolve())
    if Path(selected["mf2005_executable"]).name.lower() not in ("mf2005dbl","mf2005dbl.exe"):
        raise Problem("legacy_precision","Select the official mf2005dbl executable from release 29.0.")
    try:
        probe = subprocess.run([selected["python_executable"],"-B","-c",RUNTIME_PROBE],capture_output=True,text=True,timeout=120,env={**os.environ,"MPLBACKEND":"Agg","PYTHONDONTWRITEBYTECODE":"1"})
    except (OSError,subprocess.TimeoutExpired) as exc:
        raise Problem("runtime_probe","Could not inspect the configured native Python runtime.",detail=str(exc)) from exc
    if probe.returncode:
        raise Problem("runtime_dependencies","The selected Python runtime does not satisfy the original dependency contract.",detail=probe.stderr[-12000:])
    try:
        python = json.loads(probe.stdout.strip().splitlines()[-1])
    except (ValueError,IndexError) as exc:
        raise Problem("runtime_probe","Native Python did not return its actual dependency fingerprint.") from exc
    binaries, observations = {}, {}
    with tempfile.TemporaryDirectory(prefix="groundwater-version-",dir=temp_root) as directory:
        for engine,key,arguments,version_pattern in (
            ("mf6","mf6_executable",["-v"],r"(?<!\d)6\.8\.1(?!\d)"),
            ("mf2005","mf2005_executable",[],r"(?<!\d)1\.12(?:\.00)?(?!\d)"),
        ):
            path = selected[key]
            outcome = subprocess.run([path,*arguments],input=b"\n",capture_output=True,cwd=directory,timeout=20)
            output = (outcome.stdout+outcome.stderr).decode("utf-8",errors="replace")
            if not re.search(version_pattern,output):
                raise Problem("solver_version","Selected solver does not report the pinned publisher version.",engine=engine,observed=output[-6000:])
            binaries[engine] = {**file_info(path),"version":"6.8.1" if engine=="mf6" else "1.12.00"}
            observations[engine] = {"version_output":output,"version_probe_exit":outcome.returncode}
    identity = {"python":python,"python_binary":file_info(selected["python_executable"]),"binaries":binaries,"required_native":{"mf6_release":"6.8.1","mf2005dbl_release":"29.0","flopy":"3.11.0","modflow_devtools":"1.7.0"}}
    return {"paths":selected,"identity":identity,"sha256":digest(identity),"observations":observations}

def runtime_identity(runtime):
    """Compare complete executable content; retain volatile probe text separately.

    Older saved runtimes hashed the Fortran EOF traceback, including its PID and
    address-space layout. Validate that entire original object before deriving
    the same content identity used by newly inspected runtimes.
    """
    if not isinstance(runtime,dict) or not isinstance(runtime.get("identity"),dict):
        raise Problem("runtime_identity","The complete original runtime identity is unavailable.")
    identity=copy.deepcopy(runtime["identity"])
    if runtime.get("sha256")!=digest(identity):
        raise Problem("runtime_identity","The saved runtime fingerprint does not match its original identity.")
    if not {"python","python_binary","binaries","required_native"}<=identity.keys():
        raise Problem("runtime_identity","The original runtime closure is incomplete.")
    binaries=identity["binaries"]
    dependencies=identity["python"].get("dependencies",{})
    if not isinstance(binaries,dict) or set(binaries)!={"mf6","mf2005"} or not dependencies:
        raise Problem("runtime_identity","The original solver or dependency closure is incomplete.")
    for item in [identity["python_binary"],*binaries.values()]:
        if not isinstance(item,dict) or not re.fullmatch(r"[0-9a-f]{64}",str(item.get("sha256",""))) or not isinstance(item.get("bytes"),int) or item["bytes"]<=0:
            raise Problem("runtime_identity","An original executable content identity is incomplete.")
    for item in dependencies.values():
        if not isinstance(item,dict) or not item.get("version") or not re.fullmatch(r"[0-9a-f]{64}",str(item.get("files_sha256",""))) or not item.get("files"):
            raise Problem("runtime_identity","An original installed dependency identity is incomplete.")
    for item in binaries.values():
        item.pop("version_output",None)
        item.pop("version_probe_exit",None)
    return identity

def runtime_matches(original,actual):
    return runtime_identity(original)==runtime_identity(actual)

def run_directory(workspace,run_id):
    return workspace.directory/"runs"/run_id

def run_summary(workspace,run):
    result = {k:run[k] for k in ("id","project_id","edition_id","state","attempt","runtime_sha256","application_sha256","created","updated","issue","result_sha256") if k in run}
    active = lock_active(run_directory(workspace,run["id"])/"worker.lock")
    result["worker_active"] = active
    if result["state"]=="running" and not active:
        result["state"]="interrupted"
    return result

def _attempt(workspace,run):
    if not run.get("attempt"):
        return None
    return run_directory(workspace,run["id"])/"attempts"/str(run["attempt"])

def completed_result(workspace,run):
    attempt = _attempt(workspace,run)
    if attempt is None or not (attempt/"outcome.json").is_file():
        raise Problem("run_incomplete","The original run has no complete native outcome.",run_id=run["id"])
    outcome = read_json(attempt/"outcome.json")
    if outcome.get("state")!="complete":
        raise Problem("run_incomplete","The original native attempt is not complete.",run_id=run["id"],outcome=outcome)
    verify_file(attempt/"result.json",outcome["result"])
    result = read_json(attempt/"result.json")
    expected = (run["id"],run["edition_id"],run["edition_sha256"],run["source_id"],run["source_sha256"],run["runtime_sha256"],run["application_sha256"],run["project_id"])
    actual = tuple(result.get(k) for k in ("run_id","edition_id","edition_sha256","source_id","source_sha256","runtime_sha256","application_sha256","project_id"))
    if actual != expected:
        raise Problem("native_result_identity","The native result does not belong to this frozen original run.")
    verify_inventory(attempt,result["files"])
    for engine in ("mf6","mf2005"):
        receipts = [x for x in result["native_executions"] if x["engine"]==engine and not x.get("version_probe")]
        if len(receipts)!=1 or receipts[0]["returncode"]!=0 or not receipts[0].get("normal_termination"):
            raise Problem("native_execution","The original result lacks exactly one successful actual engine execution.",engine=engine)
    return result

def run_detail(workspace,run_id):
    run = workspace.record(run_id,"run")
    directory = run_directory(workspace,run_id)
    attempts = []
    for path in sorted((directory/"attempts").glob("*"),key=lambda p:int(p.name)):
        if path.is_dir():
            item = {"attempt":int(path.name)}
            for filename,key in (("dispatch.json","dispatch"),("outcome.json","outcome")):
                if (path/filename).is_file():
                    item[key]=read_json(path/filename)
            attempts.append(item)
    result = None
    if run["state"]=="complete" or (_attempt(workspace,run) and (_attempt(workspace,run)/"outcome.json").is_file() and read_json(_attempt(workspace,run)/"outcome.json").get("state")=="complete"):
        result=completed_result(workspace,run)
    with workspace.connect() as db:
        review = workspace._latest_review(db,"run",run_id,digest(result)) if result else None
    log_excerpt=None
    original_attempt=_attempt(workspace,run)
    if original_attempt is not None and (original_attempt/"worker.log").is_file():
        log=contained(original_attempt,"worker.log")
        with log.open("rb") as stream:
            stream.seek(0,os.SEEK_END);size=stream.tell();stream.seek(max(0,size-65536));tail=stream.read(65536)
        log_excerpt={"attempt":run["attempt"],"path":"worker.log","bytes":size,"tail":tail.decode("utf-8",errors="replace"),"observed_at":now(),"scope":"Observed log excerpt; immutable completion files are listed separately."}
    return {"log_excerpt":log_excerpt,"run":{**run_summary(workspace,run),"runtime":run["runtime"],"runtime_rebindings":run.get("runtime_rebindings",[])},"edition":workspace.record(run["edition_id"],"edition"),"source":workspace.record(run["source_id"],"source"),"result":result,"attempts":attempts,"files":result["files"] if result else [],"review":review}

def run_file(workspace,run_id,name):
    run = workspace.record(run_id,"run")
    result = completed_result(workspace,run)
    row = next((r for r in result["files"] if r["path"]==name),None)
    if row is None:
        raise Problem("file_not_found","This path is not a frozen file from the original native attempt.",404)
    path = contained(_attempt(workspace,run),name)
    return workspace._file(path,row,Path(name).name)

def _adopt_completed(workspace,db,run):
    attempt = _attempt(workspace,run)
    if attempt and (attempt/"outcome.json").is_file():
        outcome=read_json(attempt/"outcome.json")
        if outcome.get("state")=="complete":
            result=completed_result(workspace,run)
            body={k:v for k,v in run.items() if k not in ("id","project_id","created","updated")}
            body.update({"state":"complete","result_sha256":digest(result),"issue":None})
            return workspace._put(db,run["id"],"run",body,run["project_id"])
    return run

def prepare_launch(workspace,db,run,retry,rebind,actor,reason):
    run=_adopt_completed(workspace,db,run)
    if run["state"]=="complete":
        return run
    active=lock_active(run_directory(workspace,run["id"])/"worker.lock")
    if active:
        return run
    attempt=_attempt(workspace,run)
    if attempt and (attempt/"dispatch.json").exists() and not retry:
        raise Problem("original_attempt_incomplete","The prior attempt is retained. Inspect it and explicitly select retry of the same unchanged run before a new native attempt.",run_id=run["id"],attempt=run["attempt"])
    if rebind:
        configured=workspace._meta(db).get("runtime")
        if not configured:
            raise Problem("runtime_required","Configure the receiving host runtime before rebinding.")
        runtime=json.loads(configured)
        if run["runtime"].get("sha256")!=run["runtime_sha256"] or not runtime_matches(run["runtime"],runtime):
            raise Problem("runtime_mismatch","The receiving host runtime differs from the exact frozen binary and dependency closure.")
        body={k:v for k,v in run.items() if k not in ("id","project_id","created","updated")}
        body["runtime_rebindings"]=[*run.get("runtime_rebindings",[]),{"before":run["runtime"]["paths"],"after":runtime["paths"],"runtime_sha256":run["runtime_sha256"],"observed_runtime":runtime,"actor":actor,"reason":reason,"created":now()}]
        body["runtime"]={**run["runtime"],"paths":runtime["paths"]}
        run=workspace._put(db,run["id"],"run",body,run["project_id"])
    return run

def launch(workspace,run_id,retry_incomplete=False):
    run=workspace.record(run_id,"run")
    if run["state"]=="complete":
        completed_result(workspace,run)
        return run_summary(workspace,run)
    directory=run_directory(workspace,run_id)
    if lock_active(directory/"worker.lock"):
        return run_summary(workspace,run)
    with Lock(workspace.directory/"native.lock",blocking=False) as global_lock, Lock(directory/"worker.lock",blocking=False) as run_lock:
        run=workspace.record(run_id,"run")
        previous=_attempt(workspace,run)
        if previous and (previous/"outcome.json").is_file() and read_json(previous/"outcome.json").get("state")=="complete":
            result=completed_result(workspace,run)
            workspace.update_native(run_id,{"state":"complete","result_sha256":digest(result),"issue":None})
            return run_summary(workspace,workspace.record(run_id,"run"))
        attempted=bool(previous and (previous/"dispatch.json").exists())
        if attempted and not retry_incomplete:
            raise Problem("original_attempt_incomplete","The original dispatch must be explicitly reviewed before retry.")
        if digest(run.get("application_files",[]))!=run.get("application_sha256"):
            raise Problem("application_identity","The original queued application manifest is unavailable or changed.")
        for row in run["application_files"]:
            workspace.objects.bytes(row)
        actual=inspect_runtime(run["runtime"]["paths"],temp_root=workspace.directory)
        if run["runtime"].get("sha256")!=run["runtime_sha256"] or not runtime_matches(run["runtime"],actual):
            raise Problem("runtime_changed","The configured native binary or installed dependency content changed after the original run was queued.")
        edition=workspace.record(run["edition_id"],"edition")
        source=workspace.record(run["source_id"],"source")
        if edition["sha256"]!=run["edition_sha256"] or source["sha256"]!=run["source_sha256"]:
            raise Problem("run_source_changed","Original run source/edition identity differs.")
        # A reserved but undispatched attempt resumes its original preparation.
        attempt_number=int(run.get("attempt",0)) if run.get("attempt") and not attempted else int(run.get("attempt",0))+1
        attempt=directory/"attempts"/str(attempt_number)
        intent_path=directory/("attempt-"+str(attempt_number)+"-intent.json")
        application=attempt/"application"
        if intent_path.exists():
            request=read_json(intent_path)
            wanted=(run_id,attempt_number,run["source_sha256"],run["edition_sha256"],run["runtime_sha256"],run["application_sha256"])
            retained=tuple(request["run"].get(key) for key in ("id","attempt","source_sha256","edition_sha256","runtime_sha256","application_sha256"))
            if wanted!=retained or request.get("workspace")!=str(workspace.directory) or request.get("application")!=str(application):
                raise Problem("attempt_preparation_identity","The original native attempt preparation does not match this retained run and workspace.")
        else:
            if attempt.exists():
                raise Problem("attempt_preparation_unavailable","An existing attempt has no original preparation request. Preserve its files before continuing.")
            retained_run={**run,"attempt":attempt_number}
            request={"schema":"starforge.groundwater-run-request.v1","run":retained_run,"edition":edition,"source":source,"workspace":str(workspace.directory),"application":str(application),"active_application":str(workspace.application),"attempt_directory":str(attempt),"runtime":actual,"created":now()}
            write_json(intent_path,request,create_only=True)
        workspace.update_native(run_id,{"state":"queued","attempt":attempt_number,"issue":None})
        attempt.mkdir(parents=True,exist_ok=True)
        for row in run["application_files"]:
            atomic_bytes(contained(application,row["path"]),workspace.objects.bytes(row),create_only=True)
        verify_inventory(application,run["application_files"])
        write_json(attempt/"request.json",request,create_only=True)
        write_json(attempt/"dispatch.json",{"run_id":run_id,"attempt":attempt_number,"request_sha256":digest(request),"state":"prepared","created":now()},create_only=True)
        workspace.update_native(run_id,{"state":"running","attempt":attempt_number,"issue":None})
        environment={**os.environ,"PYTHONDONTWRITEBYTECODE":"1","MPLBACKEND":"Agg","GROUNDWATER_LOCK_FDS":str(global_lock.fd)+","+str(run_lock.fd)}
        launcher=application/"groundwater_workspace"/"native_attempt.py"
        stream=(attempt/"worker.log").open("ab",buffering=0)
        child=None
        try:
            try:
                child=subprocess.Popen([actual["paths"]["python_executable"],"-B",str(launcher),str(attempt/"request.json")],cwd=attempt,env=environment,stdout=stream,stderr=subprocess.STDOUT,pass_fds=(global_lock.fd,run_lock.fd),start_new_session=True)
            except OSError as exc:
                write_json(attempt/"outcome.json",{"state":"failed","phase":"launch","issue":{"code":"launch_failed","message":str(exc)},"finished":now()},create_only=True)
                workspace.update_native(run_id,{"state":"failed","issue":{"code":"launch_failed","message":str(exc)}})
                raise Problem("launch_failed","The original native worker could not start.",detail=str(exc)) from exc
            # Failure here cannot relabel an already started original child as failed.
            try:
                write_json(attempt/"process.json",{"pid":child.pid,"created":now(),"request_sha256":digest(request),"executable":actual["paths"]["python_executable"]},create_only=True)
            except OSError as exc:
                raise Problem("process_readback_unavailable","The original worker started but its process metadata could not be saved. Read this same run; do not create another execution.",run_id=run_id,pid=child.pid,detail=str(exc)) from exc
        finally:
            stream.close()
    return run_summary(workspace,workspace.record(run_id,"run"))
