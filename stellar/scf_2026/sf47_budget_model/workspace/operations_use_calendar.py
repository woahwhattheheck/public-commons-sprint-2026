"""Saved customer-use schedules in the original SF47 Installation and case.

A dated use and a settlement are separate identities. This module never executes
a buyer or turns a planned use into an observed purchase. Actual qualification
continues through the original operations_cohort input and review.
"""
from __future__ import annotations

from collections import Counter, defaultdict
from copy import deepcopy
from datetime import date, datetime, timedelta, timezone
from html import escape
import csv
import io
import json
import re

from model import canonical, digest, now, text
import operations_domain as domain
import operations_cohort as cohort

SCHEMA = "stellar-forge.sf47-customer-use-calendar.v1"
MAX_TASKS = 80
MAX_SETTLEMENTS = 500
MAX_USES = 500
MAX_SELECTIONS = 100
MODES = ("PURCHASE", "ALLOWANCE_USE", "REOPEN", "FREE_USE")
STATES = ("PLANNED", "CANCELLED")


def fail(message, code="INVALID_CUSTOMER_USE_CALENDAR", status=422):
    domain.fail(message, code, status)


def obj(value, fields, label):
    if not isinstance(value, dict) or set(value) - set(fields):
        fail("Use the declared " + label + " fields.")
    return value


def rows(value, maximum, label):
    if not isinstance(value, list) or len(value) > maximum or any(not isinstance(row, dict) for row in value):
        fail("Use at most " + str(maximum) + " complete " + label + " rows.",
             status=413 if isinstance(value, list) and len(value) > maximum else 422)
    return value


def key(value, label):
    value = text(value, label, 120, True)
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._:-]{0,119}", value):
        fail(label + " needs an explicit stable identifier.")
    return value


def unique(values, label):
    if len({row["id"] for row in values}) != len(values):
        fail("Each " + label + " identity must occur once.")
    return values


def day(value, label):
    return domain.calendar(value, label)


def optional_pattern(value):
    return None if value in (None, "") else key(value, "Expansion pattern identity")


