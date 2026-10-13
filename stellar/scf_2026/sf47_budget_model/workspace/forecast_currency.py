"""Explicit native-money valuation for the original SF47 forecast.

Quotes, payment credits and cost credits remain in their entered currencies.
Reference rates are retained scenario inputs. Recorded USD cash is unchanged.
"""
from __future__ import annotations

from copy import deepcopy
from datetime import date
from decimal import Decimal, localcontext, ROUND_HALF_UP, ROUND_HALF_EVEN
import re

import operations_domain as domain
from model import text, short_id, digest, canonical, csv_bytes

SCHEMA = "stellar-forge.sf47-currency-valuation.v1"
ZERO = Decimal(0)
CENT = Decimal("0.01")
ROUNDING = {"HALF_UP": ROUND_HALF_UP, "HALF_EVEN": ROUND_HALF_EVEN}


def fail(message):
    domain.fail(message, "INVALID_FORECAST_CURRENCY")


def obj(value, allowed, label):
    if not isinstance(value, dict) or set(value) - set(allowed):
        fail(label + ": use the declared currency fields.")
    return value


def rows(value, label, maximum=200):
    if not isinstance(value, list) or len(value) > maximum or any(not isinstance(x, dict) for x in value):
        fail(label + ": use at most " + str(maximum) + " object rows.")
    return value


def quantity(value, label, positive=False, places=8):
    with localcontext() as ctx:
        ctx.prec = 80
        return domain.quantity(value, label, places, positive)


def native(value):
    result = format(Decimal(value), "f")
    return result.rstrip("0").rstrip(".") if "." in result else result


def usd(value, rounding="HALF_UP"):
    if value is None:
        return None
    with localcontext() as ctx:
        ctx.prec = 80
        amount = Decimal(value)
        if not amount.is_finite() or amount < ZERO:
            fail("A valued money amount must be finite and nonnegative.")
        return format(amount.quantize(CENT, rounding=ROUNDING[rounding]), ".2f")


def code(value, label):
    value = text(value, label, 3, True).upper()
    if not re.fullmatch(r"[A-Z]{3}", value):
        fail(label + ": enter a three-letter currency code.")
    return value


def no_usd_fields(raw, names, label):
    if any(raw.get(name) not in (None, "") for name in names):
        fail(label + ": retain native amounts or legacy USD inputs, not both.")


def normalize_rates(context, raw, as_of):
    result, seen = [], set()
    for row in rows(raw, "Retained exchange rates", 100):
        obj(row, ("id", "baseCurrency", "quoteCurrency", "rate", "observationDate", "publicationDate",
                  "basis", "rounding", "sourceUrl", "sourceIds", "sourceReference", "note"), "Exchange rate")
        ident = short_id(row.get("id"), "Exchange-rate identity")
        if ident in seen:
            fail("Exchange-rate identities must be distinct.")
        seen.add(ident)
        base = code(row.get("baseCurrency"), "Rate base currency")
        quote = code(row.get("quoteCurrency"), "Rate quote currency")
        if base == quote or "USD" not in (base, quote):
            fail("Each retained rate must directly relate USD to one different currency.")
        observation = domain.calendar(row.get("observationDate"), "Rate observation / assumption date")
        publication = domain.calendar(row.get("publicationDate"), "Rate publication date", True)
        if observation > as_of or (publication and (publication < observation or publication > as_of)):
            fail("Retain the rate's observation and publication through the forecast as-of date.")
        basis = domain.enum(row.get("basis"), ("REFERENCE_OBSERVATION", "PLANNING_ASSUMPTION"), "Rate basis")
        rounding = domain.enum(row.get("rounding"), tuple(ROUNDING), "USD cent rounding")
        source_ids = domain.reference_list(row.get("sourceIds", []), context["sources"], "Rate sources")
        source_url = domain.url(row.get("sourceUrl", ""), "Rate source URL")
        note = text(row.get("note", ""), "Rate interpretation / assumption", 4000)
        if basis == "REFERENCE_OBSERVATION" and not (source_ids or source_url):
            fail("A reference observation needs its source URL or original attachment.")
        if basis == "PLANNING_ASSUMPTION" and not note:
            fail("A planning rate needs its explicit assumption.")
        result.append({"id": ident, "baseCurrency": base, "quoteCurrency": quote,
            "rate": quantity(row.get("rate"), "Units of quote currency per one base currency", True, 18),
            "observationDate": observation, "publicationDate": publication,
            "basis": basis, "rounding": rounding, "sourceUrl": source_url, "sourceIds": source_ids,
            "sourceReference": text(row.get("sourceReference", ""), "Rate source edition / series", 1000),
            "note": note})
    return result


