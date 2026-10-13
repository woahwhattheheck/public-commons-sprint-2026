"""Recorded work and supplier invoice intake in the original SF47 case.

The original CSV and every saved mapping edition remain in the case. Applying
one reviewed edition uses Operations' existing SQLite transaction and native
work/invoice validation. No separate financial ledger is created.
"""
from __future__ import annotations

import base64
from collections import Counter, defaultdict
from copy import deepcopy
import csv
from datetime import datetime
from decimal import Decimal
import hashlib
import io
import json
import re
import uuid

from model import Problem, canonical, digest, now, text
import operations_domain as domain

SCHEMA = "stellar-forge.sf47-work-intake.v1"
ACTIONS = ("work-intake.upload", "work-intake.save", "work-intake.apply")
FIELDS = {
    "WORK": ("externalId", "contributor", "costId", "description", "startDate", "endDate", "hours", "fundingBasis"),
    "INVOICES": ("externalId", "contributor", "number", "issuedDate", "dueDate", "lineId",
                 "description", "amountUsd", "currency", "costId", "workIds"),
}
REQUIRED = {
    "WORK": ("contributor", "description", "startDate", "endDate", "hours", "fundingBasis"),
    "INVOICES": ("contributor", "number", "issuedDate", "description", "amountUsd", "currency"),
}
FORMATS = {
    "encoding": ("utf-8-sig", "utf-16", "cp1252"),
    "delimiter": (",", "\t", ";", "|"),
    "dateFormat": ("ISO", "DAY_FIRST", "MONTH_FIRST"),
    "decimalSeparator": (".", ","),
    "groupSeparator": ("", ",", ".", " "),
}
DEFAULT_FORMAT = {"encoding": "utf-8-sig", "delimiter": ",", "headerRow": 1,
                  "dateFormat": "ISO", "decimalSeparator": ".", "groupSeparator": ""}
MAX_ROWS = 5000  # The original operating case's native record capacity.
ID = re.compile(r"intake-[a-f0-9]{32}")
NATIVE_FIELDS = {
    "work": ("contributorId", "costId", "description", "startDate", "endDate", "hours", "fundingBasis"),
    "invoices": ("contributorId", "number", "issuedDate", "dueDate", "currency", "lines", "totalUsd"),
}


def fail(message, code="INVALID_WORK_INTAKE", status=422):
    raise Problem(message, status, code)


def plain(value, label):
    if not isinstance(value, dict):
        fail(label + ": use an object.")
    return value


def keys(value, allowed, label):
    plain(value, label)
    if set(value) - set(allowed):
        fail(label + ": unknown fields " + ", ".join(sorted(set(value) - set(allowed))))
    return value


def intake_id(value):
    if not isinstance(value, str) or not ID.fullmatch(value):
        fail("Select the original saved intake.")
    return value


def format_input(value):
    value = keys(value, (*FORMATS, "headerRow"), "File format")
    result = {}
    for key, allowed in FORMATS.items():
        result[key] = domain.enum(value.get(key, DEFAULT_FORMAT[key]), allowed, key)
    result["headerRow"] = domain.integer(value.get("headerRow", 1), "Header row (0 for no header)", 0, MAX_ROWS + 1)
    if result["groupSeparator"] and result["groupSeparator"] == result["decimalSeparator"]:
        fail("Decimal and grouping separators must differ.")
    return result


def parse_source(raw, selected):
    """Return positional cells and physical line references from the exact bytes."""
    try:
        content = raw.decode(selected["encoding"])
    except UnicodeError as exc:
        raise Problem("The selected text encoding cannot read this original file.", 422, "INTAKE_ENCODING") from exc
    if "\x00" in content:
        fail("The selected encoding leaves NUL characters. Choose the original text encoding.")
    records = []
    # Source attachments already have the original 8 MiB ceiling. Retain large
    # unselected text cells without the csv module's smaller default field cap.
    if csv.field_size_limit() < 8 * 1024 * 1024:
        csv.field_size_limit(8 * 1024 * 1024)
    try:
        reader = csv.reader(io.StringIO(content, newline=""), delimiter=selected["delimiter"], strict=True)
        previous_line = 0
        for number, cells in enumerate(reader, 1):
            if number > MAX_ROWS + selected["headerRow"]:
                fail("This file exceeds the original 5,000-record case capacity. Select its intended source edition.", status=413)
            records.append({"row": number, "lineStart": previous_line + 1, "lineEnd": reader.line_num, "cells": cells})
            previous_line = reader.line_num
    except csv.Error as exc:
        raise Problem("The original delimited file is unreadable: " + str(exc), 422, "INTAKE_CSV") from exc
    header_row = selected["headerRow"]
    if header_row and header_row > len(records):
        fail("The selected header row is outside the original file.")
    headers = records[header_row - 1]["cells"] if header_row else []
    rows = records[header_row:] if header_row else records
    width = max([len(headers), *(len(row["cells"]) for row in rows)], default=0)
    if not width or not rows:
        fail("The selected original file has no data rows.")
    columns = [{"index": index, "label": headers[index] if index < len(headers) else "Column " + str(index + 1)}
               for index in range(width)]
    return {"columns": columns, "rows": rows, "headerRow": header_row,
            "recordCount": len(rows), "nonemptyCount": sum(any(cell.strip() for cell in row["cells"]) for row in rows)}


