"""Scientific presentation of original completed reach-chemistry results.

This module reads retained result fields. It does not fit coefficients, propagate
the network, estimate uncertainty or change any original observation.
"""
from __future__ import annotations

import html
import json
import math

from .inference import observation_key

REPORT_EDITION = "reach-chemistry-scientific-report/3"
PARAMETER_UNITS = {
    "reaction_rate_day": "day^-1",
    "load_kg_day": "kg of declared basis/day",
    "boundary_mg_l": "mg of declared basis/L",
    "initial_kg": "kg of declared basis",
}


def _text(value):
    if value is None:
        return "Not supplied"
    if isinstance(value, bool):
        return "Yes" if value else "No"
    if isinstance(value, float):
        return format(value, ".12g")
    if isinstance(value, (dict, list)):
        return json.dumps(value, ensure_ascii=False, sort_keys=True, allow_nan=False)
    return str(value)


def _escape(value):
    return html.escape(_text(value), quote=True)


def _table(rows, fields, caption):
    if not rows:
        return "<p>No records in this retained result.</p>"
    return ("<div class='scroll'><table><caption>" + _escape(caption)
            + "</caption><thead><tr>"
            + "".join("<th scope='col'>" + _escape(label) + "</th>" for _, label in fields)
            + "</tr></thead><tbody>"
            + "".join("<tr>" + "".join("<td>" + _escape(row.get(key)) + "</td>"
                                       for key, _ in fields) + "</tr>" for row in rows)
            + "</tbody></table></div>")


def _items(values, caption):
    return _table([{"item": key, "value": value} for key, value in values],
                  [("item", "Item"), ("value", "Retained value")], caption)


def _provenance(value):
    value = value if isinstance(value, dict) else {}
    return {"source_kind": value.get("kind"), "source_reference": value.get("reference"),
            "source_detail": value}


def _species(project, row):
    """Describe a retained measurement without inventing a physical species."""
    if "components" in row:
        label = row["measurement"]
        expression = " + ".join(_text(c["weight"]) + " × " + c["species"] for c in row["components"])
        value = {**row, "operator_label": label, "operator_expression": expression}
    else:
        sid = row.get("species")
        species = project.species.get(sid, {})
        value = {**row, "basis": species.get("basis"), "species_label": species.get("name", sid),
                 "operator_label": sid, "operator_expression": sid}
    if row.get("qualifier") == "interval":
        value["declared_interval"] = (("[" if row["lower_closed"] else "(")
            + _text(row["lower_mg_l"]) + ", " + _text(row["upper_mg_l"])
            + ("]" if row["upper_closed"] else ")"))
    return value


def _observation_groups(project, rows):
    """Use the original native operator identity, including label, basis and weights."""
    groups = {}
    for row in rows:
        groups.setdefault(observation_key(row), []).append(row)
    order = {("species", sid): index for index, sid in enumerate(project.species)}
    keys = sorted(groups, key=lambda key: order.get(key, len(order)))
    return [(key, _species(project, groups[key][0]), groups[key]) for key in keys]