def normalize_money(raw, rate_map, label, positive=False):
    obj(raw, ("amount", "currency", "fxRateId"), label)
    currency = code(raw.get("currency"), label + " currency")
    amount = quantity(raw.get("amount"), label + " amount", positive, 2 if currency == "USD" else 8)
    rate_id = raw.get("fxRateId")
    if rate_id in (None, ""):
        rate_id = None
    else:
        rate_id = short_id(rate_id, label + " rate")
        if rate_id not in rate_map:
            fail(label + ": the selected rate is unavailable.")
    if currency == "USD" and rate_id is not None:
        fail(label + ": USD uses its original amount without a second exchange rate.")
    if rate_id is not None and {currency, "USD"} != {rate_map[rate_id]["baseCurrency"], rate_map[rate_id]["quoteCurrency"]}:
        fail(label + ": select a rate between its native currency and USD.")
    return {"amount": amount, "currency": currency, "fxRateId": rate_id}


def normalize_pricing(raw, rate_map, cash_ids, invoice_ids, direct_ids, invoice_map):
    obj(raw, ("price", "deliveryCost", "priceCredits", "costCredits"), "Native commercial pricing")
    price = normalize_money(raw.get("price"), rate_map, "Original native price", True)
    cost = normalize_money(raw.get("deliveryCost"), rate_map, "Native total delivery-cost estimate")
    price_credits, seen = [], set()
    for row in rows(raw.get("priceCredits", []), "Quoted-currency receipt credits"):
        obj(row, ("cashId", "amount", "note"), "Receipt credit")
        ident = row.get("cashId")
        if ident not in cash_ids or ident in seen:
            fail("Each native receipt credit must select one distinct original customer cash record.")
        if price["currency"] == "USD":
            fail("USD receipts use the original recorded USD value.")
        seen.add(ident)
        price_credits.append({"cashId": ident, "amount": quantity(row.get("amount"), "Credit in quoted currency"),
                              "note": text(row.get("note"), "Native amount credited / source basis", 4000, True)})
    active_invoices = {ident for ident in invoice_ids if invoice_map[ident]["state"] != "VOID"}
    cost_credits, seen = [], set()
    for row in rows(raw.get("costCredits", []), "Native invoiced and directly paid cost credits"):
        obj(row, ("kind", "id", "amount", "note"), "Cost credit")
        kind = domain.enum(row.get("kind"), ("INVOICE", "DIRECT_CASH"), "Original cost record kind")
        ident = row.get("id")
        key = (kind, ident)
        if ident not in (active_invoices if kind == "INVOICE" else direct_ids) or key in seen:
            fail("Each native cost credit must select a distinct active invoice or assigned direct cash expense.")
        if cost["currency"] == "USD":
            fail("USD delivery costs use the original invoiced and directly paid USD values.")
        seen.add(key)
        cost_credits.append({"kind": kind, "id": ident, "amount": quantity(row.get("amount"), "Cost credited in estimate currency"),
                             "note": text(row.get("note"), "Native cost amount / source basis", 4000, True)})
    return {"price": price, "deliveryCost": cost, "priceCredits": price_credits, "costCredits": cost_credits}


def convert(amount, source, rate_map):
    amount = Decimal(amount)
    if amount == ZERO:
        return "0.00"
    if source["currency"] == "USD":
        return usd(amount)
    rate = rate_map.get(source["fxRateId"])
    if rate is None:
        return None
    with localcontext() as ctx:
        ctx.prec = 80
        quoted = Decimal(rate["rate"])
        value = amount * quoted if rate["quoteCurrency"] == "USD" else amount / quoted
        return domain.usd(usd(value, rate["rounding"]), "Converted original amount")


def allocate(amounts, source, rate_map):
    """Convert cumulative native amounts, retaining the exact converted total."""
    total, prior, result = ZERO, ZERO, []
    for amount in amounts:
        total += Decimal(amount)
        current = convert(total, source, rate_map)
        if current is None:
            result.append(None)
        else:
            part = Decimal(current) - prior
            result.append(usd(part))
            prior = Decimal(current)
    return result


