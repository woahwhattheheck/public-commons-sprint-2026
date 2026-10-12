# SPDX-License-Identifier: MIT
"""Native QGIS/QFieldSync field project creation and once-per-export receiving."""
from __future__ import annotations

import copy
import gc
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import sqlite3
import tempfile
import uuid

from .model import (QgisReceivingError, require, json_bytes, value_sha, read_json,
                    file_digest, member, retain_copy, retain_bytes, utc_now)
from .field import (ordinary_tree, verify_tree, copy_tree, read_bundle, configuration,
                    ATTACHMENT_DIRS)

EDITION_SCHEMA = "starforge.qfield.edition.v1"
DEVICE_SCHEMA = "starforge.qfield.device-export.v1"

def _qgis():
    from qgis.core import (Qgis, QgsProject, QgsVectorLayer, QgsRasterLayer,
        QgsVectorFileWriter, QgsProviderRegistry, QgsEditorWidgetSetup, QgsField,
        QgsFieldConstraints, QgsDefaultValue, QgsRelation, QgsOfflineEditing,
        QgsGeometry, QgsAttributeEditorContainer, QgsAttributeEditorField,
        QgsAttributeEditorRelation, QgsEditFormConfig)
    from qgis.PyQt.QtCore import QVariant, QMetaType, Qt
    from qgis.PyQt.QtXml import QDomDocument
    require(Qgis.QGIS_VERSION_INT >= 34000, "FIELD_QGIS_VERSION",
            "Use the selected QGIS 3.40 or newer native environment.")
    return locals()

def native_versions():
    q = _qgis()
    import libqfieldsync
    try:
        from importlib.metadata import version
        lib_version = version("libqfieldsync")
    except Exception:
        lib_version = getattr(libqfieldsync, "__version__", "installed source")
    return {"qgis": q["Qgis"].QGIS_VERSION, "libqfieldsync": str(lib_version),
            "libqfieldsyncSource": str(Path(libqfieldsync.__file__).resolve())}

def _notify(progress, phase, **values):
    if progress:
        progress({"phase": phase, **values})

def _relative(root, path):
    root, path = Path(root).resolve(), Path(path).resolve()
    require(path.is_relative_to(root), "FIELD_NATIVE_PATH", "A native field member escaped its owned directory.")
    return path.relative_to(root).as_posix()

def _path(root, rel, *, is_dir=False):
    path = member(Path(root), rel, existing=not is_dir)
    if is_dir:
        require(path.is_dir(), "FIELD_DIRECTORY", "A retained native field directory is missing.", path=rel)
    return path

def _source(layer):
    q = _qgis()
    provider = layer.providerType()
    require(provider in ("ogr", "gdal"), "FIELD_LOCAL_PROVIDER",
            "Commission retained local vector or raster data for cable collection.", layer=layer.name(), provider=provider)
    decoded = q["QgsProviderRegistry"].instance().decodeUri(provider, layer.source())
    value = decoded.get("path")
    require(isinstance(value, str) and value and not value.startswith("/vsi") and "://" not in value,
            "FIELD_LOCAL_SOURCE", "Use actual retained local data for this field project.", layer=layer.name())
    path = Path(value).expanduser().absolute()
    require(path.is_file() and not path.is_symlink(), "FIELD_NATIVE_SOURCE",
            "The selected native data file is unavailable.", layer=layer.name())
    return provider, decoded, path.resolve()

def _repoint(layer, path):
    q = _qgis()
    provider, decoded, _ = _source(layer)
    decoded["path"] = str(Path(path).resolve())
    uri = q["QgsProviderRegistry"].instance().encodeUri(provider, decoded)
    layer.setDataSource(uri, layer.name(), provider)
    require(layer.isValid(), "FIELD_NATIVE_SOURCE", "The copied native layer did not reopen.", layer=layer.name())
    return uri

def _loaded(path):
    q = _qgis()
    project = q["QgsProject"].instance()
    project.clear()
    require(project.read(str(path)), "FIELD_PROJECT_OPEN", "The original native project could not be opened.", path=str(path))
    require(all(layer.isValid() for layer in project.mapLayers().values()), "FIELD_LAYER_OPEN",
            "A native field layer did not reopen.")
    return project

def _binding(project):
    result = {}
    for layer in project.mapLayers().values():
        original = str(layer.customProperty("starforge/layerId", ""))
        if original:
            require(original not in result, "FIELD_LAYER_BINDING", "A project has duplicate original layer IDs.")
            result[original] = layer
    return result

def _scalar(value):
    if value is None:
        return None
    try:
        if value.isNull():
            return None
    except AttributeError:
        pass
    if isinstance(value, (str, bool, int)):
        return value
    if isinstance(value, float):
        require(value == value and abs(value) != float("inf"), "FIELD_VALUE", "A native attribute is not finite.")
        return value
    if isinstance(value, bytes):
        return {"encoding": "hex", "value": value.hex()}
    if isinstance(value, (list, tuple)):
        return [_scalar(x) for x in value]
    if isinstance(value, dict):
        return {str(k): _scalar(v) for k, v in value.items()}
    if hasattr(value, "toString"):
        q = _qgis()
        return value.toString(q["Qt"].DateFormat.ISODate)
    # QVariant NULL, including the QGIS NULL singleton, has this native marker.
    if type(value).__name__ in ("QPyNullVariant", "QVariant"):
        return None
    raise QgisReceivingError("FIELD_ATTRIBUTE_TYPE", "The native attribute type needs an explicit field mapping.",
                             type=type(value).__name__)

def _geometry(feature):
    q = _qgis()
    geometry = feature.geometry()
    if geometry is None or geometry.isNull():
        return None
    normalized = q["QgsGeometry"](geometry)
    normalized.normalize()
    data = bytes(normalized.asWkb())
    return {"sha256": hashlib.sha256(data).hexdigest(), "wkt": normalized.asWkt(17)}

