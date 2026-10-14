"""Pre-feasibility recovery successor of the regional 099 anchor-state arm.

Derived from public regional PR4952 merge 36a66a03bddd458d8f526bc1953fafa34b8b19ec,
anchor-state-regional/submission.py (17,487 B, SHA-256
32dfbed94d75b54afe1c34902e689778a3280b5ce20ed43bc75390e971de91a4), which itself
derives from original 099 (15,794 B, SHA-256
144216f254636979e1878df1f80afeae04240f8bf2e86d6f06d640d570e27b96). Neither file
is modified. This is an unmeasured candidate, not an improvement claim.

ADDITIVE CHANGE (only active before the first logged feasible point of the run):
- prefeasible_recovery="off": original regional decision path (diagnostics only).
- "restart": while no feasible point has been logged in this run, end the current
  restart after a bounded infeasible-call streak whose length is a fraction of the
  measured expected call count; at most prefeasible_max_restarts times, and only
  while obj.budget_progress_fraction < prefeasible_budget_fraction. Recovery
  starts are the existing start list, then obj.random_params_unbounded().
- "restart_penalty": as "restart", plus: while no feasible point exists, two
  infeasible points are ranked by the public aux["penalty"] returned by the same
  logged value_and_grad_aux call (lower first, loss tie-break). If the field is
  absent/non-scalar/nonfinite, ranking falls back to loss. No violation is
  inferred from loss and the wrapped problem is never accessed.
Once any feasible point is logged, all pre-feasible logic is inert; anchor,
Optax anchor-state policy (backtracking_state), acceptance, excursions, radius,
noise, keys, patience restarts, best-feasible pull and predictive stop are the
regional source's behaviour.

Inherited regional description follows.

Source-bound Adam-state acceptance experiment derived from original 099.
anchor restores the immutable optimizer state captured at the accepted anchor
before retrying its gradient; legacy retains the original rolling state.

Original 099 description: noisy clipped-Adam portfolio with
feasibility-anchored trust-region acceptance. Per-restart anchor ranked by
feasibility first and loss second; limited excursions; zero-cost backtrack from
the stored anchor gradient; ratio-driven radius; late-restart pull toward the
best FEASIBLE point; predictive stop before every Objective call; restart
patience scaled from measured expected call count.

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

_PREFEASIBLE_MODES = ("off", "restart", "restart_penalty")


def _aux_penalty(aux):
    """Public aux['penalty'] as a finite float, else None. Never derived from loss."""
    try:
        value = aux["penalty"]
    except (KeyError, TypeError, IndexError):
        return None
    try:
        f = float(value)
    except (TypeError, ValueError):
        return None
    return f if math.isfinite(f) else None


def _ranked_better(loss_a, feas_a, pen_a, loss_b, feas_b, pen_b, use_penalty):
    """Original 099 order when use_penalty is False (feasible first, then loss)."""
    if feas_a != feas_b:
        return feas_a
    if (use_penalty and not feas_a and pen_a is not None and pen_b is not None
            and pen_a != pen_b):
        return pen_a < pen_b
    return loss_a < loss_b


class PreFeasibleRecoveryPortfolioRegional(OptimizationAlgorithm):
    algorithm_str = "tjlabs_prefeasible_recovery_regional"

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
        # PR4952 treatment option (retained).
        backtracking_state: str = "anchor",
        # --- new: bounded pre-feasibility recovery ---
        prefeasible_recovery: str = "restart_penalty",
        prefeasible_fraction: float = 0.10,
        prefeasible_min_streak: int = 12,
        prefeasible_max_streak: int = 80,
        prefeasible_max_restarts: int = 4,
        prefeasible_budget_fraction: float = 0.5,
        # --- feasibility-anchored acceptance ---
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
        if backtracking_state not in ("anchor", "legacy"):
            raise ValueError("backtracking_state must be anchor or legacy")
        if prefeasible_recovery not in _PREFEASIBLE_MODES:
            raise ValueError("prefeasible_recovery must be off, restart or restart_penalty")
        if not (0.0 < prefeasible_fraction <= 1.0):
            raise ValueError("prefeasible_fraction must be in (0,1]")
        if (type(prefeasible_min_streak) is not int or type(prefeasible_max_streak) is not int
                or not 2 <= prefeasible_min_streak <= prefeasible_max_streak):
            raise ValueError("invalid prefeasible streak bounds")
        if type(prefeasible_max_restarts) is not int or not 0 <= prefeasible_max_restarts <= 32:
            raise ValueError("prefeasible_max_restarts must be int in [0,32]")
        if not (0.0 <= prefeasible_budget_fraction <= 1.0):
            raise ValueError("prefeasible_budget_fraction must be in [0,1]")
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

        recovery_on = prefeasible_recovery != "off"
        rank_penalty_enabled = prefeasible_recovery == "restart_penalty"

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
        _, warm_key = jax.random.split(key)
        dummy = starts[0]
        jax.block_until_ready(propose(
            dummy, jnp.zeros_like(dummy), optimizer.init(dummy),
            float(trust_radius), float(noise_start), warm_key, dummy, 0.0))

        diag = {
            "algorithm_str": self.algorithm_str,
            "uses_aux": use_aux,
            "backtracking_state": backtracking_state,
            "anchor_state_restores": 0,
            "nonfinite_state_restores": 0,
            "prefeasible_recovery": prefeasible_recovery,
            "prefeasible_restarts": 0,
            "prefeasible_events": [],  # (call_index, streak_limit), capped
            "penalty_rank_decisions": 0,
            "penalty_unavailable_calls": 0,
            "first_feasible_call": None,
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
                return False
            if not math.isfinite(tl):
                return False
            return tl < stop_margin * predicted_call_s() + return_reserve_s

        def expected_total_calls(calls_done):
            tl = max(0.0, remaining_time())
            expected_total = calls_done + tl / max(predicted_call_s(), 1e-6)
            left = obj.evals_left
            if left is not None:
                expected_total = min(expected_total, calls_done + float(left))
            return expected_total

        def current_patience(calls_done):
            if not durations:
                return min_patience
            p = int(round(patience_fraction * expected_total_calls(calls_done)))
            return max(min_patience, min(max_patience, p))

        def prefeasible_limit(calls_done):
            if not durations:
                return prefeasible_min_streak
            p = int(round(prefeasible_fraction * expected_total_calls(calls_done)))
            return max(prefeasible_min_streak, min(prefeasible_max_streak, p))

        def evaluate(p):
            t0 = time.perf_counter()
            pen = None
            if use_aux:
                loss, grad, aux = obj.value_and_grad_aux(p)
                feasible = bool(aux["is_feasible"])
                if rank_penalty_enabled:
                    pen = _aux_penalty(aux)
            else:
                loss, grad = obj.value_and_grad(p)
                feasible = True  # unknown on non-constrained problems
            if rank_penalty_enabled and pen is None:
                diag["penalty_unavailable_calls"] += 1
            loss_f = float(loss)
            finite = math.isfinite(loss_f) and bool(jnp.all(jnp.isfinite(grad)))
            dt = time.perf_counter() - t0
            durations.append(dt)
            ewma[0] = dt if ewma[0] is None else 0.7 * ewma[0] + 0.3 * dt
            diag["calls"] += 1
            diag["ewma_call_s"] = ewma[0]
            diag["max_recent_call_s"] = max(durations)
            return loss_f, grad, feasible, finite, pen

        # ---------------- portfolio loop ----------------
        best_feasible_params = None
        best_feasible_loss = math.inf

        def better(loss_a, feas_a, pen_a, loss_b, feas_b, pen_b):
            use_pen = rank_penalty_enabled and best_feasible_params is None
            if (use_pen and feas_a == feas_b and not feas_a and pen_a is not None
                    and pen_b is not None and pen_a != pen_b):
                diag["penalty_rank_decisions"] += 1
            return _ranked_better(loss_a, feas_a, pen_a, loss_b, feas_b, pen_b, use_pen)

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
            anchor = None  # dict(params, loss, grad, feasible, optimizer_state, penalty)
            params = start
            last_pred = None
            last_base_loss = None
            last_step_len = 0.0
            last_radius_used = radius
            stall = 0
            excursion = 0
            prefeas_streak = 0

            while True:
                if should_stop():
                    stop = True
                    diag["stopped_predictively"] = not obj.budget_exceeded
                    break

                loss, grad, feasible, finite, pen = evaluate(params)

                if not finite:
                    diag["nonfinite"] += 1
                    radius = max(min_trust_radius, radius * radius_shrink)
                    if anchor is None:
                        break  # no usable point in this restart
                    base_params, base_grad, base_loss = anchor["params"], anchor["grad"], anchor["loss"]
                    if backtracking_state == "anchor":
                        state = anchor["optimizer_state"]
                        diag["anchor_state_restores"] += 1
                        diag["nonfinite_state_restores"] += 1
                    excursion = 0
                    stall += 1
                else:
                    if feasible and loss < best_feasible_loss:
                        if diag["first_feasible_call"] is None:
                            diag["first_feasible_call"] = diag["calls"]
                        best_feasible_loss = loss
                        best_feasible_params = params

                    rho = None
                    if last_pred is not None and last_pred > 1e-12:
                        rho = (last_base_loss - loss) / last_pred

                    if anchor is None or better(loss, feasible, pen, anchor["loss"],
                                                anchor["feasible"], anchor["penalty"]):
                        anchor = {"params": params, "loss": loss, "grad": grad,
                                  "feasible": feasible, "optimizer_state": state,
                                  "penalty": pen}
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
                            excursion = 0
                            base_params, base_grad, base_loss = anchor["params"], anchor["grad"], anchor["loss"]
                            if backtracking_state == "anchor":
                                state = anchor["optimizer_state"]
                                diag["anchor_state_restores"] += 1
                            radius = max(min_trust_radius, radius * radius_shrink)
                            diag["rejected"] += 1

                # --- new: bounded no-feasible-yet recovery restart ---
                if recovery_on and best_feasible_params is None:
                    prefeas_streak += 1
                    limit = prefeasible_limit(diag["calls"])
                    if (prefeas_streak >= limit
                            and diag["prefeasible_restarts"] < prefeasible_max_restarts
                            and float(obj.budget_progress_fraction) < prefeasible_budget_fraction):
                        diag["prefeasible_restarts"] += 1
                        if len(diag["prefeasible_events"]) < 64:
                            diag["prefeasible_events"].append((diag["calls"], limit))
                        break  # recovery restart

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