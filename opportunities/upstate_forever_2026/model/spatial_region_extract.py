"""Native-grid GIS extracts from saved original Area analyses.

Values are copied, never resampled. The saved analysis remains authoritative for
statistics; separate masks describe selected cells and original valid support.
"""
from __future__ import annotations
from contextlib import ExitStack
import copy
import html
import os
from pathlib import Path
import shutil

from .common import (atomic_bytes, atomic_json, describe_file, digest,
                     file_digest, held, identifier, read_json, verify_file, _sync_directory)
from .spatial import _feature_shape, _scalar_matches
from .spatial_regions import (SpatialRegions, _project_geometry, _inside, _values,
                              _cell_area, csv_exports, TILE_SIZE)
from . import gis_project as gis

KIND = "spatial-region-extractions"
SCHEMA = "upstate.spatial-region-extraction/v1"
ALGORITHM = "original-area-native-grid-extract/v1"


def producers():
    root = Path(__file__).resolve().parent.parent
    names = ("model/spatial_region_extract.py", "model/spatial_regions.py",
             "model/spatial.py", "model/common.py", "model/verified_files.py",
             "model/gis_project.py", "model/gis_vector_metadata.py",
             "model/fgdc_metadata.py", "model/gis_project_view.html",
             "model/gis_project_cli.py", "model/gis_project_native.py",
             "model/gis_workspace.py")
    return {name: {"bytes": (root / name).stat().st_size,
                   "sha256": file_digest(root / name)} for name in names}


def _selection(payload):
    if not isinstance(payload, dict) or set(payload) - {"analysis_id", "title", "notes"}:
        raise ValueError("Choose a saved Area analysis, an extract title and optional notes")
    result = {"analysis_id": identifier(payload.get("analysis_id"))}
    for name, default, limit in (("title", None, 240), ("notes", "", 16000)):
        value = payload.get(name, default)
        if value is not None and (not isinstance(value, str) or "\0" in value or len(value) > limit):
            raise ValueError("Use original text for the extract " + name)
        if name == "title" and value is not None and not value.strip():
            raise ValueError("Give the extract a nonempty title or omit it")
        result[name] = value
    return result


def _native_window(source, geometry):
    from rasterio.features import geometry_window
    from rasterio.errors import WindowError
    from rasterio.windows import Window
    try:
        window = geometry_window(source, [geometry])
    except WindowError:
        return None
    return Window(int(window.col_off), int(window.row_off),
                  int(window.width), int(window.height))


def _tiles(window):
    from rasterio.windows import Window
    for y in range(0, int(window.height), TILE_SIZE):
        for x in range(0, int(window.width), TILE_SIZE):
            local = Window(x, y, min(TILE_SIZE, int(window.width) - x),
                           min(TILE_SIZE, int(window.height) - y))
            yield local, Window(window.col_off + x, window.row_off + y,
                                local.width, local.height)


def _tags(values):
    # Source-wide statistics no longer describe this selected window.
    return {k: v for k, v in values.items()
            if not k.upper().startswith("STATISTICS_")}


def _raster_profile(source, band, window, *, mask=False):
    result = {"driver": "GTiff", "width": int(window.width),
              "height": int(window.height), "count": 1,
              "dtype": "uint8" if mask else source.dtypes[band - 1],
              "crs": source.crs, "transform": source.window_transform(window),
              "compress": "deflate", "BIGTIFF": "IF_SAFER"}
    if not mask and source.nodatavals[band - 1] is not None:
        result["nodata"] = source.nodatavals[band - 1]
    return result


