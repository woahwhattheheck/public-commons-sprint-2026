"""Dated management reports from the original Grant Operations records."""
from __future__ import annotations

from collections import defaultdict
from datetime import date, timedelta
from decimal import Decimal
import hashlib
import html
import io
import json
import zipfile

import operations_domain as domain
from model import canonical, digest, csv_bytes, MAX_BUNDLE

SCHEMA = "stellar-forge.sf47-performance.v1"
ZERO = Decimal("0")
MONEY_FIELDS = ("invoicedUsd", "paidUsd", "openUsd", "creditUsd")
WORK_FIELDS = ("recordedHours", "acceptedHours", "preawardHours")
PACKAGE_FIELDS = ("id", "category", "tranche", "plannedUsd", "plannedHours",
    "openingInvoicedUsd", "periodInvoicedUsd", "closingInvoicedUsd",
    "openingPaidUsd", "periodPaidUsd", "closingPaidUsd", "remainingBudgetUsd",
    "invoiceVarianceUsd", "periodRecordedHours", "periodAcceptedHours",
    "closingRecordedHours", "closingAcceptedHours", "hoursRemaining")
INVOICE_FIELDS = ("id", "number", "contributorId", "contributor", "state",
    "issuedDate", "dueDate", "sourceTotalUsd", "openingLiabilityUsd",
    "periodInvoicedUsd", "closingLiabilityUsd", "openingPaidUsd",
    "periodPaidUsd", "closingPaidUsd", "openUsd", "creditUsd",
    "overdueDays", "aging", "sourceIds")
CONTRIBUTOR_FIELDS = ("id", "name", "periodRecordedHours", "periodAcceptedHours",
    "closingRecordedHours", "closingAcceptedHours", "periodInvoicedUsd",
    "closingInvoicedUsd", "periodPaidUsd", "closingPaidUsd", "openUsd", "creditUsd")
WORK_DETAIL_FIELDS = ("id", "state", "contributorId", "contributor", "costId",
    "description", "startDate", "endDate", "hours", "fundingBasis",
    "inPeriod", "spansPeriodStart", "sourceIds")
CASH_DETAIL_FIELDS = ("id", "state", "date", "direction", "category", "currency",
    "network", "asset", "amount", "usdValue", "externalRef", "inPeriod",
    "includedInUsd", "usdBasis", "sourceIds")
DAY_FIELDS = ("date", "inUsd", "outUsd", "netUsd", "recordedNetCashUsd",
    "invoicedUsd", "invoicePaidUsd", "recordedHours", "acceptedHours")


def money(value):
    return format(value, ".2f")


def hours(value):
    rendered = format(value, "f")
    return rendered.rstrip("0").rstrip(".") if "." in rendered else rendered


def selection(context, start_date=None, end_date=None):
    end = domain.calendar(end_date or date.today().isoformat(), "Report end")
    start = domain.calendar(start_date, "Report start", True)
    if start and start > end:
        domain.fail("Report start must be on or before report end.", "INVALID_PERFORMANCE_PERIOD")
    return {"startDate": start, "endDate": end,
            "workRecognition": "COMPLETION_DATE",
            "recordStateBasis": "SELECTED_CASE_VERSION"}


def _in_period(stamp, selected):
    return stamp <= selected["endDate"] and (
        selected["startDate"] is None or stamp >= selected["startDate"])


def _before_period(stamp, selected):
    return selected["startDate"] is not None and stamp < selected["startDate"]


def _valid_cash(row):
    return row["state"] != "VOID" and "testnet" not in row.get("network", "").lower()


def _valued_cash(row):
    return _valid_cash(row) and row["usdValue"] is not None


def _work_amounts(rows):
    return {"recordedHours": sum((Decimal(r["hours"]) for r in rows if r["state"] != "VOID"), ZERO),
            "acceptedHours": sum((Decimal(r["hours"]) for r in rows if r["state"] == "ACCEPTED"), ZERO),
            "preawardHours": sum((Decimal(r["hours"]) for r in rows
                                 if r["state"] != "VOID" and r["fundingBasis"] == "PREAWARD"), ZERO)}


