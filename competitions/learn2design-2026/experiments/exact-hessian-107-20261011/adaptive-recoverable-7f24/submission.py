"""Adaptive stagnation scheduling for the retained recoverable096 optimizer.

Additive derivative of exact RecoverablePolish096 source
ed4ce95963742f9b451001b85e4c493786ec6abd109b234b48d904177d4b560a.
The complete original source/control remains separately selected.

The Optax/JAX exploration generator, RNG/pending proposal, feasible-gradient
cache, L-BFGS mechanics and exhausted-anchor memory are unchanged. This source
adds an explicit fixed-late or stagnation schedule. Before the original80% late
boundary, eight non-improving exploration calls and12% of the budget remaining
at the last feasible improvement permit a short polish quantum, within a25%
earned actual-time allowance. Every eligibility decision uses the original
Objective timer and current-run observations. Fixed-late and off treatments
remain available. All policy constants are unmeasured experimental settings.

The public eval_count admission check retains the last valid logged scalar
observation even when that call exhausts the evaluation budget. Actual logged
Objective history remains the scoring source; no direct physics/log access is
introduced. This candidate has source review and is queued for the same native
receiving course; no physics score is assigned to this source.
"""
from __future__ import annotations

import hashlib
import math
import time
from collections import deque

import jax
import jax.numpy as jnp
import numpy as np
import optax
from dfbench import Objective, OptimizationAlgorithm


def parse_feasible(aux):
    if not isinstance(aux, dict) or "is_feasible" not in aux:
        return None
    value = np.asarray(aux["is_feasible"]).reshape(-1)
    if value.size != 1 or value.dtype.kind != "b":
        return None
    return bool(value[0])


def point_key(x):
    return hashlib.sha256(np.asarray(x, dtype=np.float64).reshape(-1).tobytes()).hexdigest()


class RecentPoints:
    def __init__(self, size=128):
        self.points = deque(maxlen=size)
        self.counts = {}

    def seen(self, x):
        return np.asarray(x, dtype=np.float64).reshape(-1).tobytes() in self.counts

    def add(self, x):
        key = np.asarray(x, dtype=np.float64).reshape(-1).tobytes()
        if len(self.points) == self.points.maxlen:
            old = self.points.popleft()
            self.counts[old] -= 1
            if self.counts[old] == 0:
                del self.counts[old]
        self.points.append(key)
        self.counts[key] = self.counts.get(key, 0) + 1


class CurvatureMemory:
    """Bounded L-BFGS pair store (at most m pairs, O(mn)) with a feasibility gate."""

    STORED = "stored"

    def __init__(self, m=8, eps=1e-8):
        if type(m) is not int or not 1 <= m <= 32:
            raise ValueError("memory must be int in [1,32]")
        if not (math.isfinite(eps) and eps > 0.0):
            raise ValueError("curvature_eps must be finite and > 0")
        self.m = m
        self.eps = float(eps)
        self.pairs = deque(maxlen=m)
        self.counts = {}

    def __len__(self):
        return len(self.pairs)

    def clear(self):
        self.pairs.clear()

    def _count(self, key):
        self.counts[key] = self.counts.get(key, 0) + 1
        return key

    def add(self, s, y, both_feasible, finite, origin=None):
        """Admit (s, y) only if both endpoints are finite logged feasible points
        and the curvature is clearly positive. `origin` is informational only."""
        if not finite:
            return self._count("nonfinite")
        if both_feasible is not True:
            return self._count("infeasible_endpoint")
        s = np.asarray(s, dtype=np.float64).reshape(-1)
        y = np.asarray(y, dtype=np.float64).reshape(-1)
        if s.shape != y.shape or not (np.all(np.isfinite(s)) and np.all(np.isfinite(y))):
            return self._count("nonfinite")
        sn = float(np.linalg.norm(s))
        yn = float(np.linalg.norm(y))
        if sn == 0.0 or yn == 0.0:
            return self._count("degenerate")
        sy = float(s @ y)
        if not math.isfinite(sy):
            return self._count("nonfinite")
        if sy <= 0.0:
            return self._count("nonpositive")
        if sy <= self.eps * sn * yn:
            return self._count("weak")
        self.pairs.append((s.copy(), y.copy(), 1.0 / sy))
        return self._count(self.STORED)

    def direction(self, g):
        """Standard L-BFGS two-loop recursion: returns -H g."""
        g = np.asarray(g, dtype=np.float64)
        if not self.pairs:
            return -g
        q = g.copy()
        alphas = []
        for s, y, rho in reversed(self.pairs):
            a = rho * float(s @ q)
            q -= a * y
            alphas.append(a)
        s_last, y_last, _ = self.pairs[-1]
        r = (float(s_last @ y_last) / float(y_last @ y_last)) * q
        for (s, y, rho), a in zip(self.pairs, reversed(alphas)):
            b = rho * float(y @ r)
            r += (a - b) * s
        return -r


