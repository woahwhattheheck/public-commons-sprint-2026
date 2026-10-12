# SPDX-License-Identifier: MIT
"""Native QGIS layers and saved projects over the original received file closure."""
from __future__ import annotations

import copy
import json
import math
import os
from pathlib import Path
import re
import tempfile
import urllib.parse
import uuid
import xml.etree.ElementTree as ET
import zipfile

from .model import (QgisWorkspace, QgisReceivingError, require, member, descriptor, file_digest,
                    retain_bytes, retain_copy, read_json, json_bytes, value_sha, sha_bytes, asset_key, utc_now, REQUEST)


def native():
    try:
        from qgis import core
    except ImportError as exc:
        raise QgisReceivingError("QGIS_RUNTIME_REQUIRED",
                                 "Run this command in the existing QGIS Python environment, or open the installed QGIS plugin.") from exc
    require(core.Qgis.QGIS_VERSION_INT >= 34000, "QGIS_VERSION", "Use QGIS 3.40 or later.")
    return core


def native_version():
    core = native()
    return {"qgis": core.Qgis.QGIS_VERSION, "versionInt": core.Qgis.QGIS_VERSION_INT}


def _crs(crs):
    return {"valid": crs.isValid(), "authid": crs.authid(), "description": crs.description(),
            "wkt": crs.toWkt() if crs.isValid() else None}


def _number(value):
    if isinstance(value, float) and not math.isfinite(value):
        return "NaN" if math.isnan(value) else "Infinity" if value > 0 else "-Infinity"
    return value


def _extent(layer):
    box = layer.extent()
    return {"xmin": box.xMinimum(), "ymin": box.yMinimum(),
            "xmax": box.xMaximum(), "ymax": box.yMaximum(), "empty": box.isEmpty()}


def _value(value):
    if hasattr(value, "name"):
        return str(value.name)
    return str(value)


def describe_layer(layer):
    core = native()
    require(layer.isValid(), "NATIVE_LAYER_INVALID", "The native provider could not open the selected local layer.")
    result = {"name": layer.name(), "provider": layer.providerType(), "crs": _crs(layer.crs()),
              "extent": _extent(layer), "valid": True}
    if isinstance(layer, core.QgsRasterLayer):
        provider = layer.dataProvider()
        result.update({"kind": "raster", "width": layer.width(), "height": layer.height(),
                       "bands": [{"number": number, "name": layer.bandName(number),
                                  "dataType": _value(provider.dataType(number)),
                                  "sourceNoData": _number(provider.sourceNoDataValue(number)) if provider.sourceHasNoDataValue(number) else None,
                                  "scale": _number(provider.bandScale(number)), "offset": _number(provider.bandOffset(number))}
                                 for number in range(1, layer.bandCount() + 1)],
                       "renderer": layer.renderer().type() if layer.renderer() else None})
    elif isinstance(layer, core.QgsVectorLayer):
        result.update({"kind": "vector", "geometry": core.QgsWkbTypes.displayString(layer.wkbType()),
                       "featureCount": layer.featureCount(),
                       "fields": [{"name": f.name(), "type": f.typeName(), "length": f.length(), "precision": f.precision()}
                                  for f in layer.fields()]})
    return result


