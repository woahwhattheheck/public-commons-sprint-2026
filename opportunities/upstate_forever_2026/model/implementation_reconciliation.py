"""Review and apply retained offline field returns against immutable native revisions.

The original returned document and evidence remain retained. Decisions address exact
row IDs and fields, never labels. A reviewed operation writes at most one revision;
its immutable revision event repairs an interrupted receipt write on replay.
"""
from __future__ import annotations

import copy
import hashlib
from pathlib import Path
import re

from .implementation import _atomic_bytes, _same_json, _fsync_directory
from .implementation_schema import (
    COLLECTIONS, MAX_JSON_BYTES, ImplementationError, RevisionConflict,
    ValidationError, canonical_bytes, document_digest, load_json, validate_plan,
    utc_now, _integer,
)

EDITION = "offline-field-return-reconciliation-20261013-v1"
PREVIEW_SCHEMA = "upstate.implementation-reconciliation-preview/v1"
RECEIPT_SCHEMA = "upstate.implementation-reconciliation-receipt/v1"
RESOLUTION_SCHEMA = "upstate.implementation-reconciliation-resolution/v1"
CONFLICT_RE = re.compile(r"^[0-9a-f]{64}-r[0-9]{1,16}\.json$")
SHA_RE = re.compile(r"^[0-9a-f]{64}$")
_MISSING = object()
_MANAGED = frozenset(("schema", "id", "revision", "created_at", "updated_at"))
_MAX_AUDIT = MAX_JSON_BYTES * 4
_IMPORT_HISTORIES = ("field12_lab_imports", "field12_site_visit_imports")


def _equal(left, right):
    if left is _MISSING or right is _MISSING:
        return left is right
    return _same_json(left, right)


def _copy(value):
    return _MISSING if value is _MISSING else copy.deepcopy(value)


def _value(value):
    return {"present": value is not _MISSING,
            "value": None if value is _MISSING else copy.deepcopy(value)}


def _pointer(path):
    return "/" + "/".join(str(part).replace("~", "~0").replace("/", "~1") for part in path)


def _digest(value):
    return hashlib.sha256(canonical_bytes(value)).hexdigest()


def _read(path, *, limit=_MAX_AUDIT):
    path = Path(path)
    if path.is_symlink() or not path.is_file():
        raise ImplementationError(f"Retained reconciliation member is not a regular file: {path.name}")
    with path.open("rb") as handle:
        return load_json(handle.read(limit + 1), max_bytes=limit)


def _write(path, value):
    """Idempotent exact-byte publication; interrupted writes never replace originals."""
    raw = canonical_bytes(value) + b"\n"
    try:
        _atomic_bytes(path, raw)
    except FileExistsError:
        if path.is_symlink() or not path.is_file():
            raise ImplementationError(f"Retained reconciliation member changed: {path.name}")
        with path.open("rb") as handle:
            if handle.read(len(raw) + 1) != raw:
                raise ImplementationError(f"Retained reconciliation member changed: {path.name}")


def _retained(store, plan_id, conflict_id):
    if not isinstance(conflict_id, str) or not CONFLICT_RE.fullmatch(conflict_id):
        raise ImplementationError("Select an exact retained conflict ID from this plan.")
    directory = store._directory(plan_id)
    bank = directory / "conflicts"
    if bank.is_symlink() or not bank.is_dir():
        raise ImplementationError("This plan has no retained offline returns.")
    path = bank / conflict_id
    record = _read(path, limit=MAX_JSON_BYTES + 65536)
    if record.get("schema") != "upstate.implementation-conflict/v1":
        raise ImplementationError("The retained offline return has an unrecognized schema.")
    incoming = validate_plan(record.get("incoming"))
    digest = document_digest(incoming)
    if (incoming["id"] != plan_id or
            record.get("source_revision") != incoming["revision"] or
            record.get("source_document_digest") != digest or
            conflict_id != f"{digest}-r{incoming['revision']}.json"):
        raise ImplementationError("The retained offline return identity changed.")
    return record, incoming


