"""Native same-DEM gauge catchments for retained annual-reference observations.

Uses the installed InVEST 3.20 DelineateIt implementation. D8 delineation is
explicitly distinct from nutrient/sediment transport routing.
"""
from __future__ import annotations
import argparse
import csv
import html
import importlib.metadata
import io
import json
import math
from pathlib import Path
import shutil
import sys
import zipfile

from .common import atomic_bytes, atomic_json, describe_file, digest, held, identifier, now, read_json, verify_file

SCHEMA = "upstate.calibration-catchments/v1"
SELECTION_SCHEMA = "upstate.calibration-catchment-selection/v1"
VERSION = 1
INVEST_VERSION = "3.20.0"
SOURCE_ID_PREFIX = "same-dem-gauge-catchments-"
METHOD = ("InVEST 3.20.0 DelineateIt: fill pits, D8 flow directions, optional nearest-stream "
          "pixel-window snapping, and full upstream D8 watershed delineation. "
          "This basin support is separate from NDR/SDR transport routing.")
SOURCE_URI = "https://github.com/natcap/invest/blob/3.20.0/src/natcap/invest/delineateit/delineateit.py"
MODEL_ROOT = Path(__file__).resolve().parents[1]


def _finite(value, label, *, positive=False):
    if isinstance(value, bool):
        raise ValueError(label + " must be a finite number")
    try:
        result = float(value)
    except (ValueError, TypeError) as error:
        raise ValueError(label + " must be a finite number") from error
    if not math.isfinite(result) or (positive and result <= 0):
        raise ValueError(label + " must be a finite " + ("positive " if positive else "") + "number")
    return result


def _source(workspace, selector):
    if not isinstance(selector, dict) or not selector.get("id_field"):
        raise ValueError("Choose the original basin source and its catchment identifier field")
    path, entry = workspace.source_file(identifier(selector["source_collection_id"]), selector["source_id"])
    if entry["kind"] != "vector":
        raise ValueError("The original catchment source must be a retained vector")
    return path, entry


def _observation(workspace, key):
    value = workspace._get("observations", identifier(key))
    verify_file(workspace.root, {"path": value["original"]["object"],
                               "bytes": value["original"]["bytes"], "sha256": value["original"]["sha256"]})
    return value


def _original_coordinates(observed, selection):
    carrier = selection.get("coordinate_carrier", "source_records")
    if carrier not in ("source_records", "original"):
        raise ValueError("Choose original CSV row or source_records metadata as the coordinate carrier")
    if selection.get("coordinate_crs", "EPSG:4326") != "EPSG:4326":
        raise ValueError("This coordinate adapter requires explicitly declared WGS84 longitude/latitude")
    lon_field = selection.get("longitude_field") or "longitude"
    lat_field = selection.get("latitude_field") or "latitude"
    expected = selection.get("catchment_ids")
    if expected is not None and (not isinstance(expected, list) or not expected
            or any(not isinstance(v, str) or not v for v in expected)
            or len(set(expected)) != len(expected)):
        raise ValueError("Select original catchment identifiers once each")
    groups = {}
    for row in observed["rows"]:
        key = row["catchment_id"]
        if expected is not None and key not in expected:
            continue
        raw = row.get(carrier)
        if not isinstance(raw, dict):
            raise ValueError("The chosen coordinate carrier is missing from an original observation row")
        lon = _finite(raw.get(lon_field), "Original longitude for " + key)
        lat = _finite(raw.get(lat_field), "Original latitude for " + key)
        if not (-180 <= lon <= 180 and -90 <= lat <= 90):
            raise ValueError("Original longitude/latitude is outside its geographic range: " + key)
        group = groups.setdefault(key, {"catchment_id": key, "longitude": lon, "latitude": lat,
            "original_longitude_value": raw[lon_field], "original_latitude_value": raw[lat_field],
            "source_record_id": row["id"], "observation_record_ids": [], "station_ids": []})
        if (group["longitude"], group["latitude"]) != (lon, lat):
            raise ValueError("This catchment has multiple retained outlet locations. Select a consistent "
                             "observation edition before delineation: " + key)
        group["observation_record_ids"].append(row["id"])
        if row["station_id"] not in group["station_ids"]:
            group["station_ids"].append(row["station_id"])
    if not groups or expected is not None and set(groups) != set(expected):
        raise ValueError("Select catchments present in the original observation edition")
    return [groups[key] for key in sorted(groups)], carrier, lon_field, lat_field


def _grid(workspace, key):
    import rasterio
    from pyproj import CRS
    grid = workspace.get_grid(identifier(key))
    directory = workspace.root / "grids" / grid["id"]
    dem = verify_file(directory, grid["files"]["DEM"])
    with rasterio.open(dem) as raster:
        crs = CRS.from_user_input(raster.crs)
        if (not crs.is_projected or not crs.axis_info
                or any(not math.isclose(a.unit_conversion_factor, 1.0, abs_tol=1e-12)
                       for a in crs.axis_info[:2])):
            raise ValueError("Use a saved native grid in projected metres for gauge delineation")
        transform = raster.transform
        if (raster.count != 1 or transform.b != 0 or transform.d != 0
                or transform.a <= 0 or transform.e >= 0
                or not math.isclose(transform.a, -transform.e, rel_tol=1e-9)):
            raise ValueError("Use a north-up square-pixel saved DEM, with one elevation band")
        info = {"crs": crs.to_string(), "crs_wkt": crs.to_wkt(),
                "width": raster.width, "height": raster.height,
                "pixel_size_m": transform.a, "pixel_area_m2": abs(transform.a * transform.e),
                "nodata": raster.nodata if raster.nodata is None or math.isfinite(raster.nodata) else str(raster.nodata),
                "bounds": list(raster.bounds), "transform": list(transform)[:6]}
    return grid, dem, info


