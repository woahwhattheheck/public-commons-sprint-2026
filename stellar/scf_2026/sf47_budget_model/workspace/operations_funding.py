"""Exact internal funding assignments over original Grant Operations costs and work."""
from __future__ import annotations

import base64
from copy import deepcopy
from decimal import Decimal, localcontext
import hashlib
import html
import json
import re

from model import Problem, canonical, csv_bytes, digest, now, text, short_id
import operations_domain as domain

SCHEMA = "stellar-forge.sf47-cost-funding.v1"
MEDIA = "application/vnd.stellar-forge.cost-funding+json"
MARKER = "costFunding"
BOOK_ID = "cost-funding"
KINDS = ("PREAWARD", "GRANT", "CUSTOMER", "INTERNAL", "OTHER")
ELIGIBILITY = ("UNASSESSED", "SUPPORTED", "EXCLUDED")
MAX_TARGETS = 10000
MAX_ALLOCATIONS = 20000
SELECTION_FILES = {"cost-funding-selection.json", "cost-funding-report.json",
                   "cost-funding.html", "cost-funding-allocations.csv",
                   "cost-funding-balances.csv", "cost-funding-changes.csv"}
BASIS = (
    "This is a source-bound internal funding assignment. Hours and invoice USD "
    "are separate quantities. Work acceptance, supplier invoice state, observed "
    "cash, issuer decisions and actual grant conditions retain their original "
    "meaning. An eligibility entry is the recording operator's sourced assessment. "
    "An unassigned remainder is the exact original quantity without an assignment."
)


def fail(message, code="INVALID_COST_FUNDING", status=422):
    domain.fail(message, code, status)


def obj(value, keys, label):
    if not isinstance(value, dict) or set(value) - set(keys):
        fail(label + ": use the complete supported object.")
    return value


def rows(value, label, maximum):
    if not isinstance(value, list) or len(value) > maximum:
        fail(label + ": use at most " + str(maximum) + " complete rows.")
    return value


def decimal_text(value, places, label, optional=False):
    if optional and value in (None, ""):
        return None
    if not isinstance(value, str) or not re.fullmatch(
            r"(?:0|[1-9][0-9]{0,12})(?:\.[0-9]{1," + str(places) + r"})?", value):
        fail(label + ": enter an exact nonnegative decimal string.")
    if Decimal(value) > Decimal("1000000000000"):
        fail(label + ": quantity exceeds the supported bound.")
    return dec(Decimal(value))


def dec(value):
    number = format(Decimal(value), "f")
    if "." in number:
        number = number.rstrip("0").rstrip(".")
    return number if number and number != "-0" else "0"


def refs(value, available, label):
    result = rows(value, label, 200)
    if (any(not isinstance(v, str) or v not in available for v in result)
            or len(result) != len(set(result))):
        fail(label + ": select distinct original source identities.")
    return sorted(result)


def row_id(value, label):
    value = text(value, label, 100, True)
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,99}", value):
        fail(label + ": use a stable plain row identity.")
    return value


def target_key(kind, record_id, line_id=None):
    return canonical([kind, record_id, line_id])


def targets(context):
    """Every retained original work row and invoice line, including void history."""
    contributors = {r["id"]: r for r in context["records"]["contributors"]}
    result = []
    for work in sorted(context["records"]["work"], key=lambda r: r["id"]):
        result.append({
            "key": target_key("WORK", work["id"]), "kind": "WORK", "recordId": work["id"],
            "lineId": None, "recordVersion": work["version"], "recordSha256": digest(work),
            "state": work["state"], "date": work["endDate"], "startDate": work["startDate"],
            "costId": work["costId"], "contributorId": work["contributorId"],
            "contributor": contributors[work["contributorId"]]["name"],
            "description": work["description"], "invoiceNumber": None,
            "unit": "HOURS", "quantity": dec(0 if work["state"] == "VOID" else Decimal(work["hours"])),
            "originalQuantity": work["hours"], "originalFundingBasis": work["fundingBasis"],
            "workIds": [work["id"]], "sourceIds": work["sourceIds"],
        })
    for invoice in sorted(context["records"]["invoices"], key=lambda r: r["id"]):
        for line in invoice["lines"]:
            result.append({
                "key": target_key("INVOICE", invoice["id"], line["id"]), "kind": "INVOICE",
                "recordId": invoice["id"], "lineId": line["id"],
                "recordVersion": invoice["version"], "recordSha256": digest(invoice),
                "state": invoice["state"], "date": invoice["issuedDate"], "startDate": invoice["issuedDate"],
                "costId": line["costId"], "contributorId": invoice["contributorId"],
                "contributor": contributors[invoice["contributorId"]]["name"],
                "description": line["description"], "invoiceNumber": invoice["number"],
                "unit": "USD", "quantity": dec(0 if invoice["state"] == "VOID" else Decimal(line["amountUsd"])),
                "originalQuantity": line["amountUsd"], "originalFundingBasis": None,
                "workIds": deepcopy(line["workIds"]), "sourceIds": invoice["sourceIds"],
            })
    if len(result) > MAX_TARGETS:
        fail("The full original population exceeds 10,000 work rows and invoice lines.", status=413)
    return result


