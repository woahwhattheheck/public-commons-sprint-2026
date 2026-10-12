# SPDX-License-Identifier: MIT
"""Exact PostGIS receiving sources in the maintained Starforge QGIS workspace."""
from __future__ import annotations
import copy
import json
from pathlib import Path
import re

from ..model import (HASH, REQUEST, descriptor, directory, file_digest, member,
                     read_json, require, sha_bytes, value_sha)
from ..vector_source import VectorReceivingSource, _model_number

SCHEMA = "starforge.postgis-intake-receiving.v1"
MANIFEST = "postgis-receiving.json"
PROFILE_SCHEMA = "starforge.postgis-qgis-connection.v1"
GEOMETRIES = {"POINT", "MULTIPOINT", "LINESTRING", "MULTILINESTRING", "POLYGON",
              "MULTIPOLYGON", "GEOMETRYCOLLECTION", "GEOMETRY"}
SSL_MODES = {"verify-full", "verify-ca", "require", "prefer", "allow", "disable"}
MAX_FILES = 50000

def text(value, name, maximum=512):
    require(isinstance(value, str) and 0 < len(value) <= maximum and
            not any(ord(c) < 32 or ord(c) == 127 for c in value),
            "POSTGIS_TEXT", "Retain a valid " + name + ".")
    return value

def identifier(value, name):
    text(value, name, 63)
    require(len(value.encode("utf-8")) <= 63, "POSTGIS_IDENTIFIER",
            "A PostgreSQL identifier is at most 63 bytes.", field=name)
    return value

def count(value, name):
    require(isinstance(value, str) and re.fullmatch(r"0|[1-9][0-9]{0,29}", value),
            "POSTGIS_COUNT", "Retain the exact decimal-text " + name + ".")
    return value

def _unique(pairs):
    result = {}
    for key, value in pairs:
        require(key not in result, "POSTGIS_DUPLICATE_KEY",
                "A receiving object contains a duplicate property.", field=key)
        result[key] = value
    return result

def _json(path):
    _, raw = read_json(path, limit=16777216)
    return json.loads(raw, object_pairs_hook=_unique, parse_float=_model_number,
                      parse_constant=lambda x: (_ for _ in ()).throw(ValueError(x))), raw

def _exact_json(raw):
    # Numeric lexemes in edition labels remain part of the original JSON identity.
    return json.loads(raw, object_pairs_hook=_unique,
                      parse_int=lambda value: ("json-number", value),
                      parse_float=lambda value: ("json-number", value))

def connection_profile(value, receipt=None):
    require(isinstance(value, dict) and set(value) <=
            {"schema", "profileId", "service", "authConfigId", "role", "sslMode", "allowEditing"},
            "POSTGIS_CONNECTION_PROFILE", "Use the explicit service/auth reference profile, without a password or connection URL.")
    out = copy.deepcopy(value)
    out.setdefault("schema", PROFILE_SCHEMA)
    out.setdefault("authConfigId", "")
    out.setdefault("sslMode", "verify-full")
    out.setdefault("allowEditing", False)
    require(out["schema"] == PROFILE_SCHEMA, "POSTGIS_CONNECTION_PROFILE", "Use the QGIS connection profile schema.")
    text(out.get("profileId"), "database profile reference", 160)
    text(out.get("service"), "local libpq service", 160)
    require(re.fullmatch(r"[A-Za-z0-9_.-]{1,160}", out["service"]),
            "POSTGIS_SERVICE", "Select the existing local libpq service by its ordinary name.")
    require(isinstance(out["authConfigId"], str) and
            (not out["authConfigId"] or re.fullmatch(r"[A-Za-z0-9]{7}", out["authConfigId"])),
            "POSTGIS_AUTH_REFERENCE", "Select a local QGIS authentication configuration ID or leave it empty.")
    identifier(out.get("role"), "selected existing role")
    require(out["sslMode"] in SSL_MODES and type(out["allowEditing"]) is bool,
            "POSTGIS_CONNECTION_PROFILE", "Choose an explicit SSL mode and editing setting.")
    if receipt:
        require(out["profileId"] == receipt["database"]["profileId"], "POSTGIS_PROFILE_MISMATCH",
                "This connection profile is not the one identified by the accepted database receipt.")
    return out

