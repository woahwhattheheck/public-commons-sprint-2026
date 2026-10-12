# SPDX-License-Identifier: MIT
"""Original QGIS analyst operations and native map views."""
from __future__ import annotations
import copy
import hashlib
import json
import math
import os
from pathlib import Path
import tempfile
import uuid

from starforge_stac.model import (QgisReceivingError, QgisWorkspace, HASH, REQUEST,
    require, member, read_json, json_bytes, retain_bytes, file_digest, value_sha,
    open_receiving_source, receive_package, read_package_manifest, CHUNK, MAX_JSON)
from starforge_stac import qgis_project

NATIVE_ACTIONS = frozenset(("map.inspect", "map.save", "map.reopen", "map.render", "map.features", "postgis.check", "postgis.layers"))
FIELD_ACTIONS = frozenset(("field.state", "field.inventory", "field.copy", "field.review",
    "field.inspect", "field.reopen", "field.commission", "field.export", "field.receive",
    "field.accept", "field.close", "field.note"))


def absolute(value, label="directory"):
    require(isinstance(value, str) and value.strip() and "\0" not in value,
            "ANALYST_PATH", "Choose an absolute " + label + " path.")
    path = Path(value).expanduser()
    require(path.is_absolute(), "ANALYST_PATH", "Choose an absolute " + label + " path.")
    return str(path.absolute())


def native_runtime(value):
    require(isinstance(value, dict), "ANALYST_NATIVE_RUNTIME",
            "Use the selected existing native QGIS runtime.")
    require(set(value) <= {"native_command", "qfieldsync_path", "prefix_path"},
            "ANALYST_NATIVE_RUNTIME", "Use the original QField native runtime fields.")
    if not value:
        return {}
    command = value.get("native_command")
    require(isinstance(command, list) and 1 <= len(command) <= 64 and
            all(isinstance(x, str) and x and "\0" not in x and len(x) <= 4096 for x in command),
            "ANALYST_NATIVE_RUNTIME", "Select the original native QGIS executable and optional wrapper arguments.")
    command = list(command)
    command[0] = absolute(command[0], "native QGIS executable")
    require(Path(command[0]).is_file() and os.access(command[0], os.X_OK),
            "ANALYST_NATIVE_RUNTIME", "The selected native QGIS executable is unavailable.",
            path=command[0])
    result = {"native_command": command}
    for key in ("qfieldsync_path", "prefix_path"):
        if value.get(key):
            result[key] = absolute(value[key], key)
            require(Path(result[key]).is_dir(), "ANALYST_NATIVE_RUNTIME",
                    "The selected installed native directory is unavailable.", path=result[key])
    return result


