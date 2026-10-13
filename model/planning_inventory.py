"""Planning units from original polygons and completed native mass exports.

This intake is independent of the seven-family customer delivery. Every value
comes from a retained native run and the original source feature selection.
"""
from __future__ import annotations

from contextlib import ExitStack
import csv
import json
import math
import os
from pathlib import Path
import tempfile
import time

from .common import (atomic_json, describe_file, digest, file_digest, held,
                     identifier, read_json, verify_file)
from .model_selection import MODEL_OUTPUTS, common_comparison_outputs, run_models
from .rasters import (MASS_UNITS, native_vector_path, polygon_union,
                      vector_environment, vector_geometry)

KIND = "planning-inventories"
SCHEMA = "upstate.planning-unit-inventory/v1"
METHOD = "common-valid-original-polygons/2"
LEGACY_METHOD = "common-valid-original-polygons/1"
PRECISION_METHOD = (
    "For each original polygon on the same common-valid cells, sum half an ULP "
    "of every retained baseline and alternative mass value in its actual raster "
    "dtype, then add a conservative float64 summation/subtraction bound. Raw "
    "changes remain unchanged; portfolio scoring treats changes within this "
    "encoding bound as zero. This is a numeric resolution bound, not model "
    "uncertainty or a minimum ecological benefit."
)
METRICS = {
    "nitrogen_export": ("nitrogen", "nitrogen_kg_year", "kg/year"),
    "phosphorus_export": ("phosphorus", "phosphorus_kg_year", "kg/year"),
    "sediment_export": ("sediment", "sediment_t_year", "metric tonnes/year"),
}
FIELDS = (
    "feature_id", "source_feature_id", "original_attributes", "area_ha",
    "reporting_area_ha", "protected_fraction", "source_water",
    "high_quality_context", "nitrogen_kg_year", "phosphorus_kg_year",
    "sediment_t_year", "priority_mean", "reporting_pixels", "valid_pixels",
    "coverage_fraction", "scenario_changes", "scenario_precision",
)
CONTEXT = {
    "protected_fraction": None, "source_water": None,
    "high_quality_context": None, "priority_mean": None,
}
SUPPORT = (
    "Original polygon pixel centres within the retained reporting mask, valid "
    "and finite for every selected run and every common pollutant. Baseline "
    "mass and all alternative-minus-baseline changes use that identical support."
)
OVERLAP = (
    "Each original feature is summarized independently. Features may overlap; "
    "their areas, pixels and exports must not be added as a unique regional total. "
    "A selected portfolio is evaluated through the ordinary combined native run."
)


def _json(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False,
                      allow_nan=False)


def _text(value, name):
    if not isinstance(value, str) or not value.strip():
        raise ValueError(name + " must be nonempty text")
    return value.strip()


def _selection(value):
    if not isinstance(value, dict):
        raise ValueError("Provide the original planning-unit selection")
    allowed = {"baseline_run_id", "scenario_run_ids", "source_collection_id",
               "source_id", "layer", "where", "feature_id_field", "unit_kind", "title"}
    extra = set(value) - allowed
    if extra:
        raise ValueError("Unknown planning selection fields: " + ", ".join(sorted(extra)))
    scenarios = value.get("scenario_run_ids", [])
    if not isinstance(scenarios, list) or any(not isinstance(x, str) for x in scenarios):
        raise ValueError("scenario_run_ids must be a list of completed native run IDs")
    scenarios = [identifier(x) for x in scenarios]
    if len(scenarios) != len(set(scenarios)):
        raise ValueError("Select each alternative run once")
    baseline = identifier(value["baseline_run_id"])
    if baseline in scenarios:
        raise ValueError("The baseline must differ from each alternative")
    result = {
        "baseline_run_id": baseline,
        "scenario_run_ids": scenarios,
        "source_collection_id": identifier(value["source_collection_id"]),
        "source_id": _text(value.get("source_id"), "source_id"),
        "unit_kind": _text(value.get("unit_kind", "planning unit"), "unit_kind"),
        "title": _text(value.get("title"), "title"),
    }
    for key in ("layer", "feature_id_field"):
        if value.get(key) is not None:
            result[key] = _text(value[key], key)
    if value.get("where") is not None:
        if not isinstance(value["where"], dict):
            raise ValueError("where must contain original property equality selections")
        if any(not isinstance(k, str) for k in value["where"]):
            raise ValueError("where property names must be text")
        _json(value["where"])
        result["where"] = dict(value["where"])
    return result


