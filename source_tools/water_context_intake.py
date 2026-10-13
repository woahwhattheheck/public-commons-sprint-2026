"""Assemble original ArcGIS stream-order and freshwater captures for the workbench.

This receiver reads retained provider responses. It preserves original attributes
and geometry, supplies a native Esri vector source, and binds that source to the
ordinary upstate.sources/v1 workspace importer.
"""
from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import math
import os
from pathlib import Path
import re
import shutil
import tempfile

CAPTURE_SCHEMA = "upstate.water-context-capture/v1"
BINDING_SCHEMA = "upstate.water-context-bindings/v1"
KINDS = {
    "stream_order": {
        "source_id": "nhdplus-hr-network", "role": "NHD_STREAM_ORDER",
        "title": "Original NHDPlus HR stream-order network",
        "fields": ("streamorde", "nhdplusid", "permanent_identifier"),
    },
    "freshwater": {
        "source_id": "sc-hydroclass-fw", "role": "WATER_CLASSIFICATION",
        "title": "Original South Carolina freshwater classification",
        "fields": ("H2OCLASS", "HUC_12"),
    },
}


def _bytes(value):
    return (json.dumps(value, ensure_ascii=False, sort_keys=True,
                       separators=(",", ":"), allow_nan=False) + "\n").encode("utf-8")


def _sha(value):
    return hashlib.sha256(value).hexdigest()


def _file_sha(path):
    digest = hashlib.sha256()
    with Path(path).open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _path(root, name):
    if not isinstance(name, str) or not name or "\\" in name or "\0" in name:
        raise ValueError("A capture member needs a portable relative path")
    member = Path(name)
    if member.is_absolute() or ".." in member.parts:
        raise ValueError("Capture member escapes its source directory: " + name)
    path = (root / member).resolve(strict=True)
    if not path.is_relative_to(root.resolve()) or not path.is_file():
        raise ValueError("Capture member must be a file inside the capture directory: " + name)
    return path


def _json(path):
    raw = Path(path).read_bytes()
    if raw.startswith(b"\x1f\x8b"):
        raw = gzip.decompress(raw)
    result = json.loads(raw)
    if isinstance(result, dict) and result.get("error"):
        raise ValueError("Provider returned an error in " + str(path) + ": " +
                         json.dumps(result["error"], sort_keys=True))
    return result


def _field(fields, requested):
    matches = [row["name"] for row in fields
               if str(row.get("name", "")).casefold() == requested.casefold()]
    if len(matches) != 1:
        raise ValueError("Original layer must declare one field named " + requested)
    return matches[0]


def _ids(value, label, *, expected_count=None):
    if isinstance(value, dict):
        if value.get("exceededTransferLimit"):
            raise ValueError(label + " is truncated")
        has_ids = "objectIds" in value
        value = value.get("objectIds")
        # ArcGIS may return an explicit null objectIds for a genuine empty query.
        # The original response stays unchanged; its paired native count decides.
        if has_ids and value is None and type(expected_count) is int and expected_count == 0:
            value = []
    if not isinstance(value, list) or any(type(item) is not int for item in value):
        raise ValueError(label + " must contain original integer object IDs")
    if len(value) != len(set(value)):
        raise ValueError(label + " repeats an original object ID")
    if expected_count is not None and (
            type(expected_count) is not int or expected_count < 0 or len(value) != expected_count):
        raise ValueError(label + " differs from its original count")
    return set(value)


def _crs_key(value):
    if not isinstance(value, dict):
        raise ValueError("Original geometry needs its published spatial reference")
    wkid = value.get("latestWkid") or value.get("wkid")
    if wkid is not None:
        wkid = int(wkid)
        return ("wkid", 3857 if wkid in (102100, 102113) else wkid)
    if value.get("wkt"):
        return ("wkt", value["wkt"])
    raise ValueError("Original spatial reference has neither WKID nor WKT")


def _same_crs(left, right):
    if _crs_key(left) == _crs_key(right):
        return True
    try:
        from pyproj import CRS
    except ImportError:
        return False
    def convert(value):
        kind, identity = _crs_key(value)
        if kind == "wkt":
            return CRS.from_wkt(identity)
        try:
            return CRS.from_user_input("EPSG:" + str(identity))
        except Exception:
            return CRS.from_user_input("ESRI:" + str(identity))
    return convert(left).equals(convert(right), ignore_axis_order=True)


def _native_geometry(feature, geometry_type, object_id):
    geometry = feature.get("geometry")
    if not isinstance(geometry, dict) or not geometry:
        raise ValueError("Original object " + str(object_id) + " has no geometry")
    if "curvePaths" in geometry or "curveRings" in geometry:
        raise ValueError("Use a retained provider returnTrueCurves=false response for object " +
                         str(object_id) + "; preserve its original curved response as a companion")
    key = {"esriGeometryPolyline": "paths", "esriGeometryPolygon": "rings",
           "esriGeometryPoint": "x"}.get(geometry_type)
    if key not in geometry or (key != "x" and not geometry[key]):
        raise ValueError("Object " + str(object_id) + " does not match its original geometry type")
    if key == "x" and "y" not in geometry:
        raise ValueError("Original point is missing its y coordinate")


def _write(path, body):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists():
        if path.read_bytes() != body:
            raise ValueError("Existing edition differs; choose a new output directory: " + str(path))
        return
    with path.open("xb") as output:
        output.write(body)


