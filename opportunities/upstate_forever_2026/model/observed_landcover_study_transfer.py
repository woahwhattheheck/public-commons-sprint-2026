"""Retain editable original selected-HUC comparisons in scientific Study exports.

The existing Study closure captures raw CAS bodies and exact saved records. This
adapter does not rebuild comparisons, render figures, or open raster datasets.
"""
from __future__ import annotations

from copy import deepcopy
from pathlib import PurePosixPath

from .common import digest, identifier

KIND = "observed-landcover-selections"
SCHEMA = "upstate.observed-landcover-selection/v1"
REPORT_SCHEMA = "upstate.observed-report/v1"
EDITION = "original-huc-nlcd-selection/1"


def _require(condition, message):
    if not condition:
        raise ValueError(message)


def _relative(value):
    _require(isinstance(value, str) and "\\" not in value and "\0" not in value,
             "Selected watershed members need original relative paths")
    path = PurePosixPath(value)
    _require(not path.is_absolute() and bool(path.parts) and ".." not in path.parts
             and path.as_posix() == value and all(":" not in part for part in path.parts),
             "Selected watershed member escapes its original directory")
    return value


def _same(first, second):
    return all(first.get(name) == second.get(name) for name in ("bytes", "sha256"))


def _body(closure, descriptor):
    closure.add_file(descriptor["object"], descriptor)
    return closure.read(descriptor["object"])


def _members(closure, entry, recipe):
    members = {}
    for descriptor in entry.get("companions", []):
        path = _relative(descriptor.get("view_path", descriptor["filename"]))
        _require(path not in members, "Selected watershed source repeats a companion")
        closure.add_file(descriptor["object"], descriptor)
        members[path] = descriptor
    requested = recipe.get("inputs")
    _require(isinstance(requested, list) and bool(requested),
             "Selected watershed report lacks its original input inventory")
    declared = {}
    for descriptor in requested:
        path = _relative(descriptor["path"])
        _require(path not in declared and path in members and _same(descriptor, members[path]),
                 "Selected watershed report lost an exact original input: " + path)
        declared[path] = descriptor
    _require(set(declared) == set(members),
             "Selected watershed report companion inventory differs")
    return members


def _captured(closure, collection_id, entry):
    recipe = _body(closure, entry["body"])
    origin = recipe.get("origin", {})
    key = identifier(origin.get("id"))
    project_id = origin.get("project_id")
    _require(entry.get("kind") == "document" and entry.get("role") == "OBSERVED_CONTEXT"
             and recipe.get("schema") == REPORT_SCHEMA and recipe.get("edition") == EDITION
             and origin.get("kind") == KIND
             and (entry.get("metadata") or {}).get("origin") == origin
             and isinstance(project_id, str) and bool(project_id)
             and entry.get("id") == "selected-huc-landcover-" + key
             and entry.get("uri") == "workspace://" + project_id + "/" + KIND + "/" + key,
             "Selected watershed report differs from its original producer")
    members = _members(closure, entry, recipe)

    def original(name):
        _require(name in members, "Selected watershed report lacks " + name)
        return _body(closure, members[name])

    report = original("selection.json")
    binding = original("original-inputs.json")
    selection = report.get("selection", {})
    hucs = selection.get("huc12s")
    _require(report.get("schema") == SCHEMA and report.get("edition") == EDITION
             and report.get("title") == recipe.get("title")
             and report.get("binding") == binding
             and isinstance(hucs, list) and bool(hucs)
             and all(isinstance(huc, str) and len(huc) == 12 and huc.isascii()
                     and huc.isdigit() for huc in hucs)
             and hucs == sorted(set(hucs)) and origin.get("huc12s") == hucs
             and origin.get("area_method") == "original_native_cell_centre"
             and [row.get("huc12") for row in report.get("watersheds", [])] == hucs,
             "Selected watershed report changed its original selection or support")
    for field in ("source_collection_id", "analysis_source_id", "analysis_sha256"):
        _require(selection.get(field) == binding.get(field),
                 "Selected watershed report changed its original " + field)
    identifier(binding["source_collection_id"])
    identifier(binding["analysis_sha256"])
    identifier(binding["source_domain_sha256"])
    originals = binding.get("inputs")
    _require(isinstance(originals, list) and len(originals) == 4,
             "Selected watershed report needs its four original completed input records")
    roster = {}
    for index, row in enumerate(originals):
        collection = identifier(row["source_collection_id"])
        source_id = row["source_id"]
        original_entry = row["entry"]
        _require(isinstance(source_id, str) and bool(source_id)
                 and original_entry.get("id") == source_id
                 and collection == binding["source_collection_id"],
                 "Selected watershed input changed its original collection or source")
        token = (collection, source_id)
        _require(token not in roster, "Selected watershed report repeats an original input")
        roster[token] = original_entry
        for descriptor in [original_entry["body"], *original_entry.get("companions", [])]:
            name = "originals/" + str(index) + "/" + _relative(
                descriptor.get("view_path", descriptor["filename"]))
            _require(name in members and _same(descriptor, members[name]),
                     "Selected watershed report lost an original input body: " + name)
    analysis = roster.get((binding["source_collection_id"], binding["analysis_source_id"]))
    _require(analysis is not None
             and analysis["body"]["sha256"] == binding["analysis_sha256"],
             "Selected watershed report lost its exact original analysis-run identity")
    return origin, recipe, members, report, binding, roster


