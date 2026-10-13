"""Operator-managed delivery risks and actions in the original SF47 case.

All editions use the original Operations review/event/request tables. This
module records the operator's judgments; it does not gate other workflows or
change the original planning, cash, funding or acceptance calculations.
"""
from __future__ import annotations

from copy import deepcopy
from html import escape
import json
import re
import uuid

from model import Problem, canonical, digest, now, text, csv_bytes
import operations_domain as domain
import forecast as forecasts

SCHEMA = "stellar-forge.sf47-delivery-risks.v1"
PURPOSE = "DELIVERY_RISK_REGISTER"
ACTION = "risk-register.save"
ENGINE_VERSION = 1
MAX_DOCUMENT = 2 * 1024 * 1024
STATUSES = ("OPEN", "MONITORING", "MITIGATING", "RESOLVED", "CLOSED")
ACTION_STATUSES = ("PLANNED", "IN_PROGRESS", "DONE", "CANCELLED")
CATEGORIES = ("DELIVERY", "STAFFING", "CUSTOMER", "FUNDING", "TECHNICAL", "SECURITY", "EXTERNAL", "OTHER")
LIKELIHOODS = ("UNASSESSED", "UNLIKELY", "POSSIBLE", "LIKELY", "NOT_APPLICABLE")
IMPACTS = ("UNASSESSED", "MINOR", "MODERATE", "MAJOR")
PRIORITIES = ("UNASSESSED", "LOW", "MEDIUM", "HIGH")
SOURCE_FIELDS = {"sourceIds", "sourceNote", "sourceBasis"}
SELECTION_FILES = {"risk-register-selection.json", "risk-register.json", "risk-register.csv",
                   "risk-actions.csv", "risk-register.html"}
NOTICE = ("Assessments and actions are recorded operator judgments; other case workflows remain available.")


def fail(message, code="INVALID_RISK_REGISTER", status=422):
    raise Problem(message, status, code)


def obj(value, fields, label):
    if not isinstance(value, dict) or set(value) - set(fields):
        fail(label + ": use the complete declared object fields.")
    return value


def rows(value, label, maximum):
    if not isinstance(value, list) or len(value) > maximum or any(not isinstance(row, dict) for row in value):
        fail(label + ": use at most " + str(maximum) + " object rows.")
    return value


def ident(value, label):
    if not isinstance(value, str) or not re.fullmatch(r"[a-z][a-z0-9-]{1,99}", value):
        fail(label + ": use the retained lowercase record identity.")
    return value


def observed(value, label, as_of, optional=False):
    stamp = domain.calendar(value, label, optional)
    if stamp and stamp > as_of:
        fail(label + ": the observation must not follow the register's as-of date.")
    return stamp


def owner(value, context):
    if value in (None, ""):
        return None
    if not isinstance(value, str):
        fail("Select an original contributor identity or leave the owner unassigned.")
    if value not in {row["id"] for row in context["records"]["contributors"]}:
        fail("Select an original contributor or leave the owner explicitly unassigned.")
    return value


def source_ids(document):
    return sorted({sid for risk in document["risks"] for part in [risk] + risk["actions"]
                   for sid in part["sourceIds"]})


def package_ids(document):
    return sorted({rid for risk in document["risks"] for rid in risk["costIds"]})


def owner_ids(document):
    return sorted({part["ownerId"] for risk in document["risks"] for part in [risk] + risk["actions"]
                   if part["ownerId"] is not None})


