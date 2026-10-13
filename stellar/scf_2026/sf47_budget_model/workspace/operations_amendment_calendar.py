"""Native delivery-calendar impact for a reviewed grant-plan amendment.

This derived view is outside the immutable amendment preview/edition format.
Both agendas come from the original calendar engine and retained case records.
"""
from __future__ import annotations

from copy import deepcopy
from html import escape
import hashlib
import io
import zipfile

import operations_amendments as amendments
import operations_calendar as calendar_model
from model import canonical, csv_bytes, digest, now

SCHEMA = "stellar-forge.sf47-amendment-calendar.v1"
MAX_EXPORT_BYTES = 64 * 1024 * 1024
PAYMENT_KINDS = frozenset(("GRANT_RECEIPT", "SUBMISSION_DEADLINE",
                           "EXTENSION_CONFIRMATION", "FORM_SUBMISSION"))
SCHEDULE_FIELDS = frozenset(("startDate", "endDate", "datePrecision"))
AWARD_FIELDS = frozenset(("originalStartDate", "originalEndDate", "awardDay"))
ASSIGNMENT_FIELDS = ("startDate", "endDate", "ownerIds", "ownerNames", "status",
                     "completedOn", "sourceIds", "workIds", "deploymentIds")
CSV_FIELDS = ("id", "kind", "tranche", "change", "changedFields", "scheduleChanged",
              "awardDatesChanged", "assignmentRetained", "beforeTitle", "selectedTitle",
              "beforeStartDate", "beforeEndDate", "selectedStartDate", "selectedEndDate",
              "beforeDatePrecision", "selectedDatePrecision", "beforeDateBasis",
              "selectedDateBasis", "beforeAwardStartDate", "beforeAwardEndDate",
              "selectedAwardStartDate", "selectedAwardEndDate", "beforeOwners",
              "selectedOwners", "beforeStatus", "selectedStatus", "costId", "sourceId")


def _rows(report):
    return {row["id"]: row for row in report["entries"] + report["undated"]}


def _stable_calendar(report):
    return {key: deepcopy(value) for key, value in report.items()
            if key not in ("generatedAt", "sha256")}


def review(preview, edition=None):
    """Derive the complete paired agenda without editing its original preview."""
    if not isinstance(preview, dict) or preview.get("schema") != amendments.PREVIEW_SCHEMA:
        amendments.fail("Select the complete native amendment preview.", "INVALID_AMENDMENT_CALENDAR")
    before_context = deepcopy(preview["snapshot"])
    selected_context = {**deepcopy(before_context), "plan": deepcopy(preview["selectedPlan"]),
                        "program": {**deepcopy(before_context["program"]),
                                    "planRevision": preview["selectedPlan"]["revision"]}}
    as_of = preview["inputs"]["asOfDate"]
    before = calendar_model.calendar(before_context, as_of)
    selected = calendar_model.calendar(selected_context, as_of)
    before_rows, selected_rows = _rows(before), _rows(selected)
    payment_before = {key: row for key, row in before_rows.items() if row["kind"] in PAYMENT_KINDS}
    payment_selected = {key: row for key, row in selected_rows.items() if row["kind"] in PAYMENT_KINDS}
    if payment_before != payment_selected:
        amendments.fail("The selected agenda changes a recorded payment, form or payment clock.",
                        "AMENDMENT_CALENDAR_PAYMENT_CHANGED", 409)
    comparisons = []
    for ident in sorted(before_rows.keys() | selected_rows.keys()):
        left, right = before_rows.get(ident), selected_rows.get(ident)
        sample = right or left
        fields = sorted(key for key in (left or {}).keys() | (right or {}).keys()
                        if (key in (left or {})) != (key in (right or {}))
                        or (left or {}).get(key) != (right or {}).get(key))
        change = "ADDED" if left is None else "REMOVED" if right is None else "CHANGED" if fields else "UNCHANGED"
        retained = bool(left and right and left["dateBasis"] == right["dateBasis"] == "SAVED_ASSIGNMENT"
                        and all(left.get(key) == right.get(key) for key in ASSIGNMENT_FIELDS))
        comparisons.append({
            "id": ident, "kind": sample["kind"], "tranche": sample["tranche"],
            "change": change, "changedFields": fields,
            "scheduleChanged": bool(set(fields) & SCHEDULE_FIELDS),
            "awardDatesChanged": bool(set(fields) & AWARD_FIELDS),
            "assignmentRetained": retained, "before": deepcopy(left), "selected": deepcopy(right),
        })
    comparisons.sort(key=lambda item: (
        min((row.get("sortDate") or "9999-12-31") for row in (item["before"], item["selected"]) if row),
        item["tranche"] if item["tranche"] is not None else -1, item["kind"], item["id"]))
    program = before_context["program"]
    source = {"caseId": program["id"], "caseVersionAtPreview": preview["observedVersion"],
              "businessSha256": preview["source"]["businessSha256"],
              "previewSha256": preview["previewSha256"],
              "beforePlan": amendments.plan_pin(before_context["plan"]),
              "selectedPlan": amendments.plan_pin(preview["selectedPlan"]),
              "amendment": None if edition is None else {
                  key: deepcopy(edition[key]) for key in ("id", "revision", "sha256", "state", "version")}}
    result = {
        "schema": SCHEMA, "generatedAt": now(), "asOfDate": as_of, "source": source,
        "before": before, "selected": selected, "entries": comparisons,
        "paymentClocks": deepcopy(preview["paymentClocks"]),
        "summary": {
            "beforeDated": len(before["entries"]), "selectedDated": len(selected["entries"]),
            "beforeUndated": len(before["undated"]), "selectedUndated": len(selected["undated"]),
            "changedEntries": sum(row["change"] != "UNCHANGED" for row in comparisons),
            "addedEntries": sum(row["change"] == "ADDED" for row in comparisons),
            "removedEntries": sum(row["change"] == "REMOVED" for row in comparisons),
            "scheduleChanges": sum(row["scheduleChanged"] for row in comparisons),
            "awardDateChanges": sum(row["awardDatesChanged"] for row in comparisons),
            "retainedAssignments": sum(row["assignmentRetained"] for row in comparisons),
            "originalPaymentEntries": len(payment_before),
            "paymentEntriesUnchanged": True,
        },
        "basis": [
            "Both agendas use the original delivery-calendar engine on the amendment's frozen case and selected native planning revision.",
            "Saved assignments retain their dates, contributors and recorded completion while selected award-plan dates remain visible beside them.",
            "Payment receipts, issuer-confirmed extensions and recorded completion forms use the same retained observations on both sides.",
            "A saved edition remains the comparison recorded with that amendment; later case activity is available in the accompanying complete case.",
            "Calendar dates are civil dates. Each ICS represents its own alternative; matching original event identities are preserved.",
        ],
    }
    fingerprint = {key: deepcopy(value) for key, value in result.items() if key != "generatedAt"}
    fingerprint["before"] = _stable_calendar(before)
    fingerprint["selected"] = _stable_calendar(selected)
    result["impactSha256"] = digest(fingerprint)
    return result


