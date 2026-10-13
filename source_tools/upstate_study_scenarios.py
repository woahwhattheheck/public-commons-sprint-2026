"""Prepare published Upstate land-cover alternatives with native InVEST tools.

Copyright TokenJunkieLabs. Outputs are retained, aligned binary masks consumed by
the ordinary Workspace scenario engine and its existing native experiment runner.
"""
from __future__ import annotations

import argparse
from collections import Counter
from contextlib import ExitStack
from fractions import Fraction
import importlib.metadata
import inspect
import json
import math
from pathlib import Path
import sys

FOREST_CODES = (41, 42, 43)
DIRECTIONS = ("nearest_to_edge", "farthest_from_edge")
PAPER = "https://link.springer.com/article/10.1007/s00267-023-01861-6"
NATIVE_SOURCE = (
    "https://github.com/natcap/invest/blob/3.20.0/src/natcap/invest/"
    "scenario_gen_proximity/scenario_gen_proximity.py"
)
SCHEMA = "upstate.published-spatial-programme/v1"
MASK_NODATA = 255


def _windows(dataset, height=128):
    """Whole-width stripes preserve row-major ordering with a small working set."""
    from rasterio.windows import Window
    for row in range(0, dataset.height, height):
        yield Window(0, row, dataset.width, min(height, dataset.height - row))


def _aligned(reference, other):
    from pyproj import CRS
    if (reference.width != other.width or reference.height != other.height
            or reference.transform != other.transform or not reference.crs or not other.crs
            or CRS.from_user_input(reference.crs) != CRS.from_user_input(other.crs)):
        raise ValueError("Study rasters must retain the exact selected grid and CRS")


def _mask_profile(reference):
    profile = reference.profile.copy()
    profile.update(
        driver="GTiff", dtype="uint8", count=1, nodata=MASK_NODATA,
        compress="deflate", tiled=True, blockxsize=256, blockysize=256,
        BIGTIFF="IF_SAFER", predictor=1,
    )
    return profile


def _snapshot(path):
    value = Path(path).stat()
    return (value.st_dev, value.st_ino, value.st_size, value.st_mtime_ns, value.st_ctime_ns)


def _runtime():
    from natcap.invest.scenario_gen_proximity import scenario_gen_proximity
    import pygeoprocessing
    from osgeo import gdal
    from model.common import INVEST_VERSION, file_digest
    version = importlib.metadata.version("natcap.invest")
    if version != INVEST_VERSION or version != "3.20.0":
        raise ValueError("This regional programme uses the retained InVEST 3.20.0 scenario generator")
    modules = {}
    for name, module in (
            ("scenario_gen_proximity", scenario_gen_proximity),
            ("pygeoprocessing", inspect.getmodule(pygeoprocessing.calculate_slope))):
        try:
            source_file = inspect.getsourcefile(module)
        except TypeError:
            source_file = None
        # calculate_slope is normally a compiled Cython extension. Retain the
        # installed extension identity when a Python source file is unavailable.
        path = Path(source_file or module.__file__).resolve(strict=True)
        modules[name] = {"sha256": file_digest(path), "filename": path.name,
                         "kind": "python-source" if source_file else "compiled-extension"}
    return scenario_gen_proximity, pygeoprocessing, {
        "invest_version": version,
        "pygeoprocessing_version": importlib.metadata.version("pygeoprocessing"),
        "gdal_version": gdal.VersionInfo("RELEASE_NAME"),
        "modules": modules, "source": NATIVE_SOURCE,
    }


