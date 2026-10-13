"""Retain the original Economic editions behind a selected scientific report.

This resolver uses the maintained Study closure. It reads completed originals,
pins every source descriptor, and never calculates costs, runs physical models,
creates source views or replaces a saved edition.
"""
from __future__ import annotations

from copy import deepcopy
from pathlib import PurePosixPath

from .common import digest, identifier
from . import observed_context

ORIGIN_SCHEMA = "upstate.economic-comparison-source/v1"
LINEAGE_SCHEMA = "upstate.study-report-lineage/v1"
CONTEXT_KIND = "economic-comparison"
COMPARISON_SCHEMA = "upstate.economic-comparison-result/v1"
EDITION_SCHEMA = "upstate.economic-edition/v1"


def _require(value, message):
    if not value:
        raise ValueError(message)


def _relative(value):
    _require(isinstance(value, str) and value and "\\" not in value and "\0" not in value,
             "An Economic study member needs its original relative path")
    path = PurePosixPath(value)
    _require(path.parts and not path.is_absolute() and path.as_posix() == value
             and all(part not in (".", "..") and ":" not in part for part in path.parts),
             "Keep Economic study members inside their original directory")
    return value


def _descriptors(rows):
    _require(isinstance(rows, list), "Retain the complete original Economic member list")
    result = {}
    for row in rows:
        _require(isinstance(row, dict), "An original Economic member needs a descriptor")
        name = _relative(row.get("path"))
        identifier(row.get("sha256"))
        _require(type(row.get("bytes")) is int and row["bytes"] >= 0,
                 "An original Economic member needs its exact byte length")
        item = {field: row[field] for field in ("path", "bytes", "sha256")}
        _require(name not in result, "The Economic source repeats an original member")
        result[name] = item
    return result


def origin(entry):
    metadata = entry.get("metadata") or {}
    value = metadata.get("economic_comparison_identity")
    if value is None:
        return None
    _require(metadata.get("report_context_kind") == CONTEXT_KIND
             and isinstance(value, dict) and value.get("schema") == ORIGIN_SCHEMA
             and isinstance(value.get("edition"), str) and value["edition"]
             and isinstance(value.get("project_id"), str) and value["project_id"],
             "The Economic source lost its original producer context")
    for field in ("comparison_id", "comparison_identity_sha256", "comparison_sha256",
                  "first_edition_id", "second_edition_id", "adapter_sha256"):
        identifier(value.get(field))
    _require(value["comparison_identity_sha256"] == value["comparison_id"]
             and value["first_edition_id"] != value["second_edition_id"],
             "The Economic source changed its original ordered edition pair")
    members = _descriptors(value.get("members"))
    _require(members and "comparison-record.json" in members,
             "Retain the original completed Economic comparison record")
    return deepcopy(value)


def _entry_members(closure, entry):
    result = {}
    for item in [entry["body"], *entry.get("companions", [])]:
        name = _relative(item.get("view_path", item["filename"]))
        _require(name not in result, "The Economic source repeats an original source view path")
        closure.add_file(item["object"], item)
        result[name] = item
    return result


def _source_binding(closure, collection_id, entry, native):
    members = _entry_members(closure, entry)
    recipe = closure.read(entry["body"]["object"])
    _require(recipe.get("schema") == observed_context.SCHEMA
             and recipe.get("report_context_kind") == CONTEXT_KIND
             and recipe.get("economic_comparison_identity") == native,
             "The selected Economic recipe differs from its original source metadata")
    declared = _descriptors(recipe.get("inputs"))
    expected = {"comparison/" + name: {**item, "path": "comparison/" + name}
                for name, item in _descriptors(native["members"]).items()}
    _require(declared == expected
             and set(members) == set(expected) | {entry["body"].get("view_path", entry["body"]["filename"])},
             "The Economic report changed its complete original companion roster")
    for name, item in expected.items():
        _require(all(members[name].get(field) == item[field] for field in ("bytes", "sha256")),
                 "An Economic report companion differs from its original comparison")
    source_key = digest({"identity": native, "recipe": recipe})
    _require(entry["id"] == "economic-comparison-" + source_key,
             "The Economic report source changed its frozen recipe identity")
    return members, recipe, source_key


def _read_member(closure, prefix, item):
    path = prefix + "/" + _relative(item["path"])
    closure.add_file(path, item)
    return closure.read(path)


