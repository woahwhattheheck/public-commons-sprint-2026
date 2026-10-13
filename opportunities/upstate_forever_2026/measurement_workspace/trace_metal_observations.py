"""Original trace-metal and same-activity chemistry intake for Published studies.

All original response bytes are retained. The selected WQP-format view adds
explicit original-body/original-record lineage without changing any publisher cell.
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import io
import json
import math
from pathlib import Path, PurePosixPath
import re

BUILTIN_ID = "scdes-eighteenmile-trace-metals-2023"
TITLE = "Eighteenmile 2023 — trace metals and same-activity chemistry"
SOURCE_DIRECTORY = "observations/eighteenmile_2023/trace_metals/generated"
STATION_SOURCE = "source/trace-metal-native/20261013/stations-original.csv"
STATION_SHA256 = "ee0b0c50f30d20b1e12b55c7964a13e10e39729f9d4dd4d07d422fd3eba7292b"
STATION_BYTES = 21317
STATION_URL = "https://www.waterqualitydata.us/data/Station/search?huc=03060101%3B03060102&characteristicName=Escherichia%20coli&startDateLo=01-01-2021&startDateHi=12-31-2025&mimeType=csv"
INPUT_SHA256 = "9b110923090d4200f54b2c2d97592053ea84e5d3b366662e4d582ec1b5369309"
INPUT_FILE_SHA256 = "f9b8ec464b3c0e0a3bc8f1ac7571b83c474d07523fa90dc9f17dda16531d81a3"
METALS = ("Cadmium", "Chromium", "Copper", "Iron", "Lead", "Manganese", "Mercury", "Nickel", "Zinc")
CHEMISTRY = ("Calcium", "Magnesium", "Hardness, Ca, Mg")
COUNTS = {"stations": 5, "activities": 17, "metal_results": 153,
          "quantified_metals": 38, "below_limit_metals": 115,
          "same_activity_chemistry": 51, "selected_results": 204,
          "original_responses": 9, "complete_original_results": 920}
LINEAGE_FIELDS = ("TraceOriginalSourcePath", "TraceOriginalSourceSHA256",
                  "TraceOriginalCSVRow", "TraceOriginalRecordIndex",
                  "TraceOriginalQueryURL", "TraceRecordIdentity", "TraceCohort")
SEASONAL_HEADER = ("site_id,stratum,depth_min_m,depth_max_m,parameter,units,"
                   "mean,sd,minimum,maximum,n,source_table,source_pdf_page,statistic_basis\n")


def _sha(data):
    return hashlib.sha256(data).hexdigest()


def _json(value):
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2, allow_nan=False) + "\n").encode("utf-8")


def _path(value):
    if not isinstance(value, str) or not value or "\\" in value or "\0" in value:
        raise ValueError("Retain portable relative trace source paths.")
    path = PurePosixPath(value)
    if path.is_absolute() or ".." in path.parts or str(path) != value or value == ".":
        raise ValueError("The trace source must stay in its original directory.")
    return value


def _csv(data):
    reader = csv.DictReader(io.StringIO(data.decode("utf-8-sig"), newline=""))
    fields = reader.fieldnames or []
    rows = list(reader)
    if not fields or len(fields) != len(set(fields)) or any(
            None in row or any(value is None for value in row.values()) for row in rows):
        raise ValueError("The complete original CSV field and row contract changed.")
    return fields, rows


def _csv_bytes(fields, rows):
    out = io.StringIO(newline="")
    writer = csv.DictWriter(out, fieldnames=fields, lineterminator="\n")
    writer.writeheader()
    writer.writerows(rows)
    return out.getvalue().encode("utf-8")


def _descriptor(name, data):
    return {"path": name, "bytes": len(data), "sha256": _sha(data)}


def source_files(application=None):
    application = Path(application or Path(__file__).resolve().parents[1]).resolve(strict=True)
    root = application / SOURCE_DIRECTORY
    inventory_data = (root / "inventory.json").read_bytes()
    inventory = json.loads(inventory_data)
    if (inventory.get("schema") != "upstate.trace-metal-package/v1"
            or inventory.get("input_sha256") != INPUT_SHA256
            or inventory.get("record_count") != 153 or inventory.get("activity_count") != 17
            or any(inventory.get("selection", {}).get(key) != "all"
                   for key in ("station", "analyte", "status", "month"))
            or inventory.get("selection", {}).get("search") != ""):
        raise ValueError("Install the complete original 153-result trace source edition.")
    originals = {"inventory.json": inventory_data}
    for item in inventory.get("members", []):
        name = _path(item["path"])
        if name in originals:
            raise ValueError("Trace package paths must be unique.")
        path = (root / name).resolve(strict=True)
        if not path.is_relative_to(root.resolve()) or not path.is_file():
            raise ValueError("A trace source member leaves its original directory.")
        data = path.read_bytes()
        if len(data) != item.get("bytes") or _sha(data) != item.get("sha256"):
            raise ValueError("A retained trace package member changed: " + name)
        originals[name] = data
    if len(originals) != 38:
        raise ValueError("Retain the complete 38-member original trace package.")
    stations = (application / STATION_SOURCE).read_bytes()
    if len(stations) != STATION_BYTES or _sha(stations) != STATION_SHA256:
        raise ValueError("Retain the complete original WQP station response.")
    return originals, stations


def catalog_entry(application=None):
    application = Path(application or Path(__file__).resolve().parents[1])
    if not (application / SOURCE_DIRECTORY / "inventory.json").is_file() or not (application / STATION_SOURCE).is_file():
        return None
    return {"id": BUILTIN_ID, "title": TITLE,
            "publication": "Original 2023 observations; retained 2026-10-13",
            "issuing_body": "South Carolina Department of Environmental Services",
            "counts": dict(COUNTS)}


def build_files(application=None):
    return build_retained_files(*source_files(application))


def build_retained_files(originals, station_body):
    """Compose an immutable native study from verified original source bytes."""
    if len(station_body) != STATION_BYTES or _sha(station_body) != STATION_SHA256:
        raise ValueError("The original station metadata response changed.")
    inventory = json.loads(originals["inventory.json"])
    if (inventory.get("schema") != "upstate.trace-metal-package/v1"
            or inventory.get("input_sha256") != INPUT_SHA256
            or inventory.get("record_count") != 153 or inventory.get("activity_count") != 17):
        raise ValueError("Retain the original complete trace package identity.")
    expected = {item["path"]: item for item in inventory["members"]}
    if set(originals) != set(expected) | {"inventory.json"}:
        raise ValueError("The complete original trace package differs from its inventory.")
    for name, item in expected.items():
        if len(originals[name]) != item["bytes"] or _sha(originals[name]) != item["sha256"]:
            raise ValueError("A trace package member changed: " + name)
    inputs = json.loads(originals["inputs.json"])
    if _sha(originals["inputs.json"]) != INPUT_FILE_SHA256:
        raise ValueError("The original trace input selection changed.")
    captures = inputs["sources"]
    if len(captures) != 9:
        raise ValueError("Retain all nine original WQP responses.")
    raw_by_identity, originals_count, fields = {}, 0, None
    for capture in captures:
        name = _path(capture["source_path"])
        body = originals[name]
        if len(body) != capture["bytes"] or _sha(body) != capture["sha256"]:
            raise ValueError("An original agency response changed.")
        header, rows = _csv(body)
        if len(header) != 63 or (fields is not None and fields != header):
            raise ValueError("Retain all 63 original WQP Result fields in their original order.")
        fields = header
        if len(rows) != capture["record_count"]:
            raise ValueError("An original response record count changed.")
        originals_count += len(rows)
        for index, row in enumerate(rows, 1):
            identity = capture["sha256"] + ":" + str(index)
            if identity in raw_by_identity:
                raise ValueError("Original result selectors must be distinct.")
            raw_by_identity[identity] = (capture, index, row)
    if originals_count != 920:
        raise ValueError("Retain the entire original 920-result acquisition.")
    selected_fields, metal_records = _csv(originals["selected-records.csv"])
    unused, context_records = _csv(originals["same-activity-context.csv"])
    if len(metal_records) != 153 or len(context_records) != 51:
        raise ValueError("Retain 153 trace-metal and 51 same-activity chemistry results.")
    metal_ids = {row["record_id"] for row in metal_records}
    context_ids = {row["record_id"] for row in context_records}
    if len(metal_ids) != 153 or len(context_ids) != 51 or metal_ids & context_ids:
        raise ValueError("Each original selected result must appear once.")
    selected_ids = metal_ids | context_ids
    actual_metals = {identity for identity, (capture, index, row) in raw_by_identity.items()
                     if row["CharacteristicName"] in METALS and row["ProjectIdentifier"] == "SWS-2023"
                     and row["ActivityTypeCode"] == "Sample-Routine"
                     and row["ActivityMediaName"] == "Water" and row["ActivityStartDate"].startswith("2023-")}
    if metal_ids != actual_metals:
        raise ValueError("The retained trace cohort differs from the original nine-metal source selection.")
    activity_key = lambda row: (row["MonitoringLocationIdentifier"], row["ProjectIdentifier"], row["ActivityIdentifier"])
    activities = {activity_key(raw_by_identity[key][2]) for key in metal_ids}
    actual_context = {identity for identity, (capture, index, row) in raw_by_identity.items()
                      if activity_key(row) in activities and row["CharacteristicName"] in CHEMISTRY}
    if context_ids != actual_context or len(activities) != 17:
        raise ValueError("Keep all original chemistry results from the exact 17 metal sampling activities.")
    selected = []
    checks = {"station_id": "MonitoringLocationIdentifier", "activity_id": "ActivityIdentifier",
              "project_id": "ProjectIdentifier", "sample_date": "ActivityStartDate",
              "characteristic": "CharacteristicName", "reported_value": "ResultMeasureValue",
              "reported_unit": "ResultMeasure/MeasureUnitCode", "detection_condition": "ResultDetectionConditionText",
              "detection_limit": "DetectionQuantitationLimitMeasure/MeasureValue",
              "detection_limit_unit": "DetectionQuantitationLimitMeasure/MeasureUnitCode",
              "sample_fraction": "ResultSampleFractionText", "analytical_method_id": "ResultAnalyticalMethod/MethodIdentifier",
              "analytical_method_context": "ResultAnalyticalMethod/MethodIdentifierContext"}
    normalized = {row["record_id"]: row for row in metal_records + context_records}
    for identity, (capture, index, row) in raw_by_identity.items():
        if identity not in selected_ids:
            continue
        retained = normalized[identity]
        if (retained["source_path"] != capture["source_path"]
                or retained["source_sha256"] != capture["sha256"]
                or int(retained["source_record_index"]) != index
                or any(retained[key] != row[value] for key, value in checks.items())):
            raise ValueError("A selected source row differs from its complete original response.")
        selected.append({**row, "TraceOriginalSourcePath": "trace/" + capture["source_path"],
                         "TraceOriginalSourceSHA256": capture["sha256"],
                         "TraceOriginalCSVRow": str(index + 1), "TraceOriginalRecordIndex": str(index),
                         "TraceOriginalQueryURL": capture["source_url"], "TraceRecordIdentity": identity,
                         "TraceCohort": "trace_metal" if identity in metal_ids else "same_activity_chemistry"})
    metal_rows = [row for row in selected if row["TraceCohort"] == "trace_metal"]
    below = [row for row in metal_rows if row["ResultDetectionConditionText"] == "Present Below Quantification Limit"]
    quantified = [row for row in metal_rows if row["ResultDetectionConditionText"] == ""]
    if len(below) != 115 or len(quantified) != 38 or any(
            row["ResultMeasureValue"] or row["ResultMeasure/MeasureUnitCode"]
            or not row["DetectionQuantitationLimitMeasure/MeasureValue"]
            or row["DetectionQuantitationLimitMeasure/MeasureUnitCode"] != "mg/L" for row in below):
        raise ValueError("Keep the 115 original blank measured values and their actual reporting limits.")
    if any(not row["ResultMeasureValue"] or not math.isfinite(float(row["ResultMeasureValue"]))
           or row["ResultMeasure/MeasureUnitCode"] != "mg/L" for row in quantified):
        raise ValueError("Keep the 38 original finite reported metal values.")
    site_ids = {row["MonitoringLocationIdentifier"] for row in selected}
    if len(site_ids) != 5:
        raise ValueError("The original trace cohort has five stations.")
    station_fields, station_rows = _csv(station_body)
    by_station = {row["MonitoringLocationIdentifier"]: (index, row)
                  for index, row in enumerate(station_rows, 2)}
    if len(by_station) != len(station_rows) or not site_ids <= set(by_station):
        raise ValueError("The original station response must resolve each selected station uniquely.")
    stations, points = [], []
    for station_id in sorted(site_ids):
        source_row, row = by_station[station_id]
        if row["HorizontalCoordinateReferenceSystemDatumName"] != "WGS84":
            raise ValueError("Retain the original five WGS84 station datums.")
        lat, lon = float(row["LatitudeMeasure"]), float(row["LongitudeMeasure"])
        if not math.isfinite(lat) or not math.isfinite(lon) or not -90 <= lat <= 90 or not -180 <= lon <= 180:
            raise ValueError("Retain valid original station coordinates.")
        site = re.sub(r"^21SC60WQ(?:_WQX)?-", "", station_id)
        stations.append({"site_id": site, "monitoring_location_id": station_id,
                         "description": row["MonitoringLocationName"], "latitude": row["LatitudeMeasure"],
                         "longitude": row["LongitudeMeasure"], "datum": "WGS84", "epsg": "4326",
                         "original_source_path": "original/stations-original.csv",
                         "original_source_sha256": STATION_SHA256, "original_source_csv_row": str(source_row)})
        points.append({"type": "Feature", "id": station_id, "properties": {**row, "site_id": site,
                       "original_source_csv_row": source_row},
                       "geometry": {"type": "Point", "coordinates": [lon, lat]}})
    dates = sorted({row["ActivityStartDate"] for row in selected})
    notes = [
        "153 trace-metal results and 51 calcium/magnesium/hardness results come from the same 17 original activities at five stations. Select the nine metal parameters for the metal-only 153-row review.",
        "Every original publisher cell is unchanged. The selected source view adds TraceOriginalSourcePath/SHA256/CSVRow/RecordIndex/QueryURL, TraceRecordIdentity and TraceCohort. Native source_csv_row addresses that view; TraceOriginalCSVRow addresses the unchanged complete agency CSV.",
        "The original WQP Result responses contain no ResultIdentifier. TraceRecordIdentity is the explicit original response SHA256 plus one-based original record index, never an invented agency identifier.",
        "Below-limit measured value/unit cells stay blank. Original limits and limit units are separate fields; quantified-only arithmetic means use no substitution.",
        "Parameter, station, source project, activity type, fraction, analytical method, result type, basis and support unit remain separate series. Chemistry keeps its original fraction and basis; hardness is not converted to a metal concentration.",
        "Original collection-method, depth and comment fields remain blank where the agency left them blank. This source supplies no toxicity threshold, compliance judgment or calibration.",
        "The retained trace explorer and its original nine figures show the full original 153-metal source scope; study filters and saved-review scientific sources describe their explicitly selected cohorts.",
    ]
    study = {"schema": "upstate.published-water-quality-study/v1", "study_id": BUILTIN_ID, "title": TITLE,
             "issuing_body": "South Carolina Department of Environmental Services",
             "publication": "Original 2023 observations; retained source edition 2026-10-13",
             "original_url": "https://www.waterqualitydata.us/", "observation_calendar_filters": True,
             "observation_sources": "observation-sources.json", "observation_selection_notes": notes,
             "observation_scope": "Original trace-metal results with explicitly associated same-activity chemistry.",
             "grab_sampling": {"start": dates[0], "end": dates[-1],
                               "frequency": "Original irregular sampling dates", "total_visits": 17},
             "content_counts": dict(COUNTS),
             "source_interpretation": {"original_trace_package_id": inventory["id"],
                 "original_trace_inventory_sha256": _sha(originals["inventory.json"]),
                 "original_input_sha256": INPUT_SHA256, "station_response_sha256": STATION_SHA256,
                 "native_observation_view": "selected/metals-and-chemistry.csv",
                 "source_row_identity": "Original complete response SHA256 and CSV record row (header counted)"}}
    files = {"trace/" + name: body for name, body in originals.items()}
    files["original/stations-original.csv"] = station_body
    files["selected/metals-and-chemistry.csv"] = _csv_bytes(fields + list(LINEAGE_FIELDS), selected)
    files["study.json"] = _json(study)
    files["stations.csv"] = _csv_bytes(list(stations[0]), stations)
    files["seasonal_summaries.csv"] = SEASONAL_HEADER.encode("utf-8")
    files["source_notes.json"] = _json([{"code": "TRACE_SOURCE_" + str(i + 1), "context": text}
                                       for i, text in enumerate(notes)])
    files["native/stations-wgs84.geojson"] = _json({"type": "FeatureCollection",
        "crs": {"type": "name", "properties": {"name": "EPSG:4326"}}, "features": points})
    view = files["selected/metals-and-chemistry.csv"]
    files["observation-sources.json"] = _json({"schema": "upstate.observation-sources/v1",
        "record_count": 204, "activity_count": 17,
        "sample_support": "Original 2023 trace-metal and same-activity chemistry sampling",
        "sources": [{**_descriptor("selected/metals-and-chemistry.csv", view), "format": "wqp-result-csv",
            "date_start": dates[0], "date_end": dates[-1], "record_count": 204,
            "station_ids": sorted(site_ids), "characteristics": sorted(METALS + CHEMISTRY),
            "source_url": "urn:upstate:trace-metals:selected-original-records:" + inventory["id"],
            "derivation": "Exact selected original WQP cells with explicit complete-response original-record lineage."}]})
    files["source-summary.json"] = _json({"schema": "upstate.trace-metal-published-summary/v1",
        **COUNTS, "first_date": dates[0], "last_date": dates[-1], "sampling_dates": len(dates),
        "original_trace_package_id": inventory["id"], "original_station_source_sha256": STATION_SHA256,
        "selected_source_columns": fields + list(LINEAGE_FIELDS)})
    files["README.md"] = (
        "# Original trace-metal study\n\nOpen Published studies and import the installed " + BUILTIN_ID +
        " source. Select station, parameter, year and month; inspect original measured/limit cells, "
        "method series and original source selectors. Save the exact review, prepare its scientific "
        "source, open it in Scientific Reports, export the selected editable Study and reopen it.\n\n"
        "The study has 153 metal results and 51 same-activity chemistry results. "
        "All nine full original response CSVs, the complete 38-member trace explorer/report source "
        "and the original WQP station response remain together. Original figures and trace/report.html "
        "retain their full 153-result scope. Study filters govern the native selected tables and "
        "saved-review report source. Coordinates use the original five WGS84 records.\n\n" +
        "\n\n".join(notes) + "\n").encode("utf-8")
    common = [_descriptor(name, body) for name, body in sorted(files.items())]
    entries = []
    original_manifest = json.loads(originals["sources.json"])
    for original in original_manifest["entries"]:
        entry = dict(original)
        entry["path"] = "trace/" + _path(original["path"])
        entry["companions"] = [item for item in common if item["path"] != entry["path"]]
        entries.append(entry)
    additions = [
        ("trace-metal-original-explorer", "Original trace-metal interactive explorer — full 153-result source",
         "document", "trace/report.html", "https://www.waterqualitydata.us/"),
        ("trace-metal-selected-native-view", "Selected original metal and same-activity chemistry cells",
         "table", "selected/metals-and-chemistry.csv", "https://www.waterqualitydata.us/"),
        ("trace-metal-original-stations-wgs84", "Original trace-study station coordinates — WGS84",
         "vector", "native/stations-wgs84.geojson", STATION_URL),
    ]
    for identifier, title, kind, name, uri in additions:
        entry = {"id": identifier, "title": title, "kind": kind, "uri": uri,
                 "vintage": study["publication"], **_descriptor(name, files[name]),
                 "companions": [item for item in common if item["path"] != name]}
        if kind == "vector":
            entry.update(source_crs="EPSG:4326", station_id_field="MonitoringLocationIdentifier",
                         native_id_field="MonitoringLocationIdentifier")
        entries.append(entry)
    files["model-sources.json"] = _json({"schema": "upstate.sources/v1", "title": TITLE, "entries": entries})
    files["study-files.json"] = _json({"schema": "upstate.study-file-inventory/v1",
        "files": [_descriptor(name, body) for name, body in sorted(files.items())]})
    return files


def builtin_companion(application=None):
    files = build_files(application)
    return _json({"schema": "upstate.published-study-files/v1", "files": [
        {**_descriptor(name, body), "encoding": "utf-8", "content": body.decode("utf-8")}
        for name, body in sorted(files.items())]}), {}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--application", type=Path)
    parser.add_argument("--output", type=Path, required=True, help="Complete immutable study source directory")
    args = parser.parse_args(argv)
    files = build_files(args.application)
    output = args.output.expanduser().resolve()
    output.mkdir(parents=True, exist_ok=True)
    for name, body in sorted(files.items()):
        path = output / name
        path.parent.mkdir(parents=True, exist_ok=True)
        if path.exists() and path.read_bytes() != body:
            raise ValueError("Choose a new edition directory; a retained source differs: " + name)
        path.write_bytes(body)
    print(json.dumps({"study_id": BUILTIN_ID, "directory": str(output),
                      "files": len(files), "counts": COUNTS}, indent=2))


if __name__ == "__main__":
    main()