def preview(workspace, selection):
    import rasterio
    from pyproj import Transformer
    from rasterio.windows import Window
    if not isinstance(selection, dict) or selection.get("schema", SELECTION_SCHEMA) != SELECTION_SCHEMA:
        raise ValueError("Use the retained gauge catchment selection")
    allowed = {"schema", "title", "grid_id", "observation_id", "original_catchments",
               "coordinate_carrier", "coordinate_crs", "longitude_field", "latitude_field", "catchment_ids", "snap_points",
               "stream_area_ha", "snap_distance_cells", "notes"}
    if set(selection) - allowed:
        raise ValueError("Unknown gauge delineation settings: " + ", ".join(sorted(set(selection) - allowed)))
    if not isinstance(selection.get("notes", ""), str):
        raise ValueError("Retain interpretation notes as readable text")
    observed = _observation(workspace, selection["observation_id"])
    points, carrier, lon_field, lat_field = _original_coordinates(observed, selection)
    grid, dem, info = _grid(workspace, selection["grid_id"])
    original_path, original_entry = _source(workspace, selection["original_catchments"])
    from . import rasters
    from shapely.geometry import box
    original_features, _ = rasters.vector_geometry(original_path,
        layer=selection["original_catchments"].get("layer") or original_entry.get("layer"),
        where=selection["original_catchments"].get("where"), target_crs=info["crs_wkt"])
    original_basins = {}
    expected_ids = {row["catchment_id"] for row in points}
    for feature in original_features:
        key = str(feature["properties"].get(selection["original_catchments"]["id_field"], ""))
        if key not in expected_ids:
            continue
        if key in original_basins or feature["geometry"].geom_type not in ("Polygon", "MultiPolygon"):
            raise ValueError("Choose one original polygon per catchment: " + key)
        geometry = feature["geometry"]
        if geometry.area <= 0:
            raise ValueError("Original basin area must be positive: " + key)
        original_basins[key] = {"area_ha": geometry.area / 10000,
            "fraction_within_dem_rectangle": geometry.intersection(box(*info["bounds"])).area / geometry.area}
    if set(original_basins) != expected_ids:
        raise ValueError("The original polygon source omits selected observation catchments: " +
                         ", ".join(sorted(expected_ids - set(original_basins))))
    snap = selection.get("snap_points", False)
    if not isinstance(snap, bool):
        raise ValueError("Choose whether to snap outlet points")
    settings = {"snap_points": snap}
    if snap:
        area = _finite(selection.get("stream_area_ha"), "Stream initiation area in hectares", positive=True)
        distance = selection.get("snap_distance_cells")
        if isinstance(distance, bool) or not isinstance(distance, int) or distance < 1:
            raise ValueError("Stream search distance must be a positive whole number of grid cells")
        settings.update(stream_area_ha=area, flow_threshold_cells=math.ceil(area * 10000 / info["pixel_area_m2"]),
                        snap_distance_cells=distance,
                        search_window_distance_m=distance * info["pixel_size_m"])
    transform = Transformer.from_crs("EPSG:4326", info["crs_wkt"], always_xy=True)
    rows = []
    with rasterio.open(dem) as raster:
        for point in points:
            x, y = transform.transform(point["longitude"], point["latitude"])
            inside = math.isfinite(x) and math.isfinite(y)
            row, col = raster.index(x, y) if inside else (-1, -1)
            inside = inside and 0 <= row < raster.height and 0 <= col < raster.width
            valid = False
            if inside:
                value = raster.read(1, window=Window(col, row, 1, 1), masked=True)
                valid = not bool(value.mask[0, 0] if getattr(value.mask, "ndim", 0) else value.mask) and math.isfinite(float(value[0, 0]))
            rows.append({**point, "original_projected_xy": [x, y] if math.isfinite(x) and math.isfinite(y) else None,
                         "row": row if inside else None, "column": col if inside else None,
                         "status": "ready" if valid else "outside_dem" if not inside else "dem_nodata",
                         "original_basin": original_basins[point["catchment_id"]]})
    normalized = {"schema": SELECTION_SCHEMA, "title": str(selection.get("title") or "Same-DEM gauge catchments"),
                  "grid_id": grid["id"], "observation_id": observed["id"],
                  "original_catchments": selection["original_catchments"],
                  "coordinate_carrier": carrier, "coordinate_crs": "EPSG:4326",
                  "longitude_field": lon_field, "latitude_field": lat_field,
                  "catchment_ids": [row["catchment_id"] for row in points], **settings,
                  "notes": selection.get("notes", "")}
    # Derived values are not part of the user selection schema.
    normalized.pop("flow_threshold_cells", None)
    normalized.pop("search_window_distance_m", None)
    return {"schema": SCHEMA, "version": VERSION, "selection": normalized, "grid": info,
            "grid_id": grid["id"], "dem": grid["files"]["DEM"], "dem_source": grid["inputs"]["DEM"],
            "observation_original": observed["original"], "original_catchment_body": original_entry["body"],
            "outlets": rows, "settings": settings, "can_build": all(row["status"] == "ready" for row in rows),
            "method": METHOD,
            "snapping_meaning": "Pixel search window; inspect actual outlet movement and stream membership. "
                                "A point can remain at its original grid cell when no stream is found."}