def _native_physical(closure, edition):
    """Keep an existing original producer so cost reviews can be rebuilt after restore."""
    retained = edition["input"]
    report_id = identifier(retained["report_id"])
    prefix = "scenario-decisions/" + report_id
    folder = closure.root / prefix
    binding = {"producer_report_id": report_id, "source_sha256": retained["report_sha256"],
               "directory": prefix, "zone_id": retained["zone_id"]}
    # This declared binding stays stable if an absent producer is later restored.
    # Actual inclusion is recorded by the Study's exact file inventory.
    if not folder.exists() and not folder.is_symlink():
        return binding
    # The same source choice as EconomicWorkbench._source; no source reconstruction.
    path = prefix + "/decision.json"
    candidate = closure.root / path
    if not candidate.is_file() and not candidate.is_symlink():
        path = prefix + "/report.json"
    value = closure.read(path)
    _require(value.get("schema") == "upstate.scenario-decisions/v1" and value.get("id") == report_id,
             "The saved Economic edition names another original native producer")
    summary_path = None
    if type(value.get("runs")) is int and type(value.get("zones")) is int:
        summary, summary_path = value, path
        descriptor = summary.get("files", {}).get("json")
        _require(isinstance(descriptor, dict), "The native producer lost its full original report descriptor")
        _descriptors([descriptor])
        path = prefix + "/" + _relative(descriptor["path"])
        closure.add_file(path, descriptor)
        value = closure.read(path)
        _require(value.get("schema") == summary["schema"] and value.get("id") == summary["id"]
                 and value.get("selection") == summary.get("selection"),
                 "The original native report differs from its completed summary")
    _require(isinstance(value.get("runs"), list) and isinstance(value.get("zones"), list)
             and closure.files[path]["sha256"] == retained["report_sha256"]
             and any(row.get("id") == retained["zone_id"] for row in value["zones"]),
             "The retained native report changed its source bytes or selected reporting zone")
    closure.tree(prefix)
    return binding


def _edition(closure, key, expected_record, expected_report, comparison_identity, side):
    key = identifier(key)
    prefix = "economic-editions/" + key
    record = closure.read(prefix + "/edition.json")
    _require(record == expected_record and record.get("schema") == EDITION_SCHEMA
             and record.get("id") == key
             and digest({"input": record["input"], "implementation": record["implementation"]}) == key
             and digest(record) == comparison_identity[side + "_record_sha256"],
             "The selected Economic comparison lost its exact original saved edition")
    files = record.get("files")
    _require(isinstance(files, dict) and files, "The saved Economic edition has no original file roles")
    for item in files.values():
        _descriptors([item])
        closure.add_file(prefix + "/" + _relative(item["path"]), item)
    manifest = _read_member(closure, prefix, files["manifest"])
    _require(manifest.get("schema") == "upstate.decision-delivery/v1"
             and manifest.get("report_id") == record["report_id"],
             "The Economic edition manifest belongs to another original report")
    members = _descriptors(manifest.get("members"))
    _require({"index.html", "report.json", "selection.json", "physical-input.json",
              "source-inputs/scenario-report.json", "application/decision_desk.html"} <= set(members),
             "The original Economic edition lost a complete input or source companion")
    for item in members.values():
        closure.add_file(prefix + "/" + item["path"], item)
    report = closure.read(prefix + "/report.json")
    _require(report == expected_report and report.get("schema") == "upstate.decision-report/v1"
             and report.get("id") == record["report_id"]
             and report.get("selection") == record["input"]["selection"]
             and digest(report) == comparison_identity[side + "_report_sha256"]
             and report["physical_source"]["source"]["sha256"] == record["input"]["report_sha256"],
             "The original Economic report changed its selection or physical-source identity")
    _require(closure.read(prefix + "/selection.json") == record["input"]["selection"],
             "The saved Economic selection differs from its original edition")
    original = members["source-inputs/scenario-report.json"]
    _require(original["sha256"] == record["input"]["report_sha256"],
             "The original native scenario companion changed its declared source bytes")
    closure.tree(prefix)
    physical = _native_physical(closure, record)
    return {"id": key, "report_id": record["report_id"], "title": record["title"],
            "input": deepcopy(record["input"]), "implementation": deepcopy(record["implementation"]),
            "record_sha256": closure.files[prefix + "/edition.json"]["sha256"],
            "report_sha256": closure.files[prefix + "/report.json"]["sha256"],
            "files": deepcopy(files), "native_producer_binding": physical}


