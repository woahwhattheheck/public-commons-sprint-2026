"""Recipient handoffs for the original FSU market-pricing workspace.

Pure standard-library operations. The parent Workspace owns transactions, analysis
approval, authentication, source blobs, and saved history. No prices are calculated
or original analyses modified by this module.
"""
from __future__ import annotations

import csv
import hashlib
import io
import json
import math
import re
import uuid
from collections import Counter, defaultdict
from datetime import datetime, timezone
from typing import Any

SCHEMA = "compensation-receiving.v1"
IDENTITY_COLUMNS = ("handoff_id", "row_id", "row_version")
RETURN_COLUMNS = ("return_action", "return_note")
RESERVED_COLUMNS = IDENTITY_COLUMNS + RETURN_COLUMNS
MAX_DOCUMENT_BYTES = 32 * 1024 * 1024
MAX_ROWS = 100000
csv.field_size_limit(max(csv.field_size_limit(), MAX_DOCUMENT_BYTES))
_MISSING = object()


class ReceivingError(ValueError):
    def __init__(self, message: str, code: str = "INVALID_RECEIVING_INPUT"):
        super().__init__(message)
        self.code = code
        self.status = 400


def _fail(message, code="INVALID_RECEIVING_INPUT"):
    raise ReceivingError(message, code)


def _plain(value, path="$"):
    if value is None or isinstance(value, (str, bool)):
        if isinstance(value, str):
            try:
                value.encode("utf-8", "strict")
            except UnicodeError:
                _fail(f"{path} contains invalid Unicode.", "INVALID_UTF8")
        return
    if isinstance(value, int):
        return
    if isinstance(value, float):
        if not math.isfinite(value):
            _fail(f"{path} must be a finite JSON number.")
        return
    if isinstance(value, list):
        for index, item in enumerate(value):
            _plain(item, f"{path}[{index}]")
        return
    if isinstance(value, dict):
        for key, item in value.items():
            if not isinstance(key, str):
                _fail(f"{path} has a non-string object key.")
            _plain(key, path)
            _plain(item, f"{path}.{key}")
        return
    _fail(f"{path} contains an unsupported JSON value.")


def canonical(value):
    _plain(value)
    return json.dumps(value, ensure_ascii=False, sort_keys=True,
                      separators=(",", ":"), allow_nan=False)


def digest(value):
    return hashlib.sha256(canonical(value).encode("utf-8")).hexdigest()


def clone(value):
    return json.loads(canonical(value))


def _text(value, name, allow_empty=False):
    if not isinstance(value, str) or (not allow_empty and not value.strip()):
        _fail(f"{name} must be {'a' if allow_empty else 'a nonempty'} string.")
    _plain(value, name)
    return value


def _object(value, name):
    if not isinstance(value, dict):
        _fail(f"{name} must be an object.")
    return value


def _list(value, name):
    if not isinstance(value, list):
        _fail(f"{name} must be an array.")
    return value


def _timestamp(value=None):
    if value is None:
        return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    _text(value, "at")
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            raise ValueError()
    except ValueError:
        _fail("at must be an ISO 8601 timestamp with a timezone.")
    return value


def _seal(record, field):
    record[field] = digest({k: v for k, v in record.items() if k != field})
    return record


def _verify(record, kind, field="sha256", expected=None):
    _object(record, kind)
    if record.get("schema") != SCHEMA or record.get("kind") != kind:
        _fail(f"Expected a {SCHEMA} {kind}.", "WRONG_DOCUMENT_TYPE")
    computed = digest({k: v for k, v in record.items() if k != field})
    if record.get(field) != computed:
        _fail(f"The {kind} content changed after it was prepared.", "CONTENT_CHANGED")
    if expected is not None and expected != computed:
        _fail("The reviewed preview changed. Open the current preview before saving.",
              "STALE_PREVIEW")
    return computed


