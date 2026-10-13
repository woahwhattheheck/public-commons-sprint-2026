"""Join retained receiving-water priorities to the original monitoring workflow.

Original HUC polygons/ToHUC and station points remain source records. Derived
weights are explicitly either projected overlap hectares or priority-weighted
whole-cell hectares. The original monitoring solver, costs and campaigns own
all subsequent design decisions.
"""
from __future__ import annotations

import json
import math
import os
from pathlib import Path

from .common import (atomic_json, canonical, describe_file, digest, file_digest,
                     held, identifier, now, read_json, verify_file)
from . import rasters, receiving_waters as water

SCHEMA = "upstate.receiving-water-monitoring/v1"
METHOD_VERSION = "receiving-water-monitoring/1"
FOLDER = "receiving-water-monitoring"
SOURCE_ID = "receiving-water-monitoring-catchments"
PREFIX = "rwmon_"
MODES = {"contribution_area", "priority_weighted_area"}
STATISTICS = {"current_priority", "increased_export_priority", "avoided_export_priority"}


def _copy(value):
    return json.loads(canonical(value))


def _text(value, label):
    if not isinstance(value, str) or not value.strip():
        raise ValueError("Supply " + label)
    return value.strip()


def _record_hash(record):
    return digest({k: v for k, v in record.items() if k != "record_sha256"})


def _finish(path, value):
    record = {**value, "record_sha256": _record_hash(value)}
    atomic_json(path, record, immutable=True)
    return record


def _selection(value):
    value = _copy(value)
    allowed = {"title", "mode", "plan_id", "receptor_ids", "catchments",
               "analysis_id", "subject", "statistic", "run_id", "stations", "stratum_field"}
    if not isinstance(value, dict) or set(value) - allowed:
        raise ValueError("Select the supported receiving-water monitoring fields")
    value["title"] = _text(value.get("title"), "a monitoring-source title")
    value["plan_id"] = identifier(value.get("plan_id"))
    if value.get("mode") not in MODES:
        raise ValueError("Choose contribution_area or priority_weighted_area")
    source = value.get("catchments")
    if not isinstance(source, dict) or set(source) - {
            "source_collection_id", "source_id", "layer", "id_field", "downstream_field"}:
        raise ValueError("Choose one retained original catchment source and its HUC/ToHUC fields")
    source["source_collection_id"] = identifier(source.get("source_collection_id"))
    for name in ("source_id", "id_field", "downstream_field"):
        source[name] = _text(source.get(name), "catchments." + name)
    if value["mode"] == "contribution_area":
        if any(name in value for name in ("analysis_id", "subject", "statistic", "run_id")):
            raise ValueError("Contribution-area mode uses source receptors, not analysis selections")
        ids = value.get("receptor_ids")
        if not isinstance(ids, list) or not ids or len(ids) != len(set(ids)):
            raise ValueError("Select distinct original receiving-water receptor IDs")
        value["receptor_ids"] = sorted(_text(x, "receptor ID") for x in ids)
    else:
        if value.get("receptor_ids"):
            raise ValueError("Priority mode uses one exact analysis subject")
        value.pop("receptor_ids", None)
        value["analysis_id"] = identifier(value.get("analysis_id"))
        subject = value.get("subject")
        if not isinstance(subject, dict) or set(subject) != {"kind", "id"}:
            raise ValueError("Select the exact saved analysis subject kind and ID")
        if subject["kind"] not in {"receptor", "family_union"}:
            raise ValueError("Select a receptor or family_union analysis subject")
        subject["id"] = _text(subject["id"], "analysis subject ID")
        if value.get("statistic") not in STATISTICS:
            raise ValueError("Select current, increased-export or avoided-export priority")
        if value.get("run_id") is not None:
            value["run_id"] = identifier(value["run_id"])
    stations = value.get("stations")
    if stations is not None:
        if not isinstance(stations, dict) or set(stations) - {
                "source_collection_id", "source_id", "layer", "id_field",
                "huc_field", "outlet_field", "assignments"}:
            raise ValueError("Select original station fields and optional explicit assignments")
        stations["source_collection_id"] = identifier(stations.get("source_collection_id"))
        stations["source_id"] = _text(stations.get("source_id"), "station source ID")
        stations["id_field"] = _text(stations.get("id_field"), "station ID field")
        for name in ("huc_field", "outlet_field"):
            if stations.get(name) is not None:
                stations[name] = _text(stations[name], "station " + name)
        if stations.get("assignments") is not None and not isinstance(stations["assignments"], dict):
            raise ValueError("Station assignments must map original station IDs to original HUC IDs")
    if value.get("stratum_field") is not None:
        value["stratum_field"] = _text(value["stratum_field"], "original stratum field")
    return value


