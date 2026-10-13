"""One complete delivery agenda over explicitly selected original operations cases."""
from __future__ import annotations

from collections import Counter
from copy import deepcopy
import re

import operations_calendar as calendar_model
import operations_domain as domain
from model import canonical, csv_bytes as original_csv_bytes, digest, now

SCHEMA = "stellar-forge.sf47-delivery-agenda.v1"
CASE_ID = re.compile(r"operation-[a-f0-9]{32}\Z")
FORMATS = calendar_model.FORMATS
CSV_FIELDS = ("caseId", "caseName", "caseMode", "caseState", "caseVersion",
              "planId", "planRevision", "asOfDate", "nativeCalendarSha256",
              *calendar_model.CSV_FIELDS)


def selected_cases(case_ids, expected_versions=None):
    """Validate the whole selection before reading any original case."""
    if not isinstance(case_ids, (list, tuple)) or not case_ids:
        domain.fail("Select at least one original operations case.", "INVALID_DELIVERY_AGENDA")
    identities = list(case_ids)
    if any(not isinstance(value, str) or not CASE_ID.fullmatch(value) for value in identities):
        domain.fail("Use the complete original operations case IDs.", "INVALID_DELIVERY_AGENDA")
    if len(set(identities)) != len(identities):
        domain.fail("Select each original case once.", "INVALID_DELIVERY_AGENDA")
    versions = None
    if expected_versions is not None:
        if not isinstance(expected_versions, dict) or set(expected_versions) != set(identities):
            domain.fail("Supply one selected version for every selected case.", "INVALID_AGENDA_VERSIONS")
        versions = {
            ident: domain.integer(expected_versions[ident], "Selected agenda case version", 1, 10000000)
            for ident in identities
        }
    return identities, versions


def agenda(contexts, as_of=None):
    """Compose complete per-case calendars, retaining their original source and hashes."""
    if not isinstance(contexts, (list, tuple)) or not contexts:
        domain.fail("Read the selected original cases before opening their agenda.", "INVALID_DELIVERY_AGENDA")
    case_ids, _ = selected_cases([context["program"]["id"] for context in contexts])
    selected_date = None if as_of is None else domain.calendar(as_of, "Delivery agenda date")
    cases, entries, undated = [], [], []
    totals = Counter()
    kinds = Counter()
    deadlines = []
    basis = [
        "The agenda reads the explicitly selected cases in one native workspace snapshot.",
        "Each selected case is shown independently, including received copies when both are selected.",
        "Case names, modes, versions and original record identities remain attached to every entry.",
        "Downloads retain every dated and undated row in the selected cases; screen filters change the view.",
    ]
    for context, ident in zip(contexts, case_ids):
        original = calendar_model.calendar(context, selected_date)
        selected_date = original["asOfDate"]
        metadata = {key: deepcopy(value) for key, value in original.items()
                    if key not in ("entries", "undated")}
        cases.append({"id": ident, "origin": deepcopy(context["program"].get("origin", {})),
                      "calendar": metadata})
        for name, destination in (("entries", entries), ("undated", undated)):
            for position, entry in enumerate(original[name]):
                destination.append({
                    "id": ident + ":" + entry["id"], "caseId": ident,
                    "position": position, "entry": deepcopy(entry),
                })
        for key in ("activeDeadlines", "overdueDeadlines", "dueToday", "submittedDeadlines",
                    "openDeliverables", "completedDeliverables"):
            totals[key] += original["summary"][key]
        kinds.update(original["summary"]["byKind"])
        if original["summary"]["nextDeadlineOn"]:
            deadlines.append(original["summary"]["nextDeadlineOn"])
        for explanation in original["basis"]:
            if explanation not in basis:
                basis.append(explanation)
    names = {item["id"]: item["calendar"]["case"]["name"].casefold() for item in cases}
    entries.sort(key=lambda row: (row["entry"]["sortDate"], names[row["caseId"]],
                                  row["caseId"], row["position"]))
    undated.sort(key=lambda row: (names[row["caseId"]], row["caseId"], row["position"]))
    result = {
        "schema": SCHEMA, "generatedAt": now(), "asOfDate": selected_date,
        "selection": {
            "caseIds": case_ids, "asOfDate": selected_date,
            "expectedVersions": {item["id"]: item["calendar"]["case"]["version"] for item in cases},
        },
        "cases": cases, "entries": entries, "undated": undated,
        "summary": {
            "cases": len(cases), "entries": len(entries), "undated": len(undated),
            **{key: totals[key] for key in ("activeDeadlines", "overdueDeadlines", "dueToday",
                "submittedDeadlines", "openDeliverables", "completedDeliverables")},
            "nextDeadlineOn": min(deadlines) if deadlines else None,
            "byKind": dict(sorted(kinds.items())),
        },
        "basis": basis,
    }
    result["sha256"] = digest(result)
    return result


def read(operations, case_ids, as_of=None, expected_versions=None):
    identities, versions = selected_cases(case_ids, expected_versions)
    with operations._snapshot():
        contexts = [operations._context(ident) for ident in identities]
        if versions is not None:
            changed = [context["program"]["name"] for context in contexts
                       if context["program"]["version"] != versions[context["program"]["id"]]]
            if changed:
                domain.fail("Selected cases changed. Refresh the agenda: " + "; ".join(changed),
                            "OPERATIONS_CONFLICT", 409)
        return agenda(contexts, as_of)


