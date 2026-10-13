#!/usr/bin/env python3
"""Open one original regional project with its saved watershed and scientific profile.

Retained source preparation, watershed analysis, selection export, profile
materialization, operator tasks and full workspace transfer remain native.
"""
from __future__ import annotations

import argparse
import importlib.util
import json
from pathlib import Path
import re
import subprocess
import sys
import time

APP = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(APP), str(APP / "operator")]

from model.common import atomic_json, describe_file, digest, now, read_json
from model.workspace import Workspace
from model.model_selection import grid_models, selected
from open_profile_desk import prepare as prepare_profile

SCHEMA = "upstate.regional-workflow-opening/v1"


def load_operator():
    spec = importlib.util.spec_from_file_location(
        "upstate_regional_opening_operator", APP / "operator/server.py")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def queued(operator, workspace_key, action, payload, operation_id, timeout):
    task = operator.submit(workspace_key, action, payload, operation_id)
    if task["state"] in {"interrupted", "failed", "cancelled"}:
        task = operator.resume(task["id"])
    deadline, previous = time.monotonic() + timeout, None
    while True:
        task = operator.task_view(task["id"])
        if task["state"] != previous:
            print(json.dumps({"operation": action, "task_id": task["id"],
                              "state": task["state"]}), flush=True)
            previous = task["state"]
        if task["state"] == "complete":
            return task
        if task["state"] in {"failed", "interrupted", "cancelled"}:
            raise RuntimeError(json.dumps(task.get("error") or task, ensure_ascii=False))
        if time.monotonic() >= deadline:
            raise TimeoutError("Reopen the original task " + task["id"] + " to continue " + action)
        time.sleep(0.1)


def native_selection(workspace, args):
    selected = {}
    baseline, alternative = None, None
    for field, requested in (("baseline_run_id", args.baseline_run),
                             ("alternative_run_id", args.alternative_run)):
        if not requested:
            continue
        run = workspace.inspect_run(requested)
        if run["state"] != "complete":
            raise ValueError("Select a completed retained native run: " + requested)
        selected[field] = run["id"]
        selected[field.removesuffix("_id") + "_selection"] = run["selection"]
        if field == "baseline_run_id":
            baseline = run
        else:
            alternative = run
    if alternative is not None and baseline is None:
        raise ValueError("Select the original baseline with the alternative native run")
    if baseline is not None and alternative is not None:
        if baseline["id"] == alternative["id"]:
            raise ValueError("Select distinct baseline and alternative native runs")
        if baseline["selection"]["grid_id"] != alternative["selection"]["grid_id"]:
            raise ValueError("Select native baseline and alternative runs on the same grid")
    if args.experiment:
        from model import experiments
        experiment = experiments.inspect(workspace, args.experiment, offset=0, limit=1)
        summary = experiments.read_summary(workspace, args.experiment)
        selected["experiment_id"] = experiment["id"]
        selected["experiment_state"] = experiment["state"]
        if summary is not None:
            selected["experiment_summary_sha256"] = digest(summary)
    return selected


def source_selection(workspace, args):
    if args.report:
        return None
    if args.source_manifest:
        manifest = args.source_manifest.resolve(strict=True)
        source_id = args.source_id
        if not source_id:
            raise ValueError("--source-id identifies the retained regional entry in --source-manifest")
    else:
        from source_tools.prepare_watershed_context import prepare_source_edition
        edition_dir = args.edition_directory or workspace.root.with_name(
            workspace.root.name + "-regional-source")
        edition = prepare_source_edition(
            args.source_context, args.classification_coverage, edition_dir,
            native_network=args.native_network,
            membership_response=args.membership_response,
            additional_huc8_response=args.additional_huc8_response,
            classified_geometry=args.classified_geometry,
            source_id=args.source_id,
        )
        manifest, source_id = Path(edition["manifest_path"]), edition["source_id"]
    collection = workspace.import_sources(manifest)
    workspace.source_file(collection["id"], source_id)
    return {"source_collection_id": collection["id"], "source_id": source_id}


def watershed_analysis_operation(selection):
    """Re-enter original analysis when its installed source/retention edition changes."""
    paths = (
        "operator/watershed_context.py",
        "model/watershed_context.py",
        "source_tools/prepare_watershed_context.py",
        "source_tools/watershed_source_validation.py",
    )
    return "regional_context_" + digest({
        "selection": selection,
        "implementation": {name: describe_file(APP, APP / name)["sha256"]
                           for name in paths},
    })