def initial_document(kind, selected, parsed):
    mapping = {}
    aliases = {"contributor": "contributorId"}
    for field in FIELDS[kind]:
        labels = {field.lower(), aliases.get(field, field).lower()}
        matching = [column["index"] for column in parsed["columns"] if column["label"].strip().lower() in labels]
        if len(matching) == 1:
            mapping[field] = {"column": matching[0]}
    # Visible editable literals match the original native record defaults.
    if kind == "WORK":
        mapping.setdefault("fundingBasis", {"value": "PREAWARD"})
    else:
        mapping.setdefault("currency", {"value": "USD"})
    return {"format": selected, "mapping": mapping, "contributors": [], "costs": [],
            "rowEdits": [], "recordDecisions": [], "sourceSystem": ""}


def normalize_document(value, kind, parsed=None):
    value = keys(value, ("format", "mapping", "contributors", "costs", "rowEdits",
                         "recordDecisions", "sourceSystem"), "Intake document")
    mapping = keys(value.get("mapping", {}), FIELDS[kind], "Column mapping")
    output_mapping = {}
    for field, selection in mapping.items():
        keys(selection, ("column", "value"), "Mapping for " + field)
        if set(selection) == {"column"}:
            maximum = len(parsed["columns"]) - 1 if parsed else 1000000
            output_mapping[field] = {"column": domain.integer(selection["column"], "Source column", 0, maximum)}
        elif set(selection) == {"value"}:
            output_mapping[field] = {"value": text(selection["value"], "Literal " + field, 12000)}
        else:
            fail("Each mapped field needs one positional column or one explicit literal.")
    output = {"format": format_input(value.get("format", {})), "mapping": output_mapping,
              "sourceSystem": text(value.get("sourceSystem", ""), "Original source system", 300),
              "contributors": [], "costs": [], "rowEdits": [], "recordDecisions": []}
    for name, id_field in (("contributors", "contributorId"), ("costs", "costId")):
        rows = value.get(name, [])
        if not isinstance(rows, list) or len(rows) > MAX_ROWS:
            fail("Use a complete source-value mapping list.")
        seen = set()
        for item in rows:
            keys(item, ("sourceValue", id_field), name + " mapping")
            original = text(item.get("sourceValue"), "Original source value", 12000, True)
            target = text(item.get(id_field), "Selected native identity", 100, True)
            if original in seen:
                fail("Each original source value can have only one selected native identity.")
            seen.add(original)
            output[name].append({"sourceValue": original, id_field: target})
    edits = value.get("rowEdits", [])
    if not isinstance(edits, list) or len(edits) > MAX_ROWS:
        fail("Use a row-correction list.")
    available = {row["row"] for row in parsed["rows"]} if parsed else None
    seen = set()
    for item in edits:
        keys(item, ("row", "values", "skip", "reason"), "Row correction")
        number = domain.integer(item.get("row"), "Original source row", 1, MAX_ROWS * 2 + 1)
        if number in seen or (available is not None and number not in available):
            fail("Row corrections must name distinct original data rows.")
        seen.add(number)
        values = keys(item.get("values", {}), FIELDS[kind], "Corrected fields")
        skip = item.get("skip", False)
        if not isinstance(skip, bool):
            fail("Row exclusion must be true or false.")
        reason = text(item.get("reason", ""), "Row correction reason", 4000)
        if (values or skip) and not reason:
            fail("Retain a reason for corrected or excluded source rows.")
        output["rowEdits"].append({"row": number, "values": {field: text(raw, "Corrected " + field, 12000)
                                                          for field, raw in values.items()},
                                   "skip": skip, "reason": reason})
    decisions = value.get("recordDecisions", [])
    if not isinstance(decisions, list) or len(decisions) > MAX_ROWS:
        fail("Use a record-decision list.")
    seen = set()
    for item in decisions:
        keys(item, ("key", "action", "recordId", "reason"), "Record decision")
        key = text(item.get("key"), "Original proposed-record key", 100, True)
        if not re.fullmatch(r"(row-[0-9]+|invoice-[a-f0-9]{24})", key) or key in seen:
            fail("Record decisions must name distinct proposed records.")
        seen.add(key)
        action = domain.enum(item.get("action"), ("CREATE", "REUSE", "SKIP"), "Record decision")
        record_id = text(item.get("recordId", ""), "Matched original record", 100)
        if action == "REUSE" and not record_id:
            fail("Choose the original record to reuse.")
        if action != "REUSE" and record_id:
            fail("Only a reuse decision selects an existing record.")
        reason = text(item.get("reason", ""), "Record decision reason", 4000, True)
        output["recordDecisions"].append({"key": key, "action": action, "recordId": record_id, "reason": reason})
    for name in ("contributors", "costs"):
        output[name].sort(key=lambda row: row["sourceValue"])
    output["rowEdits"].sort(key=lambda row: row["row"])
    output["recordDecisions"].sort(key=lambda row: row["key"])
    return output


