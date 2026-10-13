"""Delivery coordination over the original saved Customer Installation editions.

Assignments are planning metadata. Native Installation acceptance observations,
history, request recovery and source attachments retain their original writers.
"""
from __future__ import annotations

from collections import Counter
from copy import deepcopy
from datetime import date, datetime, timezone
from html import escape
import hashlib
import io
import json
import re
import zipfile

from model import MAX_BUNDLE, Problem, canonical, csv_bytes, digest, text

SCHEMA = "stellar-forge.sf47-delivery-queue.v1"
PRIORITIES = ("URGENT", "HIGH", "NORMAL", "LOW")
DONE = ("ACCEPTED", "NOT_APPLICABLE")
CSV_FIELDS = ("installationId", "installationName", "revision", "editionSha256",
              "taskId", "kind", "title", "criterion", "stage", "state", "required",
              "owner", "dueDate", "priority", "dueStatus", "done", "ready",
              "waitingFor", "retired", "caseClosed", "sourceAvailable",
              "sourceRecordsChanged", "acceptanceOperator", "acceptedAt", "note")
BUNDLE_README = (
    "SF47 Installation delivery queue\n\n"
    "Open report.html for the complete dated work queue or work.csv for spreadsheet planning.\n"
    "The selected calendar date classifies the current saved installation heads. It does not "
    "reconstruct earlier case history.\n\n"
    "Import this entire ZIP through Delivery operations > Import complete case, or the original "
    "operations import command. The receiving workspace restores the original planning history, "
    "installation editions, source attachments and operating case from operations.zip. "
    "Its original Installation editor saves revised assignments and actual acceptance observations.\n\n"
    "An assignee, target date or satisfied prerequisite does not record an acceptance observation. "
    "Use each original acceptance step for the observed operator, time, result and evidence.\n"
)


def fail(message, code="INVALID_DELIVERY_QUEUE", status=422):
    raise Problem(message, status, code)


def fields(value, allowed, label):
    if not isinstance(value, dict) or set(value) - set(allowed):
        fail("Use the declared " + label + " fields.")
    return value


def civil_date(value, default=None):
    if value is None or value == "":
        return default
    if not isinstance(value, str) or not re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}", value):
        fail("Use a complete calendar date in YYYY-MM-DD form.")
    try:
        date.fromisoformat(value)
    except ValueError as error:
        raise Problem("Select an actual calendar date.", 422, "INVALID_DELIVERY_QUEUE") from error
    return value


def normalize(raw, check_ids):
    """Optional document field; older native editions keep their original bytes."""
    fields(raw, ("owner", "dueDate", "priority", "note", "steps"), "delivery coordination")
    check_ids = set(check_ids)
    priority = raw.get("priority", "NORMAL")
    if priority not in PRIORITIES:
        fail("Select an installation delivery priority.")
    values = raw.get("steps", [])
    if not isinstance(values, list) or len(values) > 100:
        fail("Coordinate up to one hundred original acceptance steps.")
    steps, seen = [], set()
    for row in values:
        fields(row, ("checkId", "owner", "dueDate", "priority", "dependsOn", "note"), "step coordination")
        check_id = row.get("checkId")
        if not isinstance(check_id, str) or check_id not in check_ids or check_id in seen:
            fail("Coordinate each selected original acceptance step once.")
        seen.add(check_id)
        depends = row.get("dependsOn", [])
        if (not isinstance(depends, list) or len(depends) > 100
                or any(not isinstance(key, str) or key not in check_ids or key == check_id for key in depends)
                or len(set(depends)) != len(depends)):
            fail("Select distinct other original acceptance steps as prerequisites.")
        rank = row.get("priority", "INHERIT")
        if rank not in ("INHERIT", *PRIORITIES):
            fail("Select a step priority or inherit the installation priority.")
        steps.append({"checkId": check_id, "owner": text(row.get("owner", ""), "Delivery assignee", 500),
                      "dueDate": civil_date(row.get("dueDate")), "priority": rank,
                      "dependsOn": sorted(depends), "note": text(row.get("note", ""), "Delivery step note", 4000)})
    graph = {row["checkId"]: row["dependsOn"] for row in steps}
    visited, active = set(), set()
    def visit(ident):
        if ident in active:
            fail("The delivery prerequisites contain a cycle. Each step must have a possible starting point.")
        if ident in visited:
            return
        active.add(ident)
        for prerequisite in graph.get(ident, []):
            visit(prerequisite)
        active.remove(ident)
        visited.add(ident)
    for ident in graph:
        visit(ident)
    return {"owner": text(raw.get("owner", ""), "Installation delivery assignee", 500),
            "dueDate": civil_date(raw.get("dueDate")), "priority": priority,
            "note": text(raw.get("note", ""), "Installation delivery note", 8000),
            "steps": sorted(steps, key=lambda row: row["checkId"])}


