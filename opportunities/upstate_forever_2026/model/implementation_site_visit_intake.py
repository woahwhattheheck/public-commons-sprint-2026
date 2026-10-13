"""Import original site/station and visit CSVs into one reviewed field-plan revision.

Both source files, exact row decisions and original coordinate/calendar context are
retained. Visits may bind to saved or same-batch sites by exact original source ID.
No coordinate transformation, timestamp inference or campaign mutation is performed.
"""
from __future__ import annotations

import copy
import datetime as dt
import hashlib
from pathlib import Path
import re

from .common import atomic_bytes, atomic_json, describe_file, digest, held
from .implementation import ImplementationStore
from .implementation_lab_results import _source, _cell
from .implementation_schema import (
    ID_RE, ImplementationError, RevisionConflict, ValidationError,
    canonical_bytes, document_digest, validate_plan,
)

EDITION = "site-visit-csv-20261013-v1"
MAPPING_SCHEMA = "upstate.implementation-site-visit-mapping/v1"
PREVIEW_SCHEMA = "upstate.implementation-site-visit-preview/v1"
IMPORT_SCHEMA = "upstate.implementation-site-visit-import/v1"
KINDS = ("sites", "visits")
FIELDS = {
    "sites": ("id", "label", "candidate_id", "source_ref", "latitude", "longitude",
              "coordinate_reference_system", "notes"),
    "visits": ("id", "site_id", "monitoring_plan_id", "planned_date", "visited_at",
               "visited_date", "visited_time", "utc_offset", "observer", "status", "notes"),
}
GEO_CRS = ("EPSG:4326", "EPSG:4269", "EPSG:4267", "EPSG:4258")
STATUSES = ("planned", "complete", "cancelled")
DATE_FORMATS = {"iso": "%Y-%m-%d", "mdy": "%m/%d/%Y", "dmy": "%d/%m/%Y"}
OFFSET_RE = re.compile(r"^(?:Z|[+-](?:0[0-9]|1[0-4]):[0-5][0-9])$")
NUMBER_RE = re.compile(r"^[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?$")


def _clone(value):
    return copy.deepcopy(value)


def _error(code, message, *, kind=None, record=None, severity="error", **detail):
    result = {"code": code, "message": message, "severity": severity}
    if kind is not None:
        result["kind"] = kind
    if record is not None:
        result["record"] = record
    return {**result, **detail}


def inspect_site_visit_csv(csv_path, *, delimiter=",", encoding="utf-8-sig", filename=None):
    source = _source(csv_path, delimiter=delimiter, encoding=encoding, filename=filename)
    return {"schema": "upstate.implementation-site-visit-inspect/v1",
            "source": source["source"], "headers": source["headers"],
            "row_count": len(source["rows"]), "sample_rows": source["rows"][:25],
            "sample_rows_truncated": len(source["rows"]) > 25,
            "record_numbering": "One-based nonblank data records after the original header; physical line spans retained"}


def _offset(value):
    if not isinstance(value, str) or not OFFSET_RE.fullmatch(value):
        raise ImplementationError("Select an explicit UTC offset Z or +/-HH:MM")
    if value[0:3] in ("+14", "-14") and value[4:] != "00":
        raise ImplementationError("An absolute 14-hour UTC offset must have zero minutes")
    return value


