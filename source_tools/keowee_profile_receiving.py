"""Receive the source-profile join through the original Conservation workspace."""
from __future__ import annotations
import argparse
import hashlib
import json
from pathlib import Path

from model import conservation, keowee_priority
from model import keowee_profile_adapter as adapter
from model.common import atomic_json, verify_file
from model.workspace import Workspace

SOURCE_ID = "greenwood-native-parcel-1-20261013"
PIN = "6913-674-230"
ORIGINAL_SHA = "e4fd893f7ab655d1a9fd8e2944d9122a7786abb26d55ec85310b04ed39f49fab"


def run(workspace_path):
    root = Path(__file__).resolve().parents[1]
    source = root / "source" / "keowee-native-receiving-20261013"
    original = source / "greenwood-native-feature.json"
    if hashlib.sha256(original.read_bytes()).hexdigest() != ORIGINAL_SHA:
        raise ValueError("The receiving parcel differs from the retained original county response")
    profile, mapping, identity = adapter.load()
    by_id = {row["id"]: row for row in profile["criteria"]}
    observed = []
    for criterion, value, expected in (
            ("nitrogen_export", 0.03246, [0, 2]),
            ("nitrogen_export", 0.1280935, [0, 2, 3]),
            ("nitrogen_export", 0.2, [3]),
            ("phosphorus_export", 0.0011635, [0, 2, 3]),
            ("protection_sensitive_buffer", 7.995, [0, 1, 2, 3, 4])):
        result = adapter.classify(value, by_id[criterion]["rule"], criterion_id=criterion, identity=identity)
        if result["score_options"] != expected:
            raise ValueError("Literal source interval differs: " + criterion)
        observed.append({"criterion": criterion, "value": value,
                         "state": result["state"], "score_options": result["score_options"]})
    workspace = Workspace(workspace_path, create=True, title="Keowee profile native receiving")
    edition = workspace.import_sources(source / "sources.json")
    choice = {"source_collection_id": edition["id"], "source_id": SOURCE_ID,
              "id_field": "PIN", "label_field": "PIN", "where": {"PIN": PIN}}
    selection = {
        "title": "Greenwood original parcel and Keowee source-profile receiving",
        "mode": "source_context", "purpose": "protection", "unit_type": "parcel",
        "planning_unit_label": "Original Greenwood parcel", "analysis_crs": "EPSG:5070",
        "parcels": choice, "reporting_area": choice,
        "score": {"basis": "published_method", "category_id": "land_protection"},
    }
    prepared = conservation.prepare(workspace, selection)
    built = conservation.build(workspace, prepared["id"])
    study = conservation.inspect(workspace, built["id"])
    if len(study["candidates"]) != 1:
        raise ValueError("The exact county source selection must retain one original parcel")
    candidate = study["candidates"][0]
    if candidate["id"] != PIN or candidate["original_attributes"]["OBJECTID"] != 1:
        raise ValueError("The original parcel identity changed")
    point = candidate["point_score"]
    size = candidate["score_components"]["parcel_size"]
    if size["points"] != 0 or not 1 < size["value"] < 2:
        raise ValueError("The original parcel's whole-area criterion differs")
    if point["known_points"] != 0 or point["possible_points"] != 30 or point["points"] is not None:
        raise ValueError("Unobserved parcel criteria must retain their actual point alternatives")
    if point["source_profile"]["sha256"] != mapping["profile"]["sha256"]:
        raise ValueError("The ranked candidate lost the exact source profile")
    # This receiving selection preserves the source geometry through the existing
    # saved-plan route. include_ineligible explicitly retains its incomplete
    # source screen; the original point record remains attached to the selection.
    plan = conservation.save_plan(workspace, {
        "study_id": study["id"], "title": "Greenwood original source selection receiving",
        "mode": "manual", "selected_ids": [PIN], "objective": "area",
        "include_ineligible": True,
    })
    reopened = Workspace(workspace_path)
    reopened_study = conservation.inspect(reopened, study["id"])
    reopened_plan = conservation.get_plan(reopened, plan["id"])
    original_view, entry = reopened.source_file(edition["id"], SOURCE_ID)
    if hashlib.sha256(original_view.read_bytes()).hexdigest() != ORIGINAL_SHA:
        raise ValueError("Source import/reopen changed the original county response")
    if reopened_study["candidates"][0]["point_score"] != point:
        raise ValueError("Reopen changed the retained published-method result")
    for descriptor in reopened_plan["files"].values():
        verify_file(reopened.root, descriptor)
    result = {
        "schema": "upstate.keowee-native-receiving/v1",
        "source_collection_id": edition["id"], "source_id": SOURCE_ID,
        "original_source_sha256": ORIGINAL_SHA, "profile": identity,
        "study_id": study["id"], "plan_id": plan["id"],
        "parcel_id": PIN, "original_attributes": candidate["original_attributes"],
        "native_analysis_area_ha": candidate["area_ha"],
        "parcel_size_criterion": size, "source_interval_cases": observed,
        "point_score": point, "study_files": study["files"], "plan_files": plan["files"],
        "source_reopened": True, "study_reopened": True, "plan_reopened": True,
    }
    output = reopened.root / "receiving" / "keowee-native-profile-20261013.json"
    atomic_json(output, result)
    return {**result, "result_path": str(output)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", required=True, type=Path)
    args = parser.parse_args()
    print(json.dumps(run(args.workspace), ensure_ascii=False, allow_nan=False, indent=2))


if __name__ == "__main__":
    main()