def _normalize_choices(choices):
    if choices is None:
        return {}
    if not isinstance(choices, dict):
        raise ImplementationError("choices must map review decision IDs to current or incoming.")
    if len(choices) > 100000:
        raise ImplementationError("The review contains too many field choices.")
    for key, value in choices.items():
        if (not isinstance(key, str) or not SHA_RE.fullmatch(key) or
                value not in ("current", "incoming")):
            raise ImplementationError("Each review choice must name a displayed decision and current or incoming.")
    return dict(choices)


class _Merger:
    def __init__(self, choices):
        self.choices = choices
        self.decisions = []
        self.used = set()

    def decision(self, path, base, current, incoming, *, kind=None):
        if _equal(current, incoming):
            return _copy(current)
        if _equal(base, current):
            default = "incoming"
            inferred = "incoming-change"
        elif _equal(base, incoming):
            default = "current"
            inferred = "current-change"
        else:
            default = None
            inferred = ("add-add" if base is _MISSING else
                        "edit-delete" if current is _MISSING or incoming is _MISSING else
                        "edit-edit")
        values = {"path": _pointer(path), "base": _value(base),
                  "current": _value(current), "incoming": _value(incoming)}
        decision_id = _digest(values)
        if decision_id in self.choices:
            self.used.add(decision_id)
        choice = self.choices.get(decision_id, default)
        self.decisions.append({
            "id": decision_id, **values, "kind": kind or inferred,
            "required": default is None, "automatic": default is not None,
            "default_choice": default, "choice": choice,
        })
        # Unresolved previews retain current provisionally. can_apply remains false.
        return _copy(incoming if choice == "incoming" else current)

    def rows(self, path, base, current, incoming, *, key="id"):
        indexes = []
        for rows in (base, current, incoming):
            if not isinstance(rows, list):
                return self.decision(path, base, current, incoming)
            index = {}
            for row in rows:
                if (not isinstance(row, dict) or not isinstance(row.get(key), str) or
                        row[key] in index):
                    return self.decision(path, base, current, incoming)
                index[row[key]] = row
            indexes.append(index)
        b, c, i = indexes
        ids = list(dict.fromkeys([*(row[key] for row in current),
                                  *(row[key] for row in incoming),
                                  *(row[key] for row in base)]))
        merged = {}
        for row_id in ids:
            value = self.merge(path + (row_id,), b.get(row_id, _MISSING),
                               c.get(row_id, _MISSING), i.get(row_id, _MISSING))
            if value is not _MISSING:
                merged[row_id] = value
        # Compare the relative order of surviving original rows. Independent additions
        # do not create an ordering conflict; they follow current then incoming order.
        retained = set(merged) & b.keys() & c.keys() & i.keys()
        orders = [[row[key] for row in rows if row[key] in retained]
                  for rows in (base, current, incoming)]
        order = self.decision(path + ("$order",), *orders, kind="row-order")
        order = list(order)
        order.extend(row_id for row_id in ids if row_id in merged and row_id not in retained)
        return [merged[row_id] for row_id in order]

    def merge(self, path, base, current, incoming):
        if _equal(current, incoming):
            return _copy(current)
        if len(path) == 1 and path[0] in COLLECTIONS and all(
                isinstance(value, list) for value in (base, current, incoming)):
            return self.rows(path, base, current, incoming)
        if len(path) == 1 and path[0] in _IMPORT_HISTORIES and all(
                isinstance(value, list) for value in (current, incoming)) and (
                    base is _MISSING or isinstance(base, list)):
            return self.rows(path, [] if base is _MISSING else base,
                             current, incoming, key="operation_id")
        if (len(path) == 2 and path[0] in ("observations", "activities", "sites") and
                all(isinstance(value, dict) for value in (base, current, incoming))):
            # A concentration and its unit, a censored result and its limit, or
            # coordinates and their CRS must remain one actual source definition.
            # Merging their independent scalar edits would invent a hybrid record.
            editable = frozenset(("id", "notes", "evidence_refs"))
            groups = [{key: value for key, value in row.items() if key not in editable}
                      for row in (base, current, incoming)]
            label = {"observations": "$measurement", "activities": "$sample_context",
                     "sites": "$site_definition"}[path[0]]
            selected = self.decision(path + (label,), *groups, kind="scientific-definition")
            result = dict(selected)
            for key in sorted(editable):
                value = self.merge(path + (key,), base.get(key, _MISSING),
                                   current.get(key, _MISSING), incoming.get(key, _MISSING))
                if value is not _MISSING:
                    result[key] = value
            return result
        if all(isinstance(value, dict) for value in (base, current, incoming)):
            result = {}
            keys = sorted(set(base) | set(current) | set(incoming))
            for key in keys:
                if not path and key in _MANAGED:
                    if key in current:
                        result[key] = copy.deepcopy(current[key])
                    continue
                value = self.merge(path + (key,), base.get(key, _MISSING),
                                   current.get(key, _MISSING), incoming.get(key, _MISSING))
                if value is not _MISSING:
                    result[key] = value
            return result
        return self.decision(path, base, current, incoming)


