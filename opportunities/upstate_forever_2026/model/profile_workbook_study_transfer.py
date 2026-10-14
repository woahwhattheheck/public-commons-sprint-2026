"""Retain saved Profile workbook returns and their editable scientific lineage.

The existing Study exporter owns capture, locks, copying and received validation.
This resolver reads immutable records and native source objects without creating
source views, rerunning a model or rewriting either original workbook.
"""
from __future__ import annotations

from copy import deepcopy
from pathlib import PurePosixPath

from .common import canonical, digest, identifier, read_json

KIND = "profile-workbook-returns"
SCHEMA = "upstate.profile-workbook-return/v1"
ROOT_KINDS = (KIND,)
DOCUMENTS = {KIND: "result.json"}
LABELS = {KIND: "Saved Profile workbook returns"}


def _need(condition, message):
    if not condition:
        raise ValueError("Profile workbook Study: " + message)


def _same(left, right, message):
    _need(canonical(left) == canonical(right), message)


def _record(closure, kind, key):
    key = identifier(key)
    value = closure.read(kind + "/" + key + ".json")
    _need(value.get("schema") == "upstate." + kind + "/v1" and digest(value) == key,
          "an original " + kind + " record changed")
    return {**value, "id": key}


def _optional(closure, name):
    path = closure.root / name
    return closure.read(name) if path.exists() or path.is_symlink() else None


def _descriptor(closure, descriptor, *, prefix=None):
    _need(isinstance(descriptor, dict), "an original member descriptor is missing")
    name = descriptor.get("path")
    _need(isinstance(name, str) and name and "\\" not in name, "an original member needs its relative path")
    path = PurePosixPath(name)
    _need(not path.is_absolute() and ".." not in path.parts and str(path) == name
          and name != ".", "an original member leaves its Workspace")
    _need(prefix is None or name.startswith(prefix), "a returned member leaves its original operation")
    closure.add_file(name, descriptor)
    return name


def _source_refs(closure, value):
    if isinstance(value, dict):
        for name in ("source_collection_id", "original_source_collection_id", "collection_id"):
            candidate = value.get(name)
            if isinstance(candidate, str) and len(candidate) == 64:
                closure.need("sources", identifier(candidate), "Original workbook and coefficient source ancestry")
        for child in value.values():
            if isinstance(child, (dict, list)):
                _source_refs(closure, child)
    elif isinstance(value, list):
        for child in value:
            _source_refs(closure, child)


def _index(closure, kind, pattern="*.json"):
    cache = getattr(closure, "_profile_workbook_index", None)
    if cache is None:
        cache = {}
        closure._profile_workbook_index = cache
    token = (kind, pattern)
    if token not in cache:
        cache[token] = [(path, read_json(path))
                        for path in sorted((closure.root / kind).glob(pattern))]
    return cache[token]


