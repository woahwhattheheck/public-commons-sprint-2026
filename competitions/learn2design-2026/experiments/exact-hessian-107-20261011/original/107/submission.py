"""tjlabs_exact_hessian_tr104 -- budget-aware exact-Hessian trust-region optimizer (ROOT104).

STATUS: not executed, not tested on physics, not submitted. No score, speed, feasibility
rate or H100 runtime is claimed. Every numeric default is a NEW design tunable, not a
measured result and not an official fact.

SOURCE FENCE
- Current official source: Learn2Design-2026 main 1dc4d6e7d0ff656555f48bcf3c22a4d284779386.
  It is known here only through outputs/paper-research-20261011/l2d-second-order-brief.md.
- API wording was read verbatim from the HISTORICAL 84a4b0a4 packet:
  docs/dfbench/Objective-API-Reference.md, docs/submission.md, docs/dfbench_overview.md.
- Re-check against 1dc4d6e before any upload.

COMPLEMENTS 099 (clipped-Adam portfolio) and 101 (host L-BFGS); neither uses exact Hessians.

METHOD (single point; every trial is exactly one logged Objective call)
- Search space: unbounded sigmoid mode via prepare(unbounded=True), as in 099/101.
  Coordinates are clipped to +-coord_clip.
- Hessian model: objective.value_grad_and_hessian(z) -> (loss, grad[n], H[n,n]).
  The shape is checked, then finiteness. H is symmetrised, decomposed with host
  float64 eigh, and negative curvature is detected from lam_min.
- Step: exact trust-region subproblem min g.p + 0.5 p.(H+mu I).p, |p| <= Delta.
  It is solved in the eigenbasis (More-Sorensen secular equation, safeguarded
  Newton/bisection, explicit hard case). There is never an unregularised inversion.
  mu is Levenberg damping: raised after rejected exact-model steps, decayed after
  accepted ones.
- Acceptance: rho = actual / predicted decrease of the TOTAL logged loss, using the
  undamped model. The radius adapts with rho. Accepting a step is separate from
  ranking feasible anchors.
- Cheap logged gradient steps: between Hessians, trial points use value_and_grad_aux
  with the cached eigenbasis (lagged-Hessian model).
  - Lag = cheap_step_fraction * measured c_H / c_G.
  - A rejected stale-model step forces a Hessian refresh at the center.
  - A trial is evaluated with the Hessian call itself only if c_H*(1-a) <= c_G,
    where a is the measured exact-model acceptance rate.
- Budget: a predictive check runs before every call, from measured durations per call
  kind (max of EWMA and recent max).
  - If the next Hessian does not fit, it falls back to gradient-only steps.
  - If a gradient call does not fit, it stops.
  - The Hessian is disabled permanently on: a raised call (e.g. OOM), wrong shape,
    repeated non-finite results, or one call exceeding hessian_max_call_fraction*max_time.
  - The Objective budget is never reset, extended or substituted. The Objective itself
    enforces the budget after each call.

FEASIBILITY
- No value+grad+Hessian+aux method is documented, and none is invented here.
- After a Hessian call, the label comes only from the public is_feasible_history, and
  only if its length equals this run's admitted single-point call count. Otherwise the
  label is UNKNOWN and is never treated as feasible.
- Gradient calls use value_and_grad_aux's returned aux["is_feasible"].
- An UNKNOWN anchor that would outrank the best known-feasible one is confirmed by ONE
  logged value_and_grad_aux call, which counts against the budget.
- The provider's logged history, not this bookkeeping, determines the score.

LIFECYCLE
- Before start_logging() the code uses only: prepare, n_params, power_thresholds,
  random_params_unbounded, and the documented warmups.
- The warmups are warmup_value_and_grad_aux / warmup_value_and_grad and
  warmup_value_grad_and_hessian. Their wall time is recorded as CONTAINER time, not
  Objective time.
- start_logging() is called once. If it raises RuntimeError (already started), the run
  continues without reset().
- Not used: value_function*, log_evaluation, set_penalty_fn, private attributes,
  batched Hessians, and unlogged evaluations.
"""
from __future__ import annotations

import math
import time
from collections import deque

import numpy as np
import jax.numpy as jnp

from dfbench import Objective, OptimizationAlgorithm

try:  # documented in docs/dfbench/Implementing-a-New-Algorithm.md; not required by contract
    from dfbench.core.algorithm import AlgorithmType as _AlgorithmType
except Exception:
    _AlgorithmType = None

FEASIBLE, INFEASIBLE, UNKNOWN = "feasible", "infeasible", "unknown"


class _BudgetStop(Exception):
    """Internal control flow: make no further Objective call."""


