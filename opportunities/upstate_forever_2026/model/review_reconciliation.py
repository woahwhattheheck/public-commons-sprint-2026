"""Reconcile independently returned review responses in the original Workspace.

The native review engine continues to own the response chain. This module builds
a three-way selection from that chain, retains the complete returned document,
and passes the resolved response to reviews.import_response. A prepared receipt
makes the same operator task recoverable after interruption.
"""
from __future__ import annotations

import copy
import hashlib
import json
import os
from pathlib import Path
import tempfile

from .common import atomic_json, digest, file_digest, held, identifier, now, read_json
from . import reviews

PLAN_SCHEMA = "upstate.review-response-reconciliation/v1"
REQUEST_SCHEMA = "upstate.review-reconciliation-request/v1"
PREPARED_SCHEMA = "upstate.review-reconciliation-prepared/v1"
COMPLETED_SCHEMA = "upstate.review-reconciliation-completed/v1"
DIRECTORY = "review-reconciliations"
_UNSPECIFIED = object()
_ROWS = (("artifact_decisions", "artifact_id"),
         ("requirement_decisions", "requirement_id"), ("corrections", "id"))


class ReconciliationError(ValueError):
    def __init__(self, code, message, *, details=None):
        super().__init__(message)
        self.code = code
        self.details = details or {}


def _error(code, message, **details):
    raise ReconciliationError(code, message, details=details)


def _record(value, schema):
    body = {"schema": schema, **value}
    return {"id": digest(body), **body}


def _read_record(path, schema):
    value = read_json(path)
    if (not isinstance(value, dict) or value.get("schema") != schema
            or value.get("id") != digest({k: v for k, v in value.items() if k != "id"})):
        _error("REVIEW_RECONCILIATION_CHANGED", "The retained reconciliation record changed.")
    return value


def _blank(review):
    def decision(field, key):
        return {field: key, "decision": "unreviewed", "comment": "",
                "requested_change": "", "assignee": ""}
    return {
        "artifact_decisions": [decision("artifact_id", item["id"]) for item in review["artifacts"]],
        "requirement_decisions": [decision("requirement_id", item["id"]) for item in review["requirements"]],
        "corrections": [], "summary": "", "disposition": "in-review",
    }


def _contents(response):
    return copy.deepcopy({name: response[name] for name in
                          ("artifact_decisions", "requirement_decisions", "corrections",
                           "summary", "disposition")})


def _load(workspace, incoming, expected_response_id=_UNSPECIFIED):
    if not isinstance(incoming, dict):
        _error("REVIEW_RESPONSE_DOCUMENT", "Choose the complete returned response document.")
    review = workspace._get("reviews", identifier(incoming.get("review_id")))
    reviews._validate_bindings(workspace, review)
    checked = reviews._checked_response(incoming, review)
    chain = reviews.history(workspace, review["id"])
    latest = chain[-1]["id"] if chain else None
    if expected_response_id is not _UNSPECIFIED:
        if expected_response_id is not None:
            identifier(expected_response_id)
        if expected_response_id != latest:
            _error("REVIEW_HEAD_CHANGED",
                   "Another response arrived. Refresh the comparison to include it.",
                   expected_response_id=expected_response_id, latest_response_id=latest)
    by_id = {row["id"]: row for row in chain}
    predecessor = checked["previous_response_id"]
    if predecessor is not None and predecessor not in by_id:
        _error("REVIEW_BASE_MISSING",
               "This response refers to an earlier response that is not retained here. "
               "Import that complete review packet or reopen its original Workspace.",
               base_response_id=predecessor, latest_response_id=latest)
    duplicate = next((row for row in chain
                      if row["request_sha256"] == digest(checked)), None)
    base = _contents(by_id[predecessor]["response"]) if predecessor else _blank(review)
    current = _contents(chain[-1]["response"]) if chain else _blank(review)
    return review, checked, chain, latest, base, current, duplicate


