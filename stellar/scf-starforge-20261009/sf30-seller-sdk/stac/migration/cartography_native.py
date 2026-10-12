# SPDX-License-Identifier: MIT
"""Native QGIS print layouts, exact file publication and original-project reopen.

The caller supplies the selected QGIS 3.40+ runtime. Rendering uses the original
vector destination claim and the migration workspace's existing request journal.
"""
from __future__ import annotations

import copy
import math
import os
from pathlib import Path
import shutil
import tempfile

from .native import files as native_files, model, qgis_project, program_files
from .receiving import _native_operation
from . import cartography as store

BUNDLE_SCHEMA = "starforge.migration-native-publication-bundle.v1"
LAYOUT_ID = "cartography-map"
ITEM_PREFIX = "cartography-"


def _need(value, code, message, **details):
    model.require(value, code, message, **details)


def _progress(callback, phase, operation, **details):
    if callback:
        callback({"phase": phase, "requestId": operation["requestId"],
                  "operationId": operation["id"], **details})


def _box(rectangle):
    return [rectangle.xMinimum(), rectangle.yMinimum(),
            rectangle.xMaximum(), rectangle.yMaximum()]


def _finite_box(value):
    return len(value) == 4 and all(math.isfinite(v) for v in value) and value[0] < value[2] and value[1] < value[3]


def _required_columns(core, project, layer):
    """Resolve the original renderer/label expressions against actual provider fields."""
    context = core.QgsExpressionContext()
    context.appendScopes([core.QgsExpressionContextUtils.globalScope(),
                          core.QgsExpressionContextUtils.projectScope(project),
                          core.QgsExpressionContextUtils.layerScope(layer)])
    render_context = core.QgsRenderContext()
    render_context.setExpressionContext(context)
    available = {field.name() for field in layer.fields()}
    required, expressions, label_fonts = set(), [], []

    def expression(value, role):
        if not value:
            return
        parsed = core.QgsExpression(value)
        _need(not parsed.hasParserError(), "CARTOGRAPHY_NATIVE_EXPRESSION",
              "The saved native style contains an invalid expression.",
              layerId=layer.customProperty("starforge/layerId"), role=role,
              expression=value, error=parsed.parserErrorString())
        columns = set(parsed.referencedColumns())
        required.update(columns)
        expressions.append({"role": role, "expression": value, "columns": sorted(columns)})

    renderer = layer.renderer()
    if renderer is not None:
        required.update(renderer.usedAttributes(render_context))
    labeling = layer.labeling()
    if layer.labelsEnabled() and labeling is not None:
        from qgis.PyQt.QtGui import QFontInfo
        for provider in labeling.subProviders() or [""]:
            settings = labeling.settings(provider)
            if settings.isExpression:
                expression(settings.fieldName, "label:" + provider)
            elif settings.fieldName:
                required.add(settings.fieldName)
            properties = settings.dataDefinedProperties()
            required.update(properties.referencedFields(context))
            font = settings.format().font()
            label_fonts.append({"provider": provider, "requestedFamily": font.family(),
                                "resolvedFamily": QFontInfo(font).family()})
        if isinstance(labeling, core.QgsRuleBasedLabeling):
            def rules(rule):
                if not rule.isElse():
                    expression(rule.filterExpression(), "label-rule")
                for child in rule.children():
                    rules(child)
            rules(labeling.rootRule())
    all_attributes = getattr(core.QgsFeatureRequest, "ALL_ATTRIBUTES", "#!allattributes!#")
    if all_attributes in required:
        required.remove(all_attributes)
        required.update(available)
    missing = sorted(required - available)
    _need(not missing, "CARTOGRAPHY_NATIVE_FIELDS",
          "Correct the selected native style's missing field bindings before publication.",
          layerId=layer.customProperty("starforge/layerId"), missingFields=missing)
    return {"requiredFields": sorted(required), "expressions": expressions, "labelFonts": label_fonts}


