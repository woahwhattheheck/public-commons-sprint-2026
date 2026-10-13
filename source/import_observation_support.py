"""Open source-backed annual/partial outfall quantities in the existing observation desk."""
from __future__ import annotations
import argparse
import csv
import hashlib
import json
from pathlib import Path
from model.common import atomic_json
from model.workspace import Workspace
from .observation_source_calendar import summarize

MANIFEST = "observations/eighteenmile_2023/npdes/routing-model-sources.json"
BASE_MANIFEST = "observations/eighteenmile_2023/npdes/model-sources.json"
PERIODS = "derived/period_loads.csv"
ANNUAL = "routing/derived/annual_quantities_with_routing.csv"
RELATIONS = "routing/derived/outfall_gauge_relations.csv"
COHORTS = "routing/derived/reported_quantities_by_gauge_relation.csv"


def read_table(path):
    with Path(path).open(encoding="utf-8-sig", newline="") as stream:
        reader = csv.DictReader(stream)
        if not reader.fieldnames or len(reader.fieldnames) != len(set(reader.fieldnames)):
            raise ValueError("A retained source table needs distinct original headers")
        rows = list(reader)
    if not rows or any(None in row for row in rows):
        raise ValueError("The retained source table is empty or malformed")
    return rows


def import_sources(workspace, source_root, output, *, manifest_paths=None):
    root = Path(source_root).resolve(strict=True)
    manifest_paths = manifest_paths or {}
    manifest_path = Path(manifest_paths.get(MANIFEST, root / MANIFEST)).resolve(strict=True)
    raw = manifest_path.read_bytes()
    manifest = json.loads(raw)
    if manifest.get("schema") != "upstate.sources/v1":
        raise ValueError("Select the original routed discharge source manifest")
    selected = {}
    for path in (ANNUAL, RELATIONS, COHORTS):
        entries = [item for item in manifest["entries"] if item.get("path") == path]
        if len(entries) != 1 or entries[0].get("kind") != "table":
            raise ValueError("The original manifest has no unique table " + path)
        item = entries[0]
        body = (manifest_path.parent / path).resolve(strict=True)
        body.relative_to(manifest_path.parent.resolve())
        data = body.read_bytes()
        if len(data) != item["bytes"] or hashlib.sha256(data).hexdigest() != item["sha256"]:
            raise ValueError("Original table differs: " + path)
        selected[path] = item
    base_path = Path(manifest_paths.get(BASE_MANIFEST, root / BASE_MANIFEST)).resolve(strict=True)
    base_raw = base_path.read_bytes()
    base_manifest = json.loads(base_raw)
    period_entries = [item for item in base_manifest.get("entries", []) if item.get("path") == PERIODS]
    if base_manifest.get("schema") != "upstate.sources/v1" or len(period_entries) != 1:
        raise ValueError("Select the original DMR period/source manifest")
    period_entry = period_entries[0]
    period_body = (base_path.parent / PERIODS).read_bytes()
    if (len(period_body) != period_entry["bytes"]
            or hashlib.sha256(period_body).hexdigest() != period_entry["sha256"]):
        raise ValueError("Original period quantities differ from their source")
    # Both original DMR response closure and actual network closure remain retained.
    ws = Workspace(workspace)
    original_collection = ws.import_sources(base_path)
    collection = ws.import_sources(manifest_path)
    native = {path: ws.source_file(collection["id"], item["id"])
              for path, item in selected.items()}
    annual_rows, relations, cohorts = (read_table(native[path][0])
                                       for path in (ANNUAL, RELATIONS, COHORTS))
    years = {row["calendar_year"] for row in annual_rows}
    if len(years) != 1:
        raise ValueError("A dated edition must have one original calendar year")
    year = int(next(iter(years)))
    registry = {}
    for relation in relations:
        permit = relation["permit_id"]
        if not permit or permit in registry:
            raise ValueError("Retained permit-to-gauge relationships must be unique")
        registry[permit] = {
            **relation, "outfall_id": relation["state_outfall_id"],
            "outfall_identity": "State mapped outfall; EPA reporting feature retained separately",
        }
    for row in annual_rows:
        relation = registry.get(row["permit_id"])
        if not relation or any(row[key] != relation[key] for key in ("gauge_id", "gauge_relation")):
            raise ValueError("Annual series differs from its actual retained gauge relation")
    periods_path, periods_entry = ws.source_file(original_collection["id"], period_entry["id"])
    calendar = summarize(read_table(periods_path), annual_rows, relations)
    editions = []
    for field, title, basis in (
        ("annual_total", "Complete reported annual outfall quantities", "annual_quantity"),
        ("quantified_period_total", "Reported outfall quantities over actual quantified periods",
         "quantified_period_quantity"),
    ):
        body, entry = native[ANNUAL]
        metadata = {
            "schema": "upstate.observation-support/v1", "title": title + " — " + str(year),
            "value_basis": "context", "measurement_support": "point_source_discharge",
            "observation_kind": "reported_effluent_source_amount",
            "quantity_basis": basis, "time_support": "calendar_year",
            "period_start": str(year) + "-01-01", "period_end": str(year + 1) + "-01-01",
            "period_end_inclusive": False,
            "expected_days": 366 if year % 4 == 0 and (year % 100 != 0 or year % 400 == 0) else 365,
            "method": "Original reported standard average rate integrated over its actual represented "
                      "days by the retained source processor. Annual quantities require complete "
                      "nonoverlapping quantified-year coverage.",
            "source_uri": selected[ANNUAL]["uri"], "sha256": entry["body"]["sha256"],
            "source_collection_id": collection["id"], "source_id": selected[ANNUAL]["id"],
            "source_manifest_sha256": hashlib.sha256(raw).hexdigest(),
            "source_table_path": ANNUAL, "source_vintage": selected[ANNUAL]["vintage"],
            "columns": {
                "record_id": "series_id", "station_id": "permit_id", "facility_id": "permit_id",
                "parameter": "parameter_name", "species": "parameter_code",
                "parameter_code": "parameter_code", "value": field, "unit": "amount_unit",
                "reporting_feature": "reporting_feature", "monitoring_location": "monitoring_location",
                "gauge_id": "gauge_id", "gauge_relation": "gauge_relation",
                "coverage_days": "quantified_days", "coverage_complete": "complete_calendar_year",
                "source_records": "selected_dmr_value_ids",
            },
            "series_dimensions": ["reporting_feature", "monitoring_location", "gauge_relation"],
            "facility_registry": registry,
            "cohort_quantities": cohorts,
            "source_calendar": calendar,
            "original_source_collection_id": original_collection["id"],
            "source_periods": {"source_id": period_entry["id"], "sha256": periods_entry["body"]["sha256"],
                               "source_collection_id": original_collection["id"]},
            "cohort_source": {"source_collection_id": collection["id"],
                              "source_id": selected[COHORTS]["id"],
                              "sha256": selected[COHORTS]["sha256"]},
            "interpretation": "Reported effluent quantities at original facilities. The gauge relation "
                              "comes from retained network sources; whole-polygon membership is separate. "
                              "Species and quantified periods stay distinct. Source amounts have no "
                              "in-stream attenuation or mixing adjustment.",
        }
        edition = ws.import_observations(body, metadata)
        if edition["admitted_count"]:
            raise RuntimeError("Outfall context unexpectedly entered native catchment metrics")
        editions.append({"id": edition["id"], "title": metadata["title"],
                         "rows": len(edition["rows"]), "context_count": edition["context_count"],
                         "admitted_count": edition["admitted_count"], "quantity_basis": basis,
                         "source_collection_id": collection["id"], "source_id": selected[ANNUAL]["id"]})
    result = {"schema": "upstate.observation-support-import/v1",
              "workspace": str(ws.root.resolve()), "project_id": ws.project["id"],
              "source_collection_id": collection["id"],
              "source_manifest_sha256": hashlib.sha256(raw).hexdigest(),
              "original_source_collection_id": original_collection["id"],
              "original_manifest_sha256": hashlib.sha256(base_raw).hexdigest(),
              "source_calendar": calendar,
              "observations": editions, "original_facilities": len(registry),
              "original_series": len(annual_rows), "cohort_rows": len(cohorts)}
    atomic_json(Path(output), result)
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", required=True)
    parser.add_argument("--source-root", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    print(json.dumps(import_sources(args.workspace, args.source_root, args.output), sort_keys=True))


if __name__ == "__main__":
    main()
