"""Present retained treatment-area quantities in existing scientific reports.

All mass, area, support and normalization values come from scenario_summary.
This adapter does not scan rasters or recalculate modeled benefits.
"""
from __future__ import annotations
import math

from .common import digest

EDITION = "upstate.scenario-treatment-report/v1"


def _number(value):
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return "Unavailable"
    if not math.isfinite(value):
        return "Unavailable"
    return format(value, ",.7g")


def _unit(value):
    return str(value or "Unavailable").replace("metric_tonnes", "metric tonnes").replace(
        "/changed_ha", "/net changed ha")


def _table(columns, rows, caption):
    return {"kind": "table", "columns": columns, "rows": rows, "caption": caption}


def sections(summary, *, baseline_run_id, alternative_run_ids):
    """Return ordinary typed report blocks in the original alternative order."""
    if summary is None:
        return []
    if summary.get("schema") != "upstate.scenario-summary/v1":
        raise ValueError("Treatment reporting requires the retained scenario summary")
    if digest({key: value for key, value in summary.items() if key != "id"}) != summary.get("id"):
        raise ValueError("Treatment summary differs from its retained original")
    expected = list(alternative_run_ids)
    if (summary.get("baseline_run_id") != baseline_run_id or
            summary.get("alternative_run_ids") != expected):
        raise ValueError("Treatment report and selected native alternatives differ")
    if summary.get("direction") != "alternative minus baseline":
        raise ValueError("Retain the original signed native comparison direction")
    runs = {row["run_id"]: row for row in summary["runs"]}
    grouped = {}
    for row in summary["rows"]:
        grouped.setdefault(row["run_id"], []).append(row)
    result = []
    for run_id in expected:
        run = runs[run_id]
        rows = grouped.get(run_id, [])
        if not rows:
            raise ValueError("The selected treatment lacks retained pollutant quantities")
        scenario = run["scenario"]
        title = scenario.get("title") or run_id
        footprint = run.get("landcover_footprint") or {}
        area = footprint.get("net_changed_hectares")
        count = footprint.get("net_changed_cells")
        paragraphs = [
            str(run.get("comparison_label") or run.get("comparison_kind")) + ". "
            "Positive avoided export means less modeled annual mass delivered to streams "
            "than the selected baseline; a negative value means an increase.",
            "Benefit per changed hectare describes the reporting area's modeled response "
            "divided by final changed land-cover area on the model grid. It is not the "
            "export density of treated cells. Nitrogen, phosphorus and sediment retain "
            "their separate annual mass units.",
        ]
        if footprint.get("change_area_reason"):
            paragraphs.append(str(footprint["change_area_reason"]))
        area_table = _table(
            ["Net changed cells", "Net changed model hectares", "Area basis"],
            [[_number(count), _number(area), str(footprint.get("change_area_basis") or
                                               footprint.get("change_area_reason") or
                                               "Final ownership was not recorded")]],
            "Final native ownership counts each remaining land-cover change once after "
            "ordered patches, excluding reverted cells. Patch application counts can overlap.",
        )
        quantities, coverage, reasons = [], [], []
        seen = set()
        for row in rows:
            pollutant = row["pollutant"]
            if pollutant in seen:
                raise ValueError("The treatment summary repeats a pollutant for one native run")
            seen.add(pollutant)
            label = str(row.get("pollutant_label") or pollutant)
            normal_key = "reporting_avoided_export_per_net_changed_model_ha"
            normalized = row.get(normal_key)
            reason = row.get("treatment_normalization_reason")
            if reason:
                normalized = None
                reasons.append(label + ": " + str(reason))
            elif normalized is None:
                reasons.append(label + ": this retained summary did not record a comparable changed-hectare benefit.")
            joint = row.get("joint_valid_cells")
            supported = (isinstance(joint, int) and not isinstance(joint, bool) and joint > 0)
            avoided = row.get("avoided_export") if supported else None
            quantities.append([
                label, _number(avoided), _unit(row.get("change_units") or row.get("sum_units")),
                _number(normalized), _unit(row.get(normal_key + "_units")),
            ])
            coverage.append([
                label, _number(row.get("baseline_valid_cells")),
                _number(row.get("valid_cells")), _number(joint),
                _number(row.get("joint_valid_area_ha")),
            ])
        blocks = [
            *paragraphs, area_table,
            _table(["Pollutant", "Avoided annual export", "Annual unit",
                    "Benefit / changed ha", "Normalized unit"], quantities,
                   "Original retained comparison values. Normalization is available for an "
                   "original land-cover baseline, unchanged native parameter assumptions, "
                   "positive final changed area and nonempty complete shared reporting support."),
            _table(["Pollutant", "Baseline valid cells", "Alternative valid cells",
                    "Shared valid cells", "Shared hectares"], coverage,
                   "Coverage is pollutant-specific. Paired annual changes use the shared cells; "
                   "full totals on unequal valid footprints are not subtracted."),
            *reasons,
            "Scenario " + str(scenario["id"]) + "; native run " + run_id +
            "; profile " + str(run["profile"]["id"]) + "; baseline " + baseline_run_id + ".",
            "Retained scenario summary " + summary["id"] + ". The complete original "
            "quantities and reasons accompany this report in scenario-summary.json and scenario-summary.csv.",
        ]
        result.append(("Treatment response: " + str(title), blocks))
    return result


def client_sections(summary, *, baseline_run_id, alternative_run_ids):
    """Adapt the same blocks to the maintained client compiler's section model."""
    result = []
    for index, (title, blocks) in enumerate(sections(
            summary, baseline_run_id=baseline_run_id,
            alternative_run_ids=alternative_run_ids)):
        result.append({
            "id": "treatment-response-" + str(index + 1),
            "title": title,
            "paragraphs": [block for block in blocks if isinstance(block, str)],
            "tables": [{key: block[key] for key in ("columns", "rows", "caption")}
                       for block in blocks if isinstance(block, dict) and block["kind"] == "table"],
        })
    return result
