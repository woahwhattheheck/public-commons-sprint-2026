#!/usr/bin/env python3
"""Bind the retained simulated headwater case to the maintained rehearsal.

This adapter reads existing scientific records and writes the original
rehearsal input. operator/rehearsal_receiving.py owns tasks, media and receiving.
"""
from __future__ import annotations
import argparse
import hashlib
import json
from pathlib import Path
import sys

APP = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(APP))
from model.common import atomic_bytes, atomic_json, file_digest, held, identifier, read_json
from model.workspace import Workspace

DEMO_ID = "upstate-simulated-piedmont-headwaters-v1"
RECEIPT_SCHEMA = "upstate.simulated-demo-receiving/v1"
OPERATION = "UPSTATE-DEMO-SIMULATED-INPUTS-20261013T140000Z-TEACHING"
GUIDE = "source/simulated_headwaters_20261013/TEACHING_GUIDE.md"
OPTIONAL = {"comparison_id": "comparisons", "delivery_id": "deliveries",
            "spatial_review_id": "spatial_reviews"}

STEP_NOTES = {
    "study": "Open the retained simulated source edition and input assumptions. This is the 1,296-ha Piedmont-style teaching landscape generated for this operation. Every source raster, polygon and coefficient belongs to that explicitly simulated edition.",
    "geography": "Show the 120 by 120 projected 30-metre grid, reporting polygon and two tributary valleys. Each cell covers 0.09 ha. Read the saved model domain and reporting support from the selected grid.",
    "parameters": "Read the saved biophysical table, NDR/SDR parameters and model version. The climate, soils and annual load coefficients are declared demonstration assumptions. SDR l_max is the dimensionless L-factor cap, selected value 122. Keep the selected profile fixed between land-cover alternatives.",
    "alternatives": "Show the baseline, 90-metre riparian restoration and saved matched-area control. Each restoration converts 236 pasture and 399 crop cells to forest: 635 cells, 57.15 ha. The control places those cells outside the 90-metre corridor. Inspect each actual saved mask, native scenario ID and residual terrain/climate differences. Same area and starting classes support a siting comparison; native exports determine the computed response.",
    "calculation": "Open the actual native NDR/SDR stages, logs and timestamps for these selected run IDs. Reopening completed runs is recorded-result inspection. The original source preparation and native calculation durations remain separate from this walkthrough.",
    "maps": "Read the selected quantity, unit, extent and legend. Original InVEST 3.20 export rasters are annual densities: N/P kg/ha/year and sediment metric tonnes/ha/year. Integrated Workspace export cells contain kg/year or tonnes/year after multiplying by the actual pixel hectares once. Native watershed vectors already contain annual mass. Read the selected artifact units before summing or comparing. Source-water and conservation overlay areas are explicitly simulated planning areas.",
    "comparison": "Read the actual returned baseline and alternative quantities and their common valid support. Ordinary native signed change is alternative minus baseline: a negative export change is a reduction. State the units and supported area before interpreting a percentage.",
    "delivery": "Open the retained native-study delivery and its seven map families, report and original files. Show physical quantities separately from combined priority scores. Read the computed response without assuming restoration must yield a particular sign or magnitude.",
    "transfer": "Download the actual scientific archive, receive it independently, and reopen the same project and selected results. Keep the original archive, receiving identity, later local note and teaching packet together.",
}

def absolute(value, label, *, exists=False):
    if not isinstance(value, str) or not Path(value).is_absolute():
        raise ValueError(label + " must be an explicit absolute path")
    return Path(value).resolve(strict=exists)

