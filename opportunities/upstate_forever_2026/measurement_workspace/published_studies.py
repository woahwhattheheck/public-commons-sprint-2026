"""Published field-study context for the maintained measurement workspace.

Original tables remain source documents. This store gives those documents a
typed, filterable view with durable Workspace source selectors and export.
"""
from __future__ import annotations

import argparse
import base64
import csv
import hashlib
import gzip
import html
import io
import json
import math
import mimetypes
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import sys
import tempfile
from typing import Any
import zipfile

if __package__:
    from . import study_context as application_context
    from .observation_support import enrich_observation_context, report_html as support_report_html
    from .source_observations import INDEX as OBSERVATION_INDEX, load_observations, observation_files, filter_calendar, series_metadata, builtin_companion
else:
    import study_context as application_context
    from observation_support import enrich_observation_context, report_html as support_report_html
    from source_observations import INDEX as OBSERVATION_INDEX, load_observations, observation_files, filter_calendar, series_metadata, builtin_companion

STORE_SCHEMA = "upstate.published-study-record/v1"
EXPORT_SCHEMA = "upstate.published-study-export/v1"
COMPANION_SCHEMA = "upstate.published-study-files/v1"
STUDY_SCHEMA = "upstate.published-water-quality-study/v1"

TABLE_FILES = {
    "stations": "stations.csv",
    "seasonal": "seasonal_summaries.csv",
    "surface_ranges": "surface_ranges.csv",
    "monthly_do": "continuous_monthly_do.csv",
    "monthly_ph": "continuous_monthly_ph.csv",
    "permits": "reported_npdes_permits.csv",
}
TABLE_TITLES = {
    "stations": "Monitoring stations",
    "seasonal": "Seasonal concentration summaries",
    "surface_ranges": "Surface field ranges",
    "monthly_do": "Monthly dissolved oxygen",
    "monthly_ph": "Monthly pH",
    "permits": "Reported upstream permits",
}
REQUIRED_COLUMNS = {
    "stations": {"site_id", "latitude", "longitude", "datum", "epsg"},
    "seasonal": {
        "site_id", "stratum", "depth_min_m", "depth_max_m", "parameter",
        "units", "mean", "sd", "minimum", "maximum", "n",
        "source_table", "source_pdf_page", "statistic_basis",
    },
    "surface_ranges": {"site_id", "depth_m", "period_start", "period_end"},
    "monthly_do": {
        "site_id", "year", "month", "parameter", "units",
        "avg_daily_minimum", "avg_daily_maximum", "published_avg_daily_range",
        "n_days", "source_table", "source_pdf_page",
    },
    "monthly_ph": {
        "site_id", "year", "month", "parameter", "units",
        "avg_daily_minimum", "avg_daily_maximum", "published_avg_daily_range",
        "n_days", "source_table", "source_pdf_page",
    },
    "permits": {"npdes_permit_id", "report_facility_name", "source_pdf_page"},
}
NUMERIC_FIELDS = {
    "report_latitude", "report_longitude", "latitude", "longitude",
    "epsg", "report_pdf_page", "report_table", "depth_min_m", "depth_max_m",
    "depth_m", "mean", "sd", "minimum", "maximum", "n",
    "minimum_detection_limit", "source_table", "source_pdf_page",
    "ph_min_su", "ph_max_su", "do_min_mg_l", "do_max_mg_l",
    "temperature_min_c", "temperature_max_c",
    "specific_conductivity_min_us_cm", "specific_conductivity_max_us_cm",
    "turbidity_min_fnu", "turbidity_max_fnu", "general_event_count",
    "year", "month", "avg_daily_minimum", "avg_daily_maximum",
    "published_avg_daily_range", "n_days", "days_with_max_above_8_5",
}
INTEGER_FIELDS = {
    "epsg", "report_pdf_page", "report_table", "n", "source_table",
    "source_pdf_page", "general_event_count", "year", "month", "n_days",
    "days_with_max_above_8_5",
}
UNIT_DEFINITIONS = {
    "mg/L": "Milligrams per litre; concentration",
    "ug/L": "Micrograms per litre; concentration",
    "SU": "Standard pH units",
    "FNU": "Formazin nephelometric units",
    "degC": "Degrees Celsius",
    "uS/cm": "Microsiemens per centimetre",
    "MPN/100mL": "Most probable number per 100 millilitres; original source spelling",
    "MPN/100 ml": "Most probable number per 100 millilitres; original source spelling",
}
SURFACE_PARAMETERS = {
    "ph": ("ph_min_su", "ph_max_su", "SU"),
    "dissolved_oxygen": ("do_min_mg_l", "do_max_mg_l", "mg/L"),
    "water_temperature": ("temperature_min_c", "temperature_max_c", "degC"),
    "specific_conductivity": (
        "specific_conductivity_min_us_cm", "specific_conductivity_max_us_cm", "uS/cm"
    ),
    "turbidity": ("turbidity_min_fnu", "turbidity_max_fnu", "FNU"),
}
MAX_SOURCE_BYTES = 64 * 1024 * 1024
MAX_SOURCE_FILES = 256


def _hash(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _json_bytes(value: Any) -> bytes:
    return (json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) + "\n").encode("utf-8")


def _json(data: bytes) -> Any:
    return json.loads(data.decode("utf-8-sig"))


def _name(name: str) -> str:
    path = PurePosixPath(name)
    if not name or "\\" in name or "\x00" in name or path.is_absolute() or ".." in path.parts:
        raise ValueError("A source filename must be a safe relative POSIX path.")
    if str(path) != name or name == "." or any(part in ("", ".") for part in path.parts):
        raise ValueError("An empty source path component is invalid.")
    return str(path)


def _safe_id(value: str) -> str:
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,119}", value):
        raise ValueError("Study identifiers must contain letters, numbers, dot, underscore or hyphen.")
    return value


