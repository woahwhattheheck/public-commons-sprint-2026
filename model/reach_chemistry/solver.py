"""Sparse exact-in-time propagation for piecewise-constant linear transport.

Every step advances both mass and its time integral in ONE augmented matrix
exponential. Outlet loads and reaction extents use that integral, rather than
endpoint or trapezoidal approximations. Time integration is subject to the
floating-point tolerance of scipy.sparse.linalg.expm_multiply.
"""
from __future__ import annotations
from dataclasses import dataclass
from collections import defaultdict
from typing import Callable
import time
import numpy as np
from scipy import sparse
from scipy.sparse.linalg import expm_multiply
from .model import Project, ModelError, Operator, number, canonical_bytes
from hashlib import sha256

class Cancelled(RuntimeError):
    pass

@dataclass
class Trajectory:
    project: Project
    samples: list[dict]
    final_mass: np.ndarray
    outlet_kg: np.ndarray
    input_kg: np.ndarray
    reaction_extents: dict[tuple[str, str], float]
    reaction_records: dict[tuple[str, str], dict]
    min_mass: float
    elapsed_seconds: float
    step_count: int
    input_tag: str | None

    def result(self) -> dict:
        p = self.project
        initial = p.initial if self.input_tag in (None, "__initial__") else np.zeros(p.n)
        initial_b, input_b = p.basis_sum(initial), p.basis_sum(self.input_kg)
        storage_b, outlet_b = p.basis_sum(self.final_mass), p.basis_sum(self.outlet_kg)
        lost = dict.fromkeys(p.bases, 0.0)
        reactions = []
        for key, extent in self.reaction_extents.items():
            rec = self.reaction_records[key]
            sink = extent * rec["sink_fraction"]
            lost[rec["basis"]] += sink
            reactions.append({"reaction": key[0], "reach": key[1], "source": rec["source"],
                              "basis": rec["basis"], "processed_kg": extent,
                              "products_kg": {s: extent * y for s, y in rec["products"].items()},
                              "untracked_sink_kg": sink, "sink_label": rec["sink_label"]})
        budgets = []
        for b in p.bases:
            supplied = initial_b[b] + input_b[b]
            accounted = storage_b[b] + outlet_b[b] + lost[b]
            residual = supplied - accounted
            budgets.append({"basis": b, "initial_kg": initial_b[b], "input_kg": input_b[b],
                            "final_storage_kg": storage_b[b], "boundary_export_kg": outlet_b[b],
                            "untracked_reaction_sink_kg": lost[b], "residual_kg": residual,
                            "relative_residual": residual / max(1.0, abs(supplied), abs(accounted))})
        # Never normalize away a scientific model or unit error.
        if any(abs(x["relative_residual"]) > 1e-8 for x in budgets):
            raise ArithmeticError(f"mass conservation tolerance exceeded: {budgets}")
        return {"schema": "reach-chemistry-result/1", "title": p.title,
                "project_sha256": p.fingerprint, "duration_days": p.end_day, "input_tag": self.input_tag,
                "model": {"form": "piecewise-constant fixed-volume completely-mixed reach network",
                          "time_solver": "sparse augmented matrix exponential", "reaches": p.nr,
                          "species": p.ns, "states": p.n, "steps": self.step_count},
                "final": p.state_rows(self.final_mass), "samples": self.samples,
                "boundary_export_by_state": [{"reach": row["reach"], "species": row["species"],
                                               "basis": row["basis"], "kg": float(self.outlet_kg[i])}
                                              for i, row in enumerate(p.state_rows(self.final_mass))],
                "reactions": reactions, "budgets": budgets,
                "water_balances": [{"until_day": phase["until_day"], "reaches": p.check_water(phase)}
                                   for phase in p.phases],
                "numerics": {"minimum_mass_kg": self.min_mass, "elapsed_seconds": self.elapsed_seconds},
                "provenance": {"project": p.raw.get("provenance"),
                               "coefficient_sources": {"reactions": p.raw.get("reactions", []),
                                                       "loads": p.raw.get("loads", [])}}}