def preview_response(workspace, incoming, *, expected_response_id=_UNSPECIFIED):
    """Compare the returned decisions against their exact predecessor and head."""
    review, checked, chain, latest, base, current, duplicate = _load(
        workspace, incoming, expected_response_id)
    returned = _contents(checked)
    merged, changes, conflicts = {}, [], []
    labels = {
        "artifact_decisions": {item["id"]: item["label"] for item in review["artifacts"]},
        "requirement_decisions": {item["id"]: item["title"] for item in review["requirements"]},
        "corrections": {item["id"]: item["title"] for side in (base, current, returned)
                        for item in side["corrections"]},
    }

    def merge_item(section, item_id, before, retained, received):
        key = section + (":" + item_id if item_id is not None else "")
        label = labels.get(section, {}).get(item_id, section.replace("_", " ").capitalize())
        common = {"key": key, "section": section, "item_id": item_id, "label": label}
        if retained == received:
            chosen, kind = retained, "same-change" if retained != before else "unchanged"
        elif retained == before:
            chosen, kind = received, "returned"
        elif received == before:
            chosen, kind = retained, "current"
        else:
            partial, fields = None, []
            if all(isinstance(side, dict) for side in (before, retained, received)):
                partial = {}
                for field in sorted(set(before) | set(retained) | set(received)):
                    original, current_value, returned_value = before.get(field), retained.get(field), received.get(field)
                    if current_value == returned_value:
                        partial[field] = copy.deepcopy(current_value)
                    elif current_value == original:
                        partial[field] = copy.deepcopy(returned_value)
                    elif returned_value == original:
                        partial[field] = copy.deepcopy(current_value)
                    else:
                        partial[field] = copy.deepcopy(current_value)
                        fields.append(field)
                if not fields:
                    changes.append({**common, "source": "combined", "value": partial})
                    return partial
            conflicts.append({**common, "base": copy.deepcopy(before),
                              "current": copy.deepcopy(retained), "returned": copy.deepcopy(received),
                              "can_delete": section == "corrections",
                              "conflicting_fields": fields, "proposed": partial})
            return copy.deepcopy(partial if partial is not None else retained)
        if kind != "unchanged":
            changes.append({**common, "source": kind, "value": copy.deepcopy(chosen)})
        return copy.deepcopy(chosen)

    for section, key_field in _ROWS:
        sides = [{row[key_field]: row for row in side[section]} for side in (base, current, returned)]
        merged_rows = []
        for key in sorted(set(sides[0]) | set(sides[1]) | set(sides[2])):
            item = merge_item(section, key, *(side.get(key) for side in sides))
            if item is not None:
                merged_rows.append(item)
        merged[section] = merged_rows
    for section in ("summary", "disposition"):
        merged[section] = merge_item(section, None, base[section], current[section], returned[section])
    mode = "already-retained" if duplicate else "current" if checked["previous_response_id"] == latest else "reconcile"
    if duplicate:
        # The native importer returns this exact earlier record even after the
        # head advances. Receiving it again must not ask to merge old decisions.
        conflicts, changes, merged = [], [], copy.deepcopy(returned)
    identity = {
        "schema": PLAN_SCHEMA, "project_id": workspace.project["id"], "review_id": review["id"],
        "base_response_id": checked["previous_response_id"], "expected_response_id": latest,
        "incoming_response_sha256": digest(checked),
    }
    return {
        **identity, "id": digest(identity), "mode": mode,
        "duplicate_response_id": duplicate["id"] if duplicate else None,
        "review": {"title": review["title"], "purpose": review["purpose"],
                   "artifacts": len(review["artifacts"]), "requirements": len(review["requirements"])},
        "returned_reviewer": checked["reviewer"],
        "current_reviewer": chain[-1]["response"]["reviewer"] if chain else None,
        "base_reviewer": next((row["response"]["reviewer"] for row in chain
                              if row["id"] == checked["previous_response_id"]), None),
        "current_created_at": chain[-1]["response"]["created_at"] if chain else None,
        "returned_created_at": checked["created_at"], "history_length": len(chain),
        "automatic_changes": changes, "conflicts": conflicts, "merged": merged,
        "current_disposition": current["disposition"], "returned_disposition": returned["disposition"],
        "current_summary": current["summary"], "returned_summary": returned["summary"],
    }


def _resolve_choice(conflict, value):
    if not isinstance(value, dict) or set(value) - {"choice", "value"}:
        _error("REVIEW_CONFLICT_CHOICE", "Choose a resolution for every conflicting item.",
               conflict_key=conflict["key"])
    name = value.get("choice")
    if name in ("base", "current", "returned"):
        if "value" in value:
            _error("REVIEW_CONFLICT_CHOICE", "A selected version cannot also contain an edited value.",
                   conflict_key=conflict["key"])
        result = copy.deepcopy(conflict[name])
        if conflict.get("conflicting_fields") and isinstance(conflict.get("proposed"), dict):
            result = copy.deepcopy(conflict["proposed"])
            for field in conflict["conflicting_fields"]:
                result[field] = copy.deepcopy(conflict[name][field])
    elif name == "edit" and "value" in value:
        result = copy.deepcopy(value["value"])
    else:
        _error("REVIEW_CONFLICT_CHOICE", "Choose the current, returned, original, or edited value.",
               conflict_key=conflict["key"])
    if result is None and not conflict["can_delete"]:
        _error("REVIEW_CONFLICT_CHOICE", "Every selected artifact and requirement needs a decision.",
               conflict_key=conflict["key"])
    return result


