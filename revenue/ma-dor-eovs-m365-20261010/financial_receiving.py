#!/usr/bin/env python3
"""Run a complete operator-supplied financial plan and two editable receivers.

All source files and customer decisions are supplied explicitly. This command
does not invent customer records, contact a vendor, or execute a workbook.
"""
from __future__ import annotations
import argparse
import hashlib
import io
import json
from pathlib import Path
import sys
from migration_store import MigrationError, canonical, identity, parse_json, file_hash, identifier, regular
from migration_workspace import MigrationWorkspace
from migration_portable import PortableService, receive_delivery, inspect_delivery, publish_bytes, ordinary_directory, canonical as encoded
import financial_workspace as finance
from financial_domain import require, strict_object

SCHEMA = "commons.financial-operating-plan/v1"

def read_original(path, sha=None, size=None):
    path = Path(path).expanduser().absolute()
    regular(path)
    with path.open("rb") as stream:
        actual = file_hash(stream)
        require((sha is None or actual["sha256"] == sha) and (size is None or actual["bytes"] == size),
                "FINANCE_PLAN_FILE", "Original input identity differs.", path=str(path))
        raw = stream.read()
    return raw, actual

def validate_plan(value):
    strict_object(value, ("schema", "id", "title", "actor", "receiving_actor", "files", "steps", "receiving_steps"))
    require(value["schema"] == SCHEMA, "FINANCE_PLAN_SCHEMA", "Use the complete financial operating plan.")
    identifier(value["id"], "plan id")
    require(value["actor"] != value["receiving_actor"], "FINANCE_RECEIVER", "Name the actual independent operator.")
    names = set()
    for f in value["files"]:
        strict_object(f, ("key", "path", "sha256", "bytes", "filename"), ("purpose",))
        identifier(f["key"]); require(f["key"] not in names, "FINANCE_PLAN_FILE", "Original file key repeats.")
        names.add(f["key"])
    require(value["steps"] and value["receiving_steps"], "FINANCE_PLAN_STEPS", "Retain the complete source and later recipient-edit course.")
    keys = set()
    for phase in ("steps", "receiving_steps"):
        for step in value[phase]:
            strict_object(step, ("key", "operation", "payload"))
            identifier(step["key"]); require(step["key"] not in keys, "FINANCE_STEP", "Step key repeats.")
            keys.add(step["key"])
            require(step["operation"] in finance.MUTATIONS, "FINANCE_STEP_OPERATION", "Use an advertised original financial mutation.")
            require(isinstance(step["payload"], dict) and not set(step["payload"]) & {"actor", "expected_revision", "operation_id"},
                    "FINANCE_STEP_ENVELOPE", "The same original programme owns its request envelope.")
    return value

def resolve(value, files, records):
    if isinstance(value, list): return [resolve(x, files, records) for x in value]
    if not isinstance(value, dict): return value
    if set(value) == {"$file"}:
        f = files[value["$file"]]
        return {k: f[k] for k in ("sha256", "filename", "purpose") if k in f}
    if set(value) == {"$sha"}: return files[value["$sha"]]["sha256"]
    if set(value) == {"$record"}: return records[value["$record"]]["id"]
    return {key: resolve(v, files, records) for key, v in value.items()}

def original_operation(workspace, operation, payload, *, resume):
    old = workspace._operation(payload["operation_id"], required=False)
    if old:
        semantic = {k: v for k, v in payload.items() if k not in ("operation_id", "expected_revision")}
        require(old["operation"] == operation and old["request_sha256"] == identity({"operation": operation, "payload": semantic}),
                "FINANCE_PLAN_CONTINUITY", "The original step is bound to different source or decisions.")
        if old["status"] == "SUCCEEDED":
            return old["result"]["result"]
        require(resume, "FINANCE_PLAN_RESUME", "Explicitly resume this original interrupted local operation.", operation_id=old["id"])
        value = workspace.resume_original(old["id"], actor=payload["actor"],
                    reason="Explicit continuation of the complete retained financial plan.",
                    expected_revision=workspace.project["revision"], handler=workspace._handler(operation))
        return value["result"]
    return workspace.dispatch(operation, payload)["result"]

def run_steps(workspace, plan, steps, files, records, phase, *, resume):
    for step in steps:
        payload = resolve(step["payload"], files, records)
        payload.update(operation_id="fin-" + identity({"plan": plan["id"], "phase": phase, "step": step["key"]})[:50],
                       expected_revision=workspace.project["revision"],
                       actor=plan["actor"] if phase == "original" else plan["receiving_actor"])
        result = original_operation(workspace, step["operation"], payload, resume=resume)
        records[step["key"]] = result
        print(canonical({"event": "financial_step", "phase": phase, "key": step["key"], "id": result["id"],
                         "workspace_id": workspace.project["id"], "revision": workspace.project["revision"]}), flush=True)

def prepare(workspace, source_root, plan, phase, *, resume):
    service = PortableService(workspace, workspace.root, source_root)
    op_id = "fin-delivery-" + identity({"plan": plan["id"], "phase": phase})[:45]
    payload = {"operation_id": op_id, "expected_revision": workspace.project["revision"],
               "actor": plan["actor"] if phase == "original" else plan["receiving_actor"],
               "title": plan["title"] + " — " + phase,
               "note": "Complete original financial source, editable definitions, calculation, review and application."}
    result = original_operation(workspace, "delivery.prepare", payload, resume=resume)
    record, stream = service.open_delivery(result["id"])
    stream.close()
    return record