def _interval_figures(project, observations):
    """Present the original limits and prediction; no point substitute is calculated."""
    figures = []
    for group_index, (_, description, retained) in enumerate(_observation_groups(project, observations)):
        rows = [row for row in retained if row.get("qualifier") == "interval"]
        for start in range(0, len(rows), 12):
            subset = rows[start:start + 12]
            values = [float(row[key]) for row in subset
                      for key in ("lower_mg_l", "upper_mg_l", "predicted_mg_l")]
            if any(not math.isfinite(value) for value in values):
                raise ValueError("Nonfinite original interval figure coordinates")
            low, high = min(0.0, min(values)), max(values)
            span = max(high - low, abs(high) * .05, 1e-12)
            high += span * .06
            series = []
            for index, row in enumerate(subset, 1):
                common = {"record_id": row["id"], "reach": row["reach"], "day": row["day"],
                          "role": row.get("role", "fit")}
                series.append({"geometry": "line", "label": "Declared interval" if index == 1 else "",
                    "markers": False, "points": [
                        {"x": row["lower_mg_l"], "y": index, **common},
                        {"x": row["upper_mg_l"], "y": index, **common}]})
                for bound in ("lower", "upper"):
                    series.append({"geometry": "scatter", "label": "",
                        "marker": "circle" if row[bound + "_closed"] else "square-open",
                        "points": [{"x": row[bound + "_mg_l"], "y": index, **common,
                                    "closed": row[bound + "_closed"]}]})
            series.append({"geometry": "scatter", "label": "Retained prediction", "marker": "diamond",
                "points": [{"x": row["predicted_mg_l"], "y": index, "record_id": row["id"],
                            "within_declared_interval": row.get("interval_contains_prediction")}
                           for index, row in enumerate(subset, 1)]})
            figures.append({"id": "interval-" + str(group_index + 1) + "-" + str(start + 1),
                "title": "Declared observation intervals: " + description["operator_label"],
                "caption": description["operator_expression"] + " on the " + description["basis"]
                    + " basis. Solid circles include endpoints; open squares exclude endpoints. Diamonds "
                      "show retained predictions. A prediction on an open endpoint has zero distance "
                      "penalty and remains outside the declared interval. Records: "
                    + "; ".join(str(index) + " = " + row["id"] + " (" + row.get("role", "fit") + ")"
                                for index, row in enumerate(subset, 1)) + ".",
                "panels": [{"id": "limits", "title": description["operator_label"],
                    "x": {"label": "Concentration", "unit": "mg " + description["basis"] + "/L",
                          "domain": [low, high], "ticks": [
                              {"value": low + (high - low) * i / 4,
                               "label": format(low + (high - low) * i / 4, ".4g")} for i in range(5)]},
                    "y": {"label": "Record", "unit": "index", "domain": [0, len(subset) + 1],
                          "ticks": [{"value": i, "label": str(i)} for i in range(1, len(subset) + 1)]},
                    "series": series}]})
    return figures


def _intervals(project, observations):
    figures = []
    for figure in _interval_figures(project, observations):
        panel = figure["panels"][0]
        low, high = panel["x"]["domain"]
        count = panel["y"]["domain"][1]
        X = lambda value: 60 + (value - low) / (high - low) * 490
        Y = lambda value: 60 + (count - value) / count * 320
        parts = ["<figure><svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 620 460' role='img'>",
                 "<title>" + _escape(figure["title"]) + "</title><rect width='620' height='460' fill='white'/>",
                 "<g font-family='sans-serif' font-size='12' fill='#171717'>",
                 "<path d='M60 60V380H550' fill='none' stroke='#171717'/>"]
        for tick in panel["x"]["ticks"]:
            parts.append(f"<text x='{X(tick['value']):.3f}' y='402' text-anchor='middle'>"
                         + _escape(tick["label"]) + "</text>")
        for tick in panel["y"]["ticks"]:
            parts.append(f"<text x='48' y='{Y(tick['value'])+4:.3f}' text-anchor='end'>"
                         + _escape(tick["label"]) + "</text>")
        for series in panel["series"]:
            points = series["points"]
            if series["geometry"] == "line":
                coordinates = " ".join(f"{X(p['x']):.3f},{Y(p['y']):.3f}" for p in points)
                parts.append("<polyline points='" + coordinates + "' fill='none' stroke='#171717'/>")
            else:
                for point in points:
                    x, y = X(point["x"]), Y(point["y"])
                    tip = "<title>" + _escape(point) + "</title>"
                    if series["marker"] == "square-open":
                        parts.append(f"<rect x='{x-4:.3f}' y='{y-4:.3f}' width='8' height='8' fill='white' stroke='#171717'>{tip}</rect>")
                    elif series["marker"] == "diamond":
                        parts.append(f"<path d='M{x:.3f} {y-5:.3f}l5 5 -5 5 -5 -5Z' fill='#171717'>{tip}</path>")
                    else:
                        parts.append(f"<circle cx='{x:.3f}' cy='{y:.3f}' r='3' fill='#171717'>{tip}</circle>")
        parts += ["<text x='305' y='440' text-anchor='middle'>"
                  + _escape(panel["x"]["label"] + " (" + panel["x"]["unit"] + ")") + "</text>",
                  "</g></svg><figcaption>" + _escape(figure["title"] + ". " + figure["caption"]) + "</figcaption></figure>"]
        figures.append("".join(parts))
    return "<div class='figures'>" + "".join(figures) + "</div>" if figures else ""


