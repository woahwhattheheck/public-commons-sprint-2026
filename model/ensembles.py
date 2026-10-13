"""Source-aware paired parameter ensembles for the original watershed Workspace.

Each parameter member receives its own baseline and land-cover alternatives.
Native engines, source records, run recovery and comparison rasters stay in the
existing model. This module adds orchestration and physical paired summaries.
"""
from __future__ import annotations

from copy import deepcopy
import hashlib
import itertools
import json
import math
from pathlib import Path
import statistics

from .common import atomic_json, digest, held, now, read_json, verify_file
from .profiles import NDR_KEYS, SDR_KEYS, checked_parameters
from .model_selection import (MODEL_ORDER, common_comparison_outputs, grid_models,
                              normalize_selection, required_outputs, required_roles,
                              run_models, run_scope, selected)

POLLUTANTS = ("nitrogen_export", "phosphorus_export", "sediment_export")
CATALOG = {
    "schema": "upstate.parameter-catalog/v1",
    "invest_version": "3.20.0",
    "sources": [
        {"id": "ndr-source", "url": "https://github.com/natcap/invest/blob/3.20.0/src/natcap/invest/ndr/ndr.py",
         "git_blob": "f518b2867d4a327675fcb1c9b4ba56f29b12188d"},
        {"id": "sdr-source", "url": "https://github.com/natcap/invest/blob/3.20.0/src/natcap/invest/sdr/sdr.py",
         "git_blob": "0cac27add172011df367ff8026427dbbdbcda5b2"},
        {"id": "ndr-guide", "url": "https://storage.googleapis.com/releases.naturalcapitalproject.org/invest-userguide/latest/en/ndr.html",
         "accessed": "2026-10-12", "sections": ["Model parameter uncertainties", "Data Needs"]},
        {"id": "sdr-guide", "url": "https://storage.googleapis.com/releases.naturalcapitalproject.org/invest-userguide/latest/en/sdr.html",
         "accessed": "2026-10-12", "sections": ["Data Needs", "Calibration Parameters", "Sediment retention at the subwatershed level"]},
    ],
    "targets": {
        "ndr.threshold_flow_accumulation": {"units": "upstream cells", "meaning": "Stream extraction threshold; changes the flowpath endpoint."},
        "sdr.threshold_flow_accumulation": {"units": "upstream cells", "meaning": "Stream extraction threshold; changes the flowpath endpoint."},
        "ndr.flow_dir_algorithm": {"units": "choice", "options": ["mfd", "d8"], "meaning": "Native flow routing algorithm."},
        "sdr.flow_dir_algorithm": {"units": "choice", "options": ["mfd", "d8"], "meaning": "Native flow routing algorithm."},
        "ndr.k_param": {"units": "dimensionless", "meaning": "Shape of the nutrient delivery/connectivity relationship."},
        "sdr.k_param": {"units": "dimensionless", "meaning": "Shape of the sediment delivery/connectivity relationship."},
        "ndr.subsurface_critical_length_n": {"units": "m", "meaning": "Subsurface nitrogen retention length."},
        "ndr.subsurface_eff_n": {"units": "fraction", "meaning": "Maximum subsurface nitrogen retention efficiency."},
        "ndr.runoff_proxy_av": {"units": "same as runoff proxy", "meaning": "Explicit denominator of the runoff potential index. Omission uses the native raster mean."},
        "sdr.sdr_max": {"units": "fraction", "meaning": "Maximum sediment delivery ratio."},
        "sdr.ic_0_param": {"units": "dimensionless", "meaning": "Midpoint of the sediment delivery/connectivity relationship."},
        "sdr.l_max": {"units": "dimensionless", "meaning": "Maximum slope-length factor L, not a length in metres."},
    },
    "table_parameters": {
        "load_n": "kg/ha/year", "load_p": "kg/ha/year",
        "load_type_n": "application-rate or measured-runoff",
        "load_type_p": "application-rate or measured-runoff",
        "eff_n": "fraction", "eff_p": "fraction",
        "crit_len_n": "m", "crit_len_p": "m",
        "proportion_subsurface_n": "fraction", "usle_c": "fraction", "usle_p": "fraction",
    },
    "methods": {
        "landcover_effect": "Alternative minus baseline using one identical parameter profile and retained grid.",
        "parameter_effect": "Member baseline minus the first member baseline on their exact shared valid cells.",
        "range": "Minimum, median and maximum of completed members grouped by their exact shared-cell mask.",
        "table_variation": "Select retained profiles with independently sourced biophysical tables; preserve their load types and row lineage.",
        "source_values": "Axis values and references are supplied explicitly; the catalogue supplies parameter meanings.",
    },
}


