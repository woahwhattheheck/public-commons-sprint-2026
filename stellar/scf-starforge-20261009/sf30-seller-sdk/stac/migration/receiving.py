# SPDX-License-Identifier: MIT
"""Complete native projects and portable receiving for a migration workspace.

All state, source, style, QGZ, archive and receiving operations use the original
QgisWorkspace engine. This module composes those operations under one retained
request and adds read-only inspection of the original package format.
"""
from __future__ import annotations

import copy
import hashlib
from functools import wraps
import os
import threading
import json
from pathlib import Path
import stat
import zipfile

# Share the exact original modules selected by the migration workspace loader.
from .native import files as native_files, model as original_model, qgis_project as original_qgis
from .native import VectorReceivingSource

CHUNK, HASH, MAX_JSON = original_model.CHUNK, original_model.HASH, original_model.MAX_JSON
PACKAGE_SCHEMA, REQUEST, SNAPSHOT_SCHEMA = (
    original_model.PACKAGE_SCHEMA, original_model.REQUEST, original_model.SNAPSHOT_SCHEMA,
)
QgisWorkspace, descriptor, directory = original_model.QgisWorkspace, original_model.descriptor, original_model.directory
file_digest, json_bytes, member = original_model.file_digest, original_model.json_bytes, original_model.member
receive_package, relative_name, require = original_model.receive_package, original_model.relative_name, original_model.require
sha_bytes, value_sha = original_model.sha_bytes, original_model.value_sha

BUILD_SCHEMA = "starforge.migration-project-build.v1"
INSPECTION_SCHEMA = "starforge.migration-handover-inspection.v1"
STYLE_OPTIONS = frozenset((
    "label", "visible", "opacity", "vectorSubsetString", "crsOverride",
    "styleFile", "styleDependencies",
))


def _native_operation(function):
    """Own an offscreen application only when the caller has no QGIS app."""
    @wraps(function)
    def wrapped(*args, **kwargs):
        from qgis.PyQt.QtCore import QThread
        core = original_qgis.native()
        application = core.QgsApplication.instance()
        own_application = None
        if application is None:
            require(threading.current_thread() is threading.main_thread(),
                    "QGIS_NATIVE_THREAD", "Run the native QGIS operation in its selected Python worker's main thread.")
            os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")
            own_application = core.QgsApplication([], False)
            own_application.initQgis()
        else:
            require(QThread.currentThread() == application.thread(), "QGIS_NATIVE_THREAD",
                    "Run this native operation on the selected QGIS application's thread.")
        try:
            return function(*args, **kwargs)
        finally:
            if own_application is not None:
                own_application.exitQgis()
    return wrapped


def _request(request_id, step):
    """Bounded, stable subrequests; changed input is checked by the journal."""
    return "migration-project-" + value_sha({"requestId": request_id, "step": step})


def _text(value, code, label):
    require(isinstance(value, str) and bool(value.strip()) and "\x00" not in value,
            code, label)
    return value


