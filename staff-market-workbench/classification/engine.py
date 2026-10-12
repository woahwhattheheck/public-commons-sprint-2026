"""Classification and workforce scenarios over explicit retained source editions.

Rates are annual full-time rates. These retained planning decisions do not write
to a payroll, job or personnel system.
"""
from __future__ import annotations

import csv
from datetime import date, timedelta
from decimal import Decimal, ROUND_HALF_UP, localcontext
import io
import re
from core import Problem, dec, digest, ds, iso_date, required, strict_json

SCHEMA = "staff-market.classification/v1"
MAX_ROWS = 25000
ZERO, ONE, HUNDRED = Decimal(0), Decimal(1), Decimal(100)
CENT = Decimal("0.01")
KINDS = {"method", "roles", "roster", "scenario"}


def obj(value, field):
    if not isinstance(value, dict):
        raise Problem(field + " must be an object")
    return value


def array(value, field, maximum=MAX_ROWS, empty=False):
    if not isinstance(value, list) or len(value) > maximum or (not value and not empty):
        raise Problem(field + " must contain " + ("0" if empty else "1") + "–" + str(maximum) + " rows")
    return value


def number(value, field, minimum=ZERO, maximum=Decimal("1e20"), blank=False):
    result = dec(value, field, blank=blank)
    if result is not None and not minimum <= result <= maximum:
        raise Problem(field + " must be between " + ds(minimum) + " and " + ds(maximum))
    return result


def money(value):
    return ds(value.quantize(CENT, rounding=ROUND_HALF_UP))


def text(value, field, blank=False, limit=10000):
    if blank and value in (None, ""):
        return ""
    return required(value, field, limit)


def identity(value, field):
    return text(value, field, limit=200)


def unique(rows, field="id"):
    seen = set()
    for row in rows:
        key = identity(obj(row, "row").get(field), field)
        if key in seen:
            raise Problem("Duplicate " + field + ": " + key)
        seen.add(key)
    return rows


def source_refs(value):
    result = []
    for row in array(value or [], "source_refs", 500, empty=True):
        row = obj(row, "source reference")
        ref = {k: str(v) for k, v in row.items() if k in
               {"label", "url", "page", "as_of", "sha256", "native_import_id", "note"} and v not in (None, "")}
        if "url" in ref and not re.match(r"https?://", ref["url"]):
            raise Problem("Source URLs must use http or https")
        if "sha256" in ref and not re.fullmatch(r"[0-9a-f]{64}", ref["sha256"]):
            raise Problem("Source SHA-256 must be 64 lower-case hexadecimal characters")
        if "as_of" in ref:
            iso_date(ref["as_of"], "source as_of")
        result.append(ref)
    return result


def header(value):
    value = obj(value, "source document")
    return {"name": text(value.get("name"), "name", limit=300),
            "edition": text(value.get("edition"), "edition", blank=True, limit=300),
            "basis": text(value.get("basis"), "basis", limit=30000),
            "source_refs": source_refs(value.get("source_refs"))}