def _local(closure, entry, origin, recipe, members, report, binding, roster):
    key = origin["id"]
    prefix = KIND + "/" + key + "/"
    receipt = closure.read(prefix + "receipt.json")
    identity = receipt.get("identity", {})
    _require(receipt.get("schema") == SCHEMA and receipt.get("state") == "complete"
             and receipt.get("id") == key == digest(identity)
             and receipt.get("project_id") == origin["project_id"]
             and identity.get("project_id") == origin["project_id"]
             and identity.get("edition") == EDITION
             and identity.get("title") == receipt.get("title") == report["title"]
             and identity.get("selection") == report["selection"]
             and identity.get("binding") == binding
             and receipt.get("huc12s") == report["selection"]["huc12s"]
             and receipt.get("summary") == report.get("summary"),
             "Editable selected watershed receipt differs from its captured report")
    identifier(identity.get("producer_sha256"))
    files = receipt.get("files")
    _require(isinstance(files, dict) and bool(files),
             "Editable selected watershed comparison lacks its original files")
    extras = {"observed-report.json", "sources.json", "selected-huc-landcover.zip"}
    _require(set(files) == set(members) | extras,
             "Editable selected watershed file inventory changed")
    for name, descriptor in files.items():
        name = _relative(name)
        _require(descriptor.get("path") == prefix + name,
                 "Editable selected watershed file belongs to another comparison")
        if name in members:
            _require(_same(descriptor, members[name]),
                     "Editable selected watershed file differs from its captured source")
        closure.add_file(descriptor["path"], descriptor)
    _require(_same(files["observed-report.json"], entry["body"])
             and closure.read(prefix + "observed-report.json") == recipe
             and closure.read(prefix + "selection.json") == report
             and closure.read(prefix + "original-inputs.json") == binding,
             "Editable selected watershed originals differ from their report source")

    source = receipt["source"]
    source_collection = identifier(source["source_collection_id"])
    collection = closure.read("sources/" + source_collection + ".json")
    retained = [row for row in collection.get("entries", [])
                if row.get("id") == source.get("source_id")]
    _require(collection.get("schema") == "upstate.sources/v1"
             and digest(collection) == source_collection
             and source.get("source_id") == entry["id"] and len(retained) == 1
             and _same(retained[0]["body"], entry["body"]),
             "Editable selected watershed comparison lost its original report collection")
    native_members = {}
    for descriptor in retained[0].get("companions", []):
        name = _relative(descriptor.get("view_path", descriptor["filename"]))
        _require(name not in native_members, "Original selected report repeats a companion")
        native_members[name] = descriptor
    _require(set(native_members) == set(members)
             and all(_same(native_members[name], item) for name, item in members.items()),
             "Editable selected watershed report changed its captured companion set")
    observed_binding = receipt.get("observed_binding")
    # The ordinary observed binding uses its formatter binding edition rather
    # than this producer's edition. Compare its complete source/member portion.
    _require(isinstance(observed_binding, dict)
             and observed_binding.get("schema") == "upstate.observed-report-binding/v1"
             and isinstance(observed_binding.get("edition"), str)
             and bool(observed_binding["edition"])
             and observed_binding.get("source_collection_id") == source_collection
             and observed_binding.get("source_id") == entry["id"]
             and observed_binding.get("body_sha256") == entry["body"]["sha256"]
             and observed_binding.get("member_sha256") == {
                 **{name: item["sha256"] for name, item in native_members.items()},
                 _relative(retained[0]["body"].get("view_path", retained[0]["body"]["filename"])):
                     retained[0]["body"]["sha256"]},
             "Editable selected watershed scientific binding differs")
    required = {source_collection}
    for (collection_id, source_id), original in roster.items():
        current = closure.read("sources/" + collection_id + ".json")
        choices = [row for row in current.get("entries", []) if row.get("id") == source_id]
        _require(current.get("schema") == "upstate.sources/v1" and digest(current) == collection_id
                 and choices == [original],
                 "Editable selected watershed input differs from the captured original")
        required.add(collection_id)
        from .observed_landcover_local_copy import include_input
        include_input(closure, original)
    for collection_id in sorted(required):
        closure.need("sources", collection_id, "Original selected-watershed analysis or report collection")
    # The existing closure records every member and detects directory changes.
    closure.tree(prefix.rstrip("/"))
    return [{"kind": "sources", "id": value} for value in sorted(required)]


def include_source(closure, collection_id, entry):
    """Join only this exact producer behind an explicitly selected report."""
    if (entry.get("metadata") or {}).get("source_kind") != KIND:
        return False
    identifier(collection_id)
    origin, recipe, members, report, binding, roster = _captured(closure, collection_id, entry)
    local = origin["project_id"] == closure.workspace.project["id"]
    required = _local(closure, entry, origin, recipe, members, report, binding, roster) if local else []
    lineage = {
        "schema": "upstate.study-report-lineage/v1",
        "source_collection_id": collection_id,
        "source_id": entry["id"],
        "source_body_sha256": entry["body"]["sha256"],
        "source_project_id": origin["project_id"],
        "report_context_kind": "observed_landcover_selection",
        "observed_landcover_selection_id": origin["id"],
        "producer_edition": recipe["edition"],
        "relationship": "same_project" if local else "external_project",
        "required_records": required,
        "selection": deepcopy(report["selection"]),
        "area_method": origin["area_method"],
        "original_input_sources": [
            {"source_collection_id": collection_id, "source_id": source_id,
             "body_sha256": original["body"]["sha256"]}
            for (collection_id, source_id), original in roster.items()
        ],
        "original_members": {name: members[name]["sha256"] for name in sorted(members)},
    }
    token = (collection_id, entry["id"])
    previous = closure.report_source_records.get(token)
    _require(previous is None or previous == lineage,
             "Selected watershed lineage changed during Study selection")
    closure.report_source_records[token] = lineage
    return True
