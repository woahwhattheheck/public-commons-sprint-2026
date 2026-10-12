#!/usr/bin/env python3
"""Provision one real local Tethys portal and receive one completed original study."""
from __future__ import annotations
import argparse
import ast
import hashlib
import json
import os
from pathlib import Path
import secrets
import shutil
import sqlite3
import sys
import time
import urllib.error
import urllib.request
import zipfile

sys.dont_write_bytecode=True
from common import (Children, PortalRunError, digest, git_sha, info, inventory, owned_lock,
                    publish, publish_bytes, read, require, sync_dir, verify, verify_archive)

HERE=Path(__file__).resolve().parent
CAPSULE_SHA="715b64b00e14355a2492b6dc13d701136c2ea684"

def absolute(value,label):
    require(isinstance(value,str) and Path(value).is_absolute() and "\0" not in value,label+" must be an absolute path.")
    return str(Path(value).resolve())

def input_value(path):
    value=json.loads(json.dumps(path)) if isinstance(path,dict) else read(path,2097152)
    keys={"schema","operation_id","parent_operation_id","native_result","backup","source_capsule","work_directory",
          "python_executable","node_executable","npm_executable","playwright_directory","chromium_executable",
          "port","operator_username","reader_username","slot"}
    require(set(value)==keys and value["schema"]=="groundwater.tethys-native-input.v1","Use the complete original portal input schema.")
    import re
    for key in ("operation_id","parent_operation_id","operator_username","reader_username","slot"):
        require(isinstance(value[key],str) and re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_-]{0,63}",value[key]),
                key+" must be a safe nonempty identifier of at most 64 characters.")
    require(value["operator_username"]!=value["reader_username"],"The ordinary operator and isolation reader must be distinct accounts.")
    require(type(value["port"]) is int and 1024<=value["port"]<=65535,"Use an explicit local unprivileged portal port.")
    for key in ("source_capsule","work_directory","python_executable","node_executable","npm_executable","playwright_directory","chromium_executable"):
        value[key]=absolute(value[key],key)
    for key in ("native_result","backup"):
        record=value[key]
        require(set(record)=={"path","bytes","sha256"} and type(record["bytes"]) is int and record["bytes"]>0
                and isinstance(record["sha256"],str) and re.fullmatch("[0-9a-f]{64}",record["sha256"]),"Supply exact original "+key+" path/bytes/SHA256.")
        record["path"]=absolute(record["path"],key)
        verify(record["path"],record)
    native=read(value["native_result"]["path"])
    require(native.get("state")=="complete" and native.get("operation_id")==value["parent_operation_id"]
            and native.get("all_owned_services_closed") is True,"The original publisher operation must actually complete and release its services first.")
    require({k:native["backup"][k] for k in ("bytes","sha256")}=={k:value["backup"][k] for k in ("bytes","sha256")},
            "The supplied backup is not the exact completed original backup.")
    raw=Path(value["source_capsule"]).read_bytes()
    require(git_sha(raw)==CAPSULE_SHA,"Use the unchanged complete original source capsule.")
    capsule=json.loads(raw)
    require(capsule["source_head"]==native["source_head"],"The native run selected another original application source.")
    for key in ("python_executable","node_executable","npm_executable","chromium_executable"):
        require(Path(value[key]).is_file() and os.access(value[key],os.X_OK),"The selected installed executable is unavailable: "+key)
    root=Path(value["work_directory"])
    for key in ("source_capsule","native_result","backup"):
        selected=value[key]["path"] if isinstance(value[key],dict) else value[key]
        require(not Path(selected).is_relative_to(root),"Keep original incoming inputs outside the new portal work directory.")
    require(not HERE.is_relative_to(root) and not root.is_relative_to(HERE),"Keep the original driver source outside its private work directory.")
    return value,capsule

def verify_bundle(path, expected):
    return verify_archive(path,expected)

