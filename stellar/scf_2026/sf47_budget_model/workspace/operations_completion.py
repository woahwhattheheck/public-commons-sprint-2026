"""Payment-dated tranche completion inside the original SF47 operations store."""
from __future__ import annotations

from copy import deepcopy
from datetime import date, datetime, timedelta, timezone
import hashlib
import html
import io
import json
import re
import uuid
import zipfile

import operations_domain as domain
from model import canonical, digest, now, text, csv_bytes, MAX_BUNDLE

SCHEMA = "stellar-forge.sf47-completion-plan.v1"
PREVIEW_SCHEMA = "stellar-forge.sf47-completion-preview.v1"
RULE = {
    "calendarDays": 90,
    "paymentToCompletion": {"0": 1, "1": 2, "2": 3},
    "sourceUrl": "https://stellar.gitbook.io/scf-handbook/scf-awards/build-award/budget-and-deliverable-guidelines",
    "sourceSection": "Tranche Submission Deadlines",
    "checkedOn": "2026-10-12",
}
ITEM_KEYS = {"costId", "ownerIds", "startDate", "endDate", "state", "completedOn",
             "workIds", "deploymentIds", "sourceIds", "note", "completionNote"}
MAX_ITEMS = 200
MAX_EXTENSIONS = 100


def object_value(value, keys, label):
    if not isinstance(value, dict) or set(value) - set(keys):
        domain.fail("Use the declared " + label + " object.", "INVALID_COMPLETION")
    return value


def today():
    return datetime.now(timezone.utc).date().isoformat()


def day(value, label, optional=False):
    return domain.calendar(value, label, optional)


def plus_days(value, days):
    try:
        return (date.fromisoformat(value) + timedelta(days=days)).isoformat()
    except (ValueError, OverflowError):
        domain.fail("The retained payment or plan date exceeds the supported calendar.", "INVALID_COMPLETION")


def maps(context):
    return {kind: {row["id"]: row for row in context["records"][kind]} for kind in domain.KINDS}


def native_costs(context, tranche):
    return [row for row in context["plan"]["scenario"]["future_costs"] if row["tranche"] == tranche]


def selected_plan(context, tranche):
    return next((row for row in context.get("completionPlans", []) if row["tranche"] == tranche), None)


def receipt(context, receipt_id, *, active=False, as_of=None):
    row = maps(context)["cash"].get(receipt_id)
    if not row or row["category"] != "GRANT" or row["direction"] != "IN" or row["tranche"] not in (0, 1, 2):
        domain.fail("Select the retained payment for tranche 0, 1 or 2 that precedes this completion.", "COMPLETION_PAYMENT")
    if active and (row["state"] != "OBSERVED" or "testnet" in row.get("network", "").lower()
                   or row["date"] > (as_of or today())):
        domain.fail("Use a currently observed, received grant payment outside testnet.", "COMPLETION_PAYMENT", 409)
    return row


def seed(context, tranche):
    tranche = domain.integer(tranche, "Completion tranche", 1, 3)
    saved = selected_plan(context, tranche)
    if saved:
        return {"tranche": tranche, "savedId": saved["id"], "inputs": deepcopy(saved["inputs"]),
                "packages": package_rows(context, tranche), "rule": deepcopy(RULE)}
    anchor = context["program"].get("calendarStart") or context["plan"]["planning"].get("calendarStart")
    items = []
    for cost in native_costs(context, tranche):
        items.append({"costId": cost["id"], "ownerIds": [],
                      "startDate": plus_days(anchor, cost["start_day"]) if anchor else None,
                      "endDate": plus_days(anchor, cost["end_day"]) if anchor else None,
                      "state": "PLANNED", "completedOn": None, "workIds": [], "deploymentIds": [],
                      "sourceIds": [], "note": "", "completionNote": ""})
    return {"tranche": tranche, "savedId": None, "inputs": {"tranche": tranche, "items": items, "note": ""},
            "packages": package_rows(context, tranche), "rule": deepcopy(RULE)}


def package_rows(context, tranche):
    plan = context["plan"]
    anchor = context["program"].get("calendarStart") or plan["planning"].get("calendarStart")
    people = {row["id"]: row for row in plan["planning"].get("contributors", [])}
    return [{
        "costId": row["id"], "tranche": tranche, "remainingWork": row.get("remaining_work", ""),
        "successCriteria": row.get("measurable_proof", ""), "plannedHours": str(row.get("estimated_hours", "")),
        "plannedUsd": domain.usd(row["amount_usd"]), "awardStartDay": row["start_day"], "awardEndDay": row["end_day"],
        "awardStartDate": plus_days(anchor, row["start_day"]) if anchor else None,
        "awardEndDate": plus_days(anchor, row["end_day"]) if anchor else None,
        "planningAssignments": [{"name": people[item["contributorId"]]["name"], "hours": item["hours"]}
                                for item in plan["planning"].get("assignments", []) if item["costId"] == row["id"]],
    } for row in native_costs(context, tranche)]


