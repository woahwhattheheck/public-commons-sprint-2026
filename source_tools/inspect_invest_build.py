#!/usr/bin/env python3
"""Read the actual receiver's native build inventory and pinned source metadata.
No packages are installed, no files are extracted, no model is executed.
"""
import argparse
import email
import hashlib
import importlib
import importlib.metadata as md
import json
import platform
import shlex
import shutil
import subprocess
import sys
import sysconfig
import tarfile
from pathlib import Path

PACKAGES = [
    {
        "name": "natcap.invest",
        "version": "3.20.0",
        "filename": "natcap_invest-3.20.0.tar.gz",
        "bytes": 2175814,
        "sha256": "95fb4ce2c19b520edd40b37b561ccd220a6aeb46abaf399b609e828c2c3ea3f7",
        "url": "https://files.pythonhosted.org/packages/1d/da/c003159f301a7965231117f5021c61be351c0efc1536a302c2ad2f0d6a39/natcap_invest-3.20.0.tar.gz",
        "metadata_url": "https://pypi.org/pypi/natcap.invest/3.20.0/json",
        "requires_python": ">=3.10"
    },
    {
        "name": "pygeoprocessing",
        "version": "2.4.11",
        "filename": "pygeoprocessing-2.4.11.tar.gz",
        "bytes": 1077805,
        "sha256": "5e1f49e4f925400f140280120b2ba563263c96f0ae11a8b12444bcc899d2787a",
        "url": "https://files.pythonhosted.org/packages/a1/76/7a2422c65242d2a3d3959879d4b8535878557429ce44f7e893cb3b611127/pygeoprocessing-2.4.11.tar.gz",
        "metadata_url": "https://pypi.org/pypi/pygeoprocessing/2.4.11/json",
        "requires_python": ">=3.6"
    }
]
DISTRIBUTIONS = (
    "pip setuptools wheel setuptools-scm Cython numpy GDAL pygeoprocessing "
    "natcap.invest Pyro5 pandas Rtree Shapely scipy taskgraph psutil chardet "
    "pint Babel Flask Flask-Cors requests geometamaker pydantic certifi "
    "docutils altair Fiona geopandas Jinja2 matplotlib distinctipy "
    "importlib-metadata packaging"
).split()

def command(args):
    try:
        result = subprocess.run(args, capture_output=True, text=True, timeout=15)
        return {"command": args, "returncode": result.returncode,
                "stdout": result.stdout.strip(), "stderr": result.stderr.strip()}
    except (OSError, subprocess.TimeoutExpired) as error:
        return {"command": args, "error": str(error)}

def distribution(name):
    try:
        dist = md.distribution(name)
        return {"name": name, "version": dist.version,
                "location": str(dist.locate_file("")),
                "requires_python": dist.metadata.get("Requires-Python"),
                "requires_dist": dist.metadata.get_all("Requires-Dist", [])}
    except md.PackageNotFoundError:
        return {"name": name, "missing": True}

def import_probe(name):
    try:
        module = importlib.import_module(name)
        value = {"module": name, "file": getattr(module, "__file__", None)}
        if name == "osgeo.gdal":
            value.update(release=module.VersionInfo("RELEASE_NAME"),
                         version_num=module.VersionInfo())
        if name == "numpy":
            value.update(version=module.__version__, include=module.get_include())
        return value
    except Exception as error:
        return {"module": name, "error_type": type(error).__name__, "error": str(error)}