def _profile_history(closure, profile_id, ancestors=()):
    """Capture native edits, current review prefix and original sourced choices."""
    queue = [identifier(profile_id), *[identifier(key) for key in ancestors]]
    seen, rows, sets, captured_sets = set(), {}, set(), set()
    locks = {".profile-editions.lock"}
    while queue:
        key = queue.pop()
        if key in seen:
            continue
        seen.add(key)
        profile = _record(closure, "profiles", key)
        closure.need("profiles", key, "Saved Profile and original edit ancestry")
        _source_refs(closure, profile)
        edition = profile.get("profile_edition") or {}
        derivation = profile.get("experiment_derivation") or {}
        for parent in (edition.get("base_profile_id"), edition.get("materialized_profile_id"),
                       derivation.get("base_profile_id")):
            if parent:
                queue.append(identifier(parent))
        editions = []
        for path, candidate in _index(closure, "profile-editions"):
            if candidate.get("profile_id") != key:
                continue
            saved = _record(closure, "profile-editions", path.stem)
            _need(saved["table"]["source_collection_id"] == profile["source_collection_id"]
                  and saved["table"]["biophysical_source_id"] == profile["biophysical_source_id"]
                  and saved["table"]["sha256"] == profile["table_summary"]["sha256"],
                  "an original profile edition changed its coefficient binding")
            _source_refs(closure, saved)
            closure._descriptors(saved.get("files", {}))
            editions.append(saved["id"])
            for parent in (saved.get("base_profile_id"), saved.get("materialized_profile_id")):
                if parent:
                    queue.append(identifier(parent))
            if saved.get("source_profile_set_id"):
                sets.add(identifier(saved["source_profile_set_id"]))
        for source_set in (edition.get("source_profile_set_id"), derivation.get("profile_set_id")):
            if source_set:
                sets.add(identifier(source_set))
        head = _optional(closure, "profile-review-heads/" + key + ".json")
        current = None if head is None else identifier(head.get("review_id"))
        _need(head is None or head.get("profile_id") == key, "a review head belongs to another Profile")
        reviews, walked = [], set()
        while current:
            _need(current not in walked, "the original review chain contains a cycle")
            walked.add(current)
            review = _record(closure, "profile-reviews", current)
            _need(review["profile_id"] == key
                  and review["table_sha256"] == profile["table_summary"]["sha256"],
                  "an original review changed its Profile or coefficient binding")
            reviews.append(current)
            operation = review.get("operation_id")
            if operation:
                receipt = _optional(closure, "profile-review-operations/" + identifier(operation) + ".json")
                _need(receipt is None or (receipt.get("review_id") == current
                      and receipt.get("request_sha256") == review["request_sha256"]),
                      "an original review operation changed its accepted result")
            current = review.get("previous_review_id")
            if current:
                identifier(current)
        rows[key] = {"profile_id": key, "edition_ids": sorted(editions),
                     "review_ids": list(reversed(reviews))}
        # These operation files retain the original requested edits and their
        # first accepted result, including interrupted continuation context.
        for path, result in _index(closure, "profile-edition-operations", "*/result.json"):
            if result.get("profile_id") != key:
                continue
            result = closure.read(path.relative_to(closure.root).as_posix())
            _need(result.get("edition_id") in editions, "a Profile operation lost its original edition")
            prefix = path.parent.relative_to(closure.root).as_posix()
            operation = closure.read(prefix + "/operation.json")
            _need(operation.get("request_sha256") == result.get("request_sha256"),
                  "an original Profile operation changed its request")
            closure._descriptors(result.get("files", {}))
            closure.tree(prefix)
        # A materialized choice set carries all of its original profiles so its
        # saved native state can resume and reopen without a partial cohort.
        while sets:
            set_id = sets.pop()
            if set_id in captured_sets:
                continue
            captured_sets.add(set_id)
            prefix = "sourced-profiles/" + set_id
            selection = closure.read(prefix + "/selection.json")
            state = closure.read(prefix + "/state.json")
            _need(selection.get("id") == set_id and state.get("id") == set_id
                  and state.get("workspace_id") == closure.workspace.project["id"],
                  "the original sourced Profile choice set changed")
            closure.tree(prefix)
            locks.add(prefix + "/.profiles.lock")
            _source_refs(closure, selection)
            _source_refs(closure, state)
            for item in state.get("profiles", []):
                queue.append(identifier(item["profile_id"]))
    return [rows[key] for key in sorted(rows)], locks


def _result_identity(workspace, key, result):
    _need(result.get("schema") == SCHEMA and result.get("id") == key
          and result.get("project_id") == workspace.project["id"]
          and digest({"operation_id": result.get("operation_id")}) == key,
          "the immutable return identity changed")