def _snapshot(project, config, output, *, layer_map=None, progress=None, field_names=None):
    q = _qgis()
    native_layers = layer_map or _binding(project)
    require(not Path(output).exists(), "FIELD_SNAPSHOT_EXISTS", "Use a fresh native feature snapshot.")
    counts, schemas = {}, {}
    with sqlite3.connect(output) as db:
        db.execute("PRAGMA journal_mode=DELETE")
        db.execute("CREATE TABLE features(layer_id TEXT NOT NULL,feature_key TEXT NOT NULL,body TEXT NOT NULL,sha256 TEXT NOT NULL,PRIMARY KEY(layer_id,feature_key)) WITHOUT ROWID")
        db.execute("CREATE TABLE metadata(key TEXT PRIMARY KEY,body TEXT NOT NULL)")
        for configured in config["layers"]:
            layer_id = configured["layerId"]
            layer = native_layers.get(layer_id)
            require(isinstance(layer, q["QgsVectorLayer"]) and layer.isValid(), "FIELD_NATIVE_LAYER",
                    "The selected editable layer is unavailable.", layerId=layer_id)
            names = field_names.get(layer_id) if field_names else [f.name() for f in layer.fields()
                    if f.name().lower() != "fid" or f.name() == configured["identityField"]]
            require(configured["identityField"] in names and all(layer.fields().indexFromName(n) >= 0 for n in names),
                    "FIELD_NATIVE_FIELDS", "The returned native schema no longer contains the commissioned fields.", layerId=layer_id)
            count = 0
            for feature in layer.getFeatures():
                attrs = {name: _scalar(feature[name]) for name in names}
                identity = attrs[configured["identityField"]]
                require(identity is not None and identity != "" and isinstance(identity, (str, int)),
                        "FIELD_IDENTITY", "Every feature needs its stable original or commissioned identity.", layerId=layer_id, fid=feature.id())
                key = value_sha(identity)
                body = {"layerId": layer_id, "identity": identity, "attributes": attrs, "geometry": _geometry(feature)}
                encoded = json_bytes(body).decode("utf-8")
                try:
                    db.execute("INSERT INTO features VALUES(?,?,?,?)", (layer_id, key, encoded, value_sha(body)))
                except sqlite3.IntegrityError as exc:
                    raise QgisReceivingError("FIELD_IDENTITY_DUPLICATE", "Two native features share an identity.",
                                             layerId=layer_id, identity=identity) from exc
                count += 1
                if count % 1000 == 0:
                    _notify(progress, "field-features", layerId=layer_id, completedFeatures=count)
            counts[layer_id] = count
            schemas[layer_id] = {"fieldNames": names, "identityField": configured["identityField"],
                                 "crs": layer.crs().toWkt(), "wkbType": int(layer.wkbType())}
        value = {"counts": counts, "layers": schemas}
        db.execute("INSERT INTO metadata VALUES('snapshot',?)", (json_bytes(value).decode("utf-8"),))
    return value

def _snapshot_meta(path):
    with sqlite3.connect(Path(path).as_uri() + "?mode=ro", uri=True) as db:
        row = db.execute("SELECT body FROM metadata WHERE key='snapshot'").fetchone()
    require(row is not None, "FIELD_SNAPSHOT", "The native feature snapshot is incomplete.")
    return json.loads(row[0])

def _finish_edition(workspace, office, stage, config, project, *, lineage, progress=None):
    for name in ("features.sqlite", "field-edition.json"):
        path = office / name
        if path.exists():
            require(path.is_file() and not path.is_symlink(), "FIELD_NATIVE_MEMBER", "Use ordinary native field metadata.")
            path.unlink()
    q = _qgis()
    project.setFilePathStorage(q["Qgis"].FilePathType.Relative)
    project.setFileName(str(office / "project.qgz"))
    require(project.write(), "FIELD_PROJECT_SAVE", "The complete native office project could not be saved.")
    snapshot = _snapshot(project, config, office / "features.sqlite", progress=progress)
    project.clear()
    gc.collect()
    rows = ordinary_tree(office, progress=progress)
    manifest = {"schema": EDITION_SCHEMA, "configurationSha256": value_sha(config), "lineage": lineage,
                "native": native_versions(), "features": snapshot, "files": rows, "at": utc_now()}
    manifest_body = json_bytes(manifest)
    retain_bytes(office, "field-edition.json", manifest_body)
    manifest_row = {"path": "field-edition.json", "bytes": len(manifest_body),
                    "sha256": hashlib.sha256(manifest_body).hexdigest()}
    rows.append(manifest_row)
    prefix = _relative(stage, office) + "/"
    return {"root": prefix[:-1], "sha256": manifest_row["sha256"],
            "project": next({**x, "path": prefix + x["path"]} for x in rows if x["path"] == "project.qgz"),
            "manifest": {**manifest_row, "path": prefix + manifest_row["path"]},
            "files": [{**x, "path": prefix + x["path"]} for x in rows],
            "features": snapshot, "lineage": lineage}

def _edition(workspace, edition, progress=None):
    root = _path(workspace.root, edition["root"], is_dir=True)
    manifest_path = member(workspace.root, edition["manifest"]["path"])
    file_digest(manifest_path, expected=edition["manifest"], progress=progress)
    require(edition["sha256"] == edition["manifest"]["sha256"], "FIELD_EDITION_ID", "The office edition identity changed.")
    manifest, body = read_json(manifest_path)
    require(manifest.get("schema") == EDITION_SCHEMA, "FIELD_EDITION", "Use a retained native field edition.")
    rows = list(manifest["files"]) + [{"path": "field-edition.json", "bytes": len(body),
                                      "sha256": hashlib.sha256(body).hexdigest()}]
    verify_tree(root, rows, progress=progress)
    return root, manifest, rows

def _copy_edition(workspace, edition, target, progress=None):
    root, manifest, rows = _edition(workspace, edition, progress)
    copy_tree(root, target, rows, progress=progress)
    return manifest

def _new_field(name, kind):
    q = _qgis()
    types = getattr(q["QMetaType"], "Type", None)
    if types is not None:
        code = {"text": types.QString, "integer": types.LongLong, "real": types.Double,
                "date": types.QDate, "datetime": types.QDateTime, "boolean": types.Bool}[kind]
    else:
        types = q["QVariant"]
        code = {"text": types.String, "integer": types.LongLong, "real": types.Double,
                "date": types.Date, "datetime": types.DateTime, "boolean": types.Bool}[kind]
    return q["QgsField"](name, code)

