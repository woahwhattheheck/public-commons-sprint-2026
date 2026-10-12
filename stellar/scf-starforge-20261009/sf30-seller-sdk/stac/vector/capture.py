"""Capture and index every selected feature from original retained local files."""
from __future__ import annotations
import hashlib
import json
import math
import os
import sqlite3
from collections import Counter
from pathlib import Path
from .common import (CAPTURE, SELECTION, VectorError, need, descriptor, member, file_record,
    verify_manifest, copy_verified, canonical, digest, json_bytes, atomic_json, claim,
    connect_catalog, encoded_value, value_kind, canonical_geometry, require_id,
    all_files, fsync_directory, read_json, parse_json, number_decimal)
from .driver import capabilities, source_driver, layers, native_features

def selection_contract(selection):
    need(isinstance(selection, dict) and selection.get("schema") == SELECTION,
         "VECTOR_SELECTION_REQUIRED")
    require_id(selection.get("id"), "selection.id")
    need(isinstance(selection.get("sourceEdition"), dict) and selection["sourceEdition"],
         "VECTOR_ORIGINAL_EDITION_REQUIRED")
    sources = selection.get("sources")
    need(isinstance(sources, list) and sources, "VECTOR_SELECTED_SOURCES_REQUIRED")
    seen = set()
    result = parse_json(canonical(selection))
    for source in result["sources"]:
        require_id(source.get("id"), "source.id")
        need(source["id"] not in seen, "VECTOR_DUPLICATE_SOURCE_ID", source["id"])
        seen.add(source["id"])
        descriptor(source)
        member(Path("/"), source["path"])
        source_driver(source)
        members = source.get("members", [])
        need(isinstance(members, list), "VECTOR_SOURCE_MEMBERS_INVALID")
        paths = {source["path"]}
        for item in members:
            descriptor(item)
            member(Path("/"), item["path"])
            need(item["path"] not in paths, "VECTOR_DUPLICATE_SOURCE_MEMBER", item["path"])
            paths.add(item["path"])
        if source_driver(source) == "ESRI Shapefile" and not source.get("archiveMember"):
            stem = str(Path(source["path"]).with_suffix("")).lower()
            lower = {path.lower() for path in paths}
            need(all(stem + extension in lower for extension in (".shp", ".shx", ".dbf")),
                 "VECTOR_SHAPEFILE_COMPONENT_MISSING", source["path"])
        identity = source.setdefault("identity", {"mode": "feature-id"})
        need(identity.get("mode") in ("feature-id", "fields", "position"),
             "VECTOR_IDENTITY_MODE_INVALID")
        if identity["mode"] == "fields":
            fields = identity.get("fields")
            need(isinstance(fields, list) and fields and
                 all(isinstance(field, str) and field for field in fields) and
                 len(fields) == len(set(fields)), "VECTOR_IDENTITY_FIELDS_REQUIRED")
    return result

def field_stat():
    return {"present": 0, "nulls": 0, "kinds": [], "maxTextBytes": 0,
            "maxTextCharacters": 0, "maxJsonBytes": 0, "minInteger": None,
            "maxInteger": None, "requiresQuotedString": False, "requiresExactNumber": False}

def add_stat(stat, value):
    kind = value_kind(value)
    stat["present"] += 1
    stat["nulls"] += value is None
    if kind not in stat["kinds"]:
        stat["kinds"].append(kind)
        stat["kinds"].sort()
    packed = encoded_value(value)
    stat["maxJsonBytes"] = max(stat["maxJsonBytes"], len(canonical(packed).encode("utf-8")))
    if type(value) is int:
        stat["minInteger"] = str(value if stat["minInteger"] is None else min(value, int(stat["minInteger"])))
        stat["maxInteger"] = str(value if stat["maxInteger"] is None else max(value, int(stat["maxInteger"])))
    if kind == "number":
        try:
            native = float(value)
            exact = math.isfinite(native) and number_decimal(native) == number_decimal(value)
        except (OverflowError, ValueError):
            exact = False
        stat["requiresExactNumber"] |= not exact
    if type(value) is str:
        stat["maxTextBytes"] = max(stat["maxTextBytes"], len(value.encode("utf-8")))
        stat["maxTextCharacters"] = max(stat["maxTextCharacters"], len(value))
        stat["requiresQuotedString"] |= not value or value.strip() != value or "\0" in value