def normalized(context, raw):
    value = obj(raw, ("title", "status", "asOfDate", "periodStart", "periodEnd", "note",
                      "funds", "assignments"), "Funding book")
    start = domain.calendar(value.get("periodStart"), "Reporting start", True)
    end = domain.calendar(value.get("periodEnd"), "Reporting end")
    if start and start > end:
        fail("The report start must be on or before its end.")
    available = {key: row for key, row in context["sources"].items() if MARKER not in row}
    funds, fund_map = [], {}
    for raw_fund in rows(value.get("funds", []), "Funding sources", 50):
        fund = obj(raw_fund, ("id", "name", "kind", "reference", "decision",
                            "sourceIds", "conditions", "costWindowStart", "costWindowEnd",
                            "receiptTiming", "limitUsd", "note"), "Funding source")
        ident = row_id(fund.get("id"), "Funding source ID")
        if ident == "unassigned" or ident in fund_map:
            fail("Funding source IDs must be distinct and cannot use unassigned.")
        row = {
            "id": ident, "name": text(fund.get("name", ""), "Funding source name", 300, True),
            "kind": domain.enum(fund.get("kind"), KINDS, "Funding category"),
            "reference": text(fund.get("reference", ""), "Original agreement or funding reference", 2000),
            "decision": domain.enum(fund.get("decision", "PROPOSED"),
                                    ("PROPOSED", "RECORDED"), "Funding decision basis"),
            "sourceIds": refs(fund.get("sourceIds", []), available, "Funding source attachments"),
            "conditions": text(fund.get("conditions", ""), "Actual funding conditions", 12000),
            "costWindowStart": domain.calendar(fund.get("costWindowStart"), "Source-stated cost window start", True),
            "costWindowEnd": domain.calendar(fund.get("costWindowEnd"), "Source-stated cost window end", True),
            "receiptTiming": text(fund.get("receiptTiming", ""), "Source-stated receipt timing", 4000),
            "limitUsd": decimal_text(fund.get("limitUsd"), 2, "Selected assignment limit USD", True),
            "note": text(fund.get("note", ""), "Funding source basis", 12000),
        }
        if row["costWindowStart"] and row["costWindowEnd"] and row["costWindowStart"] > row["costWindowEnd"]:
            fail("The source-stated cost window is reversed.")
        if row["decision"] == "RECORDED" and (not row["sourceIds"] or not row["reference"] or not row["note"]):
            fail("A recorded funding decision needs its original attachment, reference and basis.")
        funds.append(row)
        fund_map[ident] = row
    population = {row["key"]: row for row in targets(context)}
    assignments, seen = [], set()
    for raw_row in rows(value.get("assignments", []), "Funding assignment rows", MAX_TARGETS):
        row = obj(raw_row, ("kind", "recordId", "lineId", "note", "allocations"), "Original cost or work assignment")
        kind = domain.enum(row.get("kind"), ("WORK", "INVOICE"), "Assignment source")
        record_id = text(row.get("recordId"), "Original work or invoice ID", 100, True)
        line_id = row.get("lineId")
        if kind == "WORK":
            if line_id is not None:
                fail("A work assignment uses its original work ID without an invoice line.")
        else:
            line_id = text(line_id, "Original invoice line ID", 100, True)
        key = target_key(kind, record_id, line_id)
        if key in seen or key not in population:
            fail("Each assignment must select one distinct current original work row or invoice line.")
        seen.add(key)
        target = population[key]
        parts, used = [], set()
        for raw_part in rows(row.get("allocations", []), "Assignments for a source row", 50):
            part = obj(raw_part, ("fundId", "quantity", "eligibility", "sourceIds", "basis"), "Funding allocation")
            fund_id = part.get("fundId")
            if not isinstance(fund_id, str) or fund_id not in fund_map or fund_id in used:
                fail("Use each retained funding source at most once on an original row.")
            used.add(fund_id)
            selected = {
                "fundId": fund_id,
                "quantity": decimal_text(part.get("quantity"), 4 if kind == "WORK" else 2,
                                         "Assigned hours" if kind == "WORK" else "Assigned invoice USD"),
                "eligibility": domain.enum(part.get("eligibility", "UNASSESSED"), ELIGIBILITY, "Eligibility assessment"),
                "sourceIds": refs(part.get("sourceIds", []), available, "Allocation basis attachments"),
                "basis": text(part.get("basis", ""), "Allocation and eligibility basis", 12000),
            }
            if selected["eligibility"] != "UNASSESSED" and (not selected["sourceIds"] or not selected["basis"]):
                fail("A supported or excluded eligibility assessment needs its exact source and explanation.")
            parts.append(selected)
        if sum((Decimal(part["quantity"]) for part in parts), Decimal(0)) > Decimal(target["quantity"]):
            fail("Assigned " + target["unit"] + " exceed the current original quantity for " +
                 target["recordId"] + ("/" + line_id if line_id else "") +
                 ". Keep the draft and reallocate this corrected source before saving.", "FUNDING_OVERALLOCATED", 409)
        assignments.append({"kind": kind, "recordId": record_id, "lineId": line_id,
                            "note": text(row.get("note", ""), "Source-row allocation note", 12000),
                            "allocations": sorted(parts, key=lambda part: part["fundId"])})
    if sum(len(r["allocations"]) for r in assignments) > MAX_ALLOCATIONS:
        fail("The complete book exceeds 20,000 allocation parts.", status=413)
    result = {
        "title": text(value.get("title", ""), "Funding book title", 300, True),
        "status": domain.enum(value.get("status", "DRAFT"), ("DRAFT", "REVIEWED"), "Internal allocation review"),
        "asOfDate": domain.calendar(value.get("asOfDate"), "Source review date"),
        "periodStart": start, "periodEnd": end,
        "note": text(value.get("note", ""), "Complete allocation review note", 12000),
        "funds": sorted(funds, key=lambda r: r["id"]),
        "assignments": sorted(assignments, key=lambda r: target_key(r["kind"], r["recordId"], r["lineId"])),
    }
    if result["status"] == "REVIEWED" and not result["note"]:
        fail("A reviewed internal allocation needs the recording operator's complete review note.")
    return result


