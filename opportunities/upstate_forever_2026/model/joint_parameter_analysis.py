"""Analyse retained joint samples against completed original native experiments.

No simulator, sampler, calibrated probabilities, Sobol indices or hypothesis
tests are introduced here. Every result keeps its exact raster support and
sample membership; incomplete designs remain visibly incomplete.
"""
from __future__ import annotations

from collections import defaultdict
import csv
import html
import io
import math

from .common import canonical, digest, identifier, read_json

SCHEMA = "upstate.joint-parameter-analysis/v1"
DEFINITION_SCHEMA = "upstate.joint-parameter-definition/v1"
LINK_SCHEMA = "upstate.joint-parameter-experiment/v1"
METHOD = "scipy-latin-hypercube-independent-marginals/1"
OUTCOMES = {
    "alternative_total": "Annual delivered export",
    "reduction": "Export reduction (baseline minus alternative)",
    "relative_change_pct": "Export change relative to baseline",
}
REFERENCES = [
    {"title": "SciPy LatinHypercube: stratification and randomized designs",
     "url": "https://docs.scipy.org/doc/scipy/reference/generated/scipy.stats.qmc.LatinHypercube.html"},
    {"title": "Sandia Dakota 6.13 User’s Manual, section 5.2: raw, partial and rank correlations",
     "url": "https://www.sandia.gov/app/uploads/sites/241/2023/03/Users-6.13.0.pdf#page=77"},
    {"title": "NIST: response surface model hierarchy and lack of fit",
     "url": "https://www.itl.nist.gov/div898/handbook/pri/section4/pri473.htm"},
]
INTERPRETATION = [
    "Inputs are the explicitly sourced sampling ranges, not calibrated priors.",
    "Each scenario, pollutant, replicate, native unit, producing-version cohort and exact paired-cell support is analysed separately.",
    "Observed runtime versions and requested-only legacy declarations remain labelled and are not pooled.",
    "The unsampled reference profile is not added to the sampled population.",
    "Missing and failed runs are retained; a completed subset is not a new Latin hypercube.",
    "Correlations and fitted interaction terms describe these native outputs within the chosen ranges; they are not causal effects or Sobol variance fractions.",
    "No IID row-bootstrap interval, hypothesis-test p-value or calibrated confidence interval is reported for a single Latin hypercube.",
    "Independent replicate results remain separate; variation between seeds describes design sensitivity, not environmental or calibration uncertainty.",
    "Nitrogen and phosphorus are annual delivered mass in kg/year; sediment is tonnes/year. These are not intake concentrations.",
]


def _finite(value):
    return not isinstance(value, bool) and isinstance(value, (int, float)) and math.isfinite(value)


def _required(value, label):
    if not isinstance(value, str) or not value.strip():
        raise ValueError("Missing " + label)
    return value


def _same_number(a, b):
    return _finite(a) and _finite(b) and math.isclose(a, b, rel_tol=2e-12, abs_tol=1e-14)