def validate_times(p: Project, times: list[float] | None) -> list[float]:
    values = [0.0, p.end_day] if times is None else list(times)
    if not values:
        raise ModelError("sample_days must not be empty")
    values = sorted(set(number(t, "sample_days") for t in values))
    if values[-1] > p.end_day:
        raise ModelError("sample day exceeds final phase")
    return values

def propagate(A: sparse.csc_matrix, b: np.ndarray, mass: np.ndarray, dt: float) -> tuple[np.ndarray, np.ndarray]:
    n = mass.size
    # [A 0 b; I 0 0; 0 0 0] carries m(t), integral(m), and constant 1.
    H = sparse.bmat([[A, None, sparse.csc_matrix(b[:, None])],
                     [sparse.eye(n, format="csc"), sparse.csc_matrix((n, n)), sparse.csc_matrix((n, 1))],
                     [sparse.csc_matrix((1, n)), sparse.csc_matrix((1, n)), sparse.csc_matrix((1, 1))]], format="csc")
    y = np.r_[mass, np.zeros(n), 1.0]
    out = expm_multiply(H * dt, y, traceA=float(A.diagonal().sum()) * dt)
    if not np.isfinite(out).all():
        raise ArithmeticError("non-finite integration result; review units and parameter ranges")
    return np.asarray(out[:n]), np.asarray(out[n:2*n])

def simulate(project: Project | dict, sample_days: list[float] | None = None, *,
             targets: list[dict] | None = None, input_tag: str | None = None,
             cancelled: Callable[[], bool] | None = None,
             progress: Callable[[dict], None] | None = None,
             resume: dict | None = None, checkpoint: Callable[[dict], None] | None = None) -> Trajectory:
    started = time.perf_counter()
    p = Project(project) if isinstance(project, dict) else project
    times = validate_times(p, sample_days)
    targets = targets if targets is not None else [{"reach": r, "species": s} for r in p.rids for s in p.sids]
    indexes = [p.index(t.get("reach"), t.get("species")) for t in targets]
    mass = p.initial.copy() if input_tag in (None, "__initial__") else np.zeros(p.n)
    inputs, exports = np.zeros(p.n), np.zeros(p.n)
    extents: dict[tuple, float] = defaultdict(float)
    records = {}
    samples = []
    minimum = float(mass.min())
    step = 0
    resume_day = 0.0
    previous_elapsed = 0.0
    signature = sha256(canonical_bytes({"project": p.fingerprint, "times": times,
                                       "targets": targets, "input_tag": input_tag})).hexdigest()
    if resume is not None:
        if resume.get("signature") != signature:
            raise ModelError("checkpoint belongs to a different project or output selection")
        resume_day = number(resume.get("day"), "checkpoint.day")
        allowed = set(times + [0.0] + [float(ph["until_day"]) for ph in p.phases])
        if resume_day not in allowed or resume_day > p.end_day:
            raise ModelError("checkpoint is not at a completed event boundary")
        def vector(name):
            value = np.asarray(resume[name], float)
            if value.shape != (p.n,) or not np.isfinite(value).all():
                raise ModelError(f"invalid checkpoint {name}")
            return value.copy()
        mass, inputs, exports = vector("mass"), vector("inputs"), vector("exports")
        extents = defaultdict(float, {(v["reaction"], v["reach"]): float(v["kg"]) for v in resume["extents"]})
        records = {(r["id"], r["reach"]): r for r in resume["reaction_records"]}
        samples = list(resume["samples"])
        minimum, step = float(resume["minimum_mass"]), int(resume["steps"])
        previous_elapsed = float(resume.get("elapsed_seconds", 0))
    def sample(day: float):
        samples.append({"day": day, "values": [{"reach": t["reach"], "species": t["species"],
                                                 "basis": p.species[t["species"]]["basis"],
                                                 "kg": float(mass[j]),
                                                 "mg_l": float(mass[j] * 1000 / p.state_volumes[j])}
                                                for t, j in zip(targets, indexes)]})
    if resume is None and 0.0 in times: sample(0.0)
    start = 0.0
    for phase in p.phases:
        if phase["until_day"] <= resume_day:
            start = float(phase["until_day"])
            continue
        op = p.compile(phase)
        b = op.forcing
        if input_tag is not None:
            b = np.zeros(p.n)
            for index, amount in op.forcing_by_tag.get(input_tag, {}).items():
                b[index] = amount
        endpoints = sorted(set([t for t in times if start < t <= phase["until_day"]] + [float(phase["until_day"])]))
        day = max(start, resume_day)
        for end in endpoints:
            if end <= day: continue
            if cancelled is not None and cancelled(): raise Cancelled("reach chemistry run cancelled")
            dt = end - day
            mass, integral = propagate(op.A, b, mass, dt)
            minimum = min(minimum, float(mass.min()))
            tolerance = 1e-10 * max(1.0, float(np.max(np.abs(mass))))
            if float(mass.min()) < -tolerance:
                raise ArithmeticError(f"negative modeled mass {minimum} exceeds roundoff tolerance")
            # Preserve small numerical residuals; do not clip/renormalize state.
            inputs += b * dt
            exports += op.external_rate * integral
            for rec in op.reactions:
                key = (rec["id"], rec["reach"])
                extents[key] += float(rec["rate_day"] * integral[rec["source_index"]])
                records[key] = rec
            day = end; step += 1
            if end in times: sample(end)
            if checkpoint is not None:
                checkpoint({"schema": "reach-chemistry-checkpoint/1", "signature": signature,
                            "day": end, "mass": mass.tolist(), "inputs": inputs.tolist(), "exports": exports.tolist(),
                            "extents": [{"reaction": key[0], "reach": key[1], "kg": kg} for key, kg in extents.items()],
                            "reaction_records": list(records.values()), "samples": samples,
                            "minimum_mass": minimum, "steps": step,
                            "elapsed_seconds": previous_elapsed + time.perf_counter() - started})
            if progress is not None:
                progress({"stage": "transport", "day": end, "duration_days": p.end_day, "step": step})
        start = float(phase["until_day"])
    return Trajectory(p, samples, mass, exports, inputs, dict(extents), records,
                      minimum, previous_elapsed + time.perf_counter() - started, step, input_tag)

