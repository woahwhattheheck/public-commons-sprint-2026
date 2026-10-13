"""Acquire all regional native USDA soil data before the NLCD raster arrives.

capture needs Shapely and pyproj. prepare additionally needs NumPy and Rasterio.
Both reuse the retained scientific workbench and its original SDA rule/transport.
"""
from __future__ import annotations
import argparse
from decimal import Decimal
import gzip
import hashlib
import json
import math
import os
from pathlib import Path
import shutil
import sqlite3

from model.common import (atomic_bytes, atomic_json, canonical, describe_file,
                          digest, file_digest, held, read_json, relative_file,
                          verify_file)
from model import rasters
from source.capture_upstream_network import esri_polygon
from .soil_sources import (ATTR_QUERY, K_FACTOR, K_REFERENCE, K_UNITS,
                           POLYGON_ID, REFERENCE, SERVICE, Sda, _geometry_pages,
                           _int, _metadata, _native_rule, _polygons, table)

SCHEMA = "upstate.regional-soil-capture/v1"
SURVEY_QUERY = ("SELECT areasymbol, areaname, saverest FROM sacatalog WHERE "
                "areasymbol LIKE 'SC%' OR areasymbol LIKE 'GA%' OR areasymbol LIKE 'NC%' "
                "ORDER BY areasymbol")


def _copy(source, destination, expected=None):
    source = Path(source).resolve(strict=True)
    destination = Path(destination)
    if expected and (source.stat().st_size != expected["bytes"]
                     or file_digest(source) != expected["sha256"]):
        raise ValueError("Retained source changed: " + str(source))
    destination.parent.mkdir(parents=True, exist_ok=True)
    if destination.exists():
        if (destination.stat().st_size != source.stat().st_size
                or file_digest(destination) != file_digest(source)):
            raise ValueError("Different original file already occupies " + str(destination))
        return
    # A copy keeps later changes to a source file from changing the capture.
    pending = destination.with_name(destination.name + ".partial")
    with source.open("rb") as src, pending.open("wb") as dst:
        shutil.copyfileobj(src, dst, 1024 * 1024)
        dst.flush()
        os.fsync(dst.fileno())
    if expected and file_digest(pending) != expected["sha256"]:
        raise ValueError("Source changed while retaining it")
    os.replace(pending, destination)


def _domain(manifest_path, source_id, target_crs):
    """Read the actual retained Esri source without importing Fiona or Rasterio."""
    from pyproj import CRS, Transformer
    from shapely.ops import transform, unary_union
    manifest_path = Path(manifest_path).resolve(strict=True)
    manifest = read_json(manifest_path)
    if manifest.get("schema") != "upstate.sources/v1":
        raise ValueError("Use the original upstate.sources/v1 domain manifest")
    matches = [e for e in manifest["entries"] if e["id"] == source_id]
    if len(matches) != 1 or matches[0].get("kind") != "vector":
        raise ValueError("Select one retained vector domain source")
    entry = matches[0]
    path = verify_file(manifest_path.parent, entry)
    with path.open("rb") as source:
        compressed = source.read(2) == b"\x1f\x8b"
    raw = gzip.decompress(path.read_bytes()) if compressed else path.read_bytes()
    if entry.get("decoded_sha256") and hashlib.sha256(raw).hexdigest() != entry["decoded_sha256"]:
        raise ValueError("Original decoded domain differs")
    document = json.loads(raw)
    target = CRS.from_user_input(target_crs)
    if (not target.is_projected
            or any(abs(a.unit_conversion_factor - 1) > 1e-12 for a in target.axis_info[:2])):
        raise ValueError("The source capture CRS must be projected in metres")
    if document.get("geometryType") != "esriGeometryPolygon":
        raise ValueError("Select the retained original Esri polygon domain")
    sr = document.get("spatialReference", {})
    wkid = sr.get("latestWkid", sr.get("wkid"))
    native = CRS.from_user_input(sr.get("wkt") or ("EPSG:" + str(wkid)))
    project = Transformer.from_crs(native, target, always_xy=True)
    oid = document.get("objectIdFieldName")
    if not oid:
        oid = entry.get("metadata", {}).get("native_object_id_field")
    if not oid:
        raise ValueError("Original domain needs its native object ID field")
    features = document.get("features", [])
    expected = entry.get("metadata", {}).get("feature_count")
    if expected is not None and len(features) != int(expected):
        raise ValueError("Original domain feature count differs")
    identities, geometries, corrections = [], [], []
    for position, feature in enumerate(features):
        identity = str(feature["attributes"][oid])
        if identity in identities:
            raise ValueError("Repeated original domain object ID")
        identities.append(identity)
        g = esri_polygon(feature.get("geometry"), corrections, identity)
        parts = _polygons(g)
        if not parts:
            raise ValueError("Selected domain feature contains no polygon: " + identity)
        geometries.extend(transform(project.transform, part) for part in parts)
    union = unary_union(geometries)
    if union.is_empty or not union.is_valid:
        raise ValueError("Original domain does not form a valid polygon union")
    detail = {"manifest_sha256": file_digest(manifest_path),
              "source_id": source_id, "source_sha256": entry["sha256"],
              "decoded_sha256": hashlib.sha256(raw).hexdigest(),
              "feature_count": len(features), "object_id_field": oid,
              "object_ids": identities, "source_crs": native.to_wkt(),
              "source_spatial_reference": sr, "target_crs": target.to_wkt(),
              "geometry_corrections": corrections}
    return union, target, detail, manifest, entry


