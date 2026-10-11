"""The D1–D5 production model inside the original revisioned workspace."""
from __future__ import annotations

import copy
import hashlib
import re
import uuid
from datetime import date, datetime, timezone
from urllib.parse import urlparse

SCHEMA = "bologna-delivery/v1"
CRITERIA = ("traffic", "emissions", "publicSpace", "operatorAcceptance", "marketReadiness")
RATINGS = ("UNASSESSED", "FAVOURABLE", "MIXED", "ADVERSE", "NOT_APPLICABLE")
STREET_FIELDS = ("accessRules", "timeWindows", "vehicleCriteria", "deliverySpaces", "hubLockerConcepts", "tramPedestrianIntegration")
GOVERNANCE_FIELDS = ("replicationMethod", "enforcement", "roles", "sumpAlignment", "parkingAlignment", "tramAlignment", "evChargingAlignment", "monitoring")
SCENARIO_FIELDS = ("definition", "deliveryOrganisation", "vehicleTypes", "infrastructure", "innovation", "bestPractice")
TOOL_IDS = ("urbane-radar", "cert-cityqore")
RFP_URL = "https://netzerocities.eu/wp-content/uploads/2026/10/NZC-CESF-Procurement-RFP-SGA3-MCCC-029-Bologna-Urban-Logistic.pdf"


def now():
    return datetime.now(timezone.utc).isoformat()


def text(value, label, maximum=8000, required=False):
    if value is None and not required:
        return ""
    if not isinstance(value, str):
        raise ValueError(f"{label} must be text")
    value = value.strip()
    if (required and not value) or len(value) > maximum or "\x00" in value:
        raise ValueError(f"{label} is required and must fit within {maximum} characters" if required else f"{label} exceeds the supported size")
    return value


def obj(value, label):
    if not isinstance(value, dict):
        raise ValueError(f"{label} must be an object")
    return value


def items(value, label, maximum=100):
    if not isinstance(value, list) or len(value) > maximum:
        raise ValueError(f"{label} must be a list of at most {maximum} items")
    return value


def bi(value=None, label="Bilingual text", maximum=8000):
    value = {} if value is None else obj(value, label)
    return {lang: text(value.get(lang, ""), f"{label} ({lang})", maximum) for lang in ("en", "it")}


def ident(value, label="ID"):
    value = text(value, label, 100, True)
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]*", value):
        raise ValueError(f"{label} must use letters, numbers, dot, underscore or hyphen")
    return value


def day(value, label, required=False):
    value = text(value, label, 10, required)
    if value:
        try:
            parsed = date.fromisoformat(value)
        except ValueError as error:
            raise ValueError(f"{label} must be YYYY-MM-DD") from error
        if parsed.isoformat() != value:
            raise ValueError(f"{label} must be YYYY-MM-DD")
    return value


def url(value, label="Source URL", required=False):
    value = text(value, label, 2000, required)
    if value:
        parsed = urlparse(value)
        if parsed.scheme not in {"https", "http"} or not parsed.netloc or parsed.username or parsed.password:
            raise ValueError(f"{label} must be an HTTP(S) source without embedded credentials")
    return value


def unique(values, label, valid=None, maximum=30):
    values = [text(v, label, 160, True) for v in items(values, label, maximum)]
    if len(set(values)) != len(values):
        raise ValueError(f"{label} contains duplicate entries")
    if valid is not None and any(v not in valid for v in values):
        raise ValueError(f"{label} contains an unknown reference")
    return values