def normalize_payload(action, raw, workspace):
    require(isinstance(raw, dict), "ANALYST_PAYLOAD", "Use a complete operation object.")
    value = copy.deepcopy(raw)
    keys = {
        "source.inspect": {"directory", "expectedManifestSha256"},
        "source.import": {"directory", "expectedManifestSha256"},
        "source.select": {"sourceId"},
        "layers.save": {"layers"},
        "edition.review": {"leftSourceId", "rightSourceId", "decisions", "note"},
        "map.inspect": {"sourceId", "collection", "itemId", "assetKey"},
        "map.save": {"projectCrs"},
        "map.reopen": {"projectId"},
        "map.render": {"projectId", "width", "height", "extent"},
        "map.features": {"projectId", "layerId", "offset", "limit", "extent"},
        "project.export": {"directory"},
        "project.receive": {"file", "destination", "expectedSha256"},
        "field.command": {"action", "payload"},
        "postgis.select": {"sourceId", "layerId", "connection", "label"},
        "postgis.check": {"sourceId", "layerIds", "connection"},
        "postgis.layers": {"layers"},
    }
    require(action in keys and set(value) <= keys[action],
            "ANALYST_PAYLOAD", "Use only the selected original action fields.")
    for key in ("directory", "destination", "file"):
        if key in value:
            value[key] = absolute(value[key], key)
    for key in ("sourceId", "leftSourceId", "rightSourceId", "expectedManifestSha256", "expectedSha256"):
        if key in value:
            require(isinstance(value[key], str) and HASH.fullmatch(value[key]),
                    "ANALYST_SOURCE_ID", "Use the exact retained source or file SHA-256.", field=key)
    if action in ("source.inspect", "source.import"):
        require("directory" in value, "ANALYST_SOURCE_DIRECTORY", "Select the original receiving directory.")
        if action == "source.import":
            require("expectedManifestSha256" in value, "ANALYST_SOURCE_REVIEW_REQUIRED",
                    "Inspect the complete original source and retain its exact manifest identity before import.")
    if action == "source.select":
        require("sourceId" in value, "ANALYST_SOURCE_ID", "Select an imported source edition.")
    if action in ("layers.save", "postgis.layers"):
        require(isinstance(value.get("layers"), list), "LAYER_LIST_REQUIRED",
                "Save the complete selected layer list.")
    if action == "edition.review":
        require(all(key in value for key in ("leftSourceId", "rightSourceId", "decisions", "note")),
                "COMPLETE_REVIEW_REQUIRED", "Retain the two editions and every original layer decision.")
    if action == "map.inspect":
        require(all(isinstance(value.get(key), str) and value[key] for key in ("sourceId", "itemId", "assetKey")),
                "ANALYST_ASSET", "Choose the original retained source, item and asset.")
    if action in ("map.reopen", "map.render", "map.features"):
        require(isinstance(value.get("projectId"), str) and REQUEST.fullmatch(value["projectId"]),
                "ANALYST_PROJECT", "Choose a saved native project.")
    if action == "map.render":
        value.setdefault("width", 1200)
        value.setdefault("height", 800)
        require(all(type(value[key]) is int and 64 <= value[key] <= 4096 for key in ("width", "height")) and
                value["width"] * value["height"] <= 8388608,
                "ANALYST_RENDER_SIZE", "Choose a native map image of up to 8,388,608 pixels.")
    if action == "map.features":
        require(isinstance(value.get("layerId"), str) and value["layerId"],
                "ANALYST_LAYER", "Choose a native vector layer in the saved map.")
        value.setdefault("offset", 0)
        value.setdefault("limit", 100)
        require(type(value["offset"]) is int and 0 <= value["offset"] <= 10000000 and
                type(value["limit"]) is int and 1 <= value["limit"] <= 100,
                "ANALYST_PAGE", "Read a native feature page of 1 to 100 rows.")
    if value.get("extent") is not None:
        extent = value["extent"]
        require(isinstance(extent, list) and len(extent) == 4 and
                all(type(x) in (int, float) and math.isfinite(x) for x in extent) and
                extent[0] < extent[2] and extent[1] < extent[3],
                "ANALYST_EXTENT", "Use the actual map extent: minimum X/Y, maximum X/Y.")
    if action in ("postgis.select", "postgis.check"):
        require(isinstance(value.get("sourceId"), str) and HASH.fullmatch(value["sourceId"]),
                "ANALYST_SOURCE_ID", "Select the original accepted database source.")
        source = workspace.source(value["sourceId"])
        require(source.sourceKind == "postgis", "POSTGIS_SOURCE", "Select an accepted PostGIS receiving edition.")
        from starforge_stac.postgis.source import connection_profile
        value["connection"] = connection_profile(value.get("connection"), source.manifest)
        if action == "postgis.select":
            require(isinstance(value.get("layerId"), str) and value["layerId"] in source.layers,
                    "POSTGIS_LAYER_NOT_RECEIVED", "Select an original accepted relation.")
            if value.get("label") is not None:
                require(isinstance(value["label"], str) and 0 < len(value["label"]) <= 240,
                        "POSTGIS_TEXT", "Use the actual selected map label.")
        else:
            require(isinstance(value.get("layerIds"), list) and value["layerIds"] and
                    all(isinstance(item, str) and item in source.layers for item in value["layerIds"]) and
                    len(set(value["layerIds"])) == len(value["layerIds"]),
                    "POSTGIS_LAYER_SELECTION", "Inspect distinct accepted original relations.")
    if action == "project.export":
        value.setdefault("directory", str(workspace.root.parent / (workspace.root.name + "-deliveries")))
        require(not Path(value["directory"]).is_relative_to(workspace.root),
                "PACKAGE_OUTPUT_DIRECTORY", "Keep the transport archive outside the active workspace.")
    if action == "project.receive":
        require(all(key in value for key in ("file", "destination", "expectedSha256")),
                "ANALYST_RECEIVING_INPUT", "Choose the whole archive, its exact SHA-256 and a new receiving directory.")
        require(not Path(value["destination"]).is_relative_to(workspace.root) and
                not workspace.root.is_relative_to(Path(value["destination"])),
                "ANALYST_RECEIVING_DIRECTORY", "Receive in a separate project directory.")
    if action == "field.command":
        require(value.get("action") in FIELD_ACTIONS and isinstance(value.get("payload", {}), dict),
                "FIELD_ACTION", "Select an existing native field operation.")
        value.setdefault("payload", {})
        for key in ("directory", "destination"):
            if key in value["payload"]:
                value["payload"][key] = absolute(value["payload"][key], "field " + key)
    return value


