"""Adopt the retained original SC RFA county response into the parcel pipeline.

The received publisher response remains unchanged. This module composes the
existing source collector and reporting-parcel contracts and uses only their
standard-library acquisition path; the existing planner performs GIS analysis.
"""
from __future__ import annotations

import argparse
import gzip
import json
import math
from pathlib import Path

from model.common import atomic_bytes, atomic_json, describe_file, digest, held, now, read_json
from . import reporting_parcels as parcels
from capture_original_overlays import field_rows, geometry_flags, oid_field, publish_features

SOURCE_URL = ("https://services9.arcgis.com/RvqSyw3diI7dTKo5/ArcGIS/rest/services/"
              "County_Polygons_CBApp/FeatureServer/4")
METADATA_SHA256 = "75b25bccc73fffa346d3eba407f5e478d8b06ac8bf3792c5d8290b52308db5a2"
ATTRIBUTES_SHA256 = "c5f8fda1bc0c86efd2b5a0e29632813e547ad329bb32188a5b81b5648435e092"
ORIGINAL_RESPONSE_BYTES = 4246946
EDITION = "upstate.original-rfa-county-transfer/20261013"
SOURCE_FILES = {
    "metadata": "sc-rfa-original-county-layer-20261013.json",
    "attributes": "sc-rfa-original-county-attributes-20261013.json",
    "features": "sc-rfa-all-46-original-county-polygons-native-20261013.json",
}
QUERY = {"where": "1=1", "outFields": "*", "returnGeometry": "true",
         "returnTrueCurves": "true", "outSR": "6570",
         "orderByFields": "OBJECTID", "f": "json"}


