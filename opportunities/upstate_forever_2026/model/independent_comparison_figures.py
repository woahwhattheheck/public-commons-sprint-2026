"""Saved independent comparison figures from complete original result and geometry.

No model fitting, raster aggregation, new observation or source acquisition.
Original numerical decisions stay with independent_comparison.py.
"""
from __future__ import annotations
from copy import deepcopy
import csv
from html import escape
import io
import math
from pathlib import Path

from .common import atomic_bytes, atomic_json, describe_file, digest, read_json, verify_file

EDITION = "independent-comparison-figures/1"
SCHEMA = "upstate.independent-comparison-figures/v1"
DATA_SCHEMA = "upstate.independent-comparison-figure-data/v1"
SPEC = "figures/figures.json"
DATA = "figures/figure-data.json"
CSV = "figures/pair-values.csv"
READER = "figures/index.html"
GEOMETRY = "figures/geometry.json"
PANEL_SIZE = 12  # Pagination only: every selected pair is retained and plotted.


def _require(condition, message):
    if not condition:
        raise ValueError(message)


def _number(value):
    return (not isinstance(value, bool) and isinstance(value, (int, float))
            and math.isfinite(value))


def _plain(value):
    # Canonical immutable source dictionaries cannot carry opaque geometry objects.
    from .common import canonical
    import json
    return json.loads(canonical(value))


def _source(directory, record):
    item = {key: record[key] for key in ("path", "bytes", "sha256")}
    verify_file(directory, item)
    return item