def _pointer_tokens(pointer):
    _text(pointer, "column pointer", allow_empty=True)
    if pointer == "":
        return []
    if not pointer.startswith("/") or re.search(r"~(?![01])", pointer):
        _fail(f"Invalid RFC 6901 pointer: {pointer}", "INVALID_POINTER")
    return [part.replace("~1", "/").replace("~0", "~")
            for part in pointer[1:].split("/")]


def resolve_pointer(value, pointer):
    current = value
    for part in _pointer_tokens(pointer):
        if isinstance(current, dict):
            if part not in current:
                return False, None
            current = current[part]
        elif isinstance(current, list):
            if not re.fullmatch(r"0|[1-9][0-9]*", part):
                return False, None
            index = int(part)
            if index >= len(current):
                return False, None
            current = current[index]
        else:
            return False, None
    return True, current


def _kind(value):
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "boolean"
    if isinstance(value, str):
        return "string"
    if isinstance(value, (int, float)):
        return "number"
    return "array" if isinstance(value, list) else "object"


def cell_text(value):
    if value is None:
        return ""
    if isinstance(value, str):
        return value
    return canonical(value)


def _issue(severity, code, message, **context):
    return {"severity": severity, "code": code, "message": message, **context}


def _rows(snapshot):
    _object(snapshot, "snapshot")
    _text(snapshot.get("id"), "snapshot.id")
    if "revision" not in snapshot:
        _fail("snapshot.revision is required.")
    review = _object(snapshot.get("review"), "snapshot.review")
    _text(review.get("by"), "snapshot.review.by")
    _text(review.get("reference"), "snapshot.review.reference")
    _timestamp(_text(review.get("at"), "snapshot.review.at"))
    rows = _list(snapshot.get("rows"), "snapshot.rows")
    if not rows or len(rows) > MAX_ROWS:
        _fail(f"A snapshot must contain 1–{MAX_ROWS:,} rows.")
    seen = set()
    for row in rows:
        _object(row, "snapshot row")
        identity = _text(row.get("id"), "row.id")
        _text(row.get("jobId"), "row.jobId")
        if identity in seen:
            _fail(f"Repeated original row ID: {identity}", "DUPLICATE_ROW_ID")
        seen.add(identity)
        if "data" not in row:
            _fail(f"Row {identity} must retain its original data.")
    _plain(snapshot)
    return rows


def _profile(profile):
    profile = clone(_object(profile, "profile"))
    _text(profile.get("id"), "profile.id")
    _text(profile.get("label"), "profile.label")
    _text(profile.get("recipient"), "profile.recipient")
    profile.setdefault("format", "csv")
    profile.setdefault("lineEnding", "CRLF")
    profile.setdefault("bom", False)
    profile.setdefault("sourceNote", "")
    if profile["format"] not in ("csv", "tsv"):
        _fail("Recipient profile format must be csv or tsv.")
    if profile["lineEnding"] not in ("CRLF", "LF"):
        _fail("lineEnding must be CRLF or LF.")
    if not isinstance(profile["bom"], bool):
        _fail("bom must be true or false.")
    columns = _list(profile.get("columns"), "profile.columns")
    if not columns or len(columns) > 256:
        _fail("A recipient profile must contain 1–256 columns.")
    seen = set(RESERVED_COLUMNS)
    for column in columns:
        _object(column, "profile column")
        header = _text(column.get("header"), "column.header")
        if header in seen:
            _fail(f"Column header is repeated or reserved: {header}", "DUPLICATE_HEADER")
        if "\x00" in header:
            _fail("Column headers cannot contain NUL characters.")
        seen.add(header)
        _pointer_tokens(column.get("pointer"))
        column.setdefault("required", False)
        column.setdefault("editable", False)
        if not isinstance(column["required"], bool) or not isinstance(column["editable"], bool):
            _fail("Column required and editable settings must be true or false.")
    return profile