def source_metadata(directory):
    records = []
    for package in PACKAGES:
        path = directory / package["filename"]
        record = {**package, "path": str(path)}
        if not path.is_file():
            record["missing"] = True
            records.append(record)
            continue
        digest = hashlib.sha256()
        size = 0
        with path.open("rb") as stream:
            while chunk := stream.read(1024 * 1024):
                digest.update(chunk)
                size += len(chunk)
        record.update(actual_bytes=size, actual_sha256=digest.hexdigest())
        record["verified"] = (size == package["bytes"]
                              and digest.hexdigest() == package["sha256"])
        if not record["verified"]:
            records.append(record)
            continue
        with tarfile.open(path, "r:gz") as archive:
            members = [member for member in archive.getmembers()
                       if member.isfile() and len(Path(member.name).parts) == 2
                       and Path(member.name).name in
                       {"PKG-INFO", "pyproject.toml", "requirements.txt", "setup.py"}]
            record["metadata"] = {}
            for member in members:
                if member.size > 2 * 1024 * 1024:
                    raise ValueError("Unexpected oversized source metadata")
                body = archive.extractfile(member).read()
                name = Path(member.name).name
                item = {"archive_member": member.name, "bytes": len(body),
                        "sha256": hashlib.sha256(body).hexdigest(),
                        "text": body.decode("utf-8")}
                if name == "PKG-INFO":
                    parsed = email.message_from_bytes(body)
                    item.update(requires_python=parsed.get("Requires-Python"),
                                requires_dist=parsed.get_all("Requires-Dist", []),
                                version=parsed.get("Version"), name=parsed.get("Name"))
                record["metadata"][name] = item
        records.append(record)
    return records

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--artifacts", type=Path)
    parser.add_argument("--probe-built", action="store_true")
    args = parser.parse_args()
    result = {
        "schema": "upstate.invest-build-inventory/v1",
        "host": platform.node(), "python": sys.version,
        "executable": sys.executable, "prefix": sys.prefix,
        "base_prefix": sys.base_prefix, "machine": platform.machine(),
        "platform": platform.platform(),
        "soabi": sysconfig.get_config_var("SOABI"),
        "python_include": sysconfig.get_path("include"),
        "python_h_exists": (Path(sysconfig.get_path("include")) / "Python.h").is_file(),
        "distributions": [distribution(name) for name in DISTRIBUTIONS],
        "executables": {name: shutil.which(name)
                        for name in ("gdal-config", "g++", "c++", "gcc", "clang++", "pybabel")},
        "gdal_config": {name: command(["gdal-config", "--" + name])
                        for name in ("version", "cflags", "libs")},
        "compiler": command(["c++", "--version"]),
        "imports": [import_probe("osgeo.gdal"), import_probe("numpy")],
    }
    flags = result["gdal_config"]["cflags"].get("stdout", "")
    includes = [Path(flag[2:]) for flag in shlex.split(flags) if flag.startswith("-I")]
    result["gdal_headers"] = [
        {"directory": str(path), "gdal_h": (path / "gdal.h").is_file(),
         "gdal_priv_h": (path / "gdal_priv.h").is_file()}
        for path in includes]
    if args.artifacts:
        result["source_artifacts"] = source_metadata(args.artifacts.resolve())
    if args.probe_built:
        result["imports"].extend(import_probe(name) for name in (
            "pygeoprocessing", "pygeoprocessing.routing.routing",
            "pygeoprocessing.geoprocessing_core", "natcap.invest.ndr.ndr_core",
            "natcap.invest.sdr.sdr_core", "natcap.invest.ndr.ndr", "natcap.invest.sdr.sdr"))
    failures = []
    for artifact in result.get("source_artifacts", []):
        if not artifact.get("verified"):
            failures.append("Source archive missing or mismatched: " + artifact["filename"])
    if args.probe_built:
        for probe in result["imports"]:
            if probe.get("error"):
                failures.append("Import failed: " + probe["module"])
        by_name = {row["name"]: row for row in result["distributions"]}
        for name, expected in (("natcap.invest", "3.20.0"), ("pygeoprocessing", "2.4.11")):
            actual = by_name[name].get("version")
            if actual != expected:
                failures.append(f"{name}: expected {expected}, observed {actual!r}")
    result["failures"] = failures
    print(json.dumps(result, indent=2, sort_keys=True))
    return 1 if failures else 0

if __name__ == "__main__":
    raise SystemExit(main())
