"""Readable original Calibration Studies in the existing receiving desk."""
from __future__ import annotations

import copy

from .common import identifier
from . import calibration_native_study_transfer as transfer
from . import calibration_study_transfer as dependencies


def summary(identity):
    rows = identity.get("calibration_studies", [])
    return {"calibration_study_count": len(rows),
            "calibration_result_count": len({row["report_id"] for row in rows if row.get("report_id")}),
            "calibration_reading_package_count": len({item["prefix"] for row in rows for item in row["exports"]})}


def _metrics(report):
    if report is None or not report.get("selected_run_id"):
        return []
    selected = [row for row in report["ranked_candidates"] if row["run_id"] == report["selected_run_id"]]
    if len(selected) != 1:
        raise ValueError("The original selected Calibration candidate is missing or ambiguous")
    rows = []
    for partition, score in (("calibration", selected[0]),
                             ("validation", report.get("selected_validation", {}))):
        for parameter, value in score.get("pollutant_metrics", {}).items():
            rows.append({"partition": partition, "parameter": parameter, "units": value["units"],
                         "n": value["catchments"], "groups": value["spatial_groups"],
                         "rmse": value["rmse"], "mean_bias": value["mean_bias"],
                         "nash_sutcliffe_efficiency": value["nash_sutcliffe_efficiency"],
                         "source_period_records": value.get("source_period_records"),
                         "state": score.get("state", "complete")})
    return rows


def _supplement_members(closure, supplements):
    members = []
    for item in supplements:
        value = transfer._raw(closure, item["kind"], item["id"])
        members.append(transfer._member(closure, item["kind"] + "/" + item["id"] + ".json", item["title"]))
        if item["kind"] not in dependencies.EXPORTS:
            continue
        prefix = value["directory"]
        inventory = value["files"]
        entries = inventory.items() if isinstance(inventory, dict) else ((v["path"], v) for v in inventory)
        for name, descriptor in entries:
            members.append(transfer._member(closure, prefix + "/" + dependencies._name(name), name, descriptor))
        for name in ("manifest", "archive"):
            if value.get(name):
                descriptor = value[name]
                members.append(transfer._member(closure, prefix + "/" + dependencies._name(descriptor["path"]),
                                                item["title"] + " · " + name, descriptor))
    return members


def augment(closure, retained, result):
    identity = retained["identity"]
    captured = identity.get("calibration_studies", [])
    transfer.verify_receipt(closure, captured)
    rows = []
    for binding in captured:
        kind, key = binding["kind"], binding["id"]
        original, plan, report = transfer._context(closure, kind, key, binding.get("report_id"))
        observed = transfer._raw(closure, "observations", plan["selection"]["observation_id"])
        selection = plan["selection"]
        current_state = report.get("state") if report else binding["captured_state"]
        current_report_id = report["id"] if report else None
        if kind == "calibration-plans":
            from .calibration import inspect
            current = inspect(closure.workspace, key)
            current_state, current_report_id = current["state"], current.get("result_id")
        members = []
        for record in binding["records"]:
            if record["kind"] != "calibration-plans":
                members.append(transfer._member(closure, record["kind"] + "/" + record["id"] + ".json",
                                                dependencies.LABELS[record["kind"]]))
        for package in binding["exports"]:
            members.extend(copy.deepcopy(package["members"]))
        members.extend(_supplement_members(closure, binding["supplements"]))
        members = list({item["path"]: item for item in members}.values())
        prior = plan.get("reference_history", {}).get("history", [])
        prior_ids = [row["calibration_id"] for row in prior]
        choice = copy.deepcopy(selection["catchments"])
        source = transfer._raw(closure, "sources", choice["source_collection_id"])
        entries = [entry for entry in source["entries"] if entry["id"] == choice["source_id"]]
        if len(entries) != 1:
            raise ValueError("The retained Calibration catchment source is missing or ambiguous")
        entry = entries[0]
        chosen = next((candidate for candidate in report.get("ranked_candidates", [])
                       if candidate["run_id"] == report.get("selected_run_id")), None) if report else None
        rows.append({
            "schema": "upstate.received-calibration-study/v1",
            "kind": kind, "id": key, "plan_id": plan["id"],
            "report_id": report["id"] if report else None,
            "current_report_id": current_report_id,
            "title": original.get("title") or selection["title"],
            "state": binding["captured_state"], "captured_state": binding["captured_state"],
            "current_state": current_state,
            "editable": True, "source_project_id": binding["source_project_id"],
            "relationship": "same_project",
            "observation": {"id": observed["id"], "title": observed["metadata"].get("title", observed["id"]),
                            "original_sha256": observed["original"]["sha256"],
                            "record_count": len(observed["rows"])},
            "catchments": {**choice, "label": entry.get("title") or entry["id"],
                           "title": entry.get("title") or entry["id"],
                           "original_sha256": entry["body"]["sha256"],
                           "source_vintage": entry.get("vintage")},
            "candidate_count": len(plan["candidates"]),
            "distinct_profile_count": len({candidate["profile_id"] for candidate in plan["candidates"]}),
            "selected_run_id": report.get("selected_run_id") if report else None,
            "selected_profile_id": report.get("selected_profile_id") if report else None,
            "selected_profile_title": chosen.get("title") if chosen else None,
            "evaluation_design": ("spatial_holdout" if selection["validation_group_ids"] else "calibration_only"),
            "partitions": {"calibration_group_ids": copy.deepcopy(selection["calibration_group_ids"]),
                           "validation_group_ids": copy.deepcopy(selection["validation_group_ids"])},
            "selected_metrics": _metrics(report),
            "history": {"evaluation_count": len(prior_ids) + (1 if report else 0),
                        "earlier_ids": prior_ids, "current_id": report["id"] if report else None},
            "source_selection": copy.deepcopy(selection),
            "source_vintages": copy.deepcopy(plan.get("source_vintages", [])),
            "reference_interpretation": report.get("reference_interpretation") if report else None,
            "source_members": copy.deepcopy(binding["source_members"]),
            "result_members": members,
            "supplements": copy.deepcopy(binding["supplements"]),
            "reading_packages": [{k: v for k, v in item.items() if k != "members"} for item in binding["exports"]],
        })
    result["calibration_studies"] = rows
    return result
