"""Source-bound intake for an SCC original-form application.

Pure functions only. The existing Workspace transaction, original file store,
request journal and private restore remain authoritative. No uploaded code is run.
"""
from copy import deepcopy
from decimal import Decimal, InvalidOperation
import hashlib
import json
import re
from pathlib import PurePosixPath

if __package__:
    from . import engine
else:
    import engine

SCHEMA = "scc-prime-application-intake/v1"
RENDER_SCHEMA = "scc.application-renderer-inputs.v1"
MAX_ANSWERS = 8 * 1024 * 1024
FORM = {
    "filename": "scc_cfp-2026-01-application-form-advancing-data-governance-through-standardization-solutions_en.pdf",
    "sha256": "145a7cc034da6928f405a9bd07e01e25eaeae1a6c6a5dffcc27b9055c53bff09",
    "bytes": 305800, "pages": 13,
}
RFP = {
    "filename": "scc_cfp-2026-01-advancing-data-governance-through-standardization-solutions_en.pdf",
    "sha256": "35ed019f958246615201a8b661e66a4f47ae3f36faab2eb0c224388d8ea88980",
    "bytes": 577024, "pages": 35, "financial_page": 29,
}
AUTHORING_KEYS = (
    "date", "title", "proposalTitle", "frenchTitle", "responseMarkdown",
    "outlineTable", "sourceForm", "sourceFormSha256", "sourceRfp",
    "baseBudget", "olaMaximum", "maximumBudget", "engineeringFee",
    "phaseAmounts", "subcontractMilestones", "engineeringWeeks",
    "selectedReviewDays", "selectedReviewStart", "selectedReviewEnd", "budgetRows",
)
ROLE_KEYS = (
    "applicant_prime", "project_leader", "standards_secretariat",
    "canadian_subject_expert", "technical_author_engineer",
    "professional_french_reviewer", "substitute_resource",
    "independent_procedural_reviewer", "publication_authority",
)
REQUIREMENTS = {
    "M1": {"pages": [12], "evidence": "Two published standards solutions and actual proposed-team contributions."},
    "M2": {"pages": [12, 13], "evidence": "At least two different people; actual leader experience, two committee examples within sixty months, and each person's resume."},
    "M3": {"pages": [13], "evidence": "Selected standards solution and applicable Roadmap topic."},
    "M4": {"pages": [13], "evidence": "Actual English/French resources, final deliverables and public-facing active offer."},
    "M5": {"pages": [13], "evidence": "Original application with complete answers and the requested supporting attachments."},
    "M6": {"pages": [13, 14], "evidence": "Actual Canadian legal entity and permanent Canadian establishment at submission."},
    "M7": {"pages": [14, 29], "evidence": "Reconciled applicable base cap, separate eligible OLA actuals and original financial schedule."},
}
ANSWER_QUERIES = {
    "applicant": r"^Applicant preparation$",
    "M1": r"^M1 and M2\b", "M2": r"^M1 and M2\b",
    "M3": r"^M3\b", "M4": r"^M4\b", "M5": r"^M5\b",
    "M6": r"^M6\b", "M7": r"^M7\b",
    "1a": r"^1a\b", "1b": r"^1b\b", "1c": r"^1c\b",
    "2": r"^2\.\s", "3a": r"^3a\b", "3b": r"^3b\b",
    "3c": r"^3c\b", "3d": r"^3d\b", "3e": r"^3e\b",
    "4": r"^4\.\s", "financial": r"^Original financial-table",
    "5a": r"^5a\b", "5b": r"^5b\b", "5c": r"^5c\b",
}
PHASES = ("1", "2", "3", "4")
LEGACY_RENDERER = {
    "git_blob": "5cb92c9b515bcfb230dd42e9d38fa0b1348f9c86",
    "sha256": "0bd677382caeeb0139f426da232a2fcf0106ca07e447c32949b789076cb47dc6",
    "mode": "frozen-original-only",
    "requires_parameterization": [
        "form_overlay", "attachments", "financial_form", "commercial_offer",
        "build titles/filenames/authoring-date/size assertions/output manifest",
    ],
}


def _object(value, allowed, label, required=None):
    if not isinstance(value, dict):
        raise ValueError(label + " must be an object.")
    unknown = set(value) - set(allowed)
    missing = set(allowed if required is None else required) - set(value)
    if unknown or missing:
        raise ValueError(label + " has unsupported or missing fields: " +
                         ", ".join(sorted(unknown | missing)))
    return value


def _text(value, label, *, empty=False, limit=10000):
    if not isinstance(value, str) or len(value) > limit or "\x00" in value:
        raise ValueError(label + " must be bounded text.")
    if not empty and not value.strip():
        raise ValueError(label + " is required.")
    return value


def _integer(value, label, minimum=0, maximum=1000000000):
    if type(value) is not int or not minimum <= value <= maximum:
        raise ValueError(label + " must be an integer within its declared bounds.")
    return value


def _decimal(value, label, places=2):
    # JSON binary floats and booleans never enter money/hour calculations.
    if type(value) is int:
        value = str(value)
    if not isinstance(value, str) or not re.fullmatch(r"\d+(?:\.\d{1," + str(places) + r"})?", value):
        raise ValueError(label + " must be a nonnegative exact decimal string or integer.")
    try:
        number = Decimal(value)
    except InvalidOperation as exc:
        raise ValueError(label + " is not a decimal.") from exc
    if number > Decimal("1000000000"):
        raise ValueError(label + " exceeds the supported planning range.")
    return number


