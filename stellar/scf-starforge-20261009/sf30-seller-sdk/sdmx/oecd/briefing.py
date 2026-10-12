"""MIT. Exact monthly comparisons and standalone OECD analyst reports."""
from __future__ import annotations

import csv
from decimal import Decimal, localcontext
import html
import io
import re

from bootstrap import InputError, projected_number, qualified

METHOD = {
    "title": "Composite leading indicators: amplitude-adjusted monthly index",
    "interpretation": (
        "The OECD describes this indicator as a qualitative signal of turning points "
        "in economic activity around its long-term potential. The amplitude-adjusted "
        "index has a long-term average of 100. Direction and turning points are the "
        "primary interpretation; the index is not a GDP growth-rate forecast."
    ),
    "comparison": (
        "One-, three- and twelve-month changes below are differences in original index "
        "points at exact calendar periods. They are derived report calculations. Missing "
        "periods and missing source values are preserved; no interpolation or rescaling is applied."
    ),
    "sources": [
        {"title": "OECD composite leading indicator", "url":
         "https://www.oecd.org/en/data/indicators/composite-leading-indicator-cli.html"},
        {"title": "OECD CLI frequently asked questions", "url":
         "https://www.oecd.org/en/data/insights/data-explainers/2024/04/composite-leading-indicators-frequently-asked-questions.html"},
        {"title": "OECD SDMX API", "url":
         "https://www.oecd.org/en/data/insights/data-explainers/2024/09/api.html"},
    ],
}


def monthly_index(period):
    if not isinstance(period, str) or not re.fullmatch(r"[12][0-9]{3}-(0[1-9]|1[0-2])", period):
        raise InputError("The selected CLI series contains a nonmonthly original period")
    return int(period[:4]) * 12 + int(period[5:7]) - 1


def monthly_period(index):
    return f"{index // 12:04d}-{index % 12 + 1:02d}"


def decimal_difference(left, right):
    if left is None or right is None:
        return None
    with localcontext() as ctx:
        ctx.prec = max(80, len(str(left)) + len(str(right)) + 20)
        return format(Decimal(left) - Decimal(right), "f")


def source_name(items, fallback):
    for language in ("en", ""):
        selected = [n.get("text", "") for n in items if n.get("lang", "") == language and n.get("text")]
        if selected:
            return selected[0]
    return next((n["text"] for n in items if n.get("text")), fallback)


def component_labels(metadata):
    lists = {qualified(c): c for c in metadata["codelists"]}
    result = {}
    structure = metadata["structures"][0]
    for component in structure["dimensions"] + structure["attributes"]:
        ref = component.get("codelist", {})
        found = lists.get(qualified(ref)) if ref.get("id") else None
        result[component["id"]] = {c["id"]: source_name(c.get("names", []), c["id"])
                                    for c in found["codes"]} if found else {}
    return result


def point_summary(by_period, period):
    row = by_period.get(period)
    if row is None or row["numeric_value"] is None:
        return None
    index = monthly_index(period)
    changes = {}
    for distance in (1, 3, 12):
        previous_period = monthly_period(index - distance)
        previous = by_period.get(previous_period)
        changes[str(distance)] = {"from_period": previous_period,
            "from_value": previous["value"] if previous else None,
            "index_point_change": decimal_difference(
                row["numeric_value"], previous["numeric_value"] if previous else None)}
    return {"period": period, "value": row["value"], "numeric_value": row["numeric_value"],
            "distance_from_100": decimal_difference(row["numeric_value"], "100"),
            "changes": changes, "status": row["attributes"].get("OBS_STATUS"),
            "attributes": row["attributes"]}


