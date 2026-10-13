"""Exact tangent sensitivities, observation fitting and monitoring design.

The supported parameter fields enter the model linearly. Their sparse operator
derivatives are assembled directly from physical coefficients. Tangent ODEs are
propagated with the same matrix exponential as the original state, avoiding
finite-difference perturbation noise in the optimizer's residual Jacobian.
"""
from __future__ import annotations
from copy import deepcopy
from dataclasses import dataclass
from typing import Callable
import math
import time
import numpy as np
from scipy import sparse
from scipy.sparse.linalg import expm_multiply
from scipy.optimize import least_squares
from scipy.stats import norm, triang
from .model import Project, ModelError, number, keyed, records, text
from .solver import Cancelled

KINDS = {"reaction_rate_day": ("reactions", "rate_day"), "load_kg_day": ("loads", "kg_day"),
         "boundary_mg_l": ("flows", "concentration_mg_l"), "initial_kg": ("initial", "kg")}

@dataclass
class Parameters:
    project: Project
    rows: list[dict]
    values: np.ndarray
    lower: np.ndarray
    upper: np.ndarray

    @classmethod
    def parse(cls, project: Project, raw: list[dict]) -> "Parameters":
        by_id = keyed(raw, "parameters", nonempty=True)
        values, lower, upper, targets = [], [], [], set()
        for ident, p in by_id.items():
            kind = p.get("kind")
            if kind not in KINDS:
                raise ModelError(f"parameter {ident}: kind must be one of {list(KINDS)}")
            group, field = KINDS[kind]
            target = text(p.get("target"), f"parameter {ident}.target")
            items = getattr(project, "initials" if group == "initial" else group)
            if target not in items: raise ModelError(f"parameter {ident}: unknown {group} target {target}")
            item = items[target]
            sid = None
            if kind == "boundary_mg_l":
                if item.get("source") is not None:
                    raise ModelError(f"parameter {ident}: boundary concentration needs an external inflow")
                sid = p.get("species"); project.specie(sid)
                value = item.get(field, {}).get(sid, 0.0)
            else: value = item[field]
            key = (kind, target, sid)
            if key in targets: raise ModelError(f"parameter {ident}: duplicate physical parameter {key}")
            targets.add(key)
            lo = number(p.get("lower"), f"parameter {ident}.lower")
            hi = number(p.get("upper"), f"parameter {ident}.upper", positive=True)
            if hi <= lo: raise ModelError(f"parameter {ident}: upper must exceed lower")
            if not lo <= value <= hi: raise ModelError(f"parameter {ident}: current value {value} outside bounds")
            values.append(value); lower.append(lo); upper.append(hi)
        return cls(project, list(by_id.values()), np.asarray(values, float),
                   np.asarray(lower, float), np.asarray(upper, float))

    def assign(self, values: np.ndarray, *, check_bounds: bool = True) -> Project:
        if len(values) != len(self.rows) or not np.isfinite(values).all():
            raise ModelError("parameter vector has wrong length or non-finite values")
        if check_bounds and (np.any(values < self.lower) or np.any(values > self.upper)):
            raise ModelError("parameter vector outside explicit bounds")
        raw = deepcopy(self.project.raw)
        for p, value in zip(self.rows, values):
            group, field = KINDS[p["kind"]]
            item = next(r for r in raw[group] if r["id"] == p["target"])
            if p["kind"] == "boundary_mg_l": item.setdefault(field, {})[p["species"]] = float(value)
            else: item[field] = float(value)
        raw["analysis_overrides"] = [{"id": p["id"], "kind": p["kind"], "target": p["target"],
                                      "species": p.get("species"), "value": float(v), "original": float(o)}
                                     for p, v, o in zip(self.rows, values, self.values)]
        return Project(raw)



