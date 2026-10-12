#!/usr/bin/env python3
"""Prepare one real private Tethys portal before receiving the original model backup."""
from __future__ import annotations
import argparse
import ast
import json
import os
from pathlib import Path
import re
import secrets
import stat
import sys
import time
import urllib.error
import urllib.request
import zipfile
from common import (Children, PortalRunError, digest, git_sha, info, inventory, owned_lock,
                    publish, publish_bytes, read, read_bytes, require, sync_dir, verify, verify_archive)

HERE=Path(__file__).resolve().parent
CAPSULE_SHA="e0ea40cad53386320062f30b6c2a480859058008"
BASE_KEYS=("operation_id","parent_operation_id","source_capsule","work_directory",
           "python_executable","node_executable","npm_executable","playwright_directory",
           "chromium_executable","port","operator_username","reader_username","slot")

def configuration(value):
    value=dict(value)
    require(set(value)=={"schema",*BASE_KEYS} and value["schema"]=="groundwater.tethys-preparation-input.v1",
            "Use the complete original portal preparation input.")
    for key in ("operation_id","parent_operation_id","operator_username","reader_username","slot"):
        require(isinstance(value[key],str) and re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_-]{0,63}",value[key]),
                key+" must be a safe nonempty identifier of at most 64 characters.")
    require(value["operator_username"]!=value["reader_username"],"Select two distinct ordinary local accounts.")
    require(type(value["port"]) is int and 1024<=value["port"]<=65535,"Select one explicit local unprivileged port.")
    for key in ("source_capsule","work_directory","python_executable","node_executable","npm_executable",
                "playwright_directory","chromium_executable"):
        require(isinstance(value[key],str) and Path(value[key]).is_absolute() and "\0" not in value[key],
                key+" must be an absolute path.")
        value[key]=str(Path(value[key]).resolve())
    for key in ("python_executable","node_executable","npm_executable"):
        require(Path(value[key]).is_file() and os.access(value[key],os.X_OK),"The selected executable is unavailable: "+key)
    # A missing original browser can stop preparation after installation; its input remains unchanged.
    # No browser is downloaded, another executable selected, or model run dispatched here.
    raw=read_bytes(value["source_capsule"],2097152)
    require(git_sha(raw)==CAPSULE_SHA,"Use the unchanged complete original application capsule.")
    capsule=read(value["source_capsule"],2097152)
    root=Path(value["work_directory"])
    require(not Path(value["source_capsule"]).is_relative_to(root),"Keep the original source capsule outside the new portal directory.")
    require(not HERE.is_relative_to(root) and not root.is_relative_to(HERE),"Keep the original caller outside its private portal directory.")
    return value,capsule

def from_receiving(value):
    return {"schema":"groundwater.tethys-preparation-input.v1",**{k:value[k] for k in BASE_KEYS}}

def environment_for(context):
    root=Path(context["work_directory"]);venv=root/"environment"
    temporary=root/"tmp";temporary.mkdir(parents=True,exist_ok=True,mode=0o700)
    environment=os.environ.copy();environment.pop("PYTHONPATH",None)
    environment.update({"TETHYS_HOME":context["portal_home"],"PYTHONNOUSERSITE":"1","PYTHONDONTWRITEBYTECODE":"1",
        "DJANGO_SETTINGS_MODULE":"tethys_portal.settings","PIP_DISABLE_PIP_VERSION_CHECK":"1",
        "PIP_CACHE_DIR":str(root/"package_cache"),"npm_config_cache":str(root/"npm_cache"),
        "TMPDIR":str(temporary),"TMP":str(temporary),"TEMP":str(temporary)})
    environment["PATH"]=str(venv/"bin")+os.pathsep+str(Path(context["node_executable"]).parent)+os.pathsep+str(Path(context["npm_executable"]).parent)+os.pathsep+environment.get("PATH","")
    return environment

