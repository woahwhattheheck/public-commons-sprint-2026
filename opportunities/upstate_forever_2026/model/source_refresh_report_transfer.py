"""Typed editable Study closure for an original Source Updates report source.

The report's scientific snapshot stays frozen. A same-project Study additionally
retains the original saved plan and its current coherent editable checkpoint.
"""
from __future__ import annotations

from copy import deepcopy
from pathlib import PurePosixPath

from .common import digest, identifier
from . import source_refresh, source_refresh_report_source as producer
from .source_refresh_receiving import _Receiving


def _relative(value):
    if not isinstance(value, str) or "\\" in value or "\0" in value:
        raise ValueError("Source-update report members need original relative paths")
    path = PurePosixPath(value)
    if (path.is_absolute() or not path.parts or ".." in path.parts
            or path.as_posix() != value):
        raise ValueError("Source-update report member escapes its original source")
    return value


def _state_directory(engine, plan_id):
    if engine not in ("edition", "roots"):
        raise ValueError("Unknown original source-update engine")
    return ("source-refresh/" if engine == "edition" else "source-refreshes/") + identifier(plan_id)


def _same(actual, expected):
    return all(actual.get(key) == expected.get(key) for key in ("bytes", "sha256"))


def _read_body(closure, item):
    path = _relative(item["object"])
    closure.add_file(path, item)
    return closure.read(path)


def _capture(closure, entry):
    recipe = _read_body(closure, entry["body"])
    origin = recipe.get("origin") or {}
    if (entry.get("kind") != "document" or recipe.get("schema") != "upstate.observed-report/v1"
            or origin.get("schema") != producer.SCHEMA
            or (entry.get("metadata") or {}).get("origin") != origin):
        raise ValueError("The saved source-update report differs from its producer identity")
    key = identifier(origin.get("id"))
    identifier(origin.get("plan_id"))
    members = {}
    for item in entry.get("companions", []):
        name = _relative(item.get("view_path", item["filename"]))
        if name in members:
            raise ValueError("A source-update report companion is repeated")
        members[name] = item
    inputs = recipe.get("inputs")
    if not isinstance(inputs, list) or len(inputs) != len(members):
        raise ValueError("The source-update report lost its original companion roster")
    seen = set()
    for item in inputs:
        name = _relative(item["path"])
        if name in seen or name not in members or not _same(item, members[name]):
            raise ValueError("The source-update report lost an original companion: " + name)
        seen.add(name)
    required = {"scientific-snapshot.json", "original-plan.json",
                "captured-checkpoint.json", "capture.json"}
    if not required.issubset(members):
        raise ValueError("The source-update report lacks its original scientific capture")
    data = {name: _read_body(closure, members[name]) for name in sorted(required)}
    snapshot, capture = data["scientific-snapshot.json"], data["capture.json"]
    identity = capture.get("selection")
    if (capture.get("schema") != producer.SCHEMA or capture.get("id") != key
            or not isinstance(identity, dict) or digest(identity) != key
            or identity.get("scientific") != snapshot
            or identity.get("project_id") != origin.get("project_id")
            or identity.get("edition") != recipe.get("edition")
            or identity.get("selection", {}).get("title") != recipe.get("title")
            or identity["selection"].get("plan_id") != origin["plan_id"]
            or snapshot.get("schema") != producer.SNAPSHOT_SCHEMA
            or snapshot.get("project_id") != origin["project_id"]
            or snapshot.get("plan_id") != origin["plan_id"]
            or digest(snapshot) != origin.get("scientific_sha256")
            or snapshot.get("engine") != origin.get("engine")
            or snapshot.get("format") != origin.get("format")
            or snapshot.get("plan") != data["original-plan.json"]
            or capture.get("checkpoint") != data["captured-checkpoint.json"]):
        raise ValueError("The source-update report differs from its immutable scientific capture")
    return recipe, origin, members, snapshot, capture


