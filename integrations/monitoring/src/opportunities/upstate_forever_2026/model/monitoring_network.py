"""Source-bound hydrologic monitoring domain; no generated field coordinates.

All IDs remain strings. GeoJSON coordinates must be WGS84. Geometry, source
bindings and station ambiguity survive every design/export round-trip.
"""
from __future__ import annotations

import math
from collections import defaultdict, deque
from typing import Any

from pyproj import Geod
from shapely.geometry import shape, mapping
from shapely.validation import explain_validity
from .monitoring_common import ContractError, digest

GEOD = Geod(ellps="WGS84")
SCHEMA = "eco.monitoring.network/1"


def number(value: Any, name: str, *, minimum: float = 0.0) -> float:
    if isinstance(value, bool):
        raise ContractError(f"{name} must be a finite number")
    try:
        result = float(value)
    except (ValueError, TypeError, OverflowError) as exc:
        raise ContractError(f"{name} must be a finite number") from exc
    if not math.isfinite(result) or result < minimum:
        raise ContractError(f"{name} must be finite and >= {minimum}")
    return result


def identifier(value: Any, name: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ContractError(f"{name} must be a nonempty string; retain leading zeroes")
    return value.strip()


def features(value: Any, label: str) -> list[dict]:
    if not isinstance(value, dict) or value.get("type") != "FeatureCollection":
        raise ContractError(f"{label} must be a GeoJSON FeatureCollection")
    crs = value.get("crs")
    if crs:
        name = str(crs.get("properties", {}).get("name", ""))
        if name not in {"EPSG:4326", "urn:ogc:def:crs:OGC:1.3:CRS84", "urn:ogc:def:crs:EPSG::4326"}:
            raise ContractError(f"{label}: transform the source to WGS84 before intake")
    values = value.get("features")
    if not isinstance(values, list):
        raise ContractError(f"{label}.features must be an array")
    return values


def geometry(feature: dict, label: str, expected: set[str]):
    try:
        if not isinstance(feature, dict) or feature.get("type") != "Feature":
            raise ValueError("not a feature")
        geom = shape(feature["geometry"])
        if geom.geom_type not in expected or geom.is_empty:
            raise ValueError(f"expected {sorted(expected)}")
        if not geom.is_valid:
            raise ValueError(explain_validity(geom))
        bounds = geom.bounds
        if not all(math.isfinite(v) for v in bounds) or not (-180 <= bounds[0] <= bounds[2] <= 180 and -90 <= bounds[1] <= bounds[3] <= 90):
            raise ValueError("coordinates not finite WGS84 longitude/latitude")
        return geom
    except (KeyError, ValueError, TypeError) as exc:
        raise ContractError(f"{label}: invalid geometry ({exc})") from exc


def _area(geom) -> float:
    # Summing polygon components avoids cancellation across mixed ring winding.
    from shapely.geometry.polygon import orient
    polygons = [geom] if geom.geom_type == "Polygon" else list(geom.geoms)
    return sum(abs(GEOD.geometry_area_perimeter(orient(p, sign=1.0))[0]) for p in polygons)


def topological_order(nodes: dict[str, dict]) -> list[str]:
    indegree = {key: 0 for key in nodes}
    for node in nodes.values():
        target = node["downstream_id"]
        if target in indegree:
            indegree[target] += 1
    queue = deque(sorted(key for key, n in indegree.items() if n == 0))
    order = []
    while queue:
        key = queue.popleft()
        order.append(key)
        downstream = nodes[key]["downstream_id"]
        if downstream in indegree:
            indegree[downstream] -= 1
            if not indegree[downstream]:
                queue.append(downstream)
    if len(order) != len(nodes):
        unresolved = sorted(key for key, n in indegree.items() if n)
        raise ContractError(f"hydrologic graph contains a directed cycle: {unresolved[:20]}")
    return order


def build_network(domain: dict, station_collection: dict | None, *, source_bindings: dict,
                  id_field: str = "huc12", downstream_field: str = "tohuc",
                  stratum_field: str | None = None, priority_field: str | None = None,
                  station_id_field: str = "site_no", station_huc_field: str | None = None,
                  station_outlet_field: str | None = None, station_assignments: dict | None = None,
                  outlet_values: list[str] | None = None, title: str = "Monitoring domain") -> dict:
    if not source_bindings.get("domain"):
        raise ContractError("a retained domain source binding is required")
    if station_collection is not None and not source_bindings.get("stations"):
        raise ContractError("station metadata requires its retained source binding")
    sentinel = set(outlet_values if outlet_values is not None else ["", "0", "000000000000"])
    overrides = dict(station_assignments or {})
    nodes, geoms = {}, {}
    for index, feature in enumerate(features(domain, "domain")):
        props = feature.get("properties") or {}
        key = identifier(props.get(id_field), f"domain feature {index}.{id_field}")
        if key in nodes:
            raise ContractError(f"duplicate catchment id: {key}")
        geom = geometry(feature, f"catchment {key}", {"Polygon", "MultiPolygon"})
        raw = props.get(downstream_field)
        if raw is None:
            downstream = None
        else:
            # Numeric 0 is an explicitly configured sentinel, never a numeric HUC.
            if str(raw) in sentinel:
                downstream = None
            else:
                downstream = identifier(raw, f"catchment {key}.{downstream_field}")
        if downstream == key:
            raise ContractError(f"catchment {key} routes to itself")
        area = _area(geom)
        if not math.isfinite(area) or area <= 0:
            raise ContractError(f"catchment {key}: nonpositive geodesic area")
        weight = number(props.get(priority_field), f"catchment {key} priority") if priority_field else area / 1e6
        stratum = identifier(props.get(stratum_field), f"catchment {key} stratum") if stratum_field else "all"
        nodes[key] = {"id": key, "downstream_id": downstream, "external_downstream": False,
                      "area_km2": area / 1e6, "weight": weight, "stratum": stratum,
                      "geometry": feature["geometry"], "source_properties": props}
        geoms[key] = geom
    if not nodes:
        raise ContractError("domain must contain at least one catchment")
    for node in nodes.values():
        node["external_downstream"] = bool(node["downstream_id"] and node["downstream_id"] not in nodes)
    order = topological_order(nodes)
    stations, ambiguities = [], []
    seen = set()
    for index, feature in enumerate(features(station_collection, "stations") if station_collection else []):
        props = feature.get("properties") or {}
        key = identifier(props.get(station_id_field), f"station {index}.{station_id_field}")
        if key in seen:
            raise ContractError(f"duplicate station id: {key}")
        seen.add(key)
        geom = geometry(feature, f"station {key}", {"Point"})
        intersections = sorted(k for k, polygon in geoms.items() if polygon.covers(geom))
        explicit = overrides.get(key, props.get(station_huc_field) if station_huc_field else None)
        if explicit is not None:
            huc = identifier(explicit, f"station {key} assigned catchment")
            if huc not in nodes:
                raise ContractError(f"station {key} assigned to unknown catchment {huc}")
            if huc not in intersections:
                raise ContractError(f"station {key}: assignment is outside its source point geometry")
            assigned_by = "explicit"
        elif len(intersections) == 1:
            huc, assigned_by = intersections[0], "unique-spatial-match"
        else:
            huc, assigned_by = None, "ambiguous" if intersections else "outside-domain"
            ambiguities.append({"station_id": key, "candidate_catchments": intersections, "reason": assigned_by})
        outlet = props.get(station_outlet_field, False) if station_outlet_field else False
        if not isinstance(outlet, bool):
            raise ContractError(f"station {key}: outlet verification must be a JSON boolean")
        stations.append({"id": key, "huc_id": huc, "assignment": assigned_by,
                         "outlet_verified": outlet, "geometry": feature["geometry"],
                         "source_properties": props})
    unknown_overrides = set(overrides) - seen
    if unknown_overrides:
        raise ContractError(f"assignments contain unknown stations: {sorted(unknown_overrides)}")
    return {"schema": SCHEMA, "title": str(title), "source_bindings": source_bindings,
            "field_mapping": {"id": id_field, "downstream": downstream_field,
                              "stratum": stratum_field, "priority": priority_field,
                              "station_id": station_id_field, "station_huc": station_huc_field,
                              "station_outlet_verified": station_outlet_field},
            "weight_basis": f"source property {priority_field}" if priority_field else "geodesic catchment area km2",
            "nodes": nodes, "topological_order": order, "stations": stations,
            "station_assignment_issues": ambiguities,
            "summary": {"catchments": len(nodes), "stations": len(stations),
                        "assigned_stations": sum(s["huc_id"] is not None for s in stations),
                        "external_downstream_edges": sum(n["external_downstream"] for n in nodes.values()),
                        "area_km2": sum(n["area_km2"] for n in nodes.values())}}


def coverage_sets(network: dict, mode: str) -> dict[str, set[str]]:
    nodes = network["nodes"]
    if mode not in {"local", "outlet_context"}:
        raise ContractError("coverage_mode must be local or outlet_context")
    coverage = {k: {k} for k in nodes}
    if mode == "outlet_context":
        for key in network["topological_order"]:
            downstream = nodes[key]["downstream_id"]
            if downstream in coverage:
                coverage[downstream].update(coverage[key])
    return coverage


def existing_coverage(network: dict, mode: str, station_ids: list[str]) -> set[str]:
    by_id = {s["id"]: s for s in network["stations"]}
    if len(station_ids) != len(set(station_ids)):
        raise ContractError("existing_station_ids contains duplicate IDs")
    unknown = set(station_ids) - set(by_id)
    if unknown:
        raise ContractError(f"unknown existing stations: {sorted(unknown)}")
    coverage = coverage_sets(network, mode)
    included = set()
    for key in station_ids:
        station = by_id[key]
        if station["huc_id"] is None:
            raise ContractError(f"station {key} needs an unambiguous catchment assignment first")
        huc = station["huc_id"]
        included.update(coverage[huc] if mode == "outlet_context" and station["outlet_verified"] else {huc})
    return included


def graph_distances(network: dict, max_steps: int) -> set[tuple[str, str]]:
    """Pairs separated by <= max_steps directed edges; no centroid distance fiction."""
    if isinstance(max_steps, bool) or not isinstance(max_steps, int) or max_steps < 0:
        raise ContractError("minimum_network_separation must be a nonnegative integer")
    pairs = set()
    for key in network["nodes"]:
        downstream = key
        for _ in range(max_steps):
            downstream = network["nodes"][downstream]["downstream_id"]
            if downstream not in network["nodes"]:
                break
            pairs.add(tuple(sorted((key, downstream))))
    return pairs
