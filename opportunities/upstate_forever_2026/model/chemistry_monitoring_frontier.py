"""Monitoring budget and missed-visit decisions using the retained chemistry engine.

No forward model, fitting algorithm or D-optimal selector is replaced here.
The native tangent/monitoring APIs supply every sensitivity and selection.
This module evaluates their selections with the same declared precision model.
"""
from __future__ import annotations

from copy import deepcopy
import hashlib
import json
from typing import Any
from pathlib import Path
from .reach_chemistry import inference as native_inference, model as native_model, solver as native_solver

import numpy as np

from .reach_chemistry.inference import design_monitoring, sensitivity
from .reach_chemistry.model import Project

SCHEMA = "upstate.chemistry-monitoring-frontier/v1"
EDITION = "native-monitoring-budget-time-feasible-recovery-20261013-v1"

def identify(result: dict) -> dict:
    """Bind scientific inputs to this implementation and the exact retained kernel."""
    source_paths = {"frontier": Path(__file__), "inference": Path(native_inference.__file__),
                    "model": Path(native_model.__file__), "solver": Path(native_solver.__file__)}
    result["method_edition"] = EDITION
    result["native_source_sha256"] = {k: hashlib.sha256(p.read_bytes()).hexdigest() for k,p in source_paths.items()}
    keys = ("schema", "method_edition", "native_source_sha256", "original_project_sha256", "calibrated_project_sha256",
            "parameters", "candidates", "assay_budget", "prior_precision", "prior_multipliers")
    identity = {k: result[k] for k in keys}
    result["study_id"] = hashlib.sha256(json.dumps(identity, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False).encode()).hexdigest()
    return result


def _array(value: Any, name: str) -> np.ndarray:
    out = np.asarray(value, dtype=float)
    if not np.isfinite(out).all():
        raise ValueError(f"{name} contains non-finite values")
    return out


def _precision(prior: np.ndarray, weighted: np.ndarray, indices: list[int]) -> np.ndarray:
    selected = weighted[indices]
    return prior + selected.T @ selected


def _metrics(precision: np.ndarray, prior: np.ndarray, spans: np.ndarray) -> dict:
    covariance = np.linalg.solve(precision, np.eye(len(spans)))
    sign, logdet = np.linalg.slogdet(precision)
    if sign <= 0:
        raise ValueError("Selected precision is not positive definite")
    prior_logdet = float(np.linalg.slogdet(prior)[1])
    sd = np.sqrt(np.diag(covariance))
    correlation = covariance / np.outer(sd, sd)
    scaled = spans[:, None] * precision * spans[None, :]
    return {
        "logdet_precision": float(logdet),
        "logdet_gain_from_prior": float(logdet - prior_logdet),
        "linearized_parameter_sd": sd.tolist(),
        "linearized_parameter_correlation": correlation.tolist(),
        "range_scaled_precision_condition_number": float(np.linalg.cond(scaled)),
        "precision": precision.tolist(),
    }


def _coverage(candidates: list[dict], indices: list[int]) -> dict:
    rows = [candidates[i] for i in indices]
    return {
        "assays": len(rows),
        "reach_day_visits": len({(r["reach"], r["day"]) for r in rows}),
        "sampling_days": sorted({r["day"] for r in rows}),
        "reaches": sorted({r["reach"] for r in rows}),
        "species": sorted({r["species"] for r in rows}),
        "candidate_ids": [r["id"] for r in rows],
    }


def _label_scale(value: float) -> str:
    return format(value, ".12g")


