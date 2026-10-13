"""Carry original assessment geography through selected scientific-report Studies.

Capture reads exact saved records, source objects and original packages. It never
rebuilds GIS, changes assessment rows, receives ZIPs, or creates source-view links.
Explicit source adoption remains a separate native queued operation.
"""
from __future__ import annotations

from copy import deepcopy
from pathlib import PurePosixPath

from .common import digest, identifier

CONTEXT = "assessment_geographic_context"
ROLE = "assessment-geographic-report-context"
REPORT_SCHEMA = "upstate.observed-report/v1"
LINEAGE_SCHEMA = "upstate.study-report-lineage/v1"
EDITIONS = frozenset(("assessment-geographic-context-report-1.0.0",
                      "assessment-geographic-context-report-1.1.0",
                      "assessment-geographic-context-report-1.2.0"))


def _require(value, message):
    if not value:
        raise ValueError(message)


def _member(value):
    _require(isinstance(value, str) and value and "\\" not in value and "\0" not in value,
             "Assessment sources require original relative member paths")
    path = PurePosixPath(value)
    _require(not path.is_absolute() and path.as_posix() == value
             and not any(part in (".", "..") or ":" in part for part in path.parts),
             "Keep assessment source members inside their original package")
    return value


def _same(left, right):
    return isinstance(left, dict) and isinstance(right, dict) and all(
        left.get(field) == right.get(field) for field in ("bytes", "sha256"))


def _body(closure, item):
    closure.add_file(item["object"], item)
    return closure.read(item["object"])


def _immutable(closure, kind, key):
    key = identifier(key)
    value = closure.read(kind + "/" + key + ".json")
    _require(value.get("schema") == "upstate." + kind + "/v1" and digest(value) == key,
             "The assessment source lost its original editable " + kind + " record")
    return {**value, "id": key}


def _members(closure, entry, recipe):
    members = {}
    for item in entry.get("companions", []):
        name = _member(item.get("view_path", item["filename"]))
        _require(name not in members, "An assessment source repeats an original companion")
        closure.add_file(item["object"], item)
        members[name] = item
    inputs = recipe.get("inputs")
    _require(isinstance(inputs, list) and inputs,
             "Retain the complete assessment source input inventory")
    declared = {}
    for item in inputs:
        name = _member(item["path"])
        _require(name not in declared and _same(item, members.get(name)),
                 "The assessment report lost an original input: " + name)
        declared[name] = item
    _require(set(declared) == set(members),
             "Assessment companions differ from the selected original recipe")
    return members


def _original(closure, members, name):
    _require(name in members, "The assessment source lacks " + name)
    return _body(closure, members[name])


def _package_inputs(package, members, prefix):
    originals = package.get("files")
    _require(isinstance(originals, list) and originals,
             "Retain the complete original assessment package inventory")
    seen = set()
    for item in originals:
        name = _member(item["path"])
        _require(name not in seen and _same(item, members.get(prefix + name)),
                 "The assessment source lost an original package member: " + prefix + name)
        seen.add(name)


def _saved_files(closure, record, package_schema, source_members=None, source_prefix=""):
    """Capture every original saved/package member, including received parcel ZIPs."""
    saved = {}
    packages = []
    for item in record.get("files", []):
        path = _member(item["path"])
        _require(path not in saved, "A saved assessment edition repeats a member")
        closure.add_file(path, item)
        saved[path] = item
        if PurePosixPath(path).name == "package.json":
            packages.append(path)
    _require(len(packages) == 1, "The saved edition needs one original package manifest")
    package_path = packages[0]
    root = PurePosixPath(package_path).parent.as_posix() + "/"
    package = closure.read(package_path)
    _require(package.get("schema") == package_schema,
             "The assessment package has another original schema")
    members = {}
    for item in package.get("files", []):
        name = _member(item["path"])
        _require(name not in members, "The original assessment package repeats a member")
        closure.add_file(root + name, item)
        members[name] = {**item, "path": root + name}
    for path, item in saved.items():
        if path.startswith(root):
            name = path[len(root):]
        else:
            received = record.get("received_from") or {}
            _require(PurePosixPath(path).name == "parcel-context.zip"
                     and item["sha256"] == received.get("archive_sha256"),
                     "The saved assessment member is outside its original package")
            name = "parcel-context.zip"
        _require(name not in members or _same(item, members[name]),
                 "Saved assessment files differ from their original package")
        members[name] = item
    if source_members is not None:
        for name, item in members.items():
            _require(_same(item, source_members.get(source_prefix + name)),
                     "The report and editable assessment member differ: " + name)
        supplied = {name[len(source_prefix):] for name in source_members
                    if name.startswith(source_prefix)}
        _require(supplied == set(members),
                 "The report changed its complete original assessment package")
    return package, members, root


