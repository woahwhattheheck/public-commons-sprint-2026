"""Robust binary decisions on an explicit finite profile set.

native_packages chooses ONE whole pre-evaluated native scenario package; it
never adds results of nonlinear model runs. additive_actions uses a separately
declared marginal-benefit decomposition. All regret benchmarks share the same
feasible set, including targets required in every profile. Gains stay in their
original physical units; objective = sum(weight * gain / scale).
"""
from __future__ import annotations
import hashlib
import json
import math
import time
from typing import Any
import numpy as np
from scipy.optimize import Bounds, LinearConstraint, milp
from .schema import Study, Objective


def _canonical_numbers(value):
    # JSON numbers have no integer-vs-float type tag. JavaScript serializes 1.0
    # as 1; normalize this equivalence before hashing a portable JSON structure.
    # Non-integral floats are parsed and rendered by this Python receiver, so
    # exponent whitespace/format changes do not change the semantic digest.
    if isinstance(value, float):
        if not math.isfinite(value):
            raise ValueError("canonical JSON cannot contain non-finite numbers")
        return int(value) if value.is_integer() else value
    if isinstance(value, dict):
        return {k: _canonical_numbers(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_canonical_numbers(v) for v in value]
    return value


def canonical_hash(value: Any) -> str:
    return hashlib.sha256(json.dumps(_canonical_numbers(value), sort_keys=True, separators=(",", ":"), allow_nan=False).encode()).hexdigest()


def _float(value):
    return float(value) if value is not None and math.isfinite(value) else None


class Problem:
    def __init__(self, study: Study, deadline: float, gap: float):
        self.s = study
        self.deadline = deadline
        self.gap = gap
        self.n = len(study.candidates)
        lookup = {(c.profile_id, c.candidate_id): c.gains for c in study.cells}
        self.gains = np.array([[[lookup[p.id, c.id][m.id] for c in study.candidates]
                                for m in study.metrics] for p in study.profiles], dtype=float)
        weights = np.array([m.weight / m.scale for m in study.metrics])
        with np.errstate(over="raise", invalid="raise"):
            self.scores = np.einsum("smc,m->sc", self.gains, weights)
        if not np.isfinite(self.scores).all():
            raise ValueError("normalized objective is not finite")
        self.cost = np.array([c.cost for c in study.candidates])
        self.capacity = np.array([c.capacity for c in study.candidates])
        self.lb = np.array([1. if c.required else 0. for c in study.candidates])
        self.ub = np.array([0. if c.excluded else 1. for c in study.candidates])
        self.rows: list[tuple[np.ndarray, float, float, str, bool]] = []
        if study.mode == "native_packages":
            self.rows.append((np.ones(self.n), 1., 1., "choose_one_native_package", False))
        if study.budget is not None:
            self.rows.append((self.cost, -np.inf, study.budget, "budget", False))
        if study.capacity is not None:
            self.rows.append((self.capacity, -np.inf, study.capacity, "capacity", False))
        for group, limit in study.group_limits.items():
            row = np.array([int(c.group == group) for c in study.candidates])
            self.rows.append((row, -np.inf, limit, f"group:{group}", False))
        for j, m in enumerate(study.metrics):
            if m.guaranteed_gain is not None:
                for i, p in enumerate(study.profiles):
                    self.rows.append((self.gains[i, j], m.guaranteed_gain, np.inf,
                                      f"gain:{p.id}:{m.id}", True))

    def evaluate(self, x, *, targets=True):
        x = np.asarray(x, dtype=float)
        if x.shape != (self.n,) or not np.isfinite(x).all():
            return False
        if np.max(np.abs(x - np.round(x))) > 1e-6:
            return False
        if np.any(x < self.lb - 1e-7) or np.any(x > self.ub + 1e-7):
            return False
        for row, lo, hi, _, is_target in self.rows:
            if is_target and not targets:
                continue
            v = float(row @ x)
            tol = 1e-7 * max(1, abs(v), abs(lo) if math.isfinite(lo) else 0,
                             abs(hi) if math.isfinite(hi) else 0)
            if v < lo - tol or v > hi + tol:
                return False
        return True

    def run(self, kind: str, score=None, benchmarks=None, targets=True):
        remaining = self.deadline - time.monotonic()
        if remaining <= 0:
            return {"status": "time_limit", "message": "Shared study solve deadline reached", "x": None}
        if self.s.mode == "native_packages":
            return self.native_choice(kind, score, benchmarks, targets)
        extra = kind in ("worst_case", "minimax_regret")
        size = self.n + int(extra)
        rows, lower, upper = [], [], []
        for a, lo, hi, _, is_target in self.rows:
            if is_target and not targets:
                continue
            rows.append(np.r_[a, 0] if extra else a)
            lower.append(lo); upper.append(hi)
        objective = np.zeros(size)
        if kind == "worst_case":
            # t <= score_s x, maximize t. t is free to be negative.
            for a in self.scores:
                rows.append(np.r_[-a, 1.]); lower.append(-np.inf); upper.append(0)
            objective[-1] = -1
        elif kind == "minimax_regret":
            for a, best in zip(self.scores, benchmarks):
                rows.append(np.r_[-a, -1.]); lower.append(-np.inf); upper.append(-best)
            objective[-1] = 1
        elif kind == "minimum_cost":
            objective[:self.n] = self.cost
        else:
            objective[:self.n] = -np.asarray(score)
        constraints = None
        if rows:
            constraints = LinearConstraint(np.array(rows), np.array(lower), np.array(upper))
        bounds = Bounds(np.r_[self.lb, -np.inf] if extra else self.lb,
                        np.r_[self.ub, np.inf] if extra else self.ub)
        res = milp(c=objective, integrality=np.r_[np.ones(self.n), 0] if extra else np.ones(self.n),
                   bounds=bounds, constraints=constraints,
                   options={"time_limit": remaining, "mip_rel_gap": self.gap, "presolve": True})
        status = {0: "optimal", 1: "limit_reached", 2: "infeasible", 3: "unbounded", 4: "solver_error"}.get(res.status, "solver_error")
        x = None if res.x is None else res.x[:self.n]
        if x is not None and (not self.evaluate(x, targets=targets) or not self.evaluate(np.round(x), targets=targets)):
            x = None
            status = "invalid_incumbent"
        x = None if x is None else np.round(x)
        return {"status": status, "message": res.message, "x": x, "method": "HiGHS MILP",
                "solver_minimization_bound": _float(getattr(res, "mip_dual_bound", None)),
                "mip_gap": _float(getattr(res, "mip_gap", None)),
                "nodes": int(getattr(res, "mip_node_count", 0) or 0)}

    def native_choice(self, kind, score=None, benchmarks=None, targets=True):
        # Each candidate is already a complete modeled package. Evaluating this
        # finite catalogue directly is exact (within input floating precision)
        # and avoids one integer optimization per profile and budget.
        feasible = self.ub >= 1
        required = np.flatnonzero(self.lb > 0)
        if len(required) > 1:
            feasible[:] = False
        elif len(required) == 1:
            feasible &= np.arange(self.n) == required[0]
        for row, lo, hi, _, is_target in self.rows:
            if is_target and not targets:
                continue
            tolerance = 1e-9 * np.maximum(1., np.abs(row))
            feasible &= (row >= lo - tolerance) & (row <= hi + tolerance)
        indexes = np.flatnonzero(feasible)
        if not len(indexes):
            return {"status": "infeasible", "message": "No evaluated package meets the selected constraints", "x": None,
                    "method": "complete catalogue evaluation", "mip_gap": 0.}
        if kind == "worst_case":
            values = np.min(self.scores, axis=0)
        elif kind == "minimax_regret":
            values = -np.max(np.asarray(benchmarks)[:, None] - self.scores, axis=0)
        elif kind == "minimum_cost":
            values = -self.cost
        else:
            values = np.asarray(score)
        # Deterministic exact-score ties: least cost, then canonical ID.
        chosen = min(indexes, key=lambda i: (-values[i], self.cost[i], self.s.candidates[i].id))
        x = np.zeros(self.n); x[chosen] = 1
        return {"status": "optimal", "message": "Every feasible complete package evaluated", "x": x,
                "method": "complete catalogue evaluation", "feasible_packages": len(indexes), "mip_gap": 0., "nodes": 0}

    def detail(self, result, benchmarks=None):
        output = {k: v for k, v in result.items() if k != "x"}
        x = result.get("x")
        if x is None:
            return output
        gains = np.einsum("smc,c->sm", self.gains, x)
        scores = self.scores @ x
        output.update({"selected_ids": [c.id for c, bit in zip(self.s.candidates, x) if bit],
                       "cost": float(self.cost @ x), "cost_units": self.s.cost_units,
                       "capacity_used": float(self.capacity @ x),
                       "worst_score": float(min(scores)), "best_score": float(max(scores)),
                       "profiles": []})
        for i, p in enumerate(self.s.profiles):
            metrics = []
            for j, m in enumerate(self.s.metrics):
                gain = float(gains[i, j])
                metrics.append({"id": m.id, "units": m.units, "gain": gain,
                                "guaranteed_gain": m.guaranteed_gain,
                                "target_shortfall": None if m.guaranteed_gain is None else max(0., m.guaranteed_gain - gain)})
            output["profiles"].append({"id": p.id, "score": float(scores[i]), "metrics": metrics,
                                       "regret": None if benchmarks is None else max(0., float(benchmarks[i] - scores[i]))})
        if self.s.profiles[0].probability is not None:
            output["expected_score"] = float(np.array([p.probability for p in self.s.profiles]) @ scores)
        if benchmarks is not None:
            output["maximum_regret"] = max(0., float(max(benchmarks - scores)))
        output["constraints"] = []
        for a, lo, hi, name, _ in self.rows:
            value = float(a @ x)
            output["constraints"].append({"id": name, "value": value,
                                           "lower_slack": None if not math.isfinite(lo) else value - lo,
                                           "upper_slack": None if not math.isfinite(hi) else hi - value})
        return output


def _certified(result):
    return (result["status"] == "optimal" and result.get("x") is not None
            and (result.get("mip_gap") is None or result["mip_gap"] <= 1e-8))


def solve(study: Study | dict, objective: Objective = "worst_case", *, time_limit=30., mip_rel_gap=0.) -> dict:
    s = study if isinstance(study, Study) else Study.model_validate(study)
    if objective not in ("worst_case", "minimax_regret", "expected"):
        raise ValueError("unknown objective")
    if not math.isfinite(time_limit) or time_limit <= 0 or not 0 <= mip_rel_gap <= 0.1:
        raise ValueError("invalid solver limits")
    if objective == "expected" and s.profiles[0].probability is None:
        raise ValueError("expected objective requires explicit profile probabilities")
    started = time.monotonic()
    p = Problem(s, started + time_limit, mip_rel_gap)
    probabilities = None if s.profiles[0].probability is None else np.array([q.probability for q in s.profiles])
    expected_score = None if probabilities is None else probabilities @ p.scores
    # Return the requested plan before optional diagnostics consume its deadline.
    primary = None if objective == "minimax_regret" else p.run(
        "linear" if objective == "expected" else objective, score=expected_score)
    raw_benchmarks, benchmarks = [], []
    if primary is None or primary["status"] != "infeasible":
        for i, prof in enumerate(s.profiles):
            r = p.run("linear", score=p.scores[i]); raw_benchmarks.append(r)
            benchmarks.append({"profile_id": prof.id, **p.detail(r),
                               "profile_optimum": None if r.get("x") is None else float(p.scores[i] @ r["x"])})
            if r["status"] in ("infeasible", "time_limit"):
                break
    all_optimal = len(raw_benchmarks) == len(s.profiles) and all(_certified(r) for r in raw_benchmarks)
    infeasible = ((primary is not None and primary["status"] == "infeasible") or
                  (raw_benchmarks and raw_benchmarks[0]["status"] == "infeasible"))
    bests = np.array([b["profile_optimum"] for b in benchmarks]) if all_optimal else None
    if infeasible:
        relaxed = p.run("worst_case", targets=False)
        result = {"status": "infeasible", "message": "No portfolio meets all stated constraints",
                  "diagnostic_without_gain_targets": p.detail(relaxed)}
    elif objective == "minimax_regret" and not all_optimal:
        result = {"status": "benchmark_incomplete", "message": "Regret requires optimal same-feasible-set profile benchmarks"}
    else:
        if primary is None:
            primary = p.run("minimax_regret", benchmarks=bests)
        result = p.detail(primary, bests)
    voi = None
    if probabilities is not None and all_optimal:
        expected = primary if objective == "expected" else p.run("linear", score=expected_score)
        if _certified(expected):
            perfect = float(probabilities @ bests)
            without = float(expected_score @ expected["x"])
            voi = {"units": "normalized weighted objective units", "perfect_information_score": perfect,
                   "optimal_expected_score": without, "evpi": max(0., perfect - without),
                   "expected_portfolio": p.detail(expected)}
    return {"schema_version": "ecosci.robust-result/1", "study_sha256": canonical_hash(s.model_dump()),
            "title": s.title, "mode": s.mode, "objective": objective,
            "benchmark_basis": "identical feasible set; all-profile guaranteed targets retained",
            "elapsed_seconds": time.monotonic() - started, "result": result,
            "profile_benchmarks": benchmarks, "value_of_information": voi}


def frontier(study: Study | dict, budgets: list[float], objective: Objective = "worst_case", *, time_limit=60.) -> dict:
    s = study if isinstance(study, Study) else Study.model_validate(study)
    if not budgets or any(not math.isfinite(b) or b < 0 for b in budgets):
        raise ValueError("frontier requires nonnegative finite budgets")
    if not math.isfinite(time_limit) or time_limit <= 0:
        raise ValueError("frontier needs a positive finite time limit")
    deadline = time.monotonic() + time_limit
    results = []
    for budget in sorted(set(budgets)):
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            results.append({"budget": budget, "status": "time_limit"})
            continue
        data = s.model_dump(); data["budget"] = budget
        answer = solve(data, objective, time_limit=remaining)
        results.append({"budget": budget, **answer})
    return {"schema_version": "ecosci.robust-frontier/1", "study_sha256": canonical_hash(s.model_dump()), "points": results}
