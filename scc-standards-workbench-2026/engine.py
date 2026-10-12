"""Source-bound standards drafting, review and SCC delivery calculations.

Ordinary DGSI, national-accreditation and flexible PAS/TS/WA procedures are
distinct configured profiles. Calculations describe records; they do not confer
standards-body approval, contract acceptance, publication or certification.
"""
from __future__ import annotations

import calendar
import hashlib
import json
import re
from copy import deepcopy
from datetime import date, datetime, timezone, timedelta
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP

SCHEMA = "standards-drafting-delivery/v1"
INTERESTS = ["User", "Producer", "Government/Regulator", "General Interest"]
PHASES = ["1", "2", "3", "4"]
PHASE_NAMES = {"1": "Initiation", "2": "Content development / workshop awareness",
               "3": "Review and approval / workshop and WA draft", "4": "Publication and maintenance"}
CAPS = {"TS": "150000.00", "PAS": "140000.00", "WA": "85000.00", "CSG": None}
MAX_MONTHS = {"TS": 12, "PAS": 9, "WA": 6, "CSG": None}
ROADMAP_ISSUES = [1, 2, 4, 6, 13, 14, 18, 19, 20, 21, 22, 23, 24, 25, 28, 29, 31]
IMMUTABLE = {"editions", "ballots", "ballot_closures", "technical_decisions", "procedural_reviews", "phase_reports",
             "report_responses", "invoices", "invoice_responses", "payments", "language_reviews", "delivery_registers"}
OPTIONAL_COLLECTIONS = {"communications", "delivery_registers"}
SOURCE_FIELDS = ("source_ids", "evidence_ids", "substantiation_ids", "acceptance_source_ids")
F = lambda kind="text", default=None, **kw: {"kind": kind, "default": default, **kw}
T = lambda required=False, **kw: F("text", "", required=required, **kw)
E = lambda values, default=None: F("enum", values[0] if default is None else default, values=values)
L = lambda **kw: F("list", [], **kw)
J = lambda default=None: F("json", {} if default is None else default)
D = lambda: F("date", None)
R = lambda collection, required=False, **kw: F("reference", "", collection=collection, required=required, **kw)

FIELDS = {
 "scope": {
  "title_en": T(True), "title_fr": T(), "deliverable_type": E(["TS", "PAS", "WA", "CSG", "NSC"]),
  "purpose": T(True), "purpose_fr": T(), "audience": T(), "audience_fr": T(), "exclusions": T(), "exclusions_fr": T(),
  "preface_en": T(), "preface_fr": T(), "roadmap_issues": L(),
  "procedure_id": R("procedures"), "planned_start": D(), "planned_finish": D(),
  "new_work_status": E(["proposed", "phase_1", "phase_2_or_later"]),
  "national_international_relationship": T(), "source_ids": L(), "notes": T()},
 "sources": {
  "title": T(True), "url": T(), "publisher": T(), "version": T(), "language": E(["en", "fr", "bilingual", "other", "unspecified"]),
  "representation": E(["original_bytes", "web_extract", "authored_summary", "authored_example", "reference_link"]),
  "license": T(), "retrieved_at": T(), "source_file_id": T(), "sha256": T(),
  "public_redistribution": F("boolean", False), "citation_visibility": E(["internal", "public"]), "notes": T()},
 "references": {
  "identifier": T(True), "title": T(True), "owner": T(), "deliverable_type": T(), "stage": T(),
  "published_date": D(), "maintenance_date": D(), "source_period": T(),
  "relationship": E(["not_reviewed", "reference", "adopt", "complement", "overlap", "out_of_scope"]),
  "rationale": T(), "source_ids": L(), "source_locator": T(), "url": T()},
 "procedures": {
  "title": T(True), "applies_to": L(), "source_ids": L(), "source_locator": T(), "edition": T(True),
  "profile_status": E(["source_summary", "selected_by_operator"]),
  "participant_majority": E(["none", "strict_majority_of_eligible", "strict_majority_of_cast_including_abstentions"]),
  "affirmative_fraction": F("json", None), "affirmative_denominator": E(["yes_no", "yes_no_abstain", "unresolved"]),
  "negative_fraction_max": F("json", None), "negative_denominator": E(["yes_no", "yes_no_abstain", "unresolved"]),
  "exclude_unjustified_negative": F("boolean", False), "exclude_unjustified_abstention": F("boolean", False),
  "interest_balance": F("boolean", False), "public_review_days": F("integer", None),
  "public_review_requirement": E(["mandatory", "guidance", "not_specified"]),
  "require_peer_review": F("boolean", False), "require_workshop": F("boolean", False),
  "publish_within_months_of_workshop": F("integer", None),
  "urgent_review_days": F("integer", None), "require_comment_disposition": F("boolean", True),
  "require_negative_resolution": F("boolean", True), "require_independent_review": F("boolean", False),
  "require_sponsor_endorsement": F("boolean", False), "sponsor_endorsement": T(),
  "maintenance_months": F("integer", None), "maximum_extension_months": F("integer", None),
  "interpretation_source": T(), "notes": T()},
 "people": {
  "name": T(True), "organization": T(), "email": T(), "development_roles": L(),
  "authored_example": F("boolean", False), "notes": T()},
 "memberships": {
  "person_id": R("people", True), "role": E(["committee", "steering", "review_panel", "observer", "chair", "secretariat"]),
  "interest": E(INTERESTS), "voting": F("boolean", True), "begins": D(), "ends": D(),
  "status": E(["active", "withdrawn", "former"]), "source_ids": L(), "notes": T()},
 "clauses": {
  "number": T(True), "parent_id": R("clauses"), "kind": E(["normative", "informative", "annex", "table"]),
  "title_en": T(True), "body_en": T(), "title_fr": T(), "body_fr": T(),
  "table_en": J([]), "table_fr": J([]), "source_ids": L(), "case_ids": L(), "notes": T()},
 "cases": {
  "title": T(True), "title_fr": T(), "authored": F("boolean", True), "source_ids": L(), "source_rows": J([]),
  "review_questions": L(), "review_questions_fr": L(), "expected_observations": L(), "expected_observations_fr": L(), "notes": T()},
 "language_reviews": {
  "clause_id": R("clauses", True), "reviewer_id": R("people", True), "decision": E(["reviewed", "changes_required"]),
  "en_sha256": T(True), "fr_sha256": T(True), "recorded_at": T(True), "rationale": T(True), "source_ids": L()},
 "editions": {
  "label": T(True), "frozen_at": T(True), "contributor_ids": L(), "snapshot": J(),
  "sha256": T(True), "notes": T()},
 "consultations": {
  "title": T(True), "edition_id": R("editions", True), "procedure_id": R("procedures", True),
  "kind": E(["public", "final_call", "steering", "workshop"]), "opens": D(), "closes": D(),
  "urgent_exception": F("boolean", False), "exception_rationale": T(), "exception_source_ids": L(),
  "invitation_url": T(), "participant_ids": L(), "actual_closed": F("boolean", False), "source_ids": L()},
 "comments": {
  "edition_id": R("editions", True), "clause_id": T(), "consultation_id": R("consultations"),
  "author_id": R("people"), "author_label": T(), "kind": E(["technical", "editorial", "public", "negative_vote"]),
  "body": T(True), "source_id": R("sources"), "source_comment_id": T(), "source_locator": T(),
  "disposition": E(["open", "accepted", "rejected", "deferred"]), "rationale": T(),
  "resolution_edition_id": R("editions"), "resolution_clause_id": T(), "notification_at": T(),
  "notification_evidence": T(), "carried_from_id": R("comments"), "notes": T()},
 "ballots": {
  "title": T(True), "edition_id": R("editions", True), "opens": D(), "closes": D(),
  "method": E(["letter_ballot", "recorded_meeting", "online_poll"]), "consultation_ids": L(),
  "profile": J(), "roster": J([]), "source_procedure_id": T(True), "frozen_at": T(True),
  "snapshot_sha256": T(True), "sponsor_endorsement_source_ids": L(), "notes": T()},
 "votes": {
  "ballot_id": R("ballots", True), "person_id": R("people", True), "choice": E(["yes", "no", "abstain", "blank"]),
  "justification": T(), "cast_at": T(True), "source_ids": L(), "negative_resolution": T(),
  "notification_at": T(), "notification_evidence": T()},
 "ballot_closures": {
  "ballot_id": R("ballots", True), "recorded_at": T(True), "authority": T(True),
  "recorded_decision": E(["adopted", "returned_for_revision", "rejected", "recorded_only"]),
  "rationale": T(True), "input_snapshot": J(), "input_sha256": T(True), "calculation": J(), "source_ids": L()},
 "technical_decisions": {
  "edition_id": R("editions", True), "procedure_id": R("procedures", True),
  "method": E(["peer_review", "workshop_agreement", "community_moderation", "other_recorded_method"]),
  "consultation_ids": L(), "decision": E(["adopted", "returned_for_revision", "rejected", "recorded_only"]),
  "authority": T(True), "rationale": T(True), "recorded_at": T(True), "source_ids": L(),
  "input_snapshot": J(), "input_sha256": T(True)},
 "procedural_reviews": {
  "closure_id": R("ballot_closures", True), "reviewer_id": R("people", True),
  "independence_declared": F("boolean", False), "appointment_source_ids": L(),
  "decision": E(["confirmed", "changes_required"]), "recorded_at": T(True), "rationale": T(True),
  "reviewed_input_sha256": T(True), "independence_snapshot": J(), "source_ids": L()},
 "publications": {
  "edition_id": R("editions", True), "closure_id": R("ballot_closures"), "technical_decision_id": R("technical_decisions"), "procedural_review_id": R("procedural_reviews"),
  "version": T(True), "status": E(["prepared", "released", "withdrawn"]), "issued": D(),
  "url_en": T(), "url_fr": T(), "authority": T(), "authority_source_ids": L(),
  "access": E(["planned", "no_cost_lifecycle", "no_fee_canadian_three_years", "other"]),
  "license_notice": T(), "scc_acknowledgment": T(), "maintenance_due": D(), "notes": T()},
 "maintenance": {
  "publication_id": R("publications", True), "kind": E(["review", "correction", "amendment", "reaffirmation", "revision", "withdrawal"]),
  "title": T(True), "due": D(), "status": E(["planned", "in_progress", "recorded"]),
  "rationale": T(), "successor_edition_id": R("editions"), "authority": T(), "notification": T(), "source_ids": L()},
 "ola_events": {
  "title": T(True), "date": D(), "kind": E(["invitation", "meeting", "workshop", "publication"]),
  "active_offer_en": T(), "active_offer_fr": T(), "materials_en_source_ids": L(), "materials_fr_source_ids": L(),
  "requests": T(), "services_provided": T(), "unresolved_requests": T(), "source_ids": L()},
 "funding": {
  "title": T(True), "status": E(["proposed", "signed", "amended"]), "signed_on": D(), "start": D(), "finish": D(),
  "base_cad": F("money", "0.00"), "ola_cad": F("money", "0.00"),
  "phase_amounts": J({"1": "0.00", "2": "0.00", "3": "0.00", "4": "0.00"}),
  "agreement_source_ids": L(), "notes": T()},
 "tasks": {
  "title": T(True), "phase": E(PHASES), "owner": T(), "starts": D(), "due": D(),
  "dependencies": L(), "status": E(["planned", "in_progress", "delivered", "cancelled"]),
  "estimated_hours": F("decimal", "0"), "source_ids": L(), "notes": T()},
 "deliverables": {
  "title": T(True), "phase": E(PHASES),
  "kind": E(["orientation", "schedule", "domain_research", "gender_responsiveness", "public_review", "draft_standard",
             "media_plan", "bilingual_final", "phase_report", "progress_report", "other"]),
  "due": D(), "status": E(["draft", "submitted", "accepted"]), "submitted_at": T(), "accepted_at": T(),
  "source_ids": L(), "acceptance_source_ids": L(), "notes": T()},
 "costs": {
  "title": T(True), "phase": E(PHASES), "category": E(["base", "ola"]),
  "basis": E(["estimate", "actual"]), "incurred": D(), "net_cad": F("money", "0.00"),
  "hst_cad": F("money", "0.00"), "quantity": F("decimal", None), "unit_rate_cad": F("decimal", None),
  "external_reference": T(), "substantiation_ids": L(), "notes": T()},
 "phase_reports": {
  "phase": E(PHASES), "title": T(True), "through": D(), "summary": T(True), "recorded_at": T(True),
  "submitted_at": T(), "input_snapshot": J(), "input_sha256": T(True), "source_ids": L()},
 "report_responses": {
  "report_id": R("phase_reports", True), "decision": E(["accepted", "changes_requested", "rejected"]),
  "date": D(), "authority": T(True), "rationale": T(True), "evidence_ids": L(), "report_sha256": T(True), "recorded_at": T(True)},
 "invoices": {
  "number": T(True), "phase": E(PHASES), "report_id": R("phase_reports", True),
  "response_id": R("report_responses", True), "issued": D(), "allocations": J([]),
  "net_cad": F("money", "0.00"), "hst_cad": F("money", "0.00"), "total_cad": F("money", "0.00"),
  "prepared_at": T(True), "terms": T(), "input_snapshot": J(), "input_sha256": T(True)},
 "invoice_responses": {
  "invoice_id": R("invoices", True), "status": E(["submitted", "accepted", "queried", "void"]),
  "date": D(), "authority": T(True), "rationale": T(True), "evidence_ids": L(), "recorded_at": T(True)},
 "payments": {
  "invoice_id": R("invoices", True), "kind": E(["receipt", "refund"]), "amount_cad": F("money", "0.00"),
  "date": D(), "external_reference": T(True), "evidence_ids": L(), "recorded_at": T(True), "notes": T()},
 "changes": {
  "title": T(True), "kind": E(["minor", "major"]), "rationale": T(True),
  "proposed_on": D(), "original_due": D(), "new_due": D(), "base_change_cad": F("signed_money", "0.00"),
  "ola_change_cad": F("signed_money", "0.00"), "term_extension": F("boolean", False),
  "decision": E(["proposed", "submitted", "accepted", "rejected"]), "decision_date": D(),
  "authority": T(), "agreement_source_ids": L(), "notes": T()},
 "uptake": {
  "publication_id": R("publications", True), "period_start": D(), "period_end": D(),
  "measure": E(["downloads", "page_views", "adoptions"]), "language": E(["en", "fr", "other", "unspecified"]),
  "geography": E(["canada", "outside_canada", "unknown"]), "count": F("integer", 0),
  "counting_definition": T(True), "source_ids": L(), "notes": T()},
 "communications": {
  "title": T(True), "phase": E(PHASES),
  "kind": E(["announcement", "media_plan", "public_review_link", "mandatory_procedural_notice", "other_public"]),
  "edition_id": R("editions"), "consultation_id": R("consultations"), "content_source_ids": L(),
  "submitted_to_scc_on": D(), "planned_publication": D(), "published_on": D(), "target_url": T(), "recipient": T(),
  "submission_source_ids": L(), "scc_response": E(["not_recorded", "acknowledged", "approved", "changes_requested"]),
  "response_on": D(), "response_source_ids": L(), "mandatory_notice_exception": F("boolean", False),
  "exception_rationale": T(), "exception_source_ids": L(), "excluded_business_dates": L(),
  "calendar_status": E(["weekdays_only_estimate", "selected_calendar"]), "calendar_basis": T(), "calendar_source_ids": L(),
  "source_ids": L(), "notes": T()},
 "delivery_registers": {
  "title": T(True), "recorded_at": T(True), "authority": T(True), "rationale": T(True),
  "scope_deliverable_ids": L(), "scope_confirmed": F("boolean", False),
  "final_invoice_register_confirmed": F("boolean", False), "scope_snapshot": J([]), "invoice_snapshot": J([]),
  "snapshot_sha256": T(True), "source_ids": L()},
 "disclosures": {
  "person_id": R("people"), "kind": E(["interest", "patent", "technical_complaint", "procedural_complaint"]),
  "title": T(True), "description": T(True), "response": T(), "withdrawal_recorded": F("boolean", False), "source_ids": L()}
}
COLLECTIONS = tuple(FIELDS)