def defaults(state):
    scenarios = [{"id": s["id"], **{k: bi() for k in SCENARIO_FIELDS},
                  "criteria": {k: {"rating": "UNASSESSED", "note": bi()} for k in CRITERIA},
                  "sourceIds": [], "reviewer": "", "status": "DRAFT"} for s in state["scenarios"]]
    return {
        "schema": SCHEMA,
        "sources": [
            {"id": "rfp-sga3-mccc-029", "title": "NetZeroCities Bologna urban logistics RfP SGA3-MCCC-029", "url": RFP_URL,
             "locator": "Sections 3.4, 3.6, 3.11; original PDF pages 11–19", "observedAt": "2026-10-07", "license": "Source reference", "note": "D1–D5 task and deliverable requirements."},
            {"id": "bologna-loading-bays-2022", "title": "Bologna municipal loading-bay snapshot", "url": "https://opendata.comune.bologna.it/explore/dataset/stalli-carico-scarico/",
             "locator": "Original 264-row export", "observedAt": "2022-06-30", "license": "CC BY 4.0", "note": "264 dated points and 570 recorded spaces; original digest retained in workspace source."},
            {"id": "tram-bologna-notice-2026-09-24", "title": "Tram Bologna historic-centre notice", "url": "https://www.trambologna.it/cantieri/viabilita-alternativa/centro-storico/paged-3/16/",
             "locator": "Notice dated 24 September 2026", "observedAt": "2026-09-24", "license": "Source reference", "note": "Via delle Lame 37/c is a separate dated observation."},
        ],
        "method": {"tools": [{"id": k, "decision": "UNASSESSED", "dataCompatibility": bi(), "addedValue": bi(), "operatingGuidance": bi()} for k in TOOL_IDS],
                   "agreedMethod": bi(), "cityAgreement": "", "sourceIds": [], "reviewer": "", "status": "DRAFT"},
        "assessments": scenarios,
        "citySelection": {"scenarioIds": [], "record": "", "decidedAt": "", "recordedBy": "", "status": "PROPOSED"},
        "streets": [{"streetKey": k, "scenarioIds": [], **{f: bi() for f in STREET_FIELDS},
                     "sourceIds": [], "reviewer": "", "status": "DRAFT", "cityValidation": {"record": "", "date": "", "recordedBy": ""}} for k in state["baseline"]["streets"]],
        "milestones": [],
        "governance": {**{f: bi() for f in GOVERNANCE_FIELDS}, "sourceIds": [], "reviewer": "", "status": "DRAFT"},
        "interviews": [],
        "surveyPlan": {"audience": "", "municipalCoordinator": "", "distributionPlan": "", "reminderPlan": "", "reminderRecordedAt": "", "municipalityReference": "", "questions": []},
        "meetings": [],
        "documents": {"learning": {"pages": [], "reviewer": "", "status": "DRAFT"},
                      "factsheet": {"pages": [], "reviewer": "", "status": "DRAFT"},
                      "cesf": {"template": None, "answers": [], "reviewer": "", "status": "DRAFT"}},
        "history": [],
    }


def delivery_for(state):
    value = state.get("delivery")
    if value is None:
        value = defaults(state)
    if value.get("schema") != SCHEMA:
        raise ValueError("Unsupported delivery schema")
    value = copy.deepcopy(value)
    # PR1199 remains the authoritative native street/roadmap inventory. Rich
    # bilingual fields are extensions of those same records, keyed by their IDs.
    original_plans = {p["streetKey"]: p for p in state.get("streetPlans", [])}
    native_milestones = state.get("roadmap", {}).get("milestones", [])
    for street in value["streets"]:
        native = original_plans.get(street["streetKey"])
        if native and native.get("delivery"):
            street.update(copy.deepcopy(native["delivery"]))
            if native.get("reviewedAt") != street.get("nativeReviewAt"):
                street["status"] = "DRAFT"
                street["sourceChanged"] = True
    known = {m["id"] for m in value["milestones"]}
    for native in native_milestones:
        if native.get("delivery"):
            upsert(value["milestones"], copy.deepcopy(native["delivery"]), limit=80)
        elif native["id"] not in known:
            value["milestones"].append({"id": native["id"], "year": native["year"], "scope": "PRIORITY_STREETS",
                "title": {"en": native["milestone"], "it": ""}, "measure": bi(),
                "derogationCriteria": {"en": native["derogationCriteria"], "it": ""}, "incentiveConcept": bi(),
                "owner": native["owner"], "scenarioIds": [], "sourceIds": [], "reviewer": "", "status": "DRAFT",
                "originalSource": native["source"]})
    value["milestones"].sort(key=lambda m: (m["year"], m["id"]))
    return value


def references(value, delivery, key="sourceIds"):
    return unique(value.get(key, []), key, {s["id"] for s in delivery["sources"]})


def scenarios_for(value, state):
    return unique(value.get("scenarioIds", []), "scenarioIds", {s["id"] for s in state["scenarios"]}, 3)


def review(value, delivery):
    status = value.get("status", "DRAFT")
    if status not in {"DRAFT", "REVIEWED"}:
        raise ValueError("Status must be DRAFT or REVIEWED")
    reviewer = text(value.get("reviewer", ""), "Reviewer", 160, status == "REVIEWED")
    source_ids = references(value, delivery)
    if status == "REVIEWED" and not source_ids:
        raise ValueError("A reviewed entry needs its source references")
    return {"status": status, "reviewer": reviewer, "sourceIds": source_ids}