def _copy(source, target):
    target.parent.mkdir(parents=True, exist_ok=True)
    if target.exists():
        if describe_file(target.parent, target)["sha256"] != describe_file(source.parent, source)["sha256"]:
            raise ValueError("A retained native catchment file changed: " + target.name)
        return
    pending = target.with_name("." + target.name + ".pending")
    shutil.copyfile(source, pending)
    pending.replace(target)


def _vectors(path, *, layer=None):
    import fiona
    from shapely.geometry import shape
    from .rasters import vector_environment, native_vector_path
    with vector_environment(), fiona.open(native_vector_path(path), layer=layer) as source:
        return [{"properties": dict(row["properties"]), "geometry": shape(row["geometry"])} for row in source], source.crs_wkt


def _native_points(path, rows, crs_wkt):
    import fiona
    schema = {"geometry": "Point", "properties": {"catchment_id": "str", "source_record_id": "str",
              "station_ids": "str", "original_longitude": "float", "original_latitude": "float"}}
    from .rasters import vector_environment
    with vector_environment(), fiona.open(path, "w", driver="GPKG", schema=schema, crs_wkt=crs_wkt, layer="original_outlets") as sink:
        for row in rows:
            sink.write({"geometry": {"type": "Point", "coordinates": row["original_projected_xy"]},
                "properties": {key: row[key] for key in ("catchment_id", "source_record_id")} |
                {"station_ids": json.dumps(row["station_ids"], ensure_ascii=False),
                 "original_longitude": row["longitude"], "original_latitude": row["latitude"]}})


def _verify_points(path, rows, crs_wkt):
    from pyproj import CRS
    retained, actual_crs = _vectors(path, layer="original_outlets")
    wanted = {row["catchment_id"]: row for row in rows}
    actual = {row["properties"]["catchment_id"]: row for row in retained}
    if (len(actual) != len(retained) or set(actual) != set(wanted)
            or CRS.from_user_input(actual_crs) != CRS.from_user_input(crs_wkt)):
        raise ValueError("Original outlet vector identifiers or CRS changed")
    for key, value in actual.items():
        source, geometry, properties = wanted[key], value["geometry"], value["properties"]
        if (geometry.geom_type != "Point" or geometry.is_empty
                or [geometry.x, geometry.y] != source["original_projected_xy"]
                or properties["source_record_id"] != source["source_record_id"]
                or properties["station_ids"] != json.dumps(source["station_ids"], ensure_ascii=False)
                or properties["original_longitude"] != source["longitude"]
                or properties["original_latitude"] != source["latitude"]):
            raise ValueError("Original outlet geometry or source attributes changed: " + key)


def _edge_support(dem, geometry):
    """Count basin cells adjoining native DEM edge or nodata, with one-cell halos."""
    import numpy as np
    import rasterio
    from rasterio.features import geometry_mask
    from rasterio.windows import Window
    from shapely.geometry import mapping
    count = 0
    with rasterio.open(dem) as src:
        for _, window in src.block_windows(1):
            height, width = int(window.height), int(window.width)
            halo = Window(window.col_off - 1, window.row_off - 1, width + 2, height + 2)
            values = src.read(1, window=halo, boundless=True, masked=True)
            bad = np.ma.getmaskarray(values) | ~np.isfinite(values.data)
            adjacent = np.zeros((height, width), dtype=bool)
            for dy in range(3):
                for dx in range(3):
                    adjacent |= bad[dy:dy + height, dx:dx + width]
            basin = geometry_mask([mapping(geometry)], out_shape=(height, width),
                                  transform=src.window_transform(window), invert=True)
            count += int(np.count_nonzero(adjacent & basin))
    return count


def _svg_map(original, derived, points):
    geometries = list(original.values()) + list(derived.values())
    if not geometries:
        return ""
    bounds = [g.bounds for g in geometries if not g.is_empty]
    left, bottom = min(b[0] for b in bounds), min(b[1] for b in bounds)
    right, top = max(b[2] for b in bounds), max(b[3] for b in bounds)
    width, height, pad = 1000, 650, 30
    scale = min((width - 2 * pad) / max(right-left, 1), (height-2*pad) / max(top-bottom, 1))
    def xy(x, y):
        return pad+(x-left)*scale, height-pad-(y-bottom)*scale
    def path(geom):
        polygons = [geom] if geom.geom_type == "Polygon" else list(geom.geoms)
        values = []
        for polygon in polygons:
            for ring in [polygon.exterior, *polygon.interiors]:
                pts = [xy(*point[:2]) for point in ring.coords]
                values.append("M" + " L".join(format(x, ".4f") + "," + format(y, ".4f") for x,y in pts) + " Z")
        return " ".join(values)
    layers = []
    for key, geometry in original.items():
        layers.append('<path d="' + path(geometry) + '" fill="none" stroke="#888" stroke-dasharray="6 4"><title>'
                      + html.escape(key) + ' — original basin</title></path>')
    for key, geometry in derived.items():
        layers.append('<path d="' + path(geometry) + '" fill="#d5d5d5" fill-opacity=".6" fill-rule="evenodd" stroke="#222"><title>'
                      + html.escape(key) + ' — D8 basin</title></path>')
    for row in points:
        x,y = xy(*row["model_outlet_xy"])
        layers.append('<circle cx="' + str(x) + '" cy="' + str(y) + '" r="4" fill="#111"><title>'
                      + html.escape(row["catchment_id"]) + "</title></circle>")
    return '<svg xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Original and model DEM gauge basins" viewBox="0 0 1000 650">' + "".join(layers) + "</svg>"