def save_native_review(ws, receipt, selected):
    """Save the original paired map view from this case's completed native layers."""
    from model.spatial import SpatialReview
    spatial = SpatialReview(ws)
    catalog = spatial.catalog()
    quantity = "nitrogen_export"

    def layer_for(run_id):
        found = [row for row in catalog["layers"]
                 if row.get("group") == "run" and row.get("run_id") == run_id
                 and row.get("role") == quantity and row.get("kind") == "raster"]
        if len(found) != 1:
            raise ValueError("Retain one original nitrogen export layer for run " + run_id)
        return {"layer_id": found[0]["id"], "band": 1}

    baseline = layer_for(selected["baseline_run_id"])
    alternative_id = selected["alternative_run_ids"][0]
    alternative = layer_for(alternative_id)
    alternative_run = ws.inspect_run(alternative_id)
    alternative_scenario = ws.retained_item(
        "scenarios", identifier(alternative_run["selection"]["scenario_id"]))
    alternative_title = str(alternative_scenario.get("title") or alternative_scenario["id"])
    if receipt.get("spatial_review_id") is not None:
        review = ws.retained_item("spatial_reviews", identifier(receipt["spatial_review_id"]))
        if (review.get("reference") != baseline or review.get("primary") != baseline
                or review.get("comparison") != alternative or review.get("mode") != "swipe"):
            raise ValueError("The retained teaching map belongs to a different original layer selection")
        checked = spatial.validate_saved(review)
        if checked.get("identity") != "MATCH":
            raise ValueError("The retained teaching map's original bindings did not match")
        return review
    request = {
        "reference": baseline, "primary": baseline, "comparison": alternative,
        "mode": "swipe", "scale": {"mode": "auto"},
        "size": {"width": 960, "height": 720},
    }
    frame = spatial.frame(request)
    pair = frame.get("pair", {})
    if not pair.get("aligned") or not pair.get("comparable"):
        raise ValueError("The original teaching map pair is not comparable: " + str(pair.get("reason")))
    review = spatial.save({
        "title": "SIMULATED: baseline versus " + alternative_title + " - nitrogen export",
        "reference": baseline, "primary": baseline, "comparison": alternative,
        "mode": "swipe", "view": frame["view"], "scale": {"mode": "auto"},
        "swipe": 50, "overlays": [], "markers": [],
        "notes": "Original simulated headwaters case " + DEMO_ID
            + "; recipe SHA256 " + str(receipt.get("recipe_sha256", ""))
            + ". Baseline " + selected["baseline_run_id"] + "; alternative " + alternative_id
            + ". Both panels retain the actual same-grid nitrogen-export layers and shared display scale. "
              "Read each native layer's units. A native comparison uses alternative minus baseline.",
    })
    checked = spatial.validate_saved(review)
    if checked.get("identity") != "MATCH":
        raise ValueError("The saved teaching map's original bindings did not match")
    return review


