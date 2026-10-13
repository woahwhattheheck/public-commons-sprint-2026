"""Exact receiving-water source lineage for the original selected-study archive.

TokenJunkieLabs. This adapter reads immutable records and source CAS descriptors;
it never materializes source views, prepares geography or reruns a native model.
The maintained scientific_report_study_transfer dispatcher owns source selection;
study_report_transfer retains the original lineage receipts.
"""
from __future__ import annotations

from pathlib import PurePosixPath

from .common import digest, identifier

CONTEXT = "receiving-water-scientific-study"
REPORT_SCHEMA = "upstate.observed-report/v1"
CAPTURE_SCHEMA = "upstate.receiving-water-report-source/v1"
EDITIONS = ("receiving-water-report-source/1", "receiving-water-report-source/2",
            "receiving-water-report-source/3")
FOLDER = "receiving-water-report-sources"
ROLE = "receiving-water-report-source"
SOURCE_ID = "receiving-water-scientific-report"
URI_PREFIX = "urn:upstate:receiving-water-report:"


def _member(value):
    if not isinstance(value, str) or "\\" in value or "\0" in value:
        raise ValueError("Receiving report needs canonical original member paths")
    path = PurePosixPath(value)
    if not path.parts or path.is_absolute() or ".." in path.parts or path.as_posix() != value:
        raise ValueError("Receiving report member must remain inside its original source")
    return value


def _same_descriptor(left, right):
    return all(left.get(name) == right.get(name) for name in ("bytes", "sha256"))


def _read(closure, descriptor):
    closure.add_file(descriptor["object"], descriptor)
    return closure.read(descriptor["object"])


def _members(closure, entry, recipe):
    members = {}
    for descriptor in entry.get("companions", []):
        name = _member(descriptor.get("view_path", descriptor["filename"]))
        if name in members:
            raise ValueError("Receiving report repeats an original source companion")
        members[name] = descriptor
        closure.add_file(descriptor["object"], descriptor)
    inputs = recipe.get("inputs")
    if not isinstance(inputs, list):
        raise ValueError("Receiving report lacks its original declared input inventory")
    seen = set()
    for descriptor in inputs:
        name = _member(descriptor["path"])
        if name in seen or name not in members or not _same_descriptor(descriptor, members[name]):
            raise ValueError("Receiving report lost its exact original companion: " + name)
        seen.add(name)
    if seen != set(members):
        raise ValueError("Receiving report companions differ from its declared recipe inputs")
    return members


def _read_member(closure, members, name):
    name = _member(name)
    if name not in members:
        raise ValueError("Receiving report lacks its original member: " + name)
    return _read(closure, members[name])


def _native_record(closure, members, name, schema, project):
    record = _read_member(closure, members, "native/" + name + "/" + name + ".json")
    key = identifier(record.get("id"))
    identity = record.get("identity")
    if (record.get("schema") != schema or record.get("state") != "complete"
            or not isinstance(identity, dict) or digest(identity) != key
            or identity.get("project_id") != project
            or digest({field: value for field, value in record.items()
                       if field not in ("record_sha256", "reused")}) != record.get("record_sha256")):
        raise ValueError("Receiving report differs from its immutable native " + name)
    files = record.get("files")
    if not isinstance(files, dict):
        raise ValueError("Receiving report lost its native member inventory")
    seen = set()
    for item in files.values():
        relative = _member(item["path"])
        path = "native/" + name + "/" + relative
        if relative in seen or path not in members or not _same_descriptor(item, members[path]):
            raise ValueError("Receiving report lost an exact native " + name + " member")
        seen.add(relative)
    return record


def _references(value, location):
    if isinstance(value, dict):
        if "source_collection_id" in value and "source_id" in value:
            choice = {key: value[key] for key in ("source_collection_id", "source_id")}
            identifier(choice["source_collection_id"])
            if not isinstance(choice["source_id"], str) or not choice["source_id"].strip():
                raise ValueError("Receiving plan has an incomplete original source selector")
            yield choice, {"location": location, "selection": value}
        for name, item in value.items():
            yield from _references(item, location + "/" + str(name))
    elif isinstance(value, list):
        for index, item in enumerate(value):
            yield from _references(item, location + "/" + str(index))