def build_briefing(catalog, edition, capture, request):
    source_view = catalog.source.project(edition["series"][0]["source_project"],
                                         edition["series"][0]["source_revision"])
    metadata = source_view["metadata"]
    labels = component_labels(metadata)
    result = []
    start, end = request["start_period"], request["end_period"]
    for item in sorted(edition["series"], key=lambda s: s["dimensions"]["REF_AREA"]):
        country = item["dimensions"]["REF_AREA"]
        rows, offset = [], 0
        while True:
            response = catalog.observations(edition["edition"]["id"], item["id"], offset, 1000)
            for original in response["rows"]:
                period = original["time_period"]
                monthly_index(period)
                if period < start or (end is not None and period > end):
                    continue
                value = projected_number(original)
                rows.append({"country": country, "time_period": period, "value": original["value"],
                    "value_present": original["value_present"], "value_kind": original["value_kind"],
                    "numeric_value": str(value) if value is not None else None,
                    "attributes": original["attributes"], "dimensions": original["dimensions"],
                    "action": original["action"]})
            offset += len(response["rows"])
            if offset >= response["total"]:
                break
            if not response["rows"]:
                raise InputError("Original catalog pagination stopped before the complete series")
        rows.sort(key=lambda r: r["time_period"])
        if len({r["time_period"] for r in rows}) != len(rows):
            raise InputError("The original series repeats a monthly period")
        if not rows:
            raise InputError("The selected report window contains no observations for " + country)
        by_period = {r["time_period"]: r for r in rows}
        numeric_periods = [r["time_period"] for r in rows if r["numeric_value"] is not None]
        missing = [monthly_period(i) for i in range(monthly_index(rows[0]["time_period"]),
                    monthly_index(rows[-1]["time_period"]) + 1) if monthly_period(i) not in by_period]
        result.append({"country": country, "country_name": labels.get("REF_AREA", {}).get(country, country),
            "series_id": item["id"], "series_key": item["series_key"], "dimensions": item["dimensions"],
            "dimension_labels": {key: labels.get(key, {}).get(value, value)
                                 for key, value in item["dimensions"].items()},
            "unit": item["unit"], "unit_multiplier": item["unit_multiplier"],
            "declared_decimals": sorted({r["attributes"].get("DECIMALS", "") for r in rows}),
            "native_observation_count": item["observation_count"], "observations": rows,
            "missing_periods": missing, "missing_value_periods": [r["time_period"] for r in rows if r["numeric_value"] is None],
            "first_period": rows[0]["time_period"], "last_period": rows[-1]["time_period"],
            "latest": point_summary(by_period, numeric_periods[-1]) if numeric_periods else None,
            "common": None})
    common = None
    for item in result:
        periods = {r["time_period"] for r in item["observations"] if r["numeric_value"] is not None}
        common = periods if common is None else common & periods
    common_period = max(common) if common else None
    if common_period:
        for item in result:
            item["common"] = point_summary({r["time_period"]: r for r in item["observations"]}, common_period)
    return {"schema": "stellar-forge.oecd-briefing-document.v1",
        "title": request["title"], "notes": request["notes"], "request": request,
        "catalog_edition_id": edition["edition"]["id"], "catalog_created_at": edition["edition"]["created_at"],
        "source_capture_id": capture["id"], "source_capture_label": capture["label"],
        "flow": capture["flow"], "metadata_sha256": capture["metadata_sha256"],
        "source_project_id": source_view["project"]["id"],
        "source_project_revision": source_view["project"]["revision"],
        "native_snapshot": source_view["build"]["snapshot"],
        "observation_count": sum(len(s["observations"]) for s in result),
        "native_observation_count": sum(s["native_observation_count"] for s in result),
        "common_period": common_period, "report_window": {"start": start, "end": end},
        "series": result, "methodology": METHOD,
        "sources": [{"sha256": s["sha256"], "bytes": s["bytes"], "name": s["name"],
                     "origin": s.get("origin", ""), "kind": s["kind"],
                     "coverage": s.get("coverage", {})} for s in capture["sources"]],
        "scope": ("The report window selects original observations for this briefing. "
                  "The attached native customer edition preserves all captured observations "
                  "for the same selected country series.")}


