#!/usr/bin/env python3
"""Use the existing operator queue for one source-bound restoration extent study."""
from __future__ import annotations
import argparse
import json
from pathlib import Path
import re
import sys
import time

APP = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(APP))
sys.path.insert(0, str(Path(__file__).resolve().parent))
from model.common import atomic_json, canonical, digest, identifier, read_json
from rehearsal_cli import Client

ACTIONS = {"restoration-extent.prepare", "restoration-extent.report", "run.start", "workspace.backup"}


def selection(client, action, payload, operation_id):
    if action not in ACTIONS or not re.fullmatch(r"[A-Za-z0-9_-]{16,100}", operation_id or ""):
        raise ValueError("Select the exact original action and stable operation identity.")
    return {"workspace": client.workspace, "action": action,
            "payload": payload, "operation_id": operation_id}


def submit(client, request, journal):
    if (not isinstance(request, dict) or set(request) != {"workspace", "action", "payload", "operation_id"}
            or request["workspace"] != client.workspace):
        raise ValueError("Select a complete request for this original operator workspace.")
    selection(client, request["action"], request["payload"], request["operation_id"])
    journal = Path(journal).resolve()
    journal.mkdir(parents=True, exist_ok=True)
    key = digest({"workspace": client.workspace, "operation_id": request["operation_id"]})
    original = journal / (key + ".request.json")
    atomic_json(original, request, immutable=True)
    # Lost responses replay this exact request through original Operator.submit.
    value = client.json("/api/actions", request)
    if (value.get("workspace") != request["workspace"]
            or value.get("action") != request["action"]
            or value.get("payload") != request["payload"]
            or value.get("request_sha256") != digest({k: request[k] for k in ("workspace", "action", "payload")})):
        raise ValueError("The returned original task differs from the frozen request.")
    # The native server may bind this operation to an identical active task.
    # Retain its accepted identity; never replace the requested operation.
    identifier(value["id"])
    if not re.fullmatch(r"[A-Za-z0-9_-]{16,100}", value.get("operation_id", "")):
        raise ValueError("The accepted original task has no operation identity.")
    accepted_file = journal / (key + ".accepted.json")
    if accepted_file.exists():
        original = read_json(accepted_file)
        if any(original.get(k) != value.get(k) for k in
               ("id", "workspace", "operation_id", "action", "payload", "request_sha256")):
            raise ValueError("The original accepted task binding changed.")
    atomic_json(accepted_file, value)
    # POST returns the raw record; GET supplies the original download decorations.
    current = client.task(value["id"])
    if any(current.get(k) != value.get(k) for k in
           ("id", "workspace", "operation_id", "action", "payload", "request_sha256")):
        raise ValueError("The accepted task changed during original GET reconciliation.")
    atomic_json(journal / (key + ".reconciled.json"), current)
    return current


def wait_task(client, task, journal):
    while True:
        current = client.task(task["id"])
        if (current["id"] != task["id"] or current["operation_id"] != task["operation_id"]
                or current["workspace"] != client.workspace or current["action"] != task["action"]
                or current["payload"] != task["payload"]
                or current["request_sha256"] != task["request_sha256"]):
            raise ValueError("The retained task changed from its exact original selection.")
        atomic_json(Path(journal) / (task["id"] + ".current.json"), current)
        if current["state"] == "complete":
            return current
        if current["state"] not in {"queued", "running"}:
            raise RuntimeError("Original task " + current["id"] + " is " + current["state"] +
                               "; retain its error and explicitly resume that task.")
        time.sleep(2)