def _object_pairs(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("A received original JSON object repeats " + key)
        result[key] = value
    return result


def _json(body):
    def invalid(value):
        raise ValueError("Original JSON contains a nonfinite number: " + value)
    value = json.loads(body.decode("utf-8"), object_pairs_hook=_object_pairs,
                       parse_constant=invalid)
    if not isinstance(value, dict) or value.get("error"):
        raise ValueError("The original service response must be a successful JSON object")
    if value.get("exceededTransferLimit"):
        raise ValueError("The original service response is truncated")
    return value


def _read(path, *, sha256=None, size=None):
    path = Path(path).resolve(strict=True)
    actual = path.stat().st_size
    if actual > 64 * 1024 * 1024 or (size is not None and actual != size):
        raise ValueError("Unexpected original response byte count: " + str(path))
    body = path.read_bytes()
    if sha256 is not None and digest(body) != sha256:
        raise ValueError("Original retained source identity differs: " + str(path))
    return body, _json(body)


def _native_sr(value):
    sr = value.get("sourceSpatialReference") or value.get("spatialReference")
    if not sr:
        sr = value.get("extent", {}).get("spatialReference")
    if not isinstance(sr, dict) or sr.get("latestWkid", sr.get("wkid")) != 6570:
        raise ValueError("The original county source must retain EPSG6570")
    if sr.get("wkt") or any("vcs" in str(key).lower() for key in sr):
        raise ValueError("Unexpected alternate county coordinate declaration")
    return sr


def _geometry_inventory(features):
    rows = []
    for feature in features:
        attrs, geometry = feature["attributes"], feature["geometry"]
        rings = geometry.get("rings")
        if not isinstance(rings, list) or not rings:
            raise ValueError("Original county needs polygon rings; retain any provider curve companion")
        count = 0
        for ring in rings:
            if not isinstance(ring, list) or len(ring) < 4 or ring[0] != ring[-1]:
                raise ValueError("Original county ring is incomplete")
            for point in ring:
                if (not isinstance(point, list) or len(point) != 2
                        or any(type(number) not in (int, float) or not math.isfinite(number)
                               for number in point)):
                    raise ValueError("Original county coordinate differs from the published XY contract")
            count += len(ring)
        rows.append({"native_oid": attrs["OBJECTID"], "county": attrs["CountyName"],
                     "fips": attrs["FIPS"], "ring_count": len(rings),
                     "vertex_count": count, "date_update": attrs.get("DateUpdate"),
                     "boundary_complete": attrs.get("BoundaryComplete")})
    return rows


def adopt(source_directory, output, *, catalog=parcels.DEFAULT_CATALOG, archive=None):
    """Retain exact source bodies and publish the existing county-capture contract."""
    source_directory = Path(source_directory).resolve(strict=True)
    bodies, values = {}, {}
    for key, name in SOURCE_FILES.items():
        expected = METADATA_SHA256 if key == "metadata" else ATTRIBUTES_SHA256 if key == "attributes" else None
        bodies[key], values[key] = _read(
            source_directory/name, sha256=expected,
            size=ORIGINAL_RESPONSE_BYTES if key == "features" else None)
    metadata, attributes, collection = values["metadata"], values["attributes"], values["features"]
    configured = parcels._catalog(catalog)
    spec = configured["county_boundary"]
    if spec["url"] != SOURCE_URL or spec["county_field"] != "CountyName" or spec["fips_field"] != "FIPS":
        raise ValueError("The provider catalog must select this original SC RFA county source")
    for value in (metadata, attributes, collection):
        _native_sr(value)
        if oid_field(value) != "OBJECTID":
            raise ValueError("The original county OID contract changed")
    if metadata.get("geometryType") != "esriGeometryPolygon":
        raise ValueError("The original county layer is not a polygon source")
    expected_rows = field_rows(attributes, list(range(1, 47)), "OBJECTID")
    original_rows = field_rows(collection, list(range(1, 47)), "OBJECTID")
    parcels._validate_counties(collection, spec)
    expected = {row["attributes"]["OBJECTID"]: row["attributes"] for row in expected_rows}
    for row in original_rows:
        actual = row["attributes"]
        for key, value in expected[actual["OBJECTID"]].items():
            if actual.get(key) != value:
                raise ValueError("Original feature and retained attribute edition differ: " + key)
    if collection.get("fields") != metadata["fields"]:
        # Query responses can add sqlType or omit layer editing/default metadata.
        declared = [(field["name"], field["type"]) for field in collection.get("fields", [])]
        required = [(field["name"], field["type"]) for field in metadata["fields"]]
        if declared != required:
            raise ValueError("Original feature fields differ from the retained native layer schema")
    flags = geometry_flags(collection, metadata)
    if flags != {"hasZ": False, "hasM": False}:
        raise ValueError("The retained county edition must preserve its original XY axis contract")
    inventory = _geometry_inventory(original_rows)
    root = Path(output).resolve()
    county_root = root/("counties-" + digest(spec)[:20])
    county_root.mkdir(parents=True, exist_ok=True)
    raw_sha = digest(bodies["features"])
    identity = "sc-county-boundaries"
    folder = county_root/"layers"/identity
    with held(county_root/"capture.lock", blocking=False):
        index_path = county_root/"county-boundaries.json"
        if index_path.exists():
            old = read_json(index_path)
            parcels._verify_capture(county_root/"layers", old["source"])
            if old["source"].get("adopted_original_response_sha256") != raw_sha:
                raise ValueError("This output already retains another county edition; keep that operation or select a fresh output")
            result = {"state": "complete", "reused": True, "county_source_root": str(county_root),
                      "original_sha256": raw_sha, "count": 46, "source": old["source"]}
        else:
            atomic_json(county_root/"provider-catalog.json", configured, immutable=True)
            parcels._receive_original_reporting(county_root)
            folder.mkdir(parents=True, exist_ok=True)
            originals = folder/"original-transfer"
            originals.mkdir(parents=True, exist_ok=True)
            paths = {}
            for key in SOURCE_FILES:
                paths[key] = originals/(key + ".json.gz")
                if paths[key].exists():
                    if gzip.decompress(paths[key].read_bytes()) != bodies[key]:
                        raise ValueError("A retained original county response changed")
                else:
                    atomic_bytes(paths[key], gzip.compress(bodies[key], mtime=0), immutable=True)
            transfer_path = originals/"transfer.json"
            transfer = {"schema": EDITION, "source_uri": SOURCE_URL, "query": QUERY,
                        "route": "Original public-source attachment capture, received as unchanged local files",
                        "original_response_bytes": len(bodies["features"]),
                        "original_response_sha256": raw_sha,
                        "metadata_sha256": METADATA_SHA256, "attributes_sha256": ATTRIBUTES_SHA256}
            atomic_json(transfer_path, transfer, immutable=True)
            atomic_json(folder/"selection.json", {
                "native_object_id_field": "OBJECTID", "scope": "state",
                "source_spatial_reference": _native_sr(metadata),
                "unique_count": 46, "object_ids": list(range(1, 47)),
                "selection_basis": "Complete original 46-county attribute response",
                "original_attribute_sha256": ATTRIBUTES_SHA256}, immutable=True)
            atomic_json(folder/"county-source-inventory.json", {
                "schema": EDITION, "source_sha256": raw_sha, "count": 46,
                "native_crs": _native_sr(metadata), "counties": inventory}, immutable=True)
            feature_path = folder/"features.esri.json.gz"
            if feature_path.exists():
                derived = parcels._body(feature_path)
                if (derived.get("features") != original_rows
                        or derived.get("fields") != metadata["fields"]
                        or derived.get("spatialReference") != _native_sr(metadata)
                        or geometry_flags(derived, metadata) != flags):
                    raise ValueError("The retained normalized county features differ from the original source")
            else:
                publish_features(feature_path, metadata, [paths["features"]], {}, "OBJECTID", flags)
            parcels._validate_counties(parcels._body(feature_path), spec)
            files = [describe_file(county_root/"layers", path)
                     for path in sorted(folder.rglob("*"))
                     if path.is_file() and path.name != "layer-capture.json"]
            packed = feature_path.read_bytes()
            captured = {
                "id": identity, "title": spec["title"], "role": "COUNTY_CONTEXT",
                "uri": SOURCE_URL, "kind": "vector", "source_crs": _native_sr(metadata),
                "id_field": "OBJECTID", "feature_count": 46, "scope": "state",
                "source_name": metadata.get("name"), "source_description": metadata.get("description", ""),
                "source_copyright": metadata.get("copyrightText", ""),
                "classification_status": None, "geometry_flags": flags,
                "path": feature_path.relative_to(county_root/"layers").as_posix(),
                "sha256": digest(packed), "storage_encoding": "gzip",
                "decoded_sha256": digest(gzip.decompress(packed)), "files": files,
                "curve_representations": [], "coverage": "All 46 original South Carolina county polygons",
                "adopted_original_response_sha256": raw_sha,
                "derivation": "Existing collector normalization; unchanged original publisher response, metadata and attribute query retained in original-transfer"}
            atomic_json(folder/"layer-capture.json", captured, immutable=True)
            index = {"schema": parcels.SCHEMA, "kind": "county-boundary-capture",
                     "catalog_sha256": digest(configured), "source": captured,
                     "catalog": describe_file(county_root, county_root/"provider-catalog.json")}
            atomic_json(index_path, index, immutable=True)
            result = {"state": "complete", "reused": False, "county_source_root": str(county_root),
                      "original_sha256": raw_sha, "count": 46, "source": captured}
    if archive:
        result["archive"] = parcels.bundle(county_root, archive)
    print(json.dumps({"stage": "original-county-adoption", **result}), flush=True)
    return result


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-directory", required=True)
    parser.add_argument("--output", required=True, help="Existing parcel operation output root")
    parser.add_argument("--catalog", default=str(parcels.DEFAULT_CATALOG))
    parser.add_argument("--archive")
    args = parser.parse_args(argv)
    adopt(**vars(args))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
