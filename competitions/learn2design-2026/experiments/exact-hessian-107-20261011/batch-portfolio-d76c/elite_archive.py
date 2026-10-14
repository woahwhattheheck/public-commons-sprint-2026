"""Fixed-memory, feasibility-only archive for Learn2Design restarts.

Coordinates are unbounded Objective vectors. Diversity is measured in unit
coordinates using Objective's documented default sigmoid mapping. The caller
must pass genuine Objective feasibility; this module never runs physics.
"""
from __future__ import annotations
from dataclasses import dataclass
import math
import numpy as np

@dataclass(frozen=True)
class _Elite:
    vector: np.ndarray
    unit: np.ndarray
    loss: float
    step: int

class FeasibleEliteArchive:
    """Keep the best feasible point and up to capacity-1 diverse basins.

    Vector bytes never exceed 16 * capacity * n_params, independent of calls.
    """
    def __init__(self, capacity: int = 8, min_rms: float = 0.04):
        if type(capacity) is not int or not 2 <= capacity <= 64:
            raise ValueError("invalid archive capacity")
        if not math.isfinite(min_rms) or not 0 < min_rms < 1:
            raise ValueError("invalid unit-space radius")
        self.capacity, self.min_rms = capacity, float(min_rms)
        self.entries: list[_Elite] = []
        self.dimension: int | None = None
        self.offers = self.kept = self.duplicates = self.infeasible = 0

    @staticmethod
    def unit(x):
        z = np.clip(x, -36.0, 36.0)
        return 1.0 / (1.0 + np.exp(-z))

    @staticmethod
    def distance(a, b):
        return float(np.sqrt(np.mean((a - b) ** 2)))

    def offer(self, params, loss: float, *, feasible: bool, step: int):
        self.offers += 1
        if not feasible:
            self.infeasible += 1
            return False
        if not math.isfinite(float(loss)) or type(step) is not int or step < 0:
            return False
        try:
            x = np.array(params, dtype=np.float64, copy=True).reshape(-1)
        except (TypeError, ValueError, OverflowError):
            return False
        if not x.size or not np.all(np.isfinite(x)):
            return False
        if self.dimension is None:
            self.dimension = x.size
        elif x.size != self.dimension:
            raise ValueError("archive vector dimension changed")
        u = self.unit(x)
        item = _Elite(x, u, float(loss), step)
        for i, e in enumerate(self.entries):
            if self.distance(u, e.unit) < self.min_rms:
                if (item.loss, item.step) < (e.loss, e.step):
                    self.entries[i] = item
                    self.entries.sort(key=lambda z: (z.loss, z.step))
                    self.duplicates += 1
                    return True
                return False
        if len(self.entries) < self.capacity:
            self.entries.append(item)
        elif (item.loss, item.step) < (self.entries[-1].loss, self.entries[-1].step):
            self.entries[-1] = item
        else:
            return False
        self.entries.sort(key=lambda z: (z.loss, z.step))
        self.kept += 1
        return True

    @property
    def size(self):
        return len(self.entries)

    @property
    def vector_bytes(self):
        return sum(e.vector.nbytes + e.unit.nbytes for e in self.entries)

    def best(self):
        return self.entries[0].vector.copy() if self.entries else None

    def choose_distant(self, reference):
        # Reserve best for quiet finishing. Distinct secondary elites seed
        # alternating source-native restarts, preserving original random restarts.
        if len(self.entries) < 2:
            return None
        x = np.asarray(reference, dtype=np.float64).reshape(-1)
        if x.size != self.dimension or not np.all(np.isfinite(x)):
            return None
        u = self.unit(x)
        e = max(self.entries[1:],
                key=lambda z: (self.distance(u, z.unit), -z.loss, -z.step))
        return e.vector.copy()

    def evict_near(self, params):
        if not self.entries:
            return
        x = np.asarray(params, dtype=np.float64).reshape(-1)
        if x.size == self.dimension and np.all(np.isfinite(x)):
            u = self.unit(x)
            self.entries = [e for e in self.entries
                            if self.distance(u, e.unit) >= self.min_rms]

    def summary(self):
        return {
            "capacity": self.capacity, "size": self.size,
            "dimension": self.dimension, "vector_bytes": self.vector_bytes,
            "max_vector_bytes": 0 if self.dimension is None
                                  else 16 * self.capacity * self.dimension,
            "best_feasible_loss": self.entries[0].loss if self.entries else None,
            "offers": self.offers, "kept": self.kept,
            "duplicate_improvements": self.duplicates, "infeasible": self.infeasible,
        }
