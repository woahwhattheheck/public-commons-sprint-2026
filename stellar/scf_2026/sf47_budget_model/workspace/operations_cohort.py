"""Source-bound cohort evaluation in the original SF47 Operations journal.

No payment, provider, order or submission command is executed by this module.
All measurements are reproducible from the frozen original case and review.
"""
from __future__ import annotations

from collections import defaultdict
from copy import deepcopy
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal, ROUND_HALF_UP, localcontext
import hashlib
import html
import io
import json
import re
import uuid
import zipfile

from model import canonical, csv_bytes, digest, MAX_BUNDLE, now, text
import operations_domain as domain

SCHEMA = "stellar-forge.sf47-cohort-evaluation.v1"
MAX_ROWS = 5000
MAX_REVIEWS = 500
EXTERNAL = ("INDEPENDENT_OPERATOR", "CUSTOMER")
OUTCOME_KINDS = ("INTERRUPTED_SETTLED_PURCHASE", "MERCHANT_DELIVERY_FAILURE",
                 "RESTORE_CUTOVER", "INDEPENDENT_SUPPORT")
STAMP = re.compile(r"^(\d{4}-\d{2}-\d{2})[Tt ](\d{2}:\d{2}(?::\d{2})?)(?:[.,](\d{1,30}))?([Zz]|[+-]\d{2}(?::?\d{2})?)$")
INPUT_FIELDS = ("name", "tranche", "windowStart", "windowEnd", "asOfAt",
                "buyerDeploymentIds", "merchantDeploymentIds", "operations", "facilitators",
                "bindings", "products", "outcomes", "refundCashIds", "coverage", "awardAcceptance", "requiredWork", "note")


def obj(value, fields, label):
    if not isinstance(value, dict) or set(value) - set(fields):
        domain.fail("Use only the documented " + label + " fields.", "INVALID_COHORT")
    return value


def rows(value, label, maximum=MAX_ROWS):
    if not isinstance(value, list) or len(value) > maximum or any(not isinstance(x, dict) for x in value):
        domain.fail("Use bounded " + label + " rows.", "INVALID_COHORT", 413 if isinstance(value, list) and len(value) > maximum else 422)
    return value


def key(value, label):
    value = text(value, label, 200, True)
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._:-]{0,199}", value):
        domain.fail(label + " must be an explicit stable identifier.", "INVALID_COHORT")
    return value


def distinct(values, label):
    seen = set()
    for value in values:
        if value["id"] in seen:
            domain.fail("Repeated " + label + " identity.", "INVALID_COHORT")
        seen.add(value["id"])
    return values


def evidence(value, context):
    return domain.source_fields(value, context["sources"])


def supported(value):
    return bool(value and (value.get("sourceIds") or value.get("sourceNote", "").strip()))


def strict_bool(value, label):
    if not isinstance(value, bool):
        domain.fail(label + " must be an explicit boolean.", "INVALID_COHORT")
    return value


def clock(value, label="Original UTC timestamp", optional=False):
    if value in (None, "") and optional:
        return None
    value = text(value, label, 100, True)
    match = STAMP.fullmatch(value)
    if not match:
        domain.fail(label + " needs an ISO timestamp with an explicit timezone.", "INVALID_COHORT_CLOCK")
    try:
        parsed = datetime.fromisoformat(match[1] + "T" + match[2] + ("+00:00" if match[4].upper() == "Z" else match[4]))
        delta = parsed.astimezone(timezone.utc) - datetime(1970, 1, 1, tzinfo=timezone.utc)
        whole = Decimal(delta.days * 86400 + delta.seconds)
        with localcontext() as arithmetic:
            arithmetic.prec = 100
            epoch = whole + (Decimal("0." + match[3]) if match[3] else Decimal(0))
        return {"source": value, "epoch": epoch, "day": parsed.astimezone(timezone.utc).date().isoformat()}
    except (ValueError, OverflowError) as exc:
        domain.fail(label + " is not a valid timestamp.", "INVALID_COHORT_CLOCK")


def elapsed_seconds(later, earlier):
    with localcontext() as arithmetic:
        arithmetic.prec = 100
        return format(clock(later)["epoch"] - clock(earlier)["epoch"], "f")


def observation_time(value):
    # A native void is a later state transition, not a new earlier observation.
    return value.get("updatedAt") if value.get("state") == "VOID" and value.get("updatedAt") else value.get("observedAt")


def stamp(value, label, optional=True):
    result = clock(value, label, optional)
    return result["source"] if result else None


def day(value, label):
    return domain.calendar(value, label, True)


def maps(context):
    return {name: {row["id"]: row for row in values} for name, values in context["records"].items()}


def rule(context, tranche):
    tranche = domain.integer(tranche, "Cohort tranche", 2, 3)
    original = context["plan"].get("scenario", {}).get("deployment_acceptance_plan")
    if not isinstance(original, dict) or original.get("schema") != "stellar-forge.scf-deployment-outcomes.v1":
        domain.fail("This pinned plan has no original deployment acceptance proposal. Select its actual revised plan before evaluating a cohort.", "COHORT_RULE_MISSING", 409)
    target = next((x for x in original.get("targets", []) if x.get("tranche") == tranche), None)
    if not target:
        domain.fail("The original plan does not define that cohort tranche.", "COHORT_RULE_MISSING", 409)
    domain.integer(target.get("proposed_window", {}).get("consecutive_calendar_days"), "Original cohort window", 1, 366)
    for value in target.get("target_counts", {}).values():
        domain.integer(value, "Original target count", 0, MAX_ROWS)
    return {"schema": original["schema"], "status": original.get("status"),
            "preparedOn": original.get("prepared_on"), "sourceBaselineCommit": original.get("source_baseline_commit"),
            "relationToBudget": original.get("relation_to_budget"), "timing": original.get("timing"),
            "independence": deepcopy(original.get("independence", {})),
            "reporting": deepcopy(original.get("reporting", {})), "target": deepcopy(target)}


