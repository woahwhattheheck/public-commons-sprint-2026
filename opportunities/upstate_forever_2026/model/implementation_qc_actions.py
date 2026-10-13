"""Explicit quality dispositions and corrective work in the original field plan.

Original laboratory results and QC calculations remain immutable. Decisions are
frozen source links in the native plan revision; corrective work uses its tasks.
"""
from __future__ import annotations

import copy
import hashlib
import html
import json
import os
from pathlib import Path
import re
import shutil
import tempfile
import zipfile

from .implementation import ImplementationStore, _atomic_bytes
from .implementation_schema import (
    ImplementationError, RevisionConflict, canonical_bytes, document_digest,
    validate_plan, summarize_plan, _safe_id, _integer, MAX_JSON_BYTES,
)
from .portable_implementation import report_edition
from .implementation_observations import _attachment_inventory, _retain
from .common import describe_file, read_json, file_digest
from . import implementation_qc as qc
from . import observed_context

SCHEMA = "upstate.implementation-qc-actions/v1"
SELECTION_SCHEMA = "upstate.implementation-qc-actions-selection/v1"
LINK_KIND = "implementation_qc_actions"
DECISIONS = ("unresolved", "use_as_reviewed", "restricted_use",
             "exclude_from_selected_use", "follow_up_required")
NOTICE = (
    "These are explicit reviewer decisions for the stated use. Original laboratory "
    "values, qualifiers, QA dispositions and retained QC calculations remain unchanged. "
    "Closing a decision does not complete its linked tasks or recalculate its source results."
)


def _copy(value):
    return copy.deepcopy(value)


def _hash(value):
    return hashlib.sha256(canonical_bytes(value)).hexdigest()


def _text(value, name, required=False, maximum=16384):
    if not isinstance(value, str) or len(value) > maximum or (required and not value.strip()):
        raise ImplementationError(name + " must be " + ("nonempty " if required else "") +
                                  "text of at most " + str(maximum) + " characters.")
    return value


def _ids(value, name, available):
    if not isinstance(value, list) or any(not isinstance(x, str) for x in value):
        raise ImplementationError(name + " must be an array of original IDs.")
    if len(set(value)) != len(value) or any(x not in available for x in value):
        raise ImplementationError(name + " contains a duplicate or unavailable original ID.")
    return value


def _batches(store, plan):
    """Recover complete original decisions, including links deleted from a later draft."""
    retained = {}
    directory = store._directory(plan["id"])
    for path in store._revision_paths(directory):
        if int(path.stem) > plan["revision"]:
            continue
        record = store._read_record(path)
        revision = record["plan"]["revision"]
        for link in record["plan"]["source_links"]:
            if link.get("kind") != LINK_KIND:
                continue
            snapshot = link.get("snapshot")
            if not isinstance(snapshot, dict) or snapshot.get("schema") != SCHEMA:
                raise ImplementationError("A quality-action source has an invalid original snapshot.")
            selection = snapshot.get("selection")
            if not isinstance(selection, dict) or snapshot.get("id") != _hash(selection):
                raise ImplementationError("A quality-action source differs from its original request.")
            if link.get("source_digest") != _hash(snapshot) or link["id"] != "qca-" + snapshot["id"]:
                raise ImplementationError("A quality-action source differs from its frozen identity.")
            if snapshot.get("plan_id") != plan["id"] or not _integer(snapshot.get("revision"), 1):
                raise ImplementationError("A quality-action source belongs to another native plan.")
            previous = retained.get(link["id"])
            if previous is None:
                if snapshot["revision"] != revision:
                    raise ImplementationError("A quality-action source lost its original committed revision.")
                retained[link["id"]] = _copy(link)
            elif any(previous.get(key) != link.get(key) for key in (
                "kind", "reference", "snapshot", "source_digest", "source_id", "source_schema"
            )):
                raise ImplementationError("An original quality-action source changed across plan history.")
    return sorted(retained.values(), key=lambda item: (item["snapshot"]["revision"], item["id"]))


