"""Continue the saved headwaters demo through native sensitivity and decisions.

All numerical work belongs to the existing ensemble, native comparison, paired
raster and decision services. The caller owns the current process and deadline.
"""
from __future__ import annotations

import argparse
from copy import deepcopy
from pathlib import Path
import json
import sys

STUDY = "routing-lmax-v1"
SCHEMA = "upstate.headwaters-parameter-course/v1"
TITLE = "Simulated headwaters: routing and slope-length sensitivity"
REASON = (
    "Compare the same explicitly simulated watershed and retained land-cover "
    "alternatives under the catalogue's linked native MFD/D8 routing and "
    "dimensionless SDR maximum-L choices. Preserve the original working profile, "
    "all forcing, exact source geometry, native outputs and physical support."
)


def prepare(workspace, selection):
    """Bind the one existing case and save its original native ensemble."""
    from model.common import atomic_json, digest, read_json, verify_file
    from model.ensemble_operations import study_design
    from model.ensembles import Ensembles

    if not isinstance(selection, dict):
        raise ValueError("Supply the actual saved demo selection object")
    names = ("grid_id", "baseline_scenario_id", "base_profile_id")
    if any(not isinstance(selection.get(name), str) or not selection[name] for name in names):
        raise ValueError("Supply the retained grid, baseline scenario and base profile IDs")
    alternatives = selection.get("alternative_scenario_ids")
    if (not isinstance(alternatives, list) or len(alternatives) < 2
            or any(not isinstance(item, str) or not item for item in alternatives)
            or len(set(alternatives)) != len(alternatives)):
        raise ValueError("Select the distinct retained riparian and control scenarios")
    bound = {name: selection[name] for name in names}
    bound["alternative_scenario_ids"] = list(alternatives)
    profile = workspace._get("profiles", bound["base_profile_id"])
    collection = workspace._get("sources", profile["source_collection_id"])
    original = collection["original_manifest"]
    source_manifest = read_json(verify_file(workspace.root, {**original, "path": original["object"]}))
    classification = source_manifest.get("classification")
    if classification != "SIMULATED DEMONSTRATION INPUTS":
        raise ValueError("Choose the original explicitly simulated source edition")
    grid = workspace.get_grid(bound["grid_id"])
    if grid["spec"]["source_collection_id"] != collection["id"]:
        raise ValueError("The grid and base profile must retain the same simulated input edition")
    selected = study_design(
        workspace, STUDY, grid_id=bound["grid_id"],
        baseline_scenario_id=bound["baseline_scenario_id"],
        base_profile_ids=[bound["base_profile_id"]],
        alternative_scenario_ids=bound["alternative_scenario_ids"],
        title=TITLE, reason=REASON)
    plan = Ensembles(workspace).prepare(selected["spec"])
    # Original base profiles are inserted before explored parameter members.
    if plan["members"][0]["profile_id"] != bound["base_profile_id"]:
        raise ValueError("The first native member must preserve the original reference profile")
    record = {
        "schema": SCHEMA, "project_id": workspace.project["id"],
        "ensemble_id": plan["id"], "study_id": STUDY, "selection": bound,
        "selection_sha256": digest(bound),
        "source_study": {"catalogue": selected["study"], "spec": selected["spec"],
                         "preview": selected["preview"]},
        "input_classification": classification,
        "input_source_collection_id": collection["id"],
        "input_manifest_sha256": collection["original_manifest"]["sha256"],
        "interpretation": {
            "parameter_range": "Descriptive range of the retained working choices",
            "joint_support": "Actual common finite cells across all available alternatives",
            "l_max_units": "dimensionless",
            "coupling": "NDR and SDR use the same routing choice in each member",
            "baseline_reuse": "Original saved profile and run selections are retained",
        },
    }
    directory = workspace.root / "ensemble_results" / plan["id"]
    path = directory / "headwaters-course.json"
    if path.exists():
        if read_json(path) != record:
            raise ValueError("The retained parameter course belongs to a different source selection")
    else:
        atomic_json(path, record, immutable=True)
    return {**record, "course_path": str(path), "plan": plan}