def normalize(context, supplied):
    data = obj(supplied, INPUT_FIELDS, "cohort input")
    available = maps(context)
    tranche = domain.integer(data.get("tranche"), "Cohort tranche", 2, 3)
    rule(context, tranche)
    normalized = {"name": text(data.get("name"), "Review name", 500, True), "tranche": tranche,
                  "windowStart": day(data.get("windowStart"), "First UTC calendar day"),
                  "windowEnd": day(data.get("windowEnd"), "Last UTC calendar day"),
                  "asOfAt": stamp(data.get("asOfAt"), "Retained observation cutoff", False),
                  "buyerDeploymentIds": domain.reference_list(data.get("buyerDeploymentIds", []), available["deployments"], "Selected buyers"),
                  "merchantDeploymentIds": domain.reference_list(data.get("merchantDeploymentIds", []), available["deployments"], "Selected merchants"),
                  "note": text(data.get("note", ""), "Cohort review note", 20000)}
    for ident in normalized["buyerDeploymentIds"]:
        if available["deployments"][ident]["role"] not in ("BUYER", "BOTH"):
            domain.fail("Select a buyer or combined deployment as the buyer.", "INVALID_COHORT")
    for ident in normalized["merchantDeploymentIds"]:
        if available["deployments"][ident]["role"] not in ("MERCHANT", "BOTH"):
            domain.fail("Select a merchant or combined deployment as the merchant.", "INVALID_COHORT")
    operation_rows = []
    for x in rows(data.get("operations", []), "useful operation", 1000):
        obj(x, ("id", "label", "merchantDeploymentId", "scope", "expectedOutput", "sourceIds", "sourceNote", "sourceBasis"), "useful operation")
        merchant = x.get("merchantDeploymentId")
        if merchant not in normalized["merchantDeploymentIds"]:
            domain.fail("Associate the useful operation with a selected original merchant.", "INVALID_COHORT")
        operation_rows.append({"id": key(x.get("id"), "Useful operation ID"), "label": text(x.get("label"), "Useful operation", 500, True),
                               "merchantDeploymentId": merchant, "scope": text(x.get("scope", ""), "Agreed scope and terms", 12000),
                               "expectedOutput": text(x.get("expectedOutput", ""), "Expected complete output", 12000), **evidence(x, context)})
    normalized["operations"] = distinct(operation_rows, "useful operation")
    operation_ids = {x["id"] for x in operation_rows}
    facilitator_rows = []
    for x in rows(data.get("facilitators", []), "facilitator", 200):
        obj(x, ("id", "name", "operatorId", "serviceUrl", "participantClass", "sourceIds", "sourceNote", "sourceBasis"), "facilitator")
        facilitator_rows.append({"id": key(x.get("id"), "Facilitator ID"), "name": text(x.get("name"), "Facilitator name", 500, True),
                                 "operatorId": text(x.get("operatorId"), "Accountable facilitator operator", 500, True),
                                 "serviceUrl": domain.url(x.get("serviceUrl", ""), "Actual facilitator service"),
                                 "participantClass": domain.enum(x.get("participantClass", "TEAM_OPERATED"),
                                                                 ("TEAM_OPERATED", *EXTERNAL), "Facilitator participation"),
                                 **evidence(x, context)})
    normalized["facilitators"] = distinct(facilitator_rows, "facilitator")
    facilitator_ids = {x["id"] for x in facilitator_rows}
    bindings, seen = [], set()
    for x in rows(data.get("bindings", []), "original purchase association"):
        obj(x, ("purchaseId", "buyerDeploymentId", "operationId", "facilitatorId", "transferVerified", "outputAccepted", "orderCompletedAt",
                "sourceIds", "sourceNote", "sourceBasis"), "purchase association")
        ident = x.get("purchaseId")
        if ident not in available["purchases"] or ident in seen:
            domain.fail("Bind each selected original purchase once.", "INVALID_COHORT")
        seen.add(ident)
        buyer_id = x.get("buyerDeploymentId") or None
        operation_id = x.get("operationId") or None
        facilitator_id = x.get("facilitatorId") or None
        if buyer_id and buyer_id not in normalized["buyerDeploymentIds"]:
            domain.fail("Choose a selected original buyer.", "INVALID_COHORT")
        if operation_id and operation_id not in operation_ids or facilitator_id and facilitator_id not in facilitator_ids:
            domain.fail("Choose a retained reviewed operation and facilitator.", "INVALID_COHORT")
        bindings.append({"purchaseId": ident, "buyerDeploymentId": buyer_id, "operationId": operation_id,
                         "facilitatorId": facilitator_id, "transferVerified": strict_bool(x.get("transferVerified", False), "Transfer review"),
                         "outputAccepted": strict_bool(x.get("outputAccepted", False), "Output review"),
                         "orderCompletedAt": stamp(x.get("orderCompletedAt"), "Original order completion"), **evidence(x, context)})
    normalized["bindings"] = bindings
    products = []
    for x in rows(data.get("products", []), "parent product", 1000):
        obj(x, ("id", "label", "purchaseIds", "state", "completedAt", "sourceIds", "sourceNote", "sourceBasis"), "parent product")
        products.append({"id": key(x.get("id"), "Parent product ID"), "label": text(x.get("label"), "Parent product", 500, True),
                         "purchaseIds": domain.reference_list(x.get("purchaseIds", []), available["purchases"], "Complete expected purchase set", MAX_ROWS),
                         "state": domain.enum(x.get("state", "UNKNOWN"), ("STARTED", "COMPLETE", "UNKNOWN"), "Parent product state"),
                         "completedAt": stamp(x.get("completedAt"), "Whole product completion"), **evidence(x, context)})
    normalized["products"] = distinct(products, "parent product")
    outcomes = []
    for x in rows(data.get("outcomes", []), "original deployed outcome", 1000):
        obj(x, ("id", "kind", "deploymentId", "reference", "startedAt", "alertedAt", "acknowledgedAt", "completedAt", "activeMinutes",
                "operatorId", "participantClass", "result", "financialOutcome", "sourceIds", "sourceNote", "sourceBasis"), "original deployed outcome")
        dep = x.get("deploymentId")
        if dep not in available["deployments"]:
            domain.fail("Link the outcome to its original deployment.", "INVALID_COHORT")
        outcomes.append({"id": key(x.get("id"), "Outcome identity"),
                         "kind": domain.enum(x.get("kind"), OUTCOME_KINDS, "Original outcome kind"), "deploymentId": dep,
                         "reference": text(x.get("reference", ""), "Original case and event reference", 4000),
                         "startedAt": stamp(x.get("startedAt"), "Original fault or work start"),
                         "alertedAt": stamp(x.get("alertedAt"), "Original alert time"),
                         "acknowledgedAt": stamp(x.get("acknowledgedAt"), "Original acknowledgment time"),
                         "operatorId": text(x.get("operatorId", ""), "Resolving operator identity", 500),
                         "participantClass": domain.enum(x.get("participantClass", "TEAM_OPERATED"), ("TEAM_OPERATED", *EXTERNAL), "Resolving operator participation"),
                         "result": text(x.get("result", ""), "Original recovered result", 12000),
                         "financialOutcome": text(x.get("financialOutcome", ""), "Actual original financial outcome", 12000),
                         "completedAt": stamp(x.get("completedAt"), "Original recovery or work completion"),
                         "activeMinutes": None if x.get("activeMinutes") in (None, "") else domain.quantity(x["activeMinutes"], "Actual active operator minutes", 6),
                         **evidence(x, context)})
    normalized["outcomes"] = distinct(outcomes, "outcome")
    normalized["refundCashIds"] = domain.reference_list(data.get("refundCashIds", []), available["cash"], "Actual refund observations")
    for ident in normalized["refundCashIds"]:
        if available["cash"][ident]["category"] != "REFUND":
            domain.fail("Select an original REFUND cash observation.", "INVALID_COHORT")
    cov = obj(data.get("coverage", {}), ("state", "sourceIds", "sourceNote", "sourceBasis", "gaps"), "coverage")
    gaps = []
    for x in rows(cov.get("gaps", []), "coverage gap", 1000):
        obj(x, ("startAt", "endAt", "note"), "coverage gap")
        start, end = stamp(x.get("startAt"), "Gap start"), stamp(x.get("endAt"), "Gap end")
        if start and end and clock(end)["epoch"] < clock(start)["epoch"]:
            domain.fail("A coverage gap ends before it starts.", "INVALID_COHORT_CLOCK")
        gaps.append({"startAt": start, "endAt": end, "note": text(x.get("note"), "Retained coverage gap", 4000, True)})
    normalized["coverage"] = {"state": domain.enum(cov.get("state", "UNKNOWN"), ("UNKNOWN", "PARTIAL", "COMPLETE"), "Retained coverage"),
                              "gaps": gaps, **evidence(cov, context)}
    acceptance = obj(data.get("awardAcceptance", {}), ("date", "sourceIds", "sourceNote", "sourceBasis"), "actual award acceptance")
    normalized["awardAcceptance"] = {"date": day(acceptance.get("date"), "Actual award acceptance"), **evidence(acceptance, context)}
    required = obj(data.get("requiredWork", {}), ("state", "completedAt", "workIds", "sourceIds", "sourceNote", "sourceBasis"), "required deployed work")
    normalized["requiredWork"] = {"state": domain.enum(required.get("state", "UNKNOWN"), ("UNKNOWN", "IN_PROGRESS", "COMPLETE"), "Required deployed work"),
                                 "completedAt": stamp(required.get("completedAt"), "Required work completion"),
                                 "workIds": domain.reference_list(required.get("workIds", []), available["work"], "Original work observations"),
                                 **evidence(required, context)}
    return normalized


def history_from_events(events):
    """Keep native purchase observations without copying unrelated case events."""
    result = []
    for event in events:
        candidates = []
        if event.get("kind") == "purchases":
            candidates = [event.get("after")]
        elif event.get("kind") == "buyerReceiving":
            candidates = (event.get("after") or {}).get("purchases", [])
        for value in candidates:
            if isinstance(value, dict) and value.get("id") and "settlementStatus" in value:
                result.append({"eventVersion": event["version"], "eventAction": event["action"], "purchase": deepcopy(value)})
    return result


