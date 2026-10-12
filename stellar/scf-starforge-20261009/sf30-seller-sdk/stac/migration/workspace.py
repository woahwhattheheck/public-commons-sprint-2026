# SPDX-License-Identifier: MIT
"""Migration decisions in the original QGIS workspace and mutation journal."""
from __future__ import annotations
import base64
import copy
import hashlib
import json
import os
import sqlite3
from pathlib import Path

from .native import vector, files, model, source_closure, program_files, selection_contract, need
from . import plan as plans

SCHEMA = "starforge.gis-migration-workspace.v1"
EDITION = "starforge.gis-migration-edition.v1"
KINDS = {"captures", "plans", "editions", "projectDeliveries", "reviews", "inputs", "software", "comparisons"}

def _extension(state):
    if "migration" not in state:
        state["migration"] = {"schema": SCHEMA, **{kind: [] for kind in sorted(KINDS)}}
    value = state["migration"]
    need(isinstance(value, dict) and value.get("schema") == SCHEMA,
         "MIGRATION_WORKSPACE_SCHEMA")
    return value

def _find(state, kind, identifier):
    need(kind in KINDS, "MIGRATION_RECORD_KIND", kind)
    return next((row for row in _extension(state)[kind] if row["id"] == identifier), None)

def _page(offset=0, limit=50):
    need(type(offset) is int and 0 <= offset <= 2**63 - 1
         and type(limit) is int and 1 <= limit <= 100, "MIGRATION_PAGE_INVALID")
    return offset, limit

def _original(raw):
    if raw is None:
        return None
    need(isinstance(raw, str), "MIGRATION_ORIGINAL_BASE64_REQUIRED")
    try:
        data = base64.b64decode(raw, validate=True)
        files.parse_json(data)
    except (ValueError, UnicodeError, TypeError) as exc:
        raise ValueError("The imported original JSON is not complete valid UTF-8 JSON.") from exc
    need(len(data) <= 16 * 1024 * 1024, "MIGRATION_ORIGINAL_TOO_LARGE")
    return data

def _reference(prefix, value):
    return {**value, "path": prefix.rstrip("/") + "/" + value["path"]}

