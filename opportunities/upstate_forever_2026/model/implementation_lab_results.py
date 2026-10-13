"""Import an original laboratory/result CSV into one saved FIELD12 revision.

Column choices, type aliases, fallbacks and row decisions are explicit. Original
CSV bytes and the complete decision audit travel as local source attachments.
The original native store commits source links, results and selected missing
collection timestamps together in one immutable revision.
"""
from __future__ import annotations

import collections
import copy
import csv
import datetime as dt
import hashlib
import io
import math
from pathlib import Path
import re

from .common import atomic_bytes, atomic_json, describe_file, digest, held
from .implementation import ImplementationStore
from .implementation_schema import (
    ImplementationError, RevisionConflict, canonical_bytes, document_digest,
    validate_plan, ID_RE,
)

MAPPING_SCHEMA = "upstate.implementation-lab-mapping/v1"
PREVIEW_SCHEMA = "upstate.implementation-lab-preview/v1"
IMPORT_SCHEMA = "upstate.implementation-lab-import/v1"
EDITION = "laboratory-csv-20261013-v1"
MAX_SOURCE_BYTES = 64 * 1024 * 1024
RESULT_TYPES = ("numeric", "censored", "text", "missing")
COLUMN_FIELDS = (
    "activity_id", "sample_id", "site_id", "visit_id", "observation_id",
    "parameter", "original_text", "value", "result_type", "unit", "basis",
    "fraction", "qualifier", "detection_limit", "quantitation_limit",
    "method", "method_context", "method_name", "qa_status", "notes", "collected_at",
)
CONSTANT_FIELDS = frozenset((
    "activity_id", "sample_id", "site_id", "visit_id", "parameter", "result_type",
    "unit", "basis", "fraction", "qualifier", "method", "method_context", "method_name", "qa_status", "notes",
))
OBSERVATION_FIELDS = (
    "id", "activity_id", "parameter", "original_text", "value", "result_type",
    "unit", "basis", "fraction", "qualifier", "detection_limit",
    "quantitation_limit", "method", "qa_status", "notes",
)
METHOD_DEFINITION_FIELDS = ("method_context", "method_name")
OPTIONAL_TEXT = ("basis", "fraction", "qualifier", "method", "qa_status", *METHOD_DEFINITION_FIELDS)
ENCODINGS = ("utf-8-sig", "utf-8", "utf-16", "cp1252", "latin-1")
NUMBER = re.compile(r"^[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?$")


def _clone(value):
    return copy.deepcopy(value)


def _issue(code, message, *, severity="error", row=None, **extra):
    value = {"severity": severity, "code": code, "message": message}
    if row is not None:
        value.update(record=row["record"], line_start=row["line_start"], line_end=row["line_end"])
    value.update(extra)
    return value


def _source(path, *, delimiter=",", encoding="utf-8-sig", filename=None):
    if encoding not in ENCODINGS:
        raise ImplementationError("Choose an explicit supported CSV encoding: " + ", ".join(ENCODINGS))
    if not isinstance(delimiter, str) or len(delimiter) != 1 or delimiter in '\r\n\0"':
        raise ImplementationError("Choose one explicit CSV delimiter character")
    path = Path(path)
    if not path.is_file() or path.is_symlink():
        raise ImplementationError("Select the original uploaded CSV file")
    with path.open("rb") as handle:
        raw = handle.read(MAX_SOURCE_BYTES + 1)
    if not raw or len(raw) > MAX_SOURCE_BYTES:
        raise ImplementationError("The original laboratory CSV must be nonempty and at most 64 MiB")
    if b"\0" in raw and not encoding.startswith("utf-16"):
        raise ImplementationError("The selected encoding does not match this original CSV")
    try:
        text = raw.decode(encoding)
    except UnicodeError as error:
        raise ImplementationError("The original CSV cannot be decoded with the selected encoding") from error
    if "\0" in text:
        raise ImplementationError("The decoded laboratory CSV contains a NUL character")
    # The source itself is bounded; raising this process-wide limit monotonically
    # avoids truncating an original quoted field or lowering another parser's limit.
    if csv.field_size_limit() < MAX_SOURCE_BYTES:
        csv.field_size_limit(MAX_SOURCE_BYTES)
    reader = csv.reader(io.StringIO(text, newline=""), delimiter=delimiter, strict=True)
    headers, rows, previous = None, [], 0
    try:
        for cells in reader:
            line_start, line_end = previous + 1, reader.line_num
            previous = line_end
            if not cells:
                continue
            if headers is None:
                headers = cells
                if any(not value.strip() for value in headers) or len(headers) != len(set(headers)):
                    raise ImplementationError("Original CSV headers must be nonempty and distinct")
                continue
            values = {name: cells[index] if index < len(cells) else ""
                      for index, name in enumerate(headers)}
            rows.append({"record": len(rows) + 1, "line_start": line_start, "line_end": line_end,
                         "values": values, "cell_count": len(cells),
                         "extra_cells": cells[len(headers):]})
    except csv.Error as error:
        raise ImplementationError("Original CSV syntax at physical line " + str(reader.line_num) + ": " + str(error)) from error
    if headers is None:
        raise ImplementationError("The original CSV has no header")
    name = path.name if filename is None else filename
    if not isinstance(name, str) or not name.strip():
        raise ImplementationError("Retain the original uploaded filename")
    descriptor = {"filename": name, "bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest(),
                  "encoding": encoding, "delimiter": delimiter}
    return {"raw": raw, "source": descriptor, "headers": headers, "rows": rows}