def _check_definition(definition, sample_map, summary, study_id):
    if definition.get("schema") != DEFINITION_SCHEMA or definition.get("method") != METHOD:
        raise ValueError("Unsupported retained joint sampling definition")
    actual_id = digest(definition)
    if study_id is not None and actual_id != identifier(study_id):
        raise ValueError("The frozen joint definition changed")
    spec = definition["specification"]
    axes = spec["axes"]
    samples = definition["samples"]
    baseline = definition["baseline"]
    if not axes or not samples:
        raise ValueError("The joint study has no axes or saved samples")
    axis_ids = [axis["id"] for axis in axes]
    if len(set(axis_ids)) != len(axis_ids):
        raise ValueError("Duplicate sampled axis ID")
    paths = set()
    for axis in axes:
        _required(axis["id"], "axis ID")
        _required(axis["units"], "axis units")
        _required(axis["reason"], "axis source rationale")
        if (axis["distribution"] not in ("uniform", "log-uniform")
                or not _finite(axis["lower"]) or not _finite(axis["upper"])
                or axis["lower"] >= axis["upper"]
                or (axis["distribution"] == "log-uniform" and axis["lower"] <= 0)):
            raise ValueError("Invalid sourced sampling range")
        if not isinstance(axis["paths"], list) or not axis["paths"]:
            raise ValueError("Missing native paths for an axis")
        for path in axis["paths"]:
            _required(path, "native parameter path")
            if path in paths:
                raise ValueError("A native parameter belongs to two axes")
            paths.add(path)
    replicates = {row["id"]: row for row in spec["replicates"]}
    if len(replicates) != len(spec["replicates"]):
        raise ValueError("Duplicate replicate ID")
    if len({rep["seed"] for rep in replicates.values()}) != len(replicates):
        raise ValueError("Independent replicate seeds must be distinct")
    sample_ids = [sample["id"] for sample in samples]
    if len(set(sample_ids)) != len(sample_ids):
        raise ValueError("Duplicate saved sample ID")
    mapped = {row["sample_id"]: row for row in sample_map}
    if len(mapped) != len(sample_map) or set(mapped) != set(sample_ids):
        raise ValueError("Retain exactly one profile mapping for every saved sample")
    buckets = defaultdict(list)
    profile_values = {}
    for sample in samples:
        mapping = mapped[sample["id"]]
        rid = sample["replicate_id"]
        if (rid not in replicates or mapping["replicate_id"] != rid
                or mapping["ordinal"] != sample["ordinal"]):
            raise ValueError("Sample/profile lineage differs from the saved design")
        identifier(mapping["profile_id"])
        if sample["id"] != digest({"replicate_id": rid, "ordinal": sample["ordinal"]}):
            raise ValueError("Saved sample identity changed")
        coordinates = sample["coordinates"]
        if len(coordinates) != len(axes) or set(sample["values"]) != set(axis_ids):
            raise ValueError("Saved coordinate/axis dimension differs")
        expected_overrides = {}
        for axis, u in zip(axes, coordinates):
            if not _finite(u) or not 0 <= u < 1:
                raise ValueError("A saved Latin-hypercube coordinate is out of bounds")
            lo, hi = axis["lower"], axis["upper"]
            value = (lo + u * (hi - lo) if axis["distribution"] == "uniform"
                     else math.exp(math.log(lo) + u * (math.log(hi) - math.log(lo))))
            if not _same_number(value, sample["values"][axis["id"]]):
                raise ValueError("A sampled native value differs from its frozen marginal")
            expected_overrides.update({path: sample["values"][axis["id"]] for path in axis["paths"]})
        if sample["overrides"] != expected_overrides:
            raise ValueError("The sampled native override map changed")
        prior = profile_values.setdefault(mapping["profile_id"], sample["values"])
        if prior != sample["values"]:
            raise ValueError("One native profile maps to different sampled values")
        buckets[rid].append(sample)
    for rid, rep in replicates.items():
        n = rep["samples"]
        if isinstance(n, bool) or not isinstance(n, int) or n < 1 or len(buckets[rid]) != n:
            raise ValueError("A replicate differs from its frozen sample count")
        if sorted(s["ordinal"] for s in buckets[rid]) != list(range(n)):
            raise ValueError("Duplicate sample ordinal within a replicate")
        for column in range(len(axes)):
            strata = sorted(min(n - 1, math.floor(s["coordinates"][column] * n)) for s in buckets[rid])
            if strata != list(range(n)):
                raise ValueError("The retained full sample matrix is not a Latin hypercube")
    if (summary.get("schema") != "upstate.experiment-summary/v1"
            or summary.get("workspace_id") != baseline["workspace_id"]
            or summary.get("grid_id") != baseline["grid_id"]):
        raise ValueError("Native summary belongs to another workspace or grid")
    if summary.get("baseline", {}).get("run_id") != baseline["baseline_run_id"]:
        raise ValueError("Native experiment baseline changed")
    selected_scenarios = set(summary["selection"]["scenario_ids"])
    if selected_scenarios != set(spec["scenario_ids"]):
        raise ValueError("Native scenario selection differs from the joint definition")
    expected_profiles = set(profile_values)
    if (set(summary["selection"]["profile_ids"]) != expected_profiles
            or summary["selection"].get("axes") != []
            or summary["selection"].get("design") != "factorial"):
        raise ValueError("Native experiment omits a sampled profile")
    return actual_id, mapped, buckets


def _native_cohort(row, models):
    """Keep actual pair versions; a requested legacy version is not observed."""
    source = row.get("native_versions")
    if source is None:
        return None
    policy = "completed_stage_runtime_else_observed_run_else_labeled_requested_legacy"
    if (not isinstance(source, dict) or source.get("policy") != policy
            or not isinstance(models, list) or not models or len(models) != len(set(models))
            or set(source.get("models", [])) != set(models)
            or set(source.get("versions", {})) != set(models)):
        raise ValueError("The native version cohort differs from the selected models")
    versions = source["versions"]
    for model in models:
        _required(versions[model], "retained native comparison version")
    runs = source.get("runs", {})
    expected = {row["run_id"], row["baseline_run_id"]}
    if set(runs) != expected:
        raise ValueError("The native version record belongs to different paired runs")
    provenance = {model: set() for model in models}
    observed = {"completed_stage_runtime", "observed_run_fallback", "observed_runtime"}
    for record in runs.values():
        if set(record) != set(models):
            raise ValueError("A native version record omits a selected model")
        for model, info in record.items():
            basis = info.get("basis")
            if (info.get("model") != model or info.get("comparison_version") != versions[model]
                    or basis not in observed | {"requested_legacy"}):
                raise ValueError("The retained producing version or source basis changed")
            provenance[model].add("observed_runtime" if basis in observed else "requested_legacy")
    return {"policy": policy, "versions": {key: versions[key] for key in sorted(models)},
            "evidence": {key: sorted(provenance[key]) for key in sorted(models)}}