def watershed_export_operation(selection, report):
    """Bind retries to the installed export implementation and retained source edition."""
    import watershed_context as provider
    required = ("operator/watershed_context.py", "model/watershed_context.py",
                "model/watershed_brief.py")
    optional = (
        "source_tools/watershed_source_entry.py",
        "outputs/watershed-connectivity-20261013/watershed-connectivity-217.csv",
        "outputs/watershed-connectivity-20261013/watershed-connectivity-summary.json",
    )
    implementation = {name: describe_file(APP, APP / name)["sha256"] for name in required}
    implementation.update({
        name: describe_file(APP, APP / name)["sha256"] if (APP / name).is_file() else None
        for name in optional
    })
    return "regional_selection_" + digest({
        "selection": selection,
        "report_sha256": report["files"]["watershed-context.json"]["sha256"],
        "source_fingerprint": report["source_fingerprint"],
        "source_edition_fingerprint": report.get("source_edition_fingerprint"),
        "source_supporting_inputs": report.get("source_supporting_inputs", []),
        "source_validation": report.get("source_validation"),
        "csv_format": provider.CSV_FORMAT,
        "csv_columns": list(provider.context_model.HUC_COLUMNS),
        "brief_format": provider.BRIEF_FORMAT,
        "implementation": implementation,
    })

def save_native_view(operator, key, opening):
    """Retain this opening through the original project's saved-view service."""
    reader = getattr(operator, "operator_session", None)
    writer = getattr(operator, "save_operator_session", None)
    if not callable(reader) or not callable(writer):
        raise ValueError("Install the current native saved-view host before using --save-view")
    workspace = operator.ws(key)
    current = reader(key)
    previous = (current or {}).get("journey", {})
    fields = ("baseline_run_id", "grid_id", "profile_id", "scenario_id", "run_id",
              "comparison_id", "spatial_review_id", "spatial_export_id", "delivery_id")
    selection = {name: "" for name in fields}
    selection["profile_id"] = opening["profile_id"]
    profile = workspace._get("profiles", opening["profile_id"])
    selection["models"] = list(selected(profile))
    selection["baseline_run_id"] = opening.get("baseline_run_id", "")
    focus_id = opening.get("alternative_run_id") or opening.get("baseline_run_id")
    if focus_id:
        focus = workspace.inspect_run(focus_id)
        inputs = focus["selection"]
        selection["grid_id"], selection["scenario_id"] = inputs["grid_id"], inputs["scenario_id"]
        supported = grid_models(workspace.get_grid(inputs["grid_id"]))
        selection["models"] = [name for name in selection["models"] if name in supported]
        if inputs["profile_id"] == opening["profile_id"]:
            selection["run_id"] = focus["id"]
            selection["models"] = list(selected(inputs))
    regional = {
        "schema": "upstate.regional-journey/v1",
        "export_id": opening["watershed_export_id"],
        "report_id": opening["watershed_report_id"],
        "report_sha256": opening["watershed_report_sha256"],
        "source_fingerprint": opening["source_fingerprint"],
        "huc12s": opening["selected_huc12s"],
        "experiment_id": opening.get("experiment_id", ""),
        "decision_study_id": "", "decision_revision": None,
    }
    journey = {
        "schema": "upstate.operating-journey/v1", "project_id": workspace.project["id"],
        "step": "inputs", "selection": selection, "regional": regional,
        "notes": previous.get("notes", ""), "note_versions": previous.get("note_versions", []),
        "started_at": previous.get("started_at") or now(),
    }
    return writer(key, {"journey": journey, "expected_revision": (current or {}).get("revision")})


