"""One local source-contract exercise; no tenant, native reader or provider call.

Run from the existing operator source:
  python3 examples/COMMISSIONING_SOURCE_EXERCISE.py

The explicitly authored rows below exercise unchanged-source correction,
project/identity scope, multiple buckets, an unassigned retained resource, typed
before checks, and a following correction. The installed owner's one original
native programme remains responsible for real reader/OperationSet receiving.
"""
from __future__ import annotations

import copy
import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from portfolio_target.commissioning import ImportCommissioning
from portfolio_target.commissioning_plan import (
    build_inventory, checked_mapping, compare_projection, field_projection,
    observed_correction_plan, same_value, verify_observed_before,
)
from portfolio_target.planner import FAMILIES, metadata_from_probe, review_schedule, target_identity
from portfolio_target.target import TargetError, canonical, digest

PROJECT = "11111111-1111-4111-8111-111111111111"
TASK_A = "22222222-2222-4222-8222-222222222222"
TASK_B = "33333333-3333-4333-8333-333333333333"
TEAM = "44444444-4444-4444-8444-444444444444"
BUCKET_A = "55555555-5555-4555-8555-555555555555"
BUCKET_B = "66666666-6666-4666-8666-666666666666"
USER = "77777777-7777-4777-8777-777777777777"
ORG = "88888888-8888-4888-8888-888888888888"


def required(value, message):
    if not value:
        raise AssertionError(message)


def rejected(call, code):
    try:
        call()
    except TargetError as exc:
        required(exc.code == code, "Unexpected rejection: " + exc.code)
        return
    raise AssertionError("Expected " + code)


def entity(name, key, properties, links=None):
    return {"type": "Microsoft.Dynamics.CRM." + name, "key": key,
            "set": name + "s", "properties": {name: {"Type": kind} for name, kind in properties.items()},
            "navigation": {name: {"constraints": [{"Property": column}]} for name, column in (links or {}).items()}}


def capture_request_continuation():
    """The real capture entry point must preserve another interrupted request."""
    capture_a, capture_b = digest("original interrupted capture"), digest("different capture")
    plan = {"schema": "portfolio.import-adoption-selection.v1"}
    progress = {"request_id": capture_a, "started_at": "2026-10-12T00:00:00Z",
                "reader_transport_sha256": digest("retained original reader pages"),
                "capture_probe_sha256": digest("retained original probe"),
                "capture_edition_id": digest("retained original native edition"),
                "team_capture": {"complete": False, "pages": [{"sha256": digest("retained original team page")}],
                                 "next_url": "https://example.invalid/next-original-team-page"}}
    deployment = {"id": digest("adopted deployment"), "revision": 9, "state": "CAPTURED",
                  "commissioning_origin": "external_import", "plan_sha256": digest(plan),
                  "capture_in_progress": progress}
    original = canonical(deployment)
    class ReachedOriginalContinuation(Exception):
        pass
    class RetainedStore:
        def index(self, kind, identity):
            required(kind == "deployments" and identity == deployment["id"], "Exact original capture deployment")
            return copy.deepcopy(deployment)
        def read(self, identity):
            required(identity == digest(plan), "Exact original capture selection")
            return copy.deepcopy(plan)
        def put(self, value):
            raise AssertionError("A capture ownership preflight cannot write immutable objects")
        def save(self, *args, **kwargs):
            raise AssertionError("A capture ownership preflight cannot replace progress")
    class CaptureBoundary:
        store = RetainedStore()
        portfolio = None
        def __init__(self):
            self.original_calls = []
        def _capture_start(self, request_id, identity, expected_revision):
            self.original_calls.append((request_id, identity, expected_revision))
            raise ReachedOriginalContinuation()
    owner = CaptureBoundary()
    service = ImportCommissioning(owner)
    rejected(lambda: service.capture(capture_b, deployment["id"], expected_revision=9),
             "COMMISSIONING_CAPTURE_ACTIVE")
    required(owner.original_calls == [] and canonical(deployment) == original,
             "A new current-revision capture cannot replace any original progress")
    try:
        service.capture(capture_a, deployment["id"], expected_revision=4)
    except ReachedOriginalContinuation:
        pass
    else:
        raise AssertionError("The original capture must reach its retained continuation")
    required(owner.original_calls == [(capture_a, deployment["id"], 4)] and canonical(deployment) == original,
             "The original request resumes with its original argument and complete progress")
    return {"different_request_rejected": True, "original_request_continues": True,
            "retained_progress_unchanged": True, "original_expected_revision": 4}