def normalize_inputs(context, value):
    value = object_value(value, ("tranche", "items", "note"), "completion plan")
    tranche = domain.integer(value.get("tranche"), "Completion tranche", 1, 3)
    items = value.get("items")
    costs = {row["id"]: row for row in native_costs(context, tranche)}
    if not isinstance(items, list) or not 1 <= len(items) <= MAX_ITEMS or len(items) != len(costs):
        domain.fail("Keep one deliverable row for every original work package in this tranche.", "INVALID_COMPLETION")
    available = maps(context)
    prepared, seen = [], set()
    for raw in items:
        raw = object_value(raw, ITEM_KEYS, "completion deliverable")
        cost_id = raw.get("costId")
        if cost_id not in costs or cost_id in seen:
            domain.fail("Retain each original tranche work-package identity exactly once.", "INVALID_COMPLETION")
        seen.add(cost_id)
        start, end = day(raw.get("startDate"), "Assigned start", True), day(raw.get("endDate"), "Assigned finish", True)
        if start and end and end < start:
            domain.fail("Assigned finish must not precede its start.", "INVALID_COMPLETION")
        state = domain.enum(raw.get("state", "PLANNED"), ("PLANNED", "IN_PROGRESS", "COMPLETE"), "Deliverable state")
        completed = day(raw.get("completedOn"), "Actual deliverable completion", True)
        note = text(raw.get("completionNote", ""), "Actual deliverable result", 12000)
        if state == "COMPLETE" and (not completed or not note):
            domain.fail("A completed deliverable needs its actual completion date and result.", "INVALID_COMPLETION")
        if state != "COMPLETE" and completed:
            domain.fail("Use COMPLETE for an actual completed deliverable, or clear its completion date.", "INVALID_COMPLETION")
        owners = domain.reference_list(raw.get("ownerIds", []), available["contributors"], "Assigned contributors")
        work = domain.reference_list(raw.get("workIds", []), available["work"], "Retained completed work")
        for ident in work:
            original = available["work"][ident]
            if original["costId"] != cost_id:
                domain.fail("Linked work must use this original work package.", "COMPLETION_WORK")
            if original["contributorId"] not in owners:
                domain.fail("Include each linked work contributor among the assigned owners.", "COMPLETION_WORK")
        deployments = domain.reference_list(raw.get("deploymentIds", []), available["deployments"], "Deliverable deployments")
        for ident in deployments:
            original = available["deployments"][ident]
            if original.get("tranche") not in (None, tranche) or original["costIds"] and cost_id not in original["costIds"]:
                domain.fail("Linked deployments must retain this tranche and work-package selection.", "COMPLETION_DEPLOYMENT")
        prepared.append({"costId": cost_id, "ownerIds": owners, "startDate": start, "endDate": end,
                         "state": state, "completedOn": completed, "workIds": work, "deploymentIds": deployments,
                         "sourceIds": domain.reference_list(raw.get("sourceIds", []), context["sources"], "Deliverable sources"),
                         "note": text(raw.get("note", ""), "Assignment note", 12000), "completionNote": note})
    prepared.sort(key=lambda row: list(costs).index(row["costId"]))
    return {"tranche": tranche, "items": prepared, "note": text(value.get("note", ""), "Completion plan note", 12000)}


def install(db):
    db.execute("""CREATE TABLE IF NOT EXISTS ops_completion_plans(
        program_id TEXT NOT NULL REFERENCES ops_programs(id),tranche INTEGER NOT NULL,body_json TEXT NOT NULL,
        PRIMARY KEY(program_id,tranche))""")


def load_plans(ops, program_id):
    return [json.loads(row[0]) for row in ops.db.execute(
        "SELECT body_json FROM ops_completion_plans WHERE program_id=? ORDER BY tranche", (program_id,))]


def save_row(ops, program_id, row):
    ops.db.execute("INSERT INTO ops_completion_plans VALUES(?,?,?) ON CONFLICT(program_id,tranche) DO UPDATE SET body_json=excluded.body_json",
                   (program_id, row["tranche"], canonical(row)))


def plan_summary(row):
    return {key: deepcopy(row[key]) for key in ("id", "tranche", "version", "createdAt", "updatedAt", "recordedBy", "sha256")}


def seal(row):
    row = {key: deepcopy(value) for key, value in row.items() if key != "sha256"}
    return {**row, "sha256": digest(row)}


