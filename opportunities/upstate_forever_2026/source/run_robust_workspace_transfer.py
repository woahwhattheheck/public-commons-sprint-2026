#!/usr/bin/env python3
"""Run one original-operator decision workflow and complete workspace transfer.

Run from a fully assembled application with the original OPT12 dependencies.
The retained arithmetic fixture verifies decision-workspace mechanics; callers
may select an existing complete study JSON using --study. The --workspace mode
continues actual completed native runs and a saved Decision calculation through
the original map/client release, selected-study archive and registered restore.
It retains explicit source adoption and resumes the same queued operation.
Outputs remain in an explicit directory for the receiving operator to reopen.
"""
from __future__ import annotations

import argparse
from copy import deepcopy
import hashlib
import importlib.util
import io
import json
import os
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


def _load_operator():
    spec = importlib.util.spec_from_file_location("upstate_native_operator", APP / "operator/server.py")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def _original_json(path):
    if path is None:
        return None
    value = json.loads(Path(path).read_text(encoding="utf-8-sig"))
    require(isinstance(value, dict), "Select an original JSON object: " + str(path))
    return value


def _file_identity(path):
    path = Path(path)
    h = hashlib.sha256()
    size = 0
    with path.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            size += len(block)
            h.update(block)
    return {"bytes": size, "sha256": h.hexdigest()}


def _native_receiving(args):
    """Continue retained scientific work through the original registered operator."""
    require(args.study_id and args.run_id and args.delivery_profile,
            "Native receiving needs --study-id, --run-id and an explicit --delivery-profile.")
    require(bool(args.delivery_id) != bool(args.delivery_selection),
            "Choose one completed --delivery-id or an original --delivery-selection JSON.")
    require(args.delivery_point is None or args.delivery_point >= 0,
            "Use the exact nonnegative saved frontier point index.")
    require(args.timeout > 0 and args.upload_limit_gib > 0,
            "Choose positive queue timeout and upload capacity.")
    source_root, out = args.workspace.resolve(), args.output.resolve()
    require(not out.is_relative_to(source_root) and not source_root.is_relative_to(out),
            "Keep receiving output and the original Workspace in separate directory trees.")
    if out.exists():
        require(args.resume and out.is_dir(), "Use --resume for this retained receiving operation.")
    else:
        require(not args.resume, "The requested receiving operation has no retained output directory.")
        out.mkdir(parents=True)
    with held(out / ".native-receiving.lock", blocking=False):
        return _continue_native_receiving(args, source_root, out)


