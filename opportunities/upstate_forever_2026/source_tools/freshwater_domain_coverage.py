"""Complete freshwater coverage from the retained original model-domain polygons.

Reuses the existing publisher-HUC capture. The only new geometry downloads are
native feature IDs selected by the physical domain but missing from that capture.
Run from the maintained application; results feed water_context_intake directly.
"""
from __future__ import annotations

import argparse
from collections import defaultdict
import csv
from datetime import datetime, timezone
import gzip
import hashlib
import io
import json
from pathlib import Path
import shutil
import time
import urllib.error
import urllib.parse
import urllib.request
import zipfile

from source_tools.water_context_geometry import _member
from source_tools.water_context_intake import (
    CAPTURE_SCHEMA, _field, _file_sha, _hucs, _ids, _json, _native_geometry,
    _path, _same_crs, assemble, bind_workspace, export_edition,
)

LAYER = "https://gis.des.sc.gov/gisserver/rest/services/water/SCHydroClass/MapServer/2"
SCHEMA = "upstate.freshwater-domain-coverage/v1"


def _encoded(value):
    return (json.dumps(value, ensure_ascii=False, sort_keys=True,
                       separators=(",", ":"), allow_nan=False) + "\n").encode("utf-8")


def _sha(body):
    return hashlib.sha256(body).hexdigest()


def _save(path, body):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists():
        if path.read_bytes() != body:
            raise ValueError("Retained request/source changed: " + str(path))
        return
    pending = path.with_name(path.name + ".pending")
    with pending.open("wb") as target:
        target.write(body)
        target.flush()
    pending.replace(path)


def _copy(source, root, relative):
    body = Path(source).read_bytes()
    _save(root / relative, body)
    return relative


def _csv(rows, columns):
    result = io.StringIO(newline="")
    writer = csv.DictWriter(result, fieldnames=columns, lineterminator="\n")
    writer.writeheader()
    writer.writerows(rows)
    return result.getvalue().encode("utf-8")


def _post(root, stem, params, *, geometry_member=None, offline=False, timeout=60):
    """Request-keyed original POST response cache; incomplete responses never count."""
    payload = urllib.parse.urlencode(params).encode("utf-8")
    public_params = dict(params)
    if geometry_member:
        public_params.pop("geometry")
        public_params["geometry_file"] = geometry_member
    request = {
        "method": "POST", "url": LAYER + "/query",
        "content_type": "application/x-www-form-urlencoded",
        "body_sha256": _sha(payload), "body_bytes": len(payload),
        "parameters": public_params,
    }
    request_path = root / (stem + ".request.json")
    response_path = root / (stem + ".json")
    receipt_path = root / (stem + ".receipt.json")
    _save(request_path, _encoded(request))
    if response_path.exists():
        body = response_path.read_bytes()
        value = _json(response_path)
        if receipt_path.exists():
            receipt = _json(receipt_path)
            if receipt.get("sha256") != _sha(body) or receipt.get("request_sha256") != _sha(_encoded(request)):
                raise ValueError("Cached response/receipt changed: " + stem)
        else:
            # A process may stop after an atomic body write and before receipt write.
            _save(receipt_path, _encoded({"schema": SCHEMA,
                "request_sha256": _sha(_encoded(request)), "sha256": _sha(body),
                "bytes": len(body), "recovered_retained_body": True}))
        if value.get("exceededTransferLimit"):
            raise ValueError("Cached native response is truncated: " + stem)
        return value
    if offline:
        raise FileNotFoundError("Original response not yet captured: " + str(response_path))
    request_object = urllib.request.Request(
        LAYER + "/query", data=payload, method="POST",
        headers={"Content-Type": "application/x-www-form-urlencoded",
                 "User-Agent": "UpperSavannah-source-receiver/1"})
    for attempt in range(3):
        try:
            with urllib.request.urlopen(request_object, timeout=timeout) as response:
                body = response.read()
                status = response.status
                final_url = response.geturl()
            break
        except urllib.error.HTTPError as error:
            if error.code == 429:
                raise RuntimeError("SCDES rate limit; resume this same output after Retry-After=" +
                                   str(error.headers.get("Retry-After", "provider cooldown"))) from error
            if error.code not in (502, 503, 504) or attempt == 2:
                raise
            time.sleep(attempt + 1)
    value = json.loads(body)
    if not isinstance(value, dict) or value.get("error") or value.get("exceededTransferLimit"):
        raise ValueError("Incomplete native source response: " + stem + ": " + repr(value)[:500])
    # Saving only complete, valid responses makes interruption recovery deterministic.
    _save(response_path, body)
    _save(receipt_path, _encoded({
        "schema": SCHEMA, "captured_at": datetime.now(timezone.utc).isoformat(),
        "request_sha256": _sha(_encoded(request)), "sha256": _sha(body),
        "bytes": len(body), "status": status, "final_url": final_url,
    }))
    return value