def _context(plan, inspected, batches):
    review = inspected["review"]
    current = {item["observation_id"]: item for item in qc.records(plan)}
    original = {item["observation_id"]: item for item in review["records"]}
    tasks = {item["id"]: item for item in plan["tasks"]}
    events = [event for link in batches
              if link["snapshot"]["report_id"] == inspected["report_id"]
              for event in link["snapshot"]["events"]]
    groups = []
    for group in review["groups"]:
        history = [item for item in events if item["group_id"] == group["id"]]
        latest = history[-1] if history else None
        selected = list(dict.fromkeys(group["observation_ids"] + group["associated_observation_ids"]))
        changes = []
        for key in selected:
            if key not in current:
                changes.append({"observation_id": key, "state": "missing",
                                "original": original[key], "current": None})
            elif current[key] != original[key]:
                changes.append({"observation_id": key, "state": "changed",
                                "original": original[key], "current": current[key]})
        linked = [tasks.get(key, {"id": key, "missing": True}) for key in
                  (latest["task_ids"] if latest else [])]
        groups.append({"group": _copy(group), "latest": _copy(latest), "history": _copy(history),
                       "source_changes": changes, "linked_tasks": _copy(linked)})
    return {
        "schema": SCHEMA, "plan_id": plan["id"], "plan_title": plan["title"],
        "revision": plan["revision"], "plan_sha256": document_digest(plan),
        "report_id": inspected["report_id"], "review": _copy(review), "groups": groups,
        "tasks": _copy(plan["tasks"]), "source_links": _copy(plan["source_links"]),
        "decisions": list(DECISIONS), "notice": NOTICE,
    }


def catalog(workspace, plan_id, report_id=None):
    store = ImplementationStore(workspace)
    result = []
    for entry in store.list_reports(plan_id):
        if "qc-action-review.json" not in entry["members"]:
            continue
        value = read_json(Path(entry["directory"]) / "qc-action-review.json")
        if value.get("schema") != SCHEMA:
            raise ImplementationError("A saved quality-action report has an invalid schema.")
        if report_id is not None and value.get("report_id") != report_id:
            continue
        result.append({"action_report_id": entry["id"], "report_id": value["report_id"],
                       "revision": entry["revision"], "title": value["title"], "as_of": value["as_of"],
                       "actor": value["receipt"]["actor"],
                       "receipt_id": value["receipt"]["id"]})
    return result


def context(workspace, plan_id, report_id):
    store = ImplementationStore(workspace)
    plan = store.get(plan_id)
    inspected = qc.inspect(workspace, plan_id, report_id)
    result = _context(plan, inspected, _batches(store, plan))
    result["action_reports"] = catalog(workspace, plan_id, report_id)
    return result


