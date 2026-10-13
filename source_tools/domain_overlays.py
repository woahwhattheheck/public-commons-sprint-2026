"""Acquire complete upstream context layers and prepare coverage-aware NWI rasters.

The original overlay collector retains provider bytes, native IDs, CRS and curves.
This extension supplies explicit domain masks and independent source recovery.
"""
from __future__ import annotations
import argparse
import gzip
import hashlib
import json
import math
import os
from pathlib import Path
import shutil
import sys
import tempfile

from model.common import (atomic_bytes, atomic_json, describe_file, digest,
                          file_digest, held, now, read_json, verify_file)
from model import rasters

# Existing source scripts remain callable both directly and through this adapter.
_SOURCE = Path(__file__).resolve().parents[1] / "source"
if str(_SOURCE) not in sys.path:
    sys.path.insert(0, str(_SOURCE))
from capture_original_overlays import SERVICES, capture_layer, oid_field

STATUS_URL = "https://fwsprimary.wim.usgs.gov/server/rest/services/Wetlands_Status/MapServer/0"
STATUS_REFERENCE = "https://www.fws.gov/program/national-wetlands-inventory/wetlands-mapper"
DOMAIN_SCHEMA = "upstate.domain-overlay-capture/v1"
SPECS = {key: dict(SERVICES[key]) for key in
         ("nwi-wetlands", "nhd-flowline", "nhd-waterbody", "padus-manager")}
SPECS = {"nwi-mapping-status": {
    "title": "USFWS National Wetlands Inventory mapping status",
    "role": "NWI_MAPPING_STATUS", "url": STATUS_URL, "page_size": 25}, **SPECS}
COVERAGE = ("Complete native features intersecting the declared acquisition tiles "
            "covering the retained upstream model domain; use the retained domain "
            "mask for analytical reporting. Tile-edge overcoverage is preserved.")
STATUS_CODES = {
    "0": "No mapping-status coverage or unrecognized status",
    "1": "Digital wetland mapping available",
    "2": "Provider identifies No_Data",
    "3": "Conflicting Digital and No_Data mapping-status polygons",
    "255": "Outside selected model domain",
}

def _retain(source, destination):
    source, destination = Path(source), Path(destination)
    expected = (source.stat().st_size, file_digest(source))
    destination.parent.mkdir(parents=True, exist_ok=True)
    if destination.exists():
        if (destination.stat().st_size, file_digest(destination)) != expected:
            raise ValueError("Another retained source owns " + str(destination))
        return
    try:
        os.link(source, destination)
    except OSError:
        with tempfile.NamedTemporaryFile(dir=destination.parent, delete=False) as temporary:
            pending = Path(temporary.name)
        try:
            shutil.copyfile(source, pending)
            if (pending.stat().st_size, file_digest(pending)) != expected:
                raise ValueError("Original source changed during receiving")
            with pending.open("rb") as stream:
                os.fsync(stream.fileno())
            os.link(pending, destination)
        finally:
            pending.unlink(missing_ok=True)

def _crs(value):
    from pyproj import CRS
    if value.get("wkt"):
        return CRS.from_wkt(value["wkt"])
    code = value.get("latestWkid") or value.get("wkid")
    if code in (102100, 102113):
        code = 3857
    if code is None:
        raise ValueError("Original vector source does not declare its CRS")
    try:
        return CRS.from_user_input("EPSG:" + str(code))
    except Exception:
        return CRS.from_user_input("ESRI:" + str(code))

def polygon_rows(path, target_crs, *, layer=None, where=None):
    """Read original Esri polygons, retaining native IDs and analytical repairs."""
    import shapely
    from capture_upstream_network import esri_polygon
    from pyproj import CRS, Transformer
    from shapely.ops import transform
    path = Path(path)
    if path.name.endswith((".json", ".json.gz")):
        opener = gzip.open if path.name.endswith(".gz") else open
        with opener(path, "rb") as stream:
            value = json.load(stream)
        if value.get("geometryType") == "esriGeometryPolygon":
            if layer:
                raise ValueError("The retained Esri collection contains one layer")
            source_crs = _crs(value.get("spatialReference", {}))
            target = CRS.from_user_input(target_crs)
            project = Transformer.from_crs(source_crs, target, always_xy=True)
            field = oid_field(value)
            rows, corrections, seen = [], [], set()
            for feature in value["features"]:
                properties = feature["attributes"]
                if where and any(properties.get(k) != v for k, v in where.items()):
                    continue
                identifier = str(properties[field])
                if identifier in seen:
                    raise ValueError("Original polygon source repeats a native object ID")
                seen.add(identifier)
                if not feature.get("geometry"):
                    corrections.append({"id": identifier, "status": "source_geometry_absent"})
                    continue
                geometry = esri_polygon(feature["geometry"], corrections, identifier)
                if source_crs != target:
                    geometry = transform(project.transform, geometry)
                if not geometry.is_valid:
                    before = hashlib.sha256(geometry.wkb).hexdigest()
                    geometry = shapely.make_valid(geometry)
                    corrections.append({"id": identifier, "stage": "projection",
                                        "method": "shapely.make_valid",
                                        "projected_geometry_sha256": before})
                if geometry.geom_type == "GeometryCollection":
                    from shapely.ops import unary_union
                    parts = [part for part in geometry.geoms
                             if part.geom_type in ("Polygon", "MultiPolygon") and not part.is_empty]
                    geometry = unary_union(parts)
                if not geometry.is_empty and geometry.geom_type in ("Polygon", "MultiPolygon"):
                    rows.append({"id": identifier, "properties": properties,
                                 "geometry": geometry})
            return rows, {"source_crs": source_crs.to_wkt(), "target_crs": target.to_wkt(),
                          "id_field": field, "analysis_corrections": corrections}
    rows, target = rasters.vector_geometry(path, layer=layer, where=where,
                                          target_crs=target_crs)
    return rows, {"reader": "model.rasters.vector_geometry", "target_crs": target.to_wkt()}

