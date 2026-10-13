"""Projected source-water maps from retained original Esri watershed products.

Uses the maintained original Esri reader and shared scientific-map renderer.
The original source body stays authoritative; ring interpretation and repairs
are described separately from the untouched source coordinates.
"""
from __future__ import annotations

from copy import deepcopy
import json
from pathlib import Path

from .common import (atomic_bytes, atomic_json, describe_file, digest,
                     read_json, verify_file)

SCHEMA = "upstate.receptor-report-maps/v1"
SPEC = "figures/source-water-map-spec.json"
INVENTORY = "figures/source-water-map-members.json"
READER = "figures/original-geometry-reader.json"
APPLICATION = Path(__file__).resolve().parents[1]


def runtime():
    """Bind the actual installed renderer and geometry interpreter before naming an edition."""
    import pyproj
    import shapely
    from shapely import make_valid, STRtree
    import reportlab
    from reportlab.graphics import renderSVG
    from . import scientific_figures, scientific_map_figures, spatial_esri
    from source import capture_upstream_network
    if (scientific_map_figures.KIND != "projected_geometry_map"
            or not callable(scientific_figures.panel_drawings)
            or not callable(spatial_esri.OriginalEsriFeatures)
            or not callable(capture_upstream_network.esri_polygon)
            or not callable(renderSVG.drawToString) or not callable(make_valid) or not callable(STRtree)):
        raise ValueError("Install the original Esri reader and shared projected-map renderer")
    paths = ["model/receptor_report_maps.py", "model/receptor_report_source.py",
             "model/scientific_figures.py", "model/scientific_map_figures.py",
             "model/spatial_esri.py", "source/capture_upstream_network.py"]
    return {"schema": "upstate.receptor-map-runtime/v1",
            "libraries": {"pyproj": pyproj.__version__, "proj": pyproj.proj_version_str,
                          "shapely": shapely.__version__, "geos": shapely.geos_version_string,
                          "reportlab": reportlab.Version},
            "source": [describe_file(APPLICATION, APPLICATION / name) for name in paths]}


def capability():
    """Report this host's installed native capability without opening original geometry."""
    try:
        current = runtime()
    except (ImportError, OSError, AttributeError, ValueError) as error:
        return {"available": False, "reason": str(error)}
    return {"available": True, "libraries": current["libraries"],
            "kind": "projected_geometry_map",
            "coordinates": "Original projected XY; grid scale in metres"}


def _extent(geometries):
    from .scientific_map_figures import positions
    xmin = ymin = float("inf")
    xmax = ymax = float("-inf")
    for geometry in geometries.values():
        for point in positions(geometry):
            xmin, xmax = min(xmin, point[0]), max(xmax, point[0])
            ymin, ymax = min(ymin, point[1]), max(ymax, point[1])
    span = max(xmax - xmin, ymax - ymin, 1.0)
    margin = span * .08
    return [xmin - margin, ymin - margin, xmax + margin, ymax + margin]


def _figure(rows, geometries, crs, original, source_binding, identity, figure_id, title, caption):
    from shapely.geometry import shape
    bank, layers, legend = {}, [], []
    # All light contributions precede dark anchor outlines, so another area
    # cannot paint over an anchor in an overview.
    for role in ("contribution", "receptor"):
        for area in rows:
            keys = area["huc12s"] if role == "contribution" else area["anchor_huc12s"]
            for huc in keys:
                geometry = geometries[huc]
                key = digest(geometry)
                bank[key] = geometry
                layers.append({"geometry": key, "role": role, "receptor_id": area["id"],
                               "source": {**original, "huc12": huc,
                                          "decoded_sha256": source_binding["decoded_sha256"]}})
    for area in rows:
        # A deterministic original anchor polygon supplies a cartographic label.
        # It is not an intake, monitoring point, or a newly inferred receptor.
        huc = sorted(area["anchor_huc12s"])[0]
        anchor = shape(geometries[huc]).representative_point()
        legend.append({"label": area["title"], "receptor_id": area["id"],
                       "anchor_huc12": huc, "anchor": [anchor.x, anchor.y]})
    panel = {"kind": "projected_geometry_map", "title": title,
             "bounds": _extent(bank), "crs": crs, "layers": layers, "legend": legend}
    return {"id": figure_id, "title": title, "caption": caption,
            "alt": title + ". Original upstream HUC12 geography with dark anchor outlines and projected grid scale.",
            "geometries": bank, "panels": [panel],
            "source_binding": {"network_id": identity["network_id"],
                               "preparation_id": identity["preparation_id"],
                               "original_source": deepcopy(source_binding),
                               "area_ids": [row["id"] for row in rows],
                               "reader_inventory": READER},
            "method": {"coordinates": "Native XY interpreted by the maintained original Esri ring reader",
                       "reprojection": False, "simplification": False, "dissolve": False, "basemap": None,
                       "geometry_operations": READER,
                       "north": "Positive projected Y (grid north)",
                       "scale": "Projected grid metres; EPSG:3857 grid distances are not corrected ground distances",
                       "overlap": "Original HUC12 boundaries remain separate; shared membership is not additive",
                       "labels": "Interior points of original anchor polygons for labels only",
                       "area": "Area quantities use original published AreaSqKm attributes, not this projected display"}}