def _prepare_base(nlcd_path, domain_path, destination):
    """Mask the selected NLCD to the retained reporting-area management mask."""
    import numpy as np
    import rasterio
    counts = Counter()
    with rasterio.open(nlcd_path) as source, rasterio.open(domain_path) as domain:
        _aligned(source, domain)
        profile = _mask_profile(source)
        profile.update(dtype="int16", nodata=-32768, predictor=2)
        with rasterio.open(destination, "w", **profile) as target:
            for window in _windows(source):
                values = source.read(1, window=window)
                inside = domain.read(1, window=window) == 1
                valid = inside & (source.read_masks(1, window=window) != 0)
                if np.any(inside & ~valid):
                    raise ValueError("Complete original NLCD coverage is needed inside the study domain")
                selected = values[valid]
                if selected.size and (
                        not np.isfinite(selected).all()
                        or np.any(selected != np.rint(selected))
                        or np.any(selected < 0) or np.any(selected > 255)):
                    raise ValueError("The study requires original integer NLCD class codes")
                output = np.full(values.shape, -32768, dtype=np.int16)
                output[valid] = selected.astype(np.int16)
                target.write(output, 1, window=window)
                keys, numbers = np.unique(selected, return_counts=True)
                counts.update({int(key): int(number) for key, number in zip(keys, numbers)})
    if not counts:
        raise ValueError("The selected study domain contains no valid NLCD cells")
    return dict(sorted(counts.items()))


def _quantized_quota(forest_cells, fraction):
    value = Fraction(str(fraction))
    if not 0 < value <= 1:
        raise ValueError("Use a published positive area fraction no greater than one")
    return forest_cells * value.numerator // value.denominator


def _native_arguments(directory, baseline_path, rule, quota, area_ha, codes):
    # Native InVEST uses ceil(area/pixel_area). A quarter-cell offset below the
    # desired integer prevents floating-point rounding from adding one cell.
    # Both requested scientific area and the actual native argument are recorded.
    return {
        "workspace_dir": str(directory),
        "results_suffix": "",
        "base_lulc_path": str(baseline_path),
        "replacement_lucode": int(rule["to_codes"][0]),
        "area_to_convert": (quota - 0.25) * area_ha,
        "focal_landcover_codes": " ".join(map(str, FOREST_CODES)),
        "convertible_landcover_codes": " ".join(map(str, codes)),
        "n_fragmentation_steps": 1,
        "aoi_path": "",
        "convert_farthest_from_edge": True,
        "convert_nearest_to_edge": True,
        "n_workers": -1,
    }


def _extract_change_masks(baseline_path, candidate_path, folder, rule, quota):
    """Retain exact binary selections without polygonizing regional rasters."""
    import numpy as np
    import rasterio
    destinations = list(rule["to_codes"])
    paths = {code: folder / ("selection-" + str(code) + ".tif") for code in destinations}
    counts = Counter()
    transitions = Counter()
    changed_total = 0
    folder.mkdir(parents=True, exist_ok=True)
    with ExitStack() as stack:
        baseline = stack.enter_context(rasterio.open(baseline_path))
        candidate = stack.enter_context(rasterio.open(candidate_path))
        _aligned(baseline, candidate)
        writers = {code: stack.enter_context(
            rasterio.open(path, "w", **_mask_profile(baseline)))
            for code, path in paths.items()}
        for window in _windows(baseline):
            before = baseline.read(1, window=window)
            after = candidate.read(1, window=window)
            valid = baseline.read_masks(1, window=window) != 0
            candidate_valid = candidate.read_masks(1, window=window) != 0
            if np.any(valid != candidate_valid):
                raise ValueError("Native scenario generation changed original valid-cell coverage")
            changed = valid & (before != after)
            if np.any(after[changed] != destinations[0]):
                raise ValueError("Native scenario output changed an unexpected destination class")
            if "from_codes" in rule:
                eligible = np.isin(before, rule["from_codes"])
            else:
                eligible = ~np.isin(before, rule["eligibility"]["exclude_codes"])
            if np.any(changed & ~eligible):
                raise ValueError("Native scenario generation selected an ineligible original cell")
            indexes = np.flatnonzero(changed)
            # Equal destination shares are a disclosed regional allocation choice.
            # Cycling through row-major selected cells keeps the three totals
            # within one cell and avoids a large north/south assignment gradient.
            assignments = (changed_total + np.arange(indexes.size)) % len(destinations)
            for ordinal, code in enumerate(destinations):
                selected_indexes = indexes[assignments == ordinal]
                mask = np.zeros(before.shape, dtype=np.uint8)
                mask.ravel()[selected_indexes] = 1
                writers[code].write(mask, 1, window=window)
                count = int(selected_indexes.size)
                counts[code] += count
                original, amounts = np.unique(
                    before.ravel()[selected_indexes], return_counts=True)
                transitions.update({
                    (int(old), code): int(number) for old, number in zip(original, amounts)})
            changed_total += int(indexes.size)
    if changed_total != quota:
        raise ValueError(
            "Native scenario converted " + str(changed_total)
            + " cells; the selected published area requires " + str(quota))
    if len(destinations) > 1 and max(counts.values()) - min(counts.values()) > 1:
        raise ValueError("The three new forest classes must have equal quantized shares")
    return paths, {
        "converted_cells": changed_total,
        "destination_cells": {str(code): counts[code] for code in destinations},
        "transitions": [
            {"from_code": old, "to_code": new, "cells": count}
            for (old, new), count in sorted(transitions.items())],
        "destination_allocation": (
            "One destination class" if len(destinations) == 1 else
            "Equal shares, rounded to cells; 41,42,43 cycle over row-major selected cells"),
    }