def resolved_response(workspace, incoming, plan, choices, *, reviewer, created_at,
                      disposition=None, summary=None):
    """Construct a native response, keeping all item IDs and original bindings."""
    if not isinstance(choices, dict):
        _error("REVIEW_CONFLICT_CHOICES", "Return the selected conflict resolutions.")
    if plan.get("schema") != PLAN_SCHEMA:
        _error("REVIEW_RECONCILIATION_PLAN", "Refresh the response comparison.")
    if plan["mode"] in ("already-retained", "current"):
        if choices:
            _error("REVIEW_CONFLICT_CHOICES", "The current response needs no reconciliation choices.")
        return reviews._checked_response(incoming, workspace._get("reviews", plan["review_id"]))
    allowed = {item["key"] for item in plan["conflicts"]}
    if set(choices) != allowed:
        _error("REVIEW_CONFLICT_CHOICES", "Resolve every conflicting item before retaining the response.",
               missing=sorted(allowed - set(choices)), unknown=sorted(set(choices) - allowed))
    merged = copy.deepcopy(plan["merged"])
    key_fields = dict(_ROWS)
    for conflict in plan["conflicts"]:
        value = _resolve_choice(conflict, choices[conflict["key"]])
        section, item_id = conflict["section"], conflict["item_id"]
        if item_id is None:
            merged[section] = value
            continue
        key_field = key_fields[section]
        if value is not None and (not isinstance(value, dict) or value.get(key_field) != item_id):
            _error("REVIEW_CONFLICT_ITEM", "An edited resolution must keep the selected original item ID.",
                   conflict_key=conflict["key"])
        rows = {row[key_field]: row for row in merged[section]}
        if value is None:
            rows.pop(item_id, None)
        else:
            rows[item_id] = value
        merged[section] = [rows[key] for key in sorted(rows)]
    if disposition is not None:
        merged["disposition"] = disposition
    if summary is not None:
        merged["summary"] = summary
    candidate = {
        "schema": reviews.RESPONSE_SCHEMA, "project_id": plan["project_id"],
        "review_id": plan["review_id"], "previous_response_id": plan["expected_response_id"],
        "reviewer": reviewer, "created_at": created_at, **merged,
    }
    review = workspace._get("reviews", plan["review_id"])
    return reviews._checked_response(candidate, review)


def _raw_input(incoming, source_path=None):
    if source_path is not None:
        path = Path(source_path)
        raw = path.read_bytes()
        if len(raw) > reviews.JSON_BYTES:
            _error("REVIEW_RESPONSE_SIZE", "The returned response exceeds the 32 MiB document limit.")
        if json.loads(raw) != incoming:
            _error("REVIEW_RESPONSE_SOURCE", "The retained upload differs from the selected response document.")
        return raw
    return (json.dumps(incoming, ensure_ascii=False, sort_keys=True, separators=(",", ":"),
                       allow_nan=False) + "\n").encode("utf-8")


def _write_original(path, raw):
    expected = hashlib.sha256(raw).hexdigest()
    if path.exists():
        if not path.is_file() or path.is_symlink() or path.stat().st_size != len(raw) or file_digest(path) != expected:
            _error("REVIEW_ORIGINAL_CHANGED", "The retained returned-response file changed.")
    else:
        name = None
        try:
            with tempfile.NamedTemporaryFile(dir=path.parent, prefix=".write-returned-", delete=False) as handle:
                name = Path(handle.name)
                handle.write(raw)
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(name, path)
        finally:
            if name is not None and name.exists():
                name.unlink()
    return {"filename": path.name, "bytes": len(raw), "sha256": expected}


def _paths(workspace, operation_id):
    operation_id = identifier(operation_id)
    directory = workspace.root / DIRECTORY / operation_id
    return directory, directory / "prepared.json", directory / "completed.json"


