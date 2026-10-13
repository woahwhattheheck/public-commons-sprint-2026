"""Editable work/invoice preparation in the original Operations case.

Saved books use the existing immutable review table. All actual record changes
run through Operations.command; new rows run through the original Work Intake.
"""
from __future__ import annotations
import base64
from copy import deepcopy
import csv
import hashlib
import io
import json
import re
import uuid

from model import Problem, canonical, digest, now, text
import operations_domain as domain
import operations_work_intake as intake
import operations_amendments as amendments
import source_workbooks as xlsx

SCHEMA = "stellar-forge.sf47-work-invoice-workbook.v1"
PURPOSE = "WORK_INVOICE_WORKBOOK"
ACTIONS = ("workbook.prepare", "workbook.save", "workbook.return", "workbook.record-application")
FIELDS = {
    "WORK": ("rowId", "contributor", "costId", "description", "startDate", "endDate", "hours", "fundingBasis"),
    "INVOICES": ("rowId", "invoiceId", "contributor", "number", "issuedDate", "dueDate", "lineId",
                 "description", "amountUsd", "currency", "costId", "workIds"),
}
SHEETS = {"WORK": "Work", "INVOICES": "Invoices"}
MAX_ROWS = 5000


def fail(message, code="WORKBOOK_INPUT", status=422):
    domain.fail(message, code, status)


def rows_input(value):
    if not isinstance(value, dict) or set(value) != set(FIELDS):
        fail("Retain both complete Work and Invoices tables.")
    result = {}
    for kind, fields in FIELDS.items():
        rows = value[kind]
        if not isinstance(rows, list) or len(rows) > MAX_ROWS:
            fail("A preparation table supports up to 5,000 rows.", status=413)
        seen, result[kind] = set(), []
        for item in rows:
            if not isinstance(item, dict) or set(item) != set(fields):
                fail("Keep the original worksheet headings and every mapped field.")
            row = {field: text(item[field], field, 12000) for field in fields}
            if not any(row.values()):
                continue
            key = row["rowId"]
            if not key or len(key) > 200 or key in seen:
                fail("Keep distinct row IDs, including a new- ID for each new row.")
            seen.add(key)
            result[kind].append(row)
    return result


def native_rows(context, contributor_ids=None):
    selected = set([r["id"] for r in context["records"]["contributors"]] if contributor_ids is None else contributor_ids)
    result = {"WORK": [], "INVOICES": []}
    for row in context["records"]["work"]:
        if row["contributorId"] in selected:
            result["WORK"].append({"rowId": row["id"], "contributor": row["contributorId"],
                **{key: row.get(key) or "" for key in FIELDS["WORK"][2:]}})
    for row in context["records"]["invoices"]:
        if row["contributorId"] not in selected:
            continue
        for line in row["lines"]:
            result["INVOICES"].append({"rowId": row["id"] + "/" + line["id"], "invoiceId": row["id"],
                "contributor": row["contributorId"], "number": row["number"],
                "issuedDate": row["issuedDate"], "dueDate": row.get("dueDate") or "", "currency": "USD",
                "lineId": line["id"], "description": line["description"], "amountUsd": line["amountUsd"],
                "costId": line.get("costId") or "", "workIds": ";".join(line["workIds"])})
    return rows_input(result)


def saved(ops, case_id):
    return [json.loads(row[0]) for row in ops.db.execute(
        "SELECT body_json FROM ops_reviews WHERE program_id=? ORDER BY rowid", (case_id,))
        if json.loads(row[0]).get("purpose") == PURPOSE]


def selected(ops, case_id, ident):
    found = ops.db.execute("SELECT body_json FROM ops_reviews WHERE program_id=? AND id=?", (case_id, ident)).fetchone()
    row = json.loads(found[0]) if found else None
    if row is None or row.get("purpose") != PURPOSE:
        fail("Open a saved work/invoice preparation.", "WORKBOOK_NOT_FOUND", 404)
    return row


def summary(row):
    book = row["workbook"]
    return {"id": row["id"], "rootId": book["rootId"], "previousId": book["previousId"],
        "name": book["name"], "version": row["version"], "createdAt": row["createdAt"],
        "actor": row["actor"], "state": book["state"], "rows": {k: len(v) for k, v in book["rows"].items()},
        "sha256": row["workbookSha256"]}


