"""Retain the native saved cohort behind an explicitly selected scientific report.

The source's own origin selects one immutable comparison. No original rows are
recalculated and no source-view links are created during Study capture.
"""
from __future__ import annotations

from copy import deepcopy
from pathlib import PurePosixPath

from .common import digest, identifier
from . import observed_context
from . import observation_comparability_store as comparisons

ORIGIN_SCHEMA = "upstate.observation-comparability-origin/v1"
LINEAGE_SCHEMA = "upstate.study-report-lineage/v1"
CONTEXT_KIND = "observation_comparability"


def _require(value, message):
    if not value:
        raise ValueError(message)


def _relative(value):
    _require(isinstance(value, str) and value and "\\" not in value and "\0" not in value,
             "A saved comparison needs an original relative member path")
    path = PurePosixPath(value)
    _require(not path.is_absolute() and path.as_posix() == value
             and not any(part in (".", "..") or ":" in part for part in path.parts),
             "Keep comparison members inside their original saved directory")
    return value


def origin(entry):
    metadata = entry.get("metadata") or {}
    if metadata.get("source_kind") != comparisons.calculation.SCHEMA:
        return None
    value = metadata.get("native_comparability")
    if value is None:
        # Original standalone/v1 sources remain usable as source-only reports.
        return None
    _require(isinstance(value, dict)
             and set(value) == {"schema", "project_id", "selection_id"}
             and value["schema"] == ORIGIN_SCHEMA
             and isinstance(value["project_id"], str) and value["project_id"],
             "The cohort source has an unreadable original native comparison binding")
    identifier(value["selection_id"])
    return deepcopy(value)


def _entry_members(entry):
    members = {}
    for descriptor in [entry["body"], *entry.get("companions", [])]:
        name = _relative(descriptor.get("view_path", descriptor["filename"]))
        _require(name not in members, "The cohort source repeats an original member")
        members[name] = descriptor
    return members


