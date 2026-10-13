"""Regional gauge support from retained station geography, catchments and flow coverage."""
from __future__ import annotations

import argparse
import csv
import html
import io
import json
import math
import re
import stat
import zipfile
from pathlib import Path

from . import station_geography as geography
from .common import (atomic_bytes, atomic_json, canonical, describe_file, digest,
                     file_digest, identifier, now, read_json, verify_file)

VERSION = "1.1.0"
KIND = "gauge-support"
SCHEMA = "upstate.gauge-support/v1"
AREA_CRS = "EPSG:5070"
SUPPORT_KIND = "nhdplusv2_upstream_whole_catchments"
METHODS = {
    "station_locations": "Original station_geography candidates and native-CRS covers/interior/boundary memberships are retained. Each gauge is also compared with the original supplied catchment, and outside/boundary/unresolved results remain explicit.",
    "support_geometry": "NLDI upstream whole catchments use simplified=false and splitCatchment=false. The full source catchment can extend downstream of the gauge within its NHDPlusV2 catchment.",
    "area": "Valid original polygons are transformed with always_xy to EPSG:5070 (NAD83 / Conus Albers). Areas and intersections are square metres. Original vertices and CRS remain in source archives; no buffer or geometry repair is applied.",
    "scope": "Reporting HUC selection, full regional upstream/model domain and optional utility polygons are separate scopes. HUC network paths are reported separately from geometric intersections.",
    "coverage": "Daily numeric coverage uses the original site_no and ts_id pair, exact calendar denominators and original qualifiers. Approved, estimated and provisional counts can overlap. Observed-day statistics remain original; missing days are not filled.",
    "aggregation": "Catchment union is calculated geometrically. Nested or overlapping gauge catchments are not summed as independent drainage areas.",
}

SUPPORT_DEFINITIONS = {
    SUPPORT_KIND: {
        "kind": SUPPORT_KIND, "label": "Original upstream whole catchments",
        "query_simplified": False, "query_split_catchment": False, "source_method": None,
        "description": METHODS["support_geometry"],
    },
    "nhdplusv2_upstream_gauge_split": {
        "kind": "nhdplusv2_upstream_gauge_split", "label": "Original indexed-gauge split catchments",
        "query_simplified": False, "query_split_catchment": True, "source_method": "basin",
        "description": "Original NLDI indexed-gauge basin responses use simplified=false and splitCatchment=true. The selected returned gauge-specific upstream geometry and original request/response remain retained.",
    },
    "nhdplusv2_coordinate_delineated_upstream": {
        "kind": "nhdplusv2_coordinate_delineated_upstream", "label": "Coordinate-delineated upstream catchments",
        "query_simplified": False, "query_split_catchment": True, "source_method": "process",
        "description": "The documented USGS process delineates upstream support at the original NLDI gauge coordinate. Original drainageBasin geometry, request, response and job identity are retained. This coordinate-based method remains distinct from indexed-gauge basin retrieval.",
    },
}


def support_definition(kind):
    if kind not in SUPPORT_DEFINITIONS:
        raise ValueError("Choose a retained whole, indexed-gauge split or coordinate-delineated upstream source")
    return dict(SUPPORT_DEFINITIONS[kind])


def support_for_result(result):
    """Read actual saved semantics; original whole editions remain readable unchanged."""
    rows = result.get("stations") or []
    kinds = {row.get("support_kind") for row in rows}
    if len(kinds) != 1:
        raise ValueError("A saved Gauge edition must retain one declared support geometry method")
    definition = support_definition(next(iter(kinds)))
    retained = result.get("support")
    if retained is not None:
        for key in ("kind", "query_simplified", "query_split_catchment", "source_method"):
            if retained.get(key) != definition[key]:
                raise ValueError("Saved support interpretation differs from its original geometry method")
        return dict(retained)
    return definition


def _support_contract(properties, station_key):
    definition = support_definition(properties.get("support_kind"))
    if (properties.get("query_simplified") is not False or
            properties.get("query_split_catchment") is not definition["query_split_catchment"]):
        raise ValueError("Original source request flags differ from the declared support for " + station_key)
    if definition["source_method"] and properties.get("source_method") != definition["source_method"]:
        raise ValueError("Retain the original indexed or coordinate source method for " + station_key)
    if str(properties.get("station_id", "")) != station_key or not properties.get("basin_id"):
        raise ValueError("Retain the original station and basin identifiers for " + station_key)
    return definition