def _acquisition_masks(domain, buffer_m, tile_m):
    from shapely.geometry import box
    geometry = rasters.polygon_union(domain).buffer(buffer_m)
    left, bottom, right, top = geometry.bounds
    masks = []
    for row in range(math.floor(bottom / tile_m), math.ceil(top / tile_m)):
        for col in range(math.floor(left / tile_m), math.ceil(right / tile_m)):
            tile = box(col*tile_m, row*tile_m, (col+1)*tile_m, (row+1)*tile_m, ccw=False)
            if not geometry.intersects(tile):
                continue
            masks.append({"id": f"domain-c{col:07d}-r{row:07d}",
                          "geometry": {"rings": [list(map(list, tile.exterior.coords))]},
                          "spatial_reference": {"wkid": 5070},
                          "source": "Retained upstream-domain acquisition tiles"})
    if not masks:
        raise ValueError("The original upstream domain produces no acquisition masks")
    return masks

def _entry(root, key, value, plan_id):
    folder = root / "layers"
    record = {key2: value[key2] for key2 in
              ("title", "uri", "kind", "role", "id_field")}
    record.update(id=key + "-upstream-" + plan_id[:16],
                  vintage="Observed provider edition; original response UTC times retained",
                  path="layers/" + value["path"], sha256=value["sha256"],
                  bytes=(folder/value["path"]).stat().st_size,
                  metadata={"source_crs": value["source_crs"],
                            "feature_count": value["feature_count"],
                            "scope": "upstream_model_domain",
                            "coverage": COVERAGE, "capture_plan_sha256": plan_id,
                            "source_name": value["source_name"],
                            "source_description": value["source_description"],
                            "source_copyright": value["source_copyright"],
                            "source_capture": "layers/" + key + "/layer-capture.json"})
    companions = [folder/key/"layer-capture.json"]
    companions.extend(folder/item["path"] for item in value["files"]
                      if item["path"] != value["path"])
    record["companions"] = [describe_file(root, path) for path in companions]
    return record

def _selected_sources(sources):
    chosen = list(SPECS) if sources is None else list(sources)
    if not chosen or len(set(chosen)) != len(chosen) or set(chosen) - set(SPECS):
        raise ValueError("Select unique documented upstream overlay sources")
    return chosen

def _make_plan(domain, root, *, layer, where, expected_features, buffer_m, tile_m):
    """Geometry work runs only on a host with the existing GIS libraries."""
    from .nlcd_wcs import _domain_geometry
    from .nlcd_static import _domain_members
    if (not math.isfinite(buffer_m) or buffer_m < 0
            or not math.isfinite(tile_m) or tile_m <= 0):
        raise ValueError("Use a nonnegative domain buffer and positive acquisition tile size")
    buffer_m, tile_m = float(buffer_m), float(tile_m)
    domain = Path(domain).resolve(strict=True)
    members = _domain_members(domain)
    for item in members:
        _retain(domain.parent/item["name"], root/"original-domain"/item["name"])
    retained_domain = root/"original-domain"/domain.name
    rows, reader = _domain_geometry(retained_domain, layer=layer, where=where,
                                   target_crs="EPSG:5070")
    if expected_features is not None and len(rows) != expected_features:
        raise ValueError("Selected domain feature count differs from its retained edition")
    masks = _acquisition_masks(rows, buffer_m, tile_m)
    plan = {"schema": DOMAIN_SCHEMA, "domain": describe_file(root, retained_domain),
            "domain_members": members, "layer": layer, "where": where,
            "expected_features": expected_features, "selected_features": len(rows),
            "domain_reader": reader, "capture_crs": "EPSG:5070",
            "buffer_m": buffer_m, "tile_m": tile_m,
            "source_contracts": {
                key: {**spec, "scope": "upstream", "coverage": COVERAGE}
                for key, spec in SPECS.items()},
            "coverage": COVERAGE}
    atomic_json(root/"plan.json", plan, immutable=True)
    atomic_json(root/"masks.json", {"upstream": masks}, immutable=True)
    files = [root/"plan.json", root/"masks.json"]
    files.extend(root/"original-domain"/item["name"] for item in members)
    transfer = {"schema": "upstate.domain-overlay-plan-transfer/v1",
                "plan_sha256": digest(plan), "masks_sha256": digest({"upstream": masks}),
                "files": [describe_file(root, path) for path in files]}
    atomic_json(root/"plan-transfer.json", transfer, immutable=True)
    return plan, masks