def _selected_layers(core, project, document):
    expected = document["spec"]["map"]["layerIds"]
    by_id = {str(layer.customProperty("starforge/layerId")): layer
             for layer in project.mapLayers().values()}
    _need(all(identifier in by_id for identifier in expected), "CARTOGRAPHY_NATIVE_LAYERS",
          "Reopen the complete saved map and its original selected layers.")
    selected, bindings = [], []
    original = {row["layerId"]: row for row in document["layerBindings"]}
    for identifier in expected:
        layer = by_id[identifier]
        _need(layer.isValid(), "CARTOGRAPHY_NATIVE_LAYER",
              "The original native provider could not reopen this layer.", layerId=identifier)
        record = copy.deepcopy(original[identifier])
        record["native"] = qgis_project.describe_layer(layer)
        if isinstance(layer, core.QgsVectorLayer):
            record["fieldBindings"] = _required_columns(core, project, layer)
        else:
            record["fieldBindings"] = None
        record["labelsEnabled"] = bool(isinstance(layer, core.QgsVectorLayer) and layer.labelsEnabled())
        selected.append(layer)
        bindings.append(record)
    return selected, bindings


def _map_extent(core, project, selected, spec):
    project_crs = project.crs()
    _need(project_crs.isValid(), "CARTOGRAPHY_NATIVE_CRS",
          "Choose a valid CRS in the original saved project before publication.")

    def crs_record(crs):
        return {"authId": crs.authid(), "wkt": crs.toWkt()}

    def transformed(box, source_crs, role, **details):
        _need(source_crs.isValid(), "CARTOGRAPHY_NATIVE_CRS",
              "The saved print extent has no valid source CRS.", role=role, **details)
        _need(_finite_box(_box(box)), "CARTOGRAPHY_NATIVE_EXTENT",
              "The saved print extent must have finite bounds and a nonempty area.",
              role=role, **details)
        try:
            return (core.QgsRectangle(box) if source_crs == project_crs
                    else core.QgsCoordinateTransform(source_crs, project_crs, project)
                    .transformBoundingBox(box))
        except Exception as error:
            raise model.QgisReceivingError(
                "CARTOGRAPHY_NATIVE_TRANSFORM", "QGIS could not transform the saved print extent.",
                role=role, error=str(error), **details) from error

    selection = {"projectCrs": crs_record(project_crs)}
    if isinstance(spec["map"]["extent"], list):
        result = core.QgsRectangle(*spec["map"]["extent"])
        selection.update({"kind": "explicit-project-crs", "sourceExtent": _box(result),
                          "sourceCrs": crs_record(project_crs), "transformed": False})
    else:
        saved_view = project.viewSettings().defaultViewExtent()
        if not saved_view.isNull():
            result = transformed(saved_view, saved_view.crs(), "saved-project-view")
            selection.update({"kind": "saved-project-view", "sourceExtent": _box(saved_view),
                              "sourceCrs": crs_record(saved_view.crs()),
                              "transformed": saved_view.crs() != project_crs})
        else:
            result, layer_extents = None, []
            for layer in selected:
                box = layer.extent()
                if box.isEmpty():
                    continue
                layer_id = str(layer.customProperty("starforge/layerId"))
                current = transformed(box, layer.crs(), "selected-layer-fallback", layerId=layer_id)
                _need(_finite_box(_box(current)), "CARTOGRAPHY_NATIVE_EXTENT",
                      "The transformed original layer has no finite printable extent.", layerId=layer_id)
                layer_extents.append({"layerId": layer_id, "sourceExtent": _box(box),
                                      "sourceCrs": crs_record(layer.crs()), "projectExtent": _box(current)})
                if result is None:
                    result = core.QgsRectangle(current)
                else:
                    result.combineExtentWith(current)
            _need(result is not None, "CARTOGRAPHY_NATIVE_EMPTY_MAP",
                  "Save a project view, choose a layer with a printable extent or enter an explicit map extent.")
            selection.update({"kind": "selected-layer-union-fallback",
                              "reason": "The saved project has no default view extent.",
                              "layerExtents": layer_extents})
    _need(_finite_box(_box(result)), "CARTOGRAPHY_NATIVE_EXTENT",
          "Choose a finite map extent in the original saved project CRS.")
    requested = _box(result)
    result.scale(1 + 2 * float(spec["map"]["paddingPercent"]) / 100)
    _need(_finite_box(_box(result)), "CARTOGRAPHY_NATIVE_EXTENT",
          "The requested print padding exceeds the finite native map extent.")
    selection.update({"projectExtent": requested, "paddingPercent": spec["map"]["paddingPercent"],
                      "paddedExtent": _box(result)})
    return result, requested, selection

