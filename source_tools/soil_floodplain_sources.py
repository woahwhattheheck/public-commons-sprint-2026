"""Acquire original SSURGO hydric context and FEMA floodplain criterion sources.

The operation reuses an original MUKEY polygon source where available, otherwise
captures native SDA polygon keys/geometries. It retains the original tabular
responses and every component, plus selected class and certainty footprints.
"""
from __future__ import annotations

import argparse
from collections import Counter
import gzip
import hashlib
import importlib
import json
import math
from pathlib import Path
import re
import sys

from model import conservation, keowee_priority, rasters
from model.common import atomic_json, atomic_bytes, digest, describe_file, held, identifier, now, read_json
from source_tools import parcel_criteria, source_response_reuse

SCHEMA = "upstate.soil-floodplain-selection/v1"
VERSION = 1
SDA_URI = "https://sdmdataaccess.sc.egov.usda.gov/Tabular/post.rest"
FEMA_URI = "https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/28"
SDA_HELP = "https://sdmdataaccess.sc.egov.usda.gov/WebServiceHelp.aspx"
SDA_SCHEMA = "https://sdmdataaccess.sc.egov.usda.gov/documents/TableColumnDescriptionsReport.pdf"
SDA_SPATIAL = "https://sdmdataaccess.sc.egov.usda.gov/documents/AdvancedQueries.html"
HYDRIC_REFERENCE = "https://efotg.sc.egov.usda.gov/references/public/IN/HYDRIC_CLASS_INSTRUCTIONS.pdf"


def _overlays():
    # The original delivered collector supports direct script execution and uses
    # one sibling import. Resolve that existing source directory for its import.
    directory = str(Path(__file__).resolve().parents[1] / "source")
    inserted = directory not in sys.path
    if inserted:
        sys.path.insert(0, directory)
    try:
        return importlib.import_module("source.capture_original_overlays")
    finally:
        if inserted:
            sys.path.remove(directory)


def _copy(value):
    return json.loads(json.dumps(value, sort_keys=True, ensure_ascii=False, allow_nan=False))


def _key(value):
    if isinstance(value, bool) or value is None:
        raise ValueError("Original soil keys must be nonempty integer text")
    text = str(value)
    if not re.fullmatch(r"[0-9]+", text):
        raise ValueError("The selected original MUKEY/polygon/component key is not integer text")
    return text


def _in(values):
    # Keys have already been restricted to the original integer-string domain.
    return ",".join("'" + _key(value) + "'" for value in values)


def _number(value):
    if value is None or value == "" or isinstance(value, bool):
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def _body(path):
    raw = path.read_bytes()
    return json.loads(gzip.decompress(raw) if raw[:2] == b"\x1f\x8b" else raw)


def _hash_file(path):
    hashed = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            hashed.update(block)
    return hashed.hexdigest()


def _write_geojson(path, rows, *, source_crs="EPSG:4326"):
    import os
    import tempfile
    from shapely.geometry import mapping
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary, count = None, 0
    try:
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=path.parent,
                                         prefix="." + path.name + "-", delete=False) as stream:
            temporary = Path(stream.name)
            stream.write('{"type":"FeatureCollection","crs":')
            json.dump({"type": "name", "properties": {"name": source_crs}},
                      stream, ensure_ascii=False, allow_nan=False, separators=(",", ":"))
            stream.write(',"features":[')
            for row in rows:
                if count:
                    stream.write(",")
                json.dump({"type": "Feature", "id": str(row["id"]),
                           "geometry": mapping(row["geometry"]), "properties": row["properties"]},
                          stream, ensure_ascii=False, allow_nan=False, separators=(",", ":"))
                count += 1
            stream.write("]}\n")
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
        temporary = None
    finally:
        if temporary is not None and temporary.exists():
            temporary.unlink()
    return {"features": count, "sha256": _hash_file(path)}


def _domain(workspace, value):
    from pyproj import CRS, Transformer
    from shapely.ops import transform, unary_union
    from shapely.prepared import prep
    target = CRS.from_epsg(4326)
    if bool(value.get("domain")) == bool(value.get("study_id")):
        raise ValueError("Select exactly one original domain source or original conservation study")
    if value.get("domain"):
        choice = conservation._choice(value["domain"], "source acquisition domain")
        _, binding = conservation._source(workspace, choice)
        rows = conservation._vector(workspace, choice, binding, target)
        geometry = rasters.polygon_union(rows)
        identity = {"source": binding, "basis": "Exact explicit retained source selection"}
    else:
        study = conservation.inspect(workspace, identifier(value["study_id"]), include_candidates=False)
        if study["selection"]["spec"]["unit_type"] != "parcel":
            raise ValueError("A parcel criterion source capture needs the original parcel study")
        # Use the maintained source/parcel selection, while avoiding unrelated
        # contextual layers during acquisition of the missing contexts.
        geography = _copy(study)
        geography["selection"]["spec"]["contexts"] = {}
        crs, reporting, units, _, _ = conservation._geometry_inputs(workspace, geography)
        prepared = prep(reporting)
        extensions = [
            unit["geometry"].difference(reporting) for unit in units
            if not prepared.covers(unit["geometry"])
        ]
        original_domain = unary_union([reporting, *extensions])
        geometry = transform(Transformer.from_crs(crs, target, always_xy=True).transform, original_domain)
        ids = [unit["id"] for unit in units]
        binding = study["selection"]["bindings"]
        identity = {
            "study_id": study["id"],
            "basis": "Original reporting geometry union the full original geometry of every selected parcel",
            "parcels": binding["sources"]["parcels"],
            "reporting": binding["grid"] or binding["sources"].get("reporting_area"),
            "selected_parcels": len(ids), "selected_parcel_ids_sha256": digest(ids),
            "full_parcel_extension_area_m2": original_domain.difference(reporting).area,
            "geometry_context": keowee_priority.geometry_context(
                workspace, study["selection"]["spec"]),
            "analysis_crs": crs.to_wkt(),
        }
    if geometry.is_empty or not geometry.is_valid or geometry.geom_type not in ("Polygon", "MultiPolygon"):
        raise ValueError("The selected original source acquisition domain needs valid polygons")
    return geometry, identity


def _tiles(geometry, width=0.125):
    from shapely.geometry import box
    xmin, ymin, xmax, ymax = geometry.bounds
    x = math.floor(xmin / width)
    while x * width < xmax:
        y = math.floor(ymin / width)
        while y * width < ymax:
            tile = box(x * width, y * width, (x + 1) * width, (y + 1) * width)
            if geometry.intersection(tile).area > 0:
                yield {"id": "tile-" + digest([x, y, width])[:20], "geometry": tile}
            y += 1
        x += 1


def _esri_mask(row):
    from shapely.geometry.polygon import orient
    polygon = orient(row["geometry"], sign=-1.0)
    return {
        "id": row["id"],
        "geometry": {"rings": [
            [list(point) for point in polygon.exterior.coords],
            *[[list(point) for point in ring.coords] for ring in polygon.interiors],
        ]},
        "spatial_reference": {"wkid": 4326},
        "source": "Retained original study boundary; query tile intersects that exact boundary",
        "source_sha256": digest(row["geometry"].wkb_hex),
    }


class SDA:
    def __init__(self, root, retry_failed, response_reuse=None):
        from source_tools.soil_sources import Sda
        # Reuse the current original soil client and its native column decoder.
        # Completed response bodies are verified and reused; transient attempts
        # follow that client's preserved status/Retry-After rules.
        self.client = (response_reuse.sda(root / "sda") if response_reuse is not None
                       else Sda(root / "sda", resume=True))

    def query(self, name, sql):
        return self.client.query("hydric/" + name, sql, maximum_bytes=64 * 1024 * 1024)

    def polygon_keys(self, tile):
        wkt = tile["geometry"].wkt.replace("'", "''")
        relation = "SDA_Get_Mupolygonkey_from_intersection_with_WktWgs84('" + wkt + "')"
        counted = self.query(tile["id"] + "-count", "SELECT CAST(COUNT_BIG(*) AS varchar(30)) AS feature_count FROM " + relation)
        count = int(counted[0]["feature_count"])
        if count == 0:
            return []
        if count >= 99990:
            return self._split_keys(tile)
        rows = self.query(tile["id"] + "-ids",
                          "SELECT CAST(mupolygonkey AS varchar(30)) AS mupolygonkey FROM " + relation +
                          " ORDER BY mupolygonkey")
        keys = [_key(row["mupolygonkey"]) for row in rows]
        if count != len(keys) or len(set(keys)) != len(keys):
            raise ValueError("Original SDA polygon count and exact native key list differ")
        return keys

    def _split_keys(self, tile):
        from shapely.geometry import box
        xmin, ymin, xmax, ymax = tile["geometry"].bounds
        if max(xmax - xmin, ymax - ymin) < 0.00001:
            raise ValueError("The original SDA polygon key result exceeds its smallest spatial request")
        xmid, ymid = (xmin + xmax) / 2, (ymin + ymax) / 2
        values = set()
        for index, extent in enumerate(((xmin, ymin, xmid, ymid), (xmid, ymin, xmax, ymid),
                                        (xmin, ymid, xmid, ymax), (xmid, ymid, xmax, ymax))):
            values.update(self.polygon_keys({"id": tile["id"] + "-" + str(index), "geometry": box(*extent)}))
        return sorted(values, key=int)

    def polygons(self, keys):
        sql = (
            "SELECT CAST(mupolygonkey AS varchar(30)) AS mupolygonkey, "
            "CAST(mukey AS varchar(30)) AS mukey, areasymbol, spatialversion, musym, "
            "nationalmusym, muareaacres, mupolygongeo.STAsText() AS geometry_wkt "
            "FROM mupolygon WHERE mupolygonkey IN (" + _in(keys) + ") ORDER BY mupolygonkey")
        rows = self.query("polygons-" + digest(keys)[:24], sql)
        if {str(row["mupolygonkey"]) for row in rows} != set(keys) or len(rows) != len(keys):
            raise ValueError("SDA polygon response differs from the exact original key selection")
        return rows

    def attributes(self, keys):
        sql = (
            "SELECT CAST(mu.mukey AS varchar(30)) AS mukey, l.areasymbol, mu.musym, "
            "mu.muname, mu.mukind, a.hydclprs "
            "FROM mapunit AS mu INNER JOIN legend AS l ON mu.lkey=l.lkey "
            "LEFT JOIN muaggatt AS a ON mu.mukey=a.mukey "
            "WHERE mu.mukey IN (" + _in(keys) + ") ORDER BY mu.mukey")
        rows = self.query("attributes-" + digest(keys)[:24], sql)
        if {str(row["mukey"]) for row in rows} != set(keys) or len(rows) != len(keys):
            raise ValueError("SDA map-unit attributes differ from the selected MUKEYs")
        return rows

    def components(self, keys):
        sql = (
            "SELECT CAST(cokey AS varchar(30)) AS cokey, CAST(mukey AS varchar(30)) AS mukey, "
            "compname, localphase, majcompflag, comppct_r, hydricrating "
            "FROM component WHERE mukey IN (" + _in(keys) + ") ORDER BY mukey,cokey")
        rows = self.query("components-" + digest(keys)[:24], sql)
        if any(str(row["mukey"]) not in keys for row in rows):
            raise ValueError("SDA returned a component outside the original MUKEY selection")
        if len({_key(row["cokey"]) for row in rows}) != len(rows):
            raise ValueError("SDA repeated a native component key")
        return rows