def source_snapshot(context, document):
    records = {key: deepcopy(sorted(context["records"][key], key=lambda row: row["id"]))
               for key in ("contributors", "work", "invoices")}
    selected = set()
    for fund in document["funds"]:
        selected.update(fund["sourceIds"])
    for row in document["assignments"]:
        for part in row["allocations"]:
            selected.update(part["sourceIds"])
    for key in records:
        for row in records[key]:
            selected.update(row.get("sourceIds", []))
    return {
        "case": {key: deepcopy(context["program"][key]) for key in ("id", "version", "name", "mode", "createdAt")},
        "plan": deepcopy(context["plan"]), "records": records,
        "sources": [deepcopy(context["sources"][ident]) for ident in sorted(selected)],
    }


def captured_context(source):
    return {"program": source["case"], "plan": source["plan"], "records": source["records"],
            "sources": {row["id"]: row for row in source["sources"]}}


def span(date, document):
    if date > document["periodEnd"]:
        return "AFTER_END"
    if document["periodStart"] and date < document["periodStart"]:
        return "OPENING"
    return "PERIOD"


def changed_rows(before, after, key):
    left = {key(row): row for row in before}
    right = {key(row): row for row in after}
    return [{"key": ident, "change": "ADDED" if ident not in left else "REMOVED" if ident not in right else "CHANGED",
             "before": deepcopy(left.get(ident)), "after": deepcopy(right.get(ident))}
            for ident in sorted(set(left) | set(right)) if left.get(ident) != right.get(ident)]


def changes(previous, document, source):
    if previous is None:
        return {"previous": None, "originalRows": [], "assignments": [], "funds": []}
    old = previous["edition"]
    return {
        "previous": {"revision": old["revision"], "sourceId": previous["source"]["id"],
                     "sourceSha256": previous["source"]["sha256"], "editionSha256": old["sha256"]},
        "originalRows": changed_rows(targets(captured_context(old["source"])), targets(captured_context(source)),
                                     lambda row: row["key"]),
        "assignments": changed_rows(old["document"]["assignments"], document["assignments"],
                                    lambda row: target_key(row["kind"], row["recordId"], row["lineId"])),
        "funds": changed_rows(old["document"]["funds"], document["funds"], lambda row: row["id"]),
    }


def calculation(document, source, comparison):
    with localcontext() as ctx:
        ctx.prec = 60
        context = captured_context(source)
        population = targets(context)
        assignments = {target_key(row["kind"], row["recordId"], row["lineId"]): row for row in document["assignments"]}
        funds = {row["id"]: row for row in document["funds"]}
        groups = {ident: {"id": ident, "name": value["name"], "kind": value["kind"], "decision": value["decision"],
                          "limitUsd": value["limitUsd"]} for ident, value in funds.items()}
        groups["unassigned"] = {"id": "unassigned", "name": "Unassigned", "kind": "UNASSIGNED",
                                 "decision": "UNASSIGNED", "limitUsd": None}
        dimensions = ("invoiceUsd", "workHours", "acceptedHours", "reviewedInvoiceUsd",
                      "supportedInvoiceUsd", "excludedInvoiceUsd")
        for group in groups.values():
            for boundary in ("opening", "period", "closing", "afterEnd"):
                group[boundary] = {name: Decimal(0) for name in dimensions}
        balances, allocation_rows, findings = [], [], []
        package_map = {row["id"]: row for row in source["plan"]["scenario"]["future_costs"]}
        for target in population:
            assignment = assignments.get(target["key"], {"note": "", "allocations": []})
            allocated = sum((Decimal(row["quantity"]) for row in assignment["allocations"]), Decimal(0))
            remainder = Decimal(target["quantity"]) - allocated
            interval = span(target["date"], document)
            balance = {**deepcopy(target), "interval": interval, "assigned": dec(allocated),
                       "unassigned": dec(remainder), "allocationNote": assignment["note"],
                       "spansPeriodStart": bool(document["periodStart"] and target["startDate"] < document["periodStart"] <= target["date"])}
            balances.append(balance)
            parts = deepcopy(assignment["allocations"])
            if remainder != 0 or not parts:
                parts.append({"fundId": None, "quantity": dec(remainder), "eligibility": "UNASSESSED",
                              "sourceIds": [], "basis": ""})
            for part in parts:
                fund_id = part["fundId"] or "unassigned"
                fund = funds.get(part["fundId"])
                amount = Decimal(part["quantity"])
                entry = {
                    **deepcopy(target), **part, "fundName": groups[fund_id]["name"],
                    "fundKind": groups[fund_id]["kind"], "fundDecision": groups[fund_id]["decision"],
                    "interval": interval, "allocationNote": assignment["note"], "windowObservation": "UNSTATED",
                    "fundReference": fund["reference"] if fund else "",
                    "fundSourceIds": deepcopy(fund["sourceIds"]) if fund else [],
                }
                if fund and (fund["costWindowStart"] or fund["costWindowEnd"]):
                    outside = ((fund["costWindowStart"] and target["date"] < fund["costWindowStart"])
                               or (fund["costWindowEnd"] and target["date"] > fund["costWindowEnd"]))
                    entry["windowObservation"] = "OUTSIDE_SOURCE_WINDOW" if outside else "WITHIN_SOURCE_WINDOW"
                    if outside and amount:
                        findings.append({"code": "SOURCE_WINDOW", "key": target["key"], "fundId": fund_id,
                                         "message": "The original work-end or invoice-issued date is outside the recorded window. Review the actual cost-incurrence rule and its source."})
                if (target["kind"] == "WORK" and fund and amount and
                        fund["kind"] != target["originalFundingBasis"]):
                    findings.append({"code": "WORK_BASIS_DIFFERS", "key": target["key"], "fundId": fund_id,
                                     "message": "This internal assignment differs from the original Work fundingBasis. The original record and this sourced allocation remain separately retained."})
                if fund and fund["kind"] == "GRANT" and amount and part["eligibility"] == "UNASSESSED":
                    findings.append({"code": "GRANT_ELIGIBILITY_OPEN", "key": target["key"], "fundId": fund_id,
                                     "message": "The grant assignment has no completed eligibility assessment. Its quantity remains assigned with eligibility unassessed."})
                if fund and fund["decision"] == "PROPOSED" and amount:
                    findings.append({"code": "PROPOSED_FUNDING", "key": target["key"], "fundId": fund_id,
                                     "message": "Funding is proposed under the retained source; assignment does not establish availability."})
                allocation_rows.append(entry)
                buckets = ["afterEnd"] if interval == "AFTER_END" else ["closing", "opening" if interval == "OPENING" else "period"]
                for boundary in buckets:
                    values = groups[fund_id][boundary]
                    if target["kind"] == "WORK":
                        values["workHours"] += amount
                        if target["state"] == "ACCEPTED":
                            values["acceptedHours"] += amount
                    else:
                        values["invoiceUsd"] += amount
                        if target["state"] == "REVIEWED":
                            values["reviewedInvoiceUsd"] += amount
                        if part["eligibility"] == "SUPPORTED":
                            values["supportedInvoiceUsd"] += amount
                        elif part["eligibility"] == "EXCLUDED":
                            values["excludedInvoiceUsd"] += amount
            if remainder:
                findings.append({"code": "UNASSIGNED", "key": target["key"], "fundId": None,
                                 "message": dec(remainder) + " " + target["unit"] + " remains unassigned."})
        totals = {boundary: {name: dec(sum((g[boundary][name] for g in groups.values()), Decimal(0)))
                            for name in dimensions} for boundary in ("opening", "period", "closing", "afterEnd")}
        summary = []
        for group in groups.values():
            limit = group["limitUsd"]
            group["limitExcessUsd"] = dec(max(Decimal(0), group["closing"]["invoiceUsd"] - Decimal(limit))) if limit is not None else None
            for boundary in ("opening", "period", "closing", "afterEnd"):
                group[boundary] = {key: dec(value) for key, value in group[boundary].items()}
            summary.append(group)
        by_package = []
        for cost_id in sorted({row["costId"] for row in population}, key=lambda v: v or ""):
            selected = [row for row in balances if row["costId"] == cost_id and row["interval"] != "AFTER_END"]
            original = package_map.get(cost_id, {})
            by_package.append({
                "costId": cost_id, "plannedUsd": original.get("amount_usd"), "plannedHours": original.get("estimated_hours"),
                **{key: dec(sum((Decimal(row[field]) for row in selected if row["kind"] == kind), Decimal(0)))
                   for key, kind, field in (("invoiceUsd", "INVOICE", "quantity"), ("assignedInvoiceUsd", "INVOICE", "assigned"),
                                            ("unassignedInvoiceUsd", "INVOICE", "unassigned"),
                                            ("workHours", "WORK", "quantity"), ("assignedWorkHours", "WORK", "assigned"),
                                            ("unassignedWorkHours", "WORK", "unassigned"))},
            })
        return {
            "schema": SCHEMA + ".report", "period": {"startDate": document["periodStart"], "endDate": document["periodEnd"],
                                                       "asOfDate": document["asOfDate"]},
            "basis": BASIS, "dateBasis": "Whole original work quantities use work end date; invoice lines use invoice issue date. These reporting dates do not determine grant eligibility.",
            "sourceCounts": {"work": len(context["records"]["work"]), "invoices": len(context["records"]["invoices"]),
                             "targets": len(population), "allocationParts": len(allocation_rows)},
            "totals": totals, "funds": summary, "packages": by_package,
            "balances": balances, "allocations": allocation_rows, "findings": findings, "changes": comparison,
        }