class _Retention:
    def __init__(self, source, target):
        self.source, self.target = source, target
        self.members = {}

    def add(self, name):
        path = _path(self.source, name)
        digest = _file_sha(path)
        # The digest directory disambiguates equal filenames from different requests.
        relative = "original/" + digest[:20] + "/" + path.name
        destination = self.target / relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        if destination.exists() and _file_sha(destination) != digest:
            raise ValueError("Retained source hash collision")
        if not destination.exists():
            shutil.copyfile(path, destination)
        record = {"path": relative, "sha256": digest, "bytes": path.stat().st_size,
                  "source_path": name}
        self.members[name] = record
        return record


def _hucs(value):
    if isinstance(value, dict):
        for name in ("huc12s", "domain_huc12s", "HUC_12", "ids"):
            if name in value:
                value = value[name]
                break
    if not isinstance(value, list) or not value:
        raise ValueError("Select the retained original HUC12 list")
    if any(not isinstance(huc, str) or not re.fullmatch(r"[0-9]{12}", huc) for huc in value):
        raise ValueError("Original HUC12 identifiers must be twelve-digit strings")
    if len(value) != len(set(value)):
        raise ValueError("Original HUC12 selection contains duplicates")
    return set(value)


def _layer(source, target, descriptor, captured_at, scope, capture_time_status=None):
    kind = descriptor.get("kind")
    if kind not in KINDS:
        raise ValueError("Water context kind must be stream_order or freshwater")
    contract = KINDS[kind]
    huc_selection_mode = descriptor.get("huc_selection_mode", "publisher")
    if huc_selection_mode not in ("publisher", "geometry"):
        raise ValueError("HUC selection mode must be publisher or geometry")
    if kind == "freshwater" and huc_selection_mode == "geometry":
        if any(not descriptor.get(name) for name in (
                "selected_ids", "selection_geometry", "selection_method")):
            raise ValueError("Geometry-selected freshwater needs exact selected IDs, original geometry and selection method")
    identity = descriptor.get("source_id") or contract["source_id"]
    if not isinstance(identity, str) or not re.fullmatch(r"[a-zA-Z0-9][a-zA-Z0-9._-]*", identity):
        raise ValueError("Source ID must be a portable name")
    folder = target / identity
    folder.mkdir()
    retain = _Retention(source, folder)
    metadata_record = retain.add(descriptor["metadata"])
    metadata = _json(_path(source, descriptor["metadata"]))
    fields = metadata.get("fields")
    if not isinstance(fields, list) or not fields:
        raise ValueError("Retain the original layer fields")
    oid_fields = [row["name"] for row in fields if row.get("type") == "esriFieldTypeOID"]
    declared = metadata.get("objectIdField") or metadata.get("objectIdFieldName")
    oid = _field(fields, declared) if declared else (oid_fields[0] if len(oid_fields) == 1 else None)
    if not oid or oid not in oid_fields:
        raise ValueError("Original layer must declare one native object ID field")
    required = {name: _field(fields, name) for name in contract["fields"]}
    geometry_type = metadata.get("geometryType")
    if geometry_type not in ("esriGeometryPolyline", "esriGeometryPolygon", "esriGeometryPoint"):
        raise ValueError("Unsupported original geometry type")
    if kind == "stream_order" and geometry_type != "esriGeometryPolyline":
        raise ValueError("NHDPlus stream-order source must use original flowline geometry")
    uri = descriptor.get("uri")
    if not isinstance(uri, str) or not uri.startswith(("https://", "http://")):
        raise ValueError("Retain the original public layer URI")

    queries = descriptor.get("queries")
    if not isinstance(queries, list) or not queries:
        raise ValueError("Supply each original count/ID selection")
    expected, query_records = set(), []
    for query in queries:
        count = _json(_path(source, query["count"]))
        listed = _json(_path(source, query["ids"]))
        ids = _ids(listed, "Original ID selection", expected_count=count.get("count"))
        if type(count.get("count")) is not int or count["count"] != len(ids):
            raise ValueError("Original count and native ID membership differ")
        listed_oid = listed.get("objectIdFieldName") if isinstance(listed, dict) else None
        if listed_oid is not None and listed_oid.casefold() != oid.casefold():
            raise ValueError("Original ID response uses a different object ID field")
        if count.get("exceededTransferLimit"):
            raise ValueError("Original count selection is truncated")
        records = {"count": retain.add(query["count"]), "ids": retain.add(query["ids"]),
                   "count_value": len(ids)}
        if query.get("request"):
            records["request"] = retain.add(query["request"])
        if query.get("selection") is not None:
            records["selection"] = query["selection"]
        query_records.append(records)
        expected.update(ids)

    selected = expected
    local_selection = None
    selection_geometry = None
    if descriptor.get("selected_ids"):
        selected = _ids(_json(_path(source, descriptor["selected_ids"])), "Exact domain selection")
        if not selected <= expected:
            raise ValueError("Exact domain selection includes IDs outside the original query")
        local_selection = retain.add(descriptor["selected_ids"])
        if not descriptor.get("selection_method") or not descriptor.get("selection_geometry"):
            raise ValueError("A local domain selection needs its method and original geometry")
        selection_geometry = retain.add(descriptor["selection_geometry"])

    allowed_hucs = None
    huc_record = None
    if kind == "freshwater":
        if not descriptor.get("huc_ids"):
            raise ValueError("Freshwater intake needs its original HUC12 selection")
        allowed_hucs = _hucs(_json(_path(source, descriptor["huc_ids"])))
        expected_hucs = descriptor.get("expected_huc_count")
        if expected_hucs is not None and len(allowed_hucs) != expected_hucs:
            raise ValueError("The original HUC12 selection count differs")
        huc_record = retain.add(descriptor["huc_ids"])

    pages = descriptor.get("pages", [])
    if not isinstance(pages, list) or (expected and not pages):
        raise ValueError("Supply all original feature pages")
    seen, page_records, page_sr, flags = {}, [], None, None
    field_values, null_orders, original_hucs = {}, 0, {}
    publisher_huc_mismatches = []
    for member in pages:
        body = _json(_path(source, member))
        if body.get("exceededTransferLimit"):
            raise ValueError("Original feature page is truncated: " + member)
        rows = body.get("features")
        if not isinstance(rows, list):
            raise ValueError("Original feature page has no features array: " + member)
        if body.get("geometryType", geometry_type) != geometry_type:
            raise ValueError("Feature page and layer geometry types differ")
        sr = body.get("spatialReference") or metadata.get("sourceSpatialReference") or metadata.get("extent", {}).get("spatialReference")
        _crs_key(sr)
        if page_sr is not None and not _same_crs(page_sr, sr):
            raise ValueError("Original feature pages have different spatial references")
        page_sr = sr
        current_flags = {name: body.get(name, metadata.get(name, False)) for name in ("hasZ", "hasM")}
        if any(type(flag) is not bool for flag in current_flags.values()):
            raise ValueError("Original Z/M geometry flags must be Boolean")
        if flags is not None and flags != current_flags:
            raise ValueError("Original feature pages differ in their Z/M dimensions")
        flags = current_flags
        page_ids = set()
        for feature in rows:
            properties = feature.get("attributes", {})
            object_id = properties.get(oid)
            if type(object_id) is not int or object_id not in expected or object_id in page_ids:
                raise ValueError("Feature page has unexpected or duplicate native object IDs")
            page_ids.add(object_id)
            fingerprint = _sha(_bytes(feature))
            if object_id in seen and seen[object_id] != fingerprint:
                raise ValueError("Original object changed between retained pages: " + str(object_id))
            if object_id in seen:
                continue
            seen[object_id] = fingerprint
            _native_geometry(feature, geometry_type, object_id)
            absent = [name for name in required.values() if name not in properties]
            if absent:
                raise ValueError("Original feature lacks required attributes: " + ", ".join(absent))
            if object_id not in selected:
                continue
            if kind == "stream_order":
                order = properties[required["streamorde"]]
                if order is None:
                    null_orders += 1
                elif isinstance(order, bool) or not isinstance(order, (int, float)) or not math.isfinite(order) or order < 0 or int(order) != order:
                    raise ValueError("Original StreamOrder must be a nonnegative integer or null")
                else:
                    key = str(int(order))
                    field_values[key] = field_values.get(key, 0) + 1
            else:
                if properties[required["H2OCLASS"]] != "FW":
                    raise ValueError("Freshwater source includes a different original H2OCLASS")
                huc = properties[required["HUC_12"]]
                in_publisher_selection = isinstance(huc, str) and huc in allowed_hucs
                if not in_publisher_selection:
                    if huc_selection_mode == "publisher":
                        raise ValueError("Freshwater feature is outside the selected original HUC_12 set")
                    publisher_huc_mismatches.append({
                        "native_object_id": object_id,
                        "publisher_huc12": huc,
                        "reason": ("missing_publisher_huc" if huc is None or huc == ""
                                   else "publisher_huc_outside_selected_domain"),
                    })
                # Canonical bytes order native values without converting nulls,
                # blanks or other retained field values into different HUC IDs.
                huc_key = _bytes(huc)
                if huc_key not in original_hucs:
                    original_hucs[huc_key] = {"value": huc, "native_feature_count": 0}
                original_hucs[huc_key]["native_feature_count"] += 1
        record = retain.add(member)
        page_records.append({**record, "native_feature_count": len(rows)})
    if set(seen) != expected:
        missing = sorted(expected - set(seen))
        raise ValueError("Original geometry pages omit selected object IDs: " + repr(missing[:20]))

    for member in descriptor.get("companions", []):
        retain.add(member)
    if not page_sr:
        page_sr = metadata.get("sourceSpatialReference") or metadata.get("extent", {}).get("spatialReference")
        _crs_key(page_sr)
    flags = flags or {name: metadata.get(name, False) for name in ("hasZ", "hasM")}
    header = {"displayFieldName": metadata.get("displayField", ""), "objectIdFieldName": oid,
              "fieldAliases": {row["name"]: row.get("alias", row["name"]) for row in fields},
              "fields": fields, "geometryType": geometry_type, "spatialReference": page_sr, **flags}
    vector_path = folder / "features.esri.json.gz"
    emitted = set()
    with vector_path.open("xb") as native:
        with gzip.GzipFile(filename="", fileobj=native, mode="wb", mtime=0) as compressed:
            compressed.write(_bytes(header).rstrip()[:-1] + b',"features":[')
            first = True
            for member in pages:
                for feature in _json(_path(source, member))["features"]:
                    object_id = feature["attributes"][oid]
                    if object_id not in selected or object_id in emitted:
                        continue
                    if not first:
                        compressed.write(b",")
                    compressed.write(_bytes(feature).rstrip())
                    first = False
                    emitted.add(object_id)
            compressed.write(b"]}\n")
    if emitted != selected:
        raise ValueError("Source edition and exact selected native IDs differ")

    native_record = {"path": "features.esri.json.gz", "sha256": _file_sha(vector_path),
                     "bytes": vector_path.stat().st_size, "storage_encoding": "gzip"}
    selection_record = {"schema": "upstate.water-context-layer/v1", "source_id": identity,
                        "kind": kind, "role": contract["role"], "uri": uri, "captured_at": captured_at,
                        "capture_time_status": capture_time_status,
                        "native_object_id_field": oid, "native_field_bindings": required,
                        "metadata": metadata_record, "queries": query_records, "pages": page_records,
                        "scope": descriptor.get("scope", scope),
                        "provider_candidate_count": len(expected), "feature_count": len(selected),
                        "object_ids": sorted(selected), "local_selection": local_selection,
                        "selection_geometry": selection_geometry,
                        "selection_method": descriptor.get("selection_method", "Original publisher query membership"),
                        "source_spatial_reference": metadata.get("sourceSpatialReference") or metadata.get("extent", {}).get("spatialReference"),
                        "vector_spatial_reference": page_sr, "native_vector": native_record,
                        "stream_order_counts": field_values if kind == "stream_order" else None,
                        "null_stream_order_count": null_orders if kind == "stream_order" else None,
                        "huc_selection": huc_record, "huc_selection_count": len(allowed_hucs) if allowed_hucs is not None else None,
                        "huc_selection_mode": huc_selection_mode if kind == "freshwater" else None,
                        "hucs_with_features": [original_hucs[key]["value"] for key in sorted(original_hucs)] if allowed_hucs is not None else None,
                        "publisher_huc_inventory": [original_hucs[key] for key in sorted(original_hucs)] if allowed_hucs is not None else None,
                        "publisher_huc_mismatch_count": len(publisher_huc_mismatches) if kind == "freshwater" else None,
                        "publisher_huc_mismatches": sorted(publisher_huc_mismatches, key=lambda row: row["native_object_id"]) if kind == "freshwater" else None}
    _write(folder / "layer-intake.json", _bytes(selection_record))
    unique_members = {record["path"]: record for record in retain.members.values()}
    members = [{"path": identity + "/" + record["path"], "sha256": record["sha256"],
                "bytes": record["bytes"]} for _, record in sorted(unique_members.items())]
    members.append({"path": identity + "/layer-intake.json",
                    "sha256": _file_sha(folder / "layer-intake.json"),
                    "bytes": (folder / "layer-intake.json").stat().st_size})
    entry = {"id": identity, "title": descriptor.get("title") or contract["title"],
             "uri": uri, "vintage": descriptor.get("vintage") or captured_at or "Capture time unavailable after response recovery",
             "kind": "vector", "role": contract["role"],
             "path": identity + "/" + native_record["path"], "sha256": native_record["sha256"],
             "bytes": native_record["bytes"], "id_field": oid, "companions": members,
             "metadata": {"feature_count": len(selected), "provider_candidate_count": len(expected),
                          "captured_at": captured_at, "capture_time_status": capture_time_status,
                          "source_crs": page_sr, "native_field_bindings": required,
                          "scope": descriptor.get("scope", scope), "classification": "FW" if kind == "freshwater" else None,
                          "huc_selection_mode": huc_selection_mode if kind == "freshwater" else None,
                          "publisher_huc_mismatch_count": len(publisher_huc_mismatches) if kind == "freshwater" else None,
                          "intake_record": "layer-intake.json", "source_description": metadata.get("description", ""),
                          "source_copyright": metadata.get("copyrightText", "")}}
    binding = {"kind": kind, "role": contract["role"], "source_id": identity,
               "source_collection_id": None, "id_field": oid, "fields": required,
               "source_uri": uri, "body_sha256": native_record["sha256"],
               "captured_at": captured_at, "capture_time_status": capture_time_status,
               "feature_count": len(selected), "scope": descriptor.get("scope", scope)}
    if kind == "stream_order":
        binding["stream_order_field"] = required["streamorde"]
    else:
        binding.update(classification_field=required["H2OCLASS"], huc12_field=required["HUC_12"],
                       where={required["H2OCLASS"]: "FW"},
                       huc_selection_mode=huc_selection_mode,
                       publisher_huc_mismatch_count=len(publisher_huc_mismatches))
    return entry, binding, selection_record


