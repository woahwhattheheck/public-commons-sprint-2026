"""Scientific figures from saved calibration and original flow-support records.

Every plotted quantity is copied from an original retained result or is an
explicit day-count percentage. Axis domains and plot positions are presentation
metadata. The existing scientific figure renderer owns PDF vector drawing.
"""
from __future__ import annotations

from collections import defaultdict
from copy import deepcopy
import csv
import html
import io
import math
from pathlib import Path

from .common import atomic_bytes, atomic_json, describe_file
from .scientific_figures import _validate_figure

VERSION = 1
SPEC = "calibration-figure-spec.json"
INDEX = "calibration-figure-coordinates.csv"
PAGE_SIZE = 16


def _number(value):
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    return float(value) if math.isfinite(value) else None


def _domain(values, *, zero=False):
    values = [float(value) for value in values if _number(value) is not None]
    if zero:
        values.append(0.0)
    if not values:
        raise ValueError("A scientific axis needs original finite coordinates")
    lo, hi = min(values), max(values)
    if lo == hi:
        pad = abs(lo) * .08 or 1.0
    else:
        pad = (hi - lo) * .06
    lower = 0.0 if zero and lo >= 0 else lo - pad
    return [lower, hi + pad]


def _axis(label, units, domain, ticks=None):
    lo, hi = domain
    if ticks is None:
        ticks = [{"value": lo + (hi - lo) * index / 4,
                  "label": format(lo + (hi - lo) * index / 4, ".4g")}
                 for index in range(5)]
    return {"label": label, "unit": units, "domain": domain, "ticks": ticks}


def _source(path, pointer):
    return {"path": path, "json_pointer": pointer}


def _point(x, y, *, source, **context):
    return {"x": x, "y": y, "source": source, **deepcopy(context)}


def _panel(title, x, y, series, **extra):
    return {"title": title, "x": x, "y": y, "series": series, **extra}


def _figure(key, title, caption, panels, records, omissions=None):
    return {"id": key, "title": title, "caption": caption, "panels": panels,
            "source_record_count": records, "omitted_records": omissions or []}


def _parts(rows):
    return [rows[index:index + PAGE_SIZE] for index in range(0, len(rows), PAGE_SIZE)]


def _ordinal_axes(rows, label):
    positions = [index for index, unused in rows]
    return _axis(label, "", [min(positions) - .6, max(positions) + .6],
                 [{"value": value, "label": str(value)} for value in positions])


