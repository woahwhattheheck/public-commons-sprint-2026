"""One focused scheduler check with explicit NumPy API doubles, not physics.

Does not import JAX, dfbench or real optax; checks actual candidate control flow.
"""
import importlib.util
from pathlib import Path
import sys
import types
import numpy as np

events = []
clock = [0.0]

class Base:
    def prepare(self, obj, **kwargs):
        events.append("prepare")
        return kwargs.get("random_seed"), 42

class Optimizer:
    def __init__(self, rate):
        self.rate = rate
    def init(self, params):
        return 0
    def update(self, grad, state, params):
        events.append(("update", int(params[0]), state + 1, self.rate))
        return -self.rate * grad, state + 1

dfbench = types.ModuleType("dfbench")
dfbench.Objective = object
dfbench.OptimizationAlgorithm = Base
jax = types.ModuleType("jax")
jax.numpy = np
jax.random = types.SimpleNamespace(split=lambda k: (k + 1, k + 2),
    normal=lambda k, shape, dtype: np.zeros(shape, dtype=dtype))
optax = types.ModuleType("optax")
optax.chain = lambda clip, optimizer: optimizer
optax.clip_by_global_norm = lambda threshold: None
optax.adam = Optimizer
sys.modules.update({"dfbench": dfbench, "jax": jax, "jax.numpy": np, "optax": optax})
spec = importlib.util.spec_from_file_location("candidate", Path(__file__).with_name("submission_sol_restart.py"))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
module.time = types.SimpleNamespace(perf_counter=lambda: clock[0])

class MockObjective:
    power_thresholds = {"detector": 0.01}
    def __init__(self):
        self.calls = []
        self.sample_count = 0
        self.started = False
    def random_params_unbounded(self):
        out = np.array([float(self.sample_count), 0.0])
        self.sample_count += 1
        return out
    def warmup_value_and_grad_aux(self):
        assert not self.started
        events.append("warmup")
    def start_logging(self):
        assert not self.started
        self.started = True
        events.append("start")
    @property
    def evals_left(self):
        return 100 - len(self.calls)
    @property
    def time_left(self):
        return 100.0 - len(self.calls)
    @property
    def budget_exceeded(self):
        return len(self.calls) >= 100
    @property
    def budget_progress_fraction(self):
        return len(self.calls) / 100.0
    def value_and_grad_aux(self, params):
        assert self.started
        self.calls.append(params.copy())
        clock[0] += 1.0
        lane = int(params[0])
        # Lower raw loss is infeasible. Feasible lane3 must anchor polishing.
        loss = -100.0 if lane == 0 else 10.0 if lane == 3 else 20.0
        return np.array(loss), np.array([0.0, 0.1]), {"is_feasible": np.array(lane != 0)}

obj = MockObjective()
algorithm = module.BudgetedRestartPortfolio()
assert algorithm.optimize(obj, random_seed=42, slice_calls=4) is None
diag = algorithm.last_run_diagnostics
assert events[:3] == ["prepare", "warmup", "start"]
assert diag["lane_calls"] == [12, 12, 12, 12, 12], diag
assert [int(p[0]) for p in obj.calls[:20]] == [i for i in range(5) for _ in range(4)]
for lane in range(5):
    states = [e[2] for e in events if isinstance(e, tuple) and e[1] == lane and e[3] == .08]
    assert states == list(range(1, 13)), (lane, states)
assert np.array_equal(obj.calls[60], np.array([3.0, 0.0])), obj.calls[60]
assert diag["polish_started_from_feasible"] is True
assert diag["polish_start_loss"] == 10.0
assert diag["polish_start_progress"] == .60
assert diag["polish_calls"] == 39 and diag["calls"] == 99
assert diag["stopped_predictively"] is True
assert obj.sample_count == 5
assert len(obj.calls) < 100
print("PASS: independent state resumes, five starts visited, exact feasible anchor, phase change and per-call predictive stop; mocked control flow only")