def normalize(context, raw, installation):
    raw = obj(deepcopy(raw), ("schema", "name", "tranche", "startDate", "endDate",
        "sourceIds", "note", "tasks", "settlements", "entries"), "customer-use calendar")
    if raw.get("schema", SCHEMA) != SCHEMA:
        fail("Select the native customer-use calendar schema.")
    start, end = day(raw.get("startDate"), "First use date"), day(raw.get("endDate"), "Last use date")
    first, last = date.fromisoformat(start), date.fromisoformat(end)
    if last < first or (last - first).days >= 366 or last == date.max:
        fail("Select an inclusive customer-use window of 1 to 366 calendar days.")
    tranche = domain.integer(raw.get("tranche"), "Proposed cohort tranche", 2, 3, True)
    if tranche is not None:
        cohort.rule(context, tranche)
    sources = context["sources"]
    refs = lambda value, label: domain.reference_list(value if value is not None else [], sources, label, 200)
    buyers = set(installation["buyerDeploymentIds"])
    purchases = {row["id"]: row for row in context["records"]["purchases"]}
    task_rows = []
    for row in rows(raw.get("tasks", []), MAX_TASKS, "useful task"):
        obj(row, ("id", "name", "purpose", "request", "completeOutput", "repeatTrigger",
                  "pricedUnit", "sourceIds"), "useful task")
        task_rows.append({"id": key(row.get("id"), "Useful task ID"),
            "name": text(row.get("name"), "Useful task name", 500, True),
            **{field: text(row.get(field, ""), label, 4000)
               for field, label in (("purpose", "Customer purpose"), ("request", "Complete request"),
                    ("completeOutput", "Whole useful output"), ("repeatTrigger", "Reason to repeat"),
                    ("pricedUnit", "Original merchant priced unit"))},
            "sourceIds": refs(row.get("sourceIds"), "Task source")})
    unique(task_rows, "task")
    tasks = {row["id"]: row for row in task_rows}
    settlement_rows, bound_purchases = [], set()
    for row in rows(raw.get("settlements", []), MAX_SETTLEMENTS, "planned settlement"):
        obj(row, ("id", "buyerDeploymentId", "taskId", "date", "kind", "purchaseIds",
                  "sourceIds", "note", "patternId"), "planned settlement")
        buyer_id, task_id = row.get("buyerDeploymentId"), row.get("taskId")
        if buyer_id not in buyers or task_id not in tasks:
            fail("Bind each planned settlement to a selected Installation buyer and useful task.")
        when = day(row.get("date"), "Planned settlement date")
        if when > end or (first - date.fromisoformat(when)).days > 366:
            fail("A funding date must be no later than the last use and at most 366 days before the use window.")
        purchase_ids = domain.reference_list(row.get("purchaseIds", []), purchases, "Original buyer receipts", 200)
        if bound_purchases.intersection(purchase_ids):
            fail("Associate an original purchase with one settlement group; reuse that funding group for allowance uses.",
                 "CUSTOMER_USE_PURCHASE_COLLISION")
        bound_purchases.update(purchase_ids)
        allowed_deployments = {buyer_id, installation.get("merchantDeploymentId")}
        if any(purchases[ident]["deploymentId"] not in allowed_deployments for ident in purchase_ids):
            fail("A receipt must belong to this settlement's selected buyer or the Installation's original merchant.")
        settlement_rows.append({"id": key(row.get("id"), "Planned settlement ID"),
            "buyerDeploymentId": buyer_id, "taskId": task_id, "date": when,
            "kind": domain.enum(row.get("kind", "DIRECT"), ("DIRECT", "PREPAID"), "Planned settlement kind"),
            "purchaseIds": purchase_ids, "sourceIds": refs(row.get("sourceIds"), "Settlement basis"),
            "note": text(row.get("note", ""), "Settlement and receipt association", 4000),
            "patternId": optional_pattern(row.get("patternId"))})
    unique(settlement_rows, "planned settlement")
    settlements = {row["id"]: row for row in settlement_rows}
    use_rows = []
    for row in rows(raw.get("entries", []), MAX_USES, "dated use"):
        obj(row, ("id", "buyerDeploymentId", "taskId", "date", "state", "mode",
                  "fundingIds", "sourcePeriod", "sourceIds", "note", "patternId"), "dated customer use")
        buyer_id, task_id = row.get("buyerDeploymentId"), row.get("taskId")
        if buyer_id not in buyers or task_id not in tasks:
            fail("Bind each dated use to a selected Installation buyer and useful task.")
        when = day(row.get("date"), "Useful-result date")
        if not start <= when <= end:
            fail("Every dated use must fall in its saved calendar window.")
        mode = domain.enum(row.get("mode", "PURCHASE"), MODES, "Customer-use mode")
        funding = domain.reference_list(row.get("fundingIds", []), settlements, "Selected funding groups", 100)
        if mode in ("PURCHASE", "ALLOWANCE_USE") and not funding:
            fail("Select the original planned settlement or prepaid funding group for this use.")
        if mode in ("REOPEN", "FREE_USE") and funding:
            fail("Reopen and free-use entries carry no new settlement; retain any original source in their source links.")
        if any(settlements[ident]["buyerDeploymentId"] != buyer_id or settlements[ident]["date"] > when for ident in funding):
            fail("Funding must belong to the same buyer and be dated no later than the use.")
        expected_kind = "PREPAID" if mode == "ALLOWANCE_USE" else "DIRECT"
        if mode == "PURCHASE" and any(settlements[ident]["taskId"] != task_id for ident in funding):
            fail("A direct settlement and its complete useful request must select the same task. Prepaid funding may support other selected tasks.")
        if any(settlements[ident]["kind"] != expected_kind for ident in funding):
            fail("Allowance uses select prepaid groups; purchase uses select direct settlement groups.")
        use_rows.append({"id": key(row.get("id"), "Dated use ID"), "buyerDeploymentId": buyer_id,
            "taskId": task_id, "date": when, "state": domain.enum(row.get("state", "PLANNED"), STATES, "Use state"),
            "mode": mode, "fundingIds": funding,
            "sourcePeriod": text(row.get("sourcePeriod", ""), "Selected source period or edition", 2000),
            "sourceIds": refs(row.get("sourceIds"), "Dated-use source"),
            "note": text(row.get("note", ""), "Use and completion note", 4000),
            "patternId": optional_pattern(row.get("patternId"))})
    unique(use_rows, "dated use")
    return {"schema": SCHEMA, "name": text(raw.get("name"), "Customer-use calendar name", 500, True),
        "tranche": tranche, "startDate": start, "endDate": end,
        "sourceIds": refs(raw.get("sourceIds"), "Customer-use source"),
        "note": text(raw.get("note", ""), "Ordinary business-use basis", 8000),
        "tasks": task_rows, "settlements": settlement_rows, "entries": use_rows}


def references(document):
    value = document.get("useCalendar")
    if not value:
        return {"sourceIds": [], "purchaseIds": []}
    sources = set(value["sourceIds"])
    purchases = set()
    for group in ("tasks", "settlements", "entries"):
        for row in value[group]:
            sources.update(row["sourceIds"])
            purchases.update(row.get("purchaseIds", []))
    return {"sourceIds": sorted(sources), "purchaseIds": sorted(purchases)}


def receipt_view(row):
    # Exact source-native strings and state fields; no inferred payment status.
    fields = ("id", "deploymentId", "network", "asset", "transactionHash", "ledger",
        "amountStroops", "feesStroops", "intentId", "operationId", "requestId",
        "reservationId", "merchantEventId", "recipient", "acceptedTermsSha256",
        "attemptStatus", "settlementStatus", "outputStatus", "orderStatus", "state",
        "origin", "observedAt", "firstAttemptAt", "settledAt", "outputCompletedAt",
        "deliveredBytes", "deliveredSha256", "sourceIds", "sourceNote", "sourceBasis")
    return {field: deepcopy(row[field]) for field in fields if field in row}