def _write_raster(root, name, source, band, geometry, all_touched, description, emit):
    import numpy as np
    import rasterio
    window = _native_window(source, geometry)
    if window is None:
        return {"series": name, "state": "outside-source", "window": None,
                "selected_cells": 0, "valid_cells": 0, "files": {}}
    folder = root / "rasters"
    folder.mkdir(parents=True, exist_ok=True)
    paths = {key: folder / (name + suffix) for key, suffix in
             (("values", ".tif"), ("region_mask", "-region-mask.tif"),
              ("original_valid_mask", "-original-valid-mask.tif"))}
    selected_count, valid_count, original_count = 0, 0, 0
    with rasterio.Env(GDAL_TIFF_INTERNAL_MASK=True):
        with ExitStack() as stack:
            values = stack.enter_context(rasterio.open(
                paths["values"], "w", **_raster_profile(source, band, window)))
            region = stack.enter_context(rasterio.open(
                paths["region_mask"], "w", **_raster_profile(source, band, window, mask=True)))
            valid = stack.enter_context(rasterio.open(
                paths["original_valid_mask"], "w", **_raster_profile(source, band, window, mask=True)))
            values.scales = (source.scales[band - 1],)
            values.offsets = (source.offsets[band - 1],)
            units = description["native"]["units"]
            if units is not None:
                values.set_band_unit(1, units)
            if source.descriptions[band - 1]:
                values.set_band_description(1, source.descriptions[band - 1])
            values.update_tags(**_tags(source.tags()))
            values.update_tags(1, **_tags(source.tags(band)))
            values.update_tags(AREA_EXTRACTION=ALGORITHM, ORIGINAL_BAND=str(band),
                               MASK_MEANING="selected region AND original finite valid values")
            try:
                palette = source.colormap(band)
            except ValueError:
                palette = None
            if palette:
                values.write_colormap(1, palette)
            for target, meaning in ((region, "1 selected by saved native cell-inclusion rule; 0 outside region"),
                                    (valid, "1 original unmasked finite physical value; 0 original nodata/nonfinite")):
                target.set_band_unit(1, "indicator")
                target.update_tags(MEANING=meaning)
            for index, (local, original) in enumerate(_tiles(window), 1):
                raw = source.read(band, window=original, masked=False)
                _, original_valid = _values(source, band, original)
                inside = _inside(source, original, geometry, all_touched)
                effective = inside & original_valid
                values.write(raw, 1, window=local)
                values.write_mask(effective.astype("uint8") * 255, window=local)
                region.write(inside.astype("uint8"), 1, window=local)
                valid.write(original_valid.astype("uint8"), 1, window=local)
                selected_count += int(np.count_nonzero(inside))
                valid_count += int(np.count_nonzero(effective))
                original_count += int(np.count_nonzero(original_valid))
                if index % 16 == 0:
                    emit("extracting", series=name, windows=index, selected_cells=selected_count)
    # Reopen actual outputs at their native resolution, not the display preview.
    with rasterio.open(paths["values"]) as received:
        if (received.crs != source.crs or received.transform != source.window_transform(window)
                or received.width != int(window.width) or received.height != int(window.height)
                or received.dtypes[0] != source.dtypes[band - 1]
                or received.scales[0] != source.scales[band - 1]
                or received.offsets[0] != source.offsets[band - 1]):
            raise ValueError("Extracted raster changed its original grid or band encoding")
        for local, original in _tiles(window):
            expected = source.read(band, window=original, masked=False)
            actual = received.read(1, window=local, masked=False)
            if expected.dtype != actual.dtype or expected.tobytes() != actual.tobytes():
                raise ValueError("Extracted native cells differ from their original stored values")
            _, original_valid = _values(source, band, original)
            inside = _inside(source, original, geometry, all_touched)
            if not np.array_equal(received.read_masks(1, window=local) != 0, inside & original_valid):
                raise ValueError("Extracted raster mask differs from the saved Area selection")
    return {"series": name, "state": "complete", "window": {
                "column_offset": int(window.col_off), "row_offset": int(window.row_off),
                "width": int(window.width), "height": int(window.height)},
            "selected_cells": selected_count, "valid_cells": valid_count,
            "original_valid_cells_in_window": original_count,
            "cell_area": _cell_area(source),
            "files": {key: describe_file(root, path) for key, path in paths.items()}}


