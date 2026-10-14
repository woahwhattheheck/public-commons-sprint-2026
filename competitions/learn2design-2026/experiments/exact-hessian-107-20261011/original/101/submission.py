"""tjlabs_budget_lbfgs100 -- budget-aware safeguarded L-BFGS for Learn2Design UIFO.

Status: NOT executed, NOT tested on physics, NOT submitted. No score is claimed.
All numeric defaults are design choices pending measurement, not source facts.

Mechanism (complementary to 096/099, which are clipped-Adam portfolios):
  * Search space: documented unbounded sigmoid mode via
    prepare(unbounded=True), the same space as 096/099.
  * Every trial point costs exactly ONE logged Objective call:
    value_and_grad_aux on penalty-contract problems, value_and_grad otherwise.
    It never uses value_function(), log_evaluation(), Hessians or unlogged calls.
  * The L-BFGS two-loop recursion runs in host NumPy float64 (n ~ 200, m <= 8,
    negligible cost). Nothing custom is JIT-compiled, before or after logging.
  * A curvature pair (s, y) is stored only if s.y > eps*|s|*|y|.
    A non-descent or non-finite direction resets memory to steepest descent.
  * Every step is capped by a trust radius in unbounded coordinates.
  * Backtracking Armijo line search, with safeguarded cubic/quadratic
    interpolation that reuses the gradient returned with every trial.
    A failed line search costs no extra call: the iterate stays at the last
    accepted (already evaluated) point, memory is reset and the radius shrinks.
  * Feasibility: the line search uses the Objective's real total loss. The
    default penalty is never changed. Iterates may pass through infeasible
    points, but the internal restart anchor is the best FEASIBLE point by
    aux['is_feasible']; a lower-loss infeasible point never replaces it.
    The Objective history, not this bookkeeping, determines the score.
  * Escape: budget-scaled stall patience triggers restarts. Restarts alternate
    between sparse random kicks around the anchor and fresh seeded starts.
    The kick size grows after unsuccessful kicks.
  * Anytime start: optional single batched value screen of seeded starts.
  * Budget: a predictive stop before every call, from measured durations of
    completed calls. It uses only public time_left / evals_left / budget_exceeded.
    It never resets, extends or substitutes the Objective budget.
"""
from __future__ import annotations

import math
import time
from collections import deque

import numpy as np
import jax.numpy as jnp

from dfbench import Objective, OptimizationAlgorithm

try:  # import path documented in docs/dfbench/Implementing-a-New-Algorithm.md
    from dfbench.core.algorithm import AlgorithmType as _AlgorithmType
except Exception:  # tolerate absence; README contract does not require it
    _AlgorithmType = None


class _BudgetStop(Exception):
    """Internal control-flow signal: make no further Objective call."""


def _two_loop(g, S, Y):
    """Standard L-BFGS two-loop recursion. Returns the direction -H g.

    Every stored pair satisfies s.y > 0.
    """
    q = g.copy()
    hist = []
    for s, y in zip(reversed(S), reversed(Y)):
        rho = 1.0 / float(y @ s)
        a = rho * float(s @ q)
        q -= a * y
        hist.append((a, rho, s, y))
    s_last, y_last = S[-1], Y[-1]
    gamma = float(s_last @ y_last) / float(y_last @ y_last)
    r = gamma * q
    for a, rho, s, y in reversed(hist):
        b = rho * float(y @ r)
        r += (a - b) * s
    return -r


def _interp_step(a1, f0, d0, f1, d1):
    """Safeguarded cubic interpolation (Nocedal & Wright eq. 3.59).

    Interpolates on [0, a1], falls back to a quadratic, and clamps the
    result to [0.1*a1, 0.5*a1].
    """
    lo, hi = 0.1 * a1, 0.5 * a1
    cand = None
    if all(math.isfinite(v) for v in (a1, f0, d0, f1, d1)) and a1 > 0:
        theta = 3.0 * (f0 - f1) / a1 + d0 + d1
        disc = theta * theta - d0 * d1
        if disc >= 0.0:
            w = math.sqrt(disc)
            denom = d1 - d0 + 2.0 * w
            if denom != 0.0:
                cand = a1 - a1 * (d1 + w - theta) / denom
        if cand is None or not math.isfinite(cand):
            denom = 2.0 * (f1 - f0 - d0 * a1)
            cand = (-d0 * a1 * a1 / denom) if denom > 0.0 else None
    if cand is None or not math.isfinite(cand):
        cand = hi
    return min(hi, max(lo, cand))