class Workspace(model.QgisWorkspace):
    """One native project database; the original requests are replayed before revision checks."""

    @staticmethod
    def _validate_state(state):
        model.QgisWorkspace._validate_state(state)
        from . import cartography
        cartography.validate(state)
        migration = _extension(state)
        for kind in KINDS:
            rows = migration.get(kind)
            need(isinstance(rows, list) and all(isinstance(row, dict) and isinstance(row.get("id"), str)
                 for row in rows), "MIGRATION_STATE_RECORDS", kind)
            need(len({row["id"] for row in rows}) == len(rows), "MIGRATION_STATE_IDENTITY", kind)
            for row in rows:
                for record in row.get("files", []):
                    files.descriptor(record)
                    need(record["path"].startswith("migration/"), "MIGRATION_STATE_FILE_PATH", record["path"])
        captures = {row["id"] for row in migration["captures"]}
        plan_ids = {row["id"] for row in migration["plans"]}
        editions = {row["id"] for row in migration["editions"]}
        for row in migration["plans"]:
            need(row["captureId"] in captures and (row.get("predecessorPlanId") is None
                 or row["predecessorPlanId"] in plan_ids), "MIGRATION_PLAN_SOURCE")
        for row in migration["editions"]:
            need(row["captureId"] in captures and row["planId"] in plan_ids, "MIGRATION_EDITION_SOURCE")
        for row in migration["projectDeliveries"]:
            need(row["editionId"] in editions, "MIGRATION_PROJECT_EDITION")
        for row in migration["comparisons"]:
            need(row["beforeCaptureId"] in captures and row["afterCaptureId"] in captures,
                 "MIGRATION_COMPARISON_SOURCE")

    def _path(self, relative):
        return model.member(self.root, relative, existing=False)

    def _put(self, relative, body):
        return model.retain_bytes(self.root, relative, body)

    def _put_json(self, relative, value):
        return self._put(relative, files.json_bytes(value))

    def _input(self, state, raw, kind, request_id, normalized):
        if raw is None:
            raw = files.json_bytes(normalized)
            imported = False
        else:
            imported = True
        sha = files.digest(raw)
        path = "migration/inputs/" + sha + ".json"
        record = self._put(path, raw)
        row = _find(state, "inputs", sha)
        if row is None:
            row = {"id": sha, "kind": kind, "file": record, "files": [record]}
            _extension(state)["inputs"].append(row)
        return {**copy.deepcopy(row), "requestId": request_id, "imported": imported,
                "edited": files.canonical(files.parse_json(raw)) != files.canonical(normalized)}

    def _retain_software(self, state):
        selected = program_files()
        descriptors = [{"path": name, "bytes": len(raw), "sha256": files.digest(raw)}
                       for name, raw in selected]
        identifier = files.digest(descriptors)
        existing = _find(state, "software", identifier)
        if existing is not None:
            return existing
        prefix = "migration/software/" + identifier + "/stac/"
        records = [self._put(prefix + name, raw) for name, raw in selected]
        value = {"id": identifier, "path": prefix.rstrip("/"),
                 "source": {"schema": "starforge.gis-migration-native-source.v1", "files": descriptors},
                 "createdAt": model.utc_now(), "files": records}
        _extension(state)["software"].append(value)
        return value

    def _metadata(self, kind, identifier, *, state=None):
        row = _find(state if state is not None else self.read(), kind, identifier)
        need(row is not None, "MIGRATION_RECORD_NOT_FOUND", {"kind": kind, "id": identifier})
        return row

    def summary(self):
        state = self.read()
        migration = _extension(state)
        return {"id": state["id"], "title": state["title"], "revision": state["revision"],
                "createdAt": state["createdAt"], "schema": SCHEMA,
                "counts": {kind: len(migration[kind]) for kind in sorted(KINDS)},
                "nativeProjectCount": len(state["projects"]), "nativeSourceCount": len(state["sources"]),
                "nativeSource": source_closure()}

    def records(self, kind, *, offset=0, limit=50):
        offset, limit = _page(offset, limit)
        state = self.read()
        need(kind in KINDS, "MIGRATION_RECORD_KIND", kind)
        rows = list(reversed(_extension(state)[kind]))
        return {"workspaceId": state["id"], "revision": state["revision"], "kind": kind,
                "offset": offset, "limit": limit, "total": len(rows),
                "rows": rows[offset:offset + limit], "hasMore": offset + limit < len(rows)}

    def document(self, kind, identifier):
        kinds = {"capture": "captures", "plan": "plans", "edition": "editions",
                 "project-delivery": "projectDeliveries", "review": "reviews", "input": "inputs",
                 "comparison": "comparisons", "software": "software"}
        kind = kinds.get(kind, kind)
        row = self._metadata(kind, identifier)
        for record in row.get("files", []):
            files.verify_file(self.root, record)
        if kind == "captures":
            captured = vector.open_capture(self._path(row["path"]), identifier)
            return {**captured, "id": identifier, "path": row["path"], "record": row}
        if kind == "plans":
            body = files.read_json(self._path(row["file"]["path"]))
            need(files.digest(body) == identifier, "MIGRATION_PLAN_CHANGED")
            report = files.read_json(self._path(row["reviewFile"]["path"]))
            return {"id": identifier, "plan": body, "review": report, "record": row}
        if kind == "editions":
            body = files.read_json(self._path(row["file"]["path"]))
            need(body.get("id") == identifier and body.get("planId") == row["planId"]
                 and body.get("captureId") == row["captureId"], "MIGRATION_EDITION_CHANGED")
            return body
        if kind == "comparisons":
            return vector.open_comparison(self._path(row["path"]), row["manifestSha256"])
        if kind == "inputs":
            return {**row, "content": self._path(row["file"]["path"]).read_text(encoding="utf-8-sig"),
                    "contentBase64": base64.b64encode(self._path(row["file"]["path"]).read_bytes()).decode("ascii")}
        return row

    def _register_capture(self, state, captured, relative, source_input=None):
        manifest, descriptor = captured["manifest"], captured["manifestFile"]
        identifier = descriptor["sha256"]
        existing = _find(state, "captures", identifier)
        if existing is not None:
            need(existing["path"] == relative, "MIGRATION_CAPTURE_LOCATION_CHANGED")
            return existing
        row = {"id": identifier, "path": relative, "manifestFile": _reference(relative, descriptor),
               "selectionId": manifest["selection"]["id"], "selectionSha256": manifest["selectionSha256"],
               "sourceEditionJson": files.canonical(manifest["selection"]["sourceEdition"]),
               "counts": manifest["counts"], "createdAt": model.utc_now(),
               "files": [_reference(relative, item) for item in manifest["files"] + [descriptor]]}
        if source_input is not None:
            row["inputId"] = source_input["id"]
        _extension(state)["captures"].append(row)
        return row

    def capture(self, selection, source_root, *, revision, request_id, actor, original_base64=None):
        original = _original(original_base64)
        selection = selection_contract(files.parse_json(files.canonical(selection)))
        source_root = str(Path(source_root).expanduser().resolve())
        payload = {"selectionJson": files.canonical(selection), "sourceRoot": source_root,
                   "originalBase64": original_base64}
        def update(state):
            relative = "migration/captures/" + files.digest(selection)
            captured = vector.capture_selection(selection, source_root, self._path(relative))
            source_input = self._input(state, original, "selection", request_id, selection)
            record = self._register_capture(state, captured, relative, source_input)
            software = self._retain_software(state)
            return {"capture": copy.deepcopy(record), "input": source_input, "softwareId": software["id"]}
        return self._mutate(revision, request_id, actor, "migration.capture", payload, update)

    def receive_capture(self, source_directory, expected_manifest_sha256, *, revision, request_id, actor):
        source_directory = str(Path(source_directory).expanduser().resolve())
        payload = {"directory": source_directory, "manifestSha256": expected_manifest_sha256}
        def update(state):
            captured = vector.open_capture(source_directory, expected_manifest_sha256)
            relative = "migration/captures/" + files.digest(captured["manifest"]["selection"])
            files.clone_capture(source_directory, self._path(relative), captured["manifestFile"]["sha256"])
            reopened = vector.open_capture(self._path(relative), captured["manifestFile"]["sha256"])
            record = self._register_capture(state, reopened, relative)
            software = self._retain_software(state)
            return {"capture": copy.deepcopy(record), "softwareId": software["id"]}
        return self._mutate(revision, request_id, actor, "migration.capture-received", payload, update)

    def draft(self, capture_id, predecessor_plan_id=None):
        capture = self.document("capture", capture_id)
        if predecessor_plan_id:
            previous = self.document("plan", predecessor_plan_id)["plan"]
            return plans.rebase_plan(previous, capture)
        return plans.default_plan(capture)

    def save_plan(self, value, *, revision, request_id, actor, original_base64=None):
        value = files.parse_json(files.canonical(value))
        original = _original(original_base64)
        payload = {"planJson": files.canonical(value), "originalBase64": original_base64}
        def update(state):
            capture_id = value.get("captureId") if isinstance(value, dict) else None
            capture_row = self._metadata("captures", capture_id, state=state)
            captured = vector.open_capture(self._path(capture_row["path"]), capture_id)
            plan, _, _ = plans.normalize(value, captured)
            if plan.get("predecessorPlanId"):
                self._metadata("plans", plan["predecessorPlanId"], state=state)
            identifier = files.digest(plan)
            prior = _find(state, "plans", identifier)
            source_input = self._input(state, original, "plan", request_id, plan)
            software = self._retain_software(state)
            if prior is not None:
                return {"plan": copy.deepcopy(prior), "existing": True, "input": source_input}
            relative = "migration/plans/" + identifier
            plan_file = self._put_json(relative + "/plan.json", plan)
            report, profile = plans.audit(captured, plan, self._path(relative))
            review_file = files.file_record(self._path(relative + "/source-review.json"), relative + "/source-review.json")
            profile_file = self._put_json(relative + "/native-profile.json", profile)
            closure = self._put_json(relative + "/native-source.json", source_closure())
            records = [plan_file, review_file, profile_file, closure]
            records.extend(_reference(relative, row) for row in report["files"])
            row = {"id": identifier, "title": plan["title"], "captureId": capture_id,
                   "predecessorPlanId": plan.get("predecessorPlanId"),
                   "file": plan_file, "reviewFile": review_file, "profileFile": profile_file,
                   "inputId": source_input["id"], "input": source_input, "softwareId": software["id"],
                   "valid": report["valid"], "issues": report["issues"],
                   "features": report["features"], "createdAt": model.utc_now(), "files": records}
            _extension(state)["plans"].append(row)
            return {"plan": copy.deepcopy(row)}
        return self._mutate(revision, request_id, actor, "migration.plan-saved", payload, update)

    def review_plan(self, plan_id, outcome, note, *, revision, request_id, actor):
        need(outcome in ("accepted", "changes-requested"), "MIGRATION_REVIEW_OUTCOME")
        need(isinstance(note, str) and bool(note.strip()) and len(note) <= 5000, "MIGRATION_REVIEW_NOTE_REQUIRED")
        payload = {"planId": plan_id, "outcome": outcome, "note": note}
        def update(state):
            row = self._metadata("plans", plan_id, state=state)
            need(outcome != "accepted" or row["valid"], "MIGRATION_SOURCE_CONSTRAINTS_NEED_CORRECTION")
            identifier = files.digest({"workspaceId": state["id"], "requestId": request_id, "action": "plan-review"})
            result = {"id": identifier, **payload, "planFile": row["file"], "at": model.utc_now(), "actor": actor}
            _extension(state)["reviews"].append(result)
            return {"review": copy.deepcopy(result)}
        return self._mutate(revision, request_id, actor, "migration.plan-reviewed", payload, update)

    def build_edition(self, plan_id, *, revision, request_id, actor):
        payload = {"planId": plan_id}
        def update(state):
            plan_row = self._metadata("plans", plan_id, state=state)
            for record in plan_row["files"]:
                files.verify_file(self.root, record)
            need(plan_row["valid"], "MIGRATION_SOURCE_CONSTRAINTS_NEED_CORRECTION", plan_row["issues"])
            plan = files.read_json(self._path(plan_row["file"]["path"]))
            need(files.digest(plan) == plan_id, "MIGRATION_PLAN_CHANGED")
            capture = self._metadata("captures", plan["captureId"], state=state)
            profile = files.read_json(self._path(plan_row["profileFile"]["path"]))
            identifier = files.digest({"workspaceId": state["id"], "planId": plan_id, "requestId": request_id})
            relative = "migration/editions/" + identifier
            vector_path = relative + "/vector"
            built = vector.export_capture(self._path(capture["path"]), self._path(vector_path),
                                          profile, "migration-" + identifier[:48])
            verified = vector.open_vector_export(self._path(vector_path), built["manifestFile"]["sha256"], native=True)
            software = self._retain_software(state)
            edition = {"schema": EDITION, "id": identifier, "planId": plan_id, "captureId": plan["captureId"],
                       "vector": {"path": vector_path, "manifestSha256": built["manifestFile"]["sha256"],
                                  "manifest": built["manifest"]},
                       "projectDefinitions": plan["projectDefinitions"], "nativeSource": software["source"], "softwareId": software["id"],
                       "nativeReceiving": verified["receiving"]}
            edition_file = self._put_json(relative + "/edition.json", edition)
            destination = {"schema": "starforge.gis-migration-postgis-handover.v1",
                           "editionId": identifier, "planId": plan_id, "schemaName": plan["postgisSchema"],
                           "sourceManifestSha256": built["manifestFile"]["sha256"],
                           "sourceGeoPackage": vector_path + "/native/data.gpkg",
                           "layers": [{"sourceLayerId": row["sourceLayerId"], "table": row["layer"],
                                       "fields": row["fields"], "crsWkt": row["crsWkt"],
                                       "geometry": row["geometry"], "features": row["featureCount"],
                                       "keys": next(p["keys"] for p in plan["layers"] if p["sourceLayerId"] == row["sourceLayerId"])}
                                      for row in built["manifest"]["native"]["layers"] if row["driver"] == "GPKG"],
                           "sourceConstraintReview": plan_row["reviewFile"],
                           "status": "prepared-native-geopackage-for-selected-postgis-import"}
            destination_file = self._put_json(relative + "/postgis-handover.json", destination)
            row = {"id": identifier, "title": plan["title"], "planId": plan_id, "captureId": plan["captureId"],
                   "file": edition_file, "destinationFile": destination_file,
                   "vectorManifestSha256": built["manifestFile"]["sha256"], "vectorPath": vector_path,
                   "counts": built["manifest"]["counts"], "createdAt": model.utc_now(),
                   "files": [edition_file, destination_file] +
                            [_reference(vector_path, item) for item in built["manifest"]["files"] + [built["manifestFile"]]]}
            _extension(state)["editions"].append(row)
            return {"edition": copy.deepcopy(row)}
        return self._mutate(revision, request_id, actor, "migration.edition-built", payload, update)

    def record_project_delivery(self, edition_id, result, *, revision, request_id, actor):
        result = files.parse_json(files.canonical(result))
        need(isinstance(result, dict) and isinstance(result.get("projects"), list) and result["projects"],
             "MIGRATION_PROJECT_RESULT_REQUIRED")
        payload = {"editionId": edition_id, "resultJson": files.canonical(result)}
        def update(state):
            edition = self._metadata("editions", edition_id, state=state)
            files.verify_file(self.root, edition["file"])
            document = files.read_json(self._path(edition["file"]["path"]))
            definitions = {row["id"]: row for row in document["projectDefinitions"]}
            actual_definition_ids = [row.get("definitionId") for row in result["projects"]]
            need(len(actual_definition_ids) == len(set(actual_definition_ids)) and
                 set(actual_definition_ids) == set(definitions), "MIGRATION_COMPLETE_PROJECT_RESULTS_REQUIRED")
            projects = {row["id"]: row for row in state["projects"]}
            selected = []
            for value in result["projects"]:
                definition = definitions[value["definitionId"]]
                project_id = value.get("projectId")
                need(project_id in projects, "MIGRATION_NATIVE_PROJECT_NOT_RETAINED", project_id)
                project = projects[project_id]
                native_inputs = [row for row in project.get("derivedFiles", [])
                                 if row["path"].endswith("/native-input.json")]
                need(len(native_inputs) == 1, "MIGRATION_NATIVE_PROJECT_INPUT_REQUIRED", project_id)
                native_input = native_inputs[0]
                files.verify_file(self.root, native_input)
                original_input, _ = model.read_json(self._path(native_input["path"]))
                need(model.value_sha(original_input) == project["inputSha256"] and
                     original_input.get("workspaceId") == state["id"] and
                     original_input.get("projectCrs") == definition.get("projectCrs"),
                     "MIGRATION_NATIVE_PROJECT_INPUT_CHANGED", project_id)
                need(project["sourceIds"] == [edition["vectorManifestSha256"]],
                     "MIGRATION_NATIVE_PROJECT_SOURCE_CHANGED", project_id)
                expected = {(row["sourceId"], row["sourceLayerId"], row["id"])
                            for row in document["vector"]["manifest"]["native"]["layers"]
                            if row["driver"] == definition["format"] and
                            row["sourceLayerId"] in definition["sourceLayerIds"]}
                actual = {(row.get("collection"), row.get("itemId"), row.get("assetKey"))
                          for row in project["layers"]}
                need(actual == expected and len(project["layers"]) == len(expected) and
                     all(row.get("sourceId") == edition["vectorManifestSha256"] for row in project["layers"]),
                     "MIGRATION_NATIVE_PROJECT_SELECTION_CHANGED", project_id)
                selected.append({"definitionId": value["definitionId"], "deliveryTitle": definition["title"],
                                 "nativeTitlePolicy": "original-workspace-title", "projectId": project_id,
                                 "file": project["file"], "nativeInput": native_input,
                                 "sourceIds": project["sourceIds"], "inputSha256": project["inputSha256"]})
            need(len({row["projectId"] for row in selected}) == len(selected),
                 "MIGRATION_DUPLICATE_PROJECT_RESULT")
            identifier = files.digest({"editionId": edition_id, "requestId": request_id})
            software = self._retain_software(state)
            retained = self._put_json("migration/project-deliveries/" + identifier + ".json", result)
            row = {"id": identifier, "editionId": edition_id, "projects": selected,
                   "resultFile": retained, "softwareId": software["id"], "at": model.utc_now(), "actor": actor, "files": [retained]}
            _extension(state)["projectDeliveries"].append(row)
            return {"delivery": copy.deepcopy(row)}
        return self._mutate(revision, request_id, actor, "migration.projects-delivered", payload, update)

    def migration_files(self, snapshot=None):
        snapshot = snapshot or self.snapshot()
        state = snapshot["state"]
        records = {}
        for kind in KINDS:
            for row in _extension(state)[kind]:
                for record in row.get("files", []):
                    value = files.descriptor(record)
                    need(value["path"].startswith("migration/"), "MIGRATION_FILE_PATH")
                    previous = records.get(value["path"])
                    need(previous is None or previous == value, "MIGRATION_FILE_IDENTITY_CONFLICT", value["path"])
                    records[value["path"]] = value
        from . import cartography
        for item in cartography.files(snapshot):
            value = files.descriptor(item)
            need(value["path"].startswith("migration/"), "MIGRATION_FILE_PATH")
            previous = records.get(value["path"])
            need(previous is None or previous == value, "MIGRATION_FILE_IDENTITY_CONFLICT", value["path"])
            records[value["path"]] = value
        return [records[name] for name in sorted(records)]

    def project_files(self, snapshot=None):
        snapshot = snapshot or self.snapshot()
        records = {row["path"]: row for row in super().project_files(snapshot)}
        for row in self.migration_files(snapshot):
            need(row["path"] not in records or records[row["path"]] == row,
                 "MIGRATION_FILE_IDENTITY_CONFLICT", row["path"])
            records[row["path"]] = row
        return [records[name] for name in sorted(records)]

    def verify_migration(self):
        snapshot = self.snapshot()
        self._validate_state(snapshot["state"])
        for record in self.migration_files(snapshot):
            files.verify_file(self.root, record)
        for row in _extension(snapshot["state"])["captures"]:
            vector.open_capture(self._path(row["path"]), row["id"])
        for row in _extension(snapshot["state"])["plans"]:
            body = files.read_json(self._path(row["file"]["path"]))
            need(files.digest(body) == row["id"] and body["captureId"] == row["captureId"],
                 "MIGRATION_PLAN_CHANGED")
        for row in _extension(snapshot["state"])["editions"]:
            document = self.document("edition", row["id"])
            need(document["vector"]["path"] == row["vectorPath"] and
                 document["vector"]["manifestSha256"] == row["vectorManifestSha256"],
                 "MIGRATION_EDITION_SOURCE_CHANGED")
            actual = vector.open_vector_export(self._path(row["vectorPath"]), row["vectorManifestSha256"], native=False)
            need(files.canonical(actual["manifest"]) == files.canonical(document["vector"]["manifest"]),
                 "MIGRATION_EDITION_MANIFEST_CHANGED")
        return {"workspaceId": snapshot["state"]["id"], "revision": snapshot["state"]["revision"],
                "files": len(self.migration_files(snapshot)), "counts": self.summary()["counts"],
                "verified": True}

    def source_rows(self, capture_id, layer_id, *, offset=0, limit=50):
        offset, limit = _page(offset, limit)
        row = self._metadata("captures", capture_id)
        record = next((item for item in row["files"] if item["path"] == row["path"] + "/catalog.sqlite"), None)
        need(record is not None, "MIGRATION_CAPTURE_INDEX_REQUIRED")
        files.verify_file(self.root, record)
        db = files.read_catalog(self._path(record["path"]))
        try:
            exists = db.execute("SELECT 1 FROM layers WHERE id=?", (layer_id,)).fetchone()
            need(exists is not None, "MIGRATION_SOURCE_LAYER_NOT_FOUND", layer_id)
            total = db.execute("SELECT count(*) FROM features WHERE layer_id=?", (layer_id,)).fetchone()[0]
            rows = db.execute("SELECT * FROM features WHERE layer_id=? ORDER BY position LIMIT ? OFFSET ?",
                              (layer_id, limit, offset)).fetchall()
            return {"captureId": capture_id, "layerId": layer_id, "catalogSha256": record["sha256"],
                    "offset": offset, "limit": limit, "total": total, "hasMore": offset + limit < total,
                    "rows": [{"rowKey": r["row_key"], "position": r["position"],
                              "identityJson": r["identity_json"], "occurrence": r["occurrence"],
                              "recordJson": r["record_json"], "geometrySha256": r["geometry_sha256"],
                              "propertiesSha256": r["properties_sha256"]} for r in rows]}
        finally:
            db.close()

    def issues(self, plan_id, *, offset=0, limit=50, layer_id=None, kind=None):
        offset, limit = _page(offset, limit)
        row = self._metadata("plans", plan_id)
        record = next((item for item in row["files"] if item["path"].endswith("/source-review.sqlite")), None)
        need(record is not None, "MIGRATION_REVIEW_INDEX_REQUIRED")
        files.verify_file(self.root, record)
        db = files.read_catalog(self._path(record["path"]))
        clauses, parameters = [], []
        for field, value in (("layer_id", layer_id), ("kind", kind)):
            if value is not None:
                need(isinstance(value, str), "MIGRATION_FILTER_INVALID")
                clauses.append(field + "=?")
                parameters.append(value)
        where = " WHERE " + " AND ".join(clauses) if clauses else ""
        try:
            total = db.execute("SELECT count(*) FROM issues" + where, parameters).fetchone()[0]
            rows = db.execute("SELECT * FROM issues" + where + " ORDER BY id LIMIT ? OFFSET ?",
                              parameters + [limit, offset]).fetchall()
            return {"planId": plan_id, "offset": offset, "limit": limit, "total": total,
                    "hasMore": offset + limit < total,
                    "rows": [{"id": r["id"], "layerId": r["layer_id"], "kind": r["kind"],
                              "rowKey": r["row_key"], "sourcePosition": r["source_position"],
                              "detailJson": r["detail_json"]} for r in rows]}
        finally:
            db.close()

    def compare_captures(self, before_capture_id, after_capture_id, *, revision, request_id, actor):
        need(before_capture_id != after_capture_id, "MIGRATION_DIFFERENT_CAPTURES_REQUIRED")
        payload = {"beforeCaptureId": before_capture_id, "afterCaptureId": after_capture_id}
        def update(state):
            before = self._metadata("captures", before_capture_id, state=state)
            after = self._metadata("captures", after_capture_id, state=state)
            identifier = files.digest(payload)
            prior = _find(state, "comparisons", identifier)
            if prior is not None:
                for record in prior["files"]:
                    files.verify_file(self.root, record)
                return {"comparison": copy.deepcopy(prior), "existing": True}
            relative = "migration/comparisons/" + identifier
            result = vector.compare_captures(self._path(before["path"]), self._path(after["path"]),
                self._path(relative), "migration-compare-" + identifier[:40],
                before_capture_id, after_capture_id)
            vector.open_comparison(self._path(relative), result["manifestFile"]["sha256"])
            manifest = result["manifest"]
            row = {"id": identifier, **payload, "path": relative,
                   "manifestSha256": result["manifestFile"]["sha256"],
                   "manifestFile": _reference(relative, result["manifestFile"]),
                   "createdAt": model.utc_now(),
                   "files": [_reference(relative, item) for item in manifest["files"] + [result["manifestFile"]]]}
            _extension(state)["comparisons"].append(row)
            return {"comparison": copy.deepcopy(row)}
        return self._mutate(revision, request_id, actor, "migration.captures-compared", payload, update)

    def comparison_rows(self, comparison_id, *, offset=0, limit=50, layer_id=None, status=None):
        _page(offset, limit)
        row = self._metadata("comparisons", comparison_id)
        return vector.comparison_page(self._path(row["path"]), offset, limit, layer_id, status, row["manifestSha256"])

    def history_page(self, *, offset=0, limit=50):
        offset, limit = _page(offset, limit)
        with self._connect() as db:
            db.execute("BEGIN")
            total = db.execute("SELECT count(*) FROM events").fetchone()[0]
            rows = [json.loads(r[0]) for r in db.execute(
                "SELECT body FROM events ORDER BY revision DESC LIMIT ? OFFSET ?", (limit, offset))]
        return {"offset": offset, "limit": limit, "total": total, "hasMore": offset + limit < total, "rows": rows}
