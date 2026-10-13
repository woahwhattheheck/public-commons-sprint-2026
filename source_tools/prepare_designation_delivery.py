"""Move actual saved water-designation choices into a complete native delivery.

Use the receiver's existing model Workspace and complete delivery selection.
--selection accepts an original water-designation selection object or its saved
selection.json record. Optional --source-manifest imports the original source
files needed when a choice came from the separate river receiving Workspace.
The result is a complete delivery-selection.json with actual report source rows.
"""
from __future__ import annotations

import argparse
from copy import deepcopy
import hashlib
import json
from pathlib import Path
import sys

APPLICATION = Path(__file__).resolve().parents[1]
if str(APPLICATION) not in sys.path:
    sys.path.insert(0, str(APPLICATION))

from model.common import atomic_json
from model.workspace import Workspace
from model import water_designations
from model.delivery import _source_records

SOURCE_ROLES = {
    "high_quality_waters": "HIGH_QUALITY_WATERS",
    "drinking_water": "SOURCE_WATER_PROTECTION_AREAS",
    "protected_lands": "PROTECTED_LANDS_OVERLAY",
}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", required=True, type=Path)
    parser.add_argument("--delivery", required=True, type=Path,
                        help="Existing complete delivery selection for this Workspace")
    parser.add_argument("--selection", required=True, action="append", type=Path,
                        help="Actual choice or saved water-designation record; repeat to combine purposes")
    parser.add_argument("--source-manifest", action="append", default=[], type=Path,
                        help="Original source manifest for a choice from another Workspace")
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--build-delivery", action="store_true",
                        help="Build the merged selection with the original Workspace delivery engine")
    args = parser.parse_args(argv)
    inputs = []

    def read(path):
        path = path.resolve()
        body = path.read_bytes()
        inputs.append({"path": str(path), "bytes": len(body),
                       "sha256": hashlib.sha256(body).hexdigest()})
        return json.loads(body)

    workspace = Workspace(args.workspace.resolve())
    original = read(args.delivery)
    if not isinstance(original, dict):
        raise ValueError("--delivery must contain the complete delivery selection object")
    baseline = workspace.inspect_run(original["baseline_run_id"])
    if baseline["state"] != "complete":
        raise ValueError("Use an existing completed native baseline for source-lineage receiving")
    grid = workspace.get_grid(baseline["selection"]["grid_id"])
    imported = []
    for path in args.source_manifest:
        read(path)
        imported.append(workspace.import_sources(path.resolve()))
    selected = deepcopy(original)
    cases, final_by_purpose = [], {}
    for path in args.selection:
        document = read(path)
        if not isinstance(document, dict):
            raise ValueError("--selection must contain an actual native choice or saved record")
        is_record = document.get("schema") == "upstate.water-designation/v1"
        choice = deepcopy(document["selection"] if is_record else document)
        matches = {
            collection["id"]
            for collection in imported for entry in collection["entries"]
            if entry["id"] == choice.get("source_id")
            and entry["body"]["sha256"] == choice.get("expected_source_sha256")
        }
        if len(matches) > 1:
            raise ValueError("More than one supplied collection matches this source; pass its one original manifest")
        if matches:
            choice["source_collection_id"] = next(iter(matches))
        saved = water_designations.save(workspace, choice)
        reopened = water_designations.get(workspace, saved["id"])
        if is_record and reopened["summary"]["selected_features"] != document["summary"]["selected_features"]:
            raise ValueError("The received choice selected a different number of original features")
        if reopened["selection"].get("source_context") != choice.get("source_context"):
            raise ValueError("The saved source/rule context differs from its original choice")
        selected = water_designations.apply_to_delivery(workspace, reopened["id"], selected)
        purpose = reopened["purpose"]
        role = SOURCE_ROLES[purpose]
        overlay = selected["overlays"][purpose]
        if selected["source_roles"][role] != overlay:
            raise ValueError("Map and report source bindings differ for " + purpose)
        _, entry = workspace.source_file(overlay["source_collection_id"], overlay["source_id"])
        if overlay["selection_id"] != reopened["id"] or overlay["rule_reference"] != reopened["rule_reference"]:
            raise ValueError("The delivery binding lost its saved identity or rule")
        if overlay["native_source_sha256"] != reopened["source"]["sha256"]:
            raise ValueError("The delivery binding lost its original source edition")
        case = {
            "input": str(path.resolve()), "purpose": purpose, "source_role": role,
            "selection_id": reopened["id"], "selected_features": reopened["summary"]["selected_features"],
            "source_collection_id": overlay["source_collection_id"], "source_id": entry["id"],
            "selected_source_sha256": entry["body"]["sha256"],
            "original_source_sha256": reopened["source"]["sha256"],
            "delivery_choice": deepcopy(overlay),
        }
        cases.append(case)
        final_by_purpose[purpose] = case

    changed_roles = {item["source_role"] for item in final_by_purpose.values()}
    for key, value in original.items():
        if key not in {"overlays", "source_roles", "notes"} and selected.get(key) != value:
            raise ValueError("Designation receiving changed original delivery field: " + key)
    for role, choice in original.get("source_roles", {}).items():
        if role not in changed_roles and selected["source_roles"].get(role) != choice:
            raise ValueError("Designation receiving changed unrelated source role: " + role)
    for purpose, choice in original.get("overlays", {}).items():
        if purpose not in final_by_purpose and selected["overlays"].get(purpose) != choice:
            raise ValueError("Designation receiving changed unrelated overlay: " + purpose)

    records = _source_records(workspace, selected, grid, baseline)
    by_role = {record["id"]: record for record in records}
    for case in final_by_purpose.values():
        record = by_role.get(case["source_role"])
        if (record is None or record["source_id"] != case["source_id"]
                or record["sha256"] != case["selected_source_sha256"]
                or record.get("selection") != case["delivery_choice"]):
            raise ValueError("Original delivery source records omit or change a saved designation")
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    selection_path = output / "delivery-selection.json"
    records_path = output / "delivery-source-records.json"
    atomic_json(selection_path, selected)
    atomic_json(records_path, records)
    outcome = {
        "schema": "upstate.designation-delivery-receiving/v1",
        "workspace": str(workspace.root), "baseline_run_id": baseline["id"],
        "grid_id": grid["id"], "input_files": inputs, "cases": cases,
        "final_selections": {purpose: case["selection_id"] for purpose, case in final_by_purpose.items()},
        "delivery_selection": str(selection_path), "source_records": str(records_path),
        "source_record_count": len(records),
    }
    outcome_path = output / "designation-delivery-receiving.json"
    atomic_json(outcome_path, outcome)
    if args.build_delivery:
        built = workspace.build_delivery(selected)
        outcome["delivery"] = {
            "id": built["id"], "state": built["state"],
            "package": deepcopy(built.get("package")),
            "files": deepcopy(built.get("files", {})),
        }
        atomic_json(outcome_path, outcome)
    print(json.dumps(outcome, indent=2, ensure_ascii=False, allow_nan=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