def prepare(directory, product, network, preparation, expected_runtime):
    """Render declared original map companions after their full source is captured."""
    from pyproj import CRS
    from reportlab.graphics import renderSVG
    from .scientific_figures import panel_drawings
    from .scientific_map_figures import positions
    from .spatial_esri import OriginalEsriFeatures

    directory = Path(directory)
    if runtime() != expected_runtime:
        raise ValueError("The native map runtime changed after the report source was selected")
    selected_ids = set((preparation or {}).get("identity", {}).get(
        "receptor_ids", [area["id"] for area in network["areas"]]))
    areas = [area for area in network["areas"] if area["id"] in selected_ids]
    if not areas or len(areas) != len(selected_ids):
        raise ValueError("Select the original receiving areas retained in this source study")
    identity = {"network_id": product["id"], "preparation_id": (preparation or {}).get("id"),
                "receptor_ids": [area["id"] for area in areas],
                "source_binding": product["source_binding"], "runtime": expected_runtime}
    inventory_path = directory / INVENTORY
    if inventory_path.exists():
        saved = read_json(inventory_path)
        if saved.get("schema") != SCHEMA or saved.get("identity") != identity:
            raise ValueError("The retained map belongs to another source or native rendering edition")
        for item in saved["files"]:
            verify_file(directory, item)
        return {**saved, "files": saved["files"] + [describe_file(directory, inventory_path)]}
    files = []
    for descriptor in expected_runtime["source"]:
        source = verify_file(APPLICATION, descriptor)
        target = directory / "render-source" / descriptor["path"]
        atomic_bytes(target, source.read_bytes(), immutable=True)
        files.append(describe_file(directory, target))
    descriptor = product["files"]["source_body"]
    original = {"path": "network/" + descriptor["path"],
                "bytes": descriptor["bytes"], "sha256": descriptor["sha256"]}
    path = verify_file(directory, original)
    binding = product["source_binding"]
    reader = OriginalEsriFeatures(path, {"decoded_bytes": binding["decoded_bytes"],
                                        "decoded_sha256": binding["decoded_sha256"]})
    if len(reader) != binding["feature_count"] or len(reader) != network["network_huc12_count"]:
        raise ValueError("Original geographic feature count differs from the retained watershed graph")
    crs_value = CRS.from_wkt(reader.crs_wkt)
    if (not crs_value.is_projected or len(crs_value.axis_info) < 2
            or any(abs(axis.unit_conversion_factor - 1) > 1e-12 for axis in crs_value.axis_info[:2])):
        raise ValueError("Projected source maps need the original source's metre-based projected CRS")
    crs = {"name": crs_value.name, "wkt": reader.crs_wkt, "axes": "XY", "units": "metre"}
    rows = {row["huc12"]: row for row in network["network"]}
    if len(rows) != len(reader):
        raise ValueError("The original graph repeats a HUC12 identifier")
    selected_hucs = {huc for area in areas for huc in area["huc12s"]}
    geometries, feature_records, seen = {}, [], set()
    field = network["source_fields"]["huc12"]
    oid = binding.get("feature_identity_field")
    for feature in reader:
        huc = feature.properties.get(field)
        if huc not in rows or huc in seen or feature.properties != rows[huc]["attributes"]:
            raise ValueError("Original map attributes differ from their retained HUC12 network row")
        seen.add(huc)
        # Match the network CLI's original ID rule independently of the GIS
        # reader's richer fallback rule; retain both explicit bases below.
        original_id = feature.properties.get(oid) if oid else None
        network_id = str(original_id if original_id is not None else feature.source_feature_index)
        if network_id != rows[huc]["source_feature_id"]:
            raise ValueError("Original source feature ID differs from its saved network identity")
        record = {"huc12": huc, "network_source_feature_id": network_id,
                  "native_reader_feature_id": feature.id, "native_id_basis": feature.id_basis,
                  "source_feature_index": feature.source_feature_index,
                  "geometry_operations": deepcopy(feature.geometry_operations),
                  "selected": huc in selected_hucs}
        if huc in selected_hucs:
            if feature.native_geometry is None or feature.native_geometry.is_empty:
                raise ValueError("A selected original watershed has no native polygon geography: " + huc)
            geometry = json.loads(json.dumps(feature["geometry"], allow_nan=False))
            record["native_geometry_sha256"] = digest(geometry)
            record["native_coordinate_count"] = sum(1 for _ in positions(geometry))
            geometries[huc] = geometry
        feature_records.append(record)
    if seen != set(rows) or set(geometries) != selected_hucs:
        raise ValueError("The original geographic source does not close the selected watershed membership")
    for area in areas:
        if (len(set(area["huc12s"])) != area["huc12_count"]
                or not set(area["anchor_huc12s"]) <= set(area["huc12s"])):
            raise ValueError("Original anchor polygons differ from the saved upstream area")
    reader_record = {"schema": "upstate.receptor-map-original-reader/v1",
                     "original_source": original, "source_binding": binding,
                     "reader": reader.reader_metadata, "runtime": expected_runtime,
                     "crs": crs, "features": feature_records,
                     "interpretation": "The maintained reader assembles Esri rings by symmetric difference and "
                     "records any make_valid operations. Native mapped geometry is distinct from the untouched "
                     "original source rings; no map-specific reprojection, simplification or dissolve is applied."}
    atomic_json(directory / READER, reader_record, immutable=True)
    files.append(describe_file(directory, directory / READER))
    figures = []
    for start in range(0, len(areas), 6):
        end = min(start + 6, len(areas))
        title = "Original source-water areas" if len(areas) <= 6 else (
            "Original source-water areas " + str(start + 1) + "–" + str(end) + " of " + str(len(areas)))
        caption = ("Light grey shows original upstream HUC12 members; dark outlines show selected anchor "
                   "HUC12 polygons. Numbered labels identify receiving areas, not intake or sampling locations. "
                   "Shared watersheds can belong to several areas. Grid north and scale use the original "
                   "projected CRS; the source reader and any geometry repairs are retained in the companion inventory.")
        figures.append(_figure(areas[start:end], geometries, crs, original, binding, identity,
                               "source-water-overview-" + format(start // 6 + 1, "04d"), title, caption))
    for index, area in enumerate(areas, 1):
        caption = (area["title"] + ": " + str(area["huc12_count"]) + " original upstream HUC12 units, "
                   "including anchor " + ", ".join(area["anchor_huc12s"]) + ". Original unit boundaries remain "
                   "separate. The map shows retained upstream support; area quantities remain the publisher's "
                   "AreaSqKm attributes. Grid distances are not corrected ground distances.")
        figures.append(_figure([area], geometries, crs, original, binding, identity,
                               "source-water-area-" + format(index, "04d"), area["title"], caption))
    specification = {"schema": "upstate.scientific-figure-spec/v1",
                     "edition": "source-water-original-maps/1",
                     "title": product["title"] + " — original projected source maps",
                     "rendering": {"reportlab_version": expected_runtime["libraries"]["reportlab"],
                                   "width_points": 511.2},
                     "figures": figures}
    atomic_json(directory / SPEC, specification, immutable=True)
    files.append(describe_file(directory, directory / SPEC))
    selections = []
    for figure in figures:
        drawings = panel_drawings(figure, 511.2)
        if len(drawings) != 1:
            raise ValueError("Each projected source-water map must retain one native vector drawing")
        name = "figures/" + figure["id"] + ".svg"
        rendered = renderSVG.drawToString(drawings[0])
        atomic_bytes(directory / name, rendered.encode("utf-8") if isinstance(rendered, str) else rendered,
                     immutable=True)
        files.append(describe_file(directory, directory / name))
        selections.append({"id": figure["id"], "path": name,
                           "title": figure["title"], "caption": figure["caption"]})
    summary = {"figures": len(figures), "receiving_areas": len(areas),
               "selected_huc12s": len(selected_hucs), "overview_pages": (len(areas) + 5) // 6,
               "crs": crs_value.name, "crs_authority": crs_value.to_authority(),
               "native_geometry_operations": reader.reader_metadata["geometry_operation_count"],
               "reader_inventory": READER, "runtime": expected_runtime["libraries"],
               "grid_scale": "Projected metres; no ground-distance correction"}
    inventory = {"schema": SCHEMA, "identity": identity, "figure_spec": SPEC,
                 "figures": selections, "files": files, "summary": summary}
    atomic_json(inventory_path, inventory, immutable=True)
    return {**inventory, "files": files + [describe_file(directory, inventory_path)]}
