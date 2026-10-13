"""Source-bound receiving-water plans and physical-output priorities.

Plans bind retained receptor geometry to an original HUC/ToHUC network or an
explicit source polygon. Analyses use the existing Workspace model outputs.
All raster calculations are windowed; source-only plans need no model run.
"""
from __future__ import annotations

from collections import defaultdict
from contextlib import ExitStack
import csv
import json
import math
from pathlib import Path
import re
import time

from .common import (
    INVEST_VERSION, atomic_json, canonical, describe_file, digest, file_digest,
    finite, held, identifier, now, read_json, verify_file,
)
from . import rasters
from . import receiving_water_accounting as accounting

METHOD_VERSION = "upstate.receiving-water-priorities/1"
PLAN_SCHEMA = "upstate.receiving-water-plan/v1"
ANALYSIS_SCHEMA = "upstate.receiving-water-analysis/v1"
FAMILIES = ("critical_drinking_water", "high_quality_waters")
POLLUTANTS = tuple(rasters.MASS_UNITS)
TOTAL_UNITS = {
    "nitrogen_export": "kg/year",
    "phosphorus_export": "kg/year",
    "sediment_export": "metric_tonnes/year",
}
NODATA = -3.4028234663852886e38


def _json_copy(value):
    return json.loads(canonical(value))


def _title(value, name):
    if not isinstance(value, str) or not value.strip():
        raise ValueError("Supply " + name)
    return value.strip()


def _safe_label(value, name="receptor ID"):
    value = _title(value, name)
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,127}", value):
        raise ValueError(name + " must use 1-128 letters, digits, dots, underscores or hyphens")
    return value


def _huc(value, name="HUC12"):
    if not isinstance(value, str) or not re.fullmatch(r"[0-9]{12}", value.strip()):
        raise ValueError(name + " must retain its original 12-digit text, including leading zeros")
    value = value.strip()
    if value == "000000000000":
        raise ValueError(name + " cannot be a terminal marker")
    return value


def _field(properties, requested):
    if requested in properties:
        return requested
    matches = [key for key in properties if key.lower() == requested.lower()]
    if len(matches) != 1:
        raise ValueError("Select an unambiguous original source field: " + requested)
    return matches[0]


def _source(workspace, selection, crs, *, cache=None):
    """Select retained vectors, reading each original body once within a plan."""
    import fiona
    from pyproj import CRS, Transformer
    from shapely.geometry import shape
    from shapely.ops import transform
    selection = _json_copy(selection)
    collection = identifier(selection["source_collection_id"])
    source_id = _title(selection["source_id"], "source ID")
    if selection.get("where") is not None and not isinstance(selection["where"], dict):
        raise ValueError("Source where must contain exact original field/value pairs")
    wanted = selection.get("feature_ids")
    if wanted is not None:
        if not isinstance(wanted, list) or not wanted or len(set(map(str, wanted))) != len(wanted):
            raise ValueError("Select distinct original native feature IDs")
        wanted = set(map(str, wanted))
    cache = {} if cache is None else cache
    asset_key = ("asset", collection, source_id)
    if asset_key not in cache:
        cache[asset_key] = workspace.source_file(collection, source_id)
    path, entry = cache[asset_key]
    if entry["kind"] != "vector":
        raise ValueError("Receiving waters and catchments require retained vector sources")
    layer = selection.get("layer") or entry.get("layer")
    vector_key = ("vector", collection, source_id, layer, str(crs))
    if vector_key not in cache:
        raw_rows, native_ids = [], defaultdict(list)
        from .spatial_esri import OriginalEsriFeatures, UnsupportedEsriGeometry, is_esri_source
        reader = None
        with ExitStack() as stack:
            original = None
            if is_esri_source(path, entry):
                try:
                    original = OriginalEsriFeatures(path, entry)
                except UnsupportedEsriGeometry:
                    # Non-polygon Esri originals retain the existing GDAL reader.
                    pass
            if original is None:
                stack.enter_context(rasters.vector_environment())
                original = stack.enter_context(fiona.open(
                    rasters.native_vector_path(path), **({"layer": layer} if layer else {})
                ))
            else:
                if layer is not None and layer not in original.layers:
                    raise ValueError("Select the retained original Esri polygon layer")
                reader = {
                    **_json_copy(original.reader_metadata),
                    "adapter": "model/spatial_esri.py:OriginalEsriFeatures",
                    "adapter_source_sha256": file_digest(
                        Path(__file__).with_name("spatial_esri.py")),
                    "analysis_axes": "XY",
                    "analysis_crs": CRS.from_user_input(crs).to_wkt(),
                }
            native = CRS.from_user_input(original.crs_wkt or original.crs)
            target = CRS.from_user_input(crs)
            project = Transformer.from_crs(native, target, always_xy=True)
            for feature in original:
                geometry = feature["geometry"]
                if not geometry:
                    continue
                row = {"id": str(feature.id), "properties": dict(feature["properties"]),
                       "native_geometry": geometry}
                if reader is not None:
                    row["source_feature"] = {
                        "source_array_index": feature.source_feature_index,
                        "native_id_basis": feature.id_basis,
                        "geometry_operations": _json_copy(feature.geometry_operations),
                    }
                native_ids[row["id"]].append(len(raw_rows))
                raw_rows.append(row)
        cache[vector_key] = {
            "rows": raw_rows, "native_ids": dict(native_ids), "geometries": {},
            "project": project, "transform_required": native != target,
            "geometry_reader": reader,
        }
    retained = cache[vector_key]
    if wanted is None:
        positions = range(len(retained["rows"]))
    else:
        positions = sorted(position for native_id in wanted
                           for position in retained["native_ids"].get(native_id, ()))
    rows = []
    where = selection.get("where") or {}
    for position in positions:
        original = retained["rows"][position]
        if any(original["properties"].get(key) != value for key, value in where.items()):
            continue
        if position not in retained["geometries"]:
            geometry = shape(original["native_geometry"])
            if not geometry.is_empty and not geometry.is_valid:
                raise ValueError("Source feature " + original["id"] + " requires an explicit geometry correction")
            if not geometry.is_empty and retained["transform_required"]:
                geometry = transform(retained["project"].transform, geometry)
            retained["geometries"][position] = geometry
        geometry = retained["geometries"][position]
        if not geometry.is_empty:
            rows.append({"id": original["id"], "properties": original["properties"],
                         "geometry": geometry,
                         **({"source_feature": original["source_feature"]}
                            if "source_feature" in original else {})})
    if wanted is not None and {row["id"] for row in rows} != wanted:
        raise ValueError("One or more selected native feature IDs are absent")
    if not rows:
        raise ValueError("The retained source selection contains no geometry")
    identity = {
        "source_collection_id": collection, "source_id": source_id,
        "uri": entry["uri"], "vintage": entry["vintage"], "title": entry["title"],
        "body_sha256": entry["body"]["sha256"], "body_bytes": entry["body"]["bytes"],
        "selection": selection, "feature_ids": [row["id"] for row in rows],
        "role": entry.get("role"), "metadata": entry.get("metadata", {}),
        "companions": [
            {"sha256": item["sha256"], "bytes": item["bytes"],
             "filename": item.get("filename"), "source_path": item.get("source_path")}
            for item in entry.get("companions", [])
        ],
    }
    if retained["geometry_reader"] is not None:
        identity["geometry_reader"] = retained["geometry_reader"]
        identity["selected_features"] = [
            {"native_feature_id": row["id"], **row["source_feature"]}
            for row in rows
        ]
    return rows, identity