def transfer(operator, key, opening, output, timeout, saved_view=None):
    """Capture one explicit destination and reopen its original full archive."""
    output = Path(output).resolve()
    original = operator.ws(key)
    if output.is_relative_to(original.root):
        raise ValueError("Put the transfer output outside the scientific workspace")
    if output.exists() and any(output.iterdir()) and not (output / "selection.json").is_file():
        raise ValueError("Use a new transfer directory, or resume its retained selection.json")
    output.mkdir(parents=True, exist_ok=True)
    intent = {"schema": "upstate.regional-opening-transfer/v1",
              "workspace_id": original.project["id"],
              "opening": {name: value for name, value in opening.items()
                          if name not in {"operator_workspace_key", "workspace"}}}
    if saved_view is not None:
        intent["saved_view_revision"] = saved_view["revision"]
    intent_path = output / "selection.json"
    if intent_path.exists() and read_json(intent_path) != intent:
        raise ValueError("This transfer destination retains another opening; choose a new destination")
    atomic_json(intent_path, intent, immutable=True)
    operation = "regional_transfer_" + digest({"destination": str(output), "selection": intent})
    backup = queued(operator, key, "workspace.backup", {"include_intermediates": True},
                    operation + "_backup", timeout)
    tickets = backup.get("_downloads") or []
    if len(tickets) != 1:
        raise ValueError("Open the original completed backup task and its archive")
    stream, record = operator.open_download(tickets[0]["id"])
    try:
        uploaded = operator.receive_upload(stream, record["bytes"],
                                           "regional-scientific-workspace.zip", "application/zip")
    finally:
        stream.close()
    if uploaded["sha256"] != record["sha256"]:
        raise ValueError("The original transferred archive has different bytes")
    received = queued(operator, key, "workspace.restore", {"upload_id": uploaded["id"]},
                      operation + "_receive", timeout)
    result = received["result"]
    restored = operator.ws(result["workspace_key"])
    if restored.project != original.project:
        raise ValueError("The receiving project has a different original identity")
    saved = read_json(restored.root / "regional-workflow-opening.json")
    if saved != opening:
        raise ValueError("The received original opening selection differs")
    inspection = operator.extensions.read("GET", "/api/watershed-context/export",
        result["workspace_key"], {"export_id": opening["watershed_export_id"]})
    if (inspection["report_id"] != opening["watershed_report_id"]
            or inspection["report_sha256"] != opening["watershed_report_sha256"]
            or sorted(inspection["huc12s"]) != opening["selected_huc12s"]):
        raise ValueError("The received saved watershed selection differs")
    profile = operator.extensions.read("GET", "/api/profile-workbench/inspect",
        result["workspace_key"], {"profile_id": opening["profile_id"]})
    if profile["profile_id"] != opening["profile_id"]:
        raise ValueError("The received scientific profile differs")
    if saved_view is not None:
        reopened_view = operator.operator_session(result["workspace_key"])
        if reopened_view is None or reopened_view.get("journey") != saved_view["journey"]:
            raise ValueError("The received native saved view or operating notes differ")
    outcome = {"schema": "upstate.regional-opening-received/v1",
               "archive": {"bytes": uploaded["bytes"], "sha256": uploaded["sha256"]},
               "backup_task_id": backup["id"], "receive_task_id": received["id"],
               "receiving": result, "opening": opening,
               "saved_view_revision": (saved_view or {}).get("revision")}
    atomic_json(output / "received-project.json", outcome, immutable=True)
    return result


