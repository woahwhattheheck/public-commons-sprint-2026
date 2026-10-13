"""Read-only delivery agenda over the original SF47 case and completion clocks."""
from __future__ import annotations

from collections import Counter
from copy import deepcopy
from datetime import date, datetime, timedelta, timezone
import hashlib

import operations_completion as completion
import operations_domain as domain
from model import canonical, csv_bytes as original_csv_bytes, digest, now

SCHEMA = "stellar-forge.sf47-delivery-calendar.v1"
KINDS = ("GRANT_RECEIPT", "SUBMISSION_DEADLINE", "PLANNED_SUBMISSION",
         "DELIVERABLE", "DELIVERABLE_COMPLETED", "FORM_SUBMISSION", "EXTENSION_CONFIRMATION")
FORMATS = {
    "ics": "text/calendar; charset=utf-8",
    "csv": "text/csv; charset=utf-8",
    "json": "application/json; charset=utf-8",
}
CSV_FIELDS = ("id", "kind", "tranche", "title", "startDate", "endDate", "datePrecision",
              "status", "active", "dateBasis", "dateStatus", "daysRemaining",
              "originalDeadlineOn", "deadlineSource", "sourceId", "costId",
              "ownerIds", "ownerNames", "sourceIds", "detail")


def _label(value, fallback):
    value = " ".join(str(value or fallback).split())
    return value if len(value) <= 180 else value[:177].rstrip() + "..."


def _row(kind, identity, tranche, title, start=None, end=None, *, source_id=None,
         status="PLANNED", active=True, detail="", **extra):
    precision = ("RANGE" if start and end and start != end else "DAY" if start and end
                 else "START_ONLY" if start else "FINISH_ONLY" if end else "UNDATED")
    return {
        "id": kind.lower() + ":" + str(identity), "kind": kind, "tranche": tranche,
        "title": _label(title, identity), "startDate": start, "endDate": end,
        "sortDate": start or end, "datePrecision": precision, "status": status,
        "active": active, "detail": detail, "sourceId": source_id or identity,
        "costId": None, "ownerIds": [], "ownerNames": [], "sourceIds": [],
        "dateBasis": "RETAINED_RECORD", "calendarStatus": "CONFIRMED", **extra,
    }


def _receipt_status(row, as_of):
    if row["state"] != "OBSERVED":
        return "PAYMENT_VOID"
    if "testnet" in row.get("network", "").lower():
        return "TESTNET"
    if row["date"] > as_of:
        return "PAYMENT_FUTURE"
    return "OBSERVED"


def _assignment_status(start, finish, state, as_of):
    if state == "COMPLETE":
        return "COMPLETE"
    if finish and finish < as_of:
        return "PAST_FINISH"
    if finish == as_of:
        return "FINISH_TODAY"
    if start and start > as_of:
        return "UPCOMING"
    if start:
        return "ON_OR_AFTER_START"
    return "UNDATED" if not finish else "UPCOMING"


