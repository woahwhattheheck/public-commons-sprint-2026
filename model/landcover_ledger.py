"""Windowed, restartable NLCD transition accounting on an existing native grid.

This is a read-only consumer of source/scenario rasters, not a hydrology model.
Boundary hectares use polygon/pixel intersections in an equal-area projection.
"""
from __future__ import annotations

from contextlib import ExitStack, contextmanager
from dataclasses import dataclass
from datetime import datetime, timezone
import hashlib
import json
import math
import os
from pathlib import Path
import re
import sqlite3
from typing import Callable, Mapping, Sequence
import zlib

import numpy as np
import rasterio
from rasterio.features import rasterize
from rasterio.windows import Window
from pyproj import CRS, Transformer
import shapely
from shapely.geometry import Polygon, shape, mapping
from shapely.ops import transform as geometry_transform
from shapely.strtree import STRtree

VERSION = "1.0.0"
SCHEMA = "upstate.landcover-ledger/1"
CLASSES = {
    11: "Open water", 12: "Perennial ice/snow", 21: "Developed, open space",
    22: "Developed, low intensity", 23: "Developed, medium intensity",
    24: "Developed, high intensity", 31: "Barren land", 41: "Deciduous forest",
    42: "Evergreen forest", 43: "Mixed forest", 51: "Dwarf scrub",
    52: "Shrub/scrub", 71: "Grassland/herbaceous", 72: "Sedge/herbaceous",
    73: "Lichens", 74: "Moss", 81: "Pasture/hay", 82: "Cultivated crops",
    90: "Woody wetlands", 95: "Emergent herbaceous wetlands",
}
CODES = np.array(list(CLASSES), dtype=np.uint8)
N_CLASSES = len(CODES)
LUT = np.full(256, -1, dtype=np.int16)
LUT[CODES] = np.arange(N_CLASSES)
GROUPS = {
    "developed": (21, 22, 23, 24), "forest": (41, 42, 43),
    "wetland": (90, 95), "cultivated_crop": (82,), "pasture_hay": (81,),
    "water": (11,), "shrub": (51, 52), "herbaceous": (71, 72, 73, 74),
}
SUPPORT_KEYS = (
    "covered_ha", "baseline_raster_valid_ha", "scenario_raster_valid_ha",
    "baseline_supported_ha", "scenario_supported_ha", "pair_common_valid_ha",
    "analysis_valid_ha", "baseline_only_ha", "scenario_only_ha", "neither_valid_ha",
    "excluded_by_other_scenarios_ha", "baseline_unknown_class_ha",
    "scenario_unknown_class_ha",
)


class LedgerError(ValueError):
    """An input or output cannot safely support the requested accounting."""


@dataclass(frozen=True)
class RasterInput:
    path: Path | str
    band: int = 1


@dataclass(frozen=True)
class Zone:
    id: str
    name: str
    geometry: object


@dataclass(frozen=True)
class Options:
    tile_size: int = 512
    support_scope: str = "all"
    unknown_policy: str = "error"
    allow_overlap: bool = False
    allow_projected_area: bool = False
    write_rasters: bool = True
    resume: bool = False
    title: str = "Land-cover change ledger"


def _json_bytes(value: object) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"),
                      ensure_ascii=False, allow_nan=False).encode("utf-8")


