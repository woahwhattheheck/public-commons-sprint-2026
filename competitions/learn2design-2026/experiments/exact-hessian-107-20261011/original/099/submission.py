"""tjlabs_measured_portfolio099: noisy clipped-Adam portfolio with
feasibility-anchored trust-region acceptance.

Lineage (read, not modified):
  outputs/l2d-candidate084-stage-20261010/baseline-extract/submission_v1.py  (V1)
  outputs/l2d096-stage-20261011/delivery/submission096.py                    (096)

The search uses V1's starting machinery unchanged: prepare(unbounded=True),
the start list, clipped Adam(0.08), the trust radii, the noise schedule and the
key splitting.

ONE substantive change. V1 always moves to its last proposal. This version
keeps a per-restart *anchor*: the best point seen so far, ranked by
feasibility first and loss second. It also stores the anchor's gradient.
- Each proposal is judged when its own logged value_and_grad_aux returns.
- A proposal is accepted if it beats the anchor under the feasibility-first order.
- A limited "excursion" lets the search briefly continue from a point that is
  not better. Examples are an infeasible point with lower loss, or a point that
  is slightly worse.
- Otherwise the proposal is rejected. The next proposal is then built from the
  stored anchor gradient with a smaller radius. Backtracking therefore costs no
  extra Objective call.
- The radius grows or shrinks from the ratio of actual to predicted
  (first-order) decrease.
- The late-restart pull targets the best FEASIBLE point, not the best raw-loss point.

Required supporting mechanics, not separate algorithmic ideas:
- A predictive stop before every Objective call. It uses measured durations of
  completed calls: the larger of the EWMA and the recent maximum.
- Restart patience is scaled from the measured number of calls expected to fit
  in the remaining time.

No result-producing Objective method is called before start_logging(). Before
logging, the only Objective calls are prepare(), random_params_unbounded(),
power_thresholds and a warmup_* method. A pure-optax proposal function is
jit-compiled before logging on dummy arrays; it touches no Objective result.
The Objective budget, clock, penalty and scoring are never modified.
"""
from __future__ import annotations

import math
import time
from collections import deque

from dfbench import Objective, OptimizationAlgorithm
import jax
import jax.numpy as jnp
import optax