def _local(closure, native):
    key = native["comparison_id"]
    prefix = "economic-comparisons/" + key
    descriptors = _descriptors(native["members"])
    for item in descriptors.values():
        closure.add_file(prefix + "/" + item["path"], item)
    record = closure.read(prefix + "/comparison-record.json")
    identity = record.get("identity")
    _require(record.get("schema") == COMPARISON_SCHEMA and record.get("id") == key
             and isinstance(identity, dict) and digest(identity) == key
             and record.get("input") == identity.get("input")
             and record["input"]["first_edition_id"] == native["first_edition_id"]
             and record["input"]["second_edition_id"] == native["second_edition_id"],
             "The native Economic comparison changed its original ordered saved pair")
    files = _descriptors(record.get("files"))
    _require({"index.html", "comparison.json", "scenarios.csv", "manifest.json",
              "comparison-package.zip", "first-economic-package.zip", "second-economic-package.zip"} <= set(files),
             "The original Economic comparison has an incomplete native delivery")
    manifest = _read_member(closure, prefix, files["manifest.json"])
    _require(manifest.get("schema") == "upstate.economic-comparison-package/v1"
             and manifest.get("id") == key and manifest.get("identity") == identity,
             "The native comparison manifest names another source identity")
    members = _descriptors(manifest.get("members"))
    expected = dict(members)
    for name, item in files.items():
        _require(name not in expected or expected[name] == item,
                 "The comparison has conflicting original file roles")
        expected[name] = item
    expected["comparison-record.json"] = descriptors["comparison-record.json"]
    _require(expected == descriptors,
             "The selected scientific source differs from the native comparison's full member roster")
    comparison = closure.read(prefix + "/comparison.json")
    _require(digest(comparison) == native["comparison_sha256"] == record["comparison_sha256"]
             == identity["comparison_sha256"]
             and comparison["first"]["id"] == native["first_edition_id"]
             and comparison["second"]["id"] == native["second_edition_id"]
             and comparison["title"] == record["title"]
             and files["index.html"]["sha256"] == identity["html_sha256"]
             and files["scenarios.csv"]["sha256"] == identity["csv_sha256"],
             "The saved comparison changed its original quantities, presentation or edition pair")
    editions = []
    for side in ("first", "second"):
        saved_record = closure.read(prefix + "/" + side + "-edition.json")
        saved_report = closure.read(prefix + "/" + side + "-report.json")
        saved_files = saved_record.get("files") or {}
        for comparison_name, original in (
                (side + "-economic-package.zip", saved_files["complete_package"]),
                (side + "-report.json", saved_files["report"])):
            _require(all(descriptors[comparison_name][field] == original[field] for field in ("bytes", "sha256")),
                     "The comparison's original Economic attachment differs from its saved edition")
        editions.append(_edition(closure, native[side + "_edition_id"], saved_record,
                                 saved_report, identity, side))
    closure.tree(prefix)
    return {"id": key, "title": record["title"], "input": deepcopy(record["input"]),
            "identity_sha256": digest(identity), "comparison_sha256": native["comparison_sha256"],
            "record_sha256": closure.files[prefix + "/comparison-record.json"]["sha256"],
            "members": deepcopy(native["members"]), "editions": editions}



def _ordered_source_binding(closure, selection):
    """Rebuild only the original binding identity from raw records and CAS."""
    sources = []
    for choice in observed_context.source_choices(selection):
        collection_id = identifier(choice["source_collection_id"])
        closure.need("sources", collection_id, "Original ordered Economic report handoff source")
        collection = closure.read("sources/" + collection_id + ".json")
        _require(collection.get("schema") == "upstate.sources/v1"
                 and digest(collection) == collection_id,
                 "The Economic handoff changed its original source collection")
        entries = [row for row in collection["entries"] if row.get("id") == choice["source_id"]]
        _require(len(entries) == 1 and entries[0].get("kind") == "document",
                 "The Economic handoff lost its original report document")
        entry = entries[0]
        members = _entry_members(closure, entry)
        recipe = closure.read(entry["body"]["object"])
        _require(recipe.get("schema") == observed_context.SCHEMA,
                 "The Economic handoff source has another original report schema")
        for item in recipe.get("inputs", []):
            name = _relative(item["path"])
            _require(name in members and all(members[name][field] == item[field]
                                            for field in ("bytes", "sha256")),
                     "The Economic handoff changed an original report input")
        binding = {"schema": "upstate.observed-report-binding/v1",
                   "edition": observed_context.EDITION,
                   "source_collection_id": collection_id, "source_id": choice["source_id"],
                   "body_sha256": entry["body"]["sha256"],
                   "member_sha256": {name: members[name]["sha256"] for name in sorted(members)}}
        sources.append({"binding": binding})
    return observed_context._binding(sources)