def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False)

def digest(value):
    return hashlib.sha256(canonical(value).encode()).hexdigest()

def now():
    return datetime.now(timezone.utc).isoformat(timespec="microseconds")

def text(value, label, required=False, limit=120000):
    if value is None and not required:
        return ""
    if not isinstance(value, str) or len(value) > limit or "\x00" in value or (required and not value.strip()):
        raise ValueError(f"{label} must be {'nonempty ' if required else ''}text of at most {limit} characters.")
    return value

def identity(value, label="Record ID"):
    if not isinstance(value, str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}", value):
        raise ValueError(f"{label} must contain 1–160 letters, digits, dot, colon, underscore or hyphen.")
    return value

def dec(value, label, negative=False, nullable=False):
    if value is None and nullable:
        return None
    if isinstance(value, bool) or isinstance(value, (dict, list)):
        raise ValueError(label + " must be a finite decimal.")
    try:
        result = Decimal(str(value))
    except (InvalidOperation, ValueError) as exc:
        raise ValueError(label + " must be a finite decimal.") from exc
    if not result.is_finite() or result.adjusted() > 18 or (not negative and result < 0):
        raise ValueError(label + " must be finite, within 19 digits, and nonnegative unless stated otherwise.")
    return result

def money(value, label="CAD amount", negative=False):
    amount = dec(value, label, negative)
    if amount != amount.quantize(Decimal(".01")):
        raise ValueError(label + " must use exact cents (at most two decimal places).")
    return format(amount, ".2f")

def day(value, label, nullable=True):
    if value in (None, "") and nullable:
        return None
    try:
        if not isinstance(value, str) or len(value) != 10 or date.fromisoformat(value).isoformat() != value:
            raise ValueError()
    except ValueError as exc:
        raise ValueError(label + " must be a YYYY-MM-DD calendar date.") from exc
    return value

def instant(value, label, required=False):
    value = text(value, label, required, 100)
    if value:
        try:
            parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
            if parsed.tzinfo is None:
                raise ValueError()
        except ValueError as exc:
            raise ValueError(label + " must include an explicit timezone.") from exc
    return value

def record(state, collection, record_id):
    result = next((r for r in state.get(collection, []) if r["id"] == record_id), None)
    if result is None:
        raise ValueError(f"Unknown {collection} record: {record_id}")
    return result

def single(state, collection):
    return state[collection][0] if state[collection] else None

def template(collection):
    return {name: deepcopy(spec["default"]) for name, spec in FIELDS[collection].items()}

def initial_state(title, project_id, mode="working"):
    return {"schema": SCHEMA, "id": identity(project_id), "title": text(title, "Project title", True, 300),
            "mode": mode, **{name: [] for name in COLLECTIONS}}

def schema():
    return {"schema": SCHEMA, "collections": deepcopy(FIELDS), "immutable": sorted(IMMUTABLE),
            "interests": INTERESTS, "phases": PHASE_NAMES, "funding_caps_cad": CAPS,
            "maximum_months": MAX_MONTHS, "roadmap_issues": ROADMAP_ISSUES,
            "description": "Recorded standards decisions and SCC delivery workpapers; no certification function."}

