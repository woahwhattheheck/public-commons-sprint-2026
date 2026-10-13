"""Operate the included original Jaffle Shop through the installed delivery workspace.

This is a resumable operator entry point. It uses the real Dagster/dbt runner and
an optional supplied browser continuation against the same original HTTP writer.
It does not replace a missing native outcome or silently repeat an unknown run.
"""
from __future__ import annotations
import argparse, base64, importlib.metadata, json, os, shutil, subprocess, sys
import threading, time, traceback, uuid, venv
from pathlib import Path

def parse_args():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--source-root", required=True)
    p.add_argument("--workspace", required=True)
    p.add_argument("--operation-root", required=True)
    p.add_argument("--private-root", required=True)
    p.add_argument("--browser-driver", required=True)
    p.add_argument("--node", required=True)
    p.add_argument("--playwright-module", required=True)
    p.add_argument("--chromium", required=True)
    p.add_argument("--continue-setup", action="store_true")
    p.add_argument("--installed", action="store_true", help=argparse.SUPPRESS)
    p.add_argument("--timeout", type=int, default=1800)
    return p.parse_args()

def sync_json(path, value, *, replace=False):
    raw = (json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2, allow_nan=False)+"\n").encode()
    path = Path(path); path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.parent / ("."+path.name+"."+str(uuid.uuid4())+".tmp")
    with tmp.open("xb") as f:
        os.chmod(tmp, 0o600); f.write(raw); f.flush(); os.fsync(f.fileno())
    try:
        if replace: os.replace(tmp, path)
        else:
            try: os.link(tmp, path)
            except FileExistsError:
                if path.read_bytes() != raw: raise RuntimeError("Retained operation bytes differ: "+str(path))
        fd=os.open(path.parent,os.O_RDONLY)
        try: os.fsync(fd)
        finally: os.close(fd)
    finally:
        try: tmp.unlink()
        except FileNotFoundError: pass

def load_json(path):
    return json.loads(Path(path).read_text("utf-8"))

def stage(root, name, value):
    row={"stage":name,"observed_at":time.strftime("%Y-%m-%dT%H:%M:%SZ",time.gmtime()),**value}
    sync_json(root/(name+".json"), row, replace=True)
    print(json.dumps(row,ensure_ascii=False,allow_nan=False),flush=True)
    return row

def bootstrap(args):
    source=Path(args.source_root).resolve(strict=True)
    root=Path(args.operation_root).resolve()
    private=Path(args.private_root).resolve()
    root.mkdir(parents=True,exist_ok=True); private.mkdir(parents=True,exist_ok=True)
    temporary=private/"temporary"; temporary.mkdir(exist_ok=True)
    for key in ("TMPDIR","TMP","TEMP"): os.environ[key]=str(temporary)
    os.environ["XDG_CACHE_HOME"]=str(private/"cache")
    requirement=source/"requirements.txt"
    runtime=private/"runtime"
    python=runtime/"bin"/"python"
    import hashlib
    binding={"requirements_sha256":hashlib.sha256(requirement.read_bytes()).hexdigest(),
             "requirements":requirement.read_text("utf-8"),"python":sys.version}
    marker=runtime/"native-requirements.json"
    if marker.exists():
        if load_json(marker)!=binding:
            raise RuntimeError("The selected original installation changed; retain it and select another runtime directory")
    else:
        venv.EnvBuilder(with_pip=True).create(runtime)
        with (root/"installation.log").open("ab",buffering=0) as log:
            child=subprocess.run([str(python),"-m","pip","install","--no-cache-dir","--disable-pip-version-check",
                                  "-r",str(requirement)],stdout=log,stderr=subprocess.STDOUT,timeout=args.timeout)
        if child.returncode:
            stage(root,"installation",{"state":"failed","exit_code":child.returncode,
                                      "log":str(root/"installation.log")})
            return child.returncode
        sync_json(marker,binding)
    stage(root,"installation",{"state":"ready","python":str(python),
                              "dbt":str(runtime/"bin"/"dbt"),"requirements_sha256":binding["requirements_sha256"]})
    os.execv(str(python),[str(python),"-B",str(Path(__file__).resolve()),*sys.argv[1:],"--installed"])

