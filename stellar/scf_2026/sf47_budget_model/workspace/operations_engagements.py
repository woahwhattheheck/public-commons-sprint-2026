"""Contributor agreement editions in the original SF47 Operations case.

The original source table, review history, request journal and workspace
transaction own persistence. Forecast and Portfolio remain the calculation
and allocation engines.
"""
from __future__ import annotations

from copy import deepcopy
from datetime import date
from decimal import Decimal
from html import escape
import json
import re
import uuid

from model import Problem, canonical, digest, now, text
import operations_domain as domain
import forecast as forecasts
import portfolio as portfolios

SCHEMA = "stellar-forge.sf47-contributor-engagements.v1"
ENGINE_VERSION = 1
PURPOSE = "CONTRIBUTOR_ENGAGEMENTS"
RECEIVING_PURPOSE = "CONTRIBUTOR_ENGAGEMENTS_RECEIVING"
STATUSES = ("PROPOSED", "CONFIRMED", "DECLINED", "WITHDRAWN")
SOURCE_FIELDS = {"sourceIds", "sourceNote", "sourceBasis"}
ZERO = Decimal("0")


def fail(message, code="INVALID_ENGAGEMENT", status=422):
    raise Problem(message, status, code)


def obj(value, fields, label):
    if not isinstance(value, dict) or set(value) - set(fields):
        fail(label + ": use the declared object fields.")
    return value


def rows(value, label, maximum):
    if not isinstance(value, list) or len(value) > maximum or any(not isinstance(row, dict) for row in value):
        fail(label + ": use at most " + str(maximum) + " object rows.")
    return value


def ident(value, label="Engagement identity"):
    if not isinstance(value, str) or not re.fullmatch(r"[a-z][a-z0-9-]{1,99}", value):
        fail(label + ": use an original lowercase record identity.")
    return value


def sources(data, context):
    return domain.source_fields(data, context["sources"])


def source_ids(document):
    result = set()
    for row in document["agreements"]:
        for part in (row, row["availability"], row["compensation"], row["acceptance"]):
            result.update(part["sourceIds"])
    return sorted(result)