def _local(closure, collection_id, entry, native):
    key = native["selection_id"]
    prefix = comparisons.KIND + "/" + key + "/"
    receipt = closure.read(prefix + "receipt.json")
    identity = receipt.get("identity")
    source = {"source_collection_id": collection_id, "source_id": entry["id"]}
    _require(receipt.get("schema") == comparisons.SCHEMA
             and receipt.get("state") == "complete"
             and receipt.get("project_id") == closure.workspace.project["id"]
             and receipt.get("id") == key and isinstance(identity, dict)
             and digest(identity) == key
             and identity.get("project_id") == receipt["project_id"]
             and receipt.get("selection") == identity.get("selection")
             and receipt.get("source") == source,
             "The selected scientific source lost its exact completed native comparison")
    selection = receipt["selection"]
    binding = identity.get("binding")
    _require(isinstance(binding, dict)
             and selection.get("source") == binding.get("source")
             and selection.get("binding_sha256") == digest(binding)
             and identity.get("producers") == selection.get("producers")
             and receipt.get("title") == selection.get("title"),
             "The saved comparison changed its original cohort, title or producer binding")
    comparisons._choice(selection["source"])
    planned = closure.read(prefix + "build.json")
    files = receipt.get("files")
    planned_files = planned.get("files")
    _require(planned.get("identity") == identity
             and planned.get("counts") == receipt.get("counts")
             and isinstance(files, dict) and isinstance(planned_files, dict)
             and files and set(files) == set(planned_files),
             "The saved comparison's complete output inventory changed")
    for name, item in files.items():
        local_name = _relative(name)
        original = planned_files[name]
        _require(original.get("path") == local_name
                 and item.get("path") == prefix + local_name
                 and all(item.get(field) == original.get(field) for field in ("bytes", "sha256")),
                 "The saved comparison member differs from its original build")
        closure.add_file(prefix + local_name, item)
    data = closure.read(prefix + "source/comparability.json")
    _require(data.get("schema") == comparisons.calculation.SCHEMA
             and data.get("counts") == receipt["counts"]
             and data.get("default_comparison") == {
                 "year_a": selection["year_a"], "year_b": selection["year_b"]}
             and data.get("presentation", {}).get("title") == selection["title"],
             "The saved comparison data differ from the selected source period")
    originals = data.get("original_inputs")
    _require(isinstance(originals, list) and originals
             and all(isinstance(row, dict) and isinstance(row.get("path"), str)
                     and row["path"].startswith("originals/") for row in originals),
             "Retain every original cohort input")
    _require([{**row, "path": row["path"][len("originals/"):]} for row in originals]
             == binding.get("originals"),
             "The saved comparison changed an original publisher response")
    members = _entry_members(entry)
    recipe_descriptor = files.get("source/observed-report.json")
    _require(isinstance(recipe_descriptor, dict)
             and all(entry["body"][field] == recipe_descriptor.get(field)
                     for field in ("bytes", "sha256")),
             "The selected report recipe differs from the saved comparison")
    recipe = closure.read(entry["body"]["object"])
    _require(recipe.get("schema") == observed_context.SCHEMA,
             "The selected comparison has a different original report schema")
    declared = {row["path"]: row for row in recipe.get("inputs", [])}
    companion_names = {row.get("view_path", row["filename"])
                       for row in entry.get("companions", [])}
    _require(len(declared) == len(recipe.get("inputs", []))
             and companion_names == set(declared),
             "The selected comparison source changed its original companion inventory")
    for name, descriptor in declared.items():
        saved = files.get("source/" + _relative(name))
        _require(saved is not None
                 and all(members[name].get(field) == descriptor.get(field) == saved.get(field)
                         for field in ("bytes", "sha256")),
                 "The selected cohort companion differs from its saved native output")
    expected_binding = {
        "schema": "upstate.observed-report-binding/v1",
        "source_collection_id": collection_id, "source_id": entry["id"],
        "body_sha256": entry["body"]["sha256"],
        "member_sha256": {name: members[name]["sha256"] for name in sorted(members)},
    }
    captured_binding = receipt.get("observed_binding")
    _require(isinstance(captured_binding, dict)
             and {name: value for name, value in captured_binding.items() if name != "edition"}
             == expected_binding,
             "The native comparison lost its exact original scientific source binding")
    retained_manifest = closure.read(prefix + "source/model-sources.json")
    entries = retained_manifest.get("entries")
    _require(retained_manifest.get("schema") == "upstate.sources/v1"
             and isinstance(entries, list) and len(entries) == 1
             and entries[0].get("id") == entry["id"]
             and origin(entries[0]) == native,
             "The native comparison source manifest changed its original origin")
    required = []
    original_choice = selection["source"]
    if original_choice["kind"] == "retained":
        original_collection = identifier(original_choice["source_collection_id"])
        record = closure.read("sources/" + original_collection + ".json")
        _require(record.get("schema") == "upstate.sources/v1" and digest(record) == original_collection,
                 "The comparison's selected original source collection changed")
        matches = [row for row in record["entries"] if row["id"] == original_choice["source_id"]]
        _require(len(matches) == 1
                 and matches[0]["body"]["sha256"] == original_choice["source_sha256"],
                 "The comparison lost its original retained input edition")
        closure.need("sources", original_collection, "Original cohort selected for saved comparison")
        required.append({"kind": "sources", "id": original_collection})
    # Completed build/receipt publication is immutable. Capture the complete
    # original directory, including the source ZIP and retained producer files.
    closure.tree(prefix.rstrip("/"))
    return {
        "id": key, "title": receipt["title"], "selection": deepcopy(selection),
        "counts": deepcopy(receipt["counts"]), "source": deepcopy(source),
        "receipt_sha256": closure.files[prefix + "receipt.json"]["sha256"],
        "build_sha256": closure.files[prefix + "build.json"]["sha256"],
        "files": deepcopy(files),
    }, required


def include_source(closure, collection_id, entry):
    native = origin(entry)
    if native is None:
        return False
    identifier(collection_id)
    local = native["project_id"] == closure.workspace.project["id"]
    comparison, required = _local(closure, collection_id, entry, native) if local else (None, [])
    members = _entry_members(entry)
    record = {
        "schema": LINEAGE_SCHEMA, "source_collection_id": collection_id,
        "source_id": entry["id"], "source_body_sha256": entry["body"]["sha256"],
        "source_project_id": native["project_id"], "report_context_kind": CONTEXT_KIND,
        "relationship": "same_project" if local else "external_project",
        "native_origin": native, "native_comparison": comparison,
        "required_records": required,
        "original_members": {name: members[name]["sha256"] for name in sorted(members)},
    }
    token = (collection_id, entry["id"])
    previous = closure.report_source_records.get(token)
    _require(previous is None or previous == record,
             "The original comparable-period lineage changed during Study selection")
    closure.report_source_records[token] = record
    return True


def summary(identity):
    rows = [row for row in identity.get("scientific_report_sources", [])
            if row.get("report_context_kind") == CONTEXT_KIND]
    return {"comparable_period_source_count": len(rows),
            "editable_comparison_count": sum(row.get("native_comparison") is not None for row in rows)}


def augment(closure, retained, result):
    """Expose only the native comparison editions captured by this exact Study."""
    result["comparable_period_sources"] = []
    for captured in retained["identity"].get("scientific_report_sources", []):
        if captured.get("report_context_kind") != CONTEXT_KIND:
            continue
        token = (captured["source_collection_id"], captured["source_id"])
        current = closure.report_source_records.get(token)
        _require(current == captured, "The received Study lost its original saved comparison")
        result["comparable_period_sources"].append(deepcopy(current))
