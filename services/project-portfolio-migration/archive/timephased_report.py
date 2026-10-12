"""Readable reporting/receiving instructions for the retained native period tables."""
from __future__ import annotations

import html


def report_section(review):
    value = review.get("timephased")
    if value is None:
        return ""
    e = lambda item: html.escape("" if item is None else str(item), quote=True)

    def table(columns, rows):
        return ("<div class='scroll'><table><thead><tr>" +
                "".join("<th>" + e(name) + "</th>" for name in columns) +
                "</tr></thead><tbody>" +
                "".join("<tr>" + "".join("<td>" + e(item) + "</td>" for item in row) + "</tr>" for row in rows) +
                "</tbody></table></div>")

    profile = review["profile"]["timephased"]
    periods = table(["Period", "Local start", "Native local finish"], [
        (row["label"], row["start"], row["finish"]) for row in profile["periods"][:48]])
    series = table(["Series", "Native field", "Kind", "Selected work unit"], [
        (row["name"], row["field"], row["kind"], row.get("units")) for row in profile["series"]])
    captures = table(["Original edition", "Native calculation", "Assignments", "Period facts", "Native errors", "Complete source JSONL"], [
        (row["edition_id"], row["capture_id"], row["assignment_count"], row["fact_count"],
         row["native_errors"], "source/operator-objects/" + row["sha256"]) for row in value["captures"]])
    totals = table(["Project", "Period", "Series", "Exact total", "Currency", "Unit / elapsed",
                    "Material resource", "Values / nulls / inapplicable / errors"], [
        (row["project_key"], row["period_key"], row["series"], row["total_text"],
         row["currency"], str(row["units"] or "") + " / " + str(row["elapsed"] or ""),
         row["material_resource_entity_id"],
         " / ".join(str(row[k]) for k in ("value_rows", "null_rows", "not_applicable_rows", "error_rows")))
        for row in value["totals_preview"]])
    links = " · ".join('<a href="tables/' + name + '.csv">' + label + "</a>" for name, label in (
        ("timephased_totals", "Every period total"), ("timephased_values", "Every assignment value"),
        ("timephased_assignment_basis", "Effective native calendars and rates"),
        ("timephased_spans", "Original raw spans"), ("resource_rate_values", "Dated rate values"),
        ("calendar_rules", "Retained calendar rules")))
    return ("<section><h2>Native period reporting</h2>"
            "<p>These values come from the original MPXJ ResourceAssignment methods on each selected source edition. "
            "Intervals retain native project-local overlap/accrual rules: duration overlap excludes the finish; instant costs can include endpoints and use the first matching range. Original raw spans, resource rates, "
            "assignment effective calendars, project baseline calendars and complete native calculation records are retained beside the reporting rows.</p>"
            "<p>Totals use assignment grain and exact decimal addition. Currency, work units, elapsed status and individual "
            "material resources remain separate. A native null has no invented zero value. Task fixed costs are outside "
            "these assignment totals.</p><h3>Selected native series</h3>" + series +
            "<h3>Reporting periods</h3><p>Showing " + str(min(len(profile["periods"]), 48)) + " of " +
            str(len(profile["periods"])) + ' exact periods. <a href="tables/timephased_periods.csv">Complete period table</a>.</p>' +
            periods + "<h3>Saved native calculations</h3>" + captures +
            "<h3>Period totals</h3><p>Showing " + str(len(value["totals_preview"])) + " of " + str(value["totals_count"]) +
            " complete total rows. " + links + ".</p>" + totals +
            "<p>The Archive receive action verifies the retained calculation, original source and relational projection "
            "without starting a JVM. The imported native record and its field definitions remain available for audit.</p></section>")


def guide_section(review):
    value = review.get("timephased")
    if value is None:
        return ""
    return """
## Native period reporting

This publication includes timephased assignment facts from the exact original
MPXJ source edition and saved period profile. The selected native local ranges
and series are in the manifest review and timephased_periods/timephased_series.
Source work, costs and material amounts use their actual native field definitions.
Duration overlap excludes the finish; native instant cost accrual includes
endpoints and takes the first matching selected range. Baseline series use the
actual project baseline calendar; other series retain the assignment calendar.
No amount is moved between periods to impose another boundary convention.
Pro-rata COST-resource actual amounts are admitted only for equal-width,
contiguous positive whole-minute ranges, with bounded native internal steps.

timephased_values retains every original assignment/series/period value or null.
Its state distinguishes native_value, native_null, not_applicable, native_error and
unsupported_native_value. The full original typed output is in value_json.
timephased_totals retains exact decimal assignment sums with separate counts for
those states. Group currency amounts by project and currency; work by selected
units and elapsed status; material by the exact resource identity and label.
These are assignment values, so a task's separate fixed cost is outside their sum.

Each fact joins its original assignment, selected period, series and native basis.
timephased_assignment_basis retains the actual effective calendar, original
resource rate table and source-row identities. The capture table separately
retains the actual baseline calendar and the series/facts identify which native
calendar basis applies. Derived native calendars remain
complete JSON even when there is no source calendar row to join.
timephased_source_sets/timephased_spans retain the original RAW_TIMEPHASED fields
and every span's start, finish, amount-per-hour, total, native units and exact
model pointer. Material raw storage can use a duration representation; the
explicit dimension and separate native material calculation retain that meaning.

resource_rate_entries/resource_rate_values preserve every dated native rate entry
and rate index. resource_availability and calendar_rules preserve working rules,
exceptions, work weeks and the project's native unit conversion definitions.

The complete calculated JSONL object is named by timephased_captures.package_path.
It has an exact source/model/recipe/profile binding, native runtime identity,
ordered assignment/series values and completion footer. Receiving streams and
verifies that object through the original operator file store. It recomputes
every table and total from the restored source and these retained values before
accepting the cohort. No MPXJ installation is needed for this portable receiving.

Example exact SQL in the original desk:

SELECT project_key, period_key, series, currency, units, elapsed,
       material_resource_entity_id, total_text, value_rows, null_rows,
       not_applicable_rows, error_rows
FROM timephased_totals
ORDER BY project_key, period_key, series, currency, units, material_resource_entity_id;

Use a reviewed decimal_sum(value_text) only with the complete grouping dimensions.
The supplied Power Query function and Azure SQL schema include all new tables.
"""