def method(value):
    value = obj(value, "method")
    result = header(value)
    mode = value.get("mode", "explicit_grades")
    if mode not in {"explicit_grades", "point_factors"}:
        raise Problem("Choose explicit_grades or point_factors")
    currency = text(value.get("currency"), "currency", limit=3).upper()
    if not re.fullmatch(r"[A-Z]{3}", currency):
        raise Problem("Use a three-letter currency code")
    if value.get("rate_basis") != "annual_fulltime":
        raise Problem("Declare annual_fulltime rate_basis before using this pay structure")
    effective_date = text(value.get("effective_date"), "effective_date", blank=True, limit=10)
    effective_timing = text(value.get("effective_timing"), "effective_timing", blank=True, limit=10000)
    if effective_date:
        effective_date = str(iso_date(effective_date, "effective_date"))
    if not effective_date and not effective_timing:
        raise Problem("Declare an effective calendar date or the original source timing")
    result.update(mode=mode, currency=currency, rate_basis="annual_fulltime",
                  effective_date=effective_date, effective_timing=effective_timing)
    grades = []
    for row in unique(array(value.get("grades"), "grades", 2000)):
        lo, ref, hi = [number(row.get(k), "grade " + k) for k in ("min", "reference", "max")]
        if not lo <= ref <= hi:
            raise Problem("Each grade must have minimum ≤ reference ≤ maximum")
        grades.append({"id": identity(row.get("id"), "grade id"),
                       "label": text(row.get("label") or row.get("id"), "grade label", limit=300),
                       "min": ds(lo), "reference": ds(ref), "max": ds(hi),
                       "reference_label": text(row.get("reference_label") or "Market / reference", "reference label", limit=200),
                       "source_ref": row.get("source_ref", "")})
    factors = []
    for raw in unique(array(value.get("factors", []), "factors", 50, empty=mode == "explicit_grades")):
        levels = []
        for level in unique(array(raw.get("levels"), "factor levels", 100)):
            levels.append({"id": identity(level.get("id"), "level id"),
                           "label": text(level.get("label"), "level label", limit=2000),
                           "points": ds(number(level.get("points"), "level points", maximum=Decimal("1e8")))})
        factors.append({"id": identity(raw.get("id"), "factor id"),
                        "label": text(raw.get("label"), "factor label", limit=2000),
                        "definition": text(raw.get("definition"), "factor definition", limit=10000),
                        "levels": levels})
    bands, valid_grades = [], {g["id"] for g in grades}
    for row in array(value.get("score_bands", []), "score_bands", 2000, empty=mode == "explicit_grades"):
        row = obj(row, "score band")
        grade_id = identity(row.get("grade_id"), "band grade_id")
        if grade_id not in valid_grades:
            raise Problem("A score band references an absent grade")
        lo = number(row.get("min_points"), "minimum points", maximum=Decimal("1e12"))
        hi = number(row.get("max_points"), "maximum points", maximum=Decimal("1e12"))
        if hi < lo:
            raise Problem("A score band's maximum is below its minimum")
        bands.append({"grade_id": grade_id, "min_points": ds(lo), "max_points": ds(hi)})
    ordered = sorted(bands, key=lambda b: dec(b["min_points"]))
    for previous, current in zip(ordered, ordered[1:]):
        if dec(previous["max_points"]) >= dec(current["min_points"]):
            raise Problem("Inclusive score bands must not overlap")
    result.update(grades=grades, factors=factors, score_bands=ordered)
    return result


def role_set(value, structure):
    result = header(value)
    grades = {g["id"]: g for g in structure["grades"]}
    factors = {f["id"]: f for f in structure["factors"]}
    evaluated = []
    for raw in unique(array(value.get("rows"), "roles")):
        row = {"id": identity(raw.get("id"), "role id"),
               "title": text(raw.get("title"), "role title", limit=500),
               "department": text(raw.get("department"), "department", blank=True, limit=300),
               "description": text(raw.get("description"), "description", blank=True, limit=40000),
               "rationale": text(raw.get("rationale"), "classification rationale", limit=15000),
               "source_refs": source_refs(raw.get("source_refs")),
               "current_grade_id": text(raw.get("current_grade_id"), "current grade", blank=True, limit=200)}
        if raw.get("native_job_id"):
            row["native_job_id"] = identity(raw["native_job_id"], "native job id")
        errors, warnings, ratings, points, computed = [], [], [], None, None
        selected = text(raw.get("grade_id"), "grade id", blank=True, limit=200)
        if structure["mode"] == "point_factors":
            by_factor = {r["factor_id"]: r for r in
                         unique(array(raw.get("ratings", []), "ratings", 50, empty=True), "factor_id")}
            unknown = set(by_factor) - set(factors)
            if unknown:
                errors.append("Unknown rating factors: " + ", ".join(sorted(unknown)))
            points = ZERO
            for factor_id, factor in factors.items():
                rating = by_factor.get(factor_id)
                level = next((level for level in factor["levels"]
                              if rating and level["id"] == rating.get("level_id")), None)
                if not level:
                    errors.append("Select an original level for " + factor["label"])
                    continue
                evidence = text(rating.get("evidence"), "rating evidence", blank=True, limit=15000)
                if not evidence:
                    errors.append("Add the job-content basis for " + factor["label"])
                ratings.append({"factor_id": factor_id, "factor_label": factor["label"],
                                "level_id": level["id"], "level_label": level["label"],
                                "points": level["points"], "evidence": evidence})
                points += dec(level["points"])
            if not errors:
                computed = next((b["grade_id"] for b in structure["score_bands"]
                                 if dec(b["min_points"]) <= points <= dec(b["max_points"])), None)
                if not computed:
                    errors.append("Total points do not fall in a configured grade band")
            if not selected:
                selected = computed
            elif computed and selected != computed:
                override = text(raw.get("grade_override_rationale"), "grade override rationale", blank=True, limit=15000)
                if not override:
                    errors.append("Selected grade differs from the point band; record the classification override rationale")
                row["grade_override_rationale"] = override
                warnings.append("Professional grade override differs from the calculated band")
        if selected not in grades:
            errors.append("Select a grade from the exact retained method")
        row.update(grade_id=selected, grade=grades.get(selected), points=ds(points),
                   computed_grade_id=computed, ratings=ratings, errors=errors, warnings=warnings)
        evaluated.append(row)
    result.update(rows=evaluated, errors=[r["id"] + ": " + e for r in evaluated for e in r["errors"]],
                  warnings=[r["id"] + ": " + e for r in evaluated for e in r["warnings"]])
    return result