def normalize_extension(context, value, tranche, *, restoring=False):
    keys = ("id", "receiptId", "confirmedOn", "deadlineOn", "reference", "sourceIds", "note", "createdAt", "recordedBy")
    value = object_value(value, keys, "confirmed extension")
    original = receipt(context, value.get("receiptId"))
    if original["tranche"] + 1 != tranche:
        domain.fail("The confirmation must refer to this completion tranche's previous payment.", "COMPLETION_EXTENSION")
    confirmed, deadline = day(value.get("confirmedOn"), "Issuer confirmation date"), day(value.get("deadlineOn"), "Confirmed submission deadline")
    if confirmed < original["date"] or deadline <= plus_days(original["date"], RULE["calendarDays"]) or deadline < confirmed:
        domain.fail("Retain an issuer-confirmed later deadline for the original received payment.", "COMPLETION_EXTENSION")
    if not restoring and context["program"]["mode"] != "WALKTHROUGH" and confirmed > today():
        domain.fail("Record the actual received confirmation date.", "COMPLETION_EXTENSION")
    ident = value.get("id")
    if not isinstance(ident, str) or not re.fullmatch(r"extension-[a-f0-9]{32}", ident):
        domain.fail("Retain the original extension identity.", "COMPLETION_EXTENSION")
    return {"id": ident, "receiptId": original["id"], "confirmedOn": confirmed, "deadlineOn": deadline,
            "reference": text(value.get("reference"), "Original issuer confirmation reference", 4000, True),
            "sourceIds": domain.reference_list(value.get("sourceIds", []), context["sources"], "Confirmation sources"),
            "note": text(value.get("note", ""), "Issuer confirmation", 12000),
            "createdAt": domain.timestamp(value.get("createdAt"), "Confirmation record time"),
            "recordedBy": text(value.get("recordedBy"), "Recording operator", 300, True)}


def validate_plan(context, row, maximum_version):
    object_value(row, ("schema", "id", "tranche", "version", "createdAt", "updatedAt", "recordedBy", "inputs", "extensions", "sha256"), "retained completion plan")
    if row.get("schema") != SCHEMA or not re.fullmatch(r"completion-[a-f0-9]{32}", str(row.get("id", ""))):
        domain.fail("The retained completion plan identity is invalid.", "INVALID_COMPLETION")
    domain.integer(row.get("version"), "Completion save version", 2, maximum_version)
    domain.timestamp(row.get("createdAt"), "Completion plan creation")
    domain.timestamp(row.get("updatedAt"), "Completion plan update")
    text(row.get("recordedBy"), "Original plan operator", 300, True)
    normalized = normalize_inputs(context, row.get("inputs"))
    if normalized != row["inputs"] or normalized["tranche"] != row["tranche"]:
        domain.fail("The retained completion plan differs from its original selection.", "INVALID_COMPLETION")
    extensions = row.get("extensions")
    if not isinstance(extensions, list) or len(extensions) > MAX_EXTENSIONS:
        domain.fail("The retained confirmed-extension collection is invalid.", "INVALID_COMPLETION")
    seen = set()
    for extension in extensions:
        prepared = normalize_extension(context, extension, row["tranche"], restoring=True)
        if prepared != extension or prepared["id"] in seen:
            domain.fail("The retained issuer confirmation changed or repeats an identity.", "INVALID_COMPLETION")
        seen.add(prepared["id"])
    if seal(row)["sha256"] != row.get("sha256"):
        domain.fail("The complete saved plan differs from its retained digest.", "INVALID_COMPLETION")
    return row


def _clock(context, row, as_of):
    target = row["tranche"] + 1
    plan = selected_plan(context, target)
    base_deadline = plus_days(row["date"], RULE["calendarDays"])
    extensions = [] if not plan else [ext for ext in plan["extensions"] if ext["receiptId"] == row["id"] and ext["confirmedOn"] <= as_of]
    extensions.sort(key=lambda ext: (ext["confirmedOn"], ext["createdAt"], ext["id"]))
    extension = extensions[-1] if extensions else None
    deadline = extension["deadlineOn"] if extension else base_deadline
    submitted = [item for item in context["records"]["outcomes"] if item.get("completion", {}).get("receiptId") == row["id"]]
    submitted.sort(key=lambda item: (item["completion"]["submittedOn"], item["createdAt"], item["id"]))
    actual = [item for item in submitted if item["completion"]["submittedOn"] <= as_of]
    remaining = (date.fromisoformat(deadline) - date.fromisoformat(as_of)).days
    invalid = row["state"] != "OBSERVED"
    excluded = "testnet" in row.get("network", "").lower()
    future = row["date"] > as_of
    if invalid:
        status = "PAYMENT_VOID"
    elif excluded:
        status = "TESTNET"
    elif future:
        status = "PAYMENT_FUTURE"
    elif actual:
        status = "FORM_SUBMITTED"
    elif remaining < 0:
        status = "OVERDUE"
    elif remaining == 0:
        status = "DUE_TODAY"
    else:
        status = "OPEN"
    return {
        "receiptId": row["id"], "paymentTranche": row["tranche"], "tranche": target,
        "paidOn": row["date"], "originalDeadlineOn": base_deadline, "deadlineOn": deadline,
        "extension": deepcopy(extension), "status": status, "daysRemaining": remaining,
        "paymentReference": row["externalRef"], "paymentState": row["state"], "currency": row["currency"],
        "amount": row["amount"], "usdValue": row["usdValue"], "paymentSourceIds": row["sourceIds"],
        "active": not (invalid or excluded or future), "submissions": [
            {"id": item["id"], "state": item["state"], "submittedOn": item["completion"]["submittedOn"],
             "formReference": item["completion"]["formReference"], "reviewId": item["completion"]["reviewId"],
             "deadlineOn": item["completion"]["deadlineOn"],
             "submittedWithinDeadline": item["completion"]["submittedOn"] <= item["completion"]["deadlineOn"],
             "decisionOn": item["date"], "sourceIds": item["sourceIds"]} for item in actual],
    }


