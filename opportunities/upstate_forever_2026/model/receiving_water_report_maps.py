"""Retained original Receiving waters geography for scientific map figures.

No geography is prepared here: this reads the complete plan's original
GeoPackages, retains every coordinate and binds drawings to those exact files.
"""
from __future__ import annotations

import json
import os
import tempfile
from pathlib import Path

from .common import atomic_json, describe_file, digest, file_digest, read_json, verify_file

SCHEMA = "upstate.receiving-water-report-maps/v1"
SPEC = "figures/source-map-spec.json"
INVENTORY = "figures/source-map-members.json"


def _bytes(path, body):
    """Publish immutable rendered bytes atomically; interrupted writes never count."""
    path = Path(path)
    if isinstance(body, str):
        body = body.encode("utf-8")
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists():
        if path.read_bytes() != body:
            raise ValueError("Retained source map differs from its original rendering")
        return
    pending = None
    try:
        with tempfile.NamedTemporaryFile(dir=path.parent, prefix=".map-", delete=False) as out:
            pending = Path(out.name)
            out.write(body)
            out.flush()
            os.fsync(out.fileno())
        try:
            os.link(pending, path)
        except FileExistsError:
            if path.read_bytes() != body:
                raise ValueError("Concurrent source map differs")
        fd = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(fd)
        finally:
            os.close(fd)
    finally:
        if pending is not None:
            pending.unlink(missing_ok=True)


def _geometry(directory, descriptor, crs, receptor_id):
    import fiona
    from pyproj import CRS
    from . import rasters
    from .scientific_map_figures import positions
    path = verify_file(directory / "native" / "plan", descriptor)
    with rasters.vector_environment(), fiona.open(path, layer="receiving_water") as source:
        if CRS.from_user_input(source.crs_wkt or source.crs) != crs:
            raise ValueError("Saved source-map geometry differs from its plan CRS")
        rows = list(source)
    if len(rows) != 1 or rows[0]["geometry"] is None:
        raise ValueError("Saved receiving-water geometry must retain its one original plan feature")
    metadata = json.loads(dict(rows[0]["properties"])["record"])
    if metadata.get("id") != receptor_id:
        raise ValueError("Saved source-map feature identifies another original receptor")
    geometry = json.loads(json.dumps(rows[0]["geometry"].__geo_interface__))
    # Validate complete geometry but leave all original positions and dimensions.
    count = sum(1 for _ in positions(geometry))
    if not count:
        raise ValueError("Saved source-map geometry is empty")
    return geometry, {"path": "native/plan/" + descriptor["path"],
                      "bytes": descriptor["bytes"], "sha256": descriptor["sha256"],
                      "layer": "receiving_water", "feature_count": 1, "coordinate_count": count}


def _extent(geometries):
    from .scientific_map_figures import positions
    xmin = ymin = float("inf")
    xmax = ymax = float("-inf")
    for geometry in geometries.values():
        for point in positions(geometry):
            xmin, xmax = min(xmin, point[0]), max(xmax, point[0])
            ymin, ymax = min(ymin, point[1]), max(ymax, point[1])
    # Display margin only; source vertices remain exact. A point/line extent
    # gets a finite metre frame while its displayed symbol stays print-sized.
    span = max(xmax - xmin, ymax - ymin, 1.0)
    margin = span * .08
    return [xmin - margin, ymin - margin, xmax + margin, ymax + margin]


def _figure(plan, rows, crs, figure_id, title, caption):
    from shapely.geometry import shape
    geometries, layers, legend = {}, [], []
    for row in rows:
        receptor = row["record"]
        for role in ("contribution", "receptor"):
            geometry, source = row[role]
            key = digest(geometry)
            geometries[key] = geometry
            layers.append({"geometry": key, "role": role, "receptor_id": receptor["id"],
                           "source": source})
        # Labels are cartographic positions only; they are never sampling sites
        # or an inferred intake location.
        anchor = shape(row["contribution"][0]).representative_point()
        legend.append({"label": receptor["title"], "receptor_id": receptor["id"],
                       "anchor": [anchor.x, anchor.y]})
    panel = {"kind": "projected_geometry_map", "title": title,
             "bounds": _extent(geometries), "crs": crs, "layers": layers, "legend": legend}
    return {"id": figure_id, "title": title, "caption": caption,
            "alt": title + ". Original source and contribution geometry with projected grid scale.",
            "geometries": geometries, "panels": [panel],
            "source_binding": {"project_id": plan["identity"]["project_id"],
                               "plan_id": plan["id"], "plan_record_sha256": plan["record_sha256"],
                               "receptor_ids": [row["record"]["id"] for row in rows]},
            "method": {"coordinates": "Original retained projected XY; extra coordinate dimensions retained",
                       "reprojection": False, "simplification": False, "basemap": None,
                       "north": "Positive projected Y (grid north)",
                       "scale": "Projected grid metres, not a local ground-distance correction",
                       "overlap": "Source areas may overlap; fills do not encode additive quantities",
                       "labels": "Interior contribution-area display anchors, not sampling locations"}}