def _fraction(value, label):
    if value is None:
        return None
    if not isinstance(value, dict) or set(value) != {"numerator", "denominator"}:
        raise ValueError(label + " needs numerator and denominator.")
    n, d = value["numerator"], value["denominator"]
    if type(n) is not int or type(d) is not int or not 0 <= n <= d or not 1 <= d <= 100000:
        raise ValueError(label + " needs an exact nonnegative fraction no greater than one.")
    return {"numerator": n, "denominator": d}

def validate_record(collection, value, state=None):
    if collection not in FIELDS or not isinstance(value, dict):
        raise ValueError("Choose a supported collection and an object record.")
    if set(value) - set(FIELDS[collection]) - {"id", "revision"}:
        raise ValueError("Unsupported record fields: " + ", ".join(sorted(set(value) - set(FIELDS[collection]) - {"id", "revision"})))
    result = {"id": identity(value.get("id")), "revision": value.get("revision", 1)}
    if type(result["revision"]) is not int or result["revision"] < 1:
        raise ValueError("Record revision must be a positive integer.")
    for name, spec in FIELDS[collection].items():
        v = deepcopy(value.get(name, spec["default"]))
        label = collection + "." + name
        kind = spec["kind"]
        if kind in ("text", "reference"):
            v = text(v, label, spec.get("required", False))
            if kind == "reference" and v:
                identity(v, label)
                if state is not None:
                    record(state, spec["collection"], v)
        elif kind == "enum":
            if v not in spec["values"]:
                raise ValueError(label + " must be one of " + ", ".join(spec["values"]))
        elif kind == "date":
            v = day(v, label)
        elif kind in ("money", "signed_money"):
            v = money(v, label, kind == "signed_money")
        elif kind == "decimal":
            n = dec(v, label, nullable=spec["default"] is None)
            v = None if n is None else format(n, "f")
        elif kind == "integer":
            if v is None and spec["default"] is None:
                pass
            elif type(v) is not int or not 0 <= v <= 1000000000:
                raise ValueError(label + " must be a nonnegative integer.")
        elif kind == "boolean":
            if type(v) is not bool:
                raise ValueError(label + " must be true or false.")
        elif kind == "list":
            if not isinstance(v, list) or len(v) > 10000 or any(isinstance(x, (dict, list)) or x is None for x in v):
                raise ValueError(label + " must be a bounded list of scalar values.")
            if len({canonical(x) for x in v}) != len(v):
                raise ValueError(label + " repeats a value.")
        elif kind == "json":
            canonical(v)
        result[name] = v
    for field in SOURCE_FIELDS + ("authority_source_ids", "agreement_source_ids", "appointment_source_ids",
                                  "exception_source_ids", "sponsor_endorsement_source_ids",
                                  "materials_en_source_ids", "materials_fr_source_ids", "content_source_ids",
                                  "submission_source_ids", "response_source_ids", "calendar_source_ids"):
        if field in result and state is not None:
            for source_id in result[field]:
                record(state, "sources", source_id)
    for field in ("recorded_at", "cast_at", "frozen_at", "prepared_at", "submitted_at", "accepted_at", "notification_at"):
        if field in result:
            instant(result[field], collection + "." + field, FIELDS[collection][field].get("required", False))
    for lo, hi in (("opens", "closes"), ("begins", "ends"), ("planned_start", "planned_finish"), ("start", "finish"), ("starts", "due"), ("period_start", "period_end")):
        if result.get(lo) and result.get(hi) and result[lo] > result[hi]:
            raise ValueError(f"{collection}: {hi} cannot be before {lo}.")
    if collection == "scope":
        if any(type(x) is not int or x not in ROADMAP_ISSUES for x in result["roadmap_issues"]):
            raise ValueError("Use the SCC call's exact eligible Roadmap issue numbers.")
    elif collection == "procedures":
        for name in ("affirmative_fraction", "negative_fraction_max"):
            result[name] = _fraction(result[name], name)
        if any(x not in ("TS", "PAS", "WA", "CSG", "NSC") for x in result["applies_to"]):
            raise ValueError("Procedure applies_to must name explicit standards-solution types.")
        if not result["source_ids"] and not result["interpretation_source"].strip():
            raise ValueError("A procedural profile needs a retained source or explicit source/interpretation reference.")
    elif collection == "clauses":
        if result["parent_id"] == result["id"]:
            raise ValueError("A clause cannot be its own parent.")
        for field in ("table_en", "table_fr"):
            table = result[field]
            if not isinstance(table, list) or len(table) > 2000 or any(not isinstance(row, list) or len(row) > 100 or any(not isinstance(cell, str) for cell in row) for row in table):
                raise ValueError("Clause tables are arrays of rows of text cells, preserving language-specific structure.")
        if state is not None:
            for case_id in result["case_ids"]:
                record(state, "cases", case_id)
    elif collection == "comments":
        if state is not None:
            edition = record(state, "editions", result["edition_id"])
            clause_ids = {row["id"] for row in edition["snapshot"]["clauses"]}
            if result["clause_id"] and result["clause_id"] not in clause_ids:
                raise ValueError("Comment clause must exist in the exact reviewed edition.")
            if result["consultation_id"] and record(state, "consultations", result["consultation_id"])["edition_id"] != result["edition_id"]:
                raise ValueError("Comment consultation and reviewed edition differ.")
            if result["resolution_clause_id"]:
                if not result["resolution_edition_id"] or result["resolution_clause_id"] not in {x["id"] for x in record(state, "editions", result["resolution_edition_id"])["snapshot"]["clauses"]}:
                    raise ValueError("Resolution clause must exist in its explicitly selected resolution edition.")
        if result["disposition"] != "open" and not result["rationale"].strip():
            raise ValueError("A disposition needs its substantive response/rationale.")
        if result["notification_at"] and not result["notification_evidence"].strip():
            raise ValueError("A notification date needs its delivery reference; drafting a response is separate.")
    elif collection == "publications":
        if result["closure_id"] and result["technical_decision_id"]:
            raise ValueError("Select the ballot closure or the flexible technical decision for this publication, not both.")
        if state is not None:
            for field,collection_name in (("closure_id","ballot_closures"),("technical_decision_id","technical_decisions")):
                if result[field]:
                    decision=record(state,collection_name,result[field])
                    selected_edition=decision["edition_id"] if collection_name=="technical_decisions" else record(state,"ballots",decision["ballot_id"])["edition_id"]
                    if selected_edition!=result["edition_id"]:
                        raise ValueError("Publication and selected approval record identify different frozen editions.")
    elif collection == "votes" and state is not None:
        ballot = record(state, "ballots", result["ballot_id"])
        if result["person_id"] not in {r["person_id"] for r in ballot["roster"] if r["voting"]}:
            raise ValueError("This voter is not eligible in the frozen ballot roster.")
        cast = datetime.fromisoformat(result["cast_at"].replace("Z", "+00:00")).date().isoformat()
        if cast < ballot["opens"] or cast > ballot["closes"]:
            raise ValueError("Vote date is outside the recorded ballot period.")
        if result["notification_at"] and not result["notification_evidence"].strip():
            raise ValueError("Voter notification needs a delivery reference.")
    elif collection == "funding":
        if not isinstance(result["phase_amounts"], dict) or set(result["phase_amounts"]) != set(PHASES):
            raise ValueError("Funding needs four explicit phase amounts.")
        result["phase_amounts"] = {p: money(result["phase_amounts"][p], "Phase " + p) for p in PHASES}
        if sum(Decimal(x) for x in result["phase_amounts"].values()) != Decimal(result["base_cad"]):
            raise ValueError("The four base phase amounts must sum to the stated base amount; OLA is separate.")
        if result["status"] != "proposed" and (not result["signed_on"] or not result["agreement_source_ids"]):
            raise ValueError("A recorded signed/amended agreement needs its date and actual agreement source.")
    elif collection == "costs":
        q, rate = result["quantity"], result["unit_rate_cad"]
        if (q is None) != (rate is None):
            raise ValueError("Provide both quantity and rate, or neither.")
        if q is not None and (Decimal(q) * Decimal(rate)).quantize(Decimal(".01"), rounding=ROUND_HALF_UP) != Decimal(result["net_cad"]):
            raise ValueError("The supplied net amount differs from quantity × unit rate, rounded once to cents.")
    elif collection == "tasks" and state is not None:
        if result["id"] in result["dependencies"]:
            raise ValueError("A task cannot depend on itself.")
        for task_id in result["dependencies"]:
            record(state, "tasks", task_id)
    elif collection == "changes":
        major = Decimal(result["base_change_cad"]) != 0 or Decimal(result["ola_change_cad"]) != 0 or result["term_extension"]
        if major and result["kind"] != "major":
            raise ValueError("A budget change or term extension must be recorded as a major amendment request.")
        if result["decision"] == "accepted" and (not result["decision_date"] or not result["authority"] or not result["agreement_source_ids"]):
            raise ValueError("An accepted change needs the actual authority/date and acceptance or amendment source.")
    elif collection == "communications":
        result["excluded_business_dates"] = [day(v, "Excluded business date", False) for v in result["excluded_business_dates"]]
        if result["calendar_status"] == "selected_calendar" and (not result["calendar_basis"].strip() or not result["calendar_source_ids"]):
            raise ValueError("A selected business-day calendar needs its actual basis and retained calendar source.")
        if result["mandatory_notice_exception"] and (result["kind"] != "mandatory_procedural_notice" or not result["exception_rationale"].strip() or not result["exception_source_ids"]):
            raise ValueError("The communication exception concerns an actual mandatory accredited-process notice and needs its source basis.")
        if result["scc_response"] != "not_recorded" and (not result["response_on"] or not result["response_source_ids"]):
            raise ValueError("A recorded SCC communication response needs its date and retained source.")
        if result["kind"] == "public_review_link" and (not result["consultation_id"] or not result["target_url"].strip()):
            raise ValueError("A public-review link dispatch needs the exact consultation and link.")
        if state is not None and result["consultation_id"] and result["edition_id"] and record(state, "consultations", result["consultation_id"])["edition_id"] != result["edition_id"]:
            raise ValueError("The communication and consultation identify different editions.")
    elif collection == "delivery_registers":
        if (result["scope_confirmed"] or result["final_invoice_register_confirmed"]) and not result["source_ids"]:
            raise ValueError("A confirmed scope or final invoice register needs its actual governing source.")
        if result["scope_confirmed"] and not result["scope_deliverable_ids"]:
            raise ValueError("Select the deliverables covered by the confirmed scope.")
        if state is not None:
            for value in result["scope_deliverable_ids"]:record(state,"deliverables",value)
        if not isinstance(result["scope_snapshot"],list) or not isinstance(result["invoice_snapshot"],list):
            raise ValueError("Delivery register snapshots must be record lists.")
        if digest({"scope":result["scope_snapshot"],"invoices":result["invoice_snapshot"]}) != result["snapshot_sha256"]:
            raise ValueError("The retained delivery register digest differs.")
    elif collection == "report_responses" and result["decision"] == "accepted":
        if not result["evidence_ids"] or not result["date"]:
            raise ValueError("Record SCC's actual report acceptance date and evidence.")
    elif collection in ("invoice_responses", "payments"):
        if not result["evidence_ids"] or not result["date"]:
            raise ValueError("Actual invoice status/payment records need their date and retained evidence.")
    return result

