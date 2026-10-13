"""Carry saved Gauge report sources into the existing editable Study transfer.

The dispatcher calls include_source only for explicitly ordered scientific-report
sources. Original CAS bytes, saved selections and result records remain unchanged.
This adapter uses the established closure and its portable snapshot/reopen path.
"""
from __future__ import annotations

from copy import deepcopy
from pathlib import PurePosixPath
import re

from .common import digest, identifier

CONTEXT = "gauge_support"
ROLE = "gauge-support-report-context"
REPORT_SCHEMA = "upstate.observed-report/v1"
GAUGE_SCHEMA = "upstate.gauge-support/v1"
PACKAGE_SCHEMA = "upstate.gauge-support-package/v1"
REPORT_EDITIONS = ("gauge-support-report-1.0.0", "gauge-support-report-1.1.0")


def _member(value):
    if not isinstance(value, str) or "\\" in value or "\0" in value:
        raise ValueError("Gauge source needs canonical original member paths")
    path = PurePosixPath(value)
    if (not path.parts or path.is_absolute() or ".." in path.parts
            or path.as_posix() != value or any(":" in part for part in path.parts)):
        raise ValueError("Gauge source member must remain inside its original edition")
    return value


def _same(left, right):
    return all(left.get(field) == right.get(field) for field in ("bytes", "sha256"))


def _body(closure, descriptor):
    closure.add_file(descriptor["object"], descriptor)
    return closure.read(descriptor["object"])


def _immutable(closure, kind, key):
    key = identifier(key)
    value = closure.read(kind + "/" + key + ".json")
    if value.get("schema") != "upstate." + kind + "/v1" or digest(value) != key:
        raise ValueError("Gauge source lost its original editable " + kind + " record")
    return {**value, "id": key}


def _members(closure, entry, recipe):
    members = {}
    for item in entry.get("companions", []):
        name = _member(item.get("view_path", item["filename"]))
        if name in members:
            raise ValueError("Gauge source repeats an original companion")
        closure.add_file(item["object"], item)
        members[name] = item
    inputs = recipe.get("inputs")
    if not isinstance(inputs, list) or not inputs:
        raise ValueError("Gauge report needs its complete original companion inventory")
    declared = {}
    for item in inputs:
        name = _member(item["path"])
        if name in declared or name not in members or not _same(item, members[name]):
            raise ValueError("Gauge report lost an exact original input: " + name)
        declared[name] = item
    if set(declared) != set(members):
        raise ValueError("Gauge report companions differ from its original source recipe")
    return members


def _original(closure, members, name):
    name = _member(name)
    if name not in members:
        raise ValueError("Gauge source lacks its original member: " + name)
    return _body(closure, members[name])