def source_values(row, document, kind):
    result, errors = {}, []
    for field in FIELDS[kind]:
        selection = document["mapping"].get(field)
        if not selection:
            result[field] = ""
        elif "value" in selection:
            result[field] = selection["value"]
        elif selection["column"] >= len(row["cells"]):
            result[field] = ""
            errors.append("The original row has no column " + str(selection["column"] + 1) + " for " + field + ".")
        else:
            result[field] = row["cells"][selection["column"]].strip()
    edit = next((item for item in document["rowEdits"] if item["row"] == row["row"]), None)
    if edit:
        result.update(edit["values"])
        # A correction can replace a missing positional value explicitly.
        errors = [message for message in errors if not any(message.endswith(" for " + field + ".") for field in edit["values"])]
    return result, errors, edit


def date_value(raw, label, selected, optional=False):
    if optional and not raw:
        return None
    if selected["dateFormat"] == "ISO":
        return domain.calendar(raw, label)
    pattern = "%d/%m/%Y" if selected["dateFormat"] == "DAY_FIRST" else "%m/%d/%Y"
    if not isinstance(raw, str) or not re.fullmatch(r"[0-9]{1,2}/[0-9]{1,2}/[0-9]{4}", raw):
        fail(label + ": use the selected day/month/year or month/day/year format with a four-digit year.")
    try:
        return datetime.strptime(raw, pattern).date().isoformat()
    except ValueError as exc:
        raise Problem(label + ": the original calendar date is invalid.", 422, "INTAKE_DATE") from exc


def amount_value(raw, label, selected, places):
    raw = text(raw, label, 100, True)
    point, grouping = selected["decimalSeparator"], selected["groupSeparator"]
    if raw.count(point) > 1:
        fail(label + ": use the selected decimal separator.")
    whole, separator, fraction = raw.partition(point)
    if grouping and grouping in whole:
        if not re.fullmatch(r"[0-9]{1,3}(?:" + re.escape(grouping) + r"[0-9]{3})+", whole):
            fail(label + ": grouping does not match the selected thousands separator.")
        whole = whole.replace(grouping, "")
    if not re.fullmatch(r"[0-9]+", whole) or (separator and not re.fullmatch(r"[0-9]+", fraction)):
        fail(label + ": use an exact nonnegative decimal in the selected source format.")
    normalized = whole + ("." + fraction if separator else "")
    return domain.quantity(normalized, label, places, True) if places != 2 else domain.usd(normalized, label, True)


def selected_id(value, mapping, id_field, available, label, optional=False):
    if not value and optional:
        return None
    target = next((row[id_field] for row in mapping if row["sourceValue"] == value), value)
    if target not in available:
        fail(label + ": map the exact source value to an existing case identity.")
    return target


def business_value(kind, row):
    value = {key: deepcopy(row.get(key)) for key in NATIVE_FIELDS[kind]}
    if kind == "invoices":
        # Source line identifiers can differ while the ordered business lines
        # are identical. The native invoice keeps its original line IDs.
        value["lines"] = [{key: deepcopy(line.get(key)) for key in ("costId", "description", "amountUsd", "workIds")}
                          for line in row.get("lines", [])]
    return value


def business_sha(kind, row):
    return digest({"kind": kind, "value": business_value(kind, row)})