def language_part(clause, language):
    return {key: clause[key + "_" + language] for key in ("title", "body", "table")}

def language_status(state, clause):
    en, fr = digest(language_part(clause, "en")), digest(language_part(clause, "fr"))
    candidates = [r for r in state["language_reviews"] if r["clause_id"] == clause["id"] and r["en_sha256"] == en and r["fr_sha256"] == fr]
    latest = sorted(candidates, key=lambda r: (r["recorded_at"], r["id"]))[-1] if candidates else None
    return {"clause_id": clause["id"], "en_sha256": en, "fr_sha256": fr,
            "french_present": bool(clause["title_fr"].strip() and (clause["body_fr"].strip() or clause["table_fr"])),
            "review_status": latest["decision"] if latest else "not_reviewed_at_current_text",
            "review_id": latest["id"] if latest else None}

def ordered_clauses(state):
    # Natural numeric ordering preserves 2 before 10 without losing literal labels.
    def key(row):
        return tuple((0, int(x)) if x.isdigit() else (1, x.casefold()) for x in re.split(r"(\d+)", row["number"]))
    return sorted(state["clauses"], key=lambda row: (key(row), row["id"]))

def edition_snapshot(state):
    used = set()
    for collection in ("scope", "clauses", "references", "cases"):
        for item in state[collection]:
            used.update(item.get("source_ids", []))
    clauses = ordered_clauses(state)
    return {"scope": deepcopy(single(state, "scope")), "clauses": deepcopy(clauses),
            "references": deepcopy(sorted(state["references"], key=lambda r: r["id"])),
            "cases": deepcopy(sorted(state["cases"], key=lambda r: r["id"])),
            "sources": deepcopy(sorted((r for r in state["sources"] if r["id"] in used), key=lambda r: r["id"])),
            "language_reviews": [language_status(state, r) for r in clauses]}

def freeze_edition(state, payload, record_id):
    if not state["clauses"] or not single(state, "scope"):
        raise ValueError("Create the scope and at least one usable clause before freezing an edition.")
    contributors = payload.get("contributor_ids", [])
    for person_id in contributors:
        record(state, "people", person_id)
    snap = edition_snapshot(state)
    return validate_record("editions", {"id": record_id, "label": payload.get("label"), "frozen_at": now(),
            "contributor_ids": contributors, "snapshot": snap, "sha256": digest(snap), "notes": payload.get("notes", "")}, state)

def compare_editions(left, right):
    a, b = {r["id"]: r for r in left["clauses"]}, {r["id"]: r for r in right["clauses"]}
    changes = []
    for key in sorted(set(a) | set(b)):
        if key not in a:
            changes.append({"clause_id": key, "kind": "added", "after": b[key]})
        elif key not in b:
            changes.append({"clause_id": key, "kind": "removed", "before": a[key]})
        elif canonical(a[key]) != canonical(b[key]):
            fields = [name for name in FIELDS["clauses"] if canonical(a[key].get(name)) != canonical(b[key].get(name))]
            changes.append({"clause_id": key, "kind": "changed", "fields": fields, "before": a[key], "after": b[key]})
    return {"clauses": changes, "scope_changed": canonical(left.get("scope")) != canonical(right.get("scope")),
            "references_changed": canonical(left.get("references")) != canonical(right.get("references")),
            "source_versions_changed": canonical(left.get("sources")) != canonical(right.get("sources")),
            "cases_changed": canonical(left.get("cases")) != canonical(right.get("cases")),
            "language_reviews_changed": canonical(left.get("language_reviews")) != canonical(right.get("language_reviews"))}

def roster_at(state, at, membership_ids=None):
    rows = state["memberships"] if membership_ids is None else [record(state, "memberships", x) for x in membership_ids]
    selected = []
    for row in rows:
        if row["status"] != "active" or (row["begins"] and row["begins"] > at) or (row["ends"] and row["ends"] < at):
            if membership_ids is not None:
                raise ValueError("A selected member was not active at the ballot opening date.")
            continue
        person = record(state, "people", row["person_id"])
        selected.append({**deepcopy(row), "membership_id": row["id"], "person_name": person["name"],
                         "organization": person["organization"], "authored_example": person["authored_example"]})
    voters = [r["person_id"] for r in selected if r["voting"]]
    if len(set(voters)) != len(voters):
        raise ValueError("One person has multiple active voting memberships; resolve the exact voting roster.")
    return sorted(selected, key=lambda r: (r["person_id"], r["membership_id"]))

def balance(roster):
    voters = [r for r in roster if r["voting"]]
    counts = {interest: sum(r["interest"] == interest for r in voters) for interest in INTERESTS}
    total = len(voters)
    return {"eligible": total, "categories": counts, "balanced": bool(total) and all(2*n < total for n in counts.values()),
            "rule": "Each category is strictly smaller than all other categories combined."}

def freeze_ballot(state, payload, record_id):
    edition = record(state, "editions", payload.get("edition_id"))
    profile = record(state, "procedures", payload.get("procedure_id"))
    scope = edition["snapshot"]["scope"]
    if scope and scope["deliverable_type"] not in profile["applies_to"]:
        raise ValueError("Choose a procedure explicitly applicable to this edition's deliverable type.")
    opens, closes = day(payload.get("opens"), "Opening date", False), day(payload.get("closes"), "Closing date", False)
    if closes < opens:
        raise ValueError("Ballot closing date is before opening.")
    roster = roster_at(state, opens, payload.get("membership_ids"))
    if not any(r["voting"] for r in roster):
        raise ValueError("A ballot needs an actual explicitly eligible roster.")
    consultations = payload.get("consultation_ids", [])
    for c in consultations:
        if record(state, "consultations", c)["edition_id"] != edition["id"]:
            raise ValueError("Selected consultations must concern this exact edition.")
    snap = {"edition_sha256": edition["sha256"], "roster": roster, "profile": profile}
    return validate_record("ballots", {"id": record_id, "title": payload.get("title"), "edition_id": edition["id"],
        "opens": opens, "closes": closes, "method": payload.get("method", "letter_ballot"),
        "consultation_ids": consultations, "profile": deepcopy(profile), "roster": roster,
        "source_procedure_id": profile["id"], "frozen_at": now(), "snapshot_sha256": digest(snap),
        "sponsor_endorsement_source_ids": payload.get("sponsor_endorsement_source_ids", []), "notes": payload.get("notes", "")}, state)

def consultation_report(consultation, profile):
    elapsed = (date.fromisoformat(consultation["closes"]) - date.fromisoformat(consultation["opens"])).days if consultation["opens"] and consultation["closes"] else None
    urgent = consultation["urgent_exception"]
    minimum = profile["urgent_review_days"] if urgent else profile["public_review_days"]
    exception_valid = not urgent or bool(consultation["exception_rationale"].strip() and consultation["exception_source_ids"] and minimum is not None)
    return {"id": consultation["id"], "edition_id": consultation["edition_id"], "elapsed_days": elapsed,
            "minimum_days": minimum, "requirement": profile["public_review_requirement"], "duration_satisfied": None if minimum is None or elapsed is None else elapsed >= minimum and exception_valid,
            "urgent_exception_supported": exception_valid, "actual_closed": consultation["actual_closed"]}

def public_review_criteria(consultations,profile):
    """Apply only the explicitly selected public-review requirement to public records."""
    if profile["public_review_requirement"]!="mandatory":
        return []
    public=[consultation_report(c,profile) for c in consultations if c["kind"]=="public"]
    criteria=[{"code":"public_consultation_completed","satisfied":bool(public) and all(r["actual_closed"] for r in public),
               "consultation_ids":[r["id"] for r in public],"minimum_days":profile["public_review_days"]}]
    if profile["public_review_days"] is not None:
        criteria.append({"code":"consultation_period","satisfied":bool(public) and all(r["duration_satisfied"] is True for r in public),
                         "minimum_days":profile["public_review_days"]})
    elif any(not r["urgent_exception_supported"] for r in public):
        criteria.append({"code":"consultation_exception","satisfied":False,
                         "reason":"An urgent exception needs its own selected period and retained authority."})
    # No numerical minimum is fabricated when the source requires public review
    # without specifying a duration. Raw elapsed/minimum values remain in reports.
    return criteria