def _apply_form(layer, row, project):
    q = _qgis()
    from libqfieldsync.layer import LayerSource, SyncAction
    changed = [f for f in row["fields"] if f.get("addType")]
    if changed:
        require(layer.startEditing(), "FIELD_SCHEMA_EDIT", "The derived native data could not enter schema editing.")
        for f in changed:
            require(layer.fields().indexFromName(f["name"]) < 0, "FIELD_SCHEMA_FIELD",
                    "A new field already exists in the original schema.", field=f["name"])
            require(layer.addAttribute(_new_field(f["name"], f["addType"])), "FIELD_SCHEMA_FIELD",
                    "The derived native field could not be created.", field=f["name"])
        require(layer.commitChanges(), "FIELD_SCHEMA_COMMIT", "The native field schema did not commit.",
                errors=layer.commitErrors())
    available = {f.name() for f in layer.fields()}
    require(row["identityField"] in available and set(row["editableFields"]) <= available and
            {f["name"] for f in row["fields"]} <= available,
            "FIELD_FORM_FIELDS", "Choose actual fields from this native layer.")
    identity_index = layer.fields().indexFromName(row["identityField"])
    added_identity = next((f for f in row["fields"] if f["name"] == row["identityField"] and f.get("addType")), None)
    if added_identity:
        require(added_identity["addType"] == "text", "FIELD_IDENTITY_TYPE", "Use text UUIDs for a newly commissioned identity.")
        require(layer.startEditing(), "FIELD_IDENTITY_EDIT", "The native identity field could not be initialized.")
        namespace = uuid.uuid5(uuid.NAMESPACE_URL, str(project.customVariables().get("starforge_field_source", "")) + "/" + row["layerId"])
        for feature in layer.getFeatures():
            require(layer.changeAttributeValue(feature.id(), identity_index, str(uuid.uuid5(namespace, str(feature.id())))),
                    "FIELD_IDENTITY_EDIT", "The native identity field could not be initialized.")
        require(layer.commitChanges(), "FIELD_IDENTITY_COMMIT", "The native identity field did not commit.")
    if row["allowAdd"]:
        field = layer.fields().at(identity_index)
        require(field.type() == _new_field("_type_probe", "text").type(), "FIELD_ADDED_IDENTITY",
                "Choose a text identity field with native UUID defaults before allowing new field records.")
        layer.setDefaultValueDefinition(identity_index, q["QgsDefaultValue"]("uuid()"))
    form = layer.editFormConfig()
    for index, field in enumerate(layer.fields()):
        form.setReadOnly(index, field.name() not in row["editableFields"])
    root = form.invisibleRootContainer()
    root.clear()
    groups = {}
    for field in row["fields"]:
        index = layer.fields().indexFromName(field["name"])
        layer.setFieldAlias(index, field["label"])
        widget = field["widget"]
        if widget in ("text", "multiline"):
            setup = q["QgsEditorWidgetSetup"]("TextEdit", {"IsMultiline": widget == "multiline", "UseHtml": False})
        elif widget == "choice":
            setup = q["QgsEditorWidgetSetup"]("ValueMap", {"map": [{v["label"]: v["value"]} for v in field["choices"]]})
        elif widget == "range":
            setup = q["QgsEditorWidgetSetup"]("Range", {"Min": field["min"], "Max": field["max"],
                                                       "Step": field["step"], "Style": "SpinBox"})
        elif widget == "date":
            setup = q["QgsEditorWidgetSetup"]("DateTime", {"calendar_popup": True, "field_format": "yyyy-MM-dd",
                                                          "display_format": "yyyy-MM-dd"})
        else:
            setup = q["QgsEditorWidgetSetup"]("ExternalResource", {"RelativeStorage": 1, "StorageMode": 0,
                "DocumentViewer": 1 if widget == "image" else 0, "DefaultRoot": ""})
        layer.setEditorWidgetSetup(index, setup)
        if field["required"]:
            layer.setFieldConstraint(index, q["QgsFieldConstraints"].ConstraintNotNull,
                                     q["QgsFieldConstraints"].ConstraintStrengthHard)
        group = groups.get(field["group"])
        if group is None:
            group = q["QgsAttributeEditorContainer"](field["group"], root)
            group.setIsGroupBox(False)
            root.addChildElement(group)
            groups[field["group"]] = group
        group.addChildElement(q["QgsAttributeEditorField"](field["name"], index, group))
    # Native source fields remain inspectable, even when they are read-only.
    configured = {f["name"] for f in row["fields"]}
    other = [f for f in layer.fields() if f.name() not in configured]
    if other:
        group = q["QgsAttributeEditorContainer"]("Source attributes", root)
        group.setIsGroupBox(False)
        root.addChildElement(group)
        for f in other:
            group.addChildElement(q["QgsAttributeEditorField"](f.name(), layer.fields().indexFromName(f.name()), group))
    form.setLayout(q["QgsEditFormConfig"].TabLayout)
    layer.setEditFormConfig(form)
    wrapper = LayerSource(layer, project)
    wrapper.action = SyncAction.OFFLINE
    wrapper.is_feature_addition_locked = not row["allowAdd"]
    wrapper.is_feature_deletion_locked = not row["allowDelete"]
    wrapper.is_geometry_editing_locked = not row["allowGeometry"]
    wrapper.is_attribute_editing_locked = not bool(row["editableFields"])
    for f in row["fields"]:
        if f["widget"] in ("attachment", "image"):
            suffix = "' || format_date(now(),'yyyyMMddhhmmsszzz') || '_{filename}'" if f["widget"] == "attachment" else "' || format_date(now(),'yyyyMMddhhmmsszzz') || '.{extension}'"
            wrapper.set_attachment_naming(f["name"], "'attachments/" + re.sub(r"[^A-Za-z0-9_-]", "_", row["layerId"]) + "_" + suffix)
    wrapper.apply()

def _copy_existing_attachments(workspace, layer, row, original_home, office, progress):
    fields = [f["name"] for f in row["fields"] if f["widget"] in ("attachment", "image")]
    if not fields:
        return []
    allowed = {member(workspace.root, r["path"]).resolve(): r for r in workspace.project_files()}
    changes, observations = [], []
    for feature in layer.getFeatures():
        for name in fields:
            value = _scalar(feature[name])
            if value in (None, ""):
                continue
            require(isinstance(value, str) and "://" not in value, "FIELD_ATTACHMENT_SOURCE",
                    "Retain the actual local attachment bytes before commissioning.", field=name)
            candidate = Path(value)
            if not candidate.is_absolute():
                candidate = Path(original_home) / candidate
            candidate = candidate.resolve()
            require(candidate in allowed, "FIELD_ATTACHMENT_SOURCE",
                    "This attachment is outside the retained original source package.", field=name, source=value)
            record = allowed[candidate]
            extension = candidate.suffix.lower()
            target = "attachments/" + record["sha256"] + extension
            retain_copy(candidate, office, target, record, progress)
            changes.append((feature.id(), layer.fields().indexFromName(name), target))
            observations.append({"layerId": row["layerId"], "originalFid": feature.id(), "field": name,
                                 "originalValue": value, "retained": target, "sha256": record["sha256"]})
    if changes:
        require(layer.startEditing(), "FIELD_ATTACHMENT_EDIT", "The derived attachment references could not be prepared.")
        for fid, index, value in changes:
            require(layer.changeAttributeValue(fid, index, value), "FIELD_ATTACHMENT_EDIT", "An attachment reference could not be retained.")
        require(layer.commitChanges(), "FIELD_ATTACHMENT_COMMIT", "The native attachment references did not commit.")
    return observations