def _text_item(core, layout, identifier, text, width, *, points, bold=False):
    from qgis.PyQt.QtCore import Qt
    from qgis.PyQt.QtGui import QColor, QFont, QFontInfo
    _need("[%" not in text, "CARTOGRAPHY_NATIVE_PLAIN_TEXT",
          "Use literal publication headings and attribution without QGIS expression markers.", field=identifier)
    item = core.QgsLayoutItemLabel(layout)
    item.setId(ITEM_PREFIX + identifier)
    item.setMode(core.QgsLayoutItemLabel.ModeFont)
    item.setMargin(0)
    item.setHAlign(Qt.AlignLeft)
    item.setVAlign(Qt.AlignTop)
    font = QFont("DejaVu Sans")
    font.setPointSizeF(points)
    font.setBold(bold)
    format_ = core.QgsTextFormat()
    format_.setFont(font)
    format_.setSize(points)
    format_.setColor(QColor("#202020"))
    item.setTextFormat(format_)
    layout.addLayoutItem(item)

    # Use QGIS's own label metrics for line wrapping in layout millimeters.
    def fits(value):
        item.setText(value)
        return item.sizeForText().width() <= width - 0.6
    wrapped = []
    for paragraph in text.split("\n"):
        words = paragraph.split()
        line = ""
        if not words:
            wrapped.append("")
            continue
        for word in words:
            candidate = (line + " " + word).strip()
            if fits(candidate):
                line = candidate
                continue
            if line:
                wrapped.append(line)
                line = ""
            if fits(word):
                line = word
                continue
            fragment = ""
            for character in word:
                if fragment and not fits(fragment + character):
                    wrapped.append(fragment)
                    fragment = ""
                fragment += character
            line = fragment
        wrapped.append(line)
    item.setText("\n".join(wrapped))
    measured = item.sizeForText()
    _need(measured.width() <= width + 0.05, "CARTOGRAPHY_NATIVE_TEXT_WIDTH",
          "The original publication text does not fit the selected page.", field=identifier)
    height = max(measured.height() + 0.8, points * 25.4 / 72 + 0.8)
    item.attemptResize(core.QgsLayoutSize(width, height))
    return item, height, {"itemId": item.id(), "requestedFamily": font.family(),
                          "resolvedFamily": QFontInfo(font).family(), "points": points,
                          "originalText": text, "renderedText": item.text()}


def _item_box(item):
    rect = item.sceneBoundingRect()
    return {"x": rect.x(), "y": rect.y(), "width": rect.width(), "height": rect.height()}


def _inside(item, width, height):
    box = _item_box(item)
    tolerance = 0.5
    _need(box["x"] >= -tolerance and box["y"] >= -tolerance
          and box["x"] + box["width"] <= width + tolerance
          and box["y"] + box["height"] <= height + tolerance,
          "CARTOGRAPHY_NATIVE_PAGE_FIT", "Choose a larger page or shorten the map's publication text.",
          itemId=item.id(), bounds=box, page={"width": width, "height": height})
    return box


