"""Compare complete saved Operating forecasts in their original operations case."""
from copy import deepcopy
from hashlib import sha256
from html import escape
import io
import json
import re
from urllib.parse import parse_qs
import zipfile

import forecast
from model import Problem, canonical, csv_bytes, digest
from plan_comparison import _changes, _difference, _paired, _path, changes_csv, impact_csv

SCHEMA = "stellar-forge.sf47.forecast-comparison.v1"
FORECAST_ID = re.compile(r"forecast-[a-f0-9]{32}")
CASE_ID = re.compile(r"operation-[a-f0-9]{32}")
DAILY_FIELDS = (
    "invoiceOutflowUsd", "packageOutflowUsd", "commercialOutflowUsd",
    "conditionalGrantInflowUsd", "forecastCustomerInflowUsd",
    "spendingOnlyDeltaUsd", "conditionalGrantDeltaUsd", "commercialDeltaUsd",
    "spendingOnlyBalanceUsd", "conditionalGrantBalanceUsd", "commercialBalanceUsd",
    "knownCommercialDeltaUsd", "knownCommercialBalanceUsd",
    "remainingWorkHours", "weeklyEquivalentHours", "availableWeeklyHours",
)
CURVES = (
    ("spendingOnly", "Existing obligations and grant work"),
    ("conditionalGrant", "With conditional grant receipts"),
    ("commercial", "With selected customer deliveries"),
)
FORMATS = ("json", "html", "changes-csv", "impact-csv", "daily-csv", "work-csv", "zip")


def _ident(value, pattern, label):
    if not isinstance(value, str) or pattern.fullmatch(value) is None:
        raise Problem("Select the original saved " + label + ".", 422, "FORECAST_COMPARISON_SELECTION")
    return value


def _expected(value):
    if value is not None and (not isinstance(value, str) or re.fullmatch(r"[a-f0-9]{64}", value) is None):
        raise Problem("Use the complete comparison SHA-256.", 422, "FORECAST_COMPARISON_SELECTION")
    return value


def _json(value):
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2) + "\n").encode("utf-8")


def _identity(value):
    return {key: deepcopy(value[key]) for key in
            ("id", "createdAt", "actor", "note", "sha256", "previewSha256", "source", "engineVersion")} | {
        "name": value["inputs"]["name"], "asOfDate": value["inputs"]["asOfDate"],
        "calendarStart": value["inputs"]["calendarStart"], "reportSha256": digest(value["report"])}


def _index(rows, field):
    return {str(row[field]): deepcopy(row) for row in rows}


def _occurrences(rows):
    """Preserve repeated native cash-event keys and their original occurrence order."""
    result, counts = {}, {}
    for row in rows:
        key = canonical([row.get("kind"), row.get("id"), row.get("commercialId"), row.get("date")])
        counts[key] = counts.get(key, 0) + 1
        result[key + "#" + str(counts[key])] = deepcopy(row)
    return result


def _metric(key, label, unit, before, after, path):
    left, right = _path(before, path), _path(after, path)
    return {"id": key, "label": label, "unit": unit, "before": left, "after": right,
            "delta": _difference(left, right), "path": "/" + "/".join(path)}