def commission_native(workspace, original, config, stage, progress=None):
    q = _qgis()
    from .qgis_project import reopen_project
    from libqfieldsync.layer import LayerSource, SyncAction
    from libqfieldsync.project import ProjectConfig
    verified = reopen_project(workspace, original["id"])
    del verified
    project = _loaded(member(workspace.root, original["file"]["path"]))
    original_home = project.homePath()
    selected = {r["layerId"] for r in config["layers"]} | set(config["referenceLayerIds"])
    native_layers = _binding(project)
    require(selected <= set(native_layers), "FIELD_LAYER_BINDING", "The saved project lost an original layer binding.")
    office = stage / "office"
    (office / "data").mkdir(mode=0o700, parents=True)
    (office / "styles").mkdir(mode=0o700)
    (office / "attachments").mkdir(mode=0o700)
    project.setCustomVariables({**project.customVariables(), "starforge_field_source": original["file"]["sha256"]})
    lineage = {"sourceProjectId": original["id"], "sourceProjectSha256": original["file"]["sha256"], "layers": [],
               "sourceAttachments": []}
    selected_native = {native_layers[x].id() for x in selected}
    for native_id in list(project.mapLayers()):
        if native_id not in selected_native:
            project.removeMapLayer(native_id)
    for index, row in enumerate(config["layers"], 1):
        layer = native_layers[row["layerId"]]
        require(isinstance(layer, q["QgsVectorLayer"]), "FIELD_VECTOR_REQUIRED", "Choose a native vector layer or related table.")
        original_fields = [f.name() for f in layer.fields()]
        original_native_source = layer.source()
        original_subset = layer.subsetString()
        original_count = layer.featureCount()
        name = "layer_" + hashlib.sha256(row["layerId"].encode()).hexdigest()[:20]
        target = office / "data" / (name + ".gpkg")
        style = office / "styles" / (name + ".qml")
        message, ok = layer.saveNamedStyle(str(style))
        require(ok, "FIELD_STYLE_SAVE", "The original native form/style could not be retained.", detail=message)
        fid_field = "_sf_source_fid"
        while layer.fields().indexFromName(fid_field) >= 0:
            fid_field += "_"
        require(layer.addExpressionField("$id", _new_field(fid_field, "integer")) >= 0,
                "FIELD_SOURCE_IDENTITY", "The original provider feature IDs could not be retained.")
        options = q["QgsVectorFileWriter"].SaveVectorOptions()
        options.driverName = "GPKG"
        options.layerName = name
        options.fileEncoding = "UTF-8"
        options.actionOnExistingFile = q["QgsVectorFileWriter"].CreateOrOverwriteFile
        outcome = q["QgsVectorFileWriter"].writeAsVectorFormatV3(layer, str(target), project.transformContext(), options)
        require(outcome[0] == q["QgsVectorFileWriter"].NoError, "FIELD_NATIVE_COPY",
                "The original layer could not be copied to editable native data.", outcome=str(outcome))
        layer.setDataSource(str(target) + "|layername=" + name, layer.name(), "ogr")
        require(layer.isValid() and layer.featureCount() == original_count, "FIELD_NATIVE_COPY",
                "The derived native layer did not preserve the selected original features.")
        message, ok = layer.loadNamedStyle(str(style))
        require(ok, "FIELD_STYLE_OPEN", "The retained native form/style could not be reapplied.", detail=message)
        layer.setSubsetString("")
        _apply_form(layer, row, project)
        lineage["sourceAttachments"].extend(_copy_existing_attachments(workspace, layer, row, original_home, office, progress))
        lineage["layers"].append({"layerId": row["layerId"], "nativeLayerId": layer.id(),
                                 "sourceId": str(layer.customProperty("starforge/sourceId", "")),
                                 "originalNativeSource": original_native_source, "originalSubset": original_subset,
                                 "originalFields": original_fields, "originalFeatureCount": original_count,
                                 "originalFeatureIdField": fid_field,
                                 "identityField": row["identityField"], "workingSource": "data/" + target.name,
                                 "workingLayer": name})
        _notify(progress, "field-commission", completedLayers=index, totalLayers=len(config["layers"]))
    for layer_id in config["referenceLayerIds"]:
        layer = native_layers[layer_id]
        _, _, path = _source(layer)
        require(path.is_relative_to(workspace.root), "FIELD_REFERENCE_SOURCE", "Use an original retained reference layer.")
        wrapper = LayerSource(layer, project)
        wrapper.action = SyncAction.COPY
        wrapper.apply()
        if isinstance(layer, q["QgsVectorLayer"]):
            layer.setReadOnly(True)
    for relation_id in list(project.relationManager().relations()):
        project.relationManager().removeRelation(relation_id)
    for relation in config["relations"]:
        require(relation["parentLayerId"] in native_layers and relation["childLayerId"] in native_layers and
                relation["parentLayerId"] in selected and relation["childLayerId"] in selected,
                "FIELD_RELATION_LAYER", "Both relation layers must belong to this field project.")
        parent, child = native_layers[relation["parentLayerId"]], native_layers[relation["childLayerId"]]
        r = q["QgsRelation"]()
        r.setId(relation["id"])
        r.setName(relation["name"])
        r.setStrength(q["Qgis"].RelationshipStrength.Composition if relation["strength"] == "composition"
                      else q["Qgis"].RelationshipStrength.Association)
        r.setReferencedLayer(parent.id())
        r.setReferencingLayer(child.id())
        for pair in relation["fieldPairs"]:
            r.addFieldPair(pair["childField"], pair["parentField"])
        require(r.isValid(), "FIELD_RELATION", "The selected native parent/child relation is invalid.", relation=relation["id"])
        project.relationManager().addRelation(r)
        form = parent.editFormConfig()
        root = form.invisibleRootContainer()
        group = q["QgsAttributeEditorContainer"](relation["name"], root)
        group.setIsGroupBox(False)
        group.addChildElement(q["QgsAttributeEditorRelation"](r, group))
        root.addChildElement(group)
        parent.setEditFormConfig(form)
    pc = ProjectConfig(project)
    pc.create_base_map = False
    pc.offline_copy_only_aoi = False
    pc.feature_form_wizard_mode_enabled = True
    pc.initial_map_mode = "Browse"
    pc.imported_files_checksums = []
    project.setTitle(config["title"])
    retain_bytes(office, "commissioning.json", json_bytes(config))
    retain_bytes(office, "source-lineage.json", json_bytes(lineage))
    edition = _finish_edition(workspace, office, stage, config, project, lineage=lineage, progress=progress)
    project.clear()
    gc.collect()
    return {"edition": edition, "native": native_versions()}

