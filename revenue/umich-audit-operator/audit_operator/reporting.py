"""Reviewed audience projections for the portable audit operator.

This is an authored interchange/report design informed by public U-M process
documents. It is not an institution-approved access directory or vendor schema.
"""
from __future__ import annotations
import copy
import csv
import hashlib
import html
import io
import json
from collections import Counter

ROLE_ALIASES = {
    "auditor": "auditor", "unit_leadership": "unit_leadership",
    "executive": "executive", "it_leadership": "it_leadership",
    "medicine_it": "medicine_it", "michigan_medicine_it": "medicine_it",
    "board_regents": "board_regents", "regents": "board_regents",
    "faic": "faic", "management_advisory": "management_advisory",
}
SUMMARY_ROLES = {"executive", "it_leadership", "medicine_it", "board_regents", "faic"}

def _json(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False,
                      allow_nan=False).encode("utf-8")

def record_hash(record):
    return hashlib.sha256(_json(record)).hexdigest()

def _fields(payload, names):
    return {name: copy.deepcopy(payload[name]) for name in names if name in payload}

def _ids(value):
    if not isinstance(value, list) or any(not isinstance(x, str) or not x for x in value):
        raise ValueError("Audience and engagement selections must be arrays of nonempty IDs")
    return set(value)

def _has_content(value):
    return isinstance(value, str) and bool(value.strip())

def resolve_engagement(record_id, index, trail=None):
    trail = set() if trail is None else trail
    if record_id in trail:
        return None
    trail.add(record_id)
    record = index.get(record_id)
    if not record:
        return None
    if record["kind"] == "engagement":
        return record_id
    p = record["payload"]
    for key in ("engagement_id", "area_id", "sub_activity_id", "observation_id",
                "action_id", "workpaper_id", "record_id"):
        if p.get(key):
            answer = resolve_engagement(p[key], index, trail.copy())
            if answer:
                return answer
    return None

def _projection_record(record, payload, role):
    # Original identity is retained. A receiving operation can distinguish a
    # projection from a full record and must not overwrite fuller local content.
    result = {key: copy.deepcopy(record[key]) for key in
              ("kind", "id", "revision", "created_at", "updated_at") if key in record}
    source = record.get("source", {})
    result["source"] = {key: copy.deepcopy(source[key])
                        for key in ("namespace", "id", "revision") if key in source}
    result["source"]["locator"] = None
    result["payload"] = payload
    result["projection"] = {
        "audience_role": role,
        "source_record_sha256": record_hash(record),
        "source_revision": record.get("revision"),
        "omitted_payload_fields": sorted(set(record["payload"]) - set(payload)),
    }
    return result

