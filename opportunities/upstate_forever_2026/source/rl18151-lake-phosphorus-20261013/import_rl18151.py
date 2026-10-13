"""Import original RL-18151 source/report and discrete observations into a Workspace."""
from __future__ import annotations
import argparse
import csv
import hashlib
import json
from pathlib import Path

def receive(workspace, source_root, output):
    from model.common import atomic_json
    from model.workspace import Workspace
    root = Path(source_root).resolve(strict=True)
    manifest_path = root / "sources.json"
    manifest_raw = manifest_path.read_bytes()
    manifest = json.loads(manifest_raw)
    if manifest.get("schema") != "upstate.sources/v1":
        raise ValueError("Select the complete retained RL-18151 scientific source")
    capture = json.loads((root / "capture-manifest.json").read_bytes())
    if capture.get("station_id") != "21SC60WQ_WQX-RL-18151" or not capture.get("complete"):
        raise ValueError("The original station acquisition must be complete")
    ws = Workspace(workspace)
    collection = ws.import_sources(manifest_path)
    indexed = {entry["id"]: entry for entry in manifest["entries"]}
    editions = []
    for group in ("nutrient", "physical", "microbiological"):
        source_id = "rl18151-" + group + "-observations-2018-20261013"
        item = indexed[source_id]
        native_path, entry = ws.source_file(collection["id"], source_id)
        with native_path.open("r", encoding="utf-8-sig", newline="") as stream:
            records = list(csv.DictReader(stream))
        if not records:
            editions.append({"group": group, "source_id": source_id, "state": "original_empty_response",
                             "records": 0, "source_collection_id": collection["id"]})
            continue
        metadata = {
            "schema": "upstate.observation-support/v1",
            "title": "RL-18151 original " + group + " measurements, 2018–2026",
            "source_uri": item["uri"], "sha256": entry["body"]["sha256"],
            "source_collection_id": collection["id"], "source_id": source_id,
            "source_manifest_sha256": hashlib.sha256(manifest_raw).hexdigest(),
            "value_basis": "original_discrete_measurement",
            "observation_kind": "receiving_water_measurement" if group != "physical" else "physical_measurement",
            "measurement_support": "concentration" if group != "physical" else "other_context",
            "time_support": "original_sampling_instant", "period_end_inclusive": True,
            "quantity_basis": "original_discrete_measurement",
            "station_id": "21SC60WQ_WQX-RL-18151",
            "method": "Original WQP values with exact source row, species, fraction, depth, units, qualifiers and limits.",
            "interpretation": "Retained lake sampling observations. No annual catchment export or flow-derived load is inferred.",
        }
        edition = ws.import_observations(native_path, metadata)
        if edition["admitted_count"]:
            raise RuntimeError("Discrete source measurements unexpectedly entered annual catchment comparison")
        editions.append({"group": group, "id": edition["id"], "rows": len(edition["rows"]),
                         "context_count": edition["context_count"], "admitted_count": edition["admitted_count"],
                         "source_collection_id": collection["id"], "source_id": source_id})
    report_id = "rl18151-phosphorus-observed-report-2018-20261013"
    if report_id not in indexed:
        raise ValueError("The original scientific report recipe is absent")
    report_path, report_entry = ws.source_file(collection["id"], report_id)
    report = json.loads(report_path.read_bytes())
    if report.get("schema") != "upstate.observed-report/v1":
        raise ValueError("The retained report recipe has another schema")
    result = {
        "schema": "upstate.rl18151-native-receiving/v1",
        "workspace": str(ws.root.resolve()), "project_id": ws.project["id"],
        "source_collection_id": collection["id"], "source_manifest_sha256": hashlib.sha256(manifest_raw).hexdigest(),
        "observations": editions,
        "observed_context_source": {"source_collection_id": collection["id"], "source_id": report_id},
        "report_recipe_sha256": report_entry["body"]["sha256"],
        "station_source": {"source_collection_id": collection["id"], "source_id": "rl18151-original-station"},
    }
    atomic_json(Path(output), result)
    return result

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", required=True)
    parser.add_argument("--source-root", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    print(json.dumps(receive(args.workspace, args.source_root, args.output), sort_keys=True))

if __name__ == "__main__":
    main()