def _source_history(closure, native, recipe, source_key):
    """Retain an existing producer handoff without making its live roster identity."""
    prefix = "economic-comparison-report-sources/" + source_key
    declared = {"source_key": source_key, "directory": prefix,
                "source_identity_sha256": digest(native)}
    folder = closure.root / prefix
    if not folder.exists() and not folder.is_symlink():
        return declared
    seen = getattr(closure, "_economic_source_history_seen", None)
    if seen is None:
        seen = closure._economic_source_history_seen = set()
    if source_key in seen:
        return declared
    # Mark before following original source selections. They may refer to earlier
    # handoffs from the same pair; no recursive scoped source resolver is called.
    seen.add(source_key)
    intent = closure.read(prefix + "/intent.json")
    receipt = closure.read(prefix + "/source-receipt.json")
    _require(intent.get("schema") == ORIGIN_SCHEMA and intent.get("source_key") == source_key
             and intent.get("source_identity") == native and intent.get("recipe") == recipe
             and digest({"identity": intent["source_identity"], "recipe": intent["recipe"]}) == source_key
             and receipt.get("schema") == ORIGIN_SCHEMA and receipt.get("source_key") == source_key
             and receipt.get("source_identity") == native,
             "The Economic source lost its original frozen recipe or receipt")
    files = _descriptors(receipt.get("files"))
    expected = {prefix + "/" + name for name in ("intent.json", "observed-report.json", "model-sources.json")}
    expected |= {prefix + "/comparison/" + item["path"] for item in native["members"]}
    _require(set(files) == expected, "The original Economic source capture lost its complete file roster")
    for item in files.values():
        closure.add_file(item["path"], item)
    _require(closure.read(prefix + "/observed-report.json") == recipe,
             "The original Economic source recipe changed")
    choice = {"source_collection_id": identifier(receipt.get("source_collection_id")),
              "source_id": receipt.get("source_id")}
    _require(choice["source_id"] == "economic-comparison-" + source_key
             and receipt.get("source_role") == observed_context.ROLE,
             "The Economic source receipt names another original document")
    actual = _ordered_source_binding(closure, {"source_roles": {observed_context.ROLE: choice}})
    _require(isinstance(receipt.get("binding"), dict)
             and all(actual.get(name) == receipt["binding"].get(name) for name in
                     ("source_collection_id", "source_id", "body_sha256", "member_sha256")),
             "The original imported Economic source differs from its receipt")
    collection = closure.read("sources/" + choice["source_collection_id"] + ".json")
    manifest = closure.read(prefix + "/model-sources.json")
    original_manifest = collection["original_manifest"]
    _require(manifest.get("schema") == "upstate.sources/v1"
             and all(files[prefix + "/model-sources.json"][field] == original_manifest[field]
                     for field in ("bytes", "sha256")),
             "The Economic source capture differs from its original imported manifest")
    original_entry = next(row for row in collection["entries"] if row["id"] == choice["source_id"])
    _source_binding(closure, choice["source_collection_id"], original_entry, native)
    handoffs = folder / "handoffs"
    for path in sorted(handoffs.glob("*/handoff.json")):
        operation = identifier(path.parent.name)
        value = closure.read(prefix + "/handoffs/" + operation + "/handoff.json")
        identity = value.get("identity")
        _require(value.get("schema") == ORIGIN_SCHEMA and value.get("state") == "imported"
                 and value.get("source_key") == source_key and value.get("operation_id") == operation
                 and isinstance(identity, dict) and digest(identity) == operation
                 and identity.get("schema") == ORIGIN_SCHEMA + "/handoff"
                 and identity.get("source_key") == source_key
                 and identity.get("source_identity") == native
                 and value.get("comparison_id") == native["comparison_id"]
                 and all(value.get(name) == selected for name, selected in choice.items()),
                 "The original Economic source handoff changed")
        previous = identity.get("original_delivery_selection")
        _require(previous is None or isinstance(previous, dict),
                 "The Economic handoff lost its original ordered selection")
        previous = deepcopy(previous) if previous is not None else {"source_roles": {}}
        previous.setdefault("source_roles", {})
        prior = _ordered_source_binding(closure, previous)
        _require(prior == identity.get("original_observed_context_binding"),
                 "The Economic handoff lost its original ordered source binding")
        ordered = observed_context.source_choices(previous)
        if choice not in ordered:
            ordered.append(choice)
        expected_selection = deepcopy(previous)
        expected_selection["observed_context_sources"] = ordered
        expected_selection["source_roles"][observed_context.ROLE] = deepcopy(ordered[0])
        bound = _ordered_source_binding(closure, expected_selection)
        expected_selection["observed_context_binding"] = bound
        _require(value.get("delivery_selection") == expected_selection and value.get("binding") == bound,
                 "The Economic source handoff changed its original report order or retained bytes")
    closure.tree(prefix)
    return declared