def _original_domain(archive_path, root, expected_hucs, huc_field=None):
    with zipfile.ZipFile(archive_path) as archive:
        domain_member = _member(archive, "model-domain.esri.json.gz")
        bindings_member = _member(archive, "feature-bindings.json")
        domain_raw = archive.read(domain_member)
        bindings_raw = archive.read(bindings_member)
    domain = json.loads(gzip.decompress(domain_raw))
    bindings = json.loads(bindings_raw)
    selected = _hucs(bindings["selected_huc12"])
    if selected != expected_hucs:
        raise ValueError("Original domain and original publisher selection have different HUC12 sets")
    features = domain.get("features")
    if not isinstance(features, list) or not features:
        raise ValueError("Original model domain has no features")
    spatial_reference = domain.get("spatialReference")
    native_features, seen_hucs = [], set()
    for index, feature in enumerate(features):
        attributes = feature.get("attributes", {})
        if huc_field is None:
            candidates = [key for key in attributes if key.casefold() in ("huc12", "huc_12")]
            if len(candidates) != 1:
                raise ValueError("Specify the original domain HUC12 field with --huc-field")
            field = candidates[0]
        else:
            field = huc_field
        huc = attributes.get(field)
        if huc not in selected:
            raise ValueError("Original domain feature is outside retained HUC12 membership")
        geometry = feature.get("geometry")
        if not isinstance(geometry, dict) or not geometry.get("rings") or "curveRings" in geometry:
            raise ValueError("Original domain needs native linear Esri polygon rings")
        sr = geometry.get("spatialReference") or spatial_reference
        if not isinstance(sr, dict) or not (sr.get("wkid") or sr.get("latestWkid") or sr.get("wkt")):
            raise ValueError("Original polygon requires its original spatial reference")
        native = dict(geometry)
        native["spatialReference"] = sr
        member = "domain/polygon-%04d.json" % index
        _save(root / member, _encoded(native))
        native_features.append((index, huc, native, sr, member))
        seen_hucs.add(huc)
    if seen_hucs != selected:
        raise ValueError("Retained polygon features omit selected HUC12s")
    _save(root / "domain/model-domain.esri.json.gz", domain_raw)
    _save(root / "domain/feature-bindings.json", bindings_raw)
    return native_features, {
        "archive_sha256": _file_sha(archive_path),
        "domain_member": domain_member, "domain_sha256": _sha(domain_raw),
        "bindings_member": bindings_member, "bindings_sha256": _sha(bindings_raw),
        "huc_count": len(selected), "feature_count": len(native_features),
    }