def field_call(workspace, action, payload, common, runtime, progress):
    from starforge_stac.field import (FIELD_ACTIONS as writes, NATIVE_ACTIONS as native,
        returned_inventory, copy_device_package, review_page, field_command)
    if action == "field.state":
        state = workspace.read()
        return {"workspaceId": state["id"], "revision": state["revision"],
                "fieldCampaigns": state.get("fieldCampaigns", [])}
    if action == "field.inventory":
        return returned_inventory(payload["directory"], progress=progress)
    if action == "field.copy":
        return copy_device_package(workspace, payload["roundId"], payload["destination"], progress=progress)
    if action == "field.review":
        return review_page(workspace, payload["roundId"], payload["returnId"],
            offset=payload.get("offset", 0), limit=payload.get("limit", 100),
            layer_id=payload.get("layerId", ""), kind=payload.get("kind", ""))
    if action in native | {"field.inspect", "field.reopen"}:
        require(runtime, "FIELD_NATIVE_COMMAND", "Select the installed native QGIS and QFieldSync environment.")
        from starforge_stac.field_bridge import run_native
        return run_native(workspace, action, payload, progress=progress, **runtime, **common)
    require(action in writes, "FIELD_ACTION", "Choose a documented original field operation.")
    return field_command(workspace, action, payload, progress=progress, **common)



def copy_field_package(workspace, record, progress):
    """Continue one original native device copy after a lost publication response."""
    from starforge_stac.field import round_for, verify_tree, copy_device_package
    payload = record["input"]["payload"]["payload"]
    target = Path(payload["destination"])
    intent_name = "analyst/results/" + record["requestId"] + "/field-copy-input.json"
    receipt_name = "analyst/results/" + record["requestId"] + "/field-copy.json"
    intent_path = member(workspace.root, intent_name, existing=False)
    if intent_path.exists():
        intent, _ = read_json(intent_path)
        require(intent.get("inputSha256") == record["inputSha256"],
                "ANALYST_FIELD_COPY_CHANGED", "The original device-copy input changed.")
    else:
        _, row = round_for(workspace.read(), payload["roundId"])
        require(row["status"] in ("exported", "returned"), "FIELD_ROUND_CLOSED",
                "Create a fresh original field export for another collection round.")
        require(not target.exists() and not target.is_symlink(),
                "FIELD_DEVICE_DIRECTORY", "Choose a new device-transfer directory.")
        intent = {"inputSha256": record["inputSha256"], "roundId": row["id"],
                  "directory": str(target), "files": copy.deepcopy(row["packageFiles"])}
        retain_bytes(workspace.root, intent_name, json_bytes(intent))
    from starforge_stac.analyst_state import AnalystJournal
    intent_file = {"path": intent_name, **file_digest(intent_path)}
    AnalystJournal(workspace).retain_files(record["requestId"], [intent_file])
    expected = {"directory": str(target), "roundId": intent["roundId"],
                "filesSha256": value_sha(intent["files"]), "fileCount": len(intent["files"]),
                "totalBytes": sum(item["bytes"] for item in intent["files"])}
    if target.exists():
        require(target.is_dir() and not target.is_symlink(), "FIELD_DEVICE_DIRECTORY",
                "The original device transfer must remain an ordinary directory.")
        verify_tree(target, intent["files"], progress=progress)
        result = expected
    else:
        _, current = round_for(workspace.read(), intent["roundId"])
        require(current["packageFiles"] == intent["files"], "ANALYST_FIELD_COPY_CHANGED",
                "The original field package changed before its device copy.")
        result = copy_device_package(workspace, intent["roundId"], target, progress=progress)
        require(result == expected, "ANALYST_FIELD_COPY_CHANGED",
                "The copied native package differs from its original reviewed input.")
    receipt = retain_bytes(workspace.root, receipt_name, json_bytes(result))
    return result, [intent_file, receipt]

def _project(workspace, project_id, progress):
    project, readback = qgis_project.reopen_project(workspace, project_id, progress=progress)
    # The original reader verifies the exact project, source, layer URI, filter and style closure.
    return project, readback


def _extent(rect):
    return [rect.xMinimum(), rect.yMinimum(), rect.xMaximum(), rect.yMaximum()]


