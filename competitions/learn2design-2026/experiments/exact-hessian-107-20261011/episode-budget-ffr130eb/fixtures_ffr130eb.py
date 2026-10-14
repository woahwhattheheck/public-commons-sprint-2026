# FILE: ffr130eb/fixtures_ffr130eb.py
"""Focused offline fixtures for ffr130eb/submission.py (internal solver validation).

Not a proof/verification product. Nothing here has been executed by its author.
Requires the pinned environment (dfbench 0.3.3 + jax) because the candidate imports
dfbench and the real OptimizationAlgorithm.prepare is used unmodified.

Mock seam (justification): UIFO physics is irrelevant to scheduling, so a duck-typed
stand-in exposes only the public Objective surface the candidate uses. That surface is
set_space_mode, algorithm_str, set_seed (all called by the real prepare),
random_params_unbounded, power_thresholds, warmup_value_and_grad_aux, start_logging,
value_and_grad_aux, budget_exceeded, time_left, evals_left and eval_count.
Time is simulated: only an evaluation advances `now`, by a scripted cost. The same
clock is injected into the candidate through its existing `clock` class seam, so
CallGuard durations and time_left come from one consistent clock.
Budget admission mirrors dfbench 0.3.3 Objective._log/_log_evals: the result is
returned but not logged if elapsed >= max_time after the call or evals are exhausted.
Losses and feasibility are scripted by call index, so the assertions do not depend
on the search trajectory.

Run: python fixtures_ffr130eb.py   (or: pytest fixtures_ffr130eb.py)
Candidate path: env FFR130EB_CANDIDATE, default ./submission.py next to this file.
"""
from __future__ import annotations

import importlib.util
import os
import sys
import types
from pathlib import Path

import numpy as np

try:  # pinned runtime uses x64; keeps fixture arrays float64 end to end
    import jax
    jax.config.update("jax_enable_x64", True)
except Exception:
    pass

from dfbench import OptimizationAlgorithm

HERE = Path(__file__).resolve().parent
CANDIDATE = Path(os.environ.get("FFR130EB_CANDIDATE", str(HERE / "submission.py")))
_CACHE = {}


def candidate():
    if not _CACHE:
        spec = importlib.util.spec_from_file_location("_ffr130eb_fixture_candidate", CANDIDATE)
        if spec is None or spec.loader is None:
            raise RuntimeError("cannot load candidate " + str(CANDIDATE))
        mod = importlib.util.module_from_spec(spec)
        sys.modules[spec.name] = mod
        spec.loader.exec_module(mod)
        found = [c for c in vars(mod).values() if isinstance(c, type)
                 and issubclass(c, OptimizationAlgorithm) and c.__module__ == spec.name]
        assert len(found) == 1, found
        _CACHE["mod"], _CACHE["cls"] = mod, found[0]
    return _CACHE["mod"], _CACHE["cls"]