def latest(ops, case_id, root_id):
    for found in ops.db.execute("SELECT body_json FROM ops_reviews WHERE program_id=? ORDER BY rowid DESC", (case_id,)):
        row = json.loads(found[0])
        if row.get("purpose") == PURPOSE and row["workbook"]["rootId"] == root_id:
            return row
    return None


def merge_rows(baseline, current, incoming, decisions=None, scope="case"):
    decisions = decisions or {}
    if not isinstance(decisions, dict):
        fail("Record field choices as an object.")
    merged, changes, conflicts, omitted = deepcopy(current), [], [], []
    for kind in FIELDS:
        base = {r["rowId"]: r for r in baseline[kind]}
        present = {r["rowId"]: r for r in current[kind]}
        returned = {r["rowId"]: r for r in incoming[kind]}
        output = {r["rowId"]: r for r in merged[kind]}
        for key in base.keys() - returned.keys():
            omitted.append({"kind": kind, "rowId": key, "action": "KEEP_CURRENT"})
        for key, row in returned.items():
            if key not in base:
                if key not in present:
                    if not key.startswith("new-"):
                        fail("Unknown row " + key + ". Keep native row IDs or use a distinct new- ID.")
                    output[key] = deepcopy(row)
                    changes.append({"kind": kind, "rowId": key, "field": "*", "status": "NEW"})
                    continue
                original = {field: "" for field in FIELDS[kind]}
                original["rowId"] = key
            else:
                original = base[key]
                if key not in present:
                    fail("A retained source row is missing from the current case. Reopen its original case.",
                         "WORKBOOK_SOURCE_CONFLICT", 409)
            target = deepcopy(present[key])
            for field in FIELDS[kind]:
                old, live, received = original[field], present[key][field], row[field]
                if field == "rowId" or received == old:
                    continue
                status = "RETURNED" if live == old else "SAME_CHANGE" if live == received else "CONFLICT"
                decision_key = scope + "/" + kind + "/" + key + "/" + field
                entry = {"key": decision_key, "kind": kind, "rowId": key, "field": field,
                         "original": old, "current": live, "returned": received, "status": status}
                if status == "CONFLICT":
                    decision = decisions.get(decision_key)
                    if not isinstance(decision, dict) or decision.get("choice") not in ("CURRENT", "RETURNED") or not str(decision.get("reason", "")).strip():
                        conflicts.append(entry)
                        changes.append(entry)
                        continue
                    entry["decision"] = {"choice": decision["choice"],
                                         "reason": text(decision["reason"], "Conflict reason", 4000, True)}
                    target[field] = live if decision["choice"] == "CURRENT" else received
                else:
                    target[field] = received
                changes.append(entry)
            output[key] = target
        merged[kind] = list(output.values())
    return {"rows": rows_input(merged), "changes": changes, "conflicts": conflicts, "omitted": omitted}


def _csv(kind, rows):
    fields = intake.FIELDS[kind]
    output = io.StringIO(newline="")
    writer = csv.writer(output, lineterminator="\n")
    writer.writerow(fields)
    for row in rows:
        writer.writerow([row["rowId"] if field == "externalId" else row.get(field, "") for field in fields])
    return output.getvalue().encode("utf-8")


def _new_preview(ops, context, root_id, kind, rows, decisions):
    raw = _csv(kind, rows)
    sha = hashlib.sha256(raw).hexdigest()
    source = {"id": "source-" + sha[:32], "filename": root_id + "-" + kind.lower() + ".csv",
              "sha256": sha, "bytes": len(raw)}
    virtual = deepcopy(context)
    virtual["sources"][source["id"]] = source
    parsed = intake.parse_source(raw, intake.DEFAULT_FORMAT)
    document = intake.initial_document(kind, intake.DEFAULT_FORMAT, parsed)
    document["sourceSystem"] = "workbook:" + root_id
    document["recordDecisions"] = decisions
    batch = {"id": "intake-" + sha[:32], "revision": 1, "kind": kind, "sourceId": source["id"],
             "sourceSha256": sha, "state": "DRAFT", "name": source["filename"]}
    batch["sha256"] = digest(batch)
    result = intake.preview(virtual, source, raw, batch, document, intake.load(ops, context["program"]["id"]))
    return {"kind": kind, "source": source, "csv": raw.decode("utf-8"), "document": result["document"],
            "preview": result}