def _station_identity(workspace, selected):
    if not selected:
        return None
    path, entry = workspace.source_file(selected["source_collection_id"], selected["source_id"])
    if entry["kind"] != "vector":
        raise ValueError("Stations require an original retained vector point source")
    return {"selection": selected, "source": entry, "actual_sha256": file_digest(path)}


def _context(workspace, selection):
    from pyproj import CRS
    from shapely.ops import unary_union

    plan = water.inspect_plan(workspace, selection["plan_id"])
    analysis = None
    subject = None
    raster_item = None
    raster_path = None
    if selection["mode"] == "contribution_area":
        receptors = {row["id"]: row for row in plan["receptors"]}
        if set(selection["receptor_ids"]) - set(receptors):
            raise ValueError("Selected receptor is absent from the original receiving-water plan")
        crs = CRS.from_user_input(plan["analysis_crs"])
        geometry = unary_union([water._load_contribution(workspace, plan, receptors[key], crs)
                                for key in selection["receptor_ids"]])
        relations = [{"id": key, "relation": receptors[key]["relation"],
                      "interpretation": receptors[key]["interpretation"]}
                     for key in selection["receptor_ids"]]
    else:
        analysis = water.inspect(workspace, selection["analysis_id"])
        if analysis["state"] != "complete" or analysis["plan_id"] != plan["id"]:
            raise ValueError("Choose a complete original analysis of this receiving-water plan")
        found = [row for row in analysis["subjects"]
                 if row["kind"] == selection["subject"]["kind"] and row["id"] == selection["subject"]["id"]]
        if len(found) != 1:
            raise ValueError("Select an exact saved receiving-water analysis subject")
        subject = found[0]
        run_id = selection.get("run_id") or analysis["baseline_run_id"]
        if run_id not in [analysis["baseline_run_id"], *analysis["alternative_run_ids"]]:
            raise ValueError("Select the baseline or an actual alternative in this analysis")
        statistic = selection["statistic"]
        if run_id == analysis["baseline_run_id"] and statistic != "current_priority":
            raise ValueError("Increased/avoided priority requires its actual alternative run")
        selection["run_id"] = run_id
        role = statistic if run_id == analysis["baseline_run_id"] else run_id + "_" + statistic
        raster_item = subject["metrics"].get("files", {}).get(role)
        if not raster_item:
            raise ValueError("The selected subject has no retained raster for this priority statistic")
        if raster_item.get("units") != "dimensionless":
            raise ValueError("The original selected artifact must be a dimensionless priority")
        raster_path = verify_file(workspace.root / "receiving-water-analyses" / analysis["id"], raster_item)
        crs = CRS.from_user_input(analysis["grid"]["crs"])
        receptor_ids = [subject["id"]] if subject["kind"] == "receptor" else subject["receptor_ids"]
        receptors = {row["id"]: row for row in plan["receptors"]}
        geometry = unary_union([water._load_contribution(workspace, plan, receptors[key], crs)
                                for key in receptor_ids])
        # The retained priority raster already applies the analysis quantity scope.
        # Keep exact vector intersection area separate from its actual cell support.
        grid_record = workspace.get_grid(analysis["identity"]["grid_id"])
        mask_role = "reporting_area" if analysis["quantity_scope"] == "reporting" else "model_domain"
        mask_path = verify_file(workspace.root / "grids" / grid_record["id"], grid_record["files"][mask_role])
        masks, _ = rasters.vector_geometry(mask_path, target_crs=crs)
        geometry = geometry.intersection(rasters.polygon_union(masks))
        relations = [{"id": key, "relation": receptors[key]["relation"],
                      "interpretation": receptors[key]["interpretation"]} for key in receptor_ids]
    if not crs.is_projected or any(abs(axis.unit_conversion_factor - 1) > 1e-12 for axis in crs.axis_info[:2]):
        raise ValueError("Monitoring overlap/affine areas require the selected original projected metre CRS")
    if geometry.is_empty or geometry.area <= 0 or not geometry.is_valid:
        raise ValueError("The selected receiving-water scope has no valid positive-area geometry")
    rows, source_identity = water._source(workspace, selection["catchments"], crs)
    graph = water.huc_graph(rows, id_field=selection["catchments"]["id_field"],
                           downstream_field=selection["catchments"]["downstream_field"])
    selected = []
    for row in rows:
        properties = row["properties"]
        key = water._huc(properties[water._field(properties, selection["catchments"]["id_field"])])
        original = water._polygon(row["geometry"], "Original catchment " + key)
        overlap = original.intersection(geometry)
        if any(str(name).startswith(PREFIX) for name in properties):
            raise ValueError("Original catchment fields already use the reserved rwmon_ prefix")
        selected.append({**row, "huc": key, "geometry": original, "overlap": overlap})
    selected.sort(key=lambda row: row["huc"])
    if not selected or not any(row["overlap"].area > 0 for row in selected):
        raise ValueError("No original catchment has positive-area overlap with this receiving-water scope")
    # A partition is required: don't count overlapping source HUC polygons twice.
    from shapely.strtree import STRtree
    polygons = [row["geometry"] for row in selected]
    index = STRtree(polygons)
    for i, polygon in enumerate(polygons):
        for j in index.query(polygon):
            j = int(j)
            if j > i and polygon.intersection(polygons[j]).area > 1e-6:
                raise ValueError("Original catchments overlap in area; select the corrected original HUC partition")
    station_identity = _station_identity(workspace, selection.get("stations"))
    return {"plan": plan, "analysis": analysis, "subject": subject, "crs": crs,
            "geometry": geometry, "rows": selected, "graph": graph,
            "catchment_identity": source_identity, "station_identity": station_identity,
            "raster_item": raster_item, "raster_path": raster_path, "relations": relations}