def inspect_asset(workspace, source_id, collection, item_id, asset_name, *, progress=None):
    core = native()
    source = workspace.source(source_id)
    asset = source.assets.get(asset_key(collection, item_id, asset_name))
    require(asset is not None, "ASSET_NOT_FOUND", "Select an original scene asset.")
    result = {"sourceId": source.id, "collection": collection, "itemId": item_id, "assetKey": asset_name,
              "original": copy.deepcopy(asset["original"]), "outcome": asset.get("outcome"),
              "file": copy.deepcopy(asset.get("file")), "receipt": copy.deepcopy(asset.get("receipt")),
              "native": native_version(), "layers": []}
    if asset.get("file") is None:
        result["availability"] = "METADATA_ONLY"
        return result
    path = source.path(asset["file"]["path"], verify=True, progress=progress)
    sublayers = core.QgsProviderRegistry.instance().querySublayers(str(path))
    for detail in sublayers:
        if detail.providerKey() not in ("gdal", "ogr"):
            continue
        if detail.type() not in (core.Qgis.LayerType.Raster, core.Qgis.LayerType.Vector):
            continue
        if detail.providerKey() == "gdal":
            # Direct-file GDAL sources retain the existing native source. A container subdataset
            # is reported for operator selection, and must be received as its own local asset.
            layer = core.QgsRasterLayer(str(path), detail.name(), "gdal")
        else:
            layer = core.QgsVectorLayer(detail.uri(), detail.name(), "ogr")
        if layer.isValid():
            facts = describe_layer(layer)
            facts.update({"sublayer": detail.name(), "driver": detail.driverName()})
            result["layers"].append(facts)
    if not result["layers"]:
        layer = core.QgsRasterLayer(str(path), asset_name, "gdal")
        if layer.isValid():
            result["layers"].append(describe_layer(layer))
    result["availability"] = "LOCAL_NATIVE_LAYER" if result["layers"] else "LOCAL_OTHER_FILE"
    return result


def _native_uri_path(layer):
    core = native()
    decoded = core.QgsProviderRegistry.instance().decodeUri(layer.providerType(), layer.source())
    candidate = decoded.get("path") or decoded.get("fileName")
    if not candidate:
        candidate = layer.source().split("|", 1)[0]
    require(isinstance(candidate, str) and candidate and not re.match(r"^[A-Za-z]+://", candidate),
            "NATIVE_LOCAL_SOURCE", "The saved map layer must use its original retained local file.")
    return Path(candidate).expanduser().absolute().resolve()


def _expected_native_uri(path, definition):
    core = native()
    if definition["kind"] == "raster":
        return "gdal", str(path)
    selected_name = definition.get("vectorLayer", "")
    details = [x for x in core.QgsProviderRegistry.instance().querySublayers(str(path))
               if x.providerKey() == "ogr" and x.type() == core.Qgis.LayerType.Vector]
    if selected_name:
        matches = [x for x in details if x.name() == selected_name]
        require(len(matches) == 1, "VECTOR_SUBLAYER_SELECTION",
                "Choose an actual unambiguous native vector sublayer.", choices=[x.name() for x in details])
        return "ogr", matches[0].uri()
    require(len(details) <= 1, "VECTOR_SUBLAYER_REQUIRED",
            "This received file contains several native layers. Select its exact layer name.",
            choices=[x.name() for x in details])
    return "ogr", details[0].uri() if details else str(path)


def _uri_binding(provider, uri):
    decoded = dict(native().QgsProviderRegistry.instance().decodeUri(provider, uri))
    candidate = decoded.get("path") or decoded.get("fileName")
    if candidate:
        decoded["path"] = str(Path(candidate).expanduser().absolute().resolve())
        decoded.pop("fileName", None)
    else:
        decoded["path"] = str(Path(uri.split("|", 1)[0]).expanduser().absolute().resolve())
    # QGIS owns the native field spelling. Empty options have no native selection effect.
    return {key: value for key, value in decoded.items()
            if value not in ("", None, [], {}) and key.lower() not in ("subset", "subsetstring")}


def _verify_native_selection(layer, path, definition, *, subset=True):
    core = native()
    provider, expected_uri = _expected_native_uri(path, definition)
    expected_kind = core.QgsRasterLayer if definition["kind"] == "raster" else core.QgsVectorLayer
    require(isinstance(layer, expected_kind) and layer.providerType() == provider and
            _native_uri_path(layer) == path.resolve() and
            _uri_binding(provider, layer.source()) == _uri_binding(provider, expected_uri),
            "NATIVE_SUBLAYER_CHANGED",
            "The native provider, layer selection or URI options differ from the retained original asset.",
            layerId=definition["id"])
    if subset and isinstance(layer, core.QgsVectorLayer):
        require(layer.subsetString() == definition.get("vectorSubsetString", ""),
                "NATIVE_SUBSET_CHANGED", "The native vector filter differs from its retained analyst choice.",
                layerId=definition["id"])


