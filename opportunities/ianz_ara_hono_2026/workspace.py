"""One saved accreditation project: records, assets, requests and receiving."""
from __future__ import annotations
import base64
import binascii
import collections
import contextlib
import hashlib
import pathlib
import sqlite3
import threading
import uuid
from schema import (ROOT, OPERATION, FORMAT, ENTITIES, FIELDS, MAX_FILE_BYTES, MAX_RECORDS,
                    WorkspaceError, copy, digest, dumps, identity, loads, now, package_bytes,
                    record_key, relation_issues, safe_path, unpack, validate_record)
import mapping

DDL = """
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS assets (
 file_id TEXT PRIMARY KEY, sha256 TEXT NOT NULL, bytes INTEGER NOT NULL, body BLOB NOT NULL);
CREATE TABLE IF NOT EXISTS file_receipts (
 receipt_id TEXT PRIMARY KEY, file_id TEXT NOT NULL REFERENCES assets(file_id),
 filename TEXT NOT NULL, media_type TEXT NOT NULL, origin TEXT NOT NULL,
 source_id TEXT, source_url TEXT, received_at TEXT NOT NULL, request_id TEXT NOT NULL,
 revision INTEGER NOT NULL, annotations_json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS editions (
 edition_id TEXT PRIMARY KEY, entity TEXT NOT NULL, record_key TEXT NOT NULL,
 values_json TEXT NOT NULL, provenance_json TEXT NOT NULL, annotations_json TEXT NOT NULL,
 revision INTEGER NOT NULL, actor TEXT NOT NULL, reason TEXT NOT NULL,
 created_at TEXT NOT NULL, previous_id TEXT REFERENCES editions(edition_id));
CREATE INDEX IF NOT EXISTS edition_lookup ON editions(entity,record_key,revision);
CREATE TABLE IF NOT EXISTS heads (
 entity TEXT NOT NULL, record_key TEXT NOT NULL, edition_id TEXT NOT NULL REFERENCES editions(edition_id),
 PRIMARY KEY(entity,record_key));
CREATE TABLE IF NOT EXISTS commands (
 request_id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, request_json TEXT NOT NULL,
 result_json TEXT NOT NULL, revision INTEGER NOT NULL, accepted_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS events (
 event_id TEXT PRIMARY KEY, kind TEXT NOT NULL, subject TEXT NOT NULL, payload_json TEXT NOT NULL,
 request_id TEXT NOT NULL, revision INTEGER NOT NULL, created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS event_subject ON events(subject,revision);
"""

