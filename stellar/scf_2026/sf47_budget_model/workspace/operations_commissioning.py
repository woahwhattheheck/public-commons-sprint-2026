"""Source-bound commissioning inside the original Installation edition.

The Console owns its cycles and native runs. Customer use owns dated tasks and
funding groups. This module joins their retained identities, prices and receiving
decisions; the existing Installation writer owns the transaction and history.
"""
from __future__ import annotations

from collections import defaultdict
from copy import deepcopy
from html import escape
import json
import re

from model import Problem, canonical, digest, text
import operations_domain as domain
import operations_use_calendar as use_calendar
import operations_installation_workflows as workflow_join

SCHEMA = "stellar-forge.sf47-customer-commissioning.v1"
REVIEW_STATES = ("OPEN", "APPROVED", "CHANGES_REQUIRED")
MAX_LINKS = 500
MAX_CYCLES = 100
MAX_RECEIPT_LINKS = 200
FACT_FIELDS = ("cycleId", "profileId", "seriesId", "seriesRevision", "seriesName",
    "customer", "task", "period", "dueDate", "sourceEdition", "reason", "runId",
    "state", "completedAt", "planSha256", "resultSha256", "calls", "steps", "files")
REVIEW_FIELDS = ("state", "actor", "observedAt", "note", "basisSha256")


def fail(message, code="INVALID_COMMISSIONING", status=422):
    raise Problem(message, status, code)


def obj(value, fields, label):
    if not isinstance(value, dict) or set(value) - set(fields):
        fail("Use the complete declared " + label + " fields.")
    return value


def rows(value, maximum, label):
    if not isinstance(value, list) or len(value) > maximum or any(not isinstance(row, dict) for row in value):
        fail("Use at most " + str(maximum) + " complete " + label + " rows.")
    return value


def _text(value, label, limit=4000, required=False):
    return text(value if value is not None else "", label, limit, required)


def _id(value, label):
    value = _text(value, label, 160, True)
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._:-]{0,159}", value):
        fail("Retain the exact original " + label + ".")
    return value


def _atomic(value, label):
    if value in (None, ""):
        return None
    if not isinstance(value, str) or not re.fullmatch(r"0|[1-9][0-9]{0,29}", value):
        fail(label + ": retain a nonnegative atomic amount as decimal text.")
    return value


def empty_review():
    return {"state": "OPEN", "actor": "", "observedAt": None, "note": "", "basisSha256": ""}


def _review(value, label):
    value = obj(value or {}, REVIEW_FIELDS, label)
    result = {"state": domain.enum(value.get("state", "OPEN"), REVIEW_STATES, label),
        "actor": _text(value.get("actor"), "Recorded reviewing operator", 500),
        "observedAt": domain.timestamp(value.get("observedAt"), "Recorded review time", True),
        "note": _text(value.get("note"), "Review decision and basis", 8000),
        "basisSha256": domain.sha(value.get("basisSha256"), "Reviewed commissioning basis")}
    if result["state"] != "OPEN" and not all(result[key] for key in ("actor", "observedAt", "note", "basisSha256")):
        fail("A recorded commissioning decision needs its operator, time, reason and exact reviewed basis.")
    return result


def _refs(values, available, label, limit=200):
    return domain.reference_list(values if values is not None else [], available, label, limit)


def _unique(values, field, label):
    if len({row[field] for row in values}) != len(values):
        fail("Keep each original " + label + " once.")
    return values