def ballot_input(state, ballot_id):
    ballot = record(state, "ballots", ballot_id)
    return {"ballot": deepcopy(ballot), "edition": deepcopy(record(state, "editions", ballot["edition_id"])),
            "votes": deepcopy(sorted((r for r in state["votes"] if r["ballot_id"] == ballot_id), key=lambda r: r["person_id"])),
            "comments": deepcopy(sorted((r for r in state["comments"] if r["edition_id"] == ballot["edition_id"]), key=lambda r: r["id"])),
            "consultations": deepcopy([record(state, "consultations", c) for c in ballot["consultation_ids"]])}

def calculate_ballot(snap):
    ballot, votes = snap["ballot"], snap["votes"]
    profile = ballot["profile"]
    eligible = {r["person_id"] for r in ballot["roster"] if r["voting"]}
    raw = {choice: sum(v["choice"] == choice for v in votes) for choice in ("yes", "no", "abstain", "blank")}
    excluded = []
    cast = []
    for v in votes:
        reason = None
        if v["choice"] == "blank":
            reason = "blank"
        elif v["choice"] == "no" and profile["exclude_unjustified_negative"] and not v["justification"].strip():
            reason = "negative_without_required_justification"
        elif v["choice"] == "abstain" and profile["exclude_unjustified_abstention"] and not v["justification"].strip():
            reason = "abstention_without_required_justification"
        if reason:
            excluded.append({"vote_id": v["id"], "person_id": v["person_id"], "reason": reason})
        else:
            cast.append(v)
    y, n, a = (sum(v["choice"] == choice for v in cast) for choice in ("yes", "no", "abstain"))
    denoms = {"yes_no": y+n, "yes_no_abstain": y+n+a}
    criteria = []
    majority = profile["participant_majority"]
    if majority != "none":
        d = len(eligible) if majority == "strict_majority_of_eligible" else y+n+a
        criteria.append({"code": "participant_majority", "numerator": y, "denominator": d, "satisfied": bool(d) and 2*y > d,
                         "rule": majority})
    for code, fraction, basis, numerator, operator in (
        ("affirmative_fraction", profile["affirmative_fraction"], profile["affirmative_denominator"], y, "minimum"),
        ("negative_fraction_max", profile["negative_fraction_max"], profile["negative_denominator"], n, "maximum")):
        if fraction is None:
            continue
        def passes(d):
            return bool(d) and (numerator*fraction["denominator"] >= d*fraction["numerator"] if operator == "minimum" else numerator*fraction["denominator"] <= d*fraction["numerator"])
        if basis == "unresolved":
            alternatives = {key: {"denominator": d, "satisfied": passes(d)} for key, d in denoms.items()}
            criteria.append({"code": code, "numerator": numerator, "denominator": None, "fraction": fraction,
                             "satisfied": None, "reason": "The selected source has no recorded denominator interpretation.", "alternatives": alternatives})
        else:
            d = denoms[basis]
            criteria.append({"code": code, "numerator": numerator, "denominator": d, "fraction": fraction, "basis": basis, "satisfied": passes(d)})
    bal = balance(ballot["roster"])
    if profile["interest_balance"]:
        criteria.append({"code": "interest_balance", "satisfied": bal["balanced"]})
    unresolved_comments = [r["id"] for r in snap["comments"] if r["disposition"] in ("open", "deferred") or not r["rationale"].strip()]
    if profile["require_comment_disposition"]:
        criteria.append({"code": "comment_dispositions", "satisfied": not unresolved_comments, "unresolved_ids": unresolved_comments})
    unresolved_negative = [v["id"] for v in votes if v["choice"] == "no" and not (
        v["negative_resolution"].strip() and v["notification_at"] and v["notification_evidence"].strip())]
    if profile["require_negative_resolution"]:
        criteria.append({"code": "negative_resolutions_and_notification", "satisfied": not unresolved_negative, "unresolved_ids": unresolved_negative})
    consultations = [consultation_report(c, profile) for c in snap["consultations"]]
    criteria.extend(public_review_criteria(snap["consultations"],profile))
    if profile["require_sponsor_endorsement"]:
        criteria.append({"code": "sponsor_endorsement", "satisfied": bool(ballot["sponsor_endorsement_source_ids"])})
    any_false = any(c["satisfied"] is False for c in criteria)
    unknown = any(c["satisfied"] is None for c in criteria)
    return {"eligible": len(eligible), "raw": raw, "nonresponse": len(eligible - {v["person_id"] for v in votes}),
            "counted": {"yes": y, "no": n, "abstain": a}, "excluded": excluded, "denominators": denoms,
            "criteria": criteria, "calculated_status": "criteria_not_met" if any_false else "interpretation_not_recorded" if unknown else "criteria_met",
            "balance": bal, "consultations": consultations,
            "authority_note": "The calculation does not create an approval decision."}

def record_technical_decision(state, payload, record_id):
    edition=record(state,"editions",payload.get("edition_id"))
    profile=record(state,"procedures",payload.get("procedure_id"))
    if edition["snapshot"]["scope"]["deliverable_type"] not in profile["applies_to"]:
        raise ValueError("The selected procedure does not apply to this edition type.")
    consultations=[record(state,"consultations",cid) for cid in payload.get("consultation_ids",[])]
    if any(c["edition_id"]!=edition["id"] for c in consultations):
        raise ValueError("Review records must concern the decided edition.")
    snap={"edition":deepcopy(edition),"profile":deepcopy(profile),"consultations":deepcopy(consultations),
          "comments":deepcopy(sorted((c for c in state["comments"] if c["edition_id"]==edition["id"]),key=lambda c:c["id"]))}
    return validate_record("technical_decisions",{"id":record_id, "edition_id":edition["id"],"procedure_id":profile["id"],
        "method":payload.get("method","peer_review"),"consultation_ids":payload.get("consultation_ids",[]),
        "decision":payload.get("decision","recorded_only"),"authority":payload.get("authority"),"rationale":payload.get("rationale"),
        "recorded_at":now(),"source_ids":payload.get("source_ids",[]),"input_snapshot":snap,"input_sha256":digest(snap)},state)

def close_ballot(state, payload, record_id):
    ballot_id = payload.get("ballot_id")
    if any(r["ballot_id"] == ballot_id for r in state["ballot_closures"]):
        raise ValueError("This ballot already has an immutable closure. Start a successor ballot to vote again.")
    snap = ballot_input(state, ballot_id)
    return validate_record("ballot_closures", {"id": record_id, "ballot_id": ballot_id, "recorded_at": now(),
        "authority": payload.get("authority"), "recorded_decision": payload.get("recorded_decision", "recorded_only"),
        "rationale": payload.get("rationale"), "input_snapshot": snap, "input_sha256": digest(snap),
        "calculation": calculate_ballot(snap), "source_ids": payload.get("source_ids", [])}, state)

def independence(state, reviewer_id):
    reasons = []
    person = record(state, "people", reviewer_id)
    if person["development_roles"]:
        reasons.append("Declared development roles: " + ", ".join(person["development_roles"]))
    if any(m["person_id"] == reviewer_id for m in state["memberships"]):
        reasons.append("Current or retained committee/steering membership exists.")
    if any(reviewer_id in e["contributor_ids"] for e in state["editions"]):
        reasons.append("Named contributor to a frozen edition.")
    if any(c["author_id"] == reviewer_id for c in state["comments"]):
        reasons.append("Authored a development/review comment.")
    if any(l["reviewer_id"] == reviewer_id for l in state["language_reviews"]):
        reasons.append("Reviewed clause translation during development.")
    return {"reviewer": deepcopy(person), "known_development_involvement": reasons,
            "no_known_involvement": not reasons,
            "note": "Absence from local records is not proof of independence; a declaration and actual appointment remain explicit."}

def record_procedural_review(state, payload, record_id):
    closure = record(state, "ballot_closures", payload.get("closure_id"))
    reviewer = payload.get("reviewer_id")
    return validate_record("procedural_reviews", {"id": record_id, "closure_id": closure["id"], "reviewer_id": reviewer,
        "independence_declared": payload.get("independence_declared", False),
        "appointment_source_ids": payload.get("appointment_source_ids", []), "decision": payload.get("decision", "changes_required"),
        "recorded_at": now(), "rationale": payload.get("rationale"), "reviewed_input_sha256": closure["input_sha256"],
        "independence_snapshot": independence(state, reviewer), "source_ids": payload.get("source_ids", [])}, state)

def add_months(value, months):
    d = date.fromisoformat(value)
    month = d.month - 1 + months
    year = d.year + month // 12
    month = month % 12 + 1
    return date(year, month, min(d.day, calendar.monthrange(year, month)[1])).isoformat()

def add_business_days(value, count, excluded=()):
    current = date.fromisoformat(value)
    holidays = set(excluded)
    remaining = count
    while remaining:
        current += timedelta(days=1)
        if current.weekday() < 5 and current.isoformat() not in holidays:
            remaining -= 1
    return current.isoformat()