def _mapping(value, kind, headers, count):
    if not isinstance(value, dict):
        raise ImplementationError("Supply the explicit " + kind + " CSV mapping")
    known = {"schema", "delimiter", "encoding", "columns", "constants", "fallback_columns",
             "decimal_separator", "id_mode", "namespace", "coordinate_mode", "crs_values",
             "date_format", "time_zone_values", "status_values", "site_binding", "row_actions"}
    if set(value) - known:
        raise ImplementationError("Unknown site/visit mapping fields: " + ", ".join(sorted(set(value) - known)))
    if value.get("schema", MAPPING_SCHEMA) != MAPPING_SCHEMA:
        raise ImplementationError("The site/visit mapping schema differs")
    result = {
        "schema": MAPPING_SCHEMA, "delimiter": value.get("delimiter", ","),
        "encoding": value.get("encoding", "utf-8-sig"), "columns": {}, "constants": {},
        "fallback_columns": {}, "decimal_separator": value.get("decimal_separator", "."),
        "id_mode": value.get("id_mode", "native"), "namespace": value.get("namespace", ""),
        "coordinate_mode": value.get("coordinate_mode", "retain_only"),
        "crs_values": {}, "date_format": value.get("date_format", "iso"),
        "time_zone_values": {}, "status_values": {},
        "site_binding": value.get("site_binding", "native_id"), "row_actions": {},
    }
    options = {
        "decimal_separator": (".", ","), "id_mode": ("native", "stable", "source_record"),
        "coordinate_mode": ("geographic", "retain_only"),
        "date_format": tuple(DATE_FORMATS), "site_binding": ("native_id", "source_id"),
    }
    for key, choices in options.items():
        if result[key] not in choices:
            raise ImplementationError("Choose an explicit supported " + key)
    if not isinstance(result["namespace"], str) or "\0" in result["namespace"]:
        raise ImplementationError("The original ID namespace must be text")
    if result["id_mode"] != "native" and not result["namespace"].strip():
        raise ImplementationError("Stable or source-record IDs require an explicit original namespace")
    columns, constants = value.get("columns", {}), value.get("constants", {})
    if not isinstance(columns, dict) or not isinstance(constants, dict):
        raise ImplementationError("Columns and constants must be keyed objects")
    for field, header in columns.items():
        if field not in FIELDS[kind]:
            raise ImplementationError("Unknown " + kind + " target field: " + str(field))
        if header in ("", None):
            continue
        if not isinstance(header, str) or header not in headers:
            raise ImplementationError("Select an original CSV header for " + field)
        result["columns"][field] = header
    for field, constant in constants.items():
        if field not in FIELDS[kind] or field == "id" or not isinstance(constant, str):
            raise ImplementationError("Choose a supported non-ID text constant")
        if "\0" in constant or field in result["columns"]:
            raise ImplementationError("Choose one original column or constant for " + field)
        result["constants"][field] = constant
    fallbacks = value.get("fallback_columns", {})
    if not isinstance(fallbacks, dict):
        raise ImplementationError("Fallback columns must be explicit ordered header lists")
    for field, names in fallbacks.items():
        if (field not in result["columns"] or field in result["constants"]
                or not isinstance(names, list) or any(not isinstance(name, str) or name not in headers for name in names)
                or len(names) != len(set(names)) or result["columns"][field] in names):
            raise ImplementationError("Choose distinct original fallback columns for " + str(field))
        if names:
            result["fallback_columns"][field] = list(names)
    if result["id_mode"] != "source_record" and "id" not in result["columns"]:
        raise ImplementationError("Map the original ID, or explicitly choose IDs from exact source records")
    for field, allowed in (("crs_values", GEO_CRS), ("status_values", STATUSES)):
        aliases = value.get(field, {})
        if not isinstance(aliases, dict) or any(not isinstance(key, str) or target not in allowed
                                               for key, target in aliases.items()):
            raise ImplementationError("Choose explicit supported values for " + field)
        result[field] = dict(aliases)
    zones = value.get("time_zone_values", {})
    if not isinstance(zones, dict) or any(not isinstance(key, str) for key in zones):
        raise ImplementationError("Time-zone aliases must map original text to explicit fixed UTC offsets")
    result["time_zone_values"] = {key: _offset(offset) for key, offset in zones.items()}
    actions = value.get("row_actions", {})
    if not isinstance(actions, dict):
        raise ImplementationError("Row actions must use one-based original data-record numbers")
    for number, action in actions.items():
        if (not isinstance(number, str) or not re.fullmatch(r"[1-9][0-9]*", number)
                or int(number) > count or not isinstance(action, dict)
                or set(action) - {"action", "reason", "id", "target_id", "site_id"}):
            raise ImplementationError("A row action does not identify an original source record")
        chosen = action.get("action", "import")
        reason = action.get("reason", "")
        if chosen not in ("import", "skip", "replace") or not isinstance(reason, str):
            raise ImplementationError("Select import, skip or explicit replacement with its reason")
        overrides = [key for key in ("id", "target_id", "site_id") if key in action]
        if (chosen != "import" or overrides) and not reason.strip():
            raise ImplementationError("Record " + number + " needs the reason for its explicit decision")
        normalized = {"action": chosen, "reason": reason}
        for field in overrides:
            target = action[field]
            if not isinstance(target, str) or not ID_RE.fullmatch(target):
                raise ImplementationError("A row override must select an exact valid native ID")
            if field == "site_id" and kind != "visits":
                raise ImplementationError("Only a visit row has a site binding override")
            normalized[field] = target
        if chosen == "replace" and "target_id" not in normalized:
            raise ImplementationError("Choose the existing native ID to replace for record " + number)
        if chosen != "replace" and "target_id" in normalized:
            raise ImplementationError("A replacement target is only valid for explicit replacement")
        if chosen == "replace" and "id" in normalized and normalized["id"] != normalized["target_id"]:
            raise ImplementationError("The explicit replacement ID must equal its original target")
        result["row_actions"][number] = normalized
    return result