def observation_components(p: Project, observation: dict) -> list[tuple[str, float]]:
    """Return the explicitly declared linear concentration operator on one conserved basis."""
    label = f"observation {observation.get('id', '?')}"
    p.reach(observation.get("reach"))
    if "species" in observation:
        if "components" in observation:
            raise ModelError(label + ": choose species or components, not both")
        sid = observation["species"]
        p.specie(sid)
        if observation.get("basis") is not None and observation["basis"] != p.species[sid]["basis"]:
            raise ModelError(label + ": observation basis differs from its species")
        return [(sid, 1.0)]
    text(observation.get("measurement"), label + ".measurement")
    basis = text(observation.get("basis"), label + ".basis")
    components = records(observation.get("components"), label + ".components", nonempty=True)
    result, seen = [], set()
    for component in components:
        sid = component.get("species")
        p.specie(sid)
        if sid in seen:
            raise ModelError(label + ": components must name each original species once")
        if p.species[sid]["basis"] != basis:
            raise ModelError(label + ": every component must use the declared conserved basis")
        weight = number(component.get("weight"), label + ".components.weight", positive=True)
        result.append((sid, weight))
        seen.add(sid)
    return result


def observation_fields(observation: dict) -> dict:
    """Keep the original single-species or complete compound measurement identity."""
    if "species" in observation:
        return {"species": observation["species"]}
    return {"measurement": observation["measurement"], "basis": observation["basis"],
            "components": deepcopy(observation["components"])}


def observation_key(observation: dict) -> tuple:
    """Separate point-error metrics for every explicit original observation operator."""
    if "species" in observation:
        return ("species", observation["species"])
    return ("measurement", observation["measurement"], observation["basis"],
            tuple(sorted((row["species"], float(row["weight"])) for row in observation["components"])))


def _interval(observation: dict) -> tuple[float, float, bool, bool]:
    name = f"observation {observation['id']}"
    lower = number(observation.get("lower_mg_l"), name + ".lower_mg_l")
    upper = number(observation.get("upper_mg_l"), name + ".upper_mg_l")
    if upper <= lower:
        raise ModelError(name + ": interval upper_mg_l must exceed lower_mg_l")
    if not isinstance(observation.get("lower_closed"), bool) or not isinstance(observation.get("upper_closed"), bool):
        raise ModelError(name + ": interval endpoints need explicit lower_closed and upper_closed booleans")
    if observation.get("mg_l") is not None:
        raise ModelError(name + ": an interval observation must not supply a point mg_l")
    return lower, upper, observation["lower_closed"], observation["upper_closed"]


def _interval_contains(value: float, bounds: tuple[float, float, bool, bool]) -> bool:
    lower, upper, lower_closed, upper_closed = bounds
    return bool((value >= lower if lower_closed else value > lower)
                and (value <= upper if upper_closed else value < upper))


def observation_rows(p: Project, raw: list[dict], *, fitting: bool = False) -> list[dict]:
    obs = list(keyed(raw, "observations", nonempty=True).values())
    for o in obs:
        observation_components(p, o)
        t = number(o.get("day"), f"observation {o['id']}.day")
        if t > p.end_day: raise ModelError(f"observation {o['id']}: day exceeds project duration")
        if fitting:
            qualifier = o.get("qualifier", "equal")
            if qualifier not in ("equal", "below", "interval"):
                raise ModelError("observation qualifier must be equal, below or interval")
            if qualifier == "interval":
                _interval(o)
            else:
                number(o.get("mg_l"), f"observation {o['id']}.mg_l")
                if any(key in o for key in ("lower_mg_l", "upper_mg_l", "lower_closed", "upper_closed")):
                    raise ModelError(f"observation {o['id']}: interval bounds require qualifier interval")
            number(o.get("sigma_mg_l"), f"observation {o['id']}.sigma_mg_l", positive=True)
            if o.get("role", "fit") not in ("fit", "holdout"):
                raise ModelError("observation role must be fit or holdout")
            ref = o.get("provenance")
            if not isinstance(ref, dict) or not isinstance(ref.get("reference"), str) or not ref["reference"].strip():
                raise ModelError(f"observation {o['id']}: provenance.reference is required")
    return obs


