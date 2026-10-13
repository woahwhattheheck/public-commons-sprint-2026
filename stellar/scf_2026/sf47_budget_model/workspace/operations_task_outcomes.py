"""Customer task comparisons retained as native Grant Operations source editions."""
from __future__ import annotations

import base64
from datetime import datetime, timezone
from copy import deepcopy
from decimal import Decimal, localcontext
import hashlib
import html
import json
import re
import uuid

from model import Problem, canonical, csv_bytes, digest, now, text
import operations_domain as domain

SCHEMA = "stellar-forge.sf47-customer-task-outcomes.v1"
MEDIA = "application/vnd.stellar-forge.customer-task-outcomes+json"
MARKER = "customerTaskOutcomes"
ID = re.compile(r"task-outcomes-[a-f0-9]{32}")
CATEGORIES = ("ACQUISITION", "PROCESSING", "CORRECTION", "RECEIVING", "OTHER")
BASIS = ("OBSERVED", "ESTIMATED", "MIXED", "UNRECORDED")
SELECTION_FILES = {"task-outcomes-selection.json", "task-outcomes.html",
                   "task-outcomes-effort.csv", "task-outcomes-costs.csv"}


def fail(message, code="INVALID_TASK_OUTCOMES", status=422):
    domain.fail(message, code, status)


def obj(value, keys, label):
    if not isinstance(value, dict) or set(value) - set(keys):
        fail(label + ": use the complete supported object.")
    return value


def ident(value):
    if not isinstance(value, str) or not ID.fullmatch(value):
        fail("Use the original customer task comparison identity.")
    return value


def amount(value, label, optional=True, maximum="1000000000000"):
    if value is None or value == "":
        if optional:
            return None
        fail(label + ": enter an exact nonnegative decimal.")
    if not isinstance(value, str) or not re.fullmatch(r"(?:0|[1-9][0-9]{0,12})(?:\.[0-9]{1,6})?", value):
        fail(label + ": use a nonnegative decimal string with at most six decimal places.")
    number = Decimal(value)
    if number > Decimal(maximum):
        fail(label + ": exceeds the supported quantity.")
    return dec(number)


def dec(value):
    if value is None:
        return None
    with localcontext() as ctx:
        ctx.prec = 60
        number = Decimal(value).quantize(Decimal("0.000001"))
    result = format(number, "f").rstrip("0").rstrip(".")
    return result if result and result != "-0" else "0"


def decimal(value):
    return None if value is None else Decimal(value)


def refs(value, available, label):
    if (not isinstance(value, list) or len(value) > 200 or any(not isinstance(item, str) for item in value)
            or len(set(value)) != len(value)):
        fail(label + ": use a unique array of original identities.")
    if any(not isinstance(item, str) or item not in available for item in value):
        fail(label + ": an original selected record is unavailable.")
    return sorted(value)


def method(raw, context, label):
    value = obj(raw, ("name", "basis", "observedAt", "sourceReference", "population",
                     "period", "output", "quality", "attemptedTasks", "completedTasks",
                     "elapsedMinutes", "sourceIds", "notes", "effort", "costs"), label)
    result = {
        "name": text(value.get("name", ""), label + " method", 300, True),
        "basis": domain.enum(value.get("basis", "UNRECORDED"), BASIS, label + " observation basis"),
        "observedAt": domain.timestamp(value.get("observedAt"), label + " observation time", True),
        "sourceReference": text(value.get("sourceReference", ""), label + " source edition or query", 4000),
        "population": text(value.get("population", ""), label + " whole population and selection", 8000),
        "period": text(value.get("period", ""), label + " period", 2000),
        "output": text(value.get("output", ""), label + " complete result", 12000),
        "quality": text(value.get("quality", ""), label + " quality and exceptions", 8000),
        "attemptedTasks": amount(value.get("attemptedTasks"), label + " attempted tasks"),
        "completedTasks": amount(value.get("completedTasks"), label + " completed tasks"),
        "elapsedMinutes": amount(value.get("elapsedMinutes"), label + " whole-operation elapsed minutes"),
        "sourceIds": refs(value.get("sourceIds", []), context["sources"], label + " sources"),
        "notes": text(value.get("notes", ""), label + " observation notes", 12000),
        "effort": [], "costs": [],
    }
    for key in ("attemptedTasks", "completedTasks"):
        if result[key] is not None and Decimal(result[key]) != Decimal(result[key]).to_integral_value():
            fail(label + ": attempted and completed tasks must be whole task counts.")
    if (result["attemptedTasks"] is not None and result["completedTasks"] is not None
            and Decimal(result["completedTasks"]) > Decimal(result["attemptedTasks"])):
        fail(label + ": completed tasks cannot exceed attempted tasks.")
    for collection in ("effort", "costs"):
        rows = value.get(collection, [])
        if not isinstance(rows, list) or len(rows) > 100:
            fail(label + ": use at most 100 complete " + collection + " rows.")
        seen = set()
        for raw_row in rows:
            keys = ("id", "label", "category", "personMinutes", "hourlyRate", "notes") if collection == "effort" else ("id", "label", "amount", "notes")
            row = obj(raw_row, keys, label + " " + collection)
            rid = text(row.get("id"), "Original row ID", 100, True)
            if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,99}", rid) or rid in seen:
                fail(label + ": retain unique stable row IDs.")
            seen.add(rid)
            normalized = {"id": rid, "label": text(row.get("label", ""), "Work or cost description", 1000, True),
                          "notes": text(row.get("notes", ""), "Row source and calculation notes", 4000)}
            if collection == "effort":
                normalized.update(category=domain.enum(row.get("category", "OTHER"), CATEGORIES, "Effort category"),
                                  personMinutes=amount(row.get("personMinutes"), "Active person-minutes"),
                                  hourlyRate=amount(row.get("hourlyRate"), "Hourly labour rate"))
            else:
                normalized["amount"] = amount(row.get("amount"), "Non-labour cost")
            result[collection].append(normalized)
    return result