# ----------------------------------------------------------------------------- numerics
def feasibility_label(value):
    if value is None:
        return UNKNOWN
    try:
        return FEASIBLE if bool(np.asarray(value).reshape(-1)[0]) else INFEASIBLE
    except Exception:
        return UNKNOWN


def prepare_hessian(H, n):
    """(S, info) with S symmetric float64 (n,n), or (None, info[reason])."""
    try:
        A = np.asarray(H, dtype=np.float64)
    except Exception as exc:
        return None, {"reason": "convert", "detail": repr(exc)[:200]}
    if A.shape != (n, n):
        return None, {"reason": "shape", "shape": tuple(int(s) for s in A.shape)}
    fin = np.isfinite(A)
    if not fin.all():
        return None, {"reason": "nonfinite", "count": int(A.size - int(fin.sum()))}
    S = 0.5 * (A + A.T)
    scale = float(np.max(np.abs(S))) if n else 0.0
    asym = float(np.max(np.abs(A - A.T))) if n else 0.0
    return S, {"reason": "ok", "scale": scale, "asym_rel": asym / scale if scale > 0 else 0.0}


def spectral_model(S):
    """(lam ascending, V, scale=max|lam|) or None."""
    try:
        lam, V = np.linalg.eigh(S)
    except (np.linalg.LinAlgError, ValueError):
        return None
    if not (np.all(np.isfinite(lam)) and np.all(np.isfinite(V))):
        return None
    scale = max(float(np.max(np.abs(lam))), 1e-12) if lam.size else 1.0
    return lam, V, scale


def solve_trust_region(lam, V, g, delta, mu=0.0, hard_tol=1e-8, rtol=1e-6, max_iter=100):
    """min g.p + .5 p.(H+mu I).p s.t. |p|<=delta, H = V diag(lam) V^T (V=None: identity)."""
    lam = np.asarray(lam, dtype=np.float64).reshape(-1)
    g = np.asarray(g, dtype=np.float64).reshape(-1)
    n = g.size
    lam_min = float(lam.min()) if n else 0.0
    info = {"sigma": 0.0, "boundary": False, "hard_case": False,
            "lam_min": lam_min, "converged": True, "iters": 0}
    if n == 0 or not (math.isfinite(delta) and delta > 0.0):
        return np.zeros(n), info
    gt = g if V is None else V.T @ g

    def back(q):
        return q if V is None else V @ q

    smax = max(float(np.max(np.abs(lam))), 1e-300)
    tiny = 1e-12 * smax
    mu = max(0.0, float(mu))
    gnorm = float(np.linalg.norm(gt))
    s, it, converged = 0.0, 0, False
    with np.errstate(divide="ignore", invalid="ignore", over="ignore"):
        if lam_min + mu > tiny:  # 1) interior damped Newton step
            q = -gt / (lam + mu)
            if float(np.linalg.norm(q)) <= delta:
                info["sigma"] = mu
                return back(q), info
        else:  # 2) hard case: g ~ orthogonal to lowest eigenspace
            idx = lam <= lam_min + 1e-9 * smax
            if gnorm == 0.0 or float(np.linalg.norm(gt[idx])) <= hard_tol * gnorm:
                q = np.zeros(n)
                rest = ~idx
                q[rest] = -gt[rest] / (lam[rest] - lam_min)
                qn = float(np.linalg.norm(q))
                if math.isfinite(qn) and qn <= delta:
                    j = int(np.flatnonzero(idx)[0])
                    tau = math.sqrt(max(0.0, delta * delta - qn * qn))
                    q[j] += -tau if gt[j] > 0.0 else tau
                    info.update(sigma=-lam_min, boundary=True, hard_case=True)
                    return back(q), info
        # 3) boundary: sigma > lo with |p(sigma)| = delta
        lo = max(mu, -lam_min)
        hi = max(lo, gnorm / delta - lam_min)
        k = 0
        while not (float(np.linalg.norm(gt / (lam + hi))) <= delta) and k < 200:
            hi = lo + 2.0 * (hi - lo) + tiny + 1e-300
            k += 1
        lo_b, s = lo, hi
        for it in range(1, max_iter + 1):
            d = lam + s
            nw = float(np.linalg.norm(gt / d))
            if not math.isfinite(nw) or nw == 0.0:
                break
            if abs(nw - delta) <= rtol * delta:
                converged = True
                break
            if nw > delta:
                lo_b = s
            else:
                hi = s
            phi = 1.0 / nw - 1.0 / delta
            dphi = float(np.sum(gt * gt / (d * d * d))) / nw ** 3
            s_new = s - phi / dphi if (math.isfinite(dphi) and dphi > 0) else float("nan")
            if not (math.isfinite(s_new) and lo_b < s_new < hi):
                s_new = 0.5 * (lo_b + hi)
            if hi - lo_b <= 1e-15 * max(1.0, abs(hi)):
                break
            s = s_new
        if not converged:
            s = hi
        q = -gt / (lam + s)
        nq = float(np.linalg.norm(q))
        if math.isfinite(nq) and nq > delta:
            q = q * (delta / nq)
        if not np.all(np.isfinite(q)):
            q = -gt * (delta / gnorm) if gnorm > 0 else np.zeros(n)
            info["fallback"] = "steepest"
    info.update(sigma=float(s), boundary=True, converged=converged, iters=it)
    return back(q), info