def _mask_outward(x, d, clip):
    """Zero the direction components that push an already clipped coordinate outward."""
    out = ((x >= clip) & (d > 0.0)) | ((x <= -clip) & (d < 0.0))
    if out.any():
        d = d.copy()
        d[out] = 0.0
    return d


class BudgetLBFGS100(OptimizationAlgorithm):
    algorithm_str = "tjlabs_budget_lbfgs100"
    if _AlgorithmType is not None:
        algorithm_type = _AlgorithmType.GRADIENT_BASED

    def __init__(self):
        self.last_run_diagnostics = {}

    def optimize(
        self,
        objective: Objective,
        init_params=None,
        random_seed: int | None = None,
        # --- quasi-Newton core ---
        memory: int = 8,
        trust_radius_init: float = 0.5,
        trust_radius_min: float = 1e-4,
        trust_radius_max: float = 5.0,
        trust_grow: float = 2.0,
        trust_shrink: float = 0.5,
        armijo_c1: float = 1e-4,
        wolfe_c2: float = 0.9,
        max_line_search: int = 6,
        curvature_eps: float = 1e-8,
        grad_tol: float = 1e-10,
        coord_clip: float = 20.0,
        # --- anytime start ---
        screen_batch: int = 4,
        # --- stall / restart / escape ---
        patience_fraction: float = 0.05,
        patience_min: int = 25,
        patience_max: int = 600,
        improve_rtol: float = 1e-6,
        kick_sigma: float = 0.5,
        kick_fraction: float = 0.3,
        kick_growth: float = 1.5,
        kick_sigma_max: float = 3.0,
        fresh_every: int = 3,
        polish_fraction: float = 0.1,
        max_infeasible_streak: int = 40,
        # --- predictive budget stop ---
        stop_margin: float = 1.15,
        return_reserve_s: float = 0.05,
        duration_window: int = 8,
        max_calls: int | None = None,
        **kwargs,
    ) -> None:
        obj = objective

        # ---------------- validation ----------------
        def _req(cond, msg):
            if not cond:
                raise ValueError(msg)

        _req(type(memory) is int and 1 <= memory <= 50, "memory must be int in [1,50]")
        _req(0.0 < trust_radius_min <= trust_radius_init <= trust_radius_max,
             "need 0 < trust_radius_min <= trust_radius_init <= trust_radius_max")
        _req(trust_grow > 1.0 and 0.0 < trust_shrink < 1.0, "invalid trust factors")
        _req(0.0 < armijo_c1 < wolfe_c2 < 1.0, "need 0 < armijo_c1 < wolfe_c2 < 1")
        _req(type(max_line_search) is int and 1 <= max_line_search <= 30,
             "max_line_search must be int in [1,30]")
        _req(curvature_eps > 0.0 and grad_tol >= 0.0 and coord_clip > 0.0,
             "invalid curvature_eps / grad_tol / coord_clip")
        _req(type(screen_batch) is int and (screen_batch == 0 or 2 <= screen_batch <= 64),
             "screen_batch must be 0 or int in [2,64]")
        _req(0.0 < patience_fraction <= 1.0, "patience_fraction must be in (0,1]")
        _req(type(patience_min) is int and type(patience_max) is int
             and 1 <= patience_min <= patience_max, "invalid patience bounds")
        _req(improve_rtol >= 0.0, "improve_rtol must be >= 0")
        _req(kick_sigma > 0.0 and 0.0 < kick_fraction <= 1.0 and kick_growth >= 1.0
             and kick_sigma_max >= kick_sigma, "invalid kick parameters")
        _req(type(fresh_every) is int and fresh_every >= 1, "fresh_every must be int >= 1")
        _req(0.0 <= polish_fraction < 1.0, "polish_fraction must be in [0,1)")
        _req(type(max_infeasible_streak) is int and max_infeasible_streak >= 1,
             "max_infeasible_streak must be int >= 1")
        _req(math.isfinite(stop_margin) and 1.0 <= stop_margin <= 3.0
             and math.isfinite(return_reserve_s) and 0.0 <= return_reserve_s <= 5.0,
             "invalid stop safeguard")
        _req(type(duration_window) is int and 1 <= duration_window <= 64,
             "duration_window must be int in [1,64]")
        _req(max_calls is None or (type(max_calls) is int and max_calls >= 1),
             "max_calls must be None or int >= 1")

        # ---------------- source-faithful setup ----------------
        seed, _key = self.prepare(obj, unbounded=True, random_seed=random_seed)
        rng = np.random.default_rng(0 if seed is None else int(seed) % (2 ** 32))
        n = int(obj.n_params)
        use_aux = obj.power_thresholds is not None  # documented: None => no penalty contract

        n_draw = screen_batch if screen_batch >= 2 else 1
        raw = obj.random_params_unbounded(n_samples=n_draw)
        dtype = np.asarray(raw).dtype
        if not np.issubdtype(dtype, np.floating):
            dtype = np.dtype(np.float32)
        starts = np.asarray(raw, dtype=np.float64).reshape(n_draw, n)
        if init_params is not None:  # treated as unbounded-space, as in 096/099
            starts[0] = np.asarray(init_params, dtype=np.float64).reshape(n)
        starts = np.clip(starts, -coord_clip, coord_clip)

        diag = {
            "algorithm_str": self.algorithm_str,
            "uses_aux": use_aux,
            "calls": 0, "single_calls": 0, "batch_calls": 0,
            "accepted_steps": 0, "ls_trials": 0, "ls_failures": 0,
            "curvature_skips": 0, "descent_resets": 0, "nonfinite": 0,
            "wolfe_satisfied": 0,
            "end_patience": 0, "end_stationary": 0, "end_trust_collapse": 0,
            "feasibility_recoveries": 0, "episodes": 0,
            "restarts_kick": 0, "restarts_fresh": 0, "restarts_recover": 0,
            "screen_enabled": False, "screen_error": None,
            "ewma_single_s": None, "ewma_batch_s": None,
            "stopped_predictively": False, "stop_reason": None,
            "best_feasible_internal": None,
            "kwargs_ignored": sorted(kwargs.keys()),
            "note": "bookkeeping only; Objective history is authoritative",
        }
        self.last_run_diagnostics = diag

        # ---------------- documented pre-logging warmup only ----------------
        if use_aux:
            obj.warmup_value_and_grad_aux()
        else:
            obj.warmup_value_and_grad()
        screen_enabled = screen_batch >= 2
        if screen_enabled:
            try:
                if use_aux:
                    obj.warmup_vmap_value_aux(batch_size=screen_batch)
                else:
                    obj.warmup_vmap_value(batch_size=screen_batch)
            except Exception as exc:  # e.g. memory; screening is optional
                screen_enabled = False
                diag["screen_error"] = "warmup: " + repr(exc)[:300]
        diag["screen_enabled"] = screen_enabled

        obj.start_logging()

        # ---------------- timing model and predictive stop ----------------
        st = {"units": 0}
        dur = {"single": deque(maxlen=duration_window),
               "batch": deque(maxlen=duration_window)}
        ewma = {"single": None, "batch": None}

        def _record(kind, dt, units):
            dur[kind].append(dt)
            ewma[kind] = dt if ewma[kind] is None else 0.7 * ewma[kind] + 0.3 * dt
            st["units"] += units
            diag["calls"] = st["units"]
            diag[kind + "_calls"] += 1
            diag["ewma_" + kind + "_s"] = ewma[kind]

        def _pred(kind):
            other = "batch" if kind == "single" else "single"
            for k in (kind, other):
                if dur[k]:
                    return max(ewma[k], max(dur[k]))
            return None

        def _should_stop(kind, units):
            if obj.budget_exceeded:
                diag["stop_reason"] = "budget_exceeded"
                return True
            if max_calls is not None and st["units"] + units > max_calls:
                diag["stop_reason"] = "max_calls"
                return True
            el = obj.evals_left
            if el is not None and el < units:
                diag["stop_reason"] = "evals_left"
                return True
            tl = obj.time_left
            pred = _pred(kind)
            if tl is None or pred is None:
                return False  # first call always allowed: a run needs a logged entry
            tl = float(tl)
            if not math.isfinite(tl):
                return False
            if tl < stop_margin * pred + return_reserve_s:
                diag["stop_reason"] = "predicted_overrun"
                return True
            return False

        def _patience():
            est = None
            p_call = _pred("single")
            tl = obj.time_left
            if tl is not None and p_call is not None and math.isfinite(float(tl)):
                est = st["units"] + max(0.0, float(tl)) / max(p_call, 1e-6)
            el = obj.evals_left
            if el is not None:
                cap = st["units"] + float(el)
                est = cap if est is None else min(est, cap)
            if est is None:
                return patience_min if tl is not None else patience_max
            return int(min(patience_max, max(patience_min, round(patience_fraction * est))))

        # ---------------- incumbents (internal only) ----------------
        inc = {"x": None, "f": math.inf, "g": None}       # best FEASIBLE point
        best_any = {"x": None, "f": math.inf, "g": None}  # best finite point, any feasibility

        def _note(x, f, g, feas):
            if feas and f < inc["f"]:
                inc["x"], inc["f"] = x.copy(), f
                inc["g"] = None if g is None else g.copy()
            if f < best_any["f"]:
                best_any["x"], best_any["f"] = x.copy(), f
                best_any["g"] = None if g is None else g.copy()

        # ---------------- logged Objective calls ----------------
        def eval_single(x):
            if _should_stop("single", 1):
                raise _BudgetStop
            p = jnp.asarray(x.astype(dtype))
            t0 = time.perf_counter()
            if use_aux:
                loss, grad, aux = obj.value_and_grad_aux(p)
                feas = bool(np.asarray(aux["is_feasible"]).reshape(-1)[0])
            else:
                loss, grad = obj.value_and_grad(p)
                feas = True  # no feasibility contract on this problem
            f = float(loss)
            g = np.asarray(grad, dtype=np.float64).reshape(n)
            _record("single", time.perf_counter() - t0, 1)
            if obj.budget_exceeded:
                diag["stop_reason"] = "budget_exceeded"
                raise _BudgetStop  # call may not have been admitted; do not build on it
            ok = math.isfinite(f) and bool(np.all(np.isfinite(g)))
            if not ok:
                diag["nonfinite"] += 1
                return f, g, feas, False
            _note(x, f, g, feas)
            return f, g, feas, True

        def _screen(X):
            B = X.shape[0]
            if _should_stop("batch", B):
                raise _BudgetStop
            P = jnp.asarray(X.astype(dtype))
            t0 = time.perf_counter()
            if use_aux:
                losses, aux = obj.vmap_value_aux(P)
                feas = np.asarray(aux["is_feasible"]).reshape(B).astype(bool)
            else:
                losses = obj.vmap_value(P)
                feas = np.ones(B, dtype=bool)
            losses = np.asarray(losses, dtype=np.float64).reshape(B)
            _record("batch", time.perf_counter() - t0, B)
            if obj.budget_exceeded:
                diag["stop_reason"] = "budget_exceeded"
                raise _BudgetStop
            keys = []
            for i in range(B):
                fin = math.isfinite(float(losses[i]))
                if fin:
                    _note(X[i], float(losses[i]), None, bool(feas[i]))
                rank = 0 if (fin and feas[i]) else (1 if fin else 2)
                keys.append((rank, float(losses[i]) if fin else math.inf, i))
            return [k[2] for k in sorted(keys)]

        def _draw_one():
            return np.clip(np.asarray(obj.random_params_unbounded(), dtype=np.float64)
                           .reshape(n), -coord_clip, coord_clip)

        def _kick(anchor_x, sigma):
            x0 = np.array(anchor_x, dtype=np.float64)
            mask = rng.random(n) < kick_fraction
            if not mask.any():
                mask[int(rng.integers(n))] = True
            x0[mask] += sigma * rng.standard_normal(int(mask.sum()))
            return np.clip(x0, -coord_clip, coord_clip)

        # ---------------- one safeguarded L-BFGS episode ----------------
        def run_episode(x0, f0=None, g0=None, feas0=None):
            x = np.clip(np.asarray(x0, dtype=np.float64).reshape(n), -coord_clip, coord_clip)
            if f0 is None:
                f, g, feas, ok = eval_single(x)
                if not ok:
                    return "nonfinite_start"
            else:
                f, g, feas = float(f0), np.array(g0, dtype=np.float64), bool(feas0)
            S = deque(maxlen=memory)
            Y = deque(maxlen=memory)
            delta = float(trust_radius_init)
            ep_best = f
            since = 0
            fail_streak = 0
            infeas_streak = 0 if feas else 1
            while True:
                if since >= _patience():
                    diag["end_patience"] += 1
                    return "patience"
                gnorm = float(np.linalg.norm(g))
                if not math.isfinite(gnorm) or gnorm <= grad_tol:
                    diag["end_stationary"] += 1
                    return "stationary"
                d = _two_loop(g, S, Y) if S else -g * (delta / gnorm)
                d = _mask_outward(x, d, coord_clip)
                dn = float(np.linalg.norm(d))
                gd = float(d @ g)
                if (not (math.isfinite(dn) and math.isfinite(gd)) or dn == 0.0
                        or gd >= -1e-12 * dn * gnorm):
                    S.clear()
                    Y.clear()
                    diag["descent_resets"] += 1
                    d = _mask_outward(x, -g * (delta / gnorm), coord_clip)
                    dn = float(np.linalg.norm(d))
                    if dn == 0.0:
                        diag["end_stationary"] += 1
                        return "stationary"
                if dn > delta:
                    d = d * (delta / dn)

                alpha = 1.0
                trials = 0
                accepted = False
                xt = stp = gt = None
                ft = math.inf
                feast = False
                pred = 0.0
                while trials < max_line_search:
                    xt = np.clip(x + alpha * d, -coord_clip, coord_clip)
                    stp = xt - x
                    pred = float(g @ stp)
                    if not pred < 0.0:
                        break  # clipping removed descent; treat as failure
                    ft, gt, feast, okt = eval_single(xt)
                    trials += 1
                    diag["ls_trials"] += 1
                    if not okt:
                        alpha *= 0.25
                        continue
                    if ft <= f + armijo_c1 * pred:
                        accepted = True
                        break
                    alpha = _interp_step(alpha, f, pred / alpha, ft, float(gt @ stp) / alpha)
                since += max(trials, 1)

                if accepted:
                    sn = float(np.linalg.norm(stp))
                    yv = gt - g
                    yn = float(np.linalg.norm(yv))
                    sy = float(stp @ yv)
                    if math.isfinite(sy) and yn > 0.0 and sy > curvature_eps * sn * yn:
                        S.append(stp.copy())
                        Y.append(yv)
                    else:
                        diag["curvature_skips"] += 1
                    still_steep = float(gt @ stp) < wolfe_c2 * pred
                    if not still_steep:
                        diag["wolfe_satisfied"] += 1
                    if trials == 1 and sn >= 0.99 * delta and still_steep:
                        delta = min(trust_radius_max, delta * trust_grow)
                    elif trials > 1:
                        delta = max(trust_radius_min, min(delta, 2.0 * sn))
                    diag["accepted_steps"] += 1
                    x, f, g, feas = xt, ft, gt, feast
                    fail_streak = 0
                    if f < ep_best - improve_rtol * max(1.0, abs(ep_best)):
                        ep_best = f
                        since = 0
                    infeas_streak = 0 if feas else infeas_streak + 1
                    if infeas_streak > max_infeasible_streak and inc["x"] is not None:
                        diag["feasibility_recoveries"] += 1
                        return "recover"
                else:
                    diag["ls_failures"] += 1
                    fail_streak += 1
                    S.clear()
                    Y.clear()
                    delta = max(trust_radius_min, delta * trust_shrink * trust_shrink)
                    if delta <= trust_radius_min and fail_streak >= 2:
                        diag["end_trust_collapse"] += 1
                        return "trust"

        # ---------------- portfolio of episodes ----------------
        try:
            if screen_enabled:
                order = None
                try:
                    order = _screen(starts)
                except _BudgetStop:
                    raise
                except Exception as exc:  # optional phase; fall back to plain order
                    diag["screen_error"] = "call: " + repr(exc)[:300]
                if order is None:
                    order = list(range(starts.shape[0]))
                queue = [starts[i] for i in order]
            else:
                queue = [starts[i] for i in range(starts.shape[0])]

            mode, x_start = "fresh", queue.pop(0)
            sigma = float(kick_sigma)
            restart_count = 0
            while True:
                inc_before = inc["f"]
                if mode == "recover":
                    if inc["g"] is not None:
                        status = run_episode(inc["x"], inc["f"], inc["g"], True)
                    else:
                        status = run_episode(inc["x"])
                else:
                    status = run_episode(x_start)
                diag["episodes"] += 1
                improved = inc["f"] < inc_before
                if mode == "kick":
                    sigma = float(kick_sigma) if improved else min(kick_sigma_max,
                                                                  sigma * kick_growth)
                if status == "recover" and inc["x"] is not None:
                    mode = "recover"
                    diag["restarts_recover"] += 1
                    continue
                restart_count += 1
                anchor = inc if inc["x"] is not None else best_any
                late = float(obj.budget_left_fraction) <= polish_fraction
                if anchor["x"] is not None and (late or restart_count % fresh_every != 0):
                    mode, x_start = "kick", _kick(anchor["x"], sigma)
                    diag["restarts_kick"] += 1
                else:
                    mode = "fresh"
                    x_start = queue.pop(0) if queue else _draw_one()
                    diag["restarts_fresh"] += 1
        except _BudgetStop:
            diag["stopped_predictively"] = not obj.budget_exceeded
        finally:
            diag["best_feasible_internal"] = inc["f"] if math.isfinite(inc["f"]) else None
            self.last_run_diagnostics = diag
        return None
