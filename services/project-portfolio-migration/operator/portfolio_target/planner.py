"""Compile an immutable native target plan from the original MPXJ edition.

Original typed fields and every unmapped value remain in the source edition.
Only documented scheduling actions are emitted; target entity/field names come
from the selected environment's retained native CSDL.
"""
from __future__ import annotations

import datetime as dt
from decimal import Decimal, InvalidOperation
import math
import re
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError
import uuid

from .target import Metadata, TargetError, canonical, digest, guid, public_profile

FAMILIES = ("tasks", "resources", "assignments", "dependencies", "calendars")
DEFAULT_TASK_FIELDS = {
    "NAME": {"target": "msdyn_subject", "convert": "text"},
    "START": {"target": "msdyn_scheduledstart", "convert": "utc"},
    "FINISH": {"target": "msdyn_scheduledend", "convert": "utc"},
}
UNSUPPORTED_PROJECT_WRITES = {x.lower() for x in (
    "statecode", "msdyn_bulkgenerationstatus", "msdyn_globalrevisiontoken",
    "msdyn_calendarid", "msdyn_effort", "msdyn_effortcompleted",
    "msdyn_effortremaining", "msdyn_progress", "msdyn_finish",
    "msdyn_taskearlieststart", "msdyn_duration",
)}
IDENTITY_FIELDS = {
    "UNIQUE_ID", "GUID", "ID", "PARENT_TASK_UNIQUE_ID", "TASK_UNIQUE_ID",
    "RESOURCE_UNIQUE_ID", "OUTLINE_LEVEL", "OUTLINE_NUMBER",
}


def typed(row, field, default=None):
    value = row.get("fields", {}).get(field)
    return value if value is not None else default


def scalar(value, default=None):
    if value is None:
        return default
    if not isinstance(value, dict) or "type" not in value or "value" not in value:
        raise TargetError("SOURCE_TYPED_VALUE", "Use the original typed MPXJ field value.")
    return value["value"]


def text_value(row, field="NAME", default=""):
    value = scalar(typed(row, field), default)
    if value is None:
        return default
    return str(value)


def field_error(family, row, field, message):
    raise TargetError("TARGET_FIELD_CONVERSION", family + "/" + row["key"] + "/" + field + ": " + message)


def metadata_from_probe(probe):
    check = dict(probe)
    expected = check.pop("sha256", None)
    if expected != digest(check) or probe.get("schema") != "portfolio.target-probe.v1":
        raise TargetError("TARGET_PROBE_DIGEST", "The original native target probe changed.")
    selected = probe["metadata"]
    if selected.get("schema") != "portfolio.native-target-metadata.v1":
        raise TargetError("TARGET_METADATA", "Use the selected original native CSDL projection.")
    value = Metadata.__new__(Metadata)
    value.sha256 = selected["sha256"]
    value.entities, value.actions = selected["entities"], selected["actions"]
    return value


def local_to_utc(value, timezone, fold=None):
    if not isinstance(value, str):
        raise TargetError("SOURCE_DATE", "The original date must be a string.")
    try:
        parsed = dt.datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise TargetError("SOURCE_DATE", "The original local date is invalid.") from exc
    if parsed.tzinfo is not None:
        return parsed.astimezone(dt.timezone.utc).isoformat().replace("+00:00", "Z")
    if not timezone:
        raise TargetError("SOURCE_TIMEZONE", "Choose the source project time zone for local dates.")
    try:
        zone = ZoneInfo(timezone)
    except ZoneInfoNotFoundError as exc:
        raise TargetError("SOURCE_TIMEZONE", "The selected IANA time zone is unavailable.") from exc
    candidates = []
    for candidate_fold in (0, 1):
        candidate = parsed.replace(tzinfo=zone, fold=candidate_fold)
        if candidate.astimezone(dt.timezone.utc).astimezone(zone).replace(tzinfo=None) == parsed:
            if not any(old.utcoffset() == candidate.utcoffset() for old in candidates):
                candidates.append(candidate)
    if not candidates:
        raise TargetError("SOURCE_NONEXISTENT_TIME", "The local date falls in a daylight-saving gap.")
    if len(candidates) > 1:
        if fold not in (0, 1):
            raise TargetError("SOURCE_AMBIGUOUS_TIME", "Choose fold 0 or 1 for this repeated local time.")
        chosen = next(x for x in candidates if x.fold == fold)
    else:
        chosen = candidates[0]
    return chosen.astimezone(dt.timezone.utc).isoformat().replace("+00:00", "Z")


