"""Reviewed pairwise evidence synthesis using the installed statsmodels engine.

Original extraction descriptors and lexical values remain attached to every
included, excluded and non-estimable row. This module performs no acquisition.
"""
from __future__ import annotations

from copy import deepcopy
from decimal import Decimal, InvalidOperation
import hashlib
import importlib.metadata
import json
import math
import platform
import re
import warnings

from .errors import StateError

PLAN_SCHEMA = "stellar-forge.evidence-synthesis-plan.v1"
RESULT_SCHEMA = "stellar-forge.evidence-synthesis-result.v1"
ENGINE_VERSION = "0.15.0"
MEASURES = ("RR", "OR", "RD", "MD", "SMD", "HR")
COHORT_KEYS = ("population", "outcome", "intervention", "comparator",
               "timepoint", "estimand", "unit")
_ID = re.compile(r"[A-Za-z0-9][A-Za-z0-9_.:-]{0,191}")
_NUMBER = re.compile(r"-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?")
_HASH = re.compile(r"[0-9a-f]{64}")
_METHOD_URL = "https://www.statsmodels.org/v0.15.0/generated/statsmodels.stats.meta_analysis.combine_effects.html"


def canonical(value):
    return json.dumps(value, ensure_ascii=False, allow_nan=False,
                      sort_keys=True, separators=(",", ":"))


def content_sha256(value):
    return hashlib.sha256(canonical(value).encode("utf-8")).hexdigest()


def need(condition, code):
    if not condition:
        raise StateError("ANALYSIS_SYNTHESIS_" + code)


def text(value, maximum=1024):
    need(isinstance(value, str) and value.strip() and len(value) <= maximum
         and all(ord(c) >= 32 and ord(c) != 127 for c in value), "TEXT_INVALID")
    return value


def identifier(value):
    need(isinstance(value, str) and _ID.fullmatch(value), "IDENTITY_INVALID")
    return value


def finite(value):
    need(type(value) in (int, float) and math.isfinite(value), "NUMBER_INVALID")
    return float(value)


def engine_information(*, required=False):
    packages = {}
    for name in ("statsmodels", "numpy", "scipy", "matplotlib"):
        try:
            packages[name] = importlib.metadata.version(name)
        except importlib.metadata.PackageNotFoundError:
            packages[name] = None
    ready = packages["statsmodels"] == ENGINE_VERSION and all(packages.values())
    if required:
        need(ready, "INSTALL_PINNED_SYNTHESIS_EXTRA")
    return {"name": "statsmodels.stats.meta_analysis",
            "required_statsmodels": ENGINE_VERSION, "ready": bool(ready),
            "packages": packages, "python": platform.python_version(),
            "source": "https://github.com/statsmodels/statsmodels/blob/v0.15.0/statsmodels/stats/meta_analysis.py",
            "methods": _METHOD_URL}