def compile_source(context, source, raw, kind, document):
    parsed = parse_source(raw, document["format"])
    document = normalize_document(document, kind, parsed)
    contributors = {row["id"] for row in context["records"]["contributors"]}
    costs = {row["id"] for row in context["plan"]["scenario"]["future_costs"]}
    native_kind = "work" if kind == "WORK" else "invoices"
    source_note = "Original delimited source " + source["filename"] + "; source SHA-256 " + source["sha256"]
    evaluated, proposed, groups = [], [], {}
    for original in parsed["rows"]:
        values, errors, edit = source_values(original, document, kind)
        row = {**original, "values": values, "errors": errors, "excluded": False,
               "correction": deepcopy(edit), "candidateKey": None}
        if not any(cell.strip() for cell in original["cells"]) and not (edit and edit["values"]):
            row.update(excluded=True, exclusionReason="Empty original row", errors=[])
            evaluated.append(row)
            continue
        if edit and edit["skip"]:
            row.update(excluded=True, exclusionReason=edit["reason"], errors=[])
            evaluated.append(row)
            continue
        try:
            if errors:
                fail(" ".join(errors))
            contributor = selected_id(values["contributor"], document["contributors"], "contributorId",
                                      contributors, "Contributor or supplier")
            cost = selected_id(values["costId"], document["costs"], "costId", costs, "Work package", True)
            if kind == "WORK":
                data = {"contributorId": contributor, "costId": cost, "description": values["description"],
                        "startDate": date_value(values["startDate"], "Work start", document["format"]),
                        "endDate": date_value(values["endDate"], "Work end", document["format"]),
                        "hours": amount_value(values["hours"], "Recorded hours", document["format"], 4),
                        "fundingBasis": values["fundingBasis"],
                        "sourceIds": [source["id"]], "sourceNote": source_note + "; row " + str(original["row"])}
                values_native = domain.prepare("work", data, context)
                key = "row-" + str(original["row"])
                candidate = {"key": key, "kind": native_kind, "rows": [original["row"]], "data": values_native,
                             "externalIds": [values["externalId"]] if values["externalId"] else [], "errors": []}
                proposed.append(candidate)
            else:
                if values["currency"].upper() != "USD":
                    fail("The original invoice ledger uses USD. Select an explicit USD amount column and USD basis; retain the original currency in the source.")
                number = text(values["number"], "Invoice number", 200, True)
                issued = date_value(values["issuedDate"], "Invoice date", document["format"])
                due = date_value(values["dueDate"], "Due date", document["format"], True)
                line_id = text(values["lineId"] or "source-row-" + str(original["row"]), "Invoice line ID", 100, True)
                work_ids = [item.strip() for item in values["workIds"].split(";") if item.strip()]
                line = {"id": line_id, "costId": cost, "description": values["description"],
                        "amountUsd": amount_value(values["amountUsd"], "Invoice line USD", document["format"], 2),
                        "workIds": work_ids}
                key = "invoice-" + digest([contributor, number])[:24]
                if key not in groups:
                    groups[key] = {"key": key, "kind": native_kind, "rows": [], "externalIds": [], "errors": [],
                                   "data": {"contributorId": contributor, "number": number, "issuedDate": issued,
                                            "dueDate": due, "currency": "USD", "lines": [], "sourceIds": [source["id"]],
                                            "sourceNote": source_note}}
                    proposed.append(groups[key])
                candidate = groups[key]
                if candidate["data"]["issuedDate"] != issued or candidate["data"]["dueDate"] != due:
                    fail("Every line of this supplier invoice must retain the same issue and due dates.")
                candidate["rows"].append(original["row"])
                candidate["data"]["lines"].append(line)
                if values["externalId"]:
                    candidate["externalIds"].append(values["externalId"])
            row["candidateKey"] = key
        except Problem as exc:
            row["errors"] = [str(exc)]
        evaluated.append(row)
    if kind == "INVOICES":
        for candidate in proposed:
            try:
                # Native invoice-number duplication is resolved in the explicit
                # matching step, after normalizing all original ordered lines.
                previous = next((row for row in context["records"]["invoices"]
                                 if row["contributorId"] == candidate["data"]["contributorId"]
                                 and row["number"] == candidate["data"]["number"]), None)
                values_native = domain.prepare("invoices", candidate["data"], {**context, "restoring": True}, previous)
                candidate["data"] = values_native
            except Problem as exc:
                candidate["errors"].append(str(exc))
    return document, parsed, evaluated, proposed


def applied_bindings(history):
    """External row identities keep the original native record across editions."""
    result = defaultdict(list)
    for row in history:
        if row.get("state") != "APPLIED":
            continue
        system = row["document"]["sourceSystem"]
        if not system:
            continue
        for link in row["applied"]["links"]:
            for external in link.get("externalIds", []):
                result[(row["kind"], system, external)].append(link)
    return result