def _money(value, label):
    return format(_decimal(value, label), ".2f")


def _sha(raw):
    return hashlib.sha256(raw).hexdigest()


def _unique(values, label, maximum=250):
    if not isinstance(values, list) or len(values) > maximum:
        raise ValueError(label + " must be a bounded list.")
    if any(not isinstance(v, str) or not v for v in values) or len(set(values)) != len(values):
        raise ValueError(label + " must contain unique nonempty identities.")
    return values


def _record(state, collection, identity):
    matches = [r for r in state.get(collection, []) if r.get("id") == identity]
    if len(matches) != 1:
        raise ValueError("Select one retained " + collection + " record: " + str(identity))
    return matches[0]


def _strict_json(raw):
    if not isinstance(raw, bytes) or not 1 <= len(raw) <= MAX_ANSWERS:
        raise ValueError("Application answers must contain 1 byte through 8 MiB.")
    def pairs(items):
        result = {}
        for key, value in items:
            if key in result:
                raise ValueError("Duplicate application JSON field: " + key)
            result[key] = value
        return result
    def invalid(value):
        raise ValueError("Non-finite JSON number: " + value)
    try:
        return json.loads(raw.decode("utf-8-sig"), object_pairs_hook=pairs,
                          parse_constant=invalid)
    except (UnicodeError, json.JSONDecodeError) as exc:
        raise ValueError("Supply complete UTF-8 application JSON.") from exc


def sections(markdown):
    """Retain exact complete section text and source line spans, including parents."""
    lines = markdown.splitlines(keepends=True)
    starts = []
    in_fence = False
    for i, line in enumerate(lines):
        if re.match(r"^\s*(?:\x60{3,}|~{3,})", line):
            in_fence = not in_fence
        if in_fence:
            continue
        match = re.match(r"^(#{1,6})\s+(.+?)\s*(?:\r?\n)?$", line)
        if match:
            starts.append((i, len(match[1]), match[2]))
    result = []
    for n, (start, level, heading) in enumerate(starts):
        finish = next((i for i, depth, title in starts[n+1:] if depth <= level), len(lines))
        body = "".join(lines[start:finish])
        result.append({"id": "section-" + _sha((str(start) + "\n" + heading).encode())[:24],
                       "heading": heading, "level": level, "start_line": start + 1,
                       "end_line": finish, "text": body, "sha256": _sha(body.encode())})
    return result


def _outline(markdown):
    def cells(line):
        text = line.strip()
        if not text.startswith("|") or not text.endswith("|"):
            raise ValueError("The retained outline must be a complete Markdown table.")
        return [part.replace(r"\|", "|").strip()
                for part in re.split(r"(?<!\\)\|", text[1:-1])]
    rows = [cells(line) for line in markdown.splitlines() if line.strip()]
    if len(rows) < 3 or len(rows[0]) != 3 or any(len(r) != 3 for r in rows):
        raise ValueError("The outline requires its original three columns and clause rows.")
    if not all(re.fullmatch(r":?-{3,}:?", c) for c in rows[1]):
        raise ValueError("The outline table separator is missing.")
    if any(not r[0] or not r[1] for r in rows[2:]):
        raise ValueError("Each outline row needs a clause identity and content.")
    if len({r[0] for r in rows[2:]}) != len(rows[2:]):
        raise ValueError("Outline clause identities must be unique.")
    return {"headings": rows[0], "rows": rows[2:], "original_markdown": markdown}