def initialize(config,capsule):
    root=Path(config["work_directory"]);output=root/"output";output.mkdir(exist_ok=True,mode=0o700)
    source=root/"source";source.mkdir(exist_ok=True,mode=0o700)
    for row in capsule["manifest"]:
        raw=capsule["files"][row["path"]].encode("utf-8")
        require(git_sha(raw)==row["git_blob_sha"] and len(raw)==row["bytes"],"The original capsule contains a changed source.")
        publish_bytes(source/row["path"],raw)
    home=root/"portal_home";home.mkdir(exist_ok=True,mode=0o700)
    credentials_file=root/"credentials.json"
    if credentials_file.exists():
        credentials=read(credentials_file,65536)
    else:
        require(not (home/"portal.sqlite3").exists() and not (output/"database-phase.json").exists(),
                "The original portal credentials are missing; its account/database was not recreated.")
        credentials={"schema":"groundwater.tethys-local-credentials.v1","operation_id":config["operation_id"],
                     "portal_secret":secrets.token_urlsafe(60),"accounts":{}}
        for role,key in (("operator","operator_username"),("reader","reader_username")):
            name=config[key]
            credentials["accounts"][role]={"username":name,"password":secrets.token_urlsafe(36),
                "email":name+"@example.invalid","purpose":"Local publisher demonstration account"}
        publish(credentials_file,credentials)
    require(credentials["operation_id"]==config["operation_id"]
            and credentials["accounts"]["operator"]["username"]==config["operator_username"]
            and credentials["accounts"]["reader"]["username"]==config["reader_username"],
            "The original generated portal account identity changed.")
    context={**config,"portal_home":str(home),"output_directory":str(output),"credentials_file":str(credentials_file),
             "url_prefix":"groundwater-"+digest(config["operation_id"])[:12]}
    publish(root/"bootstrap-context.json",context)
    return context

def install(context,owned):
    root=Path(context["work_directory"]);output=Path(context["output_directory"])
    python=root/"environment"/"bin"/"python";tethys=python.with_name("tethys")
    source=root/"source";context_file=root/"bootstrap-context.json"
    stage=lambda name:[python,HERE/"provision.py","--context",context_file,"--phase",name]
    if not python.is_file():
        require(not (output/"upstream-phase.json").exists(),"The original installed portal runtime is missing; restore its exact prepared archive.")
        owned.run("python-environment",[context["python_executable"],"-m","venv","--copies",python.parent.parent],timeout=300)
    if not (output/"upstream-phase.json").exists():
        owned.run("portal-packages",[python,"-m","pip","install","tethys-platform==4.6.1","Django>=5.2,<5.3"],timeout=1800)
    owned.run("verify-upstream",stage("upstream"))
    generated=root/"generated-config";generated.mkdir(exist_ok=True,mode=0o700)
    if not (generated/"portal_config.yml").exists():
        owned.run("generate-original-configuration",[tethys,"gen","portal_config","-d",generated],timeout=60)
    owned.run("configure-private-portal",stage("configure"))
    if (output/"database-phase.json").exists():
        require((Path(context["portal_home"])/"portal.sqlite3").is_file(),"The original initialized database is missing; it was not replaced.")
    else:
        owned.run("original-portal-migrations",[tethys,"db","migrate"],timeout=300)
    owned.run("verify-original-database",stage("database"))
    if not (output/"installed-phase.json").exists():
        owned.run("install-original-core",[python,"-m","pip","install","--no-deps",source],timeout=300)
        owned.run("install-original-tethys-app",[tethys,"install","--without-dependencies","-q"],cwd=source/"tethys_app",timeout=300)
    owned.run("verify-original-installed-source",stage("installed"))
    if not (output/"static-phase.json").exists():
        owned.run("original-native-static-dependencies",[tethys,"gen","package_json","--overwrite"],timeout=1800)
    owned.run("verify-native-static-packages",stage("static"))
    static=read(output/"static-phase.json")
    owned.run("native-npm-closure",[context["npm_executable"],"ls","--omit=dev","--json"],cwd=static["directory"],timeout=120)
    owned.run("collect-original-static",[tethys,"manage","collectstatic"],timeout=300)
    owned.run("original-account-permissions",stage("accounts"))
    return read(output/"accounts.json")

