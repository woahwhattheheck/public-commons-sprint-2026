"""Dated remaining-work and cash forecasts over an immutable SF47 case snapshot.

The original budget calculator and operations records remain authoritative.
This module produces planning scenarios; it never records cash or an award.
"""
from __future__ import annotations

from collections import defaultdict
from copy import deepcopy
from datetime import date, timedelta
from decimal import Decimal, ROUND_HALF_UP
import hashlib
import io
import json
import zipfile

import operations_domain as domain
from model import canonical, csv_bytes, digest, short_id, text

SCHEMA = "stellar-forge.sf47-operating-forecast.v1"
ENGINE_VERSION = 1
MAX_FORECASTS = 100
MAX_DAYS = 1096
ZERO = Decimal("0")
CENT = Decimal("0.01")
HOUR = Decimal("0.0001")


def money(value):
    return format(Decimal(value).quantize(CENT, rounding=ROUND_HALF_UP), ".2f")


def hours(value):
    return format(Decimal(value).quantize(HOUR, rounding=ROUND_HALF_UP), "f").rstrip("0").rstrip(".") or "0"


def obj(value, label, allowed):
    if not isinstance(value, dict) or set(value) - set(allowed):
        domain.fail(label + ": use the declared forecast fields.", "INVALID_FORECAST")
    return value


def rows(value, label, maximum=200):
    if not isinstance(value, list) or len(value) > maximum or any(not isinstance(row, dict) for row in value):
        domain.fail(label + ": use at most " + str(maximum) + " object rows.", "INVALID_FORECAST")
    return value


def boolean(value, label):
    if not isinstance(value, bool):
        domain.fail(label + ": use true or false.", "INVALID_FORECAST")
    return value


def unique(values, key, label):
    result = {}
    for row in values:
        ident = row[key]
        if ident in result:
            domain.fail(label + ": an identity is repeated.", "INVALID_FORECAST")
        result[ident] = row
    return result


def source_identity(context):
    program, plan = context["program"], context["plan"]
    business = {"program": {key: program[key] for key in ("id", "name", "mode", "calendarStart")},
                "plan": plan, "records": context["records"],
                "sources": sorted(context["sources"].values(), key=lambda row: row["id"])}
    return {"programId": program["id"], "version": program["version"],
            "planId": plan["id"], "planRevision": plan["revision"],
            "planContentSha256": plan["contentSha256"], "planSourceSha256": plan["source"]["sha256"],
            "businessSha256": digest(business),
            "factsSha256": digest({"planContentSha256": plan["contentSha256"], "planSourceSha256": plan["source"]["sha256"],
                "planRevision": plan["revision"], "mode": program["mode"], "calendarStart": program["calendarStart"],
                "records": context["records"], "sources": business["sources"]})}