def _retain_domain(manifest_path, entry, root):
    manifest_path = Path(manifest_path).resolve(strict=True)
    target = Path(root) / "domain"
    for member in [entry, *entry.get("companions", [])]:
        source = verify_file(manifest_path.parent, member)
        destination = target / member["path"]
        # verify_file has already checked portable relative paths.
        _copy(source, destination, member)
    selected = {"schema": "upstate.sources/v1",
                "title": "Original model domain for regional native soil capture",
                "entries": [entry]}
    atomic_json(target / "sources.json", selected, immutable=True)
    _copy(manifest_path, target / "original-manifest.json")
    return target / "sources.json"


def _metadata_from_provider(client):
    raw = client.post("regional-attribute-metadata",
                      {"QUERY": ATTR_QUERY, "FORMAT": "JSON+COLUMNNAME+METADATA"})
    rows = table(raw)
    selected = [r for r in rows
                if r.get("attributename") == "K Factor, Whole Soil"
                and r.get("attributetablename") == "chorizon"
                and r.get("attributecolumnname") == "kwfact"]
    if len(selected) != 1:
        raise ValueError("The native whole-soil K interpretation is ambiguous")
    row = selected[0]
    if (row["attributelogicaldatatype"] != "Choice"
            or row["effectivelogicaldatatype"] != "Choice"
            or row["algorithmname"] != "Dominant Condition"
            or row["depthqualifiermode"] != "Surface Layer"
            or str(row["interpnullsaszeroflag"]) != "0"):
        raise ValueError("Native whole-soil K interpretation defaults changed")
    return row, hashlib.sha256(raw).hexdigest()


def _database(path, *, readonly=False):
    if readonly:
        db = sqlite3.connect(Path(path).resolve().as_uri() + "?mode=ro", uri=True)
    else:
        db = sqlite3.connect(path)
        db.execute("PRAGMA journal_mode=DELETE")
        db.execute("PRAGMA synchronous=FULL")
        db.executescript("""
            CREATE TABLE IF NOT EXISTS soil (
                id INTEGER PRIMARY KEY,
                tile TEXT NOT NULL,
                aoiid INTEGER NOT NULL,
                native_id TEXT NOT NULL,
                mukey INTEGER NOT NULL,
                properties TEXT NOT NULL,
                wkb BLOB NOT NULL,
                UNIQUE(tile, native_id)
            );
            CREATE INDEX IF NOT EXISTS soil_tile ON soil(tile);
            CREATE INDEX IF NOT EXISTS soil_mukey ON soil(mukey);
            CREATE TABLE IF NOT EXISTS soil_capture_tiles (
                tile TEXT PRIMARY KEY,
                checkpoint TEXT NOT NULL
            );
            CREATE VIRTUAL TABLE IF NOT EXISTS soil_bounds USING rtree(
                id, minx, maxx, miny, maxy
            );
        """)
        db.commit()
    return db


def _clear_tile(db, name):
    db.execute("DELETE FROM soil_capture_tiles WHERE tile=?", (name,))
    db.execute("DELETE FROM soil_bounds WHERE id IN (SELECT id FROM soil WHERE tile=?)",
               (name,))
    db.execute("DELETE FROM soil WHERE tile=?", (name,))


def _geometry_source(client, request_name):
    """Describe an already validated original page; never recapture its body."""
    directory = client.root / "original" / request_name
    paths = sorted(directory.glob("[0-9][0-9][0-9][0-9].capture.json"))
    if not paths:
        raise ValueError("Original geometry correction lacks its retained response")
    receipt_path = paths[-1]
    record = read_json(receipt_path)
    request = read_json(directory / "request.json")
    if (record.get("state") != "complete" or record.get("status") != 200
            or record.get("request_sha256") != request.get("request_sha256")):
        raise ValueError("Complete the original geometry page before deriving its correction")
    body = relative_file(directory, record["stored_file"])
    return {"request": request_name, "request_sha256": record["request_sha256"],
            "response_sha256": record["sha256"], "response_bytes": record["bytes"],
            "stored_body": {"path": body.relative_to(client.root).as_posix(),
                            "bytes": record["stored_bytes"],
                            "sha256": record["stored_sha256"]}}


def _polygon_geometry(body):
    """Keep valid source WKB unchanged; repair invalid linework explicitly."""
    import shapely
    geometry = shapely.from_wkb(body)
    if geometry.is_empty or geometry.is_valid:
        return geometry, body, None
    original = geometry
    reason = str(shapely.is_valid_reason(original))
    # Default linework make_valid preserves the original edges and vertices.
    # Unlike buffer(0), it does not choose one side of a crossing ring.
    repaired = shapely.make_valid(original)
    parts = _polygons(repaired)
    if not parts:
        raise ValueError("Original soil geometry has no polygonal area after linework repair: "
                         + reason)
    # Retain polygonal area only for the soil raster. Any collapsed line/point
    # remains fully reproducible from the original WKB and is recorded below.
    geometry = parts[0] if len(parts) == 1 else shapely.union_all(parts)
    if (geometry.is_empty or not geometry.is_valid
            or geometry.geom_type not in ("Polygon", "MultiPolygon")
            or not all(math.isfinite(value) for value in geometry.bounds)):
        raise ValueError("Original soil linework did not yield valid finite polygonal area: "
                         + reason)
    indexed = bytes(shapely.to_wkb(geometry, byte_order=1))
    nonpolygon = {}
    def retain_lower_dimensions(item):
        if item.geom_type in ("MultiPolygon", "GeometryCollection"):
            for part in item.geoms:
                retain_lower_dimensions(part)
        elif item.geom_type != "Polygon" and not item.is_empty:
            nonpolygon[item.geom_type] = nonpolygon.get(item.geom_type, 0) + 1
    retain_lower_dimensions(repaired)
    correction = {
        "schema": "upstate.soil-geometry-correction/v1",
        "method": "shapely.make_valid:linework; polygonal union",
        "method_reference": "https://shapely.readthedocs.io/en/stable/reference/shapely.make_valid.html",
        "shapely_version": str(shapely.__version__),
        "geos_version": str(shapely.geos_version_string),
        "source_crs": "EPSG:4326",
        "original_validity_reason": reason,
        "original_geometry_type": original.geom_type,
        "original_wkb_sha256": hashlib.sha256(body).hexdigest(),
        "original_wkb_bytes": len(body),
        "make_valid_geometry_type": repaired.geom_type,
        "lower_dimensional_components": nonpolygon,
        "indexed_geometry_type": geometry.geom_type,
        "indexed_polygon_parts": len(_polygons(geometry)),
        "indexed_wkb_sha256": hashlib.sha256(indexed).hexdigest(),
        "indexed_wkb_bytes": len(indexed),
        "indexed_bounds": list(geometry.bounds),
    }
    return geometry, indexed, correction


