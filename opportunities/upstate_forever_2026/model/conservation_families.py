"""Matched native family quantities on independent, retained pollutant footprints.

This is a spatial projection of completed original NDR/SDR results. It neither
starts a model nor treats parameter cases as probabilities or additive actions.
"""
from __future__ import annotations

from copy import deepcopy
import math
import os
from pathlib import Path
import tempfile

from .common import atomic_json, describe_file, digest, identifier, read_json, verify_file

SCHEMA = "upstate.conservation-matched-family-support/v1"
METHOD = "all-declared-pairs-per-pollutant/1"
KINDS = ("matched-restoration", "matched-disturbance")


def normalize(values):
    if not isinstance(values, list):
        raise ValueError("Matched families must be an explicit list")
    result, seen, pairs = [], set(), set()
    for value in values:
        if not isinstance(value, dict) or set(value) - {
                "id", "label", "baseline_run_id", "alternative_run_id", "reason", "reference"}:
            raise ValueError("A matched family needs ID, label, baseline, alternative and reason")
        row = {}
        for name in ("id", "label", "reason"):
            item = value.get(name)
            if not isinstance(item, str) or not item.strip():
                raise ValueError("Matched family " + name + " needs nonempty text")
            row[name] = item.strip()
        if row["id"] in seen:
            raise ValueError("Matched family IDs must be unique")
        seen.add(row["id"])
        for name in ("baseline_run_id", "alternative_run_id"):
            row[name] = identifier(value.get(name))
        if row["baseline_run_id"] == row["alternative_run_id"]:
            raise ValueError("Matched family " + row["id"] + " needs distinct original runs")
        pair = (row["baseline_run_id"], row["alternative_run_id"])
        if pair in pairs:
            raise ValueError("The same original run pair cannot be repeated under another matched-family ID")
        pairs.add(pair)
        if value.get("reference") is not None:
            if not isinstance(value["reference"], str) or not value["reference"].strip():
                raise ValueError("Matched family reference must be nonempty text")
            row["reference"] = value["reference"].strip()
        result.append(row)
    return result


def run_ids(spec):
    return list(dict.fromkeys(
        run_id for family in spec.get("matched_families", [])
        for run_id in (family["baseline_run_id"], family["alternative_run_id"])))


def validate(spec, runs):
    """Require real within-pair profile/grid identities, never title inference."""
    for family in spec.get("matched_families", []):
        a, b = (runs[key]["selection"] for key in
                (family["baseline_run_id"], family["alternative_run_id"]))
        for field in ("grid_id", "profile_id"):
            av, bv = a.get(field), b.get(field)
            if not isinstance(av, str) or not av or not isinstance(bv, str) or not bv:
                raise ValueError("Matched family " + family["id"] +
                                 " lacks an original " + field + " in a retained run selection")
            if av != bv:
                raise ValueError("Matched family " + family["id"] +
                                 " has different original " + field + " values")
        for selection in (a, b):
            if not isinstance(selection.get("scenario_id"), str) or not selection["scenario_id"]:
                raise ValueError("Matched family " + family["id"] +
                                 " lacks its original scenario identity")


def _selection(state):
    spec = state["selection"]["spec"]
    ids = run_ids(spec)
    return {
        "method": METHOD, "study_id": state["id"],
        "policy": "independent-per-pollutant",
        "families": deepcopy(spec["matched_families"]),
        "run_ids": ids,
        "runs": {key: deepcopy(state["selection"]["bindings"]["runs"][key]) for key in ids},
        "grid": deepcopy(state["selection"]["bindings"]["grid"]),
        "codes": {"0": "outside common support", "1": "finite valid rate in every declared run",
                  "2": "verified structural stream omission in every declared run"},
        "coverage": "Codes 1 and 2; only code 1 contributes mass. Mixed valid/structural cells are excluded.",
    }


def _verify(workspace, state, value, *, check_masks=True):
    if value.get("schema") != SCHEMA or value.get("selection") != _selection(state):
        raise ValueError("The matched-family support belongs to different retained inputs")
    if value.get("id") != digest({key: val for key, val in value.items() if key != "id"}):
        raise ValueError("The retained matched-family support record changed")
    from .conservation import POLLUTANTS
    if set(value.get("metrics", {})) != set(POLLUTANTS):
        raise ValueError("The matched-family support lost its separate pollutant inventory")
    for metric in value["metrics"].values():
        if check_masks and metric.get("mask") is not None:
            verify_file(workspace.root, metric["mask"])
    return value


def inspect_support(workspace, state):
    """Verify the small immutable source record without rehashing every raster."""
    descriptor = state["files"].get("matched_family_support")
    if not isinstance(descriptor, dict):
        raise ValueError("The completed matched-family study lost its support record")
    retained = read_json(verify_file(workspace.root, descriptor))
    if retained != state.get("matched_family_support"):
        raise ValueError("The saved study differs from its immutable matched-family support")
    return _verify(workspace, state, retained, check_masks=False)


