"""Reopen the original source-edition comparison without rerunning native models.

The producer has already checked geographic equality and calculated the common
finite support. This reader binds that receipt to the same saved input editions,
support/output bytes, producing native versions and retained delta artifacts.
"""
from __future__ import annotations

import math

from .common import digest, identifier, verify_file
from .model_selection import common_comparison_outputs
from .rasters import MASS_UNITS

DIRECTION = "alternative minus baseline"
SCOPE = "common-finite-support/v2"
CONTEXT_SCHEMA = "upstate.source-refresh-comparison-context/v1"
SUPPORT_NAMES = ("model_domain", "reporting_area", "reporting_mask")
COVERAGE_COUNTS = ("common_valid_cells", "baseline_only_cells",
                   "alternative_only_cells", "neither_valid_cells")
SCOPE_DESCRIPTION = (
    "Identical model domain, reporting partitions and reporting mask; alternative "
    "minus baseline on common finite output cells with explicit excluded coverage")


def _number(value, label, *, positive=False):
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(label + " must retain a finite number")
    if not math.isfinite(value) or (positive and value <= 0):
        raise ValueError(label + " must retain a finite positive number" if positive
                         else label + " must retain a finite number")
    return value


def _count(value, label, *, positive=False):
    if isinstance(value, bool) or not isinstance(value, int) or value < int(positive):
        raise ValueError(label + " must retain a nonnegative integer" if not positive
                         else label + " must retain a positive integer")
    return value


def _equal_number(value, expected, label):
    value = _number(value, label)
    if not math.isclose(value, expected, rel_tol=1e-12, abs_tol=1e-9):
        raise ValueError(label + " differs from the retained grid or support")


def _grid_definition(grid):
    value = grid["grid"]
    transform = value.get("transform")
    if not isinstance(transform, (list, tuple)) or len(transform) not in (6, 9):
        raise ValueError("Source-update comparison grid has no original affine transform")
    affine = tuple(_number(item, "Grid transform") for item in transform[:6])
    width = _count(value.get("width"), "Grid width", positive=True)
    height = _count(value.get("height"), "Grid height", positive=True)
    resolution = _number(value.get("resolution_m"), "Grid resolution", positive=True)
    if not value.get("crs"):
        raise ValueError("Source-update comparison grid has no original CRS")
    return value["crs"], affine, width, height, resolution


def _lattice(before, after, support):
    left, right = _grid_definition(before), _grid_definition(after)
    if left[1:] != right[1:]:
        raise ValueError("Source-update comparison changed its actual grid lattice")
    # Normal cold receiving needs only the exact original CRS representation.
    # The saved comparison already measured its projected unit and pixel area;
    # these remain bound to the original support bodies and coverage receipt.
    area = _number(support.get("pixel_area_m2"), "Comparison pixel area", positive=True)
    unit = support.get("coordinate_linear_unit")
    if not isinstance(unit, str) or not unit.strip():
        raise ValueError("Source-update comparison lost its original coordinate unit")
    affine = left[1]
    coordinate_area = abs(affine[0] * affine[4] - affine[1] * affine[3])
    _number(coordinate_area, "Actual coordinate pixel area", positive=True)
    if left[0] != right[0]:
        # Only a differing encoding needs the maintained optional CRS parser.
        # Identical original CRS strings never import GIS/native packages.
        from rasterio.crs import CRS
        crs = CRS.from_user_input(left[0])
        if crs != CRS.from_user_input(right[0]) or not crs.is_projected:
            raise ValueError("Source-update comparison needs the same projected CRS")
        actual_unit, metres_per_unit = crs.linear_units_factor
        _equal_number(area, coordinate_area * float(metres_per_unit) ** 2,
                      "Comparison pixel area")
        if unit != actual_unit:
            raise ValueError("Source-update comparison changed its coordinate unit")
    return left[2] * left[3], area