def geometry_data(directory, inputs, data, originals):
    """Read copied original catchments/companions; retain original and projected XY.

    This is the only geometry I/O. Every coordinate is transformed from the
    declared original CRS to the already selected native grid, with no repair,
    simplification, centroid, station inference or basemap.
    """
    from pyproj import CRS, Transformer
    import pyproj
    import fiona
    import shapely
    from shapely.geometry import mapping, shape
    from shapely.ops import transform
    from . import rasters, scientific_map_figures
    directory = Path(directory)
    choice = inputs["native_comparison"]["catchment_selection"]
    entry = inputs["catchment_entry"]
    expected = entry["body"]
    candidates = [r for r in originals if r["path"].startswith("originals/catchments/")
                  and r["original"] == expected]
    _require(len(candidates) == 1, "Retain exactly the original selected catchment body")
    selected_source = _source(directory, candidates[0])
    target = CRS.from_user_input(inputs["original_grid"]["grid"]["crs"])
    _require(target.is_projected and len(target.axis_info) >= 2
             and all(abs(a.unit_conversion_factor - 1) <= 1e-12 for a in target.axis_info[:2]),
             "Original comparison grid must retain projected metre coordinates")
    field = choice.get("id_field")
    _require(isinstance(field, str) and field, "Retain the original catchment ID field")
    features, native_crs = rasters.vector_geometry(
        directory / selected_source["path"], layer=choice.get("layer") or entry.get("layer"),
        where=choice.get("where"))
    indexed = {}
    for feature in features:
        key = feature["properties"].get(field)
        _require(key is not None and str(key) not in indexed,
                 "Original selected catchment IDs must stay unique and non-null")
        indexed[str(key)] = feature
    selected = sorted({p["native"]["catchment_id"] for p in data["pairs"]}
                      | {r["catchment_id"] for r in data["unpaired_native"]})
    transformer = Transformer.from_crs(native_crs, target, always_xy=True)
    bank, catchments, reaches, missing = {}, [], [], []
    def capture(original_geometry, source_crs, transform_to_grid):
        _require(not original_geometry.is_empty and original_geometry.is_valid,
                 "Retain valid original geometry; explicit source correction is required")
        projected = transform(transform_to_grid.transform, original_geometry)
        _require(not projected.is_empty and projected.is_valid,
                 "Original geometry is invalid in the retained native grid CRS")
        original = _plain(mapping(original_geometry))
        derived = _plain(mapping(projected))
        list(scientific_map_figures.positions(original))
        list(scientific_map_figures.positions(derived))
        key = digest(derived)
        bank[key] = derived
        return {"original_geometry": original, "geometry": key,
                "original_crs": CRS.from_user_input(source_crs).to_wkt(),
                "transformation": {"target_crs": target.to_wkt(), "always_xy": True,
                                   "definition": transform_to_grid.definition,
                                   "description": transform_to_grid.description,
                                   "accuracy": transform_to_grid.accuracy,
                                   "simplified": False, "repaired": False}}
    for key in selected:
        _require(key in indexed, "Selected native catchment geometry is absent: " + key)
        feature = indexed[key]
        geometry = feature["geometry"]
        _require(geometry.geom_type in ("Polygon", "MultiPolygon")
                 and math.isfinite(geometry.area) and geometry.area > 0,
                 "Selected native catchment must retain its valid positive polygon")
        catchments.append({"catchment_id": key, "feature_id": feature["id"],
                           "properties": _plain(feature["properties"]), "source": selected_source,
                           "selection": deepcopy(choice),
                           **capture(geometry, native_crs, transformer)})
    # Only actual selected reference companions may supply reference geometry.
    # Installed regional NLDI files are not joined by an arbitrary matching number.
    reference_ids = ({p["reference"]["catchment_id"] for p in data["pairs"]}
                     | {r["catchment_id"] for r in data["unpaired_reference"]})
    for record in originals:
        if (not record["path"].startswith("originals/reference/")
                or Path(record["path"]).suffix.lower() not in (".json", ".geojson")):
            continue
        source = _source(directory, record)
        value = read_json(directory / source["path"])
        if not isinstance(value, dict) or value.get("type") != "FeatureCollection":
            continue
        for index, feature in enumerate(value.get("features", [])):
            if not isinstance(feature, dict):
                continue
            properties = feature.get("properties") or {}
            if properties.get("source") != "comid":
                continue
            comid = properties.get("comid")
            if isinstance(comid, bool) or not isinstance(comid, (int, str)):
                continue
            key = str(comid)
            if key not in reference_ids:
                continue
            _require(str(properties.get("identifier")) == key and str(feature.get("id")) == key,
                     "Original NLDI reach identity is inconsistent")
            _require(properties.get("navigation") ==
                     "https://api.water.usgs.gov/nldi/linked-data/comid/" + key + "/navigation",
                     "Retain the original NLDI COMID reach provenance")
            _require(value.get("crs") is None,
                     "NLDI GeoJSON with a nonstandard CRS needs explicit source interpretation")
            geometry = shape(feature.get("geometry"))
            _require(geometry.geom_type in ("LineString", "MultiLineString"),
                     "Selected NLDI COMID source must retain its actual reach-line geometry")
            for position in scientific_map_figures.positions(_plain(mapping(geometry))):
                _require(-180 <= position[0] <= 180 and -90 <= position[1] <= 90,
                         "Original NLDI longitude/latitude is outside its declared source CRS")
            project = Transformer.from_crs("EPSG:4326", target, always_xy=True)
            captured = capture(geometry, "EPSG:4326", project)
            reaches.append({"catchment_id": key, "feature_index": index,
                            "source": source, "feature": deepcopy(feature),
                            "role": "NLDI NHDPlus reach line, not a station or catchment",
                            **captured})
    for key in sorted(reference_ids):
        if not any(r["catchment_id"] == key for r in reaches):
            missing.append({"catchment_id": key,
                "reason": "No matching literal NLDI COMID reach companion in the selected reference source; no reference station or area is inferred"})
    return {"schema": "upstate.independent-comparison-geometry/v1",
            "crs": {"wkt": target.to_wkt(), "name": target.to_string(), "units": "metre", "axes": "XY"},
            "native_selection": deepcopy(choice), "catchments": catchments,
            "reference_reaches": reaches, "missing_reference_geometry": missing,
            "geometries": bank,
            "runtime": {"pyproj": pyproj.__version__, "proj": pyproj.proj_version_str,
                        "fiona": fiona.__version__, "shapely": shapely.__version__},
            "meaning": "Copied original catchment geometry and associated reference reach lines transformed only for display in the original native grid. Geometry does not establish comparable support or change numerical decisions."}