def layer_contract(layer):
    return {key: copy.deepcopy(layer[key]) for key in
            ("sourceLayerId", "schema", "relation", "relationType", "keyColumn",
             "sourceKeyColumn", "geometryColumn", "geometryType", "dimension", "srid", "fields")}

class PostgisReceivingSource:
    sourceKind = "postgis"
    manifest_name = MANIFEST

    def __init__(self, root, expected_manifest_sha256=None, progress=None, verify=True):
        self.root = directory(root)
        self.manifest, self.manifest_body = _json(member(self.root, MANIFEST))
        self.manifest_sha256 = self.id = sha_bytes(self.manifest_body)
        require(expected_manifest_sha256 is None or expected_manifest_sha256 == self.id,
                "RECEIVING_MANIFEST_CHANGED", "The accepted PostGIS receiving manifest changed.")
        body = self.manifest
        require(isinstance(body, dict) and body.get("schema") == SCHEMA,
                "POSTGIS_RECEIVING_SCHEMA", "Select the original postgis-receiving.json package.")
        for field in ("projectId", "operationId", "editionId", "acceptedAt"):
            text(body.get(field), field, 512)
        require(type(body.get("revision")) is int and body["revision"] >= 1 and
                isinstance(body.get("requestSha256"), str) and HASH.fullmatch(body["requestSha256"]),
                "POSTGIS_ACCEPTED_IDENTITY", "Keep the accepted original operation, revision and request digest.")
        database = body.get("database")
        require(isinstance(database, dict), "POSTGIS_DATABASE", "The observed database identity is required.")
        for field in ("profileId", "name", "schema", "postgresVersion", "postgisVersion"):
            text(database.get(field), "database " + field, 32768 if "Version" in field else 512)
        identifier(database["schema"], "database schema")
        require(database.get("metadataRelation") == "_sf_intake_projects",
                "POSTGIS_METADATA_RELATION", "Retain the original project metadata relation.")
        require(isinstance(body.get("files"), list) and 0 < len(body["files"]) <= MAX_FILES,
                "POSTGIS_FILES", "Keep the complete bounded original file manifest.")
        self.files = {}
        for raw in body["files"]:
            record = descriptor(raw)
            require(record["path"] not in self.files and record["path"] != MANIFEST,
                    "POSTGIS_DUPLICATE_FILE", "A receiving file has more than one identity.", path=record["path"])
            self.files[record["path"]] = record
        self._metadata = set()
        mapping = descriptor(body.get("mapping"))
        require(mapping["path"] == "profile.json" and self.files.get("profile.json") == mapping,
                "POSTGIS_MAPPING", "Retain the complete frozen mapping with its exact descriptor.")
        self.mapping = self._read("profile.json")
        require(self.mapping.get("schema") == "starforge.postgis-intake-profile.v1",
                "POSTGIS_MAPPING_SCHEMA", "Keep the accepted original database mapping.")
        original = body.get("source")
        require(isinstance(original, dict), "POSTGIS_SOURCE", "The original vector source binding is required.")
        source_manifest = descriptor(original.get("manifest"))
        require(source_manifest["path"] == "source/vector-export.json" and
                self.files.get(source_manifest["path"]) == source_manifest,
                "POSTGIS_VECTOR_SOURCE", "The accepted original vector source must remain under source/.")
        self._read(source_manifest["path"])
        self.vector = VectorReceivingSource(member(self.root, source_manifest["path"]).parent,
                                            source_manifest["sha256"], progress=progress, verify=verify)
        for name, record in {self.vector.manifest_name: source_manifest, **self.vector.files}.items():
            target = "source/" + name
            expected = {"path": target, "bytes": record["bytes"], "sha256": record["sha256"]}
            require(self.files.get(target) is not None and
                    all(self.files[target][k] == expected[k] for k in expected),
                    "POSTGIS_VECTOR_CLOSURE", "Keep every original vector member unchanged.", path=target)
            self._metadata.add(target)
        for field in ("captureSha256", "selectionSha256"):
            require(isinstance(original.get(field), str) and HASH.fullmatch(original[field]),
                    "POSTGIS_SOURCE_HASH", "Retain the exact original " + field + ".")
        require(original["captureSha256"] == self.vector.manifest["sourceCapture"]["sha256"] and
                original["selectionSha256"] == self.vector.manifest["selectionSha256"],
                "POSTGIS_SOURCE_CHANGED", "The accepted database source differs from its retained vector export.")
        require(isinstance(body.get("layers"), list) and body["layers"],
                "POSTGIS_LAYERS", "Keep every accepted database relation.")
        self.layers, relations = {}, set()
        for raw in body["layers"]:
            layer = self._layer(raw)
            require(layer["id"] not in self.layers and (layer["schema"], layer["relation"]) not in relations,
                    "POSTGIS_LAYER_IDENTITY", "Accepted layer and relation identities must be unique.")
            self.layers[layer["id"]] = layer
            relations.add((layer["schema"], layer["relation"]))
        require({row["sourceLayerId"] for row in self.layers.values()} <= set(self.vector._source_layers),
                "POSTGIS_SOURCE_LAYERS", "An accepted relation names an absent original source layer.")

        require(_exact_json(self.manifest_body)["source"].get("sourceEdition") ==
                _exact_json(self.vector.manifest_body)["sourceEdition"] and
                original.get("selectionId") == self.vector.capture["selection"]["id"],
                "POSTGIS_SOURCE_EDITION", "The receipt's original edition and selection must match the retained vector capture.")
        require(self.mapping.get("projectId") == body["projectId"] and
                isinstance(self.mapping.get("database"), dict) and
                all(self.mapping["database"].get(key) == database[key] for key in ("profileId","name","schema")),
                "POSTGIS_MAPPING_IDENTITY", "The frozen mapping belongs to a different database project or connection profile.")
        require(isinstance(self.mapping.get("layers"),list) and self.mapping["layers"],
                "POSTGIS_MAPPING_LAYERS", "Keep the complete accepted layer mapping.")
        mapped={}
        for item in self.mapping["layers"]:
            require(isinstance(item,dict) and isinstance(item.get("id"),str) and item["id"] not in mapped,
                    "POSTGIS_MAPPING_LAYERS", "The frozen mapping contains an invalid or duplicate layer.")
            mapped[item["id"]]=item
        require(set(mapped)==set(self.layers) and
                len({r["sourceLayerId"] for r in self.layers.values()})==len(self.layers) and
                {r["sourceLayerId"] for r in self.layers.values()}==set(self.vector._source_layers),
                "POSTGIS_COMPLETE_LAYER_MAPPING", "Retain exactly one accepted relation and frozen mapping for every selected original source layer.")
        for layer_id,layer in self.layers.items():
            profile_layer=mapped[layer_id]
            require(all(profile_layer.get(key)==layer[key] for key in ("id","sourceLayerId","title","relation","fields")),
                    "POSTGIS_ACCEPTED_MAPPING_CHANGED", "The accepted relation or complete field mapping differs from its frozen original profile.", layerId=layer_id)
            geometry=profile_layer.get("geometry")
            require(isinstance(geometry,dict) and geometry.get("type")==layer["geometryType"] and
                    geometry.get("dimension")==layer["dimension"] and geometry.get("targetSrid")==layer["srid"],
                    "POSTGIS_ACCEPTED_GEOMETRY_MAPPING", "The receipt geometry differs from the retained source-to-target mapping.", layerId=layer_id)
            fields=self.vector._source_layers[layer["sourceLayerId"]].get("fields")
            require(isinstance(fields,dict) and len(layer["fields"])==len(fields) and
                    {f["sourceName"] for f in layer["fields"]}==set(fields),
                    "POSTGIS_COMPLETE_FIELD_MAPPING", "Keep every original source field exactly once, with its explicit typed mapping.", layerId=layer_id)
            expected_roles=profile_layer.get("roles")
            require(isinstance(expected_roles,list) and
                    all(isinstance(r,dict) and isinstance(r.get("name"),str) for r in expected_roles) and
                    len({r["name"] for r in expected_roles})==len(expected_roles),
                    "POSTGIS_MAPPING_ROLES", "Keep the original distinct role mappings.")
            by_role={r["name"]:r for r in expected_roles}
            require(set(by_role)=={r["name"] for r in layer["roles"]},
                    "POSTGIS_COMPLETE_ROLE_MAPPING", "Keep every role of the frozen layer profile.")
            for role in layer["roles"]:
                expected_role=by_role[role["name"]]
                require(all(role.get(key)==value for key,value in expected_role.items()) and
                        all(role["observedPrivileges"][key]==(key in role["permissions"]) for key in ("select","insert","update","delete")),
                        "POSTGIS_ROLE_MAPPING_CHANGED", "The role permissions, scope or accepted observations differ from the frozen profile.")
                scope=role.get("scope")
                require(scope is None or isinstance(scope,dict) and
                        scope.get("column") in {f["name"] for f in layer["fields"]} and
                        isinstance(scope.get("values"),list) and scope["values"] and
                        all(isinstance(v,str) and "\x00" not in v for v in scope["values"]) and
                        len(set(scope["values"]))==len(scope["values"]),
                        "POSTGIS_ROLE_SCOPE", "Keep the explicit mapped-column equality scope and original string values.")

        checked = [r for p, r in self.files.items() if verify and p not in self._metadata]
        for index, record in enumerate(checked, 1):
            file_digest(member(self.root, record["path"]), expected=record, name=record["path"], progress=progress)
            if progress:
                progress({"phase": "file-complete", "path": record["path"],
                          "completedFiles": index, "totalFiles": len(checked)})
        self.source = {"schema": SCHEMA, "sourceKind": self.sourceKind, "manifestSha256": self.id,
                       "projectId": body["projectId"], "editionId": body["editionId"],
                       "revision": body["revision"], "database": copy.deepcopy(database),
                       "selectionSha256": original["selectionSha256"],
                       "sourceEdition": copy.deepcopy(self.vector.source["sourceEdition"]),
                       "sourceEditionJson": self.vector.source["sourceEditionJson"],
                       "sourceCapture": copy.deepcopy(self.vector.manifest["sourceCapture"])}
        self.edition = {"id": body["editionId"], "revision": body["revision"], "acceptedAt": body["acceptedAt"]}
        self.paths = {"original-vector": "source/vector-export.json", "mapping": "profile.json"}
        self.scenes, self.assets, self.collections, self.unbound_assets = {}, {}, [], []
        self.features = None
        self.summary = {"sourceKind": self.sourceKind, "projectId": body["projectId"],
                        "databaseRevision": body["revision"], "acceptedLayers": len(self.layers),
                        "scenes": 0, "assets": 0, "files": len(self.files),
                        "bytes": sum(r["bytes"] for r in self.files.values())}

    def _read(self, name):
        require(name in self.files, "POSTGIS_METADATA_MISSING", "The original metadata file is missing.", path=name)
        body, raw = _json(member(self.root, name))
        require(len(raw) == self.files[name]["bytes"] and sha_bytes(raw) == self.files[name]["sha256"],
                "POSTGIS_METADATA_CHANGED", "The retained metadata differs from its receipt.", path=name)
        self._metadata.add(name)
        return body

    def _layer(self, value):
        require(isinstance(value, dict), "POSTGIS_LAYER", "Keep the accepted layer object.")
        row = copy.deepcopy(value)
        for field in ("id", "sourceLayerId", "title"):
            text(row.get(field), "layer " + field)
        for field in ("schema", "relation", "keyColumn", "sourceKeyColumn", "geometryColumn"):
            identifier(row.get(field), "layer " + field)
        require(row["schema"] == self.manifest["database"]["schema"] and row.get("relationType") == "view" and
                row["keyColumn"] == "sf_id" and row["sourceKeyColumn"] == "sf_key" and row["geometryColumn"] == "geom",
                "POSTGIS_STABLE_RELATION", "Use the accepted security-invoker view and original identity columns.")
        require(row.get("geometryType") in GEOMETRIES and type(row.get("dimension")) is int and
                row["dimension"] in (2, 3) and type(row.get("srid")) is int and 0 < row["srid"] < 1000000,
                "POSTGIS_GEOMETRY", "Retain the typed geometry, dimensionality and target SRID.")
        count(row.get("rowCount"), "accepted row count")
        require(isinstance(row.get("rowSha256"), str) and HASH.fullmatch(row["rowSha256"]),
                "POSTGIS_ROW_DIGEST", "Keep the observed accepted logical row digest.")
        require(isinstance(row.get("fields"), list), "POSTGIS_FIELDS", "Keep every accepted mapped column.")
        names = {"sf_id", "sf_key", "geom"}
        for field in row["fields"]:
            require(isinstance(field, dict), "POSTGIS_FIELD", "Keep each mapped source field.")
            text(field.get("sourceName"), "original field name", 4096)
            identifier(field.get("name"), "mapped column")
            require(field["name"] not in names and type(field.get("nullable")) is bool,
                    "POSTGIS_FIELD", "Mapped columns must retain unique names and nullability.")
            text(field.get("type"), "PostgreSQL field type", 160)
            names.add(field["name"])
        require(isinstance(row.get("roles"), list) and row["roles"], "POSTGIS_ROLES", "Keep the observed existing roles.")
        seen = set()
        for role in row["roles"]:
            require(isinstance(role, dict), "POSTGIS_ROLE", "Retain each actual role observation.")
            identifier(role.get("name"), "role")
            require(role["name"] not in seen and isinstance(role.get("permissions"), list) and
                    set(role["permissions"]) <= {"select", "insert", "update", "delete"},
                    "POSTGIS_ROLE", "A role has a duplicate or unsupported permission.")
            seen.add(role["name"])
            privileges = role.get("observedPrivileges")
            require(isinstance(privileges, dict) and
                    all(type(privileges.get(p)) is bool for p in ("select", "insert", "update", "delete")),
                    "POSTGIS_ROLE_READBACK", "Keep actual observed privileges for every role.")
            count(role.get("visibleRows"), "role-visible row count")
        return row

    def path(self, name, verify=False, progress=None):
        require(name in self.files, "MEMBER_NOT_RECEIVED", "Select a file in the accepted original closure.", path=name)
        target = member(self.root, name)
        if verify:
            file_digest(target, expected=self.files[name], name=name, progress=progress)
        return target

    def scene_rows(self):
        return []

    def asset_rows(self, selected_scene=None):
        return []

    def native_inventory(self):
        return {"sourceKind": self.sourceKind, "manifestSha256": self.id, **copy.deepcopy(self.manifest)}

    def layer_definition(self, layer_id, connection, *, label=None):
        require(layer_id in self.layers, "POSTGIS_LAYER_NOT_RECEIVED", "Select an accepted stable relation.")
        native = self.layers[layer_id]
        return {"id": "postgis-" + value_sha([self.manifest["projectId"], layer_id])[:32],
                "sourceId": self.id, "kind": "vector", "label": label or native["title"],
                "visible": True, "opacity": 1, "bands": None, "crsOverride": None,
                "vectorSubsetString": "", "postgis": {"layerId": layer_id,
                    "connection": connection_profile(connection, self.manifest)}}