def _rank(values):
    """Average ranks for ties; no random tie breaking."""
    import numpy as np
    x = np.asarray(values, dtype=float)
    order = np.argsort(x, kind="stable")
    ranks = np.empty(len(x), dtype=float)
    i = 0
    while i < len(x):
        j = i + 1
        while j < len(x) and x[order[j]] == x[order[i]]:
            j += 1
        ranks[order[i:j]] = (i + j - 1) / 2.0 + 1.0
        i = j
    return ranks


def _correlation(a, b):
    import numpy as np
    a = np.asarray(a, dtype=float)
    b = np.asarray(b, dtype=float)
    if len(a) < 3:
        return None, "fewer than three matched samples"
    da, db = a - a.mean(), b - b.mean()
    na, nb = float(np.linalg.norm(da)), float(np.linalg.norm(db))
    if na == 0 or nb == 0:
        return None, "constant input or outcome"
    r = float(np.dot(da / na, db / nb))
    return max(-1.0, min(1.0, r)), None


def _relations(x, y, axes):
    import numpy as np
    n, d = x.shape
    ranks = np.column_stack([_rank(x[:, j]) for j in range(d)])
    yrank = _rank(y)
    result = []
    for j, axis in enumerate(axes):
        pearson, preason = _correlation(x[:, j], y)
        spearman, sreason = _correlation(ranks[:, j], yrank)
        controls = np.column_stack([np.ones(n)] + [ranks[:, k] for k in range(d) if k != j])
        rank = int(np.linalg.matrix_rank(controls))
        partial, reason = None, None
        if n <= controls.shape[1] + 1:
            reason = "insufficient residual degrees of freedom for all other axes"
        elif rank != controls.shape[1]:
            reason = "rank-deficient controls; all other sampled axes were retained"
        else:
            xr = ranks[:, j] - controls @ np.linalg.lstsq(controls, ranks[:, j], rcond=None)[0]
            yr = yrank - controls @ np.linalg.lstsq(controls, yrank, rcond=None)[0]
            # Near-zero projections do not become a spurious perfect PRCC.
            tolerance = 100 * np.finfo(float).eps * max(n, d)
            if (np.linalg.norm(xr) <= tolerance * max(1.0, np.linalg.norm(ranks[:, j]))
                    or np.linalg.norm(yr) <= tolerance * max(1.0, np.linalg.norm(yrank))):
                reason = "constant or numerically exhausted residual input/outcome"
            else:
                partial, reason = _correlation(xr, yr)
        result.append({
            "axis_id": axis["id"], "label": axis.get("label", axis["id"]),
            "parameter_units": axis["units"], "samples": n,
            "pearson": pearson, "pearson_unavailable": preason,
            "spearman": spearman, "spearman_unavailable": sreason,
            "partial_rank_correlation": partial, "partial_rank_unavailable": reason,
            "control_rank": rank, "control_columns": controls.shape[1],
            "interpretation": "descriptive association within the retained matched design",
        })
    return result


def _fit(matrix, y, profile_ids):
    """Full-rank OLS diagnostics with leave-one-native-profile-out prediction."""
    import numpy as np
    n, p = matrix.shape
    rank = int(np.linalg.matrix_rank(matrix))
    result = {"samples": n, "columns": p, "rank": rank, "residual_df": n - rank,
              "unique_profiles": len(set(profile_ids)), "available": False}
    if n <= p or rank != p:
        result["unavailable"] = ("insufficient residual degrees of freedom" if n <= p
                                 else "rank-deficient response surface")
        return result
    beta, _, _, singular = np.linalg.lstsq(matrix, y, rcond=None)
    fitted = matrix @ beta
    residual = y - fitted
    sse = float(np.dot(residual, residual))
    centered = y - y.mean()
    sst = float(np.dot(centered, centered))
    q = np.linalg.qr(matrix, mode="reduced")[0]
    leverage = np.einsum("ij,ij->i", q, q)
    predictions = np.full(n, np.nan)
    unavailable = []
    ids = np.asarray(profile_ids)
    for profile_id in dict.fromkeys(profile_ids):
        held_out = ids == profile_id
        train = ~held_out
        if int(train.sum()) < p or int(np.linalg.matrix_rank(matrix[train])) != p:
            unavailable.append(profile_id)
            continue
        coeff = np.linalg.lstsq(matrix[train], y[train], rcond=None)[0]
        predictions[held_out] = matrix[held_out] @ coeff
    validation = {
        "method": "leave-one-native-profile-out; all duplicate sample mappings held out together",
        "predicted_samples": int(np.isfinite(predictions).sum()),
        "unavailable_profile_ids": unavailable,
        "complete": not unavailable,
        "rmse": None, "q2": None,
    }
    if not unavailable:
        error = predictions - y
        press = float(np.dot(error, error))
        validation.update(rmse=float(math.sqrt(press / n)),
                          q2=(1 - press / sst if sst > 0 else None), press=press)
    result.update(
        available=True, coefficients=[float(v) for v in beta], sse=sse,
        r2=1 - sse / sst if sst > 0 else None,
        adjusted_r2=1 - (sse / (n - p)) / (sst / (n - 1)) if sst > 0 else None,
        residual_rmse=float(math.sqrt(sse / (n - p))),
        condition_number=float(singular[0] / singular[-1]),
        maximum_leverage=float(leverage.max()),
        high_leverage_sample_positions=[i for i, v in enumerate(leverage) if v > 2 * p / n],
        profile_holdout=validation,
    )
    return result