def _source_collections(closure, bindings):
    seen = {}
    for binding in bindings:
        collection_id = identifier(binding["collection_id"])
        source_id = binding["source_id"]
        token = (collection_id, source_id)
        _require(token not in seen or seen[token] == binding,
                 "Original station source bindings disagree")
        seen[token] = binding
        collection = closure.read("sources/" + collection_id + ".json")
        _require(collection.get("schema") == "upstate.sources/v1"
                 and digest(collection) == collection_id,
                 "The station source collection changed")
        entries = [row for row in collection["entries"] if row["id"] == source_id]
        _require(len(entries) == 1, "The station source lost an original entry")
        entry = entries[0]
        metadata = {name: value for name, value in entry.items()
                    if name not in ("body", "companions")}
        _require(metadata == binding["source_metadata"]
                 and entry["body"] == binding["body"]
                 and entry.get("companions", []) == binding.get("companions", [])
                 and entry["body"]["sha256"] == binding["source_sha256"],
                 "The saved station source differs from its original metadata or bytes")
        closure.need("sources", collection_id, "Original Station/Assessment source inputs")


def _station(closure, key, source_archive):
    station = _immutable(closure, "station-geographies", key)
    package, files, root = _saved_files(
        closure, station, "upstate.station-geography-package/v1")
    _require(package.get("project_id") == closure.workspace.project["id"]
             and package.get("build_id") == station["build_id"]
             and package.get("selection") == station["selection"],
             "The original station package belongs to another project or selection")
    analysis = closure.read(root + "analysis.json")
    _require(analysis.get("schema") == "upstate.station-geography-result/v1"
             and all(analysis.get(name) == station.get(name) for name in
                     ("build_id", "selection", "summary", "sources"))
             and analysis.get("project_id") == closure.workspace.project["id"],
             "The editable station edition differs from its original result")
    _require(_same(files.get("station-geography.zip"), source_archive),
             "The assessment source and original station archive differ")
    pointer = closure.read(root + "edition.json")
    _require(pointer == {"id": station["id"], "build_id": station["build_id"]},
             "The original station saved-edition pointer changed")
    _source_collections(closure, station["sources"])
    for key in station.get("observation_ids", []):
        closure.need("observations", identifier(key), "Original assessment station observations")
    if station.get("source_collection_id"):
        closure.need("sources", identifier(station["source_collection_id"]),
                     "Original station spatial source collection")
    return station


def _local(closure, recipe, members, context_result):
    context = _immutable(closure, "assessment-contexts", recipe["context_id"])
    _require(context["selection"] == recipe["original_selection"]
             and context["summary"] == recipe["summary"],
             "The report differs from its exact saved assessment selection")
    package, context_files, root = _saved_files(
        closure, context, "upstate.assessment-context-package/v1", members, "context/")
    _require(package.get("selection") == context["selection"]
             and closure.read(root + "context.json") == context_result,
             "The selected report and editable context have different original rows")
    _require(closure.read(root + "edition.json") == {
                 "id": context["id"], "build_id": context["build_id"]},
             "The assessment saved-edition pointer changed")
    station_id = identifier(context["selection"]["station_geography_id"])
    station = _station(closure, station_id, members["context/original-station-geography.zip"])
    _require(digest({"version": context["version"], "selection": context["selection"],
                     "geography_build_id": station["build_id"]}) == context["build_id"],
             "The assessment build no longer selects its original station edition")
    collection_id = identifier(context["source_collection_id"])
    collection = closure.read("sources/" + collection_id + ".json")
    entries = [row for row in collection.get("entries", [])
               if row.get("id") == context["source_id"]]
    _require(digest(collection) == collection_id and len(entries) == 1
             and _same(entries[0].get("body"), context_files.get("context.geojson")),
             "The original context spatial source differs from its retained geometry")
    closure.need("sources", collection_id, "Original assessment geographic source")
    records = [("station-geographies", station), ("assessment-contexts", context)]
    parcel = None
    if recipe.get("parcel_id"):
        parcel = _immutable(closure, "assessment-parcel-contexts", recipe["parcel_id"])
        received = parcel.get("received_from")
        _require(parcel.get("context_id") == context["id"]
                 and received == recipe.get("parcel_received_from"),
                 "The parcel association belongs to another original context")
        package, parcel_files, unused = _saved_files(
            closure, parcel, "upstate.assessment-parcel-context-package/v1", members, "parcels/")
        original_context = (received or {}).get("original_context_id", context["id"])
        parcel_result = _original(closure, members, "parcels/parcel-context.json")
        _require(package.get("context_id") == original_context
                 and package.get("study_id") == parcel["study_id"]
                 and parcel_result.get("context_id") == original_context
                 and parcel_result.get("study_id") == parcel["study_id"],
                 "The original parcel package changed its context/study relationship")
        # A received association retains its original source study in its ZIP.
        # Only a locally authored association selects a current Conservation study.
        if received is None:
            closure.need("conservation", identifier(parcel["study_id"]),
                         "Original parcel study used by the assessment association")
        else:
            for key in received.get("source_collection_map", {}).values():
                closure.need("sources", identifier(key), "Received original parcel source")
        records.append(("assessment-parcel-contexts", parcel))
    for kind, row in records:
        closure.nodes.setdefault((kind, row["id"]), {
            "kind": kind, "id": row["id"], "state": "complete", "title": row["title"],
            "reasons": ["Original editable geography behind the selected assessment report"]})
    return station, context, parcel


