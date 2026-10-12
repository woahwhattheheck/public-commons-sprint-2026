"""Business record validation and plan-versus-actual reporting for SF47."""
from __future__ import annotations

from collections import defaultdict
from copy import deepcopy
from datetime import date, datetime
from decimal import Decimal, ROUND_HALF_UP
import re
from urllib.parse import urlsplit

from model import Problem, text, canonical, digest, now

KINDS = ("contributors", "work", "invoices", "cash", "awards", "deployments", "purchases", "outcomes")
PREFIX = {"contributors": "person", "work": "work", "invoices": "invoice", "cash": "cash",
          "awards": "award", "deployments": "deployment", "purchases": "purchase", "outcomes": "outcome"}
ZERO = Decimal("0")
CENT = Decimal("0.01")


def fail(message, code="INVALID_OPERATIONS", status=422):
    raise Problem(message, status, code)


def decimal(value, label, places=7, positive=False):
    if isinstance(value, bool) or value is None:
        fail(label + ": enter a decimal amount.")
    try:
        result = Decimal(str(value))
    except Exception:
        fail(label + ": enter a decimal amount.")
    if not result.is_finite() or result < 0 or result > Decimal("1000000000000"):
        fail(label + ": enter a finite nonnegative amount within the supported limit.")
    if positive and result == 0:
        fail(label + ": enter an amount greater than zero.")
    if result != result.quantize(Decimal(1).scaleb(-places)):
        fail(label + ": use no more than " + str(places) + " decimal places.")
    return result


def usd(value, label="USD amount", positive=False):
    return format(decimal(value, label, 2, positive), ".2f")


def quantity(value, label="Quantity", places=7, positive=False):
    result = format(decimal(value, label, places, positive), "f")
    return result.rstrip("0").rstrip(".") if "." in result else result


def integer(value, label, minimum=0, maximum=10**12, optional=False):
    if optional and value in (None, ""):
        return None
    if isinstance(value, bool) or not isinstance(value, int) or not minimum <= value <= maximum:
        fail(label + ": enter a whole number from " + str(minimum) + " through " + str(maximum) + ".")
    return value


def enum(value, choices, label):
    if value not in choices:
        fail(label + ": choose " + ", ".join(choices) + ".")
    return value


def calendar(value, label, optional=False):
    if optional and value in (None, ""):
        return None
    if not isinstance(value, str):
        fail(label + ": use an ISO calendar date.")
    try:
        result = date.fromisoformat(value)
    except ValueError:
        fail(label + ": use YYYY-MM-DD.")
    if result.isoformat() != value:
        fail(label + ": use YYYY-MM-DD.")
    return value


def timestamp(value, label, optional=False):
    if optional and value in (None, ""):
        return None
    if not isinstance(value, str):
        fail(label + ": use an ISO timestamp with timezone.")
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        fail(label + ": use an ISO timestamp with timezone.")
    if parsed.tzinfo is None:
        fail(label + ": include its original timezone.")
    return value


def url(value, label, optional=True):
    value = text(value or "", label, 4000)
    if not value and optional:
        return ""
    parsed = urlsplit(value)
    if parsed.scheme not in ("http", "https") or not parsed.hostname or parsed.username or parsed.password:
        fail(label + ": use an HTTP(S) URL without embedded credentials.")
    return value


def sha(value, label, optional=True):
    value = value or ""
    if not value and optional:
        return ""
    if not isinstance(value, str) or not re.fullmatch(r"[a-fA-F0-9]{64}", value):
        fail(label + ": use a complete SHA-256 or transaction hash.")
    return value.lower()


def reference_list(value, available, label, maximum=200):
    if not isinstance(value, list) or len(value) > maximum or any(not isinstance(item, str) for item in value) or len(value) != len(set(value)):
        fail(label + ": use distinct retained record IDs.")
    if any(not isinstance(item, str) or item not in available for item in value):
        fail(label + ": a selected retained record is unavailable.")
    return value


def cost_id(value, plan):
    if value in (None, ""):
        return None
    if value not in {row["id"] for row in plan["scenario"]["future_costs"]}:
        fail("Select an original work-package ID from the pinned plan.")
    return value