def _retain_base(capture_path, root):
    capture_path = Path(capture_path).resolve(strict=True)
    original = _json(capture_path)
    if original.get("schema") != CAPTURE_SCHEMA:
        raise ValueError("Supply the original water-context capture descriptor")
    layers = [item for item in original["layers"] if item.get("kind") == "freshwater"]
    if len(layers) != 1:
        raise ValueError("Select exactly one original freshwater capture")
    layer = layers[0]
    if layer.get("uri", "").rstrip("/") != LAYER:
        raise ValueError("This receiver is scoped to original SCDES SCHydroClass layer 2")
    if layer.get("huc_selection_mode", "publisher") != "publisher" or layer.get("selected_ids"):
        raise ValueError("The reusable base must be the complete original publisher-HUC selection")
    original_root = capture_path.parent
    copied = {}
    def retain(name):
        if name not in copied:
            copied[name] = _copy(_path(original_root, name), root, "retained/" + name)
        return copied[name]
    metadata_name = retain(layer["metadata"])
    metadata = _json(root / metadata_name)
    oid_fields = [row["name"] for row in metadata["fields"] if row.get("type") == "esriFieldTypeOID"]
    if len(oid_fields) != 1:
        raise ValueError("Original metadata must identify exactly one native OID")
    oid = oid_fields[0]
    if metadata.get("geometryType") != "esriGeometryPolyline":
        raise ValueError("Original freshwater source must retain native polylines")
    huc_name = retain(layer["huc_ids"])
    hucs = _hucs(_json(root / huc_name))
    expected = layer.get("expected_huc_count")
    if expected is not None and expected != len(hucs):
        raise ValueError("Original publisher HUC count differs")
    base_ids, queries = set(), []
    for query in layer["queries"]:
        copied_query = dict(query)
        for name in ("count", "ids", "request"):
            if query.get(name):
                copied_query[name] = retain(query[name])
        count = _json(root / copied_query["count"])
        listed = _ids(_json(root / copied_query["ids"]), "Original publisher IDs",
                      expected_count=count.get("count"))
        if count.get("count") != len(listed):
            raise ValueError("Original publisher count and ID response differ")
        base_ids.update(listed)
        queries.append(copied_query)
    pages = [retain(name) for name in layer["pages"]]
    companions = [retain(name) for name in layer.get("companions", [])]
    _save(root / "retained/original-capture.json", capture_path.read_bytes())
    return layer, metadata_name, metadata, oid, huc_name, hucs, base_ids, queries, pages, companions


def _read_features(root, pages, metadata, oid, expected):
    seen, references = {}, []
    native_sr = None
    for member in pages:
        path = root / member
        body = _json(path)
        if body.get("exceededTransferLimit") or not isinstance(body.get("features"), list):
            raise ValueError("Incomplete original geometry page: " + member)
        sr = body.get("spatialReference") or metadata.get("sourceSpatialReference") or metadata.get("extent", {}).get("spatialReference")
        if native_sr is not None and not _same_crs(native_sr, sr):
            raise ValueError("Original pages use different coordinate references")
        native_sr = sr
        current = set()
        for feature in body["features"]:
            identifier = feature.get("attributes", {}).get(oid)
            if type(identifier) is not int or identifier in current or identifier not in expected:
                raise ValueError("Unexpected or duplicate original object ID in " + member)
            current.add(identifier)
            _native_geometry(feature, "esriGeometryPolyline", identifier)
            if identifier in seen and _encoded(seen[identifier]) != _encoded(feature):
                raise ValueError("Native feature changed between original pages: " + str(identifier))
            seen[identifier] = feature
        references.append({"path": member, "sha256": _file_sha(path),
                           "bytes": path.stat().st_size, "features": len(current)})
    if set(seen) != expected:
        raise ValueError("Original pages do not cover their complete native ID inventory")
    return seen, references, native_sr