def normalized(context, raw):
    value = obj(raw, ("title", "customer", "task", "unit", "currency", "installation",
                     "deploymentIds", "purchaseIds", "baseline", "installed", "comparison", "status", "conclusion", "followups"),
                "Customer task comparison")
    currency = text(value.get("currency", "USD"), "Comparison currency", 12, True)
    if not re.fullmatch(r"[A-Z][A-Z0-9]{2,11}", currency):
        fail("Use one explicit currency or asset code for every labour rate and cost.")
    installation = value.get("installation")
    if installation is not None:
        installation = obj(installation, ("id", "revision"), "Original installation")
        iid = text(installation.get("id"), "Installation ID", 100, True)
        if not re.fullmatch(r"installation-[a-f0-9]{32}", iid):
            fail("Select the original installation identity.")
        installation = {"id": iid, "revision": domain.integer(installation.get("revision"), "Installation revision", 1, 1000000)}
    compared = obj(value.get("comparison", {}), ("decision", "reason"), "Comparability review")
    result = {
        "title": text(value.get("title", ""), "Comparison name", 300, True),
        "customer": text(value.get("customer", ""), "Customer or receiving team", 300, True),
        "task": text(value.get("task", ""), "Complete useful task and acceptance", 12000, True),
        "unit": text(value.get("unit", "complete task"), "Completed task unit", 120, True),
        "currency": currency, "installation": installation,
        "deploymentIds": refs(value.get("deploymentIds", []), {r["id"] for r in context["records"]["deployments"]}, "Deployment selection"),
        "purchaseIds": refs(value.get("purchaseIds", []), {r["id"] for r in context["records"]["purchases"]}, "Purchase selection"),
        "baseline": method(value.get("baseline", {}), context, "Prior"),
        "installed": method(value.get("installed", {}), context, "Installed"),
        "comparison": {"decision": domain.enum(compared.get("decision", "UNREVIEWED"),
                       ("UNREVIEWED", "COMPARABLE", "NOT_COMPARABLE"), "Comparability decision"),
                       "reason": text(compared.get("reason", ""), "Scope comparison and explanation", 12000)},
        "status": domain.enum(value.get("status", "DRAFT"), ("DRAFT", "REVIEWED"), "Comparison state"),
        "conclusion": text(value.get("conclusion", ""), "Customer outcome and next work", 12000),
    }
    if result["status"] == "REVIEWED":
        if result["comparison"]["decision"] == "UNREVIEWED" or not result["comparison"]["reason"] or not result["conclusion"]:
            fail("A reviewed edition needs a comparability decision, its explanation and the customer conclusion.")
    # Preserve the byte-derived legacy document when no recurring series was supplied.
    if "followups" in value:
        result["followups"] = followups(context, value["followups"])
    return result


def followups(context, values):
    if not isinstance(values, list) or len(values) > 100:
        fail("Keep at most 100 complete recurring observations in one comparison.")
    result, seen = [], set()
    for raw in values:
        value = obj(raw, ("id", "label", "method", "comparison", "status", "conclusion",
                          "acceptance", "deploymentIds", "purchaseIds"), "Recurring observation")
        rid = text(value.get("id"), "Original recurring observation ID", 100, True)
        if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,99}", rid) or rid in seen:
            fail("Retain a unique stable identity for each recurring observation.")
        seen.add(rid)
        compared = obj(value.get("comparison", {}), ("decision", "reason"), "Recurring comparability review")
        acceptance = obj(value.get("acceptance", {}), ("status", "by", "at", "note"), "Customer acceptance")
        accepted = {"status": domain.enum(acceptance.get("status", "PENDING"),
                         ("PENDING", "ACCEPTED", "DECLINED"), "Customer acceptance state"),
                    "by": text(acceptance.get("by", ""), "Actual receiving reviewer", 300),
                    "at": domain.timestamp(acceptance.get("at"), "Actual customer response time", True),
                    "note": text(acceptance.get("note", ""), "Customer response and original source", 12000)}
        if accepted["status"] != "PENDING" and not all(accepted[key] for key in ("by", "at", "note")):
            fail("Record the actual reviewer, response time and original response for customer acceptance or decline.")
        row = {
            "id": rid, "label": text(value.get("label", ""), "Recurring observation name", 300, True),
            "method": method(value.get("method", {}), context, "Recurring " + rid),
            "comparison": {"decision": domain.enum(compared.get("decision", "UNREVIEWED"),
                            ("UNREVIEWED", "COMPARABLE", "NOT_COMPARABLE"), "Recurring comparability decision"),
                           "reason": text(compared.get("reason", ""), "Recurring complete scope review", 12000)},
            "status": domain.enum(value.get("status", "DRAFT"), ("DRAFT", "REVIEWED"), "Recurring review state"),
            "conclusion": text(value.get("conclusion", ""), "Recurring customer outcome and next work", 12000),
            "acceptance": accepted,
            "deploymentIds": refs(value.get("deploymentIds", []),
                                  {r["id"] for r in context["records"]["deployments"]}, "Recurring deployment selection"),
            "purchaseIds": refs(value.get("purchaseIds", []),
                                {r["id"] for r in context["records"]["purchases"]}, "Recurring purchase selection"),
        }
        if row["status"] == "REVIEWED" and (row["comparison"]["decision"] == "UNREVIEWED"
                or not row["comparison"]["reason"] or not row["conclusion"]):
            fail("A reviewed recurring observation needs its own complete scope decision, explanation and conclusion.")
        result.append(row)
    return result