def _hydric(attributes, components):
    percent = _number(attributes.get("hydclprs"))
    if percent is not None and not 0 <= percent <= 100:
        raise ValueError("Original hydric percentage lies outside its documented domain")
    for row in components:
        weight = _number(row.get("comppct_r"))
        if weight is not None and not 0 <= weight <= 100:
            raise ValueError("Original component percentage lies outside its documented domain")
    positive = [row for row in components
                if _number(row.get("comppct_r")) is None or _number(row.get("comppct_r")) > 0]
    ratings = {str(row.get("hydricrating") or "").strip().lower() for row in positive}
    certainty = (
        "hydric" if percent == 100 and positive and ratings == {"yes"}
        else "nonhydric" if percent == 0 and positive and ratings == {"no"} else None)
    category = (
        None if percent is None else "hydric_100" if percent == 100
        else "predominantly_hydric_66_99" if percent >= 66
        else "partially_hydric_33_65" if percent >= 33
        else "predominantly_nonhydric_1_32" if percent > 0 else "nonhydric_0")
    return {"hydric_percent": percent, "hydric_class": category, "hydric_certainty": certainty,
            "component_count": len(components),
            "positive_or_unknown_weight_component_ratings": sorted(ratings),
            "known_component_percent_sum": math.fsum(
                value for row in components if (value := _number(row.get("comppct_r"))) is not None),
            "unknown_component_percent_count": sum(_number(row.get("comppct_r")) is None for row in components)}



def _capture_binding(root):
    directory = Path(root).expanduser().resolve()
    path = directory / "geometry-capture.json"
    if not path.is_file():
        raise ValueError("The retained soil capture has no completed geometry-capture.json")
    body = path.read_bytes()
    document = json.loads(body)
    if not isinstance(document.get("tiles"), list):
        raise ValueError("The retained original soil capture has no native tile/page inventory")
    return {
        "mode": "retained_sda_geometry_capture", "capture_root": str(directory),
        "geometry_capture_sha256": hashlib.sha256(body).hexdigest(),
        "geometry_capture_bytes": len(body), "plan_sha256": document.get("plan_sha256"),
        "native_survey_spatial_versions": document.get("native_survey_spatial_versions"),
    }


def _capture_polygons(request, geometry, directory, progress):
    """Reuse the maintained soil collector's verified original WKB responses."""
    from shutil import copyfile
    from shapely import wkb
    from source_tools.soil_sources import Sda
    binding = _capture_binding(request["reuse_capture_root"])
    capture_root = Path(binding["capture_root"])
    captured = read_json(capture_root / "geometry-capture.json")
    client = Sda(capture_root, resume=True)
    destination = directory / "original-geometry-capture"
    destination.mkdir(parents=True, exist_ok=True)
    def copy_original(source, target):
        # A relocated same-edition acquisition can already own these exact
        # originals; reading them still follows the native response validation.
        if source.resolve() != target.resolve():
            copyfile(source, target)

    copy_original(capture_root / "geometry-capture.json", destination / "geometry-capture.json")
    if (capture_root / "plan.json").is_file():
        copy_original(capture_root / "plan.json", destination / "plan.json")
    pages = [(tile, page) for tile in captured["tiles"] for page in tile.get("pages", [])]
    output, native_keys, copied = [], set(), set()
    for index, (tile, page) in enumerate(pages):
        name, sql = page.get("request"), page.get("sql")
        if not isinstance(name, str) or not name or not isinstance(sql, str) or not sql:
            raise ValueError("A retained soil geometry page lacks its original request and SQL")
        original_folder = (capture_root / "original" / name).resolve()
        if not original_folder.is_relative_to((capture_root / "original").resolve()):
            raise ValueError("The retained soil page request is outside its original capture root")
        if not (original_folder / "request.json").is_file() or not list(original_folder.glob("*.capture.json")):
            raise ValueError("The requested original soil page has no retained request/response capture: " + name)
        originals = client.query(name, sql, maximum_bytes=64 * 1024 * 1024)
        for original in originals:
            if str(original.get("GeometrySrid")) != "4326":
                raise ValueError("The retained native soil WKB page does not declare EPSG:4326")
            encoded = original.get("GeometryWkb")
            if not isinstance(encoded, str):
                raise ValueError("The retained soil row has no original hexadecimal WKB")
            # The original collector returns the actual binary encoding as hex;
            # accepting a leading SQL hex marker preserves the same bytes.
            body = bytes.fromhex(encoded[2:] if encoded.startswith(("0x", "0X")) else encoded)
            polygon = wkb.loads(body)
            if polygon.is_empty or not polygon.is_valid or polygon.geom_type not in ("Polygon", "MultiPolygon"):
                raise ValueError("A retained original soil WKB feature requires explicit geometry correction")
            if not polygon.intersects(geometry) or polygon.intersection(geometry).area <= 0:
                continue
            mukey = _key(original.get("MapUnitKey"))
            polygon_key = _key(original.get("MuPolygonKey"))
            native_identity = {
                "request": name,
                "AoiId": parcel_criteria._field(original, "AoiId"),
                "AoiPartID": parcel_criteria._field(original, "AoiPartID"),
                "AoiSoilMapUnitPolygonID": parcel_criteria._field(original, "AoiSoilMapUnitPolygonID"),
                "MuPolygonKey": polygon_key, "MapUnitKey": mukey,
            }
            if native_identity["AoiSoilMapUnitPolygonID"] is None:
                raise ValueError("The original AOI soil polygon has no native AOI polygon identity")
            identity = "aoi-" + digest(native_identity)
            properties = {key: value for key, value in original.items() if key != "GeometryWkb"}
            properties.update(mukey=mukey, mupolygonkey=polygon_key,
                              original_geometry_request=name,
                              original_geometry_wkb_sha256=hashlib.sha256(body).hexdigest(),
                              original_aoi_identity=native_identity)
            output.append({"id": identity, "geometry": polygon, "properties": properties})
            native_keys.add(mukey)
        # Preserve exact geometry request/response companions before importing.
        # The retained source edition is then portable beyond this capture host.
        if name not in copied:
            for original in sorted(original_folder.rglob("*")):
                if original.is_file():
                    target = destination / "original" / name / original.relative_to(original_folder)
                    target.parent.mkdir(parents=True, exist_ok=True)
                    copy_original(original, target)
            copied.add(name)
        progress("reuse_original_soil_geometry", index + 1, len(pages),
                 {"polygons": len(output), "mapunits": len(native_keys)})
    if len({row["id"] for row in output}) != len(output):
        raise ValueError("The retained soil capture repeats an original AOI polygon identity")
    if _capture_binding(capture_root) != binding:
        raise ValueError("The original soil geometry capture changed while being read")
    return output, {
        **binding, "mode": "retained_original_sda_wkb",
        "original_pages": len(pages), "selected_polygons": len(output), "mapunits": len(native_keys),
        "native_crs": "EPSG:4326",
        "native_identity": "Original request + AoiId/AoiPartID/AoiSoilMapUnitPolygonID/MuPolygonKey/MapUnitKey",
        "footprint": "Actual original AOI-clipped soil polygons; their complete retained extent supplies coverage",
        "copied_original_capture": "soils/original-geometry-capture",
    }