def counts(context, calendars):
    active, settlements = [], []
    for selected in calendars:
        owner, document = selected[:2]
        source_context = selected[2] if len(selected) > 2 else context
        deployments = {row["id"]: row for row in source_context["records"]["deployments"]}
        value = document["useCalendar"]
        uses = [row for row in value["entries"] if row["state"] != "CANCELLED"]
        uses_by_funding = defaultdict(list)
        for row in uses:
            for ident in row["fundingIds"]:
                uses_by_funding[ident].append(row)
        active.extend((owner, row) for row in uses)
        for row in value["settlements"]:
            funding_uses = uses_by_funding[row["id"]]
            if funding_uses and value["startDate"] <= row["date"] <= value["endDate"]:
                # One funded intent projects at its first whole useful result.
                # Later allowance calls do not add another purchase or repeat.
                settlements.append((owner, row, min(item["date"] for item in funding_uses),
                                    deployments.get(row["buyerDeploymentId"], {})))
    buyer_days = defaultdict(set)
    buyer_groups = defaultdict(set)
    for owner, row, completion_date, buyer in settlements:
        operator = buyer.get("operatorId")
        if operator:
            buyer_days[operator].add(completion_date)
            buyer_groups[operator].add((owner, row["id"]))
    return {"datedUses": len(active),
        "purchaseUses": sum(row["mode"] == "PURCHASE" for _, row in active),
        "allowanceUses": sum(row["mode"] == "ALLOWANCE_USE" for _, row in active),
        "reopens": sum(row["mode"] == "REOPEN" for _, row in active),
        "freeUses": sum(row["mode"] == "FREE_USE" for _, row in active),
        "plannedSettlementGroups": len(settlements),
        "directSettlementGroups": sum(row["kind"] == "DIRECT" for _, row, _, _ in settlements),
        "prepaidSettlementGroups": sum(row["kind"] == "PREPAID" for _, row, _, _ in settlements),
        "namedBuyerOperators": len(buyer_days),
        "repeatNamedBuyerOperators": sum(len(buyer_days[key]) >= 2 and len(buyer_groups[key]) >= 2 for key in buyer_days),
        "activeDates": len({row["date"] for _, row in active}),
        "basis": "Distinct planned funding groups dated in the entered window. Repeat compares each group's first whole useful-result date, keeping one prepaid group once. Uses, allowance calls and reopened outputs do not add settlements. Operator qualification, native first-attempt windows and actual purchase completion require the original Cohort review."}


def target_view(context, tranche, start, end, planned):
    if tranche is None:
        return {"rule": None, "targets": [], "window": None}
    selected = cohort.rule(context, tranche)
    days = (date.fromisoformat(end) - date.fromisoformat(start)).days + 1
    original_days = selected["target"]["proposed_window"]["consecutive_calendar_days"]
    potential = {"external_buyer_operators": planned["namedBuyerOperators"],
        "completed_testnet_purchases": planned["plannedSettlementGroups"] if tranche == 2 else 0,
        "completed_mainnet_purchases": planned["plannedSettlementGroups"] if tranche == 3 else 0,
        "repeat_external_buyer_operators": planned["repeatNamedBuyerOperators"]}
    return {"rule": selected,
        "window": {"startDate": start, "endDate": end, "calendarDays": days,
                   "requiredCalendarDays": original_days, "matches": days == original_days},
        "targets": [{"key": name, "expected": expected, "plannedPotential": potential.get(name),
            "countSufficient": None if name not in potential else potential[name] >= expected,
            "qualification": "UNREVIEWED_PLAN", "actual": None}
            for name, expected in selected["target"]["target_counts"].items()]}