def normalize(context, raw, document):
    raw = obj(deepcopy(raw), ("schema", "note", "aggregateBudgetAtomic", "authority",
        "sourceIds", "budgetReview", "funding", "uses"), "commissioning document")
    if raw.get("schema", SCHEMA) != SCHEMA:
        fail("Select the original customer commissioning schema.")
    calendar = document.get("useCalendar")
    if calendar is None:
        fail("Create the original customer-use calendar before commissioning its tasks.")
    entries = {row["id"]: row for row in calendar["entries"]}
    funding = {row["id"]: row for row in calendar["settlements"]}
    period_binding = document.get("workflowPeriods")
    cycles = {row["cycleId"]: row for row in period_binding["periods"]} if period_binding else {}
    sources = context["sources"]
    purchases = {row["id"]: row for row in context["records"]["purchases"]}
    fund_rows = []
    for row in rows(raw.get("funding", []), MAX_LINKS, "funding review"):
        obj(row, ("fundingId", "units", "priceAtomic", "budgetAtomic", "sourceIds", "note", "review"), "funding review")
        ident = row.get("fundingId")
        _refs([ident], funding, "Original calendar funding group")
        fund_rows.append({"fundingId": ident,
            "units": domain.integer(row.get("units"), "Expected priced units", 0, 10**12, True),
            "priceAtomic": _atomic(row.get("priceAtomic"), "Selected original unit price"),
            "budgetAtomic": _atomic(row.get("budgetAtomic"), "Funding-group price budget"),
            "sourceIds": _refs(row.get("sourceIds"), sources, "Price and budget sources"),
            "note": _text(row.get("note"), "Price selection and complete priced unit", 8000),
            "review": _review(row.get("review"), "Funding review")})
    _unique(fund_rows, "fundingId", "funding group")
    use_rows = []
    for row in rows(raw.get("uses", []), MAX_LINKS, "use-to-cycle correspondence"):
        obj(row, ("entryId", "cycleIds", "facts", "sourceIds", "note", "outputEvidence",
            "outputFiles", "receiptLinks", "planReview", "receivingReview"), "use correspondence")
        entry_id = row.get("entryId")
        _refs([entry_id], entries, "Original dated customer use")
        cycle_ids = sorted(_refs(row.get("cycleIds", []), cycles, "Selected original Console cycle", MAX_CYCLES))
        facts = rows(row.get("facts", []), MAX_CYCLES, "selected cycle facts")
        if len(facts) != len(cycle_ids) or {value.get("cycleId") for value in facts} != set(cycle_ids):
            fail("Refresh the selected original cycles to retain their complete source facts.", "COMMISSIONING_REFRESH_REQUIRED", 409)
        for value in facts:
            if set(value) != set(FACT_FIELDS):
                fail("Refresh the exact original cycle facts.", "COMMISSIONING_REFRESH_REQUIRED", 409)
        output_files = []
        for item in rows(row.get("outputFiles", []), 1000, "selected output file"):
            obj(item, ("cycleId", "deliveryId", "path", "bytes", "sha256"), "selected output file")
            _refs([item.get("cycleId")], cycle_ids, "Selected output cycle")
            output_files.append({"cycleId": item["cycleId"],
                "deliveryId": _id(item.get("deliveryId"), "customer delivery identity"),
                "path": _text(item.get("path"), "Original customer file path", 4096, True),
                "bytes": domain.integer(item.get("bytes"), "Original customer file bytes", 0, 32 * 1024 * 1024),
                "sha256": domain.sha(item.get("sha256"), "Original customer file", False)})
        if len({(item["cycleId"], item["deliveryId"], item["path"]) for item in output_files}) != len(output_files):
            fail("Select each original customer file once per cycle.")
        allowed_receipts = {pid for fid in entries[entry_id]["fundingIds"] for pid in funding[fid]["purchaseIds"]}
        receipt_links = []
        for item in rows(row.get("receiptLinks", []), MAX_RECEIPT_LINKS, "receipt correspondence"):
            obj(item, ("purchaseId", "cycleId", "callId", "note"), "receipt correspondence")
            _refs([item.get("purchaseId")], purchases, "Original received purchase")
            if item["purchaseId"] not in allowed_receipts:
                fail("Select a receipt already associated with this use's original calendar funding group.")
            _refs([item.get("cycleId")], cycle_ids, "Original receipt cycle")
            receipt_links.append({"purchaseId": item["purchaseId"], "cycleId": item["cycleId"],
                "callId": _id(item.get("callId"), "original native call identity"),
                "note": _text(item.get("note"), "Operator's source correspondence basis", 8000, True)})
        if len({(item["purchaseId"], item["cycleId"], item["callId"]) for item in receipt_links}) != len(receipt_links):
            fail("Keep each original receipt and native-call correspondence once.")
        use_rows.append({"entryId": entry_id, "cycleIds": cycle_ids,
            "facts": sorted(deepcopy(facts), key=lambda value: value["cycleId"]),
            "sourceIds": _refs(row.get("sourceIds"), sources, "Commissioning correspondence sources"),
            "note": _text(row.get("note"), "Complete task and original cycle correspondence", 8000),
            "outputEvidence": domain.enum(row.get("outputEvidence", "UNSELECTED"),
                ("UNSELECTED", "NATIVE_RESULTS", "SELECTED_FILES"), "Useful output evidence"),
            "outputFiles": output_files, "receiptLinks": receipt_links,
            "planReview": _review(row.get("planReview"), "Planned-use review"),
            "receivingReview": _review(row.get("receivingReview"), "Useful-output review")})
    _unique(use_rows, "entryId", "dated use")
    return {"schema": SCHEMA, "note": _text(raw.get("note"), "Commissioning scope and change handling", 12000),
        "aggregateBudgetAtomic": _atomic(raw.get("aggregateBudgetAtomic"), "Aggregate selected price budget"),
        "authority": _text(raw.get("authority"), "Selected buyer budget authority", 8000),
        "sourceIds": _refs(raw.get("sourceIds"), sources, "Commissioning and budget sources"),
        "budgetReview": _review(raw.get("budgetReview"), "Aggregate budget review"),
        "funding": fund_rows, "uses": use_rows}


