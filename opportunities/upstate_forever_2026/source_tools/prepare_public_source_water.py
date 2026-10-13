#!/usr/bin/env python3
"""Prepare four published source-water areas in an existing native Workspace.

Inputs are original public SCDES records plus an explicit receptor specification.
The installed application supplies Workspace and the receiving-water GIS engine.
"""
from __future__ import annotations

import argparse
import copy
import json
import os
from pathlib import Path
import sys
import tempfile


def read_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8-sig"))


def save_json(path: Path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(value, indent=2, ensure_ascii=False, allow_nan=False) + "\n"
    fd, temporary = tempfile.mkstemp(prefix=path.name + ".", dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as stream:
            stream.write(text)
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model-root", required=True, type=Path,
                        help="Existing application directory containing model/workspace.py.")
    parser.add_argument("--workspace", required=True, type=Path,
                        help="Existing native Workspace to receive the original sources.")
    parser.add_argument("--source-dir", type=Path,
                        default=Path(__file__).resolve().parents[1] /
                        "source/water_context/20261012/public-water")
    parser.add_argument("--out", required=True, type=Path)
    args = parser.parse_args()
    model_root = args.model_root.resolve()
    source_dir = args.source_dir.resolve()
    output = args.out.resolve()
    if not (model_root / "model/workspace.py").is_file():
        parser.error("--model-root must contain the installed model/workspace.py.")
    manifest_path = source_dir / "sources.public-native.json"
    spec = copy.deepcopy(read_json(source_dir / "receiving-waters.public-spec.json"))
    expected = {"arjws-swpa-1500", "arjws-swpa-200",
                "prwd-swpa-1500", "prwd-swpa-200"}
    receptors = spec.get("receptors", [])
    if len(receptors) != 4 or {item.get("id") for item in receptors} != expected:
        raise ValueError("The public source-water specification must contain its four distinct receptors.")
    if spec.get("analysis_crs") != "EPSG:26917":
        raise ValueError("The source-area operation uses the original EPSG:26917 analytical CRS.")
    for receptor in receptors:
        if receptor.get("relation", {}).get("method") != "source_area":
            raise ValueError("Use the published polygon through the source_area relation.")
        if receptor.get("source", {}).get("source_collection_id") is not None:
            raise ValueError("The input specification must bind to this actual native import.")

    sys.path.insert(0, str(model_root))
    from model.workspace import Workspace
    from model.receiving_waters import prepare

    workspace = Workspace(args.workspace.resolve(), create=False)
    # The importer checks original byte hashes, including both metadata companions.
    collection = workspace.import_sources(str(manifest_path))
    entries = {entry["id"]: entry for entry in collection["entries"]}
    required_sources = {"scdes-public-surface-intakes-20261012",
                        "scdes-arjws-prwd-swpa-20261012"}
    if not required_sources.issubset(entries):
        raise ValueError("Native import did not retain the required original sources.")
    for receptor in receptors:
        receptor["source"]["source_collection_id"] = collection["id"]
        receptor["metadata"]["intake_reference"]["source_collection_id"] = collection["id"]
    save_json(output / "receiving-waters-spec.json", spec)
    plan = prepare(workspace, spec)
    outcome = {
        "schema": "upstate.public-water-preparation/v1",
        "workspace": str(workspace.root),
        "application_root": str(model_root),
        "python_version": sys.version.split()[0],
        "source_collection_id": collection["id"],
        "original_protection_sha256": entries["scdes-arjws-prwd-swpa-20261012"]["body"]["sha256"],
        "plan_id": plan["id"],
        "plan_state": plan["state"],
        "analysis_crs": spec["analysis_crs"],
        "receptor_ids": [item["id"] for item in receptors],
        "source_records": [
            {
                "id": source_id,
                "uri": entries[source_id]["uri"],
                "sha256": entries[source_id]["body"]["sha256"],
                "bytes": entries[source_id]["body"]["bytes"],
                "features": entries[source_id]["features"],
            }
            for source_id in sorted(required_sources)
        ],
        "native_manifest": str(manifest_path),
        "native_selection": str(output / "receiving-waters-spec.json"),
    }
    # Retain the exact source-area choices for the existing scenario analysis desk.
    # Model totals remain clipped to that desk's selected baseline reporting area.
    zones = []
    for receptor in receptors:
        metadata = copy.deepcopy(receptor.get("metadata", {}))
        metadata.update({
            "source_plan_id": plan["id"],
            "receptor_ids": [receptor["id"]],
            "source_relation_method": receptor["relation"]["method"],
            "source_geometry_scope": "published_polygon",
            "source_classification": copy.deepcopy(receptor.get("classification", {})),
        })
        zones.append({
            **copy.deepcopy(receptor["source"]),
            "id": receptor["id"],
            "title": receptor["title"],
            "map_family": receptor["family"],
            "metadata": metadata,
        })
    source_areas_path = output / "scenario-source-areas.json"
    source_areas = {
        "schema": "upstate.scenario-source-areas/v1",
        "selection": {
            "title": "Published source-water planning areas",
            "zones": zones,
        },
        "origin": {
            "source_plan_id": plan["id"],
            "workspace": str(workspace.root),
            "analysis_crs": spec["analysis_crs"],
            "source_collection_id": collection["id"],
            "original_protection_sha256": outcome["original_protection_sha256"],
            "source_records": copy.deepcopy(outcome["source_records"]),
            "native_preparation": str(output / "public-water-preparation.json"),
            "native_selection": str(output / "receiving-waters-spec.json"),
        },
    }
    save_json(source_areas_path, source_areas)
    outcome["native_source_areas"] = str(source_areas_path)
    save_json(output / "public-water-preparation.json", outcome)
    print(json.dumps(outcome, indent=2, ensure_ascii=False, allow_nan=False))


if __name__ == "__main__":
    main()