def _original_sources(closure, members, plan, local):
    expected = {}
    for identity in plan["identity"]["source_identities"]:
        choice = {name: identity[name] for name in ("source_collection_id", "source_id")}
        key = digest(choice)
        expected.setdefault(key, {"choice": choice, "identities": [], "references": []})
        expected[key]["identities"].append(identity)
    for label, value in (("identity/selection", plan["identity"]["selection"]),
                         ("receptors", plan["receptors"])):
        for choice, reference in _references(value, label):
            key = digest(choice)
            expected.setdefault(key, {"choice": choice, "identities": [], "references": []})
            expected[key]["references"].append(reference)
    index = _read_member(closure, members, "original-source-index.json")
    if not isinstance(index, list):
        raise ValueError("Receiving report source register must retain original selectors")
    captured = {}
    for row in index:
        choice = {name: row[name] for name in ("source_collection_id", "source_id")}
        collection_id = identifier(choice["source_collection_id"])
        key = digest(choice)
        if key in captured or key not in expected:
            raise ValueError("Receiving report source register differs from its saved plan")
        origin = "original-sources/" + key + "/"
        paths = {"entry_path": "entry.json", "collection_path": "collection.json",
                 "original_manifest_path": "original-manifest.json",
                 "identities_path": "plan-source-identities.json",
                 "references_path": "plan-source-references.json"}
        for field, filename in paths.items():
            if row.get(field) != origin + filename:
                raise ValueError("Receiving source register changed an original capture path")
        source_entry = _read_member(closure, members, row["entry_path"])
        collection = _read_member(closure, members, row["collection_path"])
        original = {name: value for name, value in collection.items() if name != "id"}
        if (collection.get("schema") != "upstate.sources/v1"
                or collection.get("id") != collection_id or digest(original) != collection_id
                or source_entry.get("id") != choice["source_id"]
                or [entry for entry in collection["entries"] if entry.get("id") == choice["source_id"]] != [source_entry]
                or source_entry["body"]["sha256"] != row.get("body_sha256")):
            raise ValueError("Receiving source register changed its original collection or entry")
        manifest = collection["original_manifest"]
        if not _same_descriptor(manifest, members[row["original_manifest_path"]]):
            raise ValueError("Receiving report lost its original source collection manifest")
        if (_read_member(closure, members, row["identities_path"]) != expected[key]["identities"]
                or _read_member(closure, members, row["references_path"]) != expected[key]["references"]):
            raise ValueError("Receiving report changed the original uses of a source")
        declared = {}
        for descriptor in row["members"]:
            name = _member(descriptor["path"])
            if name in declared or name not in members or not _same_descriptor(descriptor, members[name]):
                raise ValueError("Receiving report lost an original source member")
            declared[name] = descriptor
        wanted = set()
        for descriptor in [source_entry["body"]] + source_entry.get("companions", []):
            name = origin + "members/" + _member(descriptor.get("view_path", descriptor["filename"]))
            if name in wanted or name not in declared or not _same_descriptor(descriptor, declared[name]):
                raise ValueError("Receiving report differs from its complete original source")
            wanted.add(name)
        if wanted != set(declared):
            raise ValueError("Receiving report original source inventory changed")
        for identity in expected[key]["identities"]:
            if (identity.get("body_sha256") != source_entry["body"]["sha256"]
                    or identity.get("body_bytes") != source_entry["body"]["bytes"]):
                raise ValueError("Receiving report geometry source differs from its plan")
            for field in ("uri", "vintage", "title", "role", "metadata"):
                if field in identity and identity[field] != source_entry.get(field, {} if field == "metadata" else None):
                    raise ValueError("Receiving report original source metadata changed")
            companions = [{name: item.get(name) for name in ("sha256", "bytes", "filename", "source_path")}
                          for item in source_entry.get("companions", [])]
            if companions != identity.get("companions", []):
                raise ValueError("Receiving report original source companions changed")
        captured[key] = {**choice, "entry_sha256": digest(source_entry),
                         "original_manifest_sha256": manifest["sha256"],
                         "original_manifest_bytes": manifest["bytes"]}
        if local:
            reason = "Original receiving-water geometry and explicit contextual sources"
            closure.need("sources", collection_id, reason)
            live = closure.read("sources/" + collection_id + ".json")
            if live != original:
                raise ValueError("Receiving report and editable original source collection differ")
    if set(captured) != set(expected):
        raise ValueError("Receiving report omitted an original geometry or contextual source")
    return [value for key, value in sorted(captured.items())]