def inspectSnapshot(snapshot):
    rows = _rows(snapshot)
    fields = {}

    def visit(value, pointer, found):
        if isinstance(value, dict) and value:
            for key, item in value.items():
                escaped = key.replace("~", "~0").replace("/", "~1")
                visit(item, pointer + "/" + escaped, found)
        elif isinstance(value, list) and value:
            for index, item in enumerate(value):
                visit(item, pointer + "/" + str(index), found)
        else:
            field = fields.setdefault(pointer, {
                "pointer": pointer, "types": set(), "present": 0, "samples": []})
            field["types"].add(_kind(value))
            if pointer not in found:
                field["present"] += 1
                found.add(pointer)
            rendered = cell_text(value)
            if rendered not in field["samples"] and len(field["samples"]) < 3:
                field["samples"].append(rendered[:240])
    for row in rows:
        visit(row, "", set())
    return {"schema": SCHEMA, "kind": "snapshot-fields", "rows": len(rows),
            "fields": [{**field, "types": sorted(field["types"])}
                       for pointer, field in sorted(fields.items())]}


def previewHandoff(*, snapshot, profile, selectedRowIds=None):
    source_rows = _rows(snapshot)
    profile = _profile(profile)
    if selectedRowIds is None:
        selected = {row["id"] for row in source_rows}
    else:
        _list(selectedRowIds, "selectedRowIds")
        for identity in selectedRowIds:
            _text(identity, "selected row ID")
        if len(selectedRowIds) != len(set(selectedRowIds)):
            _fail("selectedRowIds contains repeated IDs.")
        selected = set(selectedRowIds)
        unknown = selected - {row["id"] for row in source_rows}
        if unknown:
            _fail("Selected rows are absent from the original snapshot: " + ", ".join(sorted(unknown)))
    rows, excluded, issues = [], [], []
    for source in source_rows:
        version = digest(source)
        if source["id"] not in selected:
            excluded.append({"id": source["id"], "jobId": source["jobId"], "version": version})
            continue
        cells = []
        for column in profile["columns"]:
            present, value = resolve_pointer(source, column["pointer"])
            rendered = cell_text(value) if present else ""
            cells.append({"header": column["header"], "pointer": column["pointer"],
                          "present": present, "type": _kind(value) if present else "missing",
                          "value": clone(value) if present else None, "text": rendered,
                          "editable": column["editable"]})
            if column["required"] and (not present or value is None or value == ""):
                issues.append(_issue("error", "REQUIRED_VALUE_MISSING",
                    f"Required column {column['header']} has no value.",
                    rowId=source["id"], header=column["header"]))
            if isinstance(value, str) and value and value.lstrip()[:1] in ("=", "+", "-", "@"):
                issues.append(_issue("warning", "SPREADSHEET_TEXT",
                    f"{column['header']} contains text a spreadsheet may interpret as a formula; "
                    "import that column as text or use the full JSON handoff to preserve it.",
                    rowId=source["id"], header=column["header"]))
        rows.append({"id": source["id"], "jobId": source["jobId"], "version": version,
                     "source": clone(source), "cells": cells})
    if not rows:
        issues.append(_issue("error", "NO_SELECTED_ROWS", "Select at least one reviewed pricing row."))
    preview = {
        "schema": SCHEMA, "kind": "handoff-preview",
        "snapshot": clone({key: value for key, value in snapshot.items() if key != "rows"}),
        "snapshotHash": digest(snapshot), "profile": profile,
        "rows": rows, "excludedRows": excluded, "issues": issues,
        "summary": {"rows": len(rows), "excluded": len(excluded),
                    "errors": sum(issue["severity"] == "error" for issue in issues),
                    "warnings": sum(issue["severity"] == "warning" for issue in issues)},
    }
    return _seal(preview, "previewHash")


def createHandoff(preview, *, expectedPreviewHash, actor, at=None, id=None):
    _verify(preview, "handoff-preview", "previewHash", expectedPreviewHash)
    if any(issue["severity"] == "error" for issue in preview["issues"]):
        _fail("Resolve the handoff preview errors before saving.", "HANDOFF_HAS_ERRORS")
    record = clone(preview)
    record.update(kind="handoff", id=_text(id, "handoff.id") if id is not None else uuid.uuid4().hex,
                  createdAt=_timestamp(at), createdBy=_text(actor, "actor"))
    record.pop("summary", None)
    return _seal(record, "sha256")


