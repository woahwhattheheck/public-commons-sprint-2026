"""Standalone process entry requiring the real, pinned InVEST installation.

Only standard-library imports precede native imports, so the main application
and native geospatial environment can use different Python interpreters.
"""
from __future__ import annotations
import importlib
import importlib.metadata
import inspect
import json
import logging
import os
from pathlib import Path
import sys
import tempfile
import traceback

MODULES = {"ndr": "natcap.invest.ndr.ndr", "sdr": "natcap.invest.sdr.sdr",
           "annual_water_yield": "natcap.invest.annual_water_yield"}


def describe(expected: str) -> dict:
    import hashlib
    from osgeo import gdal
    actual = importlib.metadata.version("natcap.invest")
    if actual != expected:
        raise RuntimeError(f"Expected InVEST {expected}; installed {actual}")
    modules = {name: hashlib.sha256(Path(inspect.getsourcefile(importlib.import_module(module).execute)).read_bytes()).hexdigest()
               for name, module in MODULES.items()}
    packages = {name: importlib.metadata.version(name)
                for name in ("natcap.invest", "pygeoprocessing", "taskgraph", "numpy", "scipy")}
    return {"invest_version": actual, "python": sys.version, "gdal": gdal.VersionInfo(),
            "modules": modules, "packages": packages}


def main() -> int:
    if sys.argv[1] == "--describe":
        print(json.dumps(describe(sys.argv[2])))
        return 0
    request = json.loads(Path(sys.argv[1]).read_text())
    actual = importlib.metadata.version("natcap.invest")
    if actual != request["invest_version"]:
        raise RuntimeError(f"Expected InVEST {request['invest_version']}; installed {actual}")
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    model = importlib.import_module(MODULES[request["model"]])
    findings = model.validate(request["args"])
    if findings:
        print(json.dumps({"native_validation": findings}, default=str), flush=True)
        raise RuntimeError("Native InVEST input validation returned findings; see original messages above")
    model.execute(request["args"])
    from osgeo import gdal
    source_path = Path(inspect.getsourcefile(model.execute))
    import hashlib
    receipt = {"model": request["model"], "module": model.__name__,
               "invest_version": actual, "gdal_version": gdal.VersionInfo(),
               "python": sys.version, "module_sha256": hashlib.sha256(source_path.read_bytes()).hexdigest()}
    destination = Path(request["receipt"])
    fd, name = tempfile.mkstemp(dir=destination.parent)
    with os.fdopen(fd, "w") as output:
        json.dump(receipt, output, indent=2)
        output.flush()
        os.fsync(output.fileno())
    os.replace(name, destination)
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception:
        traceback.print_exc()
        sys.exit(1)