def _verify_prepared(workspace, prepared, directory):
    if prepared["project_id"] != workspace.project["id"]:
        _error("REVIEW_RECONCILIATION_PROJECT", "This reconciliation belongs to a different project.")
    if prepared["request_sha256"] != digest(prepared["request"]):
        _error("REVIEW_RECONCILIATION_CHANGED", "The retained reconciliation request changed.")
    incoming_path = directory / "returned-response.json"
    descriptor = prepared["original_file"]
    if (incoming_path.is_symlink() or not incoming_path.is_file()
            or incoming_path.stat().st_size != descriptor["bytes"]
            or file_digest(incoming_path) != descriptor["sha256"]):
        _error("REVIEW_ORIGINAL_CHANGED", "The retained returned-response file changed.")
    review = workspace._get("reviews", prepared["review_id"])
    checked = reviews._checked_response(prepared["candidate"], review)
    if checked != prepared["candidate"] or digest(checked) != prepared["candidate_sha256"]:
        _error("REVIEW_RECONCILIATION_CHANGED", "The prepared reconciled response changed.")


def _result(workspace, prepared, completed, directory):
    if (completed["prepared_id"] != prepared["id"]
            or completed["project_id"] != workspace.project["id"]
            or completed["review_id"] != prepared["review_id"]):
        _error("REVIEW_RECONCILIATION_CHANGED", "The completed reconciliation refers to another selection.")
    record = workspace._get("review-responses", identifier(completed["response_id"]))
    if (record.get("request_sha256") != prepared["candidate_sha256"]
            or record.get("response") != prepared["candidate"]):
        _error("REVIEW_RECONCILIATION_CHANGED", "The original imported response differs from its reconciliation.")
    chain = reviews.history(workspace, prepared["review_id"])
    if not any(row["id"] == record["id"] for row in chain):
        _error("REVIEW_RECONCILIATION_CHANGED", "The reconciled response is outside the original response history.")
    return {
        "review_id": prepared["review_id"], "response_id": record["id"], "record": record,
        "operation_id": prepared["operation_id"], "reconciliation_id": completed["id"],
        "plan_id": prepared["plan_id"], "base_response_id": prepared["base_response_id"],
        "previous_response_id": prepared["candidate"]["previous_response_id"],
        "conflicts_resolved": len(prepared["request"]["choices"]),
        "automatic_changes": len(prepared["automatic_changes"]),
        "original_file": {**prepared["original_file"], "path": str(directory / "returned-response.json")},
        "prepared_file": {"path": str(directory / "prepared.json"), "filename": "prepared.json",
                          "bytes": (directory / "prepared.json").stat().st_size,
                          "sha256": file_digest(directory / "prepared.json")},
        "completed_file": {"path": str(directory / "completed.json"), "filename": "completed.json",
                           "bytes": (directory / "completed.json").stat().st_size,
                           "sha256": file_digest(directory / "completed.json")},
    }


