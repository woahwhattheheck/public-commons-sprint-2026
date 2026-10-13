"""Original-catchment residual layers and atlases from completed calibration."""
from __future__ import annotations

import argparse
from collections import Counter
import csv
import html
import io
import json
import math
from pathlib import Path

from .common import (atomic_bytes, atomic_json, describe_file, digest, finite, held,
                     identifier, read_json, verify_file)
from . import calibration_uncertainty as uncertainty

VERSION = 1
RESULT_KIND = "calibration-maps"
UNITS = {"nitrogen": "kg/year", "phosphorus": "kg/year",
         "sediment": "metric_tonnes/year"}
FIELDS = (
    "feature_id", "unit_id", "catchment_id", "source_feature_id", "station_ids",
    "run_id", "profile_id", "candidate_title", "parameter", "units", "partition",
    "native_coverage", "observed_annual_mass", "native_annual_mass",
    "delivered_external_annual_mass", "predicted_annual_mass", "residual",
    "absolute_residual", "relative_residual_percent", "normalization_scale",
    "normalized_residual", "reference_lower", "reference_upper",
    "minimum_residual", "maximum_residual", "source_error_state",
    "missing_error_records", "standard_errors", "valid_cells",
    "structural_stream_omission_cells", "unexpected_missing_cells",
    "source_record_ids", "source_periods", "source_methods",
    "source_qualifiers", "source_uncertainty", "native_support_issues",
)
MEANING = (
    "Each feature is the exact selected original upstream catchment, transformed "
    "only for its declared display CRS. Its attributes come from one saved "
    "catchment/pollutant calibration unit and completed native candidate. "
    "Residual is predicted annual load minus the original time-weighted annual "
    "reference, with the original delivered external load shown separately. "
    "Nested and overlapping catchments remain separate; their loads and residuals "
    "must not be added as independent regional totals. The selected candidate's "
    "held-out units are descriptive. Challenger layers contain calibration units "
    "only. Missing native support remains null, not zero. Source-SE intervals "
    "retain the original uncertainty supplement's fixed-objective interpretation."
)


def _json(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"),
                      allow_nan=False)


def _number(value, name, *, minimum=None, positive=False):
    return finite(value, name, minimum=minimum, positive=positive)


def _same(a, b, label):
    if digest(a) != digest(b):
        raise ValueError(label + " differs from the retained original calibration")


def _text(value):
    return html.escape(str(value), quote=True)


def _display(value):
    if value is None:
        return "unavailable"
    if isinstance(value, (int, float)):
        return format(value, ".7g")
    return str(value)


def _csv_cell(value):
    # Match the existing operator's spreadsheet text-cell convention. Numeric
    # signed residuals remain numeric; complete originals remain in JSON.
    if isinstance(value, str) and value[:1] in ("=", "+", "-", "@", "\t", "\r"):
        return "'" + value
    return "" if value is None else value


def _csv(rows):
    out = io.StringIO(newline="")
    writer = csv.DictWriter(out, fieldnames=FIELDS, lineterminator="\n", extrasaction="raise")
    writer.writeheader()
    for row in rows:
        writer.writerow({key: _csv_cell(row.get(key)) for key in FIELDS})
    return out.getvalue().encode("utf-8")


def _selection(workspace, calibration_id, uncertainty_id, candidate_run_ids):
    report, plan, observed = uncertainty._retained(workspace, identifier(calibration_id))
    by_run = {row["run_id"]: row for row in report["ranked_candidates"]}
    ids = [report["selected_run_id"]] if candidate_run_ids is None else list(candidate_run_ids)
    if (not ids or any(not isinstance(key, str) for key in ids)
            or len(set(ids)) != len(ids) or set(ids) - set(by_run)):
        raise ValueError("Choose each eligible completed calibration candidate at most once")
    if report["selected_run_id"] not in ids:
        raise ValueError("Retain the originally selected candidate in the geographic review")
    # Stable original rank order, regardless of checkbox order.
    ids = [row["run_id"] for row in report["ranked_candidates"] if row["run_id"] in ids]
    detail = None
    if uncertainty_id is not None:
        detail = uncertainty.inspect(workspace, identifier(uncertainty_id))
        if detail["calibration_id"] != report["id"]:
            raise ValueError("Select the source-error supplement for this exact calibration")
    selected = {
        "version": VERSION, "workspace_id": workspace.project["id"],
        "calibration_id": report["id"], "plan_id": plan["id"],
        "uncertainty_id": detail["id"] if detail else None,
        "candidate_run_ids": ids, "selected_run_id": report["selected_run_id"],
        "catchments": plan["selection"]["catchments"],
        "observation_id": observed["id"],
        "reference_units_sha256": digest(plan["units"]),
        "prediction_rows_sha256": digest(report["prediction_rows"]),
        "output_coordinates": "EPSG:4326", "atlas_coordinates": "original selected model grid",
        "validation_scope": "originally selected candidate only",
    }
    return selected, report, plan, observed, detail


