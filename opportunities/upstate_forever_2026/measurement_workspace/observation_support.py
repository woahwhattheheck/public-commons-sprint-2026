"""Describe original concentration support without substituting censored results.

Consumes PublishedStudyStore observation rows and preserves their result/series
identities. Bounds apply to an arithmetic mean of retained result rows, conditional
on nonnegative concentration and the original reporting-limit statements.
"""
from __future__ import annotations

import html
import math
import re
from collections import defaultdict
from typing import Any

VERSION = "upstate.observation-support/v1"
CONCENTRATIONS = {"total_chlorophyll_a", "microcystins", "Ammonia",
                  "Nitrate + Nitrite", "Kjeldahl nitrogen", "Phosphorus", "Nitrogen"}
BASIS = (
    "The mean interval uses every retained result row in this station, parameter, "
    "source project and activity-type series. A quantified result contributes its "
    "reported value; a result explicitly below its original positive reporting "
    "limit contributes the interval from zero to that limit, with the upper endpoint "
    "excluded. This assumes nonnegative concentration. It assigns no concentration "
    "to an individual censored sample and is not a statistical confidence interval. "
    "The published report retains its separate analytical cohort and censor treatment."
)


def _basis(records):
    if records and records[0].get("statistic_basis") == "agreeing_original_activity_characteristic/v1":
        return ("The mean interval gives one weight to each agreeing original activity/characteristic measurement. "
                "All original result IDs and source rows remain attached. Quantified values retain their originals; "
                "below-limit values contribute [0, original reporting limit), conditional on nonnegative concentration. "
                "No individual censored value is substituted. This is not a statistical confidence interval. "
                "Original method, fraction, basis and effective unit remain separate series.")
    if records and records[0].get("source_observation"):
        return BASIS.replace("The published report retains its separate analytical cohort and censor treatment.",
                             "Fraction, method, original result type, basis fields and effective support unit remain separate source series.")
    return BASIS


def _number(value: Any) -> float | None:
    if value is None or isinstance(value, bool):
        return None
    try:
        result = float(value)
    except (TypeError, ValueError):
        return None
    return result if math.isfinite(result) else None


def _key(row: dict[str, Any]) -> tuple[str, ...]:
    return tuple(str(row.get(key, "")) for key in
                 ("site_id", "parameter", "project_id", "activity_type", "series_key"))


def _interval(row: dict[str, Any]) -> dict[str, Any]:
    value = _number(row.get("value"))
    limit = _number(row.get("detection_limit"))
    condition = str(row.get("detection_condition", ""))
    original_unit = str(row.get("unit") or "").strip()
    limit_unit = str(row.get("detection_limit_unit") or "").strip()
    censored = bool(row.get("censored"))
    base = {
        "record_id": row.get("original_record_id") or row.get("record_id"),
        "activity_id": row.get("activity_id"), "date": row.get("date"),
        "source_file": row.get("source_file"),
        "source_selector": row.get("source_selector"),
        **({"measurement_original_result_ids": row["measurement_original_result_ids"],
            "measurement_original_records": row["measurement_original_records"]}
           if "measurement_original_result_ids" in row else {}),
        "original_value": row.get("source_value_token", row.get("value")),
        "original_detection_condition": condition,
        "original_detection_limit": row.get("raw_cells", {}).get(
            "detection_limit", row.get("detection_limit")),
        "original_detection_limit_unit": limit_unit,
        "qualifier": row.get("qualifier", ""),
    }
    if (not censored and value is not None and value < 0
            and row.get("parameter") in CONCENTRATIONS):
        return {**base, "support": "unresolved", "unit": original_unit,
                "lower": None, "upper": None, "upper_inclusive": None,
                "reason": "The original negative result is retained, but conflicts with the nonnegative-concentration assumption."}
    if not censored and value is not None and original_unit:
        return {**base, "support": "quantified", "unit": original_unit,
                "lower": value, "upper": value, "upper_inclusive": True}
    # Upper censoring is classified first: an expression mentioning an upper
    # reporting limit must not become a finite below-limit interval.
    upper_censored = bool(re.search(r"above.*upper|greater than|greater-than|^>", condition, re.I))
    below = bool(re.search(r"below|not detected|less than|less-than|^<", condition, re.I))
    if (censored and below and not upper_censored and limit is not None
            and limit > 0 and limit_unit
            and (not original_unit or original_unit == limit_unit)):
        return {**base, "support": "below_original_limit", "unit": limit_unit,
                "lower": 0.0, "upper": limit, "upper_inclusive": False}
    return {**base, "support": "unresolved", "unit": original_unit or limit_unit,
            "lower": None, "upper": None, "upper_inclusive": None,
            "reason": "The original result has no complete compatible quantified value or below-limit interval."}


