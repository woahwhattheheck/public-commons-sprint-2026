"""MIT. Source-bound referral graphs, operating findings and complete field views."""
from __future__ import annotations
from collections import Counter
import re
from referral_runtime import InputError, source, public_row, values_at
from referral_schema import TASK_STATUSES, PROFILE_ID, profile

TEMP = "http://hl7.org/fhir/us/sdoh-clinicalcare/CodeSystem/SDOHCC-CodeSystemTemporaryCodes"
TASK_CODE = "http://hl7.org/fhir/CodeSystem/task-code"
ALLOWED_ADDITIONAL = {"Observation", "Goal", "Condition", "QuestionnaireResponse", "CarePlan"}
FIELD_PATHS = {
    "parent-task": ("task", ["partOf", "*"]), "task-status": ("task", ["status"]),
    "task-reason": ("task", ["statusReason"]), "task-intent": ("task", ["intent"]),
    "task-code": ("task", ["code"]), "task-focus": ("task", ["focus"]),
    "task-for": ("task", ["for"]), "task-authored": ("task", ["authoredOn"]),
    "task-requester": ("task", ["requester"]), "task-owner": ("task", ["owner"]),
    "request-parent": ("request", ["basedOn", "*"]), "request-status": ("request", ["status"]),
    "service-code": ("request", ["code"]), "contact-instruction": ("request", ["orderDetail", "*"]),
    "request-subject": ("request", ["subject"]), "request-requester": ("request", ["requester"]),
    "consent-status": ("consent", ["status"]), "consent-patient": ("consent", ["patient"]),
    "consent-time": ("consent", ["dateTime"]), "consent-organisation": ("consent", ["organization", "*"]),
    "consent-original": ("consent", [])}
EXPECTED_REFERENCES = {
    "focus": {"ServiceRequest"}, "for": {"RelatedPerson", "Group", "Patient"},
    "requester": {"PractitionerRole", "Organization"}, "partOf": {"Task"}}

def coding(value, system, code):
    return isinstance(value, dict) and isinstance(value.get("coding"), list) and any(
        isinstance(c, dict) and c.get("system") == system and c.get("code") == code for c in value["coding"])

def reference_type(value):
    if not isinstance(value, dict):
        return None
    if isinstance(value.get("type"), str):
        return value["type"].rsplit("/", 1)[-1]
    ref = value.get("reference")
    if isinstance(ref, str):
        m = re.search(r"(?:^|/)([A-Z][A-Za-z]+)/[A-Za-z0-9.-]+(?:/_history/[^/]+)?$", ref)
        return m.group(1) if m else None
    return None

def citation(row, path=()):
    return {"sourceId": row["sourceId"], "recordId": row["recordId"],
            "pointer": row["entryPointer"] + source.pointer(path),
            "resourceSha256": row["resourceSha256"]}

def complete_value(row, value, path):
    return {**citation(row, path), "jsonText": source.lexical_json(value)}

def display(value):
    if isinstance(value, str):
        return value
    if not isinstance(value, dict):
        return ""
    if value.get("text"):
        return str(value["text"])
    if value.get("display"):
        return str(value["display"])
    if value.get("reference"):
        return value["reference"]
    codes = value.get("coding", [])
    if not isinstance(codes, list):
        return ""
    return "; ".join(str(c.get("display") or c.get("code") or "") for c in codes if isinstance(c, dict))

def links(resolution, record_id, root_key):
    return [e for e in resolution.outgoing(record_id) if e["path"] and e["path"][0] == root_key]

def targets(index, resolution, row, root_key, types=None):
    found, seen = [], set()
    for edge in links(resolution, row["recordId"], root_key):
        for rid in edge.get("targetRecordIds", []):
            target = index.row(rid)
            if rid not in seen and (types is None or target["resourceType"] in types):
                found.append(target)
                seen.add(rid)
    return found

def active_decisions(decisions, edition_id):
    selected = [d for d in decisions if d.get("editionId") == edition_id]
    replaced = {d.get("supersedesId") for d in selected if d.get("supersedesId")}
    return [d for d in selected if d["id"] not in replaced]

