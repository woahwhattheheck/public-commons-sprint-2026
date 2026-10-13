"""Publish a saved original Chemistry report through the maintained scientific composer."""
from __future__ import annotations

import argparse
import csv
import html
import io
import json
import math
from pathlib import Path

from .common import (atomic_bytes, atomic_json, canonical, describe_file, digest,
                     file_digest, held, identifier, read_json, verify_file)
from . import chemistry_reports as reports
from . import observed_context
from .reach_chemistry.reporting import (PARAMETER_UNITS, _parameters, _species, _text,
                                         _observation_groups, _interval_figures)
from .reach_chemistry.inference import observation_key
from .scientific_figures import _validate_figure

VERSION = 1
EDITION = "native-chemistry-scientific-source-v2"
READABLE_EDITIONS = {"native-chemistry-scientific-source-v1", EDITION}
KIND = "chemistry-report-sources"
DIRECTORY = "chemistry-report-source-exports"
SOURCE_ID = "native-chemistry-report"
SCHEMA = "upstate.observed-report/v1"


def _finite(value):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise ValueError("Original Chemistry figure coordinates must be finite numbers")
    return float(value)


def _csv_value(value):
    if value is None:
        return ""
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        if not math.isfinite(value):
            raise ValueError("Original Chemistry table contains a nonfinite number")
        return value
    text = _text(value)
    if text.lstrip().startswith(("=", "+", "-", "@", "\t", "\r")):
        text = "'" + text
    return text


def _csv(fields, rows):
    stream = io.StringIO(newline="")
    writer = csv.writer(stream, lineterminator="\n")
    writer.writerow([label for key, label in fields])
    for row in rows:
        writer.writerow([_csv_value(row.get(key)) for key, label in fields])
    return stream.getvalue().encode("utf-8")


def _axis(label, unit, values, *, zero=True):
    values = [_finite(value) for value in values]
    if not values:
        raise ValueError("Original Chemistry figure has no supplied coordinate values")
    low, high = min(values), max(values)
    if zero:
        low, high = min(0.0, low), max(0.0, high)
    span = high - low
    if not math.isfinite(span):
        raise ValueError("Original Chemistry figure range is not finite")
    if span == 0:
        padding = max(abs(low) * .06, 1.0)
        low, high = (low - padding, high + padding) if low else (0.0, 1.0)
    else:
        high += span * .06
        if low < 0:
            low -= span * .06
    if not math.isfinite(high - low):
        raise ValueError("Original Chemistry figure range is not finite")
    return {"label": label, "unit": unit, "domain": [low, high],
            "ticks": [{"value": low + (high - low) * index / 4,
                       "label": format(low + (high - low) * index / 4, ".4g")}
                      for index in range(5)]}


def _figure_id(prefix, species):
    return prefix + "-" + digest({"species": species})[:16]