def build(before, after, case_identity):
    """Source-validated immutable reports; never reforecast either selected edition."""
    before, after = deepcopy(before), deepcopy(after)
    forecast.validate_saved(before)
    forecast.validate_saved(after)
    metrics = []
    for curve, label in CURVES:
        for field, title in (
            ("additionalCashNeededUsd", "Cash needed before opening balance"),
            ("gapAfterOpeningCashUsd", "Gap after opening balance"),
            ("endDeltaUsd", "Cumulative forecast cash change"),
            ("endBalanceUsd", "Ending available cash"),
        ):
            metrics.append(_metric(curve + "." + field, label + " — " + title, "USD",
                                   before, after, ("report", "scenarios", curve, field)))
    for field, label, unit in (
        ("openInvoiceUsd", "Included unpaid invoices", "USD"),
        ("remainingPackageCostUsd", "Remaining uninvoiced grant-package cash", "USD"),
        ("selectedCommercialUninvoicedCostUsd", "Selected customer remaining uninvoiced cash", "USD"),
        ("remainingCashOutflowWithCommercialUsd", "Remaining outflow with selected customer work", "USD"),
        ("knownSelectedCommercialUninvoicedCostUsd", "Known valued customer portion", "USD"),
        ("knownRemainingCashOutflowWithCommercialUsd", "Known valued outflow portion", "USD"),
        ("remainingGrantPackageHours", "Remaining grant-package hours", "hours"),
        ("selectedCommercialHours", "Selected customer remaining hours", "hours"),
    ):
        if field.startswith("known") and all(field not in item["report"]["totals"] for item in (before, after)):
            continue
        metrics.append(_metric("totals." + field, label, unit, before, after, ("report", "totals", field)))
    for field, label, unit in (
        ("weeklyHours", "Entered or retained weekly capacity", "hours"),
        ("peakWeeklyEquivalentHours", "Peak required seven-day equivalent", "hours"),
        ("overloadedDays", "Days above available capacity", "days"),
    ):
        metrics.append(_metric("capacity." + field, label, unit, before, after, ("report", "capacity", field)))
    metrics.append(_metric("opening", "Opening available cash", "USD", before, after,
                           ("inputs", "openingCash", "amountUsd")))
    for field, label, unit in (
        ("undatedDeliveryCostUsd", "Selected undated delivery cost", "USD"),
        ("undatedCustomerReceiptsUsd", "Selected undated customer collections", "USD"),
        ("undatedHours", "Selected undated remaining hours", "hours"),
    ):
        if any("eventTiming" in item["report"] for item in (before, after)):
            metrics.append(_metric("eventTiming." + field, label, unit, before, after, ("report", "eventTiming", field)))
    days = []
    daily = [_index(item["report"]["days"], "date") for item in (before, after)]
    for stamp in sorted(set(daily[0]) | set(daily[1])):
        left, right = daily[0].get(stamp), daily[1].get(stamp)
        days.append({"date": stamp, "before": left, "after": right,
                     "delta": {key: _difference((left or {}).get(key), (right or {}).get(key)) for key in DAILY_FIELDS}})
    work = []
    work_maps = [{(row["date"], row["projectId"]): row for row in item["report"]["workDays"]} for item in (before, after)]
    for stamp, ident in sorted(set(work_maps[0]) | set(work_maps[1])):
        left, right = work_maps[0].get((stamp, ident)), work_maps[1].get((stamp, ident))
        work.append({"date": stamp, "projectId": ident, "before": left, "after": right,
                     "deltaHours": _difference((left or {}).get("hours"), (right or {}).get("hours"))})
    groups = {key: _paired(_index(before["report"][key], field), _index(after["report"][key], field))
              for key, field in (("packages", "id"), ("invoices", "id"), ("commercial", "id"), ("grants", "tranche"))}
    groups["cashEvents"] = _paired(_occurrences(before["report"]["events"]), _occurrences(after["report"]["events"]))
    source_groups = {}
    records = [item["snapshot"]["records"] for item in (before, after)]
    for kind in sorted(set(records[0]) | set(records[1])):
        source_groups[kind] = _paired(_index(records[0].get(kind, []), "id"), _index(records[1].get(kind, []), "id"))
    changes = []
    for area, field in (("assumptions", "inputs"), ("source", "snapshot")):
        changes.extend({"area": area, **row} for row in _changes(before[field], after[field], "/" + field))
    selected = [sorted(row["id"] for row in item["inputs"]["commercial"] if row["selected"]) for item in (before, after)]
    basis = {
        "delta": "after - before",
        "reportBasis": "The original complete saved reports. Differences are descriptive, not an attribution of cause or realized savings.",
        "dailyBasis": "Rows align by actual calendar date. An absent date has no delta; it is not assumed to be zero.",
        "cashBasis": "Conditional grants and selected customer collections remain forecasts. Actual payments remain in each original source snapshot.",
        "scopeBasis": "Selected work, as-of dates, opening balances, source facts and valuation coverage must be reviewed together before interpreting a change.",
        "sameAsOfDate": before["inputs"]["asOfDate"] == after["inputs"]["asOfDate"],
        "sameCalendarStart": before["inputs"]["calendarStart"] == after["inputs"]["calendarStart"],
        "sameOpeningCash": before["inputs"]["openingCash"] == after["inputs"]["openingCash"],
        "sameSelectedCustomers": selected[0] == selected[1],
        "sameOriginalCase": before["source"]["programId"] == after["source"]["programId"],
        "samePlanContent": before["source"]["planContentSha256"] == after["source"]["planContentSha256"],
        "samePlanSource": before["source"]["planSourceSha256"] == after["source"]["planSourceSha256"],
        "sameSourceFacts": before["source"]["factsSha256"] == after["source"]["factsSha256"],
        "sameEngine": before["engineVersion"] == after["engineVersion"],
    }
    notices = []
    for key, message in (
        ("sameAsOfDate", "The as-of dates differ. Each retained forecast starts from its own observed cash/work cutoff; cumulative balances have different starting points."),
        ("sameCalendarStart", "The selected plan day-zero dates differ. Compare the original calendar dates and retained payment terms."),
        ("sameOpeningCash", "The opening cash amount or its observed/assumed basis differs."),
        ("sameSelectedCustomers", "The selected customer scope differs. The full customer rows show each inclusion decision."),
        ("sameOriginalCase", "The saved sources retain different original case IDs after their native receiving history; both selected editions are in this current case."),
        ("samePlanContent", "The original planning content differs between these saved editions."),
        ("samePlanSource", "The original planning source document differs."),
        ("sameSourceFacts", "Original case facts changed. Review the complete source records and source-field changes."),
        ("sameEngine", "The original engine identities differ. Each saved result retains its original calculation identity."),
    ):
        if not basis[key]:
            notices.append({"code": key, "message": message})
    coverage = {}
    for side, item in (("before", before), ("after", after)):
        report = item["report"]
        coverage[side] = {"currencyValuation": deepcopy(report.get("currencyValuation")),
                          "eventTiming": deepcopy(report.get("eventTiming")),
                          "issues": deepcopy(report["issues"]),
                          "scenarios": deepcopy(report["scenarios"]),
                          "capacity": deepcopy(report["capacity"]),
                          "openingCash": deepcopy(report["openingCash"]),
                          "actual": deepcopy(report["actual"])}
        if report.get("currencyValuation", {}).get("complete") is False:
            notices.append({"code": side + ".valuation", "message": side.capitalize() + " has incomplete original-currency valuation. Unknown totals remain unknown; known valued portions are shown separately."})
    result = {"schema": SCHEMA, "case": deepcopy(case_identity),
              "before": _identity(before), "after": _identity(after), "basis": basis, "notices": notices,
              "summary": {"assumptionChanges": sum(row["area"] == "assumptions" for row in changes),
                          "sourceChanges": sum(row["area"] == "source" for row in changes),
                          "daysBefore": len(daily[0]), "daysAfter": len(daily[1]),
                          "overlapDays": len(set(daily[0]) & set(daily[1])),
                          "groupChanges": {key: sum(row["state"] != "unchanged" for row in rows) for key, rows in groups.items()}},
              "metrics": metrics, "groups": groups, "sourceGroups": source_groups,
              "changes": changes, "days": days, "work": work, "coverage": coverage,
              "snapshots": {"before": before, "after": after}}
    return {**result, "comparisonSha256": digest(result)}