def _build_layout(core, project, selected, document, operation):
    from qgis.PyQt.QtGui import QColor, QFont
    spec = document["spec"]
    layout = core.QgsPrintLayout(project)
    layout.initializeDefaults()
    layout.setName("Publication " + operation["id"][:16])
    layout.setCustomProperty("starforge/publicationInputSha256", operation["inputSha256"])
    layout.setCustomProperty("starforge/publicationRequestId", operation["requestId"])
    layout.renderContext().setDpi(spec["page"]["dpi"])
    page = layout.pageCollection().page(0)
    orientation = (core.QgsLayoutItemPage.Landscape if spec["page"]["orientation"] == "landscape"
                   else core.QgsLayoutItemPage.Portrait)
    page.setPageSize(spec["page"]["size"], orientation)
    width, height = page.sizeWithUnits().width(), page.sizeWithUnits().height()
    margin, gap = 12.0, 5.0
    inner_width = width - 2 * margin
    title, title_height, title_font = _text_item(
        core, layout, "title", spec["title"], inner_width, points=16, bold=True)
    title.attemptMove(core.QgsLayoutPoint(margin, margin))
    header_bottom = margin + title_height
    fonts = [title_font]
    if spec["subtitle"]:
        subtitle, subtitle_height, subtitle_font = _text_item(
            core, layout, "subtitle", spec["subtitle"], inner_width, points=10)
        subtitle.attemptMove(core.QgsLayoutPoint(margin, header_bottom + 1))
        header_bottom += subtitle_height + 1
        fonts.append(subtitle_font)
    attribution, attribution_height, attribution_font = _text_item(
        core, layout, "attribution", spec["attribution"], inner_width, points=8)
    attribution.attemptMove(core.QgsLayoutPoint(margin, height - margin - attribution_height))
    fonts.append(attribution_font)
    map_y = header_bottom + gap
    scale_height = 13.0 if spec["scaleBar"]["show"] else 0.0
    map_height = height - margin - attribution_height - gap - scale_height - map_y
    _need(map_height >= 65, "CARTOGRAPHY_NATIVE_PAGE_CONTENT",
          "Choose A3 or shorten the title, subtitle or attribution to leave a usable native map.")

    legend_width, legend = 0.0, None
    if spec["legend"]["show"]:
        legend = core.QgsLayoutItemLegend(layout)
        legend.setId(ITEM_PREFIX + "legend")
        legend.setTitle(spec["legend"]["title"])
        legend.setAutoUpdateModel(False)
        legend.setResizeToContents(True)
        tree = legend.model().rootGroup()
        tree.removeAllChildren()
        for layer in selected:
            tree.addLayer(layer)
        legend_font = QFont("DejaVu Sans", 8)
        for component in (core.QgsLegendStyle.Title, core.QgsLegendStyle.Group,
                          core.QgsLegendStyle.Subgroup, core.QgsLegendStyle.SymbolLabel):
            legend.setStyleFont(component, legend_font)
        layout.addLayoutItem(legend)
        legend.adjustBoxSize()
        legend_width = max(40.0, legend.sizeWithUnits().width())
        _need(legend_width <= inner_width * 0.35
              and legend.sizeWithUnits().height() <= map_height,
              "CARTOGRAPHY_NATIVE_LEGEND_FIT",
              "Choose A3 or reduce the selected map layers so the complete native legend fits.",
              legend=_item_box(legend), availableHeight=map_height, maximumWidth=inner_width * 0.35)
        legend.attemptMove(core.QgsLayoutPoint(width - margin - legend_width, map_y))

    map_width = inner_width - (legend_width + gap if legend is not None else 0)
    map_item = core.QgsLayoutItemMap(layout)
    map_item.setId(LAYOUT_ID)
    layout.addLayoutItem(map_item)
    map_item.attemptMove(core.QgsLayoutPoint(margin, map_y))
    map_item.attemptResize(core.QgsLayoutSize(map_width, map_height))
    map_item.setCrs(project.crs())
    map_item.setFollowVisibilityPreset(False)
    map_item.setLayers(selected)
    map_item.setKeepLayerSet(True)
    map_item.storeCurrentLayerStyles()
    map_item.setKeepLayerStyles(True)
    map_item.setFrameEnabled(True)
    map_item.setFrameStrokeColor(QColor("#707070"))
    map_item.setFrameStrokeWidth(core.QgsLayoutMeasurement(0.2))
    extent, requested_extent, extent_selection = _map_extent(core, project, selected, spec)
    map_item.zoomToExtent(extent)
    map_item.refresh()
    layout.setReferenceMap(map_item)
    if legend is not None:
        legend.setLinkedMap(map_item)
        legend.refresh()
        legend.adjustBoxSize()
        _need(legend.sizeWithUnits().width() <= legend_width + 0.1
              and legend.sizeWithUnits().height() <= map_height,
              "CARTOGRAPHY_NATIVE_LEGEND_FIT", "The complete native legend exceeds its selected print area.")
    if spec["scaleBar"]["show"]:
        scale = core.QgsLayoutItemScaleBar(layout)
        scale.setId(ITEM_PREFIX + "scale")
        scale.setStyle("Single Box")
        scale.setLinkedMap(map_item)
        scale.applyDefaultSize(scale.guessUnits())
        scale.setNumberOfSegments(2)
        scale.setNumberOfSegmentsLeft(0)
        scale.setHeight(2)
        layout.addLayoutItem(scale)
        scale.attemptMove(core.QgsLayoutPoint(margin, map_y + map_height + 2))
        scale.refresh()
        _need(scale.sceneBoundingRect().bottom() <= height - margin - attribution_height - 1,
              "CARTOGRAPHY_NATIVE_SCALE_FIT", "The native scale bar needs more room above the attribution.")
    layout.refresh()
    for item in layout.items():
        if isinstance(item, core.QgsLayoutItem) and item.id().startswith(ITEM_PREFIX):
            _inside(item, width, height)
    _need(project.layoutManager().addLayout(layout), "CARTOGRAPHY_NATIVE_LAYOUT",
          "QGIS could not retain the original print layout in the saved project.")
    return layout, {"fonts": fonts, "requestedExtent": requested_extent, "extentSelection": extent_selection}