def parse_authoring(raw):
    """Map all twenty original inputs without replacing the retained source bytes."""
    value = _strict_json(raw)
    _object(value, AUTHORING_KEYS, "Original application authoring input")
    for key in ("date", "title", "proposalTitle", "frenchTitle",
                "selectedReviewStart", "selectedReviewEnd"):
        _text(value[key], key, empty=(key == "frenchTitle"))
    for key in ("responseMarkdown", "outlineTable"):
        _text(value[key], key, limit=MAX_ANSWERS)
    for key in ("sourceForm", "sourceRfp"):
        path = PurePosixPath(_text(value[key], key))
        if path.is_absolute() or ".." in path.parts or "\\" in value[key]:
            raise ValueError(key + " must remain a safe relative source locator.")
    if PurePosixPath(value["sourceForm"]).name != FORM["filename"] or value["sourceFormSha256"] != FORM["sha256"]:
        raise ValueError("Application input selects a different original issuer form.")
    if PurePosixPath(value["sourceRfp"]).name != RFP["filename"]:
        raise ValueError("Application input selects a different original issuer CFP.")
    phase = value["phaseAmounts"]
    if not isinstance(phase, list) or len(phase) != 4:
        raise ValueError("Supply four explicit SCC phase amounts.")
    phases = [_decimal(x, "Phase amount") for x in phase]
    rows = value["budgetRows"]
    if not isinstance(rows, list) or not 1 <= len(rows) <= 200:
        raise ValueError("Supply complete cost rows.")
    budget = []
    for i, row in enumerate(rows):
        if not isinstance(row, list) or len(row) != 5:
            raise ValueError("Each cost row needs a label and four phase amounts.")
        label = _text(row[0], "Cost row label")
        amounts = [_decimal(v, "Cost row phase amount") for v in row[1:]]
        budget.append({"row_index": i, "label": label,
                       "phase_cad": dict(zip(PHASES, [format(v, ".2f") for v in amounts])),
                       "total_cad": format(sum(amounts), ".2f")})
    summed = [sum(_decimal(r["phase_cad"][p], "Cost amount") for r in budget) for p in PHASES]
    base = _decimal(value["baseBudget"], "Base budget")
    ola = _decimal(value["olaMaximum"], "Additional OLA maximum")
    maximum = _decimal(value["maximumBudget"], "Maximum budget")
    if summed != phases or sum(phases) != base or base + ola != maximum:
        raise ValueError("Cost rows, four phase amounts, base and separate OLA maximum must reconcile.")
    fee = _decimal(value["engineeringFee"], "Engineering fee")
    milestones = value["subcontractMilestones"]
    if not isinstance(milestones, list) or not 1 <= len(milestones) <= 24:
        raise ValueError("Supply the original explicit subcontract payment amounts.")
    cash = [_decimal(v, "Commercial payment") for v in milestones]
    if sum(cash) != fee:
        raise ValueError("Commercial payment amounts must sum to the stated engineering fee.")
    weeks = value["engineeringWeeks"]
    if not isinstance(weeks, list) or len(weeks) != 4:
        raise ValueError("Supply engineering weeks separately for each of the four phases.")
    for v in weeks:
        _integer(v, "Engineering weeks", 0, 104)
    _integer(value["selectedReviewDays"], "Selected project review days", 0, 1000)
    answer_sections = sections(value["responseMarkdown"])
    answers = {key: [r["id"] for r in answer_sections if re.search(pattern, r["heading"])]
               for key, pattern in ANSWER_QUERIES.items()}
    return {
        "authored": deepcopy(value), "authoring_sha256": _sha(raw),
        "authoring_semantic_sha256": engine.digest(value),
        "sections": answer_sections, "answer_map": answers,
        "missing_answer_locators": [key for key, ids in answers.items() if not ids],
        "outline": _outline(value["outlineTable"]),
        "finance": {"currency": "CAD", "tax_basis": "excluding_hst",
                    "basis": "authored_proposal",
                    "rows": budget, "phase_cad": dict(zip(PHASES, [format(v, ".2f") for v in phases])),
                    "base_cad": format(base, ".2f"), "additional_ola_maximum_cad": format(ola, ".2f"),
                    "maximum_cad": format(maximum, ".2f"), "engineering_fee_cad": format(fee, ".2f"),
                    "commercial_payment_cad": [format(v, ".2f") for v in cash]},
        "schedule": {"engineering_weeks_by_phase": dict(zip(PHASES, weeks)),
                     "engineering_weeks_total": sum(weeks),
                     "selected_review_days": value["selectedReviewDays"],
                     "selected_review_start": value["selectedReviewStart"],
                     "selected_review_end": value["selectedReviewEnd"],
                     "calendar_months": None, "actual_start_month": None,
                     "note": "Calendar, weekly hours and payment triggers require explicit reviewed inputs; do not infer them from free text."},
    }


def _read_bound(state, source_id, read_source):
    source = _record(state, "sources", source_id)
    file = _record(state, "files", source.get("source_file_id"))
    raw, received_meta = read_source(source_id)
    if not isinstance(raw, bytes):
        raise ValueError("The original source reader must return bytes, not decoded or derived text.")
    if engine.canonical(received_meta) != engine.canonical(file):
        raise ValueError("Original source reader returned different retained file metadata.")
    if _sha(raw) != file.get("sha256") or len(raw) != file.get("bytes") or source.get("sha256") != file.get("sha256"):
        raise ValueError("Original source/file byte identity does not match the selected project.")
    return raw, {"source": deepcopy(source), "file": deepcopy(file)}



FORM_KEYS = (
    "applicant_organization", "signer_primary", "signer_alternate",
    "signer_primary_title", "signer_alternate_title", "contact_primary",
    "contact_alternate", "contact_primary_title", "contact_alternate_title",
    "email_primary", "email_alternate", "address_primary", "address_alternate",
    "start_month", "duration", "standards_evidence", "team_evidence", "roadmap",
    "language", "application_completeness", "canadian_eligibility", "budget",
    "attachments", "proposal_title", "scope", "sector", "standard_type",
    "process", "outline", "related_standards", "gap", "roadmap_mechanisms",
    "audience", "source_evidence", "stakeholder_support", "benefits", "schedule",
    "promotion_experience", "promotion_plan", "measurement",
)
DERIVED_FORM_KEYS = (
    "applicant_organization", "signer_primary", "signer_alternate",
    "signer_primary_title", "signer_alternate_title", "contact_primary",
    "contact_alternate", "contact_primary_title", "contact_alternate_title",
    "email_primary", "email_alternate", "address_primary", "address_alternate",
    "start_month", "duration", "proposal_title", "budget",
)
FORM_ANSWERS = {
    "standards_evidence": "M1", "team_evidence": "M2", "roadmap": "3a",
    "language": "M4", "application_completeness": "M5",
    "canadian_eligibility": "M6", "scope": "1a", "sector": "1a",
    "standard_type": "1b", "process": "1b", "outline": "1c",
    "related_standards": "2", "gap": "2", "roadmap_mechanisms": "3a",
    "audience": "3b", "source_evidence": "3c", "stakeholder_support": "3d",
    "benefits": "3e", "schedule": "4", "promotion_experience": "5a",
    "promotion_plan": "5b", "measurement": "5c",
}
PRESENTATION_KEYS = ("title", "date", "author", "subject", "footer",
                     "formFooter", "financialFooter", "documentTitles")