def _selection(plan, inspected, supplied):
    if not isinstance(supplied, dict):
        raise ImplementationError("Supply a complete quality-action selection.")
    value = _copy(supplied)
    if value.get("schema", SELECTION_SCHEMA) != SELECTION_SCHEMA:
        raise ImplementationError("Choose an original quality-action selection.")
    value["schema"] = SELECTION_SCHEMA
    allowed = {"schema", "plan_id", "report_id", "expected_revision", "actor", "as_of", "decisions"}
    if set(value) - allowed:
        raise ImplementationError("The quality-action selection contains unsupported fields.")
    if value.get("plan_id") != plan["id"] or value.get("report_id") != inspected["report_id"]:
        raise ImplementationError("Select the exact original plan and saved QC report.")
    if not _integer(value.get("expected_revision"), 1):
        raise ImplementationError("expected_revision must identify a saved native plan.")
    _text(value.get("actor"), "actor", True, 1024)
    _text(value.get("as_of"), "as_of", True)
    summarize_plan(plan, value["as_of"])
    decisions = value.get("decisions")
    if not isinstance(decisions, list) or not 1 <= len(decisions) <= 10000:
        raise ImplementationError("Select one or more original QC groups.")
    groups = {item["id"] for item in inspected["review"]["groups"]}
    tasks = {item["id"] for item in plan["tasks"]}
    sources = {item["id"] for item in plan["source_links"]}
    used = set()
    for item in decisions:
        if not isinstance(item, dict):
            raise ImplementationError("Each quality decision must be an object.")
        if set(item) - {"group_id", "decision", "use_scope", "reason", "state", "task_ids",
                       "create_task", "evidence_refs", "closure_note"}:
            raise ImplementationError("A quality decision contains unsupported fields.")
        group_id = item.get("group_id")
        if not isinstance(group_id, str) or group_id not in groups or group_id in used:
            raise ImplementationError("Choose unique original QC group IDs.")
        used.add(group_id)
        if item.get("decision") not in DECISIONS or item.get("state") not in ("open", "closed"):
            raise ImplementationError("Declare a supported reviewer decision and open/closed state.")
        _text(item.get("use_scope"), "use_scope", True)
        _text(item.get("reason"), "reason", True)
        _text(item.setdefault("closure_note", ""), "closure_note", item["state"] == "closed")
        _ids(item.setdefault("task_ids", []), "task_ids", tasks)
        _ids(item.setdefault("evidence_refs", []), "evidence_refs", sources)
        new = item.get("create_task")
        if new is not None:
            if not isinstance(new, dict) or set(new) - {
                "title", "assignee", "phase", "duration_days", "start_not_before", "notes"
            }:
                raise ImplementationError("Supply original native fields for a new corrective task.")
            _text(new.get("title"), "task title", True)
            for key in ("assignee", "notes"):
                _text(new.setdefault(key, ""), "task " + key)
            _text(new.setdefault("phase", "Quality follow-up"), "task phase")
            duration = new.setdefault("duration_days", None)
            if duration is not None and not _integer(duration):
                raise ImplementationError("Task duration must be a nonnegative integer or unknown.")
            new.setdefault("start_not_before", None)
    return value