def _figures(project, result):
    """Retain numeric values from the original output; compute only plot layout."""
    figures = []
    run = result.get("baseline", result)
    samples = [{"day": sample["day"], **value}
               for sample in run.get("samples", []) for value in sample["values"]]
    for sid, species in project.species.items():
        values = [row for row in samples if row["species"] == sid]
        if values:
            x = _axis("Model day", "day", [row["day"] for row in values])
            y = _axis("Modeled concentration", "mg " + species["basis"] + "/L",
                      [row["mg_l"] for row in values])
            panels = []
            for reach in project.reaches:
                rows = sorted((row for row in values if row["reach"] == reach), key=lambda row: row["day"])
                if rows:
                    panels.append({"id": reach, "title": str(reach), "x": x, "y": y,
                                   "series": [{"geometry": "line", "label": "Retained model samples",
                                               "points": [{"x": row["day"], "y": row["mg_l"],
                                                           "reach": reach, "species": sid} for row in rows]}]})
            figures.append({"id": _figure_id("state", sid),
                            "title": "Retained modeled concentration: " + sid,
                            "caption": "Original sampled model states for " + sid + ", on the declared "
                                       + species["basis"] + " mass basis. All reach panels use the same "
                                       "concentration range. Lines join retained output times for reading; "
                                       "they do not add calculated states between samples.",
                            "panels": panels})
    observations = list(result.get("observations", []))
    observations.extend(item["observation"] for item in result.get("summaries", []))
    for key, species, retained in _observation_groups(project, observations):
        sid = species["operator_label"]
        exact = [row for row in result.get("observations", [])
                 if observation_key(row) == key and row.get("qualifier", "equal") == "equal"]
        if exact:
            axis = _axis("Original reference", "mg " + species["basis"] + "/L",
                         [row[key] for row in exact for key in ("observed_mg_l", "predicted_mg_l")])
            lo, hi = axis["domain"]
            series = [{"geometry": "line", "label": "Equality", "markers": False,
                       "points": [{"x": lo, "y": lo}, {"x": hi, "y": hi}]}]
            for role, marker, label in (("fit", "circle", "Fit"), ("holdout", "square-open", "Held out")):
                points = [{"x": row["observed_mg_l"], "y": row["predicted_mg_l"],
                           "record_id": row["id"], "reach": row["reach"], "day": row["day"], "role": role}
                          for row in exact if row.get("role", "fit") == role]
                if points:
                    series.append({"geometry": "scatter", "marker": marker, "label": label, "points": points})
            figures.append({"id": _figure_id("fit", key),
                            "title": "Original reference and fitted prediction: " + sid,
                            "caption": "One point per original exact-valued reference record; identical axis "
                                       "ranges retain mg of " + species["basis"] + "/L for " + species["operator_expression"]
                                       + ". Filled circles were "
                                       "used in fitting; open squares were held out. The full original "
                                       "provenance determines empirical independence. Below-limit and interval records "
                                       "remain in the original table and are not plotted as exact values.",
                            "panels": [{"id": sid, "title": sid, "x": axis,
                                        "y": {**axis, "label": "Retained fitted prediction"}, "series": series}]})
        quantiles = [{**item["observation"], **{key: value for key, value in item.items() if key != "observation"}}
                     for item in result.get("summaries", []) if observation_key(item["observation"]) == key]
        if quantiles:
            for row in quantiles:
                bounds = [_finite(row[key]) for key in ("p05_mg_l", "median_mg_l", "p95_mg_l")]
                if bounds != sorted(bounds):
                    raise ValueError("Original Chemistry uncertainty quantiles are not ordered")
            x = _axis("Target model day", "day", [row["day"] for row in quantiles])
            y = _axis("Parameter-prior concentration", "mg " + species["basis"] + "/L",
                      [row[key] for row in quantiles for key in ("p05_mg_l", "median_mg_l", "p95_mg_l")])
            panels = []
            for reach in project.reaches:
                rows = [row for row in quantiles if row["reach"] == reach]
                if not rows:
                    continue
                series = [{"geometry": "line", "label": "5th–95th percentile" if index == 0 else "",
                           "markers": False, "points": [
                               {"x": row["day"], "y": row["p05_mg_l"], "record_id": row["id"]},
                               {"x": row["day"], "y": row["p95_mg_l"], "record_id": row["id"]}]}
                          for index, row in enumerate(rows)]
                series.append({"geometry": "scatter", "label": "Median", "marker": "diamond",
                               "points": [{"x": row["day"], "y": row["median_mg_l"],
                                           "record_id": row["id"]} for row in rows]})
                panels.append({"id": reach, "title": str(reach), "x": x, "y": y, "series": series})
            figures.append({"id": _figure_id("prior", key),
                            "title": "Original parameter-prior quantiles: " + sid,
                            "caption": "Vertical segments retain each original target's 5th and 95th "
                                       "percentiles; diamonds retain its median. These are pointwise "
                                       "summaries of the supplied parameter-prior draws, not a simultaneous "
                                       "band or a measurement-error confidence interval. The supplied "
                                       "priors, bounds, latent correlation, seed and completed draw count "
                                       "remain in the report. Shared reach panels use one physical scale for "
                                       + species["operator_expression"] + " on the " + species["basis"] + " basis.",
                            "panels": panels})
    figures.extend(_interval_figures(project, result.get("observations", [])))
    for figure in figures:
        _validate_figure(figure)
    return figures