def references(document):
    value = document.get("commissioning")
    if value is None:
        return {"sourceIds": [], "purchaseIds": []}
    source_ids, purchase_ids = set(value["sourceIds"]), set()
    for collection in ("funding", "uses"):
        for row in value[collection]:
            source_ids.update(row["sourceIds"])
            purchase_ids.update(item["purchaseId"] for item in row.get("receiptLinks", []))
    return {"sourceIds": sorted(source_ids), "purchaseIds": sorted(purchase_ids)}


def _facts(original, profile_id):
    summary = workflow_join.period_summary(original)
    cycle, series, run = original["cycle"], original["series"], original["run"]
    planned_cycle = {key: deepcopy(cycle.get(key)) for key in ("id", "profileId", "seriesId",
        "seriesRevision", "seriesSha256", "workflowId", "workflowRevision", "workflowSha256",
        "runId", "inputsJson", "request")}
    report = original.get("reportPacket")
    calls = report.get("archive", {}).get("calls", []) if report else []
    files = []
    for customer in original["customers"]:
        for row in customer["files"]:
            files.append({"deliveryId": customer["id"], **deepcopy(row)})
    return {"cycleId": cycle["id"], "profileId": profile_id, "seriesId": series["id"],
        "seriesRevision": series["revision"], "seriesName": str(series["name"]),
        "customer": str(series["customer"]), "task": str(series["task"]),
        "period": deepcopy(cycle["request"]["period"]), "dueDate": cycle["request"]["dueDate"],
        "sourceEdition": cycle["request"]["sourceEdition"], "reason": cycle["request"]["reason"],
        "runId": cycle["runId"], "state": summary["state"], "completedAt": summary["completedAt"],
        "planSha256": digest({"series": series, "cycle": planned_cycle}),
        "resultSha256": original["basisSha256"],
        "calls": [{"id": row["id"], "sha256": digest(row),
                   "state": row.get("state") if isinstance(row.get("state"), str) else "RETAINED"}
                  for row in calls],
        "steps": [{"index": index, "id": row.get("id", row.get("stepId")), "state": row.get("state")}
                  for index, row in enumerate(run["steps"] if run else [])],
        "files": files}


def _original(operations, context, document, reader=None):
    if not document.get("workflowPeriods"):
        return None
    return workflow_join.verify_document(operations, context, document, reader)


def verify_document(operations, context, document, reader=None, original=None):
    value = document.get("commissioning")
    if value is None:
        return None
    original = original if original is not None else _original(operations, context, document, reader)
    available = {row["cycle"]["id"]: row for row in original["selectedPeriods"]} if original else {}
    profile_id = original["manifest"]["profileId"] if original else None
    for row in value["uses"]:
        if not set(row["cycleIds"]) <= set(available):
            fail("A selected original cycle is not in this complete workflow source.", "COMMISSIONING_SOURCE_SELECTION", 409)
        expected = [_facts(available[ident], profile_id) for ident in row["cycleIds"]]
        if expected != row["facts"]:
            fail("The original Console period, run or selected customer files changed. Refresh this correspondence; its earlier review remains in the preceding Installation edition.",
                 "COMMISSIONING_REFRESH_REQUIRED", 409)
    return original


def _review_status(review, basis, ready):
    current = bool(review["basisSha256"] and review["basisSha256"] == basis)
    return {**deepcopy(review), "basisCurrent": current,
        "status": "OPEN" if review["state"] == "OPEN" else "CURRENT" if current else "STALE",
        "effectiveApproval": review["state"] == "APPROVED" and current and ready}


def _source_rows(context, ids):
    return [deepcopy(context["sources"][ident]) for ident in sorted(set(ids))]


def _identity(row):
    return {key: deepcopy(row.get(key)) for key in ("id", "name", "operator", "operatorId",
        "role", "participantClass", "environment", "endpoint")}


def _funding_plan(row):
    return {key: deepcopy(value) for key, value in row.items() if key != "purchaseIds"}


def _money_basis(document):
    payment = document["payment"]
    return {key: deepcopy(payment[key]) for key in ("network", "asset", "recipient", "authority",
        "termsSourceIds", "facilitators")}


def _receipt_identity(row):
    # Settled amount reconciliation uses the original transfer identity. Intent
    # identity remains visible and is checked for contradictory relationships.
    tx = row.get("transactionHash")
    if tx:
        return ("TRANSFER", row.get("network", ""), str(tx).lower())
    return ("OBSERVATION", row.get("network", ""), row.get("asset", ""),
            row.get("intentId") or row["id"])


