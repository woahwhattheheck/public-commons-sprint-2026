# SPDX-License-Identifier: MIT
"""Receive an original vector-export.json in the maintained QGIS workspace.

The producer manifest, source capture, row identities, field codecs, native
layers and companion files stay byte-for-byte in their original file closure.
The workspace's three-part asset keys carry original native IDs; these files
are not represented as STAC Items or Collections.
"""
from __future__ import annotations

import copy
import json
import math
from decimal import Decimal
from pathlib import PurePosixPath

from .model import (HASH, asset_key, descriptor, directory,
                    file_digest, json_bytes, member, read_json, require,
                    scene_key, sha_bytes, value_sha)

VECTOR_SCHEMA = "starforge.vector-export.v1"
CAPTURE_SCHEMA = "starforge.vector-capture.v1"
VECTOR_MANIFEST_NAME = "vector-export.json"
SOURCE_FEATURES = "native/source-features.ndjson"
NATIVE_BINDINGS = "native/native-bindings.ndjson"
DRIVERS = {"GPKG": "application/geopackage+sqlite3",
           "ESRI Shapefile": "application/x-esri-shapefile"}
SHAPEFILE_INPUTS = frozenset((".shp", ".shx", ".dbf", ".prj", ".cpg", ".qix",
                             ".sbn", ".sbx", ".fix", ".ain", ".aih", ".ixs", ".mxs"))


def _text(value, label):
    require(isinstance(value, str) and bool(value) and "\x00" not in value,
            "VECTOR_IDENTITY_REQUIRED", "Retain the original native " + label + ".")
    return value


def _hash(value, label):
    require(isinstance(value, str) and HASH.fullmatch(value), "VECTOR_SOURCE_HASH",
            "Retain the original " + label + " SHA-256.")
    return value


def _count(value, label):
    require(type(value) is int and value >= 0, "VECTOR_NATIVE_COUNT",
            "Retain the actual native " + label + ".")
    return value


def _unique_object(pairs):
    result = {}
    for key, value in pairs:
        require(key not in result, "VECTOR_DUPLICATE_JSON_KEY",
                "Keep one original value for each native metadata key.", key=key)
        result[key] = value
    return result


def _decimal_json(value):
    """Serialize a finite JSON number without applying the Decimal context."""
    require(value.is_finite(), "VECTOR_NONFINITE_JSON", "Retain finite native metadata numbers.")
    # Preserve earlier native-float spellings only when this conversion is exact.
    try:
        native = float(value)
        if math.isfinite(native) and Decimal(str(native)) == value:
            return json.dumps(native, allow_nan=False)
    except (OverflowError, ValueError):
        pass
    sign, digits, exponent = value.as_tuple()
    digits = list(digits)
    while len(digits) > 1 and digits[-1] == 0:
        digits.pop()
        exponent += 1
    coefficient = "".join(str(digit) for digit in digits)
    prefix = "-" if sign else ""
    if not any(digits):
        return prefix + "0.0"
    adjusted = len(digits) + exponent - 1
    if -6 <= adjusted <= 20:
        point = len(digits) + exponent
        if point <= 0:
            text = "0." + "0" * -point + coefficient
        elif point >= len(digits):
            text = coefficient + "0" * (point - len(digits)) + ".0"
        else:
            text = coefficient[:point] + "." + coefficient[point:]
        return prefix + text
    mantissa = coefficient[0] + ("." + coefficient[1:] if len(coefficient) > 1 else "")
    return prefix + mantissa + "e" + ("+" if adjusted >= 0 else "") + str(adjusted)