def run_study(client, study_id, journal, operation_id):
    value = client.query("/api/restoration-extents/inspect", id=identifier(study_id))
    original = {"workspace": client.workspace, "study_id": study_id,
                "record": value["record"], "operation_id": operation_id}
    atomic_json(Path(journal) / (operation_id + ".study-selection.json"), original, immutable=True)
    run_ids = value["record"]["execution_run_ids"]
    if (not isinstance(run_ids, list) or not run_ids
            or len(run_ids) != len(set(run_ids))
            or value["record"]["spec"]["baseline_run_id"] not in run_ids):
        raise ValueError("The retained original execution selection is incomplete.")
    for run_id in run_ids:
        identifier(run_id)
    results = []
    for run_id in run_ids:
        run = client.query("/api/item", kind="runs", id=run_id)
        if run["state"] == "complete":
            results.append({"run_id": run_id, "state": "complete", "reused_completed_run": True})
            continue
        request = selection(client, "run.start", {"run_id": run_id},
                            "extent-" + digest({"operation": operation_id, "study": study_id, "run": run_id}))
        task = submit(client, request, journal)
        result = wait_task(client, task, journal)
        results.append({"run_id": run_id, "task": result, "reused_completed_run": False})
    return {"study_id": study_id, "runs": results}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--connection", type=Path, required=True)
    parser.add_argument("--workspace")
    parser.add_argument("--journal", type=Path, required=True)
    parser.add_argument("--output", type=Path)
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("catalog")
    inspect = sub.add_parser("inspect"); inspect.add_argument("--id", required=True)
    prepare = sub.add_parser("prepare")
    prepare.add_argument("--spec", type=Path, required=True)
    prepare.add_argument("--operation-id", required=True); prepare.add_argument("--wait", action="store_true")
    report = sub.add_parser("report")
    report.add_argument("--id", required=True); report.add_argument("--operation-id", required=True)
    report.add_argument("--wait", action="store_true")
    runs = sub.add_parser("run-study")
    runs.add_argument("--id", required=True); runs.add_argument("--operation-id", required=True)
    send = sub.add_parser("submit"); send.add_argument("--request", type=Path, required=True)
    send.add_argument("--wait", action="store_true")
    status = sub.add_parser("task"); status.add_argument("--id", required=True)
    resume = sub.add_parser("resume"); resume.add_argument("--id", required=True)
    resume.add_argument("--wait", action="store_true")
    export = sub.add_parser("download"); export.add_argument("--study", required=True)
    export.add_argument("--member", required=True); export.add_argument("--out", type=Path, required=True)
    args = parser.parse_args(argv)
    client = Client(args.connection)
    if args.workspace:
        client.workspace = identifier(args.workspace)
    journal = args.journal.resolve(); journal.mkdir(parents=True, exist_ok=True)
    if args.command == "catalog":
        value = client.query("/api/restoration-extents/catalog")
    elif args.command == "inspect":
        value = client.query("/api/restoration-extents/inspect", id=identifier(args.id))
    elif args.command == "run-study":
        if not re.fullmatch(r"[A-Za-z0-9_-]{16,100}", args.operation_id):
            raise ValueError("Supply the stable original native-course operation ID.")
        value = run_study(client, identifier(args.id), journal, args.operation_id)
    elif args.command == "task":
        value = client.task(identifier(args.id))
        if value["workspace"] != client.workspace or value["action"] not in ACTIONS:
            raise ValueError("Choose an original extent/native task in this workspace.")
    elif args.command == "resume":
        original = client.task(identifier(args.id))
        if original["workspace"] != client.workspace or original["action"] not in ACTIONS:
            raise ValueError("Choose an original extent/native task in this workspace.")
        atomic_json(journal / (original["id"] + ".before-resume.json"), original)
        value = client.json("/api/task/resume", {"id": original["id"]})
        if any(value.get(k) != original.get(k) for k in
               ("id", "workspace", "operation_id", "action", "payload", "request_sha256")):
            raise ValueError("Original resume returned another retained task.")
        current = client.task(original["id"])
        if any(current.get(k) != original.get(k) for k in
               ("id", "workspace", "operation_id", "action", "payload", "request_sha256")):
            raise ValueError("The resumed original task changed during GET reconciliation.")
        value = current
        if args.wait:
            value = wait_task(client, value, journal)
    elif args.command == "download":
        report = client.query("/api/restoration-extents/report", id=identifier(args.study))["report"]
        if report is None:
            raise ValueError("Build the selected response report through its original queue first.")
        selected = [row for row in report["_downloads"]
                    if args.member in (row.get("artifact_id"), row["id"], row["filename"])]
        if len(selected) != 1:
            raise ValueError("Select one exact original report member.")
        value = client.download(selected[0], args.out)
    else:
        if args.command == "prepare":
            spec = read_json(args.spec)
            request = selection(client, "restoration-extent.prepare", {"spec": spec}, args.operation_id)
        elif args.command == "report":
            request = selection(client, "restoration-extent.report", {"study_id": identifier(args.id)}, args.operation_id)
        else:
            request = read_json(args.request)
        value = submit(client, request, journal)
        if args.wait:
            value = wait_task(client, value, journal)
    if args.output:
        atomic_json(args.output, value)
    print(json.dumps(value, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