def _prediction_figures(basis, result, observed):
    result_path = "original/calibrations/" + result["id"] + ".json"
    unit_by_id = {unit["id"]: unit for unit in basis["units"]}
    observation_by_id = {row["id"]: row for row in observed["rows"]}
    groups, omissions = defaultdict(list), []
    for index, row in enumerate(result["prediction_rows"]):
        if row["run_id"] != result.get("selected_run_id"):
            continue
        source = _source(result_path, "/prediction_rows/" + str(index))
        if row.get("included") is not True:
            omissions.append({"source": source, "unit_id": row["unit_id"],
                              "reason": "Original prediction excluded", "issues": row.get("issues", [])})
            continue
        values = {name: _number(row.get(name)) for name in
                  ("observed_annual_mass", "predicted_annual_mass", "residual")}
        if any(value is None for value in values.values()):
            omissions.append({"source": source, "unit_id": row["unit_id"],
                              "reason": "Original included prediction lacks finite coordinates"})
            continue
        unit = unit_by_id[row["unit_id"]]
        original_rows = [observation_by_id[key] for key in unit["observation_record_ids"]]
        context = {key: deepcopy(row.get(key)) for key in (
            "run_id", "profile_id", "unit_id", "catchment_id", "group_id", "parameter",
            "partition", "units", "included", "native_annual_mass",
            "delivered_external_annual_mass", "native_support")}
        context["observation_record_ids"] = list(unit["observation_record_ids"])
        context["reference_periods"] = [
            {"record_id": original["id"], "period_start": original["period_start"],
             "period_end": original["period_end"], "unit": original["unit"],
             "method": original.get("method"), "qualifier": original.get("qualifier")}
            for original in original_rows]
        context["reference_aggregation"] = {
            "periods": deepcopy(unit["periods"]),
            "aggregation_weight": unit["aggregation_weight"]}
        groups[(row["parameter"], row["units"])].append((source, values, context))
    fit, residual = [], []
    for (parameter, units), rows in sorted(groups.items()):
        mass = _domain([values[key] for unused, values, context in rows
                        for key in ("observed_annual_mass", "predicted_annual_mass")], zero=True)
        residual_range = _domain([values["residual"] for unused, values, context in rows], zero=True)
        x = _axis("Observed annual mass", units, mass)
        fit_series, residual_series = [], []
        partitions = sorted({context["partition"] for unused, values, context in rows})
        for part in partitions:
            marker = "square-open" if part == "validation" else "circle"
            selected = [(source, values, context) for source, values, context in rows
                        if context["partition"] == part]
            fit_series.append({"geometry": "scatter", "label": str(part), "marker": marker,
                "points": [_point(values["observed_annual_mass"], values["predicted_annual_mass"],
                                  source=source, **context) for source, values, context in selected]})
            residual_series.append({"geometry": "scatter", "label": str(part), "marker": marker,
                "points": [_point(values["observed_annual_mass"], values["residual"],
                                  source=source, **context) for source, values, context in selected]})
        # This is a labeled mathematical reference, not a fitted line or source sample.
        fit_series.append({"geometry": "line", "label": "1:1 reference", "marker": "cross",
                           "role": "mathematical_reference",
                           "points": [{"x": value, "y": value, "role": "mathematical_reference"}
                                      for value in mass]})
        fit.append(_panel(str(parameter).capitalize(), deepcopy(x),
                          _axis("Predicted annual mass", units, mass), fit_series))
        residual.append(_panel(str(parameter).capitalize(), deepcopy(x),
            _axis("Predicted minus observed", units, residual_range), residual_series,
            reference_lines=[{"axis": "y", "value": 0, "label": "Zero residual"}]))
    total = sum(len(rows) for rows in groups.values())
    figures = []
    if fit:
        figures.append(_figure("selected-native-fit", "Selected native candidate and original references",
            "Each point is one original catchment/constituent calibration unit, with its original temporal "
            "aggregation, physical unit and spatial partition. Prediction includes any originally declared "
            "delivered external annual load. The diagonal is the 1:1 reference. Validation records are shown "
            "separately and retain their original holdout meaning; the line is not a regression. "
            "Source IDs, periods, native support and excluded records are retained in the figure specification.",
            fit, total, omissions))
        figures.append(_figure("selected-native-residuals", "Selected candidate physical residuals",
            "Residuals are the saved predicted annual mass minus the original observed annual mass. "
            "Positive values indicate a higher prediction. Constituent units remain separate. "
            "A point is a retained calibration unit, not a newly averaged observation or independent station "
            "sample. Original spatial groups and record periods are retained with every coordinate.",
            residual, total, omissions))
    return figures, omissions


def _ranking_figure(result):
    original = list(enumerate(result["ranked_candidates"]))
    panels, omitted = [], []
    path = "original/calibrations/" + result["id"] + ".json"
    for page, rows in enumerate(_parts(original), 1):
        selected, others = [], []
        for index, row in rows:
            rank, score = _number(row.get("rank")), _number(row.get("objective_score"))
            if rank is None or score is None:
                omitted.append({"source": _source(path, "/ranked_candidates/" + str(index)),
                                "reason": "Original ranking has no finite rank and score"})
                continue
            point = _point(rank, score, source=_source(path, "/ranked_candidates/" + str(index)),
                           run_id=row["run_id"], profile_id=row["profile_id"],
                           selected_models=row.get("selected_models"), units="dimensionless",
                           original_rank=row["rank"], objective=result["objective"],
                           normalization=result["normalization"])
            (selected if row["run_id"] == result.get("selected_run_id") else others).append(point)
        points = others + selected
        if not points:
            continue
        ranks = sorted({point["x"] for point in points})
        series = []
        if others:
            series.append({"geometry": "scatter", "label": "Candidates", "marker": "circle",
                           "points": others})
        if selected:
            series.append({"geometry": "scatter", "label": "Selected", "marker": "square-open",
                           "points": selected})
        panels.append(_panel("Objective ranking / " + str(page),
            _axis("Original rank", "", [ranks[0] - .6, ranks[-1] + .6],
                  [{"value": value, "label": format(value, ".0f")} for value in ranks]),
            _axis("Original objective", "", _domain([point["y"] for point in points], zero=True)),
            series))
    if not panels:
        return None
    return _figure("original-objective-ranking", "Original native-candidate objective ranking",
        "The plot copies the saved dimensionless objective and original rank for every eligible native "
        "candidate. Lower objective values are favored by the original producer. Ranking, weights, "
        "normalization and tie handling are unchanged. Multiple executions of the same profile retain "
        "their distinct run identities and are not relabeled as distinct parameter samples. "
        "Candidate failures remain in the original result and report tables.",
        panels, len(original) - len(omitted), omitted)