def dashboard(context, as_of=None):
    as_of = day(as_of or today(), "Completion calendar date")
    clocks, unassigned, final = [], [], []
    for row in context["records"]["cash"]:
        if row["category"] != "GRANT" or row["direction"] != "IN":
            continue
        observed = row["state"] == "OBSERVED" and "testnet" not in row.get("network", "").lower() and row["date"] <= as_of
        if row["tranche"] is None:
            if observed:
                unassigned.append(row["id"])
        elif row["tranche"] == 3:
            if observed:
                final.append(row["id"])
        else:
            clocks.append(_clock(context, row, as_of))
    clocks.sort(key=lambda row: (row["deadlineOn"], row["tranche"], row["paidOn"], row["receiptId"]))
    saved = {row["tranche"]: row for row in context.get("completionPlans", [])}
    milestone = {row["tranche"]: row for row in context["plan"]["scenario"]["milestones"]}
    anchor = context["program"].get("calendarStart") or context["plan"]["planning"].get("calendarStart")
    return {
        "schema": "stellar-forge.sf47-completion-calendar.v1", "asOfDate": as_of,
        "programId": context["program"]["id"], "version": context["program"]["version"], "rule": deepcopy(RULE),
        "calendarStart": anchor, "clocks": clocks, "unassignedGrantIds": unassigned, "finalPaymentIds": final,
        "tranches": [{"tranche": number, "awardSubmitDay": milestone[number]["submit_day"],
                      "awardSubmitDate": plus_days(anchor, milestone[number]["submit_day"]) if anchor else None,
                      "deliverable": milestone[number].get("deliverable", ""),
                      "successCriteria": milestone[number].get("measurable_proof", ""),
                      "packages": package_rows(context, number), "plan": deepcopy(saved.get(number)),
                      "itemsComplete": sum(item["state"] == "COMPLETE" for item in saved[number]["inputs"]["items"]) if number in saved else 0}
                     for number in (1, 2, 3)],
    }


def preview(context, data):
    data = object_value(data, ("receiptId", "asOfDate", "summary"), "completion preview")
    as_of = day(data.get("asOfDate") or today(), "Completion calendar date")
    original = receipt(context, data.get("receiptId"), active=True, as_of=as_of)
    clock = _clock(context, original, as_of)
    saved = selected_plan(context, clock["tranche"])
    summary_text = text(data.get("summary", ""), "Completion form summary", 20000)
    issues = []
    if context["program"]["mode"] != "WALKTHROUGH" and as_of > today():
        issues.append({"code": "FUTURE_PREPARATION", "costId": None, "message": "Prepare from actual received work and the current calendar date."})
    if not saved:
        issues.append({"code": "PLAN_REQUIRED", "costId": None, "message": "Save the original tranche deliverable assignments before preparation."})
    if not summary_text.strip():
        issues.append({"code": "SUMMARY_REQUIRED", "costId": None, "message": "Enter the completed tranche result for the form."})
    available = maps(context)
    if saved:
        for item in saved["inputs"]["items"]:
            reasons = []
            if not item["ownerIds"]:
                reasons.append("Assign the accountable contributor.")
            if item["state"] != "COMPLETE":
                reasons.append("Record the actual completed result.")
            if item["completedOn"] and item["completedOn"] > as_of:
                reasons.append("The recorded completion date follows this preparation date.")
            if any(available["work"][wid]["state"] == "VOID" for wid in item["workIds"]):
                reasons.append("Reconcile the linked work observation that was voided.")
            if any(available["work"][wid]["endDate"] > as_of for wid in item["workIds"]):
                reasons.append("A linked work observation ends after this preparation date.")
            for reason in reasons:
                issues.append({"code": "DELIVERABLE_REVIEW", "costId": item["costId"], "message": reason})
    business = {
        "program": {key: context["program"][key] for key in ("id", "name", "mode", "calendarStart")},
        "plan": context["plan"], "records": context["records"],
        "sources": sorted(context["sources"].values(), key=lambda row: row["id"]),
    }
    if context.get("completionPlans"):
        business["completionPlans"] = context["completionPlans"]
    source = {"programId": context["program"]["id"], "version": context["program"]["version"],
              "planContentSha256": context["plan"]["contentSha256"], "businessSha256": digest(business)}
    result = {"schema": PREVIEW_SCHEMA, "source": source, "rule": deepcopy(RULE), "asOfDate": as_of,
              "receipt": deepcopy(original), "clock": clock, "completionPlan": deepcopy(saved),
              "packages": package_rows(context, clock["tranche"]), "summary": summary_text,
              "ready": not issues, "issues": issues}
    result["previewSha256"] = digest(result)
    return result


