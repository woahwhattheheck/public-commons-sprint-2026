"""Editable audit records and source-linked operating calculations."""
from __future__ import annotations

import calendar
from datetime import date, datetime
from decimal import Decimal, InvalidOperation
import json

from .store import DOMAIN_KINDS, fingerprint

STAGES = ["Announcement", "Planning", "Opening Meeting", "Review & Testing", "Closing Meeting", "Reporting", "Follow-Up"]

def field(name, label, kind="text", required=False, options=None, target=None):
    return {"name": name, "label": label, "type": kind, "required": required,
            **({"options": options} if options is not None else {}),
            **({"target": target} if target else {})}

F = field
SCHEMAS = {
 "engagement": {"title": "Engagements", "label": "title", "fields": [
    F("title", "Engagement title", required=True), F("unit_ids", "Audited unit IDs", "list", True),
    F("organizational_scope", "Organizational scope", "textarea"), F("audit_type", "Audit type"),
    F("scope_text", "Scope", "textarea"), F("objectives", "Objectives", "textarea"),
    F("program_reference", "Audit program reference"), F("issue_date", "Report issue date", "date"),
    F("normalized_stage", "Current stage", "select", True, STAGES), F("stage_raw", "Original source stage"),
    F("context_summary", "Approved report background", "textarea"),
    F("balanced_conclusion", "Approved balanced conclusion", "textarea"),
    F("is_it_audit", "IT audit", "boolean"), F("is_michigan_medicine", "Michigan Medicine", "boolean"),
    F("lead_reference", "Audit lead"), F("planned_start", "Planned start", "date"), F("planned_end", "Planned end", "date"),
    F("budget_hours", "Planned hours", "decimal"), F("notes", "Internal planning notes", "textarea")]},
 "risk": {"title": "Risk register", "label": "title", "fields": [
    F("title", "Risk", required=True), F("unit_id", "Unit ID", required=True),
    F("engagement_id", "Related engagement", "reference", target="engagement"),
    F("category", "Risk category"), F("description", "Risk statement", "textarea"),
    F("likelihood", "Likelihood (1–5)", "decimal"), F("impact", "Impact (1–5)", "decimal"),
    F("control_effectiveness", "Control effectiveness (0–1)", "decimal"),
    F("existing_controls", "Existing controls", "textarea"), F("response", "Risk response", "textarea"),
    F("owner_reference", "Risk owner"), F("assessment_date", "Assessment date", "date"),
    F("method_reference", "Scoring method/source"), F("evidence_ids", "Supporting evidence IDs", "list"),
    F("source_score", "Original source score"), F("audit_plan_year", "Audit plan year")]},
 "audit_area": {"title": "Audit areas", "label": "label", "fields": [
    F("engagement_id", "Engagement", "reference", True, target="engagement"),
    F("label", "Key area", required=True), F("objective", "Audit objective", "textarea"),
    F("parent_area_id", "Parent area", "reference", target="audit_area"), F("source_order", "Report order", "integer")]},
 "sub_activity": {"title": "Control activities", "label": "label", "fields": [
    F("area_id", "Audit area", "reference", True, target="audit_area"), F("label", "Sub-activity", required=True),
    F("raw_result_symbol", "Original result symbol"),
    F("normalized_result", "Reviewed result", "select", options=["", "observation", "no_observation", "not_assessed"]),
    F("report_summary", "Approved control result summary", "textarea"), F("source_locator", "Original page/row reference")]},
 "workpaper": {"title": "Workpapers", "label": "title", "fields": [
    F("engagement_id", "Engagement", "reference", True, target="engagement"), F("title", "Workpaper title", required=True),
    F("area_id", "Audit area", "reference", target="audit_area"), F("objective", "Test objective", "textarea"),
    F("procedure", "Procedure performed", "textarea"), F("population", "Population and period", "textarea"),
    F("sample_method", "Sample selection method", "textarea"), F("sample_size", "Sample size", "integer"),
    F("results", "Results and exceptions", "textarea"), F("conclusion", "Auditor conclusion", "textarea"),
    F("prepared_by", "Prepared by"), F("prepared_at", "Preparation date", "date"),
    F("evidence_ids", "Supporting evidence IDs", "list"), F("status", "Workpaper status", "select", options=["Draft", "Ready for review", "Reviewed", "Rework"])]},
 "observation": {"title": "Observations", "label": "title", "fields": [
    F("engagement_id", "Engagement", "reference", True, target="engagement"),
    F("sub_activity_id", "Control activity", "reference", target="sub_activity"), F("title", "Observation title", required=True),
    F("owner_unit", "Responsible unit ID", required=True), F("details", "Detailed observation", "textarea"),
    F("criteria", "Criteria", "textarea"), F("condition", "Condition", "textarea"),
    F("cause", "Cause", "textarea"), F("effect", "Effect/risk", "textarea"), F("recommendation", "Recommendation", "textarea"),
    F("priority_normalized", "Reviewed priority", "select", options=["", "high", "medium", "low"]),
    F("priority_raw", "Original source priority"), F("report_summary", "Approved senior-report summary", "textarea"),
    F("report_inclusion", "Include in the audit report", "boolean"), F("evidence_ids", "Evidence IDs", "list"),
    F("interim_control", "Immediate correction or interim control", "textarea")]},
 "management_action": {"title": "Management actions", "label": "title", "fields": [
    F("observation_id", "Observation", "reference", True, target="observation"),
    F("title", "Action title"), F("plan_text", "Detailed management action plan", "textarea", True),
    F("report_summary", "Approved senior-report action summary", "textarea"),
    F("responsible_party_reference", "Responsible person/team", required=True),
    F("source_status", "Unit-reported status"), F("issue_date", "Original report issue date", "date"),
    F("explicit_target_date", "Explicit action-plan completion date", "date"),
    F("override_source", "Source for the explicit completion date", "textarea"),
    F("unit_completion_statement", "Unit completion statement", "textarea"),
    F("completion_evidence_ids", "Implementation evidence IDs", "list")]},
 "evidence": {"title": "Evidence", "label": "filename", "fields": [
    F("filename", "Original file name", required=True), F("source_id", "Retained source ID", required=True),
    F("sha256", "Original SHA-256", required=True), F("size", "Original bytes", "integer"),
    F("media_type", "Media type"), F("source_locator", "Source/page/row reference"),
    F("classification", "Reviewed classification", "select", options=["unknown", "auditor_only", "unit_shared", "public"]),
    F("engagement_id", "Engagement", "reference", target="engagement"),
    F("observation_id", "Observation", "reference", target="observation"),
    F("owner_unit", "Unit for shared evidence"), F("description", "Evidence description", "textarea")]},
 "follow_up_review": {"title": "Follow-up reviews", "label": "review_date", "fields": [
    F("action_id", "Management action", "reference", True, target="management_action"),
    F("review_date", "Review date", "date", True), F("source_status", "Unit's status at review"),
    F("implementation_evidence", "Implementation evidence and assessment", "textarea"),
    F("evidence_ids", "Evidence IDs", "list"),
    F("auditor_verification", "Auditor verification", "textarea"),
    F("next_review_date", "Explicit next review", "date"), F("memo_reference", "Follow-up memo reference"),
    F("committee_review_flag", "Committee review flag", "boolean")]},
 "advisory_memo": {"title": "Advisory memos", "label": "title", "fields": [
    F("engagement_id", "Engagement", "reference", True, target="engagement"),
    F("title", "Memo title", required=True), F("purpose", "Purpose/referral", "textarea"),
    F("body", "Reviewed memo content", "textarea", True), F("recipient_unit_ids", "Explicit recipient unit IDs", "list", True),
    F("record_ids", "Referenced record IDs", "list"), F("issued_at", "Issue date", "date")]},
 "review_decision": {"title": "Review history", "label": "record_id", "fields": []},
 "source_mapping": {"title": "Source mappings", "label": "label", "fields": [
    F("label", "Mapping name", required=True), F("source_namespace", "Original system namespace", required=True),
    F("record_kind", "Record family", "select", True, sorted(DOMAIN_KINDS)),
    F("mappings", "Ordered field mappings", "json", True), F("native_contract_reference", "Actual target contract/reference")]},
 "questionnaire_response": {"title": "RFP responses", "label": "question_id", "fields": [
    F("question_id", "Original question ID", required=True), F("catalog_sha256", "Original catalog SHA-256", required=True),
    F("response", "Supplier response", "textarea"), F("status", "Response status", "select", options=["Unanswered", "Draft", "Reviewed", "Not applicable"]),
    F("owner_reference", "Response owner"), F("evidence_ids", "Supporting evidence IDs", "list"),
    F("applicability_reason", "Applicability explanation", "textarea")]},
 "receiving_projection": {"title": "Receiving projections", "label": "document_kind", "fields": []},
}
RELATIONSHIPS = {
    "engagement_id": "engagement", "area_id": "audit_area", "parent_area_id": "audit_area",
    "sub_activity_id": "sub_activity", "observation_id": "observation", "action_id": "management_action",
}
LIST_RELATIONSHIPS = {"evidence_ids": "evidence", "completion_evidence_ids": "evidence"}

