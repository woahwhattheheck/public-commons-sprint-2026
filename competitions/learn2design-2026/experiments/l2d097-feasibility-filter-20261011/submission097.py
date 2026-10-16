"""Learn2Design development candidate 097: physical-feasibility filter with trust backtracking.

Uses the organizer's Objective, its unbounded coordinates and its reported physical
is_feasible flag. Every loss in this algorithm comes from a logged Objective call;
Objective's feasible-history and final scoring remain authoritative.

Distinct from rotating-restart/late-polish candidates: a feasible anchor is *not*
moved when a worse or physically infeasible proposal is observed. Instead that
same anchor is tried again with a smaller, optionally rotated trust step. When
the feasible basin stalls, the algorithm resumes global exploration while
retaining the best feasible coordinates, rather than getting stuck at a boundary.
"""
from __future__ import annotations

import math
import time
from collections.abc import Mapping

import jax
import jax.numpy as jnp
from dfbench import Objective, OptimizationAlgorithm


class FeasibilityFilterTrust097(OptimizationAlgorithm):
    algorithm_str = "tjlabs_feasibility_filter_trust097"

    def __init__(self):
        self.last_run_diagnostics = {}

    def optimize(
        self, objective: Objective, init_params=None, random_seed=None,
        learning_rate=0.08, trust_radius=0.30, min_radius=0.005,
        max_radius=0.8, shrink=0.55, grow=1.08, reject_limit=10,
        restore_patience=120, restore_noise=0.05, stop_margin=1.2,
        return_reserve_s=0.05, **kwargs
    ) -> None:
        if not (0 < learning_rate <= 1 and
                0 < min_radius <= trust_radius <= max_radius <= 2 and
                0 < shrink < 1 < grow <= 2 and
                0 <= restore_noise <= 1):
            raise ValueError("invalid search/step parameters")
        if type(reject_limit) is not int or not 2 <= reject_limit <= 100:
            raise ValueError("reject_limit must be integer in [2, 100]")
        if type(restore_patience) is not int or not 20 <= restore_patience <= 10000:
            raise ValueError("restore_patience must be integer in [20, 10000]")
        if not (math.isfinite(stop_margin) and 1 <= stop_margin <= 3 and
                math.isfinite(return_reserve_s) and 0 <= return_reserve_s <= 5):
            raise ValueError("invalid predictive-stop parameters")

        obj = objective
        _, key = self.prepare(obj, unbounded=True, random_seed=random_seed)
        params = jnp.asarray(init_params) if init_params is not None else jnp.asarray(obj.random_params_unbounded())
        constrained = obj.power_thresholds is not None
        if constrained:
            obj.warmup_value_and_grad_aux()
        else:
            obj.warmup_value_and_grad()

        diag = {
            "algorithm": self.algorithm_str, "calls": 0,
            "physically_feasible_calls": 0, "accepted_feasible_steps": 0,
            "rejected_infeasible_steps": 0, "rejected_nonimproving_steps": 0,
            "recovery_restarts": 0, "feasible_basin_exits": 0,
            "best_observed_feasible_loss": None,
            "stopped_predictively": False,
            "mean_eval_s": None,
            "note": "Diagnostic only; Objective's recorded feasible history defines the score.",
        }
        self.last_run_diagnostics = diag
        obj.start_logging()

        # Two distinct search phases: RESTORE finds *a* physical feasible point;
        # FILTER performs monotone feasible acceptance around that anchor.
        phase = "RESTORE"
        anchor = None
        incumbent = None
        best_raw = math.inf
        raw_no_improve = 0
        radius = float(trust_radius)
        rejected = 0
        m = jnp.zeros_like(params)
        v = jnp.zeros_like(params)
        moment_step = 0
        pending_m = pending_v = None
        pending_t = 0
        ewma = last_dt = None
        beta1, beta2 = 0.9, 0.999

        def reserve_exhausted():
            left = obj.evals_left
            if left is not None and left < 1:
                return True
            # Do not turn a 60-second run into an unlogged final evaluation;
            # use the last observed call cost plus a small exit reserve.
            if ewma is None:
                return False
            seconds = obj.time_left
            if seconds is None:
                return False
            seconds = float(seconds)
            return (math.isfinite(seconds) and
                    seconds < stop_margin * max(ewma, last_dt) + return_reserve_s)

        def adam_proposal(p, g, m0, v0, t, rad):
            mm = beta1 * m0 + (1.0 - beta1) * g
            vv = beta2 * v0 + (1.0 - beta2) * jnp.square(g)
            tt = t + 1
            corrected_m = mm / (1.0 - beta1 ** tt)
            corrected_v = vv / (1.0 - beta2 ** tt)
            direction = -learning_rate * corrected_m / (jnp.sqrt(corrected_v) + 1e-8)
            direction = direction * jnp.minimum(1., rad / (jnp.linalg.norm(direction) + 1e-12))
            return p + direction, mm, vv, tt

        def restart():
            nonlocal params, phase, anchor, best_raw, raw_no_improve
            nonlocal radius, rejected, m, v, moment_step, key
            # Preserve global best feasible but try a *new* basin. No evidence
            # is overwritten or pruned from Objective's own score history.
            phase, anchor = "RESTORE", None
            params = jnp.asarray(obj.random_params_unbounded())
            best_raw, raw_no_improve = math.inf, 0
            radius, rejected = float(trust_radius), 0
            m, v = jnp.zeros_like(params), jnp.zeros_like(params)
            moment_step = 0
            diag["recovery_restarts"] += 1

        while not obj.budget_exceeded:
            if reserve_exhausted():
                diag["stopped_predictively"] = True
                break

            t0 = time.perf_counter()
            if constrained:
                loss, grad, aux = obj.value_and_grad_aux(params)
                if not isinstance(aux, Mapping) or "is_feasible" not in aux:
                    raise ValueError("Objective aux must contain physical is_feasible")
                flag = jnp.asarray(aux["is_feasible"])
                if flag.shape != () or flag.dtype.kind != "b":
                    raise ValueError("Objective is_feasible must be scalar bool")
                feasible = bool(flag)
            else:
                loss, grad = obj.value_and_grad(params)
                feasible = True
            finite = (bool(jnp.isfinite(loss)) and bool(jnp.all(jnp.isfinite(grad)))
                      and bool(jnp.all(jnp.isfinite(params))))
            value = float(loss) if bool(jnp.isfinite(loss)) else math.inf
            last_dt = time.perf_counter() - t0  # includes device-to-host feasibility/gradient checks
            ewma = last_dt if ewma is None else .7 * ewma + .3 * last_dt
            diag["calls"] += 1
            diag["mean_eval_s"] = ewma
            diag["physically_feasible_calls"] += int(feasible)
            if feasible and finite and (incumbent is None or value < incumbent[0]):
                incumbent = (value, params)
                diag["best_observed_feasible_loss"] = value

            if phase == "RESTORE":
                # A genuine feasible observation immediately starts boundary
                # filtering. Merely low penalized loss never counts as feasible.
                if finite and feasible:
                    phase = "FILTER"
                    anchor = (value, params, grad)
                    radius, rejected = float(trust_radius), 0
                    m, v = jnp.zeros_like(params), jnp.zeros_like(params)
                    moment_step = 0
                elif finite:
                    if value < best_raw:
                        best_raw, raw_no_improve = value, 0
                    else:
                        raw_no_improve += 1
                    if raw_no_improve >= restore_patience:
                        restart()
                        continue
                    proposal, mm, vv, tt = adam_proposal(params, grad, m, v, moment_step, radius)
                    m, v, moment_step = mm, vv, tt
                    key, noise_key = jax.random.split(key)
                    noise = jax.random.normal(noise_key, params.shape, dtype=params.dtype)
                    proposal = proposal + restore_noise * radius * noise
                    if not bool(jnp.all(jnp.isfinite(proposal))):
                        restart()
                        continue
                    params = proposal
                    continue
                else:
                    restart()
                    continue
            else:
                # A candidate proposal is evaluated by the real Objective. Only
                # *physical feasibility AND improvement* can move the anchor.
                if finite and feasible and value < anchor[0]:
                    anchor = (value, params, grad)
                    m, v, moment_step = pending_m, pending_v, pending_t
                    radius = min(max_radius, radius * grow)
                    rejected = 0
                    diag["accepted_feasible_steps"] += 1
                else:
                    rejected += 1
                    radius = max(min_radius, radius * shrink)
                    if not feasible:
                        diag["rejected_infeasible_steps"] += 1
                    else:
                        diag["rejected_nonimproving_steps"] += 1
                    if rejected >= reject_limit or radius <= min_radius * (1 + 1e-6):
                        diag["feasible_basin_exits"] += 1
                        restart()
                        continue

            # Construct the NEXT boundary-filter trial from the *unchanged*
            # feasible anchor. Rejected proposal gradients never drive a step.
            base_value, base_params, base_grad = anchor
            params, pending_m, pending_v, pending_t = adam_proposal(
                base_params, base_grad, m, v, moment_step, radius)
            # When a candidate is repeatedly rejected, rotate the step slightly
            # rather than repeating a collinear path on a curved boundary.
            if rejected >= 3:
                key, perturb_key = jax.random.split(key)
                perturb = jax.random.normal(perturb_key, base_params.shape, dtype=base_params.dtype)
                perturb = perturb / (jnp.linalg.norm(perturb) + 1e-12)
                params = params + radius * min(0.25, .05 * rejected) * perturb
            if not bool(jnp.all(jnp.isfinite(params))):
                diag["feasible_basin_exits"] += 1
                restart()
        return None
