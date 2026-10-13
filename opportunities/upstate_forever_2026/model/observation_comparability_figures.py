"""Native paired-period figures from complete retained cohort intervals.

The original calculator owns the means, differences, censoring and support.
This module adds native vectors, exact figure data and a complete offline reader
to a NEW native saved source before its ordinary immutable publication.
"""
from __future__ import annotations

from copy import deepcopy
import csv
from fractions import Fraction
from html import escape
import io
import math
from pathlib import Path
import re

from measurement_workspace import observation_comparability as comparison
from .common import atomic_bytes, atomic_json, describe_file, digest, file_digest, read_json

EDITION = "retained-cohort-interval-figures/1"
SPEC = "figures/paired-period-figures.json"
DATA = "figures/paired-period-data.json"
CSV = "figures/paired-period-data.csv"
READER = "figures/index.html"


def implementation():
    from reportlab import Version
    from . import scientific_figures
    return {"edition": EDITION, "reportlab_version": Version,
            "figure_source_sha256": file_digest(__file__),
            "scientific_figures_sha256": file_digest(scientific_figures.__file__)}


def _require(value, message):
    if not value:
        raise ValueError(message)


def _interval(value):
    _require(isinstance(value, dict), "Retain the original arithmetic interval")
    result = deepcopy(value)
    for side in ("lower", "upper"):
        actual, exact = value.get(side), value.get(side + "_exact")
        _require(type(value.get(side + "_open")) is bool,
                 "Retain explicit original endpoint openness")
        if exact is None:
            _require(actual is None, "An unbounded source endpoint cannot have a finite value")
        else:
            _require(isinstance(exact, str) and not isinstance(actual, bool)
                     and isinstance(actual, (int, float)) and math.isfinite(actual)
                     and float(Fraction(exact)) == actual,
                     "The plotted endpoint differs from its original exact fraction")
    if value["lower_exact"] is not None and value["upper_exact"] is not None:
        lo, hi = Fraction(value["lower_exact"]), Fraction(value["upper_exact"])
        _require(lo <= hi and (lo != hi or not (value["lower_open"] or value["upper_open"])),
                 "Retain the original nonempty interval order")
    _require(isinstance(value.get("text"), str), "Retain the original readable interval")
    return result


def _axis(values):
    finite = [value[side] for value in values for side in ("lower", "upper")
              if value[side] is not None]
    if not finite:
        return None
    low, high = min(finite), max(finite)
    span = high - low
    if not math.isfinite(span):
        return None
    if span == 0:
        span = max(abs(low) * .2, 1.0)
    pad = span * .15
    low, high = low - pad, high + pad
    if not math.isfinite(low) or not math.isfinite(high) or not high > low:
        return None
    # Interpolate without low + (high-low), which can overflow at extreme scales.
    ticks = [{"value": low * (1 - i / 4) + high * (i / 4),
              "label": format(low * (1 - i / 4) + high * (i / 4), ".5g")}
             for i in range(5)]
    return low, high, ticks


def _table(columns, rows, caption):
    return {"kind": "table", "columns": columns,
            "rows": [[str(cell) for cell in row] for row in rows], "caption": caption}


