"""Route a saved parameter study into the original scientific consumers.

All native run/comparison, observation, calibration and decision identities are
owned by their existing producers. This module binds those original selections
and retains the complete scientific scope through each handoff.
"""
from __future__ import annotations

from copy import deepcopy
from pathlib import Path
import hashlib
import zipfile

from .common import (atomic_json, describe_file, digest, file_digest, held,
                     identifier, now, read_json, verify_file)
from .ensembles import Ensembles
from .model_selection import validate_completed_run

KIND = "ensemble-consumer-plans"
OUTPUT_PARAMETERS = {
    "nitrogen_export": "nitrogen", "phosphorus_export": "phosphorus",
    "sediment_export": "sediment",
}
MODELED_OUTPUTS = tuple(OUTPUT_PARAMETERS)


def _profiles(plan, profile_ids=None):
    members = plan["members"]
    if profile_ids is None:
        return members
    if (not isinstance(profile_ids, list) or not profile_ids
            or len(set(profile_ids)) != len(profile_ids)):
        raise ValueError("Select distinct retained profile IDs from this study")
    by_profile = {member["profile_id"]: member for member in members}
    if set(profile_ids) - set(by_profile):
        raise ValueError("Every chosen profile must belong to the original saved study")
    return [by_profile[key] for key in profile_ids]


def _pollutants(expected, available, requested=None):
    if requested is not None:
        if (not isinstance(requested, list) or not requested
                or len(set(requested)) != len(requested)
                or any(name not in MODELED_OUTPUTS for name in requested)):
            raise ValueError("Choose distinct original nitrogen_export, phosphorus_export or sediment_export outputs")
        if set(requested) - set(expected):
            raise ValueError("Selected pollutants exceed the saved study's native model scope")
        if set(requested) - set(available):
            raise ValueError("Selected pollutants require an original output for every selected completed member")
        return [name for name in MODELED_OUTPUTS if name in requested]
    return [name for name in MODELED_OUTPUTS if name in expected and name in available]


def _run(workspace, row, member, plan):
    if row["state"] != "complete":
        return None
    run = workspace.inspect_run(row["run_id"])
    scope = validate_completed_run(run)
    selected = run["selection"]
    if (run.get("state") != "complete" or not scope["selected_models_complete"]
            or selected["profile_id"] != member["profile_id"]
            or selected["grid_id"] != plan["grid_id"]
            or selected["scenario_id"] != row["scenario_id"]):
        raise ValueError("The completed native run differs from its saved study member")
    return run, scope