def _priority_totals(context, progress):
    import numpy as np
    import rasterio
    from rasterio.features import rasterize
    from shapely.geometry import mapping, box
    from shapely.strtree import STRtree

    rows = context["rows"]
    stats = {row["huc"]: {"priority": 0.0, "valid_cells": 0, "scope_cells": 0,
                         "invalid_cells": 0} for row in rows}
    shapes = [row["geometry"] for row in rows]
    index = STRtree(shapes)
    coverage = {"unassigned_scope_cells": 0, "unassigned_valid_cells": 0,
                "unassigned_priority": 0.0}
    with rasterio.open(context["raster_path"]) as source:
        grid = context["analysis"]["grid"]
        if (source.count != 1 or source.width != grid["width"] or source.height != grid["height"]
                or source.crs != context["crs"]
                or any(abs(a-b) > 1e-9 for a, b in zip(tuple(source.transform)[:6], grid["transform"][:6]))):
            raise ValueError("Selected priority raster differs from its retained native analysis grid")
        transform = source.transform
        pixel_ha = abs(transform.a * transform.e - transform.b * transform.d) / 10000
        if not math.isfinite(pixel_ha) or pixel_ha <= 0:
            raise ValueError("The native priority raster has no positive finite affine pixel area")
        for completed, window in enumerate(water._grid_windows(grid, context["geometry"]), 1):
            window_transform = source.window_transform(window)
            corners = [window_transform * point for point in
                       [(0, 0), (window.width, 0), (0, window.height), (window.width, window.height)]]
            bounds = box(min(x for x, y in corners), min(y for x, y in corners),
                         max(x for x, y in corners), max(y for x, y in corners))
            candidates = sorted((int(i) for i in index.query(bounds)
                                 if rows[int(i)]["overlap"].area > 0), reverse=True)
            # Replacement order gives the lexically first HUC a shared boundary centre.
            labels = (rasterize([(mapping(shapes[i]), i + 1) for i in candidates],
                                out_shape=(int(window.height), int(window.width)),
                                transform=window_transform, fill=0, dtype="int32", all_touched=False)
                      if candidates else np.zeros((int(window.height), int(window.width)), dtype="int32"))
            scope = water._inside(grid, context["geometry"], window)
            values = source.read(1, window=window, masked=True)
            finite = np.isfinite(values.data)
            source_valid = (~np.ma.getmaskarray(values)) & finite & scope
            valid = source_valid & (labels > 0)
            coverage["unassigned_scope_cells"] += int(np.count_nonzero(scope & (labels == 0)))
            unassigned = source_valid & (labels == 0)
            coverage["unassigned_valid_cells"] += int(np.count_nonzero(unassigned))
            coverage["unassigned_priority"] += float(np.sum(values.data[unassigned], dtype="float64")) * pixel_ha
            if np.any(source_valid & ((values.data < 0) | (values.data > 1))):
                raise ValueError("Saved dimensionless priority contains values outside [0, 1]")
            for i in candidates:
                member = (labels == i + 1) & scope
                selected = member & valid
                key = rows[i]["huc"]
                stats[key]["scope_cells"] += int(np.count_nonzero(member))
                stats[key]["valid_cells"] += int(np.count_nonzero(selected))
                stats[key]["invalid_cells"] += int(np.count_nonzero(member & ~valid))
                stats[key]["priority"] += float(np.sum(values.data[selected], dtype="float64")) * pixel_ha
            if progress is not None and completed % 32 == 0:
                progress({"phase": "receiving_water_monitoring_weights", "completed_windows": completed})
    if sum(row["valid_cells"] for row in stats.values()) == 0:
        raise ValueError("Selected catchments contain no valid cells in this saved priority raster")
    return stats, pixel_ha, coverage


