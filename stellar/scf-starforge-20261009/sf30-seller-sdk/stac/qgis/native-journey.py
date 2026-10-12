#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
"""Continue one original received STAC or vector edition through QGIS and fresh receiving.

Run with QGIS's Python, or from QGIS --code with STARFORGE_QGIS_JOURNEY_CONFIG.
The config points to complete original qgis-receiving.json or vector-export.json directories.
"""
from __future__ import annotations
import json
import os
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent))
from starforge_stac.model import (QgisWorkspace, open_receiving_source, receive_package, read_json, retain_bytes,
                                  file_digest, value_sha, require, json_bytes, utc_now)
from starforge_stac.qgis_project import (native, native_version, inspect_asset, add_to_project,
                                         capture_styles, save_project, reopen_project, zoom_managed)


def perform(config_file):
    config, _ = read_json(config_file)
    root = Path(config["outputRoot"]).expanduser().absolute()
    root.mkdir(mode=0o700, parents=True, exist_ok=True)
    binding = {"schema": "starforge.stac-qgis-native-operation.v1", "config": config}
    retain_bytes(root, "operation-input.json", json_bytes(binding))
    actor = config.get("actor") or "Native receiving operator"
    workspace = QgisWorkspace(root / "workspace", create=True, title=config.get("title", "Original STAC QGIS receiving"))
    events = []
    def keep(step, value):
        record = {"step": step, "value": value}
        events.append(record)
        retain_bytes(root, "steps/" + step + ".json", json_bytes(record))
        print(json.dumps({"step": step, "complete": True}), flush=True)
        return value
    def previous(step):
        path = root / "steps" / (step + ".json")
        return read_json(path)[0]["value"] if path.exists() else None
    def action_args(request):
        # Freeze the original revision before dispatch, including across a lost step receipt.
        path = root / "actions" / (request + ".json")
        if path.exists():
            saved, _ = read_json(path)
            require(saved.get("request_id") == request and saved.get("actor") == actor and
                    type(saved.get("revision")) is int, "NATIVE_ACTION_CHANGED",
                    "Continue the same retained native action and analyst.")
            return saved
        completed = workspace.operation(request)
        revision = completed["event"]["revision"] - 1 if completed else workspace.read()["revision"]
        saved = {"revision": revision, "request_id": request, "actor": actor}
        retain_bytes(root, "actions/" + request + ".json", json_bytes(saved))
        return saved

    def original_source(directory, manifest_sha256, request_id, step):
        completed = previous(step) or workspace.operation(request_id)
        if completed:
            require(completed.get("event", {}).get("action") == "source.imported",
                    "NATIVE_SOURCE_ACTION_CHANGED", "Continue the original source-import action.")
            source_id = completed["source"]["id"]
            require(manifest_sha256 is None or source_id == manifest_sha256,
                    "RECEIVING_MANIFEST_CHANGED", "The retained source differs from this operation's original input.")
            return workspace.source(source_id, verify=True)
        return open_receiving_source(directory, manifest_sha256)

    source = original_source(config["sourceDirectory"], config.get("sourceManifestSha256"),
                             "native-source-import", "source-import")
    imported = previous("source-import")
    if imported is None:
        imported = keep("source-import", workspace.import_source(source.root, expected_manifest_sha256=source.id,
                                                                 **action_args("native-source-import")))
    inspections = previous("native-assets")
    if inspections is None:
        inspections = []
        for selection in config.get("assetSelections", []):
            inspections.append(inspect_asset(workspace, source.id, selection.get("collection"),
                                             selection["itemId"], selection["assetKey"]))
        keep("native-assets", inspections)
    if previous("layer-selection") is None:
        layers = []
        if source.sourceKind == "stac":
            layers.append({"id": "original-footprints", "sourceId": source.id, "kind": "footprints",
                           "label": "Original received scene footprints", "allScenes": True,
                           "sceneKeys": list(source.scenes), "visible": True, "opacity": 1})
        for index, selection in enumerate(config.get("assetSelections", []), 1):
            row = dict(selection)
            row.update({"id": "original-asset-" + str(index), "sourceId": source.id})
            row.setdefault("label", row["assetKey"])
            row.setdefault("visible", True)
            row.setdefault("opacity", 1)
            layers.append(row)
        keep("layer-selection", workspace.save_layers(layers, **action_args("native-layer-selection")))

    core = native()
    native_project = core.QgsProject()
    add_to_project(workspace, native_project)
    if previous("native-style") is None:
        keep("native-style", capture_styles(workspace, native_project, **action_args("native-style-selection")))
    if previous("native-map") is None:
        arguments = action_args("native-map-save")
        receipt = save_project(workspace, project_crs=config.get("projectCrs"), **arguments)
        replay = save_project(workspace, project_crs=config.get("projectCrs"), **arguments)
        require(receipt == replay and workspace.read()["revision"] == receipt["revision"],
                "NATIVE_SAVE_REPLAY", "The original native map save did not preserve its completed operation.")
        keep("native-map", receipt)
    first = previous("native-map")
    reopened, details = reopen_project(workspace, first["project"]["id"])
    if previous("native-reopen") is None:
        keep("native-reopen", details)

    if config.get("successorDirectory"):
        later = original_source(config["successorDirectory"], config.get("successorManifestSha256"),
                                "native-successor-import", "successor-import")
        if previous("successor-import") is None:
            keep("successor-import", workspace.import_source(later.root, expected_manifest_sha256=later.id,
                                                              **action_args("native-successor-import")))
        if previous("successor-review") is None:
            comparison = workspace.compare(source.id, later.id)
            decisions = config.get("successorDecisions")
            require(isinstance(decisions, list), "SUCCESSOR_DECISIONS_REQUIRED",
                    "Supply the original operator's explicit decision for each prior map layer.")
            receipt = workspace.review_successor(source.id, later.id, decisions,
                                                 note=config["successorNote"], **action_args("native-successor-review"))
            keep("successor-review", {"comparison": comparison, "receipt": receipt})
        if previous("successor-map") is None:
            keep("successor-map", save_project(workspace, project_crs=config.get("projectCrs"),
                                                **action_args("native-successor-map")))
        # Prior map must continue to open with its original data after the successor review.
        _, old_details = reopen_project(workspace, first["project"]["id"])
        if previous("prior-map-after-successor") is None:
            keep("prior-map-after-successor", old_details)

    archive = root / "complete-project.zip"
    exported = previous("complete-package")
    if exported is None:
        if archive.exists():
            # The exporter completed before the carrier returned; its exact receiver validates it.
            measured = file_digest(archive)
            exported = {"path": str(archive), **measured, "revision": workspace.read()["revision"]}
        else:
            exported = workspace.export_package(archive, expected_revision=workspace.read()["revision"])
        keep("complete-package", exported)
    received = receive_package(archive, root / "received-workspace", expected_sha256=exported["sha256"])
    replayed = receive_package(archive, root / "received-workspace", expected_sha256=exported["sha256"])
    require(received["workspace"].snapshot() == workspace.snapshot() and replayed["replayed"],
            "COMPLETE_PROJECT_RECEIVING", "The received workspace differs from the original complete snapshot.")
    receiving_result = previous("fresh-receiving")
    if receiving_result is None:
        receiving_result = keep("fresh-receiving", received["receipt"])
    receiver = received["workspace"]
    maps = []
    for record in receiver.read()["projects"]:
        _, detail = reopen_project(receiver, record["id"])
        maps.append(detail)
    if previous("received-native-reopen") is None:
        keep("received-native-reopen", maps)

    desktop = None
    try:
        import qgis.utils
        iface = qgis.utils.iface
        if iface is not None:
            from starforge_stac.plugin import ReceivingDock
            from qgis.PyQt.QtCore import Qt
            from qgis.PyQt.QtWidgets import QApplication
            dock = ReceivingDock(iface)
            iface.addDockWidget(Qt.DockWidgetArea.RightDockWidgetArea, dock)
            dock.set_workspace(receiver)
            dock.show()
            add_to_project(receiver, core.QgsProject.instance())
            zoom_managed(iface, receiver)
            QApplication.processEvents()
            image_path = root / "native-qgis-operator.png"
            require(iface.mainWindow().grab().save(str(image_path), "PNG"), "NATIVE_SCREENSHOT",
                    "The actual QGIS operator window could not be captured.")
            desktop = {"path": str(image_path), **file_digest(image_path)}
    except ImportError:
        pass
    result = {"schema": "starforge.stac-qgis-native-result.v1", "operationId": config["operationId"],
              "completedAt": utc_now(), "native": native_version(), "source": source.source,
              "sourceKind": source.sourceKind, "manifestName": source.manifest_name,
              "sourceManifestSha256": source.id, "scenes": len(source.scenes), "originalAssets": len(source.assets),
              "selectedNativeAssets": inspections, "workspaceId": workspace.read()["id"],
              "revision": workspace.read()["revision"], "savedMaps": len(maps),
              "archive": exported, "received": receiving_result, "nativeReopenedMaps": maps,
              "desktop": desktop}
    final = root / "native-result.json"
    if final.exists():
        existing, _ = read_json(final)
        require(existing["sourceManifestSha256"] == source.id and existing["archive"]["sha256"] == exported["sha256"],
                "NATIVE_RESULT_CHANGED", "Retain the same original native receiving result.")
        result = existing
    else:
        retain_bytes(root, "native-result.json", json_bytes(result))
    print(json.dumps(result, ensure_ascii=False, indent=2, allow_nan=False))
    return result


if __name__ == "__main__" or os.environ.get("STARFORGE_QGIS_JOURNEY_CONFIG"):
    config_file = os.environ.get("STARFORGE_QGIS_JOURNEY_CONFIG")
    if not config_file:
        import argparse
        parser = argparse.ArgumentParser(description=__doc__)
        parser.add_argument("--config", required=True)
        config_file = parser.parse_args().config
    core = native()
    own_application = None
    if core.QgsApplication.instance() is None:
        os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")
        own_application = core.QgsApplication([], False)
        own_application.initQgis()
    try:
        perform(config_file)
    finally:
        if own_application is not None:
            own_application.exitQgis()