def normalize(context, raw):
    raw = obj(deepcopy(raw), {"schema", "name", "asOfDate", "agreements", "supersedes", "note"}, "Engagement edition")
    if raw.get("schema") != SCHEMA:
        fail("Use the supported contributor engagement edition.")
    people = {row["id"]: row for row in context["records"]["contributors"]}
    seen, contributor_ids, agreements = set(), set(), []
    for row in rows(raw.get("agreements", []), "Contributor agreements", portfolios.MAX_RESOURCES):
        obj(row, {"id", "contributorId", "role", "scope", "startDate", "endDate",
                  "availability", "compensation", "acceptance", "allocations", *SOURCE_FIELDS}, "Agreement")
        rid = ident(row.get("id"))
        person = row.get("contributorId")
        if rid in seen or person in contributor_ids:
            fail("Retain one current agreement row per named contributor, with distinct agreement IDs.")
        if person not in people:
            fail("Select a retained Operations contributor.")
        seen.add(rid)
        contributor_ids.add(person)
        start = domain.calendar(row.get("startDate"), "Agreement start")
        end = domain.calendar(row.get("endDate"), "Agreement finish")
        if end < start:
            fail("The agreement finish must follow its start.")
        availability = obj(row.get("availability"), {"hoursByWeekday", "hoursByDate", "note", *SOURCE_FIELDS}, "Availability")
        resource = portfolios.normalize_resources([{"id": "agreement", "name": people[person]["name"],
            "hoursByWeekday": availability.get("hoursByWeekday"), "hoursByDate": availability.get("hoursByDate", {}),
            "note": availability.get("note", "")}])[0]
        if any(stamp < start or stamp > end for stamp in resource["hoursByDate"]):
            fail("Dated availability exceptions must lie inside the recorded agreement period.")
        availability = {key: resource[key] for key in ("hoursByWeekday", "hoursByDate", "note")} | sources(availability, context)

        compensation = obj(row.get("compensation"), {"basis", "rateUsd", "totalUsd", "paymentTerms",
            "paymentMode", "note", *SOURCE_FIELDS}, "Compensation")
        basis = domain.enum(compensation.get("basis", "UNSPECIFIED"), ("HOURLY", "FIXED", "IN_KIND", "UNSPECIFIED"), "Compensation basis")
        rate = None if compensation.get("rateUsd") in (None, "") else domain.quantity(compensation["rateUsd"], "Agreed USD hourly rate", 4)
        total = None if compensation.get("totalUsd") in (None, "") else domain.usd(compensation["totalUsd"], "Agreed total USD fee")
        if basis == "HOURLY" and rate is None:
            fail("An hourly agreement needs its actual hourly rate.")
        if basis == "FIXED" and total is None:
            fail("A fixed agreement needs its actual total fee.")
        if basis in ("IN_KIND", "UNSPECIFIED") and (rate is not None or total not in (None, "0.00")):
            fail("Choose the commercial basis corresponding to the entered fee.")
        compensation = {"basis": basis, "rateUsd": rate, "totalUsd": total,
            "paymentTerms": text(compensation.get("paymentTerms", ""), "Original payment terms", 12000),
            "paymentMode": domain.enum(compensation.get("paymentMode", "original"),
                ("original", "accrual", "completion"), "Reviewed native payment schedule"),
            "note": text(compensation.get("note", ""), "Compensation and timing basis", 12000),
            **sources(compensation, context)}

        acceptance = obj(row.get("acceptance"), {"status", "by", "at", "note", *SOURCE_FIELDS}, "Acceptance")
        status = domain.enum(acceptance.get("status", "PROPOSED"), STATUSES, "Recorded agreement acceptance")
        by = text(acceptance.get("by", ""), "Person confirming the agreement", 300)
        at = domain.timestamp(acceptance.get("at"), "Original agreement confirmation", True)
        if status == "CONFIRMED" and (not by or not at):
            fail("Record who confirmed the agreement and its original timestamp.")
        acceptance = {"status": status, "by": by, "at": at,
            "note": text(acceptance.get("note", ""), "Original acceptance observation", 12000),
            **sources(acceptance, context)}

        allocations, cost_ids = [], set()
        for allocation in rows(row.get("allocations", []), "Remaining grant-package allocations", 200):
            obj(allocation, {"costId", "remainingHours", "remainingCostUsd", "note"}, "Package allocation")
            cost = domain.cost_id(allocation.get("costId"), context["plan"])
            if cost is None or cost in cost_ids:
                fail("Select each original grant work package once within an agreement.")
            cost_ids.add(cost)
            allocations.append({"costId": cost,
                "remainingHours": domain.quantity(allocation.get("remainingHours"), "Remaining allocated hours", 4),
                "remainingCostUsd": domain.usd(allocation.get("remainingCostUsd"), "Remaining uninvoiced allocation"),
                "note": text(allocation.get("note", ""), "Remaining allocation basis", 4000)})
        agreements.append({"id": rid, "contributorId": person,
            "role": text(row.get("role"), "Agreed role", 500, True),
            "scope": text(row.get("scope"), "Agreed scope", 12000, True),
            "startDate": start, "endDate": end, "availability": availability,
            "compensation": compensation, "acceptance": acceptance, "allocations": allocations,
            **sources(row, context)})
    previous = raw.get("supersedes")
    if previous is not None:
        obj(previous, {"reviewId", "reviewSha256"}, "Previous engagement edition")
        previous = {"reviewId": ident(previous.get("reviewId"), "Previous review"),
                    "reviewSha256": domain.sha(previous.get("reviewSha256"), "Previous complete review", False)}
    return {"schema": SCHEMA, "name": text(raw.get("name"), "Engagement edition name", 300, True),
        "asOfDate": domain.calendar(raw.get("asOfDate"), "Remaining-work as-of date"),
        "agreements": agreements, "supersedes": previous,
        "note": text(raw.get("note", ""), "Edition basis", 12000)}


def binding(context, document):
    people = {row["id"]: row for row in context["records"]["contributors"]}
    return {"planContentSha256": context["plan"]["contentSha256"],
        "planSourceSha256": context["plan"]["source"]["sha256"], "mode": context["program"]["mode"],
        "contributors": [deepcopy(people[rid]) for rid in sorted({r["contributorId"] for r in document["agreements"]})],
        "sources": [deepcopy(context["sources"][sid]) for sid in source_ids(document)]}