def _source_selection(selection):
    value = {key: selection[key] for key in
             ("source_collection_id", "source_id", "layer", "where") if key in selection}
    if "feature_id_field" in selection:
        value["id_field"] = selection["feature_id_field"]
    return value


def _native_cohort(runs, outputs):
    """Bind execution versions of the completed native models being compared."""
    from .scenario_analysis import _native_version
    models = tuple(model for model in run_models(runs[0])
                   if any(name in outputs for name in MODEL_OUTPUTS[model]))
    versions = {}
    for run in runs:
        recorded = _native_version(run)
        selected = {}
        for model in models:
            stage = run.get("stages", {}).get(model, {})
            executed = _native_version({"selection": run["selection"],
                                        "runtime": stage.get("runtime")})
            # A resumed run can retain an older completed stage while its
            # run.runtime describes only the newly executed stage.
            value = ({**executed, "basis": "observed_stage_runtime"}
                     if executed["observed"] else dict(recorded))
            selected[model] = {**value, "stage_observed": executed["observed"]}
        versions[run["id"]] = {"run": recorded, "models": selected}
    cohort = {}
    for model in models:
        baseline = versions[runs[0]["id"]]["models"][model]["comparison_version"]
        if not baseline or any(not item["models"][model]["comparison_version"]
                               for item in versions.values()):
            raise ValueError("Each planning run needs a retained InVEST version for " + model.upper())
        if any(item["models"][model]["comparison_version"] != baseline
               for item in versions.values()):
            raise ValueError("Planning alternatives must use the baseline's executed InVEST version for "
                             + model.upper() + "; retain stage/run runtime or labeled legacy request")
        cohort[model] = {
            "comparison_version": baseline,
            "run_runtime_fallback_run_ids": [
                run["id"] for run in runs
                if versions[run["id"]]["models"][model]["basis"] == "observed_runtime"],
            "requested_fallback_run_ids": [
                run["id"] for run in runs
                if versions[run["id"]]["models"][model]["basis"] == "requested_legacy"],
        }
    return versions, {
        "policy": "observed_stage_runtime_else_observed_run_runtime_else_labeled_requested_legacy",
        "common_models": list(models), "models": cohort,
    }