def validate_protocol(value):
    need(isinstance(value, dict) and value.get("schema") == PLAN_SCHEMA, "PLAN_FORMAT_INVALID")
    required = {"schema", "title", "question", "cohort", "measure", "mapping",
                "analysis", "selections", "reviewer", "rationale"}
    need(required <= value.keys(), "PLAN_FIELDS_REQUIRED")
    p = deepcopy(value)
    for key in ("title", "question", "rationale"):
        text(p[key], 10000 if key != "title" else 240)
    reviewer = p["reviewer"]
    need(isinstance(reviewer, dict), "REVIEWER_REQUIRED")
    identifier(reviewer.get("id")); text(reviewer.get("name"), 240)
    need(isinstance(p["cohort"], dict) and set(p["cohort"]) == set(COHORT_KEYS),
         "COMPLETE_COHORT_REQUIRED")
    for part in p["cohort"].values():
        text(part, 1000)
    need(p["measure"] in MEASURES, "MEASURE_INVALID")
    _mapping(p["mapping"], p["measure"])
    a = p["analysis"]
    need(isinstance(a, dict), "METHOD_REQUIRED")
    need(a.get("model") in {"common", "random"}, "MODEL_INVALID")
    need(a.get("tau_method") in {"pm", "dl"}, "TAU_METHOD_INVALID")
    need(a.get("interval") in {"normal", "hksj"}, "INTERVAL_INVALID")
    need(a["model"] != "common" or a["interval"] == "normal", "COMMON_NORMAL_INTERVAL_REQUIRED")
    alpha = finite(a.get("alpha"))
    need(0 < alpha < 1, "ALPHA_INVALID")
    need(a.get("continuity") in {"none", "zero-cells-0.5"}, "CONTINUITY_REQUIRED")
    need(type(a.get("allow_derived", False)) is bool, "DERIVED_SELECTION_INVALID")
    need(type(a.get("leave_one_out", True)) is bool, "SENSITIVITY_SELECTION_INVALID")
    a.setdefault("allow_derived", False); a.setdefault("leave_one_out", True)
    a.setdefault("pm_tolerance", 1e-8); a.setdefault("pm_max_iterations", 500)
    need(0 < finite(a["pm_tolerance"]) <= 1e-3, "PM_TOLERANCE_INVALID")
    need(type(a["pm_max_iterations"]) is int and 1 <= a["pm_max_iterations"] <= 100000,
         "PM_ITERATIONS_INVALID")
    selections = p["selections"]
    need(isinstance(selections, list) and len(selections) > 0, "SELECTION_REQUIRED")
    selected_ids = set()
    for item in selections:
        need(isinstance(item, dict), "RESULT_SELECTION_INVALID")
        key = (identifier(item.get("result_id")), identifier(item.get("edition_id")))
        need(key not in selected_ids, "RESULT_SELECTED_TWICE"); selected_ids.add(key)
        need(type(item.get("include")) is bool, "INCLUSION_DECISION_REQUIRED")
        text(item.get("reason"), 10000)
        need(isinstance(item.get("descriptor_sha256"), str)
             and _HASH.fullmatch(item["descriptor_sha256"]), "REVIEWED_DESCRIPTOR_REQUIRED")
        if item["include"]:
            need(item.get("cohort") == p["cohort"], "COMPARABILITY_REVIEW_REQUIRED")
            need(item.get("independence") in {"independent-groups", "reported-adjusted-estimate"},
                 "INDEPENDENCE_REVIEW_REQUIRED")
            need(item.get("orientation") in {"as-selected", "reverse"}, "ORIENTATION_REQUIRED")
            if "mapping" in item:
                _mapping(item["mapping"], p["measure"])
        if "subgroups" in item:
            need(isinstance(item["subgroups"], dict), "SUBGROUP_VALUES_INVALID")
            for key, part in item["subgroups"].items():
                identifier(key); text(part, 1000)
    groups = p.setdefault("subgroups", [])
    need(isinstance(groups, list), "SUBGROUPS_INVALID")
    seen = set()
    for group in groups:
        need(isinstance(group, dict), "SUBGROUP_INVALID")
        identifier(group.get("id")); text(group.get("label"), 240)
        text(group.get("rationale"), 10000)
        need(group["id"] not in seen, "SUBGROUP_DUPLICATED"); seen.add(group["id"])
    sets = p.setdefault("sensitivity_sets", [])
    need(isinstance(sets, list), "SENSITIVITY_SETS_INVALID")
    seen = set()
    for item in sets:
        need(isinstance(item, dict), "SENSITIVITY_SET_INVALID")
        identifier(item.get("id")); text(item.get("label"), 240); text(item.get("reason"), 10000)
        need(item["id"] not in seen, "SENSITIVITY_DUPLICATED"); seen.add(item["id"])
        need(isinstance(item.get("omit_result_ids"), list), "OMIT_SELECTION_REQUIRED")
        for key in item["omit_result_ids"]:
            identifier(key)
    return p