def _source_record(closure, collection_id, entry, *, capture_native=True):
    metadata = entry.get("metadata") or {}
    if metadata.get("report_context_kind") != CONTEXT and entry.get("role") != ROLE:
        return False
    recipe = _body(closure, entry["body"])
    _require(entry.get("kind") == "document" and entry.get("role") == ROLE
             and metadata.get("report_schema") == REPORT_SCHEMA
             and recipe.get("schema") == REPORT_SCHEMA
             and recipe.get("report_context_kind") == CONTEXT
             and recipe.get("edition") in EDITIONS,
             "Choose a supported original assessment report source")
    project = recipe.get("project_id")
    _require(isinstance(project, str) and project,
             "The assessment report needs its original project identity")
    key = identifier(recipe.get("context_id"))
    parcel_id = recipe.get("parcel_id")
    if parcel_id is not None:
        identifier(parcel_id)
    _require(metadata.get("context_id") == key and metadata.get("parcel_id") == parcel_id
             and entry.get("uri") == "workspace://" + project + "/assessment-context/" + key,
             "The assessment source changed its original context identity")
    members = _members(closure, entry, recipe)
    result = _original(closure, members, "context/context.json")
    package = _original(closure, members, "context/package.json")
    _require(result.get("schema") == "upstate.assessment-geographic-context/v1"
             and result.get("selection") == recipe.get("original_selection")
             and result.get("summary") == recipe.get("summary")
             and package.get("schema") == "upstate.assessment-context-package/v1"
             and package.get("selection") == recipe.get("original_selection"),
             "The assessment report changed its original context result or selection")
    _package_inputs(package, members, "context/")
    if parcel_id is not None:
        parcel_package = _original(closure, members, "parcels/package.json")
        parcel_result = _original(closure, members, "parcels/parcel-context.json")
        original_context = (recipe.get("parcel_received_from") or {}).get("original_context_id", key)
        _require(parcel_package.get("schema") == "upstate.assessment-parcel-context-package/v1"
                 and parcel_result.get("schema") == "upstate.assessment-parcel-context/v1"
                 and parcel_package.get("context_id") == original_context
                 and parcel_result.get("context_id") == original_context
                 and parcel_package.get("study_id") == parcel_result.get("study_id")
                 and "parcels/parcel-context.zip" in members,
                 "The report changed its original parcel association package")
        _package_inputs(parcel_package, members, "parcels/")
    for name in ("context/assessment-context.zip", "context/original-station-geography.zip"):
        _require(name in members, "The assessment source needs its complete original " + name)
    local_path = closure.root / ("assessment-contexts/" + key + ".json")
    same_project = project == closure.workspace.project["id"]
    local = capture_native and same_project and (local_path.exists() or local_path.is_symlink())
    station = context = parcel = None
    if local:
        station, context, parcel = _local(closure, recipe, members, result)
    relationship = ("same_project" if local else "retained_source"
                    if same_project or not capture_native else "external_project")
    row = {
        "schema": LINEAGE_SCHEMA, "report_context_kind": CONTEXT,
        "source_collection_id": identifier(collection_id), "source_id": entry["id"],
        "source_body_sha256": entry["body"]["sha256"], "source_project_id": project,
        "producer_edition": recipe["edition"], "relationship": relationship,
        "context_id": key, "parcel_id": parcel_id,
        "station_geography_id": identifier(recipe["original_selection"]["station_geography_id"]),
        "original_selection": deepcopy(recipe["original_selection"]),
        "summary": deepcopy(recipe["summary"]),
        "assessment_map": deepcopy(recipe.get("assessment_map")),
        "native": None if context is None else {
            "station": {"id": station["id"], "build_id": station["build_id"]},
            "context": {"id": context["id"], "build_id": context["build_id"]},
            "parcel": None if parcel is None else {"id": parcel["id"], "study_id": parcel["study_id"]}},
        "required_records": [] if context is None else [
            {"kind": "station-geographies", "id": station["id"]},
            {"kind": "assessment-contexts", "id": context["id"]},
            *([{"kind": "assessment-parcel-contexts", "id": parcel["id"]}] if parcel else [])],
        "original_members": {name: item["sha256"] for name, item in sorted(members.items())}}
    return row