def _handoff(handoff):
    _verify(handoff, "handoff")
    seen = set()
    for row in handoff["rows"]:
        if row["id"] in seen or row["version"] != digest(row["source"]):
            _fail("The handoff contains altered or repeated source rows.", "CONTENT_CHANGED")
        seen.add(row["id"])
    return handoff


def exportHandoff(handoff, *, format=None):
    _handoff(handoff)
    format = format or handoff["profile"]["format"]
    if format not in ("csv", "tsv", "json"):
        _fail("Export format must be csv, tsv, or json.")
    if format == "json":
        content = json.dumps(handoff, ensure_ascii=False, sort_keys=True, indent=2,
                             allow_nan=False) + "\n"
        mime = "application/json; charset=utf-8"
    else:
        buffer = io.StringIO(newline="")
        writer = csv.writer(buffer, delimiter="," if format == "csv" else "\t",
                            lineterminator="\r\n" if handoff["profile"]["lineEnding"] == "CRLF" else "\n")
        headers = list(IDENTITY_COLUMNS) + [column["header"] for column in handoff["profile"]["columns"]] + list(RETURN_COLUMNS)
        writer.writerow(headers)
        for row in handoff["rows"]:
            writer.writerow([handoff["id"], row["id"], row["version"]] +
                            [cell["text"] for cell in row["cells"]] + ["", ""])
        content = ("\ufeff" if handoff["profile"]["bom"] else "") + buffer.getvalue()
        mime = ("text/csv" if format == "csv" else "text/tab-separated-values") + "; charset=utf-8"
    payload = content.encode("utf-8", "strict")
    if len(payload) > MAX_DOCUMENT_BYTES:
        _fail(f"The export exceeds {MAX_DOCUMENT_BYTES // 1024 // 1024} MiB.", "DOCUMENT_TOO_LARGE")
    safe_id = re.sub(r"[^A-Za-z0-9._-]", "_", handoff["id"])[:100] or "handoff"
    return {"schema": SCHEMA, "kind": "export", "filename": f"compensation-{safe_id}.{format}",
            "mime": mime, "content": content, "encoding": "utf-8",
            "sha256": hashlib.sha256(payload).hexdigest(), "bytes": len(payload)}


def importHandoff(content):
    _text(content, "handoff content")
    if len(content.encode("utf-8")) > MAX_DOCUMENT_BYTES:
        _fail("The handoff exceeds the document limit.", "DOCUMENT_TOO_LARGE")
    try:
        record = json.loads(content, parse_constant=lambda value: _fail("Non-finite JSON number."))
    except json.JSONDecodeError as exc:
        _fail(f"Invalid handoff JSON at line {exc.lineno}, column {exc.colno}.", "INVALID_JSON")
    return clone(_handoff(record))