def _report(analysis, original, derived):
    columns = [("catchment_id", "Original catchment"), ("area_ha", "D8 hectares"),
               ("original_area_ha", "Original hectares"), ("original_overlap_fraction", "Original basin overlap"),
               ("original_to_model_outlet_distance_m", "Outlet movement · m"),
               ("outlet_on_stream", "Outlet on stream"), ("edge_or_nodata_adjacent_cells", "Cells adjoining DEM edge/nodata")]
    def cell(value):
        return "—" if value is None else format(value, ".8g") if isinstance(value, float) else str(value)
    rows = "".join("<tr>" + "".join("<td>" + html.escape(cell(row.get(key))) + "</td>"
                   for key, _ in columns) + "</tr>" for row in analysis["outlets"])
    return ('<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
        '<title>' + html.escape(analysis["title"]) + '</title><style>body{font:15px system-ui,sans-serif;color:#222;'
        'max-width:1200px;margin:0 auto;padding:24px}p,li{line-height:1.5}svg{width:100%;height:auto;border:1px solid #bbb}'
        '.scroll{overflow:auto}table{border-collapse:collapse;width:100%}td,th{padding:9px;text-align:left;border-bottom:1px solid #ccc}'
        'a{color:#222}code{overflow-wrap:anywhere}@media print{body{font-size:10pt}}</style><h1>'
        + html.escape(analysis["title"]) + '</h1><p>' + html.escape(METHOD)
        + '</p><p>Dashed outline: original basin. Solid outline and gray fill: D8 basin. Black point: selected model outlet. '
        'Native projected coordinates: ' + html.escape(analysis["grid"]["crs"]) + '.</p>'
        + _svg_map(original, derived, analysis["outlets"])
        + '<div class="scroll"><table><thead><tr>' + "".join("<th>" + html.escape(title) + "</th>" for _,title in columns)
        + "</tr></thead><tbody>" + rows + "</tbody></table></div><h2>Scientific interpretation</h2><ul>"
        + "".join("<li>" + html.escape(note) + "</li>" for note in analysis["notes"])
        + '</ul><p><a href="analysis.json">Complete source and results</a> · <a href="catchments.geojson">Native basin geometry</a>'
        ' · <a href="outlets.csv">Outlet and area table</a></p></html>')


def _native_versions():
    from osgeo import gdal
    values = {key: importlib.metadata.version(key) for key in
              ("natcap.invest", "pygeoprocessing", "rasterio", "fiona", "pyproj", "shapely")}
    values["GDAL"] = gdal.VersionInfo("RELEASE_NAME")
    if values["natcap.invest"] != INVEST_VERSION:
        raise ValueError("This source producer uses InVEST3.20.0 DelineateIt; use the retained compatible native runtime")
    return values


