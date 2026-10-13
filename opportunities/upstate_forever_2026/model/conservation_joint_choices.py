"""Joint analyst-preference and retained-native-case decision comparisons.

Copyright 2026 TokenJunkieLabs.
Uses the existing conservation scoring and portfolio solver; never runs a model
or changes the scientist's selected portfolio. All scenarios are deterministic.
"""
from __future__ import annotations

from copy import deepcopy
import csv
import html
import io
import json
import math

SCHEMA = "upstate.conservation-joint-comparison/v1"


def _finite(value, label):
    value = float(value)
    if not math.isfinite(value):
        raise ValueError(label + " is outside finite numeric range")
    return value


def compare(rows, request, variants, profiles, scenario, score, optimize, solver_request):
    """Evaluate every distinct included preference on every retained native case.

    Input rows already have the original common scales and source/resource
    exclusions. Existing selected-case/profile and selected-weight/case solves
    are reused exactly. Only the previously uncomputed cross cells call optimize.
    """
    if (request["objective"]["kind"] != "multi-criteria"
            or not request["stability"]["enabled"]
            or not request["scenario_stability"]["enabled"]):
        return None
    cases = [{"name": "Selected case", "request": request, "rows": rows}]
    cases += [{"name": item["case"]["name"], "request": item["request"],
               "rows": item["rows"]} for item in variants]
    inventory = [row["feature_id"] for row in rows]
    if len(inventory) != len(set(inventory)):
        raise ValueError("Original decision candidate IDs must be unique")
    expected_ids = set(inventory)
    for case in cases:
        ids = [row["feature_id"] for row in case["rows"]]
        if len(ids) != len(inventory) or set(ids) != expected_ids:
            raise ValueError("Joint cases must retain the same original candidate inventory")
    if len(scenario["cases"]) != len(cases):
        raise ValueError("Original native case comparison no longer matches its rows")
    totals = {key: {"feature_id": key, "eligible_cells": 0, "selected_cells": 0,
                    "minimum_rank": None, "maximum_rank": None} for key in inventory}
    cells, scored_cells, chosen_portfolios = [], [], {}
    new_solves = 0
    for ci, case in enumerate(cases):
        native_case = scenario["cases"][ci]
        if native_case["name"] != case["name"]:
            raise ValueError("Original native case names no longer match their rows")
        for pi, profile in enumerate(profiles):
            ranked, exclusions = score(case["rows"], profile["weights"])
            if ci == 0:
                selected_ids = list(profile["selected_ids"])
                outcome = deepcopy(profile["optimization"])
                reused = "original selected-case preference comparison"
            elif pi == 0:
                selected_ids = list(native_case["selected_ids"])
                outcome = deepcopy(native_case["optimization"])
                reused = "original selected-preference native case comparison"
            else:
                selected, outcome = optimize(ranked, solver_request)
                selected_ids = sorted(row["feature_id"] for row in selected)
                outcome = deepcopy(outcome)
                reused = None
                new_solves += 1
            selected_ids = sorted(selected_ids)
            scores = {row["feature_id"]: row for row in ranked}
            if len(selected_ids) != len(set(selected_ids)) or not set(selected_ids) <= scores.keys():
                raise ValueError("Original solver selection contains unsupported candidate IDs")
            selected_score = _finite(math.fsum(scores[key]["score"] for key in selected_ids),
                                     "Selected portfolio score")
            incumbent = _finite(outcome["objective_score"], "Solver incumbent")
            tolerance = 1e-10 * max(1., abs(selected_score), abs(incumbent))
            if abs(selected_score - incumbent) > tolerance:
                raise ValueError("Original solver score differs from its selected candidates")
            cell_id = "case-" + str(ci + 1) + "-preference-" + str(pi + 1)
            selected_set = set(selected_ids)
            cell_candidates = []
            source_rows = {row["feature_id"]: row for row in case["rows"]}
            for rank, row in enumerate(ranked, 1):
                original = source_rows[row["feature_id"]]
                summary = totals[row["feature_id"]]
                summary["eligible_cells"] += 1
                summary["selected_cells"] += int(row["feature_id"] in selected_set)
                summary["minimum_rank"] = rank if summary["minimum_rank"] is None else min(summary["minimum_rank"], rank)
                summary["maximum_rank"] = rank if summary["maximum_rank"] is None else max(summary["maximum_rank"], rank)
                cell_candidates.append({
                    "feature_id": row["feature_id"], "rank": rank,
                    "score": row["score"], "selected": row["feature_id"] in selected_set,
                    "contributions": {
                        axis: profile["weights"][axis] * original["normalized_metrics"][axis]
                        if original["axis_support"][axis]["eligible_support"] else None
                        for axis in request["axes"]},
                })
            cell = {
                "id": cell_id, "case_index": ci, "preference_index": pi,
                "case": case["name"], "preference": profile["name"],
                "weights": deepcopy(profile["weights"]),
                "selected_ids": selected_ids, "eligible_count": len(ranked),
                "optimization": outcome, "reused": reused,
                "candidates": cell_candidates,
                "excluded": [{"feature_id": key, "reasons": list(exclusions[key])}
                             for key in inventory if exclusions[key]],
            }
            cells.append(cell)
            scored_cells.append(scores)
            signature = tuple(selected_ids)
            if signature not in chosen_portfolios:
                chosen_portfolios[signature] = {
                    "id": "portfolio-" + str(len(chosen_portfolios) + 1),
                    "selected_ids": selected_ids, "origin_cells": [],
                }
            chosen_portfolios[signature]["origin_cells"].append(cell_id)

    portfolios = list(chosen_portfolios.values())
    evaluations = [[] for _ in cells]
    for portfolio in portfolios:
        for index, cell in enumerate(cells):
            scores = scored_cells[index]
            unavailable = [key for key in portfolio["selected_ids"] if key not in scores]
            excluded = {row["feature_id"]: row["reasons"] for row in cell["excluded"]}
            evaluated_score = (None if unavailable else
                               _finite(math.fsum(scores[key]["score"] for key in portfolio["selected_ids"]),
                                       "Cross-case portfolio score"))
            evaluations[index].append({
                "portfolio_id": portfolio["id"], "cell_id": cell["id"],
                "eligible": not unavailable, "objective_score": evaluated_score,
                "unavailable_units": [{"feature_id": key, "reasons": excluded[key]}
                                      for key in unavailable],
            })
    # A portfolio found in another cell may improve a bounded/heuristic incumbent
    # when evaluated here. This is a valid known feasible lower bound, without
    # changing any original solver receipt or claiming another optimization.
    for index, cell in enumerate(cells):
        original = cell["optimization"]
        best_known = max([_finite(original["objective_score"], "Original objective")]
                         + [value["objective_score"] for value in evaluations[index]
                            if value["eligible"]])
        bound = original.get("upper_bound")
        bound = None if bound is None else _finite(bound, "Original solver upper bound")
        tolerance = 1e-10 * max(1., abs(best_known), abs(bound or 0.))
        if bound is not None and best_known > bound + tolerance:
            raise ValueError("A feasible cross-case portfolio exceeds the original solver bound")
        # Guard only outward floating roundoff, never tighten the original bound.
        upper = None if bound is None else max(bound, best_known)
        cell["best_known_feasible_score"] = best_known
        cell["cross_portfolio_improves_incumbent"] = best_known > original["objective_score"] + tolerance
        cell["best_known_portfolio_ids"] = [
            value["portfolio_id"] for value in evaluations[index]
            if value["eligible"] and abs(value["objective_score"] - best_known) <= tolerance]
        cell["regret_upper_reference"] = upper
        for value in evaluations[index]:
            value["regret_lower_bound"] = (max(0., best_known - value["objective_score"])
                                           if value["eligible"] else None)
            value["regret_upper_bound"] = (max(0., upper - value["objective_score"])
                                           if value["eligible"] and upper is not None else None)
            value["exact_regret"] = (
                value["regret_lower_bound"]
                if value["eligible"] and upper is not None and upper == best_known else None)
    for pi, portfolio in enumerate(portfolios):
        values = [cell_values[pi] for cell_values in evaluations]
        complete = all(value["eligible"] for value in values)
        all_bounds = complete and all(value["regret_upper_bound"] is not None for value in values)
        portfolio.update(
            evaluations=values, eligible_cells=sum(value["eligible"] for value in values),
            cell_count=len(cells), complete_support=complete,
            maximum_regret_lower_bound=(max(value["regret_lower_bound"] for value in values)
                                        if complete else None),
            maximum_regret_upper_bound=(max(value["regret_upper_bound"] for value in values)
                                        if all_bounds else None),
            maximum_regret_on_eligible_cells=(max((value["regret_lower_bound"] for value in values
                                                   if value["eligible"]), default=None)),
        )
    return {
        "schema": SCHEMA, "case_count": len(cases), "preference_count": len(profiles),
        "cell_count": len(cells), "new_solver_calls": new_solves,
        "cases": [{"name": case["name"],
                   "criteria": deepcopy(case["request"]["objective"]["criteria"]),
                   "original_case_index": index}
                  for index, case in enumerate(cases)],
        "profiles": [{"name": profile["name"], "weights": deepcopy(profile["weights"])}
                     for profile in profiles],
        "cells": cells, "portfolios": portfolios,
        "candidate_summary": [{**totals[key], "cell_count": len(cells)} for key in inventory],
        "selected_portfolio_id": chosen_portfolios[tuple(sorted(profiles[0]["selected_ids"]))]["id"],
        "interpretation": "Complete Cartesian comparison of the explicitly included distinct preferences and retained native cases, using the original fixed criterion scales and resource limits. Counts are not probabilities.",
        "regret": "Dimensionless objective loss relative to the best feasible choice in each declared cell. Lower bounds use the best known feasible portfolio; upper bounds use the retained solver bound. Unsupported portfolios have no score or full-grid regret. No universal robust optimum is solved or automatically selected.",
        "physical_scope": "Cross-evaluation sums original independent-unit decision scores. It does not recompute spatial unions, add physical treatment effects, run NDR/SDR, or predict realized benefits.",
    }


