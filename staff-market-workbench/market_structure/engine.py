"""Explicit pay-structure decisions over retained accepted market analyses.

All compensation arithmetic uses the existing Decimal parser. These decisions
retain each original analysis; they never pool or re-age accepted studies.
"""
from __future__ import annotations

from decimal import Decimal, ROUND_HALF_UP, localcontext
from core import Problem, digest, ds
from classification import engine as classification

SCHEMA = "staff-market.market-structure/v1"
MEASURES = ("p25", "p50", "p75")
MAX_ANALYSES = 200
CENT = Decimal("0.01")


def analysis_ref(snapshot):
    original, review = snapshot["analysis"], snapshot["accepted_review"]
    return {"analysis_id": original["id"], "expected_result_sha256": original["result_sha256"],
            "expected_review_id": review["id"]}


def source_ref(snapshot):
    original = snapshot["analysis"]
    return {"label": original["title"], "sha256": original["result_sha256"],
            "note": "Original accepted analysis " + original["id"] + "; review " +
                    snapshot["accepted_review"]["id"]}


def _measure(analysis, key, field):
    if key not in MEASURES:
        raise Problem("Choose p25, p50 or p75 for " + field)
    value = analysis["consensus"].get(key)
    if value is None:
        raise Problem("The original analysis has no complete " + key + " figure for " + field,
                      422, "MEASURE_UNAVAILABLE", {"analysis_id": analysis["id"], "measure": key})
    coverage = analysis.get("measure_coverage", {}).get(key)
    if coverage and coverage.get("available") != coverage.get("selected"):
        raise Problem("The original analysis has incomplete source coverage for " + key,
                      409, "MEASURE_COVERAGE_CHANGED")
    return classification.number(value, field)


def _rounded(value, mode):
    return value.quantize(CENT, rounding=ROUND_HALF_UP) if mode == "half_up_cents" else value


def _grade(raw, snapshots):
    raw = classification.obj(raw, "grade decision")
    identity = classification.identity(raw.get("id"), "grade id")
    analysis_id = classification.identity(raw.get("analysis_id"), "grade analysis")
    if analysis_id not in snapshots:
        raise Problem("Every grade must select an original analysis included in this proposal")
    analysis = snapshots[analysis_id]["analysis"]
    reference_mode = raw.get("reference_mode")
    if reference_mode == "analysis_measure":
        reference_measure = raw.get("reference_measure")
        reference = _measure(analysis, reference_measure, "grade reference")
    elif reference_mode == "entered":
        reference_measure = None
        reference = classification.number(raw.get("reference_amount"), "entered grade reference")
    else:
        raise Problem("Choose analysis_measure or entered for the reference")
    mode = raw.get("range_mode")
    decision = {"id": identity, "label": classification.text(raw.get("label") or identity, "grade label", limit=300),
                "analysis_id": analysis_id, "reference_mode": reference_mode,
                "reference_measure": reference_measure, "reference_amount": ds(reference),
                "reference_label": classification.text(raw.get("reference_label"), "reference label", limit=200),
                "range_mode": mode, "rationale": classification.text(raw.get("rationale"), "grade decision rationale", limit=15000)}
    with localcontext() as context:
        context.prec = 50
        if mode == "analysis_measures":
            lower, upper = raw.get("lower_measure"), raw.get("upper_measure")
            minimum = _measure(analysis, lower, "grade minimum")
            maximum = _measure(analysis, upper, "grade maximum")
            decision.update(lower_measure=lower, upper_measure=upper)
        elif mode == "entered":
            minimum = classification.number(raw.get("minimum"), "entered grade minimum")
            maximum = classification.number(raw.get("maximum"), "entered grade maximum")
            decision.update(minimum=ds(minimum), maximum=ds(maximum))
        elif mode == "reference_percent":
            below = classification.number(raw.get("below_pct"), "percent below reference", maximum=Decimal(100))
            above = classification.number(raw.get("above_pct"), "percent above reference", maximum=Decimal(1000))
            minimum, maximum = reference * (1 - below / 100), reference * (1 + above / 100)
            decision.update(below_pct=ds(below), above_pct=ds(above))
        else:
            raise Problem("Choose original analysis measures, entered limits or reference percentages")
        rounding = raw.get("rounding")
        if rounding not in {"exact", "half_up_cents"}:
            raise Problem("Choose exact or half_up_cents for each grade's rounding")
        if not minimum <= reference <= maximum:
            raise Problem("The explicit minimum, reference and maximum must be ordered",
                          422, "RANGE_ORDER", {"grade_id": identity})
        rounded = [_rounded(amount, rounding) for amount in (minimum, reference, maximum)]
        adjustments = [ds(final - initial) for final, initial in zip(rounded, (minimum, reference, maximum))]
    decision["rounding"] = rounding
    original_ref = analysis_ref(snapshots[analysis_id])
    grade = {"id": identity, "label": decision["label"],
             "min": ds(rounded[0]), "reference": ds(rounded[1]), "max": ds(rounded[2]),
             "reference_label": decision["reference_label"],
             "source_ref": "Accepted analysis " + analysis_id + " / SHA-256 " + analysis["result_sha256"] +
                           " / review " + snapshots[analysis_id]["accepted_review"]["id"]}
    calculation = {"grade_id": identity, "analysis": original_ref,
                   "original_consensus": analysis["consensus"], "currency": analysis["currency"],
                   "target_date": analysis.get("target_date"), "reference_mode": reference_mode,
                   "reference_measure": reference_measure, "range_mode": mode, "rounding": rounding,
                   "unrounded": {"min": ds(minimum), "reference": ds(reference), "max": ds(maximum)},
                   "result": {key: grade[key] for key in ("min", "reference", "max")},
                   "rounding_adjustments": dict(zip(("min", "reference", "max"), adjustments))}
    return decision, grade, calculation


