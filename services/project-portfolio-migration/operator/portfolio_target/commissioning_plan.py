"""Native existing-plan identities and intended-versus-observed task corrections.

This module has no transport, workspace writer or provider mutation. It composes
the maintained typed source model, native CSDL, original reader identity joins,
and PssUpdateV1 plan/review format. Its inputs are complete retained observations.
"""
from __future__ import annotations

import copy
import datetime as dt
from decimal import Decimal, InvalidOperation

from .capture import PROJECT_COLLECTIONS, _native_guid, native_capture_identity
from .planner import (DEFAULT_TASK_FIELDS, FAMILIES, check_edition, convert,
                      metadata_from_probe, typed, verify_plan)
from .storage import checked_id
from .target import TargetError, digest, guid

MAPPED_FAMILIES = ("tasks", "resources", "assignments", "dependencies")
ENTITIES = {"tasks": "msdyn_projecttask", "resources": "msdyn_projectteam",
            "assignments": "msdyn_resourceassignment",
            "dependencies": "msdyn_projecttaskdependency"}
PROJECT_NAV = {"tasks": "msdyn_project", "resources": "msdyn_project",
               "assignments": "msdyn_projectid", "dependencies": "msdyn_Project"}
RULE_KEYS = {"target", "convert", "values", "timezone", "fold"}
DISPOSITIONS = {"retained_difference", "needs_correction", "manual_followup",
                "observed_resolved"}


def fail(code, message):
    raise TargetError(code, message)


def finding(code, message, *, family=None, keys=None, fields=None, evidence=None):
    value = {"code": code, "message": message, "family": family,
             "keys": list(keys or []), "fields": list(fields or []),
             "severity": "review", "evidence": evidence or {}}
    value["id"] = digest(value)
    return value


def same_value(left, right, rule=None):
    """Keep booleans distinct from numbers; normalize dates only by an UTC rule."""
    if isinstance(left, bool) or isinstance(right, bool):
        return type(left) is type(right) and left == right
    if left is None or right is None:
        return left is right
    if isinstance(left, (int, float, Decimal)) and isinstance(right, (int, float, Decimal)):
        try:
            a, b = Decimal(str(left)), Decimal(str(right))
            return a.is_finite() and b.is_finite() and a == b
        except InvalidOperation:
            return False
    if type(left) is type(right) and left == right:
        return True
    if (rule or {}).get("convert") == "utc" and isinstance(left, str) and isinstance(right, str):
        try:
            a = dt.datetime.fromisoformat(left.replace("Z", "+00:00"))
            b = dt.datetime.fromisoformat(right.replace("Z", "+00:00"))
            return a.tzinfo is not None and b.tzinfo is not None and a == b
        except ValueError:
            return False
    return False


