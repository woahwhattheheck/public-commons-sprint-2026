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

from model.common import atomic_json, digest, held, identifier, now, read_json, verify_file
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


def _control_source(ws, source, receipt, recipe_entry, recipe):
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
    if entry["body"]["sha256"] != value["control_sha256"]:
        raise ValueError("Control document differs from its original preparation record")
    if control.get("schema") == "upstate.simulated-control-input/v1":
        if (control.get("base_recipe") != {
                "bytes": recipe_entry["body"]["bytes"], "sha256": receipt["recipe_sha256"]}
                or control.get("source_id") != value["source_id"]):
            raise ValueError("Control inputs differ from the original recipe and source ID")
    elif control.get("schema") == "upstate.simulated-matched-control/v1":
        if (control.get("source_recipe_sha256") != receipt["recipe_sha256"]
                or control.get("demo_id") != recipe["demo_id"]
                or control.get("grid") != recipe["grid"]
                or control.get("mask_role") != "MATCHED_CONTROL_MASK"
                or value["source_id"] != "SIM_MATCHED_CONTROL_MASK"):
            raise ValueError("Matched-control inputs differ from the retained recipe, grid or mask role")
    else:
        raise ValueError("Select an original published simulated control input edition")
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



def _operator_opening(ws, receipt, rows, status, programme_id, delivery):
    """Bind the existing Guided journey to one actual mapped alternative."""
    alternatives = [row["run_id"] for row in rows[1:]]
    mapped = delivery["selection"]["scenario_run_ids"] if delivery else alternatives
    focus_id = next(run_id for run_id in alternatives if run_id in mapped)
    run = ws.inspect_run(focus_id)
    baseline_id = receipt["baseline_run_id"]
    selected_row = next(row for row in rows if row["run_id"] == focus_id)
    comparison_id = receipt.get("comparison_id")
    if not comparison_id:
        comparison_id = status["comparisons"][selected_row["key"]]["id"]
    comparison = ws.retained_item("comparisons", identifier(comparison_id))
    if (comparison["baseline_run_id"] != baseline_id or
            focus_id not in [row["run_id"] for row in comparison.get("alternatives", [])]):
        raise ValueError("The opening comparison differs from its original baseline and alternative")
    review_id = (receipt.get("spatial_review_ids") or {}).get(focus_id)
    if not review_id and focus_id == alternatives[0]:
        review_id = receipt.get("spatial_review_id")
    if review_id:
        from model.spatial import SpatialReview
        spatial = SpatialReview(ws)
        review = ws.retained_item("spatial_reviews", identifier(review_id))
        catalog = {row["id"]: row for row in spatial.catalog()["layers"]}
        for field, wanted in (("primary", baseline_id), ("reference", baseline_id),
                              ("comparison", focus_id)):
            layer = catalog.get((review.get(field) or {}).get("layer_id"))
            if layer is None or layer.get("group") != "run" or layer.get("run_id") != wanted:
                raise ValueError("The opening spatial view differs from its selected original runs")
        if spatial.validate_saved(review).get("identity") != "MATCH":
            raise ValueError("The opening spatial view differs from its retained native sources")
    selection = {
        "baseline_run_id": baseline_id, "grid_id": run["selection"]["grid_id"],
        "profile_id": run["selection"]["profile_id"], "scenario_id": run["selection"]["scenario_id"],
        "run_id": focus_id, "models": ["ndr", "sdr"], "comparison_id": comparison["id"],
        "spatial_review_id": review_id or "", "spatial_export_id": "",
        "delivery_id": delivery["id"] if delivery else "", "calibration_review_id": "",
    }
    context = {
        "operation": OPERATION, "demo_id": DEMO_ID,
        "project_id": ws.project["id"], "programme_id": programme_id,
        "recipe_sha256": receipt["recipe_sha256"], "selection": selection,
        "alternative_run_ids": alternatives,
    }
    opening_id = digest(context)
    journey = {
        "schema": "upstate.operating-journey/v1", "project_id": ws.project["id"],
        "step": "compare", "selection": selection, "regional": None, "community": None,
        "notes": (
            "SIMULATED headwater inputs; original completed InVEST 3.20 NDR/SDR outputs. "
            "The selected comparison joins the saved baseline and mapped conservation alternative. "
            "Inspect the selected native quantities, common coverage and original map legend. "
            "Run programme: " + programme_id + ". "
            "Original recipe SHA256: " + receipt["recipe_sha256"] + "."
        ),
        "note_versions": [],
        "recorded_context": {"project_title": ws.project["title"],
                             "operator_opening": {"id": opening_id, **context}},
    }
    if isinstance(run.get("completed_at"), str):
        journey["started_at"] = run["completed_at"]
    return {
        "schema": "upstate.simulated-operator-opening/v1", "id": opening_id,
        "entry_view": "journey", "programme_view": "programmes",
        "programme_id": programme_id, "journey": journey,
        "meaning": "Original saved Guided journey selections for this same completed simulated case.",
    }