def _store_rows(db, tile, rows, *, client=None, request_name=None):
    """Consume an original page into one consistent geometry/index transaction."""
    count, source = 0, None
    for row in rows:
        original_body = bytes.fromhex(row["GeometryWkb"])
        try:
            geometry, body, correction = _polygon_geometry(original_body)
        except Exception as error:
            raise ValueError("Original soil polygon " + str(row[POLYGON_ID])
                             + ": " + str(error)) from error
        if geometry.is_empty or not _polygons(geometry):
            continue
        properties = {k: v for k, v in row.items() if k != "GeometryWkb"}
        if correction is not None:
            if client is None or request_name is None:
                raise ValueError("Bind the original page before retaining a geometry correction")
            if "upstate_geometry_correction" in properties:
                raise ValueError("Original soil attributes occupy the derived correction field")
            if source is None:
                source = _geometry_source(client, request_name)
            properties["upstate_geometry_correction"] = {
                **correction, "source": source, "source_tile": tile["name"],
                "native_aoiid": tile["aoiid"], "native_polygon_id": str(row[POLYGON_ID]),
                "mapunit_key": _int(row["MapUnitKey"])}
        cursor = db.execute(
            "INSERT INTO soil(tile,aoiid,native_id,mukey,properties,wkb) VALUES(?,?,?,?,?,?)",
            (tile["name"], tile["aoiid"], str(row[POLYGON_ID]), _int(row["MapUnitKey"]),
             canonical(properties).decode("utf-8"), body))
        left, bottom, right, top = geometry.bounds
        db.execute("INSERT INTO soil_bounds VALUES(?,?,?,?,?)",
                   (cursor.lastrowid, left, right, bottom, top))
        count += 1
    return count


def _materialize_tile(client, db, tile):
    """Compatibility entry point for a previously described geometry tile."""
    count = 0
    with db:
        _clear_tile(db, tile["name"])
        for page in tile["pages"]:
            rows = client.query(page["request"], page["sql"], maximum_bytes=64 * 1024 * 1024)
            if [_int(r[POLYGON_ID]) for r in rows] != page["ids"]:
                raise ValueError("Original geometry page IDs changed")
            count += _store_rows(db, tile, rows, client=client, request_name=page["request"])
            del rows
    return count


def _tile_index_state(db, name):
    """Hash existing WKB/index rows in a stream, without parsing geometries."""
    h = hashlib.sha256()
    count = 0
    rows = db.execute("""
        SELECT s.aoiid,s.native_id,s.mukey,s.properties,
               b.minx,b.maxx,b.miny,b.maxy,s.wkb
        FROM soil s LEFT JOIN soil_bounds b ON b.id=s.id
        WHERE s.tile=? ORDER BY s.native_id
    """, (name,))
    for row in rows:
        if any(value is None for value in row[4:8]):
            return None
        header, body = canonical(list(row[:-1])), row[-1]
        h.update(len(header).to_bytes(8, "big"))
        h.update(header)
        h.update(len(body).to_bytes(8, "big"))
        h.update(body)
        count += 1
    return {"rows": count, "sha256": h.hexdigest()}


def _tile_original_members(client, tile):
    """Bind the already received originals inside the tile's SQL transaction."""
    names = [tile["name"] + suffix
             for suffix in ("/aoi", "/polygon-count", "/polygon-ids")]
    names.extend(page["request"] for page in tile["pages"])
    members = []
    for name in names:
        directory = client.root / "original" / name
        receipts = sorted(directory.glob("[0-9][0-9][0-9][0-9].capture.json"))
        if not receipts:
            raise ValueError("The indexed tile lacks its original response: " + name)
        receipt_path = receipts[-1]
        record = read_json(receipt_path)
        request_path = directory / "request.json"
        request = read_json(request_path)
        if (record.get("state") != "complete" or record.get("status") != 200
                or record.get("request_sha256") != request.get("request_sha256")):
            raise ValueError("Finish the original tile request before indexing: " + name)
        body = relative_file(directory, record["stored_file"])
        # Sda.post has just verified this compressed body and its decoded bytes.
        # Retain that existing identity; do not hash/decompress it a second time.
        members.extend((describe_file(client.root, request_path),
                        describe_file(client.root, receipt_path),
                        {"path": body.relative_to(client.root).as_posix(),
                         "bytes": record["stored_bytes"],
                         "sha256": record["stored_sha256"]}))
    return members