def identity_for(feature, source, position):
    policy = source["identity"]
    props = feature.get("properties") or {}
    if policy["mode"] == "fields":
        fields = [{"field": key, "present": key in props, "value": encoded_value(props.get(key)),
                   "kind": value_kind(props[key]) if key in props else "absent"}
                  for key in policy["fields"]]
        return {"mode": "fields", "fields": fields}, any(not item["present"] for item in fields)
    if policy["mode"] == "feature-id" and "id" in feature and feature["id"] is not None:
        return {"mode": "feature-id", "value": encoded_value(feature["id"]),
                "kind": value_kind(feature["id"])}, False
    return {"mode": "position", "value": position,
            "requestedMode": policy["mode"]}, policy["mode"] != "position"

def source_target(source, item):
    # Keep sibling names and hierarchy, which native Shapefile readers require.
    return "sources/" + source["id"] + "/" + item["path"]

def retained_source(root, source):
    return member(root, source_target(source, source))

def retain_sources(root, source_root, selection):
    records = []
    seen = {}
    for source in selection["sources"]:
        for original in [descriptor(source)] + [descriptor(item) for item in source.get("members", [])]:
            relative = source_target(source, original)
            expected = {**original, "path": relative}
            if relative in seen:
                need(seen[relative] == expected, "VECTOR_SOURCE_MEMBER_CONFLICT")
                continue
            seen[relative] = expected
            copy_verified(member(source_root, original["path"]), member(root, relative), expected)
            records.append(expected)
    return records