def _verify_plan(root):
    """Validate a transferred source plan using only the Python standard library."""
    import re
    plan, masks = read_json(root/"plan.json"), read_json(root/"masks.json")
    transfer = read_json(root/"plan-transfer.json")
    if (plan.get("schema") != DOMAIN_SCHEMA
            or transfer.get("schema") != "upstate.domain-overlay-plan-transfer/v1"):
        raise ValueError("Select the retained upstream context plan and its original transfer manifest")
    if digest(plan) != transfer.get("plan_sha256") or digest(masks) != transfer.get("masks_sha256"):
        raise ValueError("The transferred plan or request masks differ from their source manifest")
    expected = {key: {**spec, "scope": "upstream", "coverage": COVERAGE}
                for key, spec in SPECS.items()}
    if plan.get("source_contracts") != expected or plan.get("capture_crs") != "EPSG:5070":
        raise ValueError("The transferred plan and installed native source contracts differ")
    required = {"plan.json", "masks.json"}
    required.update("original-domain/" + item["name"] for item in plan["domain_members"])
    listed = [item["path"] for item in transfer["files"]]
    if len(set(listed)) != len(listed) or set(listed) != required:
        raise ValueError("The original plan transfer must include every domain member and request mask")
    for item in transfer["files"]:
        verify_file(root, item)
    verify_file(root, plan["domain"])
    for item in plan["domain_members"]:
        verify_file(root, {"path": "original-domain/" + item["name"],
                          "bytes": item["bytes"], "sha256": item["sha256"]})
    selected = masks.get("upstream")
    if not isinstance(selected, list) or not selected:
        raise ValueError("The retained source plan has no upstream acquisition masks")
    identities = set()
    for mask in selected:
        identity = mask.get("id")
        if (not isinstance(identity, str) or not re.fullmatch(r"[a-zA-Z0-9_.-]+", identity)
                or identity in identities or mask.get("spatial_reference") != {"wkid": 5070}):
            raise ValueError("Use original unique native request names and EPSG:5070 masks")
        identities.add(identity)
        rings = mask.get("geometry", {}).get("rings")
        if not isinstance(rings, list) or len(rings) != 1 or len(rings[0]) != 5:
            raise ValueError("The original acquisition plan uses complete closed rectangular tiles")
        ring = rings[0]
        if (ring[0] != ring[-1] or any(len(point) != 2 or
                any(isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v)
                    for v in point) for point in ring)):
            raise ValueError("The original request mask contains invalid native metre coordinates")
        signed = sum(a[0]*b[1] - b[0]*a[1] for a, b in zip(ring, ring[1:]))
        if signed >= 0:
            raise ValueError("ArcGIS exterior request rings must retain their clockwise orientation")
    return plan, selected

def _pack_plan(root, archive):
    import zipfile
    plan, _ = _verify_plan(root)
    transfer = read_json(root/"plan-transfer.json")
    records = [*transfer["files"], describe_file(root, root/"plan-transfer.json")]
    archive = Path(archive).resolve()
    archive.parent.mkdir(parents=True, exist_ok=True)
    if any(archive == verify_file(root, item) for item in records):
        raise ValueError("The archive must have its own output filename")
    with tempfile.NamedTemporaryFile(dir=archive.parent, delete=False) as stream:
        pending = Path(stream.name)
    try:
        with zipfile.ZipFile(pending, "w", compression=zipfile.ZIP_STORED, allowZip64=True) as zipped:
            for item in sorted(records, key=lambda row: row["path"]):
                info = zipfile.ZipInfo(item["path"], date_time=(1980, 1, 1, 0, 0, 0))
                info.compress_type = zipfile.ZIP_STORED
                info.external_attr = 0o100644 << 16
                with verify_file(root, item).open("rb") as source, zipped.open(info, "w", force_zip64=True) as out:
                    shutil.copyfileobj(source, out, 1024*1024)
        with pending.open("rb") as stream:
            os.fsync(stream.fileno())
        _retain(pending, archive)
    finally:
        pending.unlink(missing_ok=True)
    return {"path": str(archive), "bytes": archive.stat().st_size,
            "sha256": file_digest(archive), "plan_sha256": digest(plan)}