def _received_amount(purchases, payment):
    groups, issues = defaultdict(list), []
    settled_by_intent, settled_by_transfer = defaultdict(list), defaultdict(list)
    complete = True
    for row in purchases:
        if row.get("state") == "VOID":
            continue
        groups[_receipt_identity(row)].append(row)
        if row.get("settlementStatus") != "SETTLED":
            continue
        tx = row.get("transactionHash")
        if not tx:
            complete = False
            issues.append({"code": "RECEIPT_TRANSFER_MISSING", "purchaseIds": [row["id"]],
                "message": "The recorded settled observation has no original transfer identity."})
        else:
            settled_by_transfer[(row.get("network", ""), str(tx).lower())].append(row)
        if row.get("intentId"):
            settled_by_intent[(row.get("network", ""), row["intentId"])].append(row)
    for values in settled_by_intent.values():
        transfers = {str(row["transactionHash"]).lower() for row in values if row.get("transactionHash")}
        if len(transfers) > 1:
            complete = False
            issues.append({"code": "RECEIPT_INTENT_TRANSFERS_CONFLICT",
                "purchaseIds": sorted(row["id"] for row in values),
                "message": "The same original intent is associated with different settled transactions. Reconcile the original observations before comparing this budget."})
    for values in settled_by_transfer.values():
        intents = {row["intentId"] for row in values if row.get("intentId")}
        if len(intents) > 1:
            complete = False
            issues.append({"code": "RECEIPT_TRANSFER_INTENTS_CONFLICT",
                "purchaseIds": sorted(row["id"] for row in values),
                "message": "The same original settled transaction is associated with different intents. Reconcile the original observations before comparing this budget."})
    total = 0
    for values in groups.values():
        actual = [row for row in values if row.get("settlementStatus") == "SETTLED"]
        if not actual:
            continue
        if any(row.get("network") != payment["network"] or row.get("asset") != payment["asset"]
               or row.get("recipient") != payment["recipient"] for row in actual):
            complete = False
            issues.append({"code": "RECEIPT_TERMS", "purchaseIds": [row["id"] for row in actual],
                "message": "The original settled receipt has different or unentered network, asset or recipient."})
            continue
        amounts = {row.get("amountStroops") for row in actual}
        if len(amounts) != 1 or any(not isinstance(amount, str) or not re.fullmatch(r"0|[1-9][0-9]*", amount) for amount in amounts):
            complete = False
            issues.append({"code": "RECEIPT_AMOUNT_CONFLICT", "purchaseIds": [row["id"] for row in actual],
                "message": "Retain and reconcile the differing original amounts for this transfer."})
            continue
        total += int(next(iter(amounts)))
    return {"recordedSettledAtomic": str(total) if complete else None, "completeAmountComparison": complete,
        "identityGroups": len(groups), "issues": issues}