def _soil_polygons_base(workspace, request, geometry, directory, sda, progress):
    from pyproj import CRS
    from shapely import wkt
    if request.get("reuse_capture_root"):
        return _capture_polygons(request, geometry, directory, progress)
    reuse = request.get("reuse_source")
    if reuse:
        choice = conservation._choice(reuse, "original MUKEY polygons")
        path, binding = conservation._source(workspace, choice)
        try:
            rows = conservation._vector(workspace, choice, binding, CRS.from_epsg(4326))
        except ValueError as error:
            if not _empty_original(path, error):
                raise
            rows = []
        mukey_field = request.get("mukey_field", "MUKEY")
        native_id = binding.get("id_field")
        result = []
        for row in rows:
            if not row["geometry"].intersects(geometry) or row["geometry"].intersection(geometry).area <= 0:
                continue
            key = _key(parcel_criteria._field(row["properties"], mukey_field))
            original_identity = parcel_criteria._field(row["properties"], native_id) if native_id else row["id"]
            if original_identity is None or isinstance(original_identity, bool):
                raise ValueError("The retained original soil polygon has no native feature identity")
            identity = str(original_identity)
            result.append({"id": identity, "geometry": row["geometry"],
                           "properties": {**row["properties"], "mukey": key, "original_feature_id": identity}})
        if len({row["id"] for row in result}) != len(result):
            raise ValueError("Reused soil geometry repeats its original polygon identity")
        return result, {"mode": "retained_original_geometry", "source": binding, "mukey_field": mukey_field}
    tiles = list(_tiles(geometry, request.get("tile_degrees", 0.125)))
    keys = set()
    for index, tile in enumerate(tiles):
        keys.update(sda.polygon_keys(tile))
        progress("soil_polygon_keys", index + 1, len(tiles), {"unique_keys": len(keys)})
    keys = sorted(keys, key=int)
    atomic_json(directory / "soil-polygon-keys.json", keys)
    rows, ignored = [], 0
    for start in range(0, len(keys), 50):
        batch = keys[start:start + 50]
        for original in sda.polygons(batch):
            original_geometry = wkt.loads(original["geometry_wkt"])
            if not original_geometry.is_valid:
                raise ValueError("Original SDA polygon needs an explicit retained geometry correction: " + original["mupolygonkey"])
            if not original_geometry.intersects(geometry) or original_geometry.intersection(geometry).area <= 0:
                ignored += 1
                continue
            attributes = {key: value for key, value in original.items() if key != "geometry_wkt"}
            rows.append({"id": _key(original["mupolygonkey"]), "geometry": original_geometry,
                         "properties": attributes})
        progress("soil_original_geometry", min(len(keys), start + len(batch)), len(keys), {"selected_polygons": len(rows)})
    return rows, {"mode": "original_sda_polygon_keys", "selected_keys": len(keys),
                  "positive_domain_polygons": len(rows), "outside_domain_query_features": ignored,
                  "native_crs": "EPSG:4326", "native_id_field": "mupolygonkey"}



def _queried_soil_coverage(workspace, request):
    from pyproj import CRS
    from shapely import wkt
    from shapely.ops import unary_union
    if request.get("reuse_capture_root"):
        path = Path(request["reuse_capture_root"]) / "geometry-capture.json"
        document = _body(path)
        provenance = {"capture_root": request["reuse_capture_root"],
                      "geometry_capture_sha256": _hash_file(path)}
    elif request.get("reuse_source"):
        choice = request["reuse_source"]
        _, entry = workspace.source_file(choice["source_collection_id"], choice["source_id"])
        if choice.get("where"):
            return None, {"mode": "explicit_filtered_source",
                          "meaning": "Preserve the selected original attribute filter"}
        query_id = entry.get("metadata", {}).get("query_coverage_source_id")
        if query_id:
            query_choice = {"source_collection_id": choice["source_collection_id"], "source_id": query_id}
            _, binding = conservation._source(workspace, query_choice)
            rows = conservation._vector(workspace, query_choice, binding, CRS.from_epsg(4326))
            return rasters.polygon_union(rows), {
                "mode": "retained_actual_query_footprint", "source": binding}
        companion = next((row for row in entry.get("companions", [])
                          if Path(row.get("filename") or row.get("source_path", "")).name
                          == "geometry-capture.json"), None)
        if companion is None:
            return None, {"mode": "retained_geometry_without_query_mask",
                          "source_collection_id": choice["source_collection_id"],
                          "source_id": choice["source_id"]}
        from model.common import verify_file
        path = verify_file(workspace.root, {
            "path": companion.get("object") or companion.get("view_path"),
            "bytes": companion["bytes"], "sha256": companion["sha256"]})
        document = _body(path)
        provenance = {
            "source_collection_id": choice["source_collection_id"], "source_id": choice["source_id"],
            "geometry_capture_sha256": companion["sha256"],
        }
    else:
        return None, {"mode": "new_original_geometry_capture"}
    geometries = []
    for tile in document.get("tiles", []):
        native = tile.get("native_aoi_wkt")
        if not isinstance(native, str) or not native:
            return None, {**provenance, "mode": "original_capture_without_complete_native_aoi_masks"}
        geometry = wkt.loads(native)
        if not geometry.is_valid or geometry.is_empty or geometry.geom_type not in ("Polygon", "MultiPolygon"):
            raise ValueError("An original captured soil AOI mask is invalid")
        geometries.append(geometry)
    if not geometries:
        return None, {**provenance, "mode": "original_capture_without_native_aoi_masks"}
    return unary_union(geometries), {
        **provenance, "mode": "original_sda_queried_aoi_union", "native_crs": "EPSG:4326",
        "tile_count": len(geometries),
        "meaning": "Actual original requested AOI rectangles, independent of returned soil polygons",
    }


def _soil_polygons(workspace, request, geometry, directory, sda, progress):
    from shapely.ops import unary_union
    reused = bool(request.get("reuse_source") or request.get("reuse_capture_root"))
    rows, source = _soil_polygons_base(workspace, request, geometry, directory, sda, progress)
    if not reused:
        coverage = unary_union([tile["geometry"] for tile in _tiles(
            geometry, request.get("tile_degrees", 0.125))])
        context = {"mode": "actual_new_native_key_query_tiles"}
    else:
        coverage, context = _queried_soil_coverage(workspace, request)
        if context["mode"] == "explicit_filtered_source":
            # A deliberate native attribute selection stays that exact selection.
            source["query_coverage"] = context
            return rows, source
        if coverage is None:
            # Existing geometry remains useful. Query only the actual area that
            # lacks retained soil geometry when its original query masks are absent.
            coverage = unary_union([row["geometry"] for row in rows])
            context = {**context,
                       "extension_basis": "Area outside the retained original soil geometry; original query mask unavailable"}
        missing = geometry.difference(coverage)
        if not missing.is_empty and missing.area > 0:
            extension_request = {
                key: value for key, value in request.items()
                if key not in ("reuse_source", "reuse_capture_root", "reuse_selection")}
            extension_request["reuse_existing"] = False
            additions, extension_source = _soil_polygons_base(
                workspace, extension_request, missing, directory, sda, progress)
            # A source polygon may cross the old AOI and extension. Namespace its
            # original feature identity and retain both representations; the
            # downstream polygon union removes overlapping area.
            rows = [
                {**row, "id": "retained:" + row["id"],
                 "properties": {**row["properties"], "geometry_source_part": "retained",
                                "original_geometry_feature_id": row["id"]}}
                for row in rows
            ] + [
                {**row, "id": "extension:" + row["id"],
                 "properties": {**row["properties"], "geometry_source_part": "extension",
                                "original_geometry_feature_id": row["id"]}}
                for row in additions
            ]
            extension_coverage = unary_union([tile["geometry"] for tile in _tiles(
                missing, request.get("tile_degrees", 0.125))])
            coverage = unary_union([coverage, extension_coverage])
            source["extension"] = {
                "original": extension_source, "added_polygons": len(additions),
                "missing_domain_wkt": missing.wkt,
                "query_rule": "Actual acquisition-domain difference from original queried AOI coverage",
            }
            progress("soil_geometry_extension", len(additions), len(additions),
                     {"retained_and_added_polygons": len(rows)})
    path = directory / "soil-query-coverage.geojson"
    _write_geojson(path, [{
        "id": "soil-original-query-coverage", "geometry": coverage,
        "properties": {"soil_polygon_id": "soil-original-query-coverage",
                       "meaning": "Actual original source-query support, distinct from hydric certainty coverage"},
    }])
    source["query_coverage"] = {
        **context, "path": "soils/soil-query-coverage.geojson",
        "query_scope_sha256": hashlib.sha256(coverage.wkb).hexdigest(),
    }
    return rows, source

def _soils(workspace, request, geometry, directory, retry_failed, progress, response_reuse=None):
    folder = directory / "soils"
    folder.mkdir(parents=True, exist_ok=True)
    sda = SDA(folder, retry_failed, response_reuse)
    polygons, source = _soil_polygons(workspace, request, geometry, folder, sda, progress)
    if source.get("mode") == "retained_original_sda_wkb" and request.get("_retained_capture_root"):
        # Physical resolution is a runtime concern; original source metadata
        # continues to name the exact capture selected by this acquisition.
        source["capture_root"] = request["_retained_capture_root"]
    keys = sorted({_key(row["properties"]["mukey"]) for row in polygons}, key=int)
    attributes, components = {}, {}
    for start in range(0, len(keys), 100):
        batch = keys[start:start + 100]
        for row in sda.attributes(batch):
            attributes[_key(row["mukey"])] = row
        for row in sda.components(batch):
            components.setdefault(_key(row["mukey"]), []).append(row)
        progress("soil_original_attributes", min(len(keys), start + len(batch)), len(keys))
    classifications = {key: _hydric(attributes[key], components.get(key, [])) for key in keys}
    all_rows, full_rows, certainty_rows, predominant_rows, any_rows = [], [], [], [], []
    for row in polygons:
        key = _key(row["properties"]["mukey"])
        properties = {**row["properties"], "soil_polygon_id": row["id"],
                      **attributes[key], **classifications[key]}
        joined = {**row, "properties": properties}
        all_rows.append(joined)
        if classifications[key]["hydric_certainty"] is not None:
            certainty_rows.append(joined)
        if classifications[key]["hydric_certainty"] == "hydric":
            full_rows.append(joined)
        percent = classifications[key]["hydric_percent"]
        if percent is not None and percent >= 66:
            predominant_rows.append(joined)
        if percent is not None and percent > 0:
            any_rows.append(joined)
    outputs = {}
    for name, rows in (("soil-mapunits", all_rows), ("hydric-full", full_rows),
                       ("hydric-certainty", certainty_rows), ("hydric-predominant", predominant_rows),
                       ("hydric-any-component", any_rows),
                       ("hydric-rated-coverage", [row for row in all_rows if row["properties"]["hydric_percent"] is not None])):
        path = folder / (name + ".geojson")
        outputs[name] = {"path": path.relative_to(directory).as_posix(), **_write_geojson(path, rows)}
    table = {"schema": "upstate.original-hydric-mapunits/v1",
             "source": source, "query_uri": SDA_URI, "references": [SDA_HELP, SDA_SCHEMA, HYDRIC_REFERENCE],
             "rows": [{"mukey": key, "attributes": attributes[key], "components": components.get(key, []),
                       "classification": classifications[key]} for key in keys]}
    atomic_json(folder / "hydric-mapunits.json", table)
    outputs["hydric-table"] = {"path": "soils/hydric-mapunits.json", "rows": len(keys)}
    query_coverage = folder / "soil-query-coverage.geojson"
    if query_coverage.exists():
        outputs["soil-query-coverage"] = {
            "path": query_coverage.relative_to(directory).as_posix(),
            "features": 1, "sha256": _hash_file(query_coverage)}
    return {
        "outputs": outputs, "source": source, "mapunits": len(keys), "polygons": len(all_rows),
        "hydric_classes": dict(Counter(row["hydric_class"] or "unrated" for row in classifications.values())),
        "certainty_classes": dict(Counter(row["hydric_certainty"] or "mixed_or_unknown" for row in classifications.values())),
        "definition": {
            "hydric_full": "Original hydclprs=100 and all positive/unknown-weight original component ratings are Yes",
            "certainty": "Original hydclprs=0 with No component ratings, or hydclprs=100 with Yes component ratings",
            "predominant": "Original published hydric percent >=66; whole selected map-unit footprint",
            "any_component": "Original published hydric percent >0; whole selected map-unit footprint",
            "reference": SDA_SCHEMA,
        },
    }