def include_source(closure, collection_id, entry):
    row = _source_record(closure, collection_id, entry)
    if row is False:
        return False
    token = (collection_id, entry["id"])
    previous = closure.report_source_records.get(token)
    _require(previous is None or previous == row,
             "The selected assessment report lineage changed during capture")
    closure.report_source_records[token] = row
    return True


def summary(identity):
    rows = [row for row in identity.get("scientific_report_sources", [])
            if row.get("report_context_kind") == CONTEXT]
    return {"assessment_source_count": len(rows),
            "editable_assessment_count": len({row["context_id"] for row in rows if row.get("native")})}


def _files(closure, rows):
    result = []
    for item in rows:
        path = _member(item["path"])
        closure.add_file(path, item)
        result.append({"path": path, "bytes": item["bytes"], "sha256": item["sha256"],
                       "label": item.get("label") or PurePosixPath(path).name})
    return result


def _detail_rows(closure, retained, result):
    """Discover old ordered sources without expanding their captured dependencies."""
    rows = []
    seen = set()
    for row in retained["identity"].get("scientific_report_sources", []):
        if row.get("report_context_kind") != CONTEXT:
            continue
        token = (row["source_collection_id"], row["source_id"])
        _require(closure.report_source_records.get(token) == row,
                 "The received Study lost its exact original assessment source")
        rows.append(row)
        seen.add(token)
    for report in result.get("reports", []):
        for choice in report.get("source_choices", []):
            token = (choice["source_collection_id"], choice["source_id"])
            if token in seen:
                continue
            collection = closure.read("sources/" + identifier(token[0]) + ".json")
            entries = [entry for entry in collection.get("entries", []) if entry.get("id") == token[1]]
            _require(digest(collection) == token[0] and len(entries) == 1,
                     "The original ordered report source collection changed")
            # This read checks only already-captured source objects. It does not
            # add lineage records, producer nodes, dependencies, or native roots.
            row = _source_record(closure, token[0], entries[0], capture_native=False)
            if row is not False:
                rows.append(row)
                seen.add(token)
    return rows


def augment(closure, retained, result):
    result["assessment_sources"] = []
    rows = _detail_rows(closure, retained, result)
    result.update(assessment_source_count=len(rows),
                  editable_assessment_count=len({row["context_id"] for row in rows if row.get("native")}))
    for row in rows:
        token = (row["source_collection_id"], row["source_id"])
        collection = closure.read("sources/" + identifier(token[0]) + ".json")
        entries = [entry for entry in collection["entries"] if entry["id"] == token[1]]
        _require(len(entries) == 1 and entries[0]["body"]["sha256"] == row["source_body_sha256"],
                 "The received assessment source body changed")
        entry = entries[0]
        source = {"source_collection_id": token[0], "source_id": token[1]}
        view = {
            "source": source, "source_body_sha256": row["source_body_sha256"],
            "source_project_id": row["source_project_id"], "relationship": row["relationship"],
            "title": entry["title"], "context_id": row["context_id"], "parcel_id": row["parcel_id"],
            "original_selection": deepcopy(row["original_selection"]),
            "summary": deepcopy(row["summary"]), "assessment_map": deepcopy(row.get("assessment_map")),
            "report_ids": [report["id"] for report in result.get("reports", [])
                           if source in report.get("source_choices", [])],
            "source_members": _files(closure, [
                {**item, "path": item["object"],
                 "label": item.get("view_path") or item["filename"]}
                for item in [entry["body"], *entry.get("companions", [])]]),
            "native": None}
        if row.get("native"):
            native = {}
            for name, kind in (("station", "station-geographies"), ("context", "assessment-contexts"),
                               ("parcel", "assessment-parcel-contexts")):
                captured = row["native"].get(name)
                if captured is None:
                    native[name] = None
                    continue
                value = _immutable(closure, kind, captured["id"])
                _require(all(value.get(field) == expected for field, expected in captured.items()),
                         "The received assessment changed an original native record")
                native[name] = {"id": value["id"], "title": value["title"],
                                "summary": deepcopy(value["summary"]),
                                "members": _files(closure, value["files"])}
                if name == "context":
                    native[name]["selection"] = deepcopy(value["selection"])
                if name == "parcel":
                    native[name]["study_id"] = value["study_id"]
            view["native"] = native
        result["assessment_sources"].append(view)
    return result