def report(context, document):
    value = document.get("commissioning")
    if value is None:
        return None
    calendar = document["useCalendar"]
    entries = {row["id"]: row for row in calendar["entries"]}
    groups = {row["id"]: row for row in calendar["settlements"]}
    tasks = {row["id"]: row for row in calendar["tasks"]}
    purchases = {row["id"]: row for row in context["records"]["purchases"]}
    deployments = {row["id"]: row for row in context["records"]["deployments"]}
    payment = document["payment"]
    merchant = deployments.get(document["merchantDeploymentId"])
    selection = _money_basis(document)
    findings, funding_views, funding_by_id = [], [], {}
    active_groups = {ident for row in calendar["entries"] if row["state"] != "CANCELLED" for ident in row["fundingIds"]}
    group_uses = {ident: [row["id"] for row in calendar["entries"] if ident in row["fundingIds"]] for ident in groups}
    for row in value["funding"]:
        ident = row["fundingId"]
        group = groups[ident]
        task = tasks[group["taskId"]]
        planned = None if row["units"] is None or row["priceAtomic"] is None else str(row["units"] * int(row["priceAtomic"]))
        reasons = []
        if planned is None or row["budgetAtomic"] is None:
            reasons.append("Enter the priced units, original unit price and funding-group budget.")
        elif int(planned) > int(row["budgetAtomic"]):
            reasons.append("The expected priced units exceed this funding group's budget.")
        if not row["note"].strip():
            reasons.append("Describe the complete priced unit and the selected price's source.")
        if not all(payment[key] for key in ("network", "asset", "recipient")):
            reasons.append("Select the original network, asset and recipient in Installation payment.")
        basis = digest({"schema": SCHEMA + ".funding-basis", "funding": _funding_plan(group), "task": task,
            "buyer": _identity(deployments[group["buyerDeploymentId"]]), "merchant": _identity(merchant) if merchant else None,
            "payment": selection, "price": {key: row[key] for key in ("units", "priceAtomic", "budgetAtomic", "sourceIds", "note")},
            "sources": _source_rows(context, row["sourceIds"] + payment["termsSourceIds"])})
        received = [use_calendar.receipt_view(purchases[pid]) for pid in group["purchaseIds"]]
        amount = _received_amount(received, payment)
        if amount["recordedSettledAtomic"] is not None and row["budgetAtomic"] is not None \
                and int(amount["recordedSettledAtomic"]) > int(row["budgetAtomic"]):
            amount["issues"].append({"code": "RECORDED_BUDGET_EXCEEDED",
                "purchaseIds": group["purchaseIds"], "message": "Original settled value exceeds the entered funding-group price budget."})
        item = {**deepcopy(row), "group": deepcopy(group), "task": deepcopy(task),
            "active": ident in active_groups, "useIds": group_uses[ident], "expectedAtomic": planned,
            "basisSha256": basis, "canApprove": not reasons, "reviewFindings": reasons,
            "review": _review_status(row["review"], basis, not reasons), "receipts": received, **amount}
        funding_views.append(item); funding_by_id[ident] = item
    uncovered = sorted(active_groups - set(funding_by_id))
    for ident in uncovered:
        findings.append({"code": "UNREVIEWED_FUNDING", "id": ident, "message": "Prepare priced-unit and budget selection for this active original funding group."})
    selected_funding = [row for row in funding_views if row["active"]]
    all_known = not uncovered and all(row["expectedAtomic"] is not None for row in selected_funding)
    expected_total = str(sum(int(row["expectedAtomic"]) for row in selected_funding)) if all_known else None
    total_caps = str(sum(int(row["budgetAtomic"]) for row in selected_funding)) \
        if not uncovered and all(row["budgetAtomic"] is not None for row in selected_funding) else None
    budget_reasons = []
    if value["aggregateBudgetAtomic"] is None:
        budget_reasons.append("Enter the aggregate price budget for the selected funding groups.")
    if not value["authority"].strip():
        budget_reasons.append("Record the buyer's original aggregate budget authority.")
    if expected_total is None or total_caps is None:
        budget_reasons.append("Complete every active funding group's priced units and budget.")
    elif value["aggregateBudgetAtomic"] is not None and int(total_caps) > int(value["aggregateBudgetAtomic"]):
        budget_reasons.append("The sum of active funding-group budgets exceeds the aggregate budget.")
    if any(not row["review"]["effectiveApproval"] for row in selected_funding):
        budget_reasons.append("Review each active funding group's exact original price and unit selection.")
    budget_basis = digest({"schema": SCHEMA + ".budget-basis", "payment": selection, "workorder": document["workorder"],
        "funding": [{"id": row["fundingId"], "basisSha256": row["basisSha256"]} for row in selected_funding],
        "uncoveredFundingIds": uncovered, "aggregateBudgetAtomic": value["aggregateBudgetAtomic"],
        "authority": value["authority"], "sources": _source_rows(context, value["sourceIds"])})
    all_receipts = {pid: purchases[pid] for ident in active_groups for pid in groups[ident]["purchaseIds"]}
    aggregate_actual = _received_amount(list(all_receipts.values()), payment)
    if aggregate_actual["recordedSettledAtomic"] is not None and value["aggregateBudgetAtomic"] is not None \
            and int(aggregate_actual["recordedSettledAtomic"]) > int(value["aggregateBudgetAtomic"]):
        aggregate_actual["issues"].append({"code": "AGGREGATE_RECORDED_BUDGET_EXCEEDED",
            "purchaseIds": sorted(all_receipts), "message": "Original settled value exceeds the selected aggregate price budget."})
    use_views, cycle_owners = [], defaultdict(list)
    for row in value["uses"]:
        entry = entries[row["entryId"]]
        task = tasks[entry["taskId"]]
        native = {item["cycleId"]: item for item in row["facts"]}
        plan_reasons, receive_reasons = [], []
        if not row["cycleIds"]:
            plan_reasons.append("Select the original Console cycle or cycles that perform this complete dated task.")
        if not row["note"].strip():
            plan_reasons.append("Record why these original cycles correspond to this customer's whole task.")
        if not all(task[key].strip() for key in ("request", "completeOutput", "repeatTrigger", "pricedUnit")):
            plan_reasons.append("Complete the original calendar task's request, useful output, repeat reason and priced unit.")
        if entry["state"] == "CANCELLED":
            plan_reasons.append("This original dated use is cancelled.")
        source_rows = _source_rows(context, row["sourceIds"] + entry["sourceIds"] + task["sourceIds"])
        plan_basis = digest({"schema": SCHEMA + ".use-plan-basis", "entry": entry, "task": task,
            "buyer": _identity(deployments[entry["buyerDeploymentId"]]),
            "merchant": _identity(merchant) if merchant else None,
            "cycles": [{"cycleId": item["cycleId"], "planSha256": item["planSha256"]} for item in row["facts"]],
            "correspondenceNote": row["note"], "sources": source_rows, "workorder": document["workorder"],
            "receiving": document["receiving"]})
        output_views = []
        for selected in row["outputFiles"]:
            fact = native.get(selected["cycleId"])
            matched = next((item for item in fact["files"] if all(item.get(key) == selected[key]
                for key in ("deliveryId", "path", "bytes", "sha256"))), None) if fact else None
            output_views.append({**deepcopy(selected), "matchesOriginal": matched is not None})
            if matched is None:
                receive_reasons.append("An output selection differs from the current selected original customer file: " + selected["path"])
        receipt_views = []
        for link in row["receiptLinks"]:
            fact = native.get(link["cycleId"])
            call = next((item for item in fact["calls"] if item["id"] == link["callId"]), None) if fact else None
            receipt_views.append({**deepcopy(link), "matchesOriginalCall": call is not None,
                "call": deepcopy(call), "purchase": use_calendar.receipt_view(purchases[link["purchaseId"]]),
                "basis": "EXPLICIT_OPERATOR_CORRESPONDENCE"})
            if call is None:
                receive_reasons.append("A selected native call is absent from this cycle's retained original report.")
        if not row["cycleIds"] or any(item["state"] != "COMPLETE" for item in row["facts"]):
            receive_reasons.append("Retain each selected cycle's complete original native result before accepting the whole output.")
        if row["outputEvidence"] == "UNSELECTED":
            receive_reasons.append("Select original native results or exact customer output files for review.")
        if row["outputEvidence"] == "SELECTED_FILES" and not output_views:
            receive_reasons.append("Select the complete original output files required for this useful result.")
        if entry["state"] == "CANCELLED":
            receive_reasons.append("This dated use is cancelled; retain the result separately or revise the original calendar explicitly.")
        if not row["note"].strip():
            receive_reasons.append("Describe the full task-to-result correspondence.")
        receipt_basis = digest({"schema": SCHEMA + ".use-receiving-basis", "planSha256": plan_basis,
            "cycles": row["facts"], "outputEvidence": row["outputEvidence"], "outputFiles": row["outputFiles"],
            "receiptLinks": receipt_views, "receiving": document["receiving"]})
        for cycle_id in row["cycleIds"]:
            cycle_owners[cycle_id].append(row["entryId"])
        current_funding = [funding_by_id[ident] for ident in entry["fundingIds"] if ident in funding_by_id]
        use_views.append({**deepcopy(row), "entry": deepcopy(entry), "task": deepcopy(task),
            "buyer": deepcopy(deployments[entry["buyerDeploymentId"]]),
            "planBasisSha256": plan_basis, "receivingBasisSha256": receipt_basis,
            "canApprovePlan": not plan_reasons, "canAcceptOutput": not receive_reasons,
            "planFindings": plan_reasons, "receivingFindings": receive_reasons,
            "planReview": _review_status(row["planReview"], plan_basis, not plan_reasons),
            "receivingReview": _review_status(row["receivingReview"], receipt_basis, not receive_reasons),
            "fundingReviewed": len(current_funding) == len(entry["fundingIds"]) and all(item["review"]["effectiveApproval"] for item in current_funding),
            "outputSelections": output_views, "receiptCorrespondence": receipt_views})
    unmatched = sorted(set(entries) - {row["entryId"] for row in value["uses"]})
    for ident in unmatched:
        findings.append({"code": "UNMAPPED_USE", "id": ident, "message": "This original dated use has no commissioning correspondence."})
    shared = [{"cycleId": ident, "entryIds": ids} for ident, ids in sorted(cycle_owners.items()) if len(ids) > 1]
    return {"schema": SCHEMA + ".report", "payment": selection,
        "budget": {"aggregateBudgetAtomic": value["aggregateBudgetAtomic"], "expectedAtomic": expected_total,
            "selectedGroupBudgetsAtomic": total_caps, "activeFundingGroups": len(active_groups),
            "uncoveredFundingIds": uncovered, "basisSha256": budget_basis, "canApprove": not budget_reasons,
            "findings": budget_reasons, "review": _review_status(value["budgetReview"], budget_basis, not budget_reasons),
            **aggregate_actual},
        "funding": funding_views, "uses": use_views, "sharedCycles": shared, "findings": findings,
        "summary": {"mappedUses": len(use_views), "planReviewedUses": sum(row["planReview"]["effectiveApproval"] for row in use_views),
            "acceptedOutputs": sum(row["receivingReview"]["effectiveApproval"] for row in use_views),
            "stalePlanReviews": sum(row["planReview"]["status"] == "STALE" for row in use_views),
            "staleOutputReviews": sum(row["receivingReview"]["status"] == "STALE" for row in use_views),
            "reviewedFundingGroups": sum(row["review"]["effectiveApproval"] for row in funding_views)},
        "calendar": use_calendar.report(context, document),
        "interpretation": {"amounts": "Atomic price amounts use the selected network, asset and recipient. Network fees remain in the original receipts and accounting.",
            "correspondence": "A selected native call and original purchase are an explicit operator correspondence. This selection does not authenticate a transfer or create a purchase.",
            "qualification": "The original Cohort review evaluates qualified purchases, operator independence, source coverage and completion.",
            "operation": "Continue the original Console cycle and buyer operation; this Installation records their selected results."}}


