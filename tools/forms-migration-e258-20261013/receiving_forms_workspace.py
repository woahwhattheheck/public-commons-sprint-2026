"""Operate the complete original Forms authoring, native edition and cold handover course."""
from __future__ import annotations
import sys
sys.dont_write_bytecode = True
import argparse
import csv
import fcntl
import hashlib
import json
import os
from pathlib import Path
import subprocess
import time
import uuid
import urllib.request
import zipfile
import stat
import signal
import re
from discovery_engine import DiscoveryError, require, json_bytes, read_json, file_digest
from forms_workspace import Workspace, source_files, immutable, measured, receive_workspace
from forms_installation import inspect_workspace, source_bytes
from receiving_forms import materialize_examples, capture_edition, semantic_checks, run as native_command

HERE=Path(__file__).resolve().parent
OPERATION="FORMS-AUTHORING-WORKSPACE-RECEIVING-E258-20261013"

def save(path,value):
    immutable(path,json_bytes(value))

def current(workspace,method,params=None):
    return workspace.dispatch(method,params or {})["value"]

def command(workspace,method,params,rid):
    return workspace.dispatch(method,params,rid)

def selected_intake(root,edition,worksheet):
    original=read_json(root/"examples"/edition/"intake.json")
    original["assets"]=worksheet["assets"]
    selected={a["id"]:a for a in original["assets"]}
    for table in original["discovery_manifest"]["tables"]:
        asset=selected[original["table_assets"][table["id"]]]
        table["path"]=asset["path"];table["sha256"]=asset["sha256"]
    return original

def complete_csv(workspace,capture,asset,table,expected_path):
    seen=[];offset=0
    while True:
        page=current(workspace,"capture.csv",{"capture_id":capture["id"],"asset_id":asset["id"],
                    "encoding":table.get("encoding","utf-8-sig"),"delimiter":table.get("delimiter",","),
                    "quotechar":table.get("quotechar",'"'),"offset":offset,"limit":7})
        seen.extend(page["rows"]);offset+=len(page["rows"])
        if offset>=page["total"]:break
        require(page["rows"],"Original CSV inspection ended before its complete population")
    with Path(expected_path).open(encoding=table.get("encoding","utf-8-sig"),newline="") as stream:
        reader=csv.reader(stream,delimiter=table.get("delimiter",","),quotechar=table.get("quotechar",'"'),strict=True)
        header=next(reader);rows=list(reader)
    require(page["headers"]==header and len(seen)==len(rows),"Complete original CSV population differs")
    require(all(row["record"]==index+1 and row["values"]==rows[index] for index,row in enumerate(seen)),
            "Raw original values or one-based parent ordinals changed")
    return {"asset_id":asset["id"],"rows":len(seen),"headers":header}

def http(receipt,method,params=None,request_id=None):
    data={"method":method,"params":params or {}}
    if request_id is not None:data["request_id"]=request_id
    request=urllib.request.Request(receipt["origin"]+"api/rpc",data=json_bytes(data),
                                   headers={"Content-Type":"application/json"},method="POST")
    with urllib.request.urlopen(request,timeout=120) as response:
        require(response.status==200,"Actual retained workspace HTTP request failed")
        return json.loads(response.read())

def process_identity(pid):
    """Observe the exact original Linux process; PID reuse never grants ownership."""
    require(type(pid) is int and pid>0,"Original server PID is invalid")
    try:
        text=Path("/proc/"+str(pid)+"/stat").read_text()
        fields=text.rsplit(")",1)[1].split()
        if fields[0]=="Z":return None
        argv=Path("/proc/"+str(pid)+"/cmdline").read_bytes().split(b"\0")
        return {"boot_id":Path("/proc/sys/kernel/random/boot_id").read_text().strip(),
                "start":fields[19],"argv":[x.decode("utf-8") for x in argv if x]}
    except FileNotFoundError:return None