def _exact_json(value):
    if value is None:
        return "null"
    if type(value) is bool:
        return "true" if value else "false"
    if type(value) is int:
        return str(value)
    if isinstance(value, Decimal):
        return _decimal_json(value)
    if type(value) is float:
        require(math.isfinite(value), "VECTOR_NONFINITE_JSON", "Retain finite native metadata numbers.")
        return json.dumps(value, allow_nan=False)
    if type(value) is str:
        return json.dumps(value, ensure_ascii=False)
    if isinstance(value, (list, tuple)):
        return "[" + ",".join(_exact_json(item) for item in value) + "]"
    if isinstance(value, dict):
        require(all(isinstance(key, str) for key in value), "VECTOR_JSON_KEY_INVALID", "Retain native JSON object keys.")
        return "{" + ",".join(_exact_json(key) + ":" + _exact_json(value[key])
                              for key in sorted(value)) + "}"
    raise TypeError(type(value).__name__)

def _invalid_number(value):
    require(False, "VECTOR_NONFINITE_JSON", "Retain finite native metadata numbers.", value=value)


def _model_number(text):
    """Keep the shared QGIS model JSON-safe without rounding precise metadata."""
    value = Decimal(text)
    require(value.is_finite(), "VECTOR_NONFINITE_JSON", "Retain finite native metadata numbers.")
    try:
        native = float(value)
        if math.isfinite(native) and Decimal(str(native)) == value:
            return native
    except (OverflowError, ValueError):
        pass
    return {"$vector_number": _decimal_json(value)}


def _exact_document(body):
    return json.loads(body.decode("utf-8"), object_pairs_hook=_unique_object,
                      parse_float=Decimal, parse_constant=_invalid_number)


def _exact_value_sha(value):
    return sha_bytes((_exact_json(value) + "\n").encode("utf-8"))


def _original_json(path):
    _, body = read_json(path)
    return json.loads(body.decode("utf-8"), object_pairs_hook=_unique_object,
                      parse_float=_model_number, parse_constant=_invalid_number), body


def _same_descriptor(left, right):
    return all(left.get(key) == right.get(key) for key in ("path", "bytes", "sha256"))


