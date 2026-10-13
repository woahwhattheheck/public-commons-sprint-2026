"""Discover, receive and retain static USGS 3DEP one-arc-second terrain editions."""
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor, as_completed
from html.parser import HTMLParser
import json
import math
from pathlib import Path
import re
import urllib.parse
import xml.etree.ElementTree as ET
from typing import Any

from .terrain_io import (TerrainError, atomic_json, capture, copy_original, describe,
                         file_sha, identity, locked, now, public_usgs_url, read_json,
                         relative_path, verify)

INDEX = "https://rockyweb.usgs.gov/vdelivery/Datasets/Staged/Elevation/1/TIFF/current/"
COLLECTION = "https://data.usgs.gov/datacatalog/data/USGS%3A35f9c4d4-b113-4c8d-8691-47c428c29a5b"
DATUM_REFERENCE = "https://www.usgs.gov/faqs/what-projection-horizontal-datum-vertical-datum-and-resolution-a-usgs-digital-elevation-model"


class Links(HTMLParser):
    def __init__(self):
        super().__init__()
        self.hrefs: list[str] = []

    def handle_starttag(self, tag, attrs):
        if tag.lower() == "a":
            self.hrefs.extend(value for name, value in attrs if name.lower() == "href" and value)


def degree_tiles(bounds: list[float] | tuple[float, ...]) -> list[dict[str, Any]]:
    if len(bounds) != 4 or not all(math.isfinite(float(x)) for x in bounds):
        raise TerrainError("A discovery extent must contain four finite longitude/latitude values")
    west, south, east, north = map(float, bounds)
    if not (-180 <= west < east <= 180 and -90 < south < north < 90):
        raise TerrainError("Use a non-wrapping geographic terrain extent")
    result = []
    for top in range(math.floor(south)+1, math.ceil(north)+1):
        for left in range(math.floor(west), math.ceil(east)):
            tile = f"{'n' if top >= 0 else 's'}{abs(top):02d}{'e' if left >= 0 else 'w'}{abs(left):03d}"
            result.append({"tile": tile, "nominal_bounds": [left, top-1, left+1, top],
                           "index_url": INDEX + tile + "/"})
    return sorted(result, key=lambda row: row["tile"])


def discover(root: Path | str, bounds, *, title="USGS 3DEP terrain source edition",
             source_reference: dict[str, Any] | None = None, opener=None) -> dict[str, Any]:
    """Read the original public directory for each intersecting degree tile.

    Discovery is intentionally separate from numeric intake and from NLCD-grid
    preparation. All directory bodies are retained. Repeating in the same root
    reuses its original captured edition; a fresh root requests a fresh edition.
    """
    root = Path(root).resolve()
    root.mkdir(parents=True, exist_ok=True)
    selection = degree_tiles(bounds)
    selected = []
    for row in selection:
        folder = root / "catalog" / row["tile"]
        page = folder / "index.html"
        capture(row["index_url"], page, maximum_bytes=8*1024*1024, opener=opener)
        parser = Links()
        parser.feed(page.read_text("utf-8"))
        expected = "USGS_1_" + row["tile"]
        assets = {}
        for href in parser.hrefs:
            url = urllib.parse.urljoin(row["index_url"], href)
            name = urllib.parse.unquote(urllib.parse.urlsplit(url).path.rsplit("/", 1)[-1])
            if name in (expected+".tif", expected+".xml", expected+".gpkg"):
                public_usgs_url(url)
                if name in assets and assets[name] != url:
                    raise TerrainError("Publisher lists two different URLs for one tile member")
                assets[name] = url
        if expected+".tif" not in assets or expected+".xml" not in assets:
            raise TerrainError("Publisher directory lacks the original DEM and XML for " + row["tile"])
        selected.append({**row, "assets": assets, "index": describe(root, page),
                         "index_capture": describe(root, page.with_name(page.name+".http.json"))})
    value = {"schema": "upstate.terrain-catalog/v1", "title": title,
             "bounds_wgs84": list(map(float, bounds)), "dataset": "3DEP seamless 1 arc-second",
             "collection_reference": COLLECTION, "tiles": selected,
             "source_reference": source_reference,
             "selection_method": "Every nominal one-degree tile intersecting the explicit extent"}
    key = identity(value)
    path = root / "catalog" / (key+".json")
    atomic_json(path, value, immutable=True)
    return {**value, "id": key, "catalog_path": path.relative_to(root).as_posix()}


