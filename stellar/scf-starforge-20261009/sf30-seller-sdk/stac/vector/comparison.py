"""Complete source-edition comparison by original feature identity, with portable receiving."""
from __future__ import annotations
import json
import contextlib
import os
import sqlite3
from pathlib import Path
from .common import (CAPTURE, EXPORT, VectorError, need, canonical, digest, json_bytes,
    read_json, read_catalog, private_directory, claim, require_id, atomic_json, file_record,
    verify_manifest, clone_capture, all_files, fsync_directory, member, copy_verified,
    descriptor, verify_file)

COMPARISON = "starforge.vector-comparison.v1"

def capture_at(directory, expected_sha256=None):
    directory = Path(directory).resolve()
    if (directory / "capture.json").is_file():
        manifest, record = verify_manifest(directory, "capture.json", CAPTURE, expected_sha256)
        return directory, manifest, record
    from .materialize import open_vector_export
    value = open_vector_export(directory, expected_sha256, native=False)
    source = directory / "source"
    manifest, record = verify_manifest(source, "capture.json", CAPTURE,
                                       value["manifest"]["sourceCapture"]["sha256"])
    return source, manifest, record

def property_changes(before, after, before_kinds=None, after_kinds=None):
    before = before or {}
    after = after or {}
    before_kinds, after_kinds = before_kinds or {}, after_kinds or {}
    result = []
    for key in sorted(set(before) | set(after)):
        bp, ap = key in before, key in after
        if bp != ap or canonical(before.get(key)) != canonical(after.get(key)) or before_kinds.get(key) != after_kinds.get(key):
            result.append({"field": key, "beforePresent": bp, "afterPresent": ap,
                           "beforeJson": canonical(before[key]) if bp else None,
                           "afterJson": canonical(after[key]) if ap else None,
                           "beforeKind": before_kinds.get(key), "afterKind": after_kinds.get(key)})
    return result

def layer_changes(before, after):
    result = []
    for key in sorted(set(before) | set(after)):
        left, right = before.get(key), after.get(key)
        value = {"layerId": key, "before": left, "after": right}
        if left is None:
            value["status"] = "ADDED"
        elif right is None:
            value["status"] = "REMOVED"
        else:
            structural = ("schema", "crsWkt", "identity", "sourceId", "name", "fieldOrder")
            value["status"] = "CHANGED" if any(left.get(name) != right.get(name) for name in structural) else "UNCHANGED"
        result.append(value)
    return result

