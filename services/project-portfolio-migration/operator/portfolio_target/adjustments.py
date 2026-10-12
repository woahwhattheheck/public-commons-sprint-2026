"""Prepare task corrections against the original native migration and current records.

Each change uses the documented PssUpdateV1 scheduling action, retains its actual
read values, and is executed by the same target journal and OperationSet path.
"""
from __future__ import annotations

import copy
import datetime as dt

from .planner import FAMILIES, check_edition, metadata_from_probe, prepare_schedule, verify_plan
from .target import TargetError, digest, guid


def same_native_scalar(left, right):
    if left == right:
        return True
    if isinstance(left, str) and isinstance(right, str):
        try:
            a = dt.datetime.fromisoformat(left.replace("Z", "+00:00"))
            b = dt.datetime.fromisoformat(right.replace("Z", "+00:00"))
            if a.tzinfo is not None and b.tzinfo is not None:
                return a == b
        except ValueError:
            pass
    return False


def prepare_adjustment(edition, original_edition, profile, probe, deployment_id,
                       parent, original_plan, read_record, *, mappings=None):
    """Keep native IDs; retain actual before values for changed mapped task fields."""
    original = verify_plan(original_plan)
    model, prior_model = check_edition(edition), check_edition(original_edition)
    if parent["state"] not in ("NATIVE_COMPLETE", "CAPTURED", "ACCEPTED"):
        raise TargetError("ADJUSTMENT_PARENT", "Complete the original native migration before a following correction.")
    if original["target_identity"]["profile"] != probe["profile"]:
        raise TargetError("ADJUSTMENT_TARGET", "Use the original reviewed native target.")
    source_keys = {family: {row["key"] for row in model[family]} for family in FAMILIES}
    old_keys = {family: {row["key"] for row in prior_model[family]} for family in FAMILIES}
    for family in ("tasks", "resources", "assignments", "dependencies"):
        if source_keys[family] != old_keys[family]:
            raise TargetError("ADJUSTMENT_IDENTITIES",
                              "Task corrections preserve existing " + family + " identities.")
    structural = {"tasks": ("parent_uid",), "assignments": ("task_uid", "resource_uid"),
                  "dependencies": ("predecessor_uid", "successor_uid", "type", "lag")}
    for family, fields in structural.items():
        previous_rows = {row["key"]: row for row in prior_model[family]}
        for row in model[family]:
            if any(row.get(field) != previous_rows[row["key"]].get(field) for field in fields):
                raise TargetError("ADJUSTMENT_STRUCTURE",
                    "This correction keeps native hierarchy, assignments and dependencies; select field corrections for " +
                    family + "/" + row["key"] + ".")
    selected = copy.deepcopy(original["mappings"])
    if mappings is not None:
        if not isinstance(mappings, dict) or set(mappings) - {"task_fields", "date_decisions"}:
            raise TargetError("ADJUSTMENT_MAPPING", "Corrections may revise task fields and explicit date decisions.")
        selected.update(mappings)
    identity_seed = original.get("native_identity_seed", original["deployment_id"])
    desired = prepare_schedule(edition, profile, probe, identity_seed, selected)
    # A correction plan may itself be the parent. Its row identities remain those
    # of the first migration, and its desired projection describes the last intent.
    desired["project_id"] = original["project_id"]
    desired["project_name"] = original["project_name"]
    desired["bucket_id"] = original["bucket_id"]
    desired["row_ids"] = copy.deepcopy(original["row_ids"])
    old_projection = {(item["key"], item["target_field"]): item for item in original["projection"]
                      if item["family"] == "tasks"}
    new_projection = {(item["key"], item["target_field"]): item for item in desired["projection"]
                      if item["family"] == "tasks"}
    removed = sorted(set(old_projection) - set(new_projection))
    if removed:
        raise TargetError("ADJUSTMENT_REMOVED_MAPPING",
            "Keep mapped task fields, or explicitly set their source value to null before correcting them.")
    by_task = {}
    for identity, selected_field in new_projection.items():
        prior = old_projection.get(identity)
        if prior is None or not same_native_scalar(prior["target_value"], selected_field["target_value"]):
            by_task.setdefault(identity[0], {})[identity[1]] = selected_field
    m = metadata_from_probe(probe)
    entity = m.entity("msdyn_projecttask")
    project_column = m.lookup("msdyn_projecttask", "msdyn_project")
    operations, already_current, observations = [], [], []
    for source_key, fields in sorted(by_task.items()):
        record_id = guid(original["row_ids"]["tasks"][source_key])
        current = read_record("msdyn_projecttask", record_id)
        if not current or guid(current.get(project_column)) != original["project_id"]:
            raise TargetError("ADJUSTMENT_NATIVE_ROW", "The original task is absent from its selected native project.")
        current_sha = digest(current)
        observations.append({"entity": "msdyn_projecttask", "record_id": record_id,
                             "source_key": source_key, "sha256": current_sha, "native": current})
        before, values = {}, {}
        for field, selection in fields.items():
            desired_value = selection["target_value"]
            if same_native_scalar(current.get(field), desired_value):
                already_current.append({"source_key": source_key, "record_id": record_id,
                                        "field": field, "value": current.get(field),
                                        "native_sha256": current_sha})
            else:
                before[field] = current.get(field)
                values[field] = desired_value
        if not values:
            continue
        payload = {"@odata.type": entity["type"], entity["key"]: record_id, **values}
        m.validate_entity(payload)
        operation = {"action": "msdyn_PssUpdateV1", "entity": "msdyn_projecttask",
                     "record_id": record_id, "source_family": "tasks", "source_key": source_key,
                     "payload": payload, "precondition": {
                         "entity": "msdyn_projecttask", "record_id": record_id,
                         "project_id": original["project_id"], "before": before,
                         "observed_sha256": current_sha, "etag": current.get("@odata.etag")}}
        operation["id"] = digest(operation)
        operations.append(operation)
    batches = []
    set_size = profile.get("operation_set_size", 200)
    for start in range(0, len(operations), set_size):
        selected_ops = operations[start:start + set_size]
        number = len(batches) + 1
        batches.append({"number": number,
                        "description": "portfolio:" + deployment_id + ":" + str(number),
                        "operations": selected_ops, "sha256": digest(selected_ops)})
    findings = [item for item in desired["findings"] if item["code"] != "NATIVE_TRANSACTION_BOUNDARIES"]
    for code, message in (
        ("FOLLOWING_TASK_CORRECTION",
         "This following edition updates only listed mapped fields on the original native tasks. Existing native IDs, resources, assignments and dependencies are retained."),
        ("NATIVE_BEFORE_VALUE_REVIEW",
         "The current native values are read before review, before each queued update and before execution. The scheduling action has no conditional ETag parameter; coordinate concurrent target edits during this operation."),
        ("NATIVE_TRANSACTION_BOUNDARIES",
         "Each listed OperationSet is a separate native transaction. Earlier completed correction sets remain if a later set fails."),
    ):
        item = {"code": code, "message": message, "family": "tasks", "keys": [],
                "fields": [], "severity": "review"}
        item["id"] = digest(item)
        findings.append(item)
    result = {**desired, "schema": "portfolio.target-plan.v1",
              "deployment_id": deployment_id, "native_identity_seed": identity_seed,
              "parent_deployment_id": parent["id"], "parent_revision": parent["revision"],
              "parent_plan_sha256": parent["plan_sha256"],
              "parent_comparison_sha256": parent.get("comparison_sha256"),
              "mode": "task_correction", "existing_project": True,
              "immediate": [], "team_selections": [],
              "batches": batches, "findings": findings,
              "native_before": observations, "already_current": already_current,
              "counts": {"source": {family: len(model[family]) for family in FAMILIES},
                         "immediate_actions": 0, "queued_operations": len(operations),
                         "operation_sets": len(batches), "already_current_fields": len(already_current)}}
    result.pop("sha256", None)
    result["sha256"] = digest(result)
    return result


def verify_native_before(operation, target):
    expected = operation.get("precondition")
    if expected is None:
        return None
    current = target.record(expected["entity"], expected["record_id"])
    if current is None:
        raise TargetError("TARGET_PRECONDITION", "The original task disappeared after correction review.")
    m = target.metadata
    project_column = m.lookup(expected["entity"], "msdyn_project")
    if guid(current.get(project_column)) != expected["project_id"]:
        raise TargetError("TARGET_PRECONDITION", "The original task moved to another project.")
    changed = [field for field, value in expected["before"].items()
               if not same_native_scalar(current.get(field), value)]
    if changed:
        raise TargetError("TARGET_PRECONDITION",
                          "Native values changed after review: " + ", ".join(changed) +
                          ". Keep this OperationSet unexecuted and prepare a newly reviewed correction.")
    return {"entity": expected["entity"], "record_id": expected["record_id"],
            "current": current, "sha256": digest(current)}