class OriginalServer:
    """An original retained listener, with start/argv identity checked before signals."""
    def __init__(self,pid,identity):
        self.pid=pid;self.identity=identity
    def poll(self):
        return None if process_identity(self.pid)==self.identity else 0
    def terminate(self):
        if self.poll() is None:os.kill(self.pid,signal.SIGTERM)
    def kill(self):
        if self.poll() is None:os.kill(self.pid,signal.SIGKILL)
    def wait(self,timeout=None):
        until=time.monotonic()+(timeout if timeout is not None else 60)
        while self.poll() is None:
            if time.monotonic()>=until:raise subprocess.TimeoutExpired(self.identity["argv"],timeout)
            time.sleep(.05)
        return 0

def server_receipt(root,opening,receipt,identity=None):
    value=read_json(receipt)
    require(value["schema"]=="tjlabs.forms-workspace.server.v1" and
            value["workspace_id"]==opening["workspace_id"] and
            value["workspace"]==opening["workspace"] and value["source_files"]==opening["source_files"],
            "Original workspace server receipt/source binding differs")
    require(re.fullmatch(r"http://127\.0\.0\.1:[0-9]+/[A-Za-z0-9_-]+/",value["origin"]) is not None,
            "Original server must retain its private loopback origin")
    observed=process_identity(value["pid"])
    if identity is not None:
        if observed is not None and observed!=identity:return None
    if observed is None:return None
    require(observed["argv"]==opening["argv"],"Original server process command differs")
    result=http(value,"workspace.describe")
    require(result["workspace_id"]==opening["workspace_id"] and
            result["value"]["workspace_id"]==opening["workspace_id"] and
            result["value"]["source_files"]==opening["source_files"] and
            result["value"]["revision"]==opening["workspace_revision"],
            "Original listener's workspace/source/revision differs from the retained native stage")
    return value,observed

def original_processes(opening):
    """Find the exact owned command/unique receipt path in this same host."""
    require(opening["host"]=={"hostname":os.uname().nodename,
            "boot_id":Path("/proc/sys/kernel/random/boot_id").read_text().strip()},
            "Original server opening belongs to another host boot")
    matches=[]
    for entry in Path("/proc").iterdir():
        if not entry.name.isdigit():continue
        try:
            if entry.stat().st_uid!=os.getuid():continue
            observed=process_identity(int(entry.name))
        except FileNotFoundError:continue
        if observed is not None and observed["argv"]==opening["argv"]:
            matches.append((int(entry.name),observed))
    require(len(matches)<=1,"Multiple live processes match the same original server argv/receipt; preserve them and resolve that ambiguity before any listener launch")
    return matches

def reconciled_spawn(root,opening_path,opening,spawned_path,receipt):
    # Popen may have admitted the original child before the producing process
    # disappeared. Its unique receipt path is an exact command-line selection.
    for attempt in range(3):
        matches=original_processes(opening)
        if matches:
            pid,identity=matches[0]
            spawned={"pid":pid,"process_identity":identity,"opening":opening}
            save(spawned_path,spawned)
            return spawned
        if receipt.exists():return None
        if attempt<2:time.sleep(.1)
    if receipt.exists():return None
    closed=opening_path.with_name(opening_path.name.replace(".opening.json",".closed.json"))
    if closed.exists():
        record=read_json(closed)
        require(record["opening"]==opening and record["status"]=="NO_LIVE_ORIGINAL_PROCESS",
                "Original closed server admission record differs")
    else:
        save(closed,{"opening":opening,"status":"NO_LIVE_ORIGINAL_PROCESS",
                     "matched_processes":[],"observed_at_unix_ns":time.time_ns(),
                     "meaning":"No live same-user process with the exact original argv and unique receipt path was present in the retained same-host scans."})
    return None

