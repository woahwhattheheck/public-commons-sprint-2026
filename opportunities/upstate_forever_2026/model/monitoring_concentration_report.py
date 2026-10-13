"""Readable original-observation context without a selected daily-flow series.

This renderer consumes a retained context. It performs descriptive counting
only; the native source adapter owns interpretation and interval construction.
"""
from __future__ import annotations

import csv
import html
import io
import json
from collections import Counter
from urllib.parse import urlsplit

SOURCE_SCHEMA = "upstate.monitoring-observed-source/v3"


def applies(record):
    return record.get("source_schema") == SOURCE_SCHEMA


def _json(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, allow_nan=False)


def _text(value):
    if value is None:
        return "Not available"
    if value == "":
        return "Empty in source"
    if isinstance(value, (dict, list, bool)):
        return _json(value)
    return str(value)


def _escape(value):
    return html.escape(_text(value), quote=True)


def _field(value):
    if not value["present"]:
        return "Not supplied"
    if value["value"] is None:
        return "Null in source"
    return _text(value["value"])


def _table(rows, columns, *, empty="No retained rows."):
    if not rows:
        return "<p class='empty'>" + _escape(empty) + "</p>"
    head = "".join("<th scope='col'>" + _escape(label) + "</th>" for key, label in columns)
    body = "".join("<tr>" + "".join("<td>" + _escape(row.get(key)) + "</td>"
                                   for key, label in columns) + "</tr>" for row in rows)
    return "<div class='table-wrap'><table><thead><tr>" + head + "</tr></thead><tbody>" + body + "</tbody></table></div>"


def _cohorts(record):
    # Use the Sampling compiler's exact presence/value identity, rather than
    # a second grouping definition that could silently pool different records.
    from .monitoring_recommendations import _cohort
    groups = {}
    for row in record.get("observations", []):
        identity, fields = _cohort(row)
        key = (row["station_id"], identity)
        group = groups.setdefault(key, {"station_id": row["station_id"],
            "cohort_id": identity, "fields": fields, "rows": []})
        group["rows"].append(row)
    return [groups[key] for key in sorted(groups)]


def _counts(rows):
    statuses = Counter()
    for row in rows:
        key = ("Not supplied" if "status" not in row else
               "Null in source" if row["status"] is None else
               "Empty in source" if row["status"] == "" else str(row["status"]))
        statuses[key] += 1
    return [{"status": key, "records": value} for key, value in sorted(statuses.items())]


def _monthly(group):
    rows = group["rows"]
    years = sorted({row["date"][:4] for row in rows})
    result = []
    for year in years:
        item = {"station_id": group["station_id"], "cohort_id": group["cohort_id"], "year": year}
        for month in range(1, 13):
            prefix = year + "-" + str(month).zfill(2)
            selected = [row for row in rows if row["date"][:7] == prefix]
            item["month_" + str(month).zfill(2)] = len({row["date"] for row in selected})
        result.append(item)
    return result


def _summary(group):
    rows, fields = group["rows"], group["fields"]
    return {"station_id": group["station_id"], "cohort_id": group["cohort_id"],
            "characteristic": _field(fields["characteristic"]),
            "method": _field(fields["method"]), "unit": _field(fields["unit"]),
            "fraction": _field(fields["fraction"]), "records": len(rows),
            "activities": (len({row["activity_id"] for row in rows if row.get("activity_identity_basis") == "original_activity"})
                           if any(row.get("activity_identity_basis") == "original_activity" for row in rows) else None),
            "original_record_groups": len({row["activity_id"] for row in rows if row.get("activity_identity_basis") == "original_record"}),
            "dates": len({row["date"] for row in rows}),
            "first_date": min(row["date"] for row in rows),
            "last_date": max(row["date"] for row in rows),
            "status_counts": _counts(rows), "exact_cohort_fields": fields}


def _csv(rows, fields):
    output = io.StringIO(newline="")
    writer = csv.DictWriter(output, fieldnames=fields, lineterminator="\n", extrasaction="ignore")
    writer.writeheader()
    for row in rows:
        writer.writerow({key: (_json(value) if isinstance(value, (dict, list, bool)) else value)
                         for key, value in row.items()})
    return output.getvalue().encode("utf-8")