def _outcome_link(context, value):
    value = object_value(value, ("receiptId", "reviewId", "reviewSha256", "previewSha256", "submittedOn",
                                 "formReference", "originalDeadlineOn", "deadlineOn", "extensionId"), "completion submission")
    original = receipt(context, value.get("receiptId"))
    if not re.fullmatch(r"review-[a-f0-9]{32}", str(value.get("reviewId", ""))):
        domain.fail("Retain the original prepared completion identity.", "COMPLETION_REVIEW")
    submitted = day(value.get("submittedOn"), "Actual form submission date")
    if submitted < original["date"]:
        domain.fail("The completion form date must follow its previous payment.", "COMPLETION_SUBMISSION")
    base = plus_days(original["date"], RULE["calendarDays"])
    deadline = day(value.get("deadlineOn"), "Recorded form deadline")
    if value.get("originalDeadlineOn") != base or deadline < base:
        domain.fail("The submission must retain its original payment-derived deadline.", "COMPLETION_SUBMISSION")
    extension_id = value.get("extensionId")
    if extension_id:
        plan = selected_plan(context, original["tranche"] + 1)
        extension = next((item for item in (plan["extensions"] if plan else []) if item["id"] == extension_id), None)
        if not extension or extension["receiptId"] != original["id"] or extension["confirmedOn"] > submitted or extension["deadlineOn"] != deadline:
            domain.fail("The form must retain its actual issuer-confirmed deadline source.", "COMPLETION_SUBMISSION")
    elif deadline != base:
        domain.fail("A later form deadline needs its retained issuer confirmation.", "COMPLETION_SUBMISSION")
    return {"receiptId": original["id"], "reviewId": value["reviewId"],
            "reviewSha256": domain.sha(value.get("reviewSha256"), "Frozen completion source", False),
            "previewSha256": domain.sha(value.get("previewSha256"), "Prepared completion identity", False),
            "submittedOn": submitted, "formReference": text(value.get("formReference"), "Original form submission reference", 4000, True),
            "originalDeadlineOn": base, "deadlineOn": deadline, "extensionId": extension_id}


def normalize_outcome_link(context, data, previous):
    supplied = data.get("completion")
    prior = previous.get("completion")
    if supplied is None:
        supplied = prior
    if supplied is None:
        return {}
    value = _outcome_link(context, supplied)
    if not context.get("restoring") and not context.get("completionSubmission") and value != prior:
        domain.fail("Use the original completion submission command to retain the prepared form.", "COMPLETION_SUBMISSION")
    if value != supplied or data.get("tranche") != receipt(context, value["receiptId"])["tranche"] + 1:
        domain.fail("The form submission must preserve its exact payment and target tranche.", "COMPLETION_SUBMISSION")
    return {"completion": value}