def xml_metadata(path: Path | str) -> dict[str, Any]:
    body = Path(path).read_bytes()
    if b"<!ENTITY" in body.upper():
        raise TerrainError("Elevation metadata must not contain XML entity declarations")
    try:
        node = ET.fromstring(body)
    except ET.ParseError as error:
        raise TerrainError("Invalid original terrain XML metadata") from error
    fields: dict[str, list[str]] = {}
    wanted = {"title", "pubdate", "begdate", "enddate", "caldate", "altunits", "altdatum",
              "horizdn", "geogunit", "westbc", "eastbc", "northbc", "southbc", "onlink",
              "distliab", "abstract", "altres", "rasttype", "rowcount", "colcount"}
    for item in node.iter():
        tag = item.tag.rsplit("}", 1)[-1].lower()
        text = " ".join("".join(item.itertext()).split())
        if tag in wanted and text:
            fields.setdefault(tag, [])
            if text not in fields[tag]:
                fields[tag].append(text)
    # First citation is the product, not one of its source-data citations.
    product = {}
    for item in node.findall("./idinfo/citation/citeinfo"):
        for key in ("title", "pubdate"):
            text = item.findtext(key)
            if text and text.strip():
                product[key] = text.strip()
    return {"fields": fields, "product": product,
            "vertical_units": fields.get("altunits", [None])[0],
            "vertical_datum": fields.get("altdatum", [None])[0],
            "horizontal_datum": fields.get("horizdn", [None])[0]}


def vertical_units(units: str) -> tuple[str, float]:
    normalized = re.sub(r"[\s_-]+", " ", units.strip().lower())
    if normalized in {"m", "meter", "meters", "metre", "metres"}:
        return "m", 1.0
    if normalized in {"ft", "foot", "feet", "international foot", "international feet"}:
        return "international_foot", 0.3048
    if normalized in {"us survey foot", "us survey feet", "u.s. survey foot", "u.s. survey feet"}:
        return "us_survey_foot", 1200.0/3937.0
    raise TerrainError("Unrecognized elevation unit; retain an explicit source unit and conversion")


def datum_key(value: str) -> str:
    compact = re.sub(r"[^a-z0-9]", "", value.casefold())
    if compact in {"navd88", "navd1988", "northamericanverticaldatumof1988", "northamericanverticaldatum1988"}:
        return "navd88"
    if compact in {"ngvd29", "ngvd1929", "nationalgeodeticverticaldatumof1929", "nationalgeodeticverticaldatum1929"}:
        return "ngvd29"
    return " ".join(value.casefold().split())


def inspect_raster(path: Path | str, *, scan: bool = True) -> dict[str, Any]:
    import numpy as np
    import rasterio
    from rasterio.warp import transform_bounds
    with rasterio.open(path) as source:
        if source.driver != "GTiff" or source.count != 1 or source.crs is None or source.width < 1 or source.height < 1:
            raise TerrainError("A DEM must be a georeferenced single-band raster")
        from pyproj import CRS
        if CRS.from_user_input(source.crs).is_compound or len(CRS.from_user_input(source.crs).axis_info) != 2:
            raise TerrainError("Static terrain requires an explicit two-dimensional horizontal CRS with separate vertical metadata")
        transform = source.transform
        if (transform.a <= 0 or transform.e >= 0 or transform.b or transform.d
                or not all(math.isfinite(x) for x in list(transform)[:6])):
            raise TerrainError("Static terrain tiles must be finite, north-up, unrotated rasters")
        if source.dtypes[0] not in {"float32", "float64", "int16", "int32", "uint16", "uint32"}:
            raise TerrainError("The selected raster is not a numeric elevation dataset")
        scale, offset = float(source.scales[0]), float(source.offsets[0])
        if not all(math.isfinite(x) for x in (scale, offset)) or scale <= 0:
            raise TerrainError("Invalid original DEM scale/offset")
        observed = {"crs": source.crs.to_wkt(), "crs_name": source.crs.to_string(),
                    "transform": list(transform)[:6], "width": source.width, "height": source.height,
                    "bounds": list(source.bounds), "dtype": source.dtypes[0],
                    "nodata": float(source.nodata) if source.nodata is not None and math.isfinite(source.nodata) else None,
                    "nodata_is_nan": bool(source.nodata is not None and math.isnan(source.nodata)),
                    "scale": scale, "offset": offset, "band_unit": source.units[0],
                    "bounds_wgs84": list(transform_bounds(source.crs, "EPSG:4326", *source.bounds, densify_pts=21))}
        if scan:
            valid = missing = 0
            low = high = None
            for _, window in source.block_windows(1):
                data = source.read(1, window=window, masked=True)
                raw = np.ma.getdata(data)
                bad = np.ma.getmaskarray(data) | ~np.isfinite(raw)
                values = raw[~bad].astype("float64")*scale + offset
                if not np.isfinite(values).all():
                    raise TerrainError("Original DEM scale/offset produced nonfinite elevations")
                valid += int(values.size)
                missing += int(bad.sum())
                if values.size:
                    low = float(values.min()) if low is None else min(low, float(values.min()))
                    high = float(values.max()) if high is None else max(high, float(values.max()))
            if not valid:
                raise TerrainError("Selected DEM contains no valid elevation cells")
            observed["observed"] = {"valid_cells": valid, "nodata_cells": missing,
                                     "minimum_source_units": low, "maximum_source_units": high}
        return observed