def tangent_predictions(parameters: Parameters, values: np.ndarray, observations: list[dict], *,
                        cancelled: Callable[[], bool] | None = None) -> tuple[np.ndarray, np.ndarray]:
    p = parameters.assign(np.asarray(values, dtype=float))
    count, n = len(parameters.rows), p.n
    obs = observation_rows(p, observations)
    operators = [[(p.index(o["reach"], sid), weight) for sid, weight in observation_components(p, o)] for o in obs]
    predictions, jac = np.zeros(len(obs)), np.zeros((len(obs), count))
    # [m, dm/dp_1, ..., dm/dp_k, 1]. Initial-condition parameters seed tangents.
    initial_tangents = [np.zeros(n) for _ in parameters.rows]
    for j, parameter in enumerate(parameters.rows):
        if parameter['kind'] == 'initial_kg':
            row=p.initials[parameter['target']]
            initial_tangents[j][p.index(row['reach'],row['species'])]=1.0
    state = np.r_[p.initial, *initial_tangents, 1.0]
    def sample(day):
        for i, o in enumerate(obs):
            if o["day"] == day:
                if "species" in o:
                    idx = operators[i][0][0]; factor = 1000.0 / p.state_volumes[idx]
                    predictions[i] = state[idx] * factor
                    for j in range(count): jac[i, j] = state[(j+1)*n + idx] * factor
                else:
                    for idx, weight in operators[i]:
                        factor = weight * 1000.0 / p.state_volumes[idx]
                        predictions[i] += state[idx] * factor
                        for j in range(count): jac[i, j] += state[(j+1)*n + idx] * factor
    sample(0.0)
    start = 0.0
    for phase in p.phases:
        op = p.compile(phase)
        derivatives = []
        for parameter in parameters.rows:
            rows,cols,data=[],[],[];forcing=np.zeros(n)
            kind,target=parameter['kind'],parameter['target']
            if kind=='reaction_rate_day':
                reaction=p.reactions[target]
                for reach in reaction.get('reach_ids',p.rids):
                    factor=phase.get('reaction_multipliers',{}).get(target,1.0)
                    if 'theta' in reaction:
                        factor*=reaction['theta']**(p.reaches[reach]['temperature_c']-reaction['reference_temperature_c'])
                    source=p.index(reach,reaction['source'])
                    rows.append(source);cols.append(source);data.append(-factor)
                    for species,yield_ in reaction.get('products',{}).items():
                        rows.append(p.index(reach,species));cols.append(source);data.append(factor*yield_)
            elif kind=='load_kg_day':
                load=p.loads[target]
                forcing[p.index(load['reach'],load['species'])]=phase.get('load_multipliers',{}).get(target,1.0)
            elif kind=='boundary_mg_l':
                flow=p.flows[target]
                forcing[p.index(flow['target'],parameter['species'])]=flow['m3_day']*phase.get('flow_multipliers',{}).get(target,1.0)/1000.0
            derivatives.append((sparse.coo_matrix((data,(rows,cols)),shape=(n,n)).tocsc(),forcing))
        blocks = [[None for _ in range(count + 2)] for _ in range(count + 2)]
        blocks[0][0] = op.A
        blocks[0][-1] = sparse.csc_matrix(op.forcing[:, None])
        for j, (derivative_A, derivative_b) in enumerate(derivatives):
            blocks[j+1][j+1] = op.A
            blocks[j+1][0] = derivative_A
            blocks[j+1][-1] = sparse.csc_matrix(derivative_b[:, None])
        for j in range(count+1): blocks[-1][j] = sparse.csc_matrix((1, n))
        blocks[-1][-1] = sparse.csc_matrix((1, 1))
        H = sparse.bmat(blocks, format="csc")
        times = sorted(set([float(o["day"]) for o in obs if start < o["day"] <= phase["until_day"]]
                           + [float(phase["until_day"])]))
        now = start
        for end in times:
            if cancelled and cancelled(): raise Cancelled("tangent calculation cancelled")
            dt = end - now
            state = expm_multiply(H * dt, state, traceA=float(op.A.diagonal().sum()) * (count+1) * dt)
            if not np.isfinite(state).all(): raise ArithmeticError("non-finite tangent result")
            sample(end); now = end
        start = float(phase["until_day"])
    return predictions, jac