def render_map(workspace, payload, request_id, progress):
    view_identity = value_sha({"workspaceId": workspace.read()["id"], "payload": payload})
    metadata_name = "analyst/results/" + request_id + "/map.json"
    metadata_path = member(workspace.root, metadata_name, existing=False)
    if metadata_path.exists():
        original, _ = read_json(metadata_path)
        require(original.get("viewInputSha256") == view_identity,
                "ANALYST_RENDER_INPUT_CHANGED", "The retained native view belongs to another original input.")
        file_digest(member(workspace.root, original["file"]["path"]), expected=original["file"])
        return original, [original["file"], {"path": metadata_name, **file_digest(metadata_path)}]
    core = qgis_project.native()
    from qgis.PyQt.QtCore import QSize, QEventLoop, QTimer
    from qgis.PyQt.QtGui import QColor
    project, readback = _project(workspace, payload["projectId"], progress)
    try:
        root = project.layerTreeRoot()
        layers = [layer for layer in root.layerOrder()
                  if root.findLayer(layer.id()) is not None and
                  root.findLayer(layer.id()).isVisible()]
        require(layers, "ANALYST_VISIBLE_LAYERS", "The selected saved map has no visible layers.")
        settings = core.QgsMapSettings()
        settings.setLayers(layers)
        settings.setDestinationCrs(project.crs())
        settings.setTransformContext(project.transformContext())
        settings.setBackgroundColor(QColor(255, 255, 255))
        settings.setOutputSize(QSize(payload["width"], payload["height"]))
        if hasattr(project, "labelingEngineSettings"):
            settings.setLabelingEngineSettings(project.labelingEngineSettings())
        scope = core.QgsExpressionContext()
        scope.appendScope(core.QgsExpressionContextUtils.globalScope())
        scope.appendScope(core.QgsExpressionContextUtils.projectScope(project))
        settings.setExpressionContext(scope)
        if payload.get("extent") is not None:
            rect = core.QgsRectangle(*payload["extent"])
        else:
            rect = core.QgsRectangle()
            for layer in layers:
                transformed = core.QgsCoordinateTransform(layer.crs(), project.crs(),
                                                          project).transformBoundingBox(layer.extent())
                rect.combineExtentWith(transformed)
            if rect.width() == 0 or rect.height() == 0:
                padding = max(abs(rect.center().x()), abs(rect.center().y()), 1.0) * 0.00001
                rect.grow(padding)
            rect.scale(1.05)
        require(not rect.isEmpty() and all(math.isfinite(x) for x in _extent(rect)),
                "ANALYST_MAP_EXTENT", "The original visible layers have no usable map extent.")
        settings.setExtent(rect)
        renderer = core.QgsMapRendererParallelJob(settings)
        loop = QEventLoop()
        renderer.finished.connect(loop.quit)
        timer = QTimer()
        timer.setSingleShot(True)
        timed_out = []
        def timeout():
            timed_out.append(True)
            renderer.cancel()
            loop.quit()
        timer.timeout.connect(timeout)
        timer.start(120000)
        renderer.start()
        if renderer.isActive():
            loop.exec()
        timer.stop()
        require(not timed_out, "ANALYST_RENDER_TIMEOUT",
                "The native map render exceeded 120 seconds; retain this request and choose an appropriate map view.")
        errors = [{"layerId": str(error.layerID), "message": str(error.message)}
                  for error in renderer.errors()]
        require(not errors, "ANALYST_RENDER_FAILED",
                "QGIS reported layer rendering errors.", errors=errors)
        image = renderer.renderedImage()
        require(not image.isNull(), "ANALYST_RENDER_FAILED", "QGIS did not return a rendered image.")
        result_root = member(workspace.root, metadata_name, existing=False).parent
        result_root.mkdir(mode=0o700, parents=True, exist_ok=True)
        fd, temporary = tempfile.mkstemp(prefix=".map-", suffix=".png", dir=result_root)
        os.close(fd)
        try:
            require(image.save(temporary, "PNG"), "ANALYST_RENDER_WRITE", "QGIS could not retain the native map image.")
            with open(temporary, "rb") as stream:
                os.fsync(stream.fileno())
            measured = file_digest(temporary)
            relative = "analyst/results/" + request_id + "/" + measured["sha256"] + ".png"
            target = member(workspace.root, relative, existing=False)
            try:
                os.link(temporary, target)
            except FileExistsError:
                file_digest(target, expected=measured)
            record = {"path": relative, **measured}
        finally:
            Path(temporary).unlink(missing_ok=True)
        result = {"schema": "starforge.stac-qgis-map-view.v1", "projectId": payload["projectId"],
                  "viewInputSha256": view_identity, "file": record, "width": image.width(), "height": image.height(),
                  "extent": _extent(settings.visibleExtent()), "requestedExtent": payload.get("extent"),
                  "projectCrs": qgis_project._crs(project.crs()), "readback": readback,
                  "layerOrder": [{"nativeId": layer.id(), "layerId": layer.customProperty("starforge/layerId", ""),
                                  "name": layer.name()} for layer in layers]}
        metadata = retain_bytes(workspace.root, "analyst/results/" + request_id + "/map.json",
                                json_bytes(result))
        return result, [record, metadata]
    finally:
        project.clear()