def money_details(source, rate_map):
    rate = rate_map.get(source["fxRateId"])
    amount_usd = convert(source["amount"], source, rate_map)
    return {**deepcopy(source), "amountUsd": amount_usd,
        "state": "VALUED" if amount_usd is not None else "FX_RATE_REQUIRED",
        "reportingCurrency": "USD", "rate": deepcopy(rate),
        "rounding": rate["rounding"] if rate else "HALF_UP" if source["currency"] == "USD" else None,
        "formula": "USD = original USD" if source["currency"] == "USD" else
                   None if rate is None else "USD = " + source["currency"] + (" * " if rate["quoteCurrency"] == "USD" else " / ") + rate["rate"]}


def materialize(row, rate_map, cash, invoices):
    """Join original native inputs to explicit valuations and original USD records."""
    source = row["nativePricing"]
    price, cost = source["price"], source["deliveryCost"]
    observed_usd = sum((Decimal(cash[cid]["usdValue"]) for cid in row["cashIds"]), ZERO)
    direct_usd = sum((Decimal(cash[cid]["usdValue"]) for cid in row["directCashIds"]), ZERO)
    invoiced_usd = sum((Decimal(invoices[iid]["totalUsd"]) for iid in row["invoiceIds"] if invoices[iid]["state"] != "VOID"), ZERO)
    price_credit_map = {item["cashId"]: item for item in source["priceCredits"]}
    missing_price = [] if price["currency"] == "USD" else [ident for ident in row["cashIds"] if ident not in price_credit_map]
    paid_native = observed_usd if price["currency"] == "USD" else sum((Decimal(item["amount"]) for item in source["priceCredits"]), ZERO)
    price_complete = not missing_price
    amounts = [Decimal(item["amountNative"]) for item in row["receipts"]]
    original_usd = allocate(amounts, price, rate_map)
    outstanding_native, applied_native, left = [], [], paid_native
    for amount in amounts:
        applied = min(left, amount)
        left -= applied
        applied_native.append(applied)
        outstanding_native.append(amount - applied)
    outstanding_usd = allocate(outstanding_native, price, rate_map) if price_complete else [None] * len(amounts)
    credit_usd = allocate(applied_native, price, rate_map) if price_complete else [None] * len(amounts)
    receipts = []
    for index, receipt in enumerate(row["receipts"]):
        quoted_usd, remaining_usd = original_usd[index], outstanding_usd[index]
        independent = convert(amounts[index], price, rate_map)
        independent_remaining = convert(outstanding_native[index], price, rate_map) if price_complete else None
        independent_credit = convert(applied_native[index], price, rate_map) if price_complete else None
        receipts.append({**deepcopy(receipt), "amountUsd": quoted_usd,
            "appliedObservedUsd": usd(applied_native[index]) if price["currency"] == "USD" else None,
            "remainingUsd": remaining_usd,
            "appliedNative": native(applied_native[index]) if price_complete else None,
            "remainingNative": native(outstanding_native[index]) if price_complete else None,
            "valuedNativeCreditUsd": credit_usd[index],
            "creditRoundingUsd": native(Decimal(credit_usd[index]) - Decimal(independent_credit)) if credit_usd[index] is not None else None,
            "settlementRoundingUsd": native(Decimal(quoted_usd) - Decimal(credit_usd[index]) - Decimal(remaining_usd))
                if quoted_usd is not None and credit_usd[index] is not None and remaining_usd is not None else None,
            "valuationRoundingUsd": native(Decimal(quoted_usd) - Decimal(independent)) if quoted_usd is not None else None,
            "remainingRoundingUsd": native(Decimal(remaining_usd) - Decimal(independent_remaining)) if remaining_usd is not None else None})
    needed_cost = [("INVOICE", ident) for ident in row["invoiceIds"] if invoices[ident]["state"] != "VOID"] + [("DIRECT_CASH", ident) for ident in row["directCashIds"]]
    cost_credit_map = {(item["kind"], item["id"]): item for item in source["costCredits"]}
    missing_cost = [] if cost["currency"] == "USD" else [{"kind": kind, "id": ident} for kind, ident in needed_cost if (kind, ident) not in cost_credit_map]
    used_native = invoiced_usd + direct_usd if cost["currency"] == "USD" else sum((Decimal(item["amount"]) for item in source["costCredits"]), ZERO)
    remaining_cost_native = max(ZERO, Decimal(cost["amount"]) - used_native) if not missing_cost else None
    remaining_cost_usd = convert(remaining_cost_native, cost, rate_map) if remaining_cost_native is not None else None
    quoted_cost_usd = convert(cost["amount"], cost, rate_map)
    effective_cost_usd = quoted_cost_usd if cost["currency"] == "USD" else (usd(invoiced_usd + direct_usd + Decimal(remaining_cost_usd)) if remaining_cost_usd is not None else None)
    pricing = {"schema": SCHEMA, "price": money_details(price, rate_map), "deliveryCost": money_details(cost, rate_map),
        "priceCredits": deepcopy(source["priceCredits"]), "costCredits": deepcopy(source["costCredits"]),
        "missingPriceCreditCashIds": missing_price, "missingCostCredits": missing_cost,
        "creditedPriceNative": native(paid_native) if price_complete else None,
        "knownCreditedPriceNative": native(paid_native),
        "unallocatedObservedUsd": usd(sum((Decimal(cash[ident]["usdValue"]) for ident in missing_price), ZERO)),
        "uncollectedPriceNative": native(sum(outstanding_native, ZERO)) if price_complete else None,
        "overCreditNative": native(left) if price_complete else None,
        "creditedCostNative": native(used_native) if not missing_cost else None,
        "knownCreditedCostNative": native(used_native),
        "remainingCostNative": native(remaining_cost_native) if remaining_cost_native is not None else None,
        "costOverrunNative": native(max(ZERO, used_native - Decimal(cost["amount"]))) if not missing_cost else None,
        "quotedTotalDeliveryCostUsd": quoted_cost_usd, "effectiveTotalDeliveryCostUsd": effective_cost_usd,
        "milestoneRounding": "CUMULATIVE_NATIVE_TOTAL_TO_USD_CENTS",
        "settlementRoundingBasis": "Quote, credited and remaining native totals are each converted cumulatively. The signed settlement rounding bridges those separately rounded allocations; it does not change the original native amounts or recorded cash.",
        "creditBasis": "Native credits are explicitly linked to original records. Their planning valuation does not replace recorded USD cash or invoice values."}
    result = {**deepcopy(row), "priceUsd": convert(price["amount"], price, rate_map),
        "totalDeliveryCostUsd": effective_cost_usd, "receipts": receipts, "currencyValuation": pricing}
    remaining_price_usd = convert(sum(outstanding_native, ZERO), price, rate_map) if price_complete else None
    return result, remaining_cost_usd, remaining_price_usd