def start_server(root,workspace,result):
    """Reuse an exact surviving listener before considering another original attempt."""
    selected={"operation":OPERATION,"workspace":str(workspace),"workspace_id":result["workspace_id"],
              "workspace_revision":result["workspace_archive"]["workspace_revision"],
              "source_files":result["source"],"native_stage":measured(root/"native-before-http.json"),
              "host":{"hostname":os.uname().nodename,
                      "boot_id":Path("/proc/sys/kernel/random/boot_id").read_text().strip()}}
    for opening_path in sorted(root.glob("server-*.opening.json")):
        opening=read_json(opening_path)
        require(all(opening.get(k)==v for k,v in selected.items()),
                "Original server opening belongs to a different retained native stage")
        receipt=root/opening["receipt_name"]
        require(receipt.parent==root and receipt.name==opening_path.name.replace(".opening.json",".json"),
                "Original server receipt path differs")
        spawned_path=opening_path.with_name(opening_path.name.replace(".opening.json",".spawned.json"))
        lease_path=opening_path.with_name(opening_path.name.replace(".opening.json",".lease.json"))
        spawned=read_json(spawned_path) if spawned_path.exists() else None
        if spawned:require(spawned["opening"]==opening,"Original server spawn selection differs")
        if not receipt.exists() and spawned is None:
            spawned=reconciled_spawn(root,opening_path,opening,spawned_path,receipt)
            if spawned is None and not receipt.exists():continue
        if not receipt.exists():
            live=process_identity(spawned["pid"])
            if live is None or live!=spawned["process_identity"]:continue
            until=time.monotonic()+120
            while not receipt.exists() and process_identity(spawned["pid"])==live and time.monotonic()<until:
                time.sleep(.05)
            if not receipt.exists() and process_identity(spawned["pid"])!=live:continue
            require(receipt.exists(),
                    "Original server process is still owned but its receipt is unavailable; no replacement listener was launched")
        lease=read_json(lease_path) if lease_path.exists() else None
        if lease:
            require(lease["opening"]==opening and read_json(receipt)["pid"]==lease["pid"] and measured(receipt)==lease["receipt_identity"],
                    "Original server lease or receipt changed")
        got=server_receipt(root,opening,receipt,
                           lease["process_identity"] if lease else (spawned["process_identity"] if spawned else None))
        if got is None:continue
        value,identity=got
        if spawned:require(value["pid"]==spawned["pid"],"Original server receipt PID differs from its launch")
        lease={"opening":opening,"pid":value["pid"],"process_identity":identity,
               "receipt_identity":measured(receipt)}
        save(lease_path,lease)
        return OriginalServer(value["pid"],identity),None,receipt,value

    receipt=root/("server-"+uuid.uuid4().hex+".json")
    log=root/(receipt.stem+".log")
    argv=[sys.executable,str(HERE/"forms_workspace_server.py"),
          "--workspace",str(workspace),"--receipt",str(receipt),"--port","0"]
    opening=dict(selected,argv=argv,receipt_name=receipt.name)
    save(receipt.with_suffix(".opening.json"),opening)
    stream=log.open("xb");child=None
    try:
        child=subprocess.Popen(argv,stdout=stream,stderr=subprocess.STDOUT,
            env=dict(os.environ,PYTHONDONTWRITEBYTECODE="1"))
        identity=process_identity(child.pid)
        require(identity is not None and identity["argv"]==argv,"Original server launch identity is unavailable")
        save(receipt.with_suffix(".spawned.json"),{"pid":child.pid,"process_identity":identity,"opening":opening})
        until=time.monotonic()+120
        while not receipt.exists() and child.poll() is None and time.monotonic()<until:
            time.sleep(.05)
        require(receipt.exists() and child.poll() is None,
                "Original workspace server did not return its receipt; read "+str(log))
        value,observed=server_receipt(root,opening,receipt,identity)
        require(value["pid"]==child.pid,"Actual workspace server receipt PID differs")
        save(receipt.with_suffix(".lease.json"),{"opening":opening,"pid":child.pid,
             "process_identity":observed,"receipt_identity":measured(receipt)})
        return child,stream,receipt,value
    except BaseException:
        if child is not None and child.poll() is None:
            child.terminate()
            try:child.wait(timeout=30)
            except subprocess.TimeoutExpired:child.kill();child.wait()
        stream.close();raise

