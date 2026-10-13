#!/usr/bin/env python3
# Copyright TokenJunkieLabs. Retain the application license and source notices.
"""Own the original operator and receiving-water browser in one native invocation."""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import shutil
import signal
import sys

APP = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(APP))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from receiving import OperatorProcess, atomic, record, run_command
from model.common import digest, held, identifier, now, read_json
from model.workspace import Workspace
from model import receiving_waters

SCHEMA = "upstate.receiving-water-browser-owner/v1"


def existing_executable(value, title):
    candidate = shutil.which(value) if value else None
    if candidate is None and value:
        candidate = str(Path(value).expanduser().resolve())
    if not candidate or not Path(candidate).is_file() or not os.access(candidate, os.X_OK):
        raise ValueError("Select the installed " + title + " executable")
    return str(Path(candidate).resolve())


def original_preparation(path):
    path = path.expanduser().resolve(strict=True)
    value = read_json(path)
    if value.get("schema") != "upstate.public-water-preparation/v1":
        raise ValueError("Select the original public-water preparation result")
    if value.get("plan_state") != "complete":
        raise ValueError("The original source preparation has not completed its plan")
    root = Path(value["workspace"])
    if not root.is_absolute():
        raise ValueError("Preparation must retain its absolute original Workspace")
    workspace = Workspace(root.resolve(strict=True))
    plan = receiving_waters.inspect_plan(workspace, identifier(value["plan_id"]))
    if plan["state"] != "complete":
        raise ValueError("The original saved source plan is incomplete")
    if set(value["receptor_ids"]) != {row["id"] for row in plan["receptors"]}:
        raise ValueError("Preparation receptor IDs differ from the original saved plan")
    if any(row["source"]["source_collection_id"] != value["source_collection_id"]
           for row in plan["receptors"]):
        raise ValueError("Preparation source collection differs from the original saved plan")
    return workspace, plan, record(path)



def original_geographic_context(path, workspace_path, relationship):
    """Resolve the actual producer context without recasting its input schema."""
    if workspace_path is None:
        raise ValueError("Supply the original --workspace with --geographic-context")
    path = path.expanduser().resolve(strict=True)
    supplied = read_json(path)
    if (supplied.get("schema") != "upstate.geographic-receiving-context/v1"
            or supplied.get("state") != "complete"):
        raise ValueError("Select the complete original geographic receiving context")
    workspace = Workspace(workspace_path.expanduser().resolve(strict=True))
    from model import geographic_receiving_context
    retained = geographic_receiving_context.inspect(workspace, identifier(supplied.get("id")))
    if supplied != retained:
        raise ValueError("Use the exact geographic context retained in this Workspace")
    if retained["project_id"] != workspace.project["id"]:
        raise ValueError("The geographic receiving context belongs to another project")
    if relationship not in ("upstream_huc", "published_protection"):
        raise ValueError("Choose the original upstream HUC or published protection relationship")
    plan_id = identifier(retained["plan_ids"].get(relationship))
    plan = receiving_waters.inspect_plan(workspace, plan_id)
    if plan["state"] != "complete":
        raise ValueError("The original geographic receiving source plan is incomplete")
    if plan["identity"]["selection"] != retained["identity"]["plan_selections"][relationship]:
        raise ValueError("The original source plan differs from the geographic context selection")
    rows = [item for item in retained["analyses"] if item["relationship"] == relationship]
    selected = {}
    for scope in ("reporting", "model_domain"):
        matches = [item for item in rows if item["quantity_scope"] == scope]
        if len(matches) != 1:
            raise ValueError("Retain one complete reporting and model-domain analysis for this relationship")
        item = matches[0]
        analysis = receiving_waters.inspect(workspace, identifier(item["analysis_id"]))
        if (analysis["state"] != "complete" or analysis["plan_id"] != plan_id
                or analysis["quantity_scope"] != scope
                or analysis["baseline_run_id"] != retained["baseline_run_id"]
                or analysis["alternative_run_ids"] != retained["alternative_run_ids"]):
            raise ValueError("The saved analysis differs from the original geographic context")
        selected[scope] = analysis["id"]
    source = {
        "file": record(path), "id": retained["id"], "relationship": relationship,
        "prepared_id": retained["prepared_id"], "plan_id": plan_id,
        "reporting_analysis_id": selected["reporting"],
        "model_domain_analysis_id": selected["model_domain"],
        "baseline_run_id": retained["baseline_run_id"],
        "alternative_run_ids": retained["alternative_run_ids"],
    }
    return workspace, plan, source, selected

