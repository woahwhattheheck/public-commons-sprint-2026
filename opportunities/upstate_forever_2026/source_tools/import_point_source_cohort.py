#!/usr/bin/env python3
"""Import the complete point-source cohort into the existing Upstate Workspace."""
import argparse
import json
import os
import sys
import tempfile
from pathlib import Path

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--project-root", default=str(Path(__file__).resolve().parents[1]))
    parser.add_argument("--workspace", required=True)
    parser.add_argument("--create-workspace", action="store_true")
    parser.add_argument("--source-only", action="store_true")
    parser.add_argument("--output")
    args = parser.parse_args()
    root = Path(args.project_root).resolve()
    sys.path.insert(0, str(root))
    from model.workspace import Workspace
    ws = Workspace(args.workspace, create=args.create_workspace)
    manifest_path = root / "eighteenmile_point_source_context.sources.json"
    collection = ws.import_sources(str(manifest_path))
    collection_id = collection["id"]
    routing_manifest = root / "observations" / "eighteenmile_2023" / "npdes" / "routing-model-sources.json"
    routing = ws.import_sources(str(routing_manifest))
    routing_id = routing["id"]
    desk_bindings = {
        "periods": {
            "source_collection_id": collection_id,
            "source_id": "upstate-eighteenmile-2023-dmr-period-loads-872d4183e2e5",
        },
        "annual": {
            "source_collection_id": routing_id,
            "source_id": "upstate-eighteenmile-dmr-gauge-routing-annual-62ad3646420b",
        },
        "relations": {
            "source_collection_id": routing_id,
            "source_id": "upstate-eighteenmile-dmr-gauge-routing-relations-6d76f4cc627d",
        },
        "cohorts": {
            "source_collection_id": routing_id,
            "source_id": "upstate-eighteenmile-dmr-gauge-routing-cohorts-aa755c73bf33",
        },
    }
    bindings = {
        "measurements": "echo-cohort-canonical-measurements-2023",
        "period_comparison": "echo-cohort-period-method-comparison-2023",
        "annual_comparison": "echo-cohort-annual-method-comparison-2023",
        "historical_context": "echo-cohort-annual-history-map-index",
        "original_geometry": "upstate-eighteenmile-des-original-outfalls",
        "mapped_quantities": "scdes-eighteenmile-npdes-outfalls-2023",
        "observation_periods": "echo-cohort-period-observation-context",
    }
    source_bindings = {
        key: {"source_collection_id": collection_id, "source_id": source_id}
        for key, source_id in bindings.items()
    }
    result = {
        "workspace": str(ws.root),
        "source_collection_id": collection_id,
        "source_entries": len(collection["entries"]),
        "routing_source_collection_id": routing_id,
        "routing_source_entries": len(routing["entries"]),
        "point_source_context_bindings": desk_bindings,
        "source_bindings": source_bindings,
        "geometry_crs": "EPSG:26917",
        "observation_value_basis": "point_source_discharge_context",
    }
    if not args.source_only:
        context_root = root / "source" / "point_source_context" / "20261013"
        metadata = json.loads((context_root / "observation-metadata.json").read_text(encoding="utf-8"))
        metadata["source_bindings"] = source_bindings
        observation = ws.import_observations(
            str(context_root / "point_source_period_observations.csv"), metadata
        )
        result["observation_id"] = observation["id"]
        result["context_count"] = observation.get("context_count")
        result["admitted_count"] = observation.get("admitted_count")
        rows = observation.get("rows")
        if isinstance(rows, list):
            result["observation_rows"] = len(rows)
    output = Path(args.output).resolve() if args.output else root / "source" / "point_source_context" / "20261013" / "receiving" / "native-import.json"
    output.parent.mkdir(parents=True, exist_ok=True)
    serialized = json.dumps(result, indent=2, ensure_ascii=False) + "\n"
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=output.parent, delete=False) as stream:
            temporary = Path(stream.name)
            stream.write(serialized)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, output)
    finally:
        if temporary is not None and temporary.exists():
            temporary.unlink()
    print(serialized, end="")

if __name__ == "__main__":
    main()
