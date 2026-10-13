"""Original geometry and completed-ledger quantities for Scientific Reports.

The native reducer remains authoritative. These figures read its completed
tables and original polygon input without opening rasters or repeating accounting.
"""
from __future__ import annotations

from copy import deepcopy
import math
from pathlib import Path

from .common import atomic_bytes, atomic_json, describe_file, digest, file_digest, read_json, verify_file

EDITION = "landcover-scientific-figures/1"
SPEC = "figures/landcover-figures.json"
GROUP_LABELS = {
    "developed": "Developed", "forest": "Forest", "wetland": "Wetland",
    "cultivated_crop": "Crops", "pasture_hay": "Pasture/hay",
    "water": "Water", "shrub": "Shrub", "herbaceous": "Herbaceous",
}


def implementation():
    from . import landcover_ledger, scientific_figures, scientific_map_figures
    modules = {"landcover_report_figures": Path(__file__),
               "landcover_ledger": Path(landcover_ledger.__file__),
               "scientific_figures": Path(scientific_figures.__file__),
               "scientific_map_figures": Path(scientific_map_figures.__file__)}
    return {name: {"path": str(path.resolve()), "sha256": file_digest(path)}
            for name, path in modules.items()}


def _number(value, *, minimum=None):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise ValueError("Land-cover figure needs its original finite numerical quantity")
    if minimum is not None and value < minimum:
        raise ValueError("Land-cover figure quantity is below its original domain")
    return value


def _axis(label, unit, low, high, ticks=None):
    return {"label": label, "unit": unit, "domain": [low, high],
            "ticks": ticks if ticks is not None else [
                {"value": low + (high - low) * index / 4,
                 "label": format(low + (high - low) * index / 4, ".4g")}
                for index in range(5)]}


def _figure(key, title, caption, panel, source, **metadata):
    return {"id": key, "title": title, "caption": caption, "panels": [panel],
            "source": deepcopy(source), **metadata}