def normalize_layer(source, definition):
    row = copy.deepcopy(definition)
    require(source.sourceKind == "postgis" and row.get("kind") == "vector" and
            isinstance(row.get("postgis"), dict) and set(row["postgis"]) == {"layerId", "connection"},
            "POSTGIS_LAYER_SELECTION", "Use an explicit accepted relation and local connection profile.")
    layer_id = row["postgis"]["layerId"]
    require(layer_id in source.layers, "POSTGIS_LAYER_NOT_RECEIVED", "The selected relation is absent from this receipt.")
    selected = source.layers[layer_id]
    profile = connection_profile(row["postgis"]["connection"], source.manifest)
    role = next((r for r in selected["roles"] if r["name"] == profile["role"]), None)
    require(role is not None and role["observedPrivileges"]["select"], "POSTGIS_READ_ROLE",
            "Select an existing receipt role with observed read access.")
    row["postgis"] = {"layerId": layer_id, "connection": profile}
    row["kind"] = "vector"
    row.setdefault("label", selected["title"])
    row.setdefault("vectorSubsetString", "")
    require(isinstance(row["vectorSubsetString"], str) and len(row["vectorSubsetString"]) <= 65536 and
            "\x00" not in row["vectorSubsetString"], "POSTGIS_SUBSET", "Keep the original native subset expression.")
    require(row.get("crsOverride") in (None, "", "EPSG:" + str(selected["srid"])),
            "POSTGIS_CRS_ASSIGNMENT", "The PostGIS geometry already has its accepted SRID; use the project CRS for display.")
    row["crsOverride"] = None
    row["bands"] = None
    for field in ("file", "collection", "itemId", "assetKey", "sceneKey", "vectorLayer"):
        row.pop(field, None)
    return row

