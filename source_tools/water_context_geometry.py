"""Select original stream features against the retained Upper Savannah domain."""
from __future__ import annotations

import argparse
import gzip
import hashlib
import json
from pathlib import Path
import zipfile


def _sha(body):
    return hashlib.sha256(body).hexdigest()


def _json(body):
    if body.startswith(b"\x1f\x8b"):
        body = gzip.decompress(body)
    value = json.loads(body)
    if isinstance(value, dict) and value.get("error"):
        raise ValueError("Original provider response contains an error: " + str(value["error"]))
    return value


def _encoded(value):
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2, allow_nan=False) + "\n").encode()


def _write(path, body):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists():
        if path.read_bytes() != body:
            raise ValueError("Existing source selection differs: " + str(path))
    else:
        path.write_bytes(body)


def _member(archive, suffix, explicit=None):
    if explicit:
        if explicit not in archive.namelist():
            raise ValueError("Original archive member is absent: " + explicit)
        return explicit
    found = [name for name in archive.namelist() if name == suffix or name.endswith("/" + suffix)]
    if len(found) != 1:
        raise ValueError("Select the exact original archive member for " + suffix)
    return found[0]


def _crs(value):
    if not isinstance(value, dict):
        raise ValueError("Original geometry needs a spatialReference")
    code = value.get("latestWkid") or value.get("wkid")
    if code is not None:
        code = int(code)
        return ("wkid", 3857 if code in (102100, 102113) else code)
    if value.get("wkt2") or value.get("wkt"):
        return ("wkt", value.get("wkt2") or value["wkt"])
    raise ValueError("Original geometry needs its original WKID or WKT")


def _esri_polygon(geometry, corrections, identity):
    """Use the existing acquisition parser's retained ring assembly semantics.

    source/capture_upstream_network.py:esri_polygon, public application commit
    ac228f779116925302469b1961d455c10f7d7e16. Originals remain unchanged.
    """
    from shapely.geometry import Polygon, GeometryCollection
    from shapely import make_valid, is_valid_reason
    if not geometry or "curveRings" in geometry or "rings" not in geometry:
        raise ValueError("Original domain requires linear rings: " + identity)
    combined = GeometryCollection()
    for ring in geometry["rings"]:
        polygon = Polygon([point[:2] for point in ring])
        if not polygon.is_valid:
            corrections.append({"identity": identity, "stage": "ring",
                "reason": is_valid_reason(polygon), "analysis_operation": "Shapely make_valid"})
            polygon = make_valid(polygon)
        combined = combined.symmetric_difference(polygon)
    if not combined.is_valid:
        corrections.append({"identity": identity, "stage": "assembled",
            "reason": is_valid_reason(combined), "analysis_operation": "Shapely make_valid"})
        combined = make_valid(combined)
    return combined