def operate(args):
    geographic_input = None
    if getattr(args, "geographic_context", None):
        relationship = args.relationship or "published_protection"
        workspace, plan, geographic_input, scopes = original_geographic_context(
            args.geographic_context, args.workspace, relationship)
        for key, value in (("analysis_id", scopes["reporting"]),
                           ("scope_analysis_id", scopes["model_domain"])):
            supplied = getattr(args, key, None)
            if supplied is not None and supplied != value:
                raise ValueError("The explicit " + key + " differs from the selected original geographic context")
            setattr(args, key, value)
        preparation = None
    else:
        if getattr(args, "workspace", None) or getattr(args, "relationship", None):
            raise ValueError("--workspace and --relationship are used with --geographic-context")
        workspace, plan, preparation = original_preparation(args.preparation)
    if args.analysis_id:
        analysis = receiving_waters.inspect(workspace, identifier(args.analysis_id))
        if analysis["state"] != "complete" or analysis["plan_id"] != plan["id"]:
            raise ValueError("Select a completed analysis of the original prepared plan")
    if args.scope_analysis_id:
        if not args.analysis_id:
            raise ValueError("Select the original --analysis-id before its --scope-analysis-id")
        other = receiving_waters.inspect(workspace, identifier(args.scope_analysis_id))
        if (other["state"] != "complete" or other["plan_id"] != plan["id"]
                or other["quantity_scope"] == analysis["quantity_scope"]):
            raise ValueError("Select the complete other quantity support of this original plan")
    node = existing_executable(args.node, "Node")
    chromium = existing_executable(args.chromium, "Chromium") if args.chromium else None
    modules = args.node_modules
    if modules:
        modules = str(Path(modules).expanduser().resolve(strict=True))
        if not (Path(modules) / "playwright" / "index.mjs").is_file():
            raise ValueError("The selected node_modules directory does not contain installed Playwright")
    root = args.output_dir.expanduser().resolve()
    if root.is_relative_to(workspace.root):
        raise ValueError("Choose browser receiving output outside the scientific Workspace")
    state = (args.operator_state.expanduser().resolve() if args.operator_state
             else workspace.root.with_name(workspace.root.name + "-operator"))
    if state.is_relative_to(workspace.root):
        raise ValueError("Keep original operator state outside the scientific Workspace")
    source_paths = (
        "operator/receiving_water_operate.py", "operator/receiving.py",
        "operator/receiving_water_browser.mjs", "operator/server.py",
        "operator/web/app.mjs", "operator/web/receiving_waters.mjs",
        "operator/web/receiving_water_spatial.mjs", "operator/web/spatial.mjs",
        "model/receiving_water_spatial.py", "model/spatial.py",
        "model/spatial_exports.py", "model/cartography.py", "model/rasters.py",
    )
    if args.editable_selection:
        source_paths += (
            "operator/web/receiving_water_editing.mjs",
            "operator/web/receiving_water_sources.mjs",
            "operator/web/receiving_water_plan_compare.mjs",
            "operator/web/receiving_waters_extension.mjs", "operator/web/receiving_waters.css",
            "operator/web/extensions/study_transfer.mjs",
            "operator/extensions/receiving-waters.json", "model/receiving_waters.py",
            "model/receiving_water_accounting.py", "model/spatial_esri.py",
            "source/capture_upstream_network.py",
        )
    if args.scope_analysis_id:
        source_paths += ("operator/web/receiving_water_scope_compare.mjs",
                         "operator/web/receiving_waters.css",
                         "operator/web/receiving_waters_extension.mjs",
                         "operator/extensions/receiving-waters.json")
    if geographic_input:
        source_paths += ("model/geographic_receiving_context.py",
                         "model/receiving_water_report_source.py",
                         "model/receiving_waters.py")
    source_paths = tuple(dict.fromkeys(source_paths))
    sources = [{"name": name, **record(APP / name)} for name in source_paths]
    identity = {
        "schema": SCHEMA, "project_id": workspace.project["id"],
        "workspace": str(workspace.root), "plan_id": plan["id"],
        "analysis_id": args.analysis_id,
        **({"scope_analysis_id": args.scope_analysis_id} if args.scope_analysis_id else {}),
        "preparation": preparation, "operator_state": str(state),
        **({"geographic_context": geographic_input} if geographic_input else {}),
        "application_identity": digest([
            {key: row[key] for key in ("name", "bytes", "sha256")} for row in sources
        ]),
        "runtime": {"python": sys.executable, "node": node,
                    "node_modules": modules, "chromium": chromium},
        "selection": {"paper": args.paper, "dpi": args.dpi,
                      "task_timeout_seconds": args.task_timeout_seconds,
                      **({"editable_selection": True} if args.editable_selection else {})},
    }
    operation_id = digest(identity)
    directory = root / operation_id
    directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    os.chmod(directory, 0o700)
    result_path = directory / "receiving-water-owner.json"
    ready_path = directory / "operator-ready.private.json"
    control_path = directory / "browser-control.private.json"
    result = {**identity, "id": operation_id, "state": "running",
              "started_at": now(), "application_root": str(APP),
              "application_files": sources, "result_path": str(result_path),
              "operator_started": False, "operator_closed": False}

    def publish(stage):
        result.update(stage=stage, updated_at=now())
        atomic(result_path, result)
        print(json.dumps({"stage": stage, "operation_id": operation_id,
                          "result_path": str(result_path)}), file=sys.stderr, flush=True)

    with held(directory / ".receiving-water-browser.lock", blocking=False):
        server = None
        try:
            publish("start_original_operator")
            server = OperatorProcess(APP, workspace.root, state, directory / "received",
                                     directory, "receiving-water", 4096)
            if server.receipt["project"]["id"] != workspace.project["id"]:
                raise ValueError("Original operator opened a different scientific Workspace")
            result["operator_started"] = True
            result["workspace_key"] = server.receipt["workspace_key"]
            result["operator_process_id"] = server.child.pid
            atomic(ready_path, server.receipt)
            control = {
                "ready_file": str(ready_path),
                "output": str(directory / "browser"),
                "workspace_key": server.receipt["workspace_key"],
                "plan_id": plan["id"], "paper": args.paper, "dpi": args.dpi,
                "task_timeout_seconds": args.task_timeout_seconds,
            }
            if args.editable_selection:
                control["editable_selection"] = True
            for key, value in (("analysis_id", args.analysis_id),
                               ("scope_analysis_id", args.scope_analysis_id),
                               ("node_modules", modules), ("chromium", chromium)):
                if value is not None:
                    control[key] = value
            atomic(control_path, control)
            publish("operate_original_browser")
            run_command([node, str(APP / "operator/receiving_water_browser.mjs"),
                         str(control_path)], directory, "receiving-water-browser")
            browser_path = directory / "browser" / "receiving-water-browser.json"
            browser = read_json(browser_path)
            if not browser.get("complete") or browser.get("project_id") != workspace.project["id"]:
                raise ValueError("The original browser did not complete this Workspace")
            if browser.get("plan_id") != plan["id"] or browser.get("analysis_id") != args.analysis_id:
                raise ValueError("The completed browser selected a different plan or analysis")
            if not browser.get("cases") or any(
                not row.get("saved_and_exported") or not row.get("cold_reopened")
                for row in browser["cases"].values()
            ):
                raise ValueError("The original browser has unfinished saved/exported/reopened maps")
            if args.scope_analysis_id:
                scoped = browser.get("scope_comparison", {})
                expected_scope_ids = {args.analysis_id, args.scope_analysis_id}
                if (not scoped.get("complete") or not scoped.get("reopened")
                        or {scoped.get("reporting_analysis_id"),
                            scoped.get("model_domain_analysis_id")} != expected_scope_ids):
                    raise ValueError("The original quantity-support comparison did not finish export and reopening")
                result["scope_comparison"] = scoped
            if args.editable_selection:
                editable = browser.get("editable_selection", {})
                expected = {"plan", "analysis"} if args.analysis_id else {"plan"}
                records = editable.get("records", {})
                if (not editable.get("complete") or set(records) != expected
                        or any(not row.get("selection_unchanged") or not row.get("reopened")
                               for row in records.values())):
                    raise ValueError("The original editable selections did not finish saving and reopening")
                comparison = editable.get("comparison", {})
                if (not comparison.get("completed") or not comparison.get("reopened")
                        or comparison.get("reference_id") != plan["id"]
                        or comparison.get("candidate_id") != records["plan"]["id"]):
                    raise ValueError("The original saved plan comparison did not complete and reopen")
                downloaded = comparison.get("download", {})
                downloaded_path = Path(downloaded.get("path", "")).resolve()
                if not downloaded_path.is_relative_to(directory / "browser"):
                    raise ValueError("Keep the original comparison download in its owned browser output")
                actual_download = record(downloaded_path)
                if any(actual_download.get(key) != downloaded.get(key) for key in ("bytes", "sha256")):
                    raise ValueError("The original comparison download changed after the browser received it")
                if args.analysis_id:
                    draft = comparison.get("analysis_draft", {})
                    if (draft.get("original_analysis_id") != args.analysis_id
                            or draft.get("candidate_plan_id") != records["plan"]["id"]
                            or not draft.get("original_other_selections_preserved")
                            or draft.get("submitted") is not False):
                        raise ValueError("The candidate-plan draft did not preserve the original numerical selection")
                result["editable_selection"] = editable
            result.update(browser_result=record(browser_path),
                          exported_maps=len(browser["cases"]),
                          browser_application_identity=browser["application_identity"])
            publish("drain_original_operator")
        except BaseException as error:
            result.update(state="failed", failed_at=now(),
                          error={"type": type(error).__name__, "message": str(error)})
        finally:
            if server is not None:
                try:
                    server.close()
                    result.update(operator_closed=server.child.poll() is not None,
                                  operator_exit_code=server.child.returncode)
                    if server.child.returncode != 0:
                        result.update(state="failed", failed_at=now(),
                                      closure_error={"type": "OperatorExit",
                                                     "message": "Owned operator exited " + str(server.child.returncode)})
                except BaseException as error:
                    result.update(state="failed", failed_at=now(),
                                  closure_error={"type": type(error).__name__, "message": str(error)})
            ready_path.unlink(missing_ok=True)
            control_path.unlink(missing_ok=True)
            if result["state"] == "running":
                result.update(state="complete", stage="complete", completed_at=now())
            atomic(result_path, result)
    return result


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    selection = parser.add_mutually_exclusive_group(required=True)
    selection.add_argument("--preparation", type=Path)
    selection.add_argument("--geographic-context", type=Path,
                           help="Exact completed geographic-receiving context.json")
    parser.add_argument("--workspace", type=Path,
                        help="Original Workspace for --geographic-context")
    parser.add_argument("--relationship", choices=("upstream_huc", "published_protection"),
                        help="Original relationship in the geographic context; default published_protection")
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--node", default=os.environ.get("CODEX_PRIMARY_RUNTIME_NODE", "node"))
    parser.add_argument("--node-modules", default=os.environ.get("CODEX_PRIMARY_RUNTIME_NODE_MODULES"))
    parser.add_argument("--chromium")
    parser.add_argument("--operator-state", type=Path)
    parser.add_argument("--analysis-id")
    parser.add_argument("--scope-analysis-id", help="Complete saved analysis of the same cohort on the other quantity support")
    parser.add_argument("--editable-selection", action="store_true",
                        help="Operate saved Study return, exact revisions, source-plan comparison and reopening in the same browser course")
    parser.add_argument("--paper", choices=("letter", "a4"), default="letter")
    parser.add_argument("--dpi", type=int, choices=(150, 220, 300), default=220)
    parser.add_argument("--task-timeout-seconds", type=int, default=1800)
    args = parser.parse_args(argv)
    if args.task_timeout_seconds <= 0:
        parser.error("Select a positive duration for observing each original task")
    def stop(signum, _frame):
        signal.signal(signal.SIGTERM, signal.SIG_DFL)
        raise KeyboardInterrupt("Receiving-water owner interrupted by signal " + str(signum))

    previous_term = signal.signal(signal.SIGTERM, stop)
    try:
        try:
            result = operate(args)
        except BaseException as error:
            result = {"schema": SCHEMA, "state": "failed", "stage": "open_original_operation",
                      "error": {"type": type(error).__name__, "message": str(error)}}
    finally:
        signal.signal(signal.SIGTERM, previous_term)
    print(json.dumps(result, ensure_ascii=False, allow_nan=False, indent=2))
    return 0 if result["state"] == "complete" else 1


if __name__ == "__main__":
    raise SystemExit(main())