def sensitivity(project: dict | Project, parameter_rows: list[dict], observations: list[dict], *, cancelled=None) -> dict:
    p = Project(project) if isinstance(project, dict) else project
    parameters = Parameters.parse(p, parameter_rows)
    obs = observation_rows(p, observations)
    predicted, jac = tangent_predictions(parameters, parameters.values, obs, cancelled=cancelled)
    rows = []
    for i, o in enumerate(obs):
        rows.append({"observation": o, "predicted_mg_l": float(predicted[i]),
                     "derivatives": [{"parameter": q["id"], "parameter_kind": q["kind"],
                                      "mg_l_per_parameter_unit": float(jac[i, j]),
                                      "elasticity": float(jac[i,j]*parameters.values[j]/predicted[i]) if predicted[i] != 0 else None}
                                     for j, q in enumerate(parameters.rows)]})
    return {"schema": "reach-chemistry-sensitivity/1", "project_sha256": p.fingerprint,
            "method": "forward tangent equations with sparse matrix exponential",
            "parameters": parameters.rows, "rows": rows}


def fit_observations(project: dict | Project, parameter_rows: list[dict], observation_data: list[dict], *,
                     loss: str = "linear", max_evaluations: int = 200, cancelled=None, progress=None) -> dict:
    started = time.perf_counter()
    p = Project(project) if isinstance(project, dict) else project
    pars = Parameters.parse(p, parameter_rows)
    obs = observation_rows(p, observation_data, fitting=True)
    fit_indices = np.asarray([i for i, o in enumerate(obs) if o.get("role", "fit") == "fit"], int)
    if len(fit_indices) < len(pars.rows):
        raise ModelError("fit observations must number at least the fitted parameters")
    if loss not in ("linear", "soft_l1", "huber"):
        raise ModelError("loss must be linear, soft_l1 or huber")
    if isinstance(max_evaluations, bool) or not isinstance(max_evaluations, int) or max_evaluations < 1:
        raise ModelError("max_evaluations must be a positive integer")
    intervals = {i: _interval(o) for i, o in enumerate(obs) if o.get("qualifier") == "interval"}
    measured = np.asarray([o.get("mg_l", 0.0) if i not in intervals else 0.0 for i, o in enumerate(obs)], float)
    sigma = np.asarray([o["sigma_mg_l"] for o in obs], float)
    censored = np.asarray([o.get("qualifier") == "below" for o in obs])
    cache_x = None; cache_y = None; cache_j = None; evaluations = 0
    def evaluate(x):
        nonlocal cache_x, cache_y, cache_j, evaluations
        if cancelled and cancelled(): raise Cancelled("observation fit cancelled")
        if cache_x is None or not np.array_equal(x, cache_x):
            cache_y, cache_j = tangent_predictions(pars, x, obs, cancelled=cancelled)
            cache_x = x.copy(); evaluations += 1
            if progress: progress({"stage": "calibration", "evaluations": evaluations})
        r = (cache_y - measured)/sigma
        J = cache_j/sigma[:, None]
        inactive = censored & (cache_y <= measured)
        r = r.copy(); J = J.copy(); r[inactive] = 0; J[inactive] = 0
        # Distance to the interval closure has no fabricated midpoint or epsilon.
        # Membership of open endpoints is retained separately in the result.
        for i, (lower, upper, unused_lower_closed, unused_upper_closed) in intervals.items():
            if cache_y[i] < lower:
                r[i] = (cache_y[i] - lower) / sigma[i]
            elif cache_y[i] > upper:
                r[i] = (cache_y[i] - upper) / sigma[i]
            else:
                r[i] = 0.0
                J[i] = 0.0
        return r, J
    optimization = least_squares(lambda x: evaluate(x)[0][fit_indices], pars.values,
                                 jac=lambda x: evaluate(x)[1][fit_indices],
                                 bounds=(pars.lower, pars.upper), loss=loss, x_scale="jac",
                                 max_nfev=max_evaluations, ftol=1e-10, xtol=1e-10, gtol=1e-10)
    residual, weighted_jac = evaluate(optimization.x)
    sv = np.linalg.svd(weighted_jac[fit_indices], compute_uv=False)
    threshold = max(weighted_jac[fit_indices].shape) * np.finfo(float).eps * (sv[0] if len(sv) else 0)
    rank = int((sv > threshold).sum())
    full_rank = rank == len(pars.rows)
    rows = []
    for i, o in enumerate(obs):
        row = {"id": o["id"], "reach": o["reach"], **observation_fields(o), "day": o["day"],
               "role": o.get("role", "fit"), "qualifier": o.get("qualifier", "equal"),
               "observed_mg_l": None if i in intervals else o["mg_l"],
               "predicted_mg_l": float(cache_y[i]), "sigma_mg_l": o["sigma_mg_l"],
               "weighted_residual": float(residual[i]), "provenance": o["provenance"]}
        if i in intervals:
            row.update({name: o[name] for name in ("lower_mg_l", "upper_mg_l", "lower_closed", "upper_closed")})
            row["interval_contains_prediction"] = _interval_contains(float(cache_y[i]), intervals[i])
        rows.append(row)
    scores = []
    # Preserve original single-species ordering; append complete compound operators.
    identities = [{"species": sid} for sid in p.sids]
    seen = {observation_key(row) for row in identities}
    for row in obs:
        key = observation_key(row)
        if key not in seen:
            identities.append(observation_fields(row)); seen.add(key)
    for role in ("fit", "holdout"):
        for identity in identities:
            selected = [r for r in rows if r["role"] == role and observation_key(r) == observation_key(identity)
                        and r["qualifier"] == "equal"]
            if selected:
                errors = np.asarray([r["predicted_mg_l"] - r["observed_mg_l"] for r in selected])
                scores.append({"role": role, **identity, "count": len(selected),
                               "rmse_mg_l": float(np.sqrt(np.mean(errors**2))), "bias_mg_l": float(errors.mean())})
    interval_scores = []
    for role in ("fit", "holdout"):
        for identity in identities:
            selected = [r for r in rows if r["role"] == role and observation_key(r) == observation_key(identity)
                        and r["qualifier"] == "interval"]
            if selected:
                interval_scores.append({"role": role, **identity, "count": len(selected),
                    "predictions_within_declared_interval": sum(r["interval_contains_prediction"] for r in selected),
                    "weighted_distance_to_interval_rmse": float(np.sqrt(np.mean(
                        [r["weighted_residual"] ** 2 for r in selected])))})
    calibrated = pars.assign(optimization.x)
    return {"schema": "reach-chemistry-calibration/1", "original_project_sha256": p.fingerprint,
            "calibrated_project_sha256": calibrated.fingerprint, "calibrated_project": calibrated.raw,
            "converged": bool(optimization.success), "termination": str(optimization.message),
            "loss": loss, "objective": float(optimization.cost), "evaluations": evaluations,
            "parameters": [{**q, "original": float(original), "fitted": float(v),
                            "active_bound": int(bound)} for q, original, v, bound in
                           zip(pars.rows, pars.values, optimization.x, optimization.active_mask)],
            "observations": rows, "scores": scores,
            **({"interval_scores": interval_scores, "interval_loss":
                "Signed distance to the interval closure divided by sigma_mg_l; zero in the closure. "
                "Open/closed endpoint membership is reported separately; no midpoint or epsilon is substituted."}
               if intervals else {}),
            "identifiability": {"method": "local weighted residual Jacobian SVD",
                                "rank": rank, "parameters": len(pars.rows), "full_rank": full_rank,
                                "singular_values": sv.tolist(),
                                "condition_number": float(sv[0]/sv[-1]) if full_rank and sv[-1] > 0 else None,
                                "interpretation": "Local identifiability at this fit; no confidence intervals are inferred."},
            "elapsed_seconds": time.perf_counter() - started}