def _package(closure, members, recipe):
    package = _original(closure, members, "retained/package.json")
    analysis = _original(closure, members, "retained/analysis.json")
    regional = _original(closure, members, "retained/regional-report.json")
    project = recipe["project_id"]
    key = identifier(recipe.get("gauge_support_id"))
    build_id = identifier(recipe.get("gauge_build_id"))
    station_id = identifier(recipe.get("station_edition_id"))
    if (package.get("schema") != PACKAGE_SCHEMA or package.get("project_id") != project
            or package.get("build_id") != build_id
            or package.get("selection") != recipe.get("original_selection")
            or package.get("station_edition_id") != station_id
            or package.get("regional") != recipe.get("regional")):
        raise ValueError("Gauge report changed its retained original package identity")
    if (analysis.get("schema") != GAUGE_SCHEMA or analysis.get("project_id") != project
            or analysis.get("build_id") != build_id
            or analysis.get("selection") != package["selection"]
            or analysis.get("station_edition_id") != station_id
            or analysis.get("regional") != package["regional"]
            or analysis.get("summary") != recipe.get("summary")
            or recipe.get("title") != analysis.get("title", "") + " — gauge support"):
        raise ValueError("Gauge report differs from its original calculated result")
    if "support" in recipe and recipe["support"] != analysis.get("support"):
        raise ValueError("Gauge report changed its original catchment support method")
    reference = recipe.get("regional")
    if (not isinstance(reference, dict)
            or not re.fullmatch(r"watershed-[0-9a-f]{20}", str(reference.get("report_id", "")))
            or regional.get("id") != reference["report_id"]
            or not isinstance(regional.get("hucs"), list) or not regional["hucs"]):
        raise ValueError("Gauge report lost its original regional watershed membership")
    identifier(reference.get("sha256"))
    selection = analysis.get("selection")
    if not isinstance(selection, dict):
        raise ValueError("Gauge report must retain its original support selection")
    hucs = {str(row["huc12"]) for row in regional["hucs"]}
    if not set(selection.get("reporting_huc12s", [])) <= hucs:
        raise ValueError("Gauge report selects watersheds outside its original regional report")
    source_bindings = analysis.get("sources")
    if not isinstance(source_bindings, list) or not source_bindings:
        raise ValueError("Gauge report lost its original geographic and flow source bindings")
    station_build = identifier(analysis.get("station_build_id"))
    build_identity = {
        "version": analysis["version"], "selection": selection, "regional": reference,
        "station_build_id": station_build,
        "sources": [{name: row[name] for name in ("collection_id", "source_id", "source_sha256")}
                    for row in source_bindings],
    }
    if digest(build_identity) != build_id:
        raise ValueError("Gauge support source changed its immutable calculation identity")
    files = {}
    for descriptor in package.get("files", []):
        name = _member(descriptor["path"])
        captured = members.get("retained/" + name)
        if name in files or captured is None or not _same(descriptor, captured):
            raise ValueError("Gauge package lost an exact original member: " + name)
        files[name] = descriptor
    for name in ("analysis.json", "regional-report.json", "catchments.geojson",
                 "regional-hucs.geojson", "gauges.geojson", "original-station-geography.zip"):
        if name not in files:
            raise ValueError("Gauge report lacks its original " + name)
    for name in ("retained/gauge-support.zip", "maps/OPEN_GAUGE_MAPS.html"):
        if name not in members:
            raise ValueError("Gauge report lacks its original portable or geographic product")
    return key, build_id, station_id, package, analysis, regional, files


def _captured_sources(closure, members, package, analysis):
    """Verify packaged source manifests against exact original body/companion bindings."""
    bindings = {}
    for row in analysis["sources"]:
        collection_id = identifier(row.get("collection_id"))
        source_id = row.get("source_id")
        if not isinstance(source_id, str) or not source_id:
            raise ValueError("Gauge result needs an original native source identifier")
        token = (collection_id, source_id)
        if token in bindings or row.get("source_sha256") != row.get("body", {}).get("sha256"):
            raise ValueError("Gauge result repeats or changes an original source binding")
        bindings[token] = row
    actual = set()
    collections = set()
    for manifest_row in package.get("source_manifests", []):
        collection_id = identifier(manifest_row.get("original_collection_id"))
        if collection_id in collections:
            raise ValueError("Gauge package repeats an original source collection")
        collections.add(collection_id)
        prefix = "retained_sources/" + collection_id + "/"
        if (manifest_row.get("path") != prefix + "sources.json"
                or manifest_row.get("original_manifest_path") != prefix + "original_manifest.json"):
            raise ValueError("Gauge package changed its original source manifest path")
        manifest = _original(closure, members, "retained/" + manifest_row["path"])
        if manifest.get("schema") != "upstate.sources/v1":
            raise ValueError("Gauge package source manifest has another schema")
        _original(closure, members, "retained/" + manifest_row["original_manifest_path"])
        for entry in manifest.get("entries", []):
            source_id = entry.get("id")
            token = (collection_id, source_id)
            original = bindings.get(token)
            origin = {"collection_id": collection_id, "source_id": source_id,
                      "source_sha256": original["source_sha256"]} if original else None
            if original is None or token in actual or entry.get("origin_ref") != origin:
                raise ValueError("Gauge source manifest differs from its calculated source roster")
            metadata = original["source_metadata"]
            for field, value in metadata.items():
                # The maintained package writer reconstructs these receiving fields.
                # Their exact current values are verified against the binding below.
                if field in ("origin_ref", "path", "sha256", "companions"):
                    continue
                if entry.get(field) != value:
                    raise ValueError("Gauge source metadata changed: " + str(field))
            if entry.get("sha256") != original["source_sha256"]:
                raise ValueError("Gauge source manifest changed its original body")
            authored = [{"path": entry["path"], "sha256": entry["sha256"]},
                        *entry.get("companions", [])]
            retained = [original["body"], *original.get("companions", [])]
            if len(authored) != len(retained):
                raise ValueError("Gauge source manifest lost an original companion")
            for descriptor, before in zip(authored, retained):
                name = "retained/" + prefix + _member(descriptor["path"])
                captured = members.get(name)
                if (captured is None or not _same(captured, before)
                        or descriptor.get("sha256") != before["sha256"]):
                    raise ValueError("Gauge report changed an original geographic/flow source member")
            actual.add(token)
    if actual != set(bindings):
        raise ValueError("Gauge report omitted an original source collection or entry")
    return bindings