def build(workspace, selection):
    from natcap.invest.delineateit import delineateit
    import fiona
    import rasterio
    from pyproj import CRS, Transformer, Geod
    from shapely.geometry import mapping
    from shapely.ops import transform as transform_geometry
    from . import rasters

    reviewed = preview(workspace, selection)
    if not reviewed["can_build"]:
        issues = [r["catchment_id"] + ": " + r["status"] for r in reviewed["outlets"] if r["status"] != "ready"]
        raise ValueError("Use a DEM covering these original outlets: " + "; ".join(issues))
    versions = _native_versions()
    versions["delineateit_source_sha256"] = describe_file(Path(delineateit.__file__).parent,
                                                       Path(delineateit.__file__))["sha256"]
    grid, dem, info = _grid(workspace, reviewed["grid_id"])
    observed = _observation(workspace, reviewed["selection"]["observation_id"])
    original_ref = reviewed["selection"]["original_catchments"]
    original_path, original_entry = _source(workspace, original_ref)
    identity = {"schema": SCHEMA, "version": VERSION, "selection": reviewed["selection"],
                "prepared_dem": reviewed["dem"], "dem_source": reviewed["dem_source"],
                "observation_original": reviewed["observation_original"],
                "original_catchment_body": reviewed["original_catchment_body"], "native_versions": versions,
                "producer_sha256": describe_file(MODEL_ROOT, Path(__file__))["sha256"]}
    key = digest(identity)
    directory = workspace.root / "calibration-catchment-exports" / key
    directory.mkdir(parents=True, exist_ok=True)
    with held(directory / ".build.lock", blocking=False):
        binding_path = directory / "source-binding.json"
        if binding_path.exists():
            return inspect(workspace, read_json(binding_path))
        atomic_json(directory / "input.json", identity, immutable=True)
        start = directory / "started.json"
        if not start.exists():
            atomic_json(start, {"created_at": now()}, immutable=True)
        created = read_json(start)["created_at"]
        native = directory / "native"
        native.mkdir(exist_ok=True)
        original_points = directory / "original-outlets.gpkg"
        points_valid = False
        if original_points.exists():
            try:
                _verify_points(original_points, reviewed["outlets"], info["crs_wkt"])
                points_valid = True
            except Exception:
                if (directory / "native-registry.json").exists():
                    raise
        if not points_valid:
            pending_points = directory / ".original-outlets.pending.gpkg"
            pending_points.unlink(missing_ok=True)
            _native_points(pending_points, reviewed["outlets"], info["crs_wkt"])
            _verify_points(pending_points, reviewed["outlets"], info["crs_wkt"])
            pending_points.replace(original_points)
        args = {"workspace_dir": str(native), "dem_path": str(dem),
                "outlet_vector_path": str(original_points), "detect_pour_points": False,
                "skip_invalid_geometry": False, "snap_points": reviewed["settings"]["snap_points"], "n_workers": -1}
        if args["snap_points"]:
            args.update(flow_threshold=reviewed["settings"]["flow_threshold_cells"],
                        snap_distance=reviewed["settings"]["snap_distance_cells"])
        atomic_json(directory / "native-arguments.json",
            {**args, "workspace_dir": "native", "dem_path": "prepared-dem.tif",
             "outlet_vector_path": "original-outlets.gpkg"}, immutable=True)
        registry_path = directory / "native-registry.json"
        if registry_path.exists():
            registry = read_json(registry_path)
            for item in registry.values():
                verify_file(directory, item)
        else:
            produced = delineateit.execute(args)
            registry = {name: describe_file(directory, Path(path)) for name,path in produced.items()
                        if Path(path).is_file() and Path(path).suffix.lower() in (".tif", ".gpkg")}
            required = {"watersheds", "filled_dem", "flow_direction", "preprocessed_geometries"}
            if args["snap_points"]:
                required |= {"snapped_outlets", "streams", "flow_accumulation"}
            if not required <= set(registry):
                raise ValueError("Native DelineateIt output registry is incomplete")
            atomic_json(registry_path, registry, immutable=True)
        basins, basin_crs = _vectors(verify_file(directory, registry["watersheds"]))
        outlet_key = "snapped_outlets" if args["snap_points"] else "preprocessed_geometries"
        native_points, point_crs = _vectors(verify_file(directory, registry[outlet_key]))
        expected = set(reviewed["selection"]["catchment_ids"])
        by_id = {r["properties"]["catchment_id"]: r["geometry"] for r in basins}
        points_by_id = {r["properties"]["catchment_id"]: r["geometry"] for r in native_points}
        if (len(by_id) != len(basins) or len(points_by_id) != len(native_points)
                or set(by_id) != expected or set(points_by_id) != expected):
            raise ValueError("Native delineation omitted or duplicated an original catchment/outlet")
        if CRS.from_user_input(basin_crs) != CRS.from_user_input(info["crs_wkt"]):
            raise ValueError("Native basin output CRS differs from the selected DEM")
        original_features, original_crs = rasters.vector_geometry(original_path,
            layer=original_ref.get("layer") or original_entry.get("layer"), where=original_ref.get("where"))
        convert = Transformer.from_crs(original_crs, info["crs_wkt"], always_xy=True).transform
        originals = {}
        for feature in original_features:
            oid = str(feature["properties"][original_ref["id_field"]])
            if oid not in expected:
                continue
            if oid in originals:
                raise ValueError("The original catchment field is not unique: " + oid)
            originals[oid] = transform_geometry(convert, feature["geometry"])
        if set(originals) != expected:
            raise ValueError("The original source omits a selected catchment")
        rows = []
        to_ll = Transformer.from_crs(info["crs_wkt"], "EPSG:4326", always_xy=True)
        point_transform = Transformer.from_crs(point_crs, info["crs_wkt"], always_xy=True)
        geod = Geod(ellps="WGS84")
        for point in reviewed["outlets"]:
            cid = point["catchment_id"]
            basin, original = by_id[cid], originals[cid]
            if basin.is_empty or not basin.is_valid or not original.is_valid or original.area <= 0:
                raise ValueError("Retain a valid nonempty original and derived polygon for " + cid)
            x,y = point_transform.transform(points_by_id[cid].x, points_by_id[cid].y)
            from shapely.geometry import Point
            if not basin.covers(Point(x,y)):
                raise ValueError("The native outlet is outside its own D8 basin: " + cid)
            lon,lat = to_ll.transform(x,y)
            _,_,distance = geod.inv(point["longitude"], point["latitude"], lon,lat)
            on_stream = None
            if args["snap_points"]:
                with rasterio.open(verify_file(directory, registry["streams"])) as src:
                    rr,cc = src.index(x,y)
                    if not (0 <= rr < src.height and 0 <= cc < src.width):
                        raise ValueError("Snapped outlet moved outside native raster bounds")
                    value = next(src.sample([(x,y)], masked=True))
                    import numpy as np
                    on_stream = not bool(np.ma.getmaskarray(value)[0]) and int(value[0]) == 1
            rows.append({**point, "model_outlet_xy": [x,y], "model_outlet_crs": info["crs"],
                "original_longitude": point["original_longitude_value"],
                "original_latitude": point["original_latitude_value"],
                "original_to_model_outlet_distance_m": abs(distance), "outlet_on_stream": on_stream,
                "area_ha": basin.area / 10000, "original_area_ha": original.area / 10000,
                "overlap_area_ha": basin.intersection(original).area / 10000,
                "original_overlap_fraction": basin.intersection(original).area / original.area,
                "edge_or_nodata_adjacent_cells": _edge_support(dem, basin)})
        body = {"type": "FeatureCollection", "name": "same_dem_gauge_catchments",
                "crs": {"type": "name", "properties": {"name": info["crs"]}},
                "features": [{"type": "Feature", "id": row["catchment_id"], "geometry": mapping(by_id[row["catchment_id"]]),
                              "properties": {k:row[k] for k in ("catchment_id", "area_ha", "original_area_ha",
                                  "original_overlap_fraction", "original_to_model_outlet_distance_m",
                                  "outlet_on_stream", "edge_or_nodata_adjacent_cells")}} for row in rows]}
        atomic_json(directory / "catchments.geojson", body, immutable=True)
        _copy(dem, directory / "prepared-dem.tif")
        _copy(original_path, directory / "original-catchments" /
              original_entry["body"].get("view_path", original_entry["body"]["filename"]))
        atomic_json(directory / "original-observation.json", observed, immutable=True)
        _copy(verify_file(workspace.root, {"path": observed["original"]["object"],
              "bytes": observed["original"]["bytes"], "sha256": observed["original"]["sha256"]}),
              directory / "original-observations.csv")
        atomic_json(directory / "original-catchment-entry.json", original_entry, immutable=True)
        for companion in original_entry.get("companions", []):
            path = verify_file(workspace.root, {"path": companion["object"], "bytes": companion["bytes"],
                                               "sha256": companion["sha256"]})
            _copy(path, directory / "original-catchments" / companion.get("view_path", companion["filename"]))
        producers = [describe_file(workspace.root, directory / "native-arguments.json"),
                     describe_file(workspace.root, directory / "input.json"),
                     describe_file(workspace.root, directory / "native-registry.json")]
        source_id = SOURCE_ID_PREFIX + key
        record = {"schema": "upstate.annual-reference-delineation/v1", "method": METHOD,
            "dem_source_sha256": grid["inputs"]["DEM"]["source_sha256"],
            "prepared_dem_sha256": grid["files"]["DEM"]["sha256"],
            "original_catchments_sha256": original_entry["body"]["sha256"],
            "derived_catchments_sha256": describe_file(directory, directory / "catchments.geojson")["sha256"],
            "catchment_selection": {"source_id": source_id, "id_field": "catchment_id"},
            "producer_files": producers, "native_versions": versions, "settings": reviewed["settings"],
            "coordinate_source": {key: reviewed["selection"][key] for key in
                                  ("coordinate_carrier", "coordinate_crs", "longitude_field", "latitude_field")},
            "outlets": rows}
        atomic_json(directory / "delineation-record.json", record, immutable=True)
        notes = [METHOD, reviewed["snapping_meaning"],
                 "The exact saved computational DEM is used, including its existing conditioning. "
                 "DelineateIt separately fills pits and retains that filled raster.",
                 "A basin adjoining the DEM boundary or nodata may have omitted upstream area. "
                 "Review its original-basin overlap and terrain extent before using it as a whole-catchment reference.",
                 "NLDI/publisher catchments remain unchanged beside this separate D8-derived edition. "
                 "Same terrain identity does not make D8 and MFD transport equivalent.",
                 str(reviewed["selection"].get("notes") or "")]
        notes = [n for n in notes if n]
        analysis = {"schema": SCHEMA, "version": VERSION, "id": key, "created_at": created,
            "title": reviewed["selection"]["title"], "selection": reviewed["selection"], "grid": info,
            "input": identity, "outlets": rows, "native_registry": registry, "notes": notes,
            "source_id": source_id,
            "observation_record_ids": [rid for row in rows for rid in row["observation_record_ids"]]}
        atomic_json(directory / "analysis.json", analysis, immutable=True)
        atomic_bytes(directory / "index.html", _report(analysis, originals, by_id).encode("utf-8"), immutable=True)
        stream = io.StringIO(newline="")
        writer = csv.DictWriter(stream, fieldnames=list(rows[0]))
        writer.writeheader()
        for row in rows:
            writer.writerow({k:json.dumps(v, ensure_ascii=False) if isinstance(v,(list,dict)) else v for k,v in row.items()})
        atomic_bytes(directory / "outlets.csv", stream.getvalue().encode("utf-8"), immutable=True)
        files = [describe_file(directory, p) for p in sorted(directory.rglob("*"))
                 if p.is_file() and not p.name.startswith(".") and "taskgraph_cache" not in p.parts
                 and p.name not in ("sources.json", "source-binding.json")
                 and p.suffix.lower() not in (".db", ".sqlite", ".sqlite3", ".log")]
        manifest = {"schema": "upstate.sources/v1", "title": analysis["title"],
            "captured_at": created, "notes": notes,
            "entries": [{"id": source_id, "title": analysis["title"], "kind": "vector", "role": "CATCHMENTS",
                "uri": "urn:upstate:calibration-catchments:" + key, "vintage": created,
                "path": "catchments.geojson", "sha256": record["derived_catchments_sha256"],
                "source_crs": info["crs"], "metadata": {"schema": SCHEMA, "operation_id": key,
                    "analysis_path": "analysis.json", "delineation_record_path": "delineation-record.json",
                    "source_method_uri": SOURCE_URI, "observation_id": observed["id"],
                    "grid_id": grid["id"], "prepared_dem_sha256": grid["files"]["DEM"]["sha256"]},
                "companions": [v for v in files if v["path"] != "catchments.geojson"]}]}
        atomic_json(directory / "sources.json", manifest, immutable=True)
        collection = workspace.import_sources(directory / "sources.json")
        binding = {"source_collection_id": collection["id"], "source_id": source_id, "id_field": "catchment_id"}
        atomic_json(binding_path, binding, immutable=True)
        return inspect(workspace, binding)