def _svg(figure):
    """SVG and maintained PDF rendering consume the identical numeric figure spec."""
    esc = lambda value: html.escape(_text(value), quote=True)
    height = 400 * len(figure["panels"]) + 45
    parts = ['<svg xmlns="http://www.w3.org/2000/svg" width="760" height="%s" '
             'viewBox="0 0 760 %s" role="img"><title>%s</title><desc>%s</desc>'
             '<rect width="760" height="%s" fill="white"/>' %
             (height, height, esc(figure["title"]), esc(figure["caption"]), height)]
    for index, panel in enumerate(figure["panels"]):
        top = 55 + index * 400
        left, width, plot_height = 88.0, 625.0, 260.0
        x0, x1 = panel["x"]["domain"]
        y0, y1 = panel["y"]["domain"]
        X = lambda value: left + (_finite(value) - x0) / (x1 - x0) * width
        Y = lambda value: top + plot_height - (_finite(value) - y0) / (y1 - y0) * plot_height
        parts.append('<g fill="#202020" font-family="Arial,Helvetica,sans-serif" font-size="12">')
        parts.append('<text x="88" y="%s" font-size="17">%s</text>' % (top - 22, esc(panel["title"])))
        for axis in ("x", "y"):
            for tick in panel[axis]["ticks"]:
                if axis == "x":
                    parts.append('<text x="%.6f" y="%.6f" text-anchor="middle">%s</text>' %
                                 (X(tick["value"]), top + plot_height + 20, esc(tick["label"])))
                else:
                    py = Y(tick["value"])
                    parts.append('<path d="M 88 %.6f H 713" fill="none" stroke="#dedede"/>' % py)
                    parts.append('<text x="77" y="%.6f" text-anchor="end">%s</text>' %
                                 (py + 4, esc(tick["label"])))
        parts.append('<path d="M 88 %s V %s H 713" fill="none" stroke="#202020"/>' %
                     (top, top + plot_height))
        for series_index, series in enumerate(panel["series"]):
            points = series["points"]
            if series["geometry"] == "line" and len(points) > 1:
                pairs = " ".join("%.6f,%.6f" % (X(p["x"]), Y(p["y"])) for p in points)
                parts.append('<polyline points="%s" fill="none" stroke="#202020" '
                             'stroke-width="1.2"%s/>' %
                             (pairs, ' stroke-dasharray="5 3"' if series_index else ""))
            if series.get("markers", True):
                for point in points:
                    px, py = X(point["x"]), Y(point["y"])
                    tip = "<title>" + esc(point) + "</title>"
                    marker = series.get("marker", "circle")
                    if marker == "square-open":
                        parts.append('<rect x="%.6f" y="%.6f" width="7" height="7" fill="white" '
                                     'stroke="#202020">%s</rect>' % (px - 3.5, py - 3.5, tip))
                    elif marker == "diamond":
                        parts.append('<path d="M %.6f %.6f l 4 4 l -4 4 l -4 -4 Z" '
                                     'fill="#202020">%s</path>' % (px, py - 4, tip))
                    else:
                        parts.append('<circle cx="%.6f" cy="%.6f" r="3.2" fill="#202020">%s</circle>' %
                                     (px, py, tip))
        xlabel = panel["x"]["label"] + " (" + panel["x"]["unit"] + ")"
        ylabel = panel["y"]["label"] + " (" + panel["y"]["unit"] + ")"
        parts.append('<text x="400" y="%s" text-anchor="middle">%s</text>' %
                     (top + plot_height + 48, esc(xlabel)))
        parts.append('<text x="713" y="%s" text-anchor="end" font-size="11">%s</text>' %
                     (top - 5, esc(ylabel)))
        parts.append('<text x="88" y="%s" font-size="11">%s</text>' %
                     (top + plot_height + 76, esc(" · ".join(s["label"] for s in panel["series"] if s.get("label")))))
        parts.append("</g>")
    parts.append("</svg>\n")
    return "".join(parts).encode("utf-8")