def _retain_reused_sources(manifests, root, metadata, oid):
    """Reuse complete native FW source manifests, including their original companions."""
    queries, pages, companions, identities = [], [], [], []
    reused_ids = set()
    for manifest_name in manifests:
        manifest_path = Path(manifest_name).resolve(strict=True)
        document = _json(manifest_path)
        if document.get("schema") != "upstate.sources/v1":
            raise ValueError("A reused freshwater source must use upstate.sources/v1")
        manifest_sha = _file_sha(manifest_path)
        prefix = "reused/" + manifest_sha[:20] + "/"
        manifest_member = _copy(manifest_path, root, prefix + "sources.json")
        companions.append(manifest_member)
        retained, json_documents = {}, {}
        def retain(record):
            name = record["path"]
            source_path = _path(manifest_path.parent, name)
            if not record.get("sha256") or _file_sha(source_path) != record["sha256"]:
                raise ValueError("Reused original source differs from its manifest: " + name)
            if record.get("bytes") is not None and source_path.stat().st_size != record["bytes"]:
                raise ValueError("Reused original source length differs: " + name)
            if name not in retained:
                retained[name] = _copy(source_path, root, prefix + name)
                companions.append(retained[name])
                if name.endswith((".json", ".json.gz")):
                    json_documents[name] = _json(source_path)
            return retained[name]
        for entry in document.get("entries", []):
            retain(entry)
            for record in entry.get("companions", []):
                retain(record)
        index_entries = {}
        for name, value in json_documents.items():
            if isinstance(value, dict) and value.get("schema") == "upstate.original-query-index/v1":
                for query in value.get("queries", []):
                    if query.get("path") in retained:
                        index_entries[query["path"]] = (name, query.get("source_url"))
        def query_parameters(name):
            if name not in index_entries:
                raise ValueError("Reused native file needs its original query URL: " + name)
            index_name, uri = index_entries[name]
            parsed = urllib.parse.urlsplit(uri or "")
            if parsed.scheme + "://" + parsed.netloc + parsed.path.rstrip("/") != LAYER + "/query":
                raise ValueError("Reused native query points to another original layer")
            return index_name, urllib.parse.parse_qs(parsed.query)
        matched = 0
        for entry in document.get("entries", []):
            if entry.get("kind") != "vector" or entry.get("uri", "").rstrip("/") != LAYER:
                continue
            declared = entry.get("metadata") or {}
            if declared.get("classification") != "FW" and entry.get("role") != "WATER_CLASSIFICATION_FW":
                continue
            page = json_documents.get(entry["path"])
            if not isinstance(page, dict) or not isinstance(page.get("features"), list):
                raise ValueError("Reused freshwater source needs its original Esri feature response")
            if page.get("exceededTransferLimit"):
                raise ValueError("Reused freshwater geometry is truncated")
            values = [feature.get("attributes", {}).get(oid) for feature in page["features"]]
            if any(type(value) is not int for value in values) or len(set(values)) != len(values):
                raise ValueError("Reused freshwater geometry has invalid or duplicate native IDs")
            expected = set(values)
            index_name, page_parameters = query_parameters(entry["path"])
            where = page_parameters.get("where")
            ids_candidates, count_candidates = [], []
            for name, value in json_documents.items():
                if not isinstance(value, dict) or name not in index_entries:
                    continue
                candidate_uri = urllib.parse.urlsplit(index_entries[name][1] or "")
                if candidate_uri.path.rstrip("/") != urllib.parse.urlsplit(LAYER).path + "/query":
                    continue
                _, parameters = query_parameters(name)
                if parameters.get("where") != where:
                    continue
                if parameters.get("returnIdsOnly") == ["true"] and "objectIds" in value:
                    selected = _ids(value, "Reused native freshwater IDs", expected_count=len(expected))
                    if selected == expected:
                        if value.get("objectIdFieldName", oid).casefold() != oid.casefold():
                            raise ValueError("Reused freshwater source uses another native OID")
                        ids_candidates.append(name)
                if parameters.get("returnCountOnly") == ["true"] and type(value.get("count")) is int:
                    if value["count"] == len(expected):
                        count_candidates.append(name)
            if len(ids_candidates) != 1 or len(count_candidates) != 1:
                raise ValueError("Reused original geometry needs one matching native count and ID response")
            member = retained[entry["path"]]
            # This validates every native point/path and original CRS before reuse.
            _read_features(root, [member], metadata, oid, expected)
            queries.append({"count": retained[count_candidates[0]], "ids": retained[ids_candidates[0]],
                            "request": retained[index_name],
                            "selection": {"method": "Reused original source manifest selection",
                                          "source_id": entry["id"], "source_manifest_sha256": manifest_sha}})
            pages.append(member)
            reused_ids.update(expected)
            identities.append({"source_id": entry["id"], "manifest": manifest_member,
                               "manifest_sha256": manifest_sha, "native_geometry": member,
                               "native_geometry_sha256": entry["sha256"], "native_feature_count": len(expected),
                               "original_scope": declared.get("scope"), "original_vintage": entry.get("vintage")})
            matched += 1
        if not matched:
            raise ValueError("No explicitly declared native freshwater edition is present in " + str(manifest_path))
    return queries, list(dict.fromkeys(pages)), list(dict.fromkeys(companions)), identities, reused_ids