def preview(context, source, raw, batch, document, history):
    if hashlib.sha256(raw).hexdigest() != source["sha256"]:
        fail("The original intake attachment differs from its retained bytes.", "INTAKE_SOURCE_CHANGED", 409)
    normalized, parsed, evaluated, proposed = compile_source(context, source, raw, batch["kind"], document)
    decisions = {row["key"]: row for row in normalized["recordDecisions"]}
    existing = {kind: {row["id"]: row for row in context["records"][kind]} for kind in ("work", "invoices")}
    fingerprints = {kind: defaultdict(list) for kind in existing}
    for kind, rows in existing.items():
        for record in rows.values():
            fingerprints[kind][business_sha(kind, record)].append(record)
    duplicate_fingerprints = Counter(business_sha(row["kind"], row["data"]) for row in proposed if not row["errors"])
    external_counts = Counter(external for row in proposed if decisions.get(row["key"], {}).get("action") != "SKIP"
                              for external in set(row["externalIds"]))
    bindings = applied_bindings(history)
    active_keys = {row["key"] for row in proposed}
    unknown_decisions = set(decisions) - active_keys
    issues = [{"code": "STALE_RECORD_DECISION", "message": "A retained decision no longer names a proposed record: " + key}
              for key in sorted(unknown_decisions)]
    for row in evaluated:
        for message in row["errors"]:
            issues.append({"code": "SOURCE_ROW", "row": row["row"], "message": message})
    for candidate in proposed:
        kind, native = candidate["kind"], candidate["data"]
        fingerprint = business_sha(kind, native)
        candidate["fingerprint"] = fingerprint
        candidate["decision"] = deepcopy(decisions.get(candidate["key"]))
        matches = fingerprints[kind].get(fingerprint, [])
        protected = []
        if normalized["sourceSystem"]:
            for external in candidate["externalIds"]:
                for link in bindings.get((batch["kind"], normalized["sourceSystem"], external), []):
                    native_record = existing[kind].get(link["recordId"])
                    if native_record and native_record["id"] not in [row["id"] for row in protected]:
                        protected.append(native_record)
        if kind == "invoices":
            protected.extend(record for record in existing[kind].values()
                             if record["contributorId"] == native.get("contributorId") and record["number"] == native.get("number")
                             and record["id"] not in [row["id"] for row in protected])
        candidate["matches"] = [{"id": record["id"], "state": record["state"],
                                  "sameBusinessValues": business_sha(kind, record) == fingerprint,
                                  "recordedBy": record.get("recordedBy"), "description": record.get("description") or record.get("number"),
                                  "sourceIds": record.get("sourceIds", [])}
                                 for record in {row["id"]: row for row in [*matches, *protected]}.values()]
        candidate["sameBatchDuplicates"] = duplicate_fingerprints[fingerprint] > 1
        decision = decisions.get(candidate["key"])
        candidate["action"], candidate["recordId"] = "CREATE", None
        if decision and decision["action"] == "SKIP":
            candidate["action"] = "SKIP"
            candidate["errors"] = []
        else:
            if any(external_counts[value] > 1 for value in candidate["externalIds"]) and normalized["sourceSystem"]:
                candidate["errors"].append("An original external row ID repeats in this source system. Correct or exclude the duplicate source row.")
            if decision and decision["action"] == "REUSE":
                match = existing[kind].get(decision["recordId"])
                if not match or match["state"] == "VOID" or business_sha(kind, match) != fingerprint:
                    candidate["errors"].append("The selected existing record is void, missing, or has different business values.")
                elif protected and any(record["id"] != match["id"] for record in protected):
                    candidate["errors"].append("The original external identity already belongs to another native record.")
                else:
                    candidate["action"], candidate["recordId"] = "REUSE", match["id"]
            elif protected:
                candidate["errors"].append("This supplier invoice number or source-system row is already retained. Select its matching original record or correct the source row.")
            elif matches or candidate["sameBatchDuplicates"]:
                if not decision or decision["action"] != "CREATE":
                    candidate["errors"].append("Equivalent work is present in this case or source. Choose the original record, exclude it, or explicitly record separate work with a reason.")
        candidate["state"] = "EXCLUDED" if candidate["action"] == "SKIP" else "NEEDS_REVIEW" if candidate["errors"] else "READY"
        for message in candidate["errors"]:
            issues.append({"code": "PROPOSED_RECORD", "key": candidate["key"], "rows": candidate["rows"], "message": message})
    created = [row for row in proposed if row["state"] == "READY" and row["action"] == "CREATE"]
    reused = [row for row in proposed if row["state"] == "READY" and row["action"] == "REUSE"]
    if len(created) + sum(len(rows) for rows in context["records"].values()) > MAX_ROWS:
        issues.append({"code": "CASE_CAPACITY", "message": "These new records exceed the original case's 5,000-record capacity."})
    if not parsed["nonemptyCount"]:
        issues.append({"code": "NO_DATA_ROWS", "message": "The original file contains no nonempty data rows."})
    totals = {}
    for label, selected in (("new", created), ("matched", reused)):
        totals[label + "Hours"] = domain.quantity(sum((Decimal(row["data"]["hours"]) for row in selected if row["kind"] == "work"), Decimal(0)), places=4)
        totals[label + "InvoiceUsd"] = domain.usd(sum((Decimal(row["data"]["totalUsd"]) for row in selected if row["kind"] == "invoices"), Decimal(0)))
    result = {"schema": SCHEMA + ".preview", "caseId": context["program"]["id"], "caseVersion": context["program"]["version"],
              "intakeId": batch["id"], "intakeRevision": batch["revision"], "intakeSha256": batch["sha256"],
              "kind": batch["kind"], "source": deepcopy(source), "document": normalized,
              "columns": parsed["columns"], "rows": evaluated, "candidates": proposed, "issues": issues,
              "summary": {"sourceRows": len(evaluated), "excludedRows": sum(row["excluded"] for row in evaluated),
                          "proposedRecords": len(proposed), "newRecords": len(created), "matchedRecords": len(reused),
                          "excludedRecords": sum(row["action"] == "SKIP" for row in proposed),
                          "issueCount": len(issues), "ready": not issues, **totals}}
    result["previewSha256"] = digest(result)
    return result


def install(db):
    db.execute("""CREATE TABLE IF NOT EXISTS ops_work_intakes(
        program_id TEXT NOT NULL REFERENCES ops_programs(id),id TEXT NOT NULL,
        revision INTEGER NOT NULL,body_json TEXT NOT NULL,PRIMARY KEY(program_id,id,revision))""")


def load(ops, case_id):
    return [json.loads(row[0]) for row in ops.db.execute(
        "SELECT body_json FROM ops_work_intakes WHERE program_id=? ORDER BY id,revision", (case_id,))]