def preview(ops, context, body):
    book = selected(ops, context["program"]["id"], body.get("bookId"))
    root = selected(ops, context["program"]["id"], book["workbook"]["rootId"])
    if latest(ops, context["program"]["id"], root["id"])["id"] != book["id"]:
        fail("A newer workbook edition exists. Open it before previewing or applying.", "WORKBOOK_EDITION_CONFLICT", 409)
    if book["workbook"]["state"] == "APPLIED":
        fail("This preparation is already applied. Prepare a new book from the current case.", "WORKBOOK_APPLIED", 409)
    incoming = rows_input(body.get("rows", book["workbook"]["rows"]))
    decisions = body.get("decisions", book["workbook"].get("decisions", {}))
    current_rows = native_rows(context)
    for kind in FIELDS:
        original_ids = {row["rowId"] for row in root["workbook"]["rows"][kind]}
        current_rows[kind] = [row for row in current_rows[kind] if row["rowId"] in original_ids
                             or row["contributor"] in root["workbook"]["contributorIds"]]
    merged = merge_rows(root["workbook"]["rows"], current_rows, incoming, decisions)
    current_maps = {kind: {r["id"]: r for r in context["records"][kind]} for kind in ("work", "invoices")}
    updates, issues = [], []
    virtual = deepcopy(context)
    new_rows = {kind: [] for kind in FIELDS}
    invoice_rows = {}
    for row in merged["rows"]["WORK"]:
        if row["rowId"].startswith("new-"):
            new_rows["WORK"].append(row)
            continue
        before = current_maps["work"].get(row["rowId"])
        if not before:
            fail("The original work record is missing.")
        data = {**before, "contributorId": row["contributor"], **{k: row[k] for k in FIELDS["WORK"][2:]}}
        data["costId"] = data["costId"] or None
        try:
            if intake.business_value("work", data) == intake.business_value("work", before):
                continue
            prepared = domain.prepare("work", data, virtual, before)
            updates.append({"kind": "work", "id": before["id"], "before": before, "data": prepared})
            virtual["records"]["work"] = [({**record, **prepared} if record["id"] == before["id"] else record)
                                          for record in virtual["records"]["work"]]
        except Problem as exc:
            issues.append({"kind": "WORK", "rowId": row["rowId"], "message": str(exc)})
    for row in merged["rows"]["INVOICES"]:
        if row["rowId"].startswith("new-"):
            if row["invoiceId"]:
                issues.append({"kind": "INVOICES", "rowId": row["rowId"], "message": "New rows require a blank invoiceId. Use the existing invoice editor to add a line to a retained invoice."})
            new_rows["INVOICES"].append(row)
        else:
            invoice_rows.setdefault(row["invoiceId"], []).append(row)
    for ident, rows in invoice_rows.items():
        before = current_maps["invoices"].get(ident)
        if before is None:
            fail("The original invoice is missing.")
        data = deepcopy(before)
        header = ("contributor", "number", "issuedDate", "dueDate", "currency")
        if any(any(r[k] != rows[0][k] for k in header) for r in rows):
            issues.append({"kind": "INVOICES", "rowId": ident, "message": "Every line of an invoice needs the same supplier, number and dates."})
            continue
        data.update({k: rows[0][k] for k in header if k != "contributor"})
        data["contributorId"] = rows[0]["contributor"]
        data["dueDate"] = data["dueDate"] or None
        line_map = {line["id"]: line for line in data["lines"]}
        for row in rows:
            if row["rowId"] != ident + "/" + row["lineId"] or row["lineId"] not in line_map:
                issues.append({"kind": "INVOICES", "rowId": row["rowId"], "message": "Preserve the original invoice ID and line ID."})
                continue
            line_map[row["lineId"]].update({k: row[k] for k in ("description", "amountUsd", "costId")})
            line_map[row["lineId"]]["costId"] = row["costId"] or None
            line_map[row["lineId"]]["workIds"] = [x.strip() for x in row["workIds"].split(";") if x.strip()]
        try:
            if intake.business_value("invoices", data) == intake.business_value("invoices", before):
                continue
            if data["currency"] != "USD":
                fail("Use the original USD invoice ledger.")
            prepared = domain.prepare("invoices", data, virtual, before)
            updates.append({"kind": "invoices", "id": ident, "before": before, "data": prepared})
        except Problem as exc:
            issues.append({"kind": "INVOICES", "rowId": ident, "message": str(exc)})
    virtual = deepcopy(context)
    for update in updates:
        virtual["records"][update["kind"]] = [({**row, **update["data"]} if row["id"] == update["id"] else row)
                                             for row in virtual["records"][update["kind"]]]
    intake_decisions = body.get("intakeDecisions", book["workbook"].get("intakeDecisions", {}))
    if not isinstance(intake_decisions, dict) or set(intake_decisions) - set(FIELDS):
        fail("Keep the separate Work and Invoices duplicate decisions.")
    batches = [_new_preview(ops, virtual, root["id"], kind, rows, intake_decisions.get(kind, []))
               for kind, rows in new_rows.items() if rows]
    if sum(b["preview"]["summary"]["newRecords"] for b in batches) + sum(len(x) for x in context["records"].values()) > MAX_ROWS:
        issues.append({"kind": "ALL", "rowId": "", "message": "The complete preparation exceeds the original 5,000-record case capacity."})
    ready = not issues and not merged["conflicts"] and all(b["preview"]["summary"]["ready"] for b in batches)
    result = {"schema": SCHEMA + ".preview", "bookId": book["id"], "bookSha256": book["workbookSha256"],
        "caseVersion": context["program"]["version"], "rows": incoming, "decisions": deepcopy(decisions),
        "intakeDecisions": deepcopy(intake_decisions), "comparison": merged, "updates": updates,
        "intakes": batches, "issues": issues, "ready": ready}
    result["previewSha256"] = digest(result)
    return result


