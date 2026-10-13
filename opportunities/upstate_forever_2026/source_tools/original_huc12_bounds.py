#!/usr/bin/env python3
"""Reduce the retained original 217-HUC domain to native polygon bounds.

Uses only the Python standard library. The original ZIP, gzip member and decoded
Esri response are checked against the already retained source identities. No
network request, reprojection, simplification or geometry replacement is made.
"""
from __future__ import annotations

import argparse
import csv
from decimal import Decimal
import gzip
import hashlib
import json
from pathlib import Path
import re
import zipfile

ZIP_BYTES = 8800689
ZIP_SHA256 = "1fc35e5d0986e42d93922527d46e38bc5132653db75863934349dbbfaa352c04"
MEMBER_SUFFIX = "model-domain.esri.json.gz"
GZIP_SHA256 = "6f49c2f1dc10709d7957e38e92642a1de4cda44e67e4d70a8bc2ff51388e6af9"
JSON_BYTES = 11220042
JSON_SHA256 = "2300d9b32a513d70503222a5d2e782e032107297214036a58e8b444a312169af"
EXPECTED_FEATURES = 217
EXPECTED_HUC12_SHA256 = "ec0cb3d05a0ede9da1b9238b7c7bff2fa495d94e5a6a0451890b54233edfbd52"


# Same Decimal parser/serializer as the original retained domain composer.
def exact_json(value):
    if value is None: return "null"
    if value is True: return "true"
    if value is False: return "false"
    if isinstance(value, Decimal):
        if not value.is_finite(): raise ValueError("Nonfinite original number")
        return str(value)
    if type(value) is int: return str(value)
    if isinstance(value, str): return json.dumps(value, ensure_ascii=False)
    if isinstance(value, list): return "[" + ",".join(exact_json(x) for x in value) + "]"
    if isinstance(value, dict):
        if not all(isinstance(x, str) for x in value): raise ValueError("Non-string object key")
        return "{" + ",".join(json.dumps(k, ensure_ascii=False) + ":" + exact_json(v) for k,v in value.items()) + "}"
    raise TypeError("Unsupported original JSON value: " + type(value).__name__)

def parsed(body):
    def bad(value): raise ValueError("Nonfinite original JSON value: " + value)
    return json.loads(body, parse_float=Decimal, parse_constant=bad)


def identity(value):
    return {"bytes": len(value), "sha256": hashlib.sha256(value).hexdigest()}


def require_identity(value, expected_sha, expected_bytes=None):
    actual = identity(value)
    if actual["sha256"] != expected_sha or (
            expected_bytes is not None and actual["bytes"] != expected_bytes):
        raise ValueError("Original source identity differs: " + json.dumps(actual))
    return actual


def native_crs(reference):
    if not isinstance(reference, dict):
        raise ValueError("Original spatialReference is missing")
    wkid = reference.get("latestWkid", reference.get("wkid"))
    if wkid not in (3857, 102100, 102113):
        raise ValueError("Expected the retained native EPSG:3857 coordinates")
    return 3857