def _reuse_tile(client, db, expected, plan_sha256):
    row = db.execute("SELECT checkpoint FROM soil_capture_tiles WHERE tile=?",
                     (expected["name"],)).fetchone()
    if row is None:
        return None
    saved = json.loads(row[0])
    tile = saved["tile"]
    if (saved.get("schema") != "upstate.soil-indexed-tile/v1"
            or saved.get("plan_sha256") != plan_sha256
            or any(tile.get(key) != value for key, value in expected.items())):
        raise ValueError("The retained tile belongs to another original source selection")
    for member in saved["originals"]:
        verify_file(client.root, member)
    # A changed or interrupted derived index is rebuilt from its exact original
    # pages. A changed original above is reported instead of silently replaced.
    actual = _tile_index_state(db, tile["name"])
    if actual != saved["index"] or actual["rows"] != tile["indexed_polygons"]:
        return None
    return saved["ids"], tile


def _capture_tile(client, db, expected, *, page_size, plan_sha256):
    existing = _reuse_tile(client, db, expected, plan_sha256)
    if existing is not None:
        return existing[0], existing[1], True
    created = json.loads(client.post(expected["name"] + "/aoi", {
        "SERVICE": "aoi", "REQUEST": "create", "AOICOORDS": expected["native_aoi_wkt"]}))
    tile = {**expected, "aoiid": _int(created["id"])}
    with db:
        _clear_tile(db, tile["name"])
        count, page_offset = 0, 0

        def consume(rows):
            nonlocal count, page_offset
            request_name = tile["name"] + f"/polygons-{page_offset:07d}"
            count += _store_rows(db, tile, rows, client=client, request_name=request_name)
            page_offset += len(rows)

        ids, pages = _geometry_pages(client, tile, page_size=page_size, on_page=consume)
        tile.update(polygons=len(ids), pages=pages, indexed_polygons=count)
        index = _tile_index_state(db, tile["name"])
        if index is None or index["rows"] != count:
            raise ValueError("Original soil rows and their spatial index differ")
        checkpoint = {
            "schema": "upstate.soil-indexed-tile/v1",
            "plan_sha256": plan_sha256, "tile": tile, "ids": ids,
            "originals": _tile_original_members(client, tile), "index": index,
        }
        db.execute("INSERT INTO soil_capture_tiles(tile,checkpoint) VALUES(?,?)",
                   (tile["name"], canonical(checkpoint).decode("utf-8")))
    return ids, tile, False


def _coefficients(batches):
    result = {}
    for batch in batches:
        for row in batch["coefficients"]:
            key = _int(row["MapUnitKey"])
            value = None if row["value"] is None else Decimal(row["value"])
            if key in result and result[key] != value:
                raise ValueError("The same mapunit has conflicting native coefficients")
            result[key] = value
    return result


def _write_vector(db, values, destination):
    """Create a normal geographic layer; original WKB remains in the capture."""
    import shapely
    from shapely.geometry import mapping
    destination = Path(destination)
    pending = destination.with_name(destination.name + ".partial")
    count = 0
    with pending.open("wb") as raw:
        with gzip.GzipFile(filename="", fileobj=raw, mode="wb", mtime=0) as stream:
            stream.write(b'{"type":"FeatureCollection","features":[')
            for tile, aoiid, native_id, mukey, props, body in db.execute(
                    "SELECT tile,aoiid,native_id,mukey,properties,wkb FROM soil ORDER BY tile,native_id"):
                coefficient = values[mukey]
                properties = json.loads(props)
                properties.update(source_tile=tile, native_aoiid=aoiid,
                                  native_polygon_id=native_id,
                                  kw_choice=None if coefficient is None else str(coefficient),
                                  kw_si=None if coefficient is None else float(coefficient * K_FACTOR),
                                  kw_si_units=K_UNITS)
                feature = {"type": "Feature", "id": str(aoiid) + ":" + native_id,
                           "properties": properties,
                           "geometry": mapping(shapely.from_wkb(body))}
                if count:
                    stream.write(b",")
                stream.write(canonical(feature))
                count += 1
            stream.write(b"]}\n")
        raw.flush()
        os.fsync(raw.fileno())
    os.replace(pending, destination)
    return count


def _members(root, exclusions=()):
    root = Path(root)
    return [describe_file(root, p) for p in sorted(root.rglob("*"))
            if p.is_file() and p.relative_to(root).as_posix() not in exclusions
            and not p.name.endswith((".partial", ".lock", "-journal", "-wal", "-shm"))]


def verify_capture(root):
    root = Path(root).resolve(strict=True)
    record = read_json(root / "capture.json")
    if record.get("schema") != SCHEMA or record.get("state") != "complete":
        raise ValueError("Finish the selected regional soil capture")
    for member in record["files"]:
        verify_file(root, member)
    plan = read_json(root / "plan.json")
    if record["plan_sha256"] != digest(plan):
        raise ValueError("Regional soil plan changed")
    return record, plan