STUDIES = [
    {
        "id": "routing-lmax-v1",
        "title": "Flow routing and slope length sensitivity",
        "question": "How do annual export and land-cover effects change across the native flow-routing choices and the documented maximum-L range?",
        "design": "factorial",
        "invest_version": "3.20.0",
        "axes": [
            {
                "id": "routing",
                "targets": [
                    "ndr.flow_dir_algorithm",
                    "sdr.flow_dir_algorithm"
                ],
                "values": [
                    "mfd",
                    "d8"
                ],
                "reason": "Compare the two supported native flow-routing algorithms, with the same routing choice in NDR and SDR for each parameter member.",
                "references": [
                    {
                        "url": "https://github.com/natcap/invest/blob/3.20.0/src/natcap/invest/spec.py",
                        "git_blob": "4bd69cc024a671e6b8701b2ddc1aba829c08a9cc",
                        "version": "3.20.0",
                        "locator": "FLOW_DIR_ALGORITHM; OptionStringInput.validate and preprocess"
                    },
                    {
                        "url": "https://storage.googleapis.com/releases.naturalcapitalproject.org/invest-userguide/latest/en/ndr.html",
                        "accessed": "2026-10-13",
                        "locator": "Data Needs > flow direction algorithm"
                    },
                    {
                        "url": "https://storage.googleapis.com/releases.naturalcapitalproject.org/invest-userguide/latest/en/sdr.html",
                        "accessed": "2026-10-13",
                        "locator": "Data Needs > flow direction algorithm"
                    }
                ]
            },
            {
                "id": "slope_length_cap",
                "targets": [
                    "sdr.l_max"
                ],
                "values": [
                    122,
                    333
                ],
                "reason": "Compare the guide's lower/default and upper maximum-L values while preserving the retained source grid, coefficient table and all unvaried parameters.",
                "references": [
                    {
                        "url": "https://storage.googleapis.com/releases.naturalcapitalproject.org/invest-userguide/latest/en/sdr.html",
                        "accessed": "2026-10-13",
                        "locator": "Data Needs > maximum l value",
                        "units": "dimensionless",
                        "reported_default": 122,
                        "reported_range": [
                            122,
                            333
                        ],
                        "cited_basis": [
                            "Desmet and Govers (1996)",
                            "Renard et al. (1997)"
                        ]
                    },
                    {
                        "url": "https://github.com/natcap/invest/blob/3.20.0/src/natcap/invest/sdr/sdr.py",
                        "git_blob": "0cac27add172011df367ff8026427dbbdbcda5b2",
                        "version": "3.20.0",
                        "locator": "MODEL_SPEC l_max and native slope-length-factor calculation"
                    }
                ]
            }
        ],
        "models": [
            "ndr",
            "sdr"
        ]
    },
    {
        "id": "routing-ndr-v1",
        "title": "Nutrient flow routing sensitivity",
        "question": "How do annual nitrogen and phosphorus export and land-cover effects change between the two native flow-routing algorithms?",
        "design": "factorial",
        "invest_version": "3.20.0",
        "models": [
            "ndr"
        ],
        "axes": [
            {
                "id": "routing",
                "targets": [
                    "ndr.flow_dir_algorithm"
                ],
                "values": [
                    "mfd",
                    "d8"
                ],
                "reason": "Compare the two supported native NDR flow-routing algorithms while preserving all selected source inputs and unvaried nutrient parameters.",
                "references": [
                    {
                        "url": "https://github.com/natcap/invest/blob/3.20.0/src/natcap/invest/spec.py",
                        "git_blob": "4bd69cc024a671e6b8701b2ddc1aba829c08a9cc",
                        "version": "3.20.0",
                        "locator": "FLOW_DIR_ALGORITHM; OptionStringInput.validate and preprocess"
                    },
                    {
                        "url": "https://storage.googleapis.com/releases.naturalcapitalproject.org/invest-userguide/latest/en/ndr.html",
                        "accessed": "2026-10-13",
                        "locator": "Data Needs > flow direction algorithm"
                    }
                ]
            }
        ]
    },
    {
        "id": "routing-lmax-sdr-v1",
        "title": "Sediment flow routing and slope length sensitivity",
        "question": "How do annual sediment export and land-cover effects change across the native flow-routing choices and documented maximum-L range?",
        "design": "factorial",
        "invest_version": "3.20.0",
        "models": [
            "sdr"
        ],
        "axes": [
            {
                "id": "routing",
                "targets": [
                    "sdr.flow_dir_algorithm"
                ],
                "values": [
                    "mfd",
                    "d8"
                ],
                "reason": "Compare the two supported native SDR flow-routing algorithms while preserving all selected source inputs and unvaried sediment parameters.",
                "references": [
                    {
                        "url": "https://github.com/natcap/invest/blob/3.20.0/src/natcap/invest/spec.py",
                        "git_blob": "4bd69cc024a671e6b8701b2ddc1aba829c08a9cc",
                        "version": "3.20.0",
                        "locator": "FLOW_DIR_ALGORITHM; OptionStringInput.validate and preprocess"
                    },
                    {
                        "url": "https://storage.googleapis.com/releases.naturalcapitalproject.org/invest-userguide/latest/en/sdr.html",
                        "accessed": "2026-10-13",
                        "locator": "Data Needs > flow direction algorithm"
                    }
                ]
            },
            {
                "id": "slope_length_cap",
                "targets": [
                    "sdr.l_max"
                ],
                "values": [
                    122,
                    333
                ],
                "reason": "Compare the guide's lower/default and upper maximum-L values while preserving the retained source grid, coefficient table and all unvaried parameters.",
                "references": [
                    {
                        "url": "https://storage.googleapis.com/releases.naturalcapitalproject.org/invest-userguide/latest/en/sdr.html",
                        "accessed": "2026-10-13",
                        "locator": "Data Needs > maximum l value",
                        "units": "dimensionless",
                        "reported_default": 122,
                        "reported_range": [
                            122,
                            333
                        ],
                        "cited_basis": [
                            "Desmet and Govers (1996)",
                            "Renard et al. (1997)"
                        ]
                    },
                    {
                        "url": "https://github.com/natcap/invest/blob/3.20.0/src/natcap/invest/sdr/sdr.py",
                        "git_blob": "0cac27add172011df367ff8026427dbbdbcda5b2",
                        "version": "3.20.0",
                        "locator": "MODEL_SPEC l_max and native slope-length-factor calculation"
                    }
                ]
            }
        ]
    }
]