def _unpack_plan(archive, root, expected_sha256=None):
    """Receive an original plan bundle without geospatial dependencies or remote geometry."""
    from pathlib import PurePosixPath
    import stat
    import zipfile
    archive = Path(archive).resolve(strict=True)
    if expected_sha256 and file_digest(archive) != expected_sha256:
        raise ValueError("The plan archive differs from the transmitting host's SHA256")
    with zipfile.ZipFile(archive) as zipped:
        members = zipped.infolist()
        names = [item.filename for item in members]
        if (len(set(names)) != len(names) or len(names) > 32
                or "plan-transfer.json" not in names):
            raise ValueError("Select one complete native plan archive with unique original members")
        for item in members:
            path = PurePosixPath(item.filename)
            if (path.is_absolute() or ".." in path.parts or "\\" in item.filename
                    or item.is_dir() or stat.S_ISLNK(item.external_attr >> 16)
                    or item.file_size > 64*1024*1024):
                raise ValueError("The source plan archive contains an unsupported member")
        manifest_info = zipped.getinfo("plan-transfer.json")
        if manifest_info.file_size > 1024*1024:
            raise ValueError("The original plan transfer manifest exceeds its expected size")
        manifest_body = zipped.read(manifest_info)
        transfer = json.loads(manifest_body)
        if transfer.get("schema") != "upstate.domain-overlay-plan-transfer/v1":
            raise ValueError("Select the original source plan transfer schema")
        records = transfer.get("files", [])
        expected = {item["path"]: item for item in records}
        if len(expected) != len(records) or set(names) != set(expected) | {"plan-transfer.json"}:
            raise ValueError("The plan archive and its native file manifest differ")
        for name, item in expected.items():
            if name not in ("plan.json", "masks.json"):
                parts = PurePosixPath(name).parts
                if len(parts) != 2 or parts[0] != "original-domain":
                    raise ValueError("The transfer carries original domain data and its request plan")
            if zipped.getinfo(name).file_size != item["bytes"]:
                raise ValueError("An original source plan member has changed byte length")
            destination = (root/Path(name)).resolve()
            if not destination.is_relative_to(root):
                raise ValueError("Receive original source plan members within the selected output root")
            destination.parent.mkdir(parents=True, exist_ok=True)
            with tempfile.NamedTemporaryFile(dir=destination.parent, delete=False) as stream:
                pending = Path(stream.name)
                try:
                    with zipped.open(name) as source:
                        shutil.copyfileobj(source, stream, 1024*1024)
                    stream.flush()
                    os.fsync(stream.fileno())
                except BaseException:
                    pending.unlink(missing_ok=True)
                    raise
            try:
                if pending.stat().st_size != item["bytes"] or file_digest(pending) != item["sha256"]:
                    raise ValueError("A received source plan member differs from its original bytes")
                _retain(pending, destination)
            finally:
                pending.unlink(missing_ok=True)
        atomic_bytes(root/"plan-transfer.json", manifest_body, immutable=True)
    return _verify_plan(root)

def plan_capture(domain, output, *, archive=None, layer=None, where=None,
                 expected_features=217, buffer_m=2000, tile_m=50000):
    root = Path(output).resolve()
    root.mkdir(parents=True, exist_ok=True)
    with held(root/"capture.lock", blocking=False):
        plan, masks = _make_plan(domain, root, layer=layer, where=where,
                                expected_features=expected_features,
                                buffer_m=buffer_m, tile_m=tile_m)
        bundle = _pack_plan(root, archive) if archive else None
        return {"state": "planned", "plan": str(root/"plan.json"),
                "transfer_manifest": str(root/"plan-transfer.json"),
                "plan_sha256": digest(plan), "selected_features": plan["selected_features"],
                "acquisition_tiles": len(masks), "archive": bundle}

def _receive_layers(root, plan, masks, *, sources=None, retry_failed=False, metadata_root=None):
    records = {}
    previous = read_json(root/"capture-progress.json") if (root/"capture-progress.json").exists() else {}
    failures = dict(previous.get("failures", {}))
    for key in _selected_sources(sources):
        spec = plan["source_contracts"][key]
        try:
            result = capture_layer(root/"layers", key, spec, {"upstream": masks},
                                   retry_failed=retry_failed,
                                   metadata_root=Path(metadata_root) if metadata_root else None)
            if result["coverage"] != COVERAGE:
                raise ValueError("Install the optional coverage-label change in capture_original_overlays.py")
            records[key] = result
            failures.pop(key, None)
        except Exception as error:
            failures[key] = {"type": type(error).__name__, "message": str(error),
                             "observed_at": now()}
        _publish(root, plan, records, failures)
    return _publish(root, plan, records, failures)

def receive(output, *, plan_archive=None, archive_sha256=None, sources=None,
            retry_failed=False, metadata_root=None):
    _selected_sources(sources)
    root = Path(output).resolve()
    root.mkdir(parents=True, exist_ok=True)
    with held(root/"capture.lock", blocking=False):
        plan, masks = (_unpack_plan(plan_archive, root, archive_sha256) if plan_archive
                       else _verify_plan(root))
        return _receive_layers(root, plan, masks, sources=sources,
                               retry_failed=retry_failed, metadata_root=metadata_root)