def compare_captures(before_directory, after_directory, directory, operation_id,
                     before_sha256=None, after_sha256=None):
    require_id(operation_id, "operationId")
    bp, before, before_file = capture_at(before_directory, before_sha256)
    ap, after, after_file = capture_at(after_directory, after_sha256)
    request = {"schema": "starforge.vector-comparison-request.v1", "operationId": operation_id,
               "beforeCaptureSha256": before_file["sha256"], "afterCaptureSha256": after_file["sha256"]}
    with claim(directory, request) as root:
        if (root / "vector-comparison.json").exists():
            manifest, record = verify_manifest(root, "vector-comparison.json", COMPARISON)
            need(manifest["requestSha256"] == digest(request), "VECTOR_ORIGINAL_REQUEST_CONFLICT")
            return {"directory": str(root), "manifest": manifest, "manifestFile": record, "replayed": True}
        clone_capture(bp, root / "before")
        clone_capture(ap, root / "after")
        temporary = root / "comparison.sqlite.receiving"
        temporary.unlink(missing_ok=True)
        connection = sqlite3.connect(temporary)
        connection.row_factory = sqlite3.Row
        os.chmod(temporary, 0o600)
        connection.executescript("""
          PRAGMA journal_mode=DELETE;
          CREATE TABLE changes (
            position INTEGER PRIMARY KEY, row_key TEXT NOT NULL, layer_id TEXT NOT NULL,
            status TEXT NOT NULL, body_json TEXT NOT NULL);
          CREATE INDEX changes_layer_status ON changes(layer_id,status,position);
        """)
        source = read_catalog(root / "before" / "catalog.sqlite")
        source.execute("ATTACH DATABASE ? AS candidate",
                       ((root / "after" / "catalog.sqlite").resolve().as_uri() + "?mode=ro",))
        before_layers = {row["id"]: json.loads(row["metadata_json"]) for row in source.execute("SELECT * FROM layers")}
        after_layers = {row["id"]: json.loads(row["metadata_json"]) for row in source.execute("SELECT * FROM candidate.layers")}
        summaries = layer_changes(before_layers, after_layers)
        counts = {"added": 0, "removed": 0, "changed": 0, "unchanged": 0,
                  "geometryChanged": 0, "propertiesChanged": 0, "otherMembersChanged": 0,
                  "positionalOrRepeatedChanges": 0, "incompleteIdentityChanges": 0}
        field_counts = {}
        output = root / "changes.ndjson.receiving"
        try:
            with output.open("wb") as stream:
                os.chmod(output, 0o600)
                query = """
                  WITH before_keys AS (
                    SELECT layer_id, identity_json, count(*) AS feature_count
                    FROM features GROUP BY layer_id,identity_json
                  ), after_keys AS (
                    SELECT layer_id, identity_json, count(*) AS feature_count
                    FROM candidate.features GROUP BY layer_id,identity_json
                  )
                  SELECT b.row_key AS row_key, b.layer_id AS layer_id, b.identity_json, b.occurrence,
                         b.record_json AS before_json, a.record_json AS after_json,
                         b.geometry_sha256 AS before_geom, a.geometry_sha256 AS after_geom,
                         coalesce(bk.feature_count,0) AS before_key_count,
                         coalesce(ak.feature_count,0) AS after_key_count
                  FROM features b LEFT JOIN candidate.features a ON a.row_key=b.row_key
                  LEFT JOIN before_keys bk ON bk.layer_id=b.layer_id AND bk.identity_json=b.identity_json
                  LEFT JOIN after_keys ak ON ak.layer_id=b.layer_id AND ak.identity_json=b.identity_json
                  UNION ALL
                  SELECT a.row_key, a.layer_id, a.identity_json, a.occurrence,
                         NULL, a.record_json, NULL, a.geometry_sha256,
                         coalesce(bk.feature_count,0), coalesce(ak.feature_count,0)
                  FROM candidate.features a LEFT JOIN features b ON b.row_key=a.row_key
                  LEFT JOIN before_keys bk ON bk.layer_id=a.layer_id AND bk.identity_json=a.identity_json
                  LEFT JOIN after_keys ak ON ak.layer_id=a.layer_id AND ak.identity_json=a.identity_json
                  WHERE b.row_key IS NULL
                  ORDER BY layer_id,row_key
                """
                number = 0
                for row in source.execute(query):
                    bj, aj = row["before_json"], row["after_json"]
                    if bj == aj:
                        counts["unchanged"] += 1
                        continue
                    status = "ADDED" if bj is None else "REMOVED" if aj is None else "CHANGED"
                    counts[status.lower()] += 1
                    left = json.loads(bj) if bj is not None else None
                    right = json.loads(aj) if aj is not None else None
                    lf, rf = (left or {}).get("feature"), (right or {}).get("feature")
                    identity = json.loads(row["identity_json"])
                    repeated = max(row["before_key_count"], row["after_key_count"]) > 1
                    incomplete = identity["mode"] == "fields" and any(
                        not item["present"] for item in identity["fields"])
                    confidence = "positional" if identity["mode"] == "position" else (
                        "repeated" if repeated else "incomplete" if incomplete else "source-key")
                    identity_issues = (["POSITIONAL"] if identity["mode"] == "position" else [])
                    if repeated:
                        identity_issues.append("REPEATED")
                    if incomplete:
                        identity_issues.append("MISSING_FIELD")
                    counts["positionalOrRepeatedChanges"] += confidence in ("positional", "repeated")
                    counts["incompleteIdentityChanges"] += incomplete
                    properties = property_changes((lf or {}).get("properties"), (rf or {}).get("properties"),
                                                  (left or {}).get("propertyKinds"), (right or {}).get("propertyKinds"))
                    container_changed = status == "CHANGED" and (
                        ("properties" in lf) != ("properties" in rf) or
                        (lf.get("properties") is None) != (rf.get("properties") is None))
                    geometry_changed = status == "CHANGED" and row["before_geom"] != row["after_geom"]
                    props_changed = status == "CHANGED" and (bool(properties) or container_changed)
                    before_other = {key: value for key, value in (lf or {}).items() if key not in ("properties", "geometry")}
                    after_other = {key: value for key, value in (rf or {}).items() if key not in ("properties", "geometry")}
                    other_changed = status == "CHANGED" and canonical(before_other) != canonical(after_other)
                    counts["geometryChanged"] += geometry_changed
                    counts["propertiesChanged"] += props_changed
                    counts["otherMembersChanged"] += other_changed
                    for field in properties:
                        key = (row["layer_id"], field["field"])
                        field_counts[key] = field_counts.get(key, 0) + 1
                    number += 1
                    change = {"position": number, "rowKey": row["row_key"], "layerId": row["layer_id"],
                              "status": status, "identity": identity, "occurrence": row["occurrence"],
                              "identityBasis": confidence, "identityIssues": identity_issues,
                              "identityMultiplicity": {"before": row["before_key_count"],
                                                       "after": row["after_key_count"]},
                              "geometryChanged": geometry_changed,
                              "propertyChanges": properties, "propertiesContainerChanged": container_changed,
                              "otherMembersChanged": other_changed,
                              "beforeRecord": left, "afterRecord": right}
                    stream.write(json_bytes(change))
                    connection.execute("INSERT INTO changes VALUES(?,?,?,?,?)",
                                       (number, row["row_key"], row["layer_id"], status, canonical(change)))
                    if number % 1000 == 0:
                        connection.commit()
                stream.flush()
                os.fsync(stream.fileno())
            connection.commit()
            need(connection.execute("PRAGMA quick_check").fetchone()[0] == "ok", "VECTOR_COMPARISON_INVALID")
        finally:
            source.close()
            connection.close()
        with temporary.open("rb") as stream:
            os.fsync(stream.fileno())
        os.replace(temporary, root / "comparison.sqlite")
        os.replace(output, root / "changes.ndjson")
        fsync_directory(root)
        manifest = {"schema": COMPARISON, "requestSha256": digest(request), "operationId": operation_id,
                    "before": {"sourceEdition": before["selection"]["sourceEdition"],
                               "selectionSha256": before["selectionSha256"],
                               "capture": {**before_file, "path": "before/capture.json"}},
                    "after": {"sourceEdition": after["selection"]["sourceEdition"],
                              "selectionSha256": after["selectionSha256"],
                              "capture": {**after_file, "path": "after/capture.json"}},
                    "counts": counts, "layers": summaries,
                    "fields": [{"layerId": layer, "field": field, "features": value}
                               for (layer, field), value in sorted(field_counts.items())],
                    "changes": {"path": "changes.ndjson", "database": "comparison.sqlite",
                                "identityField": "rowKey", "nativeIdentityField": "sf_key"},
                    "files": all_files(root, excluded=("request.json", "vector-comparison.json"))}
        atomic_json(root / "vector-comparison.json", manifest)
        return {"directory": str(root), "manifest": manifest,
                "manifestFile": file_record(root / "vector-comparison.json", "vector-comparison.json"),
                "replayed": False}