class VectorReceivingSource:
    """An original vector export implementing the QGIS source-reader contract."""

    sourceKind = "vector"
    manifest_name = VECTOR_MANIFEST_NAME

    def __init__(self, root, expected_manifest_sha256=None, progress=None, verify=True):
        self.root = directory(root)
        self.manifest, self.manifest_body = _original_json(member(self.root, self.manifest_name))
        self.manifest_sha256 = self.id = sha_bytes(self.manifest_body)
        exact_manifest = _exact_document(self.manifest_body)
        require(expected_manifest_sha256 is None or expected_manifest_sha256 == self.id,
                "RECEIVING_MANIFEST_CHANGED", "The original vector export manifest changed.")
        manifest = self.manifest
        require(isinstance(manifest, dict) and manifest.get("schema") == VECTOR_SCHEMA,
                "VECTOR_EXPORT_SCHEMA", "Select the complete original vector-export.json directory.")
        require(isinstance(manifest.get("files"), list) and
                isinstance(manifest.get("sourceEdition"), dict) and
                isinstance(manifest.get("profile"), dict) and isinstance(manifest.get("native"), dict),
                "VECTOR_EXPORT_INCOMPLETE", "Keep the complete original vector source, profile and native inventory.")
        _hash(manifest.get("selectionSha256"), "selection")
        self.files = {}
        self._verified_metadata = set()
        self._metadata_bodies = {}
        for raw in manifest["files"]:
            record = descriptor(raw)
            require(record["path"] != self.manifest_name and record["path"] not in self.files,
                    "DUPLICATE_MEMBER", "The vector export has a duplicate native member.", path=record["path"])
            self.files[record["path"]] = record
        capture = descriptor(manifest.get("sourceCapture"))
        require(capture["path"] == "source/capture.json" and capture["path"] in self.files and
                _same_descriptor(capture, self.files[capture["path"]]),
                "VECTOR_CAPTURE_BINDING", "Keep the exact original source capture descriptor and file.")
        for name in (SOURCE_FEATURES, NATIVE_BINDINGS, "native/field-map.json", "native/native-row-ids.ndjson"):
            require(name in self.files, "VECTOR_NATIVE_BINDINGS",
                    "Keep the original source-row and native-row binding files.", path=name)
        self.capture = self._metadata(capture["path"])
        captured = self.capture
        exact_capture = _exact_document(self._metadata_bodies[capture["path"]])
        require(isinstance(captured, dict) and captured.get("schema") == CAPTURE_SCHEMA and
                isinstance(captured.get("selection"), dict) and isinstance(captured.get("files"), list) and
                captured.get("selectionSha256") == manifest["selectionSha256"] and
                captured["selection"].get("sourceEdition") == manifest["sourceEdition"] and
                _exact_value_sha(exact_capture["selection"]) == manifest["selectionSha256"] and
                _exact_json(exact_capture["selection"].get("sourceEdition")) ==
                _exact_json(exact_manifest.get("sourceEdition")),
                "VECTOR_ORIGINAL_EDITION_CHANGED", "Keep the original captured selection and source edition.")
        _text(captured["selection"].get("id"), "selection ID")
        nested_names = set()
        for raw in captured["files"]:
            retained = descriptor(raw)
            require(retained["path"] not in nested_names, "DUPLICATE_MEMBER",
                    "The source capture has a duplicate original member.", path=retained["path"])
            nested_names.add(retained["path"])
            retained["path"] = "source/" + retained["path"]
            require(retained["path"] in self.files and _same_descriptor(retained, self.files[retained["path"]]),
                    "VECTOR_ORIGINAL_FILE_CHANGED", "Keep every original capture member and byte identity.",
                    path=retained["path"])
        require("inspection.json" in nested_names and "catalog.sqlite" in nested_names,
                "VECTOR_ORIGINAL_CATALOGUE", "Keep the producer's original layer inventory and feature catalogue.")
        self.inspection = self._metadata("source/inspection.json")
        exact_inspection = _exact_document(self._metadata_bodies["source/inspection.json"])
        require(isinstance(self.inspection, dict) and
                self.inspection.get("schema") == "starforge.vector-inspection.v1" and
                self.inspection.get("selectionId") == captured["selection"]["id"] and
                self.inspection.get("sourceEdition") == manifest["sourceEdition"] and
                _exact_json(exact_inspection.get("sourceEdition")) ==
                _exact_json(exact_manifest.get("sourceEdition")) and
                isinstance(self.inspection.get("layers"), list),
                "VECTOR_ORIGINAL_INVENTORY", "The original layer inventory belongs to a different capture.")
        self._source_layers = {}
        for layer in self.inspection["layers"]:
            require(isinstance(layer, dict), "VECTOR_ORIGINAL_LAYER", "Keep the complete original layer metadata.")
            layer_id = _text(layer.get("id"), "source layer ID")
            require(layer_id not in self._source_layers, "VECTOR_ORIGINAL_LAYER_DUPLICATE",
                    "The original layer inventory has duplicate identities.")
            self._source_layers[layer_id] = layer
        native = manifest["native"]
        require(isinstance(native.get("layers"), list) and bool(native["layers"]) and
                "engine" in native and "verification" in native,
                "VECTOR_NATIVE_INVENTORY", "Keep the complete producer engine, layers and native readback.")
        require(native.get("schema") == "starforge.vector-native.v1" and
                native.get("sourceFeatures") == {"path": SOURCE_FEATURES} and
                native.get("bindings") == {"path": NATIVE_BINDINGS} and
                native.get("formats") == manifest["profile"].get("formats") and
                self._metadata("native/native.json") == native and
                _exact_json(_exact_document(self._metadata_bodies["native/native.json"])) ==
                _exact_json(exact_manifest["native"]),
                "VECTOR_NATIVE_METADATA_CHANGED", "Keep the producer's exact native layer and row-binding inventory.")
        for layer in exact_manifest["native"]["layers"]:
            require(_exact_json(layer.get("sourceReference", {}).get("sourceEdition")) ==
                    _exact_json(exact_manifest["sourceEdition"]), "VECTOR_LAYER_PROVENANCE",
                    "The native layer must retain the exact original source edition.")
        verification = native["verification"]
        require(isinstance(verification, dict) and
                verification.get("schema") == "starforge.vector-native-verification.v1" and
                verification.get("allOriginalBindingsMatched") is True and
                isinstance(verification.get("layers"), list),
                "VECTOR_NATIVE_READBACK", "Keep the producer's completed original native readback.")
        self.edition = copy.deepcopy(manifest["sourceEdition"])
        self.source = {
            "schema": VECTOR_SCHEMA, "sourceKind": self.sourceKind, "manifestSha256": self.id,
            "sourceEdition": copy.deepcopy(self.edition),
            "sourceEditionJson": _exact_json(exact_manifest["sourceEdition"]),
            "selectionSha256": manifest["selectionSha256"], "sourceCapture": copy.deepcopy(capture),
            "profile": copy.deepcopy(manifest["profile"]), "nativeEngine": copy.deepcopy(native["engine"]),
        }
        self.paths = {"source-capture": capture["path"], "source-features": SOURCE_FEATURES,
                      "native-bindings": NATIVE_BINDINGS}
        self.scenes, self.assets = {}, {}
        self.collections, self.unbound_assets = [], []
        self.features = None
        self._bundles = {}
        for raw in native["layers"]:
            self._add_layer(raw, capture)
        require(len({layer["id"] for layer in native["layers"]}) == len(native["layers"]) and
                {layer["sourceLayerId"] for layer in native["layers"]} == set(self._source_layers),
                "VECTOR_ORIGINAL_LAYERS_CHANGED", "Keep every original selected source layer and unique native output.")
        require(all(isinstance(row, dict) and isinstance(row.get("layerId"), str)
                    for row in verification["layers"]) and
                {row["layerId"] for row in verification["layers"]} ==
                {layer["id"] for layer in native["layers"]},
                "VECTOR_NATIVE_READBACK", "Keep the native readback for every retained layer.")
        self.summary = {
            "sourceKind": self.sourceKind, "sourceLayers": len(self.scenes),
            "nativeLayers": len(self.assets), "scenes": len(self.scenes), "assets": len(self.assets),
            "sourceFeatures": self.capture.get("counts", {}).get("features"),
            "nativeFeatures": sum(item["original"]["featureCount"] for item in self.assets.values()),
            "formats": sorted({item["original"]["driver"] for item in self.assets.values()}),
            "files": len(self.files), "bytes": sum(record["bytes"] for record in self.files.values()),
        }
        checked = [record for record in self.files.values()
                   if verify and record["path"] not in self._verified_metadata]
        for index, record in enumerate(checked, 1):
            file_digest(member(self.root, record["path"]), expected=record,
                        progress=progress, name=record["path"])
            if progress:
                progress({"phase": "file-complete", "path": record["path"],
                          "completedFiles": index, "totalFiles": len(checked)})
        if verify:
            for name in self._bundles:
                self._check_native_members(name)

    def _metadata(self, name):
        require(name in self.files, "VECTOR_METADATA_MISSING",
                "Keep the original producer metadata in the complete receiving closure.", path=name)
        value, body = _original_json(member(self.root, name))
        record = self.files[name]
        require(len(body) == record["bytes"] and sha_bytes(body) == record["sha256"],
                "VECTOR_METADATA_CHANGED", "The consumed original metadata bytes changed.", path=name)
        self._verified_metadata.add(name)
        self._metadata_bodies[name] = body
        return value

    def _native_bundle(self, layer):
        name, driver = layer["path"], layer["driver"]
        require(name in self.files, "VECTOR_NATIVE_FILE",
                "The original native layer file is outside its received closure.", path=name)
        path = PurePosixPath(name)
        if driver == "GPKG":
            require(path.suffix.lower() == ".gpkg", "VECTOR_DRIVER_FILE",
                    "The retained GeoPackage layer requires its original .gpkg file.", path=name)
            names = [name]
        else:
            require(path.suffix.lower() == ".shp", "VECTOR_DRIVER_FILE",
                    "The retained Shapefile layer requires its original .shp file.", path=name)
            prefix = path.stem.casefold() + "."
            names = [candidate for candidate in self.files
                     if PurePosixPath(candidate).parent == path.parent and
                     PurePosixPath(candidate).name.casefold().startswith(prefix)]
            extensions = {}
            for candidate in names:
                leaf = PurePosixPath(candidate).name
                extension = leaf[len(path.stem):].casefold()
                require(extension not in extensions, "VECTOR_COMPONENT_AMBIGUOUS",
                        "A native Shapefile component has ambiguous casing.", path=candidate)
                extensions[extension] = candidate
            required = (".shp", ".shx", ".dbf", ".cpg") + ((".prj",) if layer.get("crsWkt") else ())
            require(all(extension in extensions for extension in required),
                    "VECTOR_COMPONENT_MISSING",
                    "Keep the original Shapefile geometry, index and attribute table together.", path=name)
        records = [copy.deepcopy(self.files[component]) for component in sorted(names)]
        previous = self._bundles.get(name)
        require(previous is None or previous["files"] == records, "VECTOR_COMPONENT_CONFLICT",
                "One native primary file has different retained companion sets.", path=name)
        bundle = {"driver": driver, "files": records,
                  "sha256": value_sha([{key: record[key] for key in ("path", "bytes", "sha256")}
                                       for record in records])}
        self._bundles[name] = bundle
        return bundle

    def _add_layer(self, raw, capture):
        require(isinstance(raw, dict), "VECTOR_LAYER_INVALID", "Retain the original native layer object.")
        layer = copy.deepcopy(raw)
        for key, label in (("id", "layer ID"), ("sourceId", "source ID"),
                           ("sourceLayerId", "source layer ID"), ("layer", "layer name"),
                           ("path", "layer path")):
            _text(layer.get(key), label)
        require(layer.get("driver") in DRIVERS, "VECTOR_DRIVER",
                "Select the original GeoPackage or ESRI Shapefile output.")
        require(isinstance(layer.get("fields"), list) and all(isinstance(field, dict) for field in layer["fields"]),
                "VECTOR_FIELD_MAPPING", "Keep every original source-to-native field mapping.")
        require("geometry" in layer and "crsWkt" in layer and layer.get("coordinateOrder") == "x,y",
                "VECTOR_NATIVE_SPATIAL", "Retain the actual geometry, CRS and x,y coordinate-order readback.")
        _count(layer.get("featureCount"), "feature count")
        _count(layer.get("sourceFeatureCount"), "source feature count")
        reference = layer.get("sourceReference")
        require(isinstance(reference, dict) and
                reference.get("captureSha256") == capture["sha256"] and
                reference.get("selectionSha256") == self.manifest["selectionSha256"] and
                reference.get("sourceEdition") == self.edition,
                "VECTOR_LAYER_PROVENANCE", "The native layer must bind the original capture, selection and edition.")
        require(reference.get("selectionId") == self.capture["selection"]["id"],
                "VECTOR_SELECTION_IDENTITY", "The native layer belongs to a different original selection.")
        source_layer = self._source_layers.get(layer["sourceLayerId"])
        require(source_layer is not None and source_layer.get("sourceId") == layer["sourceId"] and
                reference.get("sourceSha256") == source_layer.get("sourceSha256") and
                reference.get("nativeSourceLayer") == source_layer.get("name") and
                layer["sourceFeatureCount"] == source_layer.get("counts", {}).get("features"),
                "VECTOR_SOURCE_LAYER_CHANGED", "Retain the original source layer, file, native name and feature count.")
        fields = source_layer.get("fields")
        require(isinstance(fields, dict) and len(layer["fields"]) == len(fields) and
                all(isinstance(field.get("sourceName"), str) for field in layer["fields"]) and
                {field.get("sourceName") for field in layer["fields"]} == set(fields),
                "VECTOR_FIELD_MAPPING", "Keep every original field, including sidecar and exact-value codecs.")
        _hash(reference.get("sourceSha256"), "selected source")
        require("nativeSourceLayer" in reference, "VECTOR_LAYER_PROVENANCE",
                "Retain the original native source-layer reference.")
        descriptor(self.files.get(layer.get("path")))
        bundle = self._native_bundle(layer)
        identity = {"sourceId": layer["sourceId"], "sourceLayerId": layer["sourceLayerId"], "layerId": layer["id"]}
        key = asset_key(identity["sourceId"], identity["sourceLayerId"], identity["layerId"])
        require(key not in self.assets, "VECTOR_LAYER_IDENTITY_CONFLICT",
                "Select one native output for each original source/layer identity.", nativeIdentity=identity)
        group_key = scene_key(identity["sourceId"], identity["sourceLayerId"])
        group = self.scenes.setdefault(group_key, {
            "sourceKind": self.sourceKind, "nativeIdentity": {key: identity[key] for key in ("sourceId", "sourceLayerId")},
            "sourceId": identity["sourceId"], "sourceLayerId": identity["sourceLayerId"],
            "collection": identity["sourceId"], "id": identity["sourceLayerId"],
            "selectionId": reference["selectionId"], "sourceEdition": copy.deepcopy(self.edition), "layers": [],
        })
        require(group["selectionId"] == reference["selectionId"], "VECTOR_SELECTION_IDENTITY",
                "One original source layer belongs to conflicting selections.")
        group["layers"].append(copy.deepcopy(layer))
        file = copy.deepcopy(self.files[layer["path"]])
        file["nativeBundleSha256"] = bundle["sha256"]
        file.setdefault("contentType", DRIVERS[layer["driver"]])
        self.assets[key] = {
            "sourceKind": self.sourceKind, "nativeIdentity": identity,
            "collection": identity["sourceId"], "itemId": identity["sourceLayerId"], "assetKey": identity["layerId"],
            "nativeLayer": layer["layer"], "original": layer, "file": file, "outcome": "received", "reason": None,
            "receipt": {
                "manifest": {"path": self.manifest_name, "bytes": len(self.manifest_body), "sha256": self.id},
                "sourceReference": copy.deepcopy(reference), "nativeComponents": copy.deepcopy(bundle["files"]),
                "nativeBundleSha256": bundle["sha256"],
            },
        }

    def _check_native_members(self, name):
        """Reject loader-visible native bytes outside the original file closure."""
        bundle = self._bundles[name]
        primary = member(self.root, name)
        declared = {record["path"] for record in bundle["files"]}
        if bundle["driver"] == "GPKG":
            for suffix in ("-wal", "-shm", "-journal"):
                candidate = primary.with_name(primary.name + suffix)
                require(not candidate.exists() and not candidate.is_symlink(), "VECTOR_NATIVE_SIDECAR",
                        "Receive the producer's closed GeoPackage, with its committed bytes in the original file.",
                        path=str(candidate.relative_to(self.root)))
        else:
            stem = primary.stem
            prefix = stem.casefold() + "."
            for candidate in primary.parent.iterdir():
                leaf = candidate.name
                if not leaf.casefold().startswith(prefix):
                    continue
                extension = leaf[len(stem):].casefold()
                if extension not in SHAPEFILE_INPUTS and not extension.endswith(".atx"):
                    continue
                relative = candidate.relative_to(self.root).as_posix()
                require(relative in declared, "VECTOR_NATIVE_COMPONENT_UNDECLARED",
                        "The native reader found a component outside the original Shapefile bundle.", path=relative)

    def path(self, name, verify=False, progress=None):
        require(name in self.files, "MEMBER_NOT_RECEIVED",
                "This file is outside the original vector export.", path=name)
        path = member(self.root, name)
        if verify:
            bundle = self._bundles.get(name)
            if bundle is not None:
                self._check_native_members(name)
                records = bundle["files"]
            else:
                records = [self.files[name]]
            for record in records:
                file_digest(member(self.root, record["path"]), expected=record,
                            progress=progress, name=record["path"])
        return path

    def scene_rows(self):
        rows = []
        for key, group in self.scenes.items():
            layers = group["layers"]
            rows.append({
                "key": key, "sourceKind": self.sourceKind,
                "nativeIdentity": copy.deepcopy(group["nativeIdentity"]),
                "sourceId": group["sourceId"], "sourceLayerId": group["sourceLayerId"],
                "collection": group["sourceId"], "itemId": group["sourceLayerId"],
                "selectionId": group["selectionId"], "assetCount": len(layers),
                "layerIds": [layer["id"] for layer in layers],
                "formats": sorted({layer["driver"] for layer in layers}),
                "sourceFeatureCount": layers[0]["sourceFeatureCount"],
                "metadataSha256": value_sha(group),
            })
        return rows

    def asset_rows(self, selected_scene=None):
        rows = []
        for key, item in self.assets.items():
            native_scene = scene_key(item["collection"], item["itemId"])
            if selected_scene is not None and native_scene != selected_scene:
                continue
            original = item["original"]
            rows.append({
                "key": key, "sceneKey": native_scene, "sourceKind": self.sourceKind,
                "nativeIdentity": copy.deepcopy(item["nativeIdentity"]),
                "sourceId": item["nativeIdentity"]["sourceId"],
                "sourceLayerId": item["nativeIdentity"]["sourceLayerId"],
                "layerId": item["nativeIdentity"]["layerId"],
                "collection": item["collection"], "itemId": item["itemId"], "assetKey": item["assetKey"],
                "nativeLayer": item["nativeLayer"], "title": original["layer"], "driver": original["driver"],
                "mime": DRIVERS[original["driver"]], "roles": [], "kindHint": "vector",
                "outcome": item["outcome"], "reason": item["reason"],
                "featureCount": original["featureCount"], "sourceFeatureCount": original["sourceFeatureCount"],
                "file": copy.deepcopy(item["file"]), "original": copy.deepcopy(original),
                "receipt": copy.deepcopy(item["receipt"]),
            })
        return rows

    def layer_definition(self, source_id, source_layer_id, layer_id, *, label=None):
        """Select one actual native output for the existing QGIS layer commands."""
        key = asset_key(source_id, source_layer_id, layer_id)
        item = self.assets.get(key)
        require(item is not None, "VECTOR_LAYER_NOT_RECEIVED", "Select an original received native layer identity.")
        return {
            "id": "vector-" + value_sha(item["nativeIdentity"])[:32],
            "sourceId": self.id, "kind": "vector", "collection": source_id,
            "itemId": source_layer_id, "assetKey": layer_id,
            "vectorLayer": item["nativeLayer"], "vectorSubsetString": "",
            "label": label or item["nativeLayer"], "visible": True, "opacity": 1,
        }

    def native_inventory(self):
        return {
            "sourceKind": self.sourceKind, "manifestSha256": self.id,
            "sourceEdition": copy.deepcopy(self.edition),
            "selectionSha256": self.manifest["selectionSha256"],
            "sourceCapture": copy.deepcopy(self.manifest["sourceCapture"]),
            "native": copy.deepcopy(self.manifest["native"]),
            "layers": self.asset_rows(),
        }