def _empty_original(path, error):
    if (str(error) != "The selected vector source/filter contains no geometry"
            and not str(error).startswith("The selected native source filter has no features:")):
        return False
    if not path.name.endswith((".json", ".json.gz", ".geojson", ".geojson.gz")):
        return False
    document = _body(path)
    return isinstance(document, dict) and document.get("features") == []


def _native_polygon_rows(path, id_field):
    """Read the collector's retained Esri polygon representation in WGS84."""
    from pyproj import CRS, Transformer
    from shapely.ops import transform
    from source.capture_upstream_network import esri_polygon
    document = _body(path)
    if document.get("geometryType") != "esriGeometryPolygon":
        raise ValueError("The original floodplain source must contain polygon geometry")
    source_ref = document.get("spatialReference") or {}
    if source_ref.get("wkt"):
        crs = CRS.from_wkt(source_ref["wkt"])
    else:
        code = source_ref.get("latestWkid") or source_ref.get("wkid")
        if code in (102100, 102113):
            code = 3857
        if code is None:
            raise ValueError("The original floodplain response does not declare its CRS")
        crs = CRS.from_epsg(code)
    target = CRS.from_epsg(4326)
    projection = Transformer.from_crs(crs, target, always_xy=True).transform
    rows = []
    for feature in document.get("features", []):
        properties = feature.get("attributes", {})
        native_id = properties.get(id_field)
        if native_id is None or isinstance(native_id, bool):
            raise ValueError("An original floodplain feature lacks its declared native object ID")
        original_geometry = feature.get("geometry")
        if original_geometry is None:
            raise ValueError("An original selected floodplain feature has no polygon geometry: " + str(native_id))
        member_ref = original_geometry.get("spatialReference")
        if member_ref:
            member_code = member_ref.get("latestWkid") or member_ref.get("wkid")
            if member_ref.get("wkt"):
                member_crs = CRS.from_wkt(member_ref["wkt"])
            elif member_code is not None:
                member_crs = CRS.from_epsg(3857 if member_code in (102100, 102113) else member_code)
            else:
                raise ValueError("An original feature CRS is incomplete")
            if member_crs != crs:
                raise ValueError("The original floodplain feature CRS differs from its response")
        corrections = []
        geometry = esri_polygon(
            {**original_geometry, "rings": [
                [coordinate[:2] for coordinate in ring] for ring in original_geometry.get("rings", [])
            ]}, corrections, str(native_id))
        if crs != target:
            geometry = transform(projection, geometry)
        if geometry.is_empty or not geometry.is_valid or geometry.geom_type not in ("Polygon", "MultiPolygon"):
            raise ValueError("Original floodplain geometry cannot be used as a valid polygon: " + str(native_id))
        rows.append({"id": str(native_id), "geometry": geometry, "properties": properties,
                     "geometry_corrections": corrections})
    if len({row["id"] for row in rows}) != len(rows):
        raise ValueError("The retained floodplain source repeats an original native ID")
    return rows, {
        "native_crs": source_ref, "analysis_representation_crs": "EPSG:4326",
        "native_id_field": id_field, "hasZ": document.get("hasZ"), "hasM": document.get("hasM"),
        "fields": document.get("fields", []),
        "geometry_corrections": [
            {"id": row["id"], "corrections": row["geometry_corrections"]}
            for row in rows if row["geometry_corrections"]],
    }


def _field_name(fields, name, *, required=True):
    names = [field["name"] if isinstance(field, dict) else field for field in fields]
    if name in names:
        return name
    matches = [key for key in names if isinstance(key, str) and key.casefold() == name.casefold()]
    if len(matches) == 1:
        return matches[0]
    if required:
        raise ValueError("The actual original floodplain source has no unambiguous " + name + " field")
    return None


def _floodplains(workspace, request, geometry, directory, retry_failed, progress, response_reuse=None):
    from pyproj import CRS
    folder = directory / "floodplains"
    folder.mkdir(parents=True, exist_ok=True)
    reuse = request.get("reuse_source")
    if reuse:
        choice = conservation._choice(reuse, "original mapped flood zones")
        path, binding = conservation._source(workspace, choice)
        try:
            rows = conservation._vector(workspace, choice, binding, CRS.from_epsg(4326))
        except ValueError as error:
            if not _empty_original(path, error):
                raise
            rows = []
        native_id = binding.get("id_field")
        for row in rows:
            identity = parcel_criteria._field(row["properties"], native_id) if native_id else row["id"]
            if identity is None or isinstance(identity, bool):
                raise ValueError("The original retained floodplain source has a missing native identity")
            row["id"] = str(identity)
        _, entry = workspace.source_file(choice["source_collection_id"], choice["source_id"])
        declared_fields = entry.get("metadata", {}).get("fields")
        if not declared_fields and path.name.endswith((".json", ".json.gz", ".geojson", ".geojson.gz")):
            declared_fields = _body(path).get("fields")
        fields = declared_fields or sorted({name for row in rows for name in row["properties"]})
        if not fields:
            raise ValueError("An empty reused floodplain source needs retained original field metadata")
        source = {
            "mode": "retained_original_geometry", "source": binding, "fields": fields,
            "original_uri": binding["uri"], "native_id_field": native_id,
            "analysis_representation_crs": "EPSG:4326",
        }
    else:
        uri = request.get("service_uri", FEMA_URI)
        tiles = list(_tiles(geometry, request.get("tile_degrees", 0.5)))
        masks = {"reporting": [_esri_mask(row) for row in tiles]}
        atomic_json(folder / "query-masks.json", masks)
        progress("floodplain_original_capture", 0, len(tiles))
        collector = _overlays()
        responses = (response_reuse.overlay(collector.OriginalResponses,
                     folder / "original-nfhl" / "responses", uri, retry_failed)
                     if response_reuse is not None else None)
        capture = collector.capture_layer(
            directory, "floodplains/original-nfhl",
            {"url": uri, "title": "Original FEMA NFHL mapped flood hazard polygons",
             "role": "FEMA_FLOOD_HAZARD_AREAS", "scope": "reporting",
             "coverage": ("Complete original FEMA features intersecting this operation's retained "
                          "full-parcel or explicitly selected domain query tiles; actual query masks "
                          "and original domain/source identities remain with the capture."),
             "page_size": request.get("page_size", 50)},
            masks, retry_failed=retry_failed,
            metadata_root=Path(request["metadata_root"]).resolve() if request.get("metadata_root") else None,
            responses=responses)
        rows, native = _native_polygon_rows(directory / capture["path"], capture["id_field"])
        fields = native["fields"]
        source = {
            "mode": "original_fema_native_id_capture", "capture": capture, **native,
            "original_uri": uri, "query_masks": "floodplains/query-masks.json",
            "query_scope": "Complete native features intersecting actual retained-domain query tiles; "
                           "output selects features with positive area intersection with the actual domain",
        }
        progress("floodplain_original_capture", len(tiles), len(tiles),
                 {"original_native_features": len(rows)})
    if len({row["id"] for row in rows}) != len(rows):
        raise ValueError("The original floodplain selection repeats native feature IDs")
    sfha = _field_name(fields, "SFHA_TF")
    zone = _field_name(fields, "FLD_ZONE")
    subtype = _field_name(fields, "ZONE_SUBTY", required=False)
    selected, known, all_rows, unknown = [], [], [], []
    zone_counts = Counter()
    for row in rows:
        if not row["geometry"].intersects(geometry) or row["geometry"].intersection(geometry).area <= 0:
            continue
        properties = row["properties"]
        flag = properties.get(sfha)
        raw_zone = properties.get(zone)
        text_zone = str(raw_zone or "").strip().upper()
        text_subtype = str(properties.get(subtype) or "").strip().upper() if subtype else ""
        uncertain = (text_zone in ("", "D", "NOT INCLUDED", "AREA NOT INCLUDED", "UNMAPPED", "UNKNOWN")
                     or "AREA NOT INCLUDED" in text_subtype
                     or "UNDETERMINED" in text_subtype
                     or "NOT STUDIED" in text_subtype
                     or "UNMAPPED" in text_subtype
                     or "UNKNOWN" in text_subtype)
        # The original flag is matched exactly. Code descriptions do not replace
        # an actual T/F attribute. Zone D never establishes a known negative.
        classification = (
            "one_percent_flood_hazard" if flag == "T"
            else "mapped_other_flood_zone" if flag == "F" and not uncertain
            else "undetermined_or_unmapped")
        joined = {**row, "properties": {
            **properties, "flood_polygon_id": row["id"],
            "criterion_sfha": flag == "T",
            "flood_coverage_class": classification,
        }}
        all_rows.append(joined)
        zone_counts[str(raw_zone)] += 1
        if flag == "T":
            selected.append(joined)
            known.append(joined)
        elif flag == "F" and not uncertain:
            known.append(joined)
        else:
            unknown.append(joined)
    outputs = {}
    for name, values in (("flood-all-zones", all_rows), ("flood-one-percent", selected),
                         ("flood-known-coverage", known), ("flood-unknown-context", unknown)):
        path = folder / (name + ".geojson")
        outputs[name] = {"path": path.relative_to(directory).as_posix(), **_write_geojson(path, values)}
    atomic_json(folder / "flood-classification.json", {
        "schema": "upstate.original-flood-hazard-classification/v1",
        "source": source,
        "fields": {"sfha": sfha, "zone": zone, "subtype": subtype},
        "one_percent_selection": {sfha: "T"},
        "known_negative": {
            "selection": {sfha: "F"},
            "excluded": ["Zone D", "missing zone", "unmapped/unknown/not-studied/area-not-included subtype"],
        },
        "rows": [{"id": row["id"], "attributes": row["properties"]} for row in all_rows],
    })
    outputs["flood-table"] = {"path": "floodplains/flood-classification.json", "rows": len(all_rows)}
    return {
        "outputs": outputs, "source": source, "polygons": len(all_rows),
        "one_percent_polygons": len(selected), "known_coverage_polygons": len(known),
        "unknown_context_polygons": len(unknown), "original_zone_counts": dict(zone_counts),
        "definition": {
            "one_percent": "Original FEMA NFHL SFHA_TF equals the exact native string T",
            "known_negative": "Original SFHA_TF=F in a known mapped zone; exclude D, unmapped and unknown areas",
            "outside_known_coverage": "Unresolved classification, retained as unknown in parcel criteria",
            "reference": request.get("service_uri", FEMA_URI),
        },
    }



