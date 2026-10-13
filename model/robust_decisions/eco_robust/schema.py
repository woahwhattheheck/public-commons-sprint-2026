from __future__ import annotations
import math
from typing import Literal
from pydantic import BaseModel, ConfigDict, Field, model_validator


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False, validate_default=True)


class Metric(Strict):
    id: str = Field(min_length=1)
    label: str = ""
    units: str = Field(min_length=1)
    scale: float = Field(gt=0)
    weight: float = Field(default=1, ge=0)
    guaranteed_gain: float | None = None


class Candidate(Strict):
    id: str = Field(min_length=1)
    label: str = ""
    cost: float = Field(ge=0)
    capacity: float = Field(default=1, ge=0)
    group: str | None = None
    required: bool = False
    excluded: bool = False
    source: dict = Field(default_factory=dict)


class Profile(Strict):
    id: str = Field(min_length=1)
    label: str = ""
    probability: float | None = Field(default=None, ge=0, le=1)
    source: dict = Field(default_factory=dict)


class Cell(Strict):
    profile_id: str
    candidate_id: str
    gains: dict[str, float]
    source: dict = Field(default_factory=dict)


class Study(Strict):
    schema_version: Literal["ecosci.robust-study/1"] = "ecosci.robust-study/1"
    title: str = Field(min_length=1)
    mode: Literal["native_packages", "additive_actions"] = "native_packages"
    additive_basis: str | None = None
    metrics: list[Metric] = Field(min_length=1)
    candidates: list[Candidate] = Field(min_length=1)
    profiles: list[Profile] = Field(min_length=1)
    cells: list[Cell] = Field(min_length=1)
    budget: float | None = Field(default=None, ge=0)
    cost_units: str = Field(default="USD", min_length=1)
    capacity: float | None = Field(default=None, ge=0)
    group_limits: dict[str, int] = Field(default_factory=dict)
    source: dict = Field(default_factory=dict)
    notes: str = ""

    @model_validator(mode="after")
    def coherent(self):
        for name in ("metrics", "candidates", "profiles"):
            seq = getattr(self, name)
            ids = [x.id for x in seq]
            if len(ids) != len(set(ids)):
                raise ValueError(f"duplicate {name} IDs")
        if not any(m.weight > 0 for m in self.metrics):
            raise ValueError("at least one metric weight must be positive")
        for m in self.metrics:
            if not math.isfinite(m.weight / m.scale):
                raise ValueError(f"non-finite normalization for metric {m.id}")
        if self.mode == "additive_actions" and not (self.additive_basis or "").strip():
            raise ValueError("additive_actions requires the explicit source decomposition/additivity basis")
        if self.mode == "native_packages" and self.group_limits:
            raise ValueError("group_limits belongs to additive_actions; package membership is supplied in source")
        if any(x < 0 for x in self.group_limits.values()):
            raise ValueError("group_limits cannot be negative")
        groups = {c.group for c in self.candidates if c.group is not None}
        if set(self.group_limits) - groups:
            raise ValueError("group_limits references an unknown group")
        if any(c.required and c.excluded for c in self.candidates):
            raise ValueError("a candidate cannot be both required and excluded")
        probabilities = [s.probability for s in self.profiles]
        if any(p is not None for p in probabilities):
            if any(p is None for p in probabilities) or not math.isclose(sum(probabilities), 1, abs_tol=1e-9):
                raise ValueError("probabilities must be supplied for every profile and sum to one")
        expected = {(s.id, c.id) for s in self.profiles for c in self.candidates}
        seen = set()
        metrics = {m.id for m in self.metrics}
        for cell in self.cells:
            key = cell.profile_id, cell.candidate_id
            if key in seen or key not in expected:
                raise ValueError(f"duplicate or unknown profile/candidate pair {key}")
            if set(cell.gains) != metrics:
                raise ValueError(f"pair {key} must contain every metric exactly once")
            if not all(math.isfinite(x) for x in cell.gains.values()):
                raise ValueError(f"non-finite gains in pair {key}")
            seen.add(key)
        if seen != expected:
            missing = sorted(expected - seen)
            raise ValueError(f"missing profile/candidate pairs: {missing[:8]}")
        return self


Objective = Literal["worst_case", "minimax_regret", "expected"]


class SolveRequest(Strict):
    study: Study
    objective: Objective = "worst_case"
    time_limit: float = Field(default=30, gt=0, le=3600)
    mip_rel_gap: float = Field(default=0, ge=0, le=0.1)