def create_catalog(root, selection):
    database = root / "catalog.sqlite.receiving"
    database.unlink(missing_ok=True)
    connection = connect_catalog(database)
    os.chmod(database, 0o600)
    connection.executescript("""
      PRAGMA journal_mode=DELETE;
      CREATE TABLE layers (id TEXT PRIMARY KEY, metadata_json TEXT NOT NULL);
      CREATE TABLE features (
        row_key TEXT PRIMARY KEY, layer_id TEXT NOT NULL, position INTEGER NOT NULL,
        identity_json TEXT NOT NULL, occurrence INTEGER NOT NULL,
        record_json TEXT NOT NULL, geometry_sha256 TEXT NOT NULL, properties_sha256 TEXT NOT NULL,
        UNIQUE(layer_id, position));
      CREATE INDEX features_layer ON features(layer_id, position);
      CREATE TABLE identity_counts (layer_id TEXT, identity_json TEXT, count INTEGER,
        PRIMARY KEY(layer_id, identity_json));
    """)
    observed, total, duplicates, fallback = [], 0, 0, 0
    try:
        for source in selection["sources"]:
            source_layers = layers(retained_source(root, source), source)
            for meta in source_layers:
                # GeoPackage can gain a layer in a later source edition. Its existing
                # native layer keeps its ID regardless of the current layer count.
                layer_id = source["id"] if source_driver(source) != "GPKG" else (
                    source["id"] + "." + hashlib.sha256(meta["name"].encode()).hexdigest()[:12])
                counts = {"features": 0, "missingIdentity": 0, "duplicateIdentity": 0,
                          "nullGeometry": 0, "geometryTypes": {}}
                fields, samples = {}, []
                declared = meta["schema"]["properties"]
                for name in declared:
                    fields[name] = field_stat()
                for position, raw in enumerate(native_features(retained_source(root, source), source, meta), 1):
                    need(isinstance(raw, dict) and raw.get("type") == "Feature",
                         "VECTOR_FEATURE_REQUIRED", {"layer": layer_id, "position": position})
                    need(raw.get("properties") is None or isinstance(raw.get("properties"), dict),
                         "VECTOR_PROPERTIES_REQUIRED")
                    props = raw.get("properties") or {}
                    need(all(isinstance(key, str) for key in props), "VECTOR_FIELD_NAME_INVALID")
                    geometry = raw.get("geometry")
                    canonical_geometry(geometry)
                    for name, value in props.items():
                        add_stat(fields.setdefault(name, field_stat()), value)
                    identity, missing = identity_for(raw, source, position)
                    identity_json = canonical(identity)
                    count_row = connection.execute(
                        "SELECT count FROM identity_counts WHERE layer_id=? AND identity_json=?",
                        (layer_id, identity_json)).fetchone()
                    occurrence = count_row["count"] + 1 if count_row else 1
                    connection.execute(
                        "INSERT INTO identity_counts VALUES(?,?,?) ON CONFLICT(layer_id,identity_json) "
                        "DO UPDATE SET count=excluded.count", (layer_id, identity_json, occurrence))
                    row_key = digest({"layer": layer_id, "identity": identity, "occurrence": occurrence})
                    record = {"feature": encoded_value(raw),
                              "propertyKinds": {key: value_kind(value) for key, value in props.items()}}
                    connection.execute("INSERT INTO features VALUES(?,?,?,?,?,?,?,?)",
                        (row_key, layer_id, position, identity_json, occurrence, canonical(record),
                         digest(encoded_value(geometry)), digest(encoded_value(props))))
                    counts["features"] += 1
                    counts["missingIdentity"] += missing
                    counts["duplicateIdentity"] += occurrence > 1
                    counts["nullGeometry"] += geometry is None
                    geometry_type = geometry["type"] if geometry else "null"
                    counts["geometryTypes"][geometry_type] = counts["geometryTypes"].get(geometry_type, 0) + 1
                    if len(samples) < 5:
                        samples.append({"rowKey": row_key, "position": position,
                                        "identityJson": identity_json,
                                        "featureJson": canonical(record["feature"])})
                    if position % 1000 == 0:
                        connection.commit()
                need(counts["features"] == meta["featureCount"],
                     "VECTOR_NATIVE_SOURCE_COUNT_CHANGED",
                     {"layer": layer_id, "native": meta["featureCount"], "captured": counts["features"]})
                for name, stat in fields.items():
                    stat["absent"] = counts["features"] - stat["present"]
                    stat["declaredNativeType"] = declared.get(name)
                saved = {**meta, "id": layer_id, "sourceId": source["id"],
                         "sourcePath": source["path"], "retainedPath": source_target(source, source),
                         "sourceSha256": source["sha256"], "identity": source["identity"],
                         "counts": counts, "fields": fields, "fieldOrder": list(fields), "samples": samples}
                connection.execute("INSERT INTO layers VALUES(?,?)", (layer_id, canonical(saved)))
                connection.commit()
                observed.append(saved)
                total += counts["features"]
                duplicates += counts["duplicateIdentity"]
                fallback += counts["missingIdentity"]
        connection.execute("DROP TABLE identity_counts")
        connection.commit()
        need(connection.execute("PRAGMA quick_check").fetchone()[0] == "ok", "VECTOR_CATALOG_INVALID")
    finally:
        connection.close()
    with database.open("rb") as stream:
        os.fsync(stream.fileno())
    os.replace(database, root / "catalog.sqlite")
    fsync_directory(root)
    inspection = {"schema": "starforge.vector-inspection.v1", "selectionId": selection["id"],
                  "sourceEdition": selection["sourceEdition"], "layers": observed,
                  "counts": {"sources": len(selection["sources"]), "layers": len(observed),
                             "features": total, "duplicateIdentity": duplicates, "missingIdentity": fallback},
                  "identityNotes": [
                      "Every source feature is retained. Repeated identities carry their original occurrence.",
                      "Missing feature IDs use the original row position and remain visible in comparison.",
                  ]}
    atomic_json(root / "inspection.json", inspection)
    return inspection