def _write_difference(root, sources, selected, geometries, descriptions, all_touched, pair, emit):
    if not pair.get("comparable"):
        return {"available": False, "reason": pair.get("reason")}
    import numpy as np
    import rasterio
    source = sources["primary"]
    # A shared index cut is possible only under the retained exact grid contract.
    window = _native_window(source, geometries["primary"])
    if window is None:
        return {"available": False, "reason": "Selected area lies outside the original grids"}
    folder = root / "rasters"
    paths = {"difference": folder / "comparison-minus-primary.tif",
             "common_valid_mask": folder / "common-valid-mask.tif"}
    profile = _raster_profile(source, selected["primary"][0]["band"], window, mask=True)
    profile.update(dtype="float64", nodata=float("nan"))
    common_count = 0
    with rasterio.Env(GDAL_TIFF_INTERNAL_MASK=True):
        with rasterio.open(paths["difference"], "w", **profile) as out, rasterio.open(
                paths["common_valid_mask"], "w",
                **_raster_profile(source, 1, window, mask=True)) as mask:
            out.set_band_unit(1, descriptions["primary"]["native"]["units"])
            out.update_tags(DIRECTION="comparison minus primary",
                            MEANING="physical band values after original scale/offset; common selected valid cells only")
            mask.set_band_unit(1, "indicator")
            for index, (local, original) in enumerate(_tiles(window), 1):
                values, valid = {}, {}
                for name in ("primary", "comparison"):
                    values[name], valid[name] = _values(sources[name], selected[name][0]["band"], original)
                    valid[name] &= _inside(sources[name], original, geometries[name], all_touched)
                common = valid["primary"] & valid["comparison"]
                result = np.full(common.shape, np.nan, dtype="float64")
                with np.errstate(over="raise", invalid="raise"):
                    result[common] = values["comparison"][common] - values["primary"][common]
                if not np.all(np.isfinite(result[common])):
                    raise ValueError("Native paired subtraction produced nonfinite values")
                out.write(result, 1, window=local)
                out.write_mask(common.astype("uint8") * 255, window=local)
                mask.write(common.astype("uint8"), 1, window=local)
                common_count += int(np.count_nonzero(common))
                if index % 16 == 0:
                    emit("paired-difference", windows=index, common_cells=common_count)
    return {"available": True, "direction": "comparison minus primary",
            "units": descriptions["primary"]["native"]["units"],
            "common_valid_cells": common_count,
            "files": {key: describe_file(root, path) for key, path in paths.items()}}