def inspect_lab_csv(csv_path, *, delimiter=",", encoding="utf-8-sig", filename=None):
    """Read original headers and representative records before choosing a mapping."""
    source = _source(csv_path, delimiter=delimiter, encoding=encoding, filename=filename)
    return {"schema": "upstate.implementation-lab-inspect/v1", "source": source["source"],
            "headers": source["headers"], "row_count": len(source["rows"]),
            "sample_rows": source["rows"][:25], "sample_rows_truncated": len(source["rows"]) > 25,
            "record_numbering": "One-based nonblank data records, excluding the header; physical line spans retained"}


def _mapping(value, headers, row_count):
    if not isinstance(value, dict):
        raise ImplementationError("Supply the explicit laboratory column mapping")
    known = {"schema", "delimiter", "encoding", "columns", "constants", "result_type_values",
             "decimal_separator", "row_actions", "fallback_columns", "fill_missing_collection_times"}
    if set(value) - known:
        raise ImplementationError("Unknown laboratory mapping fields: " + ", ".join(sorted(set(value) - known)))
    if value.get("schema", MAPPING_SCHEMA) != MAPPING_SCHEMA:
        raise ImplementationError("The laboratory mapping uses a different schema")
    result = {
        "schema": MAPPING_SCHEMA, "delimiter": value.get("delimiter", ","),
        "encoding": value.get("encoding", "utf-8-sig"), "columns": {}, "constants": {},
        "fallback_columns": {}, "result_type_values": {},
        "decimal_separator": value.get("decimal_separator", "."),
        "fill_missing_collection_times": value.get("fill_missing_collection_times", False),
        "row_actions": {},
    }
    if result["decimal_separator"] not in (".", ","):
        raise ImplementationError("Choose dot or comma as the explicit numeric decimal separator")
    if type(result["fill_missing_collection_times"]) is not bool:
        raise ImplementationError("Missing collection time filling must be an explicit boolean choice")
    columns, constants = value.get("columns", {}), value.get("constants", {})
    if not isinstance(columns, dict) or not isinstance(constants, dict):
        raise ImplementationError("Columns and constants must be keyed mapping objects")
    for key, name in columns.items():
        if key not in COLUMN_FIELDS:
            raise ImplementationError("Unknown laboratory target column: " + str(key))
        if name in ("", None):
            continue
        if not isinstance(name, str) or name not in headers:
            raise ImplementationError("Select an original CSV header for " + key)
        result["columns"][key] = name
    for key, constant in constants.items():
        if key not in CONSTANT_FIELDS or not isinstance(constant, str):
            raise ImplementationError("Laboratory constants require supported text fields")
        if key in result["columns"]:
            raise ImplementationError("Choose either an original column or a constant for " + key)
        result["constants"][key] = constant
    fallbacks = value.get("fallback_columns", {})
    if not isinstance(fallbacks, dict):
        raise ImplementationError("Fallback columns must be explicitly ordered header lists")
    for key, names in fallbacks.items():
        if (key not in COLUMN_FIELDS or key in result["constants"] or key not in result["columns"]
                or not isinstance(names, list) or any(not isinstance(name, str) or name not in headers for name in names)
                or len(names) != len(set(names)) or result["columns"][key] in names):
            raise ImplementationError("Choose distinct original fallback columns after the primary column for " + str(key))
        if names:
            result["fallback_columns"][key] = list(names)
    for required in ("parameter", "result_type"):
        if required not in result["columns"] and required not in result["constants"]:
            raise ImplementationError("Explicitly map " + required + " from a column or constant")
    if "original_text" not in result["columns"]:
        raise ImplementationError("Map the original result text to an actual CSV column")
    aliases = value.get("result_type_values", {})
    if (not isinstance(aliases, dict) or any(not isinstance(key, str) or target not in RESULT_TYPES
                                           for key, target in aliases.items())):
        raise ImplementationError("Map original result-type labels explicitly to numeric, censored, text or missing")
    result["result_type_values"] = dict(aliases)
    actions = value.get("row_actions", {})
    if not isinstance(actions, dict):
        raise ImplementationError("Row decisions must use original one-based data record numbers")
    for key, action in actions.items():
        if (not isinstance(key, str) or not re.fullmatch(r"[1-9][0-9]*", key)
                or int(key) > row_count or not isinstance(action, dict)):
            raise ImplementationError("A row decision does not identify an original data record")
        if set(action) - {"action", "reason", "activity_id", "observation_id"}:
            raise ImplementationError("Unknown row decision fields for record " + key)
        selected = action.get("action", "import")
        if selected not in ("import", "skip", "replace"):
            raise ImplementationError("Choose import, skip or explicit replacement for record " + key)
        reason = action.get("reason", "")
        if not isinstance(reason, str) or ((selected != "import" or action.get("activity_id")) and not reason.strip()):
            raise ImplementationError("Record " + key + " needs the reason for its explicit skip, replacement or activity binding")
        normalized = {"action": selected, "reason": reason}
        for field in ("activity_id", "observation_id"):
            if action.get(field) is not None:
                if not isinstance(action[field], str) or not ID_RE.fullmatch(action[field]):
                    raise ImplementationError("Choose an actual native " + field + " for record " + key)
                normalized[field] = action[field]
        if selected == "replace" and "observation_id" not in normalized:
            raise ImplementationError("Explicitly select the existing observation to replace for record " + key)
        if selected != "replace" and "observation_id" in normalized:
            raise ImplementationError("An observation target is only used for explicit replacement")
        result["row_actions"][key] = normalized
    return result