def prepare(directory, plan, *, progress=None):
    """Return declared figure companions for an already-retained immutable plan."""
    from pyproj import CRS
    from reportlab import Version as reportlab_version
    from reportlab.graphics import renderSVG
    from . import scientific_figures, scientific_map_figures
    directory = Path(directory)
    identity = {"plan_id": plan["id"], "plan_record_sha256": plan["record_sha256"],
                "map_capture_sha256": file_digest(__file__),
                "map_renderer_sha256": file_digest(scientific_map_figures.__file__),
                "scientific_figures_sha256": file_digest(scientific_figures.__file__)}
    inventory_path = directory / INVENTORY
    if inventory_path.exists():
        inventory = read_json(inventory_path)
        if inventory.get("schema") != SCHEMA or inventory.get("identity") != identity:
            raise ValueError("Retained source-map edition identifies another original plan or renderer")
        for item in inventory["files"]:
            verify_file(directory, item)
        return {**inventory, "files": inventory["files"] + [describe_file(directory, inventory_path)]}
    if read_json(directory / "native" / "plan" / "plan.json") != plan:
        raise ValueError("Source maps need the exact already-retained native plan")
    original_crs = CRS.from_user_input(plan["analysis_crs"])
    if (not original_crs.is_projected or len(original_crs.axis_info) < 2
            or any(abs(axis.unit_conversion_factor - 1) > 1e-12 for axis in original_crs.axis_info[:2])):
        raise ValueError("Saved source plan must retain projected metre coordinates")
    crs = {"name": plan["analysis_crs_name"], "wkt": plan["analysis_crs"],
           "axes": "XY", "units": "metre"}
    rows = []
    for receptor in plan["receptors"]:
        values = {}
        for role in ("receptor", "contribution"):
            descriptor = receptor[role + "_geometry"]
            if descriptor not in plan["files"].values():
                raise ValueError("Source map geometry is absent from its original plan inventory")
            values[role] = _geometry(directory, descriptor, original_crs, receptor["id"])
        rows.append({"record": receptor, **values})
    if not rows:
        raise ValueError("Source-map report requires the original plan receptors")
    # Keep metadata distinct from the role-named geometry tuples.
    figures = []
    def figure(group, figure_id, title, caption):
        return _figure(plan, group, crs, figure_id, title, caption)
    for start in range(0, len(rows), 6):
        end = min(start + 6, len(rows))
        label = "Source-area overview" if len(rows) <= 6 else (
            "Source-area overview — waters " + str(start + 1) + "–" + str(end) + " of " + str(len(rows)))
        figures.append(figure(rows[start:end], "source-overview-" + format(start // 6 + 1, "04d"), label,
            "Original saved source/receptor geometries and their contribution areas. Light grey shows "
            "contribution geometry; dark outlines, lines and points show the original receptor. "
            "Areas may overlap and are not added. The scale and north arrow use the original projected grid."))
    for index, row in enumerate(rows, 1):
        receptor = row["record"]
        caption = (receptor["title"] + "; retained relation: " + receptor["relationship_precision"]
                   + ". Contribution area: " + format(receptor["contribution_area_ha"], ",.3f")
                   + " ha from the original plan in its analysis CRS. Original boundaries and holes remain intact. "
                   "This frame describes the saved geographic scope; it does not encode a measured concentration, "
                   "a flow path or monitoring effectiveness.")
        figures.append(figure([row], "source-water-" + format(index, "04d"), receptor["title"], caption))
    specification = {"schema": "upstate.scientific-figure-spec/v1",
                     "edition": "receiving-water-source-maps/1",
                     "title": plan["title"] + " — original source maps",
                     "rendering": {"reportlab_version": reportlab_version, "width_points": 511.2},
                     "figures": figures}
    files, selections = [], []
    atomic_json(directory / SPEC, specification, immutable=True)
    files.append(describe_file(directory, directory / SPEC))
    for index, item in enumerate(figures, 1):
        if progress:
            progress({"stage": "render-original-geography", "figure": index, "figure_count": len(figures)})
        drawings = scientific_figures.panel_drawings(item, 511.2)
        if len(drawings) != 1:
            raise ValueError("Each original map frame must retain one vector drawing")
        path = "figures/" + item["id"] + ".svg"
        _bytes(directory / path, renderSVG.drawToString(drawings[0]))
        files.append(describe_file(directory, directory / path))
        selections.append({"id": item["id"], "path": path})
    inventory = {"schema": SCHEMA, "identity": identity, "figure_spec": SPEC,
                 "figures": selections, "files": files,
                 "summary": {"figures": len(figures), "receptors": len(rows),
                             "overview_pages": (len(rows) + 5) // 6,
                             "crs": plan["analysis_crs_name"], "original_vertices_preserved": True}}
    atomic_json(inventory_path, inventory, immutable=True)
    return {**inventory, "files": files + [describe_file(directory, inventory_path)]}