def _financial(invoices, cash, cutoff):
    """Use native source liabilities and the original payment/refund signs."""
    paid = defaultdict(lambda: ZERO)
    cash_in, cash_out, grant_in, customer_in = ZERO, ZERO, ZERO, ZERO
    for row in cash:
        if cutoff is None or row["date"] > cutoff or not _valued_cash(row):
            continue
        value = Decimal(row["usdValue"])
        if row["direction"] == "IN":
            cash_in += value
            if row["category"] == "GRANT":
                grant_in += value
            if row["category"] == "CUSTOMER":
                customer_in += value
        else:
            cash_out += value
        for item in row["allocations"]:
            paid[item["invoiceId"]] += Decimal(item["amountUsd"]) * (
                1 if row["direction"] == "OUT" else -1)
    liability, opened, credit = ZERO, ZERO, ZERO
    invoice_rows = {}
    for row in invoices:
        total = Decimal(row["totalUsd"]) if (
            cutoff is not None and row["state"] != "VOID" and row["issuedDate"] <= cutoff) else ZERO
        balance = total - paid[row["id"]]
        invoice_rows[row["id"]] = {"invoicedUsd": total, "paidUsd": paid[row["id"]],
            "openUsd": max(ZERO, balance), "creditUsd": max(ZERO, -balance)}
        liability += total
        opened += max(ZERO, balance)
        credit += max(ZERO, -balance)
    return {"inUsd": cash_in, "outUsd": cash_out, "netUsd": cash_in - cash_out,
            "grantReceiptsUsd": grant_in, "customerReceiptsUsd": customer_in,
            "invoicedUsd": liability, "paidUsd": sum(paid.values(), ZERO),
            "openUsd": opened, "creditUsd": credit, "invoices": invoice_rows}


def _group(context, predicate, key):
    records = context["records"]
    groups = defaultdict(lambda: {field: ZERO for field in
        ("invoicedUsd", "paidUsd", "recordedHours", "acceptedHours", "preawardHours")})
    for row in records["work"]:
        if row["state"] == "VOID" or not predicate(row["endDate"]):
            continue
        group = groups[key(row, "work")]
        group["recordedHours"] += Decimal(row["hours"])
        if row["state"] == "ACCEPTED":
            group["acceptedHours"] += Decimal(row["hours"])
        if row["fundingBasis"] == "PREAWARD":
            group["preawardHours"] += Decimal(row["hours"])
    invoices = {row["id"]: row for row in records["invoices"]}
    for row in records["invoices"]:
        if row["state"] == "VOID" or not predicate(row["issuedDate"]):
            continue
        for line in row["lines"]:
            groups[key({**line, "contributorId": row["contributorId"]}, "invoice")]["invoicedUsd"] += Decimal(line["amountUsd"])
    for row in records["cash"]:
        if not _valued_cash(row) or not predicate(row["date"]):
            continue
        for allocation in row["allocations"]:
            invoice = invoices[allocation["invoiceId"]]
            signed = Decimal(allocation["amountUsd"]) * (1 if row["direction"] == "OUT" else -1)
            # Preserve the original exact-cent line allocation, including refunds.
            for cost, amount in domain.allocated_lines(invoice, signed):
                groups[key({"costId": cost, "contributorId": invoice["contributorId"]}, "payment")]["paidUsd"] += amount
    return groups


def _group_views(context, selected, key):
    start, end = selected["startDate"], selected["endDate"]
    return {
        "opening": _group(context, lambda stamp: start is not None and stamp < start, key),
        "period": _group(context, lambda stamp: _in_period(stamp, selected), key),
        "closing": _group(context, lambda stamp: stamp <= end, key),
    }


def _view_fields(groups, identity):
    output = {}
    for period, entries in groups.items():
        row = entries.get(identity, {})
        for field in ("invoicedUsd", "paidUsd", "recordedHours", "acceptedHours", "preawardHours"):
            value = row.get(field, ZERO)
            output[period + field[0].upper() + field[1:]] = money(value) if field.endswith("Usd") else hours(value)
    return output