def _geometry(workspace, selection, plan, report):
    from pyproj import CRS, Transformer
    from shapely.geometry import mapping
    from shapely.ops import transform
    from . import rasters

    chosen = selection["catchments"]
    source, entry = workspace.source_file(chosen["source_collection_id"], chosen["source_id"])
    if entry["kind"] != "vector":
        raise ValueError("The retained observation catchment source is not a vector")
    original = plan["spatial_groups"]["source"]
    if entry["body"]["sha256"] != original["sha256"]:
        raise ValueError("The original calibration catchment source edition changed")
    features, source_crs = rasters.vector_geometry(
        source, layer=chosen.get("layer") or entry.get("layer"), where=chosen.get("where"))
    needed = {unit["catchment_id"] for unit in plan["units"]}
    index = {}
    field = chosen["id_field"]
    for feature in features:
        key = feature["properties"].get(field)
        if key is None or str(key) in index:
            raise ValueError("The original selected catchment identity must remain unique and non-null")
        index[str(key)] = feature
    missing = sorted(needed - set(index))
    if missing:
        raise ValueError("Original calibration catchments are absent: " + ", ".join(missing))
    selected = next(row for row in report["ranked_candidates"]
                    if row["run_id"] == report["selected_run_id"])
    grid = workspace.get_grid(selected["grid_id"])
    atlas_crs = CRS.from_user_input(grid["grid"]["crs"])
    if (not atlas_crs.is_projected
            or any(abs(axis.unit_conversion_factor - 1) > 1e-12 for axis in atlas_crs.axis_info[:2])):
        raise ValueError("The saved native atlas grid must use projected metres")
    to_geo = Transformer.from_crs(source_crs, "EPSG:4326", always_xy=True)
    to_atlas = Transformer.from_crs(source_crs, atlas_crs, always_xy=True)
    result = {}
    for key in sorted(needed):
        feature = index[key]
        geometry = feature["geometry"]
        if geometry.geom_type not in ("Polygon", "MultiPolygon") or geometry.is_empty or not geometry.is_valid:
            raise ValueError("A retained calibration catchment is not a valid original polygon")
        geographic = transform(to_geo.transform, geometry)
        atlas = transform(to_atlas.transform, geometry)
        if (not geographic.is_valid or not atlas.is_valid
                or not all(math.isfinite(v) for v in (*geographic.bounds, *atlas.bounds))
                or atlas.area <= 0):
            raise ValueError("Original catchment reprojection produced invalid display geometry")
        result[key] = {
            "feature_id": feature["id"], "properties": feature["properties"],
            "geographic": mapping(geographic), "atlas": atlas,
        }
    bounds = [min(row["atlas"].bounds[0] for row in result.values()),
              min(row["atlas"].bounds[1] for row in result.values()),
              max(row["atlas"].bounds[2] for row in result.values()),
              max(row["atlas"].bounds[3] for row in result.values())]
    return result, {
        "selection": chosen, "uri": entry["uri"], "vintage": entry["vintage"],
        "body": entry["body"], "companions": entry.get("companions", []),
        "source_crs": CRS.from_user_input(source_crs).to_wkt(),
        "output_crs": "EPSG:4326", "atlas_crs": atlas_crs.to_wkt(),
        "atlas_crs_name": atlas_crs.to_string(), "atlas_bounds": bounds,
        "geometry_policy": "Original complete polygon parts and rings; projection only, no rasterization, union, clipping or simplification.",
    }