def _parcel_source_context(source, target, descriptor, entry, binding, report):
    """Bind a complete FW edition to its unchanged original capture polygons."""
    if binding["kind"] != "freshwater":
        return None
    entry["metadata"]["parcel_criteria"] = {
        "fields": {"classification": binding["classification_field"]},
        "class_scope": ["FW"], "where": dict(binding["where"]),
        "reference": "Original SCDES freshwater-only source edition; other classes use their own retained source",
        "meaning": "Presence of retained SCDES FW-classified geometry. A complete negative means no matching "
                   "retained FW feature in this source inventory; ecological freshwater presence outside the "
                   "publisher's inventory remains unknown.",
    }
    declared = descriptor.get("criteria_coverage")
    if declared is None:
        return None
    if (not isinstance(declared, dict) or descriptor.get("huc_selection_mode") != "geometry"
            or declared.get("method") != "provider_intersects_each_original_domain_polygon"):
        raise ValueError("Freshwater criterion coverage requires the complete original physical-domain capture")
    geometry_member = descriptor.get("selection_geometry")
    record = report.get("selection_geometry")
    if not geometry_member or not record or record.get("source_path") != geometry_member:
        raise ValueError("Criterion coverage must be the retained original selection geometry")
    original = _json(_path(source, geometry_member))
    original_features = original.get("features")
    if (original.get("geometryType", "esriGeometryPolygon") != "esriGeometryPolygon"
            or not isinstance(original_features, list) or not original_features):
        raise ValueError("Criterion coverage needs the original native polygon feature set")
    field = declared.get("huc12_field")
    if not isinstance(field, str) or not field:
        raise ValueError("Criterion coverage needs the exact original HUC12 field")
    expected_hucs = _hucs(_json(_path(source, descriptor["huc_ids"])))
    actual_hucs = set()
    original_polygons = {}
    reference = original.get("spatialReference")
    for index, feature in enumerate(original_features):
        _native_geometry(feature, "esriGeometryPolygon", index)
        huc = feature.get("attributes", {}).get(field)
        if not isinstance(huc, str) or huc not in expected_hucs:
            raise ValueError("Criterion coverage polygon is outside the exact original HUC selection")
        actual_hucs.add(huc)
        current_reference = feature["geometry"].get("spatialReference") or reference
        _crs_key(current_reference)
        if reference is not None and not _same_crs(reference, current_reference):
            raise ValueError("Original criterion coverage polygons use different coordinate references")
        reference = current_reference
        polygon = {**feature["geometry"], "spatialReference": current_reference}
        key = _sha(_bytes([huc, polygon]))
        original_polygons[key] = original_polygons.get(key, 0) + 1
    if actual_hucs != expected_hucs:
        raise ValueError("Criterion coverage omits an original selected HUC12")
    geometric_queries = [query for query in descriptor["queries"]
                         if isinstance(query.get("selection"), dict)
                         and query["selection"].get("method") == "Original polygon intersects"]
    if (len(geometric_queries) != len(original_features)
            or {query["selection"].get("huc12") for query in geometric_queries} != expected_hucs):
        raise ValueError("Criterion coverage needs complete native polygon queries for the retained domain")
    physical_ids, queried_polygons = set(), {}
    for query in geometric_queries:
        selection = query["selection"]
        geometry = _json(_path(source, selection["geometry"]))
        key = _sha(_bytes([selection["huc12"], geometry]))
        queried_polygons[key] = queried_polygons.get(key, 0) + 1
        request = _json(_path(source, query["request"]))
        parameters = request.get("parameters", {})
        if (parameters.get("geometry_file") != selection["geometry"]
                or parameters.get("geometryType") != "esriGeometryPolygon"
                or parameters.get("spatialRel") != "esriSpatialRelIntersects"
                or parameters.get("where") != "H2OCLASS='FW'"):
            raise ValueError("Criterion coverage query differs from the original FW polygon intersection")
        count = _json(_path(source, query["count"]))
        physical_ids.update(_ids(_json(_path(source, query["ids"])),
                                 "Criterion coverage polygon IDs", expected_count=count.get("count")))
    if queried_polygons != original_polygons:
        raise ValueError("Criterion coverage differs from the polygons actually queried")
    if physical_ids != set(report["object_ids"]):
        raise ValueError("Criterion source IDs differ from the complete physical-domain query union")
    uri = declared.get("uri")
    if not isinstance(uri, str) or not uri.startswith(("https://", "http://")):
        raise ValueError("Retain the original coverage polygon provider URI")
    coverage_id = entry["id"] + "-coverage-domain"
    relative = entry["id"] + "/" + record["path"]
    retained_path = _path(target, relative)
    if _file_sha(retained_path) != record["sha256"]:
        raise ValueError("Retained criterion coverage bytes changed")
    # The local source reference is resolved to this collection after import.
    coverage = {
        "source": {"source_id": coverage_id},
        "huc12_field": field, "huc12_ids": sorted(expected_hucs),
        "reference": "Complete original FW count/ID intersection against every retained model-domain polygon",
    }
    entry["metadata"]["criteria_coverage"] = coverage
    binding["criteria_coverage"] = coverage
    coverage_record = {**coverage, "original_geometry": record,
                       "method": declared["method"], "parcel_criteria": entry["metadata"]["parcel_criteria"]}
    coverage_path = target / entry["id"] / "parcel-coverage.json"
    _write(coverage_path, _bytes(coverage_record))
    entry["companions"].append({"path": entry["id"] + "/parcel-coverage.json",
                               "sha256": _file_sha(coverage_path),
                               "bytes": coverage_path.stat().st_size})
    # Reuse the retained original body; no polygon rewrite or alternate mask.
    result = {
        "id": coverage_id, "title": "Original physical freshwater capture domain",
        "uri": uri, "vintage": declared.get("vintage") or "Original retained model-domain polygon edition",
        "kind": "vector", "role": "SOURCE_COVERAGE", "format": "EsriJSON",
        "path": relative, "sha256": record["sha256"], "bytes": record["bytes"],
        "companions": [], "metadata": {
            "source_crs": reference, "huc12_field": field,
            "huc12_count": len(expected_hucs), "feature_count": len(original_features),
            "covers_source_id": entry["id"], "coverage_method": declared["method"],
        },
    }
    fields = original.get("fields", [])
    identifiers = [row["name"] for row in fields if row.get("type") == "esriFieldTypeOID"]
    if len(identifiers) == 1:
        values = [feature.get("attributes", {}).get(identifiers[0]) for feature in original_features]
        if all(type(value) is int for value in values) and len(set(values)) == len(values):
            result["id_field"] = identifiers[0]
    return result