def selected_ids(document, kind):
    if kind == "sources":
        ids = document["baseline"]["sourceIds"] + document["installed"]["sourceIds"]
        ids += [key for row in document.get("followups", []) for key in row["method"]["sourceIds"]]
    else:
        field = {"deployments": "deploymentIds", "purchases": "purchaseIds"}[kind]
        ids = document[field] + [key for row in document.get("followups", []) for key in row[field]]
    return sorted(set(ids))


def blank_method(name):
    return {"name": name, "basis": "UNRECORDED", "observedAt": None,
            "sourceReference": "", "population": "", "period": "", "output": "", "quality": "",
            "attemptedTasks": None, "completedTasks": None, "elapsedMinutes": None,
            "sourceIds": [], "notes": "", "effort": [], "costs": []}


def seed(context):
    inputs = {"id": "task-outcomes-" + uuid.uuid4().hex, "expectedRevision": 0,
              "document": {"title": "Customer task comparison", "customer": "", "task": "",
                           "unit": "complete task", "currency": "USD", "installation": None,
                           "deploymentIds": [], "purchaseIds": [],
                           "baseline": blank_method("Prior method"), "installed": blank_method("Installed method"),
                           "comparison": {"decision": "UNREVIEWED", "reason": ""},
                           "status": "DRAFT", "conclusion": ""}}
    return {"inputs": inputs, "case": {"id": context["program"]["id"], "version": context["program"]["version"]}}

def method_report(value):
    with localcontext() as ctx:
        ctx.prec = 60
        effort = value["effort"]
        costs = value["costs"]
        known_minutes = sum((Decimal(row["personMinutes"]) for row in effort if row["personMinutes"] is not None), Decimal(0))
        missing_effort = [row["id"] for row in effort if row["personMinutes"] is None]
        minutes = known_minutes if effort and not missing_effort else None
        known_labor = sum((Decimal(row["personMinutes"]) * Decimal(row["hourlyRate"]) / 60
                           for row in effort if row["personMinutes"] is not None and row["hourlyRate"] is not None), Decimal(0))
        unvalued = [row["id"] for row in effort if row["personMinutes"] is None or row["hourlyRate"] is None]
        labor = known_labor if effort and not unvalued else None
        known_other = sum((Decimal(row["amount"]) for row in costs if row["amount"] is not None), Decimal(0))
        missing_costs = [row["id"] for row in costs if row["amount"] is None]
        other = known_other if not missing_costs else None
        total = labor + other if labor is not None and other is not None else None
        completed = decimal(value["completedTasks"])
        attempted = decimal(value["attemptedTasks"])
        by_category = []
        for category in CATEGORIES:
            selected = [row for row in effort if row["category"] == category]
            known = sum((Decimal(row["personMinutes"]) for row in selected if row["personMinutes"] is not None), Decimal(0))
            by_category.append({"category": category, "rows": len(selected),
                                "personMinutes": dec(known) if selected and all(r["personMinutes"] is not None for r in selected) else None,
                                "knownPersonMinutes": dec(known)})
        return {"basis": value["basis"], "attemptedTasks": value["attemptedTasks"],
                "completedTasks": value["completedTasks"],
                "incompleteTasks": dec(attempted - completed) if attempted is not None and completed is not None else None,
                "elapsedMinutes": value["elapsedMinutes"], "personMinutes": dec(minutes),
                "knownPersonMinutes": dec(known_minutes), "missingEffortIds": missing_effort,
                "labourCost": dec(labor), "knownLabourCost": dec(known_labor), "unvaluedEffortIds": unvalued,
                "otherCost": dec(other), "knownOtherCost": dec(known_other), "missingCostIds": missing_costs,
                "totalCost": dec(total), "categories": by_category,
                "personMinutesPerCompletedTask": dec(minutes / completed) if minutes is not None and completed and completed > 0 else None,
                "costPerCompletedTask": dec(total / completed) if total is not None and completed and completed > 0 else None}


def savings(before, after):
    if before is None or after is None:
        return None
    with localcontext() as ctx:
        ctx.prec = 60
        prior, current = Decimal(before), Decimal(after)
        return {"prior": before, "installed": after, "difference": dec(prior - current),
                "percent": dec((prior - current) * 100 / prior) if prior > 0 else None}