def _complete_coverage(capture_path, domain_archive, output, *, expected_huc_count=217,
                      huc_field=None, batch_size=500, offline=False, timeout=60,
                      edition=None, archive_output=None, workspace=None, reuse_sources=None):
    root = Path(output).absolute()
    root.mkdir(parents=True, exist_ok=True)
    (base_layer, metadata_member, metadata, oid, huc_member, hucs,
     publisher_ids, queries, pages, companions) = _retain_base(capture_path, root)
    if len(hucs) != expected_huc_count:
        raise ValueError("Requested model-domain HUC count differs")
    if type(batch_size) is not int or not 1 <= batch_size <= min(2000, metadata.get("maxRecordCount", 2000)):
        raise ValueError("Batch size must fit the original layer record limit")
    features, base_page_records, native_sr = _read_features(root, pages, metadata, oid, publisher_ids)
    reuse_queries, reuse_pages, reuse_companions, reuse_identities, reuse_ids = _retain_reused_sources(
        list(reuse_sources or []), root, metadata, oid)
    reuse_records = []
    if reuse_pages:
        reuse_features, reuse_records, reuse_sr = _read_features(root, reuse_pages, metadata, oid, reuse_ids)
        if not _same_crs(native_sr, reuse_sr):
            raise ValueError("Reused freshwater originals use a different coordinate reference")
        for identifier, feature in reuse_features.items():
            if identifier in features and _encoded(features[identifier]) != _encoded(feature):
                raise ValueError("Reused native feature conflicts with the original publisher capture: " + str(identifier))
            features[identifier] = feature
    reuse_key = _sha(_encoded(reuse_identities))[:16] if reuse_identities else None
    polygons, domain_identity = _original_domain(Path(domain_archive), root, hucs, huc_field)
    counts_by_huc, physical_by_huc = defaultdict(int), defaultdict(set)
    polygon_records, geometric_queries = [], []
    for index, huc, geometry, sr, geometry_member in polygons:
        stem = "queries/domain-%04d-%s" % (index, huc)
        common = {
            "f": "json", "where": "H2OCLASS='FW'",
            "geometry": json.dumps(geometry, ensure_ascii=False, separators=(",", ":"), allow_nan=False),
            "geometryType": "esriGeometryPolygon",
            "inSR": json.dumps(sr, separators=(",", ":")),
            "spatialRel": "esriSpatialRelIntersects",
        }
        ids_body = _post(root, stem + "-ids", {**common, "returnIdsOnly": "true"},
                         geometry_member=geometry_member, offline=offline, timeout=timeout)
        count_body = _post(root, stem + "-count", {**common, "returnCountOnly": "true"},
                           geometry_member=geometry_member, offline=offline, timeout=timeout)
        identifiers = _ids(ids_body, "Original physical-domain query",
                           expected_count=count_body.get("count"))
        if type(count_body.get("count")) is not int or count_body["count"] != len(identifiers):
            raise ValueError("Physical-domain count and IDs differ at polygon " + str(index) +
                             "; retain this changed source edition and use a new output for a fresh capture")
        if ids_body.get("objectIdFieldName", oid).casefold() != oid.casefold():
            raise ValueError("Physical-domain response uses a different native OID")
        physical_by_huc[huc].update(identifiers)
        counts_by_huc[huc] += 1
        record = {"polygon_index": index, "huc12": huc, "native_count": len(identifiers),
                  "geometry": geometry_member, "ids": stem + "-ids.json",
                  "count": stem + "-count.json", "request": stem + "-ids.request.json"}
        polygon_records.append(record)
        geometric_queries.append({"ids": record["ids"], "count": record["count"],
            "request": record["request"], "selection": {
                "huc12": huc, "method": "Original polygon intersects", "geometry": geometry_member}})
    physical_ids = set().union(*physical_by_huc.values())
    missing_ids = physical_ids - publisher_ids
    native_huc_field = _field(metadata["fields"], "HUC_12")
    native_class_field = _field(metadata["fields"], "H2OCLASS")
    download_ids = physical_ids - set(features)
    added_pages = []
    for index, start in enumerate(range(0, len(download_ids), batch_size)):
        requested = sorted(download_ids)[start:start + batch_size]
        stem = ("additional/reuse-" + reuse_key + "-page-%04d" if reuse_key else "additional/page-%04d") % index
        body = _post(root, stem, {
            "f": "json", "objectIds": ",".join(map(str, requested)), "outFields": "*",
            "returnGeometry": "true", "returnZ": "true", "returnM": "true",
            "returnTrueCurves": "false",
        }, offline=offline, timeout=timeout)
        returned = [row.get("attributes", {}).get(oid) for row in body.get("features", [])]
        if len(returned) != len(set(returned)) or set(returned) != set(requested):
            raise ValueError("Additional native geometry differs from the exact requested IDs")
        added_pages.append(stem + ".json")
    all_pages = pages + reuse_pages + added_pages
    all_page_records = list(base_page_records) + reuse_records
    if added_pages:
        added_features, added_records, added_sr = _read_features(
            root, added_pages, metadata, oid, download_ids)
        if not _same_crs(native_sr, added_sr):
            raise ValueError("Additional original pages use a different coordinate reference")
        features.update(added_features)
        all_page_records.extend(added_records)
    if any(feature["attributes"].get(native_class_field) != "FW" for feature in features.values()):
        raise ValueError("Original source changed freshwater class during capture")
    publisher_only = publisher_ids - physical_ids
    overlap = publisher_ids & physical_ids
    relations = []
    for huc in sorted(physical_by_huc):
        for identifier in sorted(physical_by_huc[huc]):
            published_huc = features[identifier]["attributes"].get(native_huc_field)
            relations.append({
                "native_object_id": identifier, "model_huc12": huc,
                "publisher_huc12": published_huc, "same_huc_label": published_huc == huc,
                "publisher_in_model_domain": published_huc in hucs,
                "in_original_publisher_selection": identifier in publisher_ids,
                "selection_method": "Original polygon intersects; boundary contact included",
            })
    per_huc = [{
        "huc12": huc, "original_polygon_count": counts_by_huc[huc],
        "physical_native_count": len(physical_by_huc[huc]),
        "shared_with_publisher_selection": len(physical_by_huc[huc] & publisher_ids),
        "new_native_count": len(physical_by_huc[huc] - publisher_ids),
        "different_publisher_huc_count": sum(
            features[identifier]["attributes"].get(native_huc_field) != huc
            for identifier in physical_by_huc[huc]),
    } for huc in sorted(hucs)]
    fields = ["native_object_id", "model_huc12", "publisher_huc12", "same_huc_label",
              "publisher_in_model_domain", "in_original_publisher_selection", "selection_method"]
    _save(root / "comparison/native-object-huc-relationships.csv", _csv(relations, fields))
    _save(root / "comparison/per-huc-coverage.csv", _csv(per_huc, list(per_huc[0])))
    cohorts = {"publisher_huc_selection": sorted(publisher_ids),
               "physical_domain_selection": sorted(physical_ids),
               "both": sorted(overlap), "physical_only": sorted(missing_ids),
               "publisher_only": sorted(publisher_only)}
    _save(root / "comparison/cohorts.json", _encoded(cohorts))
    _save(root / "comparison/physical-selected-ids.json", _encoded(
        {"objectIdFieldName": oid, "objectIds": sorted(physical_ids)}))
    acquisition_times = []
    recovered_receipts = []
    for folder in ("queries", "additional"):
        for receipt_file in sorted((root / folder).glob("*.receipt.json")):
            receipt = _json(receipt_file)
            value = receipt.get("captured_at")
            if value is None:
                recovered_receipts.append(receipt_file.relative_to(root).as_posix())
            else:
                parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
                if parsed.tzinfo is None:
                    raise ValueError("Original capture timestamp needs its UTC offset")
                acquisition_times.append(parsed.astimezone(timezone.utc))
    captured_at = max(acquisition_times).isoformat() if acquisition_times else None
    capture_time_status = ("observed_query_receipts" if acquisition_times
                           else "unavailable_after_response_recovery")
    representation = {
        "source": "Original provider-returned linear Esri paths",
        "original_pages": "Existing original linear paths retained byte-for-byte; their original request parameters remain in retained-file-index.json",
        "additional_pages": "returnTrueCurves=false explicitly requests provider-densified paths when source features contain curves",
        "client_geometry_changes": "None; the existing intake supports linear paths, not curvePaths",
        "selection": "Original count/ID intersections operate on publisher geometry; returned path representation does not determine native membership",
        "documentation": "https://developers.arcgis.com/rest/services-reference/enterprise/query-map-service-layer/",
    }
    comparison = {
        "schema": SCHEMA, "source_uri": LAYER, "native_id_field": oid,
        "publisher_huc_field": native_huc_field, "native_spatial_reference": native_sr,
        "domain": domain_identity, "polygon_queries": polygon_records,
        "cohort_counts": {key: len(value) for key, value in cohorts.items()},
        "many_huc_relationship_count": len(relations),
        "many_huc_relationships": "native-object-huc-relationships.csv",
        "per_huc": per_huc, "original_pages": all_page_records,
        "new_geometry_pages": len(added_pages),
        "method": "Union of original SCDES esriSpatialRelIntersects native-ID queries against every original retained HUC polygon, with publisher HUC labels preserved independently",
        "boundary_rule": "Intersection includes boundary-only contact. Entire original selected flowline geometry is retained; no clipping or analytical length is implied.",
        "base_capture_sha256": _file_sha(capture_path),
        "geometry_representation": representation,
        "captured_at": captured_at, "capture_time_status": capture_time_status,
        "receipts_without_capture_timestamp": recovered_receipts,
    }
    comparison_member = ("comparison/coverage-reuse-" + reuse_key + ".json"
                         if reuse_key else "comparison/coverage.json")
    if reuse_identities:
        comparison["reused_original_sources"] = reuse_identities
        comparison["physical_features_reused_from_supplements"] = len(physical_ids & reuse_ids)
        comparison["additional_native_features_downloaded"] = len(download_ids)
    _save(root / comparison_member, _encoded(comparison))
    all_companions = companions + reuse_companions + [
        "retained/original-capture.json", "domain/feature-bindings.json",
        comparison_member, "comparison/cohorts.json",
        "comparison/native-object-huc-relationships.csv", "comparison/per-huc-coverage.csv",
    ]
    all_companions += [member.relative_to(root).as_posix() for folder in ("queries", "additional", "domain")
                      for member in sorted((root / folder).glob("*.json"))]
    domain_body = json.loads(gzip.decompress((root / "domain/model-domain.esri.json.gz").read_bytes()))
    native_huc_fields = [name for name in domain_body["features"][0]["attributes"]
                         if name.casefold() in ("huc12", "huc_12")]
    coverage_huc_field = huc_field or (native_huc_fields[0] if len(native_huc_fields) == 1 else None)
    if not coverage_huc_field:
        raise ValueError("Choose the exact original domain HUC12 field for parcel coverage")
    physical_layer = {
        "kind": "freshwater", "source_id": "sc-hydroclass-fw-physical-domain",
        "uri": LAYER, "metadata": metadata_member, "queries": queries + reuse_queries + geometric_queries,
        "pages": all_pages, "huc_ids": huc_member, "expected_huc_count": len(hucs),
        "huc_selection_mode": "geometry",
        "selected_ids": "comparison/physical-selected-ids.json",
        "selection_geometry": "domain/model-domain.esri.json.gz",
        "selection_method": comparison["method"],
        "criteria_coverage": {
            "method": "provider_intersects_each_original_domain_polygon",
            "huc12_field": coverage_huc_field,
            "uri": "https://hydro.nationalmap.gov/arcgis/rest/services/wbd/MapServer/6",
            "vintage": "Original retained 217-HUC model-domain polygon edition",
        },
        "companions": sorted(set(all_companions)),
        "scope": {"selection_basis": "Original physical model-domain intersection",
                  "domain": domain_identity, "cohort_counts": comparison["cohort_counts"],
                  "geometry_representation": representation},
    }
    descriptor = {
        "schema": CAPTURE_SCHEMA, "operation_id": "ECO-GEO-0D0F-FW-PHYSICAL-DOMAIN",
        "title": "Upper Savannah original freshwater physical-domain coverage",
        "captured_at": captured_at, "capture_time_status": capture_time_status,
        "layers": [physical_layer], "complete_geometry": True,
    }
    # An earlier completed source may retain capture.json without the parcel binding.
    # Publish an additive descriptor while reusing every original query/geometry byte.
    descriptor_path = root / ("capture-criteria-reuse-" + reuse_key + ".json" if reuse_key else "capture-criteria.json")
    _save(descriptor_path, _encoded(descriptor))
    result = {"capture": str(descriptor_path),
              "comparison": str(root / comparison_member),
              "cohort_counts": comparison["cohort_counts"],
              "new_geometry_pages": len(added_pages)}
    if edition:
        result["edition"] = assemble(descriptor_path, Path(edition))
        if archive_output:
            result["archive"] = export_edition(Path(edition), Path(archive_output))
        if workspace:
            from model.workspace import Workspace
            result["bindings"] = bind_workspace(Workspace(Path(workspace)), Path(edition))
    elif archive_output or workspace:
        raise ValueError("--archive-output/--workspace requires --edition")
    return result