def field_projection(edition, profile, metadata, mappings=None):
    """Convert selected original task fields without constructing creation payloads."""
    model = check_edition(edition)
    selected = copy.deepcopy({} if mappings is None else mappings)
    if not isinstance(selected, dict) or set(selected) - {"task_fields", "date_decisions", "retain_source_note"}:
        fail("COMMISSIONING_MAPPINGS", "Select task_fields, date_decisions and an optional retained-source note.")
    rules = selected.get("task_fields", copy.deepcopy(DEFAULT_TASK_FIELDS))
    if not isinstance(rules, dict) or "NAME" not in rules:
        fail("COMMISSIONING_TASK_FIELDS", "Keep an explicit NAME mapping and each selected field conversion.")
    dates = selected.get("date_decisions", {})
    task_keys = {row["key"] for row in model["tasks"]}
    if not isinstance(dates, dict) or set(dates) - task_keys:
        fail("COMMISSIONING_DATE_ROWS", "Date decisions must name tasks in the selected source edition.")
    for key, decisions in dates.items():
        if not isinstance(decisions, dict) or set(decisions) - set(rules):
            fail("COMMISSIONING_DATE_FIELDS", "Keep date decisions on explicitly mapped source fields.")
    forbidden = {metadata.entity("msdyn_projecttask")["key"].lower(), "statecode",
                 "msdyn_project", "msdyn_projectbucket", "msdyn_parenttask",
                 "msdyn_effort", "msdyn_effortcompleted", "msdyn_effortremaining"}
    projection, findings, mapped = [], [], set()
    for row in model["tasks"]:
        seen = set()
        for field, base in rules.items():
            if not isinstance(field, str) or not isinstance(base, dict) or set(base) - RULE_KEYS:
                fail("COMMISSIONING_FIELD_RULE", "Each source field needs one explicit native field and conversion.")
            rule = copy.deepcopy(base)
            decision = dates.get(row["key"], {}).get(field)
            if decision is not None:
                if not isinstance(decision, dict) or set(decision) - {"timezone", "fold"}:
                    fail("COMMISSIONING_DATE_DECISION", "A date decision may select time zone and fold only.")
                rule.update(decision)
            wanted = rule.get("target")
            if not isinstance(wanted, str) or not wanted:
                fail("COMMISSIONING_FIELD_RULE", "Select the actual native target field.")
            target_field = metadata.field("msdyn_projecttask", wanted)
            if target_field.lower() in forbidden or target_field.startswith("_"):
                fail("COMMISSIONING_MANAGED_FIELD", "Task corrections preserve native identities, hierarchy, buckets and calculated fields.")
            if target_field in seen:
                fail("COMMISSIONING_FIELD_COLLISION", "Two source fields select the same native task property.")
            seen.add(target_field)
            original = typed(row, field)
            if original is None:
                continue
            value = convert(original, rule, profile)
            projection.append({"family": "tasks", "key": row["key"],
                               "source_field": field, "source_value": copy.deepcopy(original),
                               "target_field": target_field, "target_value": value,
                               "conversion": rule})
            mapped.add((row["key"], field))
    # The complete source remains authoritative, including omitted collections and history.
    for family in FAMILIES:
        if family != "tasks" and model[family]:
            findings.append(finding("COMMISSIONING_RETAINED_" + family.upper(),
                "This task-correction route retains the complete original " + family +
                "; it does not create or automatically update that native family.",
                family=family, keys=[row["key"] for row in model[family]]))
    for row in model["tasks"]:
        retained = sorted(field for field in row.get("fields", {})
                          if (row["key"], field) not in mapped)
        if retained:
            findings.append(finding("COMMISSIONING_RETAINED_TASK_FIELDS",
                "These original task fields remain in the source and are outside this selected correction projection.",
                family="tasks", keys=[row["key"]], fields=retained))
    selected["task_fields"] = copy.deepcopy(rules)
    selected["date_decisions"] = copy.deepcopy(dates)
    return projection, findings, selected