def read_record(metadata, raw):
    if (metadata.get("mediaType") != MEDIA or len(raw) != metadata.get("bytes")
            or hashlib.sha256(raw).hexdigest() != metadata.get("sha256")):
        fail("The complete funding edition differs from its retained source.", "FUNDING_SOURCE", 409)
    try:
        edition = json.loads(raw)
        required = {"schema", "id", "revision", "caseVersion", "previous", "savedAt", "actor", "note",
                    "document", "source", "report", "reportSha256", "previewSha256", "sha256"}
        if not isinstance(edition, dict) or set(edition) != required or edition.get("schema") != SCHEMA or edition.get("id") != BOOK_ID:
            fail("The complete original funding edition is required.", "FUNDING_SOURCE", 409)
        domain.integer(edition["revision"], "Funding revision", 1, 1000000)
        domain.integer(edition["caseVersion"], "Funding save case version", 2, 10000000)
        domain.timestamp(edition["savedAt"], "Original funding save")
        text(edition["actor"], "Original recording operator", 300, True)
        text(edition["note"], "Original save note", 12000, True)
        source = edition["source"]
        if (not isinstance(source, dict) or set(source) != {"case", "plan", "records", "sources"}
                or set(source["records"]) != {"contributors", "work", "invoices"}
                or not isinstance(source["sources"], list)):
            fail("The full original work and invoice source is missing.", "FUNDING_SOURCE", 409)
        if len({r["id"] for r in source["sources"]}) != len(source["sources"]):
            fail("The funding edition repeats a source attachment.")
        context = captured_context(source)
        if normalized(context, edition["document"]) != edition["document"]:
            fail("The saved funding input differs from its complete normalized form.")
        if (digest({k: v for k, v in edition.items() if k != "sha256"}) != edition["sha256"]
                or digest(edition["report"]) != edition["reportSha256"]
                or calculation(edition["document"], source, edition["report"]["changes"]) != edition["report"]
                or metadata.get(MARKER) != {"schema": SCHEMA, "id": BOOK_ID, "revision": edition["revision"],
                                           "sha256": edition["sha256"]}):
            fail("The funding book or its complete calculation has changed.", "FUNDING_SOURCE", 409)
        expected_preview = {"schema": SCHEMA + ".preview",
                            "inputs": {"expectedRevision": edition["revision"] - 1, "document": edition["document"]},
                            "previous": edition["previous"], "source": source,
                            "report": edition["report"], "reportSha256": edition["reportSha256"]}
        if digest(expected_preview) != edition["previewSha256"]:
            fail("The funding edition no longer matches its reviewed input and source.", "FUNDING_SOURCE", 409)
        return {"source": metadata, "edition": edition}
    except (KeyError, TypeError, ValueError, UnicodeError) as exc:
        if isinstance(exc, Problem):
            raise
        fail("The original funding edition is incomplete or unreadable.", "FUNDING_SOURCE", 409)