def _surface(u, y, axes, profile_ids):
    """Hierarchical quadratic diagnostic on fixed source-marginal coordinates."""
    import numpy as np
    n, d = u.shape
    z = 2 * u - 1
    columns = [np.ones(n)]
    terms = [{"kind": "intercept", "axes": [], "label": "Intercept"}]
    for j, axis in enumerate(axes):
        columns.append(z[:, j])
        terms.append({"kind": "main", "axes": [axis["id"]], "label": axis.get("label", axis["id"])})
    for j, axis in enumerate(axes):
        columns.append(z[:, j] ** 2)
        terms.append({"kind": "quadratic", "axes": [axis["id"]], "label": axis.get("label", axis["id"]) + " squared"})
    additive = _fit(np.column_stack(columns), y, profile_ids)
    for j in range(d):
        for k in range(j + 1, d):
            columns.append(z[:, j] * z[:, k])
            terms.append({"kind": "interaction", "axes": [axes[j]["id"], axes[k]["id"]],
                          "label": axes[j].get("label", axes[j]["id"]) + " × " + axes[k].get("label", axes[k]["id"])})
    full = _fit(np.column_stack(columns), y, profile_ids)
    result = {
        "basis": "z = 2u - 1 using each frozen marginal coordinate; log-uniform axes are linear in log(parameter)",
        "meaning": "hierarchical quadratic response-surface diagnostic; coefficients have outcome units",
        "additive_quadratic": additive, "full_quadratic": full,
        "incremental_interaction_r2": None, "terms": [],
        "limitations": [
            "Squares and both main effects are retained for every pair interaction.",
            "This fitted surface is not a replacement for the original native model.",
            "There is no replicated observation-error estimate or formal lack-of-fit test.",
            "A high training R² alone does not establish predictive adequacy.",
            "A coefficient or incremental R² is not a Sobol index or a calibrated causal effect.",
        ],
    }
    if full["available"]:
        result["terms"] = [dict(term, coefficient=coef) for term, coef in zip(terms, full["coefficients"])]
        if additive["available"] and full["r2"] is not None and additive["r2"] is not None:
            result["incremental_interaction_r2"] = full["r2"] - additive["r2"]
    return result


