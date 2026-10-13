#!/usr/bin/env python3
"""Measure four retained NLDI basins and their downstream differences.

Run against an application-layout source family. Original geometries are never
modified, snapped, buffered, simplified, or repaired. This producer requires
pyproj and Shapely; it performs no network requests or model solves.
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import io
import json
import math
import os
from pathlib import Path, PurePosixPath
import platform
import shutil
import sys
import tempfile

INPUT_SCHEMA = "upstate.four-station-catchment-inputs/v1"
OUTPUT_SCHEMA = "upstate.four-station-catchment-analysis/v1"
ORDER = ("SV-833", "RS-26250", "SV-735", "SV-111")
COMIDS = ("11749277", "11749733", "11749763", "11749507")
SOURCE_CRS = "EPSG:4326"
MEASUREMENT_CRS = "EPSG:5070"


def canonical_json(value):
    return (json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) + "\n").encode("utf-8")


def _object(pairs):
    value = {}
    for key, item in pairs:
        if key in value:
            raise ValueError("Duplicate JSON member: " + key)
        value[key] = item
    return value


def parse_json(raw):
    def invalid(value):
        raise ValueError("Nonfinite JSON number: " + value)
    return json.loads(raw.decode("utf-8-sig"), object_pairs_hook=_object, parse_constant=invalid)


def relative_path(value):
    if not isinstance(value, str) or not value or "\\" in value or "\x00" in value:
        raise ValueError("Use a nonempty canonical relative POSIX source path.")
    path = PurePosixPath(value)
    if path.is_absolute() or str(path) != value or value == "." or ".." in path.parts:
        raise ValueError("A source path must remain within the application: " + value)
    return value


def source_bytes(application, descriptor):
    if not isinstance(descriptor, dict):
        raise ValueError("An original source requires its exact path, bytes and SHA-256.")
    name = relative_path(descriptor.get("path"))
    size, sha = descriptor.get("bytes"), descriptor.get("sha256")
    if (type(size) is not int or size < 1 or not isinstance(sha, str)
            or len(sha) != 64 or any(c not in "0123456789abcdef" for c in sha)):
        raise ValueError("An original source requires positive bytes and lowercase SHA-256: " + name)
    path = (application / name).resolve(strict=True)
    if not path.is_relative_to(application) or not path.is_file():
        raise ValueError("The source must be a retained file within the application: " + name)
    raw = path.read_bytes()
    if len(raw) != size or hashlib.sha256(raw).hexdigest() != sha:
        raise ValueError("The original source identity differs: " + name)
    identity = {"path": name, "bytes": size, "sha256": sha}
    if descriptor.get("uri"):
        identity["uri"] = descriptor["uri"]
    return raw, identity


def point(value):
    if (not isinstance(value, (list, tuple)) or len(value) != 2
            or any(type(v) not in (int, float) or not math.isfinite(v) for v in value)):
        raise ValueError("Retain finite original two-dimensional longitude/latitude coordinates.")
    x, y = value
    if not -180 <= x <= 180 or not -90 <= y <= 90:
        raise ValueError("A source coordinate is outside longitude/latitude bounds.")
    return (x, y)


def feature_collection(body, label):
    if not isinstance(body, dict) or body.get("type") != "FeatureCollection":
        raise ValueError(label + " must retain its original GeoJSON FeatureCollection.")
    if "crs" in body:
        crs = body["crs"]
        name = crs.get("properties", {}).get("name") if isinstance(crs, dict) else None
        allowed = {"EPSG:4326", "urn:ogc:def:crs:OGC:1.3:CRS84",
                   "urn:ogc:def:crs:EPSG::4326", "OGC:CRS84"}
        if name not in allowed:
            raise ValueError(label + " declares an unsupported original coordinate reference system.")
    features = body.get("features")
    if not isinstance(features, list) or not features or any(
            not isinstance(f, dict) or f.get("type") != "Feature" for f in features):
        raise ValueError(label + " must contain complete original GeoJSON features.")
    return features


def one_feature(body, label):
    features = feature_collection(body, label)
    if len(features) != 1:
        raise ValueError(label + " requires one original feature, without an automatic union.")
    return features[0]


def identifier(value):
    if type(value) is int and value > 0:
        return str(value)
    if isinstance(value, str) and value.isdigit() and int(value) > 0:
        return str(int(value))
    raise ValueError("An original NHDPlus COMID must be a positive integer identifier.")


def keyed_descriptors(value, label):
    if not isinstance(value, list) or len(value) != len(ORDER):
        raise ValueError(label + " must retain exactly four source descriptors.")
    keyed = {}
    for row in value:
        if not isinstance(row, dict) or row.get("station_id") not in ORDER or row["station_id"] in keyed:
            raise ValueError(label + " must name each of the four original stations once.")
        keyed[row["station_id"]] = row
    if set(keyed) != set(ORDER):
        raise ValueError(label + " must name all four original stations.")
    return keyed


def network_binding(application, manifest):
    raw, network_source = source_bytes(application, manifest.get("network_source"))
    body = parse_json(raw)
    features = feature_collection(body, "The original downstream network")
    if len(features) != 65:
        raise ValueError("Retain the complete original 65-reach downstream navigation.")
    reaches, starts, incoming = {}, {}, {}
    for feature in features:
        comid = identifier(feature.get("properties", {}).get("nhdplus_comid"))
        if comid in reaches:
            raise ValueError("Duplicate original downstream COMID: " + comid)
        if "id" in feature and identifier(feature["id"]) != comid:
            raise ValueError("Original reach feature ID and COMID disagree: " + comid)
        geometry = feature.get("geometry") or {}
        coordinates = geometry.get("coordinates")
        if geometry.get("type") != "LineString" or not isinstance(coordinates, list) or len(coordinates) < 2:
            raise ValueError("Retain each original downstream LineString.")
        vertices = [point(p) for p in coordinates]
        start, end = vertices[0], vertices[-1]
        if start == end or start in starts or end in incoming:
            raise ValueError("The original downstream navigation is not one unbranched directed chain.")
        starts[start], incoming[end] = comid, comid
        reaches[comid] = {"start": start, "end": end, "vertices": len(vertices)}
    current, chain = COMIDS[0], []
    if current not in reaches or reaches[current]["start"] in incoming:
        raise ValueError("The original SV-833 reach must begin this downstream chain.")
    while current is not None:
        if current in chain:
            raise ValueError("The original downstream navigation contains a cycle.")
        chain.append(current)
        current = starts.get(reaches[current]["end"])
    if len(chain) != len(reaches):
        raise ValueError("The original downstream navigation contains disconnected reaches.")
    sources = keyed_descriptors(manifest.get("station_sources"), "Indexed station sources")
    bound, positions = [], []
    for station, expected_comid in zip(ORDER, COMIDS):
        raw, identity = source_bytes(application, sources[station])
        feature = one_feature(parse_json(raw), station + " original indexed location")
        props = feature.get("properties") or {}
        if (props.get("identifier") != "21SC60WQ_WQX-" + station
                or identifier(props.get("comid")) != expected_comid):
            raise ValueError("The original indexed station identity or COMID changed: " + station)
        geometry = feature.get("geometry") or {}
        if geometry.get("type") != "Point":
            raise ValueError("Retain the original indexed station Point: " + station)
        point(geometry.get("coordinates"))
        if expected_comid not in chain:
            raise ValueError("The original station COMID is outside the retained downstream chain.")
        positions.append(chain.index(expected_comid))
        bound.append({"station_id": station, "comid": expected_comid, **identity})
    if any(a >= b for a, b in zip(positions, positions[1:])):
        raise ValueError("Original reach connectivity does not support the declared station order.")
    return {
        "source": network_source,
        "station_sources": bound,
        "station_order": list(ORDER),
        "ordered_station_comids": list(COMIDS),
        "ordered_reach_comids": chain,
        "station_reach_indices": positions,
        "reach_count": len(chain),
        "vertex_count": sum(r["vertices"] for r in reaches.values()),
        "method": "exact_original_directed_endpoints",
    }


def polygon_coordinates(geometry, label):
    kind = geometry.get("type") if isinstance(geometry, dict) else None
    coordinates = geometry.get("coordinates") if isinstance(geometry, dict) else None
    if kind not in ("Polygon", "MultiPolygon") or not isinstance(coordinates, (list, tuple)) or not coordinates:
        raise ValueError(label + " must be a nonempty original Polygon or MultiPolygon.")
    polygons = [coordinates] if kind == "Polygon" else coordinates
    vertices, holes = 0, 0
    for polygon in polygons:
        if not isinstance(polygon, (list, tuple)) or not polygon:
            raise ValueError(label + " contains an empty polygon.")
        holes += len(polygon) - 1
        for ring in polygon:
            if not isinstance(ring, (list, tuple)) or len(ring) < 4:
                raise ValueError(label + " contains a ring with fewer than four positions.")
            positions = [point(p) for p in ring]
            if positions[0] != positions[-1]:
                raise ValueError(label + " contains an unclosed original ring.")
            vertices += len(positions)
    return {"geometry_type": kind, "polygon_count": len(polygons),
            "interior_ring_count": holes, "vertex_count": vertices}


def finite_area(value, label, *, positive=False):
    number = float(value)
    if not math.isfinite(number) or number < 0 or (positive and number == 0):
        raise ValueError("Invalid measured area for " + label)
    return number


def analyze(application, manifest, manifest_identity=None):
    """Return a fully source-bound result; no file writes or geometry repairs."""
    import pyproj
    from pyproj import CRS, Transformer
    import shapely
    from shapely.geometry import shape, mapping
    from shapely.ops import transform
    from shapely.validation import explain_validity

    if not isinstance(manifest, dict) or manifest.get("schema") != INPUT_SCHEMA:
        raise ValueError("Choose an " + INPUT_SCHEMA + " input descriptor.")
    application = Path(application).resolve(strict=True)
    if not application.is_dir():
        raise ValueError("The application root must be a real directory.")
    if manifest.get("measurement_crs", MEASUREMENT_CRS) != MEASUREMENT_CRS:
        raise ValueError("This area analysis uses EPSG:5070.")
    bound_network = network_binding(application, manifest)
    descriptors = keyed_descriptors(manifest.get("source_inputs"), "Original catchments")
    destination_crs = CRS.from_epsg(5070)
    if not destination_crs.is_projected or any(axis.unit_conversion_factor != 1 for axis in destination_crs.axis_info):
        raise ValueError("EPSG:5070 must use projected metre axes.")
    forward = Transformer.from_crs(SOURCE_CRS, destination_crs, always_xy=True)
    backward = Transformer.from_crs(destination_crs, SOURCE_CRS, always_xy=True)
    def projected(x, y, z=None):
        return forward.transform(x, y, errcheck=True)
    def geographic(x, y, z=None):
        return backward.transform(x, y, errcheck=True)
    sources, stations, shapes = [], [], {}
    for station, comid in zip(ORDER, COMIDS):
        descriptor = descriptors[station]
        if identifier(descriptor.get("comid")) != comid:
            raise ValueError("Catchment descriptor and original indexed COMID disagree: " + station)
        raw, identity = source_bytes(application, descriptor)
        feature = one_feature(parse_json(raw), station + " original basin")
        props = feature.get("properties") or {}
        for key in ("comid", "nhdplus_comid"):
            if props.get(key) is not None and identifier(props[key]) != comid:
                raise ValueError("Original catchment COMID disagrees with its indexed station: " + station)
        geometry = feature.get("geometry")
        counts = polygon_coordinates(geometry, station)
        original = shape(geometry)
        if original.is_empty or not original.is_valid:
            raise ValueError(station + " original geometry is invalid: " + explain_validity(original))
        native = transform(projected, original)
        if native.is_empty or not native.is_valid:
            raise ValueError(station + " EPSG:5070 geometry is invalid: " + explain_validity(native))
        area = finite_area(native.area, station, positive=True)
        if any(not math.isfinite(v) for v in native.bounds):
            raise ValueError(station + " has nonfinite projected bounds.")
        sources.append({"station_id": station, "comid": comid, **identity})
        stations.append({
            "station_id": station, "comid": comid,
            "area_m2": area, "area_km2": area / 1000000,
            **counts, "valid": True, "projected_valid": True,
            "validity_reason": explain_validity(original),
            "projected_validity_reason": explain_validity(native),
            "source_bbox": list(original.bounds), "measurement_bbox": list(native.bounds),
            "source": identity,
        })
        shapes[station] = native
    pairs, increments = [], []
    for upstream, downstream in zip(ORDER, ORDER[1:]):
        a, b = shapes[upstream], shapes[downstream]
        # Actual planar polygon operations: never substitute b.area - a.area.
        overlap = a.intersection(b)
        outside = a.difference(b)
        incremental = b.difference(a)
        for label, result in (("intersection", overlap), ("upstream outside", outside), ("incremental", incremental)):
            if not result.is_valid:
                raise ValueError(upstream + "/" + downstream + " " + label + " is invalid: " + explain_validity(result))
        intersection_area = finite_area(overlap.area, upstream + "/" + downstream + " intersection")
        outside_area = finite_area(outside.area, upstream + "/" + downstream + " outside")
        incremental_area = finite_area(incremental.area, upstream + "/" + downstream + " incremental")
        if incremental.geom_type not in ("Polygon", "MultiPolygon") and not incremental.is_empty:
            raise ValueError("A nonpolygonal incremental result needs explicit scientific review.")
        pair_id = upstream.lower().replace("-", "") + "--" + downstream.lower().replace("-", "")
        display = None
        if not incremental.is_empty:
            original_crs_difference = transform(geographic, incremental)
            if not original_crs_difference.is_valid:
                raise ValueError("The WGS84 incremental display geometry is invalid: " + pair_id)
            display = mapping(original_crs_difference)
            polygon_coordinates(display, pair_id + " derived WGS84 increment")
        row = {
            "id": pair_id,
            "upstream_station_id": upstream, "downstream_station_id": downstream,
            "upstream_comid": COMIDS[ORDER.index(upstream)],
            "downstream_comid": COMIDS[ORDER.index(downstream)],
            "upstream_area_m2": float(a.area), "downstream_area_m2": float(b.area),
            "intersection_area_m2": intersection_area,
            "upstream_outside_downstream_m2": outside_area,
            "incremental_area_m2": incremental_area,
            "incremental_area_km2": incremental_area / 1000000,
            "net_area_difference_m2": float(b.area - a.area),
            "upstream_overlap_fraction": intersection_area / float(a.area),
            "downstream_covers_upstream": bool(b.covers(a)),
            "intersects": bool(a.intersects(b)),
            "relation_upstream_to_downstream": a.relate(b),
            "upstream_area_balance_residual_m2": float(a.area - intersection_area - outside_area),
            "downstream_area_balance_residual_m2": float(b.area - intersection_area - incremental_area),
            "incremental_empty": bool(incremental.is_empty),
            "incremental_geometry_type": incremental.geom_type,
            "incremental_valid": True,
            "operation": "downstream.difference(upstream)",
        }
        pairs.append(row)
        increments.append({"type": "Feature", "id": pair_id, "properties": {
            "id": pair_id, "upstream_station_id": upstream, "downstream_station_id": downstream,
            "upstream_comid": row["upstream_comid"], "downstream_comid": row["downstream_comid"],
            "area_m2": incremental_area, "measurement_crs": MEASUREMENT_CRS,
            "operation": row["operation"], "empty": row["incremental_empty"],
        }, "geometry": display})
    versions = {"python": platform.python_version(), "shapely": shapely.__version__,
                "pyproj": pyproj.__version__, "proj": pyproj.proj_version_str}
    try:
        versions["geos"] = shapely.geos_version_string
    except AttributeError:
        from shapely.geos import geos_version_string
        versions["geos"] = geos_version_string
    producer_raw = Path(__file__).read_bytes()
    result = {
        "schema": OUTPUT_SCHEMA,
        "producer": {"path": "source/three-twenty-hydrologic-context-20261013/native_catchments.py",
                     "bytes": len(producer_raw), "sha256": hashlib.sha256(producer_raw).hexdigest()},
        "source_crs": SOURCE_CRS, "measurement_crs": MEASUREMENT_CRS,
        "source_inputs": sources, "network_binding": bound_network,
        "stations": stations, "pairs": pairs,
        "incremental_geojson": {"type": "FeatureCollection", "features": increments},
        "runtime": versions,
        "projection": {"description": forward.description, "definition": forward.definition,
                       "accuracy_m": forward.accuracy, "always_xy": True},
        "methods": {
            "source_geometry": "One unchanged original Polygon/MultiPolygon feature per retained NLDI basin response; original rings and original bytes remain source companions.",
            "area": "Project every original vertex from EPSG:4326 to EPSG:5070 with longitude/latitude axis order; compute planar polygon area in square metres.",
            "linear_segments": "Projected rings use the projected source vertices joined by straight segments; no densification or simplification is applied.",
            "incremental": "Use projected downstream.difference(upstream); record intersection and upstream.difference(downstream) separately.",
            "topology": "Validate original and projected geometry, preserve interior rings, use native double-precision operations, and report exact coverage plus all residual outside areas.",
            "repairs": "None: no make_valid, buffer, snap, tolerance-based containment claim, or altered original source geometry.",
            "network": "Validate all 65 original directed reaches by exact shared endpoint coordinates and each original indexed station COMID before pairing consecutive stations.",
            "interpretation": "These are the original queried NLDI whole-basin responses, not independently surveyed catchments or flow measurements. Display increments are inverse-projected results; all reported areas use EPSG:5070.",
        },
    }
    if manifest_identity is not None:
        result["input_descriptor"] = manifest_identity
    return result


def output_bytes(result):
    stations = io.StringIO(newline="")
    station_fields = ("station_id", "comid", "area_m2", "area_km2", "geometry_type",
                      "polygon_count", "interior_ring_count", "vertex_count", "valid", "projected_valid")
    writer = csv.DictWriter(stations, fieldnames=station_fields, extrasaction="ignore", lineterminator="\n")
    writer.writeheader()
    writer.writerows(result["stations"])
    pairs = io.StringIO(newline="")
    pair_fields = ("id", "upstream_station_id", "downstream_station_id", "upstream_comid", "downstream_comid",
                   "upstream_area_m2", "downstream_area_m2", "intersection_area_m2",
                   "upstream_outside_downstream_m2", "incremental_area_m2", "incremental_area_km2",
                   "net_area_difference_m2", "upstream_overlap_fraction", "downstream_covers_upstream",
                   "intersects", "relation_upstream_to_downstream", "upstream_area_balance_residual_m2",
                   "downstream_area_balance_residual_m2", "incremental_empty", "incremental_geometry_type",
                   "incremental_valid", "operation")
    writer = csv.DictWriter(pairs, fieldnames=pair_fields, extrasaction="ignore", lineterminator="\n")
    writer.writeheader()
    writer.writerows(result["pairs"])
    return {
        "catchment-analysis.json": canonical_json(result),
        "incremental-catchments.geojson": canonical_json(result["incremental_geojson"]),
        "catchment-areas.csv": stations.getvalue().encode("utf-8"),
        "incremental-catchment-areas.csv": pairs.getvalue().encode("utf-8"),
    }


def save_outputs(output, files):
    output = Path(output).expanduser().resolve()
    if output.exists():
        if not output.is_dir() or any(not (output / name).is_file() or (output / name).read_bytes() != raw
                                      for name, raw in files.items()):
            raise ValueError("Use a new output directory; the existing native result differs.")
        return True
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = Path(tempfile.mkdtemp(prefix="." + output.name + "-", dir=output.parent))
    try:
        for name, raw in files.items():
            path = temporary / name
            with path.open("xb") as stream:
                stream.write(raw)
                stream.flush()
                os.fsync(stream.fileno())
        if output.exists():
            raise ValueError("The output appeared during analysis; preserve that existing result.")
        os.rename(temporary, output)
    finally:
        if temporary.exists():
            shutil.rmtree(temporary)
    return False


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--application", type=Path, required=True)
    parser.add_argument("--inputs", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args(argv)
    application = args.application.expanduser().resolve(strict=True)
    inputs = args.inputs.expanduser().resolve(strict=True)
    if not inputs.is_relative_to(application) or not inputs.is_file():
        parser.error("--inputs must be an original descriptor within --application.")
    raw = inputs.read_bytes()
    descriptor = {"path": inputs.relative_to(application).as_posix(),
                  "bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest()}
    try:
        result = analyze(application, parse_json(raw), descriptor)
        files = output_bytes(result)
        reused = save_outputs(args.output, files)
    except Exception as error:
        print(json.dumps({"status": "failed", "error_type": type(error).__name__,
                          "error": str(error), "input_descriptor": descriptor}, allow_nan=False), file=sys.stderr)
        return 2
    print(json.dumps({"status": "complete", "reused_identical_output": reused,
                      "output": str(args.output.expanduser().resolve()),
                      "stations": len(result["stations"]), "pairs": len(result["pairs"]),
                      "measurement_crs": result["measurement_crs"],
                      "files": [{"path": name, "bytes": len(body), "sha256": hashlib.sha256(body).hexdigest()}
                                for name, body in files.items()]}, allow_nan=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