def expected_layer_path(workspace, definition, *, progress=None):
    source = workspace.source(definition["sourceId"])
    if definition["kind"] == "footprints":
        selected = [source.scenes[key] for key in definition["sceneKeys"]]
        body = json_bytes({"type": "FeatureCollection", "features": selected})
        record = retain_bytes(workspace.root, "derived/" + sha_bytes(body) + ".geojson", body)
        return member(workspace.root, record["path"]), [record]
    asset = source.assets.get(asset_key(definition.get("collection"), definition["itemId"], definition["assetKey"]))
    require(asset and asset.get("file") and asset["file"] == definition["file"], "LAYER_ASSET_CHANGED",
            "The selected map layer differs from its retained original asset.")
    return source.path(asset["file"]["path"], verify=True, progress=progress), []


def build_layer(workspace, definition, *, progress=None):
    core = native()
    path, derived = expected_layer_path(workspace, definition, progress=progress)
    label = definition["label"]
    provider, uri = _expected_native_uri(path, definition)
    layer = core.QgsRasterLayer(uri, label, provider) if provider == "gdal" else core.QgsVectorLayer(uri, label, provider)
    require(layer.isValid(), "NATIVE_LAYER_INVALID", "QGIS could not open this selected retained file.",
            layerId=definition["id"], path=str(path))
    if isinstance(layer, core.QgsVectorLayer) and definition.get("vectorSubsetString"):
        require(layer.setSubsetString(definition["vectorSubsetString"]), "NATIVE_SUBSET_INVALID",
                "The native provider could not apply the selected vector filter.", layerId=definition["id"])
    _verify_native_selection(layer, path, definition)
    if definition.get("crsOverride"):
        crs = core.QgsCoordinateReferenceSystem(definition["crsOverride"])
        require(crs.isValid(), "CRS_INVALID", "Choose an actual QGIS CRS definition.")
        layer.setCrs(crs)
    # Missing source CRS stays visible to the analyst; an explicit override supplies it.
    require(layer.crs().isValid(), "SOURCE_CRS_REQUIRED",
            "This local file has no valid native CRS. Review its source metadata and choose an explicit CRS before mapping.",
            layerId=definition["id"])
    bands = definition.get("bands")
    if definition["kind"] == "raster" and bands:
        provider = layer.dataProvider()
        numbers = [bands["gray"]] if "gray" in bands else bands["rgb"]
        require(all(1 <= x <= layer.bandCount() for x in numbers), "NATIVE_BAND_RANGE",
                "Use actual native band numbers.", bandCount=layer.bandCount())
        if "gray" in bands:
            layer.setRenderer(core.QgsSingleBandGrayRenderer(provider, bands["gray"]))
        else:
            layer.setRenderer(core.QgsMultiBandColorRenderer(provider, *bands["rgb"]))
        layer.setDefaultContrastEnhancement()
    if definition.get("styleFile"):
        record = descriptor(definition["styleFile"])
        style_path = member(workspace.root, record["path"])
        file_digest(style_path, expected=record)
        for item in definition.get("styleDependencies", []):
            file_digest(member(workspace.root, item["path"]), expected=item)
        message, ok = layer.loadNamedStyle(str(style_path))
        require(ok, "NATIVE_STYLE_LOAD", "QGIS could not load the retained layer style.", detail=message)
    elif definition["kind"] == "footprints" and layer.geometryType() == core.Qgis.GeometryType.Polygon:
        symbol = core.QgsFillSymbol.createSimple({"color": "255,255,255,35", "outline_color": "45,45,45,255",
                                                "outline_width": "0.45", "outline_width_unit": "MM"})
        layer.renderer().setSymbol(symbol)
    if isinstance(layer, core.QgsRasterLayer):
        layer.renderer().setOpacity(float(definition["opacity"]))
    else:
        layer.setOpacity(float(definition["opacity"]))
    layer.setCustomProperty("starforge/workspaceId", workspace.read()["id"])
    layer.setCustomProperty("starforge/layerId", definition["id"])
    layer.setCustomProperty("starforge/sourceId", definition["sourceId"])
    layer.setCustomProperty("starforge/definitionSha256", value_sha(definition))
    return layer, derived


