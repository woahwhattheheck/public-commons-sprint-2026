"""Publication figures from saved Implementation outcome quantities.

Every coordinate is derived from an existing comparison interval. The figure
specification carries the unmodified intervals and source support, and drives
both retained SVG and the existing native scientific-report vector renderer.
"""
from __future__ import annotations

import html
import math

EDITION = "implementation-outcome-figures-20261013-v1"
SCHEMA = "upstate.scientific-figure-spec/v1"


def _number(value):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise ValueError("Outcome figure endpoints must be finite numbers.")
    return float(value)


def _label(value):
    return html.escape(str(value), quote=True)


def _format(value):
    return format(value, ".5g")


def _domain(rows, include_zero):
    values = [_number(row["interval"][side]) for row in rows if row["interval"] is not None
              for side in ("lower", "upper") if row["interval"][side] is not None]
    if include_zero:
        values.append(0.0)
    if not values:
        return [-1.0, 1.0]
    lo, hi = min(values), max(values)
    span = hi - lo
    if not math.isfinite(span):
        raise ValueError("Outcome figure endpoints exceed the supported finite plotting span.")
    pad = (span if span else max(abs(lo), 1.0)) * .12
    lower, upper = lo - pad, hi + pad
    if not all(math.isfinite(value) for value in (lower, upper, upper - lower)):
        raise ValueError("Outcome figure axis exceeds the supported finite plotting span.")
    return [lower, upper]


def _panel(title, unit, rows, interval_text, *, include_zero=False):
    domain = _domain(rows, include_zero)
    lower, upper = domain
    span = upper - lower
    series, annotations, source_rows = [], [], []
    count = len(rows)
    for index, row in enumerate(rows):
        position = count - index
        interval = row["interval"]
        source_rows.append({**row, "position": position, "display": interval_text(interval)})
        if interval is None:
            annotations.append({"x": lower + span * .5, "y": position,
                                "text": "Unavailable for the selected support"})
            continue
        lo, hi = interval["lower"], interval["upper"]
        left = lower if lo is None else _number(lo)
        right = upper if hi is None else _number(hi)
        if left > right:
            raise ValueError("Outcome figure interval endpoints are reversed.")
        if left != right:
            series.append({"geometry": "line", "markers": False, "label": "",
                           "points": [{"x": left, "y": position}, {"x": right, "y": position}]})
        endpoints = []
        if lo is not None:
            endpoints.append({"x": _number(lo), "y": position, "filled": not interval["lower_open"]})
        if hi is not None and (lo is None or hi != lo):
            endpoints.append({"x": _number(hi), "y": position, "filled": not interval["upper_open"]})
        if endpoints:
            series.append({"geometry": "scatter", "marker": "circle", "label": "", "points": endpoints})
        if lo is None:
            annotations.append({"x": lower, "y": position, "text": "Unbounded below"})
        if hi is None:
            annotations.append({"x": upper, "y": position, "text": "Unbounded above"})
    ticks = [{"value": lower + span * index / 4, "label": _format(lower + span * index / 4)}
             for index in range(5)]
    return {
        "title": title,
        "x": {"domain": domain, "label": "Original measurement", "unit": unit, "ticks": ticks},
        "y": {"domain": [.35, count + .65], "label": "", "unit": "",
              "ticks": [{"value": count - index, "label": row["label"]} for index, row in enumerate(rows)]},
        "series": series, "annotations": annotations,
        "reference_lines": ([{"axis": "x", "value": 0, "label": ""}]
                            if include_zero and lower <= 0 <= upper else []),
        "outcome_rows": source_rows,
        "display_note": "Hollow endpoints are open bounds; filled endpoints are included. "
                        "A line reaching an axis edge with an unbounded label continues beyond the display.",
    }


def _support(stats):
    return {"sampled_dates": stats["days"], "complete_dates": stats["supported_days"],
            "original_results": stats["records"], "unresolved_results": stats["unresolved_records"]}


def _phase_rows(comparison):
    return [{"label": period.title(), "interval": comparison[period]["interval"],
             "support": _support(comparison[period])} for period in ("before", "after")]