def normalize(context, raw):
    obj(raw, {"schema", "name", "asOfDate", "note", "supersedes", "risks"}, "Risk register")
    if raw.get("schema") != SCHEMA:
        fail("Use the supported complete delivery risk register.")
    as_of = domain.calendar(raw.get("asOfDate"), "Register as-of date")
    risks, seen_risks, seen_actions = [], set(), set()
    for entered in rows(raw.get("risks", []), "Risks and issues", 200):
        obj(entered, {"id", "kind", "title", "description", "category", "identifiedOn", "ownerId", "ownerNote",
            "status", "likelihood", "impact", "priority", "assessmentNote", "trigger", "nextReviewOn",
            "costIds", "review", "resolution", "actions", *SOURCE_FIELDS}, "Risk or issue")
        rid = ident(entered.get("id"), "Risk or issue identity")
        if rid in seen_risks:
            fail("Risk and issue identities must be distinct.")
        seen_risks.add(rid)
        kind = domain.enum(entered.get("kind"), ("RISK", "ISSUE"), "Record kind")
        likelihood = domain.enum(entered.get("likelihood", "UNASSESSED"), LIKELIHOODS, "Entered likelihood")
        if (kind == "ISSUE") != (likelihood == "NOT_APPLICABLE"):
            fail("An observed issue uses NOT_APPLICABLE likelihood; a risk retains its entered likelihood.")
        identified = observed(entered.get("identifiedOn"), "Original identification date", as_of)
        costs = entered.get("costIds", [])
        if (not isinstance(costs, list) or len(costs) > 200 or any(not isinstance(x, str) for x in costs)
                or len(costs) != len(set(costs))):
            fail("Select distinct original package identities.")
        for cost in costs:
            text(cost, "Original package identity", 300, True)
        review = obj(entered.get("review", {}), {"on", "by", "note"}, "Dated risk review")
        review = {"on": observed(review.get("on"), "Review date", as_of, True),
                  "by": text(review.get("by", ""), "Reviewing person", 300),
                  "note": text(review.get("note", ""), "Review note", 12000)}
        if any(review.values()) and not all(review.values()):
            fail("A recorded review needs its date, reviewing person and note.")
        if review["on"] and review["on"] < identified:
            fail("A review must not precede the recorded identification date.")
        resolution = obj(entered.get("resolution", {}), {"on", "note"}, "Resolution")
        resolution = {"on": observed(resolution.get("on"), "Resolution date", as_of, True),
                      "note": text(resolution.get("note", ""), "Resolution and remaining limitations", 12000)}
        if any(resolution.values()) and not all(resolution.values()):
            fail("A recorded resolution needs its original date and explanation.")
        if resolution["on"] and resolution["on"] < identified:
            fail("A resolution must not precede identification.")
        status = domain.enum(entered.get("status", "OPEN"), STATUSES, "Recorded risk status")
        if status in ("RESOLVED", "CLOSED") and (not all(resolution.values()) or not all(review.values())):
            fail("A resolved or closed item needs a dated review and its actual resolution.")
        next_review = domain.calendar(entered.get("nextReviewOn"), "Next review date", True)
        if next_review and next_review < identified:
            fail("The next review date must not precede identification.")
        actions = []
        for action in rows(entered.get("actions", []), "Mitigation actions", 100):
            obj(action, {"id", "title", "description", "ownerId", "ownerNote", "status", "dueOn",
                         "completedOn", "progress", *SOURCE_FIELDS}, "Mitigation action")
            aid = ident(action.get("id"), "Action identity")
            if aid in seen_actions:
                fail("Action identities must be distinct across the complete register.")
            seen_actions.add(aid)
            action_status = domain.enum(action.get("status", "PLANNED"), ACTION_STATUSES, "Action status")
            completed = observed(action.get("completedOn"), "Action completion or cancellation date", as_of, True)
            progress = text(action.get("progress", ""), "Action progress or outcome", 12000)
            if action_status in ("DONE", "CANCELLED") and (not completed or not progress):
                fail("A completed or cancelled action needs its actual date and outcome.")
            if action_status in ("PLANNED", "IN_PROGRESS") and completed:
                fail("An unfinished action has no completed date; its earlier completion stays in the previous edition.")
            if completed and completed < identified:
                fail("An action completion must not precede this item's identification.")
            actions.append({"id": aid, "title": text(action.get("title"), "Action title", 500, True),
                "description": text(action.get("description", ""), "Action description", 12000),
                "ownerId": owner(action.get("ownerId"), context),
                "ownerNote": text(action.get("ownerNote", ""), "Action responsibility note", 4000),
                "status": action_status, "dueOn": domain.calendar(action.get("dueOn"), "Action due date", True),
                "completedOn": completed, "progress": progress,
                **domain.source_fields(action, context["sources"])})
        risks.append({"id": rid, "kind": kind, "title": text(entered.get("title"), "Risk or issue title", 500, True),
            "description": text(entered.get("description", ""), "Cause, event and delivery effect", 12000),
            "category": domain.enum(entered.get("category", "OTHER"), CATEGORIES, "Risk category"),
            "identifiedOn": identified, "ownerId": owner(entered.get("ownerId"), context),
            "ownerNote": text(entered.get("ownerNote", ""), "Responsibility note", 4000), "status": status,
            "likelihood": likelihood, "impact": domain.enum(entered.get("impact", "UNASSESSED"), IMPACTS, "Entered impact"),
            "priority": domain.enum(entered.get("priority", "UNASSESSED"), PRIORITIES, "Entered priority"),
            "assessmentNote": text(entered.get("assessmentNote", ""), "Assessment basis", 12000),
            "trigger": text(entered.get("trigger", ""), "Trigger or observed issue", 12000),
            "nextReviewOn": next_review, "costIds": list(costs), "review": review,
            "resolution": resolution, "actions": actions, **domain.source_fields(entered, context["sources"])})
    supersedes = raw.get("supersedes")
    if supersedes is not None:
        obj(supersedes, {"reviewId", "reviewSha256"}, "Prior register edition")
        supersedes = {"reviewId": ident(supersedes.get("reviewId"), "Prior review"),
                      "reviewSha256": domain.sha(supersedes.get("reviewSha256"), "Prior review digest", False)}
    result = {"schema": SCHEMA, "name": text(raw.get("name"), "Register name", 300, True),
              "asOfDate": as_of, "note": text(raw.get("note", ""), "Register basis", 12000),
              "supersedes": supersedes, "risks": risks}
    if len(canonical(result).encode("utf-8")) > MAX_DOCUMENT:
        fail("The complete register exceeds its 2 MiB bound.", status=413)
    return result


