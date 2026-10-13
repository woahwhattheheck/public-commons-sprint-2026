"""Run the complete local capture, forms project, archive and cold-receiving course."""
from __future__ import annotations
import argparse
from contextlib import closing
import csv
import fcntl
import hashlib
import json
import os
from pathlib import Path
import shutil
import sqlite3
import subprocess
import sys
import time
import uuid
import urllib.request
import zipfile

os.environ["PYTHONDONTWRITEBYTECODE"] = "1"
from discovery_engine import require, json_bytes, read_json, file_digest
from forms_workbench import APPLICATION, verify_project
from forms_server import complete_archive
from forms_capture import verify as verify_capture

OPERATION = "FORMS-WORKBENCH-RECEIVING-E258-20261013"
HERE = Path(__file__).resolve().parent

def atomic(path, raw, immutable=False):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists() and immutable:
        require(path.is_file() and not path.is_symlink() and path.read_bytes() == raw,
                "An existing original receiving file differs: "+str(path))
        return
    require(not path.is_symlink(), "Owned regular receiving path required")
    temp = path.with_name("."+path.name+"-"+uuid.uuid4().hex)
    try:
        with temp.open("xb") as out:
            out.write(raw)
            out.flush()
            os.fsync(out.fileno())
        if immutable:
            os.link(temp,path)
        else:
            os.replace(temp,path)
    finally:
        if temp.exists():
            temp.unlink()

def keep(path,value):
    atomic(path,json_bytes(value),True)

def identity(path):
    path = Path(path)
    return {"path":str(path),"bytes":path.stat().st_size,"sha256":file_digest(path)}

def run(root,name,args):
    stem = root/"logs"/(name+"-"+uuid.uuid4().hex)
    stem.parent.mkdir(exist_ok=True)
    with stem.with_suffix(".stdout").open("xb") as out, stem.with_suffix(".stderr").open("xb") as err:
        child = subprocess.run([str(x) for x in args],stdout=out,stderr=err,
                               env={**os.environ,"PYTHONDONTWRITEBYTECODE":"1"})
    record = {"argv":[str(x) for x in args],"exit_code":child.returncode,
              "stdout":identity(stem.with_suffix(".stdout")),"stderr":identity(stem.with_suffix(".stderr"))}
    keep(stem.with_suffix(".json"),record)
    require(child.returncode == 0,"Native command failed; complete original logs: "+str(stem))
    return record

def fetch(receipt,tail):
    url = receipt["origin"]+tail
    with urllib.request.urlopen(url,timeout=60) as response:
        require(response.status == 200,"Actual HTTP request failed")
        return response.read()

def read_stream(path):
    with Path(path).open(encoding="utf-8") as inp:
        return [json.loads(line) for line in inp]

def verify_rows(project):
    root,result = verify_project(project,check_application=True)
    with closing(sqlite3.connect((root/"forms.sqlite").as_uri()+"?mode=ro",uri=True)) as db:
        for kind,key in (("assets","asset_id"),("attachments","entry_id"),("findings","finding_id")):
            rows = read_stream(root/(kind+".jsonl"))
            require(len(rows) == result[kind]["count"],"Complete "+kind+" population differs")
            indexed = {x[0]:json.loads(x[1]) for x in db.execute("SELECT "+key+",payload FROM "+kind)}
            require(len(indexed) == len(rows) and all(indexed[row[key]] == row for row in rows),
                    "Full original stream/index differs: "+kind)
            with (root/(kind+".csv")).open(encoding="utf-8",newline="") as inp:
                require(len(list(csv.reader(inp))) == len(rows)+1,"Complete CSV export row count differs")
    return result

