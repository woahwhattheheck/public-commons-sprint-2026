"""Owned worker; original publisher code and both native engine outcomes remain intact."""
from __future__ import annotations
import json
import os
from pathlib import Path
import runpy
import signal
import subprocess
import sys
import traceback

sys.dont_write_bytecode=True
sys.path.insert(0,str(Path(__file__).resolve().parent.parent))
from groundwater_workspace.common import Problem, atomic_bytes, digest, file_info, inventory, json_text, now, read_json, verify_file, write_json
from groundwater_workspace.analysis import extract_outputs, plot_native

AUDIT = r'''#!PYTHON
import hashlib,json,os,pathlib,signal,subprocess,sys,threading,time
engine=ENGINE
binary=BINARY
directory=pathlib.Path(os.environ["GROUNDWATER_ATTEMPT"])/"native-executions"
directory.mkdir(parents=True,exist_ok=True)
serial=len(list(directory.glob(engine+"-*.json")))+1
record=directory/(engine+"-"+str(serial)+".json")
entry={"engine":engine,"binary":binary,"argv":sys.argv[1:],"cwd":os.getcwd(),"started_ns":time.time_ns(),"version_probe":False}
fds=tuple(int(x) for x in os.environ.get("GROUNDWATER_LOCK_FDS","").split(",") if x)
child=None
def publish():
 temporary=record.with_suffix(".tmp")
 with temporary.open("w",encoding="utf-8") as stream:
  json.dump(entry,stream,sort_keys=True);stream.flush();os.fsync(stream.fileno())
 os.replace(temporary,record)
def stop(signum,frame):
 if child is not None and child.poll() is None:
  child.send_signal(signum)
signal.signal(signal.SIGTERM,stop)
signal.signal(signal.SIGINT,stop)
def transfer(source,destination,log):
 with log.open("wb") as stream:
  while True:
   chunk=source.read(4096)
   if not chunk: break
   stream.write(chunk);stream.flush()
   destination.buffer.write(chunk);destination.buffer.flush()
  os.fsync(stream.fileno())
 source.close()
publish()
try:
 child=subprocess.Popen([binary,*sys.argv[1:]],pass_fds=fds,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
 entry["pid"]=child.pid;publish()
 out=record.with_suffix(".stdout.log");err=record.with_suffix(".stderr.log")
 threads=[threading.Thread(target=transfer,args=(child.stdout,sys.stdout,out)),threading.Thread(target=transfer,args=(child.stderr,sys.stderr,err))]
 for thread in threads:thread.start()
 code=child.wait()
 for thread in threads:thread.join()
 entry["returncode"]=code;entry["finished_ns"]=time.time_ns()
 for key,path in (("stdout",out),("stderr",err)):
  raw=path.read_bytes()
  entry[key]={"path":path.name,"sha256":hashlib.sha256(raw).hexdigest(),"bytes":len(raw)}
 entry["normal_termination"]="normal termination" in (out.read_text(errors="replace")+err.read_text(errors="replace")).lower()
 publish()
except BaseException as exc:
 entry["issue"]=str(exc);entry["finished_ns"]=time.time_ns();publish();raise
sys.exit(code)
'''

def audit_executables(attempt,runtime):
    bindir=attempt/"native-bin"
    bindir.mkdir()
    for name,engine,key in (("mf6","mf6","mf6_executable"),("mf2005dbl","mf2005","mf2005_executable")):
        source=AUDIT.replace("PYTHON",runtime["paths"]["python_executable"],1).replace("ENGINE",repr(engine),1).replace("BINARY",repr(runtime["paths"][key]),1)
        path=bindir/name
        atomic_bytes(path,source.encode(),create_only=True)
        path.chmod(0o700)
    return bindir

def verify_executions(attempt,runtime):
    rows=[]
    for engine in ("mf6","mf2005"):
        files=sorted((attempt/"native-executions").glob(engine+"-*.json"))
        if len(files)!=1:
            raise Problem("native_execution","The original attempt must retain exactly one actual solver invocation.",engine=engine,count=len(files))
        row=read_json(files[0])
        expected=runtime["paths"]["mf6_executable" if engine=="mf6" else "mf2005_executable"]
        if row.get("binary")!=expected or row.get("returncode")!=0 or not row.get("normal_termination"):
            raise Problem("native_execution","The original native solver did not finish successfully.",engine=engine,observation=row)
        for channel in ("stdout","stderr"):
            verify_file(attempt/"native-executions"/row[channel]["path"],row[channel])
        row["binary_identity"]=verify_file(expected,runtime["identity"]["binaries"][engine])
        rows.append(row)
    return rows