def _read_return(content, format, columnMapping=None):
    _text(content, "returned content", allow_empty=True)
    payload = content.encode("utf-8", "strict")
    if len(payload) > MAX_DOCUMENT_BYTES:
        _fail("The returned file exceeds 32 MiB.", "DOCUMENT_TOO_LARGE")
    if format not in ("csv", "tsv"):
        _fail("A returned file must use csv or tsv.")
    stream = io.StringIO(content[1:] if content.startswith("\ufeff") else content, newline="")
    reader = csv.reader(stream, delimiter="," if format == "csv" else "\t", strict=True)
    try:
        headers = next(reader)
    except StopIteration:
        _fail("The returned file has no header.", "MISSING_HEADER")
    except csv.Error as exc:
        _fail(f"Invalid returned header: {exc}", "INVALID_DELIMITED_FILE")
    if not headers or any(not header for header in headers) or len(set(headers)) != len(headers):
        _fail("Returned column headers must be nonempty and unique.", "DUPLICATE_HEADER")
    if any("\x00" in header for header in headers):
        _fail("Returned column headers cannot contain NUL characters.")
    mapped = list(headers)
    if columnMapping is not None:
        _object(columnMapping, "columnMapping")
        # Mapping is explicit expectedHeader -> original returned header.
        positions = {header: index for index, header in enumerate(headers)}
        for expected, received in columnMapping.items():
            _text(expected, "mapped expected header")
            _text(received, "mapped returned header")
            if received not in positions:
                _fail(f"Mapped returned header is absent: {received}", "MISSING_HEADER")
            mapped[positions[received]] = expected
        if len(set(mapped)) != len(mapped):
            _fail("The explicit return column mapping creates repeated headers.", "DUPLICATE_HEADER")
    records = []
    try:
        for index, cells in enumerate(reader, start=2):
            records.append({"recordNumber": index, "physicalLine": reader.line_num,
                            "cells": cells, "values": dict(zip(mapped, cells))})
            if len(records) > MAX_ROWS:
                _fail(f"The returned file exceeds {MAX_ROWS:,} records.", "TOO_MANY_ROWS")
    except csv.Error as exc:
        _fail(f"Invalid returned file near physical line {reader.line_num}: {exc}",
              "INVALID_DELIMITED_FILE")
    return headers, mapped, records, {
        "content": content, "format": format, "sha256": hashlib.sha256(payload).hexdigest(),
        "bytes": len(payload), "columnMapping": clone(columnMapping or {})
    }


def previewReturn(*, handoff, content, format=None, columnMapping=None):
    _handoff(handoff)
    format = format or handoff["profile"]["format"]
    original_headers, headers, records, source = _read_return(content, format, columnMapping)
    by_id = {row["id"]: row for row in handoff["rows"]}
    expected_headers = list(IDENTITY_COLUMNS) + [column["header"] for column in handoff["profile"]["columns"]] + list(RETURN_COLUMNS)
    missing_headers = [header for header in expected_headers if header not in headers]
    required_missing = [header for header in missing_headers if header not in RETURN_COLUMNS]
    issues = [_issue("error", "MISSING_HEADER", f"Returned column is absent: {header}", header=header)
              for header in required_missing]
    extra_headers = [header for header in headers if header not in expected_headers]
    if extra_headers:
        issues.append(_issue("warning", "ADDITIONAL_COLUMNS",
                             "Additional returned columns are retained: " + ", ".join(extra_headers)))
    counts = Counter(record["values"].get("row_id", "") for record in records)
    encountered, entries = set(), []
    for record in records:
        values = record["values"]
        identity = values.get("row_id", "")
        original = by_id.get(identity)
        row_issues, changes = [], []
        if len(record["cells"]) != len(headers):
            row_issues.append(_issue("error", "COLUMN_COUNT",
                f"This record has {len(record['cells'])} cells; the header has {len(headers)}."))
        if required_missing:
            row_issues.append(_issue("error", "MISSING_HEADER", "Required identity or recipient columns are absent."))
        if original:
            encountered.add(identity)
            if values.get("handoff_id") != handoff["id"]:
                row_issues.append(_issue("error", "FOREIGN_HANDOFF", "This record names a different handoff."))
            if values.get("row_version") != original["version"]:
                row_issues.append(_issue("error", "ROW_VERSION_CHANGED", "The original row version does not match."))
            for cell in original["cells"]:
                if cell["header"] in values and values[cell["header"]] != cell["text"]:
                    changes.append({"header": cell["header"], "pointer": cell["pointer"],
                                    "before": cell["text"], "after": values[cell["header"]],
                                    "editable": cell["editable"]})
        else:
            row_issues.append(_issue("error", "UNKNOWN_ROW", "This row ID is absent from the original handoff."))
        duplicate = counts[identity] > 1
        if duplicate:
            row_issues.append(_issue("error", "DUPLICATE_ROW", "The returned file repeats this row ID."))
        structural = any(issue["code"] in ("COLUMN_COUNT", "MISSING_HEADER", "FOREIGN_HANDOFF", "ROW_VERSION_CHANGED")
                         for issue in row_issues)
        status = "invalid" if structural else ("unknown" if not original else
                    ("duplicate" if duplicate else ("changed" if changes else "unchanged")))
        entries.append({
            "key": f"record:{record['recordNumber']}", "status": status,
            "rowId": identity, "jobId": original["jobId"] if original else "",
            "rowVersion": values.get("row_version", ""), "recordNumber": record["recordNumber"],
            "physicalLine": record["physicalLine"], "original": clone(original) if original else None,
            "returned": values, "rawCells": record["cells"], "changes": changes,
            "issues": row_issues, "requestedAction": values.get("return_action", ""),
            "note": values.get("return_note", "")
        })
    for identity, original in by_id.items():
        if identity not in encountered:
            entries.append({
                "key": "missing:" + identity, "status": "missing", "rowId": identity,
                "jobId": original["jobId"], "rowVersion": original["version"],
                "recordNumber": None, "physicalLine": None, "original": clone(original),
                "returned": {}, "rawCells": [], "changes": [],
                "issues": [_issue("warning", "MISSING_ROW", "This delivered row is absent from the returned file.")],
                "requestedAction": "", "note": ""
            })
    summary = {"records": len(records), **{name: sum(entry["status"] == name for entry in entries)
                for name in ("unchanged", "changed", "missing", "duplicate", "unknown", "invalid")}}
    preview = {"schema": SCHEMA, "kind": "return-preview", "handoffId": handoff["id"],
               "handoffSha256": handoff["sha256"], "snapshot": clone(handoff["snapshot"]),
               "profile": clone(handoff["profile"]), "source": source,
               "columns": headers, "originalColumns": original_headers,
               "entries": entries, "issues": issues, "summary": summary}
    return _seal(preview, "previewHash")