class ScriptedPublicObjective:
    def __init__(self, loss_fn, feasible_fn, *, n=4, max_time=None, max_evals=None,
                 cost=2.0, first_cost=None, time_left_mode="public", evals_left_mode="public"):
        self.loss_fn, self.feasible_fn, self.n = loss_fn, feasible_fn, int(n)
        self.max_time, self.max_evals = max_time, max_evals
        self.cost = float(cost)
        self.first_cost = None if first_cost is None else float(first_cost)
        self.time_left_mode, self.evals_left_mode = time_left_mode, evals_left_mode
        self.now = 0.0
        self.start = None
        self.unbounded = False
        self.algorithm_str = None
        self.seed = None
        self.rng = np.random.default_rng(0)
        self.eval_count = 0
        self.remaining_evals = max_evals
        self.evals_exceeded = False
        self.calls_made = 0
        self.unlogged_calls = 0
        self.warmups = 0
        self.loss_history, self.is_feasible_history, self.time_steps = [], [], []

    # -- seam: simulated clock shared with the algorithm
    def clock(self):
        return self.now

    # -- surface used by the real OptimizationAlgorithm.prepare
    def set_space_mode(self, unbounded, unit_mapping=None, inverse_unit_mapping=None):
        if self.start is not None:
            raise RuntimeError("set_space_mode() after start_logging()")
        self.unbounded = bool(unbounded)

    def set_seed(self, seed):
        self.seed = seed
        self.rng = np.random.default_rng(seed)

    # -- public surface used by the candidate
    @property
    def power_thresholds(self):
        return {"hard": 1.0, "soft": 1.0, "detector": 1.0}

    def random_params_unbounded(self, n_samples=1, rng_key=None):
        x = self.rng.normal(size=(n_samples, self.n))
        return x[0] if n_samples == 1 else x

    def warmup_value_and_grad_aux(self):
        if self.start is not None:
            raise RuntimeError("warmup after start_logging()")
        self.warmups += 1

    def warmup_value_and_grad(self):
        raise AssertionError("aux problem: candidate must warm the aux path")

    def value_and_grad(self, params):
        raise AssertionError("aux problem: candidate must call value_and_grad_aux")

    def start_logging(self):
        if self.start is not None:
            raise RuntimeError("start_logging() twice")
        self.start = self.now

    def _elapsed(self):
        return 0.0 if self.start is None else self.now - self.start

    @property
    def budget_exceeded(self):
        t = self.max_time is not None and self._elapsed() >= self.max_time
        return bool(t or self.evals_exceeded)

    @property
    def time_left(self):
        if self.time_left_mode == "missing":
            raise AttributeError("time_left")
        if self.time_left_mode == "nan":
            return float("nan")
        if self.time_left_mode == "none" or self.max_time is None:
            return None
        return max(0.0, self.max_time - self._elapsed())

    @property
    def evals_left(self):
        if self.evals_left_mode == "missing":
            raise AttributeError("evals_left")
        if self.evals_left_mode == "nan":
            return float("nan")
        if self.evals_left_mode == "none":
            return None
        return self.remaining_evals

    def value_and_grad_aux(self, params):
        if self.start is None:
            raise RuntimeError("value_and_grad_aux() requires start_logging() first")
        x = np.asarray(params, dtype=np.float64).reshape(-1)
        assert x.shape == (self.n,)
        i = self.calls_made
        self.calls_made += 1
        self.now += self.first_cost if (i == 0 and self.first_cost is not None) else self.cost
        f = float(self.loss_fn(i, x))
        ok = bool(self.feasible_fn(i, x))
        grad = 2.0 * (x - 0.3)
        aux = {"is_feasible": np.bool_(ok),
               "violations": np.array([0.0 if ok else 0.5]),
               "sensitivity_loss": np.array(f),
               "penalty": np.array(0.0 if ok else 0.5)}
        self._admit(f, ok)
        return f, grad, aux

    def _admit(self, f, ok):
        elapsed = self._elapsed()
        if (self.max_time is not None and elapsed >= self.max_time) or self.evals_exceeded:
            self.unlogged_calls += 1
            return
        if self.max_evals is not None and self.max_evals - self.eval_count <= 0:
            self.evals_exceeded = True
            self.remaining_evals = 0
            self.unlogged_calls += 1
            return
        self.eval_count += 1
        if self.max_evals is not None:
            self.remaining_evals = max(0, self.max_evals - self.eval_count)
            self.evals_exceeded = self.remaining_evals <= 0
        self.loss_history.append(f)
        self.is_feasible_history.append(ok)
        self.time_steps.append(elapsed)