def visit(closure, kind, key, result):
    if kind != KIND:
        return False
    key = identifier(key)
    _result_identity(closure.workspace, key, result)
    prefix = KIND + "/" + key + "/"
    pins = getattr(closure, "profile_workbook_return_selection", None)
    pinned = next((row for row in pins if row.get("return_id") == key), None) if pins is not None else None
    _need(pins is None or pinned is not None, "the received Study omitted its original workbook return")
    intent = closure.read(prefix + "intent.json")
    _need(intent.get("schema") == SCHEMA and intent.get("id") == key
          and intent.get("project_id") == result["project_id"]
          and intent.get("operation_id") == result["operation_id"]
          and intent.get("request_sha256") == result["request_sha256"]
          and digest(intent.get("request")) == result["request_sha256"],
          "the original return request and first result differ")
    _same(intent.get("context"), result.get("context"), "the retained original operator context changed")
    for descriptor in result["files"].values():
        _descriptor(closure, descriptor, prefix=prefix)
    for name, descriptor in intent["implementation"].items():
        _descriptor(closure, descriptor, prefix=prefix)
        _same(result["files"].get("implementation_" + name), descriptor,
              "the returned implementation differs from the original operation")
    preview_name = result["files"]["preview"]["path"]
    preview = closure.read(preview_name)
    _need(preview.get("schema") == SCHEMA and preview.get("project_id") == result["project_id"]
          and preview.get("preview_sha256") == result["preview_sha256"]
          and digest({name: value for name, value in preview.items() if name != "preview_sha256"})
              == result["preview_sha256"], "the original complete cell preview changed")
    _same(intent["request"], {**preview["selection"], "preview_sha256": result["preview_sha256"]},
          "the return request no longer selects its original preview")
    _same(closure.read(result["files"]["selection"]["path"]), intent["request"],
          "the downloadable selection changed")
    for name in ("mapped_count", "changed_cell_count", "excluded_count"):
        _same(result[name], preview[name], "the saved return count differs from its preview")
    _same(result["workbook"], preview["workbook"], "the original workbook binding changed")
    profile_id = identifier(result["profile_id"])
    original = _record(closure, "profiles", profile_id)
    _same(original, preview["profile"], "the exact saved Profile changed")
    original_profile_file = closure.files["profiles/" + profile_id + ".json"]
    _need(original_profile_file["sha256"] == preview["profile_sha256"],
          "the exact original Profile JSON bytes changed")
    _need(result["files"]["profile"]["sha256"] == preview["profile_sha256"],
          "the downloadable saved Profile differs from its original")
    _same(closure.read(result["files"]["profile"]["path"]), {name: value for name, value in original.items() if name != "id"},
          "the downloadable Profile record changed")
    _need(result["files"]["coefficients"]["sha256"] == preview["table_sha256"]
          == original["table_summary"]["sha256"], "the returned coefficient table changed")
    book = result["workbook"]
    collection = _record(closure, "sources", book["source_collection_id"])
    entries = [item for item in collection["entries"] if item["id"] == book["source_id"]]
    _need(len(entries) == 1, "the original workbook source entry is missing")
    parts = [entries[0]["body"], *entries[0].get("companions", [])]
    _need(type(book["part"]) is int and 0 <= book["part"] < len(parts), "the original workbook part changed")
    original_book = parts[book["part"]]
    _need(original_book["sha256"] == book["sha256"] == result["files"]["original_workbook"]["sha256"]
          and original_book["bytes"] == result["files"]["original_workbook"]["bytes"],
          "the retained original workbook differs from its source")
    _source_refs(closure, preview)
    ancestors = set()
    for item in preview.get("source_ancestry", []):
        source_collection = _record(closure, "sources", item["source_collection_id"])
        matching = [entry for entry in source_collection["entries"] if entry["id"] == item["source_id"]]
        _need(len(matching) == 1 and matching[0]["body"]["sha256"] == item["sha256"],
              "an original coefficient ancestor changed")
        _same(matching[0], item["source"], "the captured source ancestry differs from its original entry")
        derivation = matching[0].get("derivation") or {}
        if derivation.get("schema") == "upstate.biophysical-derivation/v1":
            ancestors.add(identifier(derivation["base_profile_id"]))
    package = closure.read(result["files"]["package_review"]["path"])
    _need(package["original_sha256"] == book["sha256"]
          and package["sha256"] == result["files"]["derived_workbook"]["sha256"]
          and package["bytes"] == result["files"]["derived_workbook"]["bytes"],
          "the derived workbook member review changed")
    histories, locks = _profile_history(closure, profile_id, ancestors)
    closure.tree(prefix.rstrip("/"))
    row = {"return_id": key, "profile_id": profile_id, "operation_id": result["operation_id"],
           "result_sha256": closure.files[prefix + "result.json"]["sha256"],
           "intent_sha256": closure.files[prefix + "intent.json"]["sha256"],
           "preview_sha256": result["preview_sha256"], "profile_history": histories}
    if pinned is not None:
        for name in ("return_id", "profile_id", "operation_id", "result_sha256", "intent_sha256", "preview_sha256"):
            _same(row[name], pinned[name], "the received original return changed")
        current = {item["profile_id"]: item for item in histories}
        for old in pinned["profile_history"]:
            found = current.get(old["profile_id"])
            _need(found is not None and set(old["edition_ids"]).issubset(found["edition_ids"])
                  and found["review_ids"][:len(old["review_ids"])] == old["review_ids"],
                  "the received original Profile history lost its captured prefix")
        row = deepcopy(pinned)
    records = getattr(closure, "profile_workbook_return_records", None)
    if records is None:
        records = {}
        closure.profile_workbook_return_records = records
        closure.profile_workbook_return_locks = set()
    records[key] = row
    closure.profile_workbook_return_locks.update(locks | {prefix + ".operation.lock"})
    closure.nodes[(kind, key)].update(state="saved", profile_id=profile_id,
                                    changed_cells=result["changed_cell_count"])
    return True


def related(closure):
    profiles = {key for kind, key in closure.nodes if kind == "profiles"}
    if not profiles:
        return
    pins = getattr(closure, "profile_workbook_return_selection", None)
    if pins is not None:
        candidates = [(row["return_id"], row["profile_id"]) for row in pins]
    else:
        candidates = [(path.parent.name, value.get("profile_id"))
                      for path, value in _index(closure, KIND, "*/result.json")]
    for key, profile_id in candidates:
        if profile_id in profiles:
            closure.need(KIND, identifier(key), "Saved workbook return for the selected Profile")


def receipt(closure):
    return [deepcopy(row) for _, row in sorted(
        getattr(closure, "profile_workbook_return_records", {}).items())]


def verify_receipt(closure, expected):
    _same(receipt(closure), expected, "the received Study changed its original workbook returns")


def lock_paths(closure):
    return sorted(getattr(closure, "profile_workbook_return_locks", set()))


def catalogue(workspace):
    rows = []
    for path in sorted((workspace.root / KIND).glob("*/result.json")):
        key, result = identifier(path.parent.name), read_json(path)
        _result_identity(workspace, key, result)
        rows.append({"kind": KIND, "id": key, "title": result["title"], "state": "saved",
                     "updated_at": result["created_at"], "profile_id": result["profile_id"],
                     "changed_cells": result["changed_cell_count"],
                     "original_workbook": result["workbook"]["filename"]})
    return rows