def open_comparison(directory, expected_sha256=None):
    manifest, record = verify_manifest(directory, "vector-comparison.json", COMPARISON, expected_sha256)
    for name in ("before", "after"):
        retained, _ = verify_manifest(Path(directory) / name, "capture.json", CAPTURE,
                                       manifest[name]["capture"]["sha256"])
        need(retained["selectionSha256"] == manifest[name]["selectionSha256"] and
             retained["selection"]["sourceEdition"] == manifest[name]["sourceEdition"],
             "VECTOR_COMPARISON_EDITION_CHANGED")
    return {"directory": str(Path(directory).resolve()), "manifest": manifest, "manifestFile": record}

def comparison_index(directory, expected_sha256=None):
    """Read a page from its exact retained index without rereading source assets.

    Complete source/edition verification belongs to open_comparison and receiving.
    A page consumes only this selected manifest and comparison database; hash that
    full database against the manifest before opening its read-only connection.
    """
    root = Path(directory).resolve()
    record = file_record(root / "vector-comparison.json", "vector-comparison.json")
    need(expected_sha256 is None or record["sha256"] == expected_sha256,
         "VECTOR_MANIFEST_CHANGED")
    manifest = read_json(root / "vector-comparison.json")
    need(manifest.get("schema") == COMPARISON and isinstance(manifest.get("files"), list),
         "VECTOR_MANIFEST_INVALID", "vector-comparison.json")
    declared = {}
    for value in manifest["files"]:
        item = descriptor(value)
        need(item["path"] not in declared and item["path"] != record["path"],
             "VECTOR_DUPLICATE_MEMBER", item["path"])
        member(root, item["path"])
        declared[item["path"]] = item
    changes = manifest.get("changes")
    need(isinstance(changes, dict) and changes.get("database") == "comparison.sqlite" and
         changes.get("path") == "changes.ndjson", "VECTOR_COMPARISON_INDEX_INVALID")
    need("comparison.sqlite" in declared and "changes.ndjson" in declared,
         "VECTOR_COMPARISON_INDEX_NOT_DECLARED")
    verify_file(root, declared["comparison.sqlite"])
    return {"directory": str(root), "manifest": manifest, "manifestFile": record}