def _load(workspace, ensemble_id):
    from model.common import digest, identifier, read_json
    from model.ensembles import Ensembles

    key = identifier(ensemble_id)
    directory = workspace.root / "ensemble_results" / key
    record = read_json(directory / "headwaters-course.json")
    plan = Ensembles(workspace).inspect(key)
    if (record.get("schema") != SCHEMA or record.get("project_id") != workspace.project["id"]
            or record.get("ensemble_id") != key or record.get("study_id") != STUDY
            or digest(record["selection"]) != record["selection_sha256"]):
        raise ValueError("Use the original retained parameter course in its own project")
    expected = record["selection"]
    if (plan["grid_id"] != expected["grid_id"]
            or plan["baseline_scenario_id"] != expected["baseline_scenario_id"]
            or plan["base_profile_ids"] != [expected["base_profile_id"]]
            or plan["alternative_scenario_ids"] != expected["alternative_scenario_ids"]
            or plan["members"][0]["profile_id"] != expected["base_profile_id"]):
        raise ValueError("The native ensemble and retained case selection differ")
    return record, plan, directory


def _decision_export(workspace, plan, directory):
    """Join both alternatives per actual profile without another native solve."""
    from model import decision_analysis as decisions
    from model.common import atomic_json, describe_file, digest, read_json, verify_file

    expected_scenarios = [plan["baseline_scenario_id"], *plan["alternative_scenario_ids"]]
    comparisons, pending = [], []
    for member in plan["members"]:
        selected = member["runs"]
        if [item["scenario_id"] for item in selected] != expected_scenarios:
            raise ValueError("Retain the baseline and original alternative ordering")
        native = [workspace.inspect_run(item["run_id"]) for item in selected]
        for run, scenario_id in zip(native, expected_scenarios):
            choice = run["selection"]
            if (choice["profile_id"] != member["profile_id"]
                    or choice["scenario_id"] != scenario_id
                    or choice["grid_id"] != plan["grid_id"]):
                raise ValueError("A native member no longer matches its original source selection")
        if any(run["state"] != "complete" for run in native):
            pending.append({
                "member_id": member["id"], "profile_id": member["profile_id"],
                "runs": [{"run_id": run["id"], "state": run["state"],
                          "error": run.get("error")} for run in native],
            })
            continue
        comparison = workspace.compare_runs([run["id"] for run in native])
        comparisons.append({
            "member_id": member["id"], "profile_id": member["profile_id"],
            "assignments": deepcopy(member["assignments"]),
            "comparison_id": comparison["id"],
            "baseline_run_id": native[0]["id"],
            "alternative_run_ids": [run["id"] for run in native[1:]],
        })
    result = {"planned_members": len(plan["members"]), "completed_members": len(comparisons),
              "comparisons": comparisons, "pending_members": pending, "report": None}
    if not comparisons or comparisons[0]["member_id"] != plan["members"][0]["id"]:
        result["state"] = "waiting_for_reference_member"
        return result
    selection = {
        "schema": decisions.SELECTION_SCHEMA,
        "title": "Simulated headwaters: joint siting decisions across parameter choices",
        "comparison_id": comparisons[0]["comparison_id"],
        "sensitivity_comparison_ids": [item["comparison_id"] for item in comparisons[1:]],
        "costs": [], "targets": {}, "top_parcels_per_pollutant": 0,
        "notes": [
            "Inputs are the same retained simulated demonstration edition.",
            "Every profile compares all selected alternatives with its own unchanged baseline.",
            "Parameter summaries describe the explored choices; they are not confidence intervals.",
            "NDR does not use the SDR Lmax parameter; coupled cases can repeat nutrient results.",
            "Use original support groups and pending-member counts when interpreting robustness.",
            "Source-loading and per-treated-hectare interpretation remain with the retained scenario summary.",
        ],
    }
    # The original adapter reads actual rasters once on an all-alternative mask.
    packet = decisions.workspace_packet(workspace.root, selection)
    selection["pollutants"] = packet["pollutant_selection"]["selected"]
    # Reuse the one original raster packet. Different finite-cell support remains
    # visible as distinct original decision editions rather than being pooled.
    representatives, support_groups = [], {}
    for group in packet["comparisons"]:
        pattern = [
            {"scenario_key": item["scenario_key"],
             "outputs": {metric: {"id": data["support"].get("id"),
                                   "status": data["support"].get("status")}
                         for metric, data in sorted(item["outputs"].items())}}
            for item in sorted(group["alternatives"], key=lambda item: item["scenario_key"])
        ]
        key = digest(pattern)
        if key not in support_groups:
            support_groups[key] = {"support_pattern_id": key, "comparison_ids": [],
                                   "reference_comparison_id": group["id"], "pattern": pattern}
            representatives.append(group)
        support_groups[key]["comparison_ids"].append(group["id"])
    products = []
    for group in representatives:
        current_selection = deepcopy(selection)
        current_selection["comparison_id"] = group["id"]
        current_selection["sensitivity_comparison_ids"] = [
            item["comparison_id"] for item in comparisons if item["comparison_id"] != group["id"]]
        report = decisions.analyze_packet(packet, current_selection)
        target = directory / "joint-decisions" / report["id"]
        if target.exists():
            manifest = read_json(target / "manifest.json")
            if manifest.get("report_id") != report["id"]:
                raise ValueError("The retained decision directory has a different original report")
            for item in manifest["members"]:
                verify_file(target, item)
            retained = read_json(target / "report.json")
            if retained.get("id") != report["id"]:
                raise ValueError("The retained decision report changed")
            product = {"report_id": report["id"], "directory": str(target),
                       "index": str(target / "index.html"),
                       "archive": str(target / "decision-package.zip"), "reused": True}
        else:
            product = decisions.export_report(report, target, input_packet=packet)
        product["archive_identity"] = describe_file(workspace.root, target / "decision-package.zip")
        selection_path = directory / "joint-decisions" / (report["id"] + "-selection.json")
        atomic_json(selection_path, current_selection, immutable=True)
        product.update(selection_path=str(selection_path),
                       reference_comparison_id=group["id"],
                       reference_profile_id=group["baseline"]["profile_id"])
        products.append(product)
    result.update(state="complete" if not pending else "partial",
                  selection_path=products[0]["selection_path"], report=products[0],
                  support_groups=list(support_groups.values()),
                  support_group_reports=products)
    return result