def upsert(collection, value, key="id", limit=300):
    for index, current in enumerate(collection):
        if current[key] == value[key]:
            collection[index] = value
            return
    if len(collection) >= limit:
        raise ValueError(f"This collection supports at most {limit} entries")
    collection.append(value)


def apply_delivery_action(state, payload):
    action = payload.get("action", "")
    if not isinstance(action, str) or not action.startswith("delivery"):
        return None
    delivery = delivery_for(state)
    value = obj(payload.get("value"), "value")
    record_id = None
    changed = None
    if action == "deliverySource":
        record_id = ident(value.get("id") or str(uuid.uuid4()))
        changed = {"id": record_id, "title": text(value.get("title"), "Title", 300, True),
                   "url": url(value.get("url", "")), "locator": text(value.get("locator", ""), "Page or source locator", 1000),
                   "observedAt": day(value.get("observedAt", ""), "Source date"), "license": text(value.get("license", ""), "License", 300),
                   "note": text(value.get("note", ""), "Source note")}
        if not changed["url"] and not changed["locator"]:
            raise ValueError("Provide a source URL or retained source locator")
        if record_id in {s["id"] for s in defaults(state)["sources"]}:
            raise ValueError("Original sources are immutable; add a new dated reference")
        upsert(delivery["sources"], changed)
    elif action == "deliveryMethod":
        tools = items(value.get("tools", []), "Method tools", 2)
        if {obj(t, "Tool").get("id") for t in tools} != set(TOOL_IDS):
            raise ValueError("Review both URBANE Radar and CERT Cityqore")
        clean_tools = []
        for tool in tools:
            decision = tool.get("decision", "UNASSESSED")
            if decision not in {"UNASSESSED", "USE", "USE_WITH_LIMITS", "NOT_SUITABLE", "NOT_AVAILABLE"}:
                raise ValueError("Unknown tool assessment")
            clean_tools.append({"id": tool["id"], "decision": decision, **{k: bi(tool.get(k), k) for k in ("dataCompatibility", "addedValue", "operatingGuidance")}})
        changed = {"tools": clean_tools, "agreedMethod": bi(value.get("agreedMethod")), "cityAgreement": text(value.get("cityAgreement", ""), "City method record"), **review(value, delivery)}
        delivery["method"] = changed
    elif action == "deliveryScenario":
        record_id = value.get("id")
        if record_id not in {s["id"] for s in state["scenarios"]}:
            raise ValueError("Unknown original scenario")
        supplied = obj(value.get("criteria"), "Scenario criteria")
        if set(supplied) != set(CRITERIA):
            raise ValueError("Use all five RfP criteria: traffic, emissions, publicSpace, operatorAcceptance, marketReadiness")
        criteria = {}
        for key in CRITERIA:
            entry = obj(supplied[key], key)
            if entry.get("rating") not in RATINGS:
                raise ValueError(f"Unknown {key} rating")
            criteria[key] = {"rating": entry["rating"], "note": bi(entry.get("note"), key)}
        changed = {"id": record_id, **{k: bi(value.get(k), k) for k in SCENARIO_FIELDS}, "criteria": criteria, **review(value, delivery)}
        upsert(delivery["assessments"], changed)
    elif action == "deliverySelection":
        status = value.get("status", "PROPOSED")
        if status not in {"PROPOSED", "RECORDED"}:
            raise ValueError("Selection must be PROPOSED or RECORDED")
        selected = scenarios_for(value, state)
        if status == "RECORDED" and not selected:
            raise ValueError("A recorded City selection must name a scenario")
        changed = {"scenarioIds": selected, "status": status,
                   "record": text(value.get("record", ""), "City decision record", required=status == "RECORDED"),
                   "decidedAt": day(value.get("decidedAt", ""), "City decision date", status == "RECORDED"),
                   "recordedBy": text(value.get("recordedBy", ""), "Recorded by", 160, status == "RECORDED")}
        delivery["citySelection"] = changed
    elif action == "deliveryStreet":
        record_id = value.get("streetKey")
        if record_id not in state["baseline"]["streets"]:
            raise ValueError("Choose one of the four priority streets")
        validation = obj(value.get("cityValidation", {}), "City validation")
        city_record = text(validation.get("record", ""), "City validation record")
        changed = {"streetKey": record_id, "scenarioIds": scenarios_for(value, state), **{k: bi(value.get(k), k) for k in STREET_FIELDS},
                   **review(value, delivery), "cityValidation": {"record": city_record,
                   "date": day(validation.get("date", ""), "City validation date", bool(city_record)),
                   "recordedBy": text(validation.get("recordedBy", ""), "Validation recorded by", 160, bool(city_record))}}
        upsert(delivery["streets"], changed, "streetKey", 4)
        native = next((p for p in state.get("streetPlans", []) if p["streetKey"] == record_id), None)
        if native is not None:
            changed["nativeReviewAt"] = now()
            if native.get("reviewedAt"):
                native.setdefault("priorReviews", []).append({"fields": copy.deepcopy(native["fields"]), "status": native["status"], "reviewer": native["reviewer"], "reviewedAt": native["reviewedAt"]})
            native["delivery"] = copy.deepcopy(changed)
            mapping = {"accessWindows": "timeWindows", "vehicleCriteria": "vehicleCriteria", "loadingSpaces": "deliverySpaces", "hubLockerConcepts": "hubLockerConcepts"}
            for old_key, new_key in mapping.items():
                if any(changed[new_key].values()):
                    native["fields"][old_key] = {"value": changed[new_key]["it"] or changed[new_key]["en"], "source": "; ".join(changed["sourceIds"])}
            native.update(status=changed["status"], reviewer=changed["reviewer"], reviewedAt=changed["nativeReviewAt"])
    elif action == "deliveryMilestone":
        record_id = ident(value.get("id") or str(uuid.uuid4()))
        year = value.get("year")
        if type(year) is not int or not 2026 <= year <= 2030:
            raise ValueError("Roadmap year must be between 2026 and 2030")
        scope = value.get("scope")
        if scope not in {"PRIORITY_STREETS", "WIDER_ZTL"}:
            raise ValueError("Roadmap scope must be PRIORITY_STREETS or WIDER_ZTL")
        changed = {"id": record_id, "year": year, "scope": scope, "title": bi(value.get("title"), "Milestone title", 400),
                   "scenarioIds": scenarios_for(value, state), **{k: bi(value.get(k), k) for k in ("measure", "derogationCriteria", "incentiveConcept")},
                   "owner": text(value.get("owner", ""), "Responsible role", 300), **review(value, delivery)}
        if not any(changed["title"].values()):
            raise ValueError("Milestone title is required")
        upsert(delivery["milestones"], changed, limit=80)
        delivery["milestones"].sort(key=lambda x: (x["year"], x["id"]))
        native_rows = state.setdefault("roadmap", {"targetYear": 2030, "sumpAlignmentYear": 2027, "milestones": []})["milestones"]
        previous = next((m for m in native_rows if m["id"] == record_id), None)
        native = {"id": record_id, "year": year, "milestone": changed["measure"]["it"] or changed["measure"]["en"] or changed["title"]["it"] or changed["title"]["en"],
                  "derogationCriteria": changed["derogationCriteria"]["it"] or changed["derogationCriteria"]["en"],
                  "source": "; ".join(changed["sourceIds"]) or (previous or {}).get("source", ""), "owner": changed["owner"],
                  "createdAt": (previous or {}).get("createdAt") or now(), "delivery": copy.deepcopy(changed)}
        upsert(native_rows, native, limit=80)
        native_rows.sort(key=lambda m: (m["year"], m["createdAt"]))
    elif action == "deliveryGovernance":
        changed = {**{k: bi(value.get(k), k) for k in GOVERNANCE_FIELDS}, **review(value, delivery)}
        delivery["governance"] = changed
    elif action == "deliveryInterview":
        record_id = ident(value.get("id") or str(uuid.uuid4()))
        changed = {"id": record_id, "title": text(value.get("title"), "Interview source title", 300, True),
                   "streetKeys": unique(value.get("streetKeys", []), "Street references", set(state["baseline"]["streets"]), 4),
                   "scenarioIds": scenarios_for(value, state), "finding": bi(value.get("finding")), "implication": bi(value.get("implication")),
                   "sourceIds": references(value, delivery), "reviewer": text(value.get("reviewer", ""), "Analyst", 160)}
        upsert(delivery["interviews"], changed)
    elif action == "deliverySurveyPlan":
        changed = {k: text(value.get(k, ""), k, 8000) for k in ("audience", "municipalCoordinator", "distributionPlan", "reminderPlan", "municipalityReference")}
        changed["reminderRecordedAt"] = day(value.get("reminderRecordedAt", ""), "Coordinated reminder date")
        prior_reminder = delivery["surveyPlan"].get("reminderRecordedAt")
        if prior_reminder and changed["reminderRecordedAt"] != prior_reminder:
            raise ValueError("The completed single reminder round is already recorded")
        if changed["reminderRecordedAt"] and not changed["municipalityReference"]:
            raise ValueError("Record the municipal coordination reference for the reminder")
        questions = []
        for q in items(value.get("questions", []), "Italian survey questions", 40):
            q = obj(q, "Survey question")
            kind = q.get("type", "text")
            if kind not in {"text", "single", "integer"}:
                raise ValueError("Survey question type must be text, single or integer")
            options = unique(q.get("options", []), "Survey options", maximum=30)
            if kind == "single" and len(options) < 2:
                raise ValueError("A single-choice question needs at least two options")
            if kind != "single" and options:
                raise ValueError("Only single-choice questions use options")
            questions.append({"id": ident(q.get("id"), "Question ID"), "prompt": text(q.get("prompt"), "Italian question", 1000, True), "type": kind, "options": options})
        unique([q["id"] for q in questions], "Question IDs", maximum=40)
        changed["questions"] = questions
        delivery["surveyPlan"] = changed
    elif action == "deliveryMeeting":
        record_id = ident(value.get("id") or str(uuid.uuid4()))
        changed = {"id": record_id, "title": text(value.get("title"), "Italian presentation title", 300, True),
                   "audience": text(value.get("audience", ""), "Audience", 500), "body": text(value.get("body", ""), "Italian presentation", 30000),
                   "sourceIds": references(value, delivery), "cityReference": text(value.get("cityReference", ""), "Municipal meeting reference", 2000)}
        upsert(delivery["meetings"], changed, limit=2)
    elif action == "deliveryDocument":
        kind = payload.get("kind")
        if kind not in {"learning", "factsheet"}:
            raise ValueError("Choose learning or factsheet")
        pages = []
        for p in items(value.get("pages", []), "Document pages", 10 if kind == "learning" else 2):
            p = obj(p, "Document page")
            pages.append({"title": text(p.get("title"), "Page title", 200, True), "body": text(p.get("body", ""), "English page body", 4800), "sourceIds": references(p, delivery)})
        status = value.get("status", "DRAFT")
        if status not in {"DRAFT", "REVIEWED"}:
            raise ValueError("Document status must be DRAFT or REVIEWED")
        changed = {"pages": pages, "reviewer": text(value.get("reviewer", ""), "Document reviewer", 160, status == "REVIEWED"), "status": status}
        delivery["documents"][kind] = changed
    elif action == "deliveryTemplate":
        sections = []
        for s in items(value.get("sections", []), "Original template sections", 100):
            s = obj(s, "Template section")
            sections.append({"id": ident(s.get("id"), "Template section ID"), "title": text(s.get("title"), "Original section title", 400, True)})
        if not sections:
            raise ValueError("Map the supplied template's actual sections")
        unique([s["id"] for s in sections], "Template section IDs", maximum=100)
        content = text(value.get("content"), "Original template text", 300000, True)
        for section in sections:
            if section["title"] not in content:
                raise ValueError("Every mapped section title must occur in the retained template text")
        changed = {"title": text(value.get("title"), "Template title", 300, True), "url": url(value.get("url", "")),
                   "receivedAt": day(value.get("receivedAt"), "Template received date", True), "content": content,
                   "sha256": hashlib.sha256(content.encode("utf-8")).hexdigest(), "sections": sections}
        current = delivery["documents"]["cesf"]
        old_answers = {a["sectionId"]: a for a in current["answers"]}
        if current.get("template") and current["template"]["sha256"] != changed["sha256"]:
            # Prior template and answer versions remain in history/publications.
            current["answers"] = [old_answers[s["id"]] for s in sections if s["id"] in old_answers]
            current["status"] = "DRAFT"
        current["template"] = changed
    elif action == "deliveryCesf":
        current = delivery["documents"]["cesf"]
        template = current["template"]
        if template is None:
            raise ValueError("Register the supplied CESF template first")
        allowed = {s["id"] for s in template["sections"]}
        answers = []
        for answer in items(value.get("answers", []), "CESF answers", 100):
            answer = obj(answer, "CESF answer")
            section_id = answer.get("sectionId")
            if section_id not in allowed:
                raise ValueError("CESF answer references an unknown template section")
            answers.append({"sectionId": section_id, "body": text(answer.get("body", ""), "CESF answer", 20000), "sourceIds": references(answer, delivery)})
        unique([a["sectionId"] for a in answers], "CESF answer section IDs", allowed, 100)
        status = value.get("status", "DRAFT")
        if status not in {"DRAFT", "REVIEWED"}:
            raise ValueError("CESF status must be DRAFT or REVIEWED")
        changed = {"template": template, "answers": answers, "reviewer": text(value.get("reviewer", ""), "CESF reviewer", 160, status == "REVIEWED"), "status": status}
        delivery["documents"]["cesf"] = changed
    else:
        raise ValueError("Unknown delivery action")
    # Preserve each replaced record, including a document/template revision, in
    # the same private state so editing never destroys earlier analyst material.
    event = {"action": action, "recordId": record_id, "at": now(), "workspaceRevision": state["revision"] + 1, "value": copy.deepcopy(changed)}
    delivery["history"].append(event)
    state["delivery"] = delivery
    return {"event": action, "id": record_id}


