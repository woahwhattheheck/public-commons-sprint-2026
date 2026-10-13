"""Prepare retained PRISM/NOAA inputs on one explicit regional model grid.

Uses the maintained native raster aligner and original source-entry contracts.
Completed roles are reusable when another model's inputs arrive later.
"""
from __future__ import annotations

import argparse
import copy
import json
import math
import os
from pathlib import Path
import shutil

from model.common import (
    atomic_json, describe_file, digest, file_digest, held, now, read_json,
    relative_file, verify_file,
)
from model.rasters import align_source

SCHEMA = "upstate.regional-climate/v1"
UNITS = {
    "PRECIPITATION": "mm/year",
    "R_FACTOR": "MJ*mm/(ha*h*year)",
}


def _within(root, path):
    path = Path(path).resolve(strict=True)
    if not path.is_relative_to(root):
        raise ValueError(
            "Select one project root above the original inputs, grid and regional outputs: "
            + str(path)
        )
    return path


def load_grid(path):
    """Accept the exact common grid or an existing completed grid record."""
    from pyproj import CRS

    supplied = read_json(path)
    grid = supplied.get("grid", supplied)
    if not isinstance(grid, dict):
        raise ValueError("Select an explicit regional grid definition")
    crs = CRS.from_user_input(grid["crs"])
    if not crs.is_projected or any(
        abs(axis.unit_conversion_factor - 1) > 1e-12 for axis in crs.axis_info[:2]
    ):
        raise ValueError("The regional model grid must use projected metres")
    affine = grid["transform"]
    if len(affine) != 6 or not all(math.isfinite(float(x)) for x in affine):
        raise ValueError("Grid transform must contain six finite affine coefficients")
    a, b, left, d, e, top = (float(x) for x in affine)
    if (not math.isclose(a, 30.0, rel_tol=0, abs_tol=1e-9)
            or not math.isclose(e, -30.0, rel_tol=0, abs_tol=1e-9)
            or abs(b) > 1e-12 or abs(d) > 1e-12):
        raise ValueError("Use the selected north-up, exact 30-metre model grid")
    for field in ("width", "height"):
        if type(grid[field]) is not int or grid[field] <= 0:
            raise ValueError("Grid dimensions must be positive integers")
    bounds = [left, top + e * grid["height"], left + a * grid["width"], top]
    if "bounds" in grid and (
        len(grid["bounds"]) != 4
        or any(not math.isclose(float(x), y, rel_tol=0, abs_tol=1e-6)
               for x, y in zip(grid["bounds"], bounds))
    ):
        raise ValueError("Grid bounds and affine/dimensions disagree")
    if grid.get("grid_sha256"):
        original = {k: v for k, v in grid.items() if k != "grid_sha256"}
        if digest(original) != grid["grid_sha256"]:
            raise ValueError("The selected grid changed after its recorded definition")
    # The exact geometry, not an input pathname, identifies the prepared pixels.
    geometry = {
        "crs": crs.to_wkt(), "transform": [a, b, left, d, e, top],
        "width": grid["width"], "height": grid["height"], "bounds": bounds,
    }
    return geometry, digest(geometry)


def _source_entry(root, path, role):
    path = _within(root, path)
    entry = read_json(path)
    if entry.get("kind") != "raster" or entry.get("role") != role:
        raise ValueError("Select a prepared original " + role + " source-entry.json")
    if not all(entry.get(key) for key in ("id", "title", "uri", "vintage")):
        raise ValueError("Keep the original source ID, title, URI and vintage")
    source = verify_file(path.parent, entry)
    _within(root, source)
    companions = []
    for item in entry.get("companions", []):
        companion = verify_file(path.parent, item)
        _within(root, companion)
        companions.append((companion, item))
    conversion = entry.get("conversion")
    if conversion:
        factor = float(conversion["factor"])
        if (not math.isfinite(factor) or factor <= 0
                or not conversion.get("reference")
                or conversion.get("target_units") != UNITS[role]):
            raise ValueError("Keep an explicit, referenced " + role + " unit conversion")
        units = conversion["target_units"]
    else:
        units = entry.get("units")
    if units != UNITS[role]:
        raise ValueError(role + " requires declared " + UNITS[role] + " units")
    if entry.get("resampling", "bilinear") not in ("bilinear", "average", "nearest"):
        raise ValueError("Select a continuous-field resampling method")
    return path, entry, source, companions


def _native_metadata(path):
    import rasterio

    with rasterio.open(path) as src:
        if src.count != 1 or not src.crs:
            raise ValueError("Select a georeferenced single-band original climate input")
        return {
            "crs": src.crs.to_wkt(), "transform": list(src.transform)[:6],
            "width": src.width, "height": src.height,
            "resolution": list(src.res), "dtype": src.dtypes[0],
            "nodata": src.nodata if src.nodata is None or math.isfinite(src.nodata) else None,
            "band_scale": src.scales[0], "band_offset": src.offsets[0],
        }