def parameter_catalog():
    result = deepcopy(CATALOG)
    result["studies"] = deepcopy(STUDIES)
    return result


def _references(value, name):
    if not isinstance(value, list) or not value:
        raise ValueError(name + " requires source references")
    for item in value:
        if isinstance(item, str) and item.strip():
            continue
        if isinstance(item, dict) and any(item.get(k) for k in ("url", "source_id", "citation")):
            continue
        raise ValueError(name + " references must identify a URL, retained source or citation")
    return deepcopy(value)


def _parameters(profile, active=None):
    names = selected(profile) if active is None else tuple(active)
    result = {name: deepcopy(profile[name]) for name in names}
    result.update(table_sha256=profile["table_summary"]["sha256"],
                  source_collection_id=profile["source_collection_id"],
                  biophysical_source_id=profile["biophysical_source_id"])
    if names != MODEL_ORDER:
        result["models"] = list(names)
    return result


def _plan_models(plan):
    """Use the retained grid choice for an older plan that omitted model scope."""
    grid_spec = plan.get("sources", {}).get("grid_spec", {})
    return selected(plan, default=selected(grid_spec))


def _ensemble_scope(plan, runs):
    active = _plan_models(plan)
    scopes = {key: run_scope(run) for key, run in runs.items()}
    expected = required_outputs(active)
    available = {name for scope in scopes.values() for name in scope["available_artifacts"]}
    return {
        "selected_models": list(active),
        "omitted_models": [name for name in MODEL_ORDER if name not in active],
        "expected_artifacts": list(expected),
        "available_artifacts": [name for name in expected if name in available],
        "selected_models_complete": bool(scopes) and all(scope["selected_models_complete"] and set(active).issubset(scope["selected_models"]) for scope in scopes.values()),
        "full_model_selection": active == MODEL_ORDER,
        "full_model_outputs": bool(scopes) and all(scope["full_model_outputs"] for scope in scopes.values()),
    }


def _units(value, pollutant):
    aliases = {"kg/year": "kg/year", "t/year": "t/year",
               "metric_tonnes/year": "t/year", "metric_tons/year": "t/year",
               "tonnes/year": "t/year"}
    result = aliases.get(value)
    expected = "t/year" if pollutant == "sediment_export" else "kg/year"
    if result != expected:
        raise ValueError("Unexpected physical annual units for " + pollutant + ": " + str(value))
    return result


def _finite(value, name):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise ValueError(name + " must be a finite JSON number")
    return value


