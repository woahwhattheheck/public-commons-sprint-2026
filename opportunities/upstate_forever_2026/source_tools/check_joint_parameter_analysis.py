#!/usr/bin/env python3
"""Check joint-analysis mathematics and attribution without running a scientific model.

All numerical arrays and summary records below are explicitly authored checks.
They are not environmental observations, native model outputs or calibration
evidence. The check writes only its own receipt; it never opens or changes a
scientific Workspace, samples a study, invokes a solver or launches a browser.
"""
from __future__ import annotations

import argparse
from copy import deepcopy
import json
from pathlib import Path
import sys

APPLICATION = Path(__file__).resolve().parents[1]
if str(APPLICATION) not in sys.path:
    sys.path.insert(0, str(APPLICATION))

import numpy as np
from model import joint_parameter_analysis as analysis
from model.common import atomic_json, digest, file_digest


def require(value, description):
    if not value:
        raise AssertionError(description)


def refused(function, description):
    try:
        function()
    except ValueError:
        return
    raise AssertionError(description)


def numerical_checks():
    require(np.array_equal(analysis._rank([5, 1, 1, 9]), [3, 1.5, 1.5, 4]),
            "Tied inputs must retain their average ranks")
    # Fixed authored coordinates, not a replacement sampling design.
    rng = np.random.default_rng(8047)
    u = rng.uniform(size=(30, 2))
    z = 2 * u - 1
    axes = [{"id": "a", "label": "A", "units": "m"},
            {"id": "b", "label": "B", "units": "m"}]
    y = 2 + 3*z[:, 0] - 4*z[:, 1] + 5*z[:, 0]**2 + 6*z[:, 1]**2 + 7*z[:, 0]*z[:, 1]
    surface = analysis._surface(u, y, axes, [str(i) for i in range(30)])
    full = surface["full_quadratic"]
    require(full["available"] and np.allclose(full["coefficients"], [2, 3, -4, 5, 6, 7],
                                             rtol=1e-10, atol=1e-10),
            "The hierarchical surface must recover the exact authored polynomial")
    require(full["profile_holdout"]["complete"] and full["profile_holdout"]["rmse"] < 1e-10,
            "Independent whole-profile predictions must recover the same polynomial")
    require(full["r2"] > .999999999 and surface["incremental_interaction_r2"] > 0,
            "The nonzero authored interaction must remain in its hierarchical model")
    require(not analysis._surface(u[:4], y[:4], axes, list("abcd"))["full_quadratic"]["available"],
            "An underdetermined quadratic must not produce attributed coefficients")

    relations = analysis._relations(u, u[:, 0], axes)
    require(abs(relations[0]["spearman"] - 1) < 1e-12
            and abs(relations[0]["partial_rank_correlation"] - 1) < 1e-12,
            "Exact monotonic association must survive unrelated rank controls")
    require(analysis._correlation([1, 1, 1], [1, 2, 3])[0] is None,
            "Constant input must not become a finite correlation")
    dependent = np.column_stack([u[:, 0], u[:, 0], u[:, 1]])
    dependent_axes = [dict(axes[0], id="a"), dict(axes[0], id="a-copy"), dict(axes[1], id="b")]
    partial = analysis._relations(dependent, y, dependent_axes)
    require(all(item["partial_rank_correlation"] is None for item in partial),
            "Exact rank dependence must remain unavailable, including exhausted residuals")

    repeated = np.column_stack([np.ones(8), [0, 0, 1, 1, 2, 2, 3, 3]])
    fit = analysis._fit(repeated, np.array([1, 1, 3, 3, 5, 5, 7, 7]),
                        ["p0", "p0", "p1", "p1", "p2", "p2", "p3", "p3"])
    require(fit["profile_holdout"]["complete"] and fit["profile_holdout"]["rmse"] < 1e-12,
            "A duplicated linear profile must remain correctly predicted")
    # Two distinct profiles duplicated twice: ordinary row-wise holdout would
    # leak the held-out profile. Whole-profile holdout has rank one and must refuse.
    leak = analysis._fit(np.column_stack([np.ones(4), [0, 0, 1, 1]]),
                         np.array([1, 1, 3, 3]), ["p0", "p0", "p1", "p1"])
    require(leak["available"] and not leak["profile_holdout"]["complete"]
            and leak["profile_holdout"]["predicted_samples"] == 0
            and set(leak["profile_holdout"]["unavailable_profile_ids"]) == {"p0", "p1"},
            "Duplicate native aliases must be held out together, never leaked into training")
    poor = analysis._fit(np.column_stack([np.ones(4), [0, 1, 2, 3]]),
                         np.array([0, 0, 0, 100]), list("abcd"))
    require(poor["profile_holdout"]["q2"] < 0,
            "An inadequate predictive surface must retain negative Q-squared")
    return {"quadratic_profile_holdout_rmse": full["profile_holdout"]["rmse"],
            "negative_predictive_q2": poor["profile_holdout"]["q2"],
            "checks": ["average tied ranks", "known hierarchical polynomial",
                       "independent whole-profile prediction", "residual-degree refusal",
                       "partial-rank monotonicity", "constant and dependent ranks",
                       "duplicate-profile leakage refusal", "negative predictive Q-squared"]}