def feature_value(value):
    core = qgis_project.native()
    if value is None or hasattr(core, "QgsVariantUtils") and core.QgsVariantUtils.isNull(value):
        return None
    if isinstance(value, bytes):
        import base64
        return {"encoding": "base64", "value": base64.b64encode(value).decode("ascii")}
    return str(value)


def native_features(workspace, payload, progress):
    core = qgis_project.native()
    project, readback = _project(workspace, payload["projectId"], progress)
    try:
        candidates = [layer for layer in project.mapLayers().values()
                      if layer.id() == payload["layerId"] or
                      layer.customProperty("starforge/layerId", "") == payload["layerId"]]
        require(len(candidates) == 1 and isinstance(candidates[0], core.QgsVectorLayer),
                "ANALYST_VECTOR_LAYER", "Choose one actual vector layer in this saved native map.")
        layer = candidates[0]
        request = core.QgsFeatureRequest()
        if payload.get("extent") is not None:
            bounds = core.QgsCoordinateTransform(project.crs(), layer.crs(), project).transformBoundingBox(
                core.QgsRectangle(*payload["extent"]))
            request.setFilterRect(bounds)
        request.setLimit(payload["offset"] + payload["limit"] + 1)
        rows = []
        iterator = layer.getFeatures(request)
        try:
            for index, feature in enumerate(iterator):
                if index < payload["offset"]:
                    continue
                rows.append({"featureId": str(feature.id()),
                             "values": [feature_value(value) for value in feature.attributes()],
                             "geometryEmpty": not feature.hasGeometry() or feature.geometry().isEmpty()})
                if len(rows) > payload["limit"]:
                    break
        finally:
            iterator.close()
        more = len(rows) > payload["limit"]
        return {"projectId": payload["projectId"], "layerId": payload["layerId"],
                "nativeLayerId": layer.id(), "name": layer.name(),
                "fields": [{"name": field.name(), "type": field.typeName()} for field in layer.fields()],
                "rows": rows[:payload["limit"]], "offset": payload["offset"], "limit": payload["limit"],
                "hasMore": more, "complete": not more, "extent": payload.get("extent"),
                "nativeFeatureCount": str(layer.featureCount()), "subsetString": layer.subsetString(),
                "readback": readback}, []
    finally:
        project.clear()