def _original_bindings(current, proposed):
    """Retain import history and resolve selected explicit native source-link IDs.

    An explicitly selected complete result may replace lab_source on the same
    result ID, as the maintained laboratory importer does. Its exact original
    definition travels together; immutable source links and history remain.
    """
    issues = []
    source_ids = {row["id"] for row in proposed["source_links"]}
    for collection in COLLECTIONS:
        for row in proposed[collection]:
            for field in ("lab_source", "original_source"):
                binding = row.get(field)
                if not isinstance(binding, dict):
                    continue
                for key in ("source_link_id", "audit_source_link_id"):
                    if key in binding and (not isinstance(binding[key], str) or binding[key] not in source_ids):
                        issues.append(
                            f"{collection}/{row['id']}/{field}/{key}: select the retained "
                            "original source link together with this result definition.")
    for history_name in _IMPORT_HISTORIES:
        history = current.get(history_name, [])
        fresh = proposed.get(history_name, [])
        if not isinstance(history, list) or not isinstance(fresh, list):
            issues.append(f"{history_name}: source import history must remain a list.")
            continue
        valid_records = [row for row in fresh if isinstance(row, dict)
                         and isinstance(row.get("operation_id"), str) and row["operation_id"]]
        fresh_by_id = {row["operation_id"]: row for row in valid_records}
        if len(valid_records) != len(fresh) or len(fresh_by_id) != len(fresh):
            issues.append(f"{history_name}: retain complete unique original import operation records.")
        for old in history:
            if (not isinstance(old, dict) or not isinstance(old.get("operation_id"), str) or
                    not old["operation_id"] or
                    not _equal(old, fresh_by_id.get(old["operation_id"], _MISSING))):
                issues.append(f"{history_name}: preserve every committed source import record.")
                break
        for row in fresh:
            if not isinstance(row, dict):
                continue
            for key in ("source_link_id", "audit_source_link_id"):
                if key in row and (not isinstance(row[key], str) or row[key] not in source_ids):
                    issues.append(
                        f"{history_name}/{row.get('operation_id', '')}/{key}: "
                        "select the retained original source link.")
            if "source_link_ids" in row and (
                    not isinstance(row["source_link_ids"], list) or
                    any(not isinstance(value, str) or value not in source_ids
                        for value in row["source_link_ids"])):
                issues.append(
                    f"{history_name}/{row.get('operation_id', '')}/source_link_ids: "
                    "select every retained original CSV source link.")
    return issues

