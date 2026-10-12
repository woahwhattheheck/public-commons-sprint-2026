# SPDX-License-Identifier: MIT
"""Explicit destination decisions and complete original-value constraint review."""
from __future__ import annotations
import os
import re
import sqlite3
import tempfile
from pathlib import Path
from decimal import Decimal

from .native import files, mapping, need

SCHEMA = "starforge.gis-migration-plan.v1"
AUDIT = "starforge.gis-migration-source-review.v1"
TABLE = re.compile(r"^[A-Za-z][A-Za-z0-9_]{0,49}$")
SCHEMA_NAME = re.compile(r"^[A-Za-z_][A-Za-z0-9_]{0,62}$")
POLICIES = {"preserve", "required", "non-null"}
NULL_KEYS = {"reject", "distinct", "equal"}

def _text(value, label, *, limit=2000, blank=False):
    need(isinstance(value, str) and "\0" not in value and len(value) <= limit
         and (blank or bool(value.strip())), "MIGRATION_TEXT_INVALID", label)
    return value

def _objects(value, label):
    need(isinstance(value, list) and all(isinstance(row, dict) for row in value),
         "MIGRATION_ROWS_REQUIRED", label)
    return value

def _unique(rows, key, label):
    values = [row.get(key) for row in rows]
    need(all(isinstance(x, str) and x for x in values) and len(set(values)) == len(values),
         "MIGRATION_DUPLICATE_ID", label)
    return {row[key]: row for row in rows}

def default_plan(capture):
    layers, used = [], set()
    for source in capture["inspection"]["layers"]:
        name = files.safe_name(source["id"])
        if name.casefold() in used:
            name = files.safe_name(name, 40) + "_" + files.digest(source["id"])[:8]
        used.add(name.casefold())
        aliases = set(mapping.RESERVED)
        layer = {"sourceLayerId": source["id"], "table": name, "title": source["name"],
                 "fields": [{"source": field, "name": mapping.alias(field, "GPKG", aliases), "mode": "auto",
                             "nullPolicy": "preserve", "note": ""}
                            for field in source["fieldOrder"]],
                 "keys": [], "geometryNulls": "preserve", "note": ""}
        layers.append(layer)
    selected = [row["sourceLayerId"] for row in layers]
    return {"schema": SCHEMA, "captureId": capture["manifestFile"]["sha256"],
            "title": "Vector migration", "note": "", "predecessorPlanId": None,
            "formats": ["GPKG"], "postgisSchema": "public", "layers": layers,
            "projectDefinitions": [{"id": "operating-map", "title": "Migrated data",
                                    "projectCrs": None, "sourceLayerIds": selected, "format": "GPKG"}],
            "pendingDecisions": [], "sourceChanges": None}

def rebase_plan(prior, capture):
    draft = default_plan(capture)
    for key in ("title", "note", "formats", "postgisSchema"):
        draft[key] = prior[key]
    draft["predecessorPlanId"] = files.digest(prior)
    before = {row["sourceLayerId"]: row for row in prior["layers"]}
    after_ids = {row["sourceLayerId"] for row in draft["layers"]}
    changes = {"addedLayers": sorted(after_ids - set(before)), "removedLayers": sorted(set(before) - after_ids),
               "fields": []}
    pending = []
    for row in draft["layers"]:
        old = before.get(row["sourceLayerId"])
        if old is None:
            pending.append({"kind": "new-layer", "sourceLayerId": row["sourceLayerId"],
                            "decision": "", "note": "Review the complete new source layer."})
            continue
        old_fields = {field["source"]: field for field in old["fields"]}
        current_fields = {field["source"] for field in row["fields"]}
        retained = {key: value for key, value in old.items() if key not in ("fields", "keys", "sourceLayerId")}
        row.update(retained)
        row["fields"] = [old_fields.get(field["source"], field) for field in row["fields"]]
        row["keys"] = [key for key in old["keys"] if set(key["fields"]).issubset(current_fields)]
        invalid_keys = [key for key in old["keys"] if not set(key["fields"]).issubset(current_fields)]
        added, removed = sorted(current_fields - set(old_fields)), sorted(set(old_fields) - current_fields)
        changes["fields"].append({"sourceLayerId": row["sourceLayerId"], "added": added, "removed": removed})
        if added or removed or invalid_keys:
            pending.append({"kind": "changed-fields", "sourceLayerId": row["sourceLayerId"],
                            "added": added, "removed": removed, "originalKeysNeedingDecision": invalid_keys,
                            "decision": "", "note": "Review new/removed fields and replace any affected destination key."})
    projects = []
    for project in prior["projectDefinitions"]:
        retained = [item for item in project["sourceLayerIds"] if item in after_ids]
        if retained:
            projects.append({**project, "sourceLayerIds": retained})
        if retained != project["sourceLayerIds"]:
            pending.append({"kind": "project-layer-selection", "projectId": project["id"],
                            "originalSourceLayerIds": project["sourceLayerIds"], "decision": "",
                            "note": "Confirm the new project's intended layer selection."})
    if projects:
        draft["projectDefinitions"] = projects
    for layer_id in changes["removedLayers"]:
        pending.append({"kind": "removed-layer", "sourceLayerId": layer_id, "decision": "",
                        "note": "Confirm how the removed source layer is handled in this edition."})
    draft["pendingDecisions"], draft["sourceChanges"] = pending, changes
    return draft