def _compose(plan, inspected, batches, selected):
    if selected["expected_revision"] != plan["revision"]:
        raise RevisionConflict(plan["id"], selected["expected_revision"], plan["revision"])
    candidate = _copy(plan)
    original_context = _context(plan, inspected, batches)
    groups = {item["group"]["id"]: item for item in original_context["groups"]}
    request_id = _hash(selected)
    events, created = [], []
    for index, item in enumerate(selected["decisions"]):
        entry = groups[item["group_id"]]
        event_id = "qce-" + request_id + "-" + str(index)
        task_ids = list(item["task_ids"])
        new = item.get("create_task")
        if new is not None:
            task_id = "qc-task-" + request_id[:48] + "-" + str(index)
            if any(row["id"] == task_id for row in candidate["tasks"]):
                raise ImplementationError("The new corrective task ID already names another original task.")
            task = {**_copy(new), "id": task_id, "candidate_id": None, "status": "planned",
                    "progress_pct": 0, "depends_on": [], "evidence_refs": list(item["evidence_refs"]),
                    "quality_control": {"report_id": inspected["report_id"], "group_id": item["group_id"],
                                        "event_id": event_id, "request_id": request_id}}
            candidate["tasks"].append(task)
            created.append(task)
            task_ids.append(task_id)
        task_map = {row["id"]: row for row in candidate["tasks"]}
        linked = [_copy(task_map[key]) for key in task_ids]
        unresolved = [row["id"] for row in linked if row["status"] not in ("complete", "cancelled")]
        events.append({
            "id": event_id, "report_id": inspected["report_id"], "group_id": item["group_id"],
            "original_review_id": inspected["review"]["id"],
            "original_revision": inspected["review"]["revision"],
            "original_group_sha256": _hash(entry["group"]),
            "previous_event_id": entry["latest"]["id"] if entry["latest"] else None,
            "decision": item["decision"], "state": item["state"], "use_scope": item["use_scope"],
            "reason": item["reason"], "closure_note": item["closure_note"],
            "actor": selected["actor"], "as_of": selected["as_of"],
            "task_ids": task_ids, "tasks_at_decision": linked,
            "evidence_refs": list(item["evidence_refs"]),
            "evidence_at_decision": [_copy(row) for key in item["evidence_refs"]
                                      for row in plan["source_links"] if row["id"] == key],
            "source_changes_at_decision": _copy(entry["source_changes"]),
            "warnings": (["Decision closed while these linked tasks remain open: " + ", ".join(unresolved)]
                         if item["state"] == "closed" and unresolved else []),
        })
    receipt = {
        "id": request_id, "report_id": inspected["report_id"], "plan_id": plan["id"],
        "base_revision": plan["revision"], "revision": plan["revision"] + 1,
        "actor": selected["actor"], "as_of": selected["as_of"],
        "event_ids": [item["id"] for item in events], "created_task_ids": [item["id"] for item in created],
        "source_link_id": "qca-" + request_id,
    }
    snapshot = {
        "schema": SCHEMA, "id": request_id, "plan_id": plan["id"], "report_id": inspected["report_id"],
        "revision": receipt["revision"], "selection": selected, "receipt": receipt, "events": events,
        "original_review_id": inspected["review"]["id"],
        "original_report_files": _copy(inspected["files"]),
    }
    link = {"id": receipt["source_link_id"], "kind": LINK_KIND,
            "label": "Quality decisions: " + inspected["review"]["title"] + " / " + selected["as_of"],
            "reference": "urn:upstate:implementation-qc-actions:" + request_id,
            "source_schema": SCHEMA, "source_id": request_id, "source_digest": _hash(snapshot),
            "snapshot": snapshot}
    candidate["source_links"].append(link)
    candidate = validate_plan(candidate)
    if len(canonical_bytes(candidate)) > MAX_JSON_BYTES:
        raise ImplementationError("These complete quality actions exceed the native plan document size limit; select fewer groups in this revision.")
    return candidate, link, {
        "schema": SCHEMA, "plan_id": plan["id"], "report_id": inspected["report_id"],
        "revision": plan["revision"], "committed_revision": receipt["revision"],
        "selection": selected, "receipt": receipt, "events": events, "created_tasks": created,
        "source_changes": [row for event in events for row in event["source_changes_at_decision"]],
        "notice": NOTICE,
    }


def preview(workspace, supplied):
    store = ImplementationStore(workspace)
    if not isinstance(supplied, dict):
        raise ImplementationError("Supply a complete quality-action selection.")
    plan = store.get(supplied.get("plan_id"))
    inspected = qc.inspect(workspace, plan["id"], supplied.get("report_id"))
    selected = _selection(plan, inspected, supplied)
    return _compose(plan, inspected, _batches(store, plan), selected)[2]



def validate_selection(workspace, supplied):
    """Reopen an exported draft at its original basis without admitting a stale write."""
    if not isinstance(supplied, dict) or not _integer(supplied.get("expected_revision"), 1):
        raise ImplementationError("Select the draft's original saved native revision.")
    store = ImplementationStore(workspace)
    plan = store.get(supplied.get("plan_id"), supplied["expected_revision"])
    inspected = qc.inspect(workspace, plan["id"], supplied.get("report_id"))
    selected = _selection(plan, inspected, supplied)
    result = _compose(plan, inspected, _batches(store, plan), selected)[2]
    result["current_revision"] = store.get(plan["id"])["revision"]
    result["validation_basis"] = "original_saved_revision"
    return result


def _report_value(store, plan, inspected, batch, batches):
    return {
        **_context(plan, inspected, batches), "title": "Quality decisions — " + inspected["review"]["title"],
        "as_of": batch["snapshot"]["selection"]["as_of"], "receipt": _copy(batch["snapshot"]["receipt"]),
        "selection": _copy(batch["snapshot"]["selection"]),
        "native_revision": store._read_record(store._directory(plan["id"]) /
                                "revisions" / ("%016d.json" % plan["revision"])),
    }