def report(document):
    before, after = method_report(document["baseline"]), method_report(document["installed"])
    findings = []
    for key, row in (("baseline", before), ("installed", after)):
        source = document[key]
        if source["basis"] == "UNRECORDED":
            findings.append({"path": key + ".basis", "message": "Record how the method's measurements were obtained."})
        for field in ("sourceReference", "population", "period", "output", "quality"):
            if not source[field]:
                findings.append({"path": key + "." + field, "message": "Describe the complete " + field + " for this method."})
        if row["personMinutes"] is None:
            findings.append({"path": key + ".effort", "message": "Active effort is incomplete; known effort remains separately visible."})
        if row["totalCost"] is None:
            findings.append({"path": key + ".costs", "message": "A labour rate or cost is missing; the full cost comparison remains open."})
        if row["completedTasks"] is None or Decimal(row["completedTasks"]) == 0:
            findings.append({"path": key + ".completedTasks", "message": "A positive completed-task count is needed for per-task comparisons."})
    differences = [{"field": key, "prior": document["baseline"][key], "installed": document["installed"][key]}
                   for key in ("sourceReference", "population", "period", "output", "quality")
                   if document["baseline"][key] != document["installed"][key]]
    compared = document["comparison"]["decision"] == "COMPARABLE" and bool(document["comparison"]["reason"])
    source_described = all(document[side][key] for side in ("baseline", "installed")
                           for key in ("sourceReference", "population", "period", "output", "quality"))
    comparable = compared and source_described
    same_population = (before["completedTasks"] is not None and after["completedTasks"] is not None
                       and Decimal(before["completedTasks"]) == Decimal(after["completedTasks"]) > 0)
    if not comparable:
        findings.append({"path": "comparison", "message": "Review both complete task scopes before using a difference as a customer outcome."})
    measure = {"personMinutes": None, "totalCost": None, "personMinutesPerCompletedTask": None, "costPerCompletedTask": None}
    if comparable:
        for field in ("personMinutesPerCompletedTask", "costPerCompletedTask"):
            measure[field] = savings(before[field], after[field])
        if same_population:
            for field in ("personMinutes", "totalCost"):
                measure[field] = savings(before[field], after[field])
    if comparable and not same_population:
        findings.append({"path": "comparison.completedTasks", "message": "The completed task counts differ or are unavailable; compare per completed task."})
    observed = all(document[side]["basis"] == "OBSERVED" for side in ("baseline", "installed"))
    result = {"schema": SCHEMA + ".report", "currency": document["currency"], "unit": document["unit"],
            "baseline": before, "installed": after, "scopeDifferences": differences,
            "comparisonReviewed": compared, "comparable": comparable, "sameCompletedTaskCount": same_population,
            "measurementBasis": "OBSERVED" if observed else "ESTIMATED_OR_INCOMPLETE",
            "savings": measure, "findings": findings,
            "basis": "Active effort is the sum of person-minutes; elapsed time is recorded once for the whole operation. "
                     "Labour equals person-minutes times the stated hourly rate divided by 60. "
                     "All costs use the selected currency. Positive differences mean lower installed-method effort or cost. "
                     "Missing measurements stay unknown. Complete task counts include the stated acceptance criteria."}
    if "followups" in document:
        result.update(series_report(document))
    return result


def series_report(document):
    rows, accepted_dates = [], set()
    for observation in document["followups"]:
        comparison = {key: value for key, value in document.items() if key != "followups"}
        comparison.update(installed=observation["method"], comparison=observation["comparison"],
                          status=observation["status"], conclusion=observation["conclusion"])
        calculated = report(comparison)
        comparable_observed = (observation["status"] == "REVIEWED" and calculated["comparable"]
                               and calculated["measurementBasis"] == "OBSERVED"
                               and observation["method"]["observedAt"] is not None
                               and calculated["installed"]["completedTasks"] is not None
                               and Decimal(calculated["installed"]["completedTasks"]) > 0)
        accepted = observation["acceptance"]["status"] == "ACCEPTED"
        if comparable_observed and accepted and observation["method"]["observedAt"]:
            at = datetime.fromisoformat(observation["method"]["observedAt"].replace("Z", "+00:00"))
            accepted_dates.add(at.astimezone(timezone.utc).date().isoformat())
        elapsed = savings(calculated["baseline"]["elapsedMinutes"], calculated["installed"]["elapsedMinutes"]) if (
            calculated["comparable"] and calculated["sameCompletedTaskCount"]) else None
        rows.append({"id": observation["id"], "label": observation["label"], "status": observation["status"],
                     "acceptance": deepcopy(observation["acceptance"]), "report": calculated,
                     "elapsedMinutesDifference": elapsed,
                     "acceptedComparableObserved": accepted and comparable_observed})
    return {"followups": rows, "series": {
        "observations": len(rows),
        "reviewed": sum(row["status"] == "REVIEWED" for row in rows),
        "accepted": sum(row["acceptance"]["status"] == "ACCEPTED" for row in rows),
        "declined": sum(row["acceptance"]["status"] == "DECLINED" for row in rows),
        "pending": sum(row["acceptance"]["status"] == "PENDING" for row in rows),
        "acceptedComparableObserved": sum(row["acceptedComparableObserved"] for row in rows),
        "observedUtcDates": sorted(accepted_dates),
        "basis": "Every recurring observation compares its complete scope with this edition's original baseline. "
                 "Customer acceptance is separate from measurement and operator review. Accepted comparable observed "
                 "counts require a reviewed scope, OBSERVED measurements on both methods, an original observation time "
                 "and a positive completed-task count; they do not assert "
                 "effort or monetary savings when those quantities are unknown. Dates use the recurring observation's "
                 "original measurement timestamp, converted to UTC. Overlapping work is not added into cumulative "
                 "savings; each original observation and its source selection remain separately available."}}


def snapshot(operations, context, document):
    source_ids = selected_ids(document, "sources")
    result = {
        "case": {"id": context["program"]["id"], "version": context["program"]["version"],
                 "mode": context["program"]["mode"], "planId": context["program"]["planId"],
                 "planRevision": context["program"]["planRevision"],
                 "planContentSha256": context["plan"]["contentSha256"]},
        "sources": [deepcopy(context["sources"][key]) for key in source_ids],
        "deployments": [deepcopy(row) for row in context["records"]["deployments"] if row["id"] in selected_ids(document, "deployments")],
        "purchases": [deepcopy(row) for row in context["records"]["purchases"] if row["id"] in selected_ids(document, "purchases")],
        "installation": None,
    }
    if document["installation"]:
        import operations_installations
        selected = document["installation"]
        result["installation"] = deepcopy(operations_installations.get(
            operations, context["program"]["id"], selected["id"], selected["revision"]))
    return result


def records(operations, program_id):
    rows = []
    for metadata_raw, raw in operations.db.execute(
            "SELECT metadata_json,content FROM ops_sources WHERE program_id=? ORDER BY id", (program_id,)):
        metadata = json.loads(metadata_raw)
        if MARKER in metadata:
            rows.append(read_record(metadata, bytes(raw)))
    return checked_chain(rows)


