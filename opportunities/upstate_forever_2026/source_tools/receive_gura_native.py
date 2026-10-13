#!/usr/bin/env python3
"""Receive the official InVEST 3.20.0 Gura sources and run their original models.

This is an operational receiving driver. It uses the actual release archives,
the application's retained Workspace, and its original strict native runtime.
"""
from __future__ import annotations

import argparse
import csv
from datetime import datetime, timezone
import hashlib
import importlib.metadata
import json
import logging
import math
import os
from pathlib import Path, PurePosixPath
import shutil
import sys
import tempfile
import traceback
import zipfile

RELEASE = "3.20.0"
ARCHIVES = {
    "ndr": {
        "name": "NDR.zip", "size": 701988,
        "sha256": "df4ba0d9b96152d3bc5eef3c41b6ec701f62ec3548dc4d4d4c8af8bea53c6c7d",
        "url": "https://storage.googleapis.com/releases.naturalcapitalproject.org/invest/3.20.0/data/NDR.zip",
        "generation": "1781204725169434", "arguments": "NDR/ndr_gura.invs.json",
        "readme": "NDR/_README_InVEST_NDR_model_data.txt",
    },
    "sdr": {
        "name": "SDR.zip", "size": 726334,
        "sha256": "34351a1305d8e6258c2d566917cfeab5f152096e930ef5b0a834968146bdc779",
        "url": "https://storage.googleapis.com/releases.naturalcapitalproject.org/invest/3.20.0/data/SDR.zip",
        "generation": "1781204725769073", "arguments": "SDR/sdr_gura.invs.json",
        "readme": "SDR/_README_InVEST_SDR_model_data.txt",
    },
}
ARGUMENT_KEYS = {
    "ndr": ("threshold_flow_accumulation", "k_param", "flow_dir_algorithm",
            "subsurface_critical_length_n", "subsurface_eff_n"),
    "sdr": ("threshold_flow_accumulation", "k_param", "flow_dir_algorithm",
            "sdr_max", "ic_0_param", "l_max"),
}
NATIVE_COLUMNS = {
    "ndr": ("lucode", "load_n", "load_p", "load_type_n", "load_type_p", "eff_n",
            "eff_p", "crit_len_n", "crit_len_p", "proportion_subsurface_n"),
    "sdr": ("lucode", "usle_c", "usle_p"),
}
INPUTS = {
    "ndr": {"DEM": ("dem_path", "m"), "NLCD": ("lulc_path", "class"),
            "PRECIPITATION": ("runoff_proxy_path", "original runoff proxy")},
    "sdr": {"DEM": ("dem_path", "m"), "NLCD": ("lulc_path", "class"),
            "R_FACTOR": ("erosivity_path", "MJ*mm/(ha*h*year)"),
            "K_FACTOR": ("erodibility_path", "t*ha*h/(ha*MJ*mm)")},
}
OUTPUTS = {
    "ndr": (("nitrogen", "n_total_export", "kg/year"),
            ("phosphorus", "p_surface_export", "kg/year")),
    "sdr": (("sediment", "sed_export", "t/year"),),
}
EXPECTED = {
    "ndr": {"calc_n": True, "calc_p": True, "k_param": "2",
            "threshold_flow_accumulation": "1000", "flow_dir_algorithm": "MFD",
            "subsurface_critical_length_n": "200", "subsurface_eff_n": "0.8"},
    "sdr": {"k_param": "2", "ic_0_param": "0.5", "sdr_max": "0.8", "l_max": "122",
            "threshold_flow_accumulation": "1000", "flow_dir_algorithm": "MFD",
            "drainage_path": ""},
}
SCOPE = {
    "geography": "Gura watershed, Kenya",
    "source_release": "Official InVEST 3.20.0 sample data",
    "coordinate_reference": "EPSG:32737",
    "original_cell_size_m": 15,
    "model_purpose": "Run the supplied Gura scientific example through the maintained application",
    "regional_work": "Upper Savannah source studies retain their own geographic inputs and identities",
}


def now():
    return datetime.now(timezone.utc).isoformat()


def sha(path):
    value = hashlib.sha256()
    with Path(path).open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            value.update(block)
    return value.hexdigest()


def canonical(value):
    return json.dumps(value, sort_keys=True, ensure_ascii=False,
                      separators=(",", ":"), allow_nan=False).encode("utf-8")


def native_cohort(metadata, model):
    names = ("ndr", "sdr") if model == "ndr" else ("sdr",)
    source_modules = metadata.get("modules", {})
    if any(name not in source_modules for name in names):
        raise ValueError("Native source metadata lacks the selected model dependencies")
    result = {key: value for key, value in metadata.items()
              if key not in ("selected_models", "modules")}
    result["modules"] = {name: source_modules[name] for name in names}
    return result