def _body(operations, context, body):
    import operations_installations as installations
    obj(body, ("expectedVersion", "installationId", "expectedRevision", "document", "reviews", "actor", "observedAt"),
        "commissioning preparation")
    installations._current(context, body.get("expectedVersion"))
    ident, number = body.get("installationId"), installations.revision(body.get("expectedRevision", 0), True)
    if ident is not None:
        selected = installations.get(operations, context["program"]["id"], ident)
        if selected["revision"] != number:
            fail("Reopen the current original Installation before staging this commissioning change.", "INSTALLATION_CONFLICT", 409)
    elif number:
        fail("A new Installation begins at edition zero.")
    raw = deepcopy(body.get("document"))
    if not isinstance(raw, dict):
        fail("Supply the complete original Installation draft.")
    original_commissioning = raw.pop("commissioning", None)
    document = installations.normalized(context, raw)
    if not document.get("useCalendar"):
        fail("Create the original customer-use calendar before commissioning its tasks.")
    original = _original(operations, context, document)
    return document, original_commissioning, original


def seed(operations, context, body):
    document, retained, original = _body(operations, context, body)
    calendar = document["useCalendar"]
    value = deepcopy(retained) if retained is not None else {"schema": SCHEMA, "note": "",
        "aggregateBudgetAtomic": None, "authority": "", "sourceIds": [],
        "budgetReview": empty_review(), "funding": [], "uses": []}
    obj(value, ("schema", "note", "aggregateBudgetAtomic", "authority", "sourceIds", "budgetReview", "funding", "uses"), "commissioning document")
    value.setdefault("funding", []); value.setdefault("uses", [])
    funding_rows = rows(value["funding"], MAX_LINKS, "funding review")
    use_rows = rows(value["uses"], MAX_LINKS, "use correspondence")
    if any(not isinstance(row.get("fundingId"), str) for row in funding_rows) or any(not isinstance(row.get("entryId"), str) for row in use_rows):
        fail("Retain each original funding group and dated-use identity.")
    existing_funding = {row["fundingId"] for row in funding_rows}
    existing_uses = {row["entryId"] for row in use_rows}
    for group in calendar["settlements"]:
        if group["id"] not in existing_funding:
            value["funding"].append({"fundingId": group["id"], "units": document["payment"]["taskUnits"],
                "priceAtomic": document["payment"]["priceAtomic"], "budgetAtomic": document["payment"]["taskBudgetAtomic"],
                "sourceIds": list(document["payment"]["termsSourceIds"]), "note": "", "review": empty_review()})
    for entry in calendar["entries"]:
        if entry["id"] not in existing_uses:
            value["uses"].append({"entryId": entry["id"], "cycleIds": [], "facts": [], "sourceIds": [], "note": "",
                "outputEvidence": "UNSELECTED", "outputFiles": [], "receiptLinks": [],
                "planReview": empty_review(), "receivingReview": empty_review()})
    available = {row["cycle"]["id"]: row for row in original["selectedPeriods"]} if original else {}
    profile_id = original["manifest"]["profileId"] if original else None
    refreshed = []
    for row in value["uses"]:
        supplied_cycles = row.get("cycleIds", [])
        if not isinstance(supplied_cycles, list) or any(not isinstance(ident, str) for ident in supplied_cycles) or len(supplied_cycles) != len(set(supplied_cycles)):
            fail("Select distinct original Console cycle identities.")
        cycle_ids = sorted(supplied_cycles)
        row["cycleIds"] = cycle_ids
        if not set(cycle_ids) <= set(available):
            fail("Keep the complete earlier and newly selected Console cycles in the original workflow handover before refreshing commissioning.",
                 "COMMISSIONING_SOURCE_SELECTION", 409)
        facts = [_facts(available[ident], profile_id) for ident in cycle_ids]
        if row.get("facts") != facts:
            refreshed.append(row["entryId"])
        row["facts"] = facts
    document["commissioning"] = normalize(context, value, document)
    verify_document(operations, context, document, original=original)
    return {"schema": SCHEMA + ".preparation", "document": document,
        "inventory": {"profileId": profile_id,
            "cycles": [_facts(row, profile_id) for row in original["selectedPeriods"]] if original else [],
            "entries": deepcopy(calendar["entries"]), "tasks": deepcopy(calendar["tasks"]),
            "funding": deepcopy(calendar["settlements"])},
        "refreshedEntryIds": refreshed, "report": report(context, document),
        "save": "Review this complete draft and save its next original Installation edition."}