def _inputs(workspace, selection, *, method=METHOD):
    runs = [workspace.inspect_run(key) for key in
            [selection["baseline_run_id"], *selection["scenario_run_ids"]]]
    outputs = common_comparison_outputs(runs)
    baseline = runs[0]
    native_versions, version_cohort = _native_cohort(runs, outputs)
    grid_id = baseline["selection"]["grid_id"]
    profile_id = baseline["selection"]["profile_id"]
    for run in runs:
        if run["selection"]["grid_id"] != grid_id:
            raise ValueError("Planning alternatives must use the original baseline grid")
        if run["selection"]["profile_id"] != profile_id:
            raise ValueError("Planning land-cover alternatives must retain the baseline parameter profile")
    baseline_scenario = workspace._get("scenarios", baseline["selection"]["scenario_id"])
    if baseline_scenario.get("kind") != "baseline":
        raise ValueError("Choose the original baseline scenario as planning baseline")
    grid = workspace.get_grid(grid_id)
    source_path, entry = workspace.source_file(selection["source_collection_id"],
                                               selection["source_id"])
    if entry.get("kind") != "vector":
        raise ValueError("Select an original polygon vector source")
    roots = {run["id"]: workspace.root / "runs" / run["id"] for run in runs}
    artifact_paths = {}
    for run in runs:
        for name in outputs:
            artifact = run["artifacts"][name]
            if (artifact.get("units") != MASS_UNITS[name]
                    or artifact.get("sum_units") != MASS_UNITS[name].replace("/pixel", "")):
                raise ValueError("Planning intake requires original annual mass units for " + name)
        artifact_paths[run["id"]] = {
            name: verify_file(roots[run["id"]], run["artifacts"][name])
            for name in outputs
        }
    grid_root = workspace.root / "grids" / grid_id
    reporting_mask = verify_file(grid_root, grid["files"]["reporting_mask"])
    reporting_area = verify_file(grid_root, grid["files"]["reporting_area"])
    identity = {
        "method": method, "selection": selection, "grid_id": grid_id,
        "profile_id": profile_id, "source": entry,
        "native_versions": native_versions,
        "reporting_mask": grid["files"]["reporting_mask"],
        "reporting_area": grid["files"]["reporting_area"],
        "runs": [{"id": run["id"], "selection": run["selection"],
                  "artifacts": {name: run["artifacts"][name] for name in outputs}}
                 for run in runs],
    }
    return {
        "runs": runs, "outputs": outputs, "grid": grid, "grid_id": grid_id,
        "native_versions": native_versions, "native_version": version_cohort,
        "profile_id": profile_id, "source_path": source_path, "entry": entry,
        "artifact_paths": artifact_paths, "reporting_mask": reporting_mask,
        "reporting_area": reporting_area, "identity": identity,
        "selection_id": digest(identity),
    }


def _same_grid(dataset, reference, name):
    if (dataset.crs != reference.crs or dataset.transform != reference.transform
            or dataset.width != reference.width or dataset.height != reference.height
            or dataset.count != 1):
        raise ValueError(name + " differs from the retained reporting grid")


def _window_tiles(bounds, dataset, size=512):
    from rasterio.windows import Window, from_bounds
    candidate = from_bounds(*bounds, transform=dataset.transform)
    x0 = max(0, math.floor(candidate.col_off))
    y0 = max(0, math.floor(candidate.row_off))
    x1 = min(dataset.width, math.ceil(candidate.col_off + candidate.width))
    y1 = min(dataset.height, math.ceil(candidate.row_off + candidate.height))
    for row in range(y0, y1, size):
        for column in range(x0, x1, size):
            yield Window(column, row, min(size, x1-column), min(size, y1-row))


def _encoding_half_ulp(values, dtype):
    """Round-to-nearest encoding radius in the actual retained mass dtype."""
    import numpy as np
    kind = np.dtype(dtype)
    if np.issubdtype(kind, np.integer):
        return 0.0
    if not np.issubdtype(kind, np.floating):
        raise ValueError("Native mass precision requires a real numeric raster dtype")
    encoded = np.asarray(values, dtype=kind)
    # Promote spacing before halving; round outward to retain subnormal bounds.
    spacing = np.spacing(np.abs(encoded)).astype("float64")
    if not np.isfinite(spacing).all():
        raise ValueError("Retained mass is too large to bound its encoding precision")
    half = np.nextafter(spacing * 0.5, np.inf)
    return float(half.sum(dtype="float64"))


def _change_precision(a, b, a_encoding, b_encoding, count):
    # Two additions per cell enclose tile sums, accumulation and subtraction.
    count_epsilon = (2 * count + 2) * math.ulp(1.0)
    if count_epsilon >= 1:
        raise ValueError("Native mass cell count exceeds finite precision bounds")
    arithmetic = count_epsilon / (1 - count_epsilon) * (abs(a) + abs(b))
    bound = a_encoding + b_encoding + arithmetic
    if not math.isfinite(bound):
        raise ValueError("Native mass encoding bound overflowed")
    return math.nextafter(bound, math.inf) if bound else 0.0


def _commit_csv(pending, destination):
    if destination.exists():
        if (destination.stat().st_size != pending.stat().st_size
                or file_digest(destination) != file_digest(pending)):
            raise ValueError("Existing planning inventory bytes differ for the same retained inputs")
        pending.unlink()
    else:
        os.replace(pending, destination)