def export_native(workspace, campaign, profile, stage, request_id, progress=None):
    q = _qgis()
    from libqfieldsync.offline_converter import OfflineConverter
    from libqfieldsync.offliners import QgisCoreOffliner
    from libqfieldsync.project import ProjectConfig
    office, device = stage / "office", stage / "device"
    manifest = _copy_edition(workspace, campaign["currentEdition"], office, progress)
    project = _loaded(office / "project.qgz")
    pc = ProjectConfig(project)
    pc.create_base_map = False
    pc.offline_copy_only_aoi = False
    project.setTitle(campaign["title"])
    require(project.write(), "FIELD_EXPORT_SOURCE", "The derived office project could not be saved before export.")
    from libqfieldsync.layer import LayerSource, SyncAction
    native_layers = _binding(project)
    for layer_id, layer in native_layers.items():
        wrapper = LayerSource(layer, project)
        wrapper.action = SyncAction.OFFLINE if any(r["layerId"] == layer_id for r in campaign["configuration"]["layers"]) else SyncAction.COPY
        wrapper.apply()
    before_map = {r["layerId"]: {"nativeLayerId": native_layers[r["layerId"]].id(),
                    "sourceId": str(native_layers[r["layerId"]].customProperty("starforge/sourceId", ""))}
                  for r in campaign["configuration"]["layers"]}
    device.mkdir(mode=0o700)
    # QFieldSync owns both native export schema and offline change logging.
    offline = q["QgsOfflineEditing"]()
    warnings = []
    offline.warning.connect(lambda title, message: warnings.append({"title": title, "message": message}))
    # No AOI clipping is enabled. The WKT still uses the actual selected layer extent.
    extent = None
    for layer in project.mapLayers().values():
        box = layer.extent()
        if not box.isEmpty() and layer.crs() != project.crs():
            from qgis.core import QgsCoordinateTransform
            box = QgsCoordinateTransform(layer.crs(), project.crs(), project.transformContext()).transformBoundingBox(box)
        if box.isEmpty():
            continue
        if extent is None:
            from qgis.core import QgsRectangle
            extent = QgsRectangle(box)
        else:
            extent.combineExtentWith(box)
    require(extent is not None and not extent.isEmpty(), "FIELD_EXTENT",
            "Include an actual spatial layer or reference extent for this field project.")
    converter = OfflineConverter(project, str(device / "field.qgz"), extent.asWktPolygon(),
                                 project.crs().authid() or project.crs().toWkt(), list(ATTACHMENT_DIRS),
                                 QgisCoreOffliner(offline_editing=offline), create_basemap=False,
                                 dirs_to_copy={"attachments": True}, export_title=campaign["title"])
    converter.warning.connect(lambda title, message: warnings.append({"title": title, "message": message}))
    converter.task_progress_updated.connect(lambda done, total: _notify(progress, "field-native-export", completed=done, total=total))
    converter.convert(reload_original_project=False)
    require(not warnings, "FIELD_EXPORT_WARNING", "The native QFieldSync export reported a problem.", warnings=warnings)
    project = _loaded(device / "field.qgz")
    offline_layers, mutable = [], set()
    for layer in project.mapLayers().values():
        if not isinstance(layer, q["QgsVectorLayer"]) or not bool(layer.customProperty("isOfflineEditable", False)):
            continue
        original_native = str(layer.customProperty("remoteLayerId", ""))
        found = next((lid for lid, value in before_map.items() if value["nativeLayerId"] == original_native), None)
        require(found is not None, "FIELD_OFFLINE_BINDING", "The native exporter created an unbound editable layer.")
        provider, _, data = _source(layer)
        relative = _relative(device, data)
        require(relative.endswith(".gpkg"), "FIELD_OFFLINE_DATABASE", "Use the original QGIS GeoPackage offline container.")
        mutable.add(relative)
        offline_layers.append({"layerId": found, "nativeLayerId": layer.id(), "originalNativeLayerId": original_native,
                               "sourceId": before_map[found]["sourceId"], "provider": provider, "path": relative})
    require(len(offline_layers) == len(campaign["configuration"]["layers"]) and len(mutable) == 1,
            "FIELD_OFFLINE_EXPORT", "The original native export must contain every selected editable layer in one logging GeoPackage.")
    binding = {"schema": DEVICE_SCHEMA, "workspaceId": workspace.read()["id"], "campaignId": campaign["id"],
               "roundId": "round-" + request_id, "profileId": profile["id"],
               "baseEditionSha256": campaign["currentEdition"]["sha256"], "configurationSha256": value_sha(campaign["configuration"]),
               "offlineLayers": offline_layers, "mutableFiles": sorted(mutable), "project": "field.qgz",
               "fieldNames": {k: v["fieldNames"] for k, v in manifest["features"]["layers"].items()},
               "native": native_versions()}
    project.clear()
    gc.collect()
    # The immutable original office edition is already retained by the campaign.
    # This export's temporary office copy is no longer a synchronization target.
    shutil.rmtree(office)
    retain_bytes(device, "field-export.json", json_bytes(binding))
    retain_bytes(device, "FIELD_INSTRUCTIONS.txt",
                 (campaign["configuration"]["instructions"] + "\n\n" + profile["operatorInstructions"] + "\n\n" +
                  campaign["configuration"]["attachmentInstructions"] +
                  "\n\nClose QField before returning this complete folder. Office synchronization accepts this export once. "
                  "Use a fresh office export for the next field round.\n").encode("utf-8"))
    package_files = ordinary_tree(device, progress=progress)
    return {"packageRoot": "device", "packageFiles": package_files, "exportProject": "field.qgz",
            "binding": binding, "native": native_versions()}

