"""Compare retained Annual NLCD land-cover rasters and publish usable change sources.

The public entry point is compare_landcover(). Raster inputs are verified against
their retained source entries. No network requests are made by this module.
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import json
import math
import os
import re
import tempfile
from contextlib import ExitStack
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

SCHEMA = "upstate.sources/v1"
GUIDE_URL = (
    "https://www.mrlc.gov/sites/default/files/docs/"
    "LSDS-2103%20Annual%20National%20Land%20Cover%20Database%20%28NLCD%29%20"
    "Collection%201%20Science%20Product%20User%20Guide%20-v1.2%202026_04_21.pdf"
)
CLASS_NAMES = {
    11: "Open Water", 12: "Perennial Ice/Snow",
    21: "Developed, Open Space", 22: "Developed, Low Intensity",
    23: "Developed, Medium Intensity", 24: "Developed, High Intensity",
    31: "Barren Land", 41: "Deciduous Forest", 42: "Evergreen Forest",
    43: "Mixed Forest", 52: "Shrub/Scrub", 71: "Grassland/Herbaceous",
    81: "Pasture/Hay", 82: "Cultivated Crops", 90: "Woody Wetlands",
    95: "Emergent Herbaceous Wetlands",
}
CLASS_CODES = tuple(sorted(CLASS_NAMES))
LANDCOVER_NODATA = 250
TRANSITION_NODATA = 9999
MASK_NODATA = 255
STATUS_NAMES = ("valid", "nodata", "invalid")
METRIC_NAMES = (
    "total_cells", "from_valid_cells", "to_valid_cells",
    "from_nodata_cells", "to_nodata_cells", "from_invalid_cells",
    "to_invalid_cells", "common_valid_cells", "unchanged_cells",
    "changed_cells", "selected_cells",
)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _write_json(path: Path, value: Any) -> None:
    path.write_text(json.dumps(value, indent=2, sort_keys=True, allow_nan=False) + "\n",
                    encoding="utf-8")


def _digest(path: Path) -> tuple[str, int]:
    digest = hashlib.sha256()
    size = 0
    with path.open("rb") as stream:
        while chunk := stream.read(1024 * 1024):
            digest.update(chunk)
            size += len(chunk)
    return digest.hexdigest(), size


def _stat(path: Path) -> tuple[int, int, int]:
    value = path.stat()
    return value.st_size, value.st_mtime_ns, value.st_ino


def _year(source: dict[str, Any]) -> int:
    """Resolve exact retained product-year fields and reject their disagreement."""
    metadata = source.get("metadata") or {}
    if not isinstance(metadata, dict):
        raise ValueError("Source metadata must be an object.")
    known = []

    def retain(label: str, value: Any) -> None:
        if value in (None, ""):
            return
        if isinstance(value, bool):
            raise ValueError(f"{label} must identify an integer Annual NLCD year.")
        try:
            result = int(value)
        except (ValueError, TypeError, OverflowError) as exc:
            raise ValueError(f"{label} must identify an integer Annual NLCD year.") from exc
        if str(value).strip() not in (str(result), f"{result}.0") or not 1985 <= result <= 2200:
            raise ValueError(f"Unsupported Annual NLCD year in {label}: {value!r}")
        known.append((label, result))

    retain("entry.year", source.get("year"))
    retain("metadata.year", metadata.get("year"))
    retain("metadata.product_year", metadata.get("product_year"))
    source_time = source.get("source_time")
    if source_time not in (None, ""):
        if not isinstance(source_time, str):
            raise ValueError("Retained source_time must be an exact YYYY or ISO calendar date.")
        value = source_time.strip()
        if re.fullmatch(r"\d{4}", value):
            retain("source_time", value)
        elif re.fullmatch(r"\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})?)?", value):
            try:
                dated = datetime.fromisoformat(value.replace("Z", "+00:00"))
            except ValueError as exc:
                raise ValueError("Retained source_time is not a valid ISO calendar date.") from exc
            retain("source_time", dated.year)
        else:
            raise ValueError("Retained source_time must be an exact YYYY or ISO calendar date.")
    vintage = source.get("vintage")
    if isinstance(vintage, str) and re.fullmatch(r"\d{4}", vintage.strip()):
        retain("vintage", vintage.strip())
    if not known:
        raise ValueError("Select the product year in entry.year or retain an exact source_time/year field.")
    if len({value for _, value in known}) != 1:
        raise ValueError("Retained source year fields disagree: " +
                         ", ".join(f"{label}={value}" for label, value in known))
    return known[0][1]


def _source_stamp(path: Path, source: dict[str, Any] | None, *,
                  kind: str, require_entry: bool = True) -> dict[str, Any]:
    if not path.is_file():
        raise FileNotFoundError(path)
    if require_entry and not isinstance(source, dict):
        raise ValueError("Retained raster source metadata is required for both inputs.")
    source = source or {}
    body = source.get("body") or source
    if not isinstance(body, dict):
        raise ValueError("Source entry body must contain the retained file metadata.")
    if source.get("kind", kind) != kind:
        raise ValueError(f"Source {source.get('id', path.name)!r} must have kind={kind!r}.")
    expected = body.get("sha256", source.get("sha256"))
    expected_bytes = body.get("bytes", source.get("bytes"))
    if require_entry and (not expected or expected_bytes is None):
        raise ValueError("Retained raster source entries require SHA-256 and byte count.")
    before = _stat(path)
    actual_hash, actual_bytes = _digest(path)
    if before != _stat(path):
        raise RuntimeError(f"Source changed while its hash was being read: {path.name}")
    if expected and actual_hash != str(expected).lower():
        raise ValueError(f"SHA-256 mismatch for retained source {source.get('id', path.name)!r}.")
    if expected_bytes is not None and actual_bytes != int(expected_bytes):
        raise ValueError(f"Byte-count mismatch for retained source {source.get('id', path.name)!r}.")
    companion_files = []
    if kind == "vector" and path.suffix.lower() == ".shp":
        for candidate in sorted(path.parent.iterdir()):
            if (candidate.is_file() and candidate.stem.lower() == path.stem.lower()
                    and candidate.suffix.lower() in (".dbf", ".shx", ".prj", ".cpg", ".sbn", ".sbx")):
                companion_before = _stat(candidate)
                companion_hash, companion_bytes = _digest(candidate)
                if companion_before != _stat(candidate):
                    raise RuntimeError(f"Vector companion changed while being read: {candidate.name}")
                companion_files.append({"file_name": candidate.name, "sha256": companion_hash,
                                        "bytes": companion_bytes})
        suffixes = {Path(item["file_name"]).suffix.lower() for item in companion_files}
        if not {".dbf", ".shx", ".prj"}.issubset(suffixes):
            raise ValueError("Zone shapefiles require DBF, SHX, and PRJ companions.")
    result = {
        "source_collection_id": source.get("source_collection_id"),
        "source_id": source.get("id", path.stem),
        "title": source.get("title", path.name),
        "uri": source.get("uri", path.as_uri()),
        "vintage": source.get("vintage"),
        "file_name": path.name, "sha256": actual_hash, "bytes": actual_bytes,
        "metadata": source.get("metadata", {}), "companions": companion_files,
    }
    if kind == "raster":
        result["year"] = _year(source)
        result["year_selection"] = source.get("year_selection")
        result["source_time"] = source.get("source_time")
    return result


def _class_selection(values: Any, name: str) -> tuple[int, ...]:
    if values is None:
        return CLASS_CODES
    if isinstance(values, str):
        values = [part.strip() for part in values.split(",") if part.strip()]
    try:
        selected = set()
        for value in values:
            if isinstance(value, bool):
                raise ValueError("Boolean values are not class codes.")
            number = int(value)
            if float(value) != number:
                raise ValueError("Class codes must be whole numbers.")
            selected.add(number)
        result = tuple(sorted(selected))
    except (TypeError, ValueError, OverflowError) as exc:
        raise ValueError(f"{name} must be a sequence of Annual NLCD class codes.") from exc
    if not result or any(value not in CLASS_NAMES for value in result):
        raise ValueError(f"{name} must contain one or more of {CLASS_CODES}.")
    return result


def _grid(dataset: Any) -> dict[str, Any]:
    return {
        "crs_wkt": dataset.crs.to_wkt() if dataset.crs else None,
        "transform": list(dataset.transform)[:6],
        "width": dataset.width, "height": dataset.height,
        "dtype": dataset.dtypes[0], "nodata": dataset.nodata,
    }


def _grid_differences(left: Any, right: Any) -> list[str]:
    differences = []
    if left.crs != right.crs:
        differences.append("CRS")
    if (left.width, left.height) != (right.width, right.height):
        differences.append("dimensions")
    if any(not math.isclose(a, b, abs_tol=1e-9, rel_tol=0)
           for a, b in zip(tuple(left.transform)[:6], tuple(right.transform)[:6])):
        differences.append("affine transform")
    return differences


def _validate_raster(dataset: Any, np: Any) -> None:
    if dataset.count != 1:
        raise ValueError("Annual NLCD land cover must be a single-band class raster.")
    if not np.issubdtype(np.dtype(dataset.dtypes[0]), np.integer):
        raise ValueError("Annual NLCD land-cover comparisons require integer class values.")
    if dataset.crs is None:
        raise ValueError("Raster CRS is required.")


def _area_ha(dataset: Any) -> float:
    if not dataset.crs.is_projected:
        raise ValueError("The comparison reference grid must use a projected CRS in metres.")
    try:
        _, factor = dataset.crs.linear_units_factor
    except Exception as exc:
        raise ValueError("Could not determine the reference grid's linear units.") from exc
    if not math.isclose(float(factor), 1.0, abs_tol=1e-12, rel_tol=0):
        raise ValueError("The comparison reference grid must have metre units.")
    transform = dataset.transform
    value = abs(transform.a * transform.e - transform.b * transform.d) / 10000.0
    if not math.isfinite(value) or value <= 0:
        raise ValueError("The reference raster has a degenerate cell area.")
    return value


def _empty_stats(np: Any) -> dict[str, Any]:
    return {"status": np.zeros((3, 3), dtype=np.int64),
            "matrix": np.zeros((len(CLASS_CODES), len(CLASS_CODES)), dtype=np.int64),
            "selected": 0}


def _class_status(dataset: Any, values: Any, window: Any, np: Any) -> Any:
    nodata = (dataset.read_masks(1, window=window) == 0) | (values == LANDCOVER_NODATA)
    status = np.full(values.shape, 2, dtype=np.uint8)
    status[np.isin(values, CLASS_CODES) & ~nodata] = 0
    status[nodata] = 1
    return status


def _accumulate(stats: dict[str, Any], before: Any, after: Any,
                from_status: Any, to_status: Any, selected: Any,
                region: Any, np: Any) -> None:
    if region is None:
        pair = from_status.ravel() * 3 + to_status.ravel()
        common = (from_status == 0) & (to_status == 0)
        stats["selected"] += int(np.count_nonzero(selected))
    else:
        pair = from_status[region] * 3 + to_status[region]
        common = region & (from_status == 0) & (to_status == 0)
        stats["selected"] += int(np.count_nonzero(selected & region))
    stats["status"] += np.bincount(pair, minlength=9).reshape(3, 3)
    codes = np.asarray(CLASS_CODES)
    index = np.searchsorted(codes, before[common]) * len(codes) + np.searchsorted(codes, after[common])
    stats["matrix"] += np.bincount(index, minlength=len(codes) ** 2).reshape(len(codes), len(codes))


def _metrics(stats: dict[str, Any], pixel_ha: float) -> dict[str, Any]:
    status, matrix = stats["status"], stats["matrix"]
    counts = {
        "total_cells": int(status.sum()),
        "from_valid_cells": int(status[0, :].sum()),
        "to_valid_cells": int(status[:, 0].sum()),
        "from_nodata_cells": int(status[1, :].sum()),
        "to_nodata_cells": int(status[:, 1].sum()),
        "from_invalid_cells": int(status[2, :].sum()),
        "to_invalid_cells": int(status[:, 2].sum()),
        "common_valid_cells": int(status[0, 0]),
        "unchanged_cells": int(matrix.trace()),
        "changed_cells": int(matrix.sum() - matrix.trace()),
        "selected_cells": int(stats["selected"]),
    }
    return {
        "counts": counts,
        "hectares": {key.replace("_cells", "_ha"): value * pixel_ha for key, value in counts.items()},
        "paired_status_counts": {
            f"{left}_to_{right}": int(status[i, j])
            for i, left in enumerate(STATUS_NAMES) for j, right in enumerate(STATUS_NAMES)
        },
        "common_valid_fraction": counts["common_valid_cells"] / counts["total_cells"] if counts["total_cells"] else None,
    }


def _matrix_rows(matrix: Any, pixel_ha: float, from_codes: tuple[int, ...],
                 to_codes: tuple[int, ...], *, nonzero_only: bool = False):
    for i, old in enumerate(CLASS_CODES):
        for j, new in enumerate(CLASS_CODES):
            count = int(matrix[i, j])
            if nonzero_only and count == 0:
                continue
            yield [old, CLASS_NAMES[old], new, CLASS_NAMES[new], count,
                   count * pixel_ha, old != new,
                   old != new and old in from_codes and new in to_codes]


def _window_bounds(transform: Any, width: int, height: int) -> tuple[float, ...]:
    corners = [transform * value for value in ((0, 0), (width, 0), (width, height), (0, height))]
    return min(x[0] for x in corners), min(x[1] for x in corners), max(x[0] for x in corners), max(x[1] for x in corners)


def _intersects(left: tuple[float, ...], right: tuple[float, ...]) -> bool:
    return left[0] <= right[2] and left[2] >= right[0] and left[1] <= right[3] and left[3] >= right[1]


def _polygon_area_ha(geometry: dict[str, Any]) -> float:
    def ring_area(ring):
        return abs(sum(a[0] * b[1] - b[0] * a[1]
                       for a, b in zip(ring, ring[1:])) / 2.0)
    rings = geometry["coordinates"]
    return max(0.0, ring_area(rings[0]) - sum(ring_area(ring) for ring in rings[1:])) / 10000.0


def _load_zones(path: Path, layer: str | None, id_field: str, crs: Any, np: Any):
    import fiona
    from model.rasters import native_vector_path, vector_environment
    from rasterio.features import bounds
    from rasterio.warp import transform_geom
    grouped = {}
    missing_geometry = []
    feature_count = 0
    with vector_environment(), fiona.open(native_vector_path(path), **({"layer": layer} if layer else {})) as source:
        source_crs = source.crs_wkt or source.crs
        if not source_crs:
            raise ValueError("Zone vector source must declare its CRS.")
        if id_field not in source.schema.get("properties", {}):
            raise ValueError(f"Zone ID field {id_field!r} does not exist.")
        for feature in source:
            feature_count += 1
            identity = feature["properties"].get(id_field)
            if identity is None or str(identity).strip() == "":
                raise ValueError(f"Zone feature {feature_count} has no {id_field!r}.")
            identity = str(identity)
            if not feature["geometry"]:
                missing_geometry.append(identity)
                continue
            geometry = dict(feature["geometry"])
            if geometry["type"] not in ("Polygon", "MultiPolygon"):
                raise ValueError(f"Zone {identity!r} must be polygonal.")
            geometry = transform_geom(source_crs, crs, geometry, precision=-1)
            box = bounds(geometry)
            item = grouped.setdefault(identity, {"id": identity, "geometries": [],
                "bounds": box, "stats": _empty_stats(np)})
            item["geometries"].append(geometry)
            old = item["bounds"]
            item["bounds"] = (min(old[0], box[0]), min(old[1], box[1]), max(old[2], box[2]), max(old[3], box[3]))
    return [grouped[key] for key in sorted(grouped)], {
        "feature_count": feature_count, "zone_count": len(grouped),
        "features_without_geometry": missing_geometry,
        "id_field": id_field, "layer": layer,
        "membership_rule": "Pixel centre inside polygon; duplicate zone IDs are unioned.",
        "overlap_rule": "Each zone is summarized independently; overlap is reported explicitly.",
        "zone_reprojection": "Vector geometries transformed locally to the reference raster CRS.",
    }


def _entry(root: Path, relative: str, identity: str, title: str, kind: str,
           role: str, units: str, vintage: str, lineage: dict[str, Any],
           **extra: Any) -> dict[str, Any]:
    sha256, size = _digest(root / relative)
    return {"id": identity, "title": title, "kind": kind, "role": role,
            "uri": f"urn:upstate:landcover-change:{identity}",
            "vintage": vintage, "path": relative, "sha256": sha256, "bytes": size,
            "units": units, "companions": [], "metadata": {"lineage": lineage, **extra}}



def _completed_result(output: Path, request: dict[str, Any]) -> dict[str, Any]:
    """Reopen a complete comparison after verifying request and retained bytes."""
    summary_path, manifest_path = output / "summary.json", output / "sources.json"
    try:
        summary = json.loads(summary_path.read_text(encoding="utf-8"))
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        raise FileExistsError("The output directory is occupied but has no complete land-cover comparison.") from exc
    if (summary.get("schema") != "upstate.landcover-change/v1"
            or manifest.get("schema") != SCHEMA
            or summary.get("request") != request
            or manifest.get("id") != summary.get("id")
            or manifest.get("captured_at") != summary.get("created_at")
            or manifest.get("metadata", {}).get("lineage") != summary.get("lineage")):
        raise FileExistsError("The output directory contains a different comparison; choose another directory.")
    entries = manifest.get("entries")
    if not isinstance(entries, list) or not entries:
        raise ValueError("Retained land-cover comparison has no source entries.")
    retained_paths = set()
    for entry in entries:
        for artifact in [entry] + entry.get("companions", []):
            relative = artifact.get("path")
            if not isinstance(relative, str):
                raise ValueError("Retained comparison contains an invalid source path.")
            path = (output / relative).resolve()
            if not path.is_relative_to(output) or not path.is_file():
                raise ValueError("Retained comparison source is missing or outside its collection.")
            before = _stat(path)
            actual_hash, actual_bytes = _digest(path)
            if before != _stat(path):
                raise RuntimeError("Retained comparison changed while it was being reopened.")
            if actual_hash != artifact.get("sha256") or actual_bytes != artifact.get("bytes"):
                raise ValueError(f"Retained comparison artifact failed verification: {relative}")
            retained_paths.add(relative)
    required = {"summary.json", "transitions.tif", "selected-change.tif", "class-transition.csv"}
    if summary.get("selection", {}).get("mask_available"):
        required.add("selected-change.gpkg")
    if request["zones"] is not None:
        required.update({"zone-summary.csv", "zone-transitions.csv"})
    if not required.issubset(retained_paths):
        raise ValueError("Retained comparison is missing required result artifacts.")
    identity = summary["id"]
    return {"schema": "upstate.landcover-change-result/v1", "id": identity,
            "output_dir": str(output), "manifest": str(manifest_path),
            "summary_path": str(summary_path), "summary": summary,
            "mask_source_id": manifest["metadata"].get("mask_source_id"),
            "transition_source_id": identity + "-transitions"}


def compare_landcover(
    from_raster: str | Path, to_raster: str | Path, output_dir: str | Path,
    from_source: dict[str, Any] | None = None, to_source: dict[str, Any] | None = None,
    *, align_to_from: bool = False, from_classes: Any = None, to_classes: Any = None,
    zones: str | Path | None = None, zone_source: dict[str, Any] | None = None,
    zone_id_field: str = "huc12", zone_layer: str | None = None,
    polygonize: bool = True, block_size: int = 512,
) -> dict[str, Any]:
    """Write an immutable, importable source collection for actual raster changes.

    from_source and to_source accept the workspace's retained source entries,
    including nested body.sha256/body.bytes. Set entry.year to the selected
    map year. Strict alignment is the default. align_to_from=True explicitly
    resamples the TO raster onto the FROM grid using nearest neighbour.
    """
    import numpy as np
    import rasterio
    from rasterio.enums import Resampling
    from rasterio.features import rasterize, shapes
    from rasterio.vrt import WarpedVRT
    from rasterio.windows import Window

    if isinstance(block_size, bool) or not isinstance(block_size, int) or block_size < 16:
        raise ValueError("block_size must be an integer of at least 16.")
    old_path, new_path = Path(from_raster).resolve(), Path(to_raster).resolve()
    output = Path(output_dir).resolve()
    if output.exists() and not output.is_dir():
        raise FileExistsError("Output must be a directory.")
    from_codes = _class_selection(from_classes, "from_classes")
    to_codes = _class_selection(to_classes, "to_classes")
    before_stamp = _source_stamp(old_path, from_source, kind="raster")
    after_stamp = _source_stamp(new_path, to_source, kind="raster")
    file_states = {old_path: _stat(old_path), new_path: _stat(new_path)}
    zone_path = Path(zones).resolve() if zones is not None else None
    zone_stamp = _source_stamp(zone_path, zone_source, kind="vector", require_entry=zone_source is not None) if zone_path else None
    if zone_path:
        file_states[zone_path] = _stat(zone_path)
        for companion in zone_stamp.get("companions", []):
            companion_path = zone_path.parent / companion["file_name"]
            file_states[companion_path] = _stat(companion_path)

    request = {"from": before_stamp, "to": after_stamp, "zones": zone_stamp,
               "align_to_from": bool(align_to_from), "from_classes": list(from_codes),
               "to_classes": list(to_codes), "zone_id_field": zone_id_field if zone_path else None,
               "zone_layer": zone_layer if zone_path else None, "polygonize": bool(polygonize),
               "block_size": block_size, "algorithm": "annual-nlcd-landcover-change/v1"}
    if output.exists() and any(output.iterdir()):
        return _completed_result(output, request)
    output.parent.mkdir(parents=True, exist_ok=True)

    with tempfile.TemporaryDirectory(prefix=".landcover-change-", dir=output.parent) as temporary:
        stage = Path(temporary) / "collection"
        stage.mkdir()
        with ExitStack() as stack:
            previous = stack.enter_context(rasterio.open(old_path))
            current_native = stack.enter_context(rasterio.open(new_path))
            _validate_raster(previous, np)
            _validate_raster(current_native, np)
            pixel_ha = _area_ha(previous)
            differences = _grid_differences(previous, current_native)
            if differences and not align_to_from:
                raise ValueError("Raster grids differ in " + ", ".join(differences) +
                                 ". Supply aligned native inputs or explicitly set align_to_from=True.")
            current = current_native
            if differences:
                current = stack.enter_context(WarpedVRT(
                    current_native, crs=previous.crs, transform=previous.transform,
                    width=previous.width, height=previous.height,
                    src_nodata=current_native.nodata if current_native.nodata is not None else LANDCOVER_NODATA,
                    nodata=LANDCOVER_NODATA, resampling=Resampling.nearest,
                ))
            reference_grid = _grid(previous)
            alignment = {"requested": "nearest_to_from" if align_to_from else "strict",
                         "performed": bool(differences), "differences": differences,
                         "resampling": "nearest" if differences else None,
                         "from_native_grid": reference_grid,
                         "to_native_grid": _grid(current_native),
                         "comparison_grid": reference_grid}
            lineage = {"from": before_stamp, "to": after_stamp, "zones": zone_stamp,
                       "alignment": alignment, "from_classes": list(from_codes),
                       "to_classes": list(to_codes), "zone_id_field": zone_id_field if zone_path else None,
                       "zone_layer": zone_layer if zone_path else None, "polygonize": bool(polygonize),
                       "block_size": block_size, "algorithm": "annual-nlcd-landcover-change/v1"}
            run_id = hashlib.sha256(json.dumps(lineage, sort_keys=True, allow_nan=False).encode()).hexdigest()[:20]
            identity = f"nlcd-change-{run_id}"
            vintage = f"{before_stamp['year']} to {after_stamp['year']}"
            profile = {"driver": "GTiff", "width": previous.width, "height": previous.height,
                       "count": 1, "crs": previous.crs, "transform": previous.transform,
                       "compress": "deflate", "tiled": True, "blockxsize": 512,
                       "blockysize": 512, "BIGTIFF": "IF_SAFER"}
            transition_writer = stack.enter_context(rasterio.open(
                stage / "transitions.tif", "w", **profile, dtype="uint16", nodata=TRANSITION_NODATA))
            mask_writer = stack.enter_context(rasterio.open(
                stage / "selected-change.tif", "w", **profile, dtype="uint8", nodata=MASK_NODATA))
            transition_writer.update_tags(
                FROM_YEAR=str(before_stamp["year"]), TO_YEAR=str(after_stamp["year"]),
                FROM_SHA256=before_stamp["sha256"], TO_SHA256=after_stamp["sha256"],
                ENCODING="Changed=from_class*100+to_class; unchanged=class; NoData=9999")
            mask_writer.update_tags(
                FROM_YEAR=str(before_stamp["year"]), TO_YEAR=str(after_stamp["year"]),
                FROM_CLASSES=",".join(map(str, from_codes)), TO_CLASSES=",".join(map(str, to_codes)),
                ENCODING="1=selected observed change; 0=other common-valid pixel; NoData=255")
            polygon_writer = None
            if polygonize:
                import fiona
                from model.rasters import vector_environment
                stack.enter_context(vector_environment())
                polygon_writer = stack.enter_context(fiona.open(
                    stage / "selected-change.gpkg", "w", driver="GPKG", layer="change_mask",
                    crs_wkt=previous.crs.to_wkt(),
                    schema={"geometry": "Polygon", "properties": {
                        "mask_id": "int64", "from_code": "int", "to_code": "int",
                        "from_class": "str:48", "to_class": "str:48", "area_ha": "float"}},
                ))
            zone_items, zone_info = _load_zones(zone_path, zone_layer, zone_id_field, previous.crs, np) if zone_path else ([], None)
            totals = _empty_stats(np)
            invalid_values = {"from": {}, "to": {}}
            polygon_count = 0
            window_count = 0
            zone_covered_cells = 0
            zone_overlap_cells = 0
            zone_memberships = 0
            for row in range(0, previous.height, block_size):
                for column in range(0, previous.width, block_size):
                    window = Window(column, row, min(block_size, previous.width - column),
                                    min(block_size, previous.height - row))
                    old = previous.read(1, window=window)
                    new = current.read(1, window=window)
                    old_status = _class_status(previous, old, window, np)
                    new_status = _class_status(current, new, window, np)
                    common = (old_status == 0) & (new_status == 0)
                    changed = common & (old != new)
                    selected = changed & np.isin(old, from_codes) & np.isin(new, to_codes)
                    transition = np.full(old.shape, TRANSITION_NODATA, dtype=np.uint16)
                    transition[common] = old[common].astype(np.uint16)
                    transition[changed] = old[changed].astype(np.uint16) * 100 + new[changed].astype(np.uint16)
                    mask = np.full(old.shape, MASK_NODATA, dtype=np.uint8)
                    mask[common] = 0
                    mask[selected] = 1
                    transition_writer.write(transition, 1, window=window)
                    mask_writer.write(mask, 1, window=window)
                    _accumulate(totals, old, new, old_status, new_status, selected, None, np)
                    for label, data, status in (("from", old, old_status), ("to", new, new_status)):
                        values, counts = np.unique(data[status == 2], return_counts=True)
                        for value, count in zip(values, counts):
                            key = str(int(value))
                            invalid_values[label][key] = invalid_values[label].get(key, 0) + int(count)
                    transform = previous.window_transform(window)
                    if polygon_writer is not None and np.any(selected):
                        records = []
                        for geometry, value in shapes(transition, mask=selected, connectivity=4, transform=transform):
                            old_code, new_code = divmod(int(value), 100)
                            polygon_count += 1
                            records.append({"geometry": geometry, "properties": {
                                "mask_id": polygon_count, "from_code": old_code, "to_code": new_code,
                                "from_class": CLASS_NAMES[old_code], "to_class": CLASS_NAMES[new_code],
                                "area_ha": _polygon_area_ha(geometry)}})
                            if len(records) >= 256:
                                polygon_writer.writerecords(records)
                                records.clear()
                        if records:
                            polygon_writer.writerecords(records)
                    if zone_items:
                        bounds = _window_bounds(transform, int(window.width), int(window.height))
                        memberships = np.zeros(old.shape, dtype=np.uint32)
                        for zone in zone_items:
                            if not _intersects(bounds, zone["bounds"]):
                                continue
                            region = rasterize(
                                [(geometry, 1) for geometry in zone["geometries"]],
                                out_shape=old.shape, transform=transform,
                                fill=0, all_touched=False, dtype="uint8",
                            ).astype(bool)
                            if region.any():
                                memberships += region
                                _accumulate(zone["stats"], old, new, old_status, new_status, selected, region, np)
                        zone_covered_cells += int(np.count_nonzero(memberships))
                        zone_overlap_cells += int(np.count_nonzero(memberships > 1))
                        zone_memberships += int(memberships.sum())
                    window_count += 1

        for path, expected_state in file_states.items():
            if _stat(path) != expected_state:
                raise RuntimeError(f"Retained source changed while comparison ran: {path.name}")
        metrics = _metrics(totals, pixel_ha)
        if metrics["counts"]["total_cells"] != reference_grid["width"] * reference_grid["height"]:
            raise RuntimeError("Comparison did not cover the complete reference grid.")
        if sum(sum(row) for row in totals["matrix"].tolist()) != metrics["counts"]["common_valid_cells"]:
            raise RuntimeError("Class-transition accounting does not match common-valid coverage.")
        summary = {
            "schema": "upstate.landcover-change/v1", "id": identity,
            "created_at": _now(), "comparison_kind": "edition_revision" if before_stamp["year"] == after_stamp["year"] else "map_year_change",
            "lineage": lineage, "request": request, "grid": reference_grid, "pixel_area_ha": pixel_ha,
            "area_method": "Absolute determinant of the projected metre affine transform divided by 10000.",
            "classes": [{"code": code, "name": CLASS_NAMES[code]} for code in CLASS_CODES],
            "coverage": metrics, "invalid_class_values": invalid_values,
            "transition_matrix": {"row_axis": "from", "column_axis": "to",
                                  "class_codes": list(CLASS_CODES),
                                  "counts": totals["matrix"].tolist(),
                                  "hectares": (totals["matrix"] * pixel_ha).tolist()},
            "selection": {"from_classes": list(from_codes), "to_classes": list(to_codes),
                          "changed_only": True, "polygon_count": polygon_count,
                          "polygon_layer": "change_mask" if polygon_count else None,
                          "mask_available": bool(polygon_count),
                          "mask_unavailable_reason": None if polygon_count else
                              ("No selected changed cells." if polygonize else "Polygon mask was not requested."),
                          "polygon_partitioning": "Polygons split at processing-window boundaries.",
                          "scenario_use": "Selected pixel footprints are the patch mask; target LULC is supplied by the scenario."},
            "processing": {"window_count": window_count, "block_size": block_size},
            "method_source": {"url": GUIDE_URL, "document": "USGS LSDS-2103 v1.2, June 2026",
                              "sections": ["2.1.1", "2.1.2", "2.2.1", "2.2.3", "2.2.5"]},
        }
        matrix_header = ["from_code", "from_class", "to_code", "to_class", "cell_count", "area_ha", "changed", "selected_by_rule"]
        with (stage / "class-transition.csv").open("w", newline="", encoding="utf-8") as stream:
            writer = csv.writer(stream)
            writer.writerow(matrix_header)
            writer.writerows(_matrix_rows(totals["matrix"], pixel_ha, from_codes, to_codes))
        if zone_info is not None:
            zone_info.update({"covered_cells": zone_covered_cells,
                              "overlap_cells": zone_overlap_cells,
                              "total_zone_memberships": zone_memberships,
                              "covered_ha": zone_covered_cells * pixel_ha,
                              "overlap_ha": zone_overlap_cells * pixel_ha})
            summary["zones"] = zone_info
            with (stage / "zone-summary.csv").open("w", newline="", encoding="utf-8") as stream:
                writer = csv.writer(stream)
                writer.writerow(["zone_id"] + list(METRIC_NAMES) + [name.replace("_cells", "_ha") for name in METRIC_NAMES])
                for zone in zone_items:
                    zone_metrics = _metrics(zone["stats"], pixel_ha)
                    writer.writerow([zone["id"]] + [zone_metrics["counts"][name] for name in METRIC_NAMES] +
                                    [zone_metrics["hectares"][name.replace("_cells", "_ha")] for name in METRIC_NAMES])
            with (stage / "zone-transitions.csv").open("w", newline="", encoding="utf-8") as stream:
                writer = csv.writer(stream)
                writer.writerow(["zone_id"] + matrix_header)
                for zone in zone_items:
                    for values in _matrix_rows(zone["stats"]["matrix"], pixel_ha, from_codes, to_codes, nonzero_only=True):
                        writer.writerow([zone["id"]] + values)
        _write_json(stage / "summary.json", summary)
        entries = [
            _entry(stage, "transitions.tif", identity + "-transitions", f"Land-cover transitions, {vintage}",
                   "raster", "LANDCOVER_CHANGE", "NLCD class transition code", vintage, lineage,
                   nodata=TRANSITION_NODATA, encoding="unchanged=class; changed=from*100+to"),
            _entry(stage, "selected-change.tif", identity + "-raster-mask", f"Selected land-cover changes, {vintage}",
                   "raster", "LANDCOVER_CHANGE_MASK", "binary", vintage, lineage, nodata=MASK_NODATA),
            _entry(stage, "class-transition.csv", identity + "-matrix", f"Land-cover transition matrix, {vintage}",
                   "table", "LANDCOVER_CHANGE_MATRIX", "cells and hectares", vintage, lineage),
            _entry(stage, "summary.json", identity + "-summary", f"Land-cover change summary, {vintage}",
                   "document", "LANDCOVER_CHANGE_SUMMARY", "cells and hectares", vintage, lineage),
        ]
        mask_source_id = None
        if polygon_count:
            mask_source_id = identity + "-scenario-mask"
            entries.append(_entry(
                stage, "selected-change.gpkg", mask_source_id,
                f"Observed-change scenario mask, {vintage}", "vector", "SCENARIO_MASK",
                "projected metres; area_ha in hectares", vintage, lineage,
                layer="change_mask", geometry_count=polygon_count, selection=summary["selection"],
            ))
            entries[-1]["layer"] = "change_mask"
        if zone_info is not None:
            for filename, suffix, title in [
                ("zone-summary.csv", "zones", "Land-cover change by zone"),
                ("zone-transitions.csv", "zone-matrix", "Land-cover transitions by zone"),
            ]:
                entries.append(_entry(stage, filename, identity + "-" + suffix,
                                      f"{title}, {vintage}", "table", "LANDCOVER_CHANGE_ZONES",
                                      "cells and hectares", vintage, lineage, zones=zone_info))
        manifest = {"schema": SCHEMA, "id": identity, "title": f"Annual NLCD land-cover comparison, {vintage}",
                    "captured_at": summary["created_at"], "entries": entries,
                    "metadata": {"lineage": lineage, "coverage": metrics,
                                 "mask_source_id": mask_source_id, "method_source": summary["method_source"]}}
        _write_json(stage / "sources.json", manifest)
        if output.exists():
            output.rmdir()  # Only the initially empty caller-supplied output directory.
        os.replace(stage, output)

    return {"schema": "upstate.landcover-change-result/v1", "id": identity,
            "output_dir": str(output), "manifest": str(output / "sources.json"),
            "summary_path": str(output / "summary.json"), "summary": summary,
            "mask_source_id": mask_source_id,
            "transition_source_id": identity + "-transitions"}


def _manifest_source(manifest_path: str, source_id: str, year: int | None = None):
    manifest_file = Path(manifest_path).resolve()
    manifest = json.loads(manifest_file.read_text(encoding="utf-8"))
    if manifest.get("schema") != SCHEMA:
        raise ValueError(f"{manifest_file.name} is not an {SCHEMA} manifest.")
    matching = [entry for entry in manifest.get("entries", []) if entry.get("id") == source_id]
    if len(matching) != 1:
        raise ValueError(f"Expected one source entry with ID {source_id!r}.")
    source = dict(matching[0])
    body = source.get("body") or source
    path = (manifest_file.parent / body["path"]).resolve()
    if not path.is_relative_to(manifest_file.parent):
        raise ValueError("Retained source paths must remain inside the source collection.")
    source.setdefault("source_collection_id", manifest.get("id", manifest_file.parent.name))
    if year is not None:
        source["year"] = year
        source["year_selection"] = "operator"
    return path, source


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--from-manifest", required=True)
    parser.add_argument("--from-source-id", required=True)
    parser.add_argument("--from-year", type=int, required=True)
    parser.add_argument("--to-manifest", required=True)
    parser.add_argument("--to-source-id", required=True)
    parser.add_argument("--to-year", type=int, required=True)
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--align-to-from", action="store_true")
    parser.add_argument("--from-classes")
    parser.add_argument("--to-classes")
    parser.add_argument("--zones-manifest")
    parser.add_argument("--zone-source-id")
    parser.add_argument("--zone-id-field", default="huc12")
    parser.add_argument("--zone-layer")
    parser.add_argument("--no-polygonize", action="store_true")
    args = parser.parse_args(argv)
    old_path, old_source = _manifest_source(args.from_manifest, args.from_source_id, args.from_year)
    new_path, new_source = _manifest_source(args.to_manifest, args.to_source_id, args.to_year)
    zones = zone_source = None
    if bool(args.zones_manifest) != bool(args.zone_source_id):
        parser.error("--zones-manifest and --zone-source-id must be supplied together.")
    if args.zones_manifest:
        zones, zone_source = _manifest_source(args.zones_manifest, args.zone_source_id)
    result = compare_landcover(
        old_path, new_path, args.output_dir, old_source, new_source,
        align_to_from=args.align_to_from, from_classes=args.from_classes, to_classes=args.to_classes,
        zones=zones, zone_source=zone_source, zone_id_field=args.zone_id_field,
        zone_layer=args.zone_layer, polygonize=not args.no_polygonize,
    )
    print(json.dumps(result, indent=2, allow_nan=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