def calendar(context, as_of=None):
    """Build the agenda without modifying the context, case, assignments or clocks."""
    original = completion.dashboard(context, as_of)
    as_of = original["asOfDate"]
    program, plan = context["program"], context["plan"]
    people = {row["id"]: row for row in context["records"]["contributors"]}
    clock_by_receipt = {row["receiptId"]: row for row in original["clocks"]}
    entries, undated = [], []

    def add(row):
        (entries if row["sortDate"] else undated).append(row)

    for cash in context["records"]["cash"]:
        if cash["category"] != "GRANT" or cash["direction"] != "IN":
            continue
        status = _receipt_status(cash, as_of)
        title = "Tranche " + str(cash["tranche"]) + " grant receipt" if cash["tranche"] is not None else "Grant receipt (tranche unassigned)"
        add(_row(
            "GRANT_RECEIPT", cash["id"], cash["tranche"], title, cash["date"], cash["date"],
            status=status, active=status == "OBSERVED",
            detail=str(cash["amount"]) + " " + cash["currency"] + "; " + cash["externalRef"],
            sourceIds=deepcopy(cash["sourceIds"]), amount=cash["amount"], currency=cash["currency"],
            usdValue=cash["usdValue"], network=cash.get("network", ""),
            calendarStatus="CANCELLED" if status in ("PAYMENT_VOID", "TESTNET") else "TENTATIVE" if status == "PAYMENT_FUTURE" else "CONFIRMED",
        ))

    for clock in original["clocks"]:
        extension = clock["extension"]
        detail = "Completion form for tranche " + str(clock["tranche"]) + \
                 ". Previous payment: " + clock["paidOn"] + \
                 ". Original 90-calendar-day deadline: " + clock["originalDeadlineOn"] + "."
        if extension:
            detail += " Issuer-confirmed deadline: " + clock["deadlineOn"] + \
                      "; confirmation received " + extension["confirmedOn"] + \
                      "; reference: " + extension["reference"] + "."
        if clock["submissions"]:
            detail += " Retained form submissions: " + "; ".join(
                item["submittedOn"] + " (" + item["state"] + ")" for item in clock["submissions"]) + "."
        if not clock["active"]:
            detail += " Receipt classification: " + clock["status"] + "; this clock is inactive."
        sources = list(clock["paymentSourceIds"])
        if extension:
            sources = sorted(set(sources + extension["sourceIds"]))
        add(_row(
            "SUBMISSION_DEADLINE", clock["receiptId"], clock["tranche"],
            "Tranche " + str(clock["tranche"]) + " completion form",
            clock["deadlineOn"], clock["deadlineOn"], status=clock["status"],
            active=clock["active"], detail=detail, sourceIds=sources,
            dateBasis="CONFIRMED_EXTENSION" if extension else "RECEIVED_PAYMENT",
            deadlineSource="CONFIRMED_EXTENSION" if extension else "RECEIVED_PAYMENT",
            originalDeadlineOn=clock["originalDeadlineOn"], paymentDate=clock["paidOn"],
            paymentTranche=clock["paymentTranche"], daysRemaining=clock["daysRemaining"],
            extensionId=extension["id"] if extension else None,
            calendarStatus="CONFIRMED" if clock["active"] else "CANCELLED",
        ))

    for tranche in original["tranches"]:
        number, saved = tranche["tranche"], tranche["plan"]
        target = tranche["awardSubmitDate"]
        add(_row(
            "PLANNED_SUBMISSION", number, number,
            "Tranche " + str(number) + " planned submission", target, target,
            source_id=plan["id"], detail=tranche["deliverable"] +
            ("\nSuccess criteria: " + tranche["successCriteria"] if tranche["successCriteria"] else ""),
            dateBasis="AWARD_PLAN", awardDay=tranche["awardSubmitDay"],
            calendarStatus="TENTATIVE",
        ))
        assigned = {row["costId"]: row for row in saved["inputs"]["items"]} if saved else {}
        for package in tranche["packages"]:
            item = assigned.get(package["costId"])
            start = item["startDate"] if item else package["awardStartDate"]
            end = item["endDate"] if item else package["awardEndDate"]
            owner_ids = list(item["ownerIds"]) if item else []
            owner_names = [people[ident]["name"] for ident in owner_ids if ident in people]
            state = item["state"] if item else "PLANNED"
            detail = package["remainingWork"]
            if package["successCriteria"]:
                detail += "\nSuccess criteria: " + package["successCriteria"]
            if item and item["note"]:
                detail += "\nAssignment: " + item["note"]
            if item and item["completionNote"]:
                detail += "\nCompletion: " + item["completionNote"]
            add(_row(
                "DELIVERABLE", package["costId"], number, package["remainingWork"],
                start, end, source_id=saved["id"] if saved else plan["id"],
                status=state, detail=detail, costId=package["costId"],
                ownerIds=owner_ids, ownerNames=owner_names,
                sourceIds=deepcopy(item["sourceIds"]) if item else [],
                dateBasis="SAVED_ASSIGNMENT" if item else "AWARD_PLAN",
                dateStatus=_assignment_status(start, end, state, as_of),
                originalStartDate=package["awardStartDate"], originalEndDate=package["awardEndDate"],
                completedOn=item["completedOn"] if item else None,
                plannedHours=package["plannedHours"], plannedUsd=package["plannedUsd"],
                planningAssignments=deepcopy(package["planningAssignments"]),
                workIds=deepcopy(item["workIds"]) if item else [],
                deploymentIds=deepcopy(item["deploymentIds"]) if item else [],
                calendarStatus="TENTATIVE",
            ))
            if item and item["completedOn"]:
                add(_row(
                    "DELIVERABLE_COMPLETED", package["costId"], number,
                    "Completed: " + _label(package["remainingWork"], package["costId"]),
                    item["completedOn"], item["completedOn"], source_id=saved["id"],
                    status="COMPLETE", active=item["completedOn"] <= as_of,
                    detail=item["completionNote"], costId=package["costId"],
                    ownerIds=owner_ids, ownerNames=owner_names, sourceIds=deepcopy(item["sourceIds"]),
                    calendarStatus="CONFIRMED" if item["completedOn"] <= as_of else "TENTATIVE",
                ))
        for extension in saved["extensions"] if saved else []:
            clock = clock_by_receipt.get(extension["receiptId"])
            effective = bool(clock and clock["active"] and clock["extension"] and
                             clock["extension"]["id"] == extension["id"])
            state = "CONFIRMATION_FUTURE" if extension["confirmedOn"] > as_of else \
                    "EFFECTIVE" if effective else "RETAINED_CONFIRMATION"
            add(_row(
                "EXTENSION_CONFIRMATION", extension["id"], number,
                "Tranche " + str(number) + " deadline extension confirmed",
                extension["confirmedOn"], extension["confirmedOn"], status=state,
                active=effective, detail=extension["reference"] + "\nConfirmed deadline: " +
                extension["deadlineOn"] + ("\n" + extension["note"] if extension["note"] else ""),
                sourceIds=deepcopy(extension["sourceIds"]), receiptId=extension["receiptId"],
                confirmedDeadlineOn=extension["deadlineOn"],
                calendarStatus="TENTATIVE" if extension["confirmedOn"] > as_of else "CONFIRMED",
            ))

    for outcome in context["records"]["outcomes"]:
        submitted = outcome.get("completion")
        if not submitted:
            continue
        stamp = submitted["submittedOn"]
        add(_row(
            "FORM_SUBMISSION", outcome["id"], outcome["tranche"],
            "Tranche " + str(outcome["tranche"]) + " completion form submitted",
            stamp, stamp, status=outcome["state"], active=stamp <= as_of,
            detail=submitted["formReference"] + "\nDeadline retained with submission: " +
            submitted["deadlineOn"] + "\nCurrent outcome state: " + outcome["state"],
            sourceIds=deepcopy(outcome["sourceIds"]), receiptId=submitted["receiptId"],
            reviewId=submitted["reviewId"], originalDeadlineOn=submitted["originalDeadlineOn"],
            submittedDeadlineOn=submitted["deadlineOn"],
            submittedWithinDeadline=stamp <= submitted["deadlineOn"],
            calendarStatus="CONFIRMED" if stamp <= as_of else "TENTATIVE",
        ))

    ordering = {kind: index for index, kind in enumerate(KINDS)}
    entries.sort(key=lambda row: (row["sortDate"], row["tranche"] if row["tranche"] is not None else -1,
                                  ordering[row["kind"]], row["id"]))
    undated.sort(key=lambda row: (row["tranche"] if row["tranche"] is not None else -1,
                                  ordering[row["kind"]], row["id"]))
    all_rows = entries + undated
    deadlines = [row for row in entries if row["kind"] == "SUBMISSION_DEADLINE" and row["active"]]
    open_deadlines = [row for row in deadlines if row["status"] != "FORM_SUBMITTED"]
    deliverables = [row for row in all_rows if row["kind"] == "DELIVERABLE"]
    future_deadlines = [row["startDate"] for row in open_deadlines if row["startDate"] >= as_of]
    result = {
        "schema": SCHEMA,
        "case": {key: program[key] for key in ("id", "name", "mode", "state", "version")},
        "asOfDate": as_of, "generatedAt": now(),
        "source": {
            "planId": plan["id"], "planRevision": plan["revision"],
            "planContentSha256": plan["contentSha256"], "planSourceSha256": plan["source"]["sha256"],
            "calendarStart": original["calendarStart"], "caseUpdatedAt": program["updatedAt"],
            "caseCreatedAt": program["createdAt"],
            "completionPlans": [completion.plan_summary(row) for row in context.get("completionPlans", [])],
        },
        "rule": deepcopy(original["rule"]),
        "basis": [
            "Grant submission clocks use the original completion engine: 90 calendar days after the previous received payment, with retained issuer-confirmed extensions.",
            "Deliverable dates use the saved completion assignment when present; otherwise they use the pinned award plan and its existing calendar anchor.",
            "Planned submissions and deliverables are planning dates. Grant receipt and completion-form entries retain their original recorded dates and states.",
            "The selected date classifies the current retained case; it does not restore an earlier version of that case.",
            "All dates are civil calendar dates. The exported calendar contains no reminder alarms.",
        ],
        "entries": entries, "undated": undated,
        "summary": {
            "entries": len(entries), "undated": len(undated),
            "activeDeadlines": len(open_deadlines),
            "overdueDeadlines": sum(row["status"] == "OVERDUE" for row in deadlines),
            "dueToday": sum(row["status"] == "DUE_TODAY" for row in deadlines),
            "submittedDeadlines": sum(row["status"] == "FORM_SUBMITTED" for row in deadlines),
            "openDeliverables": sum(row["status"] != "COMPLETE" for row in deliverables),
            "completedDeliverables": sum(row["status"] == "COMPLETE" for row in deliverables),
            "nextDeadlineOn": min(future_deadlines) if future_deadlines else None,
            "byKind": dict(sorted(Counter(row["kind"] for row in all_rows).items())),
        },
    }
    result["sha256"] = digest(result)
    return result