def inspect(workspace, selection):
    path, entry = _source(workspace, selection)
    if entry.get("metadata", {}).get("schema") != SCHEMA:
        raise ValueError("Select the retained same-DEM gauge catchment source")
    by_name = {v.get("view_path", v["filename"]): v for v in entry["companions"]}
    def member(name):
        item = by_name.get(name)
        if item is None:
            raise ValueError("The retained catchment edition omits " + name)
        return verify_file(path.parent, {"path": name, "bytes": item["bytes"], "sha256": item["sha256"]})
    analysis = read_json(member("analysis.json"))
    record_path = member("delineation-record.json")
    record = read_json(record_path)
    if (analysis["id"] != entry["metadata"]["operation_id"]
            or record["derived_catchments_sha256"] != entry["body"]["sha256"]
            or record["catchment_selection"] != {k:v for k,v in selection.items() if k != "source_collection_id"}):
        raise ValueError("The retained catchment source binding changed")
    return {"schema": SCHEMA, "id": analysis["id"], "title": analysis["title"], "analysis": analysis,
            "catchments": dict(selection), "observation_id": analysis["selection"]["observation_id"],
            "observation_record_ids": analysis["observation_record_ids"],
            "delineation_record": describe_file(workspace.root, record_path),
            "files": [{"path": str(member(name)), "original": item, "name": name}
                      for name,item in by_name.items() if name in
                      ("index.html", "analysis.json", "outlets.csv", "delineation-record.json",
                       "original-observation.json", "original-observations.csv", "prepared-dem.tif")
                      or name.startswith("native/")],
            "source_entry": entry}