def design_monitoring(project: dict | Project, parameter_rows: list[dict], candidates: list[dict], *,
                      count: int, prior_precision: list[list[float]], cancelled=None) -> dict:
    """Greedy local D-optimal selection; supplied prior fixes parameter scaling."""
    p = Project(project) if isinstance(project, dict) else project
    pars = Parameters.parse(p, parameter_rows)
    obs = observation_rows(p, candidates)
    if isinstance(count, bool) or not isinstance(count, int) or not 1 <= count <= len(obs):
        raise ModelError("count must be between 1 and the number of candidate observations")
    for o in obs: number(o.get("sigma_mg_l"), f"candidate {o['id']}.sigma_mg_l", positive=True)
    precision = np.asarray(prior_precision, float)
    k = len(pars.rows)
    if precision.shape != (k, k) or not np.isfinite(precision).all() or not np.allclose(precision, precision.T):
        raise ModelError("prior_precision must be a finite symmetric parameter-by-parameter matrix")
    try: np.linalg.cholesky(precision)
    except np.linalg.LinAlgError as exc: raise ModelError("prior_precision must be positive definite") from exc
    predicted, J = tangent_predictions(pars, pars.values, obs, cancelled=cancelled)
    J = J / np.asarray([o["sigma_mg_l"] for o in obs])[:, None]
    selected = []; available = set(range(len(obs)))
    baseline_logdet = float(np.linalg.slogdet(precision)[1])
    for step in range(count):
        if cancelled and cancelled(): raise Cancelled("monitoring design cancelled")
        # determinant lemma log det(P+j'j)-log det(P)=log1p(j P^-1 j').
        gains = {i: float(np.log1p(J[i] @ np.linalg.solve(precision, J[i]))) for i in available}
        best = max(sorted(available), key=lambda i: gains[i])
        if gains[best] <= np.finfo(float).eps:
            break
        selected.append({"candidate": obs[best], "predicted_mg_l": float(predicted[best]),
                         "incremental_logdet_gain": gains[best], "order": step+1})
        precision = precision + np.outer(J[best], J[best]); available.remove(best)
    return {"schema": "reach-chemistry-monitoring-design/1", "project_sha256": p.fingerprint,
            "method": "greedy local D-optimal selection with explicit prior precision",
            "parameters": pars.rows, "prior_precision": prior_precision,
            "selected": selected, "remaining_candidate_ids": [obs[i]["id"] for i in sorted(available)],
            "posterior_linearized_precision": precision.tolist(),
            "total_logdet_gain": float(np.linalg.slogdet(precision)[1]) - baseline_logdet}