def add_to_project(workspace, project=None, *, progress=None):
    core = native()
    project = project or core.QgsProject.instance()
    state = workspace.read()
    built = [build_layer(workspace, row, progress=progress)[0] for row in state["layers"]]
    require(built, "LAYER_SELECTION_REQUIRED", "Choose at least one received GIS layer.")
    # Native preparation completes before replacing only this workspace's earlier map layers.
    owned = [x.id() for x in project.mapLayers().values()
             if x.customProperty("starforge/workspaceId") == state["id"]]
    project.removeMapLayers(owned)
    groups = [x for x in project.layerTreeRoot().children()
              if isinstance(x, core.QgsLayerTreeGroup) and x.customProperty("starforge/workspaceId") == state["id"]]
    for old in groups:
        project.layerTreeRoot().removeChildNode(old)
    group = project.layerTreeRoot().addGroup(state["title"])
    group.setCustomProperty("starforge/workspaceId", state["id"])
    for definition, layer in zip(state["layers"], built):
        project.addMapLayer(layer, False)
        node = group.addLayer(layer)
        node.setItemVisibilityChecked(definition["visible"])
    if not project.crs().isValid():
        project.setCrs(built[0].crs())
    return {"layers": [{"layerId": row["id"], "nativeLayerId": layer.id(), "native": describe_layer(layer)}
                       for row, layer in zip(state["layers"], built)]}


def zoom_managed(iface, workspace):
    core = native()
    project = core.QgsProject.instance()
    state = workspace.read()
    layers = [layer for layer in project.mapLayers().values()
              if layer.customProperty("starforge/workspaceId") == state["id"]]
    require(layers, "MANAGED_LAYERS_REQUIRED", "Apply this workspace's retained layers to the map first.")
    canvas = iface.mapCanvas()
    destination = canvas.mapSettings().destinationCrs()
    require(destination.isValid(), "MAP_CRS_REQUIRED", "Select the native map canvas CRS.")
    combined = None
    for layer in layers:
        if not layer.isValid() or layer.extent().isEmpty():
            continue
        box = core.QgsCoordinateTransform(layer.crs(), destination, project).transformBoundingBox(layer.extent())
        if combined is None:
            combined = core.QgsRectangle(box)
        else:
            combined.combineExtentWith(box)
    require(combined is not None and not combined.isEmpty(), "SPATIAL_EXTENT_REQUIRED",
            "The selected original layers have no nonempty spatial extent to zoom to.")
    combined.scale(1.05)
    canvas.setExtent(combined)
    canvas.refresh()
    return {"layers": len(layers), "crs": _crs(destination)}