def source_fields(data, sources):
    ids = reference_list(data.get("sourceIds", []), sources, "Sources")
    note = text(data.get("sourceNote", ""), "Source reference", 12000)
    return {"sourceIds": ids, "sourceNote": note,
            "sourceBasis": "ATTACHED_SOURCE" if ids else "OPERATOR_ENTRY"}


def prepare(kind, data, context, previous=None):
    if not isinstance(data, dict):
        fail("Record data must be an object.")
    plan, records, sources = context["plan"], context["records"], context["sources"]
    maps = {key: {row["id"]: row for row in records[key]} for key in KINDS}
    previous = previous or {}
    restoring = bool(context.get("restoring"))
    source = source_fields(data, sources)
    state = previous.get("state")
    if kind == "contributors":
        return {"name": text(data.get("name"), "Contributor name", 300, True),
                "kind": enum(data.get("kind", "PERSON"), ("PERSON", "ORGANIZATION", "TEAM", "ROLE"), "Contributor kind"),
                "contact": text(data.get("contact", ""), "Contact", 1000),
                "note": text(data.get("note", ""), "Contributor note", 12000), "state": "ACTIVE", **source}

    if kind == "work":
        if state and state != "LOGGED" and not restoring:
            fail("Reopen this work record before changing its recorded work.")
        contributor = data.get("contributorId")
        if contributor not in maps["contributors"]:
            fail("Select a retained contributor.")
        start, end = calendar(data.get("startDate"), "Work start"), calendar(data.get("endDate"), "Work end")
        if end < start:
            fail("Work end must not precede its start.")
        return {"contributorId": contributor, "costId": cost_id(data.get("costId"), plan),
                "description": text(data.get("description"), "Completed work", 12000, True),
                "startDate": start, "endDate": end, "hours": quantity(data.get("hours"), "Recorded hours", 4, True),
                "fundingBasis": enum(data.get("fundingBasis", "PREAWARD"),
                                    ("PREAWARD", "GRANT", "CUSTOMER", "INTERNAL"), "Work funding basis"),
                "state": "LOGGED", **source}

    if kind == "invoices":
        if state and state != "RECEIVED" and not restoring:
            fail("Reopen this invoice before changing its source or amount.")
        contributor = data.get("contributorId")
        if contributor not in maps["contributors"]:
            fail("Select the invoice's retained contributor or supplier.")
        number = text(data.get("number"), "Invoice number", 200, True)
        for row in records["invoices"]:
            if row["id"] != previous.get("id") and row["contributorId"] == contributor and row["number"] == number:
                fail("This contributor's invoice number is already retained.", "DUPLICATE_INVOICE", 409)
        issued = calendar(data.get("issuedDate"), "Invoice date")
        due = calendar(data.get("dueDate"), "Due date", True)
        if due and due < issued:
            fail("Invoice due date must not precede its issue date.")
        if not isinstance(data.get("lines"), list) or not 1 <= len(data["lines"]) <= 200:
            fail("An invoice needs one through 200 lines.")
        lines, seen = [], set()
        for index, item in enumerate(data["lines"], 1):
            if not isinstance(item, dict):
                fail("Invoice lines must be objects.")
            ident = text(item.get("id") or "line-" + str(index), "Invoice line ID", 100, True)
            if ident in seen:
                fail("Invoice line IDs must be distinct.")
            seen.add(ident)
            work_ids = reference_list(item.get("workIds", []), maps["work"], "Invoice work")
            if any(maps["work"][wid]["contributorId"] != contributor for wid in work_ids):
                fail("Invoice work must belong to its contributor.")
            lines.append({"id": ident, "costId": cost_id(item.get("costId"), plan),
                          "description": text(item.get("description"), "Invoice line", 12000, True),
                          "amountUsd": usd(item.get("amountUsd"), "Invoice line amount", True), "workIds": work_ids})
        return {"contributorId": contributor, "number": number, "issuedDate": issued, "dueDate": due,
                "currency": "USD", "lines": lines, "totalUsd": usd(sum(Decimal(row["amountUsd"]) for row in lines)),
                "state": "RECEIVED", **source}

    if kind == "cash":
        if previous and not restoring:
            fail("Cash observations are immutable. Void an erroneous entry and record its correction.")
        currency = text(data.get("currency", "USD"), "Currency or asset symbol", 40, True).upper()
        network = text(data.get("network", ""), "Original network", 200)
        asset = text(data.get("asset", ""), "Original asset", 500)
        amount = quantity(data.get("amount"), "Observed asset quantity", 12, True)
        if currency == "USD":
            value = usd(amount, "Observed USD amount", True)
        else:
            value = None if data.get("usdValue") in (None, "") else usd(data["usdValue"], "Recorded USD valuation", True)
        valuation = reference_list(data.get("valuationSourceIds", []), sources, "Valuation sources")
        direction = enum(data.get("direction"), ("IN", "OUT"), "Cash direction")
        category = enum(data.get("category"), ("GRANT", "INVOICE", "CUSTOMER", "CAPITAL", "REFUND", "OTHER"), "Cash category")
        if category == "GRANT" and direction != "IN":
            fail("An observed grant receipt is an inflow; use REFUND for an actual returned amount.")
        reference = text(data.get("externalRef"), "Original payment reference", 1000, True)
        key = digest({"network": network, "asset": asset or currency, "reference": reference.lower() if re.fullmatch(r"[a-fA-F0-9]{64}", reference) else reference})
        if not (restoring and state == "VOID") and any(row.get("referenceKey") == key and row["state"] != "VOID" and row["id"] != previous.get("id") for row in records["cash"]):
            fail("That original payment identity is already recorded.", "DUPLICATE_CASH", 409)
        allocations = data.get("allocations", [])
        if not isinstance(allocations, list) or len(allocations) > 200:
            fail("Use invoice allocation rows.")
        prepared, used = [], set()
        for item in allocations:
            invoice = item.get("invoiceId") if isinstance(item, dict) else None
            if invoice not in maps["invoices"] or invoice in used:
                fail("Choose distinct retained invoices for a payment allocation.")
            used.add(invoice)
            prepared.append({"invoiceId": invoice, "amountUsd": usd(item.get("amountUsd"), "Invoice payment allocation", True)})
        total = sum((Decimal(row["amountUsd"]) for row in prepared), ZERO)
        if prepared and (value is None or total > Decimal(value)):
            fail("Invoice allocations need a recorded USD value and must not exceed that value.")
        if prepared and not (direction == "OUT" or category == "REFUND"):
            fail("Use an outflow for an invoice payment or an actual refund inflow.")
        return {"direction": direction, "category": category, "date": calendar(data.get("date"), "Cash date"),
                "currency": currency, "network": network, "asset": asset, "amount": amount, "usdValue": value,
                "valuationSourceIds": valuation, "valuationNote": text(data.get("valuationNote", ""), "Valuation basis", 4000),
                "externalRef": reference, "referenceKey": key,
                "tranche": integer(data.get("tranche"), "Receipt tranche", 0, 3, True),
                "allocations": prepared, "state": "OBSERVED", **source}

    if kind == "awards":
        return {"stage": enum(data.get("stage"), ("INTEREST_ACKNOWLEDGED", "INVITED", "SUBMITTED", "AWARDED", "DECLINED", "WITHDRAWN"), "Application stage"),
                "reference": text(data.get("reference"), "Original issuer reference", 1000, True),
                "date": calendar(data.get("date"), "Source date"),
                "amountUsd": None if data.get("amountUsd") in (None, "") else usd(data["amountUsd"], "Award agreement amount", True),
                "state": "RECORDED", **source}

    if kind == "deployments":
        costs = data.get("costIds", [])
        if not isinstance(costs, list) or any(not isinstance(item, str) for item in costs) or len(costs) != len(set(costs)) or len(costs) > 200:
            fail("Use distinct pinned cost IDs.")
        for item in costs:
            cost_id(item, plan)
        state = enum(data.get("state", "PLANNED"), ("PLANNED", "INSTALLED", "OPERATING", "HANDED_OVER", "RETIRED"), "Deployment state")
        participant = enum(data.get("participantClass", "TEAM_OPERATED"),
                           ("TEAM_OPERATED", "INDEPENDENT_OPERATOR", "CUSTOMER"), "Accountable participant")
        accepted_by = text(data.get("acceptedBy", ""), "Receiving operator", 300)
        accepted_at = calendar(data.get("acceptedAt"), "Handover date", True)
        if state == "HANDED_OVER" and (not accepted_by or not accepted_at):
            fail("Record the receiving operator and actual handover date.")
        return {"name": text(data.get("name"), "Deployment name", 500, True),
                "operator": text(data.get("operator"), "Accountable operator", 500, True),
                "operatorId": text(data.get("operatorId") or data.get("operator"), "Accountable operator identity", 500, True),
                "role": enum(data.get("role", "MERCHANT"), ("MERCHANT", "BUYER", "BOTH"), "Deployment role"),
                "participantClass": participant,
                "environment": enum(data.get("environment", "LOCAL"), ("LOCAL", "TESTNET", "MAINNET", "OTHER"), "Deployment environment"),
                "state": state, "costIds": costs, "tranche": integer(data.get("tranche"), "Deployment tranche", 1, 3, True),
                "endpoint": url(data.get("endpoint", ""), "Native endpoint"),
                "releaseRef": text(data.get("releaseRef", ""), "Original release/source identity", 4000),
                "caseRef": text(data.get("caseRef", ""), "Original merchant case/workorder", 4000),
                "acceptedBy": accepted_by, "acceptedAt": accepted_at, **source}

    if kind == "purchases":
        if previous.get("state") == "VOID" and not restoring:
            fail("A void purchase observation is retained in history. Record a corrected original observation.")
        dep = maps["deployments"].get(data.get("deploymentId"))
        if not dep:
            fail("Select the original deployment.")
        tx = sha(data.get("transactionHash"), "Original transaction hash")
        network = text(data.get("network"), "Original network", 200, True)
        observation = timestamp(data.get("observedAt"), "Observation time")
        # Same transaction has one retained purchase observation; a recovery is
        # an explicit observation of its original intent, never another charge.
        if tx and not (restoring and state == "VOID") and any(row.get("network") == network and row.get("transactionHash") == tx and row["state"] != "VOID" and row["id"] != previous.get("id") for row in records["purchases"]):
            fail("This original transaction is already retained. Its existing intent and observation remain available.", "DUPLICATE_PURCHASE", 409)
        atomic = data.get("amountStroops", "0")
        atomic = str(atomic)
        if not re.fullmatch(r"[0-9]{1,30}", atomic):
            fail("Retain the exact nonnegative integer stroop amount.")
        stage = enum(data.get("settlementStatus", "UNKNOWN"), ("UNKNOWN", "PENDING", "SETTLED", "FAILED"), "Native settlement state")
        if stage == "SETTLED" and (not tx or int(atomic) <= 0):
            fail("A recorded settled transfer needs its original transaction and positive atomic amount.")
        result = {"deploymentId": dep["id"], "network": network, "asset": text(data.get("asset", "native"), "Original paid asset", 500, True),
                "transactionHash": tx, "ledger": integer(data.get("ledger"), "Native ledger", 0, 10**12, True),
                "amountStroops": str(int(atomic)), "feesStroops": quantity(data["feesStroops"], "Native fees", 0) if data.get("feesStroops") not in (None, "") else None,
                "deliveredBytes": integer(data.get("deliveredBytes"), "Delivered bytes", 0, 10**15, True),
                "deliveredSha256": sha(data.get("deliveredSha256"), "Delivered output SHA-256"),
                "intentId": text(data.get("intentId", ""), "Original approved intent", 500),
                "operationId": text(data.get("operationId", ""), "Original merchant operation", 500),
                "requestId": text(data.get("requestId", ""), "Original request", 500),
                "reservationId": text(data.get("reservationId", ""), "Original reservation", 500),
                "merchantEventId": text(data.get("merchantEventId", ""), "Original merchant event", 500),
                "recipient": text(data.get("recipient", ""), "Original recipient", 500),
                "acceptedTermsSha256": sha(data.get("acceptedTermsSha256"), "Accepted terms SHA-256"),
                "attemptStatus": enum(data.get("attemptStatus", "ATTEMPTED"), ("APPROVED", "ATTEMPTED", "NOT_ATTEMPTED", "CANCELLED"), "Attempt state"),
                "settlementStatus": stage,
                "outputStatus": enum(data.get("outputStatus", "UNKNOWN"), ("UNKNOWN", "PARTIAL", "COMPLETE", "FAILED"), "Original output state"),
                "orderStatus": enum(data.get("orderStatus", "NOT_APPLICABLE"), ("NOT_APPLICABLE", "PENDING", "FULFILLED", "CANCELLED", "REFUNDED"), "Original order state"),
                "origin": enum(data.get("origin", "OPERATOR_ENTRY"), ("NATIVE", "RECOVERED", "SOURCE_SUMMARY", "OPERATOR_ENTRY"), "Observation origin"),
                "observedAt": observation, "firstAttemptAt": timestamp(data.get("firstAttemptAt"), "Original first attempt", True),
                "settledAt": timestamp(data.get("settledAt"), "Original settlement time", True),
                "outputCompletedAt": timestamp(data.get("outputCompletedAt"), "Original output completion", True),
                "state": "RECORDED", **source}
        explicit_attempt = data.get("paymentAttempted", False)
        if not isinstance(explicit_attempt, bool):
            fail("Original payment-attempt status must be a boolean.")
        result["paymentAttempted"] = bool(previous.get("paymentAttempted") or explicit_attempt
                                          or result["attemptStatus"] == "ATTEMPTED")
        result["participantClass"] = enum(previous.get("participantClass", dep["participantClass"]),
            ("TEAM_OPERATED", "INDEPENDENT_OPERATOR", "CUSTOMER"), "Original purchase participation")
        result["operatorId"] = text(previous.get("operatorId", dep["operatorId"]), "Original accountable operator identity", 500, True)
        result["deploymentEnvironment"] = enum(previous.get("deploymentEnvironment", dep["environment"]),
            ("LOCAL", "TESTNET", "MAINNET", "OTHER"), "Original deployment environment")
        if previous and not restoring:
            if datetime.fromisoformat(observation.replace("Z", "+00:00")) < datetime.fromisoformat(previous["observedAt"].replace("Z", "+00:00")):
                fail("A later observation must retain its actual later observation time.")
            anchors = ("deploymentId", "network", "asset", "transactionHash", "intentId", "operationId",
                       "requestId", "reservationId", "recipient", "acceptedTermsSha256", "firstAttemptAt")
            for key in anchors:
                if previous.get(key) not in (None, "") and result[key] != previous[key]:
                    fail("A later observation must preserve its original " + key + ".", "PURCHASE_IDENTITY_CONFLICT", 409)
            if int(previous["amountStroops"]) > 0 and result["amountStroops"] != previous["amountStroops"]:
                fail("A later observation must preserve its original paid atomic amount.", "PURCHASE_IDENTITY_CONFLICT", 409)
        return result

    if kind == "outcomes":
        return {"tranche": integer(data.get("tranche"), "Outcome tranche", 1, 3),
                "state": enum(data.get("state"), ("IN_PROGRESS", "SUBMITTED", "ACCEPTED", "CHANGES_REQUESTED", "WITHDRAWN"), "External tranche outcome"),
                "description": text(data.get("description"), "Recorded outcome", 12000, True),
                "deploymentIds": reference_list(data.get("deploymentIds", []), maps["deployments"], "Outcome deployments"),
                "date": calendar(data.get("date"), "Outcome source date"), **source}
    fail("Unknown operations record type.")


