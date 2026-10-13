"""Explicit scenario-to-scenario contrasts from completed native ensemble runs.

The original Ensembles pair reducer owns values, valid support and difference
rasters. This module selects a reference scenario and retains a separate report
edition without changing the saved native design or its baseline report.
"""
from __future__ import annotations

from copy import deepcopy
from pathlib import Path

from .common import atomic_json, digest, file_digest, held, identifier, now, read_json
from . import ensembles, ensemble_report
from .ensembles import Ensembles
from .native_execution import storage_exhausted

VERSION = 1


def selection(plan, value):
    if not isinstance(value, dict):
        raise ValueError("Choose an original reference scenario and alternatives")
    scenario_ids = [plan["baseline_scenario_id"], *plan["alternative_scenario_ids"]]
    reference = identifier(value.get("reference_scenario_id"))
    if reference not in scenario_ids:
        raise ValueError("Choose a reference scenario from this saved ensemble")
    alternatives = value.get("alternative_scenario_ids")
    if alternatives is None:
        alternatives = [key for key in scenario_ids if key != reference]
    if (not isinstance(alternatives, list) or not alternatives
            or any(not isinstance(key, str) or key not in scenario_ids or key == reference
                   for key in alternatives) or len(set(alternatives)) != len(alternatives)):
        raise ValueError("Choose distinct original alternatives other than the reference")
    wanted = set(alternatives)
    return {"version": VERSION, "reference_scenario_id": reference,
            "alternative_scenario_ids": [key for key in scenario_ids if key in wanted]}


def _identity(workspace, plan, chosen, runs):
    return {"workspace_id": workspace.project["id"], "ensemble_id": plan["id"],
            "selection": chosen, "run_signature": Ensembles(workspace)._signature(runs),
            "producer_sha256": file_digest(Path(__file__)),
            "native_pair_producer_sha256": file_digest(Path(ensembles.__file__))}


def catalog(workspace, ensemble_id):
    manager = Ensembles(workspace)
    plan, unused = manager._directory(identifier(ensemble_id))
    current = manager.inspect(plan["id"])
    scenarios, seen = [], set()
    for member in plan["members"]:
        for row in member["runs"]:
            key = row["scenario_id"]
            if key in seen:
                continue
            seen.add(key)
            scenarios.append({"id": key, "title": row.get("label") or key,
                              "original_baseline": key == plan["baseline_scenario_id"]})
    return {"ensemble_id": plan["id"], "title": plan["title"], "scenarios": scenarios,
            "members": current["members"], "progress": current["progress"],
            "original_baseline_scenario_id": plan["baseline_scenario_id"],
            "method": "Alternative minus the selected same-profile reference, on their actual common valid cells."}


def current_signature(workspace, ensemble_id, chosen):
    manager = Ensembles(workspace)
    plan, directory = manager._directory(identifier(ensemble_id))
    chosen = selection(plan, chosen)
    identity = _identity(workspace, plan, chosen, manager._run_records(plan))
    path = directory / "scenario-contrasts" / digest(identity) / "summary.json"
    if not path.exists():
        return None
    value = read_json(path)
    if value.get("scenario_contrast_identity") != identity:
        raise ValueError("The saved scenario contrast has another original selection")
    return ensemble_report.summary_signature(value)