def _rows(report, plan, observed, detail, geometry, selected_runs):
    observations = {row["id"]: row for row in observed["rows"]}
    refs = {row["id"]: row for row in plan["units"]}
    bands = {row["unit_id"]: row for row in detail["reference_units"]} if detail else {}
    prediction = {}
    for row in report["prediction_rows"]:
        key = (row["run_id"], row["unit_id"])
        if key in prediction:
            raise ValueError("The original calibration repeats a native prediction identity")
        prediction[key] = row
    groups = []
    for candidate in report["ranked_candidates"]:
        if candidate["run_id"] not in selected_runs:
            continue
        for parameter in report["objective"]:
            values = []
            for unit in refs.values():
                if unit["parameter"] != parameter:
                    continue
                if candidate["run_id"] != report["selected_run_id"] and unit["partition"] != "calibration":
                    continue
                native = prediction.get((candidate["run_id"], unit["id"]))
                included = bool(native and native.get("included"))
                if unit["partition"] == "calibration" and not included:
                    raise ValueError("An eligible candidate lacks the original complete calibration support")
                source_rows = [observations[key] for key in unit["observation_record_ids"]]
                expected = _number(unit["observed_annual_mass"], "Original annual reference", minimum=0)
                predicted = (_number(native["predicted_annual_mass"], "Native compared annual load", minimum=0)
                             if included else None)
                residual = predicted - expected if included else None
                scale = _number(report["normalization"][parameter]["value"], "Original normalization", positive=True)
                band = bands.get(unit["id"])
                lower, upper = (band.get("lower_reference"), band.get("upper_reference")) if band else (None, None)
                support = native.get("native_support", {}) if native else {}
                row = {
                    "feature_id": digest({"run_id": candidate["run_id"], "unit_id": unit["id"]}),
                    "unit_id": unit["id"], "catchment_id": unit["catchment_id"],
                    "source_feature_id": geometry[unit["catchment_id"]]["feature_id"],
                    "station_ids": _json(unit["station_ids"]), "run_id": candidate["run_id"],
                    "profile_id": candidate["profile_id"], "candidate_title": candidate.get("title") or candidate["profile_id"],
                    "parameter": parameter, "units": unit["units"], "partition": unit["partition"],
                    "native_coverage": "complete" if included else "incomplete",
                    "observed_annual_mass": expected,
                    "native_annual_mass": native.get("native_annual_mass") if included else None,
                    "delivered_external_annual_mass": unit["delivered_external_annual_mass"],
                    "predicted_annual_mass": predicted, "residual": residual,
                    "absolute_residual": abs(residual) if residual is not None else None,
                    "relative_residual_percent": 100 * residual / expected if residual is not None and expected > 0 else None,
                    "normalization_scale": scale,
                    "normalized_residual": residual / scale if residual is not None else None,
                    "reference_lower": lower, "reference_upper": upper,
                    "minimum_residual": predicted - upper if included and upper is not None else None,
                    "maximum_residual": predicted - lower if included and lower is not None else None,
                    "source_error_state": band["state"] if band else "no_supplement_selected",
                    "missing_error_records": _json(band["missing_record_ids"]) if band else None,
                    "standard_errors": detail["standard_errors"] if detail else None,
                    "valid_cells": support.get("valid_cells"),
                    "structural_stream_omission_cells": support.get("structural_stream_omission_cells"),
                    "unexpected_missing_cells": support.get("unexpected_missing_cells"),
                    "source_record_ids": _json(unit["observation_record_ids"]),
                    "source_periods": _json(unit["periods"]), "source_methods": _json(unit["reference_methods"]),
                    "source_qualifiers": _json([row.get("qualifier") for row in source_rows]),
                    "source_uncertainty": _json(unit["reference_uncertainty"]),
                    "native_support_issues": _json(native.get("issues", []) if native else ["Original comparison has no retained prediction row"]),
                }
                if unit["units"] != UNITS[parameter]:
                    raise ValueError("Original calibration pollutant units differ")
                for name, value in row.items():
                    if isinstance(value, float) and not math.isfinite(value):
                        raise ValueError("A derived map attribute exceeds finite range: " + name)
                values.append(row)
            if values:
                groups.append({"run_id": candidate["run_id"], "profile_id": candidate["profile_id"],
                               "title": candidate.get("title") or candidate["profile_id"],
                               "selected_models": candidate.get("selected_models"), "parameter": parameter,
                               "units": UNITS[parameter], "rows": values})
    return groups


def _parts(geometry):
    return [geometry] if geometry.geom_type == "Polygon" else list(geometry.geoms)


def _svg_path(geometry, bounds, box):
    left, bottom, right, top = bounds
    x, y, width, height = box
    scale = min(width / max(right - left, 1e-12), height / max(top - bottom, 1e-12))
    ox, oy = x + (width - (right - left) * scale) / 2, y + (height - (top - bottom) * scale) / 2
    path = []
    for polygon in _parts(geometry):
        for ring in [polygon.exterior, *polygon.interiors]:
            coords = list(ring.coords)
            if not coords:
                continue
            converted = [(ox + (point[0] - left) * scale, oy + (top - point[1]) * scale) for point in coords]
            path.append("M " + " L ".join(format(px, ".7f") + "," + format(py, ".7f") for px, py in converted) + " Z")
    return " ".join(path)