def atomic(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    data = json.dumps(value, indent=2, sort_keys=True, ensure_ascii=False,
                      allow_nan=False).encode("utf-8") + b"\n"
    pending = None
    try:
        with tempfile.NamedTemporaryFile(dir=path.parent, prefix=".gura-", delete=False) as out:
            pending = Path(out.name)
            out.write(data)
            out.flush()
            os.fsync(out.fileno())
        os.replace(pending, path)
    finally:
        if pending is not None:
            pending.unlink(missing_ok=True)


def artifact(path, root):
    path = Path(path).resolve(strict=True)
    return {"path": path.relative_to(Path(root).resolve()).as_posix(),
            "bytes": path.stat().st_size, "sha256": sha(path)}


def files_match(root, entries):
    for item in entries:
        path = Path(root) / item["path"]
        if not path.is_file() or path.stat().st_size != item["bytes"] or sha(path) != item["sha256"]:
            return False
    return True


def emit(stage, **value):
    print(json.dumps({"time": now(), "stage": stage, **value},
                     sort_keys=True, ensure_ascii=False, allow_nan=False), flush=True)


def find_archive(root, name):
    root = Path(root).resolve(strict=True)
    direct = root / name
    if direct.is_file():
        return direct
    choices = sorted(p for p in root.rglob(name) if p.is_file())
    if len(choices) != 1:
        raise ValueError("Provide the official " + name + " archive under --inputs; found "
                         + str(len(choices)) + " matching files")
    return choices[0]


def restored_original(receiving, model, record):
    """Resolve an archived original edition from its exact retained inventory."""
    from model.common import verify_file
    spec = ARCHIVES[model]
    if not isinstance(record, dict) or record.get("model") != model:
        raise ValueError("Supply --inputs for the original " + model.upper() + " intake")
    if any(record.get("archive", {}).get(key) != value for key, value in spec.items()):
        raise ValueError("The retained " + model.upper() + " source has another release identity")
    prefix = PurePosixPath("original") / model
    root = (receiving / prefix).resolve(strict=True)
    if not root.is_relative_to(receiving.resolve()):
        raise ValueError("The original source directory escapes its received Workspace")
    inventory = {}
    entries = record.get("source_files")
    if not isinstance(entries, list) or not entries:
        raise ValueError("The original source inventory is missing")
    for descriptor in entries:
        name = descriptor.get("path")
        member = PurePosixPath(name) if isinstance(name, str) else None
        if (member is None or member.is_absolute() or member.as_posix() != name
                or "\\" in name or "\0" in name or ".." in member.parts
                or member.parts[:2] != prefix.parts or len(member.parts) < 3
                or name in inventory):
            raise ValueError("The original source inventory has an invalid or repeated member")
        retained = verify_file(receiving, descriptor)
        if not retained.is_relative_to(root):
            raise ValueError("The original source member escapes its retained model directory")
        inventory[name] = retained
    argument_name = (prefix / spec["arguments"]).as_posix()
    if argument_name not in inventory:
        raise ValueError("The retained original argument document is missing")
    argument_path = inventory[argument_name]
    source = json.loads(argument_path.read_text(encoding="utf-8-sig"))
    if (source.get("model_name") != "natcap.invest." + model + "." + model
            or source.get("invest_version") != record.get("embedded_version")
            or source.get("args") != record.get("original_arguments")):
        raise ValueError("The retained original argument document changed")
    arguments = source["args"]
    if any(arguments.get(key) != value for key, value in EXPECTED[model].items()):
        raise ValueError("The retained original model settings differ from the release")
    absolute = dict(arguments)
    for key, token in arguments.items():
        if key.endswith("_path") and token:
            path = (argument_path.parent / token).resolve(strict=True)
            if not path.is_relative_to(root):
                raise ValueError("The original model argument escapes its retained source")
            name = path.relative_to(receiving.resolve()).as_posix()
            if name not in inventory or inventory[name] != path:
                raise ValueError("The original model input is absent from its verified inventory: " + key)
            absolute[key] = str(path)
    # Keep the producing machine's original locations as source provenance.
    provenance = record.get("original_locations") or {
        key: record[key] for key in ("argument_path", "absolute_arguments", "readme_paths")
        if key in record}
    return {**record, "argument_path": str(argument_path),
            "absolute_arguments": absolute, "original_locations": provenance,
            "readme_paths": [str(path) for name, path in sorted(inventory.items())
                             if "README" in Path(name).name.upper()]}


def unpack_original(inputs, receiving, model):
    spec = ARCHIVES[model]
    archive = find_archive(inputs, spec["name"])
    if archive.stat().st_size != spec["size"] or sha(archive) != spec["sha256"]:
        raise ValueError("The supplied " + spec["name"] + " differs from the official 3.20.0 release")
    root = receiving / "original" / model
    root.mkdir(parents=True, exist_ok=True)
    entries = []
    with zipfile.ZipFile(archive) as source:
        seen = set()
        for item in source.infolist():
            member = PurePosixPath(item.filename)
            if (member.is_absolute() or ".." in member.parts or "\\" in item.filename
                    or "\0" in item.filename or not member.parts):
                raise ValueError("Invalid path inside original archive: " + item.filename)
            if item.is_dir():
                continue
            if member.as_posix() in seen:
                raise ValueError("Repeated original archive member: " + item.filename)
            seen.add(member.as_posix())
            if ((item.external_attr >> 16) & 0o170000) == 0o120000:
                raise ValueError("Unexpected symbolic link in original archive")
            path = root.joinpath(*member.parts)
            if path.is_symlink():
                raise ValueError("Original source path became a symbolic link")
            path.parent.mkdir(parents=True, exist_ok=True)
            if not path.parent.resolve().is_relative_to(root.resolve()):
                raise ValueError("Retained original source directory escapes its receiver")
            content = source.read(item)
            expected = hashlib.sha256(content).hexdigest()
            if path.exists():
                if not path.is_file() or path.stat().st_size != len(content) or sha(path) != expected:
                    raise ValueError("Retained original source differs: " + str(path))
            else:
                with path.open("xb") as out:
                    out.write(content)
            entries.append(artifact(path, receiving))
    argument_path = root / spec["arguments"]
    original = json.loads(argument_path.read_text(encoding="utf-8-sig"))
    if original.get("model_name") != "natcap.invest." + model + "." + model:
        raise ValueError("Original model identity differs in " + str(argument_path))
    args = dict(original["args"])
    for key, expected in EXPECTED[model].items():
        if args.get(key) != expected:
            raise ValueError("Original " + model.upper() + " setting differs: " + key)
    absolute = dict(args)
    for key, token in args.items():
        if key.endswith("_path") and token:
            path = (argument_path.parent / token).resolve(strict=True)
            if not path.is_relative_to(root.resolve()):
                raise ValueError("Original model argument escapes its received archive: " + key)
            absolute[key] = str(path)
    readmes = sorted(p for p in root.rglob("*") if p.is_file() and "README" in p.name.upper())
    return {
        "model": model, "archive": {**spec, "supplied_path": str(archive)},
        "embedded_version": original.get("invest_version"),
        "argument_path": str(argument_path), "original_arguments": args,
        "absolute_arguments": absolute, "source_files": entries,
        "readme_paths": [str(p) for p in readmes],
    }


def sidecars(path):
    path = Path(path)
    choices = []
    if path.suffix.lower() == ".shp":
        choices = sorted(p for p in path.parent.iterdir()
                         if p.is_file() and p != path and p.name.startswith(path.stem + "."))
        suffixes = {p.suffix.lower() for p in choices}
        if not {".dbf", ".shx", ".prj"}.issubset(suffixes):
            raise ValueError("Retain the original shape/index/attributes/projection files for " + str(path))
    elif path.suffix.lower() in (".tif", ".tiff"):
        choices = sorted(p for p in path.parent.iterdir()
                         if p.is_file() and p != path and p.name.startswith(path.name + "."))
    return choices


def input_record(receiving, model_info, source_id, key, *, kind, units=None):
    path = Path(model_info["absolute_arguments"][key])
    value = {
        "id": source_id, "title": "Gura " + model_info["model"].upper() + " original " + path.name,
        "kind": kind, "path": path.relative_to(receiving).as_posix(), "sha256": sha(path),
        "uri": model_info["archive"]["url"] + "#" + path.relative_to(receiving / "original"
                                                                       / model_info["model"]).as_posix(),
        "vintage": "Official InVEST 3.20.0 sample release; original lineage retained in README",
        "companions": [{"path": p.relative_to(receiving).as_posix(), "sha256": sha(p)}
                       for p in sidecars(path)],
    }
    if units is not None:
        value["units"] = units
    if kind == "raster":
        # These already share the actual source lattice. A nearest-neighbor
        # window copy preserves original values before the native engine aligns.
        value["resampling"] = "nearest"
    return value


def raster_identity(path):
    import rasterio
    from pyproj import CRS
    with rasterio.open(path) as src:
        crs = CRS.from_user_input(src.crs)
        t = src.transform
        if (crs.to_epsg() != 32737 or src.count != 1
                or not math.isclose(t.a, 15, rel_tol=0, abs_tol=1e-8)
                or not math.isclose(t.e, -15, rel_tol=0, abs_tol=1e-8)
                or t.b or t.d):
            raise ValueError("The official Gura source must retain its supplied EPSG:32737 15 m lattice")
        return {"crs": src.crs.to_string(), "transform": list(t)[:6],
                "width": src.width, "height": src.height,
                "pixel_area_ha": abs(t.a * t.e - t.b * t.d) / 10000}


def equal_native_rasters(first, second):
    if sha(first) == sha(second):
        return {"equal": True, "method": "identical original source bytes"}
    import numpy as np
    import rasterio
    with rasterio.open(first) as a, rasterio.open(second) as b:
        if (a.crs != b.crs or a.width != b.width or a.height != b.height
                or any(not math.isclose(x, y, rel_tol=0, abs_tol=1e-8)
                       for x, y in zip(list(a.transform)[:6], list(b.transform)[:6]))):
            raise ValueError("Gura NDR/SDR common raster grids differ: " + Path(first).name)
        for _, window in a.block_windows(1):
            x = a.read(1, window=window, masked=True)
            y = b.read(1, window=window, masked=True)
            mx, my = np.ma.getmaskarray(x), np.ma.getmaskarray(y)
            if not np.array_equal(mx, my) or not np.array_equal(x.data[~mx], y.data[~my]):
                raise ValueError("Gura NDR/SDR common raster values differ: " + Path(first).name)
    return {"equal": True, "method": "same actual grid, valid-cell mask and original values"}


def equal_watersheds(first, second):
    import fiona
    from pyproj import CRS
    from shapely.geometry import shape
    from shapely.ops import unary_union
    with fiona.open(first) as a, fiona.open(second) as b:
        if CRS.from_user_input(a.crs_wkt or a.crs) != CRS.from_user_input(b.crs_wkt or b.crs):
            raise ValueError("Original Gura watershed coordinate systems differ")
        x = unary_union([shape(row["geometry"]) for row in a])
        y = unary_union([shape(row["geometry"]) for row in b])
        if x.is_empty or y.is_empty or not x.equals(y):
            raise ValueError("Original Gura watershed masks differ between NDR and SDR")
    return {"equal": True, "method": "same original watershed polygon union"}


def joined_table(receiving, originals, active):
    tables = {}
    for model in active:
        path = Path(originals[model]["absolute_arguments"]["biophysical_table_path"])
        with path.open(encoding="utf-8-sig", newline="") as stream:
            reader = csv.DictReader(stream)
            fields = reader.fieldnames or []
            missing = set(NATIVE_COLUMNS[model]) - set(fields)
            if missing:
                raise ValueError("Original " + model.upper() + " table lacks " + ", ".join(sorted(missing)))
            rows = {}
            for line, row in enumerate(reader, 2):
                code = int(row["lucode"].strip())
                if code in rows:
                    raise ValueError("Original table has duplicate lucode at line " + str(line))
                rows[code] = row
        if not rows:
            raise ValueError("Original biophysical table is empty")
        tables[model] = {"path": str(path), "sha256": sha(path), "fields": fields, "rows": rows}
    common = set.intersection(*(set(tables[m]["rows"]) for m in active))
    if not common:
        raise ValueError("Original model tables have no common land-cover classes")
    fields = ["lucode"]
    for model in active:
        for field in NATIVE_COLUMNS[model]:
            if field not in fields:
                fields.append(field)
        for field in tables[model]["fields"]:
            if field not in NATIVE_COLUMNS[model]:
                fields.append(model + "__" + field)
    rows = []
    for code in sorted(common):
        row = {"lucode": str(code)}
        for model in active:
            original = tables[model]["rows"][code]
            for field in NATIVE_COLUMNS[model]:
                if field != "lucode":
                    row[field] = original[field]
            for field in tables[model]["fields"]:
                if field not in NATIVE_COLUMNS[model]:
                    row[model + "__" + field] = original[field]
        rows.append(row)
    path = receiving / "derived" / ("gura-" + "-".join(active) + "-biophysical.csv")
    path.parent.mkdir(parents=True, exist_ok=True)
    import io
    stream = io.StringIO(newline="")
    writer = csv.DictWriter(stream, fieldnames=fields, lineterminator="\n")
    writer.writeheader()
    writer.writerows(rows)
    data = stream.getvalue().encode("utf-8")
    if path.exists() and path.read_bytes() != data:
        raise ValueError("Retained keyed biophysical join differs from the original input tables")
    if not path.exists():
        path.write_bytes(data)
    derivation = {
        "operation": "inner join of original model-specific fields by integer lucode",
        "value_policy": "original numerical strings and load-type strings retained",
        "additional_columns": "original descriptive columns retained with their model prefix",
        "input_tables": {m: {"path": tables[m]["path"], "sha256": tables[m]["sha256"],
                             "excluded_noncommon_lucodes": sorted(set(tables[m]["rows"]) - common)}
                         for m in active},
        "lucodes": sorted(common), "source_coverage": "Workspace verifies every actual land-cover class",
        "output": artifact(path, receiving),
    }
    provenance_path = path.with_suffix(".provenance.json")
    if provenance_path.exists():
        retained = json.loads(provenance_path.read_text(encoding="utf-8"))
        # Source paths describe the original producing location. A received
        # Workspace keeps that provenance and compares the actual source bytes.
        def scientific_identity(value):
            return {**value, "input_tables": {
                model: {key: item for key, item in table.items() if key != "path"}
                for model, table in value["input_tables"].items()}}
        if scientific_identity(retained) != scientific_identity(derivation):
            raise ValueError("Retained biophysical provenance differs from the original source join")
        derivation = retained
    else:
        atomic(provenance_path, derivation)
    return path, derivation


def manifest_for(receiving, originals, active):
    records, roles, equality = [], {}, {}
    primary = active[0]
    if len(active) == 2:
        for key in ("dem_path", "lulc_path"):
            equality[key] = equal_native_rasters(originals["ndr"]["absolute_arguments"][key],
                                                 originals["sdr"]["absolute_arguments"][key])
        equality["watersheds_path"] = equal_watersheds(
            originals["ndr"]["absolute_arguments"]["watersheds_path"],
            originals["sdr"]["absolute_arguments"]["watersheds_path"])
    for model in active:
        info = originals[model]
        for role, (key, units) in INPUTS[model].items():
            name = "gura_" + model + "_" + role.lower()
            records.append(input_record(receiving, info, name, key, kind="raster", units=units))
            roles.setdefault(role, name)
        records.append(input_record(receiving, info, "gura_" + model + "_watershed",
                                    "watersheds_path", kind="vector"))
        records.append(input_record(receiving, info, "gura_" + model + "_biophysical",
                                    "biophysical_table_path", kind="table"))
        argument_path = Path(info["argument_path"])
        records.append({"id": "gura_" + model + "_original_arguments", "kind": "document",
                        "title": "Original Gura " + model.upper() + " argument file",
                        "path": argument_path.relative_to(receiving).as_posix(),
                        "sha256": sha(argument_path), "uri": info["archive"]["url"] + "#"
                        + info["archive"]["arguments"], "vintage": "InVEST 3.20.0 sample release",
                        "embedded_invest_version": info["embedded_version"]})
        for index, token in enumerate(info["readme_paths"]):
            path = Path(token)
            records.append({"id": "gura_" + model + "_readme_" + str(index), "kind": "document",
                            "title": "Original Gura " + model.upper() + " source README",
                            "path": path.relative_to(receiving).as_posix(), "sha256": sha(path),
                            "uri": info["archive"]["url"] + "#" + path.name,
                            "vintage": "Original release-provided source lineage"})
    table, derivation = joined_table(receiving, originals, active)
    provenance = table.with_suffix(".provenance.json")
    records.append({"id": "gura_joined_biophysical", "kind": "table",
                    "title": "Gura original " + "/".join(m.upper() for m in active) + " biophysical fields",
                    "path": table.relative_to(receiving).as_posix(), "sha256": sha(table),
                    "uri": "urn:upstate:derived:sha256:" + sha(provenance),
                    "vintage": "Derived from the official InVEST 3.20.0 sample source tables",
                    "companions": [{"path": provenance.relative_to(receiving).as_posix(),
                                    "sha256": sha(provenance)}],
                    "derivation": derivation})
    value = {"schema": "upstate.sources/v1", "title": "Original Gura 3.20.0 scientific inputs",
             "scope": SCOPE, "entries": records,
             "notes": ["Source archives and original embedded version labels are retained.",
                       "The original native watershed is used with zero added context buffer.",
                       "The 15 m source origin and cell centers are retained."]}
    path = receiving / ("gura-" + "-".join(active) + "-sources.json")
    if path.exists() and json.loads(path.read_text(encoding="utf-8")) != value:
        raise ValueError("Original receiving manifest changed")
    if not path.exists():
        atomic(path, value)
    return path, roles, "gura_" + primary + "_watershed", equality


def raster_summary(path, units):
    import numpy as np
    import rasterio
    total, count = 0.0, 0
    with rasterio.open(path) as src:
        t = src.transform
        if (not src.crs or not src.crs.is_projected
                or str(src.crs.linear_units).lower() not in ("metre", "meter", "metres", "meters")
                or t.b or t.d or t.a <= 0 or t.e >= 0):
            raise ValueError("Native export must have its actual projected metre grid")
        area = abs(t.a * t.e - t.b * t.d) / 10000
        for _, window in src.block_windows(1):
            data = src.read(1, window=window, masked=True)
            values = data.data.astype("float64")
            valid = ~np.ma.getmaskarray(data) & np.isfinite(values)
            total += float(values[valid].sum(dtype="float64"))
            count += int(valid.sum())
        return {"path": str(Path(path).resolve()), "units": units + "/ha",
                "annual_mass": total * area, "annual_mass_units": units,
                "native_valid_cells": count, "pixel_area_ha": area,
                "sum_native_rates": total, "crs": src.crs.to_string(),
                "transform": list(t)[:6], "width": src.width, "height": src.height,
                "area_conversion": "each original native raster rate multiplied once by actual hectares per cell"}


def retained_native_export(receiving, record, model, pollutant):
    """Resolve an original export inside the current received operation.

    Saved execution paths remain provenance. New exports retain their relative
    descriptor directly; earlier records map the original path relative to the
    recorded native selection root and then use the verified output inventory.
    """
    from model.common import verify_file

    if model not in OUTPUTS or pollutant not in {row[0] for row in OUTPUTS[model]}:
        raise ValueError("Select an original native model export")
    identity = record.get("selection_id")
    if (not isinstance(identity, str) or len(identity) != 64
            or any(character not in "0123456789abcdef" for character in identity)):
        raise ValueError("Original native selection identity is invalid")
    native = record.get("exports", {}).get(pollutant)
    if not isinstance(native, dict):
        raise ValueError("Original native export metadata is unavailable")
    prefix = PurePosixPath("native-original", model, identity)
    selected = native.get("artifact")
    if selected is None:
        original_path = native.get("path")
        original_root = record.get("workspace_dir")
        if not isinstance(original_path, str) or not isinstance(original_root, str):
            raise ValueError("Original native export has no retained source path")
        original_path, original_root = Path(original_path), Path(original_root)
        if not original_path.is_absolute() or not original_root.is_absolute():
            raise ValueError("Original native execution paths must be absolute")
        try:
            member = original_path.relative_to(original_root)
        except ValueError as error:
            raise ValueError("Original native export is outside its recorded selection") from error
        if not member.parts or ".." in member.parts:
            raise ValueError("Original native export has an invalid relative member")
        selected_path = (prefix / PurePosixPath(member.as_posix())).as_posix()
    elif isinstance(selected, dict):
        selected_path = selected.get("path")
    else:
        raise ValueError("Original native export descriptor is invalid")
    if not isinstance(selected_path, str):
        raise ValueError("Original native export needs its retained relative path")
    member = PurePosixPath(selected_path)
    if (member.is_absolute() or ".." in member.parts or "\\" in selected_path
            or "\0" in selected_path or member.as_posix() != selected_path
            or not member.is_relative_to(prefix) or member == prefix):
        raise ValueError("Original native export escapes its retained selection")
    matches = [item for item in record.get("outputs", [])
               if isinstance(item, dict) and item.get("path") == selected_path]
    if len(matches) != 1:
        raise ValueError("Original native export is not uniquely retained in its output inventory")
    item = matches[0]
    descriptor = {name: item.get(name) for name in ("path", "bytes", "sha256")}
    if selected is not None and any(selected.get(name) != descriptor[name]
                                    for name in descriptor):
        raise ValueError("Original native export descriptor differs from its retained inventory")
    size, checksum = descriptor["bytes"], descriptor["sha256"]
    if (isinstance(size, bool) or not isinstance(size, int) or size < 0
            or not isinstance(checksum, str) or len(checksum) != 64
            or any(character not in "0123456789abcdef" for character in checksum)):
        raise ValueError("Original native export inventory is incomplete")
    return verify_file(receiving, descriptor), descriptor


def original_native_identity(original, metadata):
    return hashlib.sha256(canonical({
        "archive_sha256": original["archive"]["sha256"],
        "runtime": native_cohort(metadata, original["model"]),
        "original_arguments": original["original_arguments"],
        "configuration": {"n_workers": -1,
                          "flow_dir_algorithm": str(original["original_arguments"]["flow_dir_algorithm"]).lower()},
    })).hexdigest()


def completed_native_reference(receiving, original, progress):
    """Verify an existing result without importing or executing the native engine."""
    from model.common import INVEST_SOURCE, verify_file
    model = original["model"]
    record = progress.get("native_original", {}).get(model, {})
    if record.get("state") != "complete":
        return None
    metadata = record.get("runtime", {})
    names = ("ndr", "sdr") if model == "ndr" else ("sdr",)
    if (metadata.get("version") != RELEASE or any(
            metadata.get("modules", {}).get(name, {}).get("git_blob") != INVEST_SOURCE[name + "_blob"]
            for name in names)):
        raise ValueError("The completed original result has another native source edition")
    key = original_native_identity(original, metadata)
    if record.get("selection_id") != key:
        return None
    prefix = PurePosixPath("native-original") / model / key
    seen = set()
    for descriptor in record.get("outputs", []):
        name = descriptor.get("path")
        path = PurePosixPath(name) if isinstance(name, str) else None
        if (path is None or path.is_absolute() or path.as_posix() != name
                or "\\" in name or "\0" in name or ".." in path.parts
                or path.parts[:3] != prefix.parts or len(path.parts) < 4
                or name in seen):
            raise ValueError("The completed native output inventory changed")
        seen.add(name)
        verify_file(receiving, descriptor)
    for pollutant, _, _ in OUTPUTS[model]:
        retained_native_export(receiving, record, model, pollutant)
    emit("native-original-reused", model=model, path=str(receiving / prefix),
         runtime=record["runtime"], execution="verified retained completed result")
    return record


def native_reference(receiving, original, module, metadata, progress, checkpoint):
    model = original["model"]
    cohort = native_cohort(metadata, model)
    identity = original_native_identity(original, metadata)
    root = receiving / "native-original" / model / identity
    root.mkdir(parents=True, exist_ok=True)
    args = dict(original["absolute_arguments"])
    args["workspace_dir"] = str(root)
    args["n_workers"] = -1
    # The release argument remains unchanged in provenance. InVEST 3.20
    # dispatches the normalized option identifiers mfd/d8.
    args["flow_dir_algorithm"] = str(args["flow_dir_algorithm"]).lower()
    old = progress.get("native_original", {}).get(model, {})
    if old.get("state") == "complete" and old.get("selection_id") == identity:
        if files_match(receiving, old["outputs"]):
            emit("native-original-reused", model=model, path=str(root))
            return old
        raise ValueError("Retained original native outputs changed")
    record = {"state": "running", "selection_id": identity, "started_at": now(),
              "workspace_dir": str(root), "arguments": args,
              "embedded_input_version": original["embedded_version"], "runtime": metadata,
              "runtime_cohort": cohort}
    progress.setdefault("native_original", {})[model] = record
    checkpoint()
    atomic(root / "received-original-arguments.json", {
        "release": RELEASE, "embedded_input_version": original["embedded_version"],
        "original": original["original_arguments"], "executed": args})
    emit("native-original-start", model=model, workspace=str(root))
    registry = module.execute(args)
    if not isinstance(registry, dict):
        raise ValueError("Native execution did not return its original output registry")
    suffix = str(args.get("results_suffix", ""))
    suffix = ("_" + suffix) if suffix else ""
    outputs, summaries = [], {}
    for pollutant, filename, units in OUTPUTS[model]:
        path = Path(registry.get(filename, root / (filename + suffix + ".tif")))
        if not path.is_file():
            raise ValueError("Native execution did not produce " + str(path))
        descriptor = artifact(path, receiving)
        summaries[pollutant] = {**raster_summary(path, units), "artifact": descriptor}
        outputs.append(descriptor)
    for path in sorted(root.glob("watershed_results*")):
        if path.is_file():
            outputs.append(artifact(path, receiving))
    record.update(state="complete", completed_at=now(), outputs=outputs, exports=summaries,
                  registry={str(k): str(v) for k, v in registry.items()
                            if isinstance(v, (str, Path))})
    checkpoint()
    emit("native-original-complete", model=model, exports={
        name: {"annual_mass": item["annual_mass"], "units": item["annual_mass_units"],
               "valid_cells": item["native_valid_cells"]} for name, item in summaries.items()})
    return record


def inspect_prepared_inputs(workspace, grid, roles):
    """Retain the original-cell mapping actually delivered to the native models."""
    import numpy as np
    import rasterio
    from rasterio.windows import Window
    from model.common import verify_file

    directory = workspace.root / "grids" / grid["id"]
    definition = grid["grid"]
    observed = {}
    for role, source_id in roles.items():
        if grid["spec"]["input_sources"].get(role) != source_id:
            raise ValueError("Prepared " + role + " does not select the received original source")
        source, entry = workspace.source_file(
            grid["spec"]["source_collection_id"], source_id)
        prepared = verify_file(directory, grid["files"][role])
        with rasterio.open(source) as original, rasterio.open(prepared) as target:
            a, b = original.transform, target.transform
            if (original.crs != target.crs or a.b or a.d or b.b or b.d
                    or not all(math.isfinite(value) for value in list(a)[:6] + list(b)[:6])
                    or a.a <= 0 or a.e >= 0 or b.a <= 0 or b.e >= 0
                    or original.count != 1 or target.count != 1
                    or not math.isclose(a.a, b.a, rel_tol=0, abs_tol=1e-8)
                    or not math.isclose(a.e, b.e, rel_tol=0, abs_tol=1e-8)):
                raise ValueError("Prepared " + role + " changed the original source lattice")
            col = (b.c - a.c) / a.a
            row = (b.f - a.f) / a.e
            if (not math.isclose(col, round(col), rel_tol=0, abs_tol=1e-7)
                    or not math.isclose(row, round(row), rel_tol=0, abs_tol=1e-7)):
                raise ValueError("Prepared " + role + " shifted the original source cell centers")
            if (target.crs != rasterio.crs.CRS.from_user_input(definition["crs"])
                    or target.width != definition["width"] or target.height != definition["height"]
                    or any(not math.isclose(x, y, rel_tol=0, abs_tol=1e-8)
                           for x, y in zip(list(b)[:6], definition["transform"][:6]))):
                raise ValueError("Prepared " + role + " differs from the retained grid definition")
            if (abs((b.a - a.a) / a.a) * max(original.width, target.width) > 1e-7
                    or abs((b.e - a.e) / a.e) * max(original.height, target.height) > 1e-7):
                raise ValueError("Prepared " + role + " accumulates a cell shift across the source extent")
            col, row = int(round(col)), int(round(row))
            valid_cells = 0
            for _, window in target.block_windows(1):
                expected = original.read(
                    1, window=Window(window.col_off + col, window.row_off + row,
                                     window.width, window.height),
                    boundless=True, masked=True)
                actual = target.read(1, window=window, masked=True)
                expected_valid = ~np.ma.getmaskarray(expected) & np.isfinite(expected.data)
                actual_valid = ~np.ma.getmaskarray(actual) & np.isfinite(actual.data)
                if not np.array_equal(expected_valid, actual_valid):
                    raise ValueError("Prepared " + role + " changed the original valid-cell mask")
                # The maintained aligner stores continuous inputs as float32
                # and land-cover codes as int32. Preserve that documented encoding.
                encoded = expected.data[expected_valid].astype(target.dtypes[0])
                if not np.array_equal(encoded, actual.data[actual_valid]):
                    raise ValueError("Prepared " + role + " changed source values beyond its output encoding")
                valid_cells += int(actual_valid.sum())
            if not valid_cells:
                raise ValueError("Prepared " + role + " has no original valid source cells")
            observed[role] = {
                "source_id": source_id, "source_sha256": entry["body"]["sha256"],
                "prepared_sha256": grid["files"][role]["sha256"],
                "source_transform": list(a)[:6], "prepared_transform": list(b)[:6],
                "source_dtype": original.dtypes[0], "prepared_dtype": target.dtypes[0],
                "source_window": {"column_offset": col, "row_offset": row,
                                  "width": target.width, "height": target.height},
                "valid_cells": valid_cells,
                "mapping": "integer source window; identical valid-cell mask",
                "value_comparison": "original values after the maintained output dtype conversion",
            }
    return observed


def workspace_baseline(workspace, receiving, originals, active, progress, checkpoint):
    from model.common import verify_file
    manifest, roles, watershed, equality = manifest_for(receiving, originals, active)
    collection = workspace.import_sources(manifest)
    references = [{"uri": originals[m]["archive"]["url"],
                   "archive_sha256": originals[m]["archive"]["sha256"],
                   "arguments_source_id": "gura_" + m + "_original_arguments",
                   "embedded_invest_version": originals[m]["embedded_version"]}
                  for m in active]
    profile_value = {"title": "Gura original " + "/".join(m.upper() for m in active) + " parameters",
                     "references": references, "source_collection_id": collection["id"],
                     "biophysical_source_id": "gura_joined_biophysical", "models": list(active)}
    for model in active:
        original = originals[model]["original_arguments"]
        parameters = {key: original[key] for key in ARGUMENT_KEYS[model]}
        parameters["flow_dir_algorithm"] = str(parameters["flow_dir_algorithm"]).lower()
        if model == "ndr" and original.get("runoff_proxy_av"):
            parameters["runoff_proxy_av"] = original["runoff_proxy_av"]
        profile_value[model] = parameters
    profile = workspace.save_profile(profile_value)
    scenario_value = {
        "title": "Gura original land cover",
        "reason": "Use the land-cover raster provided in the official InVEST 3.20.0 Gura sample archive.",
        "kind": "baseline", "source_collection_id": collection["id"], "patches": [],
        "geography": SCOPE["geography"], "source_release": RELEASE,
    }
    scenario = workspace.save_scenario(scenario_value)
    grid_value = {
        "title": "Gura original watershed on the supplied 15 m grid",
        "source_collection_id": collection["id"], "models": list(active),
        "input_sources": roles, "model_domain": {"source_id": watershed},
        "reporting_area": {"source_id": watershed}, "upstream_buffer_m": 0,
        "resolution_m": 15,
        "domain_reason": "Original release watershed; native engines intersect with its bounds and mask.",
    }
    plan_root = receiving / "selections" / ("-".join(active))
    plan_root.mkdir(parents=True, exist_ok=True)
    atomic(plan_root / "profile.json", profile_value)
    atomic(plan_root / "scenario.json", scenario_value)
    atomic(plan_root / "grid.json", grid_value)
    record = {"state": "preparing_grid", "source_collection_id": collection["id"],
              "profile_id": profile["id"], "scenario_id": scenario["id"],
              "source_manifest": str(manifest), "input_equivalence": equality,
              "models": list(active), "selection_files": str(plan_root)}
    progress["workspace_baseline"] = record
    checkpoint()
    emit("workspace-grid-start", workspace=str(workspace.root), selected_models=list(active))
    grid = workspace.prepare_grid(grid_value)
    retained = grid["grid"]
    if (not math.isclose(float(retained["resolution_m"]), 15, rel_tol=0, abs_tol=1e-8)
            or not math.isclose(float(retained["pixel_area_ha"]), 0.0225, rel_tol=0, abs_tol=1e-10)):
        raise ValueError("Prepared Gura grid did not preserve the original 15 m cells")
    record["prepared_source_cells"] = inspect_prepared_inputs(workspace, grid, roles)
    record["grid_id"] = grid["id"]
    checkpoint()
    selection = {"grid_id": grid["id"], "profile_id": profile["id"],
                 "scenario_id": scenario["id"], "models": list(active)}
    atomic(plan_root / "run.json", selection)
    run = workspace.prepare_run(selection)
    record.update(state=run["state"], grid_id=grid["id"], run_id=run["id"],
                  selection=run["selection"], grid=retained)
    checkpoint()
    if run.get("state") != "complete":
        emit("workspace-native-start", run_id=run["id"], selected_models=list(active))
        run = workspace.run(run["id"])
    if run.get("state") != "complete":
        raise ValueError("Original Workspace run returned state " + str(run.get("state")))
    run_root = workspace.root / "runs" / run["id"]
    for item in run.get("artifacts", {}).values():
        verify_file(run_root, item)
    record.update(state="complete", completed_at=now(), artifacts=run["artifacts"],
                  stages=run.get("stages", {}), run_manifest=str(run_root / "run.json"))
    checkpoint()
    emit("workspace-native-complete", run_id=run["id"], artifacts=run["artifacts"])
    return run


def comparison_setup(workspace, receiving, run, progress, model):
    """Describe the scientific settings actually executed by the compared stages."""
    from model.common import verify_file
    stage = run.get("stages", {}).get(model, {})
    descriptor = stage.get("arguments")
    executed = json.loads(verify_file(workspace.root / "runs" / run["id"], descriptor).read_text(
        encoding="utf-8")) if descriptor else None
    original = progress["native_original"][model].get("arguments", {})
    fields = list(ARGUMENT_KEYS[model])
    fields += ["calc_n", "calc_p", "runoff_proxy_av"] if model == "ndr" else ["drainage_path"]

    def parameter(name, value):
        if name == "flow_dir_algorithm":
            return str(value).lower() if value is not None else None
        if name == "runoff_proxy_av" and not value:
            return None
        if name == "drainage_path":
            return value or None
        if name in ("calc_n", "calc_p"):
            return value
        if value is None:
            return None
        number = float(value)
        if not math.isfinite(number):
            raise ValueError("A retained native comparison parameter is nonfinite: " + name)
        return number

    values = {
        name: {"reference": parameter(name, original.get(name)),
               "workspace": parameter(name, executed.get(name)) if executed is not None else None}
        for name in fields}
    matching = executed is not None and all(row["reference"] == row["workspace"]
                                             for row in values.values())
    grid = workspace.get_grid(run["selection"]["grid_id"])
    scenario = workspace._get("scenarios", run["selection"]["scenario_id"])
    baseline = progress.get("workspace_baseline") or {}
    original_selection = all(baseline.get(name) == run["selection"].get(name)
                             for name in ("grid_id", "profile_id", "scenario_id"))
    original_selection = original_selection and baseline.get("run_id") == run["id"]
    required = set(INPUTS[model])
    source_cells = baseline.get("prepared_source_cells", {})
    source_check = original_selection and required <= set(source_cells)
    same_reporting_domain = grid["spec"]["model_domain"] == grid["spec"]["reporting_area"]
    zero_buffer = float(grid["spec"]["upstream_buffer_m"]) == 0
    baseline_landcover = scenario.get("kind") == "baseline" and not scenario.get("patches")
    return {
        "profile_id": run["selection"]["profile_id"], "grid_id": grid["id"],
        "scenario_id": scenario["id"], "parameter_values": values,
        "parameters_match": matching, "workspace_stage_arguments": descriptor,
        "original_workspace_selection_matches": original_selection,
        "prepared_source_cells_recorded": source_check,
        "prepared_source_cells": {key: source_cells[key] for key in sorted(required & set(source_cells))},
        "model_domain": grid["spec"]["model_domain"],
        "reporting_area": grid["spec"]["reporting_area"],
        "upstream_buffer_m": grid["spec"]["upstream_buffer_m"],
        "same_reporting_and_routing_selection": same_reporting_domain,
        "original_zero_buffer": zero_buffer,
        "original_landcover_baseline": baseline_landcover,
        "original_setup_matches": all((matching, source_check, same_reporting_domain,
                                       zero_buffer, baseline_landcover)),
    }


def comparison_summary(workspace, receiving, run, progress):
    """Compare complete native support, with mass encoding separated from model differences."""
    import numpy as np
    import rasterio
    from rasterio.windows import Window
    from model.common import verify_file
    from model.raster_stats import raster_windows
    from model.rasters import MASS_UNITS, RATE_UNITS

    result = {}
    run_root = workspace.root / "runs" / run["id"]
    for model, original in progress.get("native_original", {}).items():
        if original.get("state") != "complete":
            continue
        setup = comparison_setup(workspace, receiving, run, progress, model)
        for pollutant, native in original["exports"].items():
            key = pollutant + "_export"
            item = run.get("artifacts", {}).get(key)
            if item is None:
                continue
            source, source_descriptor = retained_native_export(receiving, original, model, pollutant)
            output = verify_file(run_root, item)
            units = dict((name, units) for name, _, units in OUTPUTS[model])[pollutant]
            if native.get("annual_mass_units") != units or item.get("units") != MASS_UNITS[key]:
                raise ValueError("Native comparison requires the recorded annual mass units")
            with rasterio.open(source) as a, rasterio.open(output) as b:
                ta, tb = a.transform, b.transform
                if (a.count != 1 or b.count != 1 or not a.crs or a.crs != b.crs
                        or not a.crs.is_projected
                        or str(a.crs.linear_units).lower() not in ("metre", "meter", "metres", "meters")
                        or not all(math.isfinite(x) for x in list(ta)[:6] + list(tb)[:6])
                        or ta.b or ta.d or tb.b or tb.d or ta.a <= 0 or tb.a <= 0
                        or ta.e >= 0 or tb.e >= 0
                        or not math.isclose(ta.a, tb.a, rel_tol=0, abs_tol=1e-8)
                        or not math.isclose(ta.e, tb.e, rel_tol=0, abs_tol=1e-8)):
                    raise ValueError("Native/workspace exports require the same finite projected metre lattice")
                if b.dtypes[0] not in ("float32", "float64"):
                    raise ValueError("Workspace annual mass must retain its floating-point encoding")
                if (b.tags().get("units") != MASS_UNITS[key]
                        or b.tags().get("native_units") != RATE_UNITS[key]):
                    raise ValueError("Workspace raster unit tags differ from its annual mass conversion")
                dx, dy = (tb.c - ta.c) / ta.a, (tb.f - ta.f) / ta.e
                if (not math.isclose(dx, round(dx), rel_tol=0, abs_tol=1e-7)
                        or not math.isclose(dy, round(dy), rel_tol=0, abs_tol=1e-7)
                        or abs((tb.a - ta.a) / ta.a) * max(a.width, b.width) > 1e-7
                        or abs((tb.e - ta.e) / ta.e) * max(a.height, b.height) > 1e-7):
                    raise ValueError("Native/workspace export cell centers differ across their extents")
                dx, dy = int(round(dx)), int(round(dy))
                factor = abs(ta.a * ta.e - ta.b * ta.d) / 10000
                if (not math.isfinite(factor) or factor <= 0
                        or not math.isclose(float(item["pixel_area_ha"]), factor,
                                            rel_tol=0, abs_tol=1e-12)):
                    raise ValueError("Workspace mass conversion uses another native cell area")

                # Inspect the entire original raster, including cells outside
                # the Workspace extent that a paired-window scan cannot see.
                native_valid_count = outside_count = 0
                native_full_mass = outside_mass = 0.0
                for window in raster_windows(a):
                    data = a.read(1, window=window, masked=True)
                    mass = data.data.astype("float64") * factor
                    valid = ~np.ma.getmaskarray(data) & np.isfinite(mass)
                    rows = np.arange(int(window.row_off), int(window.row_off + window.height))
                    cols = np.arange(int(window.col_off), int(window.col_off + window.width))
                    inside = ((rows >= dy) & (rows < dy + b.height))[:, None] & (
                              (cols >= dx) & (cols < dx + b.width))[None, :]
                    outside = valid & ~inside
                    native_valid_count += int(valid.sum())
                    outside_count += int(outside.sum())
                    native_full_mass += float(mass[valid].sum(dtype="float64"))
                    outside_mass += float(mass[outside].sum(dtype="float64"))

                count = native_only = workspace_only = encoded_different = 0
                total_abs = squared = max_abs = reference_total = workspace_total = 0.0
                encoded_total = encoded_abs = encoded_squared = encoded_max = rounding_max = 0.0
                native_only_mass = workspace_only_mass = 0.0
                support = hashlib.sha256(canonical({
                    "schema": "upstate.gura-common-support/v1", "crs": b.crs.to_wkt(),
                    "transform": list(tb)[:6], "width": b.width, "height": b.height,
                    "windows": 512, "mask_encoding": "numpy.packbits C-order, big bit order",
                }))
                for window in raster_windows(b):
                    x = a.read(1, window=Window(window.col_off + dx, window.row_off + dy,
                               window.width, window.height), boundless=True, masked=True)
                    y = b.read(1, window=window, masked=True)
                    xv, yv = x.data.astype("float64") * factor, y.data.astype("float64")
                    valid_x = ~np.ma.getmaskarray(x) & np.isfinite(xv)
                    valid_y = ~np.ma.getmaskarray(y) & np.isfinite(yv)
                    common = valid_x & valid_y
                    only_x, only_y = valid_x & ~valid_y, valid_y & ~valid_x
                    native_only += int(only_x.sum())
                    workspace_only += int(only_y.sum())
                    native_only_mass += float(xv[only_x].sum(dtype="float64"))
                    workspace_only_mass += float(yv[only_y].sum(dtype="float64"))
                    support.update(canonical([int(window.col_off), int(window.row_off),
                                              int(window.width), int(window.height)]))
                    support.update(np.packbits(common, bitorder="big").tobytes())
                    reference, actual = xv[common], yv[common]
                    encoded = reference.astype(b.dtypes[0]).astype("float64")
                    if np.any(~np.isfinite(encoded)):
                        raise ValueError("Original annual mass exceeds the Workspace encoding range")
                    delta, encoded_delta = actual - reference, actual - encoded
                    count += int(common.sum())
                    if delta.size:
                        total_abs += float(np.abs(delta).sum(dtype="float64"))
                        squared += float(np.square(delta).sum(dtype="float64"))
                        max_abs = max(max_abs, float(np.max(np.abs(delta))))
                        encoded_abs += float(np.abs(encoded_delta).sum(dtype="float64"))
                        encoded_squared += float(np.square(encoded_delta).sum(dtype="float64"))
                        encoded_max = max(encoded_max, float(np.max(np.abs(encoded_delta))))
                        rounding_max = max(rounding_max, float(np.max(np.abs(encoded - reference))))
                        encoded_different += int(np.count_nonzero(encoded_delta))
                    reference_total += float(reference.sum(dtype="float64"))
                    workspace_total += float(actual.sum(dtype="float64"))
                    encoded_total += float(encoded.sum(dtype="float64"))
                if native_valid_count != count + native_only + outside_count:
                    raise ValueError("Native comparison support did not partition its original raster")
                stage_runtime = run.get("stages", {}).get(model, {}).get("runtime", run.get("runtime"))
                reference_cohort = native_cohort(original["runtime"], model)
                application_cohort = native_cohort(stage_runtime, model) if stage_runtime else None
                same_runtime = reference_cohort == application_cohort
                same_support = bool(count) and not (native_only or workspace_only or outside_count)
                same_values = bool(count) and encoded_different == 0
                reasons = []
                if not count:
                    reasons.append("no common valid cells")
                if not same_support:
                    reasons.append("different complete valid-cell support")
                if not same_runtime:
                    reasons.append("different native runtime cohorts")
                if not setup["original_setup_matches"]:
                    reasons.append("different or unavailable original scientific setup")
                if count and not same_values:
                    reasons.append("cell values differ after the retained mass encoding")
                result[pollutant] = {
                    "units": units, "common_cells": count,
                    "native_reference_selection_id": original["selection_id"],
                    "native_reference_artifact": source_descriptor,
                    "native_reference_artifact_root": "gura-receiving",
                    "workspace_run_id": run["id"], "workspace_artifact": item,
                    "runtime_cohort_matches": same_runtime,
                    "native_reference_runtime": reference_cohort,
                    "workspace_stage_runtime": application_cohort,
                    "scientific_setup": setup,
                    "native_only_cells_within_workspace_extent": native_only,
                    "native_only_cells_outside_workspace_extent": outside_count,
                    "workspace_only_cells": workspace_only,
                    "native_valid_cells_full_extent": native_valid_count,
                    "workspace_valid_cells_full_extent": count + workspace_only,
                    "same_complete_valid_support": same_support,
                    "common_support_sha256": support.hexdigest(),
                    "native_mass_full_extent": native_full_mass,
                    "workspace_mass_full_extent": workspace_total + workspace_only_mass,
                    "native_mass_outside_workspace_extent": outside_mass,
                    "native_only_mass_within_workspace_extent": native_only_mass,
                    "workspace_only_mass": workspace_only_mass,
                    "native_mass_common_cells": reference_total,
                    "workspace_mass_common_cells": workspace_total,
                    "workspace_minus_native_mass_common_cells": workspace_total - reference_total,
                    "maximum_absolute_cell_difference": max_abs if count else None,
                    "mean_absolute_cell_difference": total_abs / count if count else None,
                    "root_mean_square_cell_difference": math.sqrt(squared / count) if count else None,
                    "workspace_mass_encoding": b.dtypes[0],
                    "pixel_area_ha": factor,
                    "native_mass_after_workspace_encoding_common_cells": encoded_total,
                    "workspace_minus_encoded_native_mass_common_cells": workspace_total - encoded_total,
                    "different_cells_after_mass_encoding": encoded_different,
                    "maximum_absolute_difference_after_mass_encoding": encoded_max if count else None,
                    "mean_absolute_difference_after_mass_encoding": encoded_abs / count if count else None,
                    "root_mean_square_difference_after_mass_encoding":
                        math.sqrt(encoded_squared / count) if count else None,
                    "maximum_reference_mass_encoding_roundoff": rounding_max if count else None,
                    "agreement": "equal after retained mass encoding" if not reasons else "differences recorded",
                    "agreement_reasons": reasons,
                    "comparison": "original per-hectare exports converted once versus retained per-cell annual mass",
                    "encoding_comparison": "The reference annual mass is additionally encoded with the actual Workspace dtype; exact cell differences then separate model changes from that known storage rounding.",
                }
    return result


def archive_completed_workspace(workspace, receiving, run, progress, destination):
    """Reuse a complete original archive after a lost final receiving checkpoint."""
    from model.common import describe_file, identifier
    from model.model_selection import run_models
    from model.portable import _archive_identity, _archive_digest, _inspect_archive

    destination = Path(destination).resolve()
    if destination.is_relative_to(workspace.root.resolve()):
        raise ValueError("Save the Workspace archive outside its own source tree")
    if not destination.exists():
        return workspace.backup(destination, include_intermediates=False)
    selection = run["selection"]
    key = identifier(run["id"])
    if run.get("state") != "complete":
        raise ValueError("Archive reuse requires the original completed Workspace run")
    grid = workspace.get_grid(selection["grid_id"])
    profile = workspace._get("profiles", selection["profile_id"])
    scenario = workspace._get("scenarios", selection["scenario_id"])
    collection_ids = {grid["spec"]["source_collection_id"],
                      profile["source_collection_id"], scenario["source_collection_id"]}
    with destination.open("rb") as source:
        before = _archive_identity(source)
        with zipfile.ZipFile(source) as archive:
            manifest = _inspect_archive(archive, verify=True)
            if (manifest["project"] != workspace.project or
                    manifest["selection"] != {"include_intermediates": False,
                                               "include_deliveries": True}):
                raise ValueError("Existing archive belongs to another Workspace or backup selection")
            members = manifest["members"]

            def same_member(name, expected):
                captured = members.get(name, {})
                if any(captured.get(field) != expected[field] for field in ("bytes", "sha256")):
                    raise ValueError("Existing archive differs from the selected original member: " + name)

            def same_record(relative):
                path = workspace.root / relative
                same_member("workspace/" + relative, describe_file(workspace.root, path))

            same_record("runs/" + key + "/run.json")
            same_record("grids/" + grid["id"] + "/grid.json")
            for kind, identity in (("profiles", profile["id"]), ("scenarios", scenario["id"])):
                same_record(kind + "/" + identity + ".json")
            for collection_id in collection_ids:
                collection_id = identifier(collection_id)
                collection = workspace._get("sources", collection_id)
                same_record("sources/" + collection_id + ".json")
                original_members = [collection["original_manifest"]]
                for entry in collection["entries"]:
                    original_members.extend([entry["body"], *entry.get("companions", [])])
                for member in original_members:
                    same_member("workspace/" + member["object"], member)
            for item in grid["files"].values():
                same_member("workspace/grids/" + grid["id"] + "/" + item["path"], item)
            for item in run["artifacts"].values():
                same_member("workspace/runs/" + key + "/" + item["path"], item)

            state_name = "workspace/gura-receiving/gura-receiving-state.json"
            if state_name not in members:
                raise ValueError("Existing archive lacks the original Gura receiving state")
            saved = json.loads(archive.read(state_name))
            if (saved.get("schema") != "upstate.gura-receiving/v1" or
                    saved.get("workspace_id") != workspace.project["id"] or
                    saved.get("workspace_baseline", {}).get("run_id") != key):
                raise ValueError("Existing archive records another Gura receiving selection")
            for model in run_models(run):
                original = progress["original_sources"][model]
                archived_original = saved.get("original_sources", {}).get(model, {})
                if (archived_original.get("archive") != original["archive"] or
                        archived_original.get("source_files") != original["source_files"]):
                    raise ValueError("Existing archive changes the original " + model.upper() + " source edition")
                for item in original["source_files"]:
                    same_member("workspace/gura-receiving/" + item["path"], item)
                native = progress.get("native_original", {}).get(model)
                if native and native.get("state") == "complete":
                    archived_native = saved.get("native_original", {}).get(model, {})
                    if (archived_native.get("state") != "complete" or
                            archived_native.get("selection_id") != native["selection_id"] or
                            archived_native.get("outputs") != native["outputs"]):
                        raise ValueError("Existing archive changes the completed original " + model.upper() + " run")
                    for item in native["outputs"]:
                        same_member("workspace/gura-receiving/" + item["path"], item)
            application = {
                name[len("application/"):]: {field: value[field] for field in ("bytes", "sha256")}
                for name, value in members.items() if name.startswith("application/")}
            required = {"model/common.py", "model/workspace.py", "model/native.py",
                        "model/rasters.py", "model/profiles.py", "model/portable.py",
                        "model/cli.py", "source_tools/receive_gura_native.py"}
            if not required.issubset(application):
                raise ValueError("Existing archive lacks the original native receiving application")
            application_sha256 = hashlib.sha256(canonical(application)).hexdigest()
        checksum = _archive_digest(source, before)
        current = destination.stat()
        if (current.st_dev, current.st_ino, current.st_size,
                current.st_mtime_ns, current.st_ctime_ns) != before:
            raise ValueError("Existing archive changed during original receiving verification")
    retained = progress.get("backup", {})
    if retained.get("path") == str(destination) and any(
            retained.get(field) != value for field, value in
            (("bytes", before[2]), ("sha256", checksum))):
        raise ValueError("Existing archive differs from its completed receiving receipt")
    result = {"schema": manifest["schema"], "project_id": workspace.project["id"],
              "path": str(destination), "bytes": before[2], "sha256": checksum,
              "members": len(members), "selection": manifest["selection"],
              "database_snapshots": manifest.get("database_snapshots", {}),
              "source_acquisitions": manifest.get("source_acquisitions", {}),
              "implementation": manifest.get("implementation", {}),
              "run_id": key, "application_sha256": application_sha256,
              "application_members": len(application), "reused_completed_archive": True}
    emit("workspace-archive-reused", path=str(destination), sha256=checksum,
         run_id=key, application_sha256=application_sha256)
    return result


def parser():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--application", type=Path, required=True)
    p.add_argument("--workspace", type=Path, required=True)
    p.add_argument("--inputs", type=Path,
                   help="Official NDR.zip/SDR.zip directory for first intake; omit to reopen verified retained originals")
    p.add_argument("--models", nargs="+", choices=("ndr", "sdr"), default=["ndr", "sdr"])
    p.add_argument("--mode", choices=("native", "workspace", "both"), default="both")
    p.add_argument("--archive", type=Path,
                   help="Optional complete Workspace backup destination after a completed application run")
    return p


def main(argv=None):
    args = parser().parse_args(argv)
    active = tuple(m for m in ("ndr", "sdr") if m in set(args.models))
    application = args.application.resolve(strict=True)
    if not (application / "model" / "native.py").is_file():
        raise ValueError("--application must select the retained complete application directory")
    sys.path.insert(0, str(application))
    os.environ.setdefault("OMP_NUM_THREADS", "1")
    os.environ.setdefault("OPENBLAS_NUM_THREADS", "1")
    os.environ.setdefault("MKL_NUM_THREADS", "1")
    os.environ.setdefault("GDAL_CACHEMAX", "64")
    from model.common import held
    from model.workspace import Workspace
    root = args.workspace.resolve()
    root.mkdir(parents=True, exist_ok=True)
    receiving = root / "gura-receiving"
    receiving.mkdir(parents=True, exist_ok=True)
    state_path = receiving / "gura-receiving-state.json"
    with held(receiving / ".driver.lock", blocking=False):
        state = json.loads(state_path.read_text(encoding="utf-8")) if state_path.exists() else {
            "schema": "upstate.gura-receiving/v1", "created_at": now(),
            "scope": SCOPE, "workspace_path": str(root), "native_original": {},
        }
        def checkpoint():
            state["updated_at"] = now()
            atomic(state_path, state)
        logging.basicConfig(level=logging.INFO,
                            format="%(asctime)s %(levelname)s %(name)s: %(message)s",
                            handlers=[logging.FileHandler(receiving / "native-operation.log",
                                                          encoding="utf-8"),
                                      logging.StreamHandler(sys.stderr)])
        try:
            state["python"] = {"executable": sys.executable, "version": sys.version}
            state["request"] = {"mode": args.mode, "models": list(active),
                                "application": str(application),
                                "inputs": str(args.inputs.resolve()) if args.inputs else None}
            state.pop("error", None)
            checkpoint()
            originals = {
                model: (unpack_original(args.inputs, receiving, model) if args.inputs is not None
                        else restored_original(receiving, model,
                                               state.get("original_sources", {}).get(model)))
                for model in active}
            state["original_sources"] = {**state.get("original_sources", {}), **originals}
            checkpoint()
            workspace = Workspace(root, create=True, title="Gura, Kenya — original InVEST 3.20.0 study")
            state["workspace_id"] = workspace.project["id"]
            checkpoint()
            if args.mode in ("native", "both"):
                pending = [model for model in active
                           if completed_native_reference(receiving, originals[model], state) is None]
                if pending:
                    for model in pending:
                        for _, (key, _) in INPUTS[model].items():
                            raster_identity(originals[model]["absolute_arguments"][key])
                    from model.native import runtime
                    modules, metadata = runtime(pending)
                    if metadata["version"] != RELEASE:
                        raise ValueError("The supplied native runtime must be InVEST 3.20.0")
                    state["runtime"] = metadata
                    checkpoint()
                    emit("native-runtime-ready", python=sys.executable, runtime=metadata)
                    for model in pending:
                        native_reference(receiving, originals[model], modules[model], metadata, state, checkpoint)
            run = None
            if args.mode in ("workspace", "both"):
                for model in active:
                    for _, (key, _) in INPUTS[model].items():
                        raster_identity(originals[model]["absolute_arguments"][key])
                run = workspace_baseline(workspace, receiving, originals, active, state, checkpoint)
                comparisons = comparison_summary(workspace, receiving, run, state)
                if comparisons:
                    state["native_workspace_comparison"] = comparisons
                    atomic(receiving / "native-workspace-comparison.json", comparisons)
                    emit("native-workspace-comparison", comparisons=comparisons)
                if args.archive:
                    state["backup"] = archive_completed_workspace(
                        workspace, receiving, run, state, args.archive)
            state["state"] = "complete"
            state["completed_at"] = now()
            checkpoint()
            emit("gura-receiving-complete", state_path=str(state_path),
                 workspace=str(root), run_id=run["id"] if run else None)
            return 0
        except Exception as error:
            state["state"] = "error"
            state["error"] = {"type": type(error).__name__, "message": str(error),
                              "at": now(), "traceback": traceback.format_exc()}
            checkpoint()
            logging.exception("Gura receiving operation stopped at its actual failing stage")
            emit("gura-receiving-error", state_path=str(state_path), error=state["error"]["message"])
            return 1


if __name__ == "__main__":
    raise SystemExit(main())
