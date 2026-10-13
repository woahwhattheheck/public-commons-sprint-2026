"""Source-registered WQP observation cohorts for Published studies.

The source index lists original CSVs. Records preserve all source cells and use
the existing native observation parser; no replacement concentration is assigned.
"""
from __future__ import annotations
import hashlib
import csv
import io
import json
from pathlib import PurePosixPath

if __package__:
    from .wqp_profiles import FORMAT as NARROW_FORMAT, metadata_entries, parse_narrow_results
else:
    from wqp_profiles import FORMAT as NARROW_FORMAT, metadata_entries, parse_narrow_results

INDEX = "observation-sources.json"
SCHEMA = "upstate.observation-sources/v1"
SERIES_FIELDS = ("sample_fraction", "method_authority", "method_id",
                 "result_value_type", "result_weight_basis", "result_time_basis",
                 "result_temperature_basis", "result_particle_size_basis", "support_unit",
                 "method_specification_name")


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
        if entry.get("format") not in ("wqp-result-csv", NARROW_FORMAT):
            raise ValueError("The registered observation reader expects original WQP Result or NarrowResult CSV.")
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
        declared_characteristics = entry.get("characteristics")
        if declared_characteristics is not None:
            if (not isinstance(declared_characteristics, list) or not declared_characteristics
                    or any(not isinstance(value, str) or not value for value in declared_characteristics)
                    or len(set(declared_characteristics)) != len(declared_characteristics)):
                raise ValueError("An observation characteristic scope requires distinct original names.")
            characteristics = set(declared_characteristics)
        else:
            characteristics = None
        for start, end, previous_scope, previous_characteristics in intervals:
            separated_stations = scope is not None and previous_scope is not None and scope.isdisjoint(previous_scope)
            separated_characteristics = (characteristics is not None and previous_characteristics is not None
                                         and characteristics.isdisjoint(previous_characteristics))
            if first <= end and last >= start and not (separated_stations or separated_characteristics):
                raise ValueError("Overlapping observation dates require disjoint station or characteristic scopes.")
        intervals.append((first, last, scope, characteristics))
        rows = (parse_narrow_results(files, entry, parser) if entry.get("format") == NARROW_FORMAT
                else parser(data, path, raw_wqp=True))
        if characteristics is not None and {row["parameter_original"] for row in rows} != characteristics:
            raise ValueError("Original observation rows differ from their declared characteristic scope.")
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
                method_specification_name=raw.get("MethodSpecificationName", ""),
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
    result_ids = [row["original_result_identifier"] for row in selected if row.get("original_result_identifier")]
    if len(result_ids) != len(set(result_ids)):
        raise ValueError("Original result identifiers must remain distinct across registered profiles.")
    activities = {(row["monitoring_location_id"], row.get("project_id", ""), row["activity_id"])
                  for row in selected}
    if len(activities) != index.get("activity_count"):
        raise ValueError("Original observation activity count changed.")
    if RESULT_SELECTION_INDEX in files:
        if SELECTION_INDEX in files:
            raise ValueError("Choose one original result or microbial selection per study.")
        return _result_selection_records(files, selected)
    return _selection_records(files, selected)



RESULT_SELECTION_INDEX = "result-selection.json"
RESULT_SELECTION_SCHEMA = "upstate.original-result-selection/v1"


def _result_selection_records(files, complete):
    """Select exact original results after verifying every retained source row."""
    selector = json.loads(files[RESULT_SELECTION_INDEX].decode("utf-8-sig"))
    if (not isinstance(selector, dict) or selector.get("schema") != RESULT_SELECTION_SCHEMA
            or selector.get("observation_index_sha256") != hashlib.sha256(files[INDEX]).hexdigest()):
        raise ValueError("The result selection must bind its complete original observation index.")
    for key in ("original_record_count", "record_count", "activity_count"):
        value = selector.get(key)
        if isinstance(value, bool) or not isinstance(value, int) or value < 1:
            raise ValueError("Result selection counts must be positive integers.")
    if selector["original_record_count"] != len(complete):
        raise ValueError("The result selection changes the complete original cohort count.")
    from datetime import date
    bounds = []
    for key in ("date_start", "date_end"):
        value = selector.get(key)
        if not isinstance(value, str):
            raise ValueError("The result selection must declare its original sampling interval.")
        try:
            parsed = date.fromisoformat(value)
        except ValueError as exc:
            raise ValueError("Result selection dates must be YYYY-MM-DD.") from exc
        if parsed.isoformat() != value:
            raise ValueError("Result selection dates must be YYYY-MM-DD.")
        bounds.append(value)
    first, last = bounds
    if first > last:
        raise ValueError("The result selection sampling interval is reversed.")
    available, source_rows = {}, set()
    for row in complete:
        identifier = row.get("original_result_identifier")
        key = (row["original_source_path"], row["source_csv_row"])
        if (not isinstance(identifier, str) or not identifier
                or identifier in available or key in source_rows):
            raise ValueError("Result selection requires distinct original result and source-row identities.")
        available[identifier] = row
        source_rows.add(key)
    declared = selector.get("records")
    if not isinstance(declared, list) or not declared:
        raise ValueError("Choose at least one original result.")
    identity_fields = ("original_source_path", "original_source_sha256", "source_csv_row",
                       "monitoring_location_id", "activity_id", "original_result_identifier")
    chosen = set()
    for reference in declared:
        if not isinstance(reference, dict):
            raise ValueError("Retain exact original result selectors.")
        identifier = reference.get("original_result_identifier")
        row = available.get(identifier) if isinstance(identifier, str) else None
        number = reference.get("source_csv_row")
        if (row is None or identifier in chosen or isinstance(number, bool)
                or not isinstance(number, int) or number < 2
                or any(reference.get(key) != row.get(key) for key in identity_fields)):
            raise ValueError("The selected result differs from its original source row.")
        if not first <= row["date"] <= last:
            raise ValueError("A selected original result lies outside the sampling interval.")
        chosen.add(identifier)
    result = [row for row in complete if row["original_result_identifier"] in chosen]
    activities = {(row["monitoring_location_id"], row.get("project_id", ""), row["activity_id"])
                  for row in result}
    if len(result) != selector["record_count"] or len(activities) != selector["activity_count"]:
        raise ValueError("Selected original result or activity counts differ.")
    return result