def _regional(workspace, report_id):
    if not isinstance(report_id, str) or not re.fullmatch(r"watershed-[0-9a-f]{20}", report_id):
        raise ValueError("Choose an actual saved regional watershed report")
    directory = workspace.root / "watershed-context" / report_id
    record = read_json(directory / "operator-report.json")
    path = directory / "watershed-context.json"
    expected = record.get("files", {}).get(path.name, {}).get("sha256")
    if record.get("id") != report_id or not expected or file_digest(path) != expected:
        raise ValueError("The selected regional report no longer matches its retained source")
    report = read_json(path)
    if report.get("id") != report_id or not report.get("hucs"):
        raise ValueError("The selected regional report has no retained HUC membership")
    return report, {"report_id": report_id, "sha256": expected,
        "source_fingerprint": record.get("source_fingerprint"),
        "source_edition_fingerprint": record.get("source_edition_fingerprint"),
        "file": describe_file(workspace.root, path)}


def _source_json(workspace, reference):
    path, entry, binding = geography._source(workspace, reference)
    return geography._json_body(path), binding


def _polygon_rows(workspace, references, id_key, *, namespace=False):
    """Use the maintained original polygon reader, including native Esri rings."""
    from pyproj import CRS, Transformer
    from shapely.geometry import shape, mapping
    from shapely.ops import transform
    rows, bindings = {}, []
    for reference in references:
        path, entry, binding = geography._source(workspace, reference)
        crs, features = geography._features(path, entry, reference, points=False)
        to_area = Transformer.from_crs(crs, AREA_CRS, always_xy=True)
        to_wgs = Transformer.from_crs(crs, "EPSG:4326", always_xy=True)
        field = reference.get(id_key) or entry.get(id_key) or entry.get("id_field")
        if not field:
            raise ValueError("Select the exact native polygon identifier field")
        bindings.append(binding)
        for original in features:
            props = original["properties"]
            native_key = str(props.get(field, "")).strip()
            key = (binding["collection_id"] + "/" + binding["source_id"] + "/" + native_key) if namespace else native_key
            if not native_key or key in rows:
                raise ValueError("Polygon identifiers must be present and unique across the selected source: " + key)
            native = shape(original["geometry"])
            if native.is_empty or not native.is_valid or native.geom_type not in ("Polygon", "MultiPolygon"):
                raise ValueError("Retain the original valid polygon for " + key)
            projected = transform(to_area.transform, native)
            if not projected.is_valid or projected.is_empty or not math.isfinite(projected.area) or projected.area <= 0:
                raise ValueError("Original polygon cannot be measured in " + AREA_CRS + ": " + key)
            rows[key] = {
                "geometry": projected, "properties": props, "native_id": native_key,
                "label": (binding.get("title") or binding["source_id"]) + " / " + native_key,
                "feature": {"type": "Feature", "id": key, "properties": dict(props),
                    "geometry": mapping(transform(to_wgs.transform, native))},
                "source_ref": {"collection_id": binding["collection_id"],
                    "source_id": binding["source_id"], "source_sha256": binding["source_sha256"],
                    "native_feature_id": original.get("native_feature_id"),
                    "source_feature_index": original["source_feature_index"],
                    "native_crs": CRS(crs).to_string(), "id_field": field,
                    "geometry_operations": original.get("geometry_operations", [])},
            }
    return rows, bindings


def _count(value, label):
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        raise ValueError("Retain a nonnegative original count for " + label)
    return value


