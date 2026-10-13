"""Budget/coverage/strata/calendar-constrained monitoring network design.

MILP decisions select catchment search areas, not invented field coordinates.
Coverage is a disclosed planning objective, never a water-quality observation.
"""
from __future__ import annotations

import math
import time
from typing import Any
import numpy as np
from scipy.optimize import Bounds, LinearConstraint, milp
from scipy.sparse import coo_matrix, vstack

from .monitoring_common import ContractError
from .monitoring_network import coverage_sets, existing_coverage, graph_distances, number
from .monitoring_campaign import (integer, money_cents, dollars, cost_table,
                                  calendar_site_capacity, build_calendar)


def ids(value: Any, name: str, universe: set[str]) -> set[str]:
    if not isinstance(value, list) or any(not isinstance(v, str) for v in value):
        raise ContractError(f"{name} must be an array of string IDs")
    result = set(value)
    if len(result) != len(value):
        raise ContractError(f"{name} contains duplicate IDs")
    unknown = result - universe
    if unknown:
        raise ContractError(f"{name} contains unknown IDs: {sorted(unknown)}")
    return result


def solve_design(network: dict, config: dict) -> dict:
    """Return a complete feasible design or an explicit infeasible/limited result.

    A successful incumbent is re-evaluated in integer cents and graph sets. It
    is never labelled optimal unless the solver closes the selected gap.
    """
    started = time.perf_counter()
    nodes = network["nodes"]
    keys = sorted(nodes)
    index = {key: i for i, key in enumerate(keys)}
    universe, n = set(keys), len(keys)
    mode = config.get("coverage_mode", "local")
    coverage = coverage_sets(network, mode)
    existing_ids = config.get("existing_station_ids", [])
    baseline = existing_coverage(network, mode, existing_ids)
    required = ids(config.get("required_ids", []), "required_ids", universe)
    excluded = ids(config.get("excluded_ids", []), "excluded_ids", universe)
    if required & excluded:
        raise ContractError(f"required and excluded overlap: {sorted(required & excluded)}")
    calendar_config = config.get("calendar")
    if not isinstance(calendar_config, dict):
        raise ContractError("a complete calendar configuration is required")
    calendar_capacity = calendar_site_capacity(calendar_config)
    costs, breakdown = cost_table(network, config, calendar_config)
    overhead = money_cents(config.get("program_overhead", "0.00"), "program_overhead")
    budget = money_cents(config.get("budget"), "budget")
    max_sites = integer(config.get("max_sites", n), "max_sites")
    min_sites = integer(config.get("min_sites", 0), "min_sites")
    max_sites = min(max_sites, n, calendar_capacity)
    separation = integer(config.get("minimum_network_separation", 0), "minimum_network_separation")
    separation_pairs = graph_distances(network, separation)
    explicit_pairs = config.get("incompatible_pairs", [])
    if not isinstance(explicit_pairs, list):
        raise ContractError("incompatible_pairs must be an array of ID pairs")
    for pair in explicit_pairs:
        if not isinstance(pair, list) or len(pair) != 2:
            raise ContractError("each incompatible pair must contain two distinct catchment IDs")
        checked = ids(pair, "incompatible pair", universe)
        if len(checked) != 2:
            raise ContractError("an incompatible pair must contain two distinct IDs")
        separation_pairs.add(tuple(sorted(checked)))
    strata = config.get("minimum_by_stratum", {})
    if not isinstance(strata, dict):
        raise ContractError("minimum_by_stratum must be an object")
    strata = {str(key): integer(value, f"minimum_by_stratum.{key}") for key, value in strata.items()}
    known_strata = {v["stratum"] for v in nodes.values()}
    if set(strata) - known_strata:
        raise ContractError(f"unknown strata: {sorted(set(strata) - known_strata)}")
    time_limit = number(config.get("time_limit_seconds", 120), "time_limit_seconds", minimum=0.01)
    gap = number(config.get("relative_gap", 0), "relative_gap")
    if gap > 1:
        raise ContractError("relative_gap must be between 0 and 1")
    warnings = []
    if network["station_assignment_issues"]:
        warnings.append("Source station assignment issues remain; only explicitly chosen assigned stations contribute to coverage.")
    preliminary = []
    if overhead > budget:
        preliminary.append("fixed program overhead exceeds total budget")
    if min_sites > max_sites or len(required) > max_sites:
        preliminary.append("minimum/required site count exceeds site or calendar capacity")
    if sum(costs[k] for k in required) + overhead > budget:
        preliminary.append("required sites and overhead exceed the campaign budget")
    if any(a in required and b in required for a, b in separation_pairs):
        preliminary.append("required sites violate a separation or incompatibility constraint")
    for stratum, minimum in strata.items():
        available = sum(k not in excluded and nodes[k]["stratum"] == stratum for k in keys)
        if minimum > available:
            preliminary.append(f"stratum {stratum!r} needs {minimum} sites but only {available} are eligible")
    base_result = {"schema": "eco.monitoring.design/1", "configuration": config,
                   "network_id": network.get("id"), "source_bindings": network["source_bindings"],
                   "coverage_mode": mode, "weight_basis": network["weight_basis"],
                   "coverage_meaning": ("catchment-level planning presence" if mode == "local" else
                       "potential upstream context at a proposed outlet; not guaranteed observation representativeness"),
                   "calendar_site_capacity": calendar_capacity,
                   "existing_station_ids": existing_ids, "baseline_covered_ids": sorted(baseline),
                   "warnings": warnings}
    if preliminary:
        return {**base_result, "status": "infeasible", "diagnostics": preliminary, "selected_ids": [],
                "elapsed_seconds": time.perf_counter() - started}

    # x_i: selected catchment. z_i: uncovered target newly represented.
    # Continuous z in [0,1] is sufficient with binary x and nonnegative weights.
    rows, columns, values, lower, upper = [], [], [], [], []
    def constraint(terms: dict[int, float], lo: float = -np.inf, hi: float = np.inf):
        r = len(lower)
        for col, value in terms.items():
            if value:
                rows.append(r); columns.append(col); values.append(value)
        lower.append(lo); upper.append(hi)
    constraint({index[k]: costs[k] for k in keys}, hi=budget - overhead)
    constraint({i: 1 for i in range(n)}, lo=min_sites, hi=max_sites)
    for stratum, minimum in strata.items():
        constraint({index[k]: 1 for k in keys if nodes[k]["stratum"] == stratum}, lo=minimum)
    for a, b in sorted(separation_pairs):
        constraint({index[a]: 1, index[b]: 1}, hi=1)
    target_sources = {key: [] for key in keys}
    for site, targets in coverage.items():
        for target in targets:
            target_sources[target].append(index[site])
    for key in keys:
        if key not in baseline:
            constraint({**{i: -1 for i in target_sources[key]}, n + index[key]: 1}, hi=0)
    lo = np.zeros(2 * n)
    hi = np.ones(2 * n)
    for key in required:
        lo[index[key]] = 1
    for key in excluded:
        hi[index[key]] = 0
    for key in baseline:
        hi[n + index[key]] = 0
    weights = np.array([number(nodes[k]["weight"], f"weight {k}") for k in keys])
    # Normalize only for numerics. Objective/report remain original source units.
    if not math.isfinite(float(weights.sum())):
        raise ContractError("combined priority weights exceed finite numeric range")
    scale = max(float(weights.sum()), 1.0)
    objective = np.concatenate((np.zeros(n), -weights / scale))
    matrix = coo_matrix((values, (rows, columns)), shape=(len(lower), n * 2)).tocsc()
    integrality = np.concatenate((np.ones(n, dtype=int), np.zeros(n, dtype=int)))
    options = {"time_limit": time_limit, "mip_rel_gap": gap, "presolve": True}
    constraints = LinearConstraint(matrix, np.array(lower), np.array(upper))
    answer = milp(objective, integrality=integrality, bounds=Bounds(lo, hi), constraints=constraints, options=options)
    if answer.x is None:
        return {**base_result, "status": "infeasible" if answer.status == 2 else "no_feasible_incumbent",
                "solver": {"status": int(answer.status), "message": str(answer.message)},
                "diagnostics": ["Joint constraints have no feasible design." if answer.status == 2 else str(answer.message)],
                "selected_ids": [], "elapsed_seconds": time.perf_counter() - started}
    first = answer
    tie_status = "not-run"
    # Secondary cost solve only after the primary closes its requested gap.
    # The original incumbent is retained if secondary optimization is interrupted.
    if answer.status == 0:
        remaining = time_limit - (time.perf_counter() - started)
        if remaining > 0.02:
            achieved = float(-answer.fun)
            bound_matrix = vstack((matrix, coo_matrix((-objective).reshape(1, -1))), format="csc")
            cost_scale = max(sum(costs.values()), 1)
            second_objective = np.concatenate((np.array([costs[k] / cost_scale for k in keys]), np.zeros(n)))
            second = milp(second_objective, integrality=integrality, bounds=Bounds(lo, hi),
                          constraints=LinearConstraint(bound_matrix, np.r_[lower, achieved - 1e-10], np.r_[upper, np.inf]),
                          options={"time_limit": remaining, "mip_rel_gap": 0.0, "presolve": True})
            tie_status = "optimal" if second.status == 0 else "incomplete"
            if second.x is not None:
                proposed = [keys[i] for i in range(n) if second.x[i] > 0.5]
                original = [keys[i] for i in range(n) if first.x[i] > 0.5]
                def coverage_weight(selected):
                    covered = set(baseline)
                    for key in selected: covered.update(coverage[key])
                    return sum(nodes[k]["weight"] for k in covered)
                # Check primary objective on discrete source sets, not solver z tolerances.
                if coverage_weight(proposed) >= coverage_weight(original) - 1e-9 and sum(costs[k] for k in proposed) <= sum(costs[k] for k in original):
                    answer = second
                else:
                    tie_status = "discarded-numerical-tolerance"
    selected = sorted(keys[i] for i in range(n) if answer.x[i] > 0.5)
    chosen = set(selected)
    # Exact postsolve checks: no floating point tolerance can spend extra cents.
    spent = sum(costs[k] for k in selected) + overhead
    violations = []
    if spent > budget: violations.append("budget")
    if not min_sites <= len(chosen) <= max_sites: violations.append("site count")
    if required - chosen or chosen & excluded: violations.append("required/excluded")
    if any(a in chosen and b in chosen for a, b in separation_pairs): violations.append("incompatibility")
    if any(sum(nodes[k]["stratum"] == s for k in chosen) < v for s, v in strata.items()): violations.append("stratum minimum")
    if violations:
        raise ContractError(f"solver incumbent failed exact validation: {', '.join(violations)}")
    total_coverage = set(baseline)
    contributions = []
    # Deterministic marginal accounting for display. MILP optimizes all sites jointly.
    for key in selected:
        marginal = coverage[key] - total_coverage
        contributions.append({"id": key, "stratum": nodes[key]["stratum"],
                              "coverage_ids": sorted(coverage[key]), "marginal_ids": sorted(marginal),
                              "marginal_weight": sum(nodes[k]["weight"] for k in marginal),
                              "cost": breakdown[key], "geometry_role": "source-catchment-search-area"})
        total_coverage.update(coverage[key])
    total_weight = sum(node["weight"] for node in nodes.values())
    covered_weight = sum(nodes[k]["weight"] for k in total_coverage)
    station_set = set(existing_ids)
    return {**base_result, "status": "optimal" if first.status == 0 and gap == 0 else "feasible",
            "solver": {"engine": "scipy.optimize.milp / HiGHS", "primary_status": int(first.status),
                       "message": str(first.message), "requested_relative_gap": gap,
                       "achieved_relative_gap": float(first.mip_gap) if getattr(first, "mip_gap", None) is not None else None,
                       "minimum_cost_tiebreak": tie_status,
                       "nodes": int(first.mip_node_count) if getattr(first, "mip_node_count", None) is not None else None},
            "selected_ids": selected, "selected": contributions,
            "covered_ids": sorted(total_coverage), "uncovered_ids": sorted(universe - total_coverage),
            "coverage": {"covered_weight": covered_weight, "total_weight": total_weight,
                         "fraction": covered_weight / total_weight if total_weight else None,
                         "baseline_weight": sum(nodes[k]["weight"] for k in baseline),
                         "covered_catchments": len(total_coverage), "total_catchments": n},
            "cost": {"currency": config.get("currency", "USD"), "budget_cents": budget,
                     "program_overhead_cents": overhead, "total_cents": spent, "remaining_cents": budget - spent,
                     "total_display": dollars(spent), "scope": "new-site setup and all scheduled visits plus stated program overhead",
                     "existing_station_costs": "external baseline costs are excluded; add them to program_overhead when program-funded"},
            "calendar": build_calendar(selected, calendar_config),
            "elapsed_seconds": time.perf_counter() - started}


def solve_frontier(network: dict, config: dict, budgets: list[str]) -> dict:
    if not isinstance(budgets, list) or not budgets:
        raise ContractError("frontier budgets must be a nonempty array")
    cents = [money_cents(value, "frontier budget") for value in budgets]
    if len(set(cents)) != len(cents):
        raise ContractError("frontier budgets must be distinct")
    # All requested budgets are executed, not sampled or silently truncated.
    designs = [solve_design(network, {**config, "budget": dollars(value)}) for value in sorted(cents)]
    return {"schema": "eco.monitoring.frontier/1", "network_id": network.get("id"),
            "designs": designs, "budgets_completed": len(designs),
            "rows": [{"budget": design["configuration"]["budget"], "status": design["status"],
                      "selected_sites": len(design["selected_ids"]),
                      "covered_weight": design.get("coverage", {}).get("covered_weight"),
                      "total_cost": design.get("cost", {}).get("total_display"),
                      "selected_ids": design["selected_ids"]} for design in designs]}