def analyse(definition, sample_map, summary, *, study_id=None):
    """Pure analysis of one frozen design and the original native summary."""
    import numpy as np
    study_id, mapped, buckets = _check_definition(definition, sample_map, summary, study_id)
    axes = definition["specification"]["axes"]
    baseline_scenario = definition["baseline"]["baseline_scenario_id"]
    scenarios = list(dict.fromkeys([baseline_scenario] + definition["specification"]["scenario_ids"]))
    pollutants = summary.get("pollutants", [])
    if not pollutants or len(pollutants) != len(set(pollutants)):
        raise ValueError("Retain the exact original experiment pollutant selection")
    rows = {}
    for row in summary["rows"]:
        key = (row["profile_id"], row["scenario_id"])
        if key in rows:
            raise ValueError("Duplicate native profile/scenario case")
        rows[key] = row
    output = {
        "schema": SCHEMA, "study_id": study_id, "experiment_id": summary["id"],
        "workspace_id": summary["workspace_id"], "grid_id": summary["grid_id"],
        "definition_sha256": digest(definition),
        "native_summary_content_sha256": digest(summary),
        "native_summary_file": summary.get("files", {}).get("json"),
        "title": definition["specification"]["title"], "reason": definition["specification"]["reason"],
        "sampler": definition["sampler"], "analysis_numpy_version": np.__version__, "axes": axes,
        "replicates": definition["specification"]["replicates"],
        "expected_samples": len(definition["samples"]),
        "unique_sampled_profiles": len({row["profile_id"] for row in sample_map}),
        "native_experiment_state": summary["state"],
        "sample_observations": [], "groups": [], "replicate_comparisons": [],
        "interpretation": INTERPRETATION, "references": REFERENCES,
    }
    for rid, samples in buckets.items():
        for scenario in scenarios:
            for pollutant in pollutants:
                observations = []
                for sample in samples:
                    profile_id = mapped[sample["id"]]["profile_id"]
                    row = rows.get((profile_id, scenario))
                    observed = {
                        "sample_id": sample["id"], "replicate_id": rid,
                        "ordinal": sample["ordinal"], "profile_id": profile_id,
                        "scenario_id": scenario, "pollutant": pollutant,
                        "values": sample["values"], "coordinates": sample["coordinates"],
                        "state": row["state"] if row else "not_materialized",
                        "case_id": row["id"] if row else None,
                        "run_id": row.get("run_id") if row else None,
                        "baseline_run_id": row.get("baseline_run_id") if row else None,
                        "comparison_id": row.get("comparison_id") if row else None,
                        "kind": row.get("kind") if row else None,
                        "scenario_title": row.get("scenario_title") if row else None,
                        "native_versions": row.get("native_versions") if row else None,
                        "native_source": row.get("native_source") if row else None,
                        "native_baseline_source": row.get("native_baseline_source") if row else None,
                        "native_version_cohort": None, "native_version_cohort_sha256": None,
                        "metric": None, "exclusion": None,
                    }
                    if row is None or row["state"] != "complete":
                        observed["exclusion"] = "native case " + observed["state"]
                        if row and row.get("error"):
                            observed["native_error"] = row["error"]
                    else:
                        expected_kind = "parameter" if scenario == baseline_scenario else "landcover"
                        if row["kind"] not in (expected_kind, "reference" if scenario == baseline_scenario else expected_kind):
                            raise ValueError("Native case has a different pairing interpretation")
                        metric = row.get("metrics", {}).get(pollutant)
                        if metric is None:
                            observed["exclusion"] = "native pollutant metric unavailable"
                        elif not metric.get("paired_cells") or not metric.get("support_sha256"):
                            observed["exclusion"] = "no paired valid-cell support"
                        else:
                            identifier(metric["support_sha256"])
                            _required(metric.get("units"), "native metric units")
                            observed["metric"] = metric
                            cohort = _native_cohort(row, summary.get("models"))
                            if cohort is None:
                                observed["exclusion"] = "retained native producing-version record unavailable"
                            else:
                                observed["native_version_cohort"] = cohort
                                observed["native_version_cohort_sha256"] = digest(cohort)
                    observations.append(observed)
                output["sample_observations"].extend(observations)
                cohorts = {o["native_version_cohort_sha256"]: o["native_version_cohort"]
                           for o in observations if o["native_version_cohort_sha256"] is not None}
                supports = sorted({(o["metric"]["support_sha256"], o["metric"]["units"],
                                    o["native_version_cohort_sha256"])
                                   for o in observations if o["metric"] is not None and o["exclusion"] is None})
                if not supports:
                    supports = [(None, None, None)]
                for support, native_units, cohort_id in supports:
                    for outcome, label in OUTCOMES.items():
                        accepted, excluded = [], []
                        for observation in observations:
                            reason = observation["exclusion"]
                            metric = observation["metric"]
                            if reason is None and (metric["support_sha256"], metric["units"]) != (support, native_units):
                                reason = "different exact paired-cell support or native units"
                            if reason is None and observation["native_version_cohort_sha256"] != cohort_id:
                                reason = "different native producing version or observed/requested-only source basis"
                            if reason is None and not _finite(metric.get(outcome)):
                                reason = "undefined native outcome (including zero reference for percentage change)"
                            if reason:
                                excluded.append({"sample_id": observation["sample_id"],
                                                 "profile_id": observation["profile_id"], "reason": reason})
                            else:
                                accepted.append(observation)
                        key = {"replicate_id": rid, "scenario_id": scenario, "pollutant": pollutant,
                               "outcome": outcome, "support_sha256": support, "native_units": native_units,
                               "native_version_cohort_sha256": cohort_id}
                        group = dict(key, id=digest(key), outcome_label=label,
                                     native_version_cohort=cohorts.get(cohort_id),
                                     scenario_title=next((o.get("scenario_title") for o in observations if o.get("scenario_title")), scenario),
                                     units="%" if outcome == "relative_change_pct" else native_units,
                                     expected_samples=len(samples), analysed_samples=len(accepted),
                                     unique_profiles=len({o["profile_id"] for o in accepted}),
                                     complete_design=len(accepted) == len(samples),
                                     sample_ids=[o["sample_id"] for o in accepted],
                                     excluded=excluded, relations=[], response_surface=None, distribution=None)
                        if accepted:
                            first = accepted[0]["metric"]
                            for observation in accepted:
                                m = observation["metric"]
                                if (m.get("paired_cells") != first.get("paired_cells")
                                        or m.get("reporting_cells") != first.get("reporting_cells")):
                                    raise ValueError("Equal support hashes have inconsistent native cell counts")
                            group["paired_cells"] = first.get("paired_cells")
                            group["reporting_cells"] = first.get("reporting_cells")
                            group["paired_area_ha"] = first.get("paired_area_ha")
                            y = np.asarray([o["metric"][outcome] for o in accepted], dtype=float)
                            x = np.asarray([[o["values"][a["id"]] for a in axes] for o in accepted], dtype=float)
                            u = np.asarray([o["coordinates"] for o in accepted], dtype=float)
                            q = np.quantile(y, [0.05, 0.5, 0.95])
                            group["distribution"] = {
                                "minimum": float(y.min()), "maximum": float(y.max()), "mean": float(y.mean()),
                                "empirical_p05": float(q[0]), "median": float(q[1]), "empirical_p95": float(q[2]),
                                "quantiles": "linear interpolation of retained samples; not confidence bounds",
                            }
                            group["relations"] = _relations(x, y, axes)
                            group["response_surface"] = _surface(u, y, axes, [o["profile_id"] for o in accepted])
                        output["groups"].append(group)
    comparison = defaultdict(list)
    comparison_fields = ("scenario_id", "pollutant", "outcome", "support_sha256",
                         "native_units", "native_version_cohort_sha256")
    for group in output["groups"]:
        key = tuple(group[k] for k in comparison_fields)
        comparison[key].append(group)
    for key, groups in comparison.items():
        if len(groups) < 2:
            continue
        output["replicate_comparisons"].append({
            **dict(zip(comparison_fields, key)),
            "native_version_cohort": groups[0]["native_version_cohort"],
            "replicates": [{"replicate_id": g["replicate_id"], "samples": g["analysed_samples"],
                            "complete_design": g["complete_design"], "distribution": g["distribution"],
                            "relations": g["relations"]} for g in groups],
            "interpretation": "Separate retained seed results; no pooled confidence claim.",
        })
    return output