def _flow_figures(plan):
    support = plan.get("flow_support")
    if not support:
        return [], []
    panels, qualifiers, omitted = [], [], []
    total = 0
    for page, page_rows in enumerate(_parts(list(enumerate(support["rows"], 1))), 1):
        numeric, outside = [], []
        by_qualifier = {key: [] for key in ("approved_days", "estimated_days", "provisional_days")}
        for number, row in page_rows:
            source = _source("flow-binding.json", "/rows/" + str(number - 1))
            expected = _number(row.get("expected_days"))
            context = {key: deepcopy(row.get(key)) for key in (
                "record_id", "observation_id", "original_preparation_id", "station_id",
                "flow_station_id", "flow_site_no", "flow_ts_id", "flow_binding_basis",
                "catchment_id", "parameter", "original_period_start", "original_period_end",
                "expected_days", "status", "fully_supported_reference_period")}
            if expected is None or expected <= 0:
                omitted.append({"source": source, "record_id": row["record_id"],
                                "reason": "Original reference has no positive day denominator"})
                continue
            def percentage(value, field):
                count = _number(value)
                if count is None:
                    omitted.append({"source": source, "record_id": row["record_id"],
                                    "field": field, "reason": "Original count unresolved"})
                    return None
                if count < 0 or count > expected or count != int(count):
                    raise ValueError("Original flow day count is outside its reference interval: " + field)
                return _point(number, 100.0 * count / expected, source=source,
                              count_field=field, original_day_count=value,
                              denominator=expected, transformation="100 * original_day_count / expected_days",
                              units="percent of requested reference days", **context)
            point = percentage(row.get("numeric_days"), "numeric_days")
            if point is not None:
                numeric.append(point)
                total += 1
            point = percentage(row.get("days_outside_captured_period"), "days_outside_captured_period")
            if point is not None:
                outside.append(point)
            for name in by_qualifier:
                point = percentage(row.get("daily_summary", {}).get(name), "daily_summary." + name)
                if point is not None:
                    by_qualifier[name].append(point)
        x = _ordinal_axes(page_rows, "Original reference row")
        axis = _axis("Reference-period days", "%", [-3, 103],
                     [{"value": value, "label": str(value)} for value in (0, 25, 50, 75, 100)])
        series = []
        if numeric:
            series.append({"geometry": "scatter", "label": "Numeric", "marker": "circle", "points": numeric})
        if outside:
            series.append({"geometry": "scatter", "label": "Outside source", "marker": "square-open", "points": outside})
        if series:
            panels.append(_panel("Flow coverage / " + str(page), deepcopy(x), deepcopy(axis), series))
        qseries = [{"geometry": "scatter", "label": name.removesuffix("_days").capitalize(),
                    "marker": ("circle", "triangle", "square-open")[index], "points": points}
                   for index, (name, points) in enumerate(by_qualifier.items()) if points]
        if qseries:
            qualifiers.append(_panel("Original qualifiers / " + str(page), deepcopy(x), deepcopy(axis), qseries))
    figures = []
    if panels:
        figures.append(_figure("original-flow-coverage", "Exact daily-flow coverage of original reference periods",
            "Each x position identifies the corresponding original row in flow-binding.json and the coordinate "
            "CSV. Percentages use that record's full requested [start,end) day count, including dates outside "
            "the captured source period. Unresolved station/series mappings remain explicit in the specification "
            "and tables; missing counts are not converted to zero. No values are imputed and the annual-load "
            "estimator and calibration weights remain unchanged.",
            panels, total, omitted))
    if qualifiers:
        figures.append(_figure("original-flow-qualifiers", "Original daily-flow qualifier support",
            "Approved, estimated and provisional source-day counts are shown separately as percentages of "
            "each original reference period. These categories can overlap and are not stacked or summed. "
            "Every point retains the exact station, native series, record, exclusive dates and original count. "
            "The original source values and qualifier definitions remain in the complete flow companions.",
            qualifiers, sum(len(series["points"]) for panel in qualifiers for series in panel["series"]), omitted))
    return figures, omitted