def _mapping(mapping, measure):
    need(isinstance(mapping, dict), "EFFECT_MAPPING_REQUIRED")
    kind = mapping.get("kind")
    expected = {
        "binary": {"events_t", "total_t", "events_c", "total_c"},
        "continuous": {"mean_t", "sd_t", "total_t", "mean_c", "sd_c", "total_c"},
        "estimate-se": {"estimate", "se"},
        "estimate-ci": {"estimate", "lower", "upper"},
    }
    need(kind in expected, "EFFECT_MAPPING_INVALID")
    fields = mapping.get("fields")
    need(isinstance(fields, dict) and set(fields) == expected[kind], "MAPPED_FIELDS_INVALID")
    for selector in fields.values():
        _selector(selector)
    need(kind != "binary" or measure in {"RR", "OR", "RD"}, "BINARY_MEASURE_INVALID")
    need(kind != "continuous" or measure in {"MD", "SMD"}, "CONTINUOUS_MEASURE_INVALID")
    if kind in {"estimate-se", "estimate-ci"}:
        need(mapping.get("reported_scale") in {"analysis", "display"}, "REPORTED_SCALE_REQUIRED")
        if kind == "estimate-se" and measure in {"RR", "OR", "HR"}:
            need(mapping["reported_scale"] == "analysis", "RATIO_STANDARD_ERROR_MUST_BE_LOG_SCALE")
        if kind == "estimate-ci":
            need(0 < finite(mapping.get("confidence_level")) < 1, "SOURCE_CONFIDENCE_LEVEL_REQUIRED")
            need(mapping.get("distribution") in {"normal", "t"}, "SOURCE_INTERVAL_DISTRIBUTION_REQUIRED")
            if mapping["distribution"] == "t":
                need(finite(mapping.get("degrees_of_freedom")) > 0, "SOURCE_INTERVAL_DF_REQUIRED")
    return mapping


def _selector(value):
    if isinstance(value, str):
        identifier(value)
        return
    need(isinstance(value, dict) and set(value) == {"sum"}
         and isinstance(value["sum"], list) and len(value["sum"]) >= 2,
         "SOURCE_FIELD_SELECTOR_INVALID")
    for item in value["sum"]:
        identifier(item)


def _lexical_number(value):
    if type(value) in (int, float):
        need(math.isfinite(value), "FINITE_REPORTED_NUMBER_REQUIRED")
        value = json.dumps(value, allow_nan=False)
    need(isinstance(value, str) and len(value) <= 256 and _NUMBER.fullmatch(value),
         "REPORTED_NUMERIC_VALUE_REQUIRED")
    try:
        number = Decimal(value)
    except InvalidOperation:
        raise StateError("ANALYSIS_SYNTHESIS_REPORTED_NUMERIC_VALUE_REQUIRED") from None
    need(number.is_finite(), "FINITE_REPORTED_NUMBER_REQUIRED")
    return number


def source_number(record, selector, *, allow_derived):
    """Read accepted numeric fields without changing their original source tags."""
    fields = [selector] if isinstance(selector, str) else selector["sum"]
    form = record.get("form")
    definition = form.get("definition") if isinstance(form, dict) else None
    defined = definition.get("fields") if isinstance(definition, dict) else None
    field_definitions = {item.get("id"): item for item in defined if isinstance(item, dict)} if isinstance(defined, list) else {}
    operands, values = [], []
    for field in fields:
        answer = record.get("values", {}).get(field)
        need(isinstance(answer, dict), "REPORTED_FIELD_REQUIRED")
        status = answer.get("status")
        need(status == "reported" or status == "derived" and allow_derived,
             "VALUE_" + str(status or "MISSING").upper().replace("-", "_"))
        value = answer.get("value")
        need(isinstance(value, list) and len(value) == 2 and value[0] in {"number", "str"},
             "REPORTED_NUMERIC_VALUE_REQUIRED")
        field_definition = field_definitions.get(field, {})
        # Original Research integer/decimal fields preserve a JSON string source
        # as ["str", lexical]. The declared native field type authorizes parsing;
        # a numeric-looking text or identifier field is never silently coerced.
        need(value[0] == "number" or field_definition.get("valueType") in {"integer", "decimal"},
             "LEXICAL_NUMERIC_FIELD_REQUIRED")
        numeric = _lexical_number(value[1])
        operands.append({"field": field, "field_value_type": field_definition.get("valueType"),
                         "answer": deepcopy(answer)})
        values.append(numeric)
    number = sum(values, Decimal(0))
    f = float(number)
    need(math.isfinite(f), "NUMBER_OUTSIDE_ENGINE_RANGE")
    return f, {"selector": deepcopy(selector), "operands": operands,
               "transformation": "identity" if isinstance(selector, str) else "exact-decimal-sum",
               "lexical": str(number)}


