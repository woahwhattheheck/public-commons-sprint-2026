"""Profile retained original linework through both Water Context length paths.

Authored by TokenJunkieLabs. Inputs are existing GeoJSON or Esri JSON source files.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import platform
import statistics
import sys
import time

from pyproj import CRS, Geod, Transformer, __version__ as pyproj_version
import shapely
from shapely.geometry import LineString, MultiLineString, shape
from shapely.ops import transform

from model import water_context


def _previous_length(geometry, crs):
    if geometry.is_empty:
        return 0.0
    project = Transformer.from_crs(CRS.from_user_input(crs), "EPSG:4326", always_xy=True)
    return float(Geod(ellps="WGS84").geometry_length(transform(project.transform, geometry))) / 1000.0


def _read_original(path, override_crs):
    body = Path(path).read_bytes()
    document = json.loads(body)
    if not isinstance(document.get("features"), list):
        raise ValueError(str(path) + " must contain an original features array")
    spatial = document.get("spatialReference", {})
    wkid = spatial.get("latestWkid", spatial.get("wkid"))
    if override_crs:
        source_crs = CRS.from_user_input(override_crs)
    elif wkid:
        source_crs = CRS.from_user_input("EPSG:" + str(3857 if wkid in (102100, 102113) else wkid))
    elif document.get("crs"):
        source_crs = CRS.from_user_input(document["crs"]["properties"]["name"])
    elif document.get("type") == "FeatureCollection":
        source_crs = CRS.from_epsg(4326)
    else:
        raise ValueError(str(path) + " requires --source-crs")
    rows = []
    for index, feature in enumerate(document["features"]):
        raw = feature.get("geometry")
        if not raw:
            continue
        properties = feature.get("properties") or feature.get("attributes") or {}
        fid = next((properties[key] for key in ("OBJECTID", "objectid", "nhdplus_comid", "identifier", "comid")
                    if key in properties), feature.get("id", index))
        if "paths" in raw:
            paths = [[coordinate[:2] for coordinate in part] for part in raw["paths"]]
            geometry = MultiLineString(paths) if len(paths) > 1 else LineString(paths[0])
        else:
            geometry = shape(raw)
        if geometry.is_empty:
            continue
        if geometry.geom_type not in ("LineString", "MultiLineString", "LinearRing"):
            raise ValueError(str(path) + " contains a non-line feature " + str(fid))
        rows.append((str(fid), geometry))
    if not rows:
        raise ValueError(str(path) + " has no nonempty original linework")
    return rows, source_crs, {"path": str(Path(path).resolve()), "bytes": len(body),
                             "sha256": hashlib.sha256(body).hexdigest(),
                             "source_crs": source_crs.to_string(), "feature_count": len(rows)}


def _timed(function, geometries, crs, repeats):
    durations, checksum = [], 0.0
    for _ in range(repeats):
        started = time.perf_counter()
        checksum = sum(function(geometry, crs) for geometry in geometries)
        durations.append(time.perf_counter() - started)
    return {"runs_seconds": durations, "median_seconds": statistics.median(durations),
            "feature_measurements": len(geometries) * repeats, "sum_km": checksum}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, action="append", required=True)
    parser.add_argument("--source-crs", help="Override original CRS only when explicitly known")
    parser.add_argument("--measurement-crs", action="append")
    parser.add_argument("--repeats", type=int, default=5)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if args.repeats < 1:
        parser.error("--repeats must be positive")
    definitions = args.measurement_crs or ["EPSG:5070", "EPSG:32617"]
    records, originals, all_equal = [], [], True
    for path in args.source:
        rows, native, original = _read_original(path, args.source_crs)
        originals.append(original)
        for definition in definitions:
            crs = CRS.from_user_input(definition)
            project = Transformer.from_crs(native, crs, always_xy=True)
            geometries = [transform(project.transform, row[1]) for row in rows]
            water_context._geodesic_context.cache_clear()
            before = [_previous_length(geometry, crs) for geometry in geometries]
            after = [water_context._geodesic_length(geometry, crs) for geometry in geometries]
            same = all(left.hex() == right.hex() for left, right in zip(before, after))
            all_equal = all_equal and same
            old_timing = _timed(_previous_length, geometries, crs, args.repeats)
            new_timing = _timed(water_context._geodesic_length, geometries, crs, args.repeats)
            serialized = lambda values: "\n".join(value.hex() for value in values).encode("ascii")
            records.append({
                "source_sha256": original["sha256"], "measurement_crs": crs.to_string(),
                "feature_count": len(rows), "all_feature_lengths_bitwise_equal": same,
                "max_absolute_difference_km": max(abs(left-right) for left, right in zip(before, after)),
                "before_lengths_sha256": hashlib.sha256(serialized(before)).hexdigest(),
                "after_lengths_sha256": hashlib.sha256(serialized(after)).hexdigest(),
                "before": old_timing, "after": new_timing,
                "median_speedup": old_timing["median_seconds"] / new_timing["median_seconds"],
                "reused_context_cache": water_context._geodesic_context.cache_info()._asdict(),
                "features": [{"id": row[0], "before_km": left, "after_km": right}
                             for row, left, right in zip(rows, before, after)],
            })
    module_path = Path(water_context.__file__)
    report = {
        "schema": "upstate.water-context-length-profile/v1",
        "method": "Original retained source linework; unchanged WGS84 ellipsoidal geometry length",
        "python": sys.version, "platform": platform.platform(),
        "pyproj": pyproj_version, "shapely": shapely.__version__,
        "water_context_module_sha256": hashlib.sha256(module_path.read_bytes()).hexdigest(),
        "original_sources": originals, "repeats": args.repeats,
        "all_feature_lengths_bitwise_equal": all_equal, "cases": records,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(json.dumps({key: report[key] for key in ("all_feature_lengths_bitwise_equal", "original_sources")},
                     ensure_ascii=False))
    for record in records:
        print(json.dumps({key: record[key] for key in
                          ("source_sha256", "measurement_crs", "feature_count", "median_speedup",
                           "max_absolute_difference_km", "reused_context_cache")}))
    return 0 if all_equal else 1


if __name__ == "__main__":
    raise SystemExit(main())