def roster(value, roles):
    result = header(value)
    kind = value.get("data_kind")
    if kind not in {"employee_rates", "planning_cohort"}:
        raise Problem("Declare employee_rates or planning_cohort data_kind")
    if value.get("rate_basis") != "annual_fulltime":
        raise Problem("Declare annual_fulltime rate_basis before multiplying workforce rates by FTE")
    currency = text(value.get("currency"), "currency", limit=3).upper()
    if not re.fullmatch(r"[A-Z]{3}", currency):
        raise Problem("Use a three-letter currency code")
    valid_roles = {row["id"] for row in roles["rows"]}
    result.update(data_kind=kind, currency=currency, rate_basis="annual_fulltime",
                  as_of=str(iso_date(value.get("as_of"), "as_of")))
    rows, errors, warnings = [], [], []
    for raw in unique(array(value.get("rows"), "workforce rows")):
        row_id, role = identity(raw.get("id"), "workforce row id"), identity(raw.get("role_id"), "role_id")
        fte = number(raw.get("fte"), "FTE", maximum=Decimal(100000))
        if fte <= 0:
            raise Problem("FTE must be greater than zero")
        base = number(raw.get("annual_base_rate"), "annual full-time base rate")
        incentive = number(raw.get("annual_incentive_rate"), "annual full-time incentive rate", blank=True)
        years = number(raw.get("credited_years"), "credited years", maximum=Decimal(100), blank=True)
        target = number(raw.get("proposed_annual_base_rate"), "proposed annual full-time base rate", blank=True)
        row = {"id": row_id, "role_id": role, "fte": ds(fte), "annual_base_rate": ds(base),
               "annual_incentive_rate": ds(incentive), "credited_years": ds(years),
               "proposed_annual_base_rate": ds(target),
               "manager_id": text(raw.get("manager_id"), "manager id", blank=True, limit=200),
               "current_grade_id": text(raw.get("current_grade_id"), "current grade", blank=True, limit=200),
               "source_ref": raw.get("source_ref", ""),
               "placement_rationale": text(raw.get("placement_rationale"), "placement rationale", blank=True, limit=15000)}
        if role not in valid_roles:
            errors.append(row_id + ": role is absent from the selected classification edition")
        if kind == "employee_rates" and fte > ONE:
            warnings.append(row_id + ": FTE exceeds 1.0; confirm the declared rate and employment basis")
        rows.append(row)
    by_id = {r["id"]: r for r in rows}
    for row in rows:
        manager, seen = row["manager_id"], {row["id"]}
        while manager and manager in by_id:
            if manager in seen:
                errors.append(row["id"] + ": reporting relationships contain a cycle")
                break
            seen.add(manager)
            manager = by_id[manager]["manager_id"]
        if row["manager_id"] and row["manager_id"] not in by_id:
            warnings.append(row["id"] + ": manager is outside this retained workforce edition")
    result.update(rows=rows, total_fte=ds(sum((dec(r["fte"]) for r in rows), ZERO)), errors=errors, warnings=warnings)
    return result


