"""Adopt the accepted simulated demo's completed native runs into a Programme.

This command consumes the original demo-receiving.json and retained Workspace.
The existing Programme verifies/reconciles completed native runs and reports
their original quantities; input generation remains with simulated_headwaters.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import sys
import time

APPLICATION = Path(__file__).resolve().parents[1]
if str(APPLICATION) not in sys.path:
    sys.path.insert(0, str(APPLICATION))

from model.common import atomic_json, held, identifier, now, read_json, verify_file
from model.compute_programme import ComputeProgrammes
from model.model_selection import run_models, validate_completed_run
from model.native_study import retained_runtimes
from model.workspace import Workspace

DEMO_ID = "upstate-simulated-piedmont-headwaters-v1"
OPERATION = "UPSTATE-DEMO-SIMULATED-INPUTS-20261013T140000Z"


class CompletedWorkspace(Workspace):
    """Use original Programme reporting with a completed-output-only runner."""

    def run(self, key, **kwargs):
        if kwargs:
            raise ValueError("Completed demo adoption does not select native execution options")
        key = identifier(key)
        directory = self.root / "runs" / key
        with held(directory / ".run.lock", blocking=False):
            run = self.inspect_run(key)
            scope = validate_completed_run(run)
            if run["state"] != "complete" or not scope["full_model_outputs"]:
                raise ValueError("Native demo stages must already be complete: " + key)
            retained_runtimes(run)
            for artifact in run["artifacts"].values():
                verify_file(directory, artifact)
            return {**run, "reused": True, "model_scope": scope}


def _control_source(ws, source, receipt, recipe_entry):
    if isinstance(source, dict):
        value = json.loads(json.dumps(source))
        original_record = {"parent": "original_receipt", "json_pointer": "/control"}
    else:
        path = Path(source).resolve(strict=True)
        original = path.read_bytes()
        value = json.loads(original)
        original_record = {"path": str(path), "bytes": len(original),
                           "sha256": hashlib.sha256(original).hexdigest()}
    if value.get("schema") != "upstate.simulated-control-preparation/v1":
        raise ValueError("Select the original matched-control preparation record")
    for field in ("project_id", "recipe_sha256", "baseline_run_id", "grid_id", "profile_id"):
        if value.get(field) != receipt[field]:
            raise ValueError("Matched control differs from the original " + field)
    collection = identifier(value["source_collection_id"])
    source, entry = ws.source_file(collection, "SIM_MATCHED_CONTROL_INPUT")
    control = read_json(source)
    if (entry["body"]["sha256"] != value["control_sha256"]
            or control.get("schema") != "upstate.simulated-control-input/v1"
            or control.get("base_recipe") != {
                "bytes": recipe_entry["body"]["bytes"], "sha256": receipt["recipe_sha256"]}
            or control.get("source_id") != value["source_id"]):
        raise ValueError("Control inputs differ from the original recipe and preparation record")
    _, mask_entry = ws.source_file(collection, value["source_id"])
    if (mask_entry.get("kind") != "raster" or
            mask_entry.get("classification") != "simulated" or
            mask_entry.get("recipe_sha256") != receipt["recipe_sha256"] or
            mask_entry.get("control_sha256") != value["control_sha256"]):
        raise ValueError("Control mask is missing its retained simulated recipe lineage")
    scenario = ws._get("scenarios", identifier(value["scenario_id"]))
    patches = scenario.get("patches", [])
    if (scenario["kind"] != "landcover" or
            scenario["source_collection_id"] != collection or len(patches) != 1 or
            patches[0].get("mask_source_id") != value["source_id"] or
            patches[0].get("from_codes") != control["scenario"]["from_codes"] or
            patches[0].get("to_code") != control["scenario"]["to_code"]):
        raise ValueError("Matched-control scenario differs from its original mask and conversion")
    return value, original_record


def adopt(workspace, receipt_path, *, output=None, control_receipt=None):
    receipt_path = Path(receipt_path).resolve(strict=True)
    target = Path(output).resolve() if output is not None else None
    control_path = Path(control_receipt).resolve(strict=True) if control_receipt is not None else None
    if target == receipt_path or (control_path is not None and target == control_path):
        raise ValueError("Retain the original demo receiving record and write Programme adoption separately")
    receipt_bytes = receipt_path.read_bytes()
    receipt_sha = hashlib.sha256(receipt_bytes).hexdigest()
    receipt = json.loads(receipt_bytes)
    if (receipt.get("schema") != "upstate.simulated-demo-receiving/v1"
            or receipt.get("demo_id") != DEMO_ID
            or receipt.get("operation") != OPERATION):
        raise ValueError("Select the original accepted simulated headwater receiving record")
    ws = CompletedWorkspace(workspace.root if isinstance(workspace, Workspace) else workspace)
    if ws.project["id"] != receipt.get("project_id"):
        raise ValueError("The receiving record belongs to another original Workspace")
    source_collection = identifier(receipt["source_collection_id"])
    recipe_id = receipt["source_ids"]["RECIPE"]
    recipe_path, recipe_entry = ws.source_file(source_collection, recipe_id)
    recipe = read_json(recipe_path)
    if (recipe_entry["body"]["sha256"] != receipt.get("recipe_sha256")
            or recipe.get("demo_id") != DEMO_ID
            or recipe.get("classification") != receipt.get("classification")
            or recipe.get("input_summary") != receipt.get("input_summary")):
        raise ValueError("Retained simulated recipe differs from the original receiving record")
    grid = ws.get_grid(identifier(receipt["grid_id"]))
    if grid["spec"]["source_collection_id"] != source_collection:
        raise ValueError("The native grid differs from the retained simulated source collection")
    roles = ("DEM", "NLCD", "PRECIPITATION", "R_FACTOR", "K_FACTOR")
    if grid["spec"]["input_sources"] != {role: receipt["source_ids"][role] for role in roles}:
        raise ValueError("Native grid inputs differ from the original receiving source IDs")
    for role in ("reporting_area", "model_domain"):
        if grid["spec"][role]["source_id"] != receipt["source_ids"][role]:
            raise ValueError("Native " + role + " differs from its retained simulated geometry")
    profile = ws._get("profiles", identifier(receipt["profile_id"]))
    if (profile["source_collection_id"] != source_collection or
            profile["biophysical_source_id"] != receipt["source_ids"]["BIOPHYSICAL"]):
        raise ValueError("The native coefficient profile differs from its simulated source edition")
    baseline_id = identifier(receipt["baseline_run_id"])
    alternatives = receipt.get("alternative_run_ids")
    scenarios = receipt.get("alternative_scenario_ids")
    if (not isinstance(alternatives, list) or not alternatives
            or not isinstance(scenarios, list) or len(scenarios) != len(alternatives)):
        raise ValueError("Retain each original alternative run and its scenario identity")
    ids = [baseline_id, *[identifier(value) for value in alternatives]]
    if len(ids) != len(set(ids)):
        raise ValueError("The native baseline and alternatives must be distinct")
    scenario_ids = [identifier(receipt["baseline_scenario_id"]),
                    *[identifier(value) for value in scenarios]]
    scenario_collections = {run_id: source_collection for run_id in ids}
    control, control_original = None, None
    embedded_control = receipt.get("control")
    if embedded_control is not None and not isinstance(embedded_control, dict):
        raise ValueError("Retain the original embedded matched-control preparation record")
    control_input = control_path if control_path is not None else embedded_control
    if control_input is not None:
        control, control_original = _control_source(ws, control_input, receipt, recipe_entry)
        if embedded_control is not None and control != embedded_control:
            raise ValueError("Explicit control receipt differs from the accepted demo's embedded control")
        control_id, control_scenario = identifier(control["run_id"]), identifier(control["scenario_id"])
        if control_id == baseline_id:
            raise ValueError("Matched control must differ from the original baseline")
        if control_id in ids:
            if scenario_ids[ids.index(control_id)] != control_scenario:
                raise ValueError("Receiving alternative differs from the selected matched control")
        else:
            ids.append(control_id)
            scenario_ids.append(control_scenario)
        scenario_collections[control_id] = identifier(control["source_collection_id"])
    rows, retained = [], []
    for index, (run_id, scenario_id) in enumerate(zip(ids, scenario_ids)):
        run = ws.inspect_run(run_id)
        scope = validate_completed_run(run)
        if run["state"] != "complete" or not scope["full_model_outputs"]:
            raise ValueError("Finish both original native models before Programme adoption: " + run_id)
        if tuple(run_models(run)) != ("ndr", "sdr"):
            raise ValueError("The accepted headwater case requires both original NDR and SDR")
        selected = run["selection"]
        if any(selected.get(key) != value for key, value in (
                ("grid_id", grid["id"]), ("profile_id", profile["id"]),
                ("scenario_id", scenario_id))):
            raise ValueError("An original native selection differs from the receiving record")
        retained_runtimes(run)
        scenario = ws._get("scenarios", scenario_id)
        wanted = "baseline" if index == 0 else "landcover"
        if scenario["kind"] != wanted or scenario["source_collection_id"] != scenario_collections[run_id]:
            raise ValueError("Retain the original simulated baseline and land-cover assumptions")
        key = ("matched-control" if control is not None and run_id == control["run_id"] else
               "baseline" if index == 0 else "conservation" if index == 1 else "alternative-" + str(index))
        rows.append({
            "key": key, "title": scenario["title"], "profile_id": profile["id"],
            "scenario_id": scenario_id, "models": ["ndr", "sdr"],
            "native_run_id": run_id,
            "reason": scenario["reason"],
        })
        retained.append({"key": key, "run_id": run_id, "scenario_id": scenario_id,
                         "scenario_source_collection_id": scenario["source_collection_id"]})
    delivery_id = receipt.get("delivery_id")
    delivery = None
    if delivery_id:
        delivery = ws.retained_item("deliveries", identifier(delivery_id))
        selected = delivery["selection"]
        mapped_ids = selected.get("scenario_run_ids")
        if (delivery.get("state") != "complete" or
                selected["baseline_run_id"] != baseline_id or
                not isinstance(mapped_ids, list) or not mapped_ids or
                len(set(mapped_ids)) != len(mapped_ids) or set(mapped_ids) - set(ids[1:])):
            raise ValueError("The existing mapped delivery differs from the selected native cases")

    selection = {
        "schema": "upstate.compute-programme-selection/v1",
        "title": recipe["title"] + " — native run programme",
        "description": "SIMULATED input study: retain the original completed NDR/SDR baseline and explicit land-cover alternatives for programme comparison, map delivery and teaching.",
        "source_reference": OPERATION + " / recipe-sha256:" + receipt["recipe_sha256"],
        "grid_id": grid["id"], "baseline_run": "baseline", "runs": rows,
    }
    manager = ComputeProgrammes(ws)
    preview = manager.preview(selection)
    if [row["run_id"] for row in preview["runs"]] != ids:
        raise ValueError("Programme adoption would select another native run")
    timings = {}
    started = time.perf_counter()
    programme = manager.create(selection)
    timings["programme_create_seconds"] = time.perf_counter() - started
    # The small Workspace adapter above only verifies completed originals.
    # The existing Programme still owns state, comparison and report production;
    # this receiving command has no route to execute missing native stages.
    started = time.perf_counter()
    status = manager.execute(programme["id"])
    timings["completed_run_reconciliation_seconds"] = time.perf_counter() - started
    if status["state"] != "complete":
        raise ValueError("Open the retained Programme for its original comparison/report error: " + programme["id"])
    for row in status["runs"]:
        attempts = row.get("attempts", [])
        if row["run_id"] not in ids or not attempts or attempts[-1].get("reused") is not True:
            raise ValueError("Programme must retain verification of the already-completed native runs")
    report = manager.read_report(programme["id"])
    report_selection = {
        "delivery_mode": "native_study",
        "native_study": {
            "title": recipe["title"],
            "purpose": "SIMULATED inputs operated through the original NDR/SDR models and explicit conservation alternatives for the accepted teaching workflow.",
            "reference": "recipe-sha256:" + receipt["recipe_sha256"],
        },
        "baseline_run": "baseline", "scenario_runs": [row["key"] for row in rows[1:]],
    }
    if delivery is not None:
        # Carry the completed source-aware map selection forward, including
        # original overlays, native-process figures and their retained IDs.
        report_selection = json.loads(json.dumps(delivery["selection"]))
        report_selection.pop("baseline_run_id")
        report_selection.pop("scenario_run_ids")
        report_selection["baseline_run"] = "baseline"
        names = {row["run_id"]: row["key"] for row in retained}
        report_selection["scenario_runs"] = [names[run_id] for run_id in delivery["selection"]["scenario_run_ids"]]
    map_preview = manager.delivery_preview(programme["id"], report_selection)
    if not map_preview["ready"]:
        raise ValueError("The retained native cases are not ready for their study map delivery")
    result = {
        "schema": "upstate.simulated-programme-receiving/v1",
        "operation": OPERATION, "demo_id": DEMO_ID,
        "classification": recipe["classification"],
        "project_id": ws.project["id"], "workspace": str(ws.root),
        "application": str(APPLICATION), "programme_id": programme["id"],
        "programme_state": status["state"], "native_runs": retained,
        "source_collection_id": source_collection, "recipe_sha256": receipt["recipe_sha256"],
        "input_summary": recipe["input_summary"],
        "original_receipt": {"path": str(receipt_path), "bytes": len(receipt_bytes), "sha256": receipt_sha},
        "existing_delivery_id": delivery_id,
        "existing_delivery_run_ids": delivery["selection"]["scenario_run_ids"] if delivery else [],
        "control": control, "original_control_receipt": control_original,
        "report": {"schema": report["schema"], "programme_id": report["programme_id"],
                   "rows": report["rows"], "files": report.get("files", [])},
        "native_study_selection": report_selection,
        "delivery_preview": map_preview, "timings": timings, "completed_at": now(),
    }
    if target is not None:
        atomic_json(target, result)
    return result


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", required=True)
    parser.add_argument("--receipt", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--control-receipt", help="Original control-prepared.json after its native run completes")
    args = parser.parse_args(argv)
    result = adopt(args.workspace, args.receipt, output=args.output, control_receipt=args.control_receipt)
    print(json.dumps(result, indent=2, sort_keys=True, allow_nan=False))


if __name__ == "__main__":
    main()
