"""Field dispatch, recorded effort and supervisor follow-through.

All assignments reference the original captured domain. This component changes
only workspace['dispatch']; inspection creation, validation and approval remain
owned by highway.domain. The outer store owns request replay and revision CAS.
"""
from __future__ import annotations

import copy
import datetime as dt
import hashlib
import html
import json
import re
import uuid

SCHEMA = "geocove.dispatch.v1"
REPORT_SCHEMA = "geocove.dispatch-report.v1"
STATUSES = ("PLANNED", "READY", "IN_FIELD", "SUBMITTED", "BLOCKED", "CLOSED", "CANCELLED")
FOLLOWUP_STATUSES = ("OPEN", "IN_PROGRESS", "RESOLVED", "CANCELLED")
TRANSITIONS = {
    "PLANNED": {"READY", "BLOCKED", "CANCELLED"},
    "READY": {"PLANNED", "IN_FIELD", "BLOCKED", "CANCELLED"},
    "IN_FIELD": {"READY", "SUBMITTED", "BLOCKED", "CANCELLED"},
    "SUBMITTED": {"IN_FIELD", "BLOCKED", "CLOSED", "CANCELLED"},
    "BLOCKED": {"PLANNED", "READY", "IN_FIELD", "SUBMITTED", "CANCELLED"},
    "CLOSED": {"IN_FIELD"},
    "CANCELLED": {"PLANNED"},
}
LIMITS = {"crews": 1000, "packages": 1000, "assignments": 10000,
          "effortEntries": 50000, "followups": 20000, "reports": 200}
MAX_STATE_BYTES = 32 * 1024 * 1024
MAX_REPORT_BYTES = 16 * 1024 * 1024


def _require(condition, message):
    if not condition:
        raise ValueError(message)


def _canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True,
                      separators=(",", ":"), allow_nan=False).encode("utf-8")


def _sha(value):
    return hashlib.sha256(_canonical(value)).hexdigest()


def _text(value, label, maximum=1000, empty=False):
    _require(isinstance(value, str) and len(value) <= maximum
             and "\x00" not in value and (empty or bool(value.strip())),
             label + " must be bounded text.")
    return value.strip()


def _id(value, label="id"):
    _require(isinstance(value, str), label + " must be a canonical UUID.")
    try:
        parsed = str(uuid.UUID(value))
    except (ValueError, AttributeError):
        raise ValueError(label + " must be a canonical UUID.") from None
    _require(parsed == value, label + " must be a canonical UUID.")
    return value


def _reference(value, label):
    _require(isinstance(value, str) and len(value) <= 180
             and re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.:@-]*", value),
             label + " must be an original stable identifier.")
    return value


def _int(value, label, maximum=100000000, minimum=0):
    _require(type(value) is int and minimum <= value <= maximum,
             label + " must be an integer in the permitted range.")
    return value


