"""Bind saved ensemble members to their original native run selections."""
from __future__ import annotations

from .common import digest, identifier
from .model_selection import normalize_selection, selected


def retained_plan(workspace, key):
    key = identifier(key)
    plan = workspace._get("ensembles", key)
    if plan.get("id") != key or not plan.get("members"):
        raise ValueError("Choose the original complete saved ensemble")
    return plan


def run_ids(plan):
    values = [identifier(row["run_id"]) for member in plan["members"]
              for row in member["runs"]]
    if not values:
        raise ValueError("The saved ensemble has no native cases")
    return list(dict.fromkeys(values))


def native_case_context(workspace, key, run_id):
    """Recompute immutable plan, member and full scientific selection binding."""
    plan = retained_plan(workspace, key)
    run_id = identifier(run_id)
    native = workspace.inspect_run(run_id)
    bindings = []
    for member in plan["members"]:
        for row in member["runs"]:
            if row["run_id"] != run_id:
                continue
            expected, _ = normalize_selection({
                "grid_id": plan["grid_id"], "profile_id": member["profile_id"],
                "scenario_id": row["scenario_id"],
            }, default=selected(row, default=selected(plan)))
            if native["selection"] != expected:
                raise ValueError("The worker run differs from its original ensemble member")
            bindings.append({
                "member_id": member["id"], "member_label": member.get("label", ""),
                "profile_id": member["profile_id"], "selection": row,
            })
    if not bindings:
        raise ValueError("This native run is outside the saved ensemble")
    ordered = run_ids(plan)
    return {
        "ensemble_id": plan["id"], "ensemble_title": plan.get("title", ""),
        "plan_sha256": digest(plan), "run_id": run_id,
        "bindings_sha256": digest(bindings), "bindings": bindings,
        "run_number": ordered.index(run_id) + 1, "run_count": len(ordered),
    }