def open_portal(context,owned,login):
    python=Path(context["work_directory"])/"environment"/"bin"/"python"
    child=owned.start("portal-server",[python,"-m","django","runserver","127.0.0.1:"+str(context["port"]),"--noreload"])
    url="http://127.0.0.1:"+str(context["port"])+login
    deadline=time.monotonic()+90
    while time.monotonic()<deadline and child.poll() is None and not owned.stopping:
        try:
            with urllib.request.urlopen(url,timeout=3) as response:
                if response.status==200:return child
        except (urllib.error.URLError,TimeoutError):pass
        time.sleep(.25)
    owned.close(child)
    raise PortalRunError("The actual original local Tethys server did not become ready; preserve its log.")

def prepared_archive(context,*,state="complete",failure=None):
    """A same-host, exact-path carrier of the actual installation and private portal."""
    root=Path(context["work_directory"]);output=root/"output"
    name="Groundwater_Tethys_Prepared_Portal.zip"
    if state!="complete":
        sequence=1
        while (output/("Groundwater_Tethys_Interrupted_Preparation_"+str(sequence)+".zip")).exists():sequence+=1
        name="Groundwater_Tethys_Interrupted_Preparation_"+str(sequence)+".zip"
    archive=output/name
    if archive.exists():
        descriptor={"path":str(archive),**info(archive)}
        manifest=verify_archive(archive,descriptor)
        require(manifest["input_sha256"]==digest({k:context[k] for k in ("schema",*BASE_KEYS)}),
                "The existing preparation archive belongs to another original input.")
        return descriptor,manifest
    selected=[];directories=[]
    def add_tree(source,prefix):
        source=Path(source)
        if not source.exists():return
        for current in sorted(source.rglob("*")):
            relative=current.relative_to(source).as_posix();member=prefix+"/"+relative
            if current.name.endswith(".lock") or current.name.endswith(".tmp") or "__pycache__" in current.parts:continue
            st=current.lstat();mode=stat.S_IMODE(st.st_mode)
            if stat.S_ISLNK(st.st_mode):
                target=os.readlink(current)
                require(current.resolve().is_relative_to(root),"A prepared-runtime link leaves the original private root: "+str(current))
                raw=target.encode("utf-8")
                selected.append((current,{"path":member,"kind":"symlink","target":target,"mode":mode,"bytes":len(raw),"sha256":digest(raw)}))
            elif stat.S_ISREG(st.st_mode):
                selected.append((current,{"path":member,"kind":"file","mode":mode,**info(current)}))
            elif stat.S_ISDIR(st.st_mode):
                directories.append({"path":member,"mode":mode})
            else:
                raise PortalRunError("A live special object remains in the stopped portal: "+str(current))
    for name in ("environment","portal_home","source","generated-config","logs"):
        add_tree(root/name,"work/"+name)
    # Preparation evidence is retained; optional screenshot files remain local inspection artifacts.
    for current in sorted(output.rglob("*")):
        if not current.is_file() or current.is_symlink():continue
        rel=current.relative_to(output).as_posix()
        retained_archives={"Groundwater_Tethys_Prepared_Portal.zip","Groundwater_Tethys_Complete_Private_Handover.zip"}
        if (rel.endswith(".zip") and rel not in retained_archives) or rel.endswith(".tmp") or "/screenshots/" in "/"+rel or (rel=="preparation-result.json" and state=="complete"):continue
        selected.append((current,{"path":"work/output/"+rel,"kind":"file","mode":0o600,**info(current)}))
    controls=("bootstrap-request.json","bootstrap-context.json","credentials.json","preparation-browser-input.json",
              "request.json","context.json","receiving-input.json","receiving-request.json",
              "browser-input.json","reopened-browser-input.json","incoming-original.sqlite")
    for name in controls:
        p=root/name
        if p.is_file():selected.append((p,{"path":"work/"+name,"kind":"file","mode":0o600,**info(p)}))
    # A stopped receiving failure retains its same original parent inputs and pending controls.
    for key,member in (("native_result","incoming/native-result.json"),("backup","incoming/original-workspace-backup.zip")):
        if key in context:
            record=context[key];p=Path(record["path"]);verify(p,record)
            selected.append((p,{"path":member,"kind":"file","mode":0o600,**info(p)}))
    for row in inventory(HERE):
        if "/screenshots/" in "/"+row["path"]:continue
        p=HERE/row["path"]
        selected.append((p,{"path":"driver/"+row["path"],"kind":"file","mode":stat.S_IMODE(p.stat().st_mode),**info(p)}))
    capsule=Path(context["source_capsule"])
    selected.append((capsule,{"path":"incoming/original-source-capsule.json","kind":"file","mode":0o600,**info(capsule)}))
    names=[r["path"] for _,r in selected]
    require(len(names)==len(set(names)),"The prepared portal selection has duplicate members.")
    manifest={"schema":"groundwater.tethys-prepared-portal.v1","state":state,
        "operation_id":context["operation_id"],"parent_operation_id":context["parent_operation_id"],
        "input_sha256":digest({k:context[k] for k in ("schema",*BASE_KEYS)}),
        "original_work_directory":str(root),"original_driver_directory":str(HERE),
        "original_source_capsule":context["source_capsule"],"source_capsule_git_sha":CAPSULE_SHA,
        "source_head":read(context["source_capsule"],2097152)["source_head"],
        "files":[r for _,r in selected],"directories":directories,
        "original_incoming_paths":{k:context[k]["path"] for k in ("native_result","backup") if k in context},
        "runtime_scope":"Exact paths on a compatible Linux host with the recorded original base Python/Node shared libraries; no cross-platform runtime claim.",
        "all_owned_services_closed":True,"native_model_runs_started":0,
        "contains_private_account_and_session_material":True,"failure":failure}
    temporary=archive.with_name("."+archive.name+".tmp")
    temporary.unlink(missing_ok=True)
    with zipfile.ZipFile(temporary,"w",compression=zipfile.ZIP_DEFLATED,compresslevel=6) as z:
        for p,row in selected:
            if row["kind"]=="file":
                verify(p,row);z.write(p,row["path"]);verify(p,row)
            else:
                require(os.readlink(p)==row["target"],"An original private runtime link changed.")
                zi=zipfile.ZipInfo(row["path"]);zi.create_system=3;zi.external_attr=(stat.S_IFLNK|row["mode"])<<16
                z.writestr(zi,row["target"].encode("utf-8"))
        z.writestr("manifest.json",json.dumps(manifest,ensure_ascii=False,sort_keys=True,separators=(",",":"))+"\n")
    with temporary.open("rb") as stream:os.fsync(stream.fileno())
    os.link(temporary,archive);temporary.unlink();sync_dir(output)
    descriptor={"path":str(archive),**info(archive)}
    verify_archive(archive,descriptor)
    return descriptor,manifest

