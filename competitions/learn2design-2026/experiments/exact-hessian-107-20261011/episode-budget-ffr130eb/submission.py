# FILE: ffr130eb/submission.py
"""tjlabs_ffr130eb: FFR130 with budget-scaled episode scheduling (derivative).

Derivative of FFR130 submission.py
(sha256 48edc90b09dd2453163c71f893918fa6cbf66f164a0dd9cc705dd85081216b7b),
episode-budget corrective work for source job l2d-episode-budget-source-20261014.
Status: NOT executed, NOT physics-tested, NOT submitted. No score or gain is claimed.
Authored for TokenJunkieLabs/Bryce. Gradient-only, O(n) state.

Changes versus the parent (everything not listed is the parent's code):
  * Episode patience is recomputed before every call as
    clamp(ceil(frac * horizon), floor, configured_patience), where
    horizon = calls already spent in this episode + estimated remaining calls.
    The remaining-call estimate uses only public ``obj.time_left`` /
    ``obj.evals_left`` and the measured per-call cost. The configured
    restart/polish patience is an upper bound. It is used unchanged whenever no
    public estimate exists: fields None, missing, nonfinite or non-numeric, or
    no call measured yet. ``no_improve`` still resets on every improvement, so
    this rule never ends an episode that keeps improving within its patience.
  * The cost estimate is the median of recent call-start-to-call-start cycles,
    which includes algorithm overhead. It falls back to the median of measured
    call durations. The first logged call (cold/slow) is excluded once any
    later call is measured.
  * The trust shrink cadence inside an episode is max(5, min(25, patience // 3)).
    For any patience >= 75 (e.g. the configured fallback 220/120) this equals
    the parent's 25.
  * When fewer than ``min_explore_calls`` calls are estimated to remain, a
    scheduled exploration episode becomes an incumbent polish episode.
  * The incumbent is offered only calls that public ``obj.eval_count`` shows were
    admitted to the log. This enforces the parent's own "logged point" contract.
    If eval_count is unreadable, the parent's behaviour applies.
  * Diagnostics record each completed episode and the partial episode at stop.
Unchanged: the CallGuard stop predicate (fields are now read robustly), the
filter, restoration, bisection, excursion cap and dedupe; seeds; unbounded
mode; one public value_and_grad_aux call per evaluation; the returned None.
All new constants are UNCALIBRATED design constants.

Original FFR130 design notes:
  * Every evaluation is exactly one logged public ``obj.value_and_grad_aux`` call
    (or ``obj.value_and_grad`` when the problem exposes no penalty contract).
  * Before any feasible point exists (SEEK) it runs the 096-style clipped Adam +
    trust + decaying noise search on the full default penalized loss.
  * Once a logged ``aux['is_feasible']`` point exists (HOLD) it keeps a
    best-feasible incumbent that only a finite, logged, feasible point with a
    strictly lower loss can replace. Infeasible trials are admitted only if a small
    two-measure filter over the *returned* pair
    (penalty_sum = sum(aux['violations']), aux['sensitivity_loss']) does not
    dominate them and the current infeasible excursion is within an adaptive cap.
    A rejected trial is pulled back along the logged segment toward the incumbent
    (bisection); an over-cap excursion restores the incumbent with shrunk trust.
  * The excursion cap adapts to logged history: it tracks the lengths of
    infeasible excursions that ended in a feasible point on their own.
  * Patience-triggered portfolio: alternating exploration episodes (fresh public
    random start) and incumbent polish episodes. The incumbent is never discarded.
  * penalty_sum is the sum of active penalty outputs (default squashed ReLU), NOT
    raw physical power excess; is_feasible is the separate physical flag.
No Hessian/HVP/finite differences, batching, value_function, log_evaluation,
private Objective members, dependency additions, or penalty/bound changes.
"""
from __future__ import annotations

import math
import time
from collections import deque

import numpy as np

from dfbench import Objective, OptimizationAlgorithm

PARENT_SHA256 = "48edc90b09dd2453163c71f893918fa6cbf66f164a0dd9cc705dd85081216b7b"
EPISODE_LOG_MAX = 256


