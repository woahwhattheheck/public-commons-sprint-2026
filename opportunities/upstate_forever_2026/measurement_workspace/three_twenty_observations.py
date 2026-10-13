"""Bind the complete Three/Twenty source edition to native Published Studies."""
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
    from .source_observations import load_observations, statistical_rows, AGREEING_ACTIVITY_BASIS
else:
    import study_context
    from source_observations import load_observations, statistical_rows, AGREEING_ACTIVITY_BASIS

BUILTIN_ID = "scdes-three-twenty-water-quality-2026"
TITLE = "Three and Twenty Creek — original 2026 observations at four stations"
MANIFEST = "three_twenty_2026.sources.json"
DIRECTORY = "observations/three_twenty_2026"
NATIVE_DIRECTORY = DIRECTORY + "/native-study"
ROOT = "application-context/three-twenty-2026"
SEASONAL_HEADER = ("site_id,stratum,depth_min_m,depth_max_m,parameter,units,"
                   "mean,sd,minimum,maximum,n,source_table,source_pdf_page,statistic_basis\n")


def _json(value):
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2, allow_nan=False) + "\n").encode("utf-8")


def _sha(raw):
    return hashlib.sha256(raw).hexdigest()


def _csv(raw):
    reader = csv.DictReader(io.StringIO(raw.decode("utf-8-sig"), newline=""))
    fields = reader.fieldnames or []
    rows = list(reader)
    if (not fields or len(fields) != len(set(fields))
            or any(None in row or any(value is None for value in row.values()) for row in rows)):
        raise ValueError("Retain complete original agency CSV fields and records.")
    return rows


def _csv_bytes(fields, rows):
    out = io.StringIO(newline="")
    writer = csv.DictWriter(out, fieldnames=fields, lineterminator="\n")
    writer.writeheader()
    writer.writerows(rows)
    return out.getvalue().encode("utf-8")


def source_files(application=None):
    app = Path(application) if application is not None else Path(__file__).resolve().parents[1]
    return study_context.source_files(app, app / MANIFEST)


def catalog_entry(application=None):
    app = Path(application) if application is not None else Path(__file__).resolve().parents[1]
    if not (app / MANIFEST).is_file():
        return None
    return {"id": BUILTIN_ID, "title": TITLE,
            "publication": "Original 2026 sampling; retained source edition 2026-10-13",
            "counts": {"stations": 4, "original_result_rows": 242,
                       "original_activity_count": 15, "activity_measurements": 142}}


