"""Read the original retained native routing rasters without changing a run."""
from __future__ import annotations

from collections import OrderedDict
from contextlib import ExitStack
from copy import deepcopy
import base64
import math

from .common import INVEST_SOURCE, digest, identifier, read_json, verify_file
from .reuse import dataset_companions
from .verified_files import verified_operation

SCHEMA = "upstate.native-routing-source/v1"
ENCODING_BLOBS = {
    "2.4.9": "04781bd83d20afb79f81608a0a1d1a6628c60453",
    "2.4.10": "4f12528f2a8864cf021fe2f4237fc49a0f3d5753",
    "2.4.11": "4f12528f2a8864cf021fe2f4237fc49a0f3d5753",
}


def _stage(workspace, run_id, model):
    run = workspace.inspect_run(identifier(run_id))
    if model not in ("ndr", "sdr"):
        raise ValueError("Select an original NDR or SDR stage")
    stage = run.get("stages", {}).get(model)
    if not stage or not stage.get("completed_at"):
        raise ValueError("Complete the selected original native stage before tracing its flow")
    runtime = stage.get("runtime") or run.get("runtime") or {}
    module = runtime.get("modules", {}).get(model, {})
    if module.get("git_blob") != INVEST_SOURCE[model + "_blob"]:
        raise ValueError("This route reader needs the selected original InVEST producer source")
    package = runtime.get("environment", {}).get("packages", {}).get("pygeoprocessing")
    if package not in ENCODING_BLOBS:
        raise ValueError("The retained PyGeoprocessing " + str(package) +
                         " routing format needs its original producer source before this reader can interpret it")
    directory = workspace.root / "runs" / run["id"]
    args = read_json(verify_file(directory, stage["arguments"]))
    algorithm = args.get("flow_dir_algorithm")
    if algorithm not in ("d8", "mfd"):
        raise ValueError("The retained native arguments must declare flow_dir_algorithm as d8 or mfd")
    names = {"direction": "flow_direction",
             "terrain": "filled_dem" if model == "ndr" else "pit_filled_dem",
             "stream": "stream_and_drainage" if model == "sdr" and args.get("drainage_path") else "stream"}
    return run, stage, directory, args, algorithm, names


@verified_operation
def retained_source(workspace, run_id, model):
    run, stage, directory, arguments, algorithm, names = _stage(workspace, run_id, model)
    registry = stage.get("files") or {}
    by_path = {v["path"]: v for v in registry.values()}
    by_path.update({v["path"]: v for v in stage.get("companions", []) + stage.get("additional_files", [])})
    selected, companions = {}, {}
    # A missing originally retained mask/sidecar can change GDAL's reading just
    # as an added one can. Verify the stage's complete companion inventory.
    for descriptor in stage.get("companions", []):
        verify_file(directory, descriptor)
    for role, native_id in names.items():
        descriptor = registry.get(native_id)
        if not descriptor:
            raise ValueError("The original native registry does not retain " + native_id)
        path = verify_file(directory, descriptor)
        selected[role] = {"registry_id": native_id, **deepcopy(descriptor)}
        for companion in dataset_companions(path):
            relative = companion.relative_to(directory).as_posix()
            if relative not in by_path:
                raise ValueError("An unrecorded raster companion affects this source: " + relative)
            verify_file(directory, by_path[relative])
            companions[relative] = deepcopy(by_path[relative])
    value = {"schema": SCHEMA, "project_id": workspace.project["id"],
             "run_id": run["id"], "model": model, "algorithm": algorithm,
             "selection": deepcopy(run["selection"]), "native_stage": deepcopy(stage),
             "arguments": arguments, "files": selected,
             "companions": [companions[k] for k in sorted(companions)],
             "native_encoding_source": {
                 "repository": INVEST_SOURCE["repository"] if "repository" in INVEST_SOURCE else
                               "https://github.com/natcap/invest",
                 "model_git_blob": INVEST_SOURCE[model + "_blob"],
                 "routing_package": "pygeoprocessing",
                 "routing_package_version": (stage.get("runtime") or run.get("runtime"))["environment"]["packages"]["pygeoprocessing"],
                 "routing_source_repository": "https://github.com/natcap/pygeoprocessing",
                 "routing_source_path": "src/pygeoprocessing/routing/routing.pyx",
                 "routing_source_git_blob": ENCODING_BLOBS[(stage.get("runtime") or run.get("runtime"))["environment"]["packages"]["pygeoprocessing"]],
             }}
    value["id"] = digest(value)
    return value