def inspect(workspace, ensemble_id, *, profile_ids=None, scenario_ids=None):
    """Read current metadata; no raster, native execution or comparison creation."""
    plan = Ensembles(workspace).inspect(identifier(ensemble_id))
    members = _profiles(plan, profile_ids)
    expected = [name for name in MODELED_OUTPUTS if name in plan["model_scope"]["expected_artifacts"]]
    wanted = plan["alternative_scenario_ids"] if scenario_ids is None else scenario_ids
    if (not isinstance(wanted, list) or len(set(wanted)) != len(wanted)
            or set(wanted) - set(plan["alternative_scenario_ids"])):
        raise ValueError("Select original distinct land-cover scenarios from this saved study")
    results, pending = [], []
    for member in members:
        chosen = {row["scenario_id"]: row for row in member["runs"]}
        base_row = chosen[plan["baseline_scenario_id"]]
        baseline = _run(workspace, base_row, member, plan)
        available = set(expected)
        row = {"member_id": member["id"], "profile_id": member["profile_id"],
               "label": member["label"], "baseline_run_id": base_row["run_id"],
               "baseline_state": base_row["state"], "alternatives": [],
               "baseline_outputs": [], "common_outputs": [], "errors": []}
        if baseline:
            row["baseline_outputs"] = [name for name in expected if name in baseline[1]["available_artifacts"]]
            available &= set(row["baseline_outputs"])
        else:
            row["errors"].append({"kind": "baseline", "state": base_row["state"],
                                  "run_id": base_row["run_id"], "error": base_row.get("error")})
        for scenario_id in wanted:
            selected = chosen[scenario_id]
            current = _run(workspace, selected, member, plan)
            if baseline and current:
                outputs = [name for name in expected if name in current[1]["available_artifacts"]]
                available &= set(outputs)
                row["alternatives"].append({
                    "scenario_id": scenario_id, "run_id": selected["run_id"],
                    "outputs": outputs, "state": current[0]["state"],
                })
            else:
                row["errors"].append({"kind": "landcover", "scenario_id": scenario_id,
                                      "run_id": selected["run_id"], "state": selected["state"],
                                      "error": selected.get("error")})
        row["common_outputs"] = [name for name in expected if name in available] if baseline else []
        row["decision_ready"] = bool(baseline and row["alternatives"] and row["common_outputs"])
        row["calibration_ready"] = bool(baseline and row["baseline_outputs"])
        row["planned_scenario_count"] = len(wanted)
        row["completed_scenario_count"] = len(row["alternatives"])
        if row["errors"]:
            pending.append({"member_id": member["id"], "profile_id": member["profile_id"],
                            "label": member["label"], "errors": row["errors"]})
        results.append(row)
    return {
        "schema": "upstate.ensemble-consumer-catalog/v1",
        "ensemble_id": plan["id"], "title": plan["title"], "reason": plan["reason"],
        "workspace_id": workspace.project["id"], "grid_id": plan["grid_id"],
        "baseline_scenario_id": plan["baseline_scenario_id"],
        "scenario_ids": list(wanted), "expected_artifacts": expected,
        "model_scope": plan["model_scope"], "native_state": plan["state"],
        "native_run_signature": plan["run_signature"],
        "sources": plan["sources"], "members": results, "pending_members": pending,
        "planned_member_count": len(members),
        "calibration_member_count": sum(row["calibration_ready"] for row in results),
        "decision_member_count": sum(row["decision_ready"] for row in results),
        "interpretation": [
            "Baseline profile candidates enter original annual-load calibration; land-cover alternatives do not enter parameter fitting.",
            "Every land-cover comparison uses its own profile's baseline on the original retained grid.",
            "Completed members can be evaluated while pending members retain their original states and errors.",
            "Downstream pollutant selection can narrow the saved model scope; it never changes native calc_n/calc_p arguments or declares absent outputs complete.",
        ],
    }


def _common(members, field):
    return set.intersection(*(set(row[field]) for row in members)) if members else set()


def _snapshot(catalog):
    return {key: deepcopy(catalog[key]) for key in (
        "ensemble_id", "title", "reason", "workspace_id", "grid_id", "baseline_scenario_id",
        "scenario_ids", "expected_artifacts", "model_scope", "native_state",
        "native_run_signature", "sources", "members", "pending_members",
        "planned_member_count", "calibration_member_count", "decision_member_count")}


def prepare_decision(workspace, ensemble_id, *, profile_ids=None, scenario_ids=None,
                     reference_profile_id=None, pollutants=None, criteria=None):
    """Bind original multi-scenario comparisons to the maintained decision desk."""
    from . import decision_analysis as decisions
    catalog = inspect(workspace, ensemble_id, profile_ids=profile_ids, scenario_ids=scenario_ids)
    ready = [row for row in catalog["members"] if row["decision_ready"]]
    if not ready:
        raise ValueError("The saved study has no completed same-profile baseline/land-cover pair")
    reference = reference_profile_id or catalog["members"][0]["profile_id"]
    chosen = next((row for row in ready if row["profile_id"] == reference), None)
    if chosen is None:
        raise ValueError("The selected reference profile needs its completed baseline and at least one land-cover run")
    ready = [chosen] + [row for row in ready if row["profile_id"] != reference]
    outputs = _pollutants(catalog["expected_artifacts"], _common(ready, "common_outputs"), pollutants)
    if not outputs:
        raise ValueError("Completed selected study members share no original modeled output")
    criteria = deepcopy(criteria or {})
    permitted = {"title", "costs", "targets", "budget", "notes", "top_parcels_per_pollutant", "delivery_id"}
    if set(criteria) - permitted:
        raise ValueError("Decision criteria may supply title, costs, targets, budget, notes, parcel count or delivery_id")
    # Reuse the original comparison producer. It reads existing completed
    # exports and creates their original difference artifacts, without launching
    # an NDR/SDR model or changing any native arguments or run identity.
    comparisons = []
    for member in ready:
        ids = [member["baseline_run_id"]] + [row["run_id"] for row in member["alternatives"]]
        comparison = workspace.compare_runs(ids)
        if set(outputs) - set(comparison["common_artifacts"]):
            raise ValueError("The original retained comparison has a narrower pollutant scope")
        comparisons.append({"member_id": member["member_id"], "profile_id": member["profile_id"],
                            "comparison_id": comparison["id"], "run_ids": ids,
                            "common_artifacts": comparison["common_artifacts"]})
    value = {
        "schema": decisions.SELECTION_SCHEMA,
        "title": criteria.pop("title", catalog["title"] + " — scenario decisions"),
        "comparison_id": comparisons[0]["comparison_id"],
        "sensitivity_comparison_ids": [row["comparison_id"] for row in comparisons[1:]],
        "pollutants": outputs, "costs": [], "targets": {}, "notes": [],
        "top_parcels_per_pollutant": 10, **criteria,
    }
    # The existing summary intake validates physical definitions and chosen
    # axes before the handoff is retained; final build measures common cells.
    packet = decisions.workspace_packet(workspace, value, summary_only=True)
    decisions.analyze_packet(packet, value)
    return workspace._save(KIND, {
        "mode": "decision", "workspace_id": workspace.project["id"],
        "ensemble_id": catalog["ensemble_id"], "catalog": _snapshot(catalog),
        "selected_member_count": len(ready), "selected_profile_ids": [row["profile_id"] for row in ready],
        "pollutants": outputs, "comparisons": comparisons, "selection": value,
        "effect_direction": "baseline minus alternative; positive avoided export",
        "producer": {"path": "model/ensemble_consumers.py", "sha256": file_digest(Path(__file__))},
    })