def _evidence_issues(store, current, proposed):
    """Require original newly referenced local attachment bytes to be present."""
    existing = {row["id"]: row for row in current["source_links"]}
    issues = []
    prefix = f"implementation/plans/{current['id']}/attachments/"
    for row in proposed["source_links"]:
        if row["id"] in existing and _equal(row, existing[row["id"]]):
            continue
        reference = row.get("reference")
        if not isinstance(reference, str) or not reference.startswith(prefix):
            continue
        tail = reference[len(prefix):]
        root = store._directory(current["id"]) / "attachments"
        path = root / tail
        if (not tail or "/" in tail or "\\" in tail or tail in (".", "..") or
                root.is_symlink() or path.is_symlink() or not path.is_file()):
            issues.append(f"source_links/{row['id']}: import the evidence ZIP containing original attachment {tail!r}.")
            continue
        if row.get("sha256") is None and row.get("size_bytes") is None:
            continue
        digest = hashlib.sha256()
        size = 0
        with path.open("rb") as handle:
            for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                size += len(chunk)
                digest.update(chunk)
        if row.get("sha256") != digest.hexdigest() or row.get("size_bytes") != size:
            issues.append(f"source_links/{row['id']}: the retained original attachment differs from its source descriptor.")
    return issues


def _build(store, plan_id, conflict_id, choices, current):
    record, incoming = _retained(store, plan_id, conflict_id)
    issues = []
    try:
        base = store.get(plan_id, incoming["revision"])
    except ImplementationError as error:
        raise ImplementationError(
            "This returned plan does not name a retained native base revision. "
            "Open its original native Workspace before reconciling it.") from error
    if incoming["revision"] > current["revision"]:
        issues.append("The incoming base revision is newer than the selected current revision.")
    for field in ("schema", "id", "created_at"):
        if not _equal(incoming.get(field), base.get(field)):
            issues.append(f"{field}: the returned plan differs from its immutable base identity.")
    merger = _Merger(choices)
    merged = merger.merge((), base, current, incoming)
    unknown = sorted(set(choices) - merger.used)
    if unknown:
        issues.append("Some choices refer to an older or different preview. Refresh the review before applying.")
    try:
        merged = validate_plan(merged)
        store._check_frozen_sources(current, merged)
        issues.extend(_original_bindings(current, merged))
        issues.extend(_evidence_issues(store, current, merged))
    except ValidationError as error:
        issues.extend(error.issues)
    except ImplementationError as error:
        issues.append(str(error))
    decisions = merger.decisions
    unresolved = sum(item["required"] and item["choice"] is None for item in decisions)
    selected = {item["id"]: item["choice"] for item in decisions if item["choice"] is not None}
    bindings = {
        "base": {"revision": base["revision"], "sha256": document_digest(base)},
        "current": {"revision": current["revision"], "sha256": document_digest(current)},
        "incoming": {"revision": incoming["revision"], "sha256": document_digest(incoming)},
    }
    summary = {
        "decisions": len(decisions),
        "conflicts": sum(item["required"] for item in decisions),
        "automatic_changes": sum(item["automatic"] for item in decisions),
        "resolved_conflicts": sum(item["required"] and item["choice"] is not None for item in decisions),
        "unresolved_conflicts": unresolved,
        "overridden_automatic_changes": sum(
            item["automatic"] and item["choice"] != item["default_choice"] for item in decisions),
        "changed_collections": [name for name in COLLECTIONS
                                if not _equal(current[name], merged.get(name, _MISSING))],
        "changed": not _equal(current, merged),
        "validation_errors": len(issues),
    }
    identity = {
        "edition": EDITION, "plan_id": plan_id, "conflict_id": conflict_id,
        **bindings, "choices": selected, "candidate_sha256": document_digest(merged),
    }
    operation_id = _digest(identity)
    preview = {
        "schema": PREVIEW_SCHEMA, "edition": EDITION, "plan_id": plan_id,
        "conflict_id": conflict_id, "operation_id": operation_id,
        "expected_revision": current["revision"],
        "source_document_digest": bindings["incoming"]["sha256"], **bindings,
        "can_apply": not issues and not unresolved, "summary": summary,
        "conflicts": decisions, "validation_errors": issues,
        "interpretation": (
            "The base is the saved native revision carried by this offline return. Independent "
            "changes are selected automatically and remain reviewable. Competing edits require an "
            "explicit choice. Original result text, units, method definitions and evidence bindings "
            "remain exact values; collection rows are matched by their original IDs."),
    }
    return preview, merged, incoming, identity


