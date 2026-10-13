"""Scientific figures from retained Climate Management result quantities.

No rasters, source discovery, statistical recomputation, or native model calls.
The same explicit numeric panels drive the retained SVG and original scientific
report PDF renderer. Period positions are categorical, never a time axis.
"""
from __future__ import annotations

from copy import deepcopy
import html
import math
import textwrap

EDITION = "climate-management-figures-20261013-v1"
SCHEMA = "upstate.scientific-figure-spec/v1"
PAGE_PERIODS = 6
METRICS = {"nitrogen_export": "Nitrogen", "phosphorus_export": "Phosphorus",
           "sediment_export": "Sediment"}
ROLE_MARKERS = ("circle", "square", "triangle")


def _number(value):
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise ValueError("A retained management figure quantity must be finite or unavailable")
    return value


def _text(value):
    return html.escape(str(value), quote=True)


def _format(value):
    return "Unavailable" if value is None else format(value, ".5g")


def _domain(values):
    values = [0.0, *[_number(value) for value in values if value is not None]]
    lo, hi = min(values), max(values)
    span = hi - lo
    if not math.isfinite(span):
        raise ValueError("The original management quantities exceed the finite figure span")
    padding = (span or max(abs(lo), 1.0)) * .12
    domain = [lo - padding, hi + padding]
    if not all(math.isfinite(x) for x in (*domain, domain[1] - domain[0])) or domain[1] <= domain[0]:
        raise ValueError("The original management figure has no finite positive axis span")
    return domain


def _panel(title, unit, period_rows, definitions, *, domain_rows):
    values = [_number(row[field]) for row in domain_rows for _, field in definitions]
    lo, hi = _domain(values)
    ticks = [{"value": lo + (hi - lo) * index / 4,
              "label": _format(lo + (hi - lo) * index / 4)} for index in range(5)]
    count = len(definitions)
    series = []
    for index, (label, field) in enumerate(definitions):
        # Small categorical offsets distinguish roles without connecting periods.
        offset = (index - (count - 1) / 2) * .2
        series.append({"label": label, "geometry": "scatter",
            "marker": ROLE_MARKERS[index], "field": field,
            "points": [{"x": position + 1 + offset, "y": _number(row[field]),
                        "period_id": row["period_id"], "category": position + 1}
                       for position, row in enumerate(period_rows)]})
    return {"title": title,
            "x": {"domain": [.5, len(period_rows) + .5],
                  "label": "Selected period (categorical order)", "unit": "",
                  "ticks": [{"value": index + 1, "label": "P" + str(index + 1)}
                            for index in range(len(period_rows))]},
            "y": {"domain": [lo, hi], "label": "", "unit": unit, "ticks": ticks},
            "series": series, "reference_lines": [{"axis": "y", "value": 0, "label": ""}],
            "annotations": [], "missing_values": [
                {"period_id": row["period_id"], "series": label}
                for row in period_rows for label, field in definitions if row[field] is None]}