def assemble(capture_path, output):
    """Create an immutable source edition from complete original response files."""
    capture_path = Path(capture_path).resolve(strict=True)
    capture = _json(capture_path)
    if capture.get("schema") != CAPTURE_SCHEMA:
        raise ValueError("Capture descriptor must use " + CAPTURE_SCHEMA)
    source = capture_path.parent
    output = Path(output).absolute()
    captured_at = capture.get("captured_at")
    capture_time_status = capture.get("capture_time_status")
    if captured_at is None:
        if capture_time_status != "unavailable_after_response_recovery":
            raise ValueError("Retain the original capture UTC date/time or its explicit unavailable-after-recovery status")
    elif not isinstance(captured_at, str) or not captured_at.strip():
        raise ValueError("Retain the original capture UTC date/time")
    elif capture_time_status == "unavailable_after_response_recovery":
        raise ValueError("An unavailable original capture time must remain null")
    vintage = captured_at or "Capture time unavailable after response recovery"
    layers = capture.get("layers")
    if not isinstance(layers, list) or not layers:
        raise ValueError("Select at least one original water-context layer")
    descriptor_sha = _file_sha(capture_path)
    existing = output / "intake.json"
    if existing.exists():
        receipt = _json(existing)
        if receipt.get("capture_sha256") != descriptor_sha:
            raise ValueError("Output contains another source edition")
        for record in receipt["files"]:
            path = _path(output, record["path"])
            if path.stat().st_size != record["bytes"] or _file_sha(path) != record["sha256"]:
                raise ValueError("Retained water-context edition changed: " + record["path"])
        return {**receipt, "output": str(output), "reused": True}
    if output.exists():
        raise ValueError("Choose a new output directory")
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix=".water-context-", dir=output.parent) as temporary:
        stage = Path(temporary) / "edition"
        stage.mkdir()
        entries, bindings, summary = [], {}, []
        for descriptor in layers:
            entry, binding, report = _layer(source, stage, descriptor, captured_at, capture.get("scope", {}),
                                            capture_time_status=capture_time_status)
            if entry["id"] in {row["id"] for row in entries} or binding["kind"] in bindings:
                raise ValueError("Select a single original edition for each water-context kind")
            coverage_entry = _parcel_source_context(source, stage, descriptor, entry, binding, report)
            if coverage_entry:
                if coverage_entry["id"] in {row["id"] for row in entries}:
                    raise ValueError("Criterion coverage source identity duplicates another imported entry")
                entries.append(coverage_entry)
            entries.append(entry)
            bindings[binding["kind"]] = binding
            summary.append({"source_id": entry["id"], "kind": binding["kind"],
                            "feature_count": report["feature_count"],
                            "provider_candidate_count": report["provider_candidate_count"],
                            "stream_order_counts": report["stream_order_counts"],
                            "null_stream_order_count": report["null_stream_order_count"],
                            "huc_selection_count": report["huc_selection_count"],
                            "huc_selection_mode": report["huc_selection_mode"],
                            "publisher_huc_mismatch_count": report["publisher_huc_mismatch_count"]})
        shutil.copyfile(capture_path, stage / "original-capture.json")
        entries.append({"id": "water-context-capture-" + descriptor_sha[:20],
                        "title": "Original water-context capture selection",
                        "uri": "urn:sha256:" + descriptor_sha, "vintage": vintage,
                        "metadata": {"captured_at": captured_at, "capture_time_status": capture_time_status},
                        "kind": "document", "role": "SOURCE_SELECTION",
                        "path": "original-capture.json", "sha256": descriptor_sha,
                        "bytes": capture_path.stat().st_size, "companions": []})
        _write(stage / "model-sources.json", _bytes({"schema": "upstate.sources/v1",
            "title": capture.get("title", "Original Upper Savannah water-context sources"),
            "captured_at": captured_at, "capture_time_status": capture_time_status,
            "scope": capture.get("scope", {}),
            "entries": entries,
            "notes": ["Native object identities, attributes and returned geometry accompany their original publisher responses."]}))
        _write(stage / "bindings.json", _bytes({"schema": BINDING_SCHEMA, "bindings": bindings,
            "manifest": "model-sources.json", "capture_sha256": descriptor_sha,
            "captured_at": captured_at, "capture_time_status": capture_time_status}))
        # This walk is restricted to the newly staged source edition.
        files = [{"path": path.relative_to(stage).as_posix(), "sha256": _file_sha(path),
                  "bytes": path.stat().st_size} for path in sorted(stage.rglob("*")) if path.is_file()]
        receipt = {"schema": "upstate.water-context-intake/v1", "capture_sha256": descriptor_sha,
                   "captured_at": captured_at, "capture_time_status": capture_time_status,
                   "manifest": "model-sources.json", "bindings": "bindings.json",
                   "sources": summary, "files": files}
        _write(stage / "intake.json", _bytes(receipt))
        os.rename(stage, output)
    return {**receipt, "output": str(output), "reused": False}


