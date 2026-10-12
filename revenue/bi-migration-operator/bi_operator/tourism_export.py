"""Export a complete, editable tourism reporting period through original objects."""
from __future__ import annotations

from decimal import Decimal
import html
import re
from .billing_export import csv_file, workbook
from .store import digest, encoded
from .tourism import money_text, strict_json


def export_report(store, record):
    payload = record["payload"]
    report = strict_json(store.bytes(payload["report"]["digest"]))
    fund = report["fund"]["payload"]
    plan = report["plan"]["payload"]
    units, currency = fund["minor_unit"], fund["currency"]
    numeric = lambda value: Decimal(value) / Decimal(10 ** units) if value is not None else ""
    esc = lambda value: html.escape(str(value if value is not None else ""), quote=True)
    amount = lambda value: currency + " " + money_text(value, units) if value is not None else "Missing"
    sheets = []
    month_headers = ["Period", "Status", "Observed", "Base", "Downside", "Upside",
                     "Planning allocation", "Prior-year baseline", "Original source", "Adjustment basis"]
    month_rows = [[row["period"], row["state"], numeric(row["observed_minor"]), numeric(row["base_minor"]),
                   numeric(row["downside_minor"]), numeric(row["upside_minor"]),
                   numeric(row["planning_allocation_minor"]), row["baseline_period"],
                   "; ".join(row["source_refs"]), (row["adjustment"] or {}).get("basis", "")]
                  for row in report["forecast"]["months"]]
    sheets.append(("Monthly forecast", month_headers, month_rows))
    quarters = []
    for offset in (0, 3, 6, 9):
        rows = report["forecast"]["months"][offset:offset + 3]
        values = {key: sum(row[key] or 0 for row in rows) for key in
                  ("observed_minor", "base_minor", "downside_minor", "upside_minor", "planning_allocation_minor")}
        quarters.append({"label": "Reporting Q" + str(offset // 3 + 1),
                         "start": rows[0]["period"], "end": rows[-1]["period"],
                         "observed_months": sum(row["state"] == "OBSERVED" for row in rows),
                         "forecast_months": sum(row["state"] == "FORECAST" for row in rows),
                         "missing_months": sum(row["state"] == "MISSING" for row in rows), **values})
    quarter_headers = ["Quarter", "Start", "End", "Observed months", "Forecast months", "Missing months",
                       "Observed subtotal", "Base projection", "Downside", "Upside", "Planning allocation"]
    quarter_rows = [[r["label"], r["start"], r["end"], r["observed_months"], r["forecast_months"],
                     r["missing_months"], *[numeric(r[k]) for k in
                     ("observed_minor", "base_minor", "downside_minor", "upside_minor", "planning_allocation_minor")]]
                    for r in quarters]
    sheets.append(("Quarterly forecast", quarter_headers, quarter_rows))
    control_headers = ["Start", "End", "Published distribution", "Collection subtotal", "Difference",
                       "Complete collection window", "Missing months", "Collection basis",
                       "Distribution basis", "Original source"]
    control_rows = [[r["start"], r["end"], numeric(r["published_distribution_minor"]),
                     numeric(r["collection_subtotal_minor"]), numeric(r["difference_minor"]),
                     str(r["complete_collection_window"]), ", ".join(r["missing_months"]),
                     r["collection_basis"], r["distribution_basis"], r["source_ref"]]
                    for r in report["controls"]]
    sheets.append(("Distribution controls", control_headers, control_rows))
    cash_headers = ["Entry", "Date", "Direction", "Amount", "Fund", "Category", "Program",
                    "Counterparty", "Original entry", "Source", "Note"]
    cash_rows = [[r["entry_id"], r["date"], r["direction"], numeric(r["amount_minor"]), r["fund"],
                  r["category"], r["program"], r["counterparty"], r["original_entry_id"],
                  r["source_ref"], r["note"]] for r in report["cash"]["rows"]]
    sheets.append(("Operator cash", cash_headers, cash_rows))
    expense_headers = ["Category", "Program", "Receipts", "Expenditures", "Receipt returns",
                       "Expenditure returns", "Net receipts", "Net expenditures"]
    expense_rows = [[r["category"], r["program"], *[numeric(r[k]) for k in
                    ("receipts_minor", "expenditures_minor", "receipt_returns_minor", "expense_returns_minor",
                     "net_receipts_minor", "net_expenditures_minor")]] for r in report["cash"]["groups"]]
    sheets.append(("Fund accounting", expense_headers, expense_rows))
    budget_headers = ["Budget", "Year", "Original status", "Opening cash", "Operating reserve",
                      "TGT income", "Other income", "Personnel", "Sales marketing", "Administration",
                      "Reported resources", "Calculated resources", "Resources difference",
                      "Reported available", "Calculated available", "Available difference",
                      "Reported expenditures", "Calculated expenditures", "Expenditures difference",
                      "Reported closing", "Calculated closing", "Closing difference", "Source"]
    budget_rows = []
    for r in report["budgets"]:
        row = [r["budget_id"], r["year"], r["status"]]
        row += [numeric(r[k + "_minor"]) for k in
                ("opening_cash", "operating_reserve", "tgt_income", "other_income",
                 "personnel", "sales_marketing", "administration")]
        for k in ("resources", "available", "expenditures", "closing"):
            row += [numeric(r["reported_" + k + "_minor"]), numeric(r["calculated"][k]),
                    numeric(r["reported_differences"][k])]
        row += [r["source_ref"]]
        budget_rows.append(row)
    sheets.append(("Published budgets", budget_headers, budget_rows))
    backtest_headers = ["Period", "Earlier-data forecast", "Observed", "Forecast minus observed",
                        "Absolute error", "Calibration ends", "Source"]
    backtest_rows = [[r["period"], numeric(r["forecast_minor"]), numeric(r["observed_minor"]),
                      numeric(r["error_minor"]), numeric(r["absolute_error_minor"]),
                      r["calibration_ends"], r["actual_source_ref"]] for r in report["forecast"]["backtest"]]
    sheets.append(("Historical forecast", backtest_headers, backtest_rows))
    lodging_headers = ["Period", "Provider", "Market", "Occupancy percent", "ADR", "Available rooms", "Source"]
    lodging_rows = [[r["period"], r["provider"], r["market"], r["occupancy_pct"],
                     numeric(r["adr_minor"]), r["available_rooms"], r["source_ref"]] for r in report["lodging"]]
    sheets.append(("Lodging sources", lodging_headers, lodging_rows))
    demand_headers = ["Event", "Period", "Label", "Room nights", "Original basis", "Source"]
    demand_rows = [[r["event_id"], r["period"], r["label"], r["room_nights"], r["basis"], r["source_ref"]]
                   for r in report["demand"]]
    sheets.append(("Demand sources", demand_headers, demand_rows))
    source_headers = ["Source", "Revision", "Label", "Original filename", "Original bytes", "Original SHA256",
                      "Normalized SHA256", "Original URL", "Source tables", "Accepted review"]
    source_rows = [[r["id"], r["revision"], r["payload"]["label"], r["payload"]["original"]["name"],
                    r["payload"]["original"]["bytes"], r["payload"]["original"]["digest"],
                    r["payload"]["normalised"]["digest"], r["payload"]["source_url"],
                    encoded(r["payload"]["tables"]), r["payload"]["review"]["note"]] for r in report["sources"]]
    sheets.append(("Source inventory", source_headers, source_rows))
    assumptions = [
        ["Jurisdiction", fund["jurisdiction"]], ["Reporting start", plan["start"]],
        ["Actual observations through", plan["as_of"]], ["Currency", currency], ["Minor units", units],
        ["Collection basis", report["forecast"]["collection_basis"]], ["Method", plan["method"]],
        ["Comparison months", plan["comparison_months"]], ["Seasonal factor", report["forecast"]["factor"]],
        ["Fixed growth basis points", plan["growth_bps"]], ["Downside change basis points", plan["downside_bps"]],
        ["Upside change basis points", plan["upside_bps"]],
        ["Planning allocation fraction", str(fund["allocation_numerator"]) + "/" + str(fund["allocation_denominator"])],
        ["Allocation basis", fund["allocation_basis"]], ["Opening balance basis", fund["opening_basis"]],
        ["Assumptions", plan["assumptions"]], ["Historical WAPE", report["forecast"]["backtest_wape"]],
        ["Historical comparison", report["forecast"]["backtest_method"]],
        ["Scenario interpretation", report["forecast"]["scenarios"]],
        ["Cash coverage", report["cash"]["coverage"]],
        ["Review", payload["review"]["note"]], ["Reviewed by", payload["review"]["actor"]],
        ["Finalized", payload["finalized"]], ["Report source SHA256", payload["report"]["digest"]],
    ]
    sheets.append(("Operating assumptions", ["Field", "Value"], assumptions))
    files = {}
    for name, headers, rows in sheets:
        filename = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-") + ".csv"
        files["tables/" + filename] = csv_file(headers, rows)
    files["Tourism_Reporting.xlsx"] = workbook(sheets, units)
    files["report.json"] = store.bytes(payload["report"]["digest"])
    files["period.json"] = (encoded(record) + "\n").encode()
    files["quarterly.json"] = (encoded(quarters) + "\n").encode()
    files["annual-plan.txt"] = (plan["annual_plan"] + "\n").encode()
    for source in report["sources"]:
        p = source["payload"]
        prefix = "sources/" + source["id"] + "-r" + str(source["revision"]) + "/"
        files[prefix + "record.json"] = (encoded(source) + "\n").encode()
        original_name = re.sub(r"[^A-Za-z0-9._-]", "_", p["original"]["name"]) or "original"
        if original_name in (".", ".."):
            raise ValueError("The original source filename cannot be a dot directory.")
        files[prefix + "original/" + original_name] = store.bytes(p["original"]["digest"])
        files[prefix + "normalised.json"] = store.bytes(p["normalised"]["digest"])
    totals = report["forecast"]["totals"]
    forecast_rows = "".join("<tr><td>" + esc(r["period"]) + "</td><td>" + esc(r["state"]) +
        "</td>" + "".join("<td class='number'>" + esc(amount(r[k])) + "</td>" for k in
        ("observed_minor", "base_minor", "downside_minor", "upside_minor", "planning_allocation_minor")) + "</tr>"
        for r in report["forecast"]["months"])
    fund_rows = "".join("<tr><td>" + esc(r["category"]) + "</td><td>" + esc(r["program"]) +
        "</td><td class='number'>" + esc(amount(r["net_receipts_minor"])) + "</td><td class='number'>" +
        esc(amount(r["net_expenditures_minor"])) + "</td></tr>" for r in report["cash"]["groups"])
    budget_rows_html = "".join("<tr><td>" + esc(r["year"]) + " " + esc(r["status"]) + "</td>" +
        "".join("<td class='number'>" + esc(amount(r[k + "_minor"])) + "</td>" for k in
        ("tgt_income", "reported_resources", "reported_expenditures", "reported_closing")) +
        "<td>" + esc(encoded(r["reported_differences"])) + "</td></tr>" for r in report["budgets"])
    issues = "".join("<li>" + esc(r["detail"]) + " <span class='small'>" +
                     esc(encoded({k: v for k, v in r.items() if k not in ("id", "detail")})) +
                     "</span></li>" for r in report["issues"])
    source_rows_html = "".join("<li><strong>" + esc(r["payload"]["label"]) + "</strong> — " +
        esc(r["payload"]["original"]["name"]) + ", " + str(r["payload"]["original"]["bytes"]) +
        " bytes. <span class='small'>" + esc(r["payload"]["source_url"]) + "</span></li>" for r in report["sources"])
    wape = report["forecast"]["backtest_wape"]
    wape_text = format(Decimal(wape) * 100, ".2f") + "%" if wape is not None else "No eligible historical comparison"
    document = """<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Tourism funding and forecast report</title>
<style>body{font:14px/1.55 Arial,sans-serif;color:#222;background:#fff;margin:38px auto;max-width:1200px;padding:0 24px}
header{border-bottom:2px solid #333;padding-bottom:20px}h1{font-size:26px;font-weight:600}h2{font-size:19px;margin-top:30px}
.meta{color:#555}.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:18px;margin:25px 0}.metric{border:1px solid #bbb;padding:16px}
.metric strong{display:block;font-size:20px}.table{overflow:auto}table{border-collapse:collapse;width:100%;font-size:12px}
th,td{border-bottom:1px solid #ccc;padding:10px;text-align:left;vertical-align:top}th{background:#eee}.number{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
.small{display:block;font-size:11px;color:#555;overflow-wrap:anywhere}pre{white-space:pre-wrap;font:inherit}.note{padding:14px;border-left:3px solid #888;background:#f4f4f4}
@media(max-width:700px){.grid{grid-template-columns:1fr}body{padding:0 12px}table{min-width:700px}}@media print{body{margin:0;max-width:none;padding:0}.table{overflow:visible}thead{display:table-header-group}h2{break-after:avoid}.metric{break-inside:avoid}}</style></head><body>"""
    document += "<header><p class='meta'>FINALIZED REPORT · " + esc(fund["jurisdiction"]) + "</p><h1>" + esc(plan["label"]) + "</h1>"
    document += "<p>" + esc(plan["start"]) + " through " + esc(payload["end"]) + " · observations through " + esc(plan["as_of"]) + "</p>"
    document += "<p class='meta'>Reviewed by " + esc(payload["review"]["actor"]) + " · finalized " + esc(payload["finalized"]) + "</p></header>"
    document += "<div class='grid'>" + "".join("<div class='metric'><span>" + esc(label) + "</span><strong>" + esc(amount(value)) + "</strong></div>" for label, value in
        (("Observed collection subtotal", totals["observed_minor"]), ("Base annual collection projection", totals["base_minor"]),
         ("Base planning allocation", totals["planning_allocation_minor"]))) + "</div>"
    document += "<p class='note'>" + esc(report["forecast"]["collection_basis"]) + ". " + esc(report["forecast"]["planning_allocation_meaning"]) + "</p>"
    document += "<h2>Monthly collections and forecast</h2><div class='table'><table><thead><tr>" + "".join("<th>" + x + "</th>" for x in
        ("Month", "State", "Observed", "Base", "Downside", "Upside", "Planning allocation")) + "</tr></thead><tbody>" + forecast_rows + "</tbody></table></div>"
    document += "<p>" + esc(report["forecast"]["scenarios"]) + "</p><h2>Forecast review</h2><p>" + esc(plan["assumptions"]) + "</p>"
    document += "<p>Seasonal factor: " + esc(report["forecast"]["factor"]) + ". Historical weighted absolute percentage error: " + esc(wape_text) + \
        " across " + str(len(report["forecast"]["backtest"])) + " eligible months. " + esc(report["forecast"]["backtest_method"]) + "</p>"
    document += "<h2>Selected operator fund accounting</h2><p>Opening cash including reserve: " + esc(amount(report["cash"]["opening_cash_minor"])) + \
        ". Recorded reserve: " + esc(amount(report["cash"]["recorded_reserve_minor"])) + ". Opening basis: " + esc(fund["opening_basis"]) + "</p>"
    document += "<p>Selected cash entries: " + str(len(report["cash"]["rows"])) + ". " + esc(report["cash"]["meaning"]) + "</p>"
    document += "<div class='table'><table><thead><tr><th>Category</th><th>Program</th><th>Net receipts</th><th>Net expenditures</th></tr></thead><tbody>" + fund_rows + "</tbody></table></div>"
    document += "<p>Calculated closing cash for the selected entries: " + esc(amount(report["cash"]["closing_cash_minor"])) + "</p>"
    document += "<h2>Original published budget columns</h2><div class='table'><table><thead><tr><th>Year / status</th><th>TGT</th><th>Resources</th><th>Expenditures</th><th>Closing</th><th>Original arithmetic differences (minor units)</th></tr></thead><tbody>" + budget_rows_html + "</tbody></table></div>"
    document += "<h2>Reviewed source differences</h2><ul>" + (issues or "<li>No source arithmetic differences in the selected records.</li>") + "</ul>"
    document += "<p>" + esc(payload["review"]["note"]) + "</p><h2>Annual operating plan</h2><pre>" + esc(plan["annual_plan"]) + "</pre>"
    document += "<h2>Original inputs</h2><ul>" + source_rows_html + "</ul><p>The accompanying workbook and complete CSV tables retain the monthly forecast, quarterly totals, historical forecast comparisons, original distributions, operator cash entries, budgets and source identities.</p>"
    document += "<p class='small'>Prepared report SHA256 " + esc(payload["report"]["digest"]) + "</p></body></html>"
    files["Tourism_Report.html"] = document.encode()
    files["RECEIVING.md"] = ("""# Tourism reporting receiving

Open Tourism_Report.html for the finalized staff report and Tourism_Reporting.xlsx
for all eleven editable data sheets. Original source files and normalized tables are
in sources/. report.json and period.json preserve the exact reviewed inputs.

Monthly observed amounts, future forecasts, published distributions and operator cash
remain different measures. The planning allocation is a scenario based on the saved
fund fraction. The workbook's source and assumptions sheets retain its meaning.

The manifest lists every member's exact byte length and SHA256. The manifest itself
is the package index and is not included in its own file list.

Continue daily operation in the original Commons BI Operator's Tourism reporting view.
Use its normal Handoff and recovery view to create an encrypted whole-workspace backup;
restore with BI_OPERATOR.py restore into a fresh directory and open that directory.
This restores the original business IDs, source revisions and operation journal.

""" + plan["annual_plan"] + "\n").encode()
    summary = {"monthly_rows": len(month_rows), "quarterly_rows": len(quarter_rows),
               "cash_entries": len(cash_rows), "budget_columns": len(budget_rows),
               "historical_forecasts": len(backtest_rows), "source_editions": len(source_rows),
               "workbook_sheets": len(sheets), "currency": currency}
    return files, summary