def _html(value):
    esc = lambda item: html.escape(str(item if item is not None else ""), quote=True)
    blocks = ['<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width">',
        "<title>" + esc(value["title"]) + "</title>",
        "<style>*{box-sizing:border-box}body{font:15px/1.5 system-ui,sans-serif;color:#171717;background:white;max-width:1150px;overflow-wrap:anywhere;"
        "margin:30px auto;padding:0 18px}table{border-collapse:collapse;width:100%;font-size:12px}"
        "th,td{border:1px solid #999;padding:7px;text-align:left;vertical-align:top;overflow-wrap:anywhere}"
        "th{overflow-wrap:normal}pre{white-space:pre-wrap;overflow-wrap:anywhere}section{border-top:2px solid #777;margin-top:25px}"
        ".table-wrap{max-width:100%;overflow-x:auto}@media(max-width:620px){.table-wrap table{min-width:560px}.table-wrap th,.table-wrap td{min-width:85px}}"
        "@media print{body{margin:0;max-width:none}.table-wrap{overflow:visible}.table-wrap table,.table-wrap th,.table-wrap td{min-width:0}thead{display:table-header-group}tr{break-inside:avoid}"
        "button{display:none}details{display:block}details>*{display:block}}</style>",
        "<button onclick='window.print()'>Print complete review</button><h1>" + esc(value["title"]) + "</h1>",
        "<p>" + esc(NOTICE) + "</p><p>Plan " + esc(value["plan_id"]) + " / saved revision " +
        esc(value["revision"]) + " / reviewed " + esc(value["as_of"]) + "</p>",
        "<p>Original QC report " + esc(value["report_id"]) + " / original plan revision " +
        esc(value["review"]["revision"]) + ".</p>"]
    for entry in value["groups"]:
        group, latest = entry["group"], entry["latest"]
        blocks.append("<section><h2>" + esc(group["id"]) + " — " + esc(group["relationship"]) + "</h2>")
        blocks.append("<p>Original evaluated outcome: " + esc(group["outcome"]) + ". Original results: " +
                      esc(", ".join(group["observation_ids"])) + ".</p>")
        if latest:
            blocks.append("<p><strong>" + esc(latest["decision"]) + " / " + esc(latest["state"]) +
                          "</strong><br>Selected use: " + esc(latest["use_scope"]) +
                          "<br>Reason: " + esc(latest["reason"]) + "<br>Closure: " +
                          esc(latest["closure_note"]) + "</p>")
        else:
            blocks.append("<p>No explicit quality disposition has been recorded for this group.</p>")
        if entry["source_changes"]:
            blocks.append("<p><strong>Original source context differs from the selected saved revision.</strong> "
                          "The decision retains its original QC basis.</p><pre>" +
                          esc(json.dumps(entry["source_changes"], indent=2, ensure_ascii=False)) + "</pre>")
        blocks.append("<h3>Linked native tasks at this revision</h3><div class='table-wrap' tabindex='0' role='region' aria-label='Linked native tasks'><table><thead><tr>" +
                      "".join("<th>" + title + "</th>" for title in
                              ("Task", "Title", "Assignee", "Status", "Progress", "Evidence")) +
                      "</tr></thead><tbody>")
        for task in entry["linked_tasks"]:
            cells = (task["id"], task.get("title", "Missing from this revision"), task.get("assignee", ""),
                     task.get("status", "missing"), task.get("progress_pct"), ", ".join(task.get("evidence_refs", [])))
            blocks.append("<tr>" + "".join("<td>" + esc(cell) + "</td>" for cell in cells) + "</tr>")
        blocks.append("</tbody></table></div><h3>Complete decision history</h3>")
        for event in entry["history"]:
            blocks.append("<h4>" + esc(event["as_of"]) + " / " + esc(event["actor"]) + " / " +
                          esc(event["decision"]) + " / " + esc(event["state"]) + "</h4><pre>" +
                          esc(json.dumps(event, ensure_ascii=False, indent=2)) + "</pre>")
        blocks.append("</section>")
    return "".join(blocks)