def build_figures(result):
    """Return exact-source figure data and self-contained SVGs for every area/metric."""
    periods = result["selection"]["periods"]
    period_ids = [period["id"] for period in periods]
    if not periods or len(set(period_ids)) != len(period_ids):
        raise ValueError("Management figures require the original unique period order")
    reference_id = result["selection"]["reference_period_id"]
    if reference_id not in period_ids:
        raise ValueError("The original management reference period is missing")
    controlled = "control" in result["roles"]
    roles = ["reference", "treatment"] + (["control"] if controlled else [])
    if set(result["roles"]) != set(roles):
        raise ValueError("Management figures require the original scenario roles")
    groups, support = {}, {}
    for row in result["rows"]:
        key = (row["area_id"], row["pollutant"])
        group = groups.setdefault(key, {})
        if row["period_id"] in group:
            raise ValueError("A management figure repeats a retained area/metric/period")
        group[row["period_id"]] = row
    for row in result["support"]:
        key = (row["area_id"], row["pollutant"])
        if key in support:
            raise ValueError("A management figure repeats an original support record")
        support[key] = row
    if set(groups) != set(support):
        raise ValueError("Management figure quantities differ from the original support inventory")
    figures = []
    for group_index, ((area_id, metric), by_period) in enumerate(groups.items(), 1):
        if set(by_period) != set(period_ids):
            raise ValueError("A management figure lost an original selected period")
        ordered = [by_period[pid] for pid in period_ids]
        units = {row["units"] for row in ordered}
        if len(units) != 1:
            raise ValueError("A management figure mixed annual mass units")
        unit = next(iter(units))
        if not isinstance(unit, str) or not unit.strip():
            raise ValueError("A management figure needs its original annual mass unit")
        original_support = support[(area_id, metric)]
        for row in ordered:
            if (row["reference_period_id"] != reference_id
                    or row["common_cells"] != original_support["common_cells"]
                    or row["common_hectares"] != original_support["common_hectares"]):
                raise ValueError("Management figure rows do not share their original cohort support")
        independent = [row for row in result["independent_totals"]
                       if row["area_id"] == area_id and row["pollutant"] == metric]
        lookup = {}
        for row in independent:
            key = (row["period_id"], row["role"])
            if key in lookup:
                raise ValueError("A management figure repeats an original role total")
            lookup[key] = row
        if set(lookup) != {(pid, role) for pid in period_ids for role in roles}:
            raise ValueError("A management figure lost a selected original role total")
        for row in ordered:
            for role in roles:
                original = lookup[(row["period_id"], role)]
                if (original["common_total"] != row[role + "_total"]
                        or original["units"] != unit
                        or original["common_cells"] != row["common_cells"]):
                    raise ValueError("Figure totals differ from the retained native role quantities")
        pages = (len(periods) + PAGE_PERIODS - 1) // PAGE_PERIODS
        for start in range(0, len(periods), PAGE_PERIODS):
            selected = periods[start:start + PAGE_PERIODS]
            selected_ids = [period["id"] for period in selected]
            selected_rows = [by_period[pid] for pid in selected_ids]
            page = start // PAGE_PERIODS + 1
            figure_id = "climate-management-" + str(group_index) + "-" + str(page)
            title = (str(ordered[0]["area"]) + " — " + METRICS.get(metric, metric)
                     + (" — page " + str(page) + " of " + str(pages) if pages > 1 else ""))
            definitions = [("Reference", "reference_total"), ("Treatment", "treatment_total")]
            benefits = [("Reference − treatment", "benefit")]
            interactions = [("Benefit change", "interaction")]
            if controlled:
                definitions.append(("Control", "control_total"))
                benefits.append(("Control − treatment", "control_adjusted_benefit"))
                interactions.append(("Control-adjusted change", "control_adjusted_interaction"))
            reference_label = next(period["label"] for period in periods if period["id"] == reference_id)
            caption = (
                "Annual modeled export reaching streams; " + unit + ". One common finite support across all "
                + str(len(periods)) + " periods and " + str(len(roles)) + " scenario roles: "
                + str(original_support["common_cells"]) + " cells, "
                + _format(original_support["common_hectares"]) + " hectares. "
                "Positive benefit means lower treatment export; interaction is the selected period benefit "
                "minus the benefit in the explicit reference period “" + str(reference_label) + "” (ID: " + reference_id + "). "
                "P1–P" + str(len(selected)) + " follow the original-label key in the SVG and adjacent report table. "
                "Every page uses the same panel axis limits for this area and metric. "
                "Markers are categorical; no trend, interpolation, confidence interval, or causal field effect is inferred. "
                "Unavailable support stays unavailable; zero is shown as zero. Independent totals are retained separately."
            )
            spec = {"schema": SCHEMA, "edition": EDITION, "id": figure_id,
                "path": "figures/" + figure_id + ".svg", "title": title, "caption": caption,
                "area_id": area_id, "pollutant": metric, "units": unit,
                "period_ids": selected_ids, "periods": deepcopy(selected),
                "reference_period_id": reference_id, "page": page, "pages": pages,
                "panels": [
                    _panel("Native role totals on common support", unit, selected_rows, definitions, domain_rows=ordered),
                    _panel("Signed management benefit", unit, selected_rows, benefits, domain_rows=ordered),
                    _panel("Change in benefit from reference period", unit, selected_rows, interactions, domain_rows=ordered)],
                "source_identity": {"report_id": result["id"], "workspace_id": result["workspace_id"],
                    "support_mode": result["support_mode"], "reference_period_id": reference_id,
                    "cohort": deepcopy([row for row in result["cohort"] if row["period_id"] in selected_ids])},
                "original_rows": deepcopy(selected_rows),
                "original_support": deepcopy(original_support),
                "original_independent_totals": deepcopy([
                    row for row in independent if row["period_id"] in selected_ids])}
            figures.append(spec)
    data = {"schema": SCHEMA, "edition": EDITION, "report_id": result["id"],
            "workspace_id": result["workspace_id"], "period_ids": period_ids,
            "reference_period_id": reference_id, "figures": figures}
    return data, {figure["path"]: render_svg(figure) for figure in figures}


def _marker(parts, marker, x, y):
    attrs = 'stroke="#202020" stroke-width="1.6" fill="#202020"'
    if marker == "square":
        parts.append('<rect x="%.3f" y="%.3f" width="8" height="8" %s/>' % (x - 4, y - 4, attrs))
    elif marker == "triangle":
        parts.append('<polygon points="%.3f,%.3f %.3f,%.3f %.3f,%.3f" %s/>' %
                     (x, y - 5, x - 4.5, y + 3.5, x + 4.5, y + 3.5, attrs))
    else:
        parts.append('<circle cx="%.3f" cy="%.3f" r="4" %s/>' % (x, y, attrs))


