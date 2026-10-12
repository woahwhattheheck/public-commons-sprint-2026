# SPDX-License-Identifier: MIT
"""Native publication projection of one original saved QGIS map."""
from __future__ import annotations

import argparse
import copy
import json
import os
from pathlib import Path
import signal
import sys
import tempfile
import uuid

from contract import (need, QwcError, original_gis, directory, member, read_json,
                      json_bytes, digest, value_hash, keep_json, measure, atomic,
                      sync_directory, now)

PROJECTION_SCHEMA = "starforge.stac-qwc-native-project.v1"


def projection_layers(project, record):
    definitions = {row["id"]: row for row in record["layers"]}
    actual = {}
    for layer in project.mapLayers().values():
        selected = layer.customProperty("starforge/layerId")
        need(selected in definitions and selected not in actual, "PUBLICATION_LAYER_IDENTITY",
             "The native map must retain exactly its original managed layer selection.")
        row = definitions[selected]
        short_name = "sf_" + digest(selected.encode("utf-8"))[:24]
        actual[selected] = {
            "layerId": selected, "nativeLayerId": layer.id(), "wmsName": short_name,
            "sourceId": row["sourceId"], "kind": row["kind"], "title": layer.name(),
            "visible": row["visible"], "opacity": row["opacity"],
            "crs": layer.crs().authid() or layer.crs().toWkt()
        }
    need(set(actual) == set(definitions), "PUBLICATION_LAYER_CLOSURE",
         "The native publication must contain every selected original layer exactly once.")
    return [actual[row["id"]] for row in record["layers"]]


def add_print_layout(project, selection):
    from qgis import core
    if selection is None:
        return
    manager = project.layoutManager()
    old = manager.layoutByName(selection["name"])
    if selection["mode"] == "existing":
        need(old is not None, "PRINT_LAYOUT_MISSING", "Select an existing native layout in this saved project.",
             name=selection["name"])
        return
    need(old is None, "PRINT_LAYOUT_EXISTS", "The selected map-page name already belongs to an original native layout.")
    layout = core.QgsPrintLayout(project)
    layout.initializeDefaults()
    layout.setName(selection["name"])
    orientation = (core.QgsLayoutItemPage.Landscape
                   if selection.get("orientation", "landscape") == "landscape"
                   else core.QgsLayoutItemPage.Portrait)
    page = layout.pageCollection().page(0)
    page.setPageSize(selection.get("paper", "A4"), orientation)
    width, height = page.pageSize().width(), page.pageSize().height()
    title = core.QgsLayoutItemLabel(layout)
    title.setText(selection.get("title") or project.title())
    title.attemptMove(core.QgsLayoutPoint(10, 7))
    title.attemptResize(core.QgsLayoutSize(width - 20, 12))
    layout.addLayoutItem(title)
    item = core.QgsLayoutItemMap(layout)
    item.setId("map0")
    item.attemptMove(core.QgsLayoutPoint(10, 22))
    item.attemptResize(core.QgsLayoutSize(width - 20, height - 38))
    item.setCrs(project.crs())
    layers = [node.layer() for node in project.layerTreeRoot().findLayers()
              if node.layer() is not None and node.isVisible()]
    need(layers, "PRINT_VISIBLE_LAYERS_REQUIRED", "Select at least one visible native map layer for the map page.")
    item.setLayers(layers)
    item.setKeepLayerSet(True)
    extent = project.viewSettings().fullExtent()
    need(not extent.isEmpty(), "PRINT_EXTENT_REQUIRED", "The selected native map requires a non-empty extent.")
    item.zoomToExtent(extent)
    layout.addLayoutItem(item)
    need(manager.addLayout(layout), "PRINT_LAYOUT_SAVE", "QGIS could not retain the complete native map page.")


def describe_layouts(project):
    from qgis import core
    result = []
    for layout in project.layoutManager().printLayouts():
        maps = []
        for item in layout.items():
            if isinstance(item, core.QgsLayoutItemMap):
                box = item.extent()
                maps.append({
                    "id": item.id(), "displayName": item.displayName(),
                    "crs": item.crs().authid() or item.crs().toWkt(),
                    "extent": [box.xMinimum(), box.yMinimum(), box.xMaximum(), box.yMaximum()],
                    "widthMm": item.sizeWithUnits().width(), "heightMm": item.sizeWithUnits().height()
                })
        result.append({"name": layout.name(), "maps": sorted(maps, key=lambda x: x["id"])})
    return sorted(result, key=lambda x: x["name"])


def inspect_projection(workspace, target, record, projection_input, checkpoint):
    from starforge_stac.qgis_project import _verify_project_file
    checkpoint()
    project, original = _verify_project_file(
        workspace, target, record["layers"], record["inputSha256"],
        progress=lambda _: checkpoint())
    expected = projection_layers(project, record)
    by_id = {layer.customProperty("starforge/layerId"): layer for layer in project.mapLayers().values()}
    for row in expected:
        need(by_id[row["layerId"]].serverProperties().shortName() == row["wmsName"],
             "PUBLISHED_LAYER_NAME_CHANGED", "The stable native WMS layer name changed.",
             layerId=row["layerId"])
    need(project.readEntry("starforge", "publicationId", "")[0] == projection_input["publicationId"] and
         project.readEntry("starforge", "publicationInputSha256", "")[0] == value_hash(projection_input),
         "PUBLISHED_PROJECT_IDENTITY", "This native publication belongs to a different retained input.")
    need(not project.readBoolEntry("WMSUseLayerIDs", "/", False)[0] and
         project.readEntry("WMSRootName", "/", "")[0] == projection_input["rootName"],
         "PUBLISHED_WMS_IDENTITY", "The native project must retain its selected stable WMS names.")
    return project, {"originalReadback": original, "layers": expected,
                     "layouts": describe_layouts(project),
                     "projectCrs": project.crs().authid() or project.crs().toWkt()}