def run(value):
    config,capsule=configuration(value);root=Path(config["work_directory"])
    if root.exists():
        require(root.is_dir() and not root.is_symlink(),"Use the exact original private portal directory.")
        if not (root/"bootstrap-request.json").exists():
            require(all(p.name=="portal.lock" or (p.name.startswith(".bootstrap-request.json.") and p.name.endswith(".tmp"))
                        for p in root.iterdir()),"The occupied directory has no original preparation request; it was not adopted.")
    root.mkdir(parents=True,exist_ok=True,mode=0o700)
    with owned_lock(root/"portal.lock") as lock:
        publish(root/"bootstrap-request.json",config)
        done=root/"output"/"preparation-result.json"
        if done.exists():
            result=read(done)
            require(result["input_sha256"]==digest(config),"The preparation result has another original request.")
            verify_archive(result["prepared_handover"]["path"],result["prepared_handover"])
            return result
        context=initialize(config,capsule)
        try:
            with Children(root/"logs",lock,environment_for(context)) as owned:
                accounts=install(context,owned)
                require(Path(config["chromium_executable"]).is_file() and os.access(config["chromium_executable"],os.X_OK),
                        "The selected complete Chromium executable is unavailable; retain the prepared installation for the same browser continuation.")
                browser_input={"schema":"groundwater.tethys-preparation-browser.v1","operation_id":config["operation_id"],
                    "base_url":"http://127.0.0.1:"+str(config["port"]),"login_path":accounts["portal"]["login"],
                    "home_path":accounts["portal"]["home"],"credentials_file":context["credentials_file"],
                    "accounts":accounts,"playwright_directory":config["playwright_directory"],
                    "chromium_executable":config["chromium_executable"],
                    "output_directory":str(root/"output"/"preparation-browser")}
                publish(root/"preparation-browser-input.json",browser_input)
                server=open_portal(context,owned,accounts["portal"]["login"])
                owned.run("original-ordinary-account-preparation",[config["node_executable"],HERE/"prepare_browser.mjs",root/"preparation-browser-input.json"],timeout=300)
                owned.close(server)
                owned.run("verify-prepared-account-and-model-absence",[Path(config["work_directory"])/"environment"/"bin"/"python",HERE/"provision.py","--context",root/"bootstrap-context.json","--phase","prepared"])
                require(not owned.children,"An original portal preparation child remains active.")
            browser=read(root/"output"/"preparation-browser"/"browser-result.json")
            # Native account and existing-only model absence readback after the actual server drains.
            from_state=read(root/"output"/"installed-phase.json")
            requirements={k:v for k,v in from_state["dependencies"].items()
                if k.lower().replace("_","-") not in ("starforge-groundwater-workspace","stellar-groundwater-tethys")}
            publish(root/"output"/"requirements-lock.json",from_state["dependencies"])
            publish_bytes(root/"output"/"requirements.txt",("\n".join(k+"=="+v for k,v in sorted(requirements.items()))+"\n").encode())
            archive,manifest=prepared_archive(context)
            result={"schema":"groundwater.tethys-preparation-result.v1","state":"complete","operation_id":config["operation_id"],
                "parent_operation_id":config["parent_operation_id"],"input_sha256":digest(config),
                "source_head":capsule["source_head"],"source_capsule_git_sha":CAPSULE_SHA,"tethys_version":"4.6.1",
                "accounts":accounts,"browser":browser,"prepared_handover":archive,
                "private_home":context["portal_home"],"model_workspace_initialized":False,
                "native_model_runs_started":0,"all_owned_services_closed":True}
            publish(done,result)
            print(json.dumps({"state":"complete","preparation_result":str(done),"prepared_handover":archive,"native_model_runs_started":0}),flush=True)
            return result
        except BaseException as error:
            # All owned children drained before this handler. Retain actual partial installation.
            failure={"type":type(error).__name__,"message":str(error)}
            publish(root/"output"/"preparation-failure.json",failure,replace=True)
            archive,_=prepared_archive(context,state="interrupted",failure=failure)
            print(json.dumps({"state":"interrupted","prepared_handover":archive,"failure":failure,"native_model_runs_started":0}),flush=True)
            raise

def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument("--input",required=True)
    args=parser.parse_args();previous=os.umask(0o077)
    try:run(read(Path(args.input).resolve(),2097152))
    finally:os.umask(previous)

if __name__=="__main__":main()
