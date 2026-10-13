"""Compare two retained Economic editions without changing their calculations."""
from __future__ import annotations

from copy import deepcopy
from decimal import Decimal, localcontext
import csv
import io
import json
import math

SCHEMA = "upstate.economic-edition-comparison/v1"
EDITION_SCHEMA = "upstate.economic-edition/v1"
REPORT_SCHEMA = "upstate.decision-report/v1"
VERSION = "economic-edition-comparison-20261013-v1"


def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True,
                      separators=(",", ":"), allow_nan=False)


def require(value, message):
    if not value:
        raise ValueError(message)


def same(first, second):
    return canonical(first) == canonical(second)


def changes(first, second, path=""):
    """Keep every original value; missing fields remain distinct from JSON null."""
    if same(first, second):
        return []
    if isinstance(first, dict) and isinstance(second, dict):
        result = []
        for key in sorted(set(first) | set(second)):
            pointer = path + "/" + key.replace("~", "~0").replace("/", "~1")
            left, right = key in first, key in second
            if left and right:
                result.extend(changes(first[key], second[key], pointer))
            else:
                result.append({"path": pointer, "kind": "removed" if left else "added",
                               "first_present": left, "second_present": right,
                               "first": deepcopy(first.get(key)),
                               "second": deepcopy(second.get(key))})
        return result
    return [{"path": path or "/", "kind": "changed", "first_present": True,
             "second_present": True, "first": deepcopy(first), "second": deepcopy(second)}]


def summary(edition):
    fields = ("id", "title", "created_at", "producer_report_id", "zone_id",
              "zone_title", "report_id", "candidate_count", "costed_count")
    result = {key: deepcopy(edition.get(key)) for key in fields}
    result["report_sha256"] = edition["input"]["report_sha256"]
    return result


def _rows(report):
    rows = report["alternatives"]
    require(isinstance(rows, list), "Retain the original complete alternative list.")
    result = {}
    for row in rows:
        require(isinstance(row, dict) and isinstance(row.get("run_id"), str)
                and row["run_id"] not in result, "Each original alternative needs one distinct run ID.")
        result[row["run_id"]] = row
    return result


def _cost_inputs(edition):
    result = {}
    for row in edition["input"]["selection"].get("costs", []):
        require(isinstance(row, dict) and row.get("run_id") not in result,
                "Retain each original cost input once.")
        result[row["run_id"]] = row
    return result