def build_files(application=None):
    originals = source_files(application)
    summary = json.loads(originals[DIRECTORY + "/study-summary.json"])
    if summary.get("schema") != "three-twenty.original-multistation-study/v1":
        raise ValueError("Choose the original four-station Three/Twenty source edition.")
    expected = {"original_results": 242, "distinct_result_ids": 242, "activities": 15,
                "dates": 14, "stations": 4, "measurements": 142,
                "duplicate_groups": 100, "additional_equal_results": 100}
    if any(summary.get("counts", {}).get(key) != count for key, count in expected.items()):
        raise ValueError("The original four-station study census changed.")
    prefix = NATIVE_DIRECTORY + "/"
    files = {name[len(prefix):]: raw for name, raw in originals.items() if name.startswith(prefix)}
    if len(files) != 20 or not {"observation-sources.json", "result-selection.json"}.issubset(files):
        raise ValueError("Retain all eighteen original native source bodies and both original contracts.")
    index = json.loads(files["observation-sources.json"])
    selected = json.loads(files["result-selection.json"])
    if (index.get("record_count") != 766 or index.get("activity_count") != 65
            or selected.get("record_count") != 242 or selected.get("activity_count") != 15
            or selected.get("date_start") != "2026-01-07" or selected.get("date_end") != "2026-07-08"):
        raise ValueError("The native selection differs from its original source census and calendar.")
    station_rows = []
    for station in summary["stations"]:
        original_path = station["source_path"]
        raw = originals[original_path]
        if _sha(raw) != station["source_sha256"]:
            raise ValueError("The original station source changed.")
        matches = [(number, row) for number, row in enumerate(_csv(raw), 2)
                   if row["MonitoringLocationIdentifier"] == station["identifier"]]
        if len(matches) != 1:
            raise ValueError("Each original study station must resolve exactly once.")
        number, row = matches[0]
        latitude, longitude = float(row["LatitudeMeasure"]), float(row["LongitudeMeasure"])
        if (row["HorizontalCoordinateReferenceSystemDatumName"] != "WGS84"
                or not math.isfinite(latitude) or not math.isfinite(longitude)
                or not -90 <= latitude <= 90 or not -180 <= longitude <= 180
                or latitude != station["latitude"] or longitude != station["longitude"]):
            raise ValueError("Retain the original unchanged WGS84 station coordinates.")
        station_rows.append({
            "site_id": station["station"], "monitoring_location_id": station["identifier"],
            "description": row["MonitoringLocationDescriptionText"],
            "latitude": row["LatitudeMeasure"], "longitude": row["LongitudeMeasure"],
            "datum": "WGS84", "epsg": 4326,
            "original_source_path": ROOT + "/" + original_path,
            "original_source_sha256": station["source_sha256"], "original_source_csv_row": number,
        })
    if len(station_rows) != 4 or len({row["site_id"] for row in station_rows}) != 4:
        raise ValueError("Retain all four distinct original stations.")
    notes = [
        "The complete original source index retains 766 ResultIdentifiers and 65 station/project/activities. Its hash-bound 2026 selection retains 242 original ResultIdentifiers across 15 activities and 14 dates.",
        "The Original rows view and original-cell exports retain all 242 results. Exactly agreeing repeated activity/characteristic values receive one statistical weight: 142 measurements, with 100 extra original ResultIdentifiers retained in their source groups.",
        "Every original raw field except ResultIdentifier and ResultDetectionQuantitationLimitUrl must agree within a statistical group. Original value/unit, reporting-limit, censor, method, depth, calendar and activity support also agree; a conflicting repeated value requires a separate analytical cohort.",
        "The native desk and supported concentration summaries use the same declared activity weighting. The source-owned scientific report retains its 142-measurement analysis, 100 duplicate groups, ten method-compatible January14 contrasts and original 38-minute sampling gap.",
        "Qualified results retain blank original values and units, exact detection conditions and original reporting limits. No replacement concentration is assigned.",
        "Station coordinates are the unchanged WGS84 publisher coordinates from each exact original station CSV. These irregular sampling observations do not provide an annual time-weighted concentration, load or intervention effect.",
    ]
    study = {
        "schema": "upstate.published-water-quality-study/v1",
        "study_id": BUILTIN_ID, "title": TITLE,
        "issuing_body": "South Carolina Department of Environmental Services / Water Quality Portal",
        "publication": "Original 2026 sampling; retained source edition 2026-10-13",
        "original_url": index["sources"][0].get("source_url", ""),
        "observation_calendar_filters": True, "observation_sources": "observation-sources.json",
        "observation_statistic_basis": AGREEING_ACTIVITY_BASIS,
        "observation_selection_notes": notes,
        "observation_scope": "Original physical, nutrient and microbiological results at four Three and Twenty Creek stations.",
        "grab_sampling": {"start": selected["date_start"], "end": selected["date_end"],
                          "frequency": "Original irregular sampling dates", "total_visits": 15},
        "content_counts": {"stations": 4, "original_result_rows": 242,
                           "original_activity_count": 15, "activity_measurements": 142,
                           "retained_result_rows": 766, "retained_activity_count": 65},
        "source_interpretation": {"source_manifest_sha256": _sha(originals[MANIFEST]),
            "original_selection_sha256": _sha(files["result-selection.json"]),
            "coordinates": "Unchanged original WGS84 station rows; EPSG:4326.",
            "statistics": "One weight per agreeing original activity and characteristic; all result IDs retained."},
    }
    if __package__:
        from .published_studies import _observation_rows
    else:
        from published_studies import _observation_rows
    observations = load_observations(files, _observation_rows)
    measurements = statistical_rows(observations, study)
    if (len(observations) != 242 or len(measurements) != 142
            or sum(row["measurement_original_result_count"] - 1 for row in measurements) != 100
            or {row["site_id"] for row in observations} != {row["site_id"] for row in station_rows}):
        raise ValueError("Native original observations differ from the retained scientific cohort.")
    files.update({ROOT + "/" + name: raw for name, raw in originals.items()})
    files.update({
        "study.json": _json(study),
        "stations.csv": _csv_bytes(list(station_rows[0]), station_rows),
        "seasonal_summaries.csv": SEASONAL_HEADER.encode("utf-8"),
        "source_notes.json": _json([{"code": "ORIGINAL_RESULT_SELECTION", "context": note} for note in notes]),
        "README.md": (
            "# Three and Twenty Creek — native original 2026 observations\n\n"
            "Use Published studies to import the installed four-station cohort, inspect original IDs "
            "and activity-weighted statistics, save a review, prepare its Scientific Reports source, "
            "and export/reopen the selected Study and full Workspace. The retained original report "
            "keeps all scientific computations and original source references.\n\n"
            + "\n\n".join(notes) + "\n"
        ).encode("utf-8"),
    })
    native = json.loads(originals[MANIFEST])
    original_report = next(entry for entry in native["entries"] if entry["id"] == "three-twenty-2026-report")
    report_name = ROOT + "/" + original_report["path"]
    report = files[report_name]
    files["model-sources.json"] = _json({"schema": "upstate.sources/v1", "title": TITLE, "entries": [{
        "id": "three-twenty-2026-published-study-report", "title": TITLE + " — source-owned analysis",
        "kind": "document", "role": "ORIGINAL_STUDY_REPORT", "path": report_name,
        "uri": original_report["uri"], "vintage": original_report["vintage"],
        "bytes": len(report), "sha256": _sha(report),
        "companions": [{"path": name, "bytes": len(raw), "sha256": _sha(raw)}
                       for name, raw in sorted(files.items()) if name != report_name],
        "metadata": {"media_type": "text/html", "original_report_source_id": original_report["id"],
                     "original_result_count": 242, "activity_measurement_count": 142,
                     "source_manifest": ROOT + "/" + MANIFEST,
                     "source_manifest_sha256": _sha(originals[MANIFEST])},
    }]})
    return files


def builtin_companion(application=None):
    files = build_files(application)
    return _json({"schema": "upstate.published-study-files/v1", "files": [
        {"path": path, "bytes": len(raw), "sha256": _sha(raw),
         "encoding": "utf-8", "content": raw.decode("utf-8")}
        for path, raw in sorted(files.items())]}), {}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--application", type=Path)
    parser.add_argument("--output", type=Path, required=True, help="Complete native source JSON destination")
    args = parser.parse_args(argv)
    body, _ = builtin_companion(args.application)
    output = args.output.expanduser().resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    if output.exists() and output.read_bytes() != body:
        raise ValueError("Choose a new destination; the existing retained source edition differs.")
    if not output.exists():
        output.write_bytes(body)
    print(json.dumps({"study_id": BUILTIN_ID, "path": str(output), "bytes": len(body),
                      "sha256": _sha(body), "original_results": 242, "activity_measurements": 142}))


if __name__ == "__main__":
    main()