def sha256_file(path: Path | str) -> str:
    h = hashlib.sha256()
    with Path(path).open("rb") as f:
        for chunk in iter(lambda: f.read(4 * 1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def _source(path: Path | str, role: str) -> dict:
    p = Path(path).expanduser().resolve(strict=True)
    if not p.is_file():
        raise LedgerError(f"Not a regular input file: {p}")
    return {"role": role, "path": str(p), "bytes": p.stat().st_size,
            "sha256": sha256_file(p)}


def atomic_json(path: Path, value: object) -> None:
    temp = path.with_name(path.name + ".tmp")
    with temp.open("wb") as f:
        f.write(_json_bytes(value)); f.flush(); os.fsync(f.fileno())
    temp.replace(path)


def load_zones(path: Path | str, target_crs: CRS, *, id_field: str = "huc12",
               name_field: str = "name", zone_crs: str | None = None) -> list[Zone]:
    """Load GeoJSON, retaining identifier strings, multipart geometry and holes."""
    data = json.loads(Path(path).read_text(encoding="utf-8-sig"))
    if data.get("type") != "FeatureCollection" or not data.get("features"):
        raise LedgerError("Zones must be a nonempty GeoJSON FeatureCollection")
    declared = (data.get("crs") or {}).get("properties", {}).get("name")
    source_crs = CRS.from_user_input(zone_crs or declared or "EPSG:4326")
    xform = Transformer.from_crs(source_crs, target_crs, always_xy=True).transform
    zones, seen = [], set()
    for i, feature in enumerate(data["features"]):
        props = feature.get("properties") or {}
        zid = props.get(id_field)
        if zid is None or isinstance(zid, (dict, list, bool)):
            raise LedgerError(f"Feature {i} has no scalar {id_field!r}")
        # HUC identifiers must arrive as strings: numeric JSON can destroy zeros.
        if "huc" in id_field.lower() and not isinstance(zid, str):
            raise LedgerError(f"Feature {i}: {id_field} must be a string")
        zid = str(zid)
        if not zid or zid == "__domain__" or zid in seen:
            raise LedgerError(f"Empty, reserved or duplicate zone id: {zid!r}")
        geom = shape(feature.get("geometry"))
        if geom.geom_type not in ("Polygon", "MultiPolygon") or geom.is_empty:
            raise LedgerError(f"Zone {zid}: nonempty polygon geometry required")
        if not geom.is_valid:
            raise LedgerError(f"Zone {zid}: invalid geometry: {shapely.is_valid_reason(geom)}")
        if source_crs != target_crs:
            geom = geometry_transform(xform, geom)
        if not geom.is_valid or not np.isfinite(geom.bounds).all() or geom.area <= 0:
            raise LedgerError(f"Zone {zid}: unusable geometry after reprojection")
        seen.add(zid)
        zones.append(Zone(zid, str(props.get(name_field) or zid), geom))
    return zones


def _footprint(transform, height: int, width: int):
    return Polygon([transform * p for p in ((0, 0), (width, 0),
                                            (width, height), (0, height))])


def _pixel_polygons(rows: np.ndarray, cols: np.ndarray, transform):
    corners = np.array([[0, 0], [1, 0], [1, 1], [0, 1]], dtype=np.float64)
    xy = np.stack((cols, rows), axis=1)[:, None, :] + corners[None, :, :]
    world = np.empty_like(xy)
    world[..., 0] = transform.a * xy[..., 0] + transform.b * xy[..., 1] + transform.c
    world[..., 1] = transform.d * xy[..., 0] + transform.e * xy[..., 1] + transform.f
    return shapely.polygons(world)


def coverage_weights(geometry, transform, height: int, width: int) -> np.ndarray:
    """Return polygon intersection / cell area, including slivers and holes.

    Full interior cells use rasterization. Boundary and adjacent cells use exact
    planar intersections (floating-point GEOS), never center-count area estimates.
    An area-conservation check falls back to intersection of all touched cells.
    """
    footprint = _footprint(transform, height, width)
    clipped = geometry.intersection(footprint)
    weights = np.zeros((height, width), dtype=np.float64)
    if clipped.is_empty or clipped.area == 0:
        return weights
    if geometry.covers(footprint):
        weights.fill(1.0)
        return weights
    if clipped.geom_type == "GeometryCollection":
        clipped = shapely.union_all([part for part in shapely.get_parts(clipped) if part.area > 0])
    cell_area = abs(transform.a * transform.e - transform.b * transform.d)
    weights[:] = rasterize([(mapping(clipped), 1)], out_shape=weights.shape,
                           transform=transform, dtype="uint8")
    border = rasterize([(mapping(clipped.boundary), 1)], out_shape=weights.shape,
                       transform=transform, all_touched=True, dtype="uint8").astype(bool)
    # Expanding one cell handles coincident edges and rasterizer rounding.
    padded = np.pad(border, 1)
    nearby = np.zeros_like(border)
    for dr in range(3):
        for dc in range(3):
            nearby |= padded[dr:dr + height, dc:dc + width]
    rows, cols = np.nonzero(nearby)
    if len(rows):
        values = shapely.area(shapely.intersection(_pixel_polygons(rows, cols, transform), clipped))
        weights[rows, cols] = np.clip(values / cell_area, 0.0, 1.0)
    tolerance = max(1e-6, clipped.area * 2e-10)
    if abs(weights.sum(dtype=np.float64) * cell_area - clipped.area) > tolerance:
        touched = rasterize([(mapping(clipped), 1)], out_shape=weights.shape,
                            transform=transform, all_touched=True, dtype="uint8")
        rows, cols = np.nonzero(touched)
        weights.fill(0.0)
        values = shapely.area(shapely.intersection(_pixel_polygons(rows, cols, transform), clipped))
        weights[rows, cols] = np.clip(values / cell_area, 0.0, 1.0)
        if abs(weights.sum() * cell_area - clipped.area) > tolerance:
            raise LedgerError("Polygon/pixel area conservation failed; check coordinate precision")
    return weights


def _grid_info(dataset, allow_projected_area: bool) -> dict:
    if dataset.crs is None:
        raise LedgerError("Baseline raster has no CRS")
    crs = CRS.from_user_input(dataset.crs)
    if not crs.is_projected or len(crs.axis_info) < 2:
        raise LedgerError("Use the original projected equal-area grid, not longitude/latitude cells")
    scale = crs.axis_info[0].unit_conversion_factor
    if not math.isclose(scale, crs.axis_info[1].unit_conversion_factor):
        raise LedgerError("Grid axes have inconsistent linear units")
    method = crs.coordinate_operation.method_name if crs.coordinate_operation else ""
    equal_area = "equal area" in method.lower() or "equal-area" in method.lower()
    if not equal_area and not allow_projected_area:
        raise LedgerError(f"CRS method {method!r} is not equal-area; use the native EPSG:5070 grid")
    determinant = abs(dataset.transform.a * dataset.transform.e - dataset.transform.b * dataset.transform.d)
    if not math.isfinite(determinant) or determinant <= 0:
        raise LedgerError("Invalid grid transform")
    return {"crs": crs.to_string(), "wkt": crs.to_wkt(),
            "width": dataset.width, "height": dataset.height,
            "transform": list(dataset.transform)[:6], "cell_ha": determinant * scale**2 / 10000,
            "coordinate_unit_to_m": scale, "area_basis": "equal-area projection" if equal_area else "projected planar area",
            "projection_method": method}


def _read_classes(dataset, spec: RasterInput, window: Window, domain_mask: np.ndarray,
                  unknown_policy: str):
    raw = dataset.read(spec.band, window=window)
    source_valid = dataset.read_masks(spec.band, window=window) != 0
    supported = source_valid & np.isin(raw, CODES)
    unknown = source_valid & ~supported & domain_mask
    if unknown.any() and unknown_policy == "error":
        codes, counts = np.unique(raw[unknown], return_counts=True)
        raise LedgerError(f"Unsupported NLCD classes inside study area in {spec.path}: "
                          + str(dict(zip(codes.tolist(), counts.tolist()))))
    # All unsupported values receive index 0 solely as an unused placeholder.
    safe = np.where(supported, raw, CODES[0]).astype(np.uint8)
    return safe, LUT[safe], source_valid, supported, raw


def _delta(weights: np.ndarray, base, scenario, all_valid: np.ndarray,
           pixel_ha: float, support_scope: str) -> dict:
    _, bi, bv, bs, br = base
    _, si, sv, ss, sr = scenario
    active = weights > 0
    pair = bs & ss
    analysis = pair if support_scope == "pair" else all_valid
    mask = active & analysis
    weighted = weights * pixel_ha
    area = lambda m: float(weighted[m].sum(dtype=np.float64))
    support = dict(zip(SUPPORT_KEYS, [
        float(weighted.sum()), area(bv), area(sv), area(bs), area(ss),
        area(pair), area(analysis), area(bs & ~ss), area(ss & ~bs),
        area(~bs & ~ss), area(pair & ~analysis), area(bv & ~bs), area(sv & ~ss),
    ]))
    encoded = bi[mask].astype(np.int32) * N_CLASSES + si[mask]
    matrix = np.bincount(encoded, weights=weighted[mask], minlength=N_CLASSES**2)
    cells = np.bincount(encoded, minlength=N_CLASSES**2)
    nonzero = np.flatnonzero(cells)
    transitions = [[int(i), float(matrix[i]), int(cells[i])] for i in nonzero]
    unknowns = {}
    for side, raw, source_valid, supported in (("baseline", br, bv, bs), ("scenario", sr, sv, ss)):
        unknown_mask = active & source_valid & ~supported
        if unknown_mask.any():
            codes, inv = np.unique(raw[unknown_mask], return_inverse=True)
            hectares = np.bincount(inv, weights=weighted[unknown_mask])
            unknowns[side] = {str(int(c)): float(a) for c, a in zip(codes, hectares)}
    return {"support": support, "transitions": transitions, "unknown_classes_ha": unknowns}


def _slug(name: str) -> str:
    stem = re.sub(r"[^A-Za-z0-9_-]+", "-", name).strip("-")[:60] or "scenario"
    return stem + "-" + hashlib.sha256(name.encode()).hexdigest()[:10]


@contextmanager
def _exclusive_lock(path: Path):
    import fcntl
    with path.open("a+b") as f:
        try:
            fcntl.flock(f, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as exc:
            raise LedgerError("Another process is already writing this ledger") from exc
        try:
            yield
        finally:
            fcntl.flock(f, fcntl.LOCK_UN)


def _initialize_raster(path: Path, baseline, dtype: str, description: str, nodata=0):
    profile = {"driver": "GTiff", "width": baseline.width, "height": baseline.height,
               "count": 1, "crs": baseline.crs, "transform": baseline.transform,
               "dtype": dtype, "nodata": nodata, "compress": "deflate",
               "tiled": True, "blockxsize": 256, "blockysize": 256,
               "BIGTIFF": "IF_SAFER"}
    with rasterio.open(path, "w", **profile) as out:
        out.set_band_description(1, description)
        out.update_tags(ledger_schema=SCHEMA, ledger_version=VERSION)


def _write_window(path: Path, data: np.ndarray, window: Window) -> None:
    # Closing before the SQLite commit is essential for process-death recovery.
    # A crash before commit causes deterministic overwrite of the same window.
    with rasterio.open(path, "r+") as target:
        target.write(data, 1, window=window)


def _aggregate(db: sqlite3.Connection, zone_meta: list[dict], scenario_names: list[str],
               config: dict, grid: dict, complete: bool) -> dict:
    accum = {}
    for zone in zone_meta:
        for scenario in scenario_names:
            accum[(zone["id"], scenario)] = {
                "support": dict.fromkeys(SUPPORT_KEYS, 0.0),
                "matrix": np.zeros((N_CLASSES, N_CLASSES), dtype=np.float64),
                "cells": np.zeros((N_CLASSES, N_CLASSES), dtype=np.int64), "unknown": {},
            }
    for (payload,) in db.execute("SELECT payload FROM tiles ORDER BY tile_id"):
        items = json.loads(zlib.decompress(payload))
        for item in items:
            a = accum[(item["zone_id"], item["scenario"])]
            for key, value in item["support"].items():
                a["support"][key] += value
            for index, hectares, cells in item["transitions"]:
                row, col = divmod(index, N_CLASSES)
                a["matrix"][row, col] += hectares; a["cells"][row, col] += cells
            for side, unknown in item["unknown_classes_ha"].items():
                for code, hectares in unknown.items():
                    key = side + ":" + code
                    a["unknown"][key] = a["unknown"].get(key, 0.0) + hectares
    rows = []
    for zone in zone_meta:
        for scenario in scenario_names:
            a = accum[(zone["id"], scenario)]
            matrix, support = a["matrix"], a["support"]
            common = float(matrix.sum())
            if complete and not math.isclose(support["covered_ha"], zone["inside_grid_ha"], rel_tol=3e-9, abs_tol=1e-7):
                raise LedgerError(f"Zone coverage does not conserve area: {zone['id']}")
            if not math.isclose(common, support["analysis_valid_ha"], rel_tol=3e-10, abs_tol=1e-8):
                raise LedgerError("Transition matrix/support mismatch")
            transitions = []
            for i, j in zip(*np.nonzero(a["cells"])):
                transitions.append({"from_code": int(CODES[i]), "to_code": int(CODES[j]),
                                    "ha": float(matrix[i, j]),
                                    "intersecting_cells": int(a["cells"][i, j])})
            groups = {}
            for group, codes in GROUPS.items():
                indices = [int(LUT[c]) for c in codes]
                before = float(matrix[indices, :].sum()); after = float(matrix[:, indices].sum())
                retained = float(matrix[np.ix_(indices, indices)].sum())
                groups[group] = {"baseline_ha": before, "scenario_ha": after,
                                 "gained_ha": max(0.0, after - retained), "lost_ha": max(0.0, before - retained),
                                 "net_ha": after - before}
                if not common:
                    groups[group] = dict.fromkeys(groups[group], None)
            unchanged = float(np.trace(matrix))
            changed = float(matrix[~np.eye(N_CLASSES, dtype=bool)].sum())
            rows.append({"zone_id": zone["id"], "zone_name": zone["name"], "scenario": scenario,
                         "support": support, "changed_ha": changed if common else None,
                         "unchanged_ha": unchanged if common else None,
                         "changed_pct_of_analysis": changed / common * 100 if common else None,
                         "analysis_coverage_pct": common / zone["inside_grid_ha"] * 100 if zone["inside_grid_ha"] else None,
                         "groups": groups, "transitions": transitions,
                         "unknown_classes_ha": a["unknown"]})
    return {"schema": SCHEMA, "version": VERSION, "complete": complete,
            "title": config["options"]["title"], "grid": grid, "inputs": config["sources"],
            "options": config["options"], "zones": zone_meta, "scenarios": scenario_names,
            "classes": {str(k): v for k, v in CLASSES.items()}, "rows": rows,
            "interpretation": [
                "Class-change hectares describe land-cover transitions, not modeled runoff, temperature, cost, or benefit.",
                "Baseline/scenario class areas share the selected analysis mask; nodata is accounted separately.",
                "Boundary area is polygon/pixel intersection in the reported projection; land-cover attribution remains at source pixel resolution.",
                "Intersecting-cell counts count positive-area touches; use hectares, not cell counts, when summing watershed boundaries.",
                "Domain rows use the unique union; overlapping zone rows must not be summed." if config["options"]["allow_overlap"] else "Watersheds have disjoint positive-area interiors; domain rows are their unique union.",
            ]}


def run_ledger(baseline: RasterInput, scenarios: Mapping[str, RasterInput],
               zones_path: Path | str, output: Path | str, *, options: Options | None = None,
               id_field: str = "huc12", name_field: str = "name", zone_crs: str | None = None,
               context_files: Sequence[Path | str] = (),
               progress: Callable[[dict], None] | None = None) -> dict:
    """Compute a complete retained ledger. Resume repeats only uncommitted tiles.

    Inputs are local native raster editions; grid mismatches fail without resampling.
    Output is a new directory, or the same checkpoint directory with resume=True.
    Callbacks run after a tile commit and may cancel by raising an exception.
    """
    options = options or Options()
    if not scenarios or any(not isinstance(k, str) or not k.strip() for k in scenarios):
        raise LedgerError("At least one named scenario raster is required")
    if not isinstance(options.tile_size, int) or options.tile_size < 1:
        raise LedgerError("tile_size must be a positive integer")
    if options.support_scope not in ("all", "pair") or options.unknown_policy not in ("error", "exclude"):
        raise LedgerError("Unknown support_scope or unknown_policy")
    output = Path(output).expanduser().resolve()
    sources = [_source(baseline.path, "baseline"), _source(zones_path, "zones")]
    sources += [_source(spec.path, "scenario:" + name) for name, spec in scenarios.items()]
    sources += [_source(p, "context") for p in context_files]
    # GDAL validity may live in .msk or auxiliary files. Hash every local dataset
    # dependency, including VRT source files, not just the primary TIFF bytes.
    seen_paths = {record["path"] for record in sources}
    for spec in [baseline, *scenarios.values()]:
        with rasterio.open(Path(spec.path)) as dataset:
            for dependency in dataset.files:
                dep = str(Path(dependency).expanduser().resolve(strict=True))
                if dep not in seen_paths:
                    sources.append(_source(dep, "raster-companion"))
                    seen_paths.add(dep)
    if any(Path(s["path"]).is_relative_to(output) for s in sources):
        raise LedgerError("Output directory must not contain input files")
    fingerprint_options = {key: value for key, value in vars(options).items() if key != "resume"}
    config = {"schema": SCHEMA, "version": VERSION, "sources": sources,
              "options": fingerprint_options, "id_field": id_field, "name_field": name_field,
              "zone_crs": zone_crs, "baseline_band": baseline.band,
              "scenario_bands": {k: v.band for k, v in scenarios.items()},
              "scenario_order": list(scenarios)}
    signature = hashlib.sha256(_json_bytes(config)).hexdigest()
    if output.exists() and not options.resume:
        raise LedgerError(f"Output already exists; use --resume or a new output: {output}")
    if options.resume and not (output / "ledger.sqlite3").is_file():
        raise LedgerError("Resume requires an existing ledger.sqlite3 checkpoint")
    output.mkdir(parents=True, exist_ok=True)
    with _exclusive_lock(output / ".writer.lock"), ExitStack() as stack:
        specs = [baseline, *scenarios.values()]
        datasets = [stack.enter_context(rasterio.open(Path(s.path))) for s in specs]
        source = datasets[0]
        grid = _grid_info(source, options.allow_projected_area)
        for spec, dataset in zip(specs, datasets):
            if (dataset.width, dataset.height, dataset.crs, dataset.transform) != (source.width, source.height, source.crs, source.transform):
                raise LedgerError(f"Native grid mismatch: {spec.path}")
            if not isinstance(spec.band, int) or not 1 <= spec.band <= dataset.count:
                raise LedgerError(f"Invalid band {spec.band} for {spec.path}")
            if not np.issubdtype(np.dtype(dataset.dtypes[spec.band - 1]), np.integer):
                raise LedgerError(f"Categorical land cover requires an integer raster band: {spec.path}")
        zones = load_zones(zones_path, CRS.from_user_input(source.crs), id_field=id_field,
                           name_field=name_field, zone_crs=zone_crs)
        tree = STRtree([z.geometry for z in zones])
        if not options.allow_overlap:
            for i, zone in enumerate(zones):
                for j in tree.query(zone.geometry, predicate="intersects"):
                    if int(j) > i and zone.geometry.intersection(zones[int(j)].geometry).area > 1e-7:
                        raise LedgerError(f"Overlapping zone interiors: {zone.id} / {zones[int(j)].id}")
        domain = shapely.union_all([z.geometry for z in zones])
        footprint = _footprint(source.transform, source.height, source.width)
        if domain.intersection(footprint).area <= 0:
            raise LedgerError("No positive-area intersection between watersheds and raster grid")
        factor = grid["coordinate_unit_to_m"]**2 / 10000
        zone_meta = []
        for zone in [Zone("__domain__", "Study area union", domain), *zones]:
            total, inside = zone.geometry.area * factor, zone.geometry.intersection(footprint).area * factor
            zone_meta.append({"id": zone.id, "name": zone.name, "geometry_ha": total,
                              "inside_grid_ha": inside, "outside_grid_ha": max(0.0, total - inside)})
        db = sqlite3.connect(output / "ledger.sqlite3")
        stack.callback(db.close)
        db.execute("PRAGMA journal_mode=DELETE"); db.execute("PRAGMA synchronous=FULL")
        db.execute("CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)")
        db.execute("CREATE TABLE IF NOT EXISTS tiles (tile_id INTEGER PRIMARY KEY, payload BLOB NOT NULL)")
        old = db.execute("SELECT value FROM meta WHERE key='signature'").fetchone()
        if old and not options.resume:
            raise LedgerError("Another writer already created this edition; use --resume or a new output")
        if old and old[0] != signature:
            raise LedgerError("Input bytes, band selection or ledger options changed; create a new edition")
        if not old:
            if options.resume:
                raise LedgerError("Checkpoint has no original input signature")
            db.executemany("INSERT INTO meta VALUES (?,?)", [("signature", signature), ("config", _json_bytes(config).decode()), ("grid", _json_bytes(grid).decode())])
            db.commit()
        names = list(scenarios)
        paths = {name: output / ("transition-" + _slug(name) + ".tif") for name in names}
        fraction_path = output / "study-area-fraction.tif"
        if options.write_rasters:
            for p, dtype, description in [(fraction_path, "float64", "Unique study-area polygon fraction per native pixel"), *[(p, "uint16", "NLCD baseline * 100 + scenario; zero is excluded") for p in paths.values()]]:
                if not options.resume:
                    _initialize_raster(p, source, dtype, description)
                elif not p.is_file():
                    raise LedgerError(f"Checkpoint raster missing: {p}; use a new output edition")
        windows = [(r, c, min(options.tile_size, source.height-r), min(options.tile_size, source.width-c))
                   for r in range(0, source.height, options.tile_size)
                   for c in range(0, source.width, options.tile_size)]
        completed = {row[0] for row in db.execute("SELECT tile_id FROM tiles")}
        atomic_json(output / "status.json", {"signature": signature, "state": "running", "completed_tiles": len(completed), "total_tiles": len(windows)})
        for tile_id, (row, col, height, width) in enumerate(windows):
            if tile_id in completed:
                continue
            window = Window(col, row, width, height)
            transform = source.window_transform(window)
            tile_footprint = _footprint(transform, height, width)
            candidates = tree.query(tile_footprint, predicate="intersects")
            zone_weights = []
            domain_weights = np.zeros((height, width), dtype=np.float64)
            for index in sorted(int(i) for i in candidates):
                zone = zones[index]
                weights = coverage_weights(zone.geometry, transform, height, width)
                if weights.any():
                    zone_weights.append((zone.id, weights)); domain_weights += weights
            if options.allow_overlap and len(zone_weights) > 1:
                domain_weights = coverage_weights(domain, transform, height, width)
            else:
                if domain_weights.max(initial=0) > 1 + 1e-9:
                    raise LedgerError("Watershed fractions exceed unique domain area")
                np.clip(domain_weights, 0, 1, out=domain_weights)
            deltas = []
            if domain_weights.any():
                values = [_read_classes(ds, spec, window, domain_weights > 0, options.unknown_policy)
                          for ds, spec in zip(datasets, specs)]
                all_valid = np.logical_and.reduce([v[3] for v in values])
                for zid, weights in [("__domain__", domain_weights), *zone_weights]:
                    for name, scenario_values in zip(names, values[1:]):
                        delta = _delta(weights, values[0], scenario_values, all_valid,
                                       grid["cell_ha"], options.support_scope)
                        delta.update(zone_id=zid, scenario=name); deltas.append(delta)
                if options.write_rasters:
                    for name, scenario_values in zip(names, values[1:]):
                        valid = (values[0][3] & scenario_values[3]) if options.support_scope == "pair" else all_valid
                        code = values[0][0].astype(np.uint16) * 100 + scenario_values[0]
                        code[~(valid & (domain_weights > 0))] = 0
                        _write_window(paths[name], code, window)
            elif options.write_rasters:
                for path in paths.values():
                    _write_window(path, np.zeros((height, width), dtype=np.uint16), window)
            if options.write_rasters:
                _write_window(fraction_path, domain_weights, window)
            # The complete per-window aggregate is the transaction. No mutable
            # cumulative counters can be doubled by a repeated interrupted tile.
            db.execute("INSERT INTO tiles VALUES (?,?)", (tile_id, zlib.compress(_json_bytes(deltas), 6)))
            db.commit()
            completed.add(tile_id)
            status = {"signature": signature, "state": "running", "completed_tiles": len(completed), "total_tiles": len(windows)}
            atomic_json(output / "status.json", status)
            if progress:
                progress(status)
        # Verify retained raster/context inputs did not change during the computation.
        for record in sources:
            if sha256_file(record["path"]) != record["sha256"]:
                raise LedgerError(f"Input changed during run: {record['path']}; create a new edition")
        report = _aggregate(db, zone_meta, names, config, grid, True)
        report["signature"] = signature
        to_wgs84 = Transformer.from_crs(source.crs, "EPSG:4326", always_xy=True).transform
        geojson = {"type": "FeatureCollection", "features": [
            {"type": "Feature", "properties": {"zone_id": z.id, "zone_name": z.name},
             "geometry": mapping(geometry_transform(to_wgs84, z.geometry))} for z in zones]}
        atomic_json(output / "watersheds.geojson", geojson)
        # This separate display geometry is simplified only for browser drawing.
        # All numerical results and the complete GeoJSON use original geometry.
        report["map"] = {"crs": grid["crs"], "bbox": list(domain.bounds), "features": [
            {"id": z.id, "name": z.name,
             "geometry": mapping(z.geometry.simplify(math.sqrt(grid["cell_ha"] * 10000) / grid["coordinate_unit_to_m"] / 2, preserve_topology=True))}
            for z in zones]}
        report["completed_at"] = datetime.now(timezone.utc).isoformat()
        report["rasters"] = {"study_area_fraction": fraction_path.name,
                             "transitions": {k: p.name for k, p in paths.items()}} if options.write_rasters else {}
        atomic_json(output / "ledger.json", report)
        atomic_json(output / "status.json", {"signature": signature, "state": "complete", "completed_tiles": len(windows), "total_tiles": len(windows)})
        return report


def run_native_workspace(workspace: Path | str, scenario_rasters: Mapping[str, Path | str],
                         output: Path | str, **kwargs) -> dict:
    """File-level adapter; preserve the original scenario writer and all inputs.

    Pass each original scenario's completed land-cover path explicitly. The original
    scenario_set.json is retained as a context hash, not reinterpreted or rewritten.
    """
    root = Path(workspace)
    contexts = [root / name for name in ("run_manifest.json", "grid.json", "scenario_set.json") if (root / name).is_file()]
    contexts.extend(kwargs.pop("context_files", ()))
    return run_ledger(RasterInput(root / "rasters" / "landcover.tif"),
                      {name: RasterInput(path) for name, path in scenario_rasters.items()},
                      root / "huc12.geojson", output, context_files=contexts, **kwargs)