def selected_teaching_case(ws, receipt, selected):
    """Read the maintained selection and its original science; never calculate."""
    from model.rehearsal import Rehearsal
    from model.scenario_footprint import get_footprint

    captured = Rehearsal(ws)._capture(selected)
    evidence = {step["id"]: step["evidence"] for step in captured["steps"]}
    runs = evidence["calculation"]["runs"]
    scenarios = evidence["alternatives"]["scenarios"]
    expected_runs = [selected["baseline_run_id"], *selected["alternative_run_ids"]]
    if [run["id"] for run in runs] != expected_runs or len(scenarios) != len(runs):
        raise ValueError("The retained teaching capture differs from its selected native runs")
    for step in captured["steps"]:
        if step["id"] in {"study", "geography", "parameters", "alternatives",
                          "calculation", "comparison", "delivery"} and not step["ready"]:
            raise ValueError("Finish the selected native teaching evidence: " + step["title"])

    footprint_ids = receipt.get("scenario_footprint_ids", [])
    if not isinstance(footprint_ids, list):
        raise ValueError("Retain the original scenario-footprint identifier list")
    footprints = {}
    for key in dict.fromkeys(footprint_ids):
        footprint = get_footprint(ws, identifier(key))
        run_id = footprint["run_id"]
        if run_id not in expected_runs:
            continue
        if run_id in footprints:
            raise ValueError("The receipt selects more than one footprint edition for " + run_id)
        footprints[run_id] = footprint

    profiles, choices = {}, []
    for index, (run, scenario) in enumerate(zip(runs, scenarios)):
        selection = run["selection"]
        profile_id = selection["profile_id"]
        profile = ws.retained_item("profiles", profile_id)
        profiles[profile_id] = {key: profile.get(key) for key in (
            "id", "title", "models", "source_collection_id", "biophysical_source_id",
            "ndr", "sdr", "table_summary")}
        footprint = footprints.get(run["id"])
        if footprint is not None and footprint["selection"] != selection:
            raise ValueError("The selected footprint differs from its original run selection")
        choices.append({
            "role": "baseline" if index == 0 else "alternative " + str(index),
            "run_id": run["id"], "scenario_id": scenario["id"],
            "scenario_title": scenario["title"], "scenario_kind": scenario.get("kind"),
            "profile_id": profile_id, "profile_title": profile.get("title"),
            "profile_changed": profile_id != selected["profile_id"],
            "models": run["scope"]["selected_models"],
            "patches": scenario.get("patches", []),
            "footprint_id": footprint["id"] if footprint else None,
            "footprint_summary": footprint["summary"] if footprint else None,
            "transitions": footprint["transitions"] if footprint else None,
            "native_artifacts": run["artifacts"],
        })
    comparison = evidence["comparison"]["comparison"]
    changes = [
        {"run_id": row["run_id"], "profile_changed": row.get("profile_changed", False),
         "quantity": name, "alternative_minus_baseline": artifact.get("sum_change"),
         "units": str(artifact.get("units") or "").replace("/pixel", "") or None,
         "raster_units": artifact.get("units"), "common_valid_cells": artifact.get("valid_cells"),
         "direction": artifact.get("direction", "alternative minus baseline")}
        for row in comparison["alternatives"]
        for name, artifact in row.get("artifacts", {}).items()
    ]

    parameter_course = None
    if receipt.get("ensemble_id") is not None:
        from source_tools.headwaters_parameter_course import _load
        record, plan, directory = _load(ws, identifier(receipt["ensemble_id"]))
        expected_scenarios = [scenario["id"] for scenario in scenarios]
        selection = record["selection"]
        if (selection["grid_id"] != selected["grid_id"]
                or selection["base_profile_id"] != selected["profile_id"]
                or [selection["baseline_scenario_id"], *selection["alternative_scenario_ids"]]
                != expected_scenarios):
            raise ValueError("The retained parameter course belongs to different teaching scenarios")
        result_path = directory / "headwaters-results.json"
        results = read_json(result_path) if result_path.exists() else None
        if results is not None:
            if (results.get("project_id") != ws.project["id"]
                    or results.get("ensemble_id") != plan["id"]
                    or results.get("selection") != selection):
                raise ValueError("The retained parameter result belongs to another saved course")
            if receipt.get("parameter_course") is not None and receipt["parameter_course"] != results:
                raise ValueError("Refresh the original receiving receipt after its parameter-course continuation")
        parameter_course = {
            "ensemble_id": plan["id"], "selection": selection,
            "progress": plan["progress"], "results": results,
            "course_sha256": file_digest(directory / "headwaters-course.json"),
            "result_sha256": file_digest(result_path) if results is not None else None,
            "direction": "baseline minus alternative",
            "support_basis": "Original paired-ensemble products and their per-metric common support",
        }
    return {
        "schema": "upstate.simulated-teaching-selection/v1",
        "project_id": ws.project["id"], "demo_id": DEMO_ID,
        "selection": captured["selection"], "runs": choices,
        "profiles": list(profiles.values()), "comparison_id": comparison["id"],
        "native_changes": changes, "native_direction": "alternative minus baseline",
        "native_support_basis": "Each original comparison raster's common valid cells",
        "parameter_course": parameter_course,
    }