def _design(workspace, spec):
    if not isinstance(spec, dict):
        raise ValueError("An ensemble design must be an object")
    for name in ("title", "reason"):
        if not isinstance(spec.get(name), str) or not spec[name].strip():
            raise ValueError("Supply the ensemble " + name)
    design = spec.get("design", "factorial")
    if design not in ("factorial", "one_at_a_time"):
        raise ValueError("Design must be factorial or one_at_a_time")
    grid = workspace.get_grid(spec["grid_id"])
    spec, active = normalize_selection(spec, default=grid_models(grid))
    if not set(active).issubset(grid_models(grid)):
        raise ValueError("Prepare or extend this grid for the models selected by the ensemble")
    missing_inputs = [role for role in required_roles(active) if role not in grid["files"]]
    if missing_inputs:
        raise ValueError("The selected ensemble models need prepared grid inputs: " + ", ".join(missing_inputs))
    baseline = workspace._get("scenarios", spec["baseline_scenario_id"])
    if baseline["kind"] != "baseline":
        raise ValueError("Select the retained observed-land-cover baseline")
    alternatives = spec.get("alternative_scenario_ids", [])
    if not isinstance(alternatives, list) or len(set(alternatives)) != len(alternatives):
        raise ValueError("Alternative scenario IDs must be a unique list")
    if baseline["id"] in alternatives:
        raise ValueError("The baseline cannot also be an alternative")
    scenarios = [baseline]
    for key in alternatives:
        scenario = workspace._get("scenarios", key)
        if scenario["kind"] != "landcover":
            raise ValueError("Every alternative must record its explicit land-cover changes")
        scenarios.append(scenario)
    base_ids = spec.get("base_profile_ids")
    if not isinstance(base_ids, list) or not base_ids or len(set(base_ids)) != len(base_ids):
        raise ValueError("Select one or more distinct retained base_profile_ids")
    bases = [workspace._get("profiles", key) for key in base_ids]
    for base in bases:
        if not set(active).issubset(selected(base)):
            raise ValueError("Base profile " + base["id"] + " lacks selected native model parameters")
    axes, used_targets, axis_ids = [], set(), set()
    for raw in spec.get("axes", []):
        if not isinstance(raw, dict) or not isinstance(raw.get("id"), str) or not raw["id"].strip() or raw["id"] in axis_ids:
            raise ValueError("Each parameter axis needs a distinct id")
        if not raw.get("reason"):
            raise ValueError("Explain the source-supported reason for each axis")
        targets = raw.get("targets", [raw["target"]] if "target" in raw else [])
        if not isinstance(targets, list) or not targets or len(set(targets)) != len(targets):
            raise ValueError("Each axis needs distinct explicit parameter targets")
        for target in targets:
            if not isinstance(target, str) or target.count(".") != 1:
                raise ValueError("Use native targets such as ndr.k_param")
            model, name = target.split(".")
            if model not in ("ndr", "sdr") or name not in (NDR_KEYS if model == "ndr" else SDR_KEYS):
                raise ValueError("Unsupported native parameter target: " + target)
            if model not in active:
                raise ValueError("Axis " + raw["id"] + " changes unselected model " + model + "; choose its native model or a study for the selected models")
            if target in used_targets:
                raise ValueError("Two axes cannot overwrite the same target: " + target)
            used_targets.add(target)
        values = raw.get("values")
        if not isinstance(values, list) or not values:
            raise ValueError("Supply actual values for each parameter axis")
        value_keys = []
        for value in values:
            if isinstance(value, str):
                if not value.strip():
                    raise ValueError("Axis choices cannot be empty")
            else:
                _finite(value, "Axis value")
            value_keys.append(digest(value))
        if len(set(value_keys)) != len(value_keys):
            raise ValueError("Repeated values in axis " + str(raw["id"]))
        axis_ids.add(raw["id"])
        axes.append({"id": str(raw["id"]), "targets": targets, "values": deepcopy(values),
                     "references": _references(raw.get("references"), str(raw["id"])),
                     "reason": str(raw["reason"])})

    candidates, seen = [], set()
    # Reuse selected original profiles before creating any equivalent variation.
    # This preserves their native run identities across overlapping source cases.
    selected_profiles = itertools.chain(((base, False) for base in bases),
                                        ((base, True) for base in bases))
    for base, explore in selected_profiles:
        choices = [()]
        if explore:
            if not axes:
                continue
            if design == "factorial":
                choices = itertools.product(*[list(enumerate(a["values"])) for a in axes])
            else:
                choices = ((index, value) for index, axis in enumerate(axes) for value in axis["values"])
        for choice in choices:
            assignments = []
            if choice:
                if design == "factorial":
                    assignments = [(axis, pair[1]) for axis, pair in zip(axes, choice)]
                else:
                    assignments = [(axes[choice[0]], choice[1])]
            value = deepcopy(base)
            changes = []
            for axis, selected_value in assignments:
                for target in axis["targets"]:
                    model, name = target.split(".")
                    value[model][name] = selected_value
                changes.append({"axis_id": axis["id"], "targets": axis["targets"],
                                "value": selected_value, "references": axis["references"],
                                "reason": axis["reason"]})
            checked = checked_parameters(value)
            value.update(checked)
            signature = digest(_parameters(value, active))
            if signature in seen:
                continue
            seen.add(signature)
            changed = any(value[name] != base[name] for name in active)
            label = base["title"]
            if changed:
                label += " / " + ", ".join(c["axis_id"] + "=" + str(c["value"]) for c in changes)
                value = {"source_collection_id": base["source_collection_id"],
                         "biophysical_source_id": base["biophysical_source_id"],
                         **{name: value[name] for name in selected(base)}}
                value, _ = normalize_selection(value, default=selected(base))
                original_refs = base.get("references", [])
                value["references"] = deepcopy(original_refs if isinstance(original_refs, list) else [original_refs])
                for change in changes:
                    for ref in change["references"]:
                        if ref not in value["references"]:
                            value["references"].append(deepcopy(ref))
                value.update(title=label, scientific_status="working",
                             ensemble_derivation={"base_profile_id": base["id"],
                                                  "method": design, "assignments": changes})
            candidates.append({"id": signature, "base": base, "profile": value,
                               "existing_profile_id": None if changed else base["id"],
                               "label": label, "assignments": changes})
    if not alternatives and len(candidates) < 2:
        raise ValueError("Select land-cover alternatives or at least two distinct parameter members")
    return {"spec": deepcopy(spec), "design": design, "grid": grid, "scenarios": scenarios,
            "bases": bases, "axes": axes, "candidates": candidates, "models": active}


def _windows(width, height):
    from rasterio.windows import Window
    for row in range(0, height, 256):
        for column in range(0, width, 256):
            yield Window(column, row, min(256, width - column), min(256, height - row))