def _decisions(entries, decisions, allowed, reason_for):
    _list(decisions, "decisions")
    indexed = {entry["key"]: entry for entry in entries}
    received = {}
    for decision in decisions:
        _object(decision, "review decision")
        key = _text(decision.get("key"), "decision.key")
        if key not in indexed or key in received:
            _fail(f"Review decision has an unknown or repeated key: {key}", "INVALID_DECISION_KEY")
        action = decision.get("action")
        if action not in allowed:
            _fail(f"Unknown review action: {action}", "INVALID_DECISION")
        reason = decision.get("reason", "")
        _text(reason, "decision.reason", allow_empty=True)
        if reason_for(indexed[key], action) and not reason.strip():
            _fail(f"Record {key} requires a review reason.", "REVIEW_REASON_REQUIRED")
        received[key] = {"key": key, "action": action, "reason": reason}
    absent = set(indexed) - set(received)
    if absent:
        _fail(f"{len(absent)} record(s) still need an explicit review decision.", "INCOMPLETE_REVIEW")
    return [received[entry["key"]] for entry in entries]


def reviewReturn(preview, *, expectedPreviewHash, actor, at=None, decisions, id=None):
    _verify(preview, "return-preview", "previewHash", expectedPreviewHash)
    accepted = set()
    prepared = _decisions(preview["entries"], decisions,
                          {"accept", "request-pricing-review", "exclude", "follow-up"},
                          lambda entry, action: action != "accept" or entry["status"] != "unchanged")
    indexed = {entry["key"]: entry for entry in preview["entries"]}
    for decision in prepared:
        entry = indexed[decision["key"]]
        if decision["action"] == "accept":
            if entry["status"] in ("unknown", "invalid", "missing"):
                _fail(f"{entry['key']} cannot be accepted with unresolved identity or missing content.",
                      "UNRESOLVED_RETURN")
            if any(not change["editable"] for change in entry["changes"]):
                _fail(f"{entry['key']} changes a locked pricing or source field. Route it to pricing review.",
                      "PRICING_REVIEW_REQUIRED")
            if entry["rowId"] in accepted:
                _fail("Only one returned occurrence of a delivered row can be accepted.",
                      "DUPLICATE_ACCEPTANCE")
            accepted.add(entry["rowId"])
    result = {
        "schema": SCHEMA, "kind": "return-review",
        "id": _text(id, "review.id") if id is not None else uuid.uuid4().hex,
        "createdAt": _timestamp(at), "createdBy": _text(actor, "actor"),
        "previewHash": preview["previewHash"], "handoffId": preview["handoffId"],
        "handoffSha256": preview["handoffSha256"], "snapshot": clone(preview["snapshot"]),
        "profile": clone(preview["profile"]), "source": clone(preview["source"]),
        "entries": clone(preview["entries"]), "issues": clone(preview["issues"]),
        "decisions": prepared,
        "summary": {action: sum(item["action"] == action for item in prepared)
                    for action in ("accept", "request-pricing-review", "exclude", "follow-up")},
    }
    return _seal(result, "sha256")