def _source_collections(closure, bindings):
    for (collection_id, source_id), binding in sorted(bindings.items()):
        value = closure.read("sources/" + collection_id + ".json")
        if value.get("schema") != "upstate.sources/v1" or digest(value) != collection_id:
            raise ValueError("Gauge editable source collection changed")
        matches = [row for row in value.get("entries", []) if row.get("id") == source_id]
        if len(matches) != 1:
            raise ValueError("Gauge editable source lost its exact original entry")
        entry = matches[0]
        metadata = {name: item for name, item in entry.items() if name not in ("body", "companions")}
        if (metadata != binding.get("source_metadata")
                or entry.get("body") != binding.get("body")
                or entry.get("companions", []) != binding.get("companions", [])):
            raise ValueError("Gauge report differs from its editable original source")
        closure.need("sources", collection_id, "Original Gauge geographic and flow sources")


def _saved_package(closure, prefix, record, schema):
    files = {}
    for item in record.get("files", []):
        path = _member(item["path"])
        if not path.startswith(prefix) or path in files:
            raise ValueError("Gauge study file leaves its original saved edition")
        closure.add_file(path, item)
        files[path] = item
    package_path = prefix + "package.json"
    if package_path not in files:
        raise ValueError("Gauge study lacks its original portable package")
    package = closure.read(package_path)
    if package.get("schema") != schema or package.get("build_id") != record["build_id"]:
        raise ValueError("Gauge study package has another original identity")
    for item in package.get("files", []):
        path = prefix + _member(item["path"])
        closure.add_file(path, item)
    pointer = closure.read(prefix + "edition.json")
    if pointer != {"id": record["id"], "build_id": record["build_id"]}:
        raise ValueError("Gauge study lost its original saved-edition pointer")
    return package, files


def _station(closure, key, captured, gauge_members):
    station = _immutable(closure, "station-geographies", key)
    if station["build_id"] != captured["station_build_id"]:
        raise ValueError("Gauge source and original Station Geography builds differ")
    prefix = "station-geography/" + identifier(station["build_id"]) + "/"
    package, files = _saved_package(closure, prefix, station, "upstate.station-geography-package/v1")
    if (package.get("project_id") != closure.workspace.project["id"]
            or package.get("selection") != station.get("selection")):
        raise ValueError("Station Geography package belongs to another original project/selection")
    analysis = closure.read(prefix + "analysis.json")
    if (analysis.get("schema") != "upstate.station-geography-result/v1"
            or analysis.get("project_id") != closure.workspace.project["id"]
            or analysis.get("build_id") != station["build_id"]
            or analysis.get("selection") != station["selection"]
            or analysis.get("sources") != station["sources"]):
        raise ValueError("Station Geography changed its original saved calculation")
    archive = files.get(prefix + "station-geography.zip")
    if archive is None or not _same(archive, gauge_members["retained/original-station-geography.zip"]):
        raise ValueError("Gauge report and editable Station Geography archives differ")
    source_bindings = {(row["collection_id"], row["source_id"]): row for row in station["sources"]}
    _source_collections(closure, source_bindings)
    for observation_id in station.get("observation_ids", []):
        closure.need("observations", identifier(observation_id), "Original Station Geography observations")
    collection_id = station.get("source_collection_id")
    if collection_id:
        closure.need("sources", identifier(collection_id), "Original Station Geography spatial layers")
    closure.tree(prefix.rstrip("/"))
    return station


