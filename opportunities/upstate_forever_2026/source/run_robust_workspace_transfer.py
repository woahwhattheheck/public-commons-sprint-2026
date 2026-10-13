#!/usr/bin/env python3
"""Run one original-operator decision workflow and complete workspace transfer.

Run from a fully assembled application with the original OPT12 dependencies.
The retained arithmetic fixture verifies decision-workspace mechanics; callers
may select an existing complete study JSON using --study. Outputs remain in a
new, explicit directory for the receiving operator to reopen.
"""
from __future__ import annotations

import argparse
from copy import deepcopy
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import sys
import time

APP = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(APP), str(APP / "operator")]

from model.common import atomic_json, digest, held
from model.robust_decisions.eco_robust.integration import dispatch
from model.robust_decisions.eco_robust.operations import DecisionWorkspace


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--study", type=Path,
                        default=APP / "model/robust_decisions/examples/arithmetic-study.json")
    args = parser.parse_args()
    out = args.output.resolve()
    out.mkdir(parents=True, exist_ok=False)
    study = json.loads(args.study.read_text(encoding="utf-8"))
    spec = importlib.util.spec_from_file_location("upstate_native_operator", APP / "operator/server.py")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    operator = module.Operator(out / "workspace", out / "operator-state",
                               create=True, title="Decision-study transfer workflow")
    retained_tasks = []
    original = operator.ws(operator.primary)

    def action(name, payload, operation_id):
        initial = operator.submit(operator.primary, name, payload, operation_id)
        deadline = time.monotonic() + 240
        while True:
            task = operator.task_view(initial["id"])
            if task["state"] == "complete":
                retained_tasks.append(task)
                return task
            if task["state"] in {"failed", "interrupted", "cancelled"}:
                raise RuntimeError(json.dumps(task.get("error") or task))
            if time.monotonic() >= deadline:
                raise TimeoutError("Original queued operation did not finish: " + name)
            time.sleep(0.1)

    def native_retry(task):
        # This reaches the SQL commit/queue-response gap. Re-submitting a
        # completed original queue task alone would only exercise its cache.
        with held(original.root / ".workspace.lock"):
            return dispatch(original, task["action"], task["payload"],
                            operation_id=task["id"])

    def download(task):
        tickets = task.get("_downloads") or []
        require(bool(tickets), "Completed native export needs its retained file ticket")
        rows = []
        for ticket in tickets:
            stream, record = operator.open_download(ticket["id"])
            try:
                data = stream.read()
            finally:
                stream.close()
            require(len(data) == record["bytes"] and
                    hashlib.sha256(data).hexdigest() == record["sha256"],
                    "The original file transport returned different bytes")
            rows.append((record, data))
        return rows

    try:
        registration = operator.extensions.manifest()
        desk = next((item for item in registration["extensions"]
                     if item["id"] == "robust-workbench"), None)
        require(desk is not None and
                desk.get("client", {}).get("view", {}).get("id") == "robust-workbench" and
                operator.extensions.has_route("GET", "/api/robust-workbench/catalog") and
                operator.extensions.has_route("GET", "/api/robust-workbench/study"),
                "Install the complete robust-workbench owner and retire the original robust-decisions descriptor")
        require("robust.solve" in desk["actions"] and
                not any(item["id"] != "robust-workbench" and
                        any(action.startswith("robust.") for action in item["actions"])
                        for item in registration["extensions"]),
                "Each native robust action must have the single Decision studies owner")
        initial_catalog = operator.extensions.read(
            "GET", "/api/robust-workbench/catalog", operator.primary, {})
        require(initial_catalog["workspace_key"] == operator.primary,
                "The registered Decision studies route did not open the original workspace")
        create = action("robust.study.create", {"study": study}, "robust_transfer_create_01")
        sid = create["result"]["id"]
        require(native_retry(create)["id"] == sid, "Native creation replay changed study ID")
        changed = deepcopy(create["result"]["study"])
        changed["title"] += " — retained revision"
        revise = action("robust.study.revise",
                        {"study_id": sid, "study": changed, "expected_revision": 1},
                        "robust_transfer_revise_01")
        revision = revise["result"]["revision"]
        require(revision == 2 and native_retry(revise)["revision"] == revision,
                "Native revision replay advanced the immutable study twice")
        solve = action("robust.solve",
                       {"study_id": sid, "revision": revision, "objective": "worst_case", "time_limit": 60},
                       "robust_transfer_solve_01")
        run_id = solve["result"]["run_id"]
        require(native_retry(solve)["run_id"] == run_id,
                "Completed native calculation replay changed run ID")
        selection = action("robust.selection.export", {"study_id": sid, "run_id": run_id},
                           "robust_transfer_selection_01")
        report = action("robust.report.export", {"study_id": sid, "run_id": run_id, "format": "html"},
                        "robust_transfer_report_01")
        project = action("robust.project.export", {"study_id": sid}, "robust_transfer_project_01")
        for task in (selection, report, project):
            download(task)
        project_bytes = download(project)[0][1]
        uploaded = operator.receive_upload(io.BytesIO(project_bytes), len(project_bytes),
                                           "decision-project.json", "application/json")
        received = action("robust.project.receive", {"upload_id": uploaded["id"]},
                          "robust_transfer_receive_01")
        require(received["result"]["id"] != sid and received["result"]["revision"] == revision,
                "The native project receiver did not preserve independent study history")
        # Native dispatch accepts the original complete project, while the main
        # provider resolves upload IDs before invoking it.
        with held(original.root / ".workspace.lock"):
            replay = dispatch(original, "robust.project.receive",
                              {"project": json.loads(project_bytes)},
                              operation_id=received["id"])
        require(replay["id"] == received["result"]["id"],
                "Native project receive replay duplicated the received study")
        before = DecisionWorkspace(original).store.export(sid)
        before_binding = {}
        with DecisionWorkspace(original).store.connect() as db:
            before_binding = {row["operation_id"]: dict(row)
                              for row in db.execute("SELECT * FROM operator_operations")}
        backup = action("workspace.backup", {"include_intermediates": True},
                        "robust_transfer_backup_01")
        archive = download(backup)[0][1]
        original_upload = operator.receive_upload(io.BytesIO(archive), len(archive),
                                                 "scientific-workspace.zip", "application/zip")
        restore = action("workspace.restore", {"upload_id": original_upload["id"]},
                         "robust_transfer_restore_01")
        restored_key = restore["result"]["workspace_key"]
        restored = operator.ws(restored_key)
        restored_database = restored.root / "robust_decisions/robust_decisions.sqlite3"
        archived_database_sha = hashlib.sha256(restored_database.read_bytes()).hexdigest()
        operator.extensions.verify_workspace(restored)
        require(hashlib.sha256(restored_database.read_bytes()).hexdigest() == archived_database_sha,
                "Restore verification changed the archived native SQLite database")
        # The original restore action must tolerate a retry after publishing its
        # receive directory but before saving its final queue response.
        replay_restore = operator._invoke(restore)
        require(replay_restore["workspace_key"] == restored_key,
                "Original receiving retry changed the restored workspace")
        after = DecisionWorkspace(restored).store.export(sid)
        require(after == before, "Full workspace restore changed native study/run/configuration history")
        with DecisionWorkspace(restored).store.connect() as db:
            after_binding = {row["operation_id"]: dict(row)
                             for row in db.execute("SELECT * FROM operator_operations")}
        require(after_binding == before_binding,
                "Full workspace restore changed native operation identities")
        reopened = operator.extensions.read("GET", "/api/robust-workbench/study",
                                             restored_key, {"study_id": sid, "revision": revision})
        require(len(reopened.get("_downloads", [])) == 3,
                "Restored study must expose its original three export files without the old task queue")
        for ticket in reopened["_downloads"]:
            stream, record = operator.open_download(ticket["id"])
            try:
                require(hashlib.sha256(stream.read()).hexdigest() == record["sha256"],
                        "A restored study export ticket differs from its retained file")
            finally:
                stream.close()
        outcome = {
            "schema": "upstate.robust-operator-transfer-workflow/v1",
            "study_input": str(args.study.resolve()), "study_input_sha256": digest(study),
            "study_id": sid, "revision": revision, "run_id": run_id,
            "native_result": solve["result"]["answer"],
            "received_study_id": received["result"]["id"],
            "restored_workspace": str(restored.root),
            "restored_workspace_key": restored_key,
            "original_project_sha256": before["sha256"],
            "restored_project_sha256": after["sha256"],
            "operation_bindings": len(after_binding),
            "restored_exports": reopened["_downloads"],
            "tasks": [{"id": row["id"], "action": row["action"], "state": row["state"]}
                      for row in retained_tasks],
        }
        atomic_json(out / "decision-transfer.json", outcome, immutable=True)
        print(json.dumps(outcome, indent=2))
    finally:
        operator.close()


if __name__ == "__main__":
    main()