def uncertainty(project: dict | Project, parameter_rows: list[dict], observations: list[dict], *,
                draws: int, seed: int, distributions: list[dict], correlation: list[list[float]] | None = None,
                cancelled=None, progress=None) -> dict:
    """Explicit-prior Gaussian-copula parameter ensemble, without truncating runs."""
    p = Project(project) if isinstance(project, dict) else project
    pars = Parameters.parse(p, parameter_rows)
    obs = observation_rows(p, observations)
    if isinstance(draws, bool) or not isinstance(draws, int) or draws < 2:
        raise ModelError("draws must be an integer >=2")
    if isinstance(seed, bool) or not isinstance(seed, int) or seed < 0:
        raise ModelError("seed must be a nonnegative integer")
    dists = keyed(distributions, "distributions", nonempty=True)
    if set(dists) != {r["id"] for r in pars.rows}:
        raise ModelError("provide exactly one distribution for each parameter id")
    k = len(pars.rows)
    C = np.eye(k) if correlation is None else np.asarray(correlation, float)
    if C.shape != (k, k) or not np.isfinite(C).all() or not np.allclose(C, C.T, atol=1e-12) or not np.allclose(np.diag(C), 1.0):
        raise ModelError("correlation must be a finite symmetric matrix with unit diagonal")
    w, Q = np.linalg.eigh(C)
    if w.min() < -1e-10: raise ModelError("correlation must be positive semidefinite")
    rng = np.random.default_rng(seed)
    z = rng.standard_normal((draws, k)) @ (Q * np.sqrt(np.maximum(w, 0))).T
    u = np.clip(norm.cdf(z), np.finfo(float).eps, 1 - np.finfo(float).eps)
    values = np.zeros_like(u)
    for j, par in enumerate(pars.rows):
        d = dists[par["id"]]; lo, hi = pars.lower[j], pars.upper[j]
        if d.get("kind") == "uniform": values[:,j] = lo + u[:,j]*(hi-lo)
        elif d.get("kind") == "loguniform":
            if lo <= 0: raise ModelError("loguniform requires a strictly positive lower bound")
            values[:,j] = np.exp(np.log(lo) + u[:,j]*(np.log(hi)-np.log(lo)))
        elif d.get("kind") == "triangular":
            mode = number(d.get("mode"), f"distribution {par['id']}.mode")
            if not lo <= mode <= hi: raise ModelError("triangular mode must lie inside parameter bounds")
            values[:,j] = triang.ppf(u[:,j], (mode-lo)/(hi-lo), loc=lo, scale=hi-lo)
        else: raise ModelError("distribution kind must be uniform, loguniform or triangular")
    # Predictions only: ensemble does not need to propagate parameter tangents.
    from .solver import simulate
    endpoints = sorted(set(o["day"] for o in obs))
    components = [observation_components(p, o) for o in obs]
    targets = list({(o["reach"], sid): {"reach": o["reach"], "species": sid}
                    for o, group in zip(obs, components) for sid, unused_weight in group}.values())
    outputs = np.zeros((draws, len(obs)))
    maximum_budget_residual = 0.0
    for i in range(draws):
        run = simulate(pars.assign(values[i]), endpoints, targets=targets, cancelled=cancelled)
        result = run.result()
        lookup = {(s["day"], r["reach"], r["species"]): r["mg_l"] for s in result["samples"] for r in s["values"]}
        outputs[i] = [lookup[(o["day"], o["reach"], o["species"])] if "species" in o else
                      sum(weight * lookup[(o["day"], o["reach"], sid)] for sid, weight in group)
                      for o, group in zip(obs, components)]
        maximum_budget_residual = max(maximum_budget_residual, max(abs(b["relative_residual"]) for b in result["budgets"]))
        if progress: progress({"stage": "uncertainty", "completed": i+1, "total": draws})
    q = np.quantile(outputs, [0.05, 0.5, 0.95], axis=0)
    return {"schema": "reach-chemistry-uncertainty/1", "project_sha256": p.fingerprint,
            "seed": seed, "draw_count": draws, "parameters": pars.rows,
            "distributions": distributions, "latent_gaussian_correlation": C.tolist(),
            "interpretation": "Empirical parameter-ensemble quantiles under the supplied priors; not observational confidence intervals.",
            "summaries": [{"observation": o, "p05_mg_l": float(q[0,j]), "median_mg_l": float(q[1,j]),
                           "p95_mg_l": float(q[2,j]), "mean_mg_l": float(outputs[:,j].mean())}
                          for j, o in enumerate(obs)],
            "parameter_draws": values.tolist(), "prediction_draws_mg_l": outputs.tolist(),
            "maximum_relative_budget_residual": maximum_budget_residual}