def collect(workspace, summary):
    """Join a report only to an explicitly linked frozen joint study."""
    experiment_id = identifier(summary["id"])
    directory = workspace.root / "experiments" / experiment_id
    pointer = directory / "joint-parameter-study.json"
    if not pointer.exists():
        return None
    link = read_json(pointer)
    if link.get("schema") != LINK_SCHEMA or link.get("experiment_id") != experiment_id:
        raise ValueError("The joint-study pointer belongs to another experiment")
    study_id = identifier(link["study_id"])
    study_dir = workspace.root / "joint-parameter-studies" / study_id
    definition = read_json(study_dir / "definition.json")
    state = read_json(study_dir / "state.json")
    if link.get("definition_sha256") != digest(definition) or digest(definition) != study_id:
        raise ValueError("The linked full joint definition changed")
    if state.get("experiment_id") != experiment_id:
        raise ValueError("The joint sample/profile map belongs to another experiment")
    from . import experiments, joint_parameter_studies
    retained = joint_parameter_studies.inspect(workspace, study_id)
    if retained["definition"] != definition or retained["samples"] != state["samples"]:
        raise ValueError("The validated native profile map changed during report collection")
    records = experiments._records(directory)
    if canonical(records) != canonical(summary["rows"]):
        raise ValueError("Refresh the original native summary before joint analysis")
    result = analyse(definition, state["samples"], summary, study_id=study_id)
    result["experiment_link"] = link
    return result


def _cell(value):
    if value is None:
        return ""
    text = str(value)
    return "'" + text if text.lstrip().startswith(("=", "+", "-", "@")) else text


def _csv(columns, rows):
    output = io.StringIO(newline="")
    writer = csv.DictWriter(output, fieldnames=columns, lineterminator="\n")
    writer.writeheader()
    for row in rows:
        writer.writerow({k: (_cell(row.get(k)) if isinstance(row.get(k), str) else row.get(k)) for k in columns})
    return output.getvalue().encode("utf-8-sig")


def downloads(result):
    if result is None:
        return {}
    observations = []
    for item in result["sample_observations"]:
        for outcome in OUTCOMES:
            row = {k: item.get(k) for k in ("sample_id", "replicate_id", "ordinal", "profile_id",
                    "scenario_id", "pollutant", "state", "case_id", "run_id", "baseline_run_id", "comparison_id")}
            metric = item.get("metric") or {}
            row.update(native_version_cohort_sha256=item["native_version_cohort_sha256"],
                       native_versions=canonical(item["native_version_cohort"]).decode("utf-8")
                           if item["native_version_cohort"] else "",
                       outcome=outcome, value=metric.get(outcome), native_units=metric.get("units"),
                       units="%" if outcome == "relative_change_pct" else metric.get("units"),
                       support_sha256=metric.get("support_sha256"), paired_cells=metric.get("paired_cells"),
                       exclusion=item["exclusion"] or ("" if _finite(metric.get(outcome)) else "undefined native outcome"))
            for axis in result["axes"]:
                row["parameter:" + axis["id"]] = item["values"][axis["id"]]
            observations.append(row)
    columns = ["sample_id", "replicate_id", "ordinal", "profile_id", "scenario_id", "pollutant",
               "outcome", "value", "units", "native_units", "support_sha256", "paired_cells",
               "state", "exclusion", "case_id", "run_id", "baseline_run_id", "comparison_id",
               "native_version_cohort_sha256", "native_versions"]
    columns += ["parameter:" + axis["id"] for axis in result["axes"]]
    relationships, terms = [], []
    for group in result["groups"]:
        context = {k: group.get(k) for k in ("id", "replicate_id", "scenario_id", "pollutant",
                   "outcome", "units", "support_sha256", "analysed_samples", "expected_samples", "complete_design",
                   "native_version_cohort_sha256")}
        context["native_versions"] = (canonical(group["native_version_cohort"]).decode("utf-8")
                                     if group["native_version_cohort"] else "")
        for relation in group["relations"]:
            relationships.append(dict(context, **relation))
        if group["response_surface"]:
            for term in group["response_surface"]["terms"]:
                terms.append(dict(context, kind=term["kind"], axes=";".join(term["axes"]),
                                  label=term["label"], coefficient=term["coefficient"]))
    common = ["id", "replicate_id", "scenario_id", "pollutant", "outcome", "units", "support_sha256",
              "analysed_samples", "expected_samples", "complete_design",
              "native_version_cohort_sha256", "native_versions"]
    return {
        "study-joint-parameter-analysis.json": ("Full joint parameter analysis", "application/json", canonical(result)),
        "study-joint-parameter-samples.csv": ("Joint samples and actual native outcomes", "text/csv", _csv(columns, observations)),
        "study-joint-parameter-relations.csv": ("Matched parameter relationships", "text/csv", _csv(common + [
            "axis_id", "label", "parameter_units", "pearson", "pearson_unavailable", "spearman", "spearman_unavailable",
            "partial_rank_correlation", "partial_rank_unavailable", "control_rank", "control_columns"], relationships)),
        "study-joint-parameter-surface.csv": ("Hierarchical response surface terms", "text/csv",
            _csv(common + ["kind", "axes", "label", "coefficient"], terms)),
    }