def save(ops, context, action, data, actor, version, note):
    if not note:
        fail("Name this workbook edition's preparation or return.")
    case_id = context["program"]["id"]
    ident = "review-" + uuid.uuid4().hex
    predecessor = None
    source_change = None
    if action == "workbook.prepare":
        available = [r["id"] for r in context["records"]["contributors"]]
        contributors = data.get("contributorIds", available)
        if not isinstance(contributors, list) or len(set(contributors)) != len(contributors) or any(x not in available for x in contributors):
            fail("Select retained contributors or suppliers.")
        book = {"schema": SCHEMA, "name": text(data.get("name"), "Workbook name", 300, True),
            "rootId": ident, "previousId": None, "contributorIds": contributors,
            "rows": native_rows(context, contributors), "decisions": {}, "intakeDecisions": {},
            "state": "DRAFT", "returnedSources": []}
    else:
        predecessor = selected(ops, case_id, data.get("bookId"))
        book = deepcopy(predecessor["workbook"])
        if latest(ops, case_id, book["rootId"])["id"] != predecessor["id"] or book["state"] == "APPLIED":
            fail("Open the latest unapplied workbook edition.", "WORKBOOK_EDITION_CONFLICT", 409)
        book["previousId"] = predecessor["id"]
        if action == "workbook.record-application":
            book["state"] = "APPLIED"
            book["application"] = deepcopy(data["application"])
        elif action == "workbook.return":
            returned = inspect_return(ops, case_id, data["return"])
            if returned["bookId"] != predecessor["id"] or returned["comparison"]["conflicts"]:
                fail("Resolve the current returned workbook comparison.", "WORKBOOK_RETURN_CONFLICT", 409)
            book["rows"] = returned["comparison"]["rows"]
            source = ops._source_add(case_id, {**returned["file"], "kind": "other"})
            source_change = {"added": [source], "removed": []}
            book["returnedSources"].append({"sourceId": source["id"], "sha256": source["sha256"],
                "exportedBookId": returned["exportedBookId"], "selections": returned["selections"],
                "decisions": deepcopy(data["return"].get("decisions", {})),
                "projectionSha256": digest(returned["projections"])})
        else:
            book["rows"] = rows_input(data.get("rows"))
            book["decisions"] = deepcopy(data.get("decisions", {}))
            book["intakeDecisions"] = deepcopy(data.get("intakeDecisions", {}))
            preview(ops, context, {**data, "bookId": predecessor["id"]})

    snapshot = ops._business(context)
    row = {"id": ident, "version": version, "createdAt": now(), "actor": actor, "note": note,
        "purpose": PURPOSE, "businessSha256": digest(snapshot), "snapshot": snapshot,
        "report": domain.report(**context), "workbook": book, "workbookSha256": digest(book)}
    ops.db.execute("INSERT INTO ops_reviews VALUES(?,?,?)", (case_id, ident, canonical(row)))
    return {"before": summary(predecessor) if predecessor else None, "after": summary(row),
            "kind": "review", "recordId": ident, "sourceChange": source_change, "workbook": summary(row)}