def _pair_support(a_path, b_path, grid_id):
    """Read each original mass raster once, using a canonical shared-cell mask."""
    import numpy as np
    import rasterio

    counts = {"baseline_valid_cells": 0, "alternative_valid_cells": 0,
              "common_cells": 0, "baseline_only_cells": 0, "alternative_only_cells": 0}
    totals = {"baseline_common": [], "alternative_common": [], "delta_common": [],
              "baseline_only_total": [], "alternative_only_total": []}
    support = hashlib.sha256()
    with rasterio.open(a_path) as a, rasterio.open(b_path) as b:
        if a.count != 1 or b.count != 1 or a.width != b.width or a.height != b.height or a.crs != b.crs or a.transform != b.transform:
            raise ValueError("Paired physical rasters must retain the exact same single-band grid")
        support.update(json.dumps({"grid_id": grid_id, "width": a.width, "height": a.height,
                                   "window": 256, "mask_encoding": "row-major-packbits-little"},
                                  sort_keys=True, separators=(",", ":")).encode("utf-8"))
        for window in _windows(a.width, a.height):
            av, bv = a.read(1, window=window, masked=True), b.read(1, window=window, masked=True)
            ag = ~np.ma.getmaskarray(av) & np.isfinite(av.data)
            bg = ~np.ma.getmaskarray(bv) & np.isfinite(bv.data)
            if np.any(av.data[ag] < 0) or np.any(bv.data[bg] < 0):
                raise ValueError("Annual export mass rasters must be nonnegative")
            common, a_only, b_only = ag & bg, ag & ~bg, bg & ~ag
            support.update(np.packbits(common.reshape(-1), bitorder="little").tobytes())
            for name, mask in (("baseline_valid_cells", ag), ("alternative_valid_cells", bg),
                               ("common_cells", common), ("baseline_only_cells", a_only),
                               ("alternative_only_cells", b_only)):
                counts[name] += int(np.count_nonzero(mask))
            aa = np.asarray(av.data[common], dtype=np.float64)
            bb = np.asarray(bv.data[common], dtype=np.float64)
            totals["baseline_common"].append(float(np.sum(aa, dtype=np.float64)))
            totals["alternative_common"].append(float(np.sum(bb, dtype=np.float64)))
            totals["delta_common"].append(float(np.sum(bb - aa, dtype=np.float64)))
            totals["baseline_only_total"].append(float(np.sum(av.data[a_only], dtype=np.float64)))
            totals["alternative_only_total"].append(float(np.sum(bv.data[b_only], dtype=np.float64)))
    result = {**counts, **{key: math.fsum(parts) for key, parts in totals.items()},
              "common_support_sha256": support.hexdigest()}
    result["percent_change"] = (100 * result["delta_common"] / result["baseline_common"]
                                if result["baseline_common"] != 0 else None)
    result["percent_change_basis"] = "alternative minus baseline, divided by baseline, on the exact common valid cells"
    return result


def _robustness(rows, planned):
    groups = {}
    for row in rows:
        key = (row["scenario_id"], row["pollutant"], row["common_support_sha256"])
        groups.setdefault(key, []).append(row)
    output = []
    for (scenario, pollutant, support), members in groups.items():
        deltas = [r["delta_common"] for r in members]
        percents = [r["percent_change"] for r in members if r["percent_change"] is not None]
        decreases, increases = sum(x < 0 for x in deltas), sum(x > 0 for x in deltas)
        unchanged = len(deltas) - decreases - increases
        direction = "mixed"
        if decreases == len(deltas):
            direction = "decrease"
        elif increases == len(deltas):
            direction = "increase"
        elif unchanged == len(deltas):
            direction = "unchanged"
        output.append({
            "scenario_id": scenario, "pollutant": pollutant, "total_units": members[0]["total_units"],
            "common_support_sha256": support, "common_cells": members[0]["common_cells"],
            "members_complete_on_this_support": len(members), "members_planned": planned,
            "member_ids": [r["member_id"] for r in members],
            "min_delta": min(deltas), "median_delta": statistics.median(deltas), "max_delta": max(deltas),
            "min_percent_change": min(percents) if percents else None,
            "median_percent_change": statistics.median(percents) if percents else None,
            "max_percent_change": max(percents) if percents else None,
            "decrease_count": decreases, "increase_count": increases, "unchanged_count": unchanged,
            "direction": direction,
            "direction_agreement": max(decreases, increases, unchanged) / len(members),
            "range_semantics": "Descriptive explored range for completed members on this exact common valid-cell mask",
        })
    return output