def link(row):
    if row is None:
        return None
    return {"sourceId": row["source"]["id"], "sourceSha256": row["source"]["sha256"],
            "revision": row["edition"]["revision"], "editionSha256": row["edition"]["sha256"]}


def checked_chain(values):
    values = sorted(values, key=lambda row: row["edition"]["revision"])
    previous = None
    for index, row in enumerate(values, 1):
        edition = row["edition"]
        if (edition["revision"] != index or edition["previous"] != link(previous)
                or previous and edition["caseVersion"] <= previous["edition"]["caseVersion"]
                or edition["report"]["changes"] != changes(previous, edition["document"], edition["source"])):
            fail("Keep the one funding book's complete ordered source and allocation history.", "FUNDING_HISTORY", 409)
        previous = row
    return values


def records(operations, case_id):
    values = []
    for metadata_raw, raw in operations.db.execute(
            "SELECT metadata_json,content FROM ops_sources WHERE program_id=? ORDER BY id", (case_id,)):
        metadata = json.loads(metadata_raw)
        if MARKER in metadata:
            values.append(read_record(metadata, bytes(raw)))
    return checked_chain(values)


def summary(row):
    e = row["edition"]
    return {**link(row), "title": e["document"]["title"], "status": e["document"]["status"],
            "savedAt": e["savedAt"], "actor": e["actor"], "caseVersion": e["caseVersion"],
            "period": e["report"]["period"], "reportSha256": e["reportSha256"]}


def selected(operations, case_id, revision=None):
    history = records(operations, case_id)
    if not history:
        fail("This case has no saved funding book.", "FUNDING_NOT_FOUND", 404)
    if revision is None:
        row = history[-1]
    else:
        revision = domain.integer(revision, "Selected funding edition", 1, 1000000)
        row = next((item for item in history if item["edition"]["revision"] == revision), None)
        if row is None:
            fail("The selected funding edition is unavailable.", "FUNDING_NOT_FOUND", 404)
    return row, history


def catalog(context):
    sources = [deepcopy(value) for key, value in sorted(context["sources"].items()) if MARKER not in value]
    return {"case": deepcopy(context["program"]), "plan": {"id": context["plan"]["id"],
             "revision": context["plan"]["revision"], "contentSha256": context["plan"]["contentSha256"]},
            "targets": targets(context), "sources": sources,
            "packages": deepcopy(context["plan"]["scenario"]["future_costs"])}


def seed(operations, context, body):
    obj(body, ("expectedVersion", "revision"), "Funding seed")
    expected_version(context, body)
    history = records(operations, context["program"]["id"])
    chosen = body.get("revision")
    if chosen is not None:
        row, _ = selected(operations, context["program"]["id"], chosen)
    else:
        row = history[-1] if history else None
    today = now()[:10]
    document = deepcopy(row["edition"]["document"]) if row else {
        "title": "Cost funding allocation", "status": "DRAFT", "asOfDate": today,
        "periodStart": None, "periodEnd": today, "note": "", "funds": [], "assignments": [],
    }
    document["status"] = "DRAFT"
    return {"inputs": {"expectedRevision": history[-1]["edition"]["revision"] if history else 0,
                       "document": document},
            "catalog": catalog(context), "selectedEdition": summary(row) if row else None,
            "history": [summary(item) for item in reversed(history)]}


def expected_version(context, body):
    expected = domain.integer(body.get("expectedVersion"), "Reviewed case version", 1, 10000000)
    if expected != context["program"]["version"]:
        fail("The original case changed. Preserve the allocation draft and review the current source.",
             "OPERATIONS_CONFLICT", 409)


def preview(operations, context, body):
    obj(body, ("expectedVersion", "inputs"), "Funding preview")
    expected_version(context, body)
    inputs = obj(body.get("inputs"), ("expectedRevision", "document"), "Funding input")
    revision = domain.integer(inputs.get("expectedRevision"), "Current funding book revision", 0, 1000000)
    history = records(operations, context["program"]["id"])
    previous = history[-1] if history else None
    if revision != (previous["edition"]["revision"] if previous else 0):
        fail("A later funding edition exists. Compare it before selecting the next save base.",
             "FUNDING_REVISION_CONFLICT", 409)
    document = normalized(context, inputs.get("document"))
    source = source_snapshot(context, document)
    report = calculation(document, source, changes(previous, document, source))
    result = {"schema": SCHEMA + ".preview", "inputs": {"expectedRevision": revision, "document": document},
              "previous": link(previous), "source": source, "report": report, "reportSha256": digest(report)}
    result["previewSha256"] = digest(result)
    return result