def compare(ops, case_id, before_id, after_id, expected_sha256=None):
    case_id = _ident(case_id, CASE_ID, "case ID")
    before_id = _ident(before_id, FORECAST_ID, "before forecast ID")
    after_id = _ident(after_id, FORECAST_ID, "after forecast ID")
    _expected(expected_sha256)
    with ops.workspace.mutex:
        program, _ = ops._program(case_id)
        values = []
        for ident in (before_id, after_id):
            item = ops.forecast(case_id, ident)
            item.pop("current", None)
            values.append(item)
        result = build(*values, {"id": case_id, "createdAt": program["createdAt"]})
    if expected_sha256 is not None and expected_sha256 != result["comparisonSha256"]:
        raise Problem("The comparison differs from the selected complete saved editions.", 409, "FORECAST_COMPARISON_CHANGED")
    return result


def daily_csv(report):
    headers = ["date", "beforePresent", "afterPresent"]
    headers += [side + "_" + key for key in DAILY_FIELDS for side in ("before", "after", "delta")]
    rows = []
    for item in report["days"]:
        row = {"date": item["date"], "beforePresent": item["before"] is not None, "afterPresent": item["after"] is not None}
        for key in DAILY_FIELDS:
            for side in ("before", "after", "delta"):
                row[side + "_" + key] = (item[side] or {}).get(key)
        rows.append(row)
    return csv_bytes(headers, rows)