def _entry_identity(entry):
    members = {}
    for item in entry.get("companions", []):
        name = _member(item.get("view_path", item["filename"]))
        if name in members:
            raise ValueError("Receiving source copy repeats an original companion")
        members[name] = {key: item[key] for key in ("bytes", "sha256")}
    return {**{name: entry.get(name) for name in
               ("id", "kind", "title", "uri", "vintage", "role", "metadata")},
            "body": {name: entry["body"][name] for name in ("bytes", "sha256")},
            "companions": members}


def _capture(closure, key, collection_id, entry, recipe, members, plan, analysis, sources):
    prefix = FOLDER + "/" + key + "/"
    record = closure.read(prefix + "report.json")
    identity = record.get("identity")
    study = {"plan_id": plan["id"], "plan_record_sha256": plan["record_sha256"],
             "analysis_id": analysis["id"] if analysis else None,
             "analysis_record_sha256": analysis["record_sha256"] if analysis else None}
    if (record.get("schema") != CAPTURE_SCHEMA or record.get("id") != key
            or record.get("state") != "complete" or not isinstance(identity, dict)
            or digest(identity) != key or identity.get("workspace_id") != recipe["project_id"]
            or identity.get("edition") != recipe["edition"]
            or identity.get("study") != study or identity.get("source_entries") != sources
            or record.get("selection") != identity.get("selection")
            or digest({name: value for name, value in record.items() if name != "record_sha256"})
                != record.get("record_sha256")):
        raise ValueError("Receiving report lost its exact original editable capture")
    source = record.get("source")
    if (not isinstance(source, dict) or set(source) != {"source_collection_id", "source_id"}
            or source.get("source_id") != SOURCE_ID):
        raise ValueError("Receiving report capture lost its original imported source selector")
    original_collection = identifier(source["source_collection_id"])
    closure.need("sources", original_collection, "Original imported receiving-water report capture")
    collection = closure.read("sources/" + original_collection + ".json")
    original_entries = [item for item in collection.get("entries", []) if item.get("id") == SOURCE_ID]
    if (collection.get("schema") != "upstate.sources/v1" or digest(collection) != original_collection
            or len(original_entries) != 1 or _entry_identity(original_entries[0]) != _entry_identity(entry)):
        raise ValueError("Selected receiving report differs from its original captured source")
    selection = identity["selection"]
    selected = {"analysis_id": analysis["id"]} if analysis else {"plan_id": plan["id"]}
    if (not isinstance(selection, dict) or set(selection) - {*selected, "title"}
            or any(selection.get(name) != value for name, value in selected.items())):
        raise ValueError("Receiving report capture selects another original study")
    required_modules = {"producer", "plan_reader"} | ({"exporter", "scientific_formatter"} if analysis else set())
    if recipe["edition"] in ("receiving-water-report-source/2", "receiving-water-report-source/3"):
        required_modules |= {"map_capture", "map_renderer", "scientific_figures"}
    if analysis and recipe["edition"] == "receiving-water-report-source/3":
        required_modules.add("accounting_formatter")
    supported_modules = [required_modules]
    if analysis and recipe["edition"] == "receiving-water-report-source/2":
        # Accounting-aware captures retain the exact formatter used for their
        # physical partition tables; earlier completed /2 captures stay intact.
        supported_modules.append(required_modules | {"accounting_formatter"})
    implementation = identity.get("capture_implementation", {})
    if set(implementation) not in supported_modules:
        raise ValueError("Receiving report lost its original capture implementation")
    for name, checksum in implementation.items():
        descriptor = members.get("implementation/" + name + ".py")
        if descriptor is None or descriptor["sha256"] != checksum:
            raise ValueError("Receiving report capture implementation differs")
    files = {}
    for item in record["files"]:
        path = _member(item["path"])
        if not path.startswith(prefix) or path in files:
            raise ValueError("Receiving report capture member leaves its immutable folder")
        files[path] = item
        closure.add_file(path, item)
    expected = set(members) | {"intent.json", "report-source.json", "sources.json", "prepared.json"}
    if set(files) != {prefix + name for name in expected}:
        raise ValueError("Receiving report capture changed its exact declared member inventory")
    for name, descriptor in {**members, "report-source.json": entry["body"]}.items():
        if not _same_descriptor(files[prefix + name], descriptor):
            raise ValueError("Receiving report source differs from its original dossier capture")
    intent = closure.read(prefix + "intent.json")
    if (intent.get("schema") != CAPTURE_SCHEMA or intent.get("id") != key
            or intent.get("identity") != identity or intent.get("created_at") != record.get("created_at")):
        raise ValueError("Receiving report lost its fixed original capture intent")
    prepared = closure.read(prefix + "prepared.json")
    ready = {item["path"]: item for item in prepared.get("files", [])}
    if (len(ready) != len(prepared.get("files", []))
            or set(ready) != expected - {"prepared.json"}
            or any(not _same_descriptor(item, files[prefix + name]) for name, item in ready.items())):
        raise ValueError("Receiving report prepared source differs from its completed capture")
    manifest = closure.read(prefix + "sources.json")
    entries = manifest.get("entries", [])
    if manifest.get("schema") != "upstate.sources/v1" or len(entries) != 1:
        raise ValueError("Receiving report lost its exact original import manifest")
    authored = entries[0]
    if (authored.get("id") != entry["id"] or authored.get("role") != ROLE
            or authored.get("uri") != entry.get("uri") or authored.get("path") != "report-source.json"
            or authored.get("sha256") != entry["body"]["sha256"]
            or authored.get("metadata") != entry.get("metadata")
            or authored.get("companions") != recipe["inputs"]):
        raise ValueError("Receiving report import manifest differs from its original source")
    return record