def _reuse_candidates(workspace, family):
    roles = (
        {"SOIL_K_NATIVE", "SOIL_MAPUNITS", "SSURGO_MAPUNITS", "MUPOLYGON"}
        if family == "soils" else {"FEMA_FLOOD_HAZARD_AREAS"})
    found = []
    for edition in workspace.sources():
        for entry in edition["entries"]:
            if entry.get("kind") != "vector" or str(entry.get("role", "")).upper() not in roles:
                continue
            choice = {"source_collection_id": edition["id"], "source_id": entry["id"]}
            for key in ("layer", "id_field"):
                if entry.get(key):
                    choice[key] = entry[key]
            found.append({
                "source": choice, "title": entry["title"], "uri": entry["uri"],
                "role": entry.get("role"), "vintage": entry["vintage"],
                "captured_at": str(edition.get("captured_at", "")),
                "body_sha256": entry["body"]["sha256"],
                "mukey_field": "MapUnitKey" if entry.get("role") == "SOIL_K_NATIVE" else "MUKEY",
            })
    return sorted(found, key=lambda row: (
        row["captured_at"], row["source"]["source_collection_id"], row["source"]["source_id"]))

def _source_spec(workspace, value):
    if not isinstance(value, dict):
        raise ValueError("Supply the actual retained source acquisition selection")
    result = _copy(value)
    if result.get("schema", SCHEMA) != SCHEMA:
        raise ValueError("Unknown soil/floodplain source selection schema")
    result["schema"] = SCHEMA
    title = result.get("title", "Original hydric soils and one-percent floodplain context")
    if not isinstance(title, str) or not title.strip():
        raise ValueError("Give the source acquisition a title")
    result["title"] = title.strip()
    selected = result.get("families", ["soils", "floodplains"])
    if (not isinstance(selected, list) or not selected
            or len(selected) != len(set(selected))
            or set(selected) - {"soils", "floodplains"}):
        raise ValueError("Select distinct original source families: soils, floodplains")
    result["families"] = [family for family in ("soils", "floodplains") if family in selected]
    reuse_bindings = {}
    for family in result["families"]:
        request = result.get(family, {})
        if not isinstance(request, dict):
            raise ValueError(family + " source settings must be an object")
        request = _copy(request)
        reuse_existing = request.get("reuse_existing", True)
        if not isinstance(reuse_existing, bool):
            raise ValueError("reuse_existing must be true or false")
        request["reuse_existing"] = reuse_existing
        if reuse_existing and not request.get("reuse_source") and not request.get("reuse_capture_root"):
            candidates = _reuse_candidates(workspace, family)
            if candidates:
                chosen = candidates[-1]
                request["reuse_source"] = chosen["source"]
                request["reuse_selection"] = {
                    "rule": "Matching original vector role, latest capture, stable retained source identity",
                    "source": chosen,
                }
                if family == "soils":
                    request.setdefault("mukey_field", chosen["mukey_field"])
        if request.get("reuse_source"):
            request["reuse_source"] = conservation._choice(
                request["reuse_source"], "original " + family + " geometry")
            _, reuse_bindings[family] = conservation._source(workspace, request["reuse_source"])
        if family == "soils":
            if request.get("reuse_capture_root"):
                if request.get("reuse_source"):
                    raise ValueError("Select one existing original soil vector or one original soil capture")
                binding = _capture_binding(request["reuse_capture_root"])
                request["reuse_capture_root"] = binding["capture_root"]
                reuse_bindings[family] = binding
            request["hydric_selection"] = request.get("hydric_selection", "full")
            if request["hydric_selection"] not in ("full", "predominant", "any_component"):
                raise ValueError("Choose the explicit full, predominant or any_component hydric interpretation")
            request["mukey_field"] = request.get("mukey_field", "MUKEY")
            if not isinstance(request["mukey_field"], str) or not request["mukey_field"].strip():
                raise ValueError("Name the original soil MUKEY column")
        else:
            source_uri = request.get("service_uri", FEMA_URI)
            if not isinstance(source_uri, str):
                raise ValueError("Select an original FEMA service URI")
            request["service_uri"] = source_uri.rstrip("/")
            if request["service_uri"] not in (
                    FEMA_URI,
                    "https://hazards.fema.gov/gis/nfhl/rest/services/public/NFHL/MapServer/28"):
                raise ValueError("Use an original FEMA NFHL layer 28 URI, or select an imported original source")
            page_size = request.get("page_size", 50)
            if isinstance(page_size, bool) or not isinstance(page_size, int) or not 1 <= page_size <= 500:
                raise ValueError("FEMA original feature page size must be an integer from 1 to 500")
            request["page_size"] = page_size
        default_width = 0.125 if family == "soils" else 0.5
        width = _number(request.get("tile_degrees", default_width))
        if width is None or not 0.01 <= width <= 2:
            raise ValueError("Native query tile size must be between 0.01 and 2 geographic degrees")
        request["tile_degrees"] = width
        result[family] = request
    for unused in {"soils", "floodplains"} - set(result["families"]):
        result.pop(unused, None)
    # Retry affects only another preserved attempt after a failed request.
    # Successful original responses and scientific selection remain unchanged.
    retry = result.pop("retry_failed", False)
    if not isinstance(retry, bool):
        raise ValueError("retry_failed must be true or false")
    if result.get("capture_tag") is not None:
        if not isinstance(result["capture_tag"], str) or not result["capture_tag"].strip():
            raise ValueError("A new original source edition tag must be nonempty text")
        result["capture_tag"] = result["capture_tag"].strip()
    return result, retry, reuse_bindings


def _file(directory, path):
    target = directory / path
    return {"path": target.relative_to(directory).as_posix(), "bytes": target.stat().st_size,
            "sha256": _hash_file(target)}


def _companions(directory, folder, exclude=()):
    result = []
    excluded = set(exclude)
    for target in sorted((directory / folder).rglob("*")):
        if target.is_file():
            relative = target.relative_to(directory).as_posix()
            if relative not in excluded:
                result.append(_file(directory, relative))
    return result