def report(context, document):
    value = document.get("useCalendar")
    if not value:
        return None
    tasks = {row["id"]: row for row in value["tasks"]}
    purchases = {row["id"]: row for row in context["records"]["purchases"]}
    deployments = {row["id"]: row for row in context["records"]["deployments"]}
    uses_by_funding = defaultdict(list)
    for row in value["entries"]:
        for ident in row["fundingIds"]:
            uses_by_funding[ident].append(row)
    findings = []
    for row in value["tasks"]:
        for field in ("purpose", "request", "completeOutput", "repeatTrigger", "pricedUnit"):
            if not row[field].strip():
                findings.append({"code": "TASK_DECISION", "id": row["id"], "field": field,
                                 "message": "Retain this task's " + field + " before selecting it as ordinary useful work."})
    for buyer_id in document["buyerDeploymentIds"]:
        buyer = deployments[buyer_id]
        if not buyer.get("operatorId"):
            findings.append({"code": "BUYER_IDENTITY", "id": buyer_id, "message": "Select the accountable original buyer operator identity."})
        if buyer.get("participantClass") not in cohort.EXTERNAL:
            findings.append({"code": "BUYER_PARTICIPATION", "id": buyer_id,
                             "message": "The selected buyer is not recorded as an independent operator or customer."})
    settlement_views = []
    all_receipts = {}
    for row in value["settlements"]:
        original = [receipt_view(purchases[ident]) for ident in row["purchaseIds"]]
        all_receipts.update((item["id"], item) for item in original)
        groups = {item.get("intentId") or item["id"] for item in original}
        if len(groups) > 1:
            findings.append({"code": "MULTIPLE_ORIGINAL_INTENTS", "id": row["id"],
                "message": "This planned funding group links multiple original intent identities. Review the actual purchase grouping in Cohort."})
        active_uses = [item["id"] for item in uses_by_funding[row["id"]] if item["state"] != "CANCELLED"]
        if not active_uses:
            findings.append({"code": "UNUSED_FUNDING", "id": row["id"],
                "message": "This planned funding group has no active dated use; it is excluded from projected counts."})
        settlement_views.append({**deepcopy(row), "task": deepcopy(tasks[row["taskId"]]),
            "firstUsefulResultDate": min((item["date"] for item in uses_by_funding[row["id"]] if item["state"] != "CANCELLED"), default=None),
            "uses": active_uses, "receipts": original, "receiptCount": len(original),
            "receiptIdentityCount": len(groups), "actualQualification": "USE_ORIGINAL_COHORT_REVIEW"})
    planned = counts(context, [("installation", document)])
    comparison = target_view(context, value["tranche"], value["startDate"], value["endDate"], planned)
    if comparison["window"] and not comparison["window"]["matches"]:
        findings.append({"code": "WINDOW_LENGTH", "id": None,
            "message": "The entered dates do not span the original proposed consecutive-calendar-day window."})
    return {"schema": SCHEMA + ".report", "name": value["name"], "planned": planned,
        **comparison, "findings": findings, "settlements": settlement_views,
        "entries": [{**deepcopy(row), "task": deepcopy(tasks[row["taskId"]]),
            "buyer": deepcopy(deployments[row["buyerDeploymentId"]])} for row in value["entries"]],
        "receiptInventory": sorted(all_receipts.values(), key=lambda item: item["id"]),
        "receiptStates": dict(sorted(Counter(
            item.get("settlementStatus", "UNKNOWN") + "/" + item.get("outputStatus", "UNKNOWN") + "/" + item.get("state", "UNKNOWN")
            for item in all_receipts.values()).items())),
        "sourceIds": references(document)["sourceIds"],
        "actualPurchaseCount": None,
        "actualPurchaseBasis": "Original native receipts are retained individually. A saved Cohort review establishes qualified purchases and distinct settlement identities."}


