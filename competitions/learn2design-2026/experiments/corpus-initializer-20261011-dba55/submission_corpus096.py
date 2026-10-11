"""CorpusSeeded096: original096 search with public-donor initial starts.

The original096 source SHA256 is
97cbe70ec309629be60c78facf903e110aace074111715e58fde57afc01c8077.
Its random draws, clipped Adam, trust/noise schedule, restart pull, native
Objective methods, logging and predictive stop are preserved. After drawing
that same original start list, alternate slots receive complete mapped public
corpus donors. A caller-provided init_params remains first. Missing supported
roles retain the original random start; no synthetic physics is evaluated.

All model construction occurred offline from the pinned public organizer data.
The shipped warmstart helper uses only supplied public Objective context, and
the first donor evaluation occurs through Objective.value_and_grad after
start_logging. Transferred designs earn feasibility only from that native log.
"""
from __future__ import annotations

import math
import time

from dfbench import Objective, OptimizationAlgorithm
import jax
import jax.numpy as jnp
import optax

from warmstart import replace_start_slots


class CorpusSeeded096(OptimizationAlgorithm):
    algorithm_str = "tjlabs_corpus_seeded_096"

    def __init__(self):
        self.last_run_diagnostics = {}

    def optimize(
        self,
        objective: Objective,
        init_params=None,
        random_seed: int | None = None,
        learning_rate: float = 0.08,
        restarts: int = 5,
        restart_patience: int = 220,
        trust_radius: float = 0.30,
        min_trust_radius: float = 0.01,
        max_trust_radius: float = 0.80,
        noise_start: float = 0.10,
        noise_decay: float = 0.997,
        stop_margin: float = 1.10,
        return_reserve_s: float = 0.05,
        corpus_starts: bool = True,
        **kwargs,
    ) -> None:
        obj = objective
        if type(restarts) is not int or not 1 <= restarts <= 16:
            raise ValueError("restarts must be int in [1,16]")
        if type(restart_patience) is not int or restart_patience < 20:
            raise ValueError("restart_patience must be int >=20")
        if not (0.0 < learning_rate <= 1.0):
            raise ValueError("learning_rate must be in (0,1]")
        if not (0 < min_trust_radius <= trust_radius <= max_trust_radius <= 2.0):
            raise ValueError("invalid trust radii")
        if not (0.0 <= noise_start <= 1.0 and 0.9 <= noise_decay <= 1.0):
            raise ValueError("invalid noise schedule")
        if not (math.isfinite(stop_margin) and 1.0 <= stop_margin <= 3.0
                and math.isfinite(return_reserve_s) and 0.0 <= return_reserve_s <= 5.0):
            raise ValueError("invalid stop safeguard")

        _, key = self.prepare(obj, unbounded=True, random_seed=random_seed)
        if random_seed is None:
            random_seed = 0

        starts = []
        if init_params is not None:
            starts.append(jnp.asarray(init_params))
        while len(starts) < restarts:
            starts.append(jnp.asarray(obj.random_params_unbounded()))

        initializer = {"status": "disabled", "selected": []}
        if corpus_starts:
            original_starts = starts
            starts, initializer = replace_start_slots(
                obj, starts, preserve_first=init_params is not None)
            starts = [jnp.asarray(start, dtype=original.dtype)
                      for start, original in zip(starts, original_starts)]

        obj.warmup_value_and_grad()
        diag = {"algorithm_str": self.algorithm_str, "calls": 0,
                "stopped_predictively": False, "ewma_call_s": None,
                "last_call_s": None, "initializer": initializer,
                "note": "bookkeeping only; Objective history is authoritative"}
        self.last_run_diagnostics = diag
        obj.start_logging()

        best_params = starts[0]
        best_loss = jnp.asarray(jnp.inf)
        trust = float(trust_radius)
        global_iteration = 0
        ewma = None
        last_dt = None
        stop = False

        def should_stop():
            left = obj.evals_left
            if left is not None and left < 1:
                return True
            if ewma is None:
                return False  # first call always allowed: a run needs a logged entry
            tl = obj.time_left
            if tl is None:
                return False
            tl = float(tl)
            if not math.isfinite(tl):
                return False
            pred = max(ewma, last_dt)  # robust: never below the latest observed call
            return tl < stop_margin * pred + return_reserve_s

        for restart_index, start in enumerate(starts):
            if stop or obj.budget_exceeded:
                break
            params = start
            optimizer = optax.chain(
                optax.clip_by_global_norm(1.0),
                optax.adam(learning_rate),
            )
            state = optimizer.init(params)
            local_best = jnp.asarray(jnp.inf)
            no_improve = 0
            local_trust = trust

            while not obj.budget_exceeded and no_improve < restart_patience:
                if should_stop():
                    stop = True
                    diag["stopped_predictively"] = True
                    break
                t0 = time.perf_counter()
                loss, grad = obj.value_and_grad(params)
                finite = bool(jnp.isfinite(loss)) and bool(jnp.all(jnp.isfinite(grad)))
                last_dt = time.perf_counter() - t0
                ewma = last_dt if ewma is None else 0.7 * ewma + 0.3 * last_dt
                diag["calls"] += 1
                diag["ewma_call_s"] = ewma
                diag["last_call_s"] = last_dt
                if not finite:
                    no_improve = restart_patience
                    continue

                loss_scalar = float(loss)
                if loss_scalar < float(local_best):
                    local_best = loss
                    no_improve = 0
                    local_trust = min(max_trust_radius, local_trust * 1.015)
                else:
                    no_improve += 1
                    if no_improve % 25 == 0:
                        local_trust = max(min_trust_radius, local_trust * 0.70)

                if loss_scalar < float(best_loss):
                    best_loss = loss
                    best_params = params

                updates, state = optimizer.update(grad, state, params)
                step = updates
                step_norm = jnp.linalg.norm(step)
                scale = jnp.minimum(1.0, local_trust / (step_norm + 1e-12))
                step = step * scale

                key, noise_key = jax.random.split(key)
                noise_scale = noise_start * (noise_decay ** global_iteration)
                noise = jax.random.normal(noise_key, params.shape, dtype=params.dtype)
                proposal = params + step + noise_scale * local_trust * noise

                if restart_index > 0 and no_improve > restart_patience // 2:
                    proposal = 0.75 * proposal + 0.25 * best_params

                params = proposal
                global_iteration += 1

            trust = max(min_trust_radius, min(max_trust_radius, local_trust))

        self.last_run_diagnostics = diag
        return None