def _number(value, mapping, label):
    text = value.strip()
    if not text:
        return None
    if mapping["decimal_separator"] == ",":
        if "." in text:
            raise ImplementationError(label + " uses a dot although comma decimals were selected")
        text = text.replace(",", ".")
    elif "," in text:
        raise ImplementationError(label + " contains an unselected comma separator")
    if not NUMBER_RE.fullmatch(text):
        raise ImplementationError(label + " must be a finite original decimal number")
    number = float(text)
    import math
    if not math.isfinite(number):
        raise ImplementationError(label + " must be finite")
    return number


def _date(value, mapping, label):
    if not value.strip():
        return None
    text = value.strip()
    pattern = r"[0-9]{4}-[0-9]{2}-[0-9]{2}" if mapping["date_format"] == "iso" else r"[0-9]{1,2}/[0-9]{1,2}/[0-9]{4}"
    if not re.fullmatch(pattern, text):
        raise ImplementationError(label + " does not match the explicitly selected date format")
    try:
        return dt.datetime.strptime(text, DATE_FORMATS[mapping["date_format"]]).date().isoformat()
    except ValueError as error:
        raise ImplementationError(label + " is not a valid original calendar date") from error


class _IncompleteTime(ImplementationError):
    pass


def _timestamp(cells, mapping):
    full = cells["visited_at"].strip()
    date_text, time_text = cells["visited_date"].strip(), cells["visited_time"].strip()
    offset_text = cells["utc_offset"]
    offset = mapping["time_zone_values"].get(offset_text, offset_text.strip())
    if offset:
        offset = _offset(offset)
    if full:
        if date_text or time_text:
            raise ImplementationError("Choose full visited_at or separate original date/time fields, not both")
        value = full
        if not re.search(r"(?:Z|[+-][0-9]{2}:[0-9]{2})$", value):
            if not offset:
                if not re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}(?::[0-9]{2}(?:\.[0-9]+)?)?", value):
                    raise ImplementationError("The original actual timestamp is not an ISO date/time")
                raise _IncompleteTime("The original date/time is retained without assigning an unstated UTC offset")
            value += offset
    elif date_text or time_text:
        if date_text:
            _date(date_text, mapping, "visited_date")
        if not date_text or not time_text or not offset:
            raise _IncompleteTime("Partial original date/time context is retained; no actual visited timestamp is inferred")
        value = _date(date_text, mapping, "visited_date") + "T" + time_text + offset
    else:
        return None
    if not re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}(?::[0-9]{2}(?:\.[0-9]+)?)?(?:Z|[+-][0-9]{2}:[0-9]{2})", value):
        raise ImplementationError("Use an actual ISO date/time with its recorded offset and no invented midnight")
    try:
        parsed = dt.datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as error:
        raise ImplementationError("The original visited timestamp is invalid") from error
    actual_offset = value[-6:] if not value.endswith("Z") else "Z"
    _offset(actual_offset)
    if offset:
        chosen = dt.datetime.fromisoformat("2000-01-01T00:00:00" + offset.replace("Z", "+00:00")).utcoffset()
        if parsed.utcoffset() != chosen:
            raise ImplementationError("The timestamp and separate original UTC offset disagree")
    return value


def _identifier(kind, cells, mapping, source, record, action):
    if action["action"] == "replace":
        return action["target_id"]
    if "id" in action:
        return action["id"]
    original = cells["id"]
    if mapping["id_mode"] == "source_record":
        binding = [kind, mapping["namespace"], source["sha256"], record]
        return ("site_" if kind == "sites" else "visit_") + digest(binding)[:24]
    if not original.strip():
        raise ImplementationError("The original identifier is blank; choose an explicit native override or source-record IDs")
    if mapping["id_mode"] == "stable":
        return ("site_" if kind == "sites" else "visit_") + digest([kind, mapping["namespace"], original])[:24]
    if not ID_RE.fullmatch(original):
        raise ImplementationError("The original ID is not a valid native ID; choose a reviewed override or namespace-derived IDs")
    return original