def validate_successor(context, document, previous):
    current_costs = {row["id"] for row in context["plan"]["scenario"]["future_costs"]}
    old_document = previous["riskRegister"]["document"] if previous else None
    old_rows = {row["id"]: row for row in old_document["risks"]} if old_document else {}
    new_rows = {row["id"]: row for row in document["risks"]}
    expected = {"reviewId": previous["id"], "reviewSha256": previous["sha256"]} if previous else None
    if document["supersedes"] != expected:
        fail("Reopen the current register before saving its successor.", "RISK_HEAD_CHANGED", 409)
    if old_document and document["asOfDate"] < old_document["asOfDate"]:
        fail("A following register must not predate its preceding edition.")
    if set(old_rows) - set(new_rows):
        fail("Keep earlier items in the register; record resolution or closure with their original identities.")
    for row in document["risks"]:
        old = old_rows.get(row["id"])
        if any(cid not in current_costs and (old is None or cid not in old["costIds"]) for cid in row["costIds"]):
            fail("A new package link must select an original package in the current case plan.")
        if old is None:
            continue
        if row["identifiedOn"] != old["identifiedOn"]:
            fail("Retain the original identification date; explain a source correction in the review.")
        if old["kind"] == "ISSUE" and row["kind"] != "ISSUE":
            fail("An observed issue stays an issue; record its resolution or a distinct later risk.")
        old_actions = {action["id"]: action for action in old["actions"]}
        if set(old_actions) - {action["id"] for action in row["actions"]}:
            fail("Keep earlier mitigation actions; record cancellation instead of removing their identities.")
        if row != old:
            review = row["review"]
            if (not all(review.values()) or review["on"] < old_document["asOfDate"]):
                fail("A changed existing item needs a current dated review, reviewing person and explanation.")
    # An existing action cannot move silently to a different risk.
    prior_owners = {a["id"]: r["id"] for r in old_rows.values() for a in r["actions"]}
    for risk in document["risks"]:
        for action in risk["actions"]:
            if action["id"] in prior_owners and prior_owners[action["id"]] != risk["id"]:
                fail("Retain each mitigation action under its original risk or issue.")