def _style_resources(workspace, body):
    """Copy concrete local QML resources and rebase their native style references."""
    core = native()
    try:
        tree = ET.fromstring(body)
    except ET.ParseError as exc:
        raise QgisReceivingError("NATIVE_STYLE_XML", "QGIS returned an invalid native style.") from exc
    resources = {}
    resource_keys = {"name", "file", "path", "svg", "svgFile", "svgFilePath", "imageFile", "pictureFile", "texture_path"}
    suffixes = {".svg", ".png", ".jpg", ".jpeg", ".webp", ".tif", ".tiff"}
    def retain(value, key):
        if not isinstance(value, str) or not value or value.startswith(("base64:", "data:")):
            return value
        if value.startswith(("http://", "https://")) and key in resource_keys and Path(urllib.parse.urlparse(value).path).suffix.lower() in suffixes:
            raise QgisReceivingError("STYLE_RESOURCE_LOCAL_REQUIRED", "Receive the selected external style image locally before saving.", resource=value)
        raw = urllib.parse.unquote(urllib.parse.urlparse(value).path) if value.startswith("file://") else value
        candidate = Path(raw).expanduser()
        if not candidate.is_absolute():
            if key not in resource_keys or candidate.suffix.lower() not in suffixes:
                return value
            choices = [workspace.root / "styles" / candidate]
            choices += [Path(base) / candidate for base in core.QgsApplication.svgPaths()]
            candidate = next((x for x in choices if x.is_file()), candidate)
        if not candidate.is_file():
            require(not (key in resource_keys and Path(raw).suffix.lower() in suffixes),
                    "STYLE_RESOURCE_MISSING", "A selected style resource is missing.", resource=value)
            return value
        measured = file_digest(candidate)
        suffix = candidate.suffix.lower()
        name = "styles/resources/" + measured["sha256"] + suffix
        record = retain_copy(candidate, workspace.root, name, measured)
        resources[name] = record
        if suffix == ".svg":
            # SVG resources must be self-contained for the same bytes to render after receiving.
            svg = candidate.read_bytes()
            try:
                doc = ET.fromstring(svg)
            except ET.ParseError as exc:
                raise QgisReceivingError("STYLE_SVG_INVALID", "The native SVG resource could not be read.") from exc
            for node in doc.iter():
                for attr, target in node.attrib.items():
                    if attr.rsplit("}", 1)[-1] == "href":
                        require(target.startswith(("#", "data:")), "STYLE_SVG_DEPENDENCY",
                                "Embed linked images in the selected SVG before saving its complete project.", resource=value)
        return "./resources/" + Path(name).name
    for node in tree.iter():
        key = node.get("name") or node.get("k") or node.tag
        for attr, value in list(node.attrib.items()):
            node.set(attr, retain(value, key if attr in ("value", "v") else attr))
        if node.text and node.text.strip() == node.text:
            node.text = retain(node.text, key)
    return ET.tostring(tree, encoding="utf-8", xml_declaration=True), list(resources.values())


def capture_styles(workspace, project=None, *, revision, request_id, actor):
    core = native()
    project = project or core.QgsProject.instance()
    prior = workspace.operation(request_id)
    if prior:
        require(prior.get("event", {}).get("action") == "layers.saved", "REQUEST_REUSED", "This request belongs to a different project change.")
        return prior
    state = workspace.read()
    require(state["revision"] == revision, "REVISION_CHANGED", "Refresh the project before capturing styles.")
    definitions = copy.deepcopy(state["layers"])
    native_layers = {x.customProperty("starforge/layerId"): x for x in project.mapLayers().values()
                     if x.customProperty("starforge/workspaceId") == state["id"]}
    require(set(native_layers) >= {x["id"] for x in definitions}, "MANAGED_LAYERS_REQUIRED",
            "Load this workspace's current layers into QGIS before capturing their properties.")
    for row in definitions:
        layer = native_layers[row["id"]]
        require(layer.customProperty("starforge/sourceId") == row["sourceId"], "MAP_EDITION_CHANGED",
                "Apply the current reviewed layer selection before capturing its styles.")
        expected, _ = expected_layer_path(workspace, row)
        _verify_native_selection(layer, expected, row, subset=False)
        if isinstance(layer, core.QgsVectorLayer):
            row["vectorSubsetString"] = layer.subsetString()
        temp_root = workspace.root / "styles"
        temp_root.mkdir(mode=0o700, parents=True, exist_ok=True)
        fd, name = tempfile.mkstemp(prefix=".native-style-", suffix=".qml", dir=temp_root)
        os.close(fd)
        try:
            message, ok = layer.saveNamedStyle(name)
            require(ok, "NATIVE_STYLE_SAVE", "QGIS could not save this layer's native style.", detail=message)
            body, dependencies = _style_resources(workspace, Path(name).read_bytes())
            row["styleFile"] = retain_bytes(workspace.root, "styles/" + sha_bytes(body) + ".qml", body)
            row["styleDependencies"] = dependencies
        finally:
            Path(name).unlink(missing_ok=True)
        row["label"] = layer.name()
        row["crsOverride"] = layer.crs().authid() or layer.crs().toWkt()
        node = project.layerTreeRoot().findLayer(layer.id())
        row["visible"] = node.itemVisibilityChecked() if node else row["visible"]
        row["opacity"] = layer.renderer().opacity() if isinstance(layer, core.QgsRasterLayer) else layer.opacity()
    return workspace.save_layers(definitions, revision=revision, request_id=request_id, actor=actor)