def _geometry_files(root, request, spatial, layers):
    import fiona
    from pyproj import CRS
    folder = root / "geometry"
    folder.mkdir(parents=True, exist_ok=True)
    path = folder / "selected-area.gpkg"
    with fiona.open(path, "w", driver="GPKG", layer="region",
                    crs_wkt=CRS.from_user_input(request["region"]["crs"]).to_wkt(),
                    schema={"geometry": "Unknown", "properties": {"selection": "str"}}) as target:
        target.write({"geometry": request["region"]["geometry"],
                      "properties": {"selection": "saved Area analysis"}})
    items = [{"id": "area-boundary", "title": "Selected area boundary",
              "kind": "vector", "file": describe_file(root, path), "layer": "region",
              "purpose": "context", "units": "original geometry",
              "visible": True, "source": {"region": request["region"],
                                         "source_feature": request.get("source_feature")}}]
    feature = request.get("source_feature")
    if feature:
        choice, record = spatial._selected(feature["selection"], layers, kind="vector")
        with spatial._vector(choice, record) as (source, crs, layer):
            found = None
            for row in source:
                if str(row.id) == feature["id"] and all(
                        _scalar_matches(row["properties"].get(k), v)
                        for k, v in choice.get("where", {}).items()):
                    found = row
                    break
            if found is None:
                raise ValueError("Original selected polygon disappeared during extraction")
            geom = _feature_shape(found)
            if geom is None or geom.is_empty or not geom.is_valid:
                raise ValueError("The original selected polygon requires an explicit geometry correction")
            path = folder / "original-selected-feature.gpkg"
            # GPKG's internal fid must not consume an original attribute of that name.
            fields, field_map = {}, {}
            identity_field = "original_feature_id"
            while identity_field.lower() in {name.lower() for name in source.schema["properties"]}:
                identity_field = "_" + identity_field
            fields[identity_field] = "str"
            for name, dtype in source.schema["properties"].items():
                target_name = "source_fid_attribute" if name.lower() == "fid" else name
                while target_name.lower() in {field.lower() for field in fields}:
                    target_name = "_" + target_name
                fields[target_name] = dtype
                field_map[name] = target_name
            attributes = {field_map[name]: value for name, value in found["properties"].items()}
            attributes[identity_field] = feature["id"]
            with fiona.open(path, "w", driver="GPKG", layer="selected_feature",
                            crs_wkt=crs.to_wkt(),
                            schema={"geometry": "Unknown", "properties": fields}) as target:
                target.write({"geometry": found["geometry"], "properties": attributes})
            with fiona.open(path, layer="selected_feature") as received:
                row = next(iter(received))
                if len(received) != 1 or dict(row["properties"]) != attributes:
                    raise ValueError("Selected feature attributes changed during extraction")
            items.append({"id": "original-selected-feature", "title": "Original selected source feature",
                          "kind": "vector", "file": describe_file(root, path), "layer": "selected_feature",
                          "purpose": "context", "units": "original source attributes", "visible": False,
                          "source": {"selection": choice, "original_feature_id": feature["id"],
                                     "binding": feature["binding"], "source_field_map": field_map,
                                     "source_identity_field": identity_field,
                                     "original_layer": copy.deepcopy(record["public"]),
                                     "original_file": copy.deepcopy(record["file"]),
                                     "source_entry": copy.deepcopy(record["source"][2]) if record["source"] else None}})
    return items


def _report(record):
    esc = lambda x: html.escape(str(x), quote=True)
    rows = []
    for name, value in record["rasters"].items():
        description = record["descriptions"][name]["native"]
        rows.append("<tr>" + "".join("<td>" + esc(v) + "</td>" for v in (
            name, value["state"], description.get("units") or "undeclared",
            value["selected_cells"], value["valid_cells"], description["crs"],
            "none", value.get("window"))) + "</tr>")
    links = "".join("<li>" + esc(label) + " — " + esc(item["path"]) + "</li>"
                    for label, item in record["files"].items())
    return ('<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width">'
            '<title>' + esc(record["title"]) + '</title><style>body{font:16px/1.5 system-ui;margin:24px;max-width:1100px;color:#222}'
            'h1{font-size:25px}.scroll{overflow:auto}table{border-collapse:collapse;min-width:850px}th,td{border:1px solid #bbb;padding:8px;text-align:left}'
            'td{font-variant-numeric:tabular-nums}pre{white-space:pre-wrap;overflow-wrap:anywhere}@media(max-width:600px){body{margin:12px}}</style>'
            '<h1>' + esc(record["title"]) + '</h1><p>Original-grid GIS extraction from saved Area analysis.</p>'
            '<p>' + esc(record["notes"]) + '</p><p>Each values raster preserves the selected original band storage values, data type, '
            'scale, offset, native coordinate system and cell alignment. Its display mask selects finite original valid cells inside '
            'the saved area. Separate indicator rasters retain the region and original valid support. Outside-area stored values in '
            'the rectangular window remain original values but are masked. No interpolation, reprojection or native model execution occurred.</p>'
            '<div class="scroll"><table><thead><tr><th>Series</th><th>Status</th><th>Units</th><th>Selected cells</th><th>Valid cells</th>'
            '<th>Original CRS</th><th>Resampling</th><th>Original window</th></tr></thead><tbody>' + "".join(rows) + '</tbody></table></div>'
            '<p>Geographic grids retain counts; projected cell areas describe the grid, not a geodesic polygon estimate. Pixel-value sums '
            'in the retained analysis keep their original units and are not converted from rates into masses. The paired difference, '
            'when available, is comparison minus primary after each band\'s original scale and offset on common valid cells.</p>'
            '<p>This derived working subset does not establish a new hydrologic model domain. A clipped DEM or flow raster must not be '
            'treated as a newly conditioned and executed model. Full upstream source bytes remain in the original scientific Workspace; '
            'the package retains their exact source identities and the extracted original cells.</p>'
            '<h2>Open and edit</h2><p>The complete ZIP contains OPEN_GIS.html and project.qgz for the existing editable GIS application. '
            'Open its catalogue for working layers and checked attachment links. These filenames describe the extraction before packaging; '
            'the catalogue retains their actual portable locations. Use the existing GIS receive and seal commands when creating a new edited edition.</p><ul>' + links +
            '</ul><h2>Original selection</h2><pre>' + esc(__import__("json").dumps(
                {"analysis_id": record["analysis_id"],
                 "region_crs": record["analysis_request"]["region"]["crs"],
                 "geometry_type": record["analysis_request"]["region"]["geometry"]["type"],
                 "geometry": "Complete original geometry is retained in analysis.json and the boundary GeoPackage.",
                 "all_touched": record["analysis_request"]["all_touched"],
                 "source_feature_id": (record["analysis_request"].get("source_feature") or {}).get("id"),
                 "bindings": record["bindings"], "pair": record["pair"]}, ensure_ascii=False, indent=2)) +
            '</pre></html>')