def adopt(root: Path | str, raster_path: Path | str, metadata_path: Path | str, *,
          origin: str, label: str, vintage: str | None = None,
          companions: list[Path | str] | tuple = (), derivation: dict[str, Any] | None = None,
          units: str | None = None, datum: str | None = None,
          unit_reference: str | None = None) -> dict[str, Any]:
    """Admit a complete original, or an explicitly documented original window.

    HTTP records are optional for already retained local sources. This function
    never fabricates a successful network transfer. Cropped inputs retain their
    actual transform/extent and an explicit derivation, rather than masquerading
    as an entire publisher degree tile.
    """
    public_usgs_url(origin)
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,127}", label):
        raise TerrainError("Use a simple nonempty terrain source label")
    root = Path(root).resolve()
    root.mkdir(parents=True, exist_ok=True)
    metadata = xml_metadata(metadata_path)
    measured = inspect_raster(raster_path)
    original_units = units or metadata["vertical_units"] or measured["band_unit"]
    original_datum = datum or metadata["vertical_datum"]
    if not original_units or not original_datum:
        raise TerrainError("Retain the original vertical unit and datum before terrain preparation")
    normalized, factor = vertical_units(original_units)
    metadata_units = metadata["vertical_units"]
    if units and metadata_units and vertical_units(metadata_units)[0] != normalized:
        raise TerrainError("Declared elevation units conflict with the retained original metadata")
    if (units or datum or factor != 1) and not unit_reference:
        raise TerrainError("Explicit source-unit/datum choices require their original reference")
    selected_vintage = vintage or metadata["product"].get("pubdate")
    if not selected_vintage:
        raise TerrainError("Retain the original product edition or acquisition vintage")
    raster_path, metadata_path = Path(raster_path).resolve(strict=True), Path(metadata_path).resolve(strict=True)
    if raster_path.name == metadata_path.name:
        raise TerrainError("Original raster and metadata filenames collide")
    # GDAL may rely on external masks, auxiliary metadata or world files.
    # Preserve the original native filename and each reported companion.
    import rasterio
    with rasterio.open(raster_path) as dataset:
        native_files = [Path(name).resolve(strict=True) for name in dataset.files
                        if Path(name).resolve() != raster_path]
    declared = {}
    for source in native_files + [Path(name).resolve(strict=True) for name in companions]:
        if source in (raster_path,metadata_path):
            continue
        if source.name in (raster_path.name,metadata_path.name):
            raise TerrainError("Original terrain companion collides with its native raster or XML")
        previous = declared.get(source.name)
        if previous is not None and file_sha(previous) != file_sha(source):
            raise TerrainError("Original terrain companions have conflicting names")
        declared[source.name] = source
    companion_sources = list(declared.values())
    native_records = [{"filename":path.name,"bytes":path.stat().st_size,"sha256":file_sha(path)}
                      for path in companion_sources]
    body_sha, meta_sha = file_sha(raster_path), file_sha(metadata_path)
    semantic = {"schema": "upstate.terrain-source/v1", "label": label, "uri": origin,
                "vintage": selected_vintage, "original_raster_name":raster_path.name,
                "original_metadata_name":metadata_path.name,"native_companions":native_records, "raster_sha256": body_sha,
                "metadata_sha256": meta_sha, "raster": measured,
                "vertical_units": normalized, "vertical_factor_to_m": factor,
                "vertical_datum": original_datum, "unit_reference": unit_reference or COLLECTION,
                "metadata_summary": metadata, "derivation": derivation}
    key = label + "-" + identity(semantic)[:20]
    folder = root / "original" / key
    with locked(root / ".terrain-store.lock"):
        raster_target, metadata_target = folder / raster_path.name, folder / metadata_path.name
        copy_original(raster_path, raster_target)
        copy_original(metadata_path, metadata_target)
        files = [describe(root, raster_target), describe(root, metadata_target)]
        if files[0]["sha256"] != body_sha or files[1]["sha256"] != meta_sha:
            raise TerrainError("Original terrain changed during receiving")
        copied_names = {raster_path.name, metadata_path.name}
        for source in companion_sources:
            source = Path(source)
            name = source.name
            if name in copied_names:
                raise TerrainError("Original terrain companions have colliding filenames")
            copied_names.add(name)
            copy_original(source, folder / name)
            files.append(describe(root, folder / name))
        for expected, copied in zip(native_records,files[2:]):
            if expected["sha256"] != copied["sha256"] or expected["bytes"] != copied["bytes"]:
                raise TerrainError("Original terrain companion changed during receiving")
        if inspect_raster(raster_target) != measured:
            raise TerrainError("Retained terrain and original native mask/metadata differ")
        result = {**semantic, "id": key, "files": files,
                  "path": files[0]["path"], "metadata_path": files[1]["path"]}
        record_path = root / "sources" / (key+".json")
        atomic_json(record_path, result, immutable=True)
    return result


