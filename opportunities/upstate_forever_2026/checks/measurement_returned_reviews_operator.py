#!/usr/bin/env python3
"""Operate the maintained returned-review queue using an already-completed native case.

Reuse its original input-archives, comparison/plan.json and decisions.json. This
does not author measurements, rerun capacity work or substitute a comparison engine.
"""
from __future__ import annotations
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path, PurePosixPath
import shutil
import subprocess
import sys
import time
import zipfile

NATIVE = r"""
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const c=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));
const module=name=>import(pathToFileURL(path.join(c.application,'measurement_workspace','engine',name)).href);
const {MeasurementWorkspace}=await module('workspace.mjs');
const {intakeFromFile,intakeStatus}=await module('large_intake.mjs');
const {receiveArchive}=await module('large_delivery.mjs');
const {fileDigest,atomicJSON}=await module('large_io.mjs');
const {hash,stable}=await module('normalise.mjs');
const open=directory=>new MeasurementWorkspace(directory);
const values=w=>hash(stable([...w.db.prepare('SELECT id,data FROM records ORDER BY id').iterate()]));
const sources=w=>[...w.db.prepare('SELECT id,kind,sha FROM imports ORDER BY id').iterate()];
if(c.action==='intakes'){
 const w=open(c.measurements), out={};
 try{
  for(const [role,item] of Object.entries(c.inputs)){
   const id=hash(c.operation+'-'+role), root=path.join(w.directory,'.large','intakes',id);
   let intake;
   if(fs.existsSync(path.join(root,'intake.json'))){
    intake=intakeStatus(w,id);
    if(intake.kind!=='portable'||intake.bytes!==item.bytes)throw Error('Retained original intake differs');
    if(intake.offset===item.bytes){
     if(stable(fileDigest(path.join(root,'original')))!==stable({bytes:item.bytes,sha256:item.sha256}))throw Error('Retained archive changed');
    }else intake=intakeFromFile(w,item.path,{id,kind:'portable',label:role+' — original returned-review case'});
   }else intake=intakeFromFile(w,item.path,{id,kind:'portable',label:role+' — original returned-review case'});
   out[role]={kind:'intake',id,bytes:item.bytes,sha256:item.sha256};
  }
 }finally{w.close();}
 process.stdout.write(JSON.stringify(out)+'\n');
}else if(c.action==='receive-and-edit'){
 const resultFile=path.join(c.output,'native-receiving.json');
 if(fs.existsSync(resultFile)){process.stdout.write(fs.readFileSync(resultFile,'utf8'));process.exit(0);}
 const reference=open(path.join(c.output,'reference-current')), cold=open(path.join(c.output,'received-measurements')), editable=open(c.editable);
 try{
  receiveArchive(reference,c.currentArchive);receiveArchive(cold,c.resultArchive);
  if(values(cold)!==values(reference)||values(editable)!==values(reference))throw Error('Reported original measurement values differ after native incorporation/receive');
  if(stable(sources(cold))!==stable(sources(reference))||stable(sources(editable))!==stable(sources(reference)))throw Error('Original source identities differ after receive');
  const count=cold.db.prepare('SELECT COUNT(*) n FROM records').get().n;
  if(count!==c.recordCount)throw Error('Original population differs');
  const result={records:count,sources:sources(cold),recordIdentity:values(cold),sourceRevision:c.resultRevision,receivedRevision:cold.revision()};
  const edits={};
  for(const [name,w] of [['editable',editable],['received',cold]]){
   const id=w.db.prepare('SELECT id FROM records ORDER BY id LIMIT 1').get().id,r=w.record(id);
   const note='INTERNAL OPERATOR RECEIVING EXERCISE — later independent note '+c.operation;
   // Native review and its event history make an interrupted exercise resumable.
   if(r.review.reason!==note)w.review(id,{state:r.review.state,reviewer:'Internal operator receiving exercise',reason:note,selectVersion:r.selectedVersion===id,expectedRevision:w.revision()});
   edits[name]={id,revision:w.revision(),reason:w.record(id).review.reason,records:values(w)};
  }
  if(edits.editable.records!==result.recordIdentity||edits.received.records!==result.recordIdentity)throw Error('A native review changed reported source values');
  result.laterEdits=edits;atomicJSON(resultFile,result);process.stdout.write(JSON.stringify(result)+'\n');
 }finally{reference.close();cold.close();editable.close();}
}else if(c.action==='verify-reopen'){
 const result=JSON.parse(fs.readFileSync(path.join(c.output,'native-receiving.json'),'utf8'));
 for(const [name,directory] of [['editable',c.editable],['received',path.join(c.output,'received-measurements')]]){
  const w=open(directory);try{const prior=result.laterEdits[name];if(w.revision()!==prior.revision||w.record(prior.id).review.reason!==prior.reason||values(w)!==prior.records)throw Error('Later independent edit was not preserved on repeat/reopen');}finally{w.close();}
 }
 process.stdout.write(JSON.stringify({reopened:true,laterIndependentEditsPreserved:true})+'\n');
}else throw Error('Unknown native receiving phase');
"""