def _link_verified(source, destination):
    source, destination = Path(source), Path(destination)
    destination.parent.mkdir(parents=True, exist_ok=True)
    if destination.exists():
        if source.stat().st_size != destination.stat().st_size or file_digest(source) != file_digest(destination):
            raise ValueError("Retained monitoring companion differs on resume")
        return
    try:
        os.link(source, destination)
    except FileExistsError:
        _link_verified(source, destination)
    except OSError:
        # Cross-device fallback with the original atomic byte writer.
        from .common import atomic_bytes
        atomic_bytes(destination, source.read_bytes(), immutable=True)


def _original_companions(workspace, context, directory):
    plan = context["plan"]
    originals = []
    def retain(path, name):
        target = directory / "original" / name
        _link_verified(path, target)
        originals.append(target)
    retain(workspace.root / "receiving-water-plans" / plan["id"] / "plan.json", "receiving-water-plan.json")
    ids = {row["id"] for row in context["relations"]}
    for receptor in plan["receptors"]:
        if receptor["id"] in ids:
            for role in ("receptor_geometry", "contribution_geometry"):
                item = receptor[role]
                path = verify_file(workspace.root / "receiving-water-plans" / plan["id"], item)
                retain(path, "receptors/" + digest(receptor["id"])[:20] + "-" + role + path.suffix)
    if context["analysis"]:
        retain(workspace.root / "receiving-water-analyses" / context["analysis"]["id"] / "analysis.json",
               "receiving-water-analysis.json")
        retain(context["raster_path"], "selected-priority.tif")
    selection = context["catchment_identity"]["selection"]
    _, entry = workspace.source_file(selection["source_collection_id"], selection["source_id"])
    collection = workspace._get("sources", selection["source_collection_id"])
    path = directory / "original" / "catchment-source-edition.json"
    atomic_json(path, collection, immutable=True)
    originals.append(path)
    for body in [entry["body"], *entry.get("companions", [])]:
        source = workspace.root / body["object"]
        name = Path(body.get("view_path", body["filename"]))
        if name.is_absolute() or ".." in name.parts or "\\" in str(name):
            raise ValueError("Original catchment companion must have a portable relative name")
        retain(source, "catchments/" + name.as_posix())
    return originals