def _cell(row, mapping, field):
    if field in mapping["constants"]:
        return mapping["constants"][field], {"constant": mapping["constants"][field]}
    primary = mapping["columns"].get(field)
    if primary is None:
        return "", None
    for name in [primary] + mapping["fallback_columns"].get(field, []):
        value = row["values"][name]
        if value.strip():
            return value, {"column": name}
    return row["values"][primary], {"column": primary}


def _numeric(value, separator, label, *, optional=False, minimum=None):
    original = value.strip()
    if not original and optional:
        return None
    normalized = original
    if separator == ",":
        if "." in normalized:
            raise ValueError(label + " contains a dot with comma selected as the decimal separator")
        normalized = normalized.replace(",", ".")
    if not NUMBER.fullmatch(normalized):
        raise ValueError(label + " must be an explicit number in the selected decimal format; no units or thousands separators are inferred")
    result = float(normalized)
    if not math.isfinite(result) or (minimum is not None and result < minimum):
        raise ValueError(label + " must be finite" + (" and at least " + str(minimum) if minimum is not None else ""))
    return result


def _activity(activities, samples, cells, action, row, issues):
    if action.get("activity_id"):
        selected = activities.get(action["activity_id"])
        if selected is None:
            issues.append(_issue("unknown_activity", "The explicit activity binding is absent from the saved plan", row=row))
            return None
        issues.append(_issue("explicit_activity_binding", "This row uses the explicitly selected existing activity; original CSV identifiers remain retained",
                             severity="warning", row=row, activity_id=selected["id"], reason=action["reason"]))
        return selected
    direct = cells["activity_id"] if cells["activity_id"].strip() else ""
    sample = cells["sample_id"] if cells["sample_id"].strip() else ""
    if not direct and not sample:
        issues.append(_issue("missing_sample_binding", "Map an original activity/sample ID or explicitly select an existing activity for this record", row=row))
        return None
    choices = ([activities[direct]] if direct in activities else []) if direct else list(samples.get(sample, []))
    if sample:
        choices = [item for item in choices if item.get("sample_id") == sample]
    for field in ("site_id", "visit_id"):
        if cells[field].strip():
            choices = [item for item in choices if item[field] == cells[field]]
    if len(choices) != 1:
        issues.append(_issue("ambiguous_sample" if choices else "unmatched_sample",
                             "Original selectors identify " + str(len(choices)) + " existing activities",
                             row=row, candidates=[{"activity_id": item["id"], "sample_id": item.get("sample_id"),
                                                  "site_id": item["site_id"], "visit_id": item["visit_id"]}
                                                 for item in choices]))
        return None
    return choices[0]