def ensure_support(workspace, state, reference, datasets):
    """Materialize one bounded-memory original-grid mask per selected pollutant."""
    import numpy as np
    import rasterio
    from .conservation import POLLUTANTS
    selection = _selection(state)
    directory = Path(workspace.root) / "conservation" / state["id"]
    path = directory / "matched-family-support.json"
    if path.exists():
        return _verify(workspace, state, read_json(path))
    if reference is None:
        raise ValueError("Matched families require completed native raster outputs")
    ids = selection["run_ids"]
    metrics = {}
    for pollutant, (_, _, unit) in POLLUTANTS.items():
        missing = [key for key in ids if pollutant not in datasets[key]]
        if missing:
            metrics[pollutant] = {
                "state": "not_shared", "unit": unit, "run_ids": ids,
                "missing_run_ids": missing, "mask": None, "valid_cells": None,
                "structural_cells": None, "grid_cells": reference.width * reference.height,
                "reason": "The pollutant was not selected in every declared matched-family run",
            }
            continue
        target = directory / ("matched-support-" + pollutant + ".tif")
        fd, temporary = tempfile.mkstemp(prefix=target.stem + "-", suffix=".tif", dir=directory)
        os.close(fd)
        valid_cells, structural_cells = 0, 0
        profile = reference.profile.copy()
        profile.update(driver="GTiff", count=1, dtype="uint8", nodata=0, compress="deflate")
        # Floating-rate predictor settings do not apply to a categorical byte mask.
        profile.pop("predictor", None)
        try:
            with rasterio.open(temporary, "w", **profile) as out:
                for _, window in reference.block_windows(1):
                    shape = (int(window.height), int(window.width))
                    common = np.ones(shape, dtype=bool)
                    structural = np.ones(shape, dtype=bool)
                    for key in ids:
                        rate = datasets[key][pollutant]["rate"].read(1, window=window, masked=True)
                        stream = datasets[key][pollutant]["stream"].read(1, window=window, masked=True)
                        raw = np.ma.getdata(rate)
                        masked = np.ma.getmaskarray(rate)
                        valid = ~masked & np.isfinite(raw)
                        if np.any(raw[valid] < 0):
                            raise ValueError("Native export contains negative rates: " + key + " " + pollutant)
                        omitted = (masked & ~np.ma.getmaskarray(stream)
                                   & np.isfinite(np.ma.getdata(stream)) & (np.ma.getdata(stream) == 1))
                        common &= valid
                        structural &= omitted
                    codes = np.zeros(shape, dtype="uint8")
                    codes[common] = 1
                    codes[structural] = 2
                    valid_cells += int(np.count_nonzero(common))
                    structural_cells += int(np.count_nonzero(structural))
                    out.write(codes, 1, window=window)
                out.update_tags(method=METHOD, support_selection_sha256=digest(selection),
                                pollutant=pollutant, interpretation="1=valid;2=structural;0=excluded")
            os.replace(temporary, target)
        finally:
            if os.path.exists(temporary):
                os.unlink(temporary)
        cell_ha = abs(reference.transform.a * reference.transform.e) / 10000
        metrics[pollutant] = {
            "state": "complete", "unit": unit, "run_ids": ids, "missing_run_ids": [],
            "mask": describe_file(workspace.root, target),
            "valid_cells": valid_cells, "structural_cells": structural_cells,
            "grid_cells": reference.width * reference.height,
            "grid_valid_area_ha": valid_cells * cell_ha,
            "grid_structural_area_ha": structural_cells * cell_ha,
            "grid_covered_area_ha": (valid_cells + structural_cells) * cell_ha,
            "area_scope": "Original complete model grid; polygon-intersection areas are retained separately per unit and union",
        }
    value = {"schema": SCHEMA, "selection": selection, "metrics": metrics}
    value["id"] = digest(value)
    atomic_json(path, value, immutable=True)
    return value


def attach_support(workspace, state, reference, datasets, stack):
    import rasterio
    from . import rasters
    value = state.get("matched_family_support")
    if value is None:
        raise ValueError("The matched-family study has not retained its common-support masks")
    _verify(workspace, state, value)
    opened = {}
    for pollutant, metric in value["metrics"].items():
        if metric["mask"] is not None:
            path = verify_file(workspace.root, metric["mask"])
            opened[pollutant] = stack.enter_context(rasterio.open(path))
            rasters.check_same_grid(reference, opened[pollutant])
            if opened[pollutant].count != 1 or opened[pollutant].dtypes[0] != "uint8":
                raise ValueError("The retained matched-family support is not its original categorical mask")
    datasets["_matched_family_support"] = {"record": value, "datasets": opened}