def _finish_capture(root, record, source_plan):
    """Finish publication from retained native bytes after an interrupted final save."""
    vector = describe_file(root, root / "soil-mapunits.geojson.gz")
    companions = [f for f in record["files"] if f["path"] != vector["path"]]
    companions.append(describe_file(root, root / "capture.json"))
    ratings = read_json(root / "ratings.json")
    source = {**vector, "id": record["source_id"], "title": "USDA original regional whole-soil K polygons",
              "kind": "vector", "role": "SOIL_K_NATIVE", "uri": SERVICE,
              "vintage": source_plan["vintage"], "encoding": "gzip", "source_format": "GeoJSON",
              "source_crs": "EPSG:4326", "units": K_UNITS,
              "native_attribute": "chorizon.kwfact", "native_parameters": ratings["parameters"],
              "observed": record["observed"], "companions": companions}
    atomic_json(root / "source-entry.json", source, immutable=True)
    manifest = {"schema": "upstate.sources/v1", "title": source["title"],
                "entries": [source]}
    atomic_json(root / "source-manifest.json", manifest, immutable=True)
    return manifest


def capture(manifest_path, source_id, directory, *, vintage, buffer_m=1000,
            capture_crs="EPSG:5070", tile_edge_m=15000, halo_m=60,
            page_size=128, rating_batch=1000, metadata_path=None,
            metadata_receipt=None, resume=False):
    from pyproj import Transformer
    from shapely.geometry import box
    if (not vintage or not math.isfinite(buffer_m) or buffer_m <= 0
            or not math.isfinite(tile_edge_m) or not 300 <= tile_edge_m <= 15000
            or not math.isfinite(halo_m) or halo_m < 60
            or not 1 <= page_size <= 1000 or not 1 <= rating_batch <= 1000):
        raise ValueError("Choose a source edition and finite positive native capture parameters")
    if bool(metadata_path) != bool(metadata_receipt):
        raise ValueError("Retained metadata body and receipt must be supplied together")
    root = Path(directory).resolve()
    root.mkdir(parents=True, exist_ok=True)
    with held(root / "capture.lock", blocking=False):
        core, crs, domain_info, _, entry = _domain(manifest_path, source_id, capture_crs)
        plan = {"schema": "upstate.regional-soil-plan/v1", "source": SERVICE,
                "vintage": vintage, "domain": domain_info, "buffer_m": buffer_m,
                "capture_crs": crs.to_wkt(), "tile_edge_m": tile_edge_m,
                "halo_m": halo_m, "geometry_page_size": page_size,
                "rating_batch_size": rating_batch, "native_geometry_crs": "EPSG:4326",
                "attribute": "chorizon.kwfact", "method": "Dominant Condition / Surface Layer",
                "nulls": "preserved", "customary_to_si_factor": str(K_FACTOR),
                "target_units": K_UNITS, "api_reference": REFERENCE,
                "unit_reference": K_REFERENCE,
                "capture_selection": "Complete projected tiles touching the buffered original domain; geographic request rectangles include a source halo"}
        atomic_json(root / "plan.json", plan, immutable=True)
        if (root / "capture.json").exists():
            completed, retained_plan = verify_capture(root)
            return _finish_capture(root, completed, retained_plan)
        _retain_domain(manifest_path, entry, root)
        client = Sda(root, resume=resume)
        if metadata_path:
            metadata, receipt = _metadata(root, metadata_path, metadata_receipt)
            metadata_sha = receipt["sha256"]
        else:
            metadata, metadata_sha = _metadata_from_provider(client)
        key = _int(metadata["attributekey"])
        surveys_before = {r["areasymbol"]: r
                          for r in client.query("regional-surveys-before", SURVEY_QUERY)}
        support = core.buffer(buffer_m + halo_m)
        to_native = Transformer.from_crs(crs, "EPSG:4326", always_xy=True)
        left, bottom, right, top = support.bounds
        x0, x1 = math.floor(left / tile_edge_m), math.ceil(right / tile_edge_m)
        y0, y1 = math.floor(bottom / tile_edge_m), math.ceil(top / tile_edge_m)
        tiles, keys, versions = [], set(), {}
        reused_tiles = 0
        db = _database(root / "soil-polygons.sqlite")
        try:
            for y in range(y0, y1):
                for x in range(x0, x1):
                    bounds = (x * tile_edge_m, y * tile_edge_m,
                              (x + 1) * tile_edge_m, (y + 1) * tile_edge_m)
                    if not support.intersects(box(*bounds)):
                        continue
                    west, south, east, north = to_native.transform_bounds(
                        bounds[0] - halo_m, bounds[1] - halo_m,
                        bounds[2] + halo_m, bounds[3] + halo_m, densify_pts=101)
                    if not (-180 <= west < east <= 180 and -90 <= south < north <= 90):
                        raise ValueError("Native USDA request rectangle is invalid")
                    name = f"geometry/x{x:+07d}-y{y:+07d}"
                    wkt = box(west, south, east, north).wkt
                    expected = {"name": name, "capture_bounds": list(bounds),
                                "native_aoi_wkt": wkt}
                    ids, tile, reused = _capture_tile(
                        client, db, expected, page_size=page_size, plan_sha256=digest(plan))
                    reused_tiles += int(reused)
                    for row in ids:
                        mukey = _int(row["MapUnitKey"])
                        if not 0 < mukey <= 2147483647:
                            raise ValueError("Native mapunit key exceeds its declared type")
                        keys.add(mukey)
                        area, version = row["AreaSymbol"], str(row["SpatialVersion"])
                        if area in versions and versions[area] != version:
                            raise ValueError("Native soil survey version changed: " + area)
                        versions[area] = version
                    tiles.append(tile)
                    atomic_json(root / "tiles" / (name.split("/")[-1] + ".json"),
                                tile, immutable=True)
                    atomic_json(root / "progress.json", {
                        "plan_sha256": digest(plan), "stage": "geometry",
                        "completed_tiles": len(tiles), "mapunits_seen": len(keys),
                        "reused_indexed_tiles": reused_tiles,
                        "newly_indexed_tiles": len(tiles) - reused_tiles})
            if not tiles or not keys:
                raise ValueError("The domain returned no original soil mapunits")
            batches, parameters = [], None
            ordered = sorted(keys)
            for start in range(0, len(ordered), rating_batch):
                selected = ordered[start:start + rating_batch]
                batch = _native_rule(client, f"ratings/batch-{start:07d}", selected, key)
                if parameters is not None and batch["parameters"] != parameters:
                    raise ValueError("The native soil interpretation changed across regional batches")
                parameters = batch["parameters"]
                batches.append(batch)
                atomic_json(root / "progress.json", {
                    "plan_sha256": digest(plan), "stage": "ratings",
                    "completed_tiles": len(tiles), "mapunits_seen": len(keys),
                    "rated_mapunits": min(start + rating_batch, len(ordered))})
            after = {r["areasymbol"]: r
                     for r in client.query("regional-surveys-after", SURVEY_QUERY)}
            for survey in versions:
                if survey not in surveys_before or surveys_before[survey] != after.get(survey):
                    raise ValueError("Native survey edition changed during capture: " + survey)
            values = _coefficients(batches)
            if set(values) != keys:
                raise ValueError("Native ratings do not cover the entire captured mapunit set")
            atomic_json(root / "geometry-capture.json", {
                "plan_sha256": digest(plan), "tiles": tiles,
                "native_survey_spatial_versions": versions,
                "mapunit_keys": ordered}, immutable=True)
            atomic_json(root / "ratings.json", {
                "plan_sha256": digest(plan), "attribute_key": key,
                "metadata_sha256": metadata_sha, "parameters": parameters,
                "batches": batches}, immutable=True)
            atomic_json(root / "survey-editions.json", {
                "surveys": [surveys_before[k] for k in sorted(versions)],
                "native_spatial_versions": versions}, immutable=True)
            features = _write_vector(db, values, root / "soil-mapunits.geojson.gz")
            summary = {"domain_features": domain_info["feature_count"],
                       "capture_tiles": len(tiles), "soil_polygon_fragments": features,
                       "mapunits": len(values),
                       "rated_mapunits": sum(v is not None for v in values.values()),
                       "unrated_mapunits": sum(v is None for v in values.values()),
                       "soil_surveys": len(versions), "interpretations": len(batches),
                       "native_rule": "K Factor, Whole Soil",
                       "native_parameters": parameters,
                       "native_units": "customary RUSLE K",
                       "derived_units": K_UNITS,
                       "capture_crs": crs.to_string(),
                       "geometry_processing": "Valid original WKB is unchanged. Invalid source linework is repaired with original response/WKB identities, method, versions and resulting polygonal geometry retained in each feature's upstate_geometry_correction.",
                       "feature_semantics": "Source AOIs overlap; fragments retain native AOI and mapunit IDs. Use geometric coverage and cell rasterization, not summed fragment areas."}
            atomic_json(root / "coverage.json", summary, immutable=True)
            atomic_json(root / "progress.json", {
                "plan_sha256": digest(plan), "stage": "complete",
                "completed_tiles": len(tiles), "mapunits_seen": len(keys),
                "rated_mapunits": len(keys)})
        finally:
            db.close()
        files = _members(root, {"capture.json", "source-entry.json", "source-manifest.json"})
        record = {"schema": SCHEMA, "state": "complete", "plan_sha256": digest(plan),
                  "source_id": "usda-regional-whole-soil-" + digest(plan)[:16],
                  "domain_manifest": "domain/sources.json",
                  "polygon_index": "soil-polygons.sqlite",
                  "files": files, "observed": summary}
        atomic_json(root / "capture.json", record, immutable=True)
        return _finish_capture(root, record, plan)