def _collection_time(activity, value, mapping, row, issues):
    original = value.strip()
    if not original:
        return None
    saved = activity.get("collected_at")
    if re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}", original):
        try:
            day = dt.date.fromisoformat(original)
        except ValueError:
            issues.append(_issue("invalid_collection_date", "The mapped original collection date is invalid", row=row))
            return None
        if saved and dt.datetime.fromisoformat(saved.replace("Z", "+00:00")).date() != day:
            issues.append(_issue("collection_date_conflict", "Original CSV collection date differs from the selected activity's recorded local date", row=row,
                                 activity_id=activity["id"], saved_collected_at=saved, source_collected_at=value))
        else:
            issues.append(_issue("date_only_collection", "Original collection date is retained; no time or timezone is inferred",
                                 severity="warning", row=row))
        return None
    try:
        if "T" not in original:
            raise ValueError()
        timestamp = dt.datetime.fromisoformat(original.replace("Z", "+00:00"))
        if timestamp.tzinfo is None:
            raise ValueError()
    except ValueError:
        issues.append(_issue("collection_time_precision", "Map a complete original ISO timestamp with timezone or an original ISO date; no timezone is inferred", row=row))
        return None
    if saved:
        recorded = dt.datetime.fromisoformat(saved.replace("Z", "+00:00"))
        if recorded != timestamp:
            issues.append(_issue("collection_time_conflict", "Original CSV collection instant differs from the selected activity",
                                 row=row, activity_id=activity["id"], saved_collected_at=saved, source_collected_at=value))
        return None
    if mapping["fill_missing_collection_times"]:
        return original
    issues.append(_issue("unassigned_collection_time", "Original CSV timestamp is retained; the existing activity has no collection time and filling is not selected",
                         severity="warning", row=row, activity_id=activity["id"]))
    return None


def _semantic(observation):
    return {**{key: observation.get(key, "" if key in OPTIONAL_TEXT else None) for key in OBSERVATION_FIELDS},
            **{key: observation[key] for key in METHOD_DEFINITION_FIELDS if key in observation}}


def _bound_plan(workspace, saved_plan):
    original = validate_plan(saved_plan)
    store = ImplementationStore(workspace)
    retained = store.get(original["id"], revision=original["revision"])
    if document_digest(retained) != document_digest(original):
        raise ImplementationError("Preview the exact original saved field plan revision")
    return store, retained