def source(context, document):
    return {**forecasts.source_identity(context), "bindingSha256": digest(binding(context, document))}


def capacity(row):
    """Count the entered calendar exactly without expanding a long agreement."""
    start, end = date.fromisoformat(row["startDate"]), date.fromisoformat(row["endDate"])
    length = (end - start).days + 1
    whole, remainder = divmod(length, 7)
    counts = [whole] * 7
    for offset in range(remainder):
        counts[(start.weekday() + offset) % 7] += 1
    weekly, overrides = row["availability"]["hoursByWeekday"], row["availability"]["hoursByDate"]
    known, missing = ZERO, 0
    for weekday, count in enumerate(counts):
        if weekly[weekday] is None:
            missing += count
        else:
            known += Decimal(weekly[weekday]) * count
    for stamp, entered in overrides.items():
        original = weekly[date.fromisoformat(stamp).weekday()]
        if original is None:
            missing -= 1
        else:
            known -= Decimal(original)
        known += Decimal(entered)
    return {"calendarDays": length, "knownAvailableHours": forecasts.hours(known),
            "unenteredDates": missing, "complete": missing == 0}


def report(context, document):
    people = {row["id"]: row for row in context["records"]["contributors"]}
    entries, packages, issues = [], {}, []
    counts = {state.lower(): 0 for state in STATUSES}
    totals = {state: {"hours": ZERO, "cost": ZERO} for state in STATUSES}
    for row in document["agreements"]:
        status = row["acceptance"]["status"]
        counts[status.lower()] += 1
        available = capacity(row)
        allocated = sum((Decimal(x["remainingHours"]) for x in row["allocations"]), ZERO)
        cost = sum((Decimal(x["remainingCostUsd"]) for x in row["allocations"]), ZERO)
        totals[status]["hours"] += allocated
        totals[status]["cost"] += cost
        person = people[row["contributorId"]]
        entry = {"id": row["id"], "contributor": {k: person[k] for k in ("id", "name", "kind", "contact")},
            "role": row["role"], "status": status, "startDate": row["startDate"], "endDate": row["endDate"],
            "remainingHours": forecasts.hours(allocated), "remainingCostUsd": forecasts.money(cost),
            "capacity": available, "sourceIds": sorted(set(sid for part in
                (row, row["availability"], row["compensation"], row["acceptance"]) for sid in part["sourceIds"]))}
        if not available["complete"]:
            issues.append({"code": "AVAILABILITY_UNENTERED", "engagementId": row["id"],
                "message": "Availability has " + str(available["unenteredDates"]) + " unentered dates."})
        if row["endDate"] <= document["asOfDate"] and allocated:
            issues.append({"code": "REMAINING_WORK_AFTER_AGREEMENT", "engagementId": row["id"],
                "message": "Remaining work extends beyond this recorded agreement's elapsed period."})
        if status == "CONFIRMED" and person["kind"] == "ROLE":
            issues.append({"code": "ROLE_CONTRIBUTOR", "engagementId": row["id"],
                "message": "The selected contributor is a role record; the confirmation retains its named confirming person."})
        if status == "CONFIRMED" and not row["compensation"]["paymentTerms"]:
            issues.append({"code": "PAYMENT_TERMS_UNENTERED", "engagementId": row["id"],
                "message": "The original payment terms have not been entered."})
        for allocation in row["allocations"]:
            package = packages.setdefault(allocation["costId"], {"costId": allocation["costId"],
                "confirmedHours": ZERO, "confirmedCostUsd": ZERO, "proposedHours": ZERO,
                "proposedCostUsd": ZERO, "engagementIds": []})
            if status in ("CONFIRMED", "PROPOSED"):
                prefix = status.lower()
                package[prefix + "Hours"] += Decimal(allocation["remainingHours"])
                package[prefix + "CostUsd"] += Decimal(allocation["remainingCostUsd"])
                package["engagementIds"].append(row["id"])
        entries.append(entry)
    package_rows = []
    for package in packages.values():
        package_rows.append({k: forecasts.money(v) if k.endswith("Usd") else forecasts.hours(v)
                             if isinstance(v, Decimal) else v for k, v in package.items()})
    return {"schema": SCHEMA + ".report", "name": document["name"], "asOfDate": document["asOfDate"],
        "mode": context["program"]["mode"], "agreements": len(entries), **counts,
        "allocatedHours": forecasts.hours(totals["CONFIRMED"]["hours"] + totals["PROPOSED"]["hours"]),
        "remainingCostUsd": forecasts.money(totals["CONFIRMED"]["cost"] + totals["PROPOSED"]["cost"]),
        "byAcceptance": {k: {"remainingHours": forecasts.hours(v["hours"]), "remainingCostUsd": forecasts.money(v["cost"])}
                         for k, v in totals.items()},
        "entries": entries, "packages": package_rows, "issues": issues,
        "paymentTimingBasis": "Recorded agreement terms and each explicitly selected original Forecast payment mode."}