def save_operator_opening(operator, workspace_key, receiving):
    """Save through the receiving owner's existing live Operator session API.

    Invoke once before its final portable capture. This function creates no
    server, task, or model run; the original API owns validation and revision
    conflict handling. Existing notes remain in that API's retained history.
    """
    if receiving.get("schema") != "upstate.simulated-programme-receiving/v1":
        raise ValueError("Use the original completed Programme receiving record")
    opening = receiving.get("operator_opening")
    if not isinstance(opening, dict) or opening.get("schema") != "upstate.simulated-operator-opening/v1":
        raise ValueError("Retain this Programme's original operator opening")
    ws = operator.ws(workspace_key)
    if receiving.get("project_id") != ws.project["id"]:
        raise ValueError("Save the opening in its original project or verified restored copy")
    journey = json.loads(json.dumps(opening["journey"]))
    context = journey["recorded_context"]["operator_opening"]
    original = {key: value for key, value in context.items() if key != "id"}
    if (digest(original) != opening["id"] or context.get("id") != opening["id"]
            or context.get("project_id") != ws.project["id"]
            or context.get("programme_id") != receiving.get("programme_id")
            or opening.get("programme_id") != receiving.get("programme_id")
            or original.get("selection") != journey.get("selection")):
        raise ValueError("The original operator opening identity or Programme binding differs")
    manager = ComputeProgrammes(ws)
    status = manager.status(identifier(opening["programme_id"]))
    if (status.get("state") != "complete" or
            {row["run_id"] for row in status["runs"]} !=
            {journey["selection"]["baseline_run_id"], *context["alternative_run_ids"]}):
        raise ValueError("The saved opening must use this completed Programme's exact native cases")
    current = operator.operator_session(workspace_key)
    previous = (current or {}).get("journey", {})
    previous_context = previous.get("recorded_context", {}).get("operator_opening", {})
    if (previous_context.get("id") == opening["id"] and
            previous.get("selection") == journey["selection"]):
        saved = current
    else:
        saved = operator.save_operator_session(workspace_key, {
            "journey": journey, "expected_revision": (current or {}).get("revision"),
        })
    readback = operator.operator_session(workspace_key)
    if readback != saved or readback["journey"].get("selection") != journey["selection"]:
        raise ValueError("Saved operator selection readback differs")
    session_bytes = (ws.root / "operator-session.json").read_bytes()
    if json.loads(session_bytes) != saved:
        raise ValueError("The operator view changed during receiving; reopen its current saved selection")
    descriptor = {"path": "operator-session.json", "bytes": len(session_bytes),
                  "sha256": hashlib.sha256(session_bytes).hexdigest()}
    return {
        "schema": "upstate.simulated-operator-opening-receipt/v1",
        "project_id": ws.project["id"], "opening_id": opening["id"],
        "programme_id": opening["programme_id"], "revision": saved["revision"],
        "operator_session": saved, "operator_session_file": descriptor, "journey": saved["journey"],
        "entry_view": opening["entry_view"], "programme_view": opening["programme_view"],
        "selection": journey["selection"],
    }


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
        control, control_original = _control_source(ws, control_input, receipt, recipe_entry, recipe)
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
        "report": {"schema": report["schema"], "id": report["id"], "programme_id": report["programme_id"],
                   "rows": report["rows"], "files": report.get("files", [])},
        "native_study_selection": report_selection,
        "operator_opening": _operator_opening(ws, receipt, retained, status, programme["id"], delivery),
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