def normalize(context, raw):
    raw = obj(deepcopy(raw), "Forecast", ("name", "asOfDate", "calendarStart", "openingCash",
              "packageOverrides", "invoiceOverrides", "grantReceipts", "commercial", "capacity", "note"))
    as_of = domain.calendar(raw.get("asOfDate"), "Forecast as-of date")
    anchor = domain.calendar(raw.get("calendarStart") or context["program"].get("calendarStart")
                             or context["plan"]["planning"].get("calendarStart"), "Explicit plan day-zero date")
    first = date.fromisoformat(as_of) + timedelta(days=1)
    last = first + timedelta(days=MAX_DAYS - 1)
    if not first - timedelta(days=MAX_DAYS) <= date.fromisoformat(anchor) <= last:
        domain.fail("The plan anchor must be within three years of the forecast date.", "INVALID_FORECAST")
    def future(value, label, optional=False):
        parsed = domain.calendar(value, label, optional)
        if parsed and not first <= date.fromisoformat(parsed) <= last:
            domain.fail(label + ": select a date after the as-of date and within three years.", "INVALID_FORECAST")
        return parsed
    sources = context["sources"]
    opening = obj(raw.get("openingCash", {}), "Opening cash", ("amountUsd", "basis", "sourceIds", "note"))
    value = opening.get("amountUsd")
    opening = {"amountUsd": None if value in (None, "") else domain.usd(value, "Available cash at end of as-of date"),
               "basis": domain.enum(opening.get("basis", "NOT_ENTERED"),
                        ("NOT_ENTERED", "OBSERVED_BALANCE", "PLANNING_ASSUMPTION"), "Opening cash basis"),
               "sourceIds": domain.reference_list(opening.get("sourceIds", []), sources, "Opening cash sources"),
               "note": text(opening.get("note", ""), "Opening cash source / assumption", 4000)}
    if opening["amountUsd"] is None and opening["basis"] != "NOT_ENTERED":
        domain.fail("Enter the opening cash amount for its selected basis.", "INVALID_FORECAST")
    if opening["amountUsd"] is not None and (opening["basis"] == "NOT_ENTERED" or not opening["note"]):
        domain.fail("An opening balance needs its explicit basis and source or assumption note.", "INVALID_FORECAST")
    costs = {row["id"]: row for row in context["plan"]["scenario"]["future_costs"]}
    cash = {row["id"]: row for row in context["records"]["cash"]}
    invoices = {row["id"]: row for row in context["records"]["invoices"]}
    used_direct, used_receipts, used_invoices = set(), set(), set()
    def direct_ids(value):
        ids = domain.reference_list(value, cash, "Direct expense cash records")
        for ident in ids:
            row = cash[ident]
            if (row["state"] != "OBSERVED" or row["date"] > as_of or row["direction"] != "OUT"
                    or row["usdValue"] is None or "testnet" in row.get("network", "").lower()
                    or row["allocations"] or ident in used_direct):
                domain.fail("Direct expenses must be distinct valued observed outflows through the as-of date, with no invoice allocations.", "FORECAST_CASH_CONFLICT", 409)
            used_direct.add(ident)
        return ids
    packages = []
    for row in rows(raw.get("packageOverrides", []), "Package estimates"):
        obj(row, "Package estimate", ("costId", "remainingCostUsd", "remainingHours", "startDate",
                                     "endDate", "paymentMode", "directCashIds", "note"))
        ident = domain.cost_id(row.get("costId"), context["plan"])
        if ident is None:
            domain.fail("Select a pinned work package for each estimate.", "INVALID_FORECAST")
        normalized = {"costId": ident,
            "remainingCostUsd": None if row.get("remainingCostUsd") in (None, "") else domain.usd(row["remainingCostUsd"], "Remaining uninvoiced package cash"),
            "remainingHours": None if row.get("remainingHours") in (None, "") else domain.quantity(row["remainingHours"], "Remaining package hours", 4),
            "startDate": future(row.get("startDate"), "Remaining work start", True),
            "endDate": future(row.get("endDate"), "Remaining work finish", True),
            "paymentMode": domain.enum(row.get("paymentMode", "original"), ("original", "accrual", "completion"), "Remaining payment schedule"),
            "directCashIds": direct_ids(row.get("directCashIds", [])),
            "note": text(row.get("note", ""), "Package estimate reason", 4000)}
        changed = any(normalized[key] is not None for key in ("remainingCostUsd", "remainingHours", "startDate", "endDate"))
        if (changed or normalized["directCashIds"] or normalized["paymentMode"] != "original") and not normalized["note"]:
            domain.fail("Retain the basis for every changed package estimate or direct expense assignment.", "INVALID_FORECAST")
        packages.append(normalized)
    unique(packages, "costId", "Package estimates")
    invoice_overrides = []
    for row in rows(raw.get("invoiceOverrides", []), "Invoice timing", 5000):
        obj(row, "Invoice timing", ("invoiceId", "dueDate", "include", "note"))
        ident = row.get("invoiceId")
        if ident not in invoices:
            domain.fail("The selected original invoice is unavailable.", "INVALID_FORECAST")
        normalized = {"invoiceId": ident, "dueDate": future(row.get("dueDate"), "Expected invoice payment", True),
                      "include": boolean(row.get("include", True), "Include invoice obligation"),
                      "note": text(row.get("note", ""), "Invoice timing / exclusion reason", 4000)}
        if (normalized["dueDate"] or not normalized["include"]) and not normalized["note"]:
            domain.fail("Retain a reason for the changed invoice date or excluded obligation.", "INVALID_FORECAST")
        invoice_overrides.append(normalized)
    unique(invoice_overrides, "invoiceId", "Invoice timing")
    grants = []
    for row in rows(raw.get("grantReceipts", []), "Conditional grant receipts", 4):
        obj(row, "Grant timing", ("tranche", "date", "include", "note"))
        normalized = {"tranche": domain.integer(row.get("tranche"), "Original payout tranche", 0, 3),
                      "date": future(row.get("date"), "New conditional grant receipt date", True),
                      "include": boolean(row.get("include", True), "Include conditional grant"),
                      "note": text(row.get("note", ""), "Grant timing basis", 4000)}
        if (normalized["date"] or not normalized["include"]) and not normalized["note"]:
            domain.fail("Retain a reason for changed conditional grant timing or exclusion.", "INVALID_FORECAST")
        grants.append(normalized)
    unique(grants, "tranche", "Grant timing")
    commercial = []
    for row in rows(raw.get("commercial", []), "Commercial delivery scenarios", 50):
        obj(row, "Commercial scenario", ("id", "title", "caseRef", "sourceUrl", "sourceIds", "stage", "selected",
            "priceUsd", "totalDeliveryCostUsd", "remainingHours", "startDate", "endDate", "paymentMode",
            "receipts", "cashIds", "invoiceIds", "directCashIds", "scope", "note", "timing"))
        ident = short_id(row.get("id"), "Commercial scenario identity")
        receipt_ids = domain.reference_list(row.get("cashIds", []), cash, "Observed customer receipts")
        for cid in receipt_ids:
            actual = cash[cid]
            if (actual["state"] != "OBSERVED" or actual["date"] > as_of or actual["direction"] != "IN"
                    or actual["category"] != "CUSTOMER" or actual["usdValue"] is None
                    or "testnet" in actual.get("network", "").lower() or cid in used_receipts):
                domain.fail("Customer receipts must be distinct valued original CUSTOMER inflows through the as-of date.", "FORECAST_CASH_CONFLICT", 409)
            used_receipts.add(cid)
        invoice_ids = domain.reference_list(row.get("invoiceIds", []), invoices, "Commercial delivery invoices")
        for iid in invoice_ids:
            if iid in used_invoices or any(line["costId"] is not None for line in invoices[iid]["lines"]):
                domain.fail("Assign each unplanned invoice to one commercial scenario; grant-package invoices stay with their original packages.", "FORECAST_INVOICE_CONFLICT", 409)
            used_invoices.add(iid)
        receipts = []
        for entry in rows(row.get("receipts", []), "Commercial receipt milestones", 30):
            obj(entry, "Commercial receipt", ("id", "label", "amountUsd", "date"))
            receipts.append({"id": short_id(entry.get("id"), "Receipt milestone identity"),
                "label": text(entry.get("label"), "Receipt milestone", 300, True),
                "amountUsd": domain.usd(entry.get("amountUsd"), "Original quoted receipt", True),
                "date": future(entry.get("date"), "Forecast customer collection date", True)})
        unique(receipts, "id", "Commercial receipts")
        price = domain.usd(row.get("priceUsd"), "Original commercial price", True)
        if not receipts or sum((Decimal(item["amountUsd"]) for item in receipts), ZERO) != Decimal(price):
            domain.fail("Commercial milestone amounts must equal the retained total price exactly.", "INVALID_FORECAST")
        timing = None
        if "timing" in row:
            raw_timing = obj(row["timing"], "Event-dependent commercial timing",
                             ("mode", "startCondition", "deliveryBusinessDays", "receiptConditions"))
            if raw_timing.get("mode") != "EVENT_DEPENDENT":
                domain.fail("Use EVENT_DEPENDENT timing, or omit timing for an ordinary dated scenario.", "INVALID_FORECAST")
            conditions = []
            for condition in rows(raw_timing.get("receiptConditions"), "Original collection conditions", 30):
                obj(condition, "Collection condition", ("receiptId", "condition"))
                conditions.append({"receiptId": short_id(condition.get("receiptId"), "Original receipt milestone"),
                    "condition": text(condition.get("condition"), "Original relative collection term", 4000, True)})
            condition_index = unique(conditions, "receiptId", "Collection conditions")
            if set(condition_index) != {receipt["id"] for receipt in receipts}:
                domain.fail("Retain exactly one original collection condition for each quoted milestone.", "INVALID_FORECAST")
            timing = {"mode": "EVENT_DEPENDENT",
                "startCondition": text(raw_timing.get("startCondition"), "Original start prerequisite", 4000, True),
                "deliveryBusinessDays": domain.integer(raw_timing.get("deliveryBusinessDays"), "Quoted delivery working days", 1, MAX_DAYS),
                "receiptConditions": [condition_index[receipt["id"]] for receipt in receipts]}
        normalized = {"id": ident, "title": text(row.get("title"), "Commercial project", 500, True),
            "caseRef": text(row.get("caseRef"), "Original commercial case / offer identity", 4000, True),
            "sourceUrl": domain.url(row.get("sourceUrl", ""), "Original offer URL"),
            "sourceIds": domain.reference_list(row.get("sourceIds", []), sources, "Commercial source attachments"),
            "stage": domain.enum(row.get("stage", "QUOTED"), ("QUOTED", "AGREED", "IN_PROGRESS"), "Original commercial stage"),
            "selected": boolean(row.get("selected", True), "Include commercial scenario"),
            "priceUsd": price, "totalDeliveryCostUsd": domain.usd(row.get("totalDeliveryCostUsd"), "Current customer-specific delivery cost estimate"),
            "remainingHours": domain.quantity(row.get("remainingHours"), "Remaining customer-specific hours", 4),
            "startDate": future(row.get("startDate"), "Forecast commercial work start", timing is not None),
            "endDate": future(row.get("endDate"), "Forecast commercial work finish", timing is not None),
            "paymentMode": domain.enum(row.get("paymentMode", "accrual"), ("accrual", "completion"), "Commercial cost timing"),
            "receipts": receipts, "cashIds": receipt_ids, "invoiceIds": invoice_ids,
            "directCashIds": direct_ids(row.get("directCashIds", [])),
            "scope": text(row.get("scope", ""), "Customer-specific scope / prerequisites", 12000),
            "note": text(row.get("note"), "Commercial cost and date assumption", 8000, True)}
        if timing is not None:
            normalized["timing"] = timing
        if (normalized["startDate"] is None) != (normalized["endDate"] is None):
            domain.fail("Retain both work dates, or leave both empty while the original start condition is unresolved.", "INVALID_FORECAST")
        if normalized["endDate"] is not None and normalized["endDate"] < normalized["startDate"]:
            domain.fail("Commercial work must finish on or after it starts.", "INVALID_FORECAST")
        commercial.append(normalized)
    unique(commercial, "id", "Commercial projects")
    capacity = obj(raw.get("capacity", {}), "Delivery capacity", ("weeklyHours", "note"))
    capacity = {"weeklyHours": None if capacity.get("weeklyHours") in (None, "") else domain.quantity(capacity["weeklyHours"], "Available weekly team hours", 4),
                "note": text(capacity.get("note", ""), "Capacity source / assumption", 4000)}
    if capacity["weeklyHours"] is not None and not capacity["note"]:
        domain.fail("Entered capacity needs its original source or assumption note.", "INVALID_FORECAST")
    return {"name": text(raw.get("name"), "Forecast name", 300, True), "asOfDate": as_of,
            "calendarStart": anchor, "openingCash": opening, "packageOverrides": packages,
            "invoiceOverrides": invoice_overrides, "grantReceipts": grants, "commercial": commercial,
            "capacity": capacity, "note": text(raw.get("note", ""), "Forecast decisions / assumptions", 12000)}


