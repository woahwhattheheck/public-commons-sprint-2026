"""Transactional native Audit Exchange workspace, saved editions and receiving."""
from __future__ import annotations
import base64
import copy
import fcntl
import json
import os
import sqlite3
import tempfile
import threading
import uuid
import re
from contextlib import contextmanager
from pathlib import Path
from urllib.parse import urlparse

from common import AuditError, canonical, decode64, digest, key, now, require, text
from model import analysis_selection, asset_catalog, compare_models, patch_document, validate_document
from exchange import (APPLICATION_ROOT, SNAPSHOT_FORMAT, application_members, package_bytes,
                      projection, projection_package, review_html, unpack_package)

READ_ACTIONS = {"workspace.get", "source.get", "edition.get", "source.compare", "export.get",
                "analysis.preview", "projection.preview", "source.page", "source.bytes", "export.read", "operation.get"}
WRITE_ACTIONS = {"source.import", "source.replace", "source.patch", "source.validate", "edition.save",
                 "review.save", "link.save", "projection.save", "analysis.run", "analysis.resume", "export.create", "workspace.receive"}
APPLICATION_ID = 1096107080

def identifier(prefix):
    return prefix + "-" + uuid.uuid4().hex

def summary_input(value):
    if isinstance(value, dict):
        result = {}
        for name, item in value.items():
            if name.endswith("Base64") and isinstance(item, str):
                raw = decode64(item, maximum=1024 * 1024 * 1024)
                result[name] = {"sha256": digest(raw), "bytes": len(raw), "encoding": "retained binary object"}
            else:
                result[name] = summary_input(item)
        return result
    if isinstance(value, list):
        return [summary_input(item) for item in value]
    return value