def _fingerprint(root, descriptor, *, units=None):
    if not isinstance(descriptor, dict):
        raise ValueError("Source-update comparison lacks an original file descriptor")
    verify_file(root, descriptor)
    result = {"sha256": descriptor["sha256"], "bytes": descriptor["bytes"]}
    if units is not None:
        if descriptor.get("units") != units:
            raise ValueError("Source-update native output units changed")
        result["units"] = units
    return result


def _support_fingerprints(workspace, grid):
    result = {}
    for name in SUPPORT_NAMES:
        suffix = ".tif" if name == "reporting_mask" else ".gpkg"
        descriptor = grid["files"].get(name, grid["files"].get(name + suffix))
        result[name] = _fingerprint(workspace.root / "grids" / grid["id"], descriptor)
    return result


def _source_bindings(workspace, run, grid):
    """Read original immutable native selections, including table/mask sources."""
    result = {grid["spec"].get("source_collection_id")}
    for kind, field in (("profiles", "profile_id"), ("scenarios", "scenario_id")):
        value = workspace._get(kind, identifier(run["selection"][field]))
        result.add(value.get("source_collection_id"))
    return result - {None}


def _coverage(comparison, alternative, names, total_cells, pixel_area):
    support = comparison["spatial_support"]
    if (support.get("domain_union_equal") is not True
            or support.get("reporting_partitions_equal") is not True):
        raise ValueError("Source-update comparison lacks its original geographic checks")
    reporting = _count(support.get("reporting_mask_cells"), "Reporting cells", positive=True)
    if reporting > total_cells:
        raise ValueError("Source-update reporting support exceeds its actual grid")
    if (set(support.get("native_valid_cells", {})) != set(names)
            or set(support.get("native_coverage", {})) != set(names)):
        raise ValueError("Source-update comparison changed its native coverage cohort")
    for name in names:
        coverage = support["native_coverage"][name]
        counts = {field: _count(coverage.get(field), name + " " + field,
                               positive=field == "common_valid_cells")
                  for field in COVERAGE_COUNTS}
        if sum(counts.values()) != total_cells:
            raise ValueError("Source-update native coverage does not partition its original grid")
        if (coverage.get("scope") != "Entire aligned native output raster"
                or coverage.get("summed_mass_units") != MASS_UNITS[name].replace("/pixel", "")):
            raise ValueError("Source-update native coverage changed its support or annual mass units")
        _equal_number(coverage.get("pixel_area_m2"), pixel_area, name + " pixel area")
        for field in ("baseline_only_mass", "alternative_only_mass"):
            _number(coverage.get(field), name + " " + field)
        expected_areas = {field.removesuffix("_cells"): count * pixel_area
                          for field, count in counts.items()}
        areas = coverage.get("areas_m2", {})
        if set(areas) != set(expected_areas):
            raise ValueError("Source-update comparison changed its coverage-area fields")
        for field, area in expected_areas.items():
            _equal_number(areas[field], area, name + " " + field + " area")
        valid = _count(support["native_valid_cells"][name], name + " common cells", positive=True)
        descriptor = alternative["artifacts"][name]
        if (valid != counts["common_valid_cells"]
                or _count(descriptor.get("valid_cells"), name + " difference cells", positive=True) != valid
                or descriptor.get("coverage") != coverage
                or descriptor.get("direction") != DIRECTION
                or descriptor.get("units") != MASS_UNITS[name]):
            raise ValueError("Source-update difference no longer binds its common finite support")
        _number(descriptor.get("sum_change"), name + " summed annual mass change")


