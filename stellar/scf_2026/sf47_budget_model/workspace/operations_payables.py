"""Supplier accounts composed from original Grant Operations work, invoices and cash."""
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
import operations_performance as performance
from model import canonical, csv_bytes, digest, MAX_BUNDLE

SCHEMA = "stellar-forge.sf47-supplier-account.v1"
ZERO = Decimal("0")
BALANCE_FIELDS = ("invoicedUsd", "paidUsd", "openUsd", "creditUsd", "balanceUsd")
INVOICE_FIELDS = ("id", "number", "state", "issuedDate", "dueDate", "totalUsd",
    "openingInvoicedUsd", "periodInvoicedUsd", "closingInvoicedUsd",
    "openingPaidUsd", "periodPaidUsd", "closingPaidUsd", "openUsd", "creditUsd",
    "balanceUsd", "overdueDays", "aging", "future", "sourceIds", "sourceNote", "lines")
WORK_FIELDS = ("id", "description", "state", "startDate", "endDate", "hours", "costId",
    "fundingBasis", "inPeriod", "future", "withoutInvoiceLink", "invoiceLinks", "sourceIds", "sourceNote")
CASH_FIELDS = ("id", "date", "state", "direction", "category", "amount", "currency",
    "network", "asset", "usdValue", "externalRef", "accountAllocatedUsd",
    "signedAccountPaidUsd", "recognizedAccountPaidUsd", "otherAllocatedUsd",
    "unallocatedUsd", "inPeriod", "future", "usdBasis", "allocations",
    "sourceIds", "valuationSourceIds", "sourceNote")
ACTIVITY_FIELDS = ("date", "kind", "recordId", "label", "invoicedUsd", "paidUsd",
    "balanceChangeUsd", "runningBalanceUsd", "sourceIds")
AGING_KEYS = ("NOT_DUE", "1_30", "31_60", "61_90", "OVER_90", "NO_DUE_DATE")


def _sum_positions(rows, positions):
    result = {key: sum((positions[row["id"]][key] for row in rows), ZERO)
              for key in performance.MONEY_FIELDS}
    result["balanceUsd"] = result["invoicedUsd"] - result["paidUsd"]
    return result


def _money_fields(row):
    return {key: performance.money(value) for key, value in row.items()}


def _aging(invoice, position, end):
    if position["openUsd"] <= ZERO:
        return "SETTLED" if position["creditUsd"] <= ZERO else "CREDIT", 0
    due = invoice["dueDate"]
    if due is None:
        return "NO_DUE_DATE", 0
    overdue = max(0, (date.fromisoformat(end) - date.fromisoformat(due)).days)
    return ("NOT_DUE" if overdue == 0 else "1_30" if overdue <= 30 else
            "31_60" if overdue <= 60 else "61_90" if overdue <= 90 else "OVER_90"), overdue


def _work_links(invoices):
    linked = defaultdict(list)
    for invoice in invoices:
        for line in invoice["lines"]:
            for identity in line["workIds"]:
                linked[identity].append({"invoiceId": invoice["id"], "number": invoice["number"],
                    "state": invoice["state"], "issuedDate": invoice["issuedDate"],
                    "lineId": line["id"], "description": line["description"], "amountUsd": line["amountUsd"]})
    return linked