def review(operations, context, body):
    prepared = seed(operations, context, body)
    document, view = prepared["document"], prepared["report"]
    decisions = rows(body.get("reviews"), MAX_LINKS * 2 + 1, "explicit commissioning decision")
    if not decisions:
        fail("Select at least one exact commissioning basis to review.")
    actor = _text(body.get("actor"), "Reviewing operator", 500, True)
    observed = domain.timestamp(body.get("observedAt"), "Actual recorded review time")
    funding = {row["fundingId"]: row for row in document["commissioning"]["funding"]}
    uses = {row["entryId"]: row for row in document["commissioning"]["uses"]}
    funding_view = {row["fundingId"]: row for row in view["funding"]}
    use_view = {row["entryId"]: row for row in view["uses"]}
    seen, staged = set(), []
    for item in decisions:
        # The document is a private prepared copy. Evaluating each explicit row
        # against earlier rows allows one atomic price-then-budget selection.
        view = report(context, document)
        funding_view = {row["fundingId"]: row for row in view["funding"]}
        use_view = {row["entryId"]: row for row in view["uses"]}
        obj(item, ("kind", "id", "state", "expectedBasisSha256", "note"), "commissioning review selection")
        kind = domain.enum(item.get("kind"), ("FUNDING", "BUDGET", "PLAN", "OUTPUT"), "Commissioning review kind")
        ident = item.get("id")
        identity = (kind, "budget" if kind == "BUDGET" else ident)
        if identity in seen:
            fail("Review each exact commissioning basis once in this prepared action.")
        seen.add(identity)
        if kind == "BUDGET":
            if ident not in (None, "budget"):
                fail("Select the aggregate budget review.")
            target, field = document["commissioning"], "budgetReview"
            basis, ready, reasons = view["budget"]["basisSha256"], view["budget"]["canApprove"], view["budget"]["findings"]
        elif kind == "FUNDING":
            if ident not in funding:
                fail("Select the original funding-group review.")
            target, field = funding[ident], "review"
            basis, ready, reasons = funding_view[ident]["basisSha256"], funding_view[ident]["canApprove"], funding_view[ident]["reviewFindings"]
        else:
            if ident not in uses:
                fail("Select the original dated-use review.")
            target = uses[ident]
            field = "planReview" if kind == "PLAN" else "receivingReview"
            basis = use_view[ident]["planBasisSha256" if kind == "PLAN" else "receivingBasisSha256"]
            ready = use_view[ident]["canApprovePlan" if kind == "PLAN" else "canAcceptOutput"]
            reasons = use_view[ident]["planFindings" if kind == "PLAN" else "receivingFindings"]
        if domain.sha(item.get("expectedBasisSha256"), "Exact reviewed commissioning basis", False) != basis:
            fail("The selected source, draft or original results changed. Review this same selection again.",
                 "COMMISSIONING_REVIEW_CONFLICT", 409)
        state = domain.enum(item.get("state"), ("APPROVED", "CHANGES_REQUIRED"), "Recorded review decision")
        if state == "APPROVED" and not ready:
            fail("Complete this selected review basis: " + " ".join(reasons), "COMMISSIONING_REVIEW_INCOMPLETE", 409)
        decision = {"state": state, "actor": actor, "observedAt": observed,
            "note": _text(item.get("note"), "Review decision", 8000, True), "basisSha256": basis}
        target[field] = decision
        staged.append(decision)
    prepared["report"] = report(context, document)
    prepared["reviewed"] = len(staged)
    return prepared