def field_cells(task, requests, consents, selected_profile):
    subjects = {"task": [task], "request": requests, "consent": consents}
    cells = []
    for field in selected_profile["fields"]:
        key, values = field["key"], []
        if key in FIELD_PATHS:
            kind, path = FIELD_PATHS[key]
            for row in subjects[kind]:
                if key == "consent-original":
                    matches = [(v, [k]) for k, v in row["_resource"].items()
                               if k in {"sourceAttachment", "sourceReference"}]
                else:
                    matches = values_at(row["_resource"], path)
                values.extend(complete_value(row, v, at) for v, at in matches)
        else:
            selected_type = "additional-content" if key == "output-context" else "resulting-activity"
            value_key = "valueCodeableConcept" if key == "performed-code" else "valueReference"
            for i, output in enumerate(task["_resource"].get("output", [])):
                if isinstance(output, dict) and coding(output.get("type"), TEMP, selected_type) and value_key in output:
                    values.append(complete_value(task, output[value_key], ["output", str(i), value_key]))
        cells.append({"key": key, "label": field["label"], "state": "present" if values else "absent",
                      "values": values, "sourceRefs": field["source_refs"]})
    return cells

def evaluate(ws, edition, review, configuration, *, as_of):
    """Evaluate exact selected resources; domain review is retained separately."""
    findings, task_rows, cells, all_referrals = [], [], [], []
    decisions = active_decisions(ws.referral_records("decisions"), edition["id"])
    requirement_states = Counter(r["status"] for r in review["requirements"])
    field_states = Counter(r["status"] for r in review["fields"])
    profile_snapshot = review["profileSnapshot"]
    def add(task, key, severity, label, observed=None, path=(), related=None):
        body = {"taskId": task["recordId"], "rule": key, "severity": severity,
                "label": label, "observed": observed, "sourceRefs": [citation(task, path)],
                "relatedRecordIds": related or [], "owner": edition.get("actor", ""),
                "state": "open"}
        body["id"] = source.sha(source.jbytes(body))
        for decision in decisions:
            if decision["kind"] == "finding" and body["id"] in decision.get("findingIds", []):
                body["decisionId"] = decision["id"]
                body["state"] = "resolved" if decision["outcome"] == "resolved" else decision["outcome"]
        findings.append(body)
        return body
    with ws._graph(edition["graphId"]) as (graph, index, resolution, _):
        for task_id in edition["taskIds"]:
            task = index.row(task_id)
            task["sourceId"] = edition["sourceId"]
            r = task["_resource"]
            requests = targets(index, resolution, task, "focus", {"ServiceRequest"})
            for row in requests:
                row["sourceId"] = edition["sourceId"]
            consents, seen_consents = [], set()
            for request in requests:
                for row in targets(index, resolution, request, "supportingInfo", {"Consent"}):
                    if row["recordId"] not in seen_consents:
                        row["sourceId"] = edition["sourceId"]
                        consents.append(row); seen_consents.add(row["recordId"])
            selected = [d for d in decisions if task_id in d.get("taskIds", [])]
            for decision in selected:
                if decision["kind"] == "consent":
                    for rid in decision.get("resourceIds", []):
                        row = index.row(rid)
                        if row["resourceType"] == "Consent" and rid not in seen_consents:
                            row["sourceId"] = edition["sourceId"]
                            consents.append(row); seen_consents.add(rid)
            status = r.get("status")
            if status not in TASK_STATUSES:
                add(task, "referral-task-status", "error", "Task status is outside the selected referral value set", status, ["status"])
            if r.get("intent") != "order":
                add(task, "referral-task-intent", "error", "Referral Task intent must retain order", r.get("intent"), ["intent"])
            if not coding(r.get("code"), TASK_CODE, "fulfill"):
                add(task, "referral-task-code", "error", "Referral Task code must retain the original fulfill coding", display(r.get("code")), ["code"])
            for key in ["focus", "for", "authoredOn", "requester"]:
                if not r.get(key):
                    add(task, "task-required-" + key, "error", "Required referral Task field is absent: " + key, None, [])
            for key, expected in EXPECTED_REFERENCES.items():
                value = r.get(key, [])
                values = value if isinstance(value, list) else [value]
                for ref in values:
                    actual_type = reference_type(ref)
                    if actual_type and actual_type not in expected:
                        add(task, "task-reference-type-" + key, "error",
                            "Original " + key + " reference type differs from the selected profile", actual_type, [key])
            if r.get("statusReason") and (not isinstance(r["statusReason"], dict) or not r["statusReason"].get("text")):
                add(task, "task-reason-text", "error", "Present Task statusReason requires its original text", None, ["statusReason"])
            if status in {"rejected", "cancelled", "on-hold", "failed"} and not (isinstance(r.get("statusReason"), dict) and r["statusReason"].get("text")):
                add(task, "task-reason-recommended", "warning", "Record the recommended reason for this referral state", status, ["status"])
            if not r.get("owner") and status in {"requested", "accepted", "in-progress", "on-hold"}:
                add(task, "unassigned-referral", "work", "Select the receiving owner for this referral", status, [])
            if len(requests) != 1:
                add(task, "focus-source-resolution", "work",
                    "Review the exact ServiceRequest focus and its selected source identity",
                    {"resolvedRequests": len(requests)}, ["focus"], [s["recordId"] for s in requests])
            output_refs, outcomes = [], []
            for i, output in enumerate(r.get("output", [])):
                if not isinstance(output, dict):
                    continue
                code = output.get("type")
                value_keys = [k for k in output if k.startswith("value")]
                if value_keys:
                    outcomes.append(complete_value(task, output, ["output", str(i)]))
                if coding(code, TEMP, "resulting-activity"):
                    if "valueReference" in output:
                        typ = reference_type(output["valueReference"])
                        if typ and typ != "Procedure":
                            add(task, "performed-activity-type", "error",
                                "Resulting activity reference must select a Procedure", typ, ["output", str(i), "valueReference"])
                        output_refs.extend(targets(index, resolution, task, "output", {"Procedure"}))
                    elif "valueCodeableConcept" not in output:
                        add(task, "performed-activity-value", "error",
                            "Resulting activity retains a Procedure reference or CodeableConcept", None, ["output", str(i)])
                elif coding(code, TEMP, "additional-content") and "valueReference" in output:
                    typ = reference_type(output["valueReference"])
                    if typ and typ not in ALLOWED_ADDITIONAL:
                        add(task, "additional-output-type", "error",
                            "Additional output reference is outside the selected allowed resource types", typ, ["output", str(i), "valueReference"])
            if status == "completed" and not outcomes:
                add(task, "refer-9", "error", "Completed referral needs its returned outcome", status, ["status"])
            prohibited, subject_relations, request_views = False, [], []
            for request in requests:
                sr = request["_resource"]
                if not sr.get("subject"):
                    add(task, "request-subject-required", "error", "The focused ServiceRequest needs its original subject", None,
                        ["focus"], [request["recordId"]])
                actual_type = reference_type(sr.get("subject"))
                if actual_type and actual_type not in {"Group", "Patient", "Location"}:
                    add(task, "request-subject-type", "error", "ServiceRequest subject differs from its allowed profile types",
                        actual_type, ["focus"], [request["recordId"]])
                instruction = any(coding(v, TEMP, "contacting-subject-prohibited") for v in sr.get("orderDetail", []))
                prohibited = prohibited or instruction
                if instruction:
                    add(task, "contacting-subject-prohibited", "instruction",
                        "The original request prohibits contact with its subject", True, ["focus"], [request["recordId"]])
                task_subject, request_subject = r.get("for"), sr.get("subject")
                relationship = {"taskSubject": complete_value(task, task_subject, ["for"]) if task_subject else None,
                    "requestSubject": complete_value(request, request_subject, ["subject"]) if request_subject else None}
                if isinstance(task_subject, dict) and isinstance(request_subject, dict) and task_subject.get("reference") != request_subject.get("reference"):
                    relationship["review"] = "Review the actual permitted subject relationship"
                    add(task, "subject-relationship", "work",
                        "Task.for and ServiceRequest.subject retain different permitted identities",
                        {"task": display(task_subject), "request": display(request_subject)}, ["for"], [request["recordId"]])
                subject_relations.append(relationship)
                if r.get("partOf") and configuration["topology"].startswith("intermediary"):
                    if sr.get("intent") != "filler-order" or not sr.get("basedOn"):
                        add(task, "refer-1-intermediary-request", "error",
                            "An intermediary subreferral retains filler-order and original basedOn", sr.get("intent"), ["partOf"], [request["recordId"]])
                if sr.get("specimen") or sr.get("bodySite"):
                    add(task, "request-prohibited-elements", "error", "Selected SDOH ServiceRequest excludes specimen and bodySite",
                        None, ["focus"], [request["recordId"]])
                request_views.append({"recordId": request["recordId"], "id": request.get("id"),
                    "status": sr.get("status"), "intent": sr.get("intent"), "subject": display(sr.get("subject")),
                    "requestedService": display(sr.get("code")), "codeJson": source.lexical_json(sr.get("code")),
                    "basedOn": sr.get("basedOn", []), "contactProhibited": instruction,
                    "sourceRef": citation(request)})
            consent_views = []
            for consent in consents:
                cv = consent["_resource"]
                issues = []
                for key in ["patient", "dateTime", "category", "organization"]:
                    if not cv.get(key):
                        issues.append(key + " is absent")
                if isinstance(cv.get("organization"), list) and len(cv["organization"]) != 1:
                    issues.append("organization cardinality is not exactly one")
                if not cv.get("sourceAttachment") and not cv.get("sourceReference"):
                    issues.append("original source[x] is absent")
                if reference_type(cv.get("patient")) not in {None, "Patient"}:
                    issues.append("patient reference type differs from the profile")
                consent_views.append({"recordId": consent["recordId"], "id": consent.get("id"),
                    "status": cv.get("status"), "dateTime": cv.get("dateTime"),
                    "scopeJson": source.lexical_json(cv.get("scope")), "provisionJson": source.lexical_json(cv.get("provision")),
                    "originalSourceJson": source.lexical_json(cv.get("sourceAttachment") or cv.get("sourceReference")),
                    "profileFindings": issues, "sourceRef": citation(consent)})
                for issue in issues:
                    add(task, "consent-original-profile", "work", issue, consent.get("id"), ["focus"], [consent["recordId"]])
            consent_decisions = [d for d in selected if d["kind"] == "consent"]
            if not consent_decisions:
                add(task, "consent-scope-review", "work",
                    "Record the responsible review of consent and the selected exchange purpose",
                    {"originalConsents": len(consents)}, [])
            for edge in resolution.outgoing(task_id):
                if edge["status"] in {"unresolved", "ambiguous"}:
                    add(task, "unresolved-reference", "work", edge["reason"],
                        {"edgeId": edge["id"], "reference": edge.get("reference"), "status": edge["status"]},
                        edge["path"])
            resource_rows = field_cells(task, requests, consents, profile_snapshot)
            cells.extend({"taskId": task_id, **c} for c in resource_rows)
            if configuration["sourceVersion"] != "3.0.0":
                add(task, "legacy-profile-selected", "work",
                    "Compare this legacy source with its retained original profile artifact", configuration["sourceVersion"])
            task_rows.append({"taskId": task_id, "logicalId": task.get("id"), "versionId": task.get("versionId"),
                "status": status, "statusReason": display(r.get("statusReason")), "priority": r.get("priority"),
                "owner": display(r.get("owner")), "requester": display(r.get("requester")),
                "authoredOn": r.get("authoredOn"), "subject": display(r.get("for")),
                "parentTasks": links(resolution, task_id, "partOf"), "requests": request_views,
                "subjectRelationships": subject_relations, "outcomes": outcomes,
                "procedureIds": sorted({v["recordId"] for v in output_refs}),
                "consents": consent_views, "consentDecisionIds": [d["id"] for d in consent_decisions],
                "contactProhibited": prohibited, "sourceRef": citation(task),
                "resourceSha256": task["resourceSha256"]})
            all_referrals.append(task_id)
    states = Counter(t.get("status") or "absent" for t in task_rows)
    levels = Counter(f["severity"] for f in findings)
    return {"schema": "stellar-forge.gravity-referral-assessment.v1", "editionId": edition["id"],
        "sourceId": edition["sourceId"], "graphId": edition["graphId"], "reviewId": review["id"],
        "configurationId": configuration["id"], "profileId": PROFILE_ID, "asOf": as_of,
        "tasks": task_rows, "findings": findings, "cells": cells,
        "decisions": decisions, "profileSha256": source.sha(source.jbytes(profile_snapshot)),
        "summary": {"tasks": len(task_rows), "statuses": dict(states), "findings": dict(levels),
            "requirements": dict(requirement_states), "fields": dict(field_states),
            "contactProhibited": sum(t["contactProhibited"] for t in task_rows),
            "completedWithOutcome": sum(t["status"] == "completed" and bool(t["outcomes"]) for t in task_rows),
            "consentReviewRecorded": sum(bool(t["consentDecisionIds"]) for t in task_rows)}}