def project_snapshot(snapshot, *, audience, selected_engagement_ids, review_reference):
    """Return a frozen audience projection plus complete omission accounting.

    Unit details require an explicit observation owner_unit match. Senior report
    text comes only from report_summary; missing summaries are labelled, never
    filled from details/plan_text. Advisory recipients and records are explicit.
    Blob custody is decided by exchange.build_handoff, never by filesystem paths.
    """
    if not isinstance(audience, dict):
        raise ValueError("audience must be an object")
    role = ROLE_ALIASES.get(audience.get("role"))
    if role is None:
        raise ValueError("Unsupported audience role")
    units = _ids(audience.get("unit_ids", []))
    if role == "unit_leadership" and not units:
        raise ValueError("Unit leadership requires explicitly selected unit_ids")
    if not isinstance(review_reference, (str, dict)) or not review_reference:
        raise ValueError("A retained review_reference is required for a handoff")
    records = snapshot.get("records", [])
    index = {r["id"]: r for r in records}
    all_engagements = {r["id"] for r in records if r["kind"] == "engagement"}
    selected = _ids(selected_engagement_ids)
    if not selected or not selected.issubset(all_engagements):
        raise ValueError("Select existing engagement IDs; empty or unknown selection is invalid")
    explicit = _ids(audience.get("selected_record_ids", []))
    recipient_units = _ids(audience.get("recipient_unit_ids", []))
    if role == "management_advisory":
        if not explicit or not recipient_units or not recipient_units.issubset(units):
            raise ValueError("Advisory requires selected_record_ids and recipient_unit_ids within authorized unit_ids")
        if not explicit.issubset(index):
            raise ValueError("Advisory selects an unknown record")
    allowed_engagements = set()
    reasons = {}
    for engagement_id in selected:
        p = index[engagement_id]["payload"]
        reason = None
        if role == "unit_leadership" and not units.intersection(p.get("unit_ids", [])):
            reason = "engagement_outside_selected_units"
        elif role in {"it_leadership", "medicine_it"} and p.get("is_it_audit") is not True:
            reason = "engagement_not_explicit_it_audit"
        elif role == "medicine_it" and p.get("is_michigan_medicine") is not True:
            reason = "engagement_not_explicit_michigan_medicine"
        if reason:
            reasons[engagement_id] = reason
        else:
            allowed_engagements.add(engagement_id)
    visible = {}
    def include(record, payload=None):
        visible[record["id"]] = (copy.deepcopy(record) if role == "auditor"
                                  else _projection_record(record, payload or {}, role))
    for record in records:
        rid, kind, p = record["id"], record["kind"], record["payload"]
        engagement_id = resolve_engagement(rid, index)
        if engagement_id not in allowed_engagements:
            reasons.setdefault(rid, "outside_selected_engagements")
            continue
        if role == "auditor":
            include(record)
            continue
        if kind == "engagement":
            names = ("title", "organizational_scope", "audit_type", "scope_text",
                     "objectives", "issue_date", "normalized_stage", "report_summary",
                     "balanced_conclusion", "conclusion_summary", "context_summary",
                     "is_it_audit", "is_michigan_medicine")
            payload = _fields(p, names)
            payload["unit_ids"] = (sorted(units.intersection(p.get("unit_ids", [])))
                                   if role in {"unit_leadership", "management_advisory"}
                                   else copy.deepcopy(p.get("unit_ids", [])))
            include(record, payload)
        elif kind == "audit_area":
            include(record, _fields(p, ("engagement_id", "parent_area_id", "label",
                                        "objective", "source_order", "report_summary")))
        elif kind == "sub_activity":
            include(record, _fields(p, ("area_id", "label", "raw_result_symbol",
                                        "normalized_result", "report_summary")))
        elif kind == "observation":
            priority = p.get("priority_normalized")
            if role == "unit_leadership":
                if p.get("owner_unit") not in units:
                    reasons[rid] = "observation_owner_unit_not_selected"
                    continue
                names = ("engagement_id", "sub_activity_id", "title", "details",
                         "priority_raw", "priority_normalized", "report_inclusion",
                         "owner_unit", "report_summary")
                include(record, _fields(p, names))
            elif role in SUMMARY_ROLES:
                if priority not in {"high", "medium"}:
                    reasons[rid] = ("low_excluded_from_senior_report" if priority == "low"
                                    else "unresolved_priority_requires_review")
                    continue
                if p.get("report_inclusion") is False:
                    reasons[rid] = "explicitly_excluded_from_audit_report"
                    continue
                payload = _fields(p, ("engagement_id", "sub_activity_id", "priority_normalized",
                                      "report_inclusion"))
                payload["report_summary"] = p.get("report_summary") if _has_content(p.get("report_summary")) else None
                payload["summary_status"] = "provided" if payload["report_summary"] else "missing_reviewed_summary"
                include(record, payload)
            else:
                reasons[rid] = "advisory_requires_explicit_memo_content"
        elif kind in {"risk", "workpaper"}:
            if (role == "unit_leadership" and p.get("owner_unit") in units
                    and p.get("classification") in {"unit_shared", "public"}):
                names = (("engagement_id", "area_id", "title", "description", "owner_unit",
                          "inherent_rating", "residual_rating", "controls", "classification")
                         if kind == "risk" else
                         ("engagement_id", "area_id", "sub_activity_id", "title", "purpose",
                          "procedure", "results", "conclusion", "owner_unit", "classification"))
                include(record, _fields(p, names))
            else:
                reasons[rid] = "working_material_auditor_only"
        elif kind == "advisory_memo":
            memo_units = set(p.get("recipient_unit_ids", []))
            if (role == "management_advisory" and rid in explicit
                    and recipient_units.issubset(memo_units)):
                include(record, _fields(p, ("engagement_id", "title", "body",
                                            "purpose", "issued_at", "source_revision")))
                visible[rid]["payload"]["recipient_unit_ids"] = sorted(recipient_units)
                visible[rid]["payload"]["source_record_references"] = (copy.deepcopy(p.get("source_record_references", []))
                    if record.get("projection") else [
                    {"id": ref, "sha256": record_hash(index[ref])}
                    for ref in p.get("record_ids", []) if ref in index
                ])
            else:
                reasons[rid] = "memo_recipient_and_record_selection_not_satisfied"
        else:
            reasons[rid] = "dependent_or_restricted_record"
    # Dependent records are selected only after observation scoping is complete.
    for record in records:
        rid, kind, p = record["id"], record["kind"], record["payload"]
        if role == "auditor" or rid in visible:
            continue
        if kind == "management_action" and p.get("observation_id") in visible:
            if role == "unit_leadership":
                include(record, _fields(p, ("observation_id", "plan_text",
                    "responsible_party_reference", "source_status", "issue_date",
                    "explicit_target_date", "reference_target_date", "override_source",
                    "unit_completion_statement", "verified_at", "verification_reference",
                    "report_summary")))
            elif role in SUMMARY_ROLES:
                payload = _fields(p, ("observation_id", "issue_date", "explicit_target_date",
                                       "reference_target_date", "verified_at"))
                payload["report_summary"] = p.get("report_summary") if _has_content(p.get("report_summary")) else None
                payload["summary_status"] = "provided" if payload["report_summary"] else "missing_reviewed_summary"
                payload["auditor_verified"] = (p.get("auditor_verified") if record.get("projection") and type(p.get("auditor_verified")) is bool
                                               else bool(p.get("verified_at") and p.get("verification_reference")))
                include(record, payload)
    for record in records:
        rid, kind, p = record["id"], record["kind"], record["payload"]
        if role == "auditor" or rid in visible:
            continue
        if kind == "follow_up_review" and p.get("action_id") in visible:
            if role == "unit_leadership":
                include(record, _fields(p, ("action_id", "review_date", "source_status",
                    "implementation_evidence", "auditor_verification", "next_review_date",
                    "memo_reference", "committee_review_flag")))
            elif role == "faic":
                include(record, _fields(p, ("action_id", "review_date", "next_review_date",
                                            "committee_review_flag", "verification_completed")))
        elif kind == "evidence" and role == "unit_leadership":
            # Even shared evidence is metadata-only by default. Unknown labels
            # and evidence without an explicit visible observation stay private.
            if (p.get("observation_id") in visible
                    and p.get("classification") in {"public", "unit_shared"}
                    and (p.get("classification") == "public" or p.get("owner_unit") in units)):
                include(record, _fields(p, ("engagement_id", "observation_id", "filename",
                                            "media_type", "sha256", "size", "classification")))
                visible[rid]["payload"]["content_available"] = False
    if role == "auditor":
        used_namespaces = {r["source"]["namespace"] for r in visible.values()}
        for record in records:
            p = record["payload"]
            if (record["kind"] == "source_mapping"
                    and (p.get("source_namespace") in used_namespaces
                         or record["source"]["namespace"] in used_namespaces)):
                include(record)
            elif record["kind"] == "review_decision" and p.get("record_id") in visible:
                include(record)
            elif record["kind"] == "questionnaire_response":
                include(record)
    omitted = [{"id": r["id"], "kind": r["kind"],
                "reason": reasons.get(r["id"], "not_selected_for_document")}
               for r in records if r["id"] not in visible]
    # Restricted source metadata intentionally contains no filenames, locators,
    # rows, mapping text, or evidence bytes for a non-auditor recipient.
    source_refs = [{"id": s["id"], "sha256": s["sha256"], "bytes": s["bytes"],
                    "content_available": False} for s in snapshot.get("sources", [])]
    projected = {
        "format": "commons-audit-snapshot/1",
        "workspace_id": snapshot["workspace_id"],
        "captured_at": snapshot.get("captured_at"),
        "records": [visible[k] for k in sorted(visible)],
        "sources": copy.deepcopy(snapshot.get("sources", [])) if role == "auditor" else [],
        "projection": {
            "format": "commons-audit-projection/1",
            "audience": {"role": role, "unit_ids": sorted(units),
                         **({"selected_record_ids": sorted(explicit),
                             "recipient_unit_ids": sorted(recipient_units)}
                            if role == "management_advisory" else {})},
            "selected_engagement_ids": sorted(selected),
            "source_selection_hash": hashlib.sha256(_json([
                {"id": r["id"], "revision": r["revision"], "sha256": record_hash(r)}
                for r in sorted(records, key=lambda x:x["id"])
                if resolve_engagement(r["id"], index) in selected
            ])).hexdigest(),
            "mapping_revisions": [
                {"id": r["id"], "revision": r["revision"], "sha256": record_hash(r)}
                for r in records if r["kind"] == "source_mapping"
            ],
            "review_reference": copy.deepcopy(review_reference),
            "omitted_records": omitted,
            "restricted_source_references": source_refs if role != "auditor" else [],
        },
    }
    if role == "auditor" and snapshot.get("revisions"):
        projected["revisions"] = [copy.deepcopy(r) for r in snapshot["revisions"]
                                  if r.get("id") in visible]
    return projected