def prepare_calibration(workspace, ensemble_id, reference_selection=None, *,
                        profile_ids=None, pollutants=None, reference_import_id=None,
                        reference_options=None, flow_support_source=None,
                        prepare_flow_support=False, flow_source_root=None):
    """Bind completed baseline candidates to explicitly retained observations."""
    from . import calibration
    catalog = inspect(workspace, ensemble_id, profile_ids=profile_ids, scenario_ids=[])
    ready = [row for row in catalog["members"] if row["calibration_ready"]]
    if not ready:
        raise ValueError("Complete at least one saved baseline candidate before annual-reference evaluation")
    outputs = _pollutants(catalog["expected_artifacts"], _common(ready, "baseline_outputs"), pollutants)
    parameters = [OUTPUT_PARAMETERS[name] for name in outputs]
    if not parameters:
        raise ValueError("Completed baseline candidates share no selected native output")
    source_reference = None
    if reference_import_id is not None:
        if reference_selection is not None:
            raise ValueError("Choose the original annual import or an explicit reference selection, not both")
        from . import ensemble_references
        value, source_reference = ensemble_references.selection(workspace, reference_import_id, reference_options)
    else:
        if reference_options is not None:
            raise ValueError("Reference options require an original annual-import selection")
        value = deepcopy(reference_selection)
    if not isinstance(value, dict):
        raise ValueError("Supply the existing calibration observation/catchment selection")
    ids = [row["baseline_run_id"] for row in ready]
    if "candidate_run_ids" in value and value["candidate_run_ids"] != ids:
        raise ValueError("Supplied candidate_run_ids differ from this saved study's completed baselines")
    value.update(schema=calibration.SELECTION_SCHEMA, candidate_run_ids=ids)
    value.setdefault("title", catalog["title"] + " — annual-load evaluation")
    value.setdefault("reference_run_id", ids[0])
    if "objective" not in value:
        observations = workspace._get("observations", identifier(value.get("observation_id")))
        selected_records = set(value.get("observation_record_ids", [row["id"] for row in observations["rows"]]))
        admitted = {row["parameter"] for row in observations["rows"]
                    if row["id"] in selected_records and row.get("admitted")}
        value["objective"] = {name: {"weight": 1.0} for name in parameters if name in admitted}
    else:
        objective = value["objective"]
        if not isinstance(objective, dict):
            raise ValueError("Supply original calibration objective definitions keyed by pollutant")
        outside = [name for name, item in objective.items()
                   if name not in parameters and isinstance(item, dict) and item.get("weight", 1) != 0]
        if outside:
            raise ValueError("Positive-weight objectives exceed this study's selected actual outputs: " + ", ".join(outside))
    if not isinstance(prepare_flow_support, bool):
        raise ValueError("Prepare-flow-support must be true or false")
    if flow_support_source is not None and prepare_flow_support:
        raise ValueError("Choose a retained flow-support source or prepare the original source")
    if (flow_support_source is not None or prepare_flow_support) and source_reference is None:
        raise ValueError("Linked flow support requires the original annual-import binding")
    if flow_source_root is not None and not prepare_flow_support:
        raise ValueError("A flow source directory applies only to the original replay")
    plan = calibration.prepare(workspace, value)
    flow_support = None
    if flow_support_source is not None or prepare_flow_support:
        from . import ensemble_flow_support
        if prepare_flow_support:
            operation = ensemble_flow_support.prepare(
                workspace, reference_import_id, source_root=flow_source_root)
            flow_support_source = operation["source"]
        selected_records = plan["selection"].get("observation_record_ids")
        selected_parameters = {name for name, item in plan["selection"]["objective"].items()
                               if item.get("weight", 1) != 0}
        selected_ids = [row["id"] for row in source_reference["reference_records"]
                        if row["parameter"] in selected_parameters
                        and (selected_records is None or row["id"] in selected_records)]
        flow_support = ensemble_flow_support.retain_report(
            workspace, ensemble_flow_support.bind(
                workspace, source_reference, flow_support_source, record_ids=selected_ids))
    return workspace._save(KIND, {
        "mode": "calibration", "workspace_id": workspace.project["id"],
        "ensemble_id": catalog["ensemble_id"], "catalog": _snapshot(catalog),
        "selected_member_count": len(ready), "selected_profile_ids": [row["profile_id"] for row in ready],
        "pollutants": [name for name in outputs if OUTPUT_PARAMETERS[name] in plan["selection"]["objective"]],
        "available_pollutants": outputs, "selection": plan["selection"], "calibration_plan_id": plan["id"],
        "annual_reference": source_reference, "flow_support": flow_support,
        "reference_units": plan["units"], "spatial_groups": plan["spatial_groups"],
        "normalization": plan["normalization"], "exclusions": plan["exclusions"],
        "producer": {"path": "model/ensemble_consumers.py", "sha256": file_digest(Path(__file__))},
    })