def normalize(value, capture):
    need(isinstance(value, dict) and value.get("schema") == SCHEMA, "MIGRATION_PLAN_REQUIRED")
    plan = files.parse_json(files.canonical(value))
    need(plan.get("captureId") == capture["manifestFile"]["sha256"], "MIGRATION_CAPTURE_CHANGED")
    _text(plan.get("title"), "title", limit=240)
    _text(plan.setdefault("note", ""), "note", blank=True)
    predecessor = plan.setdefault("predecessorPlanId", None)
    need(predecessor is None or isinstance(predecessor, str) and files.HASH.fullmatch(predecessor),
         "MIGRATION_PREDECESSOR_INVALID")
    formats = plan.setdefault("formats", ["GPKG"])
    need(isinstance(formats, list) and formats and "GPKG" in formats
         and len(formats) == len(set(formats)) and set(formats) <= {"GPKG", "ESRI Shapefile"},
         "MIGRATION_FORMATS_INVALID")
    need(isinstance(plan.get("postgisSchema"), str) and SCHEMA_NAME.fullmatch(plan["postgisSchema"]),
         "MIGRATION_POSTGIS_SCHEMA_INVALID")
    source_layers = {row["id"]: row for row in capture["inspection"]["layers"]}
    layers = _unique(_objects(plan.get("layers"), "layers"), "sourceLayerId", "layers")
    need(set(layers) == set(source_layers), "MIGRATION_COMPLETE_LAYER_DECISIONS_REQUIRED")
    tables = set()
    profile = {"schema": files.PROFILE, "formats": formats, "layers": {},
               "shapefile": {"longValues": "reference", "collections": "split"}}
    field_maps = {}
    for layer_id, row in layers.items():
        source = source_layers[layer_id]
        table = row.get("table")
        need(isinstance(table, str) and TABLE.fullmatch(table) and table.casefold() not in tables
             and table.casefold() not in mapping.RESERVED, "MIGRATION_TABLE_NAME_INVALID", table)
        tables.add(table.casefold())
        _text(row.setdefault("title", source["name"]), "layer title", limit=240)
        _text(row.setdefault("note", ""), "layer note", blank=True)
        need(row.setdefault("geometryNulls", "preserve") in ("preserve", "reject"),
             "MIGRATION_GEOMETRY_NULL_POLICY_INVALID", layer_id)
        fields = _unique(_objects(row.get("fields"), "fields"), "source", layer_id)
        need(set(fields) == set(source["fields"]), "MIGRATION_COMPLETE_FIELD_DECISIONS_REQUIRED", layer_id)
        layer_profile = {"name": table, "label": row["title"], "fieldOrder": list(fields), "fields": {}}
        for crs in ("sourceCrs", "assignSourceCrs", "targetCrs"):
            if row.get(crs) is not None:
                _text(row[crs], crs, limit=10000)
                layer_profile[crs] = row[crs]
        for name, field in fields.items():
            _text(field.get("name"), "destination field", limit=128)
            _text(field.setdefault("note", ""), "field note", blank=True)
            need(field.setdefault("nullPolicy", "preserve") in POLICIES,
                 "MIGRATION_NULL_POLICY_INVALID", {"layer": layer_id, "field": name})
            rule = {"mode": field.setdefault("mode", "auto"), "names": {"GPKG": field["name"]}}
            if field.get("shapefileName"):
                rule["names"]["ESRI Shapefile"] = _text(field["shapefileName"], "Shapefile field", limit=10)
            if field.get("physicalType") is not None:
                rule["physicalType"] = _text(field["physicalType"], "physical type", limit=50)
            layer_profile["fields"][name] = rule
        keys = _unique(_objects(row.setdefault("keys", []), "keys"), "name", layer_id + " keys")
        for name, key in keys.items():
            _text(name, "key name", limit=63)
            members = key.get("fields")
            need(isinstance(members, list) and members and all(isinstance(x, str) for x in members)
                 and len(members) == len(set(members)) and set(members) <= set(fields),
                 "MIGRATION_KEY_FIELDS_INVALID", name)
            need(key.setdefault("nulls", "reject") in NULL_KEYS, "MIGRATION_KEY_NULL_POLICY_INVALID", name)
            _text(key.setdefault("note", ""), "key note", blank=True)
        profile["layers"][layer_id] = layer_profile
    profile = mapping.profile_contract(profile, source_layers)
    for layer_id, source in source_layers.items():
        field_maps[layer_id] = {}
        for driver in formats:
            field_maps[layer_id][driver] = mapping.field_mapping(source, driver, profile["layers"][layer_id], profile)
    projects = _unique(_objects(plan.get("projectDefinitions"), "projectDefinitions"), "id", "projects")
    need(bool(projects), "MIGRATION_PROJECT_REQUIRED")
    for name, project in projects.items():
        files.require_id(name, "project id")
        _text(project.get("title"), "project title", limit=240)
        if project.get("projectCrs") is not None:
            _text(project["projectCrs"], "project CRS", limit=10000)
        else:
            project["projectCrs"] = None
        selected = project.get("sourceLayerIds")
        need(isinstance(selected, list) and selected and all(isinstance(x, str) for x in selected)
             and len(selected) == len(set(selected)) and set(selected) <= set(source_layers),
             "MIGRATION_PROJECT_LAYER_SELECTION_INVALID", name)
        need(project.setdefault("format", "GPKG") == "GPKG", "MIGRATION_PROJECT_FORMAT_INVALID", name)
    for decision in _objects(plan.setdefault("pendingDecisions", []), "pendingDecisions"):
        _text(decision.get("kind"), "decision kind", limit=100)
        _text(decision.setdefault("decision", ""), "decision", blank=True)
    plan.setdefault("sourceChanges", None)
    return plan, profile, field_maps