class OriginalRasterReader:
    """Bounded tile cache; all selected raster cells remain available."""
    def __init__(self, workspace, source):
        import rasterio
        from pyproj import CRS
        self.stack = ExitStack()
        self.cache, self.observed = OrderedDict(), {}
        self.source = source
        root = workspace.root / "runs" / source["run_id"]
        try:
            self.datasets = {
                role: self.stack.enter_context(rasterio.open(verify_file(root, descriptor)))
                for role, descriptor in source["files"].items()}
            for item in source["companions"]:
                verify_file(root, item)
            direction = self.datasets["direction"]
            if direction.count != 1 or not direction.crs:
                raise ValueError("Retain one original direction band and its actual CRS")
            self.width, self.height = direction.width, direction.height
            self.affine = list(direction.transform)[:6]
            for role, ds in self.datasets.items():
                if (ds.count != 1 or ds.width != self.width or ds.height != self.height
                        or ds.transform != direction.transform or ds.crs != direction.crs):
                    raise ValueError("Original routing rasters must have identical dimensions, affine and CRS: " + role)
            crs = CRS.from_user_input(direction.crs)
            axes = crs.axis_info[:2]
            units = [a.unit_name for a in axes]
            factors = [a.unit_conversion_factor for a in axes]
            distance = {"kind": "original_coordinate_units", "units": units,
                        "to_metres": None}
            if crs.is_projected and len(axes) == 2 and factors[0] == factors[1] and units[0] == units[1]:
                distance = {"kind": "projected_length", "units": units,
                            "to_metres": factors[0]}
            self.geometry = {
                "width": self.width, "height": self.height,
                "affine": self.affine, "crs_wkt": crs.to_wkt(),
                "crs_label": crs.to_string(), "distance": distance,
                "raster_units": {k: list(v.units) for k, v in self.datasets.items()},
                "bands": {k: {"dtype": v.dtypes[0],
                              "nodata": None if v.nodata is None or not math.isfinite(v.nodata) else v.nodata,
                              "nodata_is_nan": bool(v.nodata is not None and math.isnan(v.nodata))}
                          for k, v in self.datasets.items()},
                "bounds": list(direction.bounds)}
            if direction.dtypes[0] not in ("uint8", "int8", "int16", "uint16", "int32", "uint32", "int64", "uint64"):
                raise ValueError("Native direction encoding needs an original integer raster")
        except BaseException:
            self.stack.close()
            raise

    def close(self):
        self.stack.close()

    def __enter__(self):
        return self

    def __exit__(self, *args):
        self.close()

    def _tile(self, row, column):
        from rasterio.windows import Window
        key = (row // 256, column // 256)
        if key not in self.cache:
            r, c = key[0] * 256, key[1] * 256
            window = Window(c, r, min(256, self.width-c), min(256, self.height-r))
            self.cache[key] = {name: ds.read(1, window=window, masked=True)
                               for name, ds in self.datasets.items()}
            while len(self.cache) > 16:
                self.cache.popitem(last=False)
        self.cache.move_to_end(key)
        return self.cache[key]

    def read(self, row, column):
        if not 0 <= row < self.height or not 0 <= column < self.width:
            raise ValueError("Read only an actual native raster cell")
        tiles = self._tile(row, column)
        r, c = row % 256, column % 256
        def raw(role):
            value = tiles[role][r, c]
            import numpy as np
            if np.ma.is_masked(value):
                return None
            value = value.item()
            if isinstance(value, float) and not math.isfinite(value):
                return None
            return value
        terrain, direction, stream = raw("terrain"), raw("direction"), raw("stream")
        if stream is not None and stream not in (0, 1):
            raise ValueError("Native stream mask has a value other than 0, 1 or its declared nodata")
        value = {"terrain_valid": terrain is not None, "elevation": terrain,
                 "direction": direction, "stream": None if stream is None else bool(stream)}
        self.observed[(row, column)] = value
        return value

    def overview_png(self):
        import numpy as np
        from rasterio.enums import Resampling
        import struct
        import zlib
        width = min(640, self.width)
        height = max(1, round(self.height * width / self.width))
        if height > 640:
            height = 640
            width = max(1, round(self.width * height / self.height))
        dem = self.datasets["terrain"].read(1, out_shape=(height, width), masked=True,
                                            resampling=Resampling.nearest)
        stream = self.datasets["stream"].read(1, out_shape=(height, width), masked=True,
                                               resampling=Resampling.nearest)
        valid = ~np.ma.getmaskarray(dem) & np.isfinite(dem.data)
        grey = np.full((height, width), 250, dtype=np.uint8)
        if valid.any():
            low, high = float(dem.data[valid].min()), float(dem.data[valid].max())
            if high > low:
                grey[valid] = np.clip(220 - 120 * (dem.data[valid]-low)/(high-low), 80, 220).astype(np.uint8)
            else:
                grey[valid] = 185
        valid_stream = ~np.ma.getmaskarray(stream) & (stream.data == 1) & valid
        grey[valid_stream] = 30
        rgb = np.repeat(grey[:, :, None], 3, axis=2)
        raw = b"".join(b"\0" + row.tobytes() for row in rgb)
        def chunk(kind, data):
            return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind+data)&0xffffffff)
        png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", width,height,8,2,0,0,0))
        png += chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b"")
        return {"mime_type": "image/png", "data_base64": base64.b64encode(png).decode("ascii"),
                "width": width, "height": height,
                "note": "Nearest-cell display of the original terrain and stream rasters; full-resolution cells are used for routing."}


@verified_operation
def source_view(workspace, run_id, model):
    source = retained_source(workspace, run_id, model)
    with OriginalRasterReader(workspace, source) as reader:
        return {"source": source, "geometry": reader.geometry, "overview": reader.overview_png()}


def available_runs(workspace):
    result = []
    for path in sorted((workspace.root / "runs").glob("*/run.json")):
        run = workspace.inspect_run(path.parent.name)
        stages = []
        for model, stage in (run.get("stages") or {}).items():
            if model in ("ndr", "sdr") and stage.get("completed_at"):
                stages.append({"model": model, "completed_at": stage["completed_at"],
                               "registry_ids": sorted(stage.get("files") or {})})
        if stages:
            result.append({"id": run["id"], "state": run["state"],
                           "selection": deepcopy(run["selection"]), "stages": stages})
    return result