def prepare(args):
    root = args.workspace.resolve()
    workspace = Workspace(root, create=not bool(args.report), title="Upper Savannah regional study")
    # Validate retained native selections before preparing any new regional data.
    scientific = native_selection(workspace, args)
    state_root = (args.operator_state or root.with_name(root.name + "-operator")).resolve()
    if args.transfer_output and state_root.is_relative_to(root):
        raise ValueError("Keep operator state outside the workspace for complete transfer")
    module = load_operator()
    operator = module.Operator(root, state_root)
    tasks = []
    receiving = None
    try:
        for path in ("/api/watershed-context/report", "/api/watershed-context/export",
                     "/api/profile-workbench/inspect"):
            if not operator.extensions.has_route("GET", path):
                raise ValueError("Install the retained regional/profile desk and original route " + path)
        if not operator.extensions.handles_action("watershed.context.export"):
            raise ValueError("Install the retained regional saved-selection component")
        if args.save_view and not all(callable(getattr(operator, name, None))
                                      for name in ("operator_session", "save_operator_session")):
            raise ValueError("Install the current native saved-view host before using --save-view")
        regional_source = source_selection(workspace, args)
        profile = prepare_profile(root, source_manifest=args.profile_source_manifest,
                                  profile_id=args.profile, parameters_path=args.parameters)
        key = operator.primary
        if regional_source is not None:
            task = queued(operator, key, "watershed.context.analyze", regional_source,
                          watershed_analysis_operation(regional_source), args.timeout)
            tasks.append(task["id"])
            report_id = task["result"]["id"]
        else:
            report_id = args.report
        report = operator.extensions.read("GET", "/api/watershed-context/report",
                                            key, {"report_id": report_id})
        hucs = sorted(set(args.huc12 or ["030601020507"]))
        selection = {"report_id": report_id, "huc12s": hucs}
        exported = queued(operator, key, "watershed.context.export", selection,
                          watershed_export_operation(selection, report), args.timeout)
        tasks.append(exported["id"])
        export = operator.extensions.read("GET", "/api/watershed-context/export",
                                            key, {"export_id": exported["result"]["id"]})
        report_sha = report["files"]["watershed-context.json"]["sha256"]
        if (export["report_id"] != report_id or export["report_sha256"] != report_sha
                or sorted(export["huc12s"]) != hucs):
            raise ValueError("The saved watershed selection does not match the original report")
        opening = {
            "schema": SCHEMA, "workspace_id": workspace.project["id"],
            "operator_workspace_key": key, "workspace": str(root),
            "watershed_report_id": report_id,
            "watershed_report_sha256": report_sha,
            "watershed_export_id": export["id"],
            "source_fingerprint": export["source_fingerprint"],
            "selected_huc12s": hucs,
            "profile_id": profile["profile_id"],
            "profile_source_collection_id": profile["source_collection_id"],
            "biophysical_source_id": profile["biophysical_source_id"],
            "profile_table_sha256": profile["source_table_sha256"],
            **scientific,
        }
        # The native analyzer can reuse a report retained from another import
        # of the same source edition. Bind its actual source references.
        for name in ("source_collection_id", "source_id"):
            if report.get(name):
                opening[name] = report[name]
        if regional_source is not None:
            opening["regional_source_request"] = regional_source
        atomic_json(root / "regional-workflow-opening.json", opening)
        if args.opening_output:
            atomic_json(args.opening_output.resolve(), opening)
        saved_view = save_native_view(operator, key, opening) if args.save_view else None
        if args.transfer_output:
            receiving = transfer(operator, key, opening, args.transfer_output, args.timeout, saved_view)
        application = Path(receiving["application"]) if receiving else APP
        target = Path(receiving["workspace"]) if receiving else root
        result = {
            "opening": opening,
            "opening_file": str(root / "regional-workflow-opening.json"),
            "task_ids": tasks,
            "saved_view_revision": (saved_view or {}).get("revision"),
            "receiving": receiving,
            "operator_command": [sys.executable, "-B", str(application / "operator/server.py"),
                                 "--workspace", str(target), "--operator-state", str(state_root),
                                 "--port", str(args.port)],
            "opened_workspace_key": receiving["workspace_key"] if receiving else key,
        }
        return result
    finally:
        operator.close()


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", required=True, type=Path)
    parser.add_argument("--operator-state", type=Path)
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--report", help="Existing retained watershed report ID in this project")
    source.add_argument("--source-manifest", type=Path, help="Original prepared regional source manifest")
    source.add_argument("--source-context", type=Path, help="Original full-domain regional context JSON")
    parser.add_argument("--classification-coverage", type=Path)
    parser.add_argument("--edition-directory", type=Path)
    parser.add_argument("--source-id")
    parser.add_argument("--native-network", type=Path)
    parser.add_argument("--membership-response", type=Path)
    parser.add_argument("--additional-huc8-response", type=Path)
    parser.add_argument("--classified-geometry", type=Path)
    parser.add_argument("--huc12", action="append", help="Saved watershed; default Lower Tugaloo 030601020507")
    parser.add_argument("--profile")
    parser.add_argument("--profile-source-manifest", type=Path)
    parser.add_argument("--parameters", type=Path)
    parser.add_argument("--experiment")
    parser.add_argument("--baseline-run")
    parser.add_argument("--alternative-run")
    parser.add_argument("--opening-output", type=Path,
                        help="Additional opening JSON for the existing Guided journey import")
    parser.add_argument("--transfer-output", type=Path,
                        help="New snapshot destination, or the same destination to recover that transfer")
    parser.add_argument("--save-view", action="store_true",
                        help="Save this opening and existing notes through the original native project view")
    parser.add_argument("--prepare-only", action="store_true")
    parser.add_argument("--port", type=int, default=0)
    parser.add_argument("--timeout", type=float, default=600)
    args = parser.parse_args(argv)
    if args.source_context and not args.classification_coverage:
        parser.error("--source-context requires its original --classification-coverage")
    if args.huc12 and any(re.fullmatch(r"[0-9]{12}", value) is None for value in args.huc12):
        parser.error("Each HUC12 must retain its twelve original digits")
    if not 0 <= args.port <= 65535 or not 0 < args.timeout <= 86400:
        parser.error("Choose a valid port and positive operation timeout up to 86400 seconds")
    result = prepare(args)
    print(json.dumps(result, ensure_ascii=False, indent=2), flush=True)
    if args.prepare_only:
        return 0
    print("Open the original operator URL and import regional-workflow-opening.json in Guided journey.",
          flush=True)
    return subprocess.call(result["operator_command"])


if __name__ == "__main__":
    raise SystemExit(main())