def heads(history):
    result = {}
    for row in history:
        if row["id"] not in result or row["revision"] > result[row["id"]]["revision"]:
            result[row["id"]] = row
    return sorted(result.values(), key=lambda row: (row["updatedAt"], row["id"]), reverse=True)


def summary(row):
    return {key: deepcopy(row[key]) for key in ("id", "name", "kind", "state", "revision", "caseVersion",
                                               "sourceId", "sourceSha256", "createdAt", "updatedAt", "actor",
                                               "sha256", "previewSummary")}


def refs(history):
    return [{"id": row["id"], "revision": row["revision"], "sha256": row["sha256"], "state": row["state"]}
            for row in sorted(heads(history), key=lambda row: row["id"])]


def selected(ops, case_id, ident, revision=None):
    ident = intake_id(ident)
    if revision is not None:
        domain.integer(revision, "Saved intake edition", 1, 10000000)
        query, params = "SELECT body_json FROM ops_work_intakes WHERE program_id=? AND id=? AND revision=?", (case_id, ident, revision)
    else:
        query, params = "SELECT body_json FROM ops_work_intakes WHERE program_id=? AND id=? ORDER BY revision DESC LIMIT 1", (case_id, ident)
    record = ops.db.execute(query, params).fetchone()
    if not record:
        fail("The original intake edition is unavailable.", "INTAKE_NOT_FOUND", 404)
    return json.loads(record[0])


def save_row(ops, case_id, row):
    ops.db.execute("INSERT INTO ops_work_intakes VALUES(?,?,?,?)",
                   (case_id, row["id"], row["revision"], canonical(row)))


def source_for(ops, case_id, batch):
    metadata, raw = ops.source(case_id, batch["sourceId"])
    if metadata["sha256"] != batch["sourceSha256"]:
        fail("This intake belongs to a different original source.", "INTAKE_SOURCE_CHANGED", 409)
    return metadata, raw


def get(ops, context, ident, revision=None):
    row = selected(ops, context["program"]["id"], ident, revision)
    source, raw = source_for(ops, context["program"]["id"], row)
    parsed = parse_source(raw, row["document"]["format"])
    history = [summary(value) for value in load(ops, context["program"]["id"]) if value["id"] == row["id"]]
    return {"intake": row, "source": source, "columns": parsed["columns"], "rows": parsed["rows"],
            "history": history, "caseVersion": context["program"]["version"]}


def preview_selected(ops, context, data):
    keys(data, ("intakeId", "revision", "document"), "Intake preview")
    row = selected(ops, context["program"]["id"], data.get("intakeId"), data.get("revision"))
    if row["state"] == "APPLIED":
        fail("This original intake is already applied. Open its retained native record links.", "INTAKE_ALREADY_APPLIED", 409)
    source, raw = source_for(ops, context["program"]["id"], row)
    return preview(context, source, raw, row, data.get("document", row["document"]), load(ops, context["program"]["id"]))