def _uncertainty_figure(result, uncertainty):
    if not uncertainty:
        return None
    path = "original/calibration-uncertainties/" + uncertainty["id"] + ".json"
    panels, omissions, count = [], [], 0
    for page, rows in enumerate(_parts(list(enumerate(uncertainty["pairwise"], 1))), 1):
        series, coordinates = [], []
        for number, row in rows:
            values = {key: _number(row.get(key)) for key in ("minimum_gap", "maximum_gap", "nominal_gap")}
            source = _source(path, "/pairwise/" + str(number - 1))
            context = {"run_id": row["run_id"], "profile_id": row["profile_id"],
                       "selected_run_id": result.get("selected_run_id"),
                       "state": row["state"], "missing_record_ids": row["missing_record_ids"],
                       "standard_errors": uncertainty["standard_errors"],
                       "gap_direction": uncertainty["selection_sensitivity"]["gap_direction"]}
            lo, hi, nominal = (values[key] for key in ("minimum_gap", "maximum_gap", "nominal_gap"))
            if lo is None or hi is None or nominal is None:
                omissions.append({"source": source, **context,
                                  "reason": "Original sensitivity bound or nominal gap unresolved"})
                continue
            if lo > hi:
                raise ValueError("Original objective-gap bounds are reversed")
            points = [_point(number, value, source=source, bound=bound, **context)
                      for bound, value in (("minimum_gap", lo), ("maximum_gap", hi))]
            series.append({"geometry": "line", "label": "", "marker": "cross",
                           "points": points, "role": "source_error_bounds"})
            coordinates.extend([lo, hi, nominal])
            series.append({"geometry": "scatter", "label": "", "marker": "circle",
                           "points": [_point(number, nominal, source=source, bound="nominal_gap", **context)]})
            count += 1
        if series:
            panels.append(_panel("Original objective gap / " + str(page),
                _ordinal_axes(rows, "Original challenger row"),
                _axis("Original objective gap", "", _domain(coordinates, zero=True)), series,
                reference_lines=[{"axis": "y", "value": 0, "label": "Zero gap"}]))
    if not panels:
        return None
    return _figure("original-source-error-gaps", "Original source-error bounds on candidate objective gaps",
        str(uncertainty["selection_sensitivity"]["gap_direction"]) + " Each vertical segment uses the saved "
        "minimum and maximum gap; the dot is the original nominal gap. Bounds reproduce the original "
        "published-standard-error analysis and are not a probability distribution or confidence interval. "
        "Missing source-error records remain explicit. The selected candidate, multiplier and original "
        "uncertainty coverage are retained without recomputing the original objective.",
        panels, count, omissions)


def build(plan, basis, result, observed, uncertainty=None):
    """Build complete vector specifications from their already retained records."""
    figures, prediction_omissions = _prediction_figures(basis, result, observed)
    ranking = _ranking_figure(result)
    if ranking:
        figures.append(ranking)
    flow, flow_omissions = _flow_figures(plan)
    figures.extend(flow)
    sensitivity = _uncertainty_figure(result, uncertainty)
    if sensitivity:
        figures.append(sensitivity)
    for figure in figures:
        _validate_figure(figure)
    return {"schema": "upstate.scientific-figure-spec/v1", "version": VERSION,
            "consumer_id": plan["id"], "calibration_id": result["id"],
            "uncertainty_id": uncertainty["id"] if uncertainty else None,
            "figures": figures, "coverage": {
                "selected_run_id": result.get("selected_run_id"),
                "original_prediction_rows": len(result["prediction_rows"]),
                "prediction_omissions": prediction_omissions,
                "original_ranked_candidates": len(result["ranked_candidates"]),
                "flow_reference_rows": len((plan.get("flow_support") or {}).get("rows", [])),
                "flow_omissions": flow_omissions},
            "methods": [
                "Physical coordinates are copied from the original saved producer; percentage coordinates explicitly divide original day counts by original requested days.",
                "Presentation-only axes and ordinal row positions do not change source quantities, ranking, source bounds or spatial/temporal support.",
                "Source JSON pointers, original reference IDs, periods and units are retained for every data coordinate. Mathematical reference marks are separately identified.",
            ]}