def apply(ops, case_id, body):
    """One original workspace transaction, with native events for every write."""
    def action():
        context = ops._context(case_id)
        if context["program"]["version"] != body.get("expectedVersion"):
            fail("Reopen the current operations version.", "OPERATIONS_CONFLICT", 409)
        candidate = preview(ops, context, {"bookId": body.get("bookId")})
        if not candidate["ready"] or candidate["previewSha256"] != body.get("expectedPreviewSha256"):
            fail("Review the complete current workbook comparison before applying.", "WORKBOOK_PREVIEW_CONFLICT", 409)
        version = context["program"]["version"]
        receipts = []
        def command(name, data):
            nonlocal version
            before_version = version
            receipt = ops.command(case_id, {"action": name, "data": data, "actor": body.get("actor"),
                "note": body.get("note"), "requestId": body.get("requestId"), "expectedVersion": version},
                _within_transaction=True)
            version = receipt["version"]
            if version > before_version:
                receipts.append(receipt)
            return receipt
        for update in candidate["updates"]:
            command("work.save" if update["kind"] == "work" else "invoice.save",
                    {**update["data"], "id": update["id"]})
        for batch in candidate["intakes"]:
            receipt = command("work-intake.upload", {"name": batch["source"]["filename"],
                "kind": batch["kind"], "format": intake.DEFAULT_FORMAT,
                "file": {"filename": batch["source"]["filename"], "contentBase64": base64.b64encode(batch["csv"].encode()).decode(),
                         "mediaType": "text/csv"}})
            retained = intake.selected(ops, case_id, receipt["recordId"])
            if retained["state"] == "APPLIED":
                fail("These source rows were already applied. Reopen the earlier intake.", "WORKBOOK_SOURCE_CONFLICT", 409)
            source, raw = intake.source_for(ops, case_id, retained)
            checked = intake.preview(ops._context(case_id), source, raw, retained, batch["document"], intake.load(ops, case_id))
            command("work-intake.apply", {"intakeId": retained["id"], "expectedRevision": retained["revision"],
                "document": checked["document"], "expectedPreviewSha256": checked["previewSha256"]})
        application = {"bookId": candidate["bookId"], "previewSha256": candidate["previewSha256"],
                       "caseVersion": candidate["caseVersion"], "operations": deepcopy(receipts)}
        final = command("workbook.record-application", {"bookId": body["bookId"], "application": application})
        ops.export(case_id)
        return {**final, "operations": receipts[:-1]}
    return ops.workspace._transaction(body.get("requestId"), {"domain": SCHEMA, "caseId": case_id, "body": body}, action)