def save(operations, context, data, actor, version, note):
    obj(data, ("inputs", "expectedPreviewSha256"), "Funding save")
    text(note, "Recorded funding save note", 12000, True)
    candidate = preview(operations, context, {"expectedVersion": context["program"]["version"], "inputs": data.get("inputs")})
    if candidate["previewSha256"] != domain.sha(data.get("expectedPreviewSha256"), "Reviewed funding preview", False):
        fail("The original cost, allocation or preview changed. Review the complete draft again.",
             "FUNDING_PREVIEW_CONFLICT", 409)
    edition = {
        "schema": SCHEMA, "id": BOOK_ID, "revision": candidate["inputs"]["expectedRevision"] + 1,
        "caseVersion": version, "previous": candidate["previous"], "savedAt": now(), "actor": actor, "note": note,
        "document": candidate["inputs"]["document"], "source": candidate["source"], "report": candidate["report"],
        "reportSha256": candidate["reportSha256"], "previewSha256": candidate["previewSha256"],
    }
    edition["sha256"] = digest(edition)
    raw = (canonical(edition) + "\n").encode()
    metadata = operations._source_add(context["program"]["id"], {
        "contentBase64": base64.b64encode(raw).decode("ascii"),
        "filename": "cost-funding-r" + str(edition["revision"]) + ".json", "mediaType": MEDIA,
        "kind": "other", "observedAt": edition["savedAt"],
    })
    metadata[MARKER] = {"schema": SCHEMA, "id": BOOK_ID, "revision": edition["revision"], "sha256": edition["sha256"]}
    operations.db.execute("UPDATE ops_sources SET metadata_json=? WHERE program_id=? AND id=?",
                          (canonical(metadata), context["program"]["id"], metadata["id"]))
    return {"before": None, "after": metadata, "kind": "source", "recordId": metadata["id"],
            "funding": summary({"source": metadata, "edition": edition})}


def get(operations, context, revision=None):
    row, history = selected(operations, context["program"]["id"], revision)
    return {**deepcopy(row), "catalog": catalog(context),
            "history": [summary(item) for item in reversed(history)],
            "currentSourceChanges": changed_rows(targets(captured_context(row["edition"]["source"])),
                                                  targets(context), lambda item: item["key"]),
            "inputs": {"expectedRevision": history[-1]["edition"]["revision"],
                       "document": deepcopy(row["edition"]["document"])}}


def request(operations, case_id, request_id):
    request_id = short_id(request_id, "Original funding request ID")
    context = operations._context(case_id)
    row = operations.db.execute("SELECT fingerprint,result_json FROM requests WHERE request_id=?", (request_id,)).fetchone()
    base = {"caseId": case_id, "caseCreatedAt": context["program"]["createdAt"], "requestId": request_id}
    if row is None:
        return {**base, "found": False}
    result = json.loads(row[1])
    if result.get("id") != case_id or result.get("action") != "funding.save":
        fail("This original request belongs to another case or action.", "REQUEST_CONFLICT", 409)
    record = operations.db.execute("SELECT metadata_json,content FROM ops_sources WHERE program_id=? AND id=?",
                                   (case_id, result.get("recordId"))).fetchone()
    event = operations.db.execute("SELECT body_json FROM ops_events WHERE program_id=? AND version=?",
                                  (case_id, result.get("version"))).fetchone()
    if record is None or event is None:
        fail("The accepted funding request is missing its original source or event.", "FUNDING_COMMITMENT_MISSING", 409)
    saved = read_record(json.loads(record[0]), bytes(record[1]))
    original_event = json.loads(event[0])
    if (result.get("funding") != summary(saved) or original_event.get("requestId") != request_id
            or original_event.get("action") != "funding.save" or original_event.get("after") != saved["source"]):
        fail("The original funding request no longer matches its committed edition.", "FUNDING_COMMITMENT_MISSING", 409)
    return {**base, "found": True, "fingerprint": row[0], "result": result, "resultSha256": digest(result)}


def historical_records(events, intakes, version):
    """Original record events plus complete native work/intake creation snapshots."""
    result = {key: {} for key in ("contributors", "work", "invoices")}
    intake_by_version = {}
    for row in intakes:
        applied = row.get("applied")
        if row.get("state") == "APPLIED" and applied:
            intake_by_version.setdefault(row["caseVersion"], []).extend(applied["links"])
    for event in events:
        if event["version"] > version:
            break
        kind, after = event.get("kind"), event.get("after")
        if kind in result and isinstance(after, dict) and after.get("id"):
            result[kind][after["id"]] = deepcopy(after)
        for link_row in intake_by_version.get(event["version"], []):
            if link_row["operation"] == "CREATED":
                kind = link_row["kind"]
                if kind in result:
                    result[kind][link_row["recordId"]] = deepcopy(link_row["snapshot"])
    return {key: sorted(values.values(), key=lambda row: row["id"]) for key, values in result.items()}


def validate_import(context, events, files, intakes, *, plan_for_version=None):
    history = checked_chain([read_record(metadata, files["sources/" + metadata["id"]])
                             for metadata in context["sources"].values() if MARKER in metadata])
    matched = set()
    for row in history:
        metadata, edition = row["source"], row["edition"]
        version = edition["caseVersion"]
        if version > len(events):
            fail("The funding edition lacks its original save event.", "FUNDING_HISTORY", 409)
        event = events[version - 1]
        if (event.get("action") != "funding.save" or event.get("kind") != "source"
                or event.get("recordId") != metadata["id"] or event.get("after") != metadata
                or event.get("actor") != edition["actor"] or event.get("note") != edition["note"]):
            fail("The funding edition differs from its original accepted save.", "FUNDING_HISTORY", 409)
        source = edition["source"]
        if source["case"]["version"] != version - 1 or source["case"]["mode"] != context["program"]["mode"]:
            fail("The original funding source case selection changed.", "FUNDING_HISTORY", 409)
        original_records = historical_records(events, intakes, version - 1)
        if source["records"] != original_records:
            fail("The funding book does not retain the complete original work, invoice and contributor revisions.",
                 "FUNDING_HISTORY", 409)
        plan = plan_for_version(version - 1) if plan_for_version else context["plan"]
        if any(source["plan"].get(key) != plan.get(key) for key in
               ("revision", "source", "scenario", "planning", "report", "savedAt", "note", "contentSha256")):
            fail("The funding book's original saved planning edition differs.", "FUNDING_HISTORY", 409)
        for original in source["sources"]:
            if context["sources"].get(original["id"]) != original:
                fail("The complete funding basis is missing an exact original attachment.", "FUNDING_SOURCE", 409)
        historical_context = {"program": source["case"], "plan": source["plan"],
                              "records": original_records, "sources": context["sources"]}
        if source_snapshot(historical_context, edition["document"]) != source:
            fail("The retained funding basis does not cover the exact selected original sources.", "FUNDING_SOURCE", 409)
        matched.add(metadata["id"])
    if {event.get("recordId") for event in events if event.get("action") == "funding.save"} != matched:
        fail("The complete operating case is missing a funding edition.", "FUNDING_HISTORY", 409)
    return history