def iso_date(value):
    if value in (None, ""):
        return None
    if not isinstance(value, str) or len(value) != 10:
        raise ValueError("Use an ISO calendar date: YYYY-MM-DD.")
    return date.fromisoformat(value)

def decimal_value(value, label):
    try:
        result = Decimal(str(value))
    except (InvalidOperation, ValueError):
        raise ValueError(label + " must be a decimal number.") from None
    if not result.is_finite():
        raise ValueError(label + " must be finite.")
    return result

def validate_payload(kind, payload, existing_records=None, authoring=True):
    if kind not in SCHEMAS or not isinstance(payload, dict):
        raise ValueError("Choose a supported audit record family.")
    value = json.loads(json.dumps(payload, ensure_ascii=False, allow_nan=False))
    for spec in SCHEMAS[kind]["fields"]:
        name = spec["name"]
        item = value.get(name)
        if spec["required"] and authoring and item in (None, "", []):
            raise ValueError(spec["label"] + " is required.")
        if item in (None, ""):
            continue
        typ = spec["type"]
        if typ == "date":
            iso_date(item)
        elif typ == "decimal":
            value[name] = str(decimal_value(item, spec["label"]))
        elif typ == "integer":
            if isinstance(item, bool) or not isinstance(item, int) or item < 0:
                raise ValueError(spec["label"] + " must be a nonnegative integer.")
        elif typ == "boolean":
            if not isinstance(item, bool):
                raise ValueError(spec["label"] + " must be true or false.")
        elif typ == "list":
            if not isinstance(item, list) or any(not isinstance(x, str) or len(x) > 1024 for x in item):
                raise ValueError(spec["label"] + " must be an explicit list of strings.")
        elif typ == "json":
            if not isinstance(item, (dict, list)):
                raise ValueError(spec["label"] + " must be a JSON object or array.")
        elif not isinstance(item, str) or len(item) > 1024 * 1024:
            raise ValueError(spec["label"] + " must be text of at most 1 MiB.")
        if typ == "select" and authoring and item not in spec["options"]:
            raise ValueError("Choose a listed value for " + spec["label"] + ".")
    if kind == "risk":
        for name in ("likelihood", "impact"):
            if value.get(name) not in (None, "") and not Decimal(1) <= decimal_value(value[name], name) <= Decimal(5):
                raise ValueError("Likelihood and impact use the disclosed 1–5 scale.")
        if value.get("control_effectiveness") not in (None, "") and not Decimal(0) <= decimal_value(value["control_effectiveness"], "Control effectiveness") <= Decimal(1):
            raise ValueError("Control effectiveness ranges from zero to one.")
    if kind == "management_action" and value.get("explicit_target_date") and not value.get("override_source"):
        raise ValueError("Record the source for an explicit action-plan date.")
    if kind == "evidence" and authoring and not value.get("engagement_id"):
        raise ValueError("Link evidence to the engagement whose access scope applies.")
    if existing_records is not None:
        by_id = {(r["kind"], r["id"]): r for r in existing_records}
        for name, target in RELATIONSHIPS.items():
            linked = value.get(name)
            if linked and (target, linked) not in by_id:
                raise ValueError("The linked " + target + " does not exist: " + str(linked))
        for name, target in LIST_RELATIONSHIPS.items():
            for linked in value.get(name, []) or []:
                if (target, linked) not in by_id:
                    raise ValueError("The linked evidence does not exist: " + str(linked))
        # Audit-child relationships cannot silently cross engagement boundaries.
        engaged = engagement_id({"kind": kind, "payload": value}, by_id)
        if kind == "observation" and value.get("sub_activity_id"):
            child = by_id[("sub_activity", value["sub_activity_id"])]
            if engaged != engagement_id(child, by_id):
                raise ValueError("The observation and control activity belong to different engagements.")
        if kind == "workpaper" and value.get("area_id"):
            if engaged != by_id[("audit_area", value["area_id"])]["payload"].get("engagement_id"):
                raise ValueError("The workpaper and area belong to different engagements.")
        for name in LIST_RELATIONSHIPS:
            for linked in value.get(name, []) or []:
                ev = by_id[("evidence", linked)]
                if engaged and ev["payload"].get("engagement_id") != engaged:
                    raise ValueError("Supporting evidence belongs to another engagement.")
    return value