def _write_prepared(workspace, selection, context, directory, intent, progress):
    from pyproj import CRS, Transformer
    from shapely.geometry import mapping
    from shapely.ops import transform

    stats, pixel_ha, raster_coverage = (None, None, None)
    if selection["mode"] == "priority_weighted_area":
        stats, pixel_ha, raster_coverage = _priority_totals(context, progress)
    project = Transformer.from_crs(context["crs"], CRS.from_epsg(4326), always_xy=True)
    features, total = [], {"catchments": len(context["rows"]), "overlap_ha": 0.0,
                           "priority": 0.0, "valid_cells": 0, "scope_cells": 0,
                           "invalid_cells": 0, "external_downstream_edges": 0}
    retained_ids = {row["huc"] for row in context["rows"]}
    recommended_excluded = [row["huc"] for row in context["rows"] if row["overlap"].area <= 0]
    total.update(in_scope_catchments=len(retained_ids) - len(recommended_excluded),
                 context_catchments=len(recommended_excluded),
                 scope_area_ha=context["geometry"].area / 10000)
    graph = context["graph"]
    for row in context["rows"]:
        key = row["huc"]
        overlap_ha = row["overlap"].area / 10000
        metric = stats[key] if stats is not None else None
        downstream = graph["nodes"][key]["downstream"]
        props = dict(row["properties"])
        props.update(rwmon_huc12=key, rwmon_tohuc=downstream,
                     rwmon_original_feature_id=row["id"],
                     rwmon_overlap_ha=overlap_ha, rwmon_in_scope=overlap_ha > 0,
                     rwmon_priority=metric["priority"] if metric is not None else overlap_ha,
                     rwmon_mode=selection["mode"],
                     rwmon_units="priority_weighted_ha" if metric is not None else "ha",
                     rwmon_bridge_id=intent["id"])
        if metric is not None:
            props.update(rwmon_valid_cells=metric["valid_cells"], rwmon_scope_cells=metric["scope_cells"],
                         rwmon_invalid_cells=metric["invalid_cells"],
                         rwmon_valid_ha=metric["valid_cells"] * pixel_ha,
                         rwmon_scope_ha=metric["scope_cells"] * pixel_ha,
                         rwmon_valid_fraction=(metric["valid_cells"] / metric["scope_cells"]
                                               if metric["scope_cells"] else None))
            for field in ("valid_cells", "scope_cells", "invalid_cells"):
                total[field] += metric[field]
        total["overlap_ha"] += overlap_ha
        total["priority"] += props["rwmon_priority"]
        total["external_downstream_edges"] += bool(
            graph["nodes"][key]["downstream_status"] in {"known_huc", "outside_retained_network"}
            and downstream not in retained_ids)
        features.append({"type": "Feature", "id": row["id"], "properties": props,
                         "geometry": mapping(transform(project.transform, row["geometry"]))})
    total["unassigned_overlap_ha"] = max(0.0, total["scope_area_ha"] - total["overlap_ha"])
    if raster_coverage is not None:
        total.update(raster_coverage)
        total["unassigned_valid_ha"] = raster_coverage["unassigned_valid_cells"] * pixel_ha
    if stats is None:
        for name in ("valid_cells", "scope_cells", "invalid_cells"):
            total[name] = None
    method = {
        "schema": "upstate.receiving-water-monitoring-method/v1",
        "id": intent["id"], "method_version": METHOD_VERSION,
        "workspace_id": workspace.project["id"], "selection": selection,
        "created_at": intent["created_at"], "mode": selection["mode"],
        "priority_field": "rwmon_priority", "id_field": "rwmon_huc12", "downstream_field": "rwmon_tohuc",
        "units": "priority_weighted_ha" if stats is not None else "ha",
        "area_method": {"vector_overlap": "Original HUC intersected with the union of selected original contribution geometries; projected square metres / 10000",
                        "vector_crs": context["crs"].to_wkt(),
                        "raster_support": ("Original pixel-centre membership, whole affine pixel hectares"
                                           if stats is not None else None),
                        "pixel_area_ha": pixel_ha,
                        "boundary_tie": ("Stable descending-HUC GDAL centre rasterization; lexically first wins any shared inclusion; every original cell is assigned at most once"
                                         if stats is not None else None)},
        "formula": ("sum(original saved dimensionless score * original affine pixel hectares)"
                    if stats is not None else "area(original HUC intersection with selected contribution union) / 10000"),
        "interpretation": "A planning coverage weight over original catchments; site suitability, monitoring efficacy and measured concentration remain separate",
        "catchment_source": context["catchment_identity"],
        "station_source": context["station_identity"],
        "relations": context["relations"],
        "original_plan": {"id": context["plan"]["id"], "record_sha256": context["plan"]["record_sha256"]},
        "geometry": "Complete original HUC geometries and ToHUC graph projected to WGS84; positive-area scope intersection identifies candidate HUCs without clipping or creating station coordinates",
        "candidate_scope_field": "rwmon_in_scope",
        "recommended_excluded_ids": recommended_excluded,
        "candidate_policy": "Outside-scope HUCs retain zero weight and complete flow-path context; the existing design excluded_ids can restrict candidate selection without removing graph nodes",
        "station_policy": "Original point coordinates and explicit source fields; boundary/outside-domain assignments remain visible; upstream credit requires original Boolean outlet verification",
        "topology": "Original ToHUC target text retained, including targets outside selected candidate HUCs",
        "outlet_values": sorted({"", "0", "000000000000", *[str(row["value"]) for row in graph["terminal_markers"]]}),
        "original_network": {"external_exits": graph["external_exits"], "missing_downstream": graph["missing_downstream"], "terminal_markers": graph["terminal_markers"]},
        "missing_support": "Masked, nonfinite and NoData pixels excluded; valid zero priority retains valid cell support; vector overlap and raster centre area are distinct",
        "summary": total,
    }
    if context["analysis"]:
        analysis = context["analysis"]
        method["original_analysis"] = {
            "id": analysis["id"], "record_sha256": analysis["record_sha256"],
            "subject": selection["subject"], "statistic": selection["statistic"], "run_id": selection["run_id"],
            "raster": context["raster_item"], "grid": analysis["grid"],
            "quantity_scope": analysis["quantity_scope"], "normalization": analysis["normalization"],
            "pollutants": analysis["pollutants"], "identity": analysis["identity"],
            "quantity_sources": analysis.get("quantity_sources", {}),
        }
    geojson_path, method_path = directory / "catchments.geojson", directory / "method.json"
    atomic_json(geojson_path, {"type": "FeatureCollection", "features": features}, immutable=True)
    atomic_json(method_path, method, immutable=True)
    originals = _original_companions(workspace, context, directory)
    companions = [method_path, *originals]
    manifest = {"schema": "upstate.sources/v1", "title": selection["title"],
                "captured_at": intent["created_at"],
                "scope": {"kind": "derived-monitoring-planning-source", "bridge_id": intent["id"],
                          "original_catchment_collection_id": selection["catchments"]["source_collection_id"]},
                "notes": [method["formula"], method["interpretation"], method["missing_support"]],
                "entries": [{"id": SOURCE_ID, "kind": "vector", "title": selection["title"],
                             "uri": "urn:upstate:receiving-water-monitoring:" + intent["id"],
                             "vintage": intent["created_at"], "path": "catchments.geojson",
                             "sha256": file_digest(geojson_path), "role": "monitoring-planning-catchments",
                             "metadata": {"method": method, "derived": True},
                             "companions": [{"path": p.relative_to(directory).as_posix(), "sha256": file_digest(p)}
                                            for p in companions]}]}
    manifest_path = directory / "sources.json"
    atomic_json(manifest_path, manifest, immutable=True)
    files = {p.relative_to(directory).as_posix(): describe_file(directory, p)
             for p in [geojson_path, method_path, manifest_path, *originals]}
    return _finish(directory / "prepared.json", {"id": intent["id"], "method": method, "files": files,
                                                "summary": total})