def capture_selection(selection, source_root, directory):
    selection = selection_contract(selection)
    request = {"schema": "starforge.vector-capture-request.v1", "selection": selection}
    with claim(directory, request) as root:
        if (root / "capture.json").exists():
            opened = open_capture(root)
            manifest, record = opened["manifest"], opened["manifestFile"]
            need(manifest["requestSha256"] == digest(request), "VECTOR_ORIGINAL_REQUEST_CONFLICT")
            return {"directory": str(root), "manifest": manifest, "manifestFile": record, "replayed": True}
        engine = capabilities()
        originals = retain_sources(root, Path(source_root).resolve(), selection)
        checkpoint = root / "catalogue.complete.json"
        if checkpoint.exists():
            saved = read_json(checkpoint)
            need(saved["requestSha256"] == digest(request), "VECTOR_CATALOG_REQUEST_CHANGED")
            for record in saved["files"]:
                from .common import verify_file
                verify_file(root, record)
            inspection = read_json(root / "inspection.json")
        else:
            inspection = create_catalog(root, selection)
            saved = {"requestSha256": digest(request),
                     "files": [file_record(root / "catalog.sqlite", "catalog.sqlite"),
                               file_record(root / "inspection.json", "inspection.json")]}
            atomic_json(checkpoint, saved)
        manifest = {"schema": CAPTURE, "requestSha256": digest(request),
                    "selection": selection, "selectionSha256": digest(selection),
                    "engine": engine, "counts": inspection["counts"],
                    "files": originals + saved["files"]}
        atomic_json(root / "capture.json", manifest)
        return {"directory": str(root), "manifest": manifest,
                "manifestFile": file_record(root / "capture.json", "capture.json"), "replayed": False}

def open_capture(directory, expected_sha256=None):
    manifest, record = verify_manifest(directory, "capture.json", CAPTURE, expected_sha256)
    selection = selection_contract(manifest.get("selection"))
    need(manifest.get("selectionSha256") == digest(selection) and
         manifest.get("requestSha256") == digest({
             "schema": "starforge.vector-capture-request.v1", "selection": selection}),
         "VECTOR_CAPTURE_SELECTION_CHANGED")
    declared = {item["path"]: descriptor(item) for item in manifest["files"]}
    need({"catalog.sqlite", "inspection.json"}.issubset(declared),
         "VECTOR_CAPTURE_INDEX_NOT_DECLARED")
    for source in selection["sources"]:
        for original in [descriptor(source)] + [descriptor(item) for item in source.get("members", [])]:
            expected = {**original, "path": source_target(source, original)}
            need(declared.get(expected["path"]) == expected,
                 "VECTOR_CAPTURE_SOURCE_NOT_DECLARED", expected["path"])
    inspection = read_json(Path(directory) / "inspection.json")
    need(inspection.get("schema") == "starforge.vector-inspection.v1" and
         inspection.get("selectionId") == selection["id"] and
         canonical(inspection.get("sourceEdition")) == canonical(selection["sourceEdition"]) and
         canonical(inspection.get("counts")) == canonical(manifest.get("counts")) and
         isinstance(inspection.get("layers"), list), "VECTOR_CAPTURE_INSPECTION_CHANGED")
    selected = {source["id"]: source for source in selection["sources"]}
    seen = set()
    for layer in inspection["layers"]:
        need(isinstance(layer, dict) and isinstance(layer.get("id"), str) and
             layer["id"] not in seen and layer.get("sourceId") in selected,
             "VECTOR_CAPTURE_LAYER_CHANGED")
        seen.add(layer["id"])
        source = selected[layer["sourceId"]]
        need(layer.get("sourceSha256") == source["sha256"] and
             layer.get("sourcePath") == source["path"] and
             layer.get("retainedPath") == source_target(source, source) and
             canonical(layer.get("identity")) == canonical(source["identity"]),
             "VECTOR_CAPTURE_LAYER_SOURCE_CHANGED", layer["id"])
    return {"directory": str(Path(directory).resolve()), "manifest": manifest,
            "manifestFile": record, "inspection": inspection}