def csv_files(comparison):
    """Complete flat downloads; original physical/source rows remain in analysis."""
    def encode(fields, records):
        stream = io.StringIO(newline="")
        writer = csv.DictWriter(stream, fieldnames=fields)
        writer.writeheader()
        for record in records:
            writer.writerow({key: json.dumps(value, ensure_ascii=False, separators=(",", ":"))
                             if isinstance(value, (dict, list)) else value
                             for key, value in record.items()})
        return stream.getvalue().encode("utf-8")
    cells = [{
        "cell_id": cell["id"], "case": cell["case"], "preference": cell["preference"],
        "weights": cell["weights"], "eligible_count": cell["eligible_count"],
        "selected_ids": cell["selected_ids"], "objective_score": cell["optimization"]["objective_score"],
        "solver_status": cell["optimization"].get("status"),
        "solver_upper_bound": cell["optimization"].get("upper_bound"),
        "solver_gap": cell["optimization"].get("absolute_gap"),
        "best_known_feasible_score": cell["best_known_feasible_score"],
        "cross_portfolio_improves_incumbent": cell["cross_portfolio_improves_incumbent"],
        "original_case_index": cell["case_index"], "original_preference_index": cell["preference_index"],
    } for cell in comparison["cells"]]
    choices = [{
        "portfolio_id": portfolio["id"], "selected_ids": portfolio["selected_ids"],
        "origin_cells": portfolio["origin_cells"], "cell_id": value["cell_id"],
        "eligible": value["eligible"], "objective_score": value["objective_score"],
        "regret_lower_bound": value["regret_lower_bound"], "regret_upper_bound": value["regret_upper_bound"],
        "exact_regret": value["exact_regret"], "unavailable_units": value["unavailable_units"],
    } for portfolio in comparison["portfolios"] for value in portfolio["evaluations"]]
    candidates = []
    for cell in comparison["cells"]:
        for row in cell["candidates"]:
            candidates.append({"cell_id": cell["id"], "feature_id": row["feature_id"],
                               "eligible": True, "rank": row["rank"], "score": row["score"],
                               "selected": row["selected"], "contributions": row["contributions"],
                               "exclusions": []})
        for row in cell["excluded"]:
            candidates.append({"cell_id": cell["id"], "feature_id": row["feature_id"],
                               "eligible": False, "rank": None, "score": None,
                               "selected": False, "contributions": None, "exclusions": row["reasons"]})
    return {
        "joint-cells.csv": encode(list(cells[0]), cells),
        "joint-portfolios.csv": encode(list(choices[0]), choices),
        "joint-candidates.csv": encode(
            ["cell_id", "feature_id", "eligible", "rank", "score", "selected", "contributions", "exclusions"],
            candidates),
    }