def reopen_call(root,received,method,params,rid=None):
    name="cold-"+method.replace(".","-")+"-"+(rid or uuid.uuid4().hex)
    selected=root/"cold-requests"/(name+".json")
    selected.parent.mkdir(exist_ok=True)
    save(selected,params)
    args=[sys.executable,received/"software/forms_workspace.py","call","--workspace",received,
          "--method",method,"--params",selected]
    if rid:args+=["--request-id",rid]
    result=native_command(root,name,args)
    stdout=Path(result["stdout"]["path"])
    value=json.loads(stdout.read_text(encoding="utf-8"))
    require(value["schema"]=="tjlabs.forms-workspace.response.v1","Actually received program returned another schema")
    return value,result

def retained_export(archive,workspace_id,source):
    """Recover a finished complete ZIP whose external receipt was interrupted."""
    archive=Path(archive)
    with zipfile.ZipFile(archive) as z:
        names=z.namelist()
        require(len(names)==len(set(names)) and "archive-manifest.json" in names,
                "Original complete workspace archive member identities differ")
        manifest=json.loads(z.read("archive-manifest.json"))
        require(manifest["schema"]=="tjlabs.forms-workspace.archive.v1" and
                manifest["workspace_id"]==workspace_id and manifest["source_files"]==source,
                "Existing archive belongs to another original workspace or software")
        expected={x["path"]:x for x in manifest["files"]}
        require(len(expected)==len(manifest["files"]) and set(names)==set(expected)|{"archive-manifest.json"},
                "Existing full workspace ZIP members differ")
        for member in z.infolist():
            if member.filename=="archive-manifest.json":continue
            require(not member.is_dir() and stat.S_ISREG(member.external_attr>>16),
                    "Original archive member is not an ordinary file")
            entry=expected[member.filename]
            require(member.file_size==entry["bytes"],"Original archived member size differs")
            digest=hashlib.sha256();count=0
            with z.open(member) as stream:
                for block in iter(lambda:stream.read(1024*1024),b""):
                    digest.update(block);count+=len(block)
            require(count==entry["bytes"] and digest.hexdigest()==entry["sha256"],
                    "Original complete workspace archive member bytes differ")
    return {"schema":"tjlabs.forms-workspace.export.v1","workspace_id":workspace_id,
            "workspace_revision":manifest["workspace_revision"],"archive":{"path":str(archive),**measured(archive)},
            "members":len(manifest["files"])+1,"source_files":source}

def retained_receiving(archive,received,workspace_id,source):
    exported=retained_export(archive,workspace_id,source)
    with Workspace(received) as workspace:
        description=current(workspace,"workspace.describe")
        require(description["workspace_id"]==workspace_id and description["source_files"]==source,
                "Original independent receiving belongs to another workspace/source")
        # The recipient may already have continued after original receiving. Its
        # original archived revision remains the receiving identity.
        require(description["revision"]>=exported["workspace_revision"],"Received workspace lost original history")
        from forms_workspace import verify_contents
        verify_contents(workspace.root,workspace.db,workspace.meta)
    return {"schema":"tjlabs.forms-workspace.receiving.v1","workspace_id":workspace_id,
            "workspace_revision":exported["workspace_revision"],"directory":str(received),
            "archive":exported["archive"],"source_files":source}

def retained_native_stage(root,source,keep_server):
    """Recover native completion without opening the listener-owned workspace."""
    saved=read_json(root/"native-before-http.json")
    require(saved["schema"]=="tjlabs.forms-workspace.native-stage.v1" and
            saved["operation"]==OPERATION and saved["source"]==source and
            saved["keep_server"]==bool(keep_server),
            "Restore the exact original native stage and server-retention selection")
    result=saved["result"]
    require(result["operation"]==OPERATION and result["source"]==source and
            result["workspace"]==str(root/"workspace") and result["status"]=="RUNNING",
            "Original complete pre-server course binding differs")
    meta=read_json(root/"workspace/workspace.json")
    require(meta["workspace_id"]==result["workspace_id"] and meta["source_files"]==source,
            "Original pre-server workspace/source identity differs")
    for key in ("workspace_archive","cold_archive"):
        record=result[key]
        require(retained_export(record["archive"]["path"],result["workspace_id"],source)==record,
                "Original complete archived workspace identity differs")
    for item in result["editions"]:
        run=item["run"]
        require(semantic_checks(root/"workspace"/run["project"],item["edition"])==item["checks"],
                "Original calculated edition observations differ")
        require(measured(root/"workspace"/run["archive"]["path"])==
                {k:run["archive"][k] for k in ("bytes","sha256")},
                "Original complete project archive changed")
        require(measured(item["installation"]["path"])=={k:item["installation"][k] for k in ("bytes","sha256")},
                "Original complete Installation source selection changed")
    # These separate received workspaces have no service in this course.
    # Validate them without touching the surviving producer listener.
    retained_receiving(result["workspace_archive"]["archive"]["path"],
                       Path(result["cold"]["directory"]),result["workspace_id"],source)
    retained_receiving(result["cold_archive"]["archive"]["path"],
                       Path(result["cold"]["successor_directory"]),result["workspace_id"],source)
    return result