def engagement_id(record, records, seen=None):
    seen = set() if seen is None else seen
    key = (record.get("kind"), record.get("id"))
    if key in seen:
        return None
    seen.add(key)
    if record.get("kind") == "engagement":
        return record.get("id")
    payload = record.get("payload", {})
    if payload.get("engagement_id"):
        return payload["engagement_id"]
    for name in ("area_id", "sub_activity_id", "observation_id", "action_id"):
        target = RELATIONSHIPS[name]
        parent = records.get((target, payload.get(name)))
        if parent:
            return engagement_id(parent, records, seen)
    return None

def add_months(value, months):
    value = iso_date(value) if isinstance(value, str) else value
    if value is None:
        return None
    index = value.year * 12 + value.month - 1 + months
    year, zero_month = divmod(index, 12)
    month = zero_month + 1
    return date(year, month, min(value.day, calendar.monthrange(year, month)[1]))

def risk_score(payload):
    if payload.get("likelihood") in (None, "") or payload.get("impact") in (None, ""):
        return {"inherent": None, "residual": None, "method": "Unscored; retain original source score."}
    inherent = decimal_value(payload["likelihood"], "Likelihood") * decimal_value(payload["impact"], "Impact")
    effectiveness = payload.get("control_effectiveness")
    residual = None if effectiveness in (None, "") else inherent * (Decimal(1) - decimal_value(effectiveness, "Control effectiveness"))
    return {"inherent": str(inherent), "residual": str(residual) if residual is not None else None,
            "method": "Operator planning scale: likelihood × impact; residual = inherent × (1 − control effectiveness).",
            "source_policy": False}