def _layout_state(core, layout, document, operation):
    spec = document["spec"]
    _need(layout.customProperty("starforge/publicationInputSha256") == operation["inputSha256"]
          and layout.customProperty("starforge/publicationRequestId") == operation["requestId"],
          "CARTOGRAPHY_NATIVE_LAYOUT_IDENTITY", "The print layout belongs to a different original rendering input.")
    _need(layout.pageCollection().pageCount() == 1, "CARTOGRAPHY_NATIVE_PAGES",
          "Keep the one reviewed native print page.")
    page = layout.pageCollection().page(0)
    width, height = page.sizeWithUnits().width(), page.sizeWithUnits().height()
    expected = (210.0, 297.0) if spec["page"]["size"] == "A4" else (297.0, 420.0)
    if spec["page"]["orientation"] == "landscape":
        expected = expected[::-1]
    _need(abs(width - expected[0]) < 0.01 and abs(height - expected[1]) < 0.01,
          "CARTOGRAPHY_NATIVE_PAGE_CHANGED", "The native page differs from the reviewed paper selection.")
    map_item = layout.itemById(LAYOUT_ID)
    _need(isinstance(map_item, core.QgsLayoutItemMap) and map_item.keepLayerSet()
          and map_item.keepLayerStyles() and map_item.crs() == layout.project().crs(),
          "CARTOGRAPHY_NATIVE_MAP_CHANGED", "Retain the original map CRS, selected layers and native styles.")
    selected = [str(layer.customProperty("starforge/layerId")) for layer in map_item.layersToRender()]
    _need(selected == spec["map"]["layerIds"], "CARTOGRAPHY_NATIVE_LAYER_ORDER",
          "The reopened native layout changed the selected layer drawing order.")
    expected_ids = {ITEM_PREFIX + "title", ITEM_PREFIX + "attribution", LAYOUT_ID}
    if spec["subtitle"]:
        expected_ids.add(ITEM_PREFIX + "subtitle")
    if spec["legend"]["show"]:
        expected_ids.add(ITEM_PREFIX + "legend")
    if spec["scaleBar"]["show"]:
        expected_ids.add(ITEM_PREFIX + "scale")
    items = {item.id(): item for item in layout.items()
             if isinstance(item, core.QgsLayoutItem) and item.id().startswith(ITEM_PREFIX)}
    _need(set(items) == expected_ids, "CARTOGRAPHY_NATIVE_ITEM_CLOSURE",
          "The native layout must retain exactly its reviewed print items.")
    records = [{"id": identifier, "bounds": _inside(items[identifier], width, height)}
               for identifier in sorted(items)]
    return {"name": layout.name(), "page": {"size": spec["page"]["size"],
            "orientation": spec["page"]["orientation"], "widthMm": width, "heightMm": height,
            "dpi": spec["page"]["dpi"]}, "extent": _box(map_item.extent()), "scale": map_item.scale(),
            "crs": qgis_project._crs(map_item.crs()), "layerIds": selected, "items": records,
            "styleOverridesSha256": model.value_sha(dict(map_item.layerStyleOverrides())),
            "keepLayerSet": True, "keepLayerStyles": True}


def _load_template(core, project, path, document, operation):
    from qgis.PyQt.QtCore import QByteArray
    from qgis.PyQt.QtXml import QDomDocument
    raw = Path(path).read_bytes()
    dom = QDomDocument()
    loaded = dom.setContent(QByteArray(raw))
    _need(loaded[0] if isinstance(loaded, tuple) else bool(loaded),
          "CARTOGRAPHY_NATIVE_TEMPLATE_XML", "QGIS could not read the retained print template.")
    context = core.QgsReadWriteContext()
    context.setPathResolver(core.QgsPathResolver(str(path)))
    layout = core.QgsPrintLayout(project)
    loaded = layout.loadFromTemplate(dom, context)
    if isinstance(loaded, tuple):
        items, ok = loaded
    else:
        items, ok = loaded, bool(loaded)
    _need(ok and items, "CARTOGRAPHY_NATIVE_TEMPLATE",
          "QGIS could not independently restore the complete retained print template.")
    # A QPT carries QgsLayout content; the generated QgsPrintLayout name is the
    # same original operation selector used when it is attached to the project.
    layout.setName("Publication " + operation["id"][:16])
    return layout, _layout_state(core, layout, document, operation)