def _continue_native_receiving(args, source_root, out):
    """Hold one original operation lock through checkpoint, queue and receiving."""
    from model.common import read_json, verify_file
    from model.workspace import Workspace

    original = Workspace(source_root)
    experiment_selection = _original_json(args.experiment_selection)
    delivery_selection = _original_json(args.delivery_selection)
    requested = {
        "schema": "upstate.native-decision-receiving-selection/v1",
        "project_id": original.project["id"], "workspace": str(source_root),
        "study_id": args.study_id, "run_id": args.run_id,
        "profile_id": args.delivery_profile, "point_index": args.delivery_point,
        "delivery_id": args.delivery_id, "delivery_selection": delivery_selection,
        "experiment_selection": experiment_selection,
        "whole_workspace": args.whole_workspace,
    }
    request_path = out / "native-receiving-selection.json"
    if request_path.exists():
        require(read_json(request_path) == requested,
                "Resume the retained operation with the same scientific selections.")
    else:
        require(not args.resume, "The output directory lacks its original receiving selection.")
        atomic_json(request_path, requested, immutable=True)
    operation = digest(requested)
    checkpoint_path = out / "native-receiving-progress.json"
    progress = (read_json(checkpoint_path) if checkpoint_path.exists() else
                {"schema": "upstate.native-decision-receiving-progress/v1",
                 "operation_id": operation, "tasks": {}})
    require(progress.get("operation_id") == operation,
            "The receiving checkpoint belongs to another scientific selection.")

    def checkpoint(phase, **values):
        progress.update(phase=phase, **values)
        atomic_json(checkpoint_path, progress)
        print(json.dumps({"phase": phase, **values}, sort_keys=True, allow_nan=False), flush=True)

    module = _load_operator()
    operator = module.Operator(
        source_root, out / "operator-state", create=False,
        upload_limit=args.upload_limit_gib * 1024**3)
    key = operator.primary
    retained_tasks = {}

    def action(phase, name, payload, *, workspace_key=None):
        owner = workspace_key or key
        initial = operator.submit(owner, name, payload, "native_receive_" + operation[:24] + "_" + phase)
        progress["tasks"][phase] = {"id": initial["id"], "workspace_key": owner, "action": name}
        checkpoint(phase, task_id=initial["id"])
        if args.resume and initial["state"] in {"failed", "interrupted", "cancelled"}:
            operator.resume(initial["id"])
        deadline = time.monotonic() + args.timeout
        while True:
            task = operator.task_view(initial["id"])
            if task["state"] == "complete":
                retained_tasks[phase] = task
                return task
            if task["state"] in {"failed", "interrupted", "cancelled"}:
                checkpoint(phase + "_failed", task_id=task["id"], error=task.get("error"))
                raise RuntimeError(json.dumps(task.get("error") or task, allow_nan=False))
            if time.monotonic() >= deadline:
                raise TimeoutError("The original task remains available for resume: " + task["id"])
            time.sleep(0.2)

    def read(method, path, payload, *, workspace_key=None):
        return operator.extensions.read(method, path, workspace_key or key, payload)

    def ticket_identity(ticket):
        stream, record = operator.open_download(ticket["id"])
        try:
            h, size = hashlib.sha256(), 0
            for block in iter(lambda: stream.read(1024 * 1024), b""):
                h.update(block)
                size += len(block)
            require(size == record["bytes"] and h.hexdigest() == record["sha256"],
                    "The original download ticket returned different bytes.")
            return {name: record[name] for name in ("bytes", "sha256")}
        finally:
            stream.close()

    def archive_file(task, filename):
        expected = {name: task["result"][name] for name in ("bytes", "sha256")}
        destination = out / filename
        if destination.exists():
            require(_file_identity(destination) == expected,
                    "The retained archive download differs from its completed task.")
            return destination
        tickets = task.get("_downloads") or []
        require(len(tickets) == 1, "The original archive task must expose one file ticket.")
        stream, record = operator.open_download(tickets[0]["id"])
        temporary = out / (".download-" + filename)
        temporary.unlink(missing_ok=True)
        try:
            require({name: record[name] for name in ("bytes", "sha256")} == expected,
                    "The original archive ticket differs from its server-owned task result.")
            h, size = hashlib.sha256(), 0
            with temporary.open("xb") as output:
                for block in iter(lambda: stream.read(1024 * 1024), b""):
                    output.write(block)
                    h.update(block)
                    size += len(block)
                output.flush()
                os.fsync(output.fileno())
            require({"bytes": size, "sha256": h.hexdigest()} == expected,
                    "The original archive changed during streaming download.")
            os.link(temporary, destination)
            return destination
        finally:
            stream.close()
            temporary.unlink(missing_ok=True)

    def receive_archive(task, filename, phase):
        archive = archive_file(task, filename)
        with archive.open("rb") as stream:
            upload = operator.receive_upload(stream, archive.stat().st_size, filename, "application/zip")
        restored_task = action(phase, "workspace.restore", {"upload_id": upload["id"]})
        restored_key = restored_task["result"]["workspace_key"]
        restored = operator.ws(restored_key)
        require(restored.project == original.project,
                "Original receiving changed the scientific project identity.")
        database = restored.root / "robust_decisions/robust_decisions.sqlite3"
        frozen = _file_identity(database)
        operator.extensions.verify_workspace(restored)
        require(_file_identity(database) == frozen,
                "Receiving verification changed the archived Decision SQLite snapshot.")
        # Exercise the original completed-task replay once, before opening
        # writable native stores. Later resumes may reopen legitimate SQLite WAL
        # state; they validate logical history instead of replaying raw extraction.
        replayed = progress.setdefault("receiving_replays", {})
        if restored_task["id"] not in replayed:
            replay = operator._invoke(operator.task(restored_task["id"]))
            require(replay["workspace_key"] == restored_key,
                    "Receiving replay changed the original registered Workspace.")
            replayed[restored_task["id"]] = restored_key
            checkpoint(phase + "_replayed", restored_workspace_key=restored_key)
        return restored_key, restored, restored_task

    try:
        checkpoint("opening", process_id=os.getpid(), application=str(APP),
                   workspace_key=key, workspace=str(original.root))
        required_routes = [
            ("POST", "/api/robust-workbench/delivery-release"),
            ("POST", "/api/robust-workbench/run"),
            ("POST", "/api/robust-workbench/study"),
            ("POST", "/api/study-transfer/preview"),
        ]
        require(all(operator.extensions.has_route(method, path) for method, path in required_routes),
                "Install the current Decision release and selected-study registered providers.")
        source_run = read("POST", "/api/robust-workbench/run",
                          {"study_id": args.study_id, "run_id": args.run_id})
        require(source_run["status"] == "completed" and source_run["result"] is not None,
                "Choose an already completed original Decision calculation.")
        revision = source_run["revision"]
        source_study = read("POST", "/api/robust-workbench/study",
                            {"study_id": args.study_id, "revision": revision})
        release_request = {"study_id": args.study_id, "run_id": args.run_id,
                           "profile_id": args.delivery_profile}
        if args.delivery_point is not None:
            release_request["point_index"] = args.delivery_point
        release = read("POST", "/api/robust-workbench/delivery-release", release_request)
        bound = release["selection"]
        require(release["ready"] and release["revision"] == revision,
                "The original release route did not retain the saved calculation revision.")
        roots = [{"kind": "robust-decisions", "id": args.study_id}]
        experiment_id, source_bindings = None, []
        if experiment_selection is not None:
            saved = action("adopt_sources", "experiment.save", {"selection": experiment_selection})
            experiment_id = saved["result"]["id"]
            plan = read_json(original.root / "experiments" / experiment_id / "plan.json")
            require(plan["selection"].get("source_run_ids"),
                    "The selected design must explicitly retain completed noncanonical source_run_ids.")
            source_bindings = plan.get("source_runs") or []
            require(sorted(row["run_id"] for row in source_bindings) ==
                    plan["selection"]["source_run_ids"],
                    "The saved experiment lost an explicitly adopted native source.")
            for source in source_bindings:
                actual = original.inspect_run(source["run_id"])
                require(actual["selection"] == source["selection"] and actual["state"] == "complete",
                        "The adopted source must retain its completed original run selection.")
            roots.append({"kind": "experiments", "id": experiment_id})
            checkpoint("adopted_sources_retained", experiment_id=experiment_id,
                       source_run_ids=plan["selection"]["source_run_ids"],
                       materialized_cases=len(list((original.root / "experiments" /
                                                    experiment_id / "cases").glob("*.json"))))
        if args.delivery_id:
            delivery_id = args.delivery_id
        else:
            chosen = deepcopy(delivery_selection)
            for field in ("baseline_run_id", "scenario_run_ids", "source_decision"):
                require(field not in chosen or chosen[field] == bound[field],
                        "The supplied map selection conflicts with its saved Decision " + field + ".")
                chosen[field] = deepcopy(bound[field])
            built = action("build_release", "delivery.build", chosen)
            delivery_id = built["result"]["id"]
        delivery_root = original.root / "deliveries" / delivery_id
        delivery = read_json(delivery_root / "delivery-state.json")
        require(delivery["state"] == "complete" and
                delivery["selection"].get("source_decision") == bound["source_decision"],
                "Choose the completed map release for this exact saved result, profile and frontier point.")
        required_files = {
            "decision_binding", "decision_project", "decision_selection",
            "decision_report_html", "decision_report_csv", "map_atlas_index",
            "client_report", "client_report_html", "client_report_model", "native_execution",
        }
        require(required_files.issubset(delivery["files"]),
                "The completed release must retain its Decision, atlas and client report files.")
        execution_path = verify_file(delivery_root, delivery["files"]["native_execution"])
        require(digest(read_json(execution_path)) == delivery["selection"].get("native_execution_digest"),
                "The retained producing-stage execution report differs from its original release pin.")
        before_files = {}
        for role, descriptor in delivery["files"].items():
            verify_file(delivery_root, descriptor)
            before_files[role] = deepcopy(descriptor)
        delivery_view = operator.item(key, "deliveries", delivery_id)
        require(delivery_view.get("_downloads"), "Open the release through the original file-ticket provider.")
        native_ids = {bound["baseline_run_id"], *bound["scenario_run_ids"],
                      *(row["run_id"] for row in source_bindings)}
        native_before = {run_id: original.inspect_run(run_id) for run_id in sorted(native_ids)}
        snapshot_path = out / "native-source-snapshot.json"
        if snapshot_path.exists():
            snapshot = read_json(snapshot_path)
            require(snapshot["operation_id"] == operation and snapshot["delivery"] == delivery
                    and snapshot["native_runs"] == native_before,
                    "The original retained native release changed since this receiving operation.")
            before_history = snapshot["decision_history"]
        else:
            before_history = DecisionWorkspace(original).store.export(args.study_id)
            atomic_json(snapshot_path, {"operation_id": operation, "delivery": delivery,
                                        "native_runs": native_before,
                                        "decision_history": before_history}, immutable=True)
        selected = {"title": source_study["study"]["title"] + " — editable release",
                    "roots": roots, "include_related_results": True}
        preview = read("POST", "/api/study-transfer/preview", {"selection": selected})
        selected_nodes = {(row["kind"], row["id"]) for row in preview["nodes"]}
        require(("deliveries", delivery_id) in selected_nodes and
                all(("runs", run_id) in selected_nodes for run_id in native_ids),
                "Selected study must include the completed release and every explicitly adopted original.")
        selected_path = out / "selected-study-selection.json"
        if selected_path.exists():
            retained_selection = read_json(selected_path)
            require({name: value for name, value in retained_selection.items()
                     if name != "preview_token"} == selected,
                    "The retained study export selection differs from this original operation.")
            selected = retained_selection
        else:
            selected["preview_token"] = preview["preview_token"]
            atomic_json(selected_path, selected, immutable=True)
        exported = action("export_study", "study.export", selected)
        archive_receipt = exported["result"]["study"]
        require(any(row["id"] == delivery_id for row in
                    archive_receipt["identity"].get("completed_deliveries", [])),
                "The original transfer receipt lost the completed release binding.")
        restored_key, restored, restored_task = receive_archive(
            exported, "selected-decision-study.zip", "restore_study")
        require(DecisionWorkspace(restored).store.export(args.study_id) == before_history,
                "Selected-study restore changed the retained Decision revision/calculation history.")
        restored_delivery = read_json(restored.root / "deliveries" / delivery_id / "delivery-state.json")
        require(restored_delivery == delivery,
                "Selected-study restore changed the exact completed map/client release record.")
        for run_id, before in native_before.items():
            require(restored.inspect_run(run_id) == before,
                    "Selected-study restore changed an adopted or mapped original native run.")
        if experiment_id:
            restored_plan = read_json(restored.root / "experiments" / experiment_id / "plan.json")
            require(restored_plan == plan, "The adopted experiment lost its immutable original plan.")
            page = operator.experiments.read(restored_key, "inspect",
                                             {"experiment_id": experiment_id, "offset": 0, "limit": 1})
            require(page["selection"]["source_run_ids"] == plan["selection"]["source_run_ids"],
                    "The original restored programme desk lost its explicit adopted sources.")
        for role, descriptor in before_files.items():
            verify_file(restored.root / "deliveries" / delivery_id, descriptor)
        reopened = read("POST", "/api/robust-workbench/delivery-release",
                        release_request, workspace_key=restored_key)
        require(reopened["selection"] == bound,
                "The restored original Decision release route changed its exact native map binding.")
        received_view = operator.item(restored_key, "deliveries", delivery_id)
        ticket_hashes = {item["sha256"] for item in received_view["_downloads"]}
        require(all(before_files[role]["sha256"] in ticket_hashes for role in required_files),
                "The restored original file tickets omit a retained Decision/map/client deliverable.")
        # Read one original retained binding through the authenticated ticket
        # interface; the receiving writer already verifies every archived byte.
        binding_sha = before_files["decision_binding"]["sha256"]
        binding_ticket = next(item for item in received_view["_downloads"] if item["sha256"] == binding_sha)
        ticket_identity(binding_ticket)
        full_restore = None
        if args.whole_workspace:
            backed_up = action("backup_workspace", "workspace.backup", {"include_intermediates": True})
            full_key, full, full_task = receive_archive(
                backed_up, "complete-scientific-workspace.zip", "restore_workspace")
            require(DecisionWorkspace(full).store.export(args.study_id) == before_history,
                    "Full-workspace receiving changed the selected Decision history.")
            require(read_json(full.root / "deliveries" / delivery_id / "delivery-state.json") == delivery,
                    "Full-workspace receiving changed the original completed map release.")
            full_restore = {"workspace_key": full_key, "workspace": str(full.root),
                            "task_id": full_task["id"]}
        outcome = {
            "schema": "upstate.native-decision-receiving-workflow/v1",
            "operation_id": operation, "project_id": original.project["id"],
            "study_id": args.study_id, "revision": revision, "run_id": args.run_id,
            "source_decision": bound["source_decision"], "delivery_id": delivery_id,
            "experiment_id": experiment_id, "adopted_run_ids": [row["run_id"] for row in source_bindings],
            "original_project_sha256": before_history["sha256"],
            "study_transfer_id": exported["result"]["id"],
            "archive": _file_identity(out / "selected-decision-study.zip"),
            "restored_workspace": str(restored.root), "restored_workspace_key": restored_key,
            "restored_delivery_files": before_files, "whole_workspace_restore": full_restore,
            "operator_state": str(out / "operator-state"),
            "browser_handoff": {"views": ["robust-workbench", "map-atlas", "study-transfer"],
                                "workspace_key": restored_key, "study_id": args.study_id,
                                "run_id": args.run_id, "revision": revision,
                                "profile_id": args.delivery_profile, "point_index": args.delivery_point,
                                "delivery_id": delivery_id},
            "tasks": {phase: {"id": task["id"], "action": task["action"], "state": task["state"]}
                      for phase, task in retained_tasks.items()},
        }
        atomic_json(out / "native-decision-receiving.json", outcome)
        checkpoint("complete", receipt=str(out / "native-decision-receiving.json"),
                   restored_workspace_key=restored_key, delivery_id=delivery_id)
        print(json.dumps({"state": "complete", "operation_id": operation,
                          "receipt": str(out / "native-decision-receiving.json"),
                          "restored_workspace": str(restored.root),
                          "study_transfer_id": outcome["study_transfer_id"],
                          "delivery_id": delivery_id}, sort_keys=True, allow_nan=False), flush=True)
        return 0
    except BaseException as error:
        checkpoint("failed", error={"type": type(error).__name__, "message": str(error)})
        raise
    finally:
        operator.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--study", type=Path,
                        default=APP / "model/robust_decisions/examples/arithmetic-study.json")
    parser.add_argument("--workspace", type=Path,
                        help="Continue an existing scientific Workspace with its completed native Decision.")
    parser.add_argument("--study-id")
    parser.add_argument("--run-id", help="Exact completed original Decision calculation ID.")
    parser.add_argument("--delivery-profile", help="Explicit native profile ID for the map release.")
    parser.add_argument("--delivery-point", type=int, help="Exact saved frontier point index, including zero.")
    parser.add_argument("--delivery-id", help="Reuse this completed original Decision-bound map release.")
    parser.add_argument("--delivery-selection", type=Path,
                        help="Original full map selection JSON; the saved Decision binding is pinned by its route.")
    parser.add_argument("--experiment-selection", type=Path,
                        help="Original experiment JSON with explicit completed noncanonical source_run_ids.")
    parser.add_argument("--whole-workspace", action="store_true",
                        help="Also receive the complete original Workspace after the selected study.")
    parser.add_argument("--resume", action="store_true",
                        help="Reopen this output directory and resume its original retained queue tasks.")
    parser.add_argument("--timeout", type=float, default=3600,
                        help="Seconds to observe each original queued native receiving operation.")
    parser.add_argument("--upload-limit-gib", type=int, default=4,
                        help="Original operator upload capacity for the actual scientific archive.")
    args = parser.parse_args()
    if args.workspace is not None:
        return _native_receiving(args)
    require(not any((args.study_id, args.run_id, args.delivery_profile, args.delivery_id,
                     args.delivery_selection, args.experiment_selection, args.whole_workspace,
                     args.resume, args.delivery_point is not None)),
            "Use --workspace with native receiving selections.")
    out = args.output.resolve()
    out.mkdir(parents=True, exist_ok=False)
    study = json.loads(args.study.read_text(encoding="utf-8"))
    module = _load_operator()
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
