#!/usr/bin/env python3
"""Bind the retained simulated headwater case to the maintained rehearsal.

This adapter reads existing scientific records and writes the original
rehearsal input. operator/rehearsal_receiving.py owns tasks, media and receiving.
"""
from __future__ import annotations
import argparse
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
    for run in runs:
        selection = run["selection"]
        if selection.get("grid_id") != grid["id"] or selection.get("profile_id") != profile["id"]:
            raise ValueError("The teaching alternatives must retain this same grid and profile")
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
    if save_spatial_review:
        if selected["spatial_review_id"] is None:
            review = save_native_review(ws, receipt, selected)
            selected["spatial_review_id"] = review["id"]
            receipt["spatial_review_id"] = review["id"]
            atomic_json(receipt_path, receipt)
            receipt_bytes = receipt_path.read_bytes()
        else:
            save_native_review(ws, receipt, selected)
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
            "notes": "Use " + GUIDE + ". Original case receipt SHA256: " + file_digest(receipt_path)
                + ". Compare the unchanged baseline with the saved restoration alternatives; read all numerical changes from their actual native results.",
            "science_notes": "Explicitly simulated inputs; 1,296 ha, 30-metre cells, EPSG:26917. Baseline and alternatives share the retained profile and grid. Original InVEST 3.20 export rasters are N/P kg/ha/year or sediment metric tonnes/ha/year; integrated Workspace export cells contain annual mass using actual pixel hectares once. Native watershed vectors already contain annual mass. Native comparison is alternative minus baseline. The retained field chapter uses original simulated total-phosphorus concentrations in mg/L as P, with separate source support and native QC history.",
        },
        "fresh_run_ids": [], "step_notes": STEP_NOTES,
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
    return {"input": str(output / "input.json"), "project_id": ws.project["id"],
            "selection": selected, "receipt_sha256": file_digest(receipt_path),
            "guide": str(teaching / "TEACHING_GUIDE.md")}

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