def main():
    capture_continuation = capture_request_continuation()
    profile = {"id": "authored-source-exercise", "label": "Authored source-contract data",
               "kind": "project_operations", "api_origin": "https://example.invalid",
               "api_version": "9.2", "user_id": USER, "organization_id": ORG,
               "licensed_project_user": True, "source_timezone": "UTC", "operation_set_size": 200}
    entities = {
        "msdyn_project": entity("msdyn_project", "msdyn_projectid", {"msdyn_projectid": "Edm.Guid", "msdyn_subject": "Edm.String"}),
        "msdyn_projecttask": entity("msdyn_projecttask", "msdyn_projecttaskid",
            {"msdyn_projecttaskid": "Edm.Guid", "msdyn_subject": "Edm.String",
             "msdyn_scheduledstart": "Edm.DateTimeOffset", "msdyn_scheduledend": "Edm.DateTimeOffset",
             "_msdyn_project_value": "Edm.Guid", "_msdyn_projectbucket_value": "Edm.Guid", "new_ready": "Edm.Boolean"},
            {"msdyn_project": "_msdyn_project_value", "msdyn_projectbucket": "_msdyn_projectbucket_value"}),
        "msdyn_projectteam": entity("msdyn_projectteam", "msdyn_projectteamid",
            {"msdyn_projectteamid": "Edm.Guid", "_msdyn_project_value": "Edm.Guid", "msdyn_name": "Edm.String"},
            {"msdyn_project": "_msdyn_project_value"}),
        "msdyn_resourceassignment": entity("msdyn_resourceassignment", "msdyn_resourceassignmentid",
            {"msdyn_resourceassignmentid": "Edm.Guid"},
            {"msdyn_projectid": "_msdyn_projectid_value", "msdyn_projectteamid": "_msdyn_projectteamid_value",
             "msdyn_taskid": "_msdyn_taskid_value"}),
        "msdyn_projecttaskdependency": entity("msdyn_projecttaskdependency", "msdyn_projecttaskdependencyid",
            {"msdyn_projecttaskdependencyid": "Edm.Guid"}, {"msdyn_Project": "_msdyn_project_value"}),
    }
    metadata = {"schema": "portfolio.native-target-metadata.v1", "sha256": digest(entities),
                "entities": entities, "actions": {}}
    probe = {"schema": "portfolio.target-probe.v1", "profile": profile,
             "identity": {"UserId": USER, "OrganizationId": ORG}, "metadata": metadata,
             "fixture": "authored source contract; not a native tenant observation"}
    probe["sha256"] = digest(probe)
    m = metadata_from_probe(probe)
    model = {"schema": "project-portfolio-model.v1", "project": {"key": "project:source", "fields": {}},
             "tasks": [{"key": "task:first", "uid": 1, "fields": {"NAME": {"type": "string", "value": "Retained source task"}}},
                       {"key": "task:second", "uid": 2, "fields": {"NAME": {"type": "string", "value": "Second task"}}}],
             "resources": [{"key": "resource:unassigned", "uid": 10, "fields": {"NAME": {"type": "string", "value": "Unassigned original"}}}],
             "assignments": [], "dependencies": [],
             "calendars": [{"key": "calendar:original", "uid": 1, "fields": {"NAME": {"type": "string", "value": "Original calendar"}}}]}
    edition = {"id": digest({"source": "authored-practice"}), "sha256": digest(model), "model": model,
               "source_ids": [digest("retained authored input")]}
    capture_model = copy.deepcopy(model)
    capture_model["tasks"][0].update(key="reader:one", guid=TASK_A)
    capture_model["tasks"][0]["fields"]["NAME"]["value"] = "Wrong imported name"
    capture_model["tasks"][1].update(key="reader:two", guid=TASK_B)
    capture_model["resources"], capture_model["calendars"] = [], []
    capture = {"id": digest({"capture": "authored-practice"}), "sha256": digest(capture_model), "model": capture_model}
    raw_rows = [
        {"msdyn_projecttaskid": TASK_A, "_msdyn_project_value": PROJECT,
         "_msdyn_projectbucket_value": BUCKET_A, "msdyn_subject": "Wrong imported name", "@odata.etag": 'W/"17"'},
        {"msdyn_projecttaskid": TASK_B, "_msdyn_project_value": PROJECT,
         "_msdyn_projectbucket_value": BUCKET_B, "msdyn_subject": "Second task", "@odata.etag": 'W/"18"'},
    ]
    project = {"msdyn_projectid": PROJECT, "msdyn_subject": "Authored imported plan",
               "msdyn_msdyn_project_msdyn_projecttask_project": raw_rows,
               "msdyn_msdyn_project_msdyn_projecttaskdependency_Project": [],
               "msdyn_msdyn_project_msdyn_resourceassignment_projectid": []}
    teams = [{"msdyn_projectteamid": TEAM, "_msdyn_project_value": PROJECT, "msdyn_name": "Unassigned original"}]
    receipt = {"body_sha256": digest(project), "kind": "project", "fixture": True}
    inventory = build_inventory(capture, project, receipt, teams, m, PROJECT,
                                transport_sha256=digest("retained original pages"),
                                team_capture_sha256=digest("retained original teams"))
    selection = {"tasks": {"task:first": TASK_A, "task:second": TASK_B},
                 "resources": {"resource:unassigned": TEAM}, "assignments": {}, "dependencies": {}}
    rows, identity_map, findings, evidence = checked_mapping(edition, capture, inventory, m, selection)
    required(identity_map["tasks"] == {"task:first": "reader:one", "task:second": "reader:two"}, "Actual reader keys")
    required(not identity_map["resources"] and any(x["code"] == "CAPTURE_RESOURCE_IDENTITY_UNRESOLVED" for x in findings),
             "The unassigned original is retained as unresolved")
    required({x["bucket_id"] for x in inventory["bucket_observations"]} == {BUCKET_A, BUCKET_B}, "Both observed buckets")
    projection, retained, mappings = field_projection(edition, profile, m)
    basis = compare_projection(edition, inventory, rows, projection)
    required(basis["counts"]["different"] == 1 and basis["counts"]["equal"] == 1, "Actual wrong imported field")
    original_plan = {"schema": "portfolio.target-plan.v1", "deployment_id": digest("original adoption"),
        "mode": "external_import_adoption", "source_edition_id": edition["id"],
        "source_edition_sha256": edition["sha256"], "source_ids": edition["source_ids"],
        "target_identity": target_identity(profile, probe), "probe_sha256": probe["sha256"],
        "project_id": PROJECT, "project_name": "Authored imported plan", "existing_project": True,
        "bucket_id": None, "bucket_observations": inventory["bucket_observations"], "row_ids": rows,
        "team_selections": [], "mappings": mappings, "projection": projection,
        "immediate": [], "batches": [], "findings": findings + retained, "counts": {}}
    original_plan["sha256"] = digest(original_plan)
    parent = {"id": original_plan["deployment_id"], "revision": 4, "state": "CAPTURED",
              "plan_sha256": digest(original_plan), "comparison_sha256": digest(basis),
              "commissioning_inventory_sha256": digest(inventory),
              "adoption_review_sha256": digest("actual authored review")}
    original_source_bytes = canonical(edition)
    current = {item["msdyn_projecttaskid"]: copy.deepcopy(item) for item in raw_rows}
    plan = observed_correction_plan(edition, edition, profile, probe, digest("following correction"),
                                    parent, original_plan, inventory, current)
    required(canonical(edition) == original_source_bytes, "Original source was not changed to force a difference")
    ops = [item for batch in plan["batches"] for item in batch["operations"]]
    required(len(ops) == 1 and ops[0]["record_id"] == TASK_A, "One exact existing task update")
    required(ops[0]["action"] == "msdyn_PssUpdateV1" and ops[0]["payload"]["msdyn_subject"] == "Retained source task",
             "Original intended value")
    required(not plan["immediate"] and plan["bucket_id"] is None and plan["row_ids"] == rows, "No creation or ID substitution")
    reviewed = review_schedule(plan, reviewer="Authored source exercise", note="Review the exact single task update",
                               accepted_findings=[item["id"] for item in plan["findings"]])
    required(reviewed["plan_sha256"] == plan["sha256"], "Maintained native review format")
    class Target:
        metadata = m
        def record(self, entity, identity):
            return copy.deepcopy(current.get(identity))
    verify_observed_before(ops[0], Target())
    current[TASK_A]["msdyn_subject"] = "Another editor's value"
    rejected(lambda: verify_observed_before(ops[0], Target()), "TARGET_PRECONDITION")
    required(not same_value(True, 1) and not same_value(False, 0), "Typed native values")
    required(same_value("2026-10-12T00:00:00Z", "2026-10-12T01:00:00+01:00", {"convert": "utc"}), "Explicit UTC comparison")
    required(not same_value("2026-10-12T00:00:00Z", "2026-10-12T01:00:00+01:00"), "Text is not implicitly a date")
    duplicate = copy.deepcopy(selection)
    duplicate["tasks"]["task:second"] = TASK_A
    rejected(lambda: checked_mapping(edition, capture, inventory, m, duplicate), "COMMISSIONING_NONINJECTIVE_MAP")
    wrong = copy.deepcopy(project)
    wrong["msdyn_msdyn_project_msdyn_projecttask_project"][0]["_msdyn_project_value"] = ORG
    rejected(lambda: build_inventory(capture, wrong, receipt, teams, m, PROJECT,
        transport_sha256=digest("pages"), team_capture_sha256=digest("teams")), "COMMISSIONING_ROW_PROJECT")
    current[TASK_A]["msdyn_subject"] = "Retained source task"
    no_change = observed_correction_plan(edition, edition, profile, probe, digest("already observed correct"),
                                         parent, original_plan, inventory, current)
    required(not no_change["batches"] and no_change["counts"]["already_current_fields"] == 2,
             "Current observed values, rather than stale capture, determine whether a write is needed")
    print(json.dumps({"status": "PASS", "scope": "authored local source-contract exercise",
        "provider_calls": 0, "native_reader_calls": 0, "native_writes": 0,
        "capture_continuation": capture_continuation,
        "unchanged_source_id": edition["id"], "original_source_sha256": digest(edition),
        "selected_existing_task": TASK_A, "prepared_update_count": len(ops),
        "preserved_bucket_count": len(inventory["bucket_observations"]),
        "unassigned_resource_retained": True, "original_review_digest": reviewed["sha256"],
        "checks": ["unchanged source with wrong observed target", "exact existing GUIDs",
                   "multiple retained buckets", "unassigned original resource", "before-value drift",
                   "Boolean/numeric distinction", "explicit UTC equivalence", "mapping collision",
                   "foreign project rejection", "already-current observed target",
                   "interrupted capture ownership and original-argument continuation"]}, sort_keys=True))


if __name__ == "__main__":
    main()