def read_record(metadata, raw):
    if metadata.get("mediaType") != MEDIA or len(raw) != metadata.get("bytes") or hashlib.sha256(raw).hexdigest() != metadata.get("sha256"):
        fail("The customer task source differs from its retained full identity.", "TASK_OUTCOMES_SOURCE", 409)
    try:
        row = json.loads(raw)
    except (ValueError, UnicodeDecodeError) as exc:
        fail("The complete customer task edition cannot be read.", "TASK_OUTCOMES_SOURCE", 409)
    if not isinstance(row, dict) or row.get("schema") != SCHEMA:
        fail("The retained customer task edition uses an unsupported schema.", "TASK_OUTCOMES_SOURCE", 409)
    ident(row.get("id"))
    domain.integer(row.get("revision"), "Task comparison revision", 1, 1000000)
    domain.integer(row.get("caseVersion"), "Original case version", 2, 10000000)
    domain.timestamp(row.get("savedAt"), "Comparison save time")
    text(row.get("actor"), "Recording operator", 300, True)
    text(row.get("note", ""), "Comparison note", 12000)
    captured = row.get("source")
    if (not isinstance(captured, dict) or set(captured) != {"case", "sources", "deployments", "purchases", "installation"}
            or not isinstance(captured.get("case"), dict)
            or any(not isinstance(captured.get(key), list) for key in ("sources", "deployments", "purchases"))):
        fail("The complete task comparison source selection is missing.", "TASK_OUTCOMES_SOURCE", 409)
    try:
        source_map = {r["id"]: r for r in captured["sources"]}
        if len(source_map) != len(captured["sources"]):
            fail("The comparison repeats an original source.")
        original_context = {"sources": source_map, "records": {
            "deployments": captured["deployments"], "purchases": captured["purchases"]}}
        if normalized(original_context, row.get("document")) != row.get("document"):
            fail("The saved customer task document differs from its normalized source.")
    except (KeyError, TypeError) as exc:
        fail("The complete customer task source selection is invalid.", "TASK_OUTCOMES_SOURCE", 409)
    if (digest({k: v for k, v in row.items() if k != "sha256"}) != row.get("sha256")
            or digest(row.get("report")) != row.get("reportSha256")
            or row.get("report") != report(row["document"])
            or metadata[MARKER] != {"schema": SCHEMA, "id": row["id"], "revision": row["revision"],
                                  "sha256": row["sha256"]}):
        fail("The saved task comparison or its calculated report has changed.", "TASK_OUTCOMES_SOURCE", 409)
    return {"source": metadata, "edition": row}


def checked_chain(rows):
    by_id = {}
    for row in rows:
        by_id.setdefault(row["edition"]["id"], []).append(row)
    for selected in by_id.values():
        selected.sort(key=lambda row: row["edition"]["revision"])
        prior = None
        for revision, row in enumerate(selected, 1):
            expected = None if prior is None else {"id": prior["source"]["id"], "sha256": prior["source"]["sha256"],
                                                  "revision": prior["edition"]["revision"]}
            if row["edition"]["revision"] != revision or row["edition"].get("previous") != expected:
                fail("The task comparison's complete original revision history is required.", "TASK_OUTCOMES_HISTORY", 409)
            if prior:
                retained = {item["id"] for item in prior["edition"]["document"].get("followups", [])}
                if retained - {item["id"] for item in row["edition"]["document"].get("followups", [])}:
                    fail("A recurring observation is missing from its later complete comparison edition.", "TASK_OUTCOMES_HISTORY", 409)
            prior = row
    return sorted(rows, key=lambda row: (row["edition"]["id"], row["edition"]["revision"]))


def heads(rows):
    selected = {}
    for row in rows:
        selected[row["edition"]["id"]] = row
    return sorted(selected.values(), key=lambda row: (row["edition"]["savedAt"], row["edition"]["id"]), reverse=True)


def summary(row):
    edition = row["edition"]
    result = {"id": edition["id"], "revision": edition["revision"], "sourceId": row["source"]["id"],
            "sourceSha256": row["source"]["sha256"], "sha256": edition["sha256"],
            "title": edition["document"]["title"], "customer": edition["document"]["customer"],
            "status": edition["document"]["status"], "savedAt": edition["savedAt"], "actor": edition["actor"],
            "comparison": edition["document"]["comparison"], "measurementBasis": edition["report"]["measurementBasis"]}
    if "series" in edition["report"]:
        result["recurring"] = {key: edition["report"]["series"][key] for key in
                               ("observations", "accepted", "acceptedComparableObserved")}
    return result


def get(operations, program_id, study_id, revision=None):
    study_id = ident(study_id)
    if revision is not None:
        revision = domain.integer(revision, "Selected comparison revision", 1, 1000000)
    selected = [row for row in records(operations, program_id) if row["edition"]["id"] == study_id]
    if not selected:
        fail("Customer task comparison not found.", "TASK_OUTCOMES_NOT_FOUND", 404)
    row = selected[-1] if revision is None else next((r for r in selected if r["edition"]["revision"] == revision), None)
    if row is None:
        fail("The selected customer task edition was not found.", "TASK_OUTCOMES_NOT_FOUND", 404)
    return {**deepcopy(row), "history": [summary(item) for item in reversed(selected)]}