def _sections(project, result, request, report, add):
    """Readable original-result sections, with complete CSV for every displayed table."""
    sections = []
    def table_section(key, title, note, rows, fields):
        rows = list(rows)
        member = "tables/" + key + ".csv"
        add(member, _csv(fields, rows))
        shown = rows[:20]
        sections.append([title, [note,
            "Showing %s of %s retained rows. The complete table is linked below." % (len(shown), len(rows)),
            {"kind": "table", "columns": [label for field, label in fields],
             "rows": [[_text(row.get(field)) for field, label in fields] for row in shown]},
            {"kind": "links", "items": [{"title": "Complete " + title.lower(), "path": member}]}]])
    def items(key, title, note, values):
        table_section(key, title, note, [{"item": k, "value": v} for k, v in values],
                      [("item", "Item"), ("value", "Retained value")])

    source_stamp = report["selection"]["source_stamp"]
    info = report["summary"]
    items("identity", "Original completed Chemistry analysis",
          "This scientific source is a presentation of a saved completed result. Each species keeps "
          "its declared conserved mass basis; model days retain their original project origin.",
          [("Project", project.title), ("Mode", info["mode"]), ("Species", project.ns),
           ("Reaches", project.nr), ("Model duration (days)", project.end_day),
           ("Workspace", report["selection"]["workspace_id"]), ("Original run", report["run_id"]),
           ("Original case", report["case_id"]), ("Saved scientific report", report["id"]),
           ("Producing engine", source_stamp["engine_version"]), ("Project SHA256", project.fingerprint),
           ("Original result SHA256", source_stamp["result_sha256"]),
           ("Original request SHA256", source_stamp["request_sha256"]),
           ("Recorded solver elapsed seconds", info.get("recorded_solver_elapsed_seconds")),
           ("Original project provenance", project.raw.get("provenance")),
           ("Original source references", source_stamp["source_refs"])])
    table_section("species", "Original species and conserved bases",
                  "Concentrations in mg basis/L and masses in kg basis refer to the declared conserved "
                  "quantity, for example elemental N rather than ammonium molecular mass.",
                  [{"id": sid, **value} for sid, value in project.species.items()],
                  [("id", "Species"), ("basis", "Conserved basis"), ("provenance", "Original source")])
    run = result.get("baseline", result)
    if "budgets" in run:
        table_section("mass-budgets", "Integrated original mass budgets",
                      "All masses integrate the full model duration. Numerical closure describes the "
                      "implemented model; these quantities are not annual loads.",
                      run["budgets"], [("basis", "Basis"), ("initial_kg", "Initial kg"),
                      ("input_kg", "Added kg"), ("final_storage_kg", "Stored kg"),
                      ("boundary_export_kg", "Exported kg"), ("untracked_reaction_sink_kg", "Other sink kg"),
                      ("residual_kg", "Residual kg"), ("relative_residual", "Relative residual")])
        items("numerics", "Original numerical execution", "Retained solver metadata.",
              list(run.get("numerics", {}).items()))
        table_section("final-states", "Original final reach conditions", "Original endpoint state by reach and species.",
                      run["final"], [("reach", "Reach"), ("species", "Species"), ("basis", "Basis"),
                                     ("mg_l", "mg basis/L"), ("kg", "Stored kg")])
        table_section("sampled-states", "Original sampled model states",
                      "Every retained original output time remains in the complete CSV.",
                      [{"day": sample["day"], **value} for sample in run.get("samples", []) for value in sample["values"]],
                      [("day", "Model day"), ("reach", "Reach"), ("species", "Species"),
                       ("basis", "Basis"), ("mg_l", "mg basis/L"), ("kg", "Stored kg")])
        table_section("boundary-exports", "Integrated original boundary exports",
                      "Original full-duration export, separated by species and basis.",
                      run.get("boundary_export_by_state", []),
                      [("reach", "Reach"), ("species", "Species"), ("basis", "Basis"), ("kg", "Exported kg")])
        table_section("reaction-transfers", "Integrated original reaction transfers",
                      "Processed, product and untracked sink masses retain the original conserved basis.",
                      run.get("reactions", []), [("reaction", "Reaction"), ("reach", "Reach"),
                      ("basis", "Basis"), ("processed_kg", "Processed kg"), ("products_kg", "Products kg"),
                      ("untracked_sink_kg", "Sink kg"), ("sink_label", "Sink")])
    if "sources" in result:
        table_section("source-attribution", "Original source attribution",
                      "Each original source is propagated through the same retained linear model.",
                      [{"source": part["source_tag"], **value} for part in result["sources"] for value in part["result"]["budgets"]],
                      [("source", "Source"), ("basis", "Basis"), ("initial_kg", "Initial kg"),
                       ("input_kg", "Added kg"), ("final_storage_kg", "Stored kg"),
                       ("boundary_export_kg", "Exported kg"), ("untracked_reaction_sink_kg", "Sink kg")])
        items("source-closure", "Original attribution closure", "Original saved source-superposition closure.",
              list(result.get("closure", {}).items()))
    if "observations" in result:
        items("fit-outcome", "Original parameter fit and termination",
              "Held-out records were excluded from fitting; their original source and sampling design "
              "determine independence. The optimizer cost is one half the sum of the selected loss "
              "on squared standardized fit residuals. A below-limit record uses the original one-sided "
              "exceedance penalty and no fraction-of-limit substitution. Interval records use signed "
              "distance to the nearest endpoint divided by the error scale, zero inside the limits. "
              "An excluded open endpoint has zero distance but is outside the declared interval. "
              "Weighted pools retain one conserved basis without implicit conversion or normalization.",
              [("Converged", result.get("converged")), ("Termination", result.get("termination")),
               ("Loss", result.get("loss")), ("Optimizer cost", result.get("objective")),
               ("Evaluations", result.get("evaluations")), ("Fit records", info["fit_records"]),
               ("Held-out records", info["held_out_records"]), ("Below-limit records", info["below_limit_records"]),
               ("Interval records", sum(row.get("qualifier") == "interval" for row in result["observations"])),
               ("Compound records", sum("components" in row for row in result["observations"])),
               ("Local identifiability", result.get("identifiability"))])
        table_section("fit-parameters", "Original fitted parameters and bounds",
                      "Parameter order, original physical values, fitted values and active-bound status are retained.",
                      _parameters(project, result, request), [("id", "Parameter"), ("target", "Target"),
                      ("parameter_units", "Units"), ("basis", "Basis"), ("lower", "Lower"), ("upper", "Upper"),
                      ("original", "Original"), ("fitted", "Fitted"), ("bound_meaning", "Bound status"),
                      ("source_reference", "Source")])
        table_section("fit-scores", "Original fit and held-out scores",
                      "The engine's RMSE and mean modeled-minus-reference bias use exact-valued "
                      "records only, grouped by exact measurement operator. Below-limit and interval records are excluded.",
                      [_species(project, row) for row in result.get("scores", [])],
                      [("role", "Role"), ("operator_label", "Measurement"), ("operator_expression", "Weighted pools"), ("basis", "Basis"), ("components", "Original components"), ("count", "Records"),
                       ("rmse_mg_l", "RMSE mg basis/L"), ("bias_mg_l", "Bias mg basis/L")])
        if result.get("interval_scores"):
            table_section("interval-support", "Original interval support",
                          "This support summary is separate from point RMSE. Endpoint inclusion is "
                          "evaluated exactly; an excluded endpoint has zero distance penalty.",
                          [_species(project, row) for row in result["interval_scores"]],
                          [("role", "Role"), ("operator_label", "Measurement"),
                           ("operator_expression", "Weighted pools"), ("basis", "Basis"),
                           ("components", "Original components"), ("count", "Interval records"),
                           ("predictions_within_declared_interval", "Predictions within declared limits"),
                           ("weighted_distance_to_interval_rmse", "RMS standardized distance to limits")])
        table_section("references", "Every original reference and retained prediction",
                      "Original qualifiers, assumed error scales and record provenance remain visible.",
                      [_species(project, row) for row in result["observations"]],
                      [("id", "Record"), ("reach", "Reach"), ("operator_label", "Measurement"), ("operator_expression", "Weighted pools"), ("basis", "Basis"), ("components", "Original components"),
                       ("day", "Model day"), ("role", "Role"), ("qualifier", "Qualifier"),
                       ("observed_mg_l", "Point or below limit mg basis/L"),
                       ("lower_mg_l", "Lower limit mg basis/L"), ("upper_mg_l", "Upper limit mg basis/L"),
                       ("lower_closed", "Includes lower"), ("upper_closed", "Includes upper"),
                       ("declared_interval", "Declared interval mg basis/L"),
                       ("interval_contains_prediction", "Prediction within declared interval"),
                       ("predicted_mg_l", "Prediction mg basis/L"), ("sigma_mg_l", "Error scale mg basis/L"),
                       ("weighted_residual", "Objective residual"), ("provenance", "Original source")])
    if "rows" in result:
        table_section("sensitivity", "Original local parameter sensitivity",
                      "Saved forward-tangent derivatives describe the original local parameter "
                      "values. Elasticity is derivative times parameter divided by prediction; "
                      "it is undefined for zero prediction.",
                      [_species(project, {**row["observation"], **derivative,
                       "predicted_mg_l": row["predicted_mg_l"],
                       "parameter_units": PARAMETER_UNITS.get(derivative.get("parameter_kind"))})
                       for row in result["rows"] for derivative in row["derivatives"]],
                      [("id", "Target"), ("reach", "Reach"), ("operator_label", "Measurement"), ("operator_expression", "Weighted pools"), ("basis", "Basis"), ("components", "Original components"),
                       ("day", "Day"), ("parameter", "Parameter"), ("parameter_kind", "Physical field"),
                       ("parameter_units", "Parameter units"),
                       ("predicted_mg_l", "Prediction mg basis/L"),
                       ("mg_l_per_parameter_unit", "mg basis/L per parameter unit"), ("elasticity", "Elasticity")])
    if "selected" in result:
        items("monitoring-design", "Original chemical-parameter monitoring design",
              "The saved local greedy information design uses the original error scales and prior "
              "precision. Candidate sites/times are proposed measurements. This is distinct from "
              "the regional field campaign cost and visit programme.",
              [("Method", result.get("method")), ("Requested count", request.get("count")),
               ("Selected count", len(result["selected"])), ("Log-determinant gain", result.get("total_logdet_gain")),
               ("Prior precision", result.get("prior_precision")),
               ("Resulting linearized precision", result.get("posterior_linearized_precision"))])
        table_section("monitoring-parameters", "Original precision-matrix parameter order",
                      "Matrix entry units are inverse products of the corresponding parameter units. "
                      "Row and column order is exactly this retained order.",
                      _parameters(project, result, request), [("id", "Parameter"), ("target", "Target"),
                      ("parameter_units", "Units"), ("basis", "Basis"), ("lower", "Lower"), ("upper", "Upper")])
        table_section("monitoring-selected", "Original selected chemical monitoring candidates",
                      "Original candidates and their incremental linearized information gains.",
                      [_species(project, {**row["candidate"], "order": row["order"],
                       "predicted_mg_l": row["predicted_mg_l"],
                       "incremental_logdet_gain": row["incremental_logdet_gain"]}) for row in result["selected"]],
                      [("order", "Order"), ("id", "Candidate"), ("reach", "Reach"), ("operator_label", "Measurement"), ("operator_expression", "Weighted pools"),
                       ("basis", "Basis"), ("components", "Original components"), ("day", "Day"), ("sigma_mg_l", "Error scale mg basis/L"),
                       ("predicted_mg_l", "Prediction mg basis/L"), ("incremental_logdet_gain", "Incremental logdet gain")])
    if "summaries" in result:
        items("ensemble", "Original parameter-prior ensemble",
              str(result.get("interpretation", "")) + " The 5th–95th percentiles cover the central 90% "
              "of the completed parameter draws. Measurement or structural errors not varied in the "
              "request are outside these summaries. Latent Gaussian correlation is not necessarily "
              "the Pearson correlation of the transformed physical parameters.",
              [("Completed draws", result.get("draw_count")), ("Seed", result.get("seed")),
               ("Maximum relative budget residual", result.get("maximum_relative_budget_residual")),
               ("Latent Gaussian correlation in parameter order", result.get("latent_gaussian_correlation"))])
        priors = {row["id"]: row for row in result.get("distributions", [])}
        table_section("ensemble-priors", "Original uncertainty parameters and priors",
                      "Original draw order, bounds and complete distribution specifications.",
                      [{**row, "distribution": priors.get(row["id"])} for row in _parameters(project, result, request)],
                      [("id", "Parameter"), ("target", "Target"), ("parameter_units", "Units"), ("basis", "Basis"),
                       ("lower", "Lower"), ("upper", "Upper"), ("distribution", "Original distribution")])
        table_section("ensemble-quantiles", "Original target-by-target prior quantiles",
                      "Pointwise original summaries retain each target reach, complete measurement operator, basis and day.",
                      [_species(project, {**row["observation"], **{k: v for k, v in row.items() if k != "observation"}})
                       for row in result["summaries"]],
                      [("id", "Target"), ("reach", "Reach"), ("operator_label", "Measurement"), ("operator_expression", "Weighted pools"), ("basis", "Basis"), ("components", "Original components"),
                       ("day", "Day"), ("p05_mg_l", "5th percentile mg basis/L"),
                       ("median_mg_l", "Median mg basis/L"), ("p95_mg_l", "95th percentile mg basis/L"),
                       ("mean_mg_l", "Mean mg basis/L")])
    input_tables = [
        ("reaches", "Original completely mixed reaches", project.reaches,
         [("id", "Reach"), ("volume_m3", "Fixed volume m3"), ("temperature_c", "Temperature C"), ("provenance", "Source")]),
        ("flows", "Original water transport", project.flows,
         [("id", "Flow"), ("source", "Source"), ("target", "Target"), ("m3_day", "m3/day"),
          ("concentration_mg_l", "Boundary concentrations mg basis/L"), ("provenance", "Source")]),
        ("loads", "Original chemical loading", project.loads,
         [("id", "Load"), ("reach", "Reach"), ("species", "Species"), ("kg_day", "kg basis/day"), ("provenance", "Source")]),
        ("reactions", "Original reaction coefficients", project.reactions,
         [("id", "Reaction"), ("source", "Reactant"), ("products", "Product basis fractions"),
          ("rate_day", "day^-1"), ("theta", "Temperature factor"), ("reference_temperature_c", "Reference C"),
          ("reach_ids", "Selected reaches"), ("sink_label", "Sink"), ("provenance", "Source")])]
    for key, title, values, fields in input_tables:
        table_section(key, title, "Original physical assumptions and source records.",
                      [{"id": key_id, **value} for key_id, value in values.items()], fields)
    table_section("phases", "Original phase schedule", "Omitted multipliers equal one.",
                  project.phases, [("until_day", "Phase end day"), ("flow_multipliers", "Flow multipliers"),
                  ("load_multipliers", "Load multipliers"), ("reaction_multipliers", "Reaction multipliers"),
                  ("exchange_multipliers", "Exchange multipliers")])
    table_section("initial", "Original initial inventories", "Initial mass uses each species' declared basis.",
                  project.raw.get("initial", []), [("id", "ID"), ("reach", "Reach"), ("species", "Species"),
                  ("kg", "Initial kg basis"), ("provenance", "Source")])
    table_section("exchange", "Original bidirectional exchange", "Original each-direction water exchange.",
                  project.raw.get("exchanges", []), [("id", "ID"), ("a", "Reach A"), ("b", "Reach B"),
                  ("m3_day", "Each direction m3/day"), ("provenance", "Source")])
    sections.append(["Read and reuse the original scientific report", [
        "The complete readable original report, its exact saved native inputs/results, and editable "
        "Chemistry project accompany this source. All original numerical results remain unchanged.",
        {"kind": "links", "items": [
            {"title": "Complete saved Chemistry scientific report", "path": "dossier/report.html"},
            {"title": "Complete original scientific report ZIP", "path": "dossier/scientific-report.zip"},
            {"title": "Original editable Chemistry project ZIP", "path": "dossier/editable-chemistry.zip"},
            {"title": "Original numerical result", "path": "dossier/original/artifacts/result.json"},
            {"title": "Original request", "path": "dossier/original/artifacts/request.json"},
            {"title": "Original project and provenance", "path": "dossier/original/artifacts/project.json"},
            {"title": "Original scientific report inventory", "path": "dossier/manifest.json"}]}]])
    return sections