def capture(domain, output, *, layer=None, where=None, expected_features=217,
            buffer_m=2000, tile_m=50000, sources=None, retry_failed=False,
            metadata_root=None):
    _selected_sources(sources)
    root = Path(output).resolve()
    root.mkdir(parents=True, exist_ok=True)
    with held(root/"capture.lock", blocking=False):
        plan, masks = _make_plan(domain, root, layer=layer, where=where,
                                expected_features=expected_features,
                                buffer_m=buffer_m, tile_m=tile_m)
        return _receive_layers(root, plan, masks, sources=sources,
                               retry_failed=retry_failed, metadata_root=metadata_root)

def _publish(root, plan, records, failures):
    """Publish usable completed layers even while another provider is recovering."""
    for key in SPECS:
        path = root/"layers"/key/"layer-capture.json"
        if key not in records and path.is_file() and key not in failures:
            value = read_json(path)
            if value.get("scope") == "upstream" and value.get("coverage") == COVERAGE:
                for item in value["files"]:
                    verify_file(root/"layers", item)
                records[key] = value
    entries = [_entry(root, key, records[key], digest(plan)) for key in SPECS if key in records]
    context = [root/"plan.json", root/"masks.json"]
    if (root/"plan-transfer.json").is_file():
        context.append(root/"plan-transfer.json")
    context.extend(root/"original-domain"/item["name"] for item in plan["domain_members"])
    entries.append({"id": "upstream-overlay-domain-" + digest(plan)[:16],
                    "title": "Upstream overlay selection and original domain",
                    "kind": "document", "role": "SOURCE_CONTEXT",
                    "uri": "urn:sha256:" + digest(plan),
                    "vintage": "Retained domain edition in plan.json",
                    **describe_file(root, context[0]),
                    "companions": [describe_file(root, path) for path in context[1:]]})
    manifest = {"schema": "upstate.sources/v1", "title": "Upper Savannah upstream context layers",
                "entries": entries, "scope": {"model_domain_sha256": plan["domain"]["sha256"],
                                             "selected_features": plan["selected_features"],
                                             "coverage": COVERAGE},
                "notes": ["Original source geometries remain whole and retain native CRS.",
                          "NWI mapping status is a distinct source from wetland occurrence.",
                          "PAD-US inventory records overlap; sum of native record areas is not unique protected area."]}
    name = "source-manifest-" + digest(manifest)[:20] + ".json"
    atomic_json(root/name, manifest, immutable=True)
    atomic_json(root/"sources.json", manifest)
    pending = [key for key in SPECS if key not in records]
    progress = {"schema": DOMAIN_SCHEMA, "state": "complete" if not pending else "partial",
                "plan_sha256": digest(plan), "manifest": name,
                "completed_sources": list(records), "remaining_sources": pending,
                "failures": failures, "updated_at": now()}
    atomic_json(root/"capture-progress.json", progress)
    print(json.dumps(progress, ensure_ascii=False), flush=True)
    return progress

class PolygonIndex:
    def __init__(self, rows):
        from shapely import STRtree
        self.rows = rows
        self.tree = STRtree([row["geometry"] for row in rows]) if rows else None
    def at(self, bounds):
        from shapely.geometry import box
        if self.tree is None:
            return []
        return [self.rows[int(i)] for i in self.tree.query(box(*bounds), predicate="intersects")]

def _burn(rows, shape, transform):
    import numpy as np
    from rasterio.features import rasterize
    from shapely.geometry import box, mapping
    from rasterio.transform import array_bounds
    if not rows:
        return np.zeros(shape, dtype="uint8")
    clip = box(*array_bounds(shape[0], shape[1], transform))
    shapes = [(mapping(part), 1) for row in rows
              if not (part := row["geometry"].intersection(clip)).is_empty
              and part.geom_type in ("Polygon", "MultiPolygon")]
    if not shapes:
        return np.zeros(shape, dtype="uint8")
    return rasterize(shapes,
                     out_shape=shape, transform=transform, fill=0,
                     dtype="uint8", all_touched=False)

def _prepared_manifest(destination, entry):
    """Publish or recover the ordinary Workspace intake for completed NWI output."""
    atomic_json(destination/"sources.json", {"schema": "upstate.sources/v1",
                "title": entry["title"], "entries": [entry]}, immutable=True)
    return entry