def work_csv(report):
    return csv_bytes(["date", "projectId", "beforePresent", "afterPresent", "beforeHours", "afterHours", "deltaHours"],
                     [{"date": row["date"], "projectId": row["projectId"],
                       "beforePresent": row["before"] is not None, "afterPresent": row["after"] is not None,
                       "beforeHours": (row["before"] or {}).get("hours"), "afterHours": (row["after"] or {}).get("hours"),
                       "deltaHours": row["deltaHours"]} for row in report["work"]])


def render_html(report):
    def text(value):
        return escape("Not entered / unavailable" if value is None else str(value), quote=True)
    def original(value, present=True):
        return "<span>Absent</span>" if not present else "<details><summary>Complete original value</summary><pre>" + escape(_json(value).decode()) + "</pre></details>"
    def table(headers, rows):
        return "<div class='scroll'><table><thead><tr>" + "".join("<th>" + text(x) + "</th>" for x in headers) + "</tr></thead><tbody>" + "".join("<tr>" + "".join("<td>" + x + "</td>" for x in row) + "</tr>" for row in rows) + "</tbody></table></div>"
    out = ["<!doctype html><html lang='en'><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'><title>Saved operating forecast comparison</title><style>body{font:15px system-ui,sans-serif;max-width:1200px;margin:2rem auto;padding:0 1rem;color:#202428;background:white}h1,h2{font-weight:600}h2{margin-top:2rem}.scroll{overflow:auto}table{border-collapse:collapse;width:100%;font-size:13px}th,td{border:1px solid #ccd0d2;padding:.5rem;text-align:left;vertical-align:top}th{background:#f1f2f3}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:12px ui-monospace,monospace}code{overflow-wrap:anywhere}@media print{body{margin:0;max-width:none}.scroll{overflow:visible}details{break-inside:avoid}}</style><body>",
           "<h1>Saved operating forecast comparison</h1><p>" + text(report["basis"]["reportBasis"]) + "</p>",
           "<p>Comparison: <code>" + text(report["comparisonSha256"]) + "</code></p>",
           table(["Side", "Name", "As of", "Saved", "Operator", "Original case/version", "Saved SHA-256"],
                 [[text(side), text(report[side]["name"]), text(report[side]["asOfDate"]), text(report[side]["createdAt"]),
                   text(report[side]["actor"]), text(report[side]["source"]["programId"]) + " / " + text(report[side]["source"]["version"]),
                   text(report[side]["sha256"])] for side in ("before", "after")]),
           "<h2>Reading the change</h2><p>" + text(report["basis"]["scopeBasis"]) + "</p><p>" + text(report["basis"]["dailyBasis"]) + "</p><p>" + text(report["basis"]["cashBasis"]) + "</p>",
           "<ul>" + "".join("<li>" + text(row["message"]) + "</li>" for row in report["notices"]) + "</ul>",
           "<h2>Funding, cash and remaining work</h2>",
           table(["Measure", "Unit", "Before", "After", "After minus before"],
                 [[text(row[k]) for k in ("label", "unit", "before", "after", "delta")] for row in report["metrics"]])]
    for title, mapping in (("Retained estimate and cash rows", report["groups"]), ("Original source records", report["sourceGroups"])):
        out.append("<h2>" + title + "</h2>")
        for kind, rows in mapping.items():
            out += ["<h3>" + text(kind) + "</h3>",
                    table(["Original key", "State", "Before", "After"],
                          [[text(row["id"]), text(row["state"]), original(row["before"], row["state"] != "added"),
                            original(row["after"], row["state"] != "removed")] for row in rows])]
    out += ["<h2>Valuation, undated work, source decisions and actual records</h2>",
            table(["Side", "Full retained coverage"], [[text(side), original(report["coverage"][side])] for side in ("before", "after")]),
            "<h2>Complete source and assumption field changes</h2>",
            table(["Area", "JSON pointer", "Change", "Before", "After"],
                  [[text(row["area"]), text(row["path"]), text(row["kind"]),
                    original(row["before"], row["beforePresent"]), original(row["after"], row["afterPresent"])] for row in report["changes"]]),
            "<h2>Daily cash and capacity</h2><p>" + text(report["basis"]["dailyBasis"]) + "</p>"]
    for key in DAILY_FIELDS:
        if any(key in (row["before"] or {}) or key in (row["after"] or {}) for row in report["days"]):
            out += ["<h3>" + text(key) + "</h3>", table(["Date", "Before present", "After present", "Before", "After", "Change"],
                    [[text(row["date"]), text(row["before"] is not None), text(row["after"] is not None),
                      text((row["before"] or {}).get(key)), text((row["after"] or {}).get(key)), text(row["delta"][key])] for row in report["days"]])]
    out += ["<h2>Remaining work by original project and day</h2>",
            table(["Date", "Project", "Before hours", "After hours", "Change"],
                  [[text(row["date"]), text(row["projectId"]), text((row["before"] or {}).get("hours")),
                    text((row["after"] or {}).get("hours")), text(row["deltaHours"])] for row in report["work"]]),
            "<h2>Both complete original saved forecasts</h2>", original(report["snapshots"]), "</body></html>"]
    return "\n".join(out).encode("utf-8")