class AnchoredQN:
    """One-trial-per-call L-BFGS trust step anchored at a logged feasible base."""

    def __init__(self, memory, radius, min_radius, max_radius, grow=2.0, shrink=0.5,
                 c1=1e-4, max_resets=2, grad_tol=1e-12):
        self.mem = memory
        self.r0 = float(radius)
        self.rmin = float(min_radius)
        self.rmax = float(max_radius)
        self.grow = float(grow)
        self.shrink = float(shrink)
        self.c1 = float(c1)
        self.max_resets = int(max_resets)
        self.grad_tol = float(grad_tol)
        self.x = None
        self.f = math.inf
        self.g = None
        self.r = self.r0
        self.resets = 0
        self.last_pair = None
        self.descent_resets = 0

    def start(self, x, f, g):
        self.x = np.array(x, dtype=np.float64, copy=True).reshape(-1)
        self.f = float(f)
        self.g = np.array(g, dtype=np.float64, copy=True).reshape(-1)
        self.r = self.r0
        self.resets = 0
        self.mem.clear()

    def propose(self):
        """Next trial from the feasible base, or None if locally stationary."""
        g = self.g
        gn = float(np.linalg.norm(g))
        if not math.isfinite(gn) or gn <= self.grad_tol:
            return None
        d = None
        if len(self.mem):
            d = self.mem.direction(g)
            dn = float(np.linalg.norm(d))
            gd = float(g @ d)
            if (not (math.isfinite(dn) and math.isfinite(gd)) or dn == 0.0
                    or gd >= -1e-12 * dn * gn):
                self.mem.clear()           # poor model: fall back to steepest descent
                self.descent_resets += 1
                d = None
            elif dn > self.r:
                d = d * (self.r / dn)
        if d is None:
            d = -g * (self.r / gn)
        return self.x + d

    def observe(self, xt, ft, gt, feasible, finite):
        """Update the base/memory/radius from one logged trial. Never evaluates."""
        xt = np.asarray(xt, dtype=np.float64).reshape(-1)
        s = xt - self.x
        if finite and feasible is True:
            gt = np.asarray(gt, dtype=np.float64).reshape(-1)
            self.last_pair = self.mem.add(s, gt - self.g, True, True, origin=self.x)
            ft = float(ft)
            if ft < self.f:
                pred = float(self.g @ s)
                armijo = ft <= self.f + self.c1 * pred
                full = float(np.linalg.norm(s)) >= 0.99 * self.r
                self.x, self.f, self.g = xt.copy(), ft, gt.copy()
                self.resets = 0
                if armijo and full:
                    self.r = min(self.rmax, self.r * self.grow)
                return "accepted"
            return self._contract("nonimproving")
        # An endpoint is not a finite logged feasible point: never stored.
        self.last_pair = self.mem.add(s, None, False, bool(finite))
        return self._contract("not_feasible" if finite else "nonfinite")

    def skip_repeat(self):
        self.last_pair = None
        return self._contract("repeat")

    def _contract(self, outcome):
        r = self.r * self.shrink
        if r >= self.rmin:
            self.r = r
            return outcome
        if self.resets < self.max_resets:
            self.resets += 1
            self.mem.clear()
            self.r = self.r0
            return "reset"
        return "radius_floor"