def prepare(workspace, report_id):
    report = reports.inspect(workspace, identifier(report_id))
    original = workspace.root / reports.FOLDER / report["id"]
    unused_service, native, case, project, request, result, stamp = reports._basis(workspace, report["run_id"])
    if stamp != report["selection"]["source_stamp"]:
        raise ValueError("Saved Chemistry report and native result identify different original sources")
    selection = {"edition": EDITION, "workspace_id": workspace.project["id"],
                 "report_id": report["id"], "report_record_sha256": report["record_sha256"],
                 "source_stamp": stamp, "producer_sha256": file_digest(Path(__file__))}
    selection_id = digest(selection)
    directory = workspace.root / DIRECTORY / selection_id
    directory.mkdir(parents=True, exist_ok=True)
    with held(directory / ".source.lock", blocking=False):
        completed = directory / "result.json"
        if completed.exists():
            return inspect(workspace, read_json(completed)["id"])
        files = {}
        for item in report["artifacts"]:
            source = verify_file(workspace.root, item)
            relative = source.relative_to(original).as_posix()
            reports._member(relative)
            member = "dossier/" + relative
            if member in files:
                raise ValueError("Saved Chemistry report repeats an original artifact member")
            reports._copy(source, directory / member)
            files[member] = describe_file(directory, directory / member)
        reports._copy(original / "report.json", directory / "dossier" / "report.json")
        files["dossier/report.json"] = describe_file(directory, directory / "dossier" / "report.json")
        def add(name, body):
            reports._member(name)
            atomic_bytes(directory / name, body, immutable=True)
            files[name] = describe_file(directory, directory / name)
        sections = _sections(project, result, request, report, add)
        figures = _figures(project, result)
        add("figures/specification.json", canonical({
            "schema": "upstate.scientific-figure-spec/v1", "edition": EDITION,
            "run_id": report["run_id"], "report_id": report["id"], "figures": figures}) + b"\n")
        for figure in figures:
            add("figures/" + figure["id"] + ".svg", _svg(figure))
        title = project.title + " — " + str(report["summary"]["mode"])
        recipe = {"schema": SCHEMA, "edition": EDITION, "title": title,
                  "native_chemistry_report": {**selection, "run_id": report["run_id"],
                                              "case_id": report["case_id"], "mode": report["summary"]["mode"]},
                  "sections": sections,
                  "inputs": [{"path": name, "bytes": item["bytes"], "sha256": item["sha256"]}
                             for name, item in sorted(files.items())],
                  "figure_spec": "figures/specification.json",
                  "figures": [{"id": f["id"], "path": "figures/" + f["id"] + ".svg"} for f in figures],
                  "source_links": ["dossier/report.html", "dossier/scientific-report.zip",
                                   "dossier/editable-chemistry.zip", "dossier/manifest.json",
                                   "dossier/original/artifacts/project.json", "dossier/original/artifacts/result.json"]}
        add("observed-report.json", canonical(recipe) + b"\n")
        manifest = {"schema": "upstate.sources/v1", "title": title, "captured_at": None,
                    "notes": ["Original completed Chemistry report and exact retained numerical sources."],
                    "entries": [{"id": SOURCE_ID, "kind": "document", "role": observed_context.ROLE,
                                 "title": title, "uri": "urn:upstate:chemistry-report:" + report["id"],
                                 "vintage": "Original retained Chemistry report " + report["id"][:16],
                                 "path": "observed-report.json", "sha256": files["observed-report.json"]["sha256"],
                                 "metadata": {"report_schema": SCHEMA, "producer": EDITION,
                                              "chemistry_report_id": report["id"], "chemistry_run_id": report["run_id"],
                                              "chemistry_case_id": report["case_id"], "mode": report["summary"]["mode"]},
                                 "companions": [{"path": name, "sha256": item["sha256"]}
                                                for name, item in sorted(files.items()) if name != "observed-report.json"]}]}
        atomic_json(directory / "sources.json", manifest, immutable=True)
        collection = workspace.import_sources(directory / "sources.json")
        if reports.inspect(workspace, report["id"])["record_sha256"] != selection["report_record_sha256"]:
            raise ValueError("Original Chemistry report changed while publishing its scientific source")
        record = workspace._save(KIND, {
            "version": VERSION, "edition": EDITION, "workspace_id": workspace.project["id"], "state": "complete",
            "title": title, "mode": report["summary"]["mode"], "selection": selection,
            "selection_id": selection_id, "source_stamp": stamp, "report_id": report["id"],
            "run_id": report["run_id"], "case_id": report["case_id"],
            "source_collection_id": collection["id"], "source_id": SOURCE_ID,
            "directory": directory.relative_to(workspace.root).as_posix(), "files": files,
            "manifest": describe_file(directory, directory / "sources.json"),
            "figure_count": len(figures), "companion_count": len(files) - 1,
        })
        atomic_json(completed, record, immutable=True)
        return inspect(workspace, record["id"])