def _shade(value, cap):
    if value is None:
        return "#ffffff"
    fraction = min(abs(value) / cap, 1) if cap > 0 else 0
    gray = round(244 - 135 * fraction)
    return "#" + format(gray, "02x") * 3


def _atlas_svg(group, rows, geometry, context, cap, page, pages):
    width, height = 1200, 1680
    parts = [
        '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1680" viewBox="0 0 1200 1680" role="img">',
        "<title>" + _text(group["parameter"] + " original-catchment residual atlas") + "</title>",
        '<rect width="1200" height="1680" fill="white"/>',
        '<g font-family="Arial, sans-serif" fill="#202020">',
        '<text x="48" y="48" font-size="16">UPPER SAVANNAH · ORIGINAL CATCHMENT CALIBRATION</text>',
        '<text x="48" y="86" font-size="28">' + _text(group["parameter"].title() + " · " + group["units"]) + "</text>",
        '<text x="48" y="116" font-size="16">' + _text(group["title"][:120]) + "</text>",
        '<text x="48" y="143" font-size="14">Residual = predicted annual load − original annual reference. Signed numbers carry direction.</text>',
        '<text x="48" y="167" font-size="14">Absolute residual: light gray = zero, white = unavailable; darker = ' + _text(_display(cap)) + " " + _text(group["units"]) + ".</text>",
        '<text x="48" y="191" font-size="14">Each panel retains its complete original catchment. Nested catchments are not added or rasterized.</text>',
    ]
    for index, row in enumerate(rows):
        column, line = index % 2, index // 2
        x, y = 48 + 566 * column, 216 + 444 * line
        geom = geometry[row["catchment_id"]]["atlas"]
        bounds = geom.bounds
        dash = ' stroke-dasharray="7 5"' if row["partition"] == "validation" else ""
        parts.extend([
            '<rect x="' + str(x) + '" y="' + str(y) + '" width="538" height="422" fill="white" stroke="#777"' + dash + "/>",
            '<text x="' + str(x+14) + '" y="' + str(y+25) + '" font-size="17">' + _text(row["catchment_id"][:62]) + "</text>",
            '<text x="' + str(x+14) + '" y="' + str(y+47) + '" font-size="13">' + _text(row["partition"] + " · native support " + row["native_coverage"]) + "</text>",
            '<path d="' + _svg_path(geom, bounds, (x+14, y+61, 510, 216)) + '" fill="' + _shade(row["residual"], cap) + '" fill-rule="evenodd" stroke="#202020" stroke-width="1"/>',
        ])
        labels = [
            "Observed " + _display(row["observed_annual_mass"]) + " · predicted " + _display(row["predicted_annual_mass"]),
            "Native " + _display(row["native_annual_mass"]) + " · external " + _display(row["delivered_external_annual_mass"]),
            "Residual " + _display(row["residual"]) + " " + row["units"],
            "Source range " + _display(row["reference_lower"]) + " to " + _display(row["reference_upper"]),
            "Map span " + _display((bounds[2]-bounds[0])/1000) + " × " + _display((bounds[3]-bounds[1])/1000) + " km · original projected grid",
        ]
        for offset, label in enumerate(labels):
            parts.append('<text x="' + str(x+14) + '" y="' + str(y+302+23*offset) + '" font-size="13">' + _text(label) + "</text>")
    parts.extend([
        '<text x="48" y="1580" font-size="13">Solid frame: calibration. Dashed frame: held-out selected-candidate evaluation.</text>',
        '<text x="48" y="1603" font-size="13">Panels have their own extent; exact span is shown. North follows the original projected grid.</text>',
        '<text x="48" y="1626" font-size="12">' + _text("Atlas CRS: " + context["atlas_crs_name"] + " · native run " + group["run_id"][:20]) + "</text>",
        '<text x="48" y="1649" font-size="12">' + _text("Page " + str(page) + " / " + str(pages) + " · full source periods and original IDs in companion CSV/JSON") + "</text>",
        "</g></svg>",
    ])
    return "\n".join(parts).encode("utf-8")