def _diff(before, after, pointer="", before_present=True, after_present=True):
    if before_present and after_present and canonical(before) == canonical(after):
        return []
    if before_present and after_present and isinstance(before, dict) and isinstance(after, dict):
        result = []
        for key in sorted(set(before) | set(after)):
            escaped = key.replace("~", "~0").replace("/", "~1")
            result.extend(_diff(before.get(key), after.get(key), pointer + "/" + escaped,
                                key in before, key in after))
        return result
    if before_present and after_present and isinstance(before, list) and isinstance(after, list):
        result = []
        for index in range(max(len(before), len(after))):
            result.extend(_diff(before[index] if index < len(before) else None,
                                after[index] if index < len(after) else None,
                                pointer + "/" + str(index), index < len(before), index < len(after)))
        return result
    return [{"pointer": pointer, "beforePresent": before_present, "afterPresent": after_present,
             "before": clone(before) if before_present else None,
             "after": clone(after) if after_present else None}]


def compareHandoffs(*, previous, current, pairs=None):
    _handoff(previous)
    _handoff(current)
    before = {row["id"]: row for row in previous["rows"]}
    after = {row["id"]: row for row in current["rows"]}
    match_pairs = []
    if pairs is None:
        by_job_before, by_job_after = defaultdict(list), defaultdict(list)
        for row in before.values():
            by_job_before[row["jobId"]].append(row)
        for row in after.values():
            by_job_after[row["jobId"]].append(row)
        ambiguous = sorted(key for key in set(by_job_before) | set(by_job_after)
                           if len(by_job_before[key]) > 1 or len(by_job_after[key]) > 1)
        if ambiguous:
            _fail("Several analyses use the same original job ID. Supply explicit "
                  "previousRowId/currentRowId pairs for: " + ", ".join(ambiguous),
                  "DUPLICATE_JOB_ID")
        for job_id in sorted(set(by_job_before) & set(by_job_after)):
            match_pairs.append({"previousRowId": by_job_before[job_id][0]["id"],
                                "currentRowId": by_job_after[job_id][0]["id"]})
    else:
        _list(pairs, "pairs")
        seen_before, seen_after = set(), set()
        for pair in pairs:
            _object(pair, "annual pair")
            previous_id = _text(pair.get("previousRowId"), "previousRowId")
            current_id = _text(pair.get("currentRowId"), "currentRowId")
            if previous_id not in before or current_id not in after:
                _fail("An explicit annual pair names an absent row.", "UNKNOWN_ANNUAL_ROW")
            if previous_id in seen_before or current_id in seen_after:
                _fail("An annual row may occur in only one explicit pair.", "DUPLICATE_ANNUAL_PAIR")
            seen_before.add(previous_id)
            seen_after.add(current_id)
            match_pairs.append({"previousRowId": previous_id, "currentRowId": current_id})
    matched_before = {pair["previousRowId"] for pair in match_pairs}
    matched_after = {pair["currentRowId"] for pair in match_pairs}
    items = [(before[pair["previousRowId"]], after[pair["currentRowId"]]) for pair in match_pairs]
    items += [(row, None) for row in before.values() if row["id"] not in matched_before]
    items += [(None, row) for row in after.values() if row["id"] not in matched_after]
    entries = []
    for prior, latest in items:
        row = latest or prior
        previous_id, current_id = prior["id"] if prior else None, latest["id"] if latest else None
        # Compare complete original pricing documents; edition-specific identifiers
        # and review changes are shown alongside source and price changes.
        changes = _diff(prior["source"] if prior else None,
                        latest["source"] if latest else None,
                        before_present=prior is not None, after_present=latest is not None)
        status = "added" if prior is None else ("removed" if latest is None else
                    ("changed" if changes else "unchanged"))
        entries.append({
            "key": "annual:" + digest([previous_id, current_id])[:24],
            "rowId": row["id"], "jobId": row["jobId"], "previousRowId": previous_id,
            "currentRowId": current_id, "status": status,
            "previous": clone(prior) if prior else None, "current": clone(latest) if latest else None,
            "changes": changes,
        })
    comparison = {
        "schema": SCHEMA, "kind": "annual-comparison",
        "previous": {"id": previous["id"], "sha256": previous["sha256"], "snapshot": clone(previous["snapshot"])},
        "current": {"id": current["id"], "sha256": current["sha256"], "snapshot": clone(current["snapshot"])},
        "matching": {"kind": "explicit" if pairs is not None else "original-job-id", "pairs": match_pairs},
        "entries": entries,
        "metadataChanges": _diff({"snapshot": previous["snapshot"], "profile": previous["profile"]},
                                 {"snapshot": current["snapshot"], "profile": current["profile"]}),
        "summary": {status: sum(entry["status"] == status for entry in entries)
                    for status in ("added", "removed", "changed", "unchanged")},
    }
    return _seal(comparison, "previewHash")