def completed(root,source):
    path=root/"receiving.json"
    if not path.exists():return None
    original=read_json(path)
    require(original["operation"]==OPERATION and original["source"]==source and
            original["status"]=="NATIVE_COMPLETE","Original course source or completion differs")
    for key in ("workspace_archive","cold_archive"):
        item=original[key]
        require(measured(item["archive"]["path"])=={k:item["archive"][k] for k in ("bytes","sha256")},
                "Original complete workspace archive changed")
    for item in original["editions"]:
        run=item["run"]
        require(semantic_checks(Path(original["workspace"])/run["project"],item["edition"])==item["checks"],
                "Original calculated edition observations differ")
        require(measured(Path(original["workspace"])/run["archive"]["path"])=={k:run["archive"][k] for k in ("bytes","sha256")},
                "Original complete project archive changed")
        require(measured(item["installation"]["path"])=={k:item["installation"][k] for k in ("bytes","sha256")},
                "Original complete Installation source selection changed")
    if original["server"]["kept"]:
        receipt=read_json(original["server"]["receipt"])
        try:observed=http(receipt,"workspace.describe")["value"]
        except Exception:
            raise RuntimeError("Original native receiving is complete and retained. Its kept server is no longer available; explicitly reopen that workspace with a new receipt.") from None
        require(observed["workspace_id"]==original["workspace_id"],"Kept server belongs to another workspace")
    return original