def _planned(context, selected):
    anchor = context["program"].get("calendarStart")
    if not anchor:
        return {"calendarStart": None, "opening": None, "period": None, "closing": None}
    anchor_date = date.fromisoformat(anchor)
    days = context["plan"]["report"]["cash"]["days"]
    keys = ("accruedUsd", "plannedOutflowUsd", "conditionalInflowUsd")

    def at(stamp):
        if stamp is None:
            return {key: ZERO for key in keys}
        offset = (date.fromisoformat(stamp) - anchor_date).days
        chosen = next((row for row in reversed(days) if row["day"] <= offset), None)
        return {key: Decimal(chosen[key]) if chosen else ZERO for key in keys}

    before = (date.fromisoformat(selected["startDate"]) - timedelta(days=1)).isoformat() if (
        selected["startDate"] and selected["startDate"] > date.min.isoformat()) else None
    opening, closing = at(before), at(selected["endDate"])
    return {"calendarStart": anchor,
        "opening": {key: money(value) for key, value in opening.items()},
        "period": {key: money(closing[key] - opening[key]) for key in keys},
        "closing": {key: money(value) for key, value in closing.items()}}


def build(context, start_date=None, end_date=None):
    selected = selection(context, start_date, end_date)
    records, plan, program = context["records"], context["plan"], context["program"]
    start, end = selected["startDate"], selected["endDate"]
    before = (date.fromisoformat(start) - timedelta(days=1)).isoformat() if (
        start and start > date.min.isoformat()) else None
    opening = _financial(records["invoices"], records["cash"], before)
    closing = _financial(records["invoices"], records["cash"], end)
    scalar_keys = ("inUsd", "outUsd", "netUsd", "grantReceiptsUsd", "customerReceiptsUsd",
                   "invoicedUsd", "paidUsd", "openUsd", "creditUsd")
    finances = {
        "opening": {key: money(opening[key]) for key in scalar_keys},
        "period": {key: money(closing[key] - opening[key]) for key in scalar_keys},
        "closing": {key: money(closing[key]) for key in scalar_keys},
    }
    work_views = {}
    for period, predicate in (
        ("opening", lambda stamp: _before_period(stamp, selected)),
        ("period", lambda stamp: _in_period(stamp, selected)),
        ("closing", lambda stamp: stamp <= end)):
        work_views[period] = {key: hours(value) for key, value in _work_amounts(
            [row for row in records["work"] if predicate(row["endDate"])]).items()}

    package_groups = _group_views(context, selected, lambda row, kind: row.get("costId"))
    packages = []
    native_packages = plan["scenario"]["future_costs"]
    for row in native_packages:
        actual = _view_fields(package_groups, row["id"])
        budget, planned_hours = Decimal(row["amount_usd"]), Decimal(str(row.get("estimated_hours") or 0))
        packages.append({"id": row["id"], "category": row.get("category", ""),
            "tranche": row["tranche"], "description": row.get("remaining_work", ""),
            "plannedUsd": money(budget), "plannedHours": hours(planned_hours), **actual,
            "invoiceVarianceUsd": money(Decimal(actual["closingInvoicedUsd"]) - budget),
            "remainingBudgetUsd": money(budget - Decimal(actual["closingInvoicedUsd"])),
            "hoursRemaining": hours(planned_hours - Decimal(actual["closingRecordedHours"]))})
    unassigned = {"id": None, "category": "UNASSIGNED", "tranche": None,
                  "description": "Original records without a pinned work-package association",
                  "plannedUsd": None, "plannedHours": None, **_view_fields(package_groups, None),
                  "invoiceVarianceUsd": None, "remainingBudgetUsd": None, "hoursRemaining": None}
    packages.append(unassigned)
    category_rows = []
    for category in sorted({row["category"] for row in packages}):
        members = [row for row in packages if row["category"] == category]
        fields = [key for key in members[0] if key.endswith("Usd") or key.endswith("Hours") or key == "hoursRemaining"]
        category_rows.append({"category": category, "packageIds": [row["id"] for row in members],
            **{field: None if all(row[field] is None for row in members) else (
                money(sum((Decimal(row[field]) for row in members if row[field] is not None), ZERO))
                if field.endswith("Usd") else
                hours(sum((Decimal(row[field]) for row in members if row[field] is not None), ZERO)))
               for field in fields}})

    contributor_map = {row["id"]: row for row in records["contributors"]}
    contributor_groups = _group_views(context, selected, lambda row, kind: row.get("contributorId"))
    contributors = []
    for identity, row in sorted(contributor_map.items(), key=lambda item: (item[1]["name"], item[0])):
        related = [item for item in records["invoices"] if item["contributorId"] == identity]
        contributors.append({"id": identity, "name": row["name"],
            **_view_fields(contributor_groups, identity),
            "openUsd": money(sum((closing["invoices"][item["id"]]["openUsd"] for item in related), ZERO)),
            "creditUsd": money(sum((closing["invoices"][item["id"]]["creditUsd"] for item in related), ZERO))})

    aging = {key: {"count": 0, "amountUsd": ZERO} for key in
             ("NOT_DUE", "DUE_TODAY", "DAYS_1_30", "DAYS_31_60", "DAYS_61_90", "OVER_90_DAYS", "NO_DUE_DATE")}
    invoices = []
    prepayments, disputed = [], []
    for row in sorted(records["invoices"], key=lambda item: (item["issuedDate"], item["id"])):
        initial, final = opening["invoices"][row["id"]], closing["invoices"][row["id"]]
        due = row["dueDate"]
        overdue = max(0, (date.fromisoformat(end) - date.fromisoformat(due)).days) if due else None
        bucket = "NO_DUE_DATE" if not due else "NOT_DUE" if due > end else "DUE_TODAY" if due == end else (
            "DAYS_1_30" if overdue <= 30 else "DAYS_31_60" if overdue <= 60 else
            "DAYS_61_90" if overdue <= 90 else "OVER_90_DAYS")
        if final["openUsd"] > 0:
            aging[bucket]["count"] += 1
            aging[bucket]["amountUsd"] += final["openUsd"]
        if row["issuedDate"] > end and final["paidUsd"] != 0:
            prepayments.append(row["id"])
        if row["state"] == "DISPUTED" and row["issuedDate"] <= end:
            disputed.append(row["id"])
        # Include source invoices through the cutoff and originals carrying a payment.
        if row["issuedDate"] > end and final["paidUsd"] == 0:
            continue
        invoices.append({"id": row["id"], "number": row["number"], "contributorId": row["contributorId"],
            "contributor": contributor_map[row["contributorId"]]["name"], "state": row["state"],
            "issuedDate": row["issuedDate"], "dueDate": due, "sourceTotalUsd": row["totalUsd"],
            "openingLiabilityUsd": money(initial["invoicedUsd"]),
            "periodInvoicedUsd": money(final["invoicedUsd"] - initial["invoicedUsd"]),
            "closingLiabilityUsd": money(final["invoicedUsd"]),
            "openingPaidUsd": money(initial["paidUsd"]),
            "periodPaidUsd": money(final["paidUsd"] - initial["paidUsd"]),
            "closingPaidUsd": money(final["paidUsd"]), "openUsd": money(final["openUsd"]),
            "creditUsd": money(final["creditUsd"]), "overdueDays": overdue, "aging": bucket,
            "sourceIds": row.get("sourceIds", []), "sourceBasis": row.get("sourceBasis"),
            "lines": row["lines"]})
    aging_rows = [{"bucket": key, "count": value["count"], "amountUsd": money(value["amountUsd"])}
                  for key, value in aging.items()]

    work = [{**row, "contributor": contributor_map[row["contributorId"]]["name"],
             "inPeriod": _in_period(row["endDate"], selected),
             "spansPeriodStart": bool(start and row["startDate"] < start <= row["endDate"])}
            for row in sorted(records["work"], key=lambda item: (item["endDate"], item["id"]))
            if row["endDate"] <= end]
    cash, assets = [], {}
    for row in sorted(records["cash"], key=lambda item: (item["date"], item["id"])):
        if row["date"] > end:
            continue
        basis = "VOID" if row["state"] == "VOID" else (
            "TESTNET" if not _valid_cash(row) else "UNVALUED" if row["usdValue"] is None else "RECORDED_USD")
        cash.append({**row, "inPeriod": _in_period(row["date"], selected),
                     "includedInUsd": _valued_cash(row), "usdBasis": basis})
        if not _valid_cash(row):
            continue
        identity = canonical([row["currency"], row["network"], row["asset"]])
        bucket = assets.setdefault(identity, {"currency": row["currency"], "network": row["network"],
            "asset": row["asset"], "openingIn": ZERO, "openingOut": ZERO,
            "periodIn": ZERO, "periodOut": ZERO, "closingIn": ZERO, "closingOut": ZERO})
        side = "In" if row["direction"] == "IN" else "Out"
        bucket["closing" + side] += Decimal(row["amount"])
        bucket[("opening" if _before_period(row["date"], selected) else "period") + side] += Decimal(row["amount"])
    asset_rows = []
    for row in assets.values():
        item = {key: hours(value) if isinstance(value, Decimal) else value for key, value in row.items()}
        for label in ("opening", "period", "closing"):
            item[label + "Net"] = hours(row[label + "In"] - row[label + "Out"])
        asset_rows.append(item)

    days = defaultdict(lambda: {field: ZERO for field in
        ("inUsd", "outUsd", "invoicedUsd", "invoicePaidUsd", "recordedHours", "acceptedHours")})
    for row in cash:
        if not row["inPeriod"] or not row["includedInUsd"]:
            continue
        target = days[row["date"]]
        target["inUsd" if row["direction"] == "IN" else "outUsd"] += Decimal(row["usdValue"])
        target["invoicePaidUsd"] += sum((Decimal(a["amountUsd"]) for a in row["allocations"]), ZERO) * (
            1 if row["direction"] == "OUT" else -1)
    for row in invoices:
        if row["state"] != "VOID" and _in_period(row["issuedDate"], selected):
            days[row["issuedDate"]]["invoicedUsd"] += Decimal(row["sourceTotalUsd"])
    for row in work:
        if row["state"] != "VOID" and row["inPeriod"]:
            days[row["endDate"]]["recordedHours"] += Decimal(row["hours"])
            if row["state"] == "ACCEPTED":
                days[row["endDate"]]["acceptedHours"] += Decimal(row["hours"])
    daily, running = [], opening["netUsd"]
    for stamp, row in sorted(days.items()):
        net = row["inUsd"] - row["outUsd"]
        running += net
        daily.append({"date": stamp, **{key: money(value) if key.endswith("Usd") else hours(value)
            for key, value in row.items()}, "netUsd": money(net), "recordedNetCashUsd": money(running)})

    source_ids = sorted({identity for row in work + invoices + cash
                         for identity in row.get("sourceIds", [])}
                        | {identity for row in cash for identity in row.get("valuationSourceIds", [])})
    report = {"schema": SCHEMA, "selection": selected,
        "case": {key: program[key] for key in ("id", "name", "version", "state", "mode")},
        "plan": {"id": plan["id"], "revision": plan["revision"], "name": plan["name"],
            "contentSha256": plan["contentSha256"], "sourceSha256": plan["source"]["sha256"],
            "budgetUsd": money(sum((Decimal(row["amount_usd"]) for row in native_packages), ZERO)),
            "plannedHours": hours(sum((Decimal(str(row.get("estimated_hours") or 0)) for row in native_packages), ZERO))},
        "recordsSha256": digest(records), "sources": [context["sources"][identity] for identity in source_ids],
        "finances": finances, "work": work_views, "planned": _planned(context, selected),
        "packages": packages, "categories": category_rows, "contributors": contributors,
        "invoices": invoices, "aging": aging_rows, "cash": cash, "workRecords": work,
        "assets": asset_rows, "days": daily,
        "attention": {
            "disputedInvoiceIds": disputed, "paidBeforeInvoiceIds": prepayments,
            "unvaluedCashIds": [row["id"] for row in cash if row["usdBasis"] == "UNVALUED"],
            "testnetCashIds": [row["id"] for row in cash if row["usdBasis"] == "TESTNET"],
            "workSpanningStartIds": [row["id"] for row in work if row["spansPeriodStart"] and row["inPeriod"] and row["state"] != "VOID"],
            "unassignedWorkIds": [row["id"] for row in work if row["costId"] is None and row["state"] != "VOID"],
            "unassignedInvoiceLines": [{"invoiceId": row["id"], "lineId": line["id"]}
                for row in invoices if row["state"] != "VOID" and row["issuedDate"] <= end
                for line in row["lines"] if line["costId"] is None]},
        "basis": [
            "Record states are those retained at the selected case version; dates select original business activity.",
            "All recorded work hours are recognized on the original work end date. Spanning work keeps its whole recorded hours.",
            "Invoice liability is recognized on its original issue date. Payments and supplier refunds use their original cash dates and invoice allocations.",
            "USD amounts use recorded valuations and the original exact-cent line allocation. Native asset quantities remain grouped by currency, network and asset.",
            "Planned cash and accrual use the pinned planner's cumulative daily report, anchored to the operating case calendar.",
        ]}
    report["reportSha256"] = digest(report)
    return report


