"""Customer delivery funding protection within the original saved Forecast.

This optional planning restriction is not an account, escrow or payment writer.
Legacy Forecast inputs and reports are unchanged when the option is absent.
"""
from __future__ import annotations

from collections import defaultdict
from copy import deepcopy
from decimal import Decimal, localcontext
import json

import operations_domain as domain
from model import canonical, csv_bytes, text

SCHEMA = "stellar-forge.forecast-customer-funding.v1"
ZERO = Decimal("0")


def _money(value):
    return format(value.quantize(Decimal("0.01")), ".2f")


def _object(value, keys, label):
    if not isinstance(value, dict) or set(value) - set(keys):
        domain.fail(label + ": retain the declared funding fields.", "INVALID_FORECAST")
    return value


def normalize(context, raw, commercial, opening_cash, as_of):
    raw = _object(deepcopy(raw), ("enabled", "opening", "note"), "Customer funding protection")
    enabled = raw.get("enabled")
    if not isinstance(enabled, bool):
        domain.fail("Choose whether customer funding protection is enabled.", "INVALID_FORECAST")
    values = raw.get("opening", [])
    if not isinstance(values, list) or len(values) > 50:
        domain.fail("Retain at most 50 original customer opening attributions.", "INVALID_FORECAST")
    projects = {row["id"]: row for row in commercial}
    cash = {row["id"]: row for row in context["records"]["cash"]}
    sources = context["sources"]
    by_id = {}
    for value in values:
        row = _object(value, ("commercialId", "amountUsd", "basis", "cashIds", "sourceIds", "note"),
                      "Customer opening attribution")
        ident = row.get("commercialId")
        if not isinstance(ident, str) or ident not in projects or ident in by_id:
            domain.fail("Attribute opening funds once to an existing original customer scenario.", "INVALID_FORECAST")
        amount = row.get("amountUsd")
        amount = None if amount in (None, "") else domain.usd(amount, "Unspent customer-attributed opening USD")
        basis = domain.enum(row.get("basis", "NOT_ENTERED"),
                            ("NOT_ENTERED", "OBSERVED_BALANCE", "PLANNING_ASSUMPTION"), "Customer opening basis")
        cash_ids = domain.reference_list(row.get("cashIds", []), cash, "Original customer receipt evidence")
        for cid in cash_ids:
            original = cash[cid]
            if (cid not in projects[ident]["cashIds"] or original["state"] != "OBSERVED"
                    or original["date"] > as_of or original["direction"] != "IN"
                    or original["category"] != "CUSTOMER" or original["usdValue"] is None
                    or "testnet" in original.get("network", "").lower()):
                domain.fail("Opening receipt evidence must remain with this customer's original observed, valued receipts through the as-of date.",
                            "FORECAST_CASH_CONFLICT", 409)
        source_ids = domain.reference_list(row.get("sourceIds", []), sources, "Customer balance sources")
        note = text(row.get("note", ""), "Customer opening balance reconciliation / assumption", 4000)
        if amount is None and basis != "NOT_ENTERED":
            domain.fail("Enter an explicit opening attribution for its stated basis, or retain Not entered.", "INVALID_FORECAST")
        if amount is not None:
            if basis == "NOT_ENTERED" or not note:
                domain.fail("Every entered customer opening amount, including zero, needs its explicit basis and reconciliation note.",
                            "INVALID_FORECAST")
            if basis == "OBSERVED_BALANCE" and not (cash_ids or source_ids):
                domain.fail("An observed customer balance needs its retained receipt or balance-source evidence.", "INVALID_FORECAST")
        by_id[ident] = {"commercialId": ident, "amountUsd": amount, "basis": basis,
                        "cashIds": cash_ids, "sourceIds": source_ids, "note": note}
    result = []
    for project in commercial:
        result.append(by_id.get(project["id"], {"commercialId": project["id"], "amountUsd": None,
                     "basis": "NOT_ENTERED", "cashIds": [], "sourceIds": [], "note": ""}))
    if enabled and opening_cash["amountUsd"] is not None:
        total = sum((Decimal(row["amountUsd"]) for row in result if row["amountUsd"] is not None), ZERO)
        if total > Decimal(opening_cash["amountUsd"]):
            domain.fail("Known customer-attributed opening funds cannot exceed the entered total opening available cash.",
                        "INVALID_FORECAST")
    return {"enabled": enabled, "opening": result,
            "note": text(raw.get("note", ""), "Customer funding policy / scope", 8000)}


def build(report, inputs):
    """Use native events and remaining obligations, never gross invoices twice."""
    with localcontext() as ctx:
        ctx.prec = 80
        return _build(report, inputs)