def source_ids(context, inputs, history):
    ids = set(inputs["refundCashIds"])
    selected_cash = [row for row in context["records"]["cash"] if row["id"] in ids]
    ids = set()
    def visit(value):
        if isinstance(value, dict):
            ids.update(value.get("sourceIds", []))
            for child in value.values():
                if isinstance(child, (dict, list)):
                    visit(child)
        elif isinstance(value, list):
            for child in value:
                visit(child)
    visit(inputs)
    visit(context["records"]["purchases"])
    visit(context["records"]["deployments"])
    visit(history)
    visit(selected_cash)
    visit([x for x in context["records"]["work"] if x["id"] in inputs["requiredWork"]["workIds"]])
    return sorted(ids)


def measurement(context, inputs, history):
    ids = source_ids(context, inputs, history)
    return {"planContentSha256": context["plan"]["contentSha256"], "rule": rule(context, inputs["tranche"]),
            "purchases": sorted(deepcopy(context["records"]["purchases"]), key=lambda x: x["id"]),
            "deployments": sorted(deepcopy(context["records"]["deployments"]), key=lambda x: x["id"]),
            "history": deepcopy(history),
            "sources": [deepcopy(context["sources"][ident]) for ident in ids],
            "refundCash": sorted([deepcopy(x) for x in context["records"]["cash"] if x["id"] in inputs["refundCashIds"]], key=lambda x: x["id"]),
            "requiredWork": sorted([deepcopy(x) for x in context["records"]["work"] if x["id"] in inputs["requiredWork"]["workIds"]], key=lambda x: x["id"]),
            "inputs": deepcopy(inputs)}


def seed(context, tranche):
    selected_rule = rule(context, tranche)
    inputs = {"name": "Tranche " + str(tranche) + " cohort review", "tranche": tranche,
              "windowStart": None, "windowEnd": None, "asOfAt": now(),
              "buyerDeploymentIds": [], "merchantDeploymentIds": [], "operations": [], "facilitators": [],
              "bindings": [], "products": [], "outcomes": [], "refundCashIds": [],
              "coverage": {"state": "UNKNOWN", "sourceIds": [], "sourceNote": "", "gaps": []},
              "awardAcceptance": {"date": None, "sourceIds": [], "sourceNote": ""},
              "requiredWork": {"state": "UNKNOWN", "completedAt": None, "workIds": [], "sourceIds": [], "sourceNote": ""}, "note": ""}
    return {"schema": SCHEMA, "source": {"programId": context["program"]["id"], "version": context["program"]["version"],
             "planContentSha256": context["plan"]["contentSha256"]}, "rule": selected_rule, "inputs": inputs,
            "inventory": {key: deepcopy(context["records"][key]) for key in ("deployments", "purchases", "cash", "awards")},
            "sources": deepcopy(list(context["sources"].values()))}


def ratio(numerator, denominator):
    return {"numerator": numerator, "denominator": denominator,
            "percentage": None if not denominator else str((Decimal(numerator) * 100 / Decimal(denominator)).quantize(Decimal(".01"), rounding=ROUND_HALF_UP))}


