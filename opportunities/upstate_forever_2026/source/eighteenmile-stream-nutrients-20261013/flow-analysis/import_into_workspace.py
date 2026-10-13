"""Import the retained four-stream observations and linked flow context."""
from __future__ import annotations
import argparse
import csv
import hashlib
import json
from pathlib import Path
import sys

APPLICATION = Path(__file__).resolve().parents[3]
if str(APPLICATION) not in sys.path:
    sys.path.insert(0, str(APPLICATION))
from model.common import atomic_json, read_json
from model.workspace import Workspace

ROOT = Path(__file__).resolve().parent
MANIFEST = "model-sources.json"


def recipes():
    return [
        {
            "path": "nutrient-flow.csv",
            "title": "Eighteenmile four-stream original nutrient measurements, 2020–2025",
            "observation_kind": "receiving_water_measurement",
            "time_support": "original_sample",
            "columns": {"record_id": "record_id", "station_id": "station_id",
                        "parameter": "characteristic", "value": "value",
                        "unit": "observation_unit", "period_start": "date",
                        "qualifier": "qualifier", "method": "method_id"},
            "series_dimensions": ["sample_fraction", "project_id", "result_type"],
            "quantitation_column": "quantitation_class",
            "limit_column": "limit_value", "limit_unit_column": "limit_unit",
            "interpretation": (
                "Original WQP measured values and reported detection limits, linked to the exact "
                "source file and CSV row. For a blank censored result, observation_unit takes the "
                "published detection-limit unit; original measured-unit and limit-unit fields "
                "remain separate. Six original calculated Nitrogen results have a separate "
                "component-consistency diagnostic and remain unchanged. Same-date USGS flow "
                "is regional context; original point location and gauge-specific geometry "
                "remain separate."
            ),
        },
        {
            "path": "nitrogen-components.csv",
            "title": "Eighteenmile matched TKN and nitrate/nitrite: quantified component sums",
            "observation_kind": "receiving_water_derived_concentration",
            "time_support": "original_sample",
            "columns": {"station_id": "station_id", "value": "numeric_component_sum_mg_l",
                        "period_start": "date", "method": "component_definition"},
            "constants": {"parameter": "Matched TKN plus nitrate/nitrite component sum",
                          "unit": "mg/L"},
            "series_dimensions": ["project_id"],
            "interpretation": (
                "A separate same-activity, unfiltered component diagnostic. Only two quantified "
                "components supply a numeric value; censored component bounds remain in the "
                "original lower/upper columns. Original calculated Nitrogen rows belong to "
                "the original-measurement edition and are never replaced by these sums. "
                "The chemical identity is conditional on the original shared nitrogen mass basis."
            ),
        },
    ]


def import_into_workspace(workspace, source_root=ROOT, *, output, import_measurements=False):
    root = Path(source_root).resolve(strict=True)
    manifest_path = root / MANIFEST
    manifest = read_json(manifest_path)
    if manifest.get("schema") != "upstate.sources/v1":
        raise ValueError("Select the complete stream-flow ordinary source manifest")
    entries = {item["path"]: item for item in manifest["entries"]}
    if len(entries) != len(manifest["entries"]):
        raise ValueError("Source manifest paths are ambiguous")
    selected = recipes() if import_measurements else []
    # Check the complete retained analysis cohort before importing its measured tables.
    members = {}
    for relative, item in entries.items():
        for member in [{"path": relative, **item}, *item.get("companions", [])]:
            previous = members.get(member["path"])
            if previous and previous["sha256"] != member["sha256"]:
                raise ValueError("Source companion identities conflict")
            members[member["path"]] = member
    for relative, item in members.items():
        path = (root / relative).resolve(strict=True)
        if not path.is_relative_to(root) or not path.is_file():
            raise ValueError("Source member is outside the retained analysis")
        raw = path.read_bytes()
        if (("bytes" in item and len(raw) != item["bytes"])
                or hashlib.sha256(raw).hexdigest() != item["sha256"]):
            raise ValueError("Source bytes changed: " + relative)
    for item in selected:
        entry = entries.get(item["path"])
        if not entry or entry["kind"] != "table":
            raise ValueError("The original measurement table is missing")
        with (root / item["path"]).open(encoding="utf-8-sig", newline="") as stream:
            header = next(csv.reader(stream), [])
        required = [item["columns"].get(key, key) for key in ("station_id", "parameter", "value", "unit", "period_start")
                    if key not in item.get("constants", {})]
        if len(header) != len(set(header)) or set(required) - set(header):
            raise ValueError("The retained table lacks its declared measurement columns")
    ws = Workspace(workspace)
    collection = ws.import_sources(manifest_path)
    imported = []
    for item in selected:
        source = entries[item["path"]]
        body, entry = ws.source_file(collection["id"], source["id"])
        metadata = {key: value for key, value in item.items() if key != "path"}
        metadata.update({
            "schema": "upstate.observed-source-context/v1",
            "value_basis": "context",
            "source_uri": source["uri"],
            "sha256": entry["body"]["sha256"],
            "source_collection_id": collection["id"],
            "source_id": source["id"],
            "source_manifest_sha256": hashlib.sha256(manifest_path.read_bytes()).hexdigest(),
            "source_table_path": item["path"],
            "source_vintage": source["vintage"],
            "source_records": {
                "source_id": source["id"], "source_sha256": source["sha256"],
                "selection": "Complete retained table; original file and row links remain in each row",
            },
        })
        result = ws.import_observations(body, metadata)
        if result["admitted_count"]:
            raise RuntimeError("Context import unexpectedly admitted an annual model reference")
        imported.append({
            "id": result["id"], "title": metadata["title"],
            "source_collection_id": collection["id"], "source_id": source["id"],
            "sha256": entry["body"]["sha256"], "rows": len(result["rows"]),
            "context_count": result["context_count"],
            "admitted_count": result["admitted_count"],
            "observation_kind": metadata["observation_kind"],
        })
    result = {
        "schema": "upstate.observed-context-import/v1",
        "workspace": str(ws.root.resolve()), "project_id": ws.project.get("id"),
        "source_collection_id": collection["id"],
        "observations": imported,
        "analysis_manifest": str(manifest_path),
        "adoption_mode": "source_and_measurement_editions" if import_measurements else "supplemental_source_context",
    }
    atomic_json(Path(output), result)
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", required=True)
    parser.add_argument("--source-root", default=str(ROOT),
                        help="Complete source/eighteenmile-stream-nutrients-20261013/flow-analysis directory")
    parser.add_argument("--import-measurements", action="store_true",
                        help="Import explicit measurement recipes when the original stream editions are not already adopted")
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    result = import_into_workspace(args.workspace, args.source_root, output=args.output,
                                   import_measurements=args.import_measurements)
    print(json.dumps(result, sort_keys=True))


if __name__ == "__main__":
    main()