def summarize_series(records: list[dict[str, Any]]) -> dict[str, Any]:
    """Return support for exactly one existing native concentration series."""
    keys = {_key(row) for row in records}
    if len(keys) > 1:
        raise ValueError("Observation support requires one original native series.")
    parameter = records[0].get("parameter") if records else None
    details = [_interval(row) for row in records]
    units = sorted({item["unit"] for item in details if item["unit"]})
    quantified = [item for item in details if item["support"] == "quantified"]
    below = [item for item in details if item["support"] == "below_original_limit"]
    unresolved = [item for item in details if item["support"] == "unresolved"]
    activity_ids = [row.get("activity_id") for row in records if row.get("activity_id")]
    qualified = sorted({str(row["qualifier"]) for row in records if row.get("qualifier")})
    applicable = parameter in CONCENTRATIONS
    complete = bool(records and applicable and len(units) == 1 and not unresolved)
    lower = math.fsum(item["lower"] for item in details) / len(details) if complete else None
    upper = math.fsum(item["upper"] for item in details) / len(details) if complete else None
    limits = sorted({(item["upper"], item["unit"]) for item in below})
    notes = [_basis(records)]
    if not applicable:
        notes.append("A nonnegative-concentration interval is not defined for this parameter.")
    if len(units) != 1:
        notes.append("An aggregate interval requires one original unit; no unit conversion is applied.")
    if unresolved:
        notes.append("At least one original result has incomplete or incompatible numerical support; aggregate interval endpoints remain unavailable.")
    if len(activity_ids) != len(set(activity_ids)):
        notes.append("Some result rows share an activity identifier. The interval is weighted by result rows; distinct activities are counted separately.")
    if qualified:
        notes.append("Original result qualifiers remain attached: " + ", ".join(qualified) + ".")
    return {
        "schema": VERSION, "record_count": len(records),
        "distinct_activity_count": len(set(activity_ids)),
        "quantified_count": len(quantified),
        "below_limit_count": len(below), "unresolved_count": len(unresolved),
        "quantified_fraction": len(quantified) / len(records) if records else None,
        "unit": units[0] if len(units) == 1 else "; ".join(units),
        "mean_lower": lower, "mean_upper": upper,
        "mean_upper_inclusive": bool(complete and not below) if complete else None,
        "complete_interval_support": complete,
        "reporting_limits": [{"value": limit, "unit": unit} for limit, unit in limits],
        "qualifiers": qualified, "basis": " ".join(notes), "records": details,
    }


def enrich_observation_context(context: dict[str, Any]) -> dict[str, Any]:
    """Add support to existing series without changing selection or statistics."""
    groups: dict[tuple[str, ...], list[dict[str, Any]]] = defaultdict(list)
    for row in context.get("statistics_rows", context.get("rows", [])):
        groups[_key(row)].append(row)
    series = []
    for row in context.get("series", []):
        item = dict(row)
        records = groups.get(_key(row), [])
        item["observation_support"] = summarize_series(records)
        if context.get("statistic_basis") == "agreeing_original_activity_characteristic/v1":
            count = sum(record.get("measurement_original_result_count", 1) for record in records)
            item["observation_support"].update(record_count=count, original_result_count=count,
                measurement_count=len(records), statistic_basis=context["statistic_basis"])
        series.append(item)
    return {**context, "series": series, "observation_support_version": VERSION}


def _format(value: Any) -> str:
    number = _number(value)
    return "Unavailable" if number is None else format(number, ".6g")