def _retain_report(workspace, plan, inspected, batch):
    store = ImplementationStore(workspace)
    receipt = batch["snapshot"]["receipt"]
    for prior in catalog(workspace, plan["id"], inspected["report_id"]):
        if prior["receipt_id"] == receipt["id"]:
            return {**inspect(workspace, plan["id"], prior["action_report_id"]), "reused": True}
    value = _report_value(store, plan, inspected, batch, _batches(store, plan))
    inventory, attachments = _attachment_inventory(workspace, plan)
    temp = Path(tempfile.mkdtemp(prefix=".implementation-qc-actions-", dir=store.root.parent))
    try:
        for name, content in (
            ("plan.json", plan), ("summary.json", summarize_plan(plan, value["as_of"])),
            ("qc-action-review.json", value), ("qc-action-selection.json", value["selection"]),
            ("qc-action-receipt.json", receipt), ("original-revision.json", value["native_revision"])):
            _atomic_bytes(temp / name, canonical_bytes(content))
        _atomic_bytes(temp / "report.html", _html(value).encode("utf-8"))
        rows = [event for group in value["groups"] for event in group["history"]]
        _atomic_bytes(temp / "qc-decisions.csv", qc._csv(rows, (
            "id", "group_id", "as_of", "actor", "decision", "state", "use_scope", "reason",
            "closure_note", "task_ids", "evidence_refs", "warnings", "source_changes_at_decision"
        )).encode("utf-8-sig"))
        _atomic_bytes(temp / "qc-tasks.csv", qc._csv(plan["tasks"], (
            "id", "title", "phase", "assignee", "status", "duration_days", "progress_pct",
            "start_not_before", "depends_on", "evidence_refs", "notes", "quality_control"
        )).encode("utf-8-sig"))
        source_map = []
        for item in inspected["files"]:
            source = store.root / item["path"]
            name = "original-qc-" + source.name
            _retain(source, temp / name, item)
            source_map.append({"original": item, "retained_name": name})
        for source, item in attachments:
            suffix = source.suffix if re.fullmatch(r"\.[A-Za-z0-9]{1,16}", source.suffix) else ""
            name = "evidence-" + item["sha256"] + "-" + hashlib.sha256(source.name.encode("utf-8")).hexdigest()[:12] + suffix
            if not (temp / name).exists():
                _retain(source, temp / name, item)
            item["quality_action_package_path"] = name
        _atomic_bytes(temp / "attachment-inventory.json", canonical_bytes(inventory))
        _atomic_bytes(temp / "original-qc-files.json", canonical_bytes(source_map))
        companions = [describe_file(temp, path) for path in sorted(temp.iterdir())]
        sections = [[value["title"], [NOTICE,
            "Original plan " + plan["id"] + ", saved decision revision " + str(plan["revision"]) + ".",
            {"kind": "table", "columns": ["Group", "Decision", "State", "Selected use", "Reason", "Reviewer"],
             "rows": [[group["group"]["id"], (group["latest"] or {}).get("decision", "unreviewed"),
                       (group["latest"] or {}).get("state", ""),
                       (group["latest"] or {}).get("use_scope", ""),
                       (group["latest"] or {}).get("reason", ""),
                       (group["latest"] or {}).get("actor", "")] for group in value["groups"]]},
            {"kind": "links", "items": [{"title": "Complete decisions and source history", "path": "report.html"}]}
        ]]]
        recipe = {"schema": observed_context.SCHEMA, "title": value["title"], "sections": sections,
                  "inputs": companions, "source_links": [item["path"] for item in companions],
                  "implementation_qc_actions": receipt}
        _atomic_bytes(temp / "observed-report.json", canonical_bytes(recipe))
        entry = {"id": "field-qc-actions-" + receipt["id"][:24], "kind": "document",
                 "role": observed_context.ROLE, "title": value["title"],
                 "uri": "urn:upstate:implementation-qc-actions:" + receipt["id"], "vintage": value["as_of"],
                 "units": "Original measurement units; explicit reviewer decisions and native tasks",
                 **describe_file(temp, temp / "observed-report.json"), "companions": companions,
                 "metadata": {"report_schema": observed_context.SCHEMA, "implementation_qc_actions": receipt}}
        _atomic_bytes(temp / "qc-actions-sources.json", canonical_bytes(
            {"schema": "upstate.sources/v1", "title": value["title"], "entries": [entry]}))
        files = [{"name": path.name, "size_bytes": path.stat().st_size, "sha256": file_digest(path)}
                 for path in sorted(temp.iterdir())]
        manifest = {"schema": "upstate.implementation-report/v1", "plan_id": plan["id"],
                    "revision": plan["revision"], "as_of": value["as_of"],
                    "document_digest": document_digest(plan), "files": files}
        _atomic_bytes(temp / "manifest.json", canonical_bytes(manifest))
        retained = store.retain_report(temp)
        return inspect(workspace, plan["id"], retained["id"])
    finally:
        shutil.rmtree(temp)