# --------------------------------------------------------------------------- helpers
def public_number(obj, name):
    """Read an optional public numeric field.

    Returns a finite float clamped to >= 0, or None if the attribute is missing,
    raises, is None, bool, str/bytes, non-numeric or nonfinite. Only public
    attribute names are passed here.
    """
    try:
        v = getattr(obj, name, None)
    except Exception:
        return None
    if v is None or isinstance(v, (bool, np.bool_, str, bytes)):
        return None
    try:
        f = float(v)
    except Exception:
        return None
    if not math.isfinite(f):
        return None
    return max(0.0, f)


class CallGuard:
    """Predictive stop using only public budget fields (evals_left, time_left).

    stop_reason() is the parent's predicate. Fields are read with public_number(),
    so a missing or nonfinite optional field means "unknown", exactly as None did.
    calls_left_estimate() is used only for scheduling, never for stopping.
    """

    def __init__(self, stop_margin=1.10, return_reserve_s=0.05, window=8):
        self.stop_margin = float(stop_margin)
        self.reserve = float(return_reserve_s)
        self.durations = deque(maxlen=int(window))
        self.ewma = None
        self.count = 0
        self.first = None
        self.steady = deque(maxlen=int(window))
        self.cycles = deque(maxlen=int(window))
        self.last_start = None

    def note_start(self, t0):
        """Record a call start; the cycle since the previous start excludes call 1."""
        t0 = float(t0)
        if self.last_start is not None and self.count >= 2:
            c = t0 - self.last_start
            if math.isfinite(c) and c > 0.0:
                self.cycles.append(c)
        self.last_start = t0

    def record(self, dt):
        dt = float(dt)
        if not math.isfinite(dt) or dt < 0.0:
            dt = 0.0
        self.durations.append(dt)
        self.ewma = dt if self.ewma is None else 0.7 * self.ewma + 0.3 * dt
        if self.count == 0:
            self.first = dt
        else:
            self.steady.append(dt)
        self.count += 1

    def cost_estimate(self):
        """Measured seconds per call (steady state), or None if not measurable."""
        src = self.cycles if self.cycles else self.steady
        if src:
            c = float(np.median(np.asarray(src, dtype=np.float64)))
        elif self.first is not None:
            c = float(self.first)
        else:
            return None
        return c if (math.isfinite(c) and c > 0.0) else None

    def calls_left_estimate(self, obj):
        """Estimated remaining calls from public fields only; None if unknown."""
        est = None
        tl = public_number(obj, "time_left")
        cost = self.cost_estimate()
        if tl is not None and cost is not None:
            est = max(0.0, (tl - self.reserve) / (self.stop_margin * cost))
        el = public_number(obj, "evals_left")
        if el is not None:
            est = el if est is None else min(est, el)
        return est

    def stop_reason(self, obj):
        if bool(obj.budget_exceeded):
            return "budget_exceeded"
        left = public_number(obj, "evals_left")
        if left is not None and left < 1:
            return "evals_left"
        if not self.durations:
            return None  # first call always allowed: a run needs one logged entry
        tl = public_number(obj, "time_left")
        if tl is None:
            return None
        pred = max(self.ewma, max(self.durations))
        if tl < self.stop_margin * pred + self.reserve:
            return "predicted_overrun"
        return None


class RecentPoints:
    """Exact-bytes ring of the last ``size`` evaluated vectors (anti-repeat)."""

    def __init__(self, size=32):
        self.q = deque(maxlen=int(size))
        self.s = {}

    @staticmethod
    def _key(x):
        return np.asarray(x, dtype=np.float64).tobytes()

    def seen(self, x):
        return self._key(x) in self.s

    def add(self, x):
        k = self._key(x)
        if len(self.q) == self.q.maxlen:
            old = self.q[0]
            c = self.s.get(old, 0) - 1
            if c <= 0:
                self.s.pop(old, None)
            else:
                self.s[old] = c
        self.q.append(k)
        self.s[k] = self.s.get(k, 0) + 1