def comparison_page(directory, offset=0, limit=100, layer_id=None, status=None, expected_sha256=None):
    need(type(offset) is int and offset >= 0 and type(limit) is int and 1 <= limit <= 1000,
         "VECTOR_COMPARISON_PAGE_INVALID")
    opened = comparison_index(directory, expected_sha256)
    filters, values = [], []
    if layer_id is not None:
        filters.append("layer_id=?")
        values.append(layer_id)
    if status is not None:
        need(status in ("ADDED", "REMOVED", "CHANGED"), "VECTOR_COMPARISON_STATUS_INVALID")
        filters.append("status=?")
        values.append(status)
    where = " WHERE " + " AND ".join(filters) if filters else ""
    with contextlib.closing(read_catalog(Path(directory) / "comparison.sqlite")) as connection:
        total = connection.execute("SELECT count(*) FROM changes" + where, values).fetchone()[0]
        rows = connection.execute("SELECT body_json FROM changes" + where +
                                  " ORDER BY position LIMIT ? OFFSET ?", [*values, limit, offset])
        # Exact JSON text keeps 64-bit/native numeric source values intact in JS clients.
        changes = [{"valueJson": row["body_json"]} for row in rows]
    return {"manifestFile": opened["manifestFile"], "offset": offset, "limit": limit,
            "total": total, "nextOffset": offset + len(changes) if offset + len(changes) < total else None,
            "changes": changes}

def receive_comparison(source, destination, expected_sha256=None):
    original = open_comparison(source, expected_sha256)
    request = {"schema": "starforge.vector-comparison-receive-request.v1",
               "manifestSha256": original["manifestFile"]["sha256"]}
    with claim(destination, request) as root:
        for record in original["manifest"]["files"] + [original["manifestFile"]]:
            copy_verified(member(source, record["path"]), member(root, record["path"]), record)
        return open_comparison(root, request["manifestSha256"])