def load_original(request,attempt):
    import git
    from groundwater_workspace.store import Workbench
    # The publisher's Git-root discovery must not relocate generated files.
    try:
        found=git.Repo(str(attempt),search_parent_directories=True)
    except git.InvalidGitRepositoryError:
        found=None
    if found is not None:
        raise Problem("publisher_working_directory","Run the original publisher outside a Git working tree so its workspace resolution stays in this retained attempt.")
    work=Workbench(request["workspace"],request["application"],existing_only=True)
    original=attempt/"originals"
    for row in request["source"]["files"]:
        raw=work.objects.bytes(row)
        atomic_bytes(original/row["path"],raw,create_only=True)
    return original

def install_original_launcher(bindir,attempt):
    """Pass only the owned descriptors through FloPy's actual Popen seam."""
    import flopy.mbase
    original=flopy.mbase.Popen
    allowed={str((Path(bindir)/name).resolve()) for name in ("mf6","mf2005dbl")}
    descriptors=tuple(int(value) for value in os.environ.get("GROUNDWATER_LOCK_FDS","").split(",") if value)
    if len(descriptors)!=2 or len(set(descriptors))!=2:
        raise Problem("native_ownership","Both original native ownership descriptors are required.")
    for fd in descriptors:
        os.fstat(fd)
    def owned_popen(argv,*args,**kwargs):
        command=argv[0] if isinstance(argv,(list,tuple)) and argv else None
        if command is not None and str(Path(command).resolve()) in allowed:
            if kwargs.get("shell") or kwargs.get("close_fds") is False:
                raise Problem("native_launch","The original audit command requires direct process execution with explicit descriptors.")
            existing=tuple(kwargs.get("pass_fds",()))
            if any(fd not in descriptors for fd in existing):
                raise Problem("native_ownership","An unexpected descriptor was selected by the original audit launch.")
            kwargs["pass_fds"]=descriptors
        return original(argv,*args,**kwargs)
    flopy.mbase.Popen=owned_popen
    write_json(attempt/"flopy-launch-binding.json",{"schema":"starforge.groundwater-flopy-launch.v1","module":file_info(Path(flopy.mbase.__file__)),"scope":"Only the two exact owned audit executable paths pass the original workspace/run locks; installed FloPy and publisher sources remain unchanged.","audit_commands":sorted(allowed)},create_only=True)
    return lambda: setattr(flopy.mbase,"Popen",original)

def models(request,attempt,original):
    import flopy
    profile=request["edition"]["profile"]
    if profile["adapter"]=="publisher_twri":
        builder=original/profile["builder_path"]
        verify_file(builder,{"sha256":profile["builder_sha256"],"bytes":builder.stat().st_size})
        if request["edition"]["kind"]=="baseline":
            os.environ.update({"WRITE":"True","RUN":"True","PLOT":"True","PLOT_SHOW":"False","PLOT_SAVE":"True"})
            namespace=runpy.run_path(str(builder),run_name="__main__")
            # Reopen exact generated native files; do not generate them again.
            sim=flopy.mf6.MFSimulation.load(sim_ws=attempt/"ex-gwf-twri01",verbosity_level=0,exe_name="mf6")
            mf=flopy.modflow.Modflow.load("ex-gwf-twri01.nam",model_ws=attempt/"ex-gwf-twri01"/"mf2005",exe_name="mf2005dbl",check=False,verbose=False)
            return sim,mf,True
        os.environ.update({"WRITE":"False","RUN":"False","PLOT":"False","PLOT_SHOW":"False","PLOT_SAVE":"True"})
        namespace=runpy.run_path(str(builder),run_name="groundwater_original_builder")
        values=request["edition"]["parameters"]
        namespace["recharge"]=float(values["recharge"])
        namespace["wel_spd"]={0:[[int(k),int(i),int(j),float(q)] for k,i,j,q in values["wells"]]}
        layer_map=dict(profile["layer_mapping"])
        namespace["wel_spd0"]={0:[[layer_map[int(k)],int(i),int(j),float(q)] for k,i,j,q in values["wells"]]}
        # runpy returns the functions' original globals dictionary on CPython.
        for function in ("build_models","build_mf5model"):
            namespace[function].__globals__.update({"recharge":namespace["recharge"],"wel_spd":namespace["wel_spd"],"wel_spd0":namespace["wel_spd0"]})
        sim=namespace["build_models"]()
        mf=namespace["build_mf5model"]()
        if values["legacy_units"]=={"length":"feet","time":"seconds"}:
            mf.dis.lenuni=1
            mf.dis.itmuni=1
        namespace["write_models"](sim,mf)
        namespace["run_models"](sim,mf)
        return sim,mf,False
    # Supplied native model packages are input data. Uploaded Python is not executed.
    root=attempt/"models"
    for row in request["source"]["files"]:
        atomic_bytes(root/row["path"],(original/row["path"]).read_bytes(),create_only=True)
    mf6_name=root/profile["mf6_namefile"]
    legacy_name=root/profile["legacy_namefile"]
    sim=flopy.mf6.MFSimulation.load(sim_ws=mf6_name.parent,sim_name=mf6_name.stem,verbosity_level=0,exe_name="mf6")
    mf=flopy.modflow.Modflow.load(legacy_name.name,model_ws=legacy_name.parent,exe_name="mf2005dbl",check=False,verbose=False)
    okay,_=sim.run_simulation(silent=True)
    if not okay:
        raise Problem("mf6_failed","The original MF6 model did not terminate normally.")
    okay,_=mf.run_model(silent=True)
    if not okay:
        raise Problem("mf2005_failed","The original legacy model did not terminate normally.")
    return sim,mf,False