def _numerical(report, labels, source):
    """Keep every original polygon point and native common-support quantity."""
    zones = report["zones"]
    zone_ids = [zone["id"] for zone in zones]
    keys = report["scenarios"]
    rows = {(row["zone_id"], row["scenario"]): row for row in report["rows"]}
    if (len(set(zone_ids)) != len(zone_ids) or zone_ids.count("__domain__") != 1
            or len(rows) != len(report["rows"])
            or set(rows) != {(zid, key) for zid in zone_ids for key in keys}
            or set(labels) != set(keys)):
        raise ValueError("Scientific figures need every original polygon/alternative row")
    figures, retained = [], []
    codes = sorted(int(code) for code in report["classes"])
    for number, key in enumerate(keys, 1):
        prefix = "comparison-" + format(number, "04d")
        description = labels[key]
        domain = rows[("__domain__", key)]
        support = _number(domain["support"]["analysis_valid_ha"], minimum=0)
        before = {code: [] for code in codes}
        after = {code: [] for code in codes}
        seen = set()
        for transition in domain["transitions"]:
            a, b = transition["from_code"], transition["to_code"]
            if (a, b) in seen or a not in before or b not in after:
                raise ValueError("Original transition matrix has a repeated or unknown class")
            seen.add((a, b))
            hectares = _number(transition["ha"], minimum=0)
            before[a].append(hectares)
            after[b].append(hectares)
        before = {code: math.fsum(values) for code, values in before.items()}
        after = {code: math.fsum(values) for code, values in after.items()}
        if not math.isclose(math.fsum(before.values()), support, rel_tol=3e-9, abs_tol=1e-7):
            raise ValueError("Original class transitions differ from their common support")
        class_rows = [{"class_code": code, "class_name": report["classes"][str(code)],
                       "baseline_ha": before[code] if support else None,
                       "comparison_ha": after[code] if support else None} for code in codes]
        height = max([*before.values(), *after.values(), 0.0])
        panel = {"title": "Unique study-area class areas",
                 "x": _axis("NLCD class code", "", -.7, len(codes) - .3,
                            [{"value": i, "label": str(code)} for i, code in enumerate(codes)]),
                 "y": _axis("Common-support area", "ha", 0, height * 1.08 if height else 1),
                 "series": [
                     {"geometry": "scatter", "label": "Reference", "marker": "circle-open",
                      "points": [{"x": i - .13, "y": before[code]} for i, code in enumerate(codes)] if support else []},
                     {"geometry": "scatter", "label": "Comparison", "marker": "square",
                      "points": [{"x": i + .13, "y": after[code]} for i, code in enumerate(codes)] if support else []},
                 ]}
        figures.append(_figure(prefix + "-classes", "Land-cover class areas", description +
            ". Areas are row/column sums of the original unique-union transition matrix on its "
            "selected common support. Reference is an open circle; comparison is a filled square. "
            "Full class names and exact values are retained in the figure-data file. " +
            ("The comparison has no supported area; class quantities are unavailable." if not support else ""),
            panel, source, scenario=key))
        groups = list(domain["groups"])
        group_rows, points = [], []
        for index, group in enumerate(groups):
            values = domain["groups"][group]
            row = {"group": group, **deepcopy(values)}
            group_rows.append(row)
            if values["net_ha"] is not None:
                points.append({"x": index, "y": _number(values["net_ha"]), "group": group})
        extent = max([abs(point["y"]) for point in points] + [0.0])
        extent = extent * 1.1 if extent else 1.0
        panel = {"title": "Unique study-area group change",
                 "x": _axis("Original class group", "", -.7, len(groups) - .3,
                            [{"value": i, "label": "G" + str(i + 1)} for i in range(len(groups))]),
                 "y": _axis("Comparison minus reference", "ha", -extent, extent),
                 "reference_lines": [{"axis": "y", "value": 0}],
                 "series": [{"geometry": "scatter", "label": "Net area change", "marker": "square", "points": points}]}
        group_key = "; ".join("G" + str(i + 1) + " " + GROUP_LABELS.get(group, group.replace("_", " "))
                              for i, group in enumerate(groups))
        figures.append(_figure(prefix + "-groups", "Net change by land-cover group", description +
            ". Positive values mean group gain; negative values mean loss on the selected common support. "
            "Groups retain the reducer's original definitions. " + group_key + ".",
            panel, source, scenario=key))
        polygon_rows, points = [], []
        for zone in zones:
            if zone["id"] == "__domain__":
                continue
            row = rows[(zone["id"], key)]
            coverage, changed = row["analysis_coverage_pct"], row["changed_pct_of_analysis"]
            original = {"zone_id": zone["id"], "zone_name": zone["name"],
                        "analysis_coverage_pct": coverage, "changed_pct_of_analysis": changed,
                        "analysis_valid_ha": row["support"]["analysis_valid_ha"],
                        "changed_ha": row["changed_ha"], "inside_grid_ha": zone["inside_grid_ha"]}
            polygon_rows.append(original)
            if coverage is None or changed is None:
                continue
            if any(not -.0000001 <= _number(value) <= 100.0000001 for value in (coverage, changed)):
                raise ValueError("Original coverage/change percentage is outside its numerical range")
            points.append({"x": coverage, "y": changed, "zone_id": zone["id"], "zone_name": zone["name"]})
        panel = {"title": "Every reporting polygon: support and change",
                 "x": _axis("Valid support / inside-grid area", "%", -.5, 100.5,
                            [{"value": i, "label": str(i)} for i in (0, 25, 50, 75, 100)]),
                 "y": _axis("Changed / valid support", "%", -.5, 100.5,
                            [{"value": i, "label": str(i)} for i in (0, 25, 50, 75, 100)]),
                 "series": [{"geometry": "scatter", "label": "Reporting polygon", "marker": "circle-open", "points": points}]}
        figures.append(_figure(prefix + "-support", "Reporting-area coverage and change", description +
            ". Each point is one original reporting polygon; overlapping marks can represent multiple polygons. "
            "The horizontal denominator is polygon area inside the raster, and the vertical denominator is "
            "that comparison's valid analysis support. " + str(len(points)) + " of " + str(len(polygon_rows)) +
            " polygons have both quantities; " + str(len(polygon_rows) - len(points)) +
            " with unavailable support remain in the complete data table. The unique-union row is separate. "
            "These percentages are land-cover quantities.",
            panel, source, scenario=key))
        retained.append({"scenario": key, "description": description,
                         "analysis_support_ha": support, "classes": class_rows,
                         "groups": group_rows, "polygons": polygon_rows})
    return figures, retained