def semantic_checks(root,edition):
    result = verify_rows(root)
    findings = read_stream(root/"findings.jsonl")
    attachments = read_stream(root/"attachments.jsonl")
    statuses = {row["status"] for row in findings if row["kind"] == "attachment"}
    require(result["assets"]["count"] == 43,"Selected complete original asset population differs")
    require(result["migration"]["pairs"] == 3,"Original response/workflow/downstream pair membership differs")
    if edition == "a":
        require({"MATCHED","DIFFERENCE","UNAVAILABLE","PARENT_MISMATCH","AMBIGUOUS","SOURCE_ONLY","TARGET_ONLY"} <= statuses,
                "Original unresolved attachment meanings are not all present")
        require(result["classes"]["workflow"]["scope_state"] == "UNEXAMINED",
                "Partial workflow body was mistaken for complete history")
    elif edition == "b":
        require(statuses == {"MATCHED"},"Corrected attachment receiving differs")
        require(result["classes"]["workflow"]["scope_state"] == "UNEXAMINED" and
                result["classes"]["downstream"]["scope_state"] == "DEFERRED",
                "Partial and explicitly deferred classes disappeared after row corrections")
    else:
        require(statuses == {"MATCHED"} and all(x["scope_state"] == "MATCHED" for x in result["classes"].values()),
                "Final explicit selected coverage differs")
    # Actual original raw compound keys include a repeated record ordinal.
    require(any(a["parent"]["key_columns"] == ["response_id","repeat_ordinal"] for a in attachments),
            "Explicit repeat parent compound key is missing")
    migration = read_json(root/"reconciliation/migration/result.json")
    pair = next(x for x in migration["pairs"] if x["id"] == "records")
    require(pair["summary"]["status_counts"].get("MATCHED",0)>0,"Original native matched rows missing")
    if edition != "a":
        require(set(pair["summary"]["status_counts"]) == {"MATCHED"},
                "Corrected full response field comparison differs")
    return {"project_identity":result["project_identity"],"assets":result["assets"]["count"],
            "attachments":result["attachments"]["count"],"findings":result["findings"]["count"],
            "attachment_statuses":sorted(statuses),"classes":{k:v["scope_state"] for k,v in result["classes"].items()}}

def materialize_examples(root):
    bundle = read_json(HERE/"FORMS_EXAMPLES.json")
    require(bundle["schema"] == "tjlabs.forms-workbench.examples.v1","Complete selected examples unavailable")
    members = set()
    for item in bundle["files"]:
        path = Path(item["path"])
        require(not path.is_absolute() and all(p not in ("..",".","") for p in item["path"].split("/")) and
                "\\" not in item["path"] and item["path"] not in members,"Invalid or duplicate example member")
        members.add(item["path"])
        raw = item["content"].encode("utf-8")
        require(len(raw) == item["bytes"] and hashlib.sha256(raw).hexdigest() == item["sha256"],
                "Complete original example body differs")
        atomic(root/path,raw,True)
    return {"members":len(members),"source":identity(HERE/"FORMS_EXAMPLES.json")}

def capture_edition(root,edition):
    source = root/"examples"/edition
    capture = root/("capture-"+edition)
    capture_args = [sys.executable,HERE/"forms_capture.py","capture",
                    "--selection",source/"capture-selection.json","--input-root",source,"--output",capture]
    if capture.exists():
        capture_args.append("--resume")
    run(root,"capture-"+edition,capture_args)
    run(root,"verify-capture-"+edition,[sys.executable,HERE/"forms_capture.py","verify","--capture",capture])
    selected = read_json(source/"intake.json")
    worksheet = read_json(capture/"mapping-worksheet.json")
    require(worksheet["attachments"] == selected["attachments"],"Actual capture lost explicit original parent links")
    require(worksheet["discovery_manifest"] is None and worksheet["migration_selection"] is None,
            "Collector must preserve mapping-required semantics")
    # The original local capture retains exact original files; its actual asset
    # inventory supplies the new source paths, preserving all operator mappings.
    captured = {row.get("id",row.get("asset_id")):row for row in read_stream(capture/"assets.jsonl")}
    require(set(captured) == {a["id"] for a in selected["assets"]},"Collector changed selected whole asset membership")
    for a in selected["assets"]:
        c = captured[a["id"]]
        require(c["availability"] == a["availability"],"Collector changed original availability")
        if a["availability"] == "PRESENT":
            require(c["bytes"] == a["bytes"] and c["sha256"] == a["sha256"],"Captured original byte identity differs")
            retained = c["path"]
            p = capture/retained
            require(p.is_file() and p.stat().st_size == a["bytes"] and file_digest(p) == a["sha256"],
                    "Complete actual capture body missing")
            a["path"] = retained
    intake = root/("intake-captured-"+edition+".json")
    keep(intake,selected)
    archive = root/("Capture_"+edition.upper()+".zip")
    if not archive.exists():
        run(root,"pack-capture-"+edition,[sys.executable,HERE/"forms_capture.py","pack","--capture",capture,"--output",archive])
    keep(root/("capture-archive-"+edition+".json"),identity(archive))
    received_capture = root/("capture-received-"+edition)
    if not received_capture.exists():
        run(root,"receive-capture-"+edition,[sys.executable,HERE/"forms_capture.py","receive",
            "--archive",archive,"--output",received_capture])
    run(root,"verify-received-capture-"+edition,[sys.executable,HERE/"forms_capture.py","verify",
        "--capture",received_capture/"capture"])
    require((received_capture/"capture/assets.jsonl").read_bytes() == (capture/"assets.jsonl").read_bytes(),
            "Independent original capture receiving differs")
    return capture,intake,archive