def _edition(workspace, edition_id):
    edition = workspace.document("edition", edition_id)
    require(isinstance(edition, dict) and edition.get("id") == edition_id,
            "MIGRATION_EDITION", "Select one complete retained migration edition.")
    vector = edition.get("vector")
    require(isinstance(vector, dict) and isinstance(vector.get("manifestSha256"), str)
            and HASH.fullmatch(vector["manifestSha256"]),
            "MIGRATION_VECTOR", "Keep the edition's original complete vector export.")
    vector_path = relative_name(vector.get("path"))
    source_root = directory(workspace.root / vector_path)
    # directory() resolves a path; member() first rejects every symlink component.
    member(workspace.root, vector_path + "/vector-export.json")
    definitions = edition.get("projectDefinitions")
    require(isinstance(definitions, list) and bool(definitions),
            "MIGRATION_PROJECT_SELECTION", "Choose the complete project definitions for this edition.")
    seen = set()
    for definition in definitions:
        require(isinstance(definition, dict), "MIGRATION_PROJECT_DEFINITION",
                "Retain each complete project definition.")
        project_id = _text(definition.get("id"), "MIGRATION_PROJECT_ID",
                           "Use each original migration project identity.")
        require(project_id not in seen, "MIGRATION_PROJECT_ID", "Project identities must be unique.")
        seen.add(project_id)
        _text(definition.get("title"), "MIGRATION_PROJECT_TITLE", "Keep each selected project's title.")
        require(definition.get("format", "GPKG") == "GPKG", "MIGRATION_PROJECT_FORMAT",
                "Select the original GeoPackage output for migration project construction.")
        layer_ids = definition.get("sourceLayerIds")
        require(isinstance(layer_ids, list) and bool(layer_ids)
                and all(isinstance(item, str) and item for item in layer_ids)
                and len(set(layer_ids)) == len(layer_ids),
                "MIGRATION_PROJECT_LAYERS", "Choose each original source layer once, in map order.")
        options = definition.get("layerOptions", {})
        require(isinstance(options, dict) and set(options) <= set(layer_ids),
                "MIGRATION_LAYER_OPTIONS", "Bind display choices to selected original source-layer IDs.")
        for layer_id, settings in options.items():
            require(isinstance(settings, dict) and set(settings) <= STYLE_OPTIONS,
                    "MIGRATION_LAYER_OPTIONS", "Use the original layer display and retained-style controls.",
                    sourceLayerId=layer_id)
        crs = definition.get("projectCrs")
        require(crs is None or isinstance(crs, str) and 0 < len(crs) <= 32000,
                "MIGRATION_PROJECT_CRS", "Retain the selected project CRS definition.")
    return edition, source_root


def _native_definitions(definitions):
    """Project display controls use QGIS native types; original JSON stays bound."""
    projected = []
    for definition in definitions:
        options = {}
        for layer_id, selected in definition.get("layerOptions", {}).items():
            row = {}
            for key, value in selected.items():
                if key == "opacity":
                    exact = native_files.number_decimal(value)
                    require(0 <= exact <= 1, "MIGRATION_LAYER_OPACITY", "Choose an opacity from zero to one.")
                    row[key] = float(exact)
                elif key == "visible":
                    require(type(value) is bool, "MIGRATION_LAYER_VISIBILITY", "Choose visible or hidden.")
                    row[key] = value
                elif key == "styleFile":
                    row[key] = descriptor(value) if value is not None else None
                elif key == "styleDependencies":
                    require(isinstance(value, list), "MIGRATION_LAYER_RESOURCES", "Retain the complete style resource list.")
                    row[key] = [descriptor(item) for item in value]
                elif key == "crsOverride" and value is None:
                    row[key] = None
                else:
                    require(isinstance(value, str), "MIGRATION_LAYER_DISPLAY_TYPE",
                            "Use the original native text display control.", field=key)
                    row[key] = value
            options[layer_id] = row
        projected.append({
            "id": definition["id"], "title": definition["title"],
            "format": definition.get("format", "GPKG"), "projectCrs": definition.get("projectCrs"),
            "sourceLayerIds": list(definition["sourceLayerIds"]), "layerOptions": options,
        })
    return projected


def _layers(source, definition):
    rows = source.asset_rows()
    selected = []
    for layer_id in definition["sourceLayerIds"]:
        candidates = [row for row in rows
                      if row["nativeIdentity"]["sourceLayerId"] == layer_id and row["driver"] == "GPKG"]
        require(len(candidates) == 1, "MIGRATION_NATIVE_LAYER",
                "Each selected source layer must identify one actual GeoPackage output.",
                sourceLayerId=layer_id, matches=[row["nativeIdentity"] for row in candidates])
        original = candidates[0]["nativeIdentity"]
        row = source.layer_definition(original["sourceId"], original["sourceLayerId"], original["layerId"])
        row.update(copy.deepcopy(definition.get("layerOptions", {}).get(layer_id, {})))
        selected.append(row)
    return selected