def command(ops, context, action, data, actor, version, note):
    case_id, stamp = context["program"]["id"], now()
    before, source_change = None, None
    if action == "work-intake.upload":
        keys(data, ("name", "kind", "sourceId", "file", "format"), "Original work/invoice source")
        kind = domain.enum(data.get("kind"), tuple(FIELDS), "Intake kind")
        name = text(data.get("name"), "Intake name", 300, True)
        selected_format = format_input(data.get("format", {}))
        if ("sourceId" in data) == ("file" in data):
            fail("Select one original case source or attach one original file.")
        if "sourceId" in data:
            source, raw = ops.source(case_id, data["sourceId"])
        else:
            from operations import decoded
            file = keys(data["file"], ("filename", "contentBase64", "mediaType", "sourceUrl", "observedAt"), "Original file")
            raw = decoded(file.get("contentBase64"))
            source = {"sha256": hashlib.sha256(raw).hexdigest()}
        matching = next((row for row in heads(load(ops, case_id)) if row["sourceSha256"] == source["sha256"] and row["kind"] == kind), None)
        if matching:
            return {"before": None, "after": summary(matching), "kind": "work-intake", "recordId": matching["id"],
                    "unchanged": True, "revision": matching["revision"], "state": matching["state"]}
        parsed = parse_source(raw, selected_format)
        if "file" in data:
            source = ops._source_add(case_id, {**data["file"], "kind": "work" if kind == "WORK" else "invoice"})
            source_change = {"added": [source], "removed": []}
        document = initial_document(kind, selected_format, parsed)
        ident = "intake-" + uuid.uuid4().hex
        row = {"schema": SCHEMA, "id": ident, "revision": 1, "caseVersion": version, "state": "DRAFT",
               "name": name, "kind": kind, "sourceId": source["id"], "sourceSha256": source["sha256"],
               "document": document, "previewSummary": None, "previewSha256": None, "applied": None,
               "createdAt": stamp, "updatedAt": stamp, "actor": actor, "note": note, "previousSha256": None}
    else:
        keys(data, ("intakeId", "expectedRevision", "document", "expectedPreviewSha256"), "Saved intake action")
        before = selected(ops, case_id, data.get("intakeId"))
        if before["revision"] != domain.integer(data.get("expectedRevision"), "Current intake edition", 1, 10000000):
            fail("The saved intake changed. Reopen its current edition.", "INTAKE_REVISION_CONFLICT", 409)
        if before["state"] == "APPLIED":
            fail("The original intake is already applied. Reopen its saved record links.", "INTAKE_ALREADY_APPLIED", 409)
        source, raw = source_for(ops, case_id, before)
        candidate = preview(context, source, raw, before, data.get("document", before["document"]), load(ops, case_id))
        if data.get("expectedPreviewSha256") is not None and candidate["previewSha256"] != domain.sha(data["expectedPreviewSha256"], "Reviewed intake", False):
            fail("The source, mapping or native case changed after preview.", "INTAKE_PREVIEW_CONFLICT", 409)
        row = {**deepcopy(before), "revision": before["revision"] + 1, "caseVersion": version,
               "document": candidate["document"], "previewSummary": candidate["summary"],
               "previewSha256": candidate["previewSha256"], "updatedAt": stamp, "actor": actor,
               "note": note, "previousSha256": before["sha256"]}
        row.pop("sha256", None)
        if action == "work-intake.apply":
            if data.get("expectedPreviewSha256") is None:
                fail("Apply the exact reviewed intake preview.")
            if not candidate["summary"]["ready"]:
                fail("Resolve the original source rows and duplicate decisions before applying.", "INTAKE_NOT_READY", 409)
            links = []
            for item in candidate["candidates"]:
                if item["action"] == "SKIP":
                    continue
                kind = item["kind"]
                if item["action"] == "REUSE":
                    native = deepcopy(next(record for record in context["records"][kind] if record["id"] == item["recordId"]))
                else:
                    ident = domain.PREFIX[kind] + "-" + uuid.uuid4().hex
                    native = {**item["data"], "id": ident, "version": version,
                              "createdAt": stamp, "updatedAt": stamp, "recordedBy": actor}
                    ops._save(case_id, kind, native)
                links.append({"key": item["key"], "kind": kind, "recordId": native["id"],
                              "operation": "CREATED" if item["action"] == "CREATE" else "REUSED",
                              "rows": item["rows"], "externalIds": item["externalIds"], "fingerprint": item["fingerprint"],
                              "snapshot": native})
            row["state"] = "APPLIED"
            row["applied"] = {"caseVersion": version, "appliedAt": stamp, "actor": actor,
                              "previewSha256": candidate["previewSha256"], "summary": candidate["summary"], "links": links}
        elif action != "work-intake.save":
            fail("Unknown work/invoice intake action.")
    row["sha256"] = digest(row)
    save_row(ops, case_id, row)
    return {"before": summary(before) if before else None, "after": summary(row), "kind": "work-intake",
            "recordId": row["id"], "revision": row["revision"], "state": row["state"],
            "sourceChange": source_change, "unchanged": False,
            "createdRecordIds": [link["recordId"] for link in (row["applied"] or {}).get("links", []) if link["operation"] == "CREATED"],
            "matchedRecordIds": [link["recordId"] for link in (row["applied"] or {}).get("links", []) if link["operation"] == "REUSED"]}