def start_server(root,name,project,archive):
    receipt = root/(name+"-"+uuid.uuid4().hex+".json")
    stdout = receipt.with_suffix(".stdout")
    stderr = receipt.with_suffix(".stderr")
    out,err = stdout.open("xb"),stderr.open("xb")
    child = subprocess.Popen([sys.executable,str(HERE/"forms_server.py"),"--project",str(project),
        "--archive",str(archive),"--receipt",str(receipt),"--port","0"],stdout=out,stderr=err,
        env={**os.environ,"PYTHONDONTWRITEBYTECODE":"1"})
    out.close();err.close()
    deadline = time.monotonic()+90
    while not receipt.exists():
        if child.poll() is not None:
            raise RuntimeError("Actual forms server returned before receipt; read "+str(stderr))
        if time.monotonic()>deadline:
            child.terminate();child.wait(timeout=15)
            raise RuntimeError("Actual server did not produce its original receipt; logs retained")
        time.sleep(.1)
    value = read_json(receipt)
    require(value["schema"] == "tjlabs.forms-workbench.server.v1" and value["read_only"] is True,
            "Actual server receipt contract differs")
    return child,receipt,value

def receive_http(root,receipt,project,archive):
    result = json.loads(fetch(receipt,"api/forms/summary"))
    require(result == read_json(project/"result.json"),"HTTP result differs from complete original")
    counts = {}
    for kind,key in (("assets","asset_id"),("attachments","entry_id"),("findings","finding_id")):
        full = read_stream(project/(kind+".jsonl"))
        seen = []
        offset = 0
        while True:
            page = json.loads(fetch(receipt,"api/forms/"+kind+"?offset="+str(offset)+"&limit=7"))
            require(page["total"] == len(full),"Actual paged source count differs")
            seen.extend(page["rows"]);offset += len(page["rows"])
            if offset >= page["total"]:
                break
            require(page["rows"],"Native page ended early")
        require({x[key]:x for x in seen} == {x[key]:x for x in full},"Actual complete paged records differ")
        counts[kind] = len(seen)
        for extension in ("jsonl","csv"):
            require(fetch(receipt,"download/forms/"+kind+"."+extension) == (project/(kind+"."+extension)).read_bytes(),
                    "Full actual source download differs")
    for name in ("intake.original.json","intake.receiving.json","result.json"):
        require(fetch(receipt,"download/forms/"+name) == (project/name).read_bytes(),"Whole native JSON differs")
    require(json.loads(fetch(receipt,"api/forms/intake-receiving")) == read_json(project/"intake.receiving.json"),
            "Runnable received selection differs")
    for asset in read_stream(project/"assets.jsonl"):
        if asset["availability"] == "PRESENT":
            body = fetch(receipt,"download/forms/original?id="+asset["asset_id"])
            require(len(body) == asset["actual_bytes"] and hashlib.sha256(body).hexdigest() == asset["actual_sha256"],
                    "Whole actual original download differs")
    require(hashlib.sha256(fetch(receipt,"download/forms/project.zip")).hexdigest() == file_digest(archive),
            "Whole selected project download differs")
    parent = next(a["parent"] for a in read_stream(project/"attachments.jsonl") if a["parent_status"] == "MATCHED")
    observed = json.loads(fetch(receipt,"api/source?table="+parent["table"]+"&record="+str(parent["record"])))
    require([observed["values"][observed["headers"].index(c)] for c in parent["key_columns"]] == parent["key_values"],
            "Actual original parent source drilldown differs")
    return {"counts":counts,"parent":parent,"project_identity":result["project_identity"],
            "complete_http_downloads":"MATCHED"}