@_native_operation
def build_projects(workspace, edition_id, *, request_id, actor, expected_revision, progress=None):
    """Build every selected map using original native actions and retained revisions.

    A start event binds the entire immutable edition, selected definitions, actor
    and initial revision before source import. Every subsequent action uses the
    preceding original committed revision. A retry never adopts an unrelated
    newer workspace revision.
    """
    add_to_project, capture_styles = original_qgis.add_to_project, original_qgis.capture_styles
    native, reopen_project, save_project = original_qgis.native, original_qgis.reopen_project, original_qgis.save_project
    require(isinstance(request_id, str) and REQUEST.fullmatch(request_id),
            "MIGRATION_REQUEST", "Use one stable request ID for the complete project build.")
    require(type(expected_revision) is int and expected_revision >= 0,
            "MIGRATION_REVISION", "Use the reviewed workspace revision.")
    _text(actor, "ACTOR_REQUIRED", "Retain the original operator for this project build.")
    edition, source_root = _edition(workspace, edition_id)
    state = workspace.read()
    original = VectorReceivingSource(source_root, edition["vector"]["manifestSha256"],
                                     verify=False, progress=progress)
    original_definitions_json = native_files.canonical(edition["projectDefinitions"])
    definitions = _native_definitions(edition["projectDefinitions"])
    edition_row = next(row for row in state["migration"]["editions"] if row["id"] == edition_id)
    edition_file = descriptor(edition_row["file"])
    file_digest(member(workspace.root, edition_file["path"]), expected=edition_file)
    prepared_layers = [_layers(original, definition) for definition in definitions]
    core = native()
    binding = {
        "schema": BUILD_SCHEMA, "workspaceId": state["id"], "requestId": request_id,
        "actor": actor, "editionId": edition_id, "editionSha256": native_files.digest(edition),
        "editionFile": edition_file, "projectDefinitionsJson": original_definitions_json,
        "sourcePath": edition["vector"]["path"], "sourceManifestSha256": original.id,
        "expectedRevision": expected_revision, "projectDefinitions": definitions,
    }
    signature = value_sha(binding)
    start_id = _request(request_id, "start")
    begun = workspace.operation(start_id, "migration.projects.started", binding)
    if begun is None:
        begun = workspace._mutate(
            expected_revision, start_id, actor, "migration.projects.started", binding,
            lambda current: {"projectBuild": {"input": copy.deepcopy(binding), "inputSha256": signature}},
        )
    cursor = begun["revision"]
    operations = [{"requestId": start_id, "action": begun["event"]["action"], "revision": cursor}]
    current_readbacks = []

    def action(step, function, *args, **kwargs):
        nonlocal cursor
        selected_request = _request(request_id, step)
        result = function(*args, revision=cursor, request_id=selected_request, actor=actor, **kwargs)
        require(result.get("revision") == cursor + 1
                and result.get("event", {}).get("requestId") == selected_request,
                "MIGRATION_PROJECT_SEQUENCE", "Continue the original contiguous project-build actions.")
        cursor = result["revision"]
        operations.append({"requestId": selected_request, "action": result["event"]["action"], "revision": cursor})
        if progress:
            progress({"phase": "migration-project", "step": step, "requestId": request_id,
                      "editionId": edition_id, "revision": cursor})
        return result

    imported = action("source", workspace.import_source, source_root,
                      expected_manifest_sha256=original.id, progress=progress)
    require(imported["source"]["id"] == original.id, "MIGRATION_PROJECT_SOURCE",
            "The project import must retain this edition's original manifest identity.")
    action("source-selection", workspace.activate_source, original.id)
    projects = []
    for definition, layers in zip(definitions, prepared_layers):
        identity = definition["id"]
        action("layers/" + identity, workspace.save_layers, layers)
        style_request = _request(request_id, "styles/" + identity)
        saved_style = workspace.operation(style_request)
        if saved_style is None:
            project = core.QgsProject()
            try:
                add_to_project(workspace, project, progress=progress)
                action("styles/" + identity, capture_styles, workspace, project)
            finally:
                project.clear()
        else:
            action("styles/" + identity, capture_styles, workspace)
        saved = action("map/" + identity, save_project, workspace,
                       project_crs=definition.get("projectCrs"), progress=progress)
        retained = saved["project"]
        opened, readback = reopen_project(workspace, retained["id"], progress=progress)
        try:
            current_readbacks.append(readback)
        finally:
            opened.clear()
        projects.append({
            "definitionId": identity, "title": definition["title"],
            "projectId": retained["id"], "file": copy.deepcopy(retained["file"]),
            "sourceIds": copy.deepcopy(retained["sourceIds"]),
            "inputRevision": retained["inputRevision"], "inputSha256": retained["inputSha256"],
            "layers": copy.deepcopy(retained["layers"]),
            "derivedFiles": copy.deepcopy(retained.get("derivedFiles", [])),
            "nativeReadback": copy.deepcopy(retained["readback"]),
        })
    result = {
        "schema": BUILD_SCHEMA, "requestId": request_id, "inputSha256": signature,
        "workspaceId": state["id"], "editionId": edition_id, "sourceId": original.id,
        "sourceManifestSha256": original.id, "expectedRevision": expected_revision,
        "editionSha256": binding["editionSha256"], "editionFile": edition_file,
        "projectDefinitionsJson": original_definitions_json,
        "projectDefinitions": definitions, "projects": projects,
        "finalProjectRevision": cursor, "operations": operations,
    }
    previously_completed = workspace.operation(request_id) is not None
    completed = workspace.record_project_delivery(
        edition_id, result, revision=cursor, request_id=request_id, actor=actor,
    )
    return {**completed, "projectBuild": result, "replayed": previously_completed,
            "nativeReopen": current_readbacks}