class Workspace:
    def __init__(self, directory, name="Audit Exchange workspace"):
        self.directory = Path(directory).expanduser().resolve()
        require(self.directory != APPLICATION_ROOT and APPLICATION_ROOT not in self.directory.parents,
                "workspace_directory", "Choose a working project directory outside the installed application source")
        self.directory.mkdir(mode=0o700, parents=True, exist_ok=True)
        self.database = self.directory / "audit-exchange.sqlite"
        require(not self.database.is_symlink(), "workspace_database", "The workspace database must be an ordinary local file")
        self._wake = threading.Event()
        self._stop = threading.Event()
        self._worker = None
        with self.connect() as db:
            db.execute("BEGIN IMMEDIATE")
            application_id = db.execute("PRAGMA application_id").fetchone()[0]
            tables = [r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")]
            require(application_id in (0, APPLICATION_ID) and (application_id == APPLICATION_ID or not tables),
                    "workspace_database", "The selected database belongs to another application")
            db.execute("CREATE TABLE IF NOT EXISTS meta (name TEXT PRIMARY KEY, value TEXT NOT NULL)")
            db.execute("CREATE TABLE IF NOT EXISTS records (kind TEXT NOT NULL, id TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(kind,id))")
            db.execute("CREATE TABLE IF NOT EXISTS objects (sha256 TEXT PRIMARY KEY, bytes BLOB NOT NULL)")
            db.execute("CREATE TABLE IF NOT EXISTS requests (id TEXT PRIMARY KEY, action TEXT NOT NULL, envelope_sha256 TEXT NOT NULL, input_record TEXT NOT NULL, result TEXT NOT NULL, version INTEGER NOT NULL, created_at TEXT NOT NULL)")
            db.execute("PRAGMA application_id=" + str(APPLICATION_ID))
            db.execute("PRAGMA user_version=1")
            if not db.execute("SELECT 1 FROM meta WHERE name='workspace'").fetchone():
                db.execute("INSERT INTO meta VALUES('workspace',?)", (canonical({
                    "format": "commons.audit-exchange.workspace.v1", "workspaceId": identifier("workspace"),
                    "name": text(name, "name", blank=False), "version": 0, "createdAt": now()}),))
            db.commit()

    @contextmanager
    def connect(self):
        db = sqlite3.connect(self.database, timeout=30, isolation_level=None)
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA synchronous=FULL")
        db.execute("PRAGMA busy_timeout=30000")
        try:
            with db:
                yield db
        finally:
            db.close()

    def _meta(self, db):
        return json.loads(db.execute("SELECT value FROM meta WHERE name='workspace'").fetchone()[0])

    def _all(self, db, kind):
        return [json.loads(row[0]) for row in db.execute("SELECT payload FROM records WHERE kind=? ORDER BY rowid", (kind,))]

    def _get(self, db, kind, identity):
        text(identity, kind + "Id", blank=False)
        row = db.execute("SELECT payload FROM records WHERE kind=? AND id=?", (kind, identity)).fetchone()
        require(row is not None, "not_found", "The selected " + kind + " does not exist in this workspace", {"id": identity}, 404)
        return json.loads(row[0])

    def _put(self, db, kind, value):
        db.execute("INSERT INTO records(kind,id,payload) VALUES(?,?,?) ON CONFLICT(kind,id) DO UPDATE SET payload=excluded.payload",
                   (kind, value["id"], canonical(value)))

    def _object(self, db, raw):
        identity = digest(raw)
        db.execute("INSERT OR IGNORE INTO objects(sha256,bytes) VALUES(?,?)", (identity, sqlite3.Binary(raw)))
        return identity

    def _bytes(self, db, sha):
        row = db.execute("SELECT bytes FROM objects WHERE sha256=?", (sha,)).fetchone()
        require(row is not None, "missing_object", "A retained source object is unavailable", {"sha256": sha})
        raw = bytes(row[0])
        require(digest(raw) == sha, "object_changed", "A retained source object differs from its identity")
        return raw

    def _revision_summary(self, revision):
        return {name: revision[name] for name in (
            "id", "number", "parentId", "sha256", "bytes", "createdAt", "actor", "note",
            "selectedSchema", "profileIds", "declaredVersion")}

    def _source_summary(self, db, source, revision=None):
        revision = revision or self._get(db, "revision", source["currentRevisionId"])
        validation = copy.deepcopy(revision["validation"])
        for profile in validation["profiles"]:
            profile.pop("svrl", None)
        return {**{k: v for k, v in source.items() if k != "nativeIdentity"},
                "revisionNumber": revision["number"], "declaredVersion": revision["declaredVersion"],
                "selectedSchema": revision["selectedSchema"], "profileIds": revision["profileIds"],
                "counts": revision["model"]["counts"], "validation": validation}

    def _state(self, db):
        result = self._meta(db)
        result["sources"] = [self._source_summary(db, source) for source in self._all(db, "source")]
        result["editions"] = [{key: value for key, value in edition.items() if key in (
            "id", "number", "name", "note", "actor", "createdAt", "version", "sources")} for edition in self._all(db, "edition")]
        for field, kind in (("reviews", "review"), ("links", "link"), ("analysisRuns", "analysis"), ("exports", "export")):
            result[field] = self._all(db, kind)
        for analysis in result["analysisRuns"]:
            selection = analysis.get("selection", {})
            analysis["selectionSummary"] = {name: value for name, value in selection.items() if name not in {"readings", "sourceXmlPath"}}
            analysis["readingCount"] = len(selection.get("readings", []))
            for name in ("selection", "weatherSha256"):
                analysis.pop(name, None)
        catalogue = asset_catalog()
        result["standards"] = {"schemas": [{"id": "2.7.0", "version": "2.7.0", "label": "BuildingSync 2.7.0"}],
            "profiles": [{"id": p["id"], "label": p["id"].replace("-", " ").upper()} for p in catalogue["useCases"]],
            "licenses": [{"path": "standards/BUILDINGSYNC_LICENSE.txt", "label": "Original BuildingSync notice"}]}
        return result

    def state(self):
        with self.connect() as db:
            db.execute("BEGIN")
            return self._state(db)

    def _detail(self, db, source_id, revision_id=None):
        source = self._get(db, "source", source_id)
        revision = self._get(db, "revision", revision_id or source["currentRevisionId"])
        require(revision["sourceId"] == source_id, "revision_source", "The selected revision belongs to another source")
        raw = self._bytes(db, revision["sha256"])
        encoding = revision["model"].get("encoding") or "UTF-8"
        try:
            xml_text = raw.decode(encoding)
        except (UnicodeError, LookupError):
            xml_text = raw.decode("utf-8", errors="replace")
        revisions = [self._revision_summary(r) for r in self._all(db, "revision") if r["sourceId"] == source_id]
        revisions.sort(key=lambda r: r["number"])
        return {"source": self._source_summary(db, source, revision), "revision": self._revision_summary(revision),
                "revisions": revisions, "xmlText": xml_text, "model": revision["model"], "validation": revision["validation"]}

    def _bump(self, db):
        meta = self._meta(db)
        meta["version"] += 1
        db.execute("UPDATE meta SET value=? WHERE name='workspace'", (canonical(meta),))
        return meta["version"]

    def perform(self, envelope):
        require(isinstance(envelope, dict), "invalid_request", "A native action request must be an object")
        action = text(envelope.get("action"), "action", blank=False)
        inputs = envelope.get("inputs", {})
        require(isinstance(inputs, dict), "invalid_input", "Action inputs must be an object")
        require(action in READ_ACTIONS | WRITE_ACTIONS, "unknown_action", "The native action is unknown")
        with self.connect() as db:
            if action in READ_ACTIONS:
                db.execute("BEGIN")
                return {"ok": True, "result": self._read(db, action, inputs)}
            request_id = text(envelope.get("requestId"), "requestId", blank=False)
            try:
                uuid.UUID(request_id)
            except (ValueError, AttributeError) as error:
                raise AuditError("invalid_request_id", "A mutation requires its original UUID request identifier") from error
            expected = envelope.get("expectedVersion")
            require(isinstance(expected, int) and not isinstance(expected, bool) and expected >= 0,
                    "invalid_version", "Supply the original workspace version with the mutation")
            input_sha = digest(canonical({"action": action, "inputs": inputs, "expectedVersion": expected}).encode())
            db.execute("BEGIN IMMEDIATE")
            prior = db.execute("SELECT envelope_sha256,result FROM requests WHERE id=?", (request_id,)).fetchone()
            if prior:
                require(prior["envelope_sha256"] == input_sha, "request_reused", "This request UUID already names different original inputs", status=409)
                result = json.loads(prior["result"])
                state = self._state(db)
                db.rollback()
                return {"ok": True, "result": result, "state": state, "replayed": True}
            require(self._meta(db)["version"] == expected, "workspace_changed",
                    "The workspace has changed; review its current version before saving", {"currentVersion": self._meta(db)["version"]}, 409)
            actor = text(inputs.get("actor"), "actor", blank=False)
            text(inputs.get("note", ""), "note")
            try:
                result = self._write(db, action, inputs)
                version = self._bump(db)
                db.execute("INSERT INTO requests VALUES(?,?,?,?,?,?,?)",
                           (request_id, action, input_sha, canonical(summary_input(inputs)), canonical(result), version, now()))
                state = self._state(db)
                db.commit()
            except BaseException:
                db.rollback()
                raise
        if action in {"analysis.run", "analysis.resume"}:
            self._wake.set()
        return {"ok": True, "result": result, "state": state}

    def _read(self, db, action, inputs):
        if action == "workspace.get":
            return self._state(db)
        if action == "source.get":
            return self._detail(db, inputs.get("sourceId"), inputs.get("revisionId"))
        if action == "edition.get":
            return self._get(db, "edition", inputs.get("editionId"))
        if action == "export.get":
            return self._get(db, "export", inputs.get("exportId"))
        if action == "operation.get":
            request_id = text(inputs.get("requestId"), "requestId", blank=False)
            row = db.execute("SELECT id,action,result,version,created_at FROM requests WHERE id=?", (request_id,)).fetchone()
            require(row is not None, "not_found", "This original mutation has no saved outcome in this workspace", status=404)
            return {"requestId": row["id"], "action": row["action"], "result": json.loads(row["result"]),
                    "version": row["version"], "createdAt": row["created_at"]}
        if action in {"source.bytes", "export.read"}:
            if action == "source.bytes":
                detail = self._detail(db, inputs.get("sourceId"), inputs.get("revisionId"))
                record = detail["revision"]
            else:
                record = self._get(db, "export", inputs.get("exportId"))
            raw = self._bytes(db, record["sha256"])
            offset, length = inputs.get("offset", 0), inputs.get("length", 1024 * 1024)
            require(type(offset) is int and 0 <= offset <= len(raw) and type(length) is int and 0 < length <= 4 * 1024 * 1024,
                    "byte_range", "Choose an original byte offset and at most 4 MiB")
            end = min(len(raw), offset + length)
            return {"id": record["id"], "sha256": record["sha256"], "bytes": len(raw), "offset": offset,
                    "length": end - offset, "nextOffset": end if end < len(raw) else None, "complete": end == len(raw),
                    "contentBase64": base64.b64encode(raw[offset:end]).decode("ascii")}
        if action == "source.page":
            detail = self._detail(db, inputs.get("sourceId"), inputs.get("revisionId"))
            section = inputs.get("section")
            require(section in {"entities", "fields", "references", "timeSeries", "diagnostics"},
                    "source_section", "Choose a complete native model list")
            rows = detail["model"][section]
            offset, limit = inputs.get("offset", 0), inputs.get("limit", 100)
            require(type(offset) is int and 0 <= offset <= len(rows) and type(limit) is int and 1 <= limit <= 500,
                    "source_page", "Choose an original row offset and at most 500 records")
            end = min(len(rows), offset + limit)
            return {"sourceId": detail["source"]["id"], "revisionId": detail["revision"]["id"],
                    "sha256": detail["revision"]["sha256"], "section": section, "offset": offset,
                    "total": len(rows), "nextOffset": end if end < len(rows) else None, "items": rows[offset:end]}
        if action == "source.compare":
            source_id = inputs.get("sourceId")
            before = self._detail(db, source_id, inputs.get("fromRevisionId"))
            after = self._detail(db, source_id, inputs.get("toRevisionId"))
            return {"sourceId": source_id, "fromRevisionId": before["revision"]["id"], "toRevisionId": after["revision"]["id"],
                    **compare_models(before["model"], after["model"])}
        detail = self._detail(db, inputs.get("sourceId"), inputs.get("revisionId"))
        return analysis_selection(detail, inputs) if action == "analysis.preview" else projection(detail, inputs)

    def _new_revision(self, db, source, raw, inputs, previous=None):
        selected = inputs.get("selectedSchema", previous["selectedSchema"] if previous else "2.7.0")
        profiles = inputs.get("profileIds", previous["profileIds"] if previous else [])
        model, validation = validate_document(raw, source["nativeIdentity"], selected, profiles)
        number = max((r["number"] for r in self._all(db, "revision") if r["sourceId"] == source["id"]), default=0) + 1
        revision = {"id": identifier("revision"), "sourceId": source["id"], "number": number,
                    "parentId": previous["id"] if previous else None, "sha256": self._object(db, raw),
                    "bytes": len(raw), "createdAt": now(), "actor": inputs["actor"], "note": inputs.get("note", ""),
                    "selectedSchema": selected, "profileIds": profiles, "declaredVersion": model["declaredVersion"],
                    "model": model, "validation": validation}
        if inputs.get("patches"):
            revision["acceptedPatches"] = inputs["patches"]
        self._put(db, "revision", revision)
        source["currentRevisionId"] = revision["id"]
        self._put(db, "source", source)
        return {"sourceId": source["id"], "revisionId": revision["id"], "validation": validation}

    def _export_record(self, db, raw, kind, name, **metadata):
        record = {"id": identifier("export"), "kind": kind, "name": name, "bytes": len(raw),
                  "sha256": self._object(db, raw), "createdAt": now(), **metadata}
        record["downloadUrl"] = "/api/download/" + record["id"]
        self._put(db, "export", record)
        return record

    def _write(self, db, action, inputs):
        if action == "source.import":
            raw = decode64(inputs.get("contentBase64"))
            name = text(inputs.get("name"), "name", blank=False)
            source = {"id": identifier("source"), "name": name, "originalSha256": digest(raw),
                      "importedAt": now(), "originUri": text(inputs.get("originUri", ""), "originUri")}
            source["nativeIdentity"] = source["id"]
            return self._new_revision(db, source, raw, inputs)
        if action in {"source.replace", "source.patch", "source.validate"}:
            source = self._get(db, "source", inputs.get("sourceId"))
            require(inputs.get("expectedRevisionId") == source["currentRevisionId"], "source_changed",
                    "Review the current source revision before saving this change", {"currentRevisionId": source["currentRevisionId"]}, 409)
            previous = self._get(db, "revision", source["currentRevisionId"])
            raw = self._bytes(db, previous["sha256"])
            if action == "source.replace":
                raw = decode64(inputs.get("contentBase64"))
                if "name" in inputs:
                    source["name"] = text(inputs["name"], "name", blank=False)
            elif action == "source.patch":
                raw = patch_document(raw, source["nativeIdentity"], inputs.get("patches"))
            return self._new_revision(db, source, raw, inputs, previous)
        if action == "edition.save":
            state = self._state(db)
            edition = {"id": identifier("edition"), "number": len(state["editions"]) + 1,
                       "name": text(inputs.get("name"), "name", blank=False), "note": inputs.get("note", ""),
                       "actor": inputs["actor"], "createdAt": now(), "version": state["version"],
                       "sources": [{"sourceId": s["id"], "revisionId": s["currentRevisionId"],
                                    "sha256": self._get(db, "revision", s["currentRevisionId"])["sha256"]} for s in state["sources"]],
                       "reviews": state["reviews"], "links": state["links"], "analysisRuns": self._all(db, "analysis")}
            self._put(db, "edition", edition)
            return {"editionId": edition["id"], "number": edition["number"]}
        if action in {"review.save", "link.save"}:
            detail = self._detail(db, inputs.get("sourceId"), inputs.get("revisionId"))
            require(inputs.get("revisionId") == detail["revision"]["id"], "review_revision", "Select an exact retained revision")
            entity_key = inputs.get("entityKey", "")
            require(not entity_key or any(e["key"] == entity_key for e in detail["model"]["entities"]),
                    "review_entity", "The selected native entity is absent from this revision")
            kind = "review" if action == "review.save" else "link"
            prior = self._get(db, kind, inputs["id"]) if inputs.get("id") else None
            if prior:
                require(prior["sourceId"] == inputs["sourceId"], "review_source", "An existing review cannot move to another original source")
            row = {"id": prior["id"] if prior else identifier(kind), "sourceId": inputs["sourceId"],
                   "revisionId": inputs["revisionId"], "entityKey": entity_key, "actor": inputs["actor"],
                   "note": inputs.get("note", ""), "createdAt": prior["createdAt"] if prior else now(),
                   "updatedAt": now(), "history": (prior.get("history", []) + [{k: v for k, v in prior.items() if k != "history"}]) if prior else []}
            if kind == "review":
                status = inputs.get("status")
                require(status in {"open", "investigating", "resolved", "accepted"}, "review_status", "Choose a supported review state")
                evidence = inputs.get("evidence", [])
                require(isinstance(evidence, list), "review_evidence", "Evidence must be a list")
                for item in evidence:
                    require(isinstance(item, dict), "review_evidence", "Every evidence reference needs a label and URL")
                    text(item.get("label"), "evidence label", blank=False)
                    url = text(item.get("url"), "evidence URL", blank=False)
                    require(urlparse(url).scheme in ("https", "http"), "review_evidence", "Evidence links must be ordinary HTTP or HTTPS references")
                row.update(status=status, title=text(inputs.get("title"), "title", blank=False),
                           assignee=text(inputs.get("assignee", ""), "assignee"), dueDate=text(inputs.get("dueDate", ""), "dueDate"), evidence=evidence)
            else:
                require(inputs.get("targetKind") in {"haystack", "lda", "turnover"}, "link_kind", "Choose a supported native sidecar target")
                require(entity_key, "link_entity", "Select the native entity to link")
                row.update(targetKind=inputs["targetKind"], targetWorkspaceId=text(inputs.get("targetWorkspaceId"), "targetWorkspaceId", blank=False),
                           targetRecordId=text(inputs.get("targetRecordId"), "targetRecordId", blank=False))
            self._put(db, kind, row)
            return {kind + "Id": row["id"]}
        if action == "projection.save":
            detail = self._detail(db, inputs.get("sourceId"), inputs.get("revisionId"))
            preview = projection(detail, inputs)
            require(inputs.get("expectedSelectionSha256") == preview["selectionSha256"], "projection_changed",
                    "Preview these exact native selections before saving the projection", status=409)
            raw = projection_package(detail, self._bytes(db, detail["revision"]["sha256"]), preview)
            record = self._export_record(db, raw, "turnover-projection", "Audit_Exchange_Turnover.zip",
                                         sourceId=inputs["sourceId"], revisionId=detail["revision"]["id"])
            projection_row = {"id": identifier("projection"), "sourceId": inputs["sourceId"], "revisionId": detail["revision"]["id"],
                              "selection": preview["selection"], "selectionSha256": preview["selectionSha256"],
                              "tables": preview["tables"], "exportId": record["id"], "createdAt": now(), "actor": inputs["actor"], "note": inputs.get("note", "")}
            self._put(db, "projection", projection_row)
            return {"projectionId": projection_row["id"], "exportId": record["id"], "downloadUrl": record["downloadUrl"]}
        if action == "analysis.resume":
            row = self._get(db, "analysis", inputs.get("analysisId"))
            require(row["status"] in {"needs-runtime", "needs-input", "failed"} and row.get("metadata", {}).get("terminal") is False,
                    "analysis_terminal", "Continue only an original recoverable native operation with unchanged inputs", status=409)
            row.setdefault("continuations", []).append({"at": now(), "actor": inputs["actor"],
                "note": inputs.get("note", ""), "previousStatus": row["status"], "previousDiagnostics": row["diagnostics"],
                "previousMetadata": row.get("metadata", {}), "previousOutputs": row.get("outputs", [])})
            row.update(status="queued", outputs=[], diagnostics=[])
            row.pop("completedAt", None)
            self._put(db, "analysis", row)
            return {"analysisId": row["id"], "status": "queued", "outputs": [], "diagnostics": []}
        if action == "analysis.run":
            detail = self._detail(db, inputs.get("sourceId"), inputs.get("revisionId"))
            preview = analysis_selection(detail, inputs)
            require(not any(d.get("severity") == "error" for d in preview["diagnostics"]),
                    "analysis_selection", "Resolve the selected native stream findings before model execution", preview["diagnostics"])
            weather = decode64(inputs.get("weatherCsvBase64"))
            model_options = inputs.get("modelOptions", {})
            require(isinstance(model_options, dict), "analysis_options", "Native model options must be an object")
            row = {"id": identifier("analysis"), "sourceId": inputs["sourceId"], "revisionId": detail["revision"]["id"],
                   "selection": preview["selection"], "selectionSha256": preview["selection"]["selectionSha256"],
                   "weatherSha256": self._object(db, weather),
                   "weather": {"name": text(inputs.get("weatherName"), "weatherName", blank=False),
                               "source": text(inputs.get("weatherSource"), "weatherSource", blank=False),
                               "sha256": digest(weather), "bytes": len(weather)},
                   "modelOptions": model_options, "status": "queued", "outputs": [], "diagnostics": preview["diagnostics"],
                   "createdAt": now(), "actor": inputs["actor"], "note": inputs.get("note", "")}
            self._put(db, "analysis", row)
            return {"analysisId": row["id"], "status": "queued", "outputs": [], "diagnostics": row["diagnostics"]}
        if action == "export.create":
            kind = inputs.get("kind")
            require(kind in {"xml", "review", "workspace", "application"}, "export_kind", "Choose a supported complete export")
            state = self._state(db)
            if kind == "xml":
                detail = self._detail(db, inputs.get("sourceId"), inputs.get("revisionId"))
                raw = self._bytes(db, detail["revision"]["sha256"])
                name = "Audit_Source_Revision_" + str(detail["revision"]["number"]) + ".xml"
            elif kind == "review":
                details = self._selected_details(db, inputs.get("editionId"))
                if inputs.get("editionId"):
                    edition = self._get(db, "edition", inputs["editionId"])
                    state = {**state, **{name: copy.deepcopy(edition[name]) for name in ("version", "reviews", "links", "analysisRuns")}}
                    state["selectedEdition"] = {"id": edition["id"], "number": edition["number"], "name": edition["name"]}
                raw = review_html(state, details)
                name = "Audit_Exchange_Review.html"
            else:
                snapshot, members = self._snapshot(db)
                snapshot["selectedEditionId"] = inputs.get("editionId")
                if snapshot["selectedEditionId"]:
                    self._get(db, "edition", snapshot["selectedEditionId"])
                members["workspace.json"] = (canonical(snapshot) + "\n").encode()
                members["README.md"] = b"# Audit Exchange editable handover\n\nRetain this complete archive. Receive it through the installed Audit Exchange workspace, or launch the included application when present. Original XML, every saved revision, validation, reviews, sidecar joins and native analysis inputs/outputs are included. workspace.json connects all original identities and files.\n"
                if kind == "application":
                    members.update(application_members())
                raw = package_bytes(members, kind=kind, summary={"workspaceId": state["workspaceId"], "version": state["version"],
                                                               "selectedEditionId": snapshot["selectedEditionId"]})
                name = "Audit_Exchange_" + ("Application" if kind == "application" else "Workspace") + ".zip"
            return self._export_record(db, raw, kind, name)
        if action == "workspace.receive":
            return self._receive(db, decode64(inputs.get("contentBase64"), maximum=1024 * 1024 * 1024), inputs)
        raise AuditError("unknown_action", "The native action is unavailable")

    def _selected_details(self, db, edition_id=None):
        if edition_id:
            edition = self._get(db, "edition", edition_id)
            return [self._detail(db, item["sourceId"], item["revisionId"]) for item in edition["sources"]]
        return [self._detail(db, source["id"]) for source in self._all(db, "source")]

    def _snapshot(self, db):
        kinds = ("source", "revision", "review", "link", "edition", "analysis", "projection", "received-operation", "received-export")
        records = [{"kind": kind, "id": item["id"], "payload": item} for kind in kinds for item in self._all(db, kind)]
        needed = set()
        preferred = {}
        for record in records:
            item = record["payload"]
            if record["kind"] == "revision":
                needed.add(item["sha256"])
                preferred.setdefault(item["sha256"], "sources/" + item["sourceId"] + "/revision-" + str(item["number"]).zfill(4) + ".xml")
            elif record["kind"] == "analysis":
                needed.add(item["weatherSha256"])
                preferred.setdefault(item["weatherSha256"], "analysis/" + item["id"] + "/weather.csv")
                for output in item["outputs"]:
                    needed.add(output["sha256"])
                    preferred.setdefault(output["sha256"], "analysis/" + item["id"] + "/outputs/" + output["id"])
        for exported in self._all(db, "export"):
            if exported["kind"] not in {"workspace", "application"}:
                needed.add(exported["sha256"])
                preferred.setdefault(exported["sha256"], "exports/" + exported["id"])
        for edition in self._all(db, "edition"):
            for analysis in edition.get("analysisRuns", []):
                if analysis.get("weather", {}).get("sha256"):
                    needed.add(analysis["weather"]["sha256"])
                for output in analysis.get("outputs", []):
                    needed.add(output["sha256"])
        objects = []
        members = {}
        for sha in sorted(needed):
            raw = self._bytes(db, sha)
            path = preferred.get(sha, "objects/" + sha)
            members[path] = raw
            objects.append({"sha256": sha, "bytes": len(raw), "path": path})
        requests = [dict(row) for row in db.execute("SELECT id,action,envelope_sha256,input_record,result,version,created_at FROM requests ORDER BY version")]
        snapshot = {"format": SNAPSHOT_FORMAT, "workspace": self._meta(db), "records": records,
                    "objects": objects, "operations": requests,
                    "priorExports": self._all(db, "export"), "createdAt": now()}
        return snapshot, members

    def _receive(self, db, raw, inputs):
        manifest, members = unpack_package(raw)
        require(manifest.get("kind") in {"workspace", "application"} and "workspace.json" in members,
                "package_kind", "Receive a complete editable workspace or application package")
        try:
            snapshot = json.loads(members["workspace.json"])
        except ValueError as error:
            raise AuditError("package_snapshot", "The native workspace snapshot is unreadable") from error
        require(isinstance(snapshot, dict) and snapshot.get("format") == SNAPSHOT_FORMAT
                and isinstance(snapshot.get("records"), list) and isinstance(snapshot.get("objects"), list)
                and isinstance(snapshot.get("workspace"), dict), "package_snapshot",
                "The selected package has no supported complete workspace")
        origin = snapshot["workspace"]
        require(origin.get("format") == "commons.audit-exchange.workspace.v1"
                and isinstance(origin.get("workspaceId"), str) and origin["workspaceId"]
                and type(origin.get("version")) is int and origin["version"] >= 0,
                "package_workspace", "The original workspace identity is incomplete")
        source_workspace = origin["workspaceId"]
        package_sha = digest(raw)
        records = snapshot["records"]
        by_kind, record_identities = {}, set()
        allowed = {"source", "revision", "review", "link", "edition", "analysis", "projection", "received-operation", "received-export"}
        for record in records:
            require(isinstance(record, dict) and record.get("kind") in allowed
                    and isinstance(record.get("payload"), dict) and isinstance(record.get("id"), str) and record["id"]
                    and record["id"] == record["payload"].get("id"), "package_record", "An imported record has an invalid identity")
            require(record["id"] not in record_identities, "package_record", "The package repeats a native operating record identity")
            record_identities.add(record["id"])
            by_kind.setdefault(record["kind"], {})[record["id"]] = record["payload"]
        objects = {}
        for item in snapshot["objects"]:
            require(isinstance(item, dict), "package_object", "An original workspace object is invalid")
            data = members.get(item.get("path"))
            require(data is not None and digest(data) == item.get("sha256") and len(data) == item.get("bytes")
                    and item["sha256"] not in objects, "package_object", "An original workspace object is absent, repeated or changed")
            objects[item["sha256"]] = data
        sources, revisions = by_kind.get("source", {}), by_kind.get("revision", {})
        for source_id, source in sources.items():
            require(source.get("currentRevisionId") in revisions and isinstance(source.get("nativeIdentity"), str)
                    and source["nativeIdentity"] and isinstance(source.get("name"), str),
                    "package_source", "An imported source has no complete current revision")
            originals = [r for r in revisions.values() if r.get("sourceId") == source_id and r.get("parentId") is None]
            require(len(originals) == 1 and originals[0].get("sha256") == source.get("originalSha256")
                    and originals[0].get("number") == 1, "package_source", "The full first revision of the original source is absent")
        numbers = set()
        for revision_id, revision in revisions.items():
            source_id = revision.get("sourceId")
            require(source_id in sources and revision.get("sha256") in objects, "package_revision", "A source revision is incomplete")
            require(type(revision.get("number")) is int and revision["number"] > 0 and (source_id, revision["number"]) not in numbers,
                    "package_revision", "Source revision numbers must remain unique")
            numbers.add((source_id, revision["number"]))
            parent = revision.get("parentId")
            require((parent is None and revision["number"] == 1) or
                    (parent in revisions and revisions[parent].get("sourceId") == source_id
                     and revisions[parent].get("number") == revision["number"] - 1),
                    "package_revision", "The original source revision chain is incomplete")
            require(len(objects[revision["sha256"]]) == revision.get("bytes")
                    and isinstance(revision.get("model"), dict) and isinstance(revision.get("validation"), dict),
                    "package_revision", "A complete original source revision or engine result is absent")
            rebuilt_model, actual_validation = validate_document(objects[revision["sha256"]], sources[source_id]["nativeIdentity"],
                                                                 revision.get("selectedSchema"), revision.get("profileIds"))
            history = revision.get("derivedHistory", [])
            require(isinstance(history, list), "package_revision", "The original validation history is invalid")
            revision["derivedHistory"] = history + [{"workspaceId": source_workspace, "revisionId": revision_id,
                "packageSha256": package_sha, "receivedAt": now(), "model": revision["model"],
                "validation": revision["validation"], "declaredVersion": revision.get("declaredVersion")}]
            revision["validation"], revision["model"] = actual_validation, rebuilt_model
            revision["declaredVersion"] = rebuilt_model["declaredVersion"]
        for source_id, source in sources.items():
            current = revisions[source["currentRevisionId"]]
            require(current["sourceId"] == source_id and current["number"] == max(r["number"] for r in revisions.values() if r["sourceId"] == source_id),
                    "package_source", "The current revision differs from the complete original source chain")

        def bound(item, kind):
            require(isinstance(item, dict) and item.get("sourceId") in sources and item.get("revisionId") in revisions
                    and revisions[item["revisionId"]]["sourceId"] == item["sourceId"],
                    "package_relationship", "An imported " + kind + " has an invalid source binding")
            if kind in {"review", "link"}:
                entity = item.get("entityKey", "")
                require(isinstance(entity, str) and (not entity or any(
                    row["key"] == entity for row in revisions[item["revisionId"]]["model"]["entities"])),
                    "package_relationship", "An imported review refers to an absent native entity")
                require(kind != "link" or bool(entity), "package_relationship", "A native sidecar link requires its original entity")
            if kind == "review":
                require(item.get("status") in {"open", "investigating", "resolved", "accepted"}
                        and all(isinstance(item.get(k), str) for k in ("title", "assignee", "dueDate", "note")),
                        "package_review", "An imported review has unsupported fields")
            if kind == "link":
                require(item.get("targetKind") in {"haystack", "lda", "turnover"} and
                        all(isinstance(item.get(k), str) and item[k] for k in ("targetWorkspaceId", "targetRecordId")),
                        "package_link", "An imported sidecar target is incomplete")

        def native_objects(item):
            weather = item.get("weather")
            require(isinstance(weather, dict) and weather.get("sha256") in objects and
                    len(objects[weather["sha256"]]) == weather.get("bytes"),
                    "package_analysis", "The full original native weather input is absent")
            if "weatherSha256" in item:
                require(item["weatherSha256"] == weather["sha256"], "package_analysis", "The original weather input identity differs")
            outputs = item.get("outputs")
            require(isinstance(outputs, list), "package_analysis", "The original native output inventory is incomplete")
            for output in outputs:
                require(isinstance(output, dict) and isinstance(output.get("id"), str)
                        and output.get("sha256") in objects and len(objects[output["sha256"]]) == output.get("bytes")
                        and isinstance(output.get("name"), str) and output["name"],
                        "package_analysis", "A complete original native output is absent")

        for kind in ("review", "link", "analysis", "projection"):
            for item in by_kind.get(kind, {}).values():
                bound(item, kind)
                if kind in {"review", "link"}:
                    require(isinstance(item.get("history", []), list), "package_history", "The original review history is invalid")
                    for previous in item.get("history", []):
                        bound(previous, kind)
                elif kind == "analysis":
                    native_objects(item)
                    require(isinstance(item.get("selection"), dict) and isinstance(item.get("modelOptions"), dict)
                            and item["selection"].get("sourceSha256") == revisions[item["revisionId"]]["sha256"],
                            "package_analysis", "The retained native model selection is incomplete")
                else:
                    require(isinstance(item.get("tables"), dict) and set(item["tables"]) == set(asset_catalog()["consumerTables"]),
                            "package_projection", "A complete original eight-table projection is absent")
                    from exchange import ordered_rows
                    for table, rows in item["tables"].items():
                        require(isinstance(rows, list), "package_projection", "The original consumer table is invalid")
                        ordered_rows(table, rows)
        for edition in by_kind.get("edition", {}).values():
            require(isinstance(edition.get("sources"), list), "package_edition", "A saved edition has no original source set")
            selected = set()
            for source in edition["sources"]:
                require(isinstance(source, dict) and source.get("sourceId") in sources and source.get("revisionId") in revisions
                        and source["sourceId"] not in selected and revisions[source["revisionId"]]["sourceId"] == source["sourceId"]
                        and revisions[source["revisionId"]]["sha256"] == source.get("sha256"),
                        "package_edition", "A saved edition differs from its exact original sources")
                selected.add(source["sourceId"])
            for name, kind in (("reviews", "review"), ("links", "link"), ("analysisRuns", "analysis")):
                require(isinstance(edition.get(name), list), "package_edition", "The complete frozen edition records are absent")
                for item in edition[name]:
                    bound(item, kind)
                    if kind == "analysis":
                        native_objects(item)

        id_map = {record["id"]: identifier(record["kind"]) for record in records}
        export_inputs = {}
        prior_exports = snapshot.get("priorExports", [])
        require(isinstance(prior_exports, list), "package_export", "The original export inventory is invalid")
        for exported in prior_exports:
            require(isinstance(exported, dict) and isinstance(exported.get("id"), str), "package_export", "An original export has no identity")
            if exported.get("kind") not in {"workspace", "application"}:
                require(exported.get("sha256") in objects and len(objects[exported["sha256"]]) == exported.get("bytes"),
                        "package_export", "A complete delivered export is absent")
                export_inputs[exported["id"]] = exported
        all_analysis = list(by_kind.get("analysis", {}).values()) + [
            item for edition in by_kind.get("edition", {}).values() for item in edition["analysisRuns"]]
        for analysis in all_analysis:
            for output in analysis["outputs"]:
                if output["id"] in export_inputs:
                    require(export_inputs[output["id"]]["sha256"] == output["sha256"],
                            "package_export", "One native output identity names different contents")
                else:
                    export_inputs[output["id"]] = {**output, "kind": "analysis-output"}
        for projection_row in by_kind.get("projection", {}).values():
            require(projection_row.get("exportId") in export_inputs, "package_projection", "The complete original turnover export is absent")
        require(not (set(export_inputs) & set(id_map)), "package_export", "An output identity collides with a native operating record")
        export_map = {}
        for sha, data in objects.items():
            self._object(db, data)

        preserved = {"original", "receivedFrom", "receivedHistory", "derivedHistory", "receivedValidation", "nativeIdentity"}
        def remap(value, field=None):
            if field in preserved:
                return copy.deepcopy(value)
            if isinstance(value, list):
                return [remap(item, field) for item in value]
            if isinstance(value, dict):
                return {name: remap(item, name) for name, item in value.items()}
            if isinstance(value, str):
                if field in {"id", "sourceId", "revisionId", "parentId", "currentRevisionId", "editionId", "analysisId", "projectionId", "exportId"}:
                    return id_map.get(value, export_map.get(value, {}).get("id", value))
                if field == "downloadUrl" and value.startswith("/api/download/"):
                    return export_map.get(value[len("/api/download/"):], {}).get("downloadUrl", value)
            return value

        for original_id, exported in export_inputs.items():
            metadata = {k: remap(v, k) for k, v in exported.items() if k not in {
                "id", "kind", "name", "bytes", "sha256", "downloadUrl", "createdAt"}}
            metadata["receivedFrom"] = {"workspaceId": source_workspace, "exportId": original_id,
                                        "packageSha256": package_sha, "createdAt": exported.get("createdAt")}
            export_map[original_id] = self._export_record(db, objects[exported["sha256"]], exported["kind"], exported["name"], **metadata)
        for record in records:
            original = record["payload"]
            value = remap(original)
            previous_receiving = original.get("receivedHistory", [])
            require(isinstance(previous_receiving, list), "package_history", "The original receiving history is invalid")
            if original.get("receivedFrom"):
                previous_receiving = previous_receiving + [copy.deepcopy(original["receivedFrom"])]
            if previous_receiving:
                value["receivedHistory"] = previous_receiving
            value["receivedFrom"] = {"workspaceId": source_workspace, "recordId": record["id"],
                "packageSha256": package_sha, "receivedAt": now(), "actor": inputs["actor"]}
            if record["kind"] == "analysis":
                # An immutable original analysis selection remains identified by its original digest.
                # The enclosing record carries its new local source/revision binding.
                value["selection"] = copy.deepcopy(original["selection"])
                value["status"] = "received-" + value["status"] if value["status"] in {"queued", "running"} else value["status"]
            self._put(db, record["kind"], value)
        for operation in snapshot.get("operations", []):
            self._put(db, "received-operation", {"id": identifier("received-operation"), "originWorkspaceId": source_workspace,
                "original": operation, "packageSha256": package_sha})
        for exported in prior_exports:
            self._put(db, "received-export", {"id": identifier("received-export"), "originWorkspaceId": source_workspace,
                "original": exported, "packageSha256": package_sha})
        return {"receivedSources": len(sources), "receivedEditions": len(by_kind.get("edition", {})),
                "receivedReviews": len(by_kind.get("review", {})), "receivedLinks": len(by_kind.get("link", {})),
                "sourceIdMap": {identity: id_map[identity] for identity in sources}, "packageSha256": package_sha}

    def download(self, export_id):
        with self.connect() as db:
            db.execute("BEGIN")
            record = self._get(db, "export", export_id)
            raw = self._bytes(db, record["sha256"])
            require(len(raw) == record["bytes"], "export_changed", "The complete export length differs")
            return record, raw

    def start_worker(self):
        if self._worker is None:
            self._worker = threading.Thread(target=self._worker_loop, name="audit-native-analysis", daemon=True)
            self._worker.start()

    def close(self):
        self._stop.set()
        self._wake.set()
        if self._worker:
            self._worker.join(timeout=2)

    def _worker_loop(self):
        import logging
        while not self._stop.is_set():
            try:
                with self.connect() as db:
                    db.execute("BEGIN")
                    jobs = [row["id"] for row in self._all(db, "analysis") if row["status"] in {"queued", "running"}]
                for identity in jobs:
                    if self._stop.is_set():
                        return
                    try:
                        self.run_analysis_job(identity)
                    except Exception:
                        # Failure to persist an outcome leaves the same original operation recoverable.
                        # The actual error is visible to the operator; it is never reported as completion.
                        logging.exception("Original native analysis %s could not persist its outcome", identity)
            except Exception:
                logging.exception("The original native analysis queue could not be read")
            self._wake.wait(5)
            self._wake.clear()

    def run_analysis_job(self, analysis_id):
        require(isinstance(analysis_id, str) and re.fullmatch(r"analysis-[0-9a-f]{32}", analysis_id),
                "analysis_id", "Select an original native analysis identifier")
        directory = self.directory / "native-analysis" / analysis_id
        directory.mkdir(parents=True, exist_ok=True, mode=0o700)
        lock = os.open(directory / "operation.lock", os.O_CREAT | os.O_RDWR, 0o600)
        try:
            try:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                return False
            with self.connect() as db:
                db.execute("BEGIN IMMEDIATE")
                job = self._get(db, "analysis", analysis_id)
                if job["status"] not in {"queued", "running"}:
                    db.rollback()
                    return False
                job["status"], job["startedAt"] = "running", job.get("startedAt", now())
                self._put(db, "analysis", job)
                self._bump(db)
                weather = self._bytes(db, job["weatherSha256"])
                revision = self._get(db, "revision", job["revisionId"])
                source = self._bytes(db, revision["sha256"])
                db.commit()
            try:
                source_path = directory / "source.xml"
                if source_path.exists():
                    require(source_path.is_file() and not source_path.is_symlink() and source_path.read_bytes() == source,
                            "analysis_source", "The original retained model source has changed")
                else:
                    descriptor, temporary = tempfile.mkstemp(prefix=".source-", dir=directory)
                    try:
                        with os.fdopen(descriptor, "wb") as out:
                            out.write(source); out.flush(); os.fsync(out.fileno())
                        try:
                            os.link(temporary, source_path)
                        except FileExistsError:
                            require(source_path.is_file() and not source_path.is_symlink() and source_path.read_bytes() == source,
                                    "analysis_source", "The original retained model source differs")
                        directory_fd = os.open(directory, os.O_RDONLY | os.O_DIRECTORY)
                        try:
                            os.fsync(directory_fd)
                        finally:
                            os.close(directory_fd)
                    finally:
                        if os.path.exists(temporary):
                            os.unlink(temporary)
                selection = copy.deepcopy(job["selection"])
                selection["sourceXmlPath"] = str(source_path)
                from analysis import run_analysis
                native_result = run_analysis(selection, weather, job["weather"], job["modelOptions"], str(directory), lease_fd=lock)
                require(isinstance(native_result, dict) and native_result.get("status") in {"complete", "partial", "failed", "needs-input", "needs-runtime", "running"},
                        "analysis_result", "The original native runner returned an unsupported complete outcome")
                outputs = []
                for output in native_result.get("outputs", []):
                    original_path = Path(output["path"])
                    path = original_path.resolve()
                    require(directory.resolve() in path.parents and path.is_file() and not original_path.is_symlink(),
                            "analysis_output", "A native output must be a retained file inside its original analysis")
                    outputs.append((output, path.read_bytes()))
            except Exception as error:
                native_result = {"status": "failed", "outputs": [], "diagnostics": [{
                    "code": getattr(error, "code", "native_analysis"), "message": str(error), "severity": "error"}],
                    "metadata": {"exceptionType": type(error).__name__, "terminal": False, "resumable": True}}
                outputs = []
            with self.connect() as db:
                db.execute("BEGIN IMMEDIATE")
                current = self._get(db, "analysis", analysis_id)
                require(current["status"] == "running", "analysis_changed", "The original native analysis state changed during execution", status=409)
                exported = []
                for output, raw in outputs:
                    record = self._export_record(db, raw, "analysis-output", text(output["name"], "output name", blank=False),
                        mime=output.get("mime", "application/octet-stream"), sourceId=current["sourceId"], revisionId=current["revisionId"])
                    exported.append(record)
                current.update(status=native_result["status"], outputs=exported,
                    diagnostics=native_result.get("diagnostics", []), metadata=native_result.get("metadata", {}))
                if current["status"] != "running":
                    current["completedAt"] = now()
                self._put(db, "analysis", current)
                self._bump(db)
                db.commit()
            return True
        finally:
            os.close(lock)