def _edition_inventory(edition):
    """Resolve the exact ordinary-source edition members and byte identities."""
    edition = Path(edition).resolve(strict=True)
    intake_path = edition / "intake.json"
    intake_bytes = intake_path.read_bytes()
    receipt = json.loads(intake_bytes)
    if receipt.get("schema") != "upstate.water-context-intake/v1":
        raise ValueError("Choose a prepared water-context edition")
    members = receipt.get("files")
    if not isinstance(members, list) or not members:
        raise ValueError("Prepared edition has no retained file inventory")
    found = {}
    for record in members:
        name = record["path"]
        if name == "intake.json" or name in found:
            raise ValueError("Prepared edition repeats a retained member")
        path = _path(edition, name)
        if (path.stat().st_size != record["bytes"]
                or _file_sha(path) != record["sha256"]):
            raise ValueError("Prepared source changed: " + name)
        found[name] = {"path": path, "bytes": record["bytes"], "sha256": record["sha256"]}
    for required in ("model-sources.json", "bindings.json", "original-capture.json"):
        if required not in found:
            raise ValueError("Prepared source edition is missing " + required)
    if found["original-capture.json"]["sha256"] != receipt["capture_sha256"]:
        raise ValueError("The retained capture descriptor identity differs")
    return edition, receipt, found, intake_bytes