def _format(value):
    if not isinstance(value, str) or value not in FORMATS:
        domain.fail("Choose ics, csv or json for the delivery calendar.", "INVALID_DELIVERY_CALENDAR")
    return value


def content_type(format="ics"):
    return FORMATS[_format(format)]


def filename(report, format="ics"):
    return "sf47-delivery-" + report["case"]["id"] + "-" + report["asOfDate"] + "." + _format(format)


def _ical_text(value):
    value = str(value if value is not None else "").replace("\r\n", "\n").replace("\r", "\n")
    return value.replace("\\", "\\\\").replace(";", "\\;").replace(",", "\\,").replace("\n", "\\n")


def _fold(line):
    """Fold to at most 75 UTF-8 octets, including each continuation's space."""
    parts, current, length = [], "", 0
    for char in line:
        width = len(char.encode("utf-8"))
        if length + width > 75:
            parts.append(current)
            current, length = " ", 1
        current += char
        length += width
    parts.append(current)
    return "\r\n".join(parts)


def _utc(value):
    try:
        stamp = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if stamp.tzinfo is None:
            domain.fail("Calendar record times must retain their timezone.", "INVALID_DELIVERY_CALENDAR")
        return stamp.astimezone(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    except (AttributeError, ValueError, OverflowError):
        domain.fail("The retained calendar timestamp is invalid.", "INVALID_DELIVERY_CALENDAR")


def _bounds(row):
    start, end = row["startDate"], row["endDate"]
    first, last = start or end, end or start
    try:
        first_day, last_day = date.fromisoformat(first), date.fromisoformat(last)
        if last_day < first_day:
            domain.fail("A calendar entry finishes before it starts.", "INVALID_DELIVERY_CALENDAR")
        exclusive = last_day + timedelta(days=1)
    except (TypeError, ValueError, OverflowError):
        domain.fail("A dated entry exceeds the supported calendar range.", "INVALID_DELIVERY_CALENDAR")
    return first_day.isoformat().replace("-", ""), exclusive.isoformat().replace("-", "")


def ical_bytes(report):
    case = report["case"]
    stamp = _utc(report["generatedAt"])
    modified = _utc(report["source"]["caseUpdatedAt"])
    created = _utc(report["source"]["caseCreatedAt"])
    lines = [
        "BEGIN:VCALENDAR", "VERSION:2.0",
        "PRODID:-//TokenJunkieLabs//Stellar delivery calendar//EN",
        "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
        "X-WR-CALNAME:" + _ical_text(case["name"]),
        "X-WR-CALDESC:" + _ical_text("Delivery calendar; case version " + str(case["version"]) +
                                    "; as of " + report["asOfDate"]),
    ]
    for row in report["entries"]:
        start, end = _bounds(row)
        uid = hashlib.sha256((case["id"] + "\0" + row["id"]).encode("utf-8")).hexdigest() + "@sf47.tjlabs"
        title = row["title"]
        if case["mode"] == "WALKTHROUGH":
            title = "[Walkthrough] " + title
        if row["datePrecision"] == "START_ONLY":
            title += " (start)"
        elif row["datePrecision"] == "FINISH_ONLY":
            title += " (finish)"
        if row["status"] == "FORM_SUBMITTED":
            title += " (submitted)"
        description = [
            case["name"] + " | " + case["mode"],
            "State: " + row["status"], "Date basis: " + row["dateBasis"], row["detail"],
            "Original record: " + str(row["sourceId"]),
        ]
        if row["ownerNames"]:
            description.append("Assigned contributors: " + "; ".join(row["ownerNames"]))
        if row["datePrecision"] == "START_ONLY":
            description.append("Only the start date is assigned; the finish remains unassigned.")
        elif row["datePrecision"] == "FINISH_ONLY":
            description.append("Only the finish date is assigned; the start remains unassigned.")
        if row.get("costId"):
            description.append("Work package: " + row["costId"])
        if row["kind"] == "SUBMISSION_DEADLINE":
            description.append("Rule: " + report["rule"]["sourceUrl"])
        lines.extend([
            "BEGIN:VEVENT", "UID:" + uid, "DTSTAMP:" + stamp, "CREATED:" + created,
            "LAST-MODIFIED:" + modified, "SEQUENCE:" + str(case["version"]),
            "DTSTART;VALUE=DATE:" + start, "DTEND;VALUE=DATE:" + end,
            "SUMMARY:" + _ical_text(title),
            "DESCRIPTION:" + _ical_text("\n".join(item for item in description if item)),
            "CATEGORIES:" + row["kind"],
            "STATUS:" + row["calendarStatus"], "TRANSP:TRANSPARENT",
            "X-SF47-SOURCE-ID:" + _ical_text(row["sourceId"]),
            "X-SF47-STATE:" + _ical_text(row["status"]), "END:VEVENT",
        ])
    lines.append("END:VCALENDAR")
    return ("\r\n".join(_fold(line) for line in lines) + "\r\n").encode("utf-8")


def csv_bytes(report):
    rows = []
    for entry in report["entries"] + report["undated"]:
        row = deepcopy(entry)
        for key in ("ownerIds", "ownerNames", "sourceIds"):
            row[key] = "; ".join(map(str, row[key]))
        rows.append(row)
    return original_csv_bytes(CSV_FIELDS, rows)


def export_bytes(report, format="ics"):
    format = _format(format)
    if not isinstance(report, dict) or report.get("schema") != SCHEMA:
        domain.fail("Export the original delivery calendar response.", "INVALID_DELIVERY_CALENDAR")
    if format == "ics":
        return ical_bytes(report)
    if format == "csv":
        return csv_bytes(report)
    return (canonical(report) + "\n").encode("utf-8")