def _geography(directory, report, source):
    from pyproj import CRS, Transformer
    from shapely.geometry import mapping
    from shapely.ops import transform as geometry_transform
    from .landcover_ledger import load_zones
    from .scientific_map_figures import positions
    original = directory / "ledger/zones-original.geojson"
    analysis_crs = CRS.from_user_input(report["grid"]["crs"])
    zones = load_zones(original, analysis_crs, id_field="_landcover_zone_id", name_field="_landcover_zone_name")
    original_rows = {row["id"]: row for row in report["zones"] if row["id"] != "__domain__"}
    if {zone.id for zone in zones} != set(original_rows):
        raise ValueError("Original map polygons differ from the completed ledger")
    metre = (analysis_crs.is_projected and len(analysis_crs.axis_info) >= 2
             and all(abs(axis.unit_conversion_factor - 1.0) <= 1e-12 for axis in analysis_crs.axis_info[:2]))
    # The maintained map renderer uses projected metres. Non-metre analysis CRSs
    # get a separately declared display projection; original accounting is kept.
    display_crs = analysis_crs if metre else CRS.from_epsg(6933)
    transform = None if metre else Transformer.from_crs(analysis_crs, display_crs, always_xy=True).transform
    source_file = describe_file(directory, original)
    geometries, layers, rows = {}, [], []
    xmin = ymin = math.inf
    xmax = ymax = -math.inf
    factor = _number(report["grid"]["coordinate_unit_to_m"], minimum=0) ** 2 / 10000
    for zone in zones:
        calculated = zone.geometry.area * factor
        if not math.isclose(calculated, original_rows[zone.id]["geometry_ha"], rel_tol=3e-9, abs_tol=1e-7):
            raise ValueError("Reopened original polygon area differs from its ledger")
        geometry = mapping(zone.geometry if transform is None else geometry_transform(transform, zone.geometry))
        # Normalize tuples exactly once for the native immutable JSON geometry bank.
        import json
        geometry = json.loads(json.dumps(geometry, allow_nan=False))
        key = digest(geometry)
        geometries[key] = geometry
        vertices = 0
        for point in positions(geometry):
            xmin, ymin = min(xmin, point[0]), min(ymin, point[1])
            xmax, ymax = max(xmax, point[0]), max(ymax, point[1])
            vertices += 1
        for role in ("contribution", "receptor"):
            layers.append({"geometry": key, "role": role, "receptor_id": zone.id, "source": source_file})
        rows.append({"zone_id": zone.id, "zone_name": zone.name, "geometry": key,
                     "vertices": vertices, "analysis_geometry_ha": original_rows[zone.id]["geometry_ha"]})
    span = max(xmax - xmin, ymax - ymin)
    if not math.isfinite(span) or span <= 0:
        raise ValueError("Original reporting geometry needs a positive display extent")
    margin = span * .04
    panel = {"kind": "projected_geometry_map", "title": "Original reporting polygons",
             "bounds": [xmin - margin, ymin - margin, xmax + margin, ymax + margin],
             "crs": {"name": display_crs.to_string(), "wkt": display_crs.to_wkt(), "units": "metre", "axes": "XY"},
             "layers": layers, "legend": [],
             "role_labels": {"contribution": "Reporting polygons", "receptor": "Original polygon boundaries"}}
    caption = (str(len(zones)) + " original reporting polygons, with every vertex and hole retained. "
               "The original ledger reader transforms the retained input to its analysis CRS; "
               "the reopened polygon areas match the saved ledger. " +
               ("The map uses that same projected grid." if metre else
                "The map is separately displayed in EPSG:6933; all area quantities retain the original analysis CRS.") +
               " The map identifies geographic scope; it does not encode change, pollutant export or flow direction. "
               "Original IDs, names, per-polygon geometry and source hashes remain in the retained specification.")
    figure = _figure("reporting-geography", "Original reporting geography", caption, panel, source,
                     geometries=geometries, polygons=rows,
                     analysis_crs=analysis_crs.to_wkt(), display_crs=display_crs.to_wkt(),
                     source_crs=read_json(original).get("crs"))
    return figure