def _parameters(project, result, request):
    original = {p["id"]: p for p in request.get("parameters", [])}
    rows = []
    for parameter in result.get("parameters", request.get("parameters", [])):
        item = {**original.get(parameter["id"], {}), **parameter}
        kind, target = item.get("kind"), item.get("target")
        group = {"reaction_rate_day": project.reactions, "load_kg_day": project.loads,
                 "boundary_mg_l": project.flows, "initial_kg": project.initials}.get(kind, {})
        physical = group.get(target, {})
        species_id = item.get("species") or physical.get("species") or physical.get("source")
        basis = project.species.get(species_id, {}).get("basis")
        if kind == "boundary_mg_l":
            basis = project.species.get(item.get("species"), {}).get("basis")
        item.update(parameter_units=PARAMETER_UNITS.get(kind, kind), basis=basis,
                    source_reference=physical.get("provenance", {}).get("reference"),
                    bound_meaning={-1: "Lower bound", 0: "Interior", 1: "Upper bound"}.get(item.get("active_bound")))
        rows.append(item)
    return rows


def summary(project, result, request=None):
    request = request or {}
    observations = result.get("observations", [])
    return {"edition": REPORT_EDITION, "title": project.title,
            "mode": request.get("mode") or result.get("schema", "").removeprefix("reach-chemistry-").split("/")[0],
            "result_schema": result.get("schema"), "project_sha256": project.fingerprint,
            "duration_days": project.end_day, "reaches": project.nr, "species": project.ns,
            "project_provenance": project.raw.get("provenance", {}),
            "fit_records": sum(r.get("role", "fit") == "fit" for r in observations),
            "held_out_records": sum(r.get("role") == "holdout" for r in observations),
            "below_limit_records": sum(r.get("qualifier") == "below" for r in observations),
            "interval_records": sum(r.get("qualifier") == "interval" for r in observations),
            "compound_records": sum("components" in r for r in observations),
            "converged": result.get("converged"), "termination": result.get("termination"),
            "draw_count": result.get("draw_count"), "seed": result.get("seed"),
            "recorded_solver_elapsed_seconds": result.get("elapsed_seconds", result.get("baseline", result).get("numerics", {}).get("elapsed_seconds"))}