def _format(value):
    if not isinstance(value, str) or value not in FORMATS:
        domain.fail("Choose ics, csv or json for the delivery agenda.", "INVALID_DELIVERY_AGENDA")
    return value


def content_type(format="ics"):
    return FORMATS[_format(format)]


def filename(report, format="ics"):
    return "sf47-delivery-agenda-" + report["asOfDate"] + "." + _format(format)


def _native_reports(report):
    """Recover each unchanged native calendar, including its original row order."""
    if not isinstance(report, dict) or report.get("schema") != SCHEMA:
        domain.fail("Export the complete original delivery agenda.", "INVALID_DELIVERY_AGENDA")
    try:
        identities, versions = selected_cases(report["selection"]["caseIds"],
                                               report["selection"]["expectedVersions"])
        if [item["id"] for item in report["cases"]] != identities:
            raise ValueError("case selection differs")
        grouped = {ident: {"entries": [], "undated": []} for ident in identities}
        for collection in ("entries", "undated"):
            for row in report[collection]:
                if (row["caseId"] not in grouped or isinstance(row["position"], bool)
                        or not isinstance(row["position"], int) or row["position"] < 0
                        or row["id"] != row["caseId"] + ":" + row["entry"]["id"]):
                    raise ValueError("entry selection differs")
                grouped[row["caseId"]][collection].append(row)
        results = []
        for item in report["cases"]:
            original = deepcopy(item["calendar"])
            ident = item["id"]
            if (original["schema"] != calendar_model.SCHEMA or original["case"]["id"] != ident
                    or original["case"]["version"] != versions[ident]
                    or original["asOfDate"] != report["asOfDate"]
                    or original["asOfDate"] != report["selection"]["asOfDate"]):
                raise ValueError("calendar source differs")
            for collection in ("entries", "undated"):
                rows = sorted(grouped[ident][collection], key=lambda row: row["position"])
                if [row["position"] for row in rows] != list(range(len(rows))):
                    raise ValueError("original entry order differs")
                original[collection] = [deepcopy(row["entry"]) for row in rows]
            if digest({key: value for key, value in original.items() if key != "sha256"}) != original["sha256"]:
                raise ValueError("original calendar is incomplete or changed")
            results.append(original)
        if digest({key: value for key, value in report.items() if key != "sha256"}) != report["sha256"]:
            raise ValueError("agenda source differs")
        return results
    except (KeyError, TypeError, ValueError, AttributeError) as exc:
        domain.fail("The selected agenda must retain its complete original case calendars: " + str(exc),
                    "INVALID_DELIVERY_AGENDA")


def ical_bytes(report, originals=None):
    """Keep original event UIDs, date bounds, states and native source properties."""
    originals = _native_reports(report) if originals is None else originals
    lines = [
        "BEGIN:VCALENDAR", "VERSION:2.0",
        "PRODID:-//TokenJunkieLabs//Stellar delivery agenda//EN",
        "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
        "X-WR-CALNAME:Grant delivery agenda",
        "X-WR-CALDESC:" + calendar_model._ical_text(
            str(len(originals)) + " selected original cases; as of " + report["asOfDate"]),
    ]
    for original in originals:
        # Unfold only our own native encoder's output, then refold the combined
        # file with that same UTF-8-aware RFC5545 implementation.
        unfolded = []
        for line in calendar_model.ical_bytes(original).decode("utf-8").split("\r\n"):
            if line.startswith((" ", "\t")) and unfolded:
                unfolded[-1] += line[1:]
            elif line:
                unfolded.append(line)
        inside = False
        for line in unfolded:
            if line == "BEGIN:VEVENT":
                inside = True
            if not inside:
                continue
            if line.startswith("SUMMARY:"):
                line = "SUMMARY:" + calendar_model._ical_text(original["case"]["name"] + " — ") + line[8:]
            if line == "END:VEVENT":
                lines.extend([
                    "X-SF47-CASE-ID:" + calendar_model._ical_text(original["case"]["id"]),
                    "X-SF47-CASE-VERSION:" + str(original["case"]["version"]),
                ])
            lines.append(line)
            if line == "END:VEVENT":
                inside = False
    lines.append("END:VCALENDAR")
    return ("\r\n".join(calendar_model._fold(line) for line in lines) + "\r\n").encode("utf-8")


def csv_bytes(report):
    metadata = {item["id"]: item["calendar"] for item in report["cases"]}
    rows = []
    for item in report["entries"] + report["undated"]:
        original = metadata[item["caseId"]]
        case, source = original["case"], original["source"]
        row = {
            "caseId": case["id"], "caseName": case["name"], "caseMode": case["mode"],
            "caseState": case["state"], "caseVersion": case["version"],
            "planId": source["planId"], "planRevision": source["planRevision"],
            "asOfDate": report["asOfDate"], "nativeCalendarSha256": original["sha256"],
            **deepcopy(item["entry"]),
        }
        for key in ("ownerIds", "ownerNames", "sourceIds"):
            row[key] = "; ".join(map(str, row[key]))
        rows.append(row)
    return original_csv_bytes(CSV_FIELDS, rows)


def export_bytes(report, format="ics"):
    format = _format(format)
    originals = _native_reports(report)
    if format == "ics":
        return ical_bytes(report, originals)
    if format == "csv":
        return csv_bytes(report)
    return (canonical(report) + "\n").encode("utf-8")