def validate_import(context, history, events, files, *, plan_for_version=None):
    """Receive every draft/applied edition and its original native record links."""
    if not isinstance(history, list) or len(history) > context["program"]["version"]:
        fail("The saved work/invoice intake history is invalid.", "INTAKE_RECEIVING")
    if any(not isinstance(row, dict) for row in history):
        fail("Every saved intake edition must be an object.", "INTAKE_RECEIVING")
    for row in history:
        if not isinstance(row.get("id"), str) or type(row.get("revision")) is not int:
            fail("Each retained intake needs its original text identity and integer edition.", "INTAKE_RECEIVING")
        if not isinstance(row.get("document"), dict):
            fail("Each retained intake needs its complete mapping document.", "INTAKE_RECEIVING")
        applied = row.get("applied")
        if applied is not None and (not isinstance(applied, dict) or not isinstance(applied.get("links"), list)
                or any(not isinstance(link, dict) for link in applied["links"])):
            fail("The applied intake needs its complete original record-link objects.", "INTAKE_RECEIVING")
    previous, versions = {}, set()
    by_kind = {kind: {row["id"]: row for row in context["records"][kind]} for kind in ("work", "invoices")}
    for row in sorted(history, key=lambda value: (value.get("id", ""), value.get("revision", 0))):
        if not isinstance(row, dict) or row.get("schema") != SCHEMA:
            fail("The original intake schema is invalid.", "INTAKE_RECEIVING")
        ident = intake_id(row.get("id"))
        revision = domain.integer(row.get("revision"), "Saved intake edition", 1, 10000000)
        version = domain.integer(row.get("caseVersion"), "Intake case version", 2, context["program"]["version"])
        historical = context
        if plan_for_version is not None:
            plan = plan_for_version(version - 1)
            historical = {**context, "plan": plan,
                          "program": {**context["program"], "planRevision": plan["revision"]}}
        if version in versions:
            fail("Two intake editions cannot belong to the same original case event.", "INTAKE_RECEIVING")
        versions.add(version)
        prior = previous.get(ident)
        if revision != (prior["revision"] + 1 if prior else 1) or row.get("previousSha256") != (prior["sha256"] if prior else None):
            fail("The original intake edition chain is incomplete.", "INTAKE_RECEIVING")
        if prior and (prior["state"] == "APPLIED" or any(row.get(key) != prior[key] for key in ("kind", "sourceId", "sourceSha256", "createdAt", "name"))):
            fail("The original source or completed intake was replaced.", "INTAKE_RECEIVING")
        if row.get("sha256") != digest({key: value for key, value in row.items() if key != "sha256"}):
            fail("A saved intake edition differs from its retained identity.", "INTAKE_RECEIVING")
        domain.enum(row.get("kind"), tuple(FIELDS), "Intake kind")
        domain.enum(row.get("state"), ("DRAFT", "APPLIED"), "Intake state")
        domain.timestamp(row.get("createdAt"), "Original intake creation")
        domain.timestamp(row.get("updatedAt"), "Original intake change")
        text(row.get("actor"), "Original recording operator", 300, True)
        source = context["sources"].get(row.get("sourceId"))
        if not source or source["sha256"] != row.get("sourceSha256"):
            fail("The original intake source is missing.", "INTAKE_RECEIVING")
        raw = files["sources/" + source["id"]]
        parsed = parse_source(raw, format_input(row.get("document", {}).get("format", {})))
        normalized = normalize_document(row.get("document"), row["kind"], parsed)
        if normalized != row["document"]:
            fail("The retained mapping differs from its normalized source.", "INTAKE_RECEIVING")
        event = events[version - 1]
        expected_action = "work-intake.upload" if revision == 1 else "work-intake.apply" if row["state"] == "APPLIED" else "work-intake.save"
        if event.get("action") != expected_action or event.get("recordId") != ident or event.get("after") != summary(row) or event.get("before") != (summary(prior) if prior else None):
            fail("The saved intake does not match its original case event.", "INTAKE_RECEIVING")
        if row["state"] == "DRAFT":
            if row.get("applied") is not None:
                fail("An unfinished intake contains an applied result.", "INTAKE_RECEIVING")
        else:
            applied = plain(row.get("applied"), "Applied original intake")
            if applied.get("caseVersion") != version or applied.get("previewSha256") != row.get("previewSha256") or applied.get("summary") != row.get("previewSummary"):
                fail("The applied intake lost its original reviewed selection.", "INTAKE_RECEIVING")
            _, _, evaluated, candidates = compile_source(historical, source, raw, row["kind"], normalized)
            if any(value["errors"] for value in evaluated):
                fail("An applied intake contains unresolved source rows.", "INTAKE_RECEIVING")
            proposed = {value["key"]: value for value in candidates}
            decisions = {value["key"]: value for value in normalized["recordDecisions"]}
            expected_keys = {key for key in proposed if decisions.get(key, {}).get("action") != "SKIP"}
            links = applied.get("links")
            if not isinstance(links, list) or {value.get("key") for value in links} != expected_keys or len(links) != len(expected_keys):
                fail("The applied intake's native record links are incomplete.", "INTAKE_RECEIVING")
            for link in links:
                item = proposed[link["key"]]
                native = by_kind[item["kind"]].get(link.get("recordId"))
                snapshot = plain(link.get("snapshot"), "Original native record")
                if (not native or snapshot.get("id") != native["id"] or link.get("kind") != item["kind"]
                        or link.get("fingerprint") != business_sha(item["kind"], item["data"])
                        or business_sha(item["kind"], snapshot) != link["fingerprint"]
                        or link.get("rows") != item["rows"] or link.get("externalIds") != item["externalIds"]):
                    fail("The applied intake differs from its original business record.", "INTAKE_RECEIVING")
                operation = domain.enum(link.get("operation"), ("CREATED", "REUSED"), "Native intake operation")
                decision = decisions.get(item["key"], {})
                if operation == "REUSED" and (decision.get("action") != "REUSE" or decision.get("recordId") != native["id"]):
                    fail("A matched record lacks its original reuse decision.", "INTAKE_RECEIVING")
                if operation == "CREATED" and (snapshot.get("version") != version or snapshot.get("state") != ("LOGGED" if item["kind"] == "work" else "RECEIVED")
                        or snapshot.get("sourceIds") != [source["id"]] or decision.get("action") == "REUSE"):
                    fail("A created native record does not belong to its original intake.", "INTAKE_RECEIVING")
                original = domain.prepare(item["kind"], snapshot, {**historical, "restoring": True}, snapshot)
                if any(snapshot.get(key) != value for key, value in original.items() if key != "state"):
                    fail("An original native record differs from its normalized fields.", "INTAKE_RECEIVING")
        previous[ident] = row
    if {event["version"] for event in events if event.get("action") in ACTIONS} != versions:
        fail("The complete case is missing an original work/invoice intake edition.", "INTAKE_RECEIVING")
    return history