def build_inventory(capture, project, project_receipt, teams, metadata, project_id,
                    *, transport_sha256, team_capture_sha256):
    """Keep complete project-scoped native rows and original reader candidates."""
    project_id = guid(project_id)
    project_key = metadata.entity("msdyn_project")["key"]
    if guid(project.get(project_key)) != project_id:
        fail("COMMISSIONING_PROJECT_ID", "The original native read returned another project.")
    model = check_edition(capture)
    families = {}
    for family in MAPPED_FAMILIES:
        entity = ENTITIES[family]
        key = metadata.entity(entity)["key"]
        project_column = metadata.lookup(entity, PROJECT_NAV[family])
        rows = teams if family == "resources" else project.get(PROJECT_COLLECTIONS[family])
        if not isinstance(rows, list):
            fail("COMMISSIONING_COLLECTION", "Retain the complete native " + family + " collection.")
        saved, seen = [], set()
        for row in rows:
            if not isinstance(row, dict):
                fail("COMMISSIONING_NATIVE_ROW", "A captured native row must be an object.")
            identity = guid(row.get(key))
            if identity in seen:
                fail("COMMISSIONING_DUPLICATE_NATIVE_ID", "The captured project repeats a native " + family + " GUID.")
            seen.add(identity)
            if project_column in row:
                if guid(row[project_column]) != project_id:
                    fail("COMMISSIONING_ROW_PROJECT", "A captured native row belongs to another project.")
                membership = {"kind": "native_lookup", "field": project_column, "project_id": project_id}
            elif family != "resources":
                membership = {"kind": "expanded_project_relationship",
                              "field": PROJECT_COLLECTIONS[family], "project_id": project_id}
            else:
                fail("COMMISSIONING_TEAM_PROJECT", "A selected project-team row lacks its actual project lookup.")
            candidates = [item["key"] for item in model.get(family, [])
                          if family != "resources" and _native_guid(item) == identity]
            saved.append({"native_guid": identity, "entity": entity,
                          "native_key": key, "native_sha256": digest(row),
                          "native": copy.deepcopy(row), "membership": membership,
                          "reader_candidates": candidates})
        families[family] = saved
    bucket_column = metadata.lookup("msdyn_projecttask", "msdyn_projectbucket")
    buckets = [{"task_id": row["native_guid"],
                "present": bucket_column in row["native"],
                "bucket_id": row["native"].get(bucket_column),
                "native_sha256": row["native_sha256"]}
               for row in families["tasks"]]
    result = {"schema": "portfolio.imported-plan-inventory.v1", "project_id": project_id,
              "capture_edition_id": capture["id"], "project": copy.deepcopy(project),
              "project_response_sha256": project_receipt["body_sha256"],
              "project_receipt": copy.deepcopy(project_receipt), "families": families,
              "bucket_observations": buckets, "single_bucket_selected": False,
              "read_transport_sha256": transport_sha256,
              "team_capture_sha256": team_capture_sha256,
              "observation_semantics": "complete sequential native reads; no atomic snapshot assertion"}
    result["sha256"] = digest(result)
    return result


def verify_inventory(inventory):
    body = copy.deepcopy(inventory)
    checksum = body.pop("sha256", None)
    if (body.get("schema") != "portfolio.imported-plan-inventory.v1" or
            checksum != digest(body)):
        fail("COMMISSIONING_INVENTORY_HASH", "The complete original target inventory changed.")
    return inventory


class CapturedProject:
    def __init__(self, inventory):
        self.inventory = verify_inventory(inventory)

    def project(self):
        return self.inventory["project"], self.inventory["project_receipt"]