def read_rows(content, format_name):
    if not isinstance(content, str) or len(content.encode("utf-8")) > 24 * 1024 * 1024:
        raise Problem("Import text must be no larger than 24 MiB")
    if format_name == "json":
        parsed = strict_json(content.lstrip("\ufeff"))
        rows = parsed.get("rows") if isinstance(parsed, dict) else parsed
    elif format_name == "csv":
        reader = csv.DictReader(io.StringIO(content.lstrip("\ufeff"), newline=""))
        headers = reader.fieldnames or []
        if not headers or len(set(headers)) != len(headers) or any(not h for h in headers):
            raise Problem("CSV needs nonblank, unique header names")
        rows = []
        for index, row in enumerate(reader, 2):
            if index > MAX_ROWS + 1:
                raise Problem("The import exceeds the row limit")
            if None in row or any(v is None for v in row.values()):
                raise Problem("CSV row " + str(index) + " differs from the header width")
            if any(v.strip() for v in row.values()):
                rows.append(row)
    else:
        raise Problem("Choose csv or json import format")
    return {"rows": array(rows, "import rows"), "raw_sha256": digest(content.encode("utf-8")),
            "content": content, "format": format_name}


def mapped_rows(parsed, mapping):
    if mapping is None:
        return parsed["rows"]
    mapping = obj(mapping, "column mapping")
    if any(not isinstance(k, str) or not isinstance(v, str) for k, v in mapping.items()):
        raise Problem("Column mapping must map destination fields to original header names")
    return [{dest: row.get(source, "") for dest, source in mapping.items()} for row in parsed["rows"]]


def scenario_config(value):
    value = obj(value, "scenario configuration")
    result = {"title": text(value.get("title"), "scenario title", limit=300),
              "purpose": text(value.get("purpose"), "scenario purpose", limit=20000)}
    strategy = value.get("placement", "minimum_floor")
    if strategy not in {"minimum_floor", "range_position", "experience", "manual"}:
        raise Problem("Choose minimum_floor, range_position, experience, or manual placement")
    start, end = iso_date(value.get("period_start"), "period_start"), iso_date(value.get("period_end"), "period_end")
    if end < start or (end - start).days > 3660:
        raise Problem("The cost period must be ordered and no longer than ten years")
    day_basis = value.get("day_basis", "actual_actual")
    if day_basis not in {"actual_actual", "actual_365"}:
        raise Problem("Choose actual_actual or actual_365 day basis")
    include, reductions = value.get("include_incentives", False), value.get("allow_explicit_reductions", False)
    if not isinstance(include, bool) or not isinstance(reductions, bool):
        raise Problem("Scenario switches must be boolean values")
    result.update(placement=strategy, period_start=str(start), period_end=str(end), day_basis=day_basis,
                  include_incentives=include, allow_explicit_reductions=reductions,
                  burden_pct=ds(number(value.get("burden_pct", "0"), "incremental burden percent", maximum=Decimal(500))),
                  burden_basis=text(value.get("burden_basis"), "burden basis", limit=15000),
                  minimum_manager_gap_pct=ds(number(value.get("minimum_manager_gap_pct", "0"), "manager gap percent", maximum=HUNDRED)),
                  experience_pct_per_year=ds(number(value.get("experience_pct_per_year", "0"), "experience percent per year", maximum=HUNDRED)),
                  maximum_credited_years=ds(number(value.get("maximum_credited_years", "0"), "maximum credited years", maximum=HUNDRED)))
    phases, last_date, last_share = [], None, Decimal(-1)
    for raw in array(value.get("phases"), "implementation phases", 120):
        raw = obj(raw, "phase")
        effective = iso_date(raw.get("effective_date"), "phase effective_date")
        share = number(raw.get("share_pct"), "cumulative implementation percent", maximum=HUNDRED)
        if last_date is not None and (effective <= last_date or share < last_share):
            raise Problem("Phase dates must increase and cumulative shares must not decrease")
        phases.append({"effective_date": str(effective), "share_pct": ds(share)})
        last_date, last_share = effective, share
    rules = []
    for raw in unique(array(value.get("incentive_rules", []), "incentive rules", 500, empty=True)):
        role_ids = array(raw.get("role_ids"), "incentive role_ids", MAX_ROWS)
        if any(not isinstance(x, str) or not x for x in role_ids) or len(set(role_ids)) != len(role_ids):
            raise Problem("Incentive role IDs must be nonblank and unique")
        rules.append({"id": identity(raw.get("id"), "incentive id"),
                      "label": text(raw.get("label"), "incentive label", limit=300), "role_ids": role_ids,
                      "annual_flat_rate": ds(number(raw.get("annual_flat_rate", "0"), "annual incentive rate")),
                      "base_pct": ds(number(raw.get("base_pct", "0"), "incentive percent of base", maximum=HUNDRED)),
                      "basis": text(raw.get("basis"), "incentive basis", limit=10000)})
    result.update(phases=phases, incentive_rules=rules)
    return result