def _time(value, label, optional=False):
    if optional and value in (None, ""):
        return None
    _require(isinstance(value, str) and len(value) <= 40, label + " must be an ISO timestamp.")
    try:
        parsed = dt.datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        raise ValueError(label + " must be an ISO timestamp.") from None
    _require(parsed.tzinfo is not None and "T" in value,
             label + " must include the date, time and timezone.")
    return parsed.astimezone(dt.timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _fields(body, allowed):
    _require(isinstance(body, dict), "Command body must be an object.")
    unknown = set(body) - set(allowed)
    _require(not unknown, "Unknown command fields: " + ", ".join(sorted(unknown)))


def new_dispatch():
    return {"schema": SCHEMA, **{name: {} for name in LIMITS}}


def _state(workspace):
    value = workspace.get("dispatch")
    if value is None:
        return new_dispatch()
    _require(isinstance(value, dict) and value.get("schema") == SCHEMA,
             "Unsupported dispatch state.")
    for name in LIMITS:
        _require(isinstance(value.get(name), dict), "Dispatch collection is missing: " + name)
    return value


def _context(workspace, read_blob):
    from .domain import dispatch_context
    value = dispatch_context(workspace, read_blob)
    _require(isinstance(value, dict), "Original domain context is unavailable.")
    result = {}
    for key in ("captures", "forms", "inspections"):
        rows = value.get(key)
        _require(isinstance(rows, list), "Original domain context is incomplete: " + key)
        indexed = {}
        for row in rows:
            _require(isinstance(row, dict) and isinstance(row.get("id"), str)
                     and row["id"] not in indexed, "Original domain identities are invalid.")
            indexed[row["id"]] = row
        result[key] = indexed
    result["objects"] = {}
    result["objectRefs"] = {}
    for capture in result["captures"].values():
        for dataset in capture.get("datasets", []):
            key = (capture["id"], dataset["layerId"])
            _require(key not in result["objects"], "Original dataset identity is ambiguous.")
            values = dataset.get("objectIds")
            _require(isinstance(values, list), "Original object inventory is unavailable.")
            result["objects"][key] = set(values)
            refs = dataset.get("objectRefs")
            _require(isinstance(refs, list), "Original feature identity projection is unavailable.")
            indexed = {row["objectId"]: row.get("globalId") for row in refs}
            _require(len(indexed) == len(refs) and set(indexed) == set(values),
                     "Original feature identities do not cover the capture.")
            result["objectRefs"][key] = indexed
    return result


def _command(command):
    _require(isinstance(command, dict), "Command must be an object.")
    _fields(command, {"requestId", "kind", "actor", "at", "body"})
    request = _id(command.get("requestId"), "requestId")
    kind = _text(command.get("kind"), "kind", 100)
    actor = command.get("actor")
    _require(isinstance(actor, dict), "Retain the command actor.")
    _fields(actor, {"id", "name"})
    actor = {"id": _text(actor.get("id"), "actor.id", 200),
             "name": _text(actor.get("name"), "actor.name", 200)}
    at = _time(command.get("at"), "at")
    body = command.get("body")
    _require(isinstance(body, dict), "Command body must be an object.")
    return request, kind, actor, at, body


def _existing(state, collection, identity):
    row = state[collection].get(identity)
    _require(row is not None, "Unknown " + collection + " record.")
    return row


def _edit(state, collection, body, create=True):
    identity = _id(body.get("id"))
    previous = state[collection].get(identity)
    if previous is None:
        _require(create, "Original record does not exist.")
        _require(body.get("expectedVersion") in (None, 0), "A new record has no prior version.")
        _require(len(state[collection]) < LIMITS[collection], "Dispatch record capacity reached.")
    else:
        _require(type(body.get("expectedVersion")) is int
                 and body["expectedVersion"] == previous["version"],
                 "Record changed; inspect its current version before editing.")
    return identity, previous


def _put(state, collection, identity, fields, previous, stamp):
    versions = copy.deepcopy(previous.get("versions", [])) if previous else []
    if previous:
        versions.append({key: copy.deepcopy(value) for key, value in previous.items() if key != "versions"})
    row = {**copy.deepcopy(fields), "id": identity,
           "version": previous["version"] + 1 if previous else 1,
           "createdAt": previous["createdAt"] if previous else stamp["at"],
           "createdBy": copy.deepcopy(previous["createdBy"] if previous else stamp["actor"]),
           "updatedAt": stamp["at"], "updatedBy": copy.deepcopy(stamp["actor"]),
           "requestId": stamp["requestId"], "versions": versions}
    state[collection][identity] = row
    return row


def _mutable(row):
    return {key: copy.deepcopy(value) for key, value in row.items()
            if key not in {"id", "version", "createdAt", "createdBy", "updatedAt",
                           "updatedBy", "requestId", "versions"}}


def _bind(context, form_id, object_id, require_active=False, capture_id=None):
    form = context["forms"].get(form_id)
    _require(form is not None, "Select an actual saved inspection form.")
    _require(not require_active or form.get("active") is True,
             "New field work requires an active saved form.")
    original_capture = context["captures"].get(form.get("captureId"))
    capture = context["captures"].get(capture_id or form.get("captureId"))
    _require(original_capture is not None and capture is not None,
             "The original form and current source captures must both be retained.")
    _require(all(original_capture.get(key) == capture.get(key) for key in ("serviceUrl", "serviceItemId")),
             "A form cannot be applied to a different original service.")
    _require(capture is not None, "The form's original capture is unavailable.")
    datasets = capture.get("datasets")
    _require(isinstance(datasets, list), "Original capture dataset inventory is unavailable.")
    matches = [row for row in datasets if row.get("layerId") == form.get("layerId")]
    _require(len(matches) == 1, "Original form dataset identity is ambiguous.")
    dataset = matches[0]
    _int(object_id, "objectId", 9223372036854775807)
    _require(object_id in context["objects"].get((capture["id"], form["layerId"]), set()),
             "Assignment object is absent from the original captured dataset.")
    return {"captureId": capture["id"], "layerId": form["layerId"], "objectId": object_id,
            "globalId": context["objectRefs"][(capture["id"], form["layerId"])][object_id]}, form


def _inspection(context, assignment, identity):
    value = context["inspections"].get(identity)
    _require(value is not None, "Link an actual saved inspection.")
    _require(value.get("formId") == assignment["formId"]
             and value.get("formRevision") == assignment["formRevision"],
             "Inspection does not use this assignment's original form edition.")
    source = value.get("sourceRef") or {}
    _require(all(source.get(key) == assignment["sourceRef"][key]
                 for key in ("captureId", "layerId", "objectId", "globalId")),
             "Inspection does not inspect this assignment's original captured object.")
    _require(value.get("assignmentId") in (None, assignment["id"]),
             "Inspection belongs to another assignment.")
    _require(type(value.get("currentVersion")) is int
             and value["currentVersion"] > 0 and isinstance(value.get("currentSha256"), str),
             "Inspection has no complete current native version.")
    return value


def _submitted(value):
    return value.get("status") in ("submitted", "approved") and bool(value.get("submissionId"))


def _approved(value):
    approval = value.get("approval")
    return value.get("status") == "approved" and isinstance(approval, dict) and approval.get("decision") == "approve"


def _linked(context, assignment):
    return [_inspection(context, assignment, row["inspectionId"])
            for row in assignment.get("inspectionLinks", [])]


def _source_summary(context):
    return [{"id": value["id"], "serviceUrl": value.get("serviceUrl"),
             "serviceItemId": value.get("serviceItemId"),
             "datasets": [{"layerId": row["layerId"], "name": row.get("name"),
                           "objectCount": len(row.get("objectIds", [])),
                           "globalIdField": row.get("globalIdField")}
                          for row in value.get("datasets", [])]}
            for value in sorted(context["captures"].values(), key=lambda item: item["id"])]


def _overdue(due_at, as_of, terminal):
    return bool(due_at and not terminal and due_at < as_of)


def _view(workspace, context, as_of):
    state = _state(workspace)
    rows = {key: [copy.deepcopy(row) for _, row in sorted(state[key].items())]
            for key in ("crews", "packages", "assignments", "effortEntries", "followups")}
    effort_by_assignment, effort_by_crew, followup_by_assignment = {}, {}, {}
    for value in rows["effortEntries"]:
        effort_by_assignment.setdefault(value["assignmentId"], []).append(value)
        if not value.get("voided"):
            effort_by_crew[value["crewId"]] = effort_by_crew.get(value["crewId"], 0) + value["minutes"]
    for value in rows["followups"]:
        followup_by_assignment.setdefault(value["assignmentId"], []).append(value)
    assignments = []
    by_package, by_crew = {}, {}
    for row in rows["assignments"]:
        inspections, problems = [], []
        for link in row.get("inspectionLinks", []):
            try:
                current = copy.deepcopy(_inspection(context, row, link["inspectionId"]))
                current["linkedVersion"] = link["version"]
                current["linkedSha256"] = link["sha256"]
                current["changedSinceLink"] = current["currentSha256"] != link["sha256"]
                inspections.append(current)
            except ValueError as error:
                problems.append({"code": "INSPECTION_REFERENCE_UNAVAILABLE", "inspectionId": link["inspectionId"],
                                 "detail": str(error)})
        try:
            source, form = _bind(context, row["formId"], row["sourceRef"]["objectId"],
                                 capture_id=row["sourceRef"]["captureId"])
            _require(source == row["sourceRef"] and form["sha256"] == row["formSha256"],
                     "Original assignment source or form digest changed.")
        except ValueError as error:
            problems.append({"code": "SOURCE_REFERENCE_UNAVAILABLE", "detail": str(error)})
        crew = state["crews"].get(row["crewId"])
        if not crew or not crew["active"]:
            problems.append({"code": "CREW_INACTIVE", "detail": "The assigned crew is inactive or unavailable."})
        accepted = [value for value in inspections if _approved(value)]
        if row["status"] == "CLOSED":
            completion = row.get("completion")
            current = next((value for value in inspections
                            if completion and value["id"] == completion["inspectionId"]), None)
            if not current or not _approved(current) or current["currentSha256"] != completion["inspectionSha256"] \
                    or (current.get("approval") or {}).get("id") != completion["approvalId"]:
                problems.append({"code": "CLOSED_INSPECTION_CHANGED",
                                 "detail": "The recorded closure's approved inspection is no longer current; reopen for follow-through."})
        efforts = effort_by_assignment.get(row["id"], [])
        followups = followup_by_assignment.get(row["id"], [])
        row.update({"inspections": inspections, "issues": problems,
                    "recordedMinutes": sum(value["minutes"] for value in efforts if not value.get("voided")),
                    "openFollowupCount": sum(value["status"] in ("OPEN", "IN_PROGRESS") for value in followups),
                    "approvedInspectionCount": len(accepted),
                    "overdue": _overdue(row["dueAt"], as_of, row["status"] in ("CLOSED", "CANCELLED")),
                    "closureCurrent": row["status"] == "CLOSED" and not any(
                        value["code"] in ("SOURCE_REFERENCE_UNAVAILABLE", "INSPECTION_REFERENCE_UNAVAILABLE",
                                          "CLOSED_INSPECTION_CHANGED") for value in problems)})
        assignments.append(row)
        by_package.setdefault(row["packageId"], []).append(row)
        by_crew.setdefault(row["crewId"], []).append(row)
    rows["assignments"] = assignments
    for package in rows["packages"]:
        members = by_package.get(package["id"], [])
        counts = {status: sum(value["status"] == status for value in members) for status in STATUSES}
        package.update({"assignmentIds": [value["id"] for value in members],
                        "assignmentCounts": counts,
                        "assignedMinutes": sum(value["plannedMinutes"] for value in members),
                        "recordedMinutes": sum(value["recordedMinutes"] for value in members),
                        "openFollowupCount": sum(value["openFollowupCount"] for value in members),
                        "currentCompletedCount": sum(value["closureCurrent"] for value in members),
                        "overdue": _overdue(package["dueAt"], as_of,
                            bool(members) and all(value["status"] in ("CLOSED", "CANCELLED") for value in members))})
    for row in rows["followups"]:
        row["overdue"] = _overdue(row["dueAt"], as_of, row["status"] in ("RESOLVED", "CANCELLED"))
    for row in rows["crews"]:
        assigned = by_crew.get(row["id"], [])
        row["activeAssignmentIds"] = [value["id"] for value in assigned if value["status"] not in ("CLOSED", "CANCELLED")]
        row["recordedMinutes"] = effort_by_crew.get(row["id"], 0)
    return {"schema": SCHEMA, "asOf": as_of, **rows, "sources": _source_summary(context),
            "forms": [copy.deepcopy(value) for value in sorted(context["forms"].values(), key=lambda item: item["id"])],
            "reports": [{"id": value["id"], "title": value["title"], "createdAt": value["createdAt"],
                         "createdBy": value["createdBy"], "sha256": value["sha256"],
                         "assignmentCount": len(value["document"]["assignments"])}
                        for _, value in sorted(state["reports"].items())],
            "totals": {"crews": len(rows["crews"]), "packages": len(rows["packages"]),
                       "assignments": len(assignments), "plannedMinutes": sum(
                           value["plannedMinutes"] for value in rows["packages"]),
                       "assignedMinutes": sum(value["plannedMinutes"] for value in assignments),
                       "recordedMinutes": sum(value["minutes"] for value in rows["effortEntries"] if not value.get("voided")),
                       "openFollowups": sum(value["status"] in ("OPEN", "IN_PROGRESS") for value in rows["followups"]),
                       "overdueAssignments": sum(value["overdue"] for value in assignments),
                       "currentCompletedAssignments": sum(value["closureCurrent"] for value in assignments)},
            "boundaries": [
                "Crews and assignments are locally proposed configuration; they do not assert County staffing or authorization.",
                "Planned minutes are estimates. Recorded minutes are operator-entered work records, not inferred inspection duration.",
                "An assignment closure cites an actual current approved inspection. Domain inspection approval remains separate.",
                "This workspace performs no County GIS edits. Exported plans and reports retain captured source identities."
            ]}


def dispatch_view(workspace, read_blob):
    at = dt.datetime.now(dt.timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
    return _view(workspace, _context(workspace, read_blob), at)


def apply_dispatch(workspace, command, read_blob):
    request, kind, actor, at, body = _command(command)
    _require(kind.startswith("dispatch."), "Unsupported dispatch command.")
    next_workspace = copy.deepcopy(workspace)
    state = copy.deepcopy(_state(workspace))
    next_workspace["dispatch"] = state
    stamp = {"requestId": request, "actor": actor, "at": at}
    result = None
    if kind == "dispatch.crew.save":
        _fields(body, {"id", "expectedVersion", "name", "members", "contact", "active", "notes"})
        identity, previous = _edit(state, "crews", body)
        members = body.get("members", [])
        _require(isinstance(members, list) and len(members) <= 200, "Crew members must be a bounded array.")
        retained, seen = [], set()
        for member in members:
            _fields(member, {"id", "name", "role"})
            member_id = _text(member.get("id"), "member.id", 200)
            _require(member_id not in seen, "Crew member IDs must be unique.")
            seen.add(member_id)
            retained.append({"id": member_id, "name": _text(member.get("name"), "member.name", 200),
                             "role": _text(member.get("role", ""), "member.role", 200, True)})
        _require(type(body.get("active", True)) is bool, "Crew active must be explicit boolean.")
        result = _put(state, "crews", identity,
            {"name": _text(body.get("name"), "name", 200), "members": retained,
             "contact": _text(body.get("contact", ""), "contact", 1000, True),
             "active": body.get("active", True), "notes": _text(body.get("notes", ""), "notes", 10000, True)},
            previous, stamp)
    elif kind == "dispatch.package.save":
        _fields(body, {"id", "expectedVersion", "title", "description", "plannedMinutes", "dueAt", "scopeNotes"})
        identity, previous = _edit(state, "packages", body)
        result = _put(state, "packages", identity,
            {"title": _text(body.get("title"), "title", 300),
             "description": _text(body.get("description", ""), "description", 10000, True),
             "plannedMinutes": _int(body.get("plannedMinutes", 0), "plannedMinutes"),
             "dueAt": _time(body.get("dueAt"), "dueAt", True),
             "scopeNotes": _text(body.get("scopeNotes", ""), "scopeNotes", 10000, True)}, previous, stamp)
    elif kind == "dispatch.assignment.save":
        _fields(body, {"id", "expectedVersion", "packageId", "crewId", "formId", "objectId", "title",
                       "instructions", "dueAt", "plannedMinutes", "priority"})
        identity, previous = _edit(state, "assignments", body)
        package_id, crew_id = _id(body.get("packageId"), "packageId"), _id(body.get("crewId"), "crewId")
        _existing(state, "packages", package_id)
        crew = _existing(state, "crews", crew_id)
        _require(crew["active"] or previous and previous["crewId"] == crew_id,
                 "New assignments require an active crew.")
        form_id = _reference(body.get("formId"), "formId")
        context = _context(workspace, read_blob)
        rebind = previous is None or previous["formId"] != form_id or previous["sourceRef"]["objectId"] != body.get("objectId")
        source, form = _bind(context, form_id, body.get("objectId"), rebind,
                             capture_id=None if rebind else previous["sourceRef"]["captureId"])
        if previous:
            _require(previous["status"] not in ("CLOSED", "CANCELLED"), "Reopen the assignment explicitly before editing.")
            if package_id != previous["packageId"]:
                _require(not any(value["assignmentId"] == identity for value in state["effortEntries"].values()),
                         "Recorded effort retains its original work package; use a separate assignment.")
            if rebind:
                _require(previous["status"] in ("PLANNED", "READY", "BLOCKED")
                         and not previous["inspectionLinks"]
                         and not any(value["assignmentId"] == identity for value in state["effortEntries"].values()),
                         "Recorded field work retains its original object and form. Create a separate assignment.")
        priority = body.get("priority", "NORMAL")
        _require(priority in ("LOW", "NORMAL", "HIGH", "URGENT"), "Unknown priority.")
        fields = {"packageId": package_id, "crewId": crew_id, "formId": form_id,
                  "formRevision": form["revision"], "formSha256": form["sha256"], "formKey": form["key"], "sourceRef": source,
                  "serviceIdentity": {key: context["captures"][source["captureId"]].get(key)
                                      for key in ("serviceUrl", "serviceItemId")},
                  "title": _text(body.get("title"), "title", 300),
                  "instructions": _text(body.get("instructions", ""), "instructions", 20000, True),
                  "dueAt": _time(body.get("dueAt"), "dueAt", True),
                  "plannedMinutes": _int(body.get("plannedMinutes", 0), "plannedMinutes"),
                  "priority": priority, "status": previous["status"] if previous else "PLANNED",
                  "inspectionLinks": copy.deepcopy(previous["inspectionLinks"]) if previous else [],
                  "historicalInspectionLinks": copy.deepcopy(previous.get("historicalInspectionLinks", [])) if previous else [],
                  "completion": copy.deepcopy(previous.get("completion")) if previous else None,
                  "statusReason": previous.get("statusReason", "") if previous else ""}
        result = _put(state, "assignments", identity, fields, previous, stamp)
    elif kind == "dispatch.assignment.link_inspection":
        _fields(body, {"id", "expectedVersion", "inspectionId"})
        identity, previous = _edit(state, "assignments", body, False)
        _require(previous["status"] not in ("CLOSED", "CANCELLED"), "Reopen the assignment before linking another inspection.")
        inspection_id = _reference(body.get("inspectionId"), "inspectionId")
        inspection = _inspection(_context(workspace, read_blob), previous, inspection_id)
        _require(not any(row["inspectionId"] == inspection_id for row in previous["inspectionLinks"]),
                 "This original inspection is already linked.")
        for assignment in state["assignments"].values():
            _require(assignment["id"] == identity or not any(
                row["inspectionId"] == inspection_id for row in assignment["inspectionLinks"])
                and not any(row["link"]["inspectionId"] == inspection_id
                            for row in assignment.get("historicalInspectionLinks", [])),
                "Original inspection is already allocated to another assignment.")
        fields = _mutable(previous)
        fields["inspectionLinks"].append({"inspectionId": inspection_id, "version": inspection["currentVersion"],
                                         "sha256": inspection["currentSha256"], "at": at, "actor": actor})
        result = _put(state, "assignments", identity, fields, previous, stamp)
    elif kind == "dispatch.assignment.refresh":
        _fields(body, {"id", "expectedVersion", "inspectionId", "expectedInspectionVersion", "reason"})
        identity, previous = _edit(state, "assignments", body, False)
        _require(previous["status"] != "CANCELLED", "Reopen a cancelled assignment before refreshing its source.")
        inspection_id = _reference(body.get("inspectionId"), "inspectionId")
        _require(any(row["inspectionId"] == inspection_id for row in previous["inspectionLinks"]),
                 "Refresh from an inspection already linked to this original assignment.")
        reason = _text(body.get("reason"), "reason", 10000)
        context = _context(workspace, read_blob)
        current = context["inspections"].get(inspection_id)
        _require(current is not None and current.get("assignmentId") in (None, identity),
                 "The original linked inspection is unavailable or reassigned.")
        _require(type(body.get("expectedInspectionVersion")) is int
                 and current["currentVersion"] == body["expectedInspectionVersion"],
                 "Inspection changed; inspect its actual current edition before refreshing.")
        target = current["sourceRef"]
        _require(target["layerId"] == previous["sourceRef"]["layerId"]
                 and target["objectId"] == previous["sourceRef"]["objectId"],
                 "A source refresh must retain the original layer and ObjectID.")
        _require(previous["sourceRef"].get("globalId") is None
                 or target.get("globalId") == previous["sourceRef"]["globalId"],
                 "This ObjectID now identifies a different original GlobalID.")
        source, form = _bind(context, current["formId"], target["objectId"],
                             capture_id=target["captureId"])
        _require(source == target and form["key"] == previous["formKey"]
                 and form["revision"] == current["formRevision"],
                 "Refresh must retain the original form key and exact current inspection source.")
        service = {key: context["captures"][source["captureId"]].get(key)
                   for key in ("serviceUrl", "serviceItemId")}
        _require(service == previous["serviceIdentity"], "A source refresh must retain the original service identity.")
        _require((source, form["id"], form["sha256"]) !=
                 (previous["sourceRef"], previous["formId"], previous["formSha256"]),
                 "The assignment already selects this source and form edition.")
        fields = _mutable(previous)
        historical = fields.setdefault("historicalInspectionLinks", [])
        historical.extend({"link": copy.deepcopy(link), "sourceRef": copy.deepcopy(previous["sourceRef"]),
                           "formId": previous["formId"], "formRevision": previous["formRevision"],
                           "supersededAt": at, "reason": reason} for link in previous["inspectionLinks"])
        fields.update({"sourceRef": source, "formId": form["id"], "formRevision": form["revision"],
                       "formSha256": form["sha256"], "formKey": form["key"], "serviceIdentity": service,
                       "status": "IN_FIELD", "statusReason": reason, "completion": None,
                       "inspectionLinks": [{"inspectionId": inspection_id, "version": current["currentVersion"],
                                            "sha256": current["currentSha256"], "at": at, "actor": actor}]})
        result = _put(state, "assignments", identity, fields, previous, stamp)
    elif kind == "dispatch.assignment.status":
        _fields(body, {"id", "expectedVersion", "status", "reason"})
        identity, previous = _edit(state, "assignments", body, False)
        target = body.get("status")
        _require(target in TRANSITIONS[previous["status"]], "This field status transition is not permitted.")
        reason = _text(body.get("reason"), "reason", 10000)
        fields = _mutable(previous)
        completion = None
        if target in ("READY", "IN_FIELD", "SUBMITTED", "CLOSED"):
            context = _context(workspace, read_blob)
            source, form = _bind(context, previous["formId"], previous["sourceRef"]["objectId"],
                                 capture_id=previous["sourceRef"]["captureId"])
            _require(source == previous["sourceRef"] and form["sha256"] == previous["formSha256"],
                     "The original assignment source is no longer available.")
            _require(_existing(state, "crews", previous["crewId"])["active"], "The assigned crew is inactive.")
            values = _linked(context, previous)
            if target == "SUBMITTED":
                _require(any(_submitted(value) for value in values), "Link an actual submitted inspection before submitting field work.")
            if target == "CLOSED":
                approved = [value for value in values if _approved(value)]
                _require(approved, "Field closure requires an actual current domain approval.")
                _require(not any(value["assignmentId"] == identity and value["status"] in ("OPEN", "IN_PROGRESS")
                                 for value in state["followups"].values()),
                         "Resolve or explicitly cancel the assignment's open supervisor follow-through before closure.")
                selected = sorted(approved, key=lambda value: ((value["approval"] or {}).get("at", ""), value["id"]))[-1]
                completion = {"inspectionId": selected["id"], "inspectionVersion": selected["currentVersion"],
                              "inspectionSha256": selected["currentSha256"],
                              "approvalId": selected["approval"]["id"], "approval": copy.deepcopy(selected["approval"]),
                              "recordedAt": at, "recordedBy": actor}
        fields.update({"status": target, "statusReason": reason, "completion": completion})
        result = _put(state, "assignments", identity, fields, previous, stamp)
    elif kind == "dispatch.effort.record":
        _fields(body, {"id", "assignmentId", "crewId", "minutes", "performedAt", "note"})
        identity = _id(body.get("id"))
        _require(identity not in state["effortEntries"], "Original effort ID already exists.")
        _require(len(state["effortEntries"]) < LIMITS["effortEntries"], "Effort record capacity reached.")
        assignment_id = _id(body.get("assignmentId"), "assignmentId")
        assignment = _existing(state, "assignments", assignment_id)
        crew_id = _id(body.get("crewId"), "crewId")
        _existing(state, "crews", crew_id)
        _require(crew_id == assignment["crewId"], "Record effort against the assignment's current crew.")
        _require(assignment["status"] not in ("PLANNED", "CANCELLED"), "Start the assigned work before recording effort.")
        performed = _time(body.get("performedAt"), "performedAt")
        _require(performed <= at, "Recorded effort must describe work already performed.")
        result = _put(state, "effortEntries", identity,
            {"assignmentId": assignment_id, "crewId": crew_id,
             "minutes": _int(body.get("minutes"), "minutes", 10080, 1),
             "performedAt": performed, "note": _text(body.get("note"), "note", 10000),
             "voided": None}, None, stamp)
    elif kind == "dispatch.effort.void":
        _fields(body, {"id", "expectedVersion", "reason"})
        identity, previous = _edit(state, "effortEntries", body, False)
        _require(not previous.get("voided"), "Original effort record is already voided.")
        fields = _mutable(previous)
        fields["voided"] = {"at": at, "actor": actor, "reason": _text(body.get("reason"), "reason", 10000)}
        result = _put(state, "effortEntries", identity, fields, previous, stamp)
    elif kind == "dispatch.followup.save":
        _fields(body, {"id", "expectedVersion", "assignmentId", "title", "owner", "dueAt", "status", "notes"})
        identity, previous = _edit(state, "followups", body)
        assignment_id = _id(body.get("assignmentId"), "assignmentId")
        assignment = _existing(state, "assignments", assignment_id)
        _require(not previous or previous["assignmentId"] == assignment_id, "A retained follow-up cannot move to another assignment.")
        status = body.get("status", "OPEN")
        _require(status in FOLLOWUP_STATUSES, "Unknown follow-up status.")
        _require(assignment["status"] not in ("CLOSED", "CANCELLED") or status in ("RESOLVED", "CANCELLED"),
                 "Reopen the assignment before adding open follow-through.")
        notes = _text(body.get("notes", ""), "notes", 10000, True)
        _require(status not in ("RESOLVED", "CANCELLED") or bool(notes), "Record the supervisor outcome.")
        _require(not previous or previous["status"] not in ("RESOLVED", "CANCELLED")
                 or status == previous["status"] or bool(notes), "Explain the reopened follow-up.")
        result = _put(state, "followups", identity,
            {"assignmentId": assignment_id, "title": _text(body.get("title"), "title", 300),
             "owner": _text(body.get("owner"), "owner", 300),
             "dueAt": _time(body.get("dueAt"), "dueAt", True), "status": status, "notes": notes}, previous, stamp)
    elif kind == "dispatch.report.freeze":
        _fields(body, {"id", "title", "notes"})
        identity = _id(body.get("id"))
        _require(identity not in state["reports"], "This original report ID is already frozen.")
        _require(len(state["reports"]) < LIMITS["reports"], "Report capacity reached.")
        title = _text(body.get("title"), "title", 300)
        notes = _text(body.get("notes", ""), "notes", 20000, True)
        context = _context(workspace, read_blob)
        document = _view(next_workspace, context, at)
        document.pop("reports")
        document.update({"schema": REPORT_SCHEMA, "id": identity, "title": title, "notes": notes,
                         "createdAt": at, "createdBy": actor, "requestId": request})
        _require(len(_canonical(document)) <= MAX_REPORT_BYTES, "Complete operating report exceeds the supported byte limit.")
        result = {"id": identity, "title": title, "createdAt": at, "createdBy": actor,
                  "sha256": _sha(document), "document": document}
        state["reports"][identity] = result
    else:
        raise ValueError("Unsupported dispatch command: " + kind)
    _require(len(_canonical(state)) <= MAX_STATE_BYTES, "Complete retained dispatch history exceeds capacity.")
    return next_workspace, copy.deepcopy(result)


def dispatch_report_html(workspace, report_id):
    """Render the complete frozen original document; no current domain reads."""
    report = _existing(_state(workspace), "reports", _id(report_id, "reportId"))
    document = report["document"]
    _require(_sha(document) == report["sha256"], "Frozen report identity changed.")
    esc = lambda value: html.escape(str(value), quote=True)
    def table(headings, rows):
        return "<div class=\"scroll\"><table><thead><tr>" + "".join("<th>" + esc(h) + "</th>" for h in headings) + \
            "</tr></thead><tbody>" + "".join("<tr>" + "".join("<td>" + esc(v) + "</td>" for v in row) +
            "</tr>" for row in rows) + "</tbody></table></div>"
    blocks = [
        "<h1>" + esc(document["title"]) + "</h1>",
        "<p>Frozen " + esc(document["createdAt"]) + " by " + esc(document["createdBy"]["name"]) +
        ". SHA-256 " + esc(report["sha256"]) + ".</p>",
        "<p>" + esc(document["notes"]) + "</p>",
        "<h2>Operating boundaries</h2><ul>" + "".join("<li>" + esc(v) + "</li>" for v in document["boundaries"]) + "</ul>",
        "<h2>Work packages</h2>",
        table(["Package", "Due", "Planned minutes", "Assigned minutes", "Recorded minutes", "Current completed", "Open follow-through"],
              [[r["title"], r["dueAt"] or "", r["plannedMinutes"], r["assignedMinutes"], r["recordedMinutes"],
                r["currentCompletedCount"], r["openFollowupCount"]] for r in document["packages"]]),
        "<h2>Field assignments</h2>",
        table(["Assignment", "Status", "Due", "Captured object", "Form edition", "Planned / recorded minutes", "Issues"],
              [[r["title"], r["status"], r["dueAt"] or "",
                str(r["sourceRef"]["layerId"]) + " / " + str(r["sourceRef"]["objectId"]),
                r["formId"] + " / " + str(r["formRevision"]),
                str(r["plannedMinutes"]) + " / " + str(r["recordedMinutes"]),
                "; ".join(v["detail"] for v in r["issues"])] for r in document["assignments"]]),
        "<h2>Supervisor follow-through</h2>",
        table(["Assignment", "Action", "Owner", "Due", "Status", "Outcome"],
              [[r["assignmentId"], r["title"], r["owner"], r["dueAt"] or "", r["status"], r["notes"]]
               for r in document["followups"]]),
        "<h2>Recorded effort</h2>",
        table(["Assignment", "Crew", "Minutes", "Performed", "Record", "Correction"],
              [[r["assignmentId"], r["crewId"], r["minutes"], r["performedAt"], r["note"],
                r["voided"]["reason"] if r.get("voided") else ""] for r in document["effortEntries"]]),
        "<h2>Complete original records and history</h2>",
        "<p>The following JSON contains every crew, package, assignment, retained version, effort record, follow-up and inspection/source reference in this frozen report.</p>",
        "<pre>" + esc(json.dumps(document, ensure_ascii=False, sort_keys=True, indent=2, allow_nan=False)) + "</pre>"
    ]
    return "<!doctype html><html lang=\"en\"><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">" + \
        "<title>" + esc(document["title"]) + "</title><style>body{font:16px/1.5 system-ui,sans-serif;max-width:1200px;margin:2rem auto;padding:0 1rem;color:#202124}h1,h2{line-height:1.2}.scroll{overflow:auto}table{border-collapse:collapse;width:100%}th,td{padding:.6rem;border:1px solid #bbb;text-align:left;vertical-align:top}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:.82rem;background:#f3f3f3;padding:1rem}p,td{overflow-wrap:anywhere}</style><body>" + \
        "".join(blocks) + "</body></html>"