def include_source(closure, collection_id, entry):
    """Called only for the exact explicitly selected scientific source edition."""
    native = origin(entry)
    if native is None:
        return False
    identifier(collection_id)
    members, recipe, source_key = _source_binding(closure, collection_id, entry, native)
    local = native["project_id"] == closure.workspace.project["id"]
    saved = _local(closure, native) if local else None
    if local:
        _source_history(closure, native, recipe, source_key)
    record = {
        "schema": LINEAGE_SCHEMA, "source_collection_id": collection_id,
        "source_id": entry["id"], "source_body_sha256": entry["body"]["sha256"],
        "source_project_id": native["project_id"], "report_context_kind": CONTEXT_KIND,
        "relationship": "same_project" if local else "external_project",
        "native_origin": native, "source_key": source_key,
        "native_comparison": saved, "required_records": [],
        "original_members": {name: members[name]["sha256"] for name in sorted(members)},
    }
    token = (collection_id, entry["id"])
    previous = closure.report_source_records.get(token)
    _require(previous is None or previous == record,
             "The original Economic report lineage changed during Study selection")
    closure.report_source_records[token] = record
    return True


def summary(identity):
    """Count only original Economic sources captured by this Study."""
    rows = [row for row in identity.get("scientific_report_sources", [])
            if row.get("report_context_kind") == CONTEXT_KIND]
    return {"economic_comparison_source_count": len(rows),
            "saved_economic_comparison_count": len({
                row["native_comparison"]["id"] for row in rows
                if row.get("native_comparison") is not None})}


def _availability(closure, edition):
    """Describe current verified originals without changing historical lineage."""
    binding = edition["native_producer_binding"]
    prefix = binding["directory"] + "/"
    members = [(path, item) for path, item in closure.files.items()
               if path.startswith(prefix)]
    matching = [path for path, item in members
                if item.get("sha256") == binding["source_sha256"]]
    # _native_physical already read the actual source, checked its schema,
    # producer, zone and SHA, and captured the existing complete directory.
    available = bool(matching)
    return {"edition_id": edition["id"], **deepcopy(binding),
            "state": "available" if available else "not_present",
            "new_cost_edition_available": available,
            "verified_source_paths": sorted(matching),
            "native_file_count": len(members),
            "meaning": "Current original Workspace source availability; no calculation or reconstruction"}


def augment(closure, retained, result):
    """Expose retained comparisons through the maintained Received Studies view."""
    result["economic_comparison_sources"] = []
    for captured in retained["identity"].get("scientific_report_sources", []):
        if captured.get("report_context_kind") != CONTEXT_KIND:
            continue
        token = (captured["source_collection_id"], captured["source_id"])
        current = closure.report_source_records.get(token)
        _require(current == captured,
                 "The received Economic comparison changed its original Study lineage")
        row = deepcopy(current)
        row["native_source_availability"] = [
            _availability(closure, edition)
            for edition in (row.get("native_comparison") or {}).get("editions", [])
        ]
        result["economic_comparison_sources"].append(row)