def _json_archive(archive, name, records=None):
    info = archive.getinfo(name)
    require(info.file_size <= MAX_JSON, "PACKAGE_JSON_LIMIT",
            "The complete package metadata exceeds the supported JSON size.", path=name)
    body = archive.read(info)
    if records is not None:
        expected = records[name]
        require(len(body) == expected["bytes"] and sha_bytes(body) == expected["sha256"],
                "PACKAGE_MEMBER_HASH", "The retained package metadata changed.", path=name)

    def pairs(items):
        value = {}
        for key, item in items:
            require(key not in value, "PACKAGE_JSON_KEYS", "Package metadata contains duplicate JSON keys.", path=name)
            value[key] = item
        return value

    def constant(value):
        require(False, "PACKAGE_JSON_NUMBER", "Package metadata requires finite JSON numbers.", path=name)

    value = json.loads(body.decode("utf-8"), object_pairs_hook=pairs, parse_constant=constant)
    return value, body


def inspect_handover(archive_path, *, expected_sha256=None, verify_files=True, progress=None):
    """Inspect the entire original QGIS package without creating a workspace."""
    archive_path = Path(archive_path).expanduser().absolute()
    with original_model.opened_package_archive(
            archive_path, expected_sha256=expected_sha256,
            progress=progress) as (archive, measured, assert_archive):
        names = archive.namelist()
        require(len(names) == len(set(names)) and len(names) <= 1000000
                and "qgis-package.json" in names,
                "PACKAGE_MEMBERS", "Select one complete original QGIS package with unique members.")
        manifest, manifest_body = _json_archive(archive, "qgis-package.json")
        require(isinstance(manifest, dict) and manifest.get("schema") == PACKAGE_SCHEMA
                and isinstance(manifest.get("files"), list),
                "PACKAGE_SCHEMA", "Select the original complete QGIS project archive.")
        records = {}
        for raw in manifest["files"]:
            record = descriptor(raw)
            require(record["path"] not in records and record["path"] != "qgis-package.json",
                    "PACKAGE_MEMBERS", "Every original package member needs one descriptor.")
            records[record["path"]] = record
        require(set(names) == set(records) | {"qgis-package.json"} and "workspace-snapshot.json" in records,
                "PACKAGE_CLOSURE", "Retain the complete declared project and migration file closure.")
        require(manifest.get("totalBytes") == sum(row["bytes"] for row in records.values()),
                "PACKAGE_TOTAL_BYTES", "Keep the complete original package byte inventory.")
        for name in names:
            relative_name(name)
            info = archive.getinfo(name)
            mode = (info.external_attr >> 16) & 0xFFFF
            require(not info.is_dir() and not stat.S_ISLNK(mode)
                    and (not stat.S_IFMT(mode) or stat.S_ISREG(mode)),
                    "PACKAGE_MEMBER_TYPE", "The project archive contains ordinary files only.", path=name)
            if name in records:
                require(info.file_size == records[name]["bytes"], "PACKAGE_MEMBER_SIZE",
                        "The original member size changed.", path=name)
        snapshot, snapshot_body = _json_archive(archive, "workspace-snapshot.json", records)
        require(isinstance(snapshot, dict) and snapshot.get("schema") == SNAPSHOT_SCHEMA
                and isinstance(snapshot.get("state"), dict),
                "SNAPSHOT_IDENTITY", "Keep the complete original workspace snapshot.")
        state = snapshot["state"]
        QgisWorkspace._validate_state(state)
        require(state["id"] == manifest.get("workspaceId")
                and state["revision"] == manifest.get("revision"),
                "SNAPSHOT_IDENTITY", "The package must bind the original workspace and revision.")
        require(isinstance(state.get("migration"), dict), "MIGRATION_WORKSPACE_REQUIRED",
                "Select a complete migration workspace package.")
        require(isinstance(snapshot.get("events"), list) and isinstance(snapshot.get("requests"), list)
                and [row.get("revision") for row in snapshot["events"]] == list(range(1, state["revision"] + 1))
                and len({row.get("requestId") for row in snapshot["requests"]}) == len(snapshot["requests"]),
                "HISTORY_INCOMPLETE", "Keep the original complete revision and request history.")
        if verify_files:
            for index, record in enumerate(records.values(), 1):
                digest, count = hashlib.sha256(), 0
                with archive.open(record["path"]) as stream:
                    while True:
                        block = stream.read(CHUNK)
                        if not block:
                            break
                        count += len(block)
                        require(count <= record["bytes"], "PACKAGE_MEMBER_SIZE",
                                "The package member exceeds its retained byte length.", path=record["path"])
                        digest.update(block)
                        if progress:
                            progress({"phase": "inspect", "path": record["path"], "completedBytes": count,
                                      "totalBytes": record["bytes"], "completedFiles": index - 1,
                                      "totalFiles": len(records)})
                require(count == record["bytes"] and digest.hexdigest() == record["sha256"],
                        "PACKAGE_MEMBER_HASH", "The complete original package member changed.", path=record["path"])
        assert_archive()
        return {
            "schema": INSPECTION_SCHEMA, "path": str(archive_path), **measured,
            "manifestSha256": sha_bytes(manifest_body), "snapshotSha256": sha_bytes(snapshot_body),
            "workspaceId": state["id"], "revision": state["revision"], "title": state["title"],
            "fileCount": len(records) + 1, "totalDecodedBytes": sum(row["bytes"] for row in records.values()),
            "files": list(records.values()), "sources": copy.deepcopy(state["sources"]),
            "projects": copy.deepcopy(state["projects"]), "migration": copy.deepcopy(state["migration"]),
            "history": {"revisions": len(snapshot["events"]), "requests": len(snapshot["requests"])},
            "verification": {"archive": True, "metadata": True, "allMembers": bool(verify_files)},
        }