def split_amount(amount, weights, places=2):
    """Cumulative rounding conserves the exact total across every dated row."""
    unit = Decimal(1).scaleb(-places)
    total = sum((Decimal(weight) for _, weight in weights), ZERO)
    if total == 0:
        return []
    result, elapsed, previous = [], ZERO, ZERO
    for stamp, weight in weights:
        elapsed += Decimal(weight)
        cumulative = (Decimal(amount) * elapsed / total).quantize(unit, rounding=ROUND_HALF_UP)
        part, previous = cumulative - previous, cumulative
        if part:
            result.append((stamp, part))
    return result


def date_range(start, end):
    a, b = date.fromisoformat(start), date.fromisoformat(end)
    return [(a + timedelta(days=offset)).isoformat() for offset in range((b-a).days + 1)]


def build(context, inputs):
    as_of, anchor = inputs["asOfDate"], date.fromisoformat(inputs["calendarStart"])
    first = (date.fromisoformat(as_of) + timedelta(days=1)).isoformat()
    last = (date.fromisoformat(first) + timedelta(days=MAX_DAYS-1)).isoformat()
    # Current source states remain visible; this is not a historical-state reconstruction.
    # A recorded future payment cannot pay an invoice or fund today's forecast.
    through = deepcopy(context)
    future_cash = [row["id"] for row in through["records"]["cash"] if row["date"] > as_of]
    future_work = [row["id"] for row in through["records"]["work"] if row["endDate"] > as_of]
    through["records"]["cash"] = [row for row in through["records"]["cash"] if row["date"] <= as_of]
    through["records"]["work"] = [row for row in through["records"]["work"] if row["endDate"] <= as_of]
    through["records"]["awards"] = [row for row in through["records"]["awards"] if row["date"] <= as_of]
    actual = domain.report(**through)
    original = context["plan"]
    package_overrides = unique(inputs["packageOverrides"], "costId", "Package estimates")
    invoice_overrides = unique(inputs["invoiceOverrides"], "invoiceId", "Invoice timing")
    grant_overrides = unique(inputs["grantReceipts"], "tranche", "Grant timing")
    cash = {row["id"]: row for row in through["records"]["cash"]}
    invoice_map = {row["id"]: row for row in context["records"]["invoices"]}
    actual_packages = {row["id"]: row for row in actual["packages"]}
    events, package_rows, invoice_rows, grant_rows, commercial_rows, work_days, issues = [], [], [], [], [], defaultdict(lambda: defaultdict(lambda: ZERO)), []
    invoice_owners = {iid: row["id"] for row in inputs["commercial"] for iid in row["invoiceIds"]}
    selected_commercial = {row["id"] for row in inputs["commercial"] if row["selected"]}
    def issue(code, identity, message, amount=None):
        row = {"code": code, "id": identity, "message": message}
        if amount is not None:
            row["amountUsd"] = money(amount)
        issues.append(row)
    def shifted(stamp):
        return max(stamp or first, first)
    def pinned_day(offset):
        value = (anchor + timedelta(days=offset)).isoformat()
        if value > last:
            domain.fail("The selected plan dates extend beyond the three-year forecast horizon.", "INVALID_FORECAST")
        return value
    def event(stamp, amount, kind, identity, title, conditional=False, **extra):
        if Decimal(amount) == 0:
            return
        events.append({"date": stamp, "amountUsd": money(amount), "kind": kind, "id": identity,
                       "title": title, "conditional": conditional, **extra})
    def schedule(amount, mode, start, end, original_payment=None, cost=None):
        if mode == "original":
            mode = original_payment["mode"]
            if mode == "installments":
                weights = [(shifted(pinned_day(row["day"])), Decimal(row["usd"])) for row in original_payment["installments"]]
                return split_amount(amount, weights)
            if mode == "completion":
                stamp = max(end, shifted(pinned_day(cost["end_day"] + original_payment["lagDays"])))
                return [(stamp, Decimal(amount))] if Decimal(amount) else []
        if mode == "completion":
            return [(end, Decimal(amount))] if Decimal(amount) else []
        return split_amount(amount, [(stamp, 1) for stamp in date_range(start, end)])
    def work(identity, amount, start, end):
        for stamp, part in split_amount(amount, [(stamp, 1) for stamp in date_range(start, end)], 4):
            work_days[stamp][identity] += part

    for row in actual["invoices"]:
        source = invoice_map[row["id"]]
        override = invoice_overrides.get(row["id"], {})
        expected = override.get("dueDate") or shifted(row["dueDate"] or source["issuedDate"])
        include = override.get("include", True)
        open_amount = Decimal(row["openUsd"])
        owner = invoice_owners.get(row["id"])
        # Existing invoice liabilities remain in spending even if a new quote scenario is deselected.
        result = {**row, "issuedDate": source["issuedDate"], "expectedPaymentDate": expected,
                  "included": include, "commercialId": owner, "note": override.get("note", ""),
                  "originalSourceIds": source["sourceIds"]}
        invoice_rows.append(result)
        if open_amount and include:
            event(expected, -open_amount, "INVOICE", row["id"], source["number"], originalDueDate=row["dueDate"],
                  originalSourceIds=source["sourceIds"], commercialId=owner)
        elif open_amount:
            issue("EXCLUDED_INVOICE", row["id"], "The forecast excludes this original unpaid balance for the retained operator reason.", open_amount)
        if open_amount and (not row["dueDate"] or row["dueDate"] <= as_of) and not override.get("dueDate"):
            issue("INVOICE_DATE_REQUIRED", row["id"], "Undated or overdue unpaid balance is conservatively scheduled on the next day.", open_amount)
        if open_amount and row["state"] == "DISPUTED":
            issue("DISPUTED_INVOICE", row["id"], "This disputed liability is included unless explicitly excluded with a reason.", open_amount)
        if source["issuedDate"] > as_of:
            issue("POSTDATED_INVOICE", row["id"], "The current case contains an invoice issued after the as-of date; its source and expected payment remain explicit.")
        if Decimal(row["overpaidUsd"]):
            issue("UNAPPLIED_CREDIT", row["id"], "Overpayment is retained as a source credit; it is not forecast as returned cash.", row["overpaidUsd"])

    for cost in original["scenario"]["future_costs"]:
        ident, record = cost["id"], actual_packages[cost["id"]]
        override = package_overrides.get(ident, {})
        direct = sum((Decimal(cash[cid]["usdValue"]) for cid in override.get("directCashIds", [])), ZERO)
        planned = Decimal(record["plannedUsd"])
        baseline = max(ZERO, planned - Decimal(record["invoicedUsd"]) - direct)
        remaining = Decimal(override.get("remainingCostUsd") if override.get("remainingCostUsd") is not None else baseline)
        accepted = Decimal(record["acceptedHours"])
        baseline_hours = max(ZERO, Decimal(record["plannedHours"] or "0") - accepted)
        remaining_hours = Decimal(override.get("remainingHours") if override.get("remainingHours") is not None else baseline_hours)
        start = override.get("startDate") or shifted(pinned_day(cost["start_day"]))
        end = override.get("endDate") or max(start, shifted(pinned_day(cost["end_day"])))
        if end < start:
            domain.fail(ident + ": remaining work ends before it starts.", "INVALID_FORECAST")
        mode = override.get("paymentMode", "original")
        result = {**record, "directPaidUsd": money(direct), "directCashIds": override.get("directCashIds", []),
                  "baselineUninvoicedUsd": money(baseline), "baselineRemainingHours": hours(baseline_hours),
                  "remainingCostUsd": money(remaining), "remainingHours": hours(remaining_hours),
                  "startDate": start, "endDate": end, "paymentMode": mode,
                  "estimateBasis": "OPERATOR_REESTIMATE" if override.get("remainingCostUsd") is not None else "PINNED_ALLOCATION_LESS_INVOICES_AND_ASSIGNED_DIRECT_PAYMENTS",
                  "note": override.get("note", ""), "scope": cost.get("remaining_work", "")}
        package_rows.append(result)
        for stamp, amount in schedule(remaining, mode, start, end, original["planning"]["payments"][ident], cost):
            event(stamp, -amount, "PACKAGE", ident, ident)
        work(ident, remaining_hours, start, end)
        if pinned_day(cost["end_day"]) <= as_of and remaining_hours and not override.get("endDate"):
            issue("WORK_DATES_REQUIRED", ident, "The original work window has elapsed. Remaining hours are on the next day until the operator replans them.")
        if accepted and baseline and override.get("remainingCostUsd") is None:
            issue("UNBILLED_COST_REVIEW", ident, "The default cash estimate retains the non-invoiced budget allocation, which can include completed but unbilled work; re-estimate it from actual obligations.")
        if Decimal(record["preawardHours"]):
            issue("PREAWARD_WORK", ident, "Accepted pre-award hours reduce remaining work, while original funding labels stay visible. Review the future-only scope and remaining uninvoiced cash estimate.")
        if Decimal(record["invoicedUsd"]) + direct > planned:
            issue("PACKAGE_COST_OVERRUN", ident, "Recorded invoiced cost and assigned direct payments exceed the pinned allocation.", Decimal(record["invoicedUsd"]) + direct - planned)

    for payout in actual["tranches"]:
        tranche = payout["tranche"]
        override = grant_overrides.get(tranche, {})
        quoted = Decimal(payout["conditionalPlannedUsd"])
        observed = Decimal(payout["observedGrantUsd"])
        remaining = max(ZERO, quoted - observed)
        original_date = pinned_day(payout["hypotheticalPaidDay"])
        expected = override.get("date") or (original_date if original_date > as_of else None)
        include = override.get("include", True)
        result = {**payout, "originalDate": original_date, "forecastDate": expected, "remainingUsd": money(remaining),
                  "included": include, "note": override.get("note", "")}
        grant_rows.append(result)
        if include and expected:
            event(expected, remaining, "CONDITIONAL_GRANT", str(tranche), "Conditional grant tranche " + str(tranche), True)
        elif include and remaining:
            issue("GRANT_DATE_REQUIRED", str(tranche), "An unreceived past-due conditional payout needs an explicit new date and is excluded from the cash curve until then.", remaining)
        if observed > quoted:
            issue("GRANT_OVER_RECEIPT", str(tranche), "The observed receipt exceeds this pinned conditional tranche; the original cash stays unchanged.", observed - quoted)
    unassigned_grant = [row["id"] for row in through["records"]["cash"] if row["state"] == "OBSERVED"
        and row["category"] == "GRANT" and row["tranche"] is None and row["usdValue"] is not None
        and "testnet" not in row.get("network", "").lower()]
    if unassigned_grant:
        issue("UNASSIGNED_GRANT_RECEIPTS", ",".join(unassigned_grant), "These observed grant inflows need an original tranche assignment before they can reduce a specific conditional payout.")

    for row in inputs["commercial"]:
        observed = sum((Decimal(cash[cid]["usdValue"]) for cid in row["cashIds"]), ZERO)
        direct = sum((Decimal(cash[cid]["usdValue"]) for cid in row["directCashIds"]), ZERO)
        invoiced = sum((Decimal(invoice_map[iid]["totalUsd"]) for iid in row["invoiceIds"] if invoice_map[iid]["state"] != "VOID"), ZERO)
        remaining = max(ZERO, Decimal(row["totalDeliveryCostUsd"]) - invoiced - direct)
        assigned_paid = sum((Decimal(invoice["paidUsd"]) for invoice in invoice_rows if invoice["id"] in row["invoiceIds"]), ZERO)
        open_invoice = sum((Decimal(invoice["openUsd"]) for invoice in invoice_rows if invoice["id"] in row["invoiceIds"] and invoice["included"]), ZERO)
        left, receipts = observed, []
        for receipt in row["receipts"]:
            original_amount = Decimal(receipt["amountUsd"])
            settled = min(left, original_amount)
            left -= settled
            outstanding = original_amount - settled
            receipts.append({**receipt, "appliedObservedUsd": money(settled), "remainingUsd": money(outstanding)})
            if row["selected"] and receipt["date"]:
                event(receipt["date"], outstanding, "FORECAST_CUSTOMER", row["id"] + "/" + receipt["id"],
                      row["title"] + " · " + receipt["label"], True, commercialId=row["id"], stage=row["stage"])
            elif row["selected"] and outstanding:
                issue("CUSTOMER_DATE_REQUIRED", row["id"] + "/" + receipt["id"], "This customer receipt has no selected collection date and is excluded from the cash curve.", outstanding)
        if row["selected"]:
            if row["startDate"] is not None and row["endDate"] is not None:
                for stamp, amount in schedule(remaining, row["paymentMode"], row["startDate"], row["endDate"]):
                    event(stamp, -amount, "COMMERCIAL_COST", row["id"], row["title"], True, commercialId=row["id"], stage=row["stage"])
                work(row["id"], row["remainingHours"], row["startDate"], row["endDate"])
            else:
                issue("COMMERCIAL_WORK_DATE_REQUIRED", row["id"],
                    "Original event-dependent work is retained in scope totals. Select its work window after reviewing the start condition; its uninvoiced costs and hours are outside the dated curves.", remaining)
        commercial_rows.append({**row, "receipts": receipts, "observedReceiptsUsd": money(observed),
            "uncollectedPriceUsd": money(max(ZERO, Decimal(row["priceUsd"]) - observed)),
            "invoicedDeliveryUsd": money(invoiced), "paidInvoiceUsd": money(assigned_paid),
            "openInvoiceUsd": money(open_invoice), "directPaidUsd": money(direct), "remainingUninvoicedCostUsd": money(remaining),
            "totalRemainingCashCostUsd": money(remaining + open_invoice),
            "forecastContributionBeforeOtherCostsUsd": money(Decimal(row["priceUsd"]) - Decimal(row["totalDeliveryCostUsd"]))})
        if left:
            issue("CUSTOMER_OVER_RECEIPT", row["id"], "Observed receipts exceed the retained quoted price; the original cash is preserved.", left)
        if invoiced + direct > Decimal(row["totalDeliveryCostUsd"]):
            issue("COMMERCIAL_COST_OVERRUN", row["id"], "Recorded customer-specific costs exceed the estimate.", invoiced + direct - Decimal(row["totalDeliveryCostUsd"]))

    for ident in future_cash:
        issue("FUTURE_CASH_EXCLUDED", ident, "This original cash record is dated after the as-of date and has not paid or funded this forecast.")
    for ident in future_work:
        issue("FUTURE_WORK_EXCLUDED", ident, "This work record finishes after the as-of date and has not reduced remaining hours.")
    named_direct = {cid for row in inputs["packageOverrides"] + inputs["commercial"] for cid in row.get("directCashIds", [])}
    unattributed = [row["id"] for row in through["records"]["cash"] if row["state"] == "OBSERVED"
        and row["direction"] == "OUT" and row["usdValue"] is not None and not row["allocations"]
        and "testnet" not in row.get("network", "").lower() and row["id"] not in named_direct]
    if unattributed:
        issue("UNASSIGNED_DIRECT_PAYMENTS", ",".join(unattributed), "These actual outflows are in observed cash but have no package or commercial expense assignment to reduce an estimate.")
    capacity_input = inputs["capacity"]["weeklyHours"]
    people = original["planning"]["contributors"]
    weekly = Decimal(capacity_input) if capacity_input is not None else (sum((Decimal(row["weeklyHours"]) for row in people), ZERO) if people else None)
    capacity_basis = "OPERATOR_FORECAST_INPUT" if capacity_input is not None else ("PINNED_CONTRIBUTOR_CAPACITY" if people else "NOT_ENTERED")
    events.sort(key=lambda row: (row["date"] or "", row["kind"], row["id"]))
    grouped = defaultdict(list)
    for row in events:
        grouped[row["date"]].append(row)
    end = max([as_of, *grouped.keys(), *work_days.keys()])
    opening = None if inputs["openingCash"]["amountUsd"] is None else Decimal(inputs["openingCash"]["amountUsd"])
    balances = {"spendingOnly": ZERO, "conditionalGrant": ZERO, "commercial": ZERO}
    minima = {key: {"delta": ZERO, "date": as_of} for key in balances}
    days, daily_work, peak_weekly, overloaded = [], [], ZERO, []
    for stamp in date_range(as_of, end):
        today = grouped.get(stamp, [])
        invoice_spend = sum((-Decimal(row["amountUsd"]) for row in today if row["kind"] == "INVOICE"), ZERO)
        package_spend = sum((-Decimal(row["amountUsd"]) for row in today if row["kind"] == "PACKAGE"), ZERO)
        commercial_spend = sum((-Decimal(row["amountUsd"]) for row in today if row["kind"] == "COMMERCIAL_COST"), ZERO)
        grant_income = sum((Decimal(row["amountUsd"]) for row in today if row["kind"] == "CONDITIONAL_GRANT"), ZERO)
        customer_income = sum((Decimal(row["amountUsd"]) for row in today if row["kind"] == "FORECAST_CUSTOMER"), ZERO)
        base_spend = invoice_spend + package_spend
        balances["spendingOnly"] -= base_spend
        balances["conditionalGrant"] += grant_income - base_spend
        balances["commercial"] += grant_income + customer_income - base_spend - commercial_spend
        total_hours = sum(work_days.get(stamp, {}).values(), ZERO)
        required = total_hours * 7
        peak_weekly = max(peak_weekly, required)
        if weekly is not None and required > weekly:
            overloaded.append(stamp)
        for ident, quantity in sorted(work_days.get(stamp, {}).items()):
            daily_work.append({"date": stamp, "projectId": ident, "hours": hours(quantity)})
        result = {"date": stamp, "invoiceOutflowUsd": money(invoice_spend), "packageOutflowUsd": money(package_spend),
            "commercialOutflowUsd": money(commercial_spend), "conditionalGrantInflowUsd": money(grant_income),
            "forecastCustomerInflowUsd": money(customer_income), "remainingWorkHours": hours(total_hours),
            "weeklyEquivalentHours": hours(required), "availableWeeklyHours": None if weekly is None else hours(weekly)}
        for key, balance in balances.items():
            result[key + "DeltaUsd"] = money(balance)
            result[key + "BalanceUsd"] = None if opening is None else money(opening + balance)
            if balance < minima[key]["delta"]:
                minima[key] = {"delta": balance, "date": stamp}
        days.append(result)
    scenarios = {}
    for key in balances:
        need = max(ZERO, -minima[key]["delta"])
        scenarios[key] = {"additionalCashNeededUsd": money(need),
            "gapAfterOpeningCashUsd": None if opening is None else money(max(ZERO, need-opening)),
            "peakNeedDate": minima[key]["date"], "endDeltaUsd": money(balances[key]),
            "endBalanceUsd": None if opening is None else money(opening + balances[key])}
    invoice_total = sum((Decimal(row["openUsd"]) for row in invoice_rows if row["included"]), ZERO)
    package_total = sum((Decimal(row["remainingCostUsd"]) for row in package_rows), ZERO)
    commercial_total = sum((Decimal(row["remainingUninvoicedCostUsd"]) for row in commercial_rows if row["selected"]), ZERO)
    return {"schema": SCHEMA + ".report", "engineVersion": ENGINE_VERSION, "mode": context["program"]["mode"],
        "asOfDate": as_of, "firstForecastDate": first, "lastForecastDate": end,
        "basis": "Current retained record states; observed cash/work cut off at the as-of date. Opening balance is end-of-day. Forecast dates begin the next day.",
        "actual": {"cash": actual["cash"], "applicationStage": actual["applicationStage"],
                   "originalApplicationState": actual["originalApplicationState"], "futureCashIds": future_cash, "futureWorkIds": future_work},
        "openingCash": inputs["openingCash"], "scenarios": scenarios,
        "totals": {"openInvoiceUsd": money(invoice_total), "remainingPackageCostUsd": money(package_total),
            "selectedCommercialUninvoicedCostUsd": money(commercial_total),
            "remainingCashOutflowWithCommercialUsd": money(invoice_total + package_total + commercial_total),
            "remainingGrantPackageHours": hours(sum((Decimal(row["remainingHours"]) for row in package_rows), ZERO)),
            "selectedCommercialHours": hours(sum((Decimal(row["remainingHours"]) for row in commercial_rows if row["selected"]), ZERO))},
        "capacity": {"basis": capacity_basis, "weeklyHours": None if weekly is None else hours(weekly),
            "peakWeeklyEquivalentHours": hours(peak_weekly), "overloadedDays": len(overloaded),
            "firstOverloadedDate": overloaded[0] if overloaded else None, "lastOverloadedDate": overloaded[-1] if overloaded else None,
            "note": inputs["capacity"]["note"], "originalContributors": people,
            "distribution": "Remaining hours are distributed over inclusive calendar dates. Seven-day equivalent is a planning comparison, not a staff roster."},
        "packages": package_rows, "invoices": invoice_rows, "grants": grant_rows, "commercial": commercial_rows,
        "events": events, "days": days, "workDays": daily_work, "issues": issues,
        **({"eventTiming": event_timing(commercial_rows)} if any("timing" in row for row in commercial_rows) else {})}


