#!/usr/bin/env python3
"""Retain actual selected native-run histories, then restore and reopen their Workspace."""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath
import stat
import subprocess
import sys
import time
import zipfile

VERSION = "upstate.native-run-history-receiving/v1"
SOURCE_PATHS = (
    "model/native_run_history.py", "operator/native_run_history.py",
    "operator/extensions/native-run-history.json", "operator/web/native_run_history.mjs",
    "operator/web/run_workbench.mjs", "operator/web/journey.mjs",
    "CURRENT_OWNER_DIRECTION.md",
)
DOWNLOADS = {"index.html", "history.zip", "history.json", "runs.csv",
             "attempts.csv", "stages.csv", "MANIFEST.json"}


def source_identity(root):
    result = {}
    for name in SOURCE_PATHS:
        raw = (root / name).read_bytes()
        result[name] = {"bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest()}
    return result


def copy_ticket(operator, ticket, destination):
    """Read the actual authenticated retained file and publish its exact complete bytes."""
    destination = Path(destination)
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_name(destination.name + ".receiving")
    stream, item = operator.open_download(ticket["id"])
    count, checksum = 0, hashlib.sha256()
    try:
        with temporary.open("wb") as target:
            while True:
                block = stream.read(1024 * 1024)
                if not block:
                    break
                target.write(block)
                count += len(block)
                checksum.update(block)
    finally:
        stream.close()
    if (count, checksum.hexdigest()) != (ticket["bytes"], ticket["sha256"]):
        temporary.unlink(missing_ok=True)
        raise ValueError("The original download changed: " + ticket.get("filename", ticket["id"]))
    if destination.exists():
        previous = hashlib.sha256()
        with destination.open("rb") as retained:
            for block in iter(lambda: retained.read(1024 * 1024), b""):
                previous.update(block)
        if destination.stat().st_size != count or previous.hexdigest() != checksum.hexdigest():
            temporary.unlink(missing_ok=True)
            raise ValueError("The retained receiving output changed: " + str(destination))
        temporary.unlink()
    else:
        temporary.replace(destination)
    return {"path": str(destination), "bytes": count, "sha256": checksum.hexdigest(),
            "original_ticket_id": item["id"]}


def extract_history(archive, destination):
    """Extract only verified regular portable members, retaining the original hierarchy."""
    destination = Path(destination).resolve()
    destination.mkdir(parents=True, exist_ok=True)
    names = set()
    with zipfile.ZipFile(archive) as bundle:
        for member in bundle.infolist():
            name = PurePosixPath(member.filename)
            folded = member.filename.casefold()
            mode = member.external_attr >> 16
            if (name.is_absolute() or not name.parts or ".." in name.parts
                    or "\\" in member.filename or folded in names
                    or stat.S_ISLNK(mode) or member.is_dir()):
                raise ValueError("The retained history archive has an invalid member")
            names.add(folded)
            target = (destination / name).resolve()
            if not target.is_relative_to(destination):
                raise ValueError("The history member is outside its receiving directory")
            raw = bundle.read(member)
            target.parent.mkdir(parents=True, exist_ok=True)
            if target.exists() and target.read_bytes() != raw:
                raise ValueError("The previously extracted history member changed")
            if not target.exists():
                target.write_bytes(raw)
    return str(destination / "index.html")


COLD_REOPEN = r"""
import hashlib,json,sys
from pathlib import Path
application=Path(sys.argv[1]).resolve()
sys.path[:0]=[str(application/'operator'),str(application)]
from server import Operator
import native_run_history as service
from model import native_run_history as history
from model.common import verify_file
value=json.loads(sys.stdin.read())
operator=Operator(value['workspace'],value['state_directory'])
try:
    key=operator.primary
    ws=operator.ws(key)
    if ws.project['id']!=value['project_id']:
        raise ValueError('The copied application opened another original project')
    record=history.inspect(ws,value['history_id'])
    if record!=value['record']:
        raise ValueError('The copied application changed the saved history identity or files')
    shown=service.read(operator,key,'report',{'id':record['id']})
    downloads={}
    for ticket in shown['_downloads']:
        stream,item=operator.open_download(ticket['id'])
        checksum=hashlib.sha256(); count=0
        try:
            while True:
                block=stream.read(1024*1024)
                if not block:break
                checksum.update(block);count+=len(block)
        finally:stream.close()
        if (count,checksum.hexdigest())!=(ticket['bytes'],ticket['sha256']):
            raise ValueError('A copied-application download differs')
        downloads[ticket['member']]={'bytes':count,'sha256':checksum.hexdigest()}
    print(json.dumps({'project_id':ws.project['id'],'workspace_key':key,
       'history_id':record['id'],'selection':record['selection'],'summary':record['summary'],
       'downloads':downloads,'application':str(application),'workspace':str(ws.root)},sort_keys=True))
finally:
    operator.close()
"""


def receive(application, workspace, state_directory, output, *, title,
            run_ids=(), ensemble_id=None, expected_project_id=None, timeout=1800,
            resume_failed=False, refresh_preview=False):
    application = Path(application).resolve(strict=True)
    workspace = Path(workspace).resolve(strict=True)
    state_directory = Path(state_directory).resolve()
    output = Path(output).resolve()
    if output == workspace or output.is_relative_to(workspace):
        raise ValueError("Keep receiving exports outside the original Workspace")
    if state_directory == workspace or state_directory.is_relative_to(workspace):
        raise ValueError("Keep operator receiving state outside the Workspace being backed up")
    state_directory.mkdir(parents=True, exist_ok=True)
    output.mkdir(parents=True, exist_ok=True)
    sys.path[:0] = [str(application / "operator"), str(application)]
    from server import Operator
    import native_run_history as service
    from model import native_run_history as history
    from model.common import atomic_json, digest, now, verify_file

    journal_path = state_directory / "native-run-history-receiving.json"
    journal = json.loads(journal_path.read_text(encoding="utf-8")) if journal_path.is_file() else None
    operator = Operator(workspace, state_directory)
    try:
        key, ws = operator.primary, operator.ws(operator.primary)
        if expected_project_id and ws.project["id"] != expected_project_id:
            raise ValueError("Select the actual original project named for this receiving course")
        selected_ids = list(run_ids)
        if ensemble_id:
            if selected_ids:
                raise ValueError("Select the original ensemble or explicit ordered run IDs")
            plan = ws._get("ensembles", ensemble_id)
            selected_ids = list(dict.fromkeys(row["run_id"] for member in plan["members"]
                                             for row in member["runs"]))
        if not selected_ids:
            raise ValueError("Choose actual retained native runs or their original ensemble")
        selection = {"title": title, "run_ids": selected_ids}
        identity = {"schema": VERSION, "project_id": ws.project["id"],
                    "workspace": str(ws.root), "application": str(application),
                    "output": str(output), "ensemble_id": ensemble_id, "selection": selection}
        if journal and journal["identity"] != identity:
            raise ValueError("Use the same actual project, selected runs and receiving directories")
        journal = journal or {"identity": identity, "phases": {}, "source_revisions": [],
                              "superseded_history_attempts": []}

        def persist():
            atomic_json(journal_path, journal)

        current_source = source_identity(application)
        if not journal["source_revisions"] or journal["source_revisions"][-1]["files"] != current_source:
            journal["source_revisions"].append({"observed_at": now(), "files": current_source})
            persist()

        prior = journal["phases"].get("history")
        if refresh_preview and prior:
            task = operator.task(prior["task_id"])
            if task["state"] in {"queued", "running", "complete"}:
                raise ValueError("Reopen the original active or complete history task")
            frozen = ws.root / history.ROOT / prior["request"]["payload"]["expected_preview_id"] / "originals.json"
            if frozen.exists():
                raise ValueError("Resume this task's retained original snapshot with --resume-failed")
            journal["superseded_history_attempts"].append(prior)
            del journal["phases"]["history"]
            journal.pop("preview", None)
            persist()
        if "preview" not in journal:
            journal["preview"] = service.read(operator, key, "preview", {"selection": selection})
            persist()

        def complete(phase, action, payload):
            request = {"workspace": key, "action": action, "payload": payload}
            retained = journal["phases"].get(phase)
            if retained:
                if retained["request"] != request:
                    raise ValueError("The original receiving phase changed its saved request")
                task = operator.task(retained["task_id"])
            else:
                operation = "eco-native-history-" + digest({"identity": identity, "phase": phase,
                                                            "request": request})[:40]
                task = operator.submit(key, action, payload, operation)
                if any(task.get(name) != value for name, value in request.items()):
                    raise ValueError("The original queue returned a different receiving request")
                retained = {"request": request, "requested_operation_id": operation,
                            "accepted_operation_id": task["operation_id"], "task_id": task["id"]}
                journal["phases"][phase] = retained
                persist()
            if (any(task.get(name) != value for name, value in request.items())
                    or task["operation_id"] != retained["accepted_operation_id"]):
                raise ValueError("The retained task changed its accepted original identity")
            if task["state"] in {"failed", "interrupted", "cancelled", "canceled"}:
                if not resume_failed:
                    raise ValueError("Resume the original receiving task with --resume-failed: " + task["id"])
                task = operator.resume(task["id"])
            deadline = time.monotonic() + timeout
            while task["state"] in {"queued", "running"}:
                if time.monotonic() >= deadline:
                    raise TimeoutError("The original receiving task is still active: " + task["id"])
                time.sleep(.2)
                task = operator.task(task["id"])
            if task["state"] != "complete":
                raise RuntimeError(json.dumps(task, ensure_ascii=False))
            if "result" in retained and retained["result"] != task["result"]:
                raise ValueError("The completed receiving task changed its retained result")
            retained["result"] = task["result"]
            persist()
            return task

        saved = complete("history", "run.history.save",
                         {"selection": journal["preview"]["selection"],
                          "expected_preview_id": journal["preview"]["id"]})
        record = history.inspect(ws, saved["result"]["id"])
        shown = service.read(operator, key, "report", {"id": record["id"]})
        if {ticket["member"] for ticket in shown["_downloads"]} != DOWNLOADS:
            raise ValueError("The saved history lacks one of its complete ordinary downloads")
        downloads = {}
        for ticket in shown["_downloads"]:
            downloads[ticket["member"]] = copy_ticket(operator, ticket, output / ticket["member"])
        offline_html = extract_history(output / "history.zip", output / "history")
        for name, descriptor in record["files"].items():
            if name == "history.zip":
                continue
            retained_path = verify_file(ws.root / history.ROOT / record["id"], descriptor)
            received_path = output / "history" / name
            if not received_path.is_file() or received_path.read_bytes() != retained_path.read_bytes():
                raise ValueError("The extracted history differs from its original complete member: " + name)
        backup = complete("backup", "workspace.backup", {"include_intermediates": True})
        tickets = operator.task_view(backup["id"]).get("_downloads", [])
        if len(tickets) != 1:
            raise ValueError("The original complete Workspace backup has no unique retained download")
        archive = copy_ticket(operator, tickets[0], output / "complete-scientific-workspace.zip")
        stream, unused = operator.open_download(tickets[0]["id"])
        try:
            upload = operator.receive_upload(stream, tickets[0]["bytes"], tickets[0]["filename"],
                                             "application/zip")
        finally:
            stream.close()
        if (upload["bytes"], upload["sha256"]) != (archive["bytes"], archive["sha256"]):
            raise ValueError("The original backup upload differs from its retained archive")
        restored = complete("restore", "workspace.restore", {"upload_id": upload["id"]})
        received = restored["result"]
        restored_ws = operator.ws(received["workspace_key"])
        if restored_ws.project != ws.project or history.inspect(restored_ws, record["id"]) != record:
            raise ValueError("The complete Workspace restore changed the original project or history")
        restored_application = Path(received["application"]).resolve(strict=True)
        captured_sources = source_identity(restored_application)
        if "captured_application_sources" in journal and journal["captured_application_sources"] != captured_sources:
            raise ValueError("The retained backup changed its copied application source identity")
        journal["captured_application_sources"] = captured_sources
        persist()
        cold_input = {"workspace": str(restored_ws.root),
                      "state_directory": str(state_directory / "copied-application"),
                      "project_id": ws.project["id"], "history_id": record["id"], "record": record}
        result = {"schema": VERSION, "identity": identity, "history_id": record["id"],
                  "selection": record["selection"], "summary": record["summary"],
                  "captured_at": record["captured_at"], "downloads": downloads,
                  "offline_html": offline_html, "workspace_archive": archive,
                  "restored": received, "phases": journal["phases"],
                  "source_revisions": journal["source_revisions"],
                  "captured_application_sources": captured_sources,
                  "superseded_history_attempts": journal["superseded_history_attempts"],
                  "owner_direction": "CURRENT_OWNER_DIRECTION.md v2026-10-13.3",
                  "visual_review_targets": {
                      "desktop_and_narrow_html": offline_html,
                      "ordinary_native_run_desk": record["id"],
                      "restored_application": str(restored_application),
                      "attachments": sorted(downloads)}}
    finally:
        operator.close()

    completed = subprocess.run([sys.executable, "-c", COLD_REOPEN, str(restored_application)],
                               input=json.dumps(cold_input), text=True, capture_output=True,
                               cwd=restored_application, check=False)
    if completed.returncode:
        raise RuntimeError("Copied-application history reopening failed:\n" + completed.stderr)
    cold = json.loads(completed.stdout)
    expected = {name: {key: downloads[name][key] for key in ("bytes", "sha256")}
                for name in downloads}
    if cold["downloads"] != expected:
        raise ValueError("The copied application changed an original history download")
    result["copied_application"] = cold
    result["native_course_complete"] = True
    atomic_json(output / "native-run-history-receiving-result.json", result)
    return result


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--application", type=Path, required=True)
    parser.add_argument("--workspace", type=Path, required=True)
    parser.add_argument("--state-directory", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--title", required=True)
    parser.add_argument("--run-id", action="append", default=[])
    parser.add_argument("--ensemble-id")
    parser.add_argument("--expected-project-id")
    parser.add_argument("--timeout", type=float, default=1800)
    parser.add_argument("--resume-failed", action="store_true")
    parser.add_argument("--refresh-preview", action="store_true")
    args = parser.parse_args(argv)
    print(json.dumps(receive(args.application, args.workspace, args.state_directory, args.output,
                             title=args.title, run_ids=args.run_id, ensemble_id=args.ensemble_id,
                             expected_project_id=args.expected_project_id, timeout=args.timeout,
                             resume_failed=args.resume_failed, refresh_preview=args.refresh_preview),
                     ensure_ascii=False, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