def _steep_masks(baseline_path, slope_path, folder, rule):
    import numpy as np
    import rasterio
    folder.mkdir(parents=True, exist_ok=True)
    paths = {
        item["to_code"]: folder / ("selection-" + str(item["to_code"]) + ".tif")
        for item in rule["transitions"]}
    transitions = Counter()
    eligible_agriculture = 0
    with ExitStack() as stack:
        baseline = stack.enter_context(rasterio.open(baseline_path))
        slope = stack.enter_context(rasterio.open(slope_path))
        _aligned(baseline, slope)
        writers = {code: stack.enter_context(
            rasterio.open(path, "w", **_mask_profile(baseline)))
            for code, path in paths.items()}
        for window in _windows(baseline):
            original = baseline.read(1, window=window)
            gradients = slope.read(1, window=window)
            valid = baseline.read_masks(1, window=window) != 0
            slope_valid = ((slope.read_masks(1, window=window) != 0)
                           & np.isfinite(gradients))
            for item in rule["transitions"]:
                agriculture = valid & np.isin(original, item["from_codes"])
                if np.any(agriculture & ~slope_valid):
                    raise ValueError("Repair missing DEM slope coverage on original agricultural cells")
                eligible_agriculture += int(np.count_nonzero(agriculture))
                selected = agriculture & slope_valid & (gradients >= rule["slope"]["value"])
                writers[item["to_code"]].write(selected.astype(np.uint8), 1, window=window)
                codes, amounts = np.unique(original[selected], return_counts=True)
                transitions.update({
                    (int(code), item["to_code"]): int(count)
                    for code, count in zip(codes, amounts)})
    return paths, {
        "converted_cells": sum(transitions.values()),
        "original_agricultural_cells": eligible_agriculture,
        "slope_threshold": rule["slope"],
        "destination_cells": {
            str(code): sum(count for (_, target), count in transitions.items() if target == code)
            for code in paths},
        "transitions": [
            {"from_code": old, "to_code": new, "cells": count}
            for (old, new), count in sorted(transitions.items())],
    }