def preview(operations, context, body):
    value = obj(body, ("expectedVersion", "inputs"), "Comparison preview")
    expected = domain.integer(value.get("expectedVersion"), "Reviewed case version", 1, 10000000)
    if expected != context["program"]["version"]:
        fail("The case changed. Keep the comparison draft and review the current case.", "OPERATIONS_CONFLICT", 409)
    inputs = obj(value.get("inputs"), ("id", "expectedRevision", "document"), "Comparison input")
    study_id = ident(inputs.get("id"))
    revision = domain.integer(inputs.get("expectedRevision"), "Prior comparison revision", 0, 1000000)
    prior = next((row for row in heads(records(operations, context["program"]["id"])) if row["edition"]["id"] == study_id), None)
    if revision != (prior["edition"]["revision"] if prior else 0):
        fail("A later task comparison edition exists. Retain your draft and reconcile that edition.", "TASK_OUTCOMES_CONFLICT", 409)
    document = normalized(context, inputs.get("document"))
    if prior:
        retained = {row["id"] for row in prior["edition"]["document"].get("followups", [])}
        if retained - {row["id"] for row in document.get("followups", [])}:
            fail("Retain every saved recurring observation; correct its full method and review in this next edition.")
    calculation = report(document)
    captured = snapshot(operations, context, document)
    candidate = {"schema": SCHEMA + ".preview",
                 "inputs": {"id": study_id, "expectedRevision": revision, "document": document},
                 "source": captured, "report": calculation, "reportSha256": digest(calculation)}
    candidate["previewSha256"] = digest(candidate)
    return candidate


def save(operations, context, data, actor, version, note):
    obj(data, ("inputs", "expectedPreviewSha256"), "Reviewed task comparison")
    candidate = preview(operations, context, {"expectedVersion": context["program"]["version"], "inputs": data.get("inputs")})
    if candidate["previewSha256"] != domain.sha(data.get("expectedPreviewSha256"), "Reviewed comparison preview", False):
        fail("The task comparison differs from the reviewed preview.", "TASK_OUTCOMES_PREVIEW", 409)
    inputs = candidate["inputs"]
    prior = next((row for row in heads(records(operations, context["program"]["id"])) if row["edition"]["id"] == inputs["id"]), None)
    row = {"schema": SCHEMA, "id": inputs["id"], "revision": inputs["expectedRevision"] + 1,
           "previous": None if prior is None else {"id": prior["source"]["id"], "sha256": prior["source"]["sha256"],
                                                "revision": prior["edition"]["revision"]},
           "caseVersion": version, "savedAt": now(), "actor": actor, "note": note,
           "document": candidate["inputs"]["document"], "source": candidate["source"],
           "report": candidate["report"], "reportSha256": candidate["reportSha256"],
           "previewSha256": candidate["previewSha256"]}
    row["sha256"] = digest(row)
    raw = (canonical(row) + "\n").encode()
    metadata = operations._source_add(context["program"]["id"], {
        "contentBase64": base64.b64encode(raw).decode("ascii"), "filename": row["id"] + "-r" + str(row["revision"]) + ".json",
        "mediaType": MEDIA, "kind": "other", "observedAt": row["savedAt"]})
    metadata[MARKER] = {"schema": SCHEMA, "id": row["id"], "revision": row["revision"], "sha256": row["sha256"]}
    operations.db.execute("UPDATE ops_sources SET metadata_json=? WHERE program_id=? AND id=?",
                          (canonical(metadata), context["program"]["id"], metadata["id"]))
    return {"before": None, "after": metadata, "kind": "source", "recordId": metadata["id"],
            "taskOutcomes": summary({"source": metadata, "edition": row})}


def validate_import(context, events, files, saved_installations, *, plan_for_version=None):
    rows = []
    for metadata in context["sources"].values():
        if MARKER in metadata:
            rows.append(read_record(metadata, files["sources/" + metadata["id"]]))
    checked_chain(rows)
    source_ids = {r["source"]["id"] for r in rows}
    matched = set()
    installations = {(r["id"], r["revision"]): r for r in saved_installations}
    for row in rows:
        edition, metadata = row["edition"], row["source"]
        document = normalized(context, edition["document"])
        if document != edition["document"]:
            fail("A retained task comparison input differs from its original normalized form.")
        version = edition["caseVersion"]
        if version > len(events):
            fail("The task comparison has no original case event.")
        event = events[version - 1]
        if (event.get("action") != "task-outcomes.save" or event.get("recordId") != metadata["id"]
                or event.get("kind") != "source" or event.get("after") != metadata
                or event.get("actor") != edition["actor"] or event.get("note", "") != edition["note"]):
            fail("The task comparison does not join its original save event.")
        captured = edition.get("source")
        if not isinstance(captured, dict) or captured.get("case", {}).get("version") != version - 1:
            fail("The task comparison lacks its original case selection.")
        selected_plan = plan_for_version(version - 1) if plan_for_version is not None else context["plan"]
        if (captured["case"].get("planContentSha256") != selected_plan["contentSha256"]
                or captured["case"].get("planRevision") != selected_plan["revision"]):
            fail("The task comparison's original pinned planning source differs.")
        selected_source_ids = selected_ids(document, "sources")
        if captured.get("sources") != [context["sources"][key] for key in selected_source_ids]:
            fail("The comparison's complete selected source attachments differ.")
        for key, ids in (("deployments", selected_ids(document, "deployments")), ("purchases", selected_ids(document, "purchases"))):
            selected = captured.get(key)
            if not isinstance(selected, list) or {r.get("id") for r in selected} != set(ids) or len(selected) != len(ids):
                fail("The comparison's retained " + key + " selection is incomplete.")
            for original in selected:
                found = any(e.get("kind") == key and e.get("recordId") == original["id"]
                            and e.get("after") == original and e.get("version", 0) < version for e in events)
                if not found:
                    fail("The comparison's " + key + " does not match its original historical record.")
        chosen = document["installation"]
        expected_installation = installations.get((chosen["id"], chosen["revision"])) if chosen else None
        if chosen and expected_installation is None or captured.get("installation") != expected_installation:
            fail("The complete original installation selected by the comparison is missing.")
        candidate = {"schema": SCHEMA + ".preview", "inputs": {"id": edition["id"],
                     "expectedRevision": edition["revision"] - 1, "document": document},
                     "source": captured, "report": edition["report"], "reportSha256": edition["reportSha256"]}
        if digest(candidate) != edition.get("previewSha256"):
            fail("The task comparison no longer matches its original reviewed preview.")
        matched.add(metadata["id"])
    if {e.get("recordId") for e in events if e.get("action") == "task-outcomes.save"} != source_ids or matched != source_ids:
        fail("The complete case is missing a retained customer task edition.")
    return rows