def _retained(workspace, consumer_id, mode):
    plan = workspace._get(KIND, identifier(consumer_id))
    if plan.get("workspace_id") != workspace.project["id"] or plan.get("mode") != mode:
        raise ValueError("Select this workspace's original " + mode + " study handoff")
    return plan


def _verify_decision_edition(workspace, destination, report_id):
    """Verify an earlier completed publication, including every ZIP member."""
    manifest = read_json(destination / "manifest.json")
    if manifest.get("report_id") != report_id:
        raise ValueError("The retained decision edition has another original report identity")
    members = {item["path"]: item for item in manifest["members"]}
    if len(members) != len(manifest["members"]):
        raise ValueError("The original decision delivery repeats a member")
    for item in members.values():
        verify_file(destination, item)
    members["manifest.json"] = describe_file(destination, destination / "manifest.json")
    with zipfile.ZipFile(destination / "decision-package.zip") as archive:
        names = archive.namelist()
        if len(set(names)) != len(names) or set(names) != set(members):
            raise ValueError("The retained decision ZIP membership differs from its complete edition")
        for name, expected in members.items():
            info = archive.getinfo(name)
            if info.file_size != expected["bytes"]:
                raise ValueError("The retained decision ZIP member size changed: " + name)
            checksum = hashlib.sha256()
            with archive.open(name) as stream:
                for block in iter(lambda: stream.read(1024 * 1024), b""):
                    checksum.update(block)
            if checksum.hexdigest() != expected["sha256"]:
                raise ValueError("The retained decision ZIP member changed: " + name)


