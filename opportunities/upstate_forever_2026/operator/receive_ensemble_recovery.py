"""Receive one original saved ensemble through operator restart and final results.

Run at the existing operator owner's closed-source boundary, with that owner's
same scientific Workspace, operator-state directory and native Python. This
uses the existing Operator/NativeJobs and does not create another model engine.
"""
from __future__ import annotations
import argparse
import contextlib
import json
from pathlib import Path
import sys
import time

APPLICATION = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(APPLICATION), str(APPLICATION / "operator")]
from model.common import atomic_json, digest, identifier, read_json, verify_file
from model.ensemble_native import retained_plan, run_ids
from model.ensembles import Ensembles
from model.workspace import Workspace
from server import Operator


def receive(workspace, state_directory, ensemble_id, operation_id, directory):
    workspace, state_directory, directory = (Path(value).resolve()
                                             for value in (workspace, state_directory, directory))
    if (directory.is_relative_to(workspace) or directory.is_relative_to(state_directory)
            or directory.is_relative_to(APPLICATION)):
        raise ValueError("Keep receiving outputs outside application, Workspace and operator state")
    directory.mkdir(parents=True, exist_ok=True)
    journal_path = directory / "ensemble-recovery.json"
    chosen = {"workspace": str(workspace), "operator_state": str(state_directory),
              "ensemble_id": identifier(ensemble_id), "operation_id": operation_id}
    old = read_json(journal_path) if journal_path.exists() else None
    if old and old["selection"] != chosen:
        raise ValueError("This receiving directory already belongs to another original selection")
    journal = old or {"schema": "upstate.ensemble-recovery-receiving/v1",
                      "selection": chosen, "restart_requested": False}
    original = Workspace(workspace)
    plan = retained_plan(original, ensemble_id)
    if journal.get("plan_sha256", digest(plan)) != digest(plan):
        raise ValueError("The original complete ensemble plan changed")
    journal["plan_sha256"] = digest(plan)
    journal.setdefault("previously_complete", {
        run_id: original.inspect_run(run_id)
        for run_id in run_ids(plan) if original.inspect_run(run_id)["state"] == "complete"
    })
    atomic_json(journal_path, journal)
    app = None
    try:
        app = Operator(workspace, state_directory)
        task = app.submit(app.primary, "ensemble.run",
                          {"ensemble_id": ensemble_id, "continue_on_error": True},
                          operation_id)
        if journal.get("task_id", task["id"]) != task["id"]:
            raise ValueError("The saved ensemble task identity changed")
        journal["task_id"] = task["id"]
        atomic_json(journal_path, journal)
        if task["state"] in {"interrupted", "failed", "cancelled"}:
            app.resume(task["id"])
        while True:
            task = app.task(task["id"])
            current = app.native_jobs.snapshot(dict(task))
            if (current.get("alive") and not journal["restart_requested"]):
                journal.update(restart_requested=True, original_execution={
                    "run_id": current["run_id"], "execution_id": current["execution_id"],
                    "ensemble_context": current["ensemble_context"],
                    "worker": current["worker"],
                })
                atomic_json(journal_path, journal)
                # close() detaches that original worker, then releases this
                # original operator-state lock. The same app can reopen it.
                app.close()
                app = None
                app = Operator(workspace, state_directory)
                resumed = app.resume(task["id"])
                if resumed["id"] != journal["task_id"]:
                    raise ValueError("Restart created another ensemble task")
                journal["operator_reopened"] = True
                atomic_json(journal_path, journal)
                continue
            if task["state"] == "complete":
                break
            if task["state"] in {"failed", "cancelled", "interrupted"}:
                journal["task"] = app.task_view(task["id"])
                atomic_json(journal_path, journal)
                raise RuntimeError("The original ensemble retained its actual failure: "
                                   + json.dumps(task.get("error"), ensure_ascii=False))
            time.sleep(0.4)

        result = Ensembles(app.ws(app.primary)).inspect(ensemble_id)
        if result["state"] != "complete":
            raise ValueError("The original saved ensemble is not complete")
        for run_id, before in journal["previously_complete"].items():
            after = app.ws(app.primary).inspect_run(run_id)
            if after != before:
                raise ValueError("A previously completed original native run changed: " + run_id)
        records = {run_id: app.ws(app.primary).run(run_id) for run_id in run_ids(plan)}
        for run_id, record in records.items():
            for item in record.get("artifacts", {}).values():
                verify_file(workspace / "runs" / run_id, item)
        original_execution = journal.get("original_execution")
        if original_execution:
            folder = (workspace / "runs" / original_execution["run_id"]
                      / "supervision" / original_execution["execution_id"])
            request = read_json(folder / "request.json")
            if request["ensemble_context"] != original_execution["ensemble_context"]:
                raise ValueError("The restarted worker changed its original ensemble binding")
            reconnected_path = folder / "reconnected.json"
            journal["reconnected"] = (read_json(reconnected_path)
                                       if reconnected_path.exists() else None)
            if journal["reconnected"] and journal["reconnected"]["task_id"] != task["id"]:
                raise ValueError("The original worker was reconnected by another task")
            receipts = {}
            for name in ("result.json", "failure.json", "supervision.json", "finished.json"):
                path = folder / name
                if path.exists():
                    receipts[name] = read_json(path)
            journal["original_worker_receipts"] = receipts
            journal["original_worker_result"] = receipts.get("result.json")
            journal["original_worker_result_available"] = "result.json" in receipts
            journal["original_completed_run"] = records[original_execution["run_id"]]
        # Use the original report writer and its full original downloadable files.
        report_operation = operation_id + "-report"
        if len(report_operation) > 100:
            report_operation = "ensemble-report-" + digest(chosen)
        report = app.submit(app.primary, "ensemble.report",
                            {"ensemble_id": ensemble_id}, report_operation)
        if report["state"] in {"failed", "cancelled", "interrupted"}:
            app.resume(report["id"])
        while True:
            report = app.task(report["id"])
            if report["state"] == "complete":
                break
            if report["state"] in {"failed", "cancelled", "interrupted"}:
                raise RuntimeError("The retained native report needs recovery: "
                                   + json.dumps(report.get("error"), ensure_ascii=False))
            time.sleep(0.4)
        recovery_observed = bool(journal.get("operator_reopened")
                                 and journal.get("reconnected"))
        journal.update(state="complete", task=app.task_view(task["id"]),
                       ensemble=result, runs=records, report_task=app.task_view(report["id"]),
                       recovery_observed=recovery_observed,
                       recovery_note=("Original worker reconnected after operator restart"
                                      if recovery_observed else
                                      "Original results received; no complete restart/reconnection "
                                      "was retained before the selected cases finished"))
        atomic_json(journal_path, journal)
        atomic_json(directory / "original-ensemble.json", plan, immutable=True)
        atomic_json(directory / "original-run-results.json", records)
        return journal
    finally:
        if app is not None:
            app.close()


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", required=True)
    parser.add_argument("--operator-state", required=True)
    parser.add_argument("--ensemble-id", required=True)
    parser.add_argument("--operation-id", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args(argv)
    result = receive(args.workspace, args.operator_state, args.ensemble_id,
                     args.operation_id, args.output)
    print(json.dumps({"state": result["state"], "task_id": result["task_id"],
                      "recovery_observed": result["recovery_observed"],
                      "output": str(Path(args.output).resolve())}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