def _trusted_return_project(workspace, round_row, device_root, target, progress=None):
    expected = round_row["packageFiles"]
    original = _path(workspace.root, round_row["packageRoot"], is_dir=True)
    verify_tree(original, expected, progress=progress)
    copy_tree(original, target, expected, progress=progress)
    for rel in round_row["binding"]["mutableFiles"]:
        source = member(device_root, rel)
        target_file = member(target, rel)
        # This is a newly owned analysis/synchronization copy, never the
        # retained export, returned device folder or office edition.
        target_file.unlink()
        retain_copy(source, target, rel, file_digest(source), progress)
    project = _loaded(target / round_row["exportProject"])
    q = _qgis()
    layers = {}
    for b in round_row["binding"]["offlineLayers"]:
        layer = project.mapLayer(b["nativeLayerId"])
        require(isinstance(layer, q["QgsVectorLayer"]) and layer.isValid(), "FIELD_RETURN_LAYER",
                "A returned native offline layer could not be opened.", layerId=b["layerId"])
        provider, _, path = _source(layer)
        require(provider == b["provider"] and path == (target / b["path"]).resolve(),
                "FIELD_RETURN_SOURCE", "The native returned layer is outside its retained exported data.")
        layers[b["layerId"]] = layer
    database = round_row["binding"]["mutableFiles"][0]
    project.writeEntry("OfflineEditingPlugin", "/OfflineDbPath", project.writePath(str(target / database)))
    return project, layers

def _review(base, incoming, config, output, device_root, progress=None):
    configured = {r["layerId"]: r for r in config["layers"]}
    counts = {"added": 0, "changed": 0, "deleted": 0, "issues": 0, "attachments": 0}
    per_layer = {r["layerId"]: {"added": 0, "changed": 0, "deleted": 0, "issues": 0} for r in config["layers"]}
    attachments = {}
    attachment_observations = set()
    counts["attachmentChanges"] = 0
    with sqlite3.connect(output) as result, sqlite3.connect(Path(base).as_uri() + "?mode=ro", uri=True) as source:
        result.execute("PRAGMA journal_mode=DELETE")
        result.execute("CREATE TABLE changes(sequence INTEGER PRIMARY KEY,layer_id TEXT NOT NULL,kind TEXT NOT NULL,body TEXT NOT NULL)")
        result.execute("CREATE INDEX changes_filter ON changes(layer_id,kind,sequence)")
        result.execute("CREATE TABLE metadata(key TEXT PRIMARY KEY,body TEXT NOT NULL)")
        source.execute("ATTACH DATABASE ? AS incoming", (str(incoming),))
        sequence = 0
        def emit(row):
            nonlocal sequence
            sequence += 1
            result.execute("INSERT INTO changes VALUES(?,?,?,?)", (sequence, row["layerId"], row["kind"], json_bytes(row).decode()))
        query = """SELECT b.layer_id,b.feature_key,b.body,a.body FROM features b
                   LEFT JOIN incoming.features a ON a.layer_id=b.layer_id AND a.feature_key=b.feature_key
                   WHERE a.sha256 IS NULL OR a.sha256<>b.sha256
                   UNION ALL SELECT a.layer_id,a.feature_key,NULL,a.body FROM incoming.features a
                   LEFT JOIN features b ON a.layer_id=b.layer_id AND a.feature_key=b.feature_key WHERE b.feature_key IS NULL"""
        for layer_id, key, before, after in source.execute(query):
            b, a = json.loads(before) if before else None, json.loads(after) if after else None
            row_config = configured[layer_id]
            kind = "added" if b is None else "deleted" if a is None else "changed"
            changes = []
            if b and a:
                for name in sorted(set(b["attributes"]) | set(a["attributes"])):
                    if b["attributes"].get(name) != a["attributes"].get(name):
                        changes.append({"field": name, "before": b["attributes"].get(name), "after": a["attributes"].get(name)})
            problems = []
            if kind == "added" and not row_config["allowAdd"]:
                problems.append("New records are not enabled in this commissioned layer.")
            if kind == "deleted" and not row_config["allowDelete"]:
                problems.append("Deletion is not enabled in this commissioned layer.")
            if any(c["field"] not in row_config["editableFields"] for c in changes):
                problems.append("A retained source or read-only field was changed.")
            if b and a and b["geometry"] != a["geometry"] and not row_config["allowGeometry"]:
                problems.append("Geometry editing is not enabled in this commissioned layer.")
            if a:
                for f in row_config["fields"]:
                    v = a["attributes"].get(f["name"])
                    if f["required"] and v in (None, ""):
                        problems.append("Required field is empty: " + f["name"])
                    if v not in (None, "") and f["widget"] == "choice" and value_sha(v) not in {value_sha(x["value"]) for x in f["choices"]}:
                        problems.append("Unlisted choice value: " + f["name"])
                    if v not in (None, "") and f["widget"] == "range" and (type(v) not in (int, float) or not f["min"] <= v <= f["max"]):
                        problems.append("Value is outside the configured range: " + f["name"])
            row = {"layerId": layer_id, "key": key, "identity": (a or b)["identity"], "kind": kind,
                   "fields": changes, "before": b, "after": a, "issues": problems}
            counts[kind] += 1
            per_layer[layer_id][kind] += 1
            counts["issues"] += len(problems)
            per_layer[layer_id]["issues"] += len(problems)
            emit(row)
        for layer_id, body in source.execute("SELECT layer_id,body FROM incoming.features"):
            row = json.loads(body)
            for f in configured[layer_id]["fields"]:
                if f["widget"] not in ("attachment", "image"):
                    continue
                v = row["attributes"].get(f["name"])
                if v in (None, ""):
                    continue
                error = None
                if not isinstance(v, str) or "\\" in v or not v.startswith("attachments/") or any(x in ("", ".", "..") for x in v.split("/")):
                    error = "The attachment must be a relative file inside attachments/."
                else:
                    try:
                        path = member(device_root, v)
                        measured = {"path": v, **file_digest(path)}
                        attachments[v] = measured
                        observation_key = (layer_id, f["name"], v)
                        old_path = member(Path(base).parent, v, existing=False)
                        old = {"path": v, **file_digest(old_path)} if old_path.is_file() else None
                        if observation_key not in attachment_observations and (old is None or old["sha256"] != measured["sha256"]):
                            attachment_observations.add(observation_key)
                            issues = [] if f["name"] in configured[layer_id]["editableFields"] else ["A read-only attachment was added or replaced."]
                            emit({"layerId": layer_id, "kind": "attachment", "identity": row["identity"],
                                  "field": f["name"], "attachment": v, "beforeFile": old, "afterFile": measured, "issues": issues})
                            counts["attachmentChanges"] += 1
                            counts["issues"] += len(issues)
                            per_layer[layer_id]["issues"] += len(issues)
                    except QgisReceivingError as exc:
                        error = str(exc)
                if error:
                    emit({"layerId": layer_id, "kind": "issue", "identity": row["identity"],
                          "field": f["name"], "attachment": v, "issues": [error]})
                    counts["issues"] += 1
                    per_layer[layer_id]["issues"] += 1
        counts["attachments"] = len(attachments)
        summary = {**counts, "layers": per_layer}
        result.execute("INSERT INTO metadata VALUES('summary',?)", (json_bytes(summary).decode(),))
        result.execute("INSERT INTO metadata VALUES('attachments',?)", (json_bytes([attachments[k] for k in sorted(attachments)]).decode(),))
    _notify(progress, "field-review-complete", **counts)
    return summary, list(attachments.values())