def _network_kwargs(selection, collection_id, method):
    kwargs = {"domain_source_id": SOURCE_ID, "domain_collection_id": collection_id,
              "id_field": "rwmon_huc12", "downstream_field": "rwmon_tohuc",
              "priority_field": "rwmon_priority", "title": selection["title"],
              "outlet_values": method["outlet_values"]}
    if selection.get("stratum_field"):
        kwargs["stratum_field"] = selection["stratum_field"]
    stations = selection.get("stations")
    if stations:
        kwargs.update(station_source_id=stations["source_id"],
                      station_collection_id=stations["source_collection_id"],
                      station_id_field=stations["id_field"])
        for selected, native in (("layer", "station_layer"), ("huc_field", "station_huc_field"),
                                 ("outlet_field", "station_outlet_field"), ("assignments", "station_assignments")):
            if stations.get(selected) is not None:
                kwargs[native] = stations[selected]
    return kwargs


def _network(workspace, selection, collection_id, method):
    """Recover a completed native import if its process ended before bridge commit."""
    from .monitoring_workspace import MonitoringWorkspace
    from .monitoring_network import build_network
    from .monitoring_sources import read_source

    kwargs = _network_kwargs(selection, collection_id, method)
    domain, domain_binding = read_source(workspace, SOURCE_ID, collection_id=collection_id)
    stations, station_binding = None, None
    choice = selection.get("stations")
    if choice:
        stations, station_binding = read_source(workspace, choice["source_id"],
                                                collection_id=choice["source_collection_id"], layer=choice.get("layer"))
    options = {k: v for k, v in kwargs.items()
               if k not in {"domain_source_id", "domain_collection_id", "station_source_id",
                            "station_collection_id", "station_layer"}}
    expected = build_network(domain, stations, source_bindings={"domain": domain_binding, "stations": station_binding}, **options)
    def comparable(value):
        return {k: v for k, v in value.items() if k not in {"schema", "id", "created_at"}}
    service = MonitoringWorkspace(workspace)
    for path in sorted((workspace.root / "monitoring_networks").glob("*.json")):
        record = service.get("networks", path.stem)
        if record.get("source_bindings", {}).get("domain", {}).get("source_collection_id") == collection_id:
            if comparable(record) == comparable(expected):
                service.verify_sources(record)
                return record
    record = service.import_network(**kwargs)
    if comparable(record) != comparable(expected):
        raise ValueError("Original monitoring importer returned a different selected network")
    return record