def _local(closure, collection_id, entry, recipe, origin, members, snapshot, capture):
    ws = closure.workspace
    key, plan_id = origin["id"], origin["plan_id"]
    prefix = producer.DIRECTORY + "/" + key + "/"
    receipt = closure.read(prefix + "receipt.json")
    if (receipt.get("schema") != producer.SCHEMA or receipt.get("state") != "complete"
            or receipt.get("id") != key or receipt.get("selection") != capture["selection"]
            or receipt.get("source", {}).get("source_id") != entry["id"]
            or receipt.get("plan_id") != plan_id):
        raise ValueError("The editable source-update report lost its original receipt")
    original_choice = receipt["source"]
    original_collection = identifier(original_choice["source_collection_id"])
    collection = closure.read("sources/" + original_collection + ".json")
    if digest(collection) != original_collection:
        raise ValueError("The original imported report collection changed")
    originals = [row for row in collection["entries"] if row["id"] == entry["id"]]
    if len(originals) != 1 or not _same(originals[0]["body"], entry["body"]):
        raise ValueError("The editable report lost its original imported recipe")
    original_members = {_relative(row.get("view_path", row["filename"])): row
                        for row in originals[0].get("companions", [])}
    if (set(original_members) != set(members)
            or any(not _same(original_members[name], item) for name, item in members.items())):
        raise ValueError("The editable report companion roster changed")
    retained = receipt.get("members", {})
    if set(retained) != set(members):
        raise ValueError("The original report member roster changed")
    for name, item in retained.items():
        if item.get("path") != prefix + name or not _same(item, members[name]):
            raise ValueError("The editable report differs from its imported member: " + name)
        closure.add_file(item["path"], item)
    for item in receipt["files"].values():
        if not _relative(item["path"]).startswith(prefix):
            raise ValueError("The report receipt points outside its original capture")
        closure.add_file(item["path"], item)
    if (not _same(receipt["files"]["recipe"], entry["body"])
            or closure.read(receipt["files"]["recipe"]["path"]) != recipe):
        raise ValueError("The original report recipe changed")
    closure.tree(prefix.rstrip("/"))
    required = {("sources", original_collection)}
    receiver = _Receiving(ws)
    for source_id, captured in snapshot["sources"].items():
        if receiver.collection(source_id) != captured:
            raise ValueError("An original source edition changed after report capture")
        required.add(("sources", source_id))
    for kind, values in snapshot["native"].items():
        for native_id, captured in values.items():
            actual = producer.native_snapshot(kind, receiver.native(kind, native_id))
            if kind == "runs" and captured.get("state") != "complete":
                # An original unfinished reference may finish after the report;
                # its saved scientific selection still identifies the same case.
                same = actual["selection"] == captured["selection"]
            else:
                same = actual == captured
            if not same:
                raise ValueError("An original scientific result changed after report capture: " +
                                 kind + "/" + native_id)
            required.add((kind, native_id))
    actual_plan = source_refresh.validate_plan(ws, plan_id)
    if actual_plan != snapshot["plan"]:
        raise ValueError("The editable source update differs from its captured immutable plan")
    current = source_refresh.get_plan(ws, plan_id)
    if current["engine"] != snapshot["engine"] or current["format"] != snapshot["format"]:
        raise ValueError("The original source-update engine identity changed")
    current_mappings = (current.get("state") or {}).get("mappings", {})
    for kind, mappings in snapshot["mappings"].items():
        for old_id, new_id in mappings.items():
            if (current_mappings.get(kind) or {}).get(old_id) != new_id:
                raise ValueError("The original source-update successor mapping changed")
    for comparison_id, captured in snapshot["comparisons"].items():
        path = "comparisons/" + identifier(comparison_id) + "/comparison.json"
        actual = closure.read(path)
        if actual != captured:
            raise ValueError("The source-update comparison changed after report capture")
        required.add(("comparisons", comparison_id))
    closure.add_file("source-refresh-plans/" + plan_id + ".json")
    # Both original engines use closed regular checkpoint files here. The roots
    # engine explicitly uses SQLite DELETE journal mode. lock_paths freezes its
    # writer before the original Study's second closure read and staging.
    closure.tree(_state_directory(snapshot["engine"], plan_id))
    for kind, native_id in sorted(required):
        closure.need(kind, native_id, "Original editable source-update report dependency")
    return [{"kind": kind, "id": native_id} for kind, native_id in sorted(required)]


def include_source(closure, collection_id, entry):
    if (entry.get("metadata") or {}).get("source_kind") != producer.SOURCE_KIND:
        return False
    identifier(collection_id)
    recipe, origin, members, snapshot, capture = _capture(closure, entry)
    local = origin["project_id"] == closure.workspace.project["id"]
    required = (_local(closure, collection_id, entry, recipe, origin, members, snapshot, capture)
                if local else [])
    record = {
        "schema": "upstate.study-report-lineage/v1",
        "source_collection_id": collection_id, "source_id": entry["id"],
        "source_body_sha256": entry["body"]["sha256"],
        "source_project_id": origin["project_id"],
        "report_context_kind": "source_refresh",
        "source_refresh_report_source_id": origin["id"],
        "source_refresh_plan_id": origin["plan_id"], "engine": origin["engine"],
        "format": origin["format"], "producer_edition": recipe["edition"],
        "scientific_sha256": origin["scientific_sha256"],
        "selection": deepcopy(capture["selection"]["selection"]),
        "from_collection_id": snapshot["from_collection_id"],
        "to_collection_id": snapshot["to_collection_id"],
        "mappings": deepcopy(snapshot["mappings"]),
        "captured_checkpoint_sha256": digest(capture["checkpoint"]),
        "checkpoint_relationship": "Frozen report capture; current coherent editable plan retained separately",
        "relationship": "same_project" if local else "external_project",
        "required_records": required,
        "original_members": {name: item["sha256"] for name, item in sorted(members.items())},
    }
    token = (collection_id, entry["id"])
    previous = closure.report_source_records.get(token)
    if previous is not None and previous != record:
        raise ValueError("The source-update report lineage changed during Study selection")
    closure.report_source_records[token] = record
    return True


def lock_paths(closure):
    return sorted({
        _state_directory(row["engine"], row["source_refresh_plan_id"]) + "/.refresh.lock"
        for row in closure.report_source_records.values()
        if row.get("report_context_kind") == "source_refresh"
        and row.get("relationship") == "same_project"
    })