def convert(value, rule, profile):
    if value is None or scalar(value) is None:
        return None
    kind, raw = value["type"], value["value"]
    conversion = rule.get("convert", "text")
    if conversion == "text":
        if kind not in ("string", "enum", "integer", "number", "boolean"):
            raise TargetError("TARGET_CONVERSION", "Choose an explicit conversion for " + kind + ".")
        return str(raw)
    if conversion == "boolean":
        if kind != "boolean" or not isinstance(raw, bool):
            raise TargetError("TARGET_CONVERSION", "Expected an original boolean.")
        return raw
    if conversion == "utc":
        if kind not in ("local_datetime", "local_date", "string"):
            raise TargetError("TARGET_CONVERSION", "Expected an original local date/time.")
        return local_to_utc(raw, rule.get("timezone", profile.get("source_timezone")), rule.get("fold"))
    if conversion in ("integer", "number", "percent_fraction"):
        try:
            number = Decimal(str(raw))
        except InvalidOperation as exc:
            raise TargetError("TARGET_CONVERSION", "Expected a finite original number.") from exc
        if not number.is_finite():
            raise TargetError("TARGET_CONVERSION", "Expected a finite original number.")
        if conversion == "integer":
            if number != number.to_integral_value():
                raise TargetError("TARGET_CONVERSION", "A fractional value cannot become a native integer.")
            return int(number)
        if conversion == "percent_fraction":
            if not Decimal(0) <= number <= Decimal(100):
                raise TargetError("TARGET_CONVERSION", "A percentage must be between 0 and 100.")
            number /= Decimal(100)
        converted = float(number)
        if not math.isfinite(converted) or Decimal(str(converted)) != number:
            raise TargetError("TARGET_NUMBER_PRECISION",
                              "This number cannot be represented exactly by the selected JSON numeric conversion.")
        return converted
    if conversion == "choice":
        key = str(raw)
        choices = rule.get("values", {})
        if key not in choices or not isinstance(choices[key], int) or isinstance(choices[key], bool):
            raise TargetError("TARGET_CHOICE", "Choose the native option value for " + key + ".")
        return choices[key]
    raise TargetError("TARGET_CONVERSION", "Unknown explicit conversion " + str(conversion))


def check_edition(edition):
    if not isinstance(edition, dict) or not re.fullmatch(r"[0-9a-f]{64}", str(edition.get("id", ""))):
        raise TargetError("SOURCE_EDITION", "Choose a complete immutable PortfolioWorkspace edition.")
    model = edition.get("model", {})
    if model.get("schema") != "project-portfolio-model.v1":
        raise TargetError("SOURCE_MODEL", "Expected the original project-portfolio-model.v1.")
    for family in FAMILIES:
        rows = model.get(family)
        if not isinstance(rows, list):
            raise TargetError("SOURCE_FAMILY", "The original " + family + " family must be an array.")
        keys = [row.get("key") for row in rows]
        if any(not isinstance(key, str) or not key for key in keys) or len(set(keys)) != len(keys):
            raise TargetError("SOURCE_KEYS", "Original row keys must be present and unique.")
    return model


def native_id(deployment_id, family, key):
    return str(uuid.uuid5(uuid.NAMESPACE_URL, "portfolio-target:" + deployment_id + ":" + family + ":" + key))


def target_identity(profile, probe):
    return {"profile": public_profile(profile), "user_id": guid(probe["identity"]["UserId"]),
            "organization_id": guid(probe["identity"]["OrganizationId"]),
            "metadata_sha256": probe["metadata"]["sha256"]}