def prepare_nwi(capture_directory, reference, output, *, buffer_m=1000,
                reporting=None, reporting_layer=None, reporting_where=None,
                focus=None, focus_layer=None, focus_where=None):
    from .nlcd_wcs import _domain_geometry
    from .nlcd_static import _domain_members
    import numpy as np
    import rasterio
    from rasterio.features import rasterize
    from shapely.geometry import Polygon, mapping
    from shapely.ops import transform, unary_union
    from pyproj import CRS, Transformer
    root, destination = Path(capture_directory).resolve(strict=True), Path(output).resolve()
    destination.mkdir(parents=True, exist_ok=True)
    with held(destination/"prepare.lock", blocking=False):
        plan = read_json(root/"plan.json")
        if plan.get("schema") != DOMAIN_SCHEMA:
            raise ValueError("Select a complete retained upstream overlay capture")
        if not math.isfinite(buffer_m) or not 0 <= buffer_m <= plan["buffer_m"]:
            raise ValueError("Requested context buffer exceeds the acquired domain coverage")
        manifest = read_json(root/"sources.json")
        by_role = {entry["role"]: entry for entry in manifest["entries"]}
        required = ("NWI", "NWI_MAPPING_STATUS")
        missing = [role for role in required if role not in by_role]
        if missing:
            raise ValueError("Finish these existing source captures: " + ", ".join(missing))
        reference = Path(reference).resolve(strict=True)
        with rasterio.open(reference) as dataset:
            target = CRS.from_user_input(dataset.crs)
        domain_path = verify_file(root, plan["domain"])
        domain_rows, domain_reader = _domain_geometry(domain_path, layer=plan["layer"],
            where=plan["where"], target_crs=target)
        model_domain = rasters.polygon_union(domain_rows)
        geometry = model_domain.buffer(buffer_m)
        captured_masks = read_json(root/"masks.json")["upstream"]
        footprint = unary_union([Polygon(mask["geometry"]["rings"][0])
                                 for mask in captured_masks])
        projection = Transformer.from_crs("EPSG:5070", target, always_xy=True)
        footprint = transform(projection.transform, footprint)
        if not footprint.covers(geometry):
            raise ValueError("Prepared domain exceeds the actual acquired overlay tile footprint")
        grid = rasters.grid_definition(reference, geometry)
        wetland_path = verify_file(root, by_role["NWI"])
        status_path = verify_file(root, by_role["NWI_MAPPING_STATUS"])
        wetlands, wetlands_reader = polygon_rows(wetland_path, target)
        status, status_reader = polygon_rows(status_path, target)
        native_types = sorted({str(row["properties"].get("WETLAND_TYPE") or "Unspecified")
                               for row in wetlands})
        if len(native_types) > 252:
            raise ValueError("Native NWI categories exceed the single-band class representation")
        type_codes = {name: index+1 for index, name in enumerate(native_types)}
        unknown_status = sorted({str(row["properties"].get("STATUS"))
                                 for row in status
                                 if row["properties"].get("STATUS") not in ("Digital", "No_Data")})
        wet_index, status_index = PolygonIndex(wetlands), PolygonIndex(status)
        summaries = {"model_domain": model_domain, "prepared_domain_with_buffer": geometry}
        extra_sources = []
        if reporting:
            path = Path(reporting).resolve(strict=True)
            rows, reader = polygon_rows(path, target, layer=reporting_layer, where=reporting_where)
            summaries["reporting_area"] = rasters.polygon_union(rows)
            extra_sources.append({"role": "REPORTING_MASK", "path": str(path),
                                  "sha256": file_digest(path), "reader": reader})
        if focus:
            path = Path(focus).resolve(strict=True)
            rows, reader = polygon_rows(path, target, layer=focus_layer, where=focus_where)
            for row in rows:
                huc = next((str(value) for key, value in row["properties"].items()
                            if key.lower() == "huc12"), row["id"])
                if huc in summaries:
                    raise ValueError("Focus source repeats a HUC12 identity")
                summaries[huc] = row["geometry"]
            extra_sources.append({"role": "FOCUS_WATERSHEDS", "path": str(path),
                                  "sha256": file_digest(path), "reader": reader})
        selection = {"schema": "upstate.nwi-context-grid/v1",
                     "capture_plan_sha256": digest(plan),
                     "wetland_source_sha256": by_role["NWI"]["sha256"],
                     "status_source_sha256": by_role["NWI_MAPPING_STATUS"]["sha256"],
                     "reference_sha256": file_digest(reference), "grid": grid,
                     "buffer_m": buffer_m, "extra_sources": extra_sources,
                     "wetland_codes": {"0": "Digital mapping available; no published NWI polygon",
                         **{str(code): name for name, code in type_codes.items()},
                         "254": "Overlapping different native wetland types",
                         "255": "No occurrence value or outside selected domain"},
                     "mapping_status_codes": STATUS_CODES,
                     "status_field": "STATUS", "available_status_value": "Digital",
                     "unavailable_status_value": "No_Data",
                     "unknown_native_status_values": unknown_status,
                     "pixel_selection": "Pixel-centre; no minimum mapping unit inferred from 30m grid",
                     "source_scale": "Original NWI polygon and source mapping scales; 30m is the working grid"}
        atomic_json(destination/"plan.json", selection, immutable=True)
        final = destination/"source-entry.json"
        if final.exists():
            entry = read_json(final)
            for item in [entry, *entry["companions"]]:
                verify_file(destination, item)
            return _prepared_manifest(destination, entry)
        profile = rasters.output_profile(grid, categorical=True)
        profile.update(dtype="uint8", nodata=255)
        counts = {name: {"selected_cells": 0, "digital_mapping_cells": 0,
                        "provider_no_data_cells": 0, "status_conflict_cells": 0,
                        "unknown_mapping_status_cells": 0, "mapped_wetland_cells": 0,
                        "digital_without_nwi_polygon_cells": 0,
                        "wetland_type_conflict_cells": 0} for name in summaries}
        occurrence = destination/"nwi-occurrence.tif"
        coverage = destination/"nwi-mapping-status.tif"
        occurrence_pending = destination/"nwi-occurrence.tif.partial"
        coverage_pending = destination/"nwi-mapping-status.tif.partial"
        with rasterio.Env(GDAL_CACHEMAX=64*1024*1024), \
                rasterio.open(occurrence_pending, "w", **profile) as out, \
                rasterio.open(coverage_pending, "w", **profile) as cov:
            for _, window in out.block_windows(1):
                shape = (int(window.height), int(window.width))
                affine = out.window_transform(window)
                bounds = rasterio.windows.bounds(window, out.transform)
                selected = _burn([{"geometry": geometry}], shape, affine).astype(bool)
                status_rows = status_index.at(bounds)
                digital = _burn([r for r in status_rows if r["properties"].get("STATUS") == "Digital"],
                                shape, affine).astype(bool)
                no_data = _burn([r for r in status_rows if r["properties"].get("STATUS") == "No_Data"],
                                shape, affine).astype(bool)
                unrecognized = _burn([r for r in status_rows
                    if r["properties"].get("STATUS") not in ("Digital", "No_Data")],
                    shape, affine).astype(bool)
                status_conflict = digital & no_data
                mapped = digital & ~no_data & ~unrecognized
                status_values = np.zeros(shape, dtype="uint8")
                status_values[digital & ~no_data] = 1
                status_values[no_data & ~digital] = 2
                status_values[status_conflict] = 3
                status_values[unrecognized] = 0
                status_values[~selected] = 255
                candidates = wet_index.at(bounds)
                shapes = [(mapping(row["geometry"]),
                           type_codes[str(row["properties"].get("WETLAND_TYPE") or "Unspecified")])
                          for row in candidates]
                if shapes:
                    ordered = sorted(shapes, key=lambda item: item[1])
                    highest = rasterize(ordered, out_shape=shape, transform=affine, fill=0,
                                        dtype="uint8", all_touched=False)
                    lowest = rasterize(list(reversed(ordered)), out_shape=shape,
                                       transform=affine, fill=0, dtype="uint8", all_touched=False)
                else:
                    highest = lowest = np.zeros(shape, dtype="uint8")
                positive = highest > 0
                conflicting = positive & (highest != lowest)
                values = np.full(shape, 255, dtype="uint8")
                values[mapped & ~positive] = 0
                values[positive] = highest[positive]
                values[conflicting] = 254
                values[~selected] = 255
                out.write(values, 1, window=window)
                cov.write(status_values, 1, window=window)
                for name, region in summaries.items():
                    region_cells = _burn([{"geometry": region}], shape, affine).astype(bool) & selected
                    entry = counts[name]
                    entry["selected_cells"] += int(region_cells.sum())
                    entry["digital_mapping_cells"] += int((region_cells & mapped).sum())
                    entry["provider_no_data_cells"] += int((region_cells & (status_values == 2)).sum())
                    entry["status_conflict_cells"] += int((region_cells & (status_values == 3)).sum())
                    entry["unknown_mapping_status_cells"] += int((region_cells & (status_values == 0)).sum())
                    entry["mapped_wetland_cells"] += int((region_cells & positive).sum())
                    entry["digital_without_nwi_polygon_cells"] += int((region_cells & mapped & ~positive).sum())
                    entry["wetland_type_conflict_cells"] += int((region_cells & conflicting).sum())
            out.update_tags(units="class", source=by_role["NWI"]["uri"],
                            source_resolution=selection["source_scale"],
                            zero_semantics="Digital mapping available; no published NWI polygon",
                            nodata_policy="Unknown occurrence retained as NoData",
                            source_selection_sha256=digest(selection))
            cov.update_tags(units="class", source=STATUS_URL, source_field="STATUS",
                            source_selection_sha256=digest(selection))
        for temporary, path in ((occurrence_pending, occurrence), (coverage_pending, coverage)):
            with temporary.open("rb") as stream:
                os.fsync(stream.fileno())
            os.replace(temporary, path)
        for name, entry in counts.items():
            region = summaries[name]
            entry["region_geometry_area_ha"] = float(region.area / 10000)
            entry["region_inside_domain_area_ha"] = float(region.intersection(model_domain).area / 10000)
            entry["region_inside_prepared_domain_area_ha"] = float(region.intersection(geometry).area / 10000)
            entry["area_ha"] = {key.removesuffix("_cells"): value*grid["pixel_area_ha"]
                                for key, value in entry.items() if key.endswith("_cells")}
        atomic_json(destination/"coverage.json", {
            "schema": "upstate.nwi-context-coverage/v1", "grid": grid,
            "regions": counts, "unknown_native_status_values": unknown_status,
            "readers": {"domain": domain_reader, "wetlands": wetlands_reader, "status": status_reader}},
            immutable=True)
        # Retain the original native bodies, requests and geometry context for portable receiving.
        paths = {str(root/"plan.json"), str(root/"masks.json")}
        for item in plan["domain_members"]:
            paths.add(str(root/"original-domain"/item["name"]))
        for role in required:
            record = by_role[role]
            for item in [record, *record["companions"]]:
                paths.add(str(verify_file(root, item)))
        for original in sorted(paths):
            path = Path(original)
            _retain(path, destination/"original"/path.relative_to(root))
        for source in extra_sources:
            path = Path(source["path"])
            for item in _domain_members(path):
                _retain(path.parent/item["name"], destination/"original"/source["role"].lower()/item["name"])
        companions = [describe_file(destination, path) for path in sorted(destination.rglob("*"))
                      if path.is_file() and path != occurrence
                      and path.name not in ("prepare.lock", "source-entry.json", "sources.json")
                      and not path.name.endswith((".partial", ".lock"))]
        entry = {"id": "nwi-context-30m-" + digest(selection)[:16],
                 "title": "National Wetlands Inventory occurrence with mapping-status coverage",
                 "kind": "raster", "role": "NWI_CONTEXT", "units": "class",
                 "resampling": "nearest", "uri": by_role["NWI"]["uri"],
                 "vintage": by_role["NWI"]["vintage"],
                 **describe_file(destination, occurrence), "companions": companions,
                 "grid": grid, "selection_sha256": digest(selection),
                 "coverage": counts, "mapping_status_path": coverage.name,
                 "codes": selection["wetland_codes"], "mapping_status_codes": STATUS_CODES,
                 "native_lineage": selection["source_scale"],
                 "reference": STATUS_REFERENCE}
        atomic_json(final, entry, immutable=True)
        return _prepared_manifest(destination, entry)

