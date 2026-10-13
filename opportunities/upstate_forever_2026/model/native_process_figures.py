"""Original native-process figures using the maintained scientific vector renderer.

Every plotted scalar points into an immutable native process packet. Cases use
separate markers; no time interpolation or component stacking is performed.
"""
from __future__ import annotations
import importlib.metadata
import json
import math
import xml.etree.ElementTree as ET
from pathlib import Path

from .common import atomic_bytes, atomic_json, describe_file, digest, read_json, verify_file

SCHEMA = "upstate.scientific-figure-spec/v1"
FIGURE_EDITION = "native-process-figures/1"


def _finite(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def _ticks(values):
    lower, upper = min([0.0, *values]), max([0.0, *values])
    if lower == upper:
        upper = lower + 1.0
    span = upper - lower
    lower = lower - span * .08 if lower < 0 else 0.0
    upper = upper + span * .12
    step = (upper - lower) / 4
    return [lower, upper], [
        {"value": lower + i * step, "label": format(lower + i * step, ".4g")}
        for i in range(5)
    ]


def _point(value, x, descriptor, pointer, **identity):
    if not _finite(value):
        return None
    return {"x": x, "y": value, "source": {
        **descriptor, "json_pointer": pointer, **identity,
    }}


def _panel(title, unit, cases, series, *, y_label="Annual mass"):
    retained = [row for row in series if row["points"]]
    values = [point["y"] for row in retained for point in row["points"]]
    if not values:
        return None
    domain, ticks = _ticks(values)
    return {
        "title": title,
        "x": {"label": "Selected native case", "domain": [0.5, len(cases) + 0.5],
              "ticks": [{"value": i + 1, "label": row["label"]}
                        for i, row in enumerate(cases)]},
        "y": {"label": y_label, "unit": unit, "domain": domain, "ticks": ticks},
        "series": retained,
        "reference_lines": ([{"axis": "y", "value": 0, "label": "No change"}]
                            if y_label == "Alternative - baseline" else []),
    }


def _quantity_series(packets, cases, watershed_key, names, descriptors):
    series = []
    markers = ("circle", "square-open", "triangle", "diamond-open")
    offsets = [(.0 if len(names) == 1 else (i - (len(names)-1)/2) * .12)
               for i in range(len(names))]
    for number, (name, label) in enumerate(names):
        points = []
        for position, packet in enumerate(packets):
            indexed = [(i, row) for i, row in enumerate(packet["watersheds"])
                       if row["key"] == watershed_key]
            if not indexed:
                continue
            wi, watershed = indexed[0]
            indexed_quantities = [(i, row) for i, row in enumerate(watershed["quantities"])
                                  if row["quantity"] == name]
            if not indexed_quantities:
                continue
            qi, quantity = indexed_quantities[0]
            point = _point(
                quantity["value"], position + 1 + offsets[number],
                descriptors[(packet["run_id"], packet["model"])],
                "/watersheds/" + str(wi) + "/quantities/" + str(qi) + "/value",
                run_id=packet["run_id"], model=packet["model"],
                watershed=watershed_key, quantity=name, units=quantity["units"],
                value_basis=quantity["basis"],
            )
            if point is not None:
                points.append(point)
        series.append({"geometry": "scatter", "label": label,
                       "marker": markers[number % len(markers)], "points": points})
    return series


def _packet_cases(packets, ordinals):
    return [{"label": "R" + str(ordinals[p["run_id"]]), "run_id": p["run_id"],
             "profile_id": p["selection"]["profile_id"],
             "scenario_id": p["selection"]["scenario_id"]} for p in packets]


def _label(watershed):
    for name in ("name", "NAME", "ws_name", "watershed", "ws_id"):
        value = watershed.get("properties", {}).get(name)
        if value not in (None, ""):
            return str(value)
    return "Native feature " + str(watershed["native_feature_id"])


def _caption(cases, detail):
    roster = "; ".join(row["label"] + " = " + row["run_id"] for row in cases)
    return detail + " Case identities: " + roster + "."


def specification(selection, packets, comparisons, descriptors, comparison_descriptors):
    """Build numeric figures exclusively from retained original packet values."""
    figures, omitted = [], []
    ordinals = {run_id: index for index, run_id in enumerate(selection["run_ids"])}
    for model in selection["models"]:
        selected = [packet for packet in packets if packet["model"] == model]
        # All selected watershed geometries are already reconciled by the producer.
        # If a later standalone caller passes missing geometry, keep each actual
        # watershed and make missing case points absent instead of inventing zeros.
        watersheds = {}
        for packet in selected:
            for watershed in packet["watersheds"]:
                watersheds.setdefault(watershed["key"], watershed)
        for key, watershed in watersheds.items():
            for offset in range(0, len(selected), 8):
                group = selected[offset:offset+8]
                cases = _packet_cases(group, ordinals)
                if model == "ndr":
                    definitions = [
                        ("Nitrogen watershed quantities", [
                            ("nitrogen_load", "Load"), ("n_total_export", "Export"),
                            ("nitrogen_retention", "Retained")]),
                        ("Nitrogen pathways", [
                            ("n_surface_load", "Surface load"), ("n_subsurface_load", "Subsurface load"),
                            ("n_surface_export", "Surface export"), ("n_subsurface_export", "Subsurface export")]),
                        ("Phosphorus watershed quantities", [
                            ("p_surface_load", "Load"), ("p_surface_export", "Export"),
                            ("phosphorus_retention", "Retained")]),
                    ]
                    unit = "kg/year"
                    detail = ("Original native watershed load and export, with watershed retention "
                              "derived as load minus export. Separate markers show separate quantities; "
                              "they are not stacked. Retention belongs to the whole watershed and does "
                              "not identify the pixels where it occurred.")
                else:
                    definitions = [
                        ("Sediment process quantities", [
                            ("usle_tot", "Soil loss"), ("sed_export", "Export"),
                            ("sed_dep", "Deposition")]),
                        ("Sediment retention services", [
                            ("avoid_eros", "Avoided erosion"), ("avoid_exp", "Avoided export")]),
                    ]
                    unit = "metric_tonnes/year"
                    detail = ("Original native watershed outputs. Soil loss, stream export, "
                              "deposition, avoided erosion and avoided export are distinct processes "
                              "or services, not additive parts of a closed mass budget.")
                panels = []
                for title, names in definitions:
                    panel = _panel(title, unit, cases, _quantity_series(
                        group, cases, key, names, descriptors))
                    if panel is None:
                        omitted.append({"model": model, "watershed": key, "panel": title,
                                        "run_ids": [p["run_id"] for p in group],
                                        "reason": "No finite retained native quantity for this panel"})
                    else:
                        panels.append(panel)
                if panels:
                    figures.append({
                        "id": model + "-quantities-" + key + "-" + str(offset),
                        "title": model.upper() + " | " + _label(watershed),
                        "caption": _caption(cases, detail),
                        "scope": "original_native_model_domain_watershed",
                        "watershed_key": key, "model": model, "cases": cases, "panels": panels,
                    })
        paired = [row for row in comparisons if row["model"] == model]
        if not paired:
            continue
        fields = ([("n_total_export", "Nitrogen"), ("p_surface_export", "Phosphorus")]
                  if model == "ndr" else [("sed_export", "Sediment")])
        for key, watershed in watersheds.items():
            for offset in range(0, len(paired), 8):
                group = paired[offset:offset+8]
                cases = [{"label": "R" + str(ordinals[row["alternative_run_id"]]),
                          "run_id": row["alternative_run_id"],
                          "baseline_run_id": row["baseline_run_id"]} for row in group]
                panels = []
                for field, label in fields:
                    mass = [
                        {"geometry": "scatter", "label": "Whole watershed", "marker": "circle", "points": []},
                        {"geometry": "scatter", "label": "Shared cells", "marker": "square-open", "points": []},
                    ]
                    coverage = [
                        {"geometry": "scatter", "label": "Baseline valid", "marker": "circle", "points": []},
                        {"geometry": "scatter", "label": "Alternative valid", "marker": "triangle", "points": []},
                        {"geometry": "scatter", "label": "Shared valid", "marker": "square-open", "points": []},
                    ]
                    for ci, comparison in enumerate(group):
                        match = [(i, row) for i, row in enumerate(comparison["watersheds"])
                                 if row["key"] == key]
                        if not match:
                            continue
                        wi, row = match[0]
                        descriptor = comparison_descriptors[(comparison["alternative_run_id"], model)]
                        prefix = "/watersheds/" + str(wi)
                        identity = {"model": model, "watershed": key, "quantity": field,
                                    "baseline_run_id": comparison["baseline_run_id"],
                                    "alternative_run_id": comparison["alternative_run_id"]}
                        changed = [(i, q) for i, q in enumerate(row["changes"]) if q["quantity"] == field]
                        if changed:
                            qi, quantity = changed[0]
                            point = _point(quantity["change"], ci + 1 - .08, descriptor,
                                           prefix + "/changes/" + str(qi) + "/change", **identity)
                            if point is not None:
                                mass[0]["points"].append(point)
                        support = row["paired_support"].get(field)
                        if support is None:
                            continue
                        base = prefix + "/paired_support/" + field
                        point = _point(support.get("common_change"), ci + 1 + .08,
                                       descriptor, base + "/common_change", **identity)
                        if point is not None:
                            mass[1]["points"].append(point)
                        values = [
                            (support["sources"][0]["valid_area_ha"], "/sources/0/valid_area_ha"),
                            (support["sources"][1]["valid_area_ha"], "/sources/1/valid_area_ha"),
                            (support["common_area_ha"], "/common_area_ha"),
                        ]
                        for si, (value, pointer) in enumerate(values):
                            point = _point(value, ci + 1 + (si-1)*.12, descriptor,
                                           base + pointer, **identity)
                            if point is not None:
                                coverage[si]["points"].append(point)
                    unit = "kg/year" if model == "ndr" else "metric_tonnes/year"
                    delta = _panel(label + " export change", unit, cases, mass,
                                   y_label="Alternative - baseline")
                    area = _panel(label + " comparison support", "ha", cases, coverage,
                                  y_label="Valid area")
                    panels.extend(panel for panel in (delta, area) if panel is not None)
                if panels:
                    figures.append({
                        "id": model + "-comparison-" + key + "-" + str(offset),
                        "title": model.upper() + " scenario comparison | " + _label(watershed),
                        "caption": _caption(cases,
                            "Each alternative is compared with R0. Negative mass change means "
                            "less modeled export. Whole-watershed change retains the native zonal "
                            "totals; shared-cell change compares exactly the finite cells valid in "
                            "both runs for that constituent. The support panels show each original "
                            "valid area and its paired intersection; different constituents may "
                            "have different masks. These quantities are not added across watersheds."),
                        "scope": "paired_original_native_watershed_and_finite_common_pixels",
                        "watershed_key": key, "model": model, "cases": cases, "panels": panels,
                    })
    return {"schema": SCHEMA, "edition": FIGURE_EDITION, "title": selection["title"],
            "case_order": [{"label": "R" + str(index), "run_id": run_id}
                           for index, run_id in enumerate(selection["run_ids"])],
            "figures": figures, "omitted_panels": omitted}


def produce(directory, selection, packets, comparisons, descriptors, comparison_descriptors):
    """Save complete numeric specs/SVG with recoverable per-figure progress."""
    from reportlab.graphics import renderSVG
    from reportlab.graphics.shapes import Drawing, Group
    from .scientific_figures import panel_drawings, _validate_figure

    spec = specification(selection, packets, comparisons, descriptors, comparison_descriptors)
    atomic_json(directory / "figures/specification.json", spec, immutable=True)
    input_id = digest(spec)
    progress_path = directory / ".figure-progress.json"
    progress = read_json(progress_path) if progress_path.exists() else {
        "schema": "upstate.native-process-figure-progress/v1", "input_id": input_id, "files": {}}
    if progress["input_id"] != input_id:
        raise ValueError("Retained native process figure selection differs")
    figures, blocks = [], []
    width, gap = 511.2, 12.0
    for figure in spec["figures"]:
        _validate_figure(figure)
        relative = "figures/" + figure["id"] + ".svg"
        record = progress["files"].get(figure["id"])
        if record is not None:
            verify_file(directory, record)
        else:
            drawings = panel_drawings(figure, width)
            height = sum(float(panel.height) for panel in drawings) + gap * max(0, len(drawings)-1)
            drawing = Drawing(width, height)
            cursor = height
            for panel in drawings:
                cursor -= float(panel.height)
                group = Group()
                for child in panel.contents:
                    group.add(child)
                group.translate(0, cursor)
                drawing.add(group)
                cursor -= gap
            encoded = renderSVG.drawToString(drawing)
            svg = ET.fromstring(encoded)
            ns = "http://www.w3.org/2000/svg"
            ET.register_namespace("", ns)
            for index, (name, text) in enumerate((
                    ("title", figure["title"]), ("desc", figure["caption"]),
                    ("metadata", json.dumps({"schema": SCHEMA, "figure": figure},
                                            ensure_ascii=False, sort_keys=True)))):
                element = ET.Element("{" + ns + "}" + name)
                element.text = text
                svg.insert(index, element)
            svg.set("data-original-figure-sha256", digest(figure))
            encoded = ET.tostring(svg, encoding="utf-8", xml_declaration=True)
            # Only an unfinished, uncheckpointed SVG is replaceable. Completed
            # figure bytes are verified and reused above.
            atomic_bytes(directory / relative, encoded)
            record = describe_file(directory, directory / relative)
            progress["files"][figure["id"]] = record
            atomic_json(progress_path, progress)
        figures.append({"id": figure["id"], "path": relative})
        blocks.append({"kind": "figure", **record, "title": figure["title"],
                       "caption": figure["caption"], "alt": figure["caption"], "spec": figure})
    rendering = {
        "schema": "upstate.native-process-figure-rendering/v1", "input_id": input_id,
        "reportlab_version": importlib.metadata.version("reportlab"),
        "renderer": describe_file(Path(__file__).parent, Path(__file__).with_name("scientific_figures.py")),
        "figure_count": len(figures), "panel_count": sum(len(f["panels"]) for f in spec["figures"]),
        "files": list(progress["files"].values()),
    }
    atomic_json(directory / "figures/rendering.json", rendering, immutable=True)
    return {"figure_spec": "figures/specification.json", "figures": figures, "blocks": blocks,
            "figure_count": rendering["figure_count"], "panel_count": rendering["panel_count"]}
