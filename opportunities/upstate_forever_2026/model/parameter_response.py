"""Interpret retained parameter comparisons without reopening native rasters.

Every derived quantity uses one original row's paired support. No row is combined
with another case and no absent-support mass is imputed. Original results remain
unchanged; this projection is shared by the operator and the exported report.
"""
from __future__ import annotations

import html
import csv
import io
import math

EDITION = "parameter-response-interpretation/1"


def _finite(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def _difference(a, b):
    return a - b if _finite(a) and _finite(b) else None


def _ratio(a, b):
    return a / b if _finite(a) and _finite(b) and b != 0 else None


def _count(value):
    return isinstance(value, int) and not isinstance(value, bool) and value >= 0


def explain(row, parameters=None):
    """Return source-relative mass accounting and finite parameter response.

    ``parameters`` is the original native parameter catalogue: key maps to
    (label, units, constraint). A missing catalogue does not infer physical units.
    The stored masses are annual pixel masses already summed by the original
    study; multiplying them by pixel area again would be dimensionally wrong.
    """
    parameters = parameters or {}
    paired_count = row.get("paired_valid_cells")
    paired_available = _count(paired_count) and paired_count > 0
    a, b = row.get("baseline_mass"), row.get("case_mass")
    af, bf = row.get("baseline_full_mass"), row.get("case_full_mass")
    paired_change = _difference(b, a) if paired_available else None
    whole_change = _difference(bf, af)
    a_only = _difference(af, a) if paired_available else None
    b_only = _difference(bf, b) if paired_available else None
    coverage_change = _difference(b_only, a_only)
    reconstructed = (paired_change + coverage_change
                     if _finite(paired_change) and _finite(coverage_change) else None)
    pixel_ha = row.get("pixel_area_ha")
    pixel_ha = pixel_ha if _finite(pixel_ha) and pixel_ha > 0 else None
    area_ha = row.get("paired_area_ha")
    area_ha = area_ha if paired_available and _finite(area_ha) and area_ha > 0 else None
    if area_ha is not None and pixel_ha is not None and not math.isclose(
            area_ha, paired_count * pixel_ha, rel_tol=1e-10, abs_tol=1e-10):
        # Keep the original row intact, but do not derive densities from
        # inconsistent recorded area rather than silently choosing one value.
        area_ha = None
    counts = {}
    for name in ("baseline", "case"):
        count = row.get(name + "_valid_cells")
        counts[name] = (count - paired_count if _count(count) and _count(paired_count)
                        and count >= paired_count else None)
    result = {
        "edition": EDITION, "case_id": row.get("case_id"), "run_id": row.get("run_id"),
        "area_id": row.get("area_id"), "pollutant": row.get("pollutant"),
        "units": row.get("units"), "paired_available": paired_available,
        "paired_change": paired_change, "full_change": whole_change,
        "baseline_only_mass": a_only, "case_only_mass": b_only,
        "coverage_contribution": coverage_change,
        "reconstructed_full_change": reconstructed,
        "reconciliation_residual": _difference(whole_change, reconstructed),
        "direction_reversal": bool(_finite(paired_change) and _finite(whole_change)
                                   and paired_change * whole_change < 0),
        "baseline_only_cells": counts["baseline"], "case_only_cells": counts["case"],
        "baseline_only_area_ha": (counts["baseline"] * pixel_ha
                                  if counts["baseline"] is not None and pixel_ha else None),
        "case_only_area_ha": (counts["case"] * pixel_ha
                              if counts["case"] is not None and pixel_ha else None),
        "paired_area_ha": area_ha,
        "paired_baseline_density": _ratio(a, area_ha),
        "paired_case_density": _ratio(b, area_ha),
        "paired_change_density": _ratio(paired_change, area_ha),
        "parameter_response": None,
    }
    overrides = row.get("overrides")
    if not isinstance(overrides, dict) or len(overrides) != 1:
        result["parameter_response_status"] = "baseline" if not overrides else "joint_parameters"
        return result
    path, selected = next(iter(overrides.items()))
    baseline, alternative = row.get("baseline_parameter"), row.get("case_parameter")
    if (path != row.get("parameter") or not _finite(baseline) or not _finite(alternative)
            or not _finite(selected) or selected != alternative):
        result["parameter_response_status"] = "categorical_or_unrecorded"
        return result
    step = alternative - baseline
    if not step:
        result["parameter_response_status"] = "unchanged_parameter"
        return result
    if not paired_available or not _finite(paired_change):
        result["parameter_response_status"] = "no_paired_support"
        return result
    key = path.rsplit(".", 1)[-1]
    specification = parameters.get(key)
    label = specification[0] if specification else path
    parameter_units = specification[1] if specification else "unrecorded native units"
    fractional_input = _ratio(step, baseline)
    response = {
        "parameter": path, "label": label, "units": parameter_units,
        "baseline": baseline, "case": alternative, "step": step,
        "percent_input_change": 100 * fractional_input if fractional_input is not None else None,
        "export_change_per_unit": paired_change / step,
        "elasticity": _ratio(_ratio(paired_change, a), fractional_input),
        "threshold_area": None,
    }
    if key == "threshold_flow_accumulation" and pixel_ha is not None:
        response["threshold_area"] = {
            "baseline_ha": baseline * pixel_ha, "case_ha": alternative * pixel_ha,
            "step_ha": step * pixel_ha,
            "export_change_per_threshold_ha": paired_change / (step * pixel_ha),
            "basis": "Original threshold in cells multiplied by the recorded affine pixel area.",
        }
    result["parameter_response"] = response
    result["parameter_response_status"] = "numeric_single_parameter"
    return result


def _number(value, *, signed=False):
    if not _finite(value):
        return "Unavailable"
    return format(value, "+,.7g" if signed else ",.7g")


def _esc(value):
    return html.escape(str(value if value is not None else ""), quote=True)


def _table(headers, rows):
    return ('<div class="parameter-response-scroll"><table><thead><tr>' +
            ''.join('<th scope="col">' + _esc(x) + '</th>' for x in headers) +
            '</tr></thead><tbody>' + ''.join('<tr>' + ''.join(
                '<td>' + _esc(x) + '</td>' for x in row) + '</tr>' for row in rows) +
            '</tbody></table></div>')


def render_row(row, parameters=None, *, detail=None):
    """Render escaped scientific interpretation for one exact retained row."""
    value = explain(row, parameters) if detail is None else detail
    units = str(row.get("units") or "original mass units")
    title = str(row.get("case") or "Comparison")
    subtitle = str(row.get("area") or "Reporting area") + " · " + str(
        row.get("pollutant") or "").replace("_export", "") + " · " + units
    out = ['<section class="parameter-response"><h3>' + _esc(title) + '</h3><p>' +
           _esc(subtitle) + '</p>']
    if value["direction_reversal"]:
        out.append('<p class="parameter-response-emphasis">Shared-cell and full-total changes have opposite signs. '
                   'Read the coverage contribution before comparing the two totals.</p>')
    out.append(_table(["Annual export change", units], [
        ["Change on shared cells", _number(value["paired_change"], signed=True)],
        ["Case-only mass less baseline-only mass", _number(value["coverage_contribution"], signed=True)],
        ["Full case total less full baseline total", _number(value["full_change"], signed=True)],
    ]))
    out.append('<p class="parameter-response-note">Full-total change = shared-cell change + '
               'case-only mass − baseline-only mass. Each exclusive mass is the recorded full total '
               'less that case’s mass on shared cells. Missing cells remain outside the paired calculation.</p>')
    if not value["paired_available"]:
        out.append('<p>No common valid cells are recorded. The paired change, exclusive-mass '
                   'decomposition and parameter response are unavailable.</p>')
    out.append(_table(["Support", "Baseline only", "Shared", "Case only"], [
        ["Valid cells", _number(value["baseline_only_cells"]), _number(row.get("paired_valid_cells")),
         _number(value["case_only_cells"])],
        ["Area (ha)", _number(value["baseline_only_area_ha"]), _number(value["paired_area_ha"]),
         _number(value["case_only_area_ha"])],
        ["Annual mass (" + units + ")", _number(value["baseline_only_mass"]),
         "Baseline " + _number(row.get("baseline_mass")) + "; case " + _number(row.get("case_mass")),
         _number(value["case_only_mass"])],
    ]))
    out.append('<p class="parameter-response-note">Mean over shared area: baseline ' +
               _esc(_number(value["paired_baseline_density"])) + ', case ' +
               _esc(_number(value["paired_case_density"])) + ', change ' +
               _esc(_number(value["paired_change_density"], signed=True)) + ' ' + _esc(units) +
               ' per ha. This denominator is the compared reporting area.</p>')
    response = value["parameter_response"]
    if response:
        out.append('<h4>' + _esc(response["label"]) + '</h4>')
        out.append(_table(["Finite input response", "Value"], [
            ["Parameter setting (" + str(response["units"]) + ")",
             _number(response["baseline"]) + " → " + _number(response["case"])],
            ["Input change relative to baseline", _number(response["percent_input_change"], signed=True) + "%"
             if response["percent_input_change"] is not None else "Unavailable"],
            ["Export change per parameter unit (" + units + " per " + str(response["units"]) + ")",
             _number(response["export_change_per_unit"], signed=True)],
            ["Baseline-normalized finite response (elasticity)", _number(response["elasticity"], signed=True)],
        ]))
        out.append('<p class="parameter-response-note">Response = shared-cell export change ÷ parameter change. '
                   'Elasticity = (export change ÷ baseline shared-cell export) ÷ '
                   '(parameter change ÷ baseline parameter). These describe the two selected settings; '
                   'they do not interpolate unrun settings. Zero denominators remain unavailable.</p>')
        threshold = response["threshold_area"]
        if threshold:
            out.append('<p>Stream-threshold area equivalent: ' + _esc(_number(threshold["baseline_ha"])) +
                       ' → ' + _esc(_number(threshold["case_ha"])) + ' ha; export response ' +
                       _esc(_number(threshold["export_change_per_threshold_ha"], signed=True)) + ' ' +
                       _esc(units) + ' per ha of threshold-equivalent area. ' +
                       _esc(threshold["basis"]) + ' The mapped stream network remains the actual '
                       'native routing result.</p>')
    elif value["parameter_response_status"] == "joint_parameters":
        out.append('<p>Several parameters changed together. The table retains their joint export '
                   'response; a single-parameter slope or elasticity is unavailable.</p>')
    elif value["parameter_response_status"] == "categorical_or_unrecorded":
        out.append('<p>This comparison changes a categorical setting or lacks recorded numeric '
                   'parameter endpoints. Read the native case selection with the mass and coverage changes.</p>')
    out.append('<details><summary>Original calculation details</summary><p>Reconciliation residual: ' +
               _esc(_number(value["reconciliation_residual"], signed=True)) + ' ' + _esc(units) +
               '.</p><p>Native run <code>' + _esc(row.get("run_id")) + '</code></p></details></section>')
    return ''.join(out)


def project_rows(rows, parameters=None):
    projected = []
    for row in rows:
        detail = explain(row, parameters)
        projected.append({**row, "response_interpretation": detail,
                          "response_interpretation_html": render_row(row, parameters, detail=detail)})
    return projected


def export_document(result, source, parameters=None):
    return {"schema": "upstate.parameter-response-interpretation/v1", "edition": EDITION,
            "experiment_id": result["experiment_id"], "workspace_id": result["workspace_id"],
            "original_results": dict(source),
            "rows": [explain(row, parameters) for row in result["rows"]]}


def csv_document(document):
    fields = ["case_id", "run_id", "area_id", "pollutant", "units", "paired_change", "full_change",
              "baseline_only_mass", "case_only_mass", "coverage_contribution", "reconciliation_residual",
              "direction_reversal", "baseline_only_cells", "case_only_cells", "baseline_only_area_ha",
              "paired_area_ha", "case_only_area_ha", "paired_baseline_density", "paired_case_density",
              "paired_change_density", "parameter_response_status", "parameter", "parameter_units",
              "baseline_parameter", "case_parameter", "parameter_step", "percent_input_change",
              "export_change_per_unit", "elasticity", "baseline_threshold_ha", "case_threshold_ha",
              "export_change_per_threshold_ha", "original_results_sha256"]
    output = io.StringIO(newline="")
    writer = csv.DictWriter(output, fieldnames=fields, extrasaction="ignore")
    writer.writeheader()
    for detail in document["rows"]:
        response = detail.get("parameter_response") or {}
        threshold = response.get("threshold_area") or {}
        writer.writerow({**detail, "parameter": response.get("parameter"),
                         "parameter_units": response.get("units"),
                         "baseline_parameter": response.get("baseline"), "case_parameter": response.get("case"),
                         "parameter_step": response.get("step"),
                         "percent_input_change": response.get("percent_input_change"),
                         "export_change_per_unit": response.get("export_change_per_unit"),
                         "elasticity": response.get("elasticity"),
                         "baseline_threshold_ha": threshold.get("baseline_ha"),
                         "case_threshold_ha": threshold.get("case_ha"),
                         "export_change_per_threshold_ha": threshold.get("export_change_per_threshold_ha"),
                         "original_results_sha256": document["original_results"].get("sha256")})
    return output.getvalue()


STYLE = """.parameter-response{margin:14px 0;padding:14px;border:1px solid #cbd0d3;min-width:0;overflow-wrap:anywhere}
.parameter-response h3{font-size:15px;margin:0 0 6px}.parameter-response h4{font-size:14px;margin:18px 0 8px}
.parameter-response p{font-size:12px;line-height:1.55;margin:8px 0}.parameter-response table{width:100%;border-collapse:collapse;font-size:12px}
.parameter-response th,.parameter-response td{padding:8px;text-align:left;vertical-align:top;border:1px solid #d5dadd;white-space:normal;overflow-wrap:normal}
.parameter-response th{background:#eef1f2}.parameter-response-scroll{overflow-x:auto;max-width:100%}
.parameter-response-note{color:#454e54}.parameter-response-emphasis{border-left:3px solid #5a6268;padding:8px 10px;background:#f0f2f3;font-weight:600}
.parameter-response code{overflow-wrap:anywhere}.parameter-response-section{margin-top:24px;min-width:0}
@media(max-width:600px){.parameter-response{padding:10px}.parameter-response th,.parameter-response td{padding:6px;font-size:11px}}
@media print{.parameter-response{break-inside:avoid}.parameter-response details>*{display:block!important}.parameter-response details summary{display:none!important}}
"""


def render_report(rows, parameters=None):
    comparisons = [row for row in rows if row.get("case_id") != "baseline"]
    if not comparisons:
        return ""
    return ('<section class="parameter-response-section"><h2>Input response and reporting coverage</h2>'
            '<p>Each comparison below uses its own recorded shared cells and original annual masses. '
            'Positive changes mean higher export. Baseline and alternative inputs remain in the saved design.</p>'
            '<p><a href="response-interpretation.csv">Download input-response table (CSV)</a> · '
            '<a href="response-interpretation.json">Open source-bound interpretation (JSON)</a></p>' +
            ''.join(render_row(row, parameters) for row in comparisons) + '</section>')
