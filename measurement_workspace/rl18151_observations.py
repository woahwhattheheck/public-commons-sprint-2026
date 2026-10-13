"""Retain the original RL-18151 study as a native Published studies cohort."""
from __future__ import annotations

import argparse
import csv
import hashlib
import io
import json
import math
from pathlib import Path, PurePosixPath

if __package__:
    from . import study_context
else:
    import study_context

BUILTIN_ID = study_context.RL18151_STUDY
TITLE = "Lake Keowee — RL-18151 original observations, 2018–2026"
SOURCE_DIRECTORY = "source/rl18151-lake-phosphorus-20261013"
MANIFEST = SOURCE_DIRECTORY + "/sources.json"
ROOT = study_context.RL18151_ROOT
STATION = "21SC60WQ_WQX-RL-18151"
PROFILES = {
    "physical": (296, 40, 245, (
        "Alkalinity, total", "Biochemical oxygen demand, standard conditions",
        "Conductivity", "Depth", "Dissolved oxygen (DO)", "Hardness, Ca, Mg",
        "Temperature, water", "Turbidity", "pH")),
    "nutrient": (159, 38, 159, (
        "Ammonia", "Inorganic nitrogen (nitrate and nitrite) ***retired***use Nitrate + Nitrite",
        "Kjeldahl nitrogen", "Nitrate + Nitrite", "Nitrogen", "Phosphorus")),
    "microbiological": (43, 40, 43, ("Escherichia coli",)),
}
SEASONAL_HEADER = ("site_id,stratum,depth_min_m,depth_max_m,parameter,units,"
                   "mean,sd,minimum,maximum,n,source_table,source_pdf_page,statistic_basis\n")


def _json(value):
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2, allow_nan=False) + "\n").encode("utf-8")


def _sha(raw):
    return hashlib.sha256(raw).hexdigest()


def _path(value):
    if not isinstance(value, str) or not value or "\\" in value or "\0" in value:
        raise ValueError("Original RL-18151 files require canonical relative paths.")
    path = PurePosixPath(value)
    if path.is_absolute() or str(path) != value or ".." in path.parts or value == ".":
        raise ValueError("An original RL-18151 file must remain in its source family.")
    return value


def _csv(raw):
    reader = csv.DictReader(io.StringIO(raw.decode("utf-8-sig"), newline=""))
    fields = reader.fieldnames or []
    if not fields or len(fields) != len(set(fields)):
        raise ValueError("Original RL-18151 CSV columns must remain complete and distinct.")
    rows = list(reader)
    if any(None in row or any(value is None for value in row.values()) for row in rows):
        raise ValueError("An original RL-18151 CSV contains an incomplete record.")
    return fields, rows


def _csv_bytes(fields, rows):
    output = io.StringIO(newline="")
    writer = csv.DictWriter(output, fieldnames=fields, lineterminator="\n")
    writer.writeheader()
    writer.writerows(rows)
    return output.getvalue().encode("utf-8")


def source_files(application=None):
    application = Path(application) if application is not None else Path(__file__).resolve().parents[1]
    files = study_context.source_files(application, application / MANIFEST)
    inventory_name = SOURCE_DIRECTORY + "/study-files.json"
    inventory_path = (application / inventory_name).resolve(strict=True)
    if not inventory_path.is_relative_to(application.resolve(strict=True)) or not inventory_path.is_file():
        raise ValueError("The scientific source inventory must remain in the installed application.")
    raw = inventory_path.read_bytes()
    inventory = json.loads(raw.decode("utf-8-sig"))
    if inventory.get("schema") != "upstate.source-members/v1":
        raise ValueError("Choose the complete original RL-18151 scientific source inventory.")
    seen = set()
    for member in inventory.get("members", []):
        name = SOURCE_DIRECTORY + "/" + _path(member["path"])
        if name in seen or name == inventory_name:
            raise ValueError("Original RL-18151 inventory paths must be unique and nonrecursive.")
        seen.add(name)
        body = files.get(name)
        if body is None or len(body) != member.get("bytes") or _sha(body) != member.get("sha256"):
            raise ValueError("Original scientific source closure differs at " + name)
    if seen != set(files):
        raise ValueError("The native manifest and original scientific inventory must retain the same source closure.")
    files[inventory_name] = raw
    return files


def catalog_entry(application=None):
    application = Path(application) if application is not None else Path(__file__).resolve().parents[1]
    if not (application / MANIFEST).is_file():
        return None
    return {"id": BUILTIN_ID, "title": TITLE,
            "publication": "Original 2018–2026 observations; source edition 2026-10-13",
            "counts": {"stations": 1, "original_result_rows": 498, "original_activity_count": 40}}