def command(ops, context, name, data, actor, next_version):
    program_id = context["program"]["id"]
    if name == "completion.save":
        object_value(data, ("inputs",), "completion plan save")
        inputs = normalize_inputs(context, data.get("inputs"))
        if context["program"]["mode"] != "WALKTHROUGH" and any(item["completedOn"] and item["completedOn"] > today() for item in inputs["items"]):
            domain.fail("Record actual completed work with its observed date.", "INVALID_COMPLETION")
        before = selected_plan(context, inputs["tranche"])
        if before and before["inputs"] == inputs:
            return {"before": before, "after": before, "kind": "completion", "recordId": before["id"], "unchanged": True}
        after = seal({"schema": SCHEMA, "id": before["id"] if before else "completion-" + uuid.uuid4().hex,
                      "tranche": inputs["tranche"], "version": next_version,
                      "createdAt": before["createdAt"] if before else now(), "updatedAt": now(), "recordedBy": actor,
                      "inputs": inputs, "extensions": deepcopy(before["extensions"]) if before else []})
        save_row(ops, program_id, after)
        return {"before": before, "after": after, "kind": "completion", "recordId": after["id"], "unchanged": False}

    if name == "completion.extension":
        object_value(data, ("receiptId", "confirmedOn", "deadlineOn", "reference", "sourceIds", "note"), "issuer confirmation")
        original = receipt(context, data.get("receiptId"), active=True, as_of=(data.get("confirmedOn") if context["program"]["mode"] == "WALKTHROUGH" else None))
        before = selected_plan(context, original["tranche"] + 1)
        if not before:
            domain.fail("Save this tranche's deliverable plan before recording its confirmation.", "COMPLETION_PLAN")
        if len(before["extensions"]) >= MAX_EXTENSIONS:
            domain.fail("This completion plan has reached its confirmation bound.", status=413)
        extension = normalize_extension(context, {**data, "id": "extension-" + uuid.uuid4().hex,
                                                  "createdAt": now(), "recordedBy": actor}, before["tranche"])
        identity = (extension["receiptId"], extension["reference"])
        if any((item["receiptId"], item["reference"]) == identity for item in before["extensions"]):
            domain.fail("That original issuer confirmation is already retained; reopen it or replay the original request.", "COMPLETION_EXTENSION_DUPLICATE", 409)
        after = seal({**before, "version": next_version, "updatedAt": now(), "recordedBy": actor,
                      "extensions": [*before["extensions"], extension]})
        save_row(ops, program_id, after)
        return {"before": before, "after": after, "kind": "completion", "recordId": after["id"], "unchanged": False,
                "extensionId": extension["id"]}

    if name == "completion.prepare":
        object_value(data, ("receiptId", "asOfDate", "summary", "expectedPreviewSha256"), "completion preparation")
        candidate = preview(context, {key: data[key] for key in ("receiptId", "asOfDate", "summary") if key in data})
        if candidate["previewSha256"] != domain.sha(data.get("expectedPreviewSha256"), "Reviewed completion preview", False):
            domain.fail("The completion source changed after preview. Reopen and preview the current case.", "COMPLETION_PREVIEW_CONFLICT", 409)
        if not candidate["ready"]:
            domain.fail("Finish the listed deliverable and form fields before preparing this completion.", "COMPLETION_NOT_READY", 409)
        snapshot = ops._business(context)
        after = {"id": "review-" + uuid.uuid4().hex, "version": next_version, "createdAt": now(),
                 "actor": actor, "note": "Prepared tranche " + str(candidate["clock"]["tranche"]) + " completion.",
                 "businessSha256": digest(snapshot), "snapshot": snapshot, "report": domain.report(**context),
                 "purpose": "TRANCHE_COMPLETION", "completion": candidate}
        ops.db.execute("INSERT INTO ops_reviews VALUES(?,?,?)", (program_id, after["id"], canonical(after)))
        return {"before": None, "after": {key: after[key] for key in ("id", "version", "businessSha256", "purpose")},
                "kind": "review", "recordId": after["id"], "unchanged": False,
                "businessSha256": after["businessSha256"], "previewSha256": candidate["previewSha256"]}

    if name == "completion.submit":
        object_value(data, ("reviewId", "expectedReviewSha256", "submittedOn", "formReference", "sourceIds", "sourceNote"), "actual completion form receipt")
        row = ops.db.execute("SELECT body_json FROM ops_reviews WHERE program_id=? AND id=?", (program_id, data.get("reviewId"))).fetchone()
        review = json.loads(row[0]) if row else None
        if not review or review.get("purpose") != "TRANCHE_COMPLETION" or not review.get("completion", {}).get("ready"):
            domain.fail("Select the original prepared tranche completion.", "COMPLETION_REVIEW", 404)
        if review["businessSha256"] != domain.sha(data.get("expectedReviewSha256"), "Prepared completion source", False):
            domain.fail("The selected original preparation differs.", "COMPLETION_REVIEW_CONFLICT", 409)
        candidate = review["completion"]
        submitted = day(data.get("submittedOn"), "Actual completion form date")
        if (context["program"]["mode"] != "WALKTHROUGH" and submitted > today()) or submitted < candidate["asOfDate"]:
            domain.fail("Retain the actual form date on or after its preparation.", "COMPLETION_SUBMISSION")
        submission_clock = _clock(context, candidate["receipt"], submitted)
        link = _outcome_link(context, {
            "receiptId": candidate["receipt"]["id"], "reviewId": review["id"], "reviewSha256": review["businessSha256"],
            "previewSha256": candidate["previewSha256"], "submittedOn": submitted,
            "formReference": data.get("formReference"), "originalDeadlineOn": candidate["clock"]["originalDeadlineOn"],
            "deadlineOn": submission_clock["deadlineOn"],
            "extensionId": submission_clock["extension"]["id"] if submission_clock["extension"] else None,
        })
        if any(item.get("completion", {}).get("formReference") == link["formReference"]
               for item in context["records"]["outcomes"]):
            domain.fail("This original form receipt is already retained. Reopen its outcome or replay the same request.", "COMPLETION_SUBMISSION_DUPLICATE", 409)
        deployment_ids = sorted({ident for item in candidate["completionPlan"]["inputs"]["items"] for ident in item["deploymentIds"]})
        values = domain.prepare("outcomes", {
            "tranche": candidate["clock"]["tranche"], "state": "SUBMITTED",
            "description": candidate["summary"], "date": submitted, "deploymentIds": deployment_ids,
            "sourceIds": data.get("sourceIds", []), "sourceNote": data.get("sourceNote", ""),
            "completion": link,
        }, {**context, "completionSubmission": True})
        after = {**values, "id": "outcome-" + uuid.uuid4().hex, "version": next_version,
                 "createdAt": now(), "updatedAt": now(), "recordedBy": actor}
        ops._save(program_id, "outcomes", after)
        return {"before": None, "after": after, "kind": "outcomes", "recordId": after["id"], "unchanged": False,
                "preparedSourceCurrent": review["businessSha256"] == digest(ops._business(context)),
                "submittedWithinDeadline": submitted <= link["deadlineOn"]}

    if name == "completion.decision":
        object_value(data, ("outcomeId", "state", "date", "sourceIds", "sourceNote"), "issuer completion decision")
        before = maps(context)["outcomes"].get(data.get("outcomeId"))
        if not before or not before.get("completion"):
            domain.fail("Select the retained original form submission.", "COMPLETION_SUBMISSION", 404)
        state = domain.enum(data.get("state"), ("ACCEPTED", "CHANGES_REQUESTED", "WITHDRAWN"), "Issuer outcome")
        stamp = day(data.get("date"), "Original decision date")
        if stamp < before["completion"]["submittedOn"] or (context["program"]["mode"] != "WALKTHROUGH" and stamp > today()):
            domain.fail("Record the actual decision date after the form was submitted.", "COMPLETION_SUBMISSION")
        source_ids = domain.reference_list(data.get("sourceIds", []), context["sources"], "Issuer decision sources")
        source_note = text(data.get("sourceNote"), "Original decision reference", 12000, True)
        values = domain.prepare("outcomes", {**before, "state": state, "date": stamp,
                                            "sourceIds": sorted(set(before["sourceIds"] + source_ids)),
                                            "sourceNote": before["sourceNote"] + "\n" + source_note}, context, before)
        after = {**before, **values, "version": next_version, "updatedAt": now(), "recordedBy": actor}
        ops._save(program_id, "outcomes", after)
        return {"before": before, "after": after, "kind": "outcomes", "recordId": after["id"], "unchanged": False}

    domain.fail("Unknown completion lifecycle command.", "INVALID_COMPLETION")