def communication_report(state, row):
    review_link = row["kind"] == "public_review_link"
    exception = row["mandatory_notice_exception"] and row["kind"] == "mandatory_procedural_notice" and bool(row["exception_source_ids"] and row["exception_rationale"].strip())
    target = row["published_on"] or row["planned_publication"]
    submitted = bool(row["submitted_to_scc_on"] and row["submission_source_ids"])
    provisional = add_business_days(row["submitted_to_scc_on"],15,row["excluded_business_dates"]) if row["submitted_to_scc_on"] else None
    selected = row["calendar_status"] == "selected_calendar"
    result = {"id":row["id"],"title":row["title"],"phase":row["phase"],"kind":row["kind"],
              "review_required":not (review_link or exception),"minimum_business_days":15,
              "submitted_on":row["submitted_to_scc_on"],"submission_evidence_recorded":submitted,
              "target_publication_on":target,"provisional_review_ready_on":provisional,
              "calendar_status":row["calendar_status"],"calendar_basis":row["calendar_basis"],
              "excluded_business_dates":row["excluded_business_dates"],"mandatory_notice_exception_supported":bool(exception),
              "lead_time_satisfied":(bool(submitted and target >= provisional) if selected and target and provisional else None),
              "scc_response":row["scc_response"],"response_on":row["response_on"]}
    if review_link:
        consultation = record(state,"consultations",row["consultation_id"])
        opens = consultation["opens"]
        sent = row["submitted_to_scc_on"] if submitted else None
        result["review_link_dispatch"] = {"consultation_id":consultation["id"],"edition_id":consultation["edition_id"],
            "launch_on":opens,"sent_on":sent,"link":row["target_url"],"recipient":row["recipient"],
            "timing":("not_recorded" if not sent else "launch_not_recorded" if not opens else "at_launch" if sent==opens else "before_launch" if sent<opens else "after_launch"),
            "sent_by_launch":bool(sent and opens and sent<=opens)}
    return result

def deliverable_definition(row):
    return {key:row[key] for key in ("id","title","phase","kind")}

def latest_delivery_register(state):
    rows = state.get("delivery_registers",[])
    return max(rows,key=lambda r:(r["recorded_at"],r["id"])) if rows else None

def record_delivery_register(state,payload,record_id):
    ids = payload.get("scope_deliverable_ids",[])
    if not isinstance(ids,list) or len(ids)!=len(set(ids)):
        raise ValueError("Select unique deliverable identities for this scope register.")
    scope = [deliverable_definition(record(state,"deliverables",i)) for i in ids]
    invoices = [{"id":r["id"],"sha256":digest(r)} for r in state["invoices"] if invoice_status(state,r)!="void"]
    return validate_record("delivery_registers",{**payload,"id":record_id,"recorded_at":now(),
        "scope_snapshot":scope,"invoice_snapshot":invoices,"snapshot_sha256":digest({"scope":scope,"invoices":invoices})},state)

def delivery_status(state):
    register = latest_delivery_register(state)
    if not register:
        return {"register_id":None,"scope_confirmed":False,"scope_binding_current":False,
                "required_deliverable_ids":[],"missing_or_changed_deliverable_ids":[],"unassigned_deliverable_ids":[],
                "not_completed_deliverable_ids":[],"final_invoice_register_confirmed":False,"invoice_register_current":False,
                "unsubmitted_invoice_ids":[],"recorded_closeout_conditions_met":False}
    current = {r["id"]:r for r in state["deliverables"]}
    selected = {r["id"]:r for r in register["scope_snapshot"]}
    changed = [i for i,r in selected.items() if i not in current or deliverable_definition(current[i])!=r]
    unassigned = [r["id"] for r in state["deliverables"] if r["kind"] not in ("phase_report","progress_report") and r["id"] not in selected]
    complete = lambda r: r["status"]=="accepted" and bool(r["accepted_at"] and r["source_ids"] and r["acceptance_source_ids"])
    unfinished = [i for i in selected if i not in current or not complete(current[i])]
    invoice_rows = [r for r in state["invoices"] if invoice_status(state,r)!="void"]
    invoice_snapshot = [{"id":r["id"],"sha256":digest(r)} for r in invoice_rows]
    invoice_current = sorted(invoice_snapshot,key=lambda r:r["id"])==sorted(register["invoice_snapshot"],key=lambda r:r["id"])
    unsubmitted = [r["id"] for r in invoice_rows if not any(x["invoice_id"]==r["id"] and x["status"] in ("submitted","accepted","queried") for x in state["invoice_responses"])]
    scope_current = bool(register["scope_confirmed"] and not changed and not unassigned)
    return {"register_id":register["id"],"scope_confirmed":register["scope_confirmed"],"scope_binding_current":scope_current,
            "required_deliverable_ids":list(selected),"missing_or_changed_deliverable_ids":changed,"unassigned_deliverable_ids":unassigned,
            "not_completed_deliverable_ids":unfinished,"final_invoice_register_confirmed":register["final_invoice_register_confirmed"],
            "invoice_register_current":invoice_current,"unsubmitted_invoice_ids":unsubmitted,
            "recorded_closeout_conditions_met":bool(scope_current and not unfinished and register["final_invoice_register_confirmed"] and invoice_current and not unsubmitted)}

def phase_receipt_conditions(snapshot):
    context = snapshot.get("report_context",{})
    binding = context.get("delivery_register",{})
    register = binding.get("record")
    scope_rows = [r for r in register["scope_snapshot"] if r["phase"]==snapshot["phase"]] if register else []
    current = {r["id"]:r for r in snapshot["deliverables"]}
    missing = []
    for required in scope_rows:
        r = current.get(required["id"])
        if not r or deliverable_definition(r)!=required or r["status"]=="draft" or not r["submitted_at"] or not r["source_ids"] or not r["acceptance_source_ids"]:
            missing.append(required["id"])
    return {"scope_register_id":register["id"] if register else None,
            "scope_binding_current":bool(register and register["scope_confirmed"] and binding.get("scope_binding_current")),
            "required_deliverable_ids":[r["id"] for r in scope_rows],"receipt_not_recorded_ids":missing,
            "received_phase_deliverables_recorded":bool(register and register["scope_confirmed"] and binding.get("scope_binding_current") and not missing)}

def reporting_schedule(state):
    phase_rows = [r for r in state["phase_reports"] if r["submitted_at"]]
    phase = max(phase_rows,key=lambda r:(r["submitted_at"],r["id"])) if phase_rows else None
    anchor = phase["submitted_at"][:10] if phase else None
    progress = sorted((r for r in state["deliverables"] if r["kind"]=="progress_report" and r["submitted_at"] and r["source_ids"] and (not anchor or r["submitted_at"][:10]>=anchor)),key=lambda r:(r["submitted_at"],r["id"]))
    last = progress[-1]["submitted_at"][:10] if progress else anchor
    funding = single(state,"funding")
    planning = add_months(funding["start"],3) if not last and funding and funding["start"] else None
    return {"previous_phase_report_id":phase["id"] if phase else None,"previous_phase_submitted_on":anchor,
            "progress_report_ids":[r["id"] for r in progress],"last_report_submitted_on":last,
            "maximum_interval_months":3,"next_due":add_months(last,3) if last else None,
            "planning_due_before_first_phase_report":planning,"basis":"Three months after the last recorded phase/progress submission; phase through-date does not reset submission timing."}

def phase_snapshot(state, phase):
    scope = single(state,"scope")
    procedure = record(state,"procedures",scope["procedure_id"]) if scope and scope["procedure_id"] else None
    register = latest_delivery_register(state)
    report_context = {
        "scope":deepcopy(scope),"selected_procedure":deepcopy(procedure),
        "consultations":deepcopy(state["consultations"]),
        "technical_decisions":[{k:deepcopy(r[k]) for k in ("id","edition_id","method","decision","authority","recorded_at","source_ids","input_sha256")} for r in state["technical_decisions"]],
        "ballot_decisions":[{k:deepcopy(r[k]) for k in ("id","ballot_id","recorded_decision","authority","recorded_at","source_ids","input_sha256")} for r in state["ballot_closures"]],
        "ola_events":deepcopy(state["ola_events"]),
        "communications":deepcopy([r for r in state.get("communications",[]) if r["phase"]==phase]),
        "delivery_register":{"record":deepcopy(register),"scope_binding_current":delivery_status(state)["scope_binding_current"]},
        "context_scope":"Project procedural and OLA context retained at this report freeze; communications are selected by their recorded phase. Unassigned OLA events are not silently attributed to a phase."}
    return {"phase": phase, "funding": deepcopy(single(state, "funding")),"report_context":report_context,
            "tasks": deepcopy(sorted((r for r in state["tasks"] if r["phase"] == phase), key=lambda r:r["id"])),
            "deliverables": deepcopy(sorted((r for r in state["deliverables"] if r["phase"] == phase), key=lambda r:r["id"])),
            "costs": deepcopy(sorted((r for r in state["costs"] if r["phase"] == phase), key=lambda r:r["id"]))}

def freeze_phase_report(state, payload, record_id):
    phase = payload.get("phase")
    if phase not in PHASES:
        raise ValueError("Select one of the four SCC delivery phases.")
    snap = phase_snapshot(state, phase)
    return validate_record("phase_reports", {"id":record_id, "phase":phase, "title":payload.get("title"),
        "through":payload.get("through"), "summary":payload.get("summary"), "recorded_at":now(),
        "submitted_at":payload.get("submitted_at",""), "input_snapshot":snap, "input_sha256":digest(snap),
        "source_ids":payload.get("source_ids",[])}, state)

def invoice_status(state, invoice):
    responses = [r for r in state["invoice_responses"] if r["invoice_id"] == invoice["id"]]
    latest = sorted(responses,key=lambda r:(r["date"] or "",r.get("recorded_at",""),r["id"]))[-1] if responses else None
    return latest["status"] if latest else "prepared"

def invoice_allocations(state, exclude_id=None):
    result={}
    for invoice in state["invoices"]:
        if invoice["id"] == exclude_id or invoice_status(state,invoice) == "void":
            continue
        for a in invoice["allocations"]:
            result[a["cost_id"]] = result.get(a["cost_id"],Decimal(0)) + Decimal(a["net_cad"])
    return result