def preview(context, supplied, history=None):
    history = deepcopy(history or [])
    inputs = normalize(context, supplied)
    selected_rule = rule(context, inputs["tranche"])
    available = maps(context)
    bindings = {x["purchaseId"]: x for x in inputs["bindings"]}
    operations = {x["id"]: x for x in inputs["operations"]}
    facilitators = {x["id"]: x for x in inputs["facilitators"]}
    issues = []
    def issue(code, message, ident=None, blocking=True):
        value = {"code": code, "message": message, "id": ident, "blocking": blocking}
        if value not in issues:
            issues.append(value)
    cutoff = clock(inputs["asOfAt"])
    start_day, end_day = inputs["windowStart"], inputs["windowEnd"]
    start = clock(start_day + "T00:00:00Z")["epoch"] if start_day else None
    end = clock((date.fromisoformat(end_day) + timedelta(days=1)).isoformat() + "T00:00:00Z")["epoch"] if end_day and end_day < "9999-12-31" else None
    duration = (date.fromisoformat(end_day) - date.fromisoformat(start_day)).days + 1 if start_day and end_day else None
    required_days = selected_rule["target"]["proposed_window"]["consecutive_calendar_days"]
    window_valid = duration == required_days and start is not None and end is not None
    closed = bool(window_valid and cutoff["epoch"] >= end)
    if not window_valid:
        issue("WINDOW_REQUIRED", "Select exactly " + str(required_days) + " consecutive UTC calendar days from the original proposed tranche.")
    elif not closed:
        issue("WINDOW_IN_PROGRESS", "The retained observation cutoff precedes the end of the selected window.")
    def within(value):
        return bool(window_valid and value and start <= clock(value)["epoch"] < end)
    def observed(value):
        return bool(value and clock(value)["epoch"] <= cutoff["epoch"])
    if inputs["coverage"]["state"] != "COMPLETE" or not supported(inputs["coverage"]) or inputs["coverage"]["gaps"]:
        issue("COVERAGE_INCOMPLETE", "Retain explicit complete source coverage and resolve the listed gaps before using the result as complete acceptance evidence.")
    if not inputs["buyerDeploymentIds"]:
        issue("BUYERS_REQUIRED", "Select the actual original buyer deployments; identities are never inferred from addresses or sessions.")
    if not inputs["merchantDeploymentIds"]:
        issue("MERCHANTS_REQUIRED", "Select the actual original merchant installations.")
    expected_env = "TESTNET" if inputs["tranche"] == 2 else "MAINNET"
    def external(dep, role=None):
        return bool(dep and dep.get("participantClass") in EXTERNAL and dep.get("operatorId")
                    and (not role or dep.get("role") in (role, "BOTH"))
                    and dep.get("environment") == expected_env and dep.get("state") in ("OPERATING", "HANDED_OVER")
                    and supported(dep))
    selected = set(inputs["buyerDeploymentIds"] + inputs["merchantDeploymentIds"])
    original_observations = defaultdict(list)
    for h in history:
        original_observations[h["purchase"]["id"]].append(h["purchase"])
    for p in context["records"]["purchases"]:
        if p not in original_observations[p["id"]]:
            original_observations[p["id"]].append(p)
    purchase_views, groups, excluded = [], defaultdict(list), []
    for original in sorted(context["records"]["purchases"], key=lambda x: x["id"]):
        ident = original["id"]
        binding = bindings.get(ident)
        selected_row = original["deploymentId"] in selected or bool(binding and binding["buyerDeploymentId"] in inputs["buyerDeploymentIds"])
        row = {"purchaseId": ident, "selected": selected_row, "original": deepcopy(original),
               "binding": deepcopy(binding), "history": deepcopy(original_observations[ident])}
        if not selected_row:
            row["reason"] = "Outside the explicitly selected deployment and buyer scope."
            excluded.append(row)
            continue
        buyer = available["deployments"].get(binding["buyerDeploymentId"]) if binding and binding["buyerDeploymentId"] else None
        operator = buyer.get("operatorId") if buyer else original.get("operatorId") if available["deployments"].get(original["deploymentId"], {}).get("role") in ("BUYER", "BOTH") else None
        # Unknown buyer identities never collapse unrelated intents.
        group_id = digest({"network": original["network"], "buyer": operator or "unbound:" + original["deploymentId"],
                           "intent": original.get("intentId") or "unidentified:" + ident})
        row["groupId"] = group_id
        row["buyerOperatorId"] = operator
        groups[group_id].append(row)
        purchase_views.append(row)
    intent_views = []
    transactions_by_key = {}
    for group_id, members in sorted(groups.items()):
        group_reasons = []
        def reason(code, message):
            if code not in group_reasons:
                group_reasons.append(code)
                issue(code, message, group_id, False)
        originals = [x["original"] for x in members]
        all_observations = [p for x in members for p in x["history"]]
        observed_history = [p for p in all_observations if observed(observation_time(p))]
        times = sorted({clock(p["firstAttemptAt"])["epoch"]: p["firstAttemptAt"] for p in observed_history if p.get("firstAttemptAt")}.items())
        later_anchors = sorted({p["firstAttemptAt"] for p in all_observations if p.get("firstAttemptAt") and not observed(observation_time(p))})
        first_at = times[0][1] if times else None
        first_in_window = within(first_at)
        if len(times) > 1:
            reason("FIRST_ATTEMPT_DISAGREEMENT", "The same original intent has different retained first-attempt anchors; review them without deleting its attempts.")
        if not first_at:
            reason("FIRST_ATTEMPT_UNKNOWN", "This intent has no retained original first-attempt clock and remains unplaced.")
        if any(not x.get("intentId") for x in originals):
            reason("INTENT_UNKNOWN", "The original approved intent is missing; a row ID is not an intent.")
        current_rows, completions = [], []
        for member in members:
            p0, binding = member["original"], member["binding"]
            eligible = [x for x in member["history"] if observed(observation_time(x))]
            eligible.sort(key=lambda x: (clock(observation_time(x))["epoch"], x.get("version", 0)))
            p = eligible[-1] if eligible else None
            member["asOfObservation"] = deepcopy(p)
            member["currentStateDiffers"] = bool(p and p != p0)
            if not p:
                reason("NO_OBSERVATION_AT_CUTOFF", "No original observation is retained at or before the selected cutoff.")
                continue
            current_rows.append(p)
            buyer = available["deployments"].get(binding.get("buyerDeploymentId")) if binding else None
            operation = operations.get(binding.get("operationId")) if binding else None
            merchant = available["deployments"].get(operation["merchantDeploymentId"]) if operation else None
            facilitator = facilitators.get(binding.get("facilitatorId")) if binding else None
            row_reasons = []
            if not binding or not buyer or not operation:
                row_reasons.append("MISSING_USEFUL_OPERATION_JOIN")
            if binding and (not binding["transferVerified"] or not binding["outputAccepted"] or not supported(binding)):
                row_reasons.append("INDEPENDENT_TRANSFER_OUTPUT_REVIEW_REQUIRED")
            if operation and (not operation["scope"].strip() or not operation["expectedOutput"].strip() or not supported(operation)):
                row_reasons.append("USEFUL_OPERATION_SOURCE_REQUIRED")
            original_dep = available["deployments"].get(p["deploymentId"], {})
            if buyer and original_dep.get("role") in ("BUYER", "BOTH") and (buyer["id"] != p["deploymentId"] or buyer["operatorId"] != p.get("operatorId")):
                row_reasons.append("ORIGINAL_BUYER_IDENTITY_DIFFERS")
            if p.get("participantClass") == "TEAM_OPERATED":
                row_reasons.append("ORIGINAL_TEAM_OPERATED")
            if not external(buyer, "BUYER") or not external(merchant, "MERCHANT"):
                row_reasons.append("INDEPENDENT_OPERATING_DEPLOYMENTS_REQUIRED")
            if p.get("deploymentEnvironment") != expected_env:
                row_reasons.append("ORIGINAL_NETWORK_CLASS_DIFFERS")
            native_identity = bool(p.get("intentId") and p.get("transactionHash") and int(p.get("amountStroops", "0")) > 0
                                   and p.get("acceptedTermsSha256") and supported(p))
            if not native_identity:
                row_reasons.append("ORIGINAL_TRANSFER_TERMS_SOURCE_REQUIRED")
            if p.get("state") == "VOID":
                row_reasons.append("VOID_OBSERVATION")
            # A prior complete result is retained as gross completion even after a
            # later cancellation/refund or unavailable output observation.
            for old in eligible:
                paid = old.get("settlementStatus") == "SETTLED" and bool(old.get("transactionHash")) and int(old.get("amountStroops", "0")) > 0
                output = old.get("outputStatus") == "COMPLETE" and old.get("deliveredBytes") is not None and bool(old.get("deliveredSha256"))
                order = old.get("orderStatus", "NOT_APPLICABLE")
                order_at = binding.get("orderCompletedAt") if binding else None
                order_complete = order == "NOT_APPLICABLE" or order == "FULFILLED" and bool(order_at)
                if not paid or not output or not order_complete or not old.get("settledAt") or not old.get("outputCompletedAt"):
                    continue
                relevant = [old["settledAt"], old["outputCompletedAt"]] + ([order_at] if order != "NOT_APPLICABLE" else [])
                completion_at = max(relevant, key=lambda x: clock(x)["epoch"])
                if not observed(completion_at):
                    continue
                if first_at and any(clock(x)["epoch"] < clock(first_at)["epoch"] for x in relevant):
                    reason("COMPLETION_CLOCK_CONFLICT", "A settlement, output or order completion precedes its original first attempt.")
                    continue
                complete_current = old == p and p.get("orderStatus") in ("NOT_APPLICABLE", "FULFILLED") and p.get("state") != "VOID"
                completions.append({"purchaseId": p["id"], "observationVersion": old.get("version"),
                                    "completedAt": completion_at, "inWindow": within(completion_at), "current": complete_current,
                                    "buyerOperatorId": buyer.get("operatorId") if buyer else None,
                                    "merchantOperatorId": merchant.get("operatorId") if merchant else None,
                                    "operationId": operation["id"] if operation else None,
                                    "facilitatorId": facilitator["id"] if facilitator else None,
                                    "facilitatorOperatorId": facilitator["operatorId"] if facilitator else None,
                                    "facilitatorIndependent": bool(facilitator and facilitator["participantClass"] in EXTERNAL
                                                                   and facilitator["serviceUrl"] and supported(facilitator)),
                                    "independent": not row_reasons, "reasons": list(row_reasons)})
            member["qualificationIssues"] = row_reasons
            settled_proofs = [old for old in eligible if old.get("settlementStatus") == "SETTLED" and old.get("transactionHash")
                              and (not old.get("settledAt") or observed(old["settledAt"]))]
            if settled_proofs:
                proof = settled_proofs[-1]
                txkey = (proof["network"], proof["transactionHash"].lower())
                proof_value = {"purchaseId": proof["id"], "groupId": group_id, "asset": proof["asset"],
                               "amountAtomic": proof["amountStroops"], "feesAtomic": proof.get("feesStroops"),
                               "settledAt": proof.get("settledAt"), "intentId": proof.get("intentId"),
                               "observationVersion": proof.get("version"), "sourceIds": proof.get("sourceIds", [])}
                tx = {"network": proof["network"], "asset": proof["asset"], "transactionHash": proof["transactionHash"],
                      "amountAtomic": proof["amountStroops"], "feesAtomic": proof.get("feesStroops"),
                      "settledAt": proof.get("settledAt"), "settlesInWindow": within(proof.get("settledAt")),
                      "firstAttemptInWindow": first_in_window, "purchaseIds": [proof["id"]],
                      "intentId": proof.get("intentId"), "groupIds": [group_id], "sourceIds": proof.get("sourceIds", []),
                      "observations": [proof_value], "amountConflict": False, "feeConflict": False, "sharedIntentProof": False}
                if txkey in transactions_by_key:
                    retained = transactions_by_key[txkey]
                    same_time = (not retained["settledAt"] or not tx["settledAt"] or
                                 clock(retained["settledAt"])["epoch"] == clock(tx["settledAt"])["epoch"])
                    if any(retained[k] != tx[k] for k in ("asset", "amountAtomic")) or not same_time:
                        reason("TRANSACTION_CONFLICT", "A canonical transaction has conflicting original amount, asset or time; its unresolved quantity is not aggregated.")
                        retained["amountConflict"] = True
                        retained["amountAtomic"] = None
                    if not retained["settledAt"] and tx["settledAt"]:
                        retained["settledAt"] = tx["settledAt"]
                        retained["settlesInWindow"] = tx["settlesInWindow"]
                    if tx["feesAtomic"] is not None and not retained["feeConflict"]:
                        if retained["feesAtomic"] is not None and retained["feesAtomic"] != tx["feesAtomic"]:
                            retained["feeConflict"] = True
                            retained["feesAtomic"] = None
                            issue("TRANSACTION_FEE_CONFLICT", "The original transaction has differing fee observations; its fee remains unresolved.", proof["transactionHash"], False)
                        elif retained["feesAtomic"] is None:
                            retained["feesAtomic"] = tx["feesAtomic"]
                    retained["purchaseIds"] = sorted(set(retained["purchaseIds"] + tx["purchaseIds"]))
                    retained["groupIds"] = sorted(set(retained["groupIds"] + tx["groupIds"]))
                    retained["sourceIds"] = sorted(set(retained["sourceIds"] + tx["sourceIds"]))
                    retained["observations"].append(proof_value)
                    retained["sharedIntentProof"] = len(retained["groupIds"]) > 1
                    retained["firstAttemptInWindow"] = retained["firstAttemptInWindow"] or first_in_window
                else:
                    transactions_by_key[txkey] = tx
        attempted = any(x.get("paymentAttempted") or x.get("attemptStatus") == "ATTEMPTED" for x in observed_history)
        approved = any(x.get("intentId") for x in observed_history)
        settled = any(x.get("settlementStatus") == "SETTLED" and (not x.get("settledAt") or observed(x["settledAt"])) for x in observed_history)
        current_settled = any(x.get("settlementStatus") == "SETTLED" for x in current_rows)
        current_completions = [x for x in completions if x["current"]]
        in_window_completions = [x for x in current_completions if x["inWindow"]]
        independent_completions = [x for x in in_window_completions if x["independent"] and not group_reasons]
        orders = {x.get("orderStatus", "NOT_APPLICABLE") for x in current_rows}
        if settled and not current_completions:
            reason("SETTLED_INCOMPLETE", "The original settled intent has incomplete output, order evidence or completion clocks.")
        if len({x["binding"]["operationId"] for x in members if x["binding"] and x["binding"]["operationId"]}) > 1:
            reason("OPERATION_JOIN_CONFLICT", "The same intent is associated with different reviewed useful operations.")
            independent_completions = []
        result = {"id": group_id, "intentId": originals[0].get("intentId") or None,
                  "network": originals[0]["network"], "buyerOperatorId": members[0]["buyerOperatorId"],
                  "purchaseIds": [x["purchaseId"] for x in members], "firstAttemptAt": first_at,
                  "inWindow": first_in_window, "unplaced": first_at is None,
                  "approved": approved, "attempted": attempted, "settled": settled, "currentSettlementConfirmed": current_settled,
                  "laterFirstAttemptAnchors": later_anchors,
                  "completeInWindow": bool(first_in_window and in_window_completions),
                  "independentCompleteInWindow": bool(first_in_window and independent_completions),
                  "grossCompleteInWindow": bool(first_in_window and any(x["inWindow"] for x in completions)),
                  "laterCompletion": bool(first_in_window and any(not x["inWindow"] for x in completions)),
                  "cancelledBeforePayment": not attempted and any(x.get("attemptStatus") == "CANCELLED" for x in current_rows),
                  "cancelledAfterSettlement": settled and "CANCELLED" in orders,
                  "refundedAfterSettlement": settled and "REFUNDED" in orders,
                  "ordered": bool(orders - {"NOT_APPLICABLE"}),
                  "fulfilled": "FULFILLED" in orders,
                  "teamOperated": any(x.get("participantClass") == "TEAM_OPERATED" for x in originals),
                  "completedAt": min((x["completedAt"] for x in in_window_completions), key=lambda x: clock(x)["epoch"], default=None),
                  "completions": completions, "issues": group_reasons}
        intent_views.append(result)
    original_intents = {x["id"]: x for x in intent_views}
    for tx in transactions_by_key.values():
        if tx["sharedIntentProof"]:
            for ident in tx["groupIds"]:
                item = original_intents[ident]
                item["independentCompleteInWindow"] = False
                if "TRANSACTION_ALLOCATION_REVIEW_REQUIRED" not in item["issues"]:
                    item["issues"].append("TRANSACTION_ALLOCATION_REVIEW_REQUIRED")
                issue("TRANSACTION_ALLOCATION_REVIEW_REQUIRED",
                      "This transaction proof is attached to distinct intents. Retain its actual Stellar payment-operation allocation before crediting independent completions; a transaction may contain multiple operations.",
                      ident, False)
    population = [x for x in intent_views if x["inWindow"]]
    if any(x["unplaced"] for x in intent_views):
        issue("UNPLACED_INTENTS", "Selected original intents with missing attempt clocks remain outside the placed denominator and require explicit source recovery.")
    hard_source_issues = {"FIRST_ATTEMPT_DISAGREEMENT", "INTENT_UNKNOWN", "COMPLETION_CLOCK_CONFLICT", "TRANSACTION_CONFLICT", "OPERATION_JOIN_CONFLICT", "TRANSACTION_ALLOCATION_REVIEW_REQUIRED"}
    if any(hard_source_issues.intersection(x["issues"]) for x in population):
        issue("COHORT_SOURCE_EXCEPTIONS", "The placed cohort retains conflicting original identity or clock observations; reconcile those sources while preserving every attempt.")
    def metrics(values):
        def n(field): return sum(bool(x[field]) for x in values)
        approved, attempted, completed = n("approved"), n("attempted"), n("completeInWindow")
        ordered = n("ordered")
        return {"intents": len(values), "approved": approved, "attempted": attempted, "complete": completed,
                "grossComplete": n("grossCompleteInWindow"), "settledIncomplete": sum(x["settled"] and not x["completeInWindow"] for x in values),
                "attemptedUnsettled": sum(x["attempted"] and not x["settled"] for x in values),
                "cancelledBeforePayment": n("cancelledBeforePayment"), "cancelledAfterSettlement": n("cancelledAfterSettlement"),
                "refundedAfterSettlement": n("refundedAfterSettlement"), "unsignedNoPayment": sum(not x["attempted"] for x in values),
                "laterCompletions": n("laterCompletion"), "ordered": ordered, "fulfilled": n("fulfilled"),
                "completionRate": ratio(completed, attempted), "attemptRate": ratio(attempted, approved),
                "fulfilledRate": ratio(n("fulfilled"), ordered)}
    independent = [x for x in population if x["independentCompleteInWindow"]]
    external_population = [x for x in population if not x["teamOperated"] and x["buyerOperatorId"] in
                           {available["deployments"][i]["operatorId"] for i in inputs["buyerDeploymentIds"] if external(available["deployments"][i], "BUYER")}]
    independent_metrics = metrics(external_population)
    independent_metrics["complete"] = len(independent)
    independent_metrics["completionRate"] = ratio(len(independent), independent_metrics["attempted"])
    returning = defaultdict(lambda: defaultdict(set))
    operation_facilitators = defaultdict(set)
    comparison_intents = defaultdict(set)
    buyer_ids, merchant_ids = set(), set()
    for item in independent:
        for c in item["completions"]:
            if c["current"] and c["inWindow"] and c["independent"]:
                buyer_ids.add(c["buyerOperatorId"])
                merchant_ids.add(c["merchantOperatorId"])
                returning[c["buyerOperatorId"]][item["id"]].add(clock(c["completedAt"])["day"])
                if c["facilitatorIndependent"]:
                    operation_facilitators[c["operationId"]].add(c["facilitatorOperatorId"])
                    comparison_intents[c["operationId"]].add(item["id"])
    comparisons = [{"operation": deepcopy(operations[ident]), "facilitatorOperatorIds": sorted(values),
                    "independentFacilitatorCount": len(values), "intentIds": sorted(comparison_intents[ident])}
                   for ident, values in sorted(operation_facilitators.items())]
    repeated = []
    for ident, intents in sorted(returning.items()):
        days = set().union(*intents.values())
        if len(intents) >= 2 and len(days) >= 2:
            repeated.append({"operatorId": ident, "completionDays": sorted(days), "intentIds": sorted(intents),
                             "intents": [{"id": gid, "completionDays": sorted(values)} for gid, values in sorted(intents.items())]})
    acceptance = inputs["awardAcceptance"]
    finish_day = selected_rule["target"]["proposed_window"].get("finish_no_later_than_day")
    deadline = (date.fromisoformat(acceptance["date"]) + timedelta(days=finish_day)).isoformat() if acceptance["date"] and finish_day else None
    evaluated_outcomes = []
    unique_outcomes = set()
    for x in inputs["outcomes"]:
        dep = available["deployments"][x["deploymentId"]]
        completed = observed(x["completedAt"])
        chronological = bool(x["startedAt"] and x["completedAt"] and clock(x["completedAt"])["epoch"] >= clock(x["startedAt"])["epoch"])
        duplicate = bool(x["reference"] and (x["kind"], x["reference"]) in unique_outcomes)
        unique_outcomes.add((x["kind"], x["reference"]))
        response_clocks = all(not x[k] or (x["startedAt"] and clock(x[k])["epoch"] >= clock(x["startedAt"])["epoch"]
                                              and x["completedAt"] and clock(x[k])["epoch"] <= clock(x["completedAt"])["epoch"])
                              for k in ("alertedAt", "acknowledgedAt"))
        if x["alertedAt"] and x["acknowledgedAt"] and clock(x["acknowledgedAt"])["epoch"] < clock(x["alertedAt"])["epoch"]:
            response_clocks = False
        required_response = x["kind"] not in OUTCOME_KINDS[:2] or bool(x["alertedAt"] and x["acknowledgedAt"] and x["financialOutcome"].strip())
        independent_resolver = x["kind"] != "INDEPENDENT_SUPPORT" or bool(x["operatorId"] and x["participantClass"] in EXTERNAL)
        in_tranche = bool(acceptance["date"] and supported(acceptance) and deadline and chronological
                          and clock(x["startedAt"])["day"] >= acceptance["date"]
                          and clock(x["completedAt"])["day"] <= deadline and completed)
        qualifies = bool(in_tranche and response_clocks and required_response and independent_resolver
                         and x["result"].strip() and x["reference"] and supported(x) and external(dep) and not duplicate)
        elapsed = elapsed_seconds(x["completedAt"], x["startedAt"]) if chronological else None
        evaluated_outcomes.append({**deepcopy(x), "deployment": deepcopy(dep), "elapsedSeconds": elapsed, "qualifies": qualifies,
                                   "completedInPurchaseWindow": within(x["completedAt"]), "withinAwardRelativeTranche": in_tranche,
                                   "timingScope": "Actual award acceptance through the observed cutoff and original proposed tranche deadline; purchase-window membership is separate.",
                                   "issues": ([] if qualifies else ["Retain a distinct original case, actual times, independent operating deployment and source basis."])})
    recovery = [x for x in evaluated_outcomes if x["qualifies"] and x["kind"] in OUTCOME_KINDS[:2]]
    recovery_refs = {x["reference"] for x in recovery}
    required_kinds = {x["kind"] for x in recovery}
    actual = {"external_buyer_operators": len(buyer_ids), "completed_testnet_purchases": len(independent) if inputs["tranche"] == 2 else 0,
              "completed_mainnet_purchases": len(independent) if inputs["tranche"] == 3 else 0,
              "same_operation_facilitator_operators": max((len(x) for x in operation_facilitators.values()), default=0),
              "deployed_recovery_cases": len(recovery_refs) if set(OUTCOME_KINDS[:2]) <= required_kinds else 0,
              "external_mainnet_merchant_operators": len({available["deployments"][i]["operatorId"] for i in inputs["merchantDeploymentIds"] if external(available["deployments"][i], "MERCHANT")}) if inputs["tranche"] == 3 else 0,
              "repeat_external_buyer_operators": len(repeated),
              "original_state_restore_and_cutover": sum(x["qualifies"] and x["kind"] == "RESTORE_CUTOVER" for x in evaluated_outcomes),
              "independent_operator_support_case": sum(x["qualifies"] and x["kind"] == "INDEPENDENT_SUPPORT" for x in evaluated_outcomes)}
    targets = []
    for name, expected in selected_rule["target"]["target_counts"].items():
        value = actual.get(name)
        met = value is not None and value >= expected
        targets.append({"key": name, "expected": expected, "actual": value, "met": met})
        if not met:
            issue("TARGET_UNMET", "Original proposed target " + name + " requires " + str(expected) + "; observed " + ("unimplemented rule" if value is None else str(value)) + ".", name)
    parent_rows = []
    intent_by_purchase = {pid: x for x in intent_views for pid in x["purchaseIds"]}
    for x in inputs["products"]:
        members = [intent_by_purchase.get(pid) for pid in x["purchaseIds"]]
        participating = bool(members and all(v and v["inWindow"] for v in members))
        complete = bool(participating and all(v["completeInWindow"] for v in members) and x["state"] == "COMPLETE"
                        and within(x["completedAt"]) and observed(x["completedAt"]) and supported(x)
                        and all(v["completedAt"] and clock(x["completedAt"])["epoch"] >= clock(v["completedAt"])["epoch"] for v in members))
        parent_rows.append({**deepcopy(x), "inCohort": participating, "completeInWindow": complete,
                            "issues": [] if complete else ["Whole-product completion needs its explicit complete expected purchase set, source, state and actual in-window completion."]})
    txs = [transactions_by_key[k] for k in sorted(transactions_by_key)]
    amounts = {}
    for tx in txs:
        k = (tx["network"], tx["asset"])
        out = amounts.setdefault(k, {"network": k[0], "asset": k[1], "feeUnit": "stroops", "feeAsset": "native:XLM", "transactions": 0, "amountAtomic": 0,
                                    "knownFeesAtomic": 0, "unknownFeeTransactions": 0, "unresolvedAmountTransactions": 0,
                                    "cohortAmountAtomic": 0, "settledInWindowAtomic": 0})
        out["transactions"] += 1
        if tx["amountAtomic"] is None:
            out["unresolvedAmountTransactions"] += 1
        else:
            out["amountAtomic"] += int(tx["amountAtomic"])
        if tx["feesAtomic"] is None:
            out["unknownFeeTransactions"] += 1
        else:
            out["knownFeesAtomic"] += int(tx["feesAtomic"])
        if tx["firstAttemptInWindow"] and tx["amountAtomic"] is not None: out["cohortAmountAtomic"] += int(tx["amountAtomic"])
        if tx["settlesInWindow"] and tx["amountAtomic"] is not None: out["settledInWindowAtomic"] += int(tx["amountAtomic"])
    amount_rows = [{k: str(v) if k.endswith("Atomic") else v for k, v in x.items()} for _, x in sorted(amounts.items())]
    acceptance = inputs["awardAcceptance"]
    finish_day = selected_rule["target"]["proposed_window"].get("finish_no_later_than_day")
    deadline = (date.fromisoformat(acceptance["date"]) + timedelta(days=finish_day)).isoformat() if acceptance["date"] and finish_day else None
    if not acceptance["date"] or not supported(acceptance):
        issue("ACTUAL_AWARD_CLOCK_UNESTABLISHED", "The actual award-acceptance date and source remain unentered. The hypothetical planning calendar is not substituted.")
    elif end_day and deadline and end_day > deadline:
        issue("PROPOSED_FINISH_DAY_EXCEEDED", "This selected window finishes after the original proposed acceptance-relative target day.")
    if acceptance["date"] and (acceptance["date"] > cutoff["day"] or start_day and start_day < acceptance["date"]):
        issue("AWARD_WINDOW_CLOCK_CONFLICT", "The observed deployment window must follow its actual award acceptance; retain earlier engineering use separately.")
    required = inputs["requiredWork"]
    if selected_rule["target"].get("required_work") and (
            required["state"] != "COMPLETE" or not observed(required["completedAt"]) or not supported(required)
            or any(available["work"][wid]["state"] == "VOID" for wid in required["workIds"])
            or not acceptance["date"] or not deadline or not required["completedAt"]
            or not (acceptance["date"] <= clock(required["completedAt"])["day"] <= deadline)):
        issue("REQUIRED_DEPLOYED_WORK", selected_rule["target"]["required_work"])
    m = measurement(context, inputs, history)
    result = {"schema": SCHEMA, "source": {"programId": context["program"]["id"], "version": context["program"]["version"],
               "planContentSha256": context["plan"]["contentSha256"], "measurementSha256": digest(m)},
              "rule": selected_rule, "inputs": inputs,
              "window": {"start": start_day, "end": end_day, "calendarDays": duration, "requiredCalendarDays": required_days,
                         "asOfAt": inputs["asOfAt"], "closed": closed, "awardAcceptanceOn": acceptance["date"], "proposedDeadlineOn": deadline},
              "selectedDeployments": [deepcopy(available["deployments"][x]) for x in sorted(selected)],
              "observations": purchase_views, "excludedObservations": excluded, "intents": intent_views,
              "transactions": txs, "amounts": amount_rows,
              "refundCash": [{**deepcopy(available["cash"][x]), "inWindow": bool(start_day and end_day and start_day <= available["cash"][x]["date"] <= end_day),
                              "atCutoff": available["cash"][x]["date"] <= cutoff["day"]} for x in inputs["refundCashIds"]],
              "products": parent_rows, "facilitatorComparisons": comparisons, "returningBuyers": repeated,
              "outcomes": evaluated_outcomes,
              "metrics": {"allSelected": metrics(population), "independent": independent_metrics,
                          "teamOperated": metrics([x for x in population if x["teamOperated"]]),
                          "placedIntents": len(population), "unplacedIntents": sum(x["unplaced"] for x in intent_views),
                          "outsideWindowIntents": sum(not x["inWindow"] and not x["unplaced"] for x in intent_views),
                          "excludedObservations": len(excluded),
                          "parentCompletionRate": ratio(sum(x["completeInWindow"] for x in parent_rows), sum(x["inCohort"] and x["state"] in ("STARTED", "COMPLETE") for x in parent_rows))},
              "targets": targets, "issues": issues, "ready": not any(x["blocking"] for x in issues),
              "sourceIds": source_ids(context, inputs, history)}
    result["previewSha256"] = digest(result)
    return result