def validate(workspace, comparison, *, expected_id=None):
    """Validate a retained common-finite-support/v2 comparison and return it.

    This accepts the producer's exact original format, including partial-model
    comparisons. It reads saved records and hashes retained bodies; it does not
    calculate a new geometry intersection, raster difference or native run.
    """
    from .native_versions import comparison_versions, models_for_outputs
    if (not isinstance(comparison, dict)
            or comparison.get("schema") != "upstate.run-comparison/v1"
            or comparison.get("direction") != DIRECTION):
        raise ValueError("Select the original source-update run comparison")
    key = identifier(comparison.get("id"))
    if expected_id is not None and key != identifier(expected_id):
        raise ValueError("The original source-update comparison identity differs")
    alternatives = comparison.get("alternatives")
    if not isinstance(alternatives, list) or len(alternatives) != 1 or not isinstance(alternatives[0], dict):
        raise ValueError("Source-update comparison requires its one original successor")
    alternative = alternatives[0]
    ids = [identifier(comparison.get("baseline_run_id")), identifier(alternative.get("run_id"))]
    if ids[0] == ids[1]:
        raise ValueError("Source-update comparison requires distinct original and successor runs")
    runs = [workspace.inspect_run(run_id) for run_id in ids]
    if any(run.get("id") != run_id or run.get("state") != "complete"
           for run_id, run in zip(ids, runs)):
        raise ValueError("Finish the original source-update native run cohort")
    outputs = sorted(common_comparison_outputs(runs))
    if not outputs or any(sorted(set(run.get("artifacts", {})) & set(MASS_UNITS)) != outputs
                          for run in runs):
        raise ValueError("Source-update comparison requires the same complete native output scope")
    versions = comparison_versions(runs, models_for_outputs(outputs))
    identity = {"runs": ids, "direction": DIRECTION,
                "source_refresh_scope": SCOPE, "native_version_provenance": versions}
    if digest(identity) != key or comparison.get("native_version_provenance") != versions:
        raise ValueError("Source-update comparison changed its native run/version cohort")
    if "common_artifacts" in comparison and sorted(comparison["common_artifacts"]) != outputs:
        raise ValueError("Source-update comparison changed its declared output scope")
    if (alternative.get("selection") != runs[1]["selection"]
            or alternative.get("profile_changed") !=
                (runs[1]["selection"]["profile_id"] != runs[0]["selection"]["profile_id"])
            or set(alternative.get("artifacts", {})) != set(outputs)):
        raise ValueError("Source-update comparison changed its original successor selection")
    context = comparison.get("source_refresh_context")
    support = comparison.get("spatial_support")
    if not isinstance(context, dict) or not isinstance(support, dict):
        raise ValueError("Source-update comparison lacks its original source/support context")
    source_ids = [identifier(context.get(field))
                  for field in ("from_collection_id", "to_collection_id")]
    if source_ids[0] == source_ids[1]:
        raise ValueError("Source-update comparison needs its two distinct retained source editions")
    grids = [workspace.get_grid(identifier(run["selection"]["grid_id"])) for run in runs]
    for source_id, run, grid in zip(source_ids, runs, grids):
        workspace._get("sources", source_id)
        if source_id not in _source_bindings(workspace, run, grid):
            raise ValueError("Source-update comparison source edition is not bound to its original native selection")
    expected_context = {
        "schema": CONTEXT_SCHEMA, "from_collection_id": source_ids[0], "to_collection_id": source_ids[1],
        "baseline_grid_id": grids[0]["id"], "alternative_grid_id": grids[1]["id"],
        "native_artifacts": outputs, "native_version_provenance": versions,
        "baseline_models": runs[0]["selection"].get("models"),
        "alternative_models": runs[1]["selection"].get("models"),
        "grid_support_fingerprints": {
            label: _support_fingerprints(workspace, grid)
            for label, grid in zip(("original", "replacement"), grids)},
        "native_output_fingerprints": {
            label: {name: _fingerprint(workspace.root / "runs" / run["id"],
                                      run["artifacts"][name], units=MASS_UNITS[name])
                    for name in outputs}
            for label, run in zip(("original", "replacement"), runs)},
        "comparison_scope": SCOPE_DESCRIPTION,
    }
    if context != expected_context:
        raise ValueError("Source-update comparison changed its retained source, support or output fingerprints")
    total_cells, pixel_area = _lattice(grids[0], grids[1], support)
    _coverage(comparison, alternative, outputs, total_cells, pixel_area)
    directory = workspace.root / "comparisons" / key
    for descriptor in alternative["artifacts"].values():
        verify_file(directory, descriptor)
    return comparison