def _scatter(project, observations):
    """Equal-axis plot of original exact-valued reference/prediction pairs."""
    panels = []
    for _, species, retained in _observation_groups(project, observations):
        sid = species["operator_label"]
        rows = [r for r in retained if r.get("qualifier", "equal") == "equal"]
        if not rows:
            continue
        if any(not math.isfinite(float(r[key])) for r in rows for key in ("observed_mg_l", "predicted_mg_l")):
            raise ValueError("Nonfinite original chemistry scatter coordinates")
        values = [float(r[key]) for r in rows for key in ("observed_mg_l", "predicted_mg_l")]
        low, high = min(0.0, min(values)), max(values)
        span = max(high - low, abs(high) * 0.05, 1e-12)
        high += span * 0.06
        if high == low:
            high = low + 1.0
        left, top, width, height = 84, 58, 460, 460
        def x(value):
            return left + (value - low) / (high - low) * width
        def y(value):
            return top + height - (value - low) / (high - low) * height
        pieces = ["<figure><svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 620 620' role='img' aria-label='"
                  + _escape(sid + " reference and modeled concentration") + "'>",
                  "<rect width='620' height='620' fill='white'/>",
                  "<g font-family='sans-serif' fill='#171717' font-size='13'>",
                  "<text x='84' y='27' font-size='19'>" + _escape(sid + " / " + species["basis"]) + "</text>",
                  "<path d='M84 58V518H544' fill='none' stroke='#171717'/>",
                  "<path d='M84 518L544 58' fill='none' stroke='#777' stroke-dasharray='5 4'/>"]
        for i in range(6):
            value = low + (high - low) * i / 5
            xp, yp = x(value), y(value)
            label = format(value, ".4g")
            pieces += [f"<text x='{xp:.3f}' y='542' text-anchor='middle'>{label}</text>",
                       f"<text x='73' y='{yp+4:.3f}' text-anchor='end'>{label}</text>"]
        for row in rows:
            xp, yp = x(float(row["observed_mg_l"])), y(float(row["predicted_mg_l"]))
            label = _escape(row["id"] + " / " + row.get("role", "fit")
                            + " / reference " + _text(row["observed_mg_l"])
                            + " / modeled " + _text(row["predicted_mg_l"]) + " mg/L")
            if row.get("role") == "holdout":
                pieces.append(f"<rect x='{xp-4:.3f}' y='{yp-4:.3f}' width='8' height='8' fill='white' stroke='#111'><title>{label}</title></rect>")
            else:
                pieces.append(f"<circle cx='{xp:.3f}' cy='{yp:.3f}' r='3.5' fill='#333'><title>{label}</title></circle>")
        pieces += ["<text x='314' y='575' text-anchor='middle'>Original reference (mg of " + _escape(species["basis"]) + "/L)</text>",
                   "<text transform='translate(19 288) rotate(-90)' text-anchor='middle'>Modeled concentration (same units)</text>",
                   "<text x='84' y='605'>Solid circle: fit. Open square: held out. Dashed: equality.</text>",
                   "</g></svg><figcaption>" + _escape(species["operator_expression"]) + ". Equal axis ranges for this exact measurement operator. Below-limit and interval records retain their limits in the full table and interval figures.</figcaption></figure>"]
        panels.append("".join(pieces))
    return "<div class='figures'>" + "".join(panels) + "</div>" if panels else ""


def _input_sections(project):
    species = [{**value, "id": key, **_provenance(value.get("provenance"))}
               for key, value in project.species.items()]
    reaches = [{**value, "id": key, **_provenance(value.get("provenance"))}
               for key, value in project.reaches.items()]
    flows = [{**value, "id": key, **_provenance(value.get("provenance"))}
             for key, value in project.flows.items()]
    loads = [_species(project, {**value, "id": key, **_provenance(value.get("provenance"))})
             for key, value in project.loads.items()]
    reactions = [{**value, "id": key,
                  "basis": project.species[value["source"]]["basis"],
                  **_provenance(value.get("provenance"))} for key, value in project.reactions.items()]
    return ("<details><summary>Complete original physical assumptions and coefficient sources</summary>"
            + _table(species, [("id", "Species"), ("basis", "Conserved mass basis"),
                               ("source_kind", "Source kind"), ("source_reference", "Original source")], "Species definitions")
            + _table(reaches, [("id", "Reach"), ("volume_m3", "Fixed volume (m³)"),
                               ("temperature_c", "Temperature (°C)"), ("source_reference", "Original source")], "Completely mixed reaches")
            + _table(flows, [("id", "Flow"), ("source", "Source reach / boundary"), ("target", "Target reach / boundary"),
                             ("m3_day", "Water flow (m³/day)"), ("concentration_mg_l", "Boundary concentrations (mg basis/L by species)"),
                             ("source_reference", "Original source")], "Original water transport")
            + _table(loads, [("id", "Load"), ("reach", "Reach"), ("species", "Species"), ("basis", "Basis"),
                             ("kg_day", "External load (kg basis/day)"), ("source_reference", "Original source")], "External chemical loading")
            + _table(reactions, [("id", "Reaction"), ("source", "Reactant"), ("basis", "Basis"),
                                 ("rate_day", "Rate (day⁻¹)"), ("products", "Product basis-mass fractions"),
                                 ("sink_label", "Untracked sink"), ("theta", "Temperature factor θ"),
                                 ("reference_temperature_c", "Reference temperature (°C)"),
                                 ("reach_ids", "Selected reaches (unsupplied means all)"),
                                 ("source_reference", "Original source")], "First-order reactions")
            + _table(project.raw.get("exchanges", []), [("id", "Exchange"), ("a", "Reach A"), ("b", "Reach B"),
                       ("m3_day", "Each-direction exchange (m³/day)"), ("provenance", "Original source")], "Bidirectional exchange")
            + _table(project.raw.get("initial", []), [("id", "Initial stock"), ("reach", "Reach"),
                       ("species", "Species"), ("kg", "Initial kg of species basis"), ("provenance", "Original source")], "Initial inventories")
            + _table(project.phases, [("until_day", "Phase ends (day)"), ("flow_multipliers", "Flow multipliers"),
                       ("load_multipliers", "Load multipliers"), ("reaction_multipliers", "Reaction multipliers"),
                       ("exchange_multipliers", "Exchange multipliers")], "Original phase schedule; omitted multipliers equal one")
            + "</details>")