def _flat(rows):
    return [{key: canonical(value) if isinstance(value, (dict, list)) else value
             for key, value in row.items()} for row in rows]


def table(headers, rows):
    return "<div class=\"table\"><table><thead><tr>" + "".join(
        "<th>" + html.escape(str(label)) + "</th>" for label in headers) + "</tr></thead><tbody>" + "".join(
        "<tr>" + "".join("<td>" + html.escape("" if cell is None else str(cell)) + "</td>" for cell in row) + "</tr>"
        for row in rows) + "</tbody></table></div>"


def render_html(report):
    p, c, f = report["selection"], report["case"], report["finances"]
    span = (p["startDate"] or "All recorded dates") + " through " + p["endDate"]
    body = "<h1>" + html.escape(c["name"]) + "</h1><p>Budget performance · " + html.escape(span) + "</p>"
    body += "<p>Case version " + str(c["version"]) + " · " + html.escape(c["mode"]) + " · pinned plan revision " + str(report["plan"]["revision"]) + "</p>"
    body += "<h2>Cash and invoices</h2>" + table(["Measure", "Opening USD", "Period change USD", "Closing USD"],
        [[label, f["opening"][key], f["period"][key], f["closing"][key]] for key, label in (
            ("inUsd", "Recorded cash in"), ("outUsd", "Recorded cash out"), ("netUsd", "Net recorded cash"),
            ("invoicedUsd", "Invoice liability"), ("paidUsd", "Net invoice payments"),
            ("openUsd", "Open invoices"), ("creditUsd", "Supplier credits / prepayments"))])
    body += "<h2>Work packages</h2>" + table(
        ["Package", "Category", "Budget USD", "Period invoices USD", "Closing invoices USD", "Remaining budget USD", "Period accepted hours", "Closing accepted hours"],
        [[row["id"] or "Unassigned", row["category"], row["plannedUsd"], row["periodInvoicedUsd"],
          row["closingInvoicedUsd"], row["remainingBudgetUsd"], row["periodAcceptedHours"], row["closingAcceptedHours"]]
         for row in report["packages"]])
    body += "<h2>Contributors and suppliers</h2>" + table(
        ["Contributor", "Period hours", "Period accepted hours", "Period invoices USD", "Period payments USD", "Open USD", "Credit USD"],
        [[row["name"], row["periodRecordedHours"], row["periodAcceptedHours"], row["periodInvoicedUsd"],
          row["periodPaidUsd"], row["openUsd"], row["creditUsd"]] for row in report["contributors"]])
    body += "<h2>Invoice aging</h2>" + table(["Age at report end", "Invoices", "Open USD"],
        [[row["bucket"], row["count"], row["amountUsd"]] for row in report["aging"]])
    body += "<h2>Original invoice positions</h2>" + table(
        ["Invoice", "Contributor", "State", "Issued", "Due", "Liability USD", "Net paid USD", "Open USD", "Credit USD"],
        [[row["number"], row["contributor"], row["state"], row["issuedDate"], row["dueDate"],
          row["closingLiabilityUsd"], row["closingPaidUsd"], row["openUsd"], row["creditUsd"]]
         for row in report["invoices"]])
    body += "<h2>Recorded period activity</h2>" + table(DAY_FIELDS,
        [[row.get(key) for key in DAY_FIELDS] for row in report["days"]])
    body += "<h2>Report basis</h2><ul>" + "".join("<li>" + html.escape(item) + "</li>" for item in report["basis"]) + "</ul>"
    body += "<p>Report identity: <code>" + report["reportSha256"] + "</code></p>"
    body += "<p>Open report.json and the complete CSV files for source-linked rows. Import operations-case.zip in the original Grant Operations workspace to continue the complete case.</p>"
    css = "body{font:15px system-ui,sans-serif;color:#171717;background:#fff;max-width:1320px;margin:32px auto;padding:0 20px;line-height:1.5}h1{font-size:26px}h2{margin-top:32px;font-size:19px}p,li{max-width:100ch}.table{overflow:auto}table{border-collapse:collapse;width:100%;font-size:13px}th,td{border:1px solid #c7c7c7;padding:8px;text-align:left;vertical-align:top}th{background:#eee}code{overflow-wrap:anywhere}@media print{body{max-width:none;margin:0;padding:0}.table{overflow:visible}thead{display:table-header-group}tr{break-inside:avoid}}"
    return ("<!doctype html><html lang=\"en\"><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">"
        "<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; style-src 'unsafe-inline'\">"
        "<title>" + html.escape(c["name"]) + " · Budget performance</title><style>" + css + "</style><body>" + body + "</body></html>").encode("utf-8")