def read(path):
    return json.loads(Path(path).read_text("utf-8"))


def sha(path):
    h = hashlib.sha256()
    count = 0
    with Path(path).open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            count += len(block)
            h.update(block)
    return {"bytes": count, "sha256": h.hexdigest()}


def save(path, value):
    path = Path(path)
    body = json.dumps(value, ensure_ascii=False, allow_nan=False, sort_keys=True, indent=2) + "\n"
    temporary = path.with_suffix(".pending")
    with temporary.open("w", encoding="utf-8") as stream:
        stream.write(body)
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(temporary, path)


def run_node(node, app, output, action, **selection):
    request = {"application": str(app), "output": str(output), "action": action, **selection}
    selected = output / ("native-" + action + "-request.json")
    save(selected, request)
    result = subprocess.run([node, "--input-type=module", "-e", NATIVE, str(selected)],
        capture_output=True, text=True, env={**os.environ, "MEASUREMENTS_PYTHON": sys.executable})
    if result.returncode:
        raise RuntimeError(result.stderr.strip() or "The original Measurements course failed")
    return json.loads(result.stdout)


def archive_inventory(path):
    """Actually open every downloaded ZIP member and retain exact source hashes."""
    rows = []
    with zipfile.ZipFile(path) as archive:
        names = set()
        for item in archive.infolist():
            p = PurePosixPath(item.filename)
            if p.is_absolute() or ".." in p.parts or "\\" in item.filename or item.filename in names:
                raise ValueError("Invalid or duplicate complete handoff member")
            names.add(item.filename)
            if item.is_dir():
                continue
            h, count = hashlib.sha256(), 0
            with archive.open(item) as stream:
                for chunk in iter(lambda: stream.read(1024 * 1024), b""):
                    h.update(chunk)
                    count += len(chunk)
            if count != item.file_size:
                raise ValueError("Complete handoff member size differs")
            rows.append({"path": item.filename, "bytes": count, "sha256": h.hexdigest()})
    return rows


def wait_task(operator, journal, output, name, action, payload, operation):
    requests = journal.setdefault("tasks", {})
    submitted = operator.submit(operator.primary, action, payload, operation + "-" + name)
    if name in requests and requests[name]["id"] != submitted["id"]:
        raise ValueError("The original native task identity changed")
    requests[name] = {"id": submitted["id"], "action": action, "payload": payload}
    save(output / "request-state.json", journal)
    if submitted["state"] in {"interrupted", "failed", "cancelled"}:
        submitted = operator.resume(submitted["id"])
    while submitted["state"] in {"queued", "running", "preparing", "cancelling"}:
        time.sleep(0.2)
        submitted = operator.task(submitted["id"])
    if submitted["state"] != "complete":
        raise RuntimeError(json.dumps(submitted.get("error", submitted)))
    value = operator.task_view(submitted["id"])
    if value.get("_extension_issues"):
        raise RuntimeError(json.dumps(value["_extension_issues"]))
    save(output / (name + "-task.json"), value)
    return value