def _register(workspace, directory, folder, rule, variant, mask_paths, statistics, lineage):
    from model.common import atomic_json, describe_file, file_digest
    title = rule["title"] + (" / " + variant.replace("_", " ") if variant else "")
    if "from_codes" in rule:
        from_codes = {code: rule["from_codes"] for code in mask_paths}
    elif "transitions" in rule:
        from_codes = {item["to_code"]: item["from_codes"] for item in rule["transitions"]}
    else:
        from_codes = {
            code: [int(value) for value in lineage["original_class_counts"]
                   if int(value) not in rule["eligibility"]["exclude_codes"]]
            for code in mask_paths}
    provenance = {
        "schema": "upstate.published-spatial-derivation/v1",
        "rule": rule, "allocation": variant,
        "statistics": statistics, **lineage,
    }
    atomic_json(folder / "derivation.json", provenance, immutable=True)
    entries, patches = [], []
    for code, path in mask_paths.items():
        source_id = "study-selection-" + str(code)
        mask_sha256 = file_digest(path)
        entries.append({
            "id": source_id, "title": title + " to NLCD " + str(code),
            "kind": "raster", "path": path.name, "sha256": mask_sha256,
            "uri": "urn:upstate:study-selection:" + mask_sha256,
            "vintage": "Vickery and Quinn 2023 rules applied to retained regional baseline",
            "units": "binary cell selection; 1 selected, 0 excluded, nodata excluded",
            "resampling": "nearest",
            "companions": [{"path": "derivation.json"}],
            "derivation": provenance,
        })
        patches.append({
            "mask_source_id": source_id, "from_codes": from_codes[code],
            "to_code": code,
            "reason": rule["source_section"] + "; " + title
                      + "; retained exact binary selection on the original grid.",
        })
    manifest = {
        "schema": "upstate.sources/v1", "title": title,
        "notes": [PAPER, NATIVE_SOURCE, "Native pixel-centre masks; exact original grid."],
        "entries": entries,
    }
    manifest_path = folder / "source-manifest.json"
    atomic_json(manifest_path, manifest, immutable=True)
    collection = workspace.import_sources(manifest_path)
    scenario = workspace.save_scenario({
        "title": title, "reason": (
            rule["source_section"] + "; published quantity and transitions applied to the "
            "retained current regional baseline, with the recorded allocation method."),
        "kind": "landcover",
        "source_collection_id": collection["id"], "patches": patches,
        "study_derivation": provenance,
    })
    return {
        "scenario_id": scenario["id"], "title": title,
        "source_collection_id": collection["id"],
        "statistics": statistics,
        "files": {
            **{"mask_" + str(code): describe_file(directory, path)
               for code, path in mask_paths.items()},
            "derivation": describe_file(directory, folder / "derivation.json"),
            "manifest": describe_file(directory, manifest_path),
        },
    }