def read_return(exported, source_input, selections):
    filename, raw, sha = xlsx.decode_source(source_input)
    if len(raw) > 8 * 1024 * 1024:
        fail("The original operations attachment limit is 8 MiB.", status=413)
    if not isinstance(selections, dict) or set(selections) != set(FIELDS):
        fail("Select a last row and hidden-row policy for both sheets.")
    rows, projections = {}, {}
    with xlsx.opened(source_input) as (source, workbook):
        def project(sheet, fields, last, hidden):
            columns = [{"name": field, "source": chr(65 + i), "blank": "empty", "formula": "reject",
                        "error": "reject", "date": "raw", "trim": False, "valueMap": []}
                       for i, field in enumerate(fields)]
            mapping = {"schema": xlsx.REQUEST_SCHEMA, "plan": {"name": sheet + " return",
                "notes": "Explicit work/invoice returned workbook selection", "sheet": sheet,
                "range": "A1:" + chr(64 + len(fields)) + str(last), "headerRow": None,
                "hiddenRows": hidden, "blankRows": "skip", "mergedCells": "reject", "columns": columns},
                "numericText": {field: "source" for field in fields}}
            result = xlsx.projection_from_open(source, workbook, mapping)
            projection = json.loads(result["text"])
            parsed = list(csv.reader(io.StringIO(projection["csv"]["text"])))
            if len(parsed) < 2 or parsed[1] != list(fields):
                fail("Keep the exact " + sheet + " headings on worksheet row 1.")
            return parsed[2:], projection
        identity, _ = project("Read me", ("Item", "Detail"), 3, "include")
        if identity != [["Book ID", exported["id"]], ["Book source", exported["workbookSha256"]]]:
            fail("This workbook belongs to another saved preparation. Open the book identified on its Read me sheet.",
                 "WORKBOOK_IDENTITY", 409)
        for kind, fields in FIELDS.items():
            options = selections[kind]
            last = domain.integer(options.get("lastRow"), "Last worksheet row", 2, MAX_ROWS + 1)
            hidden = domain.enum(options.get("hiddenRows", "include"), ("include", "exclude"), "Hidden rows")
            values, projections[kind] = project(SHEETS[kind], fields, last, hidden)
            rows[kind] = [dict(zip(fields, cells)) for cells in values]
    return {"rows": rows_input(rows), "projections": projections, "sourceSha256": sha,
            "file": {"filename": filename, "contentBase64": base64.b64encode(raw).decode(),
                     "mediaType": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"}}


def inspect_return(ops, case_id, body):
    exported = selected(ops, case_id, body.get("bookId"))
    current = latest(ops, case_id, exported["workbook"]["rootId"])
    if current["workbook"]["state"] == "APPLIED":
        fail("Prepare a new workbook after applying the preceding one.", "WORKBOOK_APPLIED", 409)
    result = read_return(exported, body.get("source"), body.get("selections"))
    merged = merge_rows(exported["workbook"]["rows"], current["workbook"]["rows"], result["rows"],
                        body.get("decisions", {}), "draft")
    return {"bookId": current["id"], "exportedBookId": exported["id"], "comparison": merged,
            "file": result["file"], "sourceSha256": result["sourceSha256"],
            "selections": body["selections"], "projections": result["projections"]}


def validate_import(context, reviews, events, files, plan_for_version, work_intakes=()):
    from operations_supplier_statements import sources_at
    heads = {}
    books = {row["id"]: row for row in reviews if row.get("purpose") == PURPOSE}
    for row in sorted(books.values(), key=lambda item: item["version"]):
        book = row.get("workbook", {})
        if book.get("schema") != SCHEMA or digest(book) != row.get("workbookSha256"):
            fail("The retained workbook edition differs from its complete source.", "WORKBOOK_RECEIVING")
        if rows_input(book["rows"]) != book["rows"]:
            fail("The saved workbook rows differ from their normalized inputs.", "WORKBOOK_RECEIVING")
        original_records = amendments._records_at(events, row["version"] - 1, work_intakes)
        original_sources = sources_at(events, row["version"] - 1)
        if (amendments._record_set(row["snapshot"]["records"]) != original_records
                or not amendments.same_plan(row["snapshot"]["plan"], plan_for_version(row["version"] - 1))
                or {s["id"]: s for s in row["snapshot"]["sources"]} != original_sources):
            fail("The workbook snapshot differs from its original native record, plan or source history.", "WORKBOOK_RECEIVING")
        root = books.get(book["rootId"])
        previous = books.get(book["previousId"]) if book["previousId"] else None
        if root is None or root["workbook"]["previousId"] is not None or root["version"] > row["version"]:
            fail("Keep the original prepared workbook edition.", "WORKBOOK_RECEIVING")
        if book["previousId"] and (previous is None or previous["version"] >= row["version"] or previous["workbook"]["rootId"] != root["id"]):
            fail("Keep the complete ordered workbook editions.", "WORKBOOK_RECEIVING")
        event = events[row["version"] - 1]
        if (event.get("action") not in ACTIONS or event.get("recordId") != row["id"]
                or event.get("after") != summary(row) or event.get("before") != (summary(previous) if previous else None)
                or event.get("actor") != row["actor"] or event.get("note") != row["note"]):
            fail("The workbook does not join its original operations event.", "WORKBOOK_RECEIVING")
        expected_state = "APPLIED" if event["action"] == "workbook.record-application" else "DRAFT"
        if book["state"] != expected_state or heads.get(book["rootId"]) != book["previousId"]:
            fail("Retain the complete ordered workbook state and editions.", "WORKBOOK_RECEIVING")
        if previous and previous["workbook"]["state"] != "DRAFT":
            fail("An applied preparation starts a new workbook.", "WORKBOOK_RECEIVING")
        if previous and (book["name"] != root["workbook"]["name"] or book["contributorIds"] != root["workbook"]["contributorIds"]):
            fail("Keep the original preparation identity and selection.", "WORKBOOK_RECEIVING")
        prior_sources = previous["workbook"]["returnedSources"] if previous else []
        if (event["action"] == "workbook.return" and (len(book["returnedSources"]) != len(prior_sources) + 1
                or book["returnedSources"][:-1] != prior_sources)
                or event["action"] != "workbook.return" and book["returnedSources"] != prior_sources):
            fail("Retain every prior original workbook return.", "WORKBOOK_RECEIVING")
        heads[book["rootId"]] = row["id"]
        for source in book["returnedSources"]:
            raw = files.get("sources/" + source["sourceId"])
            if raw is None or hashlib.sha256(raw).hexdigest() != source["sha256"]:
                fail("Keep every original returned workbook attachment.", "WORKBOOK_RECEIVING")
        if event["action"] == "workbook.prepare":
            if book["rootId"] != row["id"] or book["rows"] != native_rows(row["snapshot"], book["contributorIds"]):
                fail("The prepared workbook differs from its original native rows.", "WORKBOOK_RECEIVING")
        if event["action"] == "workbook.return":
            retained = book["returnedSources"][-1]
            exported = books.get(retained.get("exportedBookId"))
            if exported is None or exported["workbook"]["rootId"] != root["id"] or exported["version"] >= row["version"]:
                fail("Keep the original exported workbook edition.", "WORKBOOK_RECEIVING")
            raw = files["sources/" + retained["sourceId"]]
            metadata = next((s for s in context["sources"].values() if s["id"] == retained["sourceId"]), None)
            received = read_return(exported, {"filename": metadata["filename"],
                "dataBase64": base64.b64encode(raw).decode()}, retained["selections"])
            merged = merge_rows(exported["workbook"]["rows"], previous["workbook"]["rows"], received["rows"],
                                retained["decisions"], "draft")
            if merged["conflicts"] or merged["rows"] != book["rows"] or digest(received["projections"]) != retained["projectionSha256"]:
                fail("The workbook return differs from its original cells and saved field choices.", "WORKBOOK_RECEIVING")
        if book["state"] == "APPLIED":
            application = book.get("application")
            if not isinstance(application, dict) or application.get("bookId") != book["previousId"]:
                fail("Keep the original applied workbook edition.", "WORKBOOK_RECEIVING")
            if any(book[field] != previous["workbook"][field] for field in ("rows", "decisions", "intakeDecisions")):
                fail("Apply the exact saved workbook input.", "WORKBOOK_RECEIVING")
            domain.sha(application["previewSha256"], "Original applied workbook preview", False)
            version = application["caseVersion"]
            for receipt in application["operations"]:
                observed = events[receipt["version"] - 1]
                if (receipt["version"] != version + 1 or observed["action"] != receipt["action"]
                        or observed["recordId"] != receipt["recordId"] or observed["requestId"] != event["requestId"]
                        or observed["action"] not in ("work.save", "invoice.save", "work-intake.upload", "work-intake.apply")):
                    fail("The workbook's native operations differ from the retained events.", "WORKBOOK_RECEIVING")
                version = receipt["version"]
            if version != row["version"] - 1:
                fail("Keep the complete native workbook application sequence.", "WORKBOOK_RECEIVING")
    if {e["recordId"] for e in events if e.get("action") in ACTIONS} != set(books):
        fail("Keep every saved work/invoice preparation.", "WORKBOOK_RECEIVING")