def _png(path, page):
    from qgis.PyQt.QtGui import QImageReader
    reader = QImageReader(str(path))
    image = reader.read()
    _need(not image.isNull(), "CARTOGRAPHY_NATIVE_PNG",
          "The complete native PNG could not be reopened.", error=reader.errorString())
    expected = (round(page["widthMm"] * page["dpi"] / 25.4),
                round(page["heightMm"] * page["dpi"] / 25.4))
    _need(abs(image.width() - expected[0]) <= 1 and abs(image.height() - expected[1]) <= 1,
          "CARTOGRAPHY_NATIVE_PNG_SIZE", "The native preview does not match the reviewed page and DPI.",
          actual=[image.width(), image.height()], expected=list(expected))
    return {"width": image.width(), "height": image.height(), "format": str(image.format())}


def _pdf(path):
    with Path(path).open("rb") as stream:
        start = stream.read(8)
        stream.seek(max(0, Path(path).stat().st_size - 1024))
        tail = stream.read()
    _need(start.startswith(b"%PDF-") and b"%%EOF" in tail, "CARTOGRAPHY_NATIVE_PDF",
          "Retain the complete PDF returned by the native layout exporter.")
    return {"header": start.decode("ascii", "replace"), "completeTrailer": True}


def _record(workspace, path, relative):
    return {"path": relative, **model.file_digest(path)}


def _verify_bundle(workspace, core, directory, document, operation, *, progress=None):
    bundle_path = directory / "native-bundle.json"
    bundle, raw = model.read_json(bundle_path)
    _need(bundle.get("schema") == BUNDLE_SCHEMA and bundle.get("inputSha256") == operation["inputSha256"]
          and bundle.get("requestId") == operation["requestId"],
          "CARTOGRAPHY_NATIVE_BUNDLE", "The retained native files belong to another render.")
    _need(set(bundle.get("output", {})) == {"qgz", "qpt", "pdf", "png"},
          "CARTOGRAPHY_NATIVE_OUTPUTS", "Keep all four native print outputs.")
    canonical = operation["directory"] + "/native-work/output/"
    for kind, record in bundle["output"].items():
        model.descriptor(record)
        _need(record["path"] == canonical + store.OUTPUTS[kind][1],
              "CARTOGRAPHY_NATIVE_OUTPUT_PATH", "Keep the original native output filenames.")
        model.file_digest(directory / store.OUTPUTS[kind][1], expected=record, progress=progress)
    original = document["project"]
    project, native_readback = qgis_project._verify_project_file(
        workspace, directory / "map.qgz", original["layers"], original["inputSha256"], progress=progress)
    _need(project.readEntry("starforge", "publicationInputSha256", "")[0] == operation["inputSha256"],
          "CARTOGRAPHY_NATIVE_PROJECT_IDENTITY", "The saved publication map has another render identity.")
    layout = project.layoutManager().layoutByName(bundle["layout"]["name"])
    _need(layout is not None, "CARTOGRAPHY_NATIVE_LAYOUT_MISSING",
          "Reopen the exact retained layout inside the native project.")
    actual = _layout_state(core, layout, document, operation)
    _need(actual == bundle["layout"], "CARTOGRAPHY_NATIVE_LAYOUT_CHANGED",
          "The reopened native layout differs from its retained print result.")
    template, template_readback = _load_template(core, project, directory / "layout.qpt", document, operation)
    _need(template_readback == actual, "CARTOGRAPHY_NATIVE_TEMPLATE_CHANGED",
          "The retained template and native project do not describe the same reviewed print page.")
    selected, bindings = _selected_layers(core, project, document)
    _need(bindings == bundle["sourceBindings"], "CARTOGRAPHY_NATIVE_SOURCE_CHANGED",
          "The reopened native source, field or label bindings changed.")
    image = _png(directory / "map.png", actual["page"])
    pdf = _pdf(directory / "map.pdf")
    return bundle, {"nativeProject": native_readback, "layout": actual, "template": template_readback,
                    "png": image, "pdf": pdf, "sourceBindings": bindings,
                    "templateLoaded": True, "nativeProjectLoaded": True}