def coverage(commercial, rate_map, as_of):
    selected = [row for row in commercial if row["selected"] and "nativePricing" in row]
    entries = []
    for row in selected:
        valuation = row["currencyValuation"]
        price_complete = row["priceUsd"] is not None and row["uncollectedPriceUsd"] is not None
        cost_complete = row["remainingUninvoicedCostUsd"] is not None
        missing_dated_receipts = [receipt["id"] for receipt in row["receipts"] if receipt["date"] and receipt["remainingUsd"] is None]
        missing_dated_cost = row["startDate"] is not None and row["remainingUninvoicedCostUsd"] is None
        entries.append({"id": row["id"], "title": row["title"], "caseRef": row["caseRef"],
            "priceCurrency": row["nativePricing"]["price"]["currency"],
            "costCurrency": row["nativePricing"]["deliveryCost"]["currency"],
            "priceComplete": price_complete, "costComplete": cost_complete,
            "datedCashComplete": not missing_dated_receipts and not missing_dated_cost,
            "missingDatedReceiptIds": missing_dated_receipts, "missingDatedDeliveryCost": missing_dated_cost,
            "valuation": deepcopy(valuation)})
    return {"schema": SCHEMA, "reportingCurrency": "USD",
        "complete": all(row["priceComplete"] and row["costComplete"] for row in entries),
        "datedCashComplete": all(row["datedCashComplete"] for row in entries),
        "selectedNativeProjects": len(entries),
        "unresolvedProjectIds": [row["id"] for row in entries if not row["priceComplete"] or not row["costComplete"]],
        "projects": entries,
        "rates": [{**deepcopy(rate), "sourceSha256": digest(rate),
                   "ageDays": (date.fromisoformat(as_of) - date.fromisoformat(rate["observationDate"])).days}
                  for rate in rate_map.values()],
        "basis": "Original currencies and credited native amounts are retained. Each rate states one base unit in quote currency, its date, source and USD-cent rounding. Missing valuations remain empty. Known cash curves contain only valued dated flows."}