def _pdf_atlas(path, group, geometry, context, cap):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from matplotlib.backends.backend_pdf import PdfPages
    from matplotlib.path import Path as PlotPath
    from matplotlib.patches import PathPatch
    from shapely.geometry.polygon import orient
    metadata = {"Title": group["parameter"].title() + " original-catchment residual atlas",
                "Author": "Upper Savannah scientific workspace",
                "Subject": MEANING, "CreationDate": None, "ModDate": None}
    completion = path.with_name(path.stem + "-pdf-complete.json")
    if completion.exists():
        verify_file(path.parent, read_json(completion))
        return
    pending = path.with_name("." + path.name + ".partial")
    try:
        with PdfPages(pending, metadata=metadata) as pdf:
            rows = group["rows"]
            for start in range(0, len(rows), 6):
                fig, axes = plt.subplots(3, 2, figsize=(8.27, 11.69))
                try:
                    fig.suptitle(group["parameter"].title() + " · " + group["units"] + "\n" + group["title"], fontsize=11)
                    for ax in axes.flat:
                        ax.set_visible(False)
                    for ax, row in zip(axes.flat, rows[start:start+6]):
                        ax.set_visible(True)
                        geom = geometry[row["catchment_id"]]["atlas"]
                        for raw in _parts(geom):
                            polygon = orient(raw, sign=1.0)
                            vertices, codes = [], []
                            for ring in [polygon.exterior, *polygon.interiors]:
                                coords = list(ring.coords)
                                vertices.extend([(p[0], p[1]) for p in coords])
                                codes.extend([PlotPath.MOVETO] + [PlotPath.LINETO]*(len(coords)-2) + [PlotPath.CLOSEPOLY])
                            ax.add_patch(PathPatch(PlotPath(vertices, codes),
                                                   facecolor=_shade(row["residual"], cap),
                                                   edgecolor="#202020", linewidth=.6))
                        ax.autoscale_view()
                        ax.set_aspect("equal")
                        ax.set_xticks([]); ax.set_yticks([])
                        for spine in ax.spines.values():
                            spine.set_linestyle("--" if row["partition"] == "validation" else "-")
                            spine.set_edgecolor("#777777")
                        ax.set_title(row["catchment_id"] + " · " + row["partition"], fontsize=8)
                        ax.set_xlabel(
                            "Observed " + _display(row["observed_annual_mass"]) + " · predicted " + _display(row["predicted_annual_mass"])
                            + "\nResidual " + _display(row["residual"]) + " " + row["units"]
                            + "\nNative " + _display(row["native_annual_mass"]) + " · external " + _display(row["delivered_external_annual_mass"])
                            + "\nSource range " + _display(row["reference_lower"]) + " to " + _display(row["reference_upper"]),
                            fontsize=7)
                    fig.text(.05, .028, "Residual = predicted − observed; grayscale = absolute residual up to "
                             + _display(cap) + " " + group["units"] + ".\n"
                             "Complete original polygons; each panel has its own extent. Dashed frame: held-out selected candidate.\n"
                             "Original projected grid " + context["atlas_crs_name"] + " · no regional summation of nested catchments.",
                             fontsize=6.5)
                    fig.subplots_adjust(top=.9, bottom=.095, hspace=.85, wspace=.18)
                    pdf.savefig(fig)
                finally:
                    plt.close(fig)
        atomic_bytes(path, pending.read_bytes(), immutable=True)
        atomic_json(completion, describe_file(path.parent, path), immutable=True)
    finally:
        pending.unlink(missing_ok=True)


def _page_html(layers, interpretation):
    sections = []
    for layer in layers:
        pages = "".join('<figure><img src="' + _text(item["path"]) + '" alt="' +
                        _text(layer["title"] + " complete original catchments") + '"/></figure>'
                        for item in layer["svg_pages"])
        links = " · ".join('<a href="' + _text(layer[name]["path"]) + '">' + label + "</a>"
                           for name, label in (("geojson", "Original geometry and residual attributes"),
                                               ("csv", "Complete numeric table"), ("pdf", "Print-ready PDF atlas")))
        sections.append("<section><h2>" + _text(layer["title"]) + "</h2><p>" + links + "</p>" + pages + "</section>")
    return ('<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Original catchment calibration maps</title>'
            '<style>body{font:15px system-ui,sans-serif;color:#202020;background:white;max-width:1100px;margin:auto;padding:32px}'
            'p{line-height:1.55}a{color:#202020}img{width:100%;height:auto}figure{margin:24px 0}'
            'section{border-top:1px solid #aaa;padding-top:20px}@media print{body{padding:0}figure{break-after:page}h1,p{orphans:3}}</style>'
            '</head><body><h1>Original catchment calibration maps</h1><p>' + _text(interpretation) +
            '</p><p>Separate pollutant units are retained. The complete source bindings, original periods and native coverage are in '
            '<a href="provenance.json">provenance.json</a>.</p>' + "".join(sections) + "</body></html>").encode("utf-8")