def _retain_descriptions(root, paths):
    result, seen = [], set()
    for path, metadata in paths:
        actual = describe_file(root, path)
        if actual["path"] in seen:
            continue
        seen.add(actual["path"])
        result.append({**metadata, **actual})
    return result


def prepare_role(root, *, grid_path, grid, grid_id, entry_path, role,
                 directory, resampling=None):
    """Return one ordinary source entry; only its unfinished raster is computed."""
    root = Path(root).resolve(strict=True)
    original_path, original, source, companions = _source_entry(root, entry_path, role)
    grid_path = _within(root, grid_path)
    native = _native_metadata(source)
    method = resampling or original.get("resampling", "bilinear")
    if method not in ("bilinear", "average", "nearest"):
        raise ValueError("Select bilinear, average or nearest continuous-field resampling")
    # GDAL raster reads expose stored values. Conversion from the original source
    # entry already includes its band scale; never apply that scale a second time.
    if native["band_offset"] != 0:
        raise ValueError("This original source needs an explicit additive-offset preparation")
    if native["band_scale"] != 1 and not original.get("conversion"):
        raise ValueError("Keep the original band-scale conversion in the source entry")
    contract = {
        "schema": SCHEMA, "role": role, "grid_id": grid_id,
        "source_entry_sha256": file_digest(original_path),
        "grid_file_sha256": file_digest(grid_path),
        "source_sha256": original["sha256"],
        "conversion": original.get("conversion"), "units": UNITS[role],
        "resampling": method,
    }
    key = digest(contract)
    output_dir = root / directory / role.lower() / key
    if not output_dir.resolve().is_relative_to(root):
        raise ValueError("Regional output directory must stay within the selected project")
    output_dir.mkdir(parents=True, exist_ok=True)
    state_path = output_dir / "preparation.json"
    raster_path = output_dir / (role.lower() + ".tif")
    pending = output_dir / (role.lower() + ".partial.tif")
    checkpoint_directory = output_dir / ".alignment"
    with held(output_dir / ".prepare.lock", blocking=False):
        if state_path.exists():
            state = read_json(state_path)
            if state.get("contract") != contract:
                raise ValueError("The retained climate preparation belongs to another selection")
            if state.get("state") == "complete":
                verify_file(root, state["entry"])
                for item in state["entry"]["companions"]:
                    verify_file(root, item)
                shutil.rmtree(checkpoint_directory, ignore_errors=True)
                return state["entry"]
        state = {
            "schema": SCHEMA, "id": key, "contract": contract,
            "state": "preparing", "started_at": now(),
        }
        atomic_json(state_path, state)
        try:
            # A crash may leave only this exact operation's incomplete file. The
            # maintained aligner writes bounded native windows, not full arrays.
            pending.unlink(missing_ok=True)
            stats = align_source(
                source, pending, grid, resampling=method,
                conversion=original.get("conversion"),
                checkpoint_directory=checkpoint_directory,
                source_identity={"source_entry_sha256": contract["source_entry_sha256"],
                                 "source_entry": original},
            )
            # Reuse counters belong to mutable progress; the scientific derivation
            # stays identical when an interrupted role resumes from retained tiles.
            alignment = stats.pop("preparation", None)
            if alignment is not None:
                state["alignment"] = alignment
                atomic_json(state_path, state)
            if not stats["valid_cells"]:
                raise ValueError(role + " has no valid pixels on the selected regional grid")
            if stats["minimum"] is not None and stats["minimum"] < 0:
                raise ValueError(role + " contains negative physical values")
            verify_file(original_path.parent, original)
            if (file_digest(original_path) != contract["source_entry_sha256"]
                    or file_digest(grid_path) != contract["grid_file_sha256"]):
                raise ValueError("The selected source/grid definition changed during alignment")
            for _, companion in companions:
                verify_file(original_path.parent, companion)
            os.replace(pending, raster_path)
            contract_path = output_dir / "derivation.json"
            derivation = {
                **contract, "source_id": original["id"], "source_uri": original["uri"],
                "source_vintage": original["vintage"],
                "native_grid": native, "model_grid": grid,
                "source_resolution": original.get("source_resolution"),
                "statistics": stats,
                "unit_conversion_application": "Applied once by model.rasters.align_source",
                "spatial_meaning": (
                    "The 30-metre working grid retains the resolution and lineage of the "
                    "coarser original field; interpolation does not add observed spatial detail."
                ),
            }
            atomic_json(contract_path, derivation, immutable=True)
            paths = [
                (source, {"role": "ORIGINAL_NUMERIC_SOURCE"}),
                (original_path, {"role": "ORIGINAL_SOURCE_ENTRY"}),
                (grid_path, {"role": "SELECTED_MODEL_GRID"}),
                (contract_path, {"role": "REGIONAL_DERIVATION"}),
            ] + companions
            entry = {
                "id": original["id"] + "-regional-" + key[:20],
                "title": original["title"] + " on the selected regional 30-metre grid",
                "kind": "raster", "role": role, "uri": original["uri"],
                "vintage": original["vintage"], "units": UNITS[role],
                "resampling": method, **describe_file(root, raster_path),
                "companions": _retain_descriptions(root, paths),
                "native_grid": native,
                "model_grid": grid, "regional_grid_id": grid_id,
                "source_resolution": original.get("source_resolution"),
                "derived_from": {
                    "source_id": original["id"], "source_sha256": original["sha256"],
                    "source_entry_sha256": contract["source_entry_sha256"],
                    "native_units": original.get("units"),
                    "applied_conversion": copy.deepcopy(original.get("conversion")),
                },
                "regional_preparation_id": key,
                "citation": original.get("citation"),
                "statistics": stats,
                "use": original.get("use", "Rainfall erosivity input for the original SDR model"),
            }
            # Deliberately no top-level conversion: these stored pixels already
            # have their target units and Workspace must not multiply them again.
            state.update(state="complete", completed_at=now(), entry=entry)
            atomic_json(state_path, state)
            shutil.rmtree(checkpoint_directory, ignore_errors=True)
            return entry
        except Exception as error:
            state.update(state="interrupted", interrupted_at=now(),
                         error={"type": type(error).__name__, "message": str(error)})
            atomic_json(state_path, state)
            raise