def validate_preparation(review):
    if review.get("purpose") != "TRANCHE_COMPLETION":
        return
    candidate, snapshot = review.get("completion"), review.get("snapshot")
    if not isinstance(candidate, dict) or not isinstance(snapshot, dict) or not candidate.get("ready"):
        domain.fail("The retained prepared completion is incomplete.", "INVALID_COMPLETION")
    context = {**snapshot, "program": {**snapshot["program"], "version": candidate["source"]["version"]},
               "sources": {row["id"]: row for row in snapshot["sources"]}}
    recalculated = preview(context, {"receiptId": candidate["receipt"]["id"], "asOfDate": candidate["asOfDate"], "summary": candidate["summary"]})
    if recalculated != candidate or candidate["source"]["businessSha256"] != review["businessSha256"]:
        domain.fail("The original prepared completion differs from its complete frozen source.", "INVALID_COMPLETION")


def validate_import(context, plans, reviews, events, maximum_version):
    if not isinstance(plans, list) or len(plans) > 3:
        domain.fail("Retain at most the three original completion plans.", "INVALID_COMPLETION")
    seen = set()
    for row in plans:
        validate_plan(context, row, maximum_version)
        if row["tranche"] in seen:
            domain.fail("The case repeats a completion plan.", "INVALID_COMPLETION")
        seen.add(row["tranche"])
        event = events[row["version"] - 1]
        if event.get("action") not in ("completion.save", "completion.extension") or event.get("after") != row:
            domain.fail("The retained completion plan differs from its original save event.", "INVALID_COMPLETION")
    original_reviews = {row["id"]: row for row in reviews}
    for review in reviews:
        if review.get("purpose") != "TRANCHE_COMPLETION":
            continue
        validate_preparation(review)
        event = events[review["version"] - 1]
        if event.get("action") != "completion.prepare" or event.get("recordId") != review["id"]:
            domain.fail("The prepared form lacks its original preparation event.", "INVALID_COMPLETION")
    for outcome in context["records"]["outcomes"]:
        link = outcome.get("completion")
        if not link:
            continue
        review = original_reviews.get(link["reviewId"])
        if not review or review.get("purpose") != "TRANCHE_COMPLETION":
            domain.fail("The form receipt is missing its original preparation.", "INVALID_COMPLETION")
        candidate = review["completion"]
        if (link["reviewSha256"] != review["businessSha256"] or link["previewSha256"] != candidate["previewSha256"]
                or link["receiptId"] != candidate["receipt"]["id"]
                or link["originalDeadlineOn"] != candidate["clock"]["originalDeadlineOn"]):
            domain.fail("The actual form receipt differs from its prepared source.", "INVALID_COMPLETION")