SELECTION_INDEX = "observation-selection.json"
SELECTION_SCHEMA = "upstate.original-observation-selection/v1"


def _same_source(left, right):
    if isinstance(left, bool) or isinstance(right, bool):
        return type(left) is type(right) and left == right
    if isinstance(left, (int, float)) and isinstance(right, (int, float)):
        return left == right
    if type(left) is not type(right):
        return False
    if isinstance(left, dict):
        return left.keys() == right.keys() and all(_same_source(left[key], right[key]) for key in left)
    if isinstance(left, list):
        return len(left) == len(right) and all(_same_source(a, b) for a, b in zip(left, right))
    return left == right


def _selection_member(files, descriptor):
    if not isinstance(descriptor, dict):
        raise ValueError("Retain every source-bound observation selection companion.")
    name = _path(descriptor.get("path"))
    body = files[name]
    if descriptor.get("bytes") != len(body) or descriptor.get("sha256") != hashlib.sha256(body).hexdigest():
        raise ValueError("An original observation selection companion changed: " + name)
    return body


def _selection_records(files, complete):
    """Apply a retained original-record selection after the whole index is verified."""
    if SELECTION_INDEX not in files:
        return complete
    selector = json.loads(files[SELECTION_INDEX].decode("utf-8-sig"))
    if (not isinstance(selector, dict) or selector.get("schema") != SELECTION_SCHEMA
            or selector.get("observation_index_sha256") != hashlib.sha256(files[INDEX]).hexdigest()
            or selector.get("original_record_count") != len(complete)):
        raise ValueError("The selected study must bind its complete original observation index.")
    source = selector.get("selection_source")
    if not isinstance(source, dict):
        raise ValueError("Retain the exported microbial selection as an original source.")
    name = _path(source.get("path"))
    body = files[name]
    if source.get("bytes") != len(body) or source.get("sha256") != hashlib.sha256(body).hexdigest():
        raise ValueError("The exported microbial selection bytes changed.")
    exported = json.loads(body.decode("utf-8-sig"))
    joined_source, context_source = selector.get("joined_source"), selector.get("context_source")
    joined_body = _selection_member(files, joined_source)
    context_body = _selection_member(files, context_source)
    if selector.get("report_binding") != context_source["sha256"] + ":" + joined_source["sha256"]:
        raise ValueError("The selection must bind its exact original joined observations and context.")
    reader = csv.DictReader(io.StringIO(joined_body.decode("utf-8-sig"), newline=""))
    fields = reader.fieldnames or []
    joined_rows = list(reader)
    if (not fields or len(fields) != len(set(fields)) or len(joined_rows) != len(complete)
            or any(None in row or any(value is None for value in row.values()) for row in joined_rows)):
        raise ValueError("Retain the complete original joined observation CSV.")
    joined_by_id = {row.get("activity_id"): row for row in joined_rows}
    if len(joined_by_id) != len(joined_rows) or set(joined_by_id) != {row["activity_id"] for row in complete}:
        raise ValueError("Joined observations differ from the complete original activity cohort.")
    coverage = json.loads(context_body.decode("utf-8-sig"))
    if (not isinstance(exported, dict) or exported.get("schema") != "upstate.microbial-source-selection/v1"
            or exported.get("binding") != selector.get("report_binding")
            or exported.get("review", {}).get("schema") != "upstate.microbial-source-review/v1"
            or exported.get("review", {}).get("binding") != selector.get("report_binding")):
        raise ValueError("The original observation selection and retained report binding differ.")
    declared = selector.get("records")
    if not isinstance(declared, list) or not declared:
        raise ValueError("Choose at least one distinct original observation record.")
    fields = ("original_source_path", "original_source_sha256", "source_csv_row",
              "monitoring_location_id", "activity_id", "original_record_id")
    available = {}
    for row in complete:
        key = (row["original_source_path"], row["source_csv_row"])
        if key in available:
            raise ValueError("Original observation source row identities must be unique.")
        available[key] = row
    chosen = {}
    for reference in declared:
        if not isinstance(reference, dict):
            raise ValueError("Retain exact original observation row selectors.")
        path = _path(reference.get("original_source_path"))
        number = reference.get("source_csv_row")
        if isinstance(number, bool) or not isinstance(number, int) or number < 2:
            raise ValueError("Original CSV row selectors are header-inclusive integers.")
        key = (path, number)
        row = available.get(key)
        if key in chosen or row is None or any(reference.get(field) != row.get(field) for field in fields):
            raise ValueError("The selected original source row differs from the complete cohort.")
        chosen[key] = row
    result = [row for row in complete if (row["original_source_path"], row["source_csv_row"]) in chosen]
    activities = [row["activity_id"] for row in result]
    exported_ids = exported.get("review", {}).get("selected_activity_ids")
    exported_rows = exported.get("observations")
    if (not isinstance(exported_ids, list) or not exported_ids
            or any(not isinstance(value, str) or not value for value in exported_ids)
            or len(exported_ids) != len(set(exported_ids))
            or set(exported_ids) != set(activities)
            or not isinstance(exported_rows, list)
            or len(exported_rows) != len(result)
            or any(not isinstance(row, dict) for row in exported_rows)
            or {row.get("activity_id") for row in exported_rows} != set(activities)
            or selector.get("record_count") != len(result)
            or selector.get("activity_count") != len(set(activities))):
        raise ValueError("Selected observations differ from the retained exported activities.")
    expected_rows = [row for row in joined_rows if row["activity_id"] in set(exported_ids)]
    stations = {row["station_id"] for row in expected_rows}
    if (exported_ids != [row["activity_id"] for row in expected_rows]
            or not _same_source(exported_rows, expected_rows)
            or not isinstance(coverage, dict)
            or not _same_source(exported.get("station_context"),
                [row for row in coverage["observed_station_context"] if row["observation_station_id"] in stations])
            or not _same_source(exported.get("assessment_context"),
                [row for row in coverage["matched_assessment_records"] if row["observation_station_id"] in stations])
            or not _same_source(exported.get("original_provenance"), coverage["provenance"])
            or not _same_source(exported.get("method"), coverage["method"])):
        raise ValueError("The retained selection changes original joined cells or source context.")
    exported_by_id = {row["activity_id"]: row for row in exported_rows}
    if len(exported_by_id) != len(exported_rows):
        raise ValueError("Exported activity rows must retain distinct original identities.")
    native_fields = {"activity_type": "ActivityTypeCode", "date": "ActivityStartDate",
                     "result_value": "ResultMeasureValue",
                     "limit_value": "DetectionQuantitationLimitMeasure/MeasureValue",
                     "source_result_unit": "ResultMeasure/MeasureUnitCode",
                     "source_limit_unit": "DetectionQuantitationLimitMeasure/MeasureUnitCode"}
    for row in result:
        exported_row = exported_by_id[row["activity_id"]]
        if (row["original_source_path"] != "original/" + _path(exported_row.get("source_file"))
                or str(row["source_csv_row"]) != exported_row.get("source_row")
                or row["monitoring_location_id"] != exported_row.get("station_id")
                or any(exported_row.get(key) != row["raw_cells"].get(field) for key, field in native_fields.items())):
            raise ValueError("The retained selection changes original observation values, support or row identity.")
    return result


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
    paths = set(source_paths(index))
    for entry in index["sources"]:
        paths.update(_path(item["path"]) for item in metadata_entries(entry))
    result = {INDEX: body, **{path: original(path) for path in sorted(paths)}}
    if RESULT_SELECTION_INDEX in available:
        result[RESULT_SELECTION_INDEX] = original(RESULT_SELECTION_INDEX)
    if SELECTION_INDEX in available:
        selection_body = original(SELECTION_INDEX)
        selector = json.loads(selection_body.decode("utf-8-sig"))
        source = selector.get("selection_source") if isinstance(selector, dict) else None
        if not isinstance(source, dict):
            raise ValueError("The selected study must retain its original selection source.")
        result[SELECTION_INDEX] = selection_body
        for key in ("selection_source", "joined_source", "context_source"):
            descriptor = selector.get(key)
            if not isinstance(descriptor, dict):
                raise ValueError("The selected study must retain every original selection companion.")
            name = _path(descriptor.get("path"))
            result[name] = original(name)
    return result


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
