"""Import retained scientific CSVs into the existing observation workspace."""
from __future__ import annotations
import argparse
import csv
import hashlib
import json
from pathlib import Path

from model.common import atomic_json, read_json
from model.workspace import Workspace

STUDY = "observations/eighteenmile_2023/model-sources.json"
HYDROLOGY = "observations/observed_hydrology_20261013/model-sources.json"
EFFLUENT = "observations/eighteenmile_2023/npdes/flow_context/model-sources.json"

def recipe(manifest, source_path, title, kind, support, columns, *,
           constants=None, dimensions=(), interpretation="", **extra):
    return {"manifest": manifest, "path": source_path, "title": title,
            "observation_kind": kind, "time_support": support,
            "columns": columns, "constants": constants or {},
            "series_dimensions": list(dimensions), "interpretation": interpretation, **extra}

def recipes():
    selected = [
        recipe(STUDY, "wqp/derived/measurements.csv",
               "Eighteenmile 2023 original water-quality measurements",
               "receiving_water_measurement", "original_sample",
               {"record_id": "record_id", "station_id": "station_id",
                "parameter": "characteristic", "value": "reported_value",
                "unit": "reported_unit", "period_start": "sample_date",
                "period_end": "sample_end_date", "qualifier": "qualifier",
                "method": "analytical_method_name"},
               dimensions=("sample_fraction", "activity_depth", "activity_depth_unit",
                           "activity_depth_reference", "project_id"),
               interpretation="Individual original receiving-water results. Groups preserve parameter, unit, fraction, sampling depth and project. Open triangles retain stated detection bounds; no substitution is applied.",
               quantitation_column="quantitation_class",
               limit_column="numeric_detection_limit", limit_unit_column="detection_limit_unit"),
        recipe(HYDROLOGY, "derived/daily_flow.csv",
               "Savannah gauges: original daily mean discharge, 2020–2025",
               "receiving_water_discharge", "daily_mean",
               {"station_id": "site", "value": "reported_mean_cfs",
                "period_start": "date", "qualifier": "qualifiers", "method": "method_id"},
               constants={"parameter": "Daily mean discharge", "unit": "ft3/s"},
               interpretation="Original USGS daily means. Approval, provisional, estimated and revised qualifiers remain in each original row. Connections represent consecutive observed dates only."),
        recipe(HYDROLOGY, "derived/daily_stage.csv",
               "Savannah gauges: original daily mean stage",
               "receiving_water_stage", "daily_mean",
               {"station_id": "site", "value": "reported_mean_stage_feet",
                "period_start": "date", "qualifier": "qualifiers", "method": "method_id"},
               constants={"parameter": "Daily mean stage", "unit": "ft"},
               interpretation="Original USGS daily mean stage in reported feet. Station datum and original qualifiers remain source context; series are compared within a station."),
        recipe(HYDROLOGY, "derived/calendar_month_flow.csv",
               "Savannah gauges: calendar-month observed discharge",
               "receiving_water_discharge_summary", "calendar_month",
               {"station_id": "site", "value": "mean_cfs",
                "period_start": "period_start", "period_end": "period_end", "method": "method_id"},
               constants={"parameter": "Mean observed discharge", "unit": "ft3/s"},
               period_end_inclusive=True,
               interpretation="Mean of available original daily values in each dated month. Valid/expected days, complete-period volume, and approval counts remain in every source row; partial months retain their actual coverage."),
        recipe(HYDROLOGY, "derived/nutrient_activity_total_nitrogen.csv",
               "Eighteenmile routine activities: derived total nitrogen",
               "receiving_water_derived_concentration", "original_sample",
               {"station_id": "monitoring_location_id", "value": "quantified_tn_mg_l",
                "period_start": "sample_date", "method": "method"},
               constants={"parameter": "Total nitrogen from matched TKN and NOx", "unit": "mg/L"},
               dimensions=("sample_fraction", "project_id"),
               interpretation="Source processor combines same-activity TKN and NOx. This view selects its fully quantified concentration; original component IDs, censor bounds, and same-date gauge context remain in the rows. Blank quantified values remain blank.")
    ]
    for source_path, label, station, complete, dimensions in (
        ("derived/facility_monthly.csv", "Facility monthly", "permit_id",
         "complete_month_amount", ("reporting_feature", "monitoring_location", "gauge_relation")),
        ("derived/upstream_monthly.csv", "Routed upstream cohort monthly", "gauge_id",
         "complete_cohort_month_amount", ("upstream_permit_ids",)),
    ):
        columns = {"station_id": station, "parameter": "parameter_name", "unit": "amount_unit",
                   "period_start": "period_start", "period_end": "period_end_exclusive"}
        selected.append(recipe(
            EFFLUENT, source_path, label + ": quantified reported source amounts",
            "reported_effluent_source_amount", "calendar_month",
            {**columns, "value": "quantified_period_amount"}, dimensions=dimensions,
            interpretation="Quantified original reporting periods weighted by their actual calendar-day coverage. This includes partial coverage; inspect quantified, missing and unquantified days. Mass is a gross effluent source quantity, without river transport adjustment."))
        selected.append(recipe(
            EFFLUENT, source_path, label + ": complete reported source amounts",
            "complete_reported_effluent_source_amount", "calendar_month",
            {**columns, "value": complete}, dimensions=dimensions,
            interpretation="Amounts only where the original source processor marks the selected month/cohort complete. Missing or unquantified coverage remains blank. Pollutant species and amount units stay separate."))
        selected.append(recipe(
            EFFLUENT, source_path, label + ": gross source mass per gauge volume",
            "gross_effluent_mass_per_gauge_volume_index", "calendar_month",
            {**columns, "value": "gross_mass_per_gauge_volume_mg_l"},
            constants={"unit": "mg/L"}, dimensions=dimensions,
            interpretation="Gross reported effluent mass divided by the same month's observed gauge volume. This source/volume index has no routing attenuation or mixing model and is distinct from a receiving-water concentration measurement. Source coverage and gauge-day coverage remain explicit."))
        selected.append(recipe(
            EFFLUENT, source_path, label + ": reported effluent flow fraction",
            "reported_effluent_to_gauge_volume_fraction", "calendar_month",
            {**columns, "value": "reported_effluent_to_gauge_volume_pct"},
            constants={"unit": "%"}, dimensions=dimensions,
            interpretation="Reported effluent volume divided by observed gauge volume for the same dated period. Original relation, reporting coverage and all constituent source periods are retained; non-flow parameter rows remain unquantified."))
    selected.append(recipe(
        EFFLUENT, "derived/gauge_monthly.csv",
        "Eighteenmile: same-period observed gauge discharge",
        "receiving_water_discharge_summary", "calendar_month",
        {"station_id": "gauge_id", "value": "gauge_mean_cfs",
         "period_start": "period_start", "period_end": "period_end_exclusive",
         "method": "gauge_method_id"},
        constants={"parameter": "Daily-mean discharge averaged over month", "unit": "ft3/s"},
        interpretation="Observed gauge daily means summarized over each month, with valid, approved and provisional day counts and observed volume."))
    return selected