def binding(context, document):
    people = {row["id"]: row for row in context["records"]["contributors"]}
    costs = {row["id"]: row for row in context["plan"]["scenario"]["future_costs"]}
    return {"mode": context["program"]["mode"], "planContentSha256": context["plan"]["contentSha256"],
            "planSourceSha256": context["plan"]["source"]["sha256"],
            "contributors": [deepcopy(people[rid]) for rid in owner_ids(document)],
            "packages": [{"id": cid, "current": deepcopy(costs.get(cid))} for cid in package_ids(document)],
            "sources": [deepcopy(context["sources"][sid]) for sid in source_ids(document)]}


def source(context, document):
    return {**forecasts.source_identity(context), "bindingSha256": digest(binding(context, document))}


def report(context, document):
    people = {row["id"]: row for row in context["records"]["contributors"]}
    costs = {row["id"]: row for row in context["plan"]["scenario"]["future_costs"]}
    counts = {key: 0 for key in ("total", "open", "monitoring", "mitigating", "resolved", "closed",
                                "risks", "issues", "unassigned", "overdueReviews", "overdueActions")}
    entries = []
    def person(pid):
        return {key: people[pid].get(key, "") for key in ("id", "name", "kind", "contact")} if pid else None
    for risk in document["risks"]:
        counts["total"] += 1
        counts[risk["status"].lower()] += 1
        counts["risks" if risk["kind"] == "RISK" else "issues"] += 1
        findings = []
        active = risk["status"] not in ("RESOLVED", "CLOSED")
        overdue = bool(active and risk["nextReviewOn"] and risk["nextReviewOn"] < document["asOfDate"])
        if risk["ownerId"] is None:
            counts["unassigned"] += 1
            findings.append({"code": "OWNER_UNASSIGNED", "message": "The item has no named original contributor."})
        if overdue:
            counts["overdueReviews"] += 1
            findings.append({"code": "REVIEW_OVERDUE", "message": "The entered next review date is before this register's as-of date."})
        if risk["impact"] == "UNASSESSED" or risk["priority"] == "UNASSESSED" or risk["likelihood"] == "UNASSESSED":
            findings.append({"code": "ASSESSMENT_UNENTERED", "message": "One or more assessment judgments remain unentered."})
        packages, actions = [], []
        for cid in risk["costIds"]:
            row = costs.get(cid)
            packages.append({"id": cid, "label": str((row or {}).get("description") or (row or {}).get("name") or cid),
                             "current": row is not None})
            if row is None:
                findings.append({"code": "PACKAGE_RETIRED", "message": "Retained package " + cid + " is absent from the current plan."})
        for action in risk["actions"]:
            overdue_action = bool(action["status"] in ("PLANNED", "IN_PROGRESS")
                                  and action["dueOn"] and action["dueOn"] < document["asOfDate"])
            if overdue_action:
                counts["overdueActions"] += 1
                findings.append({"code": "ACTION_OVERDUE", "message": "The unfinished action is past its entered due date.",
                                 "actionId": action["id"]})
            if action["ownerId"] is None:
                findings.append({"code": "ACTION_OWNER_UNASSIGNED", "message": "The action has no named original contributor.",
                                 "actionId": action["id"]})
            if not active and action["status"] in ("PLANNED", "IN_PROGRESS"):
                findings.append({"code": "OPEN_ACTION_ON_RESOLVED_ITEM",
                                 "message": "This resolved or closed item retains an unfinished action.", "actionId": action["id"]})
            actions.append({"id": action["id"], "title": action["title"], "status": action["status"],
                            "owner": person(action["ownerId"]), "dueOn": action["dueOn"],
                            "completedOn": action["completedOn"], "overdue": overdue_action})
        entries.append({key: deepcopy(risk[key]) for key in
            ("id", "title", "kind", "category", "status", "likelihood", "impact", "priority", "nextReviewOn")} |
            {"owner": person(risk["ownerId"]), "costs": packages, "reviewOverdue": overdue, "actions": actions,
             "sourceIds": sorted({sid for part in [risk] + risk["actions"] for sid in part["sourceIds"]}),
             "findings": findings})
    return {"schema": SCHEMA + ".report", "name": document["name"], "asOfDate": document["asOfDate"],
            "mode": context["program"]["mode"], "counts": counts, "entries": entries, "notice": NOTICE}