def assignments(document):
    return normalize(document.get("coordination", {}), {row["id"] for row in document["checks"]})


def reconcile_checks(document):
    """Keep editable source refreshes attached to the surviving native steps.

    Earlier editions retain every previous assignment and prerequisite. Removed
    original phases disappear only from the prepared replacement document.
    """
    if "coordination" not in document:
        return
    existing = {row["id"] for row in document["checks"]}
    coordination = deepcopy(document["coordination"])
    coordination["steps"] = [
        {**row, "dependsOn": [ident for ident in row.get("dependsOn", []) if ident in existing]}
        for row in coordination.get("steps", []) if row["checkId"] in existing]
    document["coordination"] = normalize(coordination, existing)


def build(context, editions, as_of=None):
    """Project current saved heads in one original Operations read snapshot."""
    import operations_installations as installations
    selected_date = civil_date(as_of, datetime.now(timezone.utc).date().isoformat())
    latest = {}
    for row in editions:
        if row["id"] not in latest or row["revision"] > latest[row["id"]]["revision"]:
            latest[row["id"]] = row
    rows, heads = [], []
    closed = context["program"]["state"] != "OPEN"
    for edition in sorted(latest.values(), key=lambda row: row["id"]):
        if digest({key: value for key, value in edition.items() if key != "sha256"}) != edition.get("sha256"):
            fail("A saved installation differs from its retained identity.", "INSTALLATION_CHANGED", 409)
        preview = edition["preview"]
        document, snapshot = preview["document"], preview["snapshot"]
        coordination = assignments(document)
        per_step = {row["checkId"]: row for row in coordination["steps"]}
        checks = {row["id"]: row for row in document["checks"]}
        available, changed = True, False
        try:
            current = installations.capture(context, installations.normalized(context, document))
            changed = (current["records"] != snapshot["records"] or current["sources"] != snapshot["sources"]
                       or current["plan"]["contentSha256"] != snapshot["plan"]["contentSha256"])
        except (Problem, KeyError):
            available, changed = False, True
        retired = document["stage"] == "RETIRED"
        head = {"id": edition["id"], "revision": edition["revision"], "sha256": edition["sha256"],
                "name": document["name"], "stage": document["stage"], "sourceAvailable": available,
                "sourceRecordsChanged": changed, "coordination": coordination}
        heads.append(head)
        findings = [row for row in preview["report"]["findings"] if row["kind"] != "ACCEPTANCE"]
        tasks = [{"id": "setup", "kind": "CONFIGURATION", "title": "Complete installation setup",
                  "criterion": "\n".join(row["message"] for row in findings), "required": True,
                  "state": "OPEN" if findings else "COMPLETE", "operator": "", "observedAt": None}]
        tasks.extend({**check, "kind": "ACCEPTANCE"} for check in document["checks"])
        for task in tasks:
            override = per_step.get(task["id"], {}) if task["kind"] == "ACCEPTANCE" else {}
            depends = override.get("dependsOn", [])
            waiting = [{"id": ident, "title": checks[ident]["title"], "state": checks[ident]["state"]}
                       for ident in depends if checks[ident]["state"] not in DONE]
            owner = override.get("owner") or coordination["owner"]
            due = override.get("dueDate") or coordination["dueDate"]
            priority = override.get("priority", "INHERIT")
            if priority == "INHERIT":
                priority = coordination["priority"]
            done = task["state"] in (*DONE, "COMPLETE")
            inactive = done or retired or closed
            due_status = ("COMPLETE" if done else "INACTIVE" if retired or closed else
                          "UNDATED" if due is None else "OVERDUE" if due < selected_date else
                          "TODAY" if due == selected_date else "UPCOMING")
            rows.append({"key": edition["id"] + "/" + task["kind"].lower() + "/" + task["id"],
                         "installationId": edition["id"], "installationName": document["name"],
                         "revision": edition["revision"], "editionSha256": edition["sha256"],
                         "taskId": task["id"], "kind": task["kind"], "title": task["title"],
                         "criterion": task["criterion"], "stage": document["stage"], "state": task["state"],
                         "required": task["required"], "owner": owner, "dueDate": due, "priority": priority,
                         "dueStatus": due_status, "done": done, "retired": retired, "caseClosed": closed,
                         "ready": not inactive and not waiting, "dependsOn": depends, "waitingOn": waiting,
                         "sourceAvailable": available, "sourceRecordsChanged": changed,
                         "note": override.get("note") or coordination["note"],
                         "acceptanceOperator": task["operator"], "acceptedAt": task["observedAt"]})
    rows.sort(key=lambda row: (row["done"] or row["retired"] or row["caseClosed"],
                              row["dueDate"] is None, row["dueDate"] or "",
                              PRIORITIES.index(row["priority"]), row["installationName"].casefold(), row["key"]))
    active = [row for row in rows if not row["done"] and not row["retired"] and not row["caseClosed"]]
    owners = Counter(row["owner"] for row in active)
    result = {"schema": SCHEMA, "asOfDate": selected_date,
              "source": {"caseId": context["program"]["id"], "caseName": context["program"]["name"],
                         "caseVersion": context["program"]["version"], "caseState": context["program"]["state"],
                         "planId": context["plan"]["id"], "planRevision": context["plan"]["revision"],
                         "planContentSha256": context["plan"]["contentSha256"],
                         "installationHeads": [{"id": row["id"], "revision": row["revision"], "sha256": row["sha256"]}
                                               for row in heads]},
              "summary": {"installations": len(heads), "tasks": len(rows), "open": len(active),
                          "overdue": sum(row["dueStatus"] == "OVERDUE" for row in active),
                          "dueToday": sum(row["dueStatus"] == "TODAY" for row in active),
                          "unassigned": sum(not row["owner"] for row in active),
                          "waiting": sum(bool(row["waitingOn"]) for row in active),
                          "ready": sum(row["ready"] for row in active),
                          "completed": sum(row["done"] for row in rows),
                          "changedInstallations": sum(row["sourceRecordsChanged"] for row in heads)},
              "owners": [{"owner": owner, "open": count} for owner, count in sorted(owners.items())],
              "installations": heads, "rows": rows}
    return {**result, "sha256": digest(result)}