def export_bundle(ops, case_id, before_id, after_id, expected_sha256=None):
    with ops.workspace.mutex:
        report = compare(ops, case_id, before_id, after_id, expected_sha256)
        files = {"comparison.json": _json(report), "report.html": render_html(report),
                 "changes.csv": changes_csv(report), "impact.csv": impact_csv(report),
                 "daily.csv": daily_csv(report), "work.csv": work_csv(report),
                 "before.json": _json(report["snapshots"]["before"]), "after.json": _json(report["snapshots"]["after"]),
                 "operations-case.zip": ops.export(case_id)}
        files["CONTENTS.json"] = _json({"schema": SCHEMA + ".package", "comparisonSha256": report["comparisonSha256"],
            "case": report["case"], "caseVersionAtExport": ops._program(case_id)[0]["version"],
            "originalCaseArchive": "operations-case.zip",
            "before": {"forecastId": before_id, "sha256": report["before"]["sha256"]},
            "after": {"forecastId": after_id, "sha256": report["after"]["sha256"]}})
        files["README.txt"] = (
            "Saved operating forecast comparison\n\nOpen report.html. Both complete selected forecasts are in before.json and after.json.\n"
            "Exact deltas use original retained values, after minus before. Absent dates and unknown values have no numeric delta.\n"
            "Review different as-of dates, source facts, selected scope, original currency coverage and opening balance assumptions together.\n"
            "A forecast change is not a measured saving, received payment or explanation of cause.\n\n"
            "To continue: import operations-case.zip using the existing Import operations workflow. Preserve its returned local case ID.\n"
            "Open Operating forecast > Compare saved forecasts, and select the original forecast IDs in CONTENTS.json.\n"
            "Match both selected saved SHA-256 identities. The receiving case has its own native ID; original forecast source identities remain.\n"
            "The case ZIP carries complete original plan/source/history and any later case work present at export. Later case work does not replace these selected forecasts.\n"
            "All other members and exact byte identities are in MANIFEST.json.\n").encode("utf-8")
        files["MANIFEST.json"] = _json({"schema": SCHEMA + ".manifest", "comparisonSha256": report["comparisonSha256"],
            "files": [{"path": name, "bytes": len(raw), "sha256": sha256(raw).hexdigest()} for name, raw in sorted(files.items())]})
    stream = io.BytesIO()
    with zipfile.ZipFile(stream, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
        for name, raw in sorted(files.items()):
            info = zipfile.ZipInfo(name, date_time=(2026, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o600 << 16
            archive.writestr(info, raw)
    return stream.getvalue()


def output(ops, case_id, before_id, after_id, format="json", expected_sha256=None):
    if format not in FORMATS:
        raise Problem("Select a supported complete forecast comparison format.", 422, "FORECAST_COMPARISON_SELECTION")
    args = (ops, case_id, before_id, after_id, expected_sha256)
    if format == "zip":
        return export_bundle(*args), "application/zip", "operating-forecast-comparison.zip"
    report = compare(*args)
    renderers = {"json": (_json, "application/json", "json"), "html": (render_html, "text/html; charset=utf-8", "html"),
                 "changes-csv": (changes_csv, "text/csv; charset=utf-8", "changes.csv"),
                 "impact-csv": (impact_csv, "text/csv; charset=utf-8", "impact.csv"),
                 "daily-csv": (daily_csv, "text/csv; charset=utf-8", "daily.csv"),
                 "work-csv": (work_csv, "text/csv; charset=utf-8", "work.csv")}
    renderer, mime, suffix = renderers[format]
    return renderer(report), mime, "operating-forecast-comparison." + suffix


def read_http(handler, parsed, ops):
    match = re.fullmatch(r"/api/operations/(operation-[a-f0-9]{32})/forecast-comparison(?:/(export\.zip|report\.html|comparison\.json|changes\.csv|impact\.csv|daily\.csv|work\.csv))?", parsed.path)
    if match is None:
        return False
    values = parse_qs(parsed.query, keep_blank_values=True)
    if set(values) - {"beforeId", "afterId", "expectedComparisonSha256"} or any(len(v) != 1 for v in values.values()):
        raise Problem("Use one value per supported forecast comparison parameter.", 422, "FORECAST_COMPARISON_SELECTION")
    ident, action = match.groups()
    args = (ops, ident, values.get("beforeId", [None])[0], values.get("afterId", [None])[0])
    expected = values.get("expectedComparisonSha256", [None])[0]
    if action is None:
        handler.send(200, compare(*args, expected_sha256=expected))
    else:
        if expected is None:
            raise Problem("Read and select the complete comparison before downloading.", 422, "FORECAST_COMPARISON_SELECTION")
        formats = {"export.zip": "zip", "report.html": "html", "comparison.json": "json",
                   "changes.csv": "changes-csv", "impact.csv": "impact-csv", "daily.csv": "daily-csv", "work.csv": "work-csv"}
        raw, mime, filename = output(*args, format=formats[action], expected_sha256=expected)
        handler.send(200, raw, mime, filename)
    return True