def calculate(context, raw):
    document = normalize(context, raw)
    result = {"schema": SCHEMA, "engineVersion": ENGINE_VERSION, "source": source(context, document),
              "document": document, "report": report(context, document)}
    result["previewSha256"] = digest(result)
    return result


def snapshot_context(review):
    value = deepcopy(review["snapshot"])
    value["program"]["version"] = review["version"] - 1
    value["sources"] = {row["id"]: row for row in value["sources"]}
    return value


def validate_review(review, pinned_plan=None):
    try:
        if not isinstance(review, dict) or review.get("purpose") != PURPOSE:
            fail("Select a complete delivery risk review.")
        ident(review.get("id"), "Risk review identity")
        domain.integer(review.get("version"), "Risk save version", 2, 10000000)
        domain.timestamp(review.get("createdAt"), "Risk save timestamp")
        text(review.get("actor"), "Recording operator", 300, True)
        text(review.get("note"), "Edition review note", 12000, True)
        if digest({k: v for k, v in review.items() if k != "sha256"}) != review.get("sha256"):
            fail("The complete risk review differs from its saved identity.", "RISK_REVIEW_CHANGED", 409)
        if digest(review["snapshot"]) != review.get("businessSha256"):
            fail("The risk review's original business snapshot changed.", "RISK_REVIEW_CHANGED", 409)
        context = snapshot_context(review)
        if pinned_plan and (context["plan"]["contentSha256"] != pinned_plan["contentSha256"]
                            or context["plan"]["source"]["sha256"] != pinned_plan["source"]["sha256"]):
            fail("The risk edition differs from its original plan revision.", "RISK_SOURCE_CHANGED", 409)
        if calculate(context, review["riskRegister"]["document"]) != review["riskRegister"]:
            fail("The complete risk edition differs from its source and assessment.", "RISK_REVIEW_CHANGED", 409)
        if domain.report(**context) != review["report"]:
            fail("The risk edition's native case report changed.", "RISK_REVIEW_CHANGED", 409)
        return review
    except (KeyError, TypeError, ValueError, AttributeError, ArithmeticError) as error:
        if isinstance(error, Problem):
            raise
        fail("The complete risk review is unreadable: " + str(error))


def summary(review):
    value = review["riskRegister"]
    return {key: deepcopy(review[key]) for key in
            ("id", "version", "createdAt", "actor", "note", "purpose", "sha256", "businessSha256")} | {
        "name": value["document"]["name"], "asOfDate": value["document"]["asOfDate"],
        "counts": deepcopy(value["report"]["counts"]), "supersedes": deepcopy(value["document"]["supersedes"])}


def load_reviews(operations, program_id):
    return [json.loads(row[0]) for row in operations.db.execute(
        "SELECT body_json FROM ops_reviews WHERE program_id=? AND json_extract(body_json,'$.purpose')=? ORDER BY CAST(json_extract(body_json,'$.version') AS INTEGER) DESC",
        (program_id, PURPOSE))]


def raw_review(operations, program_id, review_id):
    row = operations.db.execute("SELECT body_json FROM ops_reviews WHERE program_id=? AND id=?",
                               (program_id, ident(review_id, "Risk review"))).fetchone()
    if row is None:
        fail("The original risk edition is unavailable.", "RISK_NOT_FOUND", 404)
    return validate_review(json.loads(row[0]))


def current_review(operations, program_id):
    values = load_reviews(operations, program_id)
    return validate_review(values[0]) if values else None


def preview(operations, context, raw):
    value = calculate(context, raw)
    previous = current_review(operations, context["program"]["id"])
    validate_successor(context, value["document"], previous)
    return value