def _verify_project_file(workspace, filename, definitions, input_sha256, *, progress=None):
    core = native()
    project = core.QgsProject()
    require(project.read(str(filename)), "NATIVE_PROJECT_READ", "QGIS could not reopen the saved native project.")
    require(project.readEntry("starforge", "workspaceId", "")[0] == workspace.read()["id"] and
            project.readEntry("starforge", "inputSha256", "")[0] == input_sha256,
            "NATIVE_PROJECT_IDENTITY", "The saved native map belongs to a different project input.")
    by_id = {layer.customProperty("starforge/layerId"): layer for layer in project.mapLayers().values()}
    require(set(by_id) == {row["id"] for row in definitions} and len(by_id) == len(project.mapLayers()),
            "NATIVE_LAYER_CLOSURE", "The saved native map must contain exactly its retained layer selection.")
    layers = []
    for row in definitions:
        layer = by_id[row["id"]]
        expected, _ = expected_layer_path(workspace, row, progress=progress)
        require(layer.isValid() and layer.customProperty("starforge/sourceId") == row["sourceId"],
                "NATIVE_PROJECT_SOURCE", "The reopened QGIS layer does not match its retained original edition.", layerId=row["id"])
        _verify_native_selection(layer, expected, row)
        layers.append({"layerId": row["id"], "sourceId": row["sourceId"], "native": describe_layer(layer)})
    with zipfile.ZipFile(filename) as archive:
        qgs = [n for n in archive.namelist() if n.endswith(".qgs")]
        require(len(qgs) == 1, "NATIVE_PROJECT_XML", "Keep the complete native QGZ project.")
        xml = ET.fromstring(archive.read(qgs[0]))
        for node in xml.findall(".//maplayer/datasource"):
            value = node.text or ""
            require(value.startswith("./") or value.startswith("../"), "NATIVE_RELATIVE_PATHS",
                    "The native map must use portable relative paths for every retained layer.", source=value)
    return project, {"native": native_version(), "layers": layers, "projectCrs": _crs(project.crs()), "relativePaths": True}