def _segments(config):
    start = date.fromisoformat(config["period_start"])
    end = date.fromisoformat(config["period_end"]) + timedelta(days=1)
    boundaries = {start, end}
    for phase in config["phases"]:
        effective = date.fromisoformat(phase["effective_date"])
        if start < effective < end:
            boundaries.add(effective)
    if config["day_basis"] == "actual_actual":
        for year in range(start.year + 1, end.year + 1):
            boundary = date(year, 1, 1)
            if start < boundary < end:
                boundaries.add(boundary)
    ordered, result = sorted(boundaries), []
    for a, b in zip(ordered, ordered[1:]):
        share = ZERO
        for phase in config["phases"]:
            if date.fromisoformat(phase["effective_date"]) <= a:
                share = dec(phase["share_pct"]) / HUNDRED
        denominator = (date(a.year + 1, 1, 1) - date(a.year, 1, 1)).days if config["day_basis"] == "actual_actual" else 365
        result.append({"start": str(a), "end": str(b - timedelta(days=1)), "days": (b - a).days,
                       "annual_day_denominator": denominator, "share_pct": ds(share * HUNDRED),
                       "annual_fraction": ds(Decimal((b - a).days) / Decimal(denominator))})
    return result


def scenario(structure, roles, workforce, config, baseline=None):
    config = scenario_config(config)
    if workforce["currency"] != structure["currency"]:
        raise Problem("Workforce and proposed pay-structure currencies differ")
    if baseline and baseline["currency"] != structure["currency"]:
        raise Problem("Baseline and proposed pay-structure currencies differ")
    errors = list(roles.get("errors", [])) + list(workforce.get("errors", []))
    warnings = list(roles.get("warnings", [])) + list(workforce.get("warnings", []))
    by_role = {r["id"]: r for r in roles["rows"]}
    grades = {g["id"]: g for g in structure["grades"]}
    old_grades = {g["id"]: g for g in (baseline or structure)["grades"]}
    for rule in config["incentive_rules"]:
        if set(rule["role_ids"]) - set(by_role):
            raise Problem("An incentive rule references an absent role")
    if config["placement"] == "range_position" and baseline is None:
        raise Problem("Range-position placement requires the explicit original baseline structure")
    with localcontext() as context:
        context.prec = 50
        segments = _segments(config)
        full_multiplier = sum((dec(s["annual_fraction"]) * dec(s["share_pct"]) / HUNDRED for s in segments), ZERO)
        burden, rows = dec(config["burden_pct"]) / HUNDRED, []
        for employee in workforce["rows"]:
            role = by_role.get(employee["role_id"])
            grade = grades.get(role.get("grade_id")) if role else None
            if not role or not grade:
                continue
            current, fte = dec(employee["annual_base_rate"]), dec(employee["fte"])
            lo, hi = dec(grade["min"]), dec(grade["max"])
            target = max(current, lo)
            exceptions, line_errors = [], []
            strategy_detail = {"placement": config["placement"], "floor": grade["min"], "ceiling": grade["max"]}
            if config["placement"] == "range_position":
                old_id = employee.get("current_grade_id") or role.get("current_grade_id")
                old = old_grades.get(old_id)
                if not old:
                    line_errors.append("Select the exact original baseline grade for range-position placement")
                else:
                    old_lo, old_hi = dec(old["min"]), dec(old["max"])
                    if old_hi == old_lo:
                        line_errors.append("The baseline fixed-rate grade has no range penetration; select another placement rule")
                    else:
                        fraction = (current - old_lo) / (old_hi - old_lo)
                        proposed = lo + min(ONE, max(ZERO, fraction)) * (hi - lo)
                        target = max(current, proposed)
                        strategy_detail.update(baseline_grade=old, original_range_position=ds(fraction), calculated_rate=ds(proposed))
            elif config["placement"] == "experience":
                years = dec(employee["credited_years"], "credited years", blank=True)
                if years is None:
                    line_errors.append("Record credited years before applying the experience rule")
                else:
                    credited = min(years, dec(config["maximum_credited_years"]))
                    proposed = min(hi, lo * (ONE + credited * dec(config["experience_pct_per_year"]) / HUNDRED))
                    target = max(current, proposed)
                    strategy_detail.update(credited_years=ds(credited), calculated_rate=ds(proposed))
            elif config["placement"] == "manual":
                proposed = dec(employee["proposed_annual_base_rate"], "proposed rate", blank=True)
                if proposed is None or not employee["placement_rationale"]:
                    line_errors.append("Record a proposed rate and placement rationale for this manual decision")
                else:
                    target = proposed
                    if target < current and not config["allow_explicit_reductions"]:
                        line_errors.append("This explicit proposal reduces base pay; enable the scenario reduction option to review it")
                    strategy_detail["placement_rationale"] = employee["placement_rationale"]
            if current < lo:
                exceptions.append("Current base is below the proposed minimum")
            if current > hi:
                exceptions.append("Current base is above the proposed maximum; automatic placement retains existing pay")
            if target < lo or target > hi:
                exceptions.append("Proposed base is outside the proposed grade range")
            if target < current:
                exceptions.append("Explicit base-pay reduction")
            current_incentive, proposed_incentive, applied = ZERO, ZERO, []
            if config["include_incentives"]:
                current_incentive = dec(employee["annual_incentive_rate"], "annual incentive rate", blank=True)
                if current_incentive is None:
                    line_errors.append("Record the current full-time incentive rate or explicitly enter zero")
                    current_incentive = ZERO
                applicable = [r for r in config["incentive_rules"] if role["id"] in r["role_ids"]]
                proposed_incentive = current_incentive if not applicable else ZERO
                for rule in applicable:
                    amount = dec(rule["annual_flat_rate"]) + target * dec(rule["base_pct"]) / HUNDRED
                    proposed_incentive += amount
                    applied.append({"id": rule["id"], "label": rule["label"], "annual_rate": ds(amount), "basis": rule["basis"]})
                if proposed_incentive < current_incentive:
                    exceptions.append("Proposed incentive is lower than the original incentive")
            base_delta, incentive_delta = (target - current) * fte, (proposed_incentive - current_incentive) * fte
            period_base, period_incentive = base_delta * full_multiplier, incentive_delta * full_multiplier
            period_burden = (period_base + period_incentive) * burden
            rounded_total = money(period_base + period_incentive + period_burden)
            rounding_adjustment = dec(rounded_total) - sum(
                (dec(money(value)) for value in (period_base, period_incentive, period_burden)), ZERO)
            row = {"id": employee["id"], "role_id": role["id"], "role_title": role["title"],
                   "department": role["department"], "grade_id": grade["id"], "fte": employee["fte"],
                   "current_annual_base_rate": ds(current), "proposed_annual_base_rate": ds(target),
                   "current_annual_incentive_rate": ds(current_incentive) if config["include_incentives"] else None,
                   "proposed_annual_incentive_rate": ds(proposed_incentive) if config["include_incentives"] else None,
                   "annual_base_delta": ds(base_delta), "annual_incentive_delta": ds(incentive_delta),
                   "annual_incremental_cost": ds((base_delta + incentive_delta) * (ONE + burden)),
                   "period_base_delta": money(period_base), "period_incentive_delta": money(period_incentive),
                   "period_burden": money(period_burden), "period_rounding_adjustment": money(rounding_adjustment),
                   "period_total": rounded_total,
                   "exact_period_total": ds(period_base + period_incentive + period_burden),
                   "strategy": strategy_detail, "incentives": applied, "source": employee,
                   "exceptions": exceptions, "errors": line_errors}
            errors.extend(row["id"] + ": " + e for e in line_errors)
            rows.append(row)
        by_id, relationships = {r["id"]: r for r in rows}, []
        for row in rows:
            manager_id = row["source"].get("manager_id")
            manager = by_id.get(manager_id)
            if not manager:
                continue
            subordinate_rate, manager_rate = dec(row["proposed_annual_base_rate"]), dec(manager["proposed_annual_base_rate"])
            gap = ((manager_rate / subordinate_rate) - ONE) * HUNDRED if subordinate_rate else None
            required_gap = dec(config["minimum_manager_gap_pct"])
            flag = gap is not None and gap < required_gap
            relationships.append({"manager_id": manager_id, "subordinate_id": row["id"], "base_gap_pct": ds(gap),
                                  "requested_minimum_gap_pct": ds(required_gap), "review_required": flag})
            if flag:
                row["exceptions"].append("Proposed supervisor base differential is below the scenario's review threshold")
        total = {field: ds(sum((dec(r[field]) for r in rows), ZERO)) for field in
                 ("annual_base_delta", "annual_incentive_delta", "annual_incremental_cost", "period_base_delta",
                  "period_incentive_delta", "period_burden", "period_rounding_adjustment", "period_total")}
        total.update(rows=len(rows), total_fte=ds(sum((dec(r["fte"]) for r in rows), ZERO)),
                     current_annual_base=ds(sum((dec(r["current_annual_base_rate"]) * dec(r["fte"]) for r in rows), ZERO)),
                     proposed_annual_base=ds(sum((dec(r["proposed_annual_base_rate"]) * dec(r["fte"]) for r in rows), ZERO)),
                     exception_rows=sum(bool(r["exceptions"]) for r in rows),
                     period_annual_increment_multiplier=ds(full_multiplier))
        departments = []
        for department in sorted({r["department"] for r in rows}):
            selected = [r for r in rows if r["department"] == department]
            departments.append({"department": department, "rows": len(selected),
                                "fte": ds(sum((dec(r["fte"]) for r in selected), ZERO)),
                                "period_total": ds(sum((dec(r["period_total"]) for r in selected), ZERO)),
                                "annual_incremental_cost": ds(sum((dec(r["annual_incremental_cost"]) for r in selected), ZERO))})
        if dec(config["phases"][-1]["share_pct"]) < HUNDRED:
            warnings.append("The final configured phase implements less than 100% of the proposed change")
        result = {"schema": SCHEMA, "currency": structure["currency"], "rate_basis": "annual_fulltime",
                  "data_kind": workforce["data_kind"], "workforce_basis": workforce["basis"], "config": config,
                  "rows": rows, "totals": total, "departments": departments, "relationships": relationships,
                  "segments": segments, "errors": errors, "warnings": warnings,
                  "rounding": "Each workforce row's period total rounds half-up to cents. The explicit rounding adjustment reconciles its separately rounded base, incentive and burden components to that total; summaries sum the displayed row amounts. Annual rates and exact intermediate values remain in this document."}
        result["preview_sha256"] = digest(result)
        return result


def csv_export(rows):
    columns = ["id", "role_id", "role_title", "department", "grade_id", "fte", "current_annual_base_rate",
               "proposed_annual_base_rate", "current_annual_incentive_rate", "proposed_annual_incentive_rate",
               "annual_base_delta", "annual_incentive_delta", "annual_incremental_cost", "period_base_delta",
               "period_incentive_delta", "period_burden", "period_rounding_adjustment", "period_total", "exceptions"]
    output = io.StringIO(newline="")
    writer = csv.DictWriter(output, fieldnames=columns, lineterminator="\r\n")
    writer.writeheader()
    for row in rows:
        result = {k: "; ".join(row[k]) if isinstance(row.get(k), list) else row.get(k, "") for k in columns}
        for key, value in result.items():
            if isinstance(value, str) and value.startswith(("=", "+", "-", "@")) and not re.fullmatch(r"-?\d+(\.\d+)?", value):
                result[key] = "'" + value
        writer.writerow(result)
    return output.getvalue().encode("utf-8")