def expand(context, document, pattern):
    """Return an editable Installation document; the original save owns mutation."""
    pattern = obj(deepcopy(pattern), ("id", "taskIds", "buyerDeploymentIds", "weekdays",
        "includeDates", "excludeDates", "mode", "fundingByBuyer", "replacePattern"), "business-use expansion")
    value = normalize(context, document.get("useCalendar"), document)
    pattern_id = key(pattern.get("id"), "Expansion pattern ID")
    task_map = {row["id"]: row for row in value["tasks"]}
    task_ids = domain.reference_list(pattern.get("taskIds", []), task_map, "Selected useful tasks", MAX_TASKS)
    buyer_map = {ident: True for ident in document["buyerDeploymentIds"]}
    buyer_ids = domain.reference_list(pattern.get("buyerDeploymentIds", []), buyer_map, "Selected calendar buyers", 20)
    if not task_ids or not buyer_ids:
        fail("Select at least one complete useful task and one original buyer before expanding dates.")
    weekdays = pattern.get("weekdays", [0, 1, 2, 3, 4])
    if not isinstance(weekdays, list) or len(weekdays) > 7:
        fail("Select distinct weekdays from Monday=0 through Sunday=6.")
    weekdays = [domain.integer(day_number, "Working weekday", 0, 6) for day_number in weekdays]
    if len(set(weekdays)) != len(weekdays):
        fail("Select each working weekday once.")
    def selected_dates(field):
        values = pattern.get(field, [])
        if not isinstance(values, list) or len(values) > 366:
            fail("Select at most 366 distinct date exceptions.")
        checked = {day(item, "Use date exception") for item in values}
        if len(checked) != len(values):
            fail("Select each date exception once.")
        if any(not value["startDate"] <= item <= value["endDate"] for item in checked):
            fail("Date exceptions must belong to the entered window.")
        return checked
    included, excluded = selected_dates("includeDates"), selected_dates("excludeDates")
    if included & excluded:
        fail("A date cannot be both included and excluded.")
    first, last = date.fromisoformat(value["startDate"]), date.fromisoformat(value["endDate"])
    dates = []
    for offset in range((last - first).days + 1):
        current = first + timedelta(days=offset)
        if current.isoformat() not in excluded and (current.weekday() in weekdays or current.isoformat() in included):
            dates.append(current.isoformat())
    if len(dates) * len(task_ids) * len(buyer_ids) > MAX_USES:
        fail("This expansion exceeds 500 dated uses. Select a shorter window or fewer useful tasks.", status=413)
    mode = domain.enum(pattern.get("mode", "PURCHASE"), MODES, "Expanded use mode")
    funding = pattern.get("fundingByBuyer", {})
    if not isinstance(funding, dict) or set(funding) - set(buyer_ids):
        fail("Bind prepaid funding only for the selected buyers.")
    replacement = pattern.get("replacePattern", False)
    if not isinstance(replacement, bool):
        fail("Replacing this pattern must be an explicit boolean.")
    previous_entries = {row["id"]: row for row in value["entries"]}
    previous_funding = {row["id"]: row for row in value["settlements"]}
    entries = [row for row in value["entries"] if not replacement or row["patternId"] != pattern_id]
    settlements = [row for row in value["settlements"] if not replacement or row["patternId"] != pattern_id]
    existing_entries, existing_funding = {row["id"] for row in entries}, {row["id"] for row in settlements}
    generated_ids = []
    for when in dates:
        for buyer_id in buyer_ids:
            for task_id in task_ids:
                suffix = digest({"pattern": pattern_id, "date": when, "buyer": buyer_id, "task": task_id})[:32]
                use_id, settlement_id = "use-" + suffix, "fund-" + suffix
                selected_funding = []
                if mode == "PURCHASE":
                    selected_funding = [settlement_id]
                    if settlement_id not in existing_funding:
                        old = previous_funding.get(settlement_id, {})
                        settlements.append({"id": settlement_id, "buyerDeploymentId": buyer_id, "taskId": task_id,
                            "date": when, "kind": "DIRECT", "purchaseIds": deepcopy(old.get("purchaseIds", [])),
                            "sourceIds": deepcopy(old.get("sourceIds", [])), "note": old.get("note", ""),
                            "patternId": pattern_id})
                        existing_funding.add(settlement_id)
                elif mode == "ALLOWANCE_USE":
                    selected_funding = funding.get(buyer_id, [])
                if use_id not in existing_entries:
                    old = previous_entries.get(use_id, {})
                    entries.append({"id": use_id, "buyerDeploymentId": buyer_id, "taskId": task_id,
                        "date": when, "state": old.get("state", "PLANNED"), "mode": mode,
                        "fundingIds": selected_funding, "sourcePeriod": old.get("sourcePeriod", ""),
                        "sourceIds": deepcopy(old.get("sourceIds", [])), "note": old.get("note", ""),
                        "patternId": pattern_id})
                    existing_entries.add(use_id)
                generated_ids.append(use_id)
    value["entries"], value["settlements"] = entries, settlements
    updated = deepcopy(document)
    updated["useCalendar"] = normalize(context, value, updated)
    return {"schema": SCHEMA + ".expansion", "document": updated,
        "pattern": {**pattern, "id": pattern_id, "weekdays": weekdays},
        "dates": dates, "generatedIds": generated_ids,
        "calendar": report(context, updated),
        "save": "Review and save this complete editable document through the original Installation preview and save."}


def selected_rows(operations, context, supplied):
    # Imported locally to keep Installation normalization free of import cycles.
    import operations_installations as installations
    if supplied is None:
        return installations.load_heads(operations, context["program"]["id"])
    values = rows(supplied, MAX_SELECTIONS, "saved Installation selection")
    seen, selected = set(), []
    for item in values:
        obj(item, ("id", "revision", "sha256"), "saved Installation selection")
        ident = installations.identity(item.get("id"))
        revision = installations.revision(item.get("revision"))
        if ident in seen:
            fail("Select one exact edition of each Installation.")
        seen.add(ident)
        row = installations.get(operations, context["program"]["id"], ident, revision)
        if item.get("sha256") is not None and item["sha256"] != row["sha256"]:
            fail("The selected Installation hash differs.", "CUSTOMER_USE_SELECTION_CHANGED", 409)
        selected.append(row)
    return selected


