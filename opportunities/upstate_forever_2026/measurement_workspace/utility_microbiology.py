"""Build the original utility E. coli cohort for the maintained Published studies desk."""
from __future__ import annotations

import argparse
import csv
import hashlib
import io
import json
import math
from pathlib import Path, PurePosixPath
import re

BUILTIN_ID = "utility-ecoli-2021-2025"
TITLE = "Utility-focus E. coli observations, 2021–2025"
SOURCE_DIRECTORY = "source/ecoli_utility_context/20261013"
MANIFEST_SHA256 = "7dbcc1b0d4d6f48f8a9d43fdbfd6ad3308b8435f4085e57aceb9e774b4c3e37e"
COUNTS = {"stations": 36, "original_result_rows": 730, "original_activity_count": 730,
          "quantified": 554, "censored": 175, "not_reported": 1}
EXPECTED_CONDITIONS = {"": 554, "Present Above Quantification Limit": 6,
    "Present Below Quantification Limit": 67, "Not Detected": 102, "Not Reported": 1}
DATUMS = {"WGS84": ("wgs84", 4326, 34), "NAD83": ("nad83", 4269, 2)}
SEASONAL_HEADER = ("site_id,stratum,depth_min_m,depth_max_m,parameter,units,"
                   "mean,sd,minimum,maximum,n,source_table,source_pdf_page,statistic_basis\n")


def _sha(data):
    return hashlib.sha256(data).hexdigest()


def _json(value):
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2) + "\n").encode("utf-8")


def _relative(value):
    if not isinstance(value, str) or not value or "\\" in value or "\0" in value:
        raise ValueError("Original microbial source members require portable relative paths")
    member = PurePosixPath(value)
    if member.is_absolute() or ".." in member.parts or str(member) != value or value == ".":
        raise ValueError("Original microbial source members must stay inside their source directory")
    return value


def _csv(data, expected_columns=None):
    reader = csv.DictReader(io.StringIO(data.decode("utf-8-sig"), newline=""))
    fields = reader.fieldnames or []
    if not fields or len(fields) != len(set(fields)) or (expected_columns and len(fields) != expected_columns):
        raise ValueError("Retain the complete original microbial source columns")
    rows = list(reader)
    if any(None in row or any(value is None for value in row.values()) for row in rows):
        raise ValueError("An original microbial source CSV has a malformed row")
    return fields, rows


def _csv_bytes(fields, rows):
    output = io.StringIO(newline="")
    writer = csv.DictWriter(output, fieldnames=fields, lineterminator="\n")
    writer.writeheader()
    writer.writerows(rows)
    return output.getvalue().encode("utf-8")


def source_files(application=None):
    """Read and verify the same 22 source bodies used by the native microbial study."""
    application = Path(application) if application is not None else Path(__file__).resolve().parents[1]
    root = (application / SOURCE_DIRECTORY).resolve(strict=True)
    manifest_body = (root / "source-manifest.json").read_bytes()
    if _sha(manifest_body) != MANIFEST_SHA256:
        raise ValueError("Choose the complete original utility microbial source edition")
    manifest = json.loads(manifest_body)
    selected = {"source-manifest.json": {"path": "source-manifest.json", "sha256": MANIFEST_SHA256}}
    for entry in manifest["entries"]:
        for member in [entry, *entry.get("companions", [])]:
            name = _relative(member["path"])
            previous = selected.get(name)
            if previous and previous.get("sha256") and member.get("sha256") and previous["sha256"] != member["sha256"]:
                raise ValueError("Original microbial source hashes conflict: " + name)
            if previous is None or member.get("sha256"):
                selected[name] = member
    if len(selected) != 22:
        raise ValueError("Retain the complete 22-file original microbial source")
    files = {}
    for name, descriptor in sorted(selected.items()):
        path = (root / name).resolve(strict=True)
        if not path.is_relative_to(root) or not path.is_file():
            raise ValueError("An original microbial source member leaves its directory")
        data = path.read_bytes()
        if descriptor.get("sha256", _sha(data)) != _sha(data) or descriptor.get("bytes", len(data)) != len(data):
            raise ValueError("Original microbial source bytes changed: " + name)
        data.decode("utf-8")
        files[name] = data
    return files


