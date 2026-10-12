"""MIT. Retained Kafka operations over the original NDJSON workspace and engine."""
from __future__ import annotations
import io
import os
from pathlib import Path
import shutil
import sqlite3
import stat
import threading
import uuid
import zipfile

from shared import RetainedWorkspace, InputError, json_bytes, load_json, private_write, file_digest, sync_dir, ndjson_source
from contract import (MAX_SOURCE, ACTIVE, STATUS, now, digest, ident, operation, exact, integer,
                      offset, label, config, wire, unb64, decoded, api_message, default_plan)
from transport import client_status, inspect_source, capture_batches, CaptureProblem

SCHEMA = "stellar-forge.kafka-workspace.v1"


class Workspace(RetainedWorkspace):
    def __init__(self, root, create=False):
        super().__init__(root, create=create)
        self._kdb = None
        self._thread = None
        self._cancel = threading.Event()
        self._active = None
        self._closed = False
        try:
            marker = self.root / "kafka-workspace.json"
            if create:
                private_write(marker, json_bytes({"schema": SCHEMA, "id": str(uuid.uuid4())}))
                sync_dir(self.root)
            file_digest(marker, 4096)
            self.kafka_marker = load_json(marker.read_bytes())
            exact(self.kafka_marker, {"schema", "id"})
            if self.kafka_marker["schema"] != SCHEMA or str(uuid.UUID(self.kafka_marker["id"])) != self.kafka_marker["id"]:
                raise InputError("Choose an original Kafka workspace")
            database = self.root / "kafka.sqlite"
            if not database.exists():
                private_write(database, b"")
            info = database.lstat()
            if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or os.name == "posix" and (info.st_uid != os.getuid() or info.st_mode & 0o077):
                raise InputError("The original Kafka database must be a private operator-owned regular file")
            self._kdb = sqlite3.connect(database, check_same_thread=False)
            self._kdb.row_factory = sqlite3.Row
            self._kdb.executescript("""
                PRAGMA journal_mode=DELETE;
                PRAGMA synchronous=FULL;
                CREATE TABLE IF NOT EXISTS kafka_operations(kind TEXT NOT NULL,operation TEXT NOT NULL,
                    args_sha TEXT NOT NULL,args TEXT NOT NULL,result_id TEXT,created TEXT NOT NULL,
                    PRIMARY KEY(kind,operation));
                CREATE TABLE IF NOT EXISTS kafka_connections(id TEXT NOT NULL,revision INTEGER NOT NULL,
                    body TEXT NOT NULL,PRIMARY KEY(id,revision));
                CREATE TABLE IF NOT EXISTS kafka_inspections(id TEXT PRIMARY KEY,body TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS kafka_captures(id TEXT PRIMARY KEY,body TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS kafka_capture_revisions(id TEXT NOT NULL,revision INTEGER NOT NULL,
                    body TEXT NOT NULL,PRIMARY KEY(id,revision));
                CREATE TABLE IF NOT EXISTS kafka_attempt_metadata(id TEXT PRIMARY KEY,body TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS kafka_messages(id TEXT PRIMARY KEY,sha TEXT NOT NULL,
                    cluster_id TEXT NOT NULL,topic_id TEXT NOT NULL,topic TEXT NOT NULL,
                    partition_id INTEGER NOT NULL,offset_value INTEGER NOT NULL,key_id TEXT,
                    tombstone INTEGER NOT NULL,goldsky_operation TEXT,bytes INTEGER NOT NULL,body TEXT NOT NULL);
                CREATE INDEX IF NOT EXISTS kafka_message_order ON kafka_messages(cluster_id,topic_id,partition_id,offset_value);
                CREATE INDEX IF NOT EXISTS kafka_key_order ON kafka_messages(key_id,offset_value);
                CREATE TABLE IF NOT EXISTS kafka_capture_messages(capture_id TEXT NOT NULL,message_id TEXT NOT NULL,
                    role TEXT NOT NULL,added_revision INTEGER NOT NULL,PRIMARY KEY(capture_id,message_id));
                CREATE INDEX IF NOT EXISTS kafka_capture_history ON kafka_capture_messages(capture_id,added_revision);
                CREATE TABLE IF NOT EXISTS kafka_conflicts(capture_id TEXT NOT NULL,message_id TEXT NOT NULL,
                    sha TEXT NOT NULL,body TEXT NOT NULL,created TEXT NOT NULL,PRIMARY KEY(capture_id,message_id,sha));
                CREATE TABLE IF NOT EXISTS kafka_projections(id TEXT PRIMARY KEY,source_id TEXT NOT NULL,body TEXT NOT NULL);
                CREATE INDEX IF NOT EXISTS kafka_projection_source ON kafka_projections(source_id);
                CREATE TABLE IF NOT EXISTS kafka_projection_refs(projection_id TEXT NOT NULL,capture_id TEXT NOT NULL,
                    message_id TEXT NOT NULL,role TEXT NOT NULL,added_revision INTEGER NOT NULL,
                    PRIMARY KEY(projection_id,capture_id,message_id));
                CREATE TABLE IF NOT EXISTS kafka_projection_events(projection_id TEXT NOT NULL,message_id TEXT NOT NULL,
                    selected INTEGER NOT NULL,PRIMARY KEY(projection_id,message_id));
                CREATE TABLE IF NOT EXISTS kafka_imports(id TEXT PRIMARY KEY,body TEXT NOT NULL);
            """)
            for row in self._kdb.execute("SELECT body FROM kafka_captures").fetchall():
                value = load_json(row["body"])
                if value["status"] in ACTIVE:
                    value["status"] = "INTERRUPTED"
                    value["error"] = {"message": "The original console process stopped before this capture closed; resume its retained offsets"}
                    if value["attempts"] and value["attempts"][-1]["endedAt"] is None:
                        value["attempts"][-1].update(endedAt=now(), status="INTERRUPTED", error=value["error"])
                    self._advance(value)
        except BaseException:
            if self._kdb is not None:
                self._kdb.close()
            super().close()
            raise

    def close(self):
        if self._closed:
            return
        self._cancel.set()
        worker = self._thread
        if worker is not None and worker is not threading.current_thread():
            worker.join()
        self._closed = True
        try:
            self._kdb.close()
        finally:
            super().close()

    def _record(self, table, value):
        checked = ident(value)
        with self.mutex:
            row = self._kdb.execute("SELECT body FROM " + table + " WHERE id=?", (checked,)).fetchone()
            if row is None:
                raise FileNotFoundError("Retained Kafka operation was not found")
            return load_json(row["body"])

    def _reserve(self, kind, name, args):
        operation(name)
        encoded = json_bytes(args).decode()
        checksum = digest(encoded.encode())
        row = self._kdb.execute("SELECT * FROM kafka_operations WHERE kind=? AND operation=?", (kind, name)).fetchone()
        if row is not None:
            if row["args_sha"] != checksum or row["args"] != encoded:
                raise InputError("This operation name already belongs to different original inputs; reopen it or choose a new operation")
            return dict(row)
        with self._kdb:
            self._kdb.execute("INSERT INTO kafka_operations VALUES(?,?,?,?,NULL,?)", (kind, name, checksum, encoded, now()))
        return dict(self._kdb.execute("SELECT * FROM kafka_operations WHERE kind=? AND operation=?", (kind, name)).fetchone())

    def _finish_operation(self, kind, name, result_id):
        self._kdb.execute("UPDATE kafka_operations SET result_id=? WHERE kind=? AND operation=?", (result_id, kind, name))

    def state(self):
        with self.mutex:
            value = super().state()
            latest = self._kdb.execute("""SELECT c.body FROM kafka_connections c
                JOIN (SELECT id,MAX(revision) AS revision FROM kafka_connections GROUP BY id) current
                ON current.id=c.id AND current.revision=c.revision ORDER BY c.id""").fetchall()
            def all_records(table):
                return sorted([load_json(row["body"]) for row in self._kdb.execute("SELECT body FROM " + table)],
                              key=lambda item: item.get("createdAt", item.get("observedAt", "")), reverse=True)
            value["kafka"] = {"schema": "stellar-forge.kafka-state.v1", "workspaceId": self.kafka_marker["id"],
                "client": client_status(), "connections": [load_json(row["body"]) for row in latest],
                "inspections": all_records("kafka_inspections"), "captures": all_records("kafka_captures"),
                "projections": all_records("kafka_projections"), "activeCapture": self._active}
            return value

    def save_connection(self, request):
        exact(request, {"connection", "expectedRevision", "operation", "config"})
        name = operation(request["connection"])
        revision = integer(request["expectedRevision"], 0, 1000000, "Expected connection revision")
        settings = config(request["config"])
        saved_request = {**request, "config": settings}
        with self.mutex:
            pending = self._reserve("connection", request["operation"], saved_request)
            if pending["result_id"] is not None:
                name_saved, revision_saved = pending["result_id"].rsplit("@", 1)
                return self.connection(name_saved, int(revision_saved))
            row = self._kdb.execute("SELECT MAX(revision) AS revision FROM kafka_connections WHERE id=?", (name,)).fetchone()
            current = row["revision"] or 0
            if current != revision:
                raise InputError("The connection changed; inspect its current revision before saving")
            value = {"id": name, "revision": revision + 1, "sha256": digest(json_bytes(settings)),
                     "operation": request["operation"], "config": settings, "createdAt": pending["created"]}
            with self._kdb:
                self._kdb.execute("INSERT INTO kafka_connections VALUES(?,?,?)", (name, revision + 1, json_bytes(value).decode()))
                self._finish_operation("connection", request["operation"], name + "@" + str(revision + 1))
            return value

    def connection(self, name, revision=None):
        operation(name)
        with self.mutex:
            if revision is not None:
                integer(revision, 1, 1000001, "Connection revision")
                row = self._kdb.execute("SELECT body FROM kafka_connections WHERE id=? AND revision=?", (name, revision)).fetchone()
                if row is None:
                    raise FileNotFoundError("Retained Kafka connection revision was not found")
                return load_json(row["body"])
            rows = self._kdb.execute("SELECT body FROM kafka_connections WHERE id=? ORDER BY revision DESC", (name,)).fetchall()
            if not rows:
                raise FileNotFoundError("Retained Kafka connection was not found")
            revisions = [load_json(row["body"]) for row in rows]
            return revisions[0] | {"revisions": revisions}

    def inspect_connection(self, request):
        exact(request, {"connection", "revision", "operation"})
        with self.mutex:
            selected = self.connection(request["connection"], request["revision"])
            pending = self._reserve("inspection", request["operation"], request)
            if pending["result_id"] is not None:
                return self.inspection(pending["result_id"])
            # The original writer serializes a repeated metadata operation. This is
            # explicit user-selected broker work, never part of state or UI startup.
            metadata = inspect_source(selected["config"], digest(json_bytes(request)))
            value = {"operation": request["operation"], "connection": selected["id"],
                "connectionRevision": selected["revision"], "configSha256": selected["sha256"], **metadata}
            value = {"id": digest(json_bytes(value)), **value}
            with self._kdb:
                self._kdb.execute("INSERT INTO kafka_inspections VALUES(?,?)", (value["id"], json_bytes(value).decode()))
                self._finish_operation("inspection", request["operation"], value["id"])
            return value

    def inspection(self, value):
        return self._record("kafka_inspections", value)

    def prepare_capture(self, request):
        exact(request, {"inspection", "operation", "ranges"})
        with self.mutex:
            inspection = self.inspection(request["inspection"])
            values = request["ranges"]
            if not isinstance(values, list) or not 1 <= len(values) <= 4096:
                raise InputError("Select 1–4096 explicit original partition ranges")
            seen, selected = set(), []
            available = {row["partition"]: row for row in inspection["partitions"]}
            for raw in values:
                exact(raw, {"partition", "start", "end"})
                partition = integer(raw["partition"], 0, 2147483647, "Partition")
                start, end = offset(raw["start"]), offset(raw["end"])
                if partition in seen or partition not in available:
                    raise InputError("Select unique partitions from the retained original inspection")
                original = available[partition]
                if not int(original["low"]) <= int(start) <= int(end) <= int(original["end"]):
                    raise InputError("The selected range must fit the retained committed low/end offsets")
                seen.add(partition)
                selected.append({"partition": partition, "start": start, "end": end})
            selected.sort(key=lambda row: row["partition"])
            normalized = {**request, "ranges": selected}
            pending = self._reserve("capture", request["operation"], normalized)
            if pending["result_id"] is not None:
                return self.capture(pending["result_id"])
            value = {"id": digest(json_bytes(normalized)), "operation": request["operation"],
                "inspection": inspection["id"], "connection": inspection["connection"],
                "connectionRevision": inspection["connectionRevision"], "configSha256": inspection["configSha256"],
                **{key: inspection[key] for key in ("clusterId", "topicId", "topic")},
                "status": "PREPARED", "revision": 1, "records": 0, "bytes": 0,
                "retainedBytes": 0, "boundaryBytes": 0, "boundaryRecords": 0,
                "ranges": [{**row, "next": row["start"], "status": "PREPARED",
                    "records": 0, "bytes": 0, "terminalEvidence": None} for row in selected],
                "createdAt": pending["created"], "updatedAt": pending["created"], "error": None, "attempts": []}
            with self._kdb:
                encoded = json_bytes(value).decode()
                self._kdb.execute("INSERT INTO kafka_captures VALUES(?,?)", (value["id"], encoded))
                self._kdb.execute("INSERT INTO kafka_capture_revisions VALUES(?,?,?)", (value["id"], 1, encoded))
                self._finish_operation("capture", request["operation"], value["id"])
            return value

    def capture(self, value, revision=None):
        if revision is None:
            return self._record("kafka_captures", value)
        ident(value)
        integer(revision, 1, 1000000000, "Capture revision")
        with self.mutex:
            row = self._kdb.execute("SELECT body FROM kafka_capture_revisions WHERE id=? AND revision=?", (value, revision)).fetchone()
            if row is None:
                raise FileNotFoundError("Retained Kafka capture revision was not found")
            return load_json(row["body"])

    def _advance(self, value):
        value["revision"] += 1
        value["updatedAt"] = now()
        encoded = json_bytes(value).decode()
        with self._kdb:
            self._kdb.execute("UPDATE kafka_captures SET body=? WHERE id=?", (encoded, value["id"]))
            self._kdb.execute("INSERT INTO kafka_capture_revisions VALUES(?,?,?)", (value["id"], value["revision"], encoded))
        return value

    def run_capture(self, value, expected_revision, background=False, cancel_event=None):
        with self.mutex:
            capture = self.capture(value)
            if self._closed:
                raise InputError("The original Kafka workspace is closing")
            if self._active == value:
                return capture
            if self._active is not None:
                raise InputError("A native Kafka capture already owns this workspace; use its retained operation or cancel it")
            if capture["status"] == "COMPLETE":
                return capture
            if capture["revision"] != integer(expected_revision, 1, 1000000000, "Expected capture revision"):
                raise InputError("The capture changed; inspect its current revision before resuming")
            settings = self.connection(capture["connection"], capture["connectionRevision"])
            if settings["sha256"] != capture["configSha256"]:
                raise InputError("The original capture's immutable connection binding changed")
            available = client_status()
            if not available["available"]:
                raise InputError(available["message"])
            capture["status"], capture["error"] = "RUNNING", None
            capture["attempts"].append({"id": digest(json_bytes({"capture": value, "revision": capture["revision"], "started": now()})),
                "startedAt": now(), "endedAt": None, "status": "RUNNING", "client": available, "error": None})
            self._advance(capture)
            self._cancel = cancel_event if cancel_event is not None else threading.Event()
            self._active = value
            if background:
                self._thread = threading.Thread(target=self._work, args=(value,), name="kafka-" + value[:12], daemon=False)
                try:
                    self._thread.start()
                except BaseException:
                    self._active = self._thread = None
                    capture["status"] = "INTERRUPTED"
                    capture["attempts"][-1].update(status="INTERRUPTED", endedAt=now())
                    self._advance(capture)
                    raise
                return capture
        self._work(value)
        return self.capture(value)

    def cancel_capture(self, value):
        with self.mutex:
            capture = self.capture(value)
            if self._active == value:
                self._cancel.set()
                if capture["status"] == "RUNNING":
                    capture["status"] = "CANCELLING"
                    self._advance(capture)
            return capture

    def _message_fields(self, raw):
        key = raw["keyBase64"]
        key_id = None if key is None else digest(json_bytes({
            "clusterId": raw["clusterId"], "topicId": raw["topicId"],
            "partition": raw["partition"], "keyBase64": key}))
        operations = [unb64(header["valueBase64"]) for header in raw["headers"] if header["name"] == "dbz.op"]
        gs = operations[0].decode("ascii") if len(operations) == 1 and operations[0] in {b"c", b"u", b"d"} else None
        return key_id, int(raw["valueBase64"] is None), gs

    def _insert_message(self, record):
        raw = record["wire"]
        key_id, tombstone, gs = self._message_fields(raw)
        self._kdb.execute("INSERT OR IGNORE INTO kafka_messages VALUES(?,?,?,?,?,?,?,?,?,?,?,?)", (
            record["id"], record["sha256"], raw["clusterId"], raw["topicId"], raw["topic"],
            raw["partition"], int(raw["offset"]), key_id, tombstone, gs, record["bytes"], json_bytes(raw).decode()))

    def _batch(self, value, batch):
        with self.mutex:
            capture = self.capture(value)
            ranges = {row["partition"]: row for row in capture["ranges"]}
            verified = []
            for item in batch["messages"]:
                if item["role"] not in {"record", "boundary"}:
                    raise InputError("Unknown native Kafka capture record role")
                record = wire(item["record"]["wire"])
                raw = record["wire"]
                if any(raw[key] != capture[key] for key in ("clusterId", "topicId", "topic")) or raw["partition"] not in ranges:
                    raise InputError("Native Kafka message belongs to another original source")
                selected = ranges[raw["partition"]]
                if int(raw["offset"]) < int(selected["start"]) or (item["role"] == "record" and int(raw["offset"]) >= int(selected["end"])) or (item["role"] == "boundary" and int(raw["offset"]) < int(selected["end"])):
                    raise InputError("Native Kafka message falls outside its declared record or boundary role")
                existing = self._kdb.execute("SELECT sha FROM kafka_messages WHERE id=?", (record["id"],)).fetchone()
                if existing is not None and existing["sha"] != record["sha256"]:
                    with self._kdb:
                        self._kdb.execute("INSERT OR IGNORE INTO kafka_conflicts VALUES(?,?,?,?,?)",
                            (value, record["id"], record["sha256"], json_bytes(raw).decode(), now()))
                    raise CaptureProblem("SOURCE_CONFLICT", "The same original Kafka partition/offset returned different wire bytes",
                                         {"eventId": record["id"], "retainedSha256": existing["sha"], "observedSha256": record["sha256"]})
                verified.append((item["role"], record))
            next_revision = capture["revision"] + 1
            with self._kdb:
                for role, record in verified:
                    self._insert_message(record)
                    inserted = self._kdb.execute("INSERT OR IGNORE INTO kafka_capture_messages VALUES(?,?,?,?)",
                        (value, record["id"], role, next_revision)).rowcount
                    if inserted:
                        capture["retainedBytes"] += record["bytes"]
                        if role == "boundary":
                            capture["boundaryBytes"] += record["bytes"]
                            capture["boundaryRecords"] += 1
                    if inserted and role == "record":
                        row = ranges[record["wire"]["partition"]]
                        row["records"] += 1
                        row["bytes"] += record["bytes"]
                        capture["records"] += 1
                        capture["bytes"] += record["bytes"]
                for partition, position in batch["positions"].items():
                    row = ranges[partition]
                    if type(position) is not int or not int(row["next"]) <= position <= int(row["end"]):
                        raise InputError("The native Kafka checkpoint moved outside its original range")
                    evidence = batch["terminals"].get(partition)
                    witnessed = max([int(row["next"])] + [int(record["wire"]["offset"]) + 1 for role, record in verified
                        if role == "record" and record["wire"]["partition"] == partition])
                    if evidence is not None:
                        if evidence["kind"] not in {"PARTITION_EOF", "BOUNDARY_RECORD", "LAST_SELECTED_RECORD", "RETAINED_END"} or int(evidence["observedOffset"]) < int(row["end"]):
                            raise InputError("The native terminal evidence does not reach the selected Kafka range")
                        witnessed = max(witnessed, int(row["end"]))
                        row["terminalEvidence"] = evidence
                    if position > witnessed:
                        raise InputError("The native Kafka checkpoint has no corresponding retained record or boundary")
                    row["next"] = str(position)
                    row["status"] = "COMPLETE" if position == int(row["end"]) else "PARTIAL"
                capture["revision"] = next_revision
                capture["updatedAt"] = now()
                encoded = json_bytes(capture).decode()
                self._kdb.execute("UPDATE kafka_captures SET body=? WHERE id=?", (encoded, value))
                self._kdb.execute("INSERT INTO kafka_capture_revisions VALUES(?,?,?)", (value, next_revision, encoded))

    def _work(self, value):
        status, error = "INTERRUPTED", None
        try:
            capture = self.capture(value)
            settings = self.connection(capture["connection"], capture["connectionRevision"])["config"]
            for batch in capture_batches(settings, capture, self._cancel):
                if batch["kind"] == "batch":
                    self._batch(value, batch)
                elif batch["kind"] in {"observed", "verified"}:
                    with self.mutex, self._kdb:
                        current = self.capture(value)
                        observed = batch["inspection"]
                        checksum = digest(json_bytes(observed))
                        self._kdb.execute("INSERT OR IGNORE INTO kafka_attempt_metadata VALUES(?,?)", (checksum, json_bytes(observed).decode()))
                        current["attempts"][-1]["finalMetadataSha256" if batch["kind"] == "verified" else "metadataSha256"] = checksum
                        self._advance(current)
                elif batch["kind"] == "finished":
                    status = batch["status"]
            if status == "COMPLETE" and any(row["next"] != row["end"] for row in self.capture(value)["ranges"]):
                raise InputError("The native Kafka capture ended before every selected partition reached its retained end")
        except CaptureProblem as issue:
            status = issue.status
            error = {"message": str(issue), **issue.detail}
        except KeyboardInterrupt:
            status, error = "CANCELLED", {"message": "The operator interrupted this original Kafka capture"}
        except Exception as issue:
            status, error = "ERROR", {"message": str(issue)[:2000]}
        finally:
            with self.mutex:
                current = self.capture(value)
                current["status"], current["error"] = status, error
                current["attempts"][-1].update(endedAt=now(), status=status, error=error)
                self._advance(current)
                self._active = None
                self._thread = None

    def messages(self, value, start=0, limit=50):
        ident(value)
        integer(start, 0, 1000000000, "Page offset")
        integer(limit, 1, 200, "Page size")
        with self.mutex:
            self.capture(value)
            total = self._kdb.execute("SELECT COUNT(*) FROM kafka_capture_messages WHERE capture_id=? AND role='record'", (value,)).fetchone()[0]
            rows = self._kdb.execute("""SELECT m.body FROM kafka_capture_messages c JOIN kafka_messages m ON m.id=c.message_id
                WHERE c.capture_id=? AND c.role='record' ORDER BY m.partition_id,m.offset_value LIMIT ? OFFSET ?""", (value, limit, start))
            return {"capture": value, "offset": start, "limit": limit, "total": total,
                    "messages": [api_message(load_json(row["body"])) for row in rows]}

    def message(self, value):
        return api_message(self._record("kafka_messages", value))

    def _projection_request(self, request):
        exact(request, {"operation", "captures", "view", "decode", "deletePolicy", "acceptIncomplete", "label"})
        operation(request["operation"])
        label(request["label"], 128)
        if request["view"] not in {"events", "latest-per-partition-key"} or request["decode"] not in {"json", "bytes"} or request["deletePolicy"] not in {"retain", "tombstone", "tombstone-or-goldsky"} or type(request["acceptIncomplete"]) is not bool:
            raise InputError("Choose an explicit original Kafka projection, decoding and deletion policy")
        captures = request["captures"]
        if not isinstance(captures, list) or not 1 <= len(captures) <= 64:
            raise InputError("Select 1–64 retained capture revisions for one portable edition")
        selected, seen = [], set()
        for item in captures:
            exact(item, {"id", "revision"})
            ident(item["id"])
            integer(item["revision"], 1, 1000000000, "Capture revision")
            if item["id"] in seen:
                raise InputError("Select each retained Kafka capture once")
            seen.add(item["id"])
            selected.append(dict(item))
        selected.sort(key=lambda item: item["id"])
        return {**request, "captures": selected}

    def _select_projection_rows(self, projection_id, request):
        """Use original offset order within each partition/key; retain every source event."""
        if request["view"] == "latest-per-partition-key":
            missing = self._kdb.execute("""SELECT 1 FROM kafka_projection_events e JOIN kafka_messages m ON m.id=e.message_id
                WHERE e.projection_id=? AND e.selected=1 AND m.key_id IS NULL LIMIT 1""", (projection_id,)).fetchone()
            if missing:
                raise InputError("A selected Kafka message has no key; choose the complete events view for this source")
            self._kdb.execute("""UPDATE kafka_projection_events SET selected=0 WHERE projection_id=? AND message_id IN (
                SELECT message_id FROM (
                    SELECT e.message_id,ROW_NUMBER() OVER(PARTITION BY m.key_id ORDER BY m.offset_value DESC,m.id) AS position
                    FROM kafka_projection_events e JOIN kafka_messages m ON m.id=e.message_id
                    WHERE e.projection_id=? AND e.selected=1) WHERE position>1)""", (projection_id, projection_id))
        if request["deletePolicy"] != "retain":
            clause = "m.tombstone=1" if request["deletePolicy"] == "tombstone" else "(m.tombstone=1 OR m.goldsky_operation='d')"
            self._kdb.execute("""UPDATE kafka_projection_events SET selected=0 WHERE projection_id=? AND message_id IN
                (SELECT m.id FROM kafka_messages m WHERE """ + clause + ")", (projection_id,))

    def project(self, request):
        request = self._projection_request(request)
        projection_id = digest(json_bytes(request))
        with self.mutex:
            pending = self._reserve("projection", request["operation"], request)
            if pending["result_id"] is not None:
                return self.projection(pending["result_id"])
            coverage = []
            for selected in request["captures"]:
                current = self.capture(selected["id"])
                saved = self.capture(selected["id"], selected["revision"])
                if current["status"] in ACTIVE or saved["status"] in ACTIVE:
                    raise InputError("Finish or cancel the original capture before freezing its source edition")
                if saved["status"] in {"SOURCE_CHANGED", "SOURCE_CONFLICT"}:
                    raise InputError("This capture records a changed or conflicting source; inspect the intended topic and retain a fresh source operation before publishing an edition")
                if saved["status"] != "COMPLETE" and not request["acceptIncomplete"]:
                    raise InputError("This capture is incomplete; select acceptIncomplete explicitly to preserve its exact partial coverage")
                coverage.append(saved)
            with self._kdb:
                self._kdb.execute("DELETE FROM kafka_projection_refs WHERE projection_id=?", (projection_id,))
                self._kdb.execute("DELETE FROM kafka_projection_events WHERE projection_id=?", (projection_id,))
                for selected in request["captures"]:
                    self._kdb.execute("""INSERT INTO kafka_projection_refs
                        SELECT ?,capture_id,message_id,role,added_revision FROM kafka_capture_messages
                        WHERE capture_id=? AND added_revision<=?""", (projection_id, selected["id"], selected["revision"]))
                self._kdb.execute("""INSERT INTO kafka_projection_events
                    SELECT ?,message_id,MAX(CASE WHEN role='record' THEN 1 ELSE 0 END) FROM kafka_projection_refs
                    WHERE projection_id=? GROUP BY message_id""", (projection_id, projection_id))
                retained_bytes = self._kdb.execute("""SELECT COALESCE(SUM(m.bytes),0) FROM kafka_projection_events e
                    JOIN kafka_messages m ON m.id=e.message_id WHERE e.projection_id=?""", (projection_id,)).fetchone()[0]
                if retained_bytes > MAX_SOURCE:
                    raise InputError("The combined original Kafka wire history exceeds 256 MiB; choose a smaller exact capture edition")
                original_count = self._kdb.execute("SELECT COUNT(*) FROM kafka_projection_events WHERE projection_id=? AND selected=1", (projection_id,)).fetchone()[0]
                self._select_projection_rows(projection_id, request)
            with self.scratch() as temporary:
                path = temporary / "source.ndjson"
                count = size = 0
                with path.open("xb") as output:
                    path.chmod(0o600)
                    cursor = self._kdb.execute("""SELECT m.body FROM kafka_projection_events e JOIN kafka_messages m ON m.id=e.message_id
                        WHERE e.projection_id=? AND e.selected=1
                        ORDER BY m.cluster_id,m.topic_id,m.partition_id,m.offset_value,m.id""", (projection_id,))
                    for row in cursor:
                        envelope = decoded(load_json(row["body"]), request["decode"])["envelope"]
                        line = (ndjson_source.exact_json(envelope) + "\n").encode("utf-8")
                        if len(line) > ndjson_source.MAX_RECORD:
                            raise InputError("A projected record exceeds the original NDJSON engine's 16 MiB record limit")
                        size += len(line)
                        count += 1
                        if size > MAX_SOURCE:
                            raise InputError("The projected original source exceeds 256 MiB")
                        output.write(line)
                    output.flush()
                    os.fsync(output.fileno())
                # Deterministic source bytes and a retained operation are durable
                # before this second-database projection commit. Reopening repeats
                # original add_source on the same bytes and receives the same ID.
                with path.open("rb") as source:
                    retained = self.add_source(source, request["label"], "kafka-events.ndjson")
            value = {"id": projection_id, "operation": request["operation"], "source": retained["id"],
                "selection": request, "coverage": coverage, "records": count, "bytes": size,
                "retainedBytes": retained_bytes, "excluded": original_count - count, "createdAt": pending["created"]}
            encoded = json_bytes(value)
            if len(encoded) > 16 * 1024 * 1024:
                raise InputError("This edition's full capture metadata exceeds 16 MiB; select fewer exact captures")
            with self._kdb:
                existing = self._kdb.execute("SELECT body FROM kafka_projections WHERE id=?", (projection_id,)).fetchone()
                if existing is not None and existing["body"] != encoded.decode():
                    raise InputError("The retained Kafka projection has different original source bytes")
                self._kdb.execute("INSERT OR IGNORE INTO kafka_projections VALUES(?,?,?)",
                                  (projection_id, retained["id"], encoded.decode()))
                self._finish_operation("projection", request["operation"], projection_id)
            return self.projection(projection_id)

    def projection(self, value):
        saved = self._record("kafka_projections", value)
        return saved | {"sourceView": self.source(saved["source"]), "defaultPlan": default_plan(saved["selection"]["label"])}

    def _projection_for_build(self, build, selected=None):
        view = self.build_view(build)
        if selected is not None:
            value = self._record("kafka_projections", selected)
            if value["source"] != view["source"]:
                raise InputError("The selected Kafka history and native build use different original source bytes")
            return value
        values = self._kdb.execute("SELECT body FROM kafka_projections WHERE source_id=?", (view["source"],)).fetchall()
        if len(values) != 1:
            raise InputError("Select the exact Kafka projection history for this original native build")
        return load_json(values[0]["body"])

    def _export_metadata(self, projection):
        captures = projection["coverage"]
        connections, inspections, operations, attempts = {}, {}, {}, {}
        for capture in captures:
            key = (capture["connection"], capture["connectionRevision"])
            connection = self.connection(*key)
            connections[key] = connection
            inspection = self.inspection(capture["inspection"])
            inspections[inspection["id"]] = inspection
            for kind, name in (("connection", connection["operation"]), ("inspection", inspection["operation"]),
                               ("capture", capture["operation"])):
                row = self._kdb.execute("SELECT * FROM kafka_operations WHERE kind=? AND operation=?", (kind, name)).fetchone()
                if row is None or row["result_id"] is None:
                    raise InputError("The original Kafka operation journal is incomplete")
                operations[(kind, name)] = dict(row)
            for attempt in capture["attempts"]:
                for name in ("metadataSha256", "finalMetadataSha256"):
                    if attempt.get(name):
                        attempts[attempt[name]] = self._record("kafka_attempt_metadata", attempt[name])
        row = self._kdb.execute("SELECT * FROM kafka_operations WHERE kind='projection' AND operation=?",
                               (projection["operation"],)).fetchone()
        if row is None or row["result_id"] != projection["id"]:
            raise InputError("The retained Kafka projection operation is incomplete")
        operations[("projection", projection["operation"])] = dict(row)
        return {"schema": "stellar-forge.kafka-source-history.v1", "projection": projection,
            "connections": list(connections.values()), "inspections": list(inspections.values()),
            "operations": list(operations.values()), "attemptMetadata": attempts}

    def export_kafka(self, build, output, projection=None):
        output = Path(output).expanduser().absolute()
        with self.mutex, self.scratch() as temporary:
            selected = self._projection_for_build(build, projection)
            metadata = self._export_metadata(selected)
            native = temporary / "ndjson-project.zip"
            super().export_packet(build, native)
            private_write(temporary / "kafka.json", json_bytes(metadata))
            def lines(name, values):
                path = temporary / name
                size = 0
                with path.open("xb") as stream:
                    path.chmod(0o600)
                    for value in values:
                        encoded = json_bytes(value)
                        size += len(encoded)
                        if size > MAX_SOURCE:
                            raise InputError("A complete Kafka history member exceeds 256 MiB")
                        stream.write(encoded)
                    stream.flush()
                    os.fsync(stream.fileno())
            cursor = self._kdb.execute("""SELECT m.body FROM kafka_projection_events e JOIN kafka_messages m ON m.id=e.message_id
                WHERE e.projection_id=? ORDER BY m.cluster_id,m.topic_id,m.partition_id,m.offset_value,m.id""", (selected["id"],))
            lines("messages.jsonl", (load_json(row["body"]) for row in cursor))
            def revisions():
                for capture in selected["coverage"]:
                    for row in self._kdb.execute("SELECT body FROM kafka_capture_revisions WHERE id=? AND revision<=? ORDER BY revision",
                                                (capture["id"], capture["revision"])):
                        yield load_json(row["body"])
            lines("capture-revisions.jsonl", revisions())
            refs = self._kdb.execute("""SELECT capture_id,message_id,role,added_revision FROM kafka_projection_refs
                WHERE projection_id=? ORDER BY capture_id,message_id""", (selected["id"],))
            lines("capture-members.jsonl", ({"capture": row["capture_id"], "message": row["message_id"],
                "role": row["role"], "addedRevision": row["added_revision"]} for row in refs))
            events = self._kdb.execute("SELECT message_id,selected FROM kafka_projection_events WHERE projection_id=? ORDER BY message_id", (selected["id"],))
            lines("projection-events.jsonl", ({"message": row["message_id"], "selected": bool(row["selected"])} for row in events))
            names = ["kafka.json", "messages.jsonl", "capture-revisions.jsonl", "capture-members.jsonl",
                     "projection-events.jsonl", "ndjson-project.zip"]
            files = {name: {"bytes": (temporary / name).stat().st_size,
                           "sha256": file_digest(temporary / name, 2 * MAX_SOURCE)} for name in names}
            if files["kafka.json"]["bytes"] > 16 * 1024 * 1024:
                raise InputError("The complete Kafka source metadata exceeds 16 MiB")
            manifest = {"schema": "stellar-forge.kafka-project.v1", "projection": selected["id"],
                        "source": selected["source"], "build": build, "files": files}
            with os.fdopen(os.open(output, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "wb") as stream:
                try:
                    with zipfile.ZipFile(stream, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
                        archive.writestr("manifest.json", json_bytes(manifest))
                        for name in names:
                            archive.write(temporary / name, name)
                    stream.flush()
                    os.fsync(stream.fileno())
                except BaseException:
                    output.unlink(missing_ok=True)
                    raise
            sync_dir(output.parent)
            return {"schema": "stellar-forge.kafka-project-export.v1", "file": str(output),
                    "bytes": output.stat().st_size, "sha256": file_digest(output, 6 * MAX_SOURCE + 32 * 1024 * 1024),
                    "projection": selected["id"], "source": selected["source"], "build": build}

    def _unpack_kafka(self, archive_path, destination):
        limits = {"manifest.json": 16384, "kafka.json": 16 * 1024 * 1024,
                  "messages.jsonl": MAX_SOURCE, "capture-revisions.jsonl": MAX_SOURCE,
                  "capture-members.jsonl": MAX_SOURCE, "projection-events.jsonl": MAX_SOURCE,
                  "ndjson-project.zip": 2 * MAX_SOURCE}
        with zipfile.ZipFile(archive_path) as archive:
            infos = archive.infolist()
            if len(infos) != len(limits) or {item.filename for item in infos} != set(limits):
                raise InputError("Kafka receiving requires the seven complete original root files")
            for info in infos:
                mode = info.external_attr >> 16
                if info.flag_bits & 1 or info.compress_type not in {zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED} or stat.S_ISLNK(mode) or info.is_dir() or info.file_size > limits[info.filename]:
                    raise InputError("Invalid Kafka archive member, compression or size")
                with archive.open(info) as source, (destination / info.filename).open("xb") as output:
                    (destination / info.filename).chmod(0o600)
                    size = 0
                    while block := source.read(65536):
                        size += len(block)
                        if size > limits[info.filename]:
                            raise InputError("Kafka archive member exceeds its original size limit")
                        output.write(block)
                    if size != info.file_size:
                        raise InputError("Kafka archive member ended before its declared size")
            manifest = load_json((destination / "manifest.json").read_bytes())
            exact(manifest, {"schema", "projection", "source", "build", "files"})
            if manifest["schema"] != "stellar-forge.kafka-project.v1":
                raise InputError("Choose an original Kafka project archive")
            for key in ("projection", "source", "build"):
                ident(manifest[key])
            if not isinstance(manifest["files"], dict) or set(manifest["files"]) != set(limits) - {"manifest.json"}:
                raise InputError("The Kafka manifest must bind every original archive member")
            for name, expected in manifest["files"].items():
                actual = {"bytes": (destination / name).stat().st_size,
                          "sha256": file_digest(destination / name, limits[name])}
                if expected != actual:
                    raise InputError("Kafka source archive bytes changed: " + name)
        return manifest

    def _lines(self, path):
        with path.open("rb") as source:
            count = 0
            while line := source.readline(32 * 1024 * 1024 + 1):
                if not line.endswith(b"\n") or len(line) > 32 * 1024 * 1024 or line == b"\n":
                    raise InputError("Kafka history requires complete bounded original JSON lines")
                count += 1
                if count > 2000000:
                    raise InputError("Kafka history exceeds its record-count limit")
                yield load_json(line)

    def _validate_capture(self, value, inspections, connections):
        required = {"id", "operation", "inspection", "connection", "connectionRevision", "configSha256",
                    "clusterId", "topicId", "topic", "status", "revision", "records", "bytes",
                    "retainedBytes", "boundaryBytes", "boundaryRecords", "ranges",
                    "createdAt", "updatedAt", "error", "attempts"}
        exact(value, required)
        ident(value["id"])
        operation(value["operation"])
        integer(value["revision"], 1, 1000000000, "Capture revision")
        if value["status"] not in STATUS:
            raise InputError("Unknown original Kafka capture state")
        if value["inspection"] not in inspections:
            raise InputError("Kafka capture is missing its original inspection")
        original = inspections[value["inspection"]]
        for field in ("connection", "connectionRevision", "configSha256", "clusterId", "topicId", "topic"):
            if value[field] != original[field]:
                raise InputError("Kafka capture and original inspected source differ")
        if (value["connection"], value["connectionRevision"]) not in connections:
            raise InputError("Kafka capture is missing its original connection revision")
        for field in ("records", "boundaryRecords"):
            integer(value[field], 0, 1004096, field)
        for field in ("bytes", "retainedBytes", "boundaryBytes"):
            integer(value[field], 0, MAX_SOURCE, field)
        if value["retainedBytes"] != value["bytes"] + value["boundaryBytes"]:
            raise InputError("Kafka retained-byte counts do not include the original boundary history")
        if not isinstance(value["ranges"], list) or not 1 <= len(value["ranges"]) <= 4096:
            raise InputError("Kafka capture is missing its exact selected ranges")
        available = {row["partition"]: row for row in original["partitions"]}
        selected, seen = [], set()
        for row in value["ranges"]:
            exact(row, {"partition", "start", "end", "next", "status", "records", "bytes", "terminalEvidence"})
            part = integer(row["partition"], 0, 2147483647, "Partition")
            if part in seen or part not in available:
                raise InputError("Kafka capture repeats or invents an inspected partition")
            seen.add(part)
            for field in ("start", "end", "next"):
                offset(row[field])
            if not int(available[part]["low"]) <= int(row["start"]) <= int(row["next"]) <= int(row["end"]) <= int(available[part]["end"]):
                raise InputError("Kafka capture offsets differ from their retained original range")
            integer(row["records"], 0, 1000000, "Range records")
            integer(row["bytes"], 0, MAX_SOURCE, "Range bytes")
            if row["status"] not in {"PREPARED", "PARTIAL", "COMPLETE"}:
                raise InputError("Unknown original Kafka range status")
            evidence = row["terminalEvidence"]
            if evidence is not None:
                exact(evidence, {"kind", "observedOffset", "observedAt"}, {"eventId", "sha256"})
                offset(evidence["observedOffset"])
                if evidence["kind"] not in {"PARTITION_EOF", "BOUNDARY_RECORD", "LAST_SELECTED_RECORD", "RETAINED_END"} or int(evidence["observedOffset"]) < int(row["end"]):
                    raise InputError("Kafka boundary evidence does not reach the original range")
                if evidence["kind"] in {"BOUNDARY_RECORD", "LAST_SELECTED_RECORD"}:
                    ident(evidence.get("eventId"))
                    ident(evidence.get("sha256"))
            if value["status"] == "COMPLETE" and (row["next"] != row["end"] or row["status"] != "COMPLETE" or evidence is None):
                raise InputError("A complete Kafka capture must retain every original terminal position")
            selected.append({"partition": part, "start": row["start"], "end": row["end"]})
        if selected != sorted(selected, key=lambda row: row["partition"]):
            raise InputError("Kafka capture ranges must retain their canonical partition order")
        request = {"inspection": value["inspection"], "operation": value["operation"], "ranges": selected}
        if digest(json_bytes(request)) != value["id"]:
            raise InputError("Kafka capture identity differs from its original selected ranges")
        if sum(row["records"] for row in value["ranges"]) != value["records"] or sum(row["bytes"] for row in value["ranges"]) != value["bytes"]:
            raise InputError("Kafka selected range counts differ from the capture totals")
        if not isinstance(value["attempts"], list) or len(value["attempts"]) > 10000:
            raise InputError("Kafka native attempt history exceeds its limit")
        for attempt in value["attempts"]:
            exact(attempt, {"id", "startedAt", "endedAt", "status", "client", "error"},
                  {"metadataSha256", "finalMetadataSha256"})
            ident(attempt["id"])
            if attempt["status"] not in STATUS:
                raise InputError("Unknown original native attempt status")
            for key in ("metadataSha256", "finalMetadataSha256"):
                if key in attempt:
                    ident(attempt[key])
        return request

    def _validate_import(self, directory, manifest, staged):
        metadata = load_json((directory / "kafka.json").read_bytes())
        exact(metadata, {"schema", "projection", "connections", "inspections", "operations", "attemptMetadata"})
        if metadata["schema"] != "stellar-forge.kafka-source-history.v1":
            raise InputError("Choose the original complete Kafka source history")
        projection = metadata["projection"]
        exact(projection, {"id", "operation", "source", "selection", "coverage", "records", "bytes",
                           "retainedBytes", "excluded", "createdAt"})
        request = self._projection_request(projection["selection"])
        if request != projection["selection"] or digest(json_bytes(request)) != projection["id"] or projection["id"] != manifest["projection"] or projection["source"] != manifest["source"] or projection["operation"] != request["operation"]:
            raise InputError("Kafka projection and original source manifest differ")
        connections = {}
        for item in metadata["connections"]:
            exact(item, {"id", "revision", "sha256", "operation", "config", "createdAt"})
            operation(item["id"]); operation(item["operation"])
            integer(item["revision"], 1, 1000001, "Connection revision")
            if config(item["config"]) != item["config"] or digest(json_bytes(item["config"])) != item["sha256"]:
                raise InputError("Kafka connection references changed from their original source")
            key = (item["id"], item["revision"])
            if key in connections:
                raise InputError("Kafka source repeats a connection revision")
            connections[key] = item
        inspections = {}
        for item in metadata["inspections"]:
            exact(item, {"id", "operation", "connection", "connectionRevision", "configSha256",
                         "observedAt", "client", "clusterId", "topicId", "topic", "partitions"})
            if digest(json_bytes({key: value for key, value in item.items() if key != "id"})) != item["id"]:
                raise InputError("Kafka original inspection identity changed")
            if item["id"] in inspections or (item["connection"], item["connectionRevision"]) not in connections:
                raise InputError("Kafka inspection repeats or lacks its original connection")
            connection = connections[(item["connection"], item["connectionRevision"])]
            if item["configSha256"] != connection["sha256"] or item["topic"] != connection["config"]["topic"]:
                raise InputError("Kafka inspection and retained connection differ")
            for key in ("clusterId", "topicId", "topic"):
                label(item[key], 300)
            if not isinstance(item["partitions"], list) or not 1 <= len(item["partitions"]) <= 4096:
                raise InputError("Kafka inspection has no original partition inventory")
            seen = set()
            for part in item["partitions"]:
                exact(part, {"partition", "low", "high", "end", "observedAt"})
                integer(part["partition"], 0, 2147483647, "Partition")
                if part["partition"] in seen:
                    raise InputError("Kafka inspection repeats a partition")
                seen.add(part["partition"])
                for key in ("low", "high", "end"):
                    offset(part[key])
                if not int(part["low"]) <= int(part["end"]) <= int(part["high"]):
                    raise InputError("Kafka inspection committed offsets are inconsistent")
            inspections[item["id"]] = item
        if not isinstance(metadata["attemptMetadata"], dict):
            raise InputError("Kafka attempt metadata must retain its exact native records")
        for checksum, item in metadata["attemptMetadata"].items():
            if ident(checksum) != digest(json_bytes(item)):
                raise InputError("Kafka native attempt metadata changed")
        captures = {}
        capture_requests = {}
        if not isinstance(projection["coverage"], list) or len(projection["coverage"]) != len(request["captures"]):
            raise InputError("Kafka source coverage differs from the selected captures")
        for capture in projection["coverage"]:
            capture_requests[capture["id"]] = self._validate_capture(capture, inspections, connections)
            if capture["id"] in captures or capture["status"] in ACTIVE | {"SOURCE_CHANGED", "SOURCE_CONFLICT"}:
                raise InputError("Kafka projection contains an active or changed-source capture")
            if capture["status"] != "COMPLETE" and not request["acceptIncomplete"]:
                raise InputError("Incomplete Kafka source coverage was not explicitly selected")
            for attempt in capture["attempts"]:
                for key in ("metadataSha256", "finalMetadataSha256"):
                    if attempt.get(key) and attempt[key] not in metadata["attemptMetadata"]:
                        raise InputError("Kafka native attempt metadata is missing")
            captures[capture["id"]] = capture
        if request["captures"] != sorted([{"id": item["id"], "revision": item["revision"]} for item in captures.values()], key=lambda row: row["id"]):
            raise InputError("Kafka projection selected revisions differ from their original coverage")
        if set(connections) != {(item["connection"], item["connectionRevision"]) for item in captures.values()} or set(inspections) != {item["inspection"] for item in captures.values()}:
            raise InputError("Kafka history contains unrelated connection or inspection records")
        staged.executescript("""
            PRAGMA journal_mode=OFF;
            PRAGMA synchronous=OFF;
            CREATE TABLE messages(id TEXT PRIMARY KEY,sha TEXT NOT NULL,cluster_id TEXT,topic_id TEXT,topic TEXT,
                partition_id INTEGER,offset_value INTEGER,key_id TEXT,tombstone INTEGER,goldsky_operation TEXT,
                bytes INTEGER,body TEXT);
            CREATE TABLE members(capture_id TEXT,message_id TEXT,role TEXT,added_revision INTEGER,
                PRIMARY KEY(capture_id,message_id));
            CREATE TABLE events(message_id TEXT PRIMARY KEY,selected INTEGER);
            CREATE TABLE expected(message_id TEXT PRIMARY KEY,selected INTEGER);
            CREATE TABLE revisions(id TEXT,revision INTEGER,body TEXT,PRIMARY KEY(id,revision));
            CREATE INDEX member_revisions ON members(capture_id,added_revision);
        """)
        for raw in self._lines(directory / "messages.jsonl"):
            record = wire(raw)
            key_id, tombstone, gs = self._message_fields(raw)
            try:
                staged.execute("INSERT INTO messages VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
                    (record["id"], record["sha256"], raw["clusterId"], raw["topicId"], raw["topic"],
                     raw["partition"], int(raw["offset"]), key_id, tombstone, gs, record["bytes"], json_bytes(raw).decode()))
            except sqlite3.IntegrityError as error:
                raise InputError("Kafka archive repeats a wire-message identity") from error
            existing = self._kdb.execute("SELECT sha FROM kafka_messages WHERE id=?", (record["id"],)).fetchone()
            if existing is not None and existing["sha"] != record["sha256"]:
                raise InputError("The original receiver already retains different bytes for this Kafka message")
        for raw in self._lines(directory / "capture-revisions.jsonl"):
            self._validate_capture(raw, inspections, connections)
            if raw["id"] not in captures or raw["revision"] > captures[raw["id"]]["revision"]:
                raise InputError("Kafka archive includes an unselected capture revision")
            try:
                staged.execute("INSERT INTO revisions VALUES(?,?,?)", (raw["id"], raw["revision"], json_bytes(raw).decode()))
            except sqlite3.IntegrityError as error:
                raise InputError("Kafka archive repeats a capture revision") from error
            existing = self._kdb.execute("SELECT body FROM kafka_capture_revisions WHERE id=? AND revision=?", (raw["id"], raw["revision"])).fetchone()
            if existing is not None and load_json(existing["body"]) != raw:
                raise InputError("The receiver's original capture revision has different retained state")
        for raw in self._lines(directory / "capture-members.jsonl"):
            exact(raw, {"capture", "message", "role", "addedRevision"})
            if raw["capture"] not in captures or raw["role"] not in {"record", "boundary"}:
                raise InputError("Kafka source membership references an unselected capture or role")
            integer(raw["addedRevision"], 1, captures[raw["capture"]]["revision"], "Message capture revision")
            message = staged.execute("SELECT * FROM messages WHERE id=?", (ident(raw["message"]),)).fetchone()
            if message is None:
                raise InputError("Kafka source membership is missing its original wire bytes")
            capture = captures[raw["capture"]]
            if any(message[name] != capture[key] for name, key in (("cluster_id", "clusterId"), ("topic_id", "topicId"), ("topic", "topic"))):
                raise InputError("Kafka captured wire bytes identify a different original source")
            selected = next((row for row in capture["ranges"] if row["partition"] == message["partition_id"]), None)
            if selected is None or message["offset_value"] < int(selected["start"]) or (raw["role"] == "record" and message["offset_value"] >= int(selected["end"])) or (raw["role"] == "boundary" and message["offset_value"] < int(selected["end"])):
                raise InputError("Kafka retained message falls outside its original selected range or boundary")
            try:
                staged.execute("INSERT INTO members VALUES(?,?,?,?)", (raw["capture"], raw["message"], raw["role"], raw["addedRevision"]))
            except sqlite3.IntegrityError as error:
                raise InputError("Kafka archive repeats captured source membership") from error
        for raw in self._lines(directory / "projection-events.jsonl"):
            exact(raw, {"message", "selected"})
            if type(raw["selected"]) is not bool:
                raise InputError("Kafka source selection must be an explicit boolean")
            try:
                staged.execute("INSERT INTO events VALUES(?,?)", (ident(raw["message"]), int(raw["selected"])))
            except sqlite3.IntegrityError as error:
                raise InputError("Kafka archive repeats a projected event") from error
        if staged.execute("SELECT id FROM messages EXCEPT SELECT message_id FROM members").fetchone() or staged.execute("SELECT message_id FROM members EXCEPT SELECT id FROM messages").fetchone() or staged.execute("SELECT id FROM messages EXCEPT SELECT message_id FROM events").fetchone() or staged.execute("SELECT message_id FROM events EXCEPT SELECT id FROM messages").fetchone():
            raise InputError("Kafka wire history, capture membership and event selection are not the same complete source")
        staged.execute("INSERT INTO expected SELECT message_id,MAX(CASE WHEN role='record' THEN 1 ELSE 0 END) FROM members GROUP BY message_id")
        original_count = staged.execute("SELECT COUNT(*) FROM expected WHERE selected=1").fetchone()[0]
        if request["view"] == "latest-per-partition-key":
            if staged.execute("SELECT 1 FROM expected e JOIN messages m ON m.id=e.message_id WHERE e.selected=1 AND m.key_id IS NULL LIMIT 1").fetchone():
                raise InputError("Kafka latest-key edition includes an original null key")
            staged.execute("""UPDATE expected SET selected=0 WHERE message_id IN (
                SELECT message_id FROM (SELECT e.message_id,ROW_NUMBER() OVER(PARTITION BY m.key_id ORDER BY m.offset_value DESC,m.id) AS position
                FROM expected e JOIN messages m ON m.id=e.message_id WHERE e.selected=1) WHERE position>1)""")
        if request["deletePolicy"] != "retain":
            clause = "tombstone=1" if request["deletePolicy"] == "tombstone" else "(tombstone=1 OR goldsky_operation='d')"
            staged.execute("UPDATE expected SET selected=0 WHERE message_id IN (SELECT id FROM messages WHERE " + clause + ")")
        if staged.execute("SELECT * FROM events EXCEPT SELECT * FROM expected").fetchone() or staged.execute("SELECT * FROM expected EXCEPT SELECT * FROM events").fetchone():
            raise InputError("Kafka edition selection differs from its original event/key/deletion rules")
        count = size = 0
        source_digest = __import__("hashlib").sha256()
        for row in staged.execute("""SELECT m.body FROM events e JOIN messages m ON m.id=e.message_id WHERE e.selected=1
            ORDER BY m.cluster_id,m.topic_id,m.partition_id,m.offset_value,m.id"""):
            line = (ndjson_source.exact_json(decoded(load_json(row["body"]), request["decode"])["envelope"]) + "\n").encode("utf-8")
            if len(line) > ndjson_source.MAX_RECORD:
                raise InputError("Kafka projected source exceeds the original native record limit")
            count += 1; size += len(line)
            if size > MAX_SOURCE:
                raise InputError("Kafka projected source exceeds 256 MiB")
            source_digest.update(line)
        retained_bytes = staged.execute("SELECT COALESCE(SUM(bytes),0) FROM messages").fetchone()[0]
        if count != projection["records"] or size != projection["bytes"] or original_count - count != projection["excluded"] or retained_bytes != projection["retainedBytes"] or retained_bytes > MAX_SOURCE or source_digest.hexdigest() != projection["source"]:
            raise InputError("Kafka original wire history does not reconstruct the declared native source edition")
        for capture in captures.values():
            revisions = staged.execute("SELECT COUNT(*),MIN(revision),MAX(revision) FROM revisions WHERE id=?", (capture["id"],)).fetchone()
            if tuple(revisions) != (capture["revision"], 1, capture["revision"]):
                raise InputError("Kafka archive is missing original capture checkpoint history")
            final = staged.execute("SELECT body FROM revisions WHERE id=? AND revision=?", (capture["id"], capture["revision"])).fetchone()
            if load_json(final["body"]) != capture:
                raise InputError("Kafka selected capture revision differs from its retained history")
            totals = {"record": [0, 0], "boundary": [0, 0]}
            for row in staged.execute("""SELECT c.role,COUNT(*) AS records,COALESCE(SUM(m.bytes),0) AS bytes FROM members c
                JOIN messages m ON m.id=c.message_id WHERE c.capture_id=? GROUP BY c.role""", (capture["id"],)):
                totals[row["role"]] = [row["records"], row["bytes"]]
            if totals["record"] != [capture["records"], capture["bytes"]] or totals["boundary"] != [capture["boundaryRecords"], capture["boundaryBytes"]]:
                raise InputError("Kafka capture totals differ from the retained original wire membership")
            for selected in capture["ranges"]:
                row = staged.execute("""SELECT COUNT(*) AS records,COALESCE(SUM(m.bytes),0) AS bytes,MAX(m.offset_value) AS last
                    FROM members c JOIN messages m ON m.id=c.message_id
                    WHERE c.capture_id=? AND c.role='record' AND m.partition_id=?""", (capture["id"], selected["partition"])).fetchone()
                if row["records"] != selected["records"] or row["bytes"] != selected["bytes"] or row["last"] is not None and row["last"] >= int(selected["next"]):
                    raise InputError("Kafka partition checkpoint differs from its original retained records")
                evidence = selected["terminalEvidence"]
                if evidence is not None and evidence.get("eventId"):
                    event = staged.execute("SELECT sha,partition_id,offset_value FROM messages WHERE id=?", (evidence["eventId"],)).fetchone()
                    if event is None or event["sha"] != evidence["sha256"] or event["partition_id"] != selected["partition"]:
                        raise InputError("Kafka terminal record is missing its original retained wire identity")
        expected_operations = {}
        for connection in connections.values():
            args = {"connection": connection["id"], "expectedRevision": connection["revision"] - 1,
                    "operation": connection["operation"], "config": connection["config"]}
            expected_operations[("connection", connection["operation"])] = (args, connection["id"] + "@" + str(connection["revision"]))
        for inspection in inspections.values():
            args = {"connection": inspection["connection"], "revision": inspection["connectionRevision"], "operation": inspection["operation"]}
            expected_operations[("inspection", inspection["operation"])] = (args, inspection["id"])
        for capture in captures.values():
            expected_operations[("capture", capture["operation"])] = (capture_requests[capture["id"]], capture["id"])
        expected_operations[("projection", projection["operation"])] = (request, projection["id"])
        seen = set()
        for row in metadata["operations"]:
            exact(row, {"kind", "operation", "args_sha", "args", "result_id", "created"})
            key = (row["kind"], row["operation"])
            if key in seen or key not in expected_operations:
                raise InputError("Kafka operation journal repeats or introduces unrelated work")
            seen.add(key)
            args, result_id = expected_operations[key]
            if load_json(row["args"]) != args or digest(row["args"].encode()) != row["args_sha"] or row["args"] != json_bytes(args).decode() or row["result_id"] != result_id:
                raise InputError("Kafka operation journal no longer binds its original request and result")
            existing = self._kdb.execute("SELECT * FROM kafka_operations WHERE kind=? AND operation=?", key).fetchone()
            if existing is not None and (existing["args_sha"] != row["args_sha"] or existing["args"] != row["args"] or existing["result_id"] not in {None, row["result_id"]}):
                raise InputError("The receiver already owns this operation name for different original work")
        if seen != set(expected_operations):
            raise InputError("Kafka source operation journal is incomplete")
        for connection in connections.values():
            existing = self._kdb.execute("SELECT body FROM kafka_connections WHERE id=? AND revision=?", (connection["id"], connection["revision"])).fetchone()
            if existing is not None and load_json(existing["body"]) != connection:
                raise InputError("The receiver's original connection revision differs")
        for inspection in inspections.values():
            existing = self._kdb.execute("SELECT body FROM kafka_inspections WHERE id=?", (inspection["id"],)).fetchone()
            if existing is not None and load_json(existing["body"]) != inspection:
                raise InputError("The receiver's original source inspection differs")
        existing = self._kdb.execute("SELECT body FROM kafka_projections WHERE id=?", (projection["id"],)).fetchone()
        if existing is not None and load_json(existing["body"]) != projection:
            raise InputError("The receiver's original Kafka projection differs")
        staged.commit()
        return metadata

    def import_kafka(self, archive_path):
        archive_path = Path(archive_path).expanduser().absolute()
        file_digest(archive_path, 6 * MAX_SOURCE + 32 * 1024 * 1024)
        with self.mutex, self.scratch() as temporary:
            manifest = self._unpack_kafka(archive_path, temporary)
            staged_path = temporary / "receive.sqlite"
            private_write(staged_path, b"")
            staged = sqlite3.connect(staged_path)
            staged.row_factory = sqlite3.Row
            try:
                metadata = self._validate_import(temporary, manifest, staged)
                projection = metadata["projection"]
                # The original engine receives and reconstructs its exact six-file
                # project. Its own source/plan/build journal makes interruption here
                # reopenable before Kafka's complete history is committed below.
                native = super().import_packet(temporary / "ndjson-project.zip")
                if native["source"] != projection["source"] or native["build"]["id"] != manifest["build"]:
                    raise InputError("The original native dataset and retained Kafka edition differ")
                import_id = digest(json_bytes({"schema": "stellar-forge.kafka-receiving.v1",
                    "projection": projection["id"], "source": projection["source"], "build": manifest["build"]}))
                existing_import = self._kdb.execute("SELECT body FROM kafka_imports WHERE id=?", (import_id,)).fetchone()
                if existing_import is not None:
                    saved = load_json(existing_import["body"])
                    return saved | {"reopened": True}
                with self._kdb:
                    for item in metadata["connections"]:
                        self._kdb.execute("INSERT OR IGNORE INTO kafka_connections VALUES(?,?,?)", (item["id"], item["revision"], json_bytes(item).decode()))
                    for item in metadata["inspections"]:
                        self._kdb.execute("INSERT OR IGNORE INTO kafka_inspections VALUES(?,?)", (item["id"], json_bytes(item).decode()))
                    for checksum, item in metadata["attemptMetadata"].items():
                        self._kdb.execute("INSERT OR IGNORE INTO kafka_attempt_metadata VALUES(?,?)", (checksum, json_bytes(item).decode()))
                    for row in staged.execute("SELECT * FROM messages"):
                        self._kdb.execute("INSERT OR IGNORE INTO kafka_messages VALUES(?,?,?,?,?,?,?,?,?,?,?,?)", tuple(row))
                    for row in staged.execute("SELECT * FROM revisions"):
                        self._kdb.execute("INSERT OR IGNORE INTO kafka_capture_revisions VALUES(?,?,?)", tuple(row))
                    for capture in projection["coverage"]:
                        current = self._kdb.execute("SELECT body FROM kafka_captures WHERE id=?", (capture["id"],)).fetchone()
                        if current is None:
                            self._kdb.execute("INSERT INTO kafka_captures VALUES(?,?)", (capture["id"], json_bytes(capture).decode()))
                        elif load_json(current["body"])["revision"] < capture["revision"]:
                            self._kdb.execute("UPDATE kafka_captures SET body=? WHERE id=?", (json_bytes(capture).decode(), capture["id"]))
                    for row in staged.execute("SELECT * FROM members"):
                        existing = self._kdb.execute("SELECT role,added_revision FROM kafka_capture_messages WHERE capture_id=? AND message_id=?", (row["capture_id"], row["message_id"])).fetchone()
                        if existing is not None and tuple(existing) != (row["role"], row["added_revision"]):
                            raise InputError("The receiver already retains different original capture membership")
                        self._kdb.execute("INSERT OR IGNORE INTO kafka_capture_messages VALUES(?,?,?,?)", tuple(row))
                        self._kdb.execute("INSERT OR IGNORE INTO kafka_projection_refs VALUES(?,?,?,?,?)",
                                          (projection["id"], row["capture_id"], row["message_id"], row["role"], row["added_revision"]))
                    for row in staged.execute("SELECT * FROM events"):
                        self._kdb.execute("INSERT OR IGNORE INTO kafka_projection_events VALUES(?,?,?)", (projection["id"], row["message_id"], row["selected"]))
                    self._kdb.execute("INSERT OR IGNORE INTO kafka_projections VALUES(?,?,?)",
                                      (projection["id"], projection["source"], json_bytes(projection).decode()))
                    for row in metadata["operations"]:
                        self._kdb.execute("INSERT OR IGNORE INTO kafka_operations VALUES(?,?,?,?,?,?)",
                            tuple(row[key] for key in ("kind", "operation", "args_sha", "args", "result_id", "created")))
                        self._finish_operation(row["kind"], row["operation"], row["result_id"])
                    result = {"schema": "stellar-forge.kafka-receiving.v1", "id": import_id,
                        "projection": projection["id"], "source": native["source"], "plan": native["plan"],
                        "build": native["build"], "captures": [row["id"] for row in projection["coverage"]],
                        "receivedAt": now(), "manifestSha256": digest(json_bytes(manifest)), "reconstructed": True}
                    self._kdb.execute("INSERT INTO kafka_imports VALUES(?,?)", (import_id, json_bytes(result).decode()))
                return result
            finally:
                staged.close()