def _captured_shapes(db, bbox, transformer, values):
    import shapely
    from shapely.geometry import mapping
    from shapely.ops import transform
    west, south, east, north = bbox
    rows = db.execute("""
        SELECT soil.mukey,soil.wkb FROM soil JOIN soil_bounds b ON soil.id=b.id
        WHERE b.maxx>=? AND b.minx<=? AND b.maxy>=? AND b.miny<=?
        ORDER BY soil.tile,soil.native_id
    """, (west, east, south, north))
    shapes = []
    for mukey, body in rows:
        if mukey not in values:
            raise ValueError("Indexed polygon has no original native K rating")
        for part in _polygons(shapely.from_wkb(body)):
            geometry = transform(transformer.transform, part)
            if geometry.is_empty or not geometry.is_valid:
                raise ValueError("Projected native soil polygon is invalid")
            shapes.append((mapping(geometry), mukey))
    return shapes


def prepare(capture_directory, reference, directory, *, null_policy="preserve",
            tile_size=512):
    import numpy as np
    import rasterio
    from rasterio.features import rasterize
    from rasterio.transform import Affine
    from rasterio.vrt import WarpedVRT
    from rasterio.windows import Window, bounds as window_bounds
    from pyproj import CRS, Transformer
    import shapely
    from shapely.geometry import mapping
    from shapely.ops import transform, unary_union
    if null_policy not in ("preserve", "nlcd-water-zero") or not 1 <= tile_size <= 1024:
        raise ValueError("Choose the explicit null policy and a valid raster tile size")
    source_root = Path(capture_directory).resolve(strict=True)
    root = Path(directory).resolve()
    root.mkdir(parents=True, exist_ok=True)
    with held(root / "prepare.lock", blocking=False):
        record, source_plan = verify_capture(source_root)
        with rasterio.open(reference) as ref:
            crs = CRS.from_user_input(ref.crs)
            if ref.count != 1:
                raise ValueError("Use the original single-band numeric NLCD")
        core, _, domain_info, _, _ = _domain(
            source_root / record["domain_manifest"], source_plan["domain"]["source_id"], crs)
        model_domain = core.buffer(source_plan["buffer_m"])
        grid = rasters.grid_definition(reference, model_domain)
        affine = Affine(*grid["transform"])
        if affine.a != 30 or affine.e != -30 or affine.b or affine.d:
            raise ValueError("Native soil preparation needs the exact 30 m model grid")
        geometry = read_json(source_root / "geometry-capture.json")
        to_grid = Transformer.from_crs("EPSG:4326", crs, always_xy=True)
        to_native = Transformer.from_crs(crs, "EPSG:4326", always_xy=True)
        support = unary_union([shapely.from_wkt(t["native_aoi_wkt"])
                               for t in geometry["tiles"]])
        support = transform(to_grid.transform, shapely.segmentize(support, 0.001))
        if not support.buffer(0.001).covers(model_domain):
            raise ValueError("The selected raster domain extends outside the captured soil geography")
        plan = {"schema": "upstate.regional-soil-preparation/v1",
                "capture_sha256": file_digest(source_root / "capture.json"),
                "capture_plan_sha256": record["plan_sha256"],
                "reference_sha256": file_digest(reference), "grid": grid,
                "null_policy": null_policy, "tile_size": tile_size,
                "customary_to_si_factor": str(K_FACTOR), "target_units": K_UNITS}
        atomic_json(root / "plan.json", plan, immutable=True)
        final = root / "source-manifest.json"
        if final.exists():
            existing = read_json(final)
            for member in [existing["entries"][0], *existing["entries"][0]["companions"]]:
                verify_file(root, member)
            return existing
        retained_entry = root / "source-entry.json"
        if retained_entry.exists():
            existing_entry = read_json(retained_entry)
            if existing_entry["preparation_sha256"] != digest(plan):
                raise ValueError("Retained regional K entry belongs to another preparation")
            for member in [existing_entry, *existing_entry["companions"]]:
                verify_file(root, member)
            existing = {"schema": "upstate.sources/v1",
                        "title": existing_entry["title"], "entries": [existing_entry]}
            atomic_json(final, existing, immutable=True)
            return existing
        ratings = read_json(source_root / "ratings.json")
        values = _coefficients(ratings["batches"])
        profile = rasters.output_profile(grid)
        nodata = profile["nodata"]
        counts = {k: 0 for k in (
            "model_domain_cells", "native_rated_cells", "native_unrated_cells",
            "no_polygon_cells", "different_mapunit_cells", "different_rating_cells",
            "open_water_zero_cells", "unresolved_land_cells")}
        low = high = None
        pending = root / "soil-k.tif.partial"
        db = _database(source_root / record["polygon_index"], readonly=True)
        try:
            with rasterio.Env(GDAL_CACHEMAX=64 * 1024 * 1024), rasterio.open(reference) as nlcd:
                with WarpedVRT(nlcd, crs=crs, transform=affine, width=grid["width"],
                               height=grid["height"], resampling=rasterio.enums.Resampling.nearest) as cover, \
                        rasterio.open(pending, "w", **profile) as out:
                    for row in range(0, grid["height"], tile_size):
                        for col in range(0, grid["width"], tile_size):
                            width, height = min(tile_size, grid["width"] - col), min(tile_size, grid["height"] - row)
                            window = Window(col, row, width, height)
                            target = affine * Affine.translation(col, row)
                            shape = (height, width)
                            selected = rasterize([(mapping(model_domain), 1)], out_shape=shape,
                                                 transform=target, fill=0, dtype="uint8",
                                                 all_touched=False).astype(bool)
                            data = np.full(shape, nodata, dtype="float32")
                            if not selected.any():
                                out.write(data, 1, window=window)
                                continue
                            bounds = window_bounds(window, affine)
                            bbox = to_native.transform_bounds(
                                bounds[0] - 30, bounds[1] - 30, bounds[2] + 30, bounds[3] + 30,
                                densify_pts=101)
                            shapes = _captured_shapes(db, bbox, to_grid, values)
                            def burn(items):
                                return rasterize(items, out_shape=shape, transform=target,
                                                 fill=0, dtype="int32", all_touched=False) if items else np.zeros(shape, dtype="int32")
                            ordered = sorted(shapes, key=lambda item: item[1])
                            labels = burn(ordered)
                            lowest = burn(list(reversed(ordered)))
                            different = (labels != lowest) & selected
                            mismatch = np.zeros(shape, dtype=bool)
                            if different.any():
                                ordered_values = sorted({values[k] for _, k in shapes},
                                    key=lambda v: (v is not None, v if v is not None else Decimal(0)))
                                ranks = {v: i + 1 for i, v in enumerate(ordered_values)}
                                ranked = sorted([(g, ranks[values[k]]) for g, k in shapes],
                                                key=lambda item: item[1])
                                mismatch = different & (burn(ranked) != burn(list(reversed(ranked))))
                            rated = np.zeros(shape, dtype=bool)
                            for key in np.unique(labels[selected]):
                                key = int(key)
                                if key and values[key] is not None:
                                    cells = (labels == key) & selected
                                    data[cells] = float(values[key] * K_FACTOR)
                                    rated[cells] = True
                            rated[mismatch] = False
                            data[mismatch] = nodata
                            lc = cover.read(1, window=window, masked=True)
                            water = (np.ma.getdata(lc) == 11) & ~np.ma.getmaskarray(lc) & selected
                            zeros = water & ~rated & ~mismatch if null_policy == "nlcd-water-zero" else np.zeros(shape, dtype=bool)
                            data[zeros] = 0
                            valid = rated | zeros
                            counts["model_domain_cells"] += int(selected.sum())
                            counts["native_rated_cells"] += int(rated.sum())
                            counts["native_unrated_cells"] += int(((labels > 0) & selected & ~rated & ~mismatch).sum())
                            counts["no_polygon_cells"] += int(((labels == 0) & selected).sum())
                            counts["different_mapunit_cells"] += int(different.sum())
                            counts["different_rating_cells"] += int(mismatch.sum())
                            counts["open_water_zero_cells"] += int(zeros.sum())
                            counts["unresolved_land_cells"] += int((selected & ~valid & ~water).sum())
                            good = data[valid]
                            if good.size:
                                low = float(good.min()) if low is None else min(low, float(good.min()))
                                high = float(good.max()) if high is None else max(high, float(good.max()))
                            out.write(data, 1, window=window)
                    out.update_tags(units=K_UNITS, original_attribute="chorizon.kwfact",
                                    interpretation="Dominant Condition / Surface Layer",
                                    customary_to_si_factor=str(K_FACTOR), null_policy=null_policy,
                                    source=SERVICE, source_capture_sha256=plan["capture_sha256"],
                                    preparation_sha256=digest(plan))
        finally:
            db.close()
        with pending.open("rb") as stream:
            os.fsync(stream.fileno())
        os.replace(pending, root / "soil-k.tif")
        counts.update(minimum_si=low, maximum_si=high,
                      unique_mapunits=len(values), native_geometry_tiles=len(geometry["tiles"]),
                      native_interpretations=len(ratings["batches"]))
        atomic_json(root / "coverage.json", counts, immutable=True)
        for member in record["files"]:
            _copy(verify_file(source_root, member), root / "capture" / member["path"], member)
        for name in ("capture.json", "source-entry.json", "source-manifest.json"):
            _copy(source_root / name, root / "capture" / name)
        companions = _members(root, {"soil-k.tif", "source-manifest.json", "source-entry.json"})
        entry = {**describe_file(root, root / "soil-k.tif"),
                 "id": "usda-whole-soil-k-" + digest(plan)[:16],
                 "title": "USDA regional whole-soil K on the exact retained NLCD grid",
                 "kind": "raster", "role": "K_FACTOR", "uri": SERVICE,
                 "vintage": source_plan["vintage"], "units": K_UNITS,
                 "resampling": "nearest", "grid": grid,
                 "preparation_sha256": digest(plan), "observed": counts,
                 "native_attribute": "chorizon.kwfact",
                 "native_parameters": ratings["parameters"],
                 "unit_conversion": {"factor": str(K_FACTOR), "applied": True,
                                     "target_units": K_UNITS, "reference": K_REFERENCE},
                 "null_policy": null_policy, "companions": companions}
        atomic_json(root / "source-entry.json", entry, immutable=True)
        manifest = {"schema": "upstate.sources/v1", "title": entry["title"], "entries": [entry]}
        atomic_json(final, manifest, immutable=True)
        return manifest


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    c = sub.add_parser("capture", help="Capture the full original region without an NLCD raster")
    c.add_argument("--domain-manifest", required=True)
    c.add_argument("--domain-source-id", default="upstate-wbd-upstream-domain-20261012")
    c.add_argument("--output", required=True)
    c.add_argument("--vintage", required=True)
    c.add_argument("--capture-crs", default="EPSG:5070")
    c.add_argument("--buffer-m", type=float, default=1000)
    c.add_argument("--tile-edge-m", type=float, default=15000)
    c.add_argument("--halo-m", type=float, default=60)
    c.add_argument("--page-size", type=int, default=128)
    c.add_argument("--rating-batch", type=int, default=1000)
    c.add_argument("--attribute-metadata")
    c.add_argument("--metadata-capture")
    c.add_argument("--resume", action="store_true")
    p = sub.add_parser("prepare", help="Prepare the captured soil on the original numeric NLCD grid")
    p.add_argument("--capture", required=True)
    p.add_argument("--reference", required=True)
    p.add_argument("--output", required=True)
    p.add_argument("--null-policy", choices=("preserve", "nlcd-water-zero"), default="preserve")
    p.add_argument("--tile-size", type=int, default=512)
    v = sub.add_parser("inspect", help="Read and verify the retained regional soil capture")
    v.add_argument("--capture", required=True)
    args = parser.parse_args(argv)
    if args.command == "capture":
        result = capture(args.domain_manifest, args.domain_source_id, args.output,
                         vintage=args.vintage, buffer_m=args.buffer_m,
                         capture_crs=args.capture_crs, tile_edge_m=args.tile_edge_m,
                         halo_m=args.halo_m, page_size=args.page_size,
                         rating_batch=args.rating_batch, metadata_path=args.attribute_metadata,
                         metadata_receipt=args.metadata_capture, resume=args.resume)
    elif args.command == "prepare":
        result = prepare(args.capture, args.reference, args.output,
                         null_policy=args.null_policy, tile_size=args.tile_size)
    else:
        result, _ = verify_capture(args.capture)
    print(json.dumps(result, sort_keys=True, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