def huc_graph(rows, *, id_field="huc12", downstream_field="tohuc"):
    """Compile the original one-downstream-per-HUC network without dropping exits."""
    nodes, reverse = {}, defaultdict(set)
    for row in rows:
        properties = row.get("properties", row)
        hf, tf = _field(properties, id_field), _field(properties, downstream_field)
        huc = _huc(properties[hf])
        if huc in nodes:
            raise ValueError("Original HUC12 identity is duplicated: " + huc)
        original = properties[tf]
        downstream = original.strip() if isinstance(original, str) else original
        if isinstance(downstream, str) and re.fullmatch(r"[0-9]{12}", downstream) and downstream != "000000000000":
            status = "known_huc"
        elif original is None or original == "":
            status = "missing_downstream"
            downstream = None
        else:
            status = "source_terminal_marker"
        nodes[huc] = {
            "huc12": huc, "downstream": downstream, "downstream_original": original,
            "downstream_status": status, "native_feature_id": str(row.get("id", huc)),
            "id_field": hf, "downstream_field": tf, "properties": _json_copy(properties),
        }
    if not nodes:
        raise ValueError("The retained HUC network is empty")
    exits, missing, terminals = [], [], []
    for huc, node in nodes.items():
        target = node["downstream"]
        if node["downstream_status"] == "known_huc":
            if target in nodes:
                reverse[target].add(huc)
            else:
                node["downstream_status"] = "outside_retained_network"
                exits.append({"huc12": huc, "downstream": target})
        elif node["downstream_status"] == "missing_downstream":
            missing.append(huc)
        else:
            terminals.append({"huc12": huc, "value": node["downstream_original"]})
    complete = set()
    for start in sorted(nodes):
        if start in complete:
            continue
        order, position, current = [], {}, start
        while current in nodes and current not in complete:
            if current in position:
                cycle = order[position[current]:] + [current]
                raise ValueError("The original ToHUC graph contains a cycle: " + " -> ".join(cycle))
            position[current] = len(order)
            order.append(current)
            downstream = nodes[current]["downstream"]
            current = downstream if isinstance(downstream, str) else None
        complete.update(order)
    return {
        "nodes": nodes,
        "upstream": {key: sorted(reverse.get(key, ())) for key in sorted(nodes)},
        "external_exits": sorted(exits, key=lambda x: x["huc12"]),
        "missing_downstream": sorted(missing), "terminal_markers": terminals,
        "coverage": "Original retained HUC nodes and ToHUC edges",
    }


def upstream_hucs(graph, seeds):
    """Return the inclusive reverse-transitive closure of distinct original seeds."""
    seeds = sorted({_huc(value, "Seed HUC12") for value in seeds})
    if not seeds:
        raise ValueError("Select at least one receiving HUC")
    unknown = set(seeds) - set(graph["nodes"])
    if unknown:
        raise ValueError("Receiving HUCs are absent from the retained network: " + ", ".join(sorted(unknown)))
    selected, pending = set(), list(seeds)
    while pending:
        current = pending.pop()
        if current in selected:
            continue
        selected.add(current)
        pending.extend(graph["upstream"].get(current, ()))
    return sorted(selected)


def _intersects_interior(catchment, receptor):
    """Avoid treating polygon/line boundary touches as full HUC seed evidence."""
    if receptor.geom_type in ("Point", "MultiPoint"):
        return catchment.covers(receptor) or (
            receptor.geom_type == "MultiPoint" and
            any(catchment.covers(point) for point in receptor.geoms)
        )
    overlap = catchment.intersection(receptor)
    if receptor.geom_type in ("Polygon", "MultiPolygon"):
        return not overlap.is_empty and overlap.area > 0
    if receptor.geom_type in ("LineString", "MultiLineString", "LinearRing"):
        return not overlap.is_empty and overlap.length > 0
    return any(_intersects_interior(catchment, geometry) for geometry in receptor.geoms)


def _polygon(geometry, label):
    from shapely.geometry import MultiPolygon
    if geometry.is_empty:
        raise ValueError(label + " has no area")
    if geometry.geom_type == "GeometryCollection":
        polygons = []
        for part in geometry.geoms:
            if part.geom_type == "Polygon":
                polygons.append(part)
            elif part.geom_type == "MultiPolygon":
                polygons.extend(part.geoms)
        geometry = MultiPolygon(polygons)
    if geometry.geom_type not in ("Polygon", "MultiPolygon") or geometry.area <= 0:
        raise ValueError(label + " must supply a positive polygon area")
    if not geometry.is_valid:
        raise ValueError(label + " requires an explicit original geometry correction")
    return geometry


def _write_geometry(path, geometry, crs, properties):
    import fiona
    from shapely.geometry import mapping
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.unlink(missing_ok=True)
    with rasters.vector_environment(), fiona.open(
        path, "w", driver="GPKG", layer="receiving_water", crs_wkt=crs.to_wkt(),
        schema={"geometry": "Unknown", "properties": {"record": "str"}},
    ) as output:
        output.write({"geometry": mapping(geometry),
                      "properties": {"record": canonical(properties).decode("utf-8")}})


def _record_digest(value):
    return digest({key: item for key, item in value.items()
                   if key not in ("record_sha256", "reused")})


def _finish_record(path, value):
    value["record_sha256"] = _record_digest(value)
    atomic_json(path, value)
    return value


def prepare(workspace, selection):
    """Create source-only receptor/catchment geometries for repeated model analyses.

    Required selection: title, receptors. A catchments source is required only
    for upstream_huc relationships. Receptors contain id, title, family, source,
    relation, and optional original classification/provenance metadata.
    """
    from pyproj import CRS
    from shapely.ops import unary_union
    selection = _json_copy(selection)
    title = _title(selection.get("title"), "a receiving-water study title")
    requested = selection.get("receptors")
    if not isinstance(requested, list) or not requested:
        raise ValueError("Select the actual receiving-water features")
    crs = CRS.from_user_input(selection.get("analysis_crs", "EPSG:5070"))
    if not crs.is_projected or any(abs(a.unit_conversion_factor - 1) > 1e-12 for a in crs.axis_info[:2]):
        raise ValueError("Receiving-water geometry requires a projected analysis CRS in metres")
    graph, catchment_geometry, source_records = None, {}, []
    source_cache = {}
    if any(row.get("relation", {}).get("method") == "upstream_huc" for row in requested):
        choice = selection.get("catchments")
        if not isinstance(choice, dict):
            raise ValueError("Select the retained HUC/ToHUC vector source for upstream association")
        rows, identity = _source(workspace, choice, crs, cache=source_cache)
        graph = huc_graph(rows, id_field=choice.get("id_field", "huc12"),
                          downstream_field=choice.get("downstream_field", "tohuc"))
        for row in rows:
            key = _huc(row["properties"][_field(row["properties"], choice.get("id_field", "huc12"))])
            catchment_geometry[key] = _polygon(row["geometry"], "Catchment " + key)
        source_records.append(identity)
    compiled, used_ids = [], set()
    for descriptor in requested:
        rid = _safe_label(descriptor.get("id"))
        if rid in used_ids:
            raise ValueError("Receiving-water IDs must be unique")
        used_ids.add(rid)
        name = _title(descriptor.get("title"), "a receiving-water title")
        family = descriptor.get("family")
        if family not in FAMILIES:
            raise ValueError("Receiving-water family must be critical_drinking_water or high_quality_waters")
        relation = _json_copy(descriptor.get("relation", {}))
        method = relation.get("method")
        if method not in ("upstream_huc", "source_area", "geometric_context"):
            raise ValueError("Choose upstream_huc, source_area or geometric_context explicitly")
        _title(relation.get("rationale"), "the source/relationship rationale")
        original_rows, original = _source(workspace, descriptor["source"], crs, cache=source_cache)
        receptor = unary_union([row["geometry"] for row in original_rows])
        source_records.append(original)
        seeds, associated, touches = [], [], []
        if method == "upstream_huc":
            explicit = relation.get("seed_huc_ids")
            if explicit is not None:
                if not isinstance(explicit, list) or not explicit:
                    raise ValueError("Explicit receiving HUCs must be a nonempty list")
                seeds = sorted({_huc(value) for value in explicit})
                if not relation.get("evidence"):
                    raise ValueError("Explicit receiving-HUC links require their original evidence reference")
                seed_method = "explicit source-linked HUC selection"
            else:
                for huc, geometry in catchment_geometry.items():
                    if _intersects_interior(geometry, receptor):
                        seeds.append(huc)
                    elif geometry.intersects(receptor):
                        touches.append(huc)
                seed_method = "retained receptor geometry intersects original HUC geometry"
            if not seeds:
                raise ValueError("Receiving-water " + rid + " has no selected HUC; choose its actual source association")
            associated = upstream_hucs(graph, seeds)
            contribution = unary_union([catchment_geometry[huc] for huc in associated])
            precision = "Potential contributing land at retained HUC12 network resolution"
            interpretation = (
                "The mask includes the receiving HUC units and their retained upstream ToHUC ancestors. "
                "Within-unit receptor position, stream junctions, and reservoir retention are unresolved "
                "by HUC edges; totals describe selected land export and priorities describe that land."
            )
            relation.update(seed_method=seed_method, seed_huc_ids=sorted(seeds),
                            upstream_huc_ids=associated, boundary_touch_huc_ids=sorted(touches))
        else:
            buffer_m = finite(relation.get("buffer_m", 0), "Explicit geometry context buffer", minimum=0)
            if method == "source_area" and buffer_m:
                raise ValueError("A source_area retains its published polygon; select geometric_context to add a buffer")
            contribution = receptor.buffer(buffer_m) if buffer_m else receptor
            contribution = _polygon(contribution, "Receiving-water " + rid)
            precision = "Published selected source polygon" if method == "source_area" else "Explicit geometric context"
            interpretation = (
                "The mask follows the retained selected polygon and its source meaning."
                if method == "source_area" else
                "The mask represents the selected geometric context and declared buffer; "
                "the geometric operation supplies no additional flow-path relationship."
            )
            relation["buffer_m"] = buffer_m
        contribution = _polygon(contribution, "Receiving-water contribution mask")
        record = {
            "id": rid, "title": name, "family": family, "source": original,
            "relation": relation, "relationship_precision": precision,
            "interpretation": interpretation,
            "classification": _json_copy(descriptor.get("classification", {})),
            "metadata": _json_copy(descriptor.get("metadata", {})),
            "original_features": [
                {"native_feature_id": row["id"], "properties": row["properties"],
                 **row.get("source_feature", {})}
                for row in original_rows
            ],
            "contribution_area_ha": contribution.area / 10000,
            "receptor_geometry_type": receptor.geom_type,
        }
        compiled.append((record, receptor, contribution))
    identity = {
        "method_version": METHOD_VERSION, "implementation_sha256": file_digest(__file__),
        "project_id": workspace.project["id"], "selection": selection,
        "source_identities": source_records,
    }
    key = digest(identity)
    directory = workspace.root / "receiving-water-plans" / key
    with held(workspace.root / ".workspace.lock"):
        with held(directory / ".plan.lock", blocking=False):
            record_path = directory / "plan.json"
            if record_path.exists():
                previous = inspect_plan(workspace, key)
                return {**previous, "reused": True}
            files, result_receptors = {}, []
            for record, receptor, contribution in compiled:
                stem = digest(record["id"])[:20]
                receptor_path = directory / "geometry" / (stem + "-receptor.gpkg")
                contribution_path = directory / "geometry" / (stem + "-contribution.gpkg")
                _write_geometry(receptor_path, receptor, crs, record)
                _write_geometry(contribution_path, contribution, crs, {
                    "id": record["id"], "relation": record["relation"],
                    "relationship_precision": record["relationship_precision"],
                })
                receptor_artifact = describe_file(directory, receptor_path)
                contribution_artifact = describe_file(directory, contribution_path)
                files[stem + "_receptor"] = receptor_artifact
                files[stem + "_contribution"] = contribution_artifact
                result_receptors.append({
                    **record, "receptor_geometry": receptor_artifact,
                    "contribution_geometry": contribution_artifact,
                })
            result = {
                "schema": PLAN_SCHEMA, "id": key, "state": "complete",
                "created_at": now(), "title": title, "identity": identity,
                "analysis_crs": crs.to_wkt(), "analysis_crs_name": crs.to_string(),
                "receptors": result_receptors, "network": graph,
                "files": files,
            }
            return _finish_record(record_path, result)