def build(workspace, ensemble_id, value):
    manager = Ensembles(workspace)
    plan, ensemble_directory = manager._directory(identifier(ensemble_id))
    chosen = selection(plan, value)
    runs = manager._run_records(plan)
    identity = _identity(workspace, plan, chosen, runs)
    directory = ensemble_directory / "scenario-contrasts" / digest(identity)
    directory.mkdir(parents=True, exist_ok=True)
    with held(directory / ".contrast.lock", blocking=False):
        path = directory / "summary.json"
        previous = read_json(path) if path.exists() else None
        if previous and previous.get("scenario_contrast_identity") != identity:
            raise ValueError("The saved scenario contrast has another original selection")
        if previous and not previous.get("errors"):
            return ensemble_report._build(workspace, previous, publish_pointer=False)
        reference_id = chosen["reference_scenario_id"]
        scenarios = {row["scenario_id"]: row.get("label") or row["scenario_id"]
                     for member in plan["members"] for row in member["runs"]}
        rows, comparisons, errors = [], {}, []
        for member in plan["members"]:
            choices = {row["scenario_id"]: row for row in member["runs"]}
            reference = runs[choices[reference_id]["run_id"]]
            comparisons[member["id"]] = []
            for target_id in chosen["alternative_scenario_ids"]:
                alternative = runs[choices[target_id]["run_id"]]
                pair_selection = {"member_id": member["id"], "profile_id": member["profile_id"],
                                  "reference_scenario_id": reference_id, "scenario_id": target_id,
                                  "baseline_run_id": reference["id"], "alternative_run_id": alternative["id"]}
                if reference["state"] != "complete" or alternative["state"] != "complete":
                    errors.append({**pair_selection, "type": "NativePairIncomplete",
                                   "reference_state": reference["state"],
                                   "alternative_state": alternative["state"],
                                   "message": "Complete these two retained native runs to include their direct contrast."})
                    continue
                try:
                    for run, scenario_id in ((reference, reference_id), (alternative, target_id)):
                        if any(run["selection"].get(name) != expected for name, expected in (
                                ("grid_id", plan["grid_id"]), ("profile_id", member["profile_id"]),
                                ("scenario_id", scenario_id))):
                            raise ValueError("A selected native run differs from its original ensemble member")
                    pair = manager._pair(plan, reference, alternative, directory)
                    rows.extend({**row, "member_id": member["id"], "member_label": member["label"],
                                 "profile_id": member["profile_id"], "scenario_id": target_id,
                                 "scenario_label": scenarios[target_id], "kind": "landcover",
                                 "reference_scenario_id": reference_id,
                                 "reference_scenario_label": scenarios[reference_id]}
                                for row in pair["rows"])
                    comparisons[member["id"]].append({
                        **pair_selection, "comparison_id": pair["comparison_id"]})
                except Exception as error:
                    if storage_exhausted(error):
                        raise
                    errors.append({**pair_selection, "type": type(error).__name__, "message": str(error)})
        # Bind this entire original snapshot, including unchanged selections and
        # outputs, before publishing a source edition from its pair results.
        if manager._signature(manager._run_records(plan)) != identity["run_signature"]:
            raise ValueError("The original native runs advanced during comparison; prepare their current edition")
        current = manager.inspect(plan["id"])
        report = {
            "schema": "upstate.ensemble-report/v1", "id": plan["id"],
            "title": plan["title"] + " — reference: " + scenarios[reference_id],
            "reason": plan["reason"], "grid_id": plan["grid_id"],
            "baseline_scenario_id": reference_id,
            "original_baseline_scenario_id": plan["baseline_scenario_id"],
            "scenario_reference": {**chosen, "reference_title": scenarios[reference_id],
                                   "original_baseline_scenario_id": plan["baseline_scenario_id"]},
            "scenario_contrast_identity": identity,
            "state": "partial" if errors else "complete", "progress": current["progress"],
            "model_scope": deepcopy(current["model_scope"]),
            "report_state": "partial" if errors else "current",
            "rows": rows, "sensitivity": [], "robustness": [],
            "members": deepcopy(plan["members"]), "sources": deepcopy(plan["sources"]),
            "interpretation": deepcopy(plan["interpretation"]),
            "comparisons": comparisons, "errors": errors,
            "run_errors": deepcopy(current.get("errors", [])),
            "execution_error": deepcopy(current.get("execution_error")),
            "run_signature": identity["run_signature"], "generated_at": now(),
        }
        atomic_json(path, report)
        return ensemble_report._build(workspace, report, publish_pointer=False)