def download(operator, task, directory):
    directory.mkdir(exist_ok=True)
    retained = []
    for ticket in task.get("_downloads", []):
        filename = ticket["filename"]
        if Path(filename).name != filename:
            raise ValueError("Download filename is not ordinary")
        target = directory / filename
        stream, metadata = operator.open_download(ticket["id"])
        with stream:
            if target.exists():
                if sha(target) != {k: metadata[k] for k in ("bytes", "sha256")}:
                    raise ValueError("Existing downloaded artifact changed")
            else:
                pending = target.with_suffix(target.suffix + ".pending")
                with pending.open("wb") as out:
                    shutil.copyfileobj(stream, out, 1024 * 1024)
                    out.flush()
                    os.fsync(out.fileno())
                if sha(pending) != {k: metadata[k] for k in ("bytes", "sha256")}:
                    raise ValueError("Downloaded original artifact differs")
                os.replace(pending, target)
        item = {"filename": filename, **sha(target)}
        if target.suffix == ".zip":
            item["members"] = archive_inventory(target)
        elif target.suffix == ".json":
            read(target)
        else:
            target.read_text("utf-8")
        retained.append(item)
    if not retained:
        raise ValueError("Completed native task did not expose its original files")
    return retained


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--application", required=True, type=Path)
    parser.add_argument("--workspace", required=True, type=Path)
    parser.add_argument("--original", required=True, type=Path,
        help="Completed original case containing input-archives, comparison/plan.json and decisions.json")
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    app, workspace, original, output = (p.resolve() for p in
        (args.application, args.workspace, args.original, args.output))
    for parent in (app, workspace, original):
        if output == parent or output.is_relative_to(parent) or parent.is_relative_to(output):
            raise ValueError("Keep the receiving output separate from the original application, Workspace and case")
    output.mkdir(parents=True, exist_ok=True)
    node = shutil.which("node")
    if not node:
        raise RuntimeError("Use the original Node 22.16 or newer environment")
    native_plan = read(original / "comparison" / "plan.json")
    decisions_path = original / "decisions.json"
    decisions = read(decisions_path)
    if decisions["planId"] != native_plan["id"]:
        raise ValueError("Choose original decisions for the exact completed native comparison")
    inputs = {}
    for role in ("baseline", "returned", "current"):
        path = original / "input-archives" / (role + ".zip")
        actual = sha(path)
        if actual != native_plan["inputs"][role]:
            raise ValueError("An original comparison archive changed: " + role)
        inputs[role] = {"path": str(path), **actual}
    selection = {"schema": "upstate.measurement-returned-review-receiving/v1",
        "application": str(app), "workspace": str(workspace), "original": str(original),
        "native_plan_id": native_plan["id"], "title": native_plan["title"],
        "inputs": inputs, "decisions": sha(decisions_path)}
    prior = output / "request-state.json"
    journal = read(prior) if prior.exists() else {"selection": selection, "tasks": {}}
    if journal["selection"] != selection:
        raise ValueError("This output already belongs to a different original receiving course")
    save(prior, journal)
    operation = "returned-review-" + hashlib.sha256(json.dumps(selection, sort_keys=True).encode()).hexdigest()[:32]
    sys.path[:0] = [str(app), str(app / "operator")]
    spec = importlib.util.spec_from_file_location("upstate_returned_receiving_server", app / "operator" / "server.py")
    server = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = server
    spec.loader.exec_module(server)
    operator = server.Operator(workspace, output / "operator-state", create=False)
    try:
        choices = run_node(node, app, output, "intakes",
            measurements=str(workspace / "measurement-observations"), inputs=inputs, operation=operation)
        catalog = operator.extensions.read("POST", "/api/measurement-returned-reviews/catalog",
            operator.primary, {"workspace": operator.primary})
        actual = {(v["kind"], v["id"]): v for v in catalog["archives"]}
        for role, choice in choices.items():
            row = actual[(choice["kind"], choice["id"])]
            if any(row[k] != choice[k] for k in choice):
                raise ValueError("Native archive catalog differs from original input " + role)
        plan_payload = {"title": native_plan["title"], **choices}
        plan_task = wait_task(operator, journal, output, "plan", "measurements.returned-review.plan", plan_payload, operation)
        plan_id = plan_task["result"]["id"]
        plan_view = operator.extensions.read("POST", "/api/measurement-returned-reviews/inspect",
            operator.primary, {"workspace": operator.primary, "kind": "plan", "id": plan_id})
        if plan_view["record"]["native_plan_id"] != native_plan["id"] or plan_view["record"]["counts"] != native_plan["counts"]:
            raise ValueError("Queued comparison differs from the complete original plan")
        plan_downloads = download(operator, plan_task, output / "comparison-downloads")
        bundle = next(x for x in plan_downloads if x["filename"] == "comparison.zip")
        members = {x["path"]: x for x in bundle["members"]}
        for role in inputs:
            if {k: members["inputs/" + role + ".zip"][k] for k in ("bytes", "sha256")} != native_plan["inputs"][role]:
                raise ValueError("Complete comparison lost an original input archive")
        for name in ("review.html", "changes.csv", "changes.jsonl", "plan.sqlite", "decisions-template.json"):
            if name not in members:
                raise ValueError("Original comparison handoff is incomplete: " + name)
        with decisions_path.open("rb") as stream:
            upload = operator.receive_upload(stream, selection["decisions"]["bytes"], "original-returned-review-decisions.json", "application/json")
        apply_payload = {"plan_id": plan_id, "decisions_upload_id": upload["id"]}
        apply_task = wait_task(operator, journal, output, "apply", "measurements.returned-review.apply", apply_payload, operation)
        result_id = apply_task["result"]["id"]
        view = operator.extensions.read("POST", "/api/measurement-returned-reviews/inspect",
            operator.primary, {"workspace": operator.primary, "kind": "result", "id": result_id})
        result = view["record"]
        if result["native_plan_id"] != native_plan["id"]:
            raise ValueError("Queued incorporation differs from the reviewed original plan")
        result_downloads = download(operator, apply_task, output / "result-downloads")
        native_directory = workspace / "measurement-returned-reviews" / "results" / result_id / "result"
        native = run_node(node, app, output, "receive-and-edit", operation=operation,
            currentArchive=inputs["current"]["path"], resultArchive=str(output / "result-downloads" / "project.zip"),
            editable=str(native_directory / "measurements"), recordCount=result["recordCount"], resultRevision=result["resultRevision"])
        # Exercise the provider's own completed-result reopening, not just queue deduplication.
        import measurement_returned_reviews_native as provider
        repeated = provider.apply(operator, operator.primary, apply_payload)
        if repeated["id"] != result_id:
            raise ValueError("Completed provider operation did not retain its identity")
        reopened = run_node(node, app, output, "verify-reopen", editable=str(native_directory / "measurements"))
        provider.verify_workspace(operator.ws(operator.primary))
        report = {"schema": selection["schema"], "complete": True, "selection": selection,
            "workspace_key": operator.primary, "plan_task": plan_task["id"], "apply_task": apply_task["id"],
            "plan_id": plan_id, "result_id": result_id, "native_plan_id": native_plan["id"],
            "counts": plan_view["record"]["counts"], "native": native, "reopen": reopened,
            "comparison_downloads": plan_downloads, "result_downloads": result_downloads,
            "inspection": "Every downloaded JSON/text and ZIP member opened; actual interactive desktop/narrow operation remains a separate permitted browser action."}
        save(output / "receiving-result.json", report)
        print(json.dumps({"complete": True, "result": str(output / "receiving-result.json"),
                          "records": native["records"], "plan_id": plan_id, "result_id": result_id}), flush=True)
    finally:
        operator.close()


if __name__ == "__main__":
    main()