def _site_reference(raw, action, mapping, sites, source_sites):
    if "site_id" in action:
        selected = action["site_id"]
    elif mapping["site_binding"] == "source_id":
        choices = source_sites.get(raw, set())
        if len(choices) != 1:
            raise ImplementationError("The original site identifier does not resolve to one accepted site in this batch; choose its native ID explicitly")
        selected = next(iter(choices))
    else:
        selected = raw
    if selected not in sites:
        raise ImplementationError("Select an actual existing or accepted batch site ID")
    return selected


def _same_content(left, right):
    # The original new source remains in the audit even when its native content
    # matches a saved row and that row keeps its earlier source binding.
    ignored = ("original_source", "original_station", "original_visit")
    return {key: value for key, value in left.items() if key not in ignored} == {
        key: value for key, value in right.items() if key not in ignored}


def _lineage(item, cells, selected, mapping, source_id, operation_id, source):
    return {
        "schema": "upstate.implementation-field-csv-row/v1",
        "source_link_id": source_id, "csv_sha256": source["sha256"],
        "original_identifier": cells["id"], "namespace": mapping["namespace"],
        "record": item["record"], "line_start": item["line_start"], "line_end": item["line_end"],
        "original_row": _clone(item["values"]), "original_headers": list(item["values"]),
        "cell_count": item["cell_count"], "extra_cells": list(item["extra_cells"]),
        "selected_columns": _clone(selected), "mapping_sha256": digest(mapping),
        "operation_id": operation_id,
    }


def _row(kind, item, mapping, source, source_id, operation_id, existing, sites, source_sites):
    cells, selected = {}, {}
    for field in FIELDS[kind]:
        cells[field], selected[field] = _cell(item, mapping, field)
    action = mapping["row_actions"].get(str(item["record"]), {"action": "import", "reason": ""})
    decision = {
        "kind": kind, "record": item["record"], "line_start": item["line_start"], "line_end": item["line_end"],
        "status": "skip" if action["action"] == "skip" else "error", "native_id": None,
        "original_identifier": cells["id"], "action": _clone(action),
        "selected_columns": selected, "row": None, "issues": [],
    }
    if action["action"] == "skip":
        return decision, None
    try:
        if item["cell_count"] != len(item["values"]):
            raise ImplementationError("The original data record has a different number of cells from its header")
        native_id = _identifier(kind, cells, mapping, source, item["record"], action)
        decision["native_id"] = native_id
        old = existing.get(native_id)
        if action["action"] == "replace" and old is None:
            raise ImplementationError("The explicit replacement target does not exist in this saved plan")
        row = _clone(old) if old is not None else {"id": native_id}
        mapped = set(mapping["columns"]) | set(mapping["constants"])
        lineage = _lineage(item, cells, selected, mapping, source_id, operation_id, source)
        if kind == "sites":
            if "label" in mapped or old is None:
                if not cells["label"].strip():
                    raise ImplementationError("A new or explicitly mapped site label must be nonblank")
                row["label"] = cells["label"]
            for field in ("candidate_id", "source_ref"):
                if field in mapped:
                    row[field] = cells[field] or None
            if old is None and "source_ref" not in mapped:
                row["source_ref"] = source_id
            if "notes" in mapped or old is None:
                row["notes"] = cells["notes"]
            lineage.update(
                original_latitude=cells["latitude"], original_longitude=cells["longitude"],
                original_coordinate_reference_system=cells["coordinate_reference_system"],
                coordinate_mode=mapping["coordinate_mode"])
            if mapping["coordinate_mode"] == "geographic":
                has_coordinate_fields = bool({"latitude", "longitude", "coordinate_reference_system"} & mapped)
                if has_coordinate_fields:
                    if not {"latitude", "longitude"} <= mapped:
                        raise ImplementationError("Map the original latitude and longitude together")
                    latitude = _number(cells["latitude"], mapping, "latitude")
                    longitude = _number(cells["longitude"], mapping, "longitude")
                    if (latitude is None) != (longitude is None):
                        raise ImplementationError("Original latitude and longitude must be present or absent together")
                    if latitude is not None:
                        if not -90 <= latitude <= 90 or not -180 <= longitude <= 180:
                            raise ImplementationError("Original geographic degrees are outside latitude/longitude bounds")
                        crs = mapping["crs_values"].get(cells["coordinate_reference_system"],
                                                         cells["coordinate_reference_system"].strip())
                        if crs not in GEO_CRS:
                            raise ImplementationError("Explicitly select the original supported geographic CRS; the numeric range does not identify a datum")
                        row["coordinate_reference_system"] = crs
                    else:
                        row.pop("coordinate_reference_system", None)
                        decision["issues"].append(_error("missing_coordinates", "Both original coordinates are blank", severity="warning", kind=kind, record=item["record"]))
                    row["latitude"], row["longitude"] = latitude, longitude
                elif old is None:
                    row["latitude"], row["longitude"] = None, None
            else:
                if old is None:
                    row["latitude"], row["longitude"] = None, None
                if cells["latitude"].strip() or cells["longitude"].strip():
                    decision["issues"].append(_error(
                        "coordinates_retained_only",
                        "Original coordinate text is retained; native coordinates remain unchanged or absent because retain_only was selected",
                        severity="warning", kind=kind, record=item["record"]))
            row["original_station"] = _clone(item["values"])
        else:
            if "site_id" in mapped or "site_id" in action or old is None:
                row["site_id"] = _site_reference(cells["site_id"], action, mapping, sites, source_sites)
            if "monitoring_plan_id" in mapped:
                row["monitoring_plan_id"] = cells["monitoring_plan_id"] or None
            for field in ("observer", "notes"):
                if field in mapped or old is None:
                    row[field] = cells[field]
            if "evidence_refs" not in row:
                row["evidence_refs"] = []
            if "planned_date" in mapped:
                row["planned_date"] = _date(cells["planned_date"], mapping, "planned_date")
            timestamp_fields = {"visited_at", "visited_date", "visited_time", "utc_offset"}
            if timestamp_fields & mapped:
                try:
                    row["visited_at"] = _timestamp(cells, mapping)
                except _IncompleteTime as error:
                    row["visited_at"] = None
                    decision["issues"].append(_error(
                        "partial_actual_time", str(error), severity="warning", kind=kind, record=item["record"]))
            if "status" in mapped or old is None:
                status = mapping["status_values"].get(cells["status"], cells["status"].strip())
                if status not in STATUSES:
                    raise ImplementationError("Explicitly map status to planned, complete or cancelled")
                row["status"] = status
            if row.get("status") == "complete" and not row.get("visited_at"):
                raise ImplementationError("A completed visit requires its original actual timestamp; a date alone is not an observed time")
            row["original_visit"] = _clone(item["values"])
        row["original_source"] = lineage
        if old is not None:
            if _same_content(old, row):
                decision["status"] = "identical"
                row = _clone(old)
            elif action["action"] == "replace":
                decision["status"] = "replace"
            else:
                decision["row"] = row
                raise ImplementationError("This native ID already has different content; explicitly choose replacement or skip")
        else:
            decision["status"] = "append"
        decision["row"] = _clone(row)
        return decision, row
    except ImplementationError as error:
        decision["status"] = "error"
        decision["issues"].append(_error("row_conflict", str(error), kind=kind, record=item["record"]))
        return decision, None