def build(value, snapshots):
    """Normalize one complete proposal; snapshots are checked by the native host."""
    value = classification.obj(value, "pay-structure proposal")
    header = classification.header(value)
    selected = classification.unique(classification.array(value.get("analyses"), "selected analyses", MAX_ANALYSES),
                                     "analysis_id")
    refs = []
    for raw in selected:
        original_id = raw["analysis_id"]
        if original_id not in snapshots:
            raise Problem("An original accepted analysis is absent from this preview")
        expected = analysis_ref(snapshots[original_id])
        if any(raw.get(key) != expected[key] for key in expected):
            raise Problem("Reopen the exact accepted analysis and review before previewing",
                          409, "ANALYSIS_SELECTION_CHANGED", {"analysis_id": original_id})
        refs.append(expected)
    if set(snapshots) != {ref["analysis_id"] for ref in refs}:
        raise Problem("The retained analysis set differs from the explicit selection")
    currencies = {snapshot["analysis"].get("currency") for snapshot in snapshots.values()}
    currency = classification.text(value.get("currency"), "proposal currency", limit=3).upper()
    if currencies != {currency}:
        raise Problem("A proposed method must retain one original currency; separate different currencies",
                      422, "CURRENCY_MISMATCH", {"selected_currencies": sorted(str(v) for v in currencies)})
    if value.get("rate_basis") != "annual_fulltime":
        raise Problem("Declare annual_fulltime before using the accepted annualized comparisons")
    date_mode = value.get("date_basis")
    date_note = classification.text(value.get("date_basis_note"), "date basis note", blank=True, limit=15000)
    dates = sorted({snapshot["analysis"].get("target_date") or "" for snapshot in snapshots.values()})
    if date_mode == "common_target_date":
        if len(dates) != 1 or not dates[0]:
            raise Problem("Common target date needs the same explicit date on every selected analysis",
                          422, "DATE_BASIS_MISMATCH", {"retained_target_dates": dates})
    elif date_mode == "retained_source_dates":
        if not date_note:
            raise Problem("Record how the proposal uses the retained historical or different source dates")
    else:
        raise Problem("Choose a common target date or explicitly retained source dates")
    decisions, grades, calculations = [], [], []
    for raw in classification.unique(classification.array(value.get("grades"), "grade decisions", 2000)):
        decision, grade, calculation = _grade(raw, snapshots)
        decisions.append(decision)
        grades.append(grade)
        calculations.append(calculation)
    original_refs = header["source_refs"] + [source_ref(snapshots[ref["analysis_id"]]) for ref in refs]
    structure = classification.method({
        **header, "source_refs": original_refs, "mode": "explicit_grades", "currency": currency,
        "rate_basis": "annual_fulltime", "effective_date": value.get("effective_date"),
        "effective_timing": value.get("effective_timing"), "grades": grades, "factors": [], "score_bands": []})
    role_decisions, role_inputs, native_jobs = [], [], set()
    for raw in classification.unique(classification.array(value.get("roles"), "role decisions")):
        analysis_id = classification.identity(raw.get("analysis_id"), "role analysis")
        if analysis_id not in snapshots:
            raise Problem("Every role must select an original analysis included in this proposal")
        snapshot = snapshots[analysis_id]
        job = snapshot["analysis"]["job"]
        if job["id"] in native_jobs:
            raise Problem("Assign each original job once in a proposed role edition", 422, "DUPLICATE_NATIVE_JOB")
        native_jobs.add(job["id"])
        grade_id = classification.identity(raw.get("grade_id"), "selected grade")
        rationale = classification.text(raw.get("rationale"), "role-to-grade rationale", limit=15000)
        decision = {"id": classification.identity(raw.get("id"), "role id"), "analysis_id": analysis_id,
                    "grade_id": grade_id, "rationale": rationale}
        role_decisions.append(decision)
        record = job["record"]
        role_inputs.append({"id": decision["id"], "title": record["title"],
                            "department": record.get("department", ""), "description": record.get("description", ""),
                            "native_job_id": job["id"], "current_grade_id": record.get("grade", ""),
                            "grade_id": grade_id, "rationale": rationale,
                            "source_refs": [source_ref(snapshot),
                                {"label": job["source_name"] + " / " + job["edition"],
                                 "sha256": job["source_sha256"], "native_import_id": job["source_id"],
                                 "note": "Original job " + job["id"] + "; record SHA-256 " + job["sha256"]}]})
    roles = classification.role_set({**header, "name": header["name"],
                                    "source_refs": original_refs, "rows": role_inputs}, structure)
    if roles["errors"]:
        raise Problem("Resolve the role-to-grade decisions before retaining this proposal",
                      422, "ROLE_DECISION_ERRORS", {"errors": roles["errors"]})
    used = {d["analysis_id"] for d in decisions + role_decisions}
    if used != set(snapshots):
        raise Problem("Every selected analysis must support a grade or role; remove unused selections",
                      422, "UNUSED_ANALYSIS", {"unused_analysis_ids": sorted(set(snapshots) - used)})
    warnings = []
    if date_mode == "retained_source_dates":
        warnings.append("The proposal retains the original accepted dates and annualized figures. It applies no additional aging.")
    if any(snapshot["analysis"].get("source_mode") == "historical" for snapshot in snapshots.values()):
        warnings.append("One or more selected analyses explicitly use historical source editions.")
    for snapshot in snapshots.values():
        for warning in snapshot["analysis"].get("warnings", []):
            warnings.append(snapshot["analysis"]["id"] + ": " + str(warning))
    normalized = {**header, "analyses": refs, "currency": currency, "rate_basis": "annual_fulltime",
                  "effective_date": structure["effective_date"], "effective_timing": structure["effective_timing"],
                  "date_basis": date_mode, "date_basis_note": date_note,
                  "source_use_note": classification.text(value.get("source_use_note"), "source use note", blank=True, limit=15000),
                  "grades": decisions, "roles": role_decisions}
    result = {"schema": SCHEMA, "document": normalized, "submitted_document": value,
              "inputs": [snapshots[ref["analysis_id"]] for ref in refs],
              "method": structure, "roles": roles, "grade_calculations": calculations,
              "retained_target_dates": dates, "warnings": warnings, "errors": []}
    result["preview_sha256"] = digest(result)
    return result


def compare(previous, current):
    """Expose complete added/removed/changed decisions by their stable row IDs."""
    result = {}
    for kind in ("grades", "roles"):
        before = {row["id"]: row for row in previous["document"][kind]}
        after = {row["id"]: row for row in current["document"][kind]}
        result[kind] = {"added": [after[key] for key in after.keys() - before.keys()],
                        "removed": [before[key] for key in before.keys() - after.keys()],
                        "changed": [{"id": key, "before": before[key], "after": after[key]}
                                    for key in sorted(before.keys() & after.keys()) if before[key] != after[key]]}
        result[kind]["added"].sort(key=lambda row: row["id"])
        result[kind]["removed"].sort(key=lambda row: row["id"])
    result["header_changes"] = {key: {"before": previous["document"].get(key), "after": current["document"].get(key)}
                               for key in current["document"] if key not in {"grades", "roles"}
                               and previous["document"].get(key) != current["document"].get(key)}
    return result