def save(workspace, supplied):
    """One native revision commits decisions and tasks; retries recover that original revision."""
    store = ImplementationStore(workspace)
    if not isinstance(supplied, dict):
        raise ImplementationError("Supply a complete quality-action selection.")
    plan_id = _safe_id(supplied.get("plan_id"), "plan_id")
    inspected = qc.inspect(workspace, plan_id, supplied.get("report_id"))
    # Normalize against the original selected revision so later task/source edits do not break retry.
    if not _integer(supplied.get("expected_revision"), 1):
        raise ImplementationError("expected_revision must identify the original selected revision.")
    base = store.get(plan_id, supplied["expected_revision"])
    selected = _selection(base, inspected, supplied)
    request_id = _hash(selected)
    with store._locked(plan_id) as directory:
        record = store._current_record(directory)
        if record is None:
            raise ImplementationError("The original field plan has no saved revision.")
        current = record["plan"]
        batches = _batches(store, current)
        batch = next((item for item in batches if item["snapshot"]["id"] == request_id), None)
        if batch is not None:
            if batch["snapshot"]["selection"] != selected:
                raise ImplementationError("The original quality-action request identity changed.")
            committed = store.get(plan_id, batch["snapshot"]["revision"])
        else:
            candidate, batch, _ = _compose(current, inspected, batches, selected)
            store._check_frozen_sources(current, candidate)
            committed = store._commit(directory, candidate, previous=current,
                                      revision=current["revision"] + 1,
                                      operation="quality-actions", actor=selected["actor"])
    return _retain_report(workspace, committed, inspected, batch)


def inspect(workspace, plan_id, action_report_id):
    store = ImplementationStore(workspace)
    path = qc._report_path(store, plan_id, action_report_id)
    edition = report_edition(store, path)
    value = read_json(path / "qc-action-review.json")
    if value.get("schema") != SCHEMA:
        raise ImplementationError("Choose a retained quality-action report.")
    plan = store.get(plan_id, edition["revision"])
    original = qc.inspect(workspace, plan_id, value["report_id"])
    batches = _batches(store, plan)
    batch = next((item for item in batches if item["snapshot"]["id"] == value.get("receipt", {}).get("id")), None)
    if batch is None or _report_value(store, plan, original, batch, batches) != value:
        raise ImplementationError("The saved quality-action report differs from its original native revision.")
    return {"plan_id": plan_id, "report_id": value["report_id"], "action_report_id": edition["id"],
            "revision": plan["revision"], "receipt": value["receipt"], "action_review": value,
            "directory": path.relative_to(store.root).as_posix(),
            "files": [describe_file(store.root, path / name) for name in edition["members"]]}