def bundle(context, native, browser, final):
    """Capture the stopped private portal, complete source and all actual evidence."""
    root=Path(context["work_directory"]);output=Path(context["output_directory"])
    archive=output/"Groundwater_Tethys_Complete_Private_Handover.zip"
    manifest_file=output/"portal-package-manifest.json"
    if archive.exists():
        descriptor={"path":str(archive),**info(archive)}
        manifest=verify_bundle(archive,descriptor)
        require(manifest["operation_id"]==context["operation_id"] and manifest["context_sha256"]==digest(context),"The existing portal package belongs to another original input.")
        return descriptor,manifest
    selected=[]
    def add_tree(source,prefix):
        for row in inventory(source):
            if "/screenshots/" not in "/"+row["path"]:
                selected.append((Path(source)/row["path"],{"path":prefix+"/"+row["path"],**{k:row[k] for k in ("bytes","sha256")}}))
    add_tree(context["portal_home"],"portal_home")
    capsule=read(context["source_capsule"],2097152)
    for original in capsule["manifest"]:
        member=root/"source"/original["path"]
        require(git_sha(member.read_bytes())==original["git_blob_sha"],"The installed build source changed.")
        selected.append((member,{"path":"application/"+original["path"],**info(member)}))
    add_tree(HERE,"portal_native")
    add_tree(output,"evidence")
    add_tree(root/"logs","logs")
    for source,name in [
        (root/"request.json","control/request.json"),(root/"context.json","control/context.json"),
        (root/"credentials.json","private/credentials.json"),(root/"receiving-input.json","control/receiving-input.json"),
        (root/"browser-input.json","control/browser-input.json"),
        (root/"reopened-browser-input.json","control/reopened-browser-input.json"),
        (Path(context["native_result"]["path"]),"incoming/native-result.json"),
        (Path(context["backup"]["path"]),"incoming/original-workspace-backup.zip"),
        (Path(context["source_capsule"]),"incoming/original-source-capsule.json"),
    ]:
        selected.append((source,{"path":name,**info(source)}))
    # Runtime packages can be reinstalled from the frozen actual dependency lock.
    # Their native platform-specific environment is not represented as portable.
    names=[r["path"] for _,r in selected]
    require(len(names)==len(set(names)),"The portal handover selection has duplicate members.")
    manifest={"schema":"groundwater.tethys-private-handover.v1","operation_id":context["operation_id"],
              "parent_operation_id":context["parent_operation_id"],"context_sha256":digest(context),"workspace_id":native["workspace_id"],
              "source_head":native["source_head"],"files":[r for _,r in selected],
              "ordinary_accounts":browser["accounts"],"native_runs_started":0,
              "portal_state":"stopped","contains_private_account_and_session_material":True,
              "runtime":"Reinstall the exact recorded Tethys/Python package versions; no portable binary runtime is claimed.",
              "customer_or_production_tenant_acceptance":False}
    temp=archive.with_name("."+archive.name+".tmp")
    if temp.exists(): temp.unlink()
    with zipfile.ZipFile(temp,"w",compression=zipfile.ZIP_DEFLATED,compresslevel=6) as z:
        for source,row in selected:
            verify(source,row);z.write(source,row["path"]);verify(source,row)
        z.writestr("manifest.json",json.dumps(manifest,ensure_ascii=False,sort_keys=True,separators=(",",":"))+"\n")
    with temp.open("rb") as stream: os.fsync(stream.fileno())
    os.link(temp,archive);temp.unlink();sync_dir(output)
    descriptor={"path":str(archive),**info(archive)}
    verify_bundle(archive,descriptor);publish(manifest_file,manifest)
    return descriptor,manifest