def reference_report_basis(workspace, ensemble_id, course):
    """Describe the completed original reference trio without promoting the course.

    The full design and pending sensitivities stay retained. Callers choose a
    separately labelled source/report edition and its own receiving contract.
    """
    record, plan, _ = _load(workspace, ensemble_id)
    if (course.get("schema") != SCHEMA
            or course.get("project_id") != workspace.project["id"]
            or course.get("ensemble_id") != plan["id"]
            or course.get("selection") != record["selection"]
            or course.get("input_classification") != record["input_classification"]):
        raise ValueError("Use the original parameter-course result in its own project")
    member = plan["members"][0]
    scenarios = [plan["baseline_scenario_id"], *plan["alternative_scenario_ids"]]
    if [item["scenario_id"] for item in member["runs"]] != scenarios:
        raise ValueError("The reference member no longer preserves original scenario order")
    runs = [workspace.inspect_run(item["run_id"]) for item in member["runs"]]
    for run, scenario in zip(runs, scenarios):
        if (run["selection"]["profile_id"] != member["profile_id"]
                or run["selection"]["grid_id"] != plan["grid_id"]
                or run["selection"]["scenario_id"] != scenario):
            raise ValueError("The reference run no longer matches the saved course")
    decisions = course.get("joint_decisions", {})
    comparisons = [item for item in decisions.get("comparisons", [])
                   if item["member_id"] == member["id"]]
    if len(comparisons) > 1:
        raise ValueError("The retained course repeats its original reference comparison")
    comparison = comparisons[0] if comparisons else None
    if comparison and (comparison["profile_id"] != member["profile_id"]
            or comparison["baseline_run_id"] != runs[0]["id"]
            or comparison["alternative_run_ids"] != [run["id"] for run in runs[1:]]):
        raise ValueError("The retained reference comparison uses different native runs")
    ready = all(run["state"] == "complete" for run in runs) and comparison is not None
    return {
        "schema": "upstate.headwaters-reference-report-basis/v1",
        "project_id": workspace.project["id"], "ensemble_id": plan["id"],
        "state": "reference_complete" if ready else "waiting_for_reference",
        "reference_ready": ready, "course_state": course["state"],
        "input_classification": record["input_classification"],
        "reference_member_id": member["id"], "reference_profile_id": member["profile_id"],
        "reference_run_ids": [run["id"] for run in runs],
        "baseline_run_id": runs[0]["id"],
        "alternative_run_ids": [run["id"] for run in runs[1:]],
        "comparison_id": comparison["comparison_id"] if ready else None,
        "planned_profile_count": len(plan["members"]),
        "completed_comparison_profile_count": len(decisions.get("comparisons", [])),
        "native_progress": deepcopy(plan["progress"]),
        "pending_members": deepcopy(decisions.get("pending_members", [])),
        "scope": "The original reference profile and its complete selected alternatives; "
                 "the retained sensitivity design keeps its own progress and pending members.",
    }