def scientific_source(workspace, plan_id, action_report_id):
    inspected = inspect(workspace, plan_id, action_report_id)
    directory = Path(workspace.root) / inspected["directory"]
    collection = workspace.import_sources(directory / "qc-actions-sources.json")
    manifest = read_json(directory / "qc-actions-sources.json")
    choice = {"source_collection_id": collection["id"], "source_id": manifest["entries"][0]["id"]}
    selected = {"source_roles": {observed_context.ROLE: choice}, "observed_context_sources": [choice]}
    selected["observed_context_binding"] = observed_context.bind(workspace, selected)
    return {**inspected, "report_source": choice, "delivery_selection": selected}


def export(workspace, plan_id, action_report_id, destination):
    inspected = inspect(workspace, plan_id, action_report_id)
    root = Path(workspace.root)
    path = Path(destination).expanduser().absolute()
    if path.resolve().is_relative_to(root.resolve()):
        raise ImplementationError("Save complete quality-action exports outside the original Workspace.")
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists() or path.is_symlink():
        if path.is_symlink() or not path.is_file():
            raise ImplementationError("The retained quality-action archive must be an ordinary file.")
        qc._verify_archive(path, inspected["files"])
        return {"path": str(path), "bytes": path.stat().st_size, "sha256": file_digest(path),
                "action_report_id": action_report_id, "reused": True}
    descriptor, staged = tempfile.mkstemp(prefix=".qc-actions-export-", dir=path.parent)
    os.close(descriptor)
    staged = Path(staged)
    try:
        with zipfile.ZipFile(staged, "w", compression=zipfile.ZIP_DEFLATED) as archive:
            for item in inspected["files"]:
                source = root / item["path"]
                if describe_file(root, source) != item:
                    raise ImplementationError("A retained quality-action export source changed.")
                archive.write(source, source.name)
        qc._verify_archive(staged, inspected["files"])
        os.link(staged, path)
        return {"path": str(path), "bytes": path.stat().st_size, "sha256": file_digest(path),
                "action_report_id": action_report_id}
    finally:
        staged.unlink(missing_ok=True)


def main(argv=None):
    import argparse
    parser = argparse.ArgumentParser(description="Continue saved sample-QC reviews in the original field plan.")
    parser.add_argument("--workspace", required=True)
    sub = parser.add_subparsers(dest="command", required=True)
    for name in ("context", "list", "inspect", "source", "export"):
        command = sub.add_parser(name)
        command.add_argument("--plan-id", required=True)
        if name == "context":
            command.add_argument("--report-id", required=True)
        elif name in ("inspect", "source", "export"):
            command.add_argument("--action-report-id", required=True)
        if name == "export":
            command.add_argument("--output", required=True)
    for name in ("preview", "save", "validate-selection"):
        command = sub.add_parser(name)
        command.add_argument("--selection", required=True)
    args = parser.parse_args(argv)
    from .workspace import Workspace
    ws = Workspace(args.workspace)
    if args.command == "validate-selection":
        result = validate_selection(ws, read_json(Path(args.selection)))
    elif args.command in ("preview", "save"):
        result = globals()[args.command](ws, read_json(Path(args.selection)))
    elif args.command == "context":
        result = context(ws, args.plan_id, args.report_id)
    elif args.command == "list":
        result = {"action_reports": catalog(ws, args.plan_id)}
    elif args.command == "export":
        result = export(ws, args.plan_id, args.action_report_id, args.output)
    elif args.command == "source":
        result = scientific_source(ws, args.plan_id, args.action_report_id)
    else:
        result = inspect(ws, args.plan_id, args.action_report_id)
    print(json.dumps(result, indent=2, ensure_ascii=False, allow_nan=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