def course_contract(workspace, selection):
    """Resolve this source against the actual saved grid in the current project."""
    value = inspect(workspace, selection)
    analysis = value["analysis"]
    grid = workspace.get_grid(analysis["selection"]["grid_id"])
    if grid["files"]["DEM"]["sha256"] != analysis["input"]["prepared_dem"]["sha256"]:
        raise ValueError("The current saved grid no longer matches the retained delineation DEM")
    sources = {}
    for role, prepared in grid["inputs"].items():
        _, entry = workspace.source_file(grid["spec"]["source_collection_id"],
                                         grid["spec"]["input_sources"][role])
        if prepared["source_sha256"] != entry["body"]["sha256"]:
            raise ValueError("The prepared grid and original source differ for " + role)
        sources[role] = entry["body"]["sha256"]
    for name in ("model_domain", "reporting_mask"):
        verify_file(workspace.root / "grids" / grid["id"], grid["files"][name])
    return {"schema": "upstate.annual-reference-input-contract/v1",
            "grid_id": grid["id"], "input_source_sha256": sources,
            "model_domain_sha256": grid["files"]["model_domain"]["sha256"],
            "reporting_mask_sha256": grid["files"]["reporting_mask"]["sha256"],
            "catchments_sha256": value["source_entry"]["body"]["sha256"],
            "delineation_record": value["delineation_record"],
            "interpretation": "Original observation edition and original basin geometry are retained. "
                + METHOD + " Inspect original/derived areas, DEM-edge support and outlet displacement "
                "before interpreting full-catchment annual totals. Model input vintages remain those "
                "of this exact saved grid; delineation does not turn simulated fields into measurements."}