def _axis(values, *, zero=False, symmetric=False):
    _require(values and all(_number(v) for v in values), "Plot only finite retained values")
    lo, hi = min(values), max(values)
    if symmetric:
        extent = max(abs(lo), abs(hi))
        extent = extent * 1.08 if extent else 1.0
        lo, hi = -extent, extent
    elif zero:
        lo, hi = min(0, lo), max(0, hi)
        hi = hi * 1.08 if hi > 0 else 1.0
    elif hi == lo:
        extent = max(abs(lo) * .08, 1.0)
        lo, hi = lo - extent, hi + extent
    else:
        pad = (hi - lo) * .08
        lo, hi = lo - pad, hi + pad
    _require(all(_number(v) for v in (lo, hi, hi - lo)) and hi > lo,
             "Retained values exceed a finite drawing scale")
    ticks = [{"value": lo + (hi - lo) * i / 4,
              "label": format(lo + (hi - lo) * i / 4, ".4g")} for i in range(5)]
    return {"domain": [lo, hi], "ticks": ticks}


def _table(rows):
    return {"kind": "table",
            "columns": ["Pair", "Constituent", "Native catchment", "Reference record",
                        "Original reference", "Original unit", "Converted reference",
                        "Native annual mass", "Native minus reference", "Common unit", "Decision"],
            "rows": [[p["id"], p["native"]["parameter"], p["native"]["catchment_id"],
                      p["reference"]["record_id"], p["reference"]["value"], p["reference"]["unit"],
                      p["converted_reference_value"], p["native"]["modeled_annual_mass"],
                      p["difference"], p["units"], p["decision"]] for p in rows],
            "caption": "Exact retained calculation values. Missing differences remain missing; context-only decisions are never promoted by their appearance in a figure."}