def attribute_sources(project: Project | dict, sample_days: list[float] | None = None, *,
                      targets: list[dict] | None = None, cancelled=None, progress=None) -> dict:
    p = Project(project) if isinstance(project, dict) else project
    tags = set()
    for phase in p.phases: tags.update(p.compile(phase).forcing_by_tag)
    if np.any(p.initial): tags.add("__initial__")
    baseline = simulate(p, sample_days, targets=targets, cancelled=cancelled)
    total_m, total_out = np.zeros(p.n), np.zeros(p.n)
    components = []
    for ordinal, tag in enumerate(sorted(tags)):
        traced = simulate(p, sample_days, targets=targets, input_tag=tag, cancelled=cancelled)
        total_m += traced.final_mass; total_out += traced.outlet_kg
        components.append({"source_tag": tag, "result": traced.result()})
        if progress: progress({"stage": "source_attribution", "completed": ordinal + 1, "total": len(tags)})
    abs_error = float(max(np.max(np.abs(total_m - baseline.final_mass)),
                          np.max(np.abs(total_out - baseline.outlet_kg))))
    scale = max(1.0, float(np.max(np.abs(baseline.final_mass))), float(np.max(np.abs(baseline.outlet_kg))))
    if abs_error > scale * 1e-8:
        raise ArithmeticError("source contributions fail superposition closure")
    return {"schema": "reach-chemistry-attribution/1", "project_sha256": p.fingerprint,
            "baseline": baseline.result(), "sources": components,
            "closure": {"maximum_absolute_error_kg": abs_error, "relative_error": abs_error / scale}}
