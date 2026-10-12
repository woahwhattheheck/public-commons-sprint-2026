"""Batched public-corpus restart portfolio for Learn2Design 2026.

This integrates the fleet's original 107 independent Adam/trust lanes, its
feasible elite archive and DBA55's pinned public-corpus initializer. Batched
Objective calls return every lane's native gradient and feasibility. Improving
feasible designs are also evaluated with the scalar Objective path, so an
evaluator retaining only the batch minimum still receives those designs.

The supplied Objective owns all simulation, logging, mapping and budgets.
Objective warmups precede start_logging; the custom update first compiles after
logging. The default uses eight simultaneous lanes on GPU and rotates the same
population one lane at a time on CPU. Explicit batch_size selects another
measured execution condition without changing the population.
"""
from __future__ import annotations

from collections import deque
from collections.abc import Mapping
import hashlib
import math
import time
from types import SimpleNamespace

from dfbench import Objective, OptimizationAlgorithm
import jax
import jax.numpy as jnp
import numpy as np

from batched_update import build_update
from elite_archive import FeasibleEliteArchive
from warmstart import DEFAULT_BANK, replace_start_slots

BANK_BYTES = 2170687
BANK_SHA256 = "609a69e08ef1c9ec3460e3f012e7f1b52bb6a29c232c198a63415409d2ab7d39"