def _numeric(data, source):
    figures, unplotted = [], []
    for parameter in ("nitrogen", "phosphorus", "sediment"):
        pairs = [p for p in data["pairs"] if p["decision"] == "comparable"
                 and p["native"]["parameter"] == parameter]
        units = {p["units"] for p in pairs}
        _require(len(units) <= 1, "A constituent panel cannot mix original numerical units")
        for offset in range(0, len(pairs), PANEL_SIZE):
            rows = pairs[offset:offset + PANEL_SIZE]
            unit = rows[0]["units"]
            x = {"label": "Selected pair number; complete IDs in source table", "unit": "",
                 "domain": [-.5, len(rows) - .5],
                 "ticks": [{"value": i, "label": str(offset + i + 1)} for i in range(len(rows))]}
            for kind in ("paired-values", "differences"):
                identifier = kind + "-" + parameter + "-" + str(offset // PANEL_SIZE + 1)
                try:
                    values = ([p[key] for p in rows for key in ("converted_reference_value",)]
                              + [p["native"]["modeled_annual_mass"] for p in rows]
                              if kind == "paired-values" else [p["difference"] for p in rows])
                    y = _axis(values, zero=kind == "paired-values", symmetric=kind == "differences")
                except ValueError as error:
                    unplotted.append({"id": identifier, "pair_ids": [p["id"] for p in rows],
                                      "reason": str(error)})
                    continue
                y.update(label="Annual mass" if kind == "paired-values" else "Native minus reference", unit=unit)
                def point(i, p, value, role):
                    return {"x": i, "y": value, "pair_id": p["id"], "role": role,
                            "native_observation_id": p["native_observation_id"],
                            "reference_row_number": p["reference_row_number"],
                            "source_path": source["path"]}
                if kind == "paired-values":
                    series = [{"geometry": "scatter", "marker": "circle", "label": "Native",
                               "points": [point(i, p, p["native"]["modeled_annual_mass"], "native") for i, p in enumerate(rows)]},
                              {"geometry": "scatter", "marker": "square-open", "label": "Converted reference",
                               "points": [point(i, p, p["converted_reference_value"], "reference") for i, p in enumerate(rows)]}]
                    caption = "Filled circles are retained native annual mass; open squares are references converted by the original selected unit factor. Pair order is categorical, not time. No trend line, uncertainty interval, fit or independence is inferred."
                else:
                    series = [{"geometry": "scatter", "marker": "circle", "label": "Native minus reference",
                               "points": [point(i, p, p["difference"], "difference") for i, p in enumerate(rows)]}]
                    caption = "Signed differences are the original native minus converted reference values. The zero line denotes numerical agreement only. These are descriptive selected comparisons, not calibration or independent validation."
                title = parameter.title() + (" paired annual values" if kind == "paired-values" else " signed differences")
                caption += " Only explicitly comparable pairs are plotted. Original periods, support decisions, qualifiers and source lineage remain in the complete pair data."
                figures.append({"id": identifier, "kind": kind, "title": title, "caption": caption,
                                "parameter": parameter, "units": unit, "pair_ids": [p["id"] for p in rows],
                                "inputs": [deepcopy(source)], "detail_tables": [_table(rows)],
                                "panels": [{"title": title, "x": deepcopy(x), "y": y, "series": series,
                                            "reference_lines": ([{"axis": "y", "value": 0}] if kind == "differences" else [])}]})
    return figures, unplotted


def _maps(data, geometry, source):
    from .scientific_map_figures import positions
    figures = []
    associated = set()
    def make(catchment, reaches, rows, unpaired_native, unpaired_reference, page, group):
        layers, labels, seen = [], [], set()
        if catchment is not None:
            layers.append({"role": "contribution", "geometry": catchment["geometry"],
                           "source": catchment["source"], "receptor_id": catchment["catchment_id"]})
        for reach in reaches:
            key = (reach["geometry"], reach["catchment_id"], reach["source"]["sha256"])
            if key in seen:
                continue
            seen.add(key)
            layers.append({"role": "receptor", "geometry": reach["geometry"],
                           "source": reach["source"], "receptor_id": reach["catchment_id"]})
            # This is an original vertex used only to place a numbered label.
            # It is never exported or described as a monitoring station.
            anchor = list(next(positions(geometry["geometries"][reach["geometry"]])))[:2]
            labels.append({"label": "Reference reach " + reach["catchment_id"], "anchor": anchor})
        _require(layers, "A source map requires actual retained geometry")
        geometries = {row["geometry"]: geometry["geometries"][row["geometry"]] for row in layers}
        points = [p for value in geometries.values() for p in positions(value)]
        bounds = [min(p[0] for p in points), min(p[1] for p in points),
                  max(p[0] for p in points), max(p[1] for p in points)]
        pad = max(bounds[2] - bounds[0], bounds[3] - bounds[1]) * .06
        _require(_number(pad) and pad > 0, "Retain a finite positive source geometry extent")
        bounds = [bounds[0] - pad, bounds[1] - pad, bounds[2] + pad, bounds[3] + pad]
        title = (("Native catchment " + catchment["catchment_id"] +
                  (" — unpaired support" if not rows else "")) if catchment else
                 "Unpaired reference reach support")
        if page > 1:
            title += " — part " + str(page)
        caption = ("Gray area, where present, is an actual native catchment from the retained comparison source. Dark lines are literal NLDI reach companions from the selected reference source. They are associated only by the exact mapped reference catchment/COMID and are not station points or reference catchment polygons. "
                   "Numbered labels anchor to original line vertices solely for drawing placement. Full original/projected vertices, holes, source pins and transforms are retained without simplification or repair. Grid metres are not ground-distance corrections. Geometry does not establish equal support.")
        references = {p["reference"]["catchment_id"] for p in rows}
        missing = [r for r in geometry["missing_reference_geometry"] if r["catchment_id"] in references]
        if missing:
            caption += " No retained reference geometry for: " + ", ".join(r["catchment_id"] or "(blank)" for r in missing) + "."
        if unpaired_native or unpaired_reference:
            caption += " Unpaired records are displayed as coverage context only; no numerical pair or residual has been created."
        tables = [_table(rows)] if rows else []
        if unpaired_native:
            tables.append({"kind": "table",
                "columns": ["Unpaired native observation", "Catchment", "Constituent", "Native annual mass", "Unit", "Original support status"],
                "rows": [[r["observation_id"], r["catchment_id"], r["parameter"], r["modeled_annual_mass"],
                          r["units"], r["coverage_status"]] for r in unpaired_native],
                "caption": "Original native rows not selected in any comparison pair. Their original value and support remain unchanged."})
        if unpaired_reference:
            tables.append({"kind": "table",
                "columns": ["Unpaired reference row", "Record", "Catchment / COMID", "Constituent", "Original value", "Original unit"],
                "rows": [[r["row_number"], r["record_id"], r["catchment_id"], r["parameter"],
                          r["value"], r["unit"]] for r in unpaired_reference],
                "caption": "Original reference rows not selected in any comparison pair; source geometry remains context only."})
        figures.append({"id": "map-" + str(group) + "-" + str(page), "kind": "map", "title": title,
                        "caption": caption, "parameter": None, "units": "projected metres",
                        "pair_ids": [p["id"] for p in rows],
                        "unpaired_native_ids": [r["observation_id"] for r in unpaired_native],
                        "unpaired_reference_rows": [r["row_number"] for r in unpaired_reference],
                        "inputs": [deepcopy(source)], "geometries": geometries, "detail_tables": tables,
                        "panels": [{"kind": "projected_geometry_map", "title": title,
                                    "crs": deepcopy(geometry["crs"]), "bounds": bounds, "layers": layers,
                                    "role_labels": {"contribution": ("Native catchment" if catchment else "No associated native area"),
                                                    "receptor": "Original reference reach lines"},
                                    "legend": labels}]})
    for index, catchment in enumerate(geometry["catchments"], 1):
        rows = [p for p in data["pairs"] if p["native"]["catchment_id"] == catchment["catchment_id"]]
        unpaired = [r for r in data["unpaired_native"] if r["catchment_id"] == catchment["catchment_id"]]
        references = {p["reference"]["catchment_id"] for p in rows}
        reaches = [r for r in geometry["reference_reaches"] if r["catchment_id"] in references]
        # Duplicate copied source members retain their provenance in geometry.json;
        # identical source geometries need only one displayed numbered line.
        unique = {}
        for reach in reaches:
            unique.setdefault((reach["catchment_id"], reach["geometry"]), reach)
            associated.add((reach["catchment_id"], reach["geometry"]))
        reaches = list(unique.values())
        groups = [reaches[n:n + 6] for n in range(0, len(reaches), 6)] or [[]]
        for page, group in enumerate(groups, 1):
            keys = {r["catchment_id"] for r in group}
            original_unpaired = [r for r in data["unpaired_reference"] if r["catchment_id"] in keys]
            make(catchment, group, rows, unpaired, original_unpaired, page, index)
    # Reference rows without an associated native pair keep their own reach-only
    # panels; no native polygon or numeric pairing is invented.
    unique = {}
    for reach in geometry["reference_reaches"]:
        key = (reach["catchment_id"], reach["geometry"])
        if key not in associated:
            unique.setdefault(key, reach)
    reaches = list(unique.values())
    for index, offset in enumerate(range(0, len(reaches), 6), 1):
        group = reaches[offset:offset + 6]
        keys = {r["catchment_id"] for r in group}
        original_unpaired = [r for r in data["unpaired_reference"] if r["catchment_id"] in keys]
        make(None, group, [], [], original_unpaired, index, len(geometry["catchments"]) + 1)
    return figures


def specifications(data, geometry, comparison_source, geometry_source):
    """Pure figure specifications over the unchanged complete original calculation."""
    _require(data.get("schema") == "upstate.independent-comparison/v1",
             "Select the original independent comparison result")
    pairs = data.get("pairs")
    _require(isinstance(pairs, list) and len({p["id"] for p in pairs}) == len(pairs),
             "Retain distinct original pair IDs")
    numeric, unplotted = _numeric(data, comparison_source)
    maps = _maps(data, geometry, geometry_source)
    retained = {"schema": DATA_SCHEMA, "edition": EDITION, "title": data["selection"]["title"],
                "comparison_source": deepcopy(comparison_source), "geometry_source": deepcopy(geometry_source),
                "input_sha256": data["input_sha256"], "selection": deepcopy(data["selection"]),
                "pairs": deepcopy(pairs), "statistics": deepcopy(data["statistics"]),
                "counts": deepcopy(data["counts"]), "unpaired_native": deepcopy(data["unpaired_native"]),
                "unpaired_reference": deepcopy(data["unpaired_reference"]), "source_issues": deepcopy(data["source_issues"]),
                "geometry": deepcopy(geometry), "unplotted": unplotted,
                "context_only_pair_ids": [p["id"] for p in pairs if p["decision"] != "comparable"],
                "lineage": data["lineage"], "arithmetic": data["arithmetic"]}
    spec = {"schema": "upstate.scientific-figure-spec/v1", "edition": EDITION,
            "title": retained["title"], "rendering": {"width_points": 511.2},
            "figures": maps + numeric}
    return retained, spec


def _csv(data):
    stream = io.StringIO(newline="")
    fields = ["pair_id", "parameter", "native_observation_id", "native_catchment_id",
              "reference_row_number", "reference_record_id", "reference_catchment_id",
              "original_reference_value", "original_reference_unit", "conversion_factor",
              "converted_reference_value", "native_value", "difference", "relative_difference",
              "units", "requested_decision", "decision", "issues", "rationale",
              "native_period", "reference_period_start", "reference_period_end",
              "reference_definition", "native_original", "reference_original"]
    writer = csv.DictWriter(stream, fields, lineterminator="\n")
    writer.writeheader()
    from .common import canonical
    cell_json = lambda value: canonical(value).decode("utf-8")
    for pair in data["pairs"]:
        n, r = pair["native"], pair["reference"]
        writer.writerow({"pair_id": pair["id"], "parameter": n["parameter"],
            "native_observation_id": pair["native_observation_id"], "native_catchment_id": n["catchment_id"],
            "reference_row_number": pair["reference_row_number"], "reference_record_id": r["record_id"],
            "reference_catchment_id": r["catchment_id"], "original_reference_value": r["value"],
            "original_reference_unit": r["unit"], "conversion_factor": (pair["conversion"] or {}).get("factor"),
            "converted_reference_value": pair["converted_reference_value"], "native_value": n["modeled_annual_mass"],
            "difference": pair["difference"], "relative_difference": pair["relative_difference"],
            "units": pair["units"], "requested_decision": pair["requested_decision"], "decision": pair["decision"],
            "issues": cell_json(pair["issues"]), "rationale": pair["rationale"],
            "native_period": cell_json(n["native_period"]), "reference_period_start": r["period_start"],
            "reference_period_end": r["period_end"], "reference_definition": cell_json(r["definition"]),
            "native_original": cell_json(n), "reference_original": cell_json(r)})
    return stream.getvalue().encode("utf-8")


def _table_html(table):
    e = lambda x: escape("Unavailable" if x is None else str(x), quote=True)
    return ("<div class='scroll' tabindex='0'><table><thead><tr>" +
            "".join("<th>" + e(x) + "</th>" for x in table["columns"]) +
            "</tr></thead><tbody>" + "".join("<tr>" + "".join("<td>" + e(x) + "</td>" for x in row) +
            "</tr>" for row in table["rows"]) + "</tbody></table></div><p>" + e(table["caption"]) + "</p>")


def _reader(data, spec, svgs):
    e = lambda x: escape(str(x), quote=True)
    parts = ["<!doctype html><html lang='en'><head><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'>",
             "<title>" + e(data["title"]) + " — figures</title><style>",
             ":root{font:15px/1.5 system-ui;color:#202020;background:#fafaf8}*{box-sizing:border-box}body{margin:0}header,main{max-width:1200px;margin:auto;padding:24px}h1{font-size:26px;line-height:1.2}h2{font-size:20px}nav{display:flex;flex-wrap:wrap;gap:14px}a{color:inherit;overflow-wrap:anywhere}section{background:white;border:1px solid #bbb;padding:20px;margin:20px 0}.scroll{overflow:auto;max-width:100%;margin:12px 0}.scroll:focus-visible{outline:2px solid #222}.figure svg{display:block;width:100%;min-width:520px;height:auto}table{border-collapse:collapse;width:100%;font-size:14px}th,td{border:1px solid #bbb;padding:8px;text-align:left;vertical-align:top;overflow-wrap:anywhere}th{background:#eee}p,pre{overflow-wrap:anywhere}pre{white-space:pre-wrap}@media(max-width:600px){header,main{padding:12px}section{padding:12px}}@media print{header,main{padding:0;max-width:none}nav{display:none}section{break-before:page;border:0}.scroll{overflow:visible}.figure svg{min-width:0}table{font-size:9pt}}",
             "</style></head><body><header><h1>" + e(data["title"]) + "</h1>",
             "<p>Saved original comparison figures. Numeric panels retain only explicitly comparable pairs; maps do not change their scientific support. Context-only records remain complete below.</p><nav>",
             "<a href='../report.html'>Complete report</a><a download href='figure-data.json'>Complete pair and geometry data</a>",
             "<a download href='pair-values.csv'>All pair values and definitions</a><a download href='figures.json'>Figure specifications</a>",
             "<a download href='geometry.json'>Complete original and projected geometry</a><a download href='../original-files.json'>Complete original source inventory</a></nav></header><main>"]
    for figure in spec["figures"]:
        parts.extend(["<section><h2>" + e(figure["title"]) + "</h2><div class='scroll figure' tabindex='0'>",
                      svgs[figure["id"]], "</div><p>" + e(figure["caption"]) + "</p>",
                      "<p><a download href='" + e(figure["id"] + ".svg") + "'>Download complete SVG</a></p>"])
        parts.extend(_table_html(t) for t in figure["detail_tables"])
        parts.append("</section>")
    parts.append("<section><h2>All selected original pairs</h2>" + _table_html(_table(data["pairs"])) +
                 "<p>Reference lineage: " + e(data["lineage"]) + "</p></section>")
    for label, rows in (("Unpaired native rows", data["unpaired_native"]),
                        ("Unpaired reference rows", data["unpaired_reference"]),
                        ("Reference geometry unavailable", data["geometry"]["missing_reference_geometry"])):
        parts.append("<details><summary>" + e(label + " (" + str(len(rows)) + ")") +
                     "</summary><pre>" + e(__import__("json").dumps(rows, ensure_ascii=False, indent=2)) + "</pre></details>")
    for pair in data["pairs"]:
        parts.append("<details><summary>" + e(pair["id"] + " — " + pair["decision"]) +
                     "</summary><p>" + e(pair["rationale"]) + "</p><pre>" +
                     e(__import__("json").dumps(pair, ensure_ascii=False, indent=2)) + "</pre></details>")
    if data["unplotted"]:
        parts.append("<section><h2>Finite plotting limits</h2><pre>" +
                     e(__import__("json").dumps(data["unplotted"], ensure_ascii=False, indent=2)) + "</pre></section>")
    parts.append("</main></body></html>\n")
    return "".join(parts)


def prepare(directory, inputs, data, originals):
    """Add complete native vector figures before the original edition is published."""
    from reportlab import Version
    from reportlab.graphics import renderSVG
    from . import scientific_figures
    directory = Path(directory)
    geometry = geometry_data(directory, inputs, data, originals)
    atomic_json(directory / GEOMETRY, geometry, immutable=True)
    comparison = describe_file(directory, directory / "comparison.json")
    geometries = describe_file(directory, directory / GEOMETRY)
    retained, spec = specifications(data, geometry, comparison, geometries)
    retained["rendering"] = {"reportlab_version": Version, "width_points": 511.2}
    atomic_json(directory / DATA, retained, immutable=True)
    atomic_bytes(directory / CSV, _csv(retained), immutable=True)
    atomic_json(directory / SPEC, spec, immutable=True)
    choices, svgs = [], {}
    for item in spec["figures"]:
        drawings = scientific_figures.panel_drawings(item, 511.2)
        _require(len(drawings) == 1, "Retain one complete SVG per selected figure")
        value = renderSVG.drawToString(drawings[0])
        raw = value.encode("utf-8") if isinstance(value, str) else value
        text = raw.decode("utf-8")
        start = text.find("<svg")
        _require(start >= 0 and text.rstrip().endswith("</svg>"), "Native figure must be a complete SVG")
        name = "figures/" + item["id"] + ".svg"
        atomic_bytes(directory / name, raw, immutable=True)
        svgs[item["id"]] = text[start:]
        choices.append({key: item[key] for key in ("id", "kind", "title", "caption", "parameter", "units", "pair_ids")})
        choices[-1]["path"] = name
    atomic_bytes(directory / READER, _reader(retained, spec, svgs).encode("utf-8"), immutable=True)
    return {"schema": SCHEMA, "edition": EDITION, "title": retained["title"], "figures": choices,
            "reader": READER, "spec": SPEC, "data_path": DATA, "csv": CSV, "geometry_path": GEOMETRY}


def inspect(directory, inventory, data):
    """Read verified original figure files without regenerating an old edition."""
    directory = Path(directory)
    if DATA not in inventory:
        _require(not any(name.startswith("figures/") for name in inventory),
                 "Original figure inventory is incomplete")
        return None
    for name in (DATA, SPEC, CSV, READER, GEOMETRY):
        _require(name in inventory, "Retain the complete original figure deliverables")
    retained, spec = read_json(directory / DATA), read_json(directory / SPEC)
    geometry = read_json(directory / GEOMETRY)
    _require(retained.get("schema") == DATA_SCHEMA and spec.get("schema") == "upstate.scientific-figure-spec/v1"
             and retained.get("edition") == spec.get("edition") == EDITION,
             "Original figure source schema differs")
    _require(retained["geometry"] == geometry and retained["pairs"] == data["pairs"]
             and retained["input_sha256"] == data["input_sha256"] and retained["selection"] == data["selection"]
             and retained["statistics"] == data["statistics"] and retained["counts"] == data["counts"]
             and retained["unpaired_native"] == data["unpaired_native"]
             and retained["unpaired_reference"] == data["unpaired_reference"]
             and retained["source_issues"] == data["source_issues"],
             "Original figure data differs from the saved comparison")
    for key, name in (("comparison_source", "comparison.json"), ("geometry_source", GEOMETRY)):
        _require(retained[key] == describe_file(directory, directory / name), "Original plotted source changed")
    choices, ids = [], set()
    for item in spec["figures"]:
        _require(item["id"] not in ids and item["kind"] in ("map", "paired-values", "differences"),
                 "Original figure identity is ambiguous")
        ids.add(item["id"])
        path = "figures/" + item["id"] + ".svg"
        _require(path in inventory and all(pair in {p["id"] for p in data["pairs"]} for pair in item["pair_ids"]),
                 "Original figure source pairing or SVG is absent")
        choice = {key: item[key] for key in ("id", "kind", "title", "caption", "parameter", "units", "pair_ids")}
        choices.append({**choice, "path": path})
    return {"schema": SCHEMA, "edition": retained["edition"], "title": retained["title"],
            "figures": choices, "data": retained, "reader": READER,
            "spec": SPEC, "data_path": DATA, "csv": CSV, "geometry_path": GEOMETRY}