def commit_response(workspace, incoming, *, plan_id, expected_response_id, choices,
                    reviewer, operation_id, created_at, disposition=None, summary=None,
                    note="", source_path=None):
    """Import the selected three-way result through the native response engine.

    A retry reuses the immutable prepared candidate. If import completed before
    interruption, the native importer finds that same response in its existing
    history. A genuinely changed head is returned for a refreshed comparison.
    """
    identifier(plan_id)
    if expected_response_id is not None:
        identifier(expected_response_id)
    created_at = reviews._date(created_at, "Reconciliation creation time")
    note = reviews._text(note, "Reconciliation note")
    raw = _raw_input(incoming, source_path)
    directory, prepared_path, completed_path = _paths(workspace, operation_id)
    request = {
        "schema": REQUEST_SCHEMA, "project_id": workspace.project["id"],
        "review_id": identifier(incoming.get("review_id")), "operation_id": operation_id,
        "plan_id": plan_id, "expected_response_id": expected_response_id,
        "incoming_sha256": hashlib.sha256(raw).hexdigest(),
        "choices": choices, "reviewer": reviewer, "created_at": created_at,
        "disposition": disposition, "summary": summary, "note": note,
    }
    request_sha = digest(request)
    directory.mkdir(parents=True, exist_ok=True)
    with held(directory / ".reconciliation.lock", blocking=False):
        if prepared_path.exists():
            prepared = _read_record(prepared_path, PREPARED_SCHEMA)
            if prepared["request_sha256"] != request_sha:
                _error("REVIEW_OPERATION_REUSED", "This operation already belongs to a different response resolution.")
            _verify_prepared(workspace, prepared, directory)
        else:
            with held(workspace.root / ".workspace.lock", blocking=False):
                plan = preview_response(workspace, incoming, expected_response_id=expected_response_id)
                if plan["id"] != plan_id:
                    _error("REVIEW_RECONCILIATION_PLAN", "The comparison changed. Refresh it before retaining decisions.")
                candidate = resolved_response(workspace, incoming, plan, choices, reviewer=reviewer,
                                              created_at=created_at, disposition=disposition, summary=summary)
                original = _write_original(directory / "returned-response.json", raw)
                prepared = _record({
                    "project_id": workspace.project["id"], "review_id": plan["review_id"],
                    "operation_id": operation_id, "request_sha256": request_sha, "request": request,
                    "plan_id": plan_id, "base_response_id": plan["base_response_id"],
                    "original_file": original, "incoming_response_sha256": plan["incoming_response_sha256"],
                    "candidate": candidate, "candidate_sha256": digest(candidate),
                    "automatic_changes": plan["automatic_changes"], "conflicts": plan["conflicts"],
                }, PREPARED_SCHEMA)
                atomic_json(prepared_path, prepared, immutable=True)
        if completed_path.exists():
            completed = _read_record(completed_path, COMPLETED_SCHEMA)
            return _result(workspace, prepared, completed, directory)
        try:
            record = reviews.import_response(workspace, prepared["candidate"])
        except ValueError:
            chain = reviews.history(workspace, prepared["review_id"])
            latest = chain[-1]["id"] if chain else None
            if latest != prepared["candidate"]["previous_response_id"] and not any(
                    row["request_sha256"] == prepared["candidate_sha256"] for row in chain):
                _error("REVIEW_HEAD_CHANGED",
                       "Another response arrived. The original returned file and selected choices are retained; "
                       "refresh the comparison to include the new response.",
                       expected_response_id=prepared["candidate"]["previous_response_id"],
                       latest_response_id=latest, operation_id=operation_id)
            raise
        with held(workspace.root / ".workspace.lock", blocking=False):
            completed = _record({
                "project_id": workspace.project["id"], "review_id": prepared["review_id"],
                "operation_id": operation_id, "prepared_id": prepared["id"],
                "response_id": record["id"], "imported_at": record["imported_at"],
                "candidate_sha256": prepared["candidate_sha256"],
            }, COMPLETED_SCHEMA)
            atomic_json(completed_path, completed, immutable=True)
        return _result(workspace, prepared, completed, directory)


def list_reconciliations(workspace, *, review_id=None, verify_files=False):
    if review_id is not None:
        identifier(review_id)
    root = workspace.root / DIRECTORY
    result = []
    if not root.exists():
        return result
    for path in sorted(root.glob("*/prepared.json")):
        prepared = _read_record(path, PREPARED_SCHEMA)
        if review_id is not None and prepared["review_id"] != review_id:
            continue
        if verify_files:
            _verify_prepared(workspace, prepared, path.parent)
        completed_path = path.parent / "completed.json"
        completed = _read_record(completed_path, COMPLETED_SCHEMA) if completed_path.exists() else None
        result.append({
            "operation_id": prepared["operation_id"], "review_id": prepared["review_id"],
            "created_at": prepared["request"]["created_at"],
            "reviewer": prepared["request"]["reviewer"],
            "state": "complete" if completed else "prepared",
            "response_id": completed["response_id"] if completed else None,
            "base_response_id": prepared["base_response_id"],
            "expected_response_id": prepared["request"]["expected_response_id"],
            "conflicts_resolved": len(prepared["request"]["choices"]),
            "automatic_changes": len(prepared["automatic_changes"]),
            "note": prepared["request"]["note"],
            "incoming_sha256": prepared["original_file"]["sha256"],
        })
    return sorted(result, key=lambda row: (row["created_at"], row["operation_id"]), reverse=True)


def inspect_reconciliation(workspace, operation_id):
    directory, prepared_path, completed_path = _paths(workspace, operation_id)
    prepared = _read_record(prepared_path, PREPARED_SCHEMA)
    _verify_prepared(workspace, prepared, directory)
    completed = _read_record(completed_path, COMPLETED_SCHEMA) if completed_path.exists() else None
    result = {"prepared": prepared, "completed": completed,
              "original_response": reviews._read_json_file(directory / "returned-response.json")}
    if completed:
        result["result"] = _result(workspace, prepared, completed, directory)
    return result