def seed(operations, context, review_id=None):
    selected = raw_review(operations, context["program"]["id"], review_id) if review_id else current_review(
        operations, context["program"]["id"])
    if selected:
        document = deepcopy(selected["riskRegister"]["document"])
        document["supersedes"] = {"reviewId": selected["id"], "reviewSha256": selected["sha256"]}
    else:
        document = {"schema": SCHEMA, "name": "Delivery risks and actions", "asOfDate": now()[:10],
                    "note": "", "supersedes": None, "risks": []}
    document = normalize(context, document)
    return {"document": document, "source": source(context, document),
            "contributors": deepcopy(context["records"]["contributors"]),
            "packages": deepcopy(context["plan"]["scenario"]["future_costs"]),
            "sources": sorted(deepcopy(list(context["sources"].values())), key=lambda row: row["id"]),
            "previous": summary(selected) if selected else None}


def listing(operations, context):
    values = load_reviews(operations, context["program"]["id"])
    current = validate_review(values[0]) if values else None
    empty = {"risks": []}
    return {"schema": SCHEMA, "source": source(context, empty),
            "current": summary(current) if current else None, "editions": [summary(row) for row in values]}


def save(operations, context, data, actor, next_version, note):
    obj(data, {"document", "expectedPreviewSha256"}, "Risk register save")
    text(note, "Edition review note", 12000, True)
    candidate = preview(operations, context, data.get("document"))
    if candidate["previewSha256"] != domain.sha(data.get("expectedPreviewSha256"), "Reviewed risk preview", False):
        fail("The selected inputs or original source changed after preview.", "RISK_PREVIEW_CHANGED", 409)
    previous = current_review(operations, context["program"]["id"])
    snapshot = operations._business(context)
    review = {"id": "review-" + uuid.uuid4().hex, "version": next_version, "createdAt": now(), "actor": actor,
              "note": note, "purpose": PURPOSE, "businessSha256": digest(snapshot), "snapshot": snapshot,
              "report": domain.report(**context), "riskRegister": candidate}
    review["sha256"] = digest(review)
    validate_review(review, context["plan"])
    operations.db.execute("INSERT INTO ops_reviews VALUES(?,?,?)",
                         (context["program"]["id"], review["id"], canonical(review)))
    return {"before": summary(previous) if previous else None, "after": summary(review), "kind": "review",
            "recordId": review["id"], "reviewSha256": review["sha256"], "riskRegister": summary(review)}


def show(operations, context, review_id):
    review = raw_review(operations, context["program"]["id"], review_id)
    saved = review["riskRegister"]
    try:
        changed = digest(binding(context, saved["document"])) != saved["source"]["bindingSha256"]
        reason = "A linked contributor, package, source or current plan differs from this retained edition." if changed else None
    except (KeyError, TypeError):
        changed, reason = True, "A linked original contributor or attachment is unavailable in this current case."
    return {"review": review, **{key: deepcopy(saved[key]) for key in ("document", "source", "report", "previewSha256")},
            "current": {"programId": context["program"]["id"], "version": context["program"]["version"],
                        "sourceChanged": changed, "reason": reason,
                        "retainedOriginalProgramId": saved["source"]["programId"]}}


def history(operations, context, risk_id):
    ident(risk_id, "Risk identity")
    entries = []
    for value in load_reviews(operations, context["program"]["id"]):
        validate_review(value)
        row = next((r for r in value["riskRegister"]["document"]["risks"] if r["id"] == risk_id), None)
        if row is not None:
            entries.append({"edition": summary(value), "risk": deepcopy(row)})
    if not entries:
        fail("This original risk or issue is not in the case history.", "RISK_NOT_FOUND", 404)
    return {"schema": SCHEMA + ".history", "riskId": risk_id, "entries": entries, "current": entries[0]["risk"]}