def build(context, contributor_id=None, start_date=None, end_date=None):
    selected = performance.selection(context, start_date, end_date)
    records, program, plan = context["records"], context["program"], context["plan"]
    contributors = sorted(records["contributors"], key=lambda row: (row["name"].casefold(), row["id"]))
    people = {row["id"]: row for row in contributors}
    if contributor_id is None and contributors:
        contributor_id = contributors[0]["id"]
    if contributor_id is not None and contributor_id not in people:
        domain.fail("Select an original contributor or supplier in this case.", "SUPPLIER_NOT_FOUND", 404)
    selected["contributorId"] = contributor_id
    start, end = selected["startDate"], selected["endDate"]
    before = (date.fromisoformat(start) - timedelta(days=1)).isoformat() if (
        start and start > date.min.isoformat()) else None
    # These are the same source positions used by Budget performance. Select the
    # invoice positions after calculating the complete case, so allocations to
    # another supplier never become payments on the chosen account.
    original_opening = performance._financial(records["invoices"], records["cash"], before)["invoices"]
    original_closing = performance._financial(records["invoices"], records["cash"], end)["invoices"]
    invoice_map = {row["id"]: row for row in records["invoices"]}
    supplier_invoices, supplier_work = defaultdict(list), defaultdict(list)
    for row in records["invoices"]:
        supplier_invoices[row["contributorId"]].append(row)
    for row in records["work"]:
        supplier_work[row["contributorId"]].append(row)
    accounts = []
    for contributor in contributors:
        identity = contributor["id"]
        invoices = supplier_invoices[identity]
        opening = _sum_positions(invoices, original_opening)
        closing = _sum_positions(invoices, original_closing)
        links = _work_links(invoices)
        work = [row for row in supplier_work[identity] if row["endDate"] <= end]
        amounts = performance._work_amounts(work)
        accounts.append({**{key: contributor[key] for key in ("id", "name", "kind", "contact", "state")},
            "opening": _money_fields(opening),
            "period": _money_fields({key: closing[key] - opening[key] for key in BALANCE_FIELDS}),
            "closing": _money_fields(closing),
            "work": {key: performance.hours(value) for key, value in amounts.items()},
            "workWithoutInvoiceLink": sum(1 for row in work if row["state"] != "VOID"
                and not any(link["state"] != "VOID" and link["issuedDate"] <= end for link in links[row["id"]])),
            "invoiceCount": len(invoices),
            "disputedInvoices": sum(1 for row in invoices if row["state"] == "DISPUTED" and row["issuedDate"] <= end)})

    account = people.get(contributor_id)
    original_invoices = supplier_invoices[contributor_id]
    original_work = supplier_work[contributor_id]
    ids = {row["id"] for row in original_invoices}
    opening = _sum_positions(original_invoices, original_opening)
    closing = _sum_positions(original_invoices, original_closing)
    balances = {"opening": _money_fields(opening), "closing": _money_fields(closing),
        "period": _money_fields({key: closing[key] - opening[key] for key in BALANCE_FIELDS})}
    aging = {key: {"bucket": key, "count": 0, "amountUsd": ZERO} for key in AGING_KEYS}
    invoices = []
    for row in sorted(original_invoices, key=lambda item: (item["issuedDate"], item["number"], item["id"])):
        first, last = original_opening[row["id"]], original_closing[row["id"]]
        bucket, overdue = _aging(row, last, end)
        if last["openUsd"] > ZERO:
            aging[bucket]["count"] += 1
            aging[bucket]["amountUsd"] += last["openUsd"]
        invoices.append({**row,
            **{period + field[0].upper() + field[1:]: performance.money(values[field])
               for period, values in (("opening", first), ("closing", last),
                  ("period", {field: last[field] - first[field] for field in performance.MONEY_FIELDS}))
               for field in ("invoicedUsd", "paidUsd")},
            "openUsd": performance.money(last["openUsd"]), "creditUsd": performance.money(last["creditUsd"]),
            "balanceUsd": performance.money(last["invoicedUsd"] - last["paidUsd"]),
            "overdueDays": overdue, "aging": bucket, "future": row["issuedDate"] > end,
            "inPeriod": performance._in_period(row["issuedDate"], selected)})
    links = _work_links(original_invoices)
    work = [{**row, "invoiceLinks": links[row["id"]],
        "withoutInvoiceLink": not any(link["state"] != "VOID" and link["issuedDate"] <= end for link in links[row["id"]]),
        "inPeriod": performance._in_period(row["endDate"], selected), "future": row["endDate"] > end}
        for row in sorted(original_work, key=lambda item: (item["endDate"], item["id"]))]
    work_totals = {}
    for period, predicate in (("opening", lambda stamp: start is not None and stamp < start),
                             ("period", lambda stamp: performance._in_period(stamp, selected)),
                             ("closing", lambda stamp: stamp <= end)):
        work_totals[period] = {key: performance.hours(value) for key, value in
            performance._work_amounts([row for row in original_work if predicate(row["endDate"])]).items()}

    cash = []
    for row in sorted(records["cash"], key=lambda item: (item["date"], item["id"])):
        own = [allocation for allocation in row["allocations"] if allocation["invoiceId"] in ids]
        if not own:
            continue
        account_amount = sum((Decimal(item["amountUsd"]) for item in own), ZERO)
        other_amount = sum((Decimal(item["amountUsd"]) for item in row["allocations"]
                            if item["invoiceId"] not in ids), ZERO)
        signed = account_amount * (1 if row["direction"] == "OUT" else -1)
        basis = "VOID" if row["state"] == "VOID" else (
            "TESTNET" if not performance._valid_cash(row) else "UNVALUED" if row["usdValue"] is None else "RECORDED_USD")
        recognized = performance._valued_cash(row) and row["date"] <= end
        allocations = []
        for item in row["allocations"]:
            invoice = invoice_map[item["invoiceId"]]
            contributor = people[invoice["contributorId"]]
            allocations.append({**item, "invoiceNumber": invoice["number"], "invoiceState": invoice["state"],
                "contributorId": contributor["id"], "contributor": contributor["name"],
                "onSelectedAccount": item["invoiceId"] in ids})
        cash.append({**row, "allocations": allocations,
            "accountAllocatedUsd": performance.money(account_amount),
            "signedAccountPaidUsd": performance.money(signed),
            "recognizedAccountPaidUsd": performance.money(signed if recognized else ZERO),
            "otherAllocatedUsd": performance.money(other_amount),
            "unallocatedUsd": None if row["usdValue"] is None else performance.money(
                Decimal(row["usdValue"]) - account_amount - other_amount),
            "inPeriod": performance._in_period(row["date"], selected), "future": row["date"] > end,
            "includedInUsd": recognized, "usdBasis": basis})

    activity = []
    for row in invoices:
        if row["state"] != "VOID" and row["inPeriod"]:
            activity.append({"date": row["issuedDate"], "kind": "INVOICE", "recordId": row["id"],
                "label": row["number"], "invoicedUsd": row["totalUsd"], "paidUsd": "0.00",
                "balanceChangeUsd": row["totalUsd"], "sourceIds": row["sourceIds"]})
    for row in cash:
        if row["includedInUsd"] and row["inPeriod"]:
            paid = Decimal(row["signedAccountPaidUsd"])
            activity.append({"date": row["date"], "kind": "PAYMENT" if row["direction"] == "OUT" else "REFUND",
                "recordId": row["id"], "label": row["externalRef"], "invoicedUsd": "0.00",
                "paidUsd": performance.money(paid), "balanceChangeUsd": performance.money(-paid),
                "sourceIds": row["sourceIds"]})
    running = opening["balanceUsd"]
    for row in sorted(activity, key=lambda item: (item["date"], item["kind"], item["recordId"])):
        running += Decimal(row["balanceChangeUsd"])
        row["runningBalanceUsd"] = performance.money(running)
    activity.sort(key=lambda item: (item["date"], item["kind"], item["recordId"]))
    linked_rows = ([account] if account else []) + invoices + work + cash
    source_ids = sorted({identity for row in linked_rows for identity in row.get("sourceIds", [])}
                        | {identity for row in cash for identity in row.get("valuationSourceIds", [])})
    report = {"schema": SCHEMA, "selection": selected,
        "case": {key: program[key] for key in ("id", "name", "version", "state", "mode")},
        "plan": {key: plan[key] for key in ("id", "revision", "name", "contentSha256")},
        "recordsSha256": digest(records), "account": account, "accounts": accounts,
        "balances": balances, "workTotals": work_totals,
        "invoices": invoices, "cash": cash, "work": work, "activity": activity,
        "aging": [{**row, "amountUsd": performance.money(row["amountUsd"])} for row in aging.values()],
        "sources": [context["sources"][identity] for identity in source_ids],
        "attention": {
            "receivedInvoiceIds": [row["id"] for row in invoices if row["state"] == "RECEIVED" and not row["future"]],
            "disputedInvoiceIds": [row["id"] for row in invoices if row["state"] == "DISPUTED" and not row["future"]],
            "overdueInvoiceIds": [row["id"] for row in invoices if row["overdueDays"] > 0 and Decimal(row["openUsd"]) > ZERO],
            "creditInvoiceIds": [row["id"] for row in invoices if Decimal(row["creditUsd"]) > ZERO],
            "workWithoutInvoiceLinkIds": [row["id"] for row in work
                if row["withoutInvoiceLink"] and row["state"] != "VOID" and not row["future"]],
            "excludedCashIds": [row["id"] for row in cash if not row["includedInUsd"]]},
        "basis": [
            "States are the original records retained at the selected case version. Dates select original business activity.",
            "Opening covers dates before the selected start; closing covers dates through the selected end; period changes equal closing minus opening.",
            "Invoice liability uses its original issue date. Payments and refunds use original observed cash dates and invoice allocations.",
            "Only original allocations to this supplier's invoices belong to this account. Mixed payments retain all allocations and the entire original asset quantity.",
            "USD balances use recorded valuations. Native quantities keep their currency, network and asset; they are not apportioned or combined.",
            "Voided cash and testnet observations do not enter USD balances. Voiding an invoice removes its liability while original payments remain recorded.",
            "A work record without an invoice link has no current, nonvoid invoice link issued through the selected end. Links do not establish a rate or full billing.",
            "Work hours are recognized on the original end date. Future source records remain visible with their original dates.",
        ]}
    report["reportSha256"] = digest(report)
    return report


