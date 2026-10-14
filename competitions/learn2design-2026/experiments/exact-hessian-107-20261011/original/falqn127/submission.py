"""tjlabs_falqn127: Feasibility-Anchored Limited-memory Quasi-Newton (FALQN127)
for the Learn2Design-2026 size-3 UIFO Objective.

Status: SOURCE ONLY. Not executed, not physics-tested, not submitted. No score,
gain, timing, H100 or four-hour behaviour is claimed. New constants are
UNCALIBRATED design choices unless marked as inherited from 096/FARA122.
Lab-authored for TokenJunkieLabs/Bryce.

Mechanism
  SEEK   (no logged feasible point yet in this episode): the FARA122 pre-feasible
         path, unchanged: 096-style clipped Adam + trust radius + decaying noise,
         same start list, same NumPy RNG order, same duplicate guard.
  ANCHOR (after the first finite, logged aux['is_feasible'] == True point):
         incumbent-anchored L-BFGS trust step, exactly one logged call per trial.
         * The base is always a finite logged feasible point. It moves only to a
           finite logged feasible point with strictly lower loss.
         * A curvature pair (s, y) is admitted only when BOTH endpoints are finite
           logged feasible points and s.y > eps*|s||y|. Under the default squashed
           ReLU penalty, feasible endpoints carry zero penalty value (and zero
           penalty gradient at strict-interior points), so the pair is a secant of
           the sensitivity loss, not of the penalty kink.
         * A feasible but non-improving trial keeps its pair (valid curvature) but
           does not move the base; the radius contracts.
         * An infeasible / non-finite / unknown-aux trial is never stored. The base
           and its cached loss/gradient are reused for the next trial, so
           restoration costs no Objective call. The radius contracts.
         * A proposal identical to a recently evaluated vector is skipped without
           a call and treated as a rejection.
         * When the radius falls below its floor, memory is cleared and the radius
           reset (at most `qn_max_resets` times without base improvement). After
           that the episode is locally stationary and the next 096/FARA start is
           used. The global incumbent is never replaced by an infeasible or
           non-finite point.
  No Hessian/HVP, finite differences, batched calls, raw Objective callables,
  manual logging, private Objective members, penalty/space/bound changes or
  simulator imports.
"""
from __future__ import annotations

import math
import time
from collections import deque

import numpy as np

from dfbench import Objective, OptimizationAlgorithm


def parse_feasible(aux):
    """Return the logged physical feasibility flag, or None if unknown/malformed."""
    if not isinstance(aux, dict) or "is_feasible" not in aux:
        return None
    try:
        a = np.asarray(aux["is_feasible"]).reshape(-1)
    except Exception:
        return None
    if a.size != 1 or a.dtype.kind != "b":
        return None
    return bool(a[0])


class CallGuard:
    """Predictive stop from public budget fields only (inherited from 096/FARA122)."""

    def __init__(self, stop_margin=1.10, return_reserve_s=0.05, window=8):
        self.stop_margin = float(stop_margin)
        self.reserve = float(return_reserve_s)
        self.durations = deque(maxlen=int(window))
        self.ewma = None

    def record(self, dt):
        self.durations.append(float(dt))
        self.ewma = dt if self.ewma is None else 0.7 * self.ewma + 0.3 * dt

    def stop_reason(self, obj):
        if bool(obj.budget_exceeded):
            return "budget_exceeded"
        left = obj.evals_left
        if left is not None and left < 1:
            return "evals_left"
        if not self.durations:
            return None  # first call always allowed: a run needs one logged entry
        tl = obj.time_left
        if tl is None or not math.isfinite(float(tl)):
            return None
        pred = max(self.ewma, max(self.durations))
        if float(tl) < self.stop_margin * pred + self.reserve:
            return "predicted_overrun"
        return None


class RecentPoints:
    """Exact-bytes memory of the last `size` evaluated vectors (FARA122)."""

    def __init__(self, size=64):
        self.q = deque(maxlen=int(size))
        self.s = set()

    def seen(self, x):
        return np.asarray(x, dtype=np.float64).tobytes() in self.s

    def add(self, x):
        k = np.asarray(x, dtype=np.float64).tobytes()
        if len(self.q) == self.q.maxlen:
            self.s.discard(self.q[0])
        self.q.append(k)
        self.s.add(k)