def review_files(review, read_source):
    validate_preparation(review)
    if review.get("purpose") != "TRANCHE_COMPLETION":
        domain.fail("Select a prepared tranche completion.", "COMPLETION_REVIEW", 404)
    candidate = review["completion"]
    plan = candidate["completionPlan"]
    context = review["snapshot"]
    names = {row["id"]: row["name"] for row in context["records"]["contributors"]}
    packages = {row["costId"]: row for row in candidate["packages"]}
    source_ids = set(candidate["receipt"]["sourceIds"])
    if candidate["clock"]["extension"]:
        source_ids.update(candidate["clock"]["extension"]["sourceIds"])
    for item in plan["inputs"]["items"]:
        source_ids.update(item["sourceIds"])
        for ident in item["workIds"]:
            source_ids.update(next(row for row in context["records"]["work"] if row["id"] == ident)["sourceIds"])
        for ident in item["deploymentIds"]:
            source_ids.update(next(row for row in context["records"]["deployments"] if row["id"] == ident)["sourceIds"])
    e = lambda value: html.escape(str(value if value is not None else ""), quote=True)
    rows = []
    export_rows = []
    for item in plan["inputs"]["items"]:
        original = packages[item["costId"]]
        owners = ", ".join(names[ident] for ident in item["ownerIds"])
        rows.append("<tr><td>" + e(item["costId"]) + "</td><td>" + e(original["remainingWork"]) +
                    "</td><td>" + e(original["successCriteria"]) + "</td><td>" + e(owners) + "</td><td>" +
                    e(item["completedOn"]) + "</td><td>" + e(item["completionNote"]) + "</td></tr>")
        export_rows.append({**item, "owners": owners, "remainingWork": original["remainingWork"],
                            "successCriteria": original["successCriteria"]})
    page = ('<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width">'
            '<title>Tranche completion</title><style>body{font:16px system-ui;max-width:1100px;margin:2rem auto;padding:0 1rem;color:#202020}'
            'table{border-collapse:collapse;width:100%}th,td{border:1px solid #ccc;text-align:left;vertical-align:top;padding:.6rem}'
            'p,td{white-space:pre-wrap}small{color:#555}</style><h1>Tranche ' + str(candidate["clock"]["tranche"]) +
            ' completion</h1><p>' + e(context["program"]["name"]) + ' · ' + e(context["program"]["mode"]) +
            '</p><p>Previous payment: ' + e(candidate["receipt"]["date"]) + ' · ' + e(candidate["receipt"]["externalRef"]) +
            '\nOriginal 90-calendar-day deadline: ' + e(candidate["clock"]["originalDeadlineOn"]) +
            '\nApplicable confirmed deadline: ' + e(candidate["clock"]["deadlineOn"]) +
            '</p><h2>Completed result</h2><p>' + e(candidate["summary"]) +
            '</p><table><thead><tr><th>Package</th><th>Original work</th><th>Success criteria</th><th>Owners</th><th>Completed</th><th>Result</th>'
            '</tr></thead><tbody>' + ''.join(rows) + '</tbody></table><p><a href="' + e(RULE["sourceUrl"]) +
            '">SCF tranche guidelines</a></p><small>Prepared ' + e(review["createdAt"]) + ' · ' + e(review["id"]) +
            ' · original source ' + e(review["businessSha256"]) + '</small></html>')
    files = {"completion.json": (canonical(review) + "\n").encode(),
             "completion.html": page.encode(),
             "deliverables.csv": csv_bytes(["costId", "remainingWork", "successCriteria", "owners", "startDate", "endDate",
                                           "state", "completedOn", "completionNote"], export_rows)}
    retained = {row["id"]: row for row in context["sources"]}
    for ident in sorted(source_ids):
        metadata, raw = read_source(ident)
        if metadata["sha256"] != retained[ident]["sha256"] or len(raw) != retained[ident]["bytes"]:
            domain.fail("An original completion source changed.", "COMPLETION_SOURCE_CONFLICT", 409)
        files["sources/" + ident] = raw
    if sum(map(len, files.values())) > MAX_BUNDLE:
        domain.fail("The complete prepared form exceeds the original archive bound.", status=413)
    manifest = {"schema": "stellar-forge.sf47-completion-files.v1", "reviewId": review["id"],
                "files": [{"path": name, "bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest()} for name, raw in sorted(files.items())]}
    files["MANIFEST.json"] = (canonical(manifest) + "\n").encode()
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
        for name, raw in sorted(files.items()):
            info = zipfile.ZipInfo(name, (2026, 1, 1, 0, 0, 0))
            info.external_attr = 0o600 << 16
            info.compress_type = zipfile.ZIP_DEFLATED
            archive.writestr(info, raw)
    return output.getvalue()
