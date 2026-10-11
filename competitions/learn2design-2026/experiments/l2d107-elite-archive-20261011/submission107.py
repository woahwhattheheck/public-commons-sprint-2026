"""Budgeted restarts and feasible-basin polishing for Learn2Design.

Development candidate derived from V1/096's Adam/trust update. An improving
first V1/096 basin can consume the entire budget before another start is tried.
Independent Adam states rotate in slices, then noise-free polishing starts at
    the best Objective-reported feasible point with a usable derivative. All physical evaluations, timing
and authoritative histories stay in Objective. No gain or promotion claimed.
"""
from __future__ import annotations

import math
import time
from collections.abc import Mapping
from dfbench import Objective, OptimizationAlgorithm
import jax
import jax.numpy as jnp
import optax
from elite_archive import FeasibleEliteArchive


class BoundedArchiveRestartPortfolio(OptimizationAlgorithm):
    algorithm_str = "tjlabs_l2d107_bounded_elite_archive"

    def __init__(self):
        self.last_run_diagnostics = {}

    def optimize(self, objective: Objective, init_params=None, random_seed=None,
                 learning_rate=0.08, restarts=5, restart_patience=220,
                 trust_radius=0.30, min_trust_radius=0.01, max_trust_radius=0.80,
                 noise_start=0.10, noise_decay=0.997, slice_calls=16,
                 explore_fraction=0.60, polish_rate=0.02, polish_radius=0.08,
                 stop_margin=1.10, return_reserve_s=0.05, **kwargs) -> None:
        obj = objective
        if type(restarts) is not int or not 1 <= restarts <= 16:
            raise ValueError("restarts must be int in [1,16]")
        if type(restart_patience) is not int or restart_patience < 20:
            raise ValueError("restart_patience must be int >=20")
        if type(slice_calls) is not int or not 1 <= slice_calls <= 64:
            raise ValueError("slice_calls must be int in [1,64]")
        if not (0 < learning_rate <= 1 and 0 < polish_rate <= learning_rate):
            raise ValueError("invalid learning rates")
        if not (0 < min_trust_radius <= trust_radius <= max_trust_radius <= 2
                and min_trust_radius <= polish_radius <= max_trust_radius):
            raise ValueError("invalid trust radii")
        if not (0 <= noise_start <= 1 and 0.9 <= noise_decay <= 1
                and 0.1 <= explore_fraction <= 0.9):
            raise ValueError("invalid exploration schedule")
        if not (math.isfinite(stop_margin) and 1 <= stop_margin <= 3
                and math.isfinite(return_reserve_s) and 0 <= return_reserve_s <= 5):
            raise ValueError("invalid stop safeguard")
        _, key = self.prepare(obj, unbounded=True, random_seed=random_seed)
        starts = [jnp.asarray(init_params)] if init_params is not None else []
        while len(starts) < restarts:
            starts.append(jnp.asarray(obj.random_params_unbounded()))
        constrained = obj.power_thresholds is not None
        if constrained:
            obj.warmup_value_and_grad_aux()
        else:
            obj.warmup_value_and_grad()
        search_optimizer = optax.chain(optax.clip_by_global_norm(1.0), optax.adam(learning_rate))
        polish_optimizer = optax.chain(optax.clip_by_global_norm(1.0), optax.adam(polish_rate))

        def new_lane(params, optimizer, radius):
            return {"params": params, "state": optimizer.init(params),
                    "best": math.inf, "no_improve": 0, "trust": float(radius), "iteration": 0}

        lanes = [new_lane(p, search_optimizer, trust_radius) for p in starts]
        diag = {"algorithm_str": self.algorithm_str, "calls": 0,
                "lane_calls": [0] * restarts, "fresh_restarts": 0,
                "polish_calls": 0, "polish_started_from_feasible": None,
                "polish_start_loss": None, "polish_start_progress": None,
                "stopped_predictively": False, "ewma_call_s": None, "last_call_s": None,
                "note": "bookkeeping only; Objective history is authoritative"}
        self.last_run_diagnostics = diag
        obj.start_logging()
        elites = FeasibleEliteArchive(capacity=8, min_rms=0.04)
        diag["archive_restarts"] = 0
        best_raw_loss = best_feasible_loss = math.inf
        best_raw_params = best_feasible_params = None
        ewma = last_dt = None
        polishing = False
        polish_lane = None
        global_iteration = 0

        def should_stop():
            left = obj.evals_left
            if left is not None and left < 1:
                return True
            if ewma is None:
                return False
            tl = obj.time_left
            if tl is None or not math.isfinite(float(tl)):
                return False
            return float(tl) < stop_margin * max(ewma, last_dt) + return_reserve_s

        while not obj.budget_exceeded:
            if should_stop():
                diag["stopped_predictively"] = True
                break
            progress = float(obj.budget_progress_fraction)
            if not polishing and progress >= explore_fraction:
                polishing = True
                anchor = best_feasible_params if best_feasible_params is not None else best_raw_params
                if anchor is None:
                    anchor = jnp.asarray(obj.random_params_unbounded())
                polish_lane = new_lane(anchor, polish_optimizer, polish_radius)
                diag["polish_started_from_feasible"] = best_feasible_params is not None
                diag["polish_start_loss"] = (best_feasible_loss if best_feasible_params is not None
                    else best_raw_loss if best_raw_params is not None else None)
                diag["polish_start_progress"] = progress
            if polishing:
                lane, optimizer = polish_lane, polish_optimizer
            else:
                lane_index = (global_iteration // slice_calls) % restarts
                lane, optimizer = lanes[lane_index], search_optimizer
            params = lane["params"]
            # Lane initialization may itself take time: check again immediately
            # before the physical call, not only at the start of the loop.
            if obj.budget_exceeded or should_stop():
                diag["stopped_predictively"] = not obj.budget_exceeded
                break
            if polishing:
                diag["polish_calls"] += 1
            else:
                diag["lane_calls"][lane_index] += 1
            t0 = time.perf_counter()
            if constrained:
                loss, grad, aux = obj.value_and_grad_aux(params)
                if not isinstance(aux, Mapping) or "is_feasible" not in aux:
                    raise ValueError("Objective aux must contain is_feasible")
                flag = jnp.asarray(aux["is_feasible"])
                if flag.shape != () or flag.dtype.kind != "b":
                    raise ValueError("Objective is_feasible must be a scalar boolean")
                feasible = bool(flag)
            else:
                loss, grad = obj.value_and_grad(params)
                feasible = True
            finite_loss = bool(jnp.isfinite(loss))
            finite_grad = bool(jnp.all(jnp.isfinite(grad)))
            finite_params = bool(jnp.all(jnp.isfinite(params)))
            last_dt = time.perf_counter() - t0
            ewma = last_dt if ewma is None else 0.7 * ewma + 0.3 * last_dt
            diag["calls"] += 1
            diag["last_call_s"], diag["ewma_call_s"] = last_dt, ewma
            loss_scalar = float(loss)
            # These are derivative-eligible search anchors. Objective retains
            # every scored observation, including finite-loss/invalid-grad rows.
            eligible = finite_loss and finite_grad and finite_params
            if eligible and loss_scalar < best_raw_loss:
                best_raw_loss, best_raw_params = loss_scalar, params
            if feasible and eligible and loss_scalar < best_feasible_loss:
                best_feasible_loss, best_feasible_params = loss_scalar, params
            if eligible and feasible and (loss_scalar <= best_feasible_loss or diag["calls"] % slice_calls == 0):
                # Sparse scored feasible snapshots; never copy gradients/history.
                elites.offer(params, loss_scalar, feasible=True, step=global_iteration)
            if eligible:
                if loss_scalar < lane["best"]:
                    lane["best"], lane["no_improve"] = loss_scalar, 0
                    lane["trust"] = min(max_trust_radius, lane["trust"] * 1.015)
                else:
                    lane["no_improve"] += 1
                    if lane["no_improve"] % 25 == 0:
                        lane["trust"] = max(min_trust_radius, lane["trust"] * 0.70)
                updates, lane["state"] = optimizer.update(grad, lane["state"], params)
                step = updates * jnp.minimum(1.0, lane["trust"] / (jnp.linalg.norm(updates) + 1e-12))
                proposal = params + step
                if not polishing:
                    key, noise_key = jax.random.split(key)
                    noise = jax.random.normal(noise_key, params.shape, dtype=params.dtype)
                    proposal = proposal + noise_start * (noise_decay ** lane["iteration"]) * lane["trust"] * noise
                    if lane_index > 0 and lane["no_improve"] > restart_patience // 2 and best_raw_params is not None:
                        proposal = 0.75 * proposal + 0.25 * best_raw_params
                if bool(jnp.all(jnp.isfinite(proposal))):
                    lane["params"] = proposal
                else:
                    lane["no_improve"] = restart_patience
                lane["iteration"] += 1
            else:
                # A previously usable anchor can later return an invalid
                # derivative. Evict it so polishing does not repeatedly retry it.
                if best_raw_params is not None and bool(jnp.array_equal(params, best_raw_params)):
                    best_raw_loss, best_raw_params = math.inf, None
                if best_feasible_params is not None and bool(jnp.array_equal(params, best_feasible_params)):
                    best_feasible_loss, best_feasible_params = math.inf, None
                elites.evict_near(params)
                lane["no_improve"] = restart_patience
            if lane["no_improve"] >= restart_patience:
                if polishing:
                    anchor = best_feasible_params if best_feasible_params is not None else best_raw_params
                    if anchor is None:
                        anchor = jnp.asarray(obj.random_params_unbounded())
                    polish_lane = new_lane(anchor, polish_optimizer, min(lane["trust"], polish_radius))
                else:
                    # Alternate source-native fresh random starts with a diverse
                    # scored feasible basin, keeping the best for polishing.
                    candidate = (elites.choose_distant(params)
                                 if diag["fresh_restarts"] % 2 == 0 else None)
                    if candidate is None:
                        candidate = obj.random_params_unbounded()
                    else:
                        diag["archive_restarts"] += 1
                    lanes[lane_index] = new_lane(jnp.asarray(candidate),
                                                search_optimizer, trust_radius)
                    diag["fresh_restarts"] += 1
            global_iteration += 1
        diag["elite_archive"] = elites.summary()
        return None