def sources(root: Path | str, ids: list[str] | None = None, *, check: bool = True) -> list[dict[str, Any]]:
    root = Path(root).resolve()
    selected = []
    for path in sorted((root / "sources").glob("*.json")):
        value = read_json(path)
        if value.get("schema") != "upstate.terrain-source/v1" or value.get("id") != path.stem:
            raise TerrainError("Invalid retained terrain source record")
        semantic = {key:item for key,item in value.items() if key not in ("id","files","path","metadata_path")}
        if value["id"] != value["label"]+"-"+identity(semantic)[:20]:
            raise TerrainError("Retained terrain source identity differs")
        if ids is not None and value["id"] not in ids:
            continue
        if check:
            for member in value["files"]:
                verify(root, member)
        selected.append(value)
    if ids is not None:
        by_id = {item["id"]: item for item in selected}
        if len(set(ids)) != len(ids) or set(ids) != set(by_id):
            raise TerrainError("Select existing unique retained terrain source IDs")
        return [by_id[key] for key in ids]
    return selected


def acquire(root: Path | str, catalog_path: Path | str, *, workers: int = 2, opener=None) -> dict[str, Any]:
    root = Path(root).resolve()
    catalog_path = Path(catalog_path).resolve(strict=True)
    if not catalog_path.is_relative_to(root):
        raise TerrainError("The catalogue must be retained inside the selected terrain root")
    catalogue = read_json(catalog_path)
    if catalogue.get("schema") != "upstate.terrain-catalog/v1":
        raise TerrainError("Select a retained original terrain catalogue")
    if not isinstance(workers, int) or not 1 <= workers <= 8:
        raise TerrainError("Select one to eight independent source receivers")
    job_id = identity(catalogue)
    state_path = root / "jobs" / ("acquire-"+job_id+".json")
    with locked(root / "jobs" / ("acquire-"+job_id+".lock")):
        state = {"schema": "upstate.terrain-acquisition/v1", "catalogue_id": job_id,
                 "state": "receiving", "started_at": now(), "completed": [], "errors": []}
        atomic_json(state_path, state)
        def receive(tile):
            verify(root, tile["index"])
            verify(root, tile["index_capture"])
            folder = root / "receiving" / tile["tile"]
            received = {}
            for name, url in sorted(tile["assets"].items()):
                path = folder / name
                capture(url, path, maximum_bytes=16*1024*1024 if name.endswith(".xml") else None,
                        opener=opener)
                received[name] = path
            stem = "USGS_1_" + tile["tile"]
            body, meta = received[stem+".tif"], received[stem+".xml"]
            companions = [path.with_name(path.name+".http.json") for path in received.values()]
            companions += [path for name, path in received.items() if name.endswith(".gpkg")]
            companions += [relative_path(root, tile["index"]["path"])]
            return adopt(root, body, meta, origin=tile["assets"][stem+".tif"], label=tile["tile"],
                         companions=companions)
        with ThreadPoolExecutor(max_workers=workers) as pool:
            futures = {pool.submit(receive, tile): tile["tile"] for tile in catalogue["tiles"]}
            for future in as_completed(futures):
                tile = futures[future]
                try:
                    result = future.result()
                    state["completed"].append({"tile": tile, "source_id": result["id"]})
                except Exception as error:
                    state["errors"].append({"tile": tile, "error": type(error).__name__+": "+str(error)})
                state["updated_at"] = now()
                atomic_json(state_path, state)
        state["completed"].sort(key=lambda x: x["tile"])
        state.update(state="interrupted" if state["errors"] else "complete", completed_at=now())
        atomic_json(state_path, state)
        return state