def _build(workspace, saved_plan, csv_path, mapping, *, filename=None):
    store, plan = _bound_plan(workspace, saved_plan)
    if not isinstance(mapping, dict):
        raise ImplementationError("Supply an explicit laboratory mapping object")
    source = _source(csv_path, delimiter=mapping.get("delimiter", ","),
                     encoding=mapping.get("encoding", "utf-8-sig"), filename=filename)
    selected = _mapping(mapping, source["headers"], len(source["rows"]))
    binding = {"id": plan["id"], "revision": plan["revision"], "sha256": document_digest(plan), "title": plan["title"]}
    identity = {"schema": "upstate.implementation-lab-operation/v1", "edition": EDITION,
                "project_id": workspace.project["id"], "plan": binding,
                "source": source["source"], "mapping": selected}
    operation_id = digest(identity)
    source_id = "lab_csv_" + digest([plan["id"], source["source"]["sha256"], selected])[:24]
    old_index = {item["id"]: item for item in plan["observations"]}
    activities = {item["id"]: item for item in plan["activities"]}
    samples = collections.defaultdict(list)
    for item in activities.values():
        if item.get("sample_id"):
            samples[item["sample_id"]].append(item)
    mapping_sha = digest(selected)
    prospective, decisions, all_issues, row_previews = _clone(plan), [], [], []
    changes, collection_times, signatures, assigned = {}, {}, {}, {}
    counts = collections.Counter()
    for row in source["rows"]:
        issues = []
        action = selected["row_actions"].get(str(row["record"]), {"action": "import", "reason": ""})
        decision = {"record": row["record"], "line_start": row["line_start"], "line_end": row["line_end"],
                    "action": action["action"], "reason": action["reason"], "status": "pending",
                    "selected_columns": {}}
        if action["action"] == "skip":
            decision["status"] = "skipped"
            counts["skip_count"] += 1
            decisions.append(decision)
            if len(row_previews) < 200:
                row_previews.append({**decision, "issues": []})
            continue
        if row["cell_count"] < len(source["headers"]):
            issues.append(_issue("short_record", "Original CSV record omits trailing cells; absent mapped values remain empty",
                                 severity="warning", row=row))
        if row["extra_cells"]:
            issues.append(_issue("extra_cells", "Original CSV record contains cells beyond its named headers",
                                 severity="error" if any(value.strip() for value in row["extra_cells"]) else "warning", row=row))
        cells = {}
        for field in COLUMN_FIELDS:
            cells[field], origin = _cell(row, selected, field)
            if origin is not None:
                decision["selected_columns"][field] = origin
        activity = _activity(activities, samples, cells, action, row, issues)
        raw_type = cells["result_type"]
        result_type = selected["result_type_values"].get(raw_type, raw_type.strip())
        if result_type not in RESULT_TYPES:
            issues.append(_issue("result_type", "Explicitly map the original result-type label to numeric, censored, text or missing",
                                 row=row, original_label=raw_type))
        parameter, original_text, unit = cells["parameter"], cells["original_text"], cells["unit"]
        if not parameter.strip():
            issues.append(_issue("parameter", "The mapped original parameter is empty", row=row))
        if result_type in ("numeric", "censored", "text") and not original_text.strip():
            issues.append(_issue("original_text", "This result type requires nonempty original result text; choose an explicit source fallback if applicable", row=row))
        if result_type in ("numeric", "censored") and not unit.strip():
            issues.append(_issue("unit", "Numeric and censored results require the original unit", row=row))
        qualifier = cells["qualifier"]
        if result_type == "censored" and not qualifier.strip():
            issues.append(_issue("qualifier", "A censored result requires its original qualifier or explicit declared qualifier constant", row=row))
        value = None
        if result_type == "numeric":
            numeric_text = cells["value"] if "value" in selected["columns"] else original_text
            try:
                value = _numeric(numeric_text, selected["decimal_separator"], "Measured numeric value")
            except ValueError as error:
                issues.append(_issue("numeric_value", str(error), row=row))
        elif cells["value"].strip():
            issues.append(_issue("nonnumeric_source_value", "The original mapped value remains in the CSV; the explicit nonnumeric result type saves value=null",
                                 severity="warning", row=row))
        limits = {}
        for field in ("detection_limit", "quantitation_limit"):
            try:
                number = _numeric(cells[field], selected["decimal_separator"], field, optional=True, minimum=0)
                if number is not None:
                    limits[field] = number
            except ValueError as error:
                issues.append(_issue(field, str(error), row=row))
        mapped_id = cells["observation_id"] if cells["observation_id"].strip() else ""
        observation_id = action.get("observation_id") or mapped_id
        if not observation_id:
            observation_id = "lab_" + digest([plan["id"], source["source"]["sha256"], row["record"]])[:32]
        if not ID_RE.fullmatch(observation_id):
            issues.append(_issue("observation_id", "The mapped observation ID is not a valid native ID", row=row))
        decision.update(activity_id=activity["id"] if activity else None, observation_id=observation_id,
                        result_type=result_type, parameter=parameter, original_text=original_text, value=value, unit=unit)
        selected_definition = {key: cells[key] for key in METHOD_DEFINITION_FIELDS
                               if key in selected["columns"] or key in selected["constants"]}
        if selected_definition:
            decision["method_definition"] = {"method": cells["method"], **selected_definition}
        proposed_time = _collection_time(activity, cells["collected_at"], selected, row, issues) if activity else None
        if proposed_time:
            previous = collection_times.get(activity["id"])
            instant = dt.datetime.fromisoformat(proposed_time.replace("Z", "+00:00"))
            if previous and dt.datetime.fromisoformat(previous["value"].replace("Z", "+00:00")) != instant:
                issues.append(_issue("multiple_collection_times", "Rows propose different original timestamps for the same activity",
                                     row=row, earlier_record=previous["record"], activity_id=activity["id"]))
        observation = None
        if not any(item["severity"] == "error" for item in issues):
            observation = {
                "id": observation_id, "activity_id": activity["id"], "parameter": parameter,
                "result_type": result_type, "value": value, "original_text": original_text,
                "unit": unit, "notes": cells["notes"], **limits,
                "lab_source": {"schema": "upstate.implementation-lab-row/v1", "source_link_id": source_id,
                               "csv_sha256": source["source"]["sha256"], "record": row["record"],
                               "line_start": row["line_start"], "line_end": row["line_end"],
                               "mapping_sha256": mapping_sha, "operation_id": operation_id,
                               "original_row": _clone(row["values"]), "original_headers": list(source["headers"]),
                               "cell_count": row["cell_count"], "extra_cells": list(row["extra_cells"]),
                               "selected_columns": _clone(decision["selected_columns"])},
            }
            for field in OPTIONAL_TEXT:
                if cells[field] != "":
                    observation[field] = cells[field]
            old = old_index.get(observation_id)
            earlier = assigned.get(observation_id)
            if earlier is not None:
                if _semantic(earlier["observation"]) == _semantic(observation):
                    decision["status"] = "identical_in_batch"
                    issues.append(_issue("identical_record", "This record maps identically to an earlier result; both original rows remain in the source audit",
                                         severity="warning", row=row, earlier_record=earlier["record"]))
                else:
                    issues.append(_issue("duplicate_observation_id", "Two source rows map different content to the same native observation ID",
                                         row=row, earlier_record=earlier["record"], observation_id=observation_id))
            elif action["action"] == "replace":
                if old is None:
                    issues.append(_issue("replacement_missing", "The explicitly selected observation does not exist in this saved revision", row=row))
                else:
                    replacement = {key: item for key, item in old.items()
                                   if key not in (*OBSERVATION_FIELDS, *METHOD_DEFINITION_FIELDS) and key != "lab_source"}
                    replacement.update(observation)
                    observation = replacement
                    decision["status"] = "identical" if _semantic(old) == _semantic(observation) else "replace"
            elif old is not None:
                if _semantic(old) == _semantic(observation):
                    decision["status"] = "identical"
                else:
                    issues.append(_issue("existing_result_conflict", "This observation ID already has different content; explicitly select replacement or skip",
                                         row=row, observation_id=observation_id, existing=_semantic(old), incoming=_semantic(observation)))
            else:
                decision["status"] = "append"
            if not any(item["severity"] == "error" for item in issues):
                if decision["status"] in ("append", "replace"):
                    changes[observation_id] = observation
                    signature = digest({key: item for key, item in _semantic(observation).items() if key != "id"})
                    if signature in signatures and signatures[signature]["id"] != observation_id:
                        issues.append(_issue("repeated_measurement", "Another original row has identical measurement fields under a different ID; both are retained",
                                             severity="warning", row=row, earlier_record=signatures[signature]["record"]))
                    else:
                        signatures[signature] = {"id": observation_id, "record": row["record"]}
                assigned.setdefault(observation_id, {"observation": observation, "record": row["record"]})
                if proposed_time:
                    collection_times.setdefault(activity["id"], {"value": proposed_time, "record": row["record"]})
                counts[("identical" if decision["status"] == "identical_in_batch" else decision["status"]) + "_count"] += 1
                counts[result_type + "_count"] += 1
        if any(item["severity"] == "error" for item in issues):
            decision["status"] = "conflict"
        decision["issue_codes"] = [item["code"] for item in issues]
        decisions.append(decision)
        all_issues.extend(issues)
        if len(row_previews) < 200:
            row_previews.append({**decision, "issues": issues})
    existing_ids = {item["id"] for item in prospective["observations"]}
    prospective["observations"] = [changes.get(item["id"], item) for item in prospective["observations"]]
    prospective["observations"] += [item for key, item in changes.items() if key not in existing_ids]
    for activity in prospective["activities"]:
        if activity["id"] in collection_times:
            activity["collected_at"] = collection_times[activity["id"]]["value"]
    summary = {key: counts[key] for key in (
        "append_count", "replace_count", "identical_count", "skip_count",
        "numeric_count", "censored_count", "text_count", "missing_count")}
    summary.update(row_count=len(source["rows"]), error_count=sum(item["severity"] == "error" for item in all_issues),
                   warning_count=sum(item["severity"] == "warning" for item in all_issues),
                   collection_times_filled=len(collection_times))
    if not source["rows"]:
        all_issues.append(_issue("empty_data", "The source CSV has a header but no result records"))
    attachment = "implementation/plans/" + plan["id"] + "/attachments/" + source["source"]["sha256"] + "-lab-results.csv"
    audit = {"schema": "upstate.implementation-lab-audit/v1", "identity": identity,
             "summary": summary, "rows": decisions, "issues": all_issues}
    audit_bytes = canonical_bytes(audit) + b"\n"
    audit_sha = hashlib.sha256(audit_bytes).hexdigest()
    audit_id = "lab_audit_" + operation_id[:24]
    audit_operation_path = "implementation/lab-imports/" + operation_id + "/row-decisions.json"
    audit_path = "implementation/plans/" + plan["id"] + "/attachments/" + audit_sha + "-lab-row-decisions.json"
    links = [
        {"id": source_id, "kind": "local_file", "label": source["source"]["filename"],
         "reference": attachment, "sha256": source["source"]["sha256"], "size_bytes": source["source"]["bytes"],
         "original_filename": source["source"]["filename"], "source_schema": "upstate.implementation-lab-csv-source/v1",
         "field_mapping": selected, "source_digest": source["source"]["sha256"]},
        {"id": audit_id, "kind": "local_file", "label": "Laboratory CSV original row decisions",
         "reference": audit_path, "sha256": audit_sha, "size_bytes": len(audit_bytes),
         "original_filename": "row-decisions.json"},
    ]
    source_index = {item["id"]: item for item in prospective["source_links"]}
    for link in links:
        if link["id"] in source_index:
            if source_index[link["id"]] != link:
                all_issues.append(_issue("source_link_conflict", "A retained source ID already names different original source content", source_link_id=link["id"]))
        else:
            prospective["source_links"].append(link)
    history = prospective.get("field12_lab_imports", [])
    if not isinstance(history, list):
        all_issues.append(_issue("import_history", "The saved field laboratory history is not a list"))
    else:
        prospective["field12_lab_imports"] = history + [{
            "schema": IMPORT_SCHEMA, "operation_id": operation_id,
            "base_revision": plan["revision"], "base_document_digest": binding["sha256"],
            "applied_revision": plan["revision"] + 1,
            "source_link_id": source_id, "audit_source_link_id": audit_id,
            "source_sha256": source["source"]["sha256"], "mapping_sha256": mapping_sha,
        }]
    if not any(item["severity"] == "error" for item in all_issues):
        try:
            validate_plan(prospective)
        except ImplementationError as error:
            all_issues.append(_issue("prospective_plan", str(error)))
    summary["error_count"] = sum(item["severity"] == "error" for item in all_issues)
    summary["warning_count"] = sum(item["severity"] == "warning" for item in all_issues)
    # The audit is frozen after final validation; its descriptor enters the same
    # prospective document and is recomputed without self-reference.
    audit["summary"] = summary
    audit["issues"] = all_issues
    audit_bytes = canonical_bytes(audit) + b"\n"
    audit_sha = hashlib.sha256(audit_bytes).hexdigest()
    audit_path = "implementation/plans/" + plan["id"] + "/attachments/" + audit_sha + "-lab-row-decisions.json"
    for link in prospective["source_links"]:
        if link["id"] == audit_id:
            link["sha256"], link["size_bytes"], link["reference"] = audit_sha, len(audit_bytes), audit_path
    preview = {
        "schema": PREVIEW_SCHEMA, "edition": EDITION, "operation_id": operation_id,
        "plan": binding, "source": source["source"], "mapping": selected, "headers": source["headers"],
        "summary": summary, "can_import": summary["error_count"] == 0,
        "rows": row_previews, "rows_truncated": len(decisions) > len(row_previews),
        "issues": all_issues,
    }
    return {"store": store, "original": plan, "plan": prospective, "source": source,
            "identity": identity, "operation_id": operation_id, "preview": preview,
            "source_link_id": source_id, "audit_id": audit_id, "attachment": attachment,
            "audit_path": audit_path, "audit_operation_path": audit_operation_path, "audit_bytes": audit_bytes}