def _render_bundle(workspace, core, parent, document, operation, progress):
    output = parent / "output"
    if output.exists():
        _need(output.is_dir() and not output.is_symlink(), "CARTOGRAPHY_NATIVE_DIRECTORY",
              "Use the original ordinary native output directory.")
        return _verify_bundle(workspace, core, output, document, operation, progress=progress)
    original, reopened = qgis_project.reopen_project(workspace, document["project"]["id"], progress=progress)
    selected, bindings = _selected_layers(core, original, document)
    layout, text_details = _build_layout(core, original, selected, document, operation)
    layout_state = _layout_state(core, layout, document, operation)
    temporary = Path(tempfile.mkdtemp(prefix=".render-", dir=parent))
    try:
        original.setFilePathStorage(core.Qgis.FilePathType.Relative)
        original.writeEntry("starforge", "publicationInputSha256", operation["inputSha256"])
        project_path = temporary / "map.qgz"
        _need(original.write(str(project_path)), "CARTOGRAPHY_NATIVE_PROJECT_WRITE",
              "QGIS could not save the editable publication project.")
        context = core.QgsReadWriteContext()
        context.setPathResolver(core.QgsPathResolver(str(project_path)))
        _need(layout.saveAsTemplate(str(temporary / "layout.qpt"), context),
              "CARTOGRAPHY_NATIVE_TEMPLATE_WRITE", "QGIS could not save the editable print template.")
        _progress(progress, "cartography-pdf", operation)
        exporter = core.QgsLayoutExporter(layout)
        pdf_settings = core.QgsLayoutExporter.PdfExportSettings()
        pdf_settings.dpi = document["spec"]["page"]["dpi"]
        pdf_settings.forceVectorOutput = False
        pdf_settings.rasterizeWholeImage = False
        pdf_status = exporter.exportToPdf(str(temporary / "map.pdf"), pdf_settings)
        _need(pdf_status == core.QgsLayoutExporter.Success, "CARTOGRAPHY_NATIVE_PDF_EXPORT",
              "QGIS could not export the complete print PDF.",
              nativeStatus=int(pdf_status), nativeError=exporter.errorMessage())
        _progress(progress, "cartography-png", operation)
        image_settings = core.QgsLayoutExporter.ImageExportSettings()
        image_settings.dpi = document["spec"]["page"]["dpi"]
        image_settings.cropToContents = False
        image_settings.generateWorldFile = False
        image_status = exporter.exportToImage(str(temporary / "map.png"), image_settings)
        _need(image_status == core.QgsLayoutExporter.Success, "CARTOGRAPHY_NATIVE_PNG_EXPORT",
              "QGIS could not export the complete native map preview.",
              nativeStatus=int(image_status), nativeError=exporter.errorMessage())
        map_item = layout.itemById(LAYOUT_ID)
        errors = [{"layerId": str(error.layerID), "message": str(error.message)}
                  for error in map_item.renderingErrors()]
        _need(not errors, "CARTOGRAPHY_NATIVE_RENDER_ERRORS",
              "The native provider reported errors while drawing the map.", errors=errors)
        _png(temporary / "map.png", layout_state["page"])
        _pdf(temporary / "map.pdf")
        canonical = operation["directory"] + "/native-work/output/"
        output_records = {}
        for kind in ("qgz", "qpt", "pdf", "png"):
            path = temporary / store.OUTPUTS[kind][1]
            with path.open("rb") as stream:
                os.fsync(stream.fileno())
            output_records[kind] = _record(workspace, path, canonical + path.name)
        bundle = {"schema": BUNDLE_SCHEMA, "inputSha256": operation["inputSha256"],
                  "requestId": operation["requestId"], "completedAt": model.utc_now(),
                  "native": qgis_project.native_version(), "layout": layout_state,
                  "sourceBindings": bindings, "text": text_details, "output": output_records,
                  "export": {"pdf": int(pdf_status), "png": int(image_status), "renderErrors": errors}}
        model.retain_bytes(temporary, "native-bundle.json", model.json_bytes(bundle))
        # Both directories have the same depth, so relative QGIS resource paths survive.
        verified, readback = _verify_bundle(workspace, core, temporary, document, operation, progress=progress)
        _need(not output.exists(), "CARTOGRAPHY_NATIVE_OUTPUT_EXISTS",
              "Reconcile the original complete output before another publication.")
        os.rename(temporary, output)
        descriptor = os.open(parent, os.O_RDONLY)
        try:
            os.fsync(descriptor)
        finally:
            os.close(descriptor)
        return verified, readback
    finally:
        if temporary.exists():
            shutil.rmtree(temporary)