def prepare_invoice(state,payload,record_id):
    report=record(state,"phase_reports",payload.get("report_id"))
    responses=[r for r in state["report_responses"] if r["report_id"]==report["id"]]
    response=sorted(responses,key=lambda r:(r["date"] or "",r.get("recorded_at",""),r["id"]))[-1] if responses else None
    if response is None or response["decision"]!="accepted" or response["report_sha256"]!=report["input_sha256"]:
        raise ValueError("Prepare the invoice against this exact phase report's actual SCC acceptance.")
    receipt_conditions=phase_receipt_conditions(report["input_snapshot"])
    if not receipt_conditions["received_phase_deliverables_recorded"]:
        raise ValueError("This report must retain the confirmed phase scope and original delivery/receipt records. Record them, then freeze and obtain acceptance of a successor report.")
    funding=report["input_snapshot"]["funding"]
    if not funding or funding["status"]=="proposed":
        raise ValueError("The accepted report must retain a signed funding agreement, not only a proposed budget.")
    phase=report["phase"]
    snap_costs={r["id"]:r for r in report["input_snapshot"]["costs"]}
    allocations=payload.get("allocations")
    if not isinstance(allocations,list) or not allocations or len(allocations)>5000:
        raise ValueError("Select actual substantiated cost allocations for this invoice.")
    used=invoice_allocations(state)
    normalized=[]; seen=set(); net=Decimal(0); bycategory={"base":Decimal(0),"ola":Decimal(0)}
    for item in allocations:
        if not isinstance(item,dict) or set(item)!={"cost_id","net_cad"} or item["cost_id"] in seen:
            raise ValueError("Each cost allocation must identify one unique cost_id and net_cad amount.")
        seen.add(item["cost_id"]); cost=snap_costs.get(item["cost_id"])
        if cost is None or cost["basis"]!="actual" or not cost["substantiation_ids"]:
            raise ValueError("Invoice costs must be actual, substantiated and included in the accepted report snapshot.")
        amount=Decimal(money(item["net_cad"],"Allocated CAD"))
        if amount<=0 or used.get(cost["id"],Decimal(0))+amount>Decimal(cost["net_cad"]):
            raise ValueError("Allocation is zero or exceeds the source receipt remaining after prior invoices.")
        normalized.append({"cost_id":cost["id"],"net_cad":format(amount,".2f"),"category":cost["category"],
                           "source_cost_sha256":digest(cost),"substantiation_ids":cost["substantiation_ids"]})
        net+=amount; bycategory[cost["category"]]+=amount
    prior_base=Decimal(0); prior_ola=Decimal(0)
    for invoice in state["invoices"]:
        if invoice_status(state,invoice)=="void": continue
        for a in invoice["allocations"]:
            if a["category"]=="ola": prior_ola+=Decimal(a["net_cad"])
            elif invoice["phase"]==phase: prior_base+=Decimal(a["net_cad"])
    if prior_base+bycategory["base"]>Decimal(funding["phase_amounts"][phase]):
        raise ValueError("The invoice would exceed the agreed base allocation for this phase.")
    if prior_ola+bycategory["ola"]>Decimal(funding["ola_cad"]):
        raise ValueError("The invoice would exceed the separately agreed OLA contingency.")
    hst=Decimal(money(payload.get("hst_cad","0.00"),"Invoice HST"))
    snap={"report_sha256":report["input_sha256"],"response":deepcopy(response),"funding":deepcopy(funding),
          "delivery_receipt_conditions":receipt_conditions,
          "costs":[deepcopy(snap_costs[a["cost_id"]]) for a in normalized]}
    return validate_record("invoices",{"id":record_id,"number":payload.get("number"),"phase":phase,
        "report_id":report["id"],"response_id":response["id"],"issued":payload.get("issued"),
        "allocations":normalized,"net_cad":format(net,".2f"),"hst_cad":format(hst,".2f"),"total_cad":format(net+hst,".2f"),
        "prepared_at":now(),"terms":payload.get("terms",""),"input_snapshot":snap,"input_sha256":digest(snap)},state)

def payment_balances(state):
    result=[]
    for invoice in state["invoices"]:
        rows=[r for r in state["payments"] if r["invoice_id"]==invoice["id"]]
        paid=sum((Decimal(r["amount_cad"])*(1 if r["kind"]=="receipt" else -1) for r in rows),Decimal(0))
        result.append({"invoice_id":invoice["id"],"number":invoice["number"],"status":invoice_status(state,invoice),
                       "total_cad":invoice["total_cad"],"collected_cad":format(paid,".2f"),
                       "remaining_cad":format(Decimal(invoice["total_cad"])-paid,".2f")})
    return result

def _cycle(state,collection,field):
    graph={r["id"]:r[field] if isinstance(r[field],list) else ([r[field]] if r[field] else []) for r in state[collection]}
    seen=set(); path=set()
    def visit(key):
        if key in path: raise ValueError(collection+" contains a circular "+field+" relationship.")
        if key in seen:return
        path.add(key)
        for other in graph.get(key,[]):visit(other)
        path.remove(key);seen.add(key)
    for key in graph:visit(key)

def validate_state(state):
    if state.get("schema")!=SCHEMA:raise ValueError("Unsupported standards workspace schema.")
    if state.get("mode") not in ("working","public_example","authored_example"):raise ValueError("Unknown example/working mode.")
    for name in COLLECTIONS:
        rows=state.get(name,[]) if name in OPTIONAL_COLLECTIONS else state.get(name)
        if not isinstance(rows,list) or len(rows)>20000 or len({r.get("id") for r in rows if isinstance(r,dict)})!=len(rows):
            raise ValueError("Malformed, duplicate or excessive records in "+name)
        for row in rows:
            if canonical(validate_record(name,row,state))!=canonical(row):
                raise ValueError("Unnormalized "+name+" record: "+row["id"])
    for collection in ("scope","funding"):
        if len(state[collection])>1:raise ValueError("A project has one current "+collection+" record; its prior versions remain in history and frozen outputs.")
    for collection,fields in (("clauses",("number",)),("votes",("ballot_id","person_id")),("costs",("external_reference",)),
                              ("payments",("external_reference",)),("invoices",("number",))):
        keys=[]
        for row in state[collection]:
            key=tuple(row[f] for f in fields)
            if all(key):keys.append(key)
        if len(keys)!=len(set(keys)):raise ValueError("Repeated identity in "+collection+": "+", ".join(fields))
    _cycle(state,"tasks","dependencies");_cycle(state,"clauses","parent_id")
    for edition in state["editions"]:
        if digest(edition["snapshot"])!=edition["sha256"]:raise ValueError("Frozen edition digest differs.")
    for closure in state["ballot_closures"]:
        if digest(closure["input_snapshot"])!=closure["input_sha256"] or canonical(calculate_ballot(closure["input_snapshot"]))!=canonical(closure["calculation"]):
            raise ValueError("Ballot closure snapshot or calculation differs.")
    for r in state["phase_reports"]+state["invoices"]+state["technical_decisions"]:
        if digest(r["input_snapshot"])!=r["input_sha256"]:raise ValueError("Frozen financial record digest differs.")
    for r in state["report_responses"]:
        if record(state,"phase_reports",r["report_id"])["input_sha256"]!=r["report_sha256"]:raise ValueError("Response is bound to a different phase report.")
    for invoice in state["invoices"]:
        net=sum((Decimal(a["net_cad"]) for a in invoice["allocations"]),Decimal(0))
        if net!=Decimal(invoice["net_cad"]) or net+Decimal(invoice["hst_cad"])!=Decimal(invoice["total_cad"]):raise ValueError("Invoice amounts do not reconcile.")
    for row in payment_balances(state):
        if Decimal(row["collected_cad"])<0 or Decimal(row["remaining_cad"])<0:
            raise ValueError("Receipts/refunds exceed this invoice's actual outstanding or collected amount.")
    return state