def _svg(figure):
    """Standalone monochrome SVG; source-only registration needs no plotting dependency."""
    esc = lambda value: html.escape(str(value), quote=True)
    width, panel_height = 960, 330
    height = 42 + panel_height * len(figure["panels"])
    pieces = ['<svg xmlns="http://www.w3.org/2000/svg" role="img" width="960" height="' + str(height)
              + '" viewBox="0 0 960 ' + str(height) + '"><title>' + esc(figure["title"])
              + '</title><desc>' + esc(figure["caption"]) + '</desc><rect width="100%" height="100%" fill="white"/>',
              '<style>text{font-family:Arial,Helvetica,sans-serif;fill:#222}line,path,rect,circle,polygon{vector-effect:non-scaling-stroke}</style>',
              '<text x="62" y="25" font-size="17" font-weight="bold">' + esc(figure["title"]) + '</text>']
    def text(x, y, value, size=12, anchor="start"):
        return '<text x="' + format(x, ".8g") + '" y="' + format(y, ".8g") + '" font-size="' + str(size) + '" text-anchor="' + anchor + '">' + esc(value) + '</text>'
    def line(x1, y1, x2, y2, color="#333", dash=""):
        return '<line x1="' + format(x1, ".8g") + '" y1="' + format(y1, ".8g") + '" x2="' + format(x2, ".8g") + '" y2="' + format(y2, ".8g") + '" stroke="' + color + '" stroke-width="1"' + (' stroke-dasharray="' + dash + '"' if dash else "") + '/>'
    def marker(x, y, shape, title=""):
        r = 3.5
        fill = "white" if shape.endswith("-open") else "#222"
        start = '<g><title>' + esc(title) + '</title>'
        if shape.startswith("square"):
            drawing = '<rect x="' + str(x-r) + '" y="' + str(y-r) + '" width="7" height="7" stroke="#222" fill="' + fill + '"/>'
        elif shape.startswith("triangle"):
            drawing = '<polygon points="' + " ".join(str(a)+","+str(b) for a,b in ((x,y-r-1),(x-r,y+r),(x+r,y+r))) + '" stroke="#222" fill="' + fill + '"/>'
        elif shape == "cross":
            drawing = line(x-r,y-r,x+r,y+r) + line(x-r,y+r,x+r,y-r)
        else:
            drawing = '<circle cx="' + str(x) + '" cy="' + str(y) + '" r="3.5" stroke="#222" fill="' + fill + '"/>'
        return start + drawing + '</g>'
    for index, panel in enumerate(figure["panels"]):
        top = 42 + index * panel_height
        left, right, upper, lower = 84, 922, top + 54, top + 258
        xlo, xhi = panel["x"]["domain"]
        ylo, yhi = panel["y"]["domain"]
        X = lambda value: left + (value-xlo)/(xhi-xlo)*(right-left)
        Y = lambda value: lower - (value-ylo)/(yhi-ylo)*(lower-upper)
        pieces.append(text(left,top+17,panel["title"],15))
        unit = panel["y"].get("unit")
        pieces.append(text(left,top+36,panel["y"]["label"] + (" ("+unit+")" if unit else ""),12))
        for tick in panel["y"].get("ticks", []):
            py = Y(tick["value"])
            pieces.extend([line(left,py,right,py,"#ddd"),text(left-9,py+4,tick["label"],11,"end")])
        for tick in panel["x"].get("ticks", []):
            px = X(tick["value"])
            pieces.extend([line(px,lower,px,lower+5),text(px,lower+20,tick["label"],11,"middle")])
        pieces.extend([line(left,upper,left,lower),line(left,lower,right,lower)])
        for ref in panel.get("reference_lines", []):
            if ref.get("axis", "y") == "y" and ylo <= ref["value"] <= yhi:
                pieces.append(line(left,Y(ref["value"]),right,Y(ref["value"]),"#777","5 4"))
            elif ref.get("axis") == "x" and xlo <= ref["value"] <= xhi:
                pieces.append(line(X(ref["value"]),upper,X(ref["value"]),lower,"#777","5 4"))
        for si, series in enumerate(panel["series"]):
            points = series["points"]
            if series["geometry"] == "line":
                for first, second in zip(points, points[1:]):
                    if first.get("y") is not None and second.get("y") is not None:
                        pieces.append(line(X(first["x"]),Y(first["y"]),X(second["x"]),Y(second["y"]),
                                           dash="5 4" if series.get("role") == "mathematical_reference" else ""))
            for point in points:
                if point.get("y") is None:
                    continue
                details = [str(point.get(key, "")) for key in ("record_id", "catchment_id", "parameter", "partition")]
                details.extend(["x="+str(point["x"]), "y="+str(point["y"]),
                                str(point.get("units", "")), str(point.get("source", ""))])
                pieces.append(marker(X(point["x"]),Y(point["y"]),series.get("marker","circle")," | ".join(details)))
        xlabel = panel["x"]["label"]
        if panel["x"].get("unit"):
            xlabel += " (" + panel["x"]["unit"] + ")"
        pieces.append(text((left+right)/2,lower+43,xlabel,12,"middle"))
        cursor = left
        for series in panel["series"]:
            label = series.get("label")
            if not label:
                continue
            pieces.append(marker(cursor+4,top+315,series.get("marker","circle")))
            pieces.append(text(cursor+16,top+319,label,11))
            cursor += 30 + len(label)*7
    pieces.append("</svg>\n")
    return "".join(pieces)