def preview(context, raw):
    document = normalize(context, raw)
    value = {"schema": SCHEMA, "engineVersion": ENGINE_VERSION, "source": source(context, document),
             "document": document, "report": report(context, document)}
    value["previewSha256"] = digest(value)
    return value


def snapshot_context(review):
    value = review["snapshot"]
    return {**deepcopy(value), "program": {**deepcopy(value["program"]), "version": review["version"] - 1},
            "sources": {row["id"]: deepcopy(row) for row in value["sources"]}}


def validate_review(review, pinned_plan=None):
    try:
        if not isinstance(review, dict) or review.get("purpose") != PURPOSE:
            fail("Select a complete contributor engagement review.")
        ident(review.get("id"), "Original engagement review")
        domain.integer(review.get("version"), "Engagement save version", 2, 10000000)
        domain.timestamp(review.get("createdAt"), "Engagement save timestamp")
        text(review.get("actor"), "Recording operator", 300, True)
        if digest({k: v for k, v in review.items() if k != "sha256"}) != review.get("sha256"):
            fail("The complete engagement review differs from its saved identity.", "ENGAGEMENT_CHANGED", 409)
        if digest(review["snapshot"]) != review.get("businessSha256"):
            fail("The original engagement business snapshot changed.", "ENGAGEMENT_CHANGED", 409)
        context = snapshot_context(review)
        if pinned_plan and (context["plan"]["contentSha256"] != pinned_plan["contentSha256"]
                            or context["plan"]["source"]["sha256"] != pinned_plan["source"]["sha256"]):
            fail("The engagement edition belongs to another pinned plan.", "ENGAGEMENT_SOURCE_CHANGED", 409)
        retained = review["engagements"]
        rebuilt = preview(context, retained["document"])
        if rebuilt != retained:
            fail("The complete engagement edition differs from its original source calculation.", "ENGAGEMENT_CHANGED", 409)
        return review
    except (KeyError, TypeError, ValueError, AttributeError, ArithmeticError) as error:
        if isinstance(error, Problem):
            raise
        fail("The complete engagement review is unreadable: " + str(error))


def summary(review):
    value = review["engagements"]["report"]
    return {k: deepcopy(review[k]) for k in ("id", "version", "createdAt", "actor", "note",
                                             "purpose", "sha256", "businessSha256")} | {
        k: deepcopy(value[k]) for k in ("name", "asOfDate", "agreements", "confirmed", "proposed",
                                        "declined", "withdrawn", "allocatedHours", "remainingCostUsd")} | {
        "supersedes": deepcopy(review["engagements"]["document"]["supersedes"])}


def raw_review(operations, program_id, review_id):
    row = operations.db.execute("SELECT body_json FROM ops_reviews WHERE program_id=? AND id=?",
                               (program_id, ident(review_id, "Engagement review"))).fetchone()
    if row is None:
        fail("The original engagement edition is unavailable.", "ENGAGEMENT_NOT_FOUND", 404)
    return validate_review(json.loads(row[0]))


def load_reviews(operations, program_id, purpose=PURPOSE):
    return [json.loads(row[0]) for row in operations.db.execute(
        "SELECT body_json FROM ops_reviews WHERE program_id=? AND json_extract(body_json,'$.purpose')=? ORDER BY rowid DESC",
        (program_id, purpose))]