def checked_mapping(edition, capture, inventory, metadata, row_ids):
    """Operator choices stay explicit; names and GUID candidates never auto-bind."""
    model = check_edition(edition)
    inventory = verify_inventory(inventory)
    if capture["id"] != inventory["capture_edition_id"]:
        fail("COMMISSIONING_CAPTURE_EDITION", "The identity choices name another native capture.")
    if not isinstance(row_ids, dict) or set(row_ids) - set(MAPPED_FAMILIES):
        fail("COMMISSIONING_IDENTITY_FAMILIES", "Map tasks, project-team resources, assignments and dependencies explicitly.")
    result, findings = {family: {} for family in FAMILIES}, []
    for family in MAPPED_FAMILIES:
        choices = row_ids.get(family, {})
        source_keys = {row["key"] for row in model[family]}
        native = {row["native_guid"]: row for row in inventory["families"][family]}
        if not isinstance(choices, dict) or set(choices) - source_keys:
            fail("COMMISSIONING_SOURCE_KEY", "A mapping names a row outside the pinned source edition.")
        used = set()
        for key, value in choices.items():
            selected = guid(value)
            if selected not in native:
                fail("COMMISSIONING_TARGET_KEY", "Select an actual native row from this project's complete captured inventory.")
            if selected in used:
                fail("COMMISSIONING_NONINJECTIVE_MAP", "Two source rows cannot silently share one selected native row.")
            used.add(selected)
            result[family][key] = selected
        missing = sorted(source_keys - set(choices))
        if missing:
            findings.append(finding("COMMISSIONING_UNMAPPED_" + family.upper(),
                "These original rows have no reviewed native identity. Their source bytes and history remain retained.",
                family=family, keys=missing))
    plan = {"project_id": inventory["project_id"], "row_ids": result}
    identity_map, native_findings, evidence = native_capture_identity(
        plan, capture, CapturedProject(inventory), metadata)
    for item in native_findings:
        findings.append(finding(item["code"], "The selected provider identity has no unique original-reader counterpart.",
            family=item.get("family"), keys=[item["source_key"]], evidence=item))
    # Record source relationship disagreement separately from a reviewed row identity.
    by_uid = {}
    for family in ("tasks", "resources"):
        values = {}
        for row in model[family]:
            if row.get("uid") is not None:
                values.setdefault(str(row["uid"]), []).append(row["key"])
        by_uid[family] = values
    def source_native(family, uid):
        keys = by_uid[family].get(str(uid), []) if uid is not None else []
        return result[family].get(keys[0]) if len(keys) == 1 else None
    for family in ("assignments", "dependencies"):
        native = {row["native_guid"]: row["native"] for row in inventory["families"][family]}
        for row in model[family]:
            selected_id = result[family].get(row["key"])
            if selected_id is None:
                continue
            observed = native[selected_id]
            if family == "assignments":
                checks = [
                    ("task", source_native("tasks", row.get("task_uid")),
                     observed.get(metadata.lookup("msdyn_resourceassignment", "msdyn_taskid"))),
                    ("project_team", source_native("resources", row.get("resource_uid")),
                     observed.get(metadata.lookup("msdyn_resourceassignment", "msdyn_projectteamid"))),
                ]
            else:
                checks = [
                    ("predecessor", source_native("tasks", row.get("predecessor_uid")),
                     observed.get("_msdyn_predecessortask_value")),
                    ("successor", source_native("tasks", row.get("successor_uid")),
                     observed.get("_msdyn_successortask_value")),
                ]
            for field, intended, actual in checks:
                try:
                    matches = intended is not None and guid(actual) == intended
                except TargetError:
                    matches = False
                if not matches:
                    findings.append(finding("COMMISSIONING_RELATIONSHIP_DIFFERENCE",
                        "The original source relationship and selected native row require an explicit retained or manual resolution.",
                        family=family, keys=[row["key"]], fields=[field],
                        evidence={"intended_native_id": intended, "observed_native_id": actual,
                                  "selected_native_id": selected_id}))
    evidence["source_edition_id"] = edition["id"]
    evidence["inventory_sha256"] = inventory["sha256"]
    evidence["row_ids"] = result
    evidence["sha256"] = digest(evidence)
    return result, identity_map, findings, evidence


def compare_projection(edition, inventory, row_ids, projection):
    """Original source, converted intent and observed native values remain separate."""
    inventory = verify_inventory(inventory)
    tasks = {row["native_guid"]: row for row in inventory["families"]["tasks"]}
    fields, counts = [], {"equal": 0, "different": 0, "unmapped": 0, "unobserved": 0}
    for item in projection:
        record_id = row_ids.get("tasks", {}).get(item["key"])
        row = tasks.get(record_id)
        present = row is not None and item["target_field"] in row["native"]
        observed = row["native"].get(item["target_field"]) if row else None
        status = ("unmapped" if row is None else "unobserved" if not present else
                  "equal" if same_value(observed, item["target_value"], item["conversion"]) else "different")
        value = {**copy.deepcopy(item), "native_guid": record_id, "status": status,
                 "observed_present": present, "observed_value": copy.deepcopy(observed),
                 "observed_native_sha256": row["native_sha256"] if row else None}
        value["id"] = digest(value)
        fields.append(value)
        counts[status] += 1
    body = {"schema": "portfolio.intended-observed-comparison.v1", "source_edition_id": edition["id"],
            "source_edition_sha256": edition["sha256"], "capture_edition_id": inventory["capture_edition_id"],
            "inventory_sha256": inventory["sha256"], "fields": fields, "counts": counts}
    body["sha256"] = digest(body)
    return body