def figure(data, pair, source_file):
    values = [_interval(pair["matched_mean_" + letter]) for letter in ("a", "b")]
    axis = _axis(values)
    if axis is None:
        return None
    low, high, ticks = axis
    span = high - low
    if not math.isfinite(span):
        return None
    label = comparison._series_label(data, pair["series_id"])
    years = [pair["year_a"], pair["year_b"]]
    lines, closed, opened, arrows, annotations = [], [], [], [], []
    for position, value in enumerate(values):
        def point(number, side, role):
            return {"x": position, "y": number, "source_path": "comparability.json",
                    "comparison_id": pair["id"], "series_id": pair["series_id"],
                    "year": years[position], "endpoint": side,
                    "exact_value": value.get(side + "_exact"), "render_role": role}
        endpoints = {}
        for side, cap in (("lower", low + span * .025), ("upper", high - span * .025)):
            original = value[side]
            endpoints[side] = original if original is not None else cap
            if original is not None:
                item = point(original, side, "original_endpoint")
                (opened if value[side + "_open"] else closed).append(item)
            else:
                # The cap is a drawing boundary, explicitly not a source value.
                sign = 1 if side == "lower" else -1
                arrows.append({"geometry": "line", "markers": False, "label": "",
                    "points": [{"x": position - .045, "y": cap + sign * span * .04,
                                "render_role": "unbounded_arrow"},
                               point(cap, side, "unbounded_arrow"),
                               {"x": position + .045, "y": cap + sign * span * .04,
                                "render_role": "unbounded_arrow"}]})
                annotations.append({"x": position, "y": cap,
                                    "text": "No finite " + side + " bound"})
        lines.append({"geometry": "line", "markers": False,
                      "label": "Arithmetic interval" if position == 0 else "",
                      "points": [point(endpoints["lower"], "lower", "interval_display"),
                                 point(endpoints["upper"], "upper", "interval_display")]})
    # A quantified point has one included marker, not two overlapping endpoints.
    closed = list({(row["x"], row["y"]): row for row in closed}.values())
    opened = list({(row["x"], row["y"]): row for row in opened}.values())
    unit = pair["unit"]
    axis_unit = "" if unit == "None" else unit
    months = ", ".join(map(str, pair["common_months"]))
    identity = "; ".join(field + ": " + (pair[field] or "(empty)")
                         for field in comparison.SERIES_FIELDS)
    caption = (
        f"{label}. {identity}. Shared calendar months: {months}. "
        f"Activities: {pair['activities_a']} in {years[0]}, {pair['activities_b']} in {years[1]}. "
        "Included endpoints are filled circles; excluded endpoints are open circles. "
        "Arrows have no finite endpoint; their drawing extent is not a substituted value. "
        "These are arithmetic bounds from the retained reporting-limit statements, not confidence intervals. "
        "Each panel has its own original-unit scale; do not compare visual lengths between different series. "
        "The exact fractions and complete source identities remain in the figure data and original comparison.")
    return {"id": "paired-interval-" + pair["series_id"],
            "title": label + ": " + pair["characteristic"] + " on matched months",
            "caption": caption, "inputs": [deepcopy(source_file)],
            "comparison_id": pair["id"], "series_id": pair["series_id"],
            "series_identity": {field: pair[field] for field in comparison.SERIES_FIELDS},
            "selection": {"year_a": years[0], "year_b": years[1],
                          "common_months": deepcopy(pair["common_months"])},
            "original_intervals": {"earlier": deepcopy(values[0]), "later": deepcopy(values[1]),
                                   "change": _interval(pair["change"])},
            "panels": [{"title": label + ": original paired periods",
                "x": {"label": "Selected year on the same retained calendar months", "unit": "",
                      "domain": [-.45, 1.45],
                      "ticks": [{"value": i, "label": str(year)} for i, year in enumerate(years)]},
                "y": {"label": "Retained arithmetic mean" if len(unit) <= 18 else "Mean; unit in source table",
                      "unit": unit if len(unit) <= 18 else "", "domain": [low, high], "ticks": ticks},
                "series": lines + [
                    {"geometry": "scatter", "label": "Included endpoint", "marker": "circle", "points": closed},
                    {"geometry": "scatter", "label": "Excluded endpoint", "marker": "circle-open", "points": opened},
                ] + arrows, "annotations": annotations}],
            "detail_tables": [
                _table(["Period", "Original arithmetic interval", "Activities", "Censored activities"],
                       [[years[i], values[i]["text"], pair["activities_" + letter],
                         pair["censored_activities_" + letter]] for i, letter in enumerate(("a", "b"))] +
                       [[str(years[1]) + " minus " + str(years[0]), pair["change"]["text"], "—", "—"]],
                       "Means use equal weights for the same shared complete months and equal activity weights within each month. "
                       "Displayed interval text uses the original six-significant-digit format; exact fractions are retained in the downloadable JSON/CSV."),
                _table(["Original series field", "Original value"],
                       [[field, pair[field]] for field in comparison.SERIES_FIELDS],
                       "Literal nine-field analytical identity. Empty fields remain empty; no station, method or unit is inferred.")
            ]}


def _csv(data):
    stream = io.StringIO(newline="")
    fields = ["comparison_id", "series_id", *comparison.SERIES_FIELDS, "period", "year_a", "year_b",
              "common_months", "activities_a", "activities_b", "censored_activities_a", "censored_activities_b",
              "lower", "upper", "lower_exact", "upper_exact", "lower_open", "upper_open", "text"]
    writer = csv.DictWriter(stream, fields, lineterminator="\n")
    writer.writeheader()
    for pair in data["comparisons"]:
        for period, key in (("earlier", "matched_mean_a"), ("later", "matched_mean_b"), ("later_minus_earlier", "change")):
            bound = pair[key]
            row = {field: pair[field] for field in comparison.SERIES_FIELDS}
            row.update({field: pair[field] for field in
                        ("series_id", "year_a", "year_b", "activities_a", "activities_b",
                         "censored_activities_a", "censored_activities_b")})
            row.update(comparison_id=pair["id"], period=period,
                       common_months=",".join(map(str, pair["common_months"])))
            if bound is not None:
                row.update({field: bound[field] for field in
                            ("lower", "upper", "lower_exact", "upper_exact", "lower_open", "upper_open", "text")})
            writer.writerow(row)
    return stream.getvalue().encode("utf-8")