class Ensembles:
    def __init__(self, workspace):
        self.workspace = workspace

    def _directory(self, key):
        plan = self.workspace._get("ensembles", key)
        return plan, self.workspace.root / "ensemble_results" / plan["id"]

    def preview(self, spec):
        value = _design(self.workspace, spec)
        members = []
        for c in value["candidates"]:
            profile = c["profile"]
            if "table_summary" not in profile:
                profile = {**profile, "table_summary": c["base"]["table_summary"]}
            members.append({"id": c["id"], "profile_id": c["existing_profile_id"],
                            "parent_profile_id": c["base"]["id"], "label": c["label"],
                            "parameters": _parameters(profile, value["models"]), "assignments": c["assignments"],
                            "scientific_status": profile.get("scientific_status", "working")})
        result = {"schema": "upstate.ensemble-preview/v1", "title": spec["title"],
                "grid_id": value["grid"]["id"], "design": value["design"],
                "scenario_ids": [s["id"] for s in value["scenarios"]],
                "member_count": len(members), "run_count": len(members) * len(value["scenarios"]),
                "landcover_pair_count": len(members) * (len(value["scenarios"]) - 1),
                "parameter_pair_count": max(0, len(members) - 1), "members": members,
                "axes": value["axes"], "selected_models": list(value["models"]),
                "expected_artifacts": list(required_outputs(value["models"]))}
        return normalize_selection(result, default=value["models"])[0]

    def prepare(self, spec):
        value = _design(self.workspace, spec)
        members = []
        for candidate in value["candidates"]:
            profile = (self.workspace._get("profiles", candidate["existing_profile_id"])
                       if candidate["existing_profile_id"] else self.workspace.save_profile(candidate["profile"]))
            runs = []
            for index, scenario in enumerate(value["scenarios"]):
                request, _ = normalize_selection({"grid_id": value["grid"]["id"],
                                                   "profile_id": profile["id"], "scenario_id": scenario["id"]},
                                                  default=value["models"])
                run = self.workspace.prepare_run(request)
                retained, _ = normalize_selection({"scenario_id": scenario["id"], "run_id": run["id"],
                                                    "role": "baseline" if index == 0 else "alternative",
                                                    "label": scenario["title"]}, default=run_models(run))
                runs.append(retained)
            members.append({"id": candidate["id"], "profile_id": profile["id"],
                            "parent_profile_id": candidate["base"]["id"], "label": candidate["label"],
                            "parameters": _parameters(profile, value["models"]), "assignments": candidate["assignments"],
                            "scientific_status": profile.get("scientific_status", "working"),
                            "references": deepcopy(profile["references"]), "runs": runs})
        plan_value = {
            "title": spec["title"].strip(), "reason": spec["reason"].strip(),
            "grid_id": value["grid"]["id"], "baseline_scenario_id": value["scenarios"][0]["id"],
            "scenario_ids": [s["id"] for s in value["scenarios"]],
            "alternative_scenario_ids": [s["id"] for s in value["scenarios"][1:]],
            "base_profile_ids": list(spec["base_profile_ids"]),
            "design": value["design"], "axes": value["axes"], "members": members,
            "sources": {"grid_spec": deepcopy(value["grid"].get("spec", {})),
                        "method_sources": deepcopy(CATALOG["sources"])},
            "interpretation": deepcopy(CATALOG["methods"]),
        }
        plan_value, _ = normalize_selection(plan_value, default=value["models"])
        plan = self.workspace._save("ensembles", plan_value)
        directory = self.workspace.root / "ensemble_results" / plan["id"]
        directory.mkdir(parents=True, exist_ok=True)
        with held(directory / ".state.lock"):
            path = directory / "state.json"
            if not path.exists():
                atomic_json(path, {"schema": "upstate.ensemble-state/v1", "ensemble_id": plan["id"],
                                   "state": "prepared", "created_at": now(), "updated_at": now(),
                                   "errors": [], "comparisons": {}})
        return self.inspect(plan["id"])

    def _run_records(self, plan):
        return {r["run_id"]: self.workspace.inspect_run(r["run_id"])
                for m in plan["members"] for r in m["runs"]}

    def _signature(self, runs):
        return digest({key: {"state": value["state"], "selection": value["selection"],
                             "runtime": value.get("runtime"), "artifacts": value.get("artifacts", {})}
                       for key, value in runs.items()})

    def inspect(self, key):
        plan, directory = self._directory(key)
        state_path = directory / "state.json"
        state = read_json(state_path) if state_path.exists() else {"state": "prepared", "errors": [], "comparisons": {}}
        runs = self._run_records(plan)
        progress = {"total": len(runs), "complete": 0, "failed": 0, "running": 0, "prepared": 0}
        members = []
        for member in plan["members"]:
            current = {**member, "runs": []}
            for selection in member["runs"]:
                native = runs[selection["run_id"]]
                progress[native["state"]] = progress.get(native["state"], 0) + 1
                current["runs"].append({**selection, "state": native["state"],
                                        "created_at": native.get("created_at"),
                                        "completed_at": native.get("completed_at"),
                                        "updated_at": native.get("updated_at"),
                                        "error": native.get("error"),
                                        "stages": list(native.get("stages", {})),
                                        "model_scope": run_scope(native)})
            current["comparisons"] = state.get("comparisons", {}).get(member["id"], [])
            current["comparison_id"] = (current["comparisons"][0]["comparison_id"]
                                         if len(current["comparisons"]) == 1 else None)
            members.append(current)
        # A run selection can occur in only one deduplicated member; progress is
        # nevertheless calculated from unique native run records.
        progress.update({name: sum(r["state"] == name for r in runs.values())
                         for name in ("complete", "failed", "running", "prepared")})
        return {**plan, "members": members, "state": state["state"], "progress": progress,
                "model_scope": _ensemble_scope(plan, runs),
                "updated_at": state.get("updated_at"), "started_at": state.get("started_at"),
                "completed_at": state.get("completed_at"), "active": state.get("active"),
                "errors": state.get("errors", []), "report_errors": state.get("report_errors", []),
                "execution_error": state.get("execution_error"), "run_signature": self._signature(runs)}

    def list(self):
        directory = self.workspace.root / "ensembles"
        return [self.inspect(path.stem) for path in sorted(directory.glob("*.json"))] if directory.exists() else []

    def _pair(self, plan, baseline, alternative, directory):
        common = common_comparison_outputs([baseline, alternative])
        expected = required_outputs(_plan_models(plan))
        pollutants = tuple(name for name in common if name in expected)
        missing = sorted(set(expected) - set(pollutants))
        if missing:
            raise ValueError("Paired native runs lack selected ensemble exports: " + ", ".join(missing))
        scope = {"common_artifacts": list(pollutants),
                 "model_scopes": {run["id"]: run_scope(run) for run in (baseline, alternative)}}
        identity = {"grid_id": plan["grid_id"],
                    "baseline": {"id": baseline["id"], "artifacts": baseline["artifacts"]},
                    "alternative": {"id": alternative["id"], "artifacts": alternative["artifacts"]},
                    "method": "paired-common-valid-v1"}
        if pollutants != POLLUTANTS:
            identity["common_artifacts"] = list(pollutants)
        key = digest(identity)
        path = directory / "pairs" / (key + ".json")
        if path.exists():
            result = read_json(path)
            if result.get("identity") != identity:
                raise ValueError("Retained pair summary identity differs")
            return {**result, **scope}
        comparison = self.workspace.compare_runs([baseline["id"], alternative["id"]])
        comparison_artifacts = comparison["alternatives"][0]["artifacts"]
        rows = []
        for pollutant in pollutants:
            a, b = baseline["artifacts"][pollutant], alternative["artifacts"][pollutant]
            units = _units(a["sum_units"], pollutant)
            if _units(b["sum_units"], pollutant) != units:
                raise ValueError("Paired annual units differ")
            a_path = verify_file(self.workspace.root / "runs" / baseline["id"], a)
            b_path = verify_file(self.workspace.root / "runs" / alternative["id"], b)
            support = _pair_support(a_path, b_path, plan["grid_id"])
            if not support["common_cells"]:
                raise ValueError("Selected paired outputs have no common valid land cells")
            if int(comparison_artifacts[pollutant]["valid_cells"]) != support["common_cells"]:
                raise ValueError("Native difference coverage differs from the paired mass rasters")
            rows.append({
                "pollutant": pollutant, "native_model": "sdr" if pollutant == "sediment_export" else "ndr",
                "baseline_run_id": baseline["id"],
                "alternative_run_id": alternative["id"], "comparison_id": comparison["id"],
                "baseline_total": float(a["sum"]), "alternative_total": float(b["sum"]),
                "total_units": units, "baseline_native_units": a.get("native_units"),
                "alternative_native_units": b.get("native_units"), **support,
                "native_delta_common": comparison_artifacts[pollutant]["sum_change"],
                "native_difference_artifact": deepcopy(comparison_artifacts[pollutant]),
                "baseline_artifact": deepcopy(a), "alternative_artifact": deepcopy(b),
                "direction": "alternative minus baseline",
            })
        result = {"schema": "upstate.ensemble-pair/v1", "identity": identity, **scope,
                  "comparison_id": comparison["id"], "rows": rows, "created_at": now()}
        path.parent.mkdir(parents=True, exist_ok=True)
        atomic_json(path, result, immutable=True)
        return result

    def report_data(self, key, refresh=False):
        plan, directory = self._directory(key)
        directory.mkdir(parents=True, exist_ok=True)
        current = self.inspect(key)
        execution = {"run_errors": deepcopy(current.get("errors", [])),
                     "execution_error": deepcopy(current.get("execution_error")),
                     "model_scope": deepcopy(current["model_scope"])}
        runs = self._run_records(plan)
        signature = self._signature(runs)
        path = directory / "summary.json"
        if path.exists():
            cached = read_json(path)
            if cached.get("run_signature") == signature and not cached.get("errors"):
                return {**cached, **execution, "state": current["state"], "progress": current["progress"], "report_state": "current"}
            if not refresh:
                return {**cached, **execution, "state": current["state"], "progress": current["progress"],
                        "report_state": "partial" if cached.get("run_signature") == signature else "stale",
                        "current_run_signature": signature}
        if not refresh:
            return {"schema": "upstate.ensemble-report/v1", "id": plan["id"], "title": plan["title"],
                    "reason": plan["reason"], "interpretation": plan["interpretation"], **execution,
                    "errors": [], "comparisons": {}, "generated_at": None,
                    "state": current["state"], "progress": current["progress"], "report_state": "pending",
                    "grid_id": plan["grid_id"], "baseline_scenario_id": plan["baseline_scenario_id"],
                    "rows": [], "sensitivity": [], "robustness": [], "members": plan["members"],
                    "sources": plan["sources"], "run_signature": signature}
        with held(directory / ".report.lock", blocking=False):
            rows, sensitivity, comparisons, errors = [], [], {}, []
            for member in plan["members"]:
                baseline = runs[member["runs"][0]["run_id"]]
                if baseline["state"] != "complete":
                    continue
                comparisons[member["id"]] = []
                for selected in member["runs"][1:]:
                    alternative = runs[selected["run_id"]]
                    if alternative["state"] != "complete":
                        continue
                    try:
                        pair = self._pair(plan, baseline, alternative, directory)
                        rows.extend({**row, "member_id": member["id"], "member_label": member["label"],
                                     "profile_id": member["profile_id"], "scenario_id": selected["scenario_id"],
                                     "scenario_label": selected["label"], "kind": "landcover"}
                                    for row in pair["rows"])
                        comparisons[member["id"]].append({"scenario_id": selected["scenario_id"],
                                                         "comparison_id": pair["comparison_id"]})
                    except Exception as exc:
                        errors.append({"member_id": member["id"], "scenario_id": selected["scenario_id"],
                                       "type": type(exc).__name__, "message": str(exc)})
            reference_member = plan["members"][0]
            reference = runs[reference_member["runs"][0]["run_id"]]
            if reference["state"] == "complete":
                for member in plan["members"][1:]:
                    alternative = runs[member["runs"][0]["run_id"]]
                    if alternative["state"] != "complete":
                        continue
                    try:
                        pair = self._pair(plan, reference, alternative, directory)
                        sensitivity.extend({**row, "member_id": member["id"], "member_label": member["label"],
                                            "profile_id": member["profile_id"],
                                            "reference_member_id": reference_member["id"],
                                            "reference_profile_id": reference_member["profile_id"],
                                            "scenario_id": plan["baseline_scenario_id"],
                                            "scenario_label": member["runs"][0]["label"], "kind": "parameter"}
                                           for row in pair["rows"])
                    except Exception as exc:
                        errors.append({"member_id": member["id"], "kind": "parameter",
                                       "type": type(exc).__name__, "message": str(exc)})
            result = {
                "schema": "upstate.ensemble-report/v1", "id": plan["id"], "title": plan["title"],
                "reason": plan["reason"], "grid_id": plan["grid_id"], **execution,
                "baseline_scenario_id": plan["baseline_scenario_id"],
                "state": current["state"], "progress": current["progress"],
                "report_state": "partial" if errors else "current",
                "rows": rows, "sensitivity": sensitivity,
                "robustness": _robustness(rows, len(plan["members"])),
                "members": plan["members"], "sources": plan["sources"],
                "interpretation": plan["interpretation"], "comparisons": comparisons, "errors": errors,
                "run_signature": signature, "generated_at": now(),
            }
            with held(directory / ".state.lock"):
                state_path = directory / "state.json"
                state = read_json(state_path) if state_path.exists() else {"state": "prepared"}
                state.update(comparisons=comparisons, report_errors=errors, updated_at=now())
                if state["state"] not in ("running", "summarizing"):
                    if current["model_scope"]["selected_models_complete"] and not errors and not state.get("errors") and not state.get("execution_error"):
                        state.update(state="complete", completed_at=state.get("completed_at", now()))
                    elif any(run["state"] == "complete" for run in runs.values()):
                        state["state"] = "partial"
                result["state"] = state["state"]
                atomic_json(state_path, state)
            atomic_json(path, result)
            return result

    def run(self, key, continue_on_error=True):
        plan, directory = self._directory(key)
        directory.mkdir(parents=True, exist_ok=True)
        with held(directory / ".execute.lock", blocking=False):
            state_path = directory / "state.json"
            state = read_json(state_path) if state_path.exists() else {"created_at": now()}
            state.update(schema="upstate.ensemble-state/v1", ensemble_id=key, state="running",
                         started_at=state.get("started_at", now()), updated_at=now(),
                         errors=[], comparisons=state.get("comparisons", {}))
            state.pop("completed_at", None)
            state.pop("execution_error", None)
            atomic_json(state_path, state)
            try:
                for member in plan["members"]:
                    for selected in member["runs"]:
                        state.update(active={"member_id": member["id"], "profile_id": member["profile_id"],
                                             "scenario_id": selected["scenario_id"], "run_id": selected["run_id"]},
                                     updated_at=now())
                        atomic_json(state_path, state)
                        try:
                            self.workspace.run(selected["run_id"])
                        except Exception as exc:
                            state["errors"].append({**state["active"], "type": type(exc).__name__,
                                                    "message": str(exc), "at": now()})
                            atomic_json(state_path, state)
                            if not continue_on_error:
                                raise
                completed = self._run_records(plan)
                all_complete = _ensemble_scope(plan, completed)["selected_models_complete"]
                state.update(state="summarizing", active=None, updated_at=now())
                atomic_json(state_path, state)
                report = self.report_data(key, refresh=True)
                state.update(state="complete" if all_complete and not state["errors"] and not report["errors"] else "partial",
                             comparisons=report["comparisons"], report_errors=report["errors"],
                             active=None, updated_at=now(), completed_at=now())
                atomic_json(state_path, state)
            except BaseException as exc:
                state.update(state="interrupted" if not isinstance(exc, Exception) else "failed",
                             active=None, updated_at=now(),
                             execution_error={"type": type(exc).__name__, "message": str(exc)})
                atomic_json(state_path, state)
                raise
        return self.inspect(key)