def summary(review, current_context=None, history=None):
    candidate = review["cohort"]
    result = {"cohortTranche": candidate["inputs"]["tranche"], "cohortName": candidate["inputs"]["name"],
              "cohortWindow": deepcopy(candidate["window"]), "cohortReady": candidate["ready"],
              "cohortMeasurementSha256": candidate["source"]["measurementSha256"],
              "cohortPreviewSha256": candidate["previewSha256"]}
    if current_context is not None:
        try:
            result["cohortSourceCurrent"] = digest(measurement(current_context, candidate["inputs"], history or [])) == candidate["source"]["measurementSha256"]
        except (KeyError, TypeError):
            result["cohortSourceCurrent"] = False
    return result


def prepare(ops, context, data, actor, next_version, history):
    obj(data, ("inputs", "expectedPreviewSha256"), "cohort preparation")
    candidate = preview(context, data.get("inputs"), history)
    if candidate["previewSha256"] != domain.sha(data.get("expectedPreviewSha256"), "Reviewed cohort preview", False):
        domain.fail("The original cohort source or review inputs changed. Preview the current case before freezing.", "COHORT_PREVIEW_CONFLICT", 409)
    if context["program"]["mode"] != "WALKTHROUGH" and clock(candidate["inputs"]["asOfAt"])["epoch"] > clock(now())["epoch"]:
        domain.fail("Freeze the actual observed cutoff; a future workload window remains a plan.", "COHORT_FUTURE_OBSERVATION", 409)
    count = ops.db.execute("SELECT COUNT(*) FROM ops_reviews WHERE program_id=?", (context["program"]["id"],)).fetchone()[0]
    if count >= MAX_REVIEWS:
        domain.fail("This case has reached its retained-review bound.", "COHORT_REVIEW_LIMIT", 413)
    snapshot = ops._business(context)
    review = {"id": "review-" + uuid.uuid4().hex, "version": next_version, "createdAt": now(), "actor": actor,
              "note": candidate["inputs"]["note"] or candidate["inputs"]["name"],
              "businessSha256": digest(snapshot), "snapshot": snapshot, "report": domain.report(**context),
              "purpose": "COHORT_EVALUATION", "cohort": candidate, "cohortHistory": deepcopy(history)}
    ops.db.execute("INSERT INTO ops_reviews VALUES(?,?,?)", (context["program"]["id"], review["id"], canonical(review)))
    return {"before": None, "after": {k: review[k] for k in ("id", "version", "businessSha256", "purpose")},
            "kind": "review", "recordId": review["id"], "unchanged": False,
            "businessSha256": review["businessSha256"], "previewSha256": candidate["previewSha256"], "cohortReady": candidate["ready"]}