def build_files(application=None):
    originals = source_files(application)
    capture = json.loads(originals[SOURCE_DIRECTORY + "/capture-manifest.json"])
    if (capture.get("station_id") != STATION or capture.get("complete") is not True
            or capture.get("pending")):
        raise ValueError("Choose the completed original RL-18151 capture.")
    captures = {item["path"]: item for item in capture["originals"]}
    if len(captures) != len(capture["originals"]) or len(captures) != 16:
        raise ValueError("Retain all sixteen distinct original agency responses.")
    for name, item in captures.items():
        raw = originals[SOURCE_DIRECTORY + "/" + _path(name)]
        if item["bytes"] != len(raw) or item["sha256"] != _sha(raw):
            raise ValueError("An original agency response differs from its capture: " + name)

    entries, all_rows = [], []
    for group, (count, activity_count, limit_count, characteristics) in PROFILES.items():
        name = "original/" + group + "-narrow-results.csv"
        item = captures[name]
        fields, rows = _csv(originals[SOURCE_DIRECTORY + "/" + name])
        if (len(fields) != 78 or len(rows) != count
                or {row["MonitoringLocationIdentifier"] for row in rows} != {STATION}
                or {row["CharacteristicName"] for row in rows} != set(characteristics)):
            raise ValueError("Retain the exact RL-18151 NarrowResult profile and characteristic scope.")
        metadata = []
        for suffix, role, expected in (
                ("activities", "wqp-activity-csv", activity_count),
                ("detection_limits", "wqp-result-limit-csv", limit_count)):
            metadata_name = "original/" + group + "-" + suffix + ".csv"
            original = captures[metadata_name]
            unused, records = _csv(originals[SOURCE_DIRECTORY + "/" + metadata_name])
            if len(records) != expected:
                raise ValueError("Original RL-18151 metadata coverage changed.")
            metadata.append({"role": role, "path": ROOT + "/" + SOURCE_DIRECTORY + "/" + metadata_name,
                             "bytes": original["bytes"], "sha256": original["sha256"],
                             "record_count": expected, "source_url": original["uri"]})
        entries.append({
            "path": ROOT + "/" + SOURCE_DIRECTORY + "/" + name,
            "format": "wqp-narrow-result-csv", "source_url": item["uri"],
            "bytes": item["bytes"], "sha256": item["sha256"],
            "date_start": capture["selected_start"], "date_end": capture["selected_end"],
            "station_ids": [STATION], "characteristics": list(characteristics),
            "record_count": count, "metadata_sources": metadata,
        })
        all_rows.extend(rows)
    if (len(all_rows) != 498 or len({row["ResultIdentifier"] for row in all_rows}) != 498
            or len({row["ActivityIdentifier"] for row in all_rows}) != 40):
        raise ValueError("Retain the original 498 result identifiers and 40 activities.")
    conditions = {condition: sum(row["ResultDetectionConditionText"] == condition for row in all_rows)
                  for condition in {row["ResultDetectionConditionText"] for row in all_rows}}
    if conditions != {"": 327, "Present Below Quantification Limit": 171}:
        raise ValueError("Original RL-18151 qualification counts changed.")

    station_capture = captures["original/station.csv"]
    unused, stations = _csv(originals[SOURCE_DIRECTORY + "/original/station.csv"])
    matches = [(index, row) for index, row in enumerate(stations, 2)
               if row["MonitoringLocationIdentifier"] == STATION]
    if len(matches) != 1:
        raise ValueError("The original station response must identify RL-18151 once.")
    station_number, station = matches[0]
    latitude, longitude = float(station["LatitudeMeasure"]), float(station["LongitudeMeasure"])
    if (station["HorizontalCoordinateReferenceSystemDatumName"] != "WGS84"
            or not math.isfinite(latitude) or not math.isfinite(longitude)
            or not -90 <= latitude <= 90 or not -180 <= longitude <= 180):
        raise ValueError("Retain the original finite WGS84 station coordinates.")
    station_row = {
        "site_id": "RL-18151", "monitoring_location_id": STATION,
        "description": station["MonitoringLocationDescriptionText"],
        "latitude": station["LatitudeMeasure"], "longitude": station["LongitudeMeasure"],
        "datum": "WGS84", "epsg": 4326, "publisher_huc8": station["HUCEightDigitCode"],
        "original_source_path": ROOT + "/" + SOURCE_DIRECTORY + "/original/station.csv",
        "original_source_sha256": station_capture["sha256"], "original_source_csv_row": station_number,
    }
    dates = sorted({row["ActivityStartDate"] for row in all_rows})
    notes = [
        "The desk retains all 498 original NarrowResult identifiers across disjoint physical, nutrient and microbiological characteristic profiles.",
        "Exact ActivityIdentifier joins retain each profile's original activity source. Exact ResultIdentifier joins retain all 447 original reporting-limit rows; 51 unqualified physical records have no reporting-limit row.",
        "Original MethodSpecificationName remains a comparable-series dimension: phosphorus is as P, ammonia as NH3, nitrogen species as N and total alkalinity as CaCO3. Original blank specifications remain blank.",
        "All 171 below-limit results retain their original reported value and unit exactly as returned, including blank fields, alongside the detection condition and original reporting limit/unit. Numeric tokens on qualified records remain qualified; no replacement concentration is assigned.",
        "The source query covers 2018-01-01 through 2026-10-13. Returned sampling dates occur in 2018 and 2024–2026, ending 2026-06-11. The absence of returned 2019–2023 observations remains an explicit coverage gap.",
        "All repeated or multiple results retain their original ResultIdentifiers. The existing source-owned scientific report explains analytical cohorts, interval bounds and annual coverage independently.",
        "The three default Result profiles remain unchanged reconciliation companions. Only the three NarrowResult profiles form this native observation cohort.",
    ]
    study = {
        "schema": "upstate.published-water-quality-study/v1", "study_id": BUILTIN_ID,
        "title": TITLE, "issuing_body": "South Carolina Department of Environmental Services / Water Quality Portal",
        "publication": "Original 2018–2026 observations; source edition 2026-10-13",
        "original_url": entries[0]["source_url"], "observation_calendar_filters": True,
        "observation_sources": "observation-sources.json", "observation_selection_notes": notes,
        "observation_scope": "Original physical, nutrient and microbiological results at Lake Keowee station RL-18151.",
        "grab_sampling": {"start": dates[0], "end": dates[-1],
                          "frequency": "Original irregular sampling dates", "total_visits": 40},
        "content_counts": {"stations": 1, "original_result_rows": 498, "original_activity_count": 40,
                           "quantified": 327, "below_limit": 171, "above_limit": 0},
        "source_interpretation": {
            "source_manifest_sha256": _sha(originals[MANIFEST]),
            "coordinates": "Original station CSV WGS84 numeric coordinates; EPSG:4326.",
            "result_identity": "498 distinct original ResultIdentifiers, including repeated activity-values.",
            "metadata_join": "Exact original ActivityIdentifier and ResultIdentifier joins with identity-field agreement.",
        },
    }
    files = {ROOT + "/" + name: body for name, body in originals.items()}
    files.update({
        "study.json": _json(study), "stations.csv": _csv_bytes(list(station_row), [station_row]),
        "seasonal_summaries.csv": SEASONAL_HEADER.encode("utf-8"),
        "source_notes.json": _json([{"code": "ORIGINAL_PROFILE_JOIN", "context": note} for note in notes]),
        "observation-sources.json": _json({
            "schema": "upstate.observation-sources/v1", "record_count": 498, "activity_count": 40,
            "sources": entries, "sample_support": "Original RL-18151 result records and exact source identifiers",
        }),
    })
    native = json.loads(originals[MANIFEST])
    recipe = next(entry for entry in native["entries"] if entry.get("role") == "OBSERVED_CONTEXT")
    reports = [("report.html", "rl18151-original-lake-report-html",
                "RL-18151 original lake observations — offline inspector")]
    if SOURCE_DIRECTORY + "/sampling-review.html" in originals:
        reports.append(("sampling-review.html", "rl18151-original-sampling-support-html",
                        "RL-18151 sampling support — original results and activities"))
    report_entries = []
    for filename, source_id, title in reports:
        report_name = ROOT + "/" + SOURCE_DIRECTORY + "/" + filename
        report = files[report_name]
        report_entries.append({
            "id": source_id, "title": title,
            "kind": "document", "role": "ORIGINAL_STUDY_REPORT", "path": report_name,
            "uri": recipe["uri"], "vintage": recipe["vintage"],
            "bytes": len(report), "sha256": _sha(report),
            "companions": [{"path": ROOT + "/" + name, "bytes": len(body), "sha256": _sha(body)}
                           for name, body in sorted(originals.items()) if ROOT + "/" + name != report_name],
            "metadata": {"media_type": "text/html", "original_report_recipe_id": recipe["id"],
                         "source_manifest": ROOT + "/" + MANIFEST,
                         "source_manifest_sha256": _sha(originals[MANIFEST])},
        })
    files["model-sources.json"] = _json({
        "schema": "upstate.sources/v1", "title": TITLE, "entries": report_entries,
    })
    files["README.md"] = (
        "# RL-18151 original observations\n\n"
        "Import the installed scdes-rl18151-water-quality-2018-2026 cohort in Published studies. "
        "Choose a characteristic and calendar period, inspect original result/activity/limit rows, "
        "and open the retained original scientific report. Export the selected report or complete "
        "study; portable Workspace receiving retains the same original sources and source selectors.\n\n"
        + "\n\n".join(notes) + "\n"
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
            raise ValueError("Choose a new output directory; original source bytes differ: " + name)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(raw)
    print(json.dumps({"study_id": BUILTIN_ID, "directory": str(output), "files": len(files),
                      "original_result_rows": 498, "original_activity_count": 40}))


if __name__ == "__main__":
    main()