def save_project(workspace, *, revision, request_id, actor, project_crs=None, progress=None):
    core = native()
    require(isinstance(request_id, str) and REQUEST.fullmatch(request_id), "REQUEST_ID_REQUIRED",
            "Use one stable request ID for this native save.")
    state = workspace.read()
    prior = workspace.operation(request_id)
    if prior:
        require(prior.get("event", {}).get("action") == "project.saved", "REQUEST_REUSED",
                "This request ID belongs to a different workspace action.")
        retained_input, _ = read_json(member(workspace.root, "projects/" + request_id + "/native-input.json"))
        require(retained_input.get("revision") == revision and retained_input.get("projectCrs") == project_crs,
                "REQUEST_REUSED", "The saved native operation used a different input revision or project CRS.")
        return prior
    require(state["revision"] == revision, "REVISION_CHANGED", "Refresh the project before saving a map.")
    definitions = workspace.normalize_layers(state["layers"])
    require(definitions, "LAYER_SELECTION_REQUIRED", "Choose at least one received GIS layer.")
    plan = {"workspaceId": state["id"], "revision": revision, "layers": definitions, "projectCrs": project_crs}
    input_sha256 = value_sha(plan)
    operation_root = "projects/" + request_id
    plan_name = operation_root + "/native-input.json"
    retain_bytes(workspace.root, plan_name, json_bytes(plan))
    filename = member(workspace.root, operation_root + "/project.qgz", existing=False)
    derived = {}
    project = None
    if filename.exists():
        project, readback = _verify_project_file(workspace, filename, definitions, input_sha256, progress=progress)
        for row in definitions:
            _, files = expected_layer_path(workspace, row, progress=progress)
            for record in files:
                derived[record["path"]] = record
    else:
        project = core.QgsProject()
        project.setTitle(state["title"])
        project.setFilePathStorage(core.Qgis.FilePathType.Relative)
        project.writeEntry("starforge", "workspaceId", state["id"])
        project.writeEntry("starforge", "inputSha256", input_sha256)
        first_layer = None
        for row in definitions:
            layer, files = build_layer(workspace, row, progress=progress)
            if first_layer is None:
                first_layer = layer
            project.addMapLayer(layer, False)
            project.layerTreeRoot().addLayer(layer).setItemVisibilityChecked(row["visible"])
            for record in files:
                derived[record["path"]] = record
        crs = core.QgsCoordinateReferenceSystem(project_crs) if project_crs else first_layer.crs()
        require(crs.isValid(), "PROJECT_CRS_INVALID", "Select an actual QGIS project CRS.")
        project.setCrs(crs)
        project.viewSettings().setDefaultViewExtent(project.viewSettings().fullExtent())
        temporary = filename.parent / (".native-" + uuid.uuid4().hex + ".qgz")
        try:
            require(project.write(str(temporary)), "NATIVE_PROJECT_WRITE", "QGIS could not write the complete native map.")
            with temporary.open("rb") as stream:
                os.fsync(stream.fileno())
            _verify_project_file(workspace, temporary, definitions, input_sha256, progress=progress)
            try:
                os.link(temporary, filename)
            except FileExistsError:
                _verify_project_file(workspace, filename, definitions, input_sha256, progress=progress)
        finally:
            temporary.unlink(missing_ok=True)
        project, readback = _verify_project_file(workspace, filename, definitions, input_sha256, progress=progress)
    plan_record = {"path": plan_name, **file_digest(member(workspace.root, plan_name))}
    derived[plan_name] = plan_record
    record = {"file": {"path": str(filename.relative_to(workspace.root).as_posix()), **file_digest(filename)},
              "derivedFiles": [derived[name] for name in sorted(derived)], "readback": readback}
    return workspace.retain_project(record, revision=revision, request_id=request_id, actor=actor, input_sha256=input_sha256)


def reopen_project(workspace, project_id, *, progress=None):
    state = workspace.read()
    record = next((x for x in state["projects"] if x["id"] == project_id), None)
    require(record is not None, "PROJECT_NOT_FOUND", "Select a retained native project version.")
    for source_id in record["sourceIds"]:
        workspace.source(source_id, verify=True, progress=progress)
    for value in [record["file"]] + record.get("derivedFiles", []):
        file_digest(member(workspace.root, value["path"]), expected=value, progress=progress)
    for layer in record["layers"]:
        for value in ([layer["styleFile"]] if layer.get("styleFile") else []) + layer.get("styleDependencies", []):
            file_digest(member(workspace.root, value["path"]), expected=value, progress=progress)
    project, result = _verify_project_file(workspace, member(workspace.root, record["file"]["path"]),
                                          record["layers"], record["inputSha256"], progress=progress)
    return project, {"projectId": project_id, "workspaceId": state["id"], "revision": state["revision"], **result}