def validate_review(review):
    if review.get("purpose") != "COHORT_EVALUATION":
        domain.fail("Select an original cohort evaluation.", "COHORT_REVIEW", 404)
    candidate, snapshot, history = review.get("cohort"), review.get("snapshot"), review.get("cohortHistory")
    if not isinstance(candidate, dict) or not isinstance(snapshot, dict) or not isinstance(history, list):
        domain.fail("The frozen cohort is missing its original source.", "INVALID_COHORT_REVIEW")
    if digest(snapshot) != review.get("businessSha256"):
        domain.fail("The cohort business snapshot differs.", "INVALID_COHORT_REVIEW")
    context = {**snapshot, "program": {**snapshot["program"], "version": candidate["source"]["version"]},
               "sources": {x["id"]: x for x in snapshot["sources"]}}
    if preview(context, candidate["inputs"], history) != candidate:
        domain.fail("The frozen cohort does not reproduce from its original observations.", "INVALID_COHORT_REVIEW")
    if review["version"] != candidate["source"]["version"] + 1:
        domain.fail("The cohort source version differs from its original preparation.", "INVALID_COHORT_REVIEW")


def validate_import(reviews, events):
    cohort_ids = set()
    for review in reviews:
        if review.get("purpose") != "COHORT_EVALUATION":
            continue
        validate_review(review)
        cohort_ids.add(review["id"])
        event = events[review["version"] - 1]
        if event.get("action") != "cohort.prepare" or event.get("recordId") != review["id"] or event.get("after", {}).get("businessSha256") != review["businessSha256"]:
            domain.fail("The cohort review lacks its original preparation event.", "INVALID_COHORT_REVIEW")
        if history_from_events(events[:review["version"] - 1]) != review["cohortHistory"]:
            domain.fail("The cohort purchase observations differ from their original history.", "INVALID_COHORT_REVIEW")
    if {x.get("recordId") for x in events if x.get("action") == "cohort.prepare"} != cohort_ids:
        domain.fail("The complete case is missing an original cohort review.", "INVALID_COHORT_REVIEW")