def _regional(closure, reference, captured):
    key = reference["report_id"]
    prefix = "watershed-context/" + key + "/"
    record = closure.read(prefix + "operator-report.json")
    if (record.get("schema") != "upstate.operator-watershed-context/v1"
            or record.get("id") != key or record.get("state") != "complete"
            or record.get("source_fingerprint") != reference.get("source_fingerprint")):
        raise ValueError("Gauge report and retained regional report have different identities")
    files = record.get("files")
    if not isinstance(files, dict):
        raise ValueError("Original regional report lacks its full member inventory")
    for name, item in files.items():
        relative = _member(item.get("path", name))
        closure.add_file(prefix + relative, item)
    descriptor = files.get("watershed-context.json")
    if descriptor is None or descriptor.get("sha256") != reference["sha256"]:
        raise ValueError("Gauge report changed its original regional result bytes")
    if closure.read(prefix + "watershed-context.json") != captured:
        raise ValueError("Gauge source changed its captured original regional result")
    edition = reference.get("source_edition_fingerprint")
    if edition and (record.get("source_edition_fingerprint") != edition
                    and edition not in record.get("source_editions", {})):
        raise ValueError("Gauge study lost its originally selected regional source edition")
    # Retain the complete local original-source copies and appended source editions.
    # Absolute acquisition paths are provenance; the operator reopens this saved tree.
    closure.tree(prefix.rstrip("/"))
    closure._source_refs(record, "Original regional watershed source collections")
    return record


def _report_capture(closure, entry, recipe, members, build_id, gauge_id):
    base = "gauge-support/" + build_id + "/report-context"
    folder = closure.root / base
    candidates = []
    source_suffix = entry["id"].removeprefix("gauge-support-report-")
    if len(source_suffix) != 20 or not re.fullmatch(r"[0-9a-f]{20}", source_suffix):
        raise ValueError("Gauge report source lost its original operation identifier")
    if folder.is_symlink() or not folder.is_dir():
        raise ValueError("Gauge report lacks its original native source capture")
    for directory in sorted(folder.iterdir()):
        if (directory.is_dir() and not directory.is_symlink()
                and re.fullmatch(r"[0-9a-f]{64}", directory.name)
                and directory.name.startswith(source_suffix)):
            candidates.append(directory.name)
    if len(candidates) != 1:
        raise ValueError("Choose the exact original Gauge report capture")
    operation_id = candidates[0]
    prefix = base + "/" + operation_id + "/"
    record = closure.read(prefix + "registered-context.json")
    if (record.get("schema") != "upstate.gauge-report-context/v1"
            or record.get("operation_id") != operation_id
            or record.get("workspace_id") != recipe["project_id"]
            or record.get("gauge_support_id") != gauge_id
            or record.get("gauge_build_id") != build_id
            or record.get("source_id") != entry["id"]):
        raise ValueError("Gauge report lost its original registered source capture")
    source = record.get("source")
    if not isinstance(source, dict) or source.get("source_id") != entry["id"]:
        raise ValueError("Gauge report capture lacks its original source selector")
    source_collection = identifier(source.get("source_collection_id"))
    collection = closure.read("sources/" + source_collection + ".json")
    entries = [row for row in collection.get("entries", []) if row.get("id") == entry["id"]]
    if (collection.get("schema") != "upstate.sources/v1" or digest(collection) != source_collection
            or len(entries) != 1 or not _same(entries[0]["body"], entry["body"])):
        raise ValueError("Gauge report lost its original imported source edition")
    closure.need("sources", source_collection, "Original registered Gauge scientific report")
    for descriptor in record.get("files", []):
        path = _member(descriptor["path"])
        if not path.startswith(prefix):
            raise ValueError("Gauge report capture member belongs to another operation")
        closure.add_file(path, descriptor)
    if closure.read(prefix + "gauge-report.json") != recipe:
        raise ValueError("Gauge report source differs from its native recipe")
    closure.add_file(prefix + "gauge-report.json", entry["body"])
    for name, descriptor in members.items():
        closure.add_file(prefix + name, descriptor)
    closure.tree(prefix.rstrip("/"))
    return operation_id