def _coverage(workspace, reference):
    import calendar
    value, binding = _source_json(workspace, reference)
    if not isinstance(value, list):
        raise ValueError("Choose the original station-year coverage JSON array")
    result = {}
    for station in value:
        site, series = str(station.get("site_no", "")).strip(), str(station.get("ts_id", "")).strip()
        key = (site, series)
        if not site or not series or key in result:
            raise ValueError("Coverage needs one original site_no / ts_id pair per station")
        years, totals = [], {"calendar_days": 0, "numeric_day_count": 0, "approved_numeric_days": 0,
                             "estimated_numeric_days": 0, "provisional_numeric_days": 0}
        seen = set()
        for row in station.get("years", []):
            year = row.get("year")
            if isinstance(year, bool) or not isinstance(year, int) or year in seen:
                raise ValueError("Coverage years must be distinct original calendar years")
            seen.add(year)
            expected = 366 if calendar.isleap(year) else 365
            if _count(row.get("calendar_days"), "calendar days") != expected:
                raise ValueError("Original coverage calendar denominator differs for " + str(year))
            numeric = _count(row.get("numeric_day_count"), "numeric days")
            if numeric > expected:
                raise ValueError("Numeric coverage exceeds its original calendar")
            for field in totals:
                total = _count(row.get(field), field)
                if field.endswith("_numeric_days") and total > numeric:
                    raise ValueError("A qualifier day count exceeds numeric coverage")
                totals[field] += total
            years.append(dict(row))
        if not years:
            raise ValueError("The original flow series has no calendar coverage")
        totals["numeric_fraction"] = totals["numeric_day_count"] / totals["calendar_days"]
        totals["complete_numeric_calendar"] = totals["numeric_day_count"] == totals["calendar_days"]
        result[key] = {"station": {k: v for k, v in station.items() if k != "years"},
                       "years": sorted(years, key=lambda row: row["year"]), "totals": totals}
    return result, binding


def _csv(rows):
    columns = list(dict.fromkeys(key for row in rows for key in row))
    stream = io.StringIO(newline="")
    writer = csv.DictWriter(stream, fieldnames=columns, lineterminator="\n")
    writer.writeheader()
    for row in rows:
        clean = {}
        for key, value in row.items():
            if isinstance(value, (dict, list, tuple)):
                value = json.dumps(value, ensure_ascii=False, sort_keys=True)
            if isinstance(value, str) and value.startswith(("=", "+", "-", "@", "\t", "\r")):
                value = "'" + value
            clean[key] = value
        writer.writerow(clean)
    return stream.getvalue().encode("utf-8")


def _table(rows, columns):
    esc = lambda value: html.escape("" if value is None else str(value), quote=True)
    return "<table><thead><tr>" + "".join("<th>" + esc(label) + "</th>" for key, label in columns) + \
        "</tr></thead><tbody>" + "".join("<tr>" + "".join("<td>" + esc(row.get(key)) + "</td>"
        for key, label in columns) + "</tr>" for row in rows) + "</tbody></table>"


def render_report(result):
    esc = lambda value: html.escape(str(value), quote=True)
    stations = []
    for row in result["stations"]:
        flow = row.get("flow") or {}
        totals = flow.get("totals") or {}
        stations.append({"station_id": row["station_id"], "station_name": row["station_name"],
            "hucs": ", ".join(row["point_huc12s"]), "support_km2": round(row["catchment_area_m2"] / 1e6, 3),
            "regional_pct": round(100 * row["regional_domain_fraction"], 3),
            "numeric_days": totals.get("numeric_day_count"), "calendar_days": totals.get("calendar_days"),
            "series": row["ts_id"], "status": row["location_status"], "own_basin": row["point_own_catchment_relation"]})
    year_rows = [{"station_id": station["station_id"], **year}
                 for station in result["stations"] for year in (station.get("flow") or {}).get("years", [])]
    title = esc(result["title"])
    support = support_for_result(result)
    return ("<!doctype html><html lang='en'><meta charset='utf-8'><meta name='viewport' content='width=device-width'>"
        "<title>" + title + "</title><style>body{font:15px system-ui;color:#202020;background:#fff;margin:32px;max-width:1200px}"
        "table{border-collapse:collapse;width:100%;margin:20px 0;font-size:13px}td,th{border:1px solid #ccc;padding:8px;text-align:left}"
        "th{background:#eee}h1{font-size:25px}h2{margin-top:32px}code{overflow-wrap:anywhere}"
        "@media print{body{margin:0}thead{display:table-header-group}tr{break-inside:avoid}}</style>"
        "<h1>" + title + "</h1><p>Regional report <code>" + esc(result["regional"]["report_id"]) +
        "</code> · " + esc(result["summary"]["gauge_count"]) + " retained gauges · " +
        esc(result["summary"]["regional_huc_count"]) + " regional HUC12 polygons.</p>"
        "<p><strong>" + esc(support["label"]) + ".</strong> " + esc(support["description"]) + "</p>"
        "<h2>Gauge support and original flow coverage</h2>" +
        _table(stations, [("station_id","Station"),("station_name","Original name"),("series","USGS series"),
            ("hucs","Gauge point HUC12"),("status","Location"),("own_basin","Point in supplied catchment"),("support_km2","Selected catchment km²"),
            ("regional_pct","Catchment within region %"),("numeric_days","Numeric days"),("calendar_days","Calendar days")]) +
        "<h2>Original annual coverage</h2>" +
        _table(year_rows, [("station_id","Station"),("year","Year"),("numeric_day_count","Numeric"),
            ("calendar_days","Calendar"),("approved_numeric_days","Approved"),("estimated_numeric_days","Estimated"),
            ("provisional_numeric_days","Provisional"),("mean_observed_daily_cfs","Observed-day mean cfs"),
            ("missing_date_count","Missing dates"),("non_numeric_count","Nonnumeric")]) +
        "<h2>Selected reporting, upstream and utility areas</h2>" +
        _table(result["scope_summary"], [("scope","Scope"),("label","Selection"),("area_m2","Area m²"),
            ("catchment_union_overlap_m2","Union of gauge catchments m²"),
            ("covered_fraction","Fraction intersected")]) +
        "<h2>Methods and source interpretation</h2>" +
        "".join("<p><strong>" + esc(key.replace("_"," ").capitalize()) + ".</strong> " + esc(value) + "</p>"
                for key, value in result["methods"].items()) +
        "<p>The JSON, HUC intersection CSV, original sources and source station-geography package accompany this report."
        " Use the application Workspace backup to reopen the complete linked project.</p></html>")