class Adam:
    """clip_by_global_norm(1.0) + Adam(lr) in NumPy; O(n) state (m, v)."""

    def __init__(self, n, lr, b1=0.9, b2=0.999, eps=1e-8):
        self.lr, self.b1, self.b2, self.eps = float(lr), b1, b2, eps
        self.m = np.zeros(n)
        self.v = np.zeros(n)
        self.t = 0

    def step(self, g):
        gn = float(np.linalg.norm(g))
        if gn > 1.0:
            g = g / gn
        self.t += 1
        self.m = self.b1 * self.m + (1 - self.b1) * g
        self.v = self.b2 * self.v + (1 - self.b2) * g * g
        mh = self.m / (1 - self.b1 ** self.t)
        vh = self.v / (1 - self.b2 ** self.t)
        return -self.lr * mh / (np.sqrt(vh) + self.eps)


def parse_aux(aux):
    """Return (is_feasible, penalty_sum, sensitivity_loss) from a returned aux dict.

    Returns None if aux is absent/unknown/malformed/nonfinite. Callers must treat
    None as "not feasible, no filter information" (safe fallback). Values are read
    exactly as returned; nothing is recomputed or reconstructed.
    """
    if not isinstance(aux, dict):
        return None
    try:
        fa = np.asarray(aux["is_feasible"]).reshape(-1)
        if fa.size != 1 or fa.dtype.kind != "b":
            return None
        feas = bool(fa[0])
        h = float(np.sum(np.asarray(aux["violations"], dtype=np.float64)))
        s = float(np.asarray(aux["sensitivity_loss"], dtype=np.float64).reshape(-1)[0])
    except Exception:
        return None
    if not (math.isfinite(h) and math.isfinite(s)) or h < 0.0:
        return None
    return feas, h, s


class PairFilter:
    """Bounded nondominated list of logged (penalty_sum, sensitivity_loss) pairs.

    A pair is acceptable iff no stored entry dominates it within small margins
    (Fletcher-Leyffer filter concept; no convergence guarantee transfers to UIFO).
    """

    def __init__(self, size=16, gamma_h=1e-4, gamma_s=1e-4):
        self.size = int(size)
        self.gh = float(gamma_h)
        self.gs = float(gamma_s)
        self.entries = []

    def acceptable(self, h, s):
        for hj, sj in self.entries:
            if h >= hj - self.gh * max(hj, 1e-12) and s >= sj - self.gs * max(abs(sj), 1.0):
                return False
        return True

    def add(self, h, s):
        self.entries = [(hj, sj) for hj, sj in self.entries if not (h <= hj and s <= sj)]
        self.entries.append((float(h), float(s)))
        if len(self.entries) > self.size:
            self.entries.pop(0)

    def clear(self):
        self.entries = []


class Incumbent:
    """Best-feasible incumbent. Only finite, feasible, strictly-lower loss replaces."""

    def __init__(self):
        self.x = None
        self.f = math.inf
        self.call = None

    def offer(self, x, f, feasible, finite, call_index):
        if not (finite and feasible and isinstance(f, float) and math.isfinite(f)):
            return False
        if f < self.f:
            self.x = np.array(x, dtype=np.float64, copy=True)
            self.f = f
            self.call = call_index
            return True
        return False


class ExcursionCap:
    """Adaptive bound on consecutive infeasible calls while an incumbent exists.

    cap = clamp(ceil(mult * mean_natural_excursion), lo, hi), where natural
    excursions are infeasible runs (with an incumbent present) that ended in a
    logged feasible call without forced restoration. Prior = ``init``.
    All of init/mult/lo/hi are UNCALIBRATED design constants.
    """

    def __init__(self, init=4, mult=2.0, lo=2, hi=24, memory=16):
        self.init, self.mult, self.lo, self.hi = int(init), float(mult), int(lo), int(hi)
        self.hist = deque(maxlen=int(memory))

    def record_natural(self, length):
        if length > 0:
            self.hist.append(int(length))

    def value(self):
        if not self.hist:
            return max(self.lo, min(self.hi, self.init))
        m = sum(self.hist) / len(self.hist)
        return max(self.lo, min(self.hi, int(math.ceil(self.mult * m))))


class _Stop(Exception):
    pass