DOCUMENT_TITLES = {
    "application": "Original-form application",
    "responses": "Application continuation",
    "attachments": "Outline and schedule",
    "financial": "Original financial schedule",
    "offer": "Engineering workshare",
}
REVIEW_KEYS = (
    "authoring", "applicant", "roles", "requirements", "supporters", "schedule",
    "commercial", "formFields", "outlineMarkdown", "scheduleMarkdown",
    "offerMarkdown", "narrativeReviewed", "narrativeBasisSha256", "renderPresentation",
)


def _default_reviewed(mapped):
    fields = {key: "" for key in FORM_KEYS}
    sections_by_id = {row["id"]: row for row in mapped["sections"]}
    for field, answer in FORM_ANSWERS.items():
        ids = mapped["answer_map"].get(answer, [])
        if ids:
            token = "{{" + field + "}}"
            fields[field] = {"text": "See continuation: " + token + ".",
                             "references": [{"token": token,
                                             "section": sections_by_id[ids[0]]["heading"]}]}
    return {
        "authoring": deepcopy(mapped["authored"]),
        "applicant": {"status": "proposed", "legal_name": "", "country": "",
                      "establishment": "", "signers": [], "contacts": [], "source_ids": []},
        "roles": [],
        "requirements": [{"id": key, "status": "not_reviewed", "explanation": "",
                          "source_ids": []} for key in REQUIREMENTS],
        "supporters": [],
        "schedule": {"start_month": "", "months": None, "phase_months": [],
                     "hours_per_week": None, "engineering_hours": None,
                     "review_basis": "", "activities": []},
        "commercial": {"status": "proposed", "provider": "", "currency": "CAD",
                       "tax_basis": "excluding_hst",
                       "milestones": [{"title": "Payment " + str(i + 1),
                                       "amount_cad": amount, "trigger": ""}
                                      for i, amount in enumerate(mapped["finance"]["commercial_payment_cad"])],
                       "invoice_due_days": None, "defect_correction_days": None,
                       "included": [], "excluded": [], "responsibilities": [], "source_ids": []},
        "formFields": fields,
        "outlineMarkdown": mapped["authored"]["outlineTable"],
        "scheduleMarkdown": "", "offerMarkdown": "",
        "narrativeReviewed": False, "narrativeBasisSha256": None,
        "renderPresentation": {},
    }


def inspect_application_input(state, selection, read_source):
    """Read original bytes once through the owner's state-bound native reader.

    No application record, file, financial transaction or native state is mutated.
    Referenced private evidence is explicitly selected, never found by a filename guess.
    """
    required = ("answer_source_id", "form_source_id", "rfp_source_id",
                "edition_id", "engineering_budget_row")
    _object(selection, required + ("evidence_source_ids",),
            "Application source selection", required=required)
    selected = deepcopy(selection)
    selected.setdefault("evidence_source_ids", [])
    for key in ("answer_source_id", "form_source_id", "rfp_source_id", "edition_id"):
        _text(selected[key], key, limit=300)
    evidence_ids = _unique(selected["evidence_source_ids"], "Additional application evidence", 1000)
    raw, answer = _read_bound(state, selected["answer_source_id"], read_source)
    mapped = parse_authoring(raw)
    bindings = {"answers": answer}
    for role, profile in (("form", FORM), ("rfp", RFP)):
        original, binding = _read_bound(state, selected[role + "_source_id"], read_source)
        if len(original) != profile["bytes"] or _sha(original) != profile["sha256"]:
            raise ValueError("Select the exact retained original SCC " + role + " asset.")
        bindings[role] = binding
    if len({selected[k] for k in ("answer_source_id", "form_source_id", "rfp_source_id")}) != 3:
        raise ValueError("Answers, issuer form and issuer CFP must be distinct original sources.")
    for sid in evidence_ids:
        if any(b["source"]["id"] == sid for b in bindings.values()):
            continue
        _, binding = _read_bound(state, sid, read_source)
        bindings["evidence:" + sid] = binding
    edition = deepcopy(_record(state, "editions", selected["edition_id"]))
    if edition.get("sha256") != engine.digest(edition.get("snapshot")):
        raise ValueError("Selected native edition identity does not match its snapshot.")
    row = _integer(selected["engineering_budget_row"], "Engineering budget row",
                   0, len(mapped["finance"]["rows"]) - 1)
    if mapped["finance"]["rows"][row]["total_cad"] != mapped["finance"]["engineering_fee_cad"]:
        raise ValueError("The explicitly selected engineering cost row must match the engineering fee.")
    result = {
        "schema": SCHEMA, "profile": "SCC-CFP-2026-01",
        "project_id": state["id"], "project_revision": state["revision"], "mode": state["mode"],
        "selection": selected, "bindings": bindings,
        "source_ids": sorted({b["source"]["id"] for b in bindings.values()}),
        "edition": edition, "people": deepcopy(state.get("people", [])),
        "input": mapped, "default_reviewed": _default_reviewed(mapped),
        "form_keys": list(FORM_KEYS), "derived_form_keys": list(DERIVED_FORM_KEYS),
        "role_keys": list(ROLE_KEYS), "requirements": deepcopy(REQUIREMENTS),
        "issuer_assets": {"form": deepcopy(FORM), "rfp": deepcopy(RFP)},
        "legacy_renderer": deepcopy(LEGACY_RENDERER),
        "privacy": "private_application",
        "authority": {"signature_inserted": False, "eligibility_decided": False,
                      "funding_awarded": False, "submission_sent": False},
    }
    result["sha256"] = engine.digest(result)
    return result