def export_tables(record):
    if not applies(record):
        return {}
    groups = _cohorts(record)
    summaries = [_summary(group) for group in groups]
    monthly = [row for group in groups for row in _monthly(group)]
    excluded = record.get("excluded_observations", [])
    return {
        "observed-context/excluded-original-observations.csv": _csv(excluded,
            ["original_observation_id", "original_record_id", "source_row", "station_id",
             "activity_id", "date", "characteristic", "unit", "reasons",
             "original_cells", "original_record"]),
        "observed-context/exact-cohort-summary.csv": _csv(summaries,
            ["station_id", "cohort_id", "characteristic", "method", "unit", "fraction",
             "records", "activities", "original_record_groups", "dates", "first_date", "last_date",
             "status_counts", "exact_cohort_fields"]),
        "observed-context/exact-cohort-monthly-dates.csv": _csv(monthly,
            ["station_id", "cohort_id", "year"] +
            ["month_" + str(month).zfill(2) for month in range(1, 13)]),
    }


def render(record):
    if not applies(record):
        raise ValueError("Choose the original native-observation context")
    groups = _cohorts(record)
    observations = record.get("observations", [])
    excluded = record.get("excluded_observations", [])
    summary = record.get("summary", {})
    binding = record.get("native_observation_binding") or {}
    selection = binding.get("selection") or {}
    availability = record.get("flow_availability") or {}
    title = record.get("title") or "Observed support for the monitoring network"
    scope = record["source_period"]
    original_file = binding.get("original_file") or {}
    source_uri = binding.get("source_uri")
    try:
        uri = urlsplit(source_uri) if isinstance(source_uri, str) else None
    except ValueError:
        uri = None
    source_link = ("<a href='" + html.escape(source_uri, quote=True) + "'>Original data source</a>"
                   if uri and uri.scheme in {"https", "http"} and uri.netloc and not uri.username and not uri.password
                   else _escape(source_uri))
    provenance = [
        {"item": "Saved observation source", "value": binding.get("observation_id")},
        {"item": "Original project", "value": binding.get("project_id")},
        {"item": "Retained source title", "value": binding.get("title")},
        {"item": "Original file bytes", "value": original_file.get("bytes")},
        {"item": "Original file SHA256", "value": original_file.get("sha256")},
        {"item": "Source period", "value": scope["start_inclusive"] + " to " + scope["end_inclusive"]},
        {"item": "Saved context", "value": record.get("id")},
        {"item": "Saved monitoring network", "value": record.get("network_id")},
        {"item": "Saved plan", "value": record.get("plan_id")},
        {"item": "Saved campaign revision", "value": record.get("campaign_revision_id")},
    ]
    highlights = [
        {"label": "Original source rows", "value": summary.get("source_original_rows", summary.get("source_observations"))},
        {"label": "Usable original observations", "value": len(observations)},
        {"label": "Exact station/cohort groups", "value": len(groups)},
        {"label": "Excluded source rows", "value": len(excluded)},
    ]
    cards = "<dl class='summary'>" + "".join("<div><dt>" + _escape(row["label"]) +
        "</dt><dd>" + _escape(row["value"]) + "</dd></div>" for row in highlights) + "</dl>"
    station_columns = [
        ("source_station_id", "Original station"), ("network_station_id", "Network station"),
        ("match", "Binding"), ("catchment_id", "Catchment"),
        ("catchment_assignment", "Catchment assignment"),
        ("coordinate_origin", "Coordinate source"), ("original_datum", "Datum"),
        ("coordinate_difference_m", "Coordinate difference (m)"),
        ("coordinate_review", "Coordinate review"), ("observations", "Records"),
        ("sampling_dates", "Distinct dates")]
    stations = _table(record.get("station_matches", []), station_columns)
    inventory = _table([_summary(group) for group in groups], [
        ("station_id", "Station"), ("characteristic", "Characteristic"),
        ("method", "Method"), ("unit", "Unit"), ("fraction", "Fraction"),
        ("records", "Records"), ("activities", "Original activities"), ("dates", "Dates"),
        ("first_date", "First date"), ("last_date", "Last date")])
    cohort_sections = []
    month_columns = [("year", "Year")] + [
        ("month_" + str(index).zfill(2), name)
        for index, name in enumerate(("Jan", "Feb", "Mar", "Apr", "May", "Jun",
                                      "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"), 1)]
    for number, group in enumerate(groups, 1):
        fields = group["fields"]
        label = " / ".join(_field(fields[key]) for key in ("characteristic", "method", "unit"))
        metadata = [{"field": key.replace("_", " "), "value": _field(value)}
                    for key, value in fields.items()]
        cohort_sections.append("<section class='cohort'><h3>" + str(number) + ". " +
            _escape(group["station_id"]) + " — " + _escape(label) + "</h3>" +
            "<p class='identity'>Exact Sampling cohort: " + _escape(group["cohort_id"]) + "</p>" +
            _table(_monthly(group), month_columns) +
            _table(_counts(group["rows"]), [("status", "Retained result status"), ("records", "Records")]) +
            "<details><summary>Exact analytical cohort fields</summary>" +
            _table(metadata, [("field", "Field"), ("value", "Retained value")]) + "</details></section>")
    measurement_rows = []
    for row in observations:
        def quantity(field, unit_field):
            value = row.get(field)
            return (_text(value) + " " + _text(row.get(unit_field))
                    if value is not None else "Not available")
        lower = "-infinity" if row.get("lower_unbounded") is True else _text(row.get("lower"))
        upper = "+infinity" if row.get("upper_unbounded") is True else _text(row.get("upper"))
        interval = "Lower " + lower + "; upper " + upper + " " + _text(row.get("unit"))
        for endpoint in ("lower_open", "upper_open"):
            if endpoint in row:
                interval += "; " + endpoint.replace("_", " ") + ": " + _text(row[endpoint])
        measurement_rows.append({
            "station_id": row["station_id"], "source_row": row.get("source_row"),
            "date": row["date"], "characteristic": row.get("characteristic"),
            "status": row.get("status"), "result": quantity("result_value", "unit"),
            "limit": quantity("limit_value", "limit_unit"), "interval": interval})
    original_rows = _table(measurement_rows, [
        ("station_id", "Station"), ("source_row", "Source row"), ("date", "Date"),
        ("characteristic", "Characteristic"), ("status", "Status"),
        ("result", "Original result"), ("limit", "Original limit"),
        ("interval", "Retained interval")],
        empty="No original rows met the selected observation-interpretation conditions.")
    exclusion_table = _table(excluded, [
        ("original_record_id", "Original record"), ("source_row", "Source row"),
        ("station_id", "Station"), ("date", "Original date"),
        ("characteristic", "Characteristic"), ("reasons", "Retained exclusion reasons")],
        empty="Every retained source row met the selected observation-interpretation conditions.")
    calendar = _table(record.get("calendar", []), [
        ("date", "Planned date"), ("site_id", "Search area"),
        ("planned_network_station_id", "Network station"),
        ("source_station_id", "Original station"), ("station_basis", "Station basis"),
        ("source_activity_ids_same_date", "Original same-date activities"),
        ("original_flow_status", "Flow availability")],
        empty="This context has no selected saved calendar.")
    notes = "<ul>" + "".join("<li>" + _escape(note) + "</li>" for note in record.get("interpretation", [])) + "</ul>"
    source_settings = {
        "original_mapping": binding.get("original_mapping"),
        "original_options": binding.get("original_options"),
        "selection": selection,
        "flow_availability": availability,
        "flow_scope": record.get("flow_scope"),
    }
    flow_text = availability.get("reason") or "No daily-flow series was selected for this observation context."
    body = (
        "<header><p class='eyebrow'>TokenJunkieLabs · Monitoring</p><h1>" + _escape(title) +
        "</h1><p>Original measurements retained with their source, analytical cohorts and saved station bindings.</p></header>" +
        cards +
        "<section><h2>Measurement and flow support</h2><p>" + _escape(flow_text) +
        " Event coverage and flow-supported loads remain unavailable for this context. The retained observations support historical sampling coverage and source-method review.</p>" +
        "<p>Counts below describe all usable original observations in this saved context. The station table distinguishes matched and unmatched source stations; catchment bindings apply to the retained matches.</p></section>" +
        "<section><h2>Original station bindings</h2>" + stations + "</section>" +
        "<section><h2>Analytical cohort inventory</h2><p>Each group uses the exact field-presence and retained-value identity used by Sampling. Method, effective unit, fraction, value type, speciation, depth, programme, time and quantity support remain distinct. A selected reporting-limit unit fallback supplies the effective unit; original empty measurement-unit cells and the chosen option remain in the source records. Original activity counts use supplied activity identifiers; a fallback original-record grouping remains separately identified in the exported cohort summary.</p>" +
        inventory + "</section>" +
        "<section><h2>Historical sampling coverage</h2><p>Each month cell counts distinct observed dates in that year and exact station/cohort group. Zero means no retained date in that cell. Repeated results on one date count once in this table; their original records remain below. These counts describe the retained observations and do not assign a sampling target.</p>" +
        "".join(cohort_sections) + "</section>" +
        "<section><h2>Saved calendar and original activity dates</h2>" + calendar + "</section>" +
        "<section><h2>Original retained measurements</h2><p>Result values, laboratory limits, intervals and status fields are shown as retained by the source adapter. Source row numbers join these values to the full original observation table, including activity, method and record identifiers. Unit fallback and qualifier choices are recorded with the source settings.</p>" +
        original_rows + "</section>" +
        "<section><h2>Source rows excluded from the usable observation table</h2><p>" +
        str(len(excluded)) + " retained source rows. Each excluded row keeps its original cells, record and explicit reasons in the complete source and exclusion CSV.</p>" +
        exclusion_table + "</section>" +
        "<section><h2>Interpretation</h2>" + notes + "</section>" +
        "<section><h2>Source and saved selection</h2><p>" + source_link + "</p>" +
        _table(provenance, [("item", "Item"), ("value", "Retained value")]) +
        "<details><summary>Original mapping and selected interpretation options</summary><pre>" +
        _escape(json.dumps(source_settings, ensure_ascii=False, indent=2, allow_nan=False)) + "</pre></details></section>" +
        "<footer>TokenJunkieLabs · Original observation context. Complete source records and selections accompany this report.</footer>")
    style = (
        "body{font:15px/1.5 system-ui,sans-serif;color:#171717;background:#fff;margin:0 auto;padding:28px 20px;max-width:1200px}"
        "*{box-sizing:border-box}h1,h2,h3{line-height:1.25;overflow-wrap:anywhere}h1{font-size:28px;margin:8px 0 14px}"
        "h2{font-size:21px;margin:0 0 12px}h3{font-size:17px}p{max-width:90ch}section{margin:28px 0}"
        ".eyebrow,footer,.identity{color:#555}.eyebrow{font-size:13px}.identity{font-size:12px;overflow-wrap:anywhere}"
        ".summary{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin:24px 0}.summary div{border:1px solid #bbb;padding:14px}"
        "dt{font-size:13px;color:#444}dd{margin:8px 0 0;font-size:24px;font-weight:600}"
        ".table-wrap{overflow:auto;margin:14px 0;border:1px solid #bbb}table{border-collapse:collapse;width:100%;font-size:13px}"
        "th,td{padding:8px;border-bottom:1px solid #ddd;text-align:left;vertical-align:top;overflow-wrap:anywhere}"
        "th{background:#eee;font-weight:600}tr:last-child td{border-bottom:0}a{color:inherit}"
        "details{margin:14px 0}summary{cursor:pointer;font-weight:600}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px}"
        ".cohort{border-top:1px solid #bbb;padding-top:12px}.empty{color:#555}footer{border-top:1px solid #bbb;padding-top:16px;font-size:12px}"
        "@media(max-width:600px){body{padding:20px 12px}.summary{grid-template-columns:repeat(2,minmax(0,1fr))}h1{font-size:24px}th,td{padding:7px}}"
        "@media print{body{max-width:none;padding:0;font-size:10px}.summary{gap:7px}.summary div{padding:8px}dd{font-size:17px}"
        "h1{font-size:20px}h2{font-size:16px}h3{font-size:13px}section{margin:16px 0}.table-wrap{overflow:visible;border:0}"
        "table{font-size:7px;table-layout:fixed}th,td{padding:4px;overflow-wrap:anywhere}tr{break-inside:avoid}"
        "h2,h3{break-after:avoid}details{display:none}.identity{font-size:8px}footer{font-size:8px}}")
    return "<!doctype html><html lang='en'><head><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'><title>" + _escape(title) + "</title><style>" + style + "</style></head><body>" + body + "</body></html>"


def sampling_support(record):
    """Scientific source context visible in the ordinary proposal report."""
    if not applies(record):
        return ""
    binding = record.get("native_observation_binding") or {}
    availability = record.get("flow_availability") or {}
    return ("<section class='sampling-observation-source'><h2>Original measurement support</h2>"
        "<p>" + _escape(binding.get("title")) + ". Saved observation source " +
        _escape(binding.get("observation_id")) + ".</p><p>" +
        _escape(availability.get("reason") or "No daily-flow series was selected for this observation context.") +
        " Historical event coverage and flow-supported loads remain unavailable.</p>"
        "<p>The proposal uses the retained source mapping and qualifier options, including any explicitly selected reporting-limit unit fallback. Its analytical cohorts preserve "
        "method, effective unit, fraction, depth, value type, programme, time and quantity support, and original missing or null metadata. "
        "The accompanying observed-context report and source files contain the full measurement inventory, "
        "exact cohort fields and original interpretation choices.</p></section>")