def reviewAnnualChange(comparison, *, expectedPreviewHash, actor, at=None, decisions, id=None):
    _verify(comparison, "annual-comparison", "previewHash", expectedPreviewHash)
    prepared = _decisions(comparison["entries"], decisions,
                          {"accept-update", "keep-prior", "needs-pricing-review", "exclude"},
                          lambda entry, action: entry["status"] != "unchanged" or action != "accept-update")
    indexed = {entry["key"]: entry for entry in comparison["entries"]}
    for decision in prepared:
        entry = indexed[decision["key"]]
        if decision["action"] == "keep-prior" and entry["previous"] is None:
            _fail("An added row has no prior edition to retain.", "NO_PRIOR_ROW")
        if decision["action"] == "accept-update" and entry["current"] is None:
            _fail("A removed row has no current edition; retain the prior row, exclude it, or request review.",
                  "NO_CURRENT_ROW")
    record = clone(comparison)
    record.update(
        kind="annual-review",
        id=_text(id, "review.id") if id is not None else uuid.uuid4().hex,
        createdAt=_timestamp(at), createdBy=_text(actor, "actor"),
        decisions=prepared,
        summary={action: sum(decision["action"] == action for decision in prepared)
                 for action in ("accept-update", "keep-prior", "needs-pricing-review", "exclude")},
    )
    return _seal(record, "sha256")


READ_ACTIONS = frozenset({"previewHandoff", "exportHandoff", "previewReturn",
                         "compareHandoffs", "inspectSnapshot", "importHandoff"})
WRITE_ACTIONS = frozenset({"createHandoff", "reviewReturn", "reviewAnnualChange"})


def dispatch(action, payload):
    """Pure wire adapter; the original Workspace must persist WRITE_ACTIONS."""
    _object(payload, "receiving payload")
    if action not in READ_ACTIONS | WRITE_ACTIONS:
        _fail(f"Unknown receiving action: {action}", "UNKNOWN_ACTION")
    function = globals()[action]
    return function(**payload)