def exception_review(original, decisions, known_evidence):
    if not isinstance(decisions, list):
        fail("COMMISSIONING_EXCEPTION_DECISIONS", "Review each retained original import-exception row.")
    selected = {}
    for decision in decisions:
        if (not isinstance(decision, dict) or set(decision) - {"exception_id", "disposition", "note", "evidence_sha256"} or
                decision.get("disposition") not in DISPOSITIONS or
                not isinstance(decision.get("note"), str) or not decision["note"].strip()):
            fail("COMMISSIONING_EXCEPTION_DECISION", "An exception decision needs its original ID, disposition and note.")
        identity = decision.get("exception_id")
        if identity in selected:
            fail("COMMISSIONING_EXCEPTION_DUPLICATE", "Keep one explicit decision per original exception.")
        refs = decision.get("evidence_sha256", [])
        if not isinstance(refs, list) or any(ref not in known_evidence for ref in refs):
            fail("COMMISSIONING_EXCEPTION_EVIDENCE", "Select original retained import or native-capture evidence.")
        if decision["disposition"] == "observed_resolved" and not refs:
            fail("COMMISSIONING_EXCEPTION_EVIDENCE", "An observed-resolution decision needs selected retained evidence.")
        selected[identity] = copy.deepcopy(decision)
    if set(selected) != {item["id"] for item in original}:
        fail("COMMISSIONING_EXCEPTION_COVERAGE", "Keep exactly one decision for every original exception.")
    return [{"original": copy.deepcopy(item), "decision": selected[item["id"]],
             "decision_kind": "authored_operator_review"} for item in original]


def check_following_source(edition, original):
    model, before = check_edition(edition), check_edition(original)
    for family in MAPPED_FAMILIES:
        if {r["key"] for r in model[family]} != {r["key"] for r in before[family]}:
            fail("COMMISSIONING_CORRECTION_IDENTITIES", "A task correction preserves all original row identities.")
    structural = {"tasks": ("parent_uid",), "assignments": ("task_uid", "resource_uid"),
                  "dependencies": ("predecessor_uid", "successor_uid", "type", "lag")}
    for family, fields in structural.items():
        previous = {r["key"]: r for r in before[family]}
        for row in model[family]:
            if any(row.get(key) != previous[row["key"]].get(key) for key in fields):
                fail("COMMISSIONING_CORRECTION_STRUCTURE",
                     "Keep hierarchy, assignment and dependency changes as separate reviewed work.")
    return model


