"""Import computed routine nutrient/flow context into the existing native Workspace."""
from __future__ import annotations
import argparse
import hashlib
import json
import sys
from pathlib import Path

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--application", required=True)
    parser.add_argument("--workspace", required=True)
    parser.add_argument("--manifest", default=str(Path(__file__).with_name("model-sources.json")))
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    application = Path(args.application).resolve(strict=True)
    if not (application / "model" / "workspace.py").is_file():
        raise ValueError("Select the current native application")
    sys.path.insert(0, str(application))
    from model.workspace import Workspace
    from model.common import atomic_json
    manifest_path = Path(args.manifest).resolve(strict=True)
    manifest = json.loads(manifest_path.read_text(encoding="utf-8-sig"))
    expected = [entry for entry in manifest["entries"] if entry["id"] == "observed-hydrology-nutrient-flow-dated-20261013"]
    if len(expected) != 1:
        raise ValueError("Select the complete source-bound nutrient flow context")
    entry = expected[0]
    ws = Workspace(args.workspace)
    collection = ws.import_sources(manifest_path)
    body, retained_entry = ws.source_file(collection["id"], entry["id"])
    observations = []
    for bound, column in (("lower", "lower_mg_l"), ("upper", "upper_mg_l")):
        metadata = {
            "schema": "upstate.observed-source-context/v1",
            "title": "Routine nutrients: conservative " + bound + " concentration endpoint",
            "value_basis": "context",
            "observation_kind": "receiving_water_concentration_interval_endpoint",
            "time_support": "original_sample",
            "columns": {"station_id": "station_id", "parameter": "parameter",
                        "value": column, "unit": "unit",
                        "period_start": "sample_date", "method": "interval_status"},
            "series_dimensions": ["sample_fraction", "project_id"],
            "interpretation": (
                "Conservative " + bound + " endpoint of each original concentration interval. "
                "The 120 rows represent 96 original routine results and 24 same-activity TKN+NOx sums. "
                "Exact quantified results have identical lower/upper endpoints. "
                "Original below-limit conditions, strict relations, full bounds and source-result identities remain in each row. "
                "The paired endpoint editions are views of the same source records."
            ),
            "source_uri": entry["uri"], "sha256": retained_entry["body"]["sha256"],
            "source_collection_id": collection["id"], "source_id": entry["id"],
            "source_manifest_sha256": hashlib.sha256(manifest_path.read_bytes()).hexdigest(),
            "source_vintage": entry["vintage"],
            "source_records": {"selection": "All 120 retained calculated value rows; interval endpoint " + bound,
                               "source_sha256": entry["sha256"]},
        }
        edition = ws.import_observations(body, metadata)
        if edition["admitted_count"]:
            raise RuntimeError("Context was unexpectedly admitted as annual model loads")
        observations.append({"id": edition["id"], "title": metadata["title"],
                             "rows": len(edition["rows"]),
                             "context_count": edition["context_count"],
                             "source_id": entry["id"], "endpoint": bound})
    result = {"schema": "upstate.nutrient-flow-native-import/v1",
              "workspace": str(ws.root.resolve()), "project_id": ws.project["id"],
              "source_collection_id": collection["id"],
              "source_entries": len(collection["entries"]), "observations": observations}
    atomic_json(Path(args.output), result)
    print(json.dumps(result, sort_keys=True))

if __name__ == "__main__":
    main()