def prepare_schedule(edition, profile, probe, deployment_id, mappings=None):
    model = check_edition(edition)
    if not re.fullmatch(r"[0-9a-f]{64}", deployment_id):
        raise TargetError("DEPLOYMENT_ID", "Use the retained full deployment ID.")
    m = metadata_from_probe(probe)
    if probe["profile"] != public_profile(profile):
        raise TargetError("TARGET_PROFILE_CHANGED", "Probe and selected target profile differ.")
    mappings = mappings or {}
    if not isinstance(mappings, dict):
        raise TargetError("TARGET_MAPPINGS", "Mappings must be an object.")
    expected_mapping_keys = {
        "project_name", "project_id", "existing_project", "task_fields",
        "resource_names", "resource_team_members", "dependency_types",
        "date_decisions", "retain_source_note", "assignment_names",
    }
    if set(mappings) - expected_mapping_keys:
        raise TargetError("TARGET_MAPPINGS", "Unknown target mapping option: " + ", ".join(sorted(set(mappings) - expected_mapping_keys)))
    project = model.get("project", {})
    project_name = mappings.get("project_name") or text_value(project) or "Retained project"
    if not isinstance(project_name, str) or not project_name.strip():
        raise TargetError("TARGET_PROJECT_NAME", "A target project name is required.")
    existing_project = mappings.get("existing_project", False)
    if not isinstance(existing_project, bool):
        raise TargetError("TARGET_PROJECT_MODE", "Select create or append to an existing project.")
    if existing_project and not mappings.get("project_id"):
        raise TargetError("TARGET_PROJECT_SELECTION", "Select the exact existing native project ID.")
    project_id = guid(mappings["project_id"]) if mappings.get("project_id") else native_id(deployment_id, "project", "project")
    bucket_id = native_id(deployment_id, "bucket", "migration")
    row_ids = {family: {row["key"]: native_id(deployment_id, family, row["key"])
                        for row in model[family]} for family in FAMILIES}
    findings, projection, operations, immediate, used = [], [], [], [], set()

    def finding(code, message, *, family=None, keys=None, fields=None, severity="review"):
        body = {"code": code, "message": message, "family": family,
                "keys": keys or [], "fields": fields or [], "severity": severity}
        body["id"] = digest(body)
        findings.append(body)

    def entity(name, record_id, fields=None, links=None):
        schema = m.entity(name)
        payload = {"@odata.type": schema["type"], schema["key"]: guid(record_id)}
        for key, value in (fields or {}).items():
            payload[m.field(name, key)] = value
        for key, (other, other_id) in (links or {}).items():
            payload[m.field(name, key, navigation=True) + "@odata.bind"] = m.binding(other, other_id)
        m.validate_entity(payload)
        return payload

    def operation(action, payload, family, key):
        entity_name = payload["@odata.type"].removeprefix("Microsoft.Dynamics.CRM.")
        record_id = payload[m.entity(entity_name)["key"]]
        item = {"action": action, "entity": entity_name, "record_id": record_id,
                "source_family": family, "source_key": key, "payload": payload}
        item["id"] = digest(item)
        return item

    project_payload = entity("msdyn_project", project_id, {"msdyn_subject": project_name})
    if not existing_project:
        immediate.append({"id": digest({"create_project": project_payload}),
                          "action": "msdyn_CreateProjectV1", "parameters": {"Project": project_payload},
                          "entity": "msdyn_project", "record_id": project_id, "source_key": project.get("key", "project")})
    else:
        finding("EXISTING_PROJECT_APPEND",
                "This migration appends newly identified rows to the selected existing project; its current content remains.",
                keys=[project_id])
    used.add(("project", project.get("key", "project"), "NAME"))
    operations.append(operation("msdyn_PssCreateV1", entity("msdyn_projectbucket", bucket_id,
        {"msdyn_name": "Migration " + deployment_id[:12]},
        {"msdyn_project": ("msdyn_project", project_id)}), "project", "migration-bucket"))

    lookup = {}
    for family in FAMILIES:
        index = {}
        for row in model[family]:
            if row.get("uid") is not None:
                index.setdefault(str(row["uid"]), []).append(row)
        lookup[family] = index

    def resolve(family, source_uid, row, field):
        candidates = lookup[family].get(str(source_uid), []) if source_uid is not None else []
        if len(candidates) != 1:
            field_error(family, row, field, "The source UID does not identify exactly one retained row.")
        return candidates[0]

    team_map = mappings.get("resource_team_members", {})
    resource_names = mappings.get("resource_names", {})
    if not isinstance(team_map, dict) or not isinstance(resource_names, dict):
        raise TargetError("TARGET_RESOURCES", "Resource selections must be keyed by the original source row key.")
    if set(team_map) - set(row_ids["resources"]) or set(resource_names) - set(row_ids["resources"]):
        raise TargetError("TARGET_RESOURCES", "A resource mapping names an absent source row.")
    team_selections = []
    for row in model["resources"]:
        key = row["key"]
        if key in team_map:
            team_id = guid(team_map[key])
            row_ids["resources"][key] = team_id
            team_selections.append({"source_key": key, "team_member_id": team_id, "existing": True})
        else:
            team_id = row_ids["resources"][key]
            name = resource_names.get(key) or text_value(row) or key
            payload = entity("msdyn_projectteam", team_id, {"msdyn_name": name},
                             {"msdyn_project": ("msdyn_project", project_id)})
            immediate.append({"id": digest({"create_team_member": payload}),
                              "action": "msdyn_CreateTeamMemberV1", "parameters": {"TeamMember": payload},
                              "entity": "msdyn_projectteam", "record_id": team_id, "source_key": key})
            team_selections.append({"source_key": key, "team_member_id": team_id, "existing": False})
        used.add(("resources", key, "NAME"))
    if model["resources"]:
        finding("RESOURCE_TEAM_MAPPING",
                "Source resources map to the selected native project team members; rates, calendars and cost history remain in the original source.",
                family="resources", keys=[r["key"] for r in model["resources"]])

    rules = mappings.get("task_fields", DEFAULT_TASK_FIELDS)
    if not isinstance(rules, dict) or "NAME" not in rules:
        raise TargetError("TARGET_TASK_RULES", "Task field mappings must include NAME.")
    date_decisions = mappings.get("date_decisions", {})
    parents, tasks = {}, {row["key"]: row for row in model["tasks"]}
    for row in model["tasks"]:
        parent_uid = row.get("parent_uid")
        parents[row["key"]] = resolve("tasks", parent_uid, row, "parent_uid")["key"] if parent_uid is not None else None
        if parents[row["key"]] == row["key"]:
            field_error("tasks", row, "parent_uid", "A task cannot be its own parent.")
    ordered, visiting, visited = [], set(), set()
    def visit(key):
        if key in visiting:
            raise TargetError("SOURCE_TASK_CYCLE", "The retained task hierarchy contains a cycle.")
        if key in visited:
            return
        visiting.add(key)
        if parents[key] is not None:
            visit(parents[key])
        visiting.remove(key)
        visited.add(key)
        ordered.append(tasks[key])
    for key in tasks:
        visit(key)

    for row in ordered:
        key, values = row["key"], {}
        for field, base_rule in rules.items():
            if not isinstance(base_rule, dict) or set(base_rule) - {"target", "convert", "values", "timezone", "fold"}:
                raise TargetError("TARGET_FIELD_RULE", "Each field needs one explicit target and conversion.")
            rule = dict(base_rule)
            per_row = date_decisions.get(key, {}).get(field)
            if per_row is not None:
                if not isinstance(per_row, dict) or set(per_row) - {"timezone", "fold"}:
                    raise TargetError("TARGET_DATE_DECISION", "Date decisions may select time zone and fold only.")
                rule.update(per_row)
            target_field = m.field("msdyn_projecttask", rule.get("target", ""))
            if target_field.lower() in {
                m.entity("msdyn_projecttask")["key"].lower(), "statecode",
                "msdyn_project", "msdyn_projectbucket", "msdyn_parenttask",
                "msdyn_effort", "msdyn_effortcompleted", "msdyn_effortremaining",
            } or target_field.startswith("_"):
                raise TargetError("TARGET_MANAGED_FIELD", "This native identity or calculated field is managed by the migration.")
            original = typed(row, field)
            if original is None:
                continue
            try:
                converted = convert(original, rule, profile)
            except TargetError as exc:
                field_error("tasks", row, field, str(exc))
            if target_field in values:
                raise TargetError("TARGET_FIELD_COLLISION", "Two source fields map to " + target_field + ".")
            values[target_field] = converted
            used.add(("tasks", key, field))
            projection.append({"family": "tasks", "key": key, "source_field": field,
                               "source_value": original, "target_field": target_field, "target_value": converted,
                               "conversion": rule})
        subject = m.field("msdyn_projecttask", "msdyn_subject")
        if not values.get(subject):
            values[subject] = key
        links = {"msdyn_project": ("msdyn_project", project_id),
                 "msdyn_projectbucket": ("msdyn_projectbucket", bucket_id)}
        if parents[key]:
            links["msdyn_parenttask"] = ("msdyn_projecttask", row_ids["tasks"][parents[key]])
        payload = entity("msdyn_projecttask", row_ids["tasks"][key], values, links)
        operations.append(operation("msdyn_PssCreateV1", payload, "tasks", key))

    assignment_names = mappings.get("assignment_names", {})
    if not isinstance(assignment_names, dict) or set(assignment_names) - set(row_ids["assignments"]):
        raise TargetError("TARGET_ASSIGNMENT_NAMES", "Assignment names must use existing source row keys.")
    for row in model["assignments"]:
        task = resolve("tasks", row.get("task_uid"), row, "task_uid")
        resource = resolve("resources", row.get("resource_uid"), row, "resource_uid")
        payload = entity("msdyn_resourceassignment", row_ids["assignments"][row["key"]],
            {"msdyn_name": assignment_names.get(row["key"]) or text_value(row) or row["key"]},
            {"msdyn_projectid": ("msdyn_project", project_id),
             "msdyn_taskid": ("msdyn_projecttask", row_ids["tasks"][task["key"]]),
             "msdyn_projectteamid": ("msdyn_projectteam", row_ids["resources"][resource["key"]])})
        operations.append(operation("msdyn_PssCreateV1", payload, "assignments", row["key"]))
        used.add(("assignments", row["key"], "NAME"))
    if model["assignments"]:
        finding("ASSIGNMENT_CONTOURS_RETAINED",
                "The native assignment links are created; original work contours, actual work and cost history remain in the source edition for reviewed later scheduling.",
                family="assignments", keys=[r["key"] for r in model["assignments"]])

    dependency_types = mappings.get("dependency_types", {})
    if not isinstance(dependency_types, dict):
        raise TargetError("TARGET_DEPENDENCY_TYPES", "Use an explicit native link-type mapping.")
    for row in model["dependencies"]:
        predecessor = resolve("tasks", row.get("predecessor_uid"), row, "predecessor_uid")
        successor = resolve("tasks", row.get("successor_uid"), row, "successor_uid")
        relation = row.get("type")
        if isinstance(relation, dict):
            relation = scalar(relation)
        relation = str(relation)
        target_type = dependency_types.get(relation)
        if not isinstance(target_type, int) or isinstance(target_type, bool):
            field_error("dependencies", row, "type", "Select the native link-type option for " + relation + ".")
        if target_type not in {item["Value"] for item in probe["link_type_choices"]}:
            field_error("dependencies", row, "type", "The selected option is absent from the native target metadata.")
        payload = entity("msdyn_projecttaskdependency", row_ids["dependencies"][row["key"]],
            {"msdyn_linktype": target_type},
            {"msdyn_project": ("msdyn_project", project_id),
             "msdyn_predecessortask": ("msdyn_projecttask", row_ids["tasks"][predecessor["key"]]),
             "msdyn_successortask": ("msdyn_projecttask", row_ids["tasks"][successor["key"]])})
        operations.append(operation("msdyn_PssCreateV1", payload, "dependencies", row["key"]))
        lag = row.get("lag")
        raw_lag = scalar(lag) if isinstance(lag, dict) else lag
        if raw_lag not in (None, 0, "0", "0.0"):
            finding("DEPENDENCY_LAG_RETAINED",
                    "This native link is created without importing the original nonzero lag; the exact lag remains in the source.",
                    family="dependencies", keys=[row["key"]], fields=["lag"])
    if model["calendars"]:
        finding("CALENDARS_RETAINED",
                "Original calendars, exceptions and working-time rules remain in the native source export; this target plan uses the selected environment's calendar.",
                family="calendars", keys=[r["key"] for r in model["calendars"]])
    omissions = {}
    source_rows = [("project", project)] + [(family, row) for family in FAMILIES for row in model[family]]
    for family, row in source_rows:
        for field, value in row.get("fields", {}).items():
            if (family, row["key"], field) in used or field in IDENTITY_FIELDS or scalar(value) is None:
                continue
            omissions.setdefault(family, {}).setdefault(field, []).append(row["key"])
    for family, fields in omissions.items():
        finding("SOURCE_FIELDS_RETAINED",
                "These original field values are preserved in the source edition and excluded from this native target write.",
                family=family, fields=[{"field": field, "keys": keys, "count": len(keys)}
                                       for field, keys in sorted(fields.items())])
    set_size = profile.get("operation_set_size", 200)
    batches = []
    for index in range(0, len(operations), set_size):
        selected = operations[index:index + set_size]
        number = len(batches) + 1
        batches.append({"number": number, "description": "portfolio:" + deployment_id + ":" + str(number),
                        "operations": selected, "sha256": digest(selected)})
    finding("NATIVE_TRANSACTION_BOUNDARIES",
            "Project/team creation is immediate. Each listed OperationSet is a separate native transaction; completed sets survive a later set's failure.",
            keys=[str(batch["number"]) for batch in batches])
    result = {
        "schema": "portfolio.target-plan.v1", "deployment_id": deployment_id,
        "source_edition_id": edition["id"], "source_edition_sha256": edition["sha256"],
        "source_ids": edition.get("source_ids", []), "target_identity": target_identity(profile, probe),
        "probe_sha256": probe["sha256"], "project_id": project_id, "project_name": project_name,
        "existing_project": existing_project, "bucket_id": bucket_id, "row_ids": row_ids,
        "team_selections": team_selections, "mappings": mappings, "projection": projection,
        "immediate": immediate, "batches": batches, "findings": findings,
        "counts": {"source": {family: len(model[family]) for family in FAMILIES},
                   "immediate_actions": len(immediate), "queued_operations": len(operations),
                   "operation_sets": len(batches)},
    }
    result["sha256"] = digest(result)
    return result