def _bound(workspace, saved_plan):
    original = validate_plan(saved_plan)
    store = ImplementationStore(workspace)
    retained = store.get(original["id"], original["revision"])
    if document_digest(original) != document_digest(retained):
        raise ImplementationError("Select the exact original saved plan revision")
    return store, retained


def _inputs(inputs):
    if not isinstance(inputs, list) or not 1 <= len(inputs) <= 2:
        raise ImplementationError("Select one original site CSV, one visit CSV, or both")
    found = {}
    for item in inputs:
        if not isinstance(item, dict) or set(item) - {"kind", "path", "filename", "mapping"}:
            raise ImplementationError("Each original input needs kind, resolved path and explicit mapping")
        kind = item.get("kind")
        if kind not in KINDS or kind in found or "path" not in item:
            raise ImplementationError("Select at most one original CSV for each sites/visits collection")
        mapping_input = item.get("mapping")
        if not isinstance(mapping_input, dict):
            raise ImplementationError("Select the original " + kind + " mapping")
        source = _source(item["path"], delimiter=mapping_input.get("delimiter", ","),
                         encoding=mapping_input.get("encoding", "utf-8-sig"),
                         filename=item.get("filename"))
        if not source["rows"]:
            raise ImplementationError("The original " + kind + " CSV has no data records")
        mapping = _mapping(mapping_input, kind, source["headers"], len(source["rows"]))
        found[kind] = {"kind": kind, "source": source, "mapping": mapping}
    return [found[kind] for kind in KINDS if kind in found]