def _retained_complete(workspace, record, plan, directory, previous, raster_products):
    """Reuse the exact completed record before any timestamp-writing operation."""
    from model.common import verify_file

    if not previous:
        return None
    if (previous.get("schema") != SCHEMA
            or previous.get("project_id") != workspace.project["id"]
            or previous.get("ensemble_id") != plan["id"]
            or previous.get("selection") != record["selection"]
            or previous.get("input_classification") != record["input_classification"]):
        raise ValueError("The retained parameter result belongs to a different source selection")
    if previous.get("state") != "complete":
        return None
    operation = previous.get("operation", {})
    decisions = previous.get("joint_decisions", {})
    comparisons = decisions.get("comparisons", [])
    if (plan["state"] != "complete" or operation.get("state") != "complete"
            or decisions.get("state") != "complete" or decisions.get("pending_members")
            or operation.get("errors") or len(comparisons) != len(plan["members"])):
        raise ValueError("The completed parameter result does not match its complete native design")
    for member, comparison in zip(plan["members"], comparisons):
        if (any(run["state"] != "complete" for run in member["runs"])
                or comparison["member_id"] != member["id"]
                or comparison["profile_id"] != member["profile_id"]
                or comparison["baseline_run_id"] != member["runs"][0]["run_id"]
                or comparison["alternative_run_ids"] !=
                   [run["run_id"] for run in member["runs"][1:]]):
            raise ValueError("The completed parameter result uses different native members")
    if raster_products and not operation.get("requested", {}).get("raster_products"):
        # This is an explicit product expansion, not an unchanged resume. The
        # caller preserves this earlier result as an immutable edition first.
        return None
    if raster_products:
        products = operation.get("raster_products", [])
        if ([item["scenario_id"] for item in products] != plan["alternative_scenario_ids"]
                or any(item["state"] != "complete" for item in products)):
            raise ValueError("The completed parameter result omits requested paired products")
    report = operation.get("report", {})
    if report.get("state") != "complete":
        raise ValueError("The completed parameter result has no completed original report")
    report_directory = workspace.root / "ensemble_reports" / report["id"]
    for descriptor in report.get("files", {}).values():
        verify_file(report_directory, descriptor)
    for product in decisions.get("support_group_reports", []):
        verify_file(workspace.root, product["archive_identity"])
    return deepcopy(previous)