def export_handover(workspace, destination, *, expected_revision, expected_sha256=None, progress=None):
    """Use the original archive writer; reconcile its completed file after a lost reply."""
    require(type(expected_revision) is int and expected_revision >= 0,
            "MIGRATION_REVISION", "Export the selected original workspace revision.")
    destination = Path(destination).expanduser().absolute()
    require(not destination.is_relative_to(workspace.root), "PACKAGE_OUTPUT_DIRECTORY",
            "Save the complete archive outside the active migration workspace.")
    if destination.exists() or destination.is_symlink():
        retained = inspect_handover(destination, expected_sha256=expected_sha256, progress=progress)
        require(retained["workspaceId"] == workspace.read()["id"] and retained["revision"] == expected_revision,
                "PACKAGE_OPERATION_CHANGED", "This filename contains a different workspace or revision.")
        return {key: retained[key] for key in (
            "path", "bytes", "sha256", "manifestSha256", "workspaceId", "revision",
            "fileCount", "totalDecodedBytes",
        )}
    workspace.verify_migration()
    exported = workspace.export_package(destination, expected_revision=expected_revision, progress=progress)
    require(expected_sha256 is None or exported["sha256"] == expected_sha256,
            "PACKAGE_HASH_CHANGED", "The completed archive differs from the selected transfer.")
    return exported