def export_edition(edition, archive):
    """Package every original response and native source for another receiver."""
    import zipfile
    edition, receipt, members, intake_bytes = _edition_inventory(edition)
    archive = Path(archive).absolute()
    if archive.exists():
        raise ValueError("Choose a new source archive path")
    archive.parent.mkdir(parents=True, exist_ok=True)
    pending = None
    try:
        with tempfile.NamedTemporaryFile(dir=archive.parent, prefix=".water-source-", delete=False) as out:
            pending = Path(out.name)
        with zipfile.ZipFile(pending, "w", allowZip64=True) as bundle:
            for name, record in sorted(members.items()):
                info = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
                info.create_system = 3
                info.external_attr = 0o100644 << 16
                # Agency gzip bodies remain the exact original compressed bytes.
                info.compress_type = zipfile.ZIP_STORED if name.endswith(".gz") else zipfile.ZIP_DEFLATED
                digest, size = hashlib.sha256(), 0
                with record["path"].open("rb") as source, bundle.open(info, "w", force_zip64=True) as target:
                    for chunk in iter(lambda: source.read(1024 * 1024), b""):
                        digest.update(chunk)
                        size += len(chunk)
                        target.write(chunk)
                if size != record["bytes"] or digest.hexdigest() != record["sha256"]:
                    raise ValueError("Original source changed while packaging: " + name)
            info = zipfile.ZipInfo("intake.json", date_time=(1980, 1, 1, 0, 0, 0))
            info.create_system = 3
            info.external_attr = 0o100644 << 16
            info.compress_type = zipfile.ZIP_DEFLATED
            bundle.writestr(info, intake_bytes)
        # Linking publishes a completed archive without replacing existing work.
        os.link(pending, archive)
        return {"schema": "upstate.water-context-transfer/v1",
                "path": str(archive), "bytes": archive.stat().st_size,
                "sha256": _file_sha(archive), "capture_sha256": receipt["capture_sha256"],
                "source_members": len(members), "source_count": len(receipt["sources"])}
    finally:
        if pending is not None:
            pending.unlink(missing_ok=True)