def verify_plan(plan):
    if not isinstance(plan, dict) or plan.get("schema") != "portfolio.target-plan.v1":
        raise TargetError("TARGET_PLAN", "Use an original immutable target plan.")
    content = dict(plan)
    expected = content.pop("sha256", None)
    if expected != digest(content):
        raise TargetError("TARGET_PLAN_CHANGED", "The reviewed native target plan changed.")
    seen_batches = set()
    for batch in plan.get("batches", []):
        if batch["number"] in seen_batches or batch["sha256"] != digest(batch["operations"]):
            raise TargetError("TARGET_BATCH_ID", "The original native batch identity changed.")
        seen_batches.add(batch["number"])
        identities = [(item["entity"], guid(item["record_id"])) for item in batch["operations"]]
        if len(identities) != len(set(identities)):
            raise TargetError("TARGET_ROW_CALL_UNIQUENESS",
                              "One native set must contain only one selected row call for an entity and record.")
        if len(batch["operations"]) > 200:
            raise TargetError("OPERATION_SET_LIMIT", "A native OperationSet holds at most 200 operations.")
    return plan


def review_schedule(plan, *, reviewer, note, accepted_findings):
    verify_plan(plan)
    required = {item["id"] for item in plan["findings"] if item["severity"] == "review"}
    accepted = set(accepted_findings)
    if accepted != required or any(x["severity"] == "error" for x in plan["findings"]):
        raise TargetError("TARGET_REVIEW", "Review every listed retained-source decision for this exact plan.")
    if not isinstance(reviewer, str) or not reviewer.strip() or not isinstance(note, str) or not note.strip():
        raise TargetError("TARGET_REVIEWER", "Record the operator and the target acceptance note.")
    result = {"schema": "portfolio.target-review.v1", "plan_sha256": plan["sha256"],
              "source_edition_id": plan["source_edition_id"], "deployment_id": plan["deployment_id"],
              "reviewer": reviewer.strip(), "note": note.strip(),
              "accepted_findings": sorted(accepted)}
    result["sha256"] = digest(result)
    return result