def run(plan_path, workspace_path, output, *, create=False, resume=False):
    raw_plan, plan_identity = read_original(plan_path)
    plan = validate_plan(parse_json(raw_plan.decode("utf-8")))
    output = Path(output).expanduser().absolute()
    ordinary_directory(output, create=True)
    intent = {"schema": "commons.financial-programme-intent/v1", "plan": plan_identity,
              "plan_id": plan["id"], "workspace": str(Path(workspace_path).absolute())}
    publish_bytes(output / "intent.json", encoded(intent))
    publish_bytes(output / "original-plan.json", raw_plan)
    complete = output / "COMPLETE.json"
    if complete.exists():
        result = parse_json(complete.read_text())
        require(result["intent"] == intent, "FINANCE_PROGRAMME_IDENTITY", "Completed original plan differs.")
        # Completed replay verifies retained archives and reopens current editable
        # recipients without overwriting their later source or review editions.
        for entry in result["archives"]:
            _, actual = read_original(entry["path"], entry["sha256"], entry["bytes"])
            inspect_delivery(entry["path"])
        with MigrationWorkspace(result["second_receiver"]["workspace"]) as current:
            require(current.project["id"] == result["workspace_id"], "FINANCE_PROGRAMME_WORKSPACE", "Received workspace identity changed.")
            finance.verify(current)
        return {**result, "reused": True, "later_edits_preserved": True}
    files, records = {}, {}
    source_root = Path(__file__).parent
    workspace_path = Path(workspace_path).expanduser().absolute()
    exists = (workspace_path / "workspace.sqlite3").exists()
    require(exists or create, "FINANCE_PROGRAMME_WORKSPACE", "Select the existing workspace or explicitly create a new original workspace.")
    with MigrationWorkspace(workspace_path, create=not exists, title=plan["title"]) as workspace:
        original_workspace_id = workspace.project["id"]
        workspace.stage_file(io.BytesIO(raw_plan), "financial-original-plan.json", expected_bytes=len(raw_plan))
        for f in plan["files"]:
            raw, actual = read_original(f["path"], f["sha256"], f["bytes"])
            staged = workspace.stage_file(io.BytesIO(raw), f["filename"], expected_sha256=f["sha256"], expected_bytes=f["bytes"])
            files[f["key"]] = {**staged, "purpose": f.get("purpose", "evidence")}
        run_steps(workspace, plan, plan["steps"], files, records, "original", resume=resume)
        first_verification = finance.verify(workspace)
        first = prepare(workspace, source_root, plan, "original", resume=resume)
        first_archive = workspace.root / first["relative_path"]
        first_path = output / first["filename"]
        from migration_portable import capture_file
        first_ref = capture_file(first_archive, first_path, first_path.name,
                                 expected={"path": first_path.name, "sha256": first["archive_sha256"], "bytes": first["archive_bytes"]})
    first_received = receive_delivery(first_path, output / "receiver-one")
    with MigrationWorkspace(first_received["workspace"]) as receiver:
        require(receiver.project["id"] == original_workspace_id, "FINANCE_RECEIVING_ID", "Receiver changed original workspace identity.")
        finance.verify(receiver)
        # Original record aliases are immutable IDs and remain present in the same snapshot.
        run_steps(receiver, plan, plan["receiving_steps"], files, records, "receiving", resume=resume)
        second_verification = finance.verify(receiver)
        second = prepare(receiver, source_root, plan, "receiving", resume=resume)
        second_archive = receiver.root / second["relative_path"]
        second_path = output / second["filename"]
        second_ref = capture_file(second_archive, second_path, second_path.name,
                                  expected={"path": second_path.name, "sha256": second["archive_sha256"], "bytes": second["archive_bytes"]})
    second_received = receive_delivery(second_path, output / "receiver-two")
    with MigrationWorkspace(second_received["workspace"]) as final:
        third_verification = finance.verify(final)
        require(final.project["id"] == original_workspace_id, "FINANCE_RECEIVING_ID", "Second receiver changed original identity.")
    result = {"schema": "commons.financial-programme-result/v1", "intent": intent, "workspace_id": original_workspace_id,
              "records": {key: {"id": value["id"], "kind": value["kind"]} for key, value in records.items()},
              "first_receiver": first_received, "second_receiver": second_received,
              "verifications": [first_verification, second_verification, third_verification],
              "archives": [{"path": str(first_path), "sha256": first_ref["sha256"], "bytes": first_ref["bytes"]},
                           {"path": str(second_path), "sha256": second_ref["sha256"], "bytes": second_ref["bytes"]}],
              "tenant_calls": 0, "vendor_workbooks_executed": 0,
              "meaning": "Actual supplied local engineering plan and independent editable receivers. Customer acceptance remains its supplied original evidence."}
    publish_bytes(complete, encoded(result))
    return result

def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--plan", required=True); parser.add_argument("--workspace", required=True)
    parser.add_argument("--output", required=True); parser.add_argument("--create", action="store_true")
    parser.add_argument("--resume", action="store_true")
    args = parser.parse_args(argv)
    try:
        value = run(args.plan, args.workspace, args.output, create=args.create, resume=args.resume)
        print(canonical(value))
        return 0
    except Exception as error:
        print(canonical({"error": getattr(error, "code", type(error).__name__), "message": str(error)}), file=sys.stderr)
        return 2

if __name__ == "__main__":
    raise SystemExit(main())