def calendar(context, selected, as_of=None):
    as_of = day(as_of or now()[:10], "Calendar observation date")
    groups, original_calendars, receipt_bindings = {}, [], defaultdict(list)
    retained_receipts, retained_sources = defaultdict(list), []
    current_maps = {kind: {row["id"]: row for row in values} for kind, values in context["records"].items()}
    for edition in selected:
        document = edition["preview"]["document"]
        value = document.get("useCalendar")
        if not value:
            continue
        ident = edition["id"]
        source_context = edition["preview"]["snapshot"]
        source_plan = source_context["plan"]
        group_id = "window-" + digest({"tranche": value["tranche"],
            "startDate": value["startDate"], "endDate": value["endDate"],
            "planContentSha256": source_plan["contentSha256"]})[:24]
        group = groups.setdefault(group_id, {"id": group_id, "tranche": value["tranche"],
            "startDate": value["startDate"], "endDate": value["endDate"],
            "planContentSha256": source_plan["contentSha256"],
            "planChanged": source_plan["contentSha256"] != context["plan"]["contentSha256"],
            "sourceContext": source_context, "members": []})
        owner = ident + "@" + str(edition["revision"])
        group["members"].append((owner, document, source_context))
        original = {"id": ident, "revision": edition["revision"], "sha256": edition["sha256"],
            "createdAt": edition["createdAt"], "sourceVersion": edition["preview"]["source"]["version"],
            "name": document["name"], "stage": document["stage"], "groupId": group_id}
        saved_report = deepcopy(edition["preview"]["report"].get("useCalendar"))
        if saved_report is None:
            saved_report = report(source_context, document)
        changes = {"missingRecords": [], "changedRecords": [], "missingSources": [], "changedSources": []}
        for kind, values in source_context["records"].items():
            for saved in values:
                current = current_maps.get(kind, {}).get(saved["id"])
                if current is None:
                    changes["missingRecords"].append({"kind": kind, "id": saved["id"]})
                elif canonical(current) != canonical(saved):
                    changes["changedRecords"].append({"kind": kind, "id": saved["id"],
                        "savedState": saved.get("state"), "currentState": current.get("state")})
        for source_id, saved in source_context["sources"].items():
            current = context["sources"].get(source_id)
            if current is None:
                changes["missingSources"].append(source_id)
            elif canonical(current) != canonical(saved):
                changes["changedSources"].append(source_id)
            retained_sources.append({**deepcopy(saved), "installationId": ident, "revision": edition["revision"],
                                     "currentSource": deepcopy(current)})
        original_calendars.append({**original, "document": deepcopy(value), "report": saved_report,
            "savedReport": deepcopy(saved_report), "currentChanges": changes,
            "sourceChanged": edition["preview"]["source"]["version"] != context["program"]["version"]})
        for saved in source_context["records"]["purchases"]:
            retained_receipts[saved["id"]].append({"installationId": ident, "revision": edition["revision"],
                                                  "purchase": receipt_view(saved)})
        for funding in value["settlements"]:
            for purchase_id in funding["purchaseIds"]:
                receipt_bindings[purchase_id].append({"installationId": ident, "revision": edition["revision"],
                                                      "fundingId": funding["id"]})
    views = []
    for group in groups.values():
        members = group.pop("members")
        source_context = group.pop("sourceContext")
        planned = counts(context, members)
        views.append({**group, "planned": planned,
                      **target_view(source_context, group["tranche"], group["startDate"], group["endDate"], planned)})
    receipts = {row["id"]: row for row in context["records"]["purchases"]}
    linked = set(receipt_bindings)
    active_entries = [(calendar_row, row) for calendar_row in original_calendars
                      for row in calendar_row["document"]["entries"] if row["state"] != "CANCELLED"]
    return {"schema": SCHEMA + ".selection", "source": {"caseId": context["program"]["id"],
        "caseVersion": context["program"]["version"], "mode": context["program"]["mode"],
        "planId": context["plan"]["id"],
        "planContentSha256": context["plan"]["contentSha256"]},
        "asOfDate": as_of,
        "selection": [{"id": row["id"], "revision": row["revision"], "sha256": row["sha256"]} for row in selected],
        "calendars": original_calendars, "groups": sorted(views, key=lambda row: (row["startDate"], row["id"])),
        "dueUses": [{"installationId": owner["id"], "revision": owner["revision"], "entryId": row["id"],
                     "date": row["date"], "mode": row["mode"]} for owner, row in active_entries if row["date"] <= as_of],
        "receipts": [{"purchase": receipt_view(receipts[ident]) if ident in receipts else deepcopy(retained_receipts[ident][0]["purchase"]),
                      "currentAvailable": ident in receipts, "savedObservations": deepcopy(retained_receipts[ident]), "bindings": bindings}
                     for ident, bindings in sorted(receipt_bindings.items())],
        "receiptConflicts": [{"purchaseId": ident, "bindings": bindings}
                            for ident, bindings in sorted(receipt_bindings.items()) if len(bindings) > 1],
        "unlinkedPurchases": [receipt_view(row) for row in context["records"]["purchases"] if row["id"] not in linked],
        "sources": retained_sources,
        "qualification": "Dates and funding groups describe planned business use. Native receipts retain their actual states. Continue through the original Cohort editor and review for actual grant target results."}