def html_report(row):
    edition, source = row["edition"], row["source"]
    document, calculation = edition["document"], edition["report"]
    escape = lambda v: html.escape(str(v if v is not None else "Unknown"), quote=True)
    def table(headers, values):
        return "<div class='table'><table><thead><tr>" + "".join("<th>" + escape(v) + "</th>" for v in headers) + "</tr></thead><tbody>" + "".join("<tr>" + "".join("<td>" + escape(v) + "</td>" for v in line) + "</tr>" for line in values) + "</tbody></table></div>"
    content = "<h1>" + escape(document["title"]) + "</h1><p>" + escape(document["customer"]) + " · revision " + str(edition["revision"]) + " · " + escape(document["status"]) + "</p>"
    content += "<h2>Useful task</h2><p>" + escape(document["task"]) + "</p><p>Unit: " + escape(document["unit"]) + ". Currency: " + escape(document["currency"]) + ".</p>"
    content += "<h2>Complete scope</h2>" + table(["Selection", "Prior method", "Installed method"], [(key, document["baseline"][key], document["installed"][key]) for key in ("name", "basis", "observedAt", "sourceReference", "population", "period", "output", "quality", "notes")])
    content += "<h2>Effort and cost</h2>" + table(["Measurement", "Prior", "Installed"], [(key, calculation["baseline"][key], calculation["installed"][key]) for key in ("attemptedTasks", "completedTasks", "incompleteTasks", "elapsedMinutes", "personMinutes", "labourCost", "otherCost", "totalCost", "personMinutesPerCompletedTask", "costPerCompletedTask")])
    content += "<p>" + escape(calculation["basis"]) + "</p><h2>Reviewed comparison</h2><p>" + escape(document["comparison"]["decision"]) + "</p><p>" + escape(document["comparison"]["reason"]) + "</p>"
    content += table(["Measurement", "Prior minus installed", "Percent"], [(key, value["difference"] if value else None, value["percent"] if value else None) for key, value in calculation["savings"].items()])
    for side, label in (("baseline", "Prior method"), ("installed", "Installed method")):
        value = document[side]
        content += "<h2>" + label + " — complete work</h2>" + table(["ID", "Work", "Category", "Person-minutes", "Hourly rate", "Notes"], [(r["id"], r["label"], r["category"], r["personMinutes"], r["hourlyRate"], r["notes"]) for r in value["effort"]])
        content += table(["ID", "Other cost", "Amount", "Notes"], [(r["id"], r["label"], r["amount"], r["notes"]) for r in value["costs"]])
    content += "<h2>Findings</h2>" + table(["Field", "Review item"], [(r["path"], r["message"]) for r in calculation["findings"]])
    content += "<h2>Customer conclusion</h2><p>" + escape(document["conclusion"]) + "</p>"
    if "followups" in document:
        content += recurring_html(document, calculation, table, escape)
    content += "<h2>Original selection</h2><pre>" + escape(json.dumps(edition["source"], ensure_ascii=False, indent=2)) + "</pre>"
    content += "<p>Saved " + escape(edition["savedAt"]) + " by " + escape(edition["actor"]) + ". " + escape(edition["note"]) + "</p><p>Original source " + escape(source["id"]) + " · SHA-256 " + escape(source["sha256"]) + "</p>"
    return ("<!doctype html><html lang='en'><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'><title>" + escape(document["title"]) + "</title><style>body{font:15px/1.5 system-ui,sans-serif;color:#181818;background:#fff;max-width:1100px;margin:24px auto;padding:0 20px}h1,h2{line-height:1.2}p,td,pre{white-space:pre-wrap;overflow-wrap:anywhere}.table{overflow-x:auto}table{border-collapse:collapse;width:100%;margin:16px 0}th,td{border:1px solid #aaa;padding:8px;text-align:left;vertical-align:top}th{background:#eee}pre{font:12px/1.4 monospace;border:1px solid #aaa;padding:12px}@media print{body{max-width:none;margin:0}h2{break-after:avoid}tr{break-inside:avoid}.table{overflow:visible}}</style><body>" + content + "</body></html>\n").encode()