def prepare_receptor_spec(workspace, receptor_spec, *, grid_id=None):
    """Adapt the shared utility-focus receptor spec to original source plans.

    The existing ASTRA-RECEPTOR12 profile remains the selection source. Each
    anchor is resolved back to its exact original native HUC polygon identity,
    so this adapter also serves source-only planning before a run is complete.
    """
    from pyproj import CRS
    spec = _json_copy(receptor_spec)
    grid = workspace.get_grid(identifier(grid_id)) if grid_id else None
    defaults = grid["spec"] if grid else {}
    collection = spec.get("source_collection_id") or defaults.get("source_collection_id")
    source_id = spec.get("network_source_id") or defaults.get("model_domain", {}).get("source_id")
    if not collection or not source_id:
        raise ValueError("Select the retained network source explicitly or supply its prepared grid ID")
    source = {"source_collection_id": collection, "source_id": source_id}
    if spec.get("layer"):
        source["layer"] = spec["layer"]
    crs = CRS.from_user_input(spec.get("analysis_crs", "EPSG:5070"))
    rows, _ = _source(workspace, source, crs)
    huc_field, downstream_field = spec.get("huc12_field") or "huc12", spec.get("tohuc_field") or "tohuc"
    native_ids = {}
    for row in rows:
        key = _huc(row["properties"][_field(row["properties"], huc_field)])
        if key in native_ids:
            raise ValueError("Original HUC12 identity is duplicated: " + key)
        native_ids[key] = row["id"]
    requested = spec.get("receptors")
    if not isinstance(requested, list) or not requested:
        raise ValueError("Select the original utility-focus receptor definitions")
    receptors = []
    for row in requested:
        family = {"drinking_water": "critical_drinking_water",
                  "high_quality_waters": "high_quality_waters"}.get(row.get("role"))
        if family is None:
            raise ValueError("Original receptor role must be drinking_water or high_quality_waters")
        original_anchors = row.get("anchor_huc12s")
        if not isinstance(original_anchors, list) or not original_anchors:
            raise ValueError("Select the original whole-HUC anchor list")
        anchors = [_huc(value) for value in original_anchors]
        if len(set(anchors)) != len(anchors):
            raise ValueError("Original receptor anchor HUC12 is repeated")
        missing = set(anchors) - set(native_ids)
        if missing:
            raise ValueError("Retained network lacks original utility anchors: " + ", ".join(sorted(missing)))
        reference = row.get("reference", {})
        _title(reference.get("uri"), "the original receptor selection reference URI")
        rationale = _title(reference.get("basis"), "the original HUC-anchor selection basis")
        receptors.append({
            "id": row["id"], "title": row["title"], "family": family,
            "source": {**source, "feature_ids": [native_ids[huc] for huc in anchors]},
            "relation": {"method": "upstream_huc", "seed_huc_ids": anchors,
                         "evidence": [reference], "rationale": rationale},
            "classification": row.get("classification", {}),
            "metadata": {"original_receptor_definition": row,
                         "original_profile_schema": spec.get("schema"),
                         "adapter": "shared utility-focus profile to retained native HUC geometry"},
        })
    return prepare(workspace, {
        "title": _title(spec.get("title"), "the receptor profile title"),
        "analysis_crs": crs.to_string(),
        "catchments": {**source, "id_field": huc_field, "downstream_field": downstream_field},
        "receptors": receptors,
        "original_receptor_spec": spec,
    })


def inspect_plan(workspace, key, *, verify=True):
    key = identifier(key)
    directory = workspace.root / "receiving-water-plans" / key
    result = read_json(directory / "plan.json")
    if result.get("schema") != PLAN_SCHEMA or result.get("id") != key:
        raise ValueError("Select an original receiving-water plan")
    if digest(result["identity"]) != key or result.get("record_sha256") != _record_digest(result):
        raise ValueError("The retained receiving-water plan changed")
    if result["identity"]["project_id"] != workspace.project["id"]:
        raise ValueError("Receiving-water plan belongs to another original workspace")
    if verify:
        for item in result["files"].values():
            verify_file(directory, item)
    return result


def list_plans(workspace):
    return [inspect_plan(workspace, path.parent.name, verify=False)
            for path in sorted((workspace.root / "receiving-water-plans").glob("*/plan.json"))]


def _load_contribution(workspace, plan, receptor, crs):
    path = verify_file(
        workspace.root / "receiving-water-plans" / plan["id"],
        receptor["contribution_geometry"],
    )
    rows, _ = rasters.vector_geometry(path, layer="receiving_water", target_crs=crs)
    return rasters.polygon_union(rows)


