"""Join original WQP NarrowResult rows to exact activity and limit source records.

The parser receives a temporary joined view. Its raw cells and record selectors
are restored to the unchanged NarrowResult body before leaving this adapter.
"""
from __future__ import annotations

import csv
import hashlib
import io
import json
from pathlib import PurePosixPath

FORMAT = "wqp-narrow-result-csv"
ACTIVITY_ROLE = "wqp-activity-csv"
LIMIT_ROLE = "wqp-result-limit-csv"
ACTIVITY_FIELDS = (
    "ProjectIdentifier", "ActivityTypeCode", "ActivityCommentText",
    "ActivityDepthHeightMeasure/MeasureValue", "ActivityDepthHeightMeasure/MeasureUnitCode",
)
LIMIT_FIELDS = (
    "DetectionQuantitationLimitTypeName",
    "DetectionQuantitationLimitMeasure/MeasureValue",
    "DetectionQuantitationLimitMeasure/MeasureUnitCode",
)
ACTIVITY_IDENTITY = (
    "OrganizationIdentifier", "MonitoringLocationIdentifier", "ActivityIdentifier",
    "ActivityStartDate", "ActivityStartTime/Time", "ActivityStartTime/TimeZoneCode",
)
LIMIT_IDENTITY = (
    "OrganizationIdentifier", "MonitoringLocationIdentifier", "ActivityIdentifier",
    "ResultIdentifier", "CharacteristicName",
)


def _path(value):
    if not isinstance(value, str) or not value or "\\" in value or "\0" in value:
        raise ValueError("WQP metadata sources require portable relative paths.")
    parsed = PurePosixPath(value)
    if parsed.is_absolute() or ".." in parsed.parts or str(parsed) != value or value == ".":
        raise ValueError("WQP metadata sources must remain within the retained study.")
    return value


def metadata_entries(entry):
    if entry.get("format") != FORMAT:
        return ()
    sources = entry.get("metadata_sources")
    if not isinstance(sources, list) or len(sources) != 2:
        raise ValueError("NarrowResult intake requires original activity and limit sources.")
    if {item.get("role") for item in sources} != {ACTIVITY_ROLE, LIMIT_ROLE}:
        raise ValueError("NarrowResult metadata must declare activity and result-limit roles.")
    paths = [_path(item.get("path")) for item in sources]
    if len(set(paths)) != 2 or entry.get("path") in paths:
        raise ValueError("NarrowResult metadata sources must have distinct original paths.")
    return tuple(sources)


def _csv(data, required):
    reader = csv.DictReader(io.StringIO(data.decode("utf-8-sig"), newline=""))
    headers = reader.fieldnames or []
    if not headers or len(headers) != len(set(headers)) or not set(required).issubset(headers):
        raise ValueError("An original WQP profile has incompatible source fields.")
    rows = list(reader)
    if any(None in row or any(value is None for value in row.values()) for row in rows):
        raise ValueError("An original WQP profile contains a malformed CSV row.")
    return headers, rows


def _metadata(files, descriptor, key, required):
    path = _path(descriptor["path"])
    data = files[path]
    sha = hashlib.sha256(data).hexdigest()
    if descriptor.get("bytes") != len(data) or descriptor.get("sha256") != sha:
        raise ValueError("Original WQP metadata bytes changed: " + path)
    unused, records = _csv(data, required)
    if descriptor.get("record_count") != len(records):
        raise ValueError("Original WQP metadata row count changed: " + path)
    indexed = {}
    for number, row in enumerate(records, 2):
        identifier = row[key]
        if not identifier or identifier in indexed:
            raise ValueError("Original WQP metadata requires unique nonempty " + key)
        indexed[identifier] = (row, {
            "source_file": path, "source_csv_row": number,
            "sha256": sha, "source_url": descriptor.get("source_url", ""),
            "join_key": key, "join_value": identifier, "raw_cells": dict(row),
        })
    return indexed


def parse_narrow_results(files, entry, parser):
    """Parse every original result; attach source-bound exact-ID metadata joins."""
    path = _path(entry["path"])
    metadata = {item["role"]: item for item in metadata_entries(entry)}
    activities = _metadata(files, metadata[ACTIVITY_ROLE], "ActivityIdentifier",
                           (*ACTIVITY_IDENTITY, *ACTIVITY_FIELDS))
    limits = _metadata(files, metadata[LIMIT_ROLE], "ResultIdentifier",
                       (*LIMIT_IDENTITY, *LIMIT_FIELDS))
    headers, originals = _csv(files[path], (
        *ACTIVITY_IDENTITY, "ResultIdentifier", "CharacteristicName",
        "ResultDetectionConditionText", "ResultMeasureValue",
    ))
    joined, lineage, identifiers = [], [], set()
    for original in originals:
        result_id = original["ResultIdentifier"]
        if not result_id or result_id in identifiers:
            raise ValueError("Original NarrowResult identifiers must be distinct.")
        identifiers.add(result_id)
        activity, activity_ref = activities.get(original["ActivityIdentifier"], (None, None))
        if activity is None or any(activity[key] != original[key] for key in ACTIVITY_IDENTITY):
            raise ValueError("A NarrowResult activity does not match its exact original metadata.")
        limit, limit_ref = limits.get(result_id, (None, None))
        if limit is not None and any(limit[key] != original[key] for key in LIMIT_IDENTITY):
            raise ValueError("A NarrowResult limit does not match its exact original result.")
        if limit is None and original["ResultDetectionConditionText"]:
            raise ValueError("A qualified NarrowResult requires its original reporting-limit row.")
        enrichment = {key: activity[key] for key in ACTIVITY_FIELDS}
        enrichment.update({key: limit[key] if limit is not None else "" for key in LIMIT_FIELDS})
        for key, value in enrichment.items():
            if key in original and original[key] != value:
                raise ValueError("Original WQP profile fields disagree at " + key)
        joined.append({**original, **enrichment})
        lineage.append({"activity": activity_ref, **({"reporting_limit": limit_ref} if limit_ref else {})})
    fields = headers + [key for key in (*ACTIVITY_FIELDS, *LIMIT_FIELDS) if key not in headers]
    output = io.StringIO(newline="")
    writer = csv.DictWriter(output, fieldnames=fields, lineterminator="\n")
    writer.writeheader()
    writer.writerows(joined)
    parsed = parser(output.getvalue().encode("utf-8"), path, raw_wqp=True)
    if len(parsed) != len(originals):
        raise ValueError("The native reader did not preserve all original NarrowResult rows.")
    for number, (row, original, references) in enumerate(zip(parsed, originals, lineage), 2):
        row["raw_cells"] = original
        row["original_result_identifier"] = original["ResultIdentifier"]
        row["metadata_source_records"] = references
        row["source_profile"] = "narrowResult"
        row["method_specification_name"] = original.get("MethodSpecificationName", "")
        row["result_depth_token"] = original.get("ResultDepthHeightMeasure/MeasureValue", "")
        row["result_depth_unit"] = original.get("ResultDepthHeightMeasure/MeasureUnitCode", "")
        row["depth_source_basis"] = "Original activity metadata; result depth remains separately retained."
        identity = json.dumps({"source": path, "row": number, "cells": original},
                              ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
        row["record_id"] = "observed-row-" + hashlib.sha256(identity).hexdigest()[:24]
    return parsed
