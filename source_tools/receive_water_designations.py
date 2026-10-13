"""Exercise the native designation workflow using the captured source edition.

Usage: python source_tools/receive_water_designations.py --sources /path/to/capture
       --workspace /path/to/workspace --output /path/to/outputs
"""
from __future__ import annotations
import argparse
import csv
import json
from pathlib import Path
import shutil
import sys

APPLICATION = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(APPLICATION))
from model.workspace import Workspace
from model import water_designations as water, rasters, portable
from model.common import atomic_json, digest, file_digest, read_json

EXPECTED_SOURCE = "eecab9bc33f02ab393c178297d966b35e9c372887b5fd23eaf00cc85817fbcea"
SOURCE_ID = "scdes-chattooga-chauga-classification-20261013"
RULE = {"title": "South Carolina R.61-69, Classified Waters",
        "uri": "https://des.sc.gov/sites/des/files/Library/Regulations/R.61-69.pdf",
        "edition": "Amended May 26, 2023; Document 5116; retrieved October 13, 2026",
        "section": "Sections E-F and H; PDF pages 4 and 12"}

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--sources", required=True, type=Path)
    parser.add_argument("--workspace", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    source = args.sources / "chattooga_chauga_classified_water.geojson"
    if file_digest(source) != EXPECTED_SOURCE:
        raise ValueError("Use the exact retained 377-feature Chattooga/Chauga capture")
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    intake = output / "intake"
    intake.mkdir(exist_ok=True)
    for name in ("chattooga_chauga_classified_water.geojson",
                 "water_classification_layer_metadata.json",
                 "water_designation_integration.json",
                 "chattooga_chauga_source_ids.json"):
        original = args.sources / name
        if original.exists():
            shutil.copyfile(original, intake / name)
    manifest = {
        "schema": "upstate.sources/v1", "title": "Chattooga and Chauga classified water source edition",
        "captured_at": "2026-10-13",
        "scope": {"predicate": "HYDNAME IN ('CHATTOOGA RIVER','CHAUGA RIVER')",
                  "captured_features": 377, "geometry_crs": "EPSG:4326"},
        "notes": ["Source HYDTYPE contains mapped banks and shorelines. Line length sums this original linework.",
                  "Complete named-river capture verified against all provider feature IDs."],
        "entries": [{
            "id": SOURCE_ID, "title": "SCDES Chattooga and Chauga classifications",
            "uri": "https://gis.des.sc.gov/gisserver/rest/services/water/Water_Classifications/MapServer/0",
            "vintage": "Provisional service edition captured 2026-10-13",
            "kind": "vector", "role": "WATER_CLASSIFICATION", "id_field": "OBJECTID_1",
            "path": source.name, "sha256": EXPECTED_SOURCE,
            "scope": {"predicate": "HYDNAME IN ('CHATTOOGA RIVER','CHAUGA RIVER')"},
            "metadata": {"classification_status": "provisional", "id_field": "OBJECTID_1",
                         "native_service_crs": "EPSG:26917", "capture_crs": "EPSG:4326"},
            "companions": [{"path": p.name, "sha256": file_digest(p)}
                           for p in sorted(intake.glob("*.json")) if p.name != "sources.json"],
        }],
    }
    atomic_json(intake / "sources.json", manifest)
    workspace = Workspace(args.workspace, create=True, title="Chattooga and Chauga water designations")
    imported = workspace.import_sources(intake / "sources.json")
    base = {"source_collection_id": imported["id"], "source_id": SOURCE_ID, "id_field": "OBJECTID_1"}
    original = read_json(source)
    source_features = original["features"]
    publisher_ids = {str(f["properties"]["OBJECTID_1"]) for f in source_features}
    provider_ids = read_json(intake / "chattooga_chauga_source_ids.json")["objectIds"]
    assert {str(value) for value in provider_ids} == publisher_ids
    outstanding_ids = {str(f["properties"]["OBJECTID_1"]) for f in source_features if f["properties"]["H2OCLASS"] == "ORW"}
    inspect = water.inspect(workspace, base, limit=500)
    assert inspect["total_features"] == 377
    assert {str(f["id"]) for f in inspect["features"]} == publisher_ids
    choice = {**base, "title": "Chattooga and Chauga outstanding-resource reaches",
              "purpose": "high_quality_waters", "selection_mode": "classes",
              "class_field": "H2OCLASS", "class_values": ["ORW"], "exclude_ids": [],
              "expected_source_sha256": EXPECTED_SOURCE, "rule_reference": RULE,
              "notes": ["Mapped line length includes the original banks and shorelines."]}
    preview = water.preview(workspace, choice)
    assert preview["summary"]["selected_features"] == 332
    assert {str(f["id"]) for f in preview["geojson"]["features"]} == outstanding_ids
    saved = water.save(workspace, choice)
    reopened = water.get(workspace, saved["id"])
    assert reopened["id"] == saved["id"]
    assert water.save(workspace, choice)["reused_completed_selection"] is True
    selection_dir = workspace.root / "water-designations" / saved["id"]
    saved_geojson = read_json(selection_dir / "selected-features.geojson")
    assert {str(f["id"]) for f in saved_geojson["features"]} == outstanding_ids
    with (selection_dir / "selected-features.csv").open(newline="", encoding="utf-8") as stream:
        csv_rows = list(csv.DictReader(stream))
    assert len(csv_rows) == 332
    delivery_patch = water.apply_to_delivery(workspace, saved["id"], {})
    overlay_choice = delivery_patch["overlays"]["high_quality_waters"]
    assert delivery_patch["source_roles"]["HIGH_QUALITY_WATERS"] == overlay_choice
    path, entry = workspace.source_file(overlay_choice["source_collection_id"], overlay_choice["source_id"])
    from model.map_atlas import bind_water_selections
    source_only = {key: overlay_choice[key] for key in ("source_collection_id", "source_id", "layer")}
    rebound_selection = {"overlays": {"high_quality_waters": source_only}}
    rebound_bindings = bind_water_selections(workspace, rebound_selection)
    assert rebound_selection["overlays"]["high_quality_waters"] == saved["delivery_overlay"]
    assert rebound_selection["source_roles"]["HIGH_QUALITY_WATERS"] == saved["delivery_overlay"]
    assert rebound_bindings["high_quality_waters"]["id"] == saved["id"]
    assert rebound_bindings["high_quality_waters"]["source"] == saved["source"]
    assert rebound_bindings["high_quality_waters"]["rule_reference"] == saved["rule_reference"]
    native_rows, native_crs = rasters.vector_geometry(path, layer=overlay_choice["layer"], target_crs="EPSG:26917")
    assert {str(r["properties"]["OBJECTID_1"]) for r in native_rows} == outstanding_ids
    from model.delivery import _overlay
    from shapely.ops import unary_union
    reporting_extent = unary_union([r["geometry"] for r in native_rows]).envelope
    delivered = _overlay(workspace, overlay_choice, "EPSG:26917", reporting_extent,
                         label="Designated high-quality waters")
    assert len(delivered["features"]) == 332
    first_id = sorted(outstanding_ids)[0]
    excluded = water.preview(workspace, {**choice, "exclude_ids": [first_id]})
    assert excluded["summary"]["selected_features"] == 331
    feature_pick = water.preview(workspace, {**choice, "selection_mode": "features",
                                             "feature_ids": [first_id], "class_values": []})
    assert feature_pick["summary"]["selected_features"] == 1
    fid_choice = {**choice, "id_field": "__fid__", "selection_mode": "features",
                  "feature_ids": [first_id], "class_values": [],
                  "title": "Single reach with original file feature identity"}
    fid_saved = water.save(workspace, fid_choice)
    fid_path, fid_entry = workspace.source_file(fid_saved["delivery_overlay"]["source_collection_id"],
                                               fid_saved["delivery_overlay"]["source_id"])
    fid_rows, _ = rasters.vector_geometry(fid_path, layer="selected_features")
    assert [str(r["properties"][fid_entry["id_field"]]) for r in fid_rows] == [first_id]
    application_files = {p.relative_to(APPLICATION).as_posix():
                         {"bytes": p.stat().st_size, "sha256": file_digest(p)}
                         for p in portable._application(APPLICATION)}
    archive_key = digest({"project": workspace.project, "selection_id": saved["id"],
                          "fid_selection_id": fid_saved["id"], "application": application_files})[:20]
    archive_path = output / ("chattooga-chauga-designation-workspace-" + archive_key + ".zip")
    if archive_path.exists():
        archive = portable.inspect_archive(archive_path, verify=True)
        if archive["project"] != workspace.project:
            raise ValueError("The existing archive belongs to a different scientific workspace")
        required = [
            "workspace/water-designations/" + saved["id"] + "/selection.json",
            "workspace/water-designation-specs/" + saved["id"] + ".json",
            "workspace/water-designations/" + fid_saved["id"] + "/selection.json",
            "workspace/" + entry["body"]["object"],
            "workspace/" + fid_entry["body"]["object"],
        ]
        if any(name not in archive["members"] for name in required):
            raise ValueError("The existing archive is missing the saved native designation")
        for name, expected in application_files.items():
            if archive["members"].get("application/" + name) != expected:
                raise ValueError("The existing archive contains another application edition")
    else:
        archive = workspace.backup(archive_path)
    received_path = output / ("received-" + file_digest(archive_path)[:16])
    if received_path.exists():
        restored_workspace = Workspace(received_path / "workspace")
    else:
        received = portable.restore(archive_path, received_path)
        restored_workspace = Workspace(received["workspace"])
    restored = water.get(restored_workspace, saved["id"])
    assert restored["summary"]["selected_features"] == 332
    restored_path, restored_entry = restored_workspace.source_file(
        restored["delivery_overlay"]["source_collection_id"], restored["delivery_overlay"]["source_id"])
    restored_rows, _ = rasters.vector_geometry(restored_path, layer="selected_features")
    assert {str(r["properties"]["OBJECTID_1"]) for r in restored_rows} == outstanding_ids
    summary = {"schema": "upstate.water-designation-receiving/v1", "workspace": str(workspace.root),
               "source_features": 377, "selected_features": 332, "excluded_case_features": 331,
               "single_feature_case": 1, "retained_driver_fid": first_id, "native_delivery_features": len(delivered["features"]),
               "restored_features": len(restored_rows), "selection_id": saved["id"],
               "rebound_selection_id": rebound_bindings["high_quality_waters"]["id"],
               "source_sha256": EXPECTED_SOURCE, "summary": saved["summary"],
               "delivery_overlay": saved["delivery_overlay"],
               "workspace_archive": str(archive_path), "archive_sha256": file_digest(archive_path),
               "restored_workspace": str(restored_workspace.root),
               "selection_report": str(selection_dir / "selection-report.html")}
    atomic_json(output / "water-designation-receiving.json", summary)
    atomic_json(output / "delivery-overlay.json", delivery_patch)
    print(json.dumps(summary, indent=2))
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