class Workspace:
    def __init__(self, directory, *, name="IANZ accreditation workbench", create=True):
        self.directory = pathlib.Path(directory).resolve()
        if not create and not (self.directory / "workspace.sqlite3").is_file():
            raise WorkspaceError("Select an existing saved workspace.")
        self.directory.mkdir(parents=True, mode=0o700, exist_ok=True)
        self.db = sqlite3.connect(self.directory / "workspace.sqlite3", timeout=30,
                                  isolation_level=None, check_same_thread=False)
        self.db.row_factory = sqlite3.Row
        self.db.execute("PRAGMA foreign_keys=ON")
        self.db.execute("PRAGMA journal_mode=WAL")
        self.db.execute("PRAGMA synchronous=FULL")
        self.db.execute("PRAGMA busy_timeout=30000")
        self.db.executescript(DDL)
        self.lock = threading.RLock()
        with self.lock:
            self.db.execute("BEGIN IMMEDIATE")
            try:
                if not self.db.execute("SELECT 1 FROM meta WHERE key='format'").fetchone():
                    for key, value in {"format": FORMAT, "project_id": str(uuid.uuid4()), "name": name,
                                       "operation": OPERATION, "revision": 0, "created_at": now(),
                                       "active_mapping": None}.items():
                        self._meta_put(key, value)
                if self._meta("format") != FORMAT:
                    raise WorkspaceError("This saved workspace uses a different application format.")
                self.db.commit()
            except Exception:
                self.db.rollback()
                raise
        self.context = None

    def close(self):
        with self.lock:
            self.db.close()

    def _meta(self, key):
        row = self.db.execute("SELECT value FROM meta WHERE key=?", (key,)).fetchone()
        return loads(row[0]) if row else None

    def _meta_put(self, key, value):
        self.db.execute("INSERT INTO meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                        (key, dumps(value)))

    def metadata(self):
        with self.lock:
            return {row["key"]: loads(row["value"]) for row in self.db.execute("SELECT * FROM meta ORDER BY key")}

    def execute(self, request):
        if not isinstance(request, dict):
            raise WorkspaceError("Read a complete original command.")
        for name in ["request_id", "action", "actor", "reason"]:
            if not isinstance(request.get(name), str) or not request[name].strip() or len(request[name]) > 2000:
                raise WorkspaceError("A command requires its original " + name + ".")
        if len(request["request_id"]) > 200 or type(request.get("expected_revision")) is not int:
            raise WorkspaceError("Use one stable request ID and an integer expected revision.")
        if not isinstance(request.get("payload", {}), dict):
            raise WorkspaceError("The command payload must be an object.")
        fingerprint = identity(request)
        with self.lock:
            self.db.execute("BEGIN IMMEDIATE")
            try:
                accepted = self.db.execute("SELECT * FROM commands WHERE request_id=?", (request["request_id"],)).fetchone()
                if accepted:
                    if accepted["fingerprint"] != fingerprint:
                        raise WorkspaceError("That original request ID already belongs to different input.",
                                             code="request_conflict", status=409)
                    self.db.commit()
                    return loads(accepted["result_json"])
                current = self._meta("revision")
                if current != request["expected_revision"]:
                    raise WorkspaceError("The project has a later saved revision. Compare it with this retained draft.",
                                         code="revision_conflict", status=409,
                                         details={"expected": request["expected_revision"], "current": current})
                if request.get("project_id") and request["project_id"] != self._meta("project_id"):
                    raise WorkspaceError("This command belongs to a different saved project.", code="project_conflict", status=409)
                self.context = {**request, "revision": current + 1, "at": now(), "request_copy": copy(request)}
                value = self._dispatch(request["action"], request.get("payload", {}))
                revision = self.context["revision"]
                self._meta_put("revision", revision)
                result = {"request_id": request["request_id"], "action": request["action"],
                          "project_id": self._meta("project_id"), "revision": revision,
                          "accepted_at": self.context["at"], "result": value}
                self.db.execute("INSERT INTO commands VALUES(?,?,?,?,?,?)",
                                (request["request_id"], fingerprint, dumps(self.context["request_copy"]),
                                 dumps(result), revision, self.context["at"]))
                self.db.commit()
                return result
            except Exception:
                self.db.rollback()
                raise
            finally:
                self.context = None

    def command(self, request_id, *, hydrate=False):
        with self.lock:
            row = self.db.execute("SELECT * FROM commands WHERE request_id=?", (request_id,)).fetchone()
            if not row:
                raise WorkspaceError("No accepted result is recorded for that original request.", code="not_found", status=404)
            request = loads(row["request_json"])
            if hydrate and request.get("payload", {}).get("retained_file_id"):
                request["payload"]["content_base64"] = base64.b64encode(self.file(request["payload"].pop("retained_file_id"))["body"]).decode()
            return {"request": request, "fingerprint": row["fingerprint"],
                    "result": loads(row["result_json"]), "revision": row["revision"]}

    def _dispatch(self, action, payload):
        actions = {
            "project.rename": self._rename, "source.seed": self._seed,
            "file.retain": self._receive_file, "records.import": self._import_records,
            "record.put": self._put, "source.attach": self._source_attach,
            "source.select": self._source_select, "identity.review": self._identity_review,
            "document.attach": self._document_attach, "document.render": self._document_render,
            "target.schema.receive": self._target_schema_receive, "mapping.save": self._mapping_save,
            "mapping.select": self._mapping_select, "billing.calculate": self._billing_calculate,
            "receiving.prepare": self._receiving_prepare, "receiving.result": self._receiving_result,
            "receiving.compare": self._receiving_compare, "receiving.review": self._receiving_review,
            "receiving.complete": self._receiving_complete, "handover.receive": self._handover_receive
        }
        if action not in actions:
            raise WorkspaceError("Unknown workbench action: " + action)
        return actions[action](payload)

    def _rename(self, payload):
        name = payload.get("name")
        if not isinstance(name, str) or not name.strip() or len(name) > 160:
            raise WorkspaceError("Use a project name from 1 to 160 characters.")
        self._meta_put("name", name)
        return {"name": name}

    def _event(self, kind, subject, payload):
        item = {"kind": kind, "subject": subject, "payload": payload,
                "request_id": self.context["request_id"], "revision": self.context["revision"],
                "created_at": self.context["at"]}
        event_id = "event:" + identity(item)
        self.db.execute("INSERT INTO events VALUES(?,?,?,?,?,?,?)",
                        (event_id, kind, subject, dumps(payload), item["request_id"],
                         item["revision"], item["created_at"]))
        return {"event_id": event_id, **item}

    def events(self, subject=None, kind=None, *, limit=200, after_revision=0):
        with self.lock:
            query, parameters = "SELECT * FROM events WHERE revision>?", [after_revision]
            if subject is not None:
                query += " AND subject=?"
                parameters.append(subject)
            if kind is not None:
                query += " AND kind=?"
                parameters.append(kind)
            query += " ORDER BY revision,event_id LIMIT ?"
            parameters.append(min(max(int(limit), 1), 2000))
            return [{**{key: row[key] for key in row.keys() if key != "payload_json"}, "payload": loads(row["payload_json"])}
                    for row in self.db.execute(query, parameters)]

    def _retain(self, body, *, filename, media_type, origin, source_id=None, source_url=None, annotations=None):
        if not isinstance(body, bytes) or len(body) > MAX_FILE_BYTES:
            raise WorkspaceError("An original file must fit the configured 64 MiB file capacity.")
        if not isinstance(filename, str) or not filename or len(filename) > 1000 or "\x00" in filename:
            raise WorkspaceError("Retain the original file name.")
        if not isinstance(media_type, str) or len(media_type) > 240 or "\r" in media_type or "\n" in media_type:
            raise WorkspaceError("Retain a valid observed media type.")
        info = digest(body)
        file_id = "sha256:" + info["sha256"]
        previous = self.db.execute("SELECT sha256,bytes FROM assets WHERE file_id=?", (file_id,)).fetchone()
        if previous and (previous["sha256"] != info["sha256"] or previous["bytes"] != info["bytes"]):
            raise WorkspaceError("The retained file identity conflicts.")
        self.db.execute("INSERT OR IGNORE INTO assets VALUES(?,?,?,?)", (file_id, info["sha256"], info["bytes"], body))
        receipt = {"file_id": file_id, "filename": filename, "media_type": media_type, "origin": origin,
                   "source_id": source_id, "source_url": source_url, "received_at": self.context["at"],
                   "request_id": self.context["request_id"], "revision": self.context["revision"],
                   "annotations": annotations or {}}
        receipt_id = "file-receipt:" + identity(receipt)
        self.db.execute("INSERT OR IGNORE INTO file_receipts VALUES(?,?,?,?,?,?,?,?,?,?,?)",
                        (receipt_id, file_id, filename, media_type, origin, source_id, source_url,
                         receipt["received_at"], receipt["request_id"], receipt["revision"], dumps(receipt["annotations"])))
        return {"receipt_id": receipt_id, **receipt, **info}

    def _body(self, payload):
        if payload.get("file_id"):
            return self.file(payload["file_id"])["body"]
        data = payload.get("content_base64")
        if not isinstance(data, str) or len(data) > (MAX_FILE_BYTES + 2) // 3 * 4 + 8:
            raise WorkspaceError("Choose the original file or an already retained file ID.")
        try:
            body = base64.b64decode(data, validate=True)
        except (ValueError, binascii.Error) as error:
            raise WorkspaceError("The complete file encoding is invalid.") from error
        if len(body) > MAX_FILE_BYTES:
            raise WorkspaceError("The original file exceeds 64 MiB.")
        return body

    def _receive_file(self, payload):
        body = self._body(payload)
        if payload.get("sha256") and payload["sha256"] != digest(body)["sha256"]:
            raise WorkspaceError("The complete incoming file differs from its selected hash.")
        receipt = self._retain(body, filename=payload["filename"], media_type=payload.get("media_type", "application/octet-stream"),
                               origin=payload.get("origin", "operator_received"), source_id=payload.get("source_id"),
                               source_url=payload.get("source_url"), annotations=payload.get("annotations"))
        # One durable byte body, with the original command bound by fingerprint.
        if "content_base64" in self.context["request_copy"].get("payload", {}):
            self.context["request_copy"]["payload"].pop("content_base64")
            self.context["request_copy"]["payload"]["retained_file_id"] = receipt["file_id"]
        return receipt

    def file(self, file_id):
        if isinstance(file_id, str) and len(file_id) == 64:
            file_id = "sha256:" + file_id
        with self.lock:
            row = self.db.execute("SELECT * FROM assets WHERE file_id=?", (file_id,)).fetchone()
            if not row:
                raise WorkspaceError("That complete file is not retained in this project.", code="not_found", status=404)
            result = dict(row)
            if digest(result["body"]) != {"sha256": result["sha256"], "bytes": result["bytes"]}:
                raise WorkspaceError("The stored file body differs from its original identity.", code="corrupt_asset", status=500)
            receipt = self.db.execute("SELECT * FROM file_receipts WHERE file_id=? ORDER BY revision DESC,receipt_id DESC LIMIT 1",
                                      (file_id,)).fetchone()
            if receipt:
                result.update(filename=receipt["filename"], media_type=receipt["media_type"], origin=receipt["origin"])
            return result

    def files(self, *, limit=100, after=""):
        with self.lock:
            rows = self.db.execute("""
                SELECT a.file_id,a.sha256,a.bytes,r.filename,r.media_type,r.origin,r.source_id,r.source_url,
                       r.received_at,r.revision,r.receipt_id
                FROM assets a JOIN file_receipts r ON r.receipt_id=(
                   SELECT receipt_id FROM file_receipts x WHERE x.file_id=a.file_id
                   ORDER BY revision DESC,receipt_id DESC LIMIT 1)
                WHERE a.file_id>? ORDER BY a.file_id LIMIT ?""", (after, min(max(int(limit), 1), 1000))).fetchall()
            return [dict(row) for row in rows]

    def _record(self, row):
        return {"entity": row["entity"], "key": row["record_key"], "edition_id": row["edition_id"],
                "values": loads(row["values_json"]), "provenance": loads(row["provenance_json"]),
                "annotations": loads(row["annotations_json"]), "revision": row["revision"],
                "actor": row["actor"], "reason": row["reason"], "created_at": row["created_at"],
                "previous_id": row["previous_id"]}

    def record(self, entity, key, edition_id=None):
        with self.lock:
            if edition_id:
                row = self.db.execute("SELECT * FROM editions WHERE edition_id=? AND entity=? AND record_key=?",
                                      (edition_id, entity, key)).fetchone()
            else:
                row = self.db.execute("SELECT e.* FROM editions e JOIN heads h ON e.edition_id=h.edition_id WHERE h.entity=? AND h.record_key=?",
                                      (entity, key)).fetchone()
            if not row:
                raise WorkspaceError("That record edition is not present.", code="not_found", status=404,
                                     details={"entity": entity, "key": key, "edition_id": edition_id})
            return self._record(row)

    def records(self, entity, *, limit=100, after="", search="", at_revision=None):
        if entity not in ENTITIES:
            raise WorkspaceError("Choose an actual canonical entity.")
        with self.lock:
            if at_revision is None:
                sql = "SELECT e.* FROM editions e JOIN heads h ON h.edition_id=e.edition_id WHERE h.entity=? AND h.record_key>?"
                parameters = [entity, after]
            else:
                sql = """SELECT e.* FROM editions e WHERE e.entity=? AND e.record_key>? AND e.revision<=?
                         AND NOT EXISTS(SELECT 1 FROM editions n WHERE n.entity=e.entity
                         AND n.record_key=e.record_key AND n.revision>e.revision AND n.revision<=?)"""
                parameters = [entity, after, int(at_revision), int(at_revision)]
            if search:
                sql += " AND (e.record_key LIKE ? ESCAPE '\\' OR e.values_json LIKE ? ESCAPE '\\')"
                query = "%" + search.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"
                parameters += [query, query]
            sql += " ORDER BY e.record_key LIMIT ?"
            parameters.append(min(max(int(limit), 1), MAX_RECORDS))
            return [self._record(row) for row in self.db.execute(sql, parameters)]

    def all_records(self, at_revision=None):
        return {name: self.records(name, limit=MAX_RECORDS, at_revision=at_revision) for name in ENTITIES}

    def history(self, entity, key):
        with self.lock:
            return [self._record(row) for row in self.db.execute(
                "SELECT * FROM editions WHERE entity=? AND record_key=? ORDER BY revision,edition_id", (entity, key))]

    def _put(self, payload):
        entity, values = payload.get("entity"), copy(payload.get("values"))
        incomplete = validate_record(entity, values, complete=payload.get("require_complete", False))
        if entity == "mapping_profile":
            mapping.validate_profile(values)
        key = record_key(entity, values)
        if payload.get("key") is not None and payload["key"] != key:
            raise WorkspaceError("A record's original key cannot be silently renamed. Save an explicit identity mapping.")
        existing = self.db.execute("SELECT edition_id FROM heads WHERE entity=? AND record_key=?", (entity, key)).fetchone()
        previous_id = existing["edition_id"] if existing else None
        if "expected_edition_id" in payload and payload["expected_edition_id"] != previous_id:
            raise WorkspaceError("That record has a later edition. Compare before replacing selected values.",
                                 code="record_conflict", status=409, details={"current_edition_id": previous_id})
        provenance = copy(payload.get("provenance", {}))
        annotations = copy(payload.get("annotations", {}))
        if not isinstance(provenance, dict) or not isinstance(annotations, dict):
            raise WorkspaceError("Keep field provenance and source annotations as objects.")
        if set(provenance) - set(FIELDS[entity]):
            raise WorkspaceError("Provenance references an unknown canonical field.")
        for field in values:
            provenance.setdefault(field, {"origin": "operator_entry", "actor": self.context["actor"],
                                          "recorded_at": self.context["at"]})
        item = {"entity": entity, "key": key, "values": values, "provenance": provenance,
                "annotations": annotations, "revision": self.context["revision"], "actor": self.context["actor"],
                "reason": self.context["reason"], "created_at": self.context["at"], "previous_id": previous_id}
        edition_id = "record:" + identity(item)
        if previous_id:
            previous = self.record(entity, key)
            if all(previous[name] == item[name] for name in ["values", "provenance", "annotations"]):
                return {**previous, "incomplete_fields": incomplete, "unchanged": True}
            if entity == "mapping_profile":
                raise WorkspaceError("A saved mapping version is immutable. Save the next mapping version.")
            if entity == "document" and previous["values"].get("content_sha256") != values.get("content_sha256"):
                raise WorkspaceError("Retain changed document bytes as a new logical edition.")
            if entity == "source_edition" and previous["values"].get("original_sha256") and previous["values"].get("original_sha256") != values.get("original_sha256"):
                raise WorkspaceError("Retain changed original source bytes as a new source edition.")
            if entity in {"mapping_profile", "document", "source_edition", "scope_item"} and payload.get("immutable_content"):
                raise WorkspaceError("Receive a new logical edition rather than replace this selected immutable edition.")
        self.db.execute("INSERT INTO editions VALUES(?,?,?,?,?,?,?,?,?,?,?)",
                        (edition_id, entity, key, dumps(values), dumps(provenance), dumps(annotations),
                         item["revision"], item["actor"], item["reason"], item["created_at"], previous_id))
        self.db.execute("INSERT INTO heads VALUES(?,?,?) ON CONFLICT(entity,record_key) DO UPDATE SET edition_id=excluded.edition_id",
                        (entity, key, edition_id))
        return {"edition_id": edition_id, **item, "incomplete_fields": incomplete}

    def _seed(self, payload):
        if self._meta("public_seed"):
            raise WorkspaceError("The original public cohort is already received. Continue its existing records.", code="already_received", status=409)
        from seed import public_seed
        prepared = public_seed()
        for item in prepared["files"]:
            self._retain(item["content"], filename=item["filename"], media_type=item["media_type"],
                         origin=item["origin"], annotations={"original_path": item["path"]})
        for row in prepared["records"]:
            self._put({**row, "require_complete": True})
        selected = [row["values"]["source_edition_id"] for row in prepared["records"]
                    if row["entity"] == "source_edition" and row["values"]["selected_for_current"]]
        profile = mapping.staging_profile(selected)
        mapped = self._put({"entity": "mapping_profile", "values": profile})
        self._meta_put("active_mapping", mapped["key"])
        details = {key: value for key, value in prepared.items() if key not in {"files", "records"}}
        self._meta_put("public_seed", {"received_at": self.context["at"], "counts": prepared["counts"]})
        self._event("source.public_cohort", OPERATION, details)
        return {"counts": prepared["counts"], "mapping_key": mapped["key"], "source_operation": OPERATION}

    def _import_records(self, payload):
        if "file_id" in payload:
            file = self.file(payload["file_id"])
            data = loads(file["body"])
            rows = data.get("records") if isinstance(data, dict) else data
            source_file_id = file["file_id"]
        else:
            rows, source_file_id = payload.get("records"), None
        if not isinstance(rows, list) or not rows or len(rows) > MAX_RECORDS:
            raise WorkspaceError("Receive a complete nonempty canonical record collection.")
        keys = [(row.get("entity"), record_key(row.get("entity"), row.get("values", {}))) for row in rows]
        if len(keys) != len(set(keys)):
            raise WorkspaceError("The incoming collection has duplicate original entity keys.")
        results = []
        for row in rows:
            record = copy(row)
            if source_file_id:
                record.setdefault("annotations", {})["import_file_id"] = source_file_id
                record.setdefault("provenance", {})
                for field in record["values"]:
                    record["provenance"].setdefault(field, {"origin": "received_structured_export",
                                                            "source_file_id": source_file_id, "field": field})
            result = self._put(record)
            results.append({"entity": result["entity"], "key": result["key"], "edition_id": result["edition_id"],
                            "incomplete_fields": result["incomplete_fields"]})
        return {"records": results, "count": len(results), "source_file_id": source_file_id,
                "relation_issues": relation_issues(self.all_records())}

    def _source_attach(self, payload):
        source = self.record("source_edition", payload["source_edition_id"])
        file = self.file(payload["file_id"])
        values = copy(source["values"])
        if values.get("original_sha256") and values["original_sha256"] != file["sha256"]:
            raise WorkspaceError("The earlier complete source stays retained. Create and attach a new source edition.")
        values.update(original_filename=payload.get("original_filename", file["filename"]),
                      media_type=file["media_type"], original_byte_length=file["bytes"],
                      original_sha256=file["sha256"], retained_asset_path="assets/" + file["sha256"],
                      source_kind="original_binary")
        result = self._put({"entity": "source_edition", "values": values,
                            "provenance": source["provenance"], "annotations": source["annotations"],
                            "expected_edition_id": source["edition_id"]})
        return {"source": result, "asset": {key: file[key] for key in ["file_id", "sha256", "bytes", "filename", "media_type"]}}

    def _source_select(self, payload):
        selected = payload.get("source_edition_id")
        target = self.record("source_edition", selected)
        deselect = payload.get("deselect", [])
        accreditations = payload.get("accreditations", [])
        if selected in deselect or len(deselect) != len(set(deselect)) or len({row["key"] for row in accreditations}) != len(accreditations):
            raise WorkspaceError("Select each changed source or accreditation once, with distinct current and prior editions.")
        changes = []
        # Only explicitly named predecessors are deselected. Unrelated sources,
        # histories and product criteria remain independently selected.
        for edition_key in payload.get("deselect", []):
            row = self.record("source_edition", edition_key)
            values = {**row["values"], "selected_for_current": False}
            changes.append(self._put({"entity": "source_edition", "values": values,
                                      "provenance": row["provenance"], "annotations": row["annotations"]}))
        changes.append(self._put({"entity": "source_edition", "values": {**target["values"], "selected_for_current": True},
                                  "provenance": target["provenance"], "annotations": target["annotations"]}))
        for change in payload.get("accreditations", []):
            current = self.record("accreditation", change["key"])
            values = {**current["values"], "selected_scope_edition_id": selected, "source_edition_id": selected}
            for field in ["standard_edition", "inspection_classification", "publication_observation", "issuer_status"]:
                if field in change:
                    values[field] = change[field]
            changes.append(self._put({"entity": "accreditation", "values": values,
                                      "provenance": current["provenance"], "annotations": current["annotations"],
                                      "expected_edition_id": change.get("expected_edition_id", current["edition_id"])}))
        return {"records": changes, "mapping_update_required": True}

    def _identity_review(self, payload):
        account = self.record("issuer_account", payload["account_key"])
        decision = {"decision_id": "identity:" + identity([self.context["request_id"], payload]),
                    "kind": payload.get("kind"), "source_key": account["key"], "target_key": payload.get("target_key"),
                    "evidence_file_ids": payload.get("evidence_file_ids", []), "reason": self.context["reason"],
                    "actor": self.context["actor"], "recorded_at": self.context["at"]}
        if decision["kind"] not in {"retain_separate", "link_legal_identity", "map_finance_account", "reviewed_merge"}:
            raise WorkspaceError("Choose an explicit identity decision.")
        if decision["kind"] != "retain_separate" and not decision["target_key"]:
            raise WorkspaceError("Receive the actual target identity.")
        for file_id in decision["evidence_file_ids"]:
            self.file(file_id)
        if decision["kind"] == "reviewed_merge" and not decision["evidence_file_ids"]:
            raise WorkspaceError("Attach the original material supporting this identity decision.")
        values = copy(account["values"])
        values["merge_decisions"] = values.get("merge_decisions", []) + [decision]
        if decision["kind"] == "link_legal_identity":
            values["legal_party_id"] = decision["target_key"]
        if decision["kind"] == "map_finance_account":
            values["billing_account_key"] = decision["target_key"]
        saved = self._put({"entity": "issuer_account", "values": values,
                           "provenance": account["provenance"], "annotations": account["annotations"],
                           "expected_edition_id": payload.get("expected_edition_id", account["edition_id"])})
        return {"record": saved, "decision": decision}

    def _document_attach(self, payload):
        from documents import inspect_document
        file = self.file(payload["file_id"])
        logical = payload.get("document_key")
        if not isinstance(logical, str) or not logical.strip():
            raise WorkspaceError("Retain the original logical document identity.")
        edition = payload.get("document_edition_id") or "content:" + identity([file["sha256"], payload.get("template_edition")])
        values = {"document_key": logical, "document_edition_id": edition,
                  "document_role": payload.get("document_role", "received document"),
                  "original_filename": payload.get("original_filename", file["filename"]),
                  "display_name": payload.get("display_name", file["filename"]),
                  "content_sha256": file["sha256"], "asset_path": "assets/" + file["sha256"],
                  "visibility": payload.get("visibility", "internal")}
        for field in ["programme_key", "accreditation_key", "assessment_key", "participant_key",
                      "template_id", "template_edition", "submitted_at", "supersedes"]:
            if payload.get(field) is not None:
                values[field] = payload[field]
        inspection = inspect_document(file["body"], filename=values["original_filename"], media_type=file["media_type"])
        values["content_control_map"] = {"inspection": inspection, "mappings": payload.get("mappings", [])}
        existing = self.db.execute("SELECT edition_id FROM heads WHERE entity='document' AND record_key=?",
                                  (record_key("document", values),)).fetchone()
        if existing and self.record("document", record_key("document", values))["values"]["content_sha256"] != file["sha256"]:
            raise WorkspaceError("A logical document edition cannot receive different bytes. Create its next edition.")
        saved = self._put({"entity": "document", "values": values,
                           "annotations": {"file_id": file["file_id"], "file_bytes": file["bytes"],
                                           "media_type": file["media_type"], "source_locator": payload.get("source_locator"),
                                           "receiving_notes": payload.get("notes")}})
        return {"record": saved, "inspection": inspection}

    def _document_render(self, payload):
        from documents import render_docx
        template = self.record("document", payload["template_key"])
        original = self.file("sha256:" + template["values"]["content_sha256"])
        records = {entity: {row["key"]: row["values"] for row in rows}
                   for entity, rows in self.all_records().items()}
        selected = payload.get("mappings", template["values"].get("content_control_map", {}).get("mappings", []))
        rendered = render_docx(original["body"], selected, records)
        filename = payload.get("filename", "received-form.docx")
        receipt = self._retain(rendered["content"], filename=filename,
                               media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                               origin="generated_from_received_template",
                               annotations={"template_key": template["key"], "template_edition_id": template["edition_id"],
                                            "applied": rendered.get("applied", []), "unresolved": rendered.get("unresolved", [])})
        attached = self._document_attach({**payload.get("document", {}), "file_id": receipt["file_id"],
                                          "document_key": payload["document_key"], "original_filename": filename,
                                          "template_id": template["values"].get("template_id", template["values"]["document_key"]),
                                          "template_edition": template["values"].get("template_edition"),
                                          "mappings": selected, "document_role": payload.get("document_role", "generated application")})
        return {**attached, "applied": rendered.get("applied", []), "unresolved": rendered.get("unresolved", []),
                "file": receipt}

    def active_mapping(self):
        selected = self._meta("active_mapping")
        return self.record("mapping_profile", selected) if selected else None

    def _target_schema_receive(self, payload):
        file = self.file(payload["file_id"])
        native_schema = mapping.validate_native_schema(loads(file["body"]))
        selected = self.active_mapping()
        profile = mapping.bind_matching_fields(selected["values"] if selected else mapping.staging_profile([]),
                                               native_schema, file["file_id"], actor=self.context["actor"],
                                               reviewed_at=self.context["at"])
        if payload.get("mapping_id"):
            profile["mapping_id"] = payload["mapping_id"]
        saved = self._mapping_save({"profile": profile, "select": payload.get("select", True)})
        self._event("target.schema_received", saved["key"],
                    {"file_id": file["file_id"], "sha256": file["sha256"], "bytes": file["bytes"],
                     "product": native_schema["product"], "environment_id": native_schema["environment_id"],
                     "version": native_schema["version"]})
        return saved

    def _mapping_save(self, payload):
        profile = copy(payload["profile"])
        versions = [row["values"]["version"] for row in self.records("mapping_profile", limit=MAX_RECORDS)
                    if row["values"]["mapping_id"] == profile["mapping_id"]]
        profile["version"] = max(versions, default=0) + 1
        profile["review"] = {**profile.get("review", {}), "reviewed_by": self.context["actor"],
                             "reviewed_at": self.context["at"], "change_reason": self.context["reason"]}
        for edition in profile["source_edition_ids"]:
            self.record("source_edition", edition)
        native = profile.get("native_import_profile") or {}
        if native.get("schema_file_id"):
            file = self.file(native["schema_file_id"])
            if loads(file["body"]) != native.get("schema"):
                raise WorkspaceError("The mapping's native metadata differs from its retained original descriptor.")
        saved = self._put({"entity": "mapping_profile", "values": profile, "require_complete": True})
        if payload.get("select", True):
            self._meta_put("active_mapping", saved["key"])
        return saved

    def _mapping_select(self, payload):
        row = self.record("mapping_profile", payload["mapping_key"])
        self._meta_put("active_mapping", row["key"])
        return {"mapping_key": row["key"], "edition_id": row["edition_id"]}

    def _billing_calculate(self, payload):
        from billing import calculate_bill
        profiles = [row["values"] for row in self.records("fee_profile", limit=MAX_RECORDS)]
        result = calculate_bill(payload["lines"], profiles, payload["policy"])
        event = self._event("billing.calculated", payload.get("calculation_id", self.context["request_id"]),
                            {"input": payload, "result": result})
        saved = []
        if payload.get("save_charge_lines"):
            content = (dumps({"schema": "ianz.authored-billing-source/v1", "input": payload,
                              "result": result, "actor": self.context["actor"], "at": self.context["at"]}) + "\n").encode()
            file = self._retain(content, filename="tariff-calculation.json", media_type="application/json",
                                origin="authored_tariff_calculation")
            document_key = "billing-calculation:" + self.context["request_id"]
            self._document_attach({"file_id": file["file_id"], "document_key": document_key,
                                    "document_role": "authored tariff calculation", "visibility": "internal"})
            for calculated in result["lines"]:
                values = {field: value for field, value in calculated.get("canonical", calculated).items() if field in FIELDS["charge_line"]}
                values.setdefault("source_document_key", document_key)
                saved.append(self._put({"entity": "charge_line", "values": values,
                                        "annotations": {"calculation_event_id": event["event_id"],
                                                        "financial_receiving": calculated},
                                        "require_complete": True}))
        return {"calculation": result, "event_id": event["event_id"],
                "saved_charge_lines": [{"key": row["key"], "edition_id": row["edition_id"]} for row in saved]}

    def _source_fingerprint(self):
        return identity({name: [{"key": row["key"], "edition_id": row["edition_id"]}
                                for row in self.records(name, limit=MAX_RECORDS)]
                         for name in ENTITIES if name not in {"mapping_profile", "receiving_run"}})

    def _project_asset_members(self, records, profile):
        selected = set()
        def references(value):
            if isinstance(value, dict):
                for key, item in value.items():
                    if key.endswith("file_id") and isinstance(item, str) and item.startswith("sha256:"):
                        selected.add(item)
                    elif key.endswith("file_ids") and isinstance(item, list):
                        selected.update(item for item in item if isinstance(item, str) and item.startswith("sha256:"))
                    elif isinstance(item, (dict, list)):
                        references(item)
            elif isinstance(value, list):
                for item in value:
                    references(item)
        for entity, rows in records.items():
            if entity in {"mapping_profile", "receiving_run"}:
                continue
            for row in rows:
                references(row)
                values = row["values"]
                if entity == "document" and values.get("content_sha256"):
                    selected.add("sha256:" + values["content_sha256"])
                if entity == "source_edition":
                    for field in ["original_sha256", "transcription_sha256"]:
                        if values.get(field):
                            selected.add("sha256:" + values[field])
        schema_file = (profile.get("native_import_profile") or {}).get("schema_file_id")
        if schema_file:
            selected.add(schema_file)
        selected.update(row[0] for row in self.db.execute(
            "SELECT DISTINCT file_id FROM file_receipts WHERE origin='original_94FE_public_transcription'"))
        files, inventory = {}, []
        for file_id in sorted(selected):
            file = self.file(file_id)
            relative = "assets/" + file["sha256"]
            files[relative] = file["body"]
            inventory.append({"file_id": file_id, "asset_path": relative,
                              **{name: file[name] for name in ["sha256", "bytes", "filename", "media_type"]}})
        return files, inventory

    def _document_projection(self, records):
        result = []
        for row in records.get("document", []):
            values = row["values"]
            file = self.file("sha256:" + values["content_sha256"])
            result.append({"document_key": values["document_key"], "document_edition_id": values["document_edition_id"],
                           "sha256": file["sha256"], "bytes": file["bytes"], "access_class": values["visibility"],
                           "associations": {name: values.get(name) for name in
                                            ["programme_key", "accreditation_key", "assessment_key", "participant_key"]},
                           "native_id": None, "file_id": file["file_id"], "filename": values["original_filename"],
                           "media_type": file["media_type"], "source_record_edition_id": row["edition_id"]})
        return result

    def _run_prepared(self, run_id):
        rows = self.events(subject=run_id, kind="receiving.prepared", limit=2)
        if len(rows) != 1:
            raise WorkspaceError("Choose the one original prepared receiving run.", code="not_found", status=404)
        return rows[0]["payload"]

    def receiving(self, run_id):
        with self.lock:
            prepared = self._run_prepared(run_id)
            events = self.events(subject=run_id, limit=2000)
            current = self.record("receiving_run", run_id)
            return {"record": current, "prepared": prepared, "events": events,
                    "current_sources_match": self._source_fingerprint() == prepared["source_fingerprint"],
                    "current_mapping_matches": self._meta("active_mapping") == prepared["mapping_key"]}

    def _update_run(self, run_id, changes):
        current = self.record("receiving_run", run_id)
        return self._put({"entity": "receiving_run", "values": {**current["values"], **changes},
                          "provenance": current["provenance"], "annotations": current["annotations"],
                          "expected_edition_id": current["edition_id"]})

    def _receiving_prepare(self, payload):
        run_id = payload.get("run_id") or "run-" + str(uuid.uuid4())
        if not isinstance(run_id, str) or not run_id.strip() or len(run_id) > 160:
            raise WorkspaceError("Use one stable receiving run ID.")
        if self.events(subject=run_id, kind="receiving.prepared", limit=1):
            raise WorkspaceError("That native import already has its original saved request. Open the existing run.",
                                 code="run_exists", status=409)
        selected = self.record("mapping_profile", payload["mapping_key"]) if payload.get("mapping_key") else self.active_mapping()
        if not selected:
            raise WorkspaceError("Select a complete saved mapping.")
        profile = selected["values"]
        is_staging = not profile.get("target_environment_id")
        if is_staging and not payload.get("allow_staging"):
            raise WorkspaceError("Choose Download staging, or receive the actual native target descriptor for a native import.")
        records = self.all_records()
        for row in records["accreditation"]:
            if row["values"]["selected_scope_edition_id"] not in profile["source_edition_ids"]:
                raise WorkspaceError("The mapping does not include an accreditation's selected scope edition.",
                                     details={"key": row["key"], "edition": row["values"]["selected_scope_edition_id"]})
        dataset = mapping.export_dataset(records, profile)
        if dataset["issues"]:
            raise WorkspaceError("Resolve the listed source or mapping fields before this complete import.",
                                 code="receiving_issues", status=422, details=dataset["issues"])
        assets, asset_inventory = self._project_asset_members(dataset["canonical_records"], profile)
        documents = self._document_projection(dataset["canonical_records"])
        native_request_id = "native:" + self._meta("project_id") + ":" + run_id
        source_revision = self._meta("revision")
        bodies = {"dataset.json": (dumps(dataset) + "\n").encode(),
                  "mapping.json": (dumps(profile) + "\n").encode(),
                  "documents.json": (dumps(documents) + "\n").encode(),
                  "source-references.json": (dumps(asset_inventory) + "\n").encode()}
        native_request = {
            "schema": "ianz.native-import/v1", "operation_id": OPERATION, "project_id": self._meta("project_id"),
            "run_id": run_id, "native_request_id": native_request_id, "source_revision": source_revision,
            "target_product": profile.get("target_product"), "target_environment_id": profile.get("target_environment_id"),
            "target_schema_version": profile.get("target_schema_version"),
            "mapping_sha256": digest(bodies["mapping.json"])["sha256"],
            "dataset_sha256": digest(bodies["dataset.json"])["sha256"],
            "documents_sha256": digest(bodies["documents.json"])["sha256"], "kind": "staging" if is_staging else "native"}
        bodies["import.json"] = (dumps(native_request) + "\n").encode()
        bodies.update(mapping.csv_members(dataset, profile))
        bodies.update(assets)
        package, manifest = package_bytes(bodies, {"schema": "ianz.native-import-package/v1",
                                                 "operation_id": OPERATION, "project_id": self._meta("project_id"),
                                                 "run_id": run_id, "source_revision": source_revision,
                                                 "native_request_id": native_request_id})
        file = self._retain(package, filename=run_id + "-native-import.zip", media_type="application/zip", origin="native_export")
        # Hash the exact canonical manifest bytes written by package_bytes.
        manifest_sha = digest((dumps(manifest) + "\n").encode())["sha256"]
        prepared = {"run_id": run_id, "native_request": native_request, "outgoing_file_id": file["file_id"],
                    "outgoing_sha256": file["sha256"], "outgoing_bytes": file["bytes"],
                    "import_manifest_sha256": manifest_sha, "source_revision": source_revision,
                    "source_fingerprint": self._source_fingerprint(), "mapping_key": selected["key"],
                    "mapping_record_edition_id": selected["edition_id"], "record_count": len(dataset["records"]),
                    "relationship_count": len(dataset["relationships"]), "asset_count": len(asset_inventory),
                    "document_count": len(documents), "omissions": dataset["omissions"], "kind": native_request["kind"]}
        self._event("receiving.prepared", run_id, prepared)
        self._put({"entity": "receiving_run", "values": {
            "receiving_run_id": run_id, "project_revision": str(source_revision), "mapping_id": selected["key"],
            "source_edition_ids": profile["source_edition_ids"], "outgoing_manifest": manifest,
            "reconciliation": {}, "review_decisions": [], "saved_request_id": self.context["request_id"],
            "status": "staging" if is_staging else "prepared"
        }})
        return {**prepared, "manifest": manifest}

    def _validate_native_identity(self, native, prepared):
        original = prepared["native_request"]
        for name in ["native_request_id", "run_id", "target_product", "target_environment_id", "target_schema_version"]:
            if native.get(name) != original.get(name):
                raise WorkspaceError("The actual native result belongs to different receiving input.", details={"field": name})
        if native.get("import_manifest_sha256") != prepared["import_manifest_sha256"]:
            raise WorkspaceError("The returned native operation does not bind to this exact original import manifest.")

    def _receiving_result(self, payload):
        prepared = self._run_prepared(payload["run_id"])
        if "file_id" in payload:
            file = self.file(payload["file_id"])
            native = loads(file["body"])
        else:
            native = copy(payload["result"])
            file = self._retain((dumps(native) + "\n").encode(), filename="native-result.json",
                                media_type="application/json", origin="native_result")
        if native.get("schema") != "ianz.native-result/v1" or native.get("status") not in {"applied", "partial", "failed"}:
            raise WorkspaceError("Receive the complete actual native result.")
        self._validate_native_identity(native, prepared)
        event = self._event("receiving.native_result", payload["run_id"], {"result": native, "file_id": file["file_id"]})
        self._update_run(payload["run_id"], {"native_result": native,
                                             "status": "imported" if native["status"] == "applied" else native["status"]})
        return {"event_id": event["event_id"], "native_result": native, "file_id": file["file_id"]}

    def _receiving_compare(self, payload):
        run_id = payload["run_id"]
        prepared = self._run_prepared(run_id)
        outgoing = self.file(prepared["outgoing_file_id"])
        original_manifest, original_files = unpack(outgoing["body"], schema="ianz.native-import-package/v1")
        dataset, profile = loads(original_files["dataset.json"]), loads(original_files["mapping.json"])
        original_documents = loads(original_files["documents.json"])
        input_file = self.file(payload["file_id"])
        extra_differences = []
        native_result = None
        if input_file["body"].startswith(b"PK"):
            returned_manifest, returned_files = unpack(input_file["body"], schema="ianz.native-return-package/v1")
            if "return.json" not in returned_files:
                raise WorkspaceError("The returned package has no complete return.json.")
            returned = loads(returned_files["return.json"])
            if "native-result.json" in returned_files:
                native_result = loads(returned_files["native-result.json"])
        else:
            returned_manifest, returned_files = None, {}
            returned = loads(input_file["body"])
        self._validate_native_identity(returned, prepared)
        if native_result is not None:
            if native_result.get("schema") != "ianz.native-result/v1" or native_result.get("status") not in {"applied", "partial", "failed"}:
                raise WorkspaceError("The included original native result is malformed.")
            self._validate_native_identity(native_result, prepared)
            result_file = self._retain(returned_files["native-result.json"], filename="native-result.json",
                                       media_type="application/json", origin="native_result")
            self._event("receiving.native_result", run_id, {"result": native_result, "file_id": result_file["file_id"]})
        source_inventory = loads(original_files["source-references.json"])
        for source in source_inventory:
            body = returned_files.get(source["asset_path"])
            if body is None:
                item = {"kind": "missing_source_asset", "file_id": source["file_id"],
                        "filename": source["filename"], "expected_sha256": source["sha256"], "expected_bytes": source["bytes"]}
                item["difference_id"] = identity(item)
                extra_differences.append(item)
            elif digest(body) != {"bytes": source["bytes"], "sha256": source["sha256"]}:
                item = {"kind": "changed_source_asset", "file_id": source["file_id"], "filename": source["filename"],
                        "expected": {"bytes": source["bytes"], "sha256": source["sha256"]}, "returned": digest(body)}
                item["difference_id"] = identity(item)
                extra_differences.append(item)
        for relative, body in returned_files.items():
            if relative.startswith("assets/"):
                self._retain(body, filename=relative.split("/")[-1], media_type="application/octet-stream",
                             origin="native_return_asset", annotations={"run_id": run_id, "returned_member": relative})
        returned_documents = []
        for item in returned.get("documents", []):
            row = copy(item)
            path = "assets/" + str(row.get("sha256", ""))
            body = returned_files.get(path)
            if body is None and row.get("file_id"):
                # Raw JSON returns may reference separately received original bytes.
                try:
                    body = self.file(row["file_id"])["body"]
                except WorkspaceError:
                    body = None
            row["declared_sha256"], row["declared_bytes"] = row.get("sha256"), row.get("bytes")
            if body is not None:
                row.update(digest(body))
                row["file_id"] = "sha256:" + row["sha256"]
            else:
                row.update(sha256=None, bytes=None, body_missing=True)
            returned_documents.append(row)
        comparison = mapping.reconcile(dataset, profile, returned, original_documents, returned_documents)
        comparison["differences"].extend(extra_differences)
        if dataset["canonical_records"].get("charge_line"):
            from billing import reconcile_billing
            original_lines = []
            for row in dataset["canonical_records"]["charge_line"]:
                original_lines.append({**row["values"], **row["annotations"].get("financial_receiving", {}).get("original", {})})
            reverse_fields = {entry["target_field"]: entry["source_field"] for entry in profile["field_maps"]
                              if entry["entity"] == "charge_line" and entry.get("mode") == "copy"}
            target_table = next((entry["target_entity"] for entry in profile["field_maps"]
                                 if entry["entity"] == "charge_line" and entry.get("mode") == "copy"), "charge_line")
            actual_lines = returned.get("billing_lines") or [{reverse_fields[key]: value for key, value in row["values"].items() if key in reverse_fields}
                            for row in returned["records"] if row["target_entity"] == target_table]
            billing_profiles = [row["values"] for row in dataset["canonical_records"].get("fee_profile", [])]
            policy = payload.get("billing_policy", profile.get("native_import_profile", {}).get("billing_policy", {}))
            try:
                billing_result = reconcile_billing(original_lines, actual_lines, billing_profiles, policy)
                comparison["billing"] = billing_result
                for difference in billing_result.get("differences", []):
                    item = {"kind": "billing_" + difference.get("kind", "difference"), "detail": difference}
                    item["difference_id"] = identity(item)
                    comparison["differences"].append(item)
            except ValueError as error:
                item = {"kind": "billing_receiving_configuration", "message": str(error)}
                item["difference_id"] = identity(item)
                comparison["differences"].append(item)
        comparison["summary"]["difference_count"] = len(comparison["differences"])
        comparison["summary"]["kinds"] = dict(collections.Counter(row["kind"] for row in comparison["differences"]))
        comparison.update(run_id=run_id, source_revision=prepared["source_revision"],
                          mapping_key=prepared["mapping_key"], returned_file_id=input_file["file_id"],
                          returned_sha256=input_file["sha256"], import_manifest_sha256=prepared["import_manifest_sha256"],
                          compared_at=self.context["at"])
        event = self._event("receiving.compared", run_id, comparison)
        changes = {"returned_manifest": returned_manifest or {"schema": "ianz.raw-return/v1", **digest(input_file["body"])},
                   "reconciliation": {"comparison_event_id": event["event_id"], **comparison},
                   "status": "compared"}
        if native_result:
            changes["native_result"] = native_result
        self._update_run(run_id, changes)
        return {"comparison_event_id": event["event_id"], **comparison}

    def _receiving_review(self, payload):
        run_id = payload["run_id"]
        current = self.record("receiving_run", run_id)
        comparison = current["values"]["reconciliation"]
        if payload.get("comparison_event_id") != comparison.get("comparison_event_id"):
            raise WorkspaceError("Review the latest actual returned comparison; the selected comparison has changed.",
                                 code="comparison_conflict", status=409)
        by_id = {row["difference_id"]: row for row in comparison["differences"]}
        decisions = payload.get("decisions", [])
        if not isinstance(decisions, list) or not decisions:
            raise WorkspaceError("Select at least one actual difference to review.")
        reviewed = []
        for item in decisions:
            difference = by_id.get(item.get("difference_id"))
            if not difference:
                raise WorkspaceError("That difference is absent from the selected complete comparison.")
            choice = item.get("choice")
            if choice not in {"keep_visible", "accept_representation", "accept_scope_change"}:
                raise WorkspaceError("Choose keep visible, a reversible representation, or an explicit scope change.")
            if not isinstance(item.get("reason"), str) or not item["reason"].strip():
                raise WorkspaceError("Save the specific review reason.")
            if choice == "accept_representation":
                reverse = item.get("reverse_mapping")
                if (difference["kind"] != "field_difference" or not isinstance(reverse, dict)
                        or reverse.get("source") != difference.get("expected")
                        or reverse.get("target") != difference.get("returned")):
                    raise WorkspaceError("A representation acceptance must preserve the exact source/target pair and its reverse mapping.")
            reviewed.append({**item, "comparison_event_id": payload["comparison_event_id"],
                             "source_revision": comparison["source_revision"], "mapping_key": comparison["mapping_key"],
                             "reviewer": self.context["actor"], "reviewed_at": self.context["at"]})
        event = self._event("receiving.reviewed", run_id, {"decisions": reviewed})
        saved = current["values"].get("review_decisions", []) + reviewed
        self._update_run(run_id, {"review_decisions": saved, "status": "reviewed"})
        return {"event_id": event["event_id"], "decisions": reviewed}

    def _receiving_complete(self, payload):
        run_id = payload["run_id"]
        prepared = self._run_prepared(run_id)
        current = self.record("receiving_run", run_id)["values"]
        comparison = current["reconciliation"]
        if not comparison.get("comparison_event_id"):
            raise WorkspaceError("Receive and compare the complete actual target export first.")
        if self._source_fingerprint() != prepared["source_fingerprint"]:
            raise WorkspaceError("Source records changed after this native request. Prepare the next receiving run from the current records.",
                                 code="source_changed", status=409)
        if self._meta("active_mapping") != prepared["mapping_key"]:
            raise WorkspaceError("The active mapping changed. Continue the receiving run for the selected mapping.", code="mapping_changed", status=409)
        if current.get("native_result", {}).get("status") != "applied":
            raise WorkspaceError("Retain the original applied native result for this receiving operation.")
        decisions = {row["difference_id"]: row for row in current["review_decisions"]
                     if row["comparison_event_id"] == comparison["comparison_event_id"]}
        unresolved = [row for row in comparison["differences"]
                      if decisions.get(row["difference_id"], {}).get("choice", "keep_visible") == "keep_visible"]
        if unresolved:
            raise WorkspaceError("These returned differences remain open.", code="unresolved_differences",
                                 status=422, details=unresolved)
        result = {"run_id": run_id, "source_revision": prepared["source_revision"],
                  "comparison_event_id": comparison["comparison_event_id"],
                  "differences": len(comparison["differences"]), "reviewed_differences": len(decisions),
                  "accepted_scope_changes": sum(row["choice"] == "accept_scope_change" for row in decisions.values()),
                  "completed_at": self.context["at"], "completed_by": self.context["actor"]}
        event = self._event("receiving.completed", run_id, result)
        self._update_run(run_id, {"status": "completed"})
        return {"event_id": event["event_id"], **result}

    def snapshot(self):
        with self.lock:
            self.db.execute("BEGIN")
            try:
                metadata = self.metadata()
                state = {
                    "schema": FORMAT, "metadata": metadata,
                    "assets": [dict(row) for row in self.db.execute("SELECT file_id,sha256,bytes FROM assets ORDER BY file_id")],
                    "file_receipts": [dict(row) for row in self.db.execute("SELECT * FROM file_receipts ORDER BY revision,receipt_id")],
                    "editions": [dict(row) for row in self.db.execute("SELECT * FROM editions ORDER BY revision,edition_id")],
                    "heads": [dict(row) for row in self.db.execute("SELECT * FROM heads ORDER BY entity,record_key")],
                    "commands": [dict(row) for row in self.db.execute("SELECT * FROM commands ORDER BY revision,request_id")],
                    "events": [dict(row) for row in self.db.execute("SELECT * FROM events ORDER BY revision,event_id")]
                }
                assets = {"assets/" + row["sha256"]: row["body"] for row in self.db.execute("SELECT * FROM assets ORDER BY file_id")}
                self.db.commit()
                return state, assets
            except Exception:
                self.db.rollback()
                raise

    def handover(self):
        state, assets = self.snapshot()
        from seed import PUBLIC_FILES
        source_files = [
            "schema.py", "seed.py", "mapping.py", "workspace.py", "server.py", "cli.py", "documents.py",
            "billing.py", "reference_receiver.py", "README.md", "OPERATING.md", "DOCUMENTS.md", "BILLING.md",
            "RECEIVING.md", "INTEGRATION.md", "operate.py", "operate_browser.mjs",
            "web/index.html", "web/app.js", "web/style.css", *PUBLIC_FILES
        ]
        files = {"project/state.json": (dumps(state) + "\n").encode(), **assets}
        missing = [name for name in source_files if not (ROOT / name).is_file()]
        if missing:
            raise WorkspaceError("The installed application is missing complete handover source files.", details=missing)
        files.update({"application/" + name: (ROOT / name).read_bytes() for name in source_files})
        files["OPEN_PROJECT.txt"] = (
            "IANZ Ara Hono complete editable project\n\n"
            "The project keeps its original identity, records, request history and complete assets.\n"
            "Extract the application/ directory, then use its CLI to receive this whole ZIP into an empty directory:\n"
            "python application/cli.py --workspace reopened receive-handover original-handover.zip --actor operator --reason 'Continue original project'\n"
            "python application/server.py --workspace reopened --port 8765\n\n"
            "Read application/README.md and application/OPERATING.md for all commands and receiving steps.\n"
            "Public source observation, authored quantities, native metadata, actual returned records and reviewed differences remain separately labelled.\n"
        ).encode()
        return package_bytes(files, {"schema": "ianz.handover/v1", "operation_id": OPERATION,
                                     "project_id": state["metadata"]["project_id"], "revision": state["metadata"]["revision"],
                                     "name": state["metadata"]["name"]})

    def _handover_receive(self, payload):
        if self._meta("revision") != 0 or self.db.execute("SELECT 1 FROM editions LIMIT 1").fetchone():
            raise WorkspaceError("Receive this complete project into a new empty workspace to preserve both histories.",
                                 code="workspace_not_empty", status=409)
        body = self._body(payload)
        manifest, members = unpack(body, schema="ianz.handover/v1")
        state = loads(members.get("project/state.json", b"null"))
        if not isinstance(state, dict) or state.get("schema") != FORMAT:
            raise WorkspaceError("The handover has no complete project state.")
        metadata = state.get("metadata", {})
        if (metadata.get("format") != FORMAT or metadata.get("operation") != OPERATION
                or metadata.get("project_id") != manifest.get("project_id")
                or metadata.get("revision") != manifest.get("revision")
                or type(metadata.get("revision")) is not int or metadata["revision"] < 0):
            raise WorkspaceError("The project and handover identity differ.")
        for collection in ["assets", "file_receipts", "editions", "heads", "commands", "events"]:
            if not isinstance(state.get(collection), list):
                raise WorkspaceError("The complete project is missing " + collection + ".")
        if len(state["editions"]) > MAX_RECORDS * 20:
            raise WorkspaceError("The project history exceeds this receiving capacity.")
        assets = {row["file_id"]: row for row in state["assets"]}
        if len(assets) != len(state["assets"]):
            raise WorkspaceError("The original asset inventory has duplicates.")
        for file_id, row in assets.items():
            if file_id != "sha256:" + row["sha256"]:
                raise WorkspaceError("The original asset ID differs from its content identity.")
            raw = members.get("assets/" + row["sha256"])
            if raw is None or digest(raw) != {"bytes": row["bytes"], "sha256": row["sha256"]}:
                raise WorkspaceError("An original project asset is incomplete: " + file_id)
        editions = {row["edition_id"]: row for row in state["editions"]}
        if len(editions) != len(state["editions"]):
            raise WorkspaceError("The original record editions are duplicated.")
        for row in editions.values():
            values = loads(row["values_json"])
            validate_record(row["entity"], values)
            if record_key(row["entity"], values) != row["record_key"]:
                raise WorkspaceError("A record edition's original key changed.")
            if type(row["revision"]) is not int or not 1 <= row["revision"] <= metadata["revision"]:
                raise WorkspaceError("A record has an invalid saved revision.")
            previous = row.get("previous_id")
            if previous:
                parent = editions.get(previous)
                if not parent or (parent["entity"], parent["record_key"]) != (row["entity"], row["record_key"]) or parent["revision"] > row["revision"]:
                    raise WorkspaceError("A record's retained previous edition is invalid.")
            item = {"entity": row["entity"], "key": row["record_key"], "values": values,
                    "provenance": loads(row["provenance_json"]), "annotations": loads(row["annotations_json"]),
                    "revision": row["revision"], "actor": row["actor"], "reason": row["reason"],
                    "created_at": row["created_at"], "previous_id": row["previous_id"]}
            if "record:" + identity(item) != row["edition_id"]:
                raise WorkspaceError("A complete record edition differs from its retained identity.")
        visited = set()
        head_keys = set()
        for head in state["heads"]:
            pair = (head["entity"], head["record_key"])
            if pair in head_keys:
                raise WorkspaceError("The current record selection contains a duplicate key.")
            head_keys.add(pair)
            selected = head["edition_id"]
            chain = set()
            while selected:
                row = editions.get(selected)
                if not row or (row["entity"], row["record_key"]) != pair or selected in chain:
                    raise WorkspaceError("The complete record history contains a missing edition, fork or cycle.")
                chain.add(selected)
                visited.add(selected)
                selected = row["previous_id"]
        if visited != set(editions):
            raise WorkspaceError("The handover has record history that is absent from the current original lineage.")
        command_ids = [row["request_id"] for row in state["commands"]]
        if len(command_ids) != len(set(command_ids)) or self.context["request_id"] in command_ids:
            raise WorkspaceError("The original request inventory has a duplicate request ID.")
        for row in state["commands"]:
            request, result = loads(row["request_json"]), loads(row["result_json"])
            if request.get("request_id") != row["request_id"] or result.get("request_id") != row["request_id"]:
                raise WorkspaceError("An accepted original request and its result differ.")
            if result.get("revision") != row["revision"] or not 1 <= row["revision"] <= metadata["revision"]:
                raise WorkspaceError("An original accepted result has a different revision.")
        # No uploaded code or database is executed. The validated rows and complete
        # binary bodies are received through this installed application's schema.
        for key, value in metadata.items():
            self._meta_put(key, value)
        for file_id, row in assets.items():
            self.db.execute("INSERT INTO assets VALUES(?,?,?,?)",
                            (file_id, row["sha256"], row["bytes"], members["assets/" + row["sha256"]]))
        columns = {
            "file_receipts": ["receipt_id", "file_id", "filename", "media_type", "origin", "source_id", "source_url",
                              "received_at", "request_id", "revision", "annotations_json"],
            "editions": ["edition_id", "entity", "record_key", "values_json", "provenance_json", "annotations_json",
                         "revision", "actor", "reason", "created_at", "previous_id"],
            "heads": ["entity", "record_key", "edition_id"],
            "commands": ["request_id", "fingerprint", "request_json", "result_json", "revision", "accepted_at"],
            "events": ["event_id", "kind", "subject", "payload_json", "request_id", "revision", "created_at"]
        }
        # Parent editions can share a command revision; insert in lineage order.
        waiting = list(state["editions"])
        inserted = set()
        while waiting:
            ready = [row for row in waiting if row["previous_id"] is None or row["previous_id"] in inserted]
            if not ready:
                raise WorkspaceError("The source record lineage cannot be restored.")
            for row in ready:
                fields = columns["editions"]
                self.db.execute("INSERT INTO editions(" + ",".join(fields) + ") VALUES(" + ",".join("?" for _ in fields) + ")",
                                [row[field] for field in fields])
                inserted.add(row["edition_id"])
            waiting = [row for row in waiting if row["edition_id"] not in inserted]
        for table in ["file_receipts", "heads", "commands", "events"]:
            fields = columns[table]
            for row in state[table]:
                self.db.execute("INSERT INTO " + table + "(" + ",".join(fields) + ") VALUES(" + ",".join("?" for _ in fields) + ")",
                                [row[field] for field in fields])
        self.context["revision"] = metadata["revision"] + 1
        self.context["request_copy"]["payload"] = {"received_package": digest(body), "manifest": manifest,
                                                 "complete_members_received": True}
        receipt = {"original_project_id": metadata["project_id"], "original_revision": metadata["revision"],
                   "received_package": digest(body), "records": len(state["heads"]), "record_editions": len(editions),
                   "assets": len(assets), "original_requests": len(state["commands"]),
                   "application_sources": len([name for name in members if name.startswith("application/")])}
        self._event("handover.received", metadata["project_id"], receipt)
        return receipt

    def summary(self):
        with self.lock:
            metadata = self.metadata()
            counts = {row["entity"]: row["count"] for row in self.db.execute("SELECT entity,COUNT(*) AS count FROM heads GROUP BY entity")}
            asset = self.db.execute("SELECT COUNT(*) AS count,COALESCE(SUM(bytes),0) AS bytes FROM assets").fetchone()
            selected = self.active_mapping()
            source_records = self.records("source_edition", limit=MAX_RECORDS)
            runs = self.records("receiving_run", limit=1000)
            return {"metadata": metadata, "counts": {entity: counts.get(entity, 0) for entity in ENTITIES},
                    "assets": dict(asset), "mapping": selected,
                    "source_selection": [{"key": row["key"], "source_id": row["values"]["source_id"],
                                          "selected": row["values"]["selected_for_current"],
                                          "has_original_bytes": bool(row["values"].get("original_sha256")),
                                          "coverage": row["values"]["coverage"]} for row in source_records],
                    "receiving_runs": [{"run_id": row["key"], "status": row["values"]["status"],
                                        "source_revision": row["values"]["project_revision"],
                                        "difference_count": row["values"].get("reconciliation", {}).get("summary", {}).get("difference_count"),
                                        "revision": row["revision"]} for row in runs],
                    "last_events": self.events(limit=40, after_revision=max(0, metadata["revision"] - 20)),
                    "schema": {"operation": OPERATION, "entities": list(ENTITIES.values())}}