def _binding(closure, collection_id, entry):
    """Return one verified lineage binding, or None for a different producer.

    Complete local dossiers require
    their original editable records; foreign reports retain their exact source
    companions without resolving foreign IDs in this Workspace.
    """
    metadata = entry.get("metadata") or {}
    if metadata.get("report_context_kind") != CONTEXT and entry.get("role") != ROLE:
        return None
    recipe = _read(closure, entry["body"])
    if (entry.get("id") != SOURCE_ID or entry.get("kind") != "document" or entry.get("role") != ROLE
            or metadata.get("report_schema") != REPORT_SCHEMA
            or recipe.get("schema") != REPORT_SCHEMA or recipe.get("report_context_kind") != CONTEXT
            or recipe.get("edition") not in EDITIONS):
        raise ValueError("Receiving report differs from its explicitly declared source producer")
    project = recipe.get("project_id")
    if not isinstance(project, str) or not project:
        raise ValueError("Receiving report must retain its original project identity")
    prefix = URI_PREFIX + project + ":"
    uri = entry.get("uri")
    if not isinstance(uri, str) or not uri.startswith(prefix):
        raise ValueError("Receiving report lost its original immutable source URI")
    key = identifier(uri[len(prefix):])
    for name, expected in (("report_context_kind", CONTEXT), ("report_source_id", key), ("project_id", project)):
        if name in metadata and metadata[name] != expected:
            raise ValueError("Receiving report metadata differs from its original source identity")
    members = _members(closure, entry, recipe)
    if (recipe["edition"] in ("receiving-water-report-source/2", "receiving-water-report-source/3")
            and "figures/source-map-spec.json" not in members):
        raise ValueError("Receiving map report lost its original geographic figure specification")
    plan = _native_record(closure, members, "plan", "upstate.receiving-water-plan/v1", project)
    mode = metadata.get("mode")
    if mode not in ("source_plan", "completed_analysis") or metadata.get("plan_id") != plan["id"]:
        raise ValueError("Receiving report selects another original source plan")
    analysis = None
    if mode == "completed_analysis":
        analysis = _native_record(closure, members, "analysis", "upstate.receiving-water-analysis/v1", project)
        if (metadata.get("analysis_id") != analysis["id"] or analysis.get("plan_id") != plan["id"]
                or analysis["identity"].get("plan_record_sha256") != plan["record_sha256"]):
            raise ValueError("Receiving report analysis differs from its exact original plan")
        inventory = _read_member(closure, members, "native/receiving-water-delivery.json")
        if (inventory.get("schema") != "upstate.receiving-water-delivery/v1"
                or inventory.get("identity") != {"plan_id": plan["id"],
                    "plan_record_sha256": plan["record_sha256"], "analysis_id": analysis["id"],
                    "analysis_record_sha256": analysis["record_sha256"]}):
            raise ValueError("Receiving report numerical inventory identifies another immutable study")
        for item in inventory.get("files", {}).values():
            path = "native/" + _member(item["path"])
            if path not in members or not _same_descriptor(item, members[path]):
                raise ValueError("Receiving report lost an original numerical export member")
    elif metadata.get("analysis_id") is not None or any(name.startswith("native/analysis/") for name in members):
        raise ValueError("Source-plan report must retain its original geography-only selection")
    local = project == closure.workspace.project["id"]
    sources = _original_sources(closure, members, plan, local)
    required = []
    if local:
        for kind, name, record in [("receiving-water-plans", "plan", plan)] + (
                [("receiving-water-analyses", "analysis", analysis)] if analysis else []):
            closure.need(kind, record["id"], "Original editable receiving-water report study")
            original = closure.read(kind + "/" + record["id"] + "/" + name + ".json")
            if original != record:
                raise ValueError("Receiving report and original editable study differ")
            required.append({"kind": kind, "id": record["id"]})
        capture = _capture(closure, key, collection_id, entry, recipe, members, plan, analysis, sources)
    else:
        capture = None
    return {"schema": "upstate.study-report-lineage/v1",
            "source_collection_id": collection_id, "source_id": entry["id"],
            "source_body_sha256": entry["body"]["sha256"], "source_project_id": project,
            "report_context_kind": CONTEXT, "report_source_id": key,
            "mode": mode, "plan_id": plan["id"], "plan_record_sha256": plan["record_sha256"],
            "analysis_id": analysis["id"] if analysis else None,
            "analysis_record_sha256": analysis["record_sha256"] if analysis else None,
            "capture_record_sha256": capture["record_sha256"] if capture else None,
            "capture_source": dict(capture["source"]) if capture else None,
            "relationship": "same_project" if local else "external_project",
            "required_records": required}


def include_source(closure, collection_id, entry):
    """Register an explicitly selected saved-edition source; return whether handled.

    Call only from scientific_report_study_transfer._source, after its original
    ordered source validation. Generic source collections retain their existing
    dependency semantics.
    """
    binding = _binding(closure, collection_id, entry)
    if binding is None:
        return False
    key = (collection_id, entry["id"])
    previous = closure.report_source_records.get(key)
    if previous is not None and previous != binding:
        raise ValueError("A receiving-water report source changed during study selection")
    closure.report_source_records[key] = binding
    return True