def event_timing(commercial):
    """Only the new explicit timing mode adds report fields; dated v1 saves stay unchanged."""
    projects = []
    for row in commercial:
        if "timing" not in row:
            continue
        undated = row["startDate"] is None or row["endDate"] is None
        selected = row["selected"]
        conditions = {item["receiptId"]: item["condition"] for item in row["timing"]["receiptConditions"]}
        projects.append({"id": row["id"], "title": row["title"], "caseRef": row["caseRef"],
            "selected": selected, "state": "AWAITING_WORK_DATES" if undated else "DATED",
            "startDate": row["startDate"], "endDate": row["endDate"],
            "startCondition": row["timing"]["startCondition"],
            "deliveryBusinessDays": row["timing"]["deliveryBusinessDays"],
            "undatedDeliveryCostUsd": row["remainingUninvoicedCostUsd"] if selected and undated else "0.00",
            "undatedHours": row["remainingHours"] if selected and undated else "0",
            "receipts": [{**receipt, "condition": conditions[receipt["id"]]} for receipt in row["receipts"]]})
    return {"projects": projects,
        "undatedDeliveryCostUsd": money(sum((Decimal(row["undatedDeliveryCostUsd"]) for row in projects), ZERO)),
        "undatedHours": hours(sum((Decimal(row["undatedHours"]) for row in projects), ZERO)),
        "undatedCustomerReceiptsUsd": money(sum((Decimal(receipt["remainingUsd"])
            for row in projects if row["selected"] for receipt in row["receipts"] if not receipt["date"]), ZERO)),
        "basis": "Full selected costs and hours stay in scope totals. Dated cash and capacity contain only selected dates; original invoices retain their independent due dates. Relative terms do not create cash or accept a handover."}