def recurring_html(document, calculation, table, escape):
    series = calculation["series"]
    content = "<h2>Recurring customer observations</h2><p>" + escape(series["basis"]) + "</p>"
    content += table(["Observations", "Reviewed", "Accepted", "Declined", "Pending", "Accepted comparable observed"],
                     [[series[key] for key in ("observations", "reviewed", "accepted", "declined", "pending", "acceptedComparableObserved")]])
    content += "<p>Observed UTC dates of accepted comparable observations: " + escape(", ".join(series["observedUtcDates"]) or "None recorded") + ".</p>"
    content += table(["Observation", "Review", "Customer response", "Completed", "Person-minutes", "Elapsed minutes", "Total cost"],
                     [(row["label"], row["status"], row["acceptance"]["status"],
                       row["report"]["installed"]["completedTasks"], row["report"]["installed"]["personMinutes"],
                       row["report"]["installed"]["elapsedMinutes"], row["report"]["installed"]["totalCost"])
                      for row in calculation["followups"]])
    for observation, derived in zip(document["followups"], calculation["followups"]):
        method, report = observation["method"], derived["report"]
        content += "<h3>" + escape(observation["label"]) + "</h3><p>Original observation " + escape(observation["id"]) + ".</p>"
        content += table(["Scope / method", "Original observation"],
                         [(key, method[key]) for key in ("name", "basis", "observedAt", "sourceReference", "population", "period", "output", "quality", "notes")])
        content += table(["Measurement", "Original baseline", "Recurring method"],
                         [(key, report["baseline"][key], report["installed"][key]) for key in
                          ("attemptedTasks", "completedTasks", "incompleteTasks", "elapsedMinutes", "personMinutes",
                           "labourCost", "otherCost", "totalCost", "personMinutesPerCompletedTask", "costPerCompletedTask")])
        content += table(["Measurement", "Baseline minus recurring", "Percent"],
                         [(key, value["difference"] if value else None, value["percent"] if value else None)
                          for key, value in report["savings"].items()])
        elapsed = derived["elapsedMinutesDifference"]
        content += "<p>Whole-operation elapsed difference: " + escape(elapsed["difference"] if elapsed else None) + " minutes. Active effort remains separate.</p>"
        content += table(["Changed scope", "Baseline", "Recurring"],
                         [(row["field"], row["prior"], row["installed"]) for row in report["scopeDifferences"]])
        content += table(["ID", "Work", "Category", "Person-minutes", "Hourly rate", "Notes"],
                         [(row["id"], row["label"], row["category"], row["personMinutes"], row["hourlyRate"], row["notes"]) for row in method["effort"]])
        content += table(["ID", "Other cost", "Amount", "Notes"],
                         [(row["id"], row["label"], row["amount"], row["notes"]) for row in method["costs"]])
        content += "<p>Operator review: " + escape(observation["status"]) + " · " + escape(observation["comparison"]["decision"]) + ".</p><p>" + escape(observation["comparison"]["reason"]) + "</p><p>" + escape(observation["conclusion"]) + "</p>"
        acceptance = observation["acceptance"]
        content += "<h4>Customer response</h4>" + table(["State", "Actual reviewer", "Original response time", "Response / source"],
                                                       [[acceptance[key] for key in ("status", "by", "at", "note")]])
        content += table(["Original selection", "Record IDs"],
                         [("Attachments", ", ".join(method["sourceIds"])),
                          ("Deployments", ", ".join(observation["deploymentIds"])),
                          ("Purchase observations", ", ".join(observation["purchaseIds"]))])
        content += table(["Field", "Review item"], [(row["path"], row["message"]) for row in report["findings"]])
    return content


def csv_reports(row):
    document = row["edition"]["document"]
    effort, costs = [], []
    for side in ("baseline", "installed"):
        for value in document[side]["effort"]:
            effort.append({"method": side, "basis": document[side]["basis"], "currency": document["currency"], **value})
        for value in document[side]["costs"]:
            costs.append({"method": side, "basis": document[side]["basis"], "currency": document["currency"], **value})
    for observation in document.get("followups", []):
        method = observation["method"]
        common = {"method": "followup:" + observation["id"], "basis": method["basis"], "currency": document["currency"]}
        effort.extend({**common, **value} for value in method["effort"])
        costs.extend({**common, **value} for value in method["costs"])
    return {"task-outcomes-effort.csv": csv_bytes(["method", "basis", "id", "label", "category", "personMinutes", "hourlyRate", "currency", "notes"], effort),
            "task-outcomes-costs.csv": csv_bytes(["method", "basis", "id", "label", "amount", "currency", "notes"], costs)}


def selected_files(operations, program_id, study_id, revision):
    if revision is None:
        fail("Select the saved customer task revision for complete receiving.")
    result = get(operations, program_id, study_id, revision)
    row = {"source": result["source"], "edition": result["edition"]}
    selection = {"schema": SCHEMA + ".selection", "id": row["edition"]["id"],
                 "revision": row["edition"]["revision"], "sourceId": row["source"]["id"],
                 "sourceSha256": row["source"]["sha256"], "editionSha256": row["edition"]["sha256"]}
    return {"task-outcomes-selection.json": (canonical(selection) + "\n").encode(),
            "task-outcomes.html": html_report(row), **csv_reports(row)}


def selection_from_files(document, files):
    present = SELECTION_FILES.intersection(files)
    if not present:
        return None
    if present != SELECTION_FILES:
        fail("The complete task comparison report selection is required.")
    try:
        selection = json.loads(files["task-outcomes-selection.json"])
        metadata = next(r for r in document["sources"] if r["id"] == selection["sourceId"])
        row = read_record(metadata, files["sources/" + metadata["id"]])
        expected = {"schema": SCHEMA + ".selection", "id": row["edition"]["id"], "revision": row["edition"]["revision"],
                    "sourceId": metadata["id"], "sourceSha256": metadata["sha256"], "editionSha256": row["edition"]["sha256"]}
        derived = {"task-outcomes-selection.json": (canonical(expected) + "\n").encode(),
                   "task-outcomes.html": html_report(row), **csv_reports(row)}
        if selection != expected or any(files[name] != raw for name, raw in derived.items()):
            fail("The selected customer report differs from its original complete saved edition.")
        return expected
    except (KeyError, TypeError, ValueError, StopIteration) as exc:
        if isinstance(exc, Problem):
            raise
        fail("The customer task report selection cannot be received.")