def prepare_projection(raw, checkpoint=lambda: None):
    model = original_gis()
    from starforge_stac.qgis_project import reopen_project, native_version
    need(isinstance(raw, dict) and raw.get("schema") == PROJECTION_SCHEMA,
         "PROJECTION_INPUT_REQUIRED", "Use the retained complete native projection input.")
    workspace = model.QgisWorkspace(raw["gisDirectory"])
    state = workspace.read()
    need(state["id"] == raw["workspaceId"] and state["revision"] == raw["revision"],
         "ORIGINAL_QGIS_REVISION_CHANGED", "The selected original QGIS snapshot changed.")
    record = next((x for x in state["projects"] if x["id"] == raw["projectId"]), None)
    need(record is not None, "ORIGINAL_PROJECT_MISSING", "Select a native map saved by the original QGIS engine.")
    root = directory(raw["outputDirectory"], True)
    projection_input = {k: copy.deepcopy(v) for k, v in raw.items() if k not in ("gisDirectory", "outputDirectory")}
    projection_input["originalProject"] = copy.deepcopy(record)
    keep_json(root / "native-projection-input.json", projection_input)
    target = root / "project.qgz"
    if target.exists():
        project, result = inspect_projection(workspace, target, record, projection_input, checkpoint)
    else:
        checkpoint()
        project, _ = reopen_project(workspace, raw["projectId"], progress=lambda _: checkpoint())
        project.setTitle(raw["title"])
        project.setFilePathStorage(__import__("qgis.core", fromlist=["Qgis"]).Qgis.FilePathType.Relative)
        project.writeEntry("WMSUseLayerIDs", "/", False)
        project.writeEntry("WMSRootName", "/", raw["rootName"])
        project.writeEntry("WMSServiceTitle", "/", raw["title"])
        keywords = [x for x in project.readListEntry("WMSKeywordList", "/", [])[0]
                    if not x.startswith("starforge-publication:")]
        keywords.append("starforge-publication:" + raw["publicationId"])
        project.writeEntry("WMSKeywordList", "/", keywords)
        project.writeEntry("starforge", "publicationId", raw["publicationId"])
        project.writeEntry("starforge", "publicationInputSha256", value_hash(projection_input))
        by_id = {layer.customProperty("starforge/layerId"): layer for layer in project.mapLayers().values()}
        for row in projection_layers(project, record):
            by_id[row["layerId"]].serverProperties().setShortName(row["wmsName"])
        add_print_layout(project, raw.get("print"))
        temporary = root / (".qwc-native-" + uuid.uuid4().hex + ".qgz")
        try:
            checkpoint()
            need(project.write(str(temporary)), "NATIVE_PROJECT_WRITE",
                 "QGIS could not write the complete publication project.")
            with temporary.open("rb") as stream:
                os.fsync(stream.fileno())
            inspect_projection(workspace, temporary, record, projection_input, checkpoint)
            try:
                os.link(temporary, target)
            except FileExistsError:
                inspect_projection(workspace, target, record, projection_input, checkpoint)
            sync_directory(root)
        finally:
            temporary.unlink(missing_ok=True)
        project, result = inspect_projection(workspace, target, record, projection_input, checkpoint)
    result.update({
        "schema": PROJECTION_SCHEMA, "publicationId": raw["publicationId"],
        "workspaceId": state["id"], "revision": state["revision"], "projectId": raw["projectId"],
        "inputSha256": value_hash(projection_input), "native": native_version(),
        "file": {"path": "project.qgz", **measure(target)},
        "sourceIds": list(record["sourceIds"])
    })
    prior = root / "native-project.json"
    if prior.exists():
        retained, _ = read_json(prior)
        need(all(retained.get(k) == result.get(k) for k in
                 ("schema", "publicationId", "workspaceId", "revision", "projectId",
                  "inputSha256", "file", "sourceIds", "layers", "layouts")),
             "NATIVE_REOPEN_CHANGED", "The reopened original publication differs from its retained result.")
        return retained
    result["preparedAt"] = now()
    keep_json(prior, result)
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", required=True)
    args = parser.parse_args()
    raw, _ = read_json(args.input)
    recorded = {"signal": None}
    def cancelled(signum, _frame):
        if recorded["signal"] is None:
            recorded["signal"] = signum
    prior = {s: signal.signal(s, cancelled) for s in (signal.SIGINT, signal.SIGTERM)}
    def checkpoint():
        if recorded["signal"] is not None:
            raise QwcError("CANCELLED", "The original native projection has been cancelled.",
                           signal=recorded["signal"])
    application = None
    try:
        os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")
        from qgis.core import QgsApplication
        application = QgsApplication.instance()
        owned = application is None
        if owned:
            application = QgsApplication([], False)
            application.initQgis()
        try:
            result = prepare_projection(raw, checkpoint)
            checkpoint()
            print(json.dumps(result, ensure_ascii=False, allow_nan=False), flush=True)
            return 0
        finally:
            if owned and application is not None:
                application.exitQgis()
    except Exception as error:
        print(json.dumps({"error": getattr(error, "code", "NATIVE_PROJECT_ERROR"),
                          "message": str(error), "details": getattr(error, "details", {})},
                         ensure_ascii=False), file=sys.stderr, flush=True)
        return 128 + recorded["signal"] if recorded["signal"] is not None else 2
    finally:
        for sig, previous in prior.items():
            signal.signal(sig, previous)


if __name__ == "__main__":
    raise SystemExit(main())