def preview(context, raw):
    inputs = normalize(context, raw)
    value = {"schema": SCHEMA, "engineVersion": ENGINE_VERSION, "source": source_identity(context),
             "inputs": inputs, "report": build(context, inputs)}
    value["previewSha256"] = digest(value)
    return value


def validate_saved(value, pinned_plan=None):
    try:
        if not isinstance(value, dict) or value.get("schema") != SCHEMA or value.get("engineVersion") != ENGINE_VERSION:
            domain.fail("Unsupported retained operating forecast.", "INVALID_FORECAST")
        original = {key: item for key, item in value.items() if key != "sha256"}
        if digest(original) != value.get("sha256"):
            domain.fail("The saved forecast differs from its complete retained identity.", "FORECAST_CHANGED", 409)
        short_id(value.get("id"), "Original forecast identity")
        domain.timestamp(value.get("createdAt"), "Forecast creation")
        text(value.get("actor"), "Forecast operator", 300, True)
        text(value.get("note"), "Forecast note", 12000)
        snapshot = value["snapshot"]
        if pinned_plan and (snapshot["plan"]["contentSha256"] != pinned_plan["contentSha256"]
                            or snapshot["plan"]["source"]["sha256"] != pinned_plan["source"]["sha256"]):
            domain.fail("The forecast belongs to another pinned planning source.", "FORECAST_SOURCE_CONFLICT", 409)
        if digest({"scenario": snapshot["plan"]["scenario"], "planning": snapshot["plan"]["planning"]}) != snapshot["plan"]["contentSha256"]:
            domain.fail("The forecast's pinned source content differs.", "FORECAST_SOURCE_CONFLICT", 409)
        rebuilt = preview(snapshot, value["inputs"])
        if any(rebuilt[key] != value.get(key) for key in ("source", "inputs", "report", "previewSha256")):
            domain.fail("The retained forecast no longer matches its complete source calculation.", "FORECAST_CHANGED", 409)
        return value
    except (KeyError, TypeError, ValueError, AttributeError, ArithmeticError) as exc:
        domain.fail("The complete retained forecast is invalid: " + str(exc), "INVALID_FORECAST")