def _display(value, measure):
    if value is None:
        return None
    if measure in {"RR", "OR", "HR"}:
        try:
            out = math.exp(value)
        except OverflowError:
            return None
        return out if math.isfinite(out) and out > 0 else None
    return value


def _interval(mean, se, alpha, *, df=None):
    from scipy import stats
    critical = float(stats.norm.isf(alpha / 2) if df is None else stats.t.isf(alpha / 2, df))
    return [float(mean - critical * se), float(mean + critical * se)]


def _row_effect(record, choice, p):
    import numpy as np
    from scipy import stats
    from statsmodels.stats.meta_analysis import effectsize_2proportions, effectsize_smd

    mapping = choice.get("mapping", p["mapping"])
    kind, measure = mapping["kind"], p["measure"]
    need(kind in {"estimate-se", "estimate-ci"} or choice["independence"] == "independent-groups",
         "ADJUSTED_ESTIMATE_REQUIRED_FOR_DEPENDENT_DESIGN")
    values, provenance = {}, {}
    for name, selector in mapping["fields"].items():
        values[name], provenance[name] = source_number(
            record, selector, allow_derived=p["analysis"]["allow_derived"])
    correction = None
    method = None
    with warnings.catch_warnings(record=True) as observed:
        warnings.simplefilter("always")
        if kind == "binary":
            a, n1, c, n2 = (values[k] for k in ("events_t", "total_t", "events_c", "total_c"))
            need(all(v.is_integer() for v in (a, n1, c, n2)) and n1 > 0 and n2 > 0
                 and 0 <= a <= n1 and 0 <= c <= n2 and max(n1, n2) <= 2**53, "BINARY_COUNTS_INVALID")
            zero = a in {0, n1} or c in {0, n2}
            if measure in {"RR", "OR"} and ((a == c == 0) or (a == n1 and c == n2)):
                raise StateError("ANALYSIS_SYNTHESIS_NO_RELATIVE_EFFECT_INFORMATION")
            if zero and p["analysis"]["continuity"] == "zero-cells-0.5":
                correction = 0.5
            need(measure == "RD" or not zero or correction is not None,
                 "ZERO_CELL_REQUIRES_SELECTED_METHOD")
            # The native float correction modifies every supplied numerator.
            # This one-study call supplies it only for an actual zero-cell row.
            effect, variance = effectsize_2proportions(
                np.array([a]), np.array([n1]), np.array([c]), np.array([n2]),
                statistic={"RR": "rr", "OR": "or", "RD": "diff"}[measure],
                zero_correction=correction)
            yi, vi = float(effect[0]), float(variance[0])
            method = "statsmodels.effectsize_2proportions"
        elif kind == "continuous":
            m1, s1, n1, m2, s2, n2 = (
                values[k] for k in ("mean_t", "sd_t", "total_t", "mean_c", "sd_c", "total_c"))
            need(n1.is_integer() and n2.is_integer() and n1 >= 2 and n2 >= 2
                 and s1 >= 0 and s2 >= 0, "CONTINUOUS_SUMMARIES_INVALID")
            if measure == "SMD":
                need(s1 > 0 or s2 > 0, "POOLED_STANDARD_DEVIATION_ZERO")
                effect, variance = effectsize_smd(
                    np.array([m1]), np.array([s1]), np.array([n1]),
                    np.array([m2]), np.array([s2]), np.array([n2]))
                yi, vi = float(effect[0]), float(variance[0])
                method = "statsmodels.effectsize_smd; bias-corrected standardized mean difference"
            else:
                yi, vi = m1 - m2, s1 * s1 / n1 + s2 * s2 / n2
                method = "independent mean difference; reported arm SD squared / n"
        elif kind == "estimate-se":
            yi, se = values["estimate"], values["se"]
            need(se > 0, "POSITIVE_STANDARD_ERROR_REQUIRED")
            vi = se * se
            method = "reported estimate and standard error on analysis scale"
        else:
            yi, lo, hi = (values[k] for k in ("estimate", "lower", "upper"))
            if mapping["reported_scale"] == "display" and measure in {"RR", "OR", "HR"}:
                need(min(yi, lo, hi) > 0, "POSITIVE_RATIO_INTERVAL_REQUIRED")
                yi, lo, hi = math.log(yi), math.log(lo), math.log(hi)
            need(lo < yi < hi, "SOURCE_CONFIDENCE_INTERVAL_INVALID")
            need(abs((yi - lo) - (hi - yi)) <= max(1e-8, abs(hi - lo) * 0.01),
                 "ASYMMETRIC_INTERVAL_REQUIRES_REPORTED_STANDARD_ERROR")
            alpha = 1 - mapping["confidence_level"]
            critical = float(stats.norm.isf(alpha / 2) if mapping["distribution"] == "normal"
                             else stats.t.isf(alpha / 2, mapping["degrees_of_freedom"]))
            se = (hi - lo) / (2 * critical)
            vi = se * se
            method = "reported symmetric interval inverted on analysis scale"
        need(math.isfinite(yi) and math.isfinite(vi) and vi > 0, "EFFECT_NOT_ESTIMABLE")
        if choice["orientation"] == "reverse":
            yi = -yi
        se = math.sqrt(vi)
        ci = _interval(yi, se, p["analysis"]["alpha"])
    return {
        "estimate": yi, "variance": vi, "standard_error": se, "interval": ci,
        "display_estimate": _display(yi, measure),
        "display_interval": [_display(v, measure) for v in ci],
        "measure": measure, "analysis_scale": "log" if measure in {"RR", "OR", "HR"} else "identity",
        "orientation": choice["orientation"], "method": method,
        "continuity_correction": correction, "numbers": provenance,
        "warnings": sorted({str(w.message) for w in observed}),
    }