def comparison_csv(report, assignments_only=False):
    rows = []
    for item in report["entries"]:
        if assignments_only and item["kind"] != "DELIVERABLE":
            continue
        left, right = item["before"] or {}, item["selected"] or {}
        sample = right or left
        row = {key: item[key] for key in ("id", "kind", "tranche", "change", "scheduleChanged",
                                         "awardDatesChanged", "assignmentRetained")}
        row["changedFields"] = "; ".join(item["changedFields"])
        for prefix, entry in (("before", left), ("selected", right)):
            for suffix, key in (("Title", "title"), ("StartDate", "startDate"),
                                ("EndDate", "endDate"), ("DatePrecision", "datePrecision"),
                                ("DateBasis", "dateBasis"), ("AwardStartDate", "originalStartDate"),
                                ("AwardEndDate", "originalEndDate"), ("Status", "status")):
                row[prefix + suffix] = entry.get(key)
            row[prefix + "Owners"] = "; ".join(entry.get("ownerNames", []))
        row.update(costId=sample.get("costId"), sourceId=sample.get("sourceId"))
        rows.append(row)
    return csv_bytes(CSV_FIELDS, rows)


def _dates(row, award=False):
    if row is None:
        return "No entry"
    if award and row["kind"] != "DELIVERABLE":
        return "Not applicable"
    start, end = ((row.get("originalStartDate"), row.get("originalEndDate")) if award
                  else (row.get("startDate"), row.get("endDate")))
    if not start and not end:
        return "Unassigned"
    if start == end:
        return str(start)
    return (str(start) if start else "Start unassigned") + " to " + (str(end) if end else "Finish unassigned")


