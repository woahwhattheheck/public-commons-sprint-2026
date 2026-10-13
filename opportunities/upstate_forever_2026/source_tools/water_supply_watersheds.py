#!/usr/bin/env python3
"""Retain and prepare the original Georgia EPD water-supply watershed GIS.

The published archive describes source-water protection under 391-3-16-.01.
Its native layers remain distinct from designated stream uses under 391-3-6-.03.
No source download or legal reach classification occurs in this receiver.
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import html
import io
import json
import os
from pathlib import Path, PurePosixPath
import re
import stat
import sys
import tempfile
import zipfile

APPLICATION = Path(__file__).resolve().parents[1]
if str(APPLICATION) not in sys.path:
    sys.path.insert(0, str(APPLICATION))


VERSION = "1.0.0"
SCHEMA = "upstate.water-supply-watershed-preparation/v1"
SOURCE_URL = "https://epd.georgia.gov/document/document/water-supply-watershed-maps-savannah-upper-ogeechee-gis/download"
SOURCE_PAGE = "https://epd.georgia.gov/water-supply-watersheds"
ORIGINAL_BYTES = 2453313
REGULATION = "GA-391-3-16-.01"
ROLES = frozenset(("WATER_SUPPLY_WATERSHED", "WATER_SUPPLY_STREAM",
                   "WATER_SUPPLY_BUFFER", "WATER_SUPPLY_SOURCE"))
DOMAIN_ID = "upstate-wbd-upstream-domain-20261012"
MAX_UNCOMPRESSED = 1024 * 1024 * 1024
MAX_MEMBERS = 10000


def file_digest(path):
    checksum = hashlib.sha256()
    with Path(path).open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            checksum.update(block)
    return checksum.hexdigest()


def encode(value):
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2,
                       allow_nan=False) + "\n").encode("utf-8")


def digest(value):
    return hashlib.sha256(encode(value)).hexdigest()


def safe_name(name):
    part = PurePosixPath(name)
    if (not name or part.is_absolute() or str(part) != name or
            any(value in ("", ".", "..") for value in part.parts) or
            "\\" in name or "\0" in name or re.match(r"^[A-Za-z]:", name)):
        raise ValueError("ZIP member needs a portable relative name: " + repr(name))
    return name


def descriptor(root, path):
    path = Path(path)
    return {"path": path.relative_to(root).as_posix(),
            "bytes": path.stat().st_size, "sha256": file_digest(path)}


def verify(root, item):
    path = (root / safe_name(item["path"])).resolve(strict=True)
    if not path.is_relative_to(root.resolve()) or not path.is_file():
        raise ValueError("Retained member leaves its receiving directory")
    if path.stat().st_size != item["bytes"] or file_digest(path) != item["sha256"]:
        raise ValueError("Retained source changed: " + item["path"])
    return path


def copy_original(source, destination, expected_sha256=None):
    """Publish an independent streamed original, preserving existing complete bytes."""
    source = Path(source).resolve(strict=True)
    if not source.is_file():
        raise ValueError("Select an original regular archive file")
    actual = file_digest(source)
    if expected_sha256 and actual != expected_sha256:
        raise ValueError("Original archive SHA256 differs from the selected edition")
    if destination.exists():
        if destination.stat().st_size != source.stat().st_size or file_digest(destination) != actual:
            raise ValueError("Receiving archive differs from the original source")
        return actual
    destination.parent.mkdir(parents=True, exist_ok=True)
    fd, pending_name = tempfile.mkstemp(prefix=".original-", dir=destination.parent)
    pending = Path(pending_name)
    try:
        check = hashlib.sha256()
        with source.open("rb") as incoming, os.fdopen(fd, "wb") as outgoing:
            start = os.fstat(incoming.fileno())
            for block in iter(lambda: incoming.read(1024 * 1024), b""):
                outgoing.write(block)
                check.update(block)
            outgoing.flush()
            os.fsync(outgoing.fileno())
            end = os.fstat(incoming.fileno())
        fields = lambda value: (value.st_dev, value.st_ino, value.st_size,
                                value.st_mtime_ns, value.st_ctime_ns)
        if fields(start) != fields(end) or check.hexdigest() != actual:
            raise ValueError("Original archive changed during capture")
        try:
            os.link(pending, destination)
        except FileExistsError:
            if file_digest(destination) != actual:
                raise ValueError("Concurrent archive publication differs")
        return actual
    finally:
        pending.unlink(missing_ok=True)


def inspect_archive(archive):
    """Inspect all original names and DBF schemas without a GIS installation."""
    archive = Path(archive).resolve(strict=True)
    original = {"filename": archive.name, "bytes": archive.stat().st_size,
                "sha256": file_digest(archive), "uri": SOURCE_URL}
    members = []
    names, folded = set(), set()
    with zipfile.ZipFile(archive) as source:
        if len(source.infolist()) > MAX_MEMBERS:
            raise ValueError("Unexpectedly large original archive member count")
        total = 0
        for info in source.infolist():
            name = info.filename.rstrip("/") if info.is_dir() else info.filename
            safe_name(name)
            if name in names or name.casefold() in folded:
                raise ValueError("Duplicate or case-colliding original ZIP member: " + name)
            names.add(name)
            folded.add(name.casefold())
            mode = (info.external_attr >> 16) & 0xffff
            if stat.S_ISLNK(mode) or (stat.S_IFMT(mode) not in (0, stat.S_IFREG, stat.S_IFDIR)):
                raise ValueError("Original ZIP member is not a regular file/directory")
            if info.flag_bits & 1:
                raise ValueError("Encrypted original ZIP members cannot be inspected")
            total += info.file_size
            if total > MAX_UNCOMPRESSED:
                raise ValueError("Original archive expanded bytes exceed receiver capacity limit")
            if info.is_dir():
                continue
            body = source.read(info)  # ZipFile verifies the original CRC.
            item = {"path": name, "bytes": len(body), "compressed_bytes": info.compress_size,
                    "sha256": hashlib.sha256(body).hexdigest(), "crc32": "%08x" % info.CRC,
                    "compression": info.compress_type}
            if name.lower().endswith(".prj"):
                item["original_wkt"] = body.decode("utf-8-sig").strip()
            if name.lower().endswith(".cpg"):
                item["original_encoding"] = body.decode("ascii").strip()
            if name.lower().endswith(".dbf"):
                item["dbf"] = dbf_inventory(body)
            members.append(item)
    files = {row["path"]: row for row in members}
    layers = []
    for name, item in sorted(files.items()):
        if not name.lower().endswith(".shp"):
            continue
        stem = name[:-4]
        sides = {Path(other).suffix.lower(): other for other in files if other[:-len(Path(other).suffix)] == stem}
        for suffix in (".dbf", ".shx", ".prj"):
            if suffix not in sides:
                raise ValueError("Incomplete original shapefile sidecars: " + name + " lacks " + suffix)
        layers.append({"member": name, "native_layer": PurePosixPath(stem).name,
                       "sidecars": sorted(other for other in files if other == stem or other.startswith(stem + ".")),
                       "original_wkt": files[sides[".prj"]]["original_wkt"],
                       "dbf": files[sides[".dbf"]]["dbf"],
                       "original_encoding": files.get(sides.get(".cpg", ""), {}).get("original_encoding")})
    if not layers:
        raise ValueError("Original EPD ZIP contains no complete shapefile layers")
    if file_digest(archive) != original["sha256"]:
        raise ValueError("Original archive changed during inspection")
    return {"schema": "upstate.water-supply-archive-inventory/v1",
            "producer_version": VERSION, "archive": original,
            "uncompressed_bytes": total, "members": members, "layers": layers}


def dbf_inventory(body):
    if len(body) < 33:
        raise ValueError("Original DBF header is incomplete")
    count = int.from_bytes(body[4:8], "little")
    header = int.from_bytes(body[8:10], "little")
    record = int.from_bytes(body[10:12], "little")
    if header < 33 or header > len(body) or record < 1 or header + count * record > len(body):
        raise ValueError("Original DBF declared records are incomplete")
    fields = []
    position = 32
    offset = 1
    while position < header and body[position] != 13:
        block = body[position:position + 32]
        if len(block) != 32:
            raise ValueError("Original DBF field descriptor is incomplete")
        name = block[:11].split(b"\0", 1)[0].decode("ascii")
        length = block[16]
        fields.append({"name": name, "type": chr(block[11]), "length": length,
                       "decimal_count": block[17], "record_offset": offset})
        offset += length
        position += 32
    if position >= header or body[position] != 13 or offset > record:
        raise ValueError("Original DBF field layout is invalid")
    deleted = sum(body[header + i * record] == 42 for i in range(count))
    return {"declared_record_count": count, "deleted_record_count": deleted,
            "header_bytes": header, "record_bytes": record,
            "language_driver_id": body[29], "fields": fields}


def extract_original(archive, inventory, output):
    from model.common import atomic_bytes
    original_root = output / "original"
    original_root.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(archive) as source:
        for item in inventory["members"]:
            name = safe_name(item["path"])
            target = original_root / name
            if target.exists():
                verify(original_root, item)
                continue
            body = source.read(name)
            if len(body) != item["bytes"] or hashlib.sha256(body).hexdigest() != item["sha256"]:
                raise ValueError("Original ZIP member changed")
            atomic_bytes(target, body, immutable=True)
    return original_root


def json_value(value):
    if isinstance(value, dict):
        return {str(key): json_value(item) for key, item in value.items()}
    if isinstance(value, (tuple, list)):
        return [json_value(item) for item in value]
    if hasattr(value, "isoformat"):
        return value.isoformat()
    if isinstance(value, bytes):
        return {"original_bytes_hex": value.hex()}
    return value


def csv_bytes(rows, fields):
    out = io.StringIO(newline="")
    writer = csv.DictWriter(out, fieldnames=fields, lineterminator="\n")
    writer.writeheader()
    for row in rows:
        writer.writerow({key: json.dumps(row.get(key), ensure_ascii=False, sort_keys=True)
                         if isinstance(row.get(key), (dict, list)) else row.get(key)
                         for key in fields})
    return out.getvalue().encode("utf-8")


def layer_configuration(inventory, selected):
    selected = selected or {}
    if selected.get("archive_sha256") and selected["archive_sha256"] != inventory["archive"]["sha256"]:
        raise ValueError("Layer meanings belong to a different original archive")
    rules = selected.get("layers", {})
    unknown = set(rules) - {row["member"] for row in inventory["layers"]}
    if unknown:
        raise ValueError("Configured layers are absent from the original archive: " + ", ".join(sorted(unknown)))
    result = {}
    for layer in inventory["layers"]:
        rule = dict(rules.get(layer["member"], {}))
        role = rule.get("role", "WATER_SUPPLY_SOURCE")
        if role not in ROLES:
            raise ValueError("Use an explicit source-water protection role")
        result[layer["member"]] = {"role": role, "title": rule.get("title", layer["native_layer"]),
                                  "interpretation": rule.get("interpretation",
                                  "Original EPD publisher layer; retain its native name and attributes."),
                                  "id_field": rule.get("id_field")}
    return result


def native_layers(original_root, inventory, roles, output):
    from model.common import atomic_bytes, atomic_json
    import fiona
    from pyproj import CRS
    from shapely.geometry import shape
    source_entries, layer_rows, attribute_rows = [], [], []
    all_originals = [descriptor(output, original_root / row["path"]) for row in inventory["members"]]
    archive_companion = descriptor(output, output / "original-archive.zip")
    inventory_companion = descriptor(output, output / "archive-inventory.json")
    for layer in inventory["layers"]:
        name = layer["member"]
        meaning = roles[name]
        path = original_root / name
        source_id = "ga-epd-water-supply-" + hashlib.sha256(name.encode("utf-8")).hexdigest()[:20]
        with fiona.open(path) as source:
            crs = CRS.from_user_input(source.crs_wkt or source.crs)
            crs_text = crs.to_string()
            field_names = list(source.schema["properties"])
            if meaning["id_field"] and meaning["id_field"] not in field_names:
                raise ValueError("Declared original identity field is absent: " + name)
            seen, null_geometry, empty_geometry, invalid_geometry = set(), [], [], []
            count = 0
            for feature in source:
                fid = str(feature.id)
                if fid in seen:
                    raise ValueError("Duplicate native Fiona FID in " + name)
                seen.add(fid)
                count += 1
                properties = json_value(dict(feature.properties))
                attribute_rows.append({"source_id": source_id, "native_member": name,
                    "native_fid": fid, "declared_id": properties.get(meaning["id_field"]) if meaning["id_field"] else None,
                    "properties": properties})
                if feature.geometry is None:
                    null_geometry.append(fid)
                else:
                    geometry = shape(feature.geometry)
                    if geometry.is_empty:
                        empty_geometry.append(fid)
                    elif not geometry.is_valid:
                        invalid_geometry.append(fid)
            expected = layer["dbf"]["declared_record_count"] - layer["dbf"]["deleted_record_count"]
            if count != expected:
                raise ValueError("Native feature count differs from original nondeleted DBF records: " + name)
            layer_rows.append({"source_id": source_id, "native_member": name, "title": meaning["title"],
                "role": meaning["role"], "interpretation": meaning["interpretation"],
                "feature_count": count, "native_geometry_type": source.schema["geometry"],
                "native_crs": crs_text, "native_wkt": crs.to_wkt(),
                "native_fields": dict(source.schema["properties"]),
                "extent": list(source.bounds), "null_geometry_fids": null_geometry,
                "empty_geometry_fids": empty_geometry, "invalid_geometry_fids": invalid_geometry})
        main = descriptor(output, path)
        source_entries.append({"id": source_id, "title": meaning["title"], "kind": "vector",
            "role": meaning["role"], "path": main["path"], "bytes": main["bytes"], "sha256": main["sha256"],
            "source_format": "ESRI Shapefile", "source_crs": crs_text, "uri": SOURCE_URL,
            "vintage": "Original Georgia EPD published water-supply GIS captured 2026-10-13",
            "metadata": {"jurisdiction": "GA", "regulation": REGULATION,
                "source_role": "source-water protection geography", "native_member": name,
                "native_fid_basis": "Original shapefile record/Fiona FID, retained within the named layer",
                "declared_id_field": meaning["id_field"], "feature_count": count,
                "interpretation": meaning["interpretation"], "edition_status": "source-published",
                "archive_sha256": inventory["archive"]["sha256"],
                "native_attributes": "native-attributes.json"},
            "companions": [archive_companion, inventory_companion,
                           *[item for item in all_originals if item["path"] != main["path"]]]})
    atomic_json(output / "native-attributes.json", attribute_rows, immutable=True)
    atomic_bytes(output / "native-attributes.csv", csv_bytes(attribute_rows,
                 ["source_id", "native_member", "native_fid", "declared_id", "properties"]), immutable=True)
    atomic_json(output / "native-layer-inventory.json", layer_rows, immutable=True)
    extra = [descriptor(output, output / name) for name in
             ("native-attributes.json", "native-attributes.csv", "native-layer-inventory.json", "request.json")]
    for entry in source_entries:
        entry["companions"].extend(extra)
    return source_entries, layer_rows


def domain_geometry(workspace, collection_id, source_id, expected_count):
    from model.monitoring_sources import read_source, verify_retained_binding
    from source_tools.prepare_regional_monitoring import select_collection, retain_collection
    from shapely.geometry import shape
    from shapely.ops import transform, unary_union
    from pyproj import Transformer
    collection = select_collection(workspace, [source_id], collection_id=collection_id)
    view, binding = read_source(workspace, source_id, collection_id=collection["id"])
    verify_retained_binding(workspace, binding)
    if expected_count is not None and len(view["features"]) != expected_count:
        raise ValueError("Original domain count differs from the explicitly selected cohort")
    projected = []
    transformer = Transformer.from_crs("EPSG:4326", "EPSG:5070", always_xy=True)
    for feature in view["features"]:
        geometry = shape(feature["geometry"])
        if geometry.geom_type not in ("Polygon", "MultiPolygon") or geometry.is_empty or not geometry.is_valid:
            raise ValueError("Original domain requires complete valid polygon geometry")
        projected.append(transform(transformer.transform, geometry))
    union = unary_union(projected)
    return union, collection, binding, retain_collection


def spatial_summary(original_root, inventory, layer_rows, output, workspace,
                    collection_id, source_id, expected_count):
    from model.common import atomic_bytes, atomic_json
    import fiona
    from pyproj import CRS, Transformer
    from shapely.geometry import shape, mapping
    from shapely.ops import transform
    domain, collection, binding, retain_collection = domain_geometry(
        workspace, collection_id, source_id, expected_count)
    companions, source_edition = retain_collection(workspace, collection, output, "domain-originals")
    rows, features, skipped = [], [], []
    for layer in layer_rows:
        transformer = Transformer.from_crs(CRS.from_user_input(layer["native_wkt"]),
                                           "EPSG:5070", always_xy=True)
        with fiona.open(original_root / layer["native_member"]) as source:
            for feature in source:
                fid = str(feature.id)
                if feature.geometry is None:
                    skipped.append({"source_id": layer["source_id"], "native_fid": fid, "reason": "null_geometry"})
                    continue
                original = shape(feature.geometry)
                if original.is_empty or not original.is_valid:
                    skipped.append({"source_id": layer["source_id"], "native_fid": fid,
                                    "reason": "empty_geometry" if original.is_empty else "invalid_original_geometry"})
                    continue
                geometry = transform(transformer.transform, original)
                if not geometry.is_valid:
                    skipped.append({"source_id": layer["source_id"], "native_fid": fid,
                                    "reason": "invalid_projected_geometry"})
                    continue
                if not geometry.intersects(domain):
                    continue
                inside = geometry.intersection(domain)
                kind = geometry.geom_type
                is_area = kind in ("Polygon", "MultiPolygon")
                is_line = kind in ("LineString", "MultiLineString")
                dimension = "area" if is_area else "length" if is_line else "point"
                original_measure = geometry.area if is_area else geometry.length if is_line else None
                inside_measure = inside.area if is_area else inside.length if is_line else None
                record = {"source_id": layer["source_id"], "native_member": layer["native_member"],
                    "native_fid": fid, "role": layer["role"], "measure_kind": dimension,
                    "source_geometry_type": kind, "intersection_geometry_type": inside.geom_type,
                    "analysis_crs": "EPSG:5070", "measure_units": "m2" if is_area else "m" if is_line else None,
                    "whole_source_measure": original_measure, "domain_intersection_measure": inside_measure,
                    "fraction_of_source_in_domain": inside_measure / original_measure if original_measure else None,
                    "touch_only": bool(inside_measure == 0) if inside_measure is not None else False,
                    "source_properties": json_value(dict(feature.properties))}
                rows.append(record)
                features.append({"type": "Feature", "id": layer["source_id"] + ":" + fid,
                                 "properties": record, "geometry": mapping(inside)})
    summary = {"schema": "upstate.water-supply-domain-intersection/v1", "producer_version": VERSION,
        "regulation": REGULATION, "analysis_crs": "EPSG:5070",
        "domain_binding": binding, "domain_source_edition": source_edition,
        "domain_union_area_m2": domain.area, "selected_feature_count": len(rows),
        "skipped_originals": skipped, "rows": rows,
        "interpretation": [
            "Whole original source features and all attributes remain unchanged in their original shapefiles.",
            "Intersection geometry is a derived study view, not a redrawn statutory boundary.",
            "Layer totals may overlap or nest. Do not add watershed, buffer and stream areas together.",
            "Original null or invalid geometries remain in the source edition and are explicitly excluded from intersection.",
            "These are public source-water protection layers under 391-3-16-.01, not designated stream classes under 391-3-6-.03.",
            "GIS dimensions describe retained published geometry and do not establish site-specific regulatory setbacks."]}
    atomic_json(output / "domain-intersection.json", summary, immutable=True)
    atomic_json(output / "domain-intersection.geojson", {"type": "FeatureCollection",
        "name": "Original EPD water-supply features intersecting the selected study",
        "crs": {"type": "name", "properties": {"name": "EPSG:5070"}}, "features": features}, immutable=True)
    fields = ["source_id", "native_member", "native_fid", "role", "measure_kind", "analysis_crs",
              "measure_units", "whole_source_measure", "domain_intersection_measure",
              "fraction_of_source_in_domain", "touch_only", "source_properties"]
    atomic_bytes(output / "domain-intersection.csv", csv_bytes(rows, fields), immutable=True)
    return summary, companions


def report_html(layer_rows, spatial):
    esc = lambda value: html.escape(str(value if value is not None else ""))
    layer_table = "".join("<tr>" + "".join("<td>" + esc(value) + "</td>" for value in
        (row["title"], row["native_member"], row["role"], row["feature_count"],
         row["native_geometry_type"], row["native_crs"],
         len(row["invalid_geometry_fids"]) + len(row["null_geometry_fids"]) + len(row["empty_geometry_fids"]))) + "</tr>"
        for row in layer_rows)
    geography = ("<h2>Selected study intersection</h2><p>" + esc(spatial["selected_feature_count"]) +
        " original features intersect the selected domain. " + esc(len(spatial["skipped_originals"])) +
        " original features have an explicit excluded geometry condition.</p><p>Measures use EPSG:5070. "
        "Watersheds and buffers can overlap; separate layer and measurement units are retained in the CSV.</p>"
        '<p><a href="domain-intersection.csv" download>Complete study intersection CSV</a> · '
        '<a href="domain-intersection.geojson" download>Derived intersection geometry</a> · '
        '<a href="domain-intersection.json" download>Full source bindings and interpretation</a></p>'
        if spatial else "<p>The complete source edition is prepared. A study intersection has not been selected.</p>")
    return ('<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
        '<title>Georgia EPD water-supply watershed source</title><style>body{font:16px/1.5 system-ui,sans-serif;color:#202020;'
        'max-width:1180px;margin:32px auto;padding:0 20px}h1{font-size:28px}table{border-collapse:collapse;width:100%}'
        'th,td{border:1px solid #aaa;text-align:left;vertical-align:top;padding:8px}th{background:#eee}'
        '.table{overflow:auto}a{color:#202020}@media print{body{margin:0;max-width:none;font-size:10pt}th{background:#eee}'
        'tr{break-inside:avoid}a{overflow-wrap:anywhere}}</style><h1>Georgia EPD water-supply watershed source</h1>'
        '<p>Original published Savannah–Upper Ogeechee GIS, captured 13 October 2026.</p>'
        '<p>The publisher describes drainage areas upstream of governmentally owned public drinking-water intakes '
        'under Georgia Rules 391-3-16-.01. These source-water protection layers remain distinct from designated '
        'stream uses and trout clauses under 391-3-6-.03.</p>'
        '<p><a href="' + SOURCE_PAGE + '">Agency source page</a> · '
        '<a href="original-archive.zip" download>Complete original GIS ZIP</a> · '
        '<a href="native-attributes.csv" download>All original native attribute rows</a> · '
        '<a href="native-layer-inventory.json" download>Complete layer and CRS inventory</a></p>'
        '<div class="table"><table><thead><tr><th>Publisher layer</th><th>Original member</th><th>Declared role</th>'
        '<th>Features</th><th>Geometry</th><th>Native CRS</th><th>Geometry conditions</th></tr></thead><tbody>' +
        layer_table + '</tbody></table></div>' + geography +
        '<h2>How to use this source</h2><p>Open the original ZIP or imported vector source to inspect every native '
        'feature and sidecar. Use the study intersection to identify source-water protection context for the selected '
        'watersheds. Retain the layer role and original attributes when preparing a parcel or utility briefing. '
        'Site-specific regulatory interpretation still depends on the applicable rule, intake and stream conditions.</p></html>')


def prepare(archive, output, *, expected_sha256=None, expected_bytes=ORIGINAL_BYTES,
            layer_config=None, workspace=None, domain_collection=None, domain_source=None,
            expected_domain_count=217):
    from model.common import atomic_bytes, atomic_json, held, read_json
    if expected_domain_count is not None and (isinstance(expected_domain_count, bool) or expected_domain_count < 1):
        raise ValueError("Select a positive original domain feature count")
    output = Path(output).resolve()
    archive = Path(archive).resolve(strict=True)
    if workspace and (output == workspace.root.resolve() or output.is_relative_to(workspace.root.resolve())):
        raise ValueError("Choose a receiving directory outside the existing scientific Workspace")
    if expected_bytes is not None and archive.stat().st_size != expected_bytes:
        raise ValueError("Original archive byte count differs from the explicit selected edition")
    output.mkdir(parents=True, exist_ok=True)
    with held(output / ".water-supply.lock", blocking=False):
        original = output / "original-archive.zip"
        archive_sha = copy_original(archive, original, expected_sha256)
        inventory = inspect_archive(original)
        roles = layer_configuration(inventory, layer_config)
        request = {"schema": SCHEMA, "producer_version": VERSION, "archive_sha256": archive_sha,
            "archive_bytes": inventory["archive"]["bytes"], "source_url": SOURCE_URL,
            "captured_at": "2026-10-13", "roles": roles,
            "workspace_project_id": workspace.project["id"] if workspace else None,
            "domain_collection_id": domain_collection, "domain_source_id": domain_source,
            "expected_domain_count": expected_domain_count if domain_source else None}
        if domain_source and not workspace:
            raise ValueError("Domain selection needs its existing scientific Workspace")
        if domain_source and not domain_collection:
            from source_tools.prepare_regional_monitoring import select_collection
            request["domain_collection_id"] = select_collection(workspace, [domain_source])["id"]
        atomic_json(output / "request.json", request, immutable=True)
        receipt_path = output / "preparation.json"
        if receipt_path.exists():
            receipt = read_json(receipt_path)
            if receipt["request_sha256"] != digest(request):
                raise ValueError("Receiving directory belongs to a different source/domain selection")
            for item in receipt["artifacts"]:
                verify(output, item)
            if workspace:
                collection = workspace.import_sources(output / "sources.json")
                return {**receipt, "collection_id": collection["id"]}
            return receipt
        atomic_json(output / "archive-inventory.json", inventory, immutable=True)
        original_root = extract_original(original, inventory, output)
        entries, layers = native_layers(original_root, inventory, roles, output)
        spatial, domain_companions = (None, [])
        if domain_source:
            spatial, domain_companions = spatial_summary(original_root, inventory, layers, output,
                workspace, request["domain_collection_id"], domain_source, expected_domain_count)
        atomic_bytes(output / "report.html", report_html(layers, spatial).encode("utf-8"), immutable=True)
        original_extra = [descriptor(output, output / "report.html")]
        for entry in entries:
            entry["companions"].extend(original_extra)
        if spatial:
            document = descriptor(output, output / "domain-intersection.json")
            entries.append({"id": "ga-epd-water-supply-domain-" + digest(request)[:20],
                "title": "Georgia EPD source-water protection — selected study intersection",
                "kind": "vector", "role": "WATER_SUPPLY_STUDY_INTERSECTION",
                **descriptor(output, output / "domain-intersection.geojson"),
                "source_crs": "EPSG:5070", "source_format": "GeoJSON",
                "uri": "urn:upstate:water-supply-domain:" + digest(request),
                "vintage": "Derived from the complete original EPD archive and selected retained domain",
                "metadata": {"regulation": REGULATION, "derived_geometry": True,
                    "domain_binding": spatial["domain_binding"], "feature_count": spatial["selected_feature_count"]},
                "companions": [document, descriptor(output, output / "domain-intersection.csv"),
                    *domain_companions, descriptor(output, original),
                    descriptor(output, output / "archive-inventory.json"),
                    descriptor(output, output / "native-layer-inventory.json"),
                    descriptor(output, output / "native-attributes.json"),
                    descriptor(output, output / "native-attributes.csv"),
                    descriptor(output, output / "request.json"), *original_extra]})
        manifest = {"schema": "upstate.sources/v1",
            "title": "Georgia EPD Savannah–Upper Ogeechee water-supply watershed original edition",
            "captured_at": "2026-10-13", "scope": {"jurisdiction": "GA", "regulation": REGULATION,
                "archive_sha256": archive_sha, "native_layer_count": len(layers),
                "native_feature_count": sum(row["feature_count"] for row in layers),
                "study_domain_selected": spatial is not None},
            "notes": ["Original source-water protection geography is separate from classified water reaches.",
                      "Native layer features may overlap or nest; counts and measures remain separated by layer.",
                      "Complete original archive and all original sidecars are retained."], "entries": entries}
        atomic_json(output / "sources.json", manifest, immutable=True)
        artifacts = [descriptor(output, path) for path in sorted(output.rglob("*"))
                     if path.is_file() and path.name not in (".water-supply.lock", "preparation.json")]
        receipt = {"schema": SCHEMA, "producer_version": VERSION, "request_sha256": digest(request),
            "source_url": SOURCE_URL, "archive": descriptor(output, original),
            "manifest": "sources.json", "report": "report.html", "layers": layers,
            "native_layer_count": len(layers), "native_feature_count": sum(row["feature_count"] for row in layers),
            "domain": spatial["domain_binding"] if spatial else None,
            "selected_feature_count": spatial["selected_feature_count"] if spatial else None,
            "artifacts": artifacts}
        atomic_json(receipt_path, receipt, immutable=True)
        if workspace:
            collection = workspace.import_sources(output / "sources.json")
            return {**receipt, "collection_id": collection["id"]}
        return receipt


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("archive", type=Path, help="Complete original EPD GIS ZIP")
    parser.add_argument("--inspect", action="store_true", help="Print complete ZIP/DBF/PRJ inventory using only the standard library")
    parser.add_argument("--output", type=Path)
    parser.add_argument("--sha256", help="Expected original archive SHA256")
    parser.add_argument("--expected-bytes", type=int, default=ORIGINAL_BYTES)
    parser.add_argument("--layers", type=Path, help="Explicit publisher layer roles JSON")
    parser.add_argument("--workspace", type=Path, help="Existing scientific Workspace for native source import")
    parser.add_argument("--domain-collection")
    parser.add_argument("--domain-source", help="Original retained domain source ID; select explicitly to compute its intersection")
    parser.add_argument("--expected-domain-count", type=int, default=217)
    args = parser.parse_args(argv)
    try:
        if args.inspect:
            if args.sha256 and file_digest(args.archive) != args.sha256:
                raise ValueError("Original ZIP SHA256 differs from the selected edition")
            if args.expected_bytes is not None and args.archive.stat().st_size != args.expected_bytes:
                raise ValueError("Original ZIP byte count differs from the selected edition")
            result = inspect_archive(args.archive)
        else:
            if args.output is None:
                parser.error("--output is required for preparation")
            from model.workspace import Workspace
            from model.common import read_json
            result = prepare(args.archive, args.output, expected_sha256=args.sha256,
                expected_bytes=args.expected_bytes, layer_config=read_json(args.layers) if args.layers else None,
                workspace=Workspace(args.workspace) if args.workspace else None,
                domain_collection=args.domain_collection, domain_source=args.domain_source,
                expected_domain_count=args.expected_domain_count)
        print(json.dumps(result, ensure_ascii=False, indent=2, allow_nan=False))
    except (OSError, ValueError, KeyError, ImportError, zipfile.BadZipFile) as error:
        parser.exit(2, "Water-supply watershed source: " + str(error) + "\n")


if __name__ == "__main__":
    main()