def _reader(data, figures, svgs):
    esc = lambda value: escape(str(value), quote=True)
    sections = []
    for item in figures:
        tables = []
        for table in item["detail_tables"]:
            tables.append('<div class="scroll" tabindex="0" role="region" aria-label="Original interval and identity table"><table><thead><tr>' +
                          "".join("<th>" + esc(value) + "</th>" for value in table["columns"]) +
                          "</tr></thead><tbody>" +
                          "".join("<tr>" + "".join("<td>" + esc(value) + "</td>" for value in row) + "</tr>"
                                  for row in table["rows"]) +
                          "</tbody></table></div><p>" + esc(table["caption"]) + "</p>")
        sections.append('<section><h2>' + esc(item["title"]) + '</h2><div class="scroll figure" tabindex="0" role="region" aria-label="' + esc(item["title"]) + '">' +
                        svgs[item["id"]] + "</div><p>" + esc(item["caption"]) + "</p>" +
                        "".join(tables) + '<p><a download href="' + esc(item["id"] + ".svg") +
                        '">Download this original SVG</a></p></section>')
    unsupported = ""
    if data["unplotted"]:
        unsupported = "<section><h2>Retained selections without a plot</h2><ul>" + "".join(
            "<li>" + esc(row["series_id"] + ": " + row["reason"]) + "</li>" for row in data["unplotted"]) + "</ul></section>"
    return ('<!doctype html><html lang="en"><head><meta charset="utf-8">'
            '<meta name="viewport" content="width=device-width,initial-scale=1"><title>' + esc(data["title"]) +
            '</title><style>:root{font:15px/1.5 system-ui,sans-serif;color:#202020;background:#fff;color-scheme:light}'
            '*{box-sizing:border-box}body{margin:0}header,main{max-width:1000px;margin:auto;padding:24px}'
            'header{border-bottom:1px solid #bbb}h1{font-size:25px;line-height:1.3}h2{font-size:19px}'
            'section{border:1px solid #bbb;padding:20px;margin:20px 0}a{color:inherit;overflow-wrap:anywhere}'
            'nav{display:flex;flex-wrap:wrap;gap:14px}.scroll{overflow:auto;max-width:100%;margin:12px 0}'
            '.scroll:focus-visible{outline:2px solid #202020;outline-offset:2px}'
            '.figure svg{display:block;min-width:540px;width:100%;height:auto}table{border-collapse:collapse;width:100%;font-size:14px}'
            'th,td{border:1px solid #bbb;text-align:left;vertical-align:top;padding:8px;white-space:pre-wrap;overflow-wrap:anywhere}'
            'th{background:#eee}p{overflow-wrap:anywhere}@media(max-width:600px){header,main{padding:14px}section{padding:12px}}'
            '@media print{header,main{padding:0;max-width:none}nav{display:none}.scroll{overflow:visible}'
            '.figure svg{min-width:0;width:100%}section{border:0;padding:0;break-before:page}table{font-size:9pt}}'
            '</style></head><body><header><h1>' + esc(data["title"]) + '</h1><p>' +
            esc(str(data["selection"]["year_b"]) + " compared with " + str(data["selection"]["year_a"]) +
                ". Every plotted pair retains one original analytical identity and the same supported calendar months.") +
            '</p><nav><a href="../index.html">Complete original observation desk</a>'
            '<a download href="paired-period-data.json">Complete plotted source data</a>'
            '<a download href="paired-period-data.csv">Exact interval CSV</a>'
            '<a download href="paired-period-figures.json">Native figure specification</a>'
            '<a download href="../comparability.json">Every original comparison and source row</a></nav></header><main>' +
            "".join(sections) + unsupported + '</main></body></html>\n')