def prepare(workspace, selection, *, progress=None):
    with held(workspace.root / ".receiving-water-monitoring.lock", blocking=False):
        return _prepare(workspace, selection, progress=progress)


def _prepare(workspace, selection, *, progress=None):
    selection = _selection(selection)
    context = _context(workspace, selection)
    identity = {"method_version": METHOD_VERSION, "implementation_sha256": file_digest(__file__),
                "workspace_id": workspace.project["id"], "selection": selection,
                "plan_record_sha256": context["plan"]["record_sha256"],
                "analysis_record_sha256": context["analysis"]["record_sha256"] if context["analysis"] else None,
                "catchment_source": context["catchment_identity"], "station_source": context["station_identity"],
                "priority_artifact": context["raster_item"]}
    key = digest(identity)
    directory = workspace.root / FOLDER / key
    with held(directory / ".bridge.lock", blocking=False):
        if (directory / "bridge.json").exists():
            return {**inspect(workspace, key), "reused": True}
        intent_path = directory / "intent.json"
        if intent_path.exists():
            intent = read_json(intent_path)
            if intent.get("id") != key or intent.get("identity") != identity:
                raise ValueError("Original receiving-water monitoring intent changed")
        else:
            intent = {"id": key, "identity": identity, "created_at": now()}
            atomic_json(intent_path, intent, immutable=True)
        prepared_path = directory / "prepared.json"
        if prepared_path.exists():
            prepared = read_json(prepared_path)
            if prepared.get("id") != key or prepared.get("record_sha256") != _record_hash(prepared):
                raise ValueError("Original prepared monitoring source changed")
            for item in prepared["files"].values():
                verify_file(directory, item)
        else:
            if progress:
                progress({"phase": "receiving_water_monitoring_source", "bridge_id": key})
            prepared = _write_prepared(workspace, selection, context, directory, intent, progress)
        collection = workspace.import_sources(directory / "sources.json")
        network = _network(workspace, selection, collection["id"], prepared["method"])
        record = {"schema": SCHEMA, "id": key, "state": "complete", "title": selection["title"],
                  "identity": identity, "mode": selection["mode"], "created_at": intent["created_at"],
                  "plan_id": selection["plan_id"], "analysis_id": selection.get("analysis_id"),
                  "network_id": network["id"], "source_collection_id": collection["id"], "source_id": SOURCE_ID,
                  "method": prepared["method"], "summary": prepared["summary"], "files": prepared["files"],
                  "station_assignment_issues": network.get("station_assignment_issues", []),
                  "network_summary": network["summary"]}
        return _finish(directory / "bridge.json", record)