# ------------------------------------------------------------------ scripts
def staircase(i, x):
    """Improves by 0.25 at call indices 12, 24, 36, 48 (11 flat calls between), then flat."""
    return 5.0 - 0.25 * min(i // 12, 4)


def alternating_loss(i, x):
    """Even calls: feasible, slowly decreasing. Odd calls: infeasible with much lower loss."""
    return 6.0 - 0.001 * i if i % 2 == 0 else 1.0


def always(i, x):
    return True


def never(i, x):
    return False


def even(i, x):
    return i % 2 == 0


# ------------------------------------------------------------------ harness
def run(obj, **kwargs):
    _, cls = candidate()
    alg = cls()
    alg.clock = obj.clock  # one clock for CallGuard durations and time_left
    ret = alg.optimize(obj, random_seed=42, **kwargs)
    assert ret is None
    d = alg.last_run_diagnostics
    check_contract(obj, d, cls)
    return d


def check_contract(obj, d, cls):
    # real prepare() wiring
    assert obj.algorithm_str == cls.algorithm_str
    assert obj.unbounded is True and obj.seed == 42 and obj.warmups == 1
    # stop cleanup and honest bookkeeping
    assert d["stop_reason"] is not None and isinstance(d["final_cap"], int)
    assert d["calls"] == obj.calls_made == obj.eval_count + obj.unlogged_calls
    assert d["unlogged_calls_detected"] == obj.unlogged_calls
    if obj.max_time is not None:
        assert all(t < obj.max_time for t in obj.time_steps)
    if obj.max_evals is not None:
        assert obj.eval_count <= obj.max_evals
    p = d["partial_episode"]
    assert isinstance(p, dict), "budget stops happen inside an episode"
    assert d["episode_log_dropped"] == 0
    assert d["episodes"] == len(d["episode_log"])
    assert sum(e["calls"] for e in d["episode_log"]) + p["calls"] == d["calls"]
    # strict best-feasible incumbent equals the best logged feasible loss
    feas = [f for f, ok in zip(obj.loss_history, obj.is_feasible_history) if ok]
    if feas:
        assert d["best_feasible_internal"] == min(feas)
    else:
        assert d["best_feasible_internal"] is None


# ------------------------------------------------------------------ fixtures
def test_public_field_helpers():
    mod, _ = candidate()
    pn, NS = mod.public_number, types.SimpleNamespace

    class Raises:
        @property
        def v(self):
            raise RuntimeError("unavailable")

    assert pn(NS(v=None), "v") is None
    assert pn(NS(v=float("nan")), "v") is None
    assert pn(NS(v=float("inf")), "v") is None
    assert pn(NS(v=True), "v") is None
    assert pn(NS(v="12"), "v") is None
    assert pn(NS(), "v") is None
    assert pn(Raises(), "v") is None
    assert pn(NS(v=-3), "v") == 0.0
    assert pn(NS(v=np.int64(7)), "v") == 7.0

    g = mod.CallGuard(1.10, 0.05)
    assert g.calls_left_estimate(NS(time_left=100.0, evals_left=None)) is None  # no cost yet
    assert g.calls_left_estimate(NS(time_left=100.0, evals_left=7)) == 7.0
    g.note_start(0.0)
    g.record(40.0)                     # cold first call
    assert abs(g.cost_estimate() - 40.0) < 1e-12
    g.note_start(40.0)
    g.record(2.0)
    assert abs(g.cost_estimate() - 2.0) < 1e-12   # first call excluded
    g.note_start(42.0)                  # first steady cycle (call 2 -> call 3)
    g.record(2.0)
    assert list(g.cycles) == [2.0]
    est = g.calls_left_estimate(NS(time_left=100.0, evals_left=None))
    assert abs(est - (100.0 - 0.05) / (1.10 * 2.0)) < 1e-9
    assert g.calls_left_estimate(NS(time_left=float("nan"), evals_left=None)) is None
    assert g.calls_left_estimate(NS(time_left=float("nan"), evals_left=5)) == 5.0
    assert g.calls_left_estimate(NS(time_left=100.0, evals_left=3)) == 3.0


def test_time_budget_stall_transition_and_no_cutoff():
    obj = ScriptedPublicObjective(staircase, always, max_time=180.0, cost=2.0)
    d = run(obj)
    first = d["episode_log"][0]
    assert first["start_call"] == 0 and first["kind"] == "seek"
    # continued improvement (gaps of 11 flat calls) was not cut off ...
    assert first["calls"] >= 49
    # ... and the stall after the last improvement (call index 48) ended the episode
    assert first["end"] == "patience" and first["patience_source"] == "budget"
    assert first["no_improve"] >= first["patience"]
    assert first["calls"] == 49 + first["no_improve"]
    assert first["patience"] < 220
    assert d["episodes"] >= 2
    assert d["stop_reason"] == "predicted_overrun" and d["stopped_predictively"]
    assert obj.unlogged_calls == 0
    assert d["best_feasible_internal"] == 4.0
    # Same script with the scheduler disabled: configured 220 never fires in this budget.
    ref = ScriptedPublicObjective(staircase, always, max_time=180.0, cost=2.0)
    r = run(ref, budget_patience=False)
    assert r["episodes"] == 0
    assert r["partial_episode"]["patience"] == 220
    assert r["partial_episode"]["patience_source"] == "configured"
    assert r["calls"] == d["calls"]


def test_cold_first_call_does_not_shrink_patience():
    obj = ScriptedPublicObjective(staircase, always, max_time=180.0, cost=2.0, first_cost=40.0)
    d = run(obj)
    first = d["episode_log"][0] if d["episode_log"] else d["partial_episode"]
    assert first["start_call"] == 0 and first["calls"] >= 49
    assert d["first_call_s"] == 40.0
    assert abs(d["cost_estimate_s"] - 2.0) < 1e-9
    assert d["stop_reason"] == "predicted_overrun" and obj.unlogged_calls == 0
    assert d["best_feasible_internal"] == 4.0


def test_eval_budget_and_incumbent_vs_infeasible_lower_loss():
    obj = ScriptedPublicObjective(alternating_loss, even, max_evals=60, cost=2.0)
    d = run(obj)
    assert obj.eval_count == 60 and obj.unlogged_calls == 0
    assert d["stop_reason"] == "budget_exceeded_after_call"
    infeasible = [f for f, ok in zip(obj.loss_history, obj.is_feasible_history) if not ok]
    assert infeasible and min(infeasible) == 1.0
    assert d["best_feasible_internal"] > 1.0
    assert d["best_feasible_internal"] == 6.0 - 0.001 * 58
    assert d["episodes"] == 0
    assert d["partial_episode"]["calls"] == 60
    assert d["partial_episode"]["patience_source"] == "budget"


def test_unavailable_fields_and_no_feasible_point():
    obj = ScriptedPublicObjective(lambda i, x: 7.0, never, max_time=120.0, cost=2.0,
                                  time_left_mode="nan", evals_left_mode="missing")
    d = run(obj)
    assert d["best_feasible_internal"] is None and d["feasible_calls"] == 0
    assert d["episodes"] == 0
    p = d["partial_episode"]
    assert p["kind"] == "seek" and p["patience"] == 220 and p["patience_source"] == "configured"
    assert d["stop_reason"] == "budget_exceeded_after_call" and not d["stopped_predictively"]
    assert obj.unlogged_calls == 1 and obj.eval_count == 59


TESTS = [test_public_field_helpers,
         test_time_budget_stall_transition_and_no_cutoff,
         test_cold_first_call_does_not_shrink_patience,
         test_eval_budget_and_incumbent_vs_infeasible_lower_loss,
         test_unavailable_fields_and_no_feasible_point]


if __name__ == "__main__":
    for t in TESTS:
        t()
        print(t.__name__, "ok")