def _flat(rows):
    return [{key: canonical(value) if isinstance(value, (dict, list)) else value
             for key, value in row.items()} for row in rows]


def render_html(report):
    escape, table = html.escape, performance.table
    account, period = report["account"], report["selection"]
    title = (account["name"] if account else "Supplier accounts") + " · " + report["case"]["name"]
    body = "<h1>" + escape(title) + "</h1><p>" + escape(
        (period["startDate"] or "All recorded dates") + " through " + period["endDate"]) + "</p>"
    if account:
        body += "<p>" + escape(account["kind"].replace("_", " ").title() + " · " + account["contact"]) + "</p>"
        if account["note"]:
            body += "<p>" + escape(account["note"]) + "</p>"
    body += "<h2>Account balance in USD</h2>" + table(
        ["Basis", "Invoice liability", "Net paid", "Open invoices", "Invoice credits", "Net balance"],
        [[label.title(), *[report["balances"][label][key] for key in BALANCE_FIELDS]]
         for label in ("opening", "period", "closing")])
    body += "<h2>Invoice aging</h2>" + table(["Age at period end", "Invoices", "Open USD"],
        [[row["bucket"].replace("_", " "), row["count"], row["amountUsd"]] for row in report["aging"]])
    body += "<h2>Invoices</h2>" + table(
        ["Invoice", "State", "Issued", "Due", "Source USD", "Liability USD", "Net paid USD", "Open USD", "Credit USD"],
        [[row["number"], row["state"], row["issuedDate"], row["dueDate"], row["totalUsd"],
          row["closingInvoicedUsd"], row["closingPaidUsd"], row["openUsd"], row["creditUsd"]]
         for row in report["invoices"]])
    for row in report["invoices"]:
        body += "<h3>" + escape(row["number"]) + "</h3>" + table(
            ["Line", "Description", "USD", "Work records", "Work package"],
            [[line["id"], line["description"], line["amountUsd"], ", ".join(line["workIds"]), line["costId"]]
             for line in row["lines"]])
    body += "<h2>Observed payments and refunds</h2>" + table(
        ["Date", "Reference", "State / basis", "Original quantity", "Whole observation USD",
         "Allocated to this account USD", "Net paid on this account USD", "Other accounts USD"],
        [[row["date"], row["externalRef"], row["state"] + " / " + row["usdBasis"],
          row["amount"] + " " + row["currency"] + " · " + row["network"] + " · " + row["asset"],
          row["usdValue"], row["accountAllocatedUsd"], row["recognizedAccountPaidUsd"], row["otherAllocatedUsd"]]
         for row in report["cash"]])
    for row in report["cash"]:
        body += "<h3>" + escape(row["externalRef"]) + "</h3>" + table(
            ["Supplier", "Invoice", "Original allocation USD", "On this account"],
            [[item["contributor"], item["invoiceNumber"], item["amountUsd"], item["onSelectedAccount"]]
             for item in row["allocations"]])
    body += "<h2>Original work</h2>" + table(
        ["Completed work", "State", "Start", "End", "Hours", "Funding", "Invoice links"],
        [[row["description"], row["state"], row["startDate"], row["endDate"], row["hours"], row["fundingBasis"],
          "; ".join(link["number"] + " / " + link["state"] for link in row["invoiceLinks"])] for row in report["work"]])
    body += "<h2>Period account activity</h2>" + table(
        ["Date", "Activity", "Reference", "Invoice USD", "Net paid USD", "Balance USD"],
        [[row["date"], row["kind"], row["label"], row["invoicedUsd"], row["paidUsd"], row["runningBalanceUsd"]]
         for row in report["activity"]])
    body += "<h2>Retained original source documents</h2>" + table(
        ["Name", "Bytes", "Original URL", "Source identity"],
        [[row.get("filename") or row.get("name") or row["id"], row["bytes"], row.get("sourceUrl", ""), row["id"]]
         for row in report["sources"]])
    body += "<h2>Account basis</h2><ul>" + "".join("<li>" + escape(item) + "</li>" for item in report["basis"]) + "</ul>"
    body += "<p>Import this complete account ZIP through Import complete case to reopen the same supplier and dates. The inner operations-case.zip retains all original source documents and the complete case.</p>"
    body += "<p>Original case version " + str(report["case"]["version"]) + " · Report <code>" + report["reportSha256"] + "</code></p>"
    css = "body{font:15px system-ui,sans-serif;color:#171717;background:#fff;max-width:1320px;margin:32px auto;padding:0 20px;line-height:1.5}h1{font-size:26px}h2{margin-top:30px;font-size:20px}h3{font-size:16px}p,li{max-width:100ch}.table{overflow:auto}table{border-collapse:collapse;width:100%;font-size:13px}th,td{border:1px solid #bbb;padding:8px;text-align:left;vertical-align:top}th{background:#eee}code{overflow-wrap:anywhere}@media print{body{max-width:none;margin:0;padding:0}.table{overflow:visible}thead{display:table-header-group}tr{break-inside:avoid}}"
    return ("<!doctype html><html lang=\"en\"><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">"
        "<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; style-src 'unsafe-inline'\">"
        "<title>" + escape(title) + "</title><style>" + css + "</style><body>" + body + "</body></html>").encode()