def csv_rows(queue):
    return [{**row, "waitingFor": "; ".join(item["title"] for item in row["waitingOn"])} for row in queue["rows"]]


def report_html(queue):
    e = lambda item: escape(str(item if item is not None else ""), quote=True)
    body = "<h1>Installation delivery queue</h1><p>" + e(queue["source"]["caseName"]) + " · case version " + \
        e(queue["source"]["caseVersion"]) + " · calendar date " + e(queue["asOfDate"]) + "</p>"
    body += "<p>The selected calendar date classifies current saved installation heads. Assignments and prerequisites are delivery planning fields.</p>"
    body += "<p>" + " · ".join(e(label) + ": " + e(queue["summary"][key]) for key, label in
                              (("open", "Open"), ("overdue", "Overdue"), ("dueToday", "Due today"),
                               ("unassigned", "Unassigned"), ("waiting", "Waiting"), ("ready", "Ready"))) + "</p>"
    body += "<table><thead><tr>" + "".join("<th>" + title + "</th>" for title in
        ("Installation / work", "Assignee", "Due / priority", "State / prerequisites", "Coordination / observation")) + "</tr></thead><tbody>"
    for row in queue["rows"]:
        state = e(row["state"])
        if row["waitingOn"]:
            state += "<p>Waiting for " + e(", ".join(item["title"] for item in row["waitingOn"])) + "</p>"
        if row["retired"]:
            state += "<p>Installation retired</p>"
        if row["caseClosed"]:
            state += "<p>Case closed</p>"
        if row["sourceRecordsChanged"]:
            state += "<p>Selected operating records changed since the saved edition.</p>"
        observation = e(row["note"])
        if row["acceptanceOperator"]:
            observation += "<p>Observed by " + e(row["acceptanceOperator"]) + " · " + e(row["acceptedAt"]) + "</p>"
        body += "<tr><td><strong>" + e(row["installationName"]) + "</strong><p>" + e(row["title"]) + \
            "</p><small>Edition " + e(row["revision"]) + " · " + e(row["kind"]) + "</small><p>" + e(row["criterion"]) + \
            "</p><details><summary>Original installation identity</summary><code>" + e(row["installationId"]) + \
            "<br>" + e(row["editionSha256"]) + "</code></details></td><td>" + e(row["owner"] or "Unassigned") + \
            "</td><td>" + e(row["dueDate"] or "Undated") + "<p>" + e(row["priority"]) + " · " + e(row["dueStatus"]) + \
            "</p></td><td>" + state + "</td><td>" + observation + "</td></tr>"
    if not queue["rows"]:
        body += "<tr><td colspan=\"5\">No saved customer installations.</td></tr>"
    body += "</tbody></table><h2>Continue the original case</h2><p>Import this complete ZIP through Delivery operations. " \
            "The original Installation editor saves assignments and acceptance observations, including their complete history and source attachments.</p>"
    body += "<p>Queue SHA-256 <code>" + e(queue["sha256"]) + "</code></p>"
    return ("<!doctype html><html lang=\"en\"><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">"
            "<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; style-src 'unsafe-inline'\">"
            "<title>Installation delivery queue</title><style>"
            "body{margin:0 auto;padding:32px;max-width:1440px;background:#fff;color:#202020;font:14px/1.5 system-ui,sans-serif}"
            "h1{font-size:28px}h2{margin-top:32px}table{border-collapse:collapse;width:100%}th,td{border:1px solid #aaa;"
            "padding:10px;text-align:left;vertical-align:top;white-space:pre-wrap;overflow-wrap:anywhere}"
            "th{background:#eee}code{font:12px/1.5 ui-monospace,monospace;overflow-wrap:anywhere}small{font-size:12px}"
            "@media print{body{padding:0}thead{display:table-header-group}tr{break-inside:avoid}details{display:block}}"
            "</style><body>" + body + "</body></html>\n").encode("utf-8")