def descriptors_index(descriptors):
    need(isinstance(descriptors, list), "PUBLICATION_RESULTS_REQUIRED")
    indexed = {}
    for item in descriptors:
        need(isinstance(item, dict), "RESULT_DESCRIPTOR_INVALID")
        key = (identifier(item.get("resultId")), identifier(item.get("editionId")))
        need(key not in indexed, "PUBLICATION_RESULT_DUPLICATED")
        need(isinstance(item.get("record"), dict) and isinstance(item.get("sourceBindings"), list),
             "FULL_SOURCE_BOUND_DESCRIPTOR_REQUIRED")
        indexed[key] = item
    return indexed


def review(protocol, descriptors, *, compute_effects=False, cancelled=lambda: None):
    p = validate_protocol(protocol)
    originals = descriptors_index(descriptors)
    if compute_effects:
        engine_information(required=True)
    rows, selected, studies = [], set(), {}
    for choice in p["selections"]:
        cancelled()
        key = (choice["result_id"], choice["edition_id"])
        need(key in originals, "SELECTED_RESULT_NOT_IN_PUBLICATION")
        original = originals[key]
        need(content_sha256(original) == choice["descriptor_sha256"], "REVIEWED_RESULT_CHANGED")
        selected.add(key)
        study = original["record"].get("study", {})
        study_id = original.get("studyId") or study.get("id")
        need(isinstance(study_id, str) and study_id, "ORIGINAL_STUDY_ID_REQUIRED")
        row = {
            "result_id": key[0], "edition_id": key[1], "study_id": study_id,
            "study_version": study.get("version"), "label": original.get("label", key[0]),
            "descriptor_sha256": choice["descriptor_sha256"],
            "source_status": original.get("status"), "source_current": original.get("current"),
            "decision": deepcopy(choice), "source_bindings": deepcopy(original["sourceBindings"]),
            "state": "EXCLUDED" if not choice["include"] else "SELECTED",
            "reason": choice["reason"], "issues": [], "effect": None,
        }
        if choice["include"]:
            if original.get("status") != "RESOLVED" or original["record"].get("status") != "RESOLVED":
                row["state"] = "UNRESOLVED"
                row["issues"].append("Only the original resolved result edition is eligible for pooling.")
            elif not original["sourceBindings"]:
                row["state"] = "NON_ESTIMABLE"
                row["issues"].append("The selected original result has no retained source binding.")
            elif compute_effects:
                try:
                    row["effect"] = _row_effect(original["record"], choice, p)
                    row["state"] = "ESTIMABLE"
                except StateError as error:
                    row["state"] = "NON_ESTIMABLE"
                    row["issues"].append(error.code.removeprefix("ANALYSIS_SYNTHESIS_"))
            studies.setdefault(study_id, []).append(row)
        rows.append(row)
    conflicts = []
    for study_id, members in studies.items():
        if len(members) > 1:
            conflicts.append({"study_id": study_id, "result_ids": [r["result_id"] for r in members],
                              "reason": "Select one independent result per study for this contrast."})
            for row in members:
                row["state"] = "DEPENDENT_SELECTION"
                row["issues"].append("Another included result belongs to this original study.")
    excluded = [{"result_id": k[0], "edition_id": k[1], "study_id": v.get("studyId"),
                 "label": v.get("label"), "source_status": v.get("status"),
                 "state": "UNSELECTED", "descriptor_sha256": content_sha256(v)}
                for k, v in originals.items() if k not in selected]
    known_ids = {r["result_id"] for r in rows}
    for subset in p["sensitivity_sets"]:
        need(set(subset["omit_result_ids"]) <= known_ids, "SENSITIVITY_RESULT_UNKNOWN")
    return {"schema": "stellar-forge.evidence-synthesis-review.v1", "protocol": p,
            "protocol_sha256": content_sha256(p), "rows": rows, "unselected": excluded,
            "conflicts": conflicts,
            "counts": {"published_results": len(originals), "reviewed_results": len(rows),
                       "included_results": sum(r["decision"]["include"] for r in rows),
                       "estimable_results": sum(r["state"] == "ESTIMABLE" for r in rows),
                       "unselected_results": len(excluded), "included_studies": len(studies)},
            "engine": engine_information(), "can_run": not conflicts and any(
                r["decision"]["include"] and r["source_status"] == "RESOLVED" for r in rows)}