def prepare(workspace, baseline_run_id, *, data_directory=None):
    """Prepare seven regional scenarios and retain all native generation outputs."""
    import rasterio
    from pyproj import CRS
    from model import reuse
    from model.common import (
        atomic_json, describe_file, digest, file_digest, held, now, read_json, verify_file)
    from source_tools.upstate_study_profiles import read_definitions

    definitions, _, source_identity = read_definitions(data_directory)
    study = definitions["vickery_quinn_2023"]
    baseline = workspace.inspect_run(baseline_run_id)
    scenario = workspace._get("scenarios", baseline["selection"]["scenario_id"])
    if scenario["kind"] != "baseline":
        raise ValueError("Select the original baseline run for published land-cover quantities")
    grid = workspace.get_grid(baseline["selection"]["grid_id"])
    grid_folder = workspace.root / "grids" / grid["id"]
    nlcd = verify_file(grid_folder, grid["files"]["NLCD"])
    dem = verify_file(grid_folder, grid["files"]["DEM"])
    original_domain = grid["spec"]["reporting_area"]
    management_mask = verify_file(grid_folder, grid["files"]["reporting_mask"])
    domain_source, domain_entry = workspace.source_file(
        grid["spec"]["source_collection_id"], original_domain["source_id"])
    native, pygeoprocessing, runtime = _runtime()
    with rasterio.open(nlcd) as reference:
        crs = CRS.from_user_input(reference.crs)
        transform = reference.transform
        if (not crs.is_projected or not crs.axis_info
                or any(abs(axis.unit_conversion_factor - 1) > 1e-12 for axis in crs.axis_info[:2])
                or transform.b != 0 or transform.d != 0
                or not math.isclose(abs(transform.a), 30, abs_tol=1e-8)
                or not math.isclose(abs(transform.e), 30, abs_tol=1e-8)):
            raise ValueError("Prepare the actual 30 m projected metre grid for these regional scenarios")
        pixel_area_ha = abs(transform.a * transform.e) / 10000.0
    selection = {
        "schema": SCHEMA, "baseline_run_id": baseline["id"],
        "grid_id": grid["id"], "definition_sha256": source_identity["definition_sha256"],
        "inputs": {"NLCD": grid["files"]["NLCD"], "DEM": grid["files"]["DEM"],
                   "reporting_mask": grid["files"]["reporting_mask"]},
        "study_domain": {
            "source_collection_id": grid["spec"]["source_collection_id"],
            "selection": original_domain, "body": domain_entry["body"],
            "companions": domain_entry["companions"],
            "meaning": "Retained reporting-area management cells; regional selection is the 116 South Carolina reporting HUCs",
        },
        "native_routing_context": {
            "selection": grid["spec"]["model_domain"],
            "prepared_domain": grid["files"]["model_domain"],
            "meaning": "Full 217-HUC contributing domain and upstream buffer retained for native hydrology",
        },
        "allocation": {
            "directions": list(DIRECTIONS), "fragmentation_steps": 1,
            "forest_shares": "Equal, row-major cycling 41/42/43; at most one-cell difference",
            "quantity_rounding": "Floor published fraction times original valid forest cells",
        },
        "runtime": runtime, "adapter_sha256": file_digest(Path(__file__)),
    }
    key = digest(selection)
    directory = workspace.root / "study-spatial-programmes" / key
    directory.mkdir(parents=True, exist_ok=True)
    state_path = directory / "state.json"
    with held(directory / ".prepare.lock", blocking=False):
        atomic_json(directory / "selection.json", selection, immutable=True)
        state = read_json(state_path) if state_path.exists() else {
            "schema": SCHEMA, "id": key, "workspace_id": workspace.project["id"],
            "baseline_run_id": baseline["id"], "grid_id": grid["id"],
            "created_at": now(), "files": {}, "scenarios": {},
        }
        if state["workspace_id"] != workspace.project["id"]:
            raise ValueError("Resume this programme in its original workspace")
        for record in state["scenarios"].values():
            for item in record["files"].values():
                verify_file(directory, item)
            workspace._get("scenarios", record["scenario_id"])
        for item in state["files"].values():
            verify_file(directory, item)
        if state.get("state") == "complete":
            return state
        state.update(state="preparing", updated_at=now())
        state.pop("error", None)
        atomic_json(state_path, state)
        snapshots = {path: _snapshot(path) for path in (nlcd, dem, domain_source, management_mask)}
        try:
            domain_mask = directory / "original-study-domain.tif"
            prepared_base = directory / "study-baseline-nlcd.tif"
            if "study_baseline" not in state["files"]:
                domain_descriptor = reuse.copy_verified(
                    grid_folder, grid["files"]["reporting_mask"], directory,
                    path=domain_mask.name)
                counts = _prepare_base(nlcd, domain_mask, prepared_base)
                state["original_class_counts"] = {str(code): count for code, count in counts.items()}
                state["files"]["study_domain_mask"] = domain_descriptor
                state["files"]["study_baseline"] = describe_file(directory, prepared_base)
                atomic_json(state_path, state)
            counts = {int(code): count for code, count in state["original_class_counts"].items()}
            forest_cells = sum(counts.get(code, 0) for code in FOREST_CODES)
            if forest_cells == 0:
                raise ValueError("Original study domain has no mapped forest for published area rules")
            lineage = {
                "programme_id": key, "baseline_run_id": baseline["id"], "grid_id": grid["id"],
                "study_reference": PAPER, "native_source": NATIVE_SOURCE,
                "runtime": runtime, "definition_sha256": selection["definition_sha256"],
                "original_class_counts": state["original_class_counts"],
                "forest_cells": forest_cells, "pixel_area_ha": pixel_area_ha,
                "study_domain": selection["study_domain"],
                "native_routing_context": selection["native_routing_context"],
                "allocation_choices": selection["allocation"],
                "regional_interpretation": (
                    "Published 2016-study transition rules applied to the current retained "
                    "regional land cover; edge direction and equal-share placement are explicit "
                    "regional choices."),
            }
            for rule in study["scenarios"]:
                if "slope" in rule:
                    variant = rule["key"]
                    if variant in state["scenarios"]:
                        continue
                    state.update(active_scenario=variant, updated_at=now())
                    atomic_json(state_path, state)
                    slope_path = directory / "native-slope-percent.tif"
                    if "slope" not in state["files"]:
                        pygeoprocessing.calculate_slope((str(dem), 1), str(slope_path))
                        state["files"]["slope"] = describe_file(directory, slope_path, units="percent")
                        atomic_json(state_path, state)
                    folder = directory / variant
                    masks, statistics = _steep_masks(prepared_base, slope_path, folder, rule)
                    statistics["converted_area_ha"] = statistics["converted_cells"] * pixel_area_ha
                    state["scenarios"][variant] = _register(
                        workspace, directory, folder, rule, "", masks, statistics,
                        {**lineage, "native_slope": state["files"]["slope"]})
                    atomic_json(state_path, state)
                    continue
                quota = _quantized_quota(forest_cells, rule["quantity"]["fraction"])
                if quota < 1:
                    raise ValueError("The published area is less than one cell on this study domain")
                eligible = (rule["from_codes"] if "from_codes" in rule else
                            [code for code in counts if code not in rule["eligibility"]["exclude_codes"]])
                if sum(counts.get(code, 0) for code in eligible) < quota:
                    raise ValueError("The retained study domain has too few eligible cells for " + rule["key"])
                if all(rule["key"] + "_" + direction in state["scenarios"] for direction in DIRECTIONS):
                    continue
                native_folder = directory / ("native-" + rule["key"])
                native_folder.mkdir(parents=True, exist_ok=True)
                args = _native_arguments(native_folder, prepared_base, rule, quota, pixel_area_ha, eligible)
                retained_args = {
                    **args, "workspace_dir": native_folder.relative_to(directory).as_posix(),
                    "base_lulc_path": prepared_base.relative_to(directory).as_posix(),
                }
                atomic_json(native_folder / "selected-arguments.json", retained_args, immutable=True)
                state.update(active_scenario=rule["key"], updated_at=now())
                atomic_json(state_path, state)
                warnings = native.validate(args)
                if warnings:
                    raise ValueError("Native scenario inputs: " + json.dumps(warnings))
                registry = native.execute(args)
                for direction in DIRECTIONS:
                    variant = rule["key"] + "_" + direction
                    if variant in state["scenarios"]:
                        continue
                    native_outputs = {
                        name: describe_file(directory, Path(registry[name]))
                        for name in (direction, direction + "_csv", direction + "_distance")}
                    for name, item in native_outputs.items():
                        state["files"]["native_" + rule["key"] + "_" + name] = item
                    atomic_json(state_path, state)
                    folder = directory / variant
                    masks, statistics = _extract_change_masks(
                        prepared_base, Path(registry[direction]), folder, rule, quota)
                    statistics.update(
                        original_forest_cells=forest_cells,
                        original_forest_area_ha=forest_cells * pixel_area_ha,
                        published_fraction=rule["quantity"]["fraction"],
                        requested_cells=quota, requested_area_ha=quota * pixel_area_ha,
                        converted_area_ha=statistics["converted_cells"] * pixel_area_ha,
                        native_area_argument_ha=args["area_to_convert"],
                    )
                    state["scenarios"][variant] = _register(
                        workspace, directory, folder, rule, direction, masks, statistics,
                        {**lineage, "native_arguments": retained_args, "native_outputs": native_outputs})
                    atomic_json(state_path, state)
            if any(_snapshot(path) != before for path, before in snapshots.items()):
                raise ValueError("An original selected source changed during scenario preparation")
            state.update(
                state="complete", active_scenario=None,
                scenario_ids=[item["scenario_id"] for item in state["scenarios"].values()],
                completed_at=state.get("completed_at") or now(), updated_at=now(),
            )
            atomic_json(state_path, state)
            return state
        except BaseException as exc:
            state.update(state="failed", updated_at=now(),
                         error={"type": type(exc).__name__, "message": str(exc)})
            atomic_json(state_path, state)
            raise


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--application", type=Path)
    parser.add_argument("--workspace", type=Path, required=True)
    parser.add_argument("--baseline-run", required=True)
    parser.add_argument("--data-directory", type=Path)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args(argv)
    if args.application:
        sys.path.insert(0, str(args.application.resolve(strict=True)))
    from model.common import atomic_json
    from model.workspace import Workspace
    try:
        result = prepare(
            Workspace(args.workspace), args.baseline_run, data_directory=args.data_directory)
        if args.output:
            atomic_json(args.output, result)
        print(json.dumps(result, indent=2, ensure_ascii=False, allow_nan=False))
        return 0
    except (ValueError, KeyError, OSError, RuntimeError) as exc:
        print(json.dumps({"state": "failed", "type": type(exc).__name__,
                          "message": str(exc)}), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