def inspect(workspace, key, *, verify=True):
    key = identifier(key)
    directory = workspace.root / FOLDER / key
    record = read_json(directory / "bridge.json")
    if (record.get("schema") != SCHEMA or record.get("state") != "complete" or record.get("id") != key
            or digest(record["identity"]) != key or record.get("record_sha256") != _record_hash(record)
            or record["identity"]["workspace_id"] != workspace.project["id"]):
        raise ValueError("Select an unchanged complete monitoring bridge in this original Workspace")
    if verify:
        from .monitoring_workspace import MonitoringWorkspace

        for item in record["files"].values():
            verify_file(directory, item)
        workspace.source_file(record["source_collection_id"], record["source_id"])
        service = MonitoringWorkspace(workspace)
        network = service.get("networks", record["network_id"])
        if network["source_bindings"]["domain"]["source_collection_id"] != record["source_collection_id"]:
            raise ValueError("Monitoring bridge network refers to another derived source")
        service.verify_sources(network)
    return record


def catalog(workspace):
    """One manifest-only pass for the existing operator snapshot; no raster reads."""
    records = []
    for path in sorted((workspace.root / FOLDER).glob("*/bridge.json")):
        record = inspect(workspace, path.parent.name, verify=False)
        records.append({name: record.get(name) for name in (
            "id", "state", "title", "mode", "created_at", "plan_id", "analysis_id",
            "network_id", "source_collection_id", "source_id", "summary", "network_summary",
            "station_assignment_issues")})
    return records