def previous_review(operations, context, document):
    selected = document["supersedes"]
    if selected is None:
        return None
    previous = raw_review(operations, context["program"]["id"], selected["reviewId"])
    if previous["sha256"] != selected["reviewSha256"]:
        fail("The preceding complete engagement edition changed.", "ENGAGEMENT_PREVIOUS_CHANGED", 409)
    validate_review(previous, context["plan"])
    return previous


def check_current(context, review):
    validate_review(review, context["plan"])
    original = review["engagements"]
    try:
        current = digest(binding(context, original["document"]))
    except KeyError:
        fail("A selected original contributor or agreement source is unavailable.", "ENGAGEMENT_SOURCE_CHANGED", 409)
    if current != original["source"]["bindingSha256"]:
        fail("A selected contributor, source or pinned plan changed. Review its current engagement edition.",
             "ENGAGEMENT_SOURCE_CHANGED", 409)


def seed(operations, context, review_id=None):
    selected = raw_review(operations, context["program"]["id"], review_id) if review_id else None
    if selected:
        document = deepcopy(selected["engagements"]["document"])
        document["supersedes"] = {"reviewId": selected["id"], "reviewSha256": selected["sha256"]}
    else:
        document = {"schema": SCHEMA, "name": "Contributor engagements", "asOfDate": now()[:10],
                    "agreements": [], "supersedes": None, "note": ""}
    document = normalize(context, document)
    return {"document": document, "source": source(context, document),
        "contributors": deepcopy(context["records"]["contributors"]),
        "packages": deepcopy(context["plan"]["scenario"]["future_costs"]),
        "sources": list(deepcopy(context["sources"]).values()), "previous": summary(selected) if selected else None}


def prepare(operations, context, data, actor, next_version, note):
    obj(data, {"document", "expectedPreviewSha256"}, "Engagement save")
    candidate = preview(context, data.get("document"))
    if candidate["previewSha256"] != domain.sha(data.get("expectedPreviewSha256"), "Reviewed engagement edition", False):
        fail("The engagement inputs or selected sources differ from the reviewed preview.", "ENGAGEMENT_PREVIEW_CHANGED", 409)
    previous = previous_review(operations, context, candidate["document"])
    snapshot = operations._business(context)
    review = {"id": "review-" + uuid.uuid4().hex, "version": next_version, "createdAt": now(),
        "actor": actor, "note": note, "purpose": PURPOSE, "businessSha256": digest(snapshot),
        "snapshot": snapshot, "report": domain.report(**context), "engagements": candidate}
    review["sha256"] = digest(review)
    validate_review(review, context["plan"])
    operations.db.execute("INSERT INTO ops_reviews VALUES(?,?,?)",
                          (context["program"]["id"], review["id"], canonical(review)))
    return {"before": summary(previous) if previous else None, "after": summary(review),
            "kind": "review", "recordId": review["id"], "reviewSha256": review["sha256"]}


def show(operations, context, review_id):
    review = raw_review(operations, context["program"]["id"], review_id)
    original = review["engagements"]
    reason = None
    try:
        check_current(context, review)
    except Problem as error:
        reason = str(error)
    receiving = [receiving_summary(row) for row in load_reviews(operations, context["program"]["id"], RECEIVING_PURPOSE)
                 if row["engagementReceiving"]["book"]["id"] == review["id"]]
    return {"review": review, **{k: deepcopy(original[k]) for k in ("document", "source", "report", "previewSha256")},
        "current": {"programId": context["program"]["id"], "version": context["program"]["version"],
            "sourceChanged": reason is not None, "reason": reason,
            "retainedOriginalProgramId": original["source"]["programId"]}, "receivings": receiving}


def receiving_summary(review):
    value = review["engagementReceiving"]
    return {k: deepcopy(review[k]) for k in ("id", "version", "createdAt", "actor", "note", "purpose", "sha256")} | {
        "book": deepcopy(value["book"]), "forecast": deepcopy(value["forecast"]), "portfolio": deepcopy(value["portfolio"]),
        "allocationStatus": value["allocationStatus"], "readyAlternativeIds": deepcopy(value["readyAlternativeIds"])}


