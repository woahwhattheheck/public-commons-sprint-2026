#!/usr/bin/env python3
"""Save the actual ARJWS and Pioneer protection polygons in the designation desk.

Run the existing prepare_public_water.py first. This companion consumes that
native preparation and reuses model.water_designations for selection, retention,
reopening and delivery binding.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys

SOURCE_ID = "scdes-arjws-prwd-swpa-20261012"
EXPECTED_SOURCE_SHA256 = "ddac0feb1c704ca5e95336e21961e08beede1f83b6b820423dffa5a63bd8e285"
SOURCE_URI = "https://gis.des.sc.gov/gisserver/rest/services/water/Public_Water_Supply/MapServer/2"
# Original source OBJECTID -> (SYSTEM, INTAKE, BUFFER_FT).
ORIGINAL = {
    11: ("0420011", "S04101", 1500),
    12: ("0420011", "S04101", 200),
    131: ("3720001", "S37109", 1500),
    132: ("3720001", "S37109", 200),
}
CASES = (
    ("arjws", "ARJWS surface-water protection areas", (11, 12)),
    ("pioneer", "Pioneer surface-water protection areas", (131, 132)),
    ("both-utilities", "ARJWS and Pioneer surface-water protection areas", (11, 12, 131, 132)),
)
RULE = {
    "title": "SCDES public surface-water protection area dataset definition",
    "uri": SOURCE_URI,
    "edition": "Public GIS capture 2026-10-12; publisher dataset edition not stated",
    "section": "Layer 2 description; SYSTEM, INTAKE and BUFFER_FT attributes",
}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model-root", required=True, type=Path)
    parser.add_argument("--workspace", required=True, type=Path)
    parser.add_argument("--preparation", required=True, type=Path,
                        help="public-water-preparation.json from prepare_public_water.py")
    parser.add_argument("--out", required=True, type=Path)
    parser.add_argument("--delivery", type=Path,
                        help="Existing delivery selection; writes its combined-utility revision")
    args = parser.parse_args(argv)
    root = args.model_root.resolve()
    if not (root / "model/workspace.py").is_file():
        raise ValueError("--model-root must contain model/workspace.py.")
    sys.path.insert(0, str(root))
    from model.common import atomic_json, read_json
    from model.workspace import Workspace
    from model.water_designations import inspect, save, get, apply_to_delivery

    prepared = read_json(args.preparation.resolve())
    workspace = Workspace(args.workspace.resolve())
    collection_id = prepared["source_collection_id"]
    source_sha256 = prepared["original_protection_sha256"]
    if source_sha256 != EXPECTED_SOURCE_SHA256:
        raise ValueError("Use the retained October 12 four-polygon original source response.")
    base = {
        "source_collection_id": collection_id,
        "source_id": SOURCE_ID,
        "expected_source_sha256": source_sha256,
    }
    inspected = inspect(workspace, base, limit=10)
    if inspected["total_features"] != 4 or inspected["returned_features"] != 4:
        raise ValueError("Use the original four-polygon native public-water preparation.")
    if inspected["source"]["sha256"] != source_sha256:
        raise ValueError("The imported protection source differs from this preparation.")
    if inspected["features_without_geometry"]:
        raise ValueError("An original protection feature has no geometry.")
    by_attributes = {}
    for feature in inspected["features"]:
        props = feature["properties"]
        key = (props.get("SYSTEM"), props.get("INTAKE"), props.get("BUFFER_FT"))
        if key in by_attributes:
            raise ValueError("A utility/intake/protection-width identity repeats.")
        by_attributes[key] = feature["id"]
    if set(by_attributes) != set(ORIGINAL.values()):
        raise ValueError("The imported protection source has different utility or width attributes.")
    native_ids = {oid: by_attributes[attributes] for oid, attributes in ORIGINAL.items()}
    output = args.out.resolve()
    output.mkdir(parents=True, exist_ok=True)
    outcome = {
        "schema": "upstate.utility-designation-example/v1",
        "workspace": str(workspace.root),
        "source_collection_id": collection_id,
        "source_id": SOURCE_ID,
        "source_sha256": source_sha256,
        "source_crs": inspected["source"]["crs"],
        "native_id_field": inspected["id_field"],
        "original_to_native_feature_ids": {str(k): v for k, v in native_ids.items()},
        "public_water_plan_id": prepared["plan_id"],
        "cases": {},
    }
    for case_id, title, original_ids in CASES:
        choice = {
            **base,
            "title": title,
            "purpose": "drinking_water",
            "selection_mode": "features",
            "id_field": inspected["id_field"],
            "feature_ids": [native_ids[oid] for oid in original_ids],
            "class_values": [],
            "exclude_ids": [],
            "rule_reference": RULE,
            "notes": [
                "Published surface-water protection polygons with a 15-mile upstream extent.",
                "Original BUFFER_FT records retain the 200-foot and 1500-foot values; geometry is preserved.",
                "Original source OBJECTIDs: " + ", ".join(str(oid) for oid in original_ids) + ".",
                "ARJWS: public system SC0420011 / intake S04101; Pioneer: SC3720001 / intake S37109.",
                "Mapped polygon area adds original records. Receiving-water family summaries use their spatial union.",
                "Complete upstream model catchments are retained as a separate analytical relation.",
            ],
        }
        record = save(workspace, choice)
        reopened = get(workspace, record["id"])
        if reopened["summary"]["selected_features"] != len(original_ids):
            raise ValueError("The retained utility selection has a different feature count.")
        atomic_json(output / (case_id + ".selection.json"), choice)
        outcome["cases"][case_id] = {
            "selection_id": reopened["id"],
            "original_object_ids": list(original_ids),
            "native_feature_ids": choice["feature_ids"],
            "selected_features": reopened["summary"]["selected_features"],
            "delivery_overlay": reopened["delivery_overlay"],
            "retained_directory": str(workspace.root / "water-designations" / reopened["id"]),
        }
    if args.delivery:
        incoming = read_json(args.delivery.resolve())
        combined_id = outcome["cases"]["both-utilities"]["selection_id"]
        revised = apply_to_delivery(workspace, combined_id, incoming)
        destination = output / "delivery-selection.json"
        atomic_json(destination, revised)
        outcome["delivery_selection"] = str(destination)
    atomic_json(output / "utility-designations.json", outcome)
    print(json.dumps(outcome, indent=2, ensure_ascii=False, allow_nan=False))


if __name__ == "__main__":
    main()