def receive_edition(archive, output):
    """Restore a complete source archive before ordinary Workspace import."""
    import stat
    import zipfile
    archive = Path(archive).resolve(strict=True)
    output = Path(output).absolute()
    if output.exists():
        raise ValueError("Choose a new receiving directory")
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix=".water-receive-", dir=output.parent) as temporary:
        stage = Path(temporary) / "edition"
        stage.mkdir()
        with zipfile.ZipFile(archive) as bundle:
            infos = bundle.infolist()
            names = [info.filename for info in infos]
            if len(names) != len(set(names)) or "intake.json" not in names:
                raise ValueError("Source archive has duplicate members or no intake record")
            intake_bytes = bundle.read("intake.json")
            receipt = json.loads(intake_bytes)
            if receipt.get("schema") != "upstate.water-context-intake/v1":
                raise ValueError("Source archive has an unsupported intake record")
            records = receipt.get("files")
            if not isinstance(records, list):
                raise ValueError("Source archive has no original file inventory")
            expected = {row["path"]: row for row in records}
            if len(expected) != len(records) or set(names) != set(expected) | {"intake.json"}:
                raise ValueError("Source archive membership differs from its retained inventory")
            for info in infos:
                name = info.filename
                member = Path(name)
                mode = info.external_attr >> 16
                if (member.is_absolute() or not member.parts or ".." in member.parts
                        or member.as_posix() != name or "\\" in name or "\0" in name
                        or info.is_dir() or (stat.S_IFMT(mode) and not stat.S_ISREG(mode))):
                    raise ValueError("Source archive contains an unsupported member: " + name)
                record = expected.get(name)
                if record is not None and info.file_size != record["bytes"]:
                    raise ValueError("Archived member length differs: " + name)
                destination = stage / member
                destination.parent.mkdir(parents=True, exist_ok=True)
                digest, size = hashlib.sha256(), 0
                with bundle.open(info) as source, destination.open("xb") as target:
                    for chunk in iter(lambda: source.read(1024 * 1024), b""):
                        digest.update(chunk)
                        size += len(chunk)
                        target.write(chunk)
                if record is not None and (size != record["bytes"] or digest.hexdigest() != record["sha256"]):
                    raise ValueError("Archived original source differs: " + name)
        _, retained, _, _ = _edition_inventory(stage)
        os.rename(stage, output)
    return {**retained, "output": str(output), "archive_sha256": _file_sha(archive)}