def _atomic(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(prefix="." + path.name + "-", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(tmp, path)
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)


def _csv_rows(data: bytes, table: str) -> list[dict[str, Any]]:
    reader = csv.DictReader(io.StringIO(data.decode("utf-8-sig"), newline=""))
    headers = reader.fieldnames or []
    if len(headers) != len(set(headers)):
        raise ValueError(f"Duplicate CSV columns in {TABLE_FILES[table]}.")
    missing = REQUIRED_COLUMNS[table] - set(headers)
    if missing:
        raise ValueError(f"{TABLE_FILES[table]} is missing columns: {', '.join(sorted(missing))}")
    rows = []
    for source_row, raw in enumerate(reader, start=2):
        if None in raw or any(value is None for value in raw.values()):
            raise ValueError(f"Malformed CSV row {source_row} in {TABLE_FILES[table]}.")
        if all(value == "" for value in raw.values()):
            continue
        row: dict[str, Any] = dict(raw)
        for field in NUMERIC_FIELDS & raw.keys():
            value = raw[field].strip()
            if value == "":
                row[field] = None
                continue
            try:
                number = float(value)
            except ValueError as error:
                raise ValueError(f"Invalid {field} in {TABLE_FILES[table]} row {source_row}.") from error
            if not math.isfinite(number):
                raise ValueError(f"Non-finite {field} in {TABLE_FILES[table]} row {source_row}.")
            if field in INTEGER_FIELDS:
                if number != int(number):
                    raise ValueError(f"{field} must be an integer in row {source_row}.")
                number = int(number)
            row[field] = number
        row["source_csv_row"] = source_row
        row["source_file"] = TABLE_FILES[table]
        row["raw_cells"] = raw
        row["record_id"] = "published-row-" + _hash(
            _json_bytes({"table": table, "source_row": source_row, "cells": raw})
        )[:24]
        rows.append(row)
    return rows


def _normalize_bundle(files: dict[str, bytes]) -> dict[str, bytes]:
    if not files or len(files) > MAX_SOURCE_FILES:
        raise ValueError("The study must contain 1 to 256 source files.")
    if sum(len(value) for value in files.values()) > MAX_SOURCE_BYTES:
        raise ValueError("The study source exceeds the 64 MiB intake limit.")
    files = {_name(name): value for name, value in files.items()}
    studies = [name for name in files if PurePosixPath(name).name == "study.json"]
    if len(studies) != 1:
        raise ValueError("A companion must contain exactly one study.json.")
    prefix = str(PurePosixPath(studies[0]).parent)
    if prefix == ".":
        normalized = files
    else:
        prefix += "/"
        if any(not name.startswith(prefix) for name in files):
            raise ValueError("Every source file must belong to the same study directory.")
        normalized = {name[len(prefix):]: value for name, value in files.items()}
    for filename in ("study.json", "stations.csv", "seasonal_summaries.csv", "source_notes.json"):
        if filename not in normalized:
            raise ValueError(f"The published-study companion is missing {filename}.")
    return normalized


def _companion_document(data: bytes):
    if len(data) > MAX_SOURCE_BYTES * 2:
        raise ValueError("The study carrier exceeds the intake size limit.")
    try:
        return _json(data), data
    except (json.JSONDecodeError, UnicodeDecodeError):
        markdown = data.decode("utf-8-sig").replace("\u00a0", " ")
    blocks = re.findall(r"(?ms)^[ \t]*\x60{3}base64[ \t]*\r?\n(.*?)^[ \t]*\x60{3}[ \t]*$", markdown)
    if blocks:
        encoded = "".join(re.sub(r"\s+", "", block) for block in blocks)
        compressed = base64.b64decode(encoded, validate=True)
        if not compressed.startswith(b"\x1f\x8b"):
            raise ValueError("Canvas base64 source blocks must contain the original gzip companion.")
        with gzip.GzipFile(fileobj=io.BytesIO(compressed)) as archive:
            decoded = archive.read(MAX_SOURCE_BYTES + 1)
        if len(decoded) > MAX_SOURCE_BYTES:
            raise ValueError("The decoded Canvas companion exceeds the intake size limit.")
        return _json(decoded), decoded
    candidates = []
    for block in re.findall(r"(?ms)^[ \t]*\x60{3}json[ \t]*\r?\n(.*?)^[ \t]*\x60{3}[ \t]*$", markdown):
        try:
            value = json.loads(block)
        except json.JSONDecodeError:
            continue
        if isinstance(value, dict) and value.get("schema") == COMPANION_SCHEMA:
            candidates.append((value, block.encode("utf-8")))
    if len(candidates) != 1:
        raise ValueError("Choose the original study JSON, its complete Canvas Markdown, or a study ZIP.")
    return candidates[0]


def decode_companion(data: bytes) -> tuple[dict[str, bytes], dict[str, Any]]:
    """Read the original OBS12 JSON bank or this consumer's complete ZIP export."""
    if data.startswith(b"PK"):
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            items = [item for item in archive.infolist() if not item.is_dir()]
            if len(items) > MAX_SOURCE_FILES + 3:
                raise ValueError("The archive has too many files.")
            if sum(item.file_size for item in items) > MAX_SOURCE_BYTES:
                raise ValueError("The archive exceeds the source intake limit.")
            names = [_name(item.filename) for item in items]
            if len(names) != len(set(names)):
                raise ValueError("The archive contains duplicate paths.")
            if "published-study-export.json" in names:
                exported = _json(archive.read("published-study-export.json"))
                if exported.get("schema") != EXPORT_SCHEMA:
                    raise ValueError("Unsupported study export schema.")
                files = {}
                for entry in exported["source_files"]:
                    name = _name(entry["path"])
                    if name in files:
                        raise ValueError(f"Duplicate exported source: {name}")
                    raw = archive.read("source/" + name)
                    if len(raw) != entry["bytes"] or _hash(raw) != entry["sha256"]:
                        raise ValueError(f"Export source bytes changed: {name}")
                    files[name] = raw
                return _normalize_bundle(files), {
                    "carrier_sha256": _hash(data),
                    "reopened_from": exported.get("record", {}),
                    "source_format": "complete_study_export",
                }
            files = {name: archive.read(name) for name in names}
            return _normalize_bundle(files), {
                "carrier_sha256": _hash(data), "source_format": "study_directory_zip"
            }
    package, decoded = _companion_document(data)
    if not isinstance(package, dict):
        raise ValueError("The study companion must be a JSON object.")
    if package.get("schema") != COMPANION_SCHEMA:
        raise ValueError("Expected the published OBS12 study companion or a complete study export ZIP.")
    files = {}
    for entry in package.get("files", []):
        name = _name(entry["path"])
        if name in files:
            raise ValueError(f"Duplicate companion path: {name}")
        if entry.get("encoding", "utf-8").lower().replace("_", "-") not in ("utf-8", "utf8"):
            raise ValueError(f"Unsupported source encoding for {name}.")
        raw = entry["content"].encode("utf-8")
        if len(raw) != entry["bytes"] or _hash(raw) != entry["sha256"]:
            raise ValueError(f"Companion source bytes changed: {name}")
        files[name] = raw
    return _normalize_bundle(files), {
        "carrier_sha256": _hash(data),
        "source_format": COMPANION_SCHEMA,
        "decoded_companion_sha256": _hash(decoded),
        "operation_id": package.get("operation_id"),
    }


def companion_from_directory(directory: Path) -> tuple[dict[str, bytes], dict[str, Any]]:
    directory = directory.resolve(strict=True)
    if (directory / "study-files.json").is_file():
        companion, _ = builtin_companion(directory)
        files, origin = decode_companion(companion)
        return files, {
            **origin, "source_format": "declared_original_observation_inventory",
            "original_directory": str(directory),
        }
    files = {}
    for path in sorted(directory.rglob("*")):
        if path.is_symlink():
            raise ValueError("Study source directories must not contain symlinks.")
        if path.is_file():
            if path.name in ("record.json", "sources.json"):
                continue
            files[str(path.relative_to(directory))] = path.read_bytes()
    return _normalize_bundle(files), {
        "source_format": "materialized_OBS12_companion",
        "original_directory": str(directory),
    }


OBSERVATION_FILE = "wqp_20261013/three-lake-observations.csv"
COHORT_FILE = "cohort_reconciliation_20261013/study_chlorophyll_cohort.csv"
COHORT_CONTEXT = "cohort_reconciliation_20261013/cohort_reconciliation.json"
COHORT_MANIFEST = "eighteenmile_chlorophyll_reconciled.sources.json"
REPORT_MANIFEST = "eighteenmile_lake_observation_report.sources.json"
PAIRED_MANIFEST = "eighteenmile_lake_paired_analysis.sources.json"
MICROCYSTIN_MANIFEST = "eighteenmile_lake_microcystin_reconciliation.sources.json"
STREAM_STUDY_ID = "scdes-eighteenmile-streams-2020-2025"
STREAM_CONTEXT_MANIFEST = "eighteenmile_stream_nutrient_analysis.sources.json"
STREAM_CONTEXT_ROOT = "application-context/stream-nutrients"
STREAM_RETAINED_MANIFEST = STREAM_CONTEXT_ROOT + "/" + STREAM_CONTEXT_MANIFEST
STREAM_SOURCE_PREFIXES = (
    "observations/eighteenmile_stream_nutrients_2020_2025/analysis/",
    "source/eighteenmile-stream-nutrients-20261013/original/",
)
INSTALLED_CONTEXT_MANIFESTS = (COHORT_MANIFEST, REPORT_MANIFEST, PAIRED_MANIFEST, MICROCYSTIN_MANIFEST)
INSTALLED_CONTEXT_PATHS = INSTALLED_CONTEXT_MANIFESTS + tuple(
    "observations/eighteenmile_2023/" + name for name in (
        "wqp/flow-context-sources.json", "wqp/flow-context-public-sources.json",
        "wqp_20261013/source-manifest.json",
    )
)
WQP_FILE = "wqp/derived/measurements.csv"
WQP_COHORT = "wqp/derived/selected_chlorophyll.csv"
WQP_COVERAGE = "wqp/derived/coverage.csv"
WQP_CALENDAR = "wqp/derived/calendar.csv"
WQP_SUMMARY = "wqp/derived/summary.json"
FLOW_FILE = "wqp/study_flow_dates.csv"
FLOW_METHODS = "wqp/flow_context_methods.json"
FLOW_METHODS_PUBLIC = "wqp/flow_context_methods.public.json"
FIGURE_MANIFEST = "figures/model-sources.json"
FIGURES = {
    "figures/chlorophyll_time_series.svg": "Chlorophyll at the five original stations",
    "figures/chlorophyll_distributions.svg": "All selected chlorophyll observations and distributions",
    "figures/sampling_flow_context.svg": "Observed upstream flow on the original laboratory dates",
    "figures/chlorophyll_antecedent_context.svg": "Chlorophyll and preceding upstream flow",
}
FIGURE_SCOPE = "These retained figures show the complete original 75-observation chlorophyll cohort and 16 laboratory dates. They retain their full source scope when the study tables are filtered."
WQP_FIELDS = {
    "monitoring_location_id": "station_id", "activity_id": "activity_id",
    "date": "sample_date", "local_time": "sample_time", "source_timezone": "sample_timezone",
    "project_id": "project_id", "parameter": "characteristic", "value": "reported_value",
    "unit": "reported_unit", "detection_condition": "detection_condition",
    "detection_limit": "detection_limit", "detection_limit_unit": "detection_limit_unit",
    "depth": "activity_depth", "depth_unit": "activity_depth_unit",
    "sample_fraction": "sample_fraction", "status": "result_status", "qualifier": "qualifier",
    "method_id": "analytical_method_id", "method_authority": "analytical_method_context",
}
CONTEXT_FILES = (OBSERVATION_FILE, COHORT_FILE, WQP_FILE, WQP_COHORT, WQP_COVERAGE, WQP_CALENDAR, FLOW_FILE)

COHORT_FIELDS = {
    "monitoring_location_id": "MonitoringLocationIdentifier", "activity_id": "ActivityIdentifier",
    "date": "ActivityStartDate", "local_time": "ActivityStartTime/Time",
    "source_timezone": "ActivityStartTime/TimeZoneCode", "project_id": "ProjectIdentifier",
    "parameter": "CharacteristicName", "value": "ResultMeasureValue",
    "unit": "ResultMeasure/MeasureUnitCode", "detection_condition": "ResultDetectionConditionText",
    "detection_limit": "DetectionQuantitationLimitMeasure/MeasureValue",
    "detection_limit_unit": "DetectionQuantitationLimitMeasure/MeasureUnitCode",
    "depth": "ActivityDepthHeightMeasure/MeasureValue", "depth_unit": "ActivityDepthHeightMeasure/MeasureUnitCode",
    "sample_fraction": "ResultSampleFractionText", "status": "ResultStatusIdentifier",
    "qualifier": "MeasureQualifierCode", "method_id": "ResultAnalyticalMethod/MethodIdentifier",
    "method_authority": "ResultAnalyticalMethod/MethodIdentifierContext",
}
OBSERVATION_PARAMETERS = {
    "Chlorophyll a, corrected for pheophytin": "total_chlorophyll_a",
    "Microcystins/nodularin": "microcystins",
}


def _observation_rows(data: bytes, source_file: str = OBSERVATION_FILE, *, raw_wqp=False) -> list[dict[str, Any]]:
    reader = csv.DictReader(io.StringIO(data.decode("utf-8-sig"), newline=""))
    required = {
        "station_id", "monitoring_location_id", "activity_id", "date", "local_time",
        "source_timezone", "parameter", "value", "unit", "detection_condition",
        "detection_limit", "detection_limit_unit", "depth", "depth_unit",
    }
    headers = reader.fieldnames or []
    field_map = WQP_FIELDS if source_file in (WQP_FILE, WQP_COHORT) else COHORT_FIELDS if source_file == COHORT_FILE or raw_wqp else None
    expected = set(field_map.values()) if field_map else required
    if len(headers) != len(set(headers)) or not expected.issubset(headers):
        raise ValueError("The original observation CSV has an incompatible column contract.")
    rows = []
    for number, original in enumerate(reader, start=2):
        raw = dict(original)
        if field_map:
            raw = {name: original[column] for name, column in field_map.items()}
            raw["station_id"] = re.sub(r"^21SC60WQ(?:_WQX)?-", "", raw["monitoring_location_id"])
        if None in original or any(value is None for value in original.values()):
            raise ValueError(f"Malformed original observation at CSV row {number}.")
        if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", raw["date"]):
            raise ValueError(f"Invalid original observation date at CSV row {number}.")
        row = {
            **raw, "site_id": raw["station_id"], "parameter_original": raw["parameter"],
            "parameter": OBSERVATION_PARAMETERS.get(raw["parameter"], raw["parameter"]),
            "source_file": source_file, "source_csv_row": number, "raw_cells": original,
            "source_depth_token": raw["depth"], "source_value_token": raw["value"],
            "activity_type": original.get("activity_type", original.get("ActivityTypeCode", "")),
            "activity_comment": original.get("activity_comment", original.get("ActivityCommentText", "")),
            "result_comment": original.get("result_comment", original.get("ResultCommentText", "")),
            "laboratory_comment": original.get("laboratory_comment", original.get("ResultLaboratoryCommentText", "")),
        }
        for field in ("value", "detection_limit", "depth"):
            if raw[field] == "":
                row[field] = None
            else:
                row[field] = float(raw[field])
                if not math.isfinite(row[field]):
                    raise ValueError(f"Non-finite original observation {field} at row {number}.")
        row["detection_limit_type"] = original.get(
            "detection_limit_type", original.get("DetectionQuantitationLimitTypeName", "")
        )
        quantitation = original.get("quantitation_class", "")
        lower_censored = quantitation == "censored_below" or bool(
            re.search(r"below|not detected|less than", raw["detection_condition"], re.I)
        )
        upper_censored = quantitation == "censored_above" or bool(
            re.search(r"above.*upper|greater than", raw["detection_condition"], re.I)
        ) or bool(
            row["value"] is None and row["detection_limit"] is not None
            and raw["detection_condition"] == "Present Above Quantification Limit"
            and re.search(r"upper quantitation limit", row["detection_limit_type"], re.I)
        )
        row["censor_direction"] = "above" if upper_censored else "below" if lower_censored else ""
        row["censored"] = bool(row["censor_direction"])
        if source_file in (WQP_FILE, WQP_COHORT):
            row.update(
                original_record_id=original["record_id"], original_source_path=original["source_path"],
                original_source_sha256=original["source_sha256"], original_source_record_index=int(original["source_record_index"]),
                quantitation_class=original["quantitation_class"], cohort_selection=original["study_chla_selection"],
                selection_basis=original["selection_basis"],
            )
        row["record_id"] = "observed-row-" + _hash(_json_bytes({"source": source_file, "row": number, "cells": original}))[:24]
        rows.append(row)
    return rows


def _combined_observations(files):
    registered = load_observations(files, _observation_rows)
    if registered is not None:
        if any(name in files for name in (OBSERVATION_FILE, COHORT_FILE, WQP_FILE, WQP_COHORT)):
            raise ValueError("Use one explicit observation cohort per study version.")
        return registered
    if WQP_FILE in files and WQP_COHORT in files:
        measured = _observation_rows(files[WQP_FILE], WQP_FILE)
        cohort = _observation_rows(files[WQP_COHORT], WQP_COHORT)
        if any(row["parameter"] != "total_chlorophyll_a" for row in cohort):
            raise ValueError("The selected chlorophyll source contains another characteristic.")
        return [row for row in measured if row["parameter"] == "microcystins"] + cohort
    observed = _observation_rows(files[OBSERVATION_FILE]) if OBSERVATION_FILE in files else []
    if COHORT_FILE in files:
        cohort = _observation_rows(files[COHORT_FILE], COHORT_FILE)
        if any(row["parameter"] != "total_chlorophyll_a" for row in cohort):
            raise ValueError("The retained chlorophyll cohort contains another characteristic.")
        observed = [row for row in observed if row["parameter"] != "total_chlorophyll_a"] + cohort
    return observed


def _context_rows(data, source_file):
    reader = csv.DictReader(io.StringIO(data.decode("utf-8-sig"), newline=""))
    headers = reader.fieldnames or []
    if not headers or len(headers) != len(set(headers)):
        raise ValueError("Context CSV columns must be nonempty and unique.")
    rows = []
    for number, raw in enumerate(reader, start=2):
        if None in raw or any(value is None for value in raw.values()):
            raise ValueError("Malformed context row in " + source_file)
        if all(value == "" for value in raw.values()):
            continue
        row = {**raw, "raw_cells": raw, "source_file": source_file, "source_csv_row": number}
        if "station_id" in raw:
            row["site_id"] = re.sub(r"^21SC60WQ(?:_WQX)?-", "", raw["station_id"])
        if "characteristic" in raw:
            row["parameter"] = OBSERVATION_PARAMETERS.get(raw["characteristic"], raw["characteristic"])
        row["record_id"] = "context-row-" + _hash(_json_bytes({"source": source_file, "row": number, "cells": raw}))[:24]
        rows.append(row)
    return rows


def _dated_context(complete, sites, parameters, observation_context):
    rows = [row for row in complete["original_measurements"]
            if row["site_id"] in sites and (not parameters or row["parameter"] in parameters)]
    coverage = [row for row in complete["wqp_coverage"]
                if row["site_id"] in sites and (not parameters or row["parameter"] in parameters)]
    generic = complete["study"].get("observation_calendar_filters") is True
    if generic:
        selected_ids = {row["record_id"] for row in observation_context["rows"]}
        rows = [row for row in rows if row["record_id"] in selected_ids]
    observed_dates = {row["date"] for row in observation_context["rows"]}
    flow = [row for row in complete["flow_rows"] if row["sampling_date"] in observed_dates]
    return {
        "schema": "upstate.published-study-dated-context/v1",
        "rows": rows, "coverage": coverage, "summary": complete["wqp_summary"],
        "calendar": complete["wqp_calendar"], "flow_rows": flow,
        "flow_methods": complete["flow_methods"],
        "dates_without_flow_context": [] if generic else sorted(observed_dates - {row["sampling_date"] for row in complete["flow_rows"]}),
        "selection_notes": (complete["study"].get("observation_selection_notes") or [
            "Station, characteristic, year and month filters select original dated WQP result rows. Original source CSVs remain complete in every study export.",
            "Series keep their own fraction, analytical method, result value type, basis fields and support unit. Calculated source nitrogen remains a distinct characteristic and result type.",
            "Whole-basin point membership is source context; it does not establish location upstream of a gauge within the same unsplit reach.",
        ] if generic else [
            "WQP result rows retain the complete original acquisition year and original project identities. Station and parameter filters select these rows; continuous month/year and published depth-stratum filters apply to the published tables.",
            "Chlorophyll comparisons use the explicit reconciled cohort. Microcystin comparisons show every original campaign activity, including additional visits, with their own calendar and detection limits.",
            "Upstream flow context joins the retained agency reporting dates of the selected comparison activities. Original source response IDs, record indices and qualifiers remain in each row.",
        ]),
    }


def _manifest_path(manifest_name, value):
    """Resolve a native companion within the retained study tree."""
    if not isinstance(value, str) or not value or "\\" in value or "\x00" in value:
        raise ValueError("A manifest source must use a relative POSIX path.")
    reference = PurePosixPath(value)
    if reference.is_absolute() or str(reference) != value or value == ".":
        raise ValueError("A manifest source must use a canonical relative path.")
    if manifest_name in INSTALLED_CONTEXT_MANIFESTS:
        value = _name(value)
        prefix = "observations/eighteenmile_2023/"
        if not value.startswith(prefix):
            raise ValueError("Application-root study manifests must identify files inside the original study directory.")
        return _name(value[len(prefix):])
    parts = list(PurePosixPath(_name(manifest_name)).parent.parts)
    for part in reference.parts:
        if part == "..":
            if not parts:
                raise ValueError("A native companion must remain inside the retained study directory.")
            parts.pop()
        else:
            parts.append(part)
    return _name("/".join(parts))


def installed_context_paths(study_id: str) -> tuple[str, ...]:
    legacy = INSTALLED_CONTEXT_PATHS if study_id == application_context.LAKE_STUDY else ()
    return tuple(dict.fromkeys((*legacy, *application_context.manifest_names(study_id))))


def _stream_context(application: Path, manifest_path: Path) -> dict[str, bytes]:
    """Preserve the original application layout for registered scientific context."""
    return application_context.retained_files(application, manifest_path)


def add_installed_context(files: dict[str, bytes], manifests: list[Path]) -> tuple[dict[str, bytes], list[dict[str, Any]]]:
    """Compose explicit native report/cohort context without replacing the primary edition."""
    study_id = _json(files["study.json"]).get("study_id")
    allowed = installed_context_paths(study_id)
    if not allowed:
        raise ValueError("This study has no registered installed context family.")
    additions, origins = {}, []
    for supplied in manifests:
        path = Path(supplied).resolve(strict=True)
        relative = next((name for name in allowed
                         if path.parts[-len(PurePosixPath(name).parts):] == PurePosixPath(name).parts), None)
        if relative is None or not path.is_file():
            raise ValueError("Choose a supported original study context manifest.")
        application = path.parents[len(PurePosixPath(relative).parts) - 1]
        native_bytes = path.read_bytes()
        native = _json(native_bytes)
        if relative in application_context.FAMILIES:
            retained = application_context.retained_files(application, path)
        else:
            root = (application / "observations" / "eighteenmile_2023").resolve(strict=True)
            manifest_name = relative.removeprefix("observations/eighteenmile_2023/")
            if native.get("schema") != "upstate.sources/v1" or not isinstance(native.get("entries"), list):
                raise ValueError("A study context manifest must use upstate.sources/v1.")
            retained = {manifest_name: native_bytes}
            for entry in native["entries"]:
                for item in [entry, *entry.get("companions", [])]:
                    name = _manifest_path(manifest_name, item["path"])
                    target = (root / name).resolve(strict=True)
                    if not target.is_relative_to(root) or not target.is_file():
                        raise ValueError("Original study context must remain inside its study directory.")
                    raw = target.read_bytes()
                    if item.get("sha256", _hash(raw)) != _hash(raw) or item.get("bytes", len(raw)) != len(raw):
                        raise ValueError("An original study context source changed: " + name)
                    if name in retained and retained[name] != raw:
                        raise ValueError("A native context assigns conflicting source bytes: " + name)
                    retained[name] = raw
        for name, raw in retained.items():
            if name in additions and additions[name] != raw:
                raise ValueError("Installed study context manifests disagree at " + name)
            if name in files and files[name] != raw:
                raise ValueError("Installed context differs from the selected source edition at " + name)
            additions[name] = raw
        origins.append({
            "manifest": relative, "bytes": len(native_bytes), "sha256": _hash(native_bytes),
            "native_entry_count": len(native["entries"]), "retained_files": sorted(retained),
        })
    return _normalize_bundle({**files, **additions}), origins


def _observation_context(rows, seasonal, study, sites, parameters, strata):
    start = study.get("grab_sampling", {}).get("start", "")
    end = study.get("grab_sampling", {}).get("end", "")
    chosen = [
        row for row in rows
        if row["site_id"] in sites
        and (not parameters or row["parameter"] in parameters)
        and (not strata or ("surface" in strata and study.get("observation_calendar_filters") is not True))
        and (not start or row["date"] >= start)
        and (not end or row["date"] <= end)
    ]
    groups = {}
    for row in chosen:
        groups.setdefault((row["site_id"], row["parameter"], row.get("project_id", ""), row.get("activity_type", ""), row.get("series_key", "")), []).append(row)
    series = []
    for (site_id, parameter, project_id, activity_type, series_key), records in sorted(groups.items()):
        numeric = [row["value"] for row in records if row["value"] is not None and not row["censored"]]
        units = sorted({row["unit"] for row in records if row["value"] is not None and row["unit"]})
        comparable_units = len(units) == 1 and all(
            row["unit"] == units[0] for row in records if row["value"] is not None and not row["censored"]
        )
        if numeric and comparable_units:
            mean = sum(numeric) / len(numeric)
            sd = math.sqrt(sum((value - mean) ** 2 for value in numeric) / (len(numeric) - 1)) if len(numeric) > 1 else None
            minimum, maximum = min(numeric), max(numeric)
        else:
            mean = sd = minimum = maximum = None
        published = next((
            row for row in seasonal
            if row["site_id"] == site_id and row["parameter"] == parameter and row["stratum"] == "surface"
        ), None)
        identifiers = [row["activity_id"] for row in records]
        dates = sorted(row["date"] for row in records)
        depth_tokens = sorted({row["source_depth_token"] + " " + row["depth_unit"] for row in records})
        qualifiers = sorted({row.get("qualifier", "") for row in records if row.get("qualifier")})
        reference_dates = {
            row["date"] for row in rows
            if row["site_id"] == site_id and row["parameter"] == "total_chlorophyll_a"
            and (not start or row["date"] >= start) and (not end or row["date"] <= end)
        }
        missing_reference_dates = sorted(reference_dates - set(dates))
        additional_dates = sorted(set(dates) - reference_dates) if reference_dates else []
        censored = sum(row["censored"] for row in records)
        missing = sum(row["value"] is None and not row["censored"] for row in records)
        basis = "Original quantified activities; arithmetic mean and sample SD; censored and missing values retain their source fields. Source project and activity type define separate series."
        support = "Reconciled chlorophyll cohort" if parameter == "total_chlorophyll_a" and all(row["source_file"] in (COHORT_FILE, WQP_COHORT) for row in records) else "Original campaign activities"
        if support == "Reconciled chlorophyll cohort":
            basis += " " + " ".join(sorted({row.get("selection_basis", "") for row in records if row.get("selection_basis")}))
        if parameter == "microcystins":
            support = "Microcystin campaign context"
            basis += " All original campaign microcystin activities are shown with their actual activity type and calendar; printed report statistics retain their separate analytical cohort."
        if censored:
            basis += " This quantified-only mean uses no substituted values."
            if published:
                basis += " The published mean retains the report's separate censor treatment."
        if parameter == "microcystins" and (missing_reference_dates or additional_dates):
            basis += " The original microcystin calendar differs from the chlorophyll visit calendar; the exact missing and additional dates are retained."
        if len(identifiers) != len(set(identifiers)):
            basis += " Multiple result rows share an activity identifier; record count and distinct activity count are shown separately."
        if qualifiers:
            basis += " Original result qualifiers are retained: " + ", ".join(qualifiers) + "."
        metadata = series_metadata(records)
        if metadata:
            support = metadata.get("source_sample_support", "Original sampling activities")
            basis += " Fraction, method authority and identifier, result value type, original basis fields and effective support unit define separate series."
        series.append({
            **metadata,
            "site_id": site_id, "parameter": parameter, "project_id": project_id,
            "activity_type": activity_type, "sample_support": support,
            "parameter_original": sorted({row["parameter_original"] for row in records}),
            "unit": units[0] if comparable_units else metadata.get("support_unit", "; ".join(units)),
            "record_count": len(records), "activity_count": len(set(identifiers)),
            "numeric_count": len(numeric), "censored_count": censored, "missing_count": missing,
            "date_count": len(set(dates)), "period_start": dates[0], "period_end": dates[-1],
            "depths_as_reported": [value.strip() or "not reported" for value in depth_tokens],
            "qualifiers": qualifiers, "mean": mean, "sample_sd": sd,
            "missing_chlorophyll_dates": missing_reference_dates,
            "additional_dates": additional_dates,
            "original_methods": sorted({row.get("method_authority", "") + " " + row.get("method_id", "") for row in records}),
            "minimum": minimum, "maximum": maximum, "published": published,
            "published_n": published["n"] if published else None,
            "published_mean": published["mean"] if published else None,
            "published_sd": published["sd"] if published else None,
            "count_difference": len(records) - published["n"] if published else None,
            "source_table": published.get("source_table") if published else None,
            "source_pdf_page": published.get("source_pdf_page") if published else None,
            "source_selector": records[0]["source_selector"], "basis": basis,
            "complete_uncensored_campaign": bool(
                parameter == "total_chlorophyll_a" and published and comparable_units and units[0] == published["units"]
                and not censored and not missing and len(identifiers) == len(set(identifiers))
                and len(set(dates)) == study.get("grab_sampling", {}).get("visits_per_site")
                and not qualifiers
            ),
        })
    return {
        "schema": "upstate.published-study-observation-comparison/v1",
        "rows": sorted(chosen, key=lambda row: (row["date"], row["local_time"], row["site_id"], row["parameter"], row["activity_id"])),
        "series": series, "period_start": start, "period_end": end,
        "temporal_support": ("Original sampling dates within the selected year and months; all original result fields and source query intervals are retained." if study.get("observation_calendar_filters") is True else "Original activities within the published grab-sampling campaign; continuous month/year filters apply only to continuous summaries."),
        "parameter_mapping": OBSERVATION_PARAMETERS,
    }


def _source_manifest(files: dict[str, bytes], study: dict[str, Any], study_id: str, version_id: str):
    """Register original map/table identities and every retained study document."""
    manifest_entries, source_entries, seen_ids, native_ids = [], {}, set(), {}
    manifest_names = [name for name in ("model-sources.json", "wqp/flow-context-sources.json", "wqp/flow-context-public-sources.json", "wqp_20261013/source-manifest.json", FIGURE_MANIFEST, *INSTALLED_CONTEXT_MANIFESTS, *application_context.retained_manifest_names()) if name in files]
    for manifest_name in manifest_names:
        parent = PurePosixPath(manifest_name).parent
        native = _json(files[manifest_name])
        if native.get("schema") != "upstate.sources/v1" or not isinstance(native.get("entries"), list):
            raise ValueError("The study map manifest must use upstate.sources/v1.")
        for original in native["entries"]:
            entry = dict(original)
            name = _manifest_path(manifest_name, entry["path"])
            source_id = entry.get("id")
            if not isinstance(source_id, str) or not source_id:
                raise ValueError("Study map source identifiers must be unique nonempty text.")
            if name not in files:
                raise ValueError("Each study map entry must identify one retained original source.")
            if entry.get("kind") not in ("raster", "vector", "table", "document"):
                raise ValueError("Unsupported study map source kind.")
            raw = files[name]
            if entry.get("sha256", _hash(raw)) != _hash(raw) or entry.get("bytes", len(raw)) != len(raw):
                raise ValueError("Study map source bytes changed: " + name)
            companions = []
            for original_companion in entry.get("companions", []):
                companion = dict(original_companion)
                companion_name = _manifest_path(manifest_name, companion["path"])
                if companion_name not in files:
                    raise ValueError("Study map companion is missing: " + companion_name)
                body = files[companion_name]
                if companion.get("sha256", _hash(body)) != _hash(body) or companion.get("bytes", len(body)) != len(body):
                    raise ValueError("Study map companion bytes changed: " + companion_name)
                companion.update(path="source/" + companion_name, sha256=_hash(body), bytes=len(body))
                companions.append(companion)
            if manifest_name != name and not any(item["path"] == "source/" + manifest_name for item in companions):
                manifest_body = files[manifest_name]
                companions.append({
                    "path": "source/" + manifest_name, "sha256": _hash(manifest_body),
                    "bytes": len(manifest_body),
                })
            entry.update(path="source/" + name, sha256=_hash(raw), bytes=len(raw), companions=companions)
            entry["metadata"] = {
                **entry.get("metadata", {}), "study_id": study_id,
                "study_version_id": version_id, "source_relative_path": name,
            }
            previous = native_ids.get(source_id)
            if previous:
                if previous["path"] != entry["path"] or previous["sha256"] != entry["sha256"] or previous["kind"] != entry["kind"]:
                    raise ValueError("Original source manifests assign conflicting bodies to " + source_id)
                existing_companions = {item["path"]: item for item in previous["companions"]}
                for companion in companions:
                    if companion["path"] in existing_companions and existing_companions[companion["path"]]["sha256"] != companion["sha256"]:
                        raise ValueError("Original source manifests assign conflicting companions.")
                    existing_companions[companion["path"]] = companion
                previous["companions"] = list(existing_companions.values())
            else:
                manifest_entries.append(entry)
                native_ids[source_id] = entry
            source_entries.setdefault(name, source_id)
            seen_ids.add(source_id)
    original_sources = {}
    if "wqp/capture.json" in files:
        capture = _json(files["wqp/capture.json"])
        original_sources = {item["source_path"]: item for item in [*capture.get("sources", []), *capture.get("additional_queries", [])]}
    for name, raw in sorted(files.items()):
        if name in source_entries:
            continue
        suffix = PurePosixPath(name).suffix.lower()
        if suffix not in (".csv", ".json", ".geojson", ".md", ".pdf", ".png", ".jpg", ".jpeg", ".mjs", ".cjs", ".py", ".txt", ".html", ".svg"):
            continue
        source_id = "study-" + _hash(name.encode("utf-8"))[:16]
        if source_id in seen_ids:
            raise ValueError("Study document source identifier conflicts with the original map manifest.")
        kind = "table" if suffix == ".csv" else "vector" if suffix == ".geojson" else "document"
        entry = {
            "id": source_id, "title": f"{study['title']} / {PurePosixPath(name).name}",
            "uri": study.get("original_url", ""), "vintage": study.get("publication", ""),
            "kind": kind, "path": "source/" + name, "sha256": _hash(raw), "bytes": len(raw),
            "metadata": {
                "study_id": study_id, "study_version_id": version_id, "source_relative_path": name,
                "observation_support": "published_study_context",
                "source_pdf_page_numbering": "one_based_viewer_page",
            },
        }
        captured = original_sources.get(name)
        if captured:
            if captured["sha256"] != _hash(raw) or captured["bytes"] != len(raw):
                raise ValueError("Original WQP capture bytes changed: " + name)
            entry["uri"] = captured["source_url"]
            entry["vintage"] = "2023"
            entry["metadata"].update(original_station_id=captured["station_id"], original_record_count=captured["record_count"])
        if suffix == ".geojson":
            vector = _json(raw)
            if vector.get("type") != "FeatureCollection":
                raise ValueError("Study GeoJSON sources must be FeatureCollections.")
            source_crs = vector.get("crs", {}).get("properties", {}).get("name")
            if not source_crs:
                declarations = {
                    item["source_crs"] for item in manifest_entries
                    if item.get("kind") == "vector" and item.get("source_crs")
                    and item.get("sha256") == _hash(raw)
                }
                if len(declarations) == 1:
                    source_crs = declarations.pop()
                    entry["metadata"]["coordinate_reference_basis"] = "Identical original body registered by an original native vector manifest."
            if not isinstance(source_crs, str) or not source_crs:
                raise ValueError("A study vector must retain its explicit original coordinate reference system.")
            entry["source_crs"] = source_crs
            entry["metadata"]["feature_count"] = len(vector.get("features", []))
        manifest_entries.append(entry)
        source_entries[name] = source_id
        seen_ids.add(source_id)
    return {
        "schema": "upstate.sources/v1", "title": study["title"], "entries": manifest_entries,
    }, source_entries


class PublishedStudyStore:
    """Use the current model Workspace and a caller-supplied retained store root."""

    def __init__(self, workspace: Any, storage_root: str | Path):
        self.workspace = workspace
        self.root = Path(storage_root).resolve()

    def _version_root(self, study_id: str, version_id: str) -> Path:
        return self.root / _safe_id(study_id) / _safe_id(version_id)

    def _records(self, study_id: str | None = None) -> list[dict[str, Any]]:
        pattern = (_safe_id(study_id) + "/*/record.json") if study_id else "*/*/record.json"
        records = []
        for path in self.root.glob(pattern):
            if not re.fullmatch(r"study-[0-9a-f]{24}", path.parent.name):
                continue
            record = _json(path.read_bytes())
            if record.get("source_manifest"):
                record["source_manifest"]["path"] = str((path.parent / "sources.json").resolve())
            records.append(record)
        return sorted(records, key=lambda record: (record["study_id"], record["version_id"]))

    def list_studies(self) -> dict[str, Any]:
        return {"schema": STORE_SCHEMA, "studies": self._records()}

    def _record(self, study_id: str, version_id: str | None = None) -> dict[str, Any]:
        records = self._records(study_id)
        if version_id:
            records = [record for record in records if record["version_id"] == version_id]
        if not records:
            raise KeyError(f"Published study not found: {study_id}")
        if not version_id and len(records) > 1:
            current = self.root / _safe_id(study_id) / "current.json"
            if current.exists():
                selected = _json(current.read_bytes())["version_id"]
                records = [record for record in records if record["version_id"] == selected]
        return records[-1]

    def import_source(
        self,
        source: str | Path | bytes,
        *,
        evidence: dict[str, bytes] | None = None,
        operation_id: str | None = None,
        context_manifests: list[Path] | None = None,
        context_application: str | Path | None = None,
    ) -> dict[str, Any]:
        if isinstance(source, bytes):
            files, origin = decode_companion(source)
        else:
            source_path = Path(source)
            files, origin = (
                companion_from_directory(source_path)
                if source_path.is_dir() else decode_companion(source_path.read_bytes())
            )
        for name, raw in (evidence or {}).items():
            name = _name(name)
            if name in files and files[name] != raw:
                raise ValueError(f"Evidence must not overwrite a different source file: {name}")
            files[name] = raw
        files = _normalize_bundle(files)
        study = _json(files["study.json"])
        if study.get("schema") != STUDY_SCHEMA:
            raise ValueError("Unsupported published study metadata schema.")
        study_id = _safe_id(study["study_id"])
        context_manifests = list(context_manifests or [])
        if context_application is not None:
            application = Path(context_application).resolve(strict=True)
            context_manifests.extend(
                application / name for name in installed_context_paths(study_id)
                if (application / name).is_file()
            )
        context_manifests = list(dict.fromkeys(path.resolve() for path in context_manifests))
        if context_manifests:
            files, context_origins = add_installed_context(files, context_manifests)
            origin = {**origin, "installed_context": context_origins}
        tables = {
            name: _csv_rows(files[filename], name)
            for name, filename in TABLE_FILES.items() if filename in files
        }
        observed = _combined_observations(files)
        measurements = observed if OBSERVATION_INDEX in files else (_observation_rows(files[WQP_FILE], WQP_FILE) if WQP_FILE in files else [])
        result_counts = {
            "observed_activities": len(observed), "original_result_rows": len(measurements),
            "original_activity_count": len({(row["monitoring_location_id"], row.get("project_id", ""), row["activity_id"]) for row in measurements}),
            "flow_dates": len(_context_rows(files[FLOW_FILE], FLOW_FILE)) if FLOW_FILE in files else 0,
        }
        station_ids = [row["site_id"] for row in tables["stations"]]
        if any(row["site_id"] not in station_ids for row in observed):
            raise ValueError("An original observation references a station outside this study.")
        if len(station_ids) != len(set(station_ids)):
            raise ValueError("Study station identifiers must be unique.")
        for table, rows in tables.items():
            for row in rows:
                if "site_id" in row and row["site_id"] not in station_ids:
                    raise ValueError(f"{table} references an unknown station: {row['site_id']}")
        source_notes = _json(files["source_notes.json"])
        if not isinstance(source_notes, list):
            raise ValueError("source_notes.json must contain the original note array.")
        entries = [
            {"path": name, "bytes": len(raw), "sha256": _hash(raw)}
            for name, raw in sorted(files.items())
        ]
        bundle_hash = _hash(_json_bytes(entries))
        version_id = "study-" + bundle_hash[:24]
        final = self._version_root(study_id, version_id)
        record_path = final / "record.json"
        reused = record_path.exists()
        if not reused:
            final.parent.mkdir(parents=True, exist_ok=True)
            staging = Path(tempfile.mkdtemp(prefix=".study-", dir=final.parent))
            try:
                for name, raw in files.items():
                    path = staging / "source" / name
                    path.parent.mkdir(parents=True, exist_ok=True)
                    path.write_bytes(raw)
                record = {
                    "schema": STORE_SCHEMA,
                    "study_id": study_id,
                    "version_id": version_id,
                    "title": study["title"],
                    "publication": study.get("publication"),
                    "bundle_sha256": bundle_hash,
                    "operation_id": operation_id or origin.get("operation_id"),
                    "origin": origin,
                    "source_files": entries,
                    "counts": {**{name: len(rows) for name, rows in tables.items()}, **result_counts},
                    "source_note_count": len(source_notes),
                    "source_collection_id": None,
                    "source_entries": {},
                }
                (staging / "record.json").write_bytes(_json_bytes(record))
                try:
                    os.rename(staging, final)
                except OSError:
                    if not record_path.exists():
                        raise
                    existing = _json(record_path.read_bytes())
                    if existing["bundle_sha256"] != bundle_hash:
                        raise
                    reused = True
            finally:
                if staging.exists():
                    shutil.rmtree(staging)
        record = _json(record_path.read_bytes())
        if not record.get("source_collection_id") or record.get("source_registration_schema") != "upstate.published-study-sources/v10":
            source_manifest, source_entries = _source_manifest(files, study, study_id, version_id)
            manifest_path = final / "sources.json"
            _atomic(manifest_path, _json_bytes(source_manifest))
            collection = self.workspace.import_sources(manifest_path)
            manifest_bytes = manifest_path.read_bytes()
            record["source_manifest"] = {
                "path": str(manifest_path.resolve()), "bytes": len(manifest_bytes),
                "sha256": _hash(manifest_bytes), "schema": "upstate.sources/v1",
            }
            record["counts"] = {**{name: len(rows) for name, rows in tables.items()}, **result_counts}
            record["source_collection_id"] = collection["id"]
            record["source_registration_schema"] = "upstate.published-study-sources/v10"
            record["source_entries"] = source_entries
            _atomic(record_path, _json_bytes(record))
        _atomic(
            self.root / study_id / "current.json",
            _json_bytes({"study_id": study_id, "version_id": version_id}),
        )
        return {"record": self._record(study_id, version_id), "reused": reused}

    def get_study(self, study_id: str, version_id: str | None = None) -> dict[str, Any]:
        record = self._record(study_id, version_id)
        def original(filename: str) -> bytes:
            path, _ = self.source_file(study_id, filename, record["version_id"])
            return path.read_bytes()
        study = _json(original("study.json"))
        tables = {
            name: _csv_rows(original(filename), name)
            for name, filename in TABLE_FILES.items() if filename in record["source_entries"]
        }
        for name, rows in tables.items():
            selector = {
                "source_collection_id": record["source_collection_id"],
                "source_id": record["source_entries"][TABLE_FILES[name]],
            }
            for row in rows:
                row["source_selector"] = selector
        notes = _json(original("source_notes.json"))
        context_files = {name: original(name) for name in CONTEXT_FILES if name in record["source_entries"]}
        context_files.update(observation_files(original, record["source_entries"]))
        observed = _combined_observations(context_files)
        measurements = observed if OBSERVATION_INDEX in context_files else (_observation_rows(context_files[WQP_FILE], WQP_FILE) if WQP_FILE in context_files else [])
        coverage = _context_rows(context_files[WQP_COVERAGE], WQP_COVERAGE) if WQP_COVERAGE in context_files else []
        calendar = _context_rows(context_files[WQP_CALENDAR], WQP_CALENDAR) if WQP_CALENDAR in context_files else []
        flow = _context_rows(context_files[FLOW_FILE], FLOW_FILE) if FLOW_FILE in context_files else []
        for row in observed + measurements + coverage + calendar + flow:
            row["source_selector"] = {
                "source_collection_id": record["source_collection_id"],
                "source_id": record["source_entries"][row["source_file"]],
            }
            raw_path = row.get("original_source_path")
            if raw_path in record["source_entries"]:
                row["original_source_selector"] = {
                    "source_collection_id": record["source_collection_id"],
                    "source_id": record["source_entries"][raw_path],
                }
            for reference in row.get("metadata_source_records", {}).values():
                metadata_path = reference["source_file"]
                if metadata_path not in record["source_entries"]:
                    raise ValueError("An original observation metadata source is not registered.")
                reference["source_selector"] = {
                    "source_collection_id": record["source_collection_id"],
                    "source_id": record["source_entries"][metadata_path],
                }
        summary = _json(original(WQP_SUMMARY)) if WQP_SUMMARY in record["source_entries"] else {}
        methods_name = next((name for name in (FLOW_METHODS, FLOW_METHODS_PUBLIC)
                             if name in record["source_entries"]), None)
        flow_methods = _json(original(methods_name)) if methods_name else {}
        available_stations = {row["site_id"]: row for row in tables["stations"]}
        for source in summary.get("source_row_counts", []):
            site_id = source["station_id"]
            if site_id not in available_stations:
                available_stations[site_id] = {
                    "site_id": site_id, "description": "Original WQP source context",
                    "original_record_count": source["record_count"], "source_path": source["source_path"],
                }
        cohort_reconciliation = _json(original(COHORT_CONTEXT)) if COHORT_CONTEXT in record["source_entries"] else None
        reconciliation_name = "wqp_20261013/report-reconciliation.json"
        reconciliation = _json(original(reconciliation_name)) if reconciliation_name in record["source_entries"] else None
        visual = []
        for entry in record["source_files"]:
            if entry["path"].endswith(".json") and (
                "visual" in entry["path"] or "table7" in entry["path"]
            ):
                value = _json(original(entry["path"]))
                if isinstance(value, dict) and value.get("schema") == "upstate.published-study-visual-context/v1":
                    visual.append(value)
        native_catalog_bytes = (self._version_root(study_id, record["version_id"]) / "sources.json").read_bytes()
        expected_catalog = record["source_manifest"]
        if len(native_catalog_bytes) != expected_catalog["bytes"] or _hash(native_catalog_bytes) != expected_catalog["sha256"]:
            raise ValueError("The retained study source manifest changed.")
        native_catalog = _json(native_catalog_bytes)
        native_entries = {entry["id"]: entry for entry in native_catalog["entries"]}
        return {
            "record": record, "study": study, "tables": tables,
            "source_notes": notes, "visual_context": visual,
            "unit_definitions": UNIT_DEFINITIONS,
            "observation_rows": observed, "observation_reconciliation": reconciliation,
            "cohort_reconciliation": cohort_reconciliation,
            "original_measurements": measurements, "wqp_coverage": coverage, "wqp_calendar": calendar,
            "wqp_summary": summary, "flow_rows": flow, "flow_methods": flow_methods,
            "available_stations": list(available_stations.values()),
            "source_artifacts": [
                {**entry,
                 "title": native_entries[record["source_entries"][entry["path"]]].get("title"),
                 "role": native_entries[record["source_entries"][entry["path"]]].get("role"),
                 "source_metadata": native_entries[record["source_entries"][entry["path"]]].get("metadata", {}),
                 "source_selector": {
                    "source_collection_id": record["source_collection_id"],
                    "source_id": record["source_entries"][entry["path"]],
                }} for entry in record["source_files"]
                if entry["path"] in record["source_entries"]
            ],
        }

    def context(
        self,
        study_id: str,
        version_id: str | None = None,
        *,
        site_ids: list[str] | None = None,
        parameters: list[str] | None = None,
        strata: list[str] | None = None,
        year: int | None = None,
        months: list[int] | None = None,
    ) -> dict[str, Any]:
        complete = self.get_study(study_id, version_id)
        stations = complete["available_stations"]
        known_sites = {row["site_id"] for row in stations}
        sites = set(site_ids or known_sites)
        unknown = sites - known_sites
        if unknown:
            raise ValueError("Unknown study station(s): " + ", ".join(sorted(unknown)))
        parameter_set, stratum_set = set(parameters or []), set(strata or [])
        month_set = set(months or [])
        if any(month < 1 or month > 12 for month in month_set):
            raise ValueError("Months must be between 1 and 12.")
        selected = {}
        for name, rows in complete["tables"].items():
            chosen = []
            for row in rows:
                if row.get("site_id") and row["site_id"] not in sites:
                    continue
                if parameter_set and "parameter" in row and row["parameter"] not in parameter_set:
                    continue
                if stratum_set and "stratum" in row and row["stratum"] not in stratum_set:
                    continue
                if year is not None and "year" in row and row["year"] != year:
                    continue
                if month_set and "month" in row and row["month"] not in month_set:
                    continue
                chosen.append(row)
            selected[name] = chosen
        expanded_ranges = []
        for row in selected.get("surface_ranges", []):
            for parameter, (minimum, maximum, units) in SURFACE_PARAMETERS.items():
                if parameter_set and parameter not in parameter_set:
                    continue
                expanded_ranges.append({
                    "site_id": row["site_id"], "parameter": parameter, "units": units,
                    "minimum": row.get(minimum), "maximum": row.get(maximum),
                    "depth_m": row.get("depth_m"),
                    "period_start": row.get("period_start"), "period_end": row.get("period_end"),
                    "general_event_count": row.get("general_event_count"),
                    "source_table": row.get("source_table"),
                    "source_pdf_page": row.get("source_pdf_page"),
                    "source_url": row.get("source_url"),
                    "source_csv_row": row["source_csv_row"],
                    "source_selector": row["source_selector"],
                    "source_field_names": [minimum, maximum],
                })
        relevant_notes = []
        selected_tables = {
            row.get("source_table") for name, rows in selected.items()
            for row in rows if name not in ("stations", "permits", "surface_ranges")
        }
        if expanded_ranges:
            selected_tables.update(row.get("source_table") for row in expanded_ranges)
        known_parameters = {
            row["parameter"] for name, rows in complete["tables"].items()
            for row in rows if "parameter" in row
        } | set(SURFACE_PARAMETERS)
        for note in complete["source_notes"]:
            note_sites = set()
            if note.get("site_id"):
                note_sites.add(note["site_id"])
            for scope in note.get("scope", []):
                if isinstance(scope, str) and scope in known_sites:
                    note_sites.add(scope)
                elif isinstance(scope, dict) and scope.get("site_id"):
                    note_sites.add(scope["site_id"])
            if note_sites and not sites.intersection(note_sites):
                continue
            if parameter_set and note.get("parameter") and note["parameter"] not in parameter_set:
                continue
            note_parameters = {scope for scope in note.get("scope", []) if isinstance(scope, str) and scope in known_parameters}
            if parameter_set and note_parameters and not parameter_set.intersection(note_parameters):
                continue
            if parameter_set and note.get("source_table") and note["source_table"] not in selected_tables:
                continue
            relevant_notes.append(note)
        seasonal = selected.get("seasonal", [])
        observation_context = _observation_context(
            filter_calendar(complete["observation_rows"], complete["study"], year, month_set), selected.get("seasonal", []), complete["study"],
            sites, parameter_set, stratum_set,
        )
        observation_context = enrich_observation_context(observation_context)
        return {
            "schema": "upstate.published-study-context/v1",
            "record": complete["record"],
            "study": complete["study"],
            "selection": {
                "site_ids": sorted(sites), "parameters": sorted(parameter_set),
                "strata": sorted(stratum_set), "year": year, "months": sorted(month_set),
            },
            "tables": selected,
            "surface_parameter_ranges": expanded_ranges,
            "observations": observation_context,
            "dated_context": _dated_context(complete, sites, parameter_set, observation_context),
            "observation_reconciliation": complete["observation_reconciliation"],
            "cohort_reconciliation": complete["cohort_reconciliation"],
            "source_notes": relevant_notes,
            "visual_context": [
                item for item in complete["visual_context"]
                if not parameter_set or item.get("summary_contract", {}).get("parameter") in parameter_set
            ],
            "source_artifacts": complete["source_artifacts"],
            "temporal_support": {
                "seasonal": complete["study"].get("grab_sampling", {}),
                "continuous": complete["study"].get("continuous", {}),
                "month_filter_applies_to": (["observations", "original_measurements"] if complete["study"].get("observation_calendar_filters") is True else ["monthly_do", "monthly_ph"]),
            },
            "unit_definitions": UNIT_DEFINITIONS,
            "coverage": {
                "complete_counts": complete["record"]["counts"],
                "selected_counts": {name: len(rows) for name, rows in selected.items()},
                "parameters": sorted({row["parameter"] for row in seasonal}),
                "units": sorted({row["units"] for row in seasonal}),
                "depth_intervals_m": sorted({
                    (row["depth_min_m"], row["depth_max_m"]) for row in seasonal
                }),
                "statistic_bases": sorted({row["statistic_basis"] for row in seasonal}),
            },
        }

    def source_file(
        self, study_id: str, filename: str, version_id: str | None = None
    ) -> tuple[Path, dict[str, Any]]:
        record = self._record(study_id, version_id)
        filename = _name(filename)
        if filename not in record["source_entries"]:
            raise KeyError(f"Source file is not registered: {filename}")
        return self.workspace.source_file(
            record["source_collection_id"], record["source_entries"][filename]
        )

    def export_study(
        self, study_id: str, destination: str | Path, version_id: str | None = None
    ) -> dict[str, Any]:
        record = self._record(study_id, version_id)
        source = self._version_root(study_id, record["version_id"]) / "source"
        destination = Path(destination)
        destination.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.NamedTemporaryFile(dir=destination.parent, suffix=".zip", delete=False) as temp:
            temporary = Path(temp.name)
        try:
            with zipfile.ZipFile(temporary, "w", zipfile.ZIP_DEFLATED) as archive:
                for entry in record["source_files"]:
                    raw = (source / entry["path"]).read_bytes()
                    if len(raw) != entry["bytes"] or _hash(raw) != entry["sha256"]:
                        raise ValueError(f"Retained source changed: {entry['path']}")
                    archive.writestr("source/" + entry["path"], raw)
                archive.writestr(
                    "published-study-export.json",
                    _json_bytes({
                        "schema": EXPORT_SCHEMA,
                        "record": record,
                        "source_files": record["source_files"],
                        "reopen": "Import this ZIP with PublishedStudyStore.import_source.",
                    }),
                )
                archive.writestr("study-context.json", _json_bytes(self.get_study(study_id, record["version_id"])))
                manifest = self._version_root(study_id, record["version_id"]) / "sources.json"
                archive.writestr("sources.json", manifest.read_bytes())
            os.replace(temporary, destination)
        finally:
            if temporary.exists():
                temporary.unlink()
        raw = destination.read_bytes()
        return {
            "path": str(destination.resolve()), "filename": destination.name,
            "bytes": len(raw), "sha256": _hash(raw), "mime_type": "application/zip",
            "study_id": study_id, "version_id": record["version_id"],
        }

    def export_context(
        self, study_id: str, destination: str | Path, version_id: str | None = None, **filters: Any
    ) -> dict[str, Any]:
        context = self.context(study_id, version_id, **filters)
        destination = Path(destination)
        destination.mkdir(parents=True, exist_ok=True)
        written = ["selected-context.json", "study-report.html"]
        _atomic(destination / "selected-context.json", _json_bytes(context))
        for table, rows in context["tables"].items():
            original = TABLE_FILES[table]
            source = self._version_root(study_id, context["record"]["version_id"]) / "source" / original
            headers = csv.DictReader(io.StringIO(source.read_text(encoding="utf-8-sig"))).fieldnames or []
            output = io.StringIO(newline="")
            writer = csv.DictWriter(output, fieldnames=headers, lineterminator="\n")
            writer.writeheader()
            writer.writerows(row["raw_cells"] for row in rows)
            _atomic(destination / original, output.getvalue().encode("utf-8"))
            written.append(original)
        for source_file, filename in (
            (OBSERVATION_FILE, "original-activities-selected.csv"),
            (COHORT_FILE, "chlorophyll-cohort-selected.csv"),
            (WQP_FILE, "campaign-microcystin-selected.csv"),
            (WQP_COHORT, "reconciled-chlorophyll-selected.csv"),
        ):
            selected_rows = [row for row in context["observations"]["rows"] if row["source_file"] == source_file]
            if not selected_rows:
                continue
            source, _ = self.source_file(study_id, source_file, context["record"]["version_id"])
            headers = csv.DictReader(io.StringIO(source.read_text(encoding="utf-8-sig"))).fieldnames or []
            output = io.StringIO(newline="")
            writer = csv.DictWriter(output, fieldnames=headers, lineterminator="\n")
            writer.writeheader()
            writer.writerows(row["raw_cells"] for row in selected_rows)
            _atomic(destination / filename, output.getvalue().encode("utf-8"))
            written.append(filename)

        registered_rows = {}
        for row in context["observations"]["rows"]:
            if row.get("source_observation"):
                registered_rows.setdefault(row["source_file"], []).append(row)
        selected_sources = []
        for source_file, selected_rows in sorted(registered_rows.items()):
            source, descriptor = self.source_file(study_id, source_file, context["record"]["version_id"])
            headers = csv.DictReader(io.StringIO(source.read_text(encoding="utf-8-sig"))).fieldnames or []
            output = io.StringIO(newline="")
            writer = csv.DictWriter(output, fieldnames=headers, lineterminator="\n")
            writer.writeheader()
            writer.writerows(row["raw_cells"] for row in selected_rows)
            filename = "selected-activities/" + _name(source_file)
            _atomic(destination / filename, output.getvalue().encode("utf-8"))
            written.append(filename)
            selected_sources.append({
                "path": filename, "original_source_path": source_file,
                "original_source_sha256": selected_rows[0]["original_source_sha256"],
                "original_source_url": selected_rows[0].get("original_source_url", ""),
                "record_count": len(selected_rows),
                "rows": [{"selected_csv_row": number, "original_csv_row": row["source_csv_row"],
                          "record_id": row["record_id"], "activity_id": row["activity_id"],
                          "original_result_identifier": row.get("original_result_identifier", ""),
                          "metadata_source_records": {
                              role: {key: value for key, value in reference.items() if key != "raw_cells"}
                              for role, reference in row.get("metadata_source_records", {}).items()}}
                         for number, row in enumerate(selected_rows, 2)],
            })
        metadata_rows = {}
        for selected_rows in registered_rows.values():
            for row in selected_rows:
                for reference in row.get("metadata_source_records", {}).values():
                    metadata_rows.setdefault(reference["source_file"], {})[reference["source_csv_row"]] = reference
        selected_metadata = []
        for source_file, references in sorted(metadata_rows.items()):
            source, descriptor = self.source_file(study_id, source_file, context["record"]["version_id"])
            headers = csv.DictReader(io.StringIO(source.read_text(encoding="utf-8-sig"))).fieldnames or []
            references = [reference for number, reference in sorted(references.items())]
            output = io.StringIO(newline="")
            writer = csv.DictWriter(output, fieldnames=headers, lineterminator="\n")
            writer.writeheader()
            writer.writerows(reference["raw_cells"] for reference in references)
            filename = "selected-activities/metadata/" + _name(source_file)
            _atomic(destination / filename, output.getvalue().encode("utf-8"))
            written.append(filename)
            selected_metadata.append({
                "path": filename, "original_source_path": source_file,
                "original_source_sha256": references[0]["sha256"],
                "record_count": len(references),
                "rows": [{"selected_csv_row": number,
                          **{key: value for key, value in reference.items() if key != "raw_cells"}}
                         for number, reference in enumerate(references, 2)],
            })
        if selected_sources:
            filename = "selected-activities/index.json"
            _atomic(destination / filename, _json_bytes({
                "schema": "upstate.selected-original-observations/v1",
                "study_id": study_id, "version_id": context["record"]["version_id"],
                "sources": selected_sources, "metadata_sources": selected_metadata,
            }))
            written.append(filename)

        for key, filename in (
            ("rows", "wqp-results-selected.csv"), ("coverage", "wqp-coverage-selected.csv"),
            ("flow_rows", "upstream-flow-selected.csv"),
        ):
            rows = context["dated_context"][key]
            if not rows:
                continue
            output = io.StringIO(newline="")
            writer = csv.DictWriter(output, fieldnames=list(rows[0]["raw_cells"]), lineterminator="\n")
            writer.writeheader()
            writer.writerows(row["raw_cells"] for row in rows)
            _atomic(destination / filename, output.getvalue().encode("utf-8"))
            written.append(filename)
        support_output = io.StringIO(newline="")
        series_columns = (
            "site_id", "parameter", "project_id", "activity_type", "sample_support",
            "series_key", "sample_fraction", "method_authority", "method_id",
            "result_value_type", "result_weight_basis", "result_time_basis",
            "result_temperature_basis", "result_particle_size_basis", "support_unit",
            "method_specification_name",
        )
        interval_columns = (
            "record_count", "distinct_activity_count", "quantified_count", "below_limit_count",
            "unresolved_count", "unit", "mean_lower", "mean_upper",
            "mean_upper_inclusive", "complete_interval_support", "basis",
        )
        support_columns = series_columns + interval_columns
        support_writer = csv.DictWriter(support_output, fieldnames=support_columns, lineterminator="\n")
        support_writer.writeheader()
        for series in context["observations"]["series"]:
            support = series.get("observation_support", {})
            support_writer.writerow({
                **{name: series.get(name, "") for name in series_columns},
                **{name: support.get(name, "") for name in interval_columns},
            })
        _atomic(destination / "observation-support-selected.csv", support_output.getvalue().encode("utf-8"))
        written.append("observation-support-selected.csv")
        report_context = dict(context)
        report_context["related_reports"] = []
        report_context["scientific_figures"] = []
        record = context["record"]
        version_root = self._version_root(study_id, record["version_id"])
        manifest_bytes = (version_root / "sources.json").read_bytes()
        expected_manifest = record["source_manifest"]
        if len(manifest_bytes) != expected_manifest["bytes"] or _hash(manifest_bytes) != expected_manifest["sha256"]:
            raise ValueError("The retained study source manifest changed.")
        bindings = {entry["id"]: entry for entry in _json(manifest_bytes)["entries"]}
        inventory = {entry["path"]: entry for entry in record["source_files"]}
        copied = set()
        for artifact in context["source_artifacts"]:
            name = artifact["path"]
            is_html = PurePosixPath(name).suffix.lower() in (".html", ".htm")
            if not is_html and not name.startswith("figures/"):
                continue
            binding = bindings[record["source_entries"][name]]
            members = [name]
            for companion in binding.get("companions", []):
                relative = companion["path"]
                if not relative.startswith("source/"):
                    raise ValueError("A report companion must belong to the retained study source directory.")
                members.append(_name(relative[len("source/"):]))
            for member in members:
                if member in copied:
                    continue
                expected = inventory[member]
                raw = (version_root / "source" / member).read_bytes()
                if len(raw) != expected["bytes"] or _hash(raw) != expected["sha256"]:
                    raise ValueError("Retained report companion changed: " + member)
                report_member = "original-sources/" + member
                _atomic(destination / report_member, raw)
                written.append(report_member)
                copied.add(member)
            if is_html:
                report_context["related_reports"].append({
                    "filename": "original-sources/" + name,
                    "title": binding.get("title") or PurePosixPath(name).name,
                })
            if name in FIGURES:
                report_context["scientific_figures"].append({
                    "filename": "original-sources/" + name, "title": FIGURES[name],
                })
        report_context["embedded_images"] = []
        for artifact in context["source_artifacts"]:
            name = artifact["path"]
            if name.lower().endswith(".png") and ("table7" in name.lower() or "table-7" in name.lower()):
                path, _ = self.source_file(study_id, name, context["record"]["version_id"])
                raw = path.read_bytes()
                if len(raw) <= 8 * 1024 * 1024:
                    report_context["embedded_images"].append({
                        "title": name, "data_uri": "data:image/png;base64," + base64.b64encode(raw).decode("ascii")
                    })
        _atomic(destination / "study-report.html", self.report_html(report_context).encode("utf-8"))
        # One download preserves relative links in the selected report and each
        # original HTML/companion tree without rewriting original source bytes.
        with tempfile.NamedTemporaryFile(dir=destination, suffix=".zip", delete=False) as temp:
            temporary = Path(temp.name)
        try:
            with zipfile.ZipFile(temporary, "w", zipfile.ZIP_DEFLATED) as archive:
                for name in sorted(set(written)):
                    archive.write(destination / name, name)
            os.replace(temporary, destination / "selected-study-report.zip")
        finally:
            if temporary.exists():
                temporary.unlink()
        written.append("selected-study-report.zip")
        return {
            "directory": str(destination.resolve()),
            "files": [
                {"filename": path.name, "relative_path": str(path.relative_to(destination)), "path": str(path.resolve()), "bytes": path.stat().st_size,
                 "sha256": _hash(path.read_bytes()),
                 "mime_type": mimetypes.guess_type(path.name)[0] or "application/octet-stream"}
                for path in (destination / name for name in sorted(written))
            ],
            "selection": context["selection"],
            "study_id": study_id, "version_id": context["record"]["version_id"],
        }

    @staticmethod
    def report_html(context: dict[str, Any]) -> str:
        def esc(value: Any) -> str:
            return html.escape("" if value is None else str(value), quote=True)

        def value(row: dict[str, Any], field: str) -> Any:
            if field == "value" and "source_value_token" in row:
                return row["source_value_token"]
            if field == "depth" and "source_depth_token" in row:
                return row["source_depth_token"]
            if field == "sd" and row.get("sd_published_token"):
                return row["sd_published_token"]
            if field == "minimum" and row.get("minimum_qualifier") == "below_detection_limit":
                return "< " + str(row.get("minimum_detection_limit"))
            result = row.get("raw_cells", {}).get(field, row.get(field))
            return "; ".join(map(str, result)) if isinstance(result, list) else result

        def table(title: str, rows: list[dict[str, Any]], columns: list[tuple[str, str]]) -> str:
            cells = "<tr>" + "".join(f"<th>{esc(label)}</th>" for _, label in columns) + "</tr>"
            for row in rows:
                cells += "<tr>" + "".join(f"<td>{esc(value(row, field))}</td>" for field, _ in columns) + "</tr>"
            return f"<section><h2>{esc(title)}</h2><table><thead>{cells.split('</tr>', 1)[0]}</tr></thead><tbody>{cells.split('</tr>', 1)[1]}</tbody></table></section>"

        study, selection = context["study"], context["selection"]
        seasonal = table("Seasonal concentration summaries", context["tables"].get("seasonal", []), [
            ("site_id", "Station"), ("stratum", "Stratum"), ("depth_min_m", "Depth from (m)"),
            ("depth_max_m", "Depth to (m)"), ("parameter", "Parameter"), ("units", "Unit"),
            ("mean", "Mean"), ("sd", "SD"), ("minimum", "Min"), ("maximum", "Max"),
            ("n", "n as printed"), ("source_table", "Table"), ("source_pdf_page", "PDF page"),
        ])
        monthly = ""
        for kind in ("monthly_do", "monthly_ph"):
            columns = [
                ("site_id", "Station"), ("year", "Year"), ("month", "Month"), ("units", "Unit"),
                ("avg_daily_minimum", "Avg daily min"), ("avg_daily_maximum", "Avg daily max"),
                ("published_avg_daily_range", "Published avg daily range"), ("n_days", "Days"),
            ]
            if kind == "monthly_ph":
                columns.append(("days_with_max_above_8_5", "Days with max above 8.5"))
            columns.extend([("source_table", "Table"), ("source_pdf_page", "PDF page")])
            monthly += table(TABLE_TITLES[kind], context["tables"].get(kind, []), columns)
        ranges = table("Surface field ranges", context["surface_parameter_ranges"], [
            ("site_id", "Station"), ("parameter", "Parameter"), ("units", "Unit"),
            ("minimum", "Min"), ("maximum", "Max"), ("depth_m", "Depth (m)"),
            ("period_start", "Start"), ("period_end", "End"), ("source_pdf_page", "PDF page"),
        ])
        stations = table("Original station coordinates", context["tables"].get("stations", []), [
            ("site_id", "Station"), ("description", "Description"), ("latitude", "Latitude"),
            ("longitude", "Longitude"), ("datum", "Datum"), ("epsg", "EPSG"),
            ("monitoring_location_id", "Original monitoring location"),
        ])
        notes = "".join(
            "<li><strong>" + esc(note.get("code", "Source note")) + "</strong><p>" +
            esc(note.get("context", json.dumps(note, ensure_ascii=False))) + "</p></li>"
            for note in context["source_notes"]
        )
        visuals = "".join(
            "<p><strong>Table " + esc(item["visual_reading"]["source_table"]) + " visual reading:</strong> " +
            esc(item["visual_reading"]["result"]) + " Printed page " +
            esc(item["visual_reading"]["printed_page"]) + "; PDF page " +
            esc(item["visual_reading"]["pdf_viewer_page"]) + ".</p>"
            for item in context["visual_context"]
        )
        visuals += "".join(
            "<p>" + esc(item["numeric_consistency"]["interpretation"]) + "</p>"
            for item in context["visual_context"] if "numeric_consistency" in item
        )
        visuals += "".join(
            '<figure><img alt="' + esc(item["title"]) + '" src="' + esc(item["data_uri"]) +
            '" style="max-width:100%;height:auto"><figcaption>' + esc(item["title"]) + "</figcaption></figure>"
            for item in context.get("embedded_images", [])
        )
        permits = table("Permits identified in the published report", context["tables"].get("permits", []), [
            ("npdes_permit_id", "NPDES permit"), ("report_facility_name", "Reported facility"),
            ("edition", "Source edition"), ("source_pdf_page", "PDF page"),
        ])
        observations = context.get("observations", {})
        observed = table("Original activities and published summaries", observations.get("series", []), [
            ("site_id", "Station"), ("parameter", "Parameter"), ("unit", "Unit"),
            ("project_id", "Source project"), ("activity_type", "Original activity type"), ("sample_fraction", "Sample fraction"),
            ("result_value_type", "Original result type"), ("original_methods", "Analytical methods"), ("sample_support", "Sample support"),
            ("record_count", "Original rows"), ("activity_count", "Activities"),
            ("numeric_count", "Quantified"), ("censored_count", "Censored"),
            ("published_n", "Printed n"), ("mean", "Quantified mean"),
            ("sample_sd", "Quantified sample SD"), ("published_mean", "Printed mean"),
            ("published_sd", "Printed SD"), ("period_start", "First date"),
            ("period_end", "Last date"), ("depths_as_reported", "Original depths"),
        ])
        observed += "".join("<p class='meta'>" + esc(item["site_id"]) + " / " +
            esc(item["parameter"]) + ": " + esc(item["basis"]) + "</p>"
            for item in observations.get("series", []))
        observed += table("Original observation calendars and methods", observations.get("series", []), [
            ("site_id", "Station"), ("parameter", "Parameter"),
            ("missing_chlorophyll_dates", "Dates absent from the chlorophyll calendar"),
            ("additional_dates", "Additional dates"), ("original_methods", "Source methods"),
        ])
        observed += table("Original activity chronology", observations.get("rows", []), [
            ("site_id", "Station"), ("date", "Date"), ("local_time", "Local time"),
            ("source_timezone", "Source time zone"), ("project_id", "Source project"),
            ("activity_type", "Original activity type"), ("parameter_original", "Source parameter"),
            ("sample_fraction", "Sample fraction"), ("result_value_type", "Original result type"),
            ("method_authority", "Method authority"), ("method_id", "Method identifier"),
            ("method_specification_name", "Method specification"),
            ("original_result_identifier", "Original result identifier"),
            ("value", "Original value"), ("unit", "Unit"), ("detection_condition", "Detection"),
            ("detection_limit", "Limit"), ("detection_limit_unit", "Limit unit"),
            ("depth", "Depth"), ("depth_unit", "Depth unit"), ("activity_id", "Activity identifier"),
            ("result_comment", "Original result comment"),
            ("activity_comment", "Original activity comment"),
            ("laboratory_comment", "Original laboratory comment"),
        ])
        cohort = context.get("cohort_reconciliation")
        if cohort:
            observed += "<section><h2>Original chlorophyll cohort selection</h2><p>" + esc(cohort["cohort_basis"]) + (
                "</p><p>The same-date visit assignment is an inference from the publisher-displayed local clocks, routine-project records and reproduced report summaries. Original EST and EDT labels remain unchanged.</p>"
            )
            for evidence in cohort.get("exclusion_evidence", []):
                if evidence["site_id"] not in selection["site_ids"]:
                    continue
                observed += "<p>" + esc(evidence["site_id"]) + " on " + esc(evidence["date"]) + (
                    ": retained activity " + esc(evidence["retained_original_record"]["activity_id"]) +
                    "; separate routine activity " + esc(evidence["excluded_original_record"]["activity_id"]) +
                    ". " + esc(evidence["timezone_interpretation"]) + "</p>"
                )
            observed += "</section>"
        dated = context.get("dated_context", {})
        observed += table("Retained WQP source coverage", dated.get("coverage", []), [
            ("site_id", "Station"), ("project_id", "Source project"), ("characteristic", "Original characteristic"),
            ("sample_fraction", "Fraction"), ("reported_unit", "Source unit"), ("record_count", "Rows"),
            ("numeric_reported_count", "Numeric reported"), ("quantified_count", "Quantified"),
            ("censored_below_count", "Censored below"), ("censored_above_count", "Censored above"),
        ])
        observed += table("Original upstream flow context", dated.get("flow_rows", []), [
            ("sampling_date", "Sampling date"), ("gauge_id", "Upstream gauge"),
            ("same_date_mean_cfs", "Daily mean (ft3/s)"), ("same_date_qualifiers", "Agency qualifiers"),
            ("annual_flow_percentile_midrank", "Annual percentile"),
            ("prior_3d_mean_cfs", "Previous 3-day mean (ft3/s)"),
            ("prior_7d_mean_cfs", "Previous 7-day mean (ft3/s)"),
            ("prior_7d_maximum_daily_cfs", "Previous 7-day max (ft3/s)"),
            ("prior_7d_maximum_dates", "Maximum reporting dates"),
            ("prior_7d_valid_days", "Valid prior days"), ("prior_7d_expected_days", "Expected prior days"),
        ])
        observed += "<section><h2>Dated source context</h2>" + "".join(
            "<p>" + esc(note) + "</p>" for note in dated.get("selection_notes", [])
        ) + "<p>Selected activity dates outside the retained flow-date table: " + esc(
            ", ".join(dated.get("dates_without_flow_context", [])) or "none"
        ) + ".</p></section>"
        observed += support_report_html(context)
        related_reports = "".join('<p><a href="' + esc(item["filename"]) + '">' + esc(item["title"]) + "</a></p>" for item in context.get("related_reports", []))
        composed = context["record"].get("origin", {}).get("installed_context", [])
        if composed:
            related_reports += "<section><h2>Included study context</h2><ul>" + "".join(
                "<li>" + esc(item["manifest"]) + " · " + esc(item["native_entry_count"]) + " source entries</li>"
                for item in composed
            ) + "</ul></section>"
        figures = ""
        if context.get("scientific_figures"):
            figures = "<section><h2>Original scientific figures</h2><p>" + esc(FIGURE_SCOPE) + "</p>" + "".join(
                '<figure><img src="' + esc(item["filename"]) + '" alt="' + esc(item["title"]) +
                '" style="max-width:100%;height:auto"><figcaption>' + esc(item["title"]) + "</figcaption></figure>"
                for item in context["scientific_figures"]
            ) + "</section>"
        source_cohort = study.get("observation_calendar_filters") is True
        url = study.get("original_url", "")
        source_link = (
            '<a href="' + esc(url) + '">' + ("Original agency source query" if source_cohort else "Original publisher report") + "</a>"
            if url.startswith("https://") else esc(url)
        )
        return (
            "<!doctype html><html lang='en'><head><meta charset='utf-8'>"
            "<meta name='viewport' content='width=device-width,initial-scale=1'>"
            "<title>" + esc(study["title"]) + "</title>"
            "<style>body{font:14px/1.5 system-ui,sans-serif;color:#202327;background:#fff;max-width:1400px;margin:32px auto;padding:0 24px}"
            "h1{font-size:26px;line-height:1.25}h2{font-size:18px;margin-top:28px}p{max-width:1100px}"
            "table{border-collapse:collapse;width:100%;font-size:12px}th,td{border:1px solid #cbd0d4;padding:6px 8px;text-align:left;vertical-align:top}"
            "th{background:#eceff1}tr:nth-child(even){background:#f7f8f9}section{overflow:auto}a{color:#263d50}"
            ".meta{color:#515861}.source{border-left:3px solid #7e8790;padding-left:14px}"
            "@media print{body{margin:10mm;padding:0}table{font-size:9px}thead{display:table-header-group}tr{break-inside:avoid}section{overflow:visible}}</style>"
            "</head><body><header><p class='meta'>Published field study</p><h1>" + esc(study["title"]) + "</h1>"
            "<p>" + ("Original agency observations" if source_cohort else "Technical report " + esc(study.get("technical_report"))) + " · " + esc(study.get("publication")) + "</p>"
            "<p>Selected stations: " + esc(", ".join(selection["site_ids"])) +
            " · Parameters: " + esc(", ".join(selection["parameters"]) or "all") +
            " · Strata: " + esc(", ".join(selection["strata"]) or "all") + "</p>"
            "<p>" + ("Sampling-date selection: year " if source_cohort else "Continuous selection: year ") + esc(selection.get("year") or "all") +
            "; months " + esc(", ".join(map(str, selection.get("months", []))) or "all") +
            (". Original sampling dates define this selected cohort.</p>" if source_cohort else ". Seasonal statistics retain the complete published campaign.</p>") +
            "<p class='meta'>Study " + esc(context["record"]["study_id"]) + " · Version " +
            esc(context["record"]["version_id"]) + " · Source collection " +
            esc(context["record"]["source_collection_id"]) + "</p></header>"
            "<div class='source'><p>" + source_link + "</p><p>" +
            (esc(study.get("observation_scope", "")) if source_cohort else "Seasonal rows retain their original sample support, depths and concentration units. Monthly n values count days. Original numeric cells remain available in the accompanying CSV files.") +
            "</p>" + visuals + "</div>" +
            related_reports + ("" if source_cohort else seasonal) + observed + figures +
            ("" if source_cohort else monthly + ranges) + stations + ("" if source_cohort else permits) +
            "<section><h2>Source notes</h2><ul>" + notes + "</ul></section></body></html>"
        )


def main() -> None:
    parser = argparse.ArgumentParser(description="Import, select and export published measurement studies.")
    parser.add_argument("--application", required=True)
    parser.add_argument("--workspace", required=True)
    parser.add_argument("--storage")
    sub = parser.add_subparsers(dest="command", required=True)
    intake = sub.add_parser("import")
    intake.add_argument("source")
    intake.add_argument("--evidence", action="append", default=[], metavar="RELATIVE_NAME=FILE")
    intake.add_argument("--operation-id")
    intake.add_argument("--with-installed-context", action="store_true", help="Retain installed original study reports, cohorts and paired analyses with this source edition.")
    intake.add_argument("--context-manifest", action="append", type=Path, default=[], help="Add an exact application-root native study context manifest.")
    sub.add_parser("list")
    for name in ("get", "context", "export", "report"):
        child = sub.add_parser(name)
        child.add_argument("study_id")
        child.add_argument("--version")
        if name in ("context", "report"):
            child.add_argument("--site", action="append")
            child.add_argument("--parameter", action="append")
            child.add_argument("--stratum", action="append")
            child.add_argument("--year", type=int)
            child.add_argument("--month", action="append", type=int)
        if name in ("export", "report"):
            child.add_argument("--destination", required=True)
    args = parser.parse_args()
    sys.path.insert(0, str(Path(args.application).resolve()))
    from model.workspace import Workspace
    workspace = Workspace(Path(args.workspace), create=False)
    storage = args.storage or str(Path(args.workspace) / "published_studies")
    store = PublishedStudyStore(workspace, storage)
    if args.command == "import":
        evidence = {}
        for item in args.evidence:
            name, separator, filename = item.partition("=")
            if not separator:
                parser.error("--evidence requires RELATIVE_NAME=FILE")
            evidence[_name(name)] = Path(filename).read_bytes()
        context_manifests = list(args.context_manifest)
        context_manifests = list(dict.fromkeys(path.resolve() for path in context_manifests))
        result = store.import_source(
            args.source, evidence=evidence, operation_id=args.operation_id,
            context_manifests=context_manifests,
            context_application=args.application if args.with_installed_context else None,
        )
    elif args.command == "list":
        result = store.list_studies()
    elif args.command == "get":
        result = store.get_study(args.study_id, args.version)
    elif args.command == "export":
        result = store.export_study(args.study_id, args.destination, args.version)
    else:
        filters = {
            "site_ids": args.site, "parameters": args.parameter, "strata": args.stratum,
            "year": args.year, "months": args.month,
        }
        if args.command == "context":
            result = store.context(args.study_id, args.version, **filters)
        else:
            result = store.export_context(args.study_id, args.destination, args.version, **filters)
    print(json.dumps(result, ensure_ascii=False, allow_nan=False))


if __name__ == "__main__":
    main()