def _validate_intake(intake):
    if not isinstance(intake, dict) or intake.get("schema") != SCHEMA:
        raise ValueError("Select the complete original application intake snapshot.")
    core = {key: value for key, value in intake.items() if key != "sha256"}
    if intake.get("sha256") != engine.digest(core):
        raise ValueError("Application intake snapshot identity changed.")


def source_closure(intake, state, read_source):
    """Reopen complete selected originals without rewriting historical source metadata."""
    _validate_intake(intake)
    if state.get("id") != intake["project_id"]:
        raise ValueError("The source closure belongs to another original project.")
    result = {}
    for binding in intake["bindings"].values():
        sid = binding["source"]["id"]
        raw, current = _read_bound(state, sid, read_source)
        if current["file"] != binding["file"] or current["source"]["source_file_id"] != binding["source"]["source_file_id"]:
            raise ValueError("A frozen application source is no longer the same retained original.")
        result[sid] = (raw, deepcopy(binding["file"]))
    return result


def _evidence(intake, source_ids):
    for sid in _unique(source_ids, "Reviewed evidence sources"):
        if sid not in intake["source_ids"]:
            raise ValueError("Select and inspect this original evidence source before using it: " + sid)


def _status(value, allowed, label):
    if value not in allowed:
        raise ValueError("Unsupported " + label + ".")
    return value


def _optional_int(value, label, maximum):
    if value is not None:
        _integer(value, label, 0, maximum)