def main(argv=None):
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--directory",required=True);parser.add_argument("--keep-server",action="store_true")
    args=parser.parse_args(argv)
    root=Path(args.directory).resolve()
    require(not root.is_relative_to(HERE),"Receiving output must be outside the selected software")
    root.mkdir(parents=True,exist_ok=True,mode=0o700)
    lock=(root/".receiving.lock").open("a+b");fcntl.flock(lock.fileno(),fcntl.LOCK_EX|fcntl.LOCK_NB)
    source=source_files()
    save(root/"receiving-input.json",{"operation":OPERATION,"source":source})
    prior=completed(root,source)
    if prior is not None:
        print(json.dumps(prior,ensure_ascii=False));lock.close();return 0
    result={"schema":"tjlabs.forms-workspace.receiving.v1","operation":OPERATION,
            "source":source,"status":"RUNNING","editions":[],"actual_visual_review":"PENDING"}
    child=None;log=None
    try:
        if (root/"native-before-http.json").exists():
            result=retained_native_stage(root,source,args.keep_server)
            workspace_path=Path(result["workspace"])
        else:
            result["examples"]=materialize_examples(root)
            prepared=[]
            for edition in ("a","b","c"):
                capture,intake,archive=capture_edition(root,edition)
                prepared.append((edition,capture,intake,archive))
            workspace_path=root/"workspace"
            with Workspace(workspace_path,create=not workspace_path.exists(),label="Complete invented Forms authoring receiving") as workspace:
                result["workspace_id"]=workspace.meta["workspace_id"];result["workspace"]=str(workspace_path)
                base=None
                for edition,capture_path,_,archive in prepared:
                    staged=workspace.stage_capture_archive(archive)
                    params={"archive_name":staged["archive_name"]}
                    imported=command(workspace,"capture.import",params,"course-capture-"+edition)
                    require(command(workspace,"capture.import",params,"course-capture-"+edition)==imported,
                            "Same original capture request changed its returned result")
                    capture=imported["value"]
                    worksheet=current(workspace,"capture.worksheet",{"capture_id":capture["id"]})
                    require(worksheet["status"]=="MAPPING_REQUIRED" and worksheet["discovery_manifest"] is None,
                            "Original collector's mapping-required boundary changed")
                    create={"capture_id":capture["id"],"name":"Invented authored edition "+edition.upper()}
                    if base:
                        create.update(base_draft_id=base["id"],base_draft_revision=base["revision"],
                                      rebind_reference="DEMONSTRATION explicit complete prior/current source review "+edition.upper())
                    initial=command(workspace,"draft.create",create,"course-draft-"+edition)["value"]
                    if base:
                        require(initial["source_review"]["prior_draft_revision"]==base["revision"] and
                                initial["source_review"]["capture_before"]["id"]==base["capture_id"],
                                "Selected historical source rebind lost its original reference")
                    if edition=="a":
                        unfinished='{"schema":\n'
                        rawsave={"draft_id":initial["id"],"expected_revision":1,
                                 "name":initial["name"],"raw":unfinished}
                        partial=command(workspace,"draft.save",rawsave,"course-unfinished-a")["value"]
                        require(partial["raw"]==unfinished and partial["revision"]==2,"Complete unfinished draft changed")
                        invalid=current(workspace,"draft.validate",{"draft_id":initial["id"]})
                        # On a resumed course a later saved revision may already exist;
                        # the original complete unfinished revision remains the authority.
                        historical=current(workspace,"draft.show",{"draft_id":initial["id"],"revision":2})
                        require(historical["raw"]==unfinished,"Original unfinished revision was lost")
                        mapped_revision=2
                    else:mapped_revision=1
                    intake=selected_intake(root,edition,worksheet)
                    original_map={a["id"]:a for a in intake["assets"]}
                    original_example=read_json(root/"examples"/edition/"intake.json")
                    original_example_assets={a["id"]:a for a in original_example["assets"]}
                    csv_checks=[]
                    for table in intake["discovery_manifest"]["tables"]:
                        asset=original_map[intake["table_assets"][table["id"]]]
                        example=original_example_assets[asset["id"]]
                        csv_checks.append(complete_csv(workspace,capture,asset,table,root/"examples"/edition/example["path"]))
                    raw=json_bytes(intake).decode("utf-8")
                    saved=command(workspace,"draft.save",{"draft_id":initial["id"],"expected_revision":mapped_revision,
                            "name":initial["name"],"raw":raw},"course-mapped-"+edition)["value"]
                    check=current(workspace,"draft.validate",{"draft_id":saved["id"]})
                    require(check["valid"],"Original full mapping failed native structural validation: "+str(check["errors"]))
                    run_params={"draft_id":saved["id"],"expected_revision":saved["revision"]}
                    run_answer=command(workspace,"run.create",run_params,"course-run-"+edition)
                    require(command(workspace,"run.create",run_params,"course-run-"+edition)==run_answer,
                            "Original native run replay created another outcome")
                    run=run_answer["value"]
                    checks=semantic_checks(workspace_path/run["project"],edition)
                    require(checks["project_identity"]==run["project_identity"],"Native original project identity differs")
                    installation=inspect_workspace(workspace,run["id"])
                    selected_source=source_bytes(installation)
                    selected_path=root/"installation-sources"/("edition-"+edition+".json")
                    immutable(selected_path,selected_source)
                    require(installation["workspace"]["run_id"]==run["id"] and
                            installation["project"]["identity"]==run["project_identity"],
                            "Original native Installation selection differs from its actual completed run")
                    result["editions"].append({"edition":edition,"capture":capture,"draft":saved,
                                              "run":run,"checks":checks,"csv":csv_checks,
                                              "installation":{"path":str(selected_path),**measured(selected_path)}})
                    base=saved
                # The actual selected old revision is forked after a later revision exists.
                selected=result["editions"][0]["draft"]
                later=command(workspace,"draft.save",{"draft_id":selected["id"],"expected_revision":selected["revision"],
                      "name":"Invented A following operator note","raw":selected["raw"]},"course-later-a")["value"]
                fork=command(workspace,"draft.create",{"capture_id":selected["capture_id"],"name":"Exact historical A mapping",
                     "base_draft_id":selected["id"],"base_draft_revision":selected["revision"]},"course-historical-fork")["value"]
                require(fork["base_draft_revision"]==selected["revision"] and fork["raw"]==selected["raw"],
                        "Historical fork silently used the current later revision")
                try:
                    command(workspace,"draft.save",{"draft_id":selected["id"],"expected_revision":selected["revision"],
                        "name":"Stale source selection","raw":"[]"},"course-stale-save")
                except DiscoveryError:pass
                else:raise RuntimeError("A stale native draft save replaced a later revision")
                require(current(workspace,"draft.show",{"draft_id":selected["id"]})["revision"]==later["revision"],
                        "Revision conflict changed current native state")
                raw_array=command(workspace,"draft.save",{"draft_id":fork["id"],"expected_revision":1,
                          "name":fork["name"],"raw":"[]"},"course-nonobject")["value"]
                require(not current(workspace,"draft.validate",{"draft_id":fork["id"]})["valid"],
                        "Nonobject draft was not retained as an editable validation result")
                unfinished_fork=command(workspace,"draft.create",{"capture_id":fork["capture_id"],"name":"Original raw nonobject copy",
                    "base_draft_id":fork["id"],"base_draft_revision":raw_array["revision"]},"course-raw-fork")["value"]
                require(unfinished_fork["raw"]=="[]","Same-source fork changed raw unfinished text")
                original_selection=result["editions"][0]["installation"]
                repeated=source_bytes(inspect_workspace(workspace,result["editions"][0]["run"]["id"]))
                require(repeated==Path(original_selection["path"]).read_bytes(),
                        "A later unrelated draft changed the original completed Installation source")
                result["history"]={"later":later["id"],"later_revision":later["revision"],
                                   "historical_fork":fork["id"],"raw_fork":unfinished_fork["id"]}
                archive=root/"Forms_Workspace.zip"
                if not archive.exists():
                    exported=workspace.export(archive);save(root/"workspace-export.json",exported)
                else:
                    if (root/"workspace-export.json").exists():exported=read_json(root/"workspace-export.json")
                    else:
                        exported=retained_export(archive,result["workspace_id"],source)
                        require(exported["workspace_revision"]==workspace._revision(),
                                "Original export revision differs from the selected pre-handover workspace")
                        save(root/"workspace-export.json",exported)
                    require(measured(archive)=={k:exported["archive"][k] for k in ("bytes","sha256")},
                            "Original complete workspace archive differs")
                result["workspace_archive"]=exported
            received=root/"received-workspace"
            if not received.exists():
                receiving=receive_workspace(root/"Forms_Workspace.zip",received)
                save(root/"workspace-receiving.json",receiving)
            else:
                if (root/"workspace-receiving.json").exists():receiving=read_json(root/"workspace-receiving.json")
                else:
                    receiving=retained_receiving(root/"Forms_Workspace.zip",received,result["workspace_id"],source)
                    save(root/"workspace-receiving.json",receiving)
            require(receiving["workspace_id"]==result["workspace_id"],"Cold workspace identity differs")
            described,description_command=reopen_call(root,received,"workspace.describe",{})
            require(described["workspace_id"]==result["workspace_id"] and
                    described["value"]["source_files"]==source,"Actually received program/source identity differs")
            c=result["editions"][-1]["draft"]
            historical,history_command=reopen_call(root,received,"draft.show",{"draft_id":c["id"],"revision":c["revision"]})
            require(historical["value"]==c,"Complete actually received draft/history differs")
            copy,copy_command=reopen_call(root,received,"draft.create",{"capture_id":c["capture_id"],
                "name":"Actually received complete C mapping","base_draft_id":c["id"],"base_draft_revision":c["revision"]},
                "course-cold-copy")
            require(copy["value"]["raw"]==c["raw"],"Actual cold continuation lost full selected intake")
            cold_archive=root/"Forms_Workspace_Cold.zip"
            if not cold_archive.exists():
                native=native_command(root,"cold-whole-export",[sys.executable,received/"software/forms_workspace.py","export",
                                      "--workspace",received,"--output",cold_archive])
                cold_export=json.loads(Path(native["stdout"]["path"]).read_text(encoding="utf-8"))
                save(root/"cold-export.json",cold_export)
            else:
                if (root/"cold-export.json").exists():cold_export=read_json(root/"cold-export.json")
                else:
                    cold_export=retained_export(cold_archive,result["workspace_id"],source)
                    save(root/"cold-export.json",cold_export)
            require(measured(cold_archive)=={k:cold_export["archive"][k] for k in ("bytes","sha256")},
                    "Complete received-program successor export differs")
            second=root/"received-cold-successor"
            if not second.exists():
                native=native_command(root,"cold-successor-receive",[sys.executable,received/"software/forms_workspace.py","receive",
                    "--archive",cold_archive,"--output",second])
                save(root/"cold-successor-receiving.json",json.loads(Path(native["stdout"]["path"]).read_text(encoding="utf-8")))
            elif not (root/"cold-successor-receiving.json").exists():
                save(root/"cold-successor-receiving.json",
                     retained_receiving(cold_archive,second,result["workspace_id"],source))
            result["cold"]={"directory":str(received),"receiving":receiving,"description_command":description_command,
                            "history_command":history_command,"copy_command":copy_command,"copy":copy["value"],
                            "successor_directory":str(second)}
            result["cold_archive"]=cold_export
            save(root/"native-before-http.json",{"schema":"tjlabs.forms-workspace.native-stage.v1",
                "operation":OPERATION,"source":source,"keep_server":bool(args.keep_server),"result":result})
        child,log,receipt_path,receipt=start_server(root,workspace_path,result)
        described=http(receipt,"workspace.describe")
        require(described["workspace_id"]==result["workspace_id"],"Actual HTTP workspace identity differs")
        for item in result["editions"]:
            run=item["run"]
            observed=http(receipt,"run.show",{"run_id":run["id"]})["value"]
            require(observed==run,"Original actual HTTP run record differs")
            status=http(receipt,"request.status",{"request_id":run["original_request_id"]})["value"]
            require(status["status"]=="COMPLETE" and status["phases"][-1]["status"]=="PROJECT_INDEPENDENTLY_RECEIVED",
                    "Actual retained native phase/status differs")
            with urllib.request.urlopen(receipt["origin"]+"api/run-archive?run_id="+run["id"],timeout=120) as response:
                digest=hashlib.sha256();count=0
                while True:
                    block=response.read(1024*1024)
                    if not block:break
                    digest.update(block);count+=len(block)
            require(count==run["archive"]["bytes"] and digest.hexdigest()==run["archive"]["sha256"],
                    "Actual complete HTTP archive download differs")
        result["server"]={"receipt":str(receipt_path),"receipt_identity":measured(receipt_path),
                          "pid":child.pid,"kept":bool(args.keep_server),"origin":receipt["origin"]}
        result["browser"]="Use the actual kept server receipt in receiving_forms_workspace_browser.mjs; inspect all desktop/narrow pixels and complete downloads."
        result["status"]="NATIVE_COMPLETE"
        save(root/"receiving.json",result)
        print(json.dumps(result,ensure_ascii=False))
        return 0
    except BaseException as exc:
        result["status"]="INCOMPLETE";result["error"]={"type":type(exc).__name__,"message":str(exc)}
        failed=root/("receiving-failure-"+uuid.uuid4().hex+".json")
        save(failed,result);raise
    finally:
        if child and (result["status"]!="NATIVE_COMPLETE" or not args.keep_server):
            if child.poll() is None:
                child.terminate()
                try:child.wait(timeout=60)
                except subprocess.TimeoutExpired:child.kill();child.wait()
        if log:log.close()
        lock.close()

if __name__=="__main__":raise SystemExit(main())