def list_editions(operations, program_id):
    return {"engagements": [summary(row) for row in load_reviews(operations, program_id)],
            "receivings": [receiving_summary(row) for row in load_reviews(operations, program_id, RECEIVING_PURPOSE)]}


def html(review):
    validate_review(review)
    original = review["engagements"]
    document, result = original["document"], original["report"]
    people = {row["contributor"]["id"]: row["contributor"] for row in result["entries"]}
    def e(value):
        return escape("" if value is None else str(value), quote=True)
    def table(headers, body):
        return "<table><thead><tr>" + "".join("<th>" + e(x) + "</th>" for x in headers) + "</tr></thead><tbody>" + "".join(
            "<tr>" + "".join("<td>" + e(x) + "</td>" for x in row) + "</tr>" for row in body) + "</tbody></table>"
    sections = []
    for row in document["agreements"]:
        availability, compensation, acceptance = row["availability"], row["compensation"], row["acceptance"]
        sections.append("<section><h2>" + e(people[row["contributorId"]]["name"]) + " — " + e(row["role"]) +
            "</h2><p>" + e(row["scope"]) + "</p>" +
            table(["Agreement", "Value"], [["Identity", row["id"]], ["Period", row["startDate"] + " through " + row["endDate"]],
                ["Acceptance", acceptance["status"]], ["Confirmed by", acceptance["by"]], ["Original timestamp", acceptance["at"]],
                ["Compensation", compensation["basis"]], ["Hourly USD", compensation["rateUsd"]], ["Total USD", compensation["totalUsd"]],
                ["Payment terms", compensation["paymentTerms"]], ["Native payment mode", compensation["paymentMode"]],
                ["Timing basis", compensation["note"]]]) +
            table(["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"],
                  [["Unentered" if x is None else x for x in availability["hoursByWeekday"]]]) +
            table(["Date exception", "Available hours"], sorted(availability["hoursByDate"].items())) +
            table(["Original package", "Remaining hours", "Remaining uninvoiced USD", "Basis"],
                  [[x["costId"], x["remainingHours"], x["remainingCostUsd"], x["note"]] for x in row["allocations"]]) +
            "<h3>Original sources</h3><ul>" + "".join('<li><a href="sources/' + e(sid) + '">' + e(sid) + "</a></li>"
                for sid in sorted(set(sid for part in (row, availability, compensation, acceptance) for sid in part["sourceIds"]))) +
            "</ul>" + "".join("<p><strong>" + e(label) + ":</strong> " + e(part["sourceNote"]) + "</p>"
                for label, part in (("Agreement basis", row), ("Availability basis", availability),
                                    ("Compensation basis", compensation), ("Acceptance basis", acceptance))) + "</section>")
    return ("<!doctype html><html lang=\"en\"><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">"
        "<title>" + e(document["name"]) + "</title><style>body{font:15px system-ui,sans-serif;color:#161616;background:#fff;max-width:1100px;margin:32px auto;padding:0 24px;line-height:1.5}h1,h2,h3{line-height:1.2}section{margin:36px 0;padding-top:18px;border-top:1px solid #999}table{border-collapse:collapse;width:100%;margin:16px 0;font-size:14px}th,td{text-align:left;vertical-align:top;padding:8px;border:1px solid #aaa;white-space:pre-wrap;overflow-wrap:anywhere}th{background:#eee}a{color:inherit}small{overflow-wrap:anywhere}@media print{body{margin:0;max-width:none}h2,h3{break-after:avoid}tr{break-inside:avoid}}</style>"
        "<h1>" + e(document["name"]) + "</h1><p>As of " + e(document["asOfDate"]) + " · " + e(result["mode"]) +
        " · " + e(result["confirmed"]) + " confirmed contributors</p><p>" + e(document["note"]) +
        "</p><small>Edition " + e(review["id"]) + " · " + e(review["sha256"]) + "</small>" + "".join(sections) +
        "<footer><p>Reopen the complete case through the original Operations import. All source attachments, agreement editions, forecasts, portfolios and receiving joins are retained in that case.</p></footer></html>").encode("utf-8")