# --------------------------------------------------------------------------- optimizer
class FeasibleFilterRetention130EB(OptimizationAlgorithm):
    algorithm_str = "tjlabs_ffr130eb"
    clock = staticmethod(time.perf_counter)

    def __init__(self):
        self.last_run_diagnostics = {}

    def optimize(self, objective: Objective, init_params=None, random_seed: int | None = None,
                 learning_rate: float = 0.08, restarts: int = 5, restart_patience: int = 220,
                 polish_patience: int = 120, trust_radius: float = 0.30,
                 min_trust_radius: float = 0.01, max_trust_radius: float = 0.80,
                 noise_start: float = 0.10, noise_decay: float = 0.997,
                 hold_noise_scale: float = 0.25, filter_size: int = 16,
                 cap_init: int = 4, cap_mult: float = 2.0, cap_lo: int = 2, cap_hi: int = 24,
                 max_bisections: int = 3, stop_margin: float = 1.10,
                 return_reserve_s: float = 0.05, max_episodes: int = 100000,
                 budget_patience: bool = True, restart_frac: float = 0.30,
                 polish_frac: float = 0.20, min_restart_patience: int = 10,
                 min_polish_patience: int = 6, min_explore_calls: int = 12,
                 **kwargs) -> None:
        obj = objective
        if type(restarts) is not int or not 1 <= restarts <= 16:
            raise ValueError("restarts must be int in [1,16]")
        if type(restart_patience) is not int or restart_patience < 20:
            raise ValueError("restart_patience must be int >= 20")
        if type(polish_patience) is not int or polish_patience < 10:
            raise ValueError("polish_patience must be int >= 10")
        if not 0.0 < learning_rate <= 1.0:
            raise ValueError("learning_rate must be in (0,1]")
        if not 0 < min_trust_radius <= trust_radius <= max_trust_radius <= 2.0:
            raise ValueError("invalid trust radii")
        if not (0.0 <= noise_start <= 1.0 and 0.9 <= noise_decay <= 1.0
                and 0.0 <= hold_noise_scale <= 1.0):
            raise ValueError("invalid noise schedule")
        if type(filter_size) is not int or not 1 <= filter_size <= 64:
            raise ValueError("filter_size must be int in [1,64]")
        if not (type(cap_lo) is int and type(cap_hi) is int and type(cap_init) is int
                and 1 <= cap_lo <= cap_init <= cap_hi <= 200 and 0.5 <= cap_mult <= 8.0):
            raise ValueError("invalid excursion cap")
        if type(max_bisections) is not int or not 0 <= max_bisections <= 10:
            raise ValueError("max_bisections must be int in [0,10]")
        if not (math.isfinite(stop_margin) and 1.0 <= stop_margin <= 3.0
                and math.isfinite(return_reserve_s) and 0.0 <= return_reserve_s <= 5.0):
            raise ValueError("invalid stop safeguard")
        if type(max_episodes) is not int or max_episodes < 1:
            raise ValueError("max_episodes must be int >= 1")
        if type(budget_patience) is not bool:
            raise ValueError("budget_patience must be bool")
        for _name, _v in (("restart_frac", restart_frac), ("polish_frac", polish_frac)):
            if (isinstance(_v, bool) or not isinstance(_v, (int, float))
                    or not (math.isfinite(_v) and 0.05 <= _v <= 1.0)):
                raise ValueError(_name + " must be finite in [0.05,1]")
        if type(min_restart_patience) is not int or not 1 <= min_restart_patience <= restart_patience:
            raise ValueError("min_restart_patience must be int in [1,restart_patience]")
        if type(min_polish_patience) is not int or not 1 <= min_polish_patience <= polish_patience:
            raise ValueError("min_polish_patience must be int in [1,polish_patience]")
        if type(min_explore_calls) is not int or min_explore_calls < 0:
            raise ValueError("min_explore_calls must be int >= 0")

        self.prepare(obj, unbounded=True, random_seed=random_seed)
        rng = np.random.default_rng(0 if random_seed is None else int(random_seed))

        starts, raw0 = [], None
        if init_params is not None:
            starts.append(np.asarray(init_params, dtype=np.float64).reshape(-1))
        while len(starts) < restarts:
            r = obj.random_params_unbounded()
            raw0 = r if raw0 is None else raw0
            starts.append(np.asarray(r, dtype=np.float64).reshape(-1))
        ref = init_params if init_params is not None else raw0
        dtype = np.asarray(ref).dtype
        if not np.issubdtype(dtype, np.floating):
            dtype = np.dtype(np.float64)
        n = starts[0].size
        try:
            import jax.numpy as _xnp
        except Exception:  # internal-case environments without JAX
            _xnp = np

        use_aux = getattr(obj, "power_thresholds", None) is not None
        if use_aux:
            obj.warmup_value_and_grad_aux()
        else:
            obj.warmup_value_and_grad()

        diag = {"algorithm_str": self.algorithm_str, "uses_aux": use_aux, "calls": 0,
                "feasible_calls": 0, "unknown_aux_calls": 0, "nonfinite_calls": 0,
                "filter_admitted_infeasible": 0, "filter_rejected": 0, "bisections": 0,
                "restorations": 0, "natural_reentries": 0, "duplicates_perturbed": 0,
                "episodes": 0, "episode_kinds": {}, "final_cap": None,
                "stop_reason": None, "stopped_predictively": False,
                "best_feasible_internal": None, "best_feasible_call_internal": None,
                "kwargs_ignored": sorted(kwargs.keys()),
                "derivative_of_sha256": PARENT_SHA256,
                "budget_patience": budget_patience,
                "episode_log": [], "episode_log_dropped": 0, "partial_episode": None,
                "patience_source_counts": {"budget": 0, "configured": 0},
                "low_budget_explore_to_polish": 0, "unlogged_calls_detected": 0,
                "first_call_s": None, "cost_estimate_s": None,
                "calls_left_estimate_at_stop": None,
                "note": ("bookkeeping only; Objective history is authoritative; "
                         "episodes/episode_kinds/episode_log count completed episodes; "
                         "partial_episode is the episode interrupted by the stop")}
        self.last_run_diagnostics = diag

        guard = CallGuard(stop_margin, return_reserve_s)
        recent = RecentPoints(32)
        filt = PairFilter(filter_size)
        inc = Incumbent()
        cap = ExcursionCap(cap_init, cap_mult, cap_lo, cap_hi)
        clock = self.clock
        state = {"it": 0, "trust": float(trust_radius)}
        cur = {"active": False}

        obj.start_logging()

        def evaluate(x):
            reason = guard.stop_reason(obj)
            if reason is not None:
                diag["stop_reason"] = reason
                raise _Stop
            p = _xnp.asarray(np.asarray(x, dtype=np.float64).astype(dtype))
            ec0 = public_number(obj, "eval_count")
            t0 = clock()
            guard.note_start(t0)
            info = None
            if use_aux:
                loss, grad, aux = obj.value_and_grad_aux(p)
                info = parse_aux(aux)
                if info is None:
                    diag["unknown_aux_calls"] += 1
            else:
                loss, grad = obj.value_and_grad(p)
            guard.record(clock() - t0)
            diag["calls"] += 1
            ec1 = public_number(obj, "eval_count")
            logged = None if (ec0 is None or ec1 is None) else bool(ec1 > ec0)
            if logged is False:
                diag["unlogged_calls_detected"] += 1
            recent.add(x)
            try:
                f = float(loss)
                g = np.asarray(grad, dtype=np.float64).reshape(-1)
                ok = math.isfinite(f) and g.size == n and bool(np.all(np.isfinite(g)))
            except Exception:
                f, g, ok = math.inf, np.zeros(n), False
            if not ok:
                diag["nonfinite_calls"] += 1
            # Feasible only when the logged aux says so AND the call is finite.
            feas = bool(ok and info is not None and info[0])
            if feas:
                diag["feasible_calls"] += 1
            # Incumbent: only calls not shown unlogged by public eval_count.
            inc.offer(x, f, feas and logged is not False, ok, diag["calls"])
            if bool(obj.budget_exceeded):
                # Call may have been counted but not logged; stop, keep incumbent.
                diag["stop_reason"] = "budget_exceeded_after_call"
                raise _Stop
            return f, g, feas, ok, info

        def dedupe(x, tr):
            if recent.seen(x):
                diag["duplicates_perturbed"] += 1
                return x + rng.normal(size=n) * 1e-3 * max(tr, min_trust_radius)
            return x

        def episode(x0, kind):
            """kind: 'seek' | 'explore' | 'polish'. Returns final trust."""
            params = np.asarray(x0, dtype=np.float64).copy()
            adam = Adam(n, learning_rate)
            tr = state["trust"] if kind != "polish" else max(min_trust_radius, 0.5 * state["trust"])
            is_polish = kind == "polish"
            cfg = polish_patience if is_polish else restart_patience
            frac = float(polish_frac if is_polish else restart_frac)
            floor = min_polish_patience if is_polish else min_restart_patience
            start_call = diag["calls"]
            no_improve = 0
            local_best = math.inf
            streak = 0          # consecutive infeasible calls while incumbent exists
            bis = 0             # bisections since last admitted point
            anchor = None       # last admitted point (for bisection)
            noise_mult = hold_noise_scale if is_polish else 1.0
            entry_best = inc.f
            # Retention target for this episode: polish uses the global incumbent;
            # seek/explore use the episode's own best logged feasible point, so an
            # exploration start is not immediately pulled back to the incumbent.
            ep_x, ep_f = (inc.x.copy(), inc.f) if is_polish else (None, math.inf)
            cur.clear()
            cur.update(active=True, kind=kind, start_call=start_call, entry_best=entry_best,
                       no_improve=0, patience=cfg, patience_source="configured")

            def current_patience():
                if not budget_patience:
                    return cfg, "configured"
                est = guard.calls_left_estimate(obj)
                if est is None:
                    return cfg, "configured"  # unknown budget: parent behaviour
                horizon = (diag["calls"] - start_call) + est
                return max(floor, min(cfg, int(math.ceil(frac * horizon)))), "budget"

            def finish(end, patience_now, source_now, no_improve_now):
                entry = {"kind": kind, "start_call": start_call,
                         "calls": diag["calls"] - start_call, "end": end,
                         "patience": patience_now, "patience_source": source_now,
                         "no_improve": no_improve_now,
                         "improved_incumbent": bool(inc.f < entry_best)}
                if len(diag["episode_log"]) < EPISODE_LOG_MAX:
                    diag["episode_log"].append(entry)
                else:
                    diag["episode_log_dropped"] += 1
                diag["patience_source_counts"][source_now] += 1
                cur["active"] = False

            while True:
                # Refreshed before every call, including after restoration and
                # bisection `continue` paths, so the bound follows the budget.
                patience, source = current_patience()
                cur["patience"] = patience
                cur["patience_source"] = source
                cur["no_improve"] = no_improve
                if no_improve >= patience:
                    break
                shrink_every = max(5, min(25, patience // 3))
                params = dedupe(params, tr)
                f, g, feas, ok, info = evaluate(params)
                had_inc = ep_x is not None
                if feas and f < ep_f:
                    ep_x, ep_f = params.copy(), f
                have_inc = ep_x is not None
                if have_inc and not had_inc:
                    local_best = math.inf  # switch progress metric to feasible loss
                if not ok:
                    no_improve += 1
                    if have_inc:
                        params = ep_x + rng.normal(size=n) * 0.1 * tr
                        adam = Adam(n, learning_rate)
                        tr = max(min_trust_radius, tr * 0.7)
                        streak, bis = 0, 0
                        diag["restorations"] += 1
                        continue
                    finish("seek_nonfinite", patience, source, no_improve)
                    return tr  # SEEK with nonfinite: next episode / start

                if feas:
                    if streak > 0:
                        cap.record_natural(streak)
                        diag["natural_reentries"] += 1
                    streak, bis = 0, 0
                    if info is not None:
                        filt.add(info[1], info[2])
                    admitted = True
                elif not have_inc:
                    admitted = True     # SEEK: penalized-loss descent, as in 096
                else:
                    streak += 1
                    if info is not None and streak <= cap.value() and filt.acceptable(info[1], info[2]):
                        filt.add(info[1], info[2])
                        diag["filter_admitted_infeasible"] += 1
                        admitted = True
                    else:
                        diag["filter_rejected"] += 1
                        admitted = False

                # progress bookkeeping: feasible loss once an incumbent exists
                score = f if not have_inc else (f if feas else math.inf)
                if score < local_best:
                    local_best = score
                    no_improve = 0
                    tr = min(max_trust_radius, tr * 1.015)
                else:
                    no_improve += 1
                    if no_improve % shrink_every == 0:
                        tr = max(min_trust_radius, tr * 0.70)

                if not admitted:
                    if streak > cap.value() or bis >= max_bisections or anchor is None:
                        params = ep_x + rng.normal(size=n) * 0.05 * tr
                        adam = Adam(n, learning_rate)
                        tr = max(min_trust_radius, tr * 0.7)
                        streak, bis = 0, 0
                        diag["restorations"] += 1
                    else:
                        params = anchor + 0.5 * (params - anchor)
                        bis += 1
                        diag["bisections"] += 1
                    continue

                anchor = params.copy()
                bis = 0
                step = adam.step(g)
                sn = float(np.linalg.norm(step))
                step = step * min(1.0, tr / (sn + 1e-12))
                ns = noise_mult * noise_start * (noise_decay ** state["it"])
                proposal = params + step + ns * tr * rng.normal(size=n)
                if kind == "explore" and inc.x is not None and no_improve > patience // 2:
                    proposal = 0.75 * proposal + 0.25 * inc.x
                params = proposal
                state["it"] += 1
            if kind == "polish" and inc.f >= entry_best:
                tr = max(min_trust_radius, tr * 0.7)
            finish("patience", patience, source, no_improve)
            return tr

        try:
            k = 0
            next_start = 0
            while k < max_episodes:
                if inc.x is None:
                    kind = "seek"
                elif k % 2 == 1:
                    kind = "polish"
                else:
                    kind = "explore"
                    if budget_patience:
                        est = guard.calls_left_estimate(obj)
                        if est is not None and est < min_explore_calls:
                            kind = "polish"
                            diag["low_budget_explore_to_polish"] += 1
                if kind == "polish":
                    x0 = inc.x.copy()
                    filt.clear()
                elif next_start < len(starts):
                    x0 = starts[next_start]
                    next_start += 1
                else:
                    x0 = np.asarray(obj.random_params_unbounded(), dtype=np.float64).reshape(-1)
                if kind == "explore":
                    filt.clear()
                tr = episode(x0, kind)
                state["trust"] = max(min_trust_radius, min(max_trust_radius, tr))
                diag["episodes"] += 1
                diag["episode_kinds"][kind] = diag["episode_kinds"].get(kind, 0) + 1
                k += 1
            if diag["stop_reason"] is None:
                diag["stop_reason"] = "max_episodes"
        except _Stop:
            diag["stopped_predictively"] = diag["stop_reason"] in ("predicted_overrun", "evals_left")
        except Exception as exc:
            if diag["stop_reason"] is None:
                diag["stop_reason"] = "exception:" + type(exc).__name__
            raise
        finally:
            if cur.get("active"):
                diag["partial_episode"] = {
                    "kind": cur["kind"], "start_call": cur["start_call"],
                    "calls": diag["calls"] - cur["start_call"],
                    "no_improve_at_last_check": cur["no_improve"],
                    "patience": cur["patience"], "patience_source": cur["patience_source"],
                    "improved_incumbent": bool(inc.f < cur["entry_best"])}
                cur["active"] = False
            diag["final_cap"] = cap.value()
            diag["first_call_s"] = guard.first
            diag["cost_estimate_s"] = guard.cost_estimate()
            diag["calls_left_estimate_at_stop"] = guard.calls_left_estimate(obj)
            if inc.x is not None:
                diag["best_feasible_internal"] = inc.f
                diag["best_feasible_call_internal"] = inc.call
            self.last_run_diagnostics = diag
        return None