def _pool(rows, p, *, model=None, interval=None):
    import numpy as np
    from scipy import stats
    from statsmodels.stats.meta_analysis import combine_effects

    k = len(rows)
    if k < 2:
        return {"status": "SINGLE_STUDY" if k else "NO_ESTIMABLE_STUDIES",
                "k": k, "reason": "At least two independent study estimates are required for pooling."}
    a = p["analysis"]
    model, interval = model or a["model"], interval or a["interval"]
    y = np.asarray([r["effect"]["estimate"] for r in rows], dtype=float)
    v = np.asarray([r["effect"]["variance"] for r in rows], dtype=float)
    method = a["tau_method"] if model == "random" else "pm"
    kwds = {"atol": a["pm_tolerance"], "maxiter": a["pm_max_iterations"]} if method == "pm" else {}
    with warnings.catch_warnings(record=True) as observed:
        warnings.simplefilter("always")
        fit = combine_effects(y, v, method_re=method, row_names=[r["label"] for r in rows],
                              use_t=interval == "hksj", alpha=a["alpha"], **kwds)
    raw_tau = float(fit.tau2)
    need(math.isfinite(raw_tau), "NATIVE_TAU_NOT_FINITE")
    tau = max(0.0, raw_tau) if model == "random" else 0.0
    boundary = model == "random" and raw_tau < 0
    use_common = model == "common" or boundary
    estimate = float(fit.mean_effect_fe if use_common else fit.mean_effect_re)
    variance = float(fit.var_eff_w_fe if use_common else fit.var_eff_w_re)
    scaled_variance = float(fit.var_hksj_fe if use_common else fit.var_hksj_re)
    weights = np.asarray(fit.weights_rel_fe if use_common else fit.weights_rel_re, dtype=float)
    need(math.isfinite(estimate) and variance > 0 and math.isfinite(variance)
         and np.all(np.isfinite(weights)) and np.all(weights > 0), "NATIVE_POOL_NOT_ESTIMABLE")
    q = max(0.0, float(fit.q))
    residual_q = float(np.sum((y - estimate) ** 2 / (v + tau)))
    converged = tau == 0 or method != "pm" or abs(residual_q - (k - 1)) <= max(
        2 * a["pm_tolerance"], 1e-7)
    need(model == "common" or converged, "PM_DID_NOT_CONVERGE")
    selected_variance = scaled_variance if interval == "hksj" else variance
    need(math.isfinite(selected_variance) and selected_variance >= 0, "NATIVE_INTERVAL_NOT_ESTIMABLE")
    se = math.sqrt(selected_variance)
    df = k - 1 if interval == "hksj" else None
    ci = _interval(estimate, se, a["alpha"], df=df)
    statistic = estimate / se if se else None
    pvalue = float(2 * (stats.t.sf(abs(statistic), df) if df is not None
                       else stats.norm.sf(abs(statistic)))) if statistic is not None else None
    notes = []
    if boundary:
        notes.append("The native unbounded DL estimate is negative; the selected nonnegative DL boundary uses the native common-effect mean, variance and scale at tau squared zero.")
    if interval == "hksj" and scaled_variance < variance:
        notes.append("The selected unmodified HKSJ estimated scale is below one; its interval may be narrower than the normal fixed-scale interval.")
    if k < 5 and model == "random":
        notes.append("Between-study variance and interval coverage are imprecise with few studies.")
    if se == 0:
        notes.append("The selected estimated residual scale is zero; its HKSJ interval is degenerate.")
    return {
        "status": "ESTIMATED", "k": k, "model": model,
        "tau_method": method if model == "random" else None,
        "interval_method": "HKSJ estimated scale, t(k-1)" if interval == "hksj" else "normal, fixed scale",
        "alpha": a["alpha"], "estimate": estimate, "standard_error": se,
        "fixed_scale_standard_error": math.sqrt(variance), "interval": ci, "degrees_of_freedom": df,
        "display_estimate": _display(estimate, p["measure"]),
        "display_interval": [_display(x, p["measure"]) for x in ci],
        "measure": p["measure"], "analysis_scale": "log" if p["measure"] in {"RR", "OR", "HR"} else "identity",
        "pvalue": pvalue, "tau_squared": tau, "native_unbounded_tau_squared": raw_tau if model == "random" else None,
        "tau_at_boundary": tau == 0 if model == "random" else None,
        "pm_converged": converged if model == "random" and method == "pm" else None,
        "Q": q, "Q_df": k - 1, "Q_pvalue": float(stats.chi2.sf(q, k - 1)),
        "I_squared_percent": max(0.0, (q - (k - 1)) / q * 100) if q else 0.0,
        "H_squared": q / (k - 1), "residual_Q": residual_q,
        "HKSJ_scale": scaled_variance / variance,
        "weights": [{"result_id": row["result_id"], "study_id": row["study_id"], "weight": float(weight)}
                    for row, weight in zip(rows, weights)],
        "warnings": sorted({str(w.message) for w in observed}), "notes": notes,
    }


