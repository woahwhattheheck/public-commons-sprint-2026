#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""Continue one accepted PostGIS receipt through the maintained QGIS workspace.

This is an executable receiving workflow, not a replacement QGIS engine. It
requires the actual QGIS Python runtime, an accepted original database receipt,
and an already configured local service/authentication profile. It performs no
database writes, changes no account, and retains all original operation IDs.
"""
from __future__ import annotations

import argparse
import contextlib
import copy
import gc
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import sys
import tempfile
import time
import zipfile

SCHEMA = "starforge.postgis-qgis-native-handoff.v1"
HASH = re.compile(r"^[a-f0-9]{64}$")
OPERATION = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.:-]{0,119}$")


def require(ok, message):
    if not ok:
        raise ValueError(message)


def raw_json(value):
    return (json.dumps(value, ensure_ascii=False, allow_nan=False,
                       sort_keys=True, separators=(",", ":")) + "\n").encode("utf-8")


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def read_json(path, limit=256 * 1024 * 1024):
    require(not path.is_symlink() and path.is_file(), "Use the original ordinary JSON file.")
    with path.open("rb") as stream:
        raw = stream.read(limit + 1)
    require(len(raw) <= limit, "The original JSON file exceeds its declared bound.")
    return json.loads(raw.decode("utf-8")), raw


def ordinary_directory(value):
    require(isinstance(value, str) and Path(value).is_absolute(), "Use an absolute selected directory.")
    path = Path(value)
    require(not any(parent.is_symlink() for parent in (path, *path.parents)),
            "Preserve the selected ordinary directory and every original parent.")
    return path


def make_private(path):
    require(not path.is_symlink(), "Use an ordinary private directory.")
    path.mkdir(mode=0o700, parents=True, exist_ok=True)
    require(path.is_dir(), "The selected directory is not a directory.")
    require(os.name != "posix" or not (path.stat().st_mode & 0o077),
            "Use a private directory accessible only to this operator.")
    return path


def publish(path, raw):
    """Create only, or verify the identical original publication."""
    path = Path(path)
    make_private(path.parent)
    if path.exists() or path.is_symlink():
        require(not path.is_symlink() and path.is_file() and path.read_bytes() == raw,
                "Preserve the different original output: " + path.name)
        return
    fd, name = tempfile.mkstemp(prefix=".qgis-continuation-", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(raw)
            stream.flush()
            os.fsync(stream.fileno())
        try:
            os.link(name, path)
        except FileExistsError:
            require(not path.is_symlink() and path.is_file() and path.read_bytes() == raw,
                    "A different original publication won this output.")
        if os.name == "posix":
            parent = os.open(path.parent, os.O_RDONLY)
            try:
                os.fsync(parent)
            finally:
                os.close(parent)
    finally:
        Path(name).unlink(missing_ok=True)


def verify_record(path, record):
    require(not path.is_symlink() and path.is_file(), "Keep the original ordinary output file.")
    hasher, count = hashlib.sha256(), 0
    with path.open("rb") as stream:
        while True:
            chunk = stream.read(1024 * 1024)
            if not chunk:
                break
            count += len(chunk)
            require(count <= record["bytes"], "The original output length changed.")
            hasher.update(chunk)
    require(count == record["bytes"] and hasher.hexdigest() == record["sha256"],
            "The original output bytes changed.")


def publish_json(path, value):
    publish(path, raw_json(value))
    return value


@contextlib.contextmanager
def operation_lock(root):
    """One local continuation owns this original operation; no new scheduler."""
    path = root / "continuation.lock"
    require(not path.is_symlink(), "Preserve the original ordinary operation lock.")
    fd = os.open(path, os.O_RDWR | os.O_CREAT | getattr(os, "O_NOFOLLOW", 0), 0o600)
    handle = os.fdopen(fd, "r+b")
    require(stat.S_ISREG(os.fstat(handle.fileno()).st_mode), "Use the original ordinary operation lock.")
    try:
        if os.name == "posix":
            import fcntl
            os.chmod(path, 0o600)
            fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        else:
            import msvcrt
            handle.seek(0)
            if not handle.read(1):
                handle.write(b"0")
                handle.flush()
            handle.seek(0)
            msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
        yield
    finally:
        handle.close()


def checked_handoff(path):
    handoff, raw = read_json(path, limit=16 * 1024 * 1024)
    require(isinstance(handoff, dict) and handoff.get("schema") == SCHEMA,
            "Use the original PostGIS to QGIS receiving handoff.")
    require(OPERATION.fullmatch(handoff.get("operationId", "")), "Retain one explicit operation ID.")
    require(isinstance(handoff.get("actor"), str) and 0 < len(handoff["actor"].strip()) <= 240,
            "Identify the receiving operator.")
    require(isinstance(handoff.get("title"), str) and handoff["title"].strip(),
            "Give the original QGIS project a title.")
    require(HASH.fullmatch(handoff.get("expectedManifestSha256", "")),
            "Bind the exact accepted PostGIS receiving manifest.")
    for field in ("applicationDirectory", "sourceDirectory", "workspaceDirectory",
                  "receivingDirectory", "outputDirectory", "qgisProfileDirectory"):
        ordinary_directory(handoff.get(field))
    require(isinstance(handoff.get("layerIds"), list) and handoff["layerIds"] and
            all(isinstance(value, str) and value for value in handoff["layerIds"]) and
            len(set(handoff["layerIds"])) == len(handoff["layerIds"]),
            "Select the exact accepted layer IDs once.")
    require(isinstance(handoff.get("connection"), dict), "Select the original local connection profile.")
    require(type(handoff.get("requireUnchangedRows", True)) is bool,
            "Use a boolean current-row comparison choice.")
    require(handoff.get("projectCrs") is None or isinstance(handoff["projectCrs"], str),
            "Select a native QGIS project CRS or retain the original layer CRS.")
    roots = [ordinary_directory(handoff[name]) for name in
             ("workspaceDirectory", "receivingDirectory", "outputDirectory")]
    require(all(a != b and not a.is_relative_to(b) and not b.is_relative_to(a)
                for index, a in enumerate(roots) for b in roots[index + 1:]),
            "Keep the original workspace, receiving copy and output in separate directories.")
    return handoff, raw


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--handoff", required=True)
    parser.add_argument("--qgis-prefix")
    args = parser.parse_args(argv)
    handoff, original_bytes = checked_handoff(Path(args.handoff).absolute())
    output = make_private(ordinary_directory(handoff["outputDirectory"]))
    operation_id = handoff["operationId"]
    operation_root = make_private(output / ("operation-" + digest(operation_id.encode())[:32]))

    with operation_lock(operation_root):
        publish(operation_root / "handoff.json", original_bytes)
        completed = output / "qgis-native-result.json"
        if completed.exists():
            result, _ = read_json(completed)
            require(result.get("schema") == "starforge.postgis-qgis-native-result.v1" and
                    result.get("state") == "complete" and
                    result.get("operationId") == operation_id and
                    result.get("sourceId") == handoff["expectedManifestSha256"],
                    "Preserve the completed original receiving result.")
            archive = output / "Starforge_PostGIS_QGIS_Complete_Project.zip"
            expected = result["completePackage"]
            require(str(archive) == expected["path"], "Keep the original complete package path.")
            verify_record(archive, expected)
            for image in result.get("images", []):
                if image.get("file"):
                    name = image["file"]["path"]
                    require(name in ("PostGIS_QGIS_Received_Map.png", "PostGIS_QGIS_Reopened_Map.png"),
                            "Keep the original rendered map filenames.")
                    verify_record(output / name, image["file"])
            for observed in result.get("nativeObservations", []):
                name = observed.get("path")
                require(isinstance(name, str), "Retain each original observation pathname.")
                path = output / name
                require(path.parent == operation_root / "native-observations" and
                        re.fullmatch(r"(?:original|received)-native-(?:reopen|refresh)-[a-f0-9]{64}\.json",
                                     path.name) is not None,
                        "Keep the original receiving observation directory.")
                verify_record(path, observed)
            print(json.dumps({"operationId": operation_id, "state": "complete",
                              "replayed": True, "result": str(completed),
                              "sha256": expected["sha256"]}), flush=True)
            return 0
        return continue_receiving(handoff, operation_root, output, args.qgis_prefix)


def continue_receiving(handoff, operation_root, output, qgis_prefix):
    application = ordinary_directory(handoff["applicationDirectory"])
    package_root = application / "stac" / "qgis"
    require((package_root / "starforge_stac" / "postgis" / "__init__.py").is_file(),
            "Use the complete original application checkout with its PostGIS adapter.")
    sys.path.insert(0, str(package_root))
    from starforge_stac.model import (QgisWorkspace, receive_package, file_digest,
                                     json_bytes, value_sha, open_receiving_source)
    from starforge_stac.qgis_project import (native_version, save_project,
                                            reopen_project)
    from starforge_stac.postgis.native import record_check, save_selection, refresh_project
    from starforge_stac.postgis.source import connection_profile

    workspace_path = ordinary_directory(handoff["workspaceDirectory"])
    workspace = QgisWorkspace(workspace_path, create=True, title=handoff["title"])
    original_state_file = operation_root / "workspace-before.json"
    if original_state_file.exists():
        original_state, _ = read_json(original_state_file)
    else:
        original_state = workspace.snapshot()
        publish_json(original_state_file, original_state)
    require(original_state["state"]["id"] == workspace.read()["id"],
            "Preserve the same original QGIS workspace across continuation.")
    imported_prior = workspace.operation(handoff["operationId"] + ":source-import",
        "source.imported", {"sourceId": handoff["expectedManifestSha256"]})
    source = workspace.source(handoff["expectedManifestSha256"], verify=True) if imported_prior else \
        open_receiving_source(handoff["sourceDirectory"], handoff["expectedManifestSha256"])
    require(source.sourceKind == "postgis", "The original receipt is not an accepted PostGIS source.")
    require(set(handoff["layerIds"]) <= set(source.layers), "Select only original accepted relations.")
    connection = connection_profile(handoff["connection"], source.manifest)
    require(not connection["allowEditing"], "Use a read-only QGIS selection for this receiving continuation.")
    qgis_profile = ordinary_directory(handoff["qgisProfileDirectory"])
    require(qgis_profile.is_dir() and not qgis_profile.is_symlink(),
            "Configure the actual QGIS service/authentication profile before receiving.")
    require(os.name != "posix" or not (qgis_profile.stat().st_mode & 0o077),
            "The QGIS authentication profile must be private.")
    os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")
    from qgis.core import (QgsApplication, QgsMapSettings, QgsMapRendererSequentialJob,
                          QgsProject, QgsRectangle)
    from qgis.PyQt.QtCore import QSize
    from qgis.PyQt.QtGui import QColor, QImage

    require(QgsApplication.instance() is None,
            "Run this standalone continuation with its own actual QGIS application.")
    if qgis_prefix:
        prefix = ordinary_directory(qgis_prefix)
        require(prefix.is_dir(), "The explicitly selected QGIS prefix is unavailable.")
        QgsApplication.setPrefixPath(str(prefix), True)
    app = QgsApplication([], False, str(qgis_profile))
    app.initQgis()
    projects = []
    start = time.monotonic()
    last_progress = [0.0]

    def progress(event):
        now = time.monotonic()
        if now - last_progress[0] >= 2 or (event.get("phase") == "file-complete" and
                event.get("completedFiles") == event.get("totalFiles")):
            print(json.dumps({"operationId": handoff["operationId"], "progress": event},
                             ensure_ascii=False, allow_nan=False), flush=True)
            last_progress[0] = now

    def step(name, request_factory, invoke):
        path = operation_root / (name + ".request.json")
        if path.exists():
            request, _ = read_json(path)
        else:
            request = request_factory()
            publish_json(path, request)
        require(request.get("requestId") == handoff["operationId"] + ":" + name and
                request.get("actor") == handoff["actor"],
                "Keep the original action ID, actor and exact request.")
        result = invoke(request)
        publish_json(operation_root / (name + ".result.json"), result)
        print(json.dumps({"operationId": handoff["operationId"], "stage": name,
                          "revision": result.get("revision")}), flush=True)
        return result

    def change_request(**body):
        return {"revision": workspace.read()["revision"], "actor": handoff["actor"], **body}

    def observation_value(phase, value):
        """Compare only the native report's defined observation-time fields."""
        require(phase in ("original-native-reopen", "original-native-refresh",
                          "received-native-reopen", "received-native-refresh"),
                "Use the original named native receiving phase.")
        result = copy.deepcopy(value)
        require(isinstance(result, dict) and isinstance(result.get("layers"), list),
                "Retain the complete original native layer report.")
        for row in result["layers"]:
            require(isinstance(row, dict), "Retain each original native layer observation.")
            if phase.endswith("-reopen"):
                native = row.get("native")
                require(isinstance(native, dict), "Retain the original reopened provider report.")
                observed = native.get("postgis")
            else:
                observed = row.get("readback")
            if observed is not None:
                require(isinstance(observed, dict), "Retain the original database readback.")
                # This is preflight's own timestamp, not an original source field.
                # Every substantive value, including count, extent, role and binding,
                # remains in the comparison. The complete timestamped report is saved.
                observed.pop("checkedAt", None)
        return result

    def retain_observation(phase, value):
        comparable = observation_value(phase, value)
        observed = {
            "schema": "starforge.postgis-qgis-native-observation.v1",
            "operationId": handoff["operationId"], "phase": phase,
            "observationSha256": digest(raw_json(value)),
            "comparisonSha256": digest(raw_json(comparable)), "report": value}
        raw = raw_json(observed)
        archive = make_private(operation_root / "native-observations")
        publish(archive / (phase + "-" + digest(raw) + ".json"), raw)
        original_path = operation_root / (phase + ".json")
        if original_path.exists():
            original, _ = read_json(original_path)
            require(observation_value(phase, original) == comparable,
                    "The resumed native report changed beyond its observation time. "
                    "Preserve both observations and review the original receiving operation.")
            return original
        return publish_json(original_path, value)

    def observation_history():
        history = []
        archive = operation_root / "native-observations"
        for path in sorted(archive.iterdir()):
            match = re.fullmatch(
                r"((?:original|received)-native-(?:reopen|refresh))-([a-f0-9]{64})\.json",
                path.name)
            require(match is not None, "Preserve the original native observation catalogue.")
            value, raw = read_json(path)
            require(digest(raw) == match.group(2) and
                    value.get("schema") == "starforge.postgis-qgis-native-observation.v1" and
                    value.get("operationId") == handoff["operationId"] and
                    value.get("phase") == match.group(1) and
                    value.get("observationSha256") == digest(raw_json(value.get("report"))) and
                    value.get("comparisonSha256") == digest(raw_json(
                        observation_value(value["phase"], value["report"]))),
                    "Keep the exact original native observation and receiving identity.")
            history.append({"path": path.relative_to(output).as_posix(),
                            **file_digest(path), "phase": value["phase"],
                            "observationSha256": value["observationSha256"],
                            "comparisonSha256": value["comparisonSha256"]})
        return history

    def render(project, name):
        path = output / name
        manifest_path = operation_root / (name + ".json")
        if manifest_path.exists():
            record, _ = read_json(manifest_path)
            if record.get("file"):
                file_digest(path, expected=record["file"])
            return record
        layers = [layer for layer in project.layerTreeRoot().layerOrder()
                  if project.layerTreeRoot().findLayer(layer.id()).isVisible()]
        image_binding = {"operationId": handoff["operationId"], "sourceId": source.id,
                         "projectId": project_id,
                         "projectInputSha256": saved["project"]["inputSha256"],
                         "connectionSha256": value_sha(connection)}
        binding_text = raw_json(image_binding).decode("utf-8")
        if path.exists():
            require(not path.is_symlink() and path.is_file(),
                    "Preserve the original ordinary rendered map.")
            recovered = QImage(str(path))
            require(not recovered.isNull() and recovered.text("starforge.receiving") == binding_text and
                    recovered.width() == 1440 and recovered.height() == 900,
                    "The existing map does not bind this original receiving operation.")
            return publish_json(manifest_path, {"state": "rendered",
                "width": recovered.width(), "height": recovered.height(),
                "layerCount": len(layers),
                "file": {"path": name, **file_digest(path)}})
        extent = QgsRectangle(project.viewSettings().fullExtent())
        if not layers or extent.isNull():
            return publish_json(manifest_path, {"state": "no_visible_geometry_extent",
                                                "layerCount": len(layers)})
        size = max(extent.width(), extent.height())
        extent.grow(size * 0.03 if size > 0 else 1.0)
        settings = QgsMapSettings()
        settings.setLayers(layers)
        settings.setDestinationCrs(project.crs())
        settings.setTransformContext(project.transformContext())
        settings.setExtent(extent)
        settings.setOutputSize(QSize(1440, 900))
        settings.setOutputDpi(96)
        settings.setBackgroundColor(QColor("white"))
        job = QgsMapRendererSequentialJob(settings)
        job.start()
        job.waitForFinished()
        errors = list(job.errors())
        require(not errors, "The actual QGIS renderer reported a layer error.")
        image = job.renderedImage()
        require(not image.isNull(), "The actual QGIS renderer did not return an image.")
        image.setText("starforge.receiving", binding_text)
        fd, temporary = tempfile.mkstemp(prefix=".native-map-", suffix=".png", dir=output)
        os.close(fd)
        try:
            require(image.save(temporary, "PNG"), "QGIS could not save the actual rendered map.")
            raw = Path(temporary).read_bytes()
            publish(path, raw)
        finally:
            Path(temporary).unlink(missing_ok=True)
        record = {"state": "rendered", "width": image.width(), "height": image.height(),
                  "layerCount": len(layers),
                  "file": {"path": name, **file_digest(path)}}
        return publish_json(manifest_path, record)

    try:
        version = native_version()
        imported = step("source-import", lambda: change_request(
            requestId=handoff["operationId"] + ":source-import",
            sourceDirectory=handoff["sourceDirectory"],
            expectedManifestSha256=handoff["expectedManifestSha256"]),
            lambda request: workspace.import_source(request["sourceDirectory"],
                expected_manifest_sha256=request["expectedManifestSha256"],
                revision=request["revision"], request_id=request["requestId"],
                actor=request["actor"], progress=progress))
        source_id = imported["source"]["id"]
        require(source_id == source.id, "The native workspace retained a different original source.")
        source = workspace.source(source_id, verify=True, progress=progress)

        checked = step("native-check", lambda: change_request(
            requestId=handoff["operationId"] + ":native-check", sourceId=source_id,
            layerIds=handoff["layerIds"], connection=connection),
            lambda request: record_check(workspace, request["sourceId"], request["layerIds"],
                request["connection"], revision=request["revision"],
                request_id=request["requestId"], actor=request["actor"], progress=progress))
        if handoff.get("requireUnchangedRows", True):
            require(not any(row["changedSinceReceipt"] for row in checked["report"]["layers"]),
                    "Current role-visible rows differ from the accepted receipt. Keep this observation and review the original changes.")

        def selection_request():
            definitions = copy.deepcopy(workspace.read()["layers"])
            by_id = {row["id"]: row for row in definitions}
            for layer_id in handoff["layerIds"]:
                selected = source.layer_definition(layer_id, connection)
                existing = by_id.get(selected["id"])
                if existing is not None:
                    require(existing.get("sourceId") == selected["sourceId"] and
                            existing.get("postgis") == selected["postgis"],
                            "Retain the existing layer and explicitly review its different source or connection.")
                else:
                    definitions.append(selected)
                    by_id[selected["id"]] = selected
            return change_request(requestId=handoff["operationId"] + ":retain-layers",
                                  layers=definitions)

        retained = step("retain-layers", selection_request,
            lambda request: save_selection(workspace, request["layers"],
                revision=request["revision"], request_id=request["requestId"],
                actor=request["actor"]))
        saved = step("save-project", lambda: change_request(
            requestId=handoff["operationId"] + ":save-project",
            projectCrs=handoff.get("projectCrs")),
            lambda request: save_project(workspace, revision=request["revision"],
                request_id=request["requestId"], actor=request["actor"],
                project_crs=request["projectCrs"], progress=progress))
        project_id = saved["project"]["id"]
        project, reopened = reopen_project(workspace, project_id, progress=progress)
        projects.append(project)
        refreshed = refresh_project(workspace, project, progress=progress)
        reopened = retain_observation("original-native-reopen", reopened)
        refreshed = retain_observation("original-native-refresh", refreshed)
        map_image = render(project, "PostGIS_QGIS_Received_Map.png")

        snapshot = workspace.snapshot()
        snapshot_path = operation_root / "export-snapshot.json"
        if snapshot_path.exists():
            frozen_snapshot, _ = read_json(snapshot_path)
            require(frozen_snapshot == snapshot, "The original export revision changed; preserve its existing continuation.")
        else:
            frozen_snapshot = snapshot
            publish_json(snapshot_path, snapshot)
        archive = output / "Starforge_PostGIS_QGIS_Complete_Project.zip"
        if archive.exists():
            require(not archive.is_symlink() and archive.is_file(), "Preserve the original ordinary complete archive.")
            with zipfile.ZipFile(archive) as package:
                names = package.namelist()
                require(len(names) == len(set(names)) and len(names) <= 1000000,
                        "Keep the complete original project member list.")
                for name in ("workspace-snapshot.json", "qgis-package.json"):
                    require(package.getinfo(name).file_size <= 256 * 1024 * 1024,
                            "The original project metadata exceeds its native bound.")
                raw_snapshot = package.read("workspace-snapshot.json")
                manifest_bytes = package.read("qgis-package.json")
                manifest = json.loads(manifest_bytes)
            require(raw_snapshot == json_bytes(frozen_snapshot) and
                    manifest.get("workspaceId") == snapshot["state"]["id"] and
                    manifest.get("revision") == snapshot["state"]["revision"],
                    "The saved archive does not bind the original frozen native workspace.")
            exported = {"path": str(archive), **file_digest(archive),
                        "manifestSha256": digest(manifest_bytes),
                        "workspaceId": manifest["workspaceId"], "revision": manifest["revision"],
                        "fileCount": len(manifest["files"]) + 1,
                        "totalDecodedBytes": manifest["totalBytes"]}
        else:
            exported = workspace.export_package(archive,
                expected_revision=snapshot["state"]["revision"], progress=progress)
        publish_json(operation_root / "complete-package.json", exported)

        received = receive_package(archive, handoff["receivingDirectory"],
                                   expected_sha256=exported["sha256"], progress=progress)
        receiving_workspace = received["workspace"]
        require(receiving_workspace.snapshot() == frozen_snapshot,
                "The received workspace must preserve the exact complete original history.")
        receiving_project, receiving_readback = reopen_project(
            receiving_workspace, project_id, progress=progress)
        projects.append(receiving_project)
        receiving_refresh = refresh_project(receiving_workspace, receiving_project, progress=progress)
        receiving_readback = retain_observation("received-native-reopen", receiving_readback)
        receiving_refresh = retain_observation("received-native-refresh", receiving_refresh)
        receive_map = render(receiving_project, "PostGIS_QGIS_Reopened_Map.png")
        original_event_count = len(original_state["events"])
        after = workspace.snapshot()
        require(after["events"][:original_event_count] == original_state["events"] and
                all(value in after["requests"] for value in original_state["requests"]),
                "Preserve every original workspace event and operation.")
        require(after == frozen_snapshot, "Receiving must not mutate the original workspace after export.")
        result = {
            "schema": "starforge.postgis-qgis-native-result.v1",
            "operationId": handoff["operationId"], "sourceHead": handoff.get("sourceHead"),
            "state": "complete", "native": version, "sourceId": source.id,
            "sourceEdition": source.source.get("sourceEdition"),
            "sourceEditionJson": source.source.get("sourceEditionJson"),
            "databaseRevision": source.manifest["revision"],
            "acceptedEditionId": source.manifest["editionId"],
            "projectId": project_id, "workspaceId": after["state"]["id"],
            "workspaceRevision": after["state"]["revision"], "actor": handoff["actor"],
            "layerIds": handoff["layerIds"], "nativeCheck": checked["report"],
            "originalNativeReopen": reopened, "originalNativeRefresh": refreshed,
            "completePackage": exported, "receiving": received["receipt"],
            "receivedNativeReopen": receiving_readback,
            "receivedNativeRefresh": receiving_refresh, "images": [map_image, receive_map],
            "nativeObservations": observation_history(),
            "originalEventsPreserved": original_event_count,
            "historyEvents": len(after["events"]), "historyRequests": len(after["requests"]),
            "noDatabaseMutation": True, "noCredentialExport": True}
        publish_json(output / "qgis-native-result.json", result)
        print(json.dumps({"operationId": handoff["operationId"], "state": "complete",
                          "result": str(output / "qgis-native-result.json"),
                          "archive": exported["path"], "sha256": exported["sha256"],
                          "elapsedSeconds": round(time.monotonic() - start, 3)}), flush=True)
        return 0
    finally:
        for project in projects:
            project.removeAllMapLayers()
        projects.clear()
        try:
            del project
        except UnboundLocalError:
            pass
        try:
            del receiving_project
        except UnboundLocalError:
            pass
        gc.collect()
        app.exitQgis()


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        # Native connection errors are already sanitized by the maintained adapter.
        # Avoid dumping environment variables, provider objects or authentication.
        print(json.dumps({"state": "incomplete", "errorType": type(error).__name__,
                          "message": str(error)}), file=sys.stderr, flush=True)
        raise SystemExit(1)