def _validate_review(intake, reviewed):
    _object(reviewed, REVIEW_KEYS, "Reviewed application")
    # Full editable current inputs are distinct from immutable original answer bytes.
    current = parse_authoring(engine.canonical(reviewed["authoring"]).encode("utf-8"))
    row = intake["selection"]["engineering_budget_row"]
    if row >= len(current["finance"]["rows"]) or current["finance"]["rows"][row]["total_cad"] != current["finance"]["engineering_fee_cad"]:
        raise ValueError("The selected engineering cost row must still equal the complete engineering fee.")
    applicant = reviewed["applicant"]
    _object(applicant, ("status", "legal_name", "country", "establishment",
                       "signers", "contacts", "source_ids"), "Applicant")
    _status(applicant["status"], ("proposed", "confirmed"), "applicant status")
    for key in ("legal_name", "country", "establishment"):
        _text(applicant[key], "Applicant " + key, empty=applicant["status"] == "proposed")
    for key in ("signers", "contacts"):
        if not isinstance(applicant[key], list) or len(applicant[key]) > 2:
            raise ValueError("The original form supports primary and alternate " + key + ".")
        for item in applicant[key]:
            _object(item, ("name", "role", "email", "address"), "Applicant contact")
            for name, value in item.items():
                _text(value, "Applicant " + name, empty=True)
    _evidence(intake, applicant["source_ids"])
    if applicant["status"] == "confirmed" and not applicant["source_ids"]:
        raise ValueError("Confirmed applicant appointment requires its selected original evidence.")
    roles = reviewed["roles"]
    if not isinstance(roles, list) or len(roles) > 100:
        raise ValueError("Supply a bounded role list.")
    role_pairs = set()
    for role in roles:
        _object(role, ("role", "person_id", "status", "source_ids", "notes"), "Application role")
        _status(role["role"], ROLE_KEYS, "role")
        _status(role["status"], ("proposed", "confirmed"), "role status")
        _text(role["notes"], "Role notes", empty=True)
        person = _record(intake, "people", role["person_id"])
        pair = (role["role"], role["person_id"])
        if pair in role_pairs:
            raise ValueError("The same person and role must be recorded once.")
        role_pairs.add(pair)
        if person.get("authored_example") and intake["mode"] == "working":
            raise ValueError("An authored example person cannot become an actual application resource.")
        _evidence(intake, role["source_ids"])
        if role["status"] == "confirmed" and not role["source_ids"]:
            raise ValueError("Confirmed role requires its selected appointment evidence.")
    requirements = reviewed["requirements"]
    if (not isinstance(requirements, list) or len(requirements) != len(REQUIREMENTS)
            or {r.get("id") for r in requirements if isinstance(r, dict)} != set(REQUIREMENTS)):
        raise ValueError("Retain all seven original requirement reviews once.")
    for requirement in requirements:
        _object(requirement, ("id", "status", "explanation", "source_ids"), "Requirement review")
        _status(requirement["status"], ("not_reviewed", "evidence_received", "reviewed"), "requirement status")
        _text(requirement["explanation"], "Requirement explanation",
              empty=requirement["status"] == "not_reviewed")
        _evidence(intake, requirement["source_ids"])
        if requirement["status"] != "not_reviewed" and not requirement["source_ids"]:
            raise ValueError("A requirement review needs its actual selected evidence.")
    supporters = reviewed["supporters"]
    if not isinstance(supporters, list) or len(supporters) > 100:
        raise ValueError("Supply a bounded supporter list.")
    for supporter in supporters:
        _object(supporter, ("organization", "status", "contacts", "source_ids"), "Supporter")
        _text(supporter["organization"], "Supporter organization")
        _status(supporter["status"], ("prospective", "confirmed"), "support status")
        if not isinstance(supporter["contacts"], list) or len(supporter["contacts"]) > 2:
            raise ValueError("The original form permits at most two contacts per supporting party.")
        for contact in supporter["contacts"]:
            _object(contact, ("name", "email", "role"), "Support contact")
            for name, value in contact.items():
                _text(value, "Support contact " + name, empty=name != "name")
        _evidence(intake, supporter["source_ids"])
        if supporter["status"] == "confirmed" and not supporter["source_ids"]:
            raise ValueError("Confirmed support requires original selected evidence.")
    schedule = reviewed["schedule"]
    _object(schedule, ("start_month", "months", "phase_months", "hours_per_week",
                       "engineering_hours", "review_basis", "activities"), "Selected schedule")
    _text(schedule["start_month"], "Start month", empty=True)
    if schedule["start_month"] and not re.fullmatch(r"\d{4}-(0[1-9]|1[0-2])", schedule["start_month"]):
        raise ValueError("Start month must use YYYY-MM or remain unconfirmed.")
    months = schedule["months"]
    if months is not None:
        _integer(months, "Calendar months", 1, 60)
    if not isinstance(schedule["phase_months"], list):
        raise ValueError("Phase calendar must be a list.")
    if schedule["phase_months"]:
        if months is None or len(schedule["phase_months"]) != 4:
            raise ValueError("A phase calendar needs four ranges and an explicit full term.")
        for phase in schedule["phase_months"]:
            _object(phase, ("phase", "start", "end"), "Phase calendar")
            _integer(phase["start"], "Phase start", 1, months)
            _integer(phase["end"], "Phase end", phase["start"], months)
        if [p["phase"] for p in schedule["phase_months"]] != list(PHASES):
            raise ValueError("Keep calendar ranges in four-phase order.")
        if schedule["phase_months"][0]["start"] != 1 or schedule["phase_months"][-1]["end"] != months:
            raise ValueError("Phase ranges must cover the selected full term.")
        for before, after in zip(schedule["phase_months"], schedule["phase_months"][1:]):
            if after["start"] != before["end"] + 1:
                raise ValueError("Phase calendar cannot contain gaps or overlapping ranges.")
    weekly, hours = schedule["hours_per_week"], schedule["engineering_hours"]
    if (weekly is None) != (hours is None):
        raise ValueError("Supply weekly planning hours and total engineering hours together.")
    if weekly is not None:
        weekly = _decimal(weekly, "Planning hours per engineering week", 4)
        hours = _decimal(hours, "Planning engineering hours", 4)
        if weekly <= 0 or hours != current["schedule"]["engineering_weeks_total"] * weekly:
            raise ValueError("Explicit weekly hours and distributed active weeks must reconcile.")
    _text(schedule["review_basis"], "Review-period basis", empty=True)
    if not isinstance(schedule["activities"], list) or len(schedule["activities"]) > 200:
        raise ValueError("Supply a bounded schedule chart.")
    for activity in schedule["activities"]:
        _object(activity, ("label", "months", "responsibility"), "Schedule activity")
        _text(activity["label"], "Activity label")
        _text(activity["responsibility"], "Activity responsibility", empty=True)
        if months is None or not isinstance(activity["months"], list) or len(activity["months"]) != months:
            raise ValueError("Activity columns must match the selected calendar.")
        for text in activity["months"]:
            _text(text, "Activity month", empty=True, limit=300)
    commercial = reviewed["commercial"]
    _object(commercial, ("status", "provider", "currency", "tax_basis", "milestones",
                         "invoice_due_days", "defect_correction_days", "included",
                         "excluded", "responsibilities", "source_ids"), "Commercial scope")
    _status(commercial["status"], ("proposed", "confirmed"), "commercial status")
    if commercial["currency"] != "CAD" or commercial["tax_basis"] != "excluding_hst":
        raise ValueError("This application uses CAD excluding HST.")
    _text(commercial["provider"], "Engineering provider", empty=commercial["status"] == "proposed")
    _optional_int(commercial["invoice_due_days"], "Invoice terms", 365)
    _optional_int(commercial["defect_correction_days"], "Defect-correction period", 3650)
    payments = current["finance"]["commercial_payment_cad"]
    if not isinstance(commercial["milestones"], list) or len(commercial["milestones"]) != len(payments):
        raise ValueError("Retain every selected commercial payment separately from four funding phases.")
    for milestone, amount in zip(commercial["milestones"], payments):
        _object(milestone, ("title", "amount_cad", "trigger"), "Commercial payment")
        _text(milestone["title"], "Payment title")
        _text(milestone["trigger"], "Payment trigger", empty=commercial["status"] == "proposed")
        if _money(milestone["amount_cad"], "Commercial amount") != amount:
            raise ValueError("Commercial payment differs from the selected authored payment.")
    for key in ("included", "excluded", "responsibilities"):
        if not isinstance(commercial[key], list) or len(commercial[key]) > 200:
            raise ValueError("Supply a bounded commercial " + key + " list.")
        for value in commercial[key]:
            _text(value, "Commercial " + key)
    _evidence(intake, commercial["source_ids"])
    if commercial["status"] == "confirmed" and not commercial["source_ids"]:
        raise ValueError("Confirmed commercial terms need their selected original agreement evidence.")
    for key in ("outlineMarkdown", "scheduleMarkdown", "offerMarkdown"):
        _text(reviewed[key], key, empty=key != "outlineMarkdown", limit=MAX_ANSWERS)
    # This copy is a convenience editor of the one authoritative outline, not a second edition.
    if reviewed["outlineMarkdown"] != reviewed["authoring"]["outlineTable"]:
        raise ValueError("Outline Markdown must match this edition's authored outlineTable.")
    _object(reviewed["formFields"], FORM_KEYS, "Original form fields")
    headings = {section["heading"] for section in current["sections"]}
    for key, value in reviewed["formFields"].items():
        if isinstance(value, str):
            _text(value, "Form " + key, empty=True, limit=100000)
            continue
        _object(value, ("text", "references"), "Referenced form field")
        _text(value["text"], "Form " + key, empty=True, limit=100000)
        if not isinstance(value["references"], list) or len(value["references"]) > 30:
            raise ValueError("Supply a bounded list of actual continuation references.")
        tokens = set()
        for reference in value["references"]:
            _object(reference, ("token", "section"), "Continuation reference")
            token = _text(reference["token"], "Reference token", limit=300)
            heading = _text(reference["section"], "Reference heading", limit=1000)
            if token in tokens or token not in value["text"] or heading not in headings:
                raise ValueError("Form references must uniquely identify current continuation headings.")
            tokens.add(token)
    presentation = reviewed["renderPresentation"]
    _object(presentation, PRESENTATION_KEYS, "Render presentation", required=())
    for key, value in presentation.items():
        if key == "documentTitles":
            _object(value, DOCUMENT_TITLES, "Document titles")
            for title in value.values():
                _text(title, "Document title", limit=300)
        else:
            _text(value, "Presentation " + key, empty=False, limit=1000)
    if type(reviewed["narrativeReviewed"]) is not bool:
        raise ValueError("Narrative review must be an explicit boolean.")
    basis = reviewed["narrativeBasisSha256"]
    if basis is not None and (not isinstance(basis, str) or not re.fullmatch(r"[a-f0-9]{64}", basis)):
        raise ValueError("Narrative review basis must be the exact returned SHA-256.")
    return current