def inspect(workspace, record_id):
    record = workspace._get(KIND, identifier(record_id))
    if (record.get("version") != VERSION or record.get("edition") not in READABLE_EDITIONS
            or record.get("state") != "complete" or record.get("workspace_id") != workspace.project["id"]
            or digest(record["selection"]) != record["selection_id"]):
        raise ValueError("Choose the original Chemistry scientific-source edition in this workspace")
    report = reports.inspect(workspace, identifier(record["report_id"]))
    expected = {"edition": record["edition"], "workspace_id": workspace.project["id"],
                "report_id": report["id"], "report_record_sha256": report["record_sha256"],
                "source_stamp": report["selection"]["source_stamp"],
                "producer_sha256": record["selection"]["producer_sha256"]}
    if record["selection"] != expected or record["source_stamp"] != expected["source_stamp"]:
        raise ValueError("Chemistry scientific source differs from the original completed report")
    if any(record[key] != report[key] for key in ("run_id", "case_id")):
        raise ValueError("Chemistry scientific source identifies another original run or case")
    if record["mode"] != report["summary"]["mode"] or record["source_id"] != SOURCE_ID:
        raise ValueError("Chemistry scientific source mode or original document identity changed")
    directory = workspace.root / DIRECTORY / identifier(record["selection_id"])
    if record["directory"] != directory.relative_to(workspace.root).as_posix():
        raise ValueError("Chemistry scientific source directory differs")
    verify_file(directory, record["manifest"])
    for name, item in record["files"].items():
        if reports._member(name).as_posix() != item["path"]:
            raise ValueError("Chemistry scientific source member differs from its inventory")
        verify_file(directory, item)
    choice = {"source_collection_id": record["source_collection_id"], "source_id": record["source_id"]}
    binding = observed_context.bind(workspace, {"source_roles": {observed_context.ROLE: choice}})
    if (binding["body_sha256"] != record["files"]["observed-report.json"]["sha256"]
            or binding["member_sha256"] != {name: item["sha256"] for name, item in record["files"].items()}):
        raise ValueError("Chemistry scientific source lost an original report, table or figure")
    return record


def list_saved(workspace, report_id=None):
    if report_id is not None:
        report_id = identifier(report_id)
    keys = ("id", "edition", "state", "title", "mode", "report_id", "run_id", "case_id",
            "source_collection_id", "source_id", "figure_count", "companion_count")
    return [{key: row.get(key) for key in keys} for row in workspace._list(KIND)
            if report_id is None or row["report_id"] == report_id]


def verify_workspace(workspace):
    return [{"id": record["id"], "report_id": record["report_id"],
             "source_collection_id": record["source_collection_id"]}
            for row in workspace._list(KIND) for record in [inspect(workspace, row["id"])]]


def main():
    from .workspace import Workspace
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", required=True)
    commands = parser.add_subparsers(dest="command", required=True)
    action = commands.add_parser("prepare")
    action.add_argument("--report", required=True)
    action = commands.add_parser("inspect")
    action.add_argument("--id", required=True)
    commands.add_parser("list")
    args = parser.parse_args()
    workspace = Workspace(args.workspace, create=False)
    value = prepare(workspace, args.report) if args.command == "prepare" else (
        inspect(workspace, args.id) if args.command == "inspect" else list_saved(workspace))
    print(json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False))


if __name__ == "__main__":
    main()