def list_conflicts(store, plan_id):
    with store._locked(plan_id) as directory:
        current = store.get(plan_id)
        bank = directory / "conflicts"
        if bank.is_symlink():
            raise ImplementationError("The offline return directory must not be a symlink.")
        items = []
        for path in sorted(bank.iterdir()) if bank.is_dir() else ():
            if not CONFLICT_RE.fullmatch(path.name):
                continue
            record, incoming = _retained(store, plan_id, path.name)
            items.append({
                "conflict_id": path.name,
                "source_revision": incoming["revision"],
                "current_revision": current["revision"],
                "received_current_revision": record.get("current_revision"),
                "received_at": record.get("received_at", ""),
                "reason": record.get("reason", ""),
                "source_document_digest": document_digest(incoming),
                "sha256": document_digest(incoming),
                "actor": record.get("actor", ""),
            })
        return {
            "schema": "upstate.implementation-reconciliation-conflicts/v1",
            "plan_id": plan_id, "current_revision": current["revision"],
            "items": sorted(items, key=lambda item: (item["received_at"], item["conflict_id"]),
                            reverse=True),
        }


def preview_reconciliation(store, plan_id, conflict_id, *, choices=None):
    choices = _normalize_choices(choices)
    with store._locked(plan_id):
        current = store.get(plan_id)
        preview, _, _, _ = _build(store, plan_id, conflict_id, choices, current)
        return preview


def _operation_directory(directory, operation_id, *, create=False):
    if not isinstance(operation_id, str) or not SHA_RE.fullmatch(operation_id):
        raise ImplementationError("expected_operation_id must be the exact displayed review identity.")
    bank = directory / "reconciliations"
    target = bank / operation_id
    if bank.is_symlink() or target.is_symlink():
        raise ImplementationError("The reconciliation directory must not be a symlink.")
    if create:
        bank.mkdir(exist_ok=True)
        target.mkdir(exist_ok=True)
        _fsync_directory(directory)
        _fsync_directory(bank)
    return target


def _descriptor(store, path):
    if path.is_symlink() or not path.is_file():
        raise ImplementationError("A retained reconciliation download is not a regular file.")
    data = path.read_bytes()
    return {
        "name": path.name, "path": path.relative_to(store.root).as_posix(),
        "sha256": hashlib.sha256(data).hexdigest(), "bytes": len(data),
    }


def _complete(store, target, resolution, applied, *, replay):
    """Rebuild the same audit files after a crash, without a second plan write."""
    incoming = _read(target / "incoming.json", limit=MAX_JSON_BYTES + 1)
    if document_digest(incoming) != resolution["identity"]["incoming"]["sha256"]:
        raise ImplementationError("The retained incoming reconciliation audit changed.")
    _write(target / "applied-plan.json", applied)
    receipt = {
        "schema": RECEIPT_SCHEMA, "edition": EDITION,
        "operation_id": target.name, "plan_id": applied["id"],
        "conflict_id": resolution["identity"]["conflict_id"],
        "expected_revision": resolution["identity"]["current"]["revision"],
        "applied_revision": applied["revision"],
        "applied_sha256": document_digest(applied),
        "status": "applied" if resolution["summary"]["changed"] else "unchanged",
        "prepared_at": resolution["prepared_at"], "actor": resolution["actor"],
        "summary": resolution["summary"], "identity": resolution["identity"],
    }
    _write(target / "receipt.json", receipt)
    current = store.get(applied["id"])
    return {
        **receipt, "replayed": replay, "plan": applied,
        "current_revision": current["revision"],
        "current_sha256": document_digest(current),
        "files": [_descriptor(store, target / name) for name in
                  ("resolution.json", "incoming.json", "candidate-plan.json",
                   "applied-plan.json", "receipt.json")],
    }