STOP_REQUESTED = None

def request_stop(signum,frame):
    global STOP_REQUESTED
    if STOP_REQUESTED is None:
        STOP_REQUESTED=signum
        # This worker owns its new process group. Repeated signals drain the same children.
        os.killpg(os.getpgrp(),signum)

def run(request_file):
    from groundwater_workspace.store import Workbench
    request=read_json(request_file)
    attempt=Path(request["attempt_directory"]).resolve()
    os.chdir(attempt)
    work=Workbench(request["workspace"],request["application"],existing_only=True)
    old_environment=dict(os.environ)
    signal.signal(signal.SIGTERM,request_stop)
    signal.signal(signal.SIGINT,request_stop)
    run_id=request["run"]["id"]
    restore_launcher=None
    try:
        original=load_original(request,attempt)
        bindir=audit_executables(attempt,request["runtime"])
        restore_launcher=install_original_launcher(bindir,attempt)
        os.environ.update({"PATH":str(bindir)+os.pathsep+str(Path(request["runtime"]["paths"]["python_executable"]).parent)+os.pathsep+os.environ.get("PATH",""),"GROUNDWATER_ATTEMPT":str(attempt),"MPLBACKEND":"Agg","PYTHONDONTWRITEBYTECODE":"1"})
        if STOP_REQUESTED is not None:
            raise Problem("interrupted","Original native attempt was stopped before model execution.")
        sim,mf,publisher_completed=models(request,attempt,original)
        if STOP_REQUESTED is not None:
            raise Problem("interrupted","Original native attempt stopped; all owned solver children have drained.")
        native=verify_executions(attempt,request["runtime"])
        # Both model listings are new members of this create-only attempt.
        mf6_listing=Path(sim.sim_path)/"mfsim.lst"
        legacy_listing=Path(mf.model_ws)/mf.lst.file_name[0]
        termination=[]
        for engine,path in (("mf6",mf6_listing),("mf2005",legacy_listing)):
            value=path.read_text(encoding="utf-8",errors="replace")
            matched=("normal termination" in value.lower())
            # Legacy FloPy may consume the normal-termination line from stdout.
            # The audit records its real exit; require readable budget/head closure too.
            termination.append({"engine":engine,"listing":str(path.relative_to(attempt)),"normal_termination_text":matched,**file_info(path)})
        result=extract_outputs(sim,mf,attempt,request,publisher_completed)
        result["native_executions"]=native
        result["termination"]=termination
        result["derived_plots"]=plot_native(result,attempt/"analysis")
        result["completed_at"]=now()
        sys.stdout.flush();sys.stderr.flush()
        if (attempt/"worker.log").exists():
            atomic_bytes(attempt/"publisher-console.log",(attempt/"worker.log").read_bytes(),create_only=True)
        result["files"]=inventory(attempt,excluded=("worker.log","process.json","result.json","outcome.json"))
        write_json(attempt/"result.json",result,create_only=True)
        outcome={"state":"complete","run_id":run_id,"attempt":request["run"]["attempt"],"result":file_info(attempt/"result.json"),"finished":now()}
        write_json(attempt/"outcome.json",outcome,create_only=True)
        work.update_native(run_id,{"state":"complete","result_sha256":digest(result),"issue":None})
        print(json_text({"state":"complete","run_id":run_id,"result_sha256":digest(result)}),flush=True)
    except BaseException as exc:
        issue=exc.as_dict() if isinstance(exc,Problem) else {"code":type(exc).__name__,"message":str(exc)}
        outcome={"state":"interrupted" if STOP_REQUESTED else "failed","run_id":run_id,"attempt":request["run"]["attempt"],"issue":issue,"finished":now()}
        if not (attempt/"outcome.json").exists():
            write_json(attempt/"outcome.json",outcome,create_only=True)
        work.update_native(run_id,{"state":"interrupted" if STOP_REQUESTED else "failed","issue":issue})
        traceback.print_exc()
        return 1
    finally:
        if restore_launcher is not None:
            restore_launcher()
        os.environ.clear();os.environ.update(old_environment)
    return 0

if __name__=="__main__":
    sys.exit(run(sys.argv[1]))