def prepare(directory, edition, report, labels, expected_implementation):
    """Retain native vector figures alongside the already-copied original ledger."""
    from reportlab import Version as reportlab_version
    from reportlab.graphics import renderSVG
    from . import scientific_figures
    directory = Path(directory)
    implementation_now = implementation()
    if {key: value["sha256"] for key, value in implementation_now.items()} != expected_implementation:
        raise ValueError("Land-cover figure implementation changed after source selection")
    for name, descriptor in implementation_now.items():
        data = Path(descriptor["path"]).read_bytes()
        from hashlib import sha256
        if sha256(data).hexdigest() != descriptor["sha256"]:
            raise ValueError("Land-cover figure source changed during capture")
        atomic_bytes(directory / "implementation" / (name + ".py"), data, immutable=True)
    ledger = describe_file(directory, directory / "ledger/results/ledger.json")
    if read_json(directory / ledger["path"]) != report:
        raise ValueError("Scientific figures need the exact already-retained numerical ledger")
    if report.get("complete") is not True or edition.get("signature") != report.get("signature"):
        raise ValueError("Choose the completed original land-cover edition")
    figures, values = _numerical(report, labels, ledger)
    figures.insert(0, _geography(directory, report, ledger))
    data_path = "figures/landcover-figure-data.json"
    atomic_json(directory / data_path, {"schema": "upstate.landcover-figure-data/v1",
        "ledger_id": edition["id"], "signature": report["signature"], "ledger": ledger,
        "area_basis": report["grid"]["area_basis"], "support_scope": report["options"]["support_scope"],
        "comparisons": values}, immutable=True)
    spec = {"schema": "upstate.scientific-figure-spec/v1", "edition": EDITION,
            "title": edition["title"], "ledger_id": edition["id"], "signature": report["signature"],
            "implementation": expected_implementation,
            "rendering": {"reportlab_version": reportlab_version, "width_points": 511.2},
            "figure_data": describe_file(directory, directory / data_path), "figures": figures}
    atomic_json(directory / SPEC, spec, immutable=True)
    files = [describe_file(directory, directory / path) for path in (SPEC, data_path)]
    selections = []
    for figure in figures:
        drawings = scientific_figures.panel_drawings(figure, 511.2)
        if len(drawings) != 1:
            raise ValueError("Each saved land-cover figure needs one complete native panel")
        path = "figures/" + figure["id"] + ".svg"
        svg = renderSVG.drawToString(drawings[0])
        atomic_bytes(directory / path, svg.encode("utf-8") if isinstance(svg, str) else svg, immutable=True)
        files.append(describe_file(directory, directory / path))
        selections.append({"id": figure["id"], "path": path})
    files.extend(describe_file(directory, directory / "implementation" / (name + ".py"))
                 for name in sorted(implementation_now))
    for descriptor in files:
        verify_file(directory, descriptor)
    return {"figure_spec": SPEC, "figures": selections, "files": files,
            "summary": {"figure_count": len(figures), "comparisons": len(values),
                        "reporting_polygons": len(report["zones"]) - 1}}