def model_decrease(lam, V, g, s):
    """pred = -(g.s + .5 s.H.s), undamped model."""
    s = np.asarray(s, dtype=np.float64).reshape(-1)
    g = np.asarray(g, dtype=np.float64).reshape(-1)
    st = s if V is None else V.T @ s
    return -(float(g @ s) + 0.5 * float(np.sum(np.asarray(lam, np.float64) * st * st)))


def trust_ratio(f, f_new, pred):
    if not (math.isfinite(f) and math.isfinite(f_new) and math.isfinite(pred)) or pred <= 0.0:
        return -math.inf
    return (f - f_new) / pred


def accept_trial(rho, eta):
    return math.isfinite(rho) and rho >= eta


class CostModel:
    """Measured per-kind cost. H = Hessian call + host eigh; G = gradient call."""

    def __init__(self, window=8, alpha=0.3):
        self.alpha = alpha
        self.d = {"H": deque(maxlen=window), "G": deque(maxlen=window)}
        self.ewma = {"H": None, "G": None}
        self.prior = {"H": None, "G": None}

    def record(self, kind, dt):
        if not (math.isfinite(dt) and dt >= 0.0):
            return
        self.d[kind].append(dt)
        e = self.ewma[kind]
        self.ewma[kind] = dt if e is None else (1 - self.alpha) * e + self.alpha * dt

    def measured(self, kind):
        return len(self.d[kind]) > 0

    def predict(self, kind):
        if self.d[kind]:
            return max(self.ewma[kind], max(self.d[kind]))
        return self.prior[kind]


class AnchorBook:
    """Best point per label; UNKNOWN is never promoted to FEASIBLE."""

    def __init__(self):
        self._b = {FEASIBLE: None, UNKNOWN: None, INFEASIBLE: None}

    def note(self, x, f, label):
        if label in self._b and math.isfinite(f):
            cur = self._b[label]
            if cur is None or f < cur[0]:
                self._b[label] = (float(f), np.array(x, dtype=np.float64, copy=True))

    def best(self, label):
        return self._b.get(label)

    def best_value(self, label):
        b = self._b.get(label)
        return b[0] if b is not None else math.inf

    def clear(self, label):
        self._b[label] = None


def _device_str(a):
    try:
        return str(sorted(str(d) for d in a.devices()))
    except Exception:
        try:
            return str(a.device)
        except Exception:
            return type(a).__name__