def select_domain_objects(domain_archive, pages, output, *, metadata=None,
                          domain_member=None, bindings_member=None, object_id_field="OBJECTID",
                          expected_huc_count=217, capture_root=None):
    """Return native original IDs whose unchanged flowline geometry intersects the domain."""
    from shapely.geometry import LineString, MultiLineString
    from shapely.ops import unary_union, transform
    from shapely.prepared import prep
    import shapely

    domain_archive = Path(domain_archive).resolve(strict=True)
    output = Path(output).absolute()
    capture_root = Path(capture_root).resolve() if capture_root else output.parent.resolve()
    if not output.resolve().is_relative_to(capture_root):
        raise ValueError("Place the domain selection inside its original capture directory")
    with zipfile.ZipFile(domain_archive) as original:
        domain_name = _member(original, "model-domain.esri.json.gz", domain_member)
        bindings_name = _member(original, "feature-bindings.json", bindings_member)
        domain_bytes, bindings_bytes = original.read(domain_name), original.read(bindings_name)
    document, bindings = _json(domain_bytes), _json(bindings_bytes)
    hucs = bindings.get("selected_huc12")
    if not isinstance(hucs, list) or any(not isinstance(huc, str) or len(huc) != 12 or not huc.isascii() or not huc.isdigit() for huc in hucs):
        raise ValueError("Original feature bindings need the selected twelve-digit HUC12 strings")
    if len(set(hucs)) != len(hucs) or len(hucs) != expected_huc_count:
        raise ValueError("Original domain HUC12 membership differs from the selected count")
    original_features = document.get("features")
    if not isinstance(original_features, list) or not original_features:
        raise ValueError("Original domain has no polygon features")
    first_geometry = next((row.get("geometry") for row in original_features if row.get("geometry")), {})
    domain_sr = document.get("spatialReference") or first_geometry.get("spatialReference")
    _crs(domain_sr)
    corrections = []
    geometries = [_esri_polygon(row.get("geometry"), corrections, "domain feature " + str(index))
                  for index, row in enumerate(original_features)]
    domain = unary_union(geometries)
    if domain.is_empty or not domain.is_valid or domain.area <= 0:
        raise ValueError("Original assembled domain must be a valid nonempty polygonal area")

    layer = _json(Path(metadata).read_bytes()) if metadata else {}
    if layer.get("geometryType", "esriGeometryPolyline") != "esriGeometryPolyline":
        raise ValueError("Stream-order selection requires original polyline geometry")
    actual_fields = [row["name"] for row in layer.get("fields", [])
                     if row.get("type") == "esriFieldTypeOID"]
    if actual_fields:
        if len(actual_fields) != 1:
            raise ValueError("Original layer must have one native OID field")
        object_id_field = actual_fields[0]
    source_sr = layer.get("sourceSpatialReference") or layer.get("extent", {}).get("spatialReference")
    prepared, observed_sr = None, None
    seen, selected, source_records = {}, set(), []
    for path in map(Path, pages):
        raw = path.read_bytes()
        value = _json(raw)
        if value.get("exceededTransferLimit") or not isinstance(value.get("features"), list):
            raise ValueError("Retain the complete original feature page: " + str(path))
        page_sr = value.get("spatialReference") or source_sr
        if observed_sr is not None and _crs(page_sr) != _crs(observed_sr):
            raise ValueError("Original stream pages have different coordinate references")
        if observed_sr is None:
            observed_sr = page_sr
            if _crs(page_sr) == _crs(domain_sr):
                native_domain = domain
            else:
                from pyproj import CRS, Transformer
                def resolve(value):
                    kind, identity = _crs(value)
                    if kind == "wkt":
                        return CRS.from_wkt(identity)
                    try:
                        return CRS.from_epsg(identity)
                    except Exception:
                        return CRS.from_authority("ESRI", str(identity))
                converter = Transformer.from_crs(resolve(domain_sr), resolve(page_sr), always_xy=True)
                native_domain = transform(converter.transform, domain)
            prepared = prep(native_domain)
        source_records.append({"path": str(path.resolve()), "sha256": _sha(raw),
                               "bytes": len(raw), "features": len(value["features"])})
        page_ids = set()
        for feature in value["features"]:
            object_id = feature.get("attributes", {}).get(object_id_field)
            if type(object_id) is not int or object_id in page_ids:
                raise ValueError("Original page lacks distinct native object IDs")
            page_ids.add(object_id)
            digest = _sha(_encoded(feature))
            if object_id in seen:
                if seen[object_id] != digest:
                    raise ValueError("Original stream feature changed across pages: " + str(object_id))
                continue
            seen[object_id] = digest
            geometry = feature.get("geometry")
            if not geometry or "curvePaths" in geometry or not geometry.get("paths"):
                raise ValueError("Original flowline requires its retained linear paths: " + str(object_id))
            lines = [LineString([point[:2] for point in points]) for points in geometry["paths"]]
            flowline = lines[0] if len(lines) == 1 else MultiLineString(lines)
            if flowline.is_empty or not flowline.is_valid:
                raise ValueError("Original flowline needs an explicit geometry correction: " + str(object_id))
            if prepared.intersects(flowline):
                selected.add(object_id)

    method = "Original returned flowline geometry intersects the retained original model-domain polygon; complete selected feature geometry retained"
    huc_bytes = json.dumps(hucs, separators=(",", ":")).encode("utf-8")
    selection = {"schema": "upstate.water-context-domain-selection/v1", "method": method,
                 "native_object_id_field": object_id_field,
                 "selection_coordinates": "XY in the actual source CRS; original additional ordinates remain in the source",
                 "provider_candidate_count": len(seen), "selected_count": len(selected),
                 "excluded_count": len(seen) - len(selected), "object_ids": sorted(selected),
                 "domain_archive": {"path": str(domain_archive), "sha256": _sha(domain_archive.read_bytes())},
                 "domain_member": {"path": domain_name, "sha256": _sha(domain_bytes), "bytes": len(domain_bytes)},
                 "feature_bindings": {"path": bindings_name, "sha256": _sha(bindings_bytes), "bytes": len(bindings_bytes)},
                 "domain_huc12_count": len(hucs), "domain_huc12s": hucs, "domain_huc12_sha256": _sha(huc_bytes),
                 "domain_spatial_reference": domain_sr, "flowline_spatial_reference": observed_sr,
                 "domain_bounds": list(domain.bounds), "geometry_operations": corrections,
                 "shapely_version": shapely.__version__, "original_pages": source_records}
    output.mkdir(parents=True, exist_ok=True)
    _write(output / "selected-object-ids.json", _encoded({"objectIds": sorted(selected),
        "objectIdFieldName": object_id_field}))
    _write(output / "model-domain.esri.json.gz", domain_bytes)
    _write(output / "feature-bindings.json", bindings_bytes)
    _write(output / "domain-huc12s.json", huc_bytes)
    _write(output / "selection.json", _encoded(selection))
    def relative(name):
        return (output / name).resolve(strict=True).relative_to(capture_root).as_posix()
    return {"selected_ids": relative("selected-object-ids.json"),
            "selection_geometry": relative("model-domain.esri.json.gz"),
            "selection_method": method,
            "companions": [relative("selection.json"), relative("feature-bindings.json"),
                           relative("domain-huc12s.json")],
            "provider_candidate_count": len(seen), "selected_count": len(selected),
            "excluded_count": len(seen) - len(selected)}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--domain-archive", required=True)
    parser.add_argument("--page", action="append", default=[])
    parser.add_argument("--pages-json", help="JSON array of original feature-page paths")
    parser.add_argument("--metadata")
    parser.add_argument("--output", required=True)
    parser.add_argument("--capture-root", help="Original capture directory; returned member paths are relative to this root")
    parser.add_argument("--domain-member")
    parser.add_argument("--bindings-member")
    parser.add_argument("--object-id-field", default="OBJECTID")
    parser.add_argument("--expected-huc-count", type=int, default=217)
    args = parser.parse_args(argv)
    pages = list(args.page)
    if args.pages_json:
        pages_file = Path(args.pages_json).resolve(strict=True)
        pages += [str(pages_file.parent / path) for path in _json(pages_file.read_bytes())]
    if not pages:
        parser.error("Select original feature pages with --page or --pages-json")
    result = select_domain_objects(args.domain_archive, pages, args.output,
        metadata=args.metadata, domain_member=args.domain_member, bindings_member=args.bindings_member,
        object_id_field=args.object_id_field, expected_huc_count=args.expected_huc_count,
        capture_root=args.capture_root)
    print(json.dumps(result, ensure_ascii=False, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