def completed_receiving(root,source):
    saved = root/"receiving.json"
    if not saved.exists():
        return None
    prior = read_json(saved)
    require(prior.get("schema") == "tjlabs.forms-workbench.receiving.v1" and
            prior.get("operation") == OPERATION and prior.get("status") == "NATIVE_COMPLETE" and
            prior.get("source") == source,"Original completed receiving source or operation differs")
    require([x["edition"] for x in prior["editions"]] == ["a","b","c"],
            "Original complete edition membership differs")
    for item in prior["editions"]:
        edition = item["edition"]
        require(semantic_checks(Path(item["project"]),edition) == item["checks"],
                "Original completed project observations differ")
        require(verify_rows(Path(item["received"]))["project_identity"] == item["checks"]["project_identity"],
                "Original independent receiving identity differs")
        for key in ("archive","capture_archive"):
            require(identity(item[key]["path"]) == item[key],"Original complete archive bytes differ")
        complete_archive(item["archive"]["path"],Path(item["project"]),read_json(Path(item["project"])/"result.json"))
        verify_capture(root/("capture-"+edition))
        verify_capture(root/("capture-received-"+edition)/"capture")
    require(verify_rows(Path(prior["cold"]["project"]))["project_identity"] == prior["cold"]["project_identity"],
            "Original cold-receiving project differs")
    require([x["edition"] for x in prior["servers"]] == ["a","c"],"Original server cohort differs")
    for server in prior["servers"]:
        require(identity(server["receipt"]) == server["receipt_identity"],"Original server receipt bytes differ")
        if not server["kept"]:
            continue
        receipt_path = Path(server["receipt"])
        require(receipt_path.is_file(),"Original kept server receipt missing; preserve this result and explicitly reopen its project")
        receipt = read_json(receipt_path)
        require(receipt["pid"] == server["pid"],"Original kept server owner differs")
        edition = next(x for x in prior["editions"] if x["edition"] == server["edition"])
        require(receipt["project_identity"] == edition["checks"]["project_identity"],
                "Original kept server project differs")
        try:
            checks = receive_http(root,receipt,Path(edition["project"]),Path(edition["archive"]["path"]))
        except Exception:
            raise RuntimeError("An original kept server is no longer receivable. The completed result and original receipts are preserved; explicitly reopen that verified project with forms_server.py and a new receipt.") from None
        require(checks == server["checks"],"Original kept server complete HTTP observations differ")
    return prior