def preview_lab_results(workspace, saved_plan, csv_path, mapping, *, filename=None):
    """Preview every source decision; return bounded display rows and all issues."""
    try:
        return _build(workspace, saved_plan, csv_path, mapping, filename=filename)["preview"]
    except ImplementationError:
        raise
    except (ValueError, KeyError, TypeError, OSError) as error:
        raise ImplementationError("Laboratory CSV preview: " + str(error)) from error


def _matching_applied(context, record):
    actual = record["plan"]
    expected = _clone(context["plan"])
    expected["revision"] = actual["revision"]
    expected["updated_at"] = actual["updated_at"]
    return (actual["revision"] == context["original"]["revision"] + 1
            and record["event"].get("previous_document_digest") == document_digest(context["original"])
            and document_digest(actual) == document_digest(expected))


def import_lab_results(workspace, saved_plan, csv_path, mapping, *, expected_operation_id,
                       actor="", filename=None):
    """Commit the complete reviewed source selection as one native revision."""
    try:
        context = _build(workspace, saved_plan, csv_path, mapping, filename=filename)
        preview, store = context["preview"], context["store"]
        if not isinstance(expected_operation_id, str) or expected_operation_id != context["operation_id"]:
            raise ImplementationError("The original CSV, saved revision or mapping changed; preview this source selection again")
        if not preview["can_import"]:
            raise ImplementationError("Resolve or explicitly skip the preview's conflicting original records before import")
        root = Path(workspace.root)
        directory = root / "implementation" / "lab-imports" / context["operation_id"]
        if directory.is_symlink() or not directory.resolve().is_relative_to(root.resolve()):
            raise ImplementationError("The laboratory import directory must remain inside its original workspace")
        directory.mkdir(parents=True, exist_ok=True)
        with held(directory / "operation.lock"):
            with store._locked(context["original"]["id"]) as plan_directory:
                current_record = store._current_record(plan_directory)
                if current_record is None:
                    raise ImplementationError("The original field plan has no saved revision")
                base_revision = context["original"]["revision"]
                applied_path = plan_directory / "revisions" / ("%016d.json" % (base_revision + 1))
                applied = store._read_record(applied_path) if applied_path.exists() else None
                reconnected = applied is not None and _matching_applied(context, applied)
                if not reconnected and current_record["plan"]["revision"] != base_revision:
                    raise RevisionConflict(context["original"]["id"], base_revision, current_record["plan"]["revision"])
                attachment = root / context["attachment"]
                if attachment.is_symlink() or not attachment.parent.resolve().is_relative_to(root.resolve()):
                    raise ImplementationError("The original CSV attachment must remain inside its workspace")
                atomic_bytes(attachment, context["source"]["raw"], immutable=True)
                atomic_bytes(root / context["audit_path"], context["audit_bytes"], immutable=True)
                atomic_bytes(root / context["audit_operation_path"], context["audit_bytes"], immutable=True)
                atomic_json(directory / "identity.json", context["identity"], immutable=True)
                atomic_json(directory / "preview.json", preview, immutable=True)
                if reconnected:
                    saved = applied["plan"]
                else:
                    incoming = validate_plan(context["plan"])
                    store._check_frozen_sources(current_record["plan"], incoming)
                    saved = store._commit(plan_directory, incoming, previous=current_record["plan"],
                                          revision=base_revision + 1, operation="laboratory_csv_import", actor=actor)
                    current_record = {"plan": saved}
                paths = [attachment, root / context["audit_path"], root / context["audit_operation_path"],
                         directory / "identity.json", directory / "preview.json"]
                receipt = {
                    "schema": IMPORT_SCHEMA, "edition": EDITION, "operation_id": context["operation_id"],
                    "plan_id": saved["id"], "base_revision": base_revision,
                    "applied_revision": saved["revision"], "applied_document_digest": document_digest(saved),
                    "source_link_id": context["source_link_id"], "audit_source_link_id": context["audit_id"],
                    "source": preview["source"], "summary": preview["summary"],
                    "files": [describe_file(root, path) for path in paths],
                    "receipt_path": (directory / "import.json").relative_to(root).as_posix(),
                }
                atomic_json(directory / "import.json", receipt, immutable=True)
                return {**receipt, "status": "reconnected" if reconnected else "imported",
                        "plan": saved, "current_revision": current_record["plan"]["revision"]}
    except ImplementationError:
        raise
    except (ValueError, KeyError, TypeError, OSError) as error:
        raise ImplementationError("Laboratory CSV import: " + str(error)) from error