def complete_coverage(capture_path, domain_archive, output, **options):
    # One worker per source directory; interruption releases the native lock.
    import fcntl
    root = Path(output).absolute()
    root.mkdir(parents=True, exist_ok=True)
    with (root / ".freshwater-coverage.lock").open("a+b") as lock:
        try:
            fcntl.flock(lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as error:
            raise RuntimeError("This original freshwater capture already has an active worker") from error
        return _complete_coverage(capture_path, domain_archive, root, **options)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--capture", required=True)
    parser.add_argument("--domain-archive", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--expected-huc-count", type=int, default=217)
    parser.add_argument("--huc-field")
    parser.add_argument("--batch-size", type=int, default=500)
    parser.add_argument("--offline", action="store_true")
    parser.add_argument("--timeout", type=int, default=60)
    parser.add_argument("--edition")
    parser.add_argument("--archive-output")
    parser.add_argument("--workspace")
    parser.add_argument("--reuse-source", action="append", default=[],
                        help="Original upstate.sources/v1 freshwater supplement; repeat for additional retained sources")
    args = parser.parse_args(argv)
    print(json.dumps(complete_coverage(
        args.capture, args.domain_archive, args.output,
        expected_huc_count=args.expected_huc_count, huc_field=args.huc_field,
        batch_size=args.batch_size, offline=args.offline, timeout=args.timeout,
        edition=args.edition, archive_output=args.archive_output, workspace=args.workspace,
        reuse_sources=args.reuse_source,
    ), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