class Adam:
    """optax.chain(clip_by_global_norm(1.0), adam(lr)) in NumPy, O(n) state."""

    def __init__(self, n, lr, b1=0.9, b2=0.999, eps=1e-8):
        self.lr, self.b1, self.b2, self.eps = lr, b1, b2, eps
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


class Incumbent:
    """Best finite logged feasible point. Nothing infeasible/non-finite replaces it."""

    def __init__(self):
        self.x = None
        self.f = math.inf
        self.g = None
        self.call = None

    def offer(self, x, f, g, feasible, finite, call=None):
        if feasible is not True or not finite:
            return False
        try:
            f = float(f)
        except Exception:
            return False
        if not math.isfinite(f) or not f < self.f:
            return False
        self.x = np.array(x, dtype=np.float64, copy=True)
        self.g = None if g is None else np.array(g, dtype=np.float64, copy=True)
        self.f = f
        self.call = call
        return True


def select_feasible_anchor(found, incumbent):
    """Prefer best logged feasible point over this episode's first-feasible point."""
    if incumbent.x is not None and incumbent.f < float(found[1]):
        return incumbent.x.copy(), incumbent.f, incumbent.g.copy()
    return found


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
        return "stationary"


class _Stop(Exception):
    pass


class FeasibilityAnchoredLBFGS127(OptimizationAlgorithm):
    algorithm_str = "tjlabs_falqn127"
    clock = staticmethod(time.perf_counter)
    memory_cls = CurvatureMemory  # internal-case injection point only

    def __init__(self):
        self.last_run_diagnostics = {}

    def optimize(self, objective: Objective, init_params=None, random_seed: int | None = None,
                 learning_rate: float = 0.08, restarts: int = 5, restart_patience: int = 220,
                 trust_radius: float = 0.30, min_trust_radius: float = 0.01,
                 max_trust_radius: float = 0.80, noise_start: float = 0.10,
                 noise_decay: float = 0.997, memory: int = 8, curvature_eps: float = 1e-8,
                 qn_radius: float = 0.30, qn_min_radius: float = 0.01,
                 qn_max_radius: float = 0.80, qn_grow: float = 2.0, qn_shrink: float = 0.5,
                 armijo_c1: float = 1e-4, qn_max_resets: int = 2, qn_patience: int = 220,
                 improve_rtol: float = 1e-9, stop_margin: float = 1.10,
                 return_reserve_s: float = 0.05, max_episodes: int = 100000,
                 **kwargs) -> None:
        obj = objective
        # ---- validation ----
        if type(restarts) is not int or not 1 <= restarts <= 16:
            raise ValueError("restarts must be int in [1,16]")
        if type(restart_patience) is not int or restart_patience < 20:
            raise ValueError("restart_patience must be int >= 20")
        if not 0.0 < learning_rate <= 1.0:
            raise ValueError("learning_rate must be in (0,1]")
        if not 0 < min_trust_radius <= trust_radius <= max_trust_radius <= 2.0:
            raise ValueError("invalid trust radii")
        if not (0.0 <= noise_start <= 1.0 and 0.9 <= noise_decay <= 1.0):
            raise ValueError("invalid noise schedule")
        if type(memory) is not int or not 1 <= memory <= 32:
            raise ValueError("memory must be int in [1,32]")
        if not (math.isfinite(curvature_eps) and curvature_eps > 0.0):
            raise ValueError("curvature_eps must be finite and > 0")
        if not 0 < qn_min_radius <= qn_radius <= qn_max_radius <= 2.0:
            raise ValueError("invalid qn radii")
        if not (qn_grow > 1.0 and 0.0 < qn_shrink < 1.0):
            raise ValueError("invalid qn grow/shrink")
        if not 0.0 < armijo_c1 < 0.5:
            raise ValueError("armijo_c1 must be in (0,0.5)")
        if type(qn_max_resets) is not int or not 0 <= qn_max_resets <= 10:
            raise ValueError("qn_max_resets must be int in [0,10]")
        if type(qn_patience) is not int or qn_patience < 5:
            raise ValueError("qn_patience must be int >= 5")
        if not (math.isfinite(improve_rtol) and 0.0 <= improve_rtol < 1e-2):
            raise ValueError("improve_rtol must be in [0,1e-2)")
        if not (math.isfinite(stop_margin) and 1.0 <= stop_margin <= 3.0
                and math.isfinite(return_reserve_s) and 0.0 <= return_reserve_s <= 5.0):
            raise ValueError("invalid stop safeguard")
        if type(max_episodes) is not int or max_episodes < 1:
            raise ValueError("max_episodes must be int >= 1")

        # ---- FARA122 start construction, unchanged order ----
        self.prepare(obj, unbounded=True, random_seed=random_seed)
        rng = np.random.default_rng(0 if random_seed is None else int(random_seed))
        starts = []
        raw0 = None
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

        # Feasibility exists only on problems with the public penalty contract.
        use_aux = obj.power_thresholds is not None
        if use_aux:
            obj.warmup_value_and_grad_aux()
        else:
            obj.warmup_value_and_grad()

        diag = {"algorithm_str": self.algorithm_str, "uses_aux": use_aux, "calls": 0,
                "seek_calls": 0, "qn_trials": 0, "repeat_skips": 0,
                "feasible_calls": 0, "unknown_feasibility_calls": 0, "nonfinite_calls": 0,
                "first_feasible_call": None, "duplicates_perturbed": 0,
                "pair_status": {}, "qn_outcomes": {}, "descent_resets": 0,
                "max_memory_used": 0, "episodes": 0, "episode_status": {},
                "stop_reason": None, "stopped_predictively": False,
                "best_feasible_internal": None, "best_feasible_call_internal": None,
                "kwargs_ignored": sorted(kwargs.keys()),
                "note": "bookkeeping only; Objective history is authoritative"}
        self.last_run_diagnostics = diag
        guard = CallGuard(stop_margin, return_reserve_s)
        recent = RecentPoints(64)
        inc = Incumbent()
        clock = self.clock
        state = {"global_iteration": 0, "trust": float(trust_radius)}

        obj.start_logging()

        def evaluate(x):
            """Exactly one logged public Objective call."""
            reason = guard.stop_reason(obj)
            if reason is not None:
                diag["stop_reason"] = reason
                raise _Stop
            p = _xnp.asarray(np.asarray(x, dtype=np.float64).astype(dtype))
            t0 = clock()
            if use_aux:
                loss, grad, aux = obj.value_and_grad_aux(p)
                feas = parse_feasible(aux)
            else:
                loss, grad = obj.value_and_grad(p)
                feas = None
            guard.record(clock() - t0)
            diag["calls"] += 1
            recent.add(x)
            if feas is None:
                diag["unknown_feasibility_calls"] += 1
            if bool(obj.budget_exceeded):
                # The call may have been counted but not logged: never build on it.
                diag["stop_reason"] = "budget_exceeded_after_call"
                raise _Stop
            try:
                f = float(loss)
                g = np.asarray(grad, dtype=np.float64).reshape(-1)
                ok = math.isfinite(f) and g.size == n and bool(np.all(np.isfinite(g)))
            except Exception:
                f, g, ok = math.nan, np.zeros(n), False
            if not ok:
                diag["nonfinite_calls"] += 1
            feasible = bool(ok and feas is True)
            if feasible:
                diag["feasible_calls"] += 1
                if diag["first_feasible_call"] is None:
                    diag["first_feasible_call"] = diag["calls"]
            inc.offer(x, f, g, feasible, ok, diag["calls"])
            return f, g, feasible, ok

        def seek(x0, restart_index):
            """FARA122 pre-feasible path; returns at the first logged feasible point."""
            params = np.asarray(x0, dtype=np.float64).copy()
            adam = Adam(n, learning_rate)
            local_best_raw = math.inf
            best_raw_x = params.copy()
            no_improve = 0
            tr = state["trust"]
            while True:
                if no_improve >= restart_patience:
                    return "patience", tr, None
                if recent.seen(params):
                    params = params + rng.normal(size=n) * 1e-3 * max(tr, min_trust_radius)
                    diag["duplicates_perturbed"] += 1
                f, g, feas, ok = evaluate(params)
                diag["seek_calls"] += 1
                if feas:
                    return "feasible", tr, (params.copy(), f, g.copy())
                if not ok:
                    return "nonfinite", tr, None
                if f < local_best_raw:
                    local_best_raw, best_raw_x = f, params.copy()
                    no_improve = 0
                    tr = min(max_trust_radius, tr * 1.015)
                else:
                    no_improve += 1
                    if no_improve % 25 == 0:
                        tr = max(min_trust_radius, tr * 0.70)
                step = adam.step(g)
                sn = float(np.linalg.norm(step))
                step = step * min(1.0, tr / (sn + 1e-12))
                ns = noise_start * (noise_decay ** state["global_iteration"])
                proposal = params + step + ns * tr * rng.normal(size=n)
                if restart_index > 0 and no_improve > restart_patience // 2:
                    target = inc.x if inc.x is not None else best_raw_x
                    proposal = 0.75 * proposal + 0.25 * target
                params = proposal
                state["global_iteration"] += 1

        def anchor(found):
            """Incumbent-anchored L-BFGS from a logged feasible point (cached f, g)."""
            found = select_feasible_anchor(found, inc)
            qn = AnchoredQN(self.memory_cls(memory, curvature_eps), qn_radius,
                            qn_min_radius, qn_max_radius, qn_grow, qn_shrink,
                            armijo_c1, qn_max_resets)
            qn.start(*found)  # no Objective call: values come from the logged call
            ep_best = qn.f
            no_improve = 0
            try:
                while True:
                    if no_improve >= qn_patience:
                        return "patience"
                    xt = qn.propose()
                    if xt is None:
                        return "stationary_gradient"
                    if recent.seen(xt):
                        diag["repeat_skips"] += 1
                        out = qn.skip_repeat()
                    else:
                        f, g, feas, ok = evaluate(xt)
                        diag["qn_trials"] += 1
                        out = qn.observe(xt, f, g, feas, ok)
                        if qn.last_pair is not None:
                            ps = diag["pair_status"]
                            ps[qn.last_pair] = ps.get(qn.last_pair, 0) + 1
                    oc = diag["qn_outcomes"]
                    oc[out] = oc.get(out, 0) + 1
                    diag["max_memory_used"] = max(diag["max_memory_used"], len(qn.mem))
                    if out == "accepted" and qn.f < ep_best - improve_rtol * max(1.0, abs(ep_best)):
                        ep_best = qn.f
                        no_improve = 0
                    else:
                        no_improve += 1
                    if out == "stationary":
                        return "stationary"
            finally:
                diag["descent_resets"] += qn.descent_resets

        try:
            k = 0
            while diag["episodes"] < max_episodes:
                if k < len(starts):
                    x0 = starts[k]
                elif inc.x is not None:
                    x0 = inc.x + rng.normal(size=n) * 0.5 * state["trust"]
                else:
                    x0 = np.asarray(obj.random_params_unbounded(), dtype=np.float64).reshape(-1)
                status, tr, found = seek(x0, k)
                k += 1
                state["trust"] = max(min_trust_radius, min(max_trust_radius, tr))
                if found is not None:
                    status = "anchor:" + anchor(found)
                diag["episodes"] += 1
                diag["episode_status"][status] = diag["episode_status"].get(status, 0) + 1
            if diag["stop_reason"] is None:
                diag["stop_reason"] = "max_episodes"
        except _Stop:
            diag["stopped_predictively"] = diag["stop_reason"] in ("predicted_overrun", "evals_left")
        finally:
            if inc.x is not None:
                diag["best_feasible_internal"] = inc.f
                diag["best_feasible_call_internal"] = inc.call
            self.last_run_diagnostics = diag
        return None