def completion_evidence(context, reviews, tranche, as_of, history=None):
    items, issues = [], []
    for review in reviews:
        validate_review(review)
        candidate = review["cohort"]
        current = digest(measurement(context, candidate["inputs"], history or [])) == candidate["source"]["measurementSha256"]
        item = {"reviewId": review["id"], "previewSha256": candidate["previewSha256"], "measurementSha256": candidate["source"]["measurementSha256"],
                "tranche": candidate["inputs"]["tranche"], "sourceCurrent": current, "ready": candidate["ready"], "review": deepcopy(review)}
        items.append(item)
        messages = []
        if not current: messages.append("The original measurement source changed after this cohort review.")
        if candidate["inputs"]["tranche"] != tranche: messages.append("The cohort belongs to another tranche.")
        if clock(candidate["inputs"]["asOfAt"])["day"] > as_of: messages.append("The cohort observation cutoff is later than this completion preparation.")
        if not candidate["ready"]: messages.append("The selected cohort retains unmet targets or source/coverage findings.")
        for message in messages:
            issues.append({"code": "COHORT_EVIDENCE", "costId": None, "reviewId": review["id"], "message": message})
    return items, issues


def file_map(review, read_source):
    validate_review(review)
    c = review["cohort"]
    e = lambda value: html.escape(str(value if value is not None else ""), quote=True)
    tables = []
    def table(title, columns, values):
        header = "".join("<th>" + e(label) + "</th>" for _, label in columns)
        body = "".join("<tr>" + "".join("<td>" + e(row.get(key)) + "</td>" for key, _ in columns) + "</tr>" for row in values)
        return "<h2>" + e(title) + "</h2><table><thead><tr>" + header + "</tr></thead><tbody>" + body + "</tbody></table>"
    metric_rows = []
    for scope in ("allSelected", "independent", "teamOperated"):
        for name, value in c["metrics"][scope].items():
            metric_rows.append({"scope": scope, "metric": name, "count": None if isinstance(value, dict) else value,
                                **(value if isinstance(value, dict) else {})})
    for name in ("placedIntents", "unplacedIntents", "outsideWindowIntents", "excludedObservations", "parentCompletionRate"):
        value = c["metrics"][name]
        metric_rows.append({"scope": "coverage", "metric": name, "count": None if isinstance(value, dict) else value,
                            **(value if isinstance(value, dict) else {})})
    tables.append(table("Original proposed targets", (("key", "Target"), ("expected", "Required"), ("actual", "Observed"), ("met", "Met")), c["targets"]))
    tables.append(table("Reporting populations and denominators", (("scope", "Population"), ("metric", "Measure"), ("count", "Count"),
                        ("numerator", "Numerator"), ("denominator", "Denominator"), ("percentage", "Percent")), metric_rows))
    tables.append(table("Original selected operators", (("id", "Deployment"), ("name", "Name"), ("operatorId", "Accountable operator"),
                        ("role", "Role"), ("participantClass", "Participation"), ("environment", "Environment"), ("state", "Current original state")), c["selectedDeployments"]))
    tables.append(table("First-attempt intents", (("intentId", "Original intent"), ("firstAttemptAt", "First attempt"), ("inWindow", "In window"),
                        ("attempted", "Attempted"), ("completeInWindow", "Complete"), ("independentCompleteInWindow", "Independent useful completion"),
                        ("grossCompleteInWindow", "Gross complete"), ("refundedAfterSettlement", "Refunded"), ("issues", "Findings")), c["intents"]))
    tables.append(table("Exact quantities", (("network", "Network"), ("asset", "Asset"), ("transactions", "Transactions"),
                        ("amountAtomic", "Atomic amount"), ("knownFeesAtomic", "Known fee stroops"), ("unknownFeeTransactions", "Unknown fees")), c["amounts"]))
    tables.append(table("Preserved findings", (("code", "Finding"), ("message", "Observation"), ("id", "Original identity")), c["issues"]))
    page = '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>' + e(c["inputs"]["name"]) + '</title><style>body{font:16px system-ui;max-width:1200px;margin:2rem auto;padding:0 1rem;color:#222}table{width:100%;border-collapse:collapse;font-size:.85rem}th,td{border:1px solid #bbb;padding:.5rem;text-align:left;vertical-align:top;overflow-wrap:anywhere}p,td{white-space:pre-wrap}small{color:#555}</style><h1>' + e(c["inputs"]["name"]) + '</h1><p>' + e(review["snapshot"]["program"]["name"]) + " · " + e(review["snapshot"]["program"]["mode"]) + '</p><p>' + e(c["window"]["start"]) + " through " + e(c["window"]["end"]) + " UTC · observed through " + e(c["window"]["asOfAt"]) + '</p><p>' + e(c["rule"]["relationToBudget"]) + '</p><p>' + ("The reviewed proposed targets and source coverage are met." if c["ready"] else "The review retains unmet targets or incomplete source coverage.") + '</p>' + "".join(tables) + '<p>Complete original observations, raw source metadata, selected associations, history, outcomes and reporting denominators are retained in cohort.json and the companion CSV files. Original feesStroops values are native-XLM stroops, separately labeled from each payment asset.</p><small>' + e(review["id"]) + " · " + e(review["createdAt"]) + " · " + e(c["source"]["measurementSha256"]) + "</small></html>"
    files = {"cohort.json": (canonical(review) + "\n").encode(), "cohort.html": page.encode()}
    for name, columns, values in (
        ("metrics", ["scope", "metric", "count", "numerator", "denominator", "percentage"], metric_rows),
        ("deployments", ["id", "name", "operator", "operatorId", "role", "participantClass", "environment", "state", "endpoint", "releaseRef", "caseRef", "acceptedBy", "acceptedAt", "sourceIds", "sourceNote"], c["selectedDeployments"]),
        ("operations", ["id", "label", "merchantDeploymentId", "scope", "expectedOutput", "sourceIds", "sourceNote"], c["inputs"]["operations"]),
        ("facilitators", ["id", "name", "operatorId", "serviceUrl", "participantClass", "sourceIds", "sourceNote"], c["inputs"]["facilitators"]),
        ("facilitator-comparisons", ["operation", "facilitatorOperatorIds", "intentIds"], c["facilitatorComparisons"]),
        ("returning-buyers", ["operatorId", "intentIds", "completionDays", "intents"], c["returningBuyers"]),
        ("intents", ["id", "intentId", "network", "buyerOperatorId", "purchaseIds", "firstAttemptAt", "laterFirstAttemptAnchors", "inWindow", "approved", "attempted", "settled", "currentSettlementConfirmed",
                     "completeInWindow", "independentCompleteInWindow", "grossCompleteInWindow", "laterCompletion", "cancelledBeforePayment",
                     "cancelledAfterSettlement", "refundedAfterSettlement", "ordered", "fulfilled", "teamOperated", "issues"], c["intents"]),
        ("transactions", ["network", "asset", "transactionHash", "amountAtomic", "feesAtomic", "settledAt", "settlesInWindow", "firstAttemptInWindow", "purchaseIds", "intentId", "groupIds", "sharedIntentProof", "observations", "amountConflict", "feeConflict"], c["transactions"]),
        ("amounts", ["network", "asset", "transactions", "amountAtomic", "feeUnit", "feeAsset", "knownFeesAtomic", "unknownFeeTransactions", "unresolvedAmountTransactions", "cohortAmountAtomic", "settledInWindowAtomic"], c["amounts"]),
        ("targets", ["key", "expected", "actual", "met"], c["targets"]),
        ("outcomes", ["id", "kind", "deploymentId", "reference", "startedAt", "alertedAt", "acknowledgedAt", "completedAt", "elapsedSeconds", "activeMinutes", "operatorId", "participantClass", "result", "financialOutcome", "withinAwardRelativeTranche", "completedInPurchaseWindow", "timingScope", "qualifies", "issues"], c["outcomes"]),
        ("refunds", ["id", "state", "direction", "date", "currency", "network", "asset", "amount", "usdValue", "externalRef", "inWindow", "atCutoff"], c["refundCash"]),
        ("products", ["id", "label", "purchaseIds", "state", "completedAt", "inCohort", "completeInWindow", "issues"], c["products"]),
        ("findings", ["code", "message", "id", "blocking"], c["issues"])):
        clean = [{k: canonical(v) if isinstance(v, (dict, list)) else v for k, v in row.items()} for row in values]
        files[name + ".csv"] = csv_bytes(columns, clean)
    retained = {x["id"]: x for x in review["snapshot"]["sources"]}
    for ident in c["sourceIds"]:
        metadata, raw = read_source(ident)
        if metadata["sha256"] != retained[ident]["sha256"] or len(raw) != retained[ident]["bytes"] or hashlib.sha256(raw).hexdigest() != retained[ident]["sha256"]:
            domain.fail("The original cohort source bytes differ.", "COHORT_SOURCE_CONFLICT", 409)
        files["sources/" + ident] = raw
    return files


def review_files(review, read_source):
    files = file_map(review, read_source)
    if sum(len(x) for x in files.values()) > MAX_BUNDLE:
        domain.fail("The complete cohort export exceeds the original archive bound.", "COHORT_EXPORT_LIMIT", 413)
    manifest = {"schema": "stellar-forge.sf47-cohort-files.v1", "reviewId": review["id"],
                "files": [{"path": name, "bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest()} for name, raw in sorted(files.items())]}
    files["MANIFEST.json"] = (canonical(manifest) + "\n").encode()
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
        for name, raw in sorted(files.items()):
            entry = zipfile.ZipInfo(name, (2026, 1, 1, 0, 0, 0))
            entry.external_attr = 0o600 << 16
            entry.compress_type = zipfile.ZIP_DEFLATED
            archive.writestr(entry, raw)
    return output.getvalue()