def populated(value):
    return isinstance(value, dict) and all(bool(value.get(lang, "").strip()) for lang in ("en", "it"))


def readiness(state, delivery=None):
    d = delivery_for(state) if delivery is None else delivery
    checks = []
    def add(group, label, complete, detail):
        checks.append({"deliverable": group, "label": label, "complete": bool(complete), "detail": detail})
    add("D1", "Inception method", populated(d["method"]["agreedMethod"]) and bool(d["method"]["cityAgreement"]), "URBANE Radar and CERT Cityqore compatibility and the agreed method")
    assessed = sum(all(x["criteria"][k]["rating"] != "UNASSESSED" and populated(x["criteria"][k]["note"]) for k in CRITERIA) for x in d["assessments"])
    add("D2", "Scenario matrix", 2 <= assessed <= 3, f"{assessed} scenarios have all five source-specific criteria in Italian and English")
    add("D2", "City scenario record", d["citySelection"]["status"] == "RECORDED", f"{len(d['citySelection']['scenarioIds'])} scenario selections retained")
    complete_streets = sum(all(populated(s[k]) for k in STREET_FIELDS) and bool(s["scenarioIds"]) and not s.get("sourceChanged") for s in d["streets"])
    add("D3", "Four street frameworks", complete_streets == 4, f"{complete_streets}/4 have all six bilingual fields and scenario links")
    validated = sum(bool(s["cityValidation"]["record"]) for s in d["streets"])
    add("D3", "Municipal validation", validated == 4, f"{validated}/4 municipal validation records retained")
    years = {m["year"] for m in d["milestones"]}
    add("D3", "2030 progression", 2030 in years and any(y < 2030 for y in years), f"{len(d['milestones'])} milestones across {', '.join(map(str, sorted(years))) or 'no recorded years'}")
    add("D3", "Replication and governance", all(populated(d["governance"][k]) for k in GOVERNANCE_FIELDS), "Includes enforcement, SUMP, parking, tram and EV charging alignment")
    add("D3", "Italian survey instrument", bool(d["surveyPlan"]["questions"]), f"{len(d['surveyPlan']['questions'])} questions; one coordinated reminder round")
    responses = len(state["survey"]["responses"])
    add("D3", "Survey returns", responses >= state["survey"]["targetMin"], f"{responses} supplied responses against the 30–50 target")
    for kind, label in (("learning", "Learning note"), ("factsheet", "Replication factsheet")):
        pages = d["documents"][kind]["pages"]
        add("D4", label, bool(pages) and all(p["body"] for p in pages), f"{len(pages)} authored English pages; print preview checks physical pagination")
    cesf = d["documents"]["cesf"]
    add("D5", "Supplied CESF template", cesf["template"] is not None, cesf["template"]["title"] if cesf["template"] else "Register the template when NetZeroCities supplies it")
    sections = {s["id"] for s in cesf["template"]["sections"]} if cesf["template"] else set()
    filled = {a["sectionId"] for a in cesf["answers"] if a["body"]}
    add("D5", "Template answers", bool(sections) and sections <= filled, f"{len(filled)}/{len(sections)} supplied template sections have answers")
    return {"complete": sum(c["complete"] for c in checks), "total": len(checks), "checks": checks}


def public_delivery(state):
    delivery = delivery_for(state)
    delivery["readiness"] = readiness(state, delivery)
    return delivery