def current_review(record, records):
    wanted = fingerprint(record)
    candidates = [r for r in records if r["kind"] == "review_decision"
        and r["payload"].get("record_id") == record["id"]
        and r["payload"].get("record_type") == record["kind"]
        and r["payload"].get("input_hash") == wanted
        and r["payload"].get("record_revision") == record["revision"]]
    candidates.sort(key=lambda r: (r["updated_at"], r["id"]), reverse=True)
    return candidates[0] if candidates else None

def follow_up_queue(records, as_of=None):
    today = iso_date(as_of) if as_of else date.today()
    by_id = {(r["kind"], r["id"]): r for r in records}
    queue = []
    for action in records:
        if action["kind"] != "management_action":
            continue
        p = action["payload"]
        observation = by_id.get(("observation", p.get("observation_id")))
        if not observation:
            continue
        op = observation["payload"]
        eng = by_id.get(("engagement", op.get("engagement_id")))
        issue = p.get("issue_date") or (eng or {}).get("payload", {}).get("issue_date")
        priority = str(op.get("priority_normalized") or "").strip().lower()
        months = {"high": 6, "medium": 12}.get(priority)
        reference = add_months(issue, months) if issue and months else None
        explicit = iso_date(p.get("explicit_target_date"))
        target = explicit or reference
        reviews = sorted((r for r in records if r["kind"] == "follow_up_review" and r["payload"].get("action_id") == action["id"]),
                         key=lambda r: (r["payload"].get("review_date", ""), r["updated_at"]), reverse=True)
        verified = bool(p.get("verified_at") and p.get("verification_reference"))
        last = reviews[0] if reviews else None
        next_review = None
        if priority in {"high", "medium"} and not verified:
            if last and last["payload"].get("next_review_date"):
                next_review = iso_date(last["payload"]["next_review_date"])
            elif last:
                next_review = add_months(last["payload"]["review_date"], 6)
            elif issue:
                next_review = add_months(issue, 6)
        queue.append({
            "id": action["id"], "revision": action["revision"], "observation_id": observation["id"],
            "engagement_id": op.get("engagement_id"), "title": p.get("title") or op.get("title") or action["id"],
            "owner": p.get("responsible_party_reference"), "owner_unit": op.get("owner_unit"),
            "priority": op.get("priority_normalized"), "issue_date": issue,
            "reference_target_date": reference.isoformat() if reference else None,
            "explicit_target_date": explicit.isoformat() if explicit else None,
            "target_date": target.isoformat() if target else None, "override_source": p.get("override_source"),
            "unit_status": p.get("source_status"), "unit_completion_statement": p.get("unit_completion_statement"),
            "auditor_verified": verified, "verified_at": p.get("verified_at"),
            "routine_follow_up": priority in {"high", "medium"}, "priority_unresolved": priority not in {"high", "medium", "low"},
            "immediate_correction_or_interim_control": priority == "high" and not verified,
            "committee_review_due": bool(reference and today > reference and not verified),
            "completion_overdue": bool(target and today > target and not verified),
            "next_review_date": next_review.isoformat() if next_review else None,
            "follow_up_due": bool(next_review and today >= next_review and not verified),
            "last_review_id": last["id"] if last else None,
            "policy_sources": ["https://audits.umich.edu/the-audit-process/reporting-follow-up/",
                               "https://audits.umich.edu/uploads/reports-and-advisories-sample-report-9-2024.pdf"],
            "calculation_note": "Calendar months clamp to month end. Action-plan completion dates and original committee-age thresholds remain separate.",
        })
    return sorted(queue, key=lambda r: (not r["committee_review_due"], r["target_date"] or "9999-12-31", r["id"]))

def readiness(records):
    issues = []
    by_id = {(r["kind"], r["id"]): r for r in records}
    for record in records:
        p = record["payload"]
        if record["kind"] == "engagement":
            for key in ("scope_text", "objectives", "balanced_conclusion"):
                if not p.get(key):
                    issues.append({"id": record["id"], "kind": record["kind"], "field": key, "message": "Complete " + key.replace("_", " ") + "."})
        if record["kind"] == "observation":
            priority = str(p.get("priority_normalized") or "").lower()
            if priority not in {"high", "medium", "low"}:
                issues.append({"id": record["id"], "kind": record["kind"], "field": "priority_normalized", "message": "Priority needs review; an unknown priority is not Low."})
            if priority in {"high", "medium"} and not p.get("report_summary"):
                issues.append({"id": record["id"], "kind": record["kind"], "field": "report_summary", "message": "Add an approved summary before senior-report inclusion."})
        if record["kind"] == "workpaper" and not current_review(record, records):
            issues.append({"id": record["id"], "kind": record["kind"], "field": "review", "message": "This workpaper revision has no current recorded review."})
    return issues