def receive_native(workspace, campaign, round_row, source, source_files, stage, progress=None):
    returned = stage / "device-return"
    copy_tree(source, returned, source_files, progress=progress)
    incoming = {r["path"]: r for r in source_files}
    mutable = set(round_row["binding"]["mutableFiles"])
    immutable_issues = []
    for expected in round_row["packageFiles"]:
        actual = incoming.get(expected["path"])
        if actual is None:
            immutable_issues.append("Missing exported member: " + expected["path"])
        elif expected["path"] not in mutable | {round_row["exportProject"]} and actual["sha256"] != expected["sha256"]:
            # Existing attachments may have been replaced by a real field action;
            # they remain reviewable and are retained by the complete return.
            if not expected["path"].startswith("attachments/"):
                immutable_issues.append("Changed reference or export binding: " + expected["path"])
    require(not any(name not in incoming for name in mutable), "FIELD_RETURN_DATABASE",
            "Return the original native offline database with the complete project folder.")
    binding, _ = read_json(returned / "field-export.json")
    require(binding == round_row["binding"], "FIELD_EXPORT_BINDING",
            "This returned folder belongs to a different field export.")
    root, base_manifest, _ = _edition(workspace, round_row["baseEdition"], progress)
    analysis = stage / "inspection"
    project, layers = _trusted_return_project(workspace, round_row, returned, analysis, progress)
    after = stage / "returned-features.sqlite"
    _snapshot(project, campaign["configuration"], after, layer_map=layers, progress=progress,
              field_names=round_row["binding"]["fieldNames"])
    project.clear()
    gc.collect()
    shutil.rmtree(analysis)
    review = stage / "review.sqlite"
    summary, attachments = _review(root / "features.sqlite", after, campaign["configuration"], review, returned, progress)
    if immutable_issues:
        with sqlite3.connect(review) as db:
            next_id = db.execute("SELECT coalesce(max(sequence),0)+1 FROM changes").fetchone()[0]
            for i, issue in enumerate(immutable_issues):
                db.execute("INSERT INTO changes VALUES(?,?,?,?)", (next_id + i, "", "issue",
                    json_bytes({"layerId": "", "kind": "issue", "issues": [issue]}).decode()))
            summary["issues"] += len(immutable_issues)
            db.execute("UPDATE metadata SET body=? WHERE key='summary'", (json_bytes(summary).decode(),))
    return {"deviceRoot": "device-return", "review": {"path": "review.sqlite", **file_digest(review)},
            "summary": summary, "ready": summary["issues"] == 0, "binding": round_row["binding"],
            "attachments": attachments, "sourceFilesSha256": value_sha(source_files), "native": native_versions()}

def _same_features(expected, actual):
    with sqlite3.connect(Path(expected).as_uri() + "?mode=ro", uri=True) as db:
        db.execute("ATTACH DATABASE ? AS actual", (str(actual),))
        changed = db.execute("""SELECT count(*) FROM features e LEFT JOIN actual.features a
                  ON e.layer_id=a.layer_id AND e.feature_key=a.feature_key WHERE a.sha256 IS NULL OR a.sha256<>e.sha256""").fetchone()[0]
        added = db.execute("""SELECT count(*) FROM actual.features a LEFT JOIN features e
                  ON e.layer_id=a.layer_id AND e.feature_key=a.feature_key WHERE e.feature_key IS NULL""").fetchone()[0]
    require(changed == 0 and added == 0, "FIELD_NATIVE_SYNC_DIFFERENCE",
            "Native synchronization did not reproduce the reviewed field changes. The retained office edition is unchanged.",
            differentOrMissing=changed, unexpected=added)