def derived_files(queue):
    return {"delivery-queue.json": (canonical(queue) + "\n").encode("utf-8"),
            "work.csv": csv_bytes(CSV_FIELDS, csv_rows(queue)), "report.html": report_html(queue),
            "README.txt": BUNDLE_README.encode("utf-8")}


def export_bundle(queue, native_raw):
    files = {"operations.zip": native_raw, **derived_files(queue)}
    manifest = {"schema": SCHEMA + ".bundle", "files": [
        {"path": name, "bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest()}
        for name, raw in sorted(files.items())]}
    files["MANIFEST.json"] = (canonical(manifest) + "\n").encode("utf-8")
    if sum(map(len, files.values())) > MAX_BUNDLE:
        fail("The complete delivery handover exceeds 32 MiB.", status=413)
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
        for name, raw in sorted(files.items()):
            info = zipfile.ZipInfo(name, (2026, 1, 1, 0, 0, 0))
            info.external_attr = 0o600 << 16
            info.compress_type = zipfile.ZIP_DEFLATED
            archive.writestr(info, raw)
    raw = output.getvalue()
    if len(raw) > MAX_BUNDLE:
        fail("The compressed complete delivery handover exceeds 32 MiB.", status=413)
    return raw


def unwrap_bundle(raw):
    """Recognize a complete queue handover; ordinary native imports pass through."""
    if not isinstance(raw, bytes) or len(raw) > MAX_BUNDLE:
        fail("Use a complete operating case or delivery handover ZIP up to 32 MiB.", status=413)
    try:
        with zipfile.ZipFile(io.BytesIO(raw)) as archive:
            infos = archive.infolist()
            names = [item.filename for item in infos]
            if "delivery-queue.json" not in names:
                return raw, None
            expected_names = {"operations.zip", "delivery-queue.json", "work.csv", "report.html", "README.txt", "MANIFEST.json"}
            if (len(names) != len(expected_names) or set(names) != expected_names
                    or sum(item.file_size for item in infos) > MAX_BUNDLE):
                fail("Receive the complete delivery handover with its original six members.")
            files = {name: archive.read(name) for name in names}
            manifest = json.loads(files["MANIFEST.json"])
            expected_manifest = {"schema": SCHEMA + ".bundle", "files": [
                {"path": name, "bytes": len(content), "sha256": hashlib.sha256(content).hexdigest()}
                for name, content in sorted(files.items()) if name != "MANIFEST.json"]}
            if manifest != expected_manifest:
                fail("A delivery handover member differs from its retained identity.")
            queue = json.loads(files["delivery-queue.json"])
            if (not isinstance(queue, dict) or queue.get("schema") != SCHEMA
                    or digest({key: value for key, value in queue.items() if key != "sha256"}) != queue.get("sha256")):
                fail("Receive the complete original delivery queue.")
            # Every human-readable export remains the exact view of this queue.
            if any(files[name] != content for name, content in derived_files(queue).items()):
                fail("The delivery handover reports differ from their original queue.")
            return files["operations.zip"], queue
    except (zipfile.BadZipFile, KeyError, TypeError, ValueError, RuntimeError, AttributeError, UnicodeError) as error:
        if isinstance(error, Problem):
            raise
        raise Problem("The complete delivery handover ZIP is unreadable.", 422, "INVALID_DELIVERY_QUEUE") from error


def validate_received(queue, document):
    if queue is None:
        return
    context = {"program": document["program"], "plan": document["plan"], "records": document["records"],
               "sources": {row["id"]: row for row in document["sources"]}}
    expected = build(context, document.get("installations", []), queue.get("asOfDate"))
    if expected != queue:
        fail("The delivery queue differs from the current installation heads in its original case.",
             "DELIVERY_QUEUE_SOURCE_CONFLICT", 409)


def installation_section(document):
    """Carry optional coordination into the original single-installation handover."""
    if "coordination" not in document:
        return ""
    coordination = assignments(document)
    e = lambda value: escape(str(value if value is not None else ""), quote=True)
    names = {row["id"]: row["title"] for row in document["checks"]}
    body = "<h2>Delivery coordination</h2><p>Delivery assignee: " + e(coordination["owner"] or "Unassigned") + \
        " · target date: " + e(coordination["dueDate"] or "Undated") + " · priority: " + e(coordination["priority"]) + "</p>"
    if coordination["note"]:
        body += "<p>" + e(coordination["note"]) + "</p>"
    if coordination["steps"]:
        body += "<table><thead><tr><th>Original step</th><th>Assignee / due / priority</th><th>Prerequisites / note</th></tr></thead><tbody>"
        for row in coordination["steps"]:
            body += "<tr><td>" + e(names[row["checkId"]]) + "</td><td>" + e(row["owner"] or "Inherit installation") + \
                "<br>" + e(row["dueDate"] or "Inherit installation") + "<br>" + e(row["priority"]) + "</td><td>" + \
                e(", ".join(names[ident] for ident in row["dependsOn"])) + "<p>" + e(row["note"]) + "</p></td></tr>"
        body += "</tbody></table>"
    return body
