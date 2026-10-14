"""Fused proposal variant of unchanged source096.

Adam, trust clipping, Gaussian proposal and restart pull are compiled together.
The first proposal compilation counts against the original Objective budget.
The remaining seed, search and predictive-stop code is inherited from096.
Fusion can change floating-point rounding; native paired results decide use.

Original provenance follows:
submission096: V1 StagedTrustPortfolio with a predictive final-call stop only.

Derived from outputs/l2d-candidate084-stage-20261010/baseline-extract/submission_v1.py
(sha256 9cdcb5fd...54d67c8, 4528 bytes). The search is unchanged from V1:
- random_seed handling
- start construction and order
- clipped Adam
- trust grow/shrink
- noise schedule and key splitting
- restart pull
- update order

The only addition is a guard before each Objective call. It stops when documented
obj.time_left suggests the next call would finish past the time budget. Such a call
would be counted but not logged. The guard uses only the public time_left and
evals_left values, either of which may be None. It makes no unlogged evaluations
and touches no private members. No score, run or gain is claimed.
"""
from __future__ import annotations

import math
import time

from dfbench import Objective, OptimizationAlgorithm
import jax
import jax.numpy as jnp
from fused_adam import build_proposal


class FusedStagedTrustPortfolio(OptimizationAlgorithm):
    algorithm_str = "tjlabs_staged_trust_portfolio_fused"

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

        obj.warmup_value_and_grad()
        diag = {"algorithm_str": self.algorithm_str, "calls": 0,
                "stopped_predictively": False, "ewma_call_s": None,
                "last_call_s": None,
                "note": "bookkeeping only; Objective history is authoritative"}
        self.last_run_diagnostics = diag
        obj.start_logging()
        optimizer, propose = build_proposal(learning_rate, add_noise=True)
        diag["proposal_backend"] = "fused_jax"

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

                params, state, key = propose(
                    params, grad, state, key, local_trust,
                    noise_start * (noise_decay ** global_iteration), best_params,
                    restart_index > 0 and no_improve > restart_patience // 2,
                )
                global_iteration += 1

            trust = max(min_trust_radius, min(max_trust_radius, local_trust))

        self.last_run_diagnostics = diag
        return None