def _build(report, inputs):
    result = {"schema": SCHEMA, "enabled": inputs["enabled"], "opening": deepcopy(inputs["opening"]),
              "note": inputs["note"], "basis":
              "Planning protection of customer-attributed funds for remaining modeled delivery. "
              "Opening attributions are explicit reconciled amounts or assumptions, not gross receipts or inferred bank balances. "
              "Included linked invoices remain obligations even when speculative customer work is deselected. "
              "Unknown valuation and undated scope remain visible. This is not legal escrow, restricted bank cash or a financial observation."}
    if not inputs["enabled"]:
        return result
    original = {row["commercialId"]: row for row in inputs["opening"]}
    projects, states = [], {}
    by_day = defaultdict(list)
    for event in report["events"]:
        if event.get("commercialId") in original and event["kind"] in ("FORECAST_CUSTOMER", "COMMERCIAL_COST", "INVOICE"):
            by_day[event["date"]].append(event)
    for row in report["commercial"]:
        ident = row["id"]
        opening = original[ident]
        invoices = [invoice for invoice in report["invoices"]
                    if invoice.get("commercialId") == ident and invoice["included"]]
        invoice_cost = sum((Decimal(invoice["openUsd"]) for invoice in invoices), ZERO)
        uninvoiced = row["remainingUninvoicedCostUsd"] if row["selected"] else "0.00"
        obligation = None if uninvoiced is None else Decimal(uninvoiced) + invoice_cost
        unknown_inflow_dates = sorted(receipt["date"] for receipt in row["receipts"]
                                      if row["selected"] and receipt["date"] and receipt["remainingUsd"] is None)
        unknown_outflow_date = None
        if row["selected"] and uninvoiced is None and row["startDate"] and row["endDate"]:
            unknown_outflow_date = row["endDate"] if row["paymentMode"] == "completion" else row["startDate"]
        states[ident] = {"cash": None if opening["amountUsd"] is None else Decimal(opening["amountUsd"]),
                         "remaining": obligation, "unknownInflowDates": unknown_inflow_dates,
                         "unknownOutflowDate": unknown_outflow_date}
        projects.append({"commercialId": ident, "title": row["title"], "caseRef": row["caseRef"],
                         "selected": row["selected"], "stage": row["stage"],
                         "opening": deepcopy(opening),
                         "includedInvoiceIds": [invoice["id"] for invoice in invoices],
                         "includedInvoiceCostUsd": _money(invoice_cost),
                         "selectedRemainingUninvoicedCostUsd": uninvoiced,
                         "remainingObligationUsd": None if obligation is None else _money(obligation),
                         "undatedUninvoicedCostUsd": uninvoiced if row["selected"] and row["startDate"] is None else "0.00",
                         "unknownDatedReceiptIds": [receipt["id"] for receipt in row["receipts"]
                             if row["selected"] and receipt["date"] and receipt["remainingUsd"] is None],
                         "originalSourceIds": deepcopy(row["sourceIds"])})
    opening_total = report["openingCash"]["amountUsd"]
    opening_total = None if opening_total is None else Decimal(opening_total)
    days, customer_days = [], []
    low, low_date = ZERO, report["asOfDate"]
    known_low, known_low_date = ZERO, report["asOfDate"]
    complete = True
    for day in report["days"]:
        stamp = day["date"]
        movements = {ident: {"inflow": ZERO, "outflow": ZERO, "eventIds": []} for ident in states}
        for event in by_day[stamp]:
            ident = event["commercialId"]
            value = Decimal(event["amountUsd"])
            state = states[ident]
            if state["cash"] is not None:
                state["cash"] += value
            if value >= ZERO:
                movements[ident]["inflow"] += value
            else:
                movements[ident]["outflow"] -= value
                if state["remaining"] is not None:
                    state["remaining"] = max(ZERO, state["remaining"] + value)
            movements[ident]["eventIds"].append({"kind": event["kind"], "id": event["id"]})
        reserved_known, unknown = ZERO, []
        for project in projects:
            ident = project["commercialId"]
            state, moved = states[ident], movements[ident]
            if any(date <= stamp for date in state["unknownInflowDates"]) or (
                    state["unknownOutflowDate"] and state["unknownOutflowDate"] <= stamp):
                state["cash"] = None
            balance, remaining = state["cash"], state["remaining"]
            if remaining == ZERO or (balance is not None and balance <= ZERO):
                held = ZERO
            elif balance is None or remaining is None:
                held = None
            else:
                held = min(balance, remaining)
            if held is None:
                unknown.append(ident)
            else:
                reserved_known += held
            customer_days.append({"date": stamp, "commercialId": ident, "title": project["title"],
                                  "openingAttributedUsd": project["opening"]["amountUsd"],
                                  "forecastInflowUsd": _money(moved["inflow"]),
                                  "includedCostOutflowUsd": _money(moved["outflow"]),
                                  "attributedBalanceUsd": None if balance is None else _money(balance),
                                  "remainingObligationUsd": None if remaining is None else _money(remaining),
                                  "reservedUsd": None if held is None else _money(held),
                                  "unknownFlowActive": bool((state["unknownOutflowDate"] and state["unknownOutflowDate"] <= stamp)
                                      or any(date <= stamp for date in state["unknownInflowDates"])),
                                  "eventIds": moved["eventIds"]})
        reserved = None if unknown else reserved_known
        pooled = day["commercialDeltaUsd"]
        known_pooled = day.get("knownCommercialDeltaUsd", pooled)
        unreserved = None if pooled is None or reserved is None else Decimal(pooled) - reserved
        known_unreserved = None if known_pooled is None else Decimal(known_pooled) - reserved_known
        if unreserved is None:
            complete = False
        elif unreserved < low:
            low, low_date = unreserved, stamp
        if known_unreserved is not None and known_unreserved < known_low:
            known_low, known_low_date = known_unreserved, stamp
        days.append({"date": stamp, "pooledDeltaUsd": pooled,
                     "pooledAvailableCashUsd": day["commercialBalanceUsd"],
                     "reservedCustomerFundsUsd": None if reserved is None else _money(reserved),
                     "unreservedDeltaUsd": None if unreserved is None else _money(unreserved),
                     "unreservedAvailableCashUsd": None if unreserved is None or opening_total is None else _money(opening_total + unreserved),
                     "knownReservedCustomerFundsUsd": _money(reserved_known),
                     "knownUnreservedDeltaUsd": None if known_unreserved is None else _money(known_unreserved),
                     "unknownReservationCustomerIds": unknown})
    required = max(ZERO, -low) if complete else None
    known_required = max(ZERO, -known_low)
    last = days[-1] if days else None
    result.update({"projects": projects, "days": days, "customerDays": customer_days,
                   "summary": {"reservationAndDatedCashComplete": complete,
                               "maximumRequiredStartingCashUsd": None if required is None else _money(required),
                               "extraFundingAfterOpeningUsd": None if required is None or opening_total is None
                                   else _money(max(ZERO, required - opening_total)),
                               "peakNeedDate": low_date if complete else None,
                               "endReservedCustomerFundsUsd": last["reservedCustomerFundsUsd"] if last else "0.00",
                               "endUnreservedAvailableCashUsd": last["unreservedAvailableCashUsd"] if last else None,
                               "knownPortionRequiredStartingCashUsd": _money(known_required),
                               "knownPortionPeakDate": known_low_date,
                               "unknownOpeningCustomerIds": [p["commercialId"] for p in projects if p["opening"]["amountUsd"] is None],
                               "unvaluedRemainingObligationCustomerIds": [p["commercialId"] for p in projects if p["remainingObligationUsd"] is None],
                               "undatedRemainingObligationCustomerIds": [p["commercialId"] for p in projects
                                   if p["undatedUninvoicedCostUsd"] is None or Decimal(p["undatedUninvoicedCostUsd"]) > ZERO]},
                   "interpretation": "Required starting cash includes protected customer funds; extra funding subtracts only the explicitly entered total opening cash. "
                     "Known portions omit unknown flows or reservations and are not a complete funding requirement or a lower bound. "
                     "Undated delivery costs remain protected but have no invented cash-payment date. All balances are end-of-day."})
    return result