def teaching_notes(case):
    notes = dict(STEP_NOTES)
    changing = [row for row in case["runs"][1:] if row["profile_changed"]]
    notes["parameters"] = (
        "Read each selected run's retained profile, biophysical table and model version. "
        "SDR l_max is the dimensionless L-factor cap. "
        + (str(len(changing)) + " selected alternatives change the baseline profile; explain those "
           "as parameter sensitivity using their actual profiles. " if changing else
           "All selected native alternatives retain the baseline profile. ")
        + "The original selected-case.json and selected-case.md identify every run and profile.")
    descriptions = []
    for row in case["runs"]:
        summary = row["footprint_summary"]
        footprint = (
            str(summary["net_changed_cells"]) + " net changed cells, "
            + str(summary["net_changed_hectares"]) + " ha"
            if summary is not None else "read the retained scenario patches; no footprint edition is selected")
        descriptions.append(row["role"] + ": " + row["scenario_title"] + "; " + footprint
                            + "; " + ("profile sensitivity" if row["profile_changed"] else "baseline profile")
                            + "; run " + row["run_id"])
    notes["alternatives"] = (
        "Read the actual selected scenarios in their saved comparison order. "
        + " | ".join(descriptions)
        + ". Compare the original masks, transitions and residual landscape differences. "
          "The selected footprint describes each scenario's change from its original grid land cover.")
    notes["comparison"] = (
        "Read selected-case.md and the saved comparison. Each native change is alternative minus baseline "
        "on that quantity's original common valid cells; negative export change means reduction. "
        "The per-run full totals can use different support and are not substituted for the paired change.")
    if case["parameter_course"] is not None:
        course = case["parameter_course"]
        notes["parameters"] += " Retained parameter course: " + course["ensemble_id"] + "."
        notes["comparison"] += (
            " The separate paired-ensemble course uses baseline minus alternative, so a positive "
            "reduction has the opposite printed sign. Read that product's metric support and member "
            "completion from its original result; its members remain within the ensemble.")
    return notes


def teaching_markdown(case):
    def cell(value):
        if value is None:
            return "Unspecified"
        return str(value).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace("|", "\\|").replace("\n", " ")
    def table(headings, rows):
        return "\n".join(["| " + " | ".join(headings) + " |",
                          "| " + " | ".join("---" for _ in headings) + " |"]
                         + ["| " + " | ".join(cell(value) for value in row) + " |" for row in rows])
    rows = []
    for row in case["runs"]:
        footprint = row["footprint_summary"] or {}
        rows.append([
            row["role"], row["scenario_title"], row["profile_title"] or row["profile_id"],
            "Parameter sensitivity" if row["profile_changed"] else "Baseline profile",
            footprint.get("net_changed_cells"), footprint.get("net_changed_hectares"),
            row["run_id"]])
    text = ("# Selected native teaching case\n\nProject: " + case["project_id"]
            + "\n\nThe following values come from the exact retained selection; no model is run by this binding.\n\n"
            + table(["Role", "Saved scenario", "Saved profile", "Profile relation",
                     "Changed cells", "Changed hectares", "Run ID"], rows)
            + "\n\n## Native comparison on common valid cells\n\n"
            + "Direction: alternative minus baseline. A negative export change is a reduction. "
              "Each row uses its original comparison raster's common support.\n\n"
            + table(["Run ID", "Quantity", "Signed change", "Units", "Common valid cells"],
                    [[row["run_id"], row["quantity"], row["alternative_minus_baseline"],
                      row["units"], row["common_valid_cells"]] for row in case["native_changes"]])
            + "\n\nFull original artifact descriptors, scenario patches, transitions, profile parameters "
              "and source identities remain in selected-case.json and the scientific Workspace.\n")
    course = case["parameter_course"]
    if course is not None:
        results = course["results"] or {}
        progress = course["progress"]
        text += ("\n## Retained parameter course\n\nEnsemble: " + course["ensemble_id"]
                 + "\n\nNative runs complete: " + str(progress["complete"]) + " / "
                 + str(progress["total"]) + ". Course state: " + str(results.get("state", "prepared"))
                 + ".\n\nThe paired-ensemble products use baseline minus alternative: positive means "
                   "reduction. Read their original per-metric common support, profile members and "
                   "joint decision products. These results remain separate from the ordinary native "
                   "comparison above.\n")
    return text


def bind(receipt_path, output, *, workspace=None, browser=None, operation_id=OPERATION,
         save_spatial_review=False):
    receipt_path = Path(receipt_path).resolve(strict=True)
    # This is the same native case's lock; source binding and receipt continuation
    # cannot overlap the runner's writes. The rehearsal run starts after release.
    if save_spatial_review:
        with held(receipt_path.parent / ".demo-operation.lock", blocking=False):
            return _bind(receipt_path, output, workspace=workspace, browser=browser,
                         operation_id=operation_id, save_spatial_review=True)
    return _bind(receipt_path, output, workspace=workspace, browser=browser,
                 operation_id=operation_id)