def summary(value):
    return {key: value[key] for key in ("id", "createdAt", "actor", "source", "sha256", "previewSha256")} | {
        "name": value["inputs"]["name"], "asOfDate": value["inputs"]["asOfDate"],
        "totals": value["report"]["totals"], "scenarios": value["report"]["scenarios"],
        "issueCount": len(value["report"]["issues"])}


def export(value):
    validate_saved(value)
    report = value["report"]
    files = {"forecast.json": (canonical(value) + "\n").encode(),
        "dated-cash.csv": csv_bytes(["date", "invoiceOutflowUsd", "packageOutflowUsd", "commercialOutflowUsd",
            "conditionalGrantInflowUsd", "forecastCustomerInflowUsd", "spendingOnlyDeltaUsd",
            "conditionalGrantDeltaUsd", "commercialDeltaUsd", "spendingOnlyBalanceUsd",
            "conditionalGrantBalanceUsd", "commercialBalanceUsd", "remainingWorkHours",
            "weeklyEquivalentHours", "availableWeeklyHours"], report["days"]),
        "cash-events.csv": csv_bytes(["date", "kind", "id", "title", "amountUsd", "conditional", "commercialId", "originalDueDate"], report["events"]),
        "remaining-work.csv": csv_bytes(["date", "projectId", "hours"], report["workDays"]),
        "package-estimates.csv": csv_bytes(["id", "tranche", "plannedUsd", "invoicedUsd", "paidUsd", "directPaidUsd",
            "baselineUninvoicedUsd", "remainingCostUsd", "plannedHours", "acceptedHours", "preawardHours",
            "remainingHours", "startDate", "endDate", "paymentMode", "estimateBasis", "note"], report["packages"]),
        "unpaid-invoices.csv": csv_bytes(["id", "number", "state", "totalUsd", "paidUsd", "openUsd", "overpaidUsd",
            "dueDate", "expectedPaymentDate", "included", "commercialId", "note"], report["invoices"]),
        "commercial-scenarios.csv": csv_bytes(["id", "title", "caseRef", "stage", "selected", "priceUsd",
            "observedReceiptsUsd", "uncollectedPriceUsd", "totalDeliveryCostUsd", "invoicedDeliveryUsd",
            "paidInvoiceUsd", "directPaidUsd", "remainingUninvoicedCostUsd", "openInvoiceUsd",
            "remainingHours", "startDate", "endDate", "sourceUrl", "scope", "note"], report["commercial"]),
        "conditional-grants.csv": csv_bytes(["tranche", "conditionalPlannedUsd", "observedGrantUsd", "remainingUsd",
            "originalDate", "forecastDate", "included", "note"], report["grants"]),
        "issues.csv": csv_bytes(["code", "id", "message", "amountUsd"], report["issues"]),
        "README.txt": ("SF47 retained operating forecast\n\n"
            "Mode: " + report["mode"] + "\nAs of: " + report["asOfDate"] + "\n"
            "This complete saved forecast contains its original case/plan snapshot, source identities, inputs and calculation. "
            "Return the complete operations case ZIP through the original workspace to reopen saved forecasts alongside original attachments and actual records.\n\n"
            "Forecasts create no financial observations. Recorded paid invoice allocations are removed once; package defaults retain the non-invoiced budget allocation. "
            "Commercial collections and associated costs are explicit scenarios. Native assets keep their original units. "
            "The optional opening amount is an explicitly entered end-of-day balance or assumption; it is never inferred from a quote or the original plan's capital input.\n").encode()}
    if "eventTiming" in report:
        files["event-dependent-timing.json"] = (canonical(report["eventTiming"]) + "\n").encode()
        files["event-dependent-work.csv"] = csv_bytes(["id", "title", "caseRef", "selected", "state",
            "startCondition", "deliveryBusinessDays", "startDate", "endDate", "undatedDeliveryCostUsd", "undatedHours"],
            report["eventTiming"]["projects"])
        files["event-dependent-receipts.csv"] = csv_bytes(["projectId", "id", "label", "condition", "amountUsd",
            "appliedObservedUsd", "remainingUsd", "date"], [{"projectId": row["id"], **receipt}
            for row in report["eventTiming"]["projects"] for receipt in row["receipts"]])
    manifest = {"schema": SCHEMA + ".bundle", "forecastId": value["id"], "forecastSha256": value["sha256"],
                "files": [{"path": name, "bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest()} for name, raw in sorted(files.items())]}
    files["MANIFEST.json"] = (canonical(manifest) + "\n").encode()
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
        for name, raw in sorted(files.items()):
            info = zipfile.ZipInfo(name, (2026, 1, 1, 0, 0, 0))
            info.external_attr, info.compress_type = 0o600 << 16, zipfile.ZIP_DEFLATED
            archive.writestr(info, raw)
    return output.getvalue()