def _publication_document(workspace, operation, plan, bundle, readback):
    parent = model.member(workspace.root, operation["directory"] + "/native-work/request.json").parent
    bundle_file = parent / "output" / "native-bundle.json"
    records = [operation["inputFile"],
               _record(workspace, parent / "request.json",
                       operation["directory"] + "/native-work/request.json"),
               _record(workspace, bundle_file,
                       operation["directory"] + "/native-work/output/native-bundle.json"),
               *bundle["output"].values()]
    return {"schema": store.RESULT_SCHEMA, "id": "publication-" + operation["id"],
            "workspaceId": plan["workspaceId"], "inputSha256": operation["inputSha256"],
            "requestId": operation["requestId"], "planId": operation["planId"],
            "softwareId": operation["softwareId"],
            "projectId": operation["projectId"], "title": plan["spec"]["title"],
            "completedAt": bundle["completedAt"], "native": bundle["native"],
            "layout": bundle["layout"], "sourceBindings": bundle["sourceBindings"],
            "text": bundle["text"], "nativeReadback": readback, "export": bundle["export"],
            "predecessorPublicationId": plan["spec"]["predecessorPublicationId"],
            "comparison": plan["comparison"], "review": plan["spec"]["review"],
            "output": bundle["output"], "files": sorted(records, key=lambda row: row["path"])}


@_native_operation
def render(workspace, plan_id, *, revision, request_id, actor, progress=None):
    core = qgis_project.native()
    operation = store._start(workspace, plan_id, revision=revision, request_id=request_id, actor=actor)
    try:
        state = workspace.read()
        plan_row, plan = store._plan(workspace, state, plan_id)
        if operation["status"] == "complete":
            return store._finish(workspace, operation)
        installed = [{"path": name, "bytes": len(raw), "sha256": native_files.digest(raw)}
                     for name, raw in program_files()]
        _need(native_files.digest(installed) == operation["softwareId"], "CARTOGRAPHY_NATIVE_SOFTWARE",
              "Continue this original render through its retained complete publisher source.",
              softwareId=operation["softwareId"])
        root = model.member(workspace.root, operation["directory"] + "/native-work/request.json", existing=False).parent
        claim = {"schema": "starforge.migration-cartography-claim.v1",
                 "workspaceId": state["id"], "requestId": request_id, "inputSha256": operation["inputSha256"]}
        # The inherited destination lock serializes same-request reentry and releases on process loss.
        with native_files.claim(root, claim):
            _progress(progress, "cartography-original-project", operation)
            bundle, readback = _render_bundle(workspace, core, root, plan, operation, progress)
            result = _publication_document(workspace, operation, plan, bundle, readback)
            model.retain_bytes(workspace.root, operation["directory"] + "/publication.json",
                               model.json_bytes(result))
            _progress(progress, "cartography-retain-publication", operation)
            return store._finish(workspace, operation)
    except BaseException as error:
        store._failure(workspace, operation, error)
        raise


@_native_operation
def reopen(workspace, *, progress=None, publication_id=None):
    core = qgis_project.native()
    state = workspace.read()
    store.validate(state)
    rows = store._state(state)["publications"]
    if publication_id is not None:
        rows = [store._row(state, "publications", publication_id)]
    results = []
    for row in rows:
        operation = next(item for item in store._state(state)["operations"]
                         if item["requestId"] == row["requestId"])
        retained = store._result(workspace, operation)
        _need(retained is not None and retained[1] == row["file"],
              "CARTOGRAPHY_NATIVE_RECEIPT", "Keep the original publication receipt in the complete workspace.")
        plan_row, plan = store._plan(workspace, state, row["planId"])
        path = model.member(workspace.root, operation["directory"] + "/native-work/output/native-bundle.json").parent
        _progress(progress, "cartography-reopen", operation, publicationId=row["id"])
        bundle, readback = _verify_bundle(workspace, core, path, plan, operation, progress=progress)
        _need(bundle["output"] == row["output"], "CARTOGRAPHY_NATIVE_REOPEN_OUTPUTS",
              "The received native files differ from the retained publication.")
        results.append({"publicationId": row["id"], "requestId": row["requestId"],
                        "planId": row["planId"], "outputs": copy.deepcopy(row["output"]), **readback})
    return {"workspaceId": state["id"], "revision": state["revision"], "publications": results}