def prepare(project_root, *, grid_path, entries, directory="regional-climate",
            resampling=None):
    """Prepare any selected climate roles and emit a source-composer input."""
    root = Path(project_root).resolve(strict=True)
    relative = Path(directory)
    if relative.is_absolute() or not relative.parts or ".." in relative.parts:
        raise ValueError("Use a relative regional-climate output directory")
    if not entries or any(role not in UNITS for role in entries):
        raise ValueError("Select PRECIPITATION and/or R_FACTOR prepared entries")
    grid_path = _within(root, grid_path)
    grid, grid_id = load_grid(grid_path)
    prepared = []
    for role in UNITS:
        if role not in entries:
            continue
        prepared.append(prepare_role(
            root, grid_path=grid_path, grid=grid, grid_id=grid_id,
            entry_path=entries[role], role=role, directory=relative,
            resampling=resampling,
        ))
    identity = digest({"grid_id": grid_id,
                       "sources": [row["regional_preparation_id"] for row in prepared]})
    manifest_path = root / ("regional-climate-" + identity + ".json")
    manifest = {
        "schema": "upstate.sources/v1",
        "title": "Regional precipitation and rainfall erosivity inputs",
        "entries": prepared,
        "scope": {"regional_grid_id": grid_id, "grid": grid,
                  "selected_roles": [entry["role"] for entry in prepared]},
        "notes": [
            "Original raster bodies, metadata, capture records and archive companions remain "
            "under this same project root and are referenced without another large copy.",
            "Physical-unit conversion has already been applied exactly once to the regional "
            "raster. Original source resolution remains attached to each input.",
        ],
    }
    atomic_json(manifest_path, manifest, immutable=True)
    return {
        "schema": SCHEMA, "state": "complete",
        "manifest": str(manifest_path), "manifest_sha256": file_digest(manifest_path),
        "regional_grid_id": grid_id,
        "inputs": {row["role"]: {
            "source_id": row["id"], "path": str(root / row["path"]),
            "sha256": row["sha256"], "units": row["units"],
            "statistics": row["statistics"],
        } for row in prepared},
    }


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--project-root", required=True)
    parser.add_argument("--grid", required=True, help="Retained shared regional-grid JSON")
    parser.add_argument("--precipitation-entry", help="Original prepared PRISM source-entry.json")
    parser.add_argument("--erosivity-entry", help="Original prepared NOAA source-entry.json")
    parser.add_argument("--directory", default="regional-climate")
    parser.add_argument("--resampling", choices=("bilinear", "average", "nearest"))
    args = parser.parse_args(argv)
    entries = {}
    if args.precipitation_entry:
        entries["PRECIPITATION"] = args.precipitation_entry
    if args.erosivity_entry:
        entries["R_FACTOR"] = args.erosivity_entry
    result = prepare(args.project_root, grid_path=args.grid, entries=entries,
                     directory=args.directory, resampling=args.resampling)
    print(json.dumps(result, sort_keys=True, indent=2))


if __name__ == "__main__":
    main()