def _validate_analysis_grid(grid):
    """Admit the actual retained projected grid and its physical cell area."""
    from pyproj import CRS

    resolution = finite(grid.get("resolution_m"), "original model resolution", positive=True)
    values = grid.get("transform")
    if not isinstance(values, (list, tuple)) or len(values) != 6:
        raise ValueError("Retain the original six affine grid coefficients")
    a, b, c, d, e, f = [
        finite(value, "original grid affine coefficient") for value in values
    ]
    if (abs(b) > 1e-12 or abs(d) > 1e-12 or a <= 0 or e >= 0
            or not math.isclose(a, resolution, rel_tol=1e-9, abs_tol=1e-12)
            or not math.isclose(-e, resolution, rel_tol=1e-9, abs_tol=1e-12)):
        raise ValueError("Use the original north-up square-cell grid at its declared resolution")
    for name in ("width", "height"):
        value = grid.get(name)
        if not isinstance(value, int) or isinstance(value, bool) or value <= 0:
            raise ValueError("Retain the original positive integer grid " + name)
    area = grid.get("pixel_area_ha")
    if not isinstance(area, (int, float)) or isinstance(area, bool):
        raise ValueError("Retain the original numeric pixel area in hectares")
    area = finite(area, "original cell area", positive=True)
    affine_area = abs(a * e - b * d) / 10000.0
    if not math.isclose(area, affine_area, rel_tol=1e-9, abs_tol=1e-12):
        raise ValueError("The original cell area differs from its affine determinant")
    crs = CRS.from_user_input(grid["crs"])
    if (not crs.is_projected or len(crs.axis_info) < 2
            or any(not math.isclose(axis.unit_conversion_factor, 1.0, abs_tol=1e-12)
                   for axis in crs.axis_info[:2])):
        raise ValueError("Receiving-water physical areas require the retained projected metre CRS")


def _aligned_source(stack, path, grid, *, factor, provenance):
    import rasterio
    from rasterio.transform import Affine
    source = stack.enter_context(rasterio.open(path))
    target = Affine(*grid["transform"])
    observed = source.transform
    if source.crs != rasterio.crs.CRS.from_user_input(grid["crs"]):
        raise ValueError("The retained receiving-water input uses another CRS")
    if (abs(observed.a - target.a) > 1e-9 or abs(observed.e - target.e) > 1e-9
            or abs(observed.b - target.b) > 1e-12 or abs(observed.d - target.d) > 1e-12
            or observed.b or observed.d):
        raise ValueError("Receiving-water quantities must use the original model cell grid")
    dx, dy = (target.c - observed.c) / observed.a, (target.f - observed.f) / observed.e
    if not math.isclose(dx, round(dx), abs_tol=1e-7) or not math.isclose(dy, round(dy), abs_tol=1e-7):
        raise ValueError("A receiving-water input has shifted pixel centres")
    return {"source": source, "col_offset": round(dx), "row_offset": round(dy),
            "factor": factor, "provenance": provenance}


def _quantity_sources(workspace, run, grid, scope, stack, *, pollutants=None):
    pollutants = tuple(pollutants or POLLUTANTS)
    result = {}
    directory = workspace.root / "runs" / run["id"]
    for pollutant in pollutants:
        artifact = run["artifacts"][pollutant]
        if artifact.get("units") != rasters.MASS_UNITS[pollutant]:
            raise ValueError("Original model artifact requires declared " + rasters.MASS_UNITS[pollutant])
        if scope == "reporting":
            selected, factor = artifact, 1.0
            units = rasters.MASS_UNITS[pollutant]
        else:
            if (run["selection"].get("invest_version") != INVEST_VERSION
                    or run.get("runtime", {}).get("version") != INVEST_VERSION):
                raise ValueError("Native density conversion requires the selected original InVEST version")
            selected = artifact.get("native_output")
            if not isinstance(selected, dict):
                raise ValueError("The original full-domain native quantity is absent: " + pollutant)
            factor, units = float(grid["pixel_area_ha"]), rasters.RATE_UNITS[pollutant]
        path = verify_file(directory, selected)
        result[pollutant] = _aligned_source(
            stack, path, grid, factor=factor,
            provenance={"run_id": run["id"], "artifact": selected, "source_units": units,
                        "output_units": rasters.MASS_UNITS[pollutant], "multiplier": factor,
                        "quantity_scope": scope},
        )
    return result


def _read_quantity(band, window):
    import numpy as np
    from rasterio.windows import Window
    selected = Window(
        window.col_off + band["col_offset"], window.row_off + band["row_offset"],
        window.width, window.height,
    )
    original = band["source"].read(1, window=selected, masked=True, boundless=True)
    values = np.ma.getdata(original).astype("float64") * band["factor"]
    valid = ~np.ma.getmaskarray(original) & np.isfinite(values)
    if np.any(values[valid] < 0):
        raise ValueError("Original annual pollutant export contains a negative physical value")
    return values, valid