def accept_native(workspace, campaign, round_row, returned, stage, progress=None):
    q = _qgis()
    from libqfieldsync.project import ProjectConfig
    from libqfieldsync.utils.file_utils import import_file_checksum
    bundle_root = _path(workspace.root, returned["bundleRoot"], is_dir=True)
    bundle_value, _ = read_bundle(bundle_root, progress=progress)
    require(bundle_value["metadata"]["review"]["sha256"] == returned["review"]["sha256"],
            "FIELD_REVIEW_CHANGED", "The retained return no longer matches its reviewed native result.")
    device_root = _path(workspace.root, returned["deviceRoot"], is_dir=True)
    office = stage / "office"
    base_manifest = _copy_edition(workspace, round_row["baseEdition"], office, progress)
    project = _loaded(office / "project.qgz")
    remote = {}
    for layer_id, layer in _binding(project).items():
        if any(x["layerId"] == layer_id for x in campaign["configuration"]["layers"]):
            provider, _, path = _source(layer)
            require(provider == "ogr" and path.is_relative_to(office.resolve()), "FIELD_SYNC_DESTINATION",
                    "Native field writes must target this operation's new local office copy.")
            remote[layer_id] = layer.source()
    project, layers = _trusted_return_project(workspace, round_row, device_root, stage / "synchronize", progress)
    for layer in project.mapLayers().values():
        if isinstance(layer, q["QgsVectorLayer"]):
            layer.setCustomProperty("isOfflineEditable", False)
    for layer_id, layer in layers.items():
        require(layer_id in remote, "FIELD_SYNC_BINDING", "The original office layer is missing.")
        layer.setCustomProperty("isOfflineEditable", True)
        layer.setCustomProperty("remoteProvider", "ogr")
        layer.setCustomProperty("remoteSource", remote[layer_id])
    offline = q["QgsOfflineEditing"]()
    warnings, stopped = [], []
    offline.warning.connect(lambda title, message: warnings.append({"title": title, "message": message}))
    offline.progressStopped.connect(lambda: stopped.append(True))
    offline.progressUpdated.connect(lambda current: _notify(progress, "field-native-synchronize", completed=current))
    require(offline.isOfflineProject(), "FIELD_OFFLINE_PROJECT", "This is not the original native offline export.")
    # No exception fallback: a retry creates another pristine owned stage.
    # The original native engine is called ONCE in this staged attempt.
    offline.synchronize(True)
    require(stopped and not warnings and not offline.isOfflineProject(), "FIELD_NATIVE_SYNC",
            "The original native synchronization did not complete cleanly.", warnings=warnings)
    project.clear()
    gc.collect()
    project = _loaded(office / "project.qgz")
    metadata = bundle_value["metadata"]
    for attachment in metadata["attachments"]:
        path = member(office, attachment["path"], existing=False)
        if path.exists() and file_digest(path)["sha256"] != attachment["sha256"]:
            path.unlink()
        retain_copy(member(device_root, attachment["path"]), office, attachment["path"], attachment, progress)
    checksums = ProjectConfig(project).imported_files_checksums or []
    imported_checksum = import_file_checksum(str(stage / "synchronize"))
    if imported_checksum and imported_checksum not in checksums:
        checksums.append(imported_checksum)
    ProjectConfig(project).imported_files_checksums = checksums
    lineage = {**base_manifest["lineage"], "previousEditionSha256": round_row["baseEditionSha256"],
               "fieldRoundId": round_row["id"], "returnId": returned["id"],
               "returnedFilesSha256": returned["sourceFilesSha256"], "reviewSha256": returned["review"]["sha256"]}
    edition = _finish_edition(workspace, office, stage, campaign["configuration"], project, lineage=lineage, progress=progress)
    project.clear()
    gc.collect()
    _same_features(bundle_root / "returned-features.sqlite", office / "features.sqlite")
    shutil.rmtree(stage / "synchronize")
    result = {"engine": "QgsOfflineEditing.synchronize", "transactionRequested": True,
              "native": native_versions(), "exportRoundId": round_row["id"], "reviewedReturnId": returned["id"],
              "nativeCallsInThisStage": 1, "progressStopped": True, "warnings": warnings,
              "baseEditionSha256": round_row["baseEditionSha256"], "acceptedEditionSha256": edition["sha256"],
              "allReviewedFeaturesMatched": True, "at": utc_now()}
    return {"edition": edition, "synchronization": result}

def reopen_field_project(workspace, project_id, *, progress=None):
    state = workspace.read()
    record = next((x for x in state["projects"] if x["id"] == project_id), None)
    require(record is not None and record.get("kind") == "field", "FIELD_PROJECT",
            "Select an accepted native field project.")
    edition = record["field"]["edition"]
    require(record["file"] == edition["project"], "FIELD_PROJECT_IDENTITY", "The field project descriptor changed.")
    root, manifest, _ = _edition(workspace, edition, progress)
    require(value_sha(record["field"]["configuration"]) == manifest["configurationSha256"],
            "FIELD_CONFIGURATION_CHANGED", "The retained field configuration changed.")
    # Return a separate native project, matching the original reopen_project ABI.
    q = _qgis()
    project = q["QgsProject"]()
    require(project.read(str(root / "project.qgz")), "FIELD_PROJECT_OPEN", "The accepted native field project did not reopen.")
    native_layers = _binding(project)
    for row in record["field"]["configuration"]["layers"]:
        layer = native_layers.get(row["layerId"])
        require(isinstance(layer, q["QgsVectorLayer"]) and layer.isValid(), "FIELD_PROJECT_LAYER",
                "An accepted editable layer did not reopen.", layerId=row["layerId"])
        provider, _, path = _source(layer)
        require(provider == "ogr" and path.is_relative_to(root.resolve()), "FIELD_PROJECT_SOURCE",
                "An accepted field layer points outside its retained native edition.")
    for layer_id in record["field"]["configuration"]["referenceLayerIds"]:
        layer = native_layers.get(layer_id)
        require(layer is not None and layer.isValid(), "FIELD_REFERENCE_LAYER", "An accepted reference layer did not reopen.")
        _, _, path = _source(layer)
        require(path.is_relative_to(workspace.root.resolve()), "FIELD_REFERENCE_SOURCE",
                "An accepted reference layer points outside the complete retained workspace.")
    return project, {"projectId": project_id, "workspaceId": state["id"], "revision": state["revision"],
                     "fieldEditionSha256": edition["sha256"], "layers": len(native_layers),
                     "path": str(root / "project.qgz"), "native": native_versions(), "valid": True}

def inspect_field_project(workspace, project_id, progress=None):
    q = _qgis()
    from .qgis_project import reopen_project
    project, readback = reopen_project(workspace, project_id, progress=progress)
    result = {"projectId": project_id, "title": project.title(), "native": native_versions(), "layers": [], "relations": []}
    for original_id, layer in _binding(project).items():
        row = {"layerId": original_id, "nativeLayerId": layer.id(), "label": layer.name(),
               "sourceId": str(layer.customProperty("starforge/sourceId", "")),
               "kind": "vector" if isinstance(layer, q["QgsVectorLayer"]) else "raster"}
        if isinstance(layer, q["QgsVectorLayer"]):
            row.update({"featureCount": layer.featureCount(), "fields": [{"name": f.name(), "type": f.typeName()}
                       for f in layer.fields()], "geometry": str(layer.wkbType()),
                       "sourceSubset": layer.subsetString()})
        result["layers"].append(row)
    ids = {layer.id(): original_id for original_id, layer in _binding(project).items()}
    for r in project.relationManager().relations().values():
        if r.referencedLayerId() in ids and r.referencingLayerId() in ids:
            result["relations"].append({"id": r.id(), "name": r.name(),
                "strength": "composition" if r.strength() == q["Qgis"].RelationshipStrength.Composition else "association",
                "parentLayerId": ids[r.referencedLayerId()],
                "childLayerId": ids[r.referencingLayerId()], "fieldPairs": [
                    {"parentField": parent, "childField": child} for child, parent in r.fieldPairs().items()]})
    result["readback"] = readback
    project.clear()
    return result
