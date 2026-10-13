"""Receiver for ES-EXP-2319 completed landcover-case metrics.

No raster reading, recomputation, unit conversion, interpolation or missing-cell
fill occurs here. Original paired metrics and run identities remain in the study.
"""
from __future__ import annotations
import math
from .schema import Study
from .engine import canonical_hash


def finite_number(value, name):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise ValueError(f"{name} must be a finite numeric value")
    return float(value)


def from_experiment(bundle: dict, configuration: dict) -> Study:
    """Receive all requested candidate/profile pairs from one experiment snapshot.

    bundle: {grid_id, experiment_id, cases:[{kind:'landcover',profile_id,
      scenario_id,baseline_run_id,run_id,metrics:{pollutant:{units,baseline_total,
      alternative_total,reduction,paired_cells,coverage_fraction,support_sha256}}}]}
    configuration is the normal Study shape WITHOUT cells; source is preserved.
    All candidates and profiles are explicit. Extra cases may coexist in the
    snapshot; a missing requested pair is an error, not an automatically removed
    scenario. Candidate costs are supplied by the decision operator, never inferred.
    """
    cases = bundle.get("rows", bundle.get("cases"))
    grid = bundle.get("grid_id") or bundle.get("summary", {}).get("grid_id")
    if not isinstance(cases, list) or not isinstance(grid, str) or not grid:
        raise ValueError("experiment needs summary rows (or complete cases) and an original grid_id")
    if configuration.get("mode", "native_packages") != "native_packages":
        raise ValueError("whole native experiment packages cannot be imported as additive actions")
    candidates = {c["id"] for c in configuration["candidates"]}
    profiles = {p["id"] for p in configuration["profiles"]}
    metrics = configuration["metrics"]
    supports, baselines, cells, seen = {}, {}, [], set()
    for row in cases:
        if row.get("kind") != "landcover":
            continue
        sid, pid = row.get("scenario_id"), row.get("profile_id")
        if sid not in candidates or pid not in profiles:
            continue
        key = (pid, sid)
        if key in seen:
            raise ValueError(f"duplicate completed experiment pair {key}; select an explicit experiment edition")
        state = row.get("status", row.get("state"))
        if state not in ("completed", "complete", "succeeded", "success"):
            raise ValueError(f"requested pair {key} has state {state}")
        selection = row.get("selection", {})
        for field, expected in (("grid_id", grid), ("profile_id", pid), ("scenario_id", sid)):
            if field in selection and selection[field] != expected:
                raise ValueError(f"pair {key} has conflicting original {field}")
        baseline_id, alternative_id = row.get("baseline_run_id"), row.get("alternative_run_id", row.get("run_id"))
        if not baseline_id or not alternative_id or baseline_id == alternative_id:
            raise ValueError(f"pair {key} requires distinct baseline and alternative run IDs")
        if pid in baselines and baselines[pid] != baseline_id:
            raise ValueError(f"profile {pid} contains different baseline runs")
        baselines[pid] = baseline_id
        gains = {}; original = {}
        for metric in metrics:
            mid = metric["id"]
            value = row.get("metrics", {}).get(mid)
            if not isinstance(value, dict):
                raise ValueError(f"pair {key} lacks physical metric {mid}")
            if value.get("units") != metric["units"]:
                raise ValueError(f"pair {key}/{mid} units mismatch: {value.get('units')} versus {metric['units']}")
            reduction = finite_number(value.get("reduction"), f"{key}/{mid}/reduction")
            baseline = finite_number(value.get("baseline_total"), f"{key}/{mid}/baseline_total")
            alternative = finite_number(value.get("alternative_total"), f"{key}/{mid}/alternative_total")
            if not math.isclose(baseline - alternative, reduction, rel_tol=1e-8, abs_tol=1e-8):
                raise ValueError(f"pair {key}/{mid} reduction must equal baseline minus alternative")
            if "delta" in value and not math.isclose(finite_number(value["delta"], "delta"), -reduction, rel_tol=1e-8, abs_tol=1e-8):
                raise ValueError(f"pair {key}/{mid} delta has a conflicting sign")
            support = value.get("support_sha256")
            count = value.get("paired_cells")
            if not isinstance(support, str) or len(support) != 64 or any(c not in "0123456789abcdef" for c in support.lower()):
                raise ValueError(f"pair {key}/{mid} lacks a SHA-256 paired-support identity")
            if not isinstance(count, int) or isinstance(count, bool) or count <= 0:
                raise ValueError(f"pair {key}/{mid} needs positive paired_cells")
            coverage = finite_number(value.get("coverage_fraction"), f"{key}/{mid}/coverage_fraction")
            if not 0 < coverage <= 1:
                raise ValueError(f"pair {key}/{mid} coverage_fraction must be in (0,1]")
            identity = (support.lower(), count, coverage)
            if mid in supports and supports[mid] != identity:
                raise ValueError(f"metric {mid} has different comparison support; build the common-support cohort before ranking")
            supports[mid] = identity
            baseline_key = (pid, mid)
            if baseline_key in baselines and not math.isclose(baselines[baseline_key], baseline, rel_tol=1e-8, abs_tol=1e-8):
                raise ValueError(f"profile {pid}/{mid} changes baseline total on the same support")
            baselines[baseline_key] = baseline
            gains[mid] = reduction
            original[mid] = value
        cells.append({"profile_id": pid, "candidate_id": sid, "gains": gains,
                      "source": {"baseline_run_id": baseline_id, "alternative_run_id": alternative_id,
                                 "scenario_id": sid, "grid_id": grid, "metrics": original,
                                 "source_trace": row.get("source_trace", {}),
                                 "native_case": {k: row[k] for k in ("id", "selection", "changes", "comparison_id", "native_runtime", "native_completed_at", "output_artifacts") if k in row}}})
        seen.add(key)
    config = dict(configuration)
    config["cells"] = cells
    config["source"] = {**configuration.get("source", {}), "experiment_id": bundle.get("experiment_id", bundle.get("id")),
                        "workspace_id": bundle.get("workspace_id"),
                        "grid_id": grid, "experiment_snapshot_sha256": canonical_hash(bundle),
                        "pair_contract": "ES-EXP-2319/landcover-metrics", "gain_sign": "baseline minus alternative",
                        "support_by_metric": {k: {"sha256": v[0], "paired_cells": v[1], "coverage_fraction": v[2]}
                                              for k, v in supports.items()}}
    return Study.model_validate(config)


def from_workspace(workspace, experiment_id: str, configuration: dict) -> Study:
    """Read the original retained experiment summary without scheduling a run."""
    from model import experiments
    summary = experiments.read_summary(workspace, experiment_id)
    if summary is None:
        raise ValueError("The selected experiment has no retained summary yet")
    return from_experiment(summary, configuration)
