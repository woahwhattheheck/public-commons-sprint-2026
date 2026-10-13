"""Source-registered WQP observation cohorts for Published studies.

The source index lists original CSVs. Records preserve all source cells and use
the existing native observation parser; no replacement concentration is assigned.
"""
from __future__ import annotations
import hashlib
import json
from pathlib import PurePosixPath

INDEX = "observation-sources.json"
SCHEMA = "upstate.observation-sources/v1"
SERIES_FIELDS = ("sample_fraction", "method_authority", "method_id",
                 "result_value_type", "result_weight_basis", "result_time_basis",
                 "result_temperature_basis", "result_particle_size_basis", "support_unit")


def _path(value):
    if not isinstance(value, str) or not value or "\\" in value or "\x00" in value:
        raise ValueError("Observation sources require safe relative paths.")
    path = PurePosixPath(value)
    if path.is_absolute() or ".." in path.parts or str(path) != value or value == ".":
        raise ValueError("Observation sources must remain in the study directory.")
    return value


def source_paths(index):
    if not isinstance(index, dict) or index.get("schema") != SCHEMA:
        raise ValueError("Unsupported original-observation source index.")
    entries = index.get("sources")
    if not isinstance(entries, list) or not entries:
        raise ValueError("The observation source index must identify original CSVs.")
    paths = [_path(entry["path"]) for entry in entries]
    if len(paths) != len(set(paths)):
        raise ValueError("Original observation CSV paths must be unique.")
    return paths


def load_observations(files, parser):
    if INDEX not in files:
        return None
    index = json.loads(files[INDEX].decode("utf-8-sig"))
    paths = source_paths(index)
    selected, intervals = [], []
    for entry, path in zip(index["sources"], paths):
        if entry.get("format") != "wqp-result-csv":
            raise ValueError("The registered observation reader expects original WQP Result CSV.")
        data = files[path]
        sha = hashlib.sha256(data).hexdigest()
        if entry.get("sha256") != sha or entry.get("bytes") != len(data):
            raise ValueError("Original observation source bytes changed: " + path)
        first, last = entry.get("date_start"), entry.get("date_end")
        if not isinstance(first, str) or not isinstance(last, str) or first > last:
            raise ValueError("Observation queries must retain their date interval.")
        declared = entry.get("station_ids")
        if declared is not None:
            if (not isinstance(declared, list) or not declared
                    or any(not isinstance(value, str) or not value for value in declared)
                    or len(set(declared)) != len(declared)):
                raise ValueError("An observation station scope requires distinct original IDs.")
            scope = set(declared)
        else:
            scope = None
        for start, end, previous_scope in intervals:
            if first <= end and last >= start and (
                    scope is None or previous_scope is None or not scope.isdisjoint(previous_scope)):
                raise ValueError("Overlapping observation dates require disjoint declared station scopes.")
        intervals.append((first, last, scope))
        rows = parser(data, path, raw_wqp=True)
        if len(rows) != entry.get("record_count"):
            raise ValueError("Original observation source row count changed: " + path)
        if scope is not None and {row["monitoring_location_id"] for row in rows} != scope:
            raise ValueError("Original observation rows differ from their declared station scope.")
        sample_support = index.get("sample_support", "Original stream sampling activities")
        if not isinstance(sample_support, str) or not sample_support.strip():
            raise ValueError("Original observation sampling support must be named.")
        for row in rows:
            raw = row["raw_cells"]
            if not first <= row["date"] <= last:
                raise ValueError("An original result falls outside its source query interval.")
            row.update(
                original_source_path=path, original_source_sha256=sha,
                original_source_record_index=row["source_csv_row"] - 2,
                original_source_url=entry.get("source_url", ""),
                result_value_type=raw.get("ResultValueTypeName", ""),
                result_weight_basis=raw.get("ResultWeightBasisText", ""),
                result_time_basis=raw.get("ResultTimeBasisText", ""),
                result_temperature_basis=raw.get("ResultTemperatureBasisText", ""),
                result_particle_size_basis=raw.get("ResultParticleSizeBasisText", ""),
                support_unit=row["unit"] or row["detection_limit_unit"],
                source_observation=True,
                source_sample_support=sample_support,
            )
            row["series_key"] = json.dumps(
                [row.get(key, "") for key in SERIES_FIELDS],
                ensure_ascii=False, separators=(",", ":"))
            row["original_record_id"] = row["record_id"]
            selected.append(row)
    if len(selected) != index.get("record_count"):
        raise ValueError("Original observation cohort count changed.")
    activities = {(row["monitoring_location_id"], row.get("project_id", ""), row["activity_id"])
                  for row in selected}
    if len(activities) != index.get("activity_count"):
        raise ValueError("Original observation activity count changed.")
    return selected


def filter_calendar(rows, study, year=None, months=()):
    if study.get("observation_calendar_filters") is not True:
        return rows
    return [row for row in rows
            if (year is None or int(row["date"][:4]) == year)
            and (not months or int(row["date"][5:7]) in months)]


def series_metadata(records):
    if not records or not records[0].get("source_observation"):
        return {}
    first = records[0]
    return {"series_key": first["series_key"], "source_observation": True,
            "source_sample_support": first.get("source_sample_support", "Original sampling activities"),
            **{key: first.get(key, "") for key in SERIES_FIELDS},
            "series_dimensions": list(SERIES_FIELDS)}


def observation_files(original, available):
    """Read only registered original CSVs, after the existing source integrity check."""
    if INDEX not in available:
        return {}
    body = original(INDEX)
    index = json.loads(body.decode("utf-8-sig"))
    return {INDEX: body, **{path: original(path) for path in source_paths(index)}}


def builtin_companion(root):
    """Read a complete installed source set using exact declared file identities."""
    root = root.resolve(strict=True)
    inventory_bytes = (root / "study-files.json").read_bytes()
    manifest = json.loads(inventory_bytes.decode("utf-8-sig"))
    if manifest.get("schema") != "upstate.study-file-inventory/v1":
        raise ValueError("Unsupported installed study file inventory.")
    files, seen = [], set()
    for entry in manifest.get("files", []):
        name = _path(entry["path"])
        if name in seen:
            raise ValueError("Installed study source paths must be unique.")
        seen.add(name)
        path = (root / name).resolve(strict=True)
        if not path.is_relative_to(root) or not path.is_file():
            raise ValueError("Installed study source must remain in its directory.")
        raw = path.read_bytes()
        if len(raw) != entry.get("bytes") or hashlib.sha256(raw).hexdigest() != entry.get("sha256"):
            raise ValueError("Installed study source bytes changed: " + name)
        files.append({**entry, "encoding": "utf-8", "content": raw.decode("utf-8")})
    if not {"study.json", "stations.csv", "seasonal_summaries.csv", "source_notes.json", INDEX}.issubset(seen):
        raise ValueError("The installed observation cohort is incomplete.")
    if "study-files.json" in seen:
        raise ValueError("The installed study inventory must not recursively list itself.")
    files.append({"path": "study-files.json", "encoding": "utf-8",
                  "bytes": len(inventory_bytes), "sha256": hashlib.sha256(inventory_bytes).hexdigest(),
                  "content": inventory_bytes.decode("utf-8")})
    return json.dumps({"schema": "upstate.published-study-files/v1", "files": files},
                      ensure_ascii=False).encode("utf-8"), {}