def _build(workspace, saved_plan, inputs):
    store, original = _bound(workspace, saved_plan)
    chosen = _inputs(inputs)
    binding = {"id": original["id"], "revision": original["revision"],
               "sha256": document_digest(original), "title": original["title"]}
    identity = {
        "schema": "upstate.implementation-site-visit-operation/v1", "edition": EDITION,
        "project_id": workspace.project["id"], "plan": binding,
        "sources": [{"kind": item["kind"], "source": item["source"]["source"]} for item in chosen],
        "mappings": {item["kind"]: item["mapping"] for item in chosen},
    }
    operation_id = digest(identity)
    plan = _clone(original)
    indexes = {kind: {row["id"]: row for row in original[kind]} for kind in KINDS}
    changes = {kind: {} for kind in KINDS}
    decisions, issues, source_ids, retained_sources = [], [], {}, []
    source_sites = {}
    # Follow-up visit files can name exact identifiers retained by an earlier
    # site import. A shared identifier across native sites remains ambiguous,
    # including when those sites came from different declared namespaces.
    for site in original["sites"]:
        lineage = site.get("original_source")
        identifier = lineage.get("original_identifier") if isinstance(lineage, dict) else None
        if isinstance(identifier, str) and identifier.strip():
            source_sites.setdefault(identifier, set()).add(site["id"])
    mapping_sha = digest(identity["mappings"])
    for selection in chosen:
        kind, source, mapping = selection["kind"], selection["source"], selection["mapping"]
        source_id = "field_csv_" + digest([original["id"], kind, source["source"]["sha256"], mapping])[:24]
        source_ids[kind] = source_id
        attachment = ("implementation/plans/" + original["id"] + "/attachments/" +
                      source["source"]["sha256"] + "-" + kind + "-original.csv")
        retained_sources.append({"kind": kind, "source": source, "source_id": source_id, "path": attachment})
        assigned = {}
        sites = {**indexes["sites"], **changes["sites"]}
        for item in source["rows"]:
            decision, row = _row(kind, item, mapping, source["source"], source_id,
                                 operation_id, indexes[kind], sites, source_sites)
            if row is not None:
                previous = assigned.get(row["id"])
                if previous is not None:
                    if _same_content(previous, row):
                        decision["status"] = "identical"
                        decision["issues"].append(_error(
                            "identical_in_batch", "The same native content appears earlier in this original batch; both rows remain in the audit",
                            kind=kind, record=item["record"], severity="warning"))
                    else:
                        decision["status"] = "error"
                        decision["issues"].append(_error(
                            "duplicate_native_id", "Two original batch rows assign different content to the same native ID",
                            kind=kind, record=item["record"]))
                        row = None
                if row is not None:
                    assigned[row["id"]] = row
                    if decision["status"] in ("append", "replace"):
                        changes[kind][row["id"]] = row
                    if kind == "sites" and decision["original_identifier"].strip():
                        source_sites.setdefault(decision["original_identifier"], set()).add(row["id"])
            decisions.append(decision)
            issues.extend(decision["issues"])
    for kind in KINDS:
        plan[kind] = [changes[kind].get(row["id"], row) for row in original[kind]]
        plan[kind].extend(row for key, row in changes[kind].items() if key not in indexes[kind])
    links = [{
        "id": item["source_id"], "kind": "local_file",
        "label": "Original " + item["kind"] + " CSV — " + item["source"]["source"]["filename"],
        "reference": item["path"], "sha256": item["source"]["source"]["sha256"],
        "size_bytes": item["source"]["source"]["bytes"],
        "original_filename": item["source"]["source"]["filename"],
    } for item in retained_sources]
    audit_id = "field_csv_audit_" + operation_id[:24]
    history = plan.get("field12_site_visit_imports", [])
    if not isinstance(history, list):
        issues.append(_error("history", "The original site/visit import history must be a list"))
    else:
        plan["field12_site_visit_imports"] = history + [{
            "schema": IMPORT_SCHEMA, "operation_id": operation_id,
            "base_revision": original["revision"], "base_document_digest": binding["sha256"],
            "applied_revision": original["revision"] + 1,
            "source_link_ids": list(source_ids.values()), "audit_source_link_id": audit_id,
            "mapping_sha256": mapping_sha,
            "source_sha256": {item["kind"]: item["source"]["source"]["sha256"] for item in retained_sources},
        }]
    # The temporary audit descriptor has valid structure; final exact bytes are
    # supplied after all row and whole-plan validation, without a self-reference.
    links.append({"id": audit_id, "kind": "local_file", "label": "Original site/visit CSV row decisions",
                  "reference": "implementation/plans/" + original["id"] + "/attachments/pending-site-visit-row-decisions.json",
                  "sha256": "0" * 64, "size_bytes": 0,
                  "original_filename": "site-visit-row-decisions.json"})
    existing_links = {row["id"]: row for row in plan["source_links"]}
    for link in links:
        if link["id"] in existing_links:
            if existing_links[link["id"]] != link:
                issues.append(_error("source_link_conflict", "An original source ID already names different source metadata", source_link_id=link["id"]))
        else:
            plan["source_links"].append(link)
    if not any(item["severity"] == "error" for item in issues):
        try:
            validate_plan(plan)
        except ValidationError as error:
            issues.extend(_error("plan_validation", message) for message in error.issues)
        except ImplementationError as error:
            issues.append(_error("plan_validation", str(error)))
    summary = {
        "record_count": len(decisions), "source_count": len(chosen),
        **{kind: {status: sum(row["kind"] == kind and row["status"] == status for row in decisions)
                  for status in ("append", "replace", "identical", "skip", "error")} for kind in KINDS},
        "error_count": sum(item["severity"] == "error" for item in issues),
        "warning_count": sum(item["severity"] == "warning" for item in issues),
        "site_count_before": len(original["sites"]), "site_count_after": len(plan["sites"]),
        "visit_count_before": len(original["visits"]), "visit_count_after": len(plan["visits"]),
    }
    audit = {"schema": "upstate.implementation-site-visit-row-audit/v1",
             "identity": identity, "operation_id": operation_id, "summary": summary,
             "sources": [{"kind": item["kind"], "headers": item["source"]["headers"],
                          "source": item["source"]["source"],
                          "rows": item["source"]["rows"]} for item in chosen],
             "decisions": decisions, "issues": issues}
    audit_bytes = canonical_bytes(audit) + b"\n"
    audit_sha = hashlib.sha256(audit_bytes).hexdigest()
    audit_path = ("implementation/plans/" + original["id"] + "/attachments/" +
                  audit_sha + "-site-visit-row-decisions.json")
    for row in plan["source_links"]:
        if row["id"] == audit_id:
            row.update(reference=audit_path, sha256=audit_sha, size_bytes=len(audit_bytes))
    # Historical source checks use the final audit descriptor. A temporary
    # placeholder would falsely reject replay against its already committed audit.
    if not any(item["severity"] == "error" for item in issues):
        try:
            # Admit the final original source descriptors through the same
            # evidence-package rules used by native and portable handover.
            from .implementation_evidence import _links as evidence_links
            evidence_links(plan)
            store._check_frozen_sources(original, plan)
        except ImplementationError as error:
            issues.append(_error("source_binding", str(error)))
            summary["error_count"] = sum(item["severity"] == "error" for item in issues)
            audit_bytes = canonical_bytes(audit) + b"\n"
            audit_sha = hashlib.sha256(audit_bytes).hexdigest()
            audit_path = ("implementation/plans/" + original["id"] + "/attachments/" +
                          audit_sha + "-site-visit-row-decisions.json")
            for row in plan["source_links"]:
                if row["id"] == audit_id:
                    row.update(reference=audit_path, sha256=audit_sha, size_bytes=len(audit_bytes))
    preview = {
        "schema": PREVIEW_SCHEMA, "edition": EDITION, "operation_id": operation_id,
        "plan": binding, "sources": [{"kind": item["kind"], "source": item["source"]["source"],
                                      "headers": item["source"]["headers"]} for item in chosen],
        "mappings": identity["mappings"], "summary": summary, "decisions": decisions,
        "issues": issues, "can_import": summary["error_count"] == 0,
        "interpretation": {
            "coordinates": "Original geographic degrees retain their explicit source CRS; no coordinate transformation is performed",
            "timestamps": "Calendar date formats and actual UTC offsets are explicit; no midnight, timezone or daylight-saving inference",
            "identity": "Rows bind by original/native IDs or explicit source-record decisions, never matching by label",
            "replacement": "Unmapped existing optional fields remain; explicitly mapped blank fields may clear them",
        },
    }
    return {
        "store": store, "original": original, "plan": plan, "preview": preview,
        "identity": identity, "operation_id": operation_id, "sources": retained_sources,
        "source_ids": source_ids, "audit_id": audit_id, "audit_path": audit_path,
        "audit_bytes": audit_bytes,
    }