def operate(args):
    source=Path(args.source_root).resolve(strict=True)
    root=Path(args.operation_root).resolve(); root.mkdir(parents=True,exist_ok=True)
    private=Path(args.private_root).resolve(strict=True)
    sys.path.insert(0,str(source))
    from common import Problem, sha, utc
    from workspace import Workspace
    from cli import source_entries
    from receiving import create_backup, inspect_archive, inspect_received
    from server import Staff, Server
    original=Path(args.workspace).resolve()
    identity=root/"operation.json"
    spec={"schema":"pipeline-delivery.original-example-operation/v1","workspace":str(original),
          "source_root":str(source),"project_source":str(source/"examples"/"jaffle_shop"),
          "requirement_sha256":sha((source/"requirements.txt").read_bytes())}
    if identity.exists():
        if load_json(identity)!=spec: raise RuntimeError("This operation already names another original workspace/source")
    else: sync_json(identity,spec)
    ws=None; app=None; http=None; thread=None
    browser_result=root/"browser-result.json"
    try:
        ws=Workspace(original,source_root=source)
        def mutate(key,action,payload):
            request=root/"requests"/(key+".json")
            if request.exists(): envelope=load_json(request)
            else:
                meta=ws.meta()
                envelope={"action":action,"payload":payload,"workspace_id":meta["workspace_id"],
                          "expected_revision":meta["revision"],"request_id":str(uuid.uuid4())}
                sync_json(request,envelope)
            if envelope["action"]!=action or envelope["payload"]!=payload:
                raise RuntimeError("The original operator request differs: "+key)
            answer=ws.invoke(**envelope)
            sync_json(root/"responses"/(key+".json"),answer,replace=True)
            return answer["result"]
        project=mutate("project","project.create",{
            "label":"Original Jaffle Shop delivery",
            "description":"Unchanged dbt Labs public example, operated with the real installed Dagster/dbt stack."})
        project_id=project["id"]
        files,omitted=source_entries(source/"examples"/"jaffle_shop")
        if omitted: raise RuntimeError("The original included example unexpectedly contains omitted source: "+repr(omitted))
        edition=mutate("source","edition.save",{"project_id":project_id,"base_edition_id":None,
            "label":"Original dbt Labs source","source_notes":"Unchanged original public example; see examples/SOURCE.json and LICENSE.",
            "files":files,"delete_paths":[]})
        contract=mutate("contract","contract.save",{"project_id":project_id,"contract":{
            "label":"Original model and data-check build","owner":"TJLabs operator",
            "purpose":"Execute the included original Jaffle Shop SQL/YAML/seeds through native dbt and preserve its actual result.",
            "command":"build","select":"","exclude":"","vars":{},"threads":1,
            "full_refresh":False,"fail_fast":False,"install_dependencies":False,
            "generate_catalog":True,"expectations":[],
            "notes":"Original SQL/YAML data checks and dbt results remain authoritative; no customer data is used."}})
        binding=mutate("binding","binding.save",{"project_id":project_id,"binding":{
            "label":"Original installed local Dagster/dbt with DuckDB","mode":"managed_duckdb",
            "python_executable":sys.executable,"dbt_executable":str(Path(sys.executable).parent/"dbt"),"target":"local"}})
        run=mutate("native","run.execute",{"project_id":project_id,"edition_id":edition["id"],
                                        "contract_id":contract["id"],"binding_id":binding["id"]})
        stage(root,"native-admission",{"workspace_id":ws.meta()["workspace_id"],"project_id":project_id,
                                     "run_id":run["id"],"dagster_run_id":run["dagster_run_id"]})
        if args.continue_setup:
            current=ws.invoke("run.get",{"id":run["id"]})["result"]
            if current.get("can_start") and current["state"] in {"prepared","setup_failed"}:
                key="native-setup-"+str(uuid.uuid4())
                run=mutate(key,"run.start",{"id":run["id"]})
        deadline=time.monotonic()+args.timeout
        while True:
            current=ws.runtime().reconcile(run["id"])
            if current["state"] in {"succeeded","failed","cancelled","setup_failed","interrupted"}: break
            if time.monotonic()>deadline:
                stage(root,"native-observation",{"state":"still_active","run_id":run["id"],
                    "dagster_run_id":run["dagster_run_id"],"operation":current})
                return 3
            time.sleep(1.0)
        sync_json(root/"native-outcome.json",current,replace=True)
        stage(root,"native-completion",{"state":current["state"],"run_id":run["id"],
              "dagster_run_id":run["dagster_run_id"],"outcome_sha256":current.get("outcome_sha256"),
              "workspace_id":ws.meta()["workspace_id"],"revision":ws.meta()["revision"]})
        if current["state"]!="succeeded": return 2
        ws.close();ws=None
        app=Staff(original,control=root/"staff",source_root=source)
        port=0
        ready=root/"staff-ready.json"
        if ready.exists():
            from urllib.parse import urlsplit
            prior=load_json(ready); address=urlsplit(prior["origin"])
            if (prior.get("project_id")!=project_id or prior.get("run_id")!=run["id"] or
                    address.scheme!="http" or address.hostname!="127.0.0.1" or not address.port):
                raise RuntimeError("The retained original staff address belongs to another operation")
            port=address.port
        http=Server(("127.0.0.1",port),app)
        thread=threading.Thread(target=http.serve_forever,name="original-staff",daemon=True);thread.start()
        browser_input={"schema":"pipeline-delivery.original-example-browser/v1",
            "url":http.origin+"/#capability="+app.capability,"origin":http.origin,
            "workspace_id":app.ws.meta()["workspace_id"],
            "project_id":project_id,"run_id":run["id"],"dagster_run_id":run["dagster_run_id"],
            "source_root":str(source),"example_root":str(source/"examples"/"jaffle_shop"),
            "output":str(root),"temporary_root":str(private/"browser"),
            "result_path":str(browser_result),"workflow":str(Path(args.browser_driver).parent/"browser-workflow.mjs"),
            "playwright_module":args.playwright_module,
            "chromium":args.chromium}
        session=root/"browser-input.json"
        sync_json(session,browser_input,replace=True)
        stage(root,"staff-ready",{"origin":http.origin,"project_id":project_id,"run_id":run["id"],
                                 "browser_input":str(session)})
        with (root/"browser.log").open("ab",buffering=0) as log:
            child=subprocess.run([args.node,args.browser_driver,str(session)],stdout=log,stderr=subprocess.STDOUT,timeout=args.timeout)
        if child.returncode:
            stage(root,"browser-completion",{"state":"failed","exit_code":child.returncode,
                                            "log":str(root/"browser.log")})
            return child.returncode
        browser=load_json(browser_result)
        if browser.get("state")!="completed" or browser.get("project_id")!=project_id or browser.get("run_id")!=run["id"]:
            raise RuntimeError("The original browser result does not match this project and native run")
        # Current selected writer may be the actual received copy. Export the
        # complete current state through that same staff writer, not a new reader.
        backup=app.archive(None,str(uuid.uuid4()))
        inspected=inspect_archive(backup["path"])
        if inspected["archive_sha256"]!=backup["sha256"]:
            raise RuntimeError("The completed native archive changed before delivery")
        stage(root,"complete",{"state":"completed","project_id":project_id,"run_id":run["id"],
                              "dagster_run_id":run["dagster_run_id"],"browser":browser,
                              "archive":backup,"finished_at":utc()})
        return 0
    except Exception as exc:
        try: stage(root,"operator-failure",{"state":"interrupted","error_type":type(exc).__name__,
                                          "message":str(exc),"traceback":traceback.format_exc()})
        except Exception: traceback.print_exc()
        return 2
    finally:
        if http:
            http.shutdown();http.server_close()
        if thread: thread.join(timeout=10)
        if app: app.close()
        if ws: ws.close()

if __name__=="__main__":
    args=parse_args()
    if args.timeout<1 or args.timeout>86400: raise SystemExit("Choose a finite original operation timeout")
    raise SystemExit(operate(args) if args.installed else bootstrap(args))