def report(project, result, request=None, *, identity=None, links=None):
    request = request or {}
    info = summary(project, result, request)
    provenance = project.raw.get("provenance", {})
    source_rows = []
    if isinstance(provenance, dict):
        source_rows = [{"item": key, "value": value} for key, value in provenance.items()]
    sections = [
        "<h2>Analysis and source basis</h2>"
        + _items([("Analysis", info["mode"]), ("Result schema", info["result_schema"]),
                  ("Reach count", project.nr), ("Species count", project.ns),
                  ("Total duration (days)", project.end_day), ("Project SHA256", project.fingerprint),
                  ("Presentation edition", REPORT_EDITION),
                  ("Recorded solver elapsed seconds", info["recorded_solver_elapsed_seconds"])], "Retained analysis identity")
        + _table(source_rows, [("item", "Provenance field"), ("value", "Original value")], "Original project provenance")
        + "<p>Concentrations and masses use each species' declared conserved basis. For example, nitrogen-basis mg/L is an elemental nitrogen concentration, not the molecular mass concentration of an ammonium or nitrate compound. Each reach is completely mixed at a fixed volume, with phasewise-constant linear coefficients. Times are model days from the project origin.</p>"]
    if identity:
        sections.append(_items(list(identity.items()), "Saved native result and source identities"))
    run = result.get("baseline", result)
    if "budgets" in run:
        sections.append("<h2>Conserved mass across the full duration</h2>"
            + _table(run["budgets"], [("basis", "Basis"), ("initial_kg", "Initial kg"), ("input_kg", "Added kg"),
                    ("final_storage_kg", "Final stored kg"), ("boundary_export_kg", "Exported kg"),
                    ("untracked_reaction_sink_kg", "Other sinks kg"), ("residual_kg", "Balance residual kg"),
                    ("relative_residual", "Relative balance residual")], "Integrated model mass account")
            + _items(list(run.get("numerics", {}).items()), "Original numerical execution metadata")
            + "<p>Boundary export and reaction extents are integrated over the full duration. These masses are not annual loads or endpoint concentration averages. A small budget residual describes numerical conservation of this model.</p>"
            + _table(run["final"], [("reach", "Reach"), ("species", "Species"), ("basis", "Basis"),
                    ("mg_l", "Final mg basis/L"), ("kg", "Final stored kg")], "Final reach conditions")
            + _table([{"day": sample["day"], **value} for sample in run.get("samples", []) for value in sample["values"]],
                    [("day", "Day"), ("reach", "Reach"), ("species", "Species"), ("basis", "Basis"),
                     ("mg_l", "mg basis/L"), ("kg", "Stored kg")], "Every retained sampled model state")
            + _table(run.get("boundary_export_by_state", []), [("reach", "Boundary reach"), ("species", "Species"),
                     ("basis", "Basis"), ("kg", "Integrated exported kg")], "Boundary exports by species")
            + _table(run.get("reactions", []), [("reaction", "Reaction"), ("reach", "Reach"), ("basis", "Basis"),
                     ("processed_kg", "Processed kg"), ("products_kg", "Product kg by species"),
                     ("untracked_sink_kg", "Untracked sink kg"), ("sink_label", "Sink")], "Integrated transformations"))
    if "sources" in result:
        source_budgets = [{"source": part["source_tag"], **value} for part in result["sources"] for value in part["result"]["budgets"]]
        sections.append("<h2>Source attribution</h2>"
            + _table(source_budgets, [("source", "Original source tag"), ("basis", "Basis"),
                     ("initial_kg", "Initial kg"), ("input_kg", "Added kg"), ("final_storage_kg", "Remaining kg"),
                     ("boundary_export_kg", "Exported kg"), ("untracked_reaction_sink_kg", "Other sinks kg")], "Each source propagated through the same original model")
            + _items(list(result.get("closure", {}).items()), "Original source-superposition closure"))
    if "observations" in result:
        observations = [_species(project, {**row, **_provenance(row.get("provenance"))}) for row in result["observations"]]
        sections.append("<h2>Parameter fit and held-out reference records</h2>"
            + _items([("Solver converged", result.get("converged")), ("Termination", result.get("termination")),
                      ("Loss", result.get("loss")), ("Retained optimizer cost", result.get("objective")),
                      ("Model evaluations", result.get("evaluations")), ("Fit records", info["fit_records"]),
                      ("Held-out records", info["held_out_records"]), ("Below-limit records", info["below_limit_records"]), ("Interval records", info["interval_records"]), ("Compound records", info["compound_records"])], "Actual saved optimizer outcome")
            + "<p>Fit and held-out labels are the original request roles. Held-out records did not enter the fit objective. Their independence and scientific meaning depend on the original source and sampling design shown below. The optimizer cost is one half the sum of the selected loss applied to squared error-standardized fit residuals. A below-limit record contributes zero when its modeled value is at or below its original limit and a positive standardized exceedance otherwise. An interval uses signed distance to the nearest endpoint divided by its error scale and zero distance within the limits. Exact open-endpoint membership is reported separately: an excluded endpoint has zero distance without being inside the declared interval. Weighted components operate on one conserved basis without mass conversion or automatic normalization.</p>"
            + _table(_parameters(project, result, request), [("id", "Parameter"), ("target", "Physical target"),
                     ("kind", "Field"), ("parameter_units", "Units"), ("basis", "Basis"), ("lower", "Lower bound"),
                     ("upper", "Upper bound"), ("original", "Original value"), ("fitted", "Fitted value"),
                     ("bound_meaning", "Final bound status"), ("source_reference", "Coefficient source")], "Retained fitted coefficients and supplied bounds")
            + _table([_species(project, row) for row in result.get("scores", [])],
                     [("role", "Role"), ("operator_label", "Measurement"), ("operator_expression", "Weighted pools"), ("basis", "Basis"), ("components", "Original components"), ("count", "Exact-valued records"),
                      ("rmse_mg_l", "RMSE (mg basis/L)"), ("bias_mg_l", "Mean modeled minus reference (mg basis/L)")],
                     "Original point scores grouped by exact operator; below-limit and interval records are excluded")
            + _table([_species(project, row) for row in result.get("interval_scores", [])],
                     [("role", "Role"), ("operator_label", "Measurement"), ("operator_expression", "Weighted pools"),
                      ("basis", "Basis"), ("components", "Original components"), ("count", "Interval records"),
                      ("predictions_within_declared_interval", "Predictions within declared limits"),
                      ("weighted_distance_to_interval_rmse", "RMS standardized distance to limits")],
                     "Interval support, separate from point RMSE")
            + _scatter(project, observations) + _intervals(project, observations)
            + _table(observations, [("id", "Record"), ("reach", "Reach"), ("operator_label", "Measurement"), ("operator_expression", "Weighted pools"), ("basis", "Basis"), ("components", "Original components"),
                     ("day", "Day"), ("role", "Role"), ("qualifier", "Original qualifier"),
                     ("observed_mg_l", "Point / below limit (mg basis/L)"), ("declared_interval", "Interval (mg basis/L)"),
                     ("lower_closed", "Includes lower"), ("upper_closed", "Includes upper"),
                     ("interval_contains_prediction", "Prediction within declared interval"), ("predicted_mg_l", "Modeled (mg basis/L)"),
                     ("sigma_mg_l", "Supplied error scale (mg basis/L)"), ("weighted_residual", "Objective residual"),
                     ("source_kind", "Source kind"), ("source_reference", "Original record source")], "Every original reference and retained prediction")
            + _items(list(result.get("identifiability", {}).items()), "Retained local identifiability result"))
    if "rows" in result:
        derivatives = []
        for item in result["rows"]:
            for derivative in item["derivatives"]:
                derivatives.append(_species(project, {**item["observation"], **derivative,
                                   "predicted_mg_l": item["predicted_mg_l"],
                                   "parameter_units": PARAMETER_UNITS.get(derivative.get("parameter_kind"))}))
        sections.append("<h2>Local coefficient sensitivity</h2>"
            + "<p>These are the saved forward-tangent derivatives at the supplied parameter values. Elasticity is the derivative multiplied by the parameter value and divided by the prediction; it is undefined when the prediction equals zero.</p>"
            + _table(derivatives, [("id", "Target"), ("reach", "Reach"), ("operator_label", "Measurement"), ("operator_expression", "Weighted pools"), ("basis", "Basis"), ("components", "Original components"),
                      ("day", "Day"), ("parameter", "Parameter"), ("parameter_units", "Parameter units"),
                      ("predicted_mg_l", "Prediction (mg basis/L)"), ("mg_l_per_parameter_unit", "Derivative (mg basis/L per parameter unit)"),
                      ("elasticity", "Elasticity")], "Every original local sensitivity"))
    if "selected" in result:
        choices = [_species(project, {**value["candidate"], "order": value["order"],
                   "predicted_mg_l": value["predicted_mg_l"], "incremental_logdet_gain": value["incremental_logdet_gain"]})
                   for value in result["selected"]]
        sections.append("<h2>Chemical-parameter monitoring design</h2>"
            + "<p>This local greedy selection uses the supplied candidate error scales, parameter values and prior precision. Its information gain describes that linearized parameter problem; selected candidates are proposed measurements. The precision-matrix row and column order is the parameter order below, and entry units are inverse products of those parameter units.</p>"
            + _items([("Method", result.get("method")), ("Requested candidate count", request.get("count")),
                      ("Selected count", len(choices)), ("Total log-determinant gain", result.get("total_logdet_gain")),
                      ("Original prior precision", result.get("prior_precision")),
                      ("Resulting linearized precision", result.get("posterior_linearized_precision"))], "Saved design assumptions and outcome")
            + _table(_parameters(project, result, request), [("id", "Parameter in matrix order"), ("target", "Target"),
                     ("parameter_units", "Units"), ("basis", "Basis"), ("lower", "Lower bound"), ("upper", "Upper bound")], "Original parameter order")
            + _table(choices, [("order", "Order"), ("id", "Candidate"), ("reach", "Reach"), ("operator_label", "Measurement"), ("operator_expression", "Weighted pools"),
                     ("basis", "Basis"), ("components", "Original components"), ("day", "Day"), ("sigma_mg_l", "Assumed error scale (mg basis/L)"),
                     ("predicted_mg_l", "Prediction (mg basis/L)"), ("incremental_logdet_gain", "Incremental log-determinant gain")], "Exact selected candidate records"))
    if "summaries" in result:
        priors = {value["id"]: value for value in result.get("distributions", [])}
        parameters = [{**value, "distribution": priors.get(value["id"])} for value in _parameters(project, result, request)]
        rows = [_species(project, {**value["observation"], **{k: v for k, v in value.items() if k != "observation"}})
                for value in result["summaries"]]
        sections.append("<h2>Parameter-prior ensemble</h2><p>" + _escape(result.get("interpretation")) + "</p>"
            + _items([("Completed parameter draws", result.get("draw_count")), ("Random seed", result.get("seed")),
                      ("Maximum relative mass-budget residual", result.get("maximum_relative_budget_residual")),
                      ("Latent Gaussian correlation, in parameter order", result.get("latent_gaussian_correlation"))], "Exact original ensemble specification")
            + "<p>The 5th and 95th percentiles span the central 90% of the completed parameter draws. The supplied priors and latent Gaussian correlation determine the ensemble; this matrix is not necessarily the Pearson correlation of the transformed physical parameters. Measurement error, structural error and uncertainties not varied in the request are outside these parameter-draw summaries.</p>"
            + _table(parameters, [("id", "Parameter in draw order"), ("target", "Target"), ("parameter_units", "Units"),
                      ("basis", "Basis"), ("lower", "Lower bound"), ("upper", "Upper bound"),
                      ("distribution", "Original distribution specification")], "Every supplied prior")
            + _table(rows, [("id", "Target"), ("reach", "Reach"), ("operator_label", "Measurement"), ("operator_expression", "Weighted pools"), ("basis", "Basis"), ("components", "Original components"),
                      ("day", "Day"), ("p05_mg_l", "5th percentile (mg basis/L)"), ("median_mg_l", "Median (mg basis/L)"),
                      ("p95_mg_l", "95th percentile (mg basis/L)"), ("mean_mg_l", "Mean (mg basis/L)")], "Original target-by-target ensemble quantiles"))
    sections.append(_input_sections(project))
    if links:
        sections.append("<h2>Complete retained inputs and outputs</h2><ul>"
                        + "".join("<li><a href='" + html.escape(path, quote=True) + "'>" + _escape(label) + "</a></li>"
                                  for label, path in links) + "</ul>")
    title = _escape(project.title)
    return ("<!doctype html><html lang='en'><head><meta charset='utf-8'>"
            "<meta name='viewport' content='width=device-width,initial-scale=1'><title>"
            + title + " — Chemistry scientific report</title><style>"
            "*{box-sizing:border-box}body{margin:0;background:#fff;color:#171717;font:15px/1.5 system-ui,sans-serif}"
            "main{max-width:1440px;margin:auto;padding:32px}header{border-bottom:2px solid #222;padding-bottom:18px}"
            "h1{font-size:29px;line-height:1.25}h2{margin-top:32px;font-size:22px}p{max-width:110ch}"
            ".scroll{overflow-x:auto}table{width:100%;border-collapse:collapse;margin:18px 0}th,td{padding:9px 11px;"
            "text-align:left;vertical-align:top;border-bottom:1px solid #ccc;font-variant-numeric:tabular-nums;"
            "overflow-wrap:anywhere}th{background:#ededed}caption{text-align:left;font-weight:600;margin-bottom:8px}"
            "details{margin-top:28px}summary{cursor:pointer;font-weight:600}.figures{display:flex;flex-wrap:wrap}"
            "figure{max-width:620px;flex:1 1 420px;margin:14px 12px 14px 0}svg{width:100%;height:auto}"
            "figcaption{font-size:13px}footer{border-top:1px solid #aaa;margin-top:32px;padding-top:14px}"
            "@media print{main{max-width:none;padding:0}.scroll{overflow:visible}table{font-size:9px}"
            "tr,figure{break-inside:avoid}h2{break-after:avoid}details{display:block}}"
            "</style></head><body><main><header><p>ECOSYSTEM SCIENCES / REACH CHEMISTRY</p><h1>"
            + title + "</h1><p>Scientific review of the completed chemical analysis and its original inputs.</p></header>"
            + "".join(sections) + "<footer>TokenJunkieLabs · " + _escape(REPORT_EDITION)
            + " · Original machine-readable results accompany this presentation.</footer></main></body></html>")