def _grid_windows(grid, geometry):
    """Visit only grid blocks intersecting a selected polygon's bounding rectangle."""
    from rasterio.transform import Affine
    from rasterio.windows import Window
    transform = Affine(*grid["transform"])
    left, bottom, right, top = geometry.bounds
    col0 = max(0, math.floor((left - transform.c) / transform.a))
    col1 = min(grid["width"], math.ceil((right - transform.c) / transform.a))
    row0 = max(0, math.floor((top - transform.f) / transform.e))
    row1 = min(grid["height"], math.ceil((bottom - transform.f) / transform.e))
    for row in range(row0 // 256 * 256, row1, 256):
        for col in range(col0 // 256 * 256, col1, 256):
            yield Window(col, row, min(256, grid["width"] - col),
                         min(256, grid["height"] - row))


def _inside(grid, geometry, window):
    from rasterio.features import geometry_mask
    from rasterio.transform import Affine
    transform = Affine(*grid["transform"]) * Affine.translation(window.col_off, window.row_off)
    return geometry_mask(
        [geometry.__geo_interface__],
        out_shape=(int(window.height), int(window.width)),
        transform=transform, invert=True, all_touched=False,
    )


def _normalization(baseline_bands, grid, domain, selection):
    import numpy as np
    pollutants = tuple(baseline_bands)
    chosen = selection.get("normalization", {"method": "baseline_max"})
    if not isinstance(chosen, dict):
        raise ValueError("Choose a receiving-water normalization record")
    method = chosen.get("method")
    if method not in ("baseline_max", "explicit"):
        raise ValueError("Normalization method must be baseline_max or explicit")
    weights = selection.get("weights", {key: 1.0 for key in pollutants})
    if not isinstance(weights, dict) or set(weights) != set(pollutants):
        raise ValueError("Priority weights must name exactly the selected physical quantities")
    weights = {key: finite(weights[key], "Pollutant priority weight", minimum=0) for key in pollutants}
    if sum(weights.values()) <= 0:
        raise ValueError("At least one pollutant priority weight must be positive")
    if method == "explicit":
        caps = chosen.get("caps", {})
        if set(caps) != set(pollutants):
            raise ValueError("Explicit caps must cover the selected separate physical quantities")
        caps = {key: finite(caps[key], "Priority normalization cap", minimum=0) for key in pollutants}
        if any(weights[key] > 0 and caps[key] <= 0 for key in pollutants):
            raise ValueError("Every positively weighted quantity needs a positive explicit cap")
        if not chosen.get("reference"):
            raise ValueError("Retain the reference or decision for explicit normalization caps")
        counts, zero = None, []
    else:
        caps, counts = {key: 0.0 for key in pollutants}, {key: 0 for key in pollutants}
        for window in _grid_windows(grid, domain):
            inside = _inside(grid, domain, window)
            if not np.any(inside):
                continue
            for key, band in baseline_bands.items():
                values, valid = _read_quantity(band, window)
                selected = inside & valid
                count = int(np.count_nonzero(selected))
                counts[key] += count
                if count:
                    caps[key] = max(caps[key], float(np.max(values[selected])))
        absent = [key for key in pollutants if weights[key] > 0 and counts[key] == 0]
        if absent:
            raise ValueError("The selected baseline has no valid annual export cells for " + ", ".join(absent))
        zero = [key for key in pollutants if weights[key] > 0 and caps[key] == 0]
        if zero:
            raise ValueError(
                "A weighted baseline quantity is zero throughout the selected domain; "
                "provide scientifically selected explicit positive caps for " + ", ".join(zero)
                + ", or set those quantity weights to zero"
            )
    return {
        "method": method, "caps": caps, "cap_units": {key: rasters.MASS_UNITS[key] for key in pollutants},
        "pollutants": list(pollutants),
        "weights": weights, "weight_sum": sum(weights.values()),
        "baseline_valid_cells": counts, "reference": chosen.get("reference"),
        "formula": "sum(weight[p] * clip(value[p] / fixed_baseline_cap[p], 0, 1)) / sum(weight)",
        "scope": selection.get("quantity_scope", "reporting"),
        "comparison": "Identical caps and weights for every receptor, union and alternative",
    }


def _score(values, validity, inside, normalization, *, direction="current"):
    import numpy as np
    pollutants = normalization["pollutants"]
    score = np.zeros(inside.shape, dtype="float64")
    valid = inside.copy()
    for key in pollutants:
        weight = normalization["weights"][key]
        if weight == 0:
            continue
        valid &= validity[key]
        selected = values[key]
        if direction == "increased_export":
            selected = np.maximum(selected, 0)
        elif direction == "avoided_export":
            selected = np.maximum(-selected, 0)
        elif direction != "current":
            raise ValueError("Unknown receiving-water priority direction")
        score += weight * np.clip(selected / normalization["caps"][key], 0, 1)
    score /= normalization["weight_sum"]
    result = np.full(inside.shape, NODATA, dtype="float32")
    result[valid] = score[valid].astype("float32")
    return result, valid


def _empty_stats():
    return {"sum": 0.0, "valid_cells": 0, "minimum": None, "maximum": None}


def _add_stats(stats, values, valid):
    import numpy as np
    count = int(np.count_nonzero(valid))
    if not count:
        return
    selected = values[valid]
    stats["sum"] += float(np.sum(selected, dtype="float64"))
    stats["valid_cells"] += count
    low, high = float(np.min(selected)), float(np.max(selected))
    stats["minimum"] = low if stats["minimum"] is None else min(stats["minimum"], low)
    stats["maximum"] = high if stats["maximum"] is None else max(stats["maximum"], high)


def _final_stats(stats, selected_cells, *, units, mass=False):
    count = stats["valid_cells"]
    return {
        **stats, "sum": stats["sum"] if count else None,
        "mean": stats["sum"] / count if count else None,
        "selected_cells": selected_cells,
        "coverage_fraction": count / selected_cells if selected_cells else None,
        "units": units, "sum_units": units.replace("/pixel", "") if mass else units,
    }


def _write_values(writer, values, valid, window):
    import numpy as np
    output = np.full(valid.shape, NODATA, dtype="float32")
    output[valid] = values[valid].astype("float32")
    if np.any(~np.isfinite(output[valid])):
        raise ValueError("A receiving-water output exceeds its retained Float32 value range")
    writer.write(output, 1, window=window)
    return output


def _raster_writer(stack, path, grid, *, units, kind, mask=False):
    import rasterio
    profile = rasters.output_profile(grid)
    profile.update(compress="deflate", predictor=1 if mask else 3, SPARSE_OK="YES")
    if mask:
        profile.update(dtype="uint8", nodata=0)
    else:
        profile.update(dtype="float32", nodata=NODATA)
    path.parent.mkdir(parents=True, exist_ok=True)
    output = stack.enter_context(rasterio.open(path, "w", **profile))
    output.update_tags(
        units=units, kind=kind, method_version=METHOD_VERSION,
        selection="pixel centre within original selected receiving-water association",
        outside_selection="NoData", source_values="native source NoData preserved",
    )
    return output


def _compute_geometry(directory, grid, geometry, baseline_bands, alternative_bands,
                      normalization, *, progress=None, mask_recipe=None):
    import numpy as np
    import rasterio
    pollutants = tuple(baseline_bands)
    started = time.monotonic()
    geometry_id = accounting.geometry_identity(grid, geometry, mask_recipe)
    extent = mask_recipe["parent"] if mask_recipe is not None else geometry
    output_root = directory / "geographies" / geometry_id
    paths, units, kinds = {}, {}, {}
    selected_count, completed_windows = 0, 0
    baseline_stats = {key: _empty_stats() for key in pollutants}
    current_stats = _empty_stats()
    alternative_stats = {
        run_id: {
            "physical": {key: _empty_stats() for key in pollutants},
            "change": {key: _empty_stats() for key in pollutants},
            "positive_change": {key: 0.0 for key in pollutants},
            "avoided_change": {key: 0.0 for key in pollutants},
            "common_baseline": {key: 0.0 for key in pollutants},
            "common_alternative": {key: 0.0 for key in pollutants},
            "increased_export": _empty_stats(), "avoided_export": _empty_stats(),
            "current": _empty_stats(),
        } for run_id in alternative_bands
    }
    with ExitStack() as stack:
        writers = {}
        def writer(key, filename, unit, kind, mask=False):
            path = output_root / filename
            paths[key], units[key], kinds[key] = path, unit, kind
            writers[key] = _raster_writer(stack, path, grid, units=unit, kind=kind, mask=mask)
            return writers[key]
        mask = writer("contribution_mask", "contribution-mask.tif", "binary",
                      "receiving-water association; 1 selected, 0 NoData", mask=True)
        current = writer("current_priority", "current-export-priority.tif", "dimensionless",
                         "current land export within receiving-water association")
        for run_id in alternative_bands:
            prefix = run_id + "_"
            writer(prefix + "current_priority", run_id + "-current-export-priority.tif",
                   "dimensionless", "alternative land export within receiving-water association")
            writer(prefix + "increased_export_priority", run_id + "-increased-export-priority.tif",
                   "dimensionless", "positive alternative-minus-baseline export priority")
            writer(prefix + "avoided_export_priority", run_id + "-avoided-export-priority.tif",
                   "dimensionless", "positive baseline-minus-alternative export priority")
            for pollutant in pollutants:
                writer(prefix + pollutant + "_change", run_id + "-" + pollutant + "-change.tif",
                       rasters.MASS_UNITS[pollutant], "signed alternative minus baseline")
        for window in (() if extent.is_empty else _grid_windows(grid, extent)):
            inside = accounting.inside(grid, geometry, window, mask_recipe)
            if not np.any(inside):
                continue
            selected_count += int(np.count_nonzero(inside))
            mask.write(inside.astype("uint8"), 1, window=window)
            baseline, baseline_valid = {}, {}
            for key, band in baseline_bands.items():
                values, valid = _read_quantity(band, window)
                baseline[key], baseline_valid[key] = values, valid & inside
                _add_stats(baseline_stats[key], values, valid & inside)
            score, valid = _score(baseline, baseline_valid, inside, normalization)
            current.write(score, 1, window=window)
            _add_stats(current_stats, score, valid)
            for run_id, bands in alternative_bands.items():
                prefix, stats = run_id + "_", alternative_stats[run_id]
                deltas, delta_valid, alternative_values, alternative_valid = {}, {}, {}, {}
                for key, band in bands.items():
                    values, valid = _read_quantity(band, window)
                    valid &= inside
                    alternative_values[key], alternative_valid[key] = values, valid
                    _add_stats(stats["physical"][key], values, valid)
                    common = valid & baseline_valid[key]
                    delta = values - baseline[key]
                    exported = _write_values(writers[prefix + key + "_change"], delta, common, window)
                    deltas[key], delta_valid[key] = delta, common
                    _add_stats(stats["change"][key], exported, common)
                    if np.any(common):
                        stats["positive_change"][key] += float(np.sum(np.maximum(delta[common], 0), dtype="float64"))
                        stats["avoided_change"][key] += float(np.sum(np.maximum(-delta[common], 0), dtype="float64"))
                        stats["common_baseline"][key] += float(np.sum(baseline[key][common], dtype="float64"))
                        stats["common_alternative"][key] += float(np.sum(values[common], dtype="float64"))
                alternative_score, score_valid = _score(
                    alternative_values, alternative_valid, inside, normalization,
                )
                writers[prefix + "current_priority"].write(alternative_score, 1, window=window)
                _add_stats(stats["current"], alternative_score, score_valid)
                for direction in ("increased_export", "avoided_export"):
                    score, score_valid = _score(deltas, delta_valid, inside, normalization, direction=direction)
                    writers[prefix + direction + "_priority"].write(score, 1, window=window)
                    _add_stats(stats[direction], score, score_valid)
            completed_windows += 1
            if progress is not None and completed_windows % 32 == 0:
                progress({"phase": "receiving_water_rasters", "geometry_id": geometry_id,
                          "completed_windows": completed_windows, "selected_cells": selected_count})
    physical = {
        key: _final_stats(value, selected_count, units=rasters.MASS_UNITS[key], mass=True)
        for key, value in baseline_stats.items()
    }
    alternative_results = {}
    for run_id, stats in alternative_stats.items():
        changes = {}
        for key in pollutants:
            count = stats["change"][key]["valid_cells"]
            changes[key] = {
                **_final_stats(stats["change"][key], selected_count,
                               units=rasters.MASS_UNITS[key], mass=True),
                "sum_increased_export": stats["positive_change"][key] if count else None,
                "sum_avoided_export": stats["avoided_change"][key] if count else None,
                "baseline_sum_on_common_cells": stats["common_baseline"][key] if count else None,
                "alternative_sum_on_common_cells": stats["common_alternative"][key] if count else None,
                "direction": "alternative minus baseline",
                "sum_basis": "stored Float32 signed difference pixels",
            }
        alternative_results[run_id] = {
            "physical": {
                key: _final_stats(value, selected_count, units=rasters.MASS_UNITS[key], mass=True)
                for key, value in stats["physical"].items()
            },
            "changes": changes,
            "current_priority": _final_stats(stats["current"], selected_count, units="dimensionless"),
            "increased_export_priority": _final_stats(stats["increased_export"], selected_count, units="dimensionless"),
            "avoided_export_priority": _final_stats(stats["avoided_export"], selected_count, units="dimensionless"),
        }
    files = {
        key: describe_file(directory, path, units=units[key], kind=kinds[key])
        for key, path in paths.items()
    }
    return {
        "geometry_id": geometry_id, "files": files,
        "selected_cells": selected_count,
        "selected_pixel_area_ha": selected_count * grid["pixel_area_ha"],
        "baseline_physical": physical,
        "current_priority": _final_stats(current_stats, selected_count, units="dimensionless"),
        "alternatives": alternative_results, "elapsed_seconds": time.monotonic() - started,
        "completed_windows": completed_windows,
    }


def _validate_runs(workspace, selection):
    reference_id = identifier(selection["baseline_run_id"])
    reference = workspace.inspect_run(reference_id)
    if reference.get("state") != "complete":
        raise ValueError("Complete the selected original baseline run for physical receiving-water analysis")
    alternatives = selection.get("alternative_run_ids", [])
    if not isinstance(alternatives, list) or len(set(alternatives)) != len(alternatives):
        raise ValueError("Choose distinct original alternative run IDs")
    if reference_id in alternatives:
        raise ValueError("The baseline cannot also be an alternative")
    result = {}
    for key in alternatives:
        run = workspace.inspect_run(identifier(key))
        if run.get("state") != "complete":
            raise ValueError("Complete original alternative run " + key)
        if run["selection"]["grid_id"] != reference["selection"]["grid_id"]:
            raise ValueError("Receiving-water comparisons require the same original grid")
        if run["selection"]["profile_id"] != reference["selection"]["profile_id"]:
            raise ValueError("Future receiving-water priorities require the same scientific profile; use the experiment workflow for parameter sensitivity")
        if run["selection"]["scenario_id"] == reference["selection"]["scenario_id"]:
            raise ValueError("A future receiving-water comparison requires an explicitly different land-cover scenario")
        scenario = workspace._get("scenarios", run["selection"]["scenario_id"])
        if scenario.get("kind") != "landcover":
            raise ValueError("Select an explicit land-cover alternative for future receiving-water priorities")
        result[key] = run
    return reference, result


def _summary_rows(subjects, baseline_id, scope):
    for subject in subjects:
        common = {
            "subject_kind": subject["kind"], "subject_id": subject["id"],
            "title": subject["title"], "family": subject["family"],
            "accounting_group_id": subject.get("accounting_group_id", ""),
            "accounting_role": subject.get("accounting_role", ""),
            "relationship": subject["relationship_precision"],
            "quantity_scope": scope, "contribution_area_ha": subject["contribution_area_ha"],
            "selected_pixel_area_ha": subject["metrics"]["selected_pixel_area_ha"],
            "selected_cells": subject["metrics"]["selected_cells"],
        }
        for pollutant, stats in subject["metrics"]["baseline_physical"].items():
            yield {
                **common, "run_id": baseline_id, "reference_run_id": baseline_id,
                "quantity": pollutant, "statistic": "current_export", "sum": stats["sum"],
                "units": TOTAL_UNITS[pollutant], "valid_cells": stats["valid_cells"],
                "coverage_fraction": stats["coverage_fraction"],
            }
        for run_id, alternative in subject["metrics"]["alternatives"].items():
            for pollutant, stats in alternative["physical"].items():
                yield {
                    **common, "run_id": run_id, "reference_run_id": baseline_id,
                    "quantity": pollutant, "statistic": "alternative_export", "sum": stats["sum"],
                    "units": TOTAL_UNITS[pollutant], "valid_cells": stats["valid_cells"],
                    "coverage_fraction": stats["coverage_fraction"],
                }
            for pollutant, stats in alternative["changes"].items():
                for statistic, field in (
                    ("alternative_minus_baseline", "sum"),
                    ("positive_increased_export", "sum_increased_export"),
                    ("positive_avoided_export", "sum_avoided_export"),
                ):
                    yield {
                        **common, "run_id": run_id, "reference_run_id": baseline_id,
                        "quantity": pollutant, "statistic": statistic, "sum": stats[field],
                        "units": TOTAL_UNITS[pollutant], "valid_cells": stats["valid_cells"],
                        "coverage_fraction": stats["coverage_fraction"],
                    }


def _write_summary(directory, subjects, geometries, crs, baseline_id, scope):
    import fiona
    from shapely.geometry import mapping, MultiPolygon
    csv_path, gpkg_path = directory / "water-quantities.csv", directory / "receiving-waters.gpkg"
    fields = (
        "subject_kind", "subject_id", "title", "family", "accounting_group_id", "accounting_role",
        "relationship", "quantity_scope",
        "contribution_area_ha", "selected_pixel_area_ha", "selected_cells", "run_id",
        "reference_run_id", "quantity", "statistic", "sum", "units", "valid_cells", "coverage_fraction",
    )
    with csv_path.open("w", encoding="utf-8", newline="") as output:
        writer = csv.DictWriter(output, fieldnames=fields)
        writer.writeheader()
        writer.writerows(_summary_rows(subjects, baseline_id, scope))
    gpkg_path.unlink(missing_ok=True)
    with rasters.vector_environment(), fiona.open(
        gpkg_path, "w", driver="GPKG", layer="receiving_waters", crs_wkt=crs.to_wkt(),
        schema={"geometry": "MultiPolygon", "properties": {
            "subject_id": "str", "kind": "str", "title": "str", "family": "str",
            "accounting_group_id": "str", "accounting_role": "str",
            "relation": "str", "area_ha": "float", "nitrogen_kg_year": "float",
            "phosphorus_kg_year": "float", "sediment_t_year": "float",
            "priority_mean": "float", "coverage": "float", "detail": "str",
        }},
    ) as output:
        for subject, geometry in zip(subjects, geometries):
            if geometry.is_empty:
                continue
            if geometry.geom_type == "Polygon":
                geometry = MultiPolygon([geometry])
            metrics = subject["metrics"]
            output.write({
                "geometry": mapping(geometry), "properties": {
                    "subject_id": subject["id"], "kind": subject["kind"],
                    "title": subject["title"], "family": subject["family"],
                    "accounting_group_id": subject.get("accounting_group_id", ""),
                    "accounting_role": subject.get("accounting_role", ""),
                    "relation": subject["relationship_precision"],
                    "area_ha": geometry.area / 10000,
                    "nitrogen_kg_year": metrics["baseline_physical"].get("nitrogen_export", {}).get("sum"),
                    "phosphorus_kg_year": metrics["baseline_physical"].get("phosphorus_export", {}).get("sum"),
                    "sediment_t_year": metrics["baseline_physical"].get("sediment_export", {}).get("sum"),
                    "priority_mean": metrics["current_priority"]["mean"],
                    "coverage": metrics["current_priority"]["coverage_fraction"],
                    "detail": canonical({
                        "relation": subject.get("relation"), "source": subject.get("source"),
                        "classification": subject.get("classification"),
                        "quantity_scope": scope, "baseline_run_id": baseline_id,
                        "metrics": metrics,
                    }).decode("utf-8"),
                },
            })
    return {
        "quantities_csv": describe_file(directory, csv_path),
        "receiving_waters_gpkg": describe_file(directory, gpkg_path),
    }


class _AnalysisCheckpoints:
    """Amortize growing aggregate records; geometry summaries remain immediate."""

    MIN_SUBJECT_BATCH = 32
    MAX_INTERVAL_SECONDS = 5.0

    def __init__(self, path, state):
        self.path = path
        self.state = state
        self.next_subject = self.MIN_SUBJECT_BATCH
        self.last_write = time.monotonic()
        self.writes = 0
        self.write_seconds = 0.0
        self.write_bytes = 0
        self.geometry = {
            "computed": 0, "restored": 0, "reused_in_memory": 0,
            "summary_read_seconds": 0.0, "summary_write_seconds": 0.0,
        }

    def write(self, reason, completed=0):
        started = time.monotonic()
        # Timing/bytes describe completed prior writes. The current write cannot
        # record its own duration without a second full manifest serialization.
        self.state["execution"] = {
            "aggregate_checkpoints": {
                "writes_including_this": self.writes + 1,
                "prior_write_seconds": self.write_seconds,
                "prior_write_bytes": self.write_bytes,
                "reason": reason,
                "completed_subjects": completed,
                "minimum_subject_batch": self.MIN_SUBJECT_BATCH,
                "maximum_interval_seconds": self.MAX_INTERVAL_SECONDS,
                "batch_policy": "completed + max(32, ceil(completed / 2))",
                "interval_scope": "checked after each completed subject",
            },
            "geometry_checkpoints": dict(self.geometry),
        }
        result = _finish_record(self.path, self.state)
        self.writes += 1
        self.write_seconds += time.monotonic() - started
        self.write_bytes += self.path.stat().st_size
        self.last_write = time.monotonic()
        self.next_subject = completed + max(
            self.MIN_SUBJECT_BATCH, (completed + 1) // 2,
        )
        return result

    def maybe_write(self, completed):
        if (completed >= self.next_subject
                or time.monotonic() - self.last_write >= self.MAX_INTERVAL_SECONDS):
            self.write("subject_progress", completed)


def analyze(workspace, selection, *, progress=None):
    """Build distinct water-specific priorities from original completed model runs.

    Input fields: plan_id, baseline_run_id, alternative_run_ids (optional),
    quantity_scope ('reporting' or 'model_domain'), weights, normalization.
    No native model execution is started by this operation.
    """
    from pyproj import CRS
    from shapely.ops import unary_union
    selection = _json_copy(selection)
    plan = inspect_plan(workspace, selection["plan_id"])
    baseline, alternatives = _validate_runs(workspace, selection)
    available = [name for name in POLLUTANTS if name in baseline["artifacts"]]
    pollutants = selection.get("pollutants", available)
    if (not isinstance(pollutants, list) or not pollutants
            or len(set(pollutants)) != len(pollutants) or set(pollutants) - set(POLLUTANTS)):
        raise ValueError("Select distinct original nitrogen_export, phosphorus_export or sediment_export quantities")
    for run in [baseline, *alternatives.values()]:
        missing = set(pollutants) - set(run["artifacts"])
        if missing:
            raise ValueError("Selected original run " + run["id"] + " lacks quantities " + ", ".join(sorted(missing)))
    prepared_grid = workspace.get_grid(baseline["selection"]["grid_id"])
    grid = prepared_grid["grid"]
    _validate_analysis_grid(grid)
    scope = selection.get("quantity_scope", "reporting")
    if scope not in ("reporting", "model_domain"):
        raise ValueError("Choose reporting or model_domain quantity scope")
    crs = CRS.from_user_input(grid["crs"])
    mask_key = "reporting_area" if scope == "reporting" else "model_domain"
    domain_path = verify_file(
        workspace.root / "grids" / prepared_grid["id"],
        prepared_grid["files"][mask_key],
    )
    domain_rows, _ = rasters.vector_geometry(domain_path, target_crs=crs)
    domain = rasters.polygon_union(domain_rows)
    definitions, subject_geometries = [], []
    family_parts = defaultdict(list)
    source_geometries = {}
    for receptor in plan["receptors"]:
        whole_geometry = _load_contribution(workspace, plan, receptor, crs)
        source_geometries[receptor["id"]] = whole_geometry
        geometry = whole_geometry.intersection(domain)
        if not geometry.is_empty and geometry.area > 0:
            geometry = _polygon(geometry, "Receiving-water/domain intersection")
        else:
            from shapely.geometry import Polygon
            geometry = Polygon()
        family_parts[receptor["family"]].append(geometry)
        definitions.append({
            "id": receptor["id"], "kind": "receptor", "title": receptor["title"],
            "family": receptor["family"], "relation": receptor["relation"],
            "source": receptor["source"], "classification": receptor.get("classification", {}),
            "relationship_precision": receptor["relationship_precision"],
            "interpretation": receptor["interpretation"],
            "contribution_area_ha": whole_geometry.area / 10000,
            "area_in_quantity_scope_ha": geometry.area / 10000,
            "area_fraction_in_quantity_scope": geometry.area / whole_geometry.area,
            "source_plan_id": plan["id"],
        })
        subject_geometries.append(geometry)
    for family in sorted(family_parts):
        geometry = unary_union(family_parts[family])
        definitions.append({
            "id": family, "kind": "family_union",
            "title": ("Drinking-water receiving areas" if family == "critical_drinking_water"
                      else "Designated high-quality-water receiving areas"),
            "family": family, "relation": {"method": "geometric union of selected receptor contribution masks"},
            "relationship_precision": "Union of the explicitly declared receptor relationship methods",
            "interpretation": "Each selected land pixel contributes once to this family total, even when receptor masks overlap.",
            "contribution_area_ha": geometry.area / 10000,
            "area_in_quantity_scope_ha": geometry.area / 10000,
            "area_fraction_in_quantity_scope": 1.0 if not geometry.is_empty else None,
            "source_plan_id": plan["id"],
            "receptor_ids": [row["id"] for row in plan["receptors"] if row["family"] == family],
        })
        subject_geometries.append(geometry)
    mask_recipes = [None] * len(definitions)
    accounting_groups, accounting_definitions, accounting_geometries, accounting_masks = accounting.compile_groups(
        plan, source_geometries, domain, selection,
    )
    definitions.extend(accounting_definitions)
    subject_geometries.extend(accounting_geometries)
    mask_recipes.extend(accounting_masks)
    identity = {
        "method_version": METHOD_VERSION, "implementation_sha256": file_digest(__file__),
        "accounting_implementation_sha256": file_digest(accounting.__file__),
        "project_id": workspace.project["id"], "selection": selection,
        "plan_record_sha256": plan["record_sha256"], "grid_id": prepared_grid["id"],
        "pollutants": pollutants,
        "baseline_selection": baseline["selection"],
        "alternative_selections": {key: value["selection"] for key, value in alternatives.items()},
        "baseline_artifacts": baseline["artifacts"],
        "alternative_artifacts": {key: value["artifacts"] for key, value in alternatives.items()},
    }
    key = digest(identity)
    directory = workspace.root / "receiving-water-analyses" / key
    state_path = directory / "analysis.json"
    with held(directory / ".analysis.lock", blocking=False):
        if state_path.exists():
            previous = inspect(workspace, key, verify=True)
            if previous["state"] == "complete":
                return {**previous, "reused": True}
            if previous["identity"] != identity:
                raise ValueError("Retained receiving-water analysis identity changed")
            state = previous
        else:
            state = {
                "schema": ANALYSIS_SCHEMA, "id": key, "state": "building", "created_at": now(),
                "identity": identity, "title": selection.get("title", plan["title"]),
                "plan_id": plan["id"], "baseline_run_id": baseline["id"],
                "alternative_run_ids": list(alternatives), "quantity_scope": scope,
                "grid": grid, "files": {}, "subjects": [], "pollutants": pollutants,
            }
        started = time.monotonic()
        state.update(state="building", resumed_at=now())
        state.pop("error", None)
        checkpoints = _AnalysisCheckpoints(state_path, state)
        checkpoints.write("start")
        try:
            with ExitStack() as stack:
                baseline_bands = _quantity_sources(workspace, baseline, grid, scope, stack, pollutants=pollutants)
                alternative_bands = {
                    run_id: _quantity_sources(workspace, run, grid, scope, stack, pollutants=pollutants)
                    for run_id, run in alternatives.items()
                }
                state["quantity_sources"] = {
                    baseline["id"]: {p: b["provenance"] for p, b in baseline_bands.items()},
                    **{rid: {p: b["provenance"] for p, b in bands.items()}
                       for rid, bands in alternative_bands.items()},
                }
                if "normalization" not in state:
                    if progress:
                        progress({"phase": "receiving_water_normalization", "analysis_id": key})
                    state["normalization"] = _normalization(baseline_bands, grid, domain, selection)
                    checkpoints.write("normalization")
                cache, subjects = {}, []
                for position, (definition, geometry, mask_recipe) in enumerate(zip(definitions, subject_geometries, mask_recipes)):
                    geometry_id = accounting.geometry_identity(grid, geometry, mask_recipe)
                    summary_path = directory / "geographies" / geometry_id / "summary.json"
                    if geometry_id in cache:
                        metrics = cache[geometry_id]
                        checkpoints.geometry["reused_in_memory"] += 1
                    elif summary_path.exists():
                        checkpoint_started = time.monotonic()
                        checkpoint = read_json(summary_path)
                        if checkpoint.get("analysis_id") != key or checkpoint.get("geometry_id") != geometry_id:
                            raise ValueError("The retained receiving-water geometry checkpoint changed")
                        if checkpoint.get("record_sha256") != _record_digest(checkpoint):
                            raise ValueError("The retained receiving-water summary changed")
                        metrics = checkpoint["metrics"]
                        for item in metrics["files"].values():
                            verify_file(directory, item)
                        cache[geometry_id] = metrics
                        checkpoints.geometry["restored"] += 1
                        checkpoints.geometry["summary_read_seconds"] += time.monotonic() - checkpoint_started
                    else:
                        extent = mask_recipe["parent"] if mask_recipe is not None else geometry
                        if extent.is_empty:
                            metrics = accounting.empty_metrics(geometry_id, pollutants, alternative_bands)
                        else:
                            metrics = _compute_geometry(
                                directory, grid, geometry, baseline_bands, alternative_bands,
                                state["normalization"], progress=progress, mask_recipe=mask_recipe,
                            )
                        checkpoint = {
                            "analysis_id": key, "geometry_id": geometry_id, "metrics": metrics,
                        }
                        checkpoint_started = time.monotonic()
                        _finish_record(summary_path, checkpoint)
                        checkpoints.geometry["summary_write_seconds"] += time.monotonic() - checkpoint_started
                        checkpoints.geometry["computed"] += 1
                        cache[geometry_id] = metrics
                    for name, item in metrics["files"].items():
                        state["files"][geometry_id + "_" + name] = item
                    subjects.append({**definition, "metrics": metrics})
                    state["subjects"] = subjects
                    state["completed_subjects"] = len(subjects)
                    state["total_subjects"] = len(definitions)
                    checkpoints.maybe_write(len(subjects))
                    if progress:
                        progress({"phase": "receiving_water_subject", "analysis_id": key,
                                  "subject_id": definition["id"], "subject_kind": definition["kind"],
                                  "completed_subjects": position + 1, "total_subjects": len(definitions)})
            state["accounting"] = accounting.summarize(accounting_groups, subjects, baseline["id"])
            state["files"].update(accounting.export(directory, state["accounting"]))
            state["files"].update(_write_summary(
                directory, subjects, subject_geometries, crs, baseline["id"], scope,
            ))
            state.update(
                state="complete", completed_at=now(),
                elapsed_seconds_this_attempt=time.monotonic() - started,
                measurement={
                    "physical": "Sum of original annual land-export quantities over valid selected pixels",
                    "selected_quantities": list(pollutants),
                    "coverage": "Valid cells divided by selected mask cells; original NoData remains absent",
                    "scenario_delta": "Alternative minus baseline over paired valid pixels",
                    "increased_export_priority": "Positive alternative-minus-baseline components using fixed baseline caps",
                    "avoided_export_priority": "Positive baseline-minus-alternative components using fixed baseline caps",
                    "overlap": "Per-receptor totals may overlap; use the family_union subject for unduplicated land totals",
                    "relationship": "Each receptor retains its exact HUC-scale, published-area or geometric-context method",
                    "accounting": "Selected nested domains use disjoint parent-mask partitions; physical values remain land export entering streams.",
                    "reservoirs": "Selected above-reservoir exports remain separate; reservoir throughput is unmodelled.",
                },
            )
            return checkpoints.write("complete", len(subjects))
        except BaseException as exc:
            state.update(state="failed", updated_at=now(),
                         elapsed_seconds_this_attempt=time.monotonic() - started,
                         error={"type": type(exc).__name__, "message": str(exc)})
            checkpoints.write("failed", len(state.get("subjects", [])))
            raise


def inspect(workspace, key, *, verify=True):
    key = identifier(key)
    directory = workspace.root / "receiving-water-analyses" / key
    result = read_json(directory / "analysis.json")
    if result.get("schema") != ANALYSIS_SCHEMA or result.get("id") != key:
        raise ValueError("Select an original receiving-water analysis")
    if digest(result["identity"]) != key or result.get("record_sha256") != _record_digest(result):
        raise ValueError("The retained receiving-water analysis changed")
    if result["identity"]["project_id"] != workspace.project["id"]:
        raise ValueError("Receiving-water analysis belongs to another original workspace")
    if verify:
        for item in result.get("files", {}).values():
            verify_file(directory, item)
    return result


def list_analyses(workspace):
    return [inspect(workspace, path.parent.name, verify=False)
            for path in sorted((workspace.root / "receiving-water-analyses").glob("*/analysis.json"))]


def delivery_layers(workspace, analysis_id, *, verify=True):
    """Return family-specific artifact descriptors for the existing delivery/viewer."""
    analysis = inspect(workspace, analysis_id, verify=verify)
    if analysis["state"] != "complete":
        raise ValueError("Finish the selected receiving-water analysis")
    return {
        "analysis_id": analysis_id, "plan_id": analysis["plan_id"],
        "baseline_run_id": analysis["baseline_run_id"],
        "alternative_run_ids": analysis["alternative_run_ids"],
        "quantity_scope": analysis["quantity_scope"],
        "pollutants": analysis.get("pollutants", list(POLLUTANTS)),
        "normalization": analysis["normalization"],
        "artifact_root": "receiving-water-analyses/" + analysis_id,
        "families": {
            row["family"]: {
                "title": row["title"], "receptor_ids": row["receptor_ids"],
                "current_priority": row["metrics"]["files"].get("current_priority"),
                "contribution_mask": row["metrics"]["files"].get("contribution_mask"),
                "baseline_physical": row["metrics"]["baseline_physical"],
                "alternatives": {
                    run_id: {
                        "current_priority": row["metrics"]["files"].get(run_id + "_current_priority"),
                        "increased_export_priority": row["metrics"]["files"].get(run_id + "_increased_export_priority"),
                        "avoided_export_priority": row["metrics"]["files"].get(run_id + "_avoided_export_priority"),
                        "physical_changes": {
                            p: row["metrics"]["files"].get(run_id + "_" + p + "_change")
                            for p in analysis.get("pollutants", list(POLLUTANTS))
                        },
                        "metrics": alternative,
                    }
                    for run_id, alternative in row["metrics"]["alternatives"].items()
                },
                "interpretation": row["interpretation"],
                "relationship_precision": row["relationship_precision"],
            }
            for row in analysis["subjects"] if row["kind"] == "family_union"
        },
        "summary_files": {
            name: analysis["files"][name]
            for name in ("quantities_csv", "receiving_waters_gpkg")
        },
        "measurement": analysis["measurement"],
    }