def export_bundle(report, original_case):
    files = {"operations-case.zip": original_case,
        "account.json": (canonical(report) + "\n").encode(),
        "selection.json": (canonical(report["selection"]) + "\n").encode(),
        "account.html": render_html(report),
        "invoices.csv": csv_bytes(INVOICE_FIELDS, _flat(report["invoices"])),
        "work.csv": csv_bytes(WORK_FIELDS, _flat(report["work"])),
        "cash.csv": csv_bytes(CASH_FIELDS, _flat(report["cash"])),
        "activity.csv": csv_bytes(ACTIVITY_FIELDS, _flat(report["activity"])),
        "README.txt": ("Grant Operations supplier account\n\n"
            "Open account.html for the complete dated account. account.json retains original invoice lines, work links, "
            "cash allocations across every supplier, original currencies/quantities, source identities and all dated balances. "
            "The CSVs contain complete rows; nested structures are JSON cells.\n\n"
            "Import this complete ZIP using Import complete case in Grant Operations. The receiving desk opens the same supplier "
            "and dates on its new local case identity. The enclosed account.json remains the original issued edition. "
            "The inner operations-case.zip retains the complete original plan, records, attachments and event history.\n").encode()}
    if sum(map(len, files.values())) > MAX_BUNDLE:
        domain.fail("The complete supplier account exceeds 32 MiB.", status=413)
    manifest = {"schema": SCHEMA + ".bundle", "reportSha256": report["reportSha256"],
        "files": [{"path": name, "bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest()}
                  for name, raw in sorted(files.items())]}
    files["MANIFEST.json"] = (canonical(manifest) + "\n").encode()
    if sum(map(len, files.values())) > MAX_BUNDLE:
        domain.fail("The account and its manifest exceed 32 MiB.", status=413)
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
        for name, raw in sorted(files.items()):
            info = zipfile.ZipInfo(name, (2026, 1, 1, 0, 0, 0))
            info.external_attr = 0o600 << 16
            info.compress_type = zipfile.ZIP_DEFLATED
            archive.writestr(info, raw)
    raw = output.getvalue()
    if len(raw) > MAX_BUNDLE:
        domain.fail("The compressed supplier account exceeds 32 MiB.", status=413)
    return raw


def unwrap_bundle(raw):
    if not isinstance(raw, bytes) or len(raw) > MAX_BUNDLE:
        domain.fail("Use a complete account or operations handover up to 32 MiB.", status=413)
    try:
        with zipfile.ZipFile(io.BytesIO(raw)) as archive:
            infos = archive.infolist()
            if len(infos) > 220 or sum(item.file_size for item in infos) > MAX_BUNDLE:
                domain.fail("The complete account archive exceeds 32 MiB.", status=413)
            names = [item.filename for item in infos]
            manifest = json.loads(archive.read("MANIFEST.json"))
            if not isinstance(manifest, dict) or manifest.get("schema") != SCHEMA + ".bundle":
                return raw, None
            expected = {"operations-case.zip", "account.json", "selection.json", "account.html",
                        "invoices.csv", "work.csv", "cash.csv", "activity.csv", "README.txt", "MANIFEST.json"}
            if len(names) != len(set(names)) or set(names) != expected:
                domain.fail("Retain every original file in the supplier account handover.", "INVALID_SUPPLIER_BUNDLE")
            descriptors = manifest.get("files")
            if not isinstance(descriptors, list) or len(descriptors) != len(expected) - 1:
                domain.fail("The complete account file list is missing.", "INVALID_SUPPLIER_BUNDLE")
            members = {}
            for item in descriptors:
                if not isinstance(item, dict):
                    domain.fail("Use complete original account file descriptors.", "INVALID_SUPPLIER_BUNDLE")
                name = item["path"]
                if name in members or name not in expected - {"MANIFEST.json"}:
                    domain.fail("The account file list repeats or changes a member.", "INVALID_SUPPLIER_BUNDLE")
                value = archive.read(name)
                if len(value) != item["bytes"] or hashlib.sha256(value).hexdigest() != item["sha256"]:
                    domain.fail("An account file differs from its original retained source.", "INVALID_SUPPLIER_BUNDLE")
                members[name] = value
            report = json.loads(members["account.json"])
            if not isinstance(report, dict) or not isinstance(report.get("selection"), dict):
                domain.fail("Use the complete original supplier account.", "INVALID_SUPPLIER_BUNDLE")
            original_hash = report.get("reportSha256")
            if (report.get("schema") != SCHEMA or original_hash != manifest.get("reportSha256")
                    or digest({key: value for key, value in report.items() if key != "reportSha256"}) != original_hash
                    or json.loads(members["selection.json"]) != report["selection"]):
                domain.fail("The supplier account or selected dates differ from their original content.", "INVALID_SUPPLIER_BUNDLE")
            return members["operations-case.zip"], report
    except (zipfile.BadZipFile, KeyError, TypeError, ValueError, RuntimeError) as exc:
        from model import Problem
        if isinstance(exc, Problem):
            raise
        raise Problem("The complete supplier account or operations handover is unreadable.",
                      422, "INVALID_SUPPLIER_BUNDLE") from exc


def validate_received(report, document):
    if report is None:
        return
    context = {"program": document["program"], "plan": document["plan"],
               "records": document["records"], "sources": {row["id"]: row for row in document["sources"]}}
    selected = report.get("selection", {})
    rebuilt = build(context, selected.get("contributorId"), selected.get("startDate"), selected.get("endDate"))
    if rebuilt != report:
        domain.fail("The account must describe its complete original case, supplier and dates.",
                    "SUPPLIER_ACCOUNT_SOURCE_CHANGED", 409)


def received_selection(report):
    if report is None:
        return None
    return {**report["selection"], "reportSha256": report["reportSha256"],
            "sourceCaseId": report["case"]["id"], "sourceCaseVersion": report["case"]["version"]}