def _text(value):
    return html.escape(str(value), quote=True)


def _number(value):
    return format(value, ",.5g") if _finite(value) else "—"


def _table(headers, rows):
    return ('<div class="table-wrap"><table><thead><tr>'
            + "".join("<th>" + _text(h) + "</th>" for h in headers)
            + "</tr></thead><tbody>" + "".join("<tr>" + "".join("<td>" + cell + "</td>" for cell in row) + "</tr>" for row in rows)
            + "</tbody></table></div>")


def html_section(result):
    if result is None:
        return ""
    parts = ['<section id="joint-parameter-analysis"><style>#joint-parameter-analysis{overflow-wrap:anywhere}#joint-parameter-analysis .table-wrap{overflow:auto;max-width:100%}#joint-parameter-analysis summary{padding:10px 0}#joint-parameter-analysis h3{font-size:16px;margin-top:18px}</style><h2>Joint parameter sensitivity</h2>',
             "<p>" + _text(result["title"]) + " · " + str(result["expected_samples"])
             + " retained sample positions · " + str(result["unique_sampled_profiles"]) + " distinct native profiles.</p>",
             "<p>Each estimate below uses one scenario, pollutant, seed, producing-version cohort and exact raster support. "
             "Incomplete sample sets remain marked. Descriptive fits do not imply calibrated uncertainty.</p>"]
    parts.append(_table(["Parameter", "Native paths", "Marginal / range", "Units", "Source rationale / references"], [
        [_text(a.get("label", a["id"])), _text(", ".join(a["paths"])),
         _text(a["distribution"]) + " · " + _number(a["lower"]) + " to " + _number(a["upper"]),
         _text(a["units"]), _text(a["reason"]) + "<br>" + "<br>".join(
             ('<a href="' + _text(ref) + '" rel="noopener noreferrer">' + _text(ref) + "</a>")
             if ref.startswith(("https://", "http://")) else _text(ref)
             for ref in a.get("references", []))] for a in result["axes"]]))
    for group in result["groups"]:
        title = (group["replicate_id"] + " · " + group["scenario_title"] + " · " + group["pollutant"]
                 + " · " + group["outcome_label"])
        parts += ["<details><summary>" + _text(title) + " — " + str(group["analysed_samples"]) + "/"
                  + str(group["expected_samples"]) + " samples"
                  + ("; full design" if group["complete_design"] else "; incomplete / separate support or version") + "</summary>",
                  "<p>Support <code>" + _text(group["support_sha256"] or "no completed paired support") + "</code>. "
                  + str(group["unique_profiles"]) + " distinct native profiles. Outcome units: "
                  + _text(group["units"] or "not available") + ".</p>"]
        cohort = group["native_version_cohort"]
        parts.append("<p>Producing versions: " + (
            "; ".join(_text(model.upper() + " " + version + " (" +
                      ", ".join(cohort["evidence"][model]).replace("_", " ") + ")")
                      for model, version in cohort["versions"].items())
            if cohort else "unavailable; no parameter attribution made") + ".</p>")
        distribution = group["distribution"]
        if distribution:
            parts.append(_table(["Minimum", "Mean", "Median", "Maximum", "Empirical 5–95%"], [[
                _number(distribution["minimum"]), _number(distribution["mean"]),
                _number(distribution["median"]), _number(distribution["maximum"]),
                _number(distribution["empirical_p05"]) + " to " + _number(distribution["empirical_p95"])]]))
            parts.append("<p>Empirical quantiles describe these retained model outputs; they are not confidence limits.</p>")
        parts.append(_table(["Parameter", "Pearson", "Spearman", "Partial rank", "Unavailable / qualification"], [
            [_text(r["label"]), _number(r["pearson"]), _number(r["spearman"]),
             _number(r["partial_rank_correlation"]),
             _text("; ".join(dict.fromkeys(v for v in (r["pearson_unavailable"], r["spearman_unavailable"],
                                                        r["partial_rank_unavailable"]) if v)) or "Descriptive association only")]
            for r in group["relations"]]))
        surface = group["response_surface"]
        if surface:
            full = surface["full_quadratic"]
            parts.append("<h3>Interaction diagnostic</h3><p>" + _text(surface["basis"]) + ".</p>")
            if not full["available"]:
                parts.append("<p>Full quadratic fit unavailable: " + _text(full["unavailable"])
                             + " (" + str(full["samples"]) + " samples, " + str(full["columns"])
                             + " columns, rank " + str(full["rank"]) + ").</p>")
            else:
                holdout = full["profile_holdout"]
                parts.append(_table(["Training R²", "Incremental pair-interaction R²", "Held-out Q²",
                                     "Held-out RMSE", "Residual df", "Condition number", "Maximum leverage"], [[
                    _number(full["r2"]), _number(surface["incremental_interaction_r2"]),
                    _number(holdout["q2"]), _number(holdout["rmse"]), str(full["residual_df"]),
                    _number(full["condition_number"]), _number(full["maximum_leverage"])]]))
                parts.append("<p>Prediction validation holds out every occurrence of one native profile together: "
                             + str(holdout["predicted_samples"]) + "/" + str(full["samples"])
                             + " samples predicted. All main effects and squares precede pair products. "
                             "No formal lack-of-fit test or variance-attribution claim is made.</p>")
                parts.append(_table(["Term", "Kind", "Coefficient (" + str(group["units"]) + ")"],
                                    [[_text(t["label"]), _text(t["kind"]), _number(t["coefficient"])]
                                     for t in surface["terms"]]))
        if group["excluded"]:
            parts.append("<h3>Excluded from this exact support/version/outcome</h3>")
            parts.append(_table(["Saved sample", "Native profile", "Reason"],
                                [[_text(e["sample_id"]), _text(e["profile_id"]), _text(e["reason"])]
                                 for e in group["excluded"]]))
        parts.append("</details>")
    parts.append("<h3>Interpretation and methods</h3><ul>" + "".join("<li>" + _text(v) + "</li>" for v in INTERPRETATION) + "</ul>")
    parts.append("<ul>" + "".join('<li><a href="' + _text(r["url"]) + '" rel="noopener noreferrer">'
                                 + _text(r["title"]) + "</a></li>" for r in REFERENCES) + "</ul></section>")
    return "".join(parts)