def execute(workspace, record, progress):
    original = record["input"]
    action, payload = original["action"], original["payload"]
    common = {"revision": original["revision"], "request_id": record["requestId"],
              "actor": original["actor"]}
    if action == "postgis.select":
        return workspace.source(payload["sourceId"]).layer_definition(payload["layerId"],
            payload["connection"], label=payload.get("label")), []
    if action == "postgis.check":
        from starforge_stac.postgis.native import record_check
        return record_check(workspace, payload["sourceId"], payload["layerIds"],
                            payload["connection"], progress=progress, **common), []
    if action == "postgis.layers":
        from starforge_stac.postgis.native import save_selection
        return save_selection(workspace, payload["layers"], **common), []
    if action == "source.inspect":
        source = open_receiving_source(payload["directory"], payload.get("expectedManifestSha256"), progress=progress)
        return {"sourceId": source.id, "source": source.source, "summary": source.summary,
                "sourceKind": source.sourceKind, "directory": str(source.root),
                "scenes": len(source.scene_rows()), "assets": len(source.asset_rows())}, []
    if action == "source.import":
        return workspace.import_source(payload["directory"],
            expected_manifest_sha256=payload["expectedManifestSha256"], progress=progress, **common), []
    if action == "source.select":
        return workspace.activate_source(payload["sourceId"], **common), []
    if action == "layers.save":
        return workspace.save_layers(payload["layers"], **common), []
    if action == "edition.review":
        return workspace.review_successor(payload["leftSourceId"], payload["rightSourceId"],
            payload["decisions"], note=payload["note"], **common), []
    if action == "map.inspect":
        return qgis_project.inspect_asset(workspace, payload["sourceId"], payload.get("collection"),
                                         payload["itemId"], payload["assetKey"], progress=progress), []
    if action == "map.save":
        return qgis_project.save_project(workspace, project_crs=payload.get("projectCrs"),
                                        progress=progress, **common), []
    if action == "map.reopen":
        project, result = _project(workspace, payload["projectId"], progress)
        project.clear()
        return result, []
    if action == "map.render":
        return render_map(workspace, payload, record["requestId"], progress)
    if action == "map.features":
        return native_features(workspace, payload, progress)
    if action == "project.export":
        destination = Path(payload["directory"]) / (record["requestId"] + ".zip")
        result_file = "analyst/results/" + record["requestId"] + "/export.json"
        retained = member(workspace.root, result_file, existing=False)
        if retained.exists():
            result, _ = read_json(retained)
            file_digest(destination, expected={"path": destination.name,
                        "bytes": result["bytes"], "sha256": result["sha256"]}, progress=progress)
            return result, [{"path": result_file, **file_digest(retained)}]
        if destination.exists():
            # The only uncertain point is after native package publication and before receipt retention.
            # Validate its original full manifest and captured workspace revision before adopting it.
            import zipfile
            with zipfile.ZipFile(destination) as archive:
                manifest, manifest_body, files = read_package_manifest(archive)
                for index, (name, item) in enumerate(files.items(), 1):
                    digest, count = hashlib.sha256(), 0
                    with archive.open(name) as source:
                        while True:
                            block = source.read(CHUNK)
                            if not block:
                                break
                            digest.update(block)
                            count += len(block)
                            require(count <= item["bytes"], "PACKAGE_MEMBER_SIZE",
                                    "The retained export member exceeds its original size.", path=name)
                            if progress:
                                progress({"phase": "export-recovery", "path": name,
                                          "completedBytes": count, "totalBytes": item["bytes"],
                                          "completedFiles": index - 1, "totalFiles": len(files)})
                    require(count == item["bytes"] and digest.hexdigest() == item["sha256"],
                            "PACKAGE_MEMBER_HASH", "The retained export member changed.", path=name)
                require(files["workspace-snapshot.json"]["bytes"] <= MAX_JSON,
                        "JSON_LIMIT", "The captured original project snapshot exceeds the supported size.")
                snapshot = json.loads(archive.read("workspace-snapshot.json").decode("utf-8"))
                from starforge_stac.analyst_state import validate_analyst_snapshot
                QgisWorkspace._validate_state(snapshot["state"])
                validate_analyst_snapshot(snapshot, records=files)
                require(manifest.get("workspaceId") == original["workspaceId"] and
                        manifest.get("revision") == original["revision"] and
                        snapshot.get("state", {}).get("id") == original["workspaceId"] and
                        snapshot["state"]["revision"] == original["revision"] and
                        any(row.get("requestId") == record["requestId"] and
                            row.get("inputSha256") == record["inputSha256"]
                            for row in snapshot.get("analystRequests", [])),
                        "ANALYST_EXPORT_CHANGED", "The existing archive belongs to another original export.")
                measured = file_digest(destination, progress=progress)
                result = {"path": str(destination), **measured,
                          "manifestSha256": hashlib.sha256(manifest_body).hexdigest(),
                          "workspaceId": manifest["workspaceId"], "revision": manifest["revision"],
                          "fileCount": len(files) + 1, "totalDecodedBytes": manifest["totalBytes"]}
        else:
            result = workspace.export_package(destination, expected_revision=original["revision"], progress=progress)
        receipt = retain_bytes(workspace.root, result_file, json_bytes(result))
        return result, [receipt]
    if action == "project.receive":
        received = receive_package(payload["file"], payload["destination"],
            expected_sha256=payload["expectedSha256"], progress=progress)
        state = received["workspace"].read()
        return {"receipt": received["receipt"], "replayed": received["replayed"],
                "directory": str(received["workspace"].root), "state": state}, []
    if action == "field.command":
        if payload["action"] == "field.copy":
            return copy_field_package(workspace, record, progress)
        return field_call(workspace, payload["action"], payload["payload"], common,
                          original["nativeRuntime"], progress), []
    raise QgisReceivingError("ANALYST_ACTION", "Choose a documented original analyst operation.")
