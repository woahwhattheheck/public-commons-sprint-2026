"""Portable, editable GIS projects over retained local data.

Copyright 2026 TokenJunkieLabs. Original data and third-party licenses are retained.
The builder never invokes a scientific model or changes the numerical input cells.
"""
from __future__ import annotations

import contextlib
import csv
import hashlib
import html
import json
import math
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import stat
import tempfile
import time
from typing import Any, Callable, Iterable
import unicodedata
import uuid
import xml.etree.ElementTree as ET
import zipfile

SCHEMA = "upstate.editable-gis/v1"
REQUEST_SCHEMA = "upstate.gis-request/v1"
VERSION = "1.5.0"
CHUNK = 1024 * 1024


def canonical(value: Any) -> bytes:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"),
                      allow_nan=False).encode("utf-8")


def fingerprint(value: Any) -> str:
    return hashlib.sha256(canonical(value)).hexdigest()


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(CHUNK), b""):
            h.update(block)
    return h.hexdigest()


def load(path: Path) -> dict:
    def reject(s):
        raise ValueError("Non-finite JSON number: " + s)
    with path.open(encoding="utf-8") as stream:
        value = json.load(stream, parse_constant=reject)
    if not isinstance(value, dict):
        raise ValueError("Expected a JSON object: " + str(path))
    return value


