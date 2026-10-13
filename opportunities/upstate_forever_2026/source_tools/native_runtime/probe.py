"""Probe the actual selected native runtime, never substitute model outputs."""
from __future__ import annotations

import ast
import hashlib
import importlib
import importlib.metadata as metadata
import inspect
import json
import os
from pathlib import Path
import platform
import sys
import sysconfig
import tempfile


def selected_source(application):
    """Read maintained literal pins without importing the application or executing code."""
    path = Path(application).resolve(strict=True) / "model" / "common.py"
    module = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    values = {}
    for node in module.body:
        if isinstance(node, ast.Assign):
            for target in node.targets:
                if isinstance(target, ast.Name) and target.id in ("INVEST_VERSION", "INVEST_SOURCE"):
                    values[target.id] = ast.literal_eval(node.value)
    if set(values) != {"INVEST_VERSION", "INVEST_SOURCE"}:
        raise ValueError("The selected application does not declare its original InVEST pins")
    version = values["INVEST_VERSION"]
    source = values["INVEST_SOURCE"]
    if not isinstance(version, str) or not isinstance(source, dict):
        raise ValueError("Invalid maintained native source declarations")
    for key in ("ndr_blob", "sdr_blob"):
        value = source.get(key, "")
        if not isinstance(value, str) or len(value) != 40 or any(c not in "0123456789abcdef" for c in value):
            raise ValueError("Missing maintained model source identity: " + key)
    return {"version": version, "source": source,
            "common_sha256": hashlib.sha256(path.read_bytes()).hexdigest()}


def identity():
    return {"python": platform.python_version(), "implementation": platform.python_implementation(),
            "cache_tag": sys.implementation.cache_tag, "soabi": sysconfig.get_config_var("SOABI"),
            "system": platform.system(), "machine": platform.machine(),
            "libc": list(platform.libc_ver()), "prefix": sys.prefix,
            "executable": sys.executable}


def run(selection, application=None):
    """Load exact NDR/SDR, check the native GDAL stack, then the original adapter.

    The raster round trip exercises driver availability and pygeoprocessing/GDAL
    ABI cooperation. It is not a nutrient or sediment scientific-model run.
    """
    result = {"schema": "upstate.native-runtime-probe/v1", "identity": identity(),
              "selection": selection, "packages": {}, "checks": {}, "errors": []}

    def check(name, operation):
        try:
            value = operation()
            result["checks"][name] = {"state": "complete", "result": value}
            return value
        except Exception as exc:
            issue = {"check": name, "type": type(exc).__name__, "message": str(exc)}
            result["checks"][name] = {"state": "failed", **issue}
            result["errors"].append(issue)
            return None

    for package in ("natcap.invest", "GDAL", "pygeoprocessing", "taskgraph", "numpy",
                    "scipy", "rasterio", "fiona", "shapely", "pyproj", "pandas", "reportlab", "matplotlib", "pillow"):
        try:
            result["packages"][package] = metadata.version(package)
        except metadata.PackageNotFoundError:
            result["packages"][package] = None

    def models():
        version = metadata.version("natcap.invest")
        if version != selection["version"]:
            raise ValueError(f"Selected InVEST {selection['version']}; installed {version}")
        found = {}
        for name in ("ndr", "sdr"):
            module = importlib.import_module(f"natcap.invest.{name}.{name}")
            path = Path(inspect.getsourcefile(module))
            body = path.read_bytes()
            blob = hashlib.sha1(b"blob " + str(len(body)).encode() + b"\0" + body).hexdigest()
            expected = selection["source"][name + "_blob"]
            if blob != expected:
                raise ValueError(f"Native {name} source {blob} differs from application {expected}")
            if not callable(module.execute) or not callable(module.validate):
                raise ValueError("Native model lacks its execute/validate entry points")
            found[name] = {"git_blob": blob, "sha256": hashlib.sha256(body).hexdigest()}
        return found

    check("selected_native_models", models)

    def geospatial():
        from osgeo import gdal, osr
        import numpy as np
        import pygeoprocessing
        import pygeoprocessing.routing
        import rasterio
        import fiona
        from pyproj import Transformer
        from shapely.geometry import box
        gdal.UseExceptions()
        with tempfile.TemporaryDirectory(prefix="upstate-runtime-probe-") as scratch:
            path = str(Path(scratch) / "runtime-probe.tif")
            spatial = osr.SpatialReference()
            spatial.ImportFromEPSG(26917)
            expected = np.arange(64, dtype=np.float32).reshape(8, 8)
            driver = gdal.GetDriverByName("GTiff")
            target = driver.Create(path, 8, 8, 1, gdal.GDT_Float32)
            if target is None:
                raise RuntimeError("GDAL GTiff driver could not create a raster")
            target.SetGeoTransform((350000, 30, 0, 3800000, 0, -30))
            target.SetProjection(spatial.ExportToWkt())
            target.GetRasterBand(1).SetNoDataValue(-9999)
            target.GetRasterBand(1).WriteArray(expected)
            target.FlushCache()
            target = None
            info = pygeoprocessing.get_raster_info(path)
            if tuple(info["raster_size"]) != (8, 8):
                raise ValueError("pygeoprocessing returned a different grid")
            with rasterio.open(path) as source:
                if not np.array_equal(source.read(1), expected) or source.crs.to_epsg() != 26917:
                    raise ValueError("GDAL/rasterio round trip differs")
            point = Transformer.from_crs(26917, 4326, always_xy=True).transform(350000, 3800000)
            if not all(np.isfinite(point)) or box(0, 0, 30, 30).area != 900:
                raise ValueError("Native CRS/geometry operations differ")
            if "GPKG" not in fiona.supported_drivers:
                raise ValueError("Fiona GPKG driver unavailable")
        return {"gdal": gdal.VersionInfo("RELEASE_NAME"), "raster_shape": [8, 8],
                "raster_crs": "EPSG:26917", "cell_area_ha": 0.09,
                "routing_module": pygeoprocessing.routing.__name__}

    check("geospatial_round_trip", geospatial)
    def application_support():
        loaded = {}
        for name in ("taskgraph", "scipy", "pandas", "reportlab", "matplotlib", "PIL"):
            module = importlib.import_module(name)
            loaded[name] = str(getattr(module, "__version__", result["packages"].get(name)))
        return loaded
    check("application_support", application_support)
    if application is not None:
        def original():
            root = str(Path(application).resolve(strict=True))
            sys.path.insert(0, root)
            from model.native import runtime
            modules, source = runtime(("ndr", "sdr"))
            return {"version": source["version"], "models": sorted(modules),
                    "modules": source["modules"]}
        check("original_application_runtime", original)
    result["state"] = "ready" if not result["errors"] else "unavailable"
    return result


def main():
    import argparse
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--selection", required=True, type=Path)
    parser.add_argument("--application", type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    selection = json.loads(args.selection.read_text(encoding="utf-8"))
    result = run(selection, args.application)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix=".probe-", dir=args.output.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as stream:
            json.dump(result, stream, indent=2, sort_keys=True, allow_nan=False)
            stream.write("\n")
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, args.output)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)
    print(json.dumps({"state": result["state"], "output": str(args.output)}, sort_keys=True), flush=True)
    return 0 if result["state"] == "ready" else 2


if __name__ == "__main__":
    raise SystemExit(main())