def _key_value(field, feature):
    value = mapping.attribute_value(field, feature)
    if value is None:
        return None
    family = mapping.native_type_family(field["physicalType"])
    if field["codec"] in ("native", "boolean") and family in ("number", "integer"):
        numeric = files.number_decimal(int(value) if type(value) is bool else value)
        if family == "integer":
            need(numeric == numeric.to_integral_value(),
                 "MIGRATION_INTEGRAL_KEY_REQUIRED", field["sourceName"])
            return int(numeric)
        # Numeric destination equality identifies both signed zero spellings.
        return Decimal(0) if numeric == 0 else numeric
    return value

def audit(capture, plan, directory):
    """Review every source record; retain all failures in a paged native SQLite index."""
    plan, profile, field_maps = normalize(plan, capture)
    root = files.private_directory(directory)
    plan_id = files.digest(plan)
    path = root / "source-review.sqlite"
    if (root / "source-review.json").is_file():
        report = files.read_json(root / "source-review.json")
        need(report.get("planId") == plan_id and report.get("captureId") == plan["captureId"],
             "MIGRATION_SOURCE_REVIEW_CHANGED")
        for record in report["files"]:
            files.verify_file(root, record)
        return report, profile
    fd, temporary = tempfile.mkstemp(prefix=".source-review-", suffix=".sqlite", dir=root)
    os.close(fd)
    os.chmod(temporary, 0o600)
    db = sqlite3.connect(temporary)
    db.execute("PRAGMA journal_mode=DELETE")
    db.executescript("""
      CREATE TABLE issues (id INTEGER PRIMARY KEY, layer_id TEXT NOT NULL, kind TEXT NOT NULL,
                           row_key TEXT, source_position INTEGER, detail_json TEXT NOT NULL);
      CREATE INDEX issues_selection ON issues(layer_id,kind,id);
      CREATE TABLE native_keys (layer_id TEXT, key_name TEXT, key_json TEXT, row_key TEXT,
                                source_position INTEGER, PRIMARY KEY(layer_id,key_name,key_json));
    """)
    count, seen, layer_results = 0, 0, []
    def issue(layer_id, kind, row, detail):
        nonlocal count
        count += 1
        db.execute("INSERT INTO issues VALUES(?,?,?,?,?,?)",
                   (count, layer_id, kind, row["row_key"] if row else None,
                    row["position"] if row else None, files.canonical(detail)))
    source = files.read_catalog(Path(capture["directory"]) / "catalog.sqlite")
    try:
        for decision in plan["pendingDecisions"]:
            if not decision["decision"].strip():
                issue(decision.get("sourceLayerId", ""), "unresolved-decision", None, decision)
        for layer in plan["layers"]:
            layer_id, before, rows_seen = layer["sourceLayerId"], count, 0
            choices = {row["source"]: row for row in layer["fields"]}
            native_fields = {row["sourceName"]: row for row in field_maps[layer_id]["GPKG"]}
            for row in source.execute("SELECT * FROM features WHERE layer_id=? ORDER BY position", (layer_id,)):
                feature = files.parse_json(row["record_json"])["feature"]
                properties = feature.get("properties") or {}
                seen += 1
                rows_seen += 1
                if layer["geometryNulls"] == "reject" and feature.get("geometry") is None:
                    issue(layer_id, "null-geometry", row, {"policy": "reject"})
                for name, choice in choices.items():
                    present, value = name in properties, properties.get(name)
                    if choice["nullPolicy"] == "required" and not present:
                        issue(layer_id, "missing-property", row, {"field": name, "policy": "required"})
                    if choice["nullPolicy"] == "non-null" and (not present or value is None):
                        issue(layer_id, "null-or-missing-property", row,
                              {"field": name, "present": present, "policy": "non-null"})
                    try:
                        mapping.attribute_value(native_fields[name], feature)
                    except (ValueError, OverflowError, TypeError) as exc:
                        issue(layer_id, "native-value-representation", row,
                              {"field": name, "code": getattr(exc, "code", type(exc).__name__),
                               "detail": getattr(exc, "detail", str(exc))})
                for key in layer["keys"]:
                    missing = [name for name in key["fields"] if name not in properties or properties[name] is None]
                    if missing:
                        if key["nulls"] == "reject":
                            issue(layer_id, "incomplete-key", row, {"key": key["name"], "fields": missing})
                            continue
                        if key["nulls"] == "distinct":
                            continue
                    try:
                        values = [_key_value(native_fields[name], feature) for name in key["fields"]]
                    except (ValueError, OverflowError, TypeError) as exc:
                        issue(layer_id, "native-key-representation", row,
                              {"key": key["name"], "code": getattr(exc, "code", type(exc).__name__),
                               "detail": getattr(exc, "detail", str(exc))})
                        continue
                    key_json = files.canonical(values)
                    prior = db.execute("SELECT row_key,source_position FROM native_keys "
                                       "WHERE layer_id=? AND key_name=? AND key_json=?",
                                       (layer_id, key["name"], key_json)).fetchone()
                    if prior:
                        issue(layer_id, "duplicate-key", row, {"key": key["name"], "nativeValuesJson": key_json,
                              "firstRowKey": prior[0], "firstSourcePosition": prior[1]})
                    else:
                        db.execute("INSERT INTO native_keys VALUES(?,?,?,?,?)",
                                   (layer_id, key["name"], key_json, row["row_key"], row["position"]))
                if seen % 1000 == 0:
                    db.commit()
            layer_results.append({"sourceLayerId": layer_id, "table": layer["table"],
                                  "features": rows_seen, "issues": count - before,
                                  "fields": field_maps[layer_id]})
        db.execute("DROP TABLE native_keys")
        db.commit()
        need(db.execute("PRAGMA quick_check").fetchone()[0] == "ok", "MIGRATION_REVIEW_INDEX_INVALID")
    finally:
        source.close()
        db.close()
    catalog = next(item for item in capture["manifest"]["files"] if item["path"] == "catalog.sqlite")
    files.verify_file(capture["directory"], catalog)
    with open(temporary, "rb") as stream:
        os.fsync(stream.fileno())
    os.replace(temporary, path)
    files.fsync_directory(root)
    report = {"schema": AUDIT, "planId": plan_id, "captureId": plan["captureId"],
              "stage": "complete-source-constraints", "features": seen, "issues": count,
              "valid": count == 0, "layers": layer_results, "profile": profile,
              "keySemantics": "Exact destination values under native binary equality; no external database collation is inferred.",
              "nativeExportValidation": "The original exporter verifies every actual output value, geometry and CRS during generation and reopen.",
              "files": [files.file_record(path)]}
    files.atomic_json(root / "source-review.json", report)
    return report, profile