def render_svg(figure):
    """Draw the same categorical specification consumed by scientific_report."""
    title = textwrap.wrap(figure["title"], 88, break_long_words=True) or [""]
    caption = textwrap.wrap(figure["caption"], 118, break_long_words=True) or [""]
    period_key = []
    for index, period in enumerate(figure["periods"]):
        label = "P" + str(index + 1) + " = " + str(period["label"]) + " (ID: " + str(period["id"]) + ")"
        if period["id"] == figure["reference_period_id"]:
            label += " [reference period]"
        period_key.extend(textwrap.wrap(label, 112, break_long_words=True) or [""])
    panel_top = 32 + len(title) * 23 + len(caption) * 17 + 24 + len(period_key) * 17 + 18
    panel_height, width = 300, 1000
    full_height = panel_top + panel_height * len(figure["panels"]) + 24
    fid = figure["id"]
    parts = ['<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 %d %d" role="img" aria-labelledby="%s-title %s-desc">' %
             (width, full_height, fid, fid),
             '<title id="%s-title">%s</title>' % (fid, _text(figure["title"])),
             '<desc id="%s-desc">%s</desc>' % (fid, _text(figure["caption"])),
             '<rect width="100%" height="100%" fill="#fff"/>',
             '<g font-family="Arial,Helvetica,sans-serif" fill="#202020">']
    y = 30
    for line in title:
        parts.append('<text x="24" y="%d" font-size="19" font-weight="700">%s</text>' % (y, _text(line)))
        y += 23
    y += 4
    for line in caption:
        parts.append('<text x="24" y="%d" font-size="13">%s</text>' % (y, _text(line)))
        y += 17
    y += 12
    parts.append('<text x="24" y="%d" font-size="13" font-weight="700">Original period labels</text>' % y)
    y += 19
    for line in period_key:
        parts.append('<text x="24" y="%d" font-size="13">%s</text>' % (y, _text(line)))
        y += 17
    for index, panel in enumerate(figure["panels"]):
        top = panel_top + index * panel_height
        left, right, plot_top, bottom = 112, 968, top + 40, top + 214
        x0, x1 = panel["x"]["domain"]
        y0, y1 = panel["y"]["domain"]
        X = lambda value: left + (value - x0) / (x1 - x0) * (right - left)
        Y = lambda value: bottom - (value - y0) / (y1 - y0) * (bottom - plot_top)
        parts.append('<text x="24" y="%.3f" font-size="16" font-weight="700">%s</text>' %
                     (top + 20, _text(panel["title"])))
        parts.append('<text x="968" y="%.3f" font-size="13" text-anchor="end">%s</text>' %
                     (top + 20, _text(panel["y"]["unit"])))
        for tick in panel["y"]["ticks"]:
            py = Y(tick["value"])
            parts.append('<line x1="%d" y1="%.3f" x2="%d" y2="%.3f" stroke="#dedede"/>' %
                         (left, py, right, py))
            parts.append('<text x="%d" y="%.3f" text-anchor="end" font-size="12">%s</text>' %
                         (left - 10, py + 4, _text(tick["label"])))
        zero = Y(0)
        parts.append('<line x1="%d" y1="%.3f" x2="%d" y2="%.3f" stroke="#707070" stroke-dasharray="4 3"/>' %
                     (left, zero, right, zero))
        for tick in panel["x"]["ticks"]:
            px = X(tick["value"])
            parts.append('<text x="%.3f" y="%.3f" text-anchor="middle" font-size="13">%s</text>' %
                         (px, bottom + 21, _text(tick["label"])))
        parts.append('<line x1="%d" y1="%.3f" x2="%d" y2="%.3f" stroke="#202020"/>' %
                     (left, bottom, right, bottom))
        parts.append('<text x="540" y="%.3f" text-anchor="middle" font-size="12">%s</text>' %
                     (bottom + 43, _text(panel["x"]["label"])))
        legend_x = 120
        for series in panel["series"]:
            for point in series["points"]:
                if point["y"] is not None:
                    _marker(parts, series["marker"], X(point["x"]), Y(point["y"]))
            _marker(parts, series["marker"], legend_x, top + 281)
            parts.append('<text x="%.3f" y="%.3f" font-size="12">%s</text>' %
                         (legend_x + 11, top + 285, _text(series["label"])))
            legend_x += 270
        if panel["missing_values"]:
            parts.append('<text x="968" y="%.3f" font-size="11" text-anchor="end">%s</text>' %
                         (plot_top + 13, _text("Unavailable: " + str(len(panel["missing_values"])) +
                                              " values; see the original-label table.")))
    parts.append("</g></svg>\n")
    return "\n".join(parts)