# ----------------------------------------------------------------------------- algorithm
class ExactHessianTR104(OptimizationAlgorithm):
    algorithm_str = "tjlabs_exact_hessian_tr104"
    if _AlgorithmType is not None:
        algorithm_type = _AlgorithmType.GRADIENT_BASED

    def __init__(self):
        self.last_run_diagnostics = {}
        self._clock = time.perf_counter  # injectable for internal contract cases only

    def optimize(
        self,
        objective: Objective,
        init_params=None,
        random_seed: int | None = None,
        use_hessian: bool = True,
        trust_radius_init: float = 0.5,
        trust_radius_min: float = 1e-4,
        trust_radius_max: float = 4.0,
        eta_accept: float = 0.01,
        eta_shrink: float = 0.25,
        eta_grow: float = 0.75,
        trust_shrink: float = 0.35,
        trust_grow: float = 2.0,
        damping_init: float = 0.0,
        damping_floor: float = 1e-6,
        damping_max: float = 1.0,
        damping_up: float = 4.0,
        damping_down: float = 0.5,
        neg_curv_tol: float = 1e-8,
        grad_tol: float = 1e-9,
        coord_clip: float = 15.0,
        cheap_step_fraction: float = 0.5,
        max_cheap_steps: int = 50,
        default_lag: int = 1,
        acceptance_prior: float = 0.5,
        acceptance_smoothing: float = 0.2,
        hessian_max_call_fraction: float = 0.05,
        max_nonfinite_hessian: int = 3,
        use_warmup_prior: bool = True,
        first_hessian_min_left_s: float = 0.0,
        restart_pool: int = 4,
        patience_time_fraction: float = 0.03,
        patience_min_calls: int = 12,
        patience_max_calls: int = 2000,
        improve_rtol: float = 1e-6,
        max_infeasible_accepts: int = 30,
        kick_sigma: float = 0.5,
        kick_fraction: float = 0.3,
        kick_growth: float = 1.5,
        kick_sigma_max: float = 3.0,
        fresh_every: int = 3,
        polish_fraction: float = 0.1,
        polish_sigma_scale: float = 0.3,
        confirm_unknown_anchor: bool = True,
        stop_margin: float = 1.15,
        return_reserve_s: float = 0.05,
        duration_window: int = 8,
        max_calls: int | None = None,
        fallback_time_cap_s: float = 4.0 * 3600.0,
        trace_limit: int = 200000,
        **kwargs,
    ) -> None:
        obj = objective
        clock = self._clock

        def _req(c, m):
            if not c:
                raise ValueError(m)

        _req(0 < trust_radius_min <= trust_radius_init <= trust_radius_max, "invalid trust radii")
        _req(0 < eta_accept <= eta_shrink < eta_grow < 1, "invalid eta thresholds")
        _req(0 < trust_shrink < 1 < trust_grow, "invalid trust factors")
        _req(0 <= damping_init <= damping_max and 0 < damping_floor <= damping_max, "invalid damping")
        _req(damping_up > 1 and 0 < damping_down < 1, "invalid damping factors")
        _req(neg_curv_tol >= 0 and grad_tol >= 0 and coord_clip > 0, "invalid tolerances")
        _req(cheap_step_fraction >= 0 and type(max_cheap_steps) is int and max_cheap_steps >= 0
             and type(default_lag) is int and default_lag >= 0, "invalid lag settings")
        _req(0 <= acceptance_prior <= 1 and 0 < acceptance_smoothing <= 1, "invalid acceptance EWMA")
        _req(0 < hessian_max_call_fraction <= 1, "invalid hessian_max_call_fraction")
        _req(type(max_nonfinite_hessian) is int and max_nonfinite_hessian >= 1, "invalid max_nonfinite_hessian")
        _req(first_hessian_min_left_s >= 0, "invalid first_hessian_min_left_s")
        _req(type(restart_pool) is int and 1 <= restart_pool <= 64, "invalid restart_pool")
        _req(0 < patience_time_fraction <= 1, "invalid patience_time_fraction")
        _req(type(patience_min_calls) is int and type(patience_max_calls) is int
             and 1 <= patience_min_calls <= patience_max_calls, "invalid patience calls")
        _req(improve_rtol >= 0 and type(max_infeasible_accepts) is int and max_infeasible_accepts >= 1,
             "invalid improve/infeasible settings")
        _req(kick_sigma > 0 and 0 < kick_fraction <= 1 and kick_growth >= 1 and kick_sigma_max >= kick_sigma,
             "invalid kick settings")
        _req(type(fresh_every) is int and fresh_every >= 1, "invalid fresh_every")
        _req(0 <= polish_fraction < 1 and 0 < polish_sigma_scale <= 1, "invalid polish settings")
        _req(math.isfinite(stop_margin) and 1 <= stop_margin <= 3
             and math.isfinite(return_reserve_s) and 0 <= return_reserve_s <= 5, "invalid stop safeguard")
        _req(type(duration_window) is int and 1 <= duration_window <= 64, "invalid duration_window")
        _req(max_calls is None or (type(max_calls) is int and max_calls >= 1), "invalid max_calls")
        _req(math.isfinite(fallback_time_cap_s) and fallback_time_cap_s > 0, "invalid fallback_time_cap_s")
        _req(type(trace_limit) is int and trace_limit >= 0, "invalid trace_limit")

        # ---------------- pre-logging: documented context only ----------------
        seed, _ = self.prepare(obj, unbounded=True, random_seed=random_seed)
        rng = np.random.default_rng(0 if seed is None else int(seed) % (2 ** 32))
        n = int(obj.n_params)
        use_aux = obj.power_thresholds is not None
        raw = obj.random_params_unbounded(n_samples=restart_pool)
        dtype = np.asarray(raw).dtype
        if not np.issubdtype(dtype, np.floating):
            dtype = np.dtype(np.float32)
        starts = np.clip(np.asarray(raw, np.float64).reshape(restart_pool, n), -coord_clip, coord_clip)
        if init_params is not None:  # treated as unbounded-space, as in 099/101
            starts[0] = np.clip(np.asarray(init_params, np.float64).reshape(n), -coord_clip, coord_clip)

        cost = CostModel(duration_window)
        book = AnchorBook()
        trace = []
        zeros_n = np.zeros(n)
        diag = {
            "algorithm_str": self.algorithm_str, "uses_aux": use_aux, "n_params": n,
            "calls": 0, "calls_H": 0, "calls_G": 0, "calls_H_failed": 0, "roles": {},
            "accepted": 0, "accepted_exact": 0, "accepted_stale": 0, "accepted_gradient_model": 0,
            "rejected": 0, "stale_rejections": 0, "nonfinite_trial": 0, "nonfinite_eval": 0,
            "no_model_decrease": 0, "h_trials": 0, "g_trials": 0, "center_refreshes": 0, "confirms": 0,
            "hessians_indefinite": 0, "neg_curv_steps": 0, "hard_case_steps": 0,
            "boundary_steps": 0, "interior_steps": 0, "nonfinite_hessian": 0, "asym_rel_max": 0.0,
            "host_solve_s": 0.0, "episodes": 0, "episode_status": {},
            "end_patience": 0, "end_stationary": 0, "end_trust_collapse": 0, "end_infeasible_drift": 0,
            "restarts_kick": 0, "restarts_fresh": 0,
            "hessian_disabled_reason": None if use_hessian else "disabled_by_option",
            "hessian_disabled_elapsed": None, "hessian_fallback_elapsed": None,
            "feasibility_history_available": None, "history_misaligned": False,
            "dtype_H": None, "device_H": None, "dtype_G": None, "device_G": None,
            "warmup_grad_container_s": None, "warmup_hessian_container_s": None,
            "warmup_grad_error": None, "warmup_hessian_error": None,
            "start_logging_called": False, "start_logging_error": None,
            "stopped_predictively": False, "stop_reason": None,
            "kwargs_ignored": sorted(kwargs.keys()), "trace": trace, "trace_truncated": False,
            "trace_fields": ("role", "kind", "t_elapsed_start", "dt_s", "loss", "label", "admitted"),
            "note": "internal bookkeeping only; provider history determines the score",
        }
        self.last_run_diagnostics = diag
        hess = {"enabled": bool(use_hessian)}

        # Objective-provided warmups: container time, not Objective clock.
        t0 = clock()
        try:
            if use_aux:
                obj.warmup_value_and_grad_aux()
            else:
                obj.warmup_value_and_grad()
        except Exception as exc:
            diag["warmup_grad_error"] = repr(exc)[:300]
        diag["warmup_grad_container_s"] = clock() - t0
        if hess["enabled"]:
            t0 = clock()
            try:
                obj.warmup_value_grad_and_hessian()
                w = clock() - t0
                diag["warmup_hessian_container_s"] = w
                if use_warmup_prior:
                    cost.prior["H"] = 0.5 * w  # includes compile: conservative prior until measured
            except Exception as exc:
                hess["enabled"] = False
                diag["hessian_disabled_reason"] = "warmup_error"
                diag["warmup_hessian_error"] = repr(exc)[:300]

        try:
            obj.start_logging()
            diag["start_logging_called"] = True
        except RuntimeError as exc:  # already started by runner: never reset
            diag["start_logging_error"] = repr(exc)[:300]

        st = {"calls": 0, "admitted": 0, "hist_aligned": True, "center_hess_failed": False,
              "acc_exact": float(acceptance_prior), "confirm_off": False}

        # ---------------- budget / timing ----------------
        def _elapsed():
            try:
                return float(obj.time_elapsed)
            except Exception:
                return float("nan")

        def remaining():
            tl = obj.time_left
            if tl is None:  # no Objective time budget configured: own cap, not a replacement
                return fallback_time_cap_s - _elapsed()
            return float(tl)

        def affordable(kind):
            if obj.budget_exceeded:
                diag["stop_reason"] = "budget_exceeded"
                return False
            if max_calls is not None and st["calls"] >= max_calls:
                diag["stop_reason"] = "max_calls"
                return False
            el = obj.evals_left
            if el is not None and el < 1:
                diag["stop_reason"] = "evals_left"
                return False
            tl = remaining()
            if not math.isfinite(tl):
                return True
            pred = cost.predict(kind)
            if pred is None:
                other = "G" if kind == "H" else "H"
                if kind == "H":
                    return tl >= first_hessian_min_left_s + return_reserve_s
                if cost.measured(other):
                    pred = cost.predict(other)  # conservative proxy
                else:
                    return True  # very first call: a run needs a logged entry
            if tl < stop_margin * pred + return_reserve_s:
                if kind == "G":
                    diag["stop_reason"] = "predicted_overrun"
                return False
            return True

        def hess_usable():
            if not hess["enabled"]:
                return False
            if affordable("H"):
                return True
            if diag["hessian_fallback_elapsed"] is None:
                diag["hessian_fallback_elapsed"] = _elapsed()
            return False

        def _disable(reason):
            if hess["enabled"]:
                hess["enabled"] = False
                diag["hessian_disabled_reason"] = reason
                diag["hessian_disabled_elapsed"] = _elapsed()

        def lag_target():
            if cost.measured("H") and cost.measured("G"):
                r = cost.predict("H") / max(cost.predict("G"), 1e-9)
                return int(min(max_cheap_steps, max(0, math.floor(cheap_step_fraction * r))))
            return default_lag

        def use_h_trial():
            if not (cost.measured("H") and cost.measured("G")):
                return False
            return cost.predict("H") * (1.0 - st["acc_exact"]) <= cost.predict("G")

        def budget_left():
            try:
                return float(obj.budget_left_fraction)
            except Exception:
                return 1.0

        # ---------------- logged calls ----------------
        def _meta(kind, arr):
            if diag["dtype_" + kind] is None:
                diag["dtype_" + kind] = str(getattr(arr, "dtype", type(arr).__name__))
                diag["device_" + kind] = _device_str(arr)

        def _after_call(kind, role, t_el, dt, f, label):
            cost.record(kind, dt)
            st["calls"] += 1
            diag["calls"] = st["calls"]
            diag["calls_" + kind] += 1
            diag["roles"][role] = diag["roles"].get(role, 0) + 1
            admitted = not bool(obj.budget_exceeded)
            if len(trace) < trace_limit:
                trace.append((role, kind, t_el, dt, f, label, admitted))
            else:
                diag["trace_truncated"] = True
            if not admitted:  # may not be logged: do not build on it
                diag["stop_reason"] = "budget_exceeded_after_call"
                raise _BudgetStop
            st["admitted"] += 1

        def feas_from_history():
            if not use_aux or not st["hist_aligned"]:
                return UNKNOWN
            try:
                h = obj.is_feasible_history
            except Exception:
                st["hist_aligned"] = False
                diag["history_misaligned"] = True
                return UNKNOWN
            L = len(h)
            if L == 0:
                diag["feasibility_history_available"] = False
                return UNKNOWN
            if L != st["admitted"] + 1:
                st["hist_aligned"] = False
                diag["history_misaligned"] = True
                return UNKNOWN
            diag["feasibility_history_available"] = True
            return feasibility_label(h[-1])

        def call_G(x, role):
            if not affordable("G"):
                raise _BudgetStop
            p = jnp.asarray(np.asarray(x, dtype=dtype))
            t_el, t0 = _elapsed(), clock()
            if use_aux:
                loss, grad, aux = obj.value_and_grad_aux(p)
                try:
                    label = feasibility_label(aux["is_feasible"])
                except Exception:
                    label = UNKNOWN
            else:
                loss, grad = obj.value_and_grad(p)
                label = UNKNOWN
            f = float(loss)
            g = np.asarray(grad, dtype=np.float64).reshape(-1)
            dt = clock() - t0
            _meta("G", grad)
            _after_call("G", role, t_el, dt, f, label)
            ok = math.isfinite(f) and g.size == n and bool(np.all(np.isfinite(g)))
            if ok:
                book.note(x, f, label)
            else:
                diag["nonfinite_eval"] += 1
            return f, g, label, ok

        def call_H(x, role):
            if not hess_usable():
                return None
            p = jnp.asarray(np.asarray(x, dtype=dtype))
            t_el, t0 = _elapsed(), clock()
            try:
                loss, grad, H = obj.value_grad_and_hessian(p)
            except Exception as exc:
                st["hist_aligned"] = False  # unknown whether anything was logged
                st["calls"] += 1
                diag["calls_H_failed"] += 1
                _disable("exception: " + repr(exc)[:200])
                if obj.budget_exceeded:
                    raise _BudgetStop
                return None
            f = float(loss)
            g = np.asarray(grad, dtype=np.float64).reshape(-1)
            label = feas_from_history()
            th = clock()
            S_, hinfo = prepare_hessian(H, n)
            model = None
            if S_ is not None:
                model = spectral_model(S_)
                if model is None:
                    hinfo = {"reason": "eigh_failed"}
            t1 = clock()
            diag["host_solve_s"] += t1 - th
            _meta("H", H)
            reason = hinfo["reason"]
            if reason == "ok" and model is not None:
                diag["asym_rel_max"] = max(diag["asym_rel_max"], hinfo["asym_rel"])
                if model[0][0] < -neg_curv_tol * model[2]:
                    diag["hessians_indefinite"] += 1
            elif reason in ("shape", "convert"):
                _disable(reason)
            else:
                diag["nonfinite_hessian"] += 1
                if diag["nonfinite_hessian"] >= max_nonfinite_hessian:
                    _disable("nonfinite")
            _after_call("H", role, t_el, t1 - t0, f, label)
            mt = obj.max_time
            if hess["enabled"] and mt is not None and cost.predict("H") > hessian_max_call_fraction * float(mt):
                _disable("too_slow")
            ok = math.isfinite(f) and g.size == n and bool(np.all(np.isfinite(g)))
            if ok:
                book.note(x, f, label)
            else:
                diag["nonfinite_eval"] += 1
            return {"f": f, "g": g, "label": label, "ok": ok, "model": model if ok else None}

        # ---------------- restarts ----------------
        def draw_one():
            return np.clip(np.asarray(obj.random_params_unbounded(), np.float64).reshape(n),
                           -coord_clip, coord_clip)

        def kick(anchor_x, sigma):
            x0 = np.array(anchor_x, dtype=np.float64)
            mask = rng.random(n) < kick_fraction
            if not mask.any():
                mask[int(rng.integers(n))] = True
            x0[mask] += sigma * rng.standard_normal(int(mask.sum()))
            return np.clip(x0, -coord_clip, coord_clip)

        def restart_anchor():
            fb, ub = book.best(FEASIBLE), book.best(UNKNOWN)
            if (confirm_unknown_anchor and use_aux and not st["confirm_off"] and ub is not None
                    and (fb is None or ub[0] < fb[0])):
                book.clear(UNKNOWN)
                _, _, lab, _ = call_G(ub[1], "confirm")  # one logged aux call
                diag["confirms"] += 1
                if lab == UNKNOWN:
                    st["confirm_off"] = True
                fb, ub = book.best(FEASIBLE), book.best(UNKNOWN)
            for b in (fb, ub, book.best(INFEASIBLE)):
                if b is not None:
                    return b[1]
            return None

        def stalled(ep):
            k = st["calls"] - ep["calls"]
            if k < patience_min_calls:
                return False
            if k >= patience_max_calls:
                return True
            mt = obj.max_time
            if mt is None:
                return False
            return (_elapsed() - ep["t"]) >= patience_time_fraction * float(mt)

        # ---------------- one trust-region episode ----------------
        def run_episode(x0):
            x = np.clip(np.asarray(x0, np.float64).reshape(n), -coord_clip, coord_clip)
            st["center_hess_failed"] = False
            model, age = None, 0
            res = call_H(x, "init") if hess["enabled"] else None
            if res is not None:
                if not res["ok"]:
                    return "nonfinite_start"
                f, g, label, model = res["f"], res["g"], res["label"], res["model"]
                if model is None:
                    st["center_hess_failed"] = True
            else:
                f, g, label, ok = call_G(x, "init")
                if not ok:
                    return "nonfinite_start"
            ep = {"best": f, "calls": st["calls"], "t": _elapsed()}
            delta, damp = float(trust_radius_init), float(damping_init)
            force_refresh, fail_streak = False, 0
            infeas_run = 1 if label == INFEASIBLE else 0
            while True:
                if stalled(ep):
                    diag["end_patience"] += 1
                    return "patience"
                plan_h_trial = False
                if (hess["enabled"] and not st["center_hess_failed"]
                        and (model is None or age >= lag_target() or force_refresh)):
                    if model is not None and use_h_trial() and hess_usable():
                        plan_h_trial = True
                    elif hess_usable():
                        diag["center_refreshes"] += 1
                        res = call_H(x, "center_refresh")
                        if res is not None and res["ok"]:
                            f, g, label = res["f"], res["g"], res["label"]
                            if res["model"] is not None:
                                model, age = res["model"], 0
                            else:
                                st["center_hess_failed"] = True
                        else:
                            st["center_hess_failed"] = True
                    force_refresh = False
                if model is not None:
                    lam, V, scale = model
                    mu = damp * scale
                else:
                    lam, V, scale, mu = zeros_n, None, 1.0, 0.0
                gnorm = float(np.linalg.norm(g))
                neg = model is not None and lam[0] < -neg_curv_tol * scale
                if gnorm <= grad_tol and not neg:
                    diag["end_stationary"] += 1
                    return "stationary"
                th = clock()
                p, info = solve_trust_region(lam, V, g, delta, mu)
                xt = np.clip(x + p, -coord_clip, coord_clip)
                s = xt - x
                pred = model_decrease(lam, V, g, s)
                diag["host_solve_s"] += clock() - th
                diag["boundary_steps" if info["boundary"] else "interior_steps"] += 1
                if info["hard_case"]:
                    diag["hard_case_steps"] += 1
                if neg:
                    diag["neg_curv_steps"] += 1
                sn = float(np.linalg.norm(s))
                if not (math.isfinite(pred) and pred > 0.0) or sn == 0.0:
                    diag["no_model_decrease"] += 1
                    if model is not None and age > 0 and hess["enabled"] and not st["center_hess_failed"]:
                        force_refresh = True
                    delta *= trust_shrink
                    if delta < trust_radius_min:
                        diag["end_trust_collapse"] += 1
                        return "trust_collapse"
                    continue
                trial_res = call_H(xt, "h_trial") if plan_h_trial else None
                if trial_res is not None:
                    diag["h_trials"] += 1
                    ft, gt, labt, okt = trial_res["f"], trial_res["g"], trial_res["label"], trial_res["ok"]
                else:
                    diag["g_trials"] += 1
                    ft, gt, labt, okt = call_G(xt, "g_trial")
                rho = trust_ratio(f, ft, pred) if okt else -math.inf
                exact = model is not None and age == 0
                accepted = okt and accept_trial(rho, eta_accept)
                if exact:
                    a = acceptance_smoothing
                    st["acc_exact"] = (1 - a) * st["acc_exact"] + a * (1.0 if accepted else 0.0)
                if accepted:
                    diag["accepted"] += 1
                    diag["accepted_exact" if exact else
                         ("accepted_stale" if model is not None else "accepted_gradient_model")] += 1
                    if rho >= eta_grow and sn >= 0.9 * delta:
                        delta = min(trust_radius_max, delta * trust_grow)
                    elif rho < eta_shrink:
                        delta = max(trust_radius_min, delta * trust_shrink)
                    damp *= damping_down
                    if damp < damping_floor:
                        damp = 0.0
                    x, f, g, label = xt, ft, gt, labt
                    st["center_hess_failed"] = False
                    if trial_res is not None and trial_res["model"] is not None:
                        model, age = trial_res["model"], 0
                    else:
                        if trial_res is not None:
                            st["center_hess_failed"] = True
                        if model is not None:
                            age += 1
                    force_refresh, fail_streak = False, 0
                    if f < ep["best"] - improve_rtol * max(1.0, abs(ep["best"])):
                        ep.update(best=f, calls=st["calls"], t=_elapsed())
                    infeas_run = infeas_run + 1 if label == INFEASIBLE else 0
                    if infeas_run > max_infeasible_accepts and book.best(FEASIBLE) is not None:
                        diag["end_infeasible_drift"] += 1
                        return "infeasible_drift"
                else:
                    diag["rejected"] += 1
                    fail_streak += 1
                    if not okt:
                        diag["nonfinite_trial"] += 1
                    stale = model is not None and age > 0
                    if stale and okt and not st["center_hess_failed"] and hess_usable():
                        force_refresh = True  # blame the stale model, keep the radius
                        diag["stale_rejections"] += 1
                    else:
                        delta *= trust_shrink
                        if exact:
                            damp = min(damping_max, max(damping_floor, damp * damping_up))
                        if delta < trust_radius_min and fail_streak >= 2:
                            diag["end_trust_collapse"] += 1
                            return "trust_collapse"

        # ---------------- portfolio loop ----------------
        try:
            queue = [starts[i] for i in range(starts.shape[0])]
            mode, x_start = "fresh", queue.pop(0)
            sigma, restart_count = float(kick_sigma), 0
            while True:
                before = book.best_value(FEASIBLE)
                status = run_episode(x_start)
                diag["episodes"] += 1
                diag["episode_status"][status] = diag["episode_status"].get(status, 0) + 1
                improved = book.best_value(FEASIBLE) < before
                if mode == "kick":
                    sigma = float(kick_sigma) if improved else min(kick_sigma_max, sigma * kick_growth)
                restart_count += 1
                anchor = restart_anchor()
                late = budget_left() <= polish_fraction
                if anchor is not None and (late or restart_count % fresh_every != 0):
                    mode = "kick"
                    x_start = kick(anchor, sigma * (polish_sigma_scale if late else 1.0))
                    diag["restarts_kick"] += 1
                else:
                    mode = "fresh"
                    x_start = queue.pop(0) if queue else draw_one()
                    diag["restarts_fresh"] += 1
        except _BudgetStop:
            diag["stopped_predictively"] = not bool(obj.budget_exceeded)
            if diag["stop_reason"] is None:
                diag["stop_reason"] = "predicted_overrun"
        finally:
            for lab, key in ((FEASIBLE, "best_feasible_internal"), (UNKNOWN, "best_unknown_internal"),
                             (INFEASIBLE, "best_infeasible_internal")):
                v = book.best_value(lab)
                diag[key] = v if math.isfinite(v) else None
            diag["acc_exact"] = st["acc_exact"]
            diag["pred_H_s"] = cost.predict("H")
            diag["pred_G_s"] = cost.predict("G")
            diag["hessian_enabled_at_end"] = hess["enabled"]
            self.last_run_diagnostics = diag
        return None