def html_section(comparison, labels):
    """Embed a readable complete comparison in the original decision report."""
    esc = lambda value: html.escape(str(value), quote=True)
    def number(value):
        return "Unavailable" if value is None else esc(format(value, ".8g"))
    def names(ids):
        return ", ".join(esc(labels.get(key) or key) for key in ids) or "None"
    def table(headers, values):
        return ('<div class="table-scroll" tabindex="0"><table><thead><tr>'
                + "".join("<th scope=\"col\">" + esc(x) + "</th>" for x in headers)
                + "</tr></thead><tbody>"
                + "".join("<tr>" + "".join("<td>" + str(x) + "</td>" for x in row) + "</tr>" for row in values)
                + "</tbody></table></div>")
    parts = ["<section id=\"joint-comparisons\"><h2>Preferences across every retained case</h2>",
             "<p>" + esc(comparison["interpretation"]) + "</p>",
             "<p>" + str(comparison["case_count"]) + " cases × "
             + str(comparison["preference_count"]) + " preferences = "
             + str(comparison["cell_count"]) + " evaluated combinations. "
             + str(comparison["new_solver_calls"]) + " previously uncomputed combinations used the maintained solver.</p>",
             '<nav aria-label="Joint comparison downloads"><a href="joint-cells.csv">All case and preference results</a>'
             '<a href="joint-portfolios.csv">All portfolio cross-comparisons</a>'
             '<a href="joint-candidates.csv">Every candidate and exclusion</a></nav>']
    parts.append(table(
        ["Case", "Preference", "Eligible units", "Selected units", "Original solved score", "Solver status", "Upper bound"],
        [[esc(cell["case"]), esc(cell["preference"]), cell["eligible_count"],
          names(cell["selected_ids"]), number(cell["optimization"]["objective_score"]),
          esc(cell["optimization"].get("status", "Unavailable")), number(cell["optimization"].get("upper_bound"))]
         for cell in comparison["cells"]]))
    parts += ["<h3>Each retained portfolio across the complete comparison</h3>",
              "<p>" + esc(comparison["regret"]) + "</p>",
              '<p class="notice">The original selected portfolio stays selected. A low loss within these choices does not establish a globally optimal robust portfolio or a recommendation. Preference and case multiplicity does not assign likelihood.</p>']
    parts.append(table(
        ["Portfolio", "Original units", "Supported combinations", "Worst loss lower bound", "Worst loss upper bound"],
        [[esc(portfolio["id"]) + (" · original selection" if portfolio["id"] == comparison["selected_portfolio_id"] else ""),
          names(portfolio["selected_ids"]), str(portfolio["eligible_cells"]) + " / " + str(portfolio["cell_count"]),
          number(portfolio["maximum_regret_lower_bound"]), number(portfolio["maximum_regret_upper_bound"])]
         for portfolio in comparison["portfolios"]]))
    cell_names = {cell["id"]: cell["case"] + " / " + cell["preference"] for cell in comparison["cells"]}
    for portfolio in comparison["portfolios"]:
        parts.append("<details><summary>" + esc(portfolio["id"]) + ": " + names(portfolio["selected_ids"]) + "</summary>")
        parts.append(table(
            ["Case / preference", "Portfolio score", "Loss lower bound", "Loss upper bound", "Support / explanation"],
            [[esc(cell_names[value["cell_id"]]), number(value["objective_score"]),
              number(value["regret_lower_bound"]), number(value["regret_upper_bound"]),
              "Complete" if value["eligible"] else "; ".join(
                  esc(labels.get(item["feature_id"]) or item["feature_id"]) + ": " + esc("; ".join(item["reasons"]))
                  for item in value["unavailable_units"])]
             for value in portfolio["evaluations"]]))
        parts.append("</details>")
    parts.append(table(
        ["Original unit", "Selected combinations", "Eligible combinations", "Rank range"],
        [[esc(labels.get(row["feature_id"]) or row["feature_id"]),
          str(row["selected_cells"]) + " / " + str(row["cell_count"]),
          str(row["eligible_cells"]) + " / " + str(row["cell_count"]),
          "Unavailable" if row["minimum_rank"] is None else str(row["minimum_rank"]) + "–" + str(row["maximum_rank"])]
         for row in comparison["candidate_summary"]]))
    parts += ["<p>" + esc(comparison["physical_scope"]) + "</p></section>"]
    return "".join(parts)