def compare_sources(left, right):
    require(left.sourceKind == right.sourceKind == "postgis" and
            left.manifest["projectId"] == right.manifest["projectId"] and
            left.manifest["database"]["name"] == right.manifest["database"]["name"] and
            left.manifest["database"]["schema"] == right.manifest["database"]["schema"],
            "POSTGIS_PROJECT_COMPARISON", "Compare two accepted receipts for the same database project.")
    layers = []
    for key in sorted(set(left.layers) | set(right.layers)):
        old, new = left.layers.get(key), right.layers.get(key)
        status = "ADDED" if old is None else "REMOVED" if new is None else "UNCHANGED" if old == new else "CHANGED"
        layers.append({"id": key, "status": status, "left": copy.deepcopy(old), "right": copy.deepcopy(new),
                       "sameColumnContract": bool(old and new and layer_contract(old) == layer_contract(new))})
    return {"leftSourceId": left.id, "rightSourceId": right.id, "leftSourceKind": "postgis", "rightSourceKind": "postgis",
            "sameSourceIdentities": set(left.layers) == set(right.layers),
            "sameSelection": left.source["selectionSha256"] == right.source["selectionSha256"],
            "sameQuery": True, "scenes": [], "assets": [], "databaseLayers": layers,
            "database": copy.deepcopy(right.manifest["database"]),
            "leftDatabaseRevision": left.manifest["revision"], "rightDatabaseRevision": right.manifest["revision"],
            "counts": {name.lower(): sum(r["status"] == name for r in layers)
                       for name in ("ADDED", "REMOVED", "UNCHANGED", "CHANGED")}}

def successor_layer(left, right, old, connection=None):
    require(left.sourceKind == right.sourceKind == "postgis", "POSTGIS_SUCCESSOR", "Select the accepted PostGIS successor.")
    compare_sources(left, right)
    identifier = old["postgis"]["layerId"]
    require(identifier in right.layers, "POSTGIS_REMOVED_LAYER", "The successor removed this relation; retain its history or remove its current map selection.")
    require(layer_contract(left.layers[identifier]) == layer_contract(right.layers[identifier]),
            "POSTGIS_COLUMN_MIGRATION", "The stable relation contract changed. Inspect its migration and select a new native layer explicitly.")
    row = copy.deepcopy(old)
    row["sourceId"] = right.id
    if connection is not None:
        row["postgis"]["connection"] = connection_profile(connection, right.manifest)
    return normalize_layer(right, row)