class AdaptiveRecoverablePolish096(OptimizationAlgorithm):
    algorithm_str = "tjlabs_096_adaptive_recoverable_polish_7f24"

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
        polish_enabled: bool = True,
        polish_start_fraction: float = 0.80,
        polish_schedule: str = "stagnation",
        stagnation_fraction: float = 0.12,
        min_stagnant_explore_calls: int = 8,
        early_polish_time_fraction: float = 0.25,
        min_remaining_polish_calls: int = 2,
        polish_quantum: int = 4,
        resume_explore_calls: int = 4,
        memory: int = 8,
        curvature_eps: float = 1e-8,
        qn_radius: float = 0.08,
        qn_min_radius: float = 1e-6,
        qn_max_radius: float = 0.30,
        qn_grow: float = 2.0,
        qn_shrink: float = 0.5,
        armijo_c1: float = 1e-4,
        trace_limit: int = 4096,
        **kwargs,
    ) -> None:
        obj = objective
        if type(restarts) is not int or not 1 <= restarts <= 16:
            raise ValueError("restarts must be int in [1,16]")
        if type(restart_patience) is not int or restart_patience < 20:
            raise ValueError("restart_patience must be int >=20")
        if not 0.0 < learning_rate <= 1.0:
            raise ValueError("learning_rate must be in (0,1]")
        if not 0 < min_trust_radius <= trust_radius <= max_trust_radius <= 2.0:
            raise ValueError("invalid trust radii")
        if not 0.0 <= noise_start <= 1.0 or not 0.9 <= noise_decay <= 1.0:
            raise ValueError("invalid noise schedule")
        if not (math.isfinite(stop_margin) and 1.0 <= stop_margin <= 3.0
                and math.isfinite(return_reserve_s) and 0.0 <= return_reserve_s <= 5.0):
            raise ValueError("invalid stop safeguard")
        if type(polish_enabled) is not bool:
            raise ValueError("polish_enabled must be bool")
        if not math.isfinite(polish_start_fraction) or not 0.0 <= polish_start_fraction < 1.0:
            raise ValueError("polish_start_fraction must be in [0,1)")
        if polish_schedule not in ("late", "stagnation"):
            raise ValueError("polish_schedule must be late or stagnation")
        if (isinstance(stagnation_fraction, bool) or not math.isfinite(stagnation_fraction)
                or not 0.01 <= stagnation_fraction <= 0.50):
            raise ValueError("stagnation_fraction must be finite in [0.01,0.50]")
        if (type(min_stagnant_explore_calls) is not int
                or not 1 <= min_stagnant_explore_calls <= 1024):
            raise ValueError("min_stagnant_explore_calls must be int in [1,1024]")
        if (isinstance(early_polish_time_fraction, bool)
                or not math.isfinite(early_polish_time_fraction)
                or not 0.05 <= early_polish_time_fraction <= 0.50):
            raise ValueError("early_polish_time_fraction must be finite in [0.05,0.50]")
        if (type(min_remaining_polish_calls) is not int
                or not 1 <= min_remaining_polish_calls <= 64):
            raise ValueError("min_remaining_polish_calls must be int in [1,64]")
        if type(polish_quantum) is not int or not 1 <= polish_quantum <= 64:
            raise ValueError("polish_quantum must be int in [1,64]")
        if type(resume_explore_calls) is not int or not 1 <= resume_explore_calls <= 256:
            raise ValueError("resume_explore_calls must be int in [1,256]")
        if type(memory) is not int or not 1 <= memory <= 32:
            raise ValueError("memory must be int in [1,32]")
        if not math.isfinite(curvature_eps) or curvature_eps <= 0:
            raise ValueError("curvature_eps must be finite and positive")
        if not 0 < qn_min_radius <= qn_radius <= qn_max_radius <= 2.0:
            raise ValueError("invalid polish radii")
        if not math.isfinite(qn_grow) or qn_grow <= 1 or not 0 < qn_shrink < 1:
            raise ValueError("invalid polish radius factors")
        if not 0 < armijo_c1 < 0.5:
            raise ValueError("armijo_c1 must be in (0,0.5)")
        if type(trace_limit) is not int or not 0 <= trace_limit <= 65536:
            raise ValueError("trace_limit must be int in [0,65536]")

        # Original096 preparation, key and start order.
        _, key = self.prepare(obj, unbounded=True, random_seed=random_seed)
        if random_seed is None:
            random_seed = 0
        starts = []
        if init_params is not None:
            starts.append(jnp.asarray(init_params))
        while len(starts) < restarts:
            starts.append(jnp.asarray(obj.random_params_unbounded()))

        use_aux = obj.power_thresholds is not None
        if use_aux:
            obj.warmup_value_and_grad_aux()
        else:
            obj.warmup_value_and_grad()

        diag = {
            "algorithm_str": self.algorithm_str, "calls": 0,
            "explore_calls": 0, "polish_calls": 0, "stopped_predictively": False,
            "stop_reason": None, "uses_aux": use_aux,
            "first_feasible_call": None, "feasible_calls": 0,
            "unknown_feasibility_calls": 0, "nonfinite_calls": 0,
            "polish_episodes": 0, "polish_quanta": 0, "polish_resumes": 0,
            "polish_policy_calls": {"late": 0, "stagnation": 0, "quantum": 0},
            "polish_objective_elapsed_s": 0.0, "unlogged_returns": 0,
            "explore_resumes": 0, "repeat_skips": 0, "anchor_replacements": 0,
            "exhausted_anchor_skips": 0, "qn_outcomes": {}, "pair_status": {},
            "best_feasible_internal": None, "best_feasible_call_internal": None,
            "trace": [], "trace_truncated": 0, "kwargs_ignored": sorted(kwargs),
            "configuration": {
                "polish_enabled": polish_enabled,
                "polish_start_fraction": polish_start_fraction,
                "polish_schedule": polish_schedule,
                "stagnation_fraction": stagnation_fraction,
                "min_stagnant_explore_calls": min_stagnant_explore_calls,
                "early_polish_time_fraction": early_polish_time_fraction,
                "min_remaining_polish_calls": min_remaining_polish_calls,
                "polish_quantum": polish_quantum,
                "resume_explore_calls": resume_explore_calls,
                "qn_radius": qn_radius, "qn_min_radius": qn_min_radius,
                "qn_max_radius": qn_max_radius,
            },
            "note": "Objective history is authoritative; trace modes describe actual calls.",
        }
        self.last_run_diagnostics = diag
        recent = RecentPoints()
        exhausted = deque(maxlen=128)
        inc = {"x": None, "f": math.inf, "g": None, "key": None, "call": None,
               "improvement_time_s": None, "explore_calls_at_improvement": 0}
        ewma = None
        last_dt = None
        qn = None
        qn_start_key = None
        qn_call_count = 0
        explore_since_polish = resume_explore_calls
        previous_mode = None
        skip_anchor_key = None

        def stopped():
            if bool(obj.budget_exceeded):
                diag["stop_reason"] = "budget_exceeded"
                return True
            left = obj.evals_left
            if left is not None and left < 1:
                diag["stop_reason"] = "evals_left"
                return True
            if ewma is None:
                return False
            tl = obj.time_left
            if tl is None or not math.isfinite(float(tl)):
                return False
            if float(tl) < stop_margin * max(ewma, last_dt) + return_reserve_s:
                diag["stop_reason"] = "predicted_overrun"
                diag["stopped_predictively"] = True
                return True
            return False

        def public_number(name):
            value = getattr(obj, name, None)
            if value is None or isinstance(value, (bool, np.bool_)):
                return None
            try:
                value = float(value)
            except (TypeError, ValueError, OverflowError):
                return None
            return value if math.isfinite(value) else None

        def polish_policy():
            # Eligibility uses only public actual elapsed/remaining budget and
            # measurements from this run. Fixed-late remains a separate mode.
            left, elapsed = public_number("time_left"), public_number("time_elapsed")
            if left is None or elapsed is None or left < 0 or elapsed < 0:
                return None
            total = elapsed + left
            if total <= 0:
                return None
            if elapsed >= polish_start_fraction * total:
                return "late"
            if polish_schedule == "late" or inc["x"] is None or ewma is None:
                return None
            cost = max(ewma, last_dt)
            if not math.isfinite(cost) or cost <= 0:
                return None
            # Earn early refinement time as the actual run progresses. Account
            # using Objective elapsed deltas, not a guessed call-count cost.
            if (left < min_remaining_polish_calls * cost + return_reserve_s
                    or diag["polish_objective_elapsed_s"] + cost
                    > early_polish_time_fraction * (elapsed + cost)):
                return None
            # A successful short quantum may finish using its cached curvature;
            # a newly improved incumbent does not discard it after one trial.
            if (qn is not None and previous_mode == "polish"
                    and qn_call_count % polish_quantum != 0):
                return "quantum"
            improved_at = inc["improvement_time_s"]
            if (improved_at is None
                    or diag["explore_calls"] - inc["explore_calls_at_improvement"]
                    < min_stagnant_explore_calls):
                return None
            remaining_at_improvement = max(0.0, total - improved_at)
            if elapsed - improved_at < stagnation_fraction * remaining_at_improvement:
                return None
            return "stagnation"

        def trace(mode, feasible, loss, outcome=None, anchor_key=None, radius=None,
                  policy=None, logged=None):
            record = {
                "call": diag["calls"], "mode": mode, "feasible": feasible,
                "loss": float(loss) if math.isfinite(float(loss)) else None,
                "objective_time_elapsed_s": float(obj.time_elapsed),
                "polish_policy": policy, "logged_by_public_counter": logged,
            }
            if mode == "polish":
                record.update(outcome=outcome, anchor_key=anchor_key, radius=radius)
            if len(diag["trace"]) < trace_limit:
                diag["trace"].append(record)
            else:
                diag["trace_truncated"] += 1

        def offer(params, loss, grad, feasible, finite):
            if finite and feasible is True and float(loss) < inc["f"]:
                arr = np.asarray(params, dtype=np.float64).reshape(-1)
                inc.update(x=arr.copy(), f=float(loss),
                           g=np.asarray(grad, dtype=np.float64).reshape(-1).copy(),
                           key=point_key(arr), call=diag["calls"],
                           improvement_time_s=public_number("time_elapsed"),
                           explore_calls_at_improvement=diag["explore_calls"])

        def end_polish(reason):
            nonlocal qn, qn_start_key, qn_call_count
            if qn is not None:
                for identity in (qn_start_key, point_key(qn.x)):
                    if identity is not None and identity not in exhausted:
                        exhausted.append(identity)
                outcomes = diag["qn_outcomes"]
                outcomes["episode:" + reason] = outcomes.get("episode:" + reason, 0) + 1
            qn = None
            qn_start_key = None
            qn_call_count = 0

        def exploration():
            """096 update order; side trials never enter this generator."""
            nonlocal key
            best_params = starts[0]
            best_loss = jnp.asarray(jnp.inf)
            trust = float(trust_radius)
            global_iteration = 0
            for restart_index, start in enumerate(starts):
                params = start
                optimizer = optax.chain(
                    optax.clip_by_global_norm(1.0), optax.adam(learning_rate),
                )
                state = optimizer.init(params)
                local_best = jnp.asarray(jnp.inf)
                no_improve = 0
                local_trust = trust
                while no_improve < restart_patience:
                    loss, grad, finite = yield params
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

        obj.start_logging()
        explore = exploration()
        pending = next(explore)
        try:
            while not stopped():
                mode = "explore"
                params = pending
                policy = polish_policy() if polish_enabled and use_aux else None
                if (polish_enabled and use_aux and inc["x"] is not None
                        and policy is not None and explore_since_polish >= resume_explore_calls):
                    if qn is not None and inc["f"] < qn.f and inc["key"] not in exhausted:
                        qn = None
                        diag["anchor_replacements"] += 1
                    if qn is None and inc["key"] not in exhausted:
                        qn = AnchoredQN(CurvatureMemory(memory, curvature_eps), qn_radius,
                                        qn_min_radius, qn_max_radius, qn_grow, qn_shrink,
                                        armijo_c1, max_resets=0)
                        qn.start(inc["x"], inc["f"], inc["g"])
                        qn_start_key = inc["key"]
                        qn_call_count = 0
                        diag["polish_episodes"] += 1
                    elif qn is None and skip_anchor_key != inc["key"]:
                        diag["exhausted_anchor_skips"] += 1
                        skip_anchor_key = inc["key"]
                    # Repeat contraction is deterministic and makes no Objective
                    # call. Recheck the true timer on each iteration.
                    while qn is not None and not stopped():
                        proposal = qn.propose()
                        if proposal is None:
                            end_polish("gradient_floor")
                            break
                        actual_proposal = jnp.asarray(proposal, dtype=pending.dtype)
                        if recent.seen(actual_proposal):
                            diag["repeat_skips"] += 1
                            outcome = qn.skip_repeat()
                            if outcome == "radius_floor":
                                end_polish("radius_floor")
                            continue
                        params = actual_proposal
                        mode = "polish"
                        break
                if stopped():
                    break
                if previous_mode == "polish" and mode == "explore":
                    diag["explore_resumes"] += 1
                if previous_mode == "explore" and mode == "polish":
                    diag["polish_quanta"] += 1
                    if qn_call_count:
                        diag["polish_resumes"] += 1
                previous_mode = mode

                elapsed_before = public_number("time_elapsed")
                evals_before = public_number("eval_count")
                t0 = time.perf_counter()
                if use_aux:
                    loss, grad, aux = obj.value_and_grad_aux(params)
                    feasible = parse_feasible(aux)
                else:
                    loss, grad = obj.value_and_grad(params)
                    feasible = None
                finite = bool(jnp.isfinite(loss)) and bool(jnp.all(jnp.isfinite(grad)))
                last_dt = time.perf_counter() - t0
                ewma = last_dt if ewma is None else 0.7 * ewma + 0.3 * last_dt
                diag["calls"] += 1
                diag[mode + "_calls"] += 1
                elapsed_after = public_number("time_elapsed")
                evals_after = public_number("eval_count")
                logged = (None if evals_before is None or evals_after is None
                          else evals_after > evals_before)
                exhausted_budget = bool(obj.budget_exceeded)
                if mode == "polish":
                    diag["polish_policy_calls"][policy] += 1
                    if elapsed_before is not None and elapsed_after is not None:
                        diag["polish_objective_elapsed_s"] += max(0.0, elapsed_after - elapsed_before)
                # Pinned dfbench0.3.3 scalar admission increments eval_count only
                # after the time check and original history admission. The final
                # allowed evaluation may set budget_exceeded after it is logged.
                if logged is False or (logged is None and exhausted_budget):
                    diag["unlogged_returns"] += 1
                    diag["stop_reason"] = "unlogged_return_after_call"
                    break
                recent.add(params)
                if feasible is None:
                    diag["unknown_feasibility_calls"] += 1
                if not finite:
                    diag["nonfinite_calls"] += 1
                if feasible is True and finite:
                    diag["feasible_calls"] += 1
                    if diag["first_feasible_call"] is None:
                        diag["first_feasible_call"] = diag["calls"]
                offer(params, loss, grad, feasible, finite)

                if mode == "polish":
                    anchor_before = point_key(qn.x)
                    radius_before = qn.r
                    outcome = qn.observe(np.asarray(params), float(loss),
                                         np.asarray(grad), feasible, finite)
                    diag["qn_outcomes"][outcome] = diag["qn_outcomes"].get(outcome, 0) + 1
                    if qn.last_pair is not None:
                        pairs = diag["pair_status"]
                        pairs[qn.last_pair] = pairs.get(qn.last_pair, 0) + 1
                    qn_call_count += 1
                    trace(mode, feasible, loss, outcome, anchor_before, radius_before,
                          policy=policy, logged=logged)
                    if outcome == "radius_floor":
                        end_polish("radius_floor")
                        explore_since_polish = 0
                    elif qn_call_count % polish_quantum == 0:
                        explore_since_polish = 0
                else:
                    trace(mode, feasible, loss, logged=logged)
                    explore_since_polish += 1
                    if exhausted_budget:
                        diag["stop_reason"] = "budget_exceeded_after_logged_call"
                        break
                    try:
                        # Advance only from the actual exploration observation.
                        # The returned pending proposal and frame persist during
                        # every later polishing call, including rejected trials.
                        pending = explore.send((loss, grad, finite))
                    except StopIteration:
                        diag["stop_reason"] = "original_exploration_exhausted"
                        break
                if exhausted_budget:
                    diag["stop_reason"] = "budget_exceeded_after_logged_call"
                    break
        finally:
            explore.close()
            diag["best_feasible_internal"] = None if inc["x"] is None else inc["f"]
            diag["best_feasible_call_internal"] = inc["call"]
            diag["active_polish_radius"] = None if qn is None else qn.r
            diag["exhausted_anchor_identities"] = list(exhausted)
            diag["ewma_call_s"] = ewma
            diag["last_call_s"] = last_dt
            self.last_run_diagnostics = diag
        return None