def authored_id(label):
    return digest({"authored_joint_analysis_check_only": label})


def paired_versions(row, version="3.20.0", basis="completed_stage_runtime"):
    info = {"model": "ndr", "comparison_version": version, "basis": basis}
    return {"policy": "completed_stage_runtime_else_observed_run_else_labeled_requested_legacy",
            "models": ["ndr"], "versions": {"ndr": version},
            "runs": {key: {"ndr": deepcopy(info)}
                     for key in {row["run_id"], row["baseline_run_id"]}}}


def attribution_checks():
    # Deliberately authored bookkeeping cases. Their IDs and values identify
    # only this check, and are never inserted into an application Workspace.
    scenario = authored_id("baseline scenario")
    baseline_run = authored_id("unsampled reference")
    support_a, support_b = authored_id("support A"), authored_id("support B")
    axis = {"id": "a", "label": "Authored check axis", "paths": ["ndr.k_param"],
            "distribution": "uniform", "lower": 1.0, "upper": 2.0,
            "units": "dimensionless", "reason": "Authored source-code check only",
            "references": ["This check's explicitly authored mathematical cases"]}
    replicates = [{"id": "first", "samples": 8, "seed": 11},
                  {"id": "second", "samples": 8, "seed": 29}]
    specification = {"title": "Authored attribution check", "reason": "Check separation only",
                     "scenario_ids": [], "axes": [axis], "replicates": replicates}
    definition = {"schema": analysis.DEFINITION_SCHEMA, "method": analysis.METHOD,
                  "specification": specification,
                  "baseline": {"workspace_id": "authored-check-only",
                               "grid_id": authored_id("grid"), "baseline_run_id": baseline_run,
                               "baseline_scenario_id": scenario},
                  "sampler": {"implementation": "authored check coordinates; no sampling run"},
                  "samples": []}
    mapping, rows = [], []
    for rep_index, replicate in enumerate(replicates):
        for ordinal in range(8):
            coordinate = (ordinal + (0.5 if rep_index == 0 else 0.25)) / 8
            value = 1 + coordinate
            sample = {"id": digest({"replicate_id": replicate["id"], "ordinal": ordinal}),
                      "replicate_id": replicate["id"], "ordinal": ordinal,
                      "coordinates": [coordinate], "values": {"a": value},
                      "overrides": {"ndr.k_param": value}}
            definition["samples"].append(sample)
            profile = authored_id([replicate["id"], ordinal, "profile"])
            mapping.append({"sample_id": sample["id"], "replicate_id": replicate["id"],
                            "ordinal": ordinal, "profile_id": profile})
            if ordinal == 7:
                continue  # Entire original case not yet materialized.
            row = {"id": authored_id([replicate["id"], ordinal, "case"]), "kind": "parameter",
                   "profile_id": profile, "scenario_id": scenario,
                   "run_id": authored_id([replicate["id"], ordinal, "run"]),
                   "baseline_run_id": baseline_run, "state": "complete",
                   "metrics": {"nitrogen": {
                       "support_sha256": support_b if ordinal == 2 else support_a,
                       "units": "kg/year", "paired_cells": 3, "reporting_cells": 3,
                       "paired_area_ha": 0.27, "alternative_total": float(10 + ordinal),
                       "reduction": float(-ordinal),
                       "relative_change_pct": None if ordinal == 1 else float(ordinal)}}}
            if ordinal == 5:
                row.update(state="failed", error={"message": "Authored missing-case check"})
            elif ordinal != 6:
                row["native_versions"] = paired_versions(
                    row, "3.19.0" if ordinal == 4 else "3.20.0",
                    "requested_legacy" if ordinal == 3 else "completed_stage_runtime")
            rows.append(row)
    summary = {"schema": "upstate.experiment-summary/v1", "id": authored_id("experiment"),
               "workspace_id": definition["baseline"]["workspace_id"],
               "grid_id": definition["baseline"]["grid_id"],
               "baseline": {"run_id": baseline_run}, "state": "incomplete",
               "models": ["ndr"], "pollutants": ["nitrogen"],
               "selection": {"scenario_ids": [], "profile_ids": [row["profile_id"] for row in mapping],
                             "axes": [], "design": "factorial"},
               "rows": rows}
    result = analysis.analyse(definition, mapping, summary, study_id=digest(definition))
    require(result["expected_samples"] == 16 and len(result["sample_observations"]) == 16,
            "Missing cases must not remove samples from the declared design")
    by_sample = {item["sample_id"]: item for item in result["sample_observations"]}
    for replicate in replicates:
        def observation(ordinal):
            return by_sample[digest({"replicate_id": replicate["id"], "ordinal": ordinal})]
        require(observation(5)["state"] == "failed" and observation(5)["native_error"],
                "The original failed case and its actual error must remain visible")
        require(observation(6)["metric"] is not None and observation(6)["exclusion"],
                "Missing producing provenance must retain the metric but refuse attribution")
        require(observation(7)["state"] == "not_materialized",
                "A missing native case must remain explicitly unmaterialized")
        groups = [group for group in result["groups"]
                  if group["replicate_id"] == replicate["id"] and group["outcome"] == "alternative_total"]
        require(len(groups) == 4 and sorted(group["analysed_samples"] for group in groups) == [1, 1, 1, 2],
                "Support, producing version and evidence basis must form four separate groups")
        require(all(group["expected_samples"] == 8 and not group["complete_design"] for group in groups),
                "A completed subset must keep the full eight-sample denominator")
        for group in groups:
            require(len(group["sample_ids"]) + len(group["excluded"]) == 8,
                    "Every group must account for every accepted or excluded original sample")
            selected = [by_sample[key] for key in group["sample_ids"]]
            require(all(item["replicate_id"] == replicate["id"]
                        and item["metric"]["support_sha256"] == group["support_sha256"]
                        and item["native_version_cohort_sha256"] == group["native_version_cohort_sha256"]
                        for item in selected),
                    "An attributed group must not mix replicate, support or producing cohort")
    require(result["replicate_comparisons"]
            and all(len(item["replicates"]) == 2 for item in result["replicate_comparisons"]),
            "Independent seed results must be retained as two separate reported replicates")
    candidate = deepcopy(rows[0])
    candidate["native_versions"]["runs"][candidate["run_id"]]["ndr"]["comparison_version"] = "3.19.0"
    refused(lambda: analysis._native_cohort(candidate, ["ndr"]), "Changed paired producing version was accepted")
    candidate = deepcopy(rows[0])
    key = candidate["run_id"]
    candidate["native_versions"]["runs"][authored_id("wrong paired run")] = candidate["native_versions"]["runs"].pop(key)
    refused(lambda: analysis._native_cohort(candidate, ["ndr"]), "Another native run's provenance was accepted")
    return {"authored_samples": 16, "group_count": len(result["groups"]),
            "checks": ["replicate separation", "exact support separation", "producing-version separation",
                       "observed versus requested-only evidence separation", "full missing-case denominator",
                       "retained failed-case error", "metric retained without attribution when provenance is absent",
                       "paired-run and producing-version binding"]}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True,
                        help="New receipt path outside the application and all scientific workspaces")
    args = parser.parse_args()
    destination = args.output.expanduser().absolute()
    if destination.is_relative_to(APPLICATION):
        raise ValueError("Keep the source check receipt outside the complete application")
    receipt = {"schema": "upstate.joint-parameter-analysis-check/v1",
               "scope": "Authored numerical and bookkeeping checks only; no scientific model or observed data",
               "native_model_executed": False, "workspace_opened": False,
               "python": sys.version, "numpy": np.__version__,
               "source": {"analysis_sha256": file_digest(Path(analysis.__file__)),
                          "check_sha256": file_digest(Path(__file__))},
               "numerical": numerical_checks(), "attribution": attribution_checks()}
    atomic_json(destination, receipt, immutable=True)
    print(json.dumps(receipt, ensure_ascii=False, allow_nan=False), flush=True)


if __name__ == "__main__":
    main()