def html_section(document, view=None):
    if "commissioning" not in document:
        return ""
    value = document["commissioning"]
    e = lambda item: escape(str(item if item is not None else "Unentered"), quote=True)
    body = "<h2>Customer commissioning</h2><p>" + e(value["note"]) + "</p><p>Selected aggregate price budget: " + \
        e(value["aggregateBudgetAtomic"]) + " atomic " + e(document["payment"]["asset"]) + \
        ". Buyer authority: " + e(value["authority"]) + "</p>"
    body += "<h3>Original cycle correspondence</h3><table><thead><tr><th>Dated use</th><th>Original cycles</th><th>Planning decision</th><th>Receiving decision</th></tr></thead><tbody>"
    displayed = view["uses"] if view is not None else value["uses"]
    for row in displayed:
        status = lambda review: review["state"] + (" / " + review["status"] if "status" in review else "") + (" / effective" if review.get("effectiveApproval") else "")
        body += "<tr><td>" + e(row["entryId"]) + "</td><td>" + e(", ".join(row["cycleIds"])) + "</td><td>" + \
            e(status(row["planReview"])) + "<br>" + e(row["planReview"]["actor"]) + "</td><td>" + \
            e(status(row["receivingReview"])) + "<br>" + e(row["receivingReview"]["actor"]) + "</td></tr>"
    body += "</tbody></table><h3>Complete retained commissioning selection</h3><pre>" + e(json.dumps(value, ensure_ascii=False, indent=2)) + "</pre>"
    if view is not None:
        body += "<h3>Exact saved commissioning report</h3><pre>" + e(json.dumps(view, ensure_ascii=False, indent=2)) + "</pre>"
    return body