def report_files(row, exported_case):
    edition = row["edition"]
    selection = {"schema": SCHEMA + ".selection", "case": {
        key: deepcopy(exported_case[key]) for key in ("id", "version", "name", "mode")},
        "funding": summary(row)}
    report = edition["report"]
    allocation_headers = ["kind", "recordId", "lineId", "recordVersion", "recordSha256", "invoiceNumber",
                          "description", "date", "startDate", "state", "costId", "contributorId", "contributor",
                          "unit", "originalQuantity", "quantity", "fundId", "fundName", "fundKind", "fundDecision",
                          "eligibility", "basis", "windowObservation", "interval", "allocationNote",
                          "fundReference", "sourceIds", "fundSourceIds", "workIds"]
    balance_headers = ["kind", "recordId", "lineId", "recordVersion", "recordSha256", "description", "date",
                       "state", "costId", "contributorId", "unit", "originalQuantity", "quantity",
                       "assigned", "unassigned", "interval", "originalFundingBasis", "spansPeriodStart"]
    change_rows = [{"family": family, "key": item["key"], "change": item["change"],
                    "before": canonical(item["before"]), "after": canonical(item["after"])}
                   for family in ("originalRows", "assignments", "funds") for item in report["changes"][family]]
    flat_allocations = [{key: canonical(value) if isinstance(value, (list, dict)) else value for key, value in item.items()}
                        for item in report["allocations"]]
    return {
        "cost-funding-selection.json": (canonical(selection) + "\n").encode(),
        "cost-funding-report.json": (canonical({"selection": selection, "edition": edition}) + "\n").encode(),
        "cost-funding.html": html_report(row, exported_case),
        "cost-funding-allocations.csv": csv_bytes(allocation_headers, flat_allocations),
        "cost-funding-balances.csv": csv_bytes(balance_headers, report["balances"]),
        "cost-funding-changes.csv": csv_bytes(["family", "key", "change", "before", "after"], change_rows),
    }


def html_report(row, exported_case):
    edition, metadata = row["edition"], row["source"]
    document, report = edition["document"], edition["report"]
    esc = lambda value: html.escape(str("Unknown" if value is None else value), quote=True)
    def table(headers, values):
        return "<div class='scroll'><table><thead><tr>" + "".join("<th>" + esc(v) + "</th>" for v in headers) + \
            "</tr></thead><tbody>" + "".join("<tr>" + "".join("<td>" + esc(v) + "</td>" for v in line) + "</tr>" for line in values) + "</tbody></table></div>"
    content = "<h1>" + esc(document["title"]) + "</h1><p>" + esc(exported_case["mode"]) + \
        " · internal allocation " + esc(document["status"]) + " · edition " + str(edition["revision"]) + "</p>"
    content += "<p>Source reviewed " + esc(document["asOfDate"]) + ". Report " + esc(document["periodStart"] or "all dates") + \
        " through " + esc(document["periodEnd"]) + ". Saved " + esc(edition["savedAt"]) + " by " + esc(edition["actor"]) + ".</p>"
    content += "<p>" + esc(BASIS) + "</p><p>" + esc(report["dateBasis"]) + "</p><p>" + esc(document["note"]) + "</p>"
    content += "<h2>Opening, period and closing</h2>" + table(
        ["Position", "Invoice USD", "Work hours", "Accepted work hours", "Reviewed invoice USD"],
        [(key, value["invoiceUsd"], value["workHours"], value["acceptedHours"], value["reviewedInvoiceUsd"])
         for key, value in report["totals"].items()])
    content += "<h2>Funding balances</h2>" + table(
        ["Funding source", "Category", "Decision", "Opening USD", "Period USD", "Closing USD",
         "Closing hours", "Accepted hours", "Operator-supported USD", "Excluded USD", "Assignment-limit excess"],
        [(r["name"], r["kind"], r["decision"], r["opening"]["invoiceUsd"], r["period"]["invoiceUsd"],
          r["closing"]["invoiceUsd"], r["closing"]["workHours"], r["closing"]["acceptedHours"],
          r["closing"]["supportedInvoiceUsd"], r["closing"]["excludedInvoiceUsd"], r["limitExcessUsd"]) for r in report["funds"]])
    content += "<h2>Original work and invoice balances</h2>" + table(
        ["Source", "Line", "Original version", "State", "Date", "Unit", "Original quantity", "Effective quantity", "Assigned", "Unassigned", "Interval"],
        [(r["recordId"], r["lineId"], r["recordVersion"], r["state"], r["date"], r["unit"],
          r["originalQuantity"], r["quantity"], r["assigned"], r["unassigned"], r["interval"]) for r in report["balances"]])
    content += "<h2>Complete assignment rows</h2>" + table(
        ["Source", "Line", "Funding", "Quantity", "Unit", "Eligibility", "Basis", "Source-window observation"],
        [(r["recordId"], r["lineId"], r["fundName"], r["quantity"], r["unit"], r["eligibility"],
          r["basis"], r["windowObservation"]) for r in report["allocations"]])
    content += "<h2>Recorded funding conditions</h2>"
    for fund in document["funds"]:
        content += "<h3>" + esc(fund["name"]) + "</h3>" + table(["Field", "Retained value"],
            [(key, canonical(value) if isinstance(value, (list, dict)) else value) for key, value in fund.items()])
    content += "<h2>Review items</h2>" + table(["Original source", "Funding", "Observation"],
        [(r["key"], r["fundId"], r["message"]) for r in report["findings"]])
    content += "<h2>Changes from the previous edition</h2>"
    for key in ("originalRows", "assignments", "funds"):
        content += "<h3>" + esc(key) + "</h3>" + table(["Key", "Change", "Before", "After"],
            [(r["key"], r["change"], canonical(r["before"]), canonical(r["after"])) for r in report["changes"][key]])
    content += "<h2>Original edition and complete receiving</h2><p>Case " + esc(exported_case["id"]) + \
        " at export version " + str(exported_case["version"]) + ". Funding source " + esc(metadata["id"]) + \
        " · " + esc(metadata["sha256"]) + ".</p><p>The accompanying operations-case.zip retains every original source, " \
        "work/invoice record, funding edition and native case event for continued editing.</p>"
    return ("<!doctype html><html lang='en'><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'>" +
        "<title>" + esc(document["title"]) + "</title><style>body{font:15px/1.5 system-ui,sans-serif;color:#191919;background:#fff;" +
        "max-width:1200px;margin:28px auto;padding:0 20px}h1,h2,h3{line-height:1.2}p,td{white-space:pre-wrap;overflow-wrap:anywhere}" +
        ".scroll{overflow:auto}table{width:100%;border-collapse:collapse;margin:16px 0}th,td{border:1px solid #bbb;padding:8px;text-align:left;vertical-align:top}" +
        "th{background:#eee}@media print{body{max-width:none;margin:0}.scroll{overflow:visible}h2,h3{break-after:avoid}tr{break-inside:avoid}}</style>" +
        "<body>" + content + "</body></html>\n").encode()