def _promote_legacy_inventory(workspace, inputs, directory):
    """Bind versions to an exact completed inventory without repeating cell sums."""
    legacy_identity = {name: value for name, value in inputs["identity"].items()
                       if name != "native_versions"}
    legacy_key = digest(legacy_identity)
    legacy_directory = workspace.root / "planning-inventory-data" / legacy_key
    pointer = legacy_directory / "record.json"
    if not pointer.is_file():
        return None
    previous = inspect(workspace, read_json(pointer)["id"])
    if previous["selection_id"] != legacy_key:
        raise ValueError("Original planning inventory pointer selects another input identity")
    original = read_json(verify_file(workspace.root, previous["files"]["inventory"]))
    if original["native_inputs"] != legacy_identity:
        raise ValueError("Original planning inventory inputs differ from this version binding")
    origin = {
        "method": "original-inventory-native-version-binding/1",
        "inventory_id": previous["id"], "selection_id": previous["selection_id"],
        "files": previous["files"],
    }
    inventory = {
        **original, "selection_id": inputs["selection_id"],
        "native_inputs": inputs["identity"],
        "native_versions": inputs["native_versions"], "native_version": inputs["native_version"],
        "derived_from": origin,
    }
    destination = directory / "inventory.json"
    atomic_json(destination, inventory, immutable=True)
    return workspace._save(KIND, {
        **previous, "selection_id": inputs["selection_id"],
        "native_versions": inputs["native_versions"], "native_version": inputs["native_version"],
        "derived_from": origin,
        "files": {**previous["files"],
                  "inventory": describe_file(workspace.root, destination)},
    })


