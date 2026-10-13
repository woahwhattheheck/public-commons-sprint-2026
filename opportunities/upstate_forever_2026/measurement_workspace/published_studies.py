"""Published field-study context for the maintained measurement workspace.

Original tables remain source documents. This store gives those documents a
typed, filterable view with durable Workspace source selectors and export.
"""
from __future__ import annotations

import argparse
import base64
import csv
import hashlib
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
    package = _json(data)
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
        "operation_id": package.get("operation_id"),
    }


def companion_from_directory(directory: Path) -> tuple[dict[str, bytes], dict[str, Any]]:
    directory = directory.resolve(strict=True)
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
        tables = {
            name: _csv_rows(files[filename], name)
            for name, filename in TABLE_FILES.items() if filename in files
        }
        station_ids = [row["site_id"] for row in tables["stations"]]
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
                    "counts": {name: len(rows) for name, rows in tables.items()},
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
        if not record.get("source_collection_id"):
            manifest_entries = []
            source_entries = {}
            for entry in entries:
                name = entry["path"]
                suffix = PurePosixPath(name).suffix.lower()
                if suffix not in (".csv", ".json", ".md", ".pdf", ".png", ".jpg", ".jpeg"):
                    continue
                source_id = "study-" + _hash(name.encode("utf-8"))[:16]
                source_entries[name] = source_id
                kind = "table" if suffix == ".csv" else "document"
                manifest_entries.append({
                    "id": source_id,
                    "title": f"{study['title']} / {PurePosixPath(name).name}",
                    "uri": study.get("original_url", ""),
                    "vintage": study.get("publication", ""),
                    "kind": kind,
                    "path": "source/" + name,
                    "sha256": entry["sha256"],
                    "metadata": {
                        "study_id": study_id,
                        "study_version_id": version_id,
                        "source_relative_path": name,
                        "observation_support": "published_study_context",
                        "source_pdf_page_numbering": "one_based_viewer_page",
                    },
                })
            source_manifest = {
                "schema": "upstate.sources/v1",
                "title": study["title"],
                "entries": manifest_entries,
            }
            manifest_path = final / "sources.json"
            _atomic(manifest_path, _json_bytes(source_manifest))
            collection = self.workspace.import_sources(manifest_path)
            manifest_bytes = manifest_path.read_bytes()
            record["source_manifest"] = {
                "path": str(manifest_path.resolve()), "bytes": len(manifest_bytes),
                "sha256": _hash(manifest_bytes), "schema": "upstate.sources/v1",
            }
            record["source_collection_id"] = collection["id"]
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
        visual = []
        for entry in record["source_files"]:
            if entry["path"].endswith(".json") and (
                "visual" in entry["path"] or "table7" in entry["path"]
            ):
                value = _json(original(entry["path"]))
                if isinstance(value, dict) and value.get("schema") == "upstate.published-study-visual-context/v1":
                    visual.append(value)
        return {
            "record": record, "study": study, "tables": tables,
            "source_notes": notes, "visual_context": visual,
            "unit_definitions": UNIT_DEFINITIONS,
            "source_artifacts": [
                {**entry, "source_selector": {
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
        stations = complete["tables"]["stations"]
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
            "source_notes": relevant_notes,
            "visual_context": [
                item for item in complete["visual_context"]
                if not parameter_set or item.get("summary_contract", {}).get("parameter") in parameter_set
            ],
            "source_artifacts": complete["source_artifacts"],
            "temporal_support": {
                "seasonal": complete["study"].get("grab_sampling", {}),
                "continuous": complete["study"].get("continuous", {}),
                "month_filter_applies_to": ["monthly_do", "monthly_ph"],
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
        report_context = dict(context)
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
        return {
            "directory": str(destination.resolve()),
            "files": [
                {"filename": path.name, "path": str(path.resolve()), "bytes": path.stat().st_size,
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
            if field == "sd" and row.get("sd_published_token"):
                return row["sd_published_token"]
            if field == "minimum" and row.get("minimum_qualifier") == "below_detection_limit":
                return "< " + str(row.get("minimum_detection_limit"))
            return row.get("raw_cells", {}).get(field, row.get(field))

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
        url = study.get("original_url", "")
        source_link = (
            '<a href="' + esc(url) + '">Original publisher report</a>'
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
            "<p>Technical report " + esc(study.get("technical_report")) + " · " + esc(study.get("publication")) + "</p>"
            "<p>Selected stations: " + esc(", ".join(selection["site_ids"])) +
            " · Parameters: " + esc(", ".join(selection["parameters"]) or "all") +
            " · Strata: " + esc(", ".join(selection["strata"]) or "all") + "</p>"
            "<p>Continuous selection: year " + esc(selection.get("year") or "all") +
            "; months " + esc(", ".join(map(str, selection.get("months", []))) or "all") +
            ". Seasonal statistics retain the complete published campaign.</p>"
            "<p class='meta'>Study " + esc(context["record"]["study_id"]) + " · Version " +
            esc(context["record"]["version_id"]) + " · Source collection " +
            esc(context["record"]["source_collection_id"]) + "</p></header>"
            "<div class='source'><p>" + source_link + "</p><p>Seasonal rows retain their original sample support, "
            "depths and concentration units. Monthly n values count days. Original numeric cells remain available "
            "in the accompanying CSV files.</p>" + visuals + "</div>" +
            seasonal + monthly + ranges + stations + permits +
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
        result = store.import_source(args.source, evidence=evidence, operation_id=args.operation_id)
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