def write(directory, plan, basis, result, observed, uncertainty=None):
    """Retain full specification, native numeric coordinate CSV and independent SVGs."""
    directory = Path(directory)
    spec = build(plan, basis, result, observed, uncertainty)
    atomic_json(directory / SPEC, spec, immutable=True)
    choices, rows = [], []
    for figure in spec["figures"]:
        relative = "figures/" + figure["id"] + ".svg"
        atomic_bytes(directory / relative, _svg(figure).encode("utf-8"), immutable=True)
        choices.append({"id": figure["id"], "path": relative})
        for pi, panel in enumerate(figure["panels"]):
            for si, series in enumerate(panel["series"]):
                for point in series["points"]:
                    rows.append({
                        "figure_id": figure["id"], "panel": pi + 1, "series": series.get("label", ""),
                        "role": point.get("role", series.get("role", "original_data")),
                        "x": point["x"], "y": point.get("y"),
                        "x_unit": panel["x"].get("unit", ""), "y_unit": panel["y"].get("unit", ""),
                        "source_path": point.get("source", {}).get("path"),
                        "json_pointer": point.get("source", {}).get("json_pointer"),
                        "run_id": point.get("run_id"), "profile_id": point.get("profile_id"),
                        "unit_id": point.get("unit_id"), "record_id": point.get("record_id"),
                        "catchment_id": point.get("catchment_id"), "parameter": point.get("parameter"),
                        "partition": point.get("partition"), "station_id": point.get("station_id"),
                        "flow_station_id": point.get("flow_station_id"), "flow_ts_id": point.get("flow_ts_id"),
                        "period_start": point.get("original_period_start"), "period_end": point.get("original_period_end"),
                        "count_field": point.get("count_field"), "original_day_count": point.get("original_day_count"),
                        "denominator": point.get("denominator"), "bound": point.get("bound"),
                    })
    columns = ["figure_id", "panel", "series", "role", "x", "y", "x_unit", "y_unit",
               "source_path", "json_pointer", "run_id", "profile_id", "unit_id", "record_id",
               "catchment_id", "parameter", "partition", "station_id", "flow_station_id", "flow_ts_id",
               "period_start", "period_end", "count_field", "original_day_count", "denominator", "bound"]
    output = io.StringIO(newline="")
    writer = csv.DictWriter(output, columns, lineterminator="\n")
    writer.writeheader()
    for row in rows:
        writer.writerow({key: ("'" + value if isinstance(value, str)
                      and value.lstrip().startswith(("=", "+", "-", "@")) else value)
                         for key, value in row.items()})
    atomic_bytes(directory / INDEX, output.getvalue().encode("utf-8"), immutable=True)
    # Validate that every native-coordinate pointer names a packaged original companion.
    paths = {row["source_path"] for row in rows if row["source_path"]}
    for relative in sorted(paths):
        if not (directory / relative).is_file():
            raise ValueError("Figure coordinate source was not packaged: " + relative)
    return {"figure_spec": SPEC, "figures": choices,
            "coordinate_index": INDEX, "coverage": spec["coverage"],
            "files": [describe_file(directory, directory / SPEC),
                      describe_file(directory, directory / INDEX)] +
                     [describe_file(directory, directory / choice["path"]) for choice in choices]}