def render_csv(report):
    buffer = io.StringIO(newline="")
    writer = csv.writer(buffer, lineterminator="\r\n")
    writer.writerow(["country", "country_name", "time_period", "original_value", "value_present", "value_kind",
                     "unit_measure", "unit_multiplier", "adjustment", "transformation", "methodology",
                     "observation_status", "declared_decimals", "source_action", "series_key",
                     "capture_id", "catalog_edition_id"])
    for item in report["series"]:
        for row in item["observations"]:
            writer.writerow([item["country"], item["country_name"], row["time_period"],
                row["value"] if row["value"] is not None else "", str(row["value_present"]).lower(),
                row["value_kind"], row["dimensions"]["UNIT_MEASURE"], row["attributes"].get("UNIT_MULT", ""),
                row["dimensions"]["ADJUSTMENT"], row["dimensions"]["TRANSFORMATION"],
                row["dimensions"]["METHODOLOGY"], row["attributes"].get("OBS_STATUS", ""),
                row["attributes"].get("DECIMALS", ""), row["action"], item["series_key"],
                report["source_capture_id"], report["catalog_edition_id"]])
    return buffer.getvalue()


def escaped(value):
    return html.escape(str(value), quote=True)


def display(value):
    return escaped(value) if value is not None else "—"


def sparkline(item, width=720, height=180):
    rows = item["observations"]
    numeric = [(monthly_index(r["time_period"]), Decimal(r["numeric_value"]))
               for r in rows if r["numeric_value"] is not None]
    if not numeric:
        return '<p>No numeric source observations in this window.</p>'
    x0, x1 = monthly_index(rows[0]["time_period"]), monthly_index(rows[-1]["time_period"])
    low, high = min(v for _, v in numeric), max(v for _, v in numeric)
    low, high = min(low, Decimal("100")), max(high, Decimal("100"))
    span = max(high - low, Decimal("0.25"))
    low, high = low - span / 10, high + span / 10
    def point(i, value):
        x = 48 + (i - x0) * (width - 72) / max(1, x1 - x0)
        y = 18 + float((high - value) / (high - low)) * (height - 50)
        return f"{x:.2f},{y:.2f}"
    baseline = point(x0, Decimal("100")).split(",")[1]
    segments, active, previous = [], [], None
    for row in rows:
        ordinal = monthly_index(row["time_period"])
        if row["numeric_value"] is None or (previous is not None and ordinal != previous + 1):
            if active:
                segments.append(active)
            active = []
        if row["numeric_value"] is not None:
            active.append(point(ordinal, Decimal(row["numeric_value"])))
        previous = ordinal
    if active:
        segments.append(active)
    paths = "".join('<polyline points="' + " ".join(points) +
                    '" fill="none" stroke="#292929" stroke-width="2"/>' for points in segments)
    return (f'<svg viewBox="0 0 {width} {height}" role="img" aria-label="{escaped(item["country_name"])} original monthly CLI">'
            f'<line x1="48" x2="{width-24}" y1="{baseline}" y2="{baseline}" stroke="#999" stroke-dasharray="4 4"/>'
            f'<text x="4" y="{baseline}" font-size="11">100</text>{paths}'
            f'<text x="48" y="{height-5}" font-size="11">{escaped(rows[0]["time_period"])}</text>'
            f'<text x="{width-80}" y="{height-5}" font-size="11">{escaped(rows[-1]["time_period"])}</text></svg>')