def _change_row(label, comparison, balanced=False):
    value = comparison["month_balanced"]["change"] if balanced else comparison["change"]
    support = ({"common_calendar_months": comparison["month_balanced"]["months"],
                "omitted_calendar_months": comparison["month_balanced"]["omitted_months"]}
               if balanced else {"before": _support(comparison["before"]),
                                 "after": _support(comparison["after"])})
    return {"label": label, "interval": value, "support": support}


def build_figures(result, interval_text):
    """Return one original specification and SVG per selected site and measurement group."""
    figures = []
    for index, effect in enumerate(result["effects"]):
        group_id = effect["group_id"]
        site = effect["site_label"] or effect["site_id"]
        title = site + " - " + effect["parameter"] + " - " + effect["unit"]
        method = " / ".join(str(effect[key]) for key in ("method", "basis", "fraction") if effect.get(key))
        if method:
            title += " - " + method
        direct = effect["direct"]
        panels = [_panel("Original site means", effect["unit"], _phase_rows(direct), interval_text)]
        controls = effect.get("controls")
        if controls is not None:
            panels.append(_panel("Same-date site minus references", effect["unit"],
                                 _phase_rows(controls["paired"]), interval_text))
        changes = [_change_row("Site change", direct)]
        if controls is not None:
            changes.append(_change_row("Paired change", controls["paired"]))
        changes.append(_change_row("Month change", direct, True))
        if controls is not None:
            changes.append(_change_row("Month paired", controls["paired"], True))
        panels.append(_panel("After minus before", effect["unit"],
                             changes, interval_text, include_zero=True))
        selection = result["selection"]
        caption = (
            "Before " + selection["before"]["start"] + " through " + selection["before"]["end"] +
            "; after " + selection["after"]["start"] + " through " + selection["after"]["end"] +
            " (" + selection["time_zone"] + "). Full-support intervals use the saved original "
            "sampled-date means and comparison results. Reporting-limit bounds retain their open or "
            "closed endpoints; these are not confidence intervals. Hollow endpoints are open; filled "
            "endpoints are included. Missing full support stays unavailable. Month change and Month paired "
            "show the direct and paired common-month balanced changes, using only months present in both "
            "periods. No line joins different sites or time periods. Complete values and support remain "
            "in the adjacent tables and original CSVs."
        )
        if controls is not None:
            caption += " Fixed selected reference sites: " + ", ".join(controls["site_ids"]) + "."
        identifier = "implementation-outcome-" + group_id + "-" + str(index + 1)
        figure = {
            "id": identifier,
            "path": "outcome-" + group_id + "-" + str(index + 1) + ".svg",
            "title": title, "caption": caption, "panels": panels,
            "original_support": effect["support"],
            "source_identity": {"plan_binding": result["plan_binding"],
                                "selection_digest": result["selection_digest"],
                                "method": result["method"], "group_id": group_id,
                                "site_id": effect["site_id"],
                                "reference_site_ids": controls["site_ids"] if controls is not None else []},
        }
        figures.append(figure)
    spec = {"schema": SCHEMA, "edition": EDITION, "figures": figures}
    return spec, {figure["path"]: render_svg(figure) for figure in figures}


def _wrapped(text, width=96):
    words = str(text).split()
    lines, current = [], ""
    for word in words:
        if current and len(current) + len(word) + 1 > width:
            lines.append(current)
            current = word
        else:
            current = (current + " " + word).strip()
    if current:
        lines.append(current)
    return lines or [""]