def _original_manifest(state, directory, completed, continuation_files=()):
    entries = []
    source_scope = {
        "operation_id": state["id"], "domain": state["selection"]["domain"],
        "query_domain_sha256": state["selection"]["query_domain_sha256"],
        "study_id": state["selection"]["request"].get("study_id"),
        "families": sorted(completed),
        "interpretation": "Original dataset attributes and polygons with positive area intersection "
                          "with the retained source domain; all source HTTP responses remain companions.",
    }
    labels = {
        "soil-mapunits": ("Original soil map-unit polygons and full component classification", "SOIL_MAPUNITS"),
        "soil-query-coverage": ("Actual original soil query AOI coverage", "SOIL_QUERY_COVERAGE"),
        "hydric-full": ("Confirmed fully hydric original map-unit polygons", "HYDRIC_FULL_CONTEXT"),
        "hydric-certainty": ("Confirmed hydric or nonhydric map-unit certainty coverage", "HYDRIC_CERTAINTY_COVERAGE"),
        "hydric-predominant": ("Map units with published hydric percent at least 66", "HYDRIC_PREDOMINANT_CONTEXT"),
        "hydric-any-component": ("Map units with a positive published hydric percent", "HYDRIC_ANY_COMPONENT_CONTEXT"),
        "hydric-rated-coverage": ("Map units with an original known hydric percentage", "HYDRIC_RATED_COVERAGE"),
        "hydric-table": ("Original map-unit attributes and all soil components", "HYDRIC_COMPONENTS"),
        "flood-all-zones": ("Original FEMA flood-zone context in the retained domain", "FEMA_FLOOD_HAZARD_AREAS"),
        "flood-one-percent": ("Original FEMA one-percent flood-hazard selection", "FEMA_ONE_PERCENT_CONTEXT"),
        "flood-known-coverage": ("Original FEMA known mapped flood-zone coverage", "FLOODPLAIN_CLASS_COVERAGE"),
        "flood-unknown-context": ("Original FEMA undetermined or unmapped flood-zone context", "FLOODPLAIN_UNKNOWN_CONTEXT"),
        "flood-table": ("Original FEMA flood-zone classification attributes", "FEMA_FLOOD_CLASSIFICATION"),
    }
    for family, result in completed.items():
        for name, output in result["outputs"].items():
            title, role = labels[name]
            table = name.endswith("-table")
            source_uri = SDA_URI if family == "soils" else result["source"]["original_uri"]
            entry = {
                "id": name, "title": title, "kind": "table" if table else "vector",
                "role": role, "uri": source_uri,
                "vintage": result["captured_at"] + "; original response timestamps and native source editions retained",
                "path": output["path"], "sha256": _file(directory, output["path"])["sha256"],
                "units": "Original map-unit attributes and component percentages" if family == "soils"
                         else "Original FEMA zone attributes and polygon geometry",
                "scope": source_scope,
                "metadata": {
                    "original_source": result["source"], "classification_definition": result["definition"],
                    "feature_count": output.get("features"), "row_count": output.get("rows"),
                    "native_identity_preserved": True,
                    "representation": "EPSG:4326 geometry with original native IDs and original source attributes",
                },
            }
            if not table:
                entry["id_field"] = "soil_polygon_id" if family == "soils" else "flood_polygon_id"
            if family == "soils" and "soil-query-coverage" in result["outputs"]:
                entry["metadata"]["query_coverage_source_id"] = "soil-query-coverage"
            # One complete original source companion set per family is sufficient.
            # Other entries reference that retained family through the collection.
            if table:
                entry["companions"] = _companions(directory, family, [output["path"]])
            entries.append(entry)
    entries.append({
        "id": "soil-floodplain-source-selection",
        "title": "Exact original soil/floodplain source acquisition selection",
        "kind": "document", "role": "SOIL_FLOODPLAIN_SELECTION",
        "uri": "urn:upstate:soil-floodplain-source-acquisition:" + state["id"],
        "vintage": state["created_at"], "path": "selection.json",
        "sha256": _file(directory, "selection.json")["sha256"],
        "companions": [_file(directory, "domain.geojson"),
                       *[_file(directory, path.relative_to(directory).as_posix())
                         for path in continuation_files]],
        "scope": source_scope,
    })
    return {
        "schema": "upstate.sources/v1", "title": state["title"] + " - original source edition",
        "captured_at": state["created_at"], "entries": entries, "scope": source_scope,
        "notes": [
            "Original response bodies, source metadata, request parameters and native IDs are retained.",
            "Hydric percentages describe original map-unit composition; component locations are not mapped by these polygons.",
            "Known negative criterion coverage is preserved separately from selected positive footprints.",
        ],
    }


def _criteria_manifest(state, directory, completed, original_collection):
    entries, bindings, coverage = [], {}, {}
    scope = {
        "operation_id": state["id"],
        "original_source_collection_id": original_collection,
        "domain": state["selection"]["domain"],
        "query_domain_sha256": state["selection"]["query_domain_sha256"],
        "study_id": state["selection"]["request"].get("study_id"),
    }
    if "soils" in completed:
        result = completed["soils"]
        choice = state["selection"]["request"]["soils"]["hydric_selection"]
        names = {"full": "hydric-full", "predominant": "hydric-predominant",
                 "any_component": "hydric-any-component"}
        coverage_name = "hydric-certainty" if choice == "full" else "hydric-rated-coverage"
        name = names[choice]
        meaning = {
            "full": "Area of original map-unit polygons with hydclprs=100 and only Yes component ratings; "
                    "confirmed absence requires original fully nonhydric or fully hydric certainty coverage.",
            "predominant": "Area of whole original map-unit polygons whose published hydclprs is at least 66; "
                           "this retained map-unit interpretation does not locate individual hydric components.",
            "any_component": "Area of whole original map-unit polygons whose published hydclprs is positive; "
                             "this retained map-unit interpretation does not locate individual hydric components.",
        }[choice]
        entry = {
            "id": "hydric-soils-" + choice,
            "title": "Original SSURGO hydric soil criterion - " + choice.replace("_", " "),
            "kind": "vector", "role": "HYDRIC_SOILS", "uri": SDA_URI,
            "vintage": result["captured_at"], "path": result["outputs"][name]["path"],
            "sha256": _file(directory, result["outputs"][name]["path"])["sha256"],
            "id_field": "soil_polygon_id", "units": "Original selected map-unit footprint",
            "scope": {**scope, "hydric_interpretation": choice},
            "metadata": {
                "parcel_criteria": {
                    "reference": SDA_SCHEMA,
                    "meaning": meaning,
                    "relation": "Positive area intersection with the original selected map-unit footprint",
                },
                "hydric_interpretation": choice, "original_classification": result["definition"],
                "component_table": {"source_collection_id": original_collection, "source_id": "hydric-table"},
                "original_mapunits": {"source_collection_id": original_collection, "source_id": "soil-mapunits"},
                "geometry_scope": scope,
            },
            "companions": [_file(directory, result["outputs"]["hydric-table"]["path"])],
        }
        count = result["outputs"][coverage_name]["features"]
        if count:
            entry["metadata"]["criteria_coverage"] = {
                "source": {"source_collection_id": original_collection, "source_id": coverage_name}}
        coverage["hydric_soils"] = {
            "selected_polygons": result["outputs"][name]["features"],
            "known_coverage_polygons": count, "interpretation": choice,
            "outside_known_coverage": "unknown",
            "original_source_collection_id": original_collection,
            "source_id": coverage_name if count else None,
            "mapunit_class_counts": result["hydric_classes"],
            "certainty_class_counts": result["certainty_classes"],
        }
        entries.append(entry)
        bindings["hydric_soils"] = entry["id"]
    if "floodplains" in completed:
        result = completed["floodplains"]
        output = result["outputs"]["flood-one-percent"]
        entry = {
            "id": "floodplain-one-percent", "title": "Original FEMA one-percent floodplain criterion",
            "kind": "vector", "role": "FLOODPLAIN_ONE_PERCENT", "uri": result["source"]["original_uri"],
            "vintage": result["captured_at"], "path": output["path"],
            "sha256": _file(directory, output["path"])["sha256"],
            "id_field": "flood_polygon_id", "units": "Original SFHA_TF=T footprint",
            "scope": scope,
            "metadata": {
                "parcel_criteria": {
                    "reference": result["source"]["original_uri"],
                    "meaning": "Original FEMA flood-hazard polygons with exact SFHA_TF=T; known negatives "
                               "come from original mapped F zones and exclude D, unmapped and unknown areas.",
                    "relation": "Positive area intersection with original SFHA_TF=T polygons",
                },
                "original_classification": result["definition"],
                "zone_table": {"source_collection_id": original_collection, "source_id": "flood-table"},
                "original_zones": {"source_collection_id": original_collection, "source_id": "flood-all-zones"},
                "geometry_scope": scope,
            },
            "companions": [_file(directory, result["outputs"]["flood-table"]["path"])],
        }
        count = result["known_coverage_polygons"]
        if count:
            entry["metadata"]["criteria_coverage"] = {
                "source": {"source_collection_id": original_collection, "source_id": "flood-known-coverage"}}
        coverage["floodplains"] = {
            "selected_polygons": output["features"], "known_coverage_polygons": count,
            "outside_known_coverage": "unknown",
            "original_source_collection_id": original_collection,
            "source_id": "flood-known-coverage" if count else None,
            "unknown_context_polygons": result["unknown_context_polygons"],
            "original_zone_counts": result["original_zone_counts"],
        }
        entries.append(entry)
        bindings["floodplains"] = entry["id"]
    return {
        "schema": "upstate.sources/v1", "title": state["title"] + " - parcel criterion edition",
        "captured_at": state["created_at"], "entries": entries, "scope": scope,
        "notes": [
            "Selected footprints bind actual retained certainty coverage from the original source edition.",
            "The exact original source definition remains visible in parcel criterion provenance.",
            "Use returned builder_sources to select this edition when multiple imported source editions exist.",
        ],
    }, bindings, coverage


def _implementation():
    capture_path = Path(_overlays().__file__)
    result = {
        "source_tools.soil_floodplain_sources": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
        "source_tools.source_response_reuse": hashlib.sha256(
            Path(source_response_reuse.__file__).read_bytes()).hexdigest(),
        "source.capture_original_overlays": hashlib.sha256(capture_path.read_bytes()).hexdigest(),
        "source.capture_upstream_network": hashlib.sha256(
            (capture_path.parent / "capture_upstream_network.py").read_bytes()).hexdigest(),
    }
    soil_reader = Path(__file__).with_name("soil_sources.py")
    if soil_reader.is_file():
        result["source_tools.soil_sources"] = hashlib.sha256(soil_reader.read_bytes()).hexdigest()
    return result


def _verify_family(directory, record):
    from model.common import verify_file
    for descriptor in record["files"]:
        verify_file(directory, descriptor)
    return record["result"]


def _family_record(directory, family, result):
    record = {
        "schema": "upstate.original-source-family/v1", "family": family,
        "completed_at": now(), "result": result,
        "files": _companions(directory, family),
    }
    atomic_json(directory / (family + "-result.json"), record, immutable=True)
    return record