def continue_course(workspace, ensemble_id, *, execute=False, raster_products=True,
                    on_progress=None):
    """Continue the same native operation and retain its full joint decision edition."""
    from model.common import atomic_json, digest, now, read_json
    from model.ensemble_operations import operation

    from model.common import held

    record, plan, directory = _load(workspace, ensemble_id)
    with held(directory / ".headwaters-course.lock", blocking=False):
        path = directory / "headwaters-results.json"
        previous = read_json(path) if path.exists() else {}
        retained = _retained_complete(
            workspace, record, plan, directory, previous, raster_products)
        if retained is not None:
            return retained
        if previous.get("state") == "complete":
            atomic_json(directory / "headwaters-result-editions" / (digest(previous) + ".json"),
                        previous, immutable=True)
        result = {"schema": SCHEMA, "project_id": workspace.project["id"],
                  "ensemble_id": plan["id"], "selection": record["selection"],
                  "input_classification": record["input_classification"],
                  "started_at": (previous.get("started_at", now())
                                 if previous.get("state") != "complete" else now()),
                  "state": "running" if execute else "reporting"}
        atomic_json(path, result)
        try:
            result["operation"] = operation(
                workspace, plan["id"], run_native=execute,
                with_raster_products=raster_products, resume_raster_products=True,
                source_study=record["source_study"], on_progress=on_progress)
            _, current, _ = _load(workspace, plan["id"])
            result["joint_decisions"] = _decision_export(workspace, current, directory)
            complete = (result["operation"]["state"] == "complete"
                        and result["joint_decisions"]["state"] == "complete")
            result.update(state="complete" if complete else "partial", completed_at=now())
            result["reference_report_basis"] = reference_report_basis(workspace, plan["id"], result)
            atomic_json(path, result)
            return result
        except BaseException as error:
            result.update(state="failed" if isinstance(error, Exception) else "interrupted",
                          updated_at=now(),
                          error={"type": type(error).__name__, "message": str(error)})
            try:
                atomic_json(path, result)
            except OSError as receipt_error:
                error.course_receipt_error = {
                    "type": type(receipt_error).__name__,
                    "message": str(receipt_error), "errno": receipt_error.errno,
                }
                if hasattr(error, "add_note"):
                    error.add_note("Could not retain the parameter-course failure record: "
                                   + str(receipt_error))
            raise


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--application", required=True)
    parser.add_argument("--workspace", required=True)
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--selection", help="Actual saved grid/baseline/profile/alternative IDs")
    source.add_argument("--ensemble-id", help="Continue the same retained course")
    parser.add_argument("--prepare-only", action="store_true")
    parser.add_argument("--execute", action="store_true", help="Run the original native selections")
    parser.add_argument("--without-raster-products", action="store_true")
    args = parser.parse_args(argv)
    if args.prepare_only and args.execute:
        parser.error("Choose preparation or native execution")
    application = Path(args.application).resolve(strict=True)
    sys.path.insert(0, str(application))
    from model.common import read_json
    from model.workspace import Workspace

    workspace = Workspace(Path(args.workspace).resolve(strict=True))
    if args.selection:
        prepared = prepare(workspace, read_json(Path(args.selection).resolve(strict=True)))
        key = prepared["ensemble_id"]
    else:
        key = args.ensemble_id
        record, plan, directory = _load(workspace, key)
        prepared = {**record, "plan": plan, "course_path": str(directory / "headwaters-course.json")}
    if args.prepare_only:
        result = prepared
    else:
        result = continue_course(
            workspace, key, execute=args.execute,
            raster_products=not args.without_raster_products,
            on_progress=lambda value: print(json.dumps(value, ensure_ascii=False), flush=True))
    print(json.dumps(result, ensure_ascii=False, indent=2, allow_nan=False))
    return 0 if args.prepare_only or result["state"] == "complete" else 2


if __name__ == "__main__":
    raise SystemExit(main())