def render_svg(figure):
    """Render the retained numeric figure specification without external assets."""
    width, left, right = 1000, 205, 975
    title_lines = _wrapped(figure["title"], 95)
    caption_lines = _wrapped(figure["caption"], 126)
    top = 24 + len(title_lines) * 21 + len(caption_lines) * 16 + 16
    panel_layouts = []
    for panel in figure["panels"]:
        title_rows = _wrapped(panel["title"], 105)
        row_count = len(panel["outcome_rows"])
        height = 46 + len(title_rows) * 19 + max(150, row_count * 55) + 43
        panel_layouts.append((panel, top, height, title_rows))
        top += height + 16
    full_height = top + 24
    identifier = figure["id"]
    parts = [
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 %d %d" role="img" aria-labelledby="%s-title %s-desc">'
        % (width, full_height, identifier, identifier),
        '<title id="%s-title">%s</title>' % (identifier, _label(figure["title"])),
        '<desc id="%s-desc">%s</desc>' % (identifier, _label(figure["caption"])),
        '<rect width="100%" height="100%" fill="#fff"/>',
        '<g font-family="Arial,Helvetica,sans-serif" fill="#202020">',
    ]
    y = 30
    for line in title_lines:
        parts.append('<text x="24" y="%d" font-size="18" font-weight="700">%s</text>' % (y, _label(line)))
        y += 21
    y += 5
    for line in caption_lines:
        parts.append('<text x="24" y="%d" font-size="12">%s</text>' % (y, _label(line)))
        y += 16
    for panel, origin, height, heading in panel_layouts:
        y = origin + 20
        for line in heading:
            parts.append('<text x="24" y="%d" font-size="15" font-weight="700">%s</text>' % (y, _label(line)))
            y += 19
        plot_top, plot_bottom = y + 12, origin + height - 55
        x0, x1 = panel["x"]["domain"]
        y0, y1 = panel["y"]["domain"]
        X = lambda value: left + (value - x0) / (x1 - x0) * (right - left)
        Y = lambda value: plot_bottom - (value - y0) / (y1 - y0) * (plot_bottom - plot_top)
        for tick in panel["x"]["ticks"]:
            x = X(tick["value"])
            parts.append('<line x1="%.3f" y1="%.3f" x2="%.3f" y2="%.3f" stroke="#e2e2e2"/>' %
                         (x, plot_top, x, plot_bottom))
            parts.append('<text x="%.3f" y="%.3f" font-size="11" text-anchor="middle">%s</text>' %
                         (x, plot_bottom + 18, _label(tick["label"])))
        for line in panel["reference_lines"]:
            x = X(line["value"])
            parts.append('<line x1="%.3f" y1="%.3f" x2="%.3f" y2="%.3f" stroke="#707070" stroke-dasharray="4 3"/>' %
                         (x, plot_top, x, plot_bottom))
        for row in panel["outcome_rows"]:
            py = Y(row["position"])
            parts.append('<text x="24" y="%.3f" font-size="12">%s</text>' % (py - 3, _label(row["label"])))
            parts.append('<text x="24" y="%.3f" font-size="11">%s</text>' % (py + 13, _label(row["display"])))
        for index, series in enumerate(panel["series"]):
            points = series["points"]
            if series["geometry"] == "line":
                coords = " ".join("%.3f,%.3f" % (X(point["x"]), Y(point["y"])) for point in points)
                parts.append('<polyline points="%s" fill="none" stroke="#202020" stroke-width="1.6"%s/>' %
                             (coords, '' if index == 0 else ' stroke-dasharray="4 2"'))
            else:
                for point in points:
                    parts.append('<circle cx="%.3f" cy="%.3f" r="4" stroke="#202020" stroke-width="1.5" fill="%s"/>' %
                                 (X(point["x"]), Y(point["y"]), "#202020" if point["filled"] else "#fff"))
        for annotation in panel["annotations"]:
            px, py = X(annotation["x"]), Y(annotation["y"])
            anchor = "start" if annotation["x"] == x0 else "end" if annotation["x"] == x1 else "middle"
            parts.append('<text x="%.3f" y="%.3f" text-anchor="%s" font-size="11">%s</text>' %
                         (px, py - 12, anchor, _label(annotation["text"])))
        parts.append('<line x1="%d" y1="%.3f" x2="%d" y2="%.3f" stroke="#202020"/>' %
                     (left, plot_bottom, right, plot_bottom))
        parts.append('<text x="%d" y="%.3f" text-anchor="middle" font-size="12">%s</text>' %
                     ((left + right) // 2, plot_bottom + 38, _label(panel["x"]["unit"])))
    parts.append("</g></svg>\n")
    return "\n".join(parts)