def verify_all(workspace):
    """Reopen every returned original and completed native response after restore."""
    drafts = list_drafts(workspace)
    for draft in drafts:
        read_draft(workspace, draft["draft_id"])
    rows = list_reconciliations(workspace)
    complete = 0
    for row in rows:
        value = inspect_reconciliation(workspace, row["operation_id"])
        complete += value["completed"] is not None
    return {"project_id": workspace.project["id"], "reconciliations": len(rows),
            "completed": complete, "prepared": len(rows) - complete, "returned_responses": len(drafts)}


DRAFT_SCHEMA = "upstate.review-returned-response/v1"


def _draft_paths(workspace, draft_id):
    directory = workspace.root / DIRECTORY / "inbox" / identifier(draft_id)
    return directory, directory / "draft.json", directory / "returned-response.json"


def _draft_key(project_id, review_id, raw_sha256):
    return digest({"schema": DRAFT_SCHEMA, "project_id": project_id,
                   "review_id": review_id, "raw_sha256": raw_sha256})


def read_draft(workspace, draft_id, *, verify_file=True, include_response=False):
    directory, record_path, original_path = _draft_paths(workspace, draft_id)
    record = _read_record(record_path, DRAFT_SCHEMA)
    if (record["draft_id"] != draft_id or record["project_id"] != workspace.project["id"]
            or draft_id != _draft_key(workspace.project["id"], record["review_id"],
                                      record["original_file"]["sha256"])):
        _error("REVIEW_DRAFT_CHANGED", "The retained returned response belongs to another selection.")
    incoming = None
    if verify_file or include_response:
        descriptor = record["original_file"]
        if (original_path.is_symlink() or not original_path.is_file()
                or original_path.stat().st_size != descriptor["bytes"]
                or file_digest(original_path) != descriptor["sha256"]):
            _error("REVIEW_ORIGINAL_CHANGED", "The original returned-response file changed.")
        incoming = reviews._read_json_file(original_path)
        review = workspace._get("reviews", record["review_id"])
        checked = reviews._checked_response(incoming, review)
        if digest(checked) != record["incoming_response_sha256"]:
            _error("REVIEW_DRAFT_CHANGED", "The retained returned response differs from its original decisions.")
    result = {**record, "original_file": {**record["original_file"], "path": str(original_path)}}
    if include_response:
        result["response"] = incoming
    return result


def stage_response(workspace, incoming, *, operation_id, created_at, source_path=None):
    """Retain the returned original in the Workspace before selecting a merge."""
    identifier(operation_id)
    created_at = reviews._date(created_at, "Returned-response receiving time")
    if not isinstance(incoming, dict):
        _error("REVIEW_RESPONSE_DOCUMENT", "Choose the complete returned response document.")
    review = workspace._get("reviews", identifier(incoming.get("review_id")))
    reviews._validate_bindings(workspace, review)
    checked = reviews._checked_response(incoming, review)
    raw = _raw_input(incoming, source_path)
    key = _draft_key(workspace.project["id"], review["id"], hashlib.sha256(raw).hexdigest())
    directory, record_path, original_path = _draft_paths(workspace, key)
    directory.mkdir(parents=True, exist_ok=True)
    with held(directory / ".returned-response.lock", blocking=False):
        if not record_path.exists():
            with held(workspace.root / ".workspace.lock", blocking=False):
                original = _write_original(original_path, raw)
                value = _record({
                    "draft_id": key, "project_id": workspace.project["id"],
                    "review_id": review["id"], "received_at": created_at,
                    "operation_id": operation_id, "original_file": original,
                    "incoming_response_sha256": digest(checked),
                    "base_response_id": checked["previous_response_id"],
                    "reviewer": checked["reviewer"], "created_at": checked["created_at"],
                    "disposition": checked["disposition"], "summary": checked["summary"],
                    "artifacts": len(checked["artifact_decisions"]),
                    "requirements": len(checked["requirement_decisions"]),
                    "corrections": len(checked["corrections"]),
                }, DRAFT_SCHEMA)
                atomic_json(record_path, value, immutable=True)
        return read_draft(workspace, key)


def list_drafts(workspace, *, review_id=None):
    if review_id is not None:
        identifier(review_id)
    root = workspace.root / DIRECTORY / "inbox"
    if not root.exists():
        return []
    rows = []
    for path in sorted(root.glob("*/draft.json")):
        value = read_draft(workspace, path.parent.name, verify_file=False)
        if review_id is None or value["review_id"] == review_id:
            value["original_sha256"] = value["original_file"]["sha256"]
            value.pop("original_file", None)
            rows.append(value)
    return sorted(rows, key=lambda row: (row["received_at"], row["draft_id"]), reverse=True)