def allocated_lines(invoice, amount):
    """Allocate observed invoice-payment cents by its retained source line amounts."""
    total = Decimal(invoice["totalUsd"])
    if total == 0:
        return []
    cents = int((amount * 100).quantize(Decimal("1"), rounding=ROUND_HALF_UP))
    sign = -1 if cents < 0 else 1
    parts = []
    for index, line in enumerate(invoice["lines"]):
        exact = Decimal(abs(cents)) * Decimal(line["amountUsd"]) / total
        parts.append([index, int(exact), exact - int(exact)])
    residual = abs(cents) - sum(item[1] for item in parts)
    for item in sorted(parts, key=lambda row: (-row[2], row[0]))[:residual]:
        item[1] += 1
    return [(invoice["lines"][index]["costId"], Decimal(value * sign) / 100) for index, value, _ in parts]


def report(program, plan, records, sources):
    package = {row["id"]: {"id": row["id"], "tranche": row["tranche"],
                "plannedUsd": usd(row["amount_usd"]), "plannedHours": str(row.get("estimated_hours", "")),
                "recordedHours": ZERO, "acceptedHours": ZERO, "preawardHours": ZERO,
                "invoicedUsd": ZERO, "paidUsd": ZERO} for row in plan["scenario"]["future_costs"]}
    unplanned = {"recordedHours": ZERO, "acceptedHours": ZERO, "preawardHours": ZERO, "invoicedUsd": ZERO, "paidUsd": ZERO}
    for row in records["work"]:
        if row["state"] == "VOID":
            continue
        target = package.get(row["costId"], unplanned)
        target["recordedHours"] += Decimal(row["hours"])
        if row["state"] == "ACCEPTED":
            target["acceptedHours"] += Decimal(row["hours"])
        if row["fundingBasis"] == "PREAWARD":
            target["preawardHours"] += Decimal(row["hours"])
    invoices = {row["id"]: row for row in records["invoices"]}
    invoice_paid = defaultdict(lambda: ZERO)
    cash_in, cash_out, grant_in = ZERO, ZERO, ZERO
    currencies, day_cash = {}, defaultdict(lambda: {"inUsd": ZERO, "outUsd": ZERO})
    unvalued, excluded = [], []
    tranche_received = defaultdict(lambda: ZERO)
    unresolved = []
    for row in records["cash"]:
        if row["state"] == "VOID":
            continue
        if "testnet" in row.get("network", "").lower():
            excluded.append(row["id"])
            continue
        key = canonical([row["currency"], row["network"], row["asset"]])
        bucket = currencies.setdefault(key, {"currency": row["currency"], "network": row["network"], "asset": row["asset"], "in": ZERO, "out": ZERO})
        bucket["in" if row["direction"] == "IN" else "out"] += Decimal(row["amount"])
        if row["usdValue"] is None:
            unvalued.append(row["id"])
            continue
        value = Decimal(row["usdValue"])
        if row["direction"] == "IN":
            cash_in += value
            day_cash[row["date"]]["inUsd"] += value
            if row["category"] == "GRANT":
                grant_in += value
                if row["tranche"] is not None:
                    tranche_received[row["tranche"]] += value
        else:
            cash_out += value
            day_cash[row["date"]]["outUsd"] += value
        for allocation in row["allocations"]:
            signed = Decimal(allocation["amountUsd"]) * (1 if row["direction"] == "OUT" else -1)
            invoice_paid[allocation["invoiceId"]] += signed
            invoice = invoices[allocation["invoiceId"]]
            for cost, part in allocated_lines(invoice, signed):
                package.get(cost, unplanned)["paidUsd"] += part

    invoice_rows, invoice_total, open_total, credit_total = [], ZERO, ZERO, ZERO
    for row in records["invoices"]:
        total = ZERO if row["state"] == "VOID" else Decimal(row["totalUsd"])
        paid = invoice_paid[row["id"]]
        balance = total - paid
        invoice_total += total
        open_total += max(ZERO, balance)
        credit_total += max(ZERO, -balance)
        if row["state"] != "VOID":
            for line in row["lines"]:
                package.get(line["costId"], unplanned)["invoicedUsd"] += Decimal(line["amountUsd"])
        invoice_rows.append({"id": row["id"], "number": row["number"], "state": row["state"],
                             "totalUsd": usd(total), "paidUsd": format(paid, ".2f"),
                             "openUsd": usd(max(ZERO, balance)), "overpaidUsd": usd(max(ZERO, -balance)),
                             "dueDate": row["dueDate"]})
        if balance > 0:
            unresolved.append({"kind": "invoice", "id": row["id"], "message": "Recorded invoice has an unpaid balance.", "amountUsd": usd(balance)})
        if balance < 0:
            unresolved.append({"kind": "invoice", "id": row["id"], "message": "Recorded payments exceed current invoice liability.", "amountUsd": usd(-balance)})
    for row in records["work"]:
        if row["state"] not in ("ACCEPTED", "VOID"):
            unresolved.append({"kind": "work", "id": row["id"], "message": "Recorded work has not completed internal review."})
    for ident in unvalued:
        unresolved.append({"kind": "cash", "id": ident, "message": "Asset quantity is retained without a USD valuation."})

    deployment_map = {row["id"]: row for row in records["deployments"]}
    active = [row for row in records["deployments"] if row["state"] in ("OPERATING", "HANDED_OVER")]
    def operators(role, environment=None):
        return sorted({row["operatorId"] for row in active if row["role"] in (role, "BOTH")
                       and row["participantClass"] != "TEAM_OPERATED" and (environment is None or row["environment"] == environment)})
    purchase_groups, intents, unjoined = {}, {}, []
    for row in records["purchases"]:
        if row["state"] == "VOID":
            continue
        key = canonical([row["network"], row["asset"], row["participantClass"]])
        group = purchase_groups.setdefault(key, {"network": row["network"], "asset": row["asset"],
                    "participantClass": row["participantClass"], "observations": 0, "transactions": set(),
                    "settledAtomicUnits": 0, "completeOutputs": 0})
        group["observations"] += 1
        if row["transactionHash"]:
            group["transactions"].add(row["transactionHash"])
        if row["settlementStatus"] == "SETTLED":
            group["settledAtomicUnits"] += int(row["amountStroops"])
        if row["outputStatus"] == "COMPLETE":
            group["completeOutputs"] += 1
        if row["intentId"]:
            intents.setdefault((row["network"], row["participantClass"], row["intentId"]), []).append(row)
        else:
            unjoined.append(row["id"])
    attempted, complete = 0, 0
    intent_groups = {}
    for (network, participation, _), values in intents.items():
        latest = max(values, key=lambda row: (datetime.fromisoformat(row["observedAt"].replace("Z", "+00:00")), row["id"]))
        group = intent_groups.setdefault((network, participation), {"network": network,
            "participantClass": participation, "knownIntents": 0, "attemptedIntents": 0,
            "completedIntents": 0, "refundedIntents": 0, "cancelledAfterAttempt": 0,
            "cancelledBeforeAttempt": 0, "missingOriginalAttemptTime": 0})
        group["knownIntents"] += 1
        has_attempt = any(row["paymentAttempted"] for row in values)
        if latest["orderStatus"] == "REFUNDED":
            group["refundedIntents"] += 1
        if latest["attemptStatus"] == "CANCELLED":
            group["cancelledAfterAttempt" if has_attempt else "cancelledBeforeAttempt"] += 1
        if has_attempt:
            attempted += 1
            group["attemptedIntents"] += 1
            if not any(row["firstAttemptAt"] for row in values):
                group["missingOriginalAttemptTime"] += 1
            if latest["settlementStatus"] == "SETTLED" and latest["outputStatus"] == "COMPLETE" and latest["orderStatus"] in ("NOT_APPLICABLE", "FULFILLED"):
                complete += 1
                group["completedIntents"] += 1
    for group in intent_groups.values():
        group["completionRate"] = format(Decimal(group["completedIntents"]) / group["attemptedIntents"], ".4f") if group["attemptedIntents"] else None
    by_asset = []
    for row in purchase_groups.values():
        by_asset.append({**row, "transactions": len(row["transactions"]), "settledAtomicUnits": str(row["settledAtomicUnits"])})
    calendar_start = program.get("calendarStart")
    daily, running = [], ZERO
    planned_days = {row["day"]: row for row in plan["report"]["cash"]["days"]}
    for stamp, values in sorted(day_cash.items()):
        running += values["inUsd"] - values["outUsd"]
        offset = (date.fromisoformat(stamp) - date.fromisoformat(calendar_start)).days if calendar_start else None
        conditional = planned_days.get(offset)
        daily.append({"date": stamp, "day": offset, "inUsd": usd(values["inUsd"]), "outUsd": usd(values["outUsd"]),
                      "recordedNetCashUsd": format(running, ".2f"),
                      "plannedOutflowUsd": conditional["plannedOutflowUsd"] if conditional else None,
                      "conditionalPlannedInflowUsd": conditional["conditionalInflowUsd"] if conditional else None})
    package_rows = []
    for row in package.values():
        item = {key: (format(value, ".2f") if key.endswith("Usd") else format(value, "f")) if isinstance(value, Decimal) else value for key, value in row.items()}
        item["invoiceVarianceUsd"] = format(Decimal(item["invoicedUsd"]) - Decimal(item["plannedUsd"]), ".2f")
        package_rows.append(item)
    grants = sorted(records["awards"], key=lambda row: (row["date"], row["updatedAt"], row["id"]))
    stages = grants[-1]["stage"] if grants else "NOT_RECORDED"
    return {"schema": "stellar-forge.sf47-operations-report.v1", "mode": program["mode"],
        "programId": program["id"], "version": program["version"], "applicationStage": stages,
        "originalApplicationState": plan["scenario"].get("application_state"),
        "plan": {"id": plan["id"], "revision": plan["revision"], "contentSha256": plan["contentSha256"],
                 "sourceSha256": plan["source"]["sha256"], "requestUsd": plan["report"]["originalModel"]["award_request_usd"],
                 "conditionalFundingOnly": True, "calendarStart": calendar_start},
        "cash": {"inUsd": usd(cash_in), "outUsd": usd(cash_out), "netUsd": format(cash_in - cash_out, ".2f"),
                 "grantReceiptsUsd": usd(grant_in), "invoiceLiabilityUsd": usd(invoice_total), "openInvoiceUsd": usd(open_total),
                 "overpaidInvoiceUsd": usd(credit_total), "unvaluedIds": unvalued, "excludedTestnetIds": excluded,
                 "assets": [{**row, "in": quantity(row["in"], places=12), "out": quantity(row["out"], places=12),
                             "net": format(row["in"] - row["out"], "f")} for row in currencies.values()],
                 "days": daily},
        "packages": package_rows, "unplanned": {key: format(value, "f") for key, value in unplanned.items()},
        "invoices": invoice_rows,
        "tranches": [{"tranche": row["tranche"], "conditionalPlannedUsd": row["usd"],
                      "hypotheticalPaidDay": row["hypothetical_paid_day"],
                      "observedGrantUsd": usd(tranche_received[row["tranche"]])} for row in plan["report"]["originalModel"]["payouts"]],
        "delivery": {"deployments": len(records["deployments"]), "externalMerchantOperators": operators("MERCHANT"),
                     "externalBuyerOperators": operators("BUYER"), "externalMainnetMerchantOperators": operators("MERCHANT", "MAINNET"),
                     "handoverCount": sum(row["state"] == "HANDED_OVER" for row in records["deployments"]),
                     "purchaseGroups": by_asset, "intentGroups": list(intent_groups.values()), "knownApprovedIntents": len(intents), "attemptedKnownIntents": attempted,
                     "completedKnownIntents": complete, "completionRate": format(Decimal(complete) / attempted, ".4f") if attempted else None,
                     "purchaseObservationsWithoutIntentJoin": unjoined,
                     "sourcePlan": plan["report"].get("deliveryPlan")},
        "sourceCoverage": {"attachments": len(sources),
            "operatorEntryRecords": sum(row.get("sourceBasis") == "OPERATOR_ENTRY" for values in records.values() for row in values)},
        "unresolved": unresolved}