def project_for_access(snapshot, *, audience, selected_engagement_ids=None):
    """Apply the same field scopes to a read-only authenticated local view.

    This is an access view, not a reviewed export. The host supplies the actual
    authenticated grant; callers cannot turn a UI role selector into authority.
    """
    role=ROLE_ALIASES.get(audience.get("role") if isinstance(audience,dict) else None)
    if role is None:
        raise ValueError("Unsupported audience role")
    engagements=[r["id"] for r in snapshot.get("records",[]) if r["kind"]=="engagement"]
    selected=engagements if selected_engagement_ids is None else selected_engagement_ids
    if not selected:
        if role=="auditor":
            result=copy.deepcopy(snapshot)
        else:
            result={"format":"commons-audit-snapshot/1","workspace_id":snapshot["workspace_id"],
                    "captured_at":snapshot.get("captured_at"),"records":[],"sources":[]}
        result["access_projection"]={"role":role,"reviewed_export":False}
        return result
    result=project_snapshot(snapshot,audience=audience,
        selected_engagement_ids=selected,
        review_reference={"purpose":"authenticated_read_only_view","reviewed_export":False})
    result["access_projection"]={"role":role,"reviewed_export":False}
    return result

def _display(value):
    if value is None or value == "":
        return "Not provided"
    if isinstance(value, (dict, list)):
        return json.dumps(value, ensure_ascii=False, sort_keys=True)
    return str(value)