def build(workspace, selection, *, raster_cache_bytes=None):
    """Summarize original polygon features on a shared native valid-cell support."""
    from .raster_block_cache import DEFAULT_CACHE_BYTES, NativeBlockCache
    requested = dict(selection) if isinstance(selection, dict) else selection
    supplied = requested.pop("raster_cache_bytes", None) if isinstance(requested, dict) else None
    if (raster_cache_bytes is not None and supplied is not None
            and (type(raster_cache_bytes) is not type(supplied) or raster_cache_bytes != supplied)):
        raise ValueError("Select one operational raster_cache_bytes budget")
    budget = raster_cache_bytes if raster_cache_bytes is not None else supplied
    read_cache = NativeBlockCache(DEFAULT_CACHE_BYTES if budget is None else budget)
    selection = _selection(requested)
    inputs = _inputs(workspace, selection)
    directory = workspace.root / "planning-inventory-data" / inputs["selection_id"]
    directory.mkdir(parents=True, exist_ok=True)
    with held(directory / ".planning-inventory.lock", blocking=False):
        completed = directory / "record.json"
        if completed.exists():
            previous = read_json(completed)
            record = inspect(workspace, previous["id"])
            if record["selection_id"] != inputs["selection_id"]:
                raise ValueError("Planning inventory input identity changed")
            return record
        promotion_started = time.monotonic()
        promoted = _promote_legacy_inventory(workspace, inputs, directory)
        if promoted is not None:
            atomic_json(directory / "read-processing.json", {
                "schema": "upstate.planning-raster-reads/v1",
                "inventory_id": promoted["id"], "selection_id": inputs["selection_id"],
                "csv_sha256": promoted["files"]["csv"]["sha256"],
                "mode": "retained_inventory_version_binding",
                "reused_from_inventory_id": promoted["derived_from"]["inventory_id"],
                "elapsed_seconds": time.monotonic() - promotion_started,
                "reads": read_cache.snapshot(),
            })
            atomic_json(completed, {"id": promoted["id"]}, immutable=True)
            return promoted
        import fiona
        import numpy as np
        import rasterio
        from pyproj import CRS, Transformer
        from rasterio.features import geometry_mask
        from rasterio.windows import transform as window_transform
        from shapely.geometry import mapping, shape
        from shapely.ops import transform

        runs, outputs = inputs["runs"], inputs["outputs"]
        baseline = runs[0]
        counters = {"original_features": 0, "selected_features": 0,
                    "outside_reporting_area": 0, "retained_features": 0,
                    "features_without_reporting_pixels": 0,
                    "features_without_common_valid_pixels": 0}
        pixel_counts = {"reporting_pixels": 0, "common_valid_pixels": 0}
        min_coverage, max_coverage = None, None
        pending = None
        started = time.monotonic()
        try:
            with ExitStack() as stack:
                stack.callback(read_cache.clear)
                mask = stack.enter_context(rasterio.open(inputs["reporting_mask"]))
                grid_crs = CRS.from_user_input(mask.crs)
                if (not grid_crs.is_projected or not grid_crs.axis_info
                        or any(not math.isclose(axis.unit_conversion_factor, 1.0,
                                                rel_tol=0, abs_tol=1e-12)
                               for axis in grid_crs.axis_info[:2])
                        or mask.transform.a <= 0 or mask.transform.e >= 0
                        or mask.transform.b or mask.transform.d):
                    raise ValueError("Planning area calculations require the retained projected metre grid")
                prepared = inputs["grid"]["grid"]
                if (list(mask.transform)[:6] != list(prepared["transform"])[:6]
                        or mask.width != prepared["width"] or mask.height != prepared["height"]):
                    raise ValueError("Reporting mask differs from the immutable grid definition")
                datasets = {}
                for run in runs:
                    datasets[run["id"]] = {}
                    for name in outputs:
                        dataset = stack.enter_context(
                            rasterio.open(inputs["artifact_paths"][run["id"]][name]))
                        _same_grid(dataset, mask, run["id"] + "/" + name)
                        expected_units = MASS_UNITS[name]
                        if (run["artifacts"][name].get("units") != expected_units
                                or dataset.tags().get("units") != expected_units):
                            raise ValueError(
                                "Planning intake requires " + expected_units + " in both the "
                                "retained artifact and raster tags: " + run["id"] + "/" + name)
                        datasets[run["id"]][name] = dataset
                raster_dtypes = {run["id"]: {name: datasets[run["id"]][name].dtypes[0]
                                  for name in outputs} for run in runs}
                reporting_rows, _ = vector_geometry(inputs["reporting_area"], target_crs=grid_crs)
                reporting_geometry = polygon_union(reporting_rows)
                stack.enter_context(vector_environment())
                chosen_layer = selection.get("layer") or inputs["entry"].get("layer")
                kwargs = {"layer": chosen_layer} if chosen_layer else {}
                features = stack.enter_context(fiona.open(
                    native_vector_path(inputs["source_path"]), **kwargs))
                source_crs = CRS.from_user_input(features.crs_wkt or features.crs)
                transformer = Transformer.from_crs(source_crs, grid_crs, always_xy=True)
                source_field = selection.get("feature_id_field")
                if source_field and source_field not in features.schema["properties"]:
                    raise ValueError("Original feature ID field does not exist: " + source_field)
                source = {
                    "selection": _source_selection(selection),
                    "entry": inputs["entry"],
                    "sha256": inputs["entry"]["body"]["sha256"],
                    "crs": source_crs.to_wkt(),
                    "layer": features.name,
                    "original_geometry": {
                        "policy": "Original source geometry and all native sidecars remain retained byte for byte.",
                        "body": inputs["entry"]["body"],
                        "companions": inputs["entry"].get("companions", []),
                        "feature_reference": "source_feature_id is the original Fiona feature ID",
                    },
                    "original_schema": features.schema,
                }
                fd, name = tempfile.mkstemp(prefix=".units-", suffix=".csv", dir=directory)
                pending = Path(name)
                csvfile = stack.enter_context(os.fdopen(fd, "w", encoding="utf-8", newline=""))
                writer = csv.DictWriter(csvfile, fieldnames=FIELDS, lineterminator="\n")
                writer.writeheader()
                seen = set()
                for feature in features:
                    counters["original_features"] += 1
                    properties = dict(feature["properties"])
                    if selection.get("where") and any(properties.get(k) != v
                            for k, v in selection["where"].items()):
                        continue
                    counters["selected_features"] += 1
                    original_id = str(feature.id)
                    raw_id = properties.get(source_field) if source_field else original_id
                    if raw_id is None or isinstance(raw_id, (bool, dict, list)):
                        raise ValueError("Original feature identity is missing or is not a scalar")
                    feature_id = str(raw_id)
                    if not feature_id.strip() or feature_id in seen:
                        raise ValueError("Original feature IDs must be nonempty and unique: " + feature_id)
                    seen.add(feature_id)
                    attributes_json = _json(properties)
                    if not feature["geometry"]:
                        raise ValueError("Original feature has no polygon geometry: " + feature_id)
                    original_geometry = shape(feature["geometry"])
                    if (original_geometry.geom_type not in ("Polygon", "MultiPolygon")
                            or original_geometry.is_empty or not original_geometry.is_valid):
                        raise ValueError("Original feature requires an explicit geometry correction: " + feature_id)
                    geometry = (transform(transformer.transform, original_geometry)
                                if source_crs != grid_crs else original_geometry)
                    if not geometry.is_valid or geometry.is_empty:
                        raise ValueError("Original feature cannot be represented on the model CRS: " + feature_id)
                    area_ha = float(geometry.area / 10000)
                    if not math.isfinite(area_ha) or area_ha <= 0:
                        raise ValueError("Original feature has invalid projected area: " + feature_id)
                    if not geometry.intersects(reporting_geometry):
                        counters["outside_reporting_area"] += 1
                        continue
                    reporting_intersection = geometry.intersection(reporting_geometry)
                    reporting_area_ha = float(reporting_intersection.area / 10000)
                    if not math.isfinite(reporting_area_ha):
                        raise ValueError("Reporting intersection area is not finite")
                    if reporting_area_ha <= 0:
                        counters["outside_reporting_area"] += 1
                        continue
                    totals = {run["id"]: {name: 0.0 for name in outputs} for run in runs}
                    encoding = {run["id"]: {name: 0.0 for name in outputs} for run in runs}
                    reporting_pixels = valid_pixels = 0
                    for window in _window_tiles(reporting_intersection.bounds, mask):
                        window_shape = (int(window.height), int(window.width))
                        inside = geometry_mask([mapping(geometry)], out_shape=window_shape,
                            transform=window_transform(window, mask.transform),
                            all_touched=False, invert=True)
                        reporting_values = read_cache.read(mask, window, label="reporting_mask")
                        inside &= (~np.ma.getmaskarray(reporting_values)
                                   & (np.ma.getdata(reporting_values) == 1))
                        reporting_pixels += int(inside.sum())
                        if not np.any(inside):
                            continue
                        common = inside.copy()
                        values = {}
                        for run in runs:
                            values[run["id"]] = {}
                            for pollutant in outputs:
                                data = read_cache.read(datasets[run["id"]][pollutant], window,
                                                       label=run["id"] + "/" + pollutant)
                                raw = np.ma.getdata(data).astype("float64")
                                valid = ~np.ma.getmaskarray(data) & np.isfinite(raw)
                                if np.any(raw[inside & valid] < 0):
                                    raise ValueError("Native annual export contains negative retained mass")
                                common &= valid
                                values[run["id"]][pollutant] = raw
                        valid_pixels += int(common.sum())
                        for run in runs:
                            for pollutant in outputs:
                                cell_values = values[run["id"]][pollutant][common]
                                totals[run["id"]][pollutant] += float(cell_values.sum(dtype="float64"))
                                encoding[run["id"]][pollutant] += _encoding_half_ulp(
                                    cell_values, datasets[run["id"]][pollutant].dtypes[0])
                    if not reporting_pixels:
                        counters["features_without_reporting_pixels"] += 1
                    if not valid_pixels:
                        counters["features_without_common_valid_pixels"] += 1
                    coverage = valid_pixels / reporting_pixels if reporting_pixels else 0.0
                    min_coverage = coverage if min_coverage is None else min(min_coverage, coverage)
                    max_coverage = coverage if max_coverage is None else max(max_coverage, coverage)
                    pixel_counts["reporting_pixels"] += reporting_pixels
                    pixel_counts["common_valid_pixels"] += valid_pixels
                    row = {
                        "feature_id": feature_id, "source_feature_id": original_id,
                        "original_attributes": attributes_json, "area_ha": area_ha,
                        "reporting_area_ha": reporting_area_ha,
                        "reporting_pixels": reporting_pixels, "valid_pixels": valid_pixels,
                        "coverage_fraction": coverage, **CONTEXT,
                    }
                    for name, (_, field, _) in METRICS.items():
                        row[field] = totals[baseline["id"]].get(name) if valid_pixels else None
                    changes = {}
                    for run in runs[1:]:
                        changes[run["id"]] = {
                            name: (totals[run["id"]][name] - totals[baseline["id"]][name]
                                              if valid_pixels else None)
                            for name in outputs
                        }
                    row["scenario_changes"] = _json(changes)
                    row["scenario_precision"] = _json({
                        run["id"]: {
                            name: (_change_precision(
                                totals[baseline["id"]][name], totals[run["id"]][name],
                                encoding[baseline["id"]][name], encoding[run["id"]][name],
                                valid_pixels) if valid_pixels else None)
                            for name in outputs}
                        for run in runs[1:]})
                    if any(not math.isfinite(total) for total in
                           (value for group in totals.values() for value in group.values())):
                        raise ValueError("Retained feature mass aggregation overflowed")
                    writer.writerow(row)
                    counters["retained_features"] += 1
                csvfile.flush()
                os.fsync(csvfile.fileno())
            if not counters["retained_features"]:
                raise ValueError("No selected original polygon intersects the retained reporting area")
            destination = directory / "planning-units.csv"
            _commit_csv(pending, destination)
            pending = None
            coverage = {
                **counters, **pixel_counts, "minimum_feature_fraction": min_coverage,
                "maximum_feature_fraction": max_coverage, "support": SUPPORT,
                "count_note": "Counts sum independently summarized features and may include overlap.",
            }
            csv_description = describe_file(workspace.root, destination)
            inventory = {
                "schema": SCHEMA, "method": METHOD, "selection": selection,
                "selection_id": inputs["selection_id"], "unit_kind": selection["unit_kind"],
                "baseline_run_id": baseline["id"], "grid_id": inputs["grid_id"],
                "profile_id": inputs["profile_id"], "source": source,
                "available_metrics": list(outputs),
                "features": counters["retained_features"],
                "physical_units": {name: METRICS[name][2] for name in outputs},
                "scenario_direction": "alternative minus baseline",
                "run_selections": {run["id"]: run["selection"] for run in runs},
                "run_models": {run["id"]: list(run_models(run)) for run in runs},
                "native_inputs": inputs["identity"], "coverage": coverage,
                "native_versions": inputs["native_versions"],
                "native_version": inputs["native_version"],
                "overlap_handling": OVERLAP, "context": CONTEXT,
                "computation_crs": inputs["grid"]["grid"]["crs"],
                "area_method": "Original polygons projected to the retained metre CRS; geometric hectares.",
                "mass_method": "Float64 sums of retained annual mass per pixel, with no further area conversion.",
                "precision_method": PRECISION_METHOD,
                "raster_dtypes": raster_dtypes,
                "csv_fields": list(FIELDS), "files": {"csv": csv_description},
            }
            inventory_path = directory / "inventory.json"
            atomic_json(inventory_path, inventory, immutable=True)
            record = workspace._save(KIND, {
                "title": selection["title"], "selection": selection,
                "selection_id": inputs["selection_id"], "unit_kind": selection["unit_kind"],
                "baseline_run_id": baseline["id"], "grid_id": inputs["grid_id"],
                "profile_id": inputs["profile_id"], "source": source,
                "available_metrics": list(outputs), "coverage": coverage,
                "features": counters["retained_features"],
                "scenario_direction": inventory["scenario_direction"],
                "native_versions": inputs["native_versions"],
                "native_version": inputs["native_version"],
                "overlap_handling": OVERLAP,
                "files": {"csv": csv_description,
                          "inventory": describe_file(workspace.root, inventory_path)},
            })
            atomic_json(directory / "read-processing.json", {
                "schema": "upstate.planning-raster-reads/v1",
                "inventory_id": record["id"], "selection_id": inputs["selection_id"],
                "csv_sha256": csv_description["sha256"],
                "elapsed_seconds": time.monotonic() - started,
                "reads": read_cache.snapshot(),
            })
            atomic_json(completed, {"id": record["id"]}, immutable=True)
            return record
        finally:
            if pending is not None:
                pending.unlink(missing_ok=True)