def _ratio(numerator, denominator):
    return numerator / denominator if denominator > 0 else None


def _network(report_row, point_hucs):
    network = report_row.get("network") or {}
    upstream = set(network.get("known_upstream_domain_huc12s") or [])
    downstream = set(network.get("downstream_domain_huc12s") or [])
    return [{"gauge_huc12": huc, "relation":
        "same_huc" if huc == report_row["huc12"] else
        "gauge_huc_upstream" if huc in upstream else
        "gauge_huc_downstream" if huc in downstream else
        "not_in_retained_path"} for huc in point_hucs]


def build(workspace, selection):
    """Save a complete source-bound gauge-support edition using current station readers."""
    from shapely.geometry import GeometryCollection
    from shapely.ops import unary_union
    if not isinstance(selection, dict):
        raise ValueError("Choose a saved regional report and retained source selections")
    selection = json.loads(canonical(selection))
    report, regional = _regional(workspace, selection.get("report_id"))
    by_huc = {str(row["huc12"]): row for row in report["hucs"]}
    requested = selection.get("reporting_huc12s")
    if requested is None:
        requested = report.get("selection", {}).get("huc12s") or sorted(by_huc)
    if not isinstance(requested, list) or not requested or len(set(requested)) != len(requested) or set(requested) - set(by_huc):
        raise ValueError("Select distinct reporting HUC12 IDs from this saved regional report")
    selection["reporting_huc12s"] = sorted(requested)
    huc_refs = selection.get("huc_sources") or []
    if not huc_refs:
        raise ValueError("Choose the original regional HUC12 polygon source")
    hucs, huc_bindings = _polygon_rows(workspace, huc_refs, "id_field")
    missing = set(by_huc) - set(hucs)
    if missing:
        raise ValueError("Original polygons are missing regional HUC12 IDs: " + ", ".join(sorted(missing)))
    hucs = {key: value for key, value in hucs.items() if key in by_huc}
    station_id = selection.get("station_edition_id")
    if station_id:
        station = geography.inspect(workspace, station_id, verify=True, include_result=True)
    else:
        point = dict(selection.get("point_source") or {})
        if not point:
            raise ValueError("Choose the original NLDI point source or a saved station geography")
        point.setdefault("station_id_field", "station_id")
        station = geography.build(workspace, {"title": (selection.get("title") or "Regional gauge support") + " — station geography",
            "sources": [point], "watersheds": huc_refs, "include_all_source_stations": True,
            "choices": selection.get("station_choices") or {}})
        station = geography.inspect(workspace, station["id"], verify=True, include_result=True)
        selection["station_edition_id"] = station["id"]
    stations = {row["station_id"]: row for row in station["result"]["stations"]}
    catchment_ref = dict(selection.get("catchment_source") or {})
    catchment_ref["id_field"] = "station_id"
    catchments, catchment_bindings = _polygon_rows(workspace, [catchment_ref], "id_field")
    definitions = [_support_contract(row["properties"], key) for key, row in sorted(catchments.items())]
    if not definitions or any(row != definitions[0] for row in definitions):
        raise ValueError("Select one complete retained support edition with one geometry method")
    support = definitions[0]
    if selection.get("support_kind") is not None and selection["support_kind"] != support["kind"]:
        raise ValueError("The selected support method differs from the actual source properties")
    selection["support_kind"] = support["kind"]
    coverage, coverage_binding = _coverage(workspace, selection.get("coverage_source") or {})
    utility_refs = selection.get("utility_sources") or []
    utility, utility_bindings = _polygon_rows(workspace, utility_refs, "id_field", namespace=True) if utility_refs else ({}, [])
    station_groups, _, _ = geography._watersheds(workspace, huc_refs)
    catchment_groups, _, _ = geography._watersheds(workspace, [catchment_ref])
    domain_geometry = unary_union([row["geometry"] for row in hucs.values()])
    reporting_geometry = unary_union([hucs[key]["geometry"] for key in requested])
    source_bindings = {}
    for binding in [*station["sources"], *huc_bindings, *catchment_bindings, coverage_binding, *utility_bindings]:
        source_bindings[(binding["collection_id"], binding["source_id"])] = binding
    source_bindings = list(source_bindings.values())
    identity = {"version": VERSION, "selection": selection, "regional": regional,
        "station_build_id": station["build_id"], "sources": [
            {key: row[key] for key in ("collection_id","source_id","source_sha256")} for row in source_bindings]}
    build_id = digest(identity)
    destination = workspace.root / "gauge-support" / build_id
    existing = destination / "edition.json"
    if existing.exists():
        return inspect(workspace, read_json(existing)["id"], verify=True)
    destination.mkdir(parents=True, exist_ok=True)
    start = destination / "build-start.json"
    if not start.exists():
        atomic_json(start, {"created_at": now(), "build_id": build_id}, immutable=True)
    created = read_json(start)["created_at"]
    rows, intersections, annual, scope_rows, source_features, huc_features = [], [], [], [], [], []
    for station_key, catchment in sorted(catchments.items()):
        props, basin = catchment["properties"], catchment["geometry"]
        site, series = str(props.get("site_no", "")).strip(), str(props.get("ts_id", "")).strip()
        if station_key != "USGS-" + site:
            raise ValueError("Original gauge and basin site identifiers differ: " + station_key)
        location = stations.get(station_key)
        if location is None:
            raise ValueError("Retained station geography omits catchment station " + station_key)
        if support["source_method"] == "process":
            coordinates = location.get("coordinates")
            requested_point = [props.get("requested_longitude"), props.get("requested_latitude")]
            if (not coordinates or len(coordinates) < 2 or any(isinstance(value, bool) or
                    not isinstance(value, (int, float)) or not math.isfinite(value) for value in requested_point)
                    or any(not math.isclose(float(coordinates[i]), requested_point[i], rel_tol=0, abs_tol=1e-8)
                           for i in range(2))):
                raise ValueError("The coordinate-delineated request must use this retained original gauge point: " + station_key)
        flow = coverage.get((site, series))
        if flow is None:
            raise ValueError("Original calendar coverage omits site / series " + site + " / " + series)
        memberships, membership_status = geography._memberships(location.get("coordinates"), station_groups)
        point_hucs = sorted({str(row["watershed_id"]) for row in memberships if str(row["watershed_id"]) in by_huc})
        catchment_memberships, catchment_membership_status = geography._memberships(location.get("coordinates"), catchment_groups)
        own = [row for row in catchment_memberships if str(row["watershed_id"]) == station_key]
        own_relation = ("unresolved" if not location.get("coordinates") else
            "boundary" if any(row["relation"] == "boundary" for row in own) else
            "interior" if own else "outside")
        whole = basin.area
        regional_area = basin.intersection(domain_geometry).area
        reporting_area = basin.intersection(reporting_geometry).area
        row = {"station_id": station_key, "site_no": site, "ts_id": series,
            "station_name": flow["station"].get("station_nm") or props.get("station_name") or station_key,
            "basin_id": props.get("basin_id"), "support_kind": support["kind"],
            "query_simplified": False, "query_split_catchment": support["query_split_catchment"],
            "source_method": props.get("source_method"),
            "location_status": location["status"], "coordinates": location.get("coordinates"),
            "point_huc12s": point_hucs, "point_memberships": memberships, "point_membership_status": membership_status,
            "station_source_ref": location.get("selected_source_ref"), "catchment_source_ref": catchment["source_ref"],
            "point_own_catchment_relation": own_relation,
            "point_in_own_catchment": None if own_relation == "unresolved" else bool(own),
            "point_catchment_memberships": catchment_memberships,
            "point_catchment_membership_status": catchment_membership_status,
            "catchment_area_m2": whole, "regional_domain_area_m2": regional_area,
            "regional_domain_fraction": _ratio(regional_area, whole),
            "outside_regional_domain_area_m2": max(0.0, whole - regional_area),
            "reporting_overlap_area_m2": reporting_area,
            "reporting_fraction_of_catchment": _ratio(reporting_area, whole),
            "flow": flow, "original_catchment_properties": props, "huc_intersections": []}
        for huc, polygon in sorted(hucs.items()):
            geom = polygon["geometry"]
            if not basin.intersects(geom):
                continue
            overlap = basin.intersection(geom).area
            relation = "area_overlap" if overlap > 0 else "boundary_touch"
            item = {"station_id": station_key, "ts_id": series, "huc12": huc,
                "watershed_name": by_huc[huc].get("name"), "priority": by_huc[huc].get("priority"),
                "reporting_selected": huc in requested, "relation": relation,
                "overlap_area_m2": overlap, "catchment_fraction": _ratio(overlap, whole),
                "huc_fraction": _ratio(overlap, geom.area), "native_huc_source_ref": polygon["source_ref"],
                "retained_network_relation": _network(by_huc[huc], point_hucs)}
            row["huc_intersections"].append(item)
            intersections.append(item)
        for key, polygon in utility.items():
            overlap = basin.intersection(polygon["geometry"]).area
            scope_rows.append({"station_id": station_key, "scope": "utility", "id": key,
                "native_id": polygon["native_id"], "label": polygon["label"],
                "overlap_area_m2": overlap, "scope_fraction": _ratio(overlap, polygon["geometry"].area),
                "catchment_fraction": _ratio(overlap, whole), "source_ref": polygon["source_ref"]})
        rows.append(row)
        annual.extend({"station_id": station_key, "site_no": site, "ts_id": series, **year} for year in flow["years"])
        source_features.append(catchment["feature"])
    catchment_union = unary_union([row["geometry"] for row in catchments.values()]) if catchments else GeometryCollection()
    if not rows:
        raise ValueError("No original gauge catchments were selected")
    for key, row in sorted(hucs.items()):
        feature = row["feature"]
        feature["properties"].update(huc12=key, name=by_huc[key].get("name"),
            reporting_selected=key in requested, priority=by_huc[key].get("priority"))
        huc_features.append(feature)
    scopes = [("regional_upstream_domain", "saved-report-domain", domain_geometry),
              ("reporting", "selected-huc12s", reporting_geometry)]
    scopes.extend(("utility", key, value["geometry"]) for key, value in utility.items())
    summary_scopes = []
    for scope, key, polygon in scopes:
        overlap = polygon.intersection(catchment_union).area
        summary_scopes.append({"scope": scope, "id": key,
            "label": utility[key]["label"] if scope == "utility" else key,
            "native_id": utility[key]["native_id"] if scope == "utility" else None,
            "source_ref": utility[key]["source_ref"] if scope == "utility" else None, "area_m2": polygon.area,
            "catchment_union_overlap_m2": overlap, "covered_fraction": _ratio(overlap, polygon.area)})
    overlap_rows = []
    keys = sorted(catchments)
    for i, first in enumerate(keys):
        for second in keys[i+1:]:
            a, b = catchments[first]["geometry"], catchments[second]["geometry"]
            if not a.intersects(b):
                continue
            area = a.intersection(b).area
            overlap_rows.append({"station_a": first, "station_b": second, "overlap_area_m2": area,
                "fraction_a": _ratio(area, a.area), "fraction_b": _ratio(area, b.area),
                "relationship": "equal_geometry" if a.equals(b) else "a_covers_b" if a.covers(b)
                    else "b_covers_a" if b.covers(a) else "overlap" if area > 0 else "boundary_touch"})
    summary = {"gauge_count": len(rows), "regional_huc_count": len(hucs), "reporting_huc_count": len(requested),
        "utility_area_count": len(utility), "located_gauge_count": sum(row["location_status"] in geography.LOCATED for row in rows),
        "gauges_with_point_in_region": sum(bool(row["point_huc12s"]) for row in rows),
        "gauges_with_catchment_overlap": sum(row["regional_domain_area_m2"] > 0 for row in rows),
        "complete_numeric_flow_gauges": sum(row["flow"]["totals"]["complete_numeric_calendar"] for row in rows),
        "gauges_outside_own_catchment": sum(row["point_own_catchment_relation"] == "outside" for row in rows),
        "catchment_union_area_m2": catchment_union.area, "catchment_pair_overlap_count": len(overlap_rows)}
    result = {"schema": SCHEMA, "version": VERSION, "build_id": build_id, "created_at": created,
        "title": selection.get("title") or "Regional gauge and catchment support",
        "project_id": workspace.project["id"], "selection": selection, "regional": regional,
        "station_edition_id": station["id"], "station_build_id": station["build_id"],
        "area_crs": AREA_CRS, "sources": source_bindings, "support": support,
        "methods": {**METHODS, "support_geometry": support["description"]}, "summary": summary,
        "stations": rows, "scope_summary": summary_scopes, "utility_intersections": scope_rows,
        "catchment_relationships": overlap_rows,
        "unused_coverage_pairs": [{"site_no": key[0], "ts_id": key[1]} for key in sorted(set(coverage) -
            {(row["site_no"], row["ts_id"]) for row in rows})]}
    atomics = {"analysis.json": result,
        "catchments.geojson": {"type": "FeatureCollection", "features": source_features},
        "regional-hucs.geojson": {"type": "FeatureCollection", "features": huc_features},
        "gauges.geojson": {"type": "FeatureCollection", "features": [
            {"type": "Feature", "id": row["station_id"],
             "geometry": {"type": "Point", "coordinates": row["coordinates"]},
             "properties": {"station_id": row["station_id"], "ts_id": row["ts_id"], "name": row["station_name"]}}
            for row in rows if row["coordinates"]]},
        "regional-report.json": report}
    for name, body in atomics.items():
        atomic_json(destination / name, body, immutable=True)
    flat = [{key: value for key, value in row.items() if key not in
        ("flow", "huc_intersections", "original_catchment_properties", "point_memberships")} |
        row["flow"]["totals"] for row in rows]
    for name, values in (("gauges.csv", flat), ("gauge-huc-intersections.csv", intersections),
                        ("annual-flow-coverage.csv", annual), ("utility-intersections.csv", scope_rows),
                        ("scope-summary.csv", summary_scopes), ("catchment-relationships.csv", overlap_rows)):
        atomic_bytes(destination / name, _csv(values), immutable=True)
    atomic_bytes(destination / "OPEN_GAUGE_SUPPORT.html", render_report(result).encode("utf-8"), immutable=True)
    manifests, _ = geography._package_inputs(workspace, destination, source_bindings, [])
    station_archive = next(item for item in station["files"] if Path(item["path"]).name == "station-geography.zip")
    atomic_bytes(destination / "original-station-geography.zip",
        verify_file(workspace.root, station_archive).read_bytes(), immutable=True)
    package_files = [describe_file(destination, path) for path in sorted(destination.rglob("*"))
                     if path.is_file() and path not in {destination / name for name in ("package.json", "gauge-support.zip", "edition.json")}]
    package = {"schema": "upstate.gauge-support-package/v1", "version": VERSION,
        "build_id": build_id, "project_id": workspace.project["id"], "selection": selection,
        "regional": regional, "station_edition_id": station["id"], "source_manifests": manifests,
        "files": package_files, "receiving": "Restore the complete Workspace backup to reopen the linked report, sources and station edition."}
    atomic_json(destination / "package.json", package, immutable=True)
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
        for name in sorted([item["path"] for item in package_files] + ["package.json"]):
            info = zipfile.ZipInfo(name, date_time=(2026, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = (stat.S_IFREG | 0o600) << 16
            archive.writestr(info, (destination / name).read_bytes())
    atomic_bytes(destination / "gauge-support.zip", buffer.getvalue(), immutable=True)
    names = [*atomics, "gauges.csv", "gauge-huc-intersections.csv", "annual-flow-coverage.csv",
        "utility-intersections.csv", "scope-summary.csv", "catchment-relationships.csv",
        "OPEN_GAUGE_SUPPORT.html", "package.json", "gauge-support.zip", "original-station-geography.zip"]
    saved = workspace._save(KIND, {"version": VERSION, "title": result["title"], "created_at": created,
        "build_id": build_id, "selection": selection, "summary": summary, "regional": regional,
        "station_edition_id": station["id"], "sources": source_bindings,
        "files": [describe_file(workspace.root, destination / name, label=name) for name in names]})
    atomic_json(existing, {"id": saved["id"], "build_id": build_id}, immutable=True)
    return saved


def inspect(workspace, edition_id, *, verify=False, include_result=False):
    row = workspace._get(KIND, identifier(edition_id))
    if verify:
        for item in row["files"]:
            verify_file(workspace.root, item)
        for binding in row["sources"]:
            geography._source(workspace, binding)
        geography.inspect(workspace, row["station_edition_id"], verify=True)
        _, regional = _regional(workspace, row["regional"]["report_id"])
        if regional["sha256"] != row["regional"]["sha256"]:
            raise ValueError("The linked original regional report changed")
    if include_result:
        descriptor = next(item for item in row["files"] if Path(item["path"]).name == "analysis.json")
        row["result"] = read_json(verify_file(workspace.root, descriptor))
    return row


def verify_workspace(workspace):
    editions = workspace._list(KIND)
    for row in editions:
        inspect(workspace, row["id"], verify=True)
    return {"verified": True, "edition_count": len(editions)}


def catalog(workspace):
    original = geography.catalog(workspace)
    reports = []
    for path in sorted((workspace.root / "watershed-context").glob("*/operator-report.json")):
        row = read_json(path)
        report, reference = _regional(workspace, row["id"])
        reports.append({"id": row["id"], "title": row.get("title"), "summary": row.get("summary"),
            "hucs": [{"huc12": huc["huc12"], "name": huc.get("name"), "priority": huc.get("priority")}
                     for huc in report["hucs"]], "source_ref": reference})
    # Resolve support choices from the retained manifest, without decoding large geometry here.
    collections, support_sources = {}, []
    for source in original["sources"]:
        if source.get("kind") != "vector":
            continue
        collection_id = source["collection_id"]
        if collection_id not in collections:
            collections[collection_id] = workspace._get("sources", collection_id)
        entry = next((item for item in collections[collection_id]["entries"]
                      if item["id"] == source["source_id"]), None)
        if entry is None:
            continue
        kind = entry.get("support_kind")
        if kind is None and entry.get("role") == "upstream-whole-catchment-support":
            kind = SUPPORT_KIND
        if kind in SUPPORT_DEFINITIONS:
            support_sources.append({**source, "support": support_definition(kind)})
    # Coverage JSON is registered as a table source by the source preparation command.
    return {"schema": "upstate.gauge-support-catalog/v1", "sources": original["sources"],
        "support_sources": support_sources, "support_definitions": list(SUPPORT_DEFINITIONS.values()),
        "station_editions": original["editions"], "reports": reports,
        "editions": [{key: row.get(key) for key in ("id","title","created_at","summary","selection")}
                     for row in workspace._list(KIND)]}


def main(argv=None):
    from .workspace import Workspace
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", required=True)
    commands = parser.add_subparsers(dest="command", required=True)
    create = commands.add_parser("build")
    create.add_argument("selection")
    detail = commands.add_parser("inspect")
    detail.add_argument("id")
    detail.add_argument("--verify", action="store_true")
    detail.add_argument("--complete", action="store_true")
    commands.add_parser("catalog")
    commands.add_parser("verify")
    args = parser.parse_args(argv)
    workspace = Workspace(args.workspace)
    if args.command == "build":
        result = build(workspace, read_json(args.selection))
    elif args.command == "inspect":
        result = inspect(workspace, args.id, verify=args.verify, include_result=args.complete)
    elif args.command == "verify":
        result = verify_workspace(workspace)
    else:
        result = catalog(workspace)
    print(json.dumps(result, ensure_ascii=False, sort_keys=True, indent=2, allow_nan=False))


if __name__ == "__main__":
    main()