def selected_sources(root, manifest_names, *, manifest_paths=None):
    result = {}
    for name in manifest_names:
        selected_path = (manifest_paths or {}).get(name, root / name)
        path = Path(selected_path).resolve(strict=True)
        manifest = read_json(path)
        if manifest.get("schema") != "upstate.sources/v1":
            raise ValueError("Select an ordinary retained scientific source manifest: " + str(path))
        index = {}
        for entry in manifest["entries"]:
            source_path = entry["path"]
            if source_path in index:
                raise ValueError("A source manifest has ambiguous table paths")
            index[source_path] = entry
        result[name] = (path, index)
    return result

def import_context(workspace, source_root, manifest_names, output, *, manifest_paths=None):
    root = Path(source_root).resolve(strict=True)
    desired = [r for r in recipes() if r["manifest"] in manifest_names]
    if not desired:
        raise ValueError("Choose at least one maintained observation source manifest")
    sources = selected_sources(root, manifest_names, manifest_paths=manifest_paths)
    # Preflight every selected table before copying or creating an observation edition.
    for item in desired:
        path, entries = sources[item["manifest"]]
        entry = entries.get(item["path"])
        if not entry or entry.get("kind") != "table":
            raise ValueError("The selected source edition lacks table " + item["path"])
        body = (path.parent / entry["path"]).resolve(strict=True)
        if not body.is_relative_to(path.parent.resolve()):
            raise ValueError("The original table is outside its retained manifest")
        if hashlib.sha256(body.read_bytes()).hexdigest() != entry["sha256"]:
            raise ValueError("The original table differs from its source hash")
        with body.open(encoding="utf-8-sig", newline="") as stream:
            headers = next(csv.reader(stream), [])
        required = [item["columns"].get(k, k) for k in ("parameter", "value", "unit")
                    if k not in item["constants"]]
        if len(headers) != len(set(headers)) or set(required) - set(headers):
            raise ValueError("The original table lacks the selected value columns: " + item["path"])
    ws = Workspace(workspace)
    collections = {name: ws.import_sources(path) for name, (path, _) in sources.items()}
    imported = []
    for item in desired:
        source = sources[item["manifest"]][1][item["path"]]
        collection = collections[item["manifest"]]
        body, entry = ws.source_file(collection["id"], source["id"])
        metadata = {key: value for key, value in item.items()
                    if key not in ("manifest", "path")}
        metadata.update({
            "schema": "upstate.observed-source-context/v1",
            "value_basis": "context", "source_uri": source["uri"],
            "sha256": entry["body"]["sha256"],
            "source_collection_id": collection["id"], "source_id": source["id"],
            "source_manifest_sha256": hashlib.sha256(sources[item["manifest"]][0].read_bytes()).hexdigest(),
            "source_table_path": item["path"], "source_vintage": source["vintage"],
            "source_records": {"source_id": source["id"], "source_sha256": source["sha256"],
                               "selection": "All original rows retained unchanged"},
        })
        edition = ws.import_observations(body, metadata)
        if edition["admitted_count"]:
            raise RuntimeError("Context intake unexpectedly admitted annual model loads")
        imported.append({"id": edition["id"], "title": metadata["title"],
                         "source_collection_id": collection["id"],
                         "source_id": source["id"], "sha256": metadata["sha256"],
                         "rows": len(edition["rows"]),
                         "context_count": edition["context_count"],
                         "admitted_count": edition["admitted_count"],
                         "observation_kind": metadata["observation_kind"]})
    result = {"schema": "upstate.observed-context-import/v1",
              "workspace": str(ws.root.resolve()), "project_id": ws.project.get("id"),
              "sources": {name: value["id"] for name, value in collections.items()},
              "observations": imported}
    atomic_json(Path(output), result)
    return result

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", required=True)
    parser.add_argument("--source-root", required=True,
                        help="Directory containing the original observations/ tree")
    parser.add_argument("--manifest", action="append", choices=[STUDY, HYDROLOGY, EFFLUENT],
                        help="Select one or repeat; default imports available maintained editions")
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    root = Path(args.source_root).resolve(strict=True)
    names = list(dict.fromkeys(args.manifest or
                             [name for name in (STUDY, HYDROLOGY, EFFLUENT) if (root/name).is_file()]))
    result = import_context(args.workspace, root, names, args.output)
    print(json.dumps({"workspace": result["workspace"],
                      "observation_editions": len(result["observations"]),
                      "observation_rows": sum(item["rows"] for item in result["observations"]),
                      "receipt": str(Path(args.output).resolve())}, sort_keys=True))

if __name__ == "__main__":
    main()
