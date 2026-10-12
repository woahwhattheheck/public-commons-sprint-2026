"""Complete load-review tables, editable workbook, original sources and analyst report."""
from __future__ import annotations

from decimal import Decimal
import html
import re

from .billing_export import csv_file, workbook
from .store import encoded
from .load_forecast_sources import KEY_FIELDS, ROW_FIELDS, strict_json


def export_review(store, record):
    p = record["payload"]
    report = strict_json(store.bytes(p["report"]["digest"]))
    plan = report["plan"]["payload"]
    numeric = lambda value: Decimal(value) if value is not None else ""
    sheets = []
    summary = [
        ["Review", p["label"]], ["Client", plan["client"]], ["Prepared for", plan["prepared_for"]],
        ["Mode", plan["mode"]], ["Baseline signal", plan["baseline_signal"]], ["Current signal", plan["current_signal"]],
        ["First selected year", plan["selection"]["first_year"]], ["Last selected year", plan["selection"]["last_year"]],
        ["Purpose", plan["purpose"]], ["Assumptions", plan["assumptions"]],
        ["Reviewed by", p["review"]["actor"]], ["Review note", p["review"]["note"]],
        ["Finalized", p["finalized"]], ["Prepared report SHA256", p["report"]["digest"]],
    ]
    summary += [[key, value] for key, value in report["summary"].items()]
    summary += [[key, value] for key, value in report["interpretation"].items()]
    sheets.append(("Review", ["Field", "Value"], summary))
    comparisons = []
    decisions = {d["key"]: d for d in p["review"]["decisions"]}
    for row in report["comparison"]:
        a, b = row["baseline"] or {}, row["current"] or {}
        d = decisions.get(row["key"], {})
        comparisons.append([row["key"], row["area"], row["geography"], row["metric"], row["season"],
            row["period_label"], row["period_start"], row["period_end"], row["period_basis"],
            row["coincidence"], row["basis"], row["state"], row["canonical_unit"],
            *[numeric(row[k]) for k in ("baseline_value", "current_value", "difference", "change_percent",
                                      "explained_change", "unexplained_change")],
            a.get("period_label", ""), a.get("value", ""), a.get("unit", ""), a.get("sheet", ""), a.get("cell", ""),
            b.get("period_label", ""), b.get("value", ""), b.get("unit", ""), b.get("sheet", ""), b.get("cell", ""),
            d.get("decision", ""), d.get("note", "")])
    sheets.append(("Comparisons", [
        "Observation", "Planning area", "Geography", "Metric", "Season", "Period label", "Period begins", "Period ends",
        "Year interpretation", "Peak coincidence", "Basis", "Coverage", "Canonical unit", "Baseline", "Current",
        "Current minus baseline", "Change percent", "Sourced explained change", "Remaining change",
        "Original baseline period", "Original baseline amount", "Original baseline unit", "Baseline sheet", "Baseline cell",
        "Original current period", "Original current amount", "Original current unit", "Current sheet", "Current cell",
        "Row decision", "Decision note"], comparisons))
    growth_fields = ["area", "geography", "metric", "season", "period_basis", "coincidence", "basis", "canonical_unit",
        "first_period", "last_period", "interval_years", "matched_observations", "missing_periods_between_endpoints",
        "baseline_first", "baseline_last", "baseline_growth", "baseline_cagr_percent",
        "current_first", "current_last", "current_growth", "current_cagr_percent", "accuracy_wape"]
    growth_numeric = {"interval_years", "baseline_first", "baseline_last", "baseline_growth", "baseline_cagr_percent",
                     "current_first", "current_last", "current_growth", "current_cagr_percent", "accuracy_wape"}
    sheets.append(("Series growth", [f.replace("_", " ") for f in growth_fields],
        [[numeric(row[k]) if k in growth_numeric else row[k] for k in growth_fields] for row in report["growth"]]))
    explanation_rows = [[r["target_key"], r["source"]["id"], r["source"]["revision"], r["source"]["label"],
        r["observation"]["geography"], r["observation"]["period_label"], r["observation"]["sheet"],
        r["observation"]["cell"], r["observation"]["value"], r["observation"]["unit"], r["direction"],
        numeric(r["signed_amount"]), r["observation"]["canonical_unit"], r["reason"]] for r in report["explanations"]]
    sheets.append(("Sourced explanations", ["Comparison observation", "Source", "Revision", "Source label",
        "Geography", "Period", "Sheet", "Cell", "Original amount", "Original unit", "Direction",
        "Signed explanation", "Canonical unit", "Interpretation"], explanation_rows))
    sheets.append(("Source issues", ["Issue", "Title", "Detail", "Original fields"],
        [[r["id"], r["title"], r["detail"], encoded({k: v for k, v in r.items() if k not in ("id", "title", "detail")})]
         for r in report["issues"]]))
    sheets.append(("Review decisions", ["Observation", "Decision", "Note"],
        [[d["key"], d["decision"], d["note"]] for d in p["review"]["decisions"]]))
    sources, observations, mappings, missing = [], [], [], []
    files = {"report.json": store.bytes(p["report"]["digest"]), "review.json": (encoded(record) + "\n").encode()}
    for source in report["sources"]:
        sp = source["payload"]
        sources.append([source["id"], source["revision"], sp["label"], sp["publisher"], sp["vintage"], sp["published"],
            sp["status"], sp["source_url"], sp["original"]["name"], sp["original"]["bytes"],
            sp["original"]["digest"], sp.get("normalised", {}).get("digest", ""), sp["review"]["note"]])
        prefix = "sources/" + source["id"] + "-r" + str(source["revision"]) + "/"
        name = re.sub(r"[^A-Za-z0-9._-]", "_", sp["original"]["name"])[:180] or "original"
        if name in (".", ".."):
            raise ValueError("An original filename cannot name a directory.")
        files[prefix + "record.json"] = (encoded(source) + "\n").encode()
        files[prefix + "original/" + name] = store.bytes(sp["original"]["digest"])
        if sp.get("normalised"):
            data = store.bytes(sp["normalised"]["digest"])
            files[prefix + "normalised.json"] = data
            normalised = strict_json(data)
            observations += [[source["id"], source["revision"], sp["vintage"], *[
                numeric(row[field]) if field in ("canonical_value",) else row.get(field, "") for field in ROW_FIELDS]]
                for row in normalised["rows"]]
            mappings += [[source["id"], source["revision"], mapping["id"], mapping["sheet"], encoded(mapping)]
                         for mapping in normalised["mappings"]]
            missing += [[source["id"], source["revision"], row["mapping_id"], row["sheet"], row["cell"],
                         row["period_label"], row["source_geography"], row.get("source_year", ""), row.get("source_month", ""),
                         row.get("year_cell", ""), row.get("month_cell", "")] for row in normalised["missing_cells"]]
    sheets.append(("Source inventory", ["Source", "Revision", "Label", "Publisher", "Vintage", "Published",
        "Publication role", "Original URL", "Original filename", "Original bytes", "Original SHA256",
        "Normalized SHA256", "Source review"], sources))
    sheets.append(("Original observations", ["Source", "Revision", "Vintage", *[f.replace("_", " ") for f in ROW_FIELDS]], observations))
    sheets.append(("Table mappings", ["Source", "Revision", "Mapping", "Sheet", "Complete mapping"], mappings))
    sheets.append(("Missing original cells", ["Source", "Revision", "Mapping", "Sheet", "Cell", "Period", "Source geography",
        "Original year", "Original month", "Year cell", "Month cell"], missing))
    for name, headers, rows in sheets:
        files["tables/" + re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-") + ".csv"] = csv_file(headers, rows)
    files["Load_Forecast_Review.xlsx"] = workbook(sheets, 6)
    esc = lambda value: html.escape(str(value if value is not None else ""), quote=True)
    number_text = lambda value: format(Decimal(value), ",.3f") if value is not None else "Missing"
    comparison_html = "".join("<tr>" + "".join("<td>" + esc(v) + "</td>" for v in
        (r["area"], r["geography"], r["metric"], r["season"], r["period_label"], r["state"], r["canonical_unit"],
         number_text(r["baseline_value"]), number_text(r["current_value"]), number_text(r["difference"]))) +
        "</tr>" for r in report["comparison"][:300])
    growth_html = "".join("<tr>" + "".join("<td>" + esc(v) + "</td>" for v in
        (r["geography"], r["metric"], r["season"], r["first_period"], r["last_period"], r["canonical_unit"],
         number_text(r["baseline_growth"]), number_text(r["current_growth"]),
         number_text(r["baseline_cagr_percent"]), number_text(r["current_cagr_percent"]),
         r["missing_periods_between_endpoints"])) + "</tr>" for r in report["growth"])
    issue_html = "".join("<li><strong>" + esc(r["title"]) + "</strong>: " + esc(r["detail"]) + "</li>" for r in report["issues"])
    doc = """<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Load forecast review</title><style>
body{font:14px/1.55 Arial,sans-serif;color:#222;background:white;margin:36px auto;max-width:1300px;padding:0 22px}
header{border-bottom:2px solid #333;padding-bottom:18px}h1{font-size:28px}h2{font-size:20px;margin-top:30px}
.meta{color:#555}.metrics{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin:22px 0}
.metric{border:1px solid #bbb;padding:15px}.metric strong{display:block;font-size:24px}
.table{overflow:auto}table{border-collapse:collapse;width:100%;font-size:12px}th,td{text-align:left;vertical-align:top;border-bottom:1px solid #ccc;padding:9px}
th{background:#eee}td{font-variant-numeric:tabular-nums}.note{border-left:3px solid #888;background:#f4f4f4;padding:14px}
small{display:block;overflow-wrap:anywhere}pre{font:inherit;white-space:pre-wrap}a{color:#333}
@media(max-width:700px){.metrics{grid-template-columns:repeat(2,1fr)}table{min-width:800px}}
@media print{body{max-width:none;margin:0;padding:0}.table{overflow:visible}thead{display:table-header-group}tr{break-inside:avoid}}</style></head><body>"""
    doc += "<header><p class='meta'>FINALIZED ANALYST REVIEW</p><h1>" + esc(p["label"]) + "</h1><p>" + esc(plan["client"]) + \
        " · " + esc(plan["prepared_for"]) + "</p><p class='meta'>Reviewed by " + esc(p["review"]["actor"]) + \
        " · " + esc(p["finalized"]) + "</p></header><div class='metrics'>"
    doc += "".join("<div class='metric'>" + esc(title) + "<strong>" + str(report["summary"][key]) + "</strong></div>" for title, key in
        (("Matched observations", "matched"), ("Changed values", "changed"), ("Baseline-only rows", "baseline_only"), ("Current-only rows", "current_only")))
    doc += "</div><h2>Purpose and interpretation</h2><pre>" + esc(plan["purpose"]) + "</pre><pre>" + esc(plan["assumptions"]) + "</pre>"
    doc += "<p class='note'>" + esc(report["interpretation"]["difference"]) + " " + esc(report["interpretation"]["aggregation"]) + "</p>"
    doc += "<h2>Selected forecast comparison</h2><p>" + str(len(report["comparison"])) + \
        " observations are retained in the workbook, complete comparison CSV and report JSON. This printable overview shows the first " + \
        str(min(300, len(report["comparison"]))) + " in geography and period order.</p>"
    doc += "<div class='table'><table><thead><tr>" + "".join("<th>" + title + "</th>" for title in
        ("Area", "Geography", "Metric", "Season", "Period", "Coverage", "Unit", "Baseline", "Current", "Change")) + \
        "</tr></thead><tbody>" + comparison_html + "</tbody></table></div>"
    doc += "<h2>Growth over common periods</h2><p>" + esc(report["interpretation"]["growth"]) + "</p>"
    doc += "<div class='table'><table><thead><tr>" + "".join("<th>" + title + "</th>" for title in
        ("Geography", "Metric", "Season", "First", "Last", "Unit", "Baseline growth", "Current growth", "Baseline CAGR %", "Current CAGR %", "Missing periods")) + \
        "</tr></thead><tbody>" + growth_html + "</tbody></table></div>"
    doc += "<h2>Source review</h2><ul>" + (issue_html or "<li>The selected source definitions and coverage match.</li>") + "</ul>"
    doc += "<pre>" + esc(p["review"]["note"]) + "</pre><h2>Row decisions</h2><ul>" + "".join("<li>" +
        esc(d["decision"]) + " · " + esc(d["key"]) + "<pre>" + esc(d["note"]) + "</pre></li>" for d in p["review"]["decisions"]) + "</ul>"
    doc += "<h2>Source editions</h2><ul>" + "".join("<li><strong>" + esc(s["payload"]["label"]) + "</strong> · " +
        esc(s["payload"]["vintage"]) + " · " + esc(s["payload"]["status"]) + "<small>" + esc(s["payload"]["source_url"]) +
        "</small><small>" + esc(s["payload"]["original"]["digest"]) + "</small></li>" for s in report["sources"]) + "</ul>"
    doc += "<p>Open <a href='Load_Forecast_Review.xlsx'>the editable analyst workbook</a> for all ten sheets. "
    doc += "The complete original workbooks, retained mappings, selected source editions and review decisions accompany this report.</p>"
    doc += "<small>Prepared report SHA256 " + esc(p["report"]["digest"]) + "</small></body></html>"
    files["Load_Forecast_Review.html"] = doc.encode()
    files["RECEIVING.md"] = ("""# Load forecast review receiving

Open Load_Forecast_Review.html for the printable analyst overview and
Load_Forecast_Review.xlsx for the ten editable review and source sheets.
tables/ contains all rows as UTF-8 CSV; report.json and review.json retain the
exact prepared inputs, selected plan, complete calculated results and final review.
sources/ contains every selected original file beside its retained source record
and normalized observations. Original files have their own namespace.

The original labels distinguish power from energy, coincident from noncoincident
peaks, forecasts from actual or weather-normalized observations, and annual
forecasts from informational updates. Comparisons require equal explicit geography,
metric, season, period interpretation, coincidence and basis. Unit conversion
uses decimal factors within the same physical dimension. Values are not summed
across overlapping planning areas or across peaks that may occur at different times.

Current minus baseline is the reported change. A zero baseline has no percentage
change. Compound growth uses the common endpoints and the actual elapsed interval.
Missing intermediate observations remain visible. Linked adjustment cells explain
a change and retain their source and sign; they do not alter either published value.
Per-series accuracy WAPE is present only for the explicit forecast-accuracy mode.

The workbook preserves values beyond Excel's fifteen significant digits as text.
Original amount text and source cells remain available for every observation.
CSV text with a formula prefix is escaped as text; original JSON and source bytes
retain the source representation.

To continue in a fresh Commons BI Operator, open Load forecasts → Receiving and
select this complete ZIP. The original service checks the complete member manifest,
source originals, normalized rows, comparison and finalized review. Choose
Continue as an editable plan to receive those original sources through the same
normal source and plan actions. The delivered edition stays retained; the new plan
has explicit local source references and its origin package.

For a whole-workspace move, use the original Handoff & recovery encrypted backup
and BI_OPERATOR.py restore command. That carries business history and original
operation IDs into a fresh location.
""").encode()
    return files, {"comparison_rows": len(comparisons), "growth_series": len(report["growth"]),
        "source_editions": len(sources), "source_observations": len(observations),
        "explanations": len(explanation_rows), "review_decisions": len(decisions), "workbook_sheets": len(sheets)}