def include_source(closure, collection_id, entry):
    """Retain complete Gauge lineage only for an explicitly selected report source."""
    metadata = entry.get("metadata") or {}
    if metadata.get("report_context_kind") != CONTEXT and entry.get("role") != ROLE:
        return False
    identifier(collection_id)
    recipe = _body(closure, entry["body"])
    if (entry.get("kind") != "document" or entry.get("role") != ROLE
            or metadata.get("report_schema") != REPORT_SCHEMA
            or recipe.get("schema") != REPORT_SCHEMA
            or recipe.get("report_context_kind") != CONTEXT
            or recipe.get("edition") not in REPORT_EDITIONS):
        raise ValueError("Gauge report differs from its declared original producer")
    project = recipe.get("project_id")
    if not isinstance(project, str) or not project:
        raise ValueError("Gauge report lacks its original project identity")
    gauge_id = identifier(recipe.get("gauge_support_id"))
    if (entry.get("uri") != "workspace://" + project + "/gauge-support/" + gauge_id
            or metadata.get("gauge_support_id") != gauge_id
            or metadata.get("regional_report_id") != (recipe.get("regional") or {}).get("report_id")):
        raise ValueError("Gauge report changed its source, project or regional identity")
    members = _members(closure, entry, recipe)
    key, build_id, station_id, package, analysis, regional, files = _package(closure, members, recipe)
    source_bindings = _captured_sources(closure, members, package, analysis)
    local = project == closure.workspace.project["id"]
    required, operation_id = [], None
    if local:
        gauge = _immutable(closure, "gauge-support", key)
        if any(gauge.get(name) != analysis.get(name) for name in (
                "version", "title", "created_at", "build_id", "selection", "summary",
                "regional", "station_edition_id", "sources")):
            raise ValueError("Gauge source and original editable edition differ")
        prefix = "gauge-support/" + build_id + "/"
        local_package, saved_files = _saved_package(closure, prefix, gauge, PACKAGE_SCHEMA)
        if local_package != package:
            raise ValueError("Gauge source and original editable package differ")
        for name, descriptor in members.items():
            if name.startswith("retained/"):
                closure.add_file(prefix + name[len("retained/"):], descriptor)
        if closure.read(prefix + "analysis.json") != analysis:
            raise ValueError("Gauge source changed its original calculated values")
        _source_collections(closure, source_bindings)
        station = _station(closure, station_id, analysis, members)
        regional_record = _regional(closure, recipe["regional"], regional)
        operation_id = _report_capture(closure, entry, recipe, members, build_id, gauge_id)
        required = [{"kind": "gauge-support", "id": gauge_id},
                    {"kind": "station-geographies", "id": station_id},
                    {"kind": "watershed-context", "id": recipe["regional"]["report_id"]}]
        for kind, record, title in (
                ("gauge-support", gauge, "Original Gauge support"),
                ("station-geographies", station, "Original Station Geography"),
                ("watershed-context", regional_record, "Original regional watershed context")):
            closure.nodes.setdefault((kind, record["id"]), {
                "kind": kind, "id": record["id"], "state": "complete",
                "title": record.get("title") or title,
                "reasons": ["Editable source of the selected Gauge scientific report"],
            })
    binding = {
        "schema": "upstate.study-report-lineage/v1", "report_context_kind": CONTEXT,
        "source_collection_id": collection_id, "source_id": entry["id"],
        "source_body_sha256": entry["body"]["sha256"], "source_project_id": project,
        "gauge_support_id": gauge_id, "gauge_build_id": build_id,
        "station_edition_id": station_id, "station_build_id": analysis["station_build_id"],
        "regional": deepcopy(recipe["regional"]), "producer_edition": recipe["edition"],
        "source_choices": [{"source_collection_id": key[0], "source_id": key[1],
                            "source_body_sha256": row["source_sha256"]}
                           for key, row in sorted(source_bindings.items())],
        "support": deepcopy(recipe.get("support", analysis.get("support"))),
        "original_selection": deepcopy(recipe["original_selection"]),
        "relationship": "same_project" if local else "external_project",
        "native_report_operation_id": operation_id, "required_records": required,
    }
    token = (collection_id, entry["id"])
    previous = closure.report_source_records.get(token)
    if previous is not None and previous != binding:
        raise ValueError("Gauge scientific source changed during selected-study capture")
    closure.report_source_records[token] = binding
    return True


def lock_paths(closure):
    """Return only the actual report producer locks for retained local captures.

    Study capture already holds the original Workspace lock used by regional
    source updates. Gauge and Station Geography records/packages are immutable.
    """
    return sorted({
        "locks/gauge-report-" + identifier(row["native_report_operation_id"]) + ".lock"
        for row in closure.report_source_records.values()
        if row.get("report_context_kind") == CONTEXT
        and row.get("relationship") == "same_project"
        and row.get("native_report_operation_id")
    })