def observed_correction_plan(edition, original_edition, profile, probe, deployment_id,
                             parent, original_plan, inventory, current_records,
                             *, mappings=None, selected_fields=None):
    """Prepare updates even when original and following source editions are equal."""
    original = verify_plan(original_plan)
    model = check_following_source(edition, original_edition)
    inventory = verify_inventory(inventory)
    checked_id(deployment_id)
    if parent.get("state") not in {"CAPTURED", "ACCEPTED"} or not parent.get("adoption_review_sha256"):
        fail("COMMISSIONING_REVIEW_REQUIRED", "Capture and review the existing plan before preparing a correction.")
    if original["target_identity"]["profile"] != probe["profile"]:
        fail("COMMISSIONING_CORRECTION_TARGET", "Keep the exact reviewed target; use explicit rebind for another principal.")
    if parent.get("commissioning_inventory_sha256") is None:
        fail("COMMISSIONING_CORRECTION_BASIS", "Select the complete retained native inventory.")
    selected = copy.deepcopy(original["mappings"])
    if mappings is not None:
        if not isinstance(mappings, dict) or set(mappings) - {"task_fields", "date_decisions", "retain_source_note"}:
            fail("COMMISSIONING_CORRECTION_MAPPINGS", "Corrections select task fields and explicit date conversions.")
        selected.update(copy.deepcopy(mappings))
    m = metadata_from_probe(probe)
    projection, findings, selected = field_projection(edition, profile, m, selected)
    identities = {(item["key"], item["target_field"]) for item in projection}
    if selected_fields is None:
        chosen = identities
    else:
        if not isinstance(selected_fields, list):
            fail("COMMISSIONING_CORRECTION_FIELDS", "Select source_key and target_field pairs.")
        chosen = set()
        for item in selected_fields:
            if not isinstance(item, dict) or set(item) != {"source_key", "target_field"}:
                fail("COMMISSIONING_CORRECTION_FIELDS", "Each correction choice names one original task and native field.")
            key = (item["source_key"], item["target_field"])
            if key not in identities or key in chosen:
                fail("COMMISSIONING_CORRECTION_FIELDS", "A selected native field is absent or repeated.")
            chosen.add(key)
    basis = compare_projection(edition, inventory, original["row_ids"], projection)
    basis_fields = {(item["key"], item["target_field"]): item for item in basis["fields"]}
    entity = m.entity("msdyn_projecttask")
    project_column = m.lookup("msdyn_projecttask", "msdyn_project")
    operations, before_rows, already_current, retained, per_task = [], [], [], [], {}
    for item in projection:
        key = (item["key"], item["target_field"])
        if key in chosen:
            per_task.setdefault(item["key"], []).append(item)
    for source_key, items in sorted(per_task.items()):
        record_id = original["row_ids"].get("tasks", {}).get(source_key)
        if record_id is None:
            retained.append({"source_key": source_key, "reason": "unmapped_source_task"})
            continue
        record_id = guid(record_id)
        current = current_records.get(record_id)
        if (not isinstance(current, dict) or guid(current.get(entity["key"])) != record_id or
                guid(current.get(project_column)) != original["project_id"]):
            fail("COMMISSIONING_CORRECTION_NATIVE_ROW", "The selected current task is absent or outside the original project.")
        current_sha = digest(current)
        before_rows.append({"entity": "msdyn_projecttask", "record_id": record_id,
                            "source_key": source_key, "sha256": current_sha,
                            "native": copy.deepcopy(current)})
        before, values, conversions, comparisons = {}, {}, {}, []
        for item in items:
            field = item["target_field"]
            comparisons.append({**copy.deepcopy(basis_fields[(source_key, field)]),
                                "prepare_observed_present": field in current,
                                "prepare_observed_value": copy.deepcopy(current.get(field)),
                                "prepare_native_sha256": current_sha})
            if field not in current:
                retained.append({"source_key": source_key, "field": field,
                                 "reason": "native_property_not_observed", "native_sha256": current_sha})
                continue
            if same_value(current[field], item["target_value"], item["conversion"]):
                already_current.append({"source_key": source_key, "record_id": record_id,
                                        "field": field, "value": copy.deepcopy(current[field]),
                                        "native_sha256": current_sha})
            else:
                before[field], values[field] = copy.deepcopy(current[field]), copy.deepcopy(item["target_value"])
                conversions[field] = copy.deepcopy(item["conversion"])
        if not values:
            continue
        payload = {"@odata.type": entity["type"], entity["key"]: record_id, **values}
        m.validate_entity(payload)
        operation = {"action": "msdyn_PssUpdateV1", "entity": "msdyn_projecttask",
                     "record_id": record_id, "source_family": "tasks", "source_key": source_key,
                     "payload": payload, "intended_observed": comparisons,
                     "precondition": {"entity": "msdyn_projecttask", "record_id": record_id,
                         "project_id": original["project_id"], "before": before,
                         "observed_sha256": current_sha, "etag": current.get("@odata.etag"),
                         "comparison": "commissioned_typed", "conversions": conversions}}
        operation["id"] = digest(operation)
        operations.append(operation)
    if retained:
        findings.append(finding("COMMISSIONING_UNAUTOMATED_DIFFERENCES",
            "Unmapped tasks and absent native properties remain retained review items; no native value was invented.",
            family="tasks", evidence={"items": retained}))
    for code, text in (
        ("COMMISSIONING_EXISTING_TASK_CORRECTION",
         "Only listed fields on the selected existing tasks will be updated. No project, bucket, resource or task is created."),
        ("COMMISSIONING_OBSERVED_VALUE_BASIS",
         "Fields are selected by intended versus observed native values, including unchanged source intent. Complete source and original capture remain separate."),
        ("COMMISSIONING_BEFORE_VALUE_REVIEW",
         "Native before values are checked before queueing and execution. The scheduling action has no atomic conditional ETag parameter."),
        ("NATIVE_TRANSACTION_BOUNDARIES",
         "Each listed OperationSet is a separate transaction; earlier completed sets remain if a later set fails."),
    ):
        findings.append(finding(code, text, family="tasks"))
    size = profile.get("operation_set_size", 200)
    if isinstance(size, bool) or not isinstance(size, int) or not 1 <= size <= 200:
        fail("COMMISSIONING_SET_SIZE", "Select a native OperationSet size from 1 through 200.")
    batches = []
    for start in range(0, len(operations), size):
        chosen_ops = operations[start:start + size]
        number = len(batches) + 1
        batches.append({"number": number, "description": "portfolio:" + deployment_id + ":" + str(number),
                        "operations": chosen_ops, "sha256": digest(chosen_ops)})
    result = copy.deepcopy(original)
    result.update({"deployment_id": deployment_id, "source_edition_id": edition["id"],
        "source_edition_sha256": edition["sha256"], "source_ids": edition.get("source_ids", []),
        "probe_sha256": probe["sha256"], "mode": "task_correction", "origin": "external_import",
        "parent_deployment_id": parent["id"], "parent_revision": parent["revision"],
        "parent_plan_sha256": parent["plan_sha256"],
        "parent_comparison_sha256": parent["comparison_sha256"],
        "parent_inventory_sha256": parent["commissioning_inventory_sha256"],
        "adoption_review_sha256": parent["adoption_review_sha256"],
        "existing_project": True, "bucket_id": None, "immediate": [], "team_selections": [],
        "projection": projection, "mappings": selected, "batches": batches, "findings": findings,
        "correction_basis": basis, "native_before": before_rows, "already_current": already_current,
        "retained_corrections": retained,
        "selected_fields": [{"source_key": a, "target_field": b} for a, b in sorted(chosen)],
        "counts": {"source": {family: len(model[family]) for family in FAMILIES},
                   "immediate_actions": 0, "queued_operations": len(operations),
                   "operation_sets": len(batches), "already_current_fields": len(already_current)}})
    result.pop("sha256", None)
    result["sha256"] = digest(result)
    return verify_plan(result)


def verify_observed_before(operation, target):
    """Exact typed precondition for this additive plan; the original plans keep theirs."""
    condition = operation["precondition"]
    row = target.record(condition["entity"], condition["record_id"])
    m = target.metadata
    if (not isinstance(row, dict) or
            guid(row.get(m.entity(condition["entity"])["key"])) != condition["record_id"] or
            guid(row.get(m.lookup(condition["entity"], "msdyn_project"))) != condition["project_id"]):
        fail("TARGET_PRECONDITION", "The original commissioned task is absent or moved to another project.")
    changed = [field for field, value in condition["before"].items()
               if field not in row or not same_value(row[field], value, condition["conversions"].get(field))]
    if changed:
        fail("TARGET_PRECONDITION", "Native values changed after review: " + ", ".join(changed) +
             ". Keep the original set unexecuted and prepare a newly reviewed correction.")
    return {"entity": condition["entity"], "record_id": condition["record_id"],
            "current": row, "sha256": digest(row), "comparison": "commissioned_typed"}