def analyze(protocol, descriptors, *, cancelled=lambda: None):
    engine = engine_information(required=True)
    reviewed = review(protocol, descriptors, compute_effects=True, cancelled=cancelled)
    need(not reviewed["conflicts"], "DEPENDENT_STUDIES_REQUIRE_REVIEW")
    p = reviewed["protocol"]
    rows = [r for r in reviewed["rows"] if r["state"] == "ESTIMABLE"]
    cancelled()
    primary = _pool(rows, p)
    common = _pool(rows, p, model="common", interval="normal")
    random_normal = _pool(rows, p, model="random", interval="normal")
    random_hksj = _pool(rows, p, model="random", interval="hksj")
    loo = []
    if p["analysis"]["leave_one_out"] and len(rows) >= 3:
        for omit in rows:
            cancelled()
            selected = [r for r in rows if r["result_id"] != omit["result_id"]]
            pooled = _pool(selected, p)
            loo.append({"omitted_result_id": omit["result_id"], "omitted_study_id": omit["study_id"],
                        "label": omit["label"], "estimate_change": pooled.get("estimate", 0) - primary.get("estimate", 0),
                        "result": pooled})
    subgroups = []
    for definition in p["subgroups"]:
        groups = {}
        for row in rows:
            group = row["decision"].get("subgroups", {}).get(definition["id"])
            groups.setdefault(group, []).append(row)
        estimates = []
        for level, selected in sorted(groups.items(), key=lambda pair: (pair[0] is None, str(pair[0]))):
            cancelled()
            estimates.append({"level": level, "missing": level is None,
                              "result_ids": [r["result_id"] for r in selected], "result": _pool(selected, p)})
        subgroups.append({"definition": deepcopy(definition), "levels": estimates,
                          "interpretation": "Descriptive within-subgroup estimates; overlapping confidence intervals are not a subgroup interaction test."})
    sensitivity = []
    for definition in p["sensitivity_sets"]:
        cancelled()
        omit = set(definition["omit_result_ids"])
        selected = [r for r in rows if r["result_id"] not in omit]
        sensitivity.append({"definition": deepcopy(definition), "result": _pool(selected, p)})
    return {"schema": RESULT_SCHEMA, "engine": engine, "review": reviewed,
            "primary": primary, "comparisons": {"common_normal": common,
                "random_normal": random_normal, "random_hksj": random_hksj},
            "leave_one_out": loo, "subgroups": subgroups, "sensitivity_sets": sensitivity,
            "funnel": {"kind": "descriptive", "x_scale": "analysis-effect",
                       "y_scale": "standard-error", "studies": len(rows),
                       "interpretation": "A funnel plot describes the relation between study estimates and precision. Asymmetry alone does not identify publication bias.",
                       "small_sample_note": "Fewer than ten studies provide limited information about funnel asymmetry." if len(rows) < 10 else None},
            "method_notes": [
                "The effect and its sampling variance are calculated from the selected accepted numeric fields. Original lexical values, derivations and source bindings are retained.",
                "Ratios are pooled on the natural-log scale and back-transformed for display. Individual-study intervals use the normal distribution on the analysis scale.",
                "One independent estimate per original Study is selected for each reviewed contrast. Different timepoints, populations, estimands and units require separate reviewed protocols.",
                "PM uses the installed native iterative estimator with the recorded tolerance and iteration limit. DL uses an explicit nonnegative between-study variance boundary.",
                "HKSJ uses the native estimated residual scale and a t reference distribution with k minus one degrees of freedom; no undocumented scale flooring is applied.",
                "Source appraisal judgements and revisions remain in their original descriptors. Sensitivity exclusions are explicit selections and do not overwrite those judgements.",
            ]}