def prepare(workspace, calibration_id, *, uncertainty_id=None, candidate_run_ids=None):
    """Materialize source-bound original-catchment layers and residual atlases."""
    selection, report, plan, observed, detail = _selection(
        workspace, calibration_id, uncertainty_id, candidate_run_ids)
    selection_id = digest(selection)
    directory = workspace.root / "calibration-map-exports" / selection_id
    directory.mkdir(parents=True, exist_ok=True)
    with held(directory / ".maps.lock", blocking=False):
        pointer = directory / "result.json"
        if pointer.exists():
            previous = read_json(pointer)
            return inspect(workspace, previous["map_id"])
        atomic_json(directory / "selection.json", selection, immutable=True)
        geometry, context = _geometry(workspace, selection, plan, report)
        groups = _rows(report, plan, observed, detail, geometry, selection["candidate_run_ids"])
        caps = {parameter: max((abs(row["residual"]) for group in groups if group["parameter"] == parameter
                                for row in group["rows"] if row["residual"] is not None), default=0.0)
                for parameter in report["objective"]}
        provenance = {
            "schema": "upstate.calibration-map-provenance/v1", "selection": selection,
            "original_catchments": context, "observation_original": observed["original"],
            "observation_metadata": observed["metadata"], "source_vintages": report["source_vintages"],
            "original_catchment_properties": {key: row["properties"] for key, row in geometry.items()},
            "reference_units": plan["units"], "prediction_rows": report["prediction_rows"],
            "objective": report["objective"], "normalization": report["normalization"],
            "temporal_method": report["temporal_method"], "comparison_ids": report["comparison_ids"],
            "source_error_interpretation": detail["interpretation"] if detail else None,
            "interpretation": MEANING, "absolute_residual_display_caps": caps,
        }
        atomic_json(directory / "provenance.json", provenance, immutable=True)
        originals = {
            "original-calibration.json": workspace.root / "calibrations" / (report["id"] + ".json"),
            "original-calibration-plan.json": workspace.root / "calibration-plans" / (plan["id"] + ".json"),
            "original-observation-edition.json": workspace.root / "observations" / (observed["id"] + ".json"),
            "original-observations.csv": workspace.root / observed["original"]["object"],
        }
        if detail:
            originals["original-source-uncertainty.json"] = workspace.root / "calibration-uncertainties" / (detail["id"] + ".json")
        for name, path in originals.items():
            atomic_bytes(directory / name, path.read_bytes(), immutable=True)
        layers, entries = [], []
        for group in groups:
            key = digest({"run_id": group["run_id"], "parameter": group["parameter"]})
            stem = group["parameter"] + "-" + group["run_id"]
            features = [{"type": "Feature", "id": row["feature_id"],
                         "properties": row, "geometry": geometry[row["catchment_id"]]["geographic"]}
                        for row in group["rows"]]
            geojson_path = directory / (stem + ".geojson")
            atomic_json(geojson_path, {"type": "FeatureCollection",
                                      "name": stem, "features": features}, immutable=True)
            csv_path = directory / (stem + ".csv")
            atomic_bytes(csv_path, _csv(group["rows"]), immutable=True)
            pdf_path = directory / (stem + ".pdf")
            checkpoint_path = directory / (stem + "-completed.json")
            if checkpoint_path.exists():
                checkpoint = read_json(checkpoint_path)
                if checkpoint.get("selection_id") != selection_id or checkpoint.get("layer_id") != key:
                    raise ValueError("A retained atlas checkpoint belongs to another scientific selection")
                for artifact in checkpoint["files"]:
                    verify_file(directory, artifact)
            else:
                _pdf_atlas(pdf_path, group, geometry, context, caps[group["parameter"]])
            page_count = (len(group["rows"]) + 5) // 6
            svg_pages = []
            for start in range(0, len(group["rows"]), 6):
                page = start // 6 + 1
                path = directory / (stem + "-page-" + str(page) + ".svg")
                atomic_bytes(path, _atlas_svg(group, group["rows"][start:start+6], geometry, context,
                                              caps[group["parameter"]], page, page_count), immutable=True)
                svg_pages.append(describe_file(directory, path))
            complete_files = [describe_file(directory, path) for path in (geojson_path, csv_path, pdf_path)] + svg_pages
            atomic_json(checkpoint_path, {"selection_id": selection_id, "layer_id": key,
                                         "files": complete_files}, immutable=True)
            source_id = "calibration-" + key
            layer_title = group["parameter"].title() + " residuals · " + group["title"] + " · " + group["units"]
            count = Counter(row["partition"] for row in group["rows"])
            layers.append({
                "id": key, "source_id": source_id, "run_id": group["run_id"], "profile_id": group["profile_id"],
                "selected_models": group["selected_models"], "parameter": group["parameter"], "units": group["units"],
                "title": layer_title, "rows": len(group["rows"]),
                "calibration_rows": count["calibration"], "validation_rows": count["validation"],
                "incomplete_native_rows": sum(row["native_coverage"] != "complete" for row in group["rows"]),
                "geojson": describe_file(directory, geojson_path), "csv": describe_file(directory, csv_path),
                "pdf": describe_file(directory, pdf_path), "svg_pages": svg_pages,
                "absolute_residual_display_cap": caps[group["parameter"]],
            })
            entries.append({
                "id": source_id, "kind": "vector", "role": "CALIBRATION_RESIDUAL_CATCHMENTS",
                "title": layer_title, **describe_file(directory, geojson_path),
                "uri": "urn:upstate:calibration:" + report["id"] + ":residuals:" + key,
                "vintage": "Original retained calibration " + report["id"],
                "source_crs": "EPSG:4326", "units": group["units"], "id_field": "feature_id",
                "purpose": "context", "metric": "calibration_residual_" + group["parameter"],
                "direction": "predicted annual load minus original annual reference",
                "gis_context_group": selection_id,
                "calibration": {"id": report["id"], "plan_id": plan["id"], "run_id": group["run_id"],
                                "profile_id": group["profile_id"], "uncertainty_id": selection["uncertainty_id"]},
            })
        atomic_bytes(directory / "index.html", _page_html(layers, MEANING), immutable=True)
        context_names = ["selection.json", "provenance.json", "index.html", *originals]
        context_names.extend(layer["geojson"]["path"] for layer in layers)
        context_names.extend(layer["csv"]["path"] for layer in layers)
        context_names.extend(layer["pdf"]["path"] for layer in layers)
        context_names.extend(item["path"] for layer in layers for item in layer["svg_pages"])
        entries.append({
            "id": "calibration-context-" + selection_id, "kind": "document",
            "title": "Original calibration results, reference rows and residual atlas",
            "path": "index.html", "sha256": describe_file(directory, directory / "index.html")["sha256"],
            "companions": [describe_file(directory, directory / name) for name in context_names if name != "index.html"],
            "uri": "urn:upstate:calibration:" + report["id"],
            "vintage": "Original retained calibration " + report["id"],
            "gis_context_group": selection_id, "gis_required_context": True,
        })
        manifest = {"schema": "upstate.sources/v1", "title": report["title"] + " · original catchment residuals",
                    "entries": entries, "scope": {"calibration_maps": selection},
                    "notes": [MEANING, "Vector attributes retain numeric fields; nested polygons remain separate original catchments."]}
        atomic_json(directory / "source-manifest.json", manifest, immutable=True)
        collection = workspace.import_sources(directory / "source-manifest.json")
        from .spatial import SpatialReview
        review = SpatialReview(workspace)
        catalog = review.catalog()
        for layer in layers:
            found = [row for row in catalog["layers"] if row.get("source_collection_id") == collection["id"]
                     and row.get("source_id") == layer["source_id"]]
            if len(found) != 1:
                raise ValueError("The original Spatial review did not register the residual vector source")
            layer["source_collection_id"] = collection["id"]
            layer["spatial_selection"] = {"layer_id": found[0]["id"]}
            layer["view"] = {"crs": context["atlas_crs_name"], "bounds": context["atlas_bounds"]}
        files = [describe_file(directory, path) for path in sorted(directory.iterdir())
                 if path.is_file() and not path.name.startswith(".") and path.name != "result.json"]
        result = workspace._save(RESULT_KIND, {
            "version": VERSION, "workspace_id": workspace.project["id"], "state": "complete",
            "title": report["title"] + " · original catchment residuals",
            "selection_id": selection_id, "selection": selection,
            "calibration_id": report["id"], "plan_id": plan["id"], "uncertainty_id": selection["uncertainty_id"],
            "selected_run_id": report["selected_run_id"], "selected_profile_id": report["selected_profile_id"],
            "source_collection_id": collection["id"], "layers": layers,
            "directory": directory.relative_to(workspace.root).as_posix(), "files": files,
            "original_catchments": context, "interpretation": MEANING,
            "gis_selection": {
                "title": report["title"] + " · calibration residual GIS",
                "sources": [{"source_collection_id": collection["id"], "source_id": layer["source_id"],
                             "visible": index == 0, "group": "Calibration residuals"}
                            for index, layer in enumerate(layers)],
                "project_crs": context["atlas_crs_name"], "include_grid": False,
                "notes": [MEANING, "The per-pollutant atlas supplies signed residual figures; original vector sources retain complete editable attributes."],
            },
        })
        atomic_json(pointer, {"map_id": result["id"]}, immutable=True)
        return result