class BatchedCorpusPortfolioD76C(OptimizationAlgorithm):
    algorithm_str = "tjlabs_l2d_batched_corpus_portfolio_d76c"

    def __init__(self):
        self.last_run_diagnostics = {}

    def optimize(
        self, objective: Objective, init_params=None, random_seed=None,
        population_size=8, batch_size=None, corpus_starts=True,
        learning_rate=0.08, restart_patience=180, trust_radius=0.30,
        min_trust_radius=0.01, max_trust_radius=0.80,
        noise_start=0.10, noise_decay=0.997,
        explore_fraction=0.65, finish_fraction=0.90,
        polish_rate=0.02, polish_radius=0.08, coord_clip=15.0,
        stop_margin=1.15, return_reserve_s=0.10, **kwargs,
    ) -> None:
        obj = objective
        if type(population_size) is not int or not 2 <= population_size <= 16:
            raise ValueError("population_size must be an integer in [2,16]")
        if batch_size is not None and (
                type(batch_size) is not int or not 1 <= batch_size <= population_size):
            raise ValueError("batch_size must fit the selected population")
        if type(corpus_starts) is not bool:
            raise ValueError("corpus_starts must be boolean")
        if type(restart_patience) is not int or restart_patience < 20:
            raise ValueError("restart_patience must be an integer >=20")
        if not (0 < polish_rate <= learning_rate <= 1
                and 0 < min_trust_radius <= trust_radius <= max_trust_radius <= 2
                and min_trust_radius <= polish_radius <= max_trust_radius):
            raise ValueError("invalid learning rates or trust radii")
        if not (0 <= noise_start <= 1 and 0.9 <= noise_decay <= 1
                and 0 < explore_fraction < finish_fraction < 1
                and math.isfinite(coord_clip) and coord_clip > 0
                and math.isfinite(stop_margin) and 1 <= stop_margin <= 3
                and math.isfinite(return_reserve_s) and 0 <= return_reserve_s <= 5):
            raise ValueError("invalid search schedule")

        donor_context = None
        if corpus_starts:
            # Capture finite public bounds before prepare selects unbounded space.
            obj.set_space_mode(False)
            donor_context = SimpleNamespace(
                bounds=jnp.array(obj.bounds), problem_spec=obj.problem_spec,
                optimization_pairs=obj.optimization_pairs)
        _, key = self.prepare(obj, unbounded=True, random_seed=random_seed)
        backend = jax.default_backend()
        width = batch_size if batch_size is not None else (
            population_size if backend == "gpu" else 1)
        n = int(obj.n_params)
        starts = [jnp.asarray(init_params)] if init_params is not None else []
        while len(starts) < population_size:
            starts.append(jnp.asarray(obj.random_params_unbounded()))
        original_starts = starts
        initializer = {"status": "disabled", "selected": []}
        if corpus_starts:
            raw_bank = DEFAULT_BANK.read_bytes()
            if len(raw_bank) != BANK_BYTES or hashlib.sha256(raw_bank).hexdigest() != BANK_SHA256:
                raise ValueError("The pinned public-corpus donor bank differs")
            del raw_bank
            starts, initializer = replace_start_slots(
                donor_context, starts, preserve_first=init_params is not None)
        dtype = np.asarray(original_starts[0]).dtype
        points = np.asarray(starts, dtype=dtype).reshape(population_size, n)
        if not np.isfinite(points).all():
            raise ValueError("Initial Objective vectors must be finite")
        points = np.clip(points, -coord_clip, coord_clip)
        constrained = obj.power_thresholds is not None

        # Only documented Objective warmups run before the clock starts.
        if constrained:
            obj.warmup_value_aux()
            if width == 1:
                obj.warmup_value_and_grad_aux()
            else:
                obj.warmup_vmap_value_and_grad_aux(batch_size=width)
        else:
            obj.warmup_value()
            if width == 1:
                obj.warmup_value_and_grad()
            else:
                obj.warmup_vmap_value_and_grad(batch_size=width)
        # Finite evaluation caps may end with fewer points than a full batch.
        if width > 1 and obj.evals_left is not None:
            if constrained:
                obj.warmup_value_and_grad_aux()
            else:
                obj.warmup_value_and_grad()

        optimizer, update = build_update(float(coord_clip))
        params = jnp.asarray(points, dtype=dtype)
        state = jax.vmap(optimizer.init)(params)
        keys = jax.random.split(key, population_size)
        trust = np.full(population_size, float(trust_radius))
        rate_scale = np.geomspace(0.5, 1.5, population_size)
        rates = float(learning_rate) * rate_scale
        lane_best = np.full(population_size, np.inf)
        stale = np.zeros(population_size, dtype=np.int64)
        iterations = np.zeros(population_size, dtype=np.int64)
        polishing = np.zeros(population_size, dtype=bool)
        elites = FeasibleEliteArchive(capacity=16, min_rms=0.04)
        recent = deque(maxlen=8)
        scalar_recent = deque(maxlen=8)
        best_raw_loss = best_feasible_loss = math.inf
        best_raw_params = best_feasible_params = None
        best_observed_feasible = best_confirmed_feasible = math.inf
        phase, cursor, ewma = 0, 0, None
        diag = {
            "algorithm_str": self.algorithm_str, "backend": backend,
            "population_size": population_size, "batch_size": width,
            "corpus_starts": corpus_starts, "initializer": initializer,
            "gradient_calls": 0, "gradient_points": 0,
            "scalar_confirmations": 0, "confirmed_feasible": 0,
            "confirmation_budget_skips": 0,
            "lane_calls": [0] * population_size,
            "fresh_restarts": 0, "archive_restarts": 0, "polish_restarts": 0,
            "phase_changes": [], "nonfinite_evaluations": 0,
            "last_loop_s": None, "ewma_loop_s": None,
            "last_scalar_s": None, "stopped_predictively": False,
            "stop_reason": None, "ignored_options": sorted(kwargs),
        }
        self.last_run_diagnostics = diag
        obj.start_logging()

        def cost_prediction():
            if not recent:
                return None
            return max(float(ewma), max(recent))

        def may_call(count, *, scalar=False):
            if obj.budget_exceeded:
                diag["stop_reason"] = "objective_budget"
                return False
            left = obj.evals_left
            if left is not None and left < count:
                diag["stop_reason"] = "evaluation_budget"
                return False
            remaining = obj.time_left
            prediction = max(scalar_recent) if scalar and scalar_recent else cost_prediction()
            if remaining is not None and prediction is not None:
                if float(remaining) < stop_margin * prediction + return_reserve_s:
                    diag["stopped_predictively"] = True
                    diag["stop_reason"] = "measured_call_cost"
                    return False
            return True

        def reset_lane(index, point, *, polish=False, quiet_restart=False):
            nonlocal params, state, keys
            point = np.asarray(point, dtype=dtype).reshape(n)
            if not np.isfinite(point).all():
                raise ValueError("Restart vector must be finite")
            point = jnp.asarray(np.clip(point, -coord_clip, coord_clip), dtype=dtype)
            params = params.at[index].set(point)
            fresh_state = optimizer.init(point)
            state = jax.tree_util.tree_map(
                lambda whole, fresh: whole.at[index].set(fresh), state, fresh_state)
            next_key, _ = jax.random.split(keys[index])
            keys = keys.at[index].set(next_key)
            stale[index], iterations[index], lane_best[index] = 0, 0, math.inf
            if polish:
                trust[index] = (max(min_trust_radius, trust[index] * 0.5)
                                if quiet_restart else polish_radius)
                rates[index] = (max(polish_rate * rate_scale[index] * 0.10,
                                    rates[index] * 0.5)
                                if quiet_restart else polish_rate * rate_scale[index])
            else:
                trust[index], rates[index] = trust_radius, learning_rate * rate_scale[index]

        def anchor_for(index):
            if elites.entries:
                return elites.entries[index % len(elites.entries)].vector
            if best_raw_params is not None:
                return best_raw_params
            return obj.random_params_unbounded()

        def confirm(point):
            nonlocal best_confirmed_feasible
            if not may_call(1, scalar=True):
                diag["confirmation_budget_skips"] += 1
                return
            begin = time.perf_counter()
            if constrained:
                value, aux = obj.value_aux(jnp.asarray(point, dtype=dtype))
                if not isinstance(aux, Mapping):
                    raise ValueError("Scalar Objective aux must be a mapping")
                flag = np.asarray(aux.get("is_feasible"))
                if flag.shape != () or flag.dtype.kind != "b":
                    raise ValueError("Scalar feasibility must be a boolean")
                feasible = bool(flag)
            else:
                value = obj.value(jnp.asarray(point, dtype=dtype))
                feasible = True
            value = float(value)
            elapsed = time.perf_counter() - begin
            scalar_recent.append(elapsed)
            diag["last_scalar_s"] = elapsed
            diag["scalar_confirmations"] += 1
            if not obj.budget_exceeded and feasible and math.isfinite(value):
                best_confirmed_feasible = min(best_confirmed_feasible, value)
                diag["confirmed_feasible"] += 1

        try:
            while not obj.budget_exceeded:
                progress = float(obj.budget_progress_fraction)
                next_phase = (2 if progress >= finish_fraction else
                              1 if progress >= explore_fraction else 0)
                if next_phase > phase:
                    count = population_size if next_phase == 2 else max(1, population_size // 2)
                    selected = list(range(population_size - count, population_size))
                    for index in selected:
                        if not polishing[index]:
                            polishing[index] = True
                            reset_lane(index, anchor_for(index), polish=True)
                    phase = next_phase
                    diag["phase_changes"].append({
                        "phase": phase, "progress": progress,
                        "polishing_lanes": np.flatnonzero(polishing).tolist(),
                        "feasible_anchor": best_feasible_params is not None,
                    })
                # Use the already selected scalar path for a finite-cap tail.
                call_width = width
                remaining_evals = obj.evals_left
                if remaining_evals is not None and remaining_evals < width:
                    call_width = 1
                if not may_call(call_width):
                    break
                indices = np.asarray(
                    [(cursor + offset) % population_size for offset in range(call_width)],
                    dtype=np.int32)
                cursor = (cursor + call_width) % population_size
                ids = jnp.asarray(indices)
                batch = params[ids]
                loop_start = time.perf_counter()
                if call_width == 1:
                    if constrained:
                        loss, grad, aux = obj.value_and_grad_aux(batch[0])
                    else:
                        loss, grad = obj.value_and_grad(batch[0])
                    losses = np.asarray(loss, dtype=np.float64).reshape(1)
                    grads = np.asarray(grad).reshape(1, n)
                else:
                    if constrained:
                        loss, grad, aux = obj.vmap_value_and_grad_aux(batch)
                    else:
                        loss, grad = obj.vmap_value_and_grad(batch)
                    losses = np.asarray(loss, dtype=np.float64).reshape(call_width)
                    grads = np.asarray(grad).reshape(call_width, n)
                evaluated = np.asarray(batch, dtype=dtype)
                if constrained:
                    if not isinstance(aux, Mapping) or "is_feasible" not in aux:
                        raise ValueError("Objective aux must contain physical feasibility")
                    feasible = np.asarray(aux["is_feasible"])
                    expected_shape = () if call_width == 1 else (call_width,)
                    if feasible.shape != expected_shape or feasible.dtype.kind != "b":
                        raise ValueError("Objective feasibility must match the actual call shape")
                    feasible = feasible.reshape(call_width)
                else:
                    feasible = np.ones(call_width, dtype=bool)
                diag["gradient_calls"] += 1
                diag["gradient_points"] += call_width
                if obj.budget_exceeded:
                    break
                finite_points = np.isfinite(evaluated).all(axis=1)
                finite_loss = np.isfinite(losses) & finite_points
                eligible = finite_loss & np.isfinite(grads).all(axis=1)
                diag["nonfinite_evaluations"] += int(np.count_nonzero(~eligible))

                scored_feasible = feasible & finite_loss
                if np.any(scored_feasible):
                    winner = int(np.flatnonzero(scored_feasible)[
                        np.argmin(losses[scored_feasible])])
                    if float(losses[winner]) < best_observed_feasible:
                        best_observed_feasible = float(losses[winner])
                        # Scalar calls and a finite batch's minimum are already
                        # retained by the default native history. Confirm only
                        # an improving feasible member outside that minimum.
                        representative = (call_width == 1 or
                                          (np.isfinite(losses).all() and
                                           winner == int(np.argmin(losses))))
                        if representative:
                            best_confirmed_feasible = min(
                                best_confirmed_feasible, float(losses[winner]))
                        else:
                            confirm(evaluated[winner])

                for offset, index in enumerate(indices):
                    index = int(index)
                    diag["lane_calls"][index] += 1
                    if not eligible[offset]:
                        elites.evict_near(evaluated[offset])
                        if best_raw_params is not None and np.array_equal(
                                evaluated[offset], best_raw_params):
                            best_raw_loss, best_raw_params = math.inf, None
                        if best_feasible_params is not None and np.array_equal(
                                evaluated[offset], best_feasible_params):
                            best_feasible_loss, best_feasible_params = math.inf, None
                        stale[index] = restart_patience
                        continue
                    value = float(losses[offset])
                    if value < best_raw_loss:
                        best_raw_loss = value
                        best_raw_params = evaluated[offset].copy()
                    if feasible[offset]:
                        if value < best_feasible_loss:
                            best_feasible_loss = value
                            best_feasible_params = evaluated[offset].copy()
                        elites.offer(evaluated[offset], value, feasible=True,
                                     step=int(diag["gradient_points"] - call_width + offset))
                    if value < lane_best[index]:
                        lane_best[index], stale[index] = value, 0
                        trust[index] = min(max_trust_radius, trust[index] * 1.015)
                    else:
                        stale[index] += 1
                        if stale[index] % 25 == 0:
                            trust[index] = max(min_trust_radius, trust[index] * 0.70)

                if obj.budget_exceeded:
                    break
                anchor = best_feasible_params if best_feasible_params is not None else best_raw_params
                if anchor is None:
                    anchors = evaluated
                    pull = np.zeros(call_width, dtype=bool)
                else:
                    anchors = np.broadcast_to(anchor, evaluated.shape)
                    pull = (~polishing[indices]) & (stale[indices] > restart_patience // 2)
                noise = np.where(polishing[indices], 0.0,
                                 noise_start * np.power(noise_decay, iterations[indices]))
                active_state = jax.tree_util.tree_map(lambda whole: whole[ids], state)
                proposal, next_state, next_keys = update(
                    batch, jnp.asarray(grads, dtype=dtype), active_state, keys[ids],
                    jnp.asarray(trust[indices], dtype=dtype),
                    jnp.asarray(noise, dtype=dtype), jnp.asarray(rates[indices], dtype=dtype),
                    jnp.asarray(anchors, dtype=dtype), jnp.asarray(pull))
                proposed = np.asarray(proposal)
                usable = np.isfinite(proposed).all(axis=1) & eligible
                params = params.at[ids].set(jnp.where(
                    jnp.asarray(usable)[:, None], proposal, batch))
                state = jax.tree_util.tree_map(
                    lambda whole, changed: whole.at[ids].set(changed), state, next_state)
                keys = keys.at[ids].set(next_keys)
                iterations[indices] += 1
                for offset, index in enumerate(indices):
                    index = int(index)
                    if not usable[offset]:
                        stale[index] = restart_patience
                    if stale[index] >= restart_patience:
                        if polishing[index]:
                            reset_lane(index, anchor_for(index), polish=True, quiet_restart=True)
                            diag["polish_restarts"] += 1
                        else:
                            point = (elites.choose_distant(evaluated[offset])
                                     if diag["fresh_restarts"] % 2 == 0 else None)
                            if point is None:
                                point = obj.random_params_unbounded()
                            else:
                                diag["archive_restarts"] += 1
                            reset_lane(index, point)
                            diag["fresh_restarts"] += 1
                # Include device updates and host portfolio work in call prediction.
                jax.block_until_ready(params)
                elapsed = time.perf_counter() - loop_start
                recent.append(elapsed)
                ewma = elapsed if ewma is None else 0.7 * ewma + 0.3 * elapsed
                diag["last_loop_s"], diag["ewma_loop_s"] = elapsed, ewma
        finally:
            diag["best_observed_feasible_loss"] = (
                best_observed_feasible if math.isfinite(best_observed_feasible) else None)
            diag["best_scalar_confirmed_feasible_loss"] = (
                best_confirmed_feasible if math.isfinite(best_confirmed_feasible) else None)
            diag["elite_archive"] = elites.summary()
            diag["final_phase"] = phase
        return None