def _verify_native_binding(record, inventory, inputs):
    """Reopen the exact saved identity while checking its current version cohort."""
    retained = inventory["native_inputs"]
    current = inputs["identity"]
    bound = "native_versions" in retained
    fields = ("native_versions", "native_version")
    if bound:
        for name in fields:
            if (name not in record or name not in inventory
                    or record[name] != inputs[name] or inventory[name] != inputs[name]):
                raise ValueError("Planning inventory native-version provenance changed: " + name)
    else:
        # Original inventories predate version binding. Keep their exact body,
        # selection ID and result files; _inputs still validates this cohort.
        if any(name in record or name in inventory for name in fields):
            raise ValueError("Planning inventory has incomplete native-version binding")
        current = {name: value for name, value in current.items()
                   if name != "native_versions"}
    if current != retained or digest(current) != record["selection_id"]:
        raise ValueError("Original native run or polygon source identity changed")


def inspect(workspace, inventory_id):
    """Verify saved identity, both artifacts, original sources and current native inputs."""
    record = workspace._get(KIND, identifier(inventory_id))
    if record.get("schema") != "upstate.planning-inventories/v1":
        raise ValueError("Select an original native planning inventory")
    inventory_path = verify_file(workspace.root, record["files"]["inventory"])
    verify_file(workspace.root, record["files"]["csv"])
    inventory = read_json(inventory_path)
    if inventory.get("schema") != SCHEMA or inventory.get("method") not in (METHOD, LEGACY_METHOD):
        raise ValueError("Planning inventory artifact schema differs")
    for key in ("selection", "selection_id", "unit_kind", "baseline_run_id", "grid_id",
                "profile_id", "source", "available_metrics", "features", "coverage",
                "scenario_direction", "overlap_handling"):
        if inventory.get(key) != record.get(key):
            raise ValueError("Planning inventory metadata differs: " + key)
    if inventory["files"]["csv"] != record["files"]["csv"]:
        raise ValueError("Planning inventory CSV identity differs")
    selection = _selection(record["selection"])
    if selection != record["selection"]:
        raise ValueError("Planning selection was not normalized")
    inputs = _inputs(workspace, selection, method=inventory["method"])
    _verify_native_binding(record, inventory, inputs)
    return record


def read_processing(workspace, inventory_id):
    """Read operational counters separately from immutable scientific identities."""
    record = workspace._get(KIND, identifier(inventory_id))
    if record.get("schema") != "upstate.planning-inventories/v1":
        raise ValueError("Select an original native planning inventory")
    path = (workspace.root / "planning-inventory-data" / identifier(record["selection_id"])
            / "read-processing.json")
    if not path.exists():
        return {"status": "not-recorded", "inventory_id": record["id"]}
    result = read_json(path)
    if (result.get("schema") != "upstate.planning-raster-reads/v1"
            or result.get("inventory_id") != record["id"]
            or result.get("selection_id") != record["selection_id"]
            or result.get("csv_sha256") != record["files"]["csv"]["sha256"]):
        raise ValueError("Planning read counters belong to another retained inventory")
    return result