def _bind(receipt_path, output, *, workspace=None, browser=None, operation_id=OPERATION,
          save_spatial_review=False):
    receipt_path = Path(receipt_path).resolve(strict=True)
    receipt_bytes = receipt_path.read_bytes()
    receipt = json.loads(receipt_bytes)
    if receipt.get("schema") != RECEIPT_SCHEMA or receipt.get("demo_id") != DEMO_ID:
        raise ValueError("Select the original simulated headwater receiving receipt")
    declared_workspace = receipt.get("workspace_directory", receipt.get("workspace_path"))
    root = absolute(str(workspace) if workspace is not None else declared_workspace,
                    "Workspace", exists=True)
    output = absolute(str(output), "Rehearsal output")
    if output == root or output in root.parents or root in output.parents:
        raise ValueError("Keep rehearsal output and the scientific Workspace in separate directories")
    ws = Workspace(root)
    expected_project = receipt.get("workspace_id", receipt.get("project_id"))
    if expected_project is not None and expected_project != ws.project["id"]:
        raise ValueError("The receiving receipt belongs to a different project")
    collection = ws.retained_item("sources", identifier(receipt.get("source_collection_id")))
    grid = ws.get_grid(identifier(receipt.get("grid_id")))
    profile = ws.retained_item("profiles", identifier(receipt.get("profile_id")))
    baseline_id = identifier(receipt.get("baseline_run_id"))
    alternatives = receipt.get("alternative_run_ids")
    if not isinstance(alternatives, list) or not alternatives:
        raise ValueError("Retain at least one actual alternative run ID")
    alternatives = [identifier(value) for value in alternatives]
    if len(set(alternatives)) != len(alternatives) or baseline_id in alternatives:
        raise ValueError("Select distinct baseline and alternative runs")
    runs = [ws.inspect_run(key) for key in [baseline_id, *alternatives]]
    if runs[0]["selection"].get("profile_id") != profile["id"]:
        raise ValueError("The selected teaching profile differs from the actual baseline")
    for run in runs:
        selection = run["selection"]
        if selection.get("grid_id") != grid["id"]:
            raise ValueError("The teaching alternatives must retain this same original grid")
        if run.get("state") != "complete":
            raise ValueError("Complete the selected native run before freezing its recorded rehearsal: " + run["id"])
    selected = {
        "source_collection_id": collection["id"], "grid_id": grid["id"],
        "profile_id": profile["id"], "baseline_run_id": baseline_id,
        "alternative_run_ids": alternatives,
        "comparison_id": None, "delivery_id": None, "spatial_review_id": None,
        "backup_task_id": None, "restore_task_id": None,
    }
    for field, kind in OPTIONAL.items():
        if receipt.get(field) is not None:
            selected[field] = identifier(receipt[field])
            ws.retained_item(kind, selected[field])
    if selected["comparison_id"] is None or selected["delivery_id"] is None:
        raise ValueError("Finish the demo comparison and native-study delivery before freezing the full teaching selection")
    delivery = ws.retained_item("deliveries", selected["delivery_id"])
    if delivery.get("state") != "complete":
        raise ValueError("Complete the selected native-study delivery before freezing the full teaching selection")
    case = selected_teaching_case(ws, receipt, selected)
    if save_spatial_review:
        if selected["spatial_review_id"] is None:
            review = save_native_review(ws, receipt, selected)
            selected["spatial_review_id"] = review["id"]
            receipt["spatial_review_id"] = review["id"]
            atomic_json(receipt_path, receipt)
            receipt_bytes = receipt_path.read_bytes()
        else:
            save_native_review(ws, receipt, selected)
    if selected["spatial_review_id"] is not None:
        case["selection"]["spatial_review_id"] = selected["spatial_review_id"]
    receipt_sha256 = hashlib.sha256(receipt_bytes).hexdigest()
    if browser is not None:
        if set(browser) != {"node", "playwright_module", "executable"}:
            raise ValueError("Browser config requires node, playwright_module and executable")
        browser = {key: str(absolute(path, "Browser " + key, exists=True))
                   for key, path in browser.items()}
    value = {
        "schema": "upstate.rehearsal-receiving-input/v1",
        "operation_id": operation_id,
        "workspace_directory": str(root), "output_directory": str(output),
        "rehearsal": {
            "title": "Simulated Piedmont headwaters - native restoration walkthrough",
            "operator": "Bryce", "audience": "Internal product teaching",
            "mode": "recorded", "selection": selected,
            "notes": "Use " + GUIDE + " and uploads/simulated-headwaters/selected-case.md. "
                + "Original case receipt SHA256: " + receipt_sha256
                + ". Read each selected scenario, profile, footprint and common-support change from its actual retained records.",
            "science_notes": "Explicitly simulated inputs; 1,296 ha, 30-metre cells, EPSG:26917. The selected runs share the original grid; read each retained profile and any parameter-sensitivity selection. Original InVEST 3.20 export rasters are N/P kg/ha/year or sediment metric tonnes/ha/year; integrated Workspace export cells contain annual mass using actual pixel hectares once. Native watershed vectors already contain annual mass. Native comparison is alternative minus baseline. The retained field chapter uses original simulated total-phosphorus concentrations in mg/L as P, with separate source support and native QC history.",
        },
        "fresh_run_ids": [], "step_notes": teaching_notes(case),
        "task_timeout_seconds": 7200, "browser": browser,
    }
    # Use the maintained validator, preserving its current input contract.
    sys.path.insert(0, str(APP / "operator"))
    from rehearsal_receiving import validate
    validate(value)
    output.mkdir(parents=True, exist_ok=True)
    teaching = output / "uploads" / "simulated-headwaters"
    teaching.mkdir(parents=True, exist_ok=True)
    atomic_bytes(teaching / "original-demo-receiving.json", receipt_bytes, immutable=True)
    atomic_json(output / "input.json", value, immutable=True)
    guide = APP / GUIDE
    atomic_bytes(teaching / "TEACHING_GUIDE.md", guide.read_bytes(), immutable=True)
    atomic_json(teaching / "selected-case.json", case, immutable=True)
    atomic_bytes(teaching / "selected-case.md", teaching_markdown(case).encode("utf-8"), immutable=True)
    return {"input": str(output / "input.json"), "project_id": ws.project["id"],
            "selection": selected, "receipt_sha256": receipt_sha256,
            "guide": str(teaching / "TEACHING_GUIDE.md"),
            "selected_case": str(teaching / "selected-case.json"),
            "selected_case_sha256": file_digest(teaching / "selected-case.json"),
            "selected_case_guide": str(teaching / "selected-case.md")}

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--receipt", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True,
                        help="Separate persistent directory for the existing rehearsal programme")
    parser.add_argument("--workspace", type=Path,
                        help="Explicit current path after moving the same retained project")
    parser.add_argument("--browser-config", type=Path,
                        help="JSON with existing absolute node/playwright_module/executable paths")
    parser.add_argument("--operation-id", default=OPERATION)
    parser.add_argument("--save-spatial-review", action="store_true",
                        help="Save the existing paired native map and retain its ID in this same case receipt")
    parser.add_argument("--run", action="store_true",
                        help="Continue the existing rehearsal receiver after binding")
    parser.add_argument("--native-only", action="store_true",
                        help="Retain native phase before the configured authorized browser continuation")
    args = parser.parse_args()
    browser = read_json(args.browser_config) if args.browser_config else None
    result = bind(args.receipt, args.output, workspace=args.workspace,
                  browser=browser, operation_id=args.operation_id,
                  save_spatial_review=args.save_spatial_review)
    if args.run:
        from rehearsal_receiving import run
        result["receiving"] = run(Path(result["input"]), skip_browser=args.native_only)
    print(json.dumps(result, ensure_ascii=False, indent=2))

if __name__ == "__main__":
    main()