def render_html(report):
    table = []
    for item in report["series"]:
        point = item["common"]
        changes = point["changes"] if point else {}
        table.append("<tr><th>" + escaped(item["country_name"]) + "</th><td>" +
            display(point["value"] if point else None) + "</td>" +
            "".join("<td>" + display(changes.get(str(n), {}).get("index_point_change")) + "</td>" for n in (1, 3, 12)) +
            "<td>" + escaped(item["last_period"]) + "</td></tr>")
    chapters = []
    for item in report["series"]:
        latest = item["latest"]
        observation_rows = "".join("<tr><td>" + escaped(r["time_period"]) + "</td><td>" +
            display(r["value"]) + "</td><td>" + escaped(r["attributes"].get("OBS_STATUS", "")) +
            "</td><td>" + escaped(r["value_kind"]) + "</td></tr>" for r in item["observations"])
        chapters.append("<section><h2>" + escaped(item["country_name"]) + " · " + escaped(item["country"]) + "</h2>" +
            "<p class=muted>" + escaped(item["series_key"]) + "</p>" + sparkline(item) +
            "<p>Latest numeric observation: " + (escaped(latest["period"]) + " / " + escaped(latest["value"]) if latest else "none") +
            ". Retained report observations: " + str(len(item["observations"])) +
            ". Missing calendar periods: " + str(len(item["missing_periods"])) +
            ". Missing values: " + str(len(item["missing_value_periods"])) + ".</p>" +
            "<p>Unit: " + escaped(item["dimension_labels"].get("UNIT_MEASURE", item["unit"])) +
            "; adjustment: " + escaped(item["dimension_labels"].get("ADJUSTMENT", "")) +
            "; source multiplier: " + escaped(item["unit_multiplier"]) +
            "; declared decimals: " + escaped(", ".join(item["declared_decimals"])) + ".</p>" +
            "<details><summary>Original monthly observations</summary><table><thead><tr><th>Period</th><th>Value</th><th>Status</th><th>Presence</th></tr></thead><tbody>" +
            observation_rows + "</tbody></table></details></section>")
    sources = "".join("<li><a href='" + escaped(s["origin"]) + "'>" + escaped(s["name"]) +
                      "</a><br><code>" + escaped(s["sha256"]) + "</code> · " + str(s["bytes"]) + " bytes</li>"
                      for s in report["sources"])
    methods = "".join("<li><a href='" + escaped(s["url"]) + "'>" + escaped(s["title"]) + "</a></li>"
                      for s in report["methodology"]["sources"])
    return ("<!doctype html><html lang=en><meta charset=utf-8><meta name=viewport content='width=device-width,initial-scale=1'>"
        "<title>" + escaped(report["title"]) + "</title><style>"
        "body{font:15px/1.55 system-ui,sans-serif;color:#242424;background:#fff;max-width:1100px;margin:36px auto;padding:0 24px}"
        "h1{font-size:30px;line-height:1.2}h2{font-size:21px}h1,h2{font-weight:600}section{padding:22px 0;border-top:1px solid #bbb}"
        "p{max-width:90ch}.muted,small{color:#555}code{font-size:12px;overflow-wrap:anywhere}a{color:#222;text-decoration:underline}"
        "table{border-collapse:collapse;width:100%;font-variant-numeric:tabular-nums}th,td{padding:9px;border-bottom:1px solid #ddd;text-align:right}"
        "th:first-child,td:first-child{text-align:left}thead{background:#eee}svg{width:100%;max-height:210px}"
        "summary{cursor:pointer;font-weight:600}li{margin:12px 0}footer{border-top:1px solid #aaa;margin-top:28px;padding-top:20px}"
        "@media print{body{margin:0;max-width:none;font-size:10pt}section{break-inside:avoid}details{display:block}summary{display:none}a{color:inherit}}</style>"
        "<header><p class=muted>STELLAR FORGE · OECD ANALYST EDITION</p><h1>" + escaped(report["title"]) +
        "</h1><p>" + escaped(report["methodology"]["interpretation"]) + "</p><p>" +
        escaped(report["methodology"]["comparison"]) + "</p></header><section><h2>Same-period comparison · " +
        display(report["common_period"]) + "</h2><table><thead><tr><th>Country</th><th>Original index</th>"
        "<th>1 month · points</th><th>3 months · points</th><th>12 months · points</th><th>Latest source period</th></tr></thead><tbody>" +
        "".join(table) + "</tbody></table><p>" + escaped(report["scope"]) + "</p></section>" +
        ("<section><h2>Analyst notes</h2><p>" + escaped(report["notes"]).replace("\n", "<br>") + "</p></section>" if report["notes"] else "") +
        "".join(chapters) + "<section><h2>Original source edition</h2><p>Capture <code>" +
        escaped(report["source_capture_id"]) + "</code><br>Native snapshot <code>" +
        escaped(report["native_snapshot"]) + "</code><br>Customer edition <code>" +
        escaped(report["catalog_edition_id"]) + "</code></p><ul>" + sources +
        "</ul><h2>Methodology</h2><ul>" + methods + "</ul></section><footer>"
        "Original data and metadata: OECD and referenced SDMX code-list agencies. "
        "Report selection, index-point calculations and presentation: Stellar Forge. "
        "Original decimal strings, source codes and retained acquisition scope accompany this report.</footer></html>\n")