def export_bundle(report, original_case):
    files = {"operations-case.zip": original_case,
        "report.json": (canonical(report) + "\n").encode(),
        "period.json": (canonical(report["selection"]) + "\n").encode(),
        "report.html": render_html(report),
        "packages.csv": csv_bytes(PACKAGE_FIELDS, _flat(report["packages"])),
        "contributors.csv": csv_bytes(CONTRIBUTOR_FIELDS, _flat(report["contributors"])),
        "invoices.csv": csv_bytes(INVOICE_FIELDS, _flat(report["invoices"])),
        "work.csv": csv_bytes(WORK_DETAIL_FIELDS, _flat(report["workRecords"])),
        "cash.csv": csv_bytes(CASH_DETAIL_FIELDS, _flat(report["cash"])),
        "daily-activity.csv": csv_bytes(DAY_FIELDS, report["days"]),
        "README.txt": ("Grant Operations budget performance\n\n"
            "Open report.html for the management report. report.json retains the complete selected period, source identities, original asset quantities, package/contributor totals, invoice aging and source-linked work/cash/invoice rows. CSV files contain all rows.\n\n"
            "To continue the complete original case, open Grant planning and delivery, choose Import complete case, and select this complete performance ZIP. An older release can receive the inner operations-case.zip. The import retains all original source documents, plan revisions, case records and history. Open Budget performance and use startDate/endDate from period.json. The receiving case has its new local case identity; the supplied report remains the original issued edition.\n\n"
            "All amounts use the original stored records and their current states at the named case version. Work is recognized by its original end date; invoice liability by issue date; payments/refunds by cash date. Opening covers dates before the selected start. Closing covers all dates through the selected end. Period values equal closing minus opening.\n").encode()}
    if sum(map(len, files.values())) > MAX_BUNDLE:
        domain.fail("The complete performance handover exceeds 32 MiB.", status=413)
    manifest = {"schema": SCHEMA + ".bundle", "reportSha256": report["reportSha256"],
        "files": [{"path": name, "bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest()}
                  for name, raw in sorted(files.items())]}
    files["MANIFEST.json"] = (canonical(manifest) + "\n").encode()
    if sum(map(len, files.values())) > MAX_BUNDLE:
        domain.fail("The complete performance handover including its manifest exceeds 32 MiB.", status=413)
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
        for name, raw in sorted(files.items()):
            info = zipfile.ZipInfo(name, (2026, 1, 1, 0, 0, 0))
            info.external_attr = 0o600 << 16
            info.compress_type = zipfile.ZIP_DEFLATED
            archive.writestr(info, raw)
    raw = output.getvalue()
    if len(raw) > MAX_BUNDLE:
        domain.fail("The compressed performance handover exceeds 32 MiB.", status=413)
    return raw


def unwrap_bundle(raw):
    """Receive this complete report through the existing case importer."""
    if not isinstance(raw, bytes) or len(raw) > MAX_BUNDLE:
        domain.fail("Use a complete operations handover up to 32 MiB.", status=413)
    try:
        with zipfile.ZipFile(io.BytesIO(raw)) as archive:
            infos = archive.infolist()
            if len(infos) > 220 or sum(item.file_size for item in infos) > MAX_BUNDLE:
                domain.fail("The complete report archive exceeds 32 MiB.", status=413)
            names = [item.filename for item in infos]
            manifest = json.loads(archive.read("MANIFEST.json"))
            if not isinstance(manifest, dict) or manifest.get("schema") != SCHEMA + ".bundle":
                return raw, None
            expected = {"operations-case.zip", "report.json", "period.json", "report.html",
                "packages.csv", "contributors.csv", "invoices.csv", "work.csv", "cash.csv",
                "daily-activity.csv", "README.txt", "MANIFEST.json"}
            if len(names) != len(set(names)) or set(names) != expected:
                domain.fail("The performance handover must retain all of its original files.", "INVALID_PERFORMANCE_BUNDLE")
            descriptors = manifest.get("files")
            if not isinstance(descriptors, list) or len(descriptors) != len(expected) - 1:
                domain.fail("The complete performance file list is missing.", "INVALID_PERFORMANCE_BUNDLE")
            members = {}
            for item in descriptors:
                if not isinstance(item, dict):
                    domain.fail("Use the complete performance file descriptors.", "INVALID_PERFORMANCE_BUNDLE")
                name = item["path"]
                if name in members or name not in expected - {"MANIFEST.json"}:
                    domain.fail("The performance file list repeats or changes a member.", "INVALID_PERFORMANCE_BUNDLE")
                value = archive.read(name)
                if len(value) != item["bytes"] or hashlib.sha256(value).hexdigest() != item["sha256"]:
                    domain.fail("A performance file differs from its retained source.", "INVALID_PERFORMANCE_BUNDLE")
                members[name] = value
            report = json.loads(members["report.json"])
            if not isinstance(report, dict) or not isinstance(report.get("selection"), dict):
                domain.fail("Use the original performance report document.", "INVALID_PERFORMANCE_BUNDLE")
            original_hash = report.get("reportSha256")
            if (report.get("schema") != SCHEMA or original_hash != manifest.get("reportSha256")
                    or digest({key: value for key, value in report.items() if key != "reportSha256"}) != original_hash
                    or json.loads(members["period.json"]) != report.get("selection")):
                domain.fail("The report's selected period or retained content differs.", "INVALID_PERFORMANCE_BUNDLE")
            return members["operations-case.zip"], report
    except (zipfile.BadZipFile, KeyError, TypeError, ValueError, RuntimeError) as exc:
        # The original importer owns errors for other source formats.
        from model import Problem
        if isinstance(exc, Problem):
            raise
        raise Problem("The complete performance or operations handover is unreadable.", 422, "INVALID_PERFORMANCE_BUNDLE") from exc


def validate_received(report, document):
    if report is None:
        return
    context = {"program": document["program"], "plan": document["plan"],
               "records": document["records"],
               "sources": {row["id"]: row for row in document["sources"]}}
    selected = report.get("selection", {})
    rebuilt = build(context, selected.get("startDate"), selected.get("endDate"))
    if rebuilt != report:
        domain.fail("The performance report must describe its complete original case and selected period.", "PERFORMANCE_SOURCE_CHANGED", 409)


def received_selection(report):
    if report is None:
        return None
    return {**report["selection"], "reportSha256": report["reportSha256"],
            "sourceCaseId": report["case"]["id"], "sourceCaseVersion": report["case"]["version"]}