class RegionExtracts:
    def __init__(self, workspace, *, regions=None):
        self.workspace = workspace
        self.regions = regions or SpatialRegions(workspace)
        self.spatial = self.regions.spatial

    def catalog(self, analysis_id=None):
        if analysis_id is not None:
            identifier(analysis_id)
        rows = []
        for path in sorted((self.workspace.root / KIND).glob("*/extraction.json")):
            value = read_json(path)
            if analysis_id is None or value.get("analysis_id") == analysis_id:
                rows.append({k: value[k] for k in ("id", "analysis_id", "title", "algorithm", "state")})
        return rows

    def inspect(self, key, *, verify=True):
        key = identifier(key)
        directory = self.workspace.root / KIND / key
        value = read_json(directory / "extraction.json")
        if (value.get("schema") != SCHEMA or value.get("id") != key or value.get("state") != "complete"
                or digest(value.get("identity")) != key or value.get("project_id") != self.workspace.project["id"]):
            raise ValueError("Saved Area extraction identity differs")
        if value.get("record_sha256") != digest({k: v for k, v in value.items() if k != "record_sha256"}):
            raise ValueError("Saved Area extraction record changed")
        analysis = self.regions.inspect(value["analysis_id"])
        if digest(analysis) != value["identity"]["analysis_sha256"]:
            raise ValueError("The extraction no longer has its exact original Area analysis")
        if verify:
            for item in value["files"].values():
                verify_file(directory, item)
            gis.verify(directory / "gis-project")
        return value

    def export(self, payload, *, progress=None):
        selection = _selection(copy.deepcopy(payload))
        analysis = self.regions.inspect(selection["analysis_id"])
        identity = {"schema": SCHEMA, "algorithm": ALGORITHM,
                    "project_id": self.workspace.project["id"], "selection": selection,
                    "analysis_sha256": digest(analysis), "producers": producers(),
                    "gis_builder_version": gis.VERSION}
        key = digest(identity)
        directory = self.workspace.root / KIND / key
        def emit(stage, **details):
            if progress:
                progress({"stage": stage, "extraction_id": key, **details})
        # Original Workspace lock keeps backup/receiving from capturing partial output.
        with held(self.workspace.root / ".workspace.lock", blocking=False):
            with held(self.workspace.root / KIND / (".extract-" + key + ".lock"), blocking=False):
                if (directory / "extraction.json").exists():
                    return {**self.inspect(key), "reused": True}
                # Only an uncommitted staging tree is discarded; published editions are immutable.
                stage = directory.parent / (".write-" + key)
                if stage.exists():
                    if stage.is_symlink() or not stage.is_dir():
                        raise ValueError("Area extraction staging is not an owned directory")
                    shutil.rmtree(stage)
                stage.mkdir(parents=True)
                try:
                    result = self._build(stage, key, identity, selection, analysis, emit)
                    if directory.exists():
                        raise ValueError("An incomplete published Area extraction must be retained for review")
                    os.rename(stage, directory)
                    _sync_directory(directory.parent)
                    return self.inspect(key)
                except BaseException:
                    # Keep the original failed stage for the same request's explicit retry.
                    raise

    def _build(self, stage, key, identity, selection, analysis, emit):
        import rasterio
        from pyproj import CRS
        request, selected, descriptions = self.regions._request(analysis["request"])
        if request != analysis["request"]:
            raise ValueError("Reopened Area source selection differs from its original request")
        pair = self.spatial._pair(descriptions["primary"], descriptions["comparison"])
        if pair != analysis["pair"]:
            raise ValueError("Original Area comparison support changed")
        rasters, geometries = {}, {}
        with ExitStack() as stack:
            sources = {}
            for name, (choice, record) in selected.items():
                path, _ = stack.enter_context(self.spatial._reading(record))
                source = stack.enter_context(rasterio.open(path))
                sources[name] = source
                geometries[name], _ = _project_geometry(request["region"], source.crs, source.transform)
                rasters[name] = _write_raster(stage, name, source, choice["band"], geometries[name],
                                               request["all_touched"], descriptions[name], emit)
                expected = analysis["results"][name]
                if (rasters[name]["selected_cells"] != expected["selected_native_cell_count"]
                        or rasters[name]["valid_cells"] != expected["valid_cell_count"]):
                    raise ValueError("Extracted cells differ from the saved Area calculation")
            difference = _write_difference(stage, sources, selected, geometries, descriptions,
                                            request["all_touched"], pair, emit)
            if difference["available"] and difference["common_valid_cells"] != analysis["comparison"]["common_valid_cell_count"]:
                raise ValueError("Extracted common mask differs from the saved Area calculation")
        source_records = {name: {"layer": copy.deepcopy(record["public"]),
                                 "file": copy.deepcopy(record["file"]),
                                 "source_entry": copy.deepcopy(record["source"][2]) if record["source"] else None}
                          for name, (_, record) in selected.items()}
        layers = _geometry_files(stage, request, self.spatial, self.spatial._layers())
        for name, raster in rasters.items():
            if raster["state"] != "complete":
                continue
            desc = descriptions[name]
            for role, item in raster["files"].items():
                is_values = role == "values"
                layers.append({"id": name + "-" + role, "title": name.capitalize() + " · " + role.replace("_", " "),
                    "kind": "raster", "file": item, "band": 1, "visible": is_values,
                    "purpose": ("categorical" if desc["native"]["categorical"] else "context") if is_values else "categorical",
                    "units": (desc["native"]["units"] or "undeclared source units") if is_values else "indicator",
                    "source": {"binding": request["bindings"][name], "native_description": desc["native"],
                               "extract": raster, "role": role}})
        if difference["available"]:
            for role, item in difference["files"].items():
                layers.append({"id": role, "title": role.replace("_", " ").capitalize(),
                    "kind": "raster", "file": item, "band": 1, "visible": False,
                    "purpose": "difference" if role == "difference" else "categorical",
                    "units": difference["units"] if role == "difference" else "indicator",
                    "direction": difference["direction"], "source": {"pair": pair, "analysis_id": analysis["id"]}})
        files = {"analysis": describe_file(stage, _json_file(stage / "analysis.json", analysis))}
        for name, body in csv_exports(analysis).items():
            path = stage / name
            atomic_bytes(path, body.encode("utf-8"), immutable=True)
            files[name] = describe_file(stage, path)
        for name, raster in rasters.items():
            for role, item in raster["files"].items():
                files[name + "-" + role] = item
        for role, item in difference.get("files", {}).items():
            files[role] = item
        for layer in layers:
            if layer["kind"] == "vector":
                files[layer["id"]] = layer["file"]
        value = {"schema": SCHEMA, "id": key, "algorithm": ALGORITHM, "state": "complete",
                 "identity": identity, "project_id": self.workspace.project["id"],
                 "analysis_id": analysis["id"], "analysis_request": request,
                 "title": selection["title"] or analysis["title"] + " · native-grid GIS",
                 "notes": selection["notes"], "bindings": request["bindings"],
                 "descriptions": descriptions, "source_records": source_records,
                 "pair": pair, "rasters": rasters,
                 "difference": difference, "files": files}
        atomic_bytes(stage / "AREA_REPORT.html", _report(value).encode("utf-8"), immutable=True)
        files["report"] = describe_file(stage, stage / "AREA_REPORT.html")
        provenance = {k: v for k, v in value.items() if k != "files"}
        atomic_json(stage / "extraction-provenance.json", provenance, immutable=True)
        files["provenance"] = describe_file(stage, stage / "extraction-provenance.json")
        root = Path(__file__).resolve().parent.parent
        source_files = []
        for name, expected in identity["producers"].items():
            original = root / name
            if original.stat().st_size != expected["bytes"] or file_digest(original) != expected["sha256"]:
                raise ValueError("Area extraction implementation changed while producing the edition")
            target = stage / "implementation" / name
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(original, target)
            source_files.append(describe_file(stage, target))
        files["source_manifest"] = describe_file(stage, _json_file(stage / "implementation.json",
            {"algorithm": ALGORITHM, "files": source_files}))
        for index, item in enumerate(source_files):
            files["implementation-" + str(index)] = item
        attachments = [{"id": label, "title": label.replace("_", " "), "kind": "table" if item["path"].endswith(".csv") else "document",
                         "file": item, "source": {"analysis_id": analysis["id"], "extraction_id": key}}
                       for label, item in files.items() if label not in
                       {k for k in files if k in {"area-boundary", "original-selected-feature"} or
                        k.endswith(("-values", "-region_mask", "-original_valid_mask")) or k in {"difference", "common_valid_mask"}}]
        spec = {"schema": gis.REQUEST_SCHEMA, "title": value["title"],
                "project_crs": CRS.from_user_input(request["region"]["crs"]).to_string(),
                "focus_layer_id": "area-boundary", "layers": layers, "attachments": attachments,
                "provenance": provenance}
        emit("building-editable-gis", layers=len(layers))
        built = gis.build(spec, stage, stage / "gis-project", progress=lambda p: emit("gis", **p))
        emit("packaging-editable-gis")
        packed = gis.pack(stage / "gis-project", stage / "editable-area-gis.zip")
        value["gis"] = {"selection_id": built["selection_id"], "archive_sha256": packed["archive_sha256"],
                        "project": "gis-project/project.qgz", "open": "gis-project/OPEN_GIS.html"}
        files["editable_gis"] = describe_file(stage, stage / "editable-area-gis.zip",
                                              filename="editable-area-gis.zip", content_type="application/zip")
        files["qgis_project"] = describe_file(stage, stage / "gis-project/project.qgz")
        files["gis_open"] = describe_file(stage, stage / "gis-project/OPEN_GIS.html")
        value["record_sha256"] = digest(value)
        atomic_json(stage / "extraction.json", value, immutable=True)
        return value


def _json_file(path, value):
    atomic_json(path, value, immutable=True)
    return path