def export_files(report):
    if "customerFunding" not in report:
        return {}
    funding = report["customerFunding"]
    files = {"customer-funding.json": (canonical(funding) + "\n").encode()}
    if not funding["enabled"]:
        return files
    files["customer-funding-daily.csv"] = csv_bytes(
        ["date", "pooledDeltaUsd", "pooledAvailableCashUsd", "reservedCustomerFundsUsd",
         "unreservedDeltaUsd", "unreservedAvailableCashUsd", "knownReservedCustomerFundsUsd",
         "knownUnreservedDeltaUsd", "unknownReservationCustomerIds"], funding["days"])
    safe_rows = []
    for row in funding["customerDays"]:
        item = deepcopy(row)
        title = item["title"]
        if title.lstrip(" \t\r\n").startswith(("=", "+", "-", "@")):
            item["title"] = "'" + title
        item["eventIds"] = json.dumps(item["eventIds"], ensure_ascii=False, separators=(",", ":"))
        safe_rows.append(item)
    files["customer-funding-obligations.csv"] = csv_bytes(
        ["date", "commercialId", "title", "openingAttributedUsd", "forecastInflowUsd",
         "includedCostOutflowUsd", "attributedBalanceUsd", "remainingObligationUsd",
         "reservedUsd", "unknownFlowActive", "eventIds"], safe_rows)
    return files