def catalog_entry(application=None):
    application = Path(application) if application is not None else Path(__file__).resolve().parents[1]
    if not (application / SOURCE_DIRECTORY / "source-manifest.json").is_file():
        return None
    return {"id": BUILTIN_ID, "title": TITLE,
            "publication": "2021–2025 observations; source edition 2026-10-13",
            "counts": dict(COUNTS)}


def build_files(application=None):
    originals = source_files(application)
    from . import utility_microbiology_context as temporal_context
    application_root = Path(application) if application is not None else Path(__file__).resolve().parents[1]
    temporal = (temporal_context.load_companion(application_root)
                if (application_root / temporal_context.SOURCE_MANIFEST).is_file() else None)
    inputs = json.loads(originals["source-inputs.json"])
    captures = {entry["path"]: entry for entry in inputs["sources"]}
    for name, capture in captures.items():
        if name not in originals or len(originals[name]) != capture["bytes"] or _sha(originals[name]) != capture["sha256"]:
            raise ValueError("An original query capture differs: " + name)
    result_names = sorted(name for name in captures if re.fullmatch(r"raw/(arjws|prwd)-results-\d{4}(?:-\d{4})?-original\.csv", name))
    if len(result_names) != 6:
        raise ValueError("Retain all six original microbial result responses")
    result_sets = [(name, _csv(originals[name], 63)[1]) for name in result_names]
    records = [row for unused, rows in result_sets for row in rows]
    if len(records) != 730 or len({row["ActivityIdentifier"] for row in records}) != 730:
        raise ValueError("Retain all 730 distinct original microbial activity identifiers")
    if any(row["CharacteristicName"] != "Escherichia coli" for row in records):
        raise ValueError("Retain the original Escherichia coli characteristic")
    conditions = {condition: sum(row["ResultDetectionConditionText"] == condition for row in records)
                  for condition in {row["ResultDetectionConditionText"] for row in records}}
    if conditions != EXPECTED_CONDITIONS:
        raise ValueError("Original microbial result conditions changed")
    for row in records:
        value = row["ResultMeasureValue"]
        if row["ResultDetectionConditionText"]:
            if value != "":
                raise ValueError("Retain original blank result values for qualified microbial records")
        elif not value or not math.isfinite(float(value)):
            raise ValueError("Retain the original finite quantified microbial value")
    activity_types = {kind: sum(row["ActivityTypeCode"] == kind for row in records)
                      for kind in {row["ActivityTypeCode"] for row in records}}
    if activity_types != {"Sample-Routine": 729, "Quality Control Sample-Field Replicate": 1}:
        raise ValueError("Retain the original routine and field-replicate activities")
    selected_ids = {row["MonitoringLocationIdentifier"] for row in records}
    station_fields, station_rows = _csv(originals["raw/stations-original.csv"], 37)
    stations = {row["MonitoringLocationIdentifier"]: (index, row)
                for index, row in enumerate(station_rows, 2)}
    if len(stations) != len(station_rows) or not selected_ids <= set(stations) or len(selected_ids) != 36:
        raise ValueError("Original station source identities do not match the result cohort")
    display = json.loads(originals["selected-stations.geojson"])
    membership = {f["properties"]["MonitoringLocationIdentifier"]: f["properties"]
                  for f in display["features"]}
    if set(membership) != selected_ids:
        raise ValueError("Retain the original 36-station utility assignment")
    source_index = []
    for name, rows in result_sets:
        capture = captures[name]
        years = re.search(r"-results-(\d{4})(?:-(\d{4}))?-original", name)
        first, last = years.group(1), years.group(2) or years.group(1)
        source_index.append({"path": "original/" + name, "format": "wqp-result-csv",
            "source_url": capture["url"], "sha256": capture["sha256"], "bytes": capture["bytes"],
            "date_start": first + "-01-01", "date_end": last + "-12-31",
            "record_count": len(rows),
            "station_ids": sorted({row["MonitoringLocationIdentifier"] for row in rows})})
    station_table, native = [], {datum: [] for datum in DATUMS}
    utility_counts = {utility: {"stations": 0, "records": 0} for utility in ("ARJWS", "PRWD")}
    for station_id in sorted(selected_ids):
        original_row, row = stations[station_id]
        properties = membership[station_id]
        if any(properties.get(name) != value for name, value in row.items()):
            raise ValueError("Selected station metadata differs from the original CSV")
        datum = row["HorizontalCoordinateReferenceSystemDatumName"]
        if datum not in DATUMS:
            raise ValueError("Retain an explicit original WGS84 or NAD83 station datum")
        code, epsg, unused = DATUMS[datum]
        longitude, latitude = float(row["LongitudeMeasure"]), float(row["LatitudeMeasure"])
        if not math.isfinite(longitude) or not math.isfinite(latitude) or not -180 <= longitude <= 180 or not -90 <= latitude <= 90:
            raise ValueError("Original station coordinates are outside their native bounds")
        site_id = re.sub(r"^21SC60WQ(?:_WQX)?-", "", station_id)
        utility = properties["utility_id"]
        if utility not in utility_counts:
            raise ValueError("Retain the original utility assignment")
        utility_counts[utility]["stations"] += 1
        utility_counts[utility]["records"] += sum(record["MonitoringLocationIdentifier"] == station_id for record in records)
        station_table.append({"site_id": site_id, "monitoring_location_id": station_id,
            "description": row["MonitoringLocationName"], "latitude": row["LatitudeMeasure"],
            "longitude": row["LongitudeMeasure"], "datum": datum, "epsg": epsg,
            "utility_id": utility, "publisher_huc8": row["HUCEightDigitCode"],
            "source_membership_basis": properties["source_membership_basis"],
            "matched_huc12": properties.get("matched_huc12") or "",
            "original_source_path": "original/raw/stations-original.csv",
            "original_source_sha256": captures["raw/stations-original.csv"]["sha256"],
            "original_source_csv_row": original_row})
        native[datum].append({"type": "Feature", "id": station_id,
            "geometry": {"type": "Point", "coordinates": [longitude, latitude]},
            "properties": {**row, "site_id": site_id, "utility_id": utility,
                "original_station_source_row": original_row}})
    if utility_counts != {"ARJWS": {"stations": 5, "records": 142}, "PRWD": {"stations": 31, "records": 588}}:
        raise ValueError("Original utility source counts changed")
    dates = sorted({row["ActivityStartDate"] for row in records})
    selection_notes = [
        "Station, characteristic, year and month filters select original dated E. coli result rows. Every complete agency CSV remains in the exported study.",
        "Project, activity type, fraction, analytical method, result type, basis and original support-unit spelling define separate series. The field replicate remains its own activity-type series.",
        "Original result values, reported limits and missing values retain distinct source fields. Arithmetic means summarize quantified rows within each selected series.",
        "Quantified means include every selected numeric original, including results whose original comment says Information Only. All 72 source markers remain visible beside the result rows; the retained original explorer provides explicit comment-based comparisons.",
        "Utility groups retain their original source-selection basis. Native Station geography joins the original datum-specific points to retained watershed polygons.",
    ]
    study = {"schema": "upstate.published-water-quality-study/v1", "study_id": BUILTIN_ID,
        "title": TITLE, "issuing_body": "Original Water Quality Portal publishing agencies",
        "publication": "2021–2025 observations; source edition 2026-10-13",
        "original_url": source_index[0]["source_url"],
        "observation_calendar_filters": True, "observation_sources": "observation-sources.json",
        "observation_selection_notes": selection_notes,
        "observation_scope": "Original utility-focus microbial observations with separate source, method, qualifier, activity type and unit series.",
        "grab_sampling": {"start": dates[0], "end": dates[-1], "frequency": "Original irregular sampling dates", "total_visits": 730},
        "content_counts": dict(COUNTS),
        "source_interpretation": {"coordinates": "Original CSV numeric strings and datums: 34 WGS84 / EPSG:4326 and two NAD83 / EPSG:4269.",
            "utility_source_counts": utility_counts, "source_manifest_sha256": MANIFEST_SHA256,
            "temporal_support": "Original sampling dates and methods; routine and field-replicate activity types remain distinct."}}
    notes = [
        {"code": "ORIGINAL_RECORDS", "context": "All 730 original WQP result rows retain all 63 source fields, six response identities and CSV row selectors."},
        {"code": "ORIGINAL_COMMENTS", "context": "The original result comments identify 72 Information Only or Infomation Only records, including the reported 24,000 value at RV_01_14 on 2025-03-24. Result, activity and laboratory comments remain visible in the study; quantified means include all numeric rows selected by the study filters. The original explorer retains explicit comment-selection controls."},
        {"code": "DETECTION_CONDITIONS", "context": "554 quantified results; six above-limit, 67 below-limit and 102 not-detected results retain their original boundary fields; one not-reported result remains blank."},
        {"code": "SOURCE_UNITS", "context": "Original MPN/100mL and MPN/100 ml spellings remain separate series. A blank result-unit field stays blank; bound quantities use their original bound-unit field."},
        {"code": "ORIGINAL_DATUMS", "context": "The original station table and two derived native point sources use the unchanged CSV coordinate values in their declared WGS84/NAD83 datums. The preserved WQP GeoJSON files remain display-source documents."},
        {"code": "FIELD_REPLICATE", "site_id": "21GAEPD_WQX-LK_01_11", "context": "Original activity 21GAEPD_WQX-A00428245 on 2023-06-22 is a Quality Control Sample-Field Replicate. Its original method, value 21 and resampling comment remain available."},
        {"code": "NOT_REPORTED", "site_id": "21GAEPD_WQX-LK_01_11", "context": "Original activity 21GAEPD_WQX-A00431284 on 2023-07-18 has no result or limit value. Its original sample-temperature comment remains attached."},
        {"code": "GEOGRAPHIC_SUPPORT", "context": "ARJWS source selection uses the four original upstream HUC12s; PRWD uses the original publisher Tugaloo HUC8 assignment. The retained native Station geography study supplies independently retained polygon membership."},
    ]
    if temporal is not None:
        study["source_interpretation"]["temporal_analysis"] = temporal["provenance"]
        notes.append({"code": "TEMPORAL_AND_FLOW_CONTEXT",
            "context": "The retained complete temporal explorer preserves the author's original station, calendar, method, comment-sensitivity and same-station flow analyses. Its original analytical edition and three original inputs remain together; the native observed-report selection binds a separate path-derived recipe to these exact source bodies.",
            "report_path": temporal["report_path"]})
        if temporal.get("gallery_path") is not None:
            notes.append({"code": "ORIGINAL_SCIENTIFIC_FIGURES",
                "context": "The original figure gallery retains complete sampling-coverage, calendar-support and same-station flow panels with exact source-point identities and vector downloads. It uses the author's full-source scope; primary study filters do not recalculate its original panels.",
                "report_path": temporal["gallery_path"]})
    files = {"original/" + name: data for name, data in originals.items()}
    if temporal is not None:
        for name, body in temporal["files"].items():
            if name in files and files[name] != body:
                raise ValueError("The retained temporal context conflicts with an original study member: " + name)
            files[name] = body
    files.update({"study.json": _json(study), "source_notes.json": _json(notes),
        "stations.csv": _csv_bytes(list(station_table[0]), station_table),
        "seasonal_summaries.csv": SEASONAL_HEADER.encode("utf-8"),
        "observation-sources.json": _json({"schema": "upstate.observation-sources/v1",
            "record_count": 730, "activity_count": 730,
            "sample_support": "Original utility-focus microbial sampling activities",
            "sources": source_index}),
        "source-summary.json": _json({"schema": "upstate.utility-microbial-published-summary/v1",
            **COUNTS, "result_conditions": conditions, "activity_types": activity_types,
            "utility_source_counts": utility_counts, "original_result_columns": 63,
            "original_station_columns": station_fields,
            "coordinate_datums": {datum: len(rows) for datum, rows in native.items()},
            "first_sampling_date": dates[0], "last_sampling_date": dates[-1],
            "sampling_dates": len(dates), "source_manifest_sha256": MANIFEST_SHA256})})
    companions = [{"path": "original/" + name, "sha256": _sha(data), "bytes": len(data)}
                  for name, data in sorted(originals.items())]
    original_manifest = json.loads(originals["source-manifest.json"])
    entries = []
    for original in original_manifest["entries"]:
        entry = dict(original)
        entry["path"] = "original/" + original["path"]
        entry["companions"] = companions
        if original["path"] == "selected-stations.geojson":
            entry.update(id="utility-microbial-original-display-stations", kind="document",
                title="Original WQP utility station display positions",
                geometry_purpose="original_display_source")
        entries.append(entry)
    entries.append({"id": "utility-microbial-original-station-discovery", "kind": "document",
        "title": "Original WQP station discovery GeoJSON display response",
        "path": "original/raw/stations-original.geojson", "companions": companions,
        "uri": captures["raw/stations-original.geojson"]["url"],
        "vintage": study["publication"], "geometry_purpose": "original_display_source"})
    for datum, (code, epsg, count) in DATUMS.items():
        if len(native[datum]) != count:
            raise ValueError("Original microbial coordinate datum counts changed")
        filename = "native/stations-" + code + ".geojson"
        files[filename] = _json({"type": "FeatureCollection",
            "crs": {"type": "name", "properties": {"name": "EPSG:" + str(epsg)}},
            "features": native[datum]})
        entries.append({"id": "utility-microbial-original-native-" + code, "title": "Original station CSV coordinates — " + datum,
            "kind": "vector", "path": filename, "source_crs": "EPSG:" + str(epsg),
            "sha256": _sha(files[filename]), "bytes": len(files[filename]),
            "uri": captures["raw/stations-original.csv"]["url"], "vintage": study["publication"],
            "station_id_field": "MonitoringLocationIdentifier", "native_id_field": "MonitoringLocationIdentifier",
            "station_count": count, "coordinate_datum": datum, "companions": companions,
            "metadata": {"coordinate_basis": "Unchanged original station CSV values and datum",
                "source_csv_sha256": captures["raw/stations-original.csv"]["sha256"]}})
    if temporal is not None:
        entries.extend([temporal["report_entry"], temporal["recipe_entry"]])
        if temporal.get("gallery_entry") is not None:
            entries.append(temporal["gallery_entry"])
        summary = json.loads(files["source-summary.json"])
        summary["temporal_analysis"] = temporal["provenance"]
        files["source-summary.json"] = _json(summary)
    # Each source view retains its neighbours, while omitting its own primary body.
    for entry in entries:
        entry["companions"] = [item for item in entry["companions"] if item["path"] != entry["path"]]
    files["model-sources.json"] = _json({"schema": "upstate.sources/v1", "title": TITLE,
        "captured_at": original_manifest.get("captured_at"), "entries": entries})
    files["README.md"] = (
        "# Utility-focus E. coli observations\n\n"
        "Open Published studies and import the installed utility-ecoli-2021-2025 source. "
        "Select a station, Escherichia coli, year and month; inspect the original result rows, "
        "method and activity-type series, qualifier fields and exact source CSV selectors. "
        "Export the selected report or the complete study and reopen the same saved edition.\n\n"
        "This bundle carries all 22 unchanged original source bodies, six original response CSVs, "
        "the complete offline explorer and two native coordinate sources derived from the original "
        "station CSV in EPSG:4326 and EPSG:4269. Source bounds remain separate from reported values. "
        "The original field replicate remains in its own activity-type series. "
        "Station geography supplies the retained native polygon-membership journey.\n"
    ).encode("utf-8")
    if temporal is not None:
        files["README.md"] += (
            "\nThe maintained temporal and flow explorer is retained at " + temporal["report_path"] +
            ". Its complete source tree and original inputs preserve the published relative paths. "
            "The separately bound observed-report recipe is available to the ordinary scientific delivery picker, "
            "including ordered multi-report deliveries.\n"
        ).encode("utf-8")
        if temporal.get("gallery_path") is not None:
            files["README.md"] += (
                "\nThe original scientific-figure gallery is retained at " + temporal["gallery_path"] +
                ". Its own document source includes the complete vector, point-table and reproduction companions. "
                "Open or export this original source to keep its relative downloads together.\n"
            ).encode("utf-8")
    return files


def builtin_companion(application=None):
    files = build_files(application)
    value = {"schema": "upstate.published-study-files/v1",
        "files": [{"path": name, "bytes": len(data), "sha256": _sha(data),
                   "encoding": "utf-8", "content": data.decode("utf-8")}
                  for name, data in sorted(files.items())]}
    return _json(value), {}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--application", type=Path)
    parser.add_argument("--output", type=Path, required=True,
                        help="New complete study source directory")
    args = parser.parse_args(argv)
    files = build_files(args.application)
    output = args.output.expanduser().resolve()
    output.mkdir(parents=True, exist_ok=True)
    for name, body in sorted(files.items()):
        target = output / name
        if target.exists() and target.read_bytes() != body:
            raise ValueError("Choose a new output directory; a retained source differs: " + name)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(body)
    print(json.dumps({"study_id": BUILTIN_ID, "directory": str(output),
        "files": len(files), "summary": json.loads(files["source-summary.json"])}, indent=2))


if __name__ == "__main__":
    main()