def _cell(value):
    text = "" if value is None else _display(value)
    # Preserve original raw source bytes separately. These are human report CSVs.
    return "'" + text if text and (text[0] in "=+-@\t\r" or text.lstrip().startswith(("=", "+", "-", "@"))) else text

def _csv(headers, rows):
    stream = io.StringIO(newline="")
    writer = csv.writer(stream, lineterminator="\r\n")
    writer.writerow(headers)
    writer.writerows([_cell(v) for v in row] for row in rows)
    return stream.getvalue().encode("utf-8-sig")

def render_reports(projected):
    """Render HTML and complete tabular reports from already-projected records."""
    records = projected["records"]
    index = {r["id"]: r for r in records}
    role = projected["projection"]["audience"]["role"]
    summary = role in SUMMARY_ROLES
    engagements = sorted((r for r in records if r["kind"] == "engagement"),
                         key=lambda r: (_display(r["payload"].get("title")), r["id"]))
    observations = [r for r in records if r["kind"] == "observation"]
    actions = [r for r in records if r["kind"] == "management_action"]
    followups = [r for r in records if r["kind"] == "follow_up_review"]
    def esc(v):
        return html.escape(_display(v), quote=True)
    sections = []
    for engagement in engagements:
        p = engagement["payload"]
        parts = ["<section><h2>" + esc(p.get("title")) + "</h2>",
                 "<p class='identifier'>" + esc(engagement["id"]) + "</p>",
                 "<h3>Scope and objectives</h3><p>" + esc(p.get("scope_text")) + "</p><p>" + esc(p.get("objectives")) + "</p>",
                 "<h3>Balanced conclusion</h3><p>" + esc(p.get("balanced_conclusion") or p.get("conclusion_summary") or p.get("report_summary")) + "</p>"]
        areas = [r for r in records if r["kind"] == "audit_area" and r["payload"].get("engagement_id") == engagement["id"]]
        for area in sorted(areas, key=lambda r: (str(r["payload"].get("source_order", "")), r["id"])):
            parts += ["<h3>" + esc(area["payload"].get("label")) + "</h3>",
                      "<p>" + esc(area["payload"].get("objective")) + "</p>",
                      "<table><thead><tr><th>Sub-activity</th><th>Original result</th><th>Result meaning</th></tr></thead><tbody>"]
            for sub in records:
                if sub["kind"] == "sub_activity" and sub["payload"].get("area_id") == area["id"]:
                    sp = sub["payload"]
                    parts.append("<tr><td>" + esc(sp.get("label")) + "</td><td>" +
                                 esc(sp.get("raw_result_symbol")) + "</td><td>" +
                                 esc(sp.get("normalized_result")) + "</td></tr>")
            parts.append("</tbody></table>")
        scoped = [r for r in observations if resolve_engagement(r["id"], index) == engagement["id"]]
        parts.append("<h3>" + ("Observation summaries" if summary else "Observations") + "</h3>")
        if not scoped:
            parts.append("<p>No observations selected for this audience. This does not assert that the engagement has no findings.</p>")
        for obs in scoped:
            op = obs["payload"]
            text = op.get("report_summary") if summary else op.get("details")
            parts += ["<article><h4>" + esc(op.get("priority_normalized")) + " · " + esc(obs["id"]) + "</h4>",
                      "<p>" + esc(text if _has_content(text) else "Reviewed summary not provided" if summary else text) + "</p>"]
            for action in actions:
                if action["payload"].get("observation_id") == obs["id"]:
                    ap = action["payload"]
                    parts += ["<h5>Management action</h5><p>" +
                        esc(ap.get("report_summary") if summary else ap.get("plan_text")) + "</p>",
                        "<dl><dt>Explicit plan target</dt><dd>" + esc(ap.get("explicit_target_date")) +
                        "</dd><dt>Reference target</dt><dd>" + esc(ap.get("reference_target_date")) +
                        "</dd><dt>Auditor verification date</dt><dd>" + esc(ap.get("verified_at")) + "</dd></dl>"]
            parts.append("</article>")
        for memo in records:
            if memo["kind"] == "advisory_memo" and memo["payload"].get("engagement_id") == engagement["id"]:
                parts += ["<article><h3>Management advisory: " + esc(memo["payload"].get("title")) +
                          "</h3><p>" + esc(memo["payload"].get("body")) + "</p></article>"]
        parts.append("</section>")
        sections.append("".join(parts))
    if role == "faic":
        sections.append("<section><h2>Follow-up summary</h2><p>" +
                        esc(len(followups)) + " selected review records; " +
                        esc(sum(1 for r in followups if r["payload"].get("committee_review_flag") is True)) +
                        " explicitly marked for committee review.</p></section>")
    title = {"board_regents":"Periodic report summary", "faic":"Activity and follow-up summary",
             "management_advisory":"Selected management advisory", "unit_leadership":"Unit audit observation report"}.get(role, "Audit report")
    css = """body{font:15px/1.5 system-ui,sans-serif;color:#171717;background:white;max-width:1050px;margin:28px auto;padding:0 22px}
h1,h2,h3{line-height:1.2}section{border-top:1px solid #777;margin-top:28px;padding-top:16px}
article{border-left:3px solid #aaa;padding-left:16px;margin:18px 0}p,dd{white-space:pre-wrap;overflow-wrap:anywhere}
table{border-collapse:collapse;width:100%;margin:14px 0}th,td{border:1px solid #aaa;text-align:left;padding:8px;overflow-wrap:anywhere}
th{background:#eee}.identifier{font:12px monospace}dt{font-weight:600}dd{margin-left:0;margin-bottom:8px}
@media print{body{max-width:none;margin:0;font-size:10pt}section{break-before:auto}tr{break-inside:avoid}}
"""
    document = ("<!doctype html><html lang='en'><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'>"
                "<title>" + html.escape(title) + "</title><style>" + css + "</style><main><h1>" +
                html.escape(title) + "</h1><p>Audience: " + esc(role) + "</p><p>Review reference: " +
                esc(projected["projection"]["review_reference"]) + "</p>" + "".join(sections) +
                "<section><h2>Package scope</h2><p>" + esc(len(records)) + " projected records. " +
                esc(len(projected["projection"]["omitted_records"])) +
                " records excluded with explicit reasons in the package manifest.</p>"
                "<p>This document is a reviewed operator projection. Public U-M process and sample documents inform the design; it is not a university-approved report or vendor import certification.</p></section></main></html>")
    outputs = {"reports/report.html": document.encode("utf-8")}
    outputs["reports/observations.csv"] = _csv(
        ["record_id","engagement_id","priority","summary" if summary else "details","owner_unit"],
        [[r["id"],r["payload"].get("engagement_id"),r["payload"].get("priority_normalized"),
          r["payload"].get("report_summary" if summary else "details"),r["payload"].get("owner_unit")]
         for r in observations])
    outputs["reports/actions.csv"] = _csv(
        ["record_id","observation_id","summary" if summary else "plan_text","explicit_target_date",
         "reference_target_date","unit_completion_statement","auditor_verified_at"],
        [[r["id"],r["payload"].get("observation_id"),r["payload"].get("report_summary" if summary else "plan_text"),
          r["payload"].get("explicit_target_date"),r["payload"].get("reference_target_date"),
          None if summary else r["payload"].get("unit_completion_statement"),r["payload"].get("verified_at")]
         for r in actions])
    outputs["reports/subactivities.csv"] = _csv(
        ["record_id","area_id","label","raw_result_symbol","normalized_result"],
        [[r["id"],r["payload"].get("area_id"),r["payload"].get("label"),
          r["payload"].get("raw_result_symbol"),r["payload"].get("normalized_result")]
         for r in records if r["kind"] == "sub_activity"])
    outputs["reports/follow-up.csv"] = _csv(
        ["record_id","action_id","review_date","next_review_date","committee_review_flag",
         "source_status","implementation_evidence","auditor_verification"],
        [[r["id"],r["payload"].get("action_id"),r["payload"].get("review_date"),
          r["payload"].get("next_review_date"),r["payload"].get("committee_review_flag"),
          None if summary else r["payload"].get("source_status"),
          None if summary else r["payload"].get("implementation_evidence"),
          None if summary else r["payload"].get("auditor_verification")]
         for r in followups])
    return outputs
