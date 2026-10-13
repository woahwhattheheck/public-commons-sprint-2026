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
from model.common import atomic_bytes, atomic_json, file_digest, identifier, read_json
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
    "parameters": "Read the saved biophysical table, NDR/SDR parameters and model version. The climate, soils and annual load coefficients are declared demonstration assumptions. Keep the selected profile fixed between land-cover alternatives.",
    "alternatives": "Show the unchanged baseline and the saved 90-metre riparian restoration. Its original mask converts 236 pasture and 399 crop cells to forest: 635 cells, 57.15 ha. Existing forest and developed cells remain selected unchanged. Explain any additional saved alternative from its own actual mask and class counts.",
    "calculation": "Open the actual native NDR/SDR stages, logs and timestamps for these selected run IDs. Reopening completed runs is recorded-result inspection. The original source preparation and native calculation durations remain separate from this walkthrough.",
    "maps": "Read the selected quantity, unit, extent and legend. Workspace N/P rate layers are kg/ha/year; sediment rate layers are metric tonnes/ha/year. Original native exports retain per-pixel annual mass. Read the saved artifact units and actual cell area. Source-water and conservation overlay areas in this case are explicitly simulated planning areas.",
    "comparison": "Read the actual returned baseline and alternative quantities and their common valid support. Ordinary native signed change is alternative minus baseline: a negative export change is a reduction. State the units and supported area before interpreting a percentage.",
    "delivery": "Open the retained native-study delivery and its seven map families, report and original files. Show physical quantities separately from combined priority scores. Read the computed response without assuming restoration must yield a particular sign or magnitude.",
    "transfer": "Download the actual scientific archive, receive it independently, and reopen the same project and selected results. Keep the original archive, receiving identity, later local note and teaching packet together.",
}

def absolute(value, label, *, exists=False):
    if not isinstance(value, str) or not Path(value).is_absolute():
        raise ValueError(label + " must be an explicit absolute path")
    return Path(value).resolve(strict=exists)

def bind(receipt_path, output, *, workspace=None, browser=None, operation_id=OPERATION):
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
            "science_notes": "Explicitly simulated inputs; 1,296 ha, 30-metre cells, EPSG:26917. The baseline and alternatives use the same retained scientific profile and grid. Native annual N/P mass is kg/year; sediment mass is metric tonnes/year. Native comparison is alternative minus baseline. Simulated source-water and priority polygons exercise the native-study map delivery.",
        },
        "fresh_run_ids": [], "step_notes": STEP_NOTES,
        "task_timeout_seconds": 7200, "browser": browser,
    }
    # Use the maintained validator, preserving its current input contract.
    sys.path.insert(0, str(APP / "operator"))
    from rehearsal_receiving import validate
    validate(value)
    output.mkdir(parents=True, exist_ok=True)
    atomic_bytes(output / "original-demo-receiving.json", receipt_bytes, immutable=True)
    atomic_json(output / "input.json", value, immutable=True)
    guide = APP / GUIDE
    atomic_bytes(output / "TEACHING_GUIDE.md", guide.read_bytes(), immutable=True)
    return {"input": str(output / "input.json"), "project_id": ws.project["id"],
            "selection": selected, "receipt_sha256": file_digest(receipt_path),
            "guide": str(output / "TEACHING_GUIDE.md")}

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
    parser.add_argument("--run", action="store_true",
                        help="Continue the existing rehearsal receiver after binding")
    parser.add_argument("--native-only", action="store_true",
                        help="Retain native phase before the configured authorized browser continuation")
    args = parser.parse_args()
    browser = read_json(args.browser_config) if args.browser_config else None
    result = bind(args.receipt, args.output, workspace=args.workspace,
                  browser=browser, operation_id=args.operation_id)
    if args.run:
        from rehearsal_receiving import run
        result["receiving"] = run(Path(result["input"]), skip_browser=args.native_only)
    print(json.dumps(result, ensure_ascii=False, indent=2))

if __name__ == "__main__":
    main()