def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--directory",required=True)
    p.add_argument("--keep-server",action="store_true")
    args = p.parse_args(argv)
    root = Path(args.directory).resolve()
    require(not root.is_relative_to(HERE),"Receiving output must be separate from selected software")
    root.mkdir(parents=True,exist_ok=True)
    lock = (root/".receiving.lock").open("a+b")
    fcntl.flock(lock.fileno(),fcntl.LOCK_EX|fcntl.LOCK_NB)
    source = [identity(HERE/name)|{"path":name} for name in APPLICATION]
    keep(root/"receiving-input.json",{"schema":"tjlabs.forms-workbench.receiving-input.v1","operation":OPERATION,
         "application":source,"examples_sha256":file_digest(HERE/"FORMS_EXAMPLES.json")})
    prior = completed_receiving(root,source)
    if prior is not None:
        print(json.dumps(prior,ensure_ascii=False))
        lock.close()
        return 0
    record = {"schema":"tjlabs.forms-workbench.receiving.v1","operation":OPERATION,
              "status":"RUNNING","source":source,"editions":[],"servers":[],"actual_visual_review":"PENDING"}
    children = []
    try:
        record["examples"] = materialize_examples(root)
        for edition in ("a","b","c"):
            capture,intake,capture_archive = capture_edition(root,edition)
            project = root/("project-"+edition)
            if not project.exists():
                run(root,"run-"+edition,[sys.executable,HERE/"forms_workbench.py","run",
                    "--intake",intake,"--input-root",capture,"--output",project])
            checks = semantic_checks(project,edition)
            archive = root/("Forms_"+edition.upper()+".zip")
            if not archive.exists():
                run(root,"pack-"+edition,[sys.executable,HERE/"forms_workbench.py","pack","--project",project,"--output",archive])
            complete_archive(archive,project,read_json(project/"result.json"))
            keep(root/("project-archive-"+edition+".json"),identity(archive))
            received = root/("received-"+edition)
            if not received.exists():
                run(root,"receive-"+edition,[sys.executable,HERE/"forms_workbench.py","receive","--archive",archive,"--output",received])
            require(verify_rows(received)["project_identity"] == checks["project_identity"],"Independent receiving identity differs")
            record["editions"].append({"edition":edition,"project":str(project),"received":str(received),
                "archive":identity(archive),"capture_archive":identity(capture_archive),"checks":checks})
            atomic(root/"receiving-progress.json",json_bytes(record))
        received = root/"received-c"
        cold = root/"cold-c"
        if not cold.exists():
            run(root,"cold-native-rerun",[sys.executable,received/"workbench/forms_workbench.py","run",
                "--intake",received/"intake.receiving.json","--input-root",received,"--output",cold])
        cold_result = verify_rows(cold)
        for name in ("attachments.jsonl","findings.jsonl","reconciliation/migration/rows.jsonl",
                     "reconciliation/migration/totals.jsonl"):
            require((received/name).read_bytes() == (cold/name).read_bytes(),"Cold original-source calculation differs: "+name)
        original_assets = read_stream(received/"assets.jsonl")
        cold_assets = read_stream(cold/"assets.jsonl")
        require([{k:v for k,v in a.items() if k != "path"} for a in original_assets] ==
                [{k:v for k,v in a.items() if k != "path"} for a in cold_assets],
                "Cold original asset bodies or metadata differ")
        record["cold"] = {"project":str(cold),"project_identity":cold_result["project_identity"],
                          "same_original_rows_attachments_findings":True}
        for edition in ("a","c"):
            item = next(x for x in record["editions"] if x["edition"] == edition)
            child,path,receipt = start_server(root,"server-"+edition,Path(item["project"]),Path(item["archive"]["path"]))
            children.append((child,edition))
            checks = receive_http(root,receipt,Path(item["project"]),Path(item["archive"]["path"]))
            record["servers"].append({"edition":edition,"receipt":str(path),"receipt_identity":identity(path),"pid":child.pid,"checks":checks,
                                      "kept":bool(args.keep_server)})
            if not args.keep_server:
                child.terminate();child.wait(timeout=15)
        record["status"] = "NATIVE_COMPLETE"
        record["browser"] = "Run receiving_forms_browser.mjs against each actual kept A and C receipt; inspect all resulting views and attachments."
        atomic(root/"receiving.json",json_bytes(record))
        print(json.dumps(record,ensure_ascii=False))
        return 0
    except BaseException as exc:
        record["status"] = "INCOMPLETE"
        record["error"] = {"type":type(exc).__name__,"message":str(exc)}
        atomic(root/"receiving-failure.json",json_bytes(record))
        raise
    finally:
        if record["status"] != "NATIVE_COMPLETE" or not args.keep_server:
            for child,_ in children:
                if child.poll() is None:
                    child.terminate()
                    try:child.wait(timeout=15)
                    except subprocess.TimeoutExpired:child.kill();child.wait()
        lock.close()

if __name__ == "__main__":
    raise SystemExit(main())