def bind_workspace(workspace, edition):
    """Return both watershed selectors and the model's native reference objects."""
    edition, _, _, _ = _edition_inventory(edition)
    result = _json(edition / "bindings.json")
    if result.get("schema") != BINDING_SCHEMA:
        raise ValueError("Prepared source bindings use an unsupported schema")
    source = workspace.import_sources(edition / "model-sources.json")
    entries = {entry["id"]: entry for entry in source["entries"]}
    result["source_collection_id"] = source["id"]
    result["collection_id"] = source["id"]
    result["water_context_overlays"] = {}
    result["parcel_criteria_sources"] = {}
    for kind, binding in result["bindings"].items():
        entry = entries.get(binding["source_id"])
        if (entry is None or entry.get("role") != binding["role"]
                or entry["body"]["sha256"] != binding["body_sha256"]):
            raise ValueError("Source binding does not match its imported native source")
        reference = {"collection_id": source["id"], "source_id": entry["id"],
                     "id_field": binding["id_field"]}
        if kind == "freshwater":
            reference["where"] = dict(binding["where"])
            criterion = {"source_collection_id": source["id"], "source_id": entry["id"],
                         "id_field": binding["id_field"], "where": dict(binding["where"]),
                         "fields": {"classification": binding["classification_field"]},
                         "class_scope": ["FW"]}
            declared = entry.get("metadata", {}).get("parcel_criteria", {})
            for key in ("reference", "meaning"):
                if key in declared:
                    criterion[key] = declared[key]
            if binding.get("criteria_coverage"):
                coverage = json.loads(json.dumps(binding["criteria_coverage"]))
                coverage["source"]["source_collection_id"] = source["id"]
                coverage_entry = entries.get(coverage["source"]["source_id"])
                if not coverage_entry or coverage_entry.get("role") != "SOURCE_COVERAGE":
                    raise ValueError("The imported freshwater coverage source is missing")
                criterion["coverage"] = coverage
                binding["criteria_coverage"] = coverage
            result["parcel_criteria_sources"]["classifications"] = criterion
        binding["source_collection_id"] = source["id"]
        binding["collection_id"] = source["id"]
        binding["native_reference"] = reference
        if kind == "stream_order":
            result["water_context_overlays"]["stream_order"] = dict(reference)
    return result


def water_context_spec(bindings, boundary, *, title="Upper Savannah water and habitat context",
                       overlays=None, relations=None, measurement_crs="EPSG:5070"):
    """Compose the existing model.water_context.build selection contract."""
    if not isinstance(boundary, dict) or not all(
            isinstance(boundary.get(name), str) and boundary[name]
            for name in ("collection_id", "source_id")):
        raise ValueError("Choose the existing retained polygon boundary reference")
    if bindings.get("schema") != BINDING_SCHEMA or not bindings.get("source_collection_id"):
        raise ValueError("Import the source edition before composing a native selection")
    chosen = dict(overlays or {})
    for kind, reference in bindings.get("water_context_overlays", {}).items():
        if kind in chosen and chosen[kind] != reference:
            raise ValueError("The supplied selection already uses another " + kind + " edition")
        chosen[kind] = dict(reference)
    return {"title": title, "boundary": dict(boundary), "overlays": chosen,
            "relations": list(relations or []), "measurement_crs": measurement_crs}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    input_group = parser.add_mutually_exclusive_group(required=True)
    input_group.add_argument("--capture", help="Original capture descriptor JSON")
    input_group.add_argument("--receive", help="Complete prepared source-edition ZIP")
    parser.add_argument("--output", required=True, help="New immutable source-edition directory")
    parser.add_argument("--archive-output", help="Package all retained native sources for another receiver")
    parser.add_argument("--workspace", help="Import into this existing scientific workspace")
    parser.add_argument("--bindings-output", help="Write exact imported collection/source selections")
    parser.add_argument("--water-context-boundary", help="JSON containing the retained polygon boundary reference")
    parser.add_argument("--water-context-spec-output", help="Write a ready native Water and Habitat Context selection")
    args = parser.parse_args(argv)
    if args.bindings_output and not args.workspace:
        parser.error("--bindings-output requires --workspace")
    if bool(args.water_context_boundary) != bool(args.water_context_spec_output):
        parser.error("Use --water-context-boundary and --water-context-spec-output together")
    if args.water_context_boundary and not args.workspace:
        parser.error("--water-context-boundary requires --workspace")
    result = (receive_edition(args.receive, args.output) if args.receive
              else assemble(args.capture, args.output))
    if args.archive_output:
        result["transfer"] = export_edition(args.output, args.archive_output)
    if args.workspace:
        from model.workspace import Workspace
        bindings = bind_workspace(Workspace(args.workspace), args.output)
        if args.bindings_output:
            _write(Path(args.bindings_output), _bytes(bindings))
        result["workspace_bindings"] = bindings
        if args.water_context_boundary:
            spec = water_context_spec(bindings, _json(Path(args.water_context_boundary)))
            _write(Path(args.water_context_spec_output), _bytes(spec))
            result["water_context_selection"] = spec
    print(json.dumps({key: value for key, value in result.items() if key != "files"},
                     ensure_ascii=False, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