def _derived_fields(reviewed, current):
    applicant, schedule = reviewed["applicant"], reviewed["schedule"]
    out = {"applicant_organization": applicant["legal_name"],
           "start_month": schedule["start_month"],
           "duration": "" if schedule["months"] is None else str(schedule["months"]) + " months",
           "proposal_title": reviewed["authoring"]["proposalTitle"]}
    for n, suffix in enumerate(("primary", "alternate")):
        signer = applicant["signers"][n] if n < len(applicant["signers"]) else {}
        contact = applicant["contacts"][n] if n < len(applicant["contacts"]) else {}
        out["signer_" + suffix] = signer.get("name", "")
        out["signer_" + suffix + "_title"] = signer.get("role", "")
        out["contact_" + suffix] = contact.get("name", "")
        out["contact_" + suffix + "_title"] = contact.get("role", "")
        out["email_" + suffix] = contact.get("email", "")
        out["address_" + suffix] = contact.get("address", "")
    finance = current["finance"]
    out["budget"] = ("CAD " + finance["base_cad"] + " base; up to CAD " +
                     finance["additional_ola_maximum_cad"] +
                     " additional eligible official-language actuals; maximum CAD " +
                     finance["maximum_cad"] + "; excluding HST.")
    return out


def prepare_renderer_inputs(intake, reviewed):
    """Return the complete flat generic renderer contract without I/O.

    An unresolved draft is renderable and remains labelled draft. A current
    narrative review binds this entire edition; it does not confer eligibility,
    prime consent, a signature, award, standards approval or permission to submit.
    """
    _validate_intake(intake)
    reviewed = deepcopy(intake["default_reviewed"] if not reviewed else reviewed)
    current = _validate_review(intake, reviewed)
    review_fields = {key: value for key, value in reviewed.items()
                     if key not in ("narrativeReviewed", "narrativeBasisSha256")}
    basis_sha = engine.digest({"intake_sha256": intake["sha256"], "reviewed": review_fields})
    if reviewed["narrativeReviewed"] and reviewed["narrativeBasisSha256"] != basis_sha:
        raise ValueError("Narrative review belongs to different inputs; review this current full edition.")
    findings = []
    if not reviewed["narrativeReviewed"]:
        findings.append("Current narrative, form, budget, calendar, roles and payment terms are not yet reviewed together.")
    if reviewed["applicant"]["status"] != "confirmed":
        findings.append("Applicant appointment remains proposed; no signature or eligibility decision is recorded.")
    if not reviewed["applicant"]["legal_name"]:
        findings.append("Applicant legal identity is not completed.")
    if len({role["person_id"] for role in reviewed["roles"]}) < 2:
        findings.append("The actual two-person minimum team and corresponding evidence require completion.")
    for requirement in reviewed["requirements"]:
        if requirement["status"] != "reviewed":
            findings.append(requirement["id"] + " evidence has not been reviewed.")
    if reviewed["schedule"]["months"] is None or not reviewed["schedule"]["phase_months"]:
        findings.append("Calendar and four-phase month ranges remain unconfirmed.")
    if reviewed["schedule"]["engineering_hours"] is None:
        findings.append("Weekly engineering hours and the corresponding total remain unconfirmed.")
    if not reviewed["scheduleMarkdown"].strip():
        findings.append("The current schedule narrative remains blank.")
    if not reviewed["offerMarkdown"].strip():
        findings.append("The current commercial offer narrative remains blank.")
    if reviewed["commercial"]["status"] != "confirmed":
        findings.append("Engineering scope, cash triggers and invoice terms remain proposed.")
    if current["missing_answer_locators"]:
        findings.append("Original answer headings require review: " + ", ".join(current["missing_answer_locators"]))
    fields = deepcopy(reviewed["formFields"])
    fields.update(_derived_fields(reviewed, current))
    presentation = deepcopy(reviewed["renderPresentation"])
    title = reviewed["authoring"]["proposalTitle"]
    state_label = "Reviewed draft" if reviewed["narrativeReviewed"] else "Draft"
    presentation.setdefault("title", title)
    presentation.setdefault("date", reviewed["authoring"]["date"])
    presentation.setdefault("author", "TJLabs")
    if "tjlabs" not in presentation["author"].lower():
        presentation["author"] += " | TJLabs"
    presentation.setdefault("subject", "SCC application preparation; " + state_label.lower())
    presentation.setdefault("footer", "TJLabs | " + state_label)
    if "tjlabs" not in presentation["footer"].lower():
        presentation["footer"] += " | TJLabs"
    presentation.setdefault("formFooter", "SCC-CFP-2026-01 | " + state_label)
    presentation.setdefault("financialFooter", "CAD excluding HST | " + state_label)
    presentation.setdefault("documentTitles", deepcopy(DOCUMENT_TITLES))
    def ref(role):
        binding = intake["bindings"][role]
        return {"sourceId": binding["source"]["id"],
                "sha256": binding["file"]["sha256"], "bytes": binding["file"]["bytes"]}
    finance = current["finance"]
    provenance = {
        "schema": "scc.application-input-provenance.v1",
        "intakeSha256": intake["sha256"], "projectId": intake["project_id"],
        "projectRevision": intake["project_revision"], "selection": deepcopy(intake["selection"]),
        "originalAnswerSha256": intake["input"]["authoring_sha256"],
        "currentAuthoringSha256": current["authoring_semantic_sha256"],
        "authoring": deepcopy(reviewed["authoring"]), "finance": deepcopy(finance),
        "reviewed": deepcopy(reviewed), "sourceIds": deepcopy(intake["source_ids"]),
        "sourceBindings": deepcopy(intake["bindings"]),
        "editionId": intake["edition"]["id"], "editionSha256": intake["edition"]["sha256"],
        "people": deepcopy(intake["people"]), "derivedFormFields": list(DERIVED_FORM_KEYS),
        "narrativeReviewed": reviewed["narrativeReviewed"], "reviewBasisSha256": basis_sha,
        "findings": findings, "privacy": "private_application",
        "authority": deepcopy(intake["authority"]),
        "outputPolicy": {"freshSelectedEdition": True, "reuseOnlyCompleteInputIdentity": True,
                         "layoutOnlyOnChangedInputs": False, "includePriorOutputs": False},
    }
    return {
        "schema": RENDER_SCHEMA, "layoutId": "scc-cfp-2026-01-en-original-13-page.v1",
        **presentation, "responseMarkdown": reviewed["authoring"]["responseMarkdown"],
        "outlineMarkdown": reviewed["outlineMarkdown"],
        "scheduleMarkdown": reviewed["scheduleMarkdown"] or "## Schedule\n\nDraft: the current calendar and four-phase schedule have not been completed.\n",
        "offerMarkdown": reviewed["offerMarkdown"] or "## Engineering workshare\n\nDraft: the current scope, payment triggers and commercial terms have not been completed.\n", "sourceForm": ref("form"), "sourceRfp": ref("rfp"),
        "formFields": fields,
        "financial": {"currency": "CAD", "phaseAmounts": [finance["phase_cad"][p] for p in PHASES],
                      "baseBudget": finance["base_cad"], "olaMaximum": finance["additional_ola_maximum_cad"],
                      "maximumBudget": finance["maximum_cad"]},
        "inputProvenance": provenance,
    }