def extract(archive_path, huc_field=None):
    raw_zip = archive_path.read_bytes()
    archive_identity = require_identity(raw_zip, ZIP_SHA256, ZIP_BYTES)
    # Read the checked bytes so a changed path cannot supply a different member.
    from io import BytesIO
    with zipfile.ZipFile(BytesIO(raw_zip)) as archive:
        members = [item for item in archive.infolist()
                   if not item.is_dir()
                   and (item.filename == MEMBER_SUFFIX
                        or item.filename.endswith("/" + MEMBER_SUFFIX))]
        if len(members) != 1:
            raise ValueError("Expected exactly one original " + MEMBER_SUFFIX)
        member = members[0]
        original_gzip = archive.read(member)
        parent = member.filename[:-len(MEMBER_SUFFIX)]
        companions = {}
        for filename in ("feature-bindings.json", "domain-summary.json"):
            path = parent + filename
            if archive.namelist().count(path) != 1:
                raise ValueError("Expected exactly one original companion: " + filename)
            raw = archive.read(path)
            companions[filename] = {"path": path, "identity": identity(raw), "data": parsed(raw)}
    gzip_identity = require_identity(original_gzip, GZIP_SHA256)
    raw_json = gzip.decompress(original_gzip)
    json_identity = require_identity(raw_json, JSON_SHA256, JSON_BYTES)
    document = parsed(raw_json)
    if not isinstance(document, dict) or document.get("error"):
        raise ValueError("Expected the original Esri feature response")
    if document.get("transform") is not None:
        raise ValueError("Quantized coordinates require a different source operation")
    if document.get("exceededTransferLimit"):
        raise ValueError("Original polygon response reports incomplete transfer")
    if document.get("geometryType") not in (None, "esriGeometryPolygon"):
        raise ValueError("Expected original polygon rings")
    reference = document.get("spatialReference")
    native_crs(reference)
    fields = document.get("fields")
    if not isinstance(fields, list):
        raise ValueError("Original field metadata is missing")
    field_names = [field.get("name") for field in fields]
    oid_fields = [field["name"] for field in fields
                  if field.get("type") == "esriFieldTypeOID"]
    declared_oid = document.get("objectIdFieldName", document.get("objectIdField"))
    if declared_oid is not None:
        if declared_oid not in oid_fields:
            raise ValueError("Declared original OID conflicts with its field metadata")
        oid_field = declared_oid
    elif len(oid_fields) == 1:
        oid_field = oid_fields[0]
    else:
        raise ValueError("Expected one metadata-declared original OID field")
    if huc_field is None:
        candidates = [name for name in field_names if isinstance(name, str)
                      and name.casefold() in {"huc12", "huc_12"}]
        if len(candidates) != 1:
            raise ValueError("Select the exact metadata HUC field with --huc-field")
        huc_field = candidates[0]
    if huc_field not in field_names:
        raise ValueError("Selected HUC field is not in the original metadata")
    features = document.get("features")
    if not isinstance(features, list) or len(features) != EXPECTED_FEATURES:
        raise ValueError("Expected exactly 217 retained original polygons")
    bindings = companions["feature-bindings.json"]["data"]
    if (bindings.get("native_object_id_field") != oid_field
            or bindings.get("native_huc12_field") != huc_field
            or bindings.get("feature_count") != EXPECTED_FEATURES):
        raise ValueError("Original feature bindings disagree with native field metadata")
    seen_hucs, seen_oids, rows = set(), set(), []
    for feature in features:
        attributes = feature.get("attributes")
        geometry = feature.get("geometry")
        if not isinstance(attributes, dict) or not isinstance(geometry, dict):
            raise ValueError("Original feature has no attributes or geometry")
        if geometry.get("transform") is not None or "curveRings" in geometry:
            raise ValueError("Only original unquantized linear polygon rings are supported")
        if geometry.get("spatialReference") is not None:
            native_crs(geometry["spatialReference"])
        huc = attributes.get(huc_field)
        if not isinstance(huc, str) or re.fullmatch(r"[0-9]{12}", huc) is None:
            raise ValueError("Original HUC12 must retain its twelve-digit string")
        oid = attributes.get(oid_field)
        if (isinstance(oid, bool) or not isinstance(oid, (int, str))
                or isinstance(oid, str) and not oid):
            raise ValueError("Original OID is missing or has an unsupported native type")
        oid_key = (type(oid).__name__, oid)
        if huc in seen_hucs or oid_key in seen_oids:
            raise ValueError("Original HUC or typed OID appears more than once")
        seen_hucs.add(huc)
        seen_oids.add(oid_key)
        rings = geometry.get("rings")
        if not isinstance(rings, list) or not rings:
            raise ValueError("Original polygon has no rings")
        xmin = ymin = xmax = ymax = None
        vertices = 0
        for ring in rings:
            if not isinstance(ring, list) or not ring:
                raise ValueError("Original polygon has an empty ring")
            for coordinate in ring:
                if not isinstance(coordinate, (list, tuple)) or len(coordinate) < 2:
                    raise ValueError("Original vertex has no x/y pair")
                x, y = coordinate[:2]
                if (isinstance(x, bool) or isinstance(y, bool)
                        or not isinstance(x, (int, Decimal))
                        or not isinstance(y, (int, Decimal))
                        or isinstance(x, Decimal) and not x.is_finite()
                        or isinstance(y, Decimal) and not y.is_finite()):
                    raise ValueError("Original vertex has nonfinite or nonnumeric x/y")
                xmin = x if xmin is None or x < xmin else xmin
                ymin = y if ymin is None or y < ymin else ymin
                xmax = x if xmax is None or x > xmax else xmax
                ymax = y if ymax is None or y > ymax else ymax
                vertices += 1
        if not xmin < xmax or not ymin < ymax:
            raise ValueError("Original polygon has degenerate native bounds")
        rows.append({
            "huc12": huc, "object_id": oid,
            "xmin": xmin, "ymin": ymin, "xmax": xmax, "ymax": ymax,
            "ring_count": len(rings), "vertex_count": vertices,
        })
    rows.sort(key=lambda row: row["huc12"])
    huc_ids = [row["huc12"] for row in rows]
    huc_identity = require_identity(exact_json(huc_ids).encode("utf-8"), EXPECTED_HUC12_SHA256)
    if sorted(bindings.get("selected_huc12", [])) != huc_ids:
        raise ValueError("Original selected HUC12 bindings differ from retained polygons")
    domain_bounds = [min(row["xmin"] for row in rows), min(row["ymin"] for row in rows),
                     max(row["xmax"] for row in rows), max(row["ymax"] for row in rows)]
    summary = companions["domain-summary.json"]["data"]
    # The original composer preserved Decimal polygon tokens, but explicitly
    # used json.loads(exact_json(bounds)) before ordinary summary serialization.
    # Reproduce that historical conversion only for the companion comparison.
    summary_comparison_bounds = parsed(json.dumps(json.loads(exact_json(domain_bounds))))
    if (summary.get("feature_count") != EXPECTED_FEATURES
            or summary.get("native_bounds") != summary_comparison_bounds):
        raise ValueError("Aggregate bounds differ from the original summary conversion")
    native_crs(summary.get("source_crs"))
    return {
        "schema": "upstate.original-huc12-native-bounds/v1",
        "source": {
            "library_file_id": "libfile_cce17e762e948191be1d226b1dbce00d",
            "file_id": "file_00000000982081f4a357dcf78d83f289",
            "archive_name": archive_path.name, **archive_identity,
            "member": {"path": member.filename, **gzip_identity},
            "decoded": json_identity,
            "companions": [{"path": item["path"], **item["identity"]}
                           for item in companions.values()],
        },
        "spatial_reference": reference, "epsg": 3857,
        "geometry_type": document.get("geometryType", "esriGeometryPolygon"),
        "object_id_field": oid_field, "huc12_field": huc_field,
        "field_metadata": [field for field in fields
                           if field.get("name") in {oid_field, huc_field}],
        "feature_count": len(rows), "sorted_huc12_identity": huc_identity,
        "number_method": "Original decimal tokens preserved using the retained composer Decimal parser and exact_json serializer; selected extrema are unchanged original numbers.",
        "ring_count": sum(row["ring_count"] for row in rows),
        "vertex_count": sum(row["vertex_count"] for row in rows),
        "domain_bounds": dict(zip(("xmin", "ymin", "xmax", "ymax"), domain_bounds)),
        "original_summary_bounds": summary["native_bounds"],
        "original_summary_comparison": {
            "method": "Exact reproduction of original prepare_upstream_domain.py summary-only Decimal-to-float-to-JSON conversion; polygon extrema remain original Decimal values.",
            "matches": True,
        },
        "rows": rows,
    }


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--archive", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True,
                        help="Directory for the derived 217-row JSON and CSV")
    parser.add_argument("--huc-field",
                        help="Exact original metadata field when HUC12 names are ambiguous")
    args = parser.parse_args(argv)
    report = extract(args.archive.resolve(strict=True), args.huc_field)
    args.output.mkdir(parents=True, exist_ok=True)
    json_path = args.output / "original-217-huc12-native-bounds.json"
    csv_path = args.output / "original-217-huc12-native-bounds.csv"
    json_bytes = (exact_json(report) + "\n").encode("utf-8")
    json_path.write_bytes(json_bytes)
    keys = ("huc12", "object_id", "xmin", "ymin", "xmax", "ymax",
            "ring_count", "vertex_count")
    with csv_path.open("w", encoding="utf-8", newline="") as stream:
        writer = csv.DictWriter(stream, fieldnames=keys, lineterminator="\n")
        writer.writeheader()
        writer.writerows(report["rows"])
    print(exact_json({
        "feature_count": report["feature_count"],
        "spatial_reference": report["spatial_reference"],
        "json": {"path": str(json_path.resolve()), **identity(json_bytes)},
        "csv": {"path": str(csv_path.resolve()), **identity(csv_path.read_bytes())},
    }))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