def preview_site_visit_intake(workspace, saved_plan, inputs):
    try:
        return _build(workspace, saved_plan, inputs)["preview"]
    except ImplementationError:
        raise
    except (ValueError, KeyError, TypeError, OSError) as error:
        raise ImplementationError("Site/visit CSV preview: " + str(error)) from error


def _matching_applied(context, record):
    actual = record["plan"]
    expected = _clone(context["plan"])
    expected["revision"], expected["updated_at"] = actual["revision"], actual["updated_at"]
    return (
        actual["revision"] == context["original"]["revision"] + 1
        and record["event"].get("operation") == "site_visit_csv_import"
        and record["event"].get("previous_document_digest") == document_digest(context["original"])
        and document_digest(actual) == document_digest(expected)
    )


def import_site_visit_intake(workspace, saved_plan, inputs, *, expected_operation_id, actor=""):
    try:
        context = _build(workspace, saved_plan, inputs)
        preview, store = context["preview"], context["store"]
        if not isinstance(expected_operation_id, str) or expected_operation_id != context["operation_id"]:
            raise ImplementationError("The saved revision, original CSVs or mapping changed; review this selection again")
        if not preview["can_import"]:
            raise ImplementationError("Resolve or explicitly skip conflicting source records before importing the batch")
        root = Path(workspace.root).resolve()
        directory = root / "implementation" / "site-visit-imports" / context["operation_id"]
        if directory.is_symlink() or not directory.resolve().is_relative_to(root):
            raise ImplementationError("The site/visit import directory must remain in its original Workspace")
        directory.mkdir(parents=True, exist_ok=True)
        with held(directory / "operation.lock"):
            with store._locked(context["original"]["id"]) as plan_directory:
                current_record = store._current_record(plan_directory)
                if current_record is None:
                    raise ImplementationError("The original plan has no saved revision")
                base_revision = context["original"]["revision"]
                applied_path = plan_directory / "revisions" / ("%016d.json" % (base_revision + 1))
                applied = store._read_record(applied_path) if applied_path.exists() else None
                reconnect = applied is not None and _matching_applied(context, applied)
                if not reconnect and current_record["plan"]["revision"] != base_revision:
                    raise RevisionConflict(context["original"]["id"], base_revision, current_record["plan"]["revision"])
                paths = []
                for item in context["sources"]:
                    path = root / item["path"]
                    if path.is_symlink() or not path.parent.resolve().is_relative_to(root):
                        raise ImplementationError("The original CSV attachment must remain inside its Workspace")
                    atomic_bytes(path, item["source"]["raw"], immutable=True)
                    paths.append(path)
                audit = root / context["audit_path"]
                if audit.is_symlink() or not audit.parent.resolve().is_relative_to(root):
                    raise ImplementationError("The original decision audit must remain inside its Workspace")
                atomic_bytes(audit, context["audit_bytes"], immutable=True)
                atomic_bytes(directory / "row-decisions.json", context["audit_bytes"], immutable=True)
                atomic_json(directory / "identity.json", context["identity"], immutable=True)
                atomic_json(directory / "preview.json", preview, immutable=True)
                paths.extend((audit, directory / "row-decisions.json",
                              directory / "identity.json", directory / "preview.json"))
                if reconnect:
                    saved = applied["plan"]
                else:
                    incoming = validate_plan(context["plan"])
                    store._check_frozen_sources(current_record["plan"], incoming)
                    saved = store._commit(
                        plan_directory, incoming, previous=current_record["plan"],
                        revision=base_revision + 1, operation="site_visit_csv_import", actor=actor)
                    current_record = {"plan": saved}
                receipt = {
                    "schema": IMPORT_SCHEMA, "edition": EDITION,
                    "operation_id": context["operation_id"], "plan_id": saved["id"],
                    "base_revision": base_revision, "applied_revision": saved["revision"],
                    "applied_document_digest": document_digest(saved),
                    "source_link_ids": context["source_ids"], "audit_source_link_id": context["audit_id"],
                    "sources": preview["sources"], "summary": preview["summary"],
                    "files": [describe_file(root, path) for path in paths],
                    "receipt_path": (directory / "import.json").relative_to(root).as_posix(),
                }
                atomic_json(directory / "import.json", receipt, immutable=True)
                return {**receipt, "status": "reconnected" if reconnect else "imported",
                        "plan": saved, "current_revision": current_record["plan"]["revision"]}
    except ImplementationError:
        raise
    except (ValueError, KeyError, TypeError, OSError) as error:
        raise ImplementationError("Site/visit CSV import: " + str(error)) from error