def save(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    pending = path.with_name(path.name + ".pending-" + uuid.uuid4().hex)
    try:
        with pending.open("xb") as out:
            out.write(canonical(value) + b"\n")
            out.flush()
            os.fsync(out.fileno())
        os.replace(pending, path)
    finally:
        pending.unlink(missing_ok=True)


def member(name: str) -> PurePosixPath:
    if not isinstance(name, str) or not name or "\\" in name or "\0" in name or ":" in name:
        raise ValueError("Use a portable relative member path")
    p = PurePosixPath(name)
    if p.is_absolute() or str(p) != name or any(x in (".", "..", "") for x in p.parts):
        raise ValueError("Unsafe relative member: " + name)
    if any(x.endswith((".", " ")) or re.fullmatch(r"(?i)(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?", x)
           for x in p.parts):
        raise ValueError("Member is not portable to Windows: " + name)
    return p


def local(root: Path, name: str, *, exists: bool = True) -> Path:
    p = root / member(name)
    if p.is_symlink() or not p.resolve().is_relative_to(root.resolve()):
        raise ValueError("Member escapes the selected root: " + name)
    if exists and not p.is_file():
        raise FileNotFoundError("Missing retained file: " + name)
    return p


def record(root: Path, path: Path) -> dict:
    return {"path": path.relative_to(root).as_posix(), "bytes": path.stat().st_size,
            "sha256": sha256(path)}


def checked(root: Path, rec: dict) -> Path:
    p = local(root, rec["path"])
    if not re.fullmatch(r"[a-f0-9]{64}", rec.get("sha256", "")):
        raise ValueError("Each retained file needs its original SHA-256")
    if p.stat().st_size != rec["bytes"] or sha256(p) != rec["sha256"]:
        raise ValueError("Retained file changed: " + rec["path"])
    return p


@contextlib.contextmanager
def locked(path: Path):
    """Cross-process lock; the file remains as a harmless reusable lock anchor."""
    path.parent.mkdir(parents=True, exist_ok=True)
    stream = path.open("a+b")
    try:
        if os.name == "nt":
            import msvcrt
            stream.seek(0)
            if not stream.read(1):
                stream.write(b"0"); stream.flush()
            stream.seek(0)
            msvcrt.locking(stream.fileno(), msvcrt.LK_NBLCK, 1)
        else:
            import fcntl
            fcntl.flock(stream.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        yield
    finally:
        stream.close()


def copy_checked(source_root: Path, rec: dict, target: Path) -> None:
    source = checked(source_root, rec)
    target.parent.mkdir(parents=True, exist_ok=True)
    if target.exists():
        if target.stat().st_size == rec["bytes"] and sha256(target) == rec["sha256"]:
            return
        raise ValueError("Retained staged original changed: " + str(target))
    pending = target.with_name(target.name + ".copying")
    try:
        with source.open("rb") as src, pending.open("wb") as out:
            shutil.copyfileobj(src, out, CHUNK)
            out.flush(); os.fsync(out.fileno())
        if pending.stat().st_size != rec["bytes"] or sha256(pending) != rec["sha256"]:
            raise ValueError("Input changed during copy: " + rec["path"])
        os.replace(pending, target)
    finally:
        pending.unlink(missing_ok=True)


def _finite_bounds(bounds: Iterable[float]) -> list[float]:
    b = [float(v) for v in bounds]
    if len(b) != 4 or not all(math.isfinite(v) for v in b) or b[0] > b[2] or b[1] > b[3]:
        raise ValueError("Layer has no finite geographic extent")
    return b


def _project_bounds(bounds, source_crs, project_crs):
    from rasterio.warp import transform_bounds
    return _finite_bounds(transform_bounds(source_crs, project_crs, *bounds, densify_pts=41))


def inspect_raster(path: Path, spec: dict, project_crs: str) -> dict:
    import numpy as np
    import rasterio
    from rasterio.windows import Window
    from pyproj import CRS
    with rasterio.open(path) as src:
        if src.driver != "GTiff":
            raise ValueError("Select a retained GeoTIFF; prepare external-reference formats before export")
        if src.crs is None:
            raise ValueError("Raster CRS is missing: " + spec["id"])
        band = spec.get("band", 1)
        if not isinstance(band, int) or not 1 <= band <= src.count:
            raise ValueError("Choose an existing raster band")
        units = spec.get("units") or src.units[band-1] or src.tags(band).get("units")
        if spec.get("purpose") in {"physical", "difference", "priority", "categorical"} and not units:
            raise ValueError("Declare the actual units or categorical meaning: " + spec["id"])
        scale, offset = float(src.scales[band-1]), float(src.offsets[band-1])
        if not math.isfinite(scale) or not math.isfinite(offset):
            raise ValueError("Raster band scale and offset must be finite")
        raw_minimum, raw_maximum = math.inf, -math.inf
        valid_count, minimum, maximum, invalid_count = 0, math.inf, -math.inf, 0
        classes = {}
        for y in range(0, src.height, 512):
            for x in range(0, src.width, 512):
                a = src.read(band, window=Window(x, y, min(512, src.width-x), min(512, src.height-y)), masked=True)
                raw = a.compressed()
                finite = raw[np.isfinite(raw)]
                invalid_count += len(raw)-len(finite)
                if finite.size:
                    raw_minimum = min(raw_minimum, float(finite.min()))
                    raw_maximum = max(raw_maximum, float(finite.max()))
                    finite = finite.astype("float64") * scale + offset
                    if not np.all(np.isfinite(finite)):
                        raise ValueError("Band scale/offset produces non-finite physical values")
                    valid_count += int(finite.size)
                    minimum = min(minimum, float(finite.min()))
                    maximum = max(maximum, float(finite.max()))
                    if spec.get("purpose") == "categorical":
                        if np.any(finite != np.floor(finite)):
                            raise ValueError("Categorical raster contains fractional classes")
                        values, counts = np.unique(finite, return_counts=True)
                        for value, count in zip(values, counts):
                            key = str(int(value))
                            classes[key] = classes.get(key, 0) + int(count)
        crs = CRS.from_user_input(src.crs)
        return {"kind": "raster", "driver": src.driver, "band": band, "bands": src.count,
                "width": src.width, "height": src.height, "dtype": src.dtypes[band-1],
                "crs": crs.to_string(), "crs_wkt": crs.to_wkt(),
                "bounds": _finite_bounds(src.bounds),
                "project_bounds": _project_bounds(src.bounds, crs, project_crs),
                "transform": list(src.transform)[:6], "units": units or "not declared",
                "nodata": float(src.nodata) if src.nodata is not None and math.isfinite(src.nodata) else None,
                "nodata_is_nonfinite": src.nodata is not None and not math.isfinite(src.nodata),
                "scale": scale, "offset": offset,
                "raw_minimum": raw_minimum if valid_count else None,
                "raw_maximum": raw_maximum if valid_count else None,
                "valid_cells": valid_count, "nonfinite_unmasked_cells": invalid_count,
                "total_cells": src.width * src.height,
                "minimum": minimum if valid_count else None, "maximum": maximum if valid_count else None,
                "classes": classes, "statistics_basis": "all finite unmasked cells with declared band scale and offset; original bytes unchanged"}


def _vector_path(path: Path) -> str:
    return "/vsigzip/" + str(path) if path.suffix.lower() == ".gz" else str(path)


def vector_to_working(source: Path, target: Path, spec: dict, project_crs: str) -> dict:
    """Preserve every selected row, original row identity and the source CRS."""
    import fiona
    from pyproj import CRS
    target.parent.mkdir(parents=True, exist_ok=True)
    target.unlink(missing_ok=True)
    with fiona.open(_vector_path(source), layer=spec.get("layer")) as src:
        if not src.crs_wkt and not src.crs:
            raise ValueError("Vector CRS is missing: " + spec["id"])
        crs = CRS.from_user_input(src.crs_wkt or src.crs)
        names = list(src.schema["properties"])
        identity_field = "source_row_id"
        while identity_field.lower() in {n.lower() for n in names}:
            identity_field = "_" + identity_field
        properties = {identity_field: "str"}
        field_map = {}
        for name, dtype in src.schema["properties"].items():
            rename = name
            if rename.lower() == "fid":
                rename = "source_fid_attribute"
            while rename.lower() in {n.lower() for n in properties}:
                rename = "_" + rename
            properties[rename] = dtype
            field_map[name] = rename
        where = spec.get("where", {})
        if not isinstance(where, dict) or set(where)-set(names):
            raise ValueError("Vector selection must name existing fields with exact values")
        count, null_geometry = 0, 0
        geometry_types = set()
        with fiona.open(target, "w", driver="GPKG", layer="features", crs_wkt=crs.to_wkt(),
                        schema={"geometry": "Unknown", "properties": properties}) as dst:
            for row in src:
                if any(row["properties"].get(k) != v for k, v in where.items()):
                    continue
                props = {field_map[k]: v for k, v in row["properties"].items()}
                props[identity_field] = str(row.id)
                dst.write({"geometry": row["geometry"], "properties": props})
                count += 1
                if row["geometry"]:
                    geometry_types.add(row["geometry"]["type"])
                null_geometry += row["geometry"] is None
        if count == 0:
            raise ValueError("Vector selection is empty: " + spec["id"])
    with fiona.open(target, layer="features") as actual:
        if len(actual) != count:
            raise ValueError("Working GeoPackage did not retain every selected row")
        bounds = _finite_bounds(actual.bounds)
        return {"kind": "vector", "driver": "GPKG", "layer": "features",
                "feature_count": count, "null_geometries": null_geometry, "geometry_types": sorted(geometry_types),
                "crs": crs.to_string(), "crs_wkt": crs.to_wkt(),
                "bounds": bounds, "project_bounds": _project_bounds(bounds, crs, project_crs),
                "fields": dict(actual.schema["properties"]), "source_field_map": field_map,
                "source_identity_field": identity_field,
                "units": spec.get("units", "source attributes"), "where": where}


def _palette(classes: dict) -> list[dict]:
    values = sorted(int(v) for v in classes)
    return [{"value": v, "label": str(v), "color": "#" + (f"{round(40 + i*180/max(1,len(values)-1)):02x}"*3)}
            for i, v in enumerate(values)]



def atlas_styles(layer: dict) -> list[dict]:
    """Retain each saved atlas range as a named style on the same native layer."""
    source = layer.get("source", {})
    if source.get("kind") != "original completed delivery dataset":
        return []
    dataset = source.get("dataset", {})
    maps = dataset.get("maps")
    if dataset.get("schema") != "upstate.atlas-dataset/v1" or not isinstance(maps, list) or not maps:
        raise ValueError("An atlas GIS layer needs its original dataset and map relationships")
    signed = layer.get("purpose") == "difference"
    if dataset.get("signed") is not signed or dataset.get("units") != layer["data"]["units"]:
        raise ValueError("The original atlas quantity differs from this GIS layer")
    band_scale, offset = layer["data"]["scale"], layer["data"]["offset"]
    if not math.isfinite(band_scale) or band_scale == 0 or not math.isfinite(offset):
        raise ValueError("An atlas legend needs a finite, nonzero native band scale")
    # This is the same palette API used by maintained cartography.map_pdf.
    # Retain the resolved colors so receiving/sealing does not need Matplotlib.
    palette_name = "RdBu_r" if signed else "Greys"
    old = {row["id"]: row for row in layer.get("atlas_styles", [])}
    palette = None
    variants = {}
    for relation in maps:
        scale = relation.get("display_scale")
        if not isinstance(scale, dict):
            raise ValueError("Rebuild the original atlas edition to retain its exact display scale")
        low, high = scale.get("minimum"), scale.get("maximum")
        if (isinstance(low, bool) or isinstance(high, bool)
                or not isinstance(low, (int, float)) or not isinstance(high, (int, float))
                or not math.isfinite(low) or not math.isfinite(high) or low >= high
                or scale.get("signed") is not signed
                or scale.get("units") != layer["data"]["units"]
                or (signed and not low < 0 < high) or (not signed and low != 0)):
            raise ValueError("The saved atlas scale has incompatible bounds, sign or units")
        if not isinstance(relation.get("map_key"), str) or not isinstance(relation.get("panel"), int):
            raise ValueError("An atlas style needs its original map and panel identity")
        identity = fingerprint({"scale": scale, "palette": palette_name,
                                "band_scale": band_scale, "band_offset": offset})
        if identity in variants:
            variants[identity]["maps"].append(json.loads(canonical(relation)))
            continue
        retained = old.get(identity, {}).get("style", {})
        if (retained.get("palette") == palette_name
                and isinstance(retained.get("colors"), list) and len(retained["colors"]) == 256
                and all(isinstance(color, list) and len(color) == 4
                        and all(type(v) is int and 0 <= v <= 255 for v in color)
                        for color in retained["colors"])):
            colors = retained["colors"]
            palette_version = retained.get("palette_version")
        else:
            if palette is None:
                import matplotlib
                import numpy as np
                palette = (matplotlib.colormaps[palette_name](np.arange(256), bytes=True).tolist(),
                           matplotlib.__version__)
            colors, palette_version = palette
        def raw_at(fraction):
            if signed:
                return low * (1 - fraction * 2) if fraction <= .5 else high * (fraction * 2 - 1)
            return low + (high - low) * fraction
        physical_low, physical_high = low * band_scale + offset, high * band_scale + offset
        if not all(math.isfinite(v) for v in (physical_low, physical_high)) or physical_low == physical_high:
            raise ValueError("Native scale/offset cannot represent this saved atlas range")
        def entry(value, rgba):
            return {"value": value, "color": "#" + "".join(format(v, "02x") for v in rgba[:3]),
                    "alpha": rgba[3]}
        entries = [entry(physical_low, colors[0])]
        for index in range(1, 256):
            boundary = raw_at(index / 256) * band_scale + offset
            # Adjacent representable values retain Matplotlib's discrete LUT,
            # while QGIS's INTERPOLATED mode keeps under/over values visible.
            before = math.nextafter(boundary, -math.inf if band_scale > 0 else math.inf)
            entries.extend((entry(before, colors[index - 1]), entry(boundary, colors[index])))
        entries.append(entry(physical_high, colors[-1]))
        entries.sort(key=lambda row: row["value"])
        if any(not math.isfinite(row["value"]) for row in entries) or any(
                a["value"] >= b["value"] for a, b in zip(entries, entries[1:])):
            raise ValueError("The saved atlas range is too narrow for distinct native legend stops")
        style = {"type": "atlas", "minimum": min(physical_low, physical_high),
                 "maximum": max(physical_low, physical_high),
                 "center": offset if signed else None, "signed": signed,
                 "units": layer["data"]["units"], "palette": palette_name,
                 "palette_version": palette_version, "colors": colors, "entries": entries,
                 "source_scale": json.loads(canonical(scale)),
                 "band_scale": band_scale, "band_offset": offset,
                 "basis": "original saved atlas display scale and maintained map palette",
                 "label": scale.get("label", ""), "outside_range": "endpoint colors; cells remain visible"}
        name = str(relation["map_key"]) + " · panel " + str(relation["panel"]) + " · " + identity[:10]
        variants[identity] = {"id": identity, "name": name, "style": style,
                              "maps": [json.loads(canonical(relation))]}
        if "qml" in old.get(identity, {}):
            variants[identity]["qml"] = old[identity]["qml"]
    return list(variants.values())


def _atlas_rgba(values, valid, style):
    import numpy as np
    raw = (values[valid] - style["band_offset"]) / style["band_scale"]
    low, high = style["source_scale"]["minimum"], style["source_scale"]["maximum"]
    if style["signed"]:
        normalized = np.where(raw <= 0, .5 * (raw - low) / -low, .5 + .5 * raw / high)
    else:
        normalized = (raw - low) / (high - low)
    indices = np.minimum((np.clip(normalized, 0, 1) * 256).astype("uint16"), 255)
    rgba = np.zeros((*values.shape, 4), dtype="uint8")
    rgba[valid] = np.asarray(style["colors"], dtype="uint8")[indices]
    return rgba


def _atlas_renderer(parent, data, style):
    pipe = _element(parent, "pipe")
    renderer = _element(pipe, "rasterrenderer", type="singlebandpseudocolor",
                        band=data["band"], alphaBand="-1", opacity="1",
                        classificationMin=style["minimum"], classificationMax=style["maximum"])
    _element(renderer, "rasterTransparency")
    shader = _element(_element(renderer, "rastershader"), "colorrampshader",
                      colorRampType="INTERPOLATED", classificationMode="1", clip="0",
                      minimumValue=style["minimum"], maximumValue=style["maximum"], labelPrecision="12")
    for row in style["entries"]:
        _element(shader, "item", value=row["value"], color=row["color"],
                 alpha=row["alpha"], label=format(row["value"], ".12g"))
    _element(shader, "rampLegendSettings", useContinuousLegend="1",
             minimumLabel=format(style["minimum"], ".12g"),
             maximumLabel=format(style["maximum"], ".12g"), suffix=" " + style["units"])
    _element(pipe, "rasterresampler", maxOversampling="2")
    return pipe


def _atlas_named_styles(parent, layer):
    variants = layer["atlas_styles"]
    manager = _element(parent, "map-layer-style-manager", current=variants[0]["name"])
    for index, variant in enumerate(variants):
        saved = _element(manager, "map-layer-style", name=variant["name"])
        qml = ET.Element("qgis", version="3.34.0", styleCategories="Symbology")
        _atlas_renderer(qml, layer["data"], variant["style"])
        if index:
            saved.append(qml)
        # Standalone QML is also a normal native style file in the complete package.
        yield variant, ET.tostring(qml, encoding="utf-8", xml_declaration=True)


def styles(layers: list[dict]) -> None:
    """Use identical limits for physically comparable baseline/alternative layers."""
    groups = {}
    for layer in layers:
        d = layer["data"]
        if d["kind"] != "raster":
            continue
        if layer.get("purpose") == "categorical":
            layer["style"] = {"type": "categories", "entries": _palette(d["classes"])}
            continue
        variants = atlas_styles(layer)
        if variants:
            layer["atlas_styles"] = variants
            layer["style"] = variants[0]["style"]
            continue
        key = (layer.get("metric", layer["id"]), d["units"], layer.get("purpose", "context"))
        groups.setdefault(key, []).append(layer)
    for group in groups.values():
        meaningful = [x for x in group if x["data"]["minimum"] is not None]
        lo = min((x["data"]["minimum"] for x in meaningful), default=0)
        hi = max((x["data"]["maximum"] for x in meaningful), default=1)
        if group[0].get("purpose") == "difference":
            hi = max(abs(lo), abs(hi)); lo = -hi
        if hi == lo:
            hi = lo + max(1, abs(lo)*0.01)
        for layer in group:
            layer["style"] = {"type": "gray", "minimum": lo, "maximum": hi,
                               "basis": "shared physical full-native-cell range for matching metric, units and purpose",
                               "shared_with": [x["id"] for x in group]}


def preview_raster(root: Path, layer: dict, project_crs: str) -> dict:
    import numpy as np
    import rasterio
    from rasterio.transform import from_bounds
    from rasterio.warp import reproject, Resampling
    from PIL import Image
    bounds = layer["data"]["project_bounds"]
    dx, dy = max(bounds[2]-bounds[0], 1e-12), max(bounds[3]-bounds[1], 1e-12)
    width, height = (1024, max(1, round(1024*dy/dx))) if dx >= dy else (max(1, round(1024*dx/dy)), 1024)
    output = np.full((height, width), np.nan, dtype="float64")
    with rasterio.open(local(root, layer["working_path"])) as src:
        reproject(rasterio.band(src, layer["data"]["band"]), output,
                  src_transform=src.transform, src_crs=src.crs, src_nodata=src.nodata,
                  dst_transform=from_bounds(*bounds, width, height), dst_crs=project_crs,
                  dst_nodata=np.nan, resampling=Resampling.nearest, num_threads=1)
        # Dataset masks may be external .msk companions. Reproject their actual validity too.
        from rasterio.vrt import WarpedVRT
        with WarpedVRT(src, crs=project_crs, transform=from_bounds(*bounds, width, height),
                       width=width, height=height, resampling=Resampling.nearest) as view:
            valid = (view.read_masks(layer["data"]["band"]) > 0) & np.isfinite(output)
    # QgsRasterDataProvider::block applies the same native band scale and offset.
    output = output * layer["data"]["scale"] + layer["data"]["offset"]
    variants = layer.get("atlas_styles")
    if variants:
        for variant in variants:
            image = _atlas_rgba(output, valid, variant["style"])
            target = root / "previews" / (layer["key"] + "-" + variant["id"][:16] + ".png")
            target.parent.mkdir(exist_ok=True)
            Image.fromarray(image).save(target)
            variant["preview"] = {**record(root, target), "bounds": bounds, "width": width, "height": height,
                                  "method": "nearest-cell overview with the selected original atlas legend"}
        selected = next((item for item in variants if item["id"] == layer.get("atlas_view_style")), variants[0])
        layer["style"] = selected["style"]
        return selected["preview"]
    gray = np.zeros((height, width), dtype="uint8")
    style = layer["style"]
    if style["type"] == "categories":
        for entry in style["entries"]:
            gray[valid & (output == entry["value"])] = int(entry["color"][1:3], 16)
    else:
        lo, hi = style["minimum"], style["maximum"]
        gray[valid] = np.clip(245-(output[valid]-lo)/(hi-lo)*215, 30, 245).astype("uint8")
    image = np.stack([gray, gray, gray, valid.astype("uint8")*255], axis=-1)
    target = root / "previews" / (layer["key"] + ".png")
    target.parent.mkdir(exist_ok=True)
    Image.fromarray(image).save(target)
    return {**record(root, target), "bounds": bounds, "width": width, "height": height,
            "method": "nearest-cell display overview; full original cells remain in the GIS layer"}


def preview_vector(root: Path, layer: dict, project_crs: str) -> dict:
    import fiona
    from shapely.geometry import shape
    from shapely.ops import transform
    from pyproj import Transformer
    bounds = layer["data"]["project_bounds"]
    width, height = max(bounds[2]-bounds[0], 1e-8), max(bounds[3]-bounds[1], 1e-8)
    tolerance = max(width, height)/4096
    converter = Transformer.from_crs(layer["data"]["crs_wkt"], project_crs, always_xy=True).transform
    def line(coords):
        return "M" + " L".join(f"{x:.7g},{-y:.7g}" for x, y, *_ in coords)
    def paths(geom):
        if geom.geom_type == "Polygon":
            return [line(geom.exterior.coords) + " Z " + " ".join(line(r.coords)+" Z" for r in geom.interiors)]
        if geom.geom_type in ("LineString", "LinearRing"):
            return [line(geom.coords)]
        if hasattr(geom, "geoms"):
            return [p for g in geom.geoms for p in paths(g)]
        return []
    doc = ET.Element("svg", {"xmlns": "http://www.w3.org/2000/svg",
                             "viewBox": f"{bounds[0]} {-bounds[3]} {width} {height}",
                             "width": "1024", "height": str(max(1, round(1024*height/width)))})
    ET.SubElement(doc, "title").text = layer["title"]
    count = 0
    with fiona.open(local(root, layer["working_path"]), layer=layer["data"]["layer"]) as src:
        for row in src:
            if not row["geometry"]:
                continue
            g = transform(converter, shape(row["geometry"]))
            g = g.simplify(tolerance, preserve_topology=True)
            if g.geom_type == "Point":
                ET.SubElement(doc, "circle", {"cx": str(g.x), "cy": str(-g.y),
                    "r": str(max(width,height)/300), "fill": "#444"})
            else:
                for d in paths(g):
                    ET.SubElement(doc, "path", {"d": d, "fill": "none", "stroke": "#333",
                        "stroke-width": str(max(width,height)/900), "fill-rule": "evenodd"})
            count += 1
    target = root / "previews" / (layer["key"] + ".svg")
    target.parent.mkdir(exist_ok=True)
    ET.ElementTree(doc).write(target, encoding="utf-8", xml_declaration=True)
    return {**record(root, target), "bounds": bounds, "features_drawn": count,
            "simplification_tolerance_project_units": tolerance,
            "method": "topology-preserving display simplification only; working GeoPackage retains full geometry"}


def _element(parent, tag, text=None, **attrs):
    e = ET.SubElement(parent, tag, {k: str(v) for k,v in attrs.items()})
    if text is not None:
        e.text = str(text)
    return e


def _srs(parent, crs_value):
    from pyproj import CRS
    crs = CRS.from_user_input(crs_value)
    e = _element(parent, "spatialrefsys")
    _element(e, "wkt", crs.to_wkt())
    _element(e, "authid", crs.to_authority() and ":".join(crs.to_authority()) or "")
    _element(e, "description", crs.name)
    _element(e, "geographicflag", "true" if crs.is_geographic else "false")


def _extent(parent, b):
    e = _element(parent, "extent")
    for key, value in zip(("xmin", "ymin", "xmax", "ymax"), b):
        _element(e, key, value)



def atlas_desktop_binding(layer, map_layer):
    """Recognize saved native styles without overwriting recipient style edits."""
    variants = layer.get("atlas_styles", [])
    if not variants:
        return
    renderer = map_layer.find("./pipe/rasterrenderer")
    manager = map_layer.find("./map-layer-style-manager")
    binding = {"state": "recipient_desktop_style",
               "native_name": manager.get("current", "") if manager is not None else "",
               "offline_basis": "Original atlas views; the recipient desktop renderer remains in project.qgs."}
    if renderer is not None:
        binding["renderer_sha256"] = hashlib.sha256(ET.tostring(renderer, encoding="utf-8")).hexdigest()
        shader = renderer.find("./rastershader/colorrampshader")
        if renderer.get("type") == "singlebandpseudocolor" and shader is not None:
            try:
                observed = [{"value": float(row.get("value")), "color": row.get("color", "").lower(),
                             "alpha": int(row.get("alpha", "255"))} for row in shader.findall("item")]
                for variant in variants:
                    style = variant["style"]
                    rows = style["entries"]
                    if (shader.get("colorRampType") == "INTERPOLATED" and shader.get("clip", "0") == "0"
                            and not list(renderer.find("rasterTransparency") or [])
                            and all(child.tag in {"rasterrenderer", "rasterresampler"}
                                    for child in map_layer.find("pipe"))
                            and float(map_layer.findtext("layerOpacity", "1")) == 1
                            and int(renderer.get("band", "-1")) == layer["data"]["band"]
                            and float(renderer.get("opacity", "1")) == 1
                            and int(renderer.get("alphaBand", "-1")) == -1
                            and len(observed) == len(rows)
                            and all(math.isclose(a["value"], b["value"], rel_tol=1e-12, abs_tol=0)
                                    and a["color"] == b["color"] and a["alpha"] == b["alpha"]
                                    for a, b in zip(observed, rows))):
                        layer["atlas_view_style"] = variant["id"]
                        layer["style"] = style
                        binding.update(state="matches_retained_atlas_style", style_id=variant["id"],
                                       offline_basis="Selected retained atlas legend")
                        break
            except (TypeError, ValueError, OverflowError):
                pass
    layer["atlas_desktop_binding"] = binding


def qgis_project(root: Path, manifest: dict) -> None:
    """Write documented QGS layer references, CRS, styles, metadata and grouping."""
    from pyproj import CRS
    crs = CRS.from_user_input(manifest["project_crs"])
    q = ET.Element("qgis", {"version": "3.34.0", "projectname": manifest["title"]})
    _element(q, "title", manifest["title"])
    _element(q, "homePath", path="")
    _srs(_element(q, "projectCrs"), crs)
    _element(q, "autotransaction", active="0")
    props = _element(q, "properties")
    _element(_element(props, "Paths"), "Absolute", "false", type="bool")
    _element(_element(props, "TokenJunkieLabs"), "selection_id", manifest["selection_id"], type="QString")
    tree = _element(q, "layer-tree-group", name="", checked="Qt::Checked", expanded="1")
    _element(tree, "customproperties")
    groups = {}
    projectlayers = _element(q, "projectlayers")
    for layer in manifest["layers"]:
        d = layer["data"]
        group = groups.get(layer["group"])
        if group is None:
            group = _element(tree, "layer-tree-group", name=layer["group"], checked="Qt::Checked", expanded="1")
            _element(group, "customproperties")
            groups[layer["group"]] = group
        uri = "./" + layer["working_path"]
        if d["kind"] == "vector":
            uri += "|layername=" + d["layer"]
        label = layer["title"] + " [" + d["units"] + "]"
        _element(group, "layer-tree-layer", id=layer["key"], name=label, source=uri,
                 providerKey="ogr" if d["kind"]=="vector" else "gdal", expanded="1",
                 checked="Qt::Checked" if layer["visible"] else "Qt::Unchecked")
        m = _element(projectlayers, "maplayer", type=d["kind"], hasScaleBasedVisibilityFlag="0",
                     autoRefreshEnabled="0", readOnly="0")
        _element(m, "id", layer["key"])
        _element(m, "datasource", uri)
        _element(m, "layername", label)
        _element(m, "provider", "ogr" if d["kind"]=="vector" else "gdal", encoding="UTF-8")
        _extent(m, d["bounds"])
        _srs(_element(m, "srs"), d["crs_wkt"])
        cp = _element(m, "customproperties")
        for key in ("id", "purpose", "metric", "source", "run_id", "scenario_id", "profile_id", "direction"):
            if key in layer:
                _element(cp, "property", key="TokenJunkieLabs/"+key,
                         value=json.dumps(layer[key], ensure_ascii=False))
        _element(cp, "property", key="TokenJunkieLabs/units", value=d["units"])
        metadata = _element(m, "resourceMetadata")
        _element(metadata, "identifier", layer["key"])
        _element(metadata, "parentidentifier", manifest["selection_id"])
        _element(metadata, "title", label)
        _element(metadata, "type", "dataset")
        _element(metadata, "abstract", json.dumps({"source": layer.get("source", {}),
                    "units": d["units"], "purpose": layer.get("purpose"),
                    "run_id": layer.get("run_id"), "source_files": layer["originals"]}, ensure_ascii=False))
        if d["kind"] == "raster" and layer.get("atlas_styles"):
            _atlas_renderer(m, d, layer["style"])
            for variant, body in _atlas_named_styles(m, layer):
                target = root / "styles" / (layer["key"] + "-" + variant["id"][:16] + ".qml")
                target.parent.mkdir(exist_ok=True)
                target.write_bytes(body)
                variant["qml"] = record(root, target)
        elif d["kind"] == "raster":
            pipe = _element(m, "pipe")
            style = layer["style"]
            if style["type"] == "categories":
                renderer = _element(pipe, "rasterrenderer", type="paletted", band=d["band"], alphaBand="-1", opacity="1")
                palette = _element(renderer, "colorPalette")
                for item in style["entries"]:
                    _element(palette, "paletteEntry", value=item["value"], color=item["color"], alpha="255", label=item["label"])
            else:
                renderer = _element(pipe, "rasterrenderer", type="singlebandgray", grayBand=d["band"],
                                    alphaBand="-1", opacity="1", gradient="WhiteToBlack")
                _element(renderer, "rasterTransparency")
                contrast = _element(renderer, "contrastEnhancement")
                _element(contrast, "minValue", style["minimum"])
                _element(contrast, "maxValue", style["maximum"])
                _element(contrast, "algorithm", "StretchToMinimumMaximum")
            _element(pipe, "rasterresampler", maxOversampling="2")
        else:
            geometry_types = d.get("geometry_types", [])
            family = "fill" if any("Polygon" in g for g in geometry_types) else "line" if any("Line" in g for g in geometry_types) else "marker"
            renderer = _element(m, "renderer-v2", type="singleSymbol", symbollevels="0", enableorderby="0", forceraster="0")
            symbol = _element(_element(renderer, "symbols"), "symbol", type=family, name="0", alpha="1", clip_to_extent="1")
            sl = _element(symbol, "layer", **{"class": {"fill":"SimpleFill","line":"SimpleLine","marker":"SimpleMarker"}[family], "enabled":"1", "locked":"0", "pass":"0"})
            options = _element(sl, "Option", type="Map")
            settings = {"fill":{"color":"220,220,220,30","style":"no","outline_color":"45,45,45,255","outline_style":"solid","outline_width":"0.3"},
                        "line":{"line_color":"45,45,45,255","line_width":"0.35","line_style":"solid"},
                        "marker":{"name":"circle","color":"75,75,75,255","outline_color":"30,30,30,255","size":"2.2"}}[family]
            for k,v in settings.items():
                _element(options, "Option", type="QString", name=k, value=v)
            _element(m, "layerOpacity", "1")
    canvas = _element(q, "mapcanvas", name="theMapCanvas")
    _element(canvas, "units", "degrees" if crs.is_geographic else "meters")
    _extent(canvas, manifest["extent"])
    _element(canvas, "rotation", "0")
    _srs(_element(canvas, "destinationsrs"), crs)
    data = ET.tostring(q, encoding="utf-8", xml_declaration=True)
    (root / "project.qgs").write_bytes(data)
    with zipfile.ZipFile(root / "project.qgz", "w", compression=zipfile.ZIP_DEFLATED) as z:
        z.writestr("project.qgs", data)


def _bounds_union(layers):
    b = [l["data"]["project_bounds"] for l in layers]
    result = [min(x[0] for x in b), min(x[1] for x in b), max(x[2] for x in b), max(x[3] for x in b)]
    dx, dy = result[2]-result[0], result[3]-result[1]
    pad = max(dx, dy, 1)*0.025
    return [result[0]-pad, result[1]-pad, result[2]+pad, result[3]+pad]



def source_table_preview(root: Path, attachment: dict) -> dict | None:
    """Literal, offline display rows; the complete retained primary stays separate."""
    primary = attachment["files"][0]
    path = checked(root, primary)
    suffixes = [value.lower() for value in path.suffixes]
    compressed = suffixes[-1:] == [".gz"]
    suffix = suffixes[-2] if compressed and len(suffixes) > 1 else path.suffix.lower()
    declared = str((attachment.get("source") or {}).get("format") or "").lower()
    delimiter = "\t" if suffix == ".tsv" or declared == "tsv" else ","
    if suffix not in {".csv", ".tsv"} and declared not in {"csv", "tsv"}:
        return None
    result = {"format": "table", "columns": [], "rows": [], "complete": False,
              "row_limit": 2000, "character_limit": 1000000,
              "source_sha256": primary["sha256"], "source_bytes": primary["bytes"],
              "row_width_mismatches": 0}
    try:
        if compressed:
            import gzip
            stream = gzip.open(path, "rt", encoding="utf-8-sig", newline="")
        else:
            stream = path.open("r", encoding="utf-8-sig", newline="")
        with stream:
            reader = csv.reader(stream, delimiter=delimiter)
            header = next(reader, None)
            if header is None:
                result["complete"] = True
                return result
            result["columns"] = header
            characters = sum(len(cell) for cell in header)
            for row in reader:
                size = sum(len(cell) for cell in row)
                if len(result["rows"]) >= result["row_limit"] or characters + size > result["character_limit"]:
                    break
                result["rows"].append(row)
                characters += size
                if len(row) != len(header):
                    result["row_width_mismatches"] += 1
            else:
                result["complete"] = True
    except (UnicodeError, csv.Error, OSError, EOFError) as error:
        result["rows"] = []
        result["error"] = "The retained table could not be previewed as UTF-8 CSV/TSV (" + type(error).__name__ + "). Download its unchanged original file."
    return result


def catalogue(root: Path, manifest: dict) -> None:
    columns = ["id", "title", "group", "kind", "purpose", "units", "run_id", "scenario_id", "profile_id",
               "crs", "feature_count", "valid_cells", "working_path", "original_sha256"]
    with (root / "layers.csv").open("w", newline="", encoding="utf-8-sig") as out:
        writer = csv.DictWriter(out, fieldnames=columns)
        writer.writeheader()
        for l in manifest["layers"]:
            row = {k: l.get(k, "") for k in columns}
            row.update({k:l["data"].get(k, "") for k in ("kind", "units", "crs", "feature_count", "valid_cells")})
            row["original_sha256"] = l["originals"][0]["sha256"]
            # Protect spreadsheet consumers without modifying the scientific data.
            writer.writerow({k:("'"+v if isinstance(v,str) and v.startswith(("=","+","-","@")) else v) for k,v in row.items()})
    # Embed generated map overviews and literal table display rows for file:// use.
    # Complete original files remain explicit relative downloads; the original
    # project manifest stays compact and byte-addressable.
    import base64
    view_manifest = json.loads(canonical(manifest))
    for layer in view_manifest["layers"]:
        preview = local(root, layer["preview"]["path"])
        mime = "image/svg+xml" if preview.suffix == ".svg" else "image/png"
        layer["preview"]["embedded_uri"] = "data:" + mime + ";base64," + base64.b64encode(preview.read_bytes()).decode("ascii")
        for variant in layer.get("atlas_styles", []):
            image = checked(root, variant["preview"])
            variant["preview"]["embedded_uri"] = "data:image/png;base64," + base64.b64encode(image.read_bytes()).decode("ascii")
    for attachment in view_manifest.get("attachments", []):
        attachment.update(attachment_metadata(manifest, attachment))
        if attachment["kind"] == "table":
            attachment["browser_table"] = source_table_preview(root, attachment)
    template = Path(__file__).with_name("gis_project_view.html").read_text(encoding="utf-8")
    data = canonical(view_manifest).decode().replace("<", "\\u003c").replace("&", "\\u0026")
    (root / "OPEN_GIS.html").write_text(template.replace("__PROJECT_JSON__", data), encoding="utf-8")
    (root / "OPEN_GIS.md").write_text(
        "# " + manifest["title"] + "\n\n"
        "Open OPEN_GIS.html for the layer map, Sources and tables desk, dated source metadata, "
        "literal table rows and every primary/companion download. Table display previews state whether "
        "all rows are included; the complete original table is always downloadable. Open project.qgz in QGIS "
        "for the complete editable GIS project. Keep the entire extracted directory together.\n\n"
        "Vector working copies are in layers/; original files and companions are retained under originals/. "
        "The source_row_id field maps each working feature to its native original. Raster cells and CRS "
        "are preserved; browser overviews are display products, not replacement numerical inputs.\n\n"
        "Toggle baseline/alternative groups rather than comparing unrelated legend ranges. Atlas layers retain their saved "
        "map ranges and palettes; choose the matching named style in QGIS or the offline Atlas view field. Other matching physical "
        "metric/units/purpose layers share a native-cell range. Dimensionless priorities, categorical codes, "
        "physical quantities and signed differences keep their own meanings. Read each layer's units and lineage.\n\n"
        "For an independent edit, use QGIS Save As within this directory, edit the copied GeoPackage and save. "
        "Use `python tools/model/gis_project_cli.py seal . --reason 'Describe the edit'` to retain the edited edition. "
        "Then `python tools/model/gis_project_cli.py pack . ../edited-gis.zip` and "
        "`python tools/model/gis_project_cli.py receive ../edited-gis.zip ../received-gis`. "
        "New external datasets must be imported by a new explicit export selection before handover. "
        "Keep original source files unchanged.\n", encoding="utf-8")


def inventory(root: Path) -> dict:
    # Historical inventories are intentionally included; only the root inventory is self-excluded.
    files = [record(root,p) for p in sorted(root.rglob("*")) if p.is_file() and p != root/"inventory.json"]
    result = {"schema": SCHEMA+"/inventory", "files": files, "fingerprint": fingerprint(files)}
    save(root/"inventory.json", result)
    return result



def attachment_metadata(manifest: dict, attachment: dict) -> dict:
    """Recover explicit attachment types, including retained version 1.2 requests.

    The request is authoritative only when the original logical identity,
    metadata, primary and ordered companions match the retained attachment.
    """
    matches = [row for row in (manifest.get("source_request") or {}).get("attachments", [])
               if row.get("id") == attachment.get("id")]
    if len(matches) > 1:
        raise ValueError("The received attachment has duplicate original request identities")
    requested = matches[0] if matches else None
    if requested is not None:
        expected = [(row["path"], row["bytes"], row["sha256"])
                    for row in [requested["file"], *requested.get("companions", [])]]
        actual = [(row.get("source_path"), row["bytes"], row["sha256"])
                  for row in attachment["files"]]
        if actual != expected or attachment.get("source", {}) != requested.get("source", {}):
            raise ValueError("The received attachment differs from its original source binding")
    metadata = {}
    for name in ("kind", "units"):
        if name in attachment:
            if requested is not None and name in requested and attachment[name] != requested[name]:
                raise ValueError("The received attachment changed its original " + name)
            metadata[name] = attachment[name]
        elif requested is not None and name in requested:
            metadata[name] = requested[name]
    metadata.setdefault("kind", "document")
    if metadata["kind"] not in {"table", "document"}:
        raise ValueError("The received attachment declares an unsupported source kind")
    return metadata


def verify(root: Path | str, *, native: bool = True) -> dict:
    root = Path(root).resolve(strict=True)
    inv, manifest = load(root/"inventory.json"), load(root/"project.json")
    if manifest.get("schema") != SCHEMA or inv.get("schema") != SCHEMA+"/inventory":
        raise ValueError("Select an editable GIS package")
    if fingerprint(inv["files"]) != inv["fingerprint"]:
        raise ValueError("Package inventory changed")
    expected = {r["path"] for r in inv["files"]}
    if len(expected) != len(inv["files"]):
        raise ValueError("Duplicate inventory member")
    seen = set()
    for p in root.rglob("*"):
        if p.is_symlink():
            raise ValueError("Package contains a symbolic link")
        if p.is_file():
            seen.add(p.relative_to(root).as_posix())
    if seen != expected | {"inventory.json"}:
        raise ValueError("Package has missing or untracked files")
    for r in inv["files"]:
        checked(root,r)
    for attachment in manifest.get("attachments", []):
        attachment_metadata(manifest, attachment)
    tree = ET.parse(root/"project.qgs")
    byid = {l["key"]:l for l in manifest["layers"]}
    maps = tree.findall("./projectlayers/maplayer")
    if len(maps) != len(byid) or {x.findtext("id") for x in maps} != set(byid):
        raise ValueError("QGIS layer identity differs from the exported selection")
    for m in maps:
        layer = byid[m.findtext("id")]
        uri = m.findtext("datasource", "")
        if uri.startswith("./"):
            uri = uri[2:]
        path, *options = uri.split("|")
        if path != layer["working_path"]:
            raise ValueError("QGIS reference no longer names its retained working layer")
        local(root,path)
        if options != (["layername="+layer["data"]["layer"]] if layer["data"]["kind"]=="vector" else []):
            raise ValueError("Unexpected QGIS datasource options")
    with zipfile.ZipFile(root/"project.qgz") as z:
        qgs = [n for n in z.namelist() if n.endswith(".qgs")]
        if len(qgs)!=1 or z.read(qgs[0]) != (root/"project.qgs").read_bytes():
            raise ValueError("Compressed and editable project editions disagree")
    if native:
        import fiona
        import rasterio
        for layer in manifest["layers"]:
            p = local(root,layer["working_path"])
            if layer["data"]["kind"]=="vector":
                with fiona.open(p,layer=layer["data"]["layer"]) as src:
                    if len(src) != layer["data"]["feature_count"]:
                        raise ValueError("GeoPackage feature count changed")
            else:
                with rasterio.open(p) as src:
                    if (src.width,src.height)!=(layer["data"]["width"],layer["data"]["height"]):
                        raise ValueError("Raster dimensions changed")
    return {"schema":SCHEMA+"/verification", "selection_id":manifest["selection_id"],
            "edition_id":manifest["edition_id"], "layers":len(manifest["layers"]),
            "files":len(inv["files"])+1, "bytes":sum(r["bytes"] for r in inv["files"]),
            "fingerprint":inv["fingerprint"], "data_readback":"Fiona/Rasterio" if native else "member hashes",
            "qgis_desktop_readback":manifest.get("native_qgis", {}).get("version")}


def build(spec: dict, source_root: Path | str, destination: Path | str,
          progress: Callable[[dict],None] | None = None) -> dict:
    from pyproj import CRS
    if spec.get("schema") != REQUEST_SCHEMA or not spec.get("layers"):
        raise ValueError("Select upstate.gis-request/v1 with at least one retained layer")
    if not spec.get("title") or not isinstance(spec["title"],str):
        raise ValueError("Give the GIS handover a title")
    project_crs = CRS.from_user_input(spec["project_crs"]).to_string()
    source_root, destination = Path(source_root).resolve(strict=True), Path(destination).resolve()
    if destination.is_relative_to(source_root) and destination == source_root:
        raise ValueError("Export to a separate directory")
    identities = [item["id"] for item in [*spec["layers"], *spec.get("attachments", [])]]
    if len(set(identities)) != len(identities) or any(not isinstance(x,str) or not x for x in identities):
        raise ValueError("Choose unique, nonempty logical layer and attachment identities")
    selection_id = fingerprint({"request":spec,"builder_version":VERSION})
    stage = destination.parent / ("."+destination.name+"-"+selection_id[:16]+".building")
    started = time.monotonic()
    destination.parent.mkdir(parents=True, exist_ok=True)
    with locked(destination.parent/("."+destination.name+".lock")):
        if destination.exists():
            if load(destination/"project.json").get("selection_id") != selection_id:
                raise FileExistsError("Destination contains another GIS selection")
            return {**verify(destination),"reused":True,"directory":str(destination)}
        stage.mkdir(exist_ok=True)
        def emit(phase, **kwargs):
            info = {"phase":phase,"selection_id":selection_id,"elapsed_seconds":round(time.monotonic()-started,4),**kwargs}
            save(stage/"progress.json",info)
            if progress:
                progress(info)
        emit("receiving-originals",layers=len(identities))
        layers=[]
        try:
            for index, row in enumerate(spec["layers"]):
                row=dict(row)
                if row.get("kind") not in ("vector","raster"):
                    raise ValueError("Select vector or raster layers")
                if row.get("purpose") == "difference" and not row.get("direction"):
                    raise ValueError("A difference layer needs its actual subtraction direction")
                originals=[row["file"]]+row.get("companions",[])
                for rec in originals:
                    checked(source_root,rec)
                if row["kind"]=="raster":
                    import rasterio
                    original_paths={gis_path.resolve() for gis_path in (local(source_root,r["path"]) for r in originals)}
                    with rasterio.open(local(source_root,row["file"]["path"])) as dataset:
                        if dataset.driver!="GTiff":
                            raise ValueError("Prepare external-reference raster formats as retained GeoTIFFs first")
                        missing=[f for f in dataset.files if Path(f).resolve() not in original_paths]
                        if missing:
                            raise ValueError("Declare every original raster companion before export: "+", ".join(Path(f).name for f in missing))
                common=os.path.commonpath([str(PurePosixPath(r["path"]).parent) for r in originals])
                group=fingerprint(originals)
                copied=[]
                folded=set()
                for rec in originals:
                    rel=PurePosixPath(rec["path"]).relative_to(common or ".").as_posix()
                    norm=unicodedata.normalize("NFC",rel).casefold()
                    if norm in folded:
                        raise ValueError("Original companions have colliding portable names")
                    folded.add(norm)
                    target=stage/"originals"/group/rel
                    copy_checked(source_root,rec,target)
                    copied.append({**record(stage,target),"source_path":rec["path"]})
                key="gis_"+fingerprint({"id":row["id"],"originals":originals,"selection":row.get("where")})[:32]
                primary=local(stage,copied[0]["path"])
                public={k:v for k,v in row.items() if k not in {"file","companions","kind","layer","where"}}
                layer={**public,"key":key,"group":row.get("group","Study inputs"),"originals":copied,
                       "visible":bool(row.get("visible",index==0))}
                emit("preparing-layer",layer=row["id"],index=index+1,total=len(identities))
                if row["kind"]=="vector":
                    working=stage/"layers"/(key+".gpkg")
                    layer["data"]=vector_to_working(primary,working,row,project_crs)
                else:
                    # Independent copies, not hardlinks: recipient edits cannot mutate retained originals.
                    working=stage/"layers"/key/primary.name
                    working.parent.mkdir(parents=True,exist_ok=True)
                    for rec in copied:
                        original=local(stage,rec["path"])
                        relative=original.relative_to(stage/"originals"/group)
                        dst=working.parent/relative
                        dst.parent.mkdir(parents=True,exist_ok=True)
                        shutil.copyfile(original,dst)
                    working=working.parent/primary.relative_to(stage/"originals"/group)
                    layer["data"]=inspect_raster(working,row,project_crs)
                    import rasterio
                    with rasterio.open(working) as src:
                        for dependency in src.files:
                            dep=Path(dependency)
                            if not dep.resolve().is_relative_to((stage/"layers"/key).resolve()) or not dep.is_file():
                                raise ValueError("Raster dependency is not retained beside its native data")
                layer["working_path"]=working.relative_to(stage).as_posix()
                layers.append(layer)
            styles(layers)
            for layer in layers:
                emit("rendering-overview",layer=layer["id"])
                layer["preview"]=(preview_vector if layer["data"]["kind"]=="vector" else preview_raster)(stage,layer,project_crs)
            focus=[x for x in layers if x["id"]==spec.get("focus_layer_id")]
            if spec.get("focus_layer_id") and not focus:
                raise ValueError("Focus layer is not selected")
            attachments=[]
            for item in spec.get("attachments",[]):
                kind = item.get("kind", "document")
                if kind not in {"table", "document"}:
                    raise ValueError("An attached source must declare table or document kind")
                files=[]
                original_documents=[item["file"]]+item.get("companions",[])
                common=os.path.commonpath([str(PurePosixPath(r["path"]).parent) for r in original_documents])
                group=fingerprint(original_documents) if len(original_documents)>1 else original_documents[0]["sha256"]
                names=set()
                for rec in original_documents:
                    rel=PurePosixPath(rec["path"]).relative_to(common or ".").as_posix()
                    folded=unicodedata.normalize("NFC",rel).casefold()
                    if folded in names:raise ValueError("Document companions have colliding portable names")
                    names.add(folded)
                    target=stage/"documents"/group/rel
                    copy_checked(source_root,rec,target)
                    files.append({**record(stage,target),"source_path":rec["path"]})
                attachment = {"id": item["id"], "title": item["title"], "kind": kind,
                              "files": files, "source": item.get("source", {})}
                if "units" in item:
                    attachment["units"] = item["units"]
                attachments.append(attachment)
            manifest={"schema":SCHEMA,"builder_version":VERSION,"selection_id":selection_id,
                      "edition_id":selection_id,"title":spec["title"],"project_crs":project_crs,
                      "extent":_bounds_union(focus or layers),"layers":layers,"attachments":attachments,
                      "provenance":spec.get("provenance",{}),"history":[],
                      "source_request":spec,"elapsed_seconds":round(time.monotonic()-started,4)}
            qgis_project(stage,manifest)
            catalogue(stage,manifest)
            save(stage/"project.json",manifest)
            tools=stage/"tools"/"model"
            tools.mkdir(parents=True,exist_ok=True)
            for name in ("gis_project.py","gis_project_cli.py","gis_project_view.html","gis_project_native.py","gis_workspace.py"):
                shutil.copyfile(Path(__file__).with_name(name),tools/name)
            (stage/"progress.json").unlink(missing_ok=True)
            inventory(stage)
            result=verify(stage)
            os.replace(stage,destination)
            return {**result,"directory":str(destination),"reused":False,"elapsed_seconds":round(time.monotonic()-started,4)}
        except BaseException as exc:
            emit("failed",error={"type":type(exc).__name__,"message":str(exc)})
            raise


def pack(root: Path | str, destination: Path | str) -> dict:
    root,destination=Path(root).resolve(strict=True),Path(destination).resolve()
    result=verify(root)
    if destination.is_relative_to(root):
        raise ValueError("Write the ZIP outside the working GIS directory")
    destination.parent.mkdir(parents=True,exist_ok=True)
    temporary=destination.with_name(destination.name+".pending-"+uuid.uuid4().hex)
    try:
        with zipfile.ZipFile(temporary,"w",compression=zipfile.ZIP_DEFLATED,compresslevel=6,allowZip64=True) as z:
            for p in sorted(root.rglob("*")):
                if p.is_file():
                    z.write(p,p.relative_to(root).as_posix())
        with zipfile.ZipFile(temporary) as z:
            captured=json.loads(z.read("inventory.json"))
            for rec in captured["files"]:
                h=hashlib.sha256();count=0
                with z.open(rec["path"]) as data:
                    for chunk in iter(lambda:data.read(CHUNK),b""):
                        h.update(chunk);count+=len(chunk)
                if count!=rec["bytes"] or h.hexdigest()!=rec["sha256"]:
                    raise ValueError("File changed while packaging: "+rec["path"])
        if destination.exists():
            if sha256(destination)!=sha256(temporary):
                raise FileExistsError("Archive destination already contains another edition")
        else:
            os.link(temporary,destination)
        return {**result,"archive":str(destination),"archive_bytes":destination.stat().st_size,"archive_sha256":sha256(destination)}
    finally:
        temporary.unlink(missing_ok=True)


def receive(archive: Path | str, destination: Path | str) -> dict:
    archive,destination=Path(archive).resolve(strict=True),Path(destination).resolve()
    if destination.exists():
        raise FileExistsError("Receive into a new directory")
    destination.parent.mkdir(parents=True,exist_ok=True)
    staging=Path(tempfile.mkdtemp(prefix=".gis-receiving-",dir=destination.parent))
    try:
        with zipfile.ZipFile(archive) as z:
            names=set(); folded=set()
            for entry in z.infolist():
                if entry.is_dir():
                    continue
                p=member(entry.filename)
                norm=unicodedata.normalize("NFC",str(p)).casefold()
                mode=entry.external_attr>>16
                if stat.S_ISLNK(mode) or (stat.S_IFMT(mode) not in (0,stat.S_IFREG)):
                    raise ValueError("Archive contains a nonregular member")
                if entry.filename in names or norm in folded:
                    raise ValueError("Archive members collide")
                if entry.flag_bits & 1:
                    raise ValueError("Encrypted members are not supported")
                names.add(entry.filename);folded.add(norm)
            if not {"inventory.json","project.json","project.qgs","project.qgz"}<=names:
                raise ValueError("Archive lacks the editable GIS project")
            total=sum(x.file_size for x in z.infolist())
            if total>shutil.disk_usage(staging).free:
                raise OSError("Receiving volume lacks space for the complete uncompressed GIS project")
            for entry in z.infolist():
                if entry.is_dir():
                    continue
                target=staging/member(entry.filename)
                target.parent.mkdir(parents=True,exist_ok=True)
                with z.open(entry) as src,target.open("xb") as out:
                    shutil.copyfileobj(src,out,CHUNK)
        result=verify(staging)
        # Avoid replacement if another receiver completed this destination concurrently.
        with locked(destination.parent/("."+destination.name+".lock")):
            if destination.exists():
                raise FileExistsError("Receiving destination was created by another operation")
            os.replace(staging,destination)
        return {**result,"directory":str(destination),"archive_sha256":sha256(archive)}
    finally:
        if staging.exists():
            shutil.rmtree(staging)


def seal(root: Path | str, reason: str, *, project_file: str | None=None) -> dict:
    """Record intentional recipient edits; original source bytes stay unchanged."""
    root=Path(root).resolve(strict=True)
    if not isinstance(reason,str) or not reason.strip():
        raise ValueError("Describe the recipient's edit")
    with locked(root.parent/("."+root.name+".lock")):
        manifest,old=load(root/"project.json"),load(root/"inventory.json")
        if fingerprint(old["files"])!=old["fingerprint"]:
            raise ValueError("Previous inventory changed")
        for layer in manifest["layers"]:
            for original in layer["originals"]:
                checked(root,original)
        for attachment in manifest.get("attachments",[]):
            for original in attachment["files"]:
                checked(root,original)
        for wal in root.glob("layers/**/*.gpkg-wal"):
            if wal.stat().st_size:
                raise ValueError("Save and close the active GeoPackage edit before sealing its file edition")
        previous={x["path"]:x for x in old["files"]}
        qgs_changed=sha256(root/"project.qgs")!=previous["project.qgs"]["sha256"]
        qgz_changed=sha256(root/"project.qgz")!=previous["project.qgz"]["sha256"]
        if project_file is None:
            if qgs_changed and qgz_changed:
                raise ValueError("Both project files changed; select project.qgs or project.qgz explicitly")
            project_file="project.qgz" if qgz_changed else "project.qgs"
        if project_file not in {"project.qgs","project.qgz"}:
            raise ValueError("Choose project.qgs or project.qgz")
        if project_file=="project.qgz":
            with zipfile.ZipFile(root/project_file) as z:
                names=[n for n in z.namelist() if n.endswith(".qgs")]
                if len(names)!=1:
                    raise ValueError("Compressed project must contain one QGS")
                (root/"project.qgs").write_bytes(z.read(names[0]))
        else:
            aux={}
            with zipfile.ZipFile(root/"project.qgz") as z:
                for entry in z.infolist():
                    if not entry.filename.endswith(".qgs"):
                        member(entry.filename)
                        aux[entry.filename]=z.read(entry)
            with zipfile.ZipFile(root/"project.qgz","w",compression=zipfile.ZIP_DEFLATED) as z:
                z.writestr("project.qgs",(root/"project.qgs").read_bytes())
                for name,data in aux.items():
                    z.writestr(name,data)
        maps=ET.parse(root/"project.qgs").findall("./projectlayers/maplayer")
        expected={l["key"]:l for l in manifest["layers"]}
        if len(maps)!=len(expected) or {m.findtext("id") for m in maps}!=set(expected):
            raise ValueError("Import added/removed layers as a new explicit GIS selection before sealing")
        for m in maps:
            layer=expected[m.findtext("id")]
            source=m.findtext("datasource","")
            if source.startswith("./"):
                source=source[2:]
            expected_uri=layer["working_path"]+("|layername="+layer["data"]["layer"] if layer["data"]["kind"]=="vector" else "")
            if source!=expected_uri:
                raise ValueError("Keep each edited layer on its retained relative working path")
        import fiona
        from pyproj import CRS
        for layer in manifest["layers"]:
            p=local(root,layer["working_path"])
            if layer["data"]["kind"]=="vector":
                with fiona.open(p,layer=layer["data"]["layer"]) as src:
                    if CRS.from_user_input(src.crs_wkt) != CRS.from_user_input(layer["data"]["crs_wkt"]):
                        raise ValueError("Retain the working layer CRS; use a new explicit selection for a reprojected layer")
                    kinds, nulls = set(), 0
                    for feature in src:
                        if feature["geometry"]:
                            kinds.add(feature["geometry"]["type"])
                        else:
                            nulls += 1
                    layer["data"].update(feature_count=len(src),bounds=_finite_bounds(src.bounds),
                        fields=dict(src.schema["properties"]),geometry_types=sorted(kinds),null_geometries=nulls,
                        project_bounds=_project_bounds(src.bounds,src.crs_wkt,manifest["project_crs"]))
            else:
                layer["data"]=inspect_raster(p,layer,manifest["project_crs"])
        styles(manifest["layers"])
        for map_layer in maps:
            atlas_desktop_binding(expected[map_layer.findtext("id")], map_layer)
        for layer in manifest["layers"]:
            layer["preview"]=(preview_vector if layer["data"]["kind"]=="vector" else preview_raster)(root,layer,manifest["project_crs"])
        changed=[]
        for path,rec in previous.items():
            p=root/path
            if p.exists() and sha256(p)!=rec["sha256"]:
                changed.append({"path":path,"previous_sha256":rec["sha256"],"sha256":sha256(p)})
        history=root/"history"/old["fingerprint"]
        history.mkdir(parents=True,exist_ok=True)
        save(history/"inventory.json",old)
        save(history/"project.json",load(root/"project.json"))
        edition={"parent_edition_id":manifest["edition_id"],"reason":reason.strip(),"changed":changed}
        manifest["edition_id"]=fingerprint(edition)
        manifest["history"].append({**edition,"edition_id":manifest["edition_id"]})
        manifest["native_qgis"]={"status":"recipient edited; native receiving should be repeated"}
        save(root/"project.json",manifest)
        catalogue(root,manifest)
        inventory(root)
        return verify(root)
