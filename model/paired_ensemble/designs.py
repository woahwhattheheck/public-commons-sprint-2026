"""Select completed original design pairs for every paired-raster consumer.

The browser and headless study workflow share this exact native run selection.
Copyright 2026 TokenJunkieLabs.
"""
from __future__ import annotations
from .ensemble_rasters import UNITS
from .ensemble_store import identifier

POLLUTANTS = tuple(UNITS)

def available_outputs(run):
    """Read native artifact metadata; catalogue and progress never hash rasters."""
    artifacts = run.get("artifacts", {})
    return [name for name in POLLUTANTS
            if isinstance(artifacts.get(name), dict)
            and artifacts[name].get("units") == UNITS[name]]


def design_cohort(workspace, design_id, scenario_id):
    """Select actual finished land-cover pairs from the persisted design engine.

    Parameter-baseline sensitivity rows are a different scientific contrast and
    are never passed to the land-cover raster consumer.
    """
    from model.ensembles import Ensembles
    plan = Ensembles(workspace).inspect(identifier(design_id))
    scenario_id = identifier(scenario_id)
    if scenario_id not in plan.get("alternative_scenario_ids", []):
        raise ValueError("Select one retained land-cover alternative from this design.")
    pairs, pending = [], []
    common = set(plan["model_scope"]["expected_artifacts"]) & set(POLLUTANTS)
    for case in plan["members"]:
        baseline = next((row for row in case["runs"]
                         if row["scenario_id"] == plan["baseline_scenario_id"]), None)
        alternative = next((row for row in case["runs"]
                            if row["scenario_id"] == scenario_id), None)
        if not baseline or not alternative or any(row["state"] != "complete" for row in (baseline, alternative)):
            pending.append({
                "profile_id": case["profile_id"], "label": case["label"],
                "baseline_run_id": baseline["run_id"] if baseline else None,
                "alternative_run_id": alternative["run_id"] if alternative else None,
                "baseline_state": baseline["state"] if baseline else "missing",
                "alternative_state": alternative["state"] if alternative else "missing",
                "baseline_error": baseline.get("error") if baseline else None,
                "alternative_error": alternative.get("error") if alternative else None,
            })
            continue
        before = workspace.inspect_run(baseline["run_id"])
        after = workspace.inspect_run(alternative["run_id"])
        shared = set(available_outputs(before)) & set(available_outputs(after))
        common &= shared
        pairs.append({
            "profile_id": case["profile_id"], "baseline_run_id": before["id"],
            "alternative_run_id": after["id"], "scenario_id": scenario_id,
        })
    pollutants = [name for name in POLLUTANTS if name in common] if pairs else []
    alternative = workspace._get("scenarios", scenario_id)
    selection = {
        "title": plan["title"] + " / " + alternative.get("title", scenario_id[:12]),
        "purpose": plan["reason"],
        "input_description": "Completed original InVEST land-cover pairs from scenario design " + plan["id"],
        "pairs": pairs, "pollutants": pollutants,
        "quantiles": [0.1, 0.5, 0.9], "support": "all_pairs",
        "planned_member_count": len(plan["members"]),
        "memory_mb": 256, "tile_size": 256, "max_open_datasets": 48,
    }
    return {
        "schema": "upstate.paired-design-cohort/v1", "design_id": plan["id"],
        "design_state": plan["state"], "grid_id": plan["grid_id"],
        "baseline_scenario_id": plan["baseline_scenario_id"],
        "scenario_id": scenario_id, "selection": selection,
        "selected_member_count": len(pairs), "planned_member_count": len(plan["members"]),
        "available_pollutants": pollutants, "pending_members": pending,
        "ready": bool(pairs and pollutants),
        "effect_direction": "baseline minus alternative; positive = reduction",
    }