def csv_files(review):
    validate_review(review)
    document = review["riskRegister"]["document"]
    risk_rows, action_rows = [], []
    for risk in document["risks"]:
        risk_rows.append({key: risk[key] for key in
            ("id", "kind", "title", "description", "category", "identifiedOn", "ownerId", "ownerNote", "status",
             "likelihood", "impact", "priority", "assessmentNote", "trigger", "nextReviewOn", "sourceNote", "sourceBasis")} |
            {"asOfDate": document["asOfDate"], "costIds": canonical(risk["costIds"]), "sourceIds": canonical(risk["sourceIds"]),
             "reviewOn": risk["review"]["on"], "reviewBy": risk["review"]["by"], "reviewNote": risk["review"]["note"],
             "resolutionOn": risk["resolution"]["on"], "resolutionNote": risk["resolution"]["note"]})
        for action in risk["actions"]:
            action_rows.append({**action, "riskId": risk["id"], "riskTitle": risk["title"],
                                "asOfDate": document["asOfDate"], "sourceIds": canonical(action["sourceIds"])})
    return {
        "risk-register.csv": csv_bytes(["id", "kind", "title", "description", "category", "asOfDate", "identifiedOn",
            "ownerId", "ownerNote", "status", "likelihood", "impact", "priority", "assessmentNote", "trigger",
            "nextReviewOn", "costIds", "sourceIds", "sourceNote", "sourceBasis", "reviewOn", "reviewBy",
            "reviewNote", "resolutionOn", "resolutionNote"], risk_rows),
        "risk-actions.csv": csv_bytes(["id", "riskId", "riskTitle", "title", "description", "asOfDate", "ownerId",
            "ownerNote", "status", "dueOn", "completedOn", "progress", "sourceIds", "sourceNote", "sourceBasis"], action_rows)}


def html(review):
    validate_review(review)
    value = review["riskRegister"]
    document, assessment = value["document"], value["report"]
    people = {row["id"]: row for row in review["snapshot"]["records"]["contributors"]}
    def e(value):
        return escape("" if value is None else str(value), quote=True)
    def pname(pid):
        return people[pid]["name"] if pid else "Unassigned"
    def table(pairs):
        return "<table><tbody>" + "".join("<tr><th>" + e(k) + "</th><td>" + e(v) + "</td></tr>" for k, v in pairs) + "</tbody></table>"
    def sources(part):
        return "<p>" + e(part["sourceNote"]) + "</p><ul>" + "".join(
            '<li><a href="sources/' + e(sid) + '">' + e(sid) + "</a></li>" for sid in part["sourceIds"]) + "</ul>"
    sections = []
    for risk in document["risks"]:
        actions = []
        for action in risk["actions"]:
            actions.append("<h3>" + e(action["title"]) + "</h3>" + table([
                ("Identity", action["id"]), ("Status", action["status"]), ("Owner", pname(action["ownerId"])),
                ("Responsibility", action["ownerNote"]), ("Description", action["description"]),
                ("Due", action["dueOn"]), ("Completed or cancelled", action["completedOn"]), ("Progress", action["progress"])]) + sources(action))
        sections.append("<section><h2>" + e(risk["title"]) + "</h2>" + table([
            ("Identity", risk["id"]), ("Kind", risk["kind"]), ("Category", risk["category"]), ("Status", risk["status"]),
            ("Identified", risk["identifiedOn"]), ("Cause, event and effect", risk["description"]),
            ("Owner", pname(risk["ownerId"])), ("Responsibility", risk["ownerNote"]), ("Likelihood", risk["likelihood"]),
            ("Impact", risk["impact"]), ("Priority", risk["priority"]), ("Assessment basis", risk["assessmentNote"]),
            ("Trigger", risk["trigger"]), ("Next review", risk["nextReviewOn"]), ("Packages", ", ".join(risk["costIds"])),
            ("Review date", risk["review"]["on"]), ("Reviewing person", risk["review"]["by"]),
            ("Review", risk["review"]["note"]), ("Resolution date", risk["resolution"]["on"]),
            ("Resolution", risk["resolution"]["note"])]) + sources(risk) + "".join(actions) + "</section>")
    return ('<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
        "<title>" + e(document["name"]) + "</title><style>body{font:15px system-ui,sans-serif;color:#171717;background:white;"
        "max-width:1050px;margin:32px auto;padding:0 24px;line-height:1.5}h1,h2,h3{line-height:1.2}"
        "section{margin:32px 0;border-top:1px solid #999;padding-top:16px}table{width:100%;border-collapse:collapse}"
        "th,td{padding:8px;border:1px solid #aaa;text-align:left;vertical-align:top;white-space:pre-wrap;overflow-wrap:anywhere}"
        "th{width:25%;background:#eee}small{overflow-wrap:anywhere}a{color:inherit}@media print{body{margin:0}"
        "tr{break-inside:avoid}h2,h3{break-after:avoid}}</style><h1>" + e(document["name"]) + "</h1>"
        "<p>" + e(assessment["mode"]) + " · As of " + e(document["asOfDate"]) + "</p><p>" + e(document["note"]) + "</p>"
        "<p>" + e(NOTICE) + "</p><small>Edition " + e(review["id"]) + " · " + e(review["sha256"]) + "</small>"
        + table([(key, val) for key, val in assessment["counts"].items()]) + "".join(sections)
        + "<footer>Import the complete case to continue its original risk/action identities and all saved review history.</footer></html>").encode("utf-8")