def readable_html(report):
    def e(value):
        return escape(str(value if value is not None else ""), quote=True)
    source, summary = report["source"], report["summary"]
    rows = []
    for item in report["entries"]:
        left, right = item["before"], item["selected"]
        sample = right or left
        rows.append("<tr><td>" + e(sample["title"]) + "<br><code>" + e(item["id"]) + "</code></td>"
                    "<td>" + e(item["change"]) + "<br>" + e(", ".join(item["changedFields"])) + "</td>"
                    "<td>" + e(_dates(left)) + "</td><td>" + e(_dates(right)) + "</td>"
                    "<td>" + e(_dates(left, True)) + "<br>to " + e(_dates(right, True)) + "</td>"
                    "<td>" + e("; ".join((right or left).get("ownerNames", []))) + "<br>"
                    + ("Saved assignment retained" if item["assignmentRetained"] else e(sample["dateBasis"])) + "</td></tr>")
    links = "".join('<li><a href="' + side + '/calendar.' + kind + '">' + label + " " + kind.upper() + "</a></li>"
                    for side, label in (("before", "Before"), ("selected", "Selected"))
                    for kind in ("ics", "csv", "json"))
    html = ('<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
            "<title>Amendment delivery calendar</title><style>"
            "body{font:16px/1.5 system-ui,sans-serif;color:#202020;background:#fff;margin:2rem;max-width:100rem}"
            "h1,h2{line-height:1.25}code{overflow-wrap:anywhere}nav ul{display:flex;flex-wrap:wrap;gap:1.2rem;padding:0;list-style:none}"
            "a{color:inherit}.scroll{overflow:auto}table{border-collapse:collapse;width:100%;min-width:56rem}"
            "td,th{border:1px solid #aaa;padding:.6rem;text-align:left;vertical-align:top}th{background:#eee}"
            "p{max-width:95ch}td{max-width:30rem;overflow-wrap:anywhere}@media(max-width:480px){body{margin:1rem}}</style>"
            "<h1>Amendment delivery calendar</h1><p>Case <code>" + e(source["caseId"]) + "</code>; frozen version "
            + e(source["caseVersionAtPreview"]) + "; comparison date " + e(report["asOfDate"]) + ".</p>"
            "<p>Native baseline revision " + e(source["beforePlan"]["revision"]) + " to selected revision "
            + e(source["selectedPlan"]["revision"]) + ". " + e(summary["changedEntries"]) + " entries change; "
            + e(summary["retainedAssignments"]) + " saved assignments retain their recorded dates and owners. "
            + e(summary["originalPaymentEntries"]) + " original payment/form entries are unchanged.</p>"
            "<nav><ul>" + links + '<li><a href="original-case.zip">Complete operating case</a></li>'
            '<li><a href="calendar-impact.json">Complete comparison JSON</a></li>'
            '<li><a href="entry-comparison.csv">All entry comparisons CSV</a></li>'
            '<li><a href="assignment-comparison.csv">Assignment comparison CSV</a></li></ul></nav>'
            "<p>" + " ".join(e(line) for line in report["basis"]) + "</p>"
            '<div class="scroll" tabindex="0"><table><thead><tr><th>Entry</th><th>Change</th><th>Before dates</th>'
            "<th>Selected dates</th><th>Award-plan dates: before / selected</th><th>Contributors / basis</th>"
            "</tr></thead><tbody>" + "".join(rows) + "</tbody></table></div>"
            "<h2>Original selection</h2><p>Amendment preview <code>" + e(source["previewSha256"])
            + "</code><br>Calendar impact <code>" + e(report["impactSha256"]) + "</code></p></html>")
    return html.encode("utf-8")


def export_bytes(report, preview, original_case, edition=None):
    """Keep both full native calendars, exact selection and recoverable case."""
    if report.get("schema") != SCHEMA or not isinstance(original_case, bytes):
        amendments.fail("Export the complete native calendar-impact selection.", "INVALID_AMENDMENT_CALENDAR")
    files = {
        "calendar-impact.json": (canonical(report) + "\n").encode("utf-8"),
        "frozen-amendment-preview.json": (canonical(preview) + "\n").encode("utf-8"),
        "entry-comparison.csv": comparison_csv(report),
        "assignment-comparison.csv": comparison_csv(report, assignments_only=True),
        "index.html": readable_html(report),
        "original-case.zip": original_case,
        "README.txt": ("Amendment delivery-calendar review\n\n"
                       "Open index.html for the complete before/selected comparison. Both native calendars are exported in ICS, CSV and JSON. "
                       "Undated entries remain in JSON and CSV; only dated entries become ICS events. "
                       "The two ICS files retain the same original event identities and should be viewed as alternatives in separate calendars.\n\n"
                       "frozen-amendment-preview.json retains the exact comparison inputs, case snapshot, original planning revisions and native reports. "
                       "original-case.zip is the complete current operating case with native history and retained source attachments; reopen it through the original Operations import. "
                       "The frozen comparison remains tied to its recorded case version.\n\n"
                       "Selection: " + report["source"]["previewSha256"] + "\n"
                       "Calendar impact: " + report["impactSha256"] + "\n").encode("utf-8"),
    }
    for side in ("before", "selected"):
        for kind in ("ics", "csv", "json"):
            files[side + "/calendar." + kind] = calendar_model.export_bytes(report[side], kind)
    if edition is not None:
        files["saved-amendment.json"] = (canonical(edition) + "\n").encode("utf-8")
    manifest = {"schema": SCHEMA + ".bundle", "source": deepcopy(report["source"]),
                "impactSha256": report["impactSha256"],
                "files": [{"path": name, "bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest()}
                          for name, raw in sorted(files.items())]}
    files["MANIFEST.json"] = (canonical(manifest) + "\n").encode("utf-8")
    if sum(len(raw) for raw in files.values()) > MAX_EXPORT_BYTES:
        amendments.fail("The complete amendment-calendar export exceeds 64 MiB.", "AMENDMENT_CALENDAR_LIMIT", 413)
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
        for name, raw in sorted(files.items()):
            info = zipfile.ZipInfo(name, (2026, 1, 1, 0, 0, 0))
            info.external_attr = 0o600 << 16
            info.compress_type = zipfile.ZIP_DEFLATED
            archive.writestr(info, raw)
    raw = output.getvalue()
    if len(raw) > MAX_EXPORT_BYTES:
        amendments.fail("The compressed amendment-calendar export exceeds 64 MiB.", "AMENDMENT_CALENDAR_LIMIT", 413)
    return raw