def run(input_path):
    config,capsule=input_value(input_path)
    from prepare_portal import run as prepare_original, from_receiving, environment_for
    preparation=prepare_original(from_receiving(config))
    root=Path(config["work_directory"])
    with owned_lock(root/"portal.lock") as lock:
        publish(root/"request.json",config)
        output=root/"output";done=output/"portal-result.json"
        if done.exists():
            result=read(done)
            require(result["input_sha256"]==digest(config),"The completed portal result belongs to another exact input.")
            verify_bundle(result["private_handover"]["path"],result["private_handover"])
            for member in result["result_files"]:verify(output/member["path"],member)
            print(json.dumps({"state":"complete","replayed":True,"result_file":str(done),"historical_completion":True}),flush=True)
            return result
        context={**read(root/"bootstrap-context.json"),**config}
        context_file=root/"context.json";publish(context_file,context)
        environment=environment_for(context)
        credentials_file=root/"credentials.json";home=root/"portal_home"
        python=root/"environment"/"bin"/"python"
        stage=lambda name:[python,HERE/"provision.py","--context",context_file,"--phase",name]
        server=None
        with Children(root/"logs",lock,environment) as owned:
            owned.run("verify-original-installed-source",stage("installed"))
            owned.run("verify-original-database",stage("database"))
            owned.run("original-account-permissions",stage("accounts"))
            accounts=read(output/"accounts.json")
            installed_state=read(output/"installed-phase.json")
            owned.run("original-private-receiving",stage("receive"),timeout=600)
            receiving=read(output/"receiving-readback.json")
            selection=read(root/"receiving-input.json")["expected"]
            original=receiving["original_result"]
            browser_input={"schema":"groundwater.tethys-browser-input.v1","operation_id":config["operation_id"],
                "base_url":"http://127.0.0.1:"+str(config["port"]),"portal_path":receiving["portal_path"],
                "login_path":accounts["portal"]["login"],"home_path":accounts["portal"]["home"],
                "credentials_file":str(credentials_file),"expected":selection,
                "report_formats":original["verified"]["reports"][0]["formats"],
                "accounts":{"operator":accounts["operator"],"reader":accounts["reader"]},
                "playwright_directory":config["playwright_directory"],"chromium_executable":config["chromium_executable"],
                "output_directory":str(output/"browser")}
            publish(root/"browser-input.json",browser_input)
            def open_portal():
                # Direct native Django entry keeps this process's inherited original lock.
                child=owned.start("portal-server",[python,"-m","django","runserver","127.0.0.1:"+str(config["port"]),"--noreload"])
                deadline=time.monotonic()+90
                url=browser_input["base_url"]+accounts["portal"]["login"]
                while time.monotonic()<deadline and child.poll() is None and not owned.stopping:
                    try:
                        with urllib.request.urlopen(url,timeout=3) as response:
                            if response.status==200: return child
                    except (urllib.error.URLError,TimeoutError): pass
                    time.sleep(.25)
                owned.close(child)
                raise PortalRunError("The actual selected Tethys server did not become ready; retain its original log.")
            server=open_portal()
            owned.run("ordinary-account-browser",[config["node_executable"],HERE/"browser.mjs",root/"browser-input.json"],timeout=600)
            owned.close(server);server=None
            # Reopen the very same private portal/account/database after its first server drains.
            browser=read(output/"browser"/"browser-result.json")
            reopen={**browser_input,"reopen_only":True,"original_browser_result":{"path":str(output/"browser"/"browser-result.json"),**info(output/"browser"/"browser-result.json")},
                    "output_directory":str(output/"reopened-browser")}
            publish(root/"reopened-browser-input.json",reopen)
            server=open_portal()
            owned.run("same-portal-reopen-browser",[config["node_executable"],HERE/"browser.mjs",root/"reopened-browser-input.json"],timeout=600)
            owned.close(server);server=None
            owned.run("complete-original-data-readback",stage("final"),timeout=600)
            final=read(output/"final-readback.json")
            require(not owned.children,"An original owned portal child remains active.")
        native=read(config["native_result"]["path"])
        # Every executable source and original input is retained separately from the private data.
        publish(output/"requirements-lock.json",installed_state["dependencies"])
        requirements="\n".join(name+"=="+version for name,version in sorted(installed_state["dependencies"].items())
            if name.lower().replace("_","-") not in ("starforge-groundwater-workspace","stellar-groundwater-tethys"))+"\n"
        publish_bytes(output/"requirements.txt",requirements.encode())
        source_rows=[{"path":row["path"],"git_blob_sha":row["git_blob_sha"],"bytes":row["bytes"]} for row in capsule["manifest"]]
        publish(output/"original-application-manifest.json",source_rows)
        archive,manifest=bundle(context,native,browser,final)
        result={"schema":"groundwater.tethys-native-result.v1","state":"complete","operation_id":config["operation_id"],
                "parent_operation_id":config["parent_operation_id"],"input_sha256":digest(config),
                "source_head":native["source_head"],"workspace_id":native["workspace_id"],
                "portal":{"version":"4.6.1","database":"SQLite","url":browser_input["base_url"]+receiving["portal_path"],
                          "accounts":browser["accounts"],"private_user_workspace":True,"stopped":True},
                "original_receiving":receiving,"browser":browser,
                "reopened_browser":read(output/"reopened-browser"/"browser-result.json"),"final_readback":final,
                "private_handover":archive,"files":len(manifest["files"]),
                "native_runs_started":0,"all_owned_services_closed":True,
                "local_technical_receiving":True,"customer_or_production_tenant_acceptance":False,
                "result_files":[x for x in inventory(output,excluded=("portal-result.json",archive["path"].split("/")[-1])) if "/screenshots/" not in "/"+x["path"]]}
        publish(done,result)
        print(json.dumps({"state":"complete","result_file":str(done),"private_handover":archive,
                          "native_runs_started":0,"all_owned_services_closed":True}),flush=True)
        return result

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input",required=True,help="Exact completed-study / original-backup / local portal input.")
    args=parser.parse_args()
    previous=os.umask(0o077)
    try:
        run(Path(args.input).resolve())
    finally:
        os.umask(previous)

if __name__=="__main__":
    main()
