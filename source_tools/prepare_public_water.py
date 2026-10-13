#!/usr/bin/env python3
"""Import the captured ARJWS/PRWD sources and prepare their published protection areas.

Requires the existing model.workspace and model.receiving_waters modules and their
GIS environment. The original SCDES polygon response is bundled beside the
source dictionary; --protection-areas can supply the same captured bytes elsewhere.
"""
from __future__ import annotations

import argparse
import copy
import gzip
import hashlib
import json
import os
from pathlib import Path
import sys
import tempfile


def read_json(path: Path):
    stored = path.read_bytes()
    body = gzip.decompress(stored) if stored.startswith(b"\x1f\x8b") else stored
    return body, json.loads(body.decode("utf-8-sig"))


def sha256(body: bytes) -> str:
    return hashlib.sha256(body).hexdigest()


def write_file(root: Path, relative: str, body: bytes):
    target = root / relative
    target.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix=target.name + ".", dir=target.parent)
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(body)
        os.replace(temporary, target)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)
    return {"path": relative, "bytes": len(body), "sha256": sha256(body)}


def json_bytes(value) -> bytes:
    return (json.dumps(value, ensure_ascii=False, indent=2) + "\n").encode("utf-8")


def original_features(value, expected_geometry: str):
    if value.get("error"):
        raise ValueError("ArcGIS returned an error: " + json.dumps(value["error"]))
    if value.get("exceededTransferLimit"):
        raise ValueError("Receive the complete original response before importing.")
    if value.get("geometryType") != expected_geometry:
        raise ValueError("Unexpected original geometry type.")
    reference = value.get("spatialReference", {})
    if 26917 not in (reference.get("wkid"), reference.get("latestWkid")):
        raise ValueError("Expected the original SCDES EPSG:26917 source coordinates.")
    features = value.get("features")
    if not isinstance(features, list) or not features:
        raise ValueError("The source has no feature array.")
    indexed = {}
    for feature in features:
        oid = feature.get("attributes", {}).get("OBJECTID")
        if type(oid) is not int or oid in indexed:
            raise ValueError("Missing or duplicate native OBJECTID.")
        geometry = feature.get("geometry") or {}
        if expected_geometry == "esriGeometryPoint":
            if any(type(geometry.get(axis)) not in (int, float) for axis in ("x", "y")):
                raise ValueError("The intake source needs original point coordinates.")
        elif not geometry.get("rings"):
            raise ValueError("The protection source needs complete original polygon rings.")
        indexed[oid] = feature
    return indexed


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", required=True, type=Path)
    parser.add_argument("--model-root", required=True, type=Path,
                        help="Directory containing the existing model package.")
    parser.add_argument("--source-dir", type=Path,
                        default=Path(__file__).resolve().parents[1] /
                        "source/water_context/20261012/public-water")
    parser.add_argument("--protection-areas", type=Path,
                        help="Original SCDES polygon JSON, optionally gzip; defaults to the bundled capture.")
    parser.add_argument("--out", type=Path)
    parser.add_argument("--create-workspace", action="store_true",
                        help="Create a new native workspace when explicitly requested.")
    args = parser.parse_args()
    source_dir = args.source_dir.resolve()
    output = (args.out or source_dir / "native").resolve()
    _, dictionary = read_json(source_dir / "source-dictionary.json")
    _, selection = read_json(source_dir / "receiving-waters-spec.template.json")
    intake_body, intakes = read_json(source_dir / "raw/public-intakes.esri.json")
    protection_record = dictionary["source_bodies"][1]
    protection_path = (args.protection_areas or source_dir / protection_record["path"]).resolve()
    protection_body, protections = read_json(protection_path)
    if (len(protection_body) != protection_record["bytes"] or
            sha256(protection_body) != protection_record["sha256"]):
        raise ValueError("The protection body differs from the recorded captured edition.")
    intake_index = original_features(intakes, "esriGeometryPoint")
    protection_index = original_features(protections, "esriGeometryPolygon")
    expected_ids = {
        row["OBJECTID"]
        for utility in dictionary["utilities"]
        for row in utility["protection_attributes"]
    }
    if set(protection_index) != expected_ids:
        raise ValueError("The original protection query must contain exactly OBJECTIDs " +
                         ", ".join(str(value) for value in sorted(expected_ids)))
    for utility in dictionary["utilities"]:
        expected_intake = utility["intake_feature"]
        actual_intake = intake_index.get(expected_intake["attributes"]["OBJECTID"])
        if actual_intake != expected_intake:
            raise ValueError("The intake capture differs from the retained utility record: " +
                             utility["public_system_id"])
        for attributes in utility["protection_attributes"]:
            if protection_index[attributes["OBJECTID"]]["attributes"] != attributes:
                raise ValueError("The protection capture differs from the retained original attributes.")
    if sha256(intake_body) != dictionary["source_bodies"][0]["sha256"]:
        raise ValueError("The bundled complete intake body differs from its recorded identity.")

    files = []
    def save(relative, body):
        item = write_file(output, relative, body)
        files.append(item)
        return item

    intake_file = save("raw/public-intakes.esri.json", intake_body)
    protection_file = save(protection_record["path"], protection_body)
    dictionary_file = save("source-dictionary.json", json_bytes(dictionary))
    metadata = {}
    for layer in (0, 2, 3):
        body, _ = read_json(source_dir / f"metadata/public-water-{layer}.json")
        metadata[layer] = save(f"metadata/public-water-{layer}.json", body)
    manifest = {
        "schema": "upstate.sources/v1",
        "title": "ARJWS and PRWD original public-water sources",
        "captured_at": dictionary["source_capture_date"],
        "scope": "Complete statewide surface-water intake source and the four original published protection polygons for the two RFP utilities.",
        "notes": [
            dictionary["interpretation"]["protection_description"],
            "BUFFER_FT values are feet; preserve the 200-foot and 1500-foot records.",
            "Source coordinates are EPSG:26917. The receiving-water source_area relation applies the actual polygons without an added buffer.",
            "Family summaries union overlapping areas. The full upstream model catchment is a separate analysis scope."
        ],
        "entries": [
            {
                "id": "scdes-public-surface-intakes-20261012",
                "title": "SCDES original public surface-water intake points",
                "kind": "vector", "role": "SOURCE_WATER_INTAKES",
                **intake_file, "uri": dictionary["source_bodies"][0]["uri"],
                "vintage": "Public GIS capture 2026-10-12; publisher dataset edition not stated",
                "source_format": "Esri JSON", "source_crs": "EPSG:26917",
                "object_id_field": "OBJECTID", "features": len(intake_index),
                "companions": [metadata[0], dictionary_file]
            },
            {
                "id": "scdes-arjws-prwd-swpa-20261012",
                "title": "SCDES original ARJWS and PRWD source-water protection polygons",
                "kind": "vector", "role": "SOURCE_WATER_PROTECTION_AREAS",
                **protection_file, "uri": dictionary["source_bodies"][1]["uri"],
                "vintage": "Public GIS capture 2026-10-12; publisher dataset edition not stated",
                "source_format": "Esri JSON", "source_crs": "EPSG:26917",
                "object_id_field": "OBJECTID", "features": len(protection_index),
                "buffer_field": "BUFFER_FT", "buffer_units": "feet",
                "publisher_description": dictionary["interpretation"]["protection_description"],
                "companions": [metadata[2], dictionary_file]
            }
        ]
    }
    save("sources.json", json_bytes(manifest))
    save("source-file-manifest.json", json_bytes({
        "schema": "upstate.source-file-manifest/v1",
        "native_import_manifest": "sources.json",
        "files": copy.deepcopy(files)
    }))
    model_root = args.model_root.resolve()
    if not (model_root / "model/workspace.py").is_file():
        raise ValueError("--model-root must contain the existing model/workspace.py.")
    sys.path.insert(0, str(model_root))
    from model.workspace import Workspace
    from model.receiving_waters import prepare

    workspace = Workspace(args.workspace.resolve(), create=args.create_workspace)
    collection = workspace.import_sources(str(output / "sources.json"))
    selection["metadata"]["protection_source"] = {
        **dictionary["source_bodies"][1], **protection_file
    }
    for receptor in selection["receptors"]:
        receptor["source"]["source_collection_id"] = collection["id"]
        receptor["metadata"]["intake_reference"]["source_collection_id"] = collection["id"]
        receptor["metadata"]["protection_source"] = {
            **dictionary["source_bodies"][1], **protection_file
        }
    save("receiving-waters-spec.json", json_bytes(selection))
    plan = prepare(workspace, selection)
    outcome = {
        "workspace": str(workspace.root),
        "source_collection_id": collection["id"],
        "plan_id": plan["id"],
        "plan_state": plan["state"],
        "analysis_crs": selection["analysis_crs"],
        "receptors": [receptor["id"] for receptor in selection["receptors"]],
        "original_intake_features": len(intake_index),
        "original_protection_features": len(protection_index),
        "original_protection_sha256": sha256(protection_body),
        "native_manifest": str(output / "sources.json"),
        "native_selection": str(output / "receiving-waters-spec.json")
    }
    save("public-water-preparation.json", json_bytes(outcome))
    print(json.dumps(outcome, indent=2))


if __name__ == "__main__":
    main()