def seed_cohort(context, selected, group_id, as_of_at=None):
    view = calendar(context, selected)
    group = next((row for row in view["groups"] if row["id"] == group_id), None)
    if group is None or group["tranche"] is None:
        fail("Select a saved customer-use window with an original proposed tranche.")
    if group["planChanged"]:
        fail("This calendar retains an earlier pinned plan. Review and save its Installation against the current selected case plan before seeding that plan's Cohort.",
             "CUSTOMER_USE_PLAN_CHANGED", 409)
    originals = {row["id"]: row for row in selected}
    chosen = [row for row in view["calendars"] if row["groupId"] == group_id]
    receipt_owners = {}
    seeded = cohort.seed(context, group["tranche"])
    inputs = seeded["inputs"]
    inputs.update(name="Customer use " + group["startDate"] + " through " + group["endDate"],
        windowStart=group["startDate"], windowEnd=group["endDate"],
        asOfAt=cohort.stamp(as_of_at or now(), "Original receipt observation cutoff", False))
    buyers, merchants, operation_rows, bindings, products = set(), set(), [], [], []
    for chosen_row in chosen:
        edition = originals[chosen_row["id"]]
        document = edition["preview"]["document"]
        value = document["useCalendar"]
        merchant = document["merchantDeploymentId"]
        if not merchant:
            fail("Select the Installation's original merchant before opening a Cohort review.")
        merchants.add(merchant)
        buyers.update(document["buyerDeploymentIds"])
        operation_ids = {}
        for task in value["tasks"]:
            operation_id = "use-task-" + digest({"installation": edition["id"], "task": task["id"]})[:32]
            operation_ids[task["id"]] = operation_id
            source_ids = sorted(set(value["sourceIds"] + task["sourceIds"] + document["source"]["sourceIds"]))
            operation_rows.append({"id": operation_id, "label": task["name"], "merchantDeploymentId": merchant,
                "scope": task["request"], "expectedOutput": task["completeOutput"], "sourceIds": source_ids,
                "sourceNote": task["purpose"] + ("\nRepeat basis: " + task["repeatTrigger"] if task["repeatTrigger"] else ""),
                "sourceBasis": "OPERATOR_ENTRY"})
        funding = {row["id"]: row for row in value["settlements"]}
        for row in value["settlements"]:
            for purchase_id in row["purchaseIds"]:
                if purchase_id in receipt_owners:
                    fail("One receipt is bound by multiple selected settlement groups. Select its original owner before seeding Cohort.",
                         "CUSTOMER_USE_PURCHASE_COLLISION", 409)
                receipt_owners[purchase_id] = (edition["id"], row["id"])
                bindings.append({"purchaseId": purchase_id, "buyerDeploymentId": row["buyerDeploymentId"],
                    "operationId": operation_ids[row["taskId"]], "facilitatorId": None,
                    "transferVerified": False, "outputAccepted": False, "orderCompletedAt": None,
                    "sourceIds": sorted(set(value["sourceIds"] + row["sourceIds"])),
                    "sourceNote": row["note"], "sourceBasis": "OPERATOR_ENTRY"})
        for row in value["entries"]:
            if row["state"] == "CANCELLED":
                continue
            purchase_ids = sorted({pid for fid in row["fundingIds"] for pid in funding[fid]["purchaseIds"]})
            if not purchase_ids:
                continue
            # A usage row stays a parent useful result. It creates no extra purchase.
            products.append({"id": "use-result-" + digest({"installation": edition["id"], "entry": row["id"]})[:32],
                "label": next(task["name"] for task in value["tasks"] if task["id"] == row["taskId"]) + " · " + row["date"],
                "purchaseIds": purchase_ids, "state": "UNKNOWN", "completedAt": None,
                "sourceIds": sorted(set(value["sourceIds"] + row["sourceIds"])),
                "sourceNote": row["note"], "sourceBasis": "OPERATOR_ENTRY"})
    inputs.update(buyerDeploymentIds=sorted(buyers), merchantDeploymentIds=sorted(merchants),
                  operations=operation_rows, bindings=bindings, products=products,
                  note="Prepared from exact saved Installation customer-use calendars. Review original transfers, output, order completion, facilitator and population coverage; planned dates establish none of those observations.")
    # Original normalization validates this complete native input. Coverage,
    # payment review and completion remain the native seed's explicit unknowns.
    inputs = cohort.normalize(context, inputs)
    seeded["inputs"] = inputs
    seeded["customerUse"] = {"schema": SCHEMA + ".cohort-selection", "groupId": group_id,
        "selection": [{"id": row["id"], "revision": row["revision"], "sha256": row["sha256"]} for row in chosen],
        "caseVersion": context["program"]["version"], "automaticQualification": False}
    return seeded


def flat_rows(view):
    result = []
    for calendar_row in view["calendars"]:
        tasks = {row["id"]: row for row in calendar_row["document"]["tasks"]}
        funding = {row["id"]: row for row in calendar_row["document"]["settlements"]}
        for row in calendar_row["document"]["entries"]:
            task = tasks[row["taskId"]]
            ids = sorted({pid for ident in row["fundingIds"] for pid in funding[ident]["purchaseIds"]})
            result.append({"installationId": calendar_row["id"], "revision": calendar_row["revision"],
                "installationSha256": calendar_row["sha256"], "calendar": calendar_row["document"]["name"],
                "entryId": row["id"], "date": row["date"], "state": row["state"],
                "buyerDeploymentId": row["buyerDeploymentId"], "taskId": row["taskId"], "task": task["name"],
                "purpose": task["purpose"], "request": task["request"], "completeOutput": task["completeOutput"],
                "repeatTrigger": task["repeatTrigger"], "pricedUnit": task["pricedUnit"],
                "mode": row["mode"], "fundingIds": canonical(row["fundingIds"]), "purchaseIds": canonical(ids),
                "sourcePeriod": row["sourcePeriod"], "sourceIds": canonical(row["sourceIds"]), "note": row["note"]})
    return result