def _number(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def _delta(first, second, comparable, reason=""):
    available = _number(first) and _number(second)
    ok = bool(comparable and available)
    delta = None
    if ok:
        left, right = Decimal(str(first)), Decimal(str(second))
        with localcontext() as context:
            context.prec = max(28, len(left.as_tuple().digits), len(right.as_tuple().digits)) + abs(left.as_tuple().exponent - right.as_tuple().exponent) + 3
            result = right - left
            delta = "0" if result == 0 else format(result, "f")
    return {"first": deepcopy(first), "second": deepcopy(second),
            "delta_decimal": delta, "comparable": ok,
            "reason": "" if ok else (reason or "Both original amounts are required.")}


def _scope(edition, cost):
    if not isinstance(cost, dict):
        return None
    value = cost.get("scope")
    if not isinstance(value, dict):
        return None
    kind = value.get("kind")
    if kind == "whole_scenario":
        return {"kind": kind, "run_id": cost["run_id"]}
    if kind == "reporting_zone":
        return {"kind": kind, "producer_report_id": value.get("producer_report_id"),
                "zone_id": value.get("zone_id"), "report_sha256": edition["input"]["report_sha256"],
                "run_id": cost["run_id"]}
    return None


def _cost_comparison(first_edition, second_edition, first, second, first_input, second_input):
    left, right = first.get("cost") if first else None, second.get("cost") if second else None
    both = isinstance(left, dict) and isinstance(right, dict)
    currency = bool(both and left.get("currency") == right.get("currency"))
    left_scope, right_scope = _scope(first_edition, first_input), _scope(second_edition, second_input)
    scope = bool(left_scope is not None and right_scope is not None and same(left_scope, right_scope))
    horizon = bool(both and left.get("horizon_years") == right.get("horizon_years"))
    rate = bool(both and left.get("discount_rate") == right.get("discount_rate"))
    reasons = []
    if not both:
        reasons.append("One or both original editions have no cost for this scenario.")
    if both and not currency:
        reasons.append("Original cost currencies differ; no currency conversion is applied.")
    if both and not scope:
        reasons.append("The original cost footprints differ or are unstated; amounts remain side by side.")
    if both and not horizon:
        reasons.append("Original planning horizons differ.")
    if both and not rate:
        reasons.append("Original real discount rates differ.")
    base_ok = both and currency and scope
    amounts = {}
    for name in ("capital", "annual_operating", "annualized", "present_value"):
        comparable = base_ok and (name in {"capital", "annual_operating"} or horizon and rate)
        reason = "; ".join(reasons) if not comparable else ""
        amounts[name] = _delta(left.get(name) if left else None,
                               right.get(name) if right else None, comparable, reason)
    return {"first_input": deepcopy(first_input), "second_input": deepcopy(second_input),
            "matching_currency": currency, "matching_scope": scope,
            "matching_horizon": horizon, "matching_discount_rate": rate,
            "deltas": amounts, "reasons": reasons}


def compare_editions(first, second, *, title=None):
    for edition in (first, second):
        require(isinstance(edition, dict) and edition.get("schema") == EDITION_SCHEMA
                and isinstance(edition.get("input"), dict)
                and isinstance(edition["input"].get("selection"), dict)
                and edition.get("report", {}).get("schema") == REPORT_SCHEMA,
                "Choose two original complete saved Economic editions.")
        canonical(edition)
    require(first["id"] != second["id"], "Choose two different saved Economic editions.")
    if title is None:
        left_title = str(first.get("title") or first["id"][:12])
        right_title = str(second.get("title") or second["id"][:12])
        shorten = lambda value: value if len(value) <= 240 else value[:237] + "..."
        title = shorten(left_title) + " to " + shorten(right_title)
    require(isinstance(title, str) and bool(title.strip()) and len(title) <= 500,
            "Give this comparison a nonblank title within 500 characters.")
    left_report, right_report = first["report"], second["report"]
    left_rows, right_rows = _rows(left_report), _rows(right_report)
    left_costs, right_costs = _cost_inputs(first), _cost_inputs(second)
    checks = []

    def check(key, label, left, right):
        checks.append({"key": key, "label": label, "equal": same(left, right),
                       "first": deepcopy(left), "second": deepcopy(right)})

    check("native_report", "Original native report", first["input"]["report_id"], second["input"]["report_id"])
    check("native_report_sha256", "Original native report bytes",
          first["input"]["report_sha256"], second["input"]["report_sha256"])
    check("reporting_zone", "Original reporting zone", first["input"]["zone_id"], second["input"]["zone_id"])
    check("project", "Original project", left_report.get("project"), right_report.get("project"))
    check("physical_scope", "Original physical comparison scope", left_report["scope"], right_report["scope"])
    check("baseline", "Original baseline", left_report["baseline"], right_report["baseline"])
    check("alternative_cohort", "Original alternative cohort", sorted(left_rows), sorted(right_rows))
    check("physical_outputs", "Original physical quantities and support",
          {key: row["outputs"] for key, row in left_rows.items()},
          {key: row["outputs"] for key, row in right_rows.items()})
    physical = all(item["equal"] for item in checks)
    reasons = [item["label"] + " differs." for item in checks if not item["equal"]]
    scenarios = []
    ids = list(left_rows) + [key for key in right_rows if key not in left_rows]
    for run_id in ids:
        left, right = left_rows.get(run_id), right_rows.get(run_id)
        row_changes = changes({"alternative": left, "cost_input": left_costs.get(run_id)},
                              {"alternative": right, "cost_input": right_costs.get(run_id)})
        status = "added" if left is None else "removed" if right is None else "changed" if row_changes else "unchanged"
        decisions = changes(left.get("decision") if left else None,
                            right.get("decision") if right else None)
        left_outputs, right_outputs = left.get("outputs") if left else None, right.get("outputs") if right else None
        scenarios.append({
            "run_id": run_id, "label": (right or left).get("label") or run_id,
            "status": status, "first": deepcopy(left), "second": deepcopy(right),
            "changes": row_changes, "decision_changes": decisions,
            "physical_comparison": {"equal": bool(left and right and same(left_outputs, right_outputs)),
                                    "comparable": bool(physical and left and right),
                                    "changes": changes(left_outputs, right_outputs)},
            "cost_comparison": _cost_comparison(first, second, left, right,
                                                left_costs.get(run_id), right_costs.get(run_id)),
        })
    result = {
        "schema": SCHEMA, "version": VERSION, "title": title.strip(),
        "direction": "second_minus_first",
        "first": summary(first), "second": summary(second),
        "comparability": {"physical": physical, "checks": checks, "reasons": reasons},
        "summary": {"scenario_count": len(scenarios),
                    "matched_count": sum(row["first"] is not None and row["second"] is not None for row in scenarios),
                    "added_count": sum(row["status"] == "added" for row in scenarios),
                    "removed_count": sum(row["status"] == "removed" for row in scenarios),
                    "changed_count": sum(row["status"] == "changed" for row in scenarios),
                    "cost_changed_count": sum(not same(row["cost_comparison"]["first_input"],
                                                      row["cost_comparison"]["second_input"])
                                              or not same((row["first"] or {}).get("cost"),
                                                          (row["second"] or {}).get("cost")) for row in scenarios),
                    "decision_changed_count": sum(bool(row["decision_changes"]) for row in scenarios)},
        "criteria": {"first": deepcopy(left_report["assessment"]),
                     "second": deepcopy(right_report["assessment"]),
                     "changes": changes(left_report["assessment"], right_report["assessment"])},
        "selection_changes": changes(first["input"]["selection"], second["input"]["selection"]),
        "scenarios": scenarios,
        "frontier": {"first": deepcopy(left_report["frontier"]),
                     "second": deepcopy(right_report["frontier"]),
                     "changes": changes(left_report["frontier"], right_report["frontier"])},
        "interpretation": [
            "The first and second columns retain the saved editions in the selected order; every numeric delta is second minus first.",
            "Economic amounts and decisions are read from their original completed reports; this comparison does not recalculate them.",
            "Capital and annual operating deltas require the same currency and declared cost footprint. Present-value and annualized deltas additionally require equal horizons and real discount rates.",
            "Physical comparability requires the same original native report bytes, project, zone, baseline, full cohort, scope and output support.",
            "No scenarios, pollutant masses, overlapping areas, benefits or scenario costs are added together.",
            "A changed cost source or assumption is retained as an input change even when its resulting amount is equal.",
        ],
    }
    canonical(result)
    return result


def csv_text(comparison):
    """Export one original scenario per row, with exact decimal deltas."""
    output = io.StringIO(newline="")
    fields = ["run_id", "label", "status", "physical_comparable", "physical_equal",
              "first_eligible", "second_eligible", "first_pareto", "second_pareto",
              "first_currency", "second_currency"]
    for name in ("capital", "annual_operating", "annualized", "present_value"):
        fields.extend(["first_" + name, "second_" + name, name + "_delta", name + "_comparison"])
    writer = csv.DictWriter(output, fieldnames=fields)
    writer.writeheader()
    for row in comparison["scenarios"]:
        left, right = row["first"] or {}, row["second"] or {}
        result = {"run_id": row["run_id"], "label": row["label"], "status": row["status"],
                  "physical_comparable": row["physical_comparison"]["comparable"],
                  "physical_equal": row["physical_comparison"]["equal"],
                  "first_currency": (left.get("cost") or {}).get("currency"),
                  "second_currency": (right.get("cost") or {}).get("currency")}
        for side, original in (("first", left), ("second", right)):
            for key in ("eligible", "pareto"):
                result[side + "_" + key] = (original.get("decision") or {}).get(key)
        for name, delta in row["cost_comparison"]["deltas"].items():
            result["first_" + name], result["second_" + name] = delta["first"], delta["second"]
            result[name + "_delta"] = delta["delta_decimal"]
            result[name + "_comparison"] = "comparable" if delta["comparable"] else delta["reason"]
        # Preserve machine-readable numbers while guarding human source text in spreadsheets.
        for key, value in list(result.items()):
            if isinstance(value, str) and (value.lstrip().startswith(("=", "+", "@"))
                                          or value.startswith(("\t", "\r"))
                                          or value.lstrip().startswith("-") and not key.endswith("_delta")):
                result[key] = "'" + value
        writer.writerow(result)
    return output.getvalue()