def _native_available():
    try:
        original_qgis.native()
    except ModuleNotFoundError as error:
        if error.name in ("qgis", "qgis.core"):
            return False
        raise
    return True


@_native_operation
def reopen_handover(workspace, *, progress=None):
    """Reopen every original map and retained cartographic publication."""
    from .cartography import reopen_publications
    native_version, reopen_project = original_qgis.native_version, original_qgis.reopen_project
    workspace.verify_migration()
    snapshot = workspace.snapshot()
    readbacks = []
    for index, record in enumerate(snapshot["state"]["projects"], 1):
        project, readback = reopen_project(workspace, record["id"], progress=progress)
        try:
            readbacks.append(readback)
        finally:
            project.clear()
        if progress:
            progress({"phase": "native-reopen", "projectId": record["id"],
                      "completedProjects": index, "totalProjects": len(snapshot["state"]["projects"])})
    publications = reopen_publications(workspace, progress=progress)
    require(workspace.snapshot() == snapshot, "MIGRATION_RECEIVING_CHANGED",
            "The workspace changed while its complete projects and publications were reopening.")
    return {"available": True, "native": native_version(), "workspaceId": snapshot["state"]["id"],
            "revision": snapshot["state"]["revision"], "projects": readbacks, "publications": publications}


def receive(archive_path, destination, *, expected_sha256, progress=None, native_reopen="auto",
            expected_workspace_id=None):
    """Receive through the original engine, verify migration records and reopen maps.

    native_reopen is 'auto', 'required', or 'skip'. A selected QGIS runtime's real
    load/render/provider errors propagate; only an absent qgis module is reported
    as unavailable by auto mode.
    """
    from .workspace import Workspace
    require(isinstance(expected_sha256, str) and HASH.fullmatch(expected_sha256),
            "PACKAGE_HASH_REQUIRED", "Keep the complete handover's original SHA-256.")
    require(native_reopen in ("auto", "required", "skip"), "NATIVE_RECEIVING_MODE",
            "Choose auto, required or skip for native project reopening.")
    if expected_workspace_id is not None:
        require(isinstance(expected_workspace_id, str) and bool(expected_workspace_id),
                "MIGRATION_WORKSPACE_ID_REQUIRED", "Keep the original incoming workspace ID.")
        selected = inspect_handover(archive_path, expected_sha256=expected_sha256,
                                    verify_files=False, progress=progress)
        require(selected["workspaceId"] == expected_workspace_id, "MIGRATION_WORKSPACE_CHANGED",
                "The selected archive belongs to another original workspace.",
                expectedWorkspaceId=expected_workspace_id, actualWorkspaceId=selected["workspaceId"])
    received = receive_package(archive_path, destination, expected_sha256=expected_sha256, progress=progress)
    workspace = Workspace(received["workspace"].root)
    migration = workspace.verify_migration()
    snapshot = workspace.snapshot()
    available = _native_available() if native_reopen != "skip" else False
    if native_reopen == "required":
        require(available, "QGIS_RUNTIME_REQUIRED", "Run this receiving operation with the selected QGIS Python.")
    native_result = (reopen_handover(workspace, progress=progress) if available else
                     {"available": False, "mode": native_reopen, "projects": []})
    require(workspace.snapshot() == snapshot, "MIGRATION_RECEIVING_CHANGED",
            "The received workspace changed during the original receiving operation.")
    return {**received, "workspace": workspace, "migration": migration, "native": native_result,
            "workspaceId": snapshot["state"]["id"], "currentRevision": snapshot["state"]["revision"]}