def report_sections(context: dict[str, Any]) -> list[tuple[str, list[Any]]]:
    """Return existing scientific-report (heading, blocks) pairs."""
    observation = context.get("observations", context)
    enriched = enrich_observation_context(observation)
    weighted = enriched.get("statistic_basis") == "agreeing_original_activity_characteristic/v1"
    groups = defaultdict(list)
    for row in enriched["series"]:
        if row.get("parameter") in CONCENTRATIONS:
            groups[(row["parameter"], row.get("project_id", ""),
                    row.get("activity_type", ""), row.get("series_key", ""))].append(row)
    sections = []
    for (parameter, project, activity_type, series_key), records in sorted(groups.items()):
        coverage, means = [], []
        for row in records:
            support = row["observation_support"]
            coverage.append([
                str(row.get("site_id", "")), str(support["record_count"]), *([str(support["measurement_count"])] if weighted else []),
                str(support["quantified_count"]), str(support["below_limit_count"]),
                str(support["unresolved_count"]), support["unit"],
                "; ".join(_format(item["value"]) for item in support["reporting_limits"]) or "None",
            ])
            lower, upper = support["mean_lower"], support["mean_upper"]
            interval = "Unavailable"
            if lower is not None and upper is not None:
                interval = ("[" + _format(lower) + ", " + _format(upper)
                            + ("]" if support["mean_upper_inclusive"] else ")"))
            means.append([
                str(row.get("site_id", "")), _format(row.get("mean")),
                interval, support["unit"],
            ])
        title = "Original concentration support: " + parameter.replace("_", " ")
        blocks = [
            "Source project: " + project + "; activity type: " + activity_type + ". " + _basis(records),
            *([ "Sample fraction: " + str(records[0].get("sample_fraction", "")) +
                "; analytical method: " + str(records[0].get("method_authority", "")) + " / " + str(records[0].get("method_id", "")) +
                "; original result type: " + str(records[0].get("result_value_type", "")) +
                "; source series identity: " + series_key + "." ] if series_key else []),
            {"kind": "table", "columns": [
                "Station", "Result rows", *(["Measurements"] if weighted else []), "Supported quantified", "Below limit", "Unresolved",
                "Unit", "Original reporting limits",
            ], "rows": coverage, "widths": [1, .8, *([.8] if weighted else []), .9, .9, .9, .7, 1.4],
             "caption": "Coverage of the selected original result rows."},
            {"kind": "table", "columns": [
                "Station", "Quantified-only mean", "Supported mean interval", "Unit",
            ], "rows": means, "widths": [1, 1.6, 2.4, .8],
             "caption": "Concentration means; display rounded to six significant figures."},
            "Interval notation [a, b) includes a and excludes b. [a, a] means "
            "every retained result was quantified. Each series keeps its own "
            "calendar, project and activity type. Printed source-table counts "
            "remain in the published-summary comparison. The structured "
            "observation support retains full numerical endpoints and original result selectors.",
        ]
        sections.append((title, blocks))
    return sections


def report_html(context: dict[str, Any]) -> str:
    """Render the same support blocks inside the existing published-study report."""
    def esc(value: Any) -> str:
        return html.escape(str(value), quote=True)

    output = []
    for title, blocks in report_sections(context):
        output.append('<section data-observation-support="' + esc(VERSION) + '"><h2>' + esc(title) + "</h2>")
        for block in blocks:
            if isinstance(block, str):
                output.append("<p>" + esc(block) + "</p>")
            elif block.get("kind") == "table":
                if block.get("caption"):
                    output.append("<p>" + esc(block["caption"]) + "</p>")
                output.append('<div class="table-wrap"><table><thead><tr>')
                output.extend("<th scope=\"col\">" + esc(cell) + "</th>" for cell in block["columns"])
                output.append("</tr></thead><tbody>")
                for row in block["rows"]:
                    output.append("<tr>" + "".join("<td>" + esc(cell) + "</td>" for cell in row) + "</tr>")
                output.append("</tbody></table></div>")
        output.append("</section>")
    return "".join(output)

def main(argv=None):
    """Enrich an existing native selected-context.json and write its same report."""
    import argparse
    import json
    from pathlib import Path

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("selected_context", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args(argv)
    context = json.loads(args.selected_context.read_text(encoding="utf-8"))
    if context.get("schema") != "upstate.published-study-context/v1":
        raise ValueError("Select an exported native Published studies context.")
    result = {**context, "observations": enrich_observation_context(context["observations"])}
    args.output.mkdir(parents=True, exist_ok=True)
    (args.output / "selected-context.json").write_text(
        json.dumps(result, ensure_ascii=False, allow_nan=False, indent=2) + "\n",
        encoding="utf-8")
    (args.output / "observation-support-sections.json").write_text(
        json.dumps(report_sections(result), ensure_ascii=False, allow_nan=False, indent=2) + "\n",
        encoding="utf-8")
    from .published_studies import PublishedStudyStore
    complete_html = PublishedStudyStore.report_html(result)
    support_html = report_html(result)
    marker = 'data-observation-support="' + VERSION + '"'
    if marker not in complete_html:
        if "</main>" in complete_html:
            complete_html = complete_html.replace("</main>", support_html + "</main>", 1)
        elif "</body>" in complete_html:
            complete_html = complete_html.replace("</body>", support_html + "</body>", 1)
        else:
            raise ValueError("The original study HTML has no document insertion point.")
    (args.output / "study-report.html").write_text(complete_html, encoding="utf-8")
    return result


if __name__ == "__main__":
    main()