def build(project: dict, monitoring_request: dict, retained_monitoring: dict,
          retained_calibration: dict, *, budget: int | None = None,
          prior_multipliers: tuple[float, ...] = (0.25, 1.0, 4.0),
          cancelled=None) -> dict:
    """Build complete native frontiers and same-budget missed-visit recovery.

    Precision multipliers are declared planning sensitivity cases, not posterior
    probabilities. The calibrated point estimate uses the original planning
    prior so the central contrast isolates the effect of the retained fit.
    All observation fit/holdout labels remain attached; no refit is performed.
    """
    original = Project(deepcopy(project))
    calibrated_raw = retained_calibration.get("calibrated_project")
    if not calibrated_raw or not retained_calibration.get("converged"):
        raise ValueError("Select a completed converged native calibration")
    calibrated = Project(deepcopy(calibrated_raw))
    if retained_calibration.get("original_project_sha256") != original.fingerprint:
        raise ValueError("Calibration does not belong to the selected original project")
    if retained_calibration.get("calibrated_project_sha256") != calibrated.fingerprint:
        raise ValueError("Retained calibrated project identity differs")
    if retained_monitoring.get("project_sha256") != original.fingerprint:
        raise ValueError("Monitoring does not belong to the selected original project")
    candidates = deepcopy(monitoring_request["observations"])
    parameter_rows = deepcopy(monitoring_request["parameters"])
    ids = [r["id"] for r in candidates]
    if len(set(ids)) != len(ids):
        raise ValueError("Candidate IDs must be unique")
    lookup = {ident: i for i, ident in enumerate(ids)}
    prior = _array(monitoring_request["prior_precision"], "prior_precision")
    npars = len(parameter_rows)
    if prior.shape != (npars, npars) or not np.allclose(prior, prior.T):
        raise ValueError("Planning prior must be symmetric and parameter-sized")
    np.linalg.cholesky(prior)
    spans = _array([p["upper"] - p["lower"] for p in parameter_rows], "parameter ranges")
    if np.any(spans <= 0):
        raise ValueError("Each parameter needs a positive explicit range")
    sigma = _array([r["sigma_mg_l"] for r in candidates], "candidate sigma")
    if np.any(sigma <= 0):
        raise ValueError("Each candidate needs positive sigma_mg_l")
    if budget is None:
        budget = monitoring_request["count"]
    if isinstance(budget, bool) or not isinstance(budget, int) or not 1 <= budget <= len(ids):
        raise ValueError("Budget must be an integer from 1 to the number of candidates")
    scales = sorted(set(float(x) for x in prior_multipliers))
    if not scales or any(not np.isfinite(x) or x <= 0 for x in scales) or 1.0 not in scales:
        raise ValueError("Prior multipliers must be positive finite and include 1")
    if retained_monitoring.get("parameters") != parameter_rows:
        raise ValueError("Retained monitoring uses a different parameter definition")
    if not np.allclose(retained_monitoring["prior_precision"], prior, rtol=0, atol=0):
        raise ValueError("Retained monitoring uses a different prior")

    projects = {"original": original, "calibrated": calibrated}
    sensitivities, weighted = {}, {}
    for name, p in projects.items():
        native = sensitivity(p, parameter_rows, candidates, cancelled=cancelled)
        sensitivities[name] = native
        jac = _array([[d["mg_l_per_parameter_unit"] for d in row["derivatives"]]
                      for row in native["rows"]], f"{name} tangent matrix")
        weighted[name] = jac / sigma[:, None]

    designs, frontiers, cross, prior_sensitivity = {}, [], [], []
    original_selected = [r["candidate"]["id"] for r in retained_monitoring["selected"]]
    native_agreement = {}
    for name, p in projects.items():
        for scale in scales:
            selected_prior = prior * scale
            native = design_monitoring(p, parameter_rows, candidates, count=len(ids),
                                       prior_precision=selected_prior.tolist(), cancelled=cancelled)
            key = f"{name}:prior-{_label_scale(scale)}"
            designs[key] = native
            order = [lookup[row["candidate"]["id"]] for row in native["selected"]]
            if len(order) < budget:
                raise ValueError(f"{key}: requested budget exceeds informative native selections")
            if name == "original" and scale == 1:
                actual_prefix = [ids[i] for i in order[:len(original_selected)]]
                if actual_prefix != original_selected:
                    raise ValueError("Native full frontier does not preserve the original selected sequence")
                actual_precision = _precision(prior, weighted[name], order[:len(original_selected)])
                retained_precision = _array(retained_monitoring["posterior_linearized_precision"], "retained precision")
                if not np.allclose(actual_precision, retained_precision, rtol=2e-10, atol=1e-9):
                    raise ValueError("Native sensitivities do not reproduce retained monitoring precision")
                native_agreement = {
                    "selected_sequence_matches": True,
                    "original_selected_count": len(original_selected),
                    "maximum_precision_absolute_difference": float(np.max(np.abs(actual_precision-retained_precision))),
                }
            for count in range(len(order)+1):
                selected = order[:count]
                value = _metrics(_precision(selected_prior, weighted[name], selected), selected_prior, spans)
                frontiers.append({"design_state": name, "prior_multiplier": scale,
                                  **_coverage(candidates, selected), **value})
            prior_sensitivity.append({"design_state": name, "prior_multiplier": scale,
                                      **_coverage(candidates, order[:budget])})

    # Equal-count cross-evaluation makes the cost of using an earlier schedule visible.
    for evaluation_state in projects:
        reference_order = [lookup[r["candidate"]["id"]] for r in designs[f"{evaluation_state}:prior-1"]["selected"]]
        for design_state in projects:
            order = [lookup[r["candidate"]["id"]] for r in designs[f"{design_state}:prior-1"]["selected"]]
            for count in range(min(len(order), len(reference_order))+1):
                value = _metrics(_precision(prior, weighted[evaluation_state], order[:count]), prior, spans)
                reference = _metrics(_precision(prior, weighted[evaluation_state], reference_order[:count]), prior, spans)
                ratio = float(np.exp((value["logdet_precision"]-reference["logdet_precision"])/npars))
                cross.append({"design_state": design_state, "evaluation_state": evaluation_state,
                              "relative_d_criterion_to_native_greedy": ratio,
                              **_coverage(candidates, order[:count]), **value})

    # Losing a date removes all that date's selected assays. Losing a visit
    # removes the reach/day bundle. Existing selected assays are never replaced.
    disruptions, native_recovery = [], {}
    for design_state in projects:
        order = [lookup[r["candidate"]["id"]] for r in designs[f"{design_state}:prior-1"]["selected"]][:budget]
        full = _metrics(_precision(prior, weighted["calibrated"], order), prior, spans)
        for loss_kind in ("reach_day_visit", "sampling_day"):
            groups = sorted({(candidates[i]["reach"], candidates[i]["day"]) if loss_kind == "reach_day_visit"
                             else ("all_reaches", candidates[i]["day"]) for i in order}, key=lambda g:(g[1], g[0]))
            for reach, day in groups:
                excluded = [i for i, row in enumerate(candidates)
                            if row["day"] == day and (loss_kind == "sampling_day" or row["reach"] == reach)]
                removed = [i for i in order if i in excluded]
                retained = [i for i in order if i not in excluded]
                available = [i for i in range(len(ids)) if i not in excluded and i not in retained]
                remaining_precision = _precision(prior, weighted["calibrated"], retained)
                missing_metrics = _metrics(remaining_precision, prior, spans)
                operation = f"{design_state}-{loss_kind}-{reach}-{day}"
                def comparison(m):
                    delta = m["logdet_precision"] - full["logdet_precision"]
                    return {"relative_d_criterion_to_uninterrupted": float(np.exp(delta/npars)),
                            "linearized_ellipsoid_volume_ratio": float(np.exp(-delta/2))}
                row = {"id": operation, "design_state": design_state,
                    "evaluation_state": "calibrated", "loss_kind": loss_kind,
                    "lost_reach": reach, "lost_day": day,
                    "removed_candidate_ids": [ids[i] for i in removed],
                    "unavailable_candidate_ids": [ids[i] for i in excluded],
                    "kept_candidate_ids": [ids[i] for i in retained],
                    "complete": {**_coverage(candidates, order), **full},
                    "interrupted": {**_coverage(candidates, retained), **missing_metrics, **comparison(missing_metrics)}}
                for timing in ("preplanned", "reactive_after_day"):
                    # A plan prepared before the campaign can move an assay earlier.
                    # A response after a missed day cannot go back in model time.
                    eligible = available if timing == "preplanned" else [i for i in available if candidates[i]["day"] > day]
                    recovery_count = min(len(removed), len(eligible))
                    native = design_monitoring(calibrated, parameter_rows, [candidates[i] for i in eligible],
                        count=recovery_count, prior_precision=remaining_precision.tolist(), cancelled=cancelled) if recovery_count else None
                    added = [lookup[r["candidate"]["id"]] for r in native["selected"]] if native else []
                    if native:
                        native_recovery[operation+":"+timing] = native
                    repaired = retained + added
                    repaired_metrics = _metrics(_precision(prior, weighted["calibrated"], repaired), prior, spans)
                    row[timing] = {**_coverage(candidates, repaired), **repaired_metrics, **comparison(repaired_metrics),
                                   "replacement_candidate_ids": [ids[i] for i in added],
                                   "eligible_replacement_ids": [ids[i] for i in eligible],
                                   "unfilled_assay_slots": len(removed)-len(added)}
                disruptions.append(row)

    result = {
        "schema": SCHEMA, "title": "Reach chemistry: monitoring budget and recovery decisions",
        "input_kind": "existing constructed four-reach teaching case",
        "original_project_sha256": original.fingerprint,
        "calibrated_project_sha256": calibrated.fingerprint,
        "parameters": parameter_rows, "candidate_count": len(candidates),
        "candidates": candidates, "assay_budget": budget, "prior_precision": prior.tolist(),
        "prior_multipliers": scales, "native_agreement": native_agreement,
        "method": {
            "selector": "unchanged reach_chemistry.inference.design_monitoring",
            "sensitivities": "unchanged exact forward-tangent sparse matrix exponential",
            "precision": "P = declared planning prior + sum(j_i.T j_i / sigma_i^2)",
            "noise": "Declared independent Gaussian assay errors; original sigma_mg_l retained.",
            "scaling": "Condition number uses explicit parameter-range coordinates.",
            "recovery": "Keep every unaffected planned assay. Preplanned unavailability permits all other dates; reactive recovery after the missed day permits only strictly later candidate days. Native greedy selection fills available slots; unfilled slots remain explicit.",
            "calibration": "Reuse the completed native fit; retain original fit/holdout labels; do not refit or update the planning prior.",
            "budget": "Assay count, not field-visit count, currency or travel time; visit/day counts are reported separately.",
            "interpretation": "Local design criteria and linearized planning spreads under the supplied model, not global design optima or field confidence intervals.",
        },
        "native_sensitivity": sensitivities, "native_designs": designs,
        "frontiers": frontiers, "cross_evaluation": cross,
        "prior_sensitivity_at_budget": prior_sensitivity,
        "disruptions": disruptions, "native_recovery": native_recovery,
        "reused_uncertainty_run": "The original 512-draw result is retained in the input bank; its forward simulations are not repeated by this study.",
        "references": [
            {"title": "NIST/SEMATECH: D-optimal designs", "url": "https://www.itl.nist.gov/div898/handbook/pri/section5/pri521.htm"},
            {"title": "NIST/SEMATECH: computer-aided design and model dependence", "url": "https://www.itl.nist.gov/div898/handbook/pri/section5/pri52.htm"},
        ],
    }
    return identify(result)