def build_decision(workspace, consumer_id, *, summary_only=False):
    """Export the existing decision desk, CSVs, original packet and portable ZIP."""
    from . import decision_analysis as decisions
    plan = _retained(workspace, consumer_id, "decision")
    directory = workspace.root / "ensemble-consumer-results" / plan["id"]
    directory.mkdir(parents=True, exist_ok=True)
    with held(directory / ".decision.lock", blocking=False):
        path = directory / "state.json"
        state = {"consumer_id": plan["id"], "ensemble_id": plan["ensemble_id"],
                 "workspace_id": workspace.project["id"], "mode": "decision",
                 "state": "reading_original_outputs", "started_at": now()}
        atomic_json(path, state)
        try:
            packet = decisions.workspace_packet(workspace, plan["selection"], summary_only=summary_only)
            report = decisions.analyze_packet(packet, plan["selection"])
            destination = directory / "editions" / report["id"]
            if destination.exists():
                _verify_decision_edition(workspace, destination, report["id"])
                result = {"report_id": report["id"], "directory": str(destination),
                          "index": str(destination / "index.html"),
                          "archive": str(destination / "decision-package.zip"), "reused": True}
            else:
                result = decisions.export_report(report, destination, input_packet=packet)
            files = {name: describe_file(workspace.root, destination / filename)
                     for name, filename in (("report", "report.json"), ("html", "index.html"),
                                            ("manifest", "manifest.json"), ("archive", "decision-package.zip"),
                                            ("physical_input", "physical-input.json"))}
            state.update(state="complete", completed_at=now(), result=result, files=files,
                         pollutants=plan["pollutants"], summary_only=bool(summary_only),
                         selected_member_count=plan["selected_member_count"],
                         planned_member_count=plan["catalog"]["planned_member_count"],
                         pending_members=plan["catalog"]["pending_members"],
                         physical_scope=report["scope"])
            atomic_json(path, state)
            return state
        except BaseException as error:
            state.update(state="failed" if isinstance(error, Exception) else "interrupted",
                         error={"type": type(error).__name__, "message": str(error)}, updated_at=now())
            atomic_json(path, state)
            raise


def run_calibration(workspace, consumer_id, *, standard_errors=None):
    """Reuse original annual-reference evaluation and optional source-SE sensitivity."""
    from . import calibration
    plan = _retained(workspace, consumer_id, "calibration")
    directory = workspace.root / "ensemble-consumer-results" / plan["id"]
    directory.mkdir(parents=True, exist_ok=True)
    with held(directory / ".calibration.lock", blocking=False):
        path = directory / "state.json"
        previous = read_json(path) if path.exists() else {}
        if standard_errors is None:
            standard_errors = previous.get("requested_standard_errors")
        state = {"consumer_id": plan["id"], "ensemble_id": plan["ensemble_id"],
                 "workspace_id": workspace.project["id"], "mode": "calibration",
                 "state": "evaluating_original_references", "started_at": now(),
                 "calibration_plan_id": plan["calibration_plan_id"],
                 "requested_standard_errors": standard_errors}
        atomic_json(path, state)
        try:
            if plan.get("flow_support"):
                from . import ensemble_flow_support
                ensemble_flow_support.bind(workspace, plan["annual_reference"],
                    plan["flow_support"]["source"], record_ids=plan["flow_support"]["record_ids"])
                for descriptor in plan["flow_support"]["files"].values():
                    verify_file(workspace.root, descriptor)
                state["flow_support"] = {
                    "source": plan["flow_support"]["source"],
                    "record_count": plan["flow_support"]["record_count"],
                    "status_counts": plan["flow_support"]["status_counts"]}
            report = calibration.analyze(workspace, plan["calibration_plan_id"])
            state.update(state=report["state"], calibration_id=report["id"],
                         selected_run_id=report.get("selected_run_id"),
                         selected_profile_id=report.get("selected_profile_id"),
                         predicted_parameters=report.get("predicted_parameters"),
                         candidate_failures=report.get("candidate_failures", []),
                         selected_member_count=plan["selected_member_count"],
                         planned_member_count=plan["catalog"]["planned_member_count"],
                         pending_members=plan["catalog"]["pending_members"])
            atomic_json(path, state)
            if standard_errors is not None and report["state"] == "complete":
                from . import calibration_uncertainty
                uncertainty = calibration_uncertainty.analyze(
                    workspace, report["id"], standard_errors=standard_errors)
                state.update(uncertainty_id=uncertainty["id"],
                             uncertainty_state=uncertainty["state"],
                             selection_sensitivity=uncertainty["selection_sensitivity"])
            state["completed_at"] = now()
            atomic_json(path, state)
            return state
        except BaseException as error:
            state.update(state="failed" if isinstance(error, Exception) else "interrupted",
                         error={"type": type(error).__name__, "message": str(error)}, updated_at=now())
            atomic_json(path, state)
            raise