def _bindings(manifest, edition_id, names):
    by_id = {entry["id"]: entry for entry in manifest["entries"]}
    result = {}
    for role, source_id in names.items():
        entry = by_id[source_id]
        choice = {
            "source_collection_id": edition_id, "source_id": source_id,
            "id_field": entry["id_field"],
            **_copy(entry["metadata"]["parcel_criteria"]),
        }
        coverage = entry["metadata"].get("criteria_coverage")
        if coverage:
            choice["coverage"] = _copy(coverage)
        result[role] = choice
    return result


def _edition_metadata(workspace, result, *, implementation=None, successors=None,
                      state=None, states=None):
    folder = workspace.root / "soil-floodplain-sources" / identifier(result["id"])
    state = read_json(folder / "state.json") if state is None else state
    selected = state["selection"]
    implementation = _implementation() if implementation is None else implementation
    successors = source_response_reuse.children(folder.parent) if successors is None else successors
    result = {**result, "implementation_changed": selected["implementation"] != implementation,
              "continued_as": successors.get(result["id"], [])}
    continuation = source_response_reuse.details(folder, state=state, states=states)
    if continuation is not None:
        result["continuation"] = continuation
    return result


def inspect(workspace, operation_id):
    key = identifier(operation_id)
    folder = workspace.root / "soil-floodplain-sources" / key
    state = read_json(folder / "state.json")
    if state["state"] == "running":
        result = _state_summary(state)
    elif (folder / "result.json").exists():
        result = {**read_json(folder / "result.json"), "progress": state.get("progress"),
                  "updated_at": state.get("updated_at")}
    else:
        result = state
    return _edition_metadata(workspace, result, state=state)


def _state_summary(state):
    """Return operator polling fields without loading original source bodies."""
    selection = state.get("selection", {})
    return {
        key: value for key, value in {
            "id": state["id"], "title": state["title"], "state": state["state"],
            "created_at": state["created_at"], "updated_at": state["updated_at"],
            "study_id": selection.get("request", {}).get("study_id"),
            "families": state.get("families", {}), "progress": state.get("progress"),
            "source_collection_id": state.get("source_collection_id"),
            "original_source_collection_id": state.get("original_source_collection_id"),
        }.items()
    }

def overview(workspace):
    root = workspace.root / "soil-floodplain-sources"
    implementation = _implementation()
    states = {
        path.parent.name: read_json(path) for path in sorted(root.glob("*/state.json"))
        if re.fullmatch(r"[0-9a-f]{64}", path.parent.name)
    } if root.exists() else {}
    successors = source_response_reuse.children(root, states=states)
    return {
        "schema": "upstate.soil-floodplain-overview/v1",
        "operations": [
            _edition_metadata(workspace, _state_summary(state),
                              implementation=implementation, successors=successors,
                              state=state, states=states)
            for state in states.values()
        ],
        "families": ["soils", "floodplains"],
        "hydric_interpretations": [
            {"id": "full", "title": "Fully hydric map units with original component confirmation", "default": True},
            {"id": "predominant", "title": "Whole map units with published hydric percentage at least 66"},
            {"id": "any_component", "title": "Whole map units with a positive published hydric percentage"},
        ],
        "references": [SDA_URI, SDA_HELP, SDA_SCHEMA, SDA_SPATIAL, HYDRIC_REFERENCE, FEMA_URI],
    }


def _resolved_geometry_capture(workspace, selection, family):
    """Locate the same complete original WKB capture after Workspace transfer."""
    from urllib.parse import urlencode
    original = selection["reused_sources"][family]
    request = selection["request"][family]
    root = workspace.root / "soil-floodplain-sources"
    directory = root / digest(selection)
    donors = source_response_reuse._lineage(root, selection)
    candidates = [Path(request["reuse_capture_root"]).expanduser(),
                  directory / "soils" / "original-geometry-capture",
                  *[folder / "soils" / "original-geometry-capture" for folder, _ in donors]]
    expected = {key: value for key, value in original.items() if key != "capture_root"}
    seen, failures = set(), []
    for candidate in candidates:
        candidate = candidate.resolve()
        if candidate in seen:
            continue
        seen.add(candidate)
        try:
            current = _capture_binding(candidate)
            if {key: value for key, value in current.items() if key != "capture_root"} != expected:
                continue
            captured = read_json(candidate / "geometry-capture.json")
            for tile in captured["tiles"]:
                for page in tile.get("pages", []):
                    name, sql = page.get("request"), page.get("sql")
                    if not isinstance(name, str) or not name or not isinstance(sql, str) or not sql:
                        raise ValueError("An original geometry page has no retained request and SQL")
                    folder = source_response_reuse._safe(candidate / "original",
                                                         candidate / "original" / name)
                    fields = {"QUERY": sql, "FORMAT": "JSON+COLUMNNAME+METADATA"}
                    payload = urlencode(sorted(fields.items())).encode("utf-8")
                    intent = {
                        "schema": "upstate.sda-request/v1", "url": SDA_URI, "method": "POST",
                        "content_type": "application/x-www-form-urlencoded", "fields": fields,
                        "request_sha256": hashlib.sha256(payload).hexdigest(),
                        "maximum_response_bytes": 64 * 1024 * 1024,
                    }
                    if read_json(folder / "request.json") != intent:
                        raise ValueError("An original geometry page selects another native query")
                    receipts = sorted(folder.glob("[0-9][0-9][0-9][0-9].capture.json"))
                    if not receipts:
                        raise ValueError("An original geometry page has no retained response")
                    receipt = read_json(receipts[-1])
                    if (receipt.get("state") != "complete" or receipt.get("status") != 200
                            or any(receipt.get(key) != value for key, value in intent.items()
                                   if key != "schema")):
                        raise ValueError("An original geometry page needs its complete successful response")
                    if receipt.get("receipt_file") != receipts[-1].name:
                        raise ValueError("An original geometry receipt has another file identity")
                    stored = receipt.get("stored_file")
                    if not isinstance(stored, str) or Path(stored).name != stored:
                        raise ValueError("An original geometry body has another file identity")
                    body = source_response_reuse._safe(folder, folder / stored)
                    source_response_reuse._verify(body, receipt.get("stored_bytes"),
                                                  receipt.get("stored_sha256"))
                    source_response_reuse._gzip_identity(body, receipt.get("bytes"), receipt.get("sha256"))
            return candidate
        except (OSError, ValueError, KeyError, TypeError) as error:
            failures.append(str(error))
    detail = "; ".join(dict.fromkeys(failures))[:1000]
    raise ValueError("The retained acquisition needs its byte-identical complete original SDA geometry capture. "
                     "Reopen a Workspace containing soils/original-geometry-capture and all original pages"
                     + (": " + detail if detail else "."))


def _retained_domain(workspace, selection, resolved_captures=None):
    from shapely import wkt
    request = selection["request"]
    geometry = wkt.loads(selection["query_domain_wkt"])
    if hashlib.sha256(geometry.wkb).hexdigest() != selection["query_domain_sha256"]:
        raise ValueError("The retained source acquisition query geometry differs")
    _, current_domain = _domain(workspace, request)
    if current_domain != selection["domain"]:
        raise ValueError("The retained source acquisition domain differs")
    for family, binding in selection["reused_sources"].items():
        if binding.get("mode") == "retained_sda_geometry_capture":
            resolved = _resolved_geometry_capture(workspace, selection, family)
            if resolved_captures is not None:
                resolved_captures[family] = resolved
            current = {**_capture_binding(resolved), "capture_root": binding["capture_root"]}
        else:
            _, current = conservation._source(workspace, request[family]["reuse_source"])
        if current != binding:
            raise ValueError("The reused original " + family + " source edition differs")
    return geometry


def _publish_acquisition(workspace, directory, selection, geometry):
    from shapely.geometry import mapping
    # Backup holds this lock before enumerating acquisition locks. Release it
    # before taking target/donor locks so the maintained import order is intact.
    with held(workspace.root / ".workspace.lock", blocking=False):
        directory.mkdir(parents=True, exist_ok=True)
        atomic_json(directory / "selection.json", selection, immutable=True)
        atomic_json(directory / "domain.geojson", {
            "type": "FeatureCollection",
            "crs": {"type": "name", "properties": {"name": "EPSG:4326"}},
            "features": [{"type": "Feature", "id": "original-query-domain",
                          "properties": {"source_operation_id": directory.name},
                          "geometry": mapping(geometry)}],
        }, immutable=True)


def continue_capture(workspace, operation_id, *, retry_failed=False):
    """Continue the original selection with current source tools and exact HTTP reuse.

    Repeated calls from the same predecessor and current implementation select
    the same successor. Original source choices are already resolved and are
    never run through the new-capture automatic source picker.
    """
    from shapely.geometry import mapping
    key = identifier(operation_id)
    root = workspace.root / "soil-floodplain-sources"
    previous = read_json(root / key / "selection.json")
    if digest(previous) != key:
        raise ValueError("The retained source acquisition identity differs")
    implementation = _implementation()
    if previous["implementation"] == implementation:
        return capture(workspace, key, retry_failed=retry_failed)
    geometry = _retained_domain(workspace, previous)
    selected = {**_copy(previous), "implementation": implementation, "continued_from": key}
    successor = digest(selected)
    directory = root / successor
    _publish_acquisition(workspace, directory, selected, geometry)
    return capture(workspace, successor, retry_failed=retry_failed)