def prepare(directory, expected_implementation):
    """Add figures to the complete NEW source while it is still staged."""
    from reportlab.graphics import renderSVG
    from . import scientific_figures
    directory = Path(directory)
    _require(implementation() == expected_implementation,
             "Selected cohort figure implementation changed before generation")
    data = read_json(directory / "comparability.json")
    _require(data.get("schema") == comparison.SCHEMA, "Choose the original complete comparison data")
    selection = data["default_comparison"]
    selected = [deepcopy(row) for row in data["comparisons"]
                if (row["year_a"], row["year_b"]) == (selection["year_a"], selection["year_b"])]
    originals = {row["id"]: row for row in data["series"]}
    _require(len(originals) == len(data["series"]), "Retain distinct original analytical series")
    figures, unplotted = [], []
    original_file = describe_file(directory, directory / "comparability.json")
    for pair in selected:
        _require(re.fullmatch("[0-9a-f]{20}", pair["series_id"]) is not None
                 and pair["series_id"] in originals
                 and all(pair[field] == originals[pair["series_id"]][field] for field in comparison.SERIES_FIELDS),
                 "A figure changed its complete original analytical identity")
        if not pair["common_months"]:
            unplotted.append({"series_id": pair["series_id"], "reason": "No shared fully supported calendar month"})
            continue
        item = figure(data, pair, original_file)
        if item is None:
            unplotted.append({"series_id": pair["series_id"], "reason": "Exact retained bounds exceed the finite drawing scale"})
        else:
            figures.append(item)
    figure_data = {"schema": "upstate.cohort-interval-figure-data/v1", "edition": EDITION,
                   "title": data["presentation"]["title"], "selection": deepcopy(selection),
                   "implementation": deepcopy(expected_implementation),
                   "original_comparison": original_file, "original_inputs": deepcopy(data["original_inputs"]),
                   "comparisons": selected, "unplotted": unplotted}
    atomic_json(directory / DATA, figure_data, immutable=True)
    atomic_bytes(directory / CSV, _csv(figure_data), immutable=True)
    spec = {"schema": "upstate.scientific-figure-spec/v1", "edition": EDITION,
            "title": figure_data["title"], "implementation": deepcopy(expected_implementation),
            "rendering": {"width_points": 511.2}, "figures": figures}
    atomic_json(directory / SPEC, spec, immutable=True)
    choices, svgs = [], {}
    for item in figures:
        drawings = scientific_figures.panel_drawings(item, 511.2)
        _require(len(drawings) == 1, "Retain exactly one complete analytical series per panel")
        value = renderSVG.drawToString(drawings[0])
        raw = value.encode("utf-8") if isinstance(value, str) else value
        name = "figures/" + item["id"] + ".svg"
        atomic_bytes(directory / name, raw, immutable=True)
        # Only this original native SVG is embedded; its numerical source is retained.
        svg = raw.decode("utf-8")
        start = svg.find("<svg")
        _require(start >= 0 and svg.rstrip().endswith("</svg>"), "Native figure is not a complete SVG")
        svgs[item["id"]] = svg[start:]
        choices.append({"id": item["id"], "path": name})
    atomic_bytes(directory / READER, _reader(figure_data, figures, svgs).encode("utf-8"), immutable=True)
    for name, path, checksum in (
            ("observation_comparability_figures.py", Path(__file__), expected_implementation["figure_source_sha256"]),
            ("scientific_figures.py", Path(scientific_figures.__file__), expected_implementation["scientific_figures_sha256"])):
        _require(file_digest(path) == checksum, "Original figure source changed during capture")
        atomic_bytes(directory / "producer" / name, path.read_bytes(), immutable=True)
        _require(file_digest(directory / "producer" / name) == checksum, "Captured figure source differs")
    desk = (directory / "index.html").read_text(encoding="utf-8")
    _require(desk.count("</header>") == 1, "Retain the complete original offline desk header")
    link = '<p class="headerlinks"><a href="figures/index.html">Saved ' + str(selection["year_a"]) + \
           " / " + str(selection["year_b"]) + ' paired-period interval figures</a></p>'
    atomic_bytes(directory / "index.html", desk.replace("</header>", link + "</header>").encode("utf-8"))
    recipe = read_json(directory / "observed-report.json")
    manifest = read_json(directory / "model-sources.json")
    _require(recipe.get("schema") == "upstate.observed-report/v1"
             and manifest.get("schema") == "upstate.sources/v1" and len(manifest["entries"]) == 1,
             "Retain the original single complete observed source")
    inputs = [describe_file(directory, path) for path in sorted(directory.rglob("*"))
              if path.is_file() and path.relative_to(directory).as_posix()
              not in ("observed-report.json", "model-sources.json")]
    fingerprint = digest({"inputs": inputs, "selection": selection, "implementation": expected_implementation})
    recipe.update(inputs=inputs, edition=EDITION + "/" + fingerprint[:20], figure_spec=SPEC, figures=choices)
    recipe["source_links"] = list(dict.fromkeys([*recipe.get("source_links", []), READER, DATA, CSV, SPEC,
                                                *[row["path"] for row in choices]]))
    atomic_json(directory / "observed-report.json", recipe)
    entry = manifest["entries"][0]
    entry.update(id=data["presentation"]["source_prefix"] + "-" + fingerprint[:20],
                 **describe_file(directory, directory / "observed-report.json"), companions=inputs)
    entry.setdefault("metadata", {})["interval_figures"] = {
        "edition": EDITION, "implementation": deepcopy(expected_implementation),
        "plotted": len(figures), "unplotted": len(unplotted), "selection": deepcopy(selection)}
    atomic_json(directory / "model-sources.json", manifest)
    _require(implementation() == expected_implementation,
             "Selected cohort figure implementation changed during publication")
    return {"figure_spec": SPEC, "figures": choices, "data": DATA, "csv": CSV, "reader": READER}