def analyze(state):
    findings=[]
    def finding(code,message,collection=None,record_id=None,level="attention"):
        findings.append({"code":code,"message":message,"collection":collection,"record_id":record_id,"level":level})
    scope=single(state,"scope");funding=single(state,"funding")
    if not scope:finding("scope_needed","Set the standards solution scope, audience and applicable procedure.","scope")
    elif scope["new_work_status"]=="phase_2_or_later":
        finding("call_early_stage","The recorded work is beyond Phase 1; the call's early-stage eligibility needs an actual determination.","scope",scope["id"])
    current_snapshot=edition_snapshot(state)
    languages=[language_status(state,c) for c in ordered_clauses(state)]
    for lang in languages:
        if not lang["french_present"] or lang["review_status"]!="reviewed":
            finding("paired_language_work","The paired French text needs completion or review at the current English and French content.","clauses",lang["clause_id"])
    live_roster=roster_at(state,date.today().isoformat())
    editions=[]
    for e in state["editions"]:
        comparison=compare_editions(e["snapshot"],current_snapshot)
        editions.append({"id":e["id"],"label":e["label"],"sha256":e["sha256"],"frozen_at":e["frozen_at"],
                         "current_draft_differs":digest(current_snapshot)!=e["sha256"],"changed_clause_count":len(comparison["clauses"])})
    ballots=[]
    for b in state["ballots"]:
        snap=ballot_input(state,b["id"]); calculation=calculate_ballot(snap)
        closure=next((r for r in state["ballot_closures"] if r["ballot_id"]==b["id"]),None)
        ballots.append({"id":b["id"],"title":b["title"],"edition_id":b["edition_id"],**calculation,
                        "closure_id":closure["id"] if closure else None,
                        "recorded_decision":closure["recorded_decision"] if closure else None,
                        "records_changed_since_closure":digest(snap)!=closure["input_sha256"] if closure else False})
    publications=[]
    for p in state["publications"]:
        e=record(state,"editions",p["edition_id"]); problems=[]
        if not p["url_en"] or not p["url_fr"]:problems.append("Both language URLs are not recorded.")
        if not p["authority_source_ids"] or not p["authority"]:problems.append("Publication authority evidence is not recorded.")
        if not all(r["french_present"] and r["review_status"]=="reviewed" for r in e["snapshot"]["language_reviews"]):
            problems.append("The frozen edition has unresolved paired-language review.")
        if p["closure_id"]:
            c=record(state,"ballot_closures",p["closure_id"])
            if c["input_snapshot"]["ballot"]["edition_id"]!=e["id"]:problems.append("Approval concerns a different edition.")
            if c["recorded_decision"]!="adopted":problems.append("An adopted technical decision is not recorded.")
            if c["calculation"]["calculated_status"]!="criteria_met":problems.append("The recorded ballot criteria were not all satisfied or interpreted.")
            if c["input_snapshot"]["ballot"]["profile"]["require_independent_review"]:
                if not p["procedural_review_id"]:problems.append("Independent procedural review is not recorded.")
                else:
                    pr=record(state,"procedural_reviews",p["procedural_review_id"])
                    if pr["closure_id"]!=c["id"] or pr["decision"]!="confirmed" or not pr["independence_declared"] or not pr["appointment_source_ids"] or not pr["independence_snapshot"]["no_known_involvement"]:
                        problems.append("The selected procedural review does not establish the required independent confirmation.")
        elif p["technical_decision_id"]:
            decision=record(state,"technical_decisions",p["technical_decision_id"])
            if decision["edition_id"]!=e["id"]:problems.append("Technical decision concerns another edition.")
            if decision["decision"]!="adopted" or not decision["source_ids"]:problems.append("Actual technical agreement and its authority evidence are not recorded.")
            selected=decision["input_snapshot"]["profile"]
            reviews=decision["input_snapshot"]["consultations"]
            for criterion in public_review_criteria(reviews,selected):
                if criterion["satisfied"] is not True:
                    problems.append("The selected public-review requirement is not met: "+criterion["code"]+".")
            if selected["participant_majority"]!="none" or selected["affirmative_fraction"] is not None or selected["negative_fraction_max"] is not None:
                problems.append("The selected profile includes ballot requirements; link the exact recorded ballot decision.")
            if selected["require_peer_review"] and not any(r["actual_closed"] and r["source_ids"] for r in reviews):
                problems.append("Completed peer-review evidence is not linked to this decision.")
            if selected["require_workshop"] and not any(r["kind"]=="workshop" and r["actual_closed"] and r["source_ids"] for r in reviews):
                problems.append("Completed workshop evidence is not linked to this agreement.")
            workshop_dates=[r["closes"] for r in reviews if r["kind"]=="workshop" and r["actual_closed"] and r["closes"]]
            if selected["publish_within_months_of_workshop"] is not None and p["issued"] and workshop_dates:
                if p["issued"]>add_months(max(workshop_dates),selected["publish_within_months_of_workshop"]):
                    problems.append("The recorded publication date is beyond the selected workshop-to-publication interval.")
            if any(c["disposition"] in ("open","deferred") for c in decision["input_snapshot"]["comments"]):
                problems.append("The recorded decision retains unresolved comments.")
        else:problems.append("No edition-bound technical decision is linked.")
        if p["status"]=="released" and problems:
            finding("publication_record_gaps","The actual release is retained with gaps in local records: "+" ".join(problems),"publications",p["id"])
        publications.append({"id":p["id"],"status":p["status"],"edition_id":p["edition_id"],"record_gaps":problems,
                             "maintenance_due":p["maintenance_due"],"overdue":bool(p["maintenance_due"] and p["maintenance_due"]<date.today().isoformat())})
    phases=[]
    for phase in PHASES:
        costs=[r for r in state["costs"] if r["phase"]==phase]
        ready_reports=[]; agreed_ready_reports=[]
        sums={basis:{cat:format(sum((Decimal(r["net_cad"]) for r in costs if r["basis"]==basis and r["category"]==cat),Decimal(0)),".2f") for cat in ("base","ola")} for basis in ("estimate","actual")}
        reports=[r for r in state["phase_reports"] if r["phase"]==phase]
        report_rows=[]
        for report in reports:
            responses=[r for r in state["report_responses"] if r["report_id"]==report["id"]]
            latest=sorted(responses,key=lambda r:(r["date"] or "",r.get("recorded_at",""),r["id"]))[-1] if responses else None
            receipt_conditions=phase_receipt_conditions(report["input_snapshot"])
            retained_funding=report["input_snapshot"].get("funding")
            retained_agreement=bool(retained_funding and retained_funding.get("status") in ("signed","amended"))
            if latest and latest["decision"]=="accepted" and receipt_conditions["received_phase_deliverables_recorded"]:
                ready_reports.append(report["id"])
                if retained_agreement: agreed_ready_reports.append(report["id"])
            report_rows.append({"id":report["id"],"title":report["title"],"submitted_at":report["submitted_at"],
                                "response":latest["decision"] if latest else None,"delivery_receipt_conditions":receipt_conditions,
                                "retained_funding_status":retained_funding.get("status") if retained_funding else None,
                                "retained_agreement_recorded":retained_agreement,
                                "current_work_differs":digest(phase_snapshot(state,phase))!=report["input_sha256"]})
        tasks=[r for r in state["tasks"] if r["phase"]==phase]
        phases.append({"phase":phase,"title":PHASE_NAMES[phase],"costs_cad":sums,
                       "agreed_base_cad":funding["phase_amounts"][phase] if funding else None,
                       "unsubstantiated_actual_cost_ids":[r["id"] for r in costs if r["basis"]=="actual" and not r["substantiation_ids"]],
                       "reports":report_rows,"cash_release_conditions":{"accepted_reports_with_received_deliverables":ready_reports,
                           "accepted_reports_with_received_deliverables_and_agreement":agreed_ready_reports,
                           "conditions_recorded":bool(agreed_ready_reports),"basis":"Received phase deliverables and the corresponding SCC-accepted phase report retaining a signed or amended funding agreement; target dates do not release cash."},
                       "tasks":len(tasks),"delivered_tasks":sum(r["status"]=="delivered" for r in tasks),
                       "deliverables":len([r for r in state["deliverables"] if r["phase"]==phase])})
    if funding and scope:
        cap=CAPS.get(scope["deliverable_type"])
        if cap and Decimal(funding["base_cad"])>Decimal(cap):
            finding("base_funding_cap","The current proposed/agreed base amount exceeds the call's stated deliverable-type maximum.","funding",funding["id"])
        if Decimal(funding["ola_cad"])>Decimal("20000") or (scope["deliverable_type"]=="CSG" and Decimal(funding["ola_cad"])>0):
            finding("ola_funding_limit","The OLA amount differs from this call's applicable contingency limit.","funding",funding["id"])
        months=MAX_MONTHS.get(scope["deliverable_type"])
        if months and funding["start"] and funding["finish"] and funding["finish"]>add_months(funding["start"],months):
            finding("duration_limit","Recorded duration exceeds this deliverable's maximum period in the call.","funding",funding["id"])
        if funding["signed_on"] and funding["start"] and funding["start"]>add_months(funding["signed_on"],3):
            finding("start_window","Recorded start is beyond three months from signature.","funding",funding["id"])
    for change in state["changes"]:
        if change["kind"]=="minor" and change["proposed_on"] and change["original_due"] and change["proposed_on"]>=change["original_due"]:
            finding("late_change_notice","The minor-change notice was not before its original due date.","changes",change["id"])
    reporting=reporting_schedule(state)
    next_progress=reporting["next_due"]
    if next_progress and next_progress<date.today().isoformat():
        finding("progress_report_due","The recorded maximum three-month reporting interval has elapsed; retain the actual submitted progress or successor phase report.","phase_reports")
    communication_reviews=[communication_report(state,r) for r in state.get("communications",[])]
    for r in communication_reviews:
        if r["review_required"] and r["target_publication_on"] and r["lead_time_satisfied"] is not True:
            finding("communication_review_basis","Record the SCC submission, selected business-day calendar and fifteen-business-day review interval, or a supported mandatory-notice exception.","communications",r["id"])
    public_consultations=[r for r in state["consultations"] if r["kind"]=="public"]
    dispatches=[]
    for consultation in public_consultations:
        records=[r["review_link_dispatch"] for r in communication_reviews if r.get("review_link_dispatch",{}).get("consultation_id")==consultation["id"]]
        dispatches.append({"consultation_id":consultation["id"],"edition_id":consultation["edition_id"],"launch_on":consultation["opens"],
                           "dispatches":records,"dispatch_recorded_by_launch":any(r["sent_by_launch"] for r in records)})
        if consultation["actual_closed"] and not any(r["sent_by_launch"] for r in records):
            finding("review_link_dispatch","The completed public review has no retained SCC link-dispatch record at its launch.","consultations",consultation["id"])
    completion=delivery_status(state)
    for r in state["ola_events"]:
        if not r["active_offer_en"] or not r["active_offer_fr"] or r["unresolved_requests"]:
            finding("active_offer_followup","Record both actual offers and the disposition of requested language services.","ola_events",r["id"])
    invoices=payment_balances(state)
    total_collected=sum((Decimal(r["collected_cad"]) for r in invoices),Decimal(0))
    return {"scope":deepcopy(scope),"mode":state["mode"],"counts":{c:len(state.get(c,[])) for c in COLLECTIONS},
            "languages":languages,"live_interest_balance":balance(live_roster),"editions":editions,
            "ballots":ballots,"publications":publications,"phases":phases,"invoices":invoices,
            "collected_cad":format(total_collected,".2f"),"funding_status":funding["status"] if funding else "not_recorded",
            "next_progress_report_due":next_progress,"reporting_schedule":reporting,"communication_reviews":communication_reviews,
            "review_link_dispatches":dispatches,"completion":completion,"findings":findings,
            "record_retention":"Preserve development records perpetually; this application has no certification function."}