def export_bundle(operations, context, revision, expected_report_sha256):
    import io
    import zipfile
    from model import MAX_BUNDLE
    row, _ = selected(operations, context["program"]["id"], revision)
    if row["edition"]["reportSha256"] != domain.sha(expected_report_sha256, "Reviewed funding report", False):
        fail("Keep the exact selected funding report.", "FUNDING_REPORT_CONFLICT", 409)
    files = report_files(row, context["program"])
    files["operations-case.zip"] = operations.export(context["program"]["id"])
    manifest = {"schema": SCHEMA + ".bundle",
                "files": [{"path": name, "bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest()}
                          for name, raw in sorted(files.items())]}
    files["MANIFEST.json"] = (canonical(manifest) + "\n").encode()
    if sum(len(raw) for raw in files.values()) > MAX_BUNDLE:
        fail("The complete funding and case handover exceeds 32 MiB.", status=413)
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
        for name, raw in sorted(files.items()):
            info = zipfile.ZipInfo(name, (2026, 1, 1, 0, 0, 0))
            info.external_attr = 0o600 << 16
            info.compress_type = zipfile.ZIP_DEFLATED
            archive.writestr(info, raw)
    raw = output.getvalue()
    if len(raw) > MAX_BUNDLE:
        fail("The complete funding handover exceeds 32 MiB.", status=413)
    return raw


def unwrap_bundle(raw):
    import io
    import zipfile
    from model import MAX_BUNDLE
    if not isinstance(raw, bytes) or len(raw) > MAX_BUNDLE:
        fail("Use the complete original funding/case ZIP up to 32 MiB.", status=413)
    try:
        with zipfile.ZipFile(io.BytesIO(raw)) as archive:
            names = archive.namelist()
            if "MANIFEST.json" not in names:
                return raw, None
            entry = archive.getinfo("MANIFEST.json")
            if entry.file_size > 1024 * 1024:
                fail("The original archive manifest exceeds its bound.", status=413)
            manifest = json.loads(archive.read(entry))
            if manifest.get("schema") != SCHEMA + ".bundle":
                return raw, None
            expected = SELECTION_FILES | {"operations-case.zip", "MANIFEST.json"}
            entries = archive.infolist()
            if (len(names) != len(set(names)) or set(names) != expected
                    or sum(e.file_size for e in entries) > MAX_BUNDLE):
                fail("Keep every original funding handover member within its native size bound.")
            descriptors = manifest.get("files")
            if (not isinstance(descriptors, list) or len(descriptors) != len(expected) - 1
                    or {r["path"] for r in descriptors} != expected - {"MANIFEST.json"}):
                fail("The original funding handover manifest is incomplete.")
            files = {}
            for row in descriptors:
                body = archive.read(row["path"])
                if len(body) != row["bytes"] or hashlib.sha256(body).hexdigest() != row["sha256"]:
                    fail("An original funding handover member changed.")
                files[row["path"]] = body
            native = files.pop("operations-case.zip")
            return native, files
    except (zipfile.BadZipFile, KeyError, ValueError, TypeError, RuntimeError) as exc:
        if isinstance(exc, Problem):
            raise
        fail("The complete funding handover is unreadable.")


def validate_received(received, document, files):
    if received is None:
        return None
    try:
        selection = json.loads(received["cost-funding-selection.json"])
        chosen = selection["funding"]
        metadata = next(r for r in document["sources"] if r["id"] == chosen["sourceId"])
        row = read_record(metadata, files["sources/" + metadata["id"]])
        expected = report_files(row, document["program"])
        if set(received) != SELECTION_FILES or any(received[name] != raw for name, raw in expected.items()):
            fail("The funding report differs from its complete original case and selected edition.")
        return {"revision": row["edition"]["revision"], **link(row),
                "reportSha256": row["edition"]["reportSha256"],
                "period": deepcopy(row["edition"]["report"]["period"])}
    except (KeyError, TypeError, ValueError, StopIteration) as exc:
        if isinstance(exc, Problem):
            raise
        fail("The selected funding handover cannot be received.")
