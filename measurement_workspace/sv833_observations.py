"""Build the SV-833 original-result cohort and retain its complete scientific report."""
from __future__ import annotations

import argparse
import csv
import hashlib
import io
import json
import math
from pathlib import Path

if __package__:
    from . import study_context
    from . import utility_microbiology_context as temporal_context
else:
    import study_context
    import utility_microbiology_context as temporal_context

BUILTIN_ID = study_context.SV833_STUDY
TITLE = "Three and Twenty Creek — SV-833 original observations, 2021–2026"
MANIFEST = "sv833_water_quality.sources.json"
INPUTS = "observations/sv833_2021_2026/input-manifest.json"
ROOT = study_context.SV833_ROOT
STATION = "21SC60WQ_WQX-SV-833"
PROFILE_ROLES = {
    "physical_result_identifiers": (342, (
        "Conductivity", "Depth", "Dissolved oxygen (DO)", "Temperature, water", "Turbidity", "pH")),
    "nutrient_result_identifiers": (208, (
        "Ammonia", "Kjeldahl nitrogen", "Nitrate + Nitrite", "Nitrogen", "Phosphorus")),
    "microbiological_result_identifiers": (60, ("Escherichia coli",)),
}
SEASONAL_HEADER = ("site_id,stratum,depth_min_m,depth_max_m,parameter,units,"
                   "mean,sd,minimum,maximum,n,source_table,source_pdf_page,statistic_basis\n")


def _json(value):
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2, allow_nan=False) + "\n").encode("utf-8")


def _sha(data):
    return hashlib.sha256(data).hexdigest()


def _csv(data):
    reader = csv.DictReader(io.StringIO(data.decode("utf-8-sig"), newline=""))
    fields = reader.fieldnames or []
    if not fields or len(fields) != len(set(fields)):
        raise ValueError("Original SV-833 source columns must remain complete and distinct.")
    records = list(reader)
    if any(None in row or any(value is None for value in row.values()) for row in records):
        raise ValueError("An original SV-833 CSV record is malformed.")
    return fields, records


def _csv_bytes(fields, records):
    output = io.StringIO(newline="")
    writer = csv.DictWriter(output, fieldnames=fields, lineterminator="\n")
    writer.writeheader()
    writer.writerows(records)
    return output.getvalue().encode("utf-8")


def source_files(application=None):
    application = Path(application) if application is not None else Path(__file__).resolve().parents[1]
    originals = study_context.source_files(application, application / MANIFEST)
    if len(originals) < 40:
        raise ValueError("Choose the complete forty-file SV-833 source edition with native document figures.")
    return originals


def catalog_entry(application=None):
    application = Path(application) if application is not None else Path(__file__).resolve().parents[1]
    if not (application / MANIFEST).is_file():
        return None
    return {"id": BUILTIN_ID, "title": TITLE,
            "publication": "Original 2021–2026 observations; source edition 2026-10-13",
            "counts": {"stations": 1, "original_result_rows": 610, "original_activity_count": 56}}