def inspect(workspace, map_id):
    """Verify maps, original scientific dependencies and registered source bodies."""
    result = workspace._get(RESULT_KIND, identifier(map_id))
    if result.get("version") != VERSION or result.get("workspace_id") != workspace.project["id"]:
        raise ValueError("Select this workspace's retained calibration map edition")
    selected, report, plan, observed, detail = _selection(
        workspace, result["calibration_id"], result["uncertainty_id"], result["selection"]["candidate_run_ids"])
    _same(selected, result["selection"], "Calibration map selection")
    if digest(selected) != result["selection_id"]:
        raise ValueError("The retained calibration map selection ID changed")
    directory = workspace.root / "calibration-map-exports" / result["selection_id"]
    if result["directory"] != directory.relative_to(workspace.root).as_posix():
        raise ValueError("Calibration map artifact directory differs")
    for file in result["files"]:
        verify_file(directory, file)
    collection = workspace._get("sources", result["source_collection_id"])
    for entry in collection["entries"]:
        workspace.source_file(collection["id"], entry["id"])
    catchment = plan["selection"]["catchments"]
    _, original = workspace.source_file(catchment["source_collection_id"], catchment["source_id"])
    if original["body"]["sha256"] != result["original_catchments"]["body"]["sha256"]:
        raise ValueError("The original calibration catchment source changed")
    return result