def _domain_arguments(parser):
    parser.add_argument("--domain", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--layer")
    parser.add_argument("--where-json")
    parser.add_argument("--expected-features", type=int, default=217)
    parser.add_argument("--buffer-m", type=float, default=2000)
    parser.add_argument("--tile-m", type=float, default=50000)

def _receive_arguments(parser):
    parser.add_argument("--sources", help="Comma-separated native source IDs; default all five")
    parser.add_argument("--metadata-root")
    parser.add_argument("--retry-failed", action="store_true")

def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    acquire = sub.add_parser("capture", help="Plan and acquire all native sources on a connected GIS host")
    _domain_arguments(acquire)
    _receive_arguments(acquire)
    planning = sub.add_parser("plan", help="Prepare transferable native request masks on an offline GIS host")
    _domain_arguments(planning)
    planning.add_argument("--archive", help="Write a portable original plan ZIP for the network receiver")
    receiving = sub.add_parser("receive", help="Acquire original source features with standard-library Python")
    receiving.add_argument("--output", required=True)
    receiving.add_argument("--plan-archive", help="Receive the original plan ZIP before acquisition")
    receiving.add_argument("--archive-sha256", help="Verify the transmitting GIS host's original archive SHA256")
    _receive_arguments(receiving)
    prepare = sub.add_parser("prepare-nwi", help="Prepare NWI occurrence and coverage on the real NLCD grid")
    prepare.add_argument("--capture", required=True)
    prepare.add_argument("--reference", required=True)
    prepare.add_argument("--output", required=True)
    prepare.add_argument("--buffer-m", type=float, default=1000)
    prepare.add_argument("--reporting")
    prepare.add_argument("--reporting-layer")
    prepare.add_argument("--reporting-where-json")
    prepare.add_argument("--focus")
    prepare.add_argument("--focus-layer")
    prepare.add_argument("--focus-where-json")
    args = parser.parse_args(argv)
    if args.command in ("capture", "plan"):
        options = {"layer": args.layer,
                   "where": json.loads(args.where_json) if args.where_json else None,
                   "expected_features": args.expected_features,
                   "buffer_m": args.buffer_m, "tile_m": args.tile_m}
        if args.command == "plan":
            result = plan_capture(args.domain, args.output, archive=args.archive, **options)
        else:
            result = capture(args.domain, args.output, **options,
                sources=args.sources.split(",") if args.sources else None,
                retry_failed=args.retry_failed, metadata_root=args.metadata_root)
    elif args.command == "receive":
        result = receive(args.output, plan_archive=args.plan_archive,
            archive_sha256=args.archive_sha256,
            sources=args.sources.split(",") if args.sources else None,
            retry_failed=args.retry_failed, metadata_root=args.metadata_root)
    else:
        result = prepare_nwi(args.capture, args.reference, args.output,
            buffer_m=args.buffer_m, reporting=args.reporting, reporting_layer=args.reporting_layer,
            reporting_where=json.loads(args.reporting_where_json) if args.reporting_where_json else None,
            focus=args.focus, focus_layer=args.focus_layer,
            focus_where=json.loads(args.focus_where_json) if args.focus_where_json else None)
    print(json.dumps(result, ensure_ascii=False, indent=2), flush=True)
    if args.command in ("capture", "receive") and result["state"] != "complete":
        raise SystemExit(2)

if __name__ == "__main__":
    main()