def export(workspace, selection):
    """Package the exact original manifest and every original native member."""
    value = inspect(workspace, selection)
    collection = workspace._get("sources", identifier(selection["source_collection_id"]))
    original = collection["original_manifest"]
    manifest_path = verify_file(workspace.root, {"path": original["object"],
        "sha256": original["sha256"], "bytes": original["bytes"]})
    raw = read_json(manifest_path)
    if len(raw["entries"]) != 1 or raw["entries"][0]["id"] != selection["source_id"]:
        raise ValueError("This original producer source package must contain its single complete catchment edition")
    directory = workspace.root / "calibration-catchment-packages" / collection["id"]
    directory.mkdir(parents=True, exist_ok=True)
    with held(directory / ".export.lock", blocking=False):
        archive = directory / "same-dem-gauge-catchments.zip"
        receipt = directory / "archive.json"
        if receipt.exists():
            archive = verify_file(workspace.root, read_json(receipt))
        else:
            pending = directory / ".same-dem-gauge-catchments.pending"
            entry = value["source_entry"]
            members = [entry["body"], *entry["companions"]]
            names = {"sources.json"}
            with zipfile.ZipFile(pending, "w", allowZip64=True) as output:
                output.write(manifest_path, "sources.json", compress_type=zipfile.ZIP_DEFLATED)
                for item in members:
                    name = item["source_path"]
                    path = Path(name)
                    if (path.is_absolute() or not path.parts or ".." in path.parts
                            or path.as_posix() != name or "\\" in name or "\0" in name or name in names):
                        raise ValueError("Invalid or repeated original catchment package member")
                    names.add(name)
                    source = verify_file(workspace.root, {"path": item["object"],
                        "sha256": item["sha256"], "bytes": item["bytes"]})
                    output.write(source, name, compress_type=zipfile.ZIP_STORED
                                 if path.suffix.lower() in (".tif", ".gpkg") else zipfile.ZIP_DEFLATED)
            pending.replace(archive)
            atomic_json(receipt, describe_file(workspace.root, archive), immutable=True)
        files = [{"label": "Complete original catchment source and native outputs",
                  **describe_file(workspace.root, archive)}]
        contract = None
        # Source-only recipients can inspect/export the original edition without
        # the original grid. A usable course contract is created only when that
        # exact native grid is actually retained in this project.
        grid_path = workspace.root / "grids" / value["analysis"]["selection"]["grid_id"] / "grid.json"
        if grid_path.is_file():
            contract = course_contract(workspace, selection)
            contract_path = directory / "annual-reference-input-contract.json"
            atomic_json(contract_path, contract, immutable=True)
            files.append({"label": "This Workspace's original-input course contract",
                          **describe_file(workspace.root, contract_path)})
        return {"schema": SCHEMA, "id": value["id"], "catchments": selection,
                "observation_id": value["observation_id"], "files": files,
                "input_contract": contract,
                "original_manifest": original,
                "original_source_collection_id": collection["id"]}


def source_fields(workspace, collection_id, source_id):
    import fiona
    from .rasters import vector_environment, native_vector_path
    path, entry = workspace.source_file(identifier(collection_id), source_id)
    if entry["kind"] != "vector":
        raise ValueError("Choose an original vector basin source")
    layers = []
    with vector_environment():
        for name in fiona.listlayers(native_vector_path(path)):
            with fiona.open(native_vector_path(path), layer=name) as source:
                samples = []
                for index, row in enumerate(source):
                    if index == 3:
                        break
                    samples.append(dict(row["properties"]))
                layers.append({"name": name, "fields": dict(source.schema["properties"]),
                               "geometry": source.schema["geometry"], "crs": source.crs_wkt,
                               "sample_rows": samples})
    return {"source_collection_id": collection_id, "source_id": source_id,
            "title": entry["title"], "vintage": entry["vintage"], "uri": entry["uri"],
            "body": entry["body"], "layers": layers}


def editions(workspace):
    values = []
    for collection in workspace._list("sources"):
        for entry in collection["entries"]:
            if entry.get("metadata", {}).get("schema") == SCHEMA:
                values.append({"source_collection_id": collection["id"], "source_id": entry["id"],
                               "id_field": "catchment_id", "title": entry["title"],
                               "vintage": entry["vintage"], "metadata": entry["metadata"]})
    return values


def catalog(workspace):
    observations = []
    for item in workspace._list("observations"):
        fields = sorted({key for row in item.get("rows", []) if isinstance(row.get("source_records"), dict)
                         for key in row["source_records"]})
        original_fields = sorted({key for row in item.get("rows", []) if isinstance(row.get("original"), dict)
                                  for key in row["original"]})
        observations.append({"id": item["id"], "title": item.get("metadata", {}).get("title") or item["id"],
            "fields": fields, "coordinate_fields": {"source_records": fields, "original": original_fields}, "catchment_ids": sorted({row["catchment_id"] for row in item.get("rows", [])}),
            "records": len(item.get("rows", []))})
    sources, editions = [], []
    for collection in workspace._list("sources"):
        for entry in collection["entries"]:
            if entry["kind"] != "vector":
                continue
            row = {"source_collection_id": collection["id"], "source_id": entry["id"],
                   "title": entry["title"], "collection_title": collection["title"]}
            sources.append(row)
            if entry.get("metadata", {}).get("schema") == SCHEMA:
                editions.append({**row, "id_field": "catchment_id", "metadata": entry["metadata"]})
    grids = []
    for path in sorted((workspace.root / "grids").glob("*/grid.json")):
        row = read_json(path)
        if row.get("state") == "complete":
            grids.append({"id": row["id"], "title": row.get("spec", {}).get("title") or row["id"],
                          "grid": row.get("grid"), "dem": row.get("inputs", {}).get("DEM")})
    return {"schema": SCHEMA, "observations": observations, "sources": sources, "grids": grids, "editions": editions}


def main(argv=None):
    from .workspace import Workspace
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", required=True)
    sub = parser.add_subparsers(dest="command", required=True)
    for name in ("preview", "build", "inspect", "export"):
        command = sub.add_parser(name)
        command.add_argument("selection", type=Path)
    sub.add_parser("catalog")
    args = parser.parse_args(argv)
    ws = Workspace(args.workspace)
    result = catalog(ws) if args.command == "catalog" else globals()[args.command](ws, read_json(args.selection))
    print(json.dumps(result, indent=2, ensure_ascii=False, allow_nan=False))


if __name__ == "__main__":
    main()