def save_review(workspace, map_id, layer_id):
    """Save an ordinary source-bound spatial review with exact holdout overlays."""
    from .spatial import SpatialReview
    result = inspect(workspace, map_id)
    found = [layer for layer in result["layers"] if layer["id"] == layer_id]
    if len(found) != 1:
        raise ValueError("Choose a retained residual map layer")
    layer = found[0]
    selection = layer["spatial_selection"]
    overlays = []
    for partition, style, count in (("calibration", "solid", layer["calibration_rows"]),
                                    ("validation", "dash", layer["validation_rows"])):
        if count:
            overlays.append({"selection": {**selection, "where": {"partition": partition}},
                             "label": partition.title() + " · " + layer["parameter"] + " · " + layer["units"],
                             "visible": True, "style": style, "width": 1.25, "opacity": 1.0})
    review = SpatialReview(workspace).save({
        "title": layer["title"], "reference": selection, "view": layer["view"],
        "mode": "single", "primary": None, "comparison": None,
        "overlays": overlays, "markers": [], "notes": MEANING + "\nCalibration map edition " + result["id"],
    })
    return workspace._save("calibration-map-reviews", {
        "version": VERSION, "workspace_id": workspace.project["id"],
        "map_id": result["id"], "layer_id": layer["id"], "review_id": review["id"],
        "source_collection_id": result["source_collection_id"], "source_id": layer["source_id"],
    })


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("workspace")
    commands = parser.add_subparsers(dest="action", required=True)
    create = commands.add_parser("prepare")
    create.add_argument("calibration_id")
    create.add_argument("--uncertainty-id")
    create.add_argument("--candidate-run-id", action="append")
    show = commands.add_parser("inspect")
    show.add_argument("map_id")
    review = commands.add_parser("save-review")
    review.add_argument("map_id"); review.add_argument("layer_id")
    args = parser.parse_args(argv)
    from .workspace import Workspace
    workspace = Workspace(args.workspace)
    if args.action == "prepare":
        result = prepare(workspace, args.calibration_id, uncertainty_id=args.uncertainty_id,
                         candidate_run_ids=args.candidate_run_id)
    elif args.action == "save-review":
        result = save_review(workspace, args.map_id, args.layer_id)
    else:
        result = inspect(workspace, args.map_id)
    print(json.dumps(result, indent=2, sort_keys=True, allow_nan=False))


if __name__ == "__main__":
    main()