def render_html(result):
    """Standalone exact-source report with embedded complete analysis downloads."""
    import base64
    if result is None:
        raise ValueError("Select a retained joint parameter study")
    links = []
    for name, (label, mime, body) in downloads(result).items():
        links.append('<a download="' + _text(name) + '" href="data:' + mime
                     + ';base64,' + base64.b64encode(body).decode("ascii") + '">' + _text(label) + "</a>")
    return ('<!doctype html><html lang="en"><head><meta charset="utf-8">'
            '<meta name="viewport" content="width=device-width,initial-scale=1"><title>'
            + _text(result["title"]) + ' — Joint parameter sensitivity</title><style>'
            ':root{font-family:Arial,Helvetica,sans-serif;color:#171717;background:#fff;color-scheme:light}'
            '*{box-sizing:border-box}body{margin:0}main{max-width:1440px;margin:auto;padding:32px}'
            'h1{font-size:28px}h2{font-size:21px}p,li{line-height:1.5}section{border-top:2px solid #222;padding-top:20px}'
            'a{color:#222}nav{display:flex;flex-wrap:wrap;gap:12px;margin:20px 0}'
            'table{border-collapse:collapse;width:100%;font-size:13px}th,td{text-align:left;padding:10px;border-bottom:1px solid #ddd;vertical-align:top}'
            'th{background:#f3f3f3}details{border-top:1px solid #ddd;margin-top:16px}summary{cursor:pointer;font-weight:600}'
            'code{font-size:12px;overflow-wrap:anywhere}td{min-width:100px}'
            '@media(max-width:760px){main{padding:18px}h1{font-size:24px}}'
            '@media print{main{padding:0}details{break-inside:avoid}}'
            '</style></head><body><main><h1>' + _text(result["title"])
            + '</h1><p>Original native experiment <code>' + _text(result["experiment_id"])
            + '</code>. Native state: ' + _text(result["native_experiment_state"])
            + '.</p><nav aria-label="Complete analysis downloads">' + " ".join(links)
            + "</nav>" + html_section(result) + "</main></body></html>")