class MeasuredPortfolio099(OptimizationAlgorithm):
    algorithm_str = "tjlabs_measured_portfolio099"

    def __init__(self):
        self.last_run_diagnostics = {}

    def optimize(
        self,
        objective: Objective,
        init_params=None,
        random_seed: int | None = None,
        # --- V1-inherited search hyperparameters ---
        learning_rate: float = 0.08,
        restarts: int = 5,
        trust_radius: float = 0.30,
        min_trust_radius: float = 0.01,
        max_trust_radius: float = 0.80,
        noise_start: float = 0.10,
        noise_decay: float = 0.997,
        pull_weight: float = 0.25,
        # --- feasibility-anchored acceptance (the new mechanism) ---
        max_excursion: int = 3,
        nonmonotone_slack: float = 0.01,
        ratio_low: float = 0.10,
        ratio_high: float = 0.75,
        radius_grow: float = 1.5,
        radius_shrink: float = 0.6,
        # --- measured-call-count adaptive restart patience ---
        patience_fraction: float = 0.35,
        min_patience: int = 40,
        max_patience: int = 400,
        # --- predictive budget stop ---
        stop_margin: float = 1.15,
        return_reserve_s: float = 0.05,
        duration_window: int = 8,
        fallback_time_cap_s: float = 4.0 * 3600.0,
        **kwargs,
    ) -> None:
        obj = objective

        # ---------------- validation ----------------
        if type(restarts) is not int or not 1 <= restarts <= 16:
            raise ValueError("restarts must be int in [1,16]")
        if not (0.0 < learning_rate <= 1.0):
            raise ValueError("learning_rate must be in (0,1]")
        if not (0 < min_trust_radius <= trust_radius <= max_trust_radius <= 2.0):
            raise ValueError("invalid trust radii")
        if not (0.0 <= noise_start <= 1.0 and 0.9 <= noise_decay <= 1.0):
            raise ValueError("invalid noise schedule")
        if not (0.0 <= pull_weight < 1.0):
            raise ValueError("pull_weight must be in [0,1)")
        if type(max_excursion) is not int or not 0 <= max_excursion <= 20:
            raise ValueError("max_excursion must be int in [0,20]")
        if not (0.0 <= nonmonotone_slack <= 0.2):
            raise ValueError("nonmonotone_slack must be in [0,0.2]")
        if not (0.0 <= ratio_low < ratio_high <= 1.0):
            raise ValueError("invalid trust ratio thresholds")
        if not (1.0 < radius_grow <= 3.0 and 0.1 <= radius_shrink < 1.0):
            raise ValueError("invalid radius factors")
        if not (0.0 < patience_fraction <= 1.0):
            raise ValueError("patience_fraction must be in (0,1]")
        if (type(min_patience) is not int or type(max_patience) is not int
                or not 5 <= min_patience <= max_patience):
            raise ValueError("invalid patience bounds")
        if not (math.isfinite(stop_margin) and 1.0 <= stop_margin <= 3.0
                and math.isfinite(return_reserve_s) and 0.0 <= return_reserve_s <= 5.0):
            raise ValueError("invalid stop safeguard")
        if type(duration_window) is not int or not 1 <= duration_window <= 64:
            raise ValueError("duration_window must be int in [1,64]")
        if not (math.isfinite(fallback_time_cap_s) and fallback_time_cap_s > 0.0):
            raise ValueError("fallback_time_cap_s must be positive and finite")

        # ---------------- source-faithful setup (as V1) ----------------
        _, key = self.prepare(obj, unbounded=True, random_seed=random_seed)
        if random_seed is None:
            random_seed = 0

        starts = []
        if init_params is not None:
            starts.append(jnp.asarray(init_params))
        while len(starts) < restarts:
            starts.append(jnp.asarray(obj.random_params_unbounded()))

        # Aux is available only on problems that opt into the penalty contract.
        use_aux = obj.power_thresholds is not None

        optimizer = optax.chain(
            optax.clip_by_global_norm(1.0),
            optax.adam(learning_rate),
        )

        @jax.jit
        def propose(base, grad, state, radius, noise_scale, noise_key, target, weight):
            updates, new_state = optimizer.update(grad, state, base)
            norm = jnp.linalg.norm(updates)
            scale = jnp.minimum(1.0, radius / (norm + 1e-12))
            step = updates * scale
            noise = jax.random.normal(noise_key, base.shape, dtype=base.dtype)
            proposal = base + step + noise_scale * radius * noise
            proposal = (1.0 - weight) * proposal + weight * target
            predicted_decrease = -jnp.vdot(grad, proposal - base)
            return proposal, new_state, predicted_decrease, norm * scale

        # Objective-provided warmup (free, documented).
        if use_aux:
            obj.warmup_value_and_grad_aux()
        else:
            obj.warmup_value_and_grad()

        # Pure-optax compile on dummy data. No Objective result is used.
        # split(key) is functional, so `key` itself is not consumed.
        _, warm_key = jax.random.split(key)
        dummy = starts[0]
        jax.block_until_ready(propose(
            dummy, jnp.zeros_like(dummy), optimizer.init(dummy),
            float(trust_radius), float(noise_start), warm_key, dummy, 0.0))

        diag = {
            "algorithm_str": self.algorithm_str,
            "uses_aux": use_aux,
            "calls": 0,
            "accepted": 0,
            "excursions": 0,
            "rejected": 0,
            "nonfinite": 0,
            "restarts_started": 0,
            "stopped_predictively": False,
            "ewma_call_s": None,
            "max_recent_call_s": None,
            "note": "bookkeeping only; Objective history is authoritative",
        }
        self.last_run_diagnostics = diag

        obj.start_logging()

        # ---------------- timing model ----------------
        durations = deque(maxlen=duration_window)
        ewma = [None]

        def remaining_time():
            tl = obj.time_left
            if tl is None:
                # No Objective time budget configured: use our own conservative cap.
                # This does not set or replace the Objective's budget.
                return fallback_time_cap_s - float(obj.time_elapsed)
            return float(tl)

        def predicted_call_s():
            return max(ewma[0], max(durations))

        def should_stop():
            if obj.budget_exceeded:
                return True
            left = obj.evals_left
            if left is not None and left < 1:
                return True
            tl = remaining_time()
            if not durations:
                # The first call is always attempted: a run needs a logged entry.
                return False
            if not math.isfinite(tl):
                return False
            return tl < stop_margin * predicted_call_s() + return_reserve_s

        def current_patience(calls_done):
            if not durations:
                return min_patience
            tl = max(0.0, remaining_time())
            expected_total = calls_done + tl / max(predicted_call_s(), 1e-6)
            left = obj.evals_left
            if left is not None:
                expected_total = min(expected_total, calls_done + float(left))
            p = int(round(patience_fraction * expected_total))
            return max(min_patience, min(max_patience, p))

        def evaluate(p):
            t0 = time.perf_counter()
            if use_aux:
                loss, grad, aux = obj.value_and_grad_aux(p)
                feasible = bool(aux["is_feasible"])
            else:
                loss, grad = obj.value_and_grad(p)
                feasible = True  # unknown on non-constrained problems
            loss_f = float(loss)
            finite = math.isfinite(loss_f) and bool(jnp.all(jnp.isfinite(grad)))
            dt = time.perf_counter() - t0
            durations.append(dt)
            ewma[0] = dt if ewma[0] is None else 0.7 * ewma[0] + 0.3 * dt
            diag["calls"] += 1
            diag["ewma_call_s"] = ewma[0]
            diag["max_recent_call_s"] = max(durations)
            return loss_f, grad, feasible, finite

        def better(loss_a, feas_a, loss_b, feas_b):
            if feas_a != feas_b:
                return feas_a
            return loss_a < loss_b

        # ---------------- portfolio loop ----------------
        best_feasible_params = None
        best_feasible_loss = math.inf
        radius_carry = float(trust_radius)
        global_iteration = 0
        restart_index = -1
        stop = False

        while not stop:
            restart_index += 1
            if restart_index < len(starts):
                start = starts[restart_index]
            else:
                start = jnp.asarray(obj.random_params_unbounded())
            if should_stop():
                diag["stopped_predictively"] = not obj.budget_exceeded
                break
            diag["restarts_started"] += 1

            state = optimizer.init(start)
            radius = radius_carry
            anchor = None  # dict(params, loss, grad, feasible)
            params = start
            last_pred = None
            last_base_loss = None
            last_step_len = 0.0
            last_radius_used = radius
            stall = 0
            excursion = 0

            while True:
                if should_stop():
                    stop = True
                    diag["stopped_predictively"] = not obj.budget_exceeded
                    break

                loss, grad, feasible, finite = evaluate(params)

                if not finite:
                    diag["nonfinite"] += 1
                    radius = max(min_trust_radius, radius * radius_shrink)
                    if anchor is None:
                        break  # no usable point in this restart
                    base_params, base_grad, base_loss = anchor["params"], anchor["grad"], anchor["loss"]
                    excursion = 0
                    stall += 1
                else:
                    if feasible and loss < best_feasible_loss:
                        best_feasible_loss = loss
                        best_feasible_params = params

                    rho = None
                    if last_pred is not None and last_pred > 1e-12:
                        rho = (last_base_loss - loss) / last_pred

                    if anchor is None or better(loss, feasible, anchor["loss"], anchor["feasible"]):
                        anchor = {"params": params, "loss": loss, "grad": grad, "feasible": feasible}
                        base_params, base_grad, base_loss = params, grad, loss
                        stall = 0
                        excursion = 0
                        diag["accepted"] += 1
                        if (rho is not None and rho > ratio_high
                                and last_step_len >= 0.9 * last_radius_used):
                            radius = min(max_trust_radius, radius * radius_grow)
                        elif rho is not None and rho < ratio_low:
                            radius = max(min_trust_radius, radius * radius_shrink)
                    else:
                        stall += 1
                        slack = nonmonotone_slack * max(1.0, abs(anchor["loss"]))
                        lower_loss_infeasible = (anchor["feasible"] and not feasible
                                                 and loss < anchor["loss"])
                        near = loss <= anchor["loss"] + slack and (feasible or not anchor["feasible"])
                        if excursion < max_excursion and (lower_loss_infeasible or near):
                            excursion += 1
                            base_params, base_grad, base_loss = params, grad, loss
                            diag["excursions"] += 1
                            if rho is not None and rho < ratio_low:
                                radius = max(min_trust_radius, radius * radius_shrink)
                        else:
                            # Zero-cost backtrack: rebuild from the stored anchor gradient.
                            excursion = 0
                            base_params, base_grad, base_loss = anchor["params"], anchor["grad"], anchor["loss"]
                            radius = max(min_trust_radius, radius * radius_shrink)
                            diag["rejected"] += 1

                patience = current_patience(diag["calls"])
                if stall >= patience:
                    break  # restart

                key, noise_key = jax.random.split(key)
                noise_scale = noise_start * (noise_decay ** global_iteration)
                if (restart_index > 0 and stall > patience // 2
                        and best_feasible_params is not None and pull_weight > 0.0):
                    target, weight = best_feasible_params, pull_weight
                else:
                    target, weight = base_params, 0.0

                proposal, state, pred, step_len = propose(
                    base_params, base_grad, state, float(radius), float(noise_scale),
                    noise_key, target, float(weight))
                params = proposal
                last_pred = float(pred)
                last_base_loss = base_loss
                last_step_len = float(step_len)
                last_radius_used = radius
                global_iteration += 1

            radius_carry = max(min_trust_radius, min(max_trust_radius, radius))

        self.last_run_diagnostics = diag
        return None