def sections(plan, content, profiles, scenarios, scope):
    from . import ensemble_study_source as source, ensemble_study_scope
    table = source._table
    report, rows = content["report"], content["paired_rows"]
    chosen = report["scenario_reference"]
    scope_sections = ensemble_study_scope.sections(scope) if scope is not None else []
    result = [["Selected scenario reference", [
        "This is a direct comparison of completed runs from the saved native ensemble. "
        "Each alternative is compared with the explicitly selected reference using the same "
        "parameter profile and the cells valid in both runs.",
        table(["Reference scenario", "Original reference ID", "Original design baseline ID"],
              [[chosen["reference_title"], chosen["reference_scenario_id"],
                chosen["original_baseline_scenario_id"]]]),
        "Signed change is alternative minus reference. Negative change means lower annual "
        "export to modeled streams. A matched-control reference is a modeled comparison "
        "scenario; the chosen name does not establish causal equivalence or eliminate "
        "the original input and siting differences.",
        "The native fields baseline_run_id and baseline_common identify this selected pair's "
        "reference. The saved ensemble's original baseline and its earlier reports remain separately retained.",
        table(["Report state", "Selected alternatives", "Native parameter members", "Unavailable pairs"],
              [[report["state"], len(chosen["alternative_scenario_ids"]), len(plan["members"]),
                len(report["errors"])]]),
    ]], *scope_sections[:1]]
    for target_id in chosen["alternative_scenario_ids"]:
        selected = [(index, row) for index, row in enumerate(rows) if row["scenario_id"] == target_id]
        title = scenarios[target_id].get("title") or target_id
        result.append([title + " versus " + chosen["reference_title"], [
            table(["Pair", "Parameter case", "Profile", "Constituent / unit"],
                  [[source._case_key("paired_rows", index), row["member_label"], row["profile_id"],
                    source.POLLUTANT_LABELS[row["pollutant"]] + " / " + row["total_units"]]
                   for index, row in selected]),
            table(["Pair", "Unit", "Reference on common cells", "Alternative on common cells",
                   "Alternative minus reference", "Change (%)"],
                  [[source._case_key("paired_rows", index), row["total_units"], row["baseline_common"],
                    row["alternative_common"], row["delta_common"], source._percentage(row, reference_label="reference")]
                   for index, row in selected]),
            "Nitrogen and phosphorus retain kg/year; sediment retains metric tonnes/year (t/year). "
            "Percent change uses the paired reference mass and is undefined when that mass is zero.",
            *source._case_tables("paired_rows", selected, reference_label="Reference"),
            table(["Pair", "Reference own-valid mass", "Alternative own-valid mass", "Unit",
                   "Exact common-support SHA256"],
                  [[source._case_key("paired_rows", index), row["baseline_total"], row["alternative_total"],
                    row["total_units"], row["common_support_sha256"]] for index, row in selected]),
            "The own-valid totals can cover different cells. Their subtraction, or subtraction "
            "of two separate baseline effects, does not replace this direct common-support change.",
        ]])
    result.append(["Parameter cases and shared support", [
        "Original paired figures and ranges keep each alternative, constituent, annual unit and "
        "exact common-support mask separate. They describe the selected parameter cases.",
        table(["Alternative", "Constituent / unit", "Cases", "Minimum change", "Maximum change",
               "Common cells", "Support SHA256"],
              [[row["scenario_label"], source.POLLUTANT_LABELS[row["pollutant"]] + " / " + row["total_units"],
                row["members"], row["minimum_delta"], row["maximum_delta"], row["common_cells"],
                row["common_support_sha256"]] for row in content["support_groups"]]),
    ]])
    result.append(["Original scientific choices", [
        table(["Parameter case", "Profile", "Parent profile", "Scientific status", "Table SHA256"],
              [[member["label"], member["profile_id"], member.get("parent_profile_id"),
                profiles[member["profile_id"]].get("scientific_status", "working"),
                profiles[member["profile_id"]].get("table_summary", {}).get("sha256")]
               for member in plan["members"]]),
        table(["Case", "Native model", "Parameter", "Original value"],
              [[member["label"], model.upper(), name, value]
               for member in plan["members"] for model in ("ndr", "sdr")
               for name, value in member["parameters"].get(model, {}).items()]),
        table(["Case", "Original scientific references", "Selected parameter assignments"],
              [[member["label"], profiles[member["profile_id"]].get("references", []),
                member.get("assignments", [])] for member in plan["members"]]),
        table(["Scenario", "Kind", "Reason", "Original mapped changes"],
              [[value["title"], value["kind"], value["reason"], value.get("patches", [])]
               for value in scenarios.values()]),
        table(["Case", "Scenario", "Original role", "Native run", "Scenario identity"],
              [[member["label"], row["label"], row["role"], row["run_id"], row["scenario_id"]]
               for member in plan["members"] for row in member["runs"]]),
        "The original scientific status, source references and mapped changes remain attached "
        "to the modeled result. Native completion does not alter those original classifications.",
    ]])
    if report["errors"]:
        result.append(["Unavailable original pairs", [
            "Completed pairs remain available. Continue the named original run or correct its "
            "reported comparison error, then prepare a new report edition.",
            table(["Member", "Reference run", "Alternative run", "Reason"],
                  [[row.get("member_id"), row.get("baseline_run_id"), row.get("alternative_run_id"),
                    row["message"]] for row in report["errors"]]),
        ]])
    result.append(["Original comparison files and maps", [
        {"kind": "links", "items": [
            {"title": "Complete original direct comparison data", "path": "numeric/report.json"},
            {"title": "All paired values and native run IDs (CSV)", "path": "numeric/pairs.csv"},
            {"title": "Original input and output inventory", "path": "native-input-inventory.json"},
            {"title": "Exact figure coordinates", "path": source.COORDINATES},
            {"title": "Original saved ensemble", "path": "original/ensemble.json"},
        ]},
        table(["Member", "Alternative scenario", "Original difference comparison"],
              [[member_id, row["scenario_id"], row["comparison_id"]]
               for member_id, comparisons in report["comparisons"].items() for row in comparisons]),
        "Open these comparison IDs in Spatial review for the original paired difference rasters. "
        "The complete Workspace or selected scientific Study retains their native inputs and maps.",
    ]])
    result.extend(scope_sections[1:])
    return result