def aggregate(reference, datasets, geometry, spec):
    """Use the same all-family footprint for every paired effect of a pollutant."""
    import numpy as np
    from .conservation import _area_windows, POLLUTANTS
    retained = datasets.get("_matched_family_support")
    if retained is None:
        raise ValueError("Open the retained matched-family masks before projecting quantities")
    families = spec["matched_families"]
    ids = run_ids(spec)
    area_ha = geometry.area / 10000
    totals = {
        axis: {"valid": 0., "structural": 0., "observed": False,
               "mass": {key: 0. for key in ids}}
        for axis in retained["datasets"]
    }
    for window, weights in _area_windows(reference, geometry):
        inside = weights > 0
        hectares = weights / 10000
        for axis, mask in retained["datasets"].items():
            codes = mask.read(1, window=window, masked=False)
            if np.any((codes != 0) & (codes != 1) & (codes != 2)):
                raise ValueError("The matched-family mask contains an unknown support code")
            common, structural = inside & (codes == 1), inside & (codes == 2)
            total = totals[axis]
            total["valid"] += float(np.sum(hectares[common], dtype="float64"))
            total["structural"] += float(np.sum(hectares[structural], dtype="float64"))
            total["observed"] = total["observed"] or bool(np.any(common))
            for key in ids:
                rate = datasets[key][axis]["rate"].read(1, window=window, masked=True)
                raw = np.ma.getdata(rate)
                if np.any(common & (np.ma.getmaskarray(rate) | ~np.isfinite(raw) | (raw < 0))):
                    raise ValueError("A bound native rate no longer agrees with its retained common footprint")
                total["mass"][key] += float(np.sum(raw[common] * hectares[common], dtype="float64"))
    result = {}
    for axis, (_, _, unit) in POLLUTANTS.items():
        support = retained["record"]["metrics"][axis]
        total = totals.get(axis)
        covered = total["valid"] + total["structural"] if total is not None else None
        coverage = min(1., max(0., covered / area_ha)) if covered is not None and area_ha > 0 else None
        observed = total is not None and total["observed"]
        values = {}
        for family in families:
            base = total["mass"][family["baseline_run_id"]] if observed else None
            other = total["mass"][family["alternative_run_id"]] if observed else None
            delta = other - base if observed else None
            if observed and not all(math.isfinite(number) for number in (base, other, delta)):
                raise ValueError("The matched-family mass exceeds finite numeric representation")
            values[family["id"]] = {
                "family_id": family["id"], "baseline_run_id": family["baseline_run_id"],
                "alternative_run_id": family["alternative_run_id"], "unit": unit,
                "comparison_availability": "modeled" if observed else
                    "no_common_valid_cells" if total is not None else "not_shared",
                "comparison_availability_reason": None if observed else
                    "No common finite-rate cells intersect this reporting footprint" if total is not None else support["reason"],
                "common_baseline": base, "common_alternative": other,
                "delta": delta, "reduction": -delta if delta is not None else None,
                "common_coverage_fraction": coverage,
                "common_valid_area_ha": total["valid"] if total is not None else None,
                "common_structural_stream_area_ha": total["structural"] if total is not None else None,
                "common_covered_area_ha": covered, "selected_area_ha": area_ha,
                "missing_area_ha": max(0., area_ha - covered) if covered is not None else None,
                "support_id": retained["record"]["id"],
                "support_sha256": support["mask"]["sha256"] if support["mask"] else None,
                "support_ref": "/matched_family_support/metrics/" + axis,
                "profile_changed": False,
            }
        result[axis] = values
    return result


def family(study, family_id):
    rows = {row["id"]: row for row in study["selection"]["spec"].get("matched_families", [])}
    if family_id not in rows:
        raise ValueError("Choose a matched family already retained by this Conservation study")
    return rows[family_id]


def available(study, family_id):
    family(study, family_id)
    value = study.get("matched_family_support")
    if not isinstance(value, dict):
        raise ValueError("Complete the retained matched-family study before selecting its quantities")
    return tuple(axis for axis, metric in value["metrics"].items() if metric["state"] == "complete")


def binding(study, family_id, axis):
    row = family(study, family_id)
    runs = study["selection"]["bindings"]["runs"]
    return {
        "family": deepcopy(row),
        "baseline_run_id": row["baseline_run_id"], "baseline": deepcopy(runs[row["baseline_run_id"]]),
        "alternative_run_id": row["alternative_run_id"], "alternative": deepcopy(runs[row["alternative_run_id"]]),
        "support_id": study["matched_family_support"]["id"],
        "support": deepcopy(study["matched_family_support"]["metrics"][axis]),
        "support_policy": "Independent all-declared-family common footprint for this pollutant",
    }