def selected_files(context, reviews, review_id):
    selected = next((row for row in reviews if row["id"] == review_id and row.get("purpose") == PURPOSE), None)
    if selected is None:
        fail("Select an original risk register edition for export.", "RISK_NOT_FOUND", 404)
    validate_review(selected)
    choice = {"schema": SCHEMA + ".selection", "reviewId": selected["id"], "reviewSha256": selected["sha256"],
              "originalProgramId": selected["riskRegister"]["source"]["programId"]}
    return {"risk-register-selection.json": (canonical(choice) + "\n").encode("utf-8"),
            "risk-register.json": (canonical(selected["riskRegister"]) + "\n").encode("utf-8"),
            "risk-register.html": html(selected), **csv_files(selected)}


def validate_import(context, reviews, events, files, plan_for_version):
    books = sorted([r for r in reviews if r.get("purpose") == PURPOSE], key=lambda r: r["version"])
    if {e.get("recordId") for e in events if e.get("action") == ACTION} != {r["id"] for r in books}:
        fail("The complete case history is missing an original risk register edition.")
    previous = None
    for review in books:
        version = domain.integer(review.get("version"), "Original risk save version", 2, len(events))
        validate_review(review, plan_for_version(version - 1))
        original = snapshot_context(review)
        document = review["riskRegister"]["document"]
        validate_successor(original, document, previous)
        event = events[version - 1]
        if (event.get("action") != ACTION or event.get("recordId") != review["id"] or event.get("kind") != "review"
                or event.get("actor") != review["actor"] or event.get("note") != review["note"]
                or event.get("after") != summary(review)
                or event.get("before") != (summary(previous) if previous else None)
                or review["riskRegister"]["source"]["version"] != version - 1):
            fail("The risk edition does not match its complete original save event.")
        for sid in source_ids(document):
            if original["sources"][sid] != context["sources"].get(sid):
                fail("A risk attachment differs from the original complete case source.")
            observed_source = next((event.get("after") for event in events[:version - 1]
                                    if event.get("kind") == "source" and event.get("recordId") == sid), None)
            # Some original intake commands retain several source additions in sourceChange.
            if observed_source is not None and observed_source != original["sources"][sid]:
                fail("The original risk source metadata differs from its source event.")
        for person in binding(original, document)["contributors"]:
            before = next((e.get("after") for e in reversed(events[:version - 1])
                           if e.get("kind") == "contributors" and e.get("recordId") == person["id"]), None)
            if before is None:
                before = next((e.get("before") for e in events[version - 1:]
                               if e.get("kind") == "contributors" and e.get("recordId") == person["id"]), None)
            if before is None:
                before = next((p for p in context["records"]["contributors"] if p["id"] == person["id"]), None)
            if before != person:
                fail("A risk owner differs from the original contributor history.")
        previous = review
    if not SELECTION_FILES.intersection(files):
        return None
    if not SELECTION_FILES.issubset(files):
        fail("The selected risk handover is missing a complete member.")
    choice = json.loads(files["risk-register-selection.json"])
    obj(choice, {"schema", "reviewId", "reviewSha256", "originalProgramId"}, "Risk handover selection")
    expected = selected_files(context, books, choice.get("reviewId"))
    if any(files[name] != raw for name, raw in expected.items()):
        fail("The selected risk files differ from their original edition.")
    return choice