def selected_files(context, reviews, review_id):
    selected = next((row for row in reviews if row["id"] == review_id and row.get("purpose") == PURPOSE), None)
    if selected is None:
        fail("Select a complete engagement edition for export.", "ENGAGEMENT_NOT_FOUND", 404)
    validate_review(selected, context["plan"])
    choice = {"schema": SCHEMA + ".selection", "reviewId": selected["id"], "reviewSha256": selected["sha256"],
              "originalProgramId": selected["engagements"]["source"]["programId"]}
    return {"engagement-selection.json": (canonical(choice) + "\n").encode(), "engagement.html": html(selected)}


def validate_selection(document, files):
    names = {"engagement-selection.json", "engagement.html"}
    if not names.intersection(files):
        return None
    if not names.issubset(files):
        fail("The selected complete engagement handover is missing a member.")
    value = json.loads(files["engagement-selection.json"])
    obj(value, {"schema", "reviewId", "reviewSha256", "originalProgramId"}, "Engagement handover selection")
    if value.get("schema") != SCHEMA + ".selection":
        fail("Use the original engagement handover selection.")
    selected = next((row for row in document["reviews"] if row["id"] == value.get("reviewId") and row.get("purpose") == PURPOSE), None)
    if selected is None:
        fail("The selected engagement edition is absent from its complete case.")
    validate_review(selected, document["plan"])
    expected = {"schema": SCHEMA + ".selection", "reviewId": selected["id"], "reviewSha256": selected["sha256"],
                "originalProgramId": selected["engagements"]["source"]["programId"]}
    if value != expected or files["engagement.html"] != html(selected):
        fail("The selected engagement handover differs from its original edition.")
    return value


def validate_import(context, reviews, events, saved_forecasts, saved_portfolios, files):
    books = {row["id"]: row for row in reviews if row.get("purpose") == PURPOSE}
    receivers = {row["id"]: row for row in reviews if row.get("purpose") == RECEIVING_PURPOSE}
    if {event.get("recordId") for event in events if event.get("action") == "engagement.prepare"} != set(books):
        fail("The complete operations history is missing an engagement edition.")
    if {event.get("recordId") for event in events if event.get("action") == "engagement.receiving"} != set(receivers):
        fail("The complete operations history is missing an engagement receiving record.")
    for review in books.values():
        validate_review(review, context["plan"])
        version = review["version"]
        if not 2 <= version <= len(events):
            fail("The engagement edition has no original save position.")
        event = events[version - 1]
        if (event.get("action") != "engagement.prepare" or event.get("recordId") != review["id"]
                or event.get("after") != summary(review) or review["engagements"]["source"]["version"] != version - 1):
            fail("The engagement edition does not join its original save event.")
        original = snapshot_context(review)
        for sid in source_ids(review["engagements"]["document"]):
            if original["sources"][sid] != context["sources"].get(sid):
                fail("An engagement source differs from the complete case's original attachment.")
        for person in binding(original, review["engagements"]["document"])["contributors"]:
            prior = next((entry.get("after") for entry in reversed(events[:version - 1])
                if entry.get("kind") == "contributors" and entry.get("recordId") == person["id"]), None)
            if prior is None:
                prior = next((entry.get("before") for entry in events[version - 1:]
                    if entry.get("kind") == "contributors" and entry.get("recordId") == person["id"]), None)
            if prior is None:
                prior = next((row for row in context["records"]["contributors"] if row["id"] == person["id"]), None)
            if prior != person:
                fail("A named contributor does not join its original case history.")
        previous = review["engagements"]["document"]["supersedes"]
        if previous:
            old = books.get(previous["reviewId"])
            if old is None or old["sha256"] != previous["reviewSha256"] or old["version"] >= version:
                fail("The preceding engagement edition is absent or differs.")
    from engagement_handover import validate_receiving
    for review in receivers.values():
        validate_receiving(review, books, saved_forecasts, saved_portfolios, context["plan"])
        if not 2 <= review["version"] <= len(events):
            fail("The receiving review has no original save position.")
        event = events[review["version"] - 1]
        if (event.get("action") != "engagement.receiving" or event.get("recordId") != review["id"]
                or event.get("after") != receiving_summary(review)):
            fail("The complete receiving record differs from its original case event.")
    return validate_selection({"reviews": reviews, "plan": context["plan"]}, files)