def capture(workspace, value, *, retry_failed=False):
    """Capture/import original source families and return ready parcel bindings.

    A string resumes its retained operation. A dictionary binds a new or already
    existing scientific selection. Original successful requests are immutable;
    retry_failed permits another preserved attempt only for failed requests.
    """
    from model.common import verify_file
    from shapely import wkt
    from shapely.geometry import mapping
    resolved_captures = {}
    if isinstance(value, str):
        key = identifier(value)
        directory = workspace.root / "soil-floodplain-sources" / key
        selection = read_json(directory / "selection.json")
        if digest(selection) != key:
            raise ValueError("The retained source acquisition identity differs")
        if selection["implementation"] != _implementation():
            return continue_capture(workspace, key, retry_failed=retry_failed)
        geometry = _retained_domain(workspace, selection, resolved_captures)
        request = selection["request"]
    else:
        request, requested_retry, reuse_bindings = _source_spec(workspace, value)
        retry_failed = retry_failed or requested_retry
        geometry, domain = _domain(workspace, request)
        selection = {
            "schema": "upstate.original-soil-floodplain-acquisition/v1",
            "version": VERSION, "request": request, "domain": domain,
            "query_domain_wkt": geometry.wkt,
            "query_domain_sha256": hashlib.sha256(geometry.wkb).hexdigest(),
            "reused_sources": reuse_bindings, "implementation": _implementation(),
        }
        key = digest(selection)
        directory = workspace.root / "soil-floodplain-sources" / key
        _publish_acquisition(workspace, directory, selection, geometry)
    if not isinstance(retry_failed, bool):
        raise ValueError("retry_failed must be true or false")
    with source_response_reuse.locked(workspace, directory, selection) as response_reuse:
        state_path = directory / "state.json"
        if state_path.exists():
            state = read_json(state_path)
        else:
            state = {
                "schema": "upstate.soil-floodplain-state/v1", "id": key,
                "title": request["title"], "state": "prepared",
                "created_at": now(), "updated_at": now(),
                "selection": {name: item for name, item in selection.items() if name != "query_domain_wkt"},
                "families": {family: {"state": "pending"} for family in request["families"]},
                "publication_history": [],
            }
            atomic_json(state_path, state)
        if state["state"] == "complete" and (directory / "result.json").exists():
            result = read_json(directory / "result.json")
            for descriptor in result["files"].values():
                verify_file(workspace.root, descriptor)
            return _edition_metadata(workspace, result, state=state)
        state.update(state="running", updated_at=now())
        atomic_json(state_path, state)

        def progress(stage, completed_count, total_count, details=None):
            state.update(updated_at=now(), progress={
                "stage": stage, "completed": completed_count, "total": total_count,
                "details": details or {},
            })
            atomic_json(state_path, state)

        completed = {}
        for family in request["families"]:
            checkpoint = directory / (family + "-result.json")
            if checkpoint.exists():
                completed[family] = _verify_family(directory, read_json(checkpoint))
                state["families"][family] = {
                    "state": "complete", "polygons": completed[family]["polygons"],
                    "reused_completed_family": True,
                }
                continue
            state["families"][family] = {"state": "running", "started_at": now()}
            progress(family, 0, 1)
            try:
                function = _soils if family == "soils" else _floodplains
                effective = dict(request[family])
                effective.pop("_retained_capture_root", None)
                original_binding = selection["reused_sources"].get(family, {})
                if original_binding.get("mode") == "retained_sda_geometry_capture":
                    effective["_retained_capture_root"] = original_binding["capture_root"]
                if family in resolved_captures:
                    effective["reuse_capture_root"] = str(resolved_captures[family])
                result = function(workspace, effective, geometry, directory, retry_failed, progress,
                                  response_reuse=response_reuse)
                result["captured_at"] = now()
                _family_record(directory, family, result)
                completed[family] = result
                state["families"][family] = {
                    "state": "complete", "completed_at": now(),
                    "polygons": result["polygons"],
                }
            except Exception as error:
                state["families"][family] = {
                    "state": "failed", "failed_at": now(),
                    "error": {"type": type(error).__name__, "message": str(error)},
                    "retained_folder": (directory / family).relative_to(workspace.root).as_posix(),
                }
            state["updated_at"] = now()
            atomic_json(state_path, state)
        continuation_files = response_reuse.snapshot() if response_reuse is not None else []
        continuation_descriptors = {
            "continuation_" + str(index): describe_file(workspace.root, path)
            for index, path in enumerate(continuation_files)
        }
        status = "complete" if len(completed) == len(request["families"]) else "partial" if completed else "failed"
        if not completed:
            state.update(state=status, updated_at=now(), progress={
                "stage": "source_requests_incomplete", "completed": 0, "total": len(request["families"])})
            atomic_json(state_path, state)
            result = {
                "schema": "upstate.soil-floodplain-result/v1",
                "id": key, "title": state["title"], "state": status, "created_at": state["created_at"],
                "study_id": request.get("study_id"), "source_collection_id": None,
                "original_source_collection_id": None, "builder_sources": {}, "coverage": {},
                "families": state["families"],
                "files": {"selection": describe_file(workspace.root, directory / "selection.json"),
                          "domain": describe_file(workspace.root, directory / "domain.geojson"),
                          **continuation_descriptors},
            }
            atomic_json(directory / "result.json", result)
            return _edition_metadata(workspace, result, state=state)
        progress("import_original_sources", len(completed), len(request["families"]))
        original_manifest = _original_manifest(
            state, directory, completed, continuation_files +
            (response_reuse.unpublished_companions(completed) if response_reuse is not None else []))
        atomic_json(directory / "original-sources.json", original_manifest)
        original = workspace.import_sources(directory / "original-sources.json")
        criterion_manifest, names, coverage = _criteria_manifest(
            state, directory, completed, original["id"])
        atomic_json(directory / "criterion-sources.json", criterion_manifest)
        criterion = workspace.import_sources(directory / "criterion-sources.json")
        # Edition-specific manifest filenames keep every earlier partial import
        # reopenable after another family completes in the same operation.
        original_path = directory / ("original-sources-" + original["id"] + ".json")
        criterion_path = directory / ("criterion-sources-" + criterion["id"] + ".json")
        atomic_json(original_path, original_manifest, immutable=True)
        atomic_json(criterion_path, criterion_manifest, immutable=True)
        source_bindings = _bindings(criterion_manifest, criterion["id"], names)
        descriptors = {
            "selection": describe_file(workspace.root, directory / "selection.json"),
            "domain": describe_file(workspace.root, directory / "domain.geojson"),
            "original_manifest": describe_file(workspace.root, original_path),
            "criterion_manifest": describe_file(workspace.root, criterion_path),
            **continuation_descriptors,
        }
        builder_selection = {"sources": source_bindings}
        if request.get("study_id"):
            builder_selection["study_id"] = request["study_id"]
        result = {
            "schema": "upstate.soil-floodplain-result/v1",
            "id": key, "title": state["title"], "state": status, "created_at": state["created_at"],
            "study_id": request.get("study_id"),
            "source_collection_id": criterion["id"], "original_source_collection_id": original["id"],
            "source_ids": names, "builder_sources": source_bindings,
            "parcel_criteria_selection": builder_selection,
            "coverage": coverage,
            "families": state["families"],
            "domain": selection["domain"], "query_domain_sha256": selection["query_domain_sha256"],
            "counts": {
                family: {key: result[key] for key in (
                    "polygons", "mapunits", "hydric_classes", "certainty_classes",
                    "one_percent_polygons", "known_coverage_polygons", "unknown_context_polygons",
                    "original_zone_counts") if key in result}
                for family, result in completed.items()},
            "files": descriptors,
            "references": [SDA_URI, SDA_HELP, SDA_SCHEMA, SDA_SPATIAL, HYDRIC_REFERENCE, FEMA_URI],
        }
        publication = {
            "published_at": now(), "original_source_collection_id": original["id"],
            "source_collection_id": criterion["id"], "families": sorted(completed),
        }
        if not any(row.get("source_collection_id") == criterion["id"]
                   for row in state["publication_history"]):
            state["publication_history"].append(publication)
        publication_path = directory / "publications" / (criterion["id"] + ".json")
        if not publication_path.exists():
            atomic_json(publication_path, result, immutable=True)
        atomic_json(directory / "result.json", result)
        state.update(state=status, updated_at=now(),
                     source_collection_id=criterion["id"], original_source_collection_id=original["id"],
                     progress={"stage": status, "completed": len(completed), "total": len(request["families"])})
        atomic_json(state_path, state)
        return _edition_metadata(workspace, result, state=state)


def prepare(workspace, value):
    """Operator-compatible entry point for the original source acquisition."""
    return capture(workspace, value)


def parser():
    result = argparse.ArgumentParser(description=__doc__)
    result.add_argument("--workspace", required=True, type=Path)
    commands = result.add_subparsers(dest="command", required=True)
    action = commands.add_parser("capture", help="Capture/import actual original source selection")
    action.add_argument("selection", type=Path)
    action.add_argument("--retry-failed", action="store_true")
    action = commands.add_parser("resume", help="Continue the retained acquisition with current source tools and exact original responses")
    action.add_argument("operation_id")
    action.add_argument("--retry-failed", action="store_true")
    action = commands.add_parser("inspect", help="Read actual source state, bindings and coverage")
    action.add_argument("operation_id")
    commands.add_parser("overview")
    return result


def main(argv=None):
    from model.workspace import Workspace
    args = parser().parse_args(argv)
    workspace = Workspace(args.workspace)
    if args.command == "capture":
        result = capture(workspace, read_json(args.selection), retry_failed=args.retry_failed)
    elif args.command == "resume":
        result = continue_capture(workspace, args.operation_id, retry_failed=args.retry_failed)
    elif args.command == "inspect":
        result = inspect(workspace, args.operation_id)
    else:
        result = overview(workspace)
    print(json.dumps(result, indent=2, sort_keys=True, ensure_ascii=False, allow_nan=False))
    return 0 if result.get("state") not in ("partial", "failed") else 2


if __name__ == "__main__":
    raise SystemExit(main())