def export_files(report):
    """Portable native amounts, credit joins and dated valuation coverage."""
    if "currencyValuation" not in report:
        return {}
    rates, projects, receipts, credits = [], [], [], []
    for rate in report["currencyValuation"]["rates"]:
        rates.append({**rate, "sourceIds": ",".join(rate["sourceIds"])})
    for row in report["commercial"]:
        if "nativePricing" not in row:
            continue
        valuation = row["currencyValuation"]
        for role, amount in (("QUOTE", valuation["price"]), ("DELIVERY_COST", valuation["deliveryCost"])):
            projects.append({"projectId": row["id"], "title": row["title"], "caseRef": row["caseRef"],
                "selected": row["selected"], "role": role, "amountNative": amount["amount"],
                "currency": amount["currency"], "amountUsd": amount["amountUsd"], "state": amount["state"],
                "fxRateId": amount["fxRateId"], "rounding": amount["rounding"], "formula": amount["formula"],
                "remainingNative": valuation["uncollectedPriceNative"] if role == "QUOTE" else valuation["remainingCostNative"],
                "remainingUsd": row["uncollectedPriceUsd"] if role == "QUOTE" else row["remainingUninvoicedCostUsd"],
                "recordedUsd": row["observedReceiptsUsd"] if role == "QUOTE" else
                    usd(Decimal(row["invoicedDeliveryUsd"]) + Decimal(row["directPaidUsd"]))})
        for receipt in row["receipts"]:
            receipts.append({"projectId": row["id"], "currency": row["nativePricing"]["price"]["currency"],
                "fxRateId": row["nativePricing"]["price"]["fxRateId"], **receipt})
        for credit in valuation["priceCredits"]:
            credits.append({"projectId": row["id"], "role": "QUOTE_RECEIPT", "kind": "CUSTOMER_CASH",
                "recordId": credit["cashId"], "amountNative": credit["amount"],
                "currency": row["nativePricing"]["price"]["currency"], "note": credit["note"]})
        for credit in valuation["costCredits"]:
            credits.append({"projectId": row["id"], "role": "DELIVERY_COST", "kind": credit["kind"],
                "recordId": credit["id"], "amountNative": credit["amount"],
                "currency": row["nativePricing"]["deliveryCost"]["currency"], "note": credit["note"]})
    return {
        "currency-valuation.json": (canonical(report["currencyValuation"]) + "\n").encode(),
        "retained-exchange-rates.csv": csv_bytes(["id", "baseCurrency", "quoteCurrency", "rate", "observationDate",
            "publicationDate", "basis", "rounding", "sourceUrl", "sourceIds", "sourceReference", "note",
            "sourceSha256", "ageDays"], rates),
        "native-commercial-pricing.csv": csv_bytes(["projectId", "title", "caseRef", "selected", "role",
            "amountNative", "currency", "amountUsd", "state", "fxRateId", "rounding", "formula",
            "remainingNative", "remainingUsd", "recordedUsd"], projects),
        "native-commercial-receipts.csv": csv_bytes(["projectId", "id", "label", "date", "amountNative", "currency",
            "fxRateId", "amountUsd", "appliedNative", "remainingNative", "appliedObservedUsd", "remainingUsd",
            "valuedNativeCreditUsd", "valuationRoundingUsd", "creditRoundingUsd", "remainingRoundingUsd",
            "settlementRoundingUsd"], receipts),
        "native-record-credits.csv": csv_bytes(["projectId", "role", "kind", "recordId", "amountNative", "currency", "note"], credits),
        "known-commercial-cash.csv": csv_bytes(["date", "commercialDeltaUsd", "commercialBalanceUsd",
            "knownCommercialDeltaUsd", "knownCommercialBalanceUsd", "commercialOutflowUsd",
            "forecastCustomerInflowUsd"], report["days"]),
        "CURRENCY-VALUATION.txt": (
            "Original quoted amounts and cost estimates retain their currencies.\n"
            "Each retained rate states 1 base currency unit = rate quote currency units, source, dates and cent rounding.\n"
            "Native receipt and cost credits are linked to original case records. Recorded USD cash and invoice values stay at their original amounts.\n"
            "Cumulative milestone conversion conserves each converted total. Separate quote/credited/remaining allocations expose their signed cent reconciliation.\n"
            "A blank valuation means the selected rate or native credit basis is incomplete. Known-only figures retain the valued part of the selected scenario.\n"
            "The full forecast JSON retains source records, original inputs, every rate and complete calculation.\n").encode()}