def apply_reconciliation(store, plan_id, conflict_id, *, expected_operation_id,
                         expected_revision, choices=None, actor=""):
    choices = _normalize_choices(choices)
    if not _integer(expected_revision, 1):
        raise ImplementationError("expected_revision must be the saved revision shown in the preview.")
    if not isinstance(actor, str) or len(actor) > 1024:
        raise ImplementationError("actor must be a string of at most 1024 characters.")
    with store._locked(plan_id) as directory:
        target = _operation_directory(directory, expected_operation_id)
        resolution_path = target / "resolution.json"
        current = store.get(plan_id)
        # Recompute against the exact reviewed historical current on retry. The
        # live head may have advanced after the single immutable apply event.
        review_current = (store.get(plan_id, expected_revision)
                          if resolution_path.exists() else current)
        preview, candidate, incoming, identity = _build(
            store, plan_id, conflict_id, choices, review_current)
        if (preview["operation_id"] != expected_operation_id or
                review_current["revision"] != expected_revision):
            raise RevisionConflict(plan_id, expected_revision, current["revision"])
        if not preview["can_apply"]:
            details = preview["validation_errors"] or ["Choose every competing field edit before applying."]
            raise ImplementationError("This review cannot be applied:\n" + "\n".join(details))
        operation = "reconcile-offline-return:" + expected_operation_id
        if resolution_path.exists():
            resolution = _read(resolution_path)
            if (resolution.get("schema") != RESOLUTION_SCHEMA or
                    resolution.get("identity") != identity):
                raise ImplementationError("The retained reconciliation identity changed.")
            retained_candidate = _read(target / "candidate-plan.json", limit=MAX_JSON_BYTES + 1)
            if document_digest(retained_candidate) != identity["candidate_sha256"]:
                raise ImplementationError("The retained candidate plan changed.")
            if not resolution["summary"]["changed"]:
                return _complete(store, target, resolution, review_current, replay=True)
            committed_path = directory / "revisions" / f"{expected_revision + 1:016d}.json"
            if committed_path.exists():
                record = store._read_record(committed_path)
                if (record["event"].get("operation") == operation and
                        record["event"].get("previous_document_digest") == identity["current"]["sha256"] and
                        record["event"].get("source_document_digest") == identity["incoming"]["sha256"]):
                    return _complete(store, target, resolution, record["plan"], replay=True)
                raise RevisionConflict(plan_id, expected_revision, current["revision"])
        else:
            if current["revision"] != expected_revision:
                raise RevisionConflict(plan_id, expected_revision, current["revision"])
            target = _operation_directory(directory, expected_operation_id, create=True)
            # Originals and candidate are durable before intent; a crash before
            # intent simply retries the same exact-byte preparation.
            _write(target / "incoming.json", incoming)
            _write(target / "candidate-plan.json", candidate)
            resolution = {
                "schema": RESOLUTION_SCHEMA, "edition": EDITION,
                "identity": identity, "summary": preview["summary"],
                "actor": actor, "prepared_at": utc_now(),
            }
            _write(resolution_path, resolution)
        if current["revision"] != expected_revision:
            raise RevisionConflict(plan_id, expected_revision, current["revision"])
        if not preview["summary"]["changed"]:
            return _complete(store, target, resolution, current, replay=False)
        # Same plan lock covers preview validation, original-source guards and commit.
        applied = store._commit(
            directory, candidate, previous=current, revision=expected_revision + 1,
            operation=operation, actor=resolution["actor"],
            source_document_digest=identity["incoming"]["sha256"],
            source_revision=identity["incoming"]["revision"],
        )
        return _complete(store, target, resolution, applied, replay=False)