def ics_text(value):
    return str(value).replace("\\", "\\\\").replace("\r\n", "\n").replace("\r", "\n").replace("\n", "\\n").replace(";", "\\;").replace(",", "\\,")


def fold_ics(line):
    # RFC-sized physical lines without splitting a UTF-8 code point.
    lines, current, width = [], "", 0
    for char in line:
        size = len(char.encode("utf-8"))
        if width + size > 75:
            lines.append(current)
            current, width = " ", 1
        current += char
        width += size
    lines.append(current)
    return "\r\n".join(lines)


def export_bytes(view, format):
    if format == "json":
        return (json.dumps(view, ensure_ascii=False, indent=2) + "\n").encode("utf-8")
    flat = flat_rows(view)
    if format == "csv":
        headings = ("installationId", "revision", "installationSha256", "calendar", "entryId", "date", "state",
            "buyerDeploymentId", "taskId", "task", "purpose", "request", "completeOutput", "repeatTrigger",
            "pricedUnit", "mode", "fundingIds", "purchaseIds", "sourcePeriod", "sourceIds", "note")
        output = io.StringIO(newline="")
        writer = csv.DictWriter(output, fieldnames=headings)
        writer.writeheader()
        writer.writerows(flat)
        return output.getvalue().encode("utf-8")
    if format != "ics":
        fail("Select a complete customer-use export in JSON, CSV or ICS.")
    owners = {row["id"]: row for row in view["calendars"]}
    lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Stellar Forge//Customer use calendar//EN",
             "CALSCALE:GREGORIAN", "METHOD:PUBLISH"]
    for row in flat:
        owner = owners[row["installationId"]]
        created = datetime.fromisoformat(owner["createdAt"].replace("Z", "+00:00")).astimezone(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        description = "\n".join((row["purpose"], "Complete request: " + row["request"],
            "Whole output: " + row["completeOutput"], "Repeat basis: " + row["repeatTrigger"],
            "Mode: " + row["mode"], "Funding groups: " + row["fundingIds"],
            "Original receipt IDs: " + row["purchaseIds"], "Source period: " + row["sourcePeriod"],
            "Selected Installation edition: " + str(row["revision"]) + " / " + row["installationSha256"],
            "This is planned business use. Payment and useful-output qualification use original receipts and Cohort review."))
        lines.extend(["BEGIN:VEVENT",
            "UID:" + digest({"case": view["source"]["caseId"], "installation": row["installationId"], "entry": row["entryId"]}) + "@stellar-forge",
            "SEQUENCE:" + str(row["revision"]), "DTSTAMP:" + created,
            "DTSTART;VALUE=DATE:" + row["date"].replace("-", ""),
            "DTEND;VALUE=DATE:" + (date.fromisoformat(row["date"]) + timedelta(days=1)).isoformat().replace("-", ""),
            "SUMMARY:" + ics_text(row["task"] + " · " + row["mode"]),
            "DESCRIPTION:" + ics_text(description),
            "STATUS:" + ("CANCELLED" if row["state"] == "CANCELLED" else "TENTATIVE"),
            "TRANSP:TRANSPARENT", "END:VEVENT"])
    lines.append("END:VCALENDAR")
    return ("\r\n".join(fold_ics(line) for line in lines) + "\r\n").encode("utf-8")


def content_type(format):
    return {"json": "application/json; charset=utf-8", "csv": "text/csv; charset=utf-8",
            "ics": "text/calendar; charset=utf-8"}.get(format, "application/octet-stream")


def installation_section(document):
    value = document.get("useCalendar")
    if not value:
        return ""
    e = lambda value: escape(str(value if value is not None else ""), quote=True)
    tasks = {row["id"]: row for row in value["tasks"]}
    body = "<h2>Customer-use calendar</h2><p>" + e(value["name"]) + " · " + e(value["startDate"]) + " through " + e(value["endDate"]) + "</p>"
    body += "<p>" + e(value["note"]) + "</p><p>Funding groups are separate from allowance uses, reopened outputs and free uses. Original receipt states remain in this saved edition.</p>"
    body += "<table><thead><tr><th>Date</th><th>Buyer</th><th>Useful task</th><th>Mode / state</th><th>Funding / source period</th></tr></thead><tbody>"
    for row in sorted(value["entries"], key=lambda item: (item["date"], item["id"])):
        body += "<tr><td>" + e(row["date"]) + "</td><td>" + e(row["buyerDeploymentId"]) + "</td><td>" + e(tasks[row["taskId"]]["name"]) + "</td><td>" + e(row["mode"] + " / " + row["state"]) + "</td><td>" + e(", ".join(row["fundingIds"])) + "<br>" + e(row["sourcePeriod"]) + "</td></tr>"
    body += "</tbody></table><h3>Complete saved customer-use input</h3><pre>" + e(json.dumps(value, ensure_ascii=False, indent=2)) + "</pre>"
    return body