def build_files(application=None):
    originals = source_files(application)
    inputs = json.loads(originals[INPUTS])
    captures = {item["role"]: item for item in inputs["files"]}
    if len(captures) != len(inputs["files"]) or len(captures) < 11:
        raise ValueError("Retain distinct roles for the eleven original SV-833 inputs and any added context.")
    for capture in captures.values():
        raw = originals[capture["path"]]
        if capture["bytes"] != len(raw) or capture["sha256"] != _sha(raw):
            raise ValueError("Original SV-833 input bytes changed: " + capture["path"])
    metadata = []
    for role, format_name, count in (
            ("original_activities", "wqp-activity-csv", 56),
            ("original_quantitation_limits", "wqp-result-limit-csv", 606)):
        capture = captures[role]
        unused, records = _csv(originals[capture["path"]])
        if len(records) != count:
            raise ValueError("Original SV-833 metadata row count changed.")
        metadata.append({"role": format_name, "path": ROOT + "/" + capture["path"],
            "bytes": capture["bytes"], "sha256": capture["sha256"],
            "record_count": count, "source_url": capture["uri"]})
    entries, all_records = [], []
    for role, (count, characteristics) in PROFILE_ROLES.items():
        capture = captures[role]
        fields, records = _csv(originals[capture["path"]])
        if (len(fields) != 78 or len(records) != count
                or {row["CharacteristicName"] for row in records} != set(characteristics)
                or {row["MonitoringLocationIdentifier"] for row in records} != {STATION}):
            raise ValueError("Retain the exact SV-833 NarrowResult profile and declared characteristic scope.")
        entries.append({"path": ROOT + "/" + capture["path"],
            "format": "wqp-narrow-result-csv", "source_url": capture["uri"],
            "bytes": capture["bytes"], "sha256": capture["sha256"],
            "date_start": "2021-01-01", "date_end": "2026-10-13",
            "station_ids": [STATION], "characteristics": list(characteristics),
            "record_count": count, "metadata_sources": metadata})
        all_records.extend(records)
    if (len({row["ResultIdentifier"] for row in all_records}) != 610
            or len({row["ActivityIdentifier"] for row in all_records}) != 56):
        raise ValueError("Retain all 610 result identifiers and all 56 activities.")
    conditions = {value: sum(row["ResultDetectionConditionText"] == value for row in all_records)
                  for value in {row["ResultDetectionConditionText"] for row in all_records}}
    if conditions != {"": 557, "Present Below Quantification Limit": 49,
                       "Present Above Quantification Limit": 4}:
        raise ValueError("Original SV-833 qualification counts changed.")
    station_capture = captures["original_station_catalogue"]
    unused, station_rows = _csv(originals[station_capture["path"]])
    matches = [(number, row) for number, row in enumerate(station_rows, 2)
               if row["MonitoringLocationIdentifier"] == STATION]
    if len(matches) != 1:
        raise ValueError("The original station catalogue must identify SV-833 exactly once.")
    station_number, station = matches[0]
    longitude, latitude = float(station["LongitudeMeasure"]), float(station["LatitudeMeasure"])
    if (station["HorizontalCoordinateReferenceSystemDatumName"] != "WGS84"
            or not math.isfinite(longitude) or not math.isfinite(latitude)
            or not -180 <= longitude <= 180 or not -90 <= latitude <= 90):
        raise ValueError("Retain the original finite WGS84 station coordinates.")
    station_table = {
        "site_id": "SV-833", "monitoring_location_id": STATION,
        "description": station["MonitoringLocationDescriptionText"],
        "latitude": station["LatitudeMeasure"], "longitude": station["LongitudeMeasure"],
        "datum": "WGS84", "epsg": 4326, "publisher_huc8": station["HUCEightDigitCode"],
        "original_source_path": ROOT + "/" + station_capture["path"],
        "original_source_sha256": station_capture["sha256"], "original_source_csv_row": station_number,
    }
    dates = sorted({row["ActivityStartDate"] for row in all_records})
    selection_notes = [
        "The desk retains every one of the 610 original NarrowResult identifiers. The three characteristic profiles are disjoint; their date intervals and station overlap intentionally.",
        "ActivityIdentifier joins the original activity profile for source project, routine-sample type, clock, depth and comments. ResultIdentifier joins the original reporting-limit profile. Each joined field retains its original file, hash and CSV row.",
        "All 34 agreeing repeated values retain distinct ResultIdentifiers here. The scientific report separately groups them into 576 activity-characteristic measurements and explains weighting differences.",
        "The desk's quantified-only summaries count original result rows within separate project, method, fraction, specification, activity type and unit series. Blank and censored values remain distinct from quantified values.",
        "The original NPS-2013 and SWS-2024 project names come from the activity export. Sampling ends on 2026-06-24 although the original query extends through 2026-10-13.",
        "The three default Result profiles and period-of-record summary remain source companions for independent reconciliation. Only the three NarrowResult profiles form this observation cohort.",
    ]
    study = {
        "schema": "upstate.published-water-quality-study/v1", "study_id": BUILTIN_ID, "title": TITLE,
        "issuing_body": "South Carolina Department of Environmental Services / Water Quality Portal",
        "publication": "Original 2021–2026 observations; source edition 2026-10-13",
        "original_url": entries[0]["source_url"], "observation_calendar_filters": True,
        "observation_sources": "observation-sources.json",
        "observation_selection_notes": selection_notes,
        "observation_scope": "Original physical, nutrient and microbiological results at Three and Twenty Creek station SV-833.",
        "grab_sampling": {"start": dates[0], "end": dates[-1],
                          "frequency": "Original irregular sampling dates", "total_visits": 56},
        "content_counts": {"stations": 1, "original_result_rows": 610, "original_activity_count": 56,
                           "quantified": 557, "below_limit": 49, "above_limit": 4},
        "source_interpretation": {"source_manifest_sha256": _sha(originals[MANIFEST]),
            "coordinates": "Original station CSV WGS84 numeric coordinates; EPSG:4326.",
            "result_identity": "610 distinct original ResultIdentifiers; repeated activity-values remain present.",
            "metadata_join": "Exact original ActivityIdentifier and ResultIdentifier joins with identity-field agreement."},
    }
    files = {ROOT + "/" + name: raw for name, raw in originals.items()}
    files.update({
        "study.json": _json(study), "stations.csv": _csv_bytes(list(station_table), [station_table]),
        "seasonal_summaries.csv": SEASONAL_HEADER.encode("utf-8"),
        "source_notes.json": _json([{"code": "ORIGINAL_PROFILE_JOIN", "context": note}
                                    for note in selection_notes]),
        "observation-sources.json": _json({"schema": "upstate.observation-sources/v1",
            "record_count": 610, "activity_count": 56, "sources": entries,
            "sample_support": "Original SV-833 result records, retaining repeated values and exact source identifiers"}),
    })
    vector_name = "native/sv833-station-wgs84.geojson"
    files[vector_name] = _json({
        "type": "FeatureCollection", "crs": {"type": "name", "properties": {"name": "EPSG:4326"}},
        "features": [{"type": "Feature", "id": STATION,
            "geometry": {"type": "Point", "coordinates": [longitude, latitude]},
            "properties": {**station, "site_id": "SV-833", "original_station_source_row": station_number}}],
    })
    companions = [{"path": ROOT + "/" + name, "bytes": len(raw), "sha256": _sha(raw)}
                  for name, raw in sorted(originals.items())]
    files["model-sources.json"] = _json({"schema": "upstate.sources/v1", "title": TITLE, "entries": [{
        "id": "sv833-original-native-station-wgs84", "title": "SV-833 original station CSV coordinates",
        "kind": "vector", "path": vector_name, "source_crs": "EPSG:4326",
        "bytes": len(files[vector_name]), "sha256": _sha(files[vector_name]),
        "uri": station_capture["uri"], "vintage": "Original station catalogue captured 2026-10-13",
        "station_id_field": "MonitoringLocationIdentifier", "native_id_field": "MonitoringLocationIdentifier",
        "companions": companions, "metadata": {"coordinate_basis": "Unchanged original WGS84 station CSV values",
            "source_csv_sha256": station_capture["sha256"], "source_csv_row": station_number},
    }]})
    application_root = Path(application) if application is not None else Path(__file__).resolve().parents[1]
    context_manifests = []
    for name in study_context.manifest_names(BUILTIN_ID):
        if name == MANIFEST or not (application_root / name).is_file():
            continue
        for path, raw in study_context.retained_files(application_root, application_root / name).items():
            if path in files and files[path] != raw:
                raise ValueError("An original SV-833 context conflicts at " + path)
            files[path] = raw
        context_manifests.append(name)
    if context_manifests:
        study["related_context_manifests"] = context_manifests
        if "sv833_hydrologic_context.sources.json" in context_manifests:
            selection_notes.append(
                "The original SV-833 hydrologic context retains separate station representations, "
                "45 whole upstream reaches and the unsimplified whole-catchment basin. "
                "The 100 km original navigation responses contain zero upstream NWIS sites "
                "and 14 downstream indexed sites. Those downstream sites describe network context; "
                "their measurements are separate from the 610 original SV-833 results.")
        study["observation_selection_notes"] = selection_notes
        files["study.json"] = _json(study)
        files["source_notes.json"] = _json([{"code": "ORIGINAL_PROFILE_JOIN", "context": item}
                                            for item in selection_notes])
    if (application_root / temporal_context.SOURCE_MANIFEST).is_file():
        related = temporal_context.load_companion(application_root)
        for name, raw in related["files"].items():
            if name in files and files[name] != raw:
                raise ValueError("The original microbial calendar context conflicts at " + name)
            files[name] = raw
        model_sources = json.loads(files["model-sources.json"])
        model_sources["entries"].extend([related["recipe_entry"], related["report_entry"]])
        files["model-sources.json"] = _json(model_sources)
        note = ("The related utility microbial calendar and flow explorer retains its own complete "
                "multi-station scope, source recipes and original inputs. Its calendar comparisons "
                "do not change this desk's 610-result SV-833 cohort.")
        selection_notes.append(note)
        study["observation_selection_notes"] = selection_notes
        files["study.json"] = _json(study)
        files["source_notes.json"] = _json([{"code": "ORIGINAL_PROFILE_JOIN", "context": item}
                                            for item in selection_notes])
    files["README.md"] = (
        "# SV-833 original observations\n\n"
        "Import the installed scdes-sv833-water-quality-2021-2026 cohort in Published studies. "
        "Choose a characteristic and calendar interval, inspect an original result and its activity/limit source rows, "
        "then export the selected report or the complete study. Reopening the archive retains all original bodies "
        "and the full offline scientific report.\n\n" + "\n\n".join(selection_notes) + "\n"
    ).encode("utf-8")
    return files


def builtin_companion(application=None):
    files = build_files(application)
    return _json({"schema": "upstate.published-study-files/v1", "files": [
        {"path": name, "bytes": len(raw), "sha256": _sha(raw),
         "encoding": "utf-8", "content": raw.decode("utf-8")}
        for name, raw in sorted(files.items())]}), {}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--application", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args(argv)
    files = build_files(args.application)
    output = args.output.expanduser().resolve()
    output.mkdir(parents=True, exist_ok=True)
    for name, raw in sorted(files.items()):
        target = output / name
        if target.exists() and target.read_bytes() != raw:
            raise ValueError("Choose a new output directory; a retained source differs: " + name)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(raw)
    print(json.dumps({"study_id": BUILTIN_ID, "directory": str(output),
                      "files": len(files), "original_result_rows": 610, "original_activity_count": 56}))


if __name__ == "__main__":
    main()